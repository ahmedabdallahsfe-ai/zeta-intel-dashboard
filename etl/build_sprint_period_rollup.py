"""Zeta Sprint 2026 -- cumulative periods (Q3 = Jul + Aug + Sep).

Rule confirmed by Ahmed 2026-11-13:
  * Every parameter is shown as its Q3 ACHIEVEMENT:
      - Sales Achievement (reps, DM/ASM/NSM team sales, BM national sales):
        pooled = SUM(actual) / SUM(target) over the person's scored months
        (BM falls back to the average of monthly % for months archived
        before BM sales value/target were stored).
      - Coverage, Right Frequency, Field Working Days, DV Coverage, Calls
        per DV, Tactical Plan, Team Avg: average of the scored months.
      - Brand Manager Regions Covered: DISTINCT zones covered across the
        scored months (etl/sprint_bm_regions.py).
  * Winner pool ranking = SUM of the monthly points earned in the quarter
    (each month scored exactly as its own monthly Sprint).
  * Probation ending mid-quarter: only months AFTER probation count (those
    are exactly the months where the person is ranked in the monthly
    Sprint). Same for joiners / leave-excluded months.
  * Resigned with Last Day on/before the quarter end -> excluded; Last Day
    after the quarter end -> ranked but not Winner (departing rule).
  * Gates (Line / BU averages) are recomputed by js/sprint.js from the Q3
    achievement values, exactly like a monthly period.

Inputs : cache/sprint_history/sprint_YYYY-MM.data.js (monthly archives)
Outputs: cache/sprint_history/sprint_<key>.data.js + index.json/index.js
Also   : back-fills Brand Manager auto Regions Covered into the archived
         months of each cumulative period (archives built before the
         2026-11-13 auto rule) so monthly and quarterly views agree.
"""
import base64
import copy
import datetime
import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HIST = os.path.join(ROOT, 'cache', 'sprint_history')
INDEX_JSON = os.path.join(HIST, 'index.json')
INDEX_JS = os.path.join(HIST, 'index.js')
sys.path.insert(0, HERE)

PERIODS = [
    dict(key='2026-Q3', name='Q3', label='Q3 (Jul + Aug + Sep)',
         months=['2026-07', '2026-08', '2026-09'], start='2026-07-01', end='2026-09-30'),
]
TIERS = ['medicalRepSalesRep', 'dmDsm', 'asm', 'nsm', 'brandManager']
REP_SALES_FIELDS = ('salesPts', 'covPts', 'rfPts')


def log(m):
    print(f'[sprint-rollup] {m}', flush=True)


def read_archive(path):
    t = open(path, encoding='utf-8').read()
    b = re.search(r'b64Data:"([^"]+)"', t).group(1)
    return json.loads(gzip.decompress(base64.b64decode(b)).decode('utf-8'))


def write_archive(path, data):
    js = json.dumps(data, separators=(',', ':'), ensure_ascii=False, default=str)
    b64 = base64.b64encode(gzip.compress(js.encode('utf-8'), compresslevel=9)).decode('ascii')
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('window.SPRINT_HISTORY_CACHE = {b64Data:"' + b64 + '"};\n')
    os.replace(tmp, path)


def mean(vals):
    v = [x for x in vals if x is not None]
    return sum(v) / len(v) if v else None


def ssum(vals):
    v = [x for x in vals if x is not None]
    return sum(v) if v else None


# ---------------------------------------------------------------------
def load_manifest():
    man = []
    if os.path.exists(INDEX_JSON):
        with open(INDEX_JSON, encoding='utf-8') as f:
            man = json.load(f)
    # Re-register any monthly archive missing from the index (June had
    # dropped out of it -- file present, period unselectable).
    keys = {p['key'] for p in man}
    for fn in sorted(os.listdir(HIST)):
        m = re.match(r'sprint_(\d{4}-\d{2})\.data\.js$', fn)
        if m and m.group(1) not in keys:
            d = read_archive(os.path.join(HIST, fn))
            man.append(dict(key=m.group(1), name=d['meta']['evalPeriod'],
                            file=f'cache/sprint_history/{fn}', generatedAt=d['meta'].get('generatedAt')))
            log(f're-registered missing archive {fn} ({d["meta"]["evalPeriod"]})')
    return man


def save_manifest(man):
    man.sort(key=lambda p: p['key'])
    for path, body in ((INDEX_JSON, json.dumps(man, indent=2)),
                       (INDEX_JS, 'window.SPRINT_HISTORY_INDEX = ' + json.dumps(man, separators=(',', ':')) + ';\n')):
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(body)
        os.replace(tmp, path)


