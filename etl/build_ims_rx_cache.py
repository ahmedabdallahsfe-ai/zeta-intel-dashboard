"""
etl/build_ims_rx_cache.py
=============================================================================
Builds cache/ims_rx.data.js -- the data layer behind a future IMS RX
(physician-panel prescription-volume) workspace.

SOURCE: "IMS RX TOTAL YEAR 2025.xlsx" in the project root.
  Sheet "Consolidated Product Data", 189,096 rows, grain = Product x
  Molecule x ATC3 x ATC4 x Form x DOC SPEC (prescribing specialty) x
  DOC REG (region) x Diagnosis, for 3 annual snapshots (MAT Dec 2023,
  MAT Dec 2024, MAT Dec 2025/YTD).

  This is a physician-panel Rx-COUNT audit -- not a sales-value dataset.
  It carries no Corporation/manufacturer field and no monetary value of
  its own. See CORPORATION JOIN below for how that gap is closed.

DATA-QUALITY FIXES APPLIED (see IMS_RX_2025_Assessment.docx Section D)
-----------------------------------------------------------------------------
  1. Exact-duplicate rows dropped (1,009 of 189,096 -- full-row duplicates,
     overstated every period's total by 0.07-0.11%).
  2. Rows with zero data in all 3 MAT periods dropped (1,514 raw rows; all
     1,514 turned out to already be counted in the 1,009 duplicates above,
     so this step removes 757 additional unique rows after dedup).
  3. "Dosage Form" column dropped entirely -- its VLOOKUP formula pointed
     at a deleted range (#REF!) and evaluated to the literal string
     "UNMAPPED" on 100% of rows. Unrecoverable; replaced by (4).
  4. "dosage_form_category" derived from "New Form Code 1" (17 distinct,
     fully-populated, human-readable values) via an explicit, Ahmed-
     approved mapping (2026-08-15) into 9 route-of-administration buckets.
     See DOSAGE_FORM_CATEGORY_MAP below.

CORPORATION + UNITS JOIN (2026-08-15, expanded 2026-08-15 pm)
-----------------------------------------------------------------------------
  This file has no Corporation field and no sales-Units/Value field.
  "IMS 2022 to April 2026.xlsx" (the source behind cache/market_intel.data.js)
  DOES carry Corporation, Units and LC Value, at SKU level, for 2022-2026.
  IMS RX's brand-level Product names were joined to that file's SKU-level
  Product names by a word-boundary prefix match (e.g. "BRUFEN" matches
  "BRUFEN F.C.T RETARD 800MG 20" but not "BRUFENOL..." -- the match requires
  the SKU string to equal the brand name or start with "<brand> ").

  Corporation coverage (share of MAT Dec 2025 Rx volume):
    96.1%  matched to exactly one Corporation  -> corpConfidence = 2 (unambiguous)
     2.1%  matched to >1 Corporation (generics: Ceftriaxone, Folic Acid,
           Omega 3, etc. -- multiple manufacturers make the same molecule
           under the same brand-family name) -> corpConfidence = 1 (ambiguous)
     1.8%  no SKU match at all                -> corpConfidence = 0 (unmatched)

  corp is stored as a Dim_Product attribute (one value per product, not
  per fact row) -- corps[i] is a LIST of candidate corporation names;
  ambiguous/unmatched products carry >1 or 0 entries respectively. Any
  consumer MUST branch on corpConfidence before treating corp as a fact
  -- do not silently pick corps[i][0] for ambiguous/unmatched products.

  The SAME join also sums 2025 Units and LC Value across every matched SKU,
  exposed per-product as unitsMarketIntel2025 / valueMarketIntel2025 (0 when
  unmatched). This is a DIFFERENT metric family from Rx (physician-panel
  prescription count vs. sell-out sales volume/value) -- the consuming page
  MUST present them side by side, never as a computed ratio framed as a
  single KPI (a "Rx per Unit" figure is easy to build and easy to
  over-interpret; if shown at all it needs an explicit caveat inline).

FACT TABLE GRAIN
-----------------------------------------------------------------------------
  1 row = Product x Molecule x ATC4 x Specialty x Region x Diagnosis x
  Period. (ATC3 is derivable from ATC4 -- verified 0 ATC4 values map to
  >1 ATC3 -- so ATC3 is NOT a separate key, only a lookup attribute of
  ATC4, same treatment as Dim_ATC in the assessment's Section F.)

  Source MAT-block columns are UNPIVOTED into this Period dimension so a
  future year is a new row, not a new column (matches the row-based
  ETL-to-cache pattern used by every other workspace on this platform).

  Growth% and Market Share are intentionally NOT carried from source and
  NOT precomputed here. The source's own Growth% column is unsafe (27%
  of populated values are hard -100% against a NULL, not zero, current
  volume -- see assessment Section D #2) and Market Share's denominator
  is the entire national file, not any filtered subset. Both must be
  computed by the consumer as SUM(current) vs SUM(prior), aggregated
  first, divided once -- never averaged/summed as stored percentages.

OUTPUT SHAPE
-----------------------------------------------------------------------------
Dictionary-encoded, gzipped, base64'd -- same convention as every other
cache on this platform.

  meta      row counts, dedup/cleanup counts, corp-join coverage, source
  lookups   { products, corps (per-product candidate list), corpConfidence,
              molecules, atc3s, atc4s (parent atc3 index), forms,
              dosageFormCategories, specialties, regions, diagnoses,
              periods }
  fact      flat Int array, 8 dimension indices per row:
              [period, product, molecule, atc4, specialty, region, diagnosis,
               dosageFormCategory]
            + a parallel float array: rx

Run:  python etl/build_ims_rx_cache.py
=============================================================================
"""

