# Dual Target Scenario — Enterprise Architecture Proposal
**Zeta Commercial Excellence Dashboard | Prepared for Ahmed | 2026-08-03**
**Status: Proposal for decision. No implementation started.**

---

## 1. Executive Summary

The dashboard currently reads one target per line (`TargetIndex = 1`, "Official"). The raw ETL sources (`TOTAL_SALES_2026.xlsx`, `june.xlsx`) already carry a second target series (`TargetIndex = 0`) for 14 of 16 lines. CHC and CHC_SALES do not have a real second series — confirmed by direct data audit, not assumption (see §3).

The ask is to expose this second series across the platform without forking the codebase, without leaking the technical field name to users, and with role-appropriate visibility.

**Recommendation (detailed in §8): single codebase, one centralized target resolver, a role-gated scenario selector (not a global toggle, not a silent per-role lock) — Option C in the comparison matrix.** Estimated build: 3 files touched (ETL, semantic model, one new resolver module), zero new pages, zero duplicated cards.

**Before any build starts, two business decisions are needed from Ahmed — flagged throughout as [DECISION NEEDED] — because the data itself doesn't resolve them and I won't guess on your behalf.**

---

## 2. Current State (As-Is)

| Layer | Today |
|---|---|
| ETL (`refresh_sales.py`) | Discards every row where `TargetIndex != 1`. The second series is silently dropped at ingestion — it never reaches the cache. |
| Cache (`sales.json`) | Flat row array, one target value per line/month. No scenario dimension exists. |
| Client (`sales.js`, `executive.js`) | Every card, table, popup, and export reads `targetValue` directly off the aggregated row. ~9 separate read sites, no central function. |
| Access control (`auth.js`) | `AUTH.getScope()` — BU/Line restriction only. No concept of "what target scenario can this role see." |
| Naming | Internal only — "TargetIndex" never reaches the UI today because only one value exists. |

This is a **clean slate for the scenario dimension** — nothing to migrate, only ETL logic to stop discarding data.

---

## 3. Data Reality Check (why this isn't a simple toggle)

I audited both scenarios across the full dataset (996,720 + 197,057 rows) before writing this proposal. Two findings materially shape the design:

**Finding A — CHC and CHC_SALES have no real second scenario.** The annual file's `TargetIndex=0` rows for CHC sum to zero (674 placeholder rows); CHC_SALES has no `TargetIndex=0` rows at all. The only Index-0 value that exists for either line comes from June alone, and it's nearly identical to June's own Index-1 value (within ~0.06%). Treat CHC/CHC_SALES as **single-scenario lines**, not as "buffer = official" by coincidence.

**Finding B — "Buffer" is not a floor.** For the 14 lines that do have both series, Index-0 is **equal to or higher** than Index-1 in every single case (100%–174% of Official; four lines exactly 100%). A "buffer" target, by normal usage, is a conservative floor below the official number. This dataset's Index-0 behaves like a stretch/revised-upward target instead.

