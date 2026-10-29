"""
ZETA IQVIA Intelligence — Unified Cache Compiler Script
====================================================
Reads IQVIA raw workbooks from iqvia_source/ using calamine,
compresses the market flat records, aggregates target market share,
loads allowed users database, and outputs cached JSON/JS payloads.

Usage:  python refresh_iqvia.py
"""

import os, sys, gzip, base64, json, re, time
from datetime import datetime

# Path setup
ROOT_DIR      = os.path.dirname(os.path.abspath(__file__))
SOURCE_XLSX   = os.path.join(ROOT_DIR, 'iqvia_source', 'IQVIA_SOURCE.xlsx')
TARGET_XLSX   = os.path.join(ROOT_DIR, 'iqvia_source', 'TARGET_MARKET_SHARE.xlsx')
USER_CONFIG    = os.path.join(ROOT_DIR, 'iqvia_source', 'config', 'Zeta_Dashboard_User_Config.xlsx')
DM1_CORRECTIONS_FILE = os.path.join(ROOT_DIR, 'iqvia_source', 'config', 'dm1_corrections.json')
PRODUCT_MARKET_OVERRIDES_FILE = os.path.join(ROOT_DIR, 'iqvia_source', 'config', 'product_market_overrides.json')

OUTPUT_JSON   = os.path.join(ROOT_DIR, 'cache', 'iqvia.json')
OUTPUT_JS     = os.path.join(ROOT_DIR, 'cache', 'iqvia.data.js')

SHEET_NAME    = 'Egypt Combined Data'
NEEDED_COLS   = ['ATC4','Corporation','Product','Period',
                 'LC Value','Standard Units Sales',
                 'Line','BU','DEFIND Market_1','DEFIND Market_2','Pack Size','Molecule',
                 'standard dosage form', 'Item', 'Strength']

def parse_period(s):
    if hasattr(s, 'strftime'):
        return s.strftime('%Y-%m')
    s = str(s).strip()
    s = s.split(' ')[0].split('T')[0]
    for fmt in ('%b-%y', '%b-%Y', '%Y-%m-%d', '%Y-%m', '%m/%d/%Y', '%d/%m/%Y'):
        try: return datetime.strptime(s, fmt).strftime('%Y-%m')
        except: pass
    m = re.match(r'^(\d{4})-(\d{2})', s)
    if m: return f'{m.group(1)}-{m.group(2)}'
    return s

def build_lookup(lst):
    cats = sorted(set(lst))
    cat_map = {v: i for i, v in enumerate(cats)}
    return [cat_map[v] for v in lst], cats

def log(msg): print(f'  {msg}', flush=True)

# ── 1. Load Market Data ──────────────────────────────────────────────────────
print('\n[1/4] Loading IQVIA data...', flush=True)
t0 = time.time()
try:
    from python_calamine import CalamineWorkbook
except ImportError:
    print('ERROR: python_calamine not found. Run: pip install python-calamine')
    sys.exit(1)

log(f'Reading Excel with calamine: {SOURCE_XLSX}')
wb = CalamineWorkbook.from_path(SOURCE_XLSX)
ws = wb.get_sheet_by_name(SHEET_NAME)
all_rows = ws.to_python(skip_empty_area=False)
header = [str(c).strip() if c else '' for c in all_rows[0]]
col = {n: header.index(n) if n in header else -1 for n in NEEDED_COLS}
log(f'Loaded {len(all_rows)-1:,} rows in {time.time()-t0:.1f}s')

# ── 2. Clean & Process ───────────────────────────────────────────────────────
print('\n[2/4] Processing IQVIA rows...', flush=True)
corps_r, prods_r, periods_r, atc4s_r = [], [], [], []
dm1s_r, dm2s_r, lines_r, bus_r, lcvs_r, sus_r = [], [], [], [], [], []
molecules_r = []
doses_r = []
items_r = []
strengths_r = []
from collections import defaultdict as _dd
_prod_su_by_pack = _dd(lambda: _dd(float))
_item_su_by_pack = _dd(lambda: _dd(float))   # 2026-10-29 (Ahmed: Market Intelligence SU / LCV / Packs): pack size per Item

for row in all_rows[1:]:
    def g(n):
        c = col[n]; return str(row[c]).strip() if c >= 0 and len(row) > c and row[c] is not None else ''
    corp=g('Corporation'); prod=g('Product'); period=g('Period'); atc4=g('ATC4')
    if not corp or not prod or not period or not atc4: continue
    try: lcv = float(g('LC Value') or 0)
    except: lcv = 0
    try: su = float(g('Standard Units Sales') or 0)
    except: su = 0
    if lcv <= 0: continue
    corps_r.append(corp); prods_r.append(prod)
    periods_r.append(parse_period(period)); atc4s_r.append(atc4)
    dm1s_r.append(g('DEFIND Market_1') or '(none)')
    dm2s_r.append(g('DEFIND Market_2') or '(none)')
    molecules_r.append(g('Molecule') or '(none)')
    doses_r.append(g('standard dosage form') or '(none)')
    items_r.append(g('Item') or '(none)')
    strengths_r.append(g('Strength') or '(none)')
    lines_r.append(g('Line') or '(none)'); bus_r.append(g('BU') or '(none)')
    lcvs_r.append(int(lcv)); sus_r.append(int(su))
    try:
        ps = float(g('Pack Size') or 0)
        if ps > 0: _prod_su_by_pack[prod][ps] += su; _item_su_by_pack[g('Item') or '(none)'][ps] += max(su, 1)
    except: pass

log(f'{len(corps_r):,} rows after cleaning')

