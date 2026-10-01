(function(g){(g.AskBuild=g.AskBuild||{})["ask-prov-lib.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — provider library
 * ============================================================================
 * Most dashboard domains (Working Days, Coaching, Sprint, IMS Rx, IQVIA, Market
 * Intelligence, To-Market) hand the page a list of already-scoped records and
 * then aggregate them with their own function. This helper turns such a domain
 * into an AskQuery provider without re-implementing anything:
 *
 *     spec.load(req)   -> { ok, rows:[record], basis, caveats, asOf } | { ok:false, missing }
 *                         The records the page itself renders from, already restricted to the
 *                         signed-in user's scope and to the requested period.
 *     spec.dims        -> { dimKey:{ label, get(record) } }  how a record is cut
 *     spec.measures[i].agg(records, ctx) -> number|null
 *                         MUST call the dashboard's own aggregate where one exists.
 *
 * The library only does what any dashboard filter/group-by does: filter records by
 * name, group them, and call the measure's aggregate on each group. It never
 * fabricates a value: an empty cut is a "missing", not a zero.
 */
(function (global) {
  "use strict";

  function nk(s) { return String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
  function tk(s) {
    var t = nk(s).split(" ").filter(Boolean), seen = {}, out = [];
    t.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out.sort().join(" ");
  }
  function same(a, b) { return !!a && !!b && (nk(a) === nk(b) || tk(a) === tk(b)); }
  function AU() { return global.AUTH; }
  function SEM() { return global.SEMANTIC; }

  function scopeLabel() {
    var s = AU() && AU().getScope ? AU().getScope() : null;
    if (!s || s.unrestricted) return "whole company";
    var parts = [];
    if (s.bus && s.bus.length) parts.push(s.bus.join(", "));
    if (s.lines && s.lines.length) parts.push(s.lines.length > 4 ? s.lines.slice(0, 4).join(", ") + " +" + (s.lines.length - 4) + " more" : s.lines.join(", "));
    return parts.length ? parts.join(" · ") : "your scope";
  }
  function allowedBUs() {
    var l = SEM() ? SEM().BU_LIST.slice() : [];
    return AU() && AU().filterAllowedBUs ? AU().filterAllowedBUs(l) : l;
  }
  function allowedLines() {
    var map = SEM() && SEM().CANONICAL_LINE_TO_BU, out = [];
    Object.keys(map || {}).forEach(function (n) { if (!AU() || !AU().isLineAllowed || AU().isLineAllowed(n)) out.push(n); });
    return out;
  }
  function singleScopeOptions() {
    var s = AU() && AU().getScope ? AU().getScope() : null, bus = allowedBUs();
    if (s && !s.unrestricted && s.lines && s.lines.length === 1) return [{ dim: "line", name: s.lines[0] }];
    if (bus.length === 1) return [{ dim: "bu", name: bus[0] }];
    return bus.map(function (b) { return { dim: "bu", name: b }; });
  }
  /** Row-level scope test with the dashboard's own AUTH predicates (line and/or BU). */
  function rowInScope(bu, line) {
    if (!AU()) return true;
    if (bu && bu !== "Unassigned" && AU().isBuAllowed && !AU().isBuAllowed(bu)) return false;
    if (line && line !== "Unassigned" && AU().isLineAllowed && !AU().isLineAllowed(line)) return false;
    return true;
  }

  /** True when the signed-in account is limited to some BUs / lines. */
  function isRestricted() {
    var sc = AU() && AU().getScope ? AU().getScope() : null;
    return !!(sc && !sc.unrestricted);
  }
  /** For a restricted account, records that cannot be attributed to a BU (and, where `needLine`, a line) are dropped:
   *  the page's own scope tests let a missing/"Unassigned" value through, which would show a scoped user rows that
   *  cannot be proven to be theirs. Unrestricted accounts keep them. */
  function attributable(bu, line, needLine) {
    if (!isRestricted()) return true;
    var bad = function (v) { return !v || v === "Unassigned" || v === "0" || v === 0; };
    if (bad(bu)) return false;
    if (needLine && bad(line)) return false;
    return true;
  }

  // ---- small aggregate helpers -----------------------------------------------------
  function sum(rows, f) { var s = 0, n = 0; rows.forEach(function (r) { var v = f(r); if (typeof v === "number" && !isNaN(v)) { s += v; n++; } }); return n ? s : null; }
  function mean(rows, f) { var s = 0, n = 0; rows.forEach(function (r) { var v = f(r); if (typeof v === "number" && !isNaN(v)) { s += v; n++; } }); return n ? s / n : null; }
  function ratio(a, b) { return (a === null || b === null || !b) ? null : a / b; }

  function make(spec) {
    var byId = {};
    spec.measures.forEach(function (m) { byId[m.id] = m; if (!m.grains) m.grains = Object.keys(spec.dims); });

    function filterRows(rows, filters) {
      var f = filters || {};
      Object.keys(f).forEach(function (k) {
        var d = spec.dims[k];
        if (!d || !d.get) return;
        rows = rows.filter(function (r) { return same(d.get(r), f[k]); });
      });
      return rows;
    }

    function valuesFor(rows, ctx, ids) {
      var v = {};
      ids.forEach(function (id) { var m = byId[id]; if (m && m.agg) { try { v[id] = m.agg(rows, ctx); } catch (e) { v[id] = null; } } });
      return v;
    }

    function fetch(req) {
      var L;
      try { L = spec.load(req); } catch (e) { return { ok: false, missing: spec.label + " could not be read (" + (e && e.message ? e.message : e) + ")." }; }
      if (!L || !L.ok) return { ok: false, missing: (L && L.missing) || (spec.label + " has no data loaded.") };
      var rows = filterRows(L.rows || [], req.filters);
      var period = req.period || {};
      if (!rows.length) return { ok: false, missing: spec.label + " holds no rows for that cut" + (period.label ? " in " + period.label : "") + " within your access." };
      var ids = Object.keys(byId).filter(function (id) { return byId[id].agg && byId[id].kind !== "list"; });
      var ctx = { req: req, load: L };
      var total = valuesFor(rows, ctx, ids);
      // Every requested measure is empty for the whole cut: say why instead of showing a dash.
      var asked = (req.measures || []).map(function (m) { return m.id; }).filter(function (id) { return byId[id] && byId[id].agg; });
      if (asked.length && asked.every(function (id) { return total[id] === null || total[id] === undefined; })) {
        var why = spec.missingReason ? spec.missingReason(req, L, asked.map(function (id) { return byId[id]; })) : null;
        return { ok: false, missing: why || (byId[asked[0]].label + " has no value for that cut" + (period.label ? " in " + period.label : "") + " in " + spec.label + ".") };
      }
      var g = req.groupBy, out = [];
      if (g) {
        var d = spec.dims[g];
        if (!d || !d.get) return { ok: false, missing: spec.label + " cannot be grouped by " + g + "." };
        var groups = {}, order = [];
        rows.forEach(function (r) {
          var k = d.get(r);
          if (k === null || k === undefined || k === "") return;
          if (!groups[k]) { groups[k] = []; order.push(k); }
          groups[k].push(r);
        });
        order.forEach(function (k) {
          var rr = { name: String(k), v: valuesFor(groups[k], ctx, ids) };
          if (spec.dims.bu && g !== "bu" && spec.dims.bu.get) rr.bu = spec.dims.bu.get(groups[k][0]) || undefined;
          if (spec.rowAux) rr.aux = spec.rowAux(groups[k], g);
          out.push(rr);
        });
        if (!out.length) return { ok: false, missing: spec.label + " has no named rows for that grouping." };
      } else {
        var f = req.filters || {};
        var nm = f.line || f.bu || f.brand || f.dm || f.rep || "Total";
        out = [{ name: nm, v: total }];
      }
      var ex = spec.extraMeasures ? spec.extraMeasures(req, byId) : [];
      return { ok: true, rows: out, total: total, basis: L.basis || [], caveats: L.caveats || [], asOf: L.asOf || null,
               extraMeasures: ex, formula: L.formula || spec.formula || null, meta: L.meta };
    }

    var provider = {
      id: spec.id, label: spec.label, tabs: spec.tabs || [], domains: spec.domains || [spec.id],
      defaultMeasure: spec.defaultMeasure, rankMeasure: spec.rankMeasure || spec.defaultMeasure,
      canUse: spec.canUse, requires: spec.requires || [], measures: spec.measures,
      dims: (function () { var o = {}; Object.keys(spec.dims).forEach(function (k) { o[k] = { label: spec.dims[k].label }; }); return o; })(),
      hierarchy: spec.hierarchy || {}, ladder: spec.ladder || null,
      vocab: spec.vocab, availability: spec.availability,
      scopeLabel: spec.scopeLabel || scopeLabel, sourceNote: spec.sourceNote || function () { return spec.label; },
      singleScopeOptions: spec.singleScopeOptions || singleScopeOptions,
      defaultGroup: spec.defaultGroup || null, ensureAsync: spec.ensureAsync || null,
      fetch: fetch, ops: spec.ops || {}
    };
    if (global.AskQuery) global.AskQuery.registerProvider(provider);
    return provider;
  }

  global.AskProvLib = { make: make, nk: nk, same: same, scopeLabel: scopeLabel, allowedBUs: allowedBUs, allowedLines: allowedLines,
                        singleScopeOptions: singleScopeOptions, rowInScope: rowInScope, isRestricted: isRestricted, attributable: attributable, sum: sum, mean: mean, ratio: ratio };
})(typeof window !== "undefined" ? window : this);
