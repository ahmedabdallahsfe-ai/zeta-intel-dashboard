# Zeta Commercial Excellence Platform — Unified Enterprise Roadmap

Single source of truth for how the platform gets from "several dashboards in one repo" to
a single Enterprise Pharmaceutical Commercial Intelligence Platform. Each phase is scoped to
ship independently, without breaking the phases before it. Backward compatibility and existing
business logic/KPI calculations are non-negotiable at every phase.

## Architecture Principles (2026-07-26, governs all future phases)

- **One platform, not many dashboards.** Every new feature must strengthen a single unified
  architecture — a workspace inside the platform, never a bolted-on separate app.
- **Component reuse over duplication.** Whenever two workspaces implement similar
  functionality, consolidate into a shared component instead of copying code. No new
  duplicated CSS/JS across modules.
- **Quality standard.** Every page must answer a business question and support an executive
  decision. If a visualization, KPI, or component doesn't improve decision-making, it doesn't
  belong in the product.
- **Preserve existing functionality.** No phase may change KPI calculations or business logic
  as a side effect of a UI/architecture refactor. Refactors are additive/migrational, validated
  before and after against the prior output.

## Target workspace list

| Workspace | Status |
|---|---|
| Executive Command Center (home) | **Live — default landing page (2026-07-26)** |
| Operational and Execution (Coverage & Frequency) | Live |
| Zeta Organogram (Sales Force Effectiveness) | Live |
| Sales Performance (Commercial Performance / Sales Analytics) | Live (hierarchy-corrected 2026-07-26) |
| Market Intelligence (IQVIA) | Live (integrated 2026-07-26) |
| Customer Analytics | Sub-view inside Sales today — promote in Phase 6 |
| Territory Analytics | Sub-view inside Sales today — promote in Phase 6 |
| Distributor Analytics | Sub-view inside Sales today — promote in Phase 6 |
| Product Intelligence | Sub-view inside Sales today — promote in Phase 6 |
| AI Executive Analyst | Per-module narratives exist today (Sales' Executive tab) — platform-wide cross-module version is its own initiative, see below |

## Phasing

| Phase | Scope | Status |
|---|---|---|
| 0 | Coverage + Organogram tabs on the shared shell | Done (pre-existing) |
| 1 | Sales Performance: fix hierarchy naming (BUHead→NSM→RM→DM→Rep) end-to-end across ETL/cache/front-end, validate against organogram.json, wire into nav | **Done 2026-07-26** |
| 2 | Market Intelligence (IQVIA): resolve auto-bootstrap and CSS collision technical debt, wire into nav on the shared shell | **Done 2026-07-26** |
| 3 | **Shared design system + component library.** Establish one reusable set — design tokens, typography, color system, cards, tables, charts, filter controls, navigation, animation system, loading states, empty states, export framework — before any further workspace is added. | **Foundation built and validated 2026-07-26** — additive only, not yet consumed by any workspace. Migration (Coverage → Sales → SFE → IQVIA, one at a time with regression testing) is the next step. |
| 4 | **Unified enterprise semantic layer.** Full scope (Date, Product, Brand, Territory, Region, Brick, Customer, Distributor) — **Not started.** Business Unit dimension specifically — **Phase-4-lite done 2026-07-26**: `js/semantic-model.js` (Line→BU crosswalk, validated against all 4 caches' real line values) plus a standardized `getBusinessSummary()` interface on Sales/Coverage/SFE/IQVIA, scoped narrowly to unblock Phase 5 rather than building the full model upfront. |
| 5 | **Executive Command Center.** New home workspace synthesizing Sales, Coverage, SFE, IQVIA into one CEO cockpit. **Live 2026-07-26**: methodology validated via the CHC pilot Management Decision Pack (`CHC_Pilot_Executive_Business_Review.md`) and the reusable `js/business-review-engine.js` (8-dimension Health Index + 6-dimension cross-BU ranking + 12-dimension Investment Consideration Matrix, all BU-agnostic). Full methodology spec: `BUSINESS_REVIEW_FRAMEWORK.md`. `js/executive.js` is now wired into `dashboard.html`/`js/app.js` as the platform's default landing page (see "What changed today (Phase 5 detail)" below) — landing page + per-BU drill-down review both live against real cache data for all 4 BUs. Remaining: replace the rule-based landing-page narrative with real analyst-depth authoring for Cluster/DIAB/GIT (CHC alone has the hand-authored Management Decision Pack today) — tracked as Phase 5a. |
| 5a | **AI Executive Analyst.** Platform-wide cross-module reasoning engine that auto-writes the narrative layer (Executive Verdict, Root Cause, Decision Points) currently assembled by analyst/LLM judgment on top of the Phase 5 scoring engine — e.g. "sales increased while market share declined," "coverage improved but productivity decreased." Depends on the full Phase 4 semantic layer to correlate beyond Business Unit (territory, product, customer). Not started. |
| 5b | **Executive Decision Graph** (added 2026-07-26, per Executive Committee direction). A visual rendering layer connecting **cause → effect → recommendation → expected impact → KPI to monitor** as one traceable chain, instead of four separately-read sections (Root Cause, Cause-and-Effect, Recommended Actions, Action Tracker). Presentation-layer enhancement on top of Phase 5's existing analytical sections, not a new analytical method. Not started. |
| 6 | Promote Customer/Territory/Distributor/Product views from Sales sub-tabs into first-class workspaces sharing the full Phase 4 data model | Not started |
| 7 | Authentication hardening (IQVIA's client-side password hashes are crackable from the deployed page source) | **Deliberately deferred** — tracked as technical debt, not blocking platform work |

## What changed today (Phase 1 + Phase 2 detail)

**Sales Performance (Phase 1):**
- `refresh_sales.py`: corrected Emp1–Emp6 role mapping (Rep→DM→RM→NSM→BUHead→CM), CM now captured instead of discarded, cache stamped with `meta.schemaVersion`.
- `js/sales.js`: matching rename throughout (STATE keys, lookup keys, JS index constants, filter dropdown labels/IDs), added a schema-freshness gate so an unregenerated cache shows a pending-refresh placeholder instead of wrong data, fixed a sub-tab click-binding bug (`.sales-subtab` selector that matched nothing), fixed month-axis labels reading raw indices instead of Jan/Feb/etc.
- Validated hierarchy names against `cache/organogram.json` before trusting the new mapping.

**Market Intelligence (Phase 2):**
- `js/iqvia.js`: removed a top-level auto-run bootstrap that executed on every page load regardless of active tab (now consolidated into `IQVIADashboard.init()`, and fixed a real functional gap where a resumed session never actually loaded dashboard content); fixed an unguarded document-wide `keydown` listener that threw a `TypeError` on every keystroke on every other tab.
- `css/iqvia.css`: mechanically re-namespaced all 245 rules under `.iqvia-dashboard-wrap` (verified via a CSS-parser round-trip, zero parse errors, zero un-scoped selectors remaining) — the previous unscoped universal reset and `.badge`/`.collapsed` collisions would otherwise have altered spacing/styling on Coverage, Organogram, and Sales the moment the stylesheet was linked.
- Wired into `dashboard.html` nav + `js/app.js` tab-switch, matching the existing Sales/SFE pattern exactly.
- Verified in a sandboxed JS environment against the real cache: zero network calls or DOM access on script load, `init()`/`destroy()` cycle clean, keydown-on-another-tab no longer throws.

Known, not yet fixed: the IQVIA login system ships all user password hashes plus a static salt directly in the client bundle — anyone who loads the page can extract and offline-crack credentials. This is unchanged from the standalone dashboard's existing design; not touched this phase per explicit direction, tracked as Phase 7.

## What changed today (Phase 3 detail — Design System foundation)

Built as five new files, entirely additive, none linked into `dashboard.html` yet:

- `css/design-system.css` — tokens only (color, type scale, spacing, radius, shadow, transition, z-index). `#0F4C81` kept as primary (sourced from the existing sidebar brand text), but now exposed as `--color-primary` and consumed everywhere as a semantic token rather than a hardcoded hex, per the explicit instruction that the platform should not simply inherit IQVIA's implementation directly.
- `css/animations.css` — the platform Animation System: 8 keyframes, animate/stagger utility classes, a shimmer background for skeletons, full `prefers-reduced-motion` support.
- `css/layout.css` — structural grids/flex primitives (KPI row, 2/3/4-col grids, main+side layout), responsive at 1024px/640px.
- `css/components.css` — one canonical implementation each of the 13 required components (KPI Card, Executive Insight Card, Table, Chart Container, Filter Control, Button, Navigation, Empty State, Loading State, Export Control, Modal, Notifications, Tooltip), all under a `.ds-` prefix chosen to guarantee zero collision with the existing `.sc-*`/`.sfe-*`/`.iqvia-*` class families.
- `css/utilities.css` — a deliberately small helper set (truncation, visually-hidden, spacing overrides, thin scrollbar), not a full utility-framework clone.
- `js/components.js` — exposes `window.DS`, one builder function per component.

Also created: `design-system-preview.html` (loads only the 5 new stylesheets + components.js, renders every token and component with sample data — the independent validation surface the brief required before any workspace migration) and `DESIGN_SYSTEM.md` (full token reference, component API, usage examples, migration plan).

**Scope decision flagged for visibility:** the brief named four shared JS files — `components.js`, `ui.js`, `charts.js`, `filters.js`. The latter three already exist today as live files Coverage depends on in production. Rewriting them now would be migrating a workspace before the foundation is validated, which the brief said not to do. All new shared JS this phase lives in `components.js` only; reconciling the existing `ui.js`/`charts.js`/`filters.js` into the `DS` namespace is deferred to each file's turn in the per-workspace migration phase. Documented in `DESIGN_SYSTEM.md` §1.

**Validation performed:** all 5 CSS files parsed with zero errors via a tinycss2 round-trip; `components.js` passed `node --check`; confirmed via grep that none of the five new files are referenced in `dashboard.html` — the foundation is fully additive and does not touch any live workspace.

## Post-Phase-3 bug fix: IQVIA "STATE is not defined" / "loadData is not defined"

Reported after the Phase 2 wiring: opening the Market Intelligence tab threw `ReferenceError: loadData is not defined` and every tab click threw `ReferenceError: STATE is not defined` from `showSection`.

Root cause: `js/iqvia.js` was missing an entire ~280-line block — `STATE`, `flat`, `loadData()`, the column-index constants, `getPeriodIndices`/`getPrevPeriodIndices`, the aggregation engine (`aggBy`, `buildFilter`, `dimFilter`, `aggByPeriod`, `aggTotalByPeriod`, `getRelationships`), the formatting helpers (`fmtLCV`, `fmtSU`, `fmtPct`, `fmtGrowth`, etc.), and the Chart.js factory wrappers (`lineChart`, `barChart`, `hBarChart`, `donutChart`, `scatterChart`). This block exists in the standalone `D:\2026\iqvia\iqvia_dashboard.html` (lines ~1490–1856) but was dropped during the earlier "Option B migration" that extracted the standalone dashboard's inline `<script>` logic into this shared module — a pre-existing extraction bug, not something introduced by the Phase 2/3 work (confirmed via `git diff --ignore-all-space` against the committed HEAD, which showed only the two previously-documented Phase 2 fixes).

Fix: restored the missing block verbatim from the standalone source, inserted at its original position (between the cache-variable assignments and the "EXECUTIVE COMMAND CENTER" section). No logic was changed — this is a restoration, not a rewrite.

Verified via `node --check` (syntax) and a `vm`-based smoke test that loads the real `pako.min.js`, `chart.umd.min.js`, and `cache/iqvia.data.js`, then runs `loadData()` (decompresses all 3.47M cached rows) and every `showSection()` tab (`executive`, `corp-intel`, `zeta-cmd`, `zeta-market`, `zeta-comp`, `target-achievement`, `winners`, `bcg`, `forecast`, `guide`) — all render with zero errors.

Separately noted, not touched: a benign `"Unsafe attempt to load URL file://... from frame"` console warning also appeared in the reported log. No `<iframe>` exists anywhere in this codebase (`js/iqvia.js`, `dashboard.html`, `js/app.js`, `js/sales.js` all grep to zero); this is a known Chrome quirk when running any file:// page and is unrelated to the STATE/loadData bug.

## What changed today (Phase 5 detail — Executive Command Center goes live)

Following methodology validation (CHC pilot Management Decision Pack + the reusable
Business Review Engine), this phase moved from methodology to product per explicit
direction: "transition from methodology to product... the next phase is to make the
Executive Business Review a real, integrated part of the Commercial Excellence Platform."

**`js/executive.js`** (new, ~470 lines) — `window.ExecutiveDashboard.init()/.destroy()`.
Reads ONLY through `SalesDashboard.getBusinessSummary()`, `CoverageDashboard.getBusinessSummary()`,
`SFEDashboard.getBusinessSummary()`, `IQVIADashboard.getBusinessSummary()`, plus `SEMANTIC` and
`BUSINESS_REVIEW_ENGINE` — never touches any module's internal cache/state. Two views:
- **Landing page**: Portfolio Health KPI row, Refresh, Portfolio Verdict, Top Opportunities /
  Top Risks, Priority Actions table, clickable BU Health Overview grid, and a rule-based "AI
  Executive Summary" card that is explicit in its own UI about being a generic template today,
  not the hand-authored depth of the CHC document.
- **Per-BU drill-down review**: always-visible Executive Verdict + KPI row, then progressive-
  disclosure (`<details>`) sections for Evidence Dashboard, Business Health Assessment,
  Cross-BU Ranking Position, Risks & Opportunities, Priority Actions, and Methodology & Data
  Basis. CHC specifically links out to `CHC_Pilot_Executive_Business_Review.md`; the other
  three BUs show an honest "pending analyst authoring" note instead of fabricating equivalent
  depth.

**`js/coverage-interface.js`** (new) — Coverage's standardized `getBusinessSummary()`, added
so all four modules expose the identical contract (Coverage predates the `window.XDashboard`
convention and needed its own adapter rather than a rewrite).

**Wiring into the live shell** (`dashboard.html`, `js/app.js`, `js/executive.js`, `css/dashboard.css`):
- `dashboard.html`: added the 5 Design System CSS files (`design-system.css`, `animations.css`,
  `layout.css`, `components.css`, `utilities.css`) as `<link>` tags; added `js/components.js`
  (DS) and `js/semantic-model.js` early (both self-contained, no cache dependency);
  `js/coverage-interface.js` after `js/cache.js`; `js/business-review-engine.js` and
  `js/executive.js` immediately before `js/app.js`. Added "Executive Command Center" as the
  first, `active`-by-default sidebar nav item; Coverage's item lost its default `active` class.
- `js/app.js`: `currentTab` default changed from `"coverage"` to `"executive"`. The boot
  sequence's `buildLayout()` (Coverage's full section-tree) and the two unconditional
  `renderAll()` calls are now gated behind `currentTab === "coverage"` — Coverage's DOM is
  built and rendered on demand, the first time the user actually clicks that tab, not at every
  boot. `renderAll()`'s early-return guard was broadened from `currentTab === "sfe"` only to
  `currentTab !== "coverage"`, so no tab's filter-bar callback can write into Coverage's stale/
  detached `sections` references. `Filters.init()` still runs unconditionally at boot (it wires
  the persistent global filter bar, which lives outside `#app-root` and is never torn down) —
  required so filtering works correctly the moment the user later switches to Coverage.
  Added a symmetric `executive` branch to the sidebar click handler (destroy-on-leave,
  init-on-enter) alongside the existing sales/iqvia/sfe branches, and an `executive` case to
  `updateTopbarTitle()`.
- `js/executive.js`: `init()`/`destroy()` now toggle an `executive-mode` class on
  `document.body`, matching the existing `sfe-mode`/`sales-mode` convention.
- `css/dashboard.css`: extended the existing mode-based filter-bar-hiding rule to include
  `.executive-mode` (Executive Command Center owns `#app-root` itself and doesn't use the
  shared Coverage filter bar, same as SFE/Sales).

**Validated, not assumed:** `node --check` on both modified/new JS files; a jsdom-based
integration smoke test that loads the actual cache files, all module scripts, and `js/app.js`
itself into a simulated `dashboard.html` shell, fires `DOMContentLoaded`, and confirms in
order — (1) boot lands on Executive with zero Coverage DOM built, correct topbar title,
`executive-mode` set; (2) clicking Coverage tears down Executive, builds all 11 Coverage
sections, populates the KPI narrative; (3) clicking Sales and then Market Intelligence render
correctly; (4) clicking back to Executive re-inits cleanly; (5) clicking Coverage a second time
still works end-to-end (the regression check that matters most — Filters wiring survives a
full round trip away from and back to Coverage). All four BUs' health/ranking numbers in the
landing page and drill-down are computed live from the real caches, not mocked.

Not yet done (deliberately out of scope for this phase, tracked separately): replacing the
rule-based narrative for Cluster/DIAB/GIT with real analyst-authored Management Decision
Packs (Phase 5a groundwork), and the Executive Decision Graph visualization (Phase 5b).

## What changed today (V3 detail — 16-section schema goes live as cards/charts)

Per direction to bring the CHC V3 Management Decision Pack's structure into the live product
("V3 going live as V3 with modifications of being cards/charts"), the per-BU drill-down in
`js/executive.js` was rebuilt from its original 6 sections to the full 16-section schema —
rendered as DS cards/tables plus two new Chart.js visualizations, not a markdown link-out —
and made the **standard, reusable template for all 4 BUs**, not a CHC-only view.

**Content-slot architecture (the key design decision):** every section has a genuinely
data-driven, non-fabricated generic generator that runs identically for any BU (Executive
Summary, Root Cause, Cause-and-Effect Chain, Internal vs External Drivers, Investment
Consideration Matrix, Investment Scenarios, Opportunity Cost, Recommended Actions, Action
Tracker, Executive Outlook — all computed live from `js/business-review-engine.js` output).
A new file, **`js/business-review-content.js`**, exposes `window.BUSINESS_REVIEW_CONTENT` — an
optional per-BU override object. When a field is present, `js/executive.js` renders it verbatim
in place of the generic path; when absent, the generic generator runs. CHC's object is populated
verbatim from the analyst-authored V3 document; Cluster/DIAB/GIT are empty today and run
entirely on the generic path — every BU gets a fully populated review, never a "coming soon" gap.
This is deliberately the same shape Phase 5a (AI Executive Analyst) will need to auto-generate
later — the content-slot mechanism doesn't change, only who/what fills it.

**Two new charts** (both reuse the existing `Charts` module, no new charting library): a
horizontal bar chart of the 8 Health Index dimensions, and a horizontal bar chart of this BU's
relative rank position across the 6 cross-BU ranking dimensions (plotted as inverted rank so a
higher bar always means a better position, since the underlying metrics have incompatible units).

**Real bug caught during validation, fixed before shipping:** `js/charts.js` exports `Charts` as
a bare top-level `const`, not `window.Charts`/`global.Charts` like the other shared modules —
the first draft of the new chart-calling code referenced `global.Charts` (inside executive.js's
`(function(global){...})(window)` wrapper) and would have thrown `TypeError` in production the
first time a user opened any BU review. Fixed to reference `Charts` as a bare identifier, exactly
as `js/app.js` already does — bare top-level `const`/`let` across sibling `<script>` tags share one
global lexical scope in every browser; they are never `window` properties. Caught by an
integration smoke test, not by inspection.

**Second bug caught the same way:** the two charts initially rendered any dimension with missing
source data (e.g. Market Intelligence not authenticated, so IQVIA-dependent dimensions come back
`null`) as a `0` bar — which reads as "catastrophic score," not "not available," a direct
violation of the platform's standing "never fabricate, never bypass auth" rule. Fixed: both
charts now exclude missing dimensions entirely and print an explicit "Not charted (no data, not
a zero score): ..." note naming exactly what's missing and why.

**Validated:** `node --check` on both new/modified files; a jsdom integration test drilling into
all 4 BUs confirms 17 sections render for each (16 schema sections + the existing Cross-BU
Ranking Position section), both chart canvases exist with correct label/value data pulled from
the live registry, CHC shows the analyst-override note plus the original-document link, the
other 3 show the generic-path note with no link, and a repeated-switching test (6 drill-downs)
confirms chart instances are destroyed and recreated cleanly with no growth/leak. The full
platform boot → tab-switch → Executive → Coverage regression test (from the prior phase) was
re-run with the two new files added and still passes end-to-end.

## Post-V3 bug fix: in-page navigation resetting on tab switch, IQVIA defaulting to dark

Reported: navigating within a workspace (a filter, a section, a BU drill-down) then switching to
another tab and back silently reset that navigation; Market Intelligence also opened in dark mode.

Four real bugs found and fixed, all the same root pattern -- a workspace's `init()` forcing state
back to a hardcoded default instead of restoring what the user had:

- **`js/sfe.js`**: `init()` unconditionally called `this.resetFilters()` on every tab re-entry,
  wiping the cascading line/BU/NSM/ASM/DM filters and both search boxes. Removed -- the object
  literal already carries correct defaults for a genuine first load.
- **`js/iqvia.js` (section)**: `initApp()` (invoked by `loadData()`, which runs on every
  `IQVIADashboard.init()`) unconditionally called `showSection('executive')`. Fixed to
  `showSection(STATE.section || 'executive')` -- `STATE` is a module-level singleton that already
  survives destroy()/init(), so it just needed to be read instead of overwritten.
- **`js/iqvia.js` (theme, two parts)**: `STATE.darkMode` defaulted to `true`; separately,
  `IQVIADashboard.init()` rebuilds `container.innerHTML` from `IQVIA_APP_STRUCTURE` on every
  re-entry, which always starts from that template's hardcoded ☀-glyph/no-`data-theme` state --
  so even a manually-chosen theme silently reverted every tab switch. Fixed: default changed to
  `false` (light/"sun" is the platform default everywhere), and a new `applyTheme()` (factored out
  of `toggleTheme()`) re-syncs the fresh DOM to the current `STATE.darkMode` right after `init()`
  rebuilds the wrapper.
- **`js/executive.js`**: `destroy()` nulled `_ctx` and `init()` always rebuilt with
  `currentBU: null`, so drilling into any BU's review then switching tabs always dumped the user
  back on the landing page. Fixed: `destroy()` no longer clears `_ctx`; `init()` preserves
  `currentBU` across the rebuild.
- **`js/sales.js`**: `STATE.theme` default corrected from `"dark"` to `"light"` for consistency
  (currently unused/unwired -- no functional change, just correcting the stated default for
  whenever a toggle is added). Sales' own `subTab` navigation was already correct -- no bug there.

Validated via jsdom: SFE filters/search survive a full tab round-trip; IQVIA defaults to light,
a manually-toggled theme (including the visual `data-theme` attribute on the freshly-rebuilt DOM)
survives a round-trip, and a manually-navigated section survives a round-trip instead of reverting
to Executive Summary; Executive Command Center's open BU review survives a round-trip in both
directions (staying on a BU review, and staying on the landing page, whichever was active).

## Evidence Dashboard expansion: granular Coverage/RF cut + DM1/DM2 market intelligence

Requested: the Executive Business Review's "4. Evidence Dashboard" section is the platform's one
place every KPI is meant to trace to its source -- but it only ever showed BU-level headline
numbers (all titles, all statuses blended; one blended Market Share/EVI/Share Δ per BU). Extended
it with the two more granular cuts executives actually asked for, without touching the existing
headline table.

**Two new supplementary interfaces** (additive; `getBusinessSummary()` unchanged):
- `CoverageDashboard.getFilteredCoverageSummary()` -- Coverage %/Right-Frequency % scoped to
  Title="Medical Representative", Experience="Non-Probation", Status="Active", Type in {Contract,
  Doctor, Hospital} (Distributor/Pharmacy excluded), latest period. Reads raw rows via
  `CacheStore.getRecords()` (analytics.js's own row cache) since the pre-aggregated
  `teamComparison` getBusinessSummary() uses has no Title/Experience/Type cuts baked in. Formula
  mirrors `analytics.js`'s `accumulate()`/`pct()` exactly (isActive-scoped mean of Covered
  Doctors/Right Freq). Grouped to BU via `row.team` → `SEMANTIC.lineToBU()` -- NOT
  `row.businessUnit`, which is mislabeled in Coverage's own cache (holds BU Head person names,
  per semantic-model.js's own audit).
- `IQVIADashboard.getDM1DM2MarketIntel(bu)` -- per-product DM1/DM2 actual market share, target
  share + achievement % (same TARGETS_2026 source and formula as the Target Achievement page),
  EI Index/EVI, and Share Δ YoY (pts), for both MAT and YTD windows and both SU and Value bases at
  once. Every aggregation pass is scoped to `LOOKUPS.bus[flat[i+BUCI]] === bu`, which excludes
  "Other Markets" and "Non-Promoted" by construction (they're distinct literal values in the same
  field) -- no extra filtering needed. Same auth gate as `getBusinessSummary()`
  (`getValidSessionUser()`); returns `status:'auth_required'` with empty segments, never a
  fabricated number.

**Rendering**: `section4_evidenceDashboard()` in `js/executive.js` now appends, below the
unchanged headline table: a "Field-Force Segment Cut" table (segment Coverage %/RF % + rep count,
vs portfolio range), and two wide per-product tables ("DM1 (Primary Market Definition)" / "DM2
(Secondary Market Definition)") with Product, Market, Target Share, and MAT/YTD × SU/Value share,
achievement, EVI, and Share Δ YoY columns -- 18 data columns, horizontally scrollable
(`ds-table-wrap`'s existing overflow handling). A methodology footnote documents every formula and
the "Other Markets" exclusion inline.

**Validated:** jsdom test against the live cache confirms `getFilteredCoverageSummary()` returns
sensible, distinct percentages per BU (CHC 93.5%/65.2%, Cluster 95.1%/75.2%, DIAB 95.8%/80.5%, GIT
91.8%/67.0% coverage/RF) with plausible rep counts (15/173/157/185); `getDM1DM2MarketIntel()`
resolves the exact expected segment count per BU against TARGETS_2026 (CHC 5, Cluster 14, DIAB 4,
GIT 12) with no unresolved-lookup errors. A full `ExecutiveDashboard.init()` → click-into-BU →
back → click-into-next-BU round trip (all 4 BUs) renders successfully end-to-end with both new
sections present in the output HTML and no new errors (the one error surfaced,
`ReferenceError: Chart is not defined`, is the pre-existing Chart.js dependency for the unrelated
Cross-BU Ranking charts, not loaded in this headless test -- not a regression).

## Market Intelligence Detail — Total BU cards

Added a BU-level blended rollup, rendered as KPI cards, above the per-product DM1/DM2 tables
built in the prior phase -- so an executive gets one headline read (Blended Market Share,
Blended Target, Achievement %, EI Index, Share Δ YoY, all MAT, SU and Value shown together per
card) before drilling into individual products.

`js/iqvia.js`'s `getDM1DM2MarketIntel(bu)` now also returns `total: { dm1, dm2 }`. Same "Blended
Share" methodology already used elsewhere in this file for the interactive BU/Line views: Σ Zeta
[SU|Value] across this BU's unique DM1/DM2 markets ÷ Σ those markets' total size (each unique
market counted once, so a market shared by two products isn't double-counted). Weighted Target =
Σ(target × market size) ÷ Σ market size, weighted by the same basis being shown -- the SU-weighted
and Value-weighted blended targets can legitimately differ slightly. Only segments that resolve to
a real product+market in the current period are blended in; `productsIncluded`/`productsExcluded`
counts are surfaced so the scope is never silently narrower than it looks.

`js/executive.js`'s `section4b_dm1dm2Table()` renders these via a new `totalBUCards()` helper
(`ds-grid-kpi` + `DS.kpiCard`, the same card component used for the review's top KPI row), with an
inline scope note ("Blended across N of M products...") and a directional badge on
Achievement/EVI/Share Δ (on/above vs below target, outgrowing vs underperforming market, gaining
vs losing share).

**Validated:** jsdom re-render of all 4 BUs -- Cluster DM1 blends cleanly across 14 of 14 products
(5.3%/6.7% share vs 7.0%/7.2% target = ~76%/93% achievement, internally consistent); CHC correctly
shows "—" for Blended Target/Achievement (all 5 CHC TARGETS_2026 rows have `tgtDm1:null`, no
target defined yet) rather than a fabricated number, while EVI/Share Δ still compute normally
since those don't depend on a target. No new errors introduced; same pre-existing unrelated
Chart.js dependency noted in the prior phase.

## Evidence Dashboard V4: Evidence Score + storytelling (simplification)

Full rebuild per EXECUTIVE_COMMAND_CENTER_V4_PROPOSAL.md (delivered, confirmed with the platform
defaults). The two dense 18-column DM1/DM2 tables from the prior phase were making Evidence
Dashboard analyst-grade, not executive-grade -- V4 inverts that: one Evidence Score is always
visible, dense tables are demoted behind collapsed "Full Product Detail" toggles.

**New: `BUSINESS_REVIEW_ENGINE.computeEvidenceScore(bu, summaries, extras)`** (additive --
`computeHealthIndex()` untouched, still drives Sections 2/3) -- 6 components, each 0-100, weighted
into one Total Score: Sales Performance (25%), Brand Portfolio Health (20%, NEW -- % of targeted
products achieving >=60% of DM1 target share), Market Competitiveness (15%), Field Execution (15%,
NEW -- on-target/(on-target+missed+wasted) calls), Organization Readiness (15%, = 100-vacancy),
Growth Momentum (10%, EVI-based). Weights are documented as a business judgment call, not fitted.

**New Coverage interfaces** (`js/coverage-interface.js`): `getExecutionWorkloadSummary()` (Field
Execution % + Workload % vs a platform-wide Customers-per-Rep benchmark, flagged as provisional
absent an official SFE span-of-control target) and `getLineAndTerritoryBreakdown(bu)` (Lines via
existing `teamComparison`, Territories via one raw-row pass grouped by Area, top/bottom 3 shown
only above a 10-customer minimum sample size to avoid single-brick noise).

**Section 4 rebuilt** (`js/executive.js`): Evidence Score header (Total Score, band, portfolio
range, rank) -> 6 score cards -> 2 What/Why/Action story cards (weakest + strongest component
only, not all 6 -- decision-focused) -> Market Dynamics card -> Lines table + collapsed Territory
drill-down -> Field-Force Segment Cut -> the two DM1/DM2 tables, now collapsed by default.

**New: persistent BU selector** -- 4 tabs at the top of the review switch BU in-page without
returning to the Command Center landing page (`ctx.currentBU` swap + `renderReview()`, no new
data fetch needed beyond the per-BU IQVIA calls already made for the range comparison).

**Validated:** jsdom re-render of all 4 BUs -- Cluster's Brand Portfolio Health story correctly
names the exact underperforming products (COXORIZET, DOZOVA ALPHA AMYLA, DOZOVA FLEXETA,
DUXNORZET, NEXIROZOVA) cross-checked against their individually-confirmed sub-60% achievement
percentages from the prior phase; Total Score computes and ranks correctly (Cluster 77/100,
Strong, rank #3 of 4, range 67-92); in-page BU-switch test confirms clicking a tab swaps the
review from CHC to GIT with no landing-page round trip. No regressions to Sections 1-3 or 5-16
(computeHealthIndex untouched).

## Brand Portfolio Health re-sourced to Sales (Non-Tender, Value basis) + clickable brand list

Changed the data source for the Evidence Score's Brand Portfolio Health component from IQVIA
market-share achievement to the Sales module's own brand-level Value achievement, Non-Tender
transactions only, per request.

**New: `SalesDashboard.getBrandAchievement(bu)`** (`js/sales.js`) -- a fresh single-row pass over
Sales' raw rows (not the interactive tab's filtered `runAggregator()` state), scoped to one BU via
the existing Line->BU crosswalk, excluding any row with the Tender mask bit set. Confirmed
empirically before writing this: every row is either a real transaction row (Value>0, Target=0)
or a "mirror" target row (Value=0, Target>0), and mirror/target rows are never Tender-flagged (0
of 512,669 rows are both) -- so excluding Tender rows removes only real tender revenue, never
target data for the remaining brands. achievementPct = actual Value ÷ target Value × 100.

**Bonus fix, same file:** the interactive Sales tab's own `brandData` accumulator (used by Brand
Performance Ranking, Target Gap by Brand, at-risk/over-performing brand lists) was never
accumulating `tgtVal`/`tgtQty` -- every brand's `ach`/`tgt` on that page has been silently 0/0%
regardless of real performance. Fixed to match the same pattern already used by `lineData`/
`monthlyData` two lines above it.

**`business-review-engine.js`**: `computeEvidenceScore()`'s Brand Portfolio Health now reads
`extras.brandAchievement` (brands with `targetValue > 0`, % achieving `achievementPct >= 60`) --
same 60% threshold, same weight, new source. Market Competitiveness (still IQVIA DM1 achievement)
and Growth Momentum (still EVI) are unchanged.

**`executive.js`**: the Brand Portfolio Health KPI card is now clickable (`data-evidence-card`
wrapper + a post-render listener) and opens a modal (`DS.openModal`) listing every brand --
actual/target/achievement, weakest first, with a ✅/🔴 flag -- via a new `openBrandAchievementModal()`.
The weakest/strongest story generator's brandPortfolioHealth branch now names actual underperforming
Sales brands instead of IQVIA DM1 segments.

**Validated:** Cluster's Brand Portfolio Health moved from 50/100 (IQVIA-sourced, 7 of 14 products)
to 85/100 (Sales-sourced, 11 of 13 brands >=60%) -- both numbers independently confirmed against
raw data before and after the switch. Click-to-modal test confirms the modal opens with the
correct brand table (DOZOVA FLEXETA 25.9% flagged red, etc.), matching the standalone
`getBrandAchievement()` test output exactly. All 4 BUs re-render with no new errors.

## "Zeta Pharma — Total Portfolio" KPI cards (YTD, SU, DM1+DM2)

Added a 3-card block to Evidence Dashboard, per BU, right after the Market Dynamics card: Target
Mkt Share, Actual Mkt Share, and Achievement % -- YTD window, SU basis specifically, DM1 and DM2
shown side by side per card. Pure re-surfacing of `getDM1DM2MarketIntel(bu).total` (the blended
methodology already built and documented on that function) -- no new computation, just a new,
narrower card layout scoped to exactly the window/basis requested.

Also removed the "Full Product Detail — DM1/DM2" collapsed tables and their two supporting
functions (`section4b_dm1dm2Table`, `totalBUCards`) per the prior request -- their MAT+YTD,
SU+Value, 18-column detail is gone; this new card block is the intentionally narrower replacement
for the "what's our total DM1/DM2 position" question specifically.

**Validated:** all 4 BUs re-render correctly. Cluster: Target 7.5%/8.8%, Actual 7.6%/8.0%,
Achievement 101.4%/90.0% (flagged "Below target" since the SU-basis average sits under 100). DIAB:
target=actual=21.9% both DM levels, ~100.1% achievement (on target). GIT: 148.8%/143.0%
achievement (on/above target). CHC correctly shows "—" for Target/Achievement (no TARGETS_2026
target defined for any CHC product) while still showing real Actual share figures (7.7%/8.6%) --

## Executive Command Center rebuilt as Phase 1 Executive KPI Section (2026-07-27)

The 16-section Business Review workspace was removed entirely (2026-07-27, user request) and the
Executive Command Center was rebuilt from scratch as the platform's default landing page around a
new brief: not a dashboard, a page that answers within 10 seconds how the business is performing,
which BU needs attention, where the opportunities/risks are, and where to drill next. Phase 1 ships
ONLY the Executive KPI section -- 9 of the 11 requested KPI cards (Operational Coverage, Right
Frequency, Sales Force Health, Sales Achievement, Market Share, Business Unit Growth, Sales
Productivity, Line Performance) plus a global filter bar (Business Unit / Line / Period /
Comparison Period). No AI narrative, no additional charts -- per the brief, those come after this
foundation is approved.

**Deferred:** KPI 6 (Customer Dynamics -- New/Lost/Active/Frequent by Private vs Special Pharmacy)
and KPI 7 (SKU Penetration -- Full vs Partial portfolio per customer) need customer x type and
customer x product granularity the sales cache doesn't carry yet (it only tracks customer x rep x
brick x region x line). The raw source data has what's needed -- refresh_sales.py needs an ETL
update to capture it, then a re-run, before these two can be built for real. Decision (user,
2026-07-27): ship the other 9 now, add 6/7 as a fast-follow once the cache is regenerated.

**New shared interfaces added** (no business logic duplicated -- every KPI composes existing
per-module interfaces at the Executive layer):
- `CoverageDashboard.getFilteredCoverageByType(bu)` -- Coverage/RF split by customer type
  (Contract/Doctor/Hospital), same filtered population as the existing headline metric, for the
  KPI 1/2 click-through popup.
- `CoverageDashboard.getFilteredCoverageForLine(bu, line)` -- the SAME Title=Medical
  Representative/Experience=Non-Probation/Status=Active/Type-filtered population, scoped to one
  Line instead of the whole BU, so the Line filter's numbers reconcile with the BU-level headline
  rather than silently switching to a different (unfiltered) population.
- `SalesDashboard.getLineSalesSummary(bu)` -- per-Line Sales Achievement, grouped by
  `SEMANTIC.normalizeLine()` (see CHC de-dup note below).
- `SalesDashboard.getItemAchievement(bu, brandName)` -- CHC-only Brand-to-Item (SKU) drill,
  Non-Tender/Value basis, same convention as `getBrandAchievement()`.
- `DS.executiveKpiCard(...)` and `DS.select(...)` -- new Design System components (Executive
  Insight Card layout: header/main value/performance/comparison/ranking/status/trend/click; a
  lightweight single-select for the filter bar). No new visual language -- same tokens/shadows/
  radii as every other DS component.

**CHC line de-duplication (confirmed by user, 2026-07-27):** Sales tags CHC's rows "CHC_SALES"
while every other cache spells it "CHC" -- these are the SAME underlying transactions under two
spellings (reconciled exactly: summing both raw names gives the identical total
`getBusinessSummary()` already reports for CHC), not two real sub-lines. Every Sales-side per-line
aggregation here groups by `SEMANTIC.normalizeLine()` to collapse them into one "CHC" bucket, or
CHC would silently show as two lines and double its apparent total if ever summed. Coverage's own
`teamComparison`, by contrast, carries "CHC" and "CHC_Sales" as genuinely separate sub-teams with
different real headcounts (14 vs 24, confirmed via direct cache inspection) -- for the Line
Performance card these are merged into the platform's single canonical "CHC" line (headcount-
weighted average for Coverage%/RF%, summed headcount) for consistency with how every other module
already treats "CHC" as one line, not because they're duplicates like the Sales case.

**Design decisions made explicit (not silent), open to revision on request:**
- No "All BUs" filter option -- every KPI's Ranking section must read "#N of 4 Business Units" per
  spec, which only makes sense framed around one selected BU. Filter is CHC/Cluster/DIAB/GIT,
  default CHC.
- Line filter reframes Ranking to "#N of \<lines\> Lines within \<BU\>" for the 3 KPIs with real
  line-level data (Coverage, RF, Sales Achievement); Sales Force Health/Market Share/BU Growth stay
  BU-level regardless (no line-level breakdown built for those sources yet).
- Sales Achievement's headline uses `getBusinessSummary()`'s all-transaction achievementPct (not
  `getBrandAchievement()`'s Non-Tender basis) so it reconciles with the number already shown
  elsewhere on the platform.
- Sales Force Health and Sales Productivity have no published target anywhere on the platform, so
  their "Performance" section is framed against a documented implicit target (100% filled / the
  platform-wide average per-rep productivity) rather than a fabricated number.

**Validated:** jsdom render against real cache data, all 4 BUs, default view and Line-filtered view.
Ranks form a valid 1-4 permutation per KPI across all 4 BUs (spot-checked by hand). CHC's
Sales-side Line Performance row correctly collapses to one "CHC" line (94.9M actual, matching
`getBusinessSummary()` exactly) instead of showing CHC_SALES as a phantom second line. Line filter
correctly re-scopes Coverage/RF/Sales Achievement and re-ranks within the BU's lines (e.g.
Cluster/ORTHO-I: 45.9% Sales Achievement, #5 of 5 lines -- weakest; Cluster/CVM-I: 101.2%, #1 of 5).
Modal cascade validated end-to-end: Sales Achievement card -> Brand modal -> (CHC only) click a
brand row -> Item modal, all three levels showing correct, reconciling numbers.
never a fabricated target/achievement number.

## Sales Value KPI card added (2026-07-27)

New card, distinct from Sales Achievement: Non-Tender transactions only (vs Sales Achievement's
all-transaction basis), its own Target/Achievement %/Variance on that Non-Tender basis. Built by
summing `getBrandAchievement()`'s per-brand rows -- no separate calculation, so it can never drift
out of sync with the Brand Portfolio Health numbers already shown elsewhere.

`getBrandAchievement(bu, line)` and `getItemAchievement(bu, brandName, line)` were both extended:
units (QTY/TGT_QTY) and `contributionPct` (each row's share of the scope's total Non-Tender VALUE)
added to their output; both now accept an optional `line` param for Line-filter support;
`getItemAchievement`'s `brandName` is now optional (null = aggregate items across all of a BU's
brands). Click opens a popup -- Units/Value/Target/Achievement %/Contribution %, sorted weakest
achievement first -- grouped by Brand for Cluster/DIAB/GIT, by **Item** directly for CHC (per
request, no brand-grouping layer for CHC). Double-click switches to the Sales tab.

The global Line filter's CHC option now displays as **"CHC_SALES"** (Sales' own raw spelling for
this line) instead of "CHC" -- display label only, the underlying filter value stays the canonical
"CHC" so every existing `normalizeLine()`-based comparison keeps working unchanged. See
[[chc-line-dedup]] in memory for the full CHC/CHC_SALES/CHC_Sales naming picture.

**Validated:** CHC Sales Value = EGP 94.9M, exactly matching the independently-computed sum of
`getBrandAchievement('CHC').brands[].actualValue`. CHC's popup correctly shows 9 items (no brand
grouping); Cluster's popup correctly shows 13 brands. Line filter dropdown for CHC shows
"CHC_SALES" as the only line option.

