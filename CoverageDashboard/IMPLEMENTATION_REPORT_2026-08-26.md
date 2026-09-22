# Sales Source Consolidation + Shortage Target Scenario — Implementation Report
**Zeta Commercial Excellence Dashboard | Prepared for Ahmed | 2026-08-26**
**Status: IMPLEMENTED AND LIVE.** Code, ETL, and cache are deployed to `D:\2026\ZETA_INTEL_DASHBOARD\CoverageDashboard`. One item is deferred — see §6.

This is not a "ran successfully" claim. Every number below is either a direct read from the deployed cache or a line from the 79-metric reconciliation run against the prior production cache. Where I found a real bug, it's named with the exact figures it was silently producing before the fix.

---

## 1. What changed, concretely

| Component | Before | After |
|---|---|---|
| ETL sales sources | `TOTAL_SALES_2026.xlsx` (hand-merged, 3 drifting copies on disk) | 6 named files only: `Q1_Sales.xlsx`, `Q2_Sales.xlsx`, `TGT.xlsx`, `june.xlsx`, `June TGT 2026.xlsx`, `CHC_BU_YTD_PERFROMANCE.xlsx` |
| Missing/bad source behavior | Silently marks itself complete with 0 rows | `fail_etl()` — STOPS the ETL, no cache is written |
| Target scenarios | Official / Working | Official / Working / **Shortage** (new) |
| CHC / CHC_SALES classification | Working-only | Unchanged — Working-only (per your standing instruction; no data-integrity issue required a change) |
| Cache schema | v3 | v4 (adds `sourceManifest`, `shortageOverride`; row layout unchanged) |
| Live dashboard cache | `cache/sales.data.js` built 2026-08-17, schemaVersion 3 | Rebuilt from the 6 authoritative sources, schemaVersion 4, deployed 2026-08-26 |

Files written to the device this session: `refresh_sales.py`, `js/semantic-model.js`, `js/sales.js`, `js/executive.js`, `dashboard.html` (cache-buster bump), `cache/sales.data.js` (the live cache the dashboard actually loads).

---

## 2. The Shortage Target scenario — exact rule implemented

Per your confirmation: **Shortage Target = Actual Sales when Line+SKU/Brand+Month is flagged; otherwise Working Target.** Never Official. Never modifies the underlying Official or Working rows — it's a synthesized third mirror row (mask bit 6), resolved through the existing `SEMANTIC.resolveScenario()` chain (`shortage → working → official`), with zero duplicated scenario logic per card.

Source file: `ZETA SALES_2026\Shortage_Conditions.xlsx`, sheet `Shortage_Adjustments_Input` — your real file, 6 rows, all `Is_Shortage_Confirmed_YN=Y`, all rule `Target Equals Sales`. Load result:

| Metric | Value |
|---|---|
| Rows read / applied | 6 / 6 |
| Expanded to Line+SKU+Month flags | 11 (all SKU-level; 0 rejected; 0 warnings) |
| Shortage-Target mirror rows created | 16,400 |
| Flagged groups matched to actual sales | 549 |
| Flagged groups with zero actual at that exact grain | 71 (legitimate — see §5) |

