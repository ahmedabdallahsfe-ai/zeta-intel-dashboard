#!/usr/bin/env python3
"""
build_customer_analytics_cache.py
==================================
Standalone ETL for the Customer Analytics cache (Customer Channel Mix's
Cluster -> Customer Health drill: unique/new/lost/frequent customers,
full-vs-partial SKU basket, SKU penetration).

WHY THIS IS A SEPARATE SCRIPT (2026-07-28): the platform's main Sales
cache (cache/sales.json -> js/sales.data.js) has no customer identity at
all -- see CUSTOMER_ANALYTICS_ETL_SPEC.md and the [[customer-analytics-etl-gap]]
memory for the full history. The raw source workbook (TOTAL_SALES_2026.xlsx,
sheet "Tota_SALES_2026") DOES carry CustomerID/CustomerName/SubType/Item at
transaction grain -- confirmed by the business owner and by direct
inspection. This script reads that raw source directly (there is no
existing refresh_sales.py in this project to extend) and produces a new,
separate cache file the dashboard loads alongside the existing ones.

RUN THIS SCRIPT whenever TOTAL_SALES_2026.xlsx is refreshed with new data,
same way the other caches get refreshed from their own source files.

Output: cache/customer_analytics.json (plain) and
        cache/customer_analytics.data.js (gzip+base64, matches
        sales.data.js's / iqvia.data.js's loading convention -- decompressed
        client-side via pako.js).

PERFORMANCE NOTE: parsing the ~996,720-row source sheet with python-calamine
(the fastest available xlsx reader for a file this size -- openpyxl and
xlsx2csv were both tested and are markedly slower) takes 30-45s with real
variance. This script does ONE pass over the sheet and aggregates directly
into the final compact structures below -- it does NOT dump raw rows to an
intermediate file first, which is what makes a single run of this script
tractable. Do not refactor this into "extract then aggregate" as two passes.
"""
import os, sys, time, json, gzip, base64, re
from collections import defaultdict

# Path setup (2026-07-30 FIX): these were previously hardcoded to this
# sandbox's own mount paths (/sessions/happy-laughing-feynman/mnt/...),
# which do not exist on the business owner's actual Windows machine --
# running this script there failed with "OSError: The system cannot find
# the path specified." Every other refresh script in this project
# (refresh.py, refresh_sales.py, refresh_iqvia.py) derives its paths from
# its own file location instead; this script now does the same. This file
# lives in CoverageDashboard/etl/, so ROOT_DIR is one level up from here.
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_XLSX = os.path.join(ROOT_DIR, 'TOTAL_SALES_2026.xlsx')
SOURCE_SHEET = 'Tota_SALES_2026'
# June 2026 update (2026-07-30): TOTAL_SALES_2026.xlsx itself only goes
# through May -- confirmed directly (996,720 rows, months 2026-01..2026-05
# only, no June rows at all) -- June arrived as a separate export, same as
# refresh_sales.py's own JUNE_XLSX/JUNE_SHEET_NAME (see that script's
# 2026-07-28 comment for the full history). refresh_sales.py's June merge
# only ever updated cache/sales.data.js/.json in memory -- it never wrote a
# combined workbook back to TOTAL_SALES_2026.xlsx on disk, so this script
# (which reads that same file independently) needs its own June merge, not
# just a re-run. Mirrors refresh_sales.py's simpler original approach (read
# both sources, concatenate in memory, column lookup by name) rather than
# its later SQLite-resumable rewrite -- this script is meant to be run
# directly on the business owner's own machine (see the module docstring),
# where there is no 45s sandbox cap forcing a chunked/resumable design.
JUNE_XLSX = os.path.join(ROOT_DIR, 'ZETA SALES_2026', 'june.xlsx')
JUNE_SHEET = 'SalesPerDistributor'
OUT_JSON = os.path.join(ROOT_DIR, 'cache', 'customer_analytics.json')
OUT_DATA_JS = os.path.join(ROOT_DIR, 'cache', 'customer_analytics.data.js')
# Checkpoint (2026-07-28): the xlsx parse+aggregate step and the JSON+gzip
# write step are split across a disk checkpoint because together they can
# exceed the sandbox's 45s hard command timeout once skuPenetrationByBU
# roughly quadruples the per-cluster SKU payload. If this file exists, main()
# skips straight to serialization instead of re-parsing the ~1M-row source.
# Delete it (or let a fresh run overwrite it) to force a full re-parse.
CHECKPOINT_PKL = os.path.join(ROOT_DIR, 'cache', '.customer_analytics_checkpoint.pkl')