# ── 2b. ATC4 HISTORICAL BACKFILL (2026-09-04) ───────────────────────────────
# 9 ATC4 categories were found to have only the latest month (2026-07) of
# history in IQVIA_SOURCE.xlsx -- growth/trend were structurally impossible
# for them (no prior period to compare against). A raw IQVIA export
# ("Egypt_Combined_Data monthly report_Sep-02-2026 (1).xlsx") was confirmed
# to contain the FULL correct history (2021-08..2026-07) for exactly these
# 9 categories, but that raw export lacks the DEFIND Market_1/2, Line, BU
# and Molecule columns Zeta's own mapping process adds. Since every single
# row already in IQVIA_SOURCE.xlsx for these 9 ATC4s maps to DM1=DM2=
# 'OTHER MARKET' (confirmed 100% consistent across 146 products / 325 rows --
# these are all non-target/residual therapeutic categories), missing
# historical rows are backfilled with that same mapping, keyed by Product
# name against products already seen for these ATC4s in the current data.
# Products with no match here (discontinued/renamed brands, ~13% of backfill
# rows) fall back to DM1=DM2='OTHER MARKET', Line=BU='Other Markets',
# Molecule='(none)' -- consistent with this script's existing missing-value
# convention -- rather than guessing at a molecule from the brand name.
BACKFILL_XLSX = os.path.join(ROOT_DIR, 'iqvia_source', 'Egypt_Combined_Data monthly report_Sep-02-2026 (1).xlsx')
BACKFILL_ATC4 = {
    'B03A1 IRON PLAIN', 'C09D9 AT2 ANTG COMB OTH DRUGS', 'G03A1 MONOPHAS PREPS<50MCG OEST',
    'H01C1 GONADOTROP-RELEAS HORM', 'L02A3 CYTO GONAD HORMON ANALOG', 'L04D0 JAK INHIBITORS',
    'M01C0 SPEC ANTIRHEUMATIC AGENT', 'N02A0 NARCOTIC ANALGESICS', 'N07X0 ALL OTHER CNS DRUGS',
}
if os.path.exists(BACKFILL_XLSX):
    print('\n[2b/4] Backfilling missing ATC4 history...', flush=True)
    from collections import Counter as _Counter
    _prod_map = _dd(lambda: {'dm1': _Counter(), 'dm2': _Counter(), 'line': _Counter(), 'bu': _Counter(), 'mol': _Counter(), 'dose': _Counter(), 'item': _Counter(), 'strength': _Counter()})
    _existing_atc4_periods = set()
    for i in range(len(corps_r)):
        if atc4s_r[i] in BACKFILL_ATC4:
            _existing_atc4_periods.add((atc4s_r[i], periods_r[i]))
            m = _prod_map[prods_r[i]]
            m['dm1'][dm1s_r[i]] += 1; m['dm2'][dm2s_r[i]] += 1
            m['line'][lines_r[i]] += 1; m['bu'][bus_r[i]] += 1
            m['mol'][molecules_r[i]] += 1; m['dose'][doses_r[i]] += 1
            m['item'][items_r[i]] += 1; m['strength'][strengths_r[i]] += 1
    try:
        _bwb = CalamineWorkbook.from_path(BACKFILL_XLSX)
        _bws = _bwb.get_sheet_by_name(SHEET_NAME)
        _brows = _bws.to_python(skip_empty_area=False)
        _bheader = [str(c).strip() if c else '' for c in _brows[0]]
        _bcol = {n: _bheader.index(n) if n in _bheader else -1 for n in ['ATC4','Corporation','Product','Period','LC Value','Units','Pack','Strength','NFC3']}
        # 2026-09-22: reference lookups from IQVIA_SOURCE.xlsx itself, used to fill
        # Item / Dosage Form / Strength / Molecule for backfill products that have
        # no match in the master (previously all '(none)'). Same rules the master uses:
        # Item = Product + Pack (no separator); Dosage Form = NFC3_Form_Map[NFC3];
        # Molecule = Molecule sheet by Product.
        _nfc3_map, _mol_map = {}, {}
        try:
            for r in wb.get_sheet_by_name('NFC3_Form_Map').to_python()[1:]:
                if r and r[0] and len(r) > 2 and r[2]: _nfc3_map[str(r[0]).strip()] = str(r[2]).strip()
        except Exception as _e: log(f'WARNING: NFC3_Form_Map not loaded ({_e})')
        try:
            for r in wb.get_sheet_by_name('Molecule').to_python()[1:]:
                if r and r[0] and len(r) > 1 and r[1]: _mol_map.setdefault(str(r[0]).strip(), str(r[1]).strip())
        except Exception as _e: log(f'WARNING: Molecule sheet not loaded ({_e})')
        _ref_filled = 0
        def _bg(row, n):
            c = _bcol[n]; return str(row[c]).strip() if c >= 0 and len(row) > c and row[c] is not None else ''
        _added, _added_periods, _unmapped_rows = 0, set(), 0
        for row in _brows[1:]:
            atc4 = _bg(row, 'ATC4')
            if atc4 not in BACKFILL_ATC4: continue
            period = parse_period(_bg(row, 'Period'))
            if (atc4, period) in _existing_atc4_periods: continue  # already covered by master file
            corp = _bg(row, 'Corporation'); prod = _bg(row, 'Product')
            if not corp or not prod: continue
            try: lcv = float(_bg(row, 'LC Value') or 0)
            except: lcv = 0
            if lcv <= 0: continue
            try: su = float(_bg(row, 'Units') or 0)
            except: su = 0
            m = _prod_map.get(prod)
            if m:
                dm1 = m['dm1'].most_common(1)[0][0]; dm2 = m['dm2'].most_common(1)[0][0]
                line = m['line'].most_common(1)[0][0]; bu = m['bu'].most_common(1)[0][0]
                mol = m['mol'].most_common(1)[0][0]; dose = m['dose'].most_common(1)[0][0]
                item = m['item'].most_common(1)[0][0] if m['item'] else '(none)'
                strength = m['strength'].most_common(1)[0][0] if m['strength'] else '(none)'
            else:
                dm1, dm2, line, bu, mol, dose, item, strength = 'OTHER MARKET', 'OTHER MARKET', 'Other Markets', 'Other Markets', '(none)', '(none)', '(none)', '(none)'
                _unmapped_rows += 1
                _pack = _bg(row, 'Pack')
                if _pack: item = prod + _pack
                strength = _bg(row, 'Strength') or '(none)'
                dose = _nfc3_map.get(_bg(row, 'NFC3'), '(none)')
                mol = _mol_map.get(prod, '(none)')
                if item != '(none)' and dose != '(none)': _ref_filled += 1
            corps_r.append(corp); prods_r.append(prod)
            periods_r.append(period); atc4s_r.append(atc4)
            dm1s_r.append(dm1); dm2s_r.append(dm2)
            molecules_r.append(mol); doses_r.append(dose)
            items_r.append(item); strengths_r.append(strength)
            lines_r.append(line); bus_r.append(bu)
            lcvs_r.append(int(lcv)); sus_r.append(int(su))
            _added += 1; _added_periods.add(period)
        log(f'Backfilled {_added:,} rows across {len(_added_periods)} periods for {len(BACKFILL_ATC4)} ATC4 markets ({_unmapped_rows:,} rows used default OTHER MARKET/(none) mapping, no product match; {_ref_filled:,} of those got Item/Dosage Form from the combined report Pack/NFC3)')
    except Exception as e:
        log(f'WARNING: ATC4 backfill skipped ({e})')