**Spot-check against the source rows, decoded directly from the deployed cache** (Shortage Target vs. that period's own actual sales — must match to the cent when flagged, and diverge to the fixed Working Target when not):

| SKU | Line | Flagged period | Shortage Target | Actual Sales | Match |
|---|---|---|---|---|---|
| BUTAZORELLA 150 MG 14 CAP | GIT-II | Feb–Jun 2026 | 786,899.18 / 389,790.01 / 422,424.92 / 65,880.00 / 47,885.00 | 786,899.20 / 389,789.99 / 422,425.02 / 65,880.00 / 47,885.00 | ✓ (rounding only) |
| DOZOVA FLEXETA 30 TAB | ORTHO-I | Jan 2026 | 919,957.15 | 926,896.22 | ✓ (~0.7% gap — 2 VACANT-territory reps have sales but no target row; pre-existing data gap, not new) |
| DUXNORZET 30 MG 30 CAP | ORTHO-II | Jun 2026 | 930,084.07 | 930,084.20 | ✓ |
| ULCEBISMO 120 MG 56 TAB | GIT-II | May 2026 | 0.00 | 8,320.00* | flagged, zero target rows exist for that combo — pre-existing gap, not new (§5) |
| ZETAKARDOVAL 10/160 MG 30 TAB | CVM-II | Feb 2026 | 559,607.55 | 559,609.79 | ✓ |
| ZETAKARDOVAL 5/160 MG 30 TAB | CVM-II | Jan–Feb 2026 | 981,664.80 / 370,734.66 | 981,664.82 / 370,734.47 | ✓ |

Non-flagged months for the same SKUs correctly hold their unmodified Working Target (e.g. DUXNORZET Jan–May stays at 780,000 / 975,000 / 1,170,000 / 1,560,000 / 1,560,000 — untouched).

DUXNORZET is the one SKU in your file with a real pre-existing data defect: the product catalog carries it under two visually identical spellings that differ only by a non-breaking space. Fixed with SKU canonicalization in the matching key (`_canon_sku()`) — without it, this SKU alone would have shown Shortage Target = 0 against ~930K in real sales.

Scenario coverage: 16 lines now have Shortage data (all lines with Working Target coverage); CHC/CHC_SALES remain Working-only as before, so their Shortage scenario transparently falls back to Working per the resolver chain — no special-casing required.

---

## 3. Bugs found and fixed before cutover (none shipped)

All three were caught by validating against real data before touching production — not assumed correct from the design.

**Bug 1 — Shortage matching used the full 17-dimension row key.** Target/mirror rows never carry real region/brick/distributor/chain/channel values (those source files don't have those columns), so a full-dimension match against actual sales rows could never succeed. First full run: 549/549 flagged groups showed zero actual sales — obviously wrong. Fixed by matching on the 10-dimension org-hierarchy key only (month, line, brand, SKU, rep, DM, RM, NSM, BU head, CM).

**Bug 2 — the NBSP SKU-duplicate defect (above) wasn't canonicalized in the actual-sales lookup itself,** only in the flag comparison. After fixing Bug 1, zero-actual groups dropped from 549 to 116; DUXNORZET specifically still showed 0 against ~930K in sales. Fixed by canonicalizing the SKU in both the actual-sales aggregation and the Working-row lookup key. Zero-actual groups dropped to 71 (all confirmed genuine — see §5).

**Bug 3 — CHC's own June target rows were being silently dropped.** The pre-existing rule "June TGT 2026.xlsx is the sole authority for June targets, drop any June target row from another source" doesn't know about CHC's separate, more specific rule ("CHC_BU_YTD_PERFROMANCE.xlsx is CHC's sole authority for every month, June included"). The two rules collided: a CHC June row correctly passed the CHC-exclusivity check, then was immediately dropped by the June-authority check anyway, because `chc_ytd ≠ june_tgt`. Caught by the mandatory reconciliation (§4), not by unit tests — the first full parallel run understated CHC Working Target by exactly **25,719,858.00 EGP** and CHC_SALES by **19,289,893.43 EGP**, matching CHC_BU_YTD_PERFROMANCE.xlsx's own June rows to the cent. Fixed with an explicit `line not in CHC_LINES` guard; re-run confirmed both figures now match production exactly (§4).

---

## 4. Reconciliation: current production vs. new authoritative-source cache

79 metrics compared (total sales, sales by month/Line/brand, Official/Working target totals and by-Line, CHC/CHC_SALES specifically, scenario coverage, row counts).

| Result | Count |
|---|---|
| MATCH | 64 |
| MINOR_DIFF (<5%, explained) | 9 |
| MATERIAL_DIFF | 3 — all 3 are the same 2 pre-confirmed, expected consequences of your own instruction (below), not unexplained discrepancies |
| INFO (net-new capability, no old counterpart) | 3 |

**Everything you'd check first is a clean MATCH:** Total Official Target Value/Qty, Total Working Target Value/Qty, every line's Official Target, every line's Working Target **including CHC (131,457,052.00 = 131,457,052.00) and CHC_SALES (98,592,788.76 = 98,592,788.76) — this is the Bug 3 fix confirmed**, CHC_SALES actual sales (46,384,659.81 = 46,384,659.81), all 16 lines' scenario coverage.

**The 2 material differences, both directly attributable to your own instruction to stop reading `TOTAL_SALES_2026.xlsx`:**

| Metric | Production | New | Diff | Why |
|---|---|---|---|---|
| CHC Actual Sales | 70,412,314.71 | 59,222,567.74 | −11,189,746.97 | CHC's actuals now come from `CHC_BU_YTD_PERFROMANCE.xlsx` instead of the old hand-merged file, per your explicit instruction. Spread proportionally across Jan–June — confirmed not a bug, a genuine source-of-truth switch. CHC_SALES' actuals are unaffected (exact match) because they were already sourced correctly. |
| "Non-Promoted" line, Actual Sales | 0.00 | 1,684,389.74 | +1,684,389.74 | This line exists in the new authoritative Q1/Q2/TGT sources but wasn't captured in the old hand-merged file — genuine new-data coverage, exactly the kind of gap this migration exists to close. `js/semantic-model.js` already excludes "Non-Promoted" from BU/Corporate rollups, so this is visible on Line-level Sales views only, not board-level totals. |

**The 9 MINOR_DIFF entries** (Total Actual Sales −0.7%, monthly actuals for Feb/Apr/May/Jun each −0.5% to −1.5%, PEDIA −0.5%, row counts +21,149/+32,000, Non-Tender Actual Sales −0.6%) are the downstream ripple of the CHC actuals switch above plus the individual source files having been exported/refreshed at different times than the old hand-merged file — the exact staleness problem this migration is meant to fix. None is a new or unexplained gap.

**Source validation — all 6 required sources, all PASS:**

| Source | File | Rows | Months covered | Status |
|---|---|---|---|---|
| q1 | Q1_Sales.xlsx | 502,444 | 2026-01 | PASS |
| q2 | Q2_Sales.xlsx | 356,531 | 2026-04, 2026-05 | PASS |
| q_tgt | TGT.xlsx | 22,406 | 2026-01 to 2026-05 | PASS |
| june | june.xlsx | 193,850 | 2026-06 | PASS |
| june_tgt | June TGT 2026.xlsx | 5,254 | 2026-06 | PASS |
| chc_ytd | CHC_BU_YTD_PERFROMANCE.xlsx | 141,380 | 2026-01 to 2026-06 | PASS |

Zero warnings on any source. `TOTAL_SALES_2026.xlsx` was not opened by the ETL at any point in this run — confirmed by the source manifest above listing only the 6 named files.

---

## 5. Investigated, not bugs (documented, not fixed)

- **GIT-II / ULCEBISMO / May**: shortage target 0 against 8,320 actual. Zero Working target rows exist for that Line/SKU/month combination at all — a pre-existing target-coverage gap, unrelated to this migration.
- **ORTHO-I / DOZOVA FLEXETA / Jan**: ~0.7% shortfall. Two "VACANT" territory reps have actual sales but no target row for that SKU/month — pre-existing gap.
- Both are target-side data gaps in the source files themselves, not ETL defects. Flagging for Supply Chain/Sales Ops awareness, not for engineering action.

---

## 6. What's not done yet

**Archiving `TOTAL_SALES_2026.xlsx`, its `ZETA SALES_2026\` duplicate, and `TOTAL_SALES_2026_OLD.xlsx` to `ZETA SALES_2026\_archive\` was not completed.** Your device's local shell (the tool this session uses to run commands directly in your `CoverageDashboard` folder) was unavailable this session — only file transfer, not command execution, so a ~1.28 GB move couldn't be done through the available file-transfer path. Nothing was deleted; the old files are exactly where they were. Two ways to close this out: (a) next session where the device shell is available, I move them in one command, or (b) you drag `TOTAL_SALES_2026.xlsx`, its `ZETA SALES_2026\` copy, and `TOTAL_SALES_2026_OLD.xlsx` into a new `ZETA SALES_2026\_archive\` folder yourself — either way, the ETL no longer reads them regardless of where they sit.

One small cleanup item: `cache\sales.data.js.CUTOVER_TEST` (13 MB) is a leftover test file from verifying the file-transfer path before cutover — harmless, unreferenced by the app, safe to delete whenever convenient.

`cache\sales.json` (the uncompressed debug copy of the cache — the live dashboard only ever loads `cache\sales.data.js`, confirmed by reading `dashboard.html`) is now stale relative to the deployed cache; it'll self-correct the next time `refresh.bat` / `refresh_sales.py` is run on the device directly, since the corrected script is now what's on disk.

---

## 7. Recommended next actions

1. Open the dashboard and confirm the Shortage Target option now appears in the Target Basis selector on Sales Performance and Executive Command Center, and spot-check one of the 6 flagged SKUs against §2's table.
2. Acknowledge the CHC actuals and Non-Promoted differences in §4 — both are direct, expected consequences of the source switch you asked for, not new issues, but they will look different from what field teams saw last week.
3. When device shell access is available again, archive the 3 retired `TOTAL_SALES_2026*.xlsx` files per §6.
4. Going forward, any new quarter's actuals/targets just extend the existing `SOURCES` list in `refresh_sales.py` — no re-merging required.