# ---------------------------------------------------------------------
def backfill_bm_regions(month_key, data, resolver, curve):
    """Archives built before 2026-11-13 carry the manual (always empty)
    Regions Covered slot. Swap in the auto value; recompute BM totals."""
    from sprint_bm_regions import points_for_count
    changed = 0
    for r in data['brandManager']['ranked']:
        for k in r.get('kpis', []):
            if k.get('key') != 'regionCount' or k.get('source') == 'coaching':
                continue
            reg = resolver.regions(r['code'], [month_key])
            raw = reg['count'] if reg else 0
            k.update(label='Regions Covered -- zones visited (auto, coaching)', source='coaching', raw=raw,
                     pts=min(k.get('weight', 20), points_for_count(curve, raw)),
                     regionDetail=dict(zones=(reg or {}).get('zones', []), detail=(reg or {}).get('detail', []),
                                       unmapped=(reg or {}).get('unmapped', []), visits=(reg or {}).get('visits', 0),
                                       zoneUniverse=resolver.zones, backfilled='2026-11-13'))
            changed += 1
        r['totalPts'] = sum(k['pts'] for k in r.get('kpis', []) if k.get('pts') is not None)
        r['isPartial'] = any(k.get('pts') is None for k in r.get('kpis', []))
    return changed


# ---------------------------------------------------------------------
def last_day_before(rec, end):
    ld = rec.get('departingLastDay') or rec.get('lastDay')
    return bool(ld) and str(ld)[:10] <= end


def agg_rep(recs, months_n):
    """recs: [(monthName, rec)] in month order (only months where ranked)."""
    base = copy.deepcopy(recs[-1][1])
    sv = ssum(r.get('salesVal') for _, r in recs)
    st = ssum(r.get('salesTgt') for _, r in recs)
    base['salesVal'], base['salesTgt'] = sv, st
    base['achPct'] = (sv / st) if (sv is not None and st) else mean(r.get('achPct') for _, r in recs)
    base['coveragePct'] = mean(r.get('coveragePct') for _, r in recs)
    base['rightFreqPct'] = mean(r.get('rightFreqPct') for _, r in recs)
    for f in REP_SALES_FIELDS:
        base[f] = ssum(r.get(f) for _, r in recs) or 0.0
    base['totalPts'] = ssum(r.get('totalPts') for _, r in recs) or 0.0
    base['monthly'] = [dict(month=m, totalPts=r.get('totalPts'), achPct=r.get('achPct'), coveragePct=r.get('coveragePct'),
                            rightFreqPct=r.get('rightFreqPct'), salesPts=r.get('salesPts'), covPts=r.get('covPts'),
                            rfPts=r.get('rfPts')) for m, r in recs]
    base.pop('leaveDetail', None)
    return base


def agg_kpis(recs, months_n, resolver=None, code=None, month_keys=None):
    by_key, order = {}, []
    for _, r in recs:
        for k in r.get('kpis', []):
            if k['key'] not in by_key:
                by_key[k['key']] = []
                order.append(k['key'])
            by_key[k['key']].append(k)
    out = []
    for key in order:
        ks = by_key[key]
        k0 = copy.deepcopy(ks[-1])
        w = max((k.get('weight') or 0) for k in ks)
        k0['monthWeight'] = w
        k0['weight'] = w * months_n
        k0['pts'] = ssum(k.get('pts') for k in ks)
        k0['monthly'] = [dict(raw=k.get('raw'), pts=k.get('pts')) for k in ks]
        if key == 'salesAch':
            sv = [k.get('salesVal') for k in ks]
            st = [k.get('salesTgt') for k in ks]
            if all(v is not None for v in sv) and all(t for t in st):
                k0['raw'] = sum(sv) / sum(st)
                k0['salesVal'], k0['salesTgt'] = sum(sv), sum(st)
                k0['q3Basis'] = 'pooled'
            else:
                k0['raw'] = mean(k.get('raw') for k in ks)
                k0['q3Basis'] = 'average of months'
                k0.pop('salesVal', None); k0.pop('salesTgt', None)
        elif key == 'regionCount' and resolver is not None:
            reg = resolver.regions(code, month_keys)
            k0['raw'] = reg['count'] if reg else 0
            k0['regionDetail'] = dict(zones=(reg or {}).get('zones', []), detail=(reg or {}).get('detail', []),
                                      unmapped=(reg or {}).get('unmapped', []), visits=(reg or {}).get('visits', 0),
                                      zoneUniverse=resolver.zones)
            k0['q3Basis'] = 'distinct zones in the quarter'
        else:
            k0['raw'] = mean(k.get('raw') for k in ks)
            k0['q3Basis'] = 'average of months'
        out.append(k0)
    return out


