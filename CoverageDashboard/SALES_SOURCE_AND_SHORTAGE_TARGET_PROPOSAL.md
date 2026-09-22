# Sales Source Consolidation + Shortage Target Scenario — Proposal
**Zeta Commercial Excellence Dashboard | Prepared for Ahmed | 2026-08-26**
**Status: Proposal for decision. No implementation, no file moves, no code changes made yet.**

---

## 1. Executive Summary

This is a system, not a file-cleanup job — the sales cache already runs on a working, previously-shipped **dual target-scenario architecture** (Official/Working) built 2026-08-04, and this request extends it with a third scenario (Shortage) while re-pointing its raw inputs at three cleaner source files. I audited the live pipeline and the actual data before writing this, not just the file names.

**Two facts from that audit directly conflict with today's message and must be resolved before anything is touched:**

1. **"Buffer" was explicitly rejected as a label on 2026-08-04**, in writing, in the code itself — because the data shows the second target series is *higher* than Official on every line that has both (a stretch target, not a floor). Today's message calls it "buffer" again. I need to know if that's just a casual word choice or an intentional reversal of that decision.
2. **CHC and CHC_SALES are currently classified Working-only**, not Official-only — a decision Ahmed gave explicitly on 2026-08-04 ("consider target index 1 and consider it as index 0"), and one I just re-verified against the raw `CHC_BU_YTD_PERFROMANCE.xlsx` file directly: CHC's `TargetIndex=0` rows (674 of them) sum to **exactly zero** — real rows, no real data. Today's message says CHC has only an "original" target. See §3 for the full reconciliation — this single flag changes what number CHC reports.

Separately, and independent of those two decisions: the three files you named (`Q1_Sales.xlsx`, `Q2_Sales.xlsx`, `CHC_BU_YTD_PERFROMANCE.xlsx`) are **not currently read by the ETL at all**. The live pipeline reads a hand-merged `TOTAL_SALES_2026.xlsx` instead — which now exists as **three drifting copies** (~1.3 GB combined) across two folders, exactly the "which file is the real one" problem this request is trying to eliminate.

**Recommended path (detailed in §5):** resolve the two decisions above, verify the two large files' column schema (I've already verified `CHC_BU_YTD_PERFROMANCE.xlsx` — see §2), re-point the ETL's source list at the three named files, add Shortage as a third registered scenario using the same resolver pattern the codebase already runs in production, validate the new pipeline against the current audited totals before cutover, then archive (not delete) the redundant files.

---

## 2. Observe — Verified Current State

### 2.1 What's actually on disk today

