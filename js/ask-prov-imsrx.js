(function(g){(g.AskBuild=g.AskBuild||{})["ask-prov-imsrx.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — IMS Rx provider
 * ============================================================================
 * Source of every number: ImsRxDashboard.askApi(), which runs the page's OWN
 *   mdRankedRows()        Rx by product / molecule / ATC / specialty / region / dosage form
 *   mdFilteredTotal()     Rx under a filter
 *   cfCompanyLeaderboard()Rx / share / growth by company (attributable products only)
 * under a temporary filter state that is restored afterwards.
 *
 * Definitions (unchanged from the page):
 *   Rx            = prescriptions in the IMS physician panel, one of three annual MAT periods
 *                   (MAT Dec 2023 / 2024 / 2025 = the 12 months ending December).
 *   Growth        = SUM(current MAT) vs SUM(prior MAT), aggregated first and divided once.
 *                   The source's row-level "Growth % PP" column is never used (the page bans it).
 *   Company Rx    = only products whose corporation join is unambiguous (corpConfidence 2).
 * The data are ANNUAL snapshots: there is no monthly or YTD Rx, so month / MoM / YTD questions are refused.
 * Access: the page's own AUTH.canViewImsRx() (CEO, VP, BEx, Admin, SFE Manager). This dataset has no
 * BU / line dimension, so it cannot be cut by BU, line, DM or rep.
 */
(function (global) {
  "use strict";
  function L() { return global.AskProvLib; }
  function P() { return global.AskPeriod; }
  function RX() { return global.ImsRxDashboard; }
  function api() { try { return RX() && RX().askApi ? RX().askApi() : null; } catch (e) { return null; } }

  // dim key -> { label, filterKey (page filter), lookup, field (mdRankedRows field), kind }
  var DIMS = {
    brand:     { label: "Brand",         fkey: "product",   lookup: "products",             field: "product" },
    corp:      { label: "Company",       fkey: "company",   lookup: "company",              field: "company" },
    molecule:  { label: "Molecule",      fkey: "molecule",  lookup: "molecules",            field: "molecule" },
    atc3:      { label: "ATC3 class",    fkey: "atc3",      lookup: "atc3s",                field: "atc3" },
    atc4:      { label: "ATC4 class",    fkey: "atc4",      lookup: "atc4s",                field: "atc4" },
    specialty: { label: "Specialty",     fkey: "specialty", lookup: "specialties",          field: "specialty" },
    region:    { label: "Region",        fkey: "region",    lookup: "regions",              field: "region" },
    dosage:    { label: "Dosage form",   fkey: "cat",       lookup: "dosageFormCategories", field: "dosageFormCategory" }
  };

  function periodKey(name) {
    var m = /MAT\s+([A-Za-z]{3})\s+(\d{4})/.exec(String(name || ""));
    if (!m) return null;
    var mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase());
    return mon < 0 ? null : m[2] + "-" + (mon + 1 < 10 ? "0" : "") + (mon + 1);
  }
  function periods(a) { return (a.periods || []).map(function (n, i) { return { idx: i, name: n, key: periodKey(n) }; }); }

  function resolveName(a, dim, name) {
    var d = DIMS[dim], names = a.lookup(d.lookup) || [], i, best = -1;
    for (i = 0; i < names.length; i++) { if (names[i] !== undefined && L().same(names[i], name)) { best = i; break; } }
    return best;
  }

  /** value map name -> {v, share?} for one dim, period idx and filter map, straight from the page's functions. */
  function cut(a, dim, map, pidx) {
    var d = DIMS[dim], m = {}, k;
    for (k in map) m[k] = map[k];
    m.period = [pidx];
    var out = {};
    if (dim === "corp") {
      a.leaderboard(m).forEach(function (r) { out[r.name] = { v: r.value, share: r.share }; });
    } else {
      var rows = a.ranked(d.field, d.lookup, m), tot = 0;
      rows.forEach(function (r) { tot += r.value; });
      rows.forEach(function (r) { out[r.name] = { v: r.value, share: tot > 0 ? r.value / tot * 100 : null }; });
    }
    return out;
  }
  function totalOf(a, map, pidx) {
    var m = {}, k; for (k in map) m[k] = map[k]; m.period = [pidx];
    return a.total(m).total;
  }

  var M = [
    { id: "rx_total", label: "Rx (prescriptions)", unit: "count", better: "high", gapMeasure: "rx_lost",
      aliases: ["rx", "prescriptions", "prescription volume", "prescription", "scripts", "rx volume", "ims rx", "rx count", "number of prescriptions"],
      def: "Prescriptions recorded in the IMS physician panel for the selected MAT period (12 months ending December).",
      formula: "SUM(Rx) over the fact rows that match the filters, for the selected MAT period" },
    { id: "rx_share", label: "Rx share", unit: "pct", better: "high",
      aliases: ["rx share", "share of rx", "prescription share", "share of prescriptions", "share of scripts"],
      def: "Each row's Rx as a share of the Rx in the cut (for companies: of the Rx attributable to a company, as on the page's Company leaderboard).",
      formula: "row Rx ÷ total Rx of the cut × 100" },
    { id: "rx_yoy_pct", label: "Rx growth YoY", unit: "pct", better: "high", gapMeasure: "rx_lost",
      aliases: ["rx growth", "rx yoy", "prescription growth", "rx growth yoy", "growth in rx", "rx trend", "rx change percent", "scripts growth"],
      def: "SUM(Rx of the selected MAT period) vs SUM(Rx of the previous MAT period), aggregated first and divided once.",
      formula: "(Rx current MAT − Rx prior MAT) ÷ Rx prior MAT × 100" },
    { id: "rx_delta", label: "Rx change vs prior MAT", unit: "count", better: "high", gapMeasure: "rx_lost",
      aliases: ["rx change", "rx delta", "change in rx", "rx gained", "prescriptions gained", "rx growth volume"],
      def: "Rx of the selected MAT period minus Rx of the previous MAT period.", formula: "Rx current MAT − Rx prior MAT" },
    { id: "rx_prev", label: "Rx prior MAT", unit: "count", better: "high",
      aliases: ["rx prior year", "rx last year", "previous rx", "prior rx"],
      def: "Rx of the previous MAT period, for the same cut.", formula: "SUM(Rx) in the prior MAT period" },
    { id: "rx_lost", label: "Rx lost vs prior MAT", unit: "count", better: "low", gap: true,
      aliases: ["rx lost", "prescriptions lost", "lost rx", "rx decline", "rx drop", "rx decrease", "lost prescriptions", "brands that lost rx"],
      def: "Rx lost versus the previous MAT period: the decline where a row fell, zero where it grew.", formula: "max(0, Rx prior MAT − Rx current MAT)" }
  ];
  M.forEach(function (m) { m.grains = Object.keys(DIMS); });

  function vocab() {
    var a = api(); if (!a) return {};
    var o = {};
    Object.keys(DIMS).forEach(function (dim) {
      var names = a.lookup(DIMS[dim].lookup) || [], seen = {}, out = [];
      names.forEach(function (n) {
        n = String(n == null ? "" : n).trim();
        if (!n || seen[n]) return;
        if (dim === "brand" && (n.length < 4 || /^[0-9.\s]+$/.test(n))) return;
        seen[n] = 1; out.push(n);
      });
      o[dim] = out;
    });
    return o;
  }

  function fetch(req) {
    var a = api();
    if (!a) return { ok: false, missing: "IMS Rx is not available to this account (the page is limited to CEO, VP, BEx, Admin and SFE Manager), or its cache is missing or stale." };
    var pers = periods(a), latest = pers[pers.length - 1];
    var period = req.period || {}, keys = (period.keys || []).filter(Boolean), pidx, assumed = false;
    if (!keys.length) { pidx = latest.idx; assumed = true; }
    else {
      var MULTI = ["quarter", "relquarter", "half", "range", "rolling", "ytd", "mtd", "all"];
      if (keys.length > 1 || MULTI.indexOf(period.kind) >= 0) return { ok: false, missing: "IMS Rx is stored as annual MAT snapshots (" + pers.map(function (p) { return p.name; }).join(", ") + "). MAT periods overlap, so I will not add or slice them into " + (period.label || keys.join(", ")) + ". Ask for a MAT year, e.g. “2025” or “2025 vs 2024”." };
      var hit = pers.filter(function (p) { return p.key === keys[0]; })[0];
      if (!hit) return { ok: false, missing: "IMS Rx holds no data for " + (period.label || keys[0]) + ". It only has the annual MAT snapshots " + pers.map(function (p) { return p.name; }).join(", ") + "; there is no monthly, quarterly or YTD Rx." };
      pidx = hit.idx;
    }
    var prevIdx = pidx > 0 ? pidx - 1 : null;
    // filters -> page filter map
    var map = {}, f = req.filters || {}, k, unknown = [];
    for (k in f) {
      if (!DIMS[k]) continue;
      var idx = resolveName(a, k, f[k]);
      if (idx < 0) { unknown.push(f[k]); continue; }
      map[DIMS[k].fkey] = [idx];
    }
    if (unknown.length) return { ok: false, missing: "IMS Rx has no " + unknown.join(", ") + " in its lookups." };
    var badF = Object.keys(f).filter(function (x) { return !DIMS[x]; });
    if (badF.length) return { ok: false, missing: "IMS Rx cannot be cut by " + badF.join(", ") + ": it has no BU, line, territory or rep dimension." };
    var g = req.groupBy;
    if (g && !DIMS[g]) return { ok: false, missing: "IMS Rx cannot be broken down by " + g + ". Its cuts are brand, company, molecule, ATC3/ATC4, specialty, region and dosage form (there are no physician-level rows in the cache)." };

    var totCur = totalOf(a, map, pidx), totPrev = prevIdx === null ? null : totalOf(a, map, prevIdx);
    function valuesFor(cur, prev, share) {
      var v = { rx_total: cur == null ? null : cur, rx_prev: prev == null ? null : prev, rx_share: share == null ? null : share };
      if (cur != null && prev != null) {
        v.rx_delta = cur - prev; v.rx_lost = Math.max(0, prev - cur);
        v.rx_yoy_pct = prev > 0 ? (cur - prev) / prev * 100 : null;
      } else { v.rx_delta = null; v.rx_lost = null; v.rx_yoy_pct = null; }
      return v;
    }
    if (!totCur) return { ok: false, missing: "IMS Rx holds no prescriptions for that cut in " + pers[pidx].name + "." };
    var total = valuesFor(totCur, totPrev, 100), rows = [];
    if (g) {
      var cur = cut(a, g, map, pidx), prev = prevIdx === null ? {} : cut(a, g, map, prevIdx), seen = {};
      Object.keys(cur).concat(Object.keys(prev)).forEach(function (n) {
        if (seen[n]) return; seen[n] = 1;
        var c = cur[n] ? cur[n].v : (prevIdx === null ? null : 0), p = prevIdx === null ? null : (prev[n] ? prev[n].v : 0);
        if (!(cur[n] || (prev[n] && prev[n].v))) return;
        rows.push({ name: n, v: valuesFor(c, p, cur[n] ? cur[n].share : null) });
      });
      if (!rows.length) return { ok: false, missing: "IMS Rx has no rows for that grouping in " + pers[pidx].name + "." };
    } else {
      var nm = (f.brand || f.corp || f.molecule || f.atc4 || f.atc3 || f.specialty || f.region || f.dosage) || "Total Rx panel";
      rows = [{ name: nm, v: total }];
    }
    var caveats = ["Rx counts prescriptions in the IMS physician panel, not sales value or units."];
    if (assumed && req.plan && req.plan.assumptions) req.plan.assumptions.push("No period named — using the latest annual snapshot, " + pers[pidx].name + ".");
    if (period.kind === "year") caveats.push("“" + (period.label || "year") + "” is read as " + pers[pidx].name + " — the 12 months ending December, which is the only granularity the IMS Rx cache holds.");
    if (g && (req.measures || []).some(function (m) { return m.id === "rx_yoy_pct"; })) caveats.push("Growth on a small prior-year base can look extreme (e.g. +1,000%); read it next to the Rx volumes.");
    if (prevIdx === null) caveats.push(pers[pidx].name + " is the earliest MAT in the cache, so no growth or change can be computed.");
    if (g === "corp" || map.company) {
      var ct = a.cfTotal(Object.assign({}, map, { period: [pidx] }));
      if (ct && ct.total) caveats.push("Company figures cover only products whose manufacturer join is unambiguous — " + (ct.attributable / ct.total * 100).toFixed(1) + "% of the Rx in this cut; the rest is excluded from every company total, as on the page.");
    }
    return { ok: true, rows: rows, total: total, caveats: caveats, asOf: pers[pidx].name,
      basis: [["Data", "IMS Rx cache — " + pers[pidx].name + " (" + (a.meta && a.meta.source || "IMS RX") + ")"], ["Growth", prevIdx === null ? "not available" : "vs " + pers[prevIdx].name + ", aggregated first then divided"]],
      formula: "Rx = SUM(prescriptions) from the page's own ranked-rows / company-leaderboard functions; growth = (current MAT − prior MAT) ÷ prior MAT" };
  }

  var provider = {
    id: "imsrx", quietAlias: true, label: "IMS Rx", tabs: ["imsrx"], domains: ["imsrx"],
    defaultMeasure: "rx_total", rankMeasure: "rx_total",
    canUse: function () { return !!(RX() && RX().canView && RX().canView() && RX().askApi); },
    requires: ["ims_rx"],
    measures: M,
    dims: (function () { var o = {}; Object.keys(DIMS).forEach(function (k) { o[k] = { label: DIMS[k].label }; }); return o; })(),
    hierarchy: { atc3: "atc4", atc4: "molecule", molecule: "brand", corp: "brand" },
    ladder: ["atc3", "atc4", "molecule", "brand"],
    defaultGroup: function (pl) {
      if (pl.intent === "rank" || pl.who || pl.where) return "brand";
      return null;
    },
    vocab: vocab,
    availability: function () {
      var a = api(), ps = a ? periods(a).map(function (p) { return p.key; }).filter(Boolean) : [];
      return { name: "IMS Rx", months: ps, defaultPeriod: ps[ps.length - 1], annual: true };
    },
    scopeLabel: function () { return "IMS Rx (whole panel — this dataset has no BU / line scope)"; },
    sourceNote: function () { return "IMS Rx cache · annual MAT snapshots"; },
    singleScopeOptions: function () { return []; },
    fetch: fetch, ops: {}
  };
  if (global.AskQuery) global.AskQuery.registerProvider(provider);
  global.AskProvImsRx = { provider: provider };
})(typeof window !== "undefined" ? window : this);