## Sales Achievement corrected to Non-Tender basis (2026-07-27)

User: "make right calculation for sales achievement." KPI 5 was the one card still reading
`getBusinessSummary()`'s all-transaction achievementPct while everything else built the same day
(Brand Portfolio Health, Sales Value, Line Performance) used Non-Tender, Value basis -- the two
didn't reconcile, and Tender business (which behaves differently commercially -- pricing/margin/
predictability) was silently inflating or deflating the headline depending on the BU.

Added `SalesDashboard.getSalesAchievementSummary(bu, line)` -- Non-Tender only, Value basis, YTD +
MoM growth, optional Line scope -- now KPI 5's single source of truth. `getLineSalesSummary(bu)`
(Line Performance's per-line Sales Achievement column) was also switched to Non-Tender for the same
reason: it's a Line cut of the same headline number and must use the identical definition.
`getBusinessSummary()`'s original all-transaction achievementPct is untouched for anything that
still needs it -- this was a correction to what "Sales Achievement" means on the Executive Command
Center specifically, not a deletion of the older figure.

**Validated:** `getSalesAchievementSummary()`, `getLineSalesSummary()`, and `getBrandAchievement()`
now reconcile EXACTLY (actual + target) for all 4 BUs and spot-checked lines (e.g. DIAB:
469,029,883 / 357,739,980 = 131.11% via all three paths). Achievement changed for BUs with real
Tender business once excluded (Cluster 88.1% -> 86.8%, DIAB 132.5% -> 131.1%); CHC and GIT were
unchanged (confirmed near-zero Tender volume in those BUs). Sales Achievement's headline value now
equals Sales Value's achievementPct exactly (by construction) while remaining a distinct card --
Sales Achievement leads with %/target/trend, Sales Value leads with the EGP amount and brand/item
drill-down.

## Line Performance table extended (2026-07-27)

Added Sales Value, Target Value, and Contribution % (each line's share of the BU's total Non-Tender
Sales Value -- same convention as the Sales Value card's brand/item popup) to the Line Performance
table. Reuses `getLineSalesSummary(bu)`'s already-corrected Non-Tender actualValue/targetValue --
no new calculation. CHC's row displayed as "CHC_SALES" via a display-only `lineDisplayLabel()`
helper (since reverted -- see the correction below).

**Validated (at the time):** CHC row showed CHC_SALES, 100.0% contribution (CHC was treated as one
canonical line). Cluster's 5 lines' Contribution % sums to ~100% (26.0 + 22.4 + 16.9 + 26.8 + 8.0).
Sales Value/Achievement % per line matched the corrected (Non-Tender) figures from the Sales
Achievement fix above exactly.

---

## CHC de-dup reversed: CHC has TWO real lines, not one (2026-07-27)

**This corrects the CHC/CHC_SALES collapse from earlier today** (see `[[chc-line-dedup]]` in
memory for the full history). Business-owner correction: CHC is not one line spelled two ways --
it genuinely runs two distinct commercial channels under the same BU:

- **"CHC"** -- the standard Doctor/Hospital/Contract-facing Medical Representative channel, same
  Title=Medical Representative/Type-in-{Contract,Doctor,Hospital} scope every other line uses.
- **"CHC_SALES"** -- a distinct Pharmacy-facing sales channel.

**What changed:**

1. `semantic-model.js` -- `CANONICAL_LINE_TO_BU` now lists `"CHC_SALES": "CHC"` as its own
   canonical line (not sourced from IQVIA's TARGETS_2026, which only has one "CHC" entry). Removed
   the `"CHC_SALES": "CHC"` synonym-collapse entry from `LINE_SYNONYMS`. `normalizeLine()` now
   resolves Sales' `"CHC_SALES"` and Coverage's `"CHC_Sales"` (mixed case) both to canonical
   `"CHC_SALES"`, distinct from `"CHC"`.

2. `coverage-interface.js`'s `getFilteredCoverageForLine(bu, line)` -- Coverage/RF for CHC_SALES
   needed more than a Type change. Direct inspection of the records cache found CHC_SALES's
   rep-level rows are titled **"Sales Representative"**, never "Medical Representative" (that
   title does not occur on this team at all), and its customers are Type="Pharmacy" almost
   exclusively (2,574 of 2,628 latest-period rows). Filtering CHC_SALES on the standard
   Title="Medical Representative" scope silently returns zero rows -- not a smaller number, zero.
   So the function now resolves **both** Title and Type per row based on which of CHC's two lines
   that row belongs to: standard scope (Medical Representative / Contract-Doctor-Hospital) for
   "CHC", Sales Representative / Pharmacy scope for "CHC_SALES". Every other BU/line keeps the
   single uniform scope -- this dual-scope resolution is CHC-specific.

3. `executive.js` -- removed the now-obsolete `lineDisplayLabel()` display-relabeling hack (and
   its 4 call sites in the filter bar, Line Performance table, Sales Achievement card, and Sales
   Value card). It existed to make CHC's one collapsed line *read* as "CHC_SALES" in the UI; now
   that CHC has two real canonical lines, no relabeling is needed -- both display under their own
   correct names.

**Validated (all 4 BUs, jsdom against real cache data):**
- CHC's Line filter now shows 3 options: All, CHC, CHC_SALES (previously 2: All, CHC).
- `getFilteredCoverageForLine('CHC', 'CHC')`: 93.5% coverage, 65.2% RF, 15 reps, 1,472 rows
  (unchanged from before this fix -- standard scope, as expected).
- `getFilteredCoverageForLine('CHC', 'CHC_SALES')`: 92.8% coverage, 67.2% RF, 10 reps, 1,978 rows
  (previously returned null/0 rows under the old Title="Medical Representative" scope).
- `getFilteredCoverageForLine('CHC', null)` (whole BU): 93.1% coverage, 66.4% RF, 25 reps, 3,450
  rows -- correctly the union of both populations, each scored against its own scope. Sanity-
  checked: CHC (15) + CHC_SALES (10) reps = 25 = All; CHC (1,472) + CHC_SALES (1,978) rows = 3,450
  = All.
- Line Performance table now shows 2 rows for CHC ("CHC" and "CHC_SALES"), each with its own
  Coverage %/RF %/Sales Value/Target/Achievement/Contribution.
- Cluster, DIAB, and GIT unaffected -- rankings still form valid 1-4 permutations across all 8
  KPI cards, all BU line lists unchanged.

---

## Customer Channel Mix KPI card added -- 9th Executive KPI (2026-07-28)

Revives the spirit of the deferred KPI 6 (Customer Dynamics) using data the Sales cache actually
supports today. The cache has no individual customer name or ID at the transaction level -- its
finest granularity for "who bought this" is the `sub_types` lookup (58 raw values), a mix of named
pharmacy/institution accounts (e.g. "Ezzaby") and generic trade-channel labels (e.g. "Retail",
"MOH"). True per-doctor/per-pharmacy identity would need an ETL enhancement, the same constraint
that deferred KPI 6 originally -- `cache.customers` carries only an anonymized numeric ID, no name.

**What was built:**

1. **`sales_subtypes.xlsx`** (delivered to the user, iterated jointly) -- all 58 raw sub_type
   values grouped into 11 commercial clusters: Chain Pharmacy (35, includes both chains confirmed
   against the `chains` master lookup and other named pharmacy accounts), Stores (4), Retail (3),
   Institutional/Government (7), OTHERS (3, excluded/non-active), and 5 single-value clusters kept
   separate by the business owner's explicit choice (Private Healthcare Facility, Private Clinic,
   Private Hospital, POLY Clinic, E-Commerce, Independent Pharmacy). A "Group Analysis" tab shows
   real Non-Tender value/share/row-count per cluster, computed directly from the cache (not a live
   formula -- rerun after any cluster or cache change).
2. **`js/sales.js`** -- `SUBTYPE_TO_CLUSTER` map (the code-side mirror of the spreadsheet -- update
   both together) + `getCustomerClusterMix(bu, line)`: Non-Tender, Value basis (same convention as
   every other Achievement-family figure on this platform), two-level result -- cluster totals for
   the card, and each cluster's own sub_type ("customer") breakdown nested inside for the drill-down
   modal. Mirrors `getBrandAchievement()`/`getItemAchievement()`'s brand-then-item drill pattern.
3. **`js/executive.js`** -- new "Customer Channel Mix" KPI card (9th card, slotted after Sales
   Value). Headline metric is channel **concentration** (the top cluster's share of Non-Tender
   value), not achievement-vs-target -- there's no target for a customer-mix metric, so the card's
   Performance section is intentionally omitted rather than forcing a fake Target/Achievement/
   Variance framing onto a distribution metric. Ranked ascending (lower concentration = more
   diversified = better, documented judgment call). Status thresholds (documented assumption,
   adjustable on request): <25% Excellent, 25-40% On Track, 40-55% At Risk, >=55% Critical. Click
   opens a cluster-level modal; click a cluster row for its sub_type/"customer" breakdown --
   labeled honestly in the modal caption that "customer" means sub_type value, a real account name
   for Chain/Independent Pharmacy clusters but a channel label for institutional/retail clusters.

**Validated (all 4 BUs, jsdom against real cache data, full click-through cascade):**
- CHC: 28.9% concentration (top: Chain Pharmacy), #1 of 4 (most diversified) -- On Track.
- Cluster: 43.1% (top: Stores), #2 of 4 -- At Risk.
- GIT: 46.7% (top: Stores), #3 of 4 -- At Risk.
- DIAB: 54.3% (top: Stores), #4 of 4 (most concentrated) -- At Risk.
- Card click -> cluster modal (11 rows, CHC) -> click "Chain Pharmacy" -> customer modal (30 named
  accounts, led by Ezzaby at 61.3% of that cluster / 17.7% of CHC's total Non-Tender value).
- Grand total across all 4 BUs (EGP 1,132.3M) reconciles with the whole-cache total (EGP 1,134.0M,
  no BU/line filter) -- the ~0.15% gap is Non-Promoted/Other Markets rows, already out of BU scope
  by design (see semantic-model.js's CONTEXT_SEGMENTS).
- Also fixed while in this file: the file-header comment's CHC line-dedup note, which still
  described the reversed (collapse-to-one-line) behavior -- corrected to match the two-real-lines
  fix above.

---

## Customer Channel Mix clustering revised (2026-07-28)

Business owner revised `sales_subtypes.xlsx`'s cluster assignments and re-uploaded it: "Private"
moved from Private Healthcare Facility into Retail, and "EgyDrug_Pharmacies" moved from
Independent Pharmacy (named) into Retail. Both source clusters (Private Healthcare Facility,
Independent Pharmacy (named)) are now empty and no longer appear anywhere -- the card only ever
renders clusters that actually have rows, no code change needed for that part. Updated
`SUBTYPE_TO_CLUSTER` in `js/sales.js` to match exactly (diffed programmatically against the
previous map -- confirmed these were the only 2 of 58 assignments that changed), regenerated
`sales_subtypes.xlsx`'s "Group Analysis" tab with the new totals, and bumped `js/sales.js`'s
cache-buster to `20260728_clustermix2`.

**Cluster count dropped from 11 to 9.** Company-wide, Retail is now the single largest cluster at
38.6% of Non-Tender value (up from a combined ~11.3% before the reassignment -- "Private" alone
carried EGP 300M/26.5% of total value, the single biggest line item in the whole clustering).

**Validated (jsdom, real cache data):** CHC's Customer Channel Mix headline changed from 28.9%
(top: Chain Pharmacy) to **35.9% (top: Retail)** -- still ranked #1 of 4 (most diversified BU),
still "On Track" (threshold is <40%), but now closer to the At Risk line. Cluster/DIAB/GIT
unchanged (54.3%/46.7%/43.1%, all still "Stores"-led) since neither reassigned sub_type carries
meaningful value in those 3 BUs -- confirms the change is correctly scoped to where the data
actually lives (CHC, where "Private" and "EgyDrug_Pharmacies" have real volume). Full click-through
re-verified for CHC: cluster modal now shows 9 rows, Retail on top at EGP 34.0M/35.9%, drilling into
it shows 5 sub-types led by Special PHs (61.5% of the Retail cluster).

**Process note for next time:** when the business owner sends back a revised clustering
spreadsheet, diff it against the current in-code map programmatically (don't eyeball 58 rows) --
here it isolated exactly 2 real changes out of 58, which is what let this update ship as a
targeted, low-risk edit instead of a full re-review.

---

## Customer Dynamics / SKU Penetration -- scoped, not built (2026-07-28)

Business owner asked for, within the Retail cluster: unique customer count, lost customers,
frequent customers, full-vs-partial-SKU-basket customers, with SKU names. **Confirmed not
buildable from the current cache** -- `cache.rows` has no customer identity at all (only a
per-row count), and `cache.customers` (the "active roster," 323,318 rows) has customer ID +
rep/brick/region/line but no sub_type/cluster link, no month, and no product link. Full spec for
what `refresh_sales.py` needs to add, the derived KPI definitions, and the recommended
visualization design (customer bridge, frequency segmentation, SKU penetration ranking) is in
`CUSTOMER_ANALYTICS_ETL_SPEC.md`. First step before any code: confirm whether the raw source
Excel actually carries customer ID/name at transaction grain -- `cache.meta.sourceRows` (996,720)
already sits above the aggregated `cache.rows` (512,669), so the raw file predates the
aggregation, but it isn't yet confirmed that customer identity survives that far upstream either.

---

## Retail cluster customer analysis -- confirmed feasible, proof-of-concept delivered (2026-07-28)

Business owner confirmed the raw source (`TOTAL_SALES_2026.xlsx`, sheet `Tota_SALES_2026`,
996,721 rows -- confirmed to be the exact file `refresh_sales.py` reads, matching
`cache.meta.sourceRows`) carries `CustomerID`, `CustomerName`, and `SubType` at transaction grain,
alongside `Item` (SKU), `Date`, `Quantity`, `Value`, and `IsTender`. Extracted every Retail-cluster
row (sub_types: Special PHs, Private, EgyDrug_Pharmacies, Retail, Account) directly from this file
with `python-calamine` (996,720 rows parsed in ~34s -- openpyxl was too slow for a file this size;
calamine's Rust parser is the right tool for any future one-off analysis against this same source),
Non-Tender only: **604,025 of 996,720 total company-wide rows, 45,680 distinct customers.**

**Headline findings** (full detail + full customer list + SKU list in
`retail_cluster_customer_analysis.xlsx`):
- Retail cluster holds ~95% of the company's entire distinct-customer base (45,680 of ~48,040 seen
  platform-wide) but only ~38.6% of Non-Tender value -- confirms this is a long-tail-of-small-
  accounts channel, very different economics from Chain Pharmacy's ~30 large named accounts.
- Customer bridge (2026-04 → 2026-05): New 2,006 · Retained 21,889 · Reactivated 4,694 · Lost 7,503.
- Frequency: Frequent (4-5/5 months) 21,344 · Occasional (2-3/5) 14,266 · One-time 10,070.
- SKU basket (core list = top 18 of 78 SKUs covering 80% of cluster value, a documented Pareto
  cut): Full basket (≥80% of core) 950 · Partial 39,583 · None of core (long-tail only) 5,147.
- Top-penetration SKU: EMPACOZA TRIO 25/5/1000 30 TAB, bought by 42.9% of all Retail-cluster
  customers.

**Status:** delivered as a one-time spreadsheet analysis, not yet a live dashboard card. This
validates the whole approach end-to-end (real customer names, real history, real basket data all
present and joinable) -- industrializing it into `refresh_sales.py` + a new `getCustomerDynamics()`/
`getSkuPenetration()` pair in `js/sales.js`, wired as a drill-down from the Customer Channel Mix
card's cluster rows, is the next step if requested. See `CUSTOMER_ANALYTICS_ETL_SPEC.md` (updated)
for the full spec, now marked confirmed rather than pending verification.

---

## Chain Pharmacy cluster analysis + cross-cluster comparison (2026-07-28)

Same method applied to the Chain Pharmacy cluster (35 named sub_types) to test whether the
Retail-cluster pattern generalized, and to build a cross-cluster comparison for the executive
view. Delivered as `chain_pharmacy_and_cluster_comparison.xlsx`.

**Extraction note:** `python-calamine`'s one-time parse of `Tota_SALES_2026` runs 30-42s with real
variance depending on sandbox load -- right at the edge of a single command's budget. An attempt
to extract ALL 9 clusters in one pass (to fully answer "all clusters") timed out twice; scaled
back to Chain Pharmacy alone (the highest-priority cluster per the recommended next-steps list),
which completed in ~37s using the same pattern that worked for Retail. Extracting the remaining 7
clusters is straightforward but needs to be done one or two at a time per command, not all at once.

**Headline comparison (Retail vs Chain Pharmacy):**

| Metric | Retail | Chain Pharmacy |
|---|---|---|
| Unique customers | 45,680 | 1,155 |
| Retention rate (Retained / (Retained+Lost)) | 74.5% | 90.7% |
| Frequent buyers (4-5/5 months) | 46.7% | 73.3% |
| Full-basket customers | 2.1% | 36.2% |
| Top SKU penetration | 42.9% | 72.5% |

**Commercial read:** Chain Pharmacy is a small (1,155 accounts), high-retention, deep-relationship
channel -- losing one account is a real, trackable loss. Retail is a reach/coverage channel with
~40x the customer count but structurally lower retention and much narrower baskets -- the lever
there is acquisition and basket-widening, not retention alone. This kind of cross-cluster contrast
is the reason the Customer Channel Mix card's cluster breakdown matters -- a single company-wide
customer-dynamics number would have hidden both stories.

---

## Cluster Customer Health -- live dashboard build (2026-07-28)

The Retail/Chain Pharmacy proof-of-concept above is now a live, wired feature in the Executive
Command Center, not just a one-time spreadsheet. Three pieces shipped:

**1. `etl/build_customer_analytics_cache.py` (new, re-runnable ETL script).** Reads
`TOTAL_SALES_2026.xlsx` (`Tota_SALES_2026` sheet) directly via `python-calamine` in a single pass,
aggregating straight into final compact structures (no intermediate row dump -- that two-pass
pattern was tested and is too slow against the ~40s tool budget). Currently builds
`CLUSTERS_TO_BUILD = {'Retail', 'Chain Pharmacy'}`; extending to the remaining 7 clusters (Stores,
Institutional/Government, POLY Clinic, Private Clinic, Private Hospital, E-Commerce, OTHERS) is a
one-line change to that set, re-run whenever `TOTAL_SALES_2026.xlsx` refreshes. Run time: ~40.6s
total (30.7s to parse the sheet, ~10s to aggregate + write). Output:
`cache/customer_analytics.json` (plain) + `cache/customer_analytics.data.js` (gzip+base64, loaded
in `dashboard.html` alongside the other caches, decompressed client-side via
`decompressCustomerAnalyticsCache()` in `js/sales.js`).

**2. `js/sales.js`: `getClusterCustomerHealth(bu, cluster)`.** Reads the new cache, optionally
narrows to a BU by filtering each customer's `bus` array, and recomputes every aggregate (bridge,
frequency buckets, basket buckets) from that narrowed list rather than trusting the
cache's company-wide totals -- so a BU-filtered view is always internally consistent.

**3. `js/components.js`: four new DS visual components** (`customerBridge`, `segmentBar`,
`rankedBarList`, `dataGrid`/`mountDataGrid`), all HTML/CSS builders consistent with this file's
existing convention (no canvas/Chart.js dependency). `dataGrid` is the first paginated/searchable/
sortable/CSV-exportable component in the design system -- built specifically because `DS.table()`
has no pagination and is unusable for a 45,000-row customer list.

**4. `js/executive.js`: `openClusterCustomersModal()` now dispatches on data availability.** If
`getClusterCustomerHealth()` returns `ok: true` (Retail, Chain Pharmacy today), it opens a
four-section Executive Summary overlay -- Customer Bridge (New/Retained/Reactivated/Lost, latest
vs prior month), Purchase Frequency segmentation, SKU Basket Depth segmentation, and Top SKU
Penetration (ranked, sorted by penetration % descending) -- with a "View Full Customer List"
button that swaps the same modal body into the paginated `dataGrid` (25 rows/page, search by name
or ID, sortable columns, CSV export), and a toggle back to the summary. Every other cluster falls
back unchanged to the original flat sub_type table (`openClusterFlatModal`).

**Validated via jsdom** (`pretendToBeVisual: true`, per the RAF-detection fix documented earlier in
this file): full click cascade card -> cluster modal -> Retail health overlay -> grid -> search ->
sort -> back-to-summary, repeated for Chain Pharmacy, plus confirmed the Stores cluster (no ETL
coverage yet) correctly falls back to the flat table with no regression.

**Not yet done:** extending `CLUSTERS_TO_BUILD` to the other 7 clusters -- straightforward, not
requested yet.

---

## KPI card overflow fix + BU-scoped SKU Penetration (2026-07-28)

Two fixes after the first live look at the deployed Executive Command Center:

**1. KPI card text overflow.** `.ds-exec-kpi-row`'s Target/Achievement/Variance metrics were an
unconstrained `display:flex` row -- flex children default to `min-width:auto`, so long values
(e.g. "-90.1M", "-26.5 pts vacancy") forced the row wider than its card, which forced the card
wider than its CSS grid track (`.ds-grid-kpi`, `minmax(180px,1fr)`), spilling text past the card
border into neighboring whitespace. Fixed in `css/components.css` with `min-width:0` +
`overflow-wrap:break-word` on the card, its main-value row, and each metric column, plus
`flex-wrap:wrap` as a second line of defense; bumped `.ds-grid-kpi`'s minimum tile width from
180px to 240px in `css/layout.css` since 180px was too tight for a 3-column metric row regardless.

**2. SKU Penetration is now BU-scoped.** Previously the Customer Health drill's "Top SKU
Penetration" list was always the company-wide (all-BU) list regardless of the selected BU filter
-- inconsistent with the Bridge/Frequency/Basket sections above it, which were already correctly
recomputed from the BU-narrowed customer list. Fixed by extending
`etl/build_customer_analytics_cache.py` to additionally track item purchases and item-customer
sets **per (cluster, BU)** during its single pass, producing a new `skuPenetrationByBU` field per
cluster (one SKU-penetration list per BU, correct denominator = customers active in that cluster
under that BU). `js/sales.js`'s `getClusterCustomerHealth()` now returns the BU-specific list when
one is selected (falling back to the all-BU list for "All" or for a cluster/BU combo the ETL
hasn't computed), exposed via a new `skuPenetrationScope` field the UI uses to label the section
("Top SKU Penetration — CHC only" vs "— All BUs"). Verified the two views are genuinely different,
not a silent fallback -- e.g. Retail/All shows 78 SKUs led by EMPACOZA TRIO at 42.9%, Retail/CHC
shows 9 SKUs led by DOZOVA ASHWAGANDA at 35.9%.

**Engineering note:** adding the per-BU tracking pushed the ETL script's JSON+gzip write step past
the sandbox's 45s hard command timeout in one run (the parse+aggregate alone was already ~40s).
Fixed by checkpointing: the script now pickles its aggregated `output` dict to
`cache/.customer_analytics_checkpoint.pkl` immediately after aggregation finishes, before
attempting the JSON+gzip write -- so a second invocation can skip the expensive xlsx re-parse and
resume straight at serialization if the first run gets cut off. The checkpoint is cleared after a
successful write (renamed rather than deleted -- this mount has occasionally refused `unlink()` on
files still referenced elsewhere, same as git's `index.lock` earlier; rename always worked).
