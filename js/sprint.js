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

  // Brand Manager's Sales Achievement isn't a top-level field like
  // achPct -- it's nested in r.kpis (etl/build_sprint_cache.py's
  // key='salesAch' entry, raw = the underlying fraction).
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

  function repRow(r, isRepTier) {
    const c = BAND_COLOR[band(r.totalPts)];
    const maxSales = isRepTier === "msr" ? 50 : 60;
    return `<tr class="sp-row" data-line="${esc(r.canonLine)}" data-ach-pct="${r.achPct != null ? r.achPct : ""}" data-rep-name="${esc(r.name)}" data-rep-total="${r.totalPts.toFixed(1)}">
      <td class="sp-rank"></td>
      <td class="sp-name">${esc(r.name)}<span class="sp-winner-badge" style="display:none;">🏆 WINNER</span><span class="sp-runnerup-badge" style="display:none;">🥈 WINNER</span><div class="sp-sub">${esc(r.canonLine)} · ${esc(r.position || r.role)} · #${esc(r.code)} · ${probationBadge(r)}${departingBadge(r)}${meetsSalesFloor(r.achPct) ? "" : floorNote()}</div></td>
      <td>${kpiBar("Sales", r.achPct != null ? r.achPct * 100 : null, r.salesPts, maxSales)}</td>
      ${isRepTier === "msr" ? `<td>${kpiBar("Right Freq", r.rightFreqPct, r.rfPts, 40)}</td>` : ""}
      <td>${kpiBar("Coverage", r.coveragePct, r.covPts, isRepTier === "msr" ? 10 : 40)}</td>
      <td class="sp-total"><div class="sp-total-pts">${r.totalPts.toFixed(1)}</div><span class="sp-band-pill" style="color:${c[0]};background:${c[1]};">${band(r.totalPts)}</span></td>
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

  // Medical Rep's panel is recomputed live on every Line filter change
  // (winnerTr/runnerUpTr come from wireRankFilter's own per-row pass, so
  // this reads whatever it already determined -- no separate recompute).
  function msrWinnersPanelHtml(winnerTr, runnerUpTr, filterVal) {
    const label = (!filterVal || filterVal === "__ALL__") ? "Company-wide (All Lines)" : `Line: ${filterVal}`;
    function fromTr(tr, medal, tag) {
      if (!tr) {
        return emptyWinnerCardHtml(tag, `No rep in ${label} has cleared the ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Sales Achievement floor yet.`);
      }
      const name = tr.getAttribute("data-rep-name") || "";
      const line = tr.getAttribute("data-line") || "";
      const total = tr.getAttribute("data-rep-total") || "";
      const achRaw = tr.getAttribute("data-ach-pct");
      const achStr = (achRaw !== "" && achRaw != null) ? `${(parseFloat(achRaw) * 100).toFixed(1)}%` : "—";
      return winnerCardHtml(medal, tag, name, `${line} · ${total} pts · ${achStr} Sales Achievement`);
    }
    const cards = fromTr(winnerTr, "🏆", "WINNER") + fromTr(runnerUpTr, "🥈", "RUNNER-UP");
    const note = `Rank <b>#</b> below reflects total score (Sales + Right Freq + Coverage) and never changes. Recognition (badge + Monthly Sprint cash) additionally requires clearing ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Sales Achievement — a higher-ranked rep shown without a badge simply hasn't cleared that floor yet (see the "Below floor" note on their own row).`;
    return winnersPanelHtml(`🏆 Recognition Winners — ${label}`, cards, note);
  }

  // DM/DSM's own live-recomputed panel, same pattern as
  // msrWinnersPanelHtml above -- wired to the BU filter (see init()) via
  // wireRankFilter's isEligible/winnersPanelId/buildPanelHtml args. Reads
  // hierarchyRow's data-name/data-total/data-team-ach-pct attributes
  // (the DM/DSM-tier equivalent of repRow's data-rep-name/data-rep-total/
  // data-ach-pct). Per Ahmed 2026-08-16.
  function dmWinnersPanelHtml(winnerTr, runnerUpTr, filterVal) {
    const label = (!filterVal || filterVal === "__ALL__") ? "Company-wide (All BUs)" : `BU: ${filterVal}`;
    function fromTr(tr, medal, tag) {
      if (!tr) {
        return emptyWinnerCardHtml(tag, `No DM/DSM team in ${label} has cleared the ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Team Sales Achievement floor yet.`);
      }
      const name = tr.getAttribute("data-name") || "";
      const bu = tr.getAttribute("data-bu") || "";
      const total = tr.getAttribute("data-total") || "";
      const achRaw = tr.getAttribute("data-team-ach-pct");
      const achStr = (achRaw !== "" && achRaw != null) ? `${(parseFloat(achRaw) * 100).toFixed(1)}%` : "—";
      return winnerCardHtml(medal, tag, name, `${bu} · ${total} pts · ${achStr} Team Sales Achievement`);
    }
    const cards = fromTr(winnerTr, "🏆", "WINNER") + fromTr(runnerUpTr, "🥈", "RUNNER-UP");
    const note = `Rank <b>#</b> below reflects Total Points and never changes. Recognition (badge + Monthly Sprint cash) additionally requires the DM/DSM's OWN TEAM clearing ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Sales Achievement — summed across every rep beneath them, never averaged. A higher-ranked DM/DSM shown without a badge simply hasn't cleared that floor yet. The same rule gates each BU's own 🎖 BU Leader badge — if nobody in a BU clears the floor, that BU has no BU Leader this month.`;
    return winnersPanelHtml(`🏆 Recognition Winners — ${label}`, cards, note);
  }

  function renderMedicalRep() {
    const all = cache.medicalRepSalesRep.ranked.filter(r => r.role === "Medical Rep").filter(repInScope);
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
        <div class="sp-section-sub">Sales Achievement (50) + Right Frequency (40) + Coverage (10) = 100 pts, this month's activity only. Ranks #1 (🏆 WINNER) and #2 (🥈 WINNER) both carry a winner badge — recomputed live as you filter by Line, and only among reps who clear ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Sales Achievement (the # rank column itself is unaffected).</div>
        ${floorRuleBannerHtml(false)}
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
          <tbody id="sp-msr-body">${sorted.map(r => repRow(r, "msr")).join("")}</tbody>
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
    // Winner/runner-up go to the top-2 ELIGIBLE reps (Sales Achievement
    // >= WINNER_FLOOR_ACH_PCT), cascading past any ineligible higher-
    // ranked rep -- the # column below still reflects true totalPts rank
    // for everyone, unaffected by eligibility.
    const eligibleSorted = sorted.filter(r => meetsSalesFloor(r.achPct));
    const winnerCode = eligibleSorted[0] ? eligibleSorted[0].code : null;
    const runnerUpCode = eligibleSorted[1] ? eligibleSorted[1].code : null;

    function chcCard(r, medal, tag) {
      if (!r) return emptyWinnerCardHtml(tag, `No CHC Sales Rep has cleared the ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Sales Achievement floor yet.`);
      const achStr = r.achPct != null ? `${(r.achPct * 100).toFixed(1)}%` : "—";
      return winnerCardHtml(medal, tag, r.name, `${r.position || "CHC Sales Rep"} · ${r.totalPts.toFixed(1)} pts · ${achStr} Sales Achievement`);
    }
    const chcWinnersNote = `Rank <b>#</b> below reflects total score (Sales + Coverage) and never changes. Recognition (badge + Monthly Sprint cash) additionally requires clearing ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Sales Achievement — a higher-ranked rep shown without a badge simply hasn't cleared that floor yet (see the "Below floor" note on their own row).`;
    const chcWinnersPanel = winnersPanelHtml("🏆 Recognition Winners",
      chcCard(eligibleSorted[0], "🏆", "WINNER") + chcCard(eligibleSorted[1], "🥈", "RUNNER-UP"),
      chcWinnersNote);

    return `
      <div class="sp-section">
        <h2>CHC Sales Rep — ${esc(cache.meta.evalPeriod)} Leaderboard</h2>
        <div class="sp-section-sub">Sales Achievement (60) + Coverage (40) = 100 pts. ${all.length} eligible reps. Ranks #1 (🏆 WINNER) and #2 (🥈 WINNER) both carry a winner badge — only among reps who clear ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Sales Achievement (the # rank column itself is unaffected).</div>
        ${floorRuleBannerHtml(false)}
        ${chcWinnersPanel}
        <table>
          <thead><tr><th>#</th><th>Rep</th><th>Sales · 60</th><th>Coverage · 40</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>${sorted.map((r, i) => salesRepRow(r, i, winnerCode, runnerUpCode)).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function salesRepRow(r, i, winnerCode, runnerUpCode) {
    const c = BAND_COLOR[band(r.totalPts)];
    const isWinner = winnerCode != null && r.code === winnerCode;
    const isRunnerUp = runnerUpCode != null && r.code === runnerUpCode;
    return `<tr class="sp-row${isWinner || isRunnerUp ? " sp-is-winner" : ""}">
      <td class="sp-rank">${i + 1}</td>
      <td class="sp-name">${esc(r.name)}${isWinner ? '<span class="sp-winner-badge">🏆 WINNER</span>' : ""}${isRunnerUp ? '<span class="sp-runnerup-badge">🥈 WINNER</span>' : ""}<div class="sp-sub">${esc(r.position || "CHC Sales Rep")} · #${esc(r.code)} · ${probationBadge(r)}${departingBadge(r)}${meetsSalesFloor(r.achPct) ? "" : floorNote()}</div></td>
      <td>${kpiBar("Sales", r.achPct != null ? r.achPct * 100 : null, r.salesPts, 60)}</td>
      <td>${kpiBar("Coverage", r.coveragePct, r.covPts, 40)}</td>
      <td class="sp-total"><div class="sp-total-pts">${r.totalPts.toFixed(1)}</div><span class="sp-band-pill" style="color:${c[0]};background:${c[1]};">${band(r.totalPts)}</span></td>
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

  function hierarchyRow(r, isWinner, isRunnerUp, buLeaders) {
    const c = BAND_COLOR[band(r.totalPts)];
    const lineBu = [r.line, r.bu].filter(Boolean).join(" · ");
    const noun = r.memberNoun === "DM/DSM" ? "DM/DSM" : "rep";
    const isBuLeader = buLeaders && r.bu && buLeaders.has(r.code);
    // Both badge spans are always rendered (hidden via inline style when not
    // applicable) rather than only when isWinner/isRunnerUp is true, so the
    // BU filter's dynamic recompute (wireRankFilter) has an element to find
    // and toggle for every row, not just the one scored #1 pre-filter.
    return `<tr class="sp-row${isWinner || isRunnerUp ? " sp-is-winner" : ""}" data-bu="${esc(r.bu || "")}" data-line="${esc(r.line || "")}" data-name="${esc(r.name)}" data-total="${r.totalPts != null ? r.totalPts.toFixed(1) : ""}" data-team-ach-pct="${r.teamSalesAchPct != null ? r.teamSalesAchPct : ""}">
      <td class="sp-name">${esc(r.name)}<span class="sp-winner-badge"${isWinner ? "" : ' style="display:none;"'}>🏆 WINNER</span><span class="sp-runnerup-badge"${isRunnerUp ? "" : ' style="display:none;"'}>🥈 WINNER</span>${isBuLeader ? `<span class="sp-leader-badge" title="Top performer for the ${esc(r.bu)} business unit">🎖 BU Leader</span>` : ""}<div class="sp-sub">#${esc(r.code)}${lineBu ? ` · <span class="sp-manager-line-badge">${esc(lineBu)}</span>` : ""} · ${r.teamSize} eligible ${esc(noun)}${r.teamSize === 1 ? "" : "s"} in team · ${probationBadge(r)}${r.teamSize > 0 && r.teamSalesAchPct != null ? teamAchNote(r) : ""}</div>${teamDrilldown(r)}</td>
      <td>${kpiBar("Team Avg", r.teamAvgRaw, r.teamAvgPts, r.teamAvgWeight)}</td>
      ${r.kpis.map(k => `<td>${kpiSlotCell(k)}</td>`).join("")}
      <td class="sp-total">
        <div class="sp-total-pts">${r.totalPts != null ? r.totalPts.toFixed(1) : "—"}</div>
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

    // ASM/NSM: single COMPANY-WIDE winner, computed from the FULL unscoped
    // roster -- never from `scored` (which is filtered to this viewer's own
    // BU/Line scope). See module doc "WINNER badge truth" above. DM/DSM
    // keeps its existing scope-relative top-2-per-BU-filter behavior.
    // Both floor-gated 2026-08-16 (meetsTeamSalesFloor) -- the cascade
    // drops any manager whose TEAM Sales Achievement falls short of 70%
    // and moves to the next-eligible one by totalPts; if literally nobody
    // clears the floor, companyWinnerCode is undefined and the empty-state
    // card below reports "no winner this month" rather than forcing the
    // badge onto whoever scored highest. isCompanyWideTier (NOT a
    // `!== undefined` check on companyWinnerCode) is what distinguishes
    // "this tier has no company-wide-winner concept" (DM/DSM) from "this
    // tier has the concept but nobody qualified this month" (ASM/NSM,
    // floor cleared by nobody) -- both leave companyWinnerCode undefined,
    // so they'd be indistinguishable without this explicit flag, and a
    // bug that used the old `!== undefined` shortcut here would silently
    // fall back to badging the highest BU-scoped scorer even when they
    // hadn't cleared the floor.
    const isCompanyWideTier = (tierKey === "asm" || tierKey === "nsm");
    const companyWinnerCode = isCompanyWideTier
      ? ([...data.ranked].filter(r => r.totalPts != null).filter(meetsTeamSalesFloor).sort((a, b) => b.totalPts - a.totalPts)[0] || {}).code
      : undefined;
    // DM/DSM's scope-relative top-2 (see comment above), same floor.
    const eligibleScoped = sorted.filter(r => r.totalPts != null && meetsTeamSalesFloor(r));
    const scopedWinnerCode = eligibleScoped[0] ? eligibleScoped[0].code : undefined;
    const scopedRunnerUpCode = eligibleScoped[1] ? eligibleScoped[1].code : undefined;

    const kpiKeys = (data.ranked[0] ? data.ranked[0].kpis : []).map(k => k.key);
    const kpiHeaders = (data.ranked[0] ? data.ranked[0].kpis : []).map(k => `<th title="${esc(kpiHeaderTitle(k.key))}">${esc(kpiShortLabel(k.label))}</th>`).join("");
    const anyPending = data.ranked.some(r => r.isPartial);
    const memberNoun = data.ranked[0] ? data.ranked[0].memberNoun : "rep";
    const teamNounPlural = memberNoun === "DM/DSM" ? "DM/DSMs" : "reps";

    // Per-BU "BU Leader" flags -- the top manager of EACH business unit,
    // shown alongside the single overall #1 WINNER badge -- per Ahmed
    // 2026-08-15. Only wired for tiers that opt in (DM/DSM).
    let buLeaders = null;
    let buFilterHtml = "";
    if (opts.buFilter) {
      buLeaders = new Set();
      const bus = [...new Set(scored.map(r => r.bu).filter(Boolean))].sort();
      bus.forEach(bu => {
        // Floor-gated 2026-08-16: a BU's own top scorer only gets the 🎖
        // BU Leader badge if THEIR team clears 70% Sales Achievement. If
        // nobody in that BU does, .add() is simply never called for it --
        // that BU has no BU Leader this month, same "no forced badge"
        // rule as everywhere else on this page.
        const top = scored.filter(r => r.bu === bu && r.totalPts != null).filter(meetsTeamSalesFloor).sort((a, b) => b.totalPts - a.totalPts)[0];
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
      ? `Ranks #1 (🏆 WINNER) and #2 (🥈 WINNER) both carry a winner badge — recomputed live as you filter by BU, and only among managers whose TEAM clears ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Sales Achievement. `
      : (isCompanyWideTier
          ? `🏆 WINNER marks the single company-wide top performer for this tier — true company-wide, even if you're only viewing your own BU's scope, and only among managers whose FULL reporting team clears ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Sales Achievement. `
          : "");

    // Recognition Winners panel -- same "who actually won" podium pattern
    // as Medical Rep/CHC Sales Rep/Brand Manager, extended to DM/DSM/ASM/
    // NSM 2026-08-16. DM/DSM is scope-relative and has a live BU filter,
    // so it gets an empty placeholder wired up by wireRankFilter (see
    // init(), mirrors msrWinnersPanelHtml exactly). ASM/NSM have no filter
    // to recompute against, so their single company-wide card is built
    // once, directly, right here -- always rendered (even with zero
    // eligible managers, via isCompanyWideTier rather than a
    // companyWinnerCode null-check), so "nobody cleared the floor" still
    // shows the empty-state card instead of silently showing nothing.
    let winnersPanel = "";
    if (tierKey === "dmDsm") {
      winnersPanel = `<div id="sp-dm-winners-panel"></div>`;
    } else if (isCompanyWideTier) {
      const w = companyWinnerCode ? data.ranked.find(r => r.code === companyWinnerCode) : null;
      const card = w
        ? winnerCardHtml("🏆", "WINNER", w.name, `${w.bu || ""} · ${w.totalPts.toFixed(1)} pts · ${(w.teamSalesAchPct * 100).toFixed(1)}% Team Sales Achievement`)
        : emptyWinnerCardHtml("WINNER", `No ${esc(title)} team has cleared the ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Team Sales Achievement floor yet.`);
      const note = `Row order above reflects Total Points and never changes. The single company-wide 🏆 WINNER additionally requires that ${esc(title)}'s FULL reporting team (every rep beneath them, rolled up through their DM/DSMs) clear ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% Sales Achievement, summed once — never averaged. A higher-scoring ${esc(title)} shown without the badge simply hasn't cleared that floor yet.`;
      winnersPanel = winnersPanelHtml(`🏆 Recognition Winner — Corporate`, card, note);
    }

    return `
      <div class="sp-section">
        <h2>${esc(title)} — Team Avg Rollup${anyPending ? " (Partial)" : ""}</h2>
        <div class="sp-section-sub">${esc(formula)}. Team Avg is computed only from this team's active, past-probation ${esc(teamNounPlural)} for ${esc(cache.meta.evalPeriod)}. ${winnerCopy}${opts.buFilter ? "Each BU's own top performer carries a 🎖 BU Leader badge alongside the overall winner badge(s), same floor. " : ""}${anyPending ? '<span class="sp-tag-partial">SOME PENDING</span> — fill zeta sprint/Sprint_Missing_KPI_Template.xlsx and the next rebuild completes these automatically.' : '<span class="sp-tag-live">FULLY SCORED</span>'}</div>
        ${floorRuleBannerHtml(true)}
        ${winnersPanel}
        ${kpiMethodologyDetailsHtml(kpiKeys)}
        ${buFilterHtml}
        <table>
          <thead><tr><th>${esc(title.split(" ")[0])}</th><th>Team Avg</th>${kpiHeaders}<th style="text-align:right;">Total</th></tr></thead>
          <tbody${opts.bodyId ? ` id="${esc(opts.bodyId)}"` : ""}>${sorted.map((r, i) => hierarchyRow(
            r,
            isCompanyWideTier ? r.code === companyWinnerCode : r.code === scopedWinnerCode,
            winnersCount >= 2 && r.code === scopedRunnerUpCode,
            buLeaders
          )).join("")}</tbody>
        </table>
        <details style="margin-top:14px;"><summary${opts.exclSummaryId ? ` id="${esc(opts.exclSummaryId)}" data-label="Excluded"` : ""}>Excluded (${scopedExcluded.length})</summary>${excludedTable(scopedExcluded, opts.exclBodyId)}</details>
      </div>
    `;
  }

  function brandManagerRow(r, isWinner) {
    const c = BAND_COLOR[band(r.totalPts)];
    return `<tr class="sp-row${isWinner ? " sp-is-winner" : ""}">
      <td class="sp-name">${esc(r.name)}${isWinner ? '<span class="sp-winner-badge">🏆 WINNER</span>' : ""}<div class="sp-sub">#${esc(r.code)} · ${esc(r.position || "Brand Manager")}${r.line ? ` · <span class="sp-manager-line-badge">${esc(r.line)}</span>` : ""} · ${probationBadge(r)}${meetsSalesFloor(bmSalesAch(r)) ? "" : floorNote()}</div></td>
      ${r.kpis.map(k => `<td>${kpiSlotCell(k)}</td>`).join("")}
      <td class="sp-total">
        <div class="sp-total-pts">${r.totalPts.toFixed(1)}</div>
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

    // Brand Manager: single COMPANY-WIDE winner, same reasoning as ASM/NSM
    // above -- computed from the FULL unscoped roster (data.ranked), not
    // from `ranked` (this viewer's own BU/Line scope). No Monthly Sprint
    // cash tier exists for Brand Manager in the Recognition & Rewards deck
    // (flagged to Ahmed), so this badge is recognition-only. Per Ahmed
    // 2026-08-16, also gated by the Sales Achievement recognition floor
    // (WINNER_FLOOR_ACH_PCT) -- cascades to the next-eligible Brand
    // Manager by totalPts if the top performer's own National Sales
    // Ach% (r.kpis 'salesAch'.raw) falls short.
    const companyWinner = [...data.ranked]
      .filter(r => r.totalPts != null)
      .filter(r => meetsSalesFloor(bmSalesAch(r)))
      .sort((a, b) => b.totalPts - a.totalPts)[0];

    const bmCard = (() => {
      if (!companyWinner) return emptyWinnerCardHtml("WINNER", `No Brand Manager has cleared the ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% National Sales Ach% floor yet.`);
      const ach = bmSalesAch(companyWinner);
      const achStr = ach != null ? `${(ach * 100).toFixed(1)}%` : "—";
      return winnerCardHtml("🏆", "WINNER", companyWinner.name, `${companyWinner.position || "Brand Manager"} · ${companyWinner.totalPts.toFixed(1)} pts · ${achStr} National Sales Ach%`);
    })();
    const bmWinnersNote = `Row order above reflects total score and never changes. The single company-wide 🏆 WINNER additionally requires clearing ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% National Sales Ach% — a higher-scoring Brand Manager shown without the badge simply hasn't cleared that floor yet (see the "Below floor" note on their own row). Recognition only — Brand Manager has no Monthly Sprint cash tier.`;
    const bmWinnersPanel = winnersPanelHtml("🏆 Recognition Winner", bmCard, bmWinnersNote);

    return `
      <div class="sp-section">
        <h2>Brand Manager — ${esc(cache.meta.evalPeriod)}${anyPending ? " (Partial)" : ""}</h2>
        <div class="sp-section-sub">National Sales (50, auto-calculated from each Brand Manager's assigned Line) + Region Coverage (20) + Tactical Plan Execution (30) = 100 pts. Brand Managers own products, not a rep team, so there's no Team Avg rollup here — Region Coverage and Tactical Plan Execution are sourced from zeta sprint/Sprint_Missing_KPI_Template.xlsx. 🏆 WINNER marks the single company-wide top performer, true company-wide even if you're only viewing your own BU's scope (recognition only — Brand Manager has no Monthly Sprint cash tier in the Recognition &amp; Rewards deck), and only among Brand Managers who clear ${Math.round(WINNER_FLOOR_ACH_PCT * 100)}% National Sales Ach%. ${anyPending ? '<span class="sp-tag-partial">SOME PENDING</span>' : '<span class="sp-tag-live">FULLY SCORED</span>'}</div>
        ${floorRuleBannerHtml(false)}
        ${bmWinnersPanel}
        <table>
          <thead><tr><th>Brand Manager</th>${kpiHeaders}<th style="text-align:right;">Total</th></tr></thead>
          <tbody>${sorted.map((r, i) => brandManagerRow(r, !!companyWinner && r.code === companyWinner.code)).join("")}</tbody>
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
  // to carry the winner/runner-up badge. Both the Medical Rep Line filter
  // AND the DM/DSM BU filter now pass one (as of 2026-08-16 -- DM/DSM's
  // own team-level 70% Sales Achievement floor, meetsTeamSalesFloor via
  // data-team-ach-pct; see module docblock "MANAGER-TIER FLOOR"). The rank
  // shown in the # column is NEVER affected by eligibility -- only which
  // row(s), if any, get the badge.
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
  // Corporate winner each. This is broader than (and supersedes) the
  // on-screen gold/silver WINNER badges, which mark only the global top-2
  // across all Lines/BUs combined, not a true per-Line/per-BU top-2 --
  // flagged explicitly to Ahmed 2026-08-15, not silently reconciled.
  // Direct Manager / Direct Manager BU come straight from each record
  // (etl/build_sprint_cache.py step 7b, sourced from Database
  // Shortcut.xlsx's own org-chart columns -- covers every tier including
  // ASM/NSM, per Ahmed 2026-08-15 "asm and nsm name of manager and bu not
  // present").
  //
  // Per Ahmed 2026-08-16 (round 1): Medical Rep and CHC Sales Rep
  // additionally require Sales Achievement >= WINNER_FLOOR_ACH_PCT (70%)
  // to be a real cash winner here -- an ineligible top-2-by-rank rep is
  // dropped from their Line's payout entirely and the next-eligible rep
  // in that Line takes the slot (topNByGroup re-sorts by totalPts within
  // whatever list it's given, so filtering the input list first is what
  // makes it cascade).
  //
  // Per Ahmed 2026-08-16 (round 2, "DM DSM HAS REWARD ALSO MAKE SAME
  // FLOOR LOGIC FOR ASM NSM"): DM/DSM, ASM, NSM now carry the exact same
  // floor, using meetsTeamSalesFloor(r.teamSalesAchPct) instead of
  // meetsSalesFloor(r.achPct) since these tiers don't have a personal
  // Sales Achievement % -- teamSalesAchPct is SUM(every eligible rep's
  // raw sales value)/SUM(their raw target) across the manager's WHOLE
  // reporting subtree (etl/build_sprint_cache.py), divided exactly once.
  // Brand Manager remains excluded from this export entirely (no Monthly
  // Sprint cash tier at all), so its own floor gate (see
  // renderBrandManager) only ever affects its on-screen badge, never
  // this CSV.
  function computeMonthlyWinners() {
    const rows = [];
    const msrAll = cache.medicalRepSalesRep.ranked;
    const medicalReps = msrAll.filter(r => r.role === "Medical Rep");
    const salesReps = msrAll.filter(r => r.role === "Sales Rep (CHC)");
    // Floor-gated 2026-08-16 ("DM DSM HAS REWARD ALSO MAKE SAME FLOOR
    // LOGIC FOR ASM NSM") -- filtering the input list here, before
    // topNByGroup/sort-and-take-top runs, is what makes the cascade work:
    // an ineligible manager (their team hasn't cleared 70% Sales
    // Achievement) is dropped from payout entirely and the next-eligible
    // manager in that BU/Corporate pool takes the slot. If a BU (DM/DSM)
    // or the whole company (ASM/NSM) has nobody eligible, it simply
    // produces zero rows for that group -- no forced payout, matching the
    // on-screen WINNER/BU Leader badge logic in renderHierarchyTier
    // exactly (same meetsTeamSalesFloor test, same teamSalesAchPct
    // field), so the CSV and the screen can never disagree about who got
    // paid.
    const dmScored = cache.dmDsm.ranked.filter(r => r.teamSize > 0 && r.totalPts != null).filter(meetsTeamSalesFloor);
    const asmScored = cache.asm.ranked.filter(r => r.teamSize > 0 && r.totalPts != null).filter(meetsTeamSalesFloor);
    const nsmScored = cache.nsm.ranked.filter(r => r.teamSize > 0 && r.totalPts != null).filter(meetsTeamSalesFloor);

    [["Medical Rep", medicalReps], ["CHC Sales Rep", salesReps]].forEach(([title, records]) => {
      const cashKey = title === "CHC Sales Rep" ? "Sales Rep (CHC)" : title;
      const eligibleRecords = records.filter(r => meetsSalesFloor(r.achPct));
      topNByGroup(eligibleRecords, r => r.canonLine, 2).forEach(({ group, rank, r }) => {
        rows.push({
          title, name: r.name, code: r.code, position: r.position || "",
          hireDate: r.hireDate || "", line: r.canonLine || "", bu: r.bu || "",
          winnerGroup: `Line: ${group}`, rankInGroup: `#${rank}`,
          directManager: r.directManager || "", directManagerBu: r.directManagerBu || "",
          money: MONTHLY_CASH[cashKey], totalPts: r.totalPts,
        });
      });
    });

    topNByGroup(dmScored, r => r.bu, 2).forEach(({ group, rank, r }) => {
      rows.push({
        title: "DM/DSM", name: r.name, code: r.code, position: "",
        hireDate: r.hireDate || "", line: r.line || "", bu: r.bu || "",
        winnerGroup: `BU: ${group}`, rankInGroup: `#${rank}`,
        directManager: r.directManager || "", directManagerBu: r.directManagerBu || "",
        money: MONTHLY_CASH["DM/DSM"], totalPts: r.totalPts,
      });
    });

    [["ASM", asmScored], ["NSM", nsmScored]].forEach(([title, records]) => {
      if (!records.length) return;
      const winner = [...records].sort((a, b) => b.totalPts - a.totalPts)[0];
      rows.push({
        title, name: winner.name, code: winner.code, position: "",
        hireDate: winner.hireDate || "", line: winner.line || "", bu: winner.bu || "",
        winnerGroup: "Corporate", rankInGroup: "#1",
        directManager: winner.directManager || "", directManagerBu: winner.directManagerBu || "",
        money: MONTHLY_CASH[title], totalPts: winner.totalPts,
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

    wireRankFilter(document.getElementById("sp-line-filter"), "#sp-msr-body", "data-line",
      ["sp-probexcl", "sp-inactive", "sp-departing"],
      tr => {
        const raw = tr.getAttribute("data-ach-pct");
        return raw !== "" && raw != null && meetsSalesFloor(parseFloat(raw));
      },
      "sp-msr-winners-panel", msrWinnersPanelHtml);
    // DM/DSM: floor extended here 2026-08-16 ("DM DSM HAS REWARD ALSO") --
    // isEligible reads hierarchyRow's data-team-ach-pct (SUM(team
    // val)/SUM(team tgt), never an average of percentages), and
    // dmWinnersPanelHtml recomputes the live "who actually won" podium on
    // every BU filter change, same pattern as Medical Rep above.
    wireRankFilter(document.getElementById("sp-dm-bu-filter"), "#sp-dm-body", "data-bu",
      ["sp-dm-excl"],
      tr => {
        const raw = tr.getAttribute("data-team-ach-pct");
        return raw !== "" && raw != null && meetsSalesFloor(parseFloat(raw));
      },
      "sp-dm-winners-panel", dmWinnersPanelHtml);
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
