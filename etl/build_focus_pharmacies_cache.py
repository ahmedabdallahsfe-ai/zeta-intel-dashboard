"""
GIT-S FOCUS PHARMACIES cache (2026-11-05, Ahmed)
================================================
"GIT_SALES_SPCEIAL PHARMACIES.xlsx: target focus pharmacies the GIT sales team
works on. In Sales Performance create an analysis tab: previous sales for these
pharmacies, track active / repeated (count them), filter per rep and DM, and a
best-practice analysis."

Ahmed's decisions (2026-11-05):
  * Sales basis    : the GIT_SALES line.
  * Active         : net sales > 0 in the month.  Repeated: active in >= 2 months
                     of the selected period (computed in js/focus-pharmacies.js).
  * Previous sales : Jan-Aug monthly average vs the months since launch.
  * Access         : SFE / senior roles + GIT BU users (js/auth.js).

GIT_SALES rows only exist from the team's first month (Sep-26). Before that the
same pharmacies bought the same products through GIT-I/II/III -- GIT_SALES is a
mirror of those sales (same SKUs, same customers; see
claude/git_sales_line_excluded_from_git_bu_2026-11-05.md). So "previous sales"
= the GIT_SALES brand basket bought by these pharmacies through the GIT BU
lines in the months BEFORE the first GIT_SALES month; from that month on, the
GIT_SALES line itself. The months' source is written to meta.monthSource and
the overlap month is reconciled (meta.reconciliation) and logged.

Inputs  : ZETA SALES_2026/GIT_SALES_SPCEIAL PHARMACIES.xlsx (Sheet1, focus list)
          ZETA SALES_2026/{Q1_Sales, Q2_Sales, june, Q3_SALES}.xlsx (same non-CHC
          actual sources and actual-row rule as refresh_sales.py)
Output  : cache/focus_pharmacies.data.js  (window.FOCUS_PHARMACIES_CACHE)
Join    : focus list "Customer Name" prefix before "_" (e.g. 1000000002_...) ==
          sales CustomerID. Rep / DM / territory come from the focus list.
Run     : python etl/build_focus_pharmacies_cache.py   (UPDATE_DASHBOARD step
          "focus_pharmacies"; ~1-2 min, needs python-calamine)
"""
import os, sys, json, time, datetime, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALES_DIR = os.path.join(ROOT, 'ZETA SALES_2026')
LIST_XLSX = os.path.join(SALES_DIR, 'GIT_SALES_SPCEIAL PHARMACIES.xlsx')
OUT = os.path.join(ROOT, 'cache', 'focus_pharmacies.data.js')
SOURCES = [  # same actual sources as refresh_sales.py SOURCES (non-CHC)
    ('q1', 'Q1_Sales.xlsx', 'SalesPerDistributor'),
    ('q2', 'Q2_Sales.xlsx', 'SalesPerDistributor'),
    ('june', 'june.xlsx', 'SalesPerDistributor'),
    ('q3', 'Q3_SALES.xlsx', 'July-Sep'),
]
FOCUS_LINE = 'GIT_SALES'
GIT_BU_LINES = {'GIT-I', 'GIT-II', 'GIT-III', 'DERMA', 'NEUROSCIENCE', 'CNS', 'GIT I', 'GIT II', 'GIT III'}
YEAR = 2026


def norm_name(s): return ' '.join(str(s or '').upper().split())


def terr_key(s): return ''.join(ch for ch in str(s or '').upper() if ch.isalnum())


def match_terr(pos, reps, rep_terr):
    """Sales Position -> index of the focus-list rep holding that territory. Exact match ignoring spaces /
    punctuation first ("DAKHLEIAH-A- DOMIAT" = "DAKHLEIAH-A-DOMIAT", "NEWCAIRO" = "NEW CAIRO"), then a
    unique prefix match either way (sales "GIT-S DAKHLEIAH-A" <-> list "GIT-S DAKHLEIAH-A-DOMIAT-...")."""
    k = terr_key(pos)
    if not k: return -1
    keys = [(i, terr_key(rep_terr[r].most_common(1)[0][0])) for i, r in enumerate(reps)]
    ex = [i for i, t in keys if t == k]
    if len(ex) == 1: return ex[0]
    pre = [i for i, t in keys if t and (t.startswith(k) or k.startswith(t))]
    if len(pre) == 1: return pre[0]
    if pre:   # several: the longest common territory name wins
        return max(pre, key=lambda i: len(keys[i][1]) if k.startswith(keys[i][1]) else len(k))
    return -1


