#!/usr/bin/env python3
"""
refresh_all.py -- the engine behind UPDATE_DASHBOARD.bat
==============================================================================
Created 2026-10-02 (Claude, approved by Ahmed). ONE entry point that:

  1. PRE-CHECK   finds Python deps and Excel files that are still open
  2. DETECT      finds which source files changed since the last good run
  3. PLAN        maps changed files -> build steps -> downstream steps -> pages
                 (config/refresh_map.json is the single source of truth)
  4. BUILD       runs ONLY the existing build scripts that are needed
  5. VALIDATE    compares every rebuilt cache before vs after
  6. VERSION     bumps the ?v= cache-busting tags automatically
  7. GATE        critical failure -> stop, nothing pushed
  8. PUSH        git add / commit / push / verify (same rules as refresh.bat)
  9. REPORT      logs/UPDATE_DASHBOARD_LAST_REPORT.txt

It never edits the build scripts and never touches refresh.bat (the fallback).

MANUAL ONLY: nothing in this system runs by itself. There is no scheduler,
no folder watcher and no background job -- every build, commit and push
happens only when Ahmed double-clicks UPDATE_DASHBOARD.bat (decision
2026-10-02).

MODES
  (default)     smart: rebuild what changed + everything downstream, then push
  --check       CHECK-ONLY: show the plan, build nothing, change no dashboard file
  --no-push     build + validate + version tags, but no git
  --full        rebuild every step (safety run), then push (add --no-push to test)
  --steps a,b   force these step ids (plus their downstream steps)
  --yes         do not ask; push even if there are validation WARNINGS
                (critical failures still block the push)
  --parity      CHECK-ONLY plus a step-by-step comparison with refresh.bat
  --no-open     do not open the HTML report at the end

Every run writes logs/UPDATE_DASHBOARD_LAST_REPORT.html (opened automatically
at the end of a run you started) and a plain-text log next to it.
"""

import argparse
import base64
import datetime as dt
import fnmatch
import glob
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
MAP_PATH = os.path.join(ROOT, 'config', 'refresh_map.json')
IS_WINDOWS = os.name == 'nt'
# first-run timestamp check: a source saved within this many seconds of its cache
# counts as 'same' (git checkouts stamp many files with the same minute).
BOOTSTRAP_TOLERANCE_S = 300

try:  # never crash on a console that cannot print a character
    sys.stdout.reconfigure(errors='replace')
    sys.stderr.reconfigure(errors='replace')
except Exception:
    pass

STAMP = dt.datetime.now().strftime('%Y%m%d_%H%M%S')
PUSH_INFO = {}
_LOG_FH = None


# ----------------------------------------------------------------------------- output
def out(msg=''):
    print(msg, flush=True)
    if _LOG_FH:
        _LOG_FH.write(msg + '\n')
        _LOG_FH.flush()


def banner(title):
    out('')
    out('=' * 72)
    out('  ' + title)
    out('=' * 72)


def rel(p):
    return os.path.relpath(p, ROOT).replace('\\', '/')


def ab(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p.replace('/', os.sep))


def fmt_time(ts):
    return dt.datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M') if ts else '-'


def fmt_size(n):
    for unit in ('B', 'KB', 'MB', 'GB'):
        if n < 1024 or unit == 'GB':
            return f'{n:.0f} {unit}' if unit == 'B' else f'{n:.1f} {unit}'
        n /= 1024.0


# ----------------------------------------------------------------------------- config / state
def load_map():
    with open(MAP_PATH, encoding='utf-8') as f:
        cfg = json.load(f)
    ids = [s['id'] for s in cfg['steps']]
    if len(ids) != len(set(ids)):
        raise SystemExit('[CONFIG ERROR] duplicate step id in config/refresh_map.json')
    seen = set()
    for s in cfg['steps']:
        for d in s.get('depends_on', []):
            if d not in ids:
                raise SystemExit(f"[CONFIG ERROR] step '{s['id']}' depends on unknown step '{d}'")
            if d not in seen:
                raise SystemExit(f"[CONFIG ERROR] step '{s['id']}' depends on '{d}', which is listed AFTER it. Steps must be in run order.")
        for pg in s.get('pages', []):
            if pg not in cfg.get('pages', {}):
                raise SystemExit(f"[CONFIG ERROR] step '{s['id']}' names unknown page '{pg}'")
        seen.add(s['id'])
    return cfg


def load_state(cfg):
    p = ab(cfg['settings']['state_file'])
    if os.path.exists(p):
        try:
            with open(p, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            out('[WARNING] state file unreadable -- falling back to timestamp comparison.')
    return {'files': {}, 'runs': []}


def save_state(cfg, state):
    p = ab(cfg['settings']['state_file'])
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, p)


def expand(pattern):
    """Source path or glob -> list of real files (Excel lock files excluded)."""
    if any(ch in pattern for ch in '*?['):
        hits = glob.glob(ab(pattern))
    else:
        hits = [ab(pattern)] if os.path.exists(ab(pattern)) else []
    return sorted(h for h in hits if not os.path.basename(h).startswith('~$') and os.path.isfile(h))