def agg_manager(recs, months_n, tier, resolver=None, month_keys=None):
    base = copy.deepcopy(recs[-1][1])
    base['kpis'] = agg_kpis(recs, months_n, resolver, base['code'], month_keys)
    if tier != 'brandManager':
        base['teamAvgRaw'] = mean(r.get('teamAvgRaw') for _, r in recs)
        base['teamAvgPts'] = ssum(r.get('teamAvgPts') for _, r in recs)
        base['teamAvgWeight'] = (max((r.get('teamAvgWeight') or 0) for _, r in recs)) * months_n
        sv = ssum(r.get('teamSalesVal') for _, r in recs)
        st = ssum(r.get('teamSalesTgt') for _, r in recs)
        base['teamSalesVal'], base['teamSalesTgt'] = sv, st
        base['teamSalesAchPct'] = (sv / st) if (sv is not None and st) else None
        base['coachingDetail'] = None
        base['workingDaysDetail'] = None
    base['totalPts'] = ssum(r.get('totalPts') for _, r in recs) or 0.0
    base['totalMaxPts'] = 100 * months_n
    base['isPartial'] = any(r.get('isPartial') for _, r in recs)
    base['monthly'] = [dict(month=m, totalPts=r.get('totalPts')) for m, r in recs]
    base.pop('leaveDetail', None)
    return base


def load_last_days():
    """Code -> Last Day of Work (ISO date) from Database Shortcut.xlsx -- the
    same HR master the monthly build uses. Catches people who resigned
    mid-quarter and then dropped off the later months' lists entirely."""
    import openpyxl
    out = {}
    wb = openpyxl.load_workbook(os.path.join(ROOT, 'Database Shortcut.xlsx'), read_only=True, data_only=True)
    it = wb.worksheets[0].iter_rows(values_only=True)
    h = list(next(it))
    ci, li = h.index('Code'), h.index('Last Day of Work')
    for r in it:
        if not r or r[ci] is None:
            continue
        v = r[li]
        if isinstance(v, (datetime.datetime, datetime.date)) and v.year > 1900:
            try:
                out[str(int(r[ci]))] = v.strftime('%Y-%m-%d')
            except (TypeError, ValueError):
                pass
    wb.close()
    return out