| File | Location | Size | Role today |
|---|---|---|---|
| `TOTAL_SALES_2026.xlsx` | root | 492 MB | **Live ETL source** ("main"), sheet `Tota_SALES_2026` — hand-merged, Jan–May |
| `TOTAL_SALES_2026.xlsx` | `ZETA SALES_2026\` | 499 MB | **Duplicate copy**, different size, different (older) modified date — not read by the ETL from this path |
| `TOTAL_SALES_2026_OLD.xlsx` | root | 314 MB | Superseded copy, kept but unused |
| `june.xlsx` | `ZETA SALES_2026\` | 70 MB | **Live ETL source** ("june"), sheet `SalesPerDistributor` — actuals only, zero target rows as of the 2026-08-04 re-export |
| `June TGT 2026.xlsx` | `ZETA SALES_2026\` | 640 KB | **Live ETL source** — sole authority for June's targets (both scenarios) |
| `TGT.xlsx` | `ZETA SALES_2026\` | 2 MB | **Corrected below (§2.2) — this is NOT orphaned.** It's the Jan–May position-level target file, same role as `June TGT 2026.xlsx` but for the earlier months. |
| `Q1_Sales.xlsx` | `ZETA SALES_2026\` | 100 MB | **Not read by the ETL today** — actuals only, no target columns (verified below) |
| `Q2_Sales.xlsx` | `ZETA SALES_2026\` | 72 MB | **Not read by the ETL today** — actuals only, no target columns (verified below) |
| `CHC_BU_YTD_PERFROMANCE.xlsx` | `ZETA SALES_2026\` | 21.5 MB | **Not read by the ETL today** — self-contained, actuals + targets in one file |

Combined size of the files that would be retired if this proposal goes ahead: **~1.28 GB**, across two locations, with the two `TOTAL_SALES_2026.xlsx` copies actively disagreeing with each other (different byte size, different modified date) about which one is current.

### 2.2 What I verified directly (not assumed) — updated after opening every file in `ZETA SALES_2026\`

I opened all four candidate files, not just named them from the folder listing. Two things I said in the first pass turned out to need correcting, so here's the accurate picture:

**`CHC_BU_YTD_PERFROMANCE.xlsx`** — single sheet `CHC_YTD_PERFROMANCE`, 115,340 rows, **51 columns**, self-contained (actuals + `TargetQuantity`/`TargetValue`/`TargetIndex` in the same file) — identical schema to what `refresh_sales.py` already expects from `TOTAL_SALES_2026.xlsx`. Row reality by Line × TargetIndex:

| Line | TargetIndex | Rows | Sum of TargetValue |
|---|---|---|---|
| CHC | 0 | 674 | **0.00** (placeholder — no real second series) |
| CHC | 1 | 1,350 | 105,737,194.00 |
| CHC_SALES | 1 | 810 | 79,302,895.50 |
| CHC_SALES | 0 | — | *(no such rows exist at all)* |

These numbers match, to the digit, the figures already documented in the live `refresh_sales.py` for the Jan–May period — this file is consistent with what's already in production, not a new or conflicting number.

**`Q1_Sales.xlsx` / `Q2_Sales.xlsx`** — **correction to my first pass:** these are NOT 51-column files with their own targets. Both are single-sheet `SalesPerDistributor`, **45 columns, actuals only** — no `TargetQuantity`/`TargetValue`/`TargetIndex` columns at all. Q1 starts at date 202601 (Jan), Q2 starts at 202604 (Apr) — clean calendar-quarter actuals exports. This is the *exact same shape* as `june.xlsx` (also `SalesPerDistributor`, actuals-only) — not a coincidence; it's the same export process.

**`TGT.xlsx`** — **correction to my first pass:** I called this "orphaned" before actually opening it. It isn't. Single sheet `SalesPositionTargets`, 22,407 rows, 27 columns (`TargetQuantity`, `TargetValue`, `TargetIndex`, position-level, no per-sale grain) — **the exact same sheet name and shape as `June TGT 2026.xlsx`**. This is the Jan–May equivalent of the June target file: the actuals (Q1_Sales/Q2_Sales) and the targets (TGT.xlsx) are two separate files by design, exactly mirroring the `june.xlsx` + `June TGT 2026.xlsx` pattern the pipeline already runs today. This is a *cleaner* mapping than I first proposed — no new schema to reconcile, just the existing actuals-file + targets-file pairing, extended backward to Q1/Q2.

**Shortage data — I did not find any**, in any of these four files. No "Shortage" sheet, no shortage-flag column, nothing SKU-level about supply status anywhere in `ZETA SALES_2026\`. If a shortage list already exists somewhere (a different file, a different folder, something Supply Chain maintains outside this project), point me at it — otherwise §4.3's empty template is still the plan.

### 2.3 The scenario architecture already in production

Built 2026-08-04, live in `refresh_sales.py` (schema v3), `js/semantic-model.js`, `js/auth.js`, `js/sales.js`, `js/executive.js`:

| Concept | Current state |
|---|---|
| Scenario names | `official` (TargetIndex=1) and `working` (TargetIndex=0) — **"Buffer" was considered and explicitly rejected** in the code comments |
| Resolver | One function, `SEMANTIC.resolveScenario(line, requestedScenario)` — every card/table/export reads through it, nothing re-implements scenario logic locally |
| Coverage detection | Computed from real aggregated data per ETL run (`scenario_coverage` in cache meta) — not a hardcoded line list, so a line's scenario coverage can change without a code edit |
| CHC / CHC_SALES | Classified **Working-only** at ingest — their only real target series (TargetIndex=1) is deliberately relabeled "Working," not "Official," per your own 2026-08-04 instruction |
| Designed for a 3rd scenario? | **Yes, explicitly** — the original architecture proposal (§9) scoped a 3rd/4th scenario as a registry addition with zero resolver changes. This is the right moment to use that design. |

This means: **the hard architectural work for what you're asking is already done and running.** This proposal is about (a) reconciling two decisions that today's message appears to reopen, (b) re-pointing the raw inputs, and (c) adding one new scenario using the pattern already proven in production — not building a new system.

---

## 3. Orient — Reconciling the Two Conflicts

### 3.1 "Original / Buffer" vs. "Official / Working"

| | 2026-08-04 decision (shipped) | Today's message |
|---|---|---|
| TargetIndex=1 | "Official Target" | "Original" |
| TargetIndex=0 | "Working Target" — *because* the data showed it running 100%–174% of Official (a stretch target), and "Buffer" implies the opposite (a conservative floor) | "Buffer" |

If "Original" and "Official" are just your own updated wording for the same TargetIndex=1 concept, that's a pure rename — trivial, no data impact, I'll wire the new labels through. If "Buffer" is meant literally (a floor below Official), that's a **different concept than what TargetIndex=0 actually contains** in this dataset, and shipping it under that name risks a Line Manager or BU Manager reading "Buffer" as "the safe minimum" when the data says the opposite. I'd rather ask than guess on a label that reaches field managers.

### 3.2 CHC's target classification

Your message: *"for chc it is only original target."* The data (§2.2, freshly re-verified) says CHC and CHC_SALES each have exactly **one** real target series — TargetIndex=1. That much is consistent with what you're saying. What's *not* yet reconciled is the **label** that series carries: the shipped system deliberately calls it "Working" for CHC (not "Official"), specifically so that a viewer requesting "Official" for CHC gets a clear fallback notice instead of a silently wrong number. If "original target" means "CHC only has one series" — no change needed, the system already models that correctly, just under the "Working" name. If it means "that one series should be labeled/treated as Official for CHC" — that's a real reversal of a decision you gave explicitly three weeks ago, and I want that confirmed in writing before I touch it, the same way the original decision was.

**I'm not resolving either of these myself. Both go in §6 as the first action item.**

---

## 4. Decide — Recommended Architecture

### 4.1 One canonical source folder

Keep `ZETA SALES_2026\` as the single folder for every sales/target input — nothing sales-related lives at the project root going forward. Root currently holds `TOTAL_SALES_2026.xlsx` and `TOTAL_SALES_2026_OLD.xlsx`, which is itself part of the confusion (two different "current" files in two different places).

| Keep (canonical) | Role | Update cadence |
|---|---|---|
| `Q1_Sales.xlsx`, `Q2_Sales.xlsx`, `Q3_Sales.xlsx`, `Q4_Sales.xlsx`... | Period-sliced **actuals only** (45-col `SalesPerDistributor`), one file per quarter, never overwritten once closed | Add one new file per quarter — never re-merge into a growing master file |
| `TGT.xlsx` → rename `Targets_2026_Q1-Q2.xlsx` (or split per quarter to match the actuals files) | **Targets for Q1/Q2** (27-col `SalesPositionTargets`, both TargetIndex 0/1) — pairs with the actuals files above exactly like `June TGT 2026.xlsx` pairs with `june.xlsx` today | New quarter's target export added alongside its actuals file |
| `CHC_BU_YTD_PERFROMANCE.xlsx` | CHC/CHC_SALES actuals + targets, self-contained, YTD rollup | Re-exported/overwritten in place each month (it's inherently cumulative, not period-sliced) |
| `Shortage_Target_Override.xlsx` *(new — see 4.3)* | SKU × Month shortage list | Hand-edited whenever Supply Chain flags a new shortage |

This is a direct extension of the pattern the ETL already runs today (`main` + `june` actuals sources, paired with `June TGT 2026.xlsx` as the June-target authority) — Q1/Q2 just become two more actuals sources, paired with `TGT.xlsx` as their target authority the same way. No new pairing logic to invent.

| Retire (archive, don't delete yet) | Why |
|---|---|
| `TOTAL_SALES_2026.xlsx` (both copies), `TOTAL_SALES_2026_OLD.xlsx` | Replaced by `Q1_Sales.xlsx` + `Q2_Sales.xlsx` + `TGT.xlsx` directly — no more hand-merging |
| `june.xlsx`, `June TGT 2026.xlsx` | June becomes just another actuals+targets quarter pair once folded into the same pattern |

Move retired files to a `ZETA SALES_2026\_archive\` subfolder rather than deleting outright, until a full parallel-run (§4.4) proves the new source set reproduces the same audited totals. This is the same caution the June re-export episode already taught this project.

### 4.2 Rename to your stated naming (cosmetic, low-risk)

If you'd like the files themselves to read `Zeta_Sales_Raw_Q1.xlsx` / `Zeta_Sales_Raw_Q2.xlsx` rather than `Q1_Sales.xlsx` / `Q2_Sales.xlsx`, that's a simple rename plus a one-line path update in `refresh_sales.py` — no data risk. Confirm if you want the rename or if the current names are fine to keep as-is.

### 4.3 Shortage as a third scenario

Shortage isn't a parallel raw column the way Official/Working are (there's no `TargetIndex=2` waiting in the source files) — it's a **business rule applied on top of whichever base scenario is active**: for any Line + Brand/SKU + Month flagged as a shortage period, that period's target is overridden to equal that period's actual sales, per your own framing ("target at this period will be its target").

Proposed mechanics, reusing a pattern already proven in this codebase (June's target-authority override):

1. New small file, `Shortage_Target_Override.xlsx` — columns: `Line`, `Brand/SKU`, `Month`, `Shortage (Y/N)`, `Notes`. Low row count (dozens/hundreds), safe to hand-maintain directly — I did not find an existing SKU/shortage master list anywhere in the project to build from (`sales_subtypes.xlsx` is a customer-channel classification, not a product list), so this file starts empty and you populate it.
2. ETL reads this file after the normal aggregation pass. For every Line/Brand/Month it lists as shortage, the resolved target (whichever of Original/Working was requested) is replaced with that period's actual sales figure.
3. Register `shortage` as a third entry in `TARGET_SCENARIOS`, alongside `official`/`working` — the resolver, every card, every export pick it up with **zero code changes elsewhere**, exactly as §9 of the original architecture proposal designed for.
4. Extend `scenario_coverage` (already computed automatically per ETL run) with a third boolean per line — no hardcoded line list to maintain.

### 4.4 Validation before cutover

Before the live `SOURCES` list is repointed, run the new source set through the pipeline in parallel and reconcile totals against the current production cache for every closed month (Jan–June) — the same rigor the original scenario feature used (a 19-check automated harness before it shipped). Cutover only happens once the two totals match.

---

## 5. Act — Sequenced Build Plan (not started)

| # | Step | Gated on |
|---|---|---|
| 0 | You confirm the two open decisions (§3) + tell me where shortage data actually lives (I found none in `ZETA SALES_2026\`) | — |
| 1 | ~~Verify Q1/Q2 schema~~ — **done**, see §2.2: 45-col actuals-only, paired with `TGT.xlsx` for targets | — |
| 2 | Build `Shortage_Target_Override.xlsx` template (empty, ready for you to fill, or wire up your existing source once you point me at it) | — |
| 3 | Add `shortage` to `TARGET_SCENARIOS` + extend `scenario_coverage` | Step 0 |
| 4 | Re-point `SOURCES` in `refresh_sales.py` at `Q1_Sales.xlsx`+`TGT.xlsx`, `Q2_Sales.xlsx`+`TGT.xlsx`, `CHC_BU_YTD_PERFROMANCE.xlsx` | Step 0 |
| 5 | Parallel-run validation against current audited totals | Step 4 |
| 6 | Archive (not delete) the retired files | Step 5 passes |
| 7 | Update project memory with the new canonical source convention | Step 6 |

Nothing in this list runs until you've replied to §3 and §6.

---

## 6. Key Risks

| Risk | Impact | Mitigation |
|---|---|---|
| "Buffer" label reintroduced against the data's own shape | Field managers read a stretch target as a safety floor — trust/compliance issue | Confirm §3.1 before any UI label changes |
| CHC scenario reversed without reconciling the 2026-08-04 decision | CHC/CHC_SALES attainment misreported in board-level views | Confirm §3.2 explicitly, in writing, before touching `WORKING_ONLY_LINES` |
| Cutover reads the wrong `TOTAL_SALES_2026.xlsx` copy mid-transition | Numbers disagree with what was live seconds earlier | Archive old files only after §4.4 validation passes, not before |
| Shortage override becomes an uncontrolled "second spreadsheet of truth" | Numbers no longer traceable to a single decision-maker | Keep it small, named, and owned by one person (you / Supply Chain), same discipline as `June TGT 2026.xlsx` |
| No shortage data source found yet — building it from nothing risks missing real, already-known shortages | Shortage scenario launches incomplete/wrong on day one | Confirm with you whether a shortage list already exists elsewhere before I build an empty template (§0 in §5) |

## 7. Leverage Opportunities

- Reuses a resolver architecture already live and tested in production — near-zero incremental engineering risk for the third scenario, versus building fresh.
- Removes ~1.28 GB of duplicated/stale files and the "which copy is real" ambiguity that caused exactly this kind of confusion once already (the June double-count bug in §2.3's history).
- Quarterly-file convention removes the recurring bottleneck of hand-merging a giant workbook — the exact failure mode the current code comments already warn against.

## 8. Automation Opportunities

- Onboarding a new quarter becomes a one-line addition to `SOURCES`, not a manual re-merge — the same low-risk pattern already used when June was added as its own source.
- A shortage-specific version of `check_working_only_lines()` can warn automatically if a shortage-flagged SKU/month has no matching actual-sales row — catching a data-entry mistake before it silently produces a wrong 100%.
- `scenario_coverage` already self-detects which lines have which scenarios from real data — extending it to three scenarios requires no manual line-list maintenance going forward, for this or any future scenario.

## 9. Recommended Next Actions

1. **You confirm, in writing:** (a) keep "Official/Working" as the shipped labels, or intentionally rename to "Original/Buffer" knowing Buffer means the opposite of a floor here; (b) CHC/CHC_SALES stay Working-only as shipped, or should genuinely flip to Official-only; (c) where does shortage data actually come from — I opened every file in `ZETA SALES_2026\` and found none.
2. Once (c) is answered, I either wire up your existing shortage source or build the empty `Shortage_Target_Override.xlsx` template for your review — still no cutover, no ETL changes yet.
3. Once 1–2 are done, I run the parallel validation build (Q1_Sales+TGT, Q2_Sales+TGT, CHC_BU_YTD_PERFROMANCE against the current audited totals).
4. Only after validation passes do we repoint the live `SOURCES` list and archive the retired files.
