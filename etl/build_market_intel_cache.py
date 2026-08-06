"""
etl/build_market_intel_cache.py
=============================================================================
Builds cache/market_intel.data.js -- the data layer behind the Total Market
Intelligence workspace (js/market-intel.js).

SOURCE: "IMS 2022 to April 2026.xlsx" in the project root.

ANNUAL-ONLY (revised 2026-08-06)
-----------------------------------------------------------------------------
An earlier build shipped a second, monthly cube (573,467 cells, ~4MB of the
7.3MB payload) to drive month-level trend charts. Removed, for two reasons:

  1. Ahmed's instruction -- market trend is read annually here; the month
     split is not the unit of analysis for this dataset.
  2. It earned nothing. The monthly sheet reconciles to the annual sheet
     EXACTLY on every shared year (2022: 119.00B vs 119.00B; 2023, 2024,
     2025 all 0.0% difference, units likewise). It was the same market,
     re-cut -- so it added 4MB of payload and a second set of filters
     (Period, Sector) that could not narrow any of the annual figures the
     rest of the workspace is built on.

Dropping it halves the cache and removes two filters that looked live but
could not affect the numbers beside them. The trade-off is 2021, which
existed only in the monthly sheet -- outside this workbook's stated
"2022 to April 2026" scope anyway.

SOURCE SHEET
-----------------------------------------------------------------------------
  Sheet "IMS 2022 - 2026 "   62,065 rows, ANNUAL grain, 2022..2026
      ATC4, Therapeutic Area, Corporation, Molecule, Product, Brand, Form,
      Launch Date, Retail Price, Units, LC Value.

  Sheet "Egypt Combined Data" is deliberately NOT read -- see ANNUAL-ONLY
  above. "TA Mapping" and "Molecule Mapping" are still read to backfill the
  handful of annual rows whose Therapeutic Area is blank.

JOIN KEYS
-----------------------------------------------------------------------------
  ATC4 -> Therapeutic Area   via sheet "TA Mapping"        (99.99% hit)
  Product -> Molecule        via sheet "Molecule Mapping"  (99.9% hit)

The molecule map keys on the ANNUAL sheet's "Product" column directly
(e.g. "HEXITOL MOUTH WASH 100ML"). Both sides are whitespace-collapsed and
upper-cased before lookup. The annual sheet already carries Molecule, so
this map is only a fallback for blanks.

OUTPUT SHAPE
-----------------------------------------------------------------------------
Dictionary-encoded, gzipped, base64'd -- same convention as every other
cache on this platform, so the browser downloads ~1-2MB instead of ~80MB.

  lookups   { tas, atc4s, corps, molecules, products, brands, forms,
              years, priceBands }
  annual    flat Int array, 10 fields per row:
              [year, ta, atc4, corp, molecule, product, brand, form,
               launchYear, priceBand] + parallel units/value/price arrays
  meta      cell counts, totals, grain and partial-year flags

Run:  python etl/build_market_intel_cache.py
=============================================================================
"""

import os
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
SOURCE_XLSX = os.path.join(ROOT_DIR, 'IMS 2022 to April 2026.xlsx')
OUT_JS = os.path.join(ROOT_DIR, 'cache', 'market_intel.data.js')
OUT_JSON = os.path.join(ROOT_DIR, 'cache', 'market_intel.json')

SHEET_ANNUAL = 'IMS 2022 - 2026 '     # trailing space is in the workbook
SHEET_TA = 'TA Mapping'
SHEET_MOL = 'Molecule Mapping'

SCHEMA_VERSION = 1

# Retail-price bands. Chosen to spread the catalogue rather than cluster it
# in one bucket -- Egypt retail pharma is heavily weighted below EGP 100, so
# the low end is deliberately finer-grained than the top.
PRICE_BANDS = [
    (0,      25,     '< 25'),
    (25,     50,     '25 - 50'),
    (50,     100,    '50 - 100'),
    (100,    250,    '100 - 250'),
    (250,    500,    '250 - 500'),
    (500,    1000,   '500 - 1,000'),
    (1000,   1e12,   '1,000+'),
]
PRICE_BAND_LABELS = [b[2] for b in PRICE_BANDS] + ['Unknown']
PRICE_BAND_UNKNOWN = len(PRICE_BANDS)

t0 = time.time()


