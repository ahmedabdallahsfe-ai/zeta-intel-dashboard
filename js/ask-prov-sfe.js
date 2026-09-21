(function(g){(g.AskBuild=g.AskBuild||{})["ask-prov-sfe.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — SFE / Organogram provider for the AskQuery layer
 * ============================================================================
 * Every figure is a value the SFE module already exposes:
 *   BU / line headcount & vacancy   SFEDashboard.getFilteredHeadcountForLine(bu, line)
 *   manager vacancy                 SFEDashboard.getData().vacancyByManager      (row.line scoped by AUTH)
 *   span of control                 SFEDashboard.getData().spanOfControl.dmSpan / asmSpan (row.line scoped by AUTH)
 *   vacant positions                SFEDashboard.getData().vacantPositions       (row.line scoped by AUTH)
 *
 * The organogram is a POINT-IN-TIME snapshot: it has no month axis, so a typed period cannot
 * change a figure, and month-over-month / trend questions are answered with an explicit
 * "not in the data", never with an invented history.
 *
 * SCOPE: getData() is the raw, unscoped cache. Every row read from it here is filtered with
 * the same test sfe.js itself uses (AUTH.isLineAllowed(line) && AUTH.isBuAllowed(lineToBU(line))).
 * Aggregates that are pre-computed over the whole company (brickWorkload.buckets, averageDmSpan,
 * tenure summaries) are deliberately NOT exposed — they would leak out-of-scope totals.
 */
(function (global) {
  "use strict";
  function SFE() { return global.SFEDashboard; }
  function SEM() { return global.SEMANTIC; }
  function AU() { return global.AUTH; }

  function inScope(line) {
    if (!SEM()) return false;
    var bu = SEM().lineToBU(line);
    if (!bu) return false;
    if (AU()) {
      if (AU().isLineAllowed && !AU().isLineAllowed(line)) return false;
      if (AU().isBuAllowed && !AU().isBuAllowed(bu)) return false;
    }
    return true;
  }
  function allowedBUs() {
    var l = SEM().BU_LIST.slice();
    return AU() && AU().filterAllowedBUs ? AU().filterAllowedBUs(l) : l;
  }
  function allowedLines() {
    var map = SEM() && SEM().CANONICAL_LINE_TO_BU, out = [];
    Object.keys(map || {}).forEach(function (n) { if (!AU() || !AU().isLineAllowed || AU().isLineAllowed(n)) out.push(n); });
    return out;
  }
  function lineBU(line) { var m = SEM() && SEM().CANONICAL_LINE_TO_BU; return m ? (m[line] || null) : null; }
  function canon(line) { return SEM().normalizeLine(line); }
  function data() { return SFE() ? SFE().getData() : {}; }
  function matchesScope(rowLine, f) {
    if (!inScope(rowLine)) return false;
    if (f.line && canon(rowLine) !== f.line) return false;
    if (f.bu && SEM().lineToBU(rowLine) !== f.bu) return false;
    return true;
  }
  function scopeLabel() {
    var s = AU() && AU().getScope ? AU().getScope() : null;
    if (!s || s.unrestricted) return "whole company";
    var parts = [];
    if (s.bus && s.bus.length) parts.push(s.bus.join(", "));
    if (s.lines && s.lines.length) parts.push(s.lines.length > 4 ? s.lines.slice(0, 4).join(", ") + " +" + (s.lines.length - 4) + " more" : s.lines.join(", "));
    return parts.length ? parts.join(" · ") : "your scope";
  }
  function pct(a, b) { return b > 0 ? (a / b) * 100 : null; }

  var M = [
    { id: "vacancy_rate", label: "Vacancy rate", unit: "pct", better: "low", alt: "mgr_vacancy_rate", targetValue: null,
      aliases: ["vacancy rate", "vacancy", "vacancies", "vacancy percentage", "vacant rate", "vacancy pct"],
      def: "Vacant positions as a percentage of budgeted positions.", formula: "vacant ÷ total budgeted × 100", grains: ["bu", "line"] },
    { id: "headcount_total", label: "Budgeted positions", unit: "count", better: "high", aliases: ["budgeted positions", "total positions", "positions", "seats", "budgeted seats", "total headcount", "planned headcount"],
      def: "Budgeted field positions (filled + vacant).", formula: "active + vacant", grains: ["bu", "line"] },
    { id: "headcount_active", label: "Active headcount", unit: "count", better: "high", aliases: ["active headcount", "headcount", "head count", "active reps", "filled positions", "active seats", "staff", "how many reps", "how many people"],
      def: "Filled positions in the organogram.", formula: "count of filled positions", grains: ["bu", "line"] },
    { id: "headcount_vacant", label: "Vacant positions", unit: "count", better: "low", aliases: ["vacant positions", "vacant seats", "open positions", "open seats", "number of vacancies", "how many vacancies", "unfilled positions"],
      def: "Budgeted positions with nobody in them.", formula: "count of vacant positions", grains: ["bu", "line"] },
    { id: "mgr_vacancy_rate", label: "Manager vacancy rate", unit: "pct", better: "low", aliases: ["manager vacancy rate", "vacancy rate by manager", "manager vacancy", "team vacancy rate"],
      def: "Vacant positions under a manager as a percentage of that manager's budgeted positions (organogram, per manager and line).", formula: "vacant ÷ total × 100 per manager", grains: ["dm"] },
    { id: "mgr_vacant", label: "Vacant positions under manager", unit: "count", better: "low", aliases: ["vacant positions under manager", "vacancies per manager", "manager vacancies"],
      def: "Vacant positions in the manager's team.", formula: "vacant count per manager", grains: ["dm"] },
    { id: "span_count", label: "Span of control", unit: "count", better: "high", aliases: ["span of control", "span", "team size", "direct reports", "reps per manager", "reps per dm", "how many reps per manager"],
      def: "Active people reporting to the manager.", formula: "count of active direct reports", grains: ["dm", "am"] },
    { id: "span_planned", label: "Planned span", unit: "count", better: "high", aliases: ["planned span", "planned team size", "budgeted span"],
      def: "Budgeted people under the manager (filled + vacant).", formula: "planned count", grains: ["dm", "am"] },
    { id: "span_overloaded", label: "Overloaded managers", unit: "count", better: "low", aliases: ["overloaded managers", "overstretched managers", "overloaded dms", "overstretched dms", "span overload", "overloaded"],
      def: "Managers the organogram flags as overloaded (span above its own threshold).", formula: "count of managers with the overloaded flag", grains: ["dm", "am"] },
    { id: "vacant_positions", label: "Vacant position list", unit: "count", kind: "list", aliases: ["which positions are vacant", "list vacant positions", "list of vacant positions", "vacant position list", "show vacant positions", "where are the vacancies", "which seats are vacant", "positions vacant", "which positions vacant", "positions are vacant", "which positions are open", "which are the vacant positions", "what positions are vacant", "vacant positions list", "open positions list", "seats vacant"],
      def: "The vacant positions in your scope, with their line and district manager.", formula: "vacantPositions rows within your scope", grains: [] }
  ];

  function fetch(req) {
    if (!SFE() || !SEM()) return { ok: false, missing: "The organogram module has not loaded yet." };
    var d = data();
    if (!d || !(d.vacancyByLine || []).length) return { ok: false, missing: "The organogram cache is not loaded." };
    var f = req.filters || {}, g = req.groupBy || null;
    var mine = allowedBUs();
    if (f.bu && mine.indexOf(f.bu) < 0) return { ok: false, missing: "“" + f.bu + "” is outside the data you have access to." };
    if (f.line && AU() && AU().isLineAllowed && !AU().isLineAllowed(f.line)) return { ok: false, missing: "“" + f.line + "” is outside the data you have access to." };
    var bus = f.line ? [lineBU(f.line)] : f.bu ? [f.bu] : mine;
    var basis = [["Data", "Organogram cache — point-in-time snapshot (not period-stamped)"]];
    var caveats = ["The organogram has no month axis, so the figures do not change with the period you name."];
    var rows = [], total = null;

    function hcFor(bu, line) {
      var r = SFE().getFilteredHeadcountForLine(bu, line || null);
      return r && r.ok ? r : null;
    }
    function hcVals(r) { return { vacancy_rate: r.vacancyRatePct, headcount_total: r.headcountTotal, headcount_active: r.headcountActive, headcount_vacant: r.headcountVacant }; }

    if (!g || g === "bu" || g === "line") {
      var ta = 0, tv = 0, tt = 0, any = false;
      bus.forEach(function (bu) { var r = hcFor(bu, f.line); if (r) { any = true; ta += r.headcountActive; tv += r.headcountVacant; tt += r.headcountTotal; } });
      if (!any) return { ok: false, missing: "The organogram holds no headcount for this scope." };
      total = { vacancy_rate: pct(tv, tt), headcount_total: tt, headcount_active: ta, headcount_vacant: tv };
      if (g === "bu") bus.forEach(function (bu) { var r = hcFor(bu, f.line); if (r) rows.push({ name: bu, v: hcVals(r) }); });
      else if (g === "line") {
        allowedLines().filter(function (l) { return bus.indexOf(lineBU(l)) >= 0 && (!f.line || l === f.line); }).forEach(function (l) {
          var r = hcFor(lineBU(l), l); if (r && r.headcountTotal > 0) rows.push({ name: l, bu: lineBU(l), v: hcVals(r) });
        });
      } else rows = [{ name: f.line || f.bu || "Total", v: total }];
    } else if (g === "dm" || g === "am") {
      var span = (g === "dm" ? (d.spanOfControl || {}).dmSpan : (d.spanOfControl || {}).asmSpan) || [];
      var byName = {};
      span.forEach(function (s) {
        if (!s.managerName || /^VACANT/i.test(s.managerName)) return;
        if (!matchesScope(s.line, f)) return;
        var r = byName[s.managerName] || (byName[s.managerName] = { name: s.managerName, bu: SEM().lineToBU(s.line), v: { span_count: 0, span_planned: 0, span_overloaded: 0, mgr_vacant: 0 } });
        r.v.span_count += s.spanCount || 0; r.v.span_planned += s.plannedCount || 0; r.v.mgr_vacant += s.vacantCount || 0;
        if (s.overloaded) r.v.span_overloaded = 1;
      });
      if (g === "dm") {
        (d.vacancyByManager || []).forEach(function (m) {
          if (!m.manager || !matchesScope(m.line, f)) return;
          var r = byName[m.manager] || (byName[m.manager] = { name: m.manager, bu: SEM().lineToBU(m.line), v: {} });
          r.v.mgr_vacancy_rate = m.vacancyRate; r.v.mgr_vacant = m.vacant;
        });
      }
      Object.keys(byName).forEach(function (k) { rows.push(byName[k]); });
      total = rows.reduce(function (s, r) { s.span_count += r.v.span_count || 0; s.span_planned += r.v.span_planned || 0; s.span_overloaded += r.v.span_overloaded || 0; return s; }, { span_count: 0, span_planned: 0, span_overloaded: 0 });
      caveats.push("Manager rows are the organogram's own span-of-control table" + (g === "dm" ? " and manager vacancy table" : "") + ", limited to lines in your scope. Vacant manager seats are left out.");
      if (g === "dm") caveats.push("The manager-vacancy table lists only managers with vacancies; a manager absent from it has none in the organogram.");
    } else {
      return { ok: false, missing: "The organogram cannot be grouped by " + g + "." };
    }
    if (!rows.length) return { ok: false, missing: "The organogram has no rows for that cut in your scope." };
    var ids = req.measures.map(function (m) { return m.id; });
    var extra = [];
    var by = {}; M.forEach(function (m) { by[m.id] = m; });
    if (g === "dm" || g === "am") { if (ids.indexOf("span_count") < 0 && ids.indexOf("mgr_vacancy_rate") < 0) extra.push(by.span_count); extra.push(by.span_planned); }
    else { if (ids.indexOf("headcount_vacant") < 0) extra.push(by.headcount_vacant); if (ids.indexOf("headcount_total") < 0) extra.push(by.headcount_total); }
    return { ok: true, rows: rows, total: total, basis: basis, caveats: caveats, asOf: null, extraMeasures: extra,
             formula: "Vacancy rate = vacant ÷ budgeted positions × 100" };
  }

  var ops = {
    list: function (pl, pr, h) {
      var d = data(), f = pl.filters || {};
      var rows = (d.vacantPositions || []).filter(function (p) { return matchesScope(p.line, f); });
      if (!rows.length) return { ok: true, headline: "No vacant positions in your scope", detail: "The organogram lists none.", evidence: [["Data", "Organogram vacantPositions, limited to your scope"]], measureIds: ["vacant_positions"], formula: "vacantPositions rows within your scope" };
      var n = Math.min(rows.length, Math.max(pl.n, 10));
      var shown = rows.slice(0, n);
      return {
        ok: true, headline: rows.length + " vacant position" + (rows.length === 1 ? "" : "s") + (f.line ? " in " + f.line : f.bu ? " in " + f.bu : " in your scope"),
        detail: "Showing " + shown.length + " of " + rows.length + " · organogram snapshot.",
        rows: shown.map(function (p, i) { return { rank: i + 1, name: p.position || "(unnamed)", cells: [p.line || "—", p.dm || "—", p.district || p.area || "—"] }; }),
        columns: ["Line", "District manager", "District / area"], nameHeader: "Position",
        formula: "vacantPositions rows within your scope", measureIds: ["vacant_positions"],
        evidence: [["Data", "Organogram vacantPositions, limited to your scope"], ["Rows in scope", String(rows.length)]],
        caveats: ["The list is the organogram's own vacant-positions table; nothing is added or estimated."],
        drill: [{ label: "Vacancy rate by line", question: "vacancy rate by line" }]
      };
    }
  };

  var provider = {
    id: "sfe", label: "SFE / Organogram", tabs: ["sfe"], domains: ["sfe"], defaultMeasure: "vacancy_rate", rankMeasure: "vacancy_rate",
    canUse: function () { return !!(SFE() && SEM()); },
    requires: [], measures: M,
    dims: { bu: { label: "Business Unit" }, line: { label: "Line" }, dm: { label: "District Manager" }, am: { label: "Area Manager" } },
    hierarchy: { bu: "line", line: "dm", dm: null },
    vocab: function () {
      var d = data(), dm = {}, am = {};
      ((d.spanOfControl || {}).dmSpan || []).forEach(function (s) { if (s.managerName && !/^VACANT/i.test(s.managerName) && inScope(s.line)) dm[s.managerName] = 1; });
      ((d.spanOfControl || {}).asmSpan || []).forEach(function (s) { if (s.managerName && !/^VACANT/i.test(s.managerName) && inScope(s.line)) am[s.managerName] = 1; });
      (d.vacancyByManager || []).forEach(function (m) { if (m.manager && !/^VACANT/i.test(m.manager) && inScope(m.line)) dm[m.manager] = 1; });
      return { bu: allowedBUs(), line: allowedLines(), dm: Object.keys(dm).sort(), am: Object.keys(am).sort() };
    },
    availability: function () { return { name: "SFE", months: [], snapshot: true, snapshotNote: "organogram snapshot" }; },
    scopeLabel: scopeLabel,
    sourceNote: function () { return "Organogram cache · point-in-time snapshot"; },
    singleScopeOptions: function () {
      var s = AU() && AU().getScope ? AU().getScope() : null, bus = allowedBUs();
      if (s && !s.unrestricted && s.lines && s.lines.length === 1) return [{ dim: "line", name: s.lines[0] }];
      return bus.map(function (b) { return { dim: "bu", name: b }; });
    },
    fetch: fetch, ops: ops
  };
  if (global.AskQuery) global.AskQuery.registerProvider(provider);
  global.AskProvSFE = { provider: provider };
})(typeof window !== "undefined" ? window : this);
