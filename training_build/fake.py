# -*- coding: utf-8 -*-
"""Shared helpers for the TRAINING dashboard fake-data build.
Reads production caches READ-ONLY and produces fake versions for training/cache/.
Nothing here writes outside training/ (and the VM scratch dir for the name list)."""
import re, json, base64, gzip, hashlib, random, os

SALT = os.environ.get('ZETA_TRAINING_SALT', 'zt-2026-orientation')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROD_CACHE = os.path.join(ROOT, 'cache')
OUT_CACHE = os.path.join(ROOT, 'training', 'cache')

# ---------------------------------------------------------------- IO
def load_cache(name):
    t = open(os.path.join(PROD_CACHE, name + '.data.js'), encoding='utf-8').read()
    m = re.search(r'b64Data\s*"?\s*:\s*"([A-Za-z0-9+/=]+)"', t)
    if m:
        return t, json.loads(gzip.decompress(base64.b64decode(m.group(1)))), m.span(1)
    i = t.index('=') + 1
    return t, json.loads(t[i:].strip().rstrip(';')), None

def enc(obj):
    return base64.b64encode(gzip.compress(json.dumps(obj, separators=(',', ':'), ensure_ascii=False).encode('utf-8'), 6)).decode()

def write_b64(name, text, span, obj):
    out = text[:span[0]] + enc(obj) + text[span[1]:]
    _write(name, out)

def write_plain(name, var, obj):
    _write(name, 'window.%s = %s;\n' % (var, json.dumps(obj, separators=(',', ':'), ensure_ascii=False)))

def _write(name, s):
    os.makedirs(OUT_CACHE, exist_ok=True)
    p = os.path.join(OUT_CACHE, name + '.data.js')
    with open(p, 'w', encoding='utf-8', newline='') as fh:
        fh.write(s)
    print('[training] wrote', os.path.relpath(p, ROOT), '%.1f MB' % (len(s) / 1e6))

# ---------------------------------------------------------------- deterministic randomness
def h(*parts):
    return int(hashlib.sha256(('|'.join(map(str, parts)) + SALT).encode('utf-8')).hexdigest()[:12], 16)

def factor(*parts, lo=0.7, hi=1.3):
    return lo + (hi - lo) * (h(*parts) % 100000) / 100000.0

RNG = random.Random(h('rng'))
# hidden global scale for every money/volume figure (so totals never equal the real ones)
GLOBAL_SCALE = factor('global-scale', lo=0.58, hi=0.78)

# ---------------------------------------------------------------- fake names
FIRST = ['Omar','Youssef','Karim','Hany','Tarek','Sherif','Amr','Hazem','Bassem','Ramy','Wael','Ayman','Hesham','Nader','Maged','Samir','Fady','Mina','Kirollos','Mostafa','Khaled','Ashraf','Adel','Tamer','Walid','Hossam','Islam','Mahmoud','Ahmed','Mohamed','Ibrahim','Yasser','Ehab','Sameh','Nabil','Osama','Ziad','Marwan','Seif','Hatem',
         'Mona','Rania','Dina','Heba','Nour','Salma','Yasmin','Mariam','Sara','Hala','Noha','Reem','Aya','Farida','Nada','Laila','Mai','Shereen','Ingy','Doaa','Marina','Christine','Rana','Ghada','Eman','Amira','Asmaa','Hagar','Yara','Nesma']
MIDDLE = ['Adel','Samir','Fathy','Hamdy','Lotfy','Fouad','Raafat','Medhat','Shawky','Helmy','Zaki','Magdy','Sobhy','Ramzy','Wahba','Rashad','Nagy','Emad','Hosny','Fawzy','Kamal','Galal','Saad','Gamal','Mounir','Nashat','Sabry','Talaat','Wagdy','Younis','Atef','Ezzat','Farouk','Gaber','Hamed','Ismail','Labib','Maher','Naguib','Refaat']
FAMILY = ['Saleh','Mansour','Ghoneim','ElSherbiny','Abdelaal','Fahmy','Hegazy','Mekky','Shalaby','Barakat','Darwish','Ezzeldin','Farag','Gabr','Haddad','Iskandar','Kandil','Lotfallah','Morsy','Nasr','Qassem','Rizk','Salama','Tawfik','Wahdan','Yacoub','Zahran','ElGamal','ElNaggar','ElBakry','Soliman','Hanna','Girgis','Abdelmalak','Shenouda','Mikhail','Attia','Basta','Khalil','Zaky']

_person = {}
_used = set()
def _norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^A-Za-z ]', ' ', s)).strip().upper()