def log(msg):
    print(f'  [{time.time() - t0:6.1f}s] {msg}', flush=True)


def norm(v):
    """Collapse whitespace, strip, upper -- the join-key convention."""
    if v is None:
        return ''
    return ' '.join(str(v).split()).upper()


def clean(v):
    """Display form: collapse whitespace, strip. Empty -> '(Unknown)'."""
    if v is None:
        return '(Unknown)'
    s = ' '.join(str(v).split())
    return s if s else '(Unknown)'


def to_float(v):
    if v is None or v == '':
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def price_band_index(price):
    if price is None or price <= 0:
        return PRICE_BAND_UNKNOWN
    for i, (lo, hi, _) in enumerate(PRICE_BANDS):
        if lo <= price < hi:
            return i
    return PRICE_BAND_UNKNOWN


def launch_year_of(launch_date, launch_year_col=None):
    """Launch Date arrives as '1990/04' (annual sheet) or a date. The
    dedicated year column is preferred when present and sane."""
    if launch_year_col not in (None, ''):
        try:
            y = int(float(launch_year_col))
            if 1900 <= y <= 2100:
                return y
        except (TypeError, ValueError):
            pass
    if launch_date in (None, ''):
        return 0
    s = str(launch_date)
    for sep in ('/', '-'):
        if sep in s:
            head = s.split(sep)[0]
            try:
                y = int(float(head))
                if 1900 <= y <= 2100:
                    return y
            except (TypeError, ValueError):
                pass
    try:
        y = int(float(s[:4]))
        if 1900 <= y <= 2100:
            return y
    except (TypeError, ValueError):
        pass
    return 0


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


