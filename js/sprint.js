/**
 * js/sprint.js
 * ============
 * Zeta Sprint 2026 -- monthly gamification competition standings.
 * Reads cache/sprint.data.js (window.SPRINT_CACHE), built by
 * etl/build_sprint_cache.py. Follows the same module convention as
 * js/sales.js: a self-contained IIFE exposing window.SprintDashboard =
 * { init(containerId), destroy() }, an .sc-nav-tabs / .sc-tab sub-page
 * switcher driven by STATE.subTab, and its own cache decompression.
 *
 * METHODOLOGY (see cache.meta.methodology for the machine-readable
 * version, confirmed with Ahmed 2026-08-15):
 *   - Ranking is per calendar month (cache.meta.evalPeriod), not a
 *     rolling "as of today" snapshot. Re-run etl/build_sprint_cache.py
 *     each month a new period closes.
 *   - Probation + active/resignation are both evaluated against THAT
 *     period, sourced from Database Shortcut.xlsx by employee Code.
 *   - DM/DSM shows a Team Avg rollup of its own reps (70 of 100 pts).
 *     ASM/NSM shows a Team Avg rollup of their own DM/DSMs (80 of 100 pts,
 *     per Ahmed 2026-08-15 -- matches the real org chain Rep -> DM/DSM ->
 *     ASM/NSM). Field Working Days / DV Coverage / Calls-per-DV are not
 *     computable from any existing source yet -- rendered as "Pending
 *     data feed", never silently scored as zero.
 *   - Winner badges: Medical Rep, CHC Sales Rep, and DM/DSM show BOTH
 *     🏆 WINNER (#1) and 🥈 WINNER (#2), recomputed live as you filter
 *     (Line for Medical Rep, BU for DM/DSM) -- per Ahmed 2026-08-15
 *     ("ranking number 1, 2 are winners in med rep sales rep dsm"). ASM/
 *     NSM/Brand Manager stay single-winner. DM/DSM additionally shows a
 *     separate 🎖 BU Leader per-BU top performer alongside its WINNER
 *     badges. Medical Rep's own equivalent, 🎖 Line Leader, was removed
 *     per Ahmed 2026-08-16 -- see "LINE LEADER REMOVED" below.
 *   - Period filter: June / July / August / Q3 / Oct / Nov / Total Year.
 *     Every past month is archived by the ETL (cache/sprint_history/) and
 *     loaded on demand via a dynamically-injected <script> tag -- NOT
 *     fetch(), because this dashboard is opened over file:// in
 *     production, where Chrome blocks fetch()/XHR to local files but
 *     allows <script src="local/file.js">. Q3 / Total Year are
 *     cumulative (sum multiple months) -- that summing rule hasn't been
 *     defined with Ahmed yet, so those two stay "not yet available" even
 *     once every constituent month is individually archived, rather than
 *     guessing a formula. Per Ahmed 2026-08-15 ("if I need to make
 *     months update what should be").
 *   - "⬇ Download Winners CSV" (header, next to the Period selector):
 *     exports every Monthly Sprint winner for the period currently being
 *     viewed, with Direct Manager / Direct Manager BU / Money of
 *     Recognition -- sourced from Ahmed's Recognition & Rewards deck
 *     (Monthly Sprint column) and Database Shortcut.xlsx's own org-chart
 *     columns (etl/build_sprint_cache.py step 7b). Real winner counts are
 *     2 per Line (Medical Rep / CHC Sales Rep), 2 per BU (DM/DSM), 1
 *     Corporate each (ASM / NSM) -- broader than, and not the same as, the
 *     on-screen gold/silver WINNER badges (which mark only the global
 *     top-2 across all Lines/BUs combined). Brand Manager excluded (no
 *     Monthly Sprint per the deck). Restricted to CEO/VP/BEX/Admin/SFE
 *     Manager (WINNERS_CSV_ROLES) -- see access model below.
 *   - ACCESS MODEL, per Ahmed 2026-08-15 ("how users see this page and
 *     make better page besde zeta sprint"): every other tab in this
 *     dashboard already scopes a Line/BU-restricted login (AUTH.getScope
 *     /isBuAllowed/isLineAllowed, driven by Zeta_Dashboard_User_Config.xlsx)
 *     to their own territory -- Sprint was the one page that ignored it
 *     entirely, showing the full national roster (every rep's name, every
 *     manager's cash prize) to any of the ~28 named logins, several of
 *     whom are themselves Sprint participants (Line Manager accounts whose
 *     Notes say "National/Line Sales Manager"). Now scoped the same way:
 *       - Medical Rep / CHC Sales Rep / DM/DSM / Brand Manager: filtered by
 *         BOTH bu and line (repInScope/hierarchyInScope/bmInScope) -- each
 *         has one meaningful home line.
 *       - ASM / NSM: filtered by BU ONLY (asmNsmInScope) -- their own
 *         `line` field is a majority-vote artifact across many DM/DSMs'
 *         lines, not a real home line, so line-filtering them would hide
 *         a BU's own ASM/NSM from a single-Line-restricted viewer who
 *         should still be able to see who manages their BU.
 *       - CEO/VP/BEX/Admin/SFE Manager (ALL_BU_ROLES, matching the rest of
 *         the platform) always see everything, same as an unrestricted
 *         AUTH scope.
 *     A scope banner tells a restricted viewer what they're limited to,
 *     rather than silently showing a smaller table with no explanation.
 *   - "My Zeta Sprint Standing" card (top of Overview): if the logged-in
 *     user's own employee record appears anywhere in the Sprint data
 *     (matched by email, etl/build_sprint_cache.py step 7b), shows their
 *     own tier/points/band up front instead of making them scroll a big
 *     table to find themselves -- several login accounts ARE Sprint
 *     participants (see ACCESS MODEL above). Reuses the existing member
 *     detail modal (findMemberRecord/openMemberModal) via the same
 *     .sp-member-link convention already used for team drilldowns. Hidden
 *     entirely (not shown with "No data") when the matched record has no
 *     scored totalPts yet -- per Ahmed 2026-08-15 ("remove this Your June
 *     Zeta Sprint Standing ... No data").
 *   - ACCESS MODEL, round 2, per Ahmed 2026-08-15 ("dont show zeta sprint
 *     for line managers only bu see rheir own") -- SUPERSEDED, see round 3
 *     below:
 *       - Line Manager accounts were blocked from the Sprint page entirely
 *         (SprintDashboard.canView / canViewSprintPage) -- BU Manager
 *         accounts and unrestricted roles kept access, still scoped to
 *         their own BU/Lines as above. Gated both in app.js (hides the nav
 *         entry) and here in init() (refuses to render even if the tab is
 *         reached directly), matching how renderMarketIntelTab() double-
 *         gates Total Market Intelligence.
 *   - ACCESS MODEL, round 3, per Ahmed 2026-08-16 (testing on his own Line
 *     Manager account, expected to see the page): the round-2 full block
 *     turned out to be stricter than intended -- Line Manager accounts now
 *     get the SAME treatment as BU Manager, scoped to their own BU/Lines by
 *     the ACCESS MODEL above (repInScope/hierarchyInScope/bmInScope/
 *     asmNsmInScope + the scope banner), rather than losing the page
 *     outright. canViewSprintPage() now only fails closed for a session
 *     that resolves to no user at all being impossible to reach here (the
 *     platform's single sign-in gate already ran) -- effectively always
 *     true for any signed-in role. The double-gate in app.js (hides the nav
 *     entry) and here in init() (refuses to render on a direct deep-link)
 *     stays in place as defensive infrastructure in case a future role
 *     needs a real block again -- see canViewSprintPage()'s own comment.
 *       - CHC Sales Rep is a CHC-BU-only tier (every real CHC Sales Rep has
 *         bu="CHC"), so its sub-tab is hidden outright for any viewer whose
 *         scope doesn't include the CHC BU, rather than showing an always-
 *         empty "0 eligible reps" leaderboard.
 *   - WINNER badge truth for ASM / NSM / Brand Manager, per Ahmed
 *     2026-08-15 ("asm nsm brand manager make winner flag if they are
 *     winner across the company"): these three tiers each have exactly one
 *     COMPANY-WIDE top performer (no per-Line/per-BU breakdown, unlike
 *     Medical Rep/DM-DSM) -- ASM and NSM are each a single Corporate winner
 *     in the Recognition & Rewards deck; Brand Manager has no Monthly
 *     Sprint cash tier there at all, so its WINNER badge here is
 *     recognition-only (flagged to Ahmed, not invented as a cash amount).
 *     The badge is computed from the FULL unscoped roster, never from
 *     whatever subset the current viewer's own BU/Line scope happens to
 *     show -- otherwise a BU-restricted viewer's own top-ranked person in
 *     their slice could wrongly read as WINNER when the real company-wide
 *     winner sits outside their scope. DM/DSM keeps its existing "top-2
 *     within whatever BU you're viewing" behavior (unchanged, not
 *     mentioned in this request).
 *   - RECOGNITION ELIGIBILITY FLOOR, per Ahmed 2026-08-16 ("nobody is
 *     eligible for recognition money unless they clear a minimum Sales
 *     Achievement, say 70%, regardless of how high their RF/Coverage is.
 *     Ranking stays honest and transparent; money only flows to people
 *     who actually sold something"): Medical Rep, CHC Sales Rep, and
 *     Brand Manager now each require raw Sales Achievement >=
 *     WINNER_FLOOR_ACH_PCT (70%, see the constant) to carry a 🏆/🥈
 *     WINNER badge or appear as a paid winner in the Winners CSV export.
 *     This is an ELIGIBILITY GATE layered on top of the existing scoring
 *     -- it never touches totalPts, band, or the visible #/rank column
 *     (those stay exactly as scored, so the leaderboard order itself
 *     stays "honest"). A top-ranked-but-ineligible rep simply doesn't
 *     get a badge/cash; the badge cascades down to the next row that
 *     does clear the floor (their existing rank number is unaffected --
 *     only who's marked WINNER changes), shown with a "Below 70% floor"
 *     note so it's clear why, rather than silently vanishing. A null/
 *     missing Sales Achievement (no sales data or zero target that
 *     month) fails the floor (fail-closed) -- can't confirm someone
 *     "actually sold something" without a number. DM/DSM, ASM, and NSM
 *     were not mentioned in THIS original request -- see the
 *     "MANAGER-TIER FLOOR" bullet below for their own extension of the
 *     same rule, added the same day.
 *   - LINE LEADER REMOVED, per Ahmed 2026-08-16 ("REMOVE 🎖 Line Leader
 *     FLAG"): Medical Rep no longer shows a per-Line 🎖 Line Leader badge
 *     (the top rep of each Line, independent of the company-wide/floor-
 *     gated WINNER badge). Removed outright, not hidden behind a flag --
 *     the underlying per-Line top-performer computation (lineLeaders) is
 *     deleted from renderMedicalRep(), not just its badge markup, so
 *     there's nothing dormant to accidentally re-enable. DM/DSM's
 *     analogous 🎖 BU Leader badge was NOT mentioned in THIS request and
 *     was left as-is at the time -- see "MANAGER-TIER FLOOR" below for
 *     where it was later gated too.
 *   - MANAGER-TIER FLOOR, per Ahmed 2026-08-16 ("DM DSM HAS REWARD ALSO
 *     MAKE SAME FLOOR LOGIC FOR ASM NSM IF NO BODY GET THE FLOOR IN LINE
 *     BU GET THIS ... I NEED VERY HIGHLIGHTED GAT FLOOR RULE"): extends
 *     the exact same 70% recognition floor to DM/DSM, ASM, and NSM --
 *     these tiers don't have a personal Sales Achievement %, so
 *     meetsTeamSalesFloor(r) tests r.teamSalesAchPct instead of
 *     r.achPct/bmSalesAch(r). teamSalesAchPct (etl/build_sprint_cache.py)
 *     is SUM(every eligible rep's raw sales value)/SUM(their raw sales
 *     target) across the manager's WHOLE reporting subtree, divided
 *     exactly once -- DM/DSM sums its own reps directly, ASM/NSM sums
 *     its DM/DSMs' already-team-summed val/tgt, so the ratio always
 *     traces back to raw rep-level sales no matter how many hierarchy
 *     levels up (denominator discipline: never average an average).
 *     Gates: DM/DSM's company-wide-relative 🏆 WINNER/🥈 RUNNER-UP AND
 *     its per-BU 🎖 BU Leader badge (both cascade to the next-eligible
 *     manager, same as the rep floor); ASM/NSM's single company-wide 🏆
 *     WINNER; and the Winners CSV cash row for all three tiers
 *     (computeMonthlyWinners -- DM/DSM confirmed to carry a real cash
 *     reward same as reps, ASM/NSM already had MONTHLY_CASH entries
 *     wired in the CSV before this floor existed). "No Sprinter for the
 *     month" is explicit, not incidental: if nobody in a BU (DM/DSM) or
 *     company-wide (ASM/NSM) clears 70%, that scope produces zero rows
 *     in the CSV and shows emptyWinnerCardHtml() on screen -- never a
 *     forced badge/payout on the highest scorer who still falls short.
 *     Also added floorRuleBannerHtml() -- a single bold, high-contrast
 *     banner (distinct from the smaller per-row "Below floor" note)
 *     stating the rule itself in plain language, placed at the top of
 *     all six floor-gated sections (Medical Rep, CHC Sales Rep, Brand
 *     Manager, DM/DSM, ASM, NSM), per Ahmed's explicit ask for a "very
 *     highlighted" rule.
 *   - BAND LEGEND, per Ahmed 2026-08-16 ("MAKE EXPLAINATION WHY CHAMPION
 *     PERFROMER ON TRACK BUILDING GUIDENCE"): the Champion/Performer/On
 *     Track/Building pill next to every Total score had no visible
 *     explanation anywhere -- the point thresholds only lived in this
 *     file's band() function. Added a persistent legend (bandLegendHtml)
 *     in the page chrome, below the sub-tab bar in renderLayout() --
 *     shown on EVERY sub-tab (not duplicated per-section), since the same
 *     0-100 scale and thresholds apply to all six tiers. States the
 *     ranges are fixed cutoffs, not a forced curve/quota, and gives a
 *     one-line pointer on how to move up a band.
 *   - KPI METHODOLOGY (Field Working Days / DV Coverage / Calls per DV),
 *     per Ahmed 2026-08-16 (see KPI_METHODOLOGY's own comment for the
 *     verbatim request): documents the formula behind these three DM/
 *     DSM (+ Field Working Days on ASM/NSM) KPIs -- a hover tooltip on
 *     each column header, plus a collapsed-by-default "How X is
 *     calculated" detail block per section. Still a manually-entered %
 *     in zeta sprint/Sprint_Missing_KPI_Template.xlsx (no raw double-
 *     visit log exists in any cache to compute it from) -- this is
 *     documentation of Ahmed's formula, not a new computation. The live
 *     template's own column headers were deliberately left unchanged
 *     (see the comment on KPI_METHODOLOGY) to avoid breaking
 *     load_kpi_template()'s exact-header-text column matching against
 *     Ahmed's already-filled data.
 *   - MANAGER-TIER WINNER POOL GATE, per Ahmed 2026-08-19 ("apply the
 *     winner pool eligibility gate for other layer dm sm asm nsm dm dsm
 *     average of bu ... etc"): extends the Line Average Winner Pool gate
 *     built for Medical Rep/CHC Sales Rep to DM/DSM (gated against their
 *     own BU's Average, per Ahmed's own words), ASM (gated against the
 *     national Average across every other ASM), and NSM (its own
 *     separate national peer group). REPLACES the flat 70%
 *     WINNER_FLOOR_ACH_PCT/meetsTeamSalesFloor floor for these three
 *     tiers -- same "peer-Average gate supersedes the flat floor"
 *     migration already done for Medical Rep/CHC on 2026-08-18. ALL of a
 *     record's scored KPIs (Team Avg, plus whichever of Field Working
 *     Days/DV Coverage/Calls per DV have real, non-pending data that
 *     period) must clear the peer average at once -- verified against
 *     real August data before shipping: every currently-scored DM/DSM/
 *     ASM/NSM record already has every one of its tier's KPIs filled in.
 *     Brand Manager was explicitly NOT named in this request and keeps
 *     its original WINNER_FLOOR_ACH_PCT floor unchanged. DM/DSM keeps
 *     its 2-per-BU Winner+Runner-Up shape (tie12/tie23 co-WINNER
 *     promotion, identical rule to Medical Rep/CHC's 2-per-Line); ASM/
 *     NSM keep their single company-wide WINNER, now with a rank-1
 *     points tie promoting every tied manager to co-WINNER rather than
 *     an arbitrary pick. See computeHierarchyAverages/
 *     computeHierarchyGateData/computeHierarchyWinnerPools (mirrors
 *     computeLineMedians/computeRepMedianData/computeLineWinnerPools),
 *     wired into renderHierarchyTier, hierarchyRow's new data-gate-pass
 *     attribute (read by wireRankFilter's DM BU-filter isEligible test),
 *     dmWinnersPanelHtml, and computeMonthlyWinners (CSV payout).
 */