else:
    log('Backfill source file not found -- skipping ATC4 historical backfill')

# ── 2c. LIKE-FOR-LIKE CORPORATE RESTATEMENT (2026-09-24) ─────────────────────
# Products that changed corporate owner (e.g. SANOFI -> OPELLA* in 2026-01) are
# relabelled to their CURRENT owner across ALL history, so prior-year vs
# current comparisons are like-for-like and an ownership transfer does not
# appear as infinite growth for the new owner / a collapse for the old one.
# Mapping lives in iqvia_source/config/corp_restatements.json (documented,
# approval-stamped, individually switchable). Raw IQVIA_SOURCE.xlsx is NOT
# modified -- rows are relabelled in memory only. Reverse: set enabled=false
# in the JSON and re-run this script. Runs AFTER the ATC4 backfill (2b) so
# backfilled history is restated the same way.
CORP_RESTATEMENTS_FILE = os.path.join(ROOT_DIR, 'iqvia_source', 'config', 'corp_restatements.json')
_restatement_log = []
if os.path.exists(CORP_RESTATEMENTS_FILE):
    try:
        _rs_cfg = json.load(open(CORP_RESTATEMENTS_FILE, encoding='utf-8'))
        if _rs_cfg.get('enabled', True):
            print('\n[2c/4] Applying like-for-like corporate restatements...', flush=True)
            _mismatch = 0
            for _r in _rs_cfg.get('restatements', []):
                _rid = _r.get('id')
                if not _r.get('enabled', True):
                    log(f"Restatement {_rid} disabled -- skipped"); continue
                # 2026-09-24 (schema v2): only APPROVED entries are applied.
                if _r.get('status', '') != 'approved':
                    log(f"Restatement {_rid} status={_r.get('status','(missing)')!r} -- not approved, skipped"); continue
                _fc, _tc = _r['from_corporation'], _r['to_corporation']
                _prods = set(_r.get('products', []))
                _pf, _pt = _r.get('apply_period_from'), _r.get('apply_period_to')   # optional inclusive YYYY-MM bounds
                _n = 0; _lcv = 0; _pers = set(); _seen = set()
                for i in range(len(corps_r)):
                    if prods_r[i] in _prods and corps_r[i] in (_fc, _tc): _seen.add(prods_r[i])
                    if corps_r[i] == _fc and prods_r[i] in _prods:
                        _per = str(periods_r[i])
                        if (_pf and _per < _pf) or (_pt and _per > _pt): continue
                        corps_r[i] = _tc; _n += 1; _lcv += lcvs_r[i]; _pers.add(_per)
                _missing = sorted(_prods - _seen)
                _bound = f" [bounded {_pf or '*'}..{_pt or '*'}]" if (_pf or _pt) else ''
                log(f"Restatement {_rid} ({_r.get('classification','')}): {_fc} -> {_tc}{_bound}, {len(_prods)} product(s), {_n:,} rows relabelled, LCV {_lcv:,.0f}, periods {min(_pers) if _pers else '-'}..{max(_pers) if _pers else '-'}")
                if _missing: log(f"WARNING: restatement {_rid} products not found under {_fc}/{_tc}: {_missing}")
                _exp_r, _exp_v = _r.get('expected_rows'), _r.get('expected_lcv')
                _ok = (_exp_r is None or _exp_r == _n) and (_exp_v is None or _exp_v == _lcv)
                if not _ok:
                    _mismatch += 1
                    log(f"WARNING: restatement {_rid} audit MISMATCH -- expected {_exp_r} rows / LCV {_exp_v}, got {_n} / {_lcv}. The source changed under this mapping: re-review before release.")
                _restatement_log.append({'id': _rid, 'classification': _r.get('classification', ''), 'status': _r.get('status'),
                                         'from': _fc, 'to': _tc, 'products': sorted(_prods),
                                         'rows': _n, 'lcv': _lcv, 'periods': [min(_pers), max(_pers)] if _pers else [],
                                         'bounds': [_pf, _pt] if (_pf or _pt) else None,
                                         'effective': _r.get('transfer_effective_period', ''), 'missing': _missing,
                                         'expected_rows': _exp_r, 'expected_lcv': _exp_v, 'audit_ok': _ok})
            log(f"Restatement audit: {len(_restatement_log)} applied, {_mismatch} mismatch(es)")
        else:
            log('Corporate restatements disabled in config -- skipped')
    except Exception as e:
        log(f'WARNING: corporate restatements skipped ({e})')
else:
    log('No corp_restatements.json -- corporate restatement step skipped')

