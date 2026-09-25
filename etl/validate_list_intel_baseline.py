#!/usr/bin/env python3
"""
validate_list_intel_baseline.py
===============================
Parity check: cache/list_intel.json (built by build_list_intel_cache.py)
versus the data frozen inside the original standalone page
`List Intell/field_force_dashboard (9).html` (the "answer key").

Every field the frozen page carried is compared value by value. Differences
that are INTENDED (the 2026-09-25 rule changes) are reported separately from
unexplained ones:
  * customer street address -> not published any more (not compared)
  * CRM capacity -> AM re-based to 22 working days; the frozen page's values
    are compared against the *Source fields, and the rule's effect is listed
Anything else that differs is a FAIL.

Usage:  python etl/validate_list_intel_baseline.py [path/to/frozen.html]
Writes logs/list_intel_parity.md and exits 1 on any unexplained difference.
"""
import os, sys, re, json, glob
from collections import Counter

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT_DIR, 'cache', 'list_intel.json')
REPORT = os.path.join(ROOT_DIR, 'logs', 'list_intel_parity.md')


def load_frozen(path):
    s = open(path, encoding='utf-8').read()
    out = {}
    for name in ('REPS', 'CUSTOMERS', 'PROMO_TARGETS'):
        m = re.search(r'window\.' + name + r'\s*=\s*', s)
        if not m:
            sys.exit('frozen page has no window.%s' % name)
        dec = json.JSONDecoder()
        out[name], _ = dec.raw_decode(s, m.end())
    return out


def same(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) < 1e-9
    return a == b