import os
import re
import sys
import json
import gzip
import base64
import time
from datetime import datetime

try:
    from python_calamine import CalamineWorkbook
except ImportError:
    print("ERROR: python_calamine is required.  pip install python-calamine")
    sys.exit(1)

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_IMS_RX = os.path.join(ROOT_DIR, 'IMS RX TOTAL YEAR 2025.xlsx')
SOURCE_MARKET_INTEL = os.path.join(ROOT_DIR, 'IMS 2022 to April 2026.xlsx')
OUT_JS = os.path.join(ROOT_DIR, 'cache', 'ims_rx.data.js')
OUT_JSON = os.path.join(ROOT_DIR, 'cache', 'ims_rx.json')
# 2026-09-28: DM1/DM2 market definitions are read from the IQVIA cache
# (built by refresh_iqvia.py from iqvia_source/IQVIA_SOURCE.xlsx) -- see
# attach_market_defs() below. Derived artifact, never a raw source.
IQVIA_CACHE_JSON = os.path.join(ROOT_DIR, 'cache', 'iqvia.json')

SHEET_IMS_RX = 'Consolidated Product Data'
SHEET_MARKET_INTEL_ANNUAL = 'IMS 2022 - 2026 '   # trailing space is in the workbook

SCHEMA_VERSION = 1

# Approved 2026-08-15 (chat) -- maps the 17 "New Form Code 1" values into
# 9 route-of-administration buckets for the Form/Route Mix KPI.
DOSAGE_FORM_CATEGORY_MAP = {
    'A ORAL SOLID ORDINARY': 'Oral',
    'B ORAL SOLID RETARD': 'Oral',
    'D ORAL LIQUID ORDINARY': 'Oral',
    'E ORAL LIQUID RETARD': 'Oral',
    'K ORAL TOPICAL': 'Oral',
    'F PARENTERAL ORDINARY': 'Parenteral',
    'G PARENTERAL RETARD': 'Parenteral',
    'M TOPIC DERMATOL HAEMOR EXTERN': 'Topical/Dermal',
    'N OPHTHALMIC': 'Ophthalmic',
    'Q NASAL TOPICAL': 'Nasal',
    'I NASAL SYSTEMIC': 'Nasal',
    'P OTIC': 'Otic',
    'H RECTAL SYSTEMIC': 'Rectal/Vaginal',
    'T VAGINAL': 'Rectal/Vaginal',
    'R LUNG ADMINISTRATION': 'Respiratory',
    'J OTHER SYSTEMIC': 'Other/Systemic-Unclassified',
    'V NON-HUMAN USE AND OTHERS': 'Other/Systemic-Unclassified',
}

PERIOD_LABELS = ['MAT Dec 2023', 'MAT Dec 2024', 'MAT Dec 2025']
MAT_COLS = [
    'MAT Dec 2023\nProj. RX',
    'MAT Dec 2024\nProj. RX',
    'MAT Dec 2025\nProj. RX',
]

t0 = time.time()


def log(msg):
    print(f'  [{time.time() - t0:6.1f}s] {msg}', flush=True)


def norm(v):
    """Collapse whitespace, strip, upper -- the join-key convention
    (matches etl/build_market_intel_cache.py's norm())."""
    if v is None:
        return ''
    return ' '.join(str(v).split()).upper()


def clean(v):
    if v is None:
        return ''
    return ' '.join(str(v).split())


def to_float(v):
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


class Dim:
    """Dictionary encoder: value -> stable integer index."""

    def __init__(self):
        self.values = []
        self._idx = {}

    def add(self, v):
        i = self._idx.get(v)
        if i is None:
            i = len(self.values)
            self._idx[v] = i
            self.values.append(v)
        return i

    def __len__(self):
        return len(self.values)


MARKET_INTEL_JOIN_YEAR = 2025