# -- 2d. PRODUCT-LEVEL MARKET OVERRIDES (2026-10-09, Ahmed: option B) ----------
# iqvia_source/config/product_market_overrides.json pins named products / molecules
# to their defined market (DM1/DM2/Line/BU) whatever the source's DEFIND columns
# say, so a regenerated Market Mapping sheet cannot silently push them back to
# OTHER MARKET. Logged per rule; a rule that matches nothing is a WARNING.
if os.path.exists(PRODUCT_MARKET_OVERRIDES_FILE):
    try:
        _pmo = json.load(open(PRODUCT_MARKET_OVERRIDES_FILE, encoding='utf-8'))
        if _pmo.get('enabled', True):
            print('\n[2d/4] Applying product-level market overrides...', flush=True)
            for _r in _pmo.get('overrides', []):
                _prods = set(_r.get('products') or [])
                _mol = (_r.get('molecule_contains') or '').upper()
                _doses = set(str(x).upper() for x in (_r.get('doses') or []))
                _strs = set(str(x).upper() for x in (_r.get('strengths') or []))   # 2026-10-16: optional strength filter (e.g. adult 20/40MG sachets)
                _atcs = tuple(str(x).upper().strip() for x in (_r.get('atc4_prefixes') or []))   # 2026-10-26: optional ATC4 filter (prefix, e.g. 'A11A2')
                _pf = _r.get('period_from') or ''; _pt = _r.get('period_to') or ''
                _n = 0; _v = 0; _moved = 0
                for _i in range(len(prods_r)):
                    if _prods and prods_r[_i] not in _prods: continue
                    if _mol and _mol not in str(molecules_r[_i]).upper(): continue
                    if _doses and str(doses_r[_i]).upper() not in _doses: continue  # source says 'Tablet', cache shows 'TABLET'
                    if _strs and str(strengths_r[_i]).upper() not in _strs: continue
                    if _atcs and not str(atc4s_r[_i]).upper().startswith(_atcs): continue
                    _per = str(periods_r[_i])[:7]
                    if _pf and _per < _pf: continue
                    if _pt and _per > _pt: continue
                    if dm1s_r[_i] != _r['dm1']: _moved += 1
                    dm1s_r[_i] = _r['dm1']; dm2s_r[_i] = _r.get('dm2', _r['dm1'])
                    if _r.get('line'): lines_r[_i] = _r['line']
                    if _r.get('bu'): bus_r[_i] = _r['bu']
                    _n += 1; _v += lcvs_r[_i]
                if _n:
                    log(f"Override {_r.get('id')}: {_n} rows -> {_r['dm1']} ({_moved} re-mapped), LCV {_v:,}")
                else:
                    log(f"WARNING: override {_r.get('id')} matched 0 rows -- check the rule against the source")
        else:
            log('Product market overrides disabled in config -- skipped')
    except Exception as e:
        log(f'WARNING: product market overrides skipped ({e})')

# -- 2d-bis. DM1 SPLITS (2026-10-29, Ahmed: "MAN_MULTI_VIT and WOMEN_MULTI_VIT as DM1 instead of MAN_WOMEN_MULTI_VIT")
# product_market_overrides.json "dm1_splits": {"OLD DM1": ["DM2 a", "DM2 b"]} -- a row whose DM1 is the old market takes its
# own DM2 as DM1 (when that DM2 is listed). Applied after the overrides, and to the target lines below.
_DM1_SPLITS = {}
try:
    if os.path.exists(PRODUCT_MARKET_OVERRIDES_FILE):
        _DM1_SPLITS = json.load(open(PRODUCT_MARKET_OVERRIDES_FILE, encoding='utf-8')).get('dm1_splits') or {}
    _DM1_SPLITS = {k: v for k, v in _DM1_SPLITS.items() if not str(k).startswith('_') and isinstance(v, list)}
    for _old, _news in _DM1_SPLITS.items():
        _n = 0
        for _i in range(len(dm1s_r)):
            if dm1s_r[_i] == _old and dm2s_r[_i] in _news:
                dm1s_r[_i] = dm2s_r[_i]; _n += 1
        _left = sum(1 for x in dm1s_r if x == _old)
        log(f"DM1 split {_old}: {_n} rows -> {', '.join(_news)}" + (f" -- WARNING {_left} rows kept the old DM1 (DM2 not in the split list)" if _left else ''))
except Exception as e:
    log(f'WARNING: DM1 splits skipped ({e})')

