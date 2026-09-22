# Target Scenario — Implementation Summary
**Companion to the architecture proposal + dependency analysis | 2026-08-04**
**Status: Implemented, compiled, and unit-tested. Not yet pushed to GitHub (sandbox has no credentials — same standing constraint as every other change this session). Production cache regeneration still needs your own `refresh.bat` run — see §5.**

---

## 1. Files Modified

| File | Nature of change |
|---|---|
| `refresh_sales.py` | ETL now keeps `TargetIndex=0` rows (previously discarded); tags each mirror/target row's scenario into mask Bit 5; `SCHEMA_VERSION` 2 → 3 |
| `js/semantic-model.js` | New `TARGET_SCENARIOS` registry, `CHC_SINGLE_SCENARIO_LINES`, `resolveScenario()` — the single source of truth for scenario resolution and the CHC fallback rule |
| `js/auth.js` | New `SCENARIO_ROLE_CONFIG` table (8 roles + safe fallback), `canToggleScenario()`, `getActiveScenario()`, `setActiveScenario()` |
| `js/sales.js` | `REQUIRED_SCHEMA_VERSION` 2 → 3; new `includeTargetRow()`/`buildLineScenarioMap()` helpers; all 7 semantic-interface functions + `runAggregator()` + `exportCSV()` now scenario-aware; new role-gated Target Basis selector in the Sales Performance command bar |
| `js/executive.js` | `_filters.scenario` added; new `activeScenario()`/`scenarioFallbackNote()` helpers; 3 corporate benchmark helpers + `buildSalesProductivityCard` + `buildLinePerformanceTable` + 5 popups all scenario-aware; role-gated Target Basis selector added to the filter bar; new `collectSummariesPinnedOfficial()` for Business Review |
| `js/business-review-engine.js` | Header doc comment only — documents the Official-pin requirement and points at `collectSummariesPinnedOfficial()` (this engine has no live caller yet, see §4) |
| `dashboard.html` | Cache-busters bumped for `auth.js`, `semantic-model.js`, `sales.js`, `executive.js` |

No page, KPI, chart, filter, layout, navigation, or export was removed or restructured — every change is additive (a new parameter, a new gated branch, a new conditionally-rendered control).

---

## 2. Architectural Changes

**Row schema.** Rather than adding a new column, the Official/Working scenario is packed into Bit 5 of the existing per-row `mask` field (already used for IsBulk/IsTender/IsOffer/IsUPA/IsMirror). Bit 5 is only meaningful when Bit 4 (IsMirror) is set. Since `mask` is already part of the ETL's group-by key, Official and Working target rows for the same month/line/brand/... land in two separate aggregated rows automatically — no new grouping logic was needed.

**Resolution layer.** `SEMANTIC.resolveScenario(line, requestedScenario)` is the only place the CHC/CHC_SALES fallback rule lives. Every aggregation function calls `buildLineScenarioMap(scenario)` once per invocation (not per row) to get an array of `{lineIndex: wantOfficialBoolean}`, then a cheap `includeTargetRow(mask, wantOfficial)` mask test gates each row's contribution to the target sum. Actual-sales rows pass through unconditionally (their `TargetValue`/`TargetQuantity` are already 0 by the ETL's row convention, so the gate is a no-op for them).

**Explicit parameter, not ambient state.** All 7 semantic-interface functions in `sales.js` (`getBusinessSummary`, `getSalesAchievementSummary`, `getLineSalesSummary`, `getBrandAchievement`, `getItemAchievement`, `getDmSalesSummary`, `getDmRepsSalesSummary`) take `scenario` as an explicit trailing parameter, defaulting to `"official"` when omitted. This was the specific requirement you flagged: the existing memoization wrapper (`heavyFns`) keys its cache on `JSON.stringify(args)`, so scenario had to be a real argument, not a global read, or switching scenarios would silently return a stale cached result from the other scenario.

**UI.** Both the Sales Performance page and the Executive Command Center render a "Target Basis" control in their command bar — a real `<select>` for roles with `canToggleScenario()`, or a plain read-only label for everyone else. Locked roles never see a selector at all, not a disabled one, so their UI never implies a choice exists.

**CHC exception.** Handled entirely inside `resolveScenario()` — no card, table, or popup contains its own CHC-specific scenario logic. A small inline note ("Showing Official Target — no Working Target is defined for CHC") appears wherever relevant via a shared `scenarioFallbackNote()` helper, reusing the platform's existing informational-banner style rather than inventing new UI.

