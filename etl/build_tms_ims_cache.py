"""
etl/build_tms_ims_cache.py — TMS vs IMS (Sell-In vs Sell-Out Control Tower)
=============================================================================
Reads 'TO MARKET_IN MARKET/TMS VS IMS.xlsx' ("Raw Data" sheet) and builds
cache/tms_ims.json + cache/tms_ims.data.js (gzip+base64), following the
exact same convention as etl/build_customer_analytics_cache.py -- a
compact indexed-row format (month/bu/line/brand/product/salesType as
integer indexes into lookup arrays, decoded client-side) so the gzipped
payload stays small despite ~1,500+ raw rows.

BACKGROUND: the "TO MARKET_IN MARKET" folder already had its own
standalone dashboard (index.html + tms-ims-dashboard.jsx + its own
refresh_dashboard.py, pushing to two SEPARATE GitHub repos via the raw
GitHub API). That was a self-contained prototype, disconnected from this
platform's cache/auth/refresh conventions. This script replaces that
prototype's data-extraction step so the SAME analysis (TMS = sell-in /
trade shipments, IMS = sell-out / IQVIA-reported market sales) is
available as a first-class workspace inside dashboard.html, refreshed by
the same refresh.bat as every other cache, and gated by the same
Allowed-BU/Allowed-Line role model in js/auth.js (this workspace shows
brand/SKU-level trade data across every BU, so it is restricted to
unrestricted/Admin-scope users only -- see js/tms-ims.js's access check
and js/app.js's sidebar-visibility gate).

Consumed by js/tms-ims.js via window.TMS_IMS_CACHE.b64Data (pako.ungzip,
same decompress pattern sales.js uses for window.CUSTOMER_ANALYTICS_CACHE).

Usage:
    python etl/build_tms_ims_cache.py
"""
import os
import sys
import time
import json
import gzip
import base64

import python_calamine

# ---------------------------------------------------------------------------
# Path setup: portable, relative to this script's own location (matches
# refresh.py / refresh_sales.py / refresh_iqvia.py / build_customer_analytics_cache.py
# -- NEVER hardcode an absolute sandbox path here, see the 2026-07-30 bug
# where build_customer_analytics_cache.py shipped with sandbox-only paths
# and broke immediately on the business owner's own machine).
# ---------------------------------------------------------------------------
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_XLSX = os.path.join(ROOT_DIR, 'TO MARKET_IN MARKET', 'TMS VS IMS.xlsx')
SOURCE_SHEET = 'Raw Data'
OUT_JSON = os.path.join(ROOT_DIR, 'cache', 'tms_ims.json')
OUT_DATA_JS = os.path.join(ROOT_DIR, 'cache', 'tms_ims.data.js')

MONTH_ORDER = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12,
}

# Same normalization rules the folder's original refresh_dashboard.py used
# (kept identical so BU/Line names match every other workspace's spelling).
BU_NORM = {
    'CHC': 'CHC', 'CLUSTER': 'Cluster', 'Cluster': 'Cluster',
    'DIAB': 'Diabetes', 'Diabetes': 'Diabetes', 'GIT': 'GIT',
    'Non-Promoted': 'Non-Promoted',
}
CANONICAL_LINES = {
    'CHC': 'CHC', 'NEUROSCIENCE': 'Neuroscience', 'CVM I': 'CVM I', 'CVM II': 'CVM II',
    'DERMA': 'Derma', 'DIAB I': 'Diabetes I', 'DIAB II': 'Diabetes II',
    'DIAB III': 'Diabetes III', 'DIAB IV': 'Diabetes IV',
    'DIABETES I': 'Diabetes I', 'DIABETES II': 'Diabetes II',
    'DIABETES III': 'Diabetes III', 'DIABETES IV': 'Diabetes IV',
    'GIT I': 'GIT I', 'GIT II': 'GIT II', 'GIT III': 'GIT III',
    'PEDIA': 'Pedia', 'NON PROMOTED': 'Non-Promoted',
    'ORTHO I': 'Ortho I', 'ORTHO II': 'Ortho II',
    'CNS I': 'CNS I', 'CNS II': 'CNS II', 'GYNA': 'Gyna',
}

REQUIRED_COLS = ['Month', 'year', 'Business Unit', 'Line', 'Brand', 'Code',
                  'Product', 'P.P', 'Type', 'QTY', 'Value']