PERSON_MAP = {}
def fake_person(name):
    """Real person name -> stable fake 4-part name, same casing style."""
    if not isinstance(name, str) or not name.strip():
        return name
    key = _norm(name)
    if not key:
        return name
    if key in PERSON_MAP:
        f = PERSON_MAP[key]
        return f.upper() if name.strip().isupper() else f
    if key not in _person:
        n = h('p', key)
        while True:
            cand = '%s %s %s %s' % (FIRST[n % len(FIRST)], MIDDLE[(n // 97) % len(MIDDLE)], MIDDLE[(n // 9973) % len(MIDDLE)], FAMILY[(n // 999331) % len(FAMILY)])
            if cand not in _used:
                break
            n += 7919
        _used.add(cand)
        _person[key] = cand
    f = _person[key]
    return f.upper() if name.strip().isupper() else f

_cust, _area = {}, {}
CUST_MAP = {}
def fake_customer(s):
    if s in CUST_MAP:
        return CUST_MAP[s]
    if s not in _cust:
        _cust[s] = 'Customer %05d' % (80000 + h('cu', s) % 19999)
    return _cust[s]
def fake_area(s):
    if s not in _area:
        _area[s] = 'Area %03d' % (len(_area) + 1)
    return _area[s]

_code = {}
def fake_code(c):
    k = str(c).split('.')[0]
    if k not in _code:
        _code[k] = str(90000 + (h('c', k) % 9000))
        while _code[k] in set(v for kk, v in _code.items() if kk != k):
            _code[k] = str(int(_code[k]) + 1)
    v = _code[k]
    return int(v) if isinstance(c, int) else v

ARABIC = re.compile(r'[؀-ۿ]')

# ---------------------------------------------------------------- known real person names
NAMES = set()      # normalized real person names
_name_re = None
def load_names(path):
    global _name_re
    d = json.load(open(path, encoding='utf-8'))
    NAMES.update(d['names']); PERSON_MAP.update(d['person_map']); CUST_MAP.update(d['cust_map'])
    alts = sorted((n for n in NAMES if len(n.split()) >= 3), key=len, reverse=True)
    _name_re = re.compile(r'\b(' + '|'.join(re.escape(a) for a in alts) + r')\b', re.I) if alts else None

SUFFIX = re.compile(r'^(.*?)(_BU|_CM|_BU_Zeta|_Zeta)?$', re.S)
def is_person(s):
    if not isinstance(s, str):
        return False
    base = SUFFIX.match(s.strip()).group(1)
    return _norm(base) in NAMES

import functools
@functools.lru_cache(maxsize=None)
def _fs_cached(s):
    return _fake_string(s)
def fake_string(s):
    if not isinstance(s, str) or not s:
        return s
    return _fs_cached(s)
def _fake_string(s):
    """Generic string transform: person names, Arabic customer/place text, embedded names."""
    if not isinstance(s, str) or not s:
        return s
    st = s.strip()
    m = SUFFIX.match(st)
    base, suf = m.group(1), m.group(2) or ''
    if _norm(base) in NAMES:
        return fake_person(base) + suf
    if st.upper().startswith('VACANT'):
        return s
    if ARABIC.search(s):
        return fake_customer(s)
    if _name_re is not None and len(s) > 12 and _name_re.search(s):
        return _name_re.sub(lambda mm: fake_person(mm.group(0)), s)
    return s

# ---------------------------------------------------------------- numbers
SKIP_KEY = re.compile(r'(idx|index|^id$|code|year|schema|version|stride|multiplier|tolerance|order|^months?$|workingdays|maxdays|monthlydays|^span$|count$|^n$)', re.I)
PCT_KEY = re.compile(r'(pct|percent|rate|share|ratio|ach)', re.I)
def noise_num(v, key='', path=''):
    if isinstance(v, bool) or v is None or v == 0:
        return v
    if key and SKIP_KEY.search(key) and not PCT_KEY.search(key):
        return v
    if key and PCT_KEY.search(key):
        f = 0.85 + 0.27 * RNG.random()
        nv = v * f
        if 0 < abs(v) <= 1 and isinstance(v, float):
            nv = max(min(nv, 1.0), -1.0)
        elif 1 < v <= 100 and re.search('pct|rate|percent', key, re.I):
            nv = min(nv, 100.0)
        return round(nv, 4) if isinstance(v, float) else int(round(nv))
    f = (0.85 + 0.3 * RNG.random()) * GLOBAL_SCALE
    if isinstance(v, int):
        return max(0, int(round(v * f))) if v > 0 else int(round(v * f))
    return round(v * f, 2)

CUST_KEY = re.compile(r'(customerNames|NotSeenList|UncoveredCustomers|customerName$|^customer$|^chains$|^pharmacy$|^chain$)', re.I)
def walk(o, key='', path=''):
    """Generic transform of a JSON tree: names in keys/values, numbers noised."""
    if isinstance(o, dict):
        out = {}
        for k, v in o.items():
            nk = fake_string(k) if isinstance(k, str) else k
            if re.search(r'code', k, re.I) and isinstance(v, (str, int)) and not isinstance(v, bool) and str(v).split('.')[0].isdigit():
                out[nk] = fake_code(v)
            elif re.search(r'codes$', k, re.I) and isinstance(v, list):
                out[nk] = [fake_code(x) if str(x).split('.')[0].isdigit() else x for x in v]
            else:
                out[nk] = walk(v, k, path + '/' + str(k))
        return out
    if isinstance(o, list):
        return [walk(x, key, path) for x in o]
    if isinstance(o, str):
        if key and CUST_KEY.search(key) and o and o not in ('(none)', ''):
            return CUST_MAP.get(o) or fake_customer(o)
        return fake_string(o)
    if isinstance(o, (int, float)):
        return noise_num(o, key, path)
    return o

# ---------------------------------------------------------------- verification
def leaks(obj):
    """Return list of leftover real-looking strings (person names or Arabic)."""
    bad = []
    seen = set()
    def chk(s):
        if s in seen: return
        seen.add(s)
        if ARABIC.search(s):
            bad.append(('arabic', s[:60]))
        elif is_person(s):
            bad.append(('name', s[:60]))
        elif _name_re is not None and len(s) > 12 and _name_re.search(s):
            bad.append(('embedded', s[:80]))
    def rec(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if isinstance(k, str): chk(k)
                rec(v)
        elif isinstance(o, list):
            for x in o: rec(x)
        elif isinstance(o, str):
            chk(o)
    rec(obj)
    return bad
