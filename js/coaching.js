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
 *   -> click-through Manager Profile (S1 summary + Feb..Jun
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
 *   "Visits Details S1 DM.xlsx" (Total sheet, Feb1-Jun30 2026 S1) joined
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
 *   - Coverage only exists for District Manager / Field force
 *     supervisor -- the two levels with a real "own team". Every other
 *     level (Sr. DM, NSM, Area Manager, BUM, Brand Manager, FF
 *     Trainer, Group Brand lead) never gets a coverage % or a target.
 *   - A manager whose name could not be matched to Database
 *     Shortcut.xlsx at all would show "Coverage: pending org match"
 *     rather than a computed number -- see coverageDisplay(). This
 *     cannot currently trigger (0 unmatched), kept for when a future
 *     data refresh introduces a new unmatched name.
 *
 * CUSTOMER / HCP DATA -- v1 added a per-coached-employee "customers"
 * popup (Customer field, visit-count only). REMOVED in this rewrite:
 * the working brief for this redesign is explicit and repeated --
 * "Do NOT display HCP/customer names... The Customer field remains
 * excluded." The ETL cache (cache/coaching.json) still CONTAINS a
 * `customers` array per coached employee (harmless, unused) because
 * rebuilding the cache without it wasn't necessary to satisfy this
 * requirement -- this file simply never reads that field. If a future
 * request re-adds a customer-level view, the data is already there.
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
 * =====================================================================
 */
(function (global) {
  "use strict";

  var FULL_ACCESS_ROLES = ["CEO", "VP", "BEX", "Admin", "SFE Manager"];
  var OWN_ONLY_TITLES = ["District Manager", "Field force supervisor"];
  var TARGET_COVERAGE_DEFAULT = 75;
  var TARGET_AVG_DAY_DEFAULT = 7;

  var CHART_COLORS = {
    blue: "#4c6ef5", green: "#36c994", red: "#ff5c6b", orange: "#ff9f45",
    purple: "#9775fa", cyan: "#20c4f4", grid: "rgba(148,163,184,.18)", text: "#9da8c5",
  };

  var _cache = null;       // decompressed coaching.json payload
  var _visible = [];       // managers this signed-in user may see (after AUTH scoping)
  var _chartInstances = {}; // canvasId -> Chart.js instance, owned entirely by this file
  var _state = {
    period: "ALL",          // "ALL" (S1 cumulative) or a "YYYY-MM" key
    drillManagerId: null,   // manager id whose profile is open
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
      return isBuAllowed(m.bu) && isLineAllowed(m.line);
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

  function collectRepsForPeriod(manager, period) {
    var out = [];
    manager.coachedEmployees.forEach(function (ce) {
      var v = period === "ALL" ? ce.visits : ((ce.monthly[period] || {}).visits || 0);
      if (v > 0) out.push(normName(ce.name));
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
    if (period === "ALL") return "S1 cumulative (Feb–Jun)";
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
    var t = data.targets;
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
    var btns = ['<button class="tb-btn' + (_state.period === "ALL" ? " tb-btn-active" : "") + '" data-period="ALL">S1 Cumulative</button>'];
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

  // ---------------------------------------------------------------
  // Render: Executive KPI row
  // ---------------------------------------------------------------
  function renderExecKPIRow(data, ownTier, agg, onTargetCount) {
    var t = data.targets;
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
    return '' +
      '<div class="section-title" style="margin-top:22px;font-size:16px;">Monthly Coaching Trend</div>' +
      '<div class="section-sub">DM / Field Force Supervisor scope, correctly aggregated (sum &divide; sum, not an average of monthly averages)</div>' +
      '<div class="coaching-trend-grid">' +
      '<div><div class="kpi-sub" style="margin-bottom:4px;">DV Coverage % &middot; target ' + data.targets.dvCoveragePct + '%</div>' +
      '<div style="height:220px;"><canvas id="coaching-trend-coverage"></canvas></div></div>' +
      '<div><div class="kpi-sub" style="margin-bottom:4px;">Avg Visits / Coaching Day &middot; target ' + data.targets.avgVisitsPerDay + '</div>' +
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
    var labels = data.period.months.map(monthShort);
    var covVals = data.period.months.map(function (m) { return aggregateOwnTier(ownTier, m).coveragePct || 0; });
    var dayVals = data.period.months.map(function (m) { return aggregateOwnTier(ownTier, m).avgPerDay; });
    drawLineChart("coaching-trend-coverage", labels, "DV Coverage %", covVals, data.targets.dvCoveragePct, true);
    drawLineChart("coaching-trend-intensity", labels, "Avg Visits/Day", dayVals, data.targets.avgVisitsPerDay, false);
  }

  // ---------------------------------------------------------------
  // Render: Attention Required
  // ---------------------------------------------------------------
  function renderAttentionRequired(data, ownTier) {
    var t = data.targets;
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
      '<div class="coaching-table-wrap"><table class="data-table">' +
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
    var t = data.targets;
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
      return '<tr class="coaching-drill-row" data-drill="' + esc(r.m.id) + '" style="cursor:pointer;">' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(r.m.name) + '</td>' +
        '<td>' + esc(r.m.title === "District Manager" ? "DM" : "FFS") + '</td>' +
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
      '<div class="section-title" style="margin-top:22px;font-size:16px;">Other Coaching Levels <span style="font-weight:400;font-size:.65em;opacity:.7;">Sr. DM, NSM, Area Manager, BUM, Brand Manager, FF Trainer — no coverage target</span></div>' +
      '<div class="coaching-table-wrap"><table class="data-table">' +
      '<thead><tr><th>Manager</th><th>Level</th><th>Line</th><th>Visits</th><th>Coaching Days</th><th>Avg/Day</th><th>Coached Reps</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // ---------------------------------------------------------------
  // Render: Manager Profile drill-down
  // ---------------------------------------------------------------
  function renderProfile(data, manager) {
    var t = data.targets;
    var cum = manager.cumulative;
    var st = statusFor(cum.dvCoveragePct, cum.avgVisitsPerDay, t);
    var isCov = OWN_ONLY_TITLES.indexOf(manager.title) >= 0;

    var summaryHtml = isCov ? (
      '<div class="kpi-grid">' +
      kpiCard("DV Coverage", fmtPct1(cum.dvCoveragePct), "Target " + t.dvCoveragePct + "% &middot; " + (cum.dvCoveragePct === null ? "—" : signed(cum.dvCoveragePct - t.dvCoveragePct, " pp")), st.label, st.cls, "green") +
      kpiCard("Avg Visits/Day", cum.avgVisitsPerDay.toFixed(1), "Target " + t.avgVisitsPerDay + " &middot; " + signed(cum.avgVisitsPerDay - t.avgVisitsPerDay), cum.avgVisitsPerDay >= t.avgVisitsPerDay ? "ON TARGET" : "BELOW TARGET", cum.avgVisitsPerDay >= t.avgVisitsPerDay ? "badge-up" : "badge-down", "blue") +
      kpiCard("Coaching Days", String(cum.coachingDays), "S1 total", null, null, "purple") +
      kpiCard("Visits", String(cum.visits), "S1 total", null, null, "orange") +
      kpiCard("Reps Coached", String(cum.coachedOnRoster + cum.coachedOffRoster), cum.coachedOffRoster + " cross-team", null, null, "cyan") +
      '</div>'
    ) : (
      '<div class="kpi-grid">' +
      kpiCard("Coaching Days", String(cum.coachingDays), "S1 total", null, null, "purple") +
      kpiCard("Visits", String(cum.visits), "S1 total", null, null, "orange") +
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
    var monthTable = '<table class="data-table"><thead><tr><th>Metric</th>' + monthHead + '<th>S1</th></tr></thead><tbody>' +
      monthRows.filter(function (r) { return !r.skip; }).map(function (r) {
        var cells = data.period.months.map(function (m) {
          var mm = manager.monthly[m];
          if (!mm) return "<td>—</td>";
          var v = r.key === "__reps" ? (mm.coachedOnRoster + mm.coachedOffRoster) : mm[r.key];
          return "<td>" + r.fmt(v) + "</td>";
        }).join("");
        var cumV = r.key === "__reps" ? (cum.coachedOnRoster + cum.coachedOffRoster) : cum[r.key];
        return "<tr><td>" + r.label + "</td>" + cells + "<td><strong>" + r.fmt(cumV) + "</strong></td></tr>";
      }).join("") + '</tbody></table>';

    var empRows = manager.coachedEmployees.slice().sort(function (a, b) { return b.visits - a.visits; }).map(function (ce) {
      return '<tr>' +
        '<td title="' + esc(ce.name) + '">' + esc(ce.name) + '</td>' +
        '<td>' + (ce.onRoster ? '<span class="badge badge-up">Own team</span>' : '<span class="badge badge-warn">Cross-team</span>') + '</td>' +
        '<td>' + ce.visits + '</td>' +
        '<td>' + ce.coachingDays + '</td>' +
        '<td title="' + esc(ce.firstDate) + '">' + esc(ce.firstDate) + '</td>' +
        '<td title="' + esc(ce.lastDate) + '">' + esc(ce.lastDate) + '</td>' +
        '</tr>';
    }).join("");

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
      '<div class="section-title" style="margin-top:16px;font-size:14px;">S1 Performance</div>' +
      summaryHtml +
      '<div class="section-title" style="margin-top:16px;font-size:14px;">Monthly Performance</div>' +
      '<div class="coaching-table-wrap">' + monthTable + '</div>' +
      '<div class="section-title" style="margin-top:16px;font-size:14px;">Coached Employees <span style="font-weight:400;font-size:.7em;opacity:.7;">(' + manager.coachedEmployees.length + ')</span></div>' +
      '<div class="coaching-table-wrap"><table class="data-table">' +
      '<thead><tr><th>Rep</th><th>Roster</th><th title="Visits Received">Visits</th><th title="Coaching Days">Days</th>' +
      '<th title="First Coaching Date">First</th><th title="Last Coaching Date">Last</th></tr></thead>' +
      '<tbody>' + empRows + '</tbody></table></div>' +
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
    var agg = aggregateOwnTier(ownTier, _state.period);
    var onTargetCount = ownTier.filter(function (m) {
      var mm = metricsFor(m, _state.period) || EMPTY_METRICS;
      return statusFor(mm.dvCoveragePct, mm.avgVisitsPerDay, data.targets).label === "ON TARGET";
    }).length;

    var months = data.period.months;
    var idx = months.indexOf(_state.period);
    var prevAgg = (idx > 0) ? aggregateOwnTier(ownTier, months[idx - 1]) : null;
    var insights = buildInsights(data, ownTier, agg, prevAgg);

    var html = '<div class="iqvia-dashboard-wrap" data-theme="light" style="height:auto;overflow:visible;padding:var(--pad-section);">' +
      '<div class="section active">' +
      '<div class="section-title">Coaching Intelligence</div>' +
      '<div class="section-sub">S1 2026 &middot; Feb 1 – Jun 30 &middot; Joint / Coached Field Visits</div>' +
      renderFilterRow(_visible, scoped.length, _visible.length) +
      renderPeriodControl(data) +
      renderExecKPIRow(data, ownTier, agg, onTargetCount) +
      renderInsights(insights) +
      renderMonthlyTrendShell(data) +
      renderAttentionRequired(data, ownTier) +
      renderOwnTierTable(data, ownTier) +
      renderOtherLevelsTable(otherTier) +
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

    root.addEventListener("click", function (e) {
      var drillEl = e.target.closest("[data-drill]");
      if (drillEl) {
        e.preventDefault();
        _state.drillManagerId = drillEl.getAttribute("data-drill");
        render(root, data);
        return;
      }
      if (e.target.id === "coaching-profile-close" || e.target.id === "coaching-profile-backdrop") {
        _state.drillManagerId = null;
        render(root, data);
        return;
      }
    });
  }

  function renderNoAccess(root) {
    root.innerHTML = '<div class="iqvia-dashboard-wrap" data-theme="light" style="height:auto;padding:var(--pad-section);">' +
      '<div class="section active"><div class="section-title">Coaching Intelligence</div>' +
      '<p style="opacity:.7;">No coaching records are visible for your account/BU/Line scope for S1 2026.</p></div></div>';
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

  global.CoachingDashboard = { init: init, destroy: destroy };
})(window);
