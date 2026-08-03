# Zeta Commercial Excellence Dashboard — Project Overview

*Prepared 2026-07-31 to brief another AI assistant (or a new developer) on this codebase. Written to be self-contained: read this before opening any file, and use it to know which file to ask for if you need more detail.*

## 1. What this is

A premium, offline-first Pharmaceutical Commercial Intelligence Platform for **Zeta Pharma**, built for executive business reviews (CEO, Commercial Director, Sales Director, Marketing Director, Business Unit Heads, Sales Force Effectiveness Manager). It replaces a set of disconnected Excel reports with a single web dashboard covering field-force coverage, sales performance, IQVIA market intelligence, organizational headcount, and a to-market vs. in-market inventory view — with one Executive Command Center tying the whole business together into 9 headline KPIs.

It deploys as a **static site on GitHub Pages** (repo: `ahmedabdallahsfe-ai/zeta-intel-dashboard`) — no backend, no database, no server-side code at runtime.

## 2. Architecture philosophy

- **Offline-first, cache-driven.** All source data lives in Excel workbooks. Python ETL scripts read those workbooks, compute everything ahead of time, and emit compressed JSON caches. The browser never queries a live database — it loads a handful of `<script>` tags containing gzip+base64-encoded JSON, decompresses them client-side, and every dashboard interaction (filtering, ranking, drilling down) recomputes from that in-memory dataset. This is why the app works with no internet connection once loaded, and why refreshing data means re-running a Python script and re-deploying static files, not hitting an API.
- **No framework.** Vanilla HTML5/CSS3/ES2023 JavaScript, Chart.js for charts. No React, no build step, no bundler (the one exception — the embedded "To-Market vs In-Market" page — uses React/Recharts/Babel-standalone entirely inside its own iframe, isolated from the main app's stack; see §8.6).
- **Module-per-workspace, one shared "Enterprise Semantic Interface" contract.** Each business domain (Coverage, SFE, Sales, IQVIA) owns its own data and computations behind a small set of public functions with a consistent shape (`{ ok, status, ...data }`, never throws). Other modules — chiefly the Executive Command Center — read *only* through those public functions, never by reaching into another module's internal cache. This module-boundary rule is stated explicitly in nearly every file's header comment and is the single most load-bearing convention in the codebase.
- **Design system, not ad-hoc CSS.** A shared component library (`js/components.js` + `css/components.css`/`design-system.css`) provides reusable KPI cards, insight cards, filter dropdowns, tables, and chart wrappers, styled after Stripe/Linear/Apple/Notion-grade SaaS products — deliberately avoiding a generic admin-dashboard look.

## 3. Tech stack

| Layer | Technology |
|---|---|
| Markup/styling | HTML5, CSS3 (custom design tokens, no Tailwind in the main app) |
| Client logic | Vanilla JavaScript (ES2023), no framework, no build step |
| Charts | Chart.js |
| Data compression | pako.js (gzip) + base64, decompressed client-side |
| Spreadsheet parsing (client) | xlsx.js (SheetJS), for the CSV/XLSX export feature |
| ETL / data pipeline | Python (pandas/openpyxl/python_calamine), run manually via `.bat` launchers |
| Auth | Client-side only — salted SHA-256 password check against a hash embedded in the cache, session in `localStorage`, 8-hour TTL. **Not a real security boundary** (see §7) — appropriate for an internal, non-adversarial deployment only |
| Hosting | GitHub Pages (static), repo `ahmedabdallahsfe-ai/zeta-intel-dashboard` |
| Embedded sub-app | React 18 (UMD) + ReactDOM + Recharts + Babel-standalone + Tailwind CDN, all inside one self-contained `<iframe>`-served HTML file (the "To-Market vs In-Market" workspace only) |

## 4. Repository structure

```
CoverageDashboard/
├── dashboard.html              ← the single-page app shell (sidebar nav, topbar, filter bar, #app-root mount point)
├── refresh.bat                 ← main Windows launcher: runs every ETL script, then git add/commit/push
├── refresh.py / refresh_sales.py / refresh_iqvia.py   ← Python ETL: Excel → cache/*.json + cache/*.data.js
├── etl/
│   └── build_customer_analytics_cache.py              ← ETL for the Customer Channel Mix / Customer Health drill
├── js/                         ← all client-side application code (see §5)
├── css/                        ← design tokens + component styles + per-workspace styles
├── cache/                      ← generated output of the ETL (gitignored except the .data.js/.json themselves, which ARE committed — this is the app's "database")
├── assets/                     ← vendored third-party libraries (chart.umd.min.js, pako.min.js, xlsx.core.min.js)
├── TO MARKET_IN MARKET/        ← a separate, self-contained React dashboard (Sell-In vs Sell-Out), embedded via iframe — see §8.6
├── *.xlsx                      ← source-of-truth spreadsheets (all gitignored — never committed, some are 60-200MB)
├── Zeta_Dashboard_User_Config.xlsx  ← the "Users" sheet: email, password, role, Allowed BU, Allowed Lines — source of both login credentials and role-based data scoping
└── *.md                        ← project docs (PLATFORM_ROADMAP.md, DESIGN_SYSTEM.md, this file, etc.)
```

## 5. Core JS modules (`js/`)

| File | Owns |
|---|---|
| `app.js` | Boot sequence, sidebar tab switching, global filter bar, topbar, cache-buster wiring. The dispatcher every tab click routes through. |
| `auth.js` | The single app-wide login gate + role-based data-scope helpers (`AUTH.getScope()`, `isBuAllowed()`, `isLineAllowed()`, etc.) — see §7. |
| `semantic-model.js` | The canonical Business Unit / Line taxonomy shared by every module: `BU_LIST`, `lineToBU()`, `normalizeLine()`, line-name synonym table. |
| `config.js`, `utils.js`, `cache.js`, `loader.js` | Shared low-level helpers (formatting, cache decompression scaffolding). |
| `coverage-interface.js` + `analytics.js` + `filters.js` + `charts.js` + `tables.js` | The **"Operational and Execution" (Coverage)** workspace: field-force coverage %, right-frequency %, visit compliance, territory/line breakdowns. |
| `sfe.js` | The **"Zeta Organogram"** workspace: headcount, vacancy, org hierarchy (BUM → NSM → ASM → DM → rep). |
| `sales.js` (176K, the largest domain module) | The **"Sales Performance"** workspace: actual vs. target, brand/product/line/rep achievement, Tender vs. Non-Tender, customer channel mix, distributor concentration. |
| `iqvia.js` (552K, the largest file in the repo) | The **"Market Intelligence"** workspace: IQVIA market share, DM1/DM2 competitive market definitions, growth/EVI, portfolio and target-achievement analysis. Also currently hosts the platform's login/session primitives that `auth.js` was built to generalize. |
| `executive.js` | The **Executive Command Center** — the default landing page. Reads *only* through the other four modules' public interfaces (never their internals) to build 9 KPI cards. See §9. |
| `components.js` | The shared design-system component library: `DS.kpiCard`, `DS.executiveKpiCard`, `DS.insightCard`, `DS.select`, `DS.filterDropdown`, table/chart wrapper builders, `DS.emptyState`, etc. |
| `business-review-content.js` / `business-review-engine.js` | An earlier, now-retired "16-section Business Review" framework, superseded by the Executive Command Center (2026-07-27 rebuild) — mostly legacy, not part of the current live flow. |
| `exporter.js` | CSV/PDF export. |

## 6. Data pipeline (how a number gets from Excel to the screen)

1. Someone updates a source Excel workbook (e.g. `TOTAL_SALES_2026.xlsx`, `Final Total Coverage Feb to June.xlsx`, `Zeta's Total Organogram 2026.xlsx`, IQVIA exports).
2. `refresh.bat` is run (Windows, on the user's own machine — never in a sandbox, since these Python scripts routinely take minutes on 100MB+ workbooks). It calls, in order: `refresh.py` (Coverage/organogram/records), `refresh_sales.py` (Sales), `refresh_iqvia.py` (IQVIA), `etl/build_customer_analytics_cache.py` (Customer Channel Mix), and `TO MARKET_IN MARKET/refresh_dashboard.py` (the embedded sub-app's own data).
3. Each script computes final numbers in Python (pandas), writes `cache/<name>.json`, then gzip+base64-encodes it into `cache/<name>.data.js` (exposing `window.<NAME>_CACHE.b64Data`).
4. `refresh.bat` stages the changed cache files (and only those + relevant source files, not the multi-hundred-MB `.xlsx` sources, which are gitignored) and pushes to GitHub.
5. In the browser, `dashboard.html` loads every `cache/*.data.js` as a plain `<script>` tag. Each module's own `decompressXCache()` function reads `window.X_CACHE.b64Data`, runs `atob()` → byte array → `pako.ungzip(bytes, {to:'string'})` → `JSON.parse()`, and caches the result in a module-level variable for the rest of the session.
6. Every chart, table, and KPI card is computed **live in the browser** from that decompressed dataset on every filter change — there is no server-side pre-aggregation beyond what step 2–3 already did.

## 7. Authentication & role-based data scoping

- **Login**: one app-wide gate (`auth.js`, added 2026-07-29 — previously only the IQVIA workspace required sign-in). Credentials are salted SHA-256 hashes baked into `cache/iqvia.data.js` (source: the `Zeta_Dashboard_User_Config.xlsx` "Users" sheet, processed by `refresh_iqvia.py`). Session token is a plain `localStorage` object (`{email, name, role, expires}`, 8h TTL) — **not a real security boundary**; a technically sophisticated user can read the cached data via devtools before/without signing in. Acceptable for an internal, non-adversarial deployment; would need a real backend if ever exposed publicly.
- **Role-based scope**: each user row also carries "Allowed BU" and "Allowed Lines" (comma-separated, or blank = unrestricted). `AUTH.getScope()` returns `{ unrestricted, bus, lines }`; every workspace's filter dropdowns and every ranking/cross-BU loop calls `AUTH.isBuAllowed()` / `isLineAllowed()` / `filterAllowedBUs()` / `filterAllowedLines()` so a restricted user (e.g. a DIAB-only BU Manager) never sees another BU's individual numbers, in any tab. Several of the underlying per-BU data getters (`getFilteredCoverageForLine`, `getFilteredHeadcountForLine`, `getLineSalesSummary`, `getDM1DM2MarketIntel`) enforce this scope **inside the function itself** as a backstop, independent of what the UI asks for.
- **Company-wide "Corporate" aggregates are a deliberate, documented exception**: several new getters (`CoverageDashboard.getCorporateCoverageTotals()`, `IQVIADashboard.getCorporateMarketIntel()`) are intentionally **ungated** — they return only a single blended total across all 4 BUs, never a per-BU breakdown, so they can safely be shown even to restricted users without leaking any individual out-of-scope BU's number. This pattern is documented in the code and should be followed for any future cross-BU benchmark.

## 8. The six workspaces (sidebar tabs)

1. **Executive Command Center** (`executive`, default landing tab) — see §9, the main subject of recent work.
2. **Operational and Execution** (`coverage`) — field coverage %, right-frequency %, visit compliance, territory/line/customer-type breakdowns, execution workload.
3. **Zeta Organogram** (`sfe`) — headcount, vacancy rate, full BUM→NSM→ASM→DM→rep hierarchy browser.
4. **Sales Performance** (`sales`) — actual vs. target by brand/product/line/rep, Tender vs. Non-Tender split, customer channel mix, distributor concentration, monthly trend.
5. **Market Intelligence** (`iqvia`) — IQVIA-sourced market share, DM1/DM2 competitive market definitions, growth/EVI, portfolio & target-achievement views. The largest, oldest, most complex module.
6. **To-Market vs In-Market** (`tomarket`) — a completely separate, hand-tuned React/Recharts dashboard ("Sell-In vs Sell-Out Control Tower": STR%, implied inventory, months-of-cover) embedded via `<iframe src="TO MARKET_IN MARKET/index.html">` rather than ported into the main app's component system (an explicit decision: rebuild only when a source isn't already a working, tuned, self-contained artifact). Visible only to **unrestricted** users (`AUTH.getScope().unrestricted`) — sidebar entry hidden otherwise, and the tab re-checks scope itself if reached another way.