def build_period(pdef, archives, resolver, last_days=None):
    last_days = last_days or {}
    months = [archives[k] for k in pdef['months']]
    names = [d['meta']['evalPeriod'] for d in months]
    last = months[-1]
    n = len(months)
    out = dict(meta=copy.deepcopy(last['meta']))
    meta = out['meta']
    meta.update(evalPeriod=pdef['name'], periodKey=pdef['key'], periodLabel=pdef['label'],
                periodStart=pdef['start'], periodEnd=pdef['end'], cumulative=True,
                periodMonths=names, monthsCount=n, periodsBuilt=names,
                generatedAt=datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                rollupRule=('Q3 achievement per parameter (sales pooled = sum actual / sum target; '
                            'other KPIs = average of scored months; BM regions = distinct zones in the quarter). '
                            'Winner pool ranked by the SUM of monthly points. Only months a person was ranked '
                            '(after probation, active, not leave-excluded) count. Max points = 100 x 3 months.'))
    totals = {}
    for tier in TIERS:
        by_code, order = {}, []
        for mname, d in zip(names, months):
            for r in d[tier]['ranked']:
                c = str(r['code'])
                if c not in by_code:
                    by_code[c] = []
                    order.append(c)
                by_code[c].append((mname, r))
        last_excl = {str(e['code']): e for e in last[tier]['excluded']}
        ranked, excluded = [], []
        for c in order:
            recs = by_code[c]
            le = last_excl.get(c)
            # Status at QUARTER END decides: resigned -> out; promoted to a
            # higher tier -> competes there, not in this tier.
            if le is not None and le.get('reason') in ('not-active-resigned', 'promoted-higher-tier'):
                e = copy.deepcopy(le)
                why = 'resigned by quarter end' if le['reason'] == 'not-active-resigned' else 'in a higher tier at quarter end'
                e['detail'] = (e.get('detail') or '') + f" -- {why}; scored months {', '.join(m for m, _ in recs)} not counted in this tier"
                excluded.append(e)
                continue
            hr_last = last_days.get(c)
            if any(last_day_before(r, pdef['end']) for _, r in recs) or (hr_last and hr_last <= pdef['end']):
                e = dict(code=c, name=recs[-1][1]['name'], line=recs[-1][1].get('line') or recs[-1][1].get('canonLine'),
                         canonLine=recs[-1][1].get('canonLine'), bu=recs[-1][1].get('bu'), role=recs[-1][1].get('role'),
                         achPct=None, reason='not-active-resigned',
                         detail=f"Last Day of Work {hr_last or ''} on/before quarter end {pdef['end']} -- "
                                f"scored months {', '.join(m for m, _ in recs)} not counted")
                excluded.append(e)
                continue
            month_keys = [pdef['months'][names.index(m)] for m, _ in recs]
            rec = agg_rep(recs, n) if tier == 'medicalRepSalesRep' else agg_manager(recs, n, tier, resolver, month_keys)
            rec['monthsScored'] = len(recs)
            rec['scoredMonths'] = [m for m, _ in recs]
            ranked.append(rec)
        ranked_codes = {str(r['code']) for r in ranked}
        excl_codes = {str(e['code']) for e in excluded}
        # Everyone else on the latest month's excluded list who never scored.
        for c, e in last_excl.items():
            if c in ranked_codes or c in excl_codes:
                continue
            e = copy.deepcopy(e)
            # Sales Average widening (all positions): Q3 achievement where known.
            vals = []
            for d in months:
                for x in d[tier]['excluded'] + d[tier]['ranked']:
                    if str(x['code']) == c and x.get('achPct') is not None:
                        vals.append(x['achPct'])
            if vals:
                e['achPct'] = mean(vals)
            excluded.append(e)
        out[tier] = dict(ranked=ranked, excluded=excluded)
        totals[tier] = ranked
    # Team member points in drill-downs -> their Q3 sums.
    q3pts = {}
    for tier in ('medicalRepSalesRep', 'dmDsm'):
        for r in out[tier]['ranked']:
            q3pts[(tier, str(r['code']))] = r['totalPts']
    for tier in ('dmDsm', 'asm', 'nsm'):
        member_tier = 'medicalRepSalesRep' if tier == 'dmDsm' else 'dmDsm'
        for r in out[tier]['ranked']:
            for m in r.get('teamMembers') or []:
                m['totalPts'] = q3pts.get((member_tier, str(m['code'])), m.get('totalPts'))
    out['medicalRepSalesRep']['departingSoon'] = [
        d for d in (last['medicalRepSalesRep'].get('departingSoon') or [])
        if str(d.get('code')) in {str(r['code']) for r in out['medicalRepSalesRep']['ranked']}]
    return out


