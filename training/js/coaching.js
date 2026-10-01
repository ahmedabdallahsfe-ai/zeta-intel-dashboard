/**
 * ZETA Coaching Intelligence -- js/coaching.js
 * =====================================================================
 * PLATFORM ASSET. Exposes window.CoachingDashboard = { init, destroy }.
 *
 * REWRITE 2026-08-31 (v2, insight-first redesign). v1 (still in git
 * history as commit 80e08ae, "Checkpoint: Coaching Intelligence tab v1
 * (pre-redesign backup)") rendered one kpi-card per coaching manager --
 * fine at a glance, unusable once you have 113 District Manager / Field
 * force supervisor records to scan. This version replaces the card wall
 * with an analytical hierarchy a manager can actually use:
 *   Executive KPIs -> Key Insights -> Monthly Trend -> Attention
 *   Required -> ranked/sortable/searchable table -> Other Levels table
 *   -> click-through Manager Profile (YTD summary + Feb..Aug
 *   reconciliation table + coached-employee list).
 *   (2026-08-31 follow-up: the 2x2 Coverage x Visits/Day Performance
 *   Matrix that originally sat between Monthly Trend and Attention
 *   Required was removed on request -- renderMatrix()/
 *   MATRIX_Y_MAX_MULTIPLIER/.coaching-matrix-* CSS are gone, not just
 *   hidden. Attention Required + the ranked table already surface the
 *   same coverage/intensity split without a chart.)
 *
 * DATA SOURCE / SCOPE -- UNCHANGED from v1, still locked:
 *   cache/coaching.data.js, built by etl/build_coaching_cache.py from
 *   "Visits Details S1 DM.xlsx" (Total sheet, Feb1-Aug31 2026 YTD) joined
 *   against Database Shortcut.xlsx. See that script's header for the
 *   full field list, exclusions and the confirmed 7-alias name-match
 *   table (757/757 reps, 165/165 coaching managers matched -- verified
 *   2026-08-31, see the chat's own QA report for the byte-for-byte
 *   candidate search behind each alias).
 *
 *   NOTE on org-matching source: the working brief for this redesign
 *   asked to match Coach Employee 1 against "Total Organogram July 2026
 *   .xlsx" (i.e. cache/organogram.json). That file is a POSITIONAL
 *   snapshot (planned headcount / span-of-control / vacancy -- see its
 *   top-level keys: vacancyByLine, vacancyByManager, vacantPositions,
 *   activePositions, dmHierarchy, spanOfControl, brickWorkload,
 *   tenureStability), not a live active/resigned roster with a
 *   Direct-Manager edge per person. Matching against it first (done
 *   2026-08-31, see chat) produced a WORSE match rate (74/81 DMs,
 *   20/32 supervisors) than Database Shortcut.xlsx (81/81, 32/32) --
 *   the latter is what refresh_sales.py / etl/build_sprint_cache.py
 *   already treat as the authoritative HR source (active/resigned
 *   status + Direct/Second/Third Manager columns), so
 *   build_coaching_cache.py keeps using it. This is a deliberate,
 *   already-validated choice, not an oversight -- flagged here so a
 *   future maintainer doesn't "fix" it back to a worse match rate.
 *
 * CALCULATION RULES (see etl/build_coaching_cache.py for where these
 * are actually computed -- this file only aggregates/reads them):
 *   - Avg Visits/Coaching Day, at ANY grain (per-manager cumulative,
 *     per-manager-per-month, or the aggregate KPI row here) is ALWAYS
 *     total visits / total coaching days for that grain -- never an
 *     average of smaller-grain averages. See aggregateOwnTier() below.
 *   - DV Coverage % is coached-active-reps-on-own-roster / own active
 *     roster size, capped at 100% for display; reps coached who are
 *     NOT on the manager's own roster are counted separately as
 *     "cross-team" and never folded into, or silently dropped from,
 *     coverage. Aggregate coverage (KPI row / trend) is
 *     sum(onRoster)/sum(activeTeamSize) across the scoped manager set,
 *     using each manager's PERIOD-SPECIFIC activeTeamSize (see
 *     aggregateOwnTier()) -- never an average of per-manager percentages
 *     (mathematically wrong when teams are different sizes) and never
 *     the manager's top-level activeTeamCount, which is a current-roster
 *     snapshot, not a per-period figure (see the 2026-08-31 roster-
 *     denominator fix note in etl/build_coaching_cache.py's header).
 *   - Coverage exists for District Manager / Field force supervisor /
 *     Senior District Manager -- the levels with a real "own team"
 *     (Senior District Manager added 2026-09-08, Ahmed-requested: all
 *     3 current Sr. DMs have a real active roster with visit history --
 *     see etl/build_coaching_cache.py's COVERAGE_TITLES comment for the
 *     verification). Every other level (NSM, Area Manager, BUM, Brand
 *     Manager, FF Trainer, Group Brand lead) never gets a coverage % or
 *     a target.
 *   - A manager whose name could not be matched to Database
 *     Shortcut.xlsx at all would show "Coverage: pending org match"
 *     rather than a computed number -- see coverageDisplay(). This
 *     cannot currently trigger (0 unmatched), kept for when a future
 *     data refresh introduces a new unmatched name.
 *
 * CUSTOMER / HCP DATA -- v1 added a per-coached-employee "customers"
 * popup (Customer field, visit-count only). REMOVED in the v2 rewrite:
 * the working brief for that redesign was explicit and repeated -- "Do
 * NOT display HCP/customer names... The Customer field remains
 * excluded." The ETL cache kept a `customers` array per coached
 * employee throughout (harmless, unused) for exactly this reason: if a
 * future request re-added a customer-level view, the data would
 * already be there.
 *
 * That request came 2026-08-31: clicking a row in the Coached
 * Employees table now opens a detailed, per-visit log (date, customer/
 * HCP name, area) via renderVisitLog(), explicitly reversing the v2
 * rule for this ONE view -- confirmed with the user before building it,
 * since it directly undoes a previously deliberate exclusion. Every
 * OTHER view in this file (the ranked tables, the profile drawer's own
 * summary/monthly sections) still never shows a customer/HCP name --
 * this is the sole exception, entered deliberately by clicking into a
 * specific rep's history, not something that appears passively.
 *
 * CHARTS: the Monthly Trend line charts are built WITHOUT touching
 * js/charts.js (Charts.lineChart() is hardcoded to a 0-100% axis --
 * fine for the coverage trend, wrong for the visits/day trend). To
 * avoid risking any other tab, this file keeps its own tiny Chart.js
 * instance registry (_chartInstances below) and never calls into the
 * shared `Charts` registry at all.
 *
 * ACCESS MODEL -- UNCHANGED from v1 (unchanged by this redesign):
 *   auth.js's canViewCoaching() gates whether the tab/menu item renders
 *   at all (every management-tier role + "Line Manager" -- see that
 *   function's comment for why individual field managers all share the
 *   generic "Line Manager" login role). The finer split below:
 *     - District Manager / Field force supervisor (matched by the
 *       signed-in user's name against this cache): own record + own
 *       coached employees ONLY.
 *     - Every other signed-in role: every manager within their
 *       existing AUTH.isBuAllowed()/isLineAllowed() scope -- reusing
 *       that mechanism rather than a second hierarchy-walk, per
 *       Ahmed's explicit instruction to stay consistent with the rest
 *       of the dashboard.
 *     - CEO/VP/BEX/Admin/SFE Manager: full access within their
 *       (usually unrestricted) BU/Line scope.
 *
 * THEME (2026-08-31 follow-up): iqvia.css's .iqvia-dashboard-wrap is dark
 * navy by default, with a `.iqvia-dashboard-wrap[data-theme="light"]`
 * variant. There is no theme toggle anywhere in this app (confirmed: no
 * data-theme/theme-toggle code exists in js/app.js or dashboard.html), so
 * that dark default is not an active user choice -- it's just what
 * ships if nothing overrides it. Every .iqvia-dashboard-wrap div this
 * file creates now carries data-theme="light" explicitly, matching the
 * light theme the rest of the dashboard (dashboard.css) already uses.
 *
 * FILTERS (2026-08-31 follow-up): earlier in this session the shared
 * Coverage global filter bar (#filter-bar-container, js/filters.js) was
 * left mounted-but-inert on top of this tab -- visible, but reading
 * nothing from it, because Coaching's manager-level data model doesn't
 * match Coverage's customer-visit one (see _filters comment below).
 * Fixed two ways: (1) css/dashboard.css's existing hide-that-bar rule
 * now includes .coaching-mode, same as every other self-contained tab;
 * (2) this file grew its own small, real, dynamic filter (BU + Line,
 * see renderFilterRow/applyFilters) that actually re-renders the KPIs,
 * insights, trend, attention list and both tables on change.
 *
 * TABLE COLUMN WIDTHS (2026-09-01, user-requested: "make names position
 * appear perfectly and review and adjust all like this"). Root cause:
 * the shared .data-table class (css/dashboard.css) uses
 * table-layout:fixed with td { max-width:0 }, which splits every
 * column to an EQUAL share of the table's width and ellipsizes
 * anything that doesn't fit -- correct for the Coverage tab's short,
 * similar-width numeric columns, but wrong here where several of this
 * tab's tables carry a full employee/manager name, a territory/
 * position name, or a "reports to X" note that needs real room
 * (screenshot: "Ahmed Othman...", "Haggag Mohamed A...", "Cross-te...",
 * "reports to Va...", "Diab...", even the "Position" HEADER clipped to
 * "POSITIO"). Fixed in css/coaching.css, scoped per table by id so it
 * never touches the Coverage tab's own tables or any other .data-table
 * in the app: every table below that carries a long name/text column
 * now got a unique id (coaching-attention-table-el,
 * coaching-owntier-table-el [already had one],
 * coaching-otherlevels-table-el, coaching-ce-table-el,
 * coaching-visitlog-table-el), and that table's name/text column(s)
 * get an explicit generous width plus white-space:normal (wraps onto a
 * second line for the rare very-long name instead of clipping it);
 * short numeric/badge columns are left unspecified so table-layout:
 * fixed auto-divides the remaining width evenly across them, same as
 * before.
 * =====================================================================
 */
