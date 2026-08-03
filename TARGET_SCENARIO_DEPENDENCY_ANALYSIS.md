# Target Scenario — Dependency Analysis
**Companion to TARGET_SCENARIO_ARCHITECTURE_PROPOSAL.md | Pre-implementation audit | 2026-08-03**
**Status: Analysis only. No code changed.**

---

## 0. Decisions Locked (per your last message)

Single codebase / single `resolveTarget()`, TargetIndex hidden, Official/Working naming, CHC silent fallback, and the 8-role permission table are all confirmed and will not be re-litigated. This document is the dependency map you asked for before building against them.

---

## 1. Method

I grepped every `.js` file in the codebase for target-value identifiers (`targetValue`, `targetYTD`, `tgtValue`, `TGT_VAL`, `TargetIndex`, etc.), then read the surrounding function for each hit to classify it. Finding: **every real TargetIndex-based read in the entire app traces back to exactly 10 source call-sites.** Everything else — cards, popups, tables, exports — consumes the *output* of those 10 sites and does not touch raw target data itself. That's the good news: it confirms the resolver pattern will work with a small, contained blast radius, not a sprawling one.

---

## 2. Tier 1 — Source Layer: `sales.js` Semantic Interface (7 of 9 functions)

These are the platform's single source of truth for target figures — every other workspace (Executive, Business Review) calls these, never reads cache rows directly. **This is where `resolveTarget()` must be wired first**; everything downstream inherits automatically.

| Function | Lines | Target fields returned | Consumers |
|---|---|---|---|
| `getBusinessSummary(bu)` | ~2771–2841 | `targetYTD`, `achievementPct` | Sales Achievement card, corporate benchmark |
| `getSalesAchievementSummary(bu, line)` | ~3094–3147 | `targetYTD`, `achievementPct` | Sales Achievement card, `corporateSalesAchievementPct()` |
| `getLineSalesSummary(bu, months)` | ~2979–3034 | `targetValue` per line | Line Performance table, Sales Productivity card |
| `getBrandAchievement(bu, line)` | ~2873–2935 | `targetValue`, `targetQty` per brand | Brand modal, Sales Value modal, Sales Units modal, Sales Value/Productivity cards |
| `getItemAchievement(bu, brandName, line)` | ~3165–3219 | `targetValue`, `targetQty` per item | Item modal (CHC), Sales Units modal (CHC) |
| `getDmSalesSummary(bu, line, months)` | ~3635–3706 | `targetValue` per DM | (available, currently only DM roll-ups) |
| `getDmRepsSalesSummary(bu, line, dmName)` | ~3720–3756 | `tgtVal` per rep | DM drill-down modal (rep table) |

**Not target-bearing — no change needed:** `getCustomerClusterMix()`, `getRepPositionsMap()`.

---

## 3. Tier 2 — Sales Performance Page Internals (`sales.js`, non-exported)

This module already follows the exact pattern you're asking for platform-wide: **aggregate once, read many.** `runAggregator()` sums `TGT_VAL` into a single `res.tgtValue` (lines ~389–436); every other function in the page reads that one field. This is a positive precedent, not new risk — only `runAggregator()` needs to call `resolveTarget()`; the 4 consumers below need zero changes.

| Consumer | Line | Reads |
|---|---|---|
| `getStrategicNarrative(res)` | 770 | `res.tgtValue` |
| `renderLayout()` | 1027, 1217 | `res.tgtValue` (KPI headline, map tooltip) |
| `getPageContentHTML(res)` | 1214+ | `res.tgtValue` |
| `exportCSV(res)` | 2505–2516 | raw `TGT_QTY`/`TGT_VAL` columns — **exception, see §6** |

---

## 4. Tier 3 — Executive Command Center Consumers (`executive.js`)

### 4a. Corporate benchmark helpers (feed "vs Corporate" on every Sales-family card)

| Function | Lines | Basis |
|---|---|---|
| `corporateSalesAchievementPct()` | 194–202 | Value |
| `corporateSalesValueAchievementPct()` | 204–212 | Value |
| `corporateSalesUnitsAchievementPct()` | 214–221 | **Units (targetQty)** — see §7c |

These three must resolve the same scenario as the card that's displaying them, or a Working-Target card view would compare itself against an Official-Target corporate benchmark — a real, easy-to-miss inconsistency if only the card-level number is switched.

### 4b. KPI card builders — confirmed target-dependent (4 of 11)

| Card | Lines | Notes |
|---|---|---|
| `buildSalesAchievementCard` | 537–626 | |
| `buildSalesValueCard` | 626–676 | |
| `buildSalesUnitsAchievementCard` | 676–745 | Units basis |
| `buildSalesProductivityCard` | 1012–1503 | Heaviest dependency — **see §7c, CHC logic collision risk** |

### 4c. KPI card builders — confirmed NOT target-dependent (7 of 11, no change)

`buildCoverageFamilyCard` (takes a hardcoded coverage % target, unrelated), `buildSFECard` (headcount fill-rate), `buildCustomerClusterMixCard`, `buildMarketShareCard` (IQVIA DM1/DM2 market target — different data source), `buildBUGrowthCard` (IQVIA market growth target), `buildPullThroughCard` (fixed 100% threshold), `buildStockDaysCard` (fixed 30–45 day threshold).