# Mirrors js/sales.js's SUBTYPE_TO_CLUSTER exactly -- keep both in sync.
SUBTYPE_TO_CLUSTER = {
    "Abdeen Ph": "Chain Pharmacy", "Abo Ali Ph": "Chain Pharmacy", "Agzakhana Ph": "Chain Pharmacy",
    "Al Fouad Ph": "Chain Pharmacy", "Alserafy Ph": "Chain Pharmacy", "Auxilio": "Chain Pharmacy",
    "Balbaa Ph": "Chain Pharmacy", "Delmar&Attalla Ph": "Chain Pharmacy", "El Khabiry": "Chain Pharmacy",
    "El Taiby PH": "Chain Pharmacy", "El-Biesy": "Chain Pharmacy", "Eslam fathy Ph": "Chain Pharmacy",
    "Ezz Eldin PH": "Chain Pharmacy", "Ezzaby": "Chain Pharmacy", "Khalil PH": "Chain Pharmacy",
    "Maher Chain Alex": "Chain Pharmacy", "Mahfouz": "Chain Pharmacy", "Misr Chain": "Chain Pharmacy",
    "Nabil Eltarshouby Ph": "Chain Pharmacy", "Nour Ph": "Chain Pharmacy", "Ramadan Pharmacy": "Chain Pharmacy",
    "Sally PH": "Chain Pharmacy", "Seif PH": "Chain Pharmacy", "Shokr": "Chain Pharmacy",
    "Tarshobi PH": "Chain Pharmacy", "Walid El Tarshobi": "Chain Pharmacy", "Yasser Hefny": "Chain Pharmacy",
    "Al Safa": "Chain Pharmacy", "Dawaa": "Chain Pharmacy", "Gardenia": "Chain Pharmacy",
    "HEFNY PHs": "Chain Pharmacy", "Optimus": "Chain Pharmacy", "Sehha": "Chain Pharmacy",
    "Yodawi": "Chain Pharmacy", "Chain": "Chain Pharmacy",
    "EgyDrug_Pharmacies": "Retail",
    "Behera PHs": "Stores", "Elsyadla": "Stores", "Stores": "Stores", "SubAgent": "Stores",
    "Special PHs": "Retail", "Account": "Retail", "Retail": "Retail",
    "Army": "Institutional / Government", "Educational Hosp.": "Institutional / Government",
    "HI": "Institutional / Government", "MOH": "Institutional / Government",
    "Petrol": "Institutional / Government", "Police": "Institutional / Government",
    "Univ.": "Institutional / Government",
    "POLY Clinic": "POLY Clinic",
    "Private": "Retail",
    "Private Clinic": "Private Clinic",
    "Private Hospital": "Private Hospital",
    "E-Commerce Allocated": "E-Commerce",
    "Non UPA": "OTHERS", "NON WORKING": "OTHERS", "Other": "OTHERS",
}

LINE_TO_BU = {
    'CHC': 'CHC', 'CHC_SALES': 'CHC',
    'PEDIA': 'Cluster', 'ORTHO-I': 'Cluster', 'ORTHO-II': 'Cluster', 'CVM-I': 'Cluster', 'CVM-II': 'Cluster',
    'DIAB-I': 'DIAB', 'DIAB-II': 'DIAB', 'DIAB-III': 'DIAB', 'DIAB-IV': 'DIAB',
    'Derma': 'GIT', 'CNS': 'GIT', 'GIT-I': 'GIT', 'GIT-II': 'GIT', 'GIT-III': 'GIT',
    'NEUROSCIENCE': 'GIT',
}

# Which clusters to build in this run -- extend this set to cover the rest;
# each cluster adds negligible time once the sheet is already parsed.
CLUSTERS_TO_BUILD = {'Retail', 'Chain Pharmacy'}


def clean(s):
    if s is None:
        return ''
    return re.sub(r'\s+', ' ', str(s).replace('\xa0', ' ')).strip()


# Mirrors js/semantic-model.js's LINE_SYNONYMS (2026-07-31, added for the
# per-customer "Line" column) -- only NEUROSCIENCE needs remapping to match
# the canonical spelling the dashboard displays everywhere else (IQVIA calls
# it CNS). "Derma" already matches CANONICAL_LINE_TO_BU's casing at the
# source, so no synonym entry is needed for it here.
LINE_SYNONYMS = {'NEUROSCIENCE': 'CNS'}


def canon_line(raw):
    if raw is None:
        return raw
    s = clean(raw)
    return LINE_SYNONYMS.get(s, s)


def fmt_date(d):
    """ISO-format a date/datetime value for JSON output; None-safe. Source
    dates come back from python_calamine as datetime.date/datetime objects
    (see the 'sample row' inspection done 2026-07-31 to confirm the Brick/
    Position columns), which aren't directly JSON-serializable."""
    if d is None:
        return None
    return d.isoformat() if hasattr(d, 'isoformat') else str(d)