# ---------------------------------------------------------------------
# Option A (Ahmed 2026-11-13): Q3 SALES achievement is recomputed from the
# CURRENT sales file (same rules as the monthly build, etl/sprint_sales.py),
# so it matches the Sales Performance page even when a month's target was
# revised after that month's Sprint was archived (CVM-I July). Points are
# NOT touched -- they stay the sum of the monthly points already published.
def apply_current_sales(q, pdef, archives):
    from build_sprint_cache import load_b64, normalize_line, norm_name
    import sprint_sales
    sc = load_b64('sales.data.js')
    ss = sprint_sales.aggregate(sc, pdef['months'], normalize_line, norm_name)
    lines_lk = sc['lookups']['lines']
    name_to_mkey = {archives[m]['meta']['evalPeriod']: m for m in pdef['months']}
    rep_m, line_m = ss['rep'], ss['line']

    def rep_sales(mkey, name):
        a = rep_m[mkey].get(norm_name(name))
        return (a['val'], a['tgtVal']) if a else (0.0, 0.0)

    def total(months, name):
        v = t = 0.0
        found = False
        for mk in months:
            a = rep_m[mk].get(norm_name(name))
            if a:
                found = True
                v += a['val']; t += a['tgtVal']
        return found, v, t

    changed = 0
    for r in q['medicalRepSalesRep']['ranked']:
        months = [name_to_mkey[m] for m in r.get('scoredMonths', []) if m in name_to_mkey]
        found, v, t = total(months, r['name'])
        if not found:
            r['q3SalesBasis'] = 'archived months (rep not found in current sales file)'
            continue
        old = r.get('achPct')
        r['salesValArchived'], r['salesTgtArchived'], r['achPctArchived'] = r.get('salesVal'), r.get('salesTgt'), old
        r['salesVal'], r['salesTgt'] = v, t
        r['achPct'] = (v / t) if t > 0 else None
        r['q3SalesBasis'] = 'current sales file'
        if old is None or r['achPct'] is None or abs(old - r['achPct']) > 1e-6:
            changed += 1
    for e in q['medicalRepSalesRep']['excluded']:
        found, v, t = total(pdef['months'], e.get('name', ''))
        if found and t > 0:
            e['achPct'] = v / t

    # DM/DSM team sales per month = their that-month team members' current
    # sales; ASM/NSM = sum of their that-month DM/DSMs' team sales (the
    # same sum-once roll-up as the monthly build).
    dm_by_month = {mk: {str(d['code']): d for d in archives[mk]['dmDsm']['ranked']} for mk in pdef['months']}

    def dm_team(mk, dm_rec):
        v = t = 0.0
        for m in dm_rec.get('teamMembers') or []:
            a, b = rep_sales(mk, m['name'])
            v += a; t += b
        return v, t

    for tier in ('dmDsm', 'asm', 'nsm'):
        for r in q[tier]['ranked']:
            v = t = 0.0
            for mname in r.get('scoredMonths', []):
                mk = name_to_mkey.get(mname)
                if not mk:
                    continue
                mrec = next((x for x in archives[mk][tier]['ranked'] if str(x['code']) == str(r['code'])), None)
                if not mrec:
                    continue
                if tier == 'dmDsm':
                    a, b = dm_team(mk, mrec)
                else:
                    a = b = 0.0
                    for m in mrec.get('teamMembers') or []:
                        d = dm_by_month[mk].get(str(m['code']))
                        if d:
                            x, y = dm_team(mk, d)
                            a += x; b += y
                v += a; t += b
            r['teamSalesValArchived'], r['teamSalesTgtArchived'] = r.get('teamSalesVal'), r.get('teamSalesTgt')
            r['teamSalesVal'], r['teamSalesTgt'] = v, t
            r['teamSalesAchPct'] = (v / t) if t > 0 else None

    for r in q['brandManager']['ranked']:
        for k in r.get('kpis', []):
            if k.get('key') != 'salesAch' or not k.get('salesLine') or k['salesLine'] not in lines_lk:
                continue
            li = lines_lk.index(k['salesLine'])
            months = [name_to_mkey[m] for m in r.get('scoredMonths', []) if m in name_to_mkey]
            v = sum(line_m[mk].get(li, {}).get('val', 0) for mk in months)
            t = sum(line_m[mk].get(li, {}).get('tgtVal', 0) for mk in months)
            if t > 0:
                k['rawArchived'] = k.get('raw')
                k['raw'], k['salesVal'], k['salesTgt'] = v / t, v, t
                k['q3Basis'] = 'pooled, current sales file'
    q['meta']['q3SalesBasis'] = ('Sales achievement = sum actual / sum target from the CURRENT sales file '
                                 '(same rules as the monthly Sprint); points = sum of the published monthly points.')
    log(f'Q3 sales achievement from current sales file: {changed} rep values differ from the archived months')


def main():
    from sprint_bm_regions import BmRegionResolver
    import openpyxl
    from build_sprint_cache import extract_curve, SCALING_PATH
    man = load_manifest()
    by_key = {p['key']: p for p in man}
    resolver = BmRegionResolver(ROOT)
    wb = openpyxl.load_workbook(SCALING_PATH, data_only=True)
    region_curve = extract_curve(wb['Brand Managers'], 4, 5)
    for pdef in PERIODS:
        missing = [m for m in pdef['months'] if m not in by_key]
        if missing:
            log(f"{pdef['name']}: waiting for {', '.join(missing)} -- not built")
            man = [p for p in man if p['key'] != pdef['key']]
            continue
        archives = {}
        for m in pdef['months']:
            path = os.path.join(ROOT, by_key[m]['file'])
            d = read_archive(path)
            n = backfill_bm_regions(m, d, resolver, region_curve)
            if n:
                write_archive(path, d)
                log(f'{m}: Brand Manager Regions Covered back-filled for {n} people')
            archives[m] = d
        q = build_period(pdef, archives, resolver, load_last_days())
        apply_current_sales(q, pdef, archives)
        fn = f"sprint_{pdef['key']}.data.js"
        write_archive(os.path.join(HIST, fn), q)
        man = [p for p in man if p['key'] != pdef['key']]
        man.append(dict(key=pdef['key'], name=pdef['name'], file=f'cache/sprint_history/{fn}',
                        cumulative=True, months=[archives[m]['meta']['evalPeriod'] for m in pdef['months']],
                        generatedAt=q['meta']['generatedAt']))
        log(f"{pdef['name']} built: " + ', '.join(f"{t} {len(q[t]['ranked'])}" for t in TIERS))
    save_manifest(man)


if __name__ == '__main__':
    main()
