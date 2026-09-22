# Business Review PPTX Export — Role-Gated Download Architecture (Proposal)

**Trigger:** `Business review.pptx` dropped into the project folder 2026-08-27. Question: how should this template be surfaced in the dashboard as a downloadable, data-populated deck, with CEO/VP/BEX/SFE getting Corporate + every BU, BU Managers getting their own BU only, and NSMs getting their own line only.

**Status:** Phase 1's dashboard UI piece is **built and deployed** (2026-08-27) — see "Phase 1 — SHIPPED" below. `etl/build_business_review.py` (the per-BU/Corporate deck generation pipeline) is still proposal-only, unbuilt.

---

## PHASE 1 — SHIPPED (2026-08-27): "Business Review" template download panel

A concrete, separate-from-generation deliverable, requested explicitly: a user-facing download of the **raw template only** (not a populated deck — that's still the pipeline step below), gated with the existing `AUTH` role/scope system.

**What shipped:**

| Piece | File | What it does |
|---|---|---|
| Access rule | `js/auth.js` — `BUSINESS_REVIEW_TEMPLATE_ROLES`, `AUTH.canDownloadBusinessReviewTemplate()` | `["CEO","VP","BEX","Admin","SFE Manager","BU Manager"]` — mirrors `SPRINT_ROLES` exactly (see "Open decisions" below for why Commercial Director/Marketing Consultant/Line Manager are excluded, not omitted by accident) |
| Panel module | `js/business-review-download.js` — `window.BusinessReviewDownload.init()/.destroy()` | Self-contained gate + render, same shape as `js/control-panel.js`. Denied roles get an "Access restricted" empty state with **no file path anywhere in the DOM** — the `<a href>` is only built inside the authorized branch |
| Nav + wiring | `dashboard.html` (new sidebar `<li>` + script tag), `js/app.js` (menu-visibility gate, title-bar case, teardown, tab-dispatch, `renderBusinessReviewTab()`) | Exact same "hidden in nav AND refuses to render" double-gate every other role-restricted page on this platform uses (Market Intel, IMS Rx, Sprint) |
| Styling | `css/components.css` — `.brd-*` block appended at the end, same convention as Control Panel's `.cp-*` | Mobile-first: card stacks full-width under 768px, 44px-minimum tap target on the download button, responsive down to 420px |
| Asset | `assets/templates/Zeta-Business-Review-Template.pptx` | Byte-for-byte copy of the original — sha256-verified identical, re-opened cleanly with `python-pptx` (22 slides) after the copy |

**Verified before shipping:**
- Role-gating logic tested in a jsdom harness across CEO/VP/BEX/Admin/SFE Manager/BU Manager (download link present, correct scope note) and Line Manager/Marketing Consultant/Commercial Director (no link, no file path, denial screen only).
- `node --check` on all modified/new JS files; `tinycss2` zero-error parse on `components.css` (same validation method this project already uses for CSS changes).
- Template asset byte-identical to the source file (`sha256sum` match) and successfully re-parsed by `python-pptx` post-copy.
- **Not done, and can't be done from here:** an actual open in Microsoft PowerPoint on a real Windows machine. Since this is a pure, unmodified file copy (no `python-pptx` write step touches it), risk is minimal — but do one manual open before this is pointed at from an executive-facing announcement, per this doc's own Phase 1 action #5.

**Honest limitation, stated in the module's own code comments, not hidden:** this is still a static site with no backend. The panel guarantees the dashboard UI never *discloses* the file path to an unauthorized session — but the file itself is deployed at a fixed URL, so a technically sophisticated user who already knows or guesses that path could fetch it directly, signed in or not. This is the exact same limitation `auth.js` already documents platform-wide (every `cache/*.data.js` file has the same exposure) — not a new gap this feature introduces.

**What did NOT ship** (still exactly as scoped below): `etl/build_business_review.py` and the populated Corporate/BU deck list. The panel's own footer note says this explicitly to users today, so nobody mistakes "I can download the template" for "I can download my BU's filled-in review."

---

## OBSERVE — what's already on the ground

**The template is not a slide deck, it's a data contract.** 22 slides, single-BU-scoped (`[BU NAME]`, `[BU MANAGER NAME]`, `[SALES MANAGER NAME]` on the cover), organized into 6 pillars — Executive Opening, People, External Market (IQVIA), Internal Sales, Customer, Promotional Budget, Management Conclusions. It carries **12 native PowerPoint tables** and **12 native charts** (6 column, 4 bar, 2 doughnut), every one already headed with the exact field names the platform's data model uses (`Ach. %`, `MS Change vs LY`, `EI`, `Contrib. %`...). This is built to be populated programmatically, not edited by hand.

**Most of the hard work already exists and is currently dormant:**

| Asset | What it does | State |
|---|---|---|
| `BUSINESS_REVIEW_FRAMEWORK.md` | 16-section Management Decision Pack methodology — health index, cross-BU ranking, FACT/INTERPRETATION/HYPOTHESIS tagging, confidence scoring, decision-point format | Validated against CHC |
| `js/business-review-engine.js` | `computeHealthIndex()`, `computeCrossBURanking()`, `computeEvidenceScore()` — zero BU-specific code, reads only through the 4 standardized `getBusinessSummary()` interfaces | Built, but **"has no live caller in dashboard.html yet"** (its own doc comment) |
| `js/business-review-content.js` | Swappable analyst-authored narrative layer (Exec Summary, Root Cause, Decision Points, Scenarios) | CHC populated; Cluster/DIAB/GIT fall back to the generic computed version |
| `CHC_Pilot_Executive_Business_Review.md` | The validated pilot review | Reference implementation |

**You already made this exact call once.** `PLATFORM_ROADMAP.md`: *"The 16-section Business Review workspace was removed entirely (2026-07-27, user request)"* — replaced by the leaner Executive KPI Command Center. A PPTX **download** is consistent with that decision, not a reversal of it: the live dashboard stays the real-time operational view; the Business Review becomes a point-in-time governance artifact you hand out, exactly what the new template is designed to be.

**The "Corporate" grain already exists — it doesn't need inventing.** `js/executive.js` already carries a full `ALL_BU` sentinel (`isAllBU()`, `canSelectAllBUs()`) wired through its entire KPI stack for the existing "All Business Units" view. Whoever builds the Corporate deck is re-plumbing, not re-deriving.

**Role/scope plumbing already exists and is reused everywhere else.** `js/auth.js` defines 9 roles and a single `getScope()` → `{bus, lines}` contract. Every other role-gated feature (Market Intel, IMS Rx, Sprint, Expense, Control Panel) is a `ROLE_LIST.indexOf(u.role) >= 0` check plus, where it matters, an explicit "and the user must be unrestricted in scope" double-check (`canViewAllBUs()`). No new access-control mechanism is needed — this is the ninth consumer of a pattern that already exists eight times.

**"NSM" is not a login role — check this before promising anything.** In `Zeta_Dashboard_User_Config.xlsx`, every person whose Notes column says "National Sales Manager" has Role = **Line Manager**, restricted to exactly one Line inside one BU (e.g. Nader Khaled → GIT / GIT-II only; Mostafa Elkhateeb → DIAB / DIAB-I only). So **"NSM downloads for his own" = a Line Manager's own-Line scope** — a grain finer than BU, which nothing in the platform currently rolls up into a single business-summary object. Coverage and Sales already filter by line elsewhere in the app, but there is no `computeHealthIndex()`-equivalent at Line grain today.

**No PPTX writer exists anywhere in the codebase.** `js/exporter.js` ships Excel (SheetJS core build, vendored), PNG (Chart.js's own rasterizer), and PDF (browser print). Nothing writes `.pptx`, and nothing is vendored for it.

**Architecture constraint that decides everything below:** offline-first, no backend, static GitHub Pages deployment, refreshed by a local `refresh.bat` → Python pipeline before every push. Python is already a hard dependency for the ETL side.

---

## ORIENT — the real decision, and why it's not close

There are two fundamentally different ways to turn live data into a populated `.pptx`:

| | **Option A — Client-side (browser JS)** | **Option B — Pipeline (Python, `python-pptx`)** |
|---|---|---|
| How | `PptxGenJS` builds slides from scratch, or `JSZip` text-replaces inside the template's raw XML | A script in the existing `refresh.bat` ETL opens the template, writes table cells and chart data via `python-pptx`, saves one file per scope |
| Fidelity to the delivered template | Rebuilding native chart objects and formatted tables in JS is fragile and effectively means re-designing the deck in code | `python-pptx` writes real table cells and calls `chart.replace_data()` on real chart objects — this is exactly the library's core use case |
| New runtime dependency shipped to every browser | Yes — a new vendored library, more page weight, more surface area on a static site with no server-side validation | None — the browser only ever downloads a finished file |
| Consistency with this project's own philosophy | New | Matches Control Panel's explicit stance: *"the panel's job is to tell you when something needs doing, not to do it... two sources of truth is worse than one"* — computation happens in the pipeline, the browser only displays/serves |
| Effort for Corporate + per-BU grain | Same either way | Same either way — the data already exists (`ALL_BU` sentinel + 4 BU grains) |

**Recommendation: Option B.** The template's native charts and tables are the tell — this was built for `python-pptx`, and building it any other way throws away fidelity to recreate work that already exists in a form this library handles natively.

**What's actually new engineering, and what isn't:**

- Corporate deck + 4 BU decks → **zero new analytics.** The grain (BU, and "all BUs") already exists in `business-review-engine.js` and `executive.js`. This is an assembly/mapping job: pull the four `getBusinessSummary()` outputs, run them through `computeHealthIndex()`/`computeCrossBURanking()`, write the results into the template's placeholders and chart data.
- Own-Line ("NSM") deck → **genuinely new.** No function today aggregates Sales + Coverage + SFE + IQVIA down to a single Line. This has to be built, and IQVIA's market-share slides (7–10) may not even resolve cleanly below BU/DM1 grain — flag this before promising NSMs an identical 22-slide deck.

---

## DECIDE — role-to-deck matrix

| Role (from `Zeta_Dashboard_User_Config.xlsx`) | Scope today (`AUTH.getScope()`) | Decks visible | Basis |
|---|---|---|---|
| CEO, VP, BEX, Admin, SFE Manager | Unrestricted (`bus: null, lines: null`) | **Corporate + all 4 BU decks** (5 files) | Same double condition as existing `canViewAllBUs()` — role AND unrestricted scope |
| Commercial Director | Unrestricted in `SCENARIO_ROLE_CONFIG`, but **absent from `ALL_BU_ROLES`** today | Recommend: same as CEO/VP (Corporate + 4 BU) | **Open decision — confirm with Ahmed.** Inconsistent inclusion across existing gates; Business Review is executive governance content, arguably belongs with the other C-suite roles |
| Marketing Consultant | Unrestricted; already included in `MARKET_INTEL_ROLES` and `IMS_RX_ROLES` | Recommend: same as CEO/VP (Corporate + 4 BU) | **Open decision — confirm with Ahmed.** Section 10 (Strategic Decision Points) carries board-level commercial judgment — worth an explicit yes, not an inherited default |
| BU Manager | Restricted to one BU, all its lines | **Own BU deck only** (1 file) | `AUTH.isBuAllowed()` / `filterAllowedBUs()`, unchanged |
| Line Manager ("NSM" per Notes) | Restricted to one BU + one Line | **Own-Line deck only** (1 file) — **Phase 2**, new grain | `AUTH.isLineAllowed()`, extended to a new Line-grain summary |

Enforcement follows the pattern `auth.js` already documents for Market Intel/Sprint/Control Panel: **hidden in the nav AND refused server-... client-side if reached directly** — not CSS-hidden, so a BU Manager can never see a link to a file outside their scope, let alone open it via devtools.

---

## ACT — phased plan

**Phase 1 (ship first — no new analytics required)**

1. `etl/build_business_review.py` (new, Python + `python-pptx`) — opens `Business review.pptx` as the template, runs once per BU (CHC, Cluster, DIAB, GIT) plus once for Corporate (`ALL_BU` grain), writes `exports/business_review/<BU>.pptx`. Numbers come straight from the existing `getBusinessSummary()`/`computeHealthIndex()`/`computeCrossBURanking()` outputs; CHC's narrative slides pull from `business-review-content.js`/the pilot doc, the other three run the generic computed fallback exactly as the engine already documents — no fabricated content, no "coming soon" gap.
2. Wire it as a new step in `refresh.bat`, after `build_manifest.py`, non-fatal on failure (same convention).
3. New "Business Review" download panel in the dashboard — a static list of files, filtered through the existing `AUTH` scope helpers exactly like every other role-gated page. No new access-control code paths, just a new consumer of the existing one.
4. **Validate every generated file reopens cleanly in real PowerPoint**, not just round-trips through `python-pptx` — a broken embedded chart worksheet is a silent, ugly failure a business user has no way to fix themselves.

**Phase 2 (Line/NSM grain — the one real build item)**

5. Confirm with Ahmed whether the NSM deck is the full 22 slides or a trimmed subset (IQVIA/market-share slides 7–10 may not resolve at Line grain).
6. Build the Line-level summary aggregation (Sales/Coverage already filter by line elsewhere; this assembles those into the same `getBusinessSummary()` contract, one level finer than BU).
7. Generate one file per Line Manager's own Line, same pipeline step.

**Phase 3 (optional, later)** — only if pre-generating every deck on every refresh becomes too heavy: an on-demand local generation trigger, still `python-pptx` under the hood. Not recommended as a first move — Business Review is a periodic governance artifact, not a live view, and batch generation matches the project's offline-first philosophy.

---

## KEY RISKS

- **IQVIA slides may not resolve at Line grain** — confirm before committing to a full 22-slide NSM deck.
- **Chart re-embedding fragility** — `python-pptx` writes a real embedded worksheet per chart; every generated file needs to be opened in actual PowerPoint before it reaches an executive, not just validated by the generating script.
- **Static-site confidentiality ceiling** — `auth.js` already documents this platform's own limit: a technically sophisticated user can reach underlying cache data without signing in. Pre-generated `.pptx` files sitting in a public repo path inherit the same ceiling — fine for internal, non-adversarial use (today's reality), a real gap if this ever needs to withstand a hostile actor.
- **Stale-vs-current confusion** — two people downloading at different refresh times can end up comparing different numbers. Recommend stamping the cache build date on the deck's own Appendix slide, reusing `build_manifest.py`'s data — the same "is what I'm looking at current" question Control Panel already treats as first-class.

## LEVERAGE OPPORTUNITIES

- The `python-pptx` generator built for this is reusable infrastructure, not a one-off — the same table/chart-writing plumbing serves any future BU-grain deck (Sprint award decks, QBR packs) for close to zero marginal engineering.
- The Evidence/Confidence tagging discipline in `BUSINESS_REVIEW_FRAMEWORK.md` can now ship straight into a boardroom-quality deck instead of staying an internal methodology doc — a real differentiator versus a generic BI export.

## AUTOMATION OPPORTUNITIES

- Fully automated at `refresh.bat` time — zero manual PowerPoint touch-up per cycle once the field mapping is built once.
- Auto-stamp every deck's footer with the cache build date + a one-line confidence summary, sourced from the Control Panel's own manifest data.
- This generator is the natural delivery mechanism for the roadmap's already-flagged **Phase 5a "AI Executive Analyst"** — once that's built, it writes the narrative sections directly into these same slides rather than needing a separate integration later.

---

## RECOMMENDED NEXT ACTIONS

| # | Action | Owner | Timing |
|---|---|---|---|
| 1 | Confirm Commercial Director + Marketing Consultant inclusion in the Corporate/all-BU tier | Ahmed | Now — blocks nothing else, but should be settled before Phase 1 ships |
| 2 | Confirm NSM deck scope: full 22 slides vs. trimmed subset | Ahmed | Before Phase 2 starts |
| 3 | Build `etl/build_business_review.py` — Corporate + 4 BU decks | Dev | This cycle — **still open** |
| 4 | Add role-gated download panel, reusing existing `AUTH` scope helpers | Dev | **Shipped 2026-08-27** — template-only, see above |
| 5 | Open every generated file in real PowerPoint before first executive-facing distribution | QA | Before first send — **template file itself still needs one manual PowerPoint open** |
| 6 | Scope Phase 2 engineering estimate once #2 is answered | Dev | After Phase 1 ships |