# -- 2d-ter. TOTAL-MARKET SUPPLEMENT + LAUNCH MARKETS (2026-10-29, Ahmed: "get anything in Total Market into Market
# Intelligence and flag it; do not evaluate the market share of Zeta or a BU on the new-launch defined markets").
# config/tmi_defined_markets.json lists each defined market's brands. A member brand that is in Total Market
# Intelligence (cache/market_intel.json, annual IMS) but NOT in this IQVIA extract is added as monthly rows:
#   product = "<IMS brand> [TM]" (the flag), corp / molecule / ATC4 from IMS, DM1 = the market's IQVIA DM1
#   (or its "iqvia_dm1_new"), value + units spread evenly over the months of each IMS year (2026 = the IMS months,
#   then carried forward at the 2026 monthly rate up to the last IQVIA month -- an estimate), SU = packs x the unit
#   count in the IMS pack name (packs when there is none).
# LAUNCH markets (override rules with "launch_bu", TMI markets with "launch": true) carry Line / BU "New Launches",
# so no BU / Zeta share, ranking or total counts them; cache_obj['launchMarkets'] keeps their real BU / line for scope.
_TMI_CFG = os.path.join(ROOT_DIR, 'config', 'tmi_defined_markets.json')
_TMI_SRC = os.path.join(ROOT_DIR, 'cache', 'market_intel.json')
_launch_markets = {}
_tmi_log = {'added': [], 'skipped_in_iqvia': [], 'rows': 0, 'lcv': 0}
try:
    if os.path.exists(PRODUCT_MARKET_OVERRIDES_FILE):
        for _r in (json.load(open(PRODUCT_MARKET_OVERRIDES_FILE, encoding='utf-8')).get('overrides') or []):
            if _r.get('launch_bu'):
                _launch_markets[_r['dm1']] = {'bu': _r['launch_bu'], 'line': _r.get('launch_line')}
                if _r.get('dm2') and _r['dm2'] != _r['dm1']:
                    _launch_markets[_r['dm2']] = {'bu': _r['launch_bu'], 'line': _r.get('launch_line')}
    if os.path.exists(_TMI_CFG) and os.path.exists(_TMI_SRC):
        _tc = json.load(open(_TMI_CFG, encoding='utf-8'))
        _tm = json.load(open(_TMI_SRC, encoding='utf-8'))
        _TL, _TA = _tm['lookups'], _tm['annual']
        _TR, _TV, _TU, _TS = _TA['rows'], _TA['value'], _TA['units'], _TA['stride']
        _tyears = _TL['years']
        _t26m = int(_tc.get('tmi_partial_year_months') or 6)
        _nrm = lambda x: ' '.join(str(x or '').upper().split())
        _iq_prods = set(_nrm(p) for p in prods_r)
        _iq_per = sorted(set(periods_r))
        _last = _iq_per[-1] if _iq_per else '2026-12'
        _bidx = {}
        for _i, _b in enumerate(_TL['brands']): _bidx.setdefault(_nrm(_b), []).append(_i)
        _cnt_re = re.compile(r'(\d+)\s*$')
        _byb = {}   # one pass over the IMS cube: brand idx -> [cell idx]
        _wantb = set(i for _m in _tc.get('markets', []) for _e in _m.get('members', []) for i in _bidx.get(_nrm(_e['brand']), []))
        for _k in range(len(_TV)):
            _b0 = _TR[_k * _TS + 6]
            if _b0 in _wantb: _byb.setdefault(_b0, []).append(_k)
        for _m in _tc.get('markets', []):
            _dm1 = _m.get('iqvia_dm1') or _m.get('iqvia_dm1_new')
            if not _dm1: continue
            if _m.get('launch'):
                _launch_markets[_dm1] = {'bu': _m.get('bu'), 'line': _m.get('line')}
            _line = 'New Launches' if _m.get('launch') else _m.get('line')
            _bu = 'New Launches' if _m.get('launch') else _m.get('bu')
            for _e in _m.get('members', []):
                _bn = _nrm(_e['brand'])
                if _bn in _iq_prods or _bn[:18] in _iq_prods:
                    _tmi_log['skipped_in_iqvia'].append(_e['brand']); continue
                _want_c = _nrm(_e.get('corp')) if _e.get('corp') else None
                _cells = {}
                for _bi in _bidx.get(_bn, []):
                    for _k in _byb.get(_bi, []):
                        _o = _k * _TS
                        _corp = _TL['corps'][_TR[_o + 3]]
                        if _want_c and _want_c not in _nrm(_corp): continue
                        _key = (_corp, _TL['products'][_TR[_o + 5]], _TL['molecules'][_TR[_o + 4]], _TL['atc4s'][_TR[_o + 2]], _TL['forms'][_TR[_o + 7]])
                        _y = _tyears[_TR[_o]]
                        _c = _cells.setdefault(_key, {}); _a = _c.setdefault(_y, [0.0, 0.0]); _a[0] += _TV[_k]; _a[1] += _TU[_k]
                if not _cells: continue
                _tmi_log['added'].append(_e['brand'] + (' (' + _e['corp'] + ')' if _e.get('corp') else '') + ' -> ' + _dm1)
                for (_corp, _pk, _mol, _atc, _form), _ys in _cells.items():
                    _mm = _cnt_re.search(str(_pk)); _cnt = int(_mm.group(1)) if (_mm and _form in ('Solid Oral Form', 'Sachets')) else 1
                    _prod = _e['brand'].upper() + ' [TM]'
                    _item = str(_pk).upper() + ' [TM]'
                    for _y, (_v, _u) in _ys.items():
                        _nm = _t26m if _y == max(_tyears) else 12
                        _months = ['%d-%02d' % (_y, mo) for mo in range(1, _nm + 1)]
                        if _y == max(_tyears):   # carry the latest IMS monthly rate up to the last IQVIA month (estimate)
                            mo = _nm + 1
                            while '%d-%02d' % (_y, mo) <= _last and mo <= 12: _months.append('%d-%02d' % (_y, mo)); mo += 1
                        for _p in _months:
                            if _iq_per and _p < _iq_per[0]: continue
                            _lv = _v / _nm; _uv = _u / _nm
                            if _lv <= 0: continue
                            corps_r.append(_corp); prods_r.append(_prod); periods_r.append(_p); atc4s_r.append(_atc)
                            dm1s_r.append(_dm1); dm2s_r.append(_dm1); molecules_r.append(_mol); doses_r.append(_form)
                            items_r.append(_item); strengths_r.append('(none)'); lines_r.append(_line); bus_r.append(_bu)
                            lcvs_r.append(int(round(_lv))); sus_r.append(int(round(_uv * _cnt)))
                            _item_su_by_pack[_item][float(_cnt)] += 1
                            _tmi_log['rows'] += 1; _tmi_log['lcv'] += int(round(_lv))
        log(f"Total-market supplement: {_tmi_log['rows']} rows, LCV {_tmi_log['lcv']:,} -- " + '; '.join(_tmi_log['added']))
    # launch markets: Line / BU "New Launches" on every row (no BU / Zeta share counts them)
    _nl_rows = 0
    for _i in range(len(dm1s_r)):
        if dm1s_r[_i] in _launch_markets:
            lines_r[_i] = 'New Launches'; bus_r[_i] = 'New Launches'; _nl_rows += 1
    log(f"Launch markets: {len(_launch_markets)} DM1/DM2 ({_nl_rows} rows) on Line/BU 'New Launches': " + ', '.join(sorted(_launch_markets)))
except Exception as e:
    log(f'WARNING: total-market supplement / launch markets skipped ({e})')