def main():
    frozen_path = sys.argv[1] if len(sys.argv) > 1 else \
        (glob.glob(os.path.join(ROOT_DIR, 'List Intell', 'field_force_dashboard*.html')) or [None])[0]
    if not frozen_path or not os.path.exists(frozen_path):
        sys.exit('frozen page not found')
    base = load_frozen(frozen_path)
    new = json.load(open(CACHE, encoding='utf-8'))
    fails, lines = [], []
    P = lines.append

    # ---- Known corrections to the frozen page (verified against the source cells,
    # accepted only in exactly this shape). The frozen page missed the per-rep
    # "Total" row of the four DIAB grids' Physicians block (row 12 there, row 13
    # in the other 12 grids) and so flagged "not entered in source"; the cells
    # hold =SUM(F4:F11) (DIAB-I, II, IV) or a typed total (DIAB-III).
    NOT_ENTERED = ['Segmentation Total row (per rep) not entered in source']
    corrected = set()
    for line, plans in base['PROMO_TARGETS'].items():
        for plan, b in plans.items():
            n = new['promoTargets'].get(line, {}).get(plan) or {}
            if b.get('reconNotes') == NOT_ENTERED and b.get('segTotalRowPerRep') is None \
                    and n.get('segTotalRowPerRep') is not None:
                corrected.add((line, plan))
    corrections = []

    # ---- 1. Promo targets
    pt_fields = checked = 0
    for line, plans in base['PROMO_TARGETS'].items():
        for plan, b in plans.items():
            n = new['promoTargets'].get(line, {}).get(plan)
            if n is None:
                fails.append('promo %s %s missing' % (line, plan)); continue
            for k, bv in b.items():
                checked += 1
                if not same(bv, n.get(k)):
                    if (line, plan) in corrected and k in ('segTotalRowPerRep', 'segTotalRowLine', 'reconFlag', 'reconNotes'):
                        corrections.append('promo %s %s .%s: frozen=%r -> new=%r' % (line, plan, k, bv, n.get(k)))
                        continue
                    fails.append('promo %s %s .%s: frozen=%r new=%r' % (line, plan, k, bv, n.get(k)))
            pt_fields += 1
    P('## 1. Promo Grid targets\n\n%d line/plan entries, %d values compared, %d differences.\n'
      % (pt_fields, checked, sum(f.startswith('promo') for f in fails)))

    # ---- 2. Reps
    def key(r):
        return (r['employee'], r['plan'], r['line'], r['area'], r['manager'])
    bk, nk = Counter(map(key, base['REPS'])), Counter(map(key, new['reps']))
    only_b, only_n = bk - nk, nk - bk
    for k in only_b: fails.append('rep only in frozen page: %s' % (k,))
    for k in only_n: fails.append('rep only in new build: %s' % (k,))
    idx = {}
    for r in new['reps']:
        idx.setdefault(key(r), []).append(r)
    source_map = {'crmCapacity': 'crmCapacitySource', 'crmDeviation': 'crmDeviationSource', 'crmStatus': 'crmStatusSource'}
    rep_vals = 0
    seen = Counter()
    for b in base['REPS']:
        k = key(b)
        cands = idx.get(k) or []
        if seen[k] >= len(cands):
            continue
        n = cands[seen[k]]; seen[k] += 1
        for f, bv in b.items():
            rep_vals += 1
            nv = n.get(source_map.get(f, f))
            if not same(bv, nv) and f == 'reconFlag' and (n['line'], n['plan']) in corrected:
                corrections.append('rep reconFlag %s %s' % (n['line'], n['plan']))
                continue
            if not same(bv, nv):
                fails.append('rep %s/%s .%s: frozen=%r new=%r' % (b['employee'], b['plan'], f, bv, nv))
    P('## 2. Representatives\n\n%d frozen rows vs %d new rows; %d values compared, %d differences.\n'
      % (len(base['REPS']), len(new['reps']), rep_vals, sum(f.startswith('rep') for f in fails)))

    # ---- 3. Customers (address intentionally dropped: frozen col 6)
    cust_rows = cust_diff = 0
    if set(base['CUSTOMERS']) != set(new['customers']):
        fails.append('customer employee keys differ: %s' % sorted(set(base['CUSTOMERS']) ^ set(new['customers']))[:5])
    for emp, rows in base['CUSTOMERS'].items():
        nrows = new['customers'].get(emp, [])
        if len(rows) != len(nrows):
            fails.append('customers %s: %d vs %d rows' % (emp, len(rows), len(nrows))); continue
        for br, nr in zip(rows, nrows):
            cust_rows += 1
            if [br[0], br[1], br[2], br[3], br[4], br[5], br[7]] != nr:
                cust_diff += 1
                if cust_diff <= 5:
                    fails.append('customer row %s: frozen=%r new=%r' % (emp, br, nr))
    P('## 3. Customer lists\n\n%d rows compared on name, type, specialty, class, area, frequency and clinic group '
      '(street address intentionally not published): %d differences.\n' % (cust_rows, cust_diff))

    # ---- 4. Intended rule change: AM capacity at 22 days
    am = [r for r in new['reps'] if r['plan'] == 'AM' and r['crmCapacity'] is not None]
    changed = Counter((r['crmStatusSource'], r['crmStatus']) for r in am if r['crmStatusSource'] != r['crmStatus'])
    P('## 4. Intended change: CRM capacity at 22 working days for AM\n\n'
      '%d AM rows re-based (capacity = call rate x 22 instead of x 20). Status changes:\n' % len(am))
    for (a, b), c in sorted(changed.items(), key=lambda x: -x[1]):
        P('- %s -> %s: %d reps' % (a, b, c))
    pm = [r for r in new['reps'] if r['plan'] == 'PM' and r['crmCapacity'] is not None]
    pm_diff = sum(r['crmCapacity'] != r['crmCapacitySource'] for r in pm)
    P('\nPM rows unchanged at 20 days: %d of %d identical to the CRM export.\n' % (len(pm) - pm_diff, len(pm)))

    # ---- corrections
    P('## 5. Documented corrections to the frozen page\n')
    if corrections:
        promo_c = [c for c in corrections if c.startswith('promo')]
        rep_c = Counter(c for c in corrections if c.startswith('rep'))
        P('The frozen page did not read the per-rep "Total" row of the Physicians block in %d grid(s) '
          '(%s) and flagged them "not entered in source". The cells are populated; the new build reads them:\n'
          % (len(corrected), ', '.join('%s %s' % c for c in sorted(corrected))))
        for c in promo_c:
            P('- ' + c)
        for c, k in sorted(rep_c.items()):
            P('- %s: %d reps inherit reconFlag false' % (c.replace('rep reconFlag ', ''), k))
        P('')
    else:
        P('None.\n')

    # ---- verdict
    P('## Verdict\n')
    if fails:
        P('**FAIL** - %d unexplained difference(s):\n' % len(fails))
        for f in fails[:200]:
            P('- ' + f)
    else:
        P('**PASS** - every value the frozen page carried is reproduced from the source workbooks, '
          'apart from the documented corrections (section 5) and the intended rule changes (section 4).')
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    head = '# List Intelligence - parity vs frozen page\n\nFrozen page: `%s`  \nNew build: `%s` (built %s)\n\n' % (
        os.path.basename(frozen_path), os.path.relpath(CACHE, ROOT_DIR), new['meta']['builtAt'])
    open(REPORT, 'w', encoding='utf-8').write(head + '\n'.join(lines) + '\n')
    print(head + '\n'.join(lines))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