def log(m): print('  ' + m, flush=True)


def fail(m):
    print('ERROR: ' + m, flush=True); sys.exit(1)


try:
    from python_calamine import CalamineWorkbook
except ImportError:
    fail('python_calamine not found. Run: pip install python-calamine')


def cid_str(v):
    if v is None or v == '': return ''
    if isinstance(v, float) and v.is_integer(): v = int(v)
    s = str(v).strip()
    return s[:-2] if s.endswith('.0') and s[:-2].isdigit() else s


def month_of(v):
    if isinstance(v, (datetime.date, datetime.datetime)): return '%04d-%02d' % (v.year, v.month)
    s = str(v).strip()
    if isinstance(v, float) and v.is_integer(): s = str(int(v))
    d = ''.join(ch for ch in s if ch.isdigit())
    if len(d) >= 6 and d[:2] == '20': return d[:4] + '-' + d[4:6]
    return None


def num(v):
    try: return float(v) if v not in (None, '') else 0.0
    except (TypeError, ValueError): return 0.0


def is_actual(ti, val, tval):
    """refresh_sales.py process_source() rule: TargetIndex 'Sales' (or a value with
    no target value) = actual; Original/Buffer/0/1 = target row; blank = actual."""
    if ti in (None, ''): return True
    s = str(ti).strip().lower()
    if s == 'sales' or (val != 0.0 and tval == 0.0): return True
    return False


def header(it):
    for _ in range(5):
        h = next(it)
        if h and not all(c in (None, '') for c in h):
            return {str(c).strip(): i for i, c in enumerate(h) if c not in (None, '')}
    fail('no header row')


def load_list():
    if not os.path.exists(LIST_XLSX): fail('focus list missing: ' + LIST_XLSX)
    wb = CalamineWorkbook.from_path(LIST_XLSX)
    it = iter(wb.get_sheet_by_name(wb.sheet_names[0]).to_python())
    ix = header(it)
    need = ['Target', 'Code', 'Customer Name', 'Geographical Area Name', 'New Frequency', 'Employee Name', 'Profile', 'Manager Name']
    miss = [k for k in need if k not in ix]
    if miss: fail('focus list columns missing: ' + ', '.join(miss))
    ph, seen, dup, off = [], {}, 0, 0
    for r in it:
        if not r or all(c in (None, '') for c in r): continue
        if str(r[ix['Target']]).strip().lower() not in ('true', '1', 'yes'):
            off += 1; continue
        name = str(r[ix['Customer Name']] or '').strip()
        cid = cid_str(name.split('_', 1)[0]) if '_' in name else ''
        if not cid:
            off += 1; continue
        if cid in seen:
            dup += 1; continue
        seen[cid] = len(ph)
        ph.append({'cid': cid, 'code': cid_str(r[ix['Code']]), 'name': name.split('_', 1)[1].strip() if '_' in name else name,
                   'area': str(r[ix['Geographical Area Name']] or '').strip(), 'freq': num(r[ix['New Frequency']]),
                   'rep': str(r[ix['Employee Name']] or '').strip() or '(unassigned)',
                   'terr': str(r[ix['Profile']] or '').strip(), 'dm': str(r[ix['Manager Name']] or '').strip() or '(none)'})
    log(f'focus list: {len(ph):,} pharmacies (skipped {dup} duplicate customer ids, {off} not targeted/no id)')
    return ph, seen


# GIT-S TEAM TARGET vs ACTUAL (2026-11-05, Ahmed "add the target of them"): GIT_SALES targets are
# per rep (Emp1Name) x item x month -- TargetIndex Original = Official, Buffer = Working, same
# rule as refresh_sales.py -- and cover the rep's WHOLE GIT_SALES business, not only the focus
# list. Actuals are collected for every GIT_SALES customer so achievement can be shown both
# for all customers and for the focus pharmacies.
TEAM_T = collections.defaultdict(lambda: [0.0, 0.0])          # (rep, month, brand, item) -> [official, working]
TEAM_A = collections.defaultdict(float)                        # (rep, cid, month, brand, item) -> net value