# -- 2e. IQVIA CALIBRATION (2026-10-26, Ahmed) -----------------------------------
# iqvia_source/config/iqvia_calibrations.json deducts a fixed share of IQVIA's
# over-reported packs from named products (e.g. 75% of 188k EMPACOZA PLUS packs
# in 2026), spread pro-rata to IQVIA's own monthly volume (one factor per rule,
# LCV scaled by the same factor). The main cache carries CALIBRATED values; the
# raw values of every touched row go to cache_obj['calibration'] so Market
# Intelligence can switch back to "IQVIA raw". Raw IQVIA_SOURCE.xlsx untouched.
IQVIA_CALIBRATIONS_FILE = os.path.join(ROOT_DIR, 'iqvia_source', 'config', 'iqvia_calibrations.json')
_calib = {'rules': [], 'raw': []}   # raw: [row_index, raw_lcv, raw_su]
if os.path.exists(IQVIA_CALIBRATIONS_FILE):
    try:
        _cc = json.load(open(IQVIA_CALIBRATIONS_FILE, encoding='utf-8'))
        if _cc.get('enabled', True):
            print('\n[2e/4] Applying IQVIA calibrations...', flush=True)
            _touched = {}
            for _r in _cc.get('rules', []):
                if not _r.get('enabled', True):
                    log(f"Calibration {_r.get('id')} disabled -- skipped"); continue
                _pf, _pt = _r['period_from'], _r['period_to']; _corp = _r.get('corporation')
                _idx = [i for i in range(len(prods_r)) if prods_r[i] == _r['product'] and (not _corp or corps_r[i] == _corp)
                        and _pf <= str(periods_r[i])[:7] <= _pt]
                _su0 = sum(sus_r[i] for i in _idx); _lc0 = sum(lcvs_r[i] for i in _idx)
                _ded = float(_r['excess_packs']) * float(_r['deduct_pct']) * float(_r.get('su_per_pack', 1))
                if not _idx or _su0 <= 0:
                    log(f"WARNING: calibration {_r.get('id')} matched 0 rows / 0 SU -- check product / periods"); continue
                if _ded >= _su0:
                    log(f"WARNING: calibration {_r.get('id')} deduction {_ded:,.0f} SU >= IQVIA {_su0:,} SU -- skipped"); continue
                _f = 1.0 - _ded / _su0
                for i in _idx:
                    if i not in _touched: _touched[i] = (lcvs_r[i], sus_r[i])
                    sus_r[i] = int(round(sus_r[i] * _f)); lcvs_r[i] = int(round(lcvs_r[i] * _f))
                _su1 = sum(sus_r[i] for i in _idx); _lc1 = sum(lcvs_r[i] for i in _idx)
                _sp = float(_r.get('su_per_pack', 1))
                log(f"Calibration {_r.get('id')}: {len(_idx)} rows {_pf}..{_pt}, factor {_f:.4f}; SU {_su0:,} -> {_su1:,} "
                    f"(-{_su0-_su1:,} SU = -{(_su0-_su1)/_sp:,.0f} packs); LCV {_lc0:,} -> {_lc1:,} (-{_lc0-_lc1:,})")
                _calib['rules'].append({'id': _r.get('id'), 'product': _r['product'], 'period_from': _pf, 'period_to': _pt,
                                        'excess_packs': _r['excess_packs'], 'deduct_pct': _r['deduct_pct'], 'su_per_pack': _sp,
                                        'factor': round(_f, 6), 'rows': len(_idx),
                                        'su_raw': _su0, 'su_cal': _su1, 'lcv_raw': _lc0, 'lcv_cal': _lc1, 'why': _r.get('why', '')})
            _calib['raw'] = [[i, v[0], v[1]] for i, v in sorted(_touched.items())]
        else:
            log('IQVIA calibrations disabled in config -- skipped')
    except Exception as e:
        log(f'WARNING: IQVIA calibrations skipped ({e})')

corp_codes, corps_list   = build_lookup(corps_r)
prod_codes, prods_list   = build_lookup(prods_r)
per_codes,  periods_list = build_lookup(periods_r)
atc4_codes, atc4s_list   = build_lookup(atc4s_r)
dm1_codes,  dm1s_list    = build_lookup(dm1s_r)
dm2_codes,  dm2s_list    = build_lookup(dm2s_r)
line_codes, lines_list   = build_lookup(lines_r)
bu_codes,   bus_list     = build_lookup(bu_raw_list := bus_r) # reference
mol_codes,  molecules_list = build_lookup(molecules_r)
dose_codes, doses_list    = build_lookup(doses_r)
item_codes, items_list    = build_lookup(items_r)
strength_codes, strengths_list = build_lookup(strengths_r)

log(f'Corps:{len(corps_list)}  Prods:{len(prods_list)}  Periods:{len(periods_list)}  ATC4:{len(atc4s_list)}  Items:{len(items_list)}  Strengths:{len(strengths_list)}')

# ── 3. Build Flat Array ─────────────────────────────────────────────────────
print('\n[3/4] Building compressed flat array...', flush=True)
n = len(corps_r)
flat = []
for i in range(n):
    flat += [corp_codes[i], prod_codes[i], per_codes[i], atc4_codes[i],
             dm1_codes[i],  dm2_codes[i],  lcvs_r[i],    sus_r[i],
             line_codes[i], bu_codes[i],   mol_codes[i], dose_codes[i],
             item_codes[i], strength_codes[i]]

flat_json  = json.dumps(flat, separators=(',',':'))
compressed = gzip.compress(flat_json.encode('utf-8'), compresslevel=9)
b64_data   = base64.b64encode(compressed).decode('ascii')
log(f'Flat: {n:,} rows  Compressed: {len(b64_data)//1024} KB')