### 4d. Table

| Component | Lines | Notes |
|---|---|---|
| `buildLinePerformanceTable(bu, line, months)` | 1619–1700 | Two branches (DM-within-Line, Line-across-BU), both read `targetValue`/`targetPerPosition` |

### 4e. Popups / modals — all inherit from Tier 1, zero independent target logic

`openBrandAchievementModal`, `openItemAchievementModal`, `openSalesValueModal`, `openSalesUnitsModal`, `openDmDetailsModal` — all call the Tier 1 functions and render whatever comes back. **No changes needed here beyond the fact that they'll automatically show the right scenario once Tier 1 is fixed.**

---

## 5. Tier 4 — Fully Downstream (inherit automatically, zero changes)

`exportTableRowsCSV()` (generic — serializes whatever rows/columns it's handed), `exportClusterCustomersCSV()` (no target fields at all). Any table or export built from Tier 1/Tier 3 output is scenario-correct for free.

---

## 6. `exportCSV()` in sales.js — the one place that must NOT be silently swept in

Line 2516 writes raw `r[TGT_QTY]`/`r[TGT_VAL]` straight from the cache row, bypassing `res.tgtValue` entirely. If the export should reflect the active scenario (which it should, for consistency with the on-screen KPI), this needs an explicit fix, not just a wrapper — it's currently reading the row array directly, not the resolved aggregate.

---

## 7. Confirmed Out of Scope — different data source, do not touch

| Item | Where | Why excluded |
|---|---|---|
| IQVIA "Target Achievement" (DM1 market growth target) | `iqvia.js` | Different data source (`TARGETS_2026`), different metric entirely — market growth, not sales value |
| Coverage & Frequency "Target Visits" | `app.js` line 1092 | Call-frequency target, unrelated field |
| Market Share card's DM1/DM2 blended target | `executive.js` buildMarketShareCard | IQVIA-sourced, not TargetIndex |
| BU Growth card's market growth target | `executive.js` buildBUGrowthCard | Same as above |

---

## 8. Risks Found During This Analysis (new, not in the original proposal)

**a. Memoization cache will silently serve the wrong scenario if not handled.** `sales.js` wraps all 7 semantic functions in a memoization layer (lines ~3765–3796) keyed on `userEmail + fnName + JSON.stringify(args)`. If the active scenario is read from a global/session flag *inside* the function body rather than passed as an explicit argument, the cache key never changes when a user switches scenarios — the second call returns the FIRST scenario's cached result. This is the same class of bug that caused the earlier NaN incident, just a different failure mode (stale-but-valid-looking data instead of NaN, which is arguably worse because nothing looks broken). **Resolution: scenario must be an explicit parameter to every Tier 1 function, not an ambient read**, so it naturally participates in the memo key.

**b. TargetQuantity (Units basis) — validated, resolved.** Re-ran the same per-Line audit against `TargetQuantity` (not just `TargetValue`) across all three source files. Pattern matches exactly: CHC and CHC_SALES both sit at 19.6% (same annual-file gap as Value), and every other line shows Working ≥ Official (100.0%–174.1%, identical ratios to the Value-basis table in the original proposal). `buildSalesUnitsAchievementCard`, `corporateSalesUnitsAchievementPct()`, and the Sales Units popups can be wired with the same CHC fallback rule and the same "Working ≥ Official" expectation as the Value-basis functions — no separate handling needed.

| Line | Official Qty | Working Qty | Working as % of Official |
|---|---|---|---|
| CHC | 413,439 | 80,892 | 19.6% |
| CHC_SALES | 310,082 | 60,669 | 19.6% |
| CVM-I | 237,900 | 247,100 | 103.9% |
| CVM-II | 291,684 | 291,684 | 100.0% |
| DIAB-I | 470,800 | 528,000 | 112.1% |
| DIAB-II | 52,740 | 91,800 | 174.1% |
| DIAB-III | 494,500 | 666,500 | 134.8% |
| DIAB-IV | 338,800 | 462,000 | 136.4% |
| Derma | 205,000 | 205,000 | 100.0% |
| GIT-I | 1,753,100 | 1,966,300 | 112.2% |
| GIT-II | 901,600 | 992,250 | 110.1% |
| GIT-III | 65,200 | 94,000 | 144.2% |
| NEUROSCIENCE | 64,682 | 75,418 | 116.6% |
| ORTHO-I | 168,800 | 168,800 | 100.0% |
| ORTHO-II | 219,600 | 219,600 | 100.0% |
| PEDIA | 701,500 | 800,871 | 114.2% |
| **TOTAL** | **6,689,427** | **6,950,885** | **103.9%** |

**c. Two different "CHC special cases" already coexist inside `buildSalesProductivityCard` — do not conflate them.** Lines 1060–1136 already contain a hand-built CHC exception for the *mirror-image headcount* logic (CHC's own actual/target ÷ CHC+CHC_SALES combined positions — [[chc_line_dedup]]). The new CHC *scenario-fallback* rule (always show Official because no Working Target exists) is a separate concern that happens to touch the same function. Implementing both correctly means the scenario fallback happens inside `resolveTarget()` itself (Tier 1, before this function ever runs), so this function keeps doing only the headcount-mirroring math it already does — it should never need to know about scenarios at all if Tier 1 is built correctly.

**d. Business Review workspace scope is undefined.** `business-review-engine.js` (lines 159, 204–275) consumes `getBusinessSummary()` and `getBrandAchievement()` output for the formal Business Review document/pilot deck. **[DECISION NEEDED]:** should this workspace inherit the signed-in user's active scenario, or should it always render Official Target regardless of what the user has toggled elsewhere (my default assumption, since it's a formal externally-shared document, not a working view)? Not deciding this before build risks a Business Review PDF that silently shows Working Target numbers if generated while someone's session is toggled.

---

## 9. Coverage Confidence Statement

10 source call-sites (7 in §2 + 3 in §4a) require `resolveTarget()` wiring, plus `runAggregator()` in §3, plus the raw-row read in `exportCSV()` (§6) = **12 total edit points.** Every other target-displaying element in the Sales Dashboard and Executive Command Center (4 KPI cards, 1 table, 5 popups, 2 export helpers) consumes those 12 outputs and requires no independent changes. §8b is now closed — TargetQuantity confirmed to follow the identical pattern to TargetValue (same CHC gap, same Working ≥ Official ratios), removing the one open data-validation risk. This is the basis for saying 100% of the Sales Dashboard becomes scenario-aware by construction, not by remembering to update every card individually, provided §8a (memoization key) is handled correctly during build.

---

## 10. Decisions Confirmed (2026-08-04)

1. Business Review workspace is **pinned to Official Target always** — does not inherit the active scenario. Governance/board-reporting requirement.
2. "Working Target" stands as the placeholder label until the source-system owner confirms what `TargetIndex=0` means. `TargetIndex` itself stays out of the UI permanently.
3. Scenario is an **explicit parameter** to every semantic function — never read from global/session state — so the existing memoization cache (§8a) stays correct by construction.
4. `resolveTarget()` is the **sole** entry point for target resolution — no exceptions anywhere in the Sales Dashboard or Executive Command Center.
5. Full backward compatibility — every existing page, filter, calculation, export, and performance characteristic is unchanged; only target-dependent metrics gain scenario-awareness.

---

## 11. Final Pre-Implementation Verification — Zero Uncovered Raw Reads

You asked for a closing check: confirm every direct `TargetValue`/`TargetQuantity` read in the codebase is accounted for, with nothing slipping past the approved set. I re-grepped the entire `js/` directory for the raw cache-row constants themselves (`TGT_VAL`, `TGT_QTY` — the array-index identifiers, not the field names on returned objects) rather than function names, to catch anything Tier-mapping by function name could have missed.

**Result: 15 code lines read these constants directly, across the whole codebase. Zero of them are outside `sales.js`.**

| Line (sales.js) | Function | Basis | Status |
|---|---|---|---|
| 427–428 | `runAggregator()` | Value + Qty | Tier 2 source — approved, needs `resolveTarget()` call |
| 2516 | `exportCSV()` | Value + Qty | Approved exception — currently reads raw row, needs explicit fix (§6) |
| 2802 | `getBusinessSummary()` | Value | Tier 1 — approved |
| 2901, 2903 | `getBrandAchievement()` | Value + Qty | Tier 1 — approved |
| 3019 | `getLineSalesSummary()` | Value | Tier 1 — approved |
| 3119 | `getSalesAchievementSummary()` | Value | Tier 1 — approved |
| 3203, 3205 | `getItemAchievement()` | Value + Qty | Tier 1 — approved |
| 3675 | `getDmSalesSummary()` | Value | Tier 1 — approved |
| 3753 | `getDmRepsSalesSummary()` | Value | Tier 1 — approved |

Every line resolves to exactly the 7 Tier 1 functions + `runAggregator()` + `exportCSV()` already identified in §2/§3/§6 — no 8th read site exists anywhere. The one hit in `executive.js` (line 1037) is a code comment, not a live reference — confirmed by reading it in context. This is the strongest form of the guarantee you asked for: **`executive.js` never touches a raw cache row for target data at all, in any function** — it is 100% downstream of `sales.js`'s semantic interface, which is exactly the "semantic-layer enhancement, not scattered UI logic" shape you asked for.

`getCustomerClusterMix()` and `getRepPositionsMap()` — re-confirmed zero target reads, no change needed.

**Net implementation surface: 9 functions to modify** (7 Tier 1 functions gain an explicit `scenario` parameter and call `resolveTarget()` internally; `runAggregator()` gains the same; `exportCSV()` gets its raw-row read replaced), plus the 3 corporate-benchmark helpers in `executive.js` threading the parameter through to their `safeCall(...)` invocations. Nothing else in the codebase requires a code change to become scenario-aware — every card, table, popup, and export inherits it by consuming these functions' output, per §9's coverage confidence statement.

This closes the verification you asked for. Ready to move to implementation on your go-ahead.