**[DECISION NEEDED #1]:** Confirm with the source-system owner (whoever populates `TargetIndex` in the sales files) what Index-0 actually represents operationally, before we lock the business label. I'm not building a UI element called "Buffer Target" if the data says the opposite of "buffer" — see §4.

---

## 4. Semantic Model — Hiding `TargetIndex` from Users

Introduce **Target Scenario** as a first-class semantic dimension, the same pattern already used for BU derivation in `semantic-model.js` (`lineToBU`, `classifyLine`).

| Technical field | Proposed business label | Definition shown to users |
|---|---|---|
| `TargetIndex = 1` | **Official Target** | Board-approved target; source of truth for attainment reporting |
| `TargetIndex = 0` | **Working Target** *(not "Buffer")* | Field-operating scenario target — magnitude varies by line, confirm meaning before final naming (Decision #1) |
| *(future) `TargetIndex = 2, 3...`* | Forecast / Stretch / Revised Budget | Added without touching resolver logic — see §7 |

A single registry object holds this mapping (`index`, `label`, `isDefault`, `description`). Every other layer — resolver, UI labels, exports — reads from this registry, never from a hardcoded "1"/"0". This is the mechanism that keeps `TargetIndex` out of the UI permanently, not just today.

---

## 5. Centralized Target Resolver — the Core Architectural Decision

**Problem this solves:** the reverted first attempt at this feature broke because target reads were scattered across ~9 call sites (cards, tables, popups, exports, narrative text) with no single gate. A schema mismatch in one site produced NaN that propagated into a KPI card. The fix is architectural, not a bug fix: **one function, one call site pattern.**

```
                         ┌─────────────────────────────┐
                         │   ETL (refresh_sales.py)     │
                         │  keeps BOTH TargetIndex rows  │
                         │  tags each target row with    │
                         │  scenario = official|working  │
                         └──────────────┬───────────────┘
                                        ▼
                         ┌─────────────────────────────┐
                         │   cache/sales.json (v3)       │
                         │  actual rows: unchanged        │
                         │  target rows: + scenario tag   │
                         └──────────────┬───────────────┘
                                        ▼
                         ┌─────────────────────────────┐
                         │  semantic-model.js            │
                         │  TARGET_SCENARIOS registry     │
                         │  CHC_SINGLE_SCENARIO_LINES     │
                         └──────────────┬───────────────┘
                                        ▼
                         ┌─────────────────────────────┐
                         │  resolveTarget(line, scenario, │
                         │       aggregates)  ◄── ONE FN  │
                         │  - CHC/CHC_SALES → force        │
                         │    Official + isFallback flag   │
                         │  - missing/NaN → fallback +     │
                         │    isFallback flag              │
                         │  - else → requested value        │
                         └──────────────┬───────────────┘
                                        ▼
        ┌───────────────┬───────────────┬───────────────┬───────────────┐
        ▼               ▼               ▼               ▼               ▼
   Sales cards   Executive cards   Line Perf table   Popups/modals    CSV export
   (all read through resolveTarget — zero duplicated target logic)
```

Every consumer passes through this one function. Adding a new consumer (a new card, a new export) means calling the existing function — never re-implementing scenario logic locally. This is the guarantee that "dynamic across all cards and popups" (your original ask) holds by construction, not by remembering to wire up nine places correctly.

---

## 6. Role-Based Behavior — Reconciling Two Different Asks

Your two messages this session actually asked for two different models: "Line Manager sees Working, hasn't seen Official" (a locked, role-based default) versus "SFE/CEO/BEX/Admin toggle between both" (an executive comparison tool). Both are legitimate, for different roles — they aren't in conflict once separated by role, but the exact default per role is a business call, not an engineering one.

| Role | Sees selector? | Default scenario | Can view Official? | Can view Working? |
|---|---|---|---|---|
| CEO | Yes | Official | Yes | Yes |
| BEX | Yes | Official | Yes | Yes |
| Admin | Yes | Official | Yes | Yes |
| SFE Manager | Yes | Official | Yes | Yes |
| VP | Yes | Official | Yes | Yes |
| BU Manager | **[DECISION NEEDED #2]** | **[DECISION NEEDED #2]** | ? | ? |
| Line Manager | No (locked) | **[DECISION NEEDED #2]** | Per decision | Per decision |
| Marketing Consultant | No (locked) | Official | Yes | No |

**[DECISION NEEDED #2]:** Your very first message said Line Managers should see Working only, "and hasn't see target one" (implying Official is hidden from them). Confirm this is still the intent, and confirm whether BU Manager follows the same rule or gets the executive toggle. I'm not defaulting this myself — it directly controls what a field manager is told their number is.

Mechanically, this is a two-field addition to each user's role config (already sourced from `Zeta_Dashboard_User_Config.xlsx` via `refresh_iqvia.py`): `canToggleScenario` (bool) and `defaultScenario` (official/working). No new permission system — it extends the existing role table the same way `bu`/`lines` restrictions already work.

---

## 7. UX Option Comparison — Automatic Resolution vs. Selector

| | **A — Fully Automatic (role-locked, no UI)** | **B — Global Toggle (visible to all)** | **C — Role-Gated Selector (recommended)** |
|---|---|---|---|
| How it works | Config decides scenario per role; no user action possible | One switch in the command bar, everyone sees it, controls every card | Selector renders only for roles with `canToggleScenario=true`; everyone else locked to their default |
| Matches "Line Manager shouldn't see Official" | Yes | **No — breaks it**, anyone can flip it | Yes |
| Matches "CEO/BEX/Admin toggle and compare" | **No — no comparison possible** | Yes | Yes |
| `TargetIndex` fully hidden from UI | Yes | Yes | Yes |
| Risk of accidental exposure to restricted roles | None | High | None |
| New UI surface | Zero | One global control, always visible | One control, conditionally rendered |
| Future scenario count (3, 4, 5...) | Config change only | Selector becomes a crowded dropdown for everyone, including roles that shouldn't see any of it | Selector grows only for roles that already have toggle rights |
| Build complexity | Lowest | Low | Low-medium (adds the permission check) |

**Recommendation: Option C.** It's the only option that satisfies both of your stated requirements simultaneously instead of picking one over the other.

---

## 8. Handling the CHC Exception

CHC and CHC_SALES don't have a real Working Target (§3, Finding A). Two ways to handle this in the UI when a toggle-capable user selects "Working" while viewing CHC:

| Approach | Description | Recommendation |
|---|---|---|
| **Silent resolver fallback (recommended)** | `resolveTarget()` detects CHC/CHC_SALES, returns the Official value regardless of what was requested, and sets `isFallback: true`. UI shows the existing small badge pattern already used elsewhere in the app (e.g. the ETL-staleness banner on Customer Health) — "Official Target shown — no Working Target defined for this line." | Consistent with existing UX language, zero new component, no jarring UI state change when a user switches lines while the selector is set to Working. |
| Hide the selector when CHC is the active line filter | Selector control disappears/reappears based on the line filter | Not recommended — a control that appears and disappears based on filter state is confusing and inconsistent with how every other filter on this platform behaves (filters narrow data, they don't hide other controls). |

---

## 9. Scalability for Future Scenarios (Forecast, Stretch, Revised Budget)

Because §4's registry is data-driven rather than hardcoded to two values, adding a third scenario later is a 3-step, resolver-untouched change:

1. ETL tags new rows with the new `TargetIndex` value under the same row schema (no new columns needed if the "scenario tag on target rows" pattern from §5 is used).
2. Add one entry to `TARGET_SCENARIOS` (index, label, isDefault).
3. Extend the role config's allowed-scenario list where relevant.

`resolveTarget()`, every card, every table, and the export logic require **zero code changes** — this is the direct payoff of centralizing in §5 rather than the alternative of writing per-scenario `if` branches inside each card (which is what the first, reverted attempt did, and why it broke).

---

## 10. Alternatives Considered (including the one you originally proposed)

| Option | Description | Verdict |
|---|---|---|
| **Fork the dashboard** (your original question) | Separate copy of the codebase running against `TargetIndex=0` | **Rejected.** Every future fix (bug, new KPI, design change) has to be applied twice or drifts silently — this is the same anti-pattern already caught once this project (the `.gitignore`/`push_to_github.bat` regression came from exactly this kind of duplicated-config drift). |
| **Global toggle** | Single visible switch for everyone | Rejected — breaks role-based access intent (§7, Option B). |
| **Per-role silent lock, no toggle anywhere** | Each role hardcoded to one scenario, nobody can switch | Rejected — doesn't satisfy the explicit CEO/BEX/Admin/SFE comparison requirement. |
| **Role-gated selector + centralized resolver (recommended)** | §5 + §7 Option C | **Selected.** |

---

## 11. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Working Target data is inconsistently populated (CHC null, others inverted-from-expected) | Misleading numbers shown to Line Managers if shipped without validation | Resolve Decision #1 with the source-system owner before go-live; do not ship the "Working Target" label until its meaning is confirmed |
| Schema/version mismatch reintroduces the NaN bug already hit once | KPI corruption visible to executives | Bump `schemaVersion` (v2→v3), add explicit null/NaN guards in `decompressCache()`, gate the Sales tab's existing "Cache Update Pending" state on the new version exactly as it already does today |
| Scope creep back toward a second dashboard | Doubles maintenance cost, defeats the entire point of this proposal | Enforce single-resolver architecture (§5) as the hard rule for this feature; no card gets its own scenario logic |
| Wrong default scenario shown to a restricted role | Compliance/trust issue — a Line Manager sees a number they weren't meant to see, or is measured against the wrong figure informally | Lock Decision #2 explicitly in writing before build; the role config table makes this a one-line change if it needs correcting later, not a redeploy |
| Commission/incentive ambiguity | If Sales Ops calculates commission off Official but the dashboard defaults some roles to Working, numbers won't reconcile | Label Official Target as "commission source of truth" in the UI if that's accurate — confirm as part of Decision #1 |

---

## 12. Recommended Build Sequence (once decisions are locked — not started yet)

1. ETL: stop discarding `TargetIndex=0` rows; tag target rows with scenario; bump schema version.
2. `semantic-model.js`: add `TARGET_SCENARIOS` registry + `CHC_SINGLE_SCENARIO_LINES` constant.
3. New `resolveTarget()` function (single module, single owner) with the CHC fallback and NaN/missing guards from §5 and §8.
4. `auth.js`: extend role config with `canToggleScenario` + `defaultScenario`.
5. One conditional UI control in the existing command bar (renders only when `canToggleScenario=true`).
6. Rewire the ~9 existing read sites to call `resolveTarget()` instead of reading `targetValue` directly — no new cards, no new pages.
7. Validate against real cache data before touching production, the same way every other fix this project has been validated.

---

## 13. Open Decisions Before Any Build Starts

1. **What does `TargetIndex=0` actually represent, and what should it be called?** ("Working Target" is a neutral placeholder — "Buffer" is contradicted by the data in §3.)
2. **Exact default/toggle rights per role** — specifically Line Manager and BU Manager, where your two messages this session gave different signals.

I'd rather get these two answers than build against an assumption and revert a second time.
