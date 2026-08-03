# Push to GitHub — Briefing for Antigravity

This repo has a full day+ of uncommitted work sitting locally. Nothing has
been pushed to `origin/main` yet (last commit on GitHub is `bfabc86`).
This file is a complete handoff so you can commit and push safely without
needing the earlier conversation history.

## IMPORTANT — read this before running anything

1. **Do NOT run `push_to_github.bat`.** It overwrites `.gitignore` with an
   old hardcoded version that does NOT protect `.github_token`,
   `test_credentials.json`, `Sync_Report.txt`, or the `backups/` folder.
   This already happened once today and had to be manually fixed — verify
   `.gitignore` still contains the "Credentials / tokens" and `backups/`
   sections below before pushing.
2. **Verify `.gitignore` first.** Run:
   ```
   git check-ignore -v "TO MARKET_IN MARKET/.github_token" test_credentials.json Sync_Report.txt backups/
   ```
   All four should print a match. If any come back empty, `.gitignore` has
   been reverted again (most likely by `push_to_github.bat`) — restore the
   sections below before proceeding, or the next `git add -A` will stage
   and push a live GitHub token, an admin credential file, and ~68MB of
   security/permissions cache backups to this **public** GitHub Pages repo.
3. **Use `git add -A`, not selective adds.** `.gitignore` is already
   correct for excluding `cache/`, `logs/`, `*.xlsx`, credentials, and
   scratch debug scripts — `git add -A` will correctly skip all of those
   and pick up everything else (including `refresh_sales.py`,
   `refresh_iqvia.py`, and this repo's other Python/batch scripts that
   were previously never tracked at all).

## What to run

```
cd "D:\2026\ZETA_INTEL_DASHBOARD\CoverageDashboard"
git add -A
git commit -m "Line-scoped Customer Health, dynamic SKU Penetration, exclude managers from leaderboards, real Target-per-Position, CHC mirror-image fix, BU/Line-scoped Zeta Organogram, refresh.bat fixes, credential/gitignore hardening"
git push origin main
```

After it succeeds, GitHub Pages rebuilds automatically within 1-3 minutes
at: https://ahmedabdallahsfe-ai.github.io/zeta-intel-dashboard/dashboard.html

## Untracked files you'll also be pushing (review first)

These are legitimate project files sitting untracked — `git add -A` will
pick them up. Ahmed should confirm they're meant to be public before this
push, since this is a public repo:

- `BUSINESS_REVIEW_FRAMEWORK.md`, `CHC_Pilot_Executive_Business_Review.md`,
  `CUSTOMER_ANALYTICS_ETL_SPEC.md`, `DESIGN_SYSTEM.md`,
  `EXECUTIVE_COMMAND_CENTER_V4_PROPOSAL.md`, `PLATFORM_ROADMAP.md`,
  `PROJECT_OVERVIEW_FOR_AI.md` — project documentation.
- `design-system-preview.html` — a design reference page.
- `refresh_sales.py`, `refresh_iqvia.py` — these are real, load-bearing
  ETL scripts already called by `refresh.bat`, but were never actually
  committed to the repo until now. This is a genuine gap being fixed, not
  new scope creep.

## Summary of what changed today (for the commit message / changelog)

**Dashboard-facing changes:**
- Not Seen Customers modal: added a "Visited Months" column (every month
  a customer was actually covered historically), included in Excel export.
- Market Share by Product popup: now respects the chosen Line filter
  (Line/DM1 Market/DM2 Market columns update per Line).
- Customer Health drill-down (Retail/Chain Pharmacy): Position and
  per-customer items now scope to the chosen Line, not just BU.
- Customer Health grid + CSV export: Position/SKU column headers now
  correctly label the actual chosen Line (e.g. "Position (PEDIA)")
  instead of a generic "SKU (Cluster)" label.
- Customer Health grid view: added an ETL-staleness warning banner
  (previously only shown in the summary view).
- Top SKU Penetration panel: now dynamically scopes to the chosen Line
  instead of always showing the BU-wide list.
- Top 10 / Bottom 10 leaderboards (Coverage % and RF%): fixed a real
  data-quality bug — District/Area/Brand/National Sales Managers were
  polluting these rankings (the entire old Bottom 10 by RF% was 100%
  managers, zero actual reps). Now permanently restricted to Medical
  Representative / Sales Representative titles only.
- Sales Productivity card: "Target" now shows a real Target per Position
  (assigned sales target ÷ deployed positions) instead of a peer-average
  benchmark mislabeled as target. Line-aware — recalculates for the
  chosen Line. CHC gets a special case (see below).
- Line Performance table: added a "Target per Position" column, dynamic
  with the Line filter.
- CHC mirror-image fix: CHC and CHC_SALES are confirmed mirror-image
  lines (not independent, unlike e.g. DIAB's 4 genuinely separate lines).
  CHC's BU-wide Sales Productivity now uses CHC line's own actual/target
  (not summed with CHC_SALES) divided by both lines' COMBINED planned
  headcount (31+18=49, from SFE organogram data) — per explicit
  confirmation from Ahmed, validated against real cache data.
- Zeta Organogram (SFE) page: hierarchy list, vacancy tab, and span/
  workload tab now scope to the signed-in BU/Line Manager's own BU or
  Line (previously a BU-restricted manager could see every BU's org
  data). A manager restricted to exactly one Line now auto-locks to it
  instead of defaulting to "All". Validated against real cache data
  (CHC-restricted user: 31 hierarchy rows, 9 vacant positions, 22
  workload reps — matches the known CHC headcount split exactly).
  Known remaining gap, not fixed: the tenure tab's 4 top KPI cards
  (Reps under Probation, Confirmed Reps, Avg Tenure, Ramp-up Ratio) are
  pre-aggregated as single company-wide numbers in the cache with no
  per-BU/Line breakdown available — fixing this needs an ETL change,
  not just a client-side scoping fix.

**Infrastructure fixes:**
- `refresh.bat`: added the missing Customer Analytics ETL step (its
  output was being committed but the script that generates it was never
  actually called).
- `refresh.bat`: fixed a real batch-scripting bug (stale variable
  expansion inside a parenthesized block) that made the To-Market vs
  In-Market step ALWAYS report failure and halt the script before it ever
  reached the git commit/push section — this silently blocked every
  automated push since the step was added on 2026-07-31, regardless of
  anything else in this session.
- `refresh.bat`: now runs `git add -A` after its existing cache force-adds,
  so Python/batch file changes (refresh scripts, this batch file, ETL
  scripts) actually get committed going forward instead of being silently
  skipped.
- `.gitignore`: added protection for `.github_token`, `test_credentials.json`,
  `Sync_Report.txt`, `backups/` (68MB of cached credential/permission
  snapshots), and ~40 scratch debugging scripts from past sessions.

All of the above is validated against real cache data (see inline code
comments in `js/executive.js`, `js/sales.js`, `js/analytics.js`,
`refresh.py` for specifics) but is NOT yet live — it only takes effect on
GitHub Pages once this push completes, and some of it (Line-scoping,
dynamic SKU Penetration) additionally needs the Customer Analytics ETL to
have actually run (which `refresh.bat` now does automatically).