def scan_sheet(sheet, source_label, t0, clusters, item_value, item_customers,
               item_value_by_bu, item_customers_by_bu, bu_customers, item_value_by_bu_line):
    """Scan one sheet's rows into the shared aggregation structures (all
    passed in and mutated in place) -- factored out so main() can call this
    once per physical source file (main workbook, then June's separate
    export) instead of duplicating the loop. Column lookup is by NAME via
    header.index(), so this tolerates the two sources having a different
    column count/order (June's export is missing a couple of trailing
    columns this script never reads anyway -- see JUNE_XLSX's comment)."""
    rows_iter = sheet.iter_rows()
    header = next(rows_iter)
    idx = {name: i for i, name in enumerate(header)}
    required = ['Date', 'Line', 'SubType', 'CustomerID', 'CustomerName', 'Item', 'Quantity', 'Value', 'IsTender']
    missing = [c for c in required if c not in idx]
    if missing:
        print(f'[{time.time()-t0:.1f}s] SKIPPING source "{source_label}" -- missing expected column(s) {missing}',
              file=sys.stderr, flush=True)
        return 0
    ci_date, ci_line, ci_st, ci_cid, ci_cname, ci_item, ci_qty, ci_val, ci_tender = (
        idx['Date'], idx['Line'], idx['SubType'], idx['CustomerID'], idx['CustomerName'],
        idx['Item'], idx['Quantity'], idx['Value'], idx['IsTender']
    )
    # Brick/Position (2026-07-31, "give brick name position name only"):
    # OPTIONAL, not required -- both TOTAL_SALES_2026.xlsx and june.xlsx
    # were confirmed (2026-07-31) to carry 'Brick' and 'Position' columns,
    # but treating them as optional here (rather than adding to `required`
    # above) means a future source variant missing them degrades to an
    # empty Brick/Position on the grid instead of the whole sheet being
    # skipped.
    ci_brick = idx.get('Brick')
    ci_region = idx.get('Region')
    ci_position = idx.get('Position')

    scanned = 0
    for row in rows_iter:
        scanned += 1
        if row[ci_tender]:
            continue
        st = row[ci_st]
        cluster = SUBTYPE_TO_CLUSTER.get(st)
        if cluster not in clusters:
            continue
        cid = row[ci_cid]
        if cid is None or cid == '':
            continue

        cust = clusters[cluster]
        if cid not in cust:
            cust[cid] = {'name': row[ci_cname], 'months': set(), 'items': set(),
                         'value': 0.0, 'qty': 0.0, 'txn': 0, 'bus': set(),
                         'itemValueByBU': defaultdict(lambda: defaultdict(float)),
                         'monthsByBU': defaultdict(set), 'linesByBU': defaultdict(set),
                         'bricksByBU': defaultdict(set), 'regionsByBU': defaultdict(set),
                         'positionsByBU': defaultdict(set),
                         'lastPurchase': None, 'lastPurchaseByBU': {},
                         # Per-BU-per-Line breakdown (2026-08-03, "position of
                         # chosen line"): mirrors every *ByBU accumulator one
                         # dimension deeper so the Customer Health grid can
                         # scope Status/Frequency/Basket/Distinct SKUs/Value/
                         # Position/Brick/Region/Last Purchase to the SPECIFIC
                         # Line selected in the Executive filter bar, not just
                         # the BU it belongs to -- see by_bu[bu]['byLine'] in
                         # main() below.
                         'itemValueByBULine': defaultdict(lambda: defaultdict(lambda: defaultdict(float))),
                         'monthsByBULine': defaultdict(lambda: defaultdict(set)),
                         'bricksByBULine': defaultdict(lambda: defaultdict(set)),
                         'regionsByBULine': defaultdict(lambda: defaultdict(set)),
                         'positionsByBULine': defaultdict(lambda: defaultdict(set)),
                         'lastPurchaseByBULine': defaultdict(dict)}
        c = cust[cid]
        m = str(row[ci_date])[:7]
        c['months'].add(m)
        item = row[ci_item]
        c['items'].add(item)
        c['value'] += row[ci_val] or 0
        c['qty'] += row[ci_qty] or 0
        c['txn'] += 1
        # Last purchase (2026-07-31, "add column of last time purchase"):
        # tracked globally here (all-BU fallback) regardless of whether the
        # row's line resolves to an in-scope BU -- the BU-scoped version is
        # tracked separately below, inside the `if bu:` block.
        raw_date = row[ci_date]
        if raw_date is not None and (c['lastPurchase'] is None or raw_date > c['lastPurchase']):
            c['lastPurchase'] = raw_date
        bu = LINE_TO_BU.get(row[ci_line])
        if bu:
            c['bus'].add(bu)
            bu_customers[cluster][bu].add(cid)
            item_value_by_bu[cluster][bu][item] += row[ci_val] or 0
            item_customers_by_bu[cluster][bu][item].add(cid)
            c['itemValueByBU'][bu][item] += row[ci_val] or 0
            # Per-BU months/lines/bricks/positions/last-purchase
            # (2026-07-31): lets the Customer Health grid show Status/
            # Frequency/Basket/Distinct SKUs/Value/Last Purchase/Brick/
            # Position scoped to ONLY the selected BU, not the customer's
            # global activity across all 4 BUs -- see main()'s
            # customer_rows loop below, which turns these into
            # byBU[bu].{bridgeSegment,...}.
            c['monthsByBU'][bu].add(m)
            line_name = canon_line(row[ci_line])
            c['linesByBU'][bu].add(line_name)
            if ci_brick is not None and row[ci_brick]:
                c['bricksByBU'][bu].add(clean(row[ci_brick]))
            if ci_region is not None and row[ci_region]:
                c['regionsByBU'][bu].add(clean(row[ci_region]))
            if ci_position is not None and row[ci_position]:
                c['positionsByBU'][bu].add(clean(row[ci_position]))
            if raw_date is not None and (bu not in c['lastPurchaseByBU'] or raw_date > c['lastPurchaseByBU'][bu]):
                c['lastPurchaseByBU'][bu] = raw_date
            # Per-BU-per-Line mirror of the above (2026-08-03).
            c['itemValueByBULine'][bu][line_name][item] += row[ci_val] or 0
            c['monthsByBULine'][bu][line_name].add(m)
            if ci_brick is not None and row[ci_brick]:
                c['bricksByBULine'][bu][line_name].add(clean(row[ci_brick]))
            if ci_region is not None and row[ci_region]:
                c['regionsByBULine'][bu][line_name].add(clean(row[ci_region]))
            if ci_position is not None and row[ci_position]:
                c['positionsByBULine'][bu][line_name].add(clean(row[ci_position]))
            if raw_date is not None and (line_name not in c['lastPurchaseByBULine'][bu] or raw_date > c['lastPurchaseByBULine'][bu][line_name]):
                c['lastPurchaseByBULine'][bu][line_name] = raw_date
            item_value_by_bu_line[cluster][bu][line_name][item] += row[ci_val] or 0

        item_value[cluster][item] += row[ci_val] or 0
        item_customers[cluster][item].add(cid)

    print(f'[{time.time()-t0:.1f}s] "{source_label}": scanned {scanned} rows, clusters so far: '
          f'{[(c, len(cust)) for c, cust in clusters.items()]}', file=sys.stderr, flush=True)
    return scanned


