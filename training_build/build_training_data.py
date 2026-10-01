# -*- coding: utf-8 -*-
"""Build ONE fake cache for the training dashboard.
usage: python3 training_build/build_training_data.py <names.json> <cache> [<cache> ...]
Reads cache/<name>.data.js (production, read-only), writes training/cache/<name>.data.js.
Every person name -> fictional name, every customer/place (Arabic) -> "Customer N"/"Area N",
employee codes -> fake codes, and numbers randomised (sales, targets, visits, market data)."""
import sys, os, json, re, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake as F

F.load_names(sys.argv[1])
DEMO_EMAIL = 'zeta.line@zeta-pharma.com'
DEMO_USER = {"name": "Zeta Line Manager", "role": "Line Manager", "bu": ["GIT"], "lines": ["GIT-I"], "dm1s": None, "prods": None}

def check(name, obj):
    bad = F.leaks(obj)
    if bad:
        print('[training] LEAK CHECK FAILED for', name, len(bad), bad[:8])
        sys.exit(2)
    print('[training] leak check OK:', name)

def generic(name):
    t, obj, span = F.load_cache(name)
    new = F.walk(obj)
    if name == 'customer_analytics':
        for cl in new.get('clusters', {}).values():
            for c in cl.get('customers', []):
                if isinstance(c.get('name'), str) and not c['name'].startswith('Customer '):
                    c['name'] = F.fake_customer(c['name'])
    check(name, new)
    if span: F.write_b64(name, t, span, new)
    else: F.write_plain(name, t[t.index('window.') + 7:t.index('=')].strip(), new)

def records():
    t, obj, span = F.load_cache('records')
    fi = {f: i for i, f in enumerate(obj['fields'])}
    V, C, R, FQ, PF = fi['visits'], fi['coveredDoctor'], fi['rightFreq'], fi['frequency'], fi['proratedFrequency']
    TI, PI = fi['teamIdx'], fi['periodIdx']
    for r in obj['rows']:
        b = F.factor('cov', r[TI], r[PI], lo=-0.30, hi=0.30)        # hidden team/month bias
        x = F.RNG.random()
        v = r[V] + (1 if x > 0.85 else (-1 if x < 0.15 else 0))
        y = F.RNG.random()
        if b > 0 and y < b: v += 1
        if b < 0 and y < -b: v -= 1
        v = max(0, v); r[V] = v
        r[C] = 1 if v > 0 else 0
        need = r[PF] if r[PF] is not None and r[PF] >= 0 else r[FQ]
        r[R] = 1 if (v > 0 and v >= (need or 0)) else 0
    F.write_b64('records', t, span, obj)

def sales():
    t, obj, span = F.load_cache('sales')
    obj['lookups'] = {k: [F.fake_string(x) if isinstance(x, str) else x for x in v] if isinstance(v, list) else v for k, v in obj['lookups'].items()}
    obj['lookups']['chains'] = [x if x == '(none)' else 'Pharmacy Chain %03d' % i for i, x in enumerate(obj['lookups']['chains'])]
    for r in obj['rows']:
        # hidden factors: line (actual and target separately), rep, product, month
        fa = (F.factor('sl', r[1], lo=0.55, hi=0.8) * F.factor('sr', r[4], lo=0.7, hi=1.3) *
              F.factor('sp', r[3], lo=0.75, hi=1.25) * F.factor('sm', r[0], r[1], lo=0.85, hi=1.15))
        ft = (fa / F.factor('sm', r[0], r[1], lo=0.85, hi=1.15) * F.factor('slt', r[1], lo=0.8, hi=1.2) *
              F.factor('srt', r[4], lo=0.85, hi=1.15))
        for j in (18, 19): r[j] = round(r[j] * fa, 2) if r[j] else r[j]
        for j in (20, 21): r[j] = round(r[j] * ft, 2) if r[j] else r[j]
        for j in (22, 23, 24, 25): r[j] = round(r[j] * fa, 2) if r[j] else r[j]
    # realism: rescale each line's targets so YTD achievement (official, non-tender) lands at a
    # believable hidden value between 88% and 108% -- it then carries no trace of the real figure
    act, tgt = {}, {}
    for r in obj['rows']:
        m = r[17]
        if not m & 16 and not m & 2: act[r[1]] = act.get(r[1], 0) + (r[19] or 0)
        elif m & 16 and m & 32 and not m & 64: tgt[r[1]] = tgt.get(r[1], 0) + (r[21] or 0)
    k = {ln: (act[ln] / (tgt[ln] * F.factor('ach', ln, lo=0.88, hi=1.08))) for ln in act if tgt.get(ln)}
    for r in obj['rows']:
        if r[17] & 16 and r[1] in k:
            for j in (20, 21): r[j] = round(r[j] * k[r[1]], 2) if r[j] else r[j]
    for c in obj['customers']:
        c[6] = round(c[6] * F.factor('sc', c[0], lo=0.7, hi=1.3) * F.GLOBAL_SCALE, 2) if c[6] else c[6]
    check('sales', {'lookups': obj['lookups']})
    F.write_b64('sales', t, span, obj)