## 9. Executive Command Center — the 9 KPI cards (deep dive)

This is the platform's landing page and the most actively developed part of the codebase this week. Design goal: answer "how is the business doing, which BU needs attention, where are the risks/opportunities" within 10 seconds, no AI narrative, just structured cards.

**Filter model**: Business Unit (CHC / Cluster / DIAB / GIT, no "All" option — every card's Ranking section is framed around one selected BU) and, dependently, Line within that BU (defaults to "All"). Every card recomputes live from the selected BU/Line.

**The 9 cards** (each built by its own `build*Card()` function in `executive.js`, reading only through Coverage/SFE/Sales/IQVIA's public interfaces):

| # | Card | Source | Basis |
|---|---|---|---|
| 1 | Operational Coverage | Coverage | Title=Medical Rep, Non-Probation, Active, Contract/Doctor/Hospital types (CHC_SALES carved out to Sales-Rep/Pharmacy scope) |
| 2 | Right Frequency | Coverage | same population as #1 |
| 3 | Sales Force Health | SFE | headcount fill rate vs. implicit 100%-filled target |
| 4 | Sales Achievement | Sales | Non-Tender, Value basis |
| 5 | Sales Value | Sales | Non-Tender, sum of per-brand actual/target |
| 6 | Customer Channel Mix | Sales | top commercial-cluster concentration of Non-Tender value (channel-risk framing, lower = better) |
| 7 | Market Share | IQVIA | average of DM1/DM2 blended share, YTD SU basis |
| 8 | Business Unit Growth | IQVIA | average of DM1/DM2 Zeta growth vs. market growth (EVI) |
| 9 | Sales Productivity | Sales | Sales value ÷ deployed positions, platform/BU-average benchmarked |

Every card follows the same layout contract (`DS.executiveKpiCard()`): headline value, Performance row (target/achievement%/variance), an optional **comparison row**, a Ranking footer ("#2 of 4 Business Units" / "#1 of 3 Lines within DIAB"), a status badge (Excellent/On Track/At Risk/Critical), and a trend indicator.

**Comparison row — "vs Corporate" / "vs BU" (built 2026-07-31, iterated same day)**: 7 of the 9 cards (all except Market Share and Business Unit Growth, which keep their original "vs DM1 / vs DM2" IQVIA-market comparison) now carry a same-metric reference figure:
- When **Line = All**, shows **"vs Corporate"** — the metric blended across all 4 BUs, computed via the ungated aggregate getters described in §7.
- When a **specific Line is selected**, shows **"vs BU"** instead — the parent BU's own whole-BU total for the same metric — since comparing one line against the entire company was judged misleading (a line is a small slice of one BU). This mirrors the page's existing "Ranking" reframe ("of 4 Business Units" → "Lines within BU") and Sales Productivity's own pre-existing benchmark-label convention.
- One data-definition subtlety worth knowing: the company-wide **Sales Achievement/Sales Value "Corporate" figure excludes CHC's Pharmacy-facing "CHC_SALES" line entirely** (not just Tender business) — confirmed against real data (105.2% with CHC_SALES excluded vs. 101.1% included) as the platform's own established convention for that specific metric family.

All of this is validated end-to-end with a Node/jsdom test harness that boots the real `dashboard.html` + real decompressed cache data + real login flow for both an unrestricted user and a BU-restricted user, asserting the blended figures are identical across sessions (proving no per-BU data leakage) and that existing access-denied gates are unaffected.

## 10. Key domain/business conventions (do not relearn these the hard way)

- **BU/Line taxonomy** (`semantic-model.js`): 4 canonical Business Units — CHC, Cluster, DIAB, GIT — each with its own set of Lines. Raw spellings vary by source system (e.g. organogram says "NEUROSCIENCE", canonical is "CNS"); always go through `SEMANTIC.normalizeLine()` before comparing.
- **CHC has two real, distinct lines**: "CHC" (standard Medical Representative / Contract-Doctor-Hospital channel) and "CHC_SALES" (a separate Pharmacy-facing / Sales Representative channel). These are NOT duplicate spellings of the same thing — do not collapse them. Coverage KPIs give CHC_SALES its own Title/Type scope (Sales Representative + Pharmacy) rather than excluding it; Sales' own "corporate" Achievement figure, by contrast, excludes it entirely — two different, both intentional, handling rules for the same line.
- **Tender vs. Non-Tender**: most headline Sales/Achievement figures on this platform use **Non-Tender only** (Tender business behaves very differently commercially — pricing/margin/predictability) — always check which basis a given number uses before comparing it to another.
- **YTD-only, single-period snapshot**: the cache holds "every month present" with no prior-year history for Sales (IQVIA does have multi-year history, which is why growth/YoY figures come from IQVIA, not Sales). There is no historical period-by-period recompute anywhere on the platform — "Period" selectors are honest about only offering "Latest Period."
- **DM1/DM2**: IQVIA's two nested competitive-market definitions per product; each BU tracks a *different* set of DM1/DM2 markets, so there is no single unified denominator to sum market share across BUs the way Sales/Coverage numbers can be summed — any "company-wide" IQVIA figure is a documented approximation (average of each BU's own blended number), not a true aggregate.

## 11. Refresh & deployment workflow

- `refresh.bat` (Windows, run on Ahmed's own machine — these scripts routinely process 60–200MB Excel workbooks and take minutes, well beyond what any sandboxed AI tool's time budget allows) runs the full ETL chain, then stages and commits the changed cache files.
- Pushing to GitHub requires the user's own git credentials — an AI assistant working in a sandboxed environment has no GitHub auth and **cannot push**; commits should be made locally and the user informed to push from their own machine (or push themselves via their own script).
- Cache-busting: every `<script src="js/X.js?v=YYYYMMDD_label">` / `<link ... css/X.css?v=...">` tag in `dashboard.html` carries a version query string, bumped on every meaningful change to that file, since there is no build pipeline to hash filenames automatically.

## 12. Known limitations / deferred work

- Customer-level granularity (per-doctor, per-pharmacy analytics beyond the current commercial-cluster grouping) needs an ETL enhancement not yet built (this deferred a "Customer Dynamics" and a "SKU Penetration" KPI from the original Executive Command Center spec).
- The login/session mechanism is client-side only (see §7) — not suitable for a public-facing deployment without a real backend.
- `iqvia.js` (552KB) is the oldest and largest module and still contains some now-legacy rendering paths (e.g. an internal `renderExecutive()` function distinct from the current Executive Command Center) left over from before the current architecture — harmless but worth knowing it's there if you see an unfamiliar function name inside that file.

## 13. If you need more detail than this document

This overview should be enough to reason about the system's shape. For anything requiring exact current numbers, formulas, or line-by-line logic, the authoritative source is always the actual files listed in §5 — this document describes their responsibilities and conventions, not their full implementation.
