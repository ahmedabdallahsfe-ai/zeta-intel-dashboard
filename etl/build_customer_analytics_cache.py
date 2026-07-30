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

SOURCE_XLSX = '/sessions/happy-laughing-feynman/mnt/CoverageDashboard/TOTAL_SALES_2026.xlsx'
SOURCE_SHEET = 'Tota_SALES_2026'
OUT_JSON = '/sessions/happy-laughing-feynman/mnt/CoverageDashboard/cache/customer_analytics.json'
OUT_DATA_JS = '/sessions/happy-laughing-feynman/mnt/CoverageDashboard/cache/customer_analytics.data.js'
# Checkpoint (2026-07-28): the xlsx parse+aggregate step and the JSON+gzip
# write step are split across a disk checkpoint because together they can
# exceed the sandbox's 45s hard command timeout once skuPenetrationByBU
# roughly quadruples the per-cluster SKU payload. If this file exists, main()
# skips straight to serialization instead of re-parsing the ~1M-row source.
# Delete it (or let a fresh run overwrite it) to force a full re-parse.
CHECKPOINT_PKL = '/sessions/happy-laughing-feynman/mnt/CoverageDashboard/cache/.customer_analytics_checkpoint.pkl'

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
    wb = CalamineWorkbook.from_path(SOURCE_XLSX)
    sheet = wb.get_sheet_by_name(SOURCE_SHEET)
    print(f'[{time.time()-t0:.1f}s] sheet parsed', file=sys.stderr, flush=True)

    rows_iter = sheet.iter_rows()
    header = next(rows_iter)
    idx = {name: i for i, name in enumerate(header)}
    ci_date, ci_line, ci_st, ci_cid, ci_cname, ci_item, ci_qty, ci_val, ci_tender = (
        idx['Date'], idx['Line'], idx['SubType'], idx['CustomerID'], idx['CustomerName'],
        idx['Item'], idx['Quantity'], idx['Value'], idx['IsTender']
    )

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
                         'itemValueByBU': defaultdict(lambda: defaultdict(float))}
        c = cust[cid]
        m = str(row[ci_date])[:7]
        c['months'].add(m)
        item = row[ci_item]
        c['items'].add(item)
        c['value'] += row[ci_val] or 0
        c['qty'] += row[ci_qty] or 0
        c['txn'] += 1
        bu = LINE_TO_BU.get(row[ci_line])
        if bu:
            c['bus'].add(bu)
            bu_customers[cluster][bu].add(cid)
            item_value_by_bu[cluster][bu][item] += row[ci_val] or 0
            item_customers_by_bu[cluster][bu][item].add(cid)
            c['itemValueByBU'][bu][item] += row[ci_val] or 0

        item_value[cluster][item] += row[ci_val] or 0
        item_customers[cluster][item].add(cid)

    print(f'[{time.time()-t0:.1f}s] scanned {scanned} rows, clusters built: '
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
            # scoped to whichever BU is selected. Capped at 20 to keep the
            # payload bounded (a handful of high-value retail/chain accounts
            # can otherwise carry 100+ distinct SKUs each).
            items_by_bu = {
                bu_name: [name for name, _ in sorted(item_vals.items(), key=lambda kv: -kv[1])[:20]]
                for bu_name, item_vals in c['itemValueByBU'].items()
            }

            customer_rows.append({
                'id': cid, 'name': clean(c['name']), 'monthsActive': freqN,
                'bridgeSegment': bridge_seg, 'frequencySegment': freq_seg,
                'basketSegment': seg.capitalize() if seg != 'none' else 'None of core',
                'distinctSkus': len(c['items']), 'value': round(c['value'], 2),
                'qty': round(c['qty'], 2), 'txn': c['txn'], 'bus': sorted(c['bus']),
                'itemsByBU': items_by_bu,
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