def list_intel():
    t, obj, span = F.load_cache('list_intel')
    def strings(o):
        if isinstance(o, dict): return {F.fake_string(k): strings(v) for k, v in o.items()}
        if isinstance(o, list): return [strings(x) for x in o]
        if isinstance(o, str): return F.fake_string(o)
        return o
    obj['reps'] = strings(obj['reps'])
    custs = {}
    for emp, rows in obj['customers'].items():
        out = []
        for c in rows:
            c = list(c)
            if isinstance(c[0], str): c[0] = F.CUST_MAP.get(c[0]) or F.fake_customer(c[0])
            if isinstance(c[4], str) and c[4]: c[4] = F.fake_area(c[4])
            if isinstance(c[6], str) and c[6]: c[6] = F.fake_area(c[6])
            out.append(c)
        custs[F.fake_string(emp)] = out
    obj['customers'] = custs
    obj['meta'] = strings(obj['meta'])
    check('list_intel', obj)
    F.write_b64('list_intel', t, span, obj)

def iqvia():
    t = open(os.path.join(F.PROD_CACHE, 'iqvia.data.js'), encoding='utf-8').read()
    o = json.loads(t[t.index('=') + 1:].strip().rstrip(';'))
    import base64, gzip
    flat = json.loads(gzip.decompress(base64.b64decode(o['b64Data'])))
    for k in range(0, len(flat), 14):
        f = (F.factor('iqc', flat[k], lo=0.5, hi=1.5) * F.factor('iq', flat[k], flat[k + 1], lo=0.7, hi=1.3) *
             F.factor('iqt', flat[k], flat[k + 2] // 6, lo=0.85, hi=1.15) * (0.95 + 0.1 * F.RNG.random()) * F.GLOBAL_SCALE)
        if flat[k + 6]: flat[k + 6] = round(flat[k + 6] * f)
        if flat[k + 7]: flat[k + 7] = round(flat[k + 7] * f)
    o['b64Data'] = F.enc(flat)
    o['users'] = {DEMO_EMAIL: dict(DEMO_USER, hash=demo_hash())}
    o['kpis'] = F.walk(o['kpis'])
    o['targets'] = F.walk(o['targets'])
    o['restatements'] = F.walk(o['restatements'])
    F.write_plain('iqvia', 'IQVIA_CACHE', o)

def demo_hash():
    pwd = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'demo_password.txt'), encoding='utf-8').read().strip()
    return hashlib.sha256((DEMO_EMAIL + ':' + pwd + ':ZETA2026INTEL').encode()).hexdigest()

def auth():
    F.write_plain('auth', 'AUTH_USERS', {DEMO_EMAIL: dict(DEMO_USER, hash=demo_hash())})