def scan(path, sheet, ids, agg, focus_reps, brands_focus):
    t = time.time()
    ws = CalamineWorkbook.from_path(path).get_sheet_by_name(sheet)
    it = ws.iter_rows(); ix = header(it)
    for k in ('Date', 'Line', 'Brand', 'CustomerID', 'Value'):
        if k not in ix: fail(f'{os.path.basename(path)}: column {k} missing')
    iD, iL, iB, iC, iV = ix['Date'], ix['Line'], ix['Brand'], ix['CustomerID'], ix['Value']
    iI = ix.get('Item')
    iQ, iTI, iTV, iE1 = ix.get('Quantity'), ix.get('TargetIndex'), ix.get('TargetValue'), ix.get('Emp1Name')
    iTT = ix.get('TransactionType')
    iPos = ix.get('Position')
    iST = ix.get('SubType')   # 2026-11-05 (Ahmed): GIT_SALES actuals = sub type GIT_SALES only
    n = kept = 0
    for r in it:
        n += 1
        line = str(r[iL] or '').strip().upper()
        is_focus = line == FOCUS_LINE
        if not is_focus and line not in GIT_BU_LINES: continue
        cid = cid_str(r[iC])
        if is_focus and iST is not None and iST < len(r) and is_actual(r[iTI] if iTI is not None and iTI < len(r) else None, num(r[iV]), num(r[iTV]) if iTV is not None and iTV < len(r) else 0.0) \
                and str(r[iST] or '').strip().upper() != FOCUS_LINE:
            continue   # GIT_SALES actual booked on another sub type = copy of GIT sales, not GIT-S business
        if is_focus:   # GIT-S team target / actual, every customer
            tv = num(r[iTV]) if iTV is not None and iTV < len(r) else 0.0; vv = num(r[iV])
            ti = r[iTI] if iTI is not None and iTI < len(r) else None
            mm = month_of(r[iD]); bb = str(r[iB] or '').strip().upper() or '(NONE)'
            itm = (str(r[iI] or '').strip().upper() if iI is not None else '') or bb
            # keyed by POSITION (territory): the focus list may name the new holder of a position the sales
            # file still calls VACANT (e.g. GIT-S FAYOUM-BANI SUEF-MENYA) -- matching on the rep name would miss it
            rep = (str(r[iPos] or '').strip() if iPos is not None and iPos < len(r) else '') or (str(r[iE1] or '').strip() if iE1 is not None else '')
            if mm and mm.startswith(str(YEAR)):
                if is_actual(ti, vv, tv):
                    TEAM_A[(rep, cid, mm, bb, itm)] += vv
                else:
                    sti = str(ti).strip().lower()
                    if sti in ('original', '1', '1.0'): TEAM_T[(rep, mm, bb, itm)][0] += tv
                    elif sti in ('buffer', '0', '0.0'): TEAM_T[(rep, mm, bb, itm)][1] += tv
        if cid not in ids: continue
        val = num(r[iV]); tval = num(r[iTV]) if iTV is not None and iTV < len(r) else 0.0
        if not is_actual(r[iTI] if iTI is not None and iTI < len(r) else None, val, tval): continue
        m = month_of(r[iD])
        if not m or not m.startswith(str(YEAR)): continue
        brand = str(r[iB] or '').strip().upper() or '(NONE)'
        item = (str(r[iI] or '').strip().upper() if iI is not None else '') or brand
        a = agg[('F' if is_focus else 'G', cid, m, (brand, item))]
        a[0] += val; a[1] += num(r[iQ]) if iQ is not None and iQ < len(r) else 0.0; a[2] += 1
        tt = str(r[iTT] or '').lower() if iTT is not None and iTT < len(r) else ''
        if 'return' in tt or (not tt and val < 0): a[3] += val   # returns (negative)
        if is_focus:
            brands_focus.add((brand, item))
            if iE1 is not None: focus_reps[(cid, str(r[iE1] or '').strip())] += 1
        kept += 1
    log(f'{os.path.basename(path)}: {n:,} rows scanned, {kept:,} focus-pharmacy GIT rows kept ({time.time() - t:.0f}s)')