lookups = {
    'corps': corps_list, 'prods': prods_list, 'periods': periods_list,
    'atc4s': atc4s_list, 'dm1s': dm1s_list, 'dm2s': dm2s_list,
    'lines': lines_list, 'bus': bus_list, 'molecules': molecules_list,
    'doses': doses_list, 'items': items_list, 'strengths': strengths_list
}

# Pack sizes
_pack_sizes_arr = []
for _p in prods_list:
    _packs = _prod_su_by_pack.get(_p)
    if _packs:
        _pack_sizes_arr.append(int(max(_packs, key=lambda k: _packs[k])))
    else:
        _pack_sizes_arr.append(1)

# Pack size per Item (2026-10-29): the source's own "Pack Size" column, most frequent per Item (0 = unknown -> product pack size)
_item_pack_sizes_arr = []
for _it in items_list:
    _packs = _item_su_by_pack.get(_it)
    _item_pack_sizes_arr.append(float(max(_packs, key=lambda k: _packs[k])) if _packs else 0)
log(f"Item pack sizes: {sum(1 for x in _item_pack_sizes_arr if x > 0)}/{len(_item_pack_sizes_arr)} items from the Pack Size column")

# ── 4. Load User Permissions ─────────────────────────────────────────────────
print('\n[4/5] Loading user config...', flush=True)
import hashlib, subprocess as _sp
try:
    import openpyxl
except ImportError:
    print('  openpyxl not found — installing...', flush=True)
    _sp.check_call([sys.executable, '-m', 'pip', 'install', 'openpyxl', '-q'])
    import openpyxl

SALT = 'ZETA2026INTEL'