(function () {
  "use strict";

  const REQUIRED_SCHEMA_VERSION = 8;

  // CEO/VP/BEX/Admin/SFE Manager -- same set as ALL_BU_ROLES /
  // MARKET_INTEL_ROLES in js/auth.js, kept as its own constant (not
  // aliased) per that file's own convention: today's list happens to
  // coincide, but "who sees company-wide Sprint data" and "who may
  // download real names + exact cash amounts" are different questions
  // that could diverge later.
  const WINNERS_CSV_ROLES = ["CEO", "VP", "BEX", "Admin", "SFE Manager"];

  let cache = null;          // the period currently being VIEWED
  let currentMonthCache = null; // the freshly-loaded "live" month (window.SPRINT_CACHE)
  let historyIndex = [];     // [{key:"2026-06", name:"June", file:"cache/sprint_history/..."}]
  const periodDataCache = {}; // monthName -> decompressed archive, memoized after first load
  let ready = false;

  const STATE = {
    subTab: "overview",
    lineFilter: "__ALL__",
    period: null, // set to the live month's name once the cache loads
  };

  // Period-filter definitions, per Ahmed 2026-08-15: June is the Sprint's
  // Pilot Period; July/August are the first two real months; Q3 sums
  // Jul+Aug+Sep; Oct/Nov individually; Total Year sums Q3+Oct+Nov+Dec.
  // `cumulative: true` periods sum multiple months -- see module doc above
  // for why those stay unavailable regardless of archive coverage.
  const PERIOD_DEFS = [
    { key: "June", label: "June (Pilot Period)", months: ["June"] },
    { key: "July", label: "July", months: ["July"] },
    { key: "August", label: "August", months: ["August"] },
    { key: "Q3", label: "Q3 (Jul + Aug + Sep)", months: ["July", "August", "September"], cumulative: true },
    { key: "October", label: "October", months: ["October"] },
    { key: "November", label: "November", months: ["November"] },
    { key: "TotalYear", label: "Total Year (Q3 + Oct + Nov + Dec)", months: ["July", "August", "September", "October", "November", "December"], cumulative: true },
  ];

  function monthArchived(monthName) {
    return (currentMonthCache && currentMonthCache.meta.evalPeriod === monthName) ||
      historyIndex.some(p => p.name === monthName);
  }

  function periodReady(periodKey) {
    const def = PERIOD_DEFS.find(p => p.key === periodKey);
    if (!def) return false;
    if (def.cumulative) return false; // summing rule not yet defined -- see module doc.
    return def.months.every(monthArchived);
  }

  // Loads a local script by URL and resolves once it has executed --
  // works under file:// (unlike fetch/XHR, which Chrome blocks there).
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load script: " + src));
      document.head.appendChild(s);
    });
  }

  function gunzipB64Json(b64) {
    const strData = atob(b64);
    const bytes = new Uint8Array(strData.length);
    for (let i = 0; i < strData.length; i++) bytes[i] = strData.charCodeAt(i);
    return JSON.parse(pako.ungzip(bytes, { to: "string" }));
  }

  async function loadHistoryIndex() {
    try {
      await loadScript(`cache/sprint_history/index.js?v=${Date.now()}`);
      historyIndex = window.SPRINT_HISTORY_INDEX || [];
    } catch (e) {
      console.warn("[Sprint] No history index yet (expected until the next monthly ETL re-run after this build).", e);
      historyIndex = [];
    }
  }

  // Returns the decompressed cache for a given calendar month name,
  // fetching + memoizing the archived script on first request. Returns
  // null if that month isn't archived (caller should have already
  // checked periodReady() before offering it as a selectable option).
  async function loadPeriodData(monthName) {
    if (currentMonthCache && currentMonthCache.meta.evalPeriod === monthName) return currentMonthCache;
    if (periodDataCache[monthName]) return periodDataCache[monthName];
    const entry = historyIndex.find(p => p.name === monthName);
    if (!entry) return null;
    try {
      window.SPRINT_HISTORY_CACHE = null;
      await loadScript(`${entry.file}?v=${Date.now()}`);
      if (!window.SPRINT_HISTORY_CACHE || !window.SPRINT_HISTORY_CACHE.b64Data) return null;
      const data = gunzipB64Json(window.SPRINT_HISTORY_CACHE.b64Data);
      periodDataCache[monthName] = data;
      return data;
    } catch (e) {
      console.error("[Sprint] Failed to load archived period " + monthName, e);
      return null;
    }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---- Access scope (BU/Line restriction) -----------------------------
  // Reuses the exact same window.AUTH API every other tab (Sales,
  // Coverage, Market Intel, Expense) already calls -- see module doc
  // "ACCESS MODEL" above. `window.AUTH` may be absent in a stripped-down
  // test harness; every check below fails open (treats missing AUTH as
  // unrestricted) to match how the rest of the codebase guards it
  // (`window.AUTH && !window.AUTH.isBuAllowed(...)`).
  function currentUser() {
    return (window.AUTH && window.AUTH.getValidSessionUser()) || null;
  }

  // AUTH.getValidSessionUser() returns the *user record* keyed by email in
  // IQVIA_CACHE.users -- that record itself never carries an `email` field
  // (email is the dict key, not a value), so it cannot be used to look up
  // "my own" Sprint record. The raw zeta_session object in localStorage
  // does carry {email, name, role, expires} (see auth.js's own doc comment
  // on SESSION_KEY) -- read it directly here, mirroring auth.js's own
  // getValidSessionUser() validity check (non-expired), without depending
  // on auth.js exposing a new accessor.
  function currentUserEmail() {
    try {
      var s = JSON.parse(localStorage.getItem("zeta_session") || "null");
      if (s && s.expires > Date.now() && s.email) return String(s.email).trim().toLowerCase();
    } catch (e) {}
    return null;
  }

  function currentScope() {
    if (window.AUTH) return window.AUTH.getScope();
    return { unrestricted: true, bus: null, lines: null };
  }

  function repInScope(r) {
    if (!window.AUTH) return true;
    if (r.bu && !window.AUTH.isBuAllowed(r.bu)) return false;
    if (r.canonLine && !window.AUTH.isLineAllowed(r.canonLine)) return false;
    return true;
  }

  // DM/DSM and Brand Manager each have one meaningful home line -- scoped
  // by both bu and line, same as reps.
  function dmOrBmInScope(r) {
    if (!window.AUTH) return true;
    if (r.bu && !window.AUTH.isBuAllowed(r.bu)) return false;
    if (r.line && !window.AUTH.isLineAllowed(r.line)) return false;
    return true;
  }

  // ASM/NSM: BU only -- see module doc "ACCESS MODEL" for why their own
  // `line` field (a majority-vote artifact) isn't used to restrict them
  // further.
  function asmNsmInScope(r) {
    if (!window.AUTH) return true;
    if (r.bu && !window.AUTH.isBuAllowed(r.bu)) return false;
    return true;
  }

  // Shape differs slightly from repInScope (excluded/departingSoon dict
  // entries use `line`, not `canonLine`) -- otherwise identical.
  function excludedInScope(e) {
    if (!window.AUTH) return true;
    if (e.bu && !window.AUTH.isBuAllowed(e.bu)) return false;
    if (e.line && !window.AUTH.isLineAllowed(e.line)) return false;
    return true;
  }

  function canDownloadWinnersCsv() {
    const u = currentUser();
    return !!u && WINNERS_CSV_ROLES.indexOf(u.role) >= 0;
  }

  // Sprint page visibility: round 2 (2026-08-15) blocked Line Manager
  // accounts outright; round 3 (2026-08-16, see module doc "ACCESS MODEL")
  // reopened the page to every signed-in role, relying on the ACCESS MODEL
  // above (BU/Line scoping via window.AUTH) to limit what a restricted
  // account actually sees, the same way BU Manager was always handled.
  // Kept as its own function (not simply removed / inlined `true`) so a
  // future role-level block, if one is ever needed again, has a single
  // place to land -- and so app.js's nav-hide and this file's own init()
  // double-gate keep working unchanged. Fails open (true) when there's no
  // session -- matches every other AUTH guard in this file, which all
  // assume the platform's single sign-in gate (auth.js) already ran before
  // any page renders.
  function canViewSprintPage() {
    return window.AUTH && typeof window.AUTH.canViewSprint === "function"
      ? window.AUTH.canViewSprint()
      : false;
  }

  // CHC Sales Rep is a CHC-BU-only tier -- every real CHC Sales Rep record
  // has bu="CHC" (verified against cache/sprint.json 2026-08-15). Rather
  // than showing an always-empty "0 eligible reps" leaderboard to a viewer
  // whose scope doesn't include CHC, hide the sub-tab outright.
  function canViewChcSalesRepTab() {
    const scope = currentScope();
    if (scope.unrestricted) return true;
    return !!(scope.bus && scope.bus.indexOf("CHC") >= 0);
  }

  function scopeBannerHtml() {
    const scope = currentScope();
    if (scope.unrestricted) return "";
    const parts = [];
    if (scope.bus) parts.push(`BU: ${scope.bus.map(esc).join(", ")}`);
    if (scope.lines) parts.push(`Line: ${scope.lines.map(esc).join(", ")}`);
    return `<div class="sp-scope-banner">👁 You're viewing your own scope only (${parts.join(" · ")}) -- not the full company.</div>`;
  }

  function decompressCache() {
    if (cache) return;
    try {
      const t0 = performance.now();
      cache = gunzipB64Json(window.SPRINT_CACHE.b64Data);
      currentMonthCache = cache;
      STATE.period = cache.meta.evalPeriod;
      console.log(`[Sprint] Cache loaded & decompressed in ${(performance.now() - t0).toFixed(1)}ms.`);
    } catch (e) {
      console.error("[Sprint] Failed to decompress sprint cache", e);
    }
  }

  function isCacheStale() {
    if (!window.SPRINT_CACHE) return true;
    if (!cache) return true;
    if (!cache.meta || cache.meta.schemaVersion < REQUIRED_SCHEMA_VERSION) return true;
    return false;
  }

  function renderCachePendingState() {
    const root = document.getElementById("app-root");
    if (!root) return;
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:70vh;flex-direction:column;gap:12px;color:#64748B;">
        <div style="font-size:40px;">🏁</div>
        <div style="font-size:16px;font-weight:700;color:#0F172A;">Zeta Sprint cache not found</div>
        <div style="font-size:13px;max-width:480px;text-align:center;">
          Run <code>python etl/build_sprint_cache.py</code> to generate cache/sprint.data.js before opening this tab.
        </div>
      </div>`;
  }

  // Defensive fallback only -- canViewSprintPage() is unconditional as of
  // round 3 (2026-08-16, see module doc "ACCESS MODEL"), so this path is
  // not reachable today. Left in place, matching how renderMarketIntelTab()
  // in app.js double-gates Total Market Intelligence, so a future role-
  // level block (if canViewSprintPage() is ever tightened again) has
  // somewhere to render rather than needing this scaffolding rebuilt from
  // scratch, and so hand-editing the DOM or deep-linking the tab still
  // can't bypass whatever gate exists at that time.
  function renderSprintAccessRestricted() {
    const root = document.getElementById("app-root");
    if (!root) return;
    document.body.classList.add("sprint-mode");
    root.innerHTML = window.DS
      ? `<div class="ds-page"><div style="max-width:520px;margin:80px auto;text-align:center;">${window.DS.emptyState({
          icon: "\u{1F512}",
          title: "Access restricted",
          hint: "You don't have access to Zeta Sprint 2026. Contact your administrator if you believe this is incorrect.",
        })}</div></div>`
      : "<p>Access restricted.</p>";
  }

  // ---- shared bits -------------------------------------------------
  function band(pts) {
    if (pts == null) return "Pending";
    if (pts >= 88) return "Champion";
    if (pts >= 68) return "Performer";
    if (pts >= 42) return "On Track";
    return "Building";
  }
  const BAND_COLOR = {
    Champion: ["#B45309", "#FEF3C7"],
    Performer: ["#15803D", "#DCFCE7"],
    "On Track": ["#0F4C81", "#DBEAFE"],
    Building: ["#64748B", "#F1F5F9"],
    Pending: ["#94A3B8", "#F1F5F9"],
  };

  // Per Ahmed 2026-08-16 ("MAKE EXPLAINATION WHY CHAMPION PERFROMER ON
  // TRACK BUILDING GUIDENCE"): the band pill next to every rep's Total
  // (Champion/Performer/On Track/Building) had no visible explanation
  // anywhere -- the thresholds only ever lived in this file's band()
  // function. A rep or manager seeing "Building" next to a decent-looking
  // score had no way to know what it took to move up, or that the labels
  // are fixed cutoffs (not a forced curve/quota). Fixed with a persistent
  // legend in the page chrome (see renderLayout -- shown on every sub-tab,
  // not just one section, since the same 0-100 scale and thresholds apply
  // to every tier: Medical Rep, CHC Sales Rep, DM/DSM, ASM, NSM, and Brand
  // Manager all score out of 100).
  const BAND_THRESHOLDS = [
    { name: "Champion", range: "88 – 100" },
    { name: "Performer", range: "68 – 87" },
    { name: "On Track", range: "42 – 67" },
    { name: "Building", range: "0 – 41" },
  ];

  function bandLegendHtml() {
    const chips = BAND_THRESHOLDS.map(b => {
      const c = BAND_COLOR[b.name];
      return `<span class="sp-band-chip" style="color:${c[0]};background:${c[1]};" title="Total Points ${b.range} out of 100">${esc(b.name)} <b>${esc(b.range)}</b></span>`;
    }).join("");
    const pendingC = BAND_COLOR.Pending;
    const pendingChip = `<span class="sp-band-chip sp-band-chip-pending" style="color:${pendingC[0]};background:${pendingC[1]};" title="No score yet this month -- a required KPI (e.g. Field Working Days, Region Coverage) hasn't been filled in yet, not a real zero">Pending <b>no score yet</b></span>`;
    return `<div class="sp-band-legend">
      <span class="sp-band-legend-label">Performance Bands — Total Points (0–100):</span>
      <span class="sp-band-legend-chips">${chips}${pendingChip}</span>
      <span class="sp-band-legend-note">Fixed thresholds, not a forced curve — everyone who clears 88 is a Champion, no cap on how many. Fastest way up a band: check which KPI bar below has the biggest gap to its max (e.g. Coverage, Right Freq) — Sales Achievement alone won't carry anyone past Performer if the supporting KPIs are lagging.</span>
    </div>`;
  }

  function kpiBar(label, pct, pts, maxpts, pctText) {
    if (pts == null) {
      return `<div class="sp-kpi-wrap">
        <div class="sp-kpi-label">${label} <span class="sp-kpi-pct">pending</span></div>
        <div class="sp-kpi-track"><div class="sp-kpi-fill sp-kpi-fill-pending" style="width:100%"></div></div>
        <div class="sp-kpi-pts">— / ${maxpts}</div>
      </div>`;
    }
    const pctDisp = pctText != null ? pctText : (pct != null ? pct.toFixed(1) + "%" : "—");
    const width = Math.min(100, maxpts ? (pts / maxpts * 100) : 0);
    // A genuine 0.0 pts (curves like Calls per DV only start earning above a
    // floor, e.g. 90% actual -- see dm_callsperdv_curve in the ETL) renders
    // a 0%-width fill, i.e. no color at all on top of the already-faint
    // track -- reads as a broken/empty element rather than "real value,
    // below this KPI's curve" (Ahmed 2026-08-16, "MAKE THE FONT AND COLOR
    // APPEAR"). Distinct from the diagonal-striped "pending" state above
    // (data not filled in yet) -- this is a computed, real zero. A small
    // red sliver + note makes that legible instead of blank.
    const isZeroFloor = pts === 0;
    const visualWidth = isZeroFloor ? 4 : width;
    const fillClass = isZeroFloor ? "sp-kpi-fill sp-kpi-fill-zero" : "sp-kpi-fill";
    const zeroNote = isZeroFloor ? ` <span class="sp-kpi-zero-note" title="Below this KPI's scoring curve this period -- 0 pts earned even though the raw % above may be greater than 0">below curve floor</span>` : "";
    return `<div class="sp-kpi-wrap">
        <div class="sp-kpi-label">${label} <span class="sp-kpi-pct">${pctDisp}</span></div>
        <div class="sp-kpi-track"><div class="${fillClass}" style="width:${visualWidth.toFixed(0)}%"></div></div>
        <div class="sp-kpi-pts">${pts.toFixed(1)} / ${maxpts}${zeroNote}</div>
      </div>`;
  }

  function probationBadge(r) {
    return `<span class="sp-probation-badge" title="Hired ${esc(r.hireDate)} · Passed probation ${esc(r.probationPassed)}">✓ Eligible for ${esc(cache.meta.evalPeriod)} ranking</span>`;
  }

  // ---- Overview tab --------------------------------------------------
  function renderOverview() {
    const m = cache.medicalRepSalesRep;
    const msr = m.ranked.filter(r => r.role === "Medical Rep").filter(repInScope);
    const sr = m.ranked.filter(r => r.role === "Sales Rep (CHC)").filter(repInScope);
    const champions = [...msr, ...sr].filter(r => band(r.totalPts) === "Champion").length;
    const excludedCount = m.excluded.filter(excludedInScope).length;
    const dmScored = cache.dmDsm.ranked.filter(r => r.teamSize > 0).filter(dmOrBmInScope).length;
    const asmScored = cache.asm.ranked.filter(r => r.teamSize > 0).filter(asmNsmInScope).length;
    const nsmScored = cache.nsm.ranked.filter(r => r.teamSize > 0).filter(asmNsmInScope).length;
    const bm = cache.brandManager;
    const bmScored = bm ? bm.ranked.filter(dmOrBmInScope).length : 0;

    return `
      ${scopeBannerHtml()}
      ${myPerformanceCardHtml()}
      <div class="sp-stats-row">
        <div class="sp-stat-tile sp-stat-highlight"><div class="sp-stat-label">Ranked This Month</div><div class="sp-stat-value">${msr.length + sr.length}</div></div>
        <div class="sp-stat-tile"><div class="sp-stat-label">Medical Rep</div><div class="sp-stat-value">${msr.length}</div></div>
        <div class="sp-stat-tile"><div class="sp-stat-label">CHC Sales Rep</div><div class="sp-stat-value">${sr.length}</div></div>
        <div class="sp-stat-tile"><div class="sp-stat-label">Corporate Champions</div><div class="sp-stat-value">${champions}</div></div>
        <div class="sp-stat-tile sp-stat-warn"><div class="sp-stat-label">Excluded This Month</div><div class="sp-stat-value">${excludedCount}</div></div>
      </div>

      <div class="sp-section">
        <h2>${esc(cache.meta.evalPeriod)} 2026 — Tier Status</h2>
        <div class="sp-section-sub">Ranking period ${esc(cache.meta.periodStart)} – ${esc(cache.meta.periodEnd)}. Every rep/manager below is individually confirmed past probation, active, and not resigned as of this period — sourced from Database Shortcut.xlsx by employee Code.</div>
        <table>
          <thead><tr><th>Tier</th><th>Status</th><th>Ranked / Scored</th><th>Formula this month</th></tr></thead>
          <tbody>
            <tr><td><b>Medical Rep</b></td><td><span class="sp-tag-live">LIVE</span></td><td>${msr.length}</td><td>Sales Achievement (50) + Right Frequency (40) + Coverage (10)</td></tr>
            <tr><td><b>CHC Sales Rep</b></td><td><span class="sp-tag-live">LIVE</span></td><td>${sr.length}</td><td>Sales Achievement (60) + Coverage (40, ×4-scaled curve — flagged)</td></tr>
            <tr><td><b>DM / DSM</b></td><td><span class="sp-tag-partial">PARTIAL</span></td><td>${dmScored} teams with data</td><td>Team Avg of their reps (70) live · Field Working Days (10) + DV Coverage (10) + Calls per DV (10) pending your data sheet</td></tr>
            <tr><td><b>ASM</b></td><td><span class="sp-tag-partial">PARTIAL</span></td><td>${asmScored} teams with data</td><td>Team Avg of their DM/DSMs (80) live · Field Working Days (20) pending your data sheet</td></tr>
            <tr><td><b>NSM</b></td><td><span class="sp-tag-partial">PARTIAL</span></td><td>${nsmScored} teams with data</td><td>Team Avg of their DM/DSMs (80) live · Field Working Days (20) pending your data sheet</td></tr>
            <tr><td><b>Brand Manager</b></td><td><span class="sp-tag-partial">PARTIAL</span></td><td>${bmScored} roster${bmScored === 1 ? "" : "s"} loaded</td><td>National Sales (50, auto-calculated) live · Region Coverage (20) + Tactical Plan Execution (30) pending your data sheet</td></tr>
          </tbody>
        </table>
      </div>

      <div class="sp-section">
        <h2>Eligibility Methodology</h2>
        <div class="sp-notes">
          <ul>
            <li><b>Probation:</b> ${esc(cache.meta.methodology.probationRule)}</li>
            <li><b>Active / not resigned:</b> ${esc(cache.meta.methodology.activeRule)}</li>
            <li><b>Curve sheet:</b> ${esc(cache.meta.methodology.curveSheet)} — confirmed final with Ahmed ${esc(cache.meta.methodology.confirmedWithAhmed)}.</li>
            <li><b>CHC/Sales Rep Coverage scaling:</b> ${esc(cache.meta.methodology.chcCoverageScaling)}</li>
            <li><b>ASM/NSM Team Avg:</b> averages each ASM/NSM's own DM/DSMs' total points (not individual reps directly) — matches the real org chain Rep → DM/DSM → ASM/NSM.</li>
            <li><b>Period filter:</b> June is the Sprint's Pilot Period. Currently archived: ${[...new Set([...(currentMonthCache ? [currentMonthCache.meta.evalPeriod] : []), ...historyIndex.map(p => p.name)])].map(esc).join(", ")}. Each month you update stays viewable going forward — nothing gets overwritten. Q3 and Total Year additionally need their cross-month summing rule defined with Ahmed before they unlock.</li>
          </ul>
        </div>
      </div>
    `;
  }

  // ---- Medical Rep / Sales Rep tab -----------------------------------
  function departingBadge(r) {
    if (!r.isDepartingSoon) return "";
    return `<span class="sp-departing-badge" title="Resignation on file, last day ${esc(r.departingLastDay)} -- still counted this month">⚠ Departing ${esc(r.departingLastDay)}</span>`;
  }

  // ---- Recognition eligibility floor (Medical Rep / CHC Sales Rep /
  // Brand Manager only) -- see the module docblock's "RECOGNITION
  // ELIGIBILITY FLOOR" entry for the full rationale. Gates the WINNER
  // badge and the Winners CSV cash payout ONLY -- never the scoring,
  // totalPts, band, or the visible #/rank column, which all stay exactly
  // as computed today.
  const WINNER_FLOOR_ACH_PCT = 0.70;

  function meetsSalesFloor(achPct) {
    return achPct != null && achPct >= WINNER_FLOOR_ACH_PCT;
  }

  function floorNote() {
    return ` · <span class="sp-floor-note" title="Sales Achievement is below the ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% recognition floor -- not eligible for the WINNER badge or Monthly Sprint cash this month, regardless of rank or other KPIs">Below ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% floor</span>`;
  }

  // ---- Winner Page eligibility -- LINE MEDIAN RULE (Medical Rep + CHC
  // Sales Rep) -- Per Ahmed 2026-08-18, extended 2026-08-18 to CHC Sales
  // Rep. Winner Page eligibility is no longer gated by WINNER_FLOOR_ACH_PCT
  // (the 70% floor). It is gated ONLY by comparison to the rep's own
  // Line median -- Medical Rep across all three KPIs (Sales Achievement,
  // Coverage and Right Frequency must each be >= that Line's own median,
  // all three at once). The 70%/60%/90% absolute floors are NOT touched or
  // removed -- they stay exactly as-is inside the Points Calculation
  // formula only (salesPts/covPts/rfPts, computed upstream in
  // etl/build_sprint_cache.py -- the calculation engine itself is not
  // altered here). Being below an absolute floor must NOT by itself make
  // a rep Winner Page ineligible if they still clear their applicable Line
  // Median comparisons.
  // REVERSED 2026-08-19 ("CHC Sales Rep remove right frequency from sales
  // sprint"): CHC Sales Rep is now gated on Sales Achievement AND Coverage
  // ONLY -- Right Frequency no longer gates CHC eligibility either, on top
  // of already not scoring CHC points (confirmed against the deck,
  // Zeta_Sprint_2026_Complete.pptx slide 6: CHC's model is Sales 60 +
  // Coverage 40 = 100, no Right Freq component at all). This supersedes
  // the 2026-08-18 instruction ("apply also for chc rep") that used to make
  // the same 3-KPI gate apply to CHC too "even though it scores no points" --
  // eligibility and scoring are no longer deliberately independent for CHC;
  // both now match the deck's 2-KPI model. Medical Rep is completely
  // unaffected -- still the full 3-KPI (Sales/RF/Coverage) gate below.
  // Scope: Medical Rep and CHC Sales Rep only (renderMedicalRep/repRow/
  // the "msr" wireRankFilter call, and renderSalesRep/salesRepRow). DM/
  // DSM, ASM, NSM and Brand Manager are untouched and still use
  // WINNER_FLOOR_ACH_PCT / meetsSalesFloor / floorRuleBannerHtml exactly
  // as before -- out of scope, not covered by Ahmed's Line Median spec
  // (different KPI/team-rollup structure, no per-Line grouping).
  function median(nums) {
    const vals = (nums || []).filter(n => n != null && !isNaN(n)).slice().sort((a, b) => a - b);
    if (!vals.length) return null;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  // ADDED 2026-08-19 ("i need to see median and average to cmpare 2
  // scenario" -- Ahmed confirmed: Median-gate vs Average-gate). Simple
  // arithmetic mean, same null/NaN filtering as median() above, so the two
  // are always computed from the identical input set.
  function average(nums) {
    const vals = (nums || []).filter(n => n != null && !isNaN(n));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  // { [canonLine]: { salesMedian, coverageMedian, rfMedian, salesAverage,
  // coverageAverage, rfAverage } }, one entry per Line, computed from
  // every enrolled rep currently in scope. Shared by both Medical Rep
  // (many Lines, e.g. Derma/GIT/CVM...) and CHC Sales Rep (a single Line,
  // "CHC_SALES", so this just returns one entry for them). NOT filtered
  // down to whichever Line an on-screen dropdown currently shows, so a
  // rep is always compared against their own full Line, not whatever
  // subset happens to be visible.
  // EXTENDED 2026-08-19: added the *Average fields alongside the existing
  // *Median fields (Ahmed: "i need to see median and average to cmpare 2
  // scenario", confirmed as "Median-gate vs Average-gate" -- he wants both
  // statistics displayed side by side so he can compare who'd be Winner
  // Pool eligible under a Median-based gate (the current, unchanged, live
  // rule) versus an Average-based gate, before deciding whether to ever
  // switch the actual rule. The live eligibility gate in
  // computeRepMedianData/computeLineWinnerPools still uses ONLY the
  // Median fields -- Average is display/comparison-only until Ahmed
  // explicitly says to switch the rule itself.
  function computeLineMedians(reps) {
    const byLine = {};
    (reps || []).forEach(r => {
      const key = r.canonLine || "—";
      if (!byLine[key]) byLine[key] = { sales: [], coverage: [], rf: [] };
      byLine[key].sales.push(r.achPct);
      byLine[key].coverage.push(r.coveragePct);
      byLine[key].rf.push(r.rightFreqPct);
    });
    const out = {};
    Object.keys(byLine).forEach(line => {
      out[line] = {
        salesMedian: median(byLine[line].sales),
        coverageMedian: median(byLine[line].coverage),
        rfMedian: median(byLine[line].rf),
        salesAverage: average(byLine[line].sales),
        coverageAverage: average(byLine[line].coverage),
        rfAverage: average(byLine[line].rf),
      };
    });
    return out;
  }

  // Set by renderMedicalRep() on every render; read by the msr
  // wireRankFilter isEligible callback and by the Line Median display
  // panel. Module-level (not a function param) because wireRankFilter's
  // isEligible callback only ever receives the row's rendered <tr>, never
  // the original rep object -- same constraint WINNER_FLOOR_ACH_PCT's
  // meetsSalesFloor already lives with. CHC Sales Rep doesn't need an
  // equivalent module-level variable -- renderSalesRep() computes and
  // uses its own `medians` locally, synchronously, with no filter/event
  // to recompute for (CHC Sales Rep is a single Line, no dropdown).
  let msrLineMedians = {};
  // Set by renderMedicalRep() on every render, alongside msrLineMedians --
  // the Line -> lineSummary map from computeLineWinnerPools(), read by
  // wireLineFilter's change listener (msrSummaryPanelHtml) via O(1) key
  // lookup on every Line filter change. Per Ahmed 2026-08-18 section 12:
  // winner/runner-up/near-winner status is intrinsic to each rep's own
  // Line, never recomputed from whatever rows happen to be visible.
  let msrLineSummary = {};
  // Set by renderHierarchyTier() on every DM/DSM render -- the BU ->
  // { teamAvg, [kpiKey]: avg } map from computeHierarchyAverages(), read
  // by init()'s DM BU-filter change listener (hierarchyAveragesPanelHtml)
  // via O(1) key lookup, same module-level pattern as msrLineMedians
  // above. Added 2026-08-19 ("make charts and illustration like [you]
  // made in medical rep").
  let dmGroupAverages = {};

  // Shared comparison core -- one rep's three raw values against one
  // Line's three medians. Returns which of the three passed individually
  // (so callers can say exactly which KPI(s) are holding a rep back) plus
  // the combined allOk.
  // NOTE: this pair (lineMedianGateResult/meetsLineMedianGate) is UNUSED
  // dead code as of 2026-08-19 -- superseded by computeRepMedianData /
  // computeLineWinnerPools above, which is the actual source of truth for
  // Winner Pool eligibility (and is role-aware: CHC Sales Rep no longer
  // includes Right Freq in its gate, see isChcSales there). Left in place
  // rather than deleted (out of scope for this fix), but NOT updated to
  // match -- do not wire this back up without also making it role-aware,
  // or CHC would silently regain the Right Freq gate this fix removed.
  // DOUBLY STALE as of 2026-08-19 ("ok make winner pool gate according to
  // average instead of median"): this pair also still compares against
  // each Line's MEDIAN. The live gate is Line AVERAGE now -- do not wire
  // this back up without updating that too.
  function lineMedianGateResult(achPct, coveragePct, rightFreqPct, m) {
    const salesOk = achPct != null && m && m.salesMedian != null && achPct >= m.salesMedian;
    const covOk = coveragePct != null && m && m.coverageMedian != null && coveragePct >= m.coverageMedian;
    const rfOk = rightFreqPct != null && m && m.rfMedian != null && rightFreqPct >= m.rfMedian;
    return { salesOk, covOk, rfOk, allOk: salesOk && covOk && rfOk };
  }

  // Rep-object version -- used where the rep record itself is already in
  // hand (e.g. CHC Sales Rep's eligibleSorted filter, computed once at
  // render time, not from a <tr>).
  function meetsLineMedianGate(r, lineMediansLookup) {
    const m = lineMediansLookup[r.canonLine || "—"];
    return lineMedianGateResult(r.achPct, r.coveragePct, r.rightFreqPct, m).allOk;
  }

  // =====================================================================
  // FULL WINNER PAGE / PERFORMANCE SCALING MODEL -- per Ahmed 2026-08-18
  // "ZETA SPRINT 2026 -- FULL WINNER PAGE / PERFORMANCE SCALING
  // IMPLEMENTATION". Three separate layers, deliberately never mixed:
  //   Layer 1 -- LINE MEDIAN -> Winner Pool eligibility (this section)
  //   Layer 2 -- absolute floors (WINNER_FLOOR_ACH_PCT etc.) -> Points
  //              calculation ONLY, already computed upstream in
  //              etl/build_sprint_cache.py (salesPts/rfPts/covPts) --
  //              read here for DISPLAY only, never recomputed
  //   Layer 3 -- Total Points -> ranking INSIDE the Winner Pool only
  // computeRepMedianData() + computeLineWinnerPools() below produce ONE
  // derived object per rep (the exact field list Ahmed specified) that
  // every UI piece (row, summary cards, banner, manager audit view)
  // reads from -- no calculation is duplicated in more than one place.
  // =====================================================================

  // Display-only floor reference for the "How were points calculated?"
  // breakdown (section 5) -- same constants as WINNER_FLOOR_ACH_PCT
  // (Sales) plus RF/Coverage, in each field's own native scale (Sales as
  // a fraction like achPct; RF/Coverage as already-percent numbers like
  // rightFreqPct/coveragePct). Used ONLY to label "Above/Below Floor" next
  // to the engine's own salesPts/rfPts/covPts -- never to recompute them.
  const KPI_FLOOR_DISPLAY = { sales: WINNER_FLOOR_ACH_PCT, rf: 60, coverage: 90 };

  // Recognition tiers, per Ahmed's exact 6-tier list. A 7th, non-scored
  // "DATA_ISSUE" flag is added beyond that list solely to satisfy section
  // 15's "missing KPI -> flag the rep/data issue, never silently treat as
  // zero" requirement -- it is a data-quality flag, not a performance
  // judgment, so it doesn't compete with the 6 performance tiers.
  const RECOGNITION_TIER = {
    WINNER: { label: "🏆 WINNER", cls: "sp-tier-winner" },
    // Label changed "🥈 RUNNER-UP" -> "🏆 WINNER 2" per Ahmed 2026-08-19
    // ("RUNNER-UP in medical rep and chc sales change to Winner 2") --
    // mirrors the same relabel already applied to DM/DSM's #2 slot: #2 in
    // the Winner Pool is a co-equal Winner, not a lesser rank. Internal
    // key/cls (RUNNER_UP / sp-tier-runnerup) left unchanged -- only the
    // displayed label text changes.
    RUNNER_UP: { label: "🏆 WINNER 2", cls: "sp-tier-runnerup" },
    NEAR_WINNER: { label: "🥈 NEAR WINNER", cls: "sp-tier-nearwinner" },
    STRONG: { label: "🟢 STRONG PERFORMER", cls: "sp-tier-strong" },
    DEVELOPING: { label: "🔵 DEVELOPING", cls: "sp-tier-developing" },
    BUILDING: { label: "⚪ BUILDING", cls: "sp-tier-building" },
    DATA_ISSUE: { label: "⚠ INCOMPLETE DATA", cls: "sp-tier-dataissue" },
  };

  // Among reps clearing ZERO of the 3 Line Medians (the population
  // DEVELOPING/BUILDING applies to -- STRONG PERFORMER already claims
  // everyone who clears exactly 1), this splits Developing from Building.
  // NOT an arbitrary round number -- calibrated 2026-08-18 by simulating
  // avg-of-3 %-of-median across every real Medical Rep + CHC Sales Rep
  // Line (532 reps): the zero-median-pass subgroup (n=105) has p25=78.1%,
  // median=85.0%, max=97.3%. 60% sits below its p10, isolating a real
  // bottom tail (6/105 reps under it) as "materially below" (section
  // 3.6) rather than splitting the bulk of a tightly-clustered group.
  // Full distribution reported in the implementation report -- revisit
  // with Ahmed if the tail size should be larger/smaller.
  const ZERO_PASS_DEVELOPING_MIN_AVG_VS_MEDIAN = 60;

  function vsMedianPct(val, med) {
    if (val == null || med == null || med === 0) return null;
    return val / med * 100;
  }

  // One rep's full Layer 1/2 derived record -- everything EXCEPT
  // winnerPoolRank/recognitionTier/finalRecognition/tie, which need the
  // whole Line's pool ranked together (see computeLineWinnerPools).
  //
  // SWITCHED 2026-08-19 ("ok make winner pool gate according to average
  // instead of median"): the LIVE Winner Pool eligibility gate (Layer 1)
  // now compares each Rep to their Line's AVERAGE, not their Line's
  // Median. This directly supersedes the 2026-08-18 "Line Median Rule".
  // Both statistics are still fully computed on every rep (the Median-
  // side fields -- salesVsMedian/rfVsMedian/coverageVsMedian/
  // salesMedianPass/rfMedianPass/coverageMedianPass/medianPassCount/
  // winnerPoolEligibleUnderMedian -- are kept, now purely as the
  // "what would it have been under the old rule" reference used by
  // scenarioCompareHtml()), but every field that ACTUALLY drives
  // eligibility/ranking/tiering/CSV payout (winnerPoolEligible,
  // gatePassCount, avgVsGate, isNearWinner, and by extension every KPI
  // block on screen -- see repRow/salesRepRow's kpiMedianBlock calls,
  // updated to pass the Average fields as the primary baseline) is now
  // Average-based. Verified against real data before this switch (see
  // the delivery report) -- this is a live rule change, not a display
  // toggle, and it changes who is Winner/Runner-Up and who gets paid.
  function computeRepMedianData(r, lineMediansLookup) {
    const m = lineMediansLookup[r.canonLine || "—"] || {};
    // FIXED 2026-08-19 ("CHC Sales Rep remove right frequency from sales
    // sprint"): CHC Sales Rep has no Right Frequency KPI at all per the
    // deck (Sales 60 + Coverage 40 = 100) -- Right Freq must not gate its
    // Winner Pool eligibility, count toward its pass tally, or factor
    // into its avg-vs-gate/near-winner math either. Medical Rep is
    // untouched -- still the full 3-KPI (Sales/RF/Coverage) gate.
    const isChcSales = r.role === "Sales Rep (CHC)";
    // Section 15 "Missing KPI": a null raw value is flagged, never
    // silently treated as 0 (0 would make it fail every comparison for
    // the wrong reason -- "no data" != "zero performance").
    const dataIssue = r.achPct == null || r.coveragePct == null || (!isChcSales && r.rightFreqPct == null);

    // ---- Reference-only: vs Line MEDIAN (the OLD, superseded rule) -----
    const salesVsMedian = vsMedianPct(r.achPct, m.salesMedian);
    const rfVsMedian = vsMedianPct(r.rightFreqPct, m.rfMedian);
    const coverageVsMedian = vsMedianPct(r.coveragePct, m.coverageMedian);
    const salesMedianPass = !dataIssue && r.achPct != null && m.salesMedian != null && r.achPct >= m.salesMedian;
    const rfMedianPass = !dataIssue && r.rightFreqPct != null && m.rfMedian != null && r.rightFreqPct >= m.rfMedian;
    const coverageMedianPass = !dataIssue && r.coveragePct != null && m.coverageMedian != null && r.coveragePct >= m.coverageMedian;
    const medianPassCount = isChcSales
      ? [salesMedianPass, coverageMedianPass].filter(Boolean).length
      : [salesMedianPass, rfMedianPass, coverageMedianPass].filter(Boolean).length;
    const winnerPoolEligibleUnderMedian = isChcSales
      ? (!dataIssue && salesMedianPass && coverageMedianPass)
      : (!dataIssue && salesMedianPass && rfMedianPass && coverageMedianPass);

    // ---- LIVE: vs Line AVERAGE (the rule that actually gates the pool) -
    const salesVsAverage = vsMedianPct(r.achPct, m.salesAverage);
    const rfVsAverage = vsMedianPct(r.rightFreqPct, m.rfAverage);
    const coverageVsAverage = vsMedianPct(r.coveragePct, m.coverageAverage);
    const salesAveragePass = !dataIssue && r.achPct != null && m.salesAverage != null && r.achPct >= m.salesAverage;
    const rfAveragePass = !dataIssue && r.rightFreqPct != null && m.rfAverage != null && r.rightFreqPct >= m.rfAverage;
    const coverageAveragePass = !dataIssue && r.coveragePct != null && m.coverageAverage != null && r.coveragePct >= m.coverageAverage;
    const gatePassCount = isChcSales
      ? [salesAveragePass, coverageAveragePass].filter(Boolean).length
      : [salesAveragePass, rfAveragePass, coverageAveragePass].filter(Boolean).length;
    // Layer 1 -- THE ONLY Winner Pool eligibility gate. Deliberately does
    // NOT reference WINNER_FLOOR_ACH_PCT or any absolute floor anywhere
    // in this line. CHC Sales Rep: Sales + Coverage only (rfAveragePass
    // deliberately excluded, see isChcSales comment above).
    const winnerPoolEligible = isChcSales
      ? (!dataIssue && salesAveragePass && coverageAveragePass)
      : (!dataIssue && salesAveragePass && rfAveragePass && coverageAveragePass);
    const vsList = (isChcSales ? [salesVsAverage, coverageVsAverage] : [salesVsAverage, rfVsAverage, coverageVsAverage]).filter(v => v != null);
    const avgVsGate = vsList.length ? vsList.reduce((a, b) => a + b, 0) / vsList.length : null;
    // KEPT ON MEDIAN 2026-08-19 ("ok make winner pool gate according to
    // average instead of median"): unlike avgVsGate above (now Average-
    // based, driving the live eligibility gate), this one deliberately
    // stays computed against the Line MEDIAN. It exists solely to feed
    // the DEVELOPING/BUILDING split just below (ZERO_PASS_DEVELOPING_MIN_
    // AVG_VS_MEDIAN = 60, see its own doc comment) -- a threshold Ahmed
    // had statistically calibrated 2026-08-18 against the real "% of
    // MEDIAN" distribution across all 532 reps (p25/median/p10 of that
    // specific zero-pass subgroup). Silently feeding it Average-based
    // percentages instead would shift the same zero reps to different
    // %-of-baseline values without the threshold being re-validated for
    // that distribution -- so this one stat intentionally did NOT move
    // with the gate switch. Flagged as a decision, not a bug: revisit
    // with Ahmed if he wants Developing/Building re-calibrated to Average
    // too.
    const medianVsList = (isChcSales ? [salesVsMedian, coverageVsMedian] : [salesVsMedian, rfVsMedian, coverageVsMedian]).filter(v => v != null);
    const avgVsMedian = medianVsList.length ? medianVsList.reduce((a, b) => a + b, 0) / medianVsList.length : null;
    const failingVs = (isChcSales
      ? [[salesAveragePass, salesVsAverage], [coverageAveragePass, coverageVsAverage]]
      : [[salesAveragePass, salesVsAverage], [rfAveragePass, rfVsAverage], [coverageAveragePass, coverageVsAverage]])
      .filter(([ok]) => !ok).map(([, v]) => v).filter(v => v != null);
    // Section 3.3 "Near Winner", generalized from Ahmed's worked example
    // (Mohamed AbdelHares has TWO missing KPIs, both >=95% of gate --
    // the literal spec text only names "the missing KPI", singular, so
    // this treats it as "every failing KPI is within 95%", which matches
    // his example exactly; see the report's interpretation notes).
    const nearByClose = !winnerPoolEligible && failingVs.length > 0 && failingVs.every(v => v >= 95);
    const isNearWinner = !dataIssue && !winnerPoolEligible && (gatePassCount >= 2 || nearByClose);

    // Layer 2 -- read the EXISTING engine's own points verbatim, never
    // recomputed here (section 5's explicit requirement).
    // FIXED 2026-08-19 (Ahmed flagged Adel AbdelAzim ElSayed AbdelAziz
    // Asfour, code 1262, CVM-I: salesVal=0 AND salesTgt=0 this period, so
    // achPct is correctly null upstream -- but this used to fall through
    // "!= null && ..." to `false`, which downstream renderers treat
    // exactly like "confirmed below floor". His row showed "✗ Below Sales
    // Floor" even though there is no Sales data at all to judge -- a
    // false negative, not a true one. null now stays null all the way
    // through so kpiMedianBlock/pointsCalcDetailsHtml can render "No
    // Data" instead of silently implying underperformance.
    const salesFloorPass = r.achPct == null ? null : r.achPct >= KPI_FLOOR_DISPLAY.sales;
    const rfFloorPass = r.rightFreqPct == null ? null : r.rightFreqPct >= KPI_FLOOR_DISPLAY.rf;
    const coverageFloorPass = r.coveragePct == null ? null : r.coveragePct >= KPI_FLOOR_DISPLAY.coverage;

    return {
      lineMedianSales: m.salesMedian, lineMedianRF: m.rfMedian, lineMedianCoverage: m.coverageMedian,
      lineAverageSales: m.salesAverage, lineAverageRF: m.rfAverage, lineAverageCoverage: m.coverageAverage,
      salesVsMedian, rfVsMedian, coverageVsMedian,
      salesVsAverage, rfVsAverage, coverageVsAverage,
      salesMedianPass, rfMedianPass, coverageMedianPass, medianPassCount, winnerPoolEligibleUnderMedian,
      salesAveragePass, rfAveragePass, coverageAveragePass, gatePassCount,
      winnerPoolEligible, dataIssue, avgVsGate, avgVsMedian, isNearWinner,
      salesFloorPass, rfFloorPass, coverageFloorPass,
      salesPoints: r.salesPts, rfPoints: r.rfPts, coveragePoints: r.covPts, totalPoints: r.totalPts,
      // Filled in by computeLineWinnerPools() once the whole Line is ranked:
      winnerPoolRank: null, recognitionTier: null, finalRecognition: null, tie: false,
    };
  }

  // Groups reps by their OWN Line, ranks each Line's Winner Pool by Total
  // Points independently (section 2.4/12: ranking is always within one
  // Line's own pool, never company-wide, never mixed with a non-eligible
  // rep's higher points -- see section 15 CNS/Derma validation), and
  // assigns every rep's recognitionTier/finalRecognition. Returns
  // { derivedByCode: {code -> derived}, lineSummary: {line -> {...}} }.
  // Called ONCE per render (Medical Rep and CHC Sales Rep each call this
  // themselves with their own roster) -- every UI element then just reads
  // from the result, per section 14 "single derived data object" rule.
  function computeLineWinnerPools(reps, lineMediansLookup) {
    const byLine = {};
    reps.forEach(r => { (byLine[r.canonLine || "—"] = byLine[r.canonLine || "—"] || []).push(r); });
    const derivedByCode = {};
    const lineSummary = {};
    Object.keys(byLine).forEach(line => {
      const entries = byLine[line].map(r => ({ r, d: computeRepMedianData(r, lineMediansLookup) }));
      // Section 2.4: rank ONLY the Winner Pool (3/3 qualified), by Total
      // Points, highest first.
      const pool = entries.filter(x => x.d.winnerPoolEligible).sort((a, b) => b.d.totalPoints - a.d.totalPoints);
      pool.forEach((x, i) => { x.d.winnerPoolRank = i + 1; });
      // Section 15 "Tie in Total Points": flag rather than invent a
      // hidden tie-breaker -- no approved tie-breaker exists in the
      // current engine. FIXED 2026-08-18 (Ahmed screenshot: DIAB-I's Doha
      // showed "⚠ TIE" as WINNER but Rahma -- tied with her at the exact
      // same 100.0 pts, one rank down -- showed plain RUNNER-UP with no
      // tie flag at all). tie12 is the ambiguous-#1 case (whoever sorted
      // first arbitrarily got the gold) and must flag BOTH #1 and #2, not
      // only #1. tie23 is the separate, lower-stakes case where #2 is
      // itself tied with #3 (#3 gets no badge either way, but #2's own
      // "Runner-Up" standing is still contested) -- kept as its own check
      // so a #1/#2 tie and a #2/#3 tie are never conflated.
      const tie12 = pool.length > 1 && pool[0].d.totalPoints === pool[1].d.totalPoints;
      const tie23 = pool.length > 2 && pool[1].d.totalPoints === pool[2].d.totalPoints;
      const tieAtRank1 = tie12;
      const tieAtRank2 = tie12 || tie23;
      entries.forEach(({ r, d }) => {
        if (d.winnerPoolEligible) {
          if (d.winnerPoolRank === 1) { d.recognitionTier = "WINNER"; d.tie = tieAtRank1; }
          else if (d.winnerPoolRank === 2) {
            // Per Ahmed 2026-08-18 ("RUNNER-UP change to Winner"): when #1
            // and #2 are tied on Total Points (the DIAB-I Doha/Rahma case),
            // there's no principled basis to crown one Winner and demote
            // the other to Runner-Up -- whoever happened to sort first is
            // arbitrary. Both are recognized as co-🏆 WINNER instead, tie
            // flag still on so it's clear why there are two. A #2/#3 tie
            // (tie23, no #1 involved) still leaves #2 as a normal
            // Runner-Up -- only an ambiguous #1 promotes #2.
            if (tie12) { d.recognitionTier = "WINNER"; d.tie = true; }
            else { d.recognitionTier = "RUNNER_UP"; d.tie = tieAtRank2; }
          }
          // Winner Pool members ranked #3+ aren't given a dedicated tier
          // name in Ahmed's 6-tier list -- reusing STRONG PERFORMER for
          // them (flagged as an explicit interpretation decision in the
          // report) since they demonstrably clear all 3 Line Medians,
          // the strongest possible standing short of #1/#2. Their
          // winnerPoolRank field (always shown) is what actually
          // distinguishes them from a non-pool Strong Performer.
          else { d.recognitionTier = "STRONG"; }
        } else if (d.dataIssue) {
          d.recognitionTier = "DATA_ISSUE";
        } else if (d.isNearWinner) {
          d.recognitionTier = "NEAR_WINNER";
        } else if (d.gatePassCount === 1) {
          d.recognitionTier = "STRONG";
        } else if (d.avgVsMedian != null && d.avgVsMedian >= ZERO_PASS_DEVELOPING_MIN_AVG_VS_MEDIAN) {
          d.recognitionTier = "DEVELOPING";
        } else {
          d.recognitionTier = "BUILDING";
        }
        d.finalRecognition = RECOGNITION_TIER[d.recognitionTier].label;
        derivedByCode[r.code] = d;
      });
      const nearWinners = entries.filter(x => x.d.recognitionTier === "NEAR_WINNER").sort((a, b) => b.d.totalPoints - a.d.totalPoints);
      // SWITCHED 2026-08-19 ("ok make winner pool gate according to
      // average instead of median"): the live pool above (`pool`) is now
      // Average-gated. This second pool is the OLD Median-gate, kept
      // purely as a "what it would have been under the previous rule"
      // reference -- computed the same way (ranked by Total Points,
      // highest first) but filtered on winnerPoolEligibleUnderMedian.
      // Does NOT feed recognitionTier/badges/CSV payout anywhere -- exists
      // purely so scenarioCompareHtml() can show Ahmed, Line by Line,
      // exactly who the Winner/Runner-Up/pool would have been under the
      // old Median rule, and which reps flipped when the switch happened.
      const poolUnderMedian = entries.filter(x => x.d.winnerPoolEligibleUnderMedian).sort((a, b) => b.d.totalPoints - a.d.totalPoints);
      const flippedIn = entries.filter(x => x.d.winnerPoolEligible && !x.d.winnerPoolEligibleUnderMedian);
      const flippedOut = entries.filter(x => !x.d.winnerPoolEligible && x.d.winnerPoolEligibleUnderMedian);
      lineSummary[line] = {
        medians: lineMediansLookup[line] || {},
        winner: pool[0] || null,
        runnerUp: pool[1] || null,
        poolRest: pool.slice(2),
        poolSize: pool.length,
        nearWinners,
        noWinnerThisCycle: pool.length === 0,
        tieAtRank1, tieAtRank2,
        // coWinner: #2 (still exposed as `runnerUp` for callers that keep
        // their own slot names) is actually a tied co-WINNER, not a true
        // Runner-Up -- see the tie12 comment above. UI pieces below read
        // this to relabel that card/row/table-cell as WINNER instead.
        coWinner: tie12,
        // Average-gate (live) vs Median-gate (previous rule) scenario
        // compare (display-only, see comment above):
        winnerUnderMedian: poolUnderMedian[0] || null,
        runnerUpUnderMedian: poolUnderMedian[1] || null,
        poolSizeUnderMedian: poolUnderMedian.length,
        flippedIn, flippedOut,
      };
    });
    return { derivedByCode, lineSummary };
  }

  // =====================================================================
  // MANAGER-TIER WINNER POOL GATE -- added 2026-08-19 ("apply the winner
  // pool eligibility gate for other layer dm sm asm nsm dm dsm average of
  // bu ... etc"). Extends the exact same peer-average eligibility model
  // built for Medical Rep / CHC Sales Rep above to the three manager
  // tiers, using each tier's own natural peer group instead of "Line":
  //   - DM/DSM -> peer group = DM/DSMs sharing the same BU (Ahmed's own
  //     words: "dm dsm average of bu"). Matches the existing BU-scoped
  //     winner/BU Leader model and the deck's "2 PER BU" Recognition
  //     Structure -- same 2-per-group, tie-promotes-to-co-WINNER shape as
  //     Medical Rep/CHC Sales Rep's 2-per-Line.
  //   - ASM -> peer group = every scored ASM nationally. ASM has no BU
  //     breakdown for winner purposes -- it's already a single company-
  //     wide winner per the existing "WINNER badge truth" rule above and
  //     the deck's "1 PER Corp." -- so its peer group is every other ASM,
  //     gated the same all-KPIs-at-once way, with only 1 winner slot
  //     (co-WINNER on a rank-1 points tie, no Runner-Up concept).
  //   - NSM -> same reasoning as ASM, its own separate national peer
  //     group (never mixed with ASM's).
  // REPLACES the flat WINNER_FLOOR_ACH_PCT / meetsTeamSalesFloor gate for
  // these three tiers, mirroring exactly how the Line Average gate
  // replaced WINNER_FLOOR_ACH_PCT for Medical Rep/CHC on 2026-08-18/19
  // (see "Winner Page eligibility -- LINE MEDIAN RULE" above). Brand
  // Manager was NOT named in this original request and kept
  // WINNER_FLOOR_ACH_PCT unchanged at the time -- UPDATE 2026-08-19
  // ("apply qualyfying average rule to bm"): Ahmed extended the same
  // gate to Brand Manager too, see renderBrandManager. Brand Manager's
  // peer group is a single national "__ALL__" group like ASM/NSM
  // (winnerSlots=1, no Runner-Up/Winner 2 concept), but its scopeFn is
  // `() => true` rather than `r.teamSize > 0` -- Brand Manager has no
  // team rollup at all (individual KPIs only), see computeHierarchyAverages/
  // computeHierarchyWinnerPools's scopeFn parameter.
  // Gated KPIs per tier = every KPI that actually HAS real (non-null)
  // data for that record this period -- Team Avg plus whichever of Field
  // Working Days / DV Coverage / Calls per DV are populated for DM/DSM;
  // Team Avg plus Field Working Days for ASM/NSM. Verified against real
  // August cache data before shipping this: every currently-scored DM/
  // DSM/ASM/NSM record already has all of its tier's KPIs filled in (no
  // pending slots today), so the gate is fully live from day one -- a
  // record with NO comparable KPI at all (should a brand-new team appear
  // with nothing computed yet) is a dataIssue, same fail-closed handling
  // as computeRepMedianData above, never silently treated as passing.
  // =====================================================================

  // Peer-group averages for one hierarchy tier -- { [group]: { teamAvg,
  // [kpiKey]: avg } }. groupFn(r) -> group key ("bu" for DM/DSM's own BU,
  // a constant for ASM/NSM's single national group). Only teamSize>0
  // (actually-scored) records count toward the average, same "don't let
  // an empty/unscored record drag down the baseline" rule as
  // computeLineMedians filtering null KPI values. Always called with the
  // FULL national roster (never a viewer's own BU/Line-scoped subset) --
  // see renderHierarchyTier.
  // scopeFn, added 2026-08-19 ("apply qualyfying average rule to bm"):
  // which records count toward the peer-group average. Defaults to the
  // original "teamSize > 0" rule (DM/DSM/ASM/NSM are team rollups, an
  // empty/unscored team shouldn't drag the baseline down) -- UNCHANGED
  // for every existing caller that omits it. Brand Manager has no team
  // at all (no teamSize field, individual KPIs only, see brandManagerRow)
  // so its callers pass `() => true` instead -- every scored BM in the
  // roster counts.
  function computeHierarchyAverages(reps, groupFn, scopeFn) {
    const inScope = scopeFn || (r => r.teamSize > 0);
    const groups = {};
    (reps || []).forEach(r => {
      if (!inScope(r)) return;
      const g = groupFn(r);
      if (g == null) return;
      if (!groups[g]) groups[g] = { teamAvg: [] };
      if (r.teamAvgRaw != null) groups[g].teamAvg.push(r.teamAvgRaw);
      (r.kpis || []).forEach(k => {
        if (k.raw == null) return;
        if (!groups[g][k.key]) groups[g][k.key] = [];
        groups[g][k.key].push(k.raw);
      });
    });
    const out = {};
    Object.keys(groups).forEach(g => {
      out[g] = {};
      Object.keys(groups[g]).forEach(k => { out[g][k] = average(groups[g][k]); });
    });
    return out;
  }

  // One rep vs their own peer-group averages -- mirrors
  // computeRepMedianData's shape (checks/gatePassCount/winnerPoolEligible/
  // dataIssue) but generalized to however many comparable KPIs this
  // record actually has this period, since the manager tiers' KPI set
  // isn't fixed the way Medical Rep's 3/CHC's 2 are.
  function computeHierarchyGateData(r, groupAverages) {
    const avgs = groupAverages || {};
    const checks = [];
    if (r.teamAvgRaw != null && avgs.teamAvg != null) {
      checks.push({ key: "teamAvg", label: "Team Avg", pass: r.teamAvgRaw >= avgs.teamAvg, value: r.teamAvgRaw, avg: avgs.teamAvg });
    }
    (r.kpis || []).forEach(k => {
      if (k.raw == null || avgs[k.key] == null) return;
      checks.push({ key: k.key, label: kpiShortLabel(k.label), pass: k.raw >= avgs[k.key], value: k.raw, avg: avgs[k.key] });
    });
    const dataIssue = checks.length === 0;
    const gatePassCount = checks.filter(c => c.pass).length;
    const winnerPoolEligible = !dataIssue && checks.every(c => c.pass);
    return { checks, gatePassCount, winnerPoolEligible, dataIssue, winnerPoolRank: null, tier: "", tie: false };
  }

  // Generic version of computeLineWinnerPools for the manager tiers --
  // groups by groupFn (BU for DM/DSM, a constant "__ALL__" for ASM/NSM),
  // ranks each group's eligible pool by Total Points, assigns
  // winnerSlots (2 for DM/DSM = Winner + Runner-Up, same tie12/tie23
  // co-WINNER-promotion rule as Medical Rep/CHC; 1 for ASM/NSM = a single
  // company-wide WINNER, with a rank-1 points tie promoting ALL tied
  // reps to co-WINNER rather than picking one arbitrarily -- no
  // principled tiebreaker exists, same reasoning as Medical Rep's tie12).
  // Returns { derivedByCode, groupSummary: { [group]: {pool, winners,
  // runnerUp, noWinnerThisCycle} } }. Called with the FULL national
  // roster, same as computeHierarchyAverages.
  // scopeFn -- same meaning/default as computeHierarchyAverages above,
  // must be passed the SAME scopeFn used to build groupAverages or the
  // pool and the averages it's compared against silently disagree.
  function computeHierarchyWinnerPools(reps, groupFn, groupAverages, winnerSlots, scopeFn) {
    const inScope = scopeFn || (r => r.teamSize > 0);
    const groups = {};
    (reps || []).forEach(r => {
      if (!inScope(r)) return;
      const g = groupFn(r);
      (groups[g] = groups[g] || []).push(r);
    });
    const derivedByCode = {};
    const groupSummary = {};
    Object.keys(groups).forEach(g => {
      const entries = groups[g].map(r => ({ r, d: computeHierarchyGateData(r, groupAverages[g] || {}) }));
      const pool = entries.filter(x => x.d.winnerPoolEligible && x.r.totalPts != null).sort((a, b) => b.r.totalPts - a.r.totalPts);
      pool.forEach((x, i) => { x.d.winnerPoolRank = i + 1; });
      if (winnerSlots >= 2) {
        const tie12 = pool.length > 1 && pool[0].r.totalPts === pool[1].r.totalPts;
        const tie23 = pool.length > 2 && pool[1].r.totalPts === pool[2].r.totalPts;
        if (pool[0]) { pool[0].d.tier = "WINNER"; pool[0].d.tie = tie12; }
        if (pool[1]) { pool[1].d.tier = tie12 ? "WINNER" : "RUNNER_UP"; pool[1].d.tie = tie12 || tie23; }
      } else if (pool.length) {
        const topPts = pool[0].r.totalPts;
        const tied = pool.filter(x => x.r.totalPts === topPts);
        tied.forEach(x => { x.d.tier = "WINNER"; x.d.tie = tied.length > 1; });
      }
      entries.forEach(({ r, d }) => { derivedByCode[r.code] = d; });
      const winners = pool.filter(x => x.d.tier === "WINNER");
      const runnerUp = pool.find(x => x.d.tier === "RUNNER_UP") || null;
      groupSummary[g] = { pool, winners, runnerUp, noWinnerThisCycle: pool.length === 0 };
    });
    return { derivedByCode, groupSummary };
  }

  // Inline gate-status note, shown on every DM/DSM/ASM/NSM row alongside
  // the existing Team Sales Achievement note -- same visual language
  // (sp-team-ach-note/-ok/-below, no new CSS needed) as teamAchNote()
  // above, now reporting the peer-Average gate that actually determines
  // eligibility.
  // opts, added 2026-08-19 for Brand Manager ("apply qualyfying average
  // rule to bm"): Brand Manager only ever has a single WINNER (no Winner
  // 2/BU Leader concept -- see renderBrandManager) and no Monthly Sprint
  // cash tier (recognition only) -- the generic DM/DSM/ASM/NSM tooltip
  // wording would be misleading verbatim for BM rows, so callers can
  // override badgeLabel/hasCash. Both default to the original DM/DSM/
  // ASM/NSM wording, UNCHANGED for every existing call site that omits
  // opts.
  function hierarchyGateNote(d, opts) {
    opts = opts || {};
    const badgeLabel = opts.badgeLabel || "WINNER/WINNER 2/BU Leader";
    const hasCash = opts.hasCash !== false;
    if (!d) return "";
    if (d.dataIssue) {
      return ` · <span class="sp-team-ach-note sp-team-ach-below" title="No comparable KPI has real data yet this period -- can't compare against the peer-group Average.">No comparable KPI data yet</span>`;
    }
    const cls = d.winnerPoolEligible ? "sp-team-ach-ok" : "sp-team-ach-below";
    const fmt = c => c.key === "teamAvg" ? c.value.toFixed(1) + " pts" : (c.value * 100).toFixed(0) + "%";
    const fmtAvg = c => c.key === "teamAvg" ? c.avg.toFixed(1) + " pts" : (c.avg * 100).toFixed(0) + "%";
    const parts = d.checks.map(c => `${c.label} ${fmt(c)} vs peer avg ${fmtAvg(c)} ${c.pass ? "✓" : "✗"}`).join(" · ");
    const title = `Winner Pool eligibility requires clearing the peer-group Average on EVERY scored KPI at once: ${parts}.`
      + (d.winnerPoolEligible ? "" : ` Below on at least one -- not eligible for the ${badgeLabel} badge${hasCash ? " or Monthly Sprint cash" : ""} this month, regardless of rank or Total Points.`);
    return ` · <span class="sp-team-ach-note ${cls}" title="${esc(title)}">${d.winnerPoolEligible ? "Clears peer Average" : "Below peer Average"} <b>(${d.gatePassCount}/${d.checks.length} KPIs)</b></span>`;
  }

  // Loud rule banner, same visual shape as floorRuleBannerHtml() above
  // (still used unchanged for Brand Manager, out of scope for this
  // request) -- states the peer-Average gate in one bold block, per
  // Ahmed's own "I NEED VERY HIGHLIGHTED GAT FLOOR RULE" standard from
  // the original 2026-08-16 floor request, now applied to this gate.
  // REPLACED 2026-08-19 -- Ahmed pasted Medical Rep's own bilingual
  // "WINNER PAGE — LINE AVERAGE PERFORMANCE MODEL" banner
  // (lineMedianRuleBannerHtml above) verbatim and asked for it "written
  // like this, customized for dm dsm and asm and nsm". This function now
  // renders the EXACT same visual shape (title / 2 English lines / 2
  // Arabic lines, sp-median-rule-banner/-ar classes reused verbatim, no
  // new CSS) instead of the plainer single-paragraph banner it held
  // before -- text supplied per tier by HIERARCHY_BANNER_TEXT below.
  function hierarchyGateRuleBannerHtml(titleEn, textEn1, textEn2, textAr1, textAr2) {
    return `<div class="sp-floor-rule-banner sp-median-rule-banner">
      <div class="sp-floor-rule-icon">🏆</div>
      <div class="sp-floor-rule-body">
        <div class="sp-floor-rule-title">${titleEn}</div>
        <div class="sp-floor-rule-text">${textEn1}</div>
        <div class="sp-floor-rule-text">${textEn2}</div>
        <div class="sp-floor-rule-text sp-median-rule-ar" dir="rtl" lang="ar">${textAr1}</div>
        <div class="sp-floor-rule-text sp-median-rule-ar" dir="rtl" lang="ar">${textAr2}</div>
      </div>
    </div>`;
  }

  // Per-tier banner copy for hierarchyGateRuleBannerHtml above, mirroring
  // lineMedianRuleBannerHtml's exact two-sentence EN + two-sentence AR
  // shape ("eligibility is based only on performance versus the peer
  // Average across <KPIs>" / "absolute floors affect Points Calculation
  // only"). DM/DSM's KPI list is all 4 scored KPIs (Team Avg Score, Field
  // Working Days, DV Coverage, Calls per DV); ASM/NSM's is their 2
  // (Team Avg Score, Field Working Days) -- matches exactly what
  // computeHierarchyGateData actually gates on today (verified against
  // real August data, see "MANAGER-TIER WINNER POOL GATE" above).
  const HIERARCHY_BANNER_TEXT = {
    dmDsm: {
      title: "WINNER PAGE — BU AVERAGE PERFORMANCE MODEL",
      en1: "Winner Pool eligibility is based only on performance versus the DM/DSM's own BU Average across Team Avg Score, Field Working Days, DV Coverage, and Calls per DV.",
      en2: "Absolute floors affect Points Calculation only and do not determine Winner Pool eligibility.",
      ar1: "أهلية الدخول إلى مجموعة الفائزين تعتمد فقط على مقارنة أداء مدير المنطقة (DM/DSM) بمتوسط (Average) الـ BU الخاص به في متوسط أداء الفريق، أيام العمل الميداني، تغطية الزيارات المزدوجة، وعدد الزيارات لكل زيارة مزدوجة.",
      ar2: "الحدود الدنيا المطلقة تؤثر على حساب النقاط فقط ولا تحدد أهلية الدخول إلى مجموعة الفائزين.",
    },
    asm: {
      title: "WINNER PAGE — NATIONAL ASM AVERAGE PERFORMANCE MODEL",
      en1: "Winner Pool eligibility is based only on performance versus the national ASM Average (every other ASM across the company) across Team Avg Score and Field Working Days.",
      en2: "Absolute floors affect Points Calculation only and do not determine Winner Pool eligibility.",
      ar1: "أهلية الدخول إلى مجموعة الفائزين تعتمد فقط على مقارنة أداء مدير المبيعات الإقليمي (ASM) بالمتوسط (Average) الوطني لجميع مديري المبيعات الإقليميين في الشركة، في متوسط أداء الفريق وأيام العمل الميداني.",
      ar2: "الحدود الدنيا المطلقة تؤثر على حساب النقاط فقط ولا تحدد أهلية الدخول إلى مجموعة الفائزين.",
    },
    nsm: {
      title: "WINNER PAGE — NATIONAL NSM AVERAGE PERFORMANCE MODEL",
      en1: "Winner Pool eligibility is based only on performance versus the national NSM Average (every other NSM across the company) across Team Avg Score and Field Working Days.",
      en2: "Absolute floors affect Points Calculation only and do not determine Winner Pool eligibility.",
      ar1: "أهلية الدخول إلى مجموعة الفائزين تعتمد فقط على مقارنة أداء مدير المبيعات الوطني (NSM) بالمتوسط (Average) الوطني لجميع مديري المبيعات الوطنيين في الشركة، في متوسط أداء الفريق وأيام العمل الميداني.",
      ar2: "الحدود الدنيا المطلقة تؤثر على حساب النقاط فقط ولا تحدد أهلية الدخول إلى مجموعة الفائزين.",
    },
    // Added 2026-08-19 per Ahmed ("apply qualyfying average rule to bm"):
    // same gate family, Brand Manager's own national peer group (every
    // other Brand Manager company-wide, single group same as ASM/NSM --
    // Brand Manager has no BU-scoped rollup the way DM/DSM does). KPI
    // list matches Brand Manager's actual r.kpis (National Sales,
    // Regions Covered, Tactical Plan Execution) -- only National Sales
    // has real data as of this cache (Regions Covered/Tactical Plan are
    // still pending in Sprint_Missing_KPI_Template.xlsx), so the gate is
    // effectively single-KPI today and will pick up the other two
    // automatically once Ahmed fills them in, same "whichever KPIs have
    // real data" rule as every other tier.
    bm: {
      title: "WINNER PAGE — NATIONAL BM AVERAGE PERFORMANCE MODEL",
      en1: "Winner Pool eligibility is based only on performance versus the national Brand Manager Average (every other Brand Manager across the company) across National Sales, Regions Covered, and Tactical Plan Execution.",
      en2: "Absolute floors affect Points Calculation only and do not determine Winner Pool eligibility.",
      ar1: "أهلية الدخول إلى مجموعة الفائزين تعتمد فقط على مقارنة أداء مدير المنتج (Brand Manager) بالمتوسط (Average) الوطني لجميع مديري المنتجات في الشركة، في المبيعات الوطنية، عدد المناطق المغطاة، وتنفيذ الخطة التكتيكية.",
      ar2: "الحدود الدنيا المطلقة تؤثر على حساب النقاط فقط ولا تحدد أهلية الدخول إلى مجموعة الفائزين.",
    },
  };

  // ---- Scenario Compare panel (section: Average Gate [live] vs Median
  // Gate [previous rule]) -- Per Ahmed 2026-08-19, first added to compare
  // the two ("i need to see median and average to cmpare 2 scenario"),
  // then the Average scenario was made the live rule ("ok make winner
  // pool gate according to average instead of median"). Shown once per
  // page (not per-Line -- keeps it to one glance across every Line at
  // once), directly under the Line Medians &amp; Averages panel. Now
  // documents the CHANGE that was just made -- who gained/lost
  // eligibility when the gate switched from Median to Average -- rather
  // than a hypothetical. Read-only reference; the Median-gate numbers
  // here do not feed any badge/rank/CSV payout anywhere.
  // UNUSED as of 2026-08-19 ("remove show only avg line no median") -- both
  // call sites (msrSummaryPanelHtml, renderSalesRep's chcPanel) were
  // removed per Ahmed's explicit ask to drop the Median comparison
  // entirely, not just de-emphasize it. Left defined rather than deleted
  // (out of scope for this fix), same convention as lineMedianGateResult/
  // topNByGroup above -- do not wire this back up without re-confirming
  // Ahmed still wants a Median reference anywhere on the page.
  function scenarioCompareHtml(lineSummaryMap) {
    const lines = Object.keys(lineSummaryMap).sort();
    if (!lines.length) return "";
    const rows = lines.map(line => {
      const ls = lineSummaryMap[line];
      const flips = [...ls.flippedIn.map(x => `+${esc(x.r.name)}`), ...ls.flippedOut.map(x => `−${esc(x.r.name)}`)];
      const flipStr = flips.length ? flips.join(", ") : "—";
      return `<tr><td>${esc(line)}</td><td>${ls.poolSize}</td><td>${ls.poolSizeUnderMedian}</td><td>${flipStr}</td></tr>`;
    }).join("");
    const totalFlips = lines.reduce((sum, l) => sum + lineSummaryMap[l].flippedIn.length + lineSummaryMap[l].flippedOut.length, 0);
    return `<details class="sp-scenario-compare">
      <summary>📊 SCENARIO COMPARE — Average Gate (live) vs Median Gate (previous rule) — ${totalFlips} rep${totalFlips === 1 ? "" : "s"} flipped eligibility when this switched — click to expand</summary>
      <div class="sp-line-median-panel">
        <div class="sp-floor-rule-text" style="margin-bottom:8px;">The live Winner Pool rule everywhere else on this page now compares each Rep to their Line's <b>Average</b> (switched 2026-08-19 from Median). This table shows what the pool would still be under the old Median-based rule, for reference. "+" = gained eligibility when the gate switched to Average (was NOT eligible under Median); "−" = lost eligibility when the gate switched to Average (WAS eligible under Median).</div>
        <table class="sp-line-median-table">
          <thead><tr><th>Line</th><th>Pool Size — Average (live)</th><th>Pool Size — Median (previous)</th><th>Reps Who Flipped</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>`;
  }

  // "Line Average" readout, shown under the Recognition Winners panel and
  // recomputed live on every Line filter change (same trigger as
  // msrSummaryPanelHtml) for Medical Rep -- per Ahmed 2026-08-18 ("put
  // the median for each line in 3 parameters dynamically with filter").
  // Shows one Line's Averages when a specific Line is selected (or the
  // only Line, for CHC Sales Rep, which has no dropdown), or every Line
  // at once (compact table) when "All Lines" is selected.
  // EXTENDED 2026-08-19 ("i need to see median and average to cmpare 2
  // scenario"): briefly showed "Average / Median" side by side.
  // SWITCHED 2026-08-19 ("ok make winner pool gate according to average
  // instead of median"): Average became the LIVE Winner Pool gate.
  // SIMPLIFIED 2026-08-19 ("remove show only avg line no median"): Median
  // is no longer the live rule and Ahmed asked for it off this panel
  // entirely -- back to a single Average column/value per KPI, same shape
  // as the original (pre-comparison) panel. computeLineMedians still
  // computes *Median fields (still read by the now-removed
  // scenarioCompareHtml's dead code path -- see that function's own
  // comment), just no longer displayed here.
  function lineMedianPanelHtml(filterVal, lineMediansLookup, hasRf) {
    function fmt1(v, isFraction) {
      return v != null ? ((isFraction ? v * 100 : v)).toFixed(1) + "%" : "—";
    }
    if (!filterVal || filterVal === "__ALL__") {
      const lines = Object.keys(lineMediansLookup).sort();
      if (!lines.length) return "";
      const rows = lines.map(line => {
        const m = lineMediansLookup[line];
        const rfCell = hasRf === false ? "" : `<td>${fmt1(m.rfAverage, false)}</td>`;
        return `<tr><td>${esc(line)}</td><td>${fmt1(m.salesAverage, true)}</td>${rfCell}<td>${fmt1(m.coverageAverage, false)}</td></tr>`;
      }).join("");
      const rfHeader = hasRf === false ? "" : `<th>Right Freq Average</th>`;
      return `<div class="sp-line-median-panel"><div class="sp-line-median-title">📊 LINE AVERAGES (live gate) — every Line</div><table class="sp-line-median-table"><thead><tr><th>Line</th><th>Sales Average</th>${rfHeader}<th>Coverage Average</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    const m = lineMediansLookup[filterVal];
    if (!m) return "";
    // FIXED 2026-08-19: hasRf=false (CHC Sales Rep call site) hides the
    // Right Frequency average entirely -- RF is no longer part of CHC's
    // eligibility or scoring model, so showing it here would be
    // misleading. Medical Rep call sites don't pass hasRf (undefined !==
    // false), so their Right Frequency average keeps showing as before.
    const rfSpan = hasRf === false ? "" : `<span><b>Right Frequency Average</b> ${fmt1(m.rfAverage, false)}</span>`;
    return `<div class="sp-line-median-panel"><div class="sp-line-median-title">📊 LINE AVERAGES (live gate) — ${esc(filterVal)}</div><div class="sp-line-median-values"><span><b>Sales Average</b> ${fmt1(m.salesAverage, true)}</span>${rfSpan}<span><b>Coverage Average</b> ${fmt1(m.coverageAverage, false)}</span></div></div>`;
  }

  // ---- Winner Page header banner -- LINE MEDIAN PERFORMANCE MODEL
  // (Medical Rep + CHC Sales Rep) -- Replaces floorRuleBannerHtml() above
  // the Medical Rep AND CHC Sales Rep Recognition Winners panels, per
  // Ahmed 2026-08-18 section 6, exact bilingual wording as given. DM-DSM
  // / ASM / NSM / Brand Manager still render the original
  // floorRuleBannerHtml() below, untouched.
  // FIXED 2026-08-19: added hasRf (default true, unaffected Medical Rep
  // call sites omit it) -- CHC Sales Rep passes false so its banner text
  // correctly says "Sales Achievement and Coverage" instead of listing a
  // Right Frequency KPI that no longer gates or scores anything for CHC.
  // SWITCHED 2026-08-19 ("ok make winner pool gate according to average
  // instead of median"): title/body text now says "Line Average" -- this
  // banner describes the LIVE rule, which is Average-gated as of today.
  function lineMedianRuleBannerHtml(hasRf) {
    const kpiListEn = hasRf === false ? "Sales Achievement and Coverage" : "Sales Achievement, Right Frequency, and Coverage";
    const kpiListAr = hasRf === false ? "تحقيق المبيعات والتغطية" : "تحقيق المبيعات والتكرار الصحيح للزيارات والتغطية";
    return `<div class="sp-floor-rule-banner sp-median-rule-banner">
      <div class="sp-floor-rule-icon">🏆</div>
      <div class="sp-floor-rule-body">
        <div class="sp-floor-rule-title">WINNER PAGE — LINE AVERAGE PERFORMANCE MODEL</div>
        <div class="sp-floor-rule-text">Winner Pool eligibility is based only on performance versus the Rep's own Line Average across ${kpiListEn}.</div>
        <div class="sp-floor-rule-text">Absolute floors affect Points Calculation only and do not determine Winner Pool eligibility.</div>
        <div class="sp-floor-rule-text sp-median-rule-ar" dir="rtl" lang="ar">أهلية الدخول إلى مجموعة الفائزين تعتمد فقط على مقارنة أداء المندوب بمتوسط (Average) الـ Line في ${kpiListAr}.</div>
        <div class="sp-floor-rule-text sp-median-rule-ar" dir="rtl" lang="ar">الحدود الدنيا المطلقة تؤثر على حساب النقاط فقط ولا تحدد أهلية الدخول إلى مجموعة الفائزين.</div>
      </div>
    </div>`;
  }

  // ---- Sales/RF/Coverage-vs-Line-Median KPI block (sections 8/9) ------
  // Distinct from kpiBar() (points progress, shared by every other tier,
  // untouched) -- this renders value / median / %-of-median / points /
  // floor-status AND a "vs Median" bar with the Line Median always drawn
  // as a fixed marker at the bar's center (domain = 0..2x median, so a
  // rep's fill crossing past the marker literally means above-median).
  // Never implies the 70/60/90 floor is the Winner threshold (section
  // 9's explicit requirement) -- the floor only appears in its own
  // separate line below, worded "Above/Below Floor", not on the bar.
  // EXTENDED 2026-08-19 ("ok make winner pool gate according to average
  // instead of median"): added baselineLabel (defaults to "Median" for any
  // caller that doesn't pass it, but every live call site below now passes
  // "Average" explicitly) -- the function itself was always generic (the
  // `med`/`vsMedian` params are just "the comparison baseline value" and
  // "value vs that baseline as %", regardless of which statistic feeds
  // them), only the hardcoded "Median" wording in the template needed
  // parameterizing so the on-screen bar/tooltip/label correctly describe
  // whichever baseline is now the live gate.
  function kpiMedianBlock(label, val, med, vsMedian, pts, maxPts, floorPass, floorLabel, isFraction, baselineLabel) {
    const baseLabel = baselineLabel || "Median";
    const fmt = v => v == null ? "—" : ((isFraction ? v * 100 : v).toFixed(1)) + "%";
    const valStr = fmt(val);
    const medStr = fmt(med);
    const vsStr = vsMedian != null ? vsMedian.toFixed(1) + `% of ${baseLabel}` : "N/A";
    let barHtml;
    if (med == null || med === 0 || val == null) {
      barHtml = `<div class="sp-median-bar-track sp-median-bar-na">N/A — Line ${esc(baseLabel)} unavailable</div>`;
    } else {
      const domain = med * 2;
      const fillPct = Math.max(0, Math.min(100, val / domain * 100));
      const above = val >= med;
      barHtml = `<div class="sp-median-bar-track"><div class="sp-median-bar-fill ${above ? "sp-median-bar-above" : "sp-median-bar-below"}" style="width:${fillPct.toFixed(1)}%"></div><div class="sp-median-bar-marker" title="Line ${esc(baseLabel)} ${medStr}"></div></div>`;
    }
    // maxPts === null means this KPI gates eligibility only and scores no
    // points at all (CHC Sales Rep's Right Frequency -- section (g)
    // 2026-08-18 "sales rf and frequency ach fot should be visible
    // better", but CHC's points formula stays Sales 60 + Coverage 40, no
    // RF points row -- see pointsCalcDetailsHtml). Points line is simply
    // omitted rather than showing a misleading "— / null pts".
    const ptsStr = maxPts == null ? null : (pts != null ? `${pts.toFixed(1)} / ${maxPts} pts` : `— / ${maxPts} pts`);
    const floorHtml = floorPass == null ? "" : `<div class="sp-median-floor-status ${floorPass ? "sp-floor-above" : "sp-floor-below"}">${floorPass ? "✓" : "✗"} ${floorPass ? "Above" : "Below"} ${esc(floorLabel)} Floor</div>`;
    return `<div class="sp-kpi-median-block">
      <div class="sp-kpi-median-label">${esc(label)}</div>
      <div class="sp-kpi-median-val">${valStr}</div>
      <div class="sp-kpi-median-vsmed">vs ${esc(baseLabel)} ${medStr}</div>
      ${barHtml}
      <div class="sp-kpi-median-pctofmed">${vsStr}</div>
      ${ptsStr != null ? `<div class="sp-kpi-median-pts">${ptsStr}</div>` : `<div class="sp-kpi-median-pts sp-kpi-median-nopts">Eligibility only — no points scored</div>`}
      ${floorHtml}
    </div>`;
  }

  // ---- Expandable "How were points calculated?" (section 5) ----------
  // Reads the EXISTING engine's own salesPts/rfPts/covPts + the display
  // floor constants verbatim -- never a second competing formula.
  function pointsCalcDetailsHtml(r, hasRf, maxSales, maxCoverage) {
    // FIXED 2026-08-19 (Ahmed flagged Adel AbdelAzim ElSayed AbdelAziz
    // Asfour, code 1262, CVM-I): a null value (no data, e.g. salesVal=0
    // AND salesTgt=0 this period so Sales Achievement can't be computed)
    // used to fall into "val >= floor" as false and print "Below Floor" --
    // reading as a real, judged underperformance rather than what it
    // actually is: no data to judge at all. Now says "No Data" instead,
    // with the zero-target reason spelled out for Sales specifically
    // (the one KPI whose null cause is knowable from the rep record).
    function row(label, val, isFraction, floor, floorIsFraction, pts, maxPts, noDataReason) {
      const valStr = val != null ? (((isFraction ? val * 100 : val)).toFixed(1) + "%") : "—";
      const floorStr = ((floorIsFraction ? floor * 100 : floor)).toFixed(0) + "%";
      const ptsStr = pts != null ? pts.toFixed(1) : "—";
      const status = val == null ? `No Data${noDataReason ? ` — ${esc(noDataReason)}` : ""}` : (val >= floor ? "Above Floor" : "Below Floor");
      return `<tr><td>${esc(label)}</td><td>${valStr}</td><td>${floorStr}</td><td>${ptsStr} / ${maxPts}</td><td>${status}</td></tr>`;
    }
    const salesNoDataReason = r.achPct == null && r.salesTgt === 0 ? "Sales Target = 0 this period" : null;
    let body = row("Sales Achievement", r.achPct, true, KPI_FLOOR_DISPLAY.sales, true, r.salesPts, maxSales, salesNoDataReason);
    if (hasRf) body += row("Right Frequency", r.rightFreqPct, false, KPI_FLOOR_DISPLAY.rf, false, r.rfPts, 40);
    body += row("Coverage", r.coveragePct, false, KPI_FLOOR_DISPLAY.coverage, false, r.covPts, maxCoverage);
    return `<details class="sp-calc-details">
      <summary>ⓘ How were points calculated?</summary>
      <div class="sp-calc-body">
        <table class="sp-calc-table"><thead><tr><th>KPI</th><th>Rep Value</th><th>Floor</th><th>Points Earned</th><th>Status</th></tr></thead><tbody>${body}</tbody></table>
        <div class="sp-calc-total">TOTAL <b>${r.totalPts.toFixed(1)} / 100</b></div>
      </div>
    </details>`;
  }

  // Per Ahmed 2026-08-19 (flagged Adel AbdelAzim ElSayed AbdelAziz Asfour,
  // code 1262, CVM-I): "⚠ INCOMPLETE DATA" alone doesn't say WHICH KPI is
  // missing or WHY -- a manager checking his row has to go dig in a
  // spreadsheet to find out his Sales Target is 0 this period (so Sales
  // Achievement literally can't be computed, not that he scored badly).
  // Spells out every missing KPI by name, plus the zero-target reason
  // specifically for Sales (the one cause knowable from the rep record --
  // a missing Coverage/Right Freq value has no equivalent single root
  // cause to point to, so those just say "no data on file").
  function dataIssueDetail(r) {
    const missing = [];
    if (r.achPct == null) missing.push(r.salesTgt === 0 ? "Sales Achievement (Sales Target = 0 this period)" : "Sales Achievement (no data on file)");
    // FIXED 2026-08-19: CHC Sales Rep has no Right Frequency KPI at all
    // (see computeRepMedianData's isChcSales) -- a missing rightFreqPct on
    // a CHC record must never be flagged as a data issue for a KPI that
    // was never applicable to that role in the first place.
    if (r.role !== "Sales Rep (CHC)" && r.rightFreqPct == null) missing.push("Right Frequency (no data on file)");
    if (r.coveragePct == null) missing.push("Coverage (no data on file)");
    if (!missing.length) return "";
    return ` <span class="sp-dataissue-note">Missing: ${missing.map(esc).join(", ")}</span>`;
  }

  // Recognition tier badge + Total Points header shown at the top of
  // every rep row (sections 3, 4, 8).
  function recognitionTierBadgeHtml(d, r) {
    const t = RECOGNITION_TIER[d.recognitionTier];
    const tieNote = d.tie ? ` <span class="sp-tie-flag" title="Tied with another Winner Pool rep at this exact rank -- no approved tie-breaker exists in the current engine, flagged for a management decision rather than silently broken.">⚠ TIE</span>` : "";
    const poolNote = d.winnerPoolEligible ? ` <span class="sp-pool-rank-note">Winner Pool #${d.winnerPoolRank}</span>` : "";
    const dataIssueNote = d.recognitionTier === "DATA_ISSUE" && r ? dataIssueDetail(r) : "";
    return `<span class="sp-tier-badge ${t.cls}">${t.label}</span>${tieNote}${poolNote}${dataIssueNote}`;
  }

  function totalPointsHeaderHtml(d, maxTotal) {
    return `<div class="sp-total-points-header"><span class="sp-total-points-label">TOTAL POINTS</span><span class="sp-total-points-val">${d.totalPoints.toFixed(1)} / ${maxTotal}</span></div>`;
  }

  // ---- Winner Pool summary cards (section 7) --------------------------
  // Clearly distinguishes Winner Pool ranking (🏆/🥈, from
  // computeLineWinnerPools' own pool[0]/pool[1]) from Near Winner
  // recognition (never shown as the actual Winner). Handles "No Winner
  // This Cycle" (section 15) without forcing a badge onto anyone.
  function winnerPoolSummaryCardsHtml(lineSummary, label, hasRf) {
    // FIXED 2026-08-19: CHC Sales Rep call site now passes hasRf=false
    // (RF removed from CHC entirely) -- every "3" reference below becomes
    // "2" and the RF meta/text drops out for CHC, while Medical Rep
    // (hasRf=true) is completely unaffected.
    const kpiCount = hasRf ? 3 : 2;
    function repMeta(entry) {
      if (!entry) return "";
      const { r, d } = entry;
      const rfPart = hasRf ? ` · RF ${r.rightFreqPct.toFixed(1)}%` : "";
      return `${d.totalPoints.toFixed(1)} pts · Sales ${(r.achPct * 100).toFixed(1)}%${rfPart} · Coverage ${r.coveragePct.toFixed(1)}%`;
    }
    if (lineSummary.noWinnerThisCycle) {
      const kpiListEn = hasRf ? "Sales, Right Frequency AND Coverage" : "Sales AND Coverage";
      return winnersPanelHtml(`🏆 Recognition — ${esc(label)}`,
        emptyWinnerCardHtml("WINNER", `No Rep reached ${kpiCount}/${kpiCount} Line Average this cycle — No Winner This Cycle.`),
        `No Rep in ${esc(label)} met ${kpiListEn} vs their own Line Average this cycle. No Winner is forced onto the highest scorer who still falls short.`);
    }
    let cards = winnerCardHtml("🏆", "WINNER" + (lineSummary.tieAtRank1 ? " ⚠ TIE" : ""), lineSummary.winner.r.name, repMeta(lineSummary.winner));
    // Per Ahmed 2026-08-18 ("RUNNER-UP change to Winner"): a #2 tied with
    // #1 on Total Points (coWinner) is shown as a second 🏆 WINNER card,
    // not Runner-Up -- there's no principled basis to demote one of two
    // tied reps. FURTHER per Ahmed 2026-08-19 ("RUNNER-UP in medical rep
    // and chc sales change to Winner 2"): a true (untied) #2 is no longer
    // labeled Runner-Up either -- it now reads 🏆 WINNER 2, a co-equal
    // Winner one rank down, same relabel already applied to DM/DSM.
    if (lineSummary.runnerUp) {
      cards += lineSummary.coWinner
        ? winnerCardHtml("🏆", "WINNER ⚠ TIE", lineSummary.runnerUp.r.name, repMeta(lineSummary.runnerUp))
        : winnerCardHtml("🏆", "WINNER 2" + (lineSummary.tieAtRank2 ? " ⚠ TIE" : ""), lineSummary.runnerUp.r.name, repMeta(lineSummary.runnerUp));
    }
    lineSummary.nearWinners.slice(0, 3).forEach(nw => {
      cards += winnerCardHtml("🥈", "NEAR WINNER", nw.r.name, `${nw.d.gatePassCount}/${kpiCount} Average qualified · ${repMeta({ r: nw.r, d: nw.d })}`);
    });
    const note = `Winner Pool ranking (🏆 WINNER / 🏆 WINNER 2) is separate from Near Winner recognition — a Near Winner has NOT met all ${kpiCount} Line Averages and is never shown as the actual Winner. When #1 and #2 are tied on Total Points, both are recognized as co-🏆 WINNER rather than one being labeled Winner 2. Winner Pool size this Line: ${lineSummary.poolSize}.`;
    return winnersPanelHtml(`🏆 Recognition — ${esc(label)}`, cards, note);
  }

  // ---- Manager Audit View (section 13) --------------------------------
  // Answers the 8 questions without needing to open source code.
  // SWITCHED 2026-08-19 ("ok make winner pool gate according to average
  // instead of median"): Q1/Q2/Q8 below now describe the Average gate
  // (the live rule) instead of Median.
  function managerAuditViewHtml(lineSummary, label, hasRf) {
    const m = lineSummary.medians || {};
    const fmtS = m.salesAverage != null ? (m.salesAverage * 100).toFixed(1) + "%" : "—";
    const fmtR = m.rfAverage != null ? m.rfAverage.toFixed(1) + "%" : "—";
    const fmtC = m.coverageAverage != null ? m.coverageAverage.toFixed(1) + "%" : "—";
    // Per Ahmed 2026-08-18 ("RUNNER-UP change to Winner"): a #2 tied with
    // #1 on Total Points reads as a co-WINNER here too, folded into Q3
    // rather than left standing as Q4's Runner-Up.
    const winnerLine = lineSummary.winner
      ? `${lineSummary.winner.r.name} (${lineSummary.winner.d.totalPoints.toFixed(1)} pts)${lineSummary.coWinner && lineSummary.runnerUp ? ` AND ${lineSummary.runnerUp.r.name} (${lineSummary.runnerUp.d.totalPoints.toFixed(1)} pts) — tied, both recognized as WINNER` : ""}`
      : "No Winner This Cycle";
    const runnerLine = lineSummary.coWinner
      ? "None — tied with #1 on Total Points, see Q3 (both recognized as WINNER)"
      : (lineSummary.runnerUp ? `${lineSummary.runnerUp.r.name} (${lineSummary.runnerUp.d.totalPoints.toFixed(1)} pts)` : "—");
    const nearLine = lineSummary.nearWinners.length ? lineSummary.nearWinners.map(nw => esc(nw.r.name)).join(", ") : "None";
    // FIXED 2026-08-19: added the RF median (Q1) and "Sales X + RF Y +
    // Coverage Z" (Q6-7) as hasRf-conditional -- CHC Sales Rep (hasRf=
    // false) has no Right Freq KPI at all now (removed from both scoring
    // AND eligibility, "CHC Sales Rep remove right frequency from sales
    // sprint"). Also fixed a pre-existing bug in Q6-7 while touching this
    // exact line: Sales max was hardcoded "50" for every caller, but CHC's
    // Sales Achievement is out of 60, not 50 (Medical Rep is 50/RF 40/
    // Coverage 10; CHC is Sales 60/Coverage 40) -- now reads the correct
    // max per tier instead of silently mislabeling CHC's own points scale.
    const salesMax = hasRf ? 50 : 60;
    const rfLine = hasRf ? ` · Right Freq ${fmtR}` : "";
    const rfClause = hasRf ? "Right Freq 40 + " : "";
    const covMax = hasRf ? 10 : 40;
    const kpiCount = hasRf ? 3 : 2;
    const gateClause = hasRf ? "Sales, Right Frequency OR Coverage" : "Sales OR Coverage";
    return `<details class="sp-manager-audit">
      <summary>🔎 Manager View — Performance Logic for ${esc(label)}</summary>
      <div class="sp-manager-audit-body">
        <div><b>1. What is the Line Average?</b> Sales ${fmtS}${rfLine} · Coverage ${fmtC}</div>
        <div><b>2. Who is in the Winner Pool?</b> ${lineSummary.poolSize} Rep(s) — ${kpiCount}/${kpiCount} Line Average qualified</div>
        <div><b>3. Who is Winner?</b> ${esc(winnerLine)}</div>
        <div><b>4. Who is Winner 2?</b> ${esc(runnerLine)}</div>
        <div><b>5. Who is Near Winner?</b> ${nearLine}</div>
        <div><b>6-7. Points, and where from?</b> Sales ${salesMax} + ${rfClause}Coverage ${covMax} = 100, read straight from the existing points engine — expand "ⓘ How were points calculated?" on any Rep's own row for the exact breakdown.</div>
        <div><b>8. Why was someone excluded from the Winner Pool?</b> Any Rep below their own Line's average on ${gateClause} — shown red on that Rep's own KPI block. The 70%/60%/90% absolute floors never exclude a Rep from the Winner Pool, only from earning points on that one KPI.</div>
      </div>
    </details>`;
  }

  // ---- "All Lines" company-wide recognition summary --------------------
  // Per-row recognitionTier/winnerPoolRank are intrinsic to each rep's OWN
  // Line (computed once by computeLineWinnerPools, never re-derived from
  // whatever happens to be visible) -- so unlike the OLD wireRankFilter
  // podium (which only ever knew about "the currently visible rows"),
  // "All Lines" now has a real per-Line Winner/Runner-Up to show for
  // EVERY Line at once, not just whichever Line is filtered. A full
  // winnerPoolSummaryCardsHtml() grid per Line would be ~15 card-rows
  // wide for Medical Rep -- unreadable -- so "All Lines" instead gets
  // this compact one-row-per-Line table (same visual family as
  // lineMedianPanelHtml's own "every Line" table). Selecting one specific
  // Line still gets the full card treatment via winnerPoolSummaryCardsHtml
  // + managerAuditViewHtml, unchanged.
  function allLinesSummaryTableHtml(lineSummaryMap, hasRf) {
    const lines = Object.keys(lineSummaryMap).sort();
    if (!lines.length) return "";
    const rows = lines.map(line => {
      const ls = lineSummaryMap[line];
      const winnerStr = ls.winner
        ? `${esc(ls.winner.r.name)} (${ls.winner.d.totalPoints.toFixed(1)} pts)${ls.tieAtRank1 ? ' <span class="sp-tie-flag">⚠ TIE</span>' : ""}`
        : `<span class="sp-no-winner">No Winner This Cycle</span>`;
      // Per Ahmed 2026-08-18 ("RUNNER-UP change to Winner"): a #2 tied with
      // #1 reads as a second WINNER in this column too. FURTHER per Ahmed
      // 2026-08-19 ("RUNNER-UP in medical rep and chc sales change to
      // Winner 2"): even a true (untied) #2 is no longer "Runner-Up" --
      // always 🏆, always reads as a co-equal Winner one rank down.
      const runnerEmoji = "🏆";
      const runnerStr = ls.runnerUp
        ? (ls.coWinner
            ? `${esc(ls.runnerUp.r.name)} (${ls.runnerUp.d.totalPoints.toFixed(1)} pts) <span class="sp-tie-flag">⚠ TIE — also WINNER</span>`
            : `${esc(ls.runnerUp.r.name)} (${ls.runnerUp.d.totalPoints.toFixed(1)} pts)${ls.tieAtRank2 ? ' <span class="sp-tie-flag">⚠ TIE</span>' : " — WINNER 2"}`)
        : "—";
      const nearStr = ls.nearWinners.length ? ls.nearWinners.map(nw => esc(nw.r.name)).join(", ") : "—";
      return `<tr><td>${esc(line)}</td><td>🏆 ${winnerStr}</td><td>${runnerEmoji} ${runnerStr}</td><td>${ls.poolSize}</td><td>${nearStr}</td></tr>`;
    }).join("");
    // Per Ahmed 2026-08-18 ("RECOGNITION -- every Line make it autohide"):
    // collapsed by default behind a <details>/<summary> (same pattern as
    // pointsCalcDetailsHtml / managerAuditViewHtml elsewhere on this page)
    // rather than always taking up vertical space above the ranked table.
    return `<details class="sp-alllines-summary"><summary>🏆 RECOGNITION — every Line (${lines.length} Lines — click to expand)</summary><div class="sp-line-median-panel"><table class="sp-line-median-table"><thead><tr><th>Line</th><th>Winner</th><th>Winner 2</th><th>Pool Size</th><th>Near Winners</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }

  // Single entry point the Line-filter listener (and the initial render)
  // call to build everything below the header banner -- reads the
  // precomputed lineSummary map by O(1) key lookup only, never rescans
  // the DOM for winner badges (that whole mechanism no longer exists;
  // recognitionTierBadgeHtml already baked each row's own tier in at
  // render time, filter-independent, per Ahmed 2026-08-18 section 12).
  function msrSummaryPanelHtml(filterVal, lineSummaryMap, hasRf) {
    // scenarioCompareHtml() call REMOVED 2026-08-19 ("remove show only avg
    // line no median") -- Ahmed no longer wants the Median-gate comparison
    // shown anywhere on the page (Average has been the live rule since
    // earlier the same day; the comparison view had served its purpose).
    if (!filterVal || filterVal === "__ALL__") {
      return allLinesSummaryTableHtml(lineSummaryMap, hasRf) + lineMedianPanelHtml(filterVal, msrLineMedians);
    }
    const ls = lineSummaryMap[filterVal];
    if (!ls) return "";
    return winnerPoolSummaryCardsHtml(ls, `Line: ${filterVal}`, hasRf) + managerAuditViewHtml(ls, filterVal, hasRf) + lineMedianPanelHtml(filterVal, msrLineMedians);
  }

  // Lightweight replacement for the msr call into wireRankFilter -- rank
  // numbers and Line show/hide still recompute live on filter change (the
  // # column stays "current visible rank", same intentional behaviour as
  // before), but winner/runner-up determination is no longer derived from
  // the DOM at all, so there is nothing left for an isEligible/
  // buildPanelHtml-from-<tr> callback to do. See wireRankFilter above,
  // still used unchanged by DM/DSM's own BU filter.
  function wireLineFilter(selectEl, bodySelector, cascadePrefixes, panelId, lineSummaryMapGetter, hasRf) {
    if (!selectEl) return;
    selectEl.addEventListener("change", () => {
      const val = selectEl.value;
      let rank = 0;
      document.querySelectorAll(`${bodySelector} > tr`).forEach(tr => {
        const show = (val === "__ALL__" || tr.getAttribute("data-line") === val);
        tr.style.display = show ? "" : "none";
        if (show) {
          rank += 1;
          const rankCell = tr.querySelector(".sp-rank");
          if (rankCell) rankCell.textContent = rank;
        }
      });
      (cascadePrefixes || []).forEach(prefix => {
        const body = document.getElementById(`${prefix}-body`);
        const summary = document.getElementById(`${prefix}-summary`);
        if (!body) return;
        let count = 0;
        body.querySelectorAll("tbody > tr").forEach(tr => {
          const show = (val === "__ALL__" || tr.getAttribute("data-line") === val);
          tr.style.display = show ? "" : "none";
          if (show) count += 1;
        });
        if (summary) summary.textContent = `${summary.dataset.label} (${count})`;
      });
      const panel = document.getElementById(panelId);
      if (panel) panel.innerHTML = msrSummaryPanelHtml(val, lineSummaryMapGetter(), hasRf);
    });
    selectEl.dispatchEvent(new Event("change"));
  }

  // Brand Manager's Sales Achievement isn't a top-level field like
  // achPct -- it's nested in r.kpis (etl/build_sprint_cache.py's
  // key='salesAch' entry, raw = the underlying fraction).
  // UNUSED as of 2026-08-19 ("apply qualyfying average rule to bm"):
  // renderBrandManager no longer gates or displays this separately --
  // the salesAch KPI already gets its own peer-Average chart cell
  // (hierarchyKpiBlock) in the table, same as every other Brand Manager
  // KPI. Left defined, not deleted, in case it's needed again.
  function bmSalesAch(r) {
    const kpi = r.kpis && r.kpis.find(k => k.key === "salesAch");
    return kpi ? kpi.raw : null;
  }

  // Team-level floor, extended to DM/DSM/ASM/NSM 2026-08-16 per Ahmed
  // ("DM DSM HAS REWARD ALSO MAKE SAME FLOOR LOGIC FOR ASM NSM"). These
  // tiers don't have a personal Sales Achievement % -- r.teamSalesAchPct
  // (etl/build_sprint_cache.py) is SUM(every eligible rep's raw sales
  // value)/SUM(their raw target) across the WHOLE reporting subtree,
  // divided exactly once -- never an average of already-divided
  // percentages at any level. Same WINNER_FLOOR_ACH_PCT constant, same
  // 70% number, so the rule reads identically everywhere on this page.
  function meetsTeamSalesFloor(r) {
    return meetsSalesFloor(r.teamSalesAchPct);
  }

  // Per Ahmed 2026-08-16 ("FOR ALL DSM ASM NSM MENTION SALES ACHIEVEMENT"):
  // the row previously only spoke up when a manager was BELOW the floor
  // (teamFloorNote, now folded in here) -- an eligible manager's own Team
  // Sales Achievement number was invisible anywhere on their row, only
  // implied by the absent note. Now every DM/DSM/ASM/NSM row with a scored
  // team always shows its actual Team Sales Achievement %, colored green
  // (cleared the floor) or red (didn't), so the number driving eligibility
  // is never hidden either way.
  function teamAchNote(r) {
    const pct = r.teamSalesAchPct;
    const pctStr = pct != null ? (pct * 100).toFixed(1) + "%" : "—";
    const ok = meetsTeamSalesFloor(r);
    const cls = ok ? "sp-team-ach-ok" : "sp-team-ach-below";
    const title = `Team Sales Achievement = every team member's raw sales value summed beneath this manager, divided by their raw target summed the same way -- one division, never an average of already-divided percentages.`
      + (ok ? "" : ` Below the ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% recognition floor -- not eligible for the WINNER/BU Leader badge or Monthly Sprint cash this month, regardless of rank or Total Points.`);
    return ` · <span class="sp-team-ach-note ${cls}" title="${esc(title)}">Team Sales Achievement ${pctStr}${ok ? "" : ` <b>(below ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% floor)</b>`}</span>`;
  }

  // ---- Highlighted floor-rule banner -----------------------------------
  // Per Ahmed 2026-08-16 ("I NEED VERY HIGHLIGHTED GAT FLOOR RULE"): the
  // small inline "Below floor" note on a single row is easy to miss when
  // the real question is "why did nobody get a badge this month" or
  // "why is the top scorer unpaid". This banner states the rule itself,
  // in one bold, unmissable block, at the top of every floor-gated
  // section (Medical Rep, CHC Sales Rep, Brand Manager, DM/DSM, ASM,
  // NSM) -- separate from (and louder than) the smaller per-row note and
  // the section-sub paragraph, which stay as-is for their own detail.
  // isTeamTier (per Ahmed 2026-08-16, round 2 refinement -- "MENTION
  // ACHIEVEMENT FOR DM AND DSM AND ASM AND NSM SALES ACHIEVEMENT
  // ACCORDING TO TEAM MEMBER"): DM/DSM/ASM/NSM don't have a personal
  // Sales Achievement -- the floor is their TEAM'S, rolled up from every
  // team member beneath them (see meetsTeamSalesFloor / teamSalesAchPct
  // in the ETL). Medical Rep, CHC Sales Rep and Brand Manager use their
  // own individual Sales Achievement instead. Spelling that out here,
  // in the loud banner itself, avoids "why does a DM with a huge team
  // fall below floor when my own sales look fine" confusion.
  // UNUSED as of 2026-08-19 ("apply qualyfying average rule to bm"):
  // Brand Manager was this function's last remaining caller (Medical
  // Rep/CHC switched to lineMedianRuleBannerHtml, DM/DSM/ASM/NSM to
  // hierarchyGateRuleBannerHtml, both earlier) -- renderBrandManager now
  // calls hierarchyGateRuleBannerHtml too. Left defined, not deleted, in
  // case the flat-floor rule is ever needed again for some future tier.
  function floorRuleBannerHtml(isTeamTier) {
    const pct = Math.round(WINNER_FLOOR_ACH_PCT * 100);
    const achClause = isTeamTier
      ? `For DM/DSM, ASM and NSM, "Sales Achievement" means their TEAM'S Sales Achievement — every team member's raw sales value and raw target summed first, then divided once (a DM/DSM sums its own reps; an ASM/NSM sums its own DM/DSMs' already-team-summed totals) -- never an average of individual percentages.`
      : `For Medical Rep, CHC Sales Rep and Brand Manager, "Sales Achievement" is that person's own individual Sales Achievement.`;
    return `<div class="sp-floor-rule-banner">
      <div class="sp-floor-rule-icon">🚫</div>
      <div class="sp-floor-rule-body">
        <div class="sp-floor-rule-title">${pct}% SALES ACHIEVEMENT FLOOR — MONEY RULE</div>
        <div class="sp-floor-rule-text">No 🏆 WINNER / 🥈 RUNNER-UP badge and <b>no Monthly Sprint cash</b> goes to anyone below ${pct}% Sales Achievement — regardless of rank, Total Points, or any other KPI. ${achClause} If nobody in a BU or Line clears ${pct}% this month, that BU or Line has <b>no Sprinter and no payout at all</b> — the badge is never forced onto the highest scorer who still falls short. Ranking itself always stays honest and unaffected.</div>
      </div>
    </div>`;
  }

  // ---- Recognition Winners panel --------------------------------------
  // Per Ahmed 2026-08-16 ("make something explanation to avoid debates
  // and confusion about ranking and also make winners at top"): the
  // eligibility floor above means the actual 🏆/🥈 badge can now land
  // several rows down a long ranked table (see the CNS screenshot he
  // sent -- rank #1/#2 disqualified, WINNER badge sat on row 3, RUNNER-UP
  // on row 6), which reads as confusing/arguable without an explanation.
  // Fix: a small "podium" callout ABOVE the ranked table (Medical Rep,
  // CHC Sales Rep, Brand Manager only -- the three floor-gated tiers)
  // that surfaces exactly who the real winner(s) are, in plain language,
  // with the reasoning spelled out. Deliberately does NOT reorder the
  // ranked table itself or move winner rows to the top of it -- Ahmed's
  // own 2026-08-16 principle ("ranking stays honest and transparent")
  // means the # column and row order must stay pure rank-by-score; this
  // panel is an additive summary, not a re-sort.
  function winnerCardHtml(medal, tag, name, meta) {
    return `<div class="sp-winner-card"><div class="sp-winner-card-medal">${medal}</div><div class="sp-winner-card-info"><div class="sp-winner-card-tag">${esc(tag)}</div><div class="sp-winner-card-name">${esc(name)}</div><div class="sp-winner-card-meta">${esc(meta)}</div></div></div>`;
  }

  function emptyWinnerCardHtml(tag, reasonText) {
    return `<div class="sp-winner-card sp-winner-card-empty"><div class="sp-winner-card-tag">${esc(tag)}</div><div class="sp-winner-card-meta">${esc(reasonText)}</div></div>`;
  }

  function winnersPanelHtml(titleText, cardsHtml, noteHtml) {
    return `<div class="sp-winners-panel"><div class="sp-winners-panel-title">${esc(titleText)}</div><div class="sp-winners-panel-cards">${cardsHtml}</div><div class="sp-winners-panel-note">${noteHtml}</div></div>`;
  }

  // Per Ahmed 2026-08-18 17-section spec: rank/name/tier/points/3
  // KPI-vs-median blocks, sourced entirely from the single derived object
  // `d` (computeRepMedianData/computeLineWinnerPools) -- no calculation
  // happens in this function, only display. `d` is precomputed once per
  // render by renderMedicalRep() and passed in per row.
  function repRow(r, isRepTier, d) {
    const c = BAND_COLOR[band(r.totalPts)];
    const maxSales = isRepTier === "msr" ? 50 : 60;
    const maxCoverage = isRepTier === "msr" ? 10 : 40;
    const hasRf = isRepTier === "msr";
    return `<tr class="sp-row" data-line="${esc(r.canonLine)}" data-ach-pct="${r.achPct != null ? r.achPct : ""}" data-coverage-pct="${r.coveragePct != null ? r.coveragePct : ""}" data-rf-pct="${r.rightFreqPct != null ? r.rightFreqPct : ""}" data-rep-name="${esc(r.name)}" data-rep-total="${r.totalPts.toFixed(1)}">
      <td class="sp-rank"></td>
      <td class="sp-name">
        ${esc(r.name)}
        <div class="sp-tier-row">${recognitionTierBadgeHtml(d, r)}</div>
        <div class="sp-sub">${esc(r.canonLine)} · ${esc(r.position || r.role)} · #${esc(r.code)} · ${probationBadge(r)}${departingBadge(r)}</div>
        ${pointsCalcDetailsHtml(r, hasRf, maxSales, maxCoverage)}
      </td>
      <td>${kpiMedianBlock("Sales", r.achPct, d.lineAverageSales, d.salesVsAverage, r.salesPts, maxSales, d.salesFloorPass, "Sales", true, "Average")}</td>
      ${hasRf ? `<td>${kpiMedianBlock("Right Freq", r.rightFreqPct, d.lineAverageRF, d.rfVsAverage, r.rfPts, 40, d.rfFloorPass, "Right Freq", false, "Average")}</td>` : ""}
      <td>${kpiMedianBlock("Coverage", r.coveragePct, d.lineAverageCoverage, d.coverageVsAverage, r.covPts, maxCoverage, d.coverageFloorPass, "Coverage", false, "Average")}</td>
      <td class="sp-total">${totalPointsHeaderHtml(d, 100)}<span class="sp-band-pill" style="color:${c[0]};background:${c[1]};">${band(r.totalPts)}</span></td>
    </tr>`;
  }

  function excludedTable(items, idPrefix) {
    if (!items.length) return `<div style="padding:10px 0;color:#94A3B8;">None this month.</div>`;
    const rows = items.map(e => `<tr data-line="${esc(e.line || "")}" data-bu="${esc(e.bu || "")}"><td>${esc(e.code || "—")}</td><td>${esc(e.name)}</td><td>${esc(e.line || "")}</td><td>${esc(e.detail)}</td></tr>`).join("");
    return `<table${idPrefix ? ` id="${idPrefix}-body"` : ""}><thead><tr><th>Code</th><th>Name</th><th>Line</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function departingTable(items, idPrefix) {
    if (!items.length) return `<div style="padding:10px 0;color:#94A3B8;">None on file.</div>`;
    const rows = items.map(d => `<tr data-line="${esc(d.line || "")}"><td>${esc(d.code)}</td><td>${esc(d.name)}</td><td>${esc(d.line)}</td><td>${esc(d.resignationNotif || "")}</td><td>${esc(d.lastDay)}</td></tr>`).join("");
    return `<table${idPrefix ? ` id="${idPrefix}-body"` : ""}><thead><tr><th>Code</th><th>Name</th><th>Line</th><th>Resignation Notice</th><th>Last Day of Work</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // Medical Rep's panel is now built by msrSummaryPanelHtml (see the
  // computeLineWinnerPools block above) -- winner/runner-up/near-winner
  // status is intrinsic to each rep's own Line, precomputed once per
  // render, never re-derived from whichever <tr> attributes happen to be
  // visible under the current filter. This DOM-scanning version is
  // superseded and removed per Ahmed 2026-08-18 section 12.

  // DM/DSM's own live-recomputed panel, same DOM-scanning pattern the old
  // Medical Rep panel used to follow -- wired to the BU filter (see init()) via
  // wireRankFilter's isEligible/winnersPanelId/buildPanelHtml args. Reads
  // hierarchyRow's data-name/data-total/data-team-ach-pct/data-gate-pass
  // attributes (the DM/DSM-tier equivalent of repRow's data-rep-name/
  // data-rep-total/data-ach-pct). Per Ahmed 2026-08-16; gate switched to
  // BU Average 2026-08-19 (see hierarchyRow's data-gate-pass comment).
  function dmWinnersPanelHtml(winnerTr, runnerUpTr, filterVal) {
    const label = (!filterVal || filterVal === "__ALL__") ? "Company-wide (All BUs)" : `BU: ${filterVal}`;
    function fromTr(tr, medal, tag) {
      if (!tr) {
        return emptyWinnerCardHtml(tag, `No DM/DSM team in ${label} has cleared their own BU's peer-Average gate yet.`);
      }
      const name = tr.getAttribute("data-name") || "";
      const bu = tr.getAttribute("data-bu") || "";
      const total = tr.getAttribute("data-total") || "";
      const achRaw = tr.getAttribute("data-team-ach-pct");
      const achStr = (achRaw !== "" && achRaw != null) ? `${(parseFloat(achRaw) * 100).toFixed(1)}%` : "—";
      return winnerCardHtml(medal, tag, name, `${bu} · ${total} pts · ${achStr} Team Sales Achievement`);
    }
    // "RUNNER-UP" -> "WINNER 2", per Ahmed 2026-08-19: DM/DSM's #2 slot is
    // its own co-equal Winner, not a lesser rank -- same medal (🏆), same
    // "WINNER" wording, just numbered. Mirrors the 2026-08-18 "RUNNER-UP
    // change to Winner" tie-promotion rule already live for Medical Rep/
    // CHC Sales Rep (see computeLineWinnerPools), now applied to the
    // label itself, not just the tie case.
    const cards = fromTr(winnerTr, "🏆", "WINNER") + fromTr(runnerUpTr, "🏆", "WINNER 2");
    const note = `Rank <b>#</b> below reflects Total Points and never changes. Recognition (badge + Monthly Sprint cash) additionally requires the DM/DSM clearing their own BU's Average on every scored KPI at once (Team Avg, plus whichever of Field Working Days / DV Coverage / Calls per DV have real data) — replacing the old flat 70% Sales Achievement floor. A higher-ranked DM/DSM shown without a badge simply hasn't cleared that gate yet. The same rule gates each BU's own 🎖 BU Leader badge — if nobody in a BU clears it, that BU has no BU Leader this month.`;
    return winnersPanelHtml(`🏆 Recognition Winners — ${label}`, cards, note);
  }

  function renderMedicalRep() {
    const all = cache.medicalRepSalesRep.ranked.filter(r => r.role === "Medical Rep").filter(repInScope);
    // Per-Line medians, recomputed every render, read by kpiMedianBlock
    // (via computeRepMedianData) and lineMedianPanelHtml() -- see their
    // doc comments above (Ahmed 2026-08-18 Line Median Rule).
    msrLineMedians = computeLineMedians(all);
    // Single derived-data pass, per Ahmed 2026-08-18 section 14: every
    // rep's Layer 1 (median gate) + Layer 2 (points, read verbatim) +
    // Layer 3 (Winner Pool rank, per-Line) computed exactly once here --
    // repRow() and msrSummaryPanelHtml() below only ever READ derivedByCode
    // / lineSummary, never recompute.
    const { derivedByCode, lineSummary } = computeLineWinnerPools(all, msrLineMedians);
    msrLineSummary = lineSummary;
    const lines = [...new Set(all.map(r => r.canonLine))].sort();
    const sorted = [...all].sort((a, b) => b.totalPts - a.totalPts);
    const lineOptions = lines.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
    const scopedExcluded = cache.medicalRepSalesRep.excluded.filter(excludedInScope);
    const probExcl = scopedExcluded.filter(e => e.reason === "probation-not-passed");
    const inactiveExcl = scopedExcluded.filter(e => e.reason === "not-active-resigned");
    const departingSoon = cache.medicalRepSalesRep.departingSoon.filter(excludedInScope);

    return `
      <div class="sp-section">
        <h2>Medical Rep — ${esc(cache.meta.evalPeriod)} Leaderboard</h2>
        <div class="sp-section-sub">Sales Achievement (50) + Right Frequency (40) + Coverage (10) = 100 pts, this month's activity only. Total Points always ranks within the Winner Pool only (reps who cleared their own Line's average on Sales, Right Frequency AND Coverage) — see the tier badge and "Winner Pool #" on each row. The # rank column itself always reflects pure Total Points rank and is unaffected by eligibility.</div>
        ${lineMedianRuleBannerHtml()}
        <div id="sp-msr-winners-panel"></div>
        <div class="sp-filter-row">
          <label>Line:</label>
          <select id="sp-line-filter">
            <option value="__ALL__">All Lines (${all.length} reps)</option>
            ${lineOptions}
          </select>
        </div>
        <table>
          <thead><tr><th>#</th><th>Rep</th><th>Sales · 50</th><th>Right Freq · 40</th><th>Coverage · 10</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody id="sp-msr-body">${sorted.map(r => repRow(r, "msr", derivedByCode[r.code])).join("")}</tbody>
        </table>
      </div>
      <div class="sp-section">
        <h2>Eligibility Audit</h2>
        <div class="sp-section-sub">Filtering by Line above also filters these tables.</div>
        <details><summary id="sp-probexcl-summary" data-label="Excluded — Probation not yet passed">Excluded — Probation not yet passed (${probExcl.length})</summary>${excludedTable(probExcl, "sp-probexcl")}</details>
        <details><summary id="sp-inactive-summary" data-label="Excluded — Inactive/Resigned">Excluded — Inactive/Resigned (${inactiveExcl.length})</summary>${excludedTable(inactiveExcl, "sp-inactive")}</details>
        <details><summary id="sp-departing-summary" data-label="Departing Soon">Departing Soon (${departingSoon.length})</summary>${departingTable(departingSoon, "sp-departing")}</details>
      </div>
    `;
  }

  function renderSalesRep() {
    const all = cache.medicalRepSalesRep.ranked.filter(r => r.role === "Sales Rep (CHC)").filter(repInScope);
    const sorted = [...all].sort((a, b) => b.totalPts - a.totalPts);
    // Line Median Rule extended to CHC Sales Rep per Ahmed 2026-08-18
    // ("apply also for chc rep"). CHC Sales Rep is a single Line
    // ("CHC_SALES" -- confirmed, every CHC Sales Rep record shares it),
    // so computeLineMedians(all) returns one entry; no Line dropdown is
    // needed the way Medical Rep has one. Same single derived-data pass
    // as Medical Rep (Ahmed 2026-08-18 section 14) -- computeLineWinnerPools
    // ranks CHC's one Line's Winner Pool by Total Points; WINNER_FLOOR_ACH_PCT
    // stays inside the Points formula only (salesPts/covPts, unchanged,
    // still Sales 60 + Coverage 40).
    // FIXED 2026-08-19 ("CHC Sales Rep remove right frequency from sales
    // sprint"): Right Frequency no longer gates CHC eligibility either
    // (it already didn't score CHC points) -- computeRepMedianData's own
    // isChcSales branch now excludes RF from CHC's Winner Pool gate
    // entirely, so every hasRf flag below is false for CHC (previously
    // this call passed `true` to winnerPoolSummaryCardsHtml specifically
    // to keep showing RF as an "eligibility-only" KPI -- no longer
    // applicable, RF plays no role in CHC at all now).
    const medians = computeLineMedians(all);
    const { derivedByCode, lineSummary } = computeLineWinnerPools(all, medians);
    const ls = lineSummary["CHC_SALES"] || { medians, winner: null, runnerUp: null, poolRest: [], poolSize: 0, nearWinners: [], noWinnerThisCycle: true, tieAtRank1: false, tieAtRank2: false };
    // scenarioCompareHtml() call REMOVED 2026-08-19 ("remove show only avg
    // line no median") -- see msrSummaryPanelHtml's own comment above.
    const chcPanel = winnerPoolSummaryCardsHtml(ls, "CHC Sales Rep", false)
      + managerAuditViewHtml(ls, "CHC Sales Rep", false)
      + lineMedianPanelHtml("CHC_SALES", medians, false);

    return `
      <div class="sp-section">
        <h2>CHC Sales Rep — ${esc(cache.meta.evalPeriod)} Leaderboard</h2>
        <div class="sp-section-sub">Sales Achievement (60) + Coverage (40) = 100 pts. ${all.length} eligible reps. Total Points ranks within the Winner Pool only (reps who cleared the Line average on Sales AND Coverage) — see the tier badge and "Winner Pool #" on each row. The # rank column itself always reflects pure Total Points rank.</div>
        ${lineMedianRuleBannerHtml(false)}
        ${chcPanel}
        <table>
          <thead><tr><th>#</th><th>Rep</th><th>Sales · 60</th><th>Coverage · 40</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>${sorted.map((r, i) => salesRepRow(r, i, derivedByCode[r.code])).join("")}</tbody>
        </table>
      </div>
    `;
  }

  // Per Ahmed 2026-08-18 17-section spec, mirrors repRow() above -- reads
  // entirely from the precomputed derived object `d`. CHC scores no
  // Right Freq points (pointsCalcDetailsHtml's hasRf=false, points stay
  // Sales 60 + Coverage 40).
  // FIXED 2026-08-19 ("CHC Sales Rep remove right frequency from sales
  // sprint"): Right Freq no longer gates Winner Pool eligibility for CHC
  // either (see computeRepMedianData's isChcSales branch) -- its KPI
  // block/column is removed from this row entirely rather than kept as an
  // "eligibility only, no points" display, since RF now plays no role in
  // CHC's model at all, matching the deck (Sales 60 + Coverage 40 = 100).
  function salesRepRow(r, i, d) {
    const c = BAND_COLOR[band(r.totalPts)];
    return `<tr class="sp-row" data-rep-name="${esc(r.name)}" data-rep-total="${r.totalPts.toFixed(1)}">
      <td class="sp-rank">${i + 1}</td>
      <td class="sp-name">
        ${esc(r.name)}
        <div class="sp-tier-row">${recognitionTierBadgeHtml(d, r)}</div>
        <div class="sp-sub">${esc(r.position || "CHC Sales Rep")} · #${esc(r.code)} · ${probationBadge(r)}${departingBadge(r)}</div>
        ${pointsCalcDetailsHtml(r, false, 60, 40)}
      </td>
      <td>${kpiMedianBlock("Sales", r.achPct, d.lineAverageSales, d.salesVsAverage, r.salesPts, 60, d.salesFloorPass, "Sales", true, "Average")}</td>
      <td>${kpiMedianBlock("Coverage", r.coveragePct, d.lineAverageCoverage, d.coverageVsAverage, r.covPts, 40, d.coverageFloorPass, "Coverage", false, "Average")}</td>
      <td class="sp-total">${totalPointsHeaderHtml(d, 100)}<span class="sp-band-pill" style="color:${c[0]};background:${c[1]};">${band(r.totalPts)}</span></td>
    </tr>`;
  }

  // ---- KPI-slot rendering shared by DM/DSM, ASM, NSM, Brand Manager --
  // Each "kpi" is {key, label, weight, pts (or null while pending)} --
  // sourced from zeta sprint/Sprint_Missing_KPI_Template.xlsx once Ahmed
  // fills it in. A short label is derived from the full column header
  // for the table cell ("Field Working Days -- Points (0-10)" -> "Field
  // Working Days").
  function kpiShortLabel(label) {
    return label.split(" -- ")[0];
  }

  // KPI calculation methodology, per Ahmed 2026-08-16 ("Field Working
  // Days MAKE CALCULATION METHOD AS SUPPOSED FD/ ACTUAL FD (SINGLR OR
  // DOUBLE) DV Coverage NUMBER OF SUBORDINATATE SHOWN IN D.V/TOTAL TEAM
  // MEMBERS Calls per DV TOTAL D.V / D. V DAYS ITS TARGET IS 8 AND FOR
  // CHC_SALES DM IS 12 MAKE BEST PRACTICE EXPLAINING THE KPI"). These
  // three KPIs (DM/DSM: all three; ASM/NSM: Field Working Days only) are
  // still entered as a manual "Actual % Achieved" fraction in zeta
  // sprint/Sprint_Missing_KPI_Template.xlsx -- there's no raw double-
  // visit-level log in any connected cache to compute them from directly.
  // This documents the formula Ahmed uses to arrive at that % before
  // typing it in, so anyone reading the dashboard (or filling the
  // template next month) sees the same definition, rather than an opaque
  // percentage. Deliberately NOT renaming the template's actual column
  // headers to match -- etl/build_sprint_cache.py's load_kpi_template()
  // matches columns by exact header text against the ALREADY-FILLED live
  // workbook, so changing the wording there without touching the live
  // file would silently stop reading Ahmed's real entries as "missing".
  // Source xlsx files are never modified directly per this project's
  // standing rule; this stays a dashboard-only explanation.
  const KPI_METHODOLOGY = {
    fieldDays: {
      label: "Field Working Days",
      formula: "Actual Field Days ÷ Supposed (target) Field Days for the period",
      detail: "A field day counts once whether that day's work was a single visit or a double/joint (D.V.) visit -- either still counts as one worked field day.",
    },
    dvCoverage: {
      label: "DV Coverage",
      formula: "Team members who received ≥ 1 Double Visit (D.V.) this period ÷ total team members",
      detail: "Measures how much of the DM/DSM's own team they personally double-visited/coached this period, not how many total visits were made.",
    },
    callsPerDv: {
      label: "Calls per DV",
      formula: "Total Double Visits (D.V.) conducted ÷ Double Visit days worked",
      detail: "Target is 8 DVs/day for DM/DSM generally -- 12 DVs/day specifically for the DM/DSM managing the CHC_SALES line, per Ahmed 2026-08-16.",
    },
  };

  function kpiHeaderTitle(key) {
    const m = KPI_METHODOLOGY[key];
    return m ? `${m.label} = ${m.formula}. ${m.detail}` : "";
  }

  // Compact, collapsed-by-default explanation block (matches the
  // "Excluded" / "no scoreable team" <details> already in this section) --
  // full formula + target detail on demand, without permanently eating
  // vertical space the way the always-visible Band Legend does; this
  // content is longer/more technical, so a details/summary reads better
  // here than another persistent colored panel.
  function kpiMethodologyDetailsHtml(keys) {
    const items = (keys || []).map(k => KPI_METHODOLOGY[k]).filter(Boolean);
    if (!items.length) return "";
    return `<details class="sp-kpi-methodology">
      <summary>ⓘ How ${items.map(m => esc(m.label)).join(" / ")} ${items.length > 1 ? "are" : "is"} calculated</summary>
      <ul>${items.map(m => `<li><b>${esc(m.label)}</b> = ${esc(m.formula)}. ${esc(m.detail)}</li>`).join("")}</ul>
    </details>`;
  }

  function kpiSlotCell(kpi) {
    const shortLabel = kpiShortLabel(kpi.label) + (kpi.source === "auto" ? " (auto)" : "");
    if (kpi.key === "regionCount") {
      const pctText = kpi.raw != null ? `${kpi.raw} region${kpi.raw === 1 ? "" : "s"}` : null;
      return kpiBar(shortLabel, null, kpi.pts, kpi.weight, pctText);
    }
    const pctText = kpi.raw != null ? (kpi.raw * 100).toFixed(1) + "% actual" : null;
    return kpiBar(shortLabel, null, kpi.pts, kpi.weight, pctText);
  }

  function teamDrilldown(r) {
    if (!r.teamMembers || !r.teamMembers.length) return "";
    // Scoped too -- an ASM/NSM (BU-only scoped, see asmNsmInScope) can span
    // multiple Lines within their BU; without this a Line-restricted viewer
    // who can see the ASM would still see every OTHER Line's DM/DSM names
    // and points through the drilldown. dmOrBmInScope reads .bu/.line, which
    // every team-member dict already carries -- reused as-is.
    const members = r.teamMembers.filter(dmOrBmInScope);
    if (!members.length) return "";
    const noun = r.memberNoun === "DM/DSM" ? "DM/DSM" : "team member";
    const rows = members.map(m => `<tr>
        <td><button type="button" class="sp-member-link" data-code="${esc(m.code)}" title="View ${esc(m.name)}'s full achievement, KPIs, and points">${esc(m.name)}</button></td><td>${esc(m.code)}</td><td>${esc(m.line || "")}</td><td>${esc(m.role)}</td>
        <td style="text-align:right;">${m.totalPts != null ? m.totalPts.toFixed(1) : "—"}</td>
      </tr>`).join("");
    return `<details class="sp-team-drilldown">
        <summary>View ${members.length} ${esc(noun)}${members.length === 1 ? "" : "s"} — performance & points</summary>
        <table><thead><tr><th>Name</th><th>Code</th><th>Line</th><th>Role</th><th style="text-align:right;">Points</th></tr></thead><tbody>${rows}</tbody></table>
      </details>`;
  }

  // Click a team member's name in any drill-down (Medical Reps under a
  // DM/DSM, or DM/DSMs under an ASM/NSM) -> popup with their full
  // achievement/KPI/points breakdown -- per Ahmed 2026-08-15. Looks the
  // member up by employee code in whichever collection actually holds
  // full KPI detail for them (reps vs DM/DSMs), reusing the exact same
  // kpiBar()/kpiSlotCell() rendering as their own leaderboard row, so the
  // popup always matches what's shown elsewhere on the page.
  function findMemberRecord(code) {
    // Same employee code can surface in more than one tier's rollup -- e.g.
    // an ASM/NSM's code also appears as an empty/unscored placeholder row
    // in the DM/DSM rollup (confirmed 2026-08-15, code 183 and code 473 --
    // flagged to Ahmed, not silently reconciled at the ETL level in this
    // pass). Prefer whichever match actually has scored data (non-null
    // totalPts); among scored matches, first tier below wins.
    const tiers = [
      ["rep", cache.medicalRepSalesRep.ranked],
      ["dm", cache.dmDsm.ranked],
      ["asm", cache.asm.ranked],
      ["nsm", cache.nsm.ranked],
      ["bm", (cache.brandManager && cache.brandManager.ranked) || []],
    ];
    let best = null;
    for (const [kind, list] of tiers) {
      const rec = list.find(r => r.code === code);
      if (!rec) continue;
      if (!best) { best = { kind, data: rec }; continue; }
      if (best.data.totalPts == null && rec.totalPts != null) best = { kind, data: rec };
    }
    return best;
  }

  // Matches the logged-in dashboard user (AUTH session email) to their own
  // Sprint record, if they have one -- powers the "My Zeta Sprint Standing"
  // card on Overview. Several real login accounts ARE Sprint participants
  // (Line Manager accounts that are themselves NSMs/DSMs) -- per Ahmed
  // 2026-08-15 ("make better page besde zeta sprint").
  function findMyRecord() {
    const email = currentUserEmail();
    if (!email) return null;
    const tiers = [
      cache.medicalRepSalesRep.ranked,
      cache.dmDsm.ranked,
      cache.asm.ranked,
      cache.nsm.ranked,
      (cache.brandManager && cache.brandManager.ranked) || [],
    ];
    // Find this email's employee code in whichever tier lists it, then
    // delegate to findMemberRecord() for the canonical record -- that
    // function already resolves the case where one employee code surfaces
    // in more than one tier's rollup (e.g. an ASM/NSM's code also appears
    // as an empty/unscored placeholder "DM/DSM" row -- confirmed
    // 2026-08-15, codes 183 and 473 -- flagged to Ahmed, not silently
    // reconciled at the ETL level in this pass) by preferring the match
    // that actually has scored data.
    for (const list of tiers) {
      const rec = list.find(r => r.email && r.email.toLowerCase() === email);
      if (rec) return findMemberRecord(rec.code);
    }
    return null;
  }

  function myWinnerBadgeText(code) {
    const mine = computeMonthlyWinners().find(w => w.code === code);
    if (!mine) return "";
    const medal = mine.rankInGroup === "#1" ? "🏆" : "🥈";
    return `<span class="sp-winner-badge">${medal} WINNER — ${esc(mine.winnerGroup)}, ${esc(mine.rankInGroup)}</span>`;
  }

  const TIER_LABEL = { rep: null, dm: "DM/DSM", asm: "ASM", nsm: "NSM", bm: "Brand Manager" };

  function myPerformanceCardHtml() {
    const found = findMyRecord();
    if (!found) return "";
    const r = found.data;
    // Don't show the card at all when there's no scored data yet (a real,
    // active manager whose team just hasn't reported this month) -- a
    // "-- No data" card reads as broken, not informative. Per Ahmed
    // 2026-08-15 ("remove this Your June Zeta Sprint Standing ... No data").
    if (r.totalPts == null) return "";
    const c = BAND_COLOR[band(r.totalPts)];
    const tierLabel = TIER_LABEL[found.kind] || r.role;
    return `
      <div class="sp-my-card">
        <div class="sp-my-card-label">Your ${esc(cache.meta.evalPeriod)} Zeta Sprint Standing</div>
        <div class="sp-my-card-body">
          <div class="sp-my-card-name">${esc(r.name)} <span class="sp-my-card-tier">${esc(tierLabel)}</span>${myWinnerBadgeText(r.code)}</div>
          <div class="sp-my-card-total">
            <span class="sp-total-pts">${r.totalPts != null ? r.totalPts.toFixed(1) : "—"}</span>
            <span class="sp-band-pill" style="color:${c[0]};background:${c[1]};">${r.totalPts != null ? band(r.totalPts) : "No data"}</span>
          </div>
          <button type="button" class="sp-member-link sp-my-card-btn" data-code="${esc(r.code)}">View My Full Breakdown</button>
        </div>
      </div>`;
  }

  function openMemberModal(code) {
    if (!window.DS || typeof window.DS.openModal !== "function") {
      console.error("[Sprint] DS.openModal is unavailable -- cannot show member detail popup.");
      return;
    }
    const found = findMemberRecord(code);
    if (!found) {
      window.DS.openModal({
        title: "Not found",
        bodyHtml: `<p>No detailed record for code ${esc(code)} in the currently-viewed period.</p>`,
      });
      return;
    }
    const r = found.data;
    const c = BAND_COLOR[band(r.totalPts)];
    let kpisHtml, subInfo;

    if (found.kind === "rep") {
      const isMedicalRep = r.role === "Medical Rep";
      const maxSales = isMedicalRep ? 50 : 60;
      kpisHtml = kpiBar("Sales", r.achPct != null ? r.achPct * 100 : null, r.salesPts, maxSales)
        + (isMedicalRep ? kpiBar("Right Freq", r.rightFreqPct, r.rfPts, 40) : "")
        + kpiBar("Coverage", r.coveragePct, r.covPts, isMedicalRep ? 10 : 40);
      subInfo = `${esc(r.canonLine)} · ${esc(r.position || r.role)} · #${esc(r.code)}`;
    } else if (found.kind === "bm") {
      // Brand Manager: no Team Avg rollup (owns products, not a rep team).
      kpisHtml = r.kpis.map(k => kpiSlotCell(k)).join("");
      subInfo = `#${esc(r.code)}${r.line ? ` · ${esc(r.line)}` : ""} · ${esc(r.position || "Brand Manager")}`;
    } else {
      const lineBu = [r.line, r.bu].filter(Boolean).join(" · ");
      const noun = r.memberNoun === "DM/DSM" ? "DM/DSM" : "rep";
      kpisHtml = kpiBar("Team Avg", r.teamAvgRaw, r.teamAvgPts, r.teamAvgWeight)
        + r.kpis.map(k => kpiSlotCell(k)).join("");
      subInfo = `#${esc(r.code)}${lineBu ? ` · ${esc(lineBu)}` : ""} · ${r.teamSize} eligible ${esc(noun)}${r.teamSize === 1 ? "" : "s"} in team`;
    }

    const bodyHtml = `
      <div class="sp-member-modal">
        <div class="sp-member-modal-sub">${subInfo}${r.isDepartingSoon ? departingBadge(r) : ""}</div>
        <div class="sp-member-modal-kpis">${kpisHtml}</div>
        <div class="sp-member-modal-total">
          <span class="sp-total-pts">${r.totalPts != null ? r.totalPts.toFixed(1) : "—"}</span>
          <span class="sp-band-pill" style="color:${c[0]};background:${c[1]};">${r.totalPts != null ? band(r.totalPts) : "No data"}</span>
        </div>
        ${r.isPartial ? `<div class="sp-partial-note">Some KPIs are still pending your data sheet — not yet counted in this total.</div>` : ""}
      </div>`;

    window.DS.openModal({ title: r.name, bodyHtml });
  }

  function onSprintDocumentClick(e) {
    const btn = e.target.closest(".sp-member-link");
    if (btn) openMemberModal(btn.dataset.code);
  }

  // ---- KPI-vs-peer-Average chart block, manager tiers -- added
  // 2026-08-19 ("make charts and illustration like [you] made in medical
  // rep"): same visual language as Medical Rep/CHC Sales Rep's
  // kpiMedianBlock (label, current value, bar with a marker at the peer
  // Average, above/below fill color, "% of peer Average" readout, points,
  // pass/fail status) -- reuses those EXACT CSS classes (sp-kpi-median-*,
  // sp-median-bar-*), no new styling, so the DM/DSM/ASM/NSM pages read
  // exactly like the rep pages instead of the plain kpiBar cells they had
  // before this. teamAvg is a raw points scale (0-100ish, not a %) --
  // Field Working Days/DV Coverage/Calls per DV are 0-1 fractions --
  // isFraction controls formatting the same way kpiMedianBlock's own flag
  // does. val/avg/pass come straight from computeHierarchyGateData's own
  // `checks` array (the same numbers gating eligibility), never
  // recomputed here.
  function hierarchyKpiBlock(label, val, avg, pass, pts, maxPts, isFraction) {
    const fmt = v => v == null ? "—" : (isFraction ? (v * 100).toFixed(1) + "%" : v.toFixed(1) + " pts");
    const valStr = fmt(val);
    const avgStr = fmt(avg);
    const vsAvg = (val != null && avg != null && avg !== 0) ? (val / avg * 100) : null;
    const vsStr = vsAvg != null ? vsAvg.toFixed(1) + "% of peer Average" : "N/A";
    let barHtml;
    if (avg == null || avg === 0 || val == null) {
      barHtml = `<div class="sp-median-bar-track sp-median-bar-na">N/A — peer Average unavailable</div>`;
    } else {
      const domain = avg * 2;
      const fillPct = Math.max(0, Math.min(100, val / domain * 100));
      const above = val >= avg;
      barHtml = `<div class="sp-median-bar-track"><div class="sp-median-bar-fill ${above ? "sp-median-bar-above" : "sp-median-bar-below"}" style="width:${fillPct.toFixed(1)}%"></div><div class="sp-median-bar-marker" title="Peer Average ${esc(avgStr)}"></div></div>`;
    }
    const ptsStr = maxPts == null ? null : (pts != null ? `${pts.toFixed(1)} / ${maxPts} pts` : `— / ${maxPts} pts`);
    const floorHtml = pass == null ? "" : `<div class="sp-median-floor-status ${pass ? "sp-floor-above" : "sp-floor-below"}">${pass ? "✓" : "✗"} ${pass ? "Above" : "Below"} Peer Average</div>`;
    return `<div class="sp-kpi-median-block">
      <div class="sp-kpi-median-label">${esc(label)}</div>
      <div class="sp-kpi-median-val">${valStr}</div>
      <div class="sp-kpi-median-vsmed">vs Peer Avg ${avgStr}</div>
      ${barHtml}
      <div class="sp-kpi-median-pctofmed">${vsStr}</div>
      ${ptsStr != null ? `<div class="sp-kpi-median-pts">${ptsStr}</div>` : ""}
      ${floorHtml}
    </div>`;
  }

  // ---- Peer Averages panel, manager tiers -- added 2026-08-19, same
  // visual shape as Medical Rep/CHC Sales Rep's lineMedianPanelHtml
  // (📊 title + either a compact one-group readout or a full table across
  // every group), reusing its sp-line-median-* CSS classes verbatim.
  // sampleKpis is any scored record's own r.kpis (gives the KPI key/label
  // list and column order, same source renderHierarchyTier's kpiHeaders
  // already reads). isCompanyWide (ASM/NSM) always shows the single
  // national group, non-reactive (no BU filter exists for these tiers).
  // DM/DSM shows every BU at once when filterVal is "__ALL__"/unset, or
  // just the selected BU otherwise -- recomputed live on every BU filter
  // change (see init()).
  // includeTeamAvg, added 2026-08-19 ("apply qualyfying average rule to
  // bm"): Brand Manager has no Team Avg rollup at all (individual KPIs
  // only, see brandManagerRow/renderBrandManager) -- pass false so its
  // panel doesn't show a spurious "Team Avg —" column. Defaults to true,
  // UNCHANGED for every existing DM/DSM/ASM/NSM call site.
  function hierarchyAveragesPanelHtml(filterVal, groupAverages, sampleKpis, isCompanyWide, title, includeTeamAvg) {
    if (includeTeamAvg == null) includeTeamAvg = true;
    function fmtVal(key, v) {
      if (v == null) return "—";
      return key === "teamAvg" ? v.toFixed(1) + " pts" : (v * 100).toFixed(1) + "%";
    }
    const cols = [
      ...(includeTeamAvg ? [{ key: "teamAvg", label: "Team Avg" }] : []),
      ...(sampleKpis || []).map(k => ({ key: k.key, label: kpiShortLabel(k.label) })),
    ];
    if (isCompanyWide) {
      const avgs = (groupAverages && groupAverages["__ALL__"]) || {};
      const cells = cols.map(c => `<span><b>${esc(c.label)}</b> ${fmtVal(c.key, avgs[c.key])}</span>`).join("");
      return `<div class="sp-line-median-panel"><div class="sp-line-median-title">📊 NATIONAL ${esc(title.toUpperCase())} PEER AVERAGES — every scored ${esc(title)}</div><div class="sp-line-median-values">${cells}</div></div>`;
    }
    if (!filterVal || filterVal === "__ALL__") {
      const bus = Object.keys(groupAverages || {}).sort();
      if (!bus.length) return "";
      const rows = bus.map(bu => {
        const avgs = groupAverages[bu] || {};
        return `<tr><td>${esc(bu)}</td>${cols.map(c => `<td>${fmtVal(c.key, avgs[c.key])}</td>`).join("")}</tr>`;
      }).join("");
      const headers = cols.map(c => `<th>${esc(c.label)}</th>`).join("");
      return `<div class="sp-line-median-panel"><div class="sp-line-median-title">📊 BU PEER AVERAGES — every BU</div><table class="sp-line-median-table"><thead><tr><th>BU</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    const avgs = (groupAverages || {})[filterVal];
    if (!avgs) return "";
    const cells = cols.map(c => `<span><b>${esc(c.label)}</b> ${fmtVal(c.key, avgs[c.key])}</span>`).join("");
    return `<div class="sp-line-median-panel"><div class="sp-line-median-title">📊 BU PEER AVERAGES — ${esc(filterVal)}</div><div class="sp-line-median-values">${cells}</div></div>`;
  }

  function hierarchyRow(r, d, isWinner, isRunnerUp, buLeaders) {
    const c = BAND_COLOR[band(r.totalPts)];
    const lineBu = [r.line, r.bu].filter(Boolean).join(" · ");
    const noun = r.memberNoun === "DM/DSM" ? "DM/DSM" : "rep";
    const isBuLeader = buLeaders && r.bu && buLeaders.has(r.code);
    const tieFlag = (isWinner || isRunnerUp) && d && d.tie ? " ⚠ TIE" : "";
    // Both badge spans are always rendered (hidden via inline style when not
    // applicable) rather than only when isWinner/isRunnerUp is true, so the
    // BU filter's dynamic recompute (wireRankFilter) has an element to find
    // and toggle for every row, not just the one scored #1 pre-filter.
    // .sp-runnerup-badge's own displayed text is "🏆 WINNER 2" as of
    // 2026-08-19 (Ahmed: "replace runner-up by Winner 2") -- DM/DSM's #2
    // is a co-equal Winner, not a lesser rank; the CSS class name itself
    // is unchanged (internal only, never shown). This span only ever
    // shows for DM/DSM (the only tier with winnersCount >= 2) -- ASM/NSM
    // never set isRunnerUp true, so it stays hidden there.
    // data-gate-pass, added 2026-08-19: the peer-Average gate result
    // (computeHierarchyGateData), read by wireRankFilter's isEligible
    // callback for the live BU-filter recompute -- replaces the old
    // data-team-ach-pct-based floor test. data-team-ach-pct itself is
    // kept (still informational, still shown via teamAchNote below).
    // KPI cells: whenever computeHierarchyGateData found a real,
    // comparable check for this KPI (peer Average is known), render the
    // rich chart block (hierarchyKpiBlock, matches Medical Rep's
    // kpiMedianBlock visual). Otherwise (a pending/unfilled slot, or a
    // dataIssue record with no comparable KPI at all) fall back to the
    // plain kpiBar/kpiSlotCell, same "don't fabricate a bar against a
    // peer Average that doesn't exist" rule as everywhere else.
    const checksByKey = {};
    (d && d.checks || []).forEach(c => { checksByKey[c.key] = c; });
    const teamAvgCheck = checksByKey.teamAvg;
    const teamAvgCellHtml = teamAvgCheck
      ? hierarchyKpiBlock("Team Avg", r.teamAvgRaw, teamAvgCheck.avg, teamAvgCheck.pass, r.teamAvgPts, r.teamAvgWeight, false)
      : kpiBar("Team Avg", r.teamAvgRaw, r.teamAvgPts, r.teamAvgWeight);
    return `<tr class="sp-row${isWinner || isRunnerUp ? " sp-is-winner" : ""}" data-bu="${esc(r.bu || "")}" data-line="${esc(r.line || "")}" data-name="${esc(r.name)}" data-total="${r.totalPts != null ? r.totalPts.toFixed(1) : ""}" data-team-ach-pct="${r.teamSalesAchPct != null ? r.teamSalesAchPct : ""}" data-gate-pass="${d && d.winnerPoolEligible ? "1" : "0"}">
      <td class="sp-name">${esc(r.name)}<span class="sp-winner-badge"${isWinner ? "" : ' style="display:none;"'}>🏆 WINNER${tieFlag}</span><span class="sp-runnerup-badge"${isRunnerUp ? "" : ' style="display:none;"'}>🏆 WINNER 2</span>${isBuLeader ? `<span class="sp-leader-badge" title="Top performer for the ${esc(r.bu)} business unit">🎖 BU Leader</span>` : ""}<div class="sp-sub">#${esc(r.code)}${lineBu ? ` · <span class="sp-manager-line-badge">${esc(lineBu)}</span>` : ""} · ${r.teamSize} eligible ${esc(noun)}${r.teamSize === 1 ? "" : "s"} in team · ${probationBadge(r)}${r.teamSize > 0 && r.teamSalesAchPct != null ? teamAchNote(r) : ""}${hierarchyGateNote(d)}</div>${teamDrilldown(r)}</td>
      <td>${teamAvgCellHtml}</td>
      ${r.kpis.map(k => {
        const c = checksByKey[k.key];
        return `<td>${c ? hierarchyKpiBlock(kpiShortLabel(k.label), k.raw, c.avg, c.pass, k.pts, k.weight, true) : kpiSlotCell(k)}</td>`;
      }).join("")}
      <td class="sp-total">
        <!-- "Winner Pool #N", added 2026-08-19 ("add it to asm nsm dm"),
             reuses recognitionTierBadgeHtml's exact sp-pool-rank-note
             styling from Medical Rep -- d.winnerPoolRank was already
             computed by computeHierarchyWinnerPools (rank within this
             manager's own BU/national peer pool of gate-eligible peers,
             by Total Points), just not displayed until now. -->
        <div class="sp-total-pts">${r.totalPts != null ? r.totalPts.toFixed(1) : "—"}${d && d.winnerPoolEligible ? ` <span class="sp-pool-rank-note">Winner Pool #${d.winnerPoolRank}</span>` : ""}</div>
        <span class="sp-band-pill" style="color:${c[0]};background:${c[1]};">${r.totalPts != null ? band(r.totalPts) : "No data"}</span>
        ${r.isPartial ? `<div class="sp-partial-note">pending KPI${r.kpis.filter(k => k.pts == null).length > 1 || r.teamAvgPts == null ? "s" : ""} not yet in total</div>` : ""}
      </td>
    </tr>`;
  }

  function renderHierarchyTier(tierKey, title, formula, opts) {
    opts = opts || {};
    const data = cache[tierKey];
    // DM/DSM has one real home line -> bu+line scoping. ASM/NSM -> BU only
    // (see module doc "ACCESS MODEL"). dmOrBmInScope/asmNsmInScope only read
    // .bu/.line, so the same functions apply to both ranked and excluded
    // entries unchanged.
    const scopeFn = tierKey === "dmDsm" ? dmOrBmInScope : asmNsmInScope;
    const scored = data.ranked.filter(r => r.teamSize > 0).filter(scopeFn);
    const scopedExcluded = data.excluded.filter(scopeFn);
    const sorted = [...scored].sort((a, b) => (b.totalPts || 0) - (a.totalPts || 0));

    // ---- Winner Pool gate: BU Average (DM/DSM) / national peer Average
    // (ASM, NSM) -- added 2026-08-19, see "MANAGER-TIER WINNER POOL GATE"
    // above. Averages and the eligible pool are always computed from the
    // FULL unscoped national roster (data.ranked), never from `scored`
    // (this viewer's own BU/Line scope) -- same "the peer average must
    // reflect the true peer group, not whatever a restricted viewer
    // happens to see" rule as computeLineMedians for Medical Rep, and the
    // same reasoning as the pre-existing company-wide-winner rule below.
    const isCompanyWideTier = (tierKey === "asm" || tierKey === "nsm");
    const groupFn = tierKey === "dmDsm" ? (r => r.bu || "—") : (() => "__ALL__");
    const winnerSlots = tierKey === "dmDsm" ? 2 : 1;
    const fullScored = data.ranked.filter(r => r.teamSize > 0);
    const groupAverages = computeHierarchyAverages(fullScored, groupFn);
    const { derivedByCode, groupSummary } = computeHierarchyWinnerPools(fullScored, groupFn, groupAverages, winnerSlots);
    if (tierKey === "dmDsm") dmGroupAverages = groupAverages;

    // ASM/NSM: single COMPANY-WIDE winner (or co-winners on a rank-1
    // points tie), from groupSummary["__ALL__"] -- true company-wide
    // regardless of viewer scope, same "WINNER badge truth" rule as
    // before. DM/DSM keeps its existing scope-relative top-2-per-BU
    // display, now sourced from each row's OWN BU group in groupSummary
    // (isWinner/isRunnerUp below), still refined live by the BU filter
    // via wireRankFilter's DOM recompute (unchanged mechanism, updated
    // isEligible test -- see init()).
    const companyGroup = isCompanyWideTier ? groupSummary["__ALL__"] : null;
    const companyWinnerCodes = companyGroup ? companyGroup.winners.map(x => x.r.code) : [];

    const kpiKeys = (data.ranked[0] ? data.ranked[0].kpis : []).map(k => k.key);
    const kpiHeaders = (data.ranked[0] ? data.ranked[0].kpis : []).map(k => `<th title="${esc(kpiHeaderTitle(k.key))}">${esc(kpiShortLabel(k.label))}</th>`).join("");
    const anyPending = data.ranked.some(r => r.isPartial);
    const memberNoun = data.ranked[0] ? data.ranked[0].memberNoun : "rep";
    const teamNounPlural = memberNoun === "DM/DSM" ? "DM/DSMs" : "reps";

    // Per-BU "BU Leader" flags -- the top manager of EACH business unit,
    // shown alongside the single overall #1 WINNER badge -- per Ahmed
    // 2026-08-15. Only wired for tiers that opt in (DM/DSM). Gated
    // 2026-08-19 by the same BU-Average peer gate that determines
    // WINNER/RUNNER-UP (groupSummary[bu].pool[0] -- the top scorer among
    // those who clear their own BU's Average), replacing the old flat
    // 70% floor test.
    let buLeaders = null;
    let buFilterHtml = "";
    if (opts.buFilter) {
      buLeaders = new Set();
      const bus = [...new Set(scored.map(r => r.bu).filter(Boolean))].sort();
      bus.forEach(bu => {
        const gs = groupSummary[bu];
        const top = gs && gs.pool.length ? gs.pool[0].r : null;
        if (top) buLeaders.add(top.code);
      });
      const buOptions = bus.map(bu => `<option value="${esc(bu)}">${esc(bu)}</option>`).join("");
      buFilterHtml = `
        <div class="sp-filter-row">
          <label>BU:</label>
          <select id="${esc(opts.buFilter)}">
            <option value="__ALL__">All BUs (${scored.length} scored)</option>
            ${buOptions}
          </select>
        </div>`;
    }

    // Winner badge depth: DM/DSM ranks #1 AND #2 both carry a winner badge,
    // per Ahmed 2026-08-15 ("ranking number 1, 2 are winners in med rep
    // sales rep dsm"); ASM/NSM stay single-winner (not mentioned).
    const winnersCount = opts.winnersCount || 1;
    const winnerCopy = winnersCount >= 2
      ? `Rank #1 carries 🏆 WINNER and rank #2 carries 🏆 WINNER 2 — both are co-equal Winners, recomputed live as you filter by BU, and only among managers who clear their own BU's Average on every scored KPI (Team Avg, plus whichever of Field Working Days / DV Coverage / Calls per DV have real data). `
      : (isCompanyWideTier
          ? `🏆 WINNER marks the single company-wide top performer for this tier — true company-wide, even if you're only viewing your own BU's scope, and only among ${esc(title)}s who clear the national ${esc(title)} Average on every scored KPI. `
          : "");

    // Recognition Winners panel -- same "who actually won" podium pattern
    // as Medical Rep/CHC Sales Rep/Brand Manager, extended to DM/DSM/ASM/
    // NSM 2026-08-16, gate switched to the BU/national peer Average
    // 2026-08-19 (see above). DM/DSM is scope-relative and has a live BU
    // filter, so it gets an empty placeholder wired up by wireRankFilter
    // (see init(), mirrors msrWinnersPanelHtml exactly). ASM/NSM have no
    // filter to recompute against, so their single company-wide card
    // (now possibly TWO co-WINNER cards on a rank-1 points tie) is built
    // once, directly, right here -- always rendered (even with zero
    // eligible managers, via isCompanyWideTier rather than a
    // companyWinnerCodes null-check), so "nobody cleared the gate" still
    // shows the empty-state card instead of silently showing nothing.
    let winnersPanel = "";
    if (tierKey === "dmDsm") {
      winnersPanel = `<div id="sp-dm-winners-panel"></div>`;
    } else if (isCompanyWideTier) {
      const cards = companyWinnerCodes.length
        ? companyWinnerCodes.map(code => {
            const w = data.ranked.find(r => r.code === code);
            const d = derivedByCode[code];
            const tieTxt = d && d.tie ? " ⚠ TIE" : "";
            return winnerCardHtml("🏆", `WINNER${tieTxt}`, w.name, `${w.bu || ""} · ${w.totalPts.toFixed(1)} pts · clears the national ${title} Average (${d ? d.gatePassCount : "?"}/${d ? d.checks.length : "?"} KPIs)`);
          }).join("")
        : emptyWinnerCardHtml("WINNER", `No ${esc(title)} has cleared the national ${esc(title)} peer-Average gate yet.`);
      const note = `Row order above reflects Total Points and never changes. The single company-wide 🏆 WINNER additionally requires clearing the national ${esc(title)} Average on every scored KPI at once — a higher-scoring ${esc(title)} shown without the badge simply hasn't cleared that gate yet. A rank-1 points tie promotes every tied ${esc(title)} to co-WINNER rather than picking one arbitrarily.`;
      winnersPanel = winnersPanelHtml(`🏆 Recognition Winner — Corporate`, cards, note);
    }

    const bannerText = HIERARCHY_BANNER_TEXT[tierKey];

    return `
      <div class="sp-section">
        <h2>${esc(title)} — Team Avg Rollup${anyPending ? " (Partial)" : ""}</h2>
        <div class="sp-section-sub">${esc(formula)}. Team Avg is computed only from this team's active, past-probation ${esc(teamNounPlural)} for ${esc(cache.meta.evalPeriod)}. ${winnerCopy}${opts.buFilter ? "Each BU's own top performer carries a 🎖 BU Leader badge alongside the overall winner badge(s), same gate. " : ""}${anyPending ? '<span class="sp-tag-partial">SOME PENDING</span> — fill zeta sprint/Sprint_Missing_KPI_Template.xlsx and the next rebuild completes these automatically.' : '<span class="sp-tag-live">FULLY SCORED</span>'}</div>
        ${bannerText ? hierarchyGateRuleBannerHtml(bannerText.title, bannerText.en1, bannerText.en2, bannerText.ar1, bannerText.ar2) : ""}
        ${winnersPanel}
        ${tierKey === "dmDsm"
          ? `<div id="sp-dm-averages-panel">${hierarchyAveragesPanelHtml("__ALL__", groupAverages, data.ranked[0] ? data.ranked[0].kpis : [], false, title)}</div>`
          : hierarchyAveragesPanelHtml(null, groupAverages, data.ranked[0] ? data.ranked[0].kpis : [], true, title)}
        ${kpiMethodologyDetailsHtml(kpiKeys)}
        ${buFilterHtml}
        <table>
          <thead><tr><th>${esc(title.split(" ")[0])}</th><th>Team Avg</th>${kpiHeaders}<th style="text-align:right;">Total</th></tr></thead>
          <tbody${opts.bodyId ? ` id="${esc(opts.bodyId)}"` : ""}>${sorted.map((r, i) => {
            const d = derivedByCode[r.code];
            const isWinner = isCompanyWideTier ? companyWinnerCodes.includes(r.code) : (d && d.tier === "WINNER");
            const isRunnerUp = winnersCount >= 2 && d && d.tier === "RUNNER_UP";
            return hierarchyRow(r, d, isWinner, isRunnerUp, buLeaders);
          }).join("")}</tbody>
        </table>
        <details style="margin-top:14px;"><summary${opts.exclSummaryId ? ` id="${esc(opts.exclSummaryId)}" data-label="Excluded"` : ""}>Excluded (${scopedExcluded.length})</summary>${excludedTable(scopedExcluded, opts.exclBodyId)}</details>
      </div>
    `;
  }

  // d, added 2026-08-19 ("apply qualyfying average rule to bm"): the
  // derived peer-Average gate object from computeHierarchyGateData
  // (computed once per Brand Manager in renderBrandManager, same as
  // hierarchyRow's own `d` for DM/DSM/ASM/NSM). isWinner now comes from
  // that gate (companyWinnerCodes), not the old flat Sales Ach% floor.
  // regionCount is a raw COUNT (1-5), not a %/pts value -- hierarchyKpiBlock
  // only knows how to format those two, so regionCount always falls back
  // to the plain kpiSlotCell() cell (which already special-cases it as
  // "N regions") even when it has a real peer-Average check -- it's still
  // fully counted in the eligibility gate math, just not chart-rendered.
  function brandManagerRow(r, d, isWinner) {
    const c = BAND_COLOR[band(r.totalPts)];
    const checksByKey = {};
    (d && d.checks || []).forEach(ch => { checksByKey[ch.key] = ch; });
    return `<tr class="sp-row${isWinner ? " sp-is-winner" : ""}">
      <td class="sp-name">${esc(r.name)}${isWinner ? '<span class="sp-winner-badge">🏆 WINNER</span>' : ""}<div class="sp-sub">#${esc(r.code)} · ${esc(r.position || "Brand Manager")}${r.line ? ` · <span class="sp-manager-line-badge">${esc(r.line)}</span>` : ""} · ${probationBadge(r)}${hierarchyGateNote(d, { badgeLabel: "WINNER", hasCash: false })}</div></td>
      ${r.kpis.map(k => {
        const ch = checksByKey[k.key];
        return `<td>${ch && k.key !== "regionCount" ? hierarchyKpiBlock(kpiShortLabel(k.label), k.raw, ch.avg, ch.pass, k.pts, k.weight, true) : kpiSlotCell(k)}</td>`;
      }).join("")}
      <td class="sp-total">
        <div class="sp-total-pts">${r.totalPts.toFixed(1)}${d && d.winnerPoolEligible ? ` <span class="sp-pool-rank-note">Winner Pool #${d.winnerPoolRank}</span>` : ""}</div>
        <span class="sp-band-pill" style="color:${c[0]};background:${c[1]};">${band(r.totalPts)}</span>
        ${r.isPartial ? `<div class="sp-partial-note">pending KPIs not yet in total</div>` : ""}
      </td>
    </tr>`;
  }

  function renderBrandManager() {
    const data = cache.brandManager;
    if (!data || !data.ranked.length) {
      return `<div class="sp-section"><h2>Brand Manager</h2><div class="sp-notes">No Brand Manager data yet.</div></div>`;
    }
    const ranked = data.ranked.filter(dmOrBmInScope);
    if (!ranked.length) {
      return `<div class="sp-section"><h2>Brand Manager</h2><div class="sp-notes">No Brand Manager in your scope this month.</div></div>`;
    }
    const sorted = [...ranked].sort((a, b) => b.totalPts - a.totalPts);
    const kpiHeaders = ranked[0].kpis.map(k => `<th>${esc(kpiShortLabel(k.label))}</th>`).join("");
    const anyPending = ranked.some(r => r.isPartial);

    // Winner Pool gate: national Brand Manager Average -- SWITCHED
    // 2026-08-19 per Ahmed ("apply qualyfying average rule to bm"), from
    // the flat WINNER_FLOOR_ACH_PCT/meetsSalesFloor Sales Ach% floor to
    // the same peer-Average gate as ASM/NSM (computeHierarchyAverages/
    // computeHierarchyWinnerPools, winnerSlots=1 -- single company-wide
    // WINNER, rank-1 points tie promotes every tied Brand Manager to
    // co-WINNER rather than picking one arbitrarily, no Winner 2/BU
    // Leader concept for this tier). scopeFn is `() => true` rather than
    // the default `r.teamSize > 0` -- Brand Manager has no team rollup
    // at all (individual KPIs only), every scored record counts.
    // Verified against real August cache data before shipping: eligible
    // pool shrinks 10 -> 8 (2 Brand Managers who cleared the old 70%
    // floor but sit below the ~109% peer Average on National Sales now
    // lose the WINNER badge, though their points/rank are untouched).
    // ALSO surfaced a real tie the old single-pick `.sort()[0]` logic
    // never handled: MennatAllah Saad Zaky AND Shady Ahmed Mahmoud both
    // cap out at the max 50.0 National Sales pts (both >130% Ach%) --
    // the old code silently picked whichever sorted first (array order),
    // the new tie-aware pool now correctly shows BOTH as co-WINNER.
    // floorRuleBannerHtml/meetsSalesFloor/bmSalesAch/WINNER_FLOOR_ACH_PCT
    // are NOT deleted (still used by Medical Rep/CHC's points-floor
    // display and their own doc comments) -- just no longer called here.
    // Always computed from the FULL unscoped roster (data.ranked), never
    // the viewer-scoped `ranked`, same "true peer group" rule as every
    // other tier.
    const bmGroupAverages = computeHierarchyAverages(data.ranked, () => "__ALL__", () => true);
    const { derivedByCode, groupSummary } = computeHierarchyWinnerPools(data.ranked, () => "__ALL__", bmGroupAverages, 1, () => true);
    const companyGroup = groupSummary["__ALL__"];
    const companyWinnerCodes = companyGroup ? companyGroup.winners.map(x => x.r.code) : [];

    const cards = companyWinnerCodes.length
      ? companyWinnerCodes.map(code => {
          const w = data.ranked.find(r => r.code === code);
          const d = derivedByCode[code];
          const tieTxt = d && d.tie ? " ⚠ TIE" : "";
          return winnerCardHtml("🏆", `WINNER${tieTxt}`, w.name, `${w.position || "Brand Manager"} · ${w.totalPts.toFixed(1)} pts · clears the national Brand Manager Average (${d ? d.gatePassCount : "?"}/${d ? d.checks.length : "?"} KPIs)`);
        }).join("")
      : emptyWinnerCardHtml("WINNER", `No Brand Manager has cleared the national Brand Manager peer-Average gate yet.`);
    const bmWinnersNote = `Row order above reflects Total Points and never changes. The single company-wide 🏆 WINNER additionally requires clearing the national Brand Manager Average on every scored KPI at once — a higher-scoring Brand Manager shown without the badge simply hasn't cleared that gate yet (see the note on their own row). A rank-1 points tie promotes every tied Brand Manager to co-WINNER rather than picking one arbitrarily. Recognition only — Brand Manager has no Monthly Sprint cash tier.`;
    const bmWinnersPanel = winnersPanelHtml("🏆 Recognition Winner — Corporate", cards, bmWinnersNote);

    const bannerText = HIERARCHY_BANNER_TEXT.bm;

    return `
      <div class="sp-section">
        <h2>Brand Manager — ${esc(cache.meta.evalPeriod)}${anyPending ? " (Partial)" : ""}</h2>
        <div class="sp-section-sub">National Sales (50, auto-calculated from each Brand Manager's assigned Line) + Region Coverage (20) + Tactical Plan Execution (30) = 100 pts. Brand Managers own products, not a rep team, so there's no Team Avg rollup here — Region Coverage and Tactical Plan Execution are sourced from zeta sprint/Sprint_Missing_KPI_Template.xlsx. 🏆 WINNER marks the single company-wide top performer, true company-wide even if you're only viewing your own BU's scope (recognition only — Brand Manager has no Monthly Sprint cash tier in the Recognition &amp; Rewards deck), and only among Brand Managers who clear the national Brand Manager Average on every scored KPI. ${anyPending ? '<span class="sp-tag-partial">SOME PENDING</span>' : '<span class="sp-tag-live">FULLY SCORED</span>'}</div>
        ${hierarchyGateRuleBannerHtml(bannerText.title, bannerText.en1, bannerText.en2, bannerText.ar1, bannerText.ar2)}
        ${bmWinnersPanel}
        ${hierarchyAveragesPanelHtml(null, bmGroupAverages, ranked[0] ? ranked[0].kpis : [], true, "Brand Manager", false)}
        <table>
          <thead><tr><th>Brand Manager</th>${kpiHeaders}<th style="text-align:right;">Total</th></tr></thead>
          <tbody>${sorted.map(r => brandManagerRow(r, derivedByCode[r.code], companyWinnerCodes.includes(r.code))).join("")}</tbody>
        </table>
        <details style="margin-top:10px;"><summary>Excluded (${data.excluded.length})</summary>${excludedTable(data.excluded)}</details>
      </div>
    `;
  }

  // ---- layout / sub-tabs ---------------------------------------------
  function getPageContentHTML() {
    if (STATE.subTab === "overview") return renderOverview();
    if (STATE.subTab === "msr") return renderMedicalRep();
    if (STATE.subTab === "sr") {
      // Defensive: the sub-tab button itself is hidden for a viewer without
      // CHC in scope, but STATE.subTab could still be stale ("sr") from a
      // prior session/role -- fall back to Overview rather than render a
      // leaderboard the viewer shouldn't see.
      if (!canViewChcSalesRepTab()) { STATE.subTab = "overview"; return renderOverview(); }
      return renderSalesRep();
    }
    if (STATE.subTab === "dm") return renderHierarchyTier("dmDsm", "DM / DSM", "Team Avg (70) + Field Working Days (10) + DV Coverage (10) + Calls per DV (10)",
      { buFilter: "sp-dm-bu-filter", bodyId: "sp-dm-body", exclSummaryId: "sp-dm-excl-summary", exclBodyId: "sp-dm-excl", winnersCount: 2 });
    if (STATE.subTab === "asm") return renderHierarchyTier("asm", "ASM", "Team Avg of their DM/DSMs (80) + Field Days (20)");
    if (STATE.subTab === "nsm") return renderHierarchyTier("nsm", "NSM", "Team Avg of their DM/DSMs (80) + Field Days (20)");
    if (STATE.subTab === "bm") return renderBrandManager();
    if (STATE.subTab === "calculator") {
      return `
        <div class="sp-section" style="padding: 0; background: transparent; box-shadow: none; border: none; overflow: hidden; margin-top: 15px;">
          <iframe src="zeta%20sprint/Zeta%20Sprint%20Points%20Calculator%20-%20FINAL.html" style="width: 100%; height: calc(100vh - 220px); border: none; border-radius: 12px; box-shadow: var(--shadow-sm, 0 1px 2px 0 rgba(0,0,0,0.05)); background: #ffffff;"></iframe>
        </div>
      `;
    }
    return "";
  }

  // Generic filter-dropdown wiring, shared by the Medical Rep Line filter
  // and the DM/DSM BU filter: recomputes visible rank + which row keeps
  // the dynamic 🏆 WINNER badge, and cascades the same filter to any
  // linked audit tables (Excluded / Departing Soon) via their id prefixes.
  // isEligible (optional): tr -> boolean, checked before a row is allowed
  // to carry the winner/runner-up badge. The DM/DSM BU filter passes one
  // -- originally (2026-08-16) DM/DSM's own team-level 70% Sales
  // Achievement floor, SWITCHED 2026-08-19 to the BU-Average peer gate
  // via data-gate-pass (see module docblock "MANAGER-TIER WINNER POOL
  // GATE" / hierarchyRow's data-gate-pass comment). The rank shown in
  // the # column is NEVER affected by eligibility -- only which row(s),
  // if any, get the badge.
  // winnersPanelId / buildPanelHtml (optional, both together): after each
  // recompute, writes a "Recognition Winners" summary into the given
  // element id, built by buildPanelHtml(winnerTr, runnerUpTr, val) -- see
  // msrWinnersPanelHtml / dmWinnersPanelHtml. Both the Medical Rep Line
  // filter and the DM/DSM BU filter pass these, since either one can push
  // the true (floor-eligible) winner out of view or bury it below an
  // ineligible higher scorer.
  function wireRankFilter(selectEl, bodySelector, filterAttr, cascadePrefixes, isEligible, winnersPanelId, buildPanelHtml) {
    if (!selectEl) return;
    selectEl.addEventListener("change", () => {
      const val = selectEl.value;
      let rank = 0;
      let eligibleRank = 0;
      let winnerTr = null;
      let runnerUpTr = null;
      // Ranks #1 and #2 of the currently-visible (filtered) set both carry
      // a winner badge -- per Ahmed 2026-08-15 ("ranking number 1, 2 are
      // winners"). Recomputed live on every filter change.
      // Direct-child combinator only -- bodySelector is a <tbody>, and each
      // row's name cell can contain its own nested team-drilldown <table>
      // (DM/DSM). A plain descendant selector would also match THOSE inner
      // <tr> elements (no data-bu attribute -> filtered out -> incorrectly
      // hidden even while the drilldown is open) -- caught 2026-08-15 when
      // Ahmed checked the drilldown while BU-filtered.
      document.querySelectorAll(`${bodySelector} > tr`).forEach(tr => {
        const show = (val === "__ALL__" || tr.getAttribute(filterAttr) === val);
        tr.style.display = show ? "" : "none";
        const winnerBadge = tr.querySelector(".sp-winner-badge");
        const runnerUpBadge = tr.querySelector(".sp-runnerup-badge");
        const rankCell = tr.querySelector(".sp-rank");
        if (show) {
          rank += 1;
          if (rankCell) rankCell.textContent = rank;
          // Rank (the # column) always counts every visible row, eligible
          // or not -- "ranking stays honest and transparent". The badge
          // itself only ever lands on eligible rows, cascading to the
          // next-eligible one when a higher-ranked row is disqualified.
          let isWinner = false;
          let isRunnerUp = false;
          if (!isEligible || isEligible(tr)) {
            eligibleRank += 1;
            isWinner = eligibleRank === 1;
            isRunnerUp = eligibleRank === 2;
            if (isWinner) winnerTr = tr;
            if (isRunnerUp) runnerUpTr = tr;
          }
          tr.classList.toggle("sp-is-winner", isWinner || isRunnerUp);
          if (winnerBadge) winnerBadge.style.display = isWinner ? "" : "none";
          if (runnerUpBadge) runnerUpBadge.style.display = isRunnerUp ? "" : "none";
        } else {
          tr.classList.remove("sp-is-winner");
          if (winnerBadge) winnerBadge.style.display = "none";
          if (runnerUpBadge) runnerUpBadge.style.display = "none";
        }
      });
      (cascadePrefixes || []).forEach(prefix => {
        const body = document.getElementById(`${prefix}-body`);
        const summary = document.getElementById(`${prefix}-summary`);
        if (!body) return;
        let count = 0;
        body.querySelectorAll("tbody > tr").forEach(tr => {
          const show = (val === "__ALL__" || tr.getAttribute(filterAttr) === val);
          tr.style.display = show ? "" : "none";
          if (show) count += 1;
        });
        if (summary) summary.textContent = `${summary.dataset.label} (${count})`;
      });
      if (winnersPanelId && buildPanelHtml) {
        const panel = document.getElementById(winnersPanelId);
        if (panel) panel.innerHTML = buildPanelHtml(winnerTr, runnerUpTr, val);
      }
    });
    selectEl.dispatchEvent(new Event("change"));
  }

  // ---- Winners CSV export ---------------------------------------------
  // Monthly Sprint cash prize per tier, sourced from Ahmed's PPT
  // ("zeta sprint/Zeta_Sprint_2026_Complete.pptx", slides 11-15,
  // "Recognition & Rewards", Monthly Sprint column only -- Quarterly
  // Champions / Annual Marathon have their own higher amounts in that same
  // deck, not wired up here since those periods aren't built yet). Brand
  // Manager is excluded entirely: the deck states BMs compete at
  // Quarterly/Annual only, no Monthly Sprint. Confirmed with Ahmed
  // 2026-08-15.
  const MONTHLY_CASH = {
    "Medical Rep": 1000,
    "Sales Rep (CHC)": 1000,
    "DM/DSM": 2000,
    "ASM": 3000,
    "NSM": 4000,
  };

  // UNUSED as of 2026-08-19 -- computeMonthlyWinners's DM/DSM payout used
  // to take a flat top-2-by-points-per-BU from the floor-filtered list via
  // this helper; it now reads DM/DSM winner/runnerUp straight from
  // computeHierarchyWinnerPools's groupSummary (BU-Average-gated, tie-
  // aware), same source the on-screen badges use. Left in place rather
  // than deleted (out of scope for this fix), same convention as
  // lineMedianGateResult above.
  function topNByGroup(records, groupFn, n) {
    const groups = new Map();
    records.forEach(r => {
      if (r.totalPts == null) return;
      const g = groupFn(r);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    });
    const out = [];
    groups.forEach((items, g) => {
      items.sort((a, b) => b.totalPts - a.totalPts);
      items.slice(0, n).forEach((r, i) => out.push({ group: g, rank: i + 1, r }));
    });
    return out;
  }

  // Real winner structure per the PPT: Medical Rep / CHC Sales Rep get 2
  // winners PER LINE; DM/DSM gets 2 winners PER BU; ASM/NSM get 1
  // Corporate winner each. As of the 2026-08-18 Winner Page rebuild, the
  // Medical Rep / CHC Sales Rep on-screen badges ARE already a true
  // per-Line Winner Pool top-2 (computeLineWinnerPools, same source this
  // CSV now reads from below) -- this note about the CSV being "broader
  // than the screen" is stale for those two tiers and kept only for
  // DM/DSM (still BU-filter-relative on screen, see wireRankFilter).
  // Direct Manager / Direct Manager BU come straight from each record
  // (etl/build_sprint_cache.py step 7b, sourced from Database
  // Shortcut.xlsx's own org-chart columns -- covers every tier including
  // ASM/NSM, per Ahmed 2026-08-15 "asm and nsm name of manager and bu not
  // present").
  //
  // SUPERSEDED 2026-08-18 (Line Median Rule / Winner Page rebuild): Medical
  // Rep and CHC Sales Rep no longer gate on Sales Achievement >=
  // WINNER_FLOOR_ACH_PCT (70%) here -- that was the OLD rule. The CSV now
  // reads directly from computeLineWinnerPools()'s own Winner Pool (Sales
  // AND Coverage each >= that rep's own Line AVERAGE for CHC Sales Rep;
  // Sales, Right Frequency AND Coverage for Medical Rep -- see
  // computeRepMedianData's isChcSales branch, updated 2026-08-19 "CHC
  // Sales Rep remove right frequency from sales sprint", ranked #1/#2 by
  // Total Points within the pool) -- the exact same derived data the
  // on-screen rows/badges use, so the CSV and the screen can never
  // disagree about who gets paid. FURTHER SWITCHED 2026-08-19 ("ok make
  // winner pool gate according to average instead of median"): the gate
  // itself moved from Line Median to Line Average -- this CSV needed no
  // code change to pick that up, since it already reads winnerPoolEligible
  // verbatim rather than re-implementing the comparison. See
  // computeRepMedianData / computeLineWinnerPools above for the full rule.
  //
  // Per Ahmed 2026-08-16 (round 2, "DM DSM HAS REWARD ALSO MAKE SAME
  // FLOOR LOGIC FOR ASM NSM"): DM/DSM, ASM, NSM used to carry the same
  // flat 70% team floor here (meetsTeamSalesFloor(r.teamSalesAchPct)).
  // SWITCHED 2026-08-19 ("apply the winner pool eligibility gate for
  // other layer dm sm asm nsm dm dsm average of bu"): these three tiers
  // now read their winner/runner-up rows straight from
  // computeHierarchyWinnerPools's groupSummary (BU Average for DM/DSM,
  // national peer Average for ASM/NSM) -- see the code just above. Brand
  // Manager remains excluded from this export entirely (no Monthly
  // Sprint cash tier at all), so its own floor gate (see
  // renderBrandManager) only ever affects its on-screen badge, never
  // this CSV.
  function computeMonthlyWinners() {
    const rows = [];
    const msrAll = cache.medicalRepSalesRep.ranked;
    const medicalReps = msrAll.filter(r => r.role === "Medical Rep");
    const salesReps = msrAll.filter(r => r.role === "Sales Rep (CHC)");
    // Gate SWITCHED 2026-08-19 ("apply the winner pool eligibility gate
    // for other layer dm sm asm nsm dm dsm average of bu") from the flat
    // 70% Sales Achievement floor to the same peer-Average gate now
    // driving the on-screen WINNER/RUNNER-UP/BU Leader badges
    // (computeHierarchyAverages/computeHierarchyWinnerPools, see
    // "MANAGER-TIER WINNER POOL GATE" above) -- BU Average for DM/DSM,
    // national peer Average for ASM/NSM. Reads directly from
    // groupSummary so the CSV and the screen can never disagree about
    // who got paid, same "single derived data object" discipline as
    // Medical Rep/CHC Sales Rep below. If a BU (DM/DSM) or the whole
    // company (ASM/NSM) has nobody eligible, it simply produces zero
    // rows for that group -- no forced payout.
    const dmFullScored = cache.dmDsm.ranked.filter(r => r.teamSize > 0);
    const dmAverages = computeHierarchyAverages(dmFullScored, r => r.bu || "—");
    const { groupSummary: dmGroupSummary } = computeHierarchyWinnerPools(dmFullScored, r => r.bu || "—", dmAverages, 2);

    const asmFullScored = cache.asm.ranked.filter(r => r.teamSize > 0);
    const asmAverages = computeHierarchyAverages(asmFullScored, () => "__ALL__");
    const { groupSummary: asmGroupSummary } = computeHierarchyWinnerPools(asmFullScored, () => "__ALL__", asmAverages, 1);

    const nsmFullScored = cache.nsm.ranked.filter(r => r.teamSize > 0);
    const nsmAverages = computeHierarchyAverages(nsmFullScored, () => "__ALL__");
    const { groupSummary: nsmGroupSummary } = computeHierarchyWinnerPools(nsmFullScored, () => "__ALL__", nsmAverages, 1);

    [["Medical Rep", medicalReps], ["CHC Sales Rep", salesReps]].forEach(([title, records]) => {
      const cashKey = title === "CHC Sales Rep" ? "Sales Rep (CHC)" : title;
      const medians = computeLineMedians(records);
      const { lineSummary } = computeLineWinnerPools(records, medians);
      Object.keys(lineSummary).forEach(line => {
        const ls = lineSummary[line];
        [ls.winner, ls.runnerUp].forEach((entry, idx) => {
          if (!entry) return;
          const r = entry.r;
          rows.push({
            title, name: r.name, code: r.code, position: r.position || "",
            hireDate: r.hireDate || "", line: r.canonLine || "", bu: r.bu || "",
            winnerGroup: `Line: ${line}`, rankInGroup: `#${idx + 1}`,
            directManager: r.directManager || "", directManagerBu: r.directManagerBu || "",
            money: MONTHLY_CASH[cashKey], totalPts: r.totalPts,
          });
        });
      });
    });

    Object.keys(dmGroupSummary).forEach(bu => {
      const gs = dmGroupSummary[bu];
      [gs.winner, gs.runnerUp].forEach((entry) => {
        if (!entry) return;
        const r = entry.r;
        // A tied #2 was already promoted to co-WINNER (d.tier === "WINNER")
        // inside computeHierarchyWinnerPools -- rankInGroup reflects that,
        // same convention as Medical Rep/CHC Sales Rep's tie handling.
        rows.push({
          title: "DM/DSM", name: r.name, code: r.code, position: "",
          hireDate: r.hireDate || "", line: r.line || "", bu: r.bu || "",
          winnerGroup: `BU: ${bu}`, rankInGroup: entry.d.tier === "WINNER" ? "#1" : "#2",
          directManager: r.directManager || "", directManagerBu: r.directManagerBu || "",
          money: MONTHLY_CASH["DM/DSM"], totalPts: r.totalPts,
        });
      });
    });

    [["ASM", asmGroupSummary], ["NSM", nsmGroupSummary]].forEach(([title, gsMap]) => {
      const gs = gsMap["__ALL__"];
      if (!gs || !gs.winners.length) return;
      // Normally a single winner; a rank-1 points tie produces more than
      // one co-WINNER row here (see computeHierarchyWinnerPools) rather
      // than an arbitrary pick.
      gs.winners.forEach(entry => {
        const winner = entry.r;
        rows.push({
          title, name: winner.name, code: winner.code, position: "",
          hireDate: winner.hireDate || "", line: winner.line || "", bu: winner.bu || "",
          winnerGroup: "Corporate", rankInGroup: "#1",
          directManager: winner.directManager || "", directManagerBu: winner.directManagerBu || "",
          money: MONTHLY_CASH[title], totalPts: winner.totalPts,
        });
      });
    });

    return rows;
  }

  function csvCell(v) {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadWinnersCsv() {
    const rows = computeMonthlyWinners();
    const headers = ["Title", "Name", "Code", "Position", "Hiring Date", "Month / Period", "Line", "BU",
      "Winner Group", "Rank in Group", "Direct Manager", "Direct Manager BU",
      "Recognition Tier", "Money of Recognition (L.E)", "Total Points"];
    const periodLabel = `${cache.meta.evalPeriod} 2026`;
    const lines = [headers.join(",")];
    rows.forEach(r => {
      lines.push([
        r.title, r.name, r.code, r.position, r.hireDate, periodLabel, r.line, r.bu,
        r.winnerGroup, r.rankInGroup, r.directManager, r.directManagerBu,
        "Monthly Sprint", r.money, r.totalPts != null ? r.totalPts.toFixed(1) : "",
      ].map(csvCell).join(","));
    });
    // Leading BOM so Excel opens the UTF-8 file cleanly (many winner names
    // are Arabic-transliterated with non-ASCII characters).
    const csvText = "﻿" + lines.join("\r\n") + "\r\n";
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zeta_sprint_winners_${cache.meta.evalPeriod}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function periodSelectorHtml() {
    const options = PERIOD_DEFS.map(p => {
      const ready = periodReady(p.key);
      return `<option value="${esc(p.key)}"${!ready ? " disabled" : ""}>${esc(p.label)}${ready ? "" : " — not yet available"}</option>`;
    }).join("");
    return `<select id="sp-period-select">${options}</select>`;
  }

  function renderPeriodPendingState(periodKey) {
    const def = PERIOD_DEFS.find(p => p.key === periodKey);
    const archivedMonths = [...new Set([
      ...(currentMonthCache ? [currentMonthCache.meta.evalPeriod] : []),
      ...historyIndex.map(p => p.name),
    ])];
    if (def.cumulative) {
      const missing = def.months.filter(m => !monthArchived(m));
      return `
        <div class="sp-section">
          <h2>${esc(def.label)}</h2>
          <div class="sp-notes">
            <p>This is a cumulative period (sums ${def.months.join(" + ")}). Two things have to be true before it can show real numbers: every constituent month needs to be archived, <b>and</b> the cross-month summing rule needs to be defined and confirmed with Ahmed (does a rep who's excluded one month still count if eligible the others? Does the 0-100 point band scale change for a multi-month total? etc.) -- that rule isn't guessed at here, it needs a real decision.</p>
            <p>${missing.length ? `Still missing from the archive: <b>${missing.map(esc).join(", ")}</b>.` : "All constituent months are archived — the summing rule is the only thing left to define."}</p>
            <p>Currently archived: <b>${archivedMonths.map(esc).join(", ") || "none yet"}</b>.</p>
          </div>
        </div>`;
    }
    const missing = def.months.filter(m => !monthArchived(m));
    return `
      <div class="sp-section">
        <h2>${esc(def.label)}</h2>
        <div class="sp-notes">
          <p>This period isn't built yet. It needs ${missing.length > 1 ? "these months" : "this month"} loaded into the main dashboard (Coverage + Sales caches) and the Sprint ETL re-run for ${missing.length > 1 ? "each of them" : "it"}: <b>${missing.map(esc).join(", ")}</b>.</p>
          <p>Currently archived: <b>${archivedMonths.map(esc).join(", ") || "none yet"}</b>.</p>
        </div>
      </div>`;
  }

  function renderLayout() {
    const root = document.getElementById("app-root");
    if (!root) return;

    const currentPeriodReady = periodReady(STATE.period);

    root.innerHTML = `
      <div class="sp-page">
        <div class="sp-header">
          <div class="sp-header-logo"><img src="zeta_sprint_logo.png" alt="Zeta Sprint" /></div>
          <div class="sp-header-text">
            <h1>ZETA SPRINT 2026</h1>
            <p>${esc(cache.meta.evalPeriod)} 2026 Monthly Ranking · ${esc(cache.meta.periodStart)} – ${esc(cache.meta.periodEnd)} · Verified from live platform data, not self-reported</p>
          </div>
          <div class="sp-header-period">
            <label>Period:</label>
            ${periodSelectorHtml()}
          </div>
          ${currentPeriodReady && canDownloadWinnersCsv() ? `<div class="sp-header-actions">
            <button type="button" id="sp-download-winners" class="sp-download-btn" title="Every Monthly Sprint winner as a CSV -- Medical Rep/CHC Sales Rep: 2 per Line, DM/DSM: 2 per BU, ASM/NSM: 1 Corporate each -- with Direct Manager and Money of Recognition, per the Recognition &amp; Rewards deck. Every row requires clearing the 70% Sales Achievement floor (team-summed for DM/DSM/ASM/NSM) -- a Line/BU/company with nobody eligible simply has no row here.">⬇ Download Winners CSV</button>
          </div>` : ""}
        </div>
        <div class="sc-nav-tabs">
          ${[
            ["overview", "🧭 Overview"],
            ["msr", "💊 Medical Rep"],
            ["sr", "🏪 CHC Sales Rep"],
            ["dm", "👔 DM / DSM"],
            ["asm", "🗺 ASM"],
            ["nsm", "🧭 NSM"],
            ["bm", "🎯 Brand Manager"],
            ["calculator", "🧮 Points Calculator"],
          ].filter(([key]) => key !== "sr" || canViewChcSalesRepTab())
            .map(([key, label]) => `<button class="sc-tab ${STATE.subTab === key ? "sc-tab-active" : ""}" data-tab="${key}">${label}</button>`).join("")}
        </div>
        ${currentPeriodReady && STATE.subTab !== "calculator" ? bandLegendHtml() : ""}
        <div style="flex:1;padding:24px;overflow-y:auto;">
          <div id="sp-tab-content">${currentPeriodReady ? getPageContentHTML() : renderPeriodPendingState(STATE.period)}</div>
        </div>
      </div>
    `;

    document.querySelectorAll(".sc-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        STATE.subTab = tab.dataset.tab;
        renderLayout();
      });
    });

    const periodSelectEl = document.getElementById("sp-period-select");
    if (periodSelectEl) {
      periodSelectEl.value = STATE.period;
      periodSelectEl.addEventListener("change", async () => {
        const newKey = periodSelectEl.value;
        const def = PERIOD_DEFS.find(p => p.key === newKey);
        periodSelectEl.disabled = true;
        if (def && !def.cumulative && periodReady(newKey)) {
          // Whichever tab (Overview / Medical Rep / DM-DSM / ...) was open
          // stays open -- only the underlying data (`cache`) switches.
          const monthName = def.months[0];
          const data = await loadPeriodData(monthName);
          if (!data) {
            console.error(`[Sprint] Failed to load archived period "${monthName}" -- staying on "${STATE.period}".`);
            periodSelectEl.disabled = false;
            return;
          }
          cache = data;
        }
        STATE.period = newKey;
        renderLayout();
      });
    }

    const downloadBtn = document.getElementById("sp-download-winners");
    if (downloadBtn) downloadBtn.addEventListener("click", downloadWinnersCsv);

    if (!currentPeriodReady) return;

    // Winner Page gate for Medical Rep, per Ahmed 2026-08-18 17-section
    // spec: Line Median Rule, recognitionTier/winnerPoolRank precomputed
    // once per render by computeLineWinnerPools (see renderMedicalRep) --
    // wireLineFilter only shows/hides rows by Line and swaps the summary
    // panel via an O(1) lookup into msrLineSummary, never re-derives
    // eligibility from the DOM the way the old wireRankFilter did.
    // (meetsSalesFloor/WINNER_FLOOR_ACH_PCT stay defined above for the
    // other tiers below, untouched.)
    wireLineFilter(document.getElementById("sp-line-filter"), "#sp-msr-body",
      ["sp-probexcl", "sp-inactive", "sp-departing"],
      "sp-msr-winners-panel", () => msrLineSummary, true);
    // DM/DSM: floor extended here 2026-08-16 ("DM DSM HAS REWARD ALSO"),
    // then switched to the BU-Average peer gate 2026-08-19 ("apply the
    // winner pool eligibility gate for other layer dm sm asm nsm dm dsm
    // average of bu") -- isEligible now reads hierarchyRow's own
    // precomputed data-gate-pass attribute (computeHierarchyGateData,
    // already evaluated against this row's own BU peer average at render
    // time -- correct regardless of which BU filter is later applied),
    // and dmWinnersPanelHtml recomputes the live "who actually won"
    // podium on every BU filter change, same pattern as Medical Rep above.
    wireRankFilter(document.getElementById("sp-dm-bu-filter"), "#sp-dm-body", "data-bu",
      ["sp-dm-excl"],
      tr => tr.getAttribute("data-gate-pass") === "1",
      "sp-dm-winners-panel", dmWinnersPanelHtml);
    // Peer Averages panel, recomputed live on the same BU filter change --
    // added 2026-08-19 ("make charts and illustration like [you] made in
    // medical rep"), mirrors how Medical Rep's Line Median panel
    // recomputes via wireLineFilter. A second, independent "change"
    // listener on the same <select> (addEventListener supports more than
    // one) rather than extending wireRankFilter itself, which only knows
    // about a single winners panel -- reads dmGroupAverages, the
    // module-level map set by renderHierarchyTier on every DM render,
    // same pattern as msrLineMedians.
    const dmBuFilterEl = document.getElementById("sp-dm-bu-filter");
    if (dmBuFilterEl) {
      dmBuFilterEl.addEventListener("change", () => {
        const panel = document.getElementById("sp-dm-averages-panel");
        if (!panel) return;
        const sample = (cache.dmDsm.ranked[0] && cache.dmDsm.ranked[0].kpis) || [];
        panel.innerHTML = hierarchyAveragesPanelHtml(dmBuFilterEl.value, dmGroupAverages, sample, false, "DM / DSM");
      });
    }
  }

  window.SprintDashboard = {
    async init(containerId) {
      if (!canViewSprintPage()) {
        renderSprintAccessRestricted();
        return;
      }
      decompressCache();
      if (isCacheStale()) {
        console.warn("[Sprint] cache is stale or missing; showing pending-refresh placeholder.");
        renderCachePendingState();
        return;
      }
      document.body.classList.add("sprint-mode");
      ready = true;
      // Named function reference -- addEventListener dedupes identical
      // (type, listener) pairs, so this stays safe even if init() runs
      // again on tab re-entry (no duplicate popups per click).
      document.addEventListener("click", onSprintDocumentClick);
      await loadHistoryIndex(); // so the Period dropdown reflects real archived months from the first paint
      renderLayout();
    },
    // Exposed for app.js to gate the nav entry itself -- see the
    // "ACCESS MODEL, round 3" module doc bullet above.
    canView: canViewSprintPage,
    destroy() {
      document.body.classList.remove("sprint-mode");
      document.removeEventListener("click", onSprintDocumentClick);
    },
  };
})();
