"""
build_iqvia_geo_cache.py — IQVIA Geo & Territory view cache (PREVIEW stage, 2026-10-07)

INPUT (read-only):
  IQVIA TERRIOTRY/Egypt Sales Territory.xlsx
      sheet "Egypt Sales Territory Data"  -> rows with Data Source = "IQVIA Actual" ONLY
                                             (Market Value / Units, 100% allocated -> summed back to source level)
      sheet "Brand_Map"                   -> brand type, corporation, defined market (DM1), line, BU, "of which"
      sheet "Position_Brick_Alloc"        -> position x 148 brick: Responsibility %, Allocation % (Organogram July 2026)
      sheets "Anchored_Region", "Anchored_Positions" -> IQVIA-Anchored Allocation (directional, opt-in layer only)
  cache/records.json + cache/dashboard.json -> CRM doctor visits per Medical Rep (effort index)

OUTPUT:
  cache/iqvia_geo.data.js   window.IQVIA_GEO_CACHE = {b64Data:"<gzip+base64 JSON>"}  (same convention as other caches)

RULES:
  - IQVIA-Anchored rows of the data sheet are NEVER read into the IQVIA Actual facts.
  - EXCEPTION (2026-10-09, Ahmed): the Zeta brands in ANCHOR_INTEGRATE (no Zeta track in the IQVIA territory delivery)
    are added as a separate, flagged layer: IQVIA_SOURCE national value (latest cache/iqvia.data.js) x position share of
    Zeta in-house sales (Q1-Q3 2026, IsTender=FALSE, Pharmacies and Stores separately) = position and region values.
    Market = Zeta + tracked competitors. "Of which" brands (inside an IQVIA molecule total) are carved out of that
    total, never added. Facts carry flag 1 (pseudo brick per region, "position-level"); positions in "pfacts".
    The page can switch the layer off. Directional only - not for incentives, ranking or targets.
  - Periods are derived from the latest month in the data (MAT = last 12 months, YTD = Jan..latest).
  - Hard checks (script exits non-zero on failure): 148 bricks; facts total == IQVIA Actual Market Value total;
    every allocated brick-line sums to 100%.
"""
import os, sys, json, gzip, base64, collections, datetime
import pandas as pd, numpy as np
from python_calamine import CalamineWorkbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'IQVIA TERRIOTRY', 'Egypt Sales Territory.xlsx')
OUT = os.path.join(ROOT, 'cache', 'iqvia_geo.data.js')

def sheet(wb, name):
    r = wb.get_sheet_by_name(name).to_python()
    return pd.DataFrame(r[1:], columns=r[0])

# ---- IQVIA-anchored Zeta brands integrated into their territory market (2026-10-09) ----
ANCHOR_INTEGRATE = ['NEXICURE Sachet', 'DUXNORZET 60', 'ZETAZOLEX', 'EPILOSAMIDE', 'PRUCANETIC', 'ULCEBISMO',
                    'MEDIHYALO', 'BILASTIGEC (tablets)', 'NEXIROZOVA']  # NEXIROZOVA carved out of "Rosuvastatin Mono solid" (total market)  # + MEDIHYALO, BILASTIGEC tablets (2026-10-09, Ahmed)
# IQVIA_SOURCE (DM1, Product) of each brand -> monthly national value is rescaled to the latest IQVIA_SOURCE
ANCHOR_IQ = {'NEXICURE Sachet': ('ESOMEPRAZOLE SACHET', 'NEXICURE'), 'DUXNORZET 60': ('DULOXETINE_60 MG _SDUXONORZET 60', 'DUXNORZET'),
             'ZETAZOLEX': ('BREXPIPRAZOLE_MKT', 'ZETAZOLEX'), 'EPILOSAMIDE': ('LACOSAMIDE_MKT', 'EPILOSAMIDE'),
             'PRUCANETIC': ('PRUCALOPRIDE_MKT', 'PRUCANETIC'), 'ULCEBISMO': ('BISMUTH ANTIULCERANTS', 'ULCEBISMO'),
             'MEDIHYALO': ('SELECTED OTH W HEALING _MEDIHYALO', 'MEDIHYALO'), 'BILASTIGEC (tablets)': ('BELASTINE_CETRIZINE TAB MKT', 'BILASTIGEC'),
             'NEXIROZOVA': ('NEXIROAOVA_ROSUVASTATIN MKT', 'NEXIROZOVA')}