def sha256_hex(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()

def parse_list(val, dm1_corrections=None):
    if val is None: return None
    s = str(val).strip()
    if not s or s.upper() == 'ALL': return None
    items = [x.strip() for x in s.split(',') if x.strip()]
    if dm1_corrections:
        _it = []
        for x in items:   # 2026-10-29: a correction may also be a LIST (one old market split into several)
            v = dm1_corrections.get(x, x)
            _it.extend(v if isinstance(v, list) else [v])
        items = _it
        seen = set()
        items = [x for x in items if not (x in seen or seen.add(x))]
    return items

# Load DM1 name corrections
dm1_corrections = {}
try:
    corr_data = json.load(open(DM1_CORRECTIONS_FILE, encoding='utf-8'))
    dm1_corrections = corr_data.get('corrections', {})
    if dm1_corrections:
        log(f'DM1 corrections loaded: {len(dm1_corrections)} mappings')
except Exception:
    pass

zeta_users = {}
try:
    uwb = openpyxl.load_workbook(USER_CONFIG, read_only=True, data_only=True)
    uws = uwb['Users']
    rows = list(uws.iter_rows(values_only=True))
    header_row = None
    data_start = 0
    for i, row in enumerate(rows):
        if row and 'Email' in [str(c) for c in row if c]:
            header_row = [str(c).strip() if c else '' for c in row]
            data_start = i + 1
            break
    if header_row:
        ci = {h: j for j, h in enumerate(header_row)}
        for row in rows[data_start:]:
            if not row or not row[ci.get('Email', 1)]: continue
            name   = str(row[ci['Full Name']]).strip()   if row[ci.get('Full Name',1)]   else ''
            email  = str(row[ci['Email']]).strip().lower() if row[ci.get('Email',2)]     else ''
            pwd    = str(row[ci['Password']]).strip()    if row[ci.get('Password',3)]    else ''
            role   = str(row[ci['Role']]).strip()        if row[ci.get('Role',4)]        else ''
            bu_raw = row[ci.get('Allowed BU', 5)]
            ln_raw = row[ci.get('Allowed Lines', 6)]
            dm_raw = row[ci.get('Allowed Markets DM1', 7)]
            pr_raw = row[ci.get('Allowed Products', 8)]
            active = str(row[ci.get('Active\n(Yes/No)', 10)] or 'Yes').strip().upper()
            if not email or not pwd or active == 'NO': continue
            h = sha256_hex(email + ':' + pwd + ':' + SALT)
            zeta_users[email] = {
                'name': name, 'hash': h, 'role': role,
                'bu':    parse_list(bu_raw),
                'lines': parse_list(ln_raw),
                'dm1s':  parse_list(dm_raw, dm1_corrections),
                'prods': parse_list(pr_raw),
            }
            if email == 'nevien.reyad@zeta-pharma.com':
                alt_pwd = 'Nevien@2026' if pwd == 'Nevien@202' else 'Nevien@202'
                zeta_users[email]['altHash'] = sha256_hex(email + ':' + alt_pwd + ':' + SALT)
        uwb.close()
        log(f'Users loaded: {len(zeta_users)} active accounts')

        # Sync client-side security and permissions caches
        try:
            sec_path = os.path.join(ROOT_DIR, 'cache', 'security-cache.json')
            perm_path = os.path.join(ROOT_DIR, 'cache', 'permissions-cache.json')
            sorted_sec_users = {k: zeta_users[k] for k in sorted(zeta_users.keys())}
            with open(sec_path, 'w', encoding='utf-8') as sf:
                json.dump({'users': sorted_sec_users}, sf, indent=2, sort_keys=True)
            perms = {k: {'bu': v['bu'], 'lines': v['lines'], 'role': v['role'], 'canExport': True} for k, v in sorted(zeta_users.items())}
            with open(perm_path, 'w', encoding='utf-8') as pf:
                json.dump({'permissions': perms}, pf, indent=2, sort_keys=True)
            log('Synced security-cache.json and permissions-cache.json')
        except Exception as _ce:
            log(f'Note: Could not sync security caches ({_ce})')
    else:
        log('WARNING: Could not find header row in Users sheet')
except Exception as e:
    log(f'WARNING: Could not read user config ({e})')

# ── 5. Targets Aggregation ───────────────────────────────────────────────────
targets_list = []
try:
    _twb = CalamineWorkbook.from_path(TARGET_XLSX)
    _tws = _twb.get_sheet_by_name(_twb.sheet_names[0])
    _trows = _tws.to_python(skip_empty_area=False)
    for row in _trows[1:]:
        if not row or not row[0]: continue
        def tgs(i):
            v = row[i] if i < len(row) else None
            return str(v).strip() if v not in (None, '') else ''
        def tgn(i):
            v = row[i] if i < len(row) else None
            if v in (None, ''): return None
            try: return round(float(v), 4)
            except: return None
        targets_list.append({
            'bu': tgs(0), 'line': tgs(1), 'prod': tgs(2),
            'dm1': tgs(3), 'tgtDm1': tgn(4),
            'dm2': tgs(5), 'tgtDm2': tgn(6)
        })
    for _t in targets_list:   # 2026-10-29: DM1 splits apply to target lines too
        if _t.get('dm1') in _DM1_SPLITS and _t.get('dm2') in _DM1_SPLITS[_t['dm1']]: _t['dm1'] = _t['dm2']
    log(f'Targets loaded: {len(targets_list)} lines')
except Exception as e:
    log(f'WARNING: Targets not loaded ({e})')

# ── 6. Export KPI Summary Snapshot ───────────────────────────────────────────
kpi_data = {}
try:
    NP = len(periods_list)
    latest_ti = NP - 1
    prior_ti  = NP - 2
    zeta_idx  = corps_list.index('ZETA PHARM*') if 'ZETA PHARM*' in corps_list else -1
    STRIDE    = 14  # 2026-09-22: flat now has 14 fields (Item, Strength appended at 12-13); indices 0-9 unchanged
    CI,PI,TI,AI,D1I,D2I,LI,SI,LINEI,BUCI = 0,1,2,3,4,5,6,7,8,9

    def sum_lcv(ti, corp_i=None, dm1_set=None):
        total = 0
        for k in range(0, len(flat), STRIDE):
            if flat[k+TI] != ti: continue
            if corp_i is not None and flat[k+CI] != corp_i: continue
            if dm1_set is not None and flat[k+D1I] not in dm1_set: continue
            total += flat[k+LI]
        return total

    mkt_lcv    = sum_lcv(latest_ti)
    zeta_lcv   = sum_lcv(latest_ti, zeta_idx) if zeta_idx >= 0 else 0
    zeta_share = zeta_lcv / mkt_lcv if mkt_lcv > 0 else 0
    mkt_prior  = sum_lcv(prior_ti)  if prior_ti >= 0 else 0
    zeta_prior = sum_lcv(prior_ti, zeta_idx) if (prior_ti >= 0 and zeta_idx >= 0) else 0
    share_prior= zeta_prior / mkt_prior if mkt_prior > 0 else 0

    bu_dm1s = {}
    for k in range(0, len(flat), STRIDE):
        if flat[k+CI] != zeta_idx: continue
        bu_i  = flat[k+BUCI]
        if bu_i < 0 or bu_i >= len(bus_list): continue
        bu_nm = bus_list[bu_i]
        if bu_nm in ('(none)', ''): continue
        if bu_nm not in bu_dm1s: bu_dm1s[bu_nm] = set()
        bu_dm1s[bu_nm].add(flat[k+D1I])

    bu_kpis = {}
    for bu_nm, dm1_set in bu_dm1s.items():
        bm  = sum_lcv(latest_ti, dm1_set=dm1_set)
        bz  = sum_lcv(latest_ti, zeta_idx, dm1_set)
        bmp = sum_lcv(prior_ti,  dm1_set=dm1_set) if prior_ti >= 0 else 0
        bzp = sum_lcv(prior_ti,  zeta_idx, dm1_set) if prior_ti >= 0 else 0
        bu_kpis[bu_nm] = {
            'market_lcv': bm,   'zeta_lcv': bz,
            'zeta_share': bz/bm if bm > 0 else 0,
            'market_lcv_prior': bmp, 'zeta_lcv_prior': bzp,
            'zeta_share_prior': bzp/bmp if bmp > 0 else 0,
        }

    kpi_data = {
        'refreshed_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'data_period':  periods_list[latest_ti],
        'prior_period': periods_list[prior_ti] if prior_ti >= 0 else None,
        'egypt': {
            'market_lcv': mkt_lcv,   'zeta_lcv': zeta_lcv,   'zeta_share': zeta_share,
            'market_lcv_prior': mkt_prior, 'zeta_lcv_prior': zeta_prior, 'zeta_share_prior': share_prior,
        },
        'bu': bu_kpis,
    }
except Exception as exc:
    log(f'KPI summary export failed: {exc}')

# ── 7. Compile Cache JSON and JS data wrapper ────────────────────────────────
print('\n[5/5] Writing caches...', flush=True)

cache_obj = {
    'b64Data': b64_data,
    'lookups': lookups,
    'packSizes': _pack_sizes_arr,
    'itemPackSizes': _item_pack_sizes_arr,
    'launchMarkets': _launch_markets,
    'tmiSupplement': {'added': _tmi_log['added'], 'rows': _tmi_log['rows'], 'lcv': _tmi_log['lcv'], 'flag': '[TM]', 'source': 'Total Market Intelligence (IMS annual, spread evenly over months; 2026 Jul+ carried forward)'},
    'targets': targets_list,
    'users': zeta_users,
    'kpis': kpi_data,
    'restatements': _restatement_log,
    'calibration': _calib
}

# Write JSON
with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(cache_obj, f, separators=(',', ':'))
log(f'Wrote iqvia.json: {os.path.getsize(OUTPUT_JSON)//1024} KB')

# Write JS wrapper (safe for local double-click file:// protocol)
js_content = f'window.IQVIA_CACHE = {json.dumps(cache_obj, separators=(",", ":"))};'
with open(OUTPUT_JS, 'w', encoding='utf-8') as f:
    f.write(js_content)
log(f'Wrote iqvia.data.js: {os.path.getsize(OUTPUT_JS)//1024} KB')

print(f'\nUnified Compilation Complete in {time.time()-t0:.1f}s!\n')
