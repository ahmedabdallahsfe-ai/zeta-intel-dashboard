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

OUTPUT_JSON   = os.path.join(ROOT_DIR, 'cache', 'iqvia.json')
OUTPUT_JS     = os.path.join(ROOT_DIR, 'cache', 'iqvia.data.js')

SHEET_NAME    = 'Egypt Combined Data'
NEEDED_COLS   = ['ATC4','Corporation','Product','Period',
                 'LC Value','Standard Units Sales',
                 'Line','BU','DEFIND Market_1','DEFIND Market_2','Pack Size']

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
from collections import defaultdict as _dd
_prod_su_by_pack = _dd(lambda: _dd(float))

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
    lines_r.append(g('Line') or '(none)'); bus_r.append(g('BU') or '(none)')
    lcvs_r.append(int(lcv)); sus_r.append(int(su))
    try:
        ps = float(g('Pack Size') or 0)
        if ps > 0: _prod_su_by_pack[prod][ps] += su
    except: pass

log(f'{len(corps_r):,} rows after cleaning')

corp_codes, corps_list   = build_lookup(corps_r)
prod_codes, prods_list   = build_lookup(prods_r)
per_codes,  periods_list = build_lookup(periods_r)
atc4_codes, atc4s_list   = build_lookup(atc4s_r)
dm1_codes,  dm1s_list    = build_lookup(dm1s_r)
dm2_codes,  dm2s_list    = build_lookup(dm2s_r)
line_codes, lines_list   = build_lookup(lines_r)
bu_codes,   bus_list     = build_lookup(bu_raw_list := bus_r) # reference

log(f'Corps:{len(corps_list)}  Prods:{len(prods_list)}  Periods:{len(periods_list)}  ATC4:{len(atc4s_list)}')

# ── 3. Build Flat Array ─────────────────────────────────────────────────────
print('\n[3/4] Building compressed flat array...', flush=True)
n = len(corps_r)
flat = []
for i in range(n):
    flat += [corp_codes[i], prod_codes[i], per_codes[i], atc4_codes[i],
             dm1_codes[i],  dm2_codes[i],  lcvs_r[i],    sus_r[i],
             line_codes[i], bu_codes[i]]

flat_json  = json.dumps(flat, separators=(',',':'))
compressed = gzip.compress(flat_json.encode('utf-8'), compresslevel=9)
b64_data   = base64.b64encode(compressed).decode('ascii')
log(f'Flat: {n:,} rows  Compressed: {len(b64_data)//1024} KB')

lookups = {
    'corps': corps_list, 'prods': prods_list, 'periods': periods_list,
    'atc4s': atc4s_list, 'dm1s': dm1s_list, 'dm2s': dm2s_list,
    'lines': lines_list, 'bus': bus_list
}

# Pack sizes
_pack_sizes_arr = []
for _p in prods_list:
    _packs = _prod_su_by_pack.get(_p)
    if _packs:
        _pack_sizes_arr.append(int(max(_packs, key=lambda k: _packs[k])))
    else:
        _pack_sizes_arr.append(1)

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
        items = [dm1_corrections.get(x, x) for x in items]
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
        uwb.close()
        log(f'Users loaded: {len(zeta_users)} active accounts')
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
    STRIDE    = 10
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
    'targets': targets_list,
    'users': zeta_users,
    'kpis': kpi_data
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