def ims_rx():
    t, obj, span = F.load_cache('ims_rx')
    fa = obj['fact']; st = fa['stride']; pi = fa['fields'].index('product'); rows = fa['rows']
    flds = fa['fields']
    xs = [flds.index(x) for x in ('specialty', 'region') if x in flds]
    fa['rx'] = [round(v * F.factor('rx', rows[i * st + pi], lo=0.6, hi=1.4) *
                      F.factor('rxsr', *[rows[i * st + j] for j in xs], lo=0.6, hi=1.4) *
                      (0.9 + 0.2 * F.RNG.random()) * F.GLOBAL_SCALE, 2) if v else v for i, v in enumerate(fa['rx'])]
    lk = obj['lookups']
    for key in ('unitsMarketIntel2025', 'valueMarketIntel2025'):
        lk[key] = [round(v * F.factor('rx', i, lo=0.6, hi=1.4) * F.GLOBAL_SCALE, 2) if v else v for i, v in enumerate(lk[key])]
    obj['meta'] = F.walk(obj['meta'])
    F.write_b64('ims_rx', t, span, obj)

def market_intel():
    t, obj, span = F.load_cache('market_intel')
    a = obj['annual']; st = a['stride']; pi = a['fields'].index('product') if 'product' in a['fields'] else 1; rows = a['rows']
    for i in range(len(a['units'])):
        ci = a['fields'].index('corp') if 'corp' in a['fields'] else None
        f = (F.factor('mi', rows[i * st + pi], lo=0.6, hi=1.4) * (0.9 + 0.2 * F.RNG.random()) * F.GLOBAL_SCALE *
             (F.factor('mic', rows[i * st + ci], lo=0.5, hi=1.5) if ci is not None else 1))
        a['units'][i] = round(a['units'][i] * f, 2) if a['units'][i] else a['units'][i]
        a['value'][i] = round(a['value'][i] * f * (0.95 + 0.1 * F.RNG.random()), 2) if a['value'][i] else a['value'][i]
        if a['units'][i]: a['price'][i] = round(a['value'][i] / a['units'][i], 2)
    obj['meta'] = F.walk(obj['meta'])
    F.write_b64('market_intel', t, span, obj)

def tms_ims():
    t = open(os.path.join(F.PROD_CACHE, 'tms_ims.data.js'), encoding='utf-8').read()
    def fix(var, qty_cols):
        nonlocal t
        m = re.search(r'var %s=(\[.*?\]);' % var, t, re.S)
        if not m: return
        rows = json.loads(m.group(1))
        for r in rows:
            f = F.factor('tm', *r[:7], lo=0.65, hi=1.35) * F.factor('tml', r[2], lo=0.55, hi=0.85)
            for j in qty_cols(r):
                if isinstance(r[j], (int, float)) and r[j]: r[j] = round(r[j] * f)
        t = t[:m.start(1)] + json.dumps(rows) + t[m.end(1):]
    fix('ROWS', lambda r: [len(r) - 2, len(r) - 1])
    fix('OPENING', lambda r: [4])
    F._write('tms_ims', t)

def stub(name):
    F._write(name, '/* %s: not included in the training dashboard */\n' % name)

def copy(name):
    F._write(name, open(os.path.join(F.PROD_CACHE, name + '.data.js'), encoding='utf-8').read())

H = {'records': records, 'sales': sales, 'list_intel': list_intel, 'iqvia': iqvia, 'auth': auth,
     'ims_rx': ims_rx, 'market_intel': market_intel, 'tms_ims': tms_ims}
GENERIC = {'dashboard', 'teamkpis', 'organogram', 'working_days', 'coaching', 'customer_analytics', 'metadata'}
STUBS = {'sprint', 'business_review', 'expense_budget', 'regulatory_pipeline', 'egypt_registration'}
COPY = {'news_latest', 'news_archive', 'build_manifest'}
for c in sys.argv[2:]:
    if c in H: H[c]()
    elif c in GENERIC: generic(c)
    elif c in STUBS: stub(c)
    elif c in COPY: copy(c)
    else: print('unknown cache', c); sys.exit(1)