def main():
    if not os.path.exists(SOURCE_XLSX):
        print(f'ERROR: source not found: {SOURCE_XLSX}')
        sys.exit(1)

    print('\n=== Market Intelligence cache build ===', flush=True)
    log(f'opening {os.path.basename(SOURCE_XLSX)} '
        f'({os.path.getsize(SOURCE_XLSX) // (1024 * 1024)} MB)')
    wb = CalamineWorkbook.from_path(SOURCE_XLSX)

    # ---------------------------------------------------------------- maps
    ta_map = {}
    for r in wb.get_sheet_by_name(SHEET_TA).to_python()[1:]:
        if r and r[0] is not None:
            ta_map[norm(r[0])] = clean(r[1])
    log(f'TA map: {len(ta_map)} ATC4 -> Therapeutic Area')

    mol_map = {}
    for r in wb.get_sheet_by_name(SHEET_MOL).to_python()[1:]:
        if r and r[0] is not None:
            mol_map[norm(r[0])] = clean(r[1])
    log(f'Molecule map: {len(mol_map)} Product -> Molecule')

    # --------------------------------------------------------------- dims
    D = {k: Dim() for k in ('ta', 'atc4', 'corp', 'mol', 'prod', 'brand',
                            'form', 'year')}

    # ------------------------------------------------------- ANNUAL cube
    log('reading annual sheet...')
    rows = wb.get_sheet_by_name(SHEET_ANNUAL).to_python()
    head = rows[0]
    A = {n: i for i, n in enumerate(head)}
    log(f'annual: {len(rows) - 1:,} rows')

    annual_agg = {}
    unmapped_ta_annual = 0
    for r in rows[1:]:
        if not r or all(c is None for c in r):
            continue
        atc4 = clean(r[A['ATC4']])
        ta = clean(r[A['Therapeutic Area']])
        if ta == '(Unknown)':
            ta = ta_map.get(norm(atc4), '(Unknown)')
            if ta == '(Unknown)':
                unmapped_ta_annual += 1
        year = int(to_float(r[A['Calendar Year']]) or 0)
        if year <= 0:
            continue
        price = to_float(r[A['Retail Price']])
        key = (
            D['year'].add(year),
            D['ta'].add(ta),
            D['atc4'].add(atc4),
            D['corp'].add(clean(r[A['Corporation']])),
            D['mol'].add(clean(r[A['Molecule']])),
            D['prod'].add(clean(r[A['Product']])),
            D['brand'].add(clean(r[A['Brand']])),
            D['form'].add(clean(r[A['Form']])),
            launch_year_of(r[A['Launch Date']], r[A['Launch Date (Year)']]),
            price_band_index(price),
        )
        cur = annual_agg.get(key)
        u = to_float(r[A['Units']])
        v = to_float(r[A['LC Value']])
        if cur is None:
            # [units, value, price_sum, price_n] -- price is averaged over
            # the packs that roll into this cell, weighted by nothing but
            # presence; a units-weighted mean would double-count packs sold
            # in very different volumes, which is not what "average price
            # per pack in this segment" means.
            annual_agg[key] = [u, v, price, 1 if price > 0 else 0]
        else:
            cur[0] += u
            cur[1] += v
            if price > 0:
                cur[2] += price
                cur[3] += 1
    log(f'annual cube: {len(annual_agg):,} cells '
        f'(from {len(rows) - 1:,} rows)')
    if unmapped_ta_annual:
        log(f'  NOTE: {unmapped_ta_annual} annual rows had no Therapeutic Area')

    # ------------------------------------------------------------ encode
    log('encoding...')
    annual_rows = []
    annual_units = []
    annual_value = []
    annual_price = []
    for key, (u, v, psum, pn) in annual_agg.items():
        annual_rows.extend(key)
        annual_units.append(round(u, 2))
        annual_value.append(round(v, 2))
        annual_price.append(round(psum / pn, 4) if pn else 0)

    years_sorted = sorted(D['year'].values)

    total_annual_value = sum(annual_value)
    total_annual_units = sum(annual_units)

    cache = {
        'meta': {
            'schemaVersion': SCHEMA_VERSION,
            'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'source': os.path.basename(SOURCE_XLSX),
            'annualCells': len(annual_agg),
            'annualYears': years_sorted,
            'totalAnnualValue': round(total_annual_value, 2),
            'totalAnnualUnits': round(total_annual_units, 2),
            'grain': 'Calendar Year',
            'partialYears': [2026],
        },
        'lookups': {
            'tas': D['ta'].values,
            'atc4s': D['atc4'].values,
            'corps': D['corp'].values,
            'molecules': D['mol'].values,
            'products': D['prod'].values,
            'brands': D['brand'].values,
            'forms': D['form'].values,
            'years': D['year'].values,
            'priceBands': PRICE_BAND_LABELS,
        },
        'annual': {
            'fields': ['year', 'ta', 'atc4', 'corp', 'molecule', 'product',
                       'brand', 'form', 'launchYear', 'priceBand'],
            'stride': 10,
            'rows': annual_rows,
            'units': annual_units,
            'value': annual_value,
            'price': annual_price,
        },
    }

    json_str = json.dumps(cache, separators=(',', ':'), ensure_ascii=False)
    gz = gzip.compress(json_str.encode('utf-8'), compresslevel=9)
    b64 = base64.b64encode(gz).decode('ascii')

    os.makedirs(os.path.join(ROOT_DIR, 'cache'), exist_ok=True)

    # Atomic writes -- a half-written cache is worse than a stale one.
    tmp = OUT_JSON + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(json_str)
    os.replace(tmp, OUT_JSON)

    tmp = OUT_JS + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('window.MARKET_INTEL_CACHE = {b64Data:"' + b64 + '"};\n')
    os.replace(tmp, OUT_JS)

    log(f'wrote {os.path.basename(OUT_JSON)}  '
        f'{os.path.getsize(OUT_JSON) // 1024:,} KB')
    log(f'wrote {os.path.basename(OUT_JS)}  '
        f'{os.path.getsize(OUT_JS) // 1024:,} KB (gzip+base64)')

    print('\n--- reconciliation ---')
    print(f'  annual cells      {len(annual_agg):,}')
    print(f'  annual LC value   {total_annual_value / 1e9:,.2f}B')
    print(f'  annual units      {total_annual_units / 1e6:,.1f}M')
    print(f'  years             {years_sorted}')
    print(f'  corporations      {len(D["corp"]):,}')
    print(f'  molecules         {len(D["mol"]):,}')
    print(f'  products          {len(D["prod"]):,}')
    print(f'  brands            {len(D["brand"]):,}')
    print(f'  therapeutic areas {len(D["ta"]):,}')
    print(f'  ATC4 classes      {len(D["atc4"]):,}')
    print(f'\nMarket Intelligence cache complete in {time.time() - t0:.1f}s\n')


if __name__ == '__main__':
    main()
