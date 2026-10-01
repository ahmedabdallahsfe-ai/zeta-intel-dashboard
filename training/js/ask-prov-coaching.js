(function(g){(g.AskBuild=g.AskBuild||{})["ask-prov-coaching.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — Coaching Intelligence provider
 * ============================================================================
 * Source of every number: CoachingDashboard.askApi() — the page's own scoped manager list
 * (getVisibleManagers: AUTH BU/line scope + the "DM sees only their own team" rule) and the
 * page's own aggregateOwnTier / metricsFor / statusFor / effectiveTargets / repCadenceForPeriod.
 *
 * Period semantics follow the page: it defines a metric for ONE month or for the full YTD
 * cumulative ("ALL"). A period that is a strict part of the data (Q2, Feb–Apr, H1 when data runs
 * to Aug…) is answered only for measures that are additive (visits, coaching days, visits per
 * coaching day = Σvisits ÷ Σdays, cross-team visits). DV Coverage, reps coached and the
 * on-target count are NOT additive across months (rosters change, reps repeat), the page does
 * not define them for a partial range, so they are reported as missing rather than estimated.
 */
(function (global) {
  "use strict";
  function L() { return global.AskProvLib; }
  function CD() { return global.CoachingDashboard; }
  function AU() { return global.AUTH; }

  function api() { try { return CD() && CD().askApi ? CD().askApi() : null; } catch (e) { return null; } }
  function canonLine(l) { var S = global.SEMANTIC; return l && S && S.normalizeLine ? (S.normalizeLine(l) || l) : l; }
  function canonBU(m) {
    var S = global.SEMANTIC, b = S && S.lineToBU ? S.lineToBU(canonLine(m.line)) : null;
    return b || (m.bu && m.bu !== "0" && m.bu !== "Unassigned" ? m.bu : null);
  }
  function pushOnce(a, s) { if (a && a.indexOf(s) < 0) a.push(s); }

  function periodSpec(a, keys, label) {
    keys = (keys || []).filter(Boolean);
    var all = a.months || [];
    if (!keys.length) return { mode: "all", key: "ALL", label: "YTD cumulative" };
    var covers = all.every(function (k) { return keys.indexOf(k) >= 0; });
    if (covers) return { mode: "all", key: "ALL", label: "YTD cumulative (Feb–Aug)" };
    if (keys.length === 1) return { mode: "month", key: keys[0], label: label || keys[0] };
    return { mode: "range", keys: keys.slice(), label: label || keys.join(", ") };
  }

  function targetsFor(a, rows) {
    var own = rows.filter(function (r) { return r.own; });
    var allChc = own.length && own.every(function (r) { return canonLine(r.line) === "CHC_SALES"; });
    return a.targetsForLine(allChc ? "CHC_SALES" : "");
  }

  function monthMetrics(a, m, key) { return a.metricsFor(m, key) || a.emptyMetrics; }

  /** Aggregate the OWN-TIER managers of a group for the chosen period, with the page's own functions. */
  function agg(rows, ctx) {
    var a = ctx.load.api, ps = ctx.load.ps, own = rows.filter(function (r) { return r.own; }).map(function (r) { return r.m; });
    if (!own.length) return null;
    var out;
    if (ps.mode !== "range" && own.length === 1) {
      // One manager: the page's table row itself (metricsFor), shown only when active in the period.
      var m = own[0];
      if (!a.managerActiveInPeriod(m, ps.key)) return null;
      var mm = monthMetrics(a, m, ps.key);
      out = { single: true, mm: mm, visits: mm.visits, days: mm.coachingDays, avgPerDay: mm.avgVisitsPerDay, coveragePct: mm.dvCoveragePct,
              offRoster: mm.coachedOffRoster, repsCoached: (mm.coachedOnRoster || 0) + (mm.coachedOffRoster || 0), mgrs: [m] };
      return out;
    }
    if (ps.mode !== "range") {
      var g = a.aggregateOwnTier(own, ps.key);
      g.mgrs = own;
      return g;
    }
    var t = { visits: 0, days: 0, offRoster: 0, coveragePct: null, repsCoached: null, mgrs: own, range: true };
    ps.keys.forEach(function (k) { var x = a.aggregateOwnTier(own, k); t.visits += x.visits; t.days += x.days; t.offRoster += x.offRoster; });
    t.avgPerDay = t.days > 0 ? t.visits / t.days : 0;
    return t;
  }

  function onTargetCounts(rows, ctx) {
    var a = ctx.load.api, ps = ctx.load.ps;
    if (ps.mode === "range") return null;
    var own = rows.filter(function (r) { return r.own; }).map(function (r) { return r.m; }).filter(function (m) { return a.managerActiveInPeriod(m, ps.key); });
    if (!own.length) return null;
    var t = targetsFor(a, rows);
    var n = own.filter(function (m) { var mm = monthMetrics(a, m, ps.key); return a.statusFor(mm.dvCoveragePct, mm.avgVisitsPerDay, t).label === "ON TARGET"; }).length;
    return { on: n, of: own.length };
  }

  function notCoached(rows, ctx) {
    var a = ctx.load.api, ps = ctx.load.ps;
    if (ps.mode === "range") return null;
    var own = rows.filter(function (r) { return r.own; }).map(function (r) { return r.m; }).filter(function (m) { return a.managerActiveInPeriod(m, ps.key); });
    if (!own.length) return null;
    var n = 0;
    own.forEach(function (m) { var b = monthMetrics(a, m, ps.key); n += (b.notCoachedNames || []).length; });
    return n;
  }

  function tgt(id) { var a = api(); if (!a) return null; var t = a.data.targets || {}; return id === "cov" ? t.dvCoveragePct : t.avgVisitsPerDay; }

  var M = [
    { id: "coach_dv_cov", label: "DV Coverage %", unit: "pct", better: "high", gapMeasure: "coach_dv_cov_gap",
      aliases: ["dv coverage", "double visit coverage", "double visits coverage", "coaching coverage", "dv coverage percent", "joint visit coverage", "coached coverage"],
      def: "Coached active reps on the manager's own roster ÷ the manager's active roster size (capped at 100%); cross-team reps are counted separately.",
      formula: "Σ coached-on-roster ÷ Σ period active team size × 100 (never an average of manager percentages)",
      grains: ["bu", "line", "dm", "tier"],
      agg: function (rows, ctx) { var g = agg(rows, ctx); return g && g.coveragePct !== null && g.coveragePct !== undefined ? g.coveragePct : null; } },
    { id: "coach_dv_cov_gap", label: "DV Coverage gap to target", unit: "pts", better: "low", gap: true,
      aliases: ["dv coverage gap", "dv coverage shortfall", "coaching coverage gap", "double visit coverage gap"],
      def: "Target DV Coverage minus actual DV Coverage, in percentage points (positive = short of target).", formula: "target − DV Coverage %",
      grains: ["bu", "line", "dm", "tier"],
      agg: function (rows, ctx) { var g = agg(rows, ctx); if (!g || g.coveragePct === null || g.coveragePct === undefined) return null; var t = targetsFor(ctx.load.api, rows); return t.dvCoveragePct - g.coveragePct; } },
    { id: "coach_avg_day", label: "Avg visits per coaching day", unit: "num", better: "high", gapMeasure: "coach_day_gap",
      aliases: ["visits per coaching day", "avg visits per coaching day", "average visits per coaching day", "calls per dv day", "calls per double visit day", "dv intensity", "coaching intensity", "visits per dv day", "calls per coaching day", "calls per dv"],
      def: "Total joint visits ÷ total coaching days for that grain — never an average of smaller-grain averages.", formula: "Σ visits ÷ Σ coaching days",
      grains: ["bu", "line", "dm", "tier"],
      agg: function (rows, ctx) { var g = agg(rows, ctx); return g && g.days > 0 ? g.avgPerDay : null; } },
    { id: "coach_day_gap", label: "Visits per coaching day gap to target", unit: "num", better: "low", gap: true,
      aliases: ["coaching intensity gap", "visits per coaching day gap", "dv intensity gap"],
      def: "Target visits per coaching day minus actual (positive = below target). The page uses 12 for a CHC_SALES-only view, otherwise the cache target.", formula: "target − Σ visits ÷ Σ coaching days",
      grains: ["bu", "line", "dm", "tier"],
      agg: function (rows, ctx) { var g = agg(rows, ctx); if (!g || !(g.days > 0)) return null; return targetsFor(ctx.load.api, rows).avgVisitsPerDay - g.avgPerDay; } },
    { id: "coach_days", label: "Coaching days", unit: "count", better: "high",
      aliases: ["coaching days", "dv days", "double visit days", "days coached", "field coaching days"],
      def: "Days on which the manager coached in the field.", formula: "Σ coaching days", grains: ["bu", "line", "dm", "tier"],
      agg: function (rows, ctx) { var g = agg(rows, ctx); return g ? g.days : null; } },
    { id: "coach_visits", label: "Coached visits", unit: "count", better: "high",
      aliases: ["coaching visits", "coached visits", "dv visits", "double visits", "joint visits", "joint field visits", "coached field visits"],
      def: "Joint / coached field visits made by the manager.", formula: "Σ visits", grains: ["bu", "line", "dm", "tier"],
      agg: function (rows, ctx) { var g = agg(rows, ctx); return g ? g.visits : null; } },
    { id: "coach_reps", label: "Reps coached", unit: "count", better: "high",
      aliases: ["reps coached", "number of reps coached", "how many reps were coached", "how many reps coached", "distinct reps coached"],
      def: "Distinct reps who were double-visited in the period (page KPI “Reps Coached”).", formula: "distinct coached reps (half-month hire/resignation rule applied by the page)", grains: ["bu", "line", "dm", "tier"],
      agg: function (rows, ctx) { var g = agg(rows, ctx); return g && g.repsCoached !== null && g.repsCoached !== undefined ? g.repsCoached : null; } },
    { id: "coach_cross", label: "Cross-team coaching visits", unit: "count", better: "low",
      aliases: ["cross team coaching", "cross team coaching visits", "visits to reps outside own roster", "off roster coaching", "off roster visits"],
      def: "Coached visits to reps who are not on the manager's own roster.", formula: "Σ coached off-roster", grains: ["bu", "line", "dm", "tier"],
      agg: function (rows, ctx) { var g = agg(rows, ctx); return g ? g.offRoster : null; } },
    { id: "coach_on_target", label: "Managers on target", unit: "count", better: "high",
      aliases: ["managers on target", "dms on target", "dms meeting both targets", "on target managers", "managers meeting coaching targets"],
      def: "District Managers / Field Force Supervisors meeting BOTH the DV Coverage and visits-per-day targets (page status “ON TARGET”).", formula: "count of managers with status ON TARGET",
      grains: ["bu", "line", "tier"],
      agg: function (rows, ctx) { var c = onTargetCounts(rows, ctx); return c ? c.on : null; } },
    { id: "coach_on_target_pct", label: "Share of managers on target", unit: "pct", better: "high",
      aliases: ["share of managers on target", "percent of managers on target", "managers on target percent"],
      def: "Managers on target as a share of District Managers / Field Force Supervisors in view.", formula: "ON TARGET managers ÷ managers in view × 100", grains: ["bu", "line", "tier"],
      agg: function (rows, ctx) { var c = onTargetCounts(rows, ctx); return c && c.of ? (c.on / c.of) * 100 : null; } },
    { id: "coach_not_coached", label: "Reps not coached", unit: "count", better: "low",
      aliases: ["reps not coached", "how many reps are not coached", "how many reps were not coached", "how many reps have not been coached", "number of reps not coached", "uncoached reps count", "count of reps not coached"],
      def: "Roster reps of the manager who were not double-visited in the period (the “Not Coached” list of the DV Coverage popup).", formula: "count of notCoachedNames across managers in view",
      grains: ["bu", "line", "dm", "tier"],
      agg: function (rows, ctx) { return notCoached(rows, ctx); } },
    { id: "coach_not_coached_list", label: "Not-coached rep list", unit: "count", kind: "list",
      aliases: ["who is not coached", "who has not been coached", "who was not coached", "which reps have not been coached", "which reps are not coached", "reps who were not coached", "list not coached reps", "list of not coached reps", "not coached reps", "reps not coached list", "who are the reps not coached", "show not coached reps"],
      def: "The reps on a manager's roster who were not double-visited in the period, with their managers.", formula: "notCoachedNames of each manager in view", grains: [] },
    { id: "coach_reps_list", label: "Coached-rep list", unit: "count", kind: "list",
      aliases: ["list coached reps", "which reps were coached", "coached reps list", "show coached reps", "reps coached by", "who was coached", "who were coached"],
      def: "The reps a manager double-visited, with coaching days, visits and visits per day.", formula: "each coached employee's cadence for the period (page's repCadenceForPeriod)", grains: [] }
  ];
  // Targets are read from the page's own cache at ask time (never hard-coded here).
  Object.defineProperty(M[0], "targetValue", { get: function () { return tgt("cov"); }, enumerable: true });
  Object.defineProperty(M[2], "targetValue", { get: function () { return tgt("day"); }, enumerable: true });

  var DIMS = {
    bu: { label: "Business Unit", get: function (r) { return r.bu; } },
    line: { label: "Line", get: function (r) { return r.line; } },
    dm: { label: "District Manager", get: function (r) { return r.own ? r.name : null; } },
    tier: { label: "Level", get: function (r) { return r.title; } }
  };

  function load(req) {
    var a = api();
    if (!a) return { ok: false, missing: "Coaching Intelligence is not available to this account, or its cache is not loaded." };
    var period = req.period || {}, ps = periodSpec(a, period.keys, period.label);
    var caveats = [], basis = [["Data", "Coaching cache — Visits Details S1 DM.xlsx joined to Database Shortcut.xlsx"], ["Period", ps.label]];
    var rows = a.managers.filter(function (m) { return L().attributable(canonBU(m), canonLine(m.line), a.isOwnTier(m)); }).map(function (m) {
      return { m: m, name: m.name, title: m.title, line: canonLine(m.line), bu: canonBU(m), own: a.isOwnTier(m) };
    });
    if (ps.mode === "range") caveats.push("This period is a strict part of the coaching data. Only additive measures (visits, coaching days, visits per coaching day, cross-team visits) are defined for it; DV Coverage, reps coached, on-target and not-coached counts are defined by the page for one month or the full YTD only, so they are left out.");
    caveats.push("Coverage, targets and status exist only for District Managers, Field Force Supervisors and Senior DMs; other levels have no coverage % or target on the page.");
    var t0 = a.data.targets || {};
    basis.push(["Targets (page)", "DV Coverage " + t0.dvCoveragePct + "% · Visits per coaching day " + t0.avgVisitsPerDay + " (12 for a CHC_SALES-only view)"]);
    var months = a.months;
    return { ok: true, rows: rows, basis: basis, caveats: caveats, api: a, ps: ps, asOf: months.length ? months[months.length - 1] : null,
             formula: "DV Coverage = Σ coached-on-roster ÷ Σ active team size; Visits/day = Σ visits ÷ Σ coaching days" };
  }

  function vocab() {
    var a = api(); if (!a) return {};
    var bu = {}, line = {}, dm = {};
    a.managers.forEach(function (m) {
      if (!L().attributable(canonBU(m), canonLine(m.line), a.isOwnTier(m))) return;
      var b = canonBU(m);
      if (b) bu[b] = 1; if (m.line) line[canonLine(m.line)] = 1;
      if (a.isOwnTier(m) && m.name) dm[m.name] = 1;
    });
    return { bu: Object.keys(bu).sort(), line: Object.keys(line).sort(), dm: Object.keys(dm).sort() };
  }

  // ---- list ops ---------------------------------------------------------------------
  function inFilters(m, bu, f) {
    if (f.line && !L().same(canonLine(m.line), f.line)) return false;
    if (f.bu && !L().same(bu, f.bu)) return false;
    if (f.dm && !L().same(m.name, f.dm)) return false;
    return true;
  }
  function buOf(m) { return canonBU(m); }
  function periodOf(pl, pr) {
    var a = api(); if (!a) return null;
    return periodSpec(a, pr && pr.primary && pr.primary.keys, pr && pr.primary && pr.primary.label);
  }

  var ops = {
    list: function (pl, pr) {
      var a = api(); if (!a) return { ok: false, missing: "Coaching Intelligence is not available to this account, or its cache is not loaded." };
      var m0 = pl.chosen[0], f = pl.filters || {}, ps = periodOf(pl, pr), n = Math.max(pl.n || 10, 10);
      if (ps.mode === "range") return { ok: false, missing: "The Coaching page lists coached / not-coached reps for one month or the full YTD only; a partial range (" + ps.label + ") has no list on the page." };
      var mgrs = a.managers.filter(function (m) { return a.isOwnTier(m) && L().attributable(canonBU(m), canonLine(m.line), true) && inFilters(m, buOf(m), f) && a.managerActiveInPeriod(m, ps.key); });
      if (!mgrs.length) return { ok: false, missing: "No District Manager / Field Force Supervisor matches that scope in " + ps.label + " within your access." };
      var basis = [["Data", "Coaching cache (page roster lists)"], ["Period", ps.label], ["Managers in view", String(mgrs.length)]];
      if (m0.id === "coach_not_coached_list") {
        var items = [];
        mgrs.forEach(function (m) {
          var b = monthMetrics(a, m, ps.key), leave = {};
          (b.leaveExcludedNames || []).forEach(function (x) { leave[String(x).toLowerCase()] = 1; });
          (b.notCoachedNames || []).forEach(function (it) { items.push({ name: it.name, position: it.position, note: it.note, mgr: m.name, line: m.line, leave: !!leave[String(it.name).toLowerCase()] }); });
        });
        var shown = items.slice(0, n);
        return {
          ok: true, headline: items.length + " rep" + (items.length === 1 ? "" : "s") + " not coached (" + ps.label + ")",
          detail: items.length ? "Showing " + shown.length + " of " + items.length + ", grouped as the page's “Not Coached” lists." : "Every roster rep was coached in this period.",
          rows: shown.map(function (it, i) { return { rank: i + 1, name: it.name, cells: [it.mgr, canonLine(it.line) || "—", it.position || "—", it.leave ? "On leave — out of denominator" : (it.note || "")] }; }),
          columns: ["Manager", "Line", "Position", "Note"], nameHeader: "Rep",
          formula: "notCoachedNames of each manager in view", measureIds: ["coach_not_coached_list"], evidence: basis,
          caveats: ["Names come from the page's own roster lists; hired / resigned notes and leave exclusions are exactly what the page shows."],
          drill: [{ label: "DV Coverage by manager", question: "dv coverage by dm" }, { label: "Reps not coached by line", question: "reps not coached by line" }]
        };
      }
      // coached reps (cadence)
      var reps = [];
      mgrs.forEach(function (m) {
        (m.coachedEmployees || []).forEach(function (ce) {
          var r = a.repCadenceForPeriod(ce, ps.key);
          if (r) reps.push({ name: r.name, position: r.position, mgr: m.name, days: r.coachingDays, visits: r.visits, avg: r.avgVisitsPerDay });
        });
      });
      reps.sort(function (x, y) { return (y.avg - x.avg) || (y.visits - x.visits); });
      var sh = reps.slice(0, n);
      if (!reps.length) return { ok: false, missing: "No coached reps in " + ps.label + " for that scope." };
      return {
        ok: true, headline: reps.length + " coached rep" + (reps.length === 1 ? "" : "s") + " (" + ps.label + ")",
        detail: "Showing " + sh.length + " of " + reps.length + ", highest visits per coaching day first.",
        rows: sh.map(function (r, i) { return { rank: i + 1, name: r.name, cells: [r.mgr, String(r.days), String(r.visits), r.avg.toFixed(2)] }; }),
        columns: ["Manager", "Coaching days", "Visits", "Visits / day"], nameHeader: "Rep",
        formula: "page repCadenceForPeriod for each coached employee", measureIds: ["coach_reps_list"], evidence: basis,
        drill: [{ label: "Not coached reps", question: "who is not coached" }]
      };
    }
  };

  var provider = L().make({
    id: "coaching", label: "Coaching Intelligence", tabs: ["coaching"], domains: ["coaching"],
    defaultMeasure: "coach_dv_cov", rankMeasure: "coach_dv_cov", requires: ["coaching"],
    canUse: function () { return !!(AU() && AU().canViewCoaching && AU().canViewCoaching() && CD() && CD().askApi); },
    measures: M, dims: DIMS, hierarchy: { bu: "line", line: "dm", tier: "dm", dm: null }, ladder: ["bu", "line", "dm"],
    load: load, vocab: vocab, ops: ops,
    missingReason: function (req, Lr, ms) {
      if (Lr.ps && Lr.ps.mode === "range") return ms.map(function (m) { return "“" + m.label + "”"; }).join(", ") + " is not defined by the Coaching page for a partial range (" + Lr.ps.label + "): it exists for one month or the full YTD. Visits, coaching days and visits per coaching day are additive and can be asked for this range.";
      return null;
    },
    availability: function () { var a = api(); return { name: "Coaching", months: a ? a.months : [], defaultPeriod: "ytd" }; },
    sourceNote: function () { return "Coaching cache · Visits Details S1 DM.xlsx × Database Shortcut.xlsx"; }
  });
  global.AskProvCoaching = { provider: provider };
})(typeof window !== "undefined" ? window : this);