def main():
    t0 = time.time()
    ph, ids = load_list()
    agg = collections.defaultdict(lambda: [0.0, 0.0, 0, 0.0])   # net value, qty, rows, returns value
    focus_reps = collections.Counter(); brands_focus = set(); src_used = []
    for tag, fn, sh in SOURCES:
        p = os.path.join(SALES_DIR, fn)
        if not os.path.exists(p): fail('source missing: ' + p)
        scan(p, sh, ids, agg, focus_reps, brands_focus); src_used.append(fn)
    f_months = sorted({k[2] for k in agg if k[0] == 'F'})
    if not f_months: fail('no GIT_SALES rows found for the focus pharmacies')
    launch = f_months[0]
    all_months = sorted({k[2] for k in agg})
    months = [m for m in all_months if m <= f_months[-1]]
    basket = set(brands_focus)                       # SKU basket mirrored by GIT_SALES
    brands = sorted({b for b, _ in basket})
    bidx = {b: i for i, b in enumerate(brands)}
    items = sorted(basket, key=lambda x: (x[0], x[1]))     # (brand, item) -- 2026-11-05 brand & item detail
    iidx = {bi: i for i, bi in enumerate(items)}
    XD = collections.defaultdict(lambda: [0.0, 0.0, 0.0])   # (pharmacy, month, item) -> net value, qty, returns
    src_of = {m: ('GIT_SALES' if m >= launch else 'GIT lines (GIT_SALES basket)') for m in months}
    mi = {m: i for i, m in enumerate(months)}
    NM = len(months)
    V = [[0] * NM for _ in ph]; Q = [[0] * NM for _ in ph]; K = [[0] * NM for _ in ph]; R = [[0] * NM for _ in ph]
    rec = collections.defaultdict(lambda: [0.0, 0.0])   # month -> [GIT_SALES, GIT-lines basket] where both exist
    for (s, cid, m, b), a in agg.items():
        if m not in mi or b not in basket: continue    # baseline restricted to the GIT_SALES SKU basket
        bi = bidx[b[0]]
        if s == 'G' and m >= launch: rec[m][1] += a[0] - a[3]   # gross sales (returns excluded) for the overlap check
        if s == 'F': rec[m][0] += a[0] - a[3]
        use = (s == 'F') if m >= launch else (s == 'G')
        if not use: continue
        p, k = ids[cid], mi[m]
        V[p][k] += a[0]; Q[p][k] += a[1]; R[p][k] += a[3]
        x = XD[(p, k, iidx[b])]; x[0] += a[0]; x[1] += a[1]; x[2] += a[3]
        if a[0] > 0: K[p][k] |= (1 << bi)
    for p in range(len(ph)):
        V[p] = [round(x) for x in V[p]]; Q[p] = [round(x, 1) for x in Q[p]]; R[p] = [round(x) for x in R[p]]
    big = sorted(((R[p][k], p, k) for p in range(len(ph)) for k in range(NM) if R[p][k] <= -1000000))
    big_returns = [{'cid': ph[p]['cid'], 'name': ph[p]['name'], 'month': months[k], 'returns': r, 'net': V[p][k]} for r, p, k in big]
    for b in big_returns: log(f"LARGE RETURN: {b['cid']} {b['name']} {b['month']}: returns {b['returns']:,} (net {b['net']:,})")
    recon = {m: {'gitSales': round(v[0]), 'gitLinesBasket': round(v[1]), 'ratio': round(v[0] / v[1], 3) if v[1] else None} for m, v in sorted(rec.items())}
    for m, r in recon.items():
        log(f'reconciliation {m} (gross sales, returns excluded): GIT_SALES {r["gitSales"]:,} vs GIT-lines basket {r["gitLinesBasket"]:,} at focus pharmacies (ratio {r["ratio"]})')
    # who actually booked the GIT_SALES rows vs the assigned rep (data-quality info only)
    booked = collections.defaultdict(collections.Counter)
    for (cid, rep), c in focus_reps.items(): booked[cid][rep] += c
    other = sum(1 for cid, c in booked.items() if ph[ids[cid]]['rep'] not in c)
    reps = sorted({x['rep'] for x in ph}); dms = sorted({x['dm'] for x in ph})
    ri = {r: i for i, r in enumerate(reps)}; di = {d: i for i, d in enumerate(dms)}
    rep_dm, rep_terr = {}, {}
    for x in ph:
        rep_dm.setdefault(x['rep'], collections.Counter())[x['dm']] += 1
        rep_terr.setdefault(x['rep'], collections.Counter())[x['terr']] += 1
    out = {
        'meta': {'generated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), 'months': months, 'launchMonth': launch,
                 'baselineMonths': [m for m in months if m < launch], 'monthSource': src_of, 'brands': brands, 'basketSkus': sorted(i for _, i in basket),
                 'listFile': os.path.basename(LIST_XLSX), 'listRows': len(ph), 'sources': src_used,
                 'reconciliation': recon, 'bookedByOtherRep': other, 'largeReturns': big_returns,
                 'rules': {'active': 'net GIT_SALES value > 0 in the month', 'repeat': 'active in >= 2 months of the selected period',
                           'baseline': 'average month before launch (GIT_SALES basket via GIT lines)'}},
        'reps': [{'n': r, 'dm': di[rep_dm[r].most_common(1)[0][0]], 'terr': rep_terr[r].most_common(1)[0][0]} for r in reps],
        'dms': dms,
        'ph': [[x['cid'], x['name'], x['area'], ri[x['rep']], x['freq']] for x in ph],
        'v': V, 'q': Q, 'k': K, 'r': R,
        # brand / item detail: items = [item, brandIdx]; x = flat [pharmacy, month, item, net value, qty, returns] * n
        'items': [[it, bidx[br]] for br, it in items],
        'x': [z for (p_, k_, i_), a in sorted(XD.items()) if a[0] or a[1] or a[2] for z in (p_, k_, i_, round(a[0]), round(a[1], 1), round(a[2]))],
    }
    # ---- GIT-S team target vs actual
    cm = collections.defaultdict(float)
    for (rep, cid, m, b, it), v in TEAM_A.items(): cm[(cid, m)] += v
    big_cm = {k for k, v in cm.items() if abs(v) >= 1000000}     # same outlier rule as the tab (|net| >= EGP 1M in a month)
    treps = sorted({k[0] for k in TEAM_T} | {k[0] for k in TEAM_A})
    tri = {x: i for i, x in enumerate(treps)}
    titems = sorted({(k[2], k[3]) for k in TEAM_T} | {(k[3], k[4]) for k in TEAM_A})
    tii = {x: i for i, x in enumerate(titems)}
    TA = collections.defaultdict(lambda: [0.0, 0.0, 0.0])        # (rep, month, item) -> [all excl. outliers, focus excl. outliers, all raw]
    for (rep, cid, m, b, it), v in TEAM_A.items():
        if m not in mi: continue
        a = TA[(tri[rep], mi[m], tii[(b, it)])]; a[2] += v
        if (cid, m) in big_cm: continue
        a[0] += v
        if cid in ids: a[1] += v
    out['team'] = {
        'reps': treps,
        'focusRep': [match_terr(x, reps, rep_terr) for x in treps],   # sales position -> focus-list rep of that territory
        'items': [[it, b] for b, it in titems],
        't': [z for (rep, m, b, it), a in sorted(TEAM_T.items()) if m in mi and (a[0] or a[1]) for z in (tri[rep], mi[m], tii[(b, it)], round(a[0]), round(a[1]))],
        'a': [z for (ri_, k, ii), a in sorted(TA.items()) for z in (ri_, k, ii, round(a[0]), round(a[1]), round(a[2]))],
        'outlierCustomerMonths': [{'cid': c, 'month': m, 'net': round(cm[(c, m)])} for c, m in sorted(big_cm)],
        'rules': {'official': 'TargetIndex Original', 'working': 'TargetIndex Buffer', 'actual': 'GIT_SALES net sales, customer-months with |net| >= EGP 1M excluded'},
    }
    tt = [sum(a[0] for k, a in TEAM_T.items() if k[1] == m) for m in months]
    for m, t_ in zip(months, tt):
        if t_:
            act = sum(a[0] for (ri_, k, ii), a in TA.items() if months[k] == m); raw = sum(a[2] for (ri_, k, ii), a in TA.items() if months[k] == m)
            log(f'GIT-S team {m}: Official target {t_:,.0f} | actual excl. outliers {act:,.0f} ({act / t_ * 100:.0f}%) | raw {raw:,.0f} | {len([1 for c in big_cm if c[1] == m])} outlier customer(s)')
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('// generated by etl/build_focus_pharmacies_cache.py -- do not edit\n')
        f.write('window.FOCUS_PHARMACIES_CACHE = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
    os.replace(tmp, OUT)
    act = [sum(1 for p in range(len(ph)) if V[p][k] > 0) for k in range(NM)]
    log('active focus pharmacies by month: ' + ', '.join(f'{m} {a:,}' for m, a in zip(months, act)))
    log(f'GIT_SALES rows booked by a rep other than the assigned one: {other:,} pharmacies')
    log(f'brand / item detail: {len(items)} items, {len(out["x"]) // 6:,} pharmacy-month-item records')
    log(f'wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) / 1e6:.2f} MB) in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