def main():
    t0 = time.time()
    import pickle

    if os.path.exists(CHECKPOINT_PKL):
        with open(CHECKPOINT_PKL, 'rb') as f:
            output = pickle.load(f)
        print(f'[{time.time()-t0:.1f}s] loaded checkpoint {CHECKPOINT_PKL}, skipping xlsx parse', file=sys.stderr, flush=True)
        write_outputs(output, t0)
        return

    from python_calamine import CalamineWorkbook

    # cluster -> custId -> {name, months:set, items:set, value, qty, txn, bus:set,
    #                        itemValueByBU: {bu: {item: value}}}
    # itemValueByBU (2026-07-30, "actual item/SKU related the BU chosen"):
    # per customer, per BU, which items they actually bought and how much --
    # lets the Customer Health full-list grid show real SKU names scoped to
    # whichever BU the Executive filter/modal is narrowed to, instead of just
    # a "Business Units" tag and a bare Distinct-SKUs count.
    clusters = {c: {} for c in CLUSTERS_TO_BUILD}
    # cluster -> item -> value / set(custIds) -- all-BU view (KPI 6/7 default)
    item_value = {c: defaultdict(float) for c in CLUSTERS_TO_BUILD}
    item_customers = {c: defaultdict(set) for c in CLUSTERS_TO_BUILD}
    # cluster -> bu -> item -> value / set(custIds) -- BU-scoped view, added
    # 2026-07-28 so "Top SKU Penetration" can be filtered to the selected BU
    # instead of always showing the all-BU-combined list. bu_customers is the
    # penetration denominator: distinct customers in this cluster who have
    # ANY transaction under that BU (matches getClusterCustomerHealth()'s own
    # BU-narrowing logic in js/sales.js -- same definition, just precomputed).
    item_value_by_bu = {c: defaultdict(lambda: defaultdict(float)) for c in CLUSTERS_TO_BUILD}
    item_customers_by_bu = {c: defaultdict(lambda: defaultdict(set)) for c in CLUSTERS_TO_BUILD}
    bu_customers = {c: defaultdict(set) for c in CLUSTERS_TO_BUILD}
    # cluster -> bu -> line -> item -> value (2026-08-03, "position of chosen
    # line"): mirrors item_value_by_bu one dimension deeper -- used only to
    # compute core_set_by_bu_line below (the per-BU-per-Line "top items
    # covering 80% of value" definition for the Basket segment).
    item_value_by_bu_line = {c: defaultdict(lambda: defaultdict(lambda: defaultdict(float))) for c in CLUSTERS_TO_BUILD}

    scanned = 0

    wb = CalamineWorkbook.from_path(SOURCE_XLSX)
    sheet = wb.get_sheet_by_name(SOURCE_SHEET)
    print(f'[{time.time()-t0:.1f}s] main sheet parsed', file=sys.stderr, flush=True)
    scanned += scan_sheet(sheet, 'main (' + SOURCE_XLSX + ')', t0, clusters, item_value, item_customers,
                          item_value_by_bu, item_customers_by_bu, bu_customers, item_value_by_bu_line)
    del wb, sheet

    if os.path.exists(JUNE_XLSX):
        june_wb = CalamineWorkbook.from_path(JUNE_XLSX)
        june_sheet = june_wb.get_sheet_by_name(JUNE_SHEET)
        print(f'[{time.time()-t0:.1f}s] June sheet parsed', file=sys.stderr, flush=True)
        scanned += scan_sheet(june_sheet, 'june (' + JUNE_XLSX + ')', t0, clusters, item_value, item_customers,
                              item_value_by_bu, item_customers_by_bu, bu_customers, item_value_by_bu_line)
        del june_wb, june_sheet
    else:
        print(f'[{time.time()-t0:.1f}s] WARNING: June source not found at {JUNE_XLSX} -- '
              f'output will be missing June data.', file=sys.stderr, flush=True)

    print(f'[{time.time()-t0:.1f}s] all sources scanned: {scanned} total rows, clusters built: '
          f'{[(c, len(cust)) for c, cust in clusters.items()]}', file=sys.stderr, flush=True)

    # ---- Compute derived KPIs per cluster ----
    output = {'generatedAt': None, 'sourceRows': scanned, 'clusters': {}}
    import datetime
    output['generatedAt'] = datetime.datetime.now().isoformat()

    for cluster_name, cust in clusters.items():
        if not cust:
            continue
        months = sorted(set(m for c in cust.values() for m in c['months']))
        if len(months) < 2:
            continue
        latest_m, prev_m = months[-1], months[-2]
        earlier_months = [m for m in months if m not in (latest_m, prev_m)]

        bridge = {'new': [], 'lost': [], 'retained': [], 'reactivated': []}
        freq_buckets = {'frequent': 0, 'occasional': 0, 'oneTime': 0}
        for cid, c in cust.items():
            ms = c['months']
            in_latest = latest_m in ms
            in_prev = prev_m in ms
            in_earlier = any(m in ms for m in earlier_months)
            if in_latest and not in_prev and not in_earlier:
                bridge['new'].append(cid)
            elif in_prev and not in_latest:
                bridge['lost'].append(cid)
            elif in_latest and in_prev:
                bridge['retained'].append(cid)
            elif in_latest and not in_prev and in_earlier:
                bridge['reactivated'].append(cid)

            n = len(ms)
            if n >= 4:
                freq_buckets['frequent'] += 1
            elif n >= 2:
                freq_buckets['occasional'] += 1
            else:
                freq_buckets['oneTime'] += 1

        items_sorted = sorted(item_value[cluster_name].items(), key=lambda kv: -kv[1])
        total_val = sum(v for _, v in items_sorted) or 1
        cum = 0.0
        core_items = []
        for name, v in items_sorted:
            cum += v
            core_items.append(name)
            if cum / total_val >= 0.80:
                break
        core_set = set(core_items)

        # Per-BU core-SKU sets (2026-07-31): unlike skuPenetrationByBU's
        # 'inCore' flag (which deliberately stays cluster-wide, see the
        # 2026-07-28 comment below on sku_penetration_by_bu), the per-
        # customer Basket segment on the grid needs a per-BU "top items
        # covering 80% of BU value" definition -- Ahmed's explicit request
        # ("basket... should be related to chosen bu") means a customer's
        # Basket status when viewing DIAB must reflect DIAB's own core
        # list, not the cluster's blended one.
        core_set_by_bu = {}
        for bu_name, bu_item_vals in item_value_by_bu[cluster_name].items():
            bu_items_sorted_for_core = sorted(bu_item_vals.items(), key=lambda kv: -kv[1])
            bu_total_val = sum(v for _, v in bu_items_sorted_for_core) or 1
            bu_cum = 0.0
            bu_core_items = []
            for name, v in bu_items_sorted_for_core:
                bu_cum += v
                bu_core_items.append(name)
                if bu_cum / bu_total_val >= 0.80:
                    break
            core_set_by_bu[bu_name] = set(bu_core_items)

        # Per-BU-per-Line core-SKU sets (2026-08-03, "position of chosen
        # line"): same 80%-of-value definition as core_set_by_bu above, one
        # dimension deeper, so the Basket segment can be scoped to the
        # specific Line selected within a BU (e.g. CVM-II's own core list),
        # not just the BU's blended one.
        core_set_by_bu_line = {}
        for bu_name, lines_dict in item_value_by_bu_line[cluster_name].items():
            core_set_by_bu_line[bu_name] = {}
            for line_name, line_item_vals in lines_dict.items():
                line_items_sorted_for_core = sorted(line_item_vals.items(), key=lambda kv: -kv[1])
                line_total_val = sum(v for _, v in line_items_sorted_for_core) or 1
                line_cum = 0.0
                line_core_items = []
                for name, v in line_items_sorted_for_core:
                    line_cum += v
                    line_core_items.append(name)
                    if line_cum / line_total_val >= 0.80:
                        break
                core_set_by_bu_line[bu_name][line_name] = set(line_core_items)

        def compute_line_stats(c, bu_name, ln):
            """Same New/Lost/Retained/Reactivated + Frequent/Occasional/
            One-time + core-SKU Basket logic used for the BU-level by_bu[bu]
            block above, scoped to one customer's activity under a single
            Line within that BU. Named function instead of an inline
            lambda purely for readability -- see the 2026-08-03 'position
            of chosen line' comment on by_bu[bu_name]['byLine'] below for
            why this exists."""
            lm = c['monthsByBULine'].get(bu_name, {}).get(ln, set())
            in_latest, in_prev = latest_m in lm, prev_m in lm
            in_earlier = any(m in lm for m in earlier_months)
            if in_latest and not in_prev and not in_earlier:
                bridge_seg = 'New'
            elif in_prev and not in_latest:
                bridge_seg = 'Lost'
            elif in_latest and in_prev:
                bridge_seg = 'Retained'
            elif in_latest and not in_prev and in_earlier:
                bridge_seg = 'Reactivated'
            else:
                bridge_seg = 'Inactive'

            n = len(lm)
            freq_seg = 'Frequent' if n >= 4 else ('Occasional' if n >= 2 else 'One-time')

            items = set(c['itemValueByBULine'].get(bu_name, {}).get(ln, {}).keys())
            core = core_set_by_bu_line.get(bu_name, {}).get(ln, set())
            pct = len(items & core) / len(core) if core else 0
            basket_seg = 'Full' if pct >= 0.80 else ('Partial' if pct > 0 else 'None of core')

            return {
                'monthsActive': n,
                'distinctSkus': len(items),
                'value': round(sum(c['itemValueByBULine'].get(bu_name, {}).get(ln, {}).values()), 2),
                'bridgeSegment': bridge_seg,
                'frequencySegment': freq_seg,
                'basketSegment': basket_seg,
                'bricks': sorted(c['bricksByBULine'].get(bu_name, {}).get(ln, set())),
                'regions': sorted(c['regionsByBULine'].get(bu_name, {}).get(ln, set())),
                'positions': sorted(c['positionsByBULine'].get(bu_name, {}).get(ln, set())),
                'lastPurchase': fmt_date(c['lastPurchaseByBULine'].get(bu_name, {}).get(ln)),
            }

        basket = {'full': 0, 'partial': 0, 'none': 0}
        customer_rows = []
        for cid, c in cust.items():
            bought_core = c['items'] & core_set
            pct = len(bought_core) / len(core_set) if core_set else 0
            if pct >= 0.80:
                seg = 'full'
            elif pct > 0:
                seg = 'partial'
            else:
                seg = 'none'
            basket[seg] += 1

            ms = c['months']
            in_latest = latest_m in ms
            in_prev = prev_m in ms
            in_earlier = any(m in ms for m in earlier_months)
            if in_latest and not in_prev and not in_earlier:
                bridge_seg = 'New'
            elif in_prev and not in_latest:
                bridge_seg = 'Lost'
            elif in_latest and in_prev:
                bridge_seg = 'Retained'
            elif in_latest and not in_prev and in_earlier:
                bridge_seg = 'Reactivated'
            else:
                bridge_seg = 'Inactive'

            freqN = len(ms)
            freq_seg = 'Frequent' if freqN >= 4 else ('Occasional' if freqN >= 2 else 'One-time')

            # Per-BU item list (2026-07-30): top 20 items by value this
            # customer actually bought under each BU they touched -- names,
            # not just a count, so the grid can show what a customer bought
            # scoped to whichever BU is selected. UNCAPPED (2026-07-31 fix,
            # was top-20-by-value): Ahmed flagged a real mismatch this
            # caused -- 'Distinct SKUs' shows len(bu_items_set) (the true,
            # uncapped count) while the SKU list itself was silently
            # truncated at 20, so a customer with 27 distinct SKUs showed
            # "Distinct SKUs: 27" next to a list of only 20 names. Both now
            # come from the exact same c['itemValueByBU'][bu] dict, so the
            # list length and the Distinct SKUs count are IDENTICAL by
            # construction -- no cap, no possible mismatch. Still sorted by
            # value descending (highest-value SKU first).
            items_by_bu = {
                bu_name: [name for name, _ in sorted(item_vals.items(), key=lambda kv: -kv[1])]
                for bu_name, item_vals in c['itemValueByBU'].items()
            }
            # Per-BU-per-Line mirror (2026-08-03, "position of chosen line"):
            # same uncapped, sorted-by-value item name list, one dimension
            # deeper, so distinctSkus/the SKU column stay self-consistent
            # (identical by construction, same guarantee as items_by_bu
            # above) when the grid is scoped to a specific Line, not just a BU.
            items_by_bu_line = {
                bu_name: {
                    line_name: [name for name, _ in sorted(line_item_vals.items(), key=lambda kv: -kv[1])]
                    for line_name, line_item_vals in lines_dict.items()
                }
                for bu_name, lines_dict in c['itemValueByBULine'].items()
            }

            # Per-BU customer stats (2026-07-31, "distinct skus should refer
            # to chosen bu and status/frequency/basket/value should be
            # related to chosen bu"): mirrors the exact same New/Lost/
            # Retained/Reactivated and Frequent/Occasional/One-time logic
            # above, but scoped to ONLY the months/items this customer
            # transacted under each individual BU (monthsByBU/itemValueByBU),
            # instead of their combined activity across all 4 BUs. The grid
            # (js/executive.js) and getClusterCustomerHealth() (js/sales.js)
            # overlay these onto the row when a specific BU is selected;
            # the fields above stay as the All-BU/global fallback.
            by_bu = {}
            for bu_name in c['bus']:
                bu_months = c['monthsByBU'].get(bu_name, set())
                bu_in_latest = latest_m in bu_months
                bu_in_prev = prev_m in bu_months
                bu_in_earlier = any(m in bu_months for m in earlier_months)
                if bu_in_latest and not bu_in_prev and not bu_in_earlier:
                    bu_bridge_seg = 'New'
                elif bu_in_prev and not bu_in_latest:
                    bu_bridge_seg = 'Lost'
                elif bu_in_latest and bu_in_prev:
                    bu_bridge_seg = 'Retained'
                elif bu_in_latest and not bu_in_prev and bu_in_earlier:
                    bu_bridge_seg = 'Reactivated'
                else:
                    bu_bridge_seg = 'Inactive'

                bu_freq_n = len(bu_months)
                bu_freq_seg = 'Frequent' if bu_freq_n >= 4 else ('Occasional' if bu_freq_n >= 2 else 'One-time')

                bu_items_set = set(c['itemValueByBU'].get(bu_name, {}).keys())
                bu_core = core_set_by_bu.get(bu_name, set())
                bu_bought_core = bu_items_set & bu_core
                bu_pct = len(bu_bought_core) / len(bu_core) if bu_core else 0
                if bu_pct >= 0.80:
                    bu_basket_seg = 'Full'
                elif bu_pct > 0:
                    bu_basket_seg = 'Partial'
                else:
                    bu_basket_seg = 'None of core'

                by_bu[bu_name] = {
                    'monthsActive': bu_freq_n,
                    'distinctSkus': len(bu_items_set),
                    'value': round(sum(c['itemValueByBU'].get(bu_name, {}).values()), 2),
                    'bridgeSegment': bu_bridge_seg,
                    'frequencySegment': bu_freq_seg,
                    'basketSegment': bu_basket_seg,
                    'lines': sorted(c['linesByBU'].get(bu_name, set())),
                    # Brick/Position (2026-07-31, "give brick name position
                    # name only"): which brick(s)/position(s) this customer
                    # was actually transacted under, within this BU only --
                    # sourced directly from the 'Brick'/'Position' columns
                    # confirmed present in both source files. A customer can
                    # show more than one of each if territory/rep coverage
                    # changed within the period.
                    'bricks': sorted(c['bricksByBU'].get(bu_name, set())),
                    'regions': sorted(c['regionsByBU'].get(bu_name, set())),
                    'positions': sorted(c['positionsByBU'].get(bu_name, set())),
                    # Last Purchase (2026-07-31, "add column of last time
                    # purchase"): most recent transaction date under THIS BU.
                    'lastPurchase': fmt_date(c['lastPurchaseByBU'].get(bu_name)),
                    # Per-Line breakdown within this BU (2026-08-03, "position
                    # of chosen line"): same New/Lost/Retained/Reactivated,
                    # Frequent/Occasional/One-time, and core-SKU-based Basket
                    # logic as above, but scoped to ONLY this customer's
                    # transactions under one specific Line inside this BU --
                    # lets the Customer Health grid show Position (and every
                    # other BU-scoped field) for the exact Line selected in
                    # the Executive filter bar, not the BU's blended view
                    # across all its Lines. getClusterCustomerHealth() (js/
                    # sales.js) overlays byLine[line] on top of the BU-level
                    # fields above when a Line filter is active; falls back
                    # to the BU-level fields for caches built before this
                    # existed.
                    'byLine': {
                        line_name: compute_line_stats(c, bu_name, line_name)
                        for line_name in c['linesByBU'].get(bu_name, set())
                    },
                }

            customer_rows.append({
                'id': cid, 'name': clean(c['name']), 'monthsActive': freqN,
                'bridgeSegment': bridge_seg, 'frequencySegment': freq_seg,
                'basketSegment': seg.capitalize() if seg != 'none' else 'None of core',
                'distinctSkus': len(c['items']), 'value': round(c['value'], 2),
                'qty': round(c['qty'], 2), 'txn': c['txn'], 'bus': sorted(c['bus']),
                'itemsByBU': items_by_bu, 'itemsByBULine': items_by_bu_line, 'byBU': by_bu,
                'lastPurchase': fmt_date(c['lastPurchase']),
            })

        sku_penetration = [
            {'sku': clean(name), 'customers': len(item_customers[cluster_name][name]),
             'penetrationPct': round(len(item_customers[cluster_name][name]) / len(cust) * 100, 2),
             'value': round(v, 2), 'inCore': name in core_set}
            for name, v in items_sorted
        ]

        # BU-scoped SKU penetration (2026-07-28) -- same shape as the all-BU
        # list above, one list per BU, denominator = customers in THIS
        # cluster active under THAT BU (bu_customers), not the cluster's
        # total. 'inCore' still refers to the cluster-wide core list (not
        # redefined per BU) -- keeps one definition of "core" instead of
        # nine, consistent with the Basket Depth section which also stays
        # cluster-wide.
        sku_penetration_by_bu = {}
        for bu_name, bu_item_vals in item_value_by_bu[cluster_name].items():
            denom = len(bu_customers[cluster_name][bu_name]) or 1
            bu_items_sorted = sorted(bu_item_vals.items(), key=lambda kv: -kv[1])
            sku_penetration_by_bu[bu_name] = [
                {'sku': clean(name), 'customers': len(item_customers_by_bu[cluster_name][bu_name][name]),
                 'penetrationPct': round(len(item_customers_by_bu[cluster_name][bu_name][name]) / denom * 100, 2),
                 'value': round(v, 2), 'inCore': name in core_set}
                for name, v in bu_items_sorted
            ]

        output['clusters'][cluster_name] = {
            'months': months,
            'totalCustomers': len(cust),
            'bridge': {k: len(v) for k, v in bridge.items()},
            'frequencyBuckets': freq_buckets,
            'basketBuckets': basket,
            'coreSkuCount': len(core_items),
            'totalSkuCount': len(items_sorted),
            'coreSkuCountByBU': {bu: len(s) for bu, s in core_set_by_bu.items()},
            'totalSkuCountByBU': {bu: len(item_value_by_bu[cluster_name][bu]) for bu in item_value_by_bu[cluster_name]},
            'skuPenetration': sku_penetration,
            'skuPenetrationByBU': sku_penetration_by_bu,
            'customers': customer_rows,
        }
        print(f'[{time.time()-t0:.1f}s] {cluster_name}: {len(cust)} customers, KPIs computed', file=sys.stderr, flush=True)

    # Checkpoint immediately -- the xlsx parse+aggregate above is the
    # expensive, non-restartable part (~40s). Everything from here on
    # (JSON + gzip + write) is cheap to redo from this checkpoint if the
    # sandbox's 45s command timeout cuts off the run before it finishes.
    with open(CHECKPOINT_PKL, 'wb') as f:
        pickle.dump(output, f, protocol=pickle.HIGHEST_PROTOCOL)
    print(f'[{time.time()-t0:.1f}s] wrote checkpoint {CHECKPOINT_PKL}', file=sys.stderr, flush=True)

    write_outputs(output, t0)