def main():
    t0 = time.time()

    if not os.path.exists(SOURCE_XLSX):
        print(f"[ERROR] Source file not found: {SOURCE_XLSX}", file=sys.stderr)
        sys.exit(1)

    print(f"[1/3] Reading {os.path.basename(SOURCE_XLSX)} ({SOURCE_SHEET})...", flush=True)
    wb = python_calamine.CalamineWorkbook.from_path(SOURCE_XLSX)
    sheet = wb.get_sheet_by_name(SOURCE_SHEET)
    rows_raw = sheet.to_python()
    if not rows_raw:
        print("[ERROR] Raw Data sheet is empty.", file=sys.stderr)
        sys.exit(1)

    header = rows_raw[0]
    ci = {str(name).strip(): i for i, name in enumerate(header) if name is not None}
    missing = [c for c in REQUIRED_COLS if c not in ci]
    if missing:
        print(f"[ERROR] Missing required columns in 'Raw Data': {missing}", file=sys.stderr)
        print(f"        Found columns: {list(ci.keys())}", file=sys.stderr)
        sys.exit(1)
    has_sales_type = 'Sales Type' in ci

    data = [r for r in rows_raw[1:] if r and r[ci['Month']] not in (None, '')]
    print(f"      Found {len(data)} data rows", flush=True)

    # Chronological month ordering (handles multi-year data correctly, unlike
    # a plain alphabetical/appearance-order sort).
    month_year_pairs = sorted(set(
        (int(r[ci['year']]), MONTH_ORDER.get(str(r[ci['Month']]).strip(), 0), str(r[ci['Month']]).strip())
        for r in data
    ))
    MONTHS = [f"{m} {y}" for y, mn, m in month_year_pairs]
    month_map = {(y, m): i for i, (y, mn, m) in enumerate(month_year_pairs)}

    # Normalize Line names (case/spacing variants -> one canonical spelling).
    raw_lines = set(str(r[ci['Line']]).strip() for r in data)
    line_norm = {}
    for l in raw_lines:
        key = l.upper().replace('-', ' ').replace('  ', ' ').strip()
        line_norm[l] = CANONICAL_LINES.get(key, l)

    # Normalize Brand names (merge case variants, e.g. "Dozova" vs "DOZOVA").
    raw_brands = set(str(r[ci['Brand']]).strip() for r in data)
    seen_upper = {}
    brand_canonical = {}
    for b in sorted(raw_brands):
        key = b.upper()
        if key not in seen_upper:
            seen_upper[key] = b
        brand_canonical[b] = seen_upper[key]

    bus, lines, brands, stypes, products = [], [], [], [], []

    def idx(lst, v):
        if v not in lst:
            lst.append(v)
        return lst.index(v)

    out_rows = []
    skipped = 0
    for r in data:
        try:
            m = str(r[ci['Month']]).strip()
            yr = int(r[ci['year']])
            bu = BU_NORM.get(str(r[ci['Business Unit']]).strip(), str(r[ci['Business Unit']]).strip())
            ln = line_norm.get(str(r[ci['Line']]).strip(), str(r[ci['Line']]).strip())
            br = brand_canonical.get(str(r[ci['Brand']]).strip(), str(r[ci['Brand']]).strip())
            code = str(r[ci['Code']]).strip()
            prod = str(r[ci['Product']]).strip()
            st = str(r[ci['Sales Type']]).strip() if has_sales_type and r[ci['Sales Type']] is not None else ''
            typ = r[ci['Type']]
            qty = r[ci['QTY']] or 0
            pp = r[ci['P.P']] or 0
            val = r[ci['Value']] if r[ci['Value']] not in (None, '') else (qty * pp)
            mi = month_map[(yr, m)]
        except (KeyError, ValueError, TypeError):
            skipped += 1
            continue
        out_rows.append([
            mi, idx(bus, bu), idx(lines, ln), idx(brands, br),
            idx(products, f"{code}|{prod}"), idx(stypes, st),
            1 if typ == 'IMS' else 0,
            round(qty), round(val),
        ])

    if skipped:
        print(f"      WARNING: skipped {skipped} malformed row(s)", flush=True)

    print(f"      Months: {MONTHS}")
    print(f"      BUs: {bus}")
    print(f"      Lines: {len(lines)} | Brands: {len(brands)} | Products: {len(products)} | Rows: {len(out_rows)}")

    output = {
        'meta': {
            'generatedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
            'sourceRows': len(out_rows),
            'sourceFile': os.path.relpath(SOURCE_XLSX, ROOT_DIR).replace('\\', '/'),
        },
        'months': MONTHS,
        'bus': bus,
        'lines': lines,
        'brands': brands,
        'stypes': stypes,
        'products': products,
        'rows': out_rows,
    }

    print(f"[2/3] Writing outputs...", flush=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False)

    raw = json.dumps(output, ensure_ascii=False).encode('utf-8')
    compressed = gzip.compress(raw, compresslevel=6)
    b64 = base64.b64encode(compressed).decode('ascii')
    with open(OUT_DATA_JS, 'w', encoding='utf-8') as f:
        f.write('window.TMS_IMS_CACHE = { b64Data: "' + b64 + '" };\n')

    print(f"[3/3] Done in {time.time()-t0:.1f}s -- wrote:")
    print(f"      {OUT_JSON} ({len(raw):,} bytes)")
    print(f"      {OUT_DATA_JS} ({len(b64):,} b64 chars, {len(compressed):,} gzipped bytes)")


if __name__ == '__main__':
    main()
