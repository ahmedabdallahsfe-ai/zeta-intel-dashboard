# Customer Analytics ETL Spec — Unique/Lost/Frequent Customers + Full/Partial SKU Basket

**Requested:** for the Retail cluster (and any cluster), unique customer count, lost customers, frequent customers, full-vs-partial-basket customers, with SKU names. **Status: not buildable from the current cache.** This spec defines exactly what `refresh_sales.py` needs to add, and the visualization design to build against it once the data exists.

## 1. Why this doesn't work today

Two structures exist in the Sales cache, neither sufficient:

| Structure | Grain | What it's missing |
|---|---|---|
| `cache.rows` (512,669 rows) | Month × Line × Brand × Product × Rep × ... × sub_type × Tender-flag | No customer identity at all — only `CUST_COUNT`, a per-row *count*, not an ID. Fully aggregated away. |
| `cache.customers` (323,318 rows) | customer_id × rep × brick × region × line | No sub_type/cluster link, no month, no product. Built only to compute an "active customer count" for the existing Rep/Brick/Region/Line filters — confirmed by direct inspection, not documented anywhere else. |

Consequence: today we cannot filter customer identity by cluster, cannot see a customer's history across months (no month field on the roster), and cannot see what products a customer bought (no product field anywhere customer identity exists). Every one of the requested metrics needs at least two of these three joined together — none of the current structures provide it.

## 2. Verification -- CONFIRMED 2026-07-28

Checked directly: `TOTAL_SALES_2026.xlsx`, sheet `Tota_SALES_2026` (996,721 rows incl. header — matches `cache.meta.sourceRows` exactly, confirming this is the raw source `refresh_sales.py` reads). Its 53 columns include `CustomerID`, `CustomerName`, `SubType`, `MainType`, `Item` (SKU name), `Date` (day-level), `Quantity`, `Value`, `TargetQuantity`, `TargetValue`, `IsTender` — everything needed is present at transaction grain, confirmed by the business owner and by direct inspection of sample rows (real Arabic pharmacy/account names, e.g. "صيدلية المجمع الطبى بالمعادى..."). This is the expected case from Section 2's original two possibilities — the fix is entirely inside `refresh_sales.py`, no new raw data extract needed.

**Proof of concept already run (2026-07-28), not yet wired into the live dashboard:** extracted all Retail-cluster rows (sub_types: Special PHs, Private, EgyDrug_Pharmacies, Retail, Account) directly from this source file, Non-Tender only — 604,025 of 996,720 total rows, 45,680 distinct customers (CustomerID). Full customer bridge (New/Lost/Retained/Reactivated), frequency segmentation, and Pareto-based Full/Partial SKU basket computed and delivered as `retail_cluster_customer_analysis.xlsx`. See `PLATFORM_ROADMAP.md`'s "Retail cluster customer analysis" entry for the headline numbers and methodology. This validates the whole approach end-to-end — industrializing it into `refresh_sales.py` + `js/sales.js` per Sections 3-6 below is now a known-good, lower-risk build, not exploratory work.

## 3. Proposed new cache structure

Add `cache.customerMonthly`: one row per (customer, month, sub_type, product), **Non-Tender only** (matching this platform's established convention for every Achievement-style figure).

```
[monthIdx, custId, subTypeIdx, lineIdx, productIdx, val, qty]
```

If the source has a real customer *name* (not just an ID), add `cache.lookups.customerNames` and store the lookup index instead of a raw ID — this is what finally makes "customer name" literal rather than a sub_type proxy, and matters most inside generic clusters (Retail, Stores, Institutional/Government) where sub_type alone doesn't distinguish individual accounts today.

**Row-count estimate:** 48,040 known distinct customers × 100 products × 5 months = 24.0M dense upper bound, but real purchasing is sparse (no customer buys all 100 SKUs every month) — expect low hundreds-of-thousands to low millions of actual rows, in the same order of magnitude as `cache.rows` today. Should still gzip/ship client-side like the other caches; if it doesn't, fall back to pre-aggregating the derived metrics below in Python and shipping only those (smaller, but loses ad-hoc drill flexibility).

## 4. Derived metric definitions (compute client-side in `sales.js`, same pattern as everything else on this platform — no metric gets pre-baked into the cache)

| Metric | Definition |
|---|---|
| Unique Customers (by cluster) | `distinct custId` where `subType → cluster` matches, scoped to latest month (or a selected month). |
| New | `custId` present in the current month, absent in **every** prior month in the cache. |
| Lost | `custId` present in the prior month, absent in the current month. |
| Retained | `custId` present in both current and prior month. |
| Reactivated | `custId` present currently, absent last month, but present ≥2 months ago (distinguishes from New). |
| Frequent vs Occasional | Count distinct months each `custId` appears in over the cache's full window (5 months today). Suggested cut: Frequent = 4–5/5 months, Occasional = 2–3/5, One-time = 1/5 — thresholds are a judgment call, confirm with the business owner once real numbers are visible. |
| Full vs Partial basket | Define a "core SKU list" per line/BU (e.g., top N SKUs by value, or all actively-promoted SKUs — needs a business decision, not inferable from data alone). Full = customer bought ≥ threshold% of the core list (e.g., 80%); Partial = bought some, below threshold. |
| SKU penetration | For each SKU: `% of cluster's customers who bought it` = `distinct custId who bought SKU X` / `distinct custId in cluster`. Ranked descending — separates core products (bought by most) from peripheral ones. |

## 5. Best-practice visualization design (build once the data exists)

- **Customer bridge / waterfall** for New → Lost → Retained → Reactivated, month-over-month. Standard in commercial-excellence customer-dynamics reviews — shows the net movement, not just a static count, which is what actually drives action (chase the Lost list, protect the Retained core).
- **Frequency segmentation** as a simple stacked bar or funnel (Frequent / Occasional / One-time), sized by customer count and by value contribution side-by-side — a customer can be small in count but large in value, and vice versa; showing both avoids over- or under-reacting to headcount alone.
- **Full vs Partial basket**: a histogram of "# distinct SKUs purchased per customer" (reveals the natural full/partial split visually before forcing a threshold), plus a ranked SKU penetration bar chart (not a customer × SKU heatmap — with 48k customers a heatmap is unreadable; the ranked bar answers "which SKUs are core vs peripheral" directly, which is the actionable question).
- **Cluster-level rollup**: reuse the existing Customer Channel Mix card's cluster list as the entry point — clicking a cluster (e.g., Retail) opens this new customer-dynamics view scoped to that cluster, consistent with the platform's existing cluster → sub_type drill pattern already built.

## 6. Implementation checklist

1. Confirm the raw source has customer ID/name at transaction grain (Section 2) — **do this first**, it gates everything else.
2. Extend `refresh_sales.py` to emit `cache.customerMonthly` (and `customerNames` lookup if names exist), Non-Tender only.
3. Re-run `refresh_sales.py` against the source Excel, regenerate `cache/sales.json` → `sales.data.js`.
4. Add `getCustomerDynamics(bu, cluster)` and `getSkuPenetration(bu, cluster)` to `js/sales.js`, same defensive `{ok, status, ...}` contract as every other interface on this platform.
5. Wire a drill-down from the Customer Channel Mix card's cluster rows into this new view, per Section 5.
6. Confirm the Full/Partial basket threshold and Frequent/Occasional month-count cutoffs with the business owner before shipping — both are judgment calls documented here as defaults, not fitted values.