def sha1(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fingerprint(path, with_hash=False):
    st = os.stat(path)
    fp = {'mtime': round(st.st_mtime, 3), 'size': st.st_size}
    if with_hash:
        fp['sha1'] = sha1(path)
    return fp


# ----------------------------------------------------------------------------- detection
def output_mtime_floor(step):
    """Oldest mtime among a step's outputs; None if any output is missing."""
    ts = []
    for o in step.get('outputs', []):
        files = expand(o)
        if not files:
            return None
        ts.extend(os.path.getmtime(f) for f in files)
    return min(ts) if ts else None


def detect_changes(cfg, state):
    """Return {source_rel: info} for every watched file, with a 'changed' verdict."""
    known = state.get('files', {})
    results = {}
    step_floor = {s['id']: output_mtime_floor(s) for s in cfg['steps']}
    for step in cfg['steps']:
        for pattern in step.get('sources', []):
            files = expand(pattern)
            if not files and not any(ch in pattern for ch in '*?['):
                results.setdefault(pattern, {'path': pattern, 'exists': False, 'changed': False,
                                             'reason': 'MISSING', 'steps': []})
                results[pattern]['steps'].append(step['id'])
                continue
            # files that disappeared from a glob
            if any(ch in pattern for ch in '*?['):
                for k in known:
                    if fnmatch.fnmatch(k, pattern) and not os.path.exists(ab(k)):
                        r = results.setdefault(k, {'path': k, 'exists': False, 'changed': True,
                                                   'reason': 'file removed', 'steps': []})
                        r['steps'].append(step['id'])
            for f in files:
                key = rel(f)
                if key in results:
                    results[key]['steps'].append(step['id'])
                    # bootstrap verdict can differ per step (different cache ages)
                    if results[key].get('mode') == 'bootstrap' and not results[key]['changed']:
                        floor = step_floor[step['id']]
                        if floor is None or os.path.getmtime(f) > floor + BOOTSTRAP_TOLERANCE_S:
                            results[key]['changed'] = True
                            results[key]['reason'] = f"newer than the {step['id']} cache"
                    continue
                fp = fingerprint(f)
                info = {'path': key, 'exists': True, 'mtime': fp['mtime'], 'size': fp['size'],
                        'steps': [step['id']], 'changed': False, 'reason': 'unchanged'}
                prev = known.get(key)
                if prev:
                    info['mode'] = 'state'
                    if prev.get('mtime') != fp['mtime'] or prev.get('size') != fp['size']:
                        new_hash = sha1(f)
                        info['sha1'] = new_hash
                        if new_hash != prev.get('sha1'):
                            info['changed'] = True
                            info['reason'] = 'content changed since last run'
                        else:
                            info['reason'] = 'saved again, content identical'
                            info['touched_only'] = True
                else:
                    info['mode'] = 'bootstrap'
                    floor = step_floor[step['id']]
                    if floor is None:
                        info['changed'] = True
                        info['reason'] = 'cache missing'
                    elif fp['mtime'] > floor + BOOTSTRAP_TOLERANCE_S:
                        info['changed'] = True
                        info['reason'] = f"newer than the {step['id']} cache"
                    elif not known:
                        info['reason'] = 'older than its cache (first run: timestamp check)'
                    else:
                        info['changed'] = True
                        info['reason'] = 'new source (not seen before)'
                results[key] = info
    return results


def excel_lock(path):
    """Return the lock-file name if the workbook looks open in Excel, else None."""
    d, name = os.path.split(path)
    for cand in ('~$' + name, '~$' + name[2:]):
        if os.path.exists(os.path.join(d, cand)):
            return cand
    if IS_WINDOWS and path.lower().endswith(('.xlsx', '.xlsm', '.xls', '.csv')):
        try:
            with open(path, 'r+b'):
                pass
        except PermissionError:
            return '(file is locked by another program)'
        except OSError:
            pass
    return None


def build_plan(cfg, changes, args, state=None):
    steps = cfg['steps']
    by_id = {s['id']: s for s in steps}
    reasons = {}

    if args.full:
        for s in steps:
            if s.get('in_full', True):
                reasons.setdefault(s['id'], []).append('FULL rebuild')
    if args.steps:
        for sid in [x.strip() for x in args.steps.split(',') if x.strip()]:
            if sid not in by_id:
                raise SystemExit(f"[ERROR] unknown step '{sid}'. Known: {', '.join(by_id)}")
            reasons.setdefault(sid, []).append('requested with --steps')

    for info in changes.values():
        if info['changed']:
            for sid in info['steps']:
                reasons.setdefault(sid, []).append(f"{info['path']} ({info['reason']})")

    now = time.time()
    for s in steps:
        mah = s.get('max_age_hours')
        if mah:
            floor = (state or {}).get('step_last_run', {}).get(s['id'])
            if floor is None:
                outs = [os.path.getmtime(f) for o in s.get('outputs', []) for f in expand(o)]
                floor = max(outs) if outs else None
            if floor is None or now - floor > mah * 3600:
                age = 'missing' if floor is None else f'{(now - floor) / 3600:.0f} h old'
                reasons.setdefault(s['id'], []).append(f'output {age} (refresh every {mah} h)')

    # downstream closure, in run order
    for s in steps:
        if s['id'] in reasons:
            continue
        ups = [d for d in s.get('depends_on', []) if d in reasons]
        if ups:
            reasons[s['id']] = [f"upstream rebuilt: {', '.join(ups)}"]

    if reasons:
        for s in steps:
            if s.get('always_run_when_anything_runs') and s['id'] not in reasons:
                reasons[s['id']] = ['records the run (always last)']

    return [s for s in steps if s['id'] in reasons], reasons


# ----------------------------------------------------------------------------- cache inspection
def read_cache_object(path):
    """Decode a window.X = {...} cache (plain or gzip+base64). None if not decodable."""
    try:
        if os.path.getsize(path) > 60 * 1024 * 1024:
            return None
        with open(path, encoding='utf-8', errors='replace') as f:
            text = f.read()
        m = re.search(r'b64Data"?\s*:\s*"([A-Za-z0-9+/=]+)"', text)
        if m:
            obj = json.loads(gzip.decompress(base64.b64decode(m.group(1))))
            if isinstance(obj, list):
                return {'(rows)': obj}
            return obj
        i, j = text.find('{'), text.rfind('}')
        if i >= 0 and j > i and text.lstrip().startswith('window.'):
            return json.loads(text[i:j + 1])
    except Exception:
        return None
    return None


TIMESTAMP_KEYS = {'generatedAt', 'generated_at', 'builtAt', 'buildTimestamp', 'loadTimestamp',
                  'lastRefresh', 'syncLabel', 'refreshedAt'}


def _strip_ts(o):
    if isinstance(o, dict):
        return {k: _strip_ts(v) for k, v in o.items() if k not in TIMESTAMP_KEYS}
    if isinstance(o, list) and o and isinstance(o[0], dict):
        return [_strip_ts(x) for x in o]
    return o


def content_hash(obj):
    """Hash of the decoded data with build timestamps removed (None if not decodable)."""
    if obj is None:
        return None
    return hashlib.sha1(json.dumps(_strip_ts(obj), sort_keys=True, default=str).encode()).hexdigest()


def signature(obj):
    """Counts at depth 1 and 2: {'rows': 893706, 'lookups.periods': 68, ...}."""
    sig = {}
    if not isinstance(obj, dict):
        return sig
    for k, v in obj.items():
        if isinstance(v, (list, dict)):
            sig[k] = len(v)
            if isinstance(v, dict) and len(v) <= 40:
                for k2, v2 in v.items():
                    if isinstance(v2, (list, dict)):
                        sig[f'{k}.{k2}'] = len(v2)
    return sig


def snapshot(paths):
    snap = {}
    for p in paths:
        for f in expand(p) or [ab(p)]:
            if os.path.exists(f):
                obj = read_cache_object(f) if f.endswith('.js') else None
                snap[rel(f)] = {'size': os.path.getsize(f), 'mtime': os.path.getmtime(f),
                                'sha1': sha1(f), 'sig': signature(obj), 'chash': content_hash(obj)}
                v = DATASET_VALIDATORS.get(rel(f))
                if v:
                    try:
                        snap[rel(f)]['metrics'] = v[0](f)
                    except Exception as exc:  # a validator must never break the build
                        snap[rel(f)]['metrics'] = None
                        out(f'    [NOTE] {rel(f)}: detailed check could not read the file ({exc})')
            else:
                snap[rel(f)] = None
    return snap


def compare(before, after, vcfg):
    """Return (problems, warnings, notes, changed_files)."""
    problems, warnings, notes, changed = [], [], [], []
    for path, a in after.items():
        b = before.get(path)
        if a is None:
            problems.append(f'{path}: output missing after the build')
            continue
        if a['size'] < vcfg['min_output_bytes']:
            problems.append(f"{path}: output is only {a['size']} bytes")
        if b is None:
            notes.append(f'{path}: new output created ({fmt_size(a["size"])})')
            changed.append(path)
            continue
        if a['sha1'] == b['sha1']:
            notes.append(f'{path}: identical to before (no data change)')
            continue
        if a.get('chash') and a.get('chash') == b.get('chash'):
            notes.append(f'{path}: only the build timestamp changed (no data change, no version-tag bump)')
            continue
        changed.append(path)
        drop = (b['size'] - a['size']) / b['size'] * 100 if b['size'] else 0
        if drop > vcfg['file_size_drop_warn_pct']:
            warnings.append(f"{path}: file shrank {drop:.0f}% ({fmt_size(b['size'])} -> {fmt_size(a['size'])})")
        bs, as_ = b.get('sig') or {}, a.get('sig') or {}
        for k, bv in bs.items():
            if k not in as_:
                warnings.append(f'{path}: section "{k}" disappeared (had {bv} items)')
                continue
            av = as_[k]
            if bv >= 5:
                pct = (av - bv) / bv * 100
                if pct < -vcfg['count_drop_warn_pct']:
                    warnings.append(f'{path}: "{k}" dropped {bv:,} -> {av:,} ({pct:.0f}%)')
                elif pct > vcfg['count_jump_warn_pct']:
                    warnings.append(f'{path}: "{k}" jumped {bv:,} -> {av:,} (+{pct:.0f}%)')
        v = DATASET_VALIDATORS.get(path)
        if v and b.get('metrics') and a.get('metrics'):
            try:
                w2, n2 = v[1](b['metrics'], a['metrics'], vcfg, path)
                warnings += w2
                notes += n2
            except Exception as exc:
                notes.append(f'{path}: detailed check failed to run ({exc})')
        diffs = [f'{k} {bs[k]:,}->{as_[k]:,}' for k in bs if k in as_ and bs[k] != as_[k]]
        notes.append(f"{path}: updated ({fmt_size(b['size'])} -> {fmt_size(a['size'])})"
                     + (('; ' + ', '.join(diffs[:6])) if diffs else ''))
    return problems, warnings, notes, changed


# ----------------------------------------------------------------------------- dataset-specific checks
# Business-level before/after checks for the datasets where a silent mistake
# would hurt most. Each entry: cache path -> (metrics_fn(path), compare_fn(before, after, vcfg, path)).
# compare_fn returns (warnings, notes) and may append tables to REPORT_TABLES
# for the HTML report. WARNINGS pause the push and ask for confirmation.
REPORT_TABLES = []
SCEN = ['Actual value', 'Official target', 'Working target', 'Shortage target', 'Units']


def metrics_sales(path):
    d = read_cache_object(path)
    if not isinstance(d, dict) or 'rows' not in d:
        return None
    L = d['lookups']
    months, lines = L['months'], L['lines']
    cells = {}
    for r in d['rows']:
        k = (lines[r[1]], months[r[0]])
        a = cells.get(k)
        if a is None:
            a = cells[k] = [0.0] * 5
        mask, t = r[17], r[21]
        a[0] += r[19]
        a[4] += r[18]
        if not mask & 16:          # plain row: its target counts in every scenario
            a[1] += t; a[2] += t; a[3] += t
        elif mask & 64:            # shortage mirror
            a[3] += t
        elif mask & 32:            # official mirror
            a[1] += t
        else:                      # working mirror
            a[2] += t
    return {'months': list(months), 'lines': sorted({k[0] for k in cells}),
            'rows': len(d['rows']), 'cells': cells}


def compare_sales(b, a, vcfg, path):
    W, N = [], []
    pct_lim = vcfg.get('sales_actual_change_warn_pct', 0.5)
    floor = vcfg.get('sales_actual_change_floor', 10000)
    gone_m = [m for m in b['months'] if m not in a['months']]
    new_m = [m for m in a['months'] if m not in b['months']]
    if gone_m:
        W.append(f'Sales: month(s) disappeared: {", ".join(gone_m)}')
    if new_m:
        N.append(f'Sales: new month(s) added: {", ".join(new_m)}')
    gone_l = [l for l in b['lines'] if l not in a['lines']]
    if gone_l:
        W.append(f'Sales: line(s) disappeared: {", ".join(gone_l)}')
    changed_rows, actual_flags = [], []
    for k in sorted(set(b['cells']) | set(a['cells'])):
        x, y = b['cells'].get(k, [0.0] * 5), a['cells'].get(k, [0.0] * 5)
        diffs = []
        for i in range(5):
            d = y[i] - x[i]
            lim = max(floor if i < 4 else 50, abs(x[i]) * (0.001 if i in (1, 2, 3) else pct_lim / 100))
            if abs(d) > lim:
                diffs.append(i)
        if not diffs:
            continue
        changed_rows.append([k[0], k[1]] + [f'{x[i]:,.0f} -> {y[i]:,.0f}' if i in diffs else '' for i in range(5)])
        if (0 in diffs or 4 in diffs) and k[1] in b['months']:
            actual_flags.append(f'{k[0]} {k[1]} ({x[0]:,.0f} -> {y[0]:,.0f})')
    if actual_flags:
        W.append(f'Sales: ACTUAL sales changed in {len(actual_flags)} existing line-month(s) -- check this is a deliberate '
                 'correction: ' + '; '.join(actual_flags[:8]) + (' ...' if len(actual_flags) > 8 else ''))
    tgt_changes = [r for r in changed_rows if any(r[3:6])]
    if tgt_changes:
        N.append(f'Sales: targets changed in {len(tgt_changes)} line-month(s) (details in the HTML report)')
    if not changed_rows and not new_m:
        N.append('Sales: no change in actuals, targets or units by line and month')
    # tables for the report
    tot_rows = []
    for m in sorted(set(b['months']) | set(a['months'])):
        tb = [sum(v[i] for (l, mm), v in b['cells'].items() if mm == m) for i in range(5)]
        ta = [sum(v[i] for (l, mm), v in a['cells'].items() if mm == m) for i in range(5)]
        tot_rows.append([m] + [f'{tb[i]:,.0f}' if abs(ta[i] - tb[i]) < 1 else f'{tb[i]:,.0f} -> {ta[i]:,.0f}' for i in range(5)])
    REPORT_TABLES.append({'title': 'Sales: company totals by month (before -> after when changed)',
                          'columns': ['Month'] + SCEN, 'rows': tot_rows})
    if changed_rows:
        REPORT_TABLES.append({'title': f'Sales: line-months that changed ({len(changed_rows)})',
                              'columns': ['Line', 'Month'] + SCEN, 'rows': changed_rows[:80]})
    N.append(f"Sales: rows {b['rows']:,} -> {a['rows']:,}; months {a['months'][0]}..{a['months'][-1]}")
    return W, N


def metrics_iqvia(path):
    with open(path, encoding='utf-8') as fh:
        text = fh.read()
    obj = json.loads(text[text.index('{'):text.rindex('}') + 1])
    L = obj['lookups']
    flat = json.loads(gzip.decompress(base64.b64decode(obj['b64Data'])))
    W = 14
    periods, prods, dm1s = L['periods'], L['prods'], L['dm1s']
    lcv, units, mp = {}, {}, {}
    for i in range(0, len(flat), W):
        per = periods[flat[i + 2]]
        v = flat[i + 6] or 0
        lcv[per] = lcv.get(per, 0) + v
        units[per] = units.get(per, 0) + (flat[i + 7] or 0)
        key = (prods[flat[i + 1]], per)
        dist = mp.setdefault(key, {})
        dm = dm1s[flat[i + 4]]
        dist[dm] = dist.get(dm, 0) + v
    return {'periods': sorted(periods), 'lcv': lcv, 'units': units, 'map': mp, 'rows': len(flat) // W}


def compare_iqvia(b, a, vcfg, path):
    W, N = [], []
    lim = vcfg.get('iqvia_period_change_warn_pct', 0.5)
    gone = [p for p in b['periods'] if p not in a['periods']]
    new = [p for p in a['periods'] if p not in b['periods']]
    if gone:
        W.append(f'IQVIA: period(s) disappeared: {", ".join(gone)}')
    if new:
        N.append(f'IQVIA: new period(s) added: {", ".join(new)}')
    moved = []
    for p in b['periods']:
        if p in a['periods'] and b['lcv'].get(p):
            pct = (a['lcv'].get(p, 0) - b['lcv'][p]) / b['lcv'][p] * 100
            if abs(pct) > lim:
                moved.append(f'{p} ({pct:+.1f}%)')
    if moved:
        W.append('IQVIA: total market value changed in existing period(s): ' + ', '.join(moved[:10]))
    remaps = {}
    for key, db in b['map'].items():
        da = a['map'].get(key)
        if da is None:
            continue
        sb = {k for k, v in db.items() if v}
        sa = {k for k, v in da.items() if v}
        tb, ta = sum(db.values()), sum(da.values())
        if not (sb and sa and tb > 0 and ta > 0):
            continue
        moved = 0.0
        if abs(ta - tb) / tb < 0.02:       # same total -> any share shift is a re-mapping
            for m in sb | sa:
                if abs(da.get(m, 0) / ta - db.get(m, 0) / tb) > 0.01:
                    moved += max(0.0, da.get(m, 0) - db.get(m, 0))
        elif sb != sa:                     # total also changed: only a different market set counts
            moved = sum(da.get(m, 0) for m in sa - sb)
        if moved > 0:
            r = remaps.setdefault(key[0], {'periods': [], 'from': set(), 'to': set(), 'lcv': 0})
            r['periods'].append(key[1])
            r['from'] |= sb
            r['to'] |= sa
            r['lcv'] += moved
    if remaps:
        W.append(f'IQVIA: market (DEFIND Market_1) mapping changed for {len(remaps)} product(s): '
                 + '; '.join(f"{p}: {', '.join(sorted(r['from']))} -> {', '.join(sorted(r['to']))}"
                             for p, r in list(remaps.items())[:5]) + (' ...' if len(remaps) > 5 else ''))
        REPORT_TABLES.append({'title': f'IQVIA: market mapping changes ({len(remaps)} products)',
                              'columns': ['Product', 'From market', 'To market', 'Periods', 'LCV moved'],
                              'rows': [[p, ', '.join(sorted(r['from'])), ', '.join(sorted(r['to'])),
                                        f"{min(r['periods'])}..{max(r['periods'])} ({len(r['periods'])})", f"{r['lcv']:,.0f}"]
                                       for p, r in sorted(remaps.items(), key=lambda x: -x[1]['lcv'])][:60]})
    last = sorted(set(b['periods']) | set(a['periods']))[-8:]
    REPORT_TABLES.append({'title': 'IQVIA: total market by period (last 8, before -> after when changed)',
                          'columns': ['Period', 'LCV', 'Units'],
                          'rows': [[p] + [(f"{b[m].get(p, 0):,.0f}" if abs(a[m].get(p, 0) - b[m].get(p, 0)) < 1
                                           else f"{b[m].get(p, 0):,.0f} -> {a[m].get(p, 0):,.0f}") for m in ('lcv', 'units')]
                                   for p in last]})
    if not (gone or new or moved or remaps):
        N.append('IQVIA: no change in periods, period totals or market mapping')
    N.append(f"IQVIA: rows {b['rows']:,} -> {a['rows']:,}; periods {a['periods'][0]}..{a['periods'][-1]}")
    return W, N


DATASET_VALIDATORS = {
    'cache/sales.data.js': (metrics_sales, compare_sales),
    'cache/iqvia.data.js': (metrics_iqvia, compare_iqvia),
}


# ----------------------------------------------------------------------------- running steps
def run_command(cmd, log_prefix='    '):
    script = ab(cmd[0])
    full = [sys.executable, script] + list(cmd[1:])
    env = dict(os.environ, PYTHONIOENCODING='utf-8')
    proc = subprocess.Popen(full, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            env=env, text=True, encoding='utf-8', errors='replace')
    captured = []
    for line in proc.stdout:
        line = line.rstrip('\n')
        captured.append(line)
        out(log_prefix + line)
    proc.wait()
    return proc.returncode, '\n'.join(captured)


def run_step(step):
    mp = step.get('multi_pass')
    if mp:
        for name in mp.get('clear_temp_files', []):
            p = os.path.join(tempfile.gettempdir(), name)
            if os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass
        cmd = step['commands'][0]
        for n in range(1, mp.get('max_passes', 20) + 1):
            out(f'    -- pass {n} --')
            rc, text = run_command(cmd)
            if rc != 0:
                return False, f'exit code {rc} on pass {n}'
            if mp['until'] in text:
                return True, f'completed after {n} pass(es)'
        return False, f"did not finish after {mp.get('max_passes', 20)} passes"
    for cmd in step['commands']:
        rc, _ = run_command(cmd)
        if rc != 0:
            return False, f"{cmd[0]} exit code {rc}"
    return True, 'ok'


def backup_outputs(cfg, step, run_dir):
    saved = []
    for o in step.get('outputs', []):
        for f in expand(o):
            dst = os.path.join(run_dir, 'before', rel(f))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(f, dst)
            saved.append((f, dst))
    return saved


def restore_outputs(saved):
    for orig, bak in saved:
        try:
            shutil.copy2(bak, orig)
        except OSError:
            pass


# ----------------------------------------------------------------------------- version tags
def plan_version_tags(cfg, changed_caches):
    """Return list of (file, old, new, cache) edits for the given rebuilt caches."""
    new_tag = f'{STAMP[:8]}_{STAMP[9:13]}_auto'
    edits = []
    html_p = ab('dashboard.html')
    loader_p = ab('js/cache-loader.js')
    html = open(html_p, 'rb').read() if os.path.exists(html_p) else b''
    loader = open(loader_p, 'rb').read() if os.path.exists(loader_p) else b''
    loader_touched = False
    for c in sorted(set(changed_caches)):
        if not c.startswith('cache/') or not c.endswith('.js'):
            continue
        name = re.escape(c.encode())
        hit = False
        for m in re.finditer(rb'(' + name + rb'\?v=)([A-Za-z0-9_.\-]+)', html):
            edits.append(('dashboard.html', m.group(0), m.group(1) + new_tag.encode(), c))
            hit = True
        m = re.search(rb'file:\s*"' + name + rb'"[\s\S]{0,300}?version:\s*"([^"]*)"', loader)
        if m:
            seg = m.group(0)
            new_seg = seg[:seg.rfind(m.group(1))] + new_tag.encode() + seg[seg.rfind(m.group(1)) + len(m.group(1)):]
            edits.append(('js/cache-loader.js', seg, new_seg, c))
            hit = loader_touched = True
        if not hit:
            edits.append((None, None, None, c))
    if loader_touched:
        m = re.search(rb'js/cache-loader\.js\?v=([A-Za-z0-9_.\-]+)', html)
        if m:
            edits.append(('dashboard.html', m.group(0), b'js/cache-loader.js?v=' + new_tag.encode(), 'js/cache-loader.js'))
    return edits, new_tag


def apply_version_tags(edits, run_dir):
    by_file = {}
    for f, old, new, _ in edits:
        if f:
            by_file.setdefault(f, []).append((old, new))
    for f, pairs in by_file.items():
        p = ab(f)
        dst = os.path.join(run_dir, 'before', f)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.exists(dst):
            shutil.copy2(p, dst)
        data = open(p, 'rb').read()
        for old, new in pairs:
            data = data.replace(old, new, 1)
        with open(p, 'wb') as fh:  # bytes in, bytes out: CRLF line endings are preserved
            fh.write(data)


# ----------------------------------------------------------------------------- git
def find_git():
    g = shutil.which('git')
    if g:
        return g
    for c in (r'C:\Program Files\Git\cmd\git.exe', r'C:\Program Files (x86)\Git\cmd\git.exe'):
        if os.path.exists(c):
            return c
    return None


def commit_candidates(cfg, step_ids):
    """Files a push would add: version-tag/tool files + outputs and git_extra of the given steps.
    Paths listed under settings.git.untrack are never added."""
    gcfg = cfg['settings']['git']
    by_id = {st['id']: st for st in cfg['steps']}
    patterns = list(gcfg.get('always_add', []))
    for sid in step_ids:
        st = by_id.get(sid)
        if st:
            patterns += st.get('outputs', []) + st.get('git_extra', [])
    patterns += gcfg.get('force_add', [])
    untrack = {u.replace('\\', '/') for u in gcfg.get('untrack', [])}
    return sorted({rel(f) for pat in patterns for f in glob.glob(ab(pat))
                   if os.path.isfile(f) and rel(f) not in untrack})


def publish_preview(cfg, step_ids):
    """Read-only preview (CHECK mode): what the next push would commit / untrack."""
    git = find_git()
    banner('PUBLISH PREVIEW (read-only -- what the next push would commit)')
    if not git:
        out('  git not found -- cannot preview.')
        return
    base = [git, '-c', 'core.filemode=false', '--no-optional-locks']
    if not IS_WINDOWS:  # the Cowork VM sees the Windows checkout through a mount: normalise line endings
        base[1:1] = ['-c', 'core.autocrlf=true']
    st = subprocess.run(base + ['status', '--porcelain', '--untracked-files=all'], cwd=ROOT,
                        capture_output=True, text=True, errors='replace').stdout
    dirty = {l[3:].strip().strip('"') for l in st.splitlines() if l.strip()}
    cands = commit_candidates(cfg, step_ids)
    would = [c for c in cands if c in dirty]
    out(f"  Steps whose files are included: {', '.join(step_ids) if step_ids else '(none)'}")
    out(f'  Files that would be committed ({len(would)}):')
    for c in would:
        out('    + ' + c)
    if not would:
        out('    (none)')
    for u in cfg['settings']['git'].get('untrack', []):
        tracked = subprocess.run(base + ['ls-files', '--error-unmatch', '--', u], cwd=ROOT,
                                 capture_output=True, text=True).returncode == 0
        out(f'  Stop publishing: {u} -> ' + ('will be REMOVED FROM GITHUB (git rm --cached; your local file stays)'
                                              if tracked else 'already not on GitHub (nothing to do)'))
    others = sorted(d for d in dirty if d not in cands)
    out(f'  Other changed files in the folder that will NOT be committed: {len(others)}')


def git_push(cfg, step_ids):
    gcfg = cfg['settings']['git']
    if not IS_WINDOWS:
        out('[SKIP] Git push is only done on the Windows PC (never from the Cowork VM).')
        return False
    git = find_git()
    if not git:
        out('[WARNING] Git not found. Nothing pushed -- run push_now.bat later.')
        return False

    def g(*a):
        r = subprocess.run([git] + list(a), cwd=ROOT, capture_output=True, text=True, errors='replace')
        for line in (r.stdout + r.stderr).splitlines():
            out('    ' + line)
        return r

    running = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq git.exe'], capture_output=True, text=True)
    if 'git.exe' not in running.stdout.lower():
        for lock in ('.git/index.lock', '.git/HEAD.lock'):
            if os.path.exists(ab(lock)):
                out(f'[FIX] removing stale {lock}')
                try:
                    os.remove(ab(lock))
                except OSError:
                    pass
    for u in gcfg.get('untrack', []):
        if subprocess.run([git, 'ls-files', '--error-unmatch', '--', u], cwd=ROOT,
                          capture_output=True, text=True).returncode == 0:
            out(f'Stop publishing {u}: removing it from GitHub (your local file is kept).')
            if g('rm', '--cached', '--quiet', '--', u).returncode != 0:
                out(f'[ERROR] could not untrack {u}. Nothing committed.')
                return False
    files = commit_candidates(cfg, step_ids)
    out(f'Committing {len(files)} candidate file(s) (unchanged ones are ignored by git):')
    if files:
        if g('add', '-f', '--', *files).returncode != 0:
            out('[ERROR] git add failed. Nothing committed.')
            return False
    if gcfg.get('add_all', False):
        if g('add', '-A').returncode != 0:
            out('[ERROR] git add -A failed. Nothing committed.')
            return False
    staged = subprocess.run([git, 'diff', '--cached', '--name-only'], cwd=ROOT, capture_output=True, text=True).stdout.split()
    out(f'Staged for commit ({len(staged)}): ' + ', '.join(staged))
    PUSH_INFO['files'] = staged
    if not staged:
        out('Nothing to commit.')
    msg = gcfg['commit_message'].format(steps=', '.join(step_ids), stamp=STAMP)
    r = g('commit', '-m', msg)
    if r.returncode != 0 and 'nothing to commit' not in (r.stdout + r.stderr):
        out('[ERROR] git commit failed. Nothing pushed.')
        return False
    g('push', 'origin', gcfg['branch'])
    local = subprocess.run([git, 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    remote = subprocess.run([git, 'rev-parse', f"origin/{gcfg['branch']}"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    PUSH_INFO['local'], PUSH_INFO['remote'] = local, remote
    if local and local == remote:
        out(f'SUCCESSFULLY PUSHED -- commit {local[:7]}. GitHub Pages updates in 1-2 minutes (then Ctrl+F5).')
        return True
    out(f'[ERROR] The site was NOT updated (local {local[:7]} vs remote {remote[:7]}). Run push_now.bat to retry.')
    return False


# ----------------------------------------------------------------------------- parity with refresh.bat
def parity_report(cfg):
    banner('COMPARISON WITH refresh.bat (the fallback)')
    path = ab('refresh.bat')
    if not os.path.exists(path):
        out('refresh.bat not found.')
        return
    bat_cmds = []
    for line in open(path, encoding='utf-8', errors='replace'):
        s = line.strip()
        if s.upper().startswith('REM') or '%PYTHON_CMD%' not in s or ' -c ' in s or ' -m pip' in s:
            continue
        m = re.search(r'%PYTHON_CMD%\s+("([^"]+)"|(\S+))(.*)', s)
        if not m:
            continue
        script = (m.group(2) or m.group(3)).replace('\\', '/')
        extra = [a for a in m.group(4).split() if a.startswith('--')]
        bat_cmds.append((script, tuple(extra)))
    mapped = {}
    for st in cfg['steps']:
        for c in st['commands']:
            mapped[(c[0], tuple(a for a in c[1:] if a.startswith('--')))] = st['id']
    out(f"{'refresh.bat runs':<52} {'mapped to step':<20}")
    out('-' * 72)
    missing = 0
    for c in bat_cmds:
        sid = mapped.get(c)
        label = ' '.join((c[0],) + c[1])
        out(f"{label:<52} {sid or '** NOT MAPPED **':<20}")
        missing += sid is None
    extra = [(k, v) for k, v in mapped.items() if k not in bat_cmds]
    out('')
    out(f'refresh.bat build commands: {len(bat_cmds)}   mapped: {len(bat_cmds) - missing}   NOT mapped: {missing}')
    for k, v in extra:
        out(f"Only in UPDATE_DASHBOARD: {' '.join((k[0],) + k[1])}  (step '{v}')")
    out('Differences by design: refresh.bat always runs everything (~20 min) and pushes even after')
    out('non-critical failures; it does not bump ?v= version tags and does not validate outputs.')


# ----------------------------------------------------------------------------- freshness + HTML report
def freshness(cfg):
    """Per step: newest source vs its outputs -- the dashboard freshness picture."""
    rows = []
    for st in cfg['steps']:
        outs = [os.path.getmtime(f) for o in st.get('outputs', []) for f in expand(o)]
        srcs = [(os.path.getmtime(f), rel(f)) for p in st.get('sources', []) for f in expand(p)]
        built = max(outs) if outs else None
        newest = max(srcs) if srcs else None
        if built is None:
            status = 'MISSING'
        elif newest and newest[0] > built + BOOTSTRAP_TOLERANCE_S:
            status = 'SOURCE NEWER'
        else:
            status = 'current'
        rows.append({'id': st['id'], 'label': st['label'], 'built': built, 'newest_src': newest,
                     'status': status, 'pages': [cfg['pages'][p] for p in st.get('pages', [])]})
    return rows


def _esc(x):
    return (str(x).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def write_html_report(cfg, R):
    S = cfg['settings']
    path = ab(S.get('html_report_file', 'logs/UPDATE_DASHBOARD_LAST_REPORT.html'))
    colour = {'ok': '#1f8a4c', 'warn': '#b7791f', 'bad': '#c0392b', 'info': '#2563eb'}[R.get('tone', 'info')]

    def table(cols, rows, cls=''):
        h = '<table class="%s"><thead><tr>%s</tr></thead><tbody>' % (cls, ''.join('<th>%s</th>' % _esc(c) for c in cols))
        for r in rows:
            h += '<tr>%s</tr>' % ''.join('<td>%s</td>' % _esc(c) for c in r)
        return h + '</tbody></table>'

    parts = []
    parts.append('<header><div class="badge" style="background:%s">%s</div><h1>Zeta Intel Dashboard -- update report</h1>'
                 '<p class="meta">%s &middot; mode: %s &middot; started %s &middot; %s</p></header>'
                 % (colour, _esc(R.get('status', '')), _esc(STAMP), _esc(R.get('mode', '')), _esc(R.get('started', '')),
                    _esc(R.get('duration', ''))))
    if R.get('headline'):
        parts.append('<p class="headline">%s</p>' % _esc(R['headline']))
    if R.get('problems') or R.get('warnings'):
        parts.append('<h2>Needs your attention</h2><ul class="alerts">')
        parts += ['<li class="bad">%s</li>' % _esc(x) for x in R.get('problems', [])]
        parts += ['<li class="warn">%s</li>' % _esc(x) for x in R.get('warnings', [])]
        parts.append('</ul>')
    parts.append('<h2>1. What changed in your Excel files</h2>')
    ch = R.get('changes', [])
    parts.append(table(['File', 'Saved', 'Why it counts as changed'], ch) if ch else '<p>No source file changed.</p>')
    if R.get('plan'):
        parts.append('<h2>2. What was rebuilt</h2>')
        parts.append(table(['Step', 'Critical', 'Why', 'Result', 'Time'], R['plan']))
    if R.get('pages'):
        parts.append('<h2>3. Dashboard pages affected</h2><p>%s</p>' % ' &middot; '.join(_esc(p) for p in R['pages']))
    if R.get('notes'):
        parts.append('<h2>4. Validation details</h2><ul>%s</ul>' % ''.join('<li>%s</li>' % _esc(n) for n in R['notes']))
    for t in REPORT_TABLES:
        parts.append('<h3>%s</h3>' % _esc(t['title']) + table(t['columns'], t['rows'], 'num'))
    if R.get('tags'):
        parts.append('<h2>5. Version tags updated</h2>' + table(['File', 'Dataset', 'New version'], R['tags']))
    parts.append('<h2>6. Publish</h2><p>%s</p>' % _esc(R.get('publish', '')))
    if PUSH_INFO.get('files'):
        parts.append('<p>Committed files (%d): %s</p>' % (len(PUSH_INFO['files']), _esc(', '.join(PUSH_INFO['files']))))
    fr = freshness(cfg)
    parts.append('<h2>7. Data freshness (every dataset, after this run)</h2>')
    parts.append(table(['Dataset', 'Last built', 'Newest source', 'Status', 'Pages'],
                       [[f['label'], fmt_time(f['built']),
                         (f"{f['newest_src'][1]} ({fmt_time(f['newest_src'][0])})" if f['newest_src'] else '-'),
                         f['status'], ', '.join(f['pages'])] for f in fr], 'fresh'))
    parts.append('<p class="foot">Manual refresh only: nothing rebuilds or pushes unless UPDATE_DASHBOARD.bat is run. '
                 'Plain-text log: %s. Backups: %s</p>' % (_esc(R.get('log', '-')), _esc(R.get('backup', '-'))))
    css = """
    :root{--bg:#f6f7f9;--card:#fff;--ink:#1d2433;--mute:#5b6577;--line:#e3e6eb}
    @media (prefers-color-scheme:dark){:root{--bg:#12151b;--card:#1b2029;--ink:#e6e9ef;--mute:#9aa4b5;--line:#2c3340}}
    body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 'Segoe UI',system-ui,sans-serif}
    main{max-width:1150px;margin:24px auto;padding:0 16px}
    header{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 20px;margin-bottom:16px}
    h1{font-size:20px;margin:6px 0 2px} h2{font-size:16px;margin:26px 0 8px} h3{font-size:14px;margin:18px 0 6px;color:var(--mute)}
    .badge{display:inline-block;color:#fff;font-weight:600;padding:3px 10px;border-radius:999px;font-size:12px}
    .meta,.foot{color:var(--mute);font-size:12px} .headline{font-size:15px;font-weight:600}
    table{border-collapse:collapse;width:100%;background:var(--card);border:1px solid var(--line);font-size:12.5px}
    th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
    th{background:rgba(127,127,127,.08);font-weight:600}
    table.num td+td{font-variant-numeric:tabular-nums;white-space:nowrap}
    ul.alerts li{margin:4px 0;padding:6px 10px;border-radius:6px;list-style:none}
    li.bad{background:rgba(192,57,43,.12)} li.warn{background:rgba(183,121,31,.14)}
    """
    html = ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Dashboard update report</title><style>%s</style></head><body><main>%s</main></body></html>'
            % (css, '\n'.join(parts)))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(html)
    try:
        shutil.copy2(path, ab(os.path.join(S['log_dir'], f'update_dashboard_{STAMP}.html')))
    except OSError:
        pass
    return path


# ----------------------------------------------------------------------------- main
def main():
    global _LOG_FH
    ap = argparse.ArgumentParser(description='UPDATE_DASHBOARD orchestrator (manual runs only)')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--full', action='store_true')
    ap.add_argument('--steps', default='')
    ap.add_argument('--yes', action='store_true')
    ap.add_argument('--parity', action='store_true')
    ap.add_argument('--no-open', action='store_true')
    args = ap.parse_args()
    if args.parity:
        args.check = True
    interactive = sys.stdin.isatty() and not args.yes

    cfg = load_map()
    S = cfg['settings']
    os.makedirs(ab(S['log_dir']), exist_ok=True)
    log_path = ab(os.path.join(S['log_dir'], f'update_dashboard_{STAMP}.log'))
    if not args.check:
        _LOG_FH = open(log_path, 'w', encoding='utf-8')

    mode = 'CHECK-ONLY' if args.check else ('FULL' if args.full else 'SMART') + (' / NO-PUSH' if args.no_push else '')
    t_all = time.time()
    R = {'mode': mode, 'started': dt.datetime.now().strftime('%Y-%m-%d %H:%M'), 'warnings': [], 'problems': [],
         'notes': [], 'log': rel(log_path) if not args.check else '(CHECK-ONLY: no log file)'}

    def finish(code, status, tone, headline, publish=''):
        R.update(status=status, tone=tone, headline=headline, duration=f'{(time.time() - t_all) / 60:.1f} min')
        if publish:
            R['publish'] = publish
        if _LOG_FH:
            _LOG_FH.close()
            try:
                shutil.copy2(_LOG_FH.name, ab(S['report_file']))
            except OSError:
                pass
        try:
            html = write_html_report(cfg, R)
            print(f'\nReport: {rel(html)}')
            if IS_WINDOWS and not args.no_open and sys.stdin.isatty():
                os.startfile(html)  # opens in the browser; only at the end of a run you started
        except Exception as exc:
            print(f'[NOTE] HTML report not written ({exc})')
        return code

    banner(f'UPDATE DASHBOARD  --  mode: {mode}  --  {dt.datetime.now():%Y-%m-%d %H:%M}  (manual run)')

    # ---- 1. detect
    state = load_state(cfg)
    first_run = not state.get('files')
    changes = detect_changes(cfg, state)
    banner('1. SOURCE FILES')
    if first_run:
        out('No previous UPDATE_DASHBOARD run recorded -> using timestamps (source newer than its cache = changed).')
    out(f"{'':2}{'file':<62}{'modified':<18}status")
    for key in sorted(changes, key=lambda k: (not changes[k]['changed'], k.lower())):
        i = changes[key]
        flag = 'CHANGED' if i['changed'] else ('MISSING' if not i['exists'] else 'same')
        name = key if len(key) <= 60 else '...' + key[-57:]
        out(f"{'>>' if i['changed'] else '  '}{name:<62}{fmt_time(i.get('mtime')):<18}{flag}"
            + (f"  ({i['reason']})" if i['changed'] or not i['exists'] else ''))
    R['changes'] = [[k, fmt_time(v.get('mtime')), v['reason']] for k, v in sorted(changes.items()) if v['changed']]
    for w in cfg.get('watch_only', []):
        p = ab(w['path'])
        if os.path.exists(p):
            prev = state.get('files', {}).get(w['path'])
            fp = fingerprint(p)
            if prev and (prev['mtime'] != fp['mtime']):
                msg = f"{w['path']} was modified. {w['note']}"
                out('  [NOTE] ' + msg)
                R['notes'].append(msg)
            state.setdefault('files', {})[w['path']] = fp if prev is None else prev

    # ---- 2. plan
    plan, reasons = build_plan(cfg, changes, args, state)
    banner('2. PLAN')
    unpushed = state.get('unpushed_caches', [])
    if not plan:
        if unpushed and not args.check and not args.no_push:
            out('No source changed, but an earlier NO-PUSH / failed-push run left rebuilt data that is not live yet:')
            for c in unpushed:
                out('  - ' + c)
            R['notes'].append('Published data rebuilt by an earlier NO-PUSH run: ' + ', '.join(unpushed))
            banner('7. PUBLISH')
            pushed = git_push(cfg, state.get('unpushed_steps', [s['id'] for s in cfg['steps']]))
            if pushed:
                state['unpushed_caches'] = []
                state['unpushed_steps'] = []
            state.setdefault('runs', []).append({'stamp': STAMP, 'mode': mode + ' / PUSH-ONLY', 'steps': [],
                                                 'pushed': pushed, 'warnings': 0})
            save_state(cfg, state)
            if pushed:
                return finish(0, 'PUBLISHED', 'ok', 'Earlier validated data is now live.',
                              f"Pushed commit {PUSH_INFO.get('local', '')[:7]} to GitHub.")
            return finish(1, 'PUSH FAILED', 'bad', 'The push did not complete. Run UPDATE_DASHBOARD again or push_now.bat.',
                          'Push failed -- see the log.')
        out('Nothing changed -- the dashboard is already up to date. Nothing to build, nothing to push.')
        if unpushed:
            out(f'NOTE: {len(unpushed)} rebuilt cache(s) from an earlier NO-PUSH run are not pushed yet: ' + ', '.join(unpushed))
        out('(Use the FULL option to force a complete rebuild.)')
        if args.parity:
            parity_report(cfg)
        if args.check:
            publish_preview(cfg, state.get('unpushed_steps', []))
        return finish(0, 'UP TO DATE', 'ok', 'Nothing changed -- nothing was built or pushed.',
                      ('Not pushed yet from an earlier NO-PUSH run: ' + ', '.join(unpushed)) if unpushed else 'Nothing to push.')
    pages = []
    for s in plan:
        out(f"  [{'CRITICAL' if s['critical'] else 'optional'}] {s['id']:<20} {s['label']}")
        for r in reasons[s['id']][:4]:
            out(f'        why: {r}')
        if len(reasons[s['id']]) > 4:
            out(f"        ... and {len(reasons[s['id']]) - 4} more")
        out(f"        runs:   {' ; '.join(' '.join(c) for c in s['commands'])}"
            + ('  (repeated until complete)' if s.get('multi_pass') else ''))
        out(f"        writes: {', '.join(s['outputs'])}")
        for pg in s.get('pages', []):
            if pg not in pages:
                pages.append(pg)
    out('')
    out('Datasets that will be regenerated: ' + ', '.join(o for s in plan for o in s['outputs']))
    out('Dashboard pages affected:')
    for pg in pages:
        out(f"  - {cfg['pages'][pg]}")
    R['pages'] = [cfg['pages'][pg] for pg in pages]
    skipped = [s['id'] for s in cfg['steps'] if s not in plan]
    out('Steps NOT needed this time: ' + (', '.join(skipped) if skipped else 'none'))
    R['plan'] = [[s['label'], 'yes' if s['critical'] else 'no', '; '.join(reasons[s['id']][:3]), 'planned', ''] for s in plan]

    # ---- 3. pre-check: open Excel files
    banner('3. PRE-CHECK')
    blocking, info_locks = [], []
    planned_ids = {s['id'] for s in plan}
    for key, i in changes.items():
        if not i['exists']:
            continue
        lock = excel_lock(ab(key))
        if lock:
            (blocking if set(i['steps']) & planned_ids else info_locks).append((key, lock))
    for key, lock in info_locks:
        out(f'  [WARNING] {key} looks open in Excel ({lock}) -- not needed this run, continuing.')
        out('            If Excel is not open, the lock file is left over and can be deleted.')
    missing_crit = [i for i in changes.values() if not i['exists'] and set(i['steps']) & planned_ids]
    for i in missing_crit:
        out(f"  [WARNING] source not found: {i['path']} (used by {', '.join(i['steps'])})")
        R['warnings'].append(f"Source not found: {i['path']} (used by {', '.join(i['steps'])})")
    if blocking:
        for key, lock in blocking:
            out(f'  [STOP] {key} is OPEN in Excel ({lock}).')
            R['problems'].append(f'{key} is open in Excel ({lock}) -- save and close it, then run again.')
        out('  Save and CLOSE these files in Excel, then run UPDATE_DASHBOARD again.')
        out('  (If Excel is really closed, delete the ~$ lock file next to the workbook.)')
        if not args.check:
            return finish(3, 'STOPPED -- EXCEL FILE OPEN', 'bad', 'Nothing was built or pushed: a source workbook is open.',
                          'Not pushed.')
    elif not info_locks:
        out('  No source workbook is open in Excel.')

    # ---- 4. version-tag preview / check-only exit
    if args.check:
        edits, tag = plan_version_tags(cfg, [o for s in plan for o in s['outputs']])
        banner('4. VERSION TAGS THAT WOULD BE UPDATED (only for caches whose content really changes)')
        for f, old, new, c in edits:
            if f:
                out(f"  {f:<20} {old.decode()[:60]}  ->  ...?v={tag}" if b'?v=' in old else
                    f"  {f:<20} cache-loader entry for {c}  ->  version \"{tag}\"")
            else:
                out(f'  (no tag)             {c}  -- not loaded through a ?v= tag')
        R['tags'] = [[f, c, '(would be) ' + tag] for f, old, new, c in edits if f]
        if args.parity:
            parity_report(cfg)
        publish_preview(cfg, sorted(set(state.get('unpushed_steps', [])) | {s['id'] for s in plan}))
        banner('CHECK-ONLY finished: nothing was built, nothing was changed, nothing was pushed.')
        return finish(0 if not blocking else 3, 'CHECK-ONLY', 'info',
                      f'{len(plan)} step(s) would run. Nothing was built, changed or pushed.', 'CHECK-ONLY: nothing pushed.')

    # ---- 5. build
    run_dir = ab(os.path.join(S['backup_dir'], STAMP))
    os.makedirs(run_dir, exist_ok=True)
    R['backup'] = rel(run_dir)
    banner('4. BUILD')
    results = {}
    all_problems, all_warnings, all_notes, changed_caches = [], [], [], []
    critical_failed = False
    for s in plan:
        req = s.get('requires_success_of')
        if req and results.get(req, {}).get('ok') is False:
            out(f"--- {s['label']}: SKIPPED ({req} failed)")
            results[s['id']] = {'ok': None, 'msg': f'skipped ({req} failed)', 'secs': 0}
            continue
        skip = s.get('skip_if_missing')
        if skip and not os.path.exists(ab(skip)):
            out(f"--- {s['label']}: SKIPPED ({skip} not found)")
            results[s['id']] = {'ok': None, 'msg': 'skipped (source not found)', 'secs': 0}
            continue
        out('')
        out(f"--- {s['label']}  [{s['id']}]")
        saved = backup_outputs(cfg, s, run_dir)
        before = snapshot(s['outputs'])
        t0 = time.time()
        ok, msg = run_step(s)
        secs = time.time() - t0
        if not ok:
            restore_outputs(saved)
            results[s['id']] = {'ok': False, 'msg': msg, 'secs': secs}
            line = f"{s['label']}: FAILED ({msg}) -- previous cache restored"
            if s['critical']:
                all_problems.append('[CRITICAL] ' + line)
                out(f'    [ERROR] {line}')
                out('    Critical step failed -> stopping. Nothing will be pushed.')
                critical_failed = True
                break
            all_warnings.append(line)
            out(f'    [WARNING] {line}')
            continue
        after = snapshot(s['outputs'])
        p, w, n, ch = compare(before, after, S['validation'])
        results[s['id']] = {'ok': True, 'msg': msg, 'secs': secs}
        state.setdefault('step_last_run', {})[s['id']] = time.time()
        if p and s['critical']:
            critical_failed = True
        all_problems += [f"{s['id']}: {x}" for x in p]
        all_warnings += [f"{s['id']}: {x}" for x in w]
        all_notes += [f"{s['id']}: {x}" for x in n]
        changed_caches += ch
        out(f'    OK in {secs:.0f}s -- {msg}')
        for x in p + w:
            out(f'    [CHECK] {x}')
        if critical_failed:
            out('    Critical output problem -> stopping. Nothing will be pushed.')
            break
    for row, s in zip(R['plan'], plan):
        r = results.get(s['id'])
        row[3] = 'not run' if r is None else ('OK' if r['ok'] else ('SKIPPED' if r['ok'] is None else 'FAILED')) + (
            '' if r is None or r['ok'] else f" ({r['msg']})")
        row[4] = f"{r['secs']:.0f}s" if r else ''

    # ---- 6. version tags
    banner('5. VERSION TAGS')
    R['tags'] = []
    if critical_failed:
        out('Skipped (critical failure).')
    else:
        edits, tag = plan_version_tags(cfg, changed_caches)
        real = [e for e in edits if e[0]]
        if real:
            apply_version_tags(edits, run_dir)
            for f, old, new, c in real:
                out(f'  {f}: {c} -> v={tag}')
                R['tags'].append([f, c, tag])
        else:
            out('  No cache content changed -> no tag to update.')
        for f, old, new, c in edits:
            if not f:
                out(f'  (no tag) {c}')

    # ---- 7. validation summary + gate
    banner('6. VALIDATION')
    for x in all_notes:
        out('  ' + x)
    for x in all_warnings:
        out('  [WARNING] ' + x)
    for x in all_problems:
        out('  [PROBLEM] ' + x)
    if not (all_warnings or all_problems):
        out('  All checks passed.')
    R['notes'] += all_notes
    R['warnings'] += all_warnings
    R['problems'] += all_problems

    pushed = False
    banner('7. PUBLISH')
    if critical_failed or (all_problems and any('[CRITICAL]' in x for x in all_problems)):
        pub = 'NOT PUSHED: a critical step failed. The previous data was kept, so the live dashboard is unchanged.'
    elif args.no_push:
        pub = 'NO-PUSH mode: built and validated locally only. The next normal run will publish it.'
    elif not changed_caches and not unpushed:
        pub = 'Nothing changed in the data -> nothing to push.'
    else:
        go = True
        if all_warnings:
            if interactive:
                ans = input('There are WARNINGS above (also in the report). Push to GitHub anyway? Type Y to push, anything else to stop: ')
                go = ans.strip().lower() in ('y', 'yes')
            elif not args.yes:
                go = False
        if go:
            pushed = git_push(cfg, sorted(set(state.get('unpushed_steps', [])) | {s['id'] for s in plan if results.get(s['id'], {}).get('ok')}))
            pub = (f"Pushed commit {PUSH_INFO.get('local', '')[:7]} to GitHub. Pages updates in 1-2 minutes (Ctrl+F5)."
                   if pushed else 'Push FAILED -- see the log. Run UPDATE_DASHBOARD again or push_now.bat.')
        else:
            pub = 'Stopped before pushing because of the warnings. Run UPDATE_DASHBOARD again and answer Y to publish.'
    out(pub)

    # ---- 8. state
    if not critical_failed:
        files = state.setdefault('files', {})
        ok_ids = {sid for sid, r in results.items() if r.get('ok')}
        for key, i in changes.items():
            if i['exists'] and set(i['steps']) <= (ok_ids | {sid for sid in i['steps'] if sid not in planned_ids}):
                files[key] = fingerprint(ab(key), with_hash=True)
        pending = set(state.get('unpushed_caches', [])) | set(changed_caches)
        state['unpushed_caches'] = [] if pushed else sorted(pending)
        state['unpushed_steps'] = [] if pushed else sorted(set(state.get('unpushed_steps', [])) | ok_ids)
        state.setdefault('runs', []).append({'stamp': STAMP, 'mode': mode, 'steps': list(results),
                                             'pushed': pushed, 'warnings': len(all_warnings)})
        state['runs'] = state['runs'][-50:]
        save_state(cfg, state)

    banner('SUMMARY')
    for sid, r in results.items():
        status = 'OK' if r['ok'] else ('SKIPPED' if r['ok'] is None else 'FAILED')
        out(f"  {sid:<20} {status:<8} {r['secs']:>6.0f}s  {r['msg']}")
    out(f'  Total time: {(time.time() - t_all) / 60:.1f} min   Warnings: {len(all_warnings)}   Problems: {len(all_problems)}   Pushed: {"YES" if pushed else "no"}')
    out(f'  Backups of everything replaced: {rel(run_dir)}')
    if critical_failed:
        return finish(2, 'FAILED -- NOT PUBLISHED', 'bad', 'A critical step failed. Nothing was pushed.', pub)
    if pushed:
        return finish(0, 'PUBLISHED' + (' WITH WARNINGS' if all_warnings else ''), 'warn' if all_warnings else 'ok',
                      f'{len(results)} step(s) rebuilt, validated and published.', pub)
    if args.no_push:
        return finish(0, 'BUILT -- NOT PUSHED (NO-PUSH)', 'warn' if all_warnings else 'info',
                      f'{len(results)} step(s) rebuilt and validated locally.', pub)
    if all_warnings:
        return finish(1, 'STOPPED FOR REVIEW', 'warn', 'Built and validated, but not published because of warnings.', pub)
    return finish(0, 'DONE', 'ok', pub, pub)


if __name__ == '__main__':
    sys.exit(main())