def load_market_intel_join_index():
    """Reads Product/Corporation/Calendar Year/Units/LC Value from the Market
    Intel source sheet. Returns:
      sku_index: {normalized_full_product: {'corps': set(), 'units2025': float,
                                              'value2025': float}}
      bucket:    {first_word: set(normalized_full_product)}  -- for fast
                 prefix lookup against IMS RX brand names.
    A single normalized product string can appear on multiple raw rows
    (different TA/ATC4/launch-year/price-band splits) -- corps accumulates
    every distinct Corporation seen for that SKU string, units2025/value2025
    sum across all of them."""
    log(f'opening {os.path.basename(SOURCE_MARKET_INTEL)} for Corporation + Units join '
        f'({os.path.getsize(SOURCE_MARKET_INTEL) // (1024 * 1024)} MB)')
    wb = CalamineWorkbook.from_path(SOURCE_MARKET_INTEL)
    rows = wb.get_sheet_by_name(SHEET_MARKET_INTEL_ANNUAL).to_python()
    head = rows[0]
    ci = {n: i for i, n in enumerate(head)}
    p_col, c_col, y_col, u_col, v_col = (
        ci['Product'], ci['Corporation'], ci['Calendar Year'], ci['Units'], ci['LC Value'])

    from collections import defaultdict
    sku_index = {}
    for r in rows[1:]:
        if not r or r[p_col] is None:
            continue
        full = norm(r[p_col])
        if not full:
            continue
        entry = sku_index.get(full)
        if entry is None:
            entry = {'corps': set(), 'units2025': 0.0, 'value2025': 0.0}
            sku_index[full] = entry
        corp = clean(r[c_col]) or '(Unknown)'
        entry['corps'].add(corp)
        year = to_float(r[y_col])
        if year is not None and int(year) == MARKET_INTEL_JOIN_YEAR:
            entry['units2025'] += to_float(r[u_col]) or 0.0
            entry['value2025'] += to_float(r[v_col]) or 0.0

    bucket = defaultdict(set)
    for full in sku_index:
        bucket[full.split(' ')[0]].add(full)

    log(f'Market Intel product index: {len(sku_index):,} distinct SKUs across '
        f'{len(bucket):,} first-word buckets')
    return sku_index, bucket


def resolve_market_intel(brand_norm, sku_index, bucket):
    """Word-boundary prefix match: does any Market Intel SKU equal this
    brand name or start with '<brand> '? Returns (sorted corp list,
    summed units2025, summed value2025) across every matching SKU --
    empty list / 0.0 / 0.0 if nothing matches."""
    fw = brand_norm.split(' ')[0]
    candidates = bucket.get(fw, ())
    corps = set()
    units2025 = 0.0
    value2025 = 0.0
    matched = False
    for full in candidates:
        if full == brand_norm or full.startswith(brand_norm + ' '):
            matched = True
            entry = sku_index[full]
            corps |= entry['corps']
            units2025 += entry['units2025']
            value2025 += entry['value2025']
    if not matched:
        return [], 0.0, 0.0
    return sorted(corps), units2025, value2025



# -----------------------------------------------------------------------------
# DM1 / DM2 MARKET DEFINITIONS (added 2026-09-28)
# -----------------------------------------------------------------------------
# IMS Rx has no "DEFIND Market_1/2" of its own. The authoritative market
# definitions live in IQVIA_SOURCE.xlsx and are already compiled into
# cache/iqvia.json (flat rows: corp, prod, period, atc4, dm1, dm2, ...,
# stride 14). This step derives, from that cache, which DM1/DM2 markets each
# Product x ATC4 pair belongs to and attaches it to the Rx cache.
#
# JOIN KEY: norm(Product) + norm(ATC4) -- IQVIA product names are brand-level,
# same grain as IMS Rx. ATC4 is part of the key so a brand name reused in an
# unrelated class (e.g. TELFAST under R01B0 nasal preps) is NOT pulled into
# the R06A0 antihistamine market.
#
# MEMBERSHIP, NOT ALLOCATION: IMS Rx is brand-level (no strength / pack), but
# several IQVIA markets split the same brand by strength or form (ELEMBOSIS
# 2.5 vs 5, Duloxetine 20/30 vs 60, BELASTINE tab vs combined oral
# antihistamine, ESOMEPRAZOLE sachet vs PPI oral solid). A brand's Rx
# therefore counts in EVERY market its IQVIA SKUs belong to -- market totals
# overlap and must never be summed across markets. 'OTHER MARKET' / '(none)'
# are not markets and are excluded.
#
# OUTPUT (lookups): dm1s, dm2s (market names), prodAtc4Dm = list of
#   [productIdx, atc4Idx, [dm1 idx...], [dm2 idx...]] for pairs present in Rx.
NON_MARKET_DM = {'', '(NONE)', 'OTHER MARKET'}
IQVIA_STRIDE = 14


