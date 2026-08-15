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
    main()