**Business Review.** Not currently wired to any live page (`business-review-engine.js` has no caller in `dashboard.html` today). Rather than leave this as a documentation-only promise, `executive.js` now exports `collectSummariesPinnedOfficial()` — a ready-made, correct entry point that always requests Official Target — so the safe integration is the path of least resistance whenever that workspace is built.

---

## 3. Regression Verification

**Static analysis.** Re-ran the same exhaustive grep from the dependency analysis (raw `TGT_VAL`/`TGT_QTY` reads) against the finished code: all 9 accumulation sites in `sales.js` are gated through `includeTargetRow()`; zero raw reads exist anywhere else, including `executive.js` (still 100% downstream of the semantic interface). All 6 touched files pass `py_compile`/`node --check`.

**Behavioral testing.** Built a Node.js harness that loads the real `semantic-model.js` and `sales.js` (via `vm.runInThisContext`, with `pako` for cache decompression) against a synthetic cache built in the exact 27-column row format, including a deliberately wrong "decoy" Working-Target value for CHC to prove the fallback truly overrides rather than just happening to have no data. 19 checks, all passing:

- Official vs Working produce genuinely different totals for a normal line (DIAB), across `getBusinessSummary`, `getBrandAchievement`, `getSalesAchievementSummary`, `getLineSalesSummary`.
- CHC's Working-scenario request still resolves to the Official value, ignoring the decoy — fallback confirmed structurally correct, not accidentally correct.
- Actual-sales values are unaffected by scenario switching (only target values change).
- Omitting the `scenario` argument entirely reproduces Official-scenario output exactly — this is the backward-compatibility guarantee for any code path not yet updated.
- Calling `getBusinessSummary('official')` then `('working')` then `('official')` again returns the correct value each time — confirms the memoization cache correctly differentiates by scenario argument rather than serving stale cross-scenario results.

A second harness loaded the real `auth.js` against a stub user roster and confirmed all 8 configured roles (plus the safe fallback for an unrecognized future role) resolve correctly — most importantly, that `AUTH.setActiveScenario('official')` is rejected (returns `false`, no state change) when called for a Line Manager, even if invoked directly rather than through the UI.

A third, standalone test re-implemented the modified ETL row-classification logic from `refresh_sales.py` and ran it against 8 edge cases (TargetIndex 0, 1, other values, blank, null, unparseable, float, string) — all produce the expected `is_mirror`/scenario/mask outcome.

**Not yet verified: the real production cache end-to-end.** I started a real `refresh_sales.py` run in the sandbox to regenerate `cache/sales.json` under the new v3 schema, but the sandbox's 45-second tool cap makes finishing a ~1M-row run impractical here (each resumable call nets progressively fewer new rows as the "skip already-processed rows" cost grows — got to 780,000 of 996,720 main-file rows before this stopped being a good use of time). The live cache is untouched (still v2) — the script only writes output at the very end, so this was safe to leave. See §5.

---

## 4. Known Follow-Ups

1. **Run `refresh.bat` on your machine** (no 45s constraint there) to regenerate `cache/sales.json`/`cache/sales.data.js` under schema v3. Until then, the Sales Performance tab will correctly show its existing "Cache Update Pending — WAITING ON CACHE SCHEMA v3" placeholder rather than misreading the old cache — the same protective gate that's always existed for schema changes, working exactly as intended.
2. **Business Review has no live page yet** — `collectSummariesPinnedOfficial()` is ready, but nothing calls it. Not a regression, just flagging that this piece is scaffolding for when that workspace gets built.
3. **Still open from the architecture proposal:** the real meaning of `TargetIndex=0` from the source-system owner (label stays "Working Target" until confirmed).
4. **TargetQuantity's own Working-Target coverage** was already validated in the dependency analysis (§8b) — same pattern as TargetValue, same CHC gap. No new work needed there.

---

## 5. What You Need To Do

```
cd "D:\2026\ZETA_INTEL_DASHBOARD\CoverageDashboard"
refresh.bat
```

This regenerates the Sales cache under schema v3 (includes both scenarios) and, per its existing behavior, stages the git commit. Push remains a manual/your-own-agent step, same as every other change this session — sandbox still has no GitHub credentials.