# brands whose Stores row in the workbook is national-only -> split by in-house Stores+SubAgent sales (Brand, Item contains)
STORE_SPLIT = {'NEXICURE Sachet': ('NEXICURE', 'SACH'), 'MEDIHYALO': ('MEDIHYALO', ''), 'BILASTIGEC (tablets)': ('BILASTIGEC', 'TAB'), 'NEXIROZOVA': ('NEXIROZOVA', '')}
# Zeta brands with no workbook rows at all: IQVIA_SOURCE national (product + DM1, by sector x month) x in-house position share
ANTIHIST_PEDIA = 'ORAL SELECTED ANTIHISTAMIN,LEVOCETRIZIN , EBASTIN .. CETRIZIN , FEXOFENADIN,BILASTIN'
ANCHOR_NEW = {'BILASTIGEC syrup': {'iq': ('BILASTIGEC', ANTIHIST_PEDIA), 'sales': ('BILASTIGEC', 'SYRUP'), 'dm2': ANTIHIST_PEDIA}}
# IQVIA territory brands that mix forms -> split in every brick by IQVIA_SOURCE national form mix (month x sector)
# (2026-10-09, Ahmed: territory 'Evastine' = tablets + oral solution; oral solution belongs to the PEDIA antihistamine market)
FORM_SPLIT = {'Evastine': {'iq_product': 'EVASTINE', 'parts': [
    ('Evastine tablets', 'BELASTINE_CETRIZINE TAB MKT', None, None),
    ('Evastine oral solution', ANTIHIST_PEDIA, 'PEDIA', 'Cluster')]}}
STORE_SUBTYPES = {'Stores', 'SubAgent'}
ANCHOR_IGNORE = ['ZETACOLEST PLUS']  # no IQVIA territory data for its market -> not shown on the page
SALES = [('Q1_Sales.xlsx', 'SalesPerDistributor'), ('Q2_Sales.xlsx', 'SalesPerDistributor'), ('june.xlsx', 'SalesPerDistributor'), ('Q3_SALES.xlsx', 'July-Sep')]
NATIONAL_POS = '— National (no position)'

def norm(x): return ' '.join(str(x).upper().split())

def iqvia_national():
    # {(DM1 norm, product): {'YYYY-MM': [lcv, units]}} from cache/iqvia.data.js (same source as Market Intelligence)
    p = os.path.join(ROOT, 'cache', 'iqvia.data.js')
    if not os.path.exists(p): return None
    s = open(p, encoding='utf-8').read(); o = json.loads(s[s.index('{'):s.rindex('}') + 1])
    d = json.loads(gzip.decompress(base64.b64decode(o['b64Data']))); L = o['lookups']
    want = {(norm(a), b) for a, b in ANCHOR_IQ.values()}
    out = collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0, 0.0]))
    for i in range(0, len(d), 14):
        k = (norm(L['dm1s'][d[i + 4]]), L['prods'][d[i + 1]])
        if k in want:
            x = out[k][L['periods'][d[i + 2]]]; x[0] += d[i + 6] or 0; x[1] += d[i + 7] or 0
    return out