def write_outputs(output, t0):
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False)
    print(f'[{time.time()-t0:.1f}s] wrote {OUT_JSON}', file=sys.stderr, flush=True)

    with open(OUT_JSON, 'rb') as f:
        raw = f.read()
    compressed = gzip.compress(raw, compresslevel=6)
    b64 = base64.b64encode(compressed).decode('ascii')
    with open(OUT_DATA_JS, 'w', encoding='utf-8') as f:
        f.write('window.CUSTOMER_ANALYTICS_CACHE = { b64Data: "' + b64 + '" };\n')
    print(f'[{time.time()-t0:.1f}s] wrote {OUT_DATA_JS} ({len(b64)} b64 chars, '
          f'{len(raw)} raw bytes -> {len(compressed)} gzipped)', file=sys.stderr, flush=True)

    # Checkpoint has served its purpose -- clear it so the next run does a
    # fresh parse instead of silently reusing stale aggregated data. This
    # mount has occasionally refused unlink() on other files (git's
    # index.lock hit the same thing) while still allowing rename() -- so
    # try remove first and fall back to renaming it out of the way.
    if os.path.exists(CHECKPOINT_PKL):
        try:
            os.remove(CHECKPOINT_PKL)
        except OSError:
            try:
                os.rename(CHECKPOINT_PKL, CHECKPOINT_PKL + '.consumed_' + str(int(time.time())))
            except OSError as e:
                print(f'[{time.time()-t0:.1f}s] WARNING: could not clear checkpoint ({e}) -- '
                      f'delete cache/.customer_analytics_checkpoint.pkl by hand before the next refresh.',
                      file=sys.stderr, flush=True)


if __name__ == '__main__':
    main()