(function (global) {
  "use strict";

  var FULL_ACCESS_ROLES = ["CEO", "VP", "BEX", "Admin", "SFE Manager"];
  // 2026-09-08: Senior District Manager added -- see
  // etl/build_coaching_cache.py's COVERAGE_TITLES comment (kept in
  // lockstep with that set) for why. Moves all 3 current Sr. DMs from
  // the Other Coaching Levels table into this ranked/targeted one.
  var OWN_ONLY_TITLES = ["District Manager", "Field force supervisor", "Senior District Manager"];
  var TARGET_COVERAGE_DEFAULT = 75;
  var TARGET_AVG_DAY_DEFAULT = 7;
  // 2026-09-17, Ahmed: "for chc_sales line dv per day terget for ffs
  // and dm is 12" / "make target line when selecting chc_sale at 12" --
  // mirrors etl/build_sprint_cache.py's CALLS_PER_DV_TARGET_CHC_SALES
  // = 12.0 (vs. the 8/day default), which already applies this same
  // CHC_SALES-specific intensity target to Sprint's DM/DSM scoring.
  // See effectiveTargets() below for where this is applied.
  var TARGET_AVG_DAY_CHC_SALES = 12;

  var CHART_COLORS = {
    blue: "#4c6ef5", green: "#36c994", red: "#ff5c6b", orange: "#ff9f45",
    purple: "#9775fa", cyan: "#20c4f4", grid: "rgba(148,163,184,.18)", text: "#9da8c5",
  };

  var _cache = null;       // decompressed coaching.json payload
  var _visible = [];       // managers this signed-in user may see (after AUTH scoping)
  var _chartInstances = {}; // canvasId -> Chart.js instance, owned entirely by this file
  var _state = {
    period: "ALL",          // "ALL" (YTD cumulative) or a "YYYY-MM" key
    drillManagerId: null,   // manager id whose profile is open
    visitLogFor: null,      // { managerId, empIndex } -- detailed-visits modal, on top of the profile drawer
    rosterPopupFor: null,   // { managerId, period } -- coached/not-coached-by-name popup for a clicked DV Coverage cell
    sortCol: "cov",         // own-tier table sort column
    sortDir: "desc",
    search: "",
  };
  // Interactive BU/Line filter, ON TOP of AUTH scoping (_visible). This is
  // Coaching's OWN self-contained filter -- deliberately NOT the shared
  // Coverage global filter bar (js/filters.js / #filter-bar-container).
  // That bar's dimensions (Specialty/Class/Status/Experience/Type) describe
  // the HCP/customer being visited on a Doctor Visit, which Coaching
  // structurally never surfaces (see "no HCP/customer names" in the header
  // comment) -- so those fields have no meaning here. Every OTHER
  // self-contained tab in this codebase (SFE/Sales/Executive/ToMarket/
  // Expense/IMS Rx/Sprint -- see the ".xxx-mode #filter-bar-container"
  // hide-rule in css/dashboard.css) already hides that shared bar rather
  // than reading it, for the same reason: it's built for Coverage's
  // customer-visit data model, not theirs. Coaching now follows the same
  // convention (see css/dashboard.css's .coaching-mode addition to that
  // rule) instead of leaving Coverage's bar visible-but-inert on top of
  // this tab, which is what v2 originally shipped with.
  var _filters = { bu: "", line: "" };

  // ---------------------------------------------------------------
  // Cache load / decompression (same pako gzip+b64 pattern as
  // js/sprint.js's gunzipB64Json / js/cache.js's decompressB64Gzip)
  // ---------------------------------------------------------------
  function gunzipB64Json(b64) {
    if (!b64) return null;
    try {
      var strData = atob(b64);
      var bytes = new Uint8Array(strData.length);
      for (var i = 0; i < strData.length; i++) bytes[i] = strData.charCodeAt(i);
      return JSON.parse(pako.ungzip(bytes, { to: "string" }));
    } catch (e) {
      console.error("[Coaching] cache decompression failed", e);
      return null;
    }
  }

  function loadCache() {
    if (_cache) return _cache;
    if (!global.COACHING_CACHE || !global.COACHING_CACHE.b64Data) return null;
    _cache = gunzipB64Json(global.COACHING_CACHE.b64Data);
    return _cache;
  }

  function normName(s) {
    if (!s) return "";
    return String(s).toUpperCase().replace(/ /g, " ").trim().replace(/\s+/g, " ");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------------------------------------------------------------
  // Visibility scoping -- see header comment for the rule. Unchanged
  // logic from v1; re-verified against the live cache 2026-08-31 (SFE
  // Manager -> 165, an NSM-tier Line Manager -> 165 within scope, a
  // DM-tier Line Manager -> 1 (self only)).
  // ---------------------------------------------------------------
  function getVisibleManagers(data) {
    var u = global.AUTH && global.AUTH.getValidSessionUser && global.AUTH.getValidSessionUser();
    if (!u) return [];
    var isBuAllowed = (global.AUTH && global.AUTH.isBuAllowed) || function () { return true; };
    var isLineAllowed = (global.AUTH && global.AUTH.isLineAllowed) || function () { return true; };

    var scoped = data.managers.filter(function (m) {
      var bu = m.bu;
      if (!bu || bu === "0" || bu === 0 || bu === "Unassigned") {
        if (m.line && global.SEMANTIC && global.SEMANTIC.lineToBU) {
          bu = global.SEMANTIC.lineToBU(m.line);
        }
      }
      return isBuAllowed(bu) && isLineAllowed(m.line);
    });

    if (FULL_ACCESS_ROLES.indexOf(u.role) >= 0) return scoped;

    var selfNorm = normName(u.name);
    var myRecord = data.managers.filter(function (m) { return m.id === selfNorm; })[0];
    if (myRecord && OWN_ONLY_TITLES.indexOf(myRecord.title) >= 0) {
      return scoped.filter(function (m) { return m.id === selfNorm; });
    }
    return scoped;
  }

  // ---------------------------------------------------------------
  // Metric helpers
  // ---------------------------------------------------------------
  function metricsFor(manager, period) {
    if (period === "ALL") return manager.cumulative;
    return manager.monthly[period] || null; // null = no visits that manager that month
  }

  // 2026-09-03, Ahmed ("so any dsm resgned in specific month reomve him
  // from analysis" -> "Remove from that month's table + KPI averages"):
  // true unless this manager's OWN Last Day of Work / Hiring date
  // (etl/build_coaching_cache.py's activeHalfMonth flag, stamped on
  // manager.monthly[m] the same way it already is on a coached rep's
  // ce.monthly[m]) falls inside this specific month. "ALL"/YTD Cumulative
  // is never gated by this -- a manager who was genuinely active for part
  // of S1/YTD still belongs in the cumulative view; only the exact
  // month(s) they weren't employed are affected. activeHalfMonth
  // undefined (older cache, or a month bucket that somehow lacks it) is
  // never exclusionary, same rule as everywhere else in this file.
  function managerActiveInPeriod(manager, period) {
    if (period === "ALL") return true;
    var mm = manager.monthly[period];
    if (!mm) return true;
    // Two independent signals, either one excludes: activeHalfMonth
    // (not yet hired, or resigned in the FIRST half of this month --
    // etl/build_coaching_cache.py's active_in_month()) and
    // resignedThisMonth (Last Day of Work falls anywhere in this exact
    // month, any day -- catches a manager who left on day 28-31, which
    // activeHalfMonth alone reads as still active for that month by
    // design; see Eslam AbdelLatif Aly Ibrahim ElSabagh, Last Day of
    // Work 2026-07-31).
    if (mm.activeHalfMonth === false) return false;
    if (mm.resignedThisMonth === true) return false;
    return true;
  }

  var EMPTY_METRICS = {
    visits: 0, coachingDays: 0, avgVisitsPerDay: 0, coachedOnRoster: 0,
    coachedOffRoster: 0, zones: 0, dvCoveragePct: null, activeTeamSize: 0,
  };

  /** Correctly aggregate a set of DM/FFS managers for one period: totals
   * are summed first, THEN divided -- never an average of per-manager
   * averages/percentages (see file header). Managers with an unresolved
   * org match (none currently) are excluded from the coverage
   * denominator/numerator but still counted in visits/days, matching
   * the "pending org match" display rule -- their coverage is simply
   * unknown, not zero. */
  function aggregateOwnTier(managers, period) {
    var visits = 0, days = 0, onRoster = 0, offRoster = 0, activeTeamTotal = 0;
    var repsSeen = {};
    managers.forEach(function (m) {
      // 2026-08-31, user-requested: a manager who has since left the
      // company entirely (m.currentlyActive === false, Database
      // Shortcut's current Status snapshot -- see
      // etl/build_coaching_cache.py's "Currently-active manager flag"
      // note) is excluded from this aggregate ENTIRELY, for every
      // period including YTD Cumulative -- not just the periods after
      // they left. This keeps the company-wide Executive KPI row /
      // ranked-table totals reading as "how is the CURRENT org
      // performing", never diluted by a former employee's fragmentary
      // historical numbers, even for a month they were genuinely
      // present for. Their own Manager Profile drawer is unaffected --
      // it still reads straight from manager.monthly/cumulative and
      // shows their accurate individual history when opened directly.
      if (m.currentlyActive === false) return;
      // roleChange: currently a Medical/Sales Rep, no longer a coaching
      // manager (2026-09-20) -- kept out of every KPI aggregate like a
      // departed manager, but shown with its own honest badge below.
      if (m.roleChange) return;
      if (!managerActiveInPeriod(m, period)) return;
      var mm = metricsFor(m, period) || EMPTY_METRICS;
      visits += mm.visits;
      days += mm.coachingDays;
      offRoster += mm.coachedOffRoster;
      if (orgMatched(m)) {
        onRoster += mm.coachedOnRoster;
        // Sum THIS period's activeTeamSize (time-aware, see
        // etl/build_coaching_cache.py's 2026-08-31 roster-denominator
        // fix comment) -- never the manager's top-level activeTeamCount,
        // which is a current-snapshot display field and would silently
        // reintroduce the same back-dating bug at the aggregate level.
        activeTeamTotal += mm.activeTeamSize || 0;
      }
      collectRepsForPeriod(m, period).forEach(function (r) { repsSeen[r] = true; });
    });
    var coveragePct = activeTeamTotal > 0 ? Math.min(100, (100 * onRoster) / activeTeamTotal) : null;
    var coverageRawPct = activeTeamTotal > 0 ? (100 * onRoster) / activeTeamTotal : null;
    var avgPerDay = days > 0 ? visits / days : 0;
    return {
      visits: visits, days: days, avgPerDay: avgPerDay,
      coveragePct: coveragePct, coverageRawPct: coverageRawPct,
      onRoster: onRoster, offRoster: offRoster, activeTeamTotal: activeTeamTotal,
      repsCoached: Object.keys(repsSeen).length,
    };
  }

  // 2026-09-01, Ahmed: "i mean in this if you remember he will not count
  // resigned 1-15 and new hired 15-30" -- applies the SAME half-month
  // hire/resignation rule the DV Coverage roster denominator already
  // uses (etl/build_coaching_cache.py's active_in_month(): resigned in
  // the FIRST half of the month, or hired in the SECOND half, doesn't
  // count for that month) to the REP side of "Reps Coached" -- a rep
  // genuinely double-visited that month but who resigned day 1-15 or
  // joined day 16-30 is now excluded from that month's count.
  // ce.monthly[m].activeHalfMonth carries this (computed in the ETL,
  // where the rep's real Hiring date / Last Day of Work live) --
  // `!== false` so a rep with no HR date evidence either way (undefined,
  // same as active_in_month()'s own None-is-never-exclusionary rule, or
  // an older cache built before this field existed) still counts, same
  // as before this change.
  function collectRepsForPeriod(manager, period) {
    var out = [];
    function qualifies(mm) {
      return mm && (mm.visits || 0) > 0 && mm.activeHalfMonth !== false;
    }
    manager.coachedEmployees.forEach(function (ce) {
      var ok = period === "ALL"
        ? Object.keys(ce.monthly || {}).some(function (m) { return qualifies(ce.monthly[m]); })
        : qualifies(ce.monthly[period]);
      if (ok) out.push(normName(ce.name));
    });
    return out;
  }

  /** A manager is "org matched" if Database Shortcut resolved an active
   * team for them at all. activeTeamCount === 0 with a matched HR
   * record (e.g. a genuinely empty roster) is different from "never
   * matched" -- both currently read the same way here (no roster to
   * measure against) since 0/165 are actually unmatched today; kept as
   * its own function so a future unmatched case has one place to fix. */
  function orgMatched(manager) {
    return manager.activeTeamCount !== undefined && manager.activeTeamCount !== null;
  }

  function coverageDisplay(manager, mm) {
    if (!orgMatched(manager)) return { text: "Pending org match", cls: "badge-neutral" };
    if (mm.dvCoveragePct === null || mm.dvCoveragePct === undefined) {
      // activeTeamSize is this specific period's (time-aware) team size,
      // not the manager's current-snapshot activeTeamCount -- a manager
      // can have a current team but still show "no active team" for an
      // early month before anyone on today's roster had joined yet.
      return { text: (mm.activeTeamSize || 0) === 0 ? "No active team" : "—", cls: "badge-neutral" };
    }
    return null; // caller renders the numeric value + status badge normally
  }

  // CHC_SALES target override (2026-09-17, Ahmed request -- see
  // TARGET_AVG_DAY_CHC_SALES comment above). Coaching Intelligence's
  // OWN avgVisitsPerDay target (data.targets.avgVisitsPerDay, cache-
  // sourced, currently 7) is flat/company-wide with no per-Line
  // distinction. This swaps in 12 whenever the user has THIS page's
  // own Line filter (_filters.line -- deliberately NOT the shared
  // global filter bar, see _filters comment above) set to CHC_SALES,
  // since every manager in a CHC_SALES-filtered scope is by
  // definition on that line -- so a single target line/number for
  // the whole displayed cohort is still correct. DV Coverage's
  // target is untouched: Ahmed's request was specifically about the
  // Visits/Day intensity target. Used everywhere data.targets is
  // read (KPI cards, trend chart + its subtitle, insights, ON
  // TARGET/CRITICAL/etc. status gating, manager profile drawer) so
  // the page never shows two different numbers for the same target.
  function effectiveTargets(data) {
    var t = data.targets;
    if (_filters.line !== "CHC_SALES") return t;
    var out = {};
    for (var k in t) { if (Object.prototype.hasOwnProperty.call(t, k)) out[k] = t[k]; }
    out.avgVisitsPerDay = TARGET_AVG_DAY_CHC_SALES;
    return out;
  }

  function statusFor(coveragePct, avgPerDay, targets) {
    if (coveragePct === null || coveragePct === undefined) {
      return { label: "PENDING", cls: "badge-neutral" };
    }
    var covOk = coveragePct >= targets.dvCoveragePct;
    var dayOk = avgPerDay >= targets.avgVisitsPerDay;
    if (covOk && dayOk) return { label: "ON TARGET", cls: "badge-up" };
    if (!covOk && !dayOk) return { label: "CRITICAL", cls: "badge-down" };
    if (!covOk) return { label: "COVERAGE GAP", cls: "badge-warn" };
    return { label: "INTENSITY GAP", cls: "badge-warn" };
  }

  function fmtPct1(v) { return (v === null || v === undefined) ? "—" : v.toFixed(1) + "%"; }
  function fmtNum1(v) { return (v === null || v === undefined) ? "—" : v.toFixed(1); }
  function signed(v, suffix) {
    if (v === null || v === undefined) return "—";
    var s = v >= 0 ? "+" : "";
    return s + v.toFixed(1) + (suffix || "");
  }

  function periodLabel(period) {
    if (period === "ALL") return "YTD cumulative (Feb–Aug)";
    var d = new Date(period + "-01T00:00:00");
    return d.toLocaleString("en-US", { month: "long", year: "numeric" });
  }
  function monthShort(period) {
    var d = new Date(period + "-01T00:00:00");
    return d.toLocaleString("en-US", { month: "short" });
  }

  // ---------------------------------------------------------------
  // Insights -- built ONLY from computed aggregates for the current
  // scope + period, never hard-coded. Capped at 6.
  // ---------------------------------------------------------------
  function buildInsights(data, ownTier, agg, prevAgg) {
    var t = effectiveTargets(data);
    var out = [];

    var covGap = agg.coveragePct === null ? null : (agg.coveragePct - t.dvCoveragePct);
    if (covGap !== null) {
      out.push({
        sev: covGap >= 0 ? "good" : "bad",
        text: "DV Coverage is " + agg.coveragePct.toFixed(1) + "%, " + Math.abs(covGap).toFixed(1) +
          " pp " + (covGap >= 0 ? "above" : "below") + " the " + t.dvCoveragePct + "% target.",
      });
    }

    var belowEither = ownTier.filter(function (m) {
      var mm = metricsFor(m, _state.period) || EMPTY_METRICS;
      var st = statusFor(mm.dvCoveragePct, mm.avgVisitsPerDay, t);
      return st.label !== "ON TARGET" && st.label !== "PENDING";
    }).length;
    out.push({
      sev: belowEither > 0 ? "bad" : "good",
      text: belowEither + " of " + ownTier.length + " District Manager / Field Force Supervisor coaches are below at least one coaching target.",
    });

    var dayGap = agg.avgPerDay - t.avgVisitsPerDay;
    out.push({
      sev: dayGap >= 0 ? "good" : "bad",
      text: "Average coaching intensity is " + agg.avgPerDay.toFixed(1) + " visits/day versus the target of " + t.avgVisitsPerDay + ".",
    });

    var belowBoth = ownTier.filter(function (m) {
      var mm = metricsFor(m, _state.period) || EMPTY_METRICS;
      return statusFor(mm.dvCoveragePct, mm.avgVisitsPerDay, t).label === "CRITICAL";
    }).length;
    if (belowBoth > 0) {
      out.push({ sev: "bad", text: belowBoth + " managers are below BOTH DV Coverage and Visits/Day targets -- see Attention Required." });
    }

    if (agg.offRoster > 0) {
      out.push({ sev: "info", text: agg.offRoster + " cross-team coaching visits were logged this period (coaching visits to reps outside the manager's own roster)." });
    }

    if (prevAgg && prevAgg.coveragePct !== null && agg.coveragePct !== null) {
      var delta = agg.coveragePct - prevAgg.coveragePct;
      if (Math.abs(delta) >= 0.5) {
        out.push({
          sev: delta >= 0 ? "good" : "bad",
          text: "DV Coverage is " + (delta >= 0 ? "up" : "down") + " " + Math.abs(delta).toFixed(1) + " pp vs the prior month.",
        });
      }
    }

    return out.slice(0, 6);
  }

  // ---------------------------------------------------------------
  // Render: header + period control
  // ---------------------------------------------------------------
  function renderPeriodControl(data) {
    var btns = ['<button class="tb-btn' + (_state.period === "ALL" ? " tb-btn-active" : "") + '" data-period="ALL">YTD Cumulative</button>'];
    data.period.months.forEach(function (m) {
      btns.push('<button class="tb-btn' + (_state.period === m ? " tb-btn-active" : "") + '" data-period="' + m + '">' + monthShort(m) + '</button>');
    });
    return '' +
      '<div class="section-sub" style="margin-top:2px;margin-bottom:6px;font-weight:600;">PERIOD</div>' +
      '<div id="coaching-period-toggle" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--gap-grid);">' + btns.join("") + '</div>';
  }

  // ---------------------------------------------------------------
  // Render + apply: BU/Line filter (see _filters comment above)
  // ---------------------------------------------------------------
  /** Applies _filters on top of the already-AUTH-scoped `list`. */
  function applyFilters(list) {
    return list.filter(function (m) {
      if (_filters.bu && m.bu !== _filters.bu) return false;
      if (_filters.line && m.line !== _filters.line) return false;
      return true;
    });
  }

  function uniqueSorted(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) {
      if (v && !seen[v]) { seen[v] = true; out.push(v); }
    });
    out.sort();
    return out;
  }

  function renderFilterRow(scopeList, filteredCount, totalCount) {
    var bus = uniqueSorted(scopeList.map(function (m) { return m.bu; }));
    // Cascade: once a BU is picked, only offer lines that actually occur
    // within it (matches js/filters.js's cascading-availability convention
    // for the shared bar, applied here to Coaching's own two fields).
    var lineSource = _filters.bu ? scopeList.filter(function (m) { return m.bu === _filters.bu; }) : scopeList;
    var lines = uniqueSorted(lineSource.map(function (m) { return m.line; }));

    var buOpts = '<option value="">All Business Units</option>' + bus.map(function (b) {
      return '<option value="' + esc(b) + '"' + (_filters.bu === b ? " selected" : "") + '>' + esc(b) + '</option>';
    }).join("");
    var lineOpts = '<option value="">All Lines</option>' + lines.map(function (l) {
      return '<option value="' + esc(l) + '"' + (_filters.line === l ? " selected" : "") + '>' + esc(l) + '</option>';
    }).join("");

    var activeNote = (_filters.bu || _filters.line)
      ? '<span class="coaching-filter-count">Showing ' + filteredCount + ' of ' + totalCount + ' managers in scope</span>'
      : '<span class="coaching-filter-count">' + totalCount + ' managers in scope</span>';

    return '' +
      '<div class="coaching-filter-row" id="coaching-filter-row">' +
      '<div class="coaching-filter-field">' +
      '<label for="coaching-filter-bu">Business Unit</label>' +
      '<select id="coaching-filter-bu">' + buOpts + '</select>' +
      '</div>' +
      '<div class="coaching-filter-field">' +
      '<label for="coaching-filter-line">Line</label>' +
      '<select id="coaching-filter-line">' + lineOpts + '</select>' +
      '</div>' +
      (_filters.bu || _filters.line ? '<button class="tb-btn" id="coaching-filter-reset" type="button">Reset</button>' : '') +
      activeNote +
      '</div>';
  }

  // renderRepsCoachedMethodologyBox (2026-09-01, Ahmed: "Coaching
  // Intelligence make box of how active coached employee calculated and
  // source of this calculation") -- plain-language explainer for the
  // "Reps Coached" Executive KPI card, matching exactly what
  // aggregateOwnTier()/collectRepsForPeriod() above actually compute:
  // the count of DISTINCT reps (deduplicated by normName()) with at
  // least one double-visit in the selected period, summed across every
  // CURRENTLY-ACTIVE District Manager / Field force supervisor in scope
  // -- a rep coached by more than one manager, or coached on more than
  // one day, is still counted once, and a manager who has since left the
  // company is excluded entirely (see the m.currentlyActive === false
  // comment in aggregateOwnTier above).
  function renderRepsCoachedMethodologyBox(data) {
    var r = data.reconciliation || {};
    return '<div class="ci-methodology-box">' +
      '<div class="ci-methodology-title">&#8505;&#65039; How &ldquo;Reps Coached&rdquo; is calculated</div>' +
      '<div class="ci-methodology-body">' +
        'Count of <b>distinct</b> reps with at least one double/joint visit logged in the selected period, ' +
        'summed across every currently-active District Manager / Field force supervisor in scope (a rep coached ' +
        'by more than one manager, or on more than one day, is still counted once). A manager who has since left ' +
        'the company is excluded from this count entirely, for every period.' +
      '</div>' +
      // 2026-09-01, Ahmed: first asked whether hire/resignation dates
      // factor into this count (they didn't) -- then, follow-up ("i mean
      // in this if you remember he will not count resigned 1-15 and new
      // hired 15-30"), asked for the SAME half-month roster rule DV
      // Coverage's denominator already uses to actually apply here too.
      // Now implemented, not just documented: etl/build_coaching_cache.py
      // stamps ce.monthly[m].activeHalfMonth via active_in_month() (the
      // exact same function used for team_as_of_month()'s roster), and
      // collectRepsForPeriod() above now requires it to be true (or
      // absent -- no HR date evidence either way is never exclusionary,
      // same as active_in_month()'s own rule). "Reps Coached" and DV
      // Coverage's denominator now use the SAME half-month join/leave
      // rule -- they used to diverge (visit-based-only vs. roster-based)
      // until this change.
      '<div class="ci-methodology-body">' +
        '<b>Half-month hire/resignation rule applies.</b> A rep who resigned in the first half of a month (Last Day ' +
        'of Work day 1&ndash;14) or was hired in the second half (Hiring date day 16&ndash;30/31) is excluded from ' +
        'that month, even if a real visit was logged &mdash; the same half-month roster rule the DV Coverage % ' +
        'denominator uses. A rep with no hire/resignation date on record either way is still counted normally.' +
      '</div>' +
      // 2026-09-16, Ahmed: "consider leave rule in dv coverage kpi if one
      // team member absent or take leave for full month ... eg if dm has 5
      // medical rep in jul, 1 of them leave all july and he make double
      // visits with 4 medical rep so his dv coverage is 100%".
      '<div class="ci-methodology-body">' +
        '<b>Sick Leave Impact Rule applies to the DV Coverage denominator.</b> A rep in the <b>Excluded</b> band ' +
        'for a month (more than 15 sick days, or Maternity) is removed from that month&rsquo;s DV Coverage ' +
        'denominator &mdash; a manager cannot double-visit someone who was not there, and leaving them in would ' +
        'score him against a rep HR had already written off for the month. So a DM with 5 reps who loses 1 to ' +
        'full-month leave and coaches the other 4 reads <b>100%</b>, not 80%. The rep stays visible on the roster ' +
        'popup marked &ldquo;On leave&rdquo;, and a joint visit that did happen with them still counts &mdash; the ' +
        'rule only ever removes them from the denominator, so absence can help a manager or be neutral, never ' +
        'hurt him. Same Excluded band the Coverage / Right Frequency rule uses, so the platform has one ' +
        'definition of &ldquo;not available this month&rdquo;.' +
      '</div>' +
      '<div class="ci-methodology-source">Source: ' + esc(data.sourceFiles && data.sourceFiles.join(" &middot; ") || "Visits Details S1 DM.xlsx (Total sheet)") +
        ' &middot; matched against Database Shortcut.xlsx by employee Code &middot; ' + r.rowsProcessed + '/' + r.totalVisitRowsInSheet + ' visit rows processed &middot; generated ' + esc(data.generatedAt) + '.</div>' +
      '</div>';
  }

  // ---------------------------------------------------------------
  // Render: Executive KPI row
  // ---------------------------------------------------------------
  function renderExecKPIRow(data, ownTier, agg, onTargetCount) {
    var t = effectiveTargets(data);
    var covStatus = statusFor(agg.coveragePct, agg.avgPerDay, t);
    var covVariance = agg.coveragePct === null ? "—" : signed(agg.coveragePct - t.dvCoveragePct, " pp");
    var dayVariance = signed(agg.avgPerDay - t.avgVisitsPerDay);
    var dayOk = agg.avgPerDay >= t.avgVisitsPerDay;
    var onTargetPct = ownTier.length ? (100 * onTargetCount / ownTier.length).toFixed(1) : "0.0";

    return '<div class="kpi-grid">' +
      kpiCard("DV Coverage", fmtPct1(agg.coveragePct), "Target " + t.dvCoveragePct + "% &middot; " + covVariance,
        covStatus.label, covStatus.cls, agg.coveragePct !== null && agg.coveragePct >= t.dvCoveragePct ? "green" : "red") +
      kpiCard("Avg Visits / Coaching Day", agg.avgPerDay.toFixed(1) + " / " + t.avgVisitsPerDay, "Target " + t.avgVisitsPerDay + " &middot; " + dayVariance,
        dayOk ? "ON TARGET" : "BELOW TARGET", dayOk ? "badge-up" : "badge-down", dayOk ? "green" : "red") +
      kpiCard("Managers On Target", onTargetCount + " / " + ownTier.length, onTargetPct + "% of DM/FS meet both targets",
        null, null, "blue") +
      kpiCard("Reps Coached", String(agg.repsCoached), "distinct reps, in scope, " + periodLabel(_state.period),
        null, null, "purple") +
      kpiCard("Cross-Team Coaching", String(agg.offRoster), "visits to reps outside own roster",
        null, null, "orange") +
      '</div>';
  }

  function kpiCard(label, value, sub, badgeLabel, badgeCls, color) {
    var badge = badgeLabel ? ' <span class="badge ' + badgeCls + '">' + esc(badgeLabel) + '</span>' : "";
    return '<div class="kpi-card ' + color + '">' +
      '<div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value">' + value + badge + '</div>' +
      '<div class="kpi-sub">' + sub + '</div>' +
      '</div>';
  }

  // ---------------------------------------------------------------
  // Render: Key Insights
  // ---------------------------------------------------------------
  function renderInsights(insights) {
    var icons = { good: "🟢", bad: "🔴", info: "🔵" };
    var items = insights.map(function (i) {
      return '<div class="coaching-insight coaching-insight-' + i.sev + '">' + icons[i.sev] + ' ' + i.text + '</div>';
    }).join("");
    return '<div class="section-title" style="margin-top:22px;font-size:16px;">Key Coaching Insights</div>' +
      '<div class="coaching-insights-grid">' + items + '</div>';
  }

  // ---------------------------------------------------------------
  // Render: Monthly Trend (2 custom Chart.js line charts, own registry)
  // ---------------------------------------------------------------
  function renderMonthlyTrendShell(data) {
    var t = effectiveTargets(data);
    return '' +
      '<div class="section-title" style="margin-top:22px;font-size:16px;">Monthly Coaching Trend</div>' +
      '<div class="section-sub">DM / Field Force Supervisor scope, correctly aggregated (sum &divide; sum, not an average of monthly averages)</div>' +
      '<div class="coaching-trend-grid">' +
      '<div><div class="kpi-sub" style="margin-bottom:4px;">DV Coverage % &middot; target ' + t.dvCoveragePct + '%</div>' +
      '<div style="height:220px;"><canvas id="coaching-trend-coverage"></canvas></div></div>' +
      '<div><div class="kpi-sub" style="margin-bottom:4px;">Avg Visits / Coaching Day &middot; target ' + t.avgVisitsPerDay + '</div>' +
      '<div style="height:220px;"><canvas id="coaching-trend-intensity"></canvas></div></div>' +
      '</div>';
  }

  function destroyChart(id) {
    if (_chartInstances[id]) {
      try { _chartInstances[id].destroy(); } catch (e) { /* ignore */ }
      delete _chartInstances[id];
    }
  }

  function drawLineChart(canvasId, labels, seriesLabel, values, targetValue, isPercent) {
    var ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === "undefined") return;
    destroyChart(canvasId);
    var chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: seriesLabel,
            data: values,
            borderColor: CHART_COLORS.blue,
            backgroundColor: CHART_COLORS.blue,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: "Target",
            data: labels.map(function () { return targetValue; }),
            borderColor: CHART_COLORS.red,
            borderDash: [6, 4],
            pointRadius: 0,
            borderWidth: 1.5,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 10 }, color: CHART_COLORS.text } },
          tooltip: { callbacks: { label: function (c) { return " " + c.dataset.label + ": " + c.parsed.y.toFixed(1) + (isPercent ? "%" : ""); } } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { color: CHART_COLORS.text, callback: function (v) { return v + (isPercent ? "%" : ""); } }, grid: { color: CHART_COLORS.grid } },
          x: { ticks: { color: CHART_COLORS.text }, grid: { display: false } },
        },
      },
    });
    _chartInstances[canvasId] = chart;
  }

  function renderMonthlyTrendCharts(data, ownTier) {
    var t = effectiveTargets(data);
    var labels = data.period.months.map(monthShort);
    var covVals = data.period.months.map(function (m) { return aggregateOwnTier(ownTier, m).coveragePct || 0; });
    var dayVals = data.period.months.map(function (m) { return aggregateOwnTier(ownTier, m).avgPerDay; });
    drawLineChart("coaching-trend-coverage", labels, "DV Coverage %", covVals, t.dvCoveragePct, true);
    drawLineChart("coaching-trend-intensity", labels, "Avg Visits/Day", dayVals, t.avgVisitsPerDay, false);
  }

  // ---------------------------------------------------------------
  // Render: Attention Required
  // ---------------------------------------------------------------
  // 2026-09-01, Ahmed: "Reps Not Coached in 30+ Days remove this" --
  // the section, its buildInsights summary line, and its render()
  // wiring were removed. It surfaced roster reps not double-visited by
  // their own DM/FFS manager in 30+ days (added earlier the same
  // session, then refined to exclude reps hired after the period
  // ends). etl/build_coaching_cache.py's activeTeamHireDates field,
  // added to support it, was left in place unused in cache/coaching.json
  // -- same precedent as the earlier dvCoverageRank/callsPerDvRank
  // removal (see sprint_dvcoverage_coaching_source project-memory note)
  // -- so no ETL rerun was needed for this removal.
  // -----------------------------------------------------------------
  function renderAttentionRequired(data, ownTier) {
    var t = effectiveTargets(data);
    var rows = ownTier.map(function (m) {
      var mm = metricsFor(m, _state.period) || EMPTY_METRICS;
      var st = statusFor(mm.dvCoveragePct, mm.avgVisitsPerDay, t);
      var covGap = mm.dvCoveragePct === null ? -999 : (t.dvCoveragePct - mm.dvCoveragePct);
      var dayGap = t.avgVisitsPerDay - mm.avgVisitsPerDay;
      var score = Math.max(0, covGap) + Math.max(0, dayGap) * 3; // weight intensity gap comparably to a coverage-pp gap
      return { m: m, mm: mm, st: st, score: score };
    }).filter(function (r) { return r.st.label === "CRITICAL" || r.st.label === "COVERAGE GAP" || r.st.label === "INTENSITY GAP"; })
      .sort(function (a, b) {
        var order = { CRITICAL: 0, "COVERAGE GAP": 1, "INTENSITY GAP": 2 };
        if (order[a.st.label] !== order[b.st.label]) return order[a.st.label] - order[b.st.label];
        return b.score - a.score;
      });

    if (!rows.length) {
      return '<div class="section-title" style="margin-top:22px;font-size:16px;">Coaching Attention Required</div>' +
        '<p class="kpi-sub" style="padding:8px 0;">No District Manager / Field Force Supervisor is below target this period.</p>';
    }

    var top = rows.slice(0, 8);
    var body = top.map(function (r) {
      return '<tr>' +
        '<td><span class="badge ' + r.st.cls + '">' + r.st.label + '</span></td>' +
        '<td>' + esc(r.m.name) + '</td>' +
        '<td>' + esc(r.m.title) + '</td>' +
        '<td>' + fmtPct1(r.mm.dvCoveragePct) + '</td>' +
        '<td>' + r.mm.avgVisitsPerDay.toFixed(1) + '</td>' +
        '<td><a href="#" class="coaching-attn-drill" data-drill="' + esc(r.m.id) + '">Open profile &rarr;</a></td>' +
        '</tr>';
    }).join("");

    return '' +
      '<div class="section-title" style="margin-top:22px;font-size:16px;">Coaching Attention Required <span style="font-weight:400;font-size:.65em;opacity:.7;">(' + rows.length + ' of ' + ownTier.length + ')</span></div>' +
      '<div class="coaching-table-wrap"><table class="data-table" id="coaching-attention-table-el">' +
      '<thead><tr><th>Priority</th><th>Manager</th><th>Level</th><th>Coverage</th><th>Visits/Day</th><th></th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>' +
      (rows.length > top.length ? '<a href="#coaching-owntier-table" class="tb-btn" style="display:inline-block;margin-top:8px;">View all ' + rows.length + ' &darr;</a>' : "");
  }

  // ---------------------------------------------------------------
  // Render: DM/FFS ranked, sortable, searchable table (replaces v1's
  // card wall entirely)
  // ---------------------------------------------------------------
  var OWNTIER_SORTERS = {
    name: function (r) { return r.m.name.toLowerCase(); },
    title: function (r) { return r.m.title; },
    line: function (r) { return r.m.line || ""; },
    cov: function (r) { return r.mm.dvCoveragePct === null ? -1 : r.mm.dvCoveragePct; },
    day: function (r) { return r.mm.avgVisitsPerDay; },
    days: function (r) { return r.mm.coachingDays; },
    reps: function (r) { return r.mm.coachedOnRoster + r.mm.coachedOffRoster; },
  };

  function renderOwnTierTable(data, ownTier) {
    var t = effectiveTargets(data);
    var rows = ownTier.map(function (m) {
      var mm = metricsFor(m, _state.period) || EMPTY_METRICS;
      return { m: m, mm: mm, st: statusFor(mm.dvCoveragePct, mm.avgVisitsPerDay, t) };
    });

    if (_state.search) {
      var q = _state.search.toLowerCase();
      rows = rows.filter(function (r) { return r.m.name.toLowerCase().indexOf(q) >= 0 || (r.m.line || "").toLowerCase().indexOf(q) >= 0; });
    }

    var sorter = OWNTIER_SORTERS[_state.sortCol] || OWNTIER_SORTERS.cov;
    rows.sort(function (a, b) {
      var av = sorter(a), bv = sorter(b);
      var cmp = av < bv ? -1 : (av > bv ? 1 : 0);
      return _state.sortDir === "asc" ? cmp : -cmp;
    });

    function th(col, label) {
      var arrow = _state.sortCol === col ? (_state.sortDir === "asc" ? " ▲" : " ▼") : "";
      return '<th class="coaching-sortable" data-sort="' + col + '" style="cursor:pointer;white-space:nowrap;">' + label + arrow + '</th>';
    }

    var body = rows.map(function (r, i) {
      var covVar = r.mm.dvCoveragePct === null ? "—" : signed(r.mm.dvCoveragePct - t.dvCoveragePct, " pp");
      var dayVar = signed(r.mm.avgVisitsPerDay - t.avgVisitsPerDay);
      var covDisplay = coverageDisplay(r.m, r.mm);
      var leftBadge = r.m.roleChange
        ? '<span class="badge badge-neutral" title="Now a ' + esc(r.m.roleChange.currentPosition) + ' -- no longer a coaching manager. Excluded from the Executive KPI row and this table\'s totals. Earlier supervisor visits are kept here as history only.">Now ' + esc(r.m.roleChange.currentPosition) + (r.m.roleChange.since ? ' (since ' + esc(r.m.roleChange.since) + ')' : '') + '</span>'
        : r.m.currentlyActive === false
        ? '<span class="badge badge-neutral" title="No longer with the company -- excluded from the Executive KPI row and this table\'s totals for every period, including YTD Cumulative. This row still shows their own accurate historical numbers.">Left company</span>'
        : "";
      return '<tr class="coaching-drill-row" data-drill="' + esc(r.m.id) + '" style="cursor:pointer;">' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(r.m.name) + (leftBadge ? " " + leftBadge : "") + '</td>' +
        '<td>' + esc(r.m.title === "District Manager" ? "DM" : (r.m.title === "Senior District Manager" ? "Sr. DM" : "FFS")) + '</td>' +
        '<td>' + esc(r.m.line || "—") + '</td>' +
        '<td>' + (covDisplay ? '<span class="badge ' + covDisplay.cls + '">' + covDisplay.text + '</span>' : fmtPct1(r.mm.dvCoveragePct)) + '</td>' +
        '<td>' + covVar + '</td>' +
        '<td>' + r.mm.avgVisitsPerDay.toFixed(1) + '</td>' +
        '<td>' + dayVar + '</td>' +
        '<td>' + r.mm.coachingDays + '</td>' +
        '<td>' + (r.mm.coachedOnRoster + r.mm.coachedOffRoster) + '</td>' +
        '<td><span class="badge ' + r.st.cls + '">' + r.st.label + '</span></td>' +
        '</tr>';
    }).join("");

    return '' +
      '<div class="section-title" id="coaching-owntier-table" style="margin-top:22px;font-size:16px;">District Manager &amp; Field Force Supervisor Performance <span style="font-weight:400;font-size:.65em;opacity:.7;">(' + rows.length + ' of ' + ownTier.length + ')</span></div>' +
      '<input type="text" id="coaching-owntier-search" placeholder="Search by name or line…" value="' + esc(_state.search) + '" ' +
      'style="margin-bottom:10px;padding:7px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--txt1);font-size:13px;width:260px;max-width:100%;" />' +
      '<div class="coaching-table-wrap"><table class="data-table" id="coaching-owntier-table-el">' +
      '<thead><tr>' + th("rank", "Rank") + th("name", "Manager") + th("title", "Level") + th("line", "BU/Line") +
      th("cov", "DV Coverage") + '<th>Variance</th>' + th("day", "Visits/Day") + '<th>Variance</th>' +
      th("days", "Coaching Days") + th("reps", "Coached Reps") + '<th>Status</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // ---------------------------------------------------------------
  // Render: Other Coaching Levels (no target)
  // ---------------------------------------------------------------
  function renderOtherLevelsTable(others) {
    if (!others.length) {
      return '<div class="section-title" style="margin-top:22px;font-size:16px;">Other Coaching Levels</div>' +
        '<p class="kpi-sub" style="padding:8px 0;">No other-level coaching records in your scope for this period.</p>';
    }
    var rows = others.slice().sort(function (a, b) {
      return (metricsFor(b, _state.period) || EMPTY_METRICS).visits - (metricsFor(a, _state.period) || EMPTY_METRICS).visits;
    }).map(function (m) {
      var mm = metricsFor(m, _state.period) || EMPTY_METRICS;
      return '<tr class="coaching-drill-row" data-drill="' + esc(m.id) + '" style="cursor:pointer;">' +
        '<td>' + esc(m.name) + '</td>' +
        '<td>' + esc(m.title) + '</td>' +
        '<td>' + esc(m.line || "—") + '</td>' +
        '<td>' + mm.visits + '</td>' +
        '<td>' + mm.coachingDays + '</td>' +
        '<td>' + (mm.coachingDays ? mm.avgVisitsPerDay.toFixed(1) : "—") + '</td>' +
        '<td>' + (mm.coachedOnRoster + mm.coachedOffRoster) + '</td>' +
        '</tr>';
    }).join("");
    return '' +
      '<div class="section-title" style="margin-top:22px;font-size:16px;">Other Coaching Levels <span style="font-weight:400;font-size:.65em;opacity:.7;">NSM, Area Manager, BUM, Brand Manager, FF Trainer — no coverage target</span></div>' +
      '<div class="coaching-table-wrap"><table class="data-table" id="coaching-otherlevels-table-el">' +
      '<thead><tr><th>Manager</th><th>Level</th><th>Line</th><th>Visits</th><th>Coaching Days</th><th>Avg/Day</th><th>Coached Reps</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // ---------------------------------------------------------------
  // Render: Manager Profile drill-down
  // ---------------------------------------------------------------
  function renderProfile(data, manager) {
    var t = effectiveTargets(data);
    var cum = manager.cumulative;
    var st = statusFor(cum.dvCoveragePct, cum.avgVisitsPerDay, t);
    var isCov = OWN_ONLY_TITLES.indexOf(manager.title) >= 0;

    var summaryHtml = isCov ? (
      '<div class="kpi-grid">' +
      kpiCard("DV Coverage", fmtPct1(cum.dvCoveragePct), "Target " + t.dvCoveragePct + "% &middot; " + (cum.dvCoveragePct === null ? "—" : signed(cum.dvCoveragePct - t.dvCoveragePct, " pp")), st.label, st.cls, "green") +
      kpiCard("Avg Visits/Day", cum.avgVisitsPerDay.toFixed(1), "Target " + t.avgVisitsPerDay + " &middot; " + signed(cum.avgVisitsPerDay - t.avgVisitsPerDay), cum.avgVisitsPerDay >= t.avgVisitsPerDay ? "ON TARGET" : "BELOW TARGET", cum.avgVisitsPerDay >= t.avgVisitsPerDay ? "badge-up" : "badge-down", "blue") +
      kpiCard("Coaching Days", String(cum.coachingDays), "YTD total", null, null, "purple") +
      kpiCard("Visits", String(cum.visits), "YTD total", null, null, "orange") +
      kpiCard("Reps Coached", String(cum.coachedOnRoster + cum.coachedOffRoster), cum.coachedOffRoster + " cross-team", null, null, "cyan") +
      '</div>'
    ) : (
      '<div class="kpi-grid">' +
      kpiCard("Coaching Days", String(cum.coachingDays), "YTD total", null, null, "purple") +
      kpiCard("Visits", String(cum.visits), "YTD total", null, null, "orange") +
      kpiCard("Reps Coached", String(cum.coachedOnRoster + cum.coachedOffRoster), "no target at this level", null, null, "cyan") +
      '</div>'
    );

    var monthRows = [
      { label: "Coaching Visits", key: "visits", fmt: function (v) { return String(v); } },
      { label: "Coaching Days", key: "coachingDays", fmt: function (v) { return String(v); } },
      { label: "DV Coverage", key: "dvCoveragePct", fmt: fmtPct1, skip: !isCov },
      { label: "Visits / Coaching Day", key: "avgVisitsPerDay", fmt: fmtNum1 },
      { label: "Coached Reps", key: "__reps", fmt: function (v) { return String(v); } },
    ];
    var monthHead = data.period.months.map(function (m) { return "<th>" + monthShort(m) + "</th>"; }).join("");
    // The DV Coverage row's cells are clickable -- 2026-08-31,
    // user-requested ("popup to see with whom made coached and not") --
    // opening renderRosterPopup() for that exact period (a "YYYY-MM" key,
    // or "ALL" for the YTD column) via wireEvents' [data-dv-period]
    // handler. Only wired when a value is actually present, so a "—" cell
    // (no roster that period) never looks clickable.
    var monthTable = '<table class="data-table"><thead><tr><th>Metric</th>' + monthHead + '<th>YTD</th></tr></thead><tbody>' +
      monthRows.filter(function (r) { return !r.skip; }).map(function (r) {
        var isDvRow = r.key === "dvCoveragePct";
        var cells = data.period.months.map(function (m) {
          var mm = manager.monthly[m];
          if (!mm) return "<td>—</td>";
          var v = r.key === "__reps" ? (mm.coachedOnRoster + mm.coachedOffRoster) : mm[r.key];
          if (isDvRow && v !== null && v !== undefined) {
            return '<td class="coaching-dvcov-cell" data-dv-period="' + m + '" title="Click to see who was coached and who wasn\'t">' + r.fmt(v) + "</td>";
          }
          return "<td>" + r.fmt(v) + "</td>";
        }).join("");
        var cumV = r.key === "__reps" ? (cum.coachedOnRoster + cum.coachedOffRoster) : cum[r.key];
        var cumCell = (isDvRow && cumV !== null && cumV !== undefined)
          ? '<td class="coaching-dvcov-cell" data-dv-period="ALL" title="Click to see who was coached and who wasn\'t"><strong>' + r.fmt(cumV) + "</strong></td>"
          : "<td><strong>" + r.fmt(cumV) + "</strong></td>";
        return "<tr><td>" + r.label + "</td>" + cells + cumCell + "</tr>";
      }).join("") + '</tbody></table>';

    // Wrap each employee with its ORIGINAL index into manager.coachedEmployees
    // (not the sort position) before sorting, so the click handler's
    // data-ce-idx always points at the right record regardless of how
    // this table is currently sorted or whether visit counts tie.
    var empRows = manager.coachedEmployees.map(function (ce, i) { return { ce: ce, i: i }; })
      .sort(function (a, b) { return b.ce.visits - a.ce.visits; })
      .map(function (w) {
        var ce = w.ce;
        var rosterBadge = ce.onRoster
          ? '<span class="badge badge-up">Own team</span>'
          : '<span class="badge badge-warn" title="' +
            esc(ce.actualManager ? "Not on " + manager.name + "'s own active roster this period -- reports to " + ce.actualManager + " instead." : "Not on " + manager.name + "'s own active roster this period.") +
            '">Cross-team</span>' +
            (ce.actualManager ? '<div style="font-size:.72em;color:var(--txt2);margin-top:2px;">reports to ' + esc(ce.actualManager) + '</div>' : '');
        var statusBadge = ce.active === false
          ? '<span class="badge badge-down" title="No longer Active in the HR roster">Inactive</span>'
          : "";
        return '<tr class="coaching-visitlog-row" data-ce-idx="' + w.i + '" style="cursor:pointer;" title="Click for the detailed visit log">' +
          '<td title="' + esc(ce.name) + '">' + esc(ce.name) + (statusBadge ? " " + statusBadge : "") + '</td>' +
          '<td>' + rosterBadge + '</td>' +
          '<td>' + esc(ce.line || "—") + '</td>' +
          '<td title="' + esc(ce.position || "") + '">' + esc(ce.position || "—") + '</td>' +
          '<td>' + ce.visits + '</td>' +
          '<td>' + ce.coachingDays + '</td>' +
          '<td title="' + esc(ce.firstDate) + '">' + esc(ce.firstDate) + '</td>' +
          '<td title="' + esc(ce.lastDate) + '">' + esc(ce.lastDate) + '</td>' +
          '</tr>';
      }).join("");

    var visitLogHtml = "";
    if (_state.visitLogFor && _state.visitLogFor.managerId === manager.id) {
      var vCe = manager.coachedEmployees[_state.visitLogFor.empIndex];
      if (vCe) visitLogHtml = renderVisitLog(manager, vCe);
    }
    var rosterPopupHtml = "";
    if (_state.rosterPopupFor && _state.rosterPopupFor.managerId === manager.id) {
      rosterPopupHtml = renderRosterPopup(manager, _state.rosterPopupFor.period);
    }

    return '' +
      '<div id="coaching-profile-backdrop"></div>' +
      '<div id="coaching-profile-panel" role="dialog" aria-modal="true">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
      '<div>' +
      '<div class="section-title" style="margin:0;">' + esc(manager.name) + '</div>' +
      '<div class="kpi-sub">' + esc(manager.title) + (manager.line ? " &middot; " + esc(manager.line) : "") + (manager.bu ? " &middot; " + esc(manager.bu) : "") + '</div>' +
      '</div>' +
      '<button class="tb-btn" id="coaching-profile-close">&times; Close</button>' +
      '</div>' +
      '<div class="section-title" style="margin-top:16px;font-size:14px;">YTD Performance</div>' +
      summaryHtml +
      '<div class="section-title" style="margin-top:16px;font-size:14px;">Monthly Performance</div>' +
      '<div class="coaching-table-wrap">' + monthTable + '</div>' +
      '<div class="section-title" style="margin-top:16px;font-size:14px;">Coached Employees <span style="font-weight:400;font-size:.7em;opacity:.7;">(' + manager.coachedEmployees.length + ') &middot; click a row for the detailed visit log</span></div>' +
      '<div class="coaching-table-wrap"><table class="data-table" id="coaching-ce-table-el">' +
      '<thead><tr><th>Rep</th><th>Roster</th><th>Line</th><th title="Territory / position">Position</th><th title="Visits Received">Visits</th><th title="Coaching Days">Days</th>' +
      '<th title="First Coaching Date">First</th><th title="Last Coaching Date">Last</th></tr></thead>' +
      '<tbody>' + empRows + '</tbody></table></div>' +
      visitLogHtml +
      rosterPopupHtml +
      '</div>';
  }

  /** Coached / Not Coached name breakdown for one DV Coverage cell --
   * 2026-08-31, user-requested ("popup to see with whome made coached
  /** Per-coached-rep visit cadence for one period, mirroring Sprint's own
   * repBreakdown/isBestPractice logic (etl/build_sprint_cache.py's
   * load_coaching_data()) but computed HERE, client-side, straight off
   * cache/coaching.json's existing coachedEmployees[].monthly[period] /
   * .visits+.coachingDays cumulative totals -- 2026-09-03, Ahmed: "for
   * Coaching Intelligence BEST PRACTICE to make it dynamic according
   * months based on database". Sprint's own Best Practice badge is baked
   * at ETL build time for a single hardcoded month (EVAL_MONTH_STR); this
   * version instead recomputes live for WHICHEVER month/period the tab's
   * own selector (_state.period, already "ALL" or "YYYY-MM") is showing --
   * no ETL change or rebuild needed, since every month's coachedEmployees
   * data was already in the cache. */
  function repCadenceForPeriod(emp, period) {
    var days, visits;
    if (period === "ALL") {
      days = emp.coachingDays || 0;
      visits = emp.visits || 0;
    } else {
      var m = (emp.monthly || {})[period];
      if (!m) return null;
      days = m.coachingDays || 0;
      visits = m.visits || 0;
    }
    if (days <= 0) return null;
    return { name: emp.name, position: emp.position, coachingDays: days, visits: visits,
      avgVisitsPerDay: Math.round((visits / days) * 100) / 100 };
  }

  /** Table of every coached rep's cadence for the given period, with
   * whoever has the highest visits/coaching-day average flagged (ties all
   * flagged) as the Best Practice example -- same "do what this rep's
   * coach did" concept as Sprint's popup, now available for every month
   * in the database, not just one. */
  function bestPracticeTableHtml(coachedEmployees, period) {
    var rows = (coachedEmployees || []).map(function (emp) { return repCadenceForPeriod(emp, period); }).filter(Boolean);
    if (!rows.length) return "";
    rows.sort(function (a, b) { return (b.avgVisitsPerDay - a.avgVisitsPerDay) || (b.visits - a.visits); });
    var bestAvg = rows[0].avgVisitsPerDay;
    rows.forEach(function (r) { r.isBest = r.avgVisitsPerDay === bestAvg; });
    var trs = rows.map(function (r) {
      return "<tr" + (r.isBest ? ' style="background:rgba(255,193,7,.12);"' : "") + ">" +
        "<td>" + esc(r.name) +
        (r.isBest ? ' <span style="color:#e0a800;font-weight:600;" title="Highest visits/day cadence on this team this period">&#11088; Best Practice</span>' : "") +
        "</td>" +
        "<td>" + r.coachingDays + "</td>" +
        "<td>" + r.visits + "</td>" +
        "<td>" + r.avgVisitsPerDay.toFixed(2) + "</td>" +
        "</tr>";
    }).join("");
    return '<div style="font-size:12px;font-weight:600;color:var(--acc2);margin-top:16px;">Coached Reps &mdash; Visit Cadence This Period</div>' +
      '<table class="data-table" style="margin-top:6px;"><thead><tr><th>Rep</th><th>Coaching Days</th><th>Visits</th><th>Avg/Day</th></tr></thead><tbody>' + trs + "</tbody></table>";
  }

  /**
   * and not"). `period` is a "YYYY-MM" key or "ALL" for the YTD
   * cumulative column; both carry pre-computed coachedNames/
   * notCoachedNames from etl/build_coaching_cache.py (see that file's
   * header) -- each entry is {name, position, note}, not a bare string
   * (2026-09-01 follow-up, user-requested: "add here hiring or resigned
   * date when it according to rule and add position"); note is only
   * ever present when a Hired/Resigned date actually falls inside the
   * period this popup is showing. Rendered as a third overlay in the
   * same stack as the
   * profile drawer and visit-log modal -- own ids
   * (#coaching-rosterpopup-*), but the exact same positioning/sizing
   * CSS as the visit-log modal (see css/coaching.css), since the two
   * are mutually exclusive (only one can be open at a time, see
   * wireEvents) and visually identical in size/position. Kept as
   * separate ids rather than sharing the visit-log modal's, so each
   * overlay's own backdrop/close clicks only ever clear that overlay's
   * own state. */
  function renderRosterPopup(manager, period) {
    var isCum = period === "ALL";
    var bucket = isCum ? manager.cumulative : manager.monthly[period];
    if (!bucket) return "";
    // 2026-09-01, user-requested ("add here hiring or resigned date when
    // it according to rule and add position"): each entry is now
    // {name, position, note} (etl/build_coaching_cache.py's
    // roster_name_detail()), already sorted by name -- re-sort defensively
    // by .name rather than relying on array order, since a bare .sort()
    // on objects would compare "[object Object]" and silently scramble
    // the list.
    function byName(a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); }
    var coached = (bucket.coachedNames || []).slice().sort(byName);
    var notCoached = (bucket.notCoachedNames || []).slice().sort(byName);
    var periodLabel = isCum ? "YTD (Cumulative, Feb–Aug)" : monthShort(period) + " " + period.slice(0, 4);
    var covLabel = fmtPct1(bucket.dvCoveragePct);

    // Sick Leave Impact Rule (2026-09-16): reps in the Excluded band that
    // month (>15 sick days or Maternity) are out of the DV Coverage
    // DENOMINATOR -- a manager cannot double-visit someone who was not
    // there. They stay on the roster lists below, so this popup has to
    // reconcile its own arithmetic to the headline %: without this, a
    // manager would read "DV Coverage 100%" above "5 of 6 roster reps
    // coached" and rightly distrust both numbers.
    var leaveExcluded = bucket.leaveExcludedNames || [];
    var leaveExcludedSet = {};
    leaveExcluded.forEach(function (n) { leaveExcludedSet[String(n).toLowerCase()] = true; });
    var isLeaveExcluded = function (it) { return !!leaveExcludedSet[String(it.name).toLowerCase()]; };
    var rosterTotal = coached.length + notCoached.length;
    var availableTotal = Math.max(0, rosterTotal - leaveExcluded.length);
    var coachedAvailable = coached.filter(function (it) { return !isLeaveExcluded(it); }).length;
    var countLabel = leaveExcluded.length
      ? coachedAvailable + " of " + availableTotal + " available reps coached &middot; " +
        leaveExcluded.length + " excluded (leave)"
      : coached.length + " of " + rosterTotal + " roster reps coached";
    function listHtml(items, emptyMsg) {
      if (!items.length) return '<div style="font-size:12px;color:var(--txt2);padding:6px 0;">' + esc(emptyMsg) + "</div>";
      return '<ul style="margin:6px 0 0;padding-left:18px;">' +
        items.map(function (it) {
          var metaBits = [];
          if (it.position) metaBits.push(esc(it.position));
          // "note" is the Hired/Resigned date, only ever present when the
          // half-month roster rule (etl) had that exact date in play for
          // THIS period -- see roster_name_detail()'s comment.
          if (it.note) metaBits.push('<span style="color:var(--acc1);">' + esc(it.note) + "</span>");
          // Say so on the rep's own line, not just in the header count.
          if (isLeaveExcluded(it)) {
            metaBits.push('<span style="color:var(--acc3);font-weight:600;">On leave &mdash; excluded from denominator</span>');
          }
          var metaHtml = metaBits.length
            ? '<div style="font-size:.78em;color:var(--txt2);margin-top:1px;">' + metaBits.join(" &middot; ") + "</div>"
            : "";
          return '<li style="margin-bottom:6px;">' + esc(it.name) + metaHtml + "</li>";
        }).join("") +
        "</ul>";
    }
    return "" +
      '<div id="coaching-rosterpopup-backdrop"></div>' +
      '<div id="coaching-rosterpopup-panel" role="dialog" aria-modal="true">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
      "<div>" +
      '<div class="section-title" style="margin:0;font-size:14px;">' + esc(manager.name) + " &middot; " + esc(periodLabel) + "</div>" +
      '<div class="kpi-sub">DV Coverage ' + covLabel + " &middot; " + countLabel + "</div>" +
      "</div>" +
      '<button class="tb-btn" id="coaching-rosterpopup-close">&times; Close</button>' +
      "</div>" +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px;">' +
      '<div><div style="font-size:12px;font-weight:600;color:var(--acc2);">Coached (' + coached.length + ")</div>" +
      listHtml(coached, "No roster reps were coached this period.") + "</div>" +
      '<div><div style="font-size:12px;font-weight:600;color:var(--acc3);">Not Coached (' + notCoached.length + ")</div>" +
      listHtml(notCoached, "Every roster rep was coached this period.") + "</div>" +
      "</div>" +
      bestPracticeTableHtml(manager.coachedEmployees, period) +
      "</div>";
  }

  /** Detailed visit log for one coached employee under one manager --
   * 2026-08-31, user-requested. Every individual coaching visit (date,
   * customer/HCP, area), not the aggregated per-customer counts the
   * cache already carried for v1's now-removed popup. This is the ONE
   * place in the tab that shows a customer/HCP name -- see the
   * CUSTOMER / HCP DATA note in this file's header comment for why
   * that was excluded everywhere else, and why the user explicitly
   * asked for it here. Rendered as a second overlay ON TOP of the
   * profile drawer (higher z-index, see css/coaching.css), appended
   * inside the same .iqvia-dashboard-wrap element as the profile
   * drawer for the same CSS-custom-property-inheritance reason. */
  function renderVisitLog(manager, ce) {
    var rows = (ce.visitLog || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var body = rows.map(function (v) {
      return '<tr><td>' + esc(v.date) + '</td><td>' + esc(v.customer || "—") + '</td><td>' + esc(v.area || "—") + '</td></tr>';
    }).join("");
    return '' +
      '<div id="coaching-visitlog-backdrop"></div>' +
      '<div id="coaching-visitlog-panel" role="dialog" aria-modal="true">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
      '<div>' +
      '<div class="section-title" style="margin:0;font-size:14px;">' + esc(ce.name) + '</div>' +
      '<div class="kpi-sub">Detailed visits from ' + esc(manager.name) + ' &middot; ' + rows.length + ' visit' + (rows.length === 1 ? "" : "s") + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-shrink:0;">' +
      '<button class="tb-btn" id="coaching-visitlog-export">Export to Excel</button>' +
      '<button class="tb-btn" id="coaching-visitlog-close">&times; Close</button>' +
      '</div>' +
      '</div>' +
      '<div class="coaching-table-wrap" style="margin-top:14px;"><table class="data-table" id="coaching-visitlog-table-el">' +
      '<thead><tr><th>Date</th><th>Customer / HCP</th><th>Area</th></tr></thead>' +
      '<tbody>' + (body || '<tr><td colspan="3" style="opacity:.6;">No individual visit records.</td></tr>') + '</tbody></table></div>' +
      '</div>';
  }

  // ---------------------------------------------------------------
  // Reconciliation footnote
  // ---------------------------------------------------------------
  function renderFootnote(data) {
    var r = data.reconciliation || {};
    return '<div style="margin-top:24px;font-size:11px;opacity:.55;">' +
      'Source: Visits Details S1 DM.xlsx (Total sheet) &middot; matched against Database Shortcut.xlsx &middot; generated ' + esc(data.generatedAt) +
      ' &middot; ' + r.rowsProcessed + '/' + r.totalVisitRowsInSheet + ' rows &middot; ' +
      r.totalCoachingManagers + ' coaching managers &middot; monthly = cumulative: ' + (r.monthlyEqualsCumulative ? "yes" : "NO — CHECK CACHE") +
      ' &middot; unmatched names: ' + ((r.unmatchedReps || []).length + (r.unmatchedCoaches || []).length) +
      '</div>';
  }

  // ---------------------------------------------------------------
  // Full render
  // ---------------------------------------------------------------
  function render(root, data) {
    var scoped = applyFilters(_visible); // AUTH scope, then the interactive BU/Line filter
    var ownTier = scoped.filter(function (m) { return OWN_ONLY_TITLES.indexOf(m.title) >= 0; });
    var otherTier = scoped.filter(function (m) { return OWN_ONLY_TITLES.indexOf(m.title) < 0; });
    // 2026-09-03, Ahmed: a manager who resigned/was hired such that
    // they weren't active for the SPECIFIC month currently selected
    // (managerActiveInPeriod()) is dropped from the tables and
    // Executive KPI averages for that month only -- never from "ALL"/
    // YTD Cumulative, and never from ownTier/otherTier themselves
    // (aggregateOwnTier and the trend chart still need the full list to
    // correctly compute earlier/later months). Used for anything that
    // reads/renders ONLY the currently-selected single period.
    var ownTierInPeriod = ownTier.filter(function (m) { return managerActiveInPeriod(m, _state.period); });
    var otherTierInPeriod = otherTier.filter(function (m) { return managerActiveInPeriod(m, _state.period); });
    var agg = aggregateOwnTier(ownTier, _state.period);
    var onTargetCount = ownTierInPeriod.filter(function (m) {
      var mm = metricsFor(m, _state.period) || EMPTY_METRICS;
      return statusFor(mm.dvCoveragePct, mm.avgVisitsPerDay, effectiveTargets(data)).label === "ON TARGET";
    }).length;

    var months = data.period.months;
    var idx = months.indexOf(_state.period);
    var prevAgg = (idx > 0) ? aggregateOwnTier(ownTier, months[idx - 1]) : null;
    var insights = buildInsights(data, ownTierInPeriod, agg, prevAgg);

    var html = '<div class="iqvia-dashboard-wrap" data-theme="light" style="height:auto;overflow:visible;padding:var(--pad-section);">' +
      '<div class="section active">' +
      '<div class="section-title">Coaching Intelligence</div>' +
      '<div class="section-sub">YTD 2026 &middot; Feb 1 – Aug 31 &middot; Joint / Coached Field Visits</div>' +
      renderFilterRow(_visible, scoped.length, _visible.length) +
      renderPeriodControl(data) +
      renderExecKPIRow(data, ownTierInPeriod, agg, onTargetCount) +
      renderRepsCoachedMethodologyBox(data) +
      renderInsights(insights) +
      renderMonthlyTrendShell(data) +
      renderAttentionRequired(data, ownTierInPeriod) +
      renderOwnTierTable(data, ownTierInPeriod) +
      renderOtherLevelsTable(otherTierInPeriod) +
      renderFootnote(data) +
      '</div></div>';

    root.innerHTML = html;
    renderMonthlyTrendCharts(data, ownTier);

    if (_state.drillManagerId) {
      var m = _visible.filter(function (x) { return x.id === _state.drillManagerId; })[0];
      if (m) {
        // Append INSIDE .iqvia-dashboard-wrap (not `root`, which is one level
        // up) so the drawer is a descendant of the element that declares the
        // --bg1/--border2/--card-sh/etc. custom properties -- otherwise the
        // panel/backdrop render unpositioned+transparent (tokens don't
        // inherit past .iqvia-dashboard-wrap; see css/coaching.css comment).
        var wrapTarget = root.querySelector(".iqvia-dashboard-wrap") || root;
        var wrap = document.createElement("div");
        wrap.innerHTML = renderProfile(data, m);
        while (wrap.firstChild) wrapTarget.appendChild(wrap.firstChild);
      }
    }

    wireEvents(root, data);
  }

  function wireEvents(root, data) {
    var buSelect = document.getElementById("coaching-filter-bu");
    if (buSelect) {
      buSelect.addEventListener("change", function (e) {
        _filters.bu = e.target.value;
        // Changing BU can orphan the current Line selection (a line that
        // only exists under a different BU) -- clear it rather than show
        // a filter combination that can never match anything.
        var lineStillValid = !_filters.line || _visible.some(function (m) {
          return m.bu === _filters.bu && m.line === _filters.line;
        });
        if (!lineStillValid) _filters.line = "";
        render(root, data);
      });
    }
    var lineSelect = document.getElementById("coaching-filter-line");
    if (lineSelect) {
      lineSelect.addEventListener("change", function (e) {
        _filters.line = e.target.value;
        render(root, data);
      });
    }
    var filterReset = document.getElementById("coaching-filter-reset");
    if (filterReset) {
      filterReset.addEventListener("click", function () {
        _filters = { bu: "", line: "" };
        render(root, data);
      });
    }

    var toggle = document.getElementById("coaching-period-toggle");
    if (toggle) {
      toggle.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-period]");
        if (!btn) return;
        _state.period = btn.getAttribute("data-period");
        render(root, data);
      });
    }

    var search = document.getElementById("coaching-owntier-search");
    if (search) {
      search.addEventListener("input", function (e) {
        _state.search = e.target.value;
        // Re-render, but keep focus + caret in the search box.
        var caret = e.target.selectionStart;
        render(root, data);
        var newSearch = document.getElementById("coaching-owntier-search");
        if (newSearch) { newSearch.focus(); newSearch.setSelectionRange(caret, caret); }
      });
    }

    root.querySelectorAll(".coaching-sortable").forEach(function (th) {
      th.addEventListener("click", function () {
        var col = th.getAttribute("data-sort");
        if (_state.sortCol === col) {
          _state.sortDir = _state.sortDir === "asc" ? "desc" : "asc";
        } else {
          _state.sortCol = col;
          _state.sortDir = "desc";
        }
        render(root, data);
      });
    });

    // 2026-08-31 fix: `root` itself is never replaced -- only
    // `root.innerHTML` is reassigned above -- so a delegated listener
    // attached to `root` (as opposed to the querySelector-scoped
    // listeners above, whose target elements ARE recreated each render
    // and legitimately need re-binding) survives across every render()
    // call. wireEvents() runs after every single render (including
    // every keystroke in the search box), so without a guard this
    // addEventListener call was stacking a fresh, never-removed
    // listener on `root` each time -- harmless for the older handlers
    // below (re-running `_state.x = y; render(...)` a few extra times
    // is a no-op), but it turned the new Export-to-Excel button into a
    // multi-download bug the instant a user had typed a few characters
    // or opened/closed a couple of things first: one click fired the
    // export once per accumulated listener (observed 8 downloads from
    // a single click during this session's QA). Guarding with a flag on
    // `root` -- set once, checked every call -- attaches this listener
    // exactly once for the element's lifetime, which is correct: a
    // delegated listener does not need re-attaching just because its
    // descendants changed.
    if (!root._coachingClickWired) {
      root._coachingClickWired = true;
      root.addEventListener("click", function (e) {
        var drillEl = e.target.closest("[data-drill]");
        if (drillEl) {
          e.preventDefault();
          _state.drillManagerId = drillEl.getAttribute("data-drill");
          _state.visitLogFor = null; // opening a different manager always closes any stale visit-log modal
          _state.rosterPopupFor = null; // ...and any stale coached/not-coached popup
          render(root, data);
          return;
        }
        if (e.target.id === "coaching-profile-close" || e.target.id === "coaching-profile-backdrop") {
          _state.drillManagerId = null;
          _state.visitLogFor = null;
          _state.rosterPopupFor = null;
          render(root, data);
          return;
        }

        var ceRow = e.target.closest("[data-ce-idx]");
        if (ceRow && _state.drillManagerId) {
          _state.visitLogFor = { managerId: _state.drillManagerId, empIndex: parseInt(ceRow.getAttribute("data-ce-idx"), 10) };
          _state.rosterPopupFor = null; // the two popups are mutually exclusive
          render(root, data);
          return;
        }
        if (e.target.id === "coaching-visitlog-close" || e.target.id === "coaching-visitlog-backdrop") {
          _state.visitLogFor = null;
          render(root, data);
          return;
        }
        if (e.target.id === "coaching-visitlog-export") {
          exportVisitLog(data);
          return;
        }

        // DV Coverage cell -> coached/not-coached-by-name popup
        // (2026-08-31, user-requested). Checked after the ce-idx/visit-log
        // handlers above since it's a separate, mutually-exclusive overlay.
        var dvCell = e.target.closest("[data-dv-period]");
        if (dvCell && _state.drillManagerId) {
          _state.rosterPopupFor = { managerId: _state.drillManagerId, period: dvCell.getAttribute("data-dv-period") };
          _state.visitLogFor = null; // the two popups are mutually exclusive
          render(root, data);
          return;
        }
        if (e.target.id === "coaching-rosterpopup-close" || e.target.id === "coaching-rosterpopup-backdrop") {
          _state.rosterPopupFor = null;
          render(root, data);
          return;
        }
      });
    }
  }

  /** Export the currently-open visit-log modal's rows to .xlsx via the
   * dashboard's shared exporter (js/exporter.js -- same SheetJS "core"
   * build every other tab's Excel export already uses, see that file's
   * header for why). 2026-08-31, user-requested. */
  function exportVisitLog(data) {
    if (!_state.visitLogFor) return;
    var manager = _visible.filter(function (x) { return x.id === _state.visitLogFor.managerId; })[0];
    if (!manager) return;
    var ce = manager.coachedEmployees[_state.visitLogFor.empIndex];
    if (!ce) return;
    if (typeof Exporter === "undefined" || !Exporter.tableToExcel) {
      console.warn("[Coaching] Exporter is not loaded -- cannot export the visit log.");
      return;
    }
    var columns = [
      { key: "date", label: "Date" },
      { key: "customer", label: "Customer / HCP" },
      { key: "area", label: "Area" },
    ];
    var rows = (ce.visitLog || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var filenameBase = "coaching_visits_" + manager.name.replace(/[^A-Za-z0-9]+/g, "_") +
      "_" + ce.name.replace(/[^A-Za-z0-9]+/g, "_");
    Exporter.tableToExcel(columns, rows, filenameBase);
  }

  function renderNoAccess(root) {
    root.innerHTML = '<div class="iqvia-dashboard-wrap" data-theme="light" style="height:auto;padding:var(--pad-section);">' +
      '<div class="section active"><div class="section-title">Coaching Intelligence</div>' +
      '<p style="opacity:.7;">No coaching records are visible for your account/BU/Line scope for YTD 2026.</p></div></div>';
  }

  function init(rootId) {
    var root = document.getElementById(rootId);
    if (!root) return;
    document.body.classList.add("coaching-mode");
    var data = loadCache();
    if (!data) {
      root.innerHTML = '<div class="iqvia-dashboard-wrap" data-theme="light" style="height:auto;padding:var(--pad-section);">' +
        '<div class="section active"><div class="section-title">Coaching Intelligence</div>' +
        '<p style="opacity:.7;">Coaching data is not available in this build (cache/coaching.data.js missing or failed to load). Run etl/build_coaching_cache.py.</p></div></div>';
      return;
    }
    _state.drillManagerId = null;
    _state.visitLogFor = null;
    _state.rosterPopupFor = null;
    _filters = { bu: "", line: "" };
    _visible = getVisibleManagers(data);
    if (!_visible.length) {
      renderNoAccess(root);
      return;
    }
    render(root, data);
  }

  function destroy() {
    Object.keys(_chartInstances).forEach(destroyChart);
    document.body.classList.remove("coaching-mode");
  }

  /**
   * READ-ONLY accessor for "Ask the Data" (js/ask-prov-coaching.js). Additive: the page never calls it.
   * Hands out the page's OWN scoped manager list (getVisibleManagers: AUTH + own-team rule) and its own
   * aggregate / target / status functions, so an Ask answer is the page's KPI, not a re-computation.
   * Returns null when the cache is not loaded or nobody is visible to this user.
   */
  function askApi() {
    var data = loadCache();
    if (!data) return null;
    var vis = getVisibleManagers(data);
    if (!vis.length) return null;
    return {
      data: data,
      months: (data.period && data.period.months) || [],
      managers: vis,
      ownTierTitles: OWN_ONLY_TITLES.slice(),
      isOwnTier: function (m) { return OWN_ONLY_TITLES.indexOf(m.title) >= 0; },
      aggregateOwnTier: aggregateOwnTier,
      metricsFor: metricsFor,
      managerActiveInPeriod: managerActiveInPeriod,
      statusFor: statusFor,
      repCadenceForPeriod: repCadenceForPeriod,
      emptyMetrics: EMPTY_METRICS,
      /** The page's effective targets for a Line filter value (the page swaps in 12 visits/day for CHC_SALES). */
      targetsForLine: function (line) {
        var saved = _filters.line;
        _filters.line = line || "";
        try { return effectiveTargets(data); } finally { _filters.line = saved; }
      }
    };
  }

  global.CoachingDashboard = { init: init, destroy: destroy, askApi: askApi };
})(window);