def inhouse_weights():
    # {brand: {'PHARMACIES': {position: share}, 'STORES': {...}}} from Zeta in-house sales Q1-Q3 2026, IsTender=FALSE.
    # Stores = SubType Stores/SubAgent, Pharmacies = all other SubTypes. One pass over the sales files, cached while unchanged.
    import pickle
    specs = dict(STORE_SPLIT); specs.update({b: v['sales'] for b, v in ANCHOR_NEW.items()})
    files = [os.path.join(ROOT, 'ZETA SALES_2026', f) for f, _ in SALES]
    key = [(os.path.basename(f), os.path.getsize(f), int(os.path.getmtime(f))) for f in files] + sorted(specs.items())
    cdir = os.path.join(ROOT, 'cache', '.iqvia_geo_src'); os.makedirs(cdir, exist_ok=True)
    cp = os.path.join(cdir, 'inhouse_weights.pkl')
    if os.path.exists(cp):
        c = pickle.load(open(cp, 'rb'))
        if c['key'] == key: return c['w']
    tot = {b: {'PHARMACIES': collections.Counter(), 'STORES': collections.Counter()} for b in specs}
    for f, sh in zip(files, [x[1] for x in SALES]):
        r = CalamineWorkbook.from_path(f).get_sheet_by_name(sh).to_python()
        h = [str(x).strip() for x in r[0]]; ix = {n: h.index(n) for n in ('Brand', 'Item', 'SubType', 'IsTender', 'Position', 'Value')}
        for row in r[1:]:
            br = str(row[ix['Brand']]).strip().upper(); it = str(row[ix['Item']]).upper()
            hit = [b for b, (bn, item) in specs.items() if br == bn and item in it]
            if not hit: continue
            if str(row[ix['IsTender']]).strip().upper() in ('TRUE', '1', 'YES'): continue
            sec = 'STORES' if str(row[ix['SubType']]).strip() in STORE_SUBTYPES else 'PHARMACIES'
            try: v = float(row[ix['Value']] or 0)
            except Exception: v = 0.0
            for b in hit: tot[b][sec][str(row[ix['Position']]).strip()] += v
    w = {}
    for b, d in tot.items():
        w[b] = {}
        for sec, c in d.items():
            c = {k: v for k, v in c.items() if v > 0 and k}; T = sum(c.values())
            w[b][sec] = {k: v / T for k, v in c.items()} if T > 0 else {}
    pickle.dump({'key': key, 'w': w}, open(cp, 'wb'))
    return w

def store_weights(brand):
    w = inhouse_weights()[brand]['STORES']
    if not w: fail(f'no in-house Stores sales found for {brand}')
    return w

def iq_sector():
    # {(product, DM1 norm, sector, 'YYYY-MM'): [LC value, units]} straight from IQVIA_SOURCE.xlsx for the products the
    # territory view needs by sector (the dashboard IQVIA cache has no sector). ~20 s, cached while the file is unchanged.
    import pickle
    src = os.path.join(ROOT, 'iqvia_source', 'IQVIA_SOURCE.xlsx')
    prods = sorted({v['iq'][0] for v in ANCHOR_NEW.values()} | {v['iq_product'] for v in FORM_SPLIT.values()})
    key = [os.path.getsize(src), int(os.path.getmtime(src))] + prods
    cp = os.path.join(ROOT, 'cache', '.iqvia_geo_src', 'iq_sector.pkl'); os.makedirs(os.path.dirname(cp), exist_ok=True)
    if os.path.exists(cp):
        c = pickle.load(open(cp, 'rb'))
        if c['key'] == key: return c['d']
    r = CalamineWorkbook.from_path(src).get_sheet_by_name('Egypt Combined Data').to_python(skip_empty_area=False)
    h = [str(x).strip() for x in r[0]]; ix = {n: h.index(n) for n in ('Sector', 'Product', 'Period', 'LC Value', 'Units', 'DEFIND Market_1')}
    out = collections.defaultdict(lambda: [0.0, 0.0]); ps = set(prods)
    for row in r[1:]:
        pr = str(row[ix['Product']]).strip()
        if pr not in ps: continue
        per = row[ix['Period']]; per = per.strftime('%Y-%m') if hasattr(per, 'strftime') else str(per)[:7]
        k = (pr, norm(row[ix['DEFIND Market_1']]), str(row[ix['Sector']]).strip().upper(), per)
        try: out[k][0] += float(row[ix['LC Value']] or 0); out[k][1] += float(row[ix['Units']] or 0)
        except Exception: pass
    d = dict(out); pickle.dump({'key': key, 'd': d}, open(cp, 'wb'))
    return d

def fail(msg):
    print('[iqvia_geo] CHECK FAILED:', msg); sys.exit(1)

