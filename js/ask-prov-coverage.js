(function(g){(g.AskBuild=g.AskBuild||{})["ask-prov-coverage.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — Coverage providers for the AskQuery layer
 * ============================================================================
 *
 * TWO providers, because the dashboard itself holds TWO coverage definitions
 * and a question must never silently mix them:
 *
 *   "coverage"  — the COVERAGE TAB definition. Every figure is a value of
 *                 Analytics.run(filters) — the exact call the tab makes — with the
 *                 same role-scope filter the tab's own filter bar forces
 *                 (Filters.getState(): team = the user's allowed teams).
 *                 Rates pool every in-scope period; sick-leave-flagged rep-periods
 *                 are left out of Coverage % / Right Frequency % (Sick Leave
 *                 Impact Rule, applied inside Analytics).
 *
 *   "opcov"     — the EXECUTIVE / "Operational & Execution" definition. Every figure is
 *                 a value of CoverageDashboard.getFilteredCoverageForLine / ForDm /
 *                 ByType / getCorporateCoverageTotals / getFilteredCoverageSummary:
 *                 Medical Representative, Non-Probation, Active, customer type in
 *                 {Contract, Doctor, Hospital} (CHC_SALES: Sales Representative /
 *                 Pharmacy), exempt rows removed.
 *
 * TIME. Analytics.run takes a period list natively. The Coverage semantic functions
 * pool every period in CacheStore.getRecords(); for a chosen period the provider
 * hands them a period-filtered copy of the SAME records for the duration of the
 * (synchronous) call, then restores the original. The formulas run unchanged on the
 * dashboard's own rows. A period that spans every loaded month uses the untouched
 * records, so the default answers are the dashboard's numbers as they stand.
 */
(function (global) {
  "use strict";

  function SEM() { return global.SEMANTIC; }
  function AU() { return global.AUTH; }
  function ENG() { return global.AskEngine; }
  function CS() { return typeof CacheStore !== "undefined" ? CacheStore : null; }
  function AN() { return typeof Analytics !== "undefined" ? Analytics : null; }
  function CD() { return global.CoverageDashboard; }

  var _memo = {}, _memoUser = null;
  function memo(key, fn) {
    var u = ENG() ? ENG()._currentUserKey() : "?";
    if (_memoUser !== u) { _memo = {}; _memoUser = u; }
    if (Object.prototype.hasOwnProperty.call(_memo, key)) return _memo[key];
    var v = fn(); _memo[key] = v; return v;
  }

  // -------------------------------------------------------------------------
  // Dimensions / periods
  // -------------------------------------------------------------------------
  function ready() {
    var c = CS();
    if (!c) return false;
    if (!c.isReady()) { try { c.init(); } catch (e) {} }
    return c.isReady();
  }
  function dims() { if (!ready()) return null; var d = CS().getDashboard(); return d && d.dimensions ? d.dimensions : null; }

  var MON = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  function dataYear() {
    return memo("year", function () {
      try {
        var m = global.SalesDashboard && global.SalesDashboard.getAvailableMonths ? global.SalesDashboard.getAvailableMonths() : null;
        if (m && m.ok && m.months.length) { var k = m.months[m.months.length - 1].key; var y = parseInt(String(k).slice(0, 4), 10); if (y) return y; }
      } catch (e) {}
      return new Date().getFullYear();
    });
  }
  function periodKeys() {
    var d = dims(); if (!d) return [];
    var y = dataYear();
    return (d.periods || []).map(function (p) {
      var mi = MON.indexOf(String(p).toLowerCase());
      return mi < 0 ? null : y + "-" + (mi + 1 < 10 ? "0" : "") + (mi + 1);
    });
  }
  /** period keys ("2026-07") -> { names:["July"], idxs:[5] } */
  function periodSel(keys) {
    var d = dims(), all = periodKeys(), names = [], idxs = [];
    (keys || []).forEach(function (k) { var i = all.indexOf(k); if (i >= 0) { names.push(d.periods[i]); idxs.push(i); } });
    return { names: names, idxs: idxs, all: idxs.length === all.length };
  }

  // -------------------------------------------------------------------------
  // Scope
  // -------------------------------------------------------------------------
  function allowedBUs() {
    if (!SEM() || !SEM().BU_LIST) return [];
    var l = SEM().BU_LIST.slice();
    return AU() && AU().filterAllowedBUs ? AU().filterAllowedBUs(l) : l;
  }
  function allowedLines() {
    var map = SEM() && SEM().CANONICAL_LINE_TO_BU, out = [];
    if (!map) return out;
    Object.keys(map).forEach(function (n) { if (!AU() || !AU().isLineAllowed || AU().isLineAllowed(n)) out.push(n); });
    return out;
  }
  function lineBU(line) { var m = SEM() && SEM().CANONICAL_LINE_TO_BU; return m ? (m[line] || null) : null; }
  function allowedTeams() { var d = dims(); return d ? (d.teams || []).filter(function (t) { return !AU() || !AU().isLineAllowed || AU().isLineAllowed(t); }) : []; }
  function teamsOfLine(line) { return allowedTeams().filter(function (t) { return SEM().normalizeLine(t) === line; }); }
  function teamsOfBU(bu) { return allowedTeams().filter(function (t) { return SEM().lineToBU(t) === bu; }); }

  function scopeLabel() {
    var s = AU() && AU().getScope ? AU().getScope() : null;
    if (!s || s.unrestricted) return "whole company";
    var parts = [];
    if (s.bus && s.bus.length) parts.push(s.bus.join(", "));
    if (s.lines && s.lines.length) parts.push(s.lines.length > 4 ? s.lines.slice(0, 4).join(", ") + " +" + (s.lines.length - 4) + " more" : s.lines.join(", "));
    return parts.length ? parts.join(" · ") : "your scope";
  }
  function singleScopeOptions() {
    var s = AU() && AU().getScope ? AU().getScope() : null, bus = allowedBUs();
    if (s && !s.unrestricted && s.lines && s.lines.length === 1) return [{ dim: "line", name: s.lines[0] }];
    if (bus.length === 1) return [{ dim: "bu", name: bus[0] }];
    return bus.map(function (b) { return { dim: "bu", name: b }; });
  }

  function availability(defaultPeriod) {
    return function () {
      var keys = periodKeys().filter(Boolean);
      return { name: "Coverage", months: keys, defaultPeriod: defaultPeriod };
    };
  }

  function pctOf(f) { return f === null || f === undefined || isNaN(f) ? null : f * 100; }

  // =========================================================================
  // PROVIDER 1 — Coverage tab (Analytics.run)
  // =========================================================================
  var SICK = ["Sick-leave rule: rep-periods flagged (>15 days Sick / Maternity leave) are left out of Coverage % and Right Frequency %; their customers still count in volumes."];

  function tabFilters(sel, extra) {
    var A = AN(); if (!A) return null;
    var f = A.defaultFilters();
    if (sel && !sel.all) f.period = sel.names.slice();
    var teams = allowedTeams(), d = dims();
    var restricted = d && teams.length < (d.teams || []).length;
    var want = extra && extra.team ? extra.team.slice() : null;
    if (want) { if (restricted) want = want.filter(function (t) { return teams.indexOf(t) >= 0; }); f.team = want; }
    else if (restricted) f.team = teams.slice();
    if (extra) Object.keys(extra).forEach(function (k) { if (k !== "team") f[k] = extra[k]; });
    return f;
  }
  function runTab(sel, extra) {
    var f = tabFilters(sel, extra);
    if (!f) return null;
    var key = "run|" + JSON.stringify(f);
    return memo(key, function () { try { return AN().run(f); } catch (e) { return null; } });
  }

  function kpiVals(k) {
    return {
      cov_pct: pctOf(k.coveragePct), rf_pct: pctOf(k.rightFreqPct), visit_ach: pctOf(k.visitAchievementPct),
      target_visits: k.totalTargetVisits, actual_visits: k.totalActualVisits,
      not_seen_pct: pctOf(k.notSeenPct), not_seen_count: k.notSeenCount,
      unique_customers: k.totalUniqueCustomers, shared_customers: k.totalSharedCustomers,
      customers_per_rep: k.customersPerRep, avg_visits: k.avgVisits, freq_ach: pctOf(k.avgFrequencyAchievement),
      on_target_calls: k.onTargetCalls, missed_calls: k.missedCalls, wasted_calls: k.wastedCalls,
      over_freq: k.overFreqCount, below_freq: k.belowFreqCount, active_reps: k.activeReps
    };
  }

  var TAB_M = [
    { id: "cov_pct", label: "Coverage %", unit: "pct", better: "high", target100: false, aliases: ["coverage", "coverage pct", "customer coverage", "hcp coverage", "coverage rate", "coverage percentage", "coverage tab coverage"],
      def: "Share of in-scope customer rows that were visited at least once in the period (sick-leave-flagged rep-periods excluded).", formula: "mean(Covered Doctor) over evaluated active customer rows", grains: ["bu", "line", "am", "dm", "specialty", "klass", "ctype"], gap: false },
    { id: "rf_pct", label: "Right Frequency %", unit: "pct", better: "high", aliases: ["right frequency", "right freq", "rf", "rf pct", "right frequency pct", "correct frequency", "right frequency rate"],
      def: "Share of in-scope customer rows visited exactly at their target frequency (sick-leave-flagged rep-periods excluded).", formula: "mean(Right Freq) over evaluated active customer rows", grains: ["bu", "line", "am", "dm", "specialty", "klass", "ctype"] },
    { id: "visit_ach", label: "Visit achievement %", unit: "pct", better: "high", target100: true, gapMeasure: "missed_calls",
      aliases: ["visit achievement", "visits achievement", "call rate", "calls achievement", "visits vs target", "visit rate", "visit attainment"],
      def: "Actual visits as a percentage of target visits.", formula: "total actual visits ÷ total target visits × 100", grains: ["bu", "line", "klass", "ctype"] },
    { id: "target_visits", label: "Target visits", unit: "count", better: "high", aliases: ["target visits", "planned visits", "visit target", "target calls", "visits target"],
      def: "Sum of the target frequency (visits due) over in-scope customer rows.", formula: "sum(Frequency)", grains: ["bu", "line", "klass", "ctype"] },
    { id: "actual_visits", label: "Actual visits", unit: "count", better: "high", aliases: ["actual visits", "executed visits", "total visits", "visits made", "visits", "calls made"],
      def: "Sum of visits actually made over in-scope customer rows.", formula: "sum(Visits)", grains: ["bu", "line", "klass", "ctype"] },
    { id: "not_seen_pct", label: "Not-seen %", unit: "pct", better: "low", aliases: ["not seen pct", "not seen rate", "not seen", "unseen", "not visited", "customers not visited pct"],
      def: "Customer rows never visited in the period, as a share of all customer rows.", formula: "(rows − covered rows) ÷ rows × 100", grains: ["bu", "line", "ctype"] },
    { id: "not_seen_count", label: "Not-seen customers", unit: "count", better: "low", aliases: ["not seen customers", "customers not seen", "not seen count", "how many not seen", "unvisited customers"],
      def: "Number of customer rows with no visit in the period.", formula: "rows − covered rows", grains: ["bu", "line", "ctype"] },
    { id: "unique_customers", label: "Unique customers", unit: "count", better: "high", aliases: ["unique customers", "distinct customers", "customer universe", "unique customer count"],
      def: "Distinct customers across the period (a doctor targeted in five months counts once).", formula: "distinct customers (union across periods)", grains: ["bu", "line", "ctype"] },
    { id: "shared_customers", label: "Shared customers (accounts)", unit: "count", better: "high", aliases: ["shared customers", "customer accounts", "total shared customers", "shared customer accounts", "customer rows"],
      def: "Customer accounts in scope at the reference period — point-in-time, never summed across months.", formula: "customer rows at the reference period", grains: ["bu", "line", "ctype"] },
    { id: "customers_per_rep", label: "Customers per rep", unit: "num1", better: "high", aliases: ["customers per rep", "customers per representative", "customer load", "workload per rep"],
      def: "Customer rows per active rep at the reference period.", formula: "customer rows ÷ active reps", grains: ["bu", "line"] },
    { id: "avg_visits", label: "Average visits per rep", unit: "num1", better: "high", aliases: ["average visits", "avg visits", "visits per rep", "average visits per rep"],
      def: "Visits per active rep at the reference period.", formula: "visits ÷ active reps", grains: ["bu", "line"] },
    { id: "freq_ach", label: "Average frequency achievement", unit: "pct", better: "high", aliases: ["average frequency achievement", "avg frequency achievement", "frequency achievement", "avg freq achievement"],
      def: "Mean of each active rep's own mean Actual-Plan-Coverage (mean of means, unweighted).", formula: "mean over reps of mean(Actual Plan Coverage)", grains: ["bu", "line"] },
    { id: "on_target_calls", label: "On-target calls", unit: "count", better: "high", aliases: ["on target calls", "on target visits"],
      def: "Visits that landed inside the target frequency.", formula: "sum of on-target calls", grains: ["bu", "line"] },
    { id: "missed_calls", label: "Missed calls", unit: "count", better: "low", gap: true, aliases: ["missed calls", "missed visits", "visits missed", "call gap", "visit gap"],
      def: "Target visits not made.", formula: "sum of missed calls", grains: ["bu", "line"] },
    { id: "wasted_calls", label: "Wasted calls", unit: "count", better: "low", aliases: ["wasted calls", "wasted visits", "over visited calls"],
      def: "Visits beyond the target frequency.", formula: "sum of wasted calls", grains: ["bu", "line"] },
    { id: "over_freq", label: "Over-frequency customers", unit: "count", better: "low", aliases: ["over frequency", "over frequency customers", "over visited customers", "over visited"],
      def: "Customers visited more often than their target.", formula: "count of customer rows above target frequency", grains: ["bu", "line"] },
    { id: "below_freq", label: "Below-frequency customers", unit: "count", better: "low", aliases: ["below frequency", "below frequency customers", "under visited customers", "under visited"],
      def: "Customers visited less often than their target.", formula: "count of customer rows below target frequency", grains: ["bu", "line"] },
    { id: "active_reps", label: "Active reps", unit: "count", better: "high", aliases: ["active reps", "active representatives", "reps in coverage"],
      def: "Active employees in the coverage data at the reference period.", formula: "distinct active employees", grains: ["bu", "line"] }
  ];
  var TAB_BY = {}; TAB_M.forEach(function (m) { TAB_BY[m.id] = m; });
  // gap measure for target-based measure
  TAB_BY.cov_pct.gapMeasure = null;

  function nameOfLineTeam(t) { return SEM().normalizeLine(t); }

  function tabFetch(req) {
    if (!AN() || !ready()) return { ok: false, missing: "The Coverage data has not loaded yet." };
    var d = dims(), period = req.period || {}, sel = periodSel(period.keys);
    if (!sel.idxs.length) return { ok: false, missing: "Coverage has no data loaded for " + (period.label || "that period") + "." };
    var f = req.filters || {}, g = req.groupBy || null;
    var ids = req.measures.map(function (m) { return m.id; });
    var mine = allowedBUs();
    if (f.bu && mine.indexOf(f.bu) < 0) return { ok: false, missing: "“" + f.bu + "” is outside the data you have access to." };
    if (f.line && AU() && AU().isLineAllowed && !AU().isLineAllowed(f.line)) return { ok: false, missing: "“" + f.line + "” is outside the data you have access to." };

    // filter set describing the scope named in the question
    var extra = {};
    var scopeTeams = null;
    if (f.line) scopeTeams = teamsOfLine(f.line);
    else if (f.bu) scopeTeams = teamsOfBU(f.bu);
    if (scopeTeams) { if (!scopeTeams.length) return { ok: false, missing: "The Coverage data has no team for " + (f.line || f.bu) + " in your scope." }; extra.team = scopeTeams; }
    if (f.dm) extra.manager = [f.dm];
    if (f.am) extra.areaManager = [f.am];
    if (f.rep) extra.employee = [f.rep];
    if (f.specialty) extra.specialty = [f.specialty];
    if (f.klass) extra.klass = [f.klass];
    if (f.ctype) extra.type = [f.ctype];

    var basis = [["Definition", "Coverage tab — every in-scope customer row (Analytics.run, the tab's own calculation)"], ["Periods", sel.all ? "all loaded months, pooled (the tab's default)" : sel.names.join(", ")]];
    var caveats = SICK.slice();
    var asOf = (function () { var r = runTab(sel, extra); return r ? String(r.latestPeriod || "") : ""; })();

    function rowFromRun(name, ex, extraKeys) {
      var r = runTab(sel, Object.assign({}, extra, ex));
      if (!r || !r.kpis) return null;
      return { name: name, v: kpiVals(r.kpis), aux: r };
    }

    var rows = [], total = null;

    // ---- totals --------------------------------------------------------------
    var tr = runTab(sel, extra);
    if (!tr || !tr.kpis) return { ok: false, missing: "The Coverage calculation returned nothing for this scope and period." };
    if (!tr.kpis.totalSharedCustomers && !tr.kpis.totalTargetVisits) return { ok: false, missing: "The Coverage data holds no customer rows for this scope in " + (period.label || "that period") + "." };
    total = kpiVals(tr.kpis);

    // ---- grouping --------------------------------------------------------------
    if (!g) {
      rows = [{ name: f.dm || f.am || f.rep || f.line || f.bu || f.specialty || f.klass || f.ctype || "Total", v: total }];
    } else if (g === "bu") {
      (f.bu ? [f.bu] : mine).forEach(function (bu) {
        var t = teamsOfBU(bu); if (!t.length) return;
        var r = rowFromRun(bu, { team: t.filter(function (x) { return !extra.team || extra.team.indexOf(x) >= 0; }) });
        if (r) rows.push(r);
      });
    } else if (g === "line") {
      var ls = f.line ? [f.line] : allowedLines().filter(function (l) { return !f.bu || lineBU(l) === f.bu; });
      ls.forEach(function (l) {
        var t = teamsOfLine(l); if (!t.length) return;
        var r = rowFromRun(l, { team: t });
        if (r && (r.aux.kpis.totalSharedCustomers || r.aux.kpis.totalTargetVisits)) rows.push(r);
      });
    } else if (g === "ctype") {
      (d.types || []).forEach(function (t) {
        var r = rowFromRun(t, { type: [t] });
        if (r && (r.aux.kpis.totalSharedCustomers || r.aux.kpis.totalTargetVisits)) rows.push(r);
      });
    } else if (g === "dm" || g === "am" || g === "specialty" || g === "klass") {
      var tab = g === "dm" ? tr.managerRanking : g === "am" ? tr.areaManagerRanking : g === "specialty" ? tr.specialtyCoverage : tr.classCoverage;
      (tab || []).forEach(function (x) {
        if (x.status === "Vacant") return;
        var v = {}; v.cov_pct = pctOf(x.coveragePct); v.rf_pct = pctOf(x.rightFreqPct);
        rows.push({ name: x.name, v: v, aux: x });
      });
      if (g === "klass" && ids.some(function (i) { return i === "visit_ach" || i === "target_visits" || i === "actual_visits"; })) {
        var byName = {}; rows.forEach(function (r) { byName[r.name] = r; });
        (tr.classVisitAchievement || []).forEach(function (x) {
          var r = byName[x.name] || (byName[x.name] = { name: x.name, v: {} , aux: x}); if (rows.indexOf(r) < 0) rows.push(r);
          r.v.visit_ach = pctOf(x.achievementPct); r.v.target_visits = x.targetVisits; r.v.actual_visits = x.actualVisits;
        });
      }
      if (g === "dm" || g === "am") caveats.push("Vacant positions are left out of the ranking — they are not people.");
      if (g === "dm") caveats.push("District-manager rows are the Coverage tab's own DM ranking within your scope.");
    } else {
      return { ok: false, missing: "Coverage cannot be grouped by " + g + "." };
    }

    // measures the chosen grain cannot give are simply absent from row.v; the planner already checks grains
    if (!rows.length) return { ok: false, missing: "The Coverage data has no rows for that cut in " + (period.label || "that period") + "." };
    var extraMeasures = [];
    if (ids.indexOf("cov_pct") >= 0 && ids.indexOf("rf_pct") < 0) extraMeasures.push(TAB_BY.rf_pct);
    if (ids.indexOf("rf_pct") >= 0 && ids.indexOf("cov_pct") < 0) extraMeasures.push(TAB_BY.cov_pct);
    if (ids.indexOf("visit_ach") >= 0) { extraMeasures.push(TAB_BY.target_visits); extraMeasures.push(TAB_BY.actual_visits); }
    return { ok: true, rows: rows, total: total, basis: basis, caveats: caveats, asOf: asOf, extraMeasures: extraMeasures,
             formula: "Coverage % = mean(Covered Doctor) · Right Frequency % = mean(Right Freq) · Visit achievement = actual ÷ target visits" };
  }

  function tabVocab() {
    return memo("tabvocab", function () {
      var out = { bu: allowedBUs(), line: allowedLines() };
      var d = dims(); if (!d || !AN()) return out;
      var r = runTab({ all: true, names: [], idxs: [] }, null);
      var o = r && r.availableOptions ? r.availableOptions : {};
      out.dm = (o.manager || []).filter(function (n) { return n && String(n).toUpperCase().indexOf("VACANT") !== 0; });
      out.am = (o.areaManager || []).filter(function (n) { return n && String(n).toUpperCase().indexOf("VACANT") !== 0; });
      out.nsm = (o.nsm || []).filter(function (n) { return n && String(n).toUpperCase().indexOf("VACANT") !== 0; });
      out.specialty = (o.specialty || []).filter(Boolean);
      out.klass = (o.klass || []).filter(Boolean);
      out.ctype = (o.type || []).filter(Boolean);
      return out;
    });
  }

  var tabProvider = {
    id: "coverage", label: "Coverage & Frequency (Coverage tab)", tabs: ["coverage"], domains: ["coverage"],
    defaultMeasure: "cov_pct", rankMeasure: "cov_pct",
    canUse: function () { return !!(CS() && AN()); },
    requires: [], measures: TAB_M,
    dims: { bu: { label: "Business Unit" }, line: { label: "Line" }, am: { label: "Area Manager" }, dm: { label: "District Manager" }, specialty: { label: "Specialty" }, klass: { label: "Customer class" }, ctype: { label: "Customer type" } },
    hierarchy: { bu: "line", line: "dm", am: "dm", dm: null, specialty: "klass", klass: null, ctype: null },
    vocab: tabVocab,
    availability: availability("ytd"),
    scopeLabel: scopeLabel,
    sourceNote: function () { return "Coverage cache · Coverage tab calculation (Analytics.run) · sick-leave rule applied"; },
    singleScopeOptions: singleScopeOptions,
    fetch: tabFetch
  };

  // =========================================================================
  // PROVIDER 2 — Executive / Operational coverage (CoverageDashboard semantic API)
  // =========================================================================
  var _filterMemo = {};
  /** Run fn() with CacheStore.getRecords() showing only the chosen periods. */
  function withPeriod(sel, fn) {
    var c = CS();
    if (sel.all || !c) return fn();
    var orig = c.getRecords, rec = orig.call(c);
    var key = sel.idxs.join(",");
    var user = ENG() ? ENG()._currentUserKey() : "?";
    if (_filterMemo.key !== key) {
      var set = {}; sel.idxs.forEach(function (i) { set[i] = 1; });
      _filterMemo = { key: key, rec: Object.assign({}, rec, { rows: rec.rows.filter(function (r) { return set[r[0]] === 1; }) }) };
    }
    c.getRecords = function () { return _filterMemo.rec; };
    try { return fn(); } finally { c.getRecords = orig; }
  }
  function opMemo(kind, sel, args, fn) {
    var key = ["op", kind, sel.all ? "ALL" : sel.idxs.join(","), JSON.stringify(args)].join("|");
    return memo(key, function () { return withPeriod(sel, fn); });
  }

  function opVals(r) {
    return { op_cov: r.coveragePct, op_rf: r.rightFreqPct, op_visits: r.visitCount, op_planned: r.plannedVisitCount, op_reps: r.repCount, op_customers: r.customerRowCount !== undefined ? r.customerRowCount : r.customerCount };
  }

  var OP_ALIAS_COV = ["operational coverage", "coverage", "executive coverage", "hcp coverage"];
  // The Executive Command Center's own targets: buildCoverageFamilyCard(..., "coveragePct", 100, ...) and
  // (..., "rightFreqPct", 90, ...) in js/executive.js. Mirrored here; ask_tests/test_ask_parity.js greps
  // executive.js and fails if either constant ever changes.
  var OP_TARGET_COV = 100, OP_TARGET_RF = 90;
  var OP_M = [
    { id: "op_cov", label: "Operational coverage %", unit: "pct", better: "high", alt: "cov_pct", aliases: OP_ALIAS_COV, targetValue: OP_TARGET_COV, gapMeasure: "op_cov_gap",
      def: "Coverage of the operational field-force population: Medical Representatives, Non-Probation, Active, customer types Contract / Doctor / Hospital (CHC_SALES: Sales Representative / Pharmacy); sick-leave-exempt rows removed.",
      formula: "mean(Covered Doctor) over the operational population", grains: ["bu", "line", "ctype", "specialty", "klass", "territory"] },
    { id: "op_cov_gap", label: "Coverage gap to target", unit: "pts", better: "low", gap: true, aliases: ["coverage gap", "coverage gap to target", "coverage shortfall", "coverage below target by"],
      def: "Points of coverage still missing to reach the Executive target (100%).", formula: "target − operational coverage %", grains: ["bu", "line", "ctype", "specialty", "klass", "territory"] },
    { id: "op_rf_gap", label: "Right frequency gap to target", unit: "pts", better: "low", gap: true, aliases: ["right frequency gap", "rf gap", "right frequency shortfall", "right frequency gap to target"],
      def: "Points of right frequency still missing to reach the Executive target (90%).", formula: "target − operational right frequency %", grains: ["bu", "line", "ctype", "specialty", "klass"] },
    { id: "op_rf", label: "Operational right frequency %", unit: "pct", better: "high", alt: "rf_pct", targetValue: OP_TARGET_RF, gapMeasure: "op_rf_gap", aliases: ["operational right frequency", "operational rf", "operational right freq", "executive right frequency", "right frequency", "right freq", "rf"],
      def: "Right Frequency of the operational population (same filter as Operational coverage %).", formula: "mean(Right Freq) over the operational population", grains: ["bu", "line", "ctype", "specialty", "klass"] },
    { id: "op_visits", label: "Operational actual visits", unit: "count", better: "high", alt: "actual_visits", aliases: ["operational visits", "operational actual visits"],
      def: "Visits made by the operational population.", formula: "sum(Visits)", grains: ["bu", "line"] },
    { id: "op_planned", label: "Operational planned visits", unit: "count", better: "high", alt: "target_visits", aliases: ["operational planned visits", "operational target visits"],
      def: "Visits due (target frequency) for the operational population.", formula: "sum(Frequency)", grains: ["bu", "line"] },
    { id: "op_reps", label: "Operational reps", unit: "count", better: "high", aliases: ["operational reps", "operational representatives"],
      def: "Distinct reps in the operational population.", formula: "distinct active employees", grains: ["bu", "line"] },
    { id: "op_customers", label: "Operational customer rows", unit: "count", better: "high", aliases: ["operational customers", "operational customer rows"],
      def: "Customer rows in the operational population.", formula: "count of customer rows", grains: ["bu", "line", "ctype"] }
  ];
  var OP_BY = {}; OP_M.forEach(function (m) { OP_BY[m.id] = m; });

  function opFetch(req) {
    if (!CD() || !ready()) return { ok: false, missing: "The Coverage data has not loaded yet." };
    var period = req.period || {}, sel = periodSel(period.keys);
    if (!sel.idxs.length) return { ok: false, missing: "Coverage has no data loaded for " + (period.label || "that period") + "." };
    var f = req.filters || {}, g = req.groupBy || null;
    var mine = allowedBUs();
    if (f.bu && mine.indexOf(f.bu) < 0) return { ok: false, missing: "“" + f.bu + "” is outside the data you have access to." };
    if (f.line && AU() && AU().isLineAllowed && !AU().isLineAllowed(f.line)) return { ok: false, missing: "“" + f.line + "” is outside the data you have access to." };
    var bus = f.line ? [lineBU(f.line)] : f.bu ? [f.bu] : mine;
    if (!bus.length || !bus[0]) return { ok: false, missing: "Your account has no business unit in the coverage data." };
    var caveats = ["Operational definition: Medical Representative, Non-Probation, Active; customer types Contract / Doctor / Hospital (CHC_SALES: Sales Representative / Pharmacy). It differs from the Coverage tab, which counts every customer row.",
                   "Sick-leave rule: exempt rep-periods are removed from these rates."];
    var basis = [["Definition", "Executive / operational coverage (CoverageDashboard semantic functions)"], ["Periods", sel.all ? "all loaded months, pooled" : sel.names.join(", ")]];
    var rows = [], total = null, asOf = null;

    function forLine(bu, line) {
      return opMemo("line", sel, [bu, line || null], function () { return CD().getFilteredCoverageForLine(bu, line || null); });
    }
    function totalOf() {
      if (f.dm) {
        var hit = null;
        bus.some(function (bu) {
          var r = opMemo("dm", sel, [bu, f.line || null, f.dm], function () { return CD().getFilteredCoverageForDm(bu, f.line || null, f.dm); });
          if (r && r.ok && r.customerRowCount > 0) { hit = r; return true; } return false;
        });
        return hit;
      }
      if (f.line || f.bu) return forLine(bus[0], f.line || null);
      // company (role-scoped) — the same two functions the Executive card uses
      var c = opMemo("corp", sel, [], function () { return CD().getCorporateCoverageTotals(); });
      var s = opMemo("sum", sel, [], function () { return CD().getFilteredCoverageSummary(); });
      if (!c || !c.ok) return c;
      return { ok: true, coveragePct: c.coveragePct, rightFreqPct: c.rightFreqPct, customerRowCount: c.customerRowCount,
               visitCount: s && s.ok ? s.visitCount : null, plannedVisitCount: s && s.ok ? s.plannedVisitCount : null, repCount: s && s.ok ? s.repCount : null, asOfDate: c.asOfDate };
    }
    var tr = totalOf();
    if (!tr || !tr.ok) return { ok: false, missing: "The operational coverage calculation returned nothing for this scope" + (tr && tr.status ? " (" + tr.status + ")" : "") + "." };
    if (!tr.customerRowCount) return { ok: false, missing: "The operational population has no customer rows for this scope in " + (period.label || "that period") + "." };
    total = opVals(tr); asOf = tr.asOfDate;

    if (!g) {
      rows = [{ name: f.dm || f.line || f.bu || "Total", v: total }];
    } else if (g === "bu") {
      bus.forEach(function (bu) { var r = forLine(bu, f.line || null); if (r && r.ok && r.customerRowCount) rows.push({ name: bu, v: opVals(r) }); });
    } else if (g === "line") {
      allowedLines().filter(function (l) { return bus.indexOf(lineBU(l)) >= 0 && (!f.line || l === f.line); }).forEach(function (l) {
        var r = forLine(lineBU(l), l); if (r && r.ok && r.customerRowCount) rows.push({ name: l, bu: lineBU(l), v: opVals(r) });
      });
    } else if (g === "ctype" || g === "specialty" || g === "klass") {
      var acc = {};
      bus.forEach(function (bu) {
        var r = opMemo("type", sel, [bu, f.line || null], function () { return CD().getFilteredCoverageByType(bu, f.line || null); });
        if (!r || !r.ok) return;
        var list = g === "ctype" ? r.type : g === "specialty" ? r.specialty : r.klass;
        (list || []).forEach(function (x) {
          var w = x.customerRowCount || x.customerCount || 0;
          var a = acc[x.name] || (acc[x.name] = { name: x.name, n: 0, c: 0, r: 0, cn: 0, rn: 0 });
          if (x.coveragePct !== null && x.coveragePct !== undefined) { a.c += x.coveragePct * w; a.cn += w; }
          if (x.rightFreqPct !== null && x.rightFreqPct !== undefined) { a.r += x.rightFreqPct * w; a.rn += w; }
          a.n += w;
        });
      });
      Object.keys(acc).forEach(function (k) {
        var a = acc[k];
        rows.push({ name: a.name, v: { op_cov: a.cn ? a.c / a.cn : null, op_rf: a.rn ? a.r / a.rn : null, op_customers: a.n } });
      });
      if (bus.length > 1) caveats.push("Across several business units, each row is the customer-weighted mean of the dashboard's per-BU figures.");
    } else if (g === "territory") {
      bus.forEach(function (bu) {
        var r = opMemo("terr", sel, [bu], function () { return CD().getLineAndTerritoryBreakdown(bu); });
        if (!r || !r.ok) return;
        (r.territories || []).forEach(function (t) { rows.push({ name: t.name, bu: bu, v: { op_cov: t.coveragePct, op_customers: t.customerRowCount } }); });
      });
    } else {
      return { ok: false, missing: "The operational coverage layer cannot be grouped by " + g + "." };
    }
    if (!rows.length) return { ok: false, missing: "The operational population has no rows for that cut in " + (period.label || "that period") + "." };
    function addGaps(v) {
      if (v.op_cov !== null && v.op_cov !== undefined) v.op_cov_gap = OP_TARGET_COV - v.op_cov;
      if (v.op_rf !== null && v.op_rf !== undefined) v.op_rf_gap = OP_TARGET_RF - v.op_rf;
    }
    rows.forEach(function (r) { addGaps(r.v); }); addGaps(total);
    basis.push(["Targets", "Coverage " + OP_TARGET_COV + "% · Right Frequency " + OP_TARGET_RF + "% (the Executive cards' own targets)"]);
    var extraMeasures = [];
    var ids = req.measures.map(function (m) { return m.id; });
    if (ids.indexOf("op_cov") >= 0 && ids.indexOf("op_rf") < 0 && g !== "territory") extraMeasures.push(OP_BY.op_rf);
    if (ids.indexOf("op_rf") >= 0 && ids.indexOf("op_cov") < 0) extraMeasures.push(OP_BY.op_cov);
    if (g === "line" || g === "bu") extraMeasures.push(OP_BY.op_customers);
    return { ok: true, rows: rows, total: total, basis: basis, caveats: caveats, asOf: asOf ? String(asOf) : null, extraMeasures: extraMeasures,
             formula: "Operational coverage % = mean(Covered Doctor) · Right Frequency % = mean(Right Freq) over the operational population" };
  }

  function opVocab() {
    return { bu: allowedBUs(), line: allowedLines(), dm: (tabVocab().dm || []) };
  }

  var opProvider = {
    id: "opcov", label: "Operational coverage (Executive)", tabs: ["executive"], domains: ["coverage"],
    defaultMeasure: "op_cov", rankMeasure: "op_cov",
    canUse: function () { return !!(CS() && CD()); },
    requires: [], measures: OP_M,
    dims: { bu: { label: "Business Unit" }, line: { label: "Line" }, ctype: { label: "Customer type" }, specialty: { label: "Specialty" }, klass: { label: "Customer class" }, territory: { label: "Territory" }, dm: { label: "District Manager" } },
    hierarchy: { bu: "line", line: "territory", ctype: null },
    vocab: opVocab,
    availability: availability(null),
    scopeLabel: scopeLabel,
    sourceNote: function () { return "Coverage cache · Executive operational-coverage calculation · sick-leave exempt rows removed"; },
    singleScopeOptions: singleScopeOptions,
    fetch: opFetch
  };

  if (global.AskQuery) { global.AskQuery.registerProvider(tabProvider); global.AskQuery.registerProvider(opProvider); }
  global.AskProvCoverage = { tab: tabProvider, op: opProvider, periodKeys: periodKeys, periodSel: periodSel };
})(typeof window !== "undefined" ? window : this);