def attach_market_defs(cache):
    L = cache['lookups']
    meta = cache.setdefault('meta', {})
    L['dm1s'], L['dm2s'], L['prodAtc4Dm'] = [], [], []
    try:
        with open(IQVIA_CACHE_JSON, 'r', encoding='utf-8') as fh:
            q = json.load(fh)
        ql = q['lookups']
        flat = json.loads(gzip.decompress(base64.b64decode(q['b64Data'])).decode('utf-8'))
    except Exception as e:
        log(f'WARNING: DM1/DM2 market definitions NOT attached ({e}) -- filters will be empty')
        meta['marketDefs'] = {'attached': False, 'error': str(e)}
        return
    if len(flat) % IQVIA_STRIDE:
        log('WARNING: cache/iqvia.json flat length is not a multiple of 14 -- market defs skipped')
        meta['marketDefs'] = {'attached': False, 'error': 'iqvia stride mismatch'}
        return

    pair_dm = {}
    for k in range(0, len(flat), IQVIA_STRIDE):
        d1 = ql['dm1s'][flat[k + 4]]
        d2 = ql['dm2s'][flat[k + 5]]
        ok1 = norm(d1) not in NON_MARKET_DM
        ok2 = norm(d2) not in NON_MARKET_DM
        if not (ok1 or ok2):
            continue
        key = (norm(ql['prods'][flat[k + 1]]), norm(ql['atc4s'][flat[k + 3]]))
        e = pair_dm.setdefault(key, (set(), set()))
        if ok1:
            e[0].add(d1)
        if ok2:
            e[1].add(d2)

    dm1_names = sorted({d for a, _ in pair_dm.values() for d in a}, key=lambda x: x.upper())
    dm2_names = sorted({d for _, b in pair_dm.values() for d in b}, key=lambda x: x.upper())
    i1 = {n: i for i, n in enumerate(dm1_names)}
    i2 = {n: i for i, n in enumerate(dm2_names)}

    f = cache['fact']
    rows, st = f['rows'], f['stride']
    pi, ai, ti = f['fields'].index('product'), f['fields'].index('atc4'), f['fields'].index('period')
    products, atc4s = L['products'], L['atc4s']
    pair_map = {}
    for key, (a, b) in pair_dm.items():
        pair_map[key] = (sorted(i1[x] for x in a), sorted(i2[x] for x in b))

    out, seen = [], set()
    rx_last, rx_last_mapped = 0.0, 0.0
    last_p = max(rows[ti::st]) if rows else 0
    dm1_rx = {}
    for i in range(len(f['rx'])):
        base = i * st
        pa = (rows[base + pi], rows[base + ai])
        m = pair_map.get((norm(products[pa[0]]), norm(atc4s[pa[1]])))
        if rows[base + ti] == last_p:
            rx_last += f['rx'][i]
            if m:
                rx_last_mapped += f['rx'][i]
                for d in m[0]:
                    dm1_rx[d] = dm1_rx.get(d, 0.0) + f['rx'][i]
        if m and pa not in seen:
            seen.add(pa)
            out.append([pa[0], pa[1], m[0], m[1]])
    out.sort()

    L['dm1s'], L['dm2s'], L['prodAtc4Dm'] = dm1_names, dm2_names, out
    no_rx = [dm1_names[i] for i in range(len(dm1_names)) if i not in dm1_rx]
    meta['marketDefs'] = {
        'attached': True,
        'source': 'cache/iqvia.json (IQVIA_SOURCE.xlsx DEFIND Market_1/2)',
        'joinKey': 'norm(Product) + norm(ATC4)',
        'rule': 'membership: a brand counts in every DM its IQVIA SKUs belong to; '
                'markets overlap, never sum across markets',
        'pairsMapped': len(out),
        'dm1Count': len(dm1_names), 'dm2Count': len(dm2_names),
        'latestPeriodRxMappedPct': round(rx_last_mapped / rx_last * 100, 2) if rx_last else 0,
        'dm1WithoutRx': no_rx,
        'attachedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    }
    log(f'market defs: {len(out):,} Product x ATC4 pairs -> {len(dm1_names)} DM1 / '
        f'{len(dm2_names)} DM2 markets; {len(dm1_names) - len(no_rx)} DM1 have Rx '
        f'(none: {", ".join(no_rx) or "-"})')


# -----------------------------------------------------------------------------
# PROMOTED SPECIALTIES + TARGET MARKETS (added 2026-09-28, Geo & Specialty tab)
# -----------------------------------------------------------------------------
# Joins three inputs into cache['promo']:
#   1. cache/iqvia.json targets (TARGET_MARKET_SHARE.xlsx: BU, Line, Product,
#      DM1, DM2) -- which Zeta brand owns which market, and in which line.
#      Also used client-side for Target-Achievement-style market scoping.
#   2. 'List Intell/<LINE> Promo Grid.xlsx' -> 'Specialty' blocks: brand rows
#      with a non-zero allocation (List block) or detailing weight = promoted.
#   3. config/promo_specialty_map.json -- Promo label -> IMS Rx specialty
#      crosswalk (Ahmed-approved) + brand aliases + line -> grid file map.
# A brand is matched ONLY in its own line's grid (no cross-line fallback --
# the same brand is promoted to different specialties by different lines,
# e.g. BILASTIGEC Pedia vs Derma). Unmatched brands carry status and are
# shown as "no Promo Grid data", never guessed.
PROMO_DIR = os.path.join(ROOT_DIR, 'List Intell')
PROMO_MAP_JSON = os.path.join(ROOT_DIR, 'config', 'promo_specialty_map.json')
# 2026-09-28: Ahmed edits the specialty crosswalk in Excel (yellow cells). When this
# file exists its 'Mapping' sheet REPLACES specialtyMap from the JSON; brand aliases
# and the line -> grid file map stay in the JSON.
PROMO_MAP_XLSX = os.path.join(ROOT_DIR, 'config', 'promo_specialty_map.xlsx')
_FORM_TOKENS = {'TAB', 'TABS', 'TABLET', 'SACHET', 'SACH', 'CAP', 'CAPS', 'XR', 'SR', 'MG', 'SYRUP', 'SUSP'}


def _squash(v):
    return re.sub(r'[^A-Z0-9]', '', norm(v))


def _parse_promo_grid(path):
    """{brand label: set(promo specialty labels)} from every 'Specialty' block."""
    out = {}
    wb = CalamineWorkbook.from_path(path)
    for sh in wb.sheet_names:
        rows = wb.get_sheet_by_name(sh).to_python(skip_empty_area=False)
        i = 0
        while i < len(rows):
            v = [clean(c) for c in rows[i]]
            if not (v and v[0] == 'Specialty'):
                i += 1
                continue
            hdr = []
            for x in v[1:]:
                if x.upper() in ('TOTAL', ''):
                    break
                hdr.append(x)
            j = i + 1
            while j < len(rows):
                w = [clean(c) for c in rows[j]]
                f = w[0] if w else ''
                if f == '' or f.upper() in ('TOTAL', 'SPECIALTY') or f.startswith(('Promotional', 'Physicians')):
                    break
                if f != 'List' and not f.startswith('Detailing'):
                    for k, h in enumerate(hdr):
                        val = to_float(w[k + 1]) if k + 1 < len(w) else None
                        if val and val > 0:
                            out.setdefault(f, set()).add(h)
                j += 1
            i = j
    return out


def _match_brand(line, prod, grid, aliases):
    alias = aliases.get(f'{norm(line)}|{norm(prod)}')
    if alias:
        hit = [b for b in grid if norm(b) == norm(alias)]
        return (hit[0], 'alias') if hit else (None, 'alias_not_found')
    sp = _squash(prod)
    exact = [b for b in grid if _squash(b) == sp]
    if exact:
        return exact[0], 'exact'
    pref = []
    for b in grid:
        nb = norm(b)
        if nb.startswith(norm(prod) + ' '):
            rest = re.split(r'[\s,]+', nb[len(norm(prod)):].strip())
            if all(t in _FORM_TOKENS or re.fullmatch(r'[\d.]+(MG)?', t) for t in rest if t):
                pref.append(b)
    if len(pref) == 1:
        return pref[0], 'strength_form_suffix'
    return None, ('ambiguous' if pref else 'not_in_grid')


def _load_specialty_xlsx(path, spec_idx):
    """Mapping sheet -> {NORM label: {ims:[..], status, display, note}} + warnings."""
    wb = CalamineWorkbook.from_path(path)
    rows = wb.get_sheet_by_name('Mapping').to_python(skip_empty_area=False)
    out, warn = {}, []
    for r in rows[1:]:
        v = [clean(c) for c in r] + [''] * 8
        lab = v[0]
        if not lab:
            continue
        ims = [x for x in v[2:5] if x]
        bad = [x for x in ims if norm(x) not in spec_idx]
        if bad:
            warn.append(f"'{lab}': unknown IMS Rx specialty {bad}")
            ims = [x for x in ims if norm(x) in spec_idx]
        choice = v[5].lower()
        if ims:
            status = 'mapped'
        elif choice.startswith('promoted'):
            status = 'no_ims_equivalent'
        elif choice.startswith('exclude'):
            status = 'excluded'
        else:
            status = 'unset'
            warn.append(f"'{lab}': no IMS Rx specialty and column F empty -> treated as unmapped")
        out[norm(lab)] = {'ims': ims, 'status': status, 'display': v[6] or None, 'note': v[7]}
    return out, warn


def attach_promo_specialties(cache):
    L = cache['lookups']
    meta = cache.setdefault('meta', {})
    cache['promo'] = {'targets': [], 'specialtyMapStatus': {}}
    try:
        with open(IQVIA_CACHE_JSON, 'r', encoding='utf-8') as fh:
            targets = json.load(fh).get('targets') or []
        with open(PROMO_MAP_JSON, 'r', encoding='utf-8') as fh:
            cfg = json.load(fh)
    except Exception as e:
        log(f'WARNING: promoted-specialty data NOT attached ({e})')
        meta['promoSpecialties'] = {'attached': False, 'error': str(e)}
        return
    spec_idx = {norm(s): i for i, s in enumerate(L['specialties'])}
    smap = {norm(k): v for k, v in cfg.get('specialtyMap', {}).items() if not k.startswith('_')}
    map_source, map_warn = 'config/promo_specialty_map.json', []
    if os.path.exists(PROMO_MAP_XLSX):
        try:
            smap, map_warn = _load_specialty_xlsx(PROMO_MAP_XLSX, spec_idx)
            map_source = 'config/promo_specialty_map.xlsx'
        except Exception as e:
            log(f'WARNING: could not read {os.path.basename(PROMO_MAP_XLSX)} ({e}) -- using the JSON mapping')
    for w_ in map_warn:
        log('MAPPING WARNING: ' + w_)
    aliases = {k: v for k, v in cfg.get('brandAliases', {}).items() if not k.startswith('_')}
    line_files = {norm(k): v for k, v in cfg.get('lineGridFiles', {}).items() if not k.startswith('_')}

    files = {}
    if os.path.isdir(PROMO_DIR):
        for fn in os.listdir(PROMO_DIR):
            if fn.lower().endswith('.xlsx') and ' pro' in fn.lower() and not fn.startswith('~$'):
                files[norm(fn.split(' Pro')[0].split(' pro')[0])] = os.path.join(PROMO_DIR, fn)
    grid_cache = {}

    def grid_for(line):
        keys = line_files.get(norm(line)) or [line]
        keys = keys if isinstance(keys, list) else [keys]
        merged, used = {}, []
        for k in keys:
            path = files.get(norm(k))
            if not path:
                continue
            if path not in grid_cache:
                grid_cache[path] = _parse_promo_grid(path)
            used.append(os.path.basename(path))
            for b, sp in grid_cache[path].items():
                merged.setdefault(b, set()).update(sp)
        return merged, used

    unknown_labels = set()
    out = []
    for t in targets:
        grid, used = grid_for(t.get('line', ''))
        rec = {k: t.get(k) for k in ('bu', 'line', 'prod', 'dm1', 'dm2', 'tgtDm1', 'tgtDm2')}
        rec['gridFiles'] = used
        if not used:
            rec.update(status='no_grid_file', promoted=[], promotedUnmeasurable=[])
        elif not grid:
            rec.update(status='grid_has_no_specialty_sheet', promoted=[], promotedUnmeasurable=[])
        else:
            brand, how = _match_brand(t.get('line', ''), t.get('prod', ''), grid, aliases)
            rec['gridBrand'], rec['match'] = brand, how
            promoted, unmeas, excluded = set(), set(), set()
            if brand:
                for lab in grid[brand]:
                    m = smap.get(norm(lab))
                    if m is None or m.get('status') == 'unset':
                        unknown_labels.add(lab)
                        continue
                    if m.get('status') == 'mapped':
                        for ims in m.get('ims', []):
                            if norm(ims) in spec_idx:
                                promoted.add(spec_idx[norm(ims)])
                        if 'GIT part' in (m.get('note') or ''):
                            unmeas.add('GIT')
                    elif m.get('status') == 'no_ims_equivalent':
                        unmeas.add(m.get('display') or lab)
                    else:
                        excluded.add(lab)
            rec.update(status='ok' if brand else how, promoted=sorted(promoted),
                       promotedUnmeasurable=sorted(unmeas), excludedLabels=sorted(excluded))
        out.append(rec)

    cache['promo']['targets'] = out
    cache['promo']['specialtyMapStatus'] = {k: v.get('status') for k, v in smap.items()}
    ok = sum(1 for r in out if r['status'] == 'ok')
    meta['promoSpecialties'] = {
        'attached': True, 'source': 'List Intell/*Promo Grid.xlsx + ' + map_source, 'mappingWarnings': map_warn,
        'targetsWithPromo': ok, 'targets': len(out),
        'unmappedPromoLabels': sorted(unknown_labels),
        'issues': [f"{r['line']}|{r['prod']}: {r['status']}" for r in out if r['status'] != 'ok'],
    }
    log(f'promoted specialties: {ok}/{len(out)} target products matched to a Promo Grid row'
        + (f'; UNMAPPED labels: {sorted(unknown_labels)}' if unknown_labels else ''))


def write_cache(cache):
    json_str = json.dumps(cache, separators=(',', ':'), ensure_ascii=False)
    gz = gzip.compress(json_str.encode('utf-8'), compresslevel=9)
    b64 = base64.b64encode(gz).decode('ascii')
    tmp = OUT_JSON + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(json_str)
    os.replace(tmp, OUT_JSON)
    tmp = OUT_JS + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write('window.IMS_RX_CACHE = {b64Data:"' + b64 + '"};\n')
    os.replace(tmp, OUT_JS)
    log(f'wrote {os.path.basename(OUT_JSON)}  {os.path.getsize(OUT_JSON) // 1024:,} KB')
    log(f'wrote {os.path.basename(OUT_JS)}  {os.path.getsize(OUT_JS) // 1024:,} KB (gzip+base64)')


def dm_only():
    """--dm-only: re-attach DM1/DM2 market definitions to the EXISTING Rx cache
    (cache/ims_rx.json) without re-reading the two source workbooks. Run after
    every refresh_iqvia.py so a market remap in IQVIA_SOURCE.xlsx reaches IMS Rx."""
    if not os.path.exists(OUT_JSON):
        print('ERROR: cache/ims_rx.json not found -- run a full build first.')
        sys.exit(1)
    with open(OUT_JSON, 'r', encoding='utf-8') as fh:
        cache = json.load(fh)
    attach_market_defs(cache)
    attach_promo_specialties(cache)
    write_cache(cache)
    print(f'\nIMS RX market definitions attached in {time.time() - t0:.1f}s\n')


def main():
    for src in (SOURCE_IMS_RX, SOURCE_MARKET_INTEL):
        if not os.path.exists(src):
            print(f'ERROR: source not found: {src}')
            sys.exit(1)

    print('\n=== IMS RX cache build ===', flush=True)

    mi_sku_index, mi_bucket = load_market_intel_join_index()

    log(f'opening {os.path.basename(SOURCE_IMS_RX)} '
        f'({os.path.getsize(SOURCE_IMS_RX) // (1024 * 1024)} MB)')
    wb = CalamineWorkbook.from_path(SOURCE_IMS_RX)
    rows = wb.get_sheet_by_name(SHEET_IMS_RX).to_python()
    head = rows[0]
    A = {n: i for i, n in enumerate(head)}
    raw_rows = rows[1:]
    log(f'raw: {len(raw_rows):,} rows')

    # ---- dedup exact-duplicate rows (compare on the full tuple, matching
    # the assessment's df.duplicated() check) ----
    seen = set()
    deduped = []
    n_dupe = 0
    for r in raw_rows:
        key = tuple(r)
        if key in seen:
            n_dupe += 1
            continue
        seen.add(key)
        deduped.append(r)
    log(f'dedup: {len(raw_rows):,} -> {len(deduped):,} rows ({n_dupe:,} exact duplicates removed)')

    mat_idx = [A[c] for c in MAT_COLS]

    # ---- drop rows with zero data in all 3 MAT periods ----
    kept = [r for r in deduped if any(to_float(r[i]) is not None for i in mat_idx)]
    n_allnull = len(deduped) - len(kept)
    log(f'drop all-null rows: {len(deduped):,} -> {len(kept):,} rows ({n_allnull:,} removed)')

    D = {k: Dim() for k in ('product', 'molecule', 'atc3', 'atc4', 'form',
                             'cat', 'specialty', 'region', 'diagnosis')}
    atc4_parent_atc3 = {}   # atc4_idx -> atc3_idx, verified 1:1 in assessment

    product_corp = {}        # product_idx -> sorted list of candidate corp names
    product_confidence = {}  # product_idx -> 0 unmatched / 1 ambiguous / 2 unambiguous
    product_units2025 = {}   # product_idx -> summed Market Intel Units, calendar year 2025
    product_value2025 = {}   # product_idx -> summed Market Intel LC Value, calendar year 2025

    fact_rows = []
    fact_rx = []

    n_form_unmapped = 0
    for r in kept:
        product = clean(r[A['Product']])
        molecule = clean(r[A['Molecule (consolidated)']])
        atc3 = clean(r[A['Anatomical Therapeutic Class 3']])
        atc4 = clean(r[A['Anatomical Therapeutic Class 4']])
        form = clean(r[A['New Form Code 1']])
        specialty = clean(r[A['DOC SPEC']])
        region = clean(r[A['DOC REG']])
        diagnosis = clean(r[A['Diagnosis 3']])

        cat = DOSAGE_FORM_CATEGORY_MAP.get(form)
        if cat is None:
            n_form_unmapped += 1
            cat = '(Unmapped)'

        p_i = D['product'].add(product)
        mol_i = D['molecule'].add(molecule)
        atc3_i = D['atc3'].add(atc3)
        atc4_i = D['atc4'].add(atc4)
        form_i = D['form'].add(form)
        cat_i = D['cat'].add(cat)
        spec_i = D['specialty'].add(specialty)
        reg_i = D['region'].add(region)
        diag_i = D['diagnosis'].add(diagnosis)

        prev_parent = atc4_parent_atc3.get(atc4_i)
        if prev_parent is None:
            atc4_parent_atc3[atc4_i] = atc3_i
        # (verified elsewhere: 0 violations -- not re-asserted at runtime
        # to keep the ETL fast; see assessment Section E hierarchy check)

        if p_i not in product_corp:
            candidates, units2025, value2025 = resolve_market_intel(norm(product), mi_sku_index, mi_bucket)
            product_corp[p_i] = candidates
            product_confidence[p_i] = 2 if len(candidates) == 1 else (1 if len(candidates) > 1 else 0)
            product_units2025[p_i] = round(units2025, 2)
            product_value2025[p_i] = round(value2025, 2)

        for period_i, mi in enumerate(mat_idx):
            rx = to_float(r[mi])
            if rx is None:
                continue
            fact_rows.extend([period_i, p_i, mol_i, atc4_i, spec_i, reg_i, diag_i, cat_i])
            fact_rx.append(round(rx, 2))

    log(f'fact table: {len(fact_rx):,} populated (product x period) rows '
        f'from {len(kept):,} source rows')
    if n_form_unmapped:
        log(f'  WARNING: {n_form_unmapped:,} rows had a New Form Code 1 value outside '
            f'the approved category map -- check DOSAGE_FORM_CATEGORY_MAP')

    # ---- corp-join coverage, weighted by MAT Dec 2025 Rx (period index 2) ----
    FACT_STRIDE = 8
    vol_by_conf = {0: 0.0, 1: 0.0, 2: 0.0}
    total_2025 = 0.0
    for i in range(len(fact_rx)):
        base = i * FACT_STRIDE
        if fact_rows[base] != 2:   # only MAT Dec 2025
            continue
        p_i = fact_rows[base + 1]
        vol_by_conf[product_confidence[p_i]] += fact_rx[i]
        total_2025 += fact_rx[i]

    atc4_parent_list = [atc4_parent_atc3.get(i, -1) for i in range(len(D['atc4']))]
    corps_list = [product_corp.get(i, []) for i in range(len(D['product']))]
    conf_list = [product_confidence.get(i, 0) for i in range(len(D['product']))]
    units2025_list = [product_units2025.get(i, 0.0) for i in range(len(D['product']))]
    value2025_list = [product_value2025.get(i, 0.0) for i in range(len(D['product']))]

    cache = {
        'meta': {
            'schemaVersion': SCHEMA_VERSION,
            'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'source': os.path.basename(SOURCE_IMS_RX),
            'corpJoinSource': os.path.basename(SOURCE_MARKET_INTEL),
            'rawRows': len(raw_rows),
            'exactDuplicatesRemoved': n_dupe,
            'allNullRowsRemoved': n_allnull,
            'cleanRows': len(kept),
            'factRows': len(fact_rx),
            'periods': PERIOD_LABELS,
            'grain': 'Product x Molecule x ATC4 x Specialty x Region x Diagnosis x '
                     'DosageFormCategory x Period',
            'dosageFormNote': "Source 'Dosage Form' column dropped (100% broken VLOOKUP -> "
                               "#REF!). Replaced by dosageFormCategories, derived from "
                               "'New Form Code 1' via an Ahmed-approved mapping (2026-08-15).",
            'corpJoinNote': "Corporation is NOT native to this source. Joined from "
                            "IMS 2022 to April 2026.xlsx by word-boundary brand-name prefix "
                            "match. corpConfidence: 0=unmatched, 1=ambiguous (multiple "
                            "corporations), 2=unambiguous (single corporation). Consumers "
                            "MUST branch on corpConfidence -- never read corps[i][0] blindly.",
            'corpJoinCoverageMatDec2025': {
                'unmatchedPct': round(vol_by_conf[0] / total_2025 * 100, 1) if total_2025 else 0,
                'ambiguousPct': round(vol_by_conf[1] / total_2025 * 100, 1) if total_2025 else 0,
                'unambiguousPct': round(vol_by_conf[2] / total_2025 * 100, 1) if total_2025 else 0,
            },
            'unitsJoinNote': "unitsMarketIntel2025 / valueMarketIntel2025 (per product, in "
                              "lookups) are summed from IMS 2022 to April 2026.xlsx, calendar "
                              "year 2025, across every SKU matched by the same brand-name join "
                              "as Corporation. 0 means unmatched, NOT confirmed-zero sales -- "
                              "check corpConfidence for the same product before trusting a 0. "
                              "This is a sell-out UNITS figure, a fundamentally different "
                              "measure from Rx (physician-panel prescription COUNT) -- present "
                              "side by side, never silently combine into one number.",
            'growthAndShareNote': "Growth% and Market Share are intentionally NOT stored. "
                                   "Source Growth% is unsafe (27% of populated values are "
                                   "hard -100% against NULL, not zero, current volume). "
                                   "Compute both client-side as SUM(current) vs SUM(prior), "
                                   "aggregated first, divided once.",
        },
        'lookups': {
            'products': D['product'].values,
            'corps': corps_list,
            'corpConfidence': conf_list,
            'unitsMarketIntel2025': units2025_list,
            'valueMarketIntel2025': value2025_list,
            'molecules': D['molecule'].values,
            'atc3s': D['atc3'].values,
            'atc4s': D['atc4'].values,
            'atc4ParentAtc3': atc4_parent_list,
            'forms': D['form'].values,
            'dosageFormCategories': D['cat'].values,
            'specialties': D['specialty'].values,
            'regions': D['region'].values,
            'diagnoses': D['diagnosis'].values,
            'periods': PERIOD_LABELS,
        },
        'fact': {
            'fields': ['period', 'product', 'molecule', 'atc4', 'specialty', 'region',
                       'diagnosis', 'dosageFormCategory'],
            'stride': FACT_STRIDE,
            'rows': fact_rows,
            'rx': fact_rx,
        },
    }

    attach_market_defs(cache)
    attach_promo_specialties(cache)

    json_str = json.dumps(cache, separators=(',', ':'), ensure_ascii=False)
    gz = gzip.compress(json_str.encode('utf-8'), compresslevel=9)
    b64 = base64.b64encode(gz).decode('ascii')

    os.makedirs(os.path.join(ROOT_DIR, 'cache'), exist_ok=True)

    tmp = OUT_JSON + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(json_str)
    os.replace(tmp, OUT_JSON)

    tmp = OUT_JS + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('window.IMS_RX_CACHE = {b64Data:"' + b64 + '"};\n')
    os.replace(tmp, OUT_JS)

    log(f'wrote {os.path.basename(OUT_JSON)}  {os.path.getsize(OUT_JSON) // 1024:,} KB')
    log(f'wrote {os.path.basename(OUT_JS)}  {os.path.getsize(OUT_JS) // 1024:,} KB (gzip+base64)')

    print('\n--- reconciliation ---')
    print(f'  raw rows                {len(raw_rows):,}')
    print(f'  exact duplicates removed {n_dupe:,}')
    print(f'  all-null rows removed    {n_allnull:,}')
    print(f'  clean rows               {len(kept):,}')
    print(f'  fact rows (populated)    {len(fact_rx):,}')
    print(f'  distinct products        {len(D["product"]):,}')
    print(f'  distinct molecules       {len(D["molecule"]):,}')
    print(f'  distinct ATC3 / ATC4     {len(D["atc3"]):,} / {len(D["atc4"]):,}')
    print(f'  Corporation join (MAT Dec 2025 Rx-weighted):')
    print(f'    unambiguous  {cache["meta"]["corpJoinCoverageMatDec2025"]["unambiguousPct"]}%')
    print(f'    ambiguous    {cache["meta"]["corpJoinCoverageMatDec2025"]["ambiguousPct"]}%')
    print(f'    unmatched    {cache["meta"]["corpJoinCoverageMatDec2025"]["unmatchedPct"]}%')
    matched_units_products = sum(1 for v in units2025_list if v > 0)
    print(f'  Units join: {matched_units_products:,} / {len(D["product"]):,} products have '
          f'nonzero Market Intel Units for 2025')
    print(f'  dosage form categories   {len(D["cat"]):,}  '
          f'(unmapped rows: {n_form_unmapped:,})')
    print(f'\nIMS RX cache complete in {time.time() - t0:.1f}s\n')


if __name__ == '__main__':
    if '--dm-only' in sys.argv:
        dm_only()
    else:
        main()