def main():
    t0 = datetime.datetime.now()
    import gc
    # big side sources first (cached), before the territory workbook is in memory
    IQS = iq_sector() if (FORM_SPLIT or ANCHOR_NEW) else {}; gc.collect()
    IW = inhouse_weights() if (ANCHOR_NEW or STORE_SPLIT) else {}; gc.collect()
    wb = CalamineWorkbook.from_path(SRC)
    dall = sheet(wb, 'Egypt Sales Territory Data')
    d = dall[dall['Data Source'] == 'IQVIA Actual'].copy()
    R, U = 'Market Value EGP (100% allocated)', 'Market Units (100% allocated)'
    d[R] = pd.to_numeric(d[R], errors='coerce').fillna(0.0)
    d[U] = pd.to_numeric(d[U], errors='coerce').fillna(0.0)
    d['M'] = pd.to_datetime(d['Month'])
    BR = 'Subterritory (148 Brick)'
    # ---- form split (2026-10-09): one IQVIA territory brand -> one brand per form, by IQVIA_SOURCE national form mix ----
    FS_META = {}
    for fb, cfg in FORM_SPLIT.items():
        x = d[d['Brand Name'] == fb]
        if not len(x): fail(f'form split: brand {fb!r} not in the territory data')
        tot = collections.defaultdict(float); part = collections.defaultdict(float)
        for (pr, dm, sec, ym), v in IQS.items():
            if pr != cfg['iq_product']: continue
            tot[(sec, ym)] += v[0]
            for nm, pdm, _, _ in cfg['parts']:
                if dm == norm(pdm): part[(nm, sec, ym)] += v[0]
        pieces = []
        for nm, pdm, _, _ in cfg['parts']:
            y = x.copy(); key_ = list(zip(y['Sector'].str.upper(), y.M.dt.strftime('%Y-%m')))
            sh = np.array([part[(nm,) + k] / tot[k] if tot[k] > 0 else 1.0 / len(cfg['parts']) for k in key_])
            y[R] = y[R].values * sh; y[U] = y[U].values * sh; y['Brand Name'] = nm; pieces.append(y)
            FS_META[nm] = {'from': fb, 'share': round(float(y[R].sum() / x[R].sum()), 4) if x[R].sum() else None}
        before = float(x[R].sum()); d = pd.concat([d[d['Brand Name'] != fb]] + pieces, ignore_index=True)
        after = sum(float(p_[R].sum()) for p_ in pieces)
        if abs(before - after) > max(1000, before * 1e-6): fail(f'form split of {fb} does not add up ({after:,.0f} vs {before:,.0f})')
        print(f'[iqvia_geo] form split {fb}: ' + ', '.join(f'{k} {v["share"]:.1%}' for k, v in FS_META.items() if v['from'] == fb))
    total_R = float(d[R].sum())
    g = d.groupby([BR, 'Brand Name', 'Sector', 'M'])[[R, U]].sum().reset_index()

    last = g.M.max()
    def mstart(m, back): return (m - pd.DateOffset(months=back)).normalize()
    P = {
        'mat':  (mstart(last, 11), last),
        'pmat': (mstart(last, 23), mstart(last, 12)),
        'ytd':  (pd.Timestamp(last.year, 1, 1), last),
        'pytd': (pd.Timestamp(last.year - 1, 1, 1), pd.Timestamp(last.year - 1, last.month, 1)),
    }
    for k, (a, b) in P.items():
        m = (g.M >= a) & (g.M <= b)
        g[k] = np.where(m, g[R], 0.0); g[k + 'U'] = np.where(m, g[U], 0.0)

    geo = d[['Region', 'Territory', BR]].drop_duplicates()
    bricks = sorted(geo[BR].unique())
    if len(bricks) != 148: fail(f'expected 148 bricks, got {len(bricks)}')
    bi = {b: i for i, b in enumerate(bricks)}

    bm = sheet(wb, 'Brand_Map').drop_duplicates('Brand Name').set_index('Brand Name')
    for fb, cfg in FORM_SPLIT.items():
        for nm, pdm, ln, bu in cfg['parts']:
            row = bm.loc[fb].copy(); row['Defined Market (DM1)'] = pdm; row['Defined Market (DM2)'] = pdm
            if ln: row['Line'] = ln; row['BU'] = bu
            bm.loc[nm] = row
    brands = sorted(g['Brand Name'].unique())
    miss = [b for b in brands if b not in bm.index]
    if miss: fail(f'brands missing from Brand_Map: {miss}')
    mk = sorted(bm.loc[brands, 'Defined Market (DM1)'].astype(str).unique()); mi = {m: i for i, m in enumerate(mk)}
    mline = bm.loc[brands].groupby('Defined Market (DM1)')[['Line', 'BU']].first()
    bri = {b: i for i, b in enumerate(brands)}

    # monthly facts (last 24 months): value + units per brand x brick x sector -> any period / measure in the browser
    months = sorted(g.M[(g.M >= P['pmat'][0]) & (g.M <= last)].unique())
    mpos = {m: i for i, m in enumerate(months)}
    SEC = {'PHARMACIES': 0, 'STORES': 1}
    gw = g[g.M.isin(mpos)]
    acc = {}
    for r in gw[[BR, 'Brand Name', 'Sector', 'M', R, U]].itertuples(index=False):
        key = (bri[r[1]], bi[r[0]], SEC[r[2]])
        if key not in acc: acc[key] = ([0] * len(months), [0] * len(months))
        i = mpos[r[3]]; acc[key][0][i] += r[4]; acc[key][1][i] += r[5]
    facts = []
    for key, (v, u) in sorted(acc.items()):
        if not any(abs(x) > 0.5 for x in v) and not any(abs(x) > 0.5 for x in u): continue
        facts.append([key[0], key[1], key[2], [round(x) for x in v], [round(x) for x in u]])
    exp = float(d.loc[(d.M >= P['pmat'][0]) & (d.M <= last), R].sum()); got = float(sum(sum(f[3]) for f in facts))
    if abs(exp - got) > max(1000, exp * 1e-6): fail(f'24-month total mismatch {got:,.0f} vs {exp:,.0f}')
    expU = float(d.loc[(d.M >= P['pmat'][0]) & (d.M <= last), U].sum()); gotU = float(sum(sum(f[4]) for f in facts))
    if abs(expU - gotU) > max(50, expU * 1e-5): fail(f'24-month units mismatch {gotU:,.0f} vs {expU:,.0f}')

    gi = geo.drop_duplicates(BR).set_index(BR)
    B = [{'n': b, 't': gi.loc[b, 'Territory'], 'r': gi.loc[b, 'Region']} for b in bricks]
    BRD = [{'n': b, 'm': mi[str(bm.loc[b, 'Defined Market (DM1)'])], 'z': int(bm.loc[b, 'Brand Type'] == 'Zeta'),
            'd2': str(bm.loc[b, 'Defined Market (DM2)']),  # DM2 filter (2026-10-09)
            'c': str(bm.loc[b, 'Corporation']), 'in': str(bm.loc[b, 'Zeta Brand Inside (not separable)'] or ''),
            **({'fs': FS_META[b]['from']} if b in FS_META else {})} for b in brands]
    MK = [{'n': m, 'line': str(mline.loc[m, 'Line']), 'bu': str(mline.loc[m, 'BU'])} for m in mk]

    # positions x brick allocation (organogram)
    pa = sheet(wb, 'Position_Brick_Alloc')
    pa = pa[pa['148 Brick'].isin(bi) & (pa['IQVIA Line'] != '(no IQVIA market)')].copy()  # CHC / CHC_Sales have no IQVIA market
    pa['al'] = pd.to_numeric(pa['Allocation % (100%)'], errors='coerce').fillna(0.0)
    pa['rs'] = pd.to_numeric(pa['Responsibility Share % (Organogram)'], errors='coerce').fillna(0.0)
    chk = pa.groupby(['IQVIA Line', '148 Brick']).al.sum()
    bad = chk[(chk - 1).abs() > 0.001]
    if len(bad): fail(f'{len(bad)} brick-lines do not allocate to 100%')
    pos = pa.groupby('Position').agg(line=('IQVIA Line', 'first'), rep=('Medical Rep', 'first'), dm=('District Manager', 'first'),
                                     nsm=('NSM', 'first'), st=('Status', 'first')).reset_index()
    pidx = {p: i for i, p in enumerate(pos.Position)}
    alloc = [[pidx[r.Position], bi[r['148 Brick']], round(float(r.al), 4), round(float(r.rs), 4)] for _, r in pa.iterrows()]

    # CRM doctor visits per rep (Medical / Senior Medical Representative)
    rec = json.load(open(os.path.join(ROOT, 'cache', 'records.json'), encoding='utf-8'))
    dim = json.load(open(os.path.join(ROOT, 'cache', 'dashboard.json'), encoding='utf-8'))['dimensions']
    f = rec['fields']; ie, iv, it, ity = f.index('employeeIdx'), f.index('visits'), f.index('titleIdx'), f.index('typeIdx')
    calls = collections.Counter()
    for r in rec['rows']:
        if dim['types'][r[ity]] == 'Doctor' and dim['titles'][r[it]] in ('Medical Representative', 'Senior Medical Representative'):
            calls[str(dim['employeeNames'][r[ie]]).strip().lower()] += r[iv]
    POS = []
    for _, r in pos.iterrows():
        st = 'Filled' if str(r.st) == 'Filled' else str(r.st or 'Vacant')
        c = calls.get(str(r.rep).strip().lower()) if st == 'Filled' else None
        POS.append([r.Position, r.line, r.rep, r.dm, r.nsm, st, c])
    filled = sum(1 for p in POS if p[5] == 'Filled'); matched = sum(1 for p in POS if p[6] is not None)

    # anchored layer (directional, opt-in)
    ar = sheet(wb, 'Anchored_Region'); ap = sheet(wb, 'Anchored_Positions')
    ANC = [[r.Brand, r.Region, round(float(r['Zeta Pharmacies YTD (IQVIA-anchored)'] or 0)),
            None if r['Tracked market Pharmacies YTD (IQVIA Actual)'] in ('', None) else round(float(r['Tracked market Pharmacies YTD (IQVIA Actual)']))]
           for _, r in ar.iterrows()]
    ab = ap.drop_duplicates('Brand')[['Brand', 'Brand Line', 'Contained in IQVIA row ("of which")']]
    ANB = [{'b': r.Brand, 'line': r['Brand Line'], 'of': r['Contained in IQVIA row ("of which")'] or ''} for _, r in ab.iterrows()
           if r.Brand not in ANCHOR_IGNORE]  # Ahmed 2026-10-09: ignore ZETACOLEST PLUS (no territory data)

    # ---- IQVIA-anchored Zeta brands (2026-10-09) ----
    an = dall[(dall['Data Source'] == 'IQVIA-Anchored Allocation') & dall['Brand Name'].isin(ANCHOR_INTEGRATE)].copy()
    miss = set(ANCHOR_INTEGRATE) - set(an['Brand Name'])
    if miss: fail(f'anchored brands not in the workbook: {sorted(miss)}')
    an[R] = pd.to_numeric(an[R], errors='coerce').fillna(0.0); an[U] = pd.to_numeric(an[U], errors='coerce').fillna(0.0)
    an['M'] = pd.to_datetime(an['Month']); an = an[an.M.isin(mpos)]
    preg = pa.groupby('Position').Region.agg(lambda x: x.value_counts().index[0]).to_dict() if 'Region' in pa else {}
    # national-only Stores rows -> positions by in-house Stores+SubAgent share
    parts = [an[~((an.Position == NATIONAL_POS) & an['Brand Name'].isin(STORE_SPLIT))]]
    for b in STORE_SPLIT:
        nat = an[(an['Brand Name'] == b) & (an.Position == NATIONAL_POS)]
        if not len(nat): continue
        w = store_weights(b); rows = []
        for _, r in nat.iterrows():
            for p_, x in w.items():
                rr = r.copy(); rr['Position'] = p_; rr['Region'] = preg.get(p_, 'UNASSIGNED'); rr[R] = r[R] * x; rr[U] = r[U] * x; rows.append(rr)
        parts.append(pd.DataFrame(rows))
        log_ = f'{b}: national Stores split to {len(w)} positions by in-house Stores+SubAgent sales'; print('[iqvia_geo]', log_)
    an = pd.concat(parts, ignore_index=True)
    # rescale each brand-month to the latest IQVIA_SOURCE national value (the workbook was built on an earlier delivery)
    IQN = iqvia_national(); ANC_META = {}
    an['ym'] = an.M.dt.strftime('%Y-%m')
    wbm = an.groupby(['Brand Name', 'ym'])[[R, U]].sum()
    fac = {}
    for (b, ym), x in wbm.iterrows():
        k = (norm(ANCHOR_IQ[b][0]), ANCHOR_IQ[b][1]); iq = IQN.get(k, {}).get(ym) if IQN else None
        f_ = iq[0] / x[R] if iq and x[R] > 0 else 1.0
        fac[(b, ym)] = (f_, f_)  # units keep the workbook's unit basis (IQVIA_SOURCE carries standard units, not packs)
    an['fv'] = [fac[(b, y)][0] for b, y in zip(an['Brand Name'], an.ym)]; an['fu'] = [fac[(b, y)][1] for b, y in zip(an['Brand Name'], an.ym)]
    an[R] = an[R] * an.fv; an[U] = an[U] * an.fu
    # brands built here from IQVIA_SOURCE by sector x in-house position share (no workbook rows)
    for nb_, cfg in ANCHOR_NEW.items():
        pr, dm = cfg['iq']; rows = []
        for (p_, dm_, sec, ym), v in IQS.items():
            if p_ != pr or dm_ != norm(dm) or sec not in SEC: continue
            m = pd.Timestamp(ym + '-01')
            if m not in mpos: continue
            w = IW[nb_][sec] or IW[nb_]['PHARMACIES']
            for pos_, x in w.items():
                rows.append({'Brand Name': nb_, 'Region': preg.get(pos_, 'UNASSIGNED'), 'Position': pos_, 'Sector': sec, 'M': m,
                             R: v[0] * x, U: v[1] * x, 'Defined Market (DM1)': dm, 'Defined Market (DM2)': cfg.get('dm2', dm),
                             'ym': ym, 'fv': 1.0, 'fu': 1.0})
        if not rows: fail(f'{nb_}: no IQVIA_SOURCE rows for {pr} / {dm}')
        an = pd.concat([an, pd.DataFrame(rows)], ignore_index=True)
        print(f'[iqvia_geo] {nb_}: IQVIA_SOURCE by sector x in-house share ({len(IW[nb_]["PHARMACIES"])} pharmacy / {len(IW[nb_]["STORES"])} stores positions)')
    regs = sorted(set(geo.Region) | set(an.Region))
    ap_ = sheet(wb, 'Anchored_Positions'); ofmap = ap_.drop_duplicates('Brand').set_index('Brand')['Contained in IQVIA row ("of which")'].to_dict()
    mkn = {norm(m): i for i, m in enumerate(mk)}
    psb = {}  # region -> pseudo brick index
    for r_ in sorted(set(an.Region)):
        psb[r_] = len(B); B.append({'n': f'{r_} · position-level (IQVIA-anchored)', 't': 'no brick split', 'r': r_, 'ps': 1})
    for m_ in MK: m_['anc'] = 0
    breg = {b: gi.loc[b, 'Region'] for b in bricks}
    aggR = collections.defaultdict(float); aggRU = collections.defaultdict(float)  # (brand, region, sector, month) IQVIA actual
    for r in gw[[BR, 'Brand Name', 'Sector', 'M', R, U]].itertuples(index=False):
        aggR[(r[1], breg[r[0]], r[2], r[3])] += r[4]; aggRU[(r[1], breg[r[0]], r[2], r[3])] += r[5]
    PF = {}; nf = 0; unmatched = 0.0
    for b in ANCHOR_INTEGRATE + list(ANCHOR_NEW):
        x = an[an['Brand Name'] == b]
        dm1 = str(x['Defined Market (DM1)'].iloc[0]); mi_ = mkn.get(norm(dm1))
        if mi_ is None: fail(f'{b}: DM1 {dm1!r} is not a territory market')
        MK[mi_]['anc'] = 1
        of = str(ofmap.get(b) or '').strip() if b in ofmap else ''; ofi = bri.get(of, -1) if of else -1
        if of and ofi < 0: fail(f'{b}: "of which" aggregate {of!r} not found among IQVIA brands')
        bidx = len(BRD)
        BRD.append({'n': b, 'm': mi_, 'z': 1, 'a': 1, 'of': ofi, 'd2': str(x['Defined Market (DM2)'].iloc[0]), 'c': 'ZETA PHARM*', 'in': ''})
        reg = collections.defaultdict(lambda: ([0.0] * len(months), [0.0] * len(months)))
        for r in x[['Region', 'Position', 'Sector', 'M', R, U]].itertuples(index=False):
            i = mpos[r[3]]; s_ = SEC[r[2]]
            t = reg[(r[0], s_)]; t[0][i] += r[4]; t[1][i] += r[5]
            if r[1] in pidx:
                pk = (bidx, pidx[r[1]], s_)
                if pk not in PF: PF[pk] = ([0.0] * len(months), [0.0] * len(months), r[0])
                PF[pk][0][i] += r[4]; PF[pk][1][i] += r[5]
            else: unmatched += r[4]
        for (r_, s_), (v, u) in reg.items():
            facts.append([bidx, psb[r_], s_, [round(z) for z in v], [round(z) for z in u], 1]); nf += 1
            if ofi >= 0:  # carve Zeta out of the IQVIA molecule total (never below zero)
                sec = 'PHARMACIES' if s_ == 0 else 'STORES'; sv, su = [], []
                for i, m in enumerate(months):
                    av = aggR.get((of, r_, sec, m), 0.0); cut = min(v[i], max(0.0, av)); sv.append(-cut)
                    su.append(-(u[i] * cut / v[i]) if v[i] > 0 else 0.0)
                facts.append([ofi, psb[r_], s_, [round(z) for z in sv], [round(z) for z in su], 1]); nf += 1
        tv = float(x[R].sum()); ANC_META[b] = {'value24': round(tv), 'of': of, 'dm1': MK[mi_]['n'],
            'rescale': round(float(x[R].sum() / (x[R] / x.fv).sum()), 4) if len(x) else 1.0}
    pfacts = [[k[0], k[1], k[2], [round(z) for z in v], [round(z) for z in u], rg] for k, (v, u, rg) in PF.items()]
    # checks: layer totals reconcile
    expA = float(an[R].sum()); gotA = float(sum(sum(f[3]) for f in facts if len(f) > 5 and BRD[f[0]].get('a')))
    if abs(expA - gotA) > max(1000, expA * 1e-6): fail(f'anchored layer total mismatch {gotA:,.0f} vs {expA:,.0f}')
    gotP = float(sum(sum(f[3]) for f in pfacts))
    if abs(expA - unmatched - gotP) > max(1000, expA * 1e-6): fail(f'anchored position total mismatch {gotP:,.0f} vs {expA - unmatched:,.0f}')
    print(f'[iqvia_geo] anchored layer: {len(ANCHOR_INTEGRATE) + len(ANCHOR_NEW)} brands, {nf} region facts, {len(pfacts)} position facts, '
          f'24-month value {expA/1e6:,.1f}M (positions {gotP/1e6:,.1f}M, not matched to a position {unmatched/1e6:,.2f}M)')
    for b, m_ in ANC_META.items(): print(f'   {b:16} {m_["dm1"][:34]:34} 24m {m_["value24"]/1e6:7.2f}M  rescale x{m_["rescale"]}{"  of which " + m_["of"] if m_["of"] else ""}')

    fm = lambda x: x.strftime('%b-%y')
    meta = {'source': 'IQVIA Egypt Sales Territory (148 bricks), IQVIA Actual', 'built': t0.strftime('%Y-%m-%d %H:%M'),
            'last': fm(last), 'mat': f"{fm(P['mat'][0])}–{fm(P['mat'][1])}", 'pmat': f"{fm(P['pmat'][0])}–{fm(P['pmat'][1])}",
            'ytd': f"{fm(P['ytd'][0])}–{fm(P['ytd'][1])}", 'pytd': f"{fm(P['pytd'][0])}–{fm(P['pytd'][1])}",
            'org': 'Total Organogram July 2026', 'calls': 'CRM doctor visits (Medical Reps), records cache',
            'iqviaTotal': round(total_R), 'anchored': ANC_META, 'formSplit': FS_META, 'filled': filled, 'callsMatched': matched, 'months': [pd.Timestamp(m).strftime('%Y-%m') for m in months]}
    out = {'meta': meta, 'bricks': B, 'markets': MK, 'brands': BRD, 'facts': facts, 'pos': POS, 'alloc': alloc, 'anch': ANC, 'anchBrands': ANB, 'anchInt': ANCHOR_INTEGRATE + list(ANCHOR_NEW), 'pfacts': pfacts}
    js = json.dumps(out, separators=(',', ':'), ensure_ascii=False)
    b64 = base64.b64encode(gzip.compress(js.encode('utf-8'), compresslevel=9)).decode('ascii')
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('window.IQVIA_GEO_CACHE = {b64Data:"' + b64 + '"};\n')
    print(f'[iqvia_geo] OK bricks={len(B)} markets={len(MK)} brands={len(BRD)} facts={len(facts)} positions={len(POS)} '
          f'calls matched {matched}/{filled} last={meta["last"]} -> {os.path.getsize(OUT)//1024:,} KB '
          f'({(datetime.datetime.now()-t0).seconds}s)')

if __name__ == '__main__':
    main()
