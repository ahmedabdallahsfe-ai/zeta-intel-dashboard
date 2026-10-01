(function(g){(g.AskBuild=g.AskBuild||{})["ask-prov-marketintel.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — Total Market Intelligence provider
 * ============================================================================
 * Source of every number: MarketIntelligence._internals() — the page's OWN scanAnnual / rankedRows /
 * comparisonYears / growthWindow under a temporary filter state that is restored afterwards.
 *
 * Definitions (unchanged from the page):
 *   The cube is CALENDAR-YEAR (2022–2025 full, 2026 = Jan–Apr only). Value is local currency, units are units.
 *   Value / share of a year = the page's rankedRows() `value` / `sharePct` for that year.
 *   Growth is a CAGR: first → last FULL year in scope, annualised (Ahmed's directive 2026-08-06). Partial years are
 *   never used as a growth endpoint. YoY between two years is available as a comparison of the year values.
 * There is no BU / line / territory dimension and no monthly data here.
 * Access: the page's own AUTH.canViewMarketIntel().
 */
(function (global) {
  "use strict";
  function L() { return global.AskProvLib; }
  function MI() { return global.MarketIntelligence; }
  var KEYS = ["year", "ta", "atc4", "molecule", "corp", "product", "launchYear", "priceBand", "topN"];

  var DIMS = {
    ta:       { label: "Therapeutic area", field: "F_TA",    lookup: "tas",       fx: "ta" },
    atc4:     { label: "ATC4 class",       field: "F_ATC",   lookup: "atc4s",     fx: "atc4" },
    corp:     { label: "Corporation",      field: "F_CORP",  lookup: "corps",     fx: "corp" },
    molecule: { label: "Molecule",         field: "F_MOL",   lookup: "molecules", fx: "molecule" },
    brand:    { label: "Brand",            field: "F_BRAND", lookup: "brands",    fx: null },
    dosage:   { label: "Dosage form",      field: "F_FORM",  lookup: "forms",     fx: null }
  };

  function I() {
    var m = MI();
    if (!m || !m._internals || !global.MARKET_INTEL_CACHE) return null;
    try { if (!m._decodeCache()) return null; return m._internals(); } catch (e) { return null; }
  }
  function years(i) { return i.CACHE.lookups.years.slice(); }
  function partialYears(i) { return (i.CACHE.meta && i.CACHE.meta.partialYears) || []; }
  function keyOfYear(y, partial) { return y + "-" + (partial ? "04" : "12"); }
  function cagr(s, e, span) {           // identical rule to the page's cagrPct()
    if (!span || span <= 0) return null;
    if (s === null || e === null || isNaN(s) || isNaN(e)) return null;
    if (!(s > 0) || e < 0) return null;
    return (Math.pow(e / s, 1 / span) - 1) * 100;
  }

  var GRW = "CAGR = (last full year ÷ first full year)^(1 ÷ years) − 1, on the page's own growth window";
  var M = [
    { id: "mi_value", label: "Market value (LC)", unit: "egp", better: "high", gapMeasure: "mi_decline",
      aliases: ["sales", "sales value", "total market", "total market value", "total market sales", "market value", "tmi sales", "market intelligence sales", "total market size", "size of the total market"],
      def: "Local-currency value of the total Egyptian market for the selected year.", formula: "SUM(value) of the annual cube cells in the cut for the year" },
    { id: "mi_units", label: "Market units", unit: "units", better: "high",
      aliases: ["total market units", "total market volume", "market intelligence units"],
      def: "Units sold in the total market for the selected year.", formula: "SUM(units) of the annual cube cells in the cut for the year" },
    { id: "mi_share", label: "Share of the total market", unit: "pct", better: "high", gapMeasure: "mi_share_lost",
      aliases: ["share of total market", "total market share", "share of the total market", "corporation share of the total market", "share of the market"],
      def: "Each row's value as a share of the value of the whole cut in the selected year (the page's ‘share’ column).", formula: "row value ÷ value of the cut × 100" },
    { id: "mi_zeta_share", label: "Zeta share of the total market", unit: "pct", better: "high", gapMeasure: "mi_share_lost",
      aliases: ["zeta share of the total market", "zeta total market share", "zeta share in the total market", "zeta share of total market"],
      def: "Zeta's value as a share of the total-market value of the same cut. By corporation it is each corporation's own share.", formula: "Zeta value ÷ value of the cut × 100" },
    { id: "mi_cagr", label: "Market growth (CAGR)", unit: "spct", better: "high", gapMeasure: "mi_decline",
      aliases: ["cagr", "compound annual growth", "total market growth", "market cagr", "compound growth"],
      def: "Compound annual growth rate of the cut, first → last full year in scope (the page's growth basis).", formula: GRW },
    { id: "mi_zeta_cagr", label: "Zeta growth (CAGR)", unit: "spct", better: "high",
      aliases: ["zeta cagr", "zeta total market growth", "zeta compound growth"],
      def: "Zeta's own CAGR within the same cut and window.", formula: GRW },
    { id: "mi_price", label: "Average price per unit", unit: "num1", better: "high",
      aliases: ["average price", "avg price", "price per unit", "average price per unit", "market price"],
      def: "Value ÷ units of the cut for the selected year — a mix-and-price blend, not a list price (the page's caption).", formula: "value ÷ units" },
    { id: "mi_delta", label: "Value change over the growth window", unit: "egp", better: "high", gapMeasure: "mi_decline",
      aliases: ["value change", "growth in value", "value added", "value gained"],
      def: "Value in the last full year minus value in the first full year of the window.", formula: "end-year value − base-year value" },
    { id: "mi_decline", label: "Value lost over the growth window", unit: "egp", better: "low", gap: true,
      aliases: ["value lost", "value decline", "declining corporations", "who lost value", "lost value"],
      def: "Value a row shed between the window's first and last full year; zero where it grew.", formula: "max(0, base-year value − end-year value)" },
    { id: "mi_share_delta", label: "Share change over the growth window", unit: "pts", better: "high", gapMeasure: "mi_share_lost",
      aliases: ["share change", "share gained", "corporations gained share", "gained share", "share gain", "change in total market share"],
      def: "Share of the total market in the last full year minus its share in the first full year of the window, in percentage points.", formula: "end share − base share" },
    { id: "mi_share_lost", label: "Share lost over the growth window", unit: "pts", better: "low", gap: true,
      aliases: ["share lost", "lost share", "share loss", "corporations lost share"],
      def: "Percentage points of total-market share given up between the window's first and last full year; zero where it held or grew.", formula: "max(0, base share − end share)" }
  ];
  M.forEach(function (m) { m.grains = Object.keys(DIMS); });

  function with_(filters, yearMax, fn) {
    var i = I(); if (!i) return null;
    var saved = {}; KEYS.forEach(function (k) { saved[k] = i.Fx[k]; });
    var ys = years(i), set = new Set();
    ys.forEach(function (y, idx) { if (y <= yearMax) set.add(idx); });
    i.setFilter("year", set);
    ["ta", "atc4", "molecule", "corp", "product", "launchYear", "priceBand"].forEach(function (k) { i.setFilter(k, filters && filters[k] ? filters[k] : null); });
    try { return fn(i); }
    finally { KEYS.forEach(function (k) { i.setFilter(k, saved[k]); }); }
  }

  var _brandProducts = null;
  function productsOfBrand(i, brandIdx) {
    if (!_brandProducts) {
      _brandProducts = {};
      var A = i.A, F = i.F;
      for (var n = 0, o = 0; n < A.n; n++, o += A.stride) {
        var b = A.rows[o + F.F_BRAND], p = A.rows[o + F.F_PROD];
        (_brandProducts[b] = _brandProducts[b] || {})[p] = 1;
      }
    }
    return new Set(Object.keys(_brandProducts[brandIdx] || {}).map(Number));
  }

  function fetch(req) {
    var i = I();
    if (!i) return { ok: false, missing: "Total Market Intelligence is not available to this account, or its cache is not loaded." };
    var ys = years(i), part = partialYears(i), period = req.period || {}, keys = (period.keys || []).filter(Boolean), Y;
    var have = {}; ys.forEach(function (y) { have[keyOfYear(y, part.indexOf(y) >= 0)] = y; });
    if (!keys.length) Y = ys.filter(function (y) { return part.indexOf(y) < 0; }).pop();
    else {
      var MULTI = ["quarter", "relquarter", "half", "range", "rolling", "ytd", "mtd", "all"];
      if (keys.length > 1 || MULTI.indexOf(period.kind) >= 0) return { ok: false, missing: "Total Market Intelligence is a calendar-year cube (" + ys.join(", ") + "; " + part.join(", ") + " is Jan–Apr only). There is no monthly or quarterly data, so I will not slice it into " + (period.label || keys.join(", ")) + ". Ask for a year, e.g. “2025” or “2025 vs 2024”." };
      Y = have[keys[0]];
      if (!Y) return { ok: false, missing: "Total Market Intelligence holds calendar years " + ys.join(", ") + "; " + (period.label || keys[0]) + " is not one of them." };
    }
    var f = req.filters || {}, flt = {}, bad = [], k;
    for (k in f) {
      var d = DIMS[k]; if (!d) continue;
      var names = i.CACHE.lookups[d.lookup] || [], hit = -1;
      for (var n = 0; n < names.length; n++) { if (names[n] != null && L().same(names[n], f[k])) { hit = n; break; } }
      if (hit < 0) { bad.push(f[k]); continue; }
      if (k === "brand") flt.product = productsOfBrand(i, hit);
      else if (k === "dosage") { bad.push(f[k] + " (dosage form cannot be used as a filter on this page)"); }
      else flt[d.fx] = new Set([hit]);
    }
    var badF = Object.keys(f).filter(function (x) { return !DIMS[x]; });
    if (badF.length) return { ok: false, missing: "Total Market Intelligence cannot be cut by " + badF.join(", ") + ": it has no BU, line, territory or rep dimension." };
    if (bad.length) return { ok: false, missing: "Total Market Intelligence has no " + bad.join(", ") + "." };
    var g = req.groupBy;
    if (g && !DIMS[g]) return { ok: false, missing: "Total Market Intelligence cannot be broken down by " + g + ". Its cuts are therapeutic area, ATC4, corporation, molecule, brand and dosage form." };
    var zeta = i.CACHE.lookups.corps.indexOf("ZETA PHARM*");
    var byG = g || "corp";
    var res = with_(flt, Y, function (ii) {
      var d = DIMS[byG], out = { main: ii.rankedRows(ii.F[d.field], d.lookup, {}) };
      if (zeta >= 0 && byG !== "corp") {
        var zf = {}; for (var kk in flt) zf[kk] = flt[kk]; zf.corp = new Set([zeta]);
        out.z = with_(zf, Y, function (i2) { return i2.rankedRows(i2.F[d.field], d.lookup, {}); });
      }
      return out;
    });
    if (!res || !res.main || !res.main.rows.length) return { ok: false, missing: "Total Market Intelligence holds no rows for that cut in " + Y + "." };
    var rk = res.main, w = rk.window, span = w && w.ok ? w.span : 0;
    var totBase = 0, totEnd = 0, totUnits = 0, totCur = rk.total;
    rk.rows.forEach(function (r) { totBase += r.baseValue; totEnd += r.endValue; totUnits += r.units; });
    var zmap = {}; if (res.z) res.z.rows.forEach(function (r) { zmap[r.idx] = r; });
    var zRow = null; if (!g || byG === "corp") { rk.rows.forEach(function (r) { if (r.idx === zeta) zRow = r; }); }

    function vals(r, z, own) {
      var v = { mi_value: r.value, mi_units: r.units, mi_price: r.units > 0 ? r.value / r.units : null,
                mi_share: r.sharePct != null ? r.sharePct : (totCur > 0 ? r.value / totCur * 100 : null),
                mi_cagr: span ? cagr(r.baseValue, r.endValue, span) : null,
                mi_delta: span ? r.endValue - r.baseValue : null,
                mi_decline: span ? Math.max(0, r.baseValue - r.endValue) : null };
      if (own) { v.mi_zeta_share = v.mi_share; v.mi_zeta_cagr = v.mi_cagr; }
      else if (z) {
        v.mi_zeta_share = r.value > 0 ? z.value / r.value * 100 : null;
        v.mi_zeta_cagr = span ? cagr(z.baseValue, z.endValue, span) : null;
      } else { v.mi_zeta_share = r.value > 0 ? 0 : null; v.mi_zeta_cagr = null; }
      if (span && totBase > 0 && totEnd > 0) {
        var bs = r.baseValue / totBase * 100, es = r.endValue / totEnd * 100;
        v.mi_share_delta = es - bs; v.mi_share_lost = Math.max(0, bs - es);
      }
      return v;
    }
    var rows = [], total, caveats = [];
    if (g) {
      rk.rows.forEach(function (r) {
        if (r.name == null || r.name === "") return;
        if (r.value <= 0 && r.endValue <= 0) return;
        rows.push({ name: String(r.name), v: vals(r, zmap[r.idx], g === "corp") });
      });
      if (!rows.length) return { ok: false, missing: "Total Market Intelligence has no rows for that grouping in " + Y + "." };
      var tot = { value: totCur, units: totUnits, baseValue: totBase, endValue: totEnd };
      var zt = null;
      if (g !== "corp" && res.z) { zt = { value: 0, baseValue: 0, endValue: 0 }; res.z.rows.forEach(function (r) { zt.value += r.value; zt.baseValue += r.baseValue; zt.endValue += r.endValue; }); }
      var tv = vals(tot, zt, false); tv.mi_share = 100;
      if (g === "corp" && zRow) { tv.mi_zeta_share = zRow.sharePct; tv.mi_zeta_cagr = span ? cagr(zRow.baseValue, zRow.endValue, span) : null; }
      total = tv;
    } else {
      var tot2 = { value: totCur, units: totUnits, baseValue: totBase, endValue: totEnd };
      var z0 = zRow ? { value: zRow.value, baseValue: zRow.baseValue, endValue: zRow.endValue } : (zeta >= 0 ? { value: 0, baseValue: 0, endValue: 0 } : null);
      total = vals(tot2, z0, false); total.mi_share = 100;
      var nm = f.corp || f.brand || f.molecule || f.atc4 || f.ta || "Total market";
      rows = [{ name: nm, v: total }];
    }
    if (g === "corp" && (req.measures || []).some(function (m) { return /zeta/.test(m.id); })) {
      if (g === "corp") caveats.push("Grouped by corporation, “Zeta share / growth” shows each corporation's own share and growth (Zeta's row is Zeta's).");
    }
    if (part.indexOf(Y) >= 0) caveats.push(Y + " is a PARTIAL year (Jan–Apr). Its value is not comparable with full years and it is never used as a growth endpoint; growth shown is the CAGR of the full years " + (w && w.ok ? w.base.y + "–" + w.end.y : "in scope") + ".");
    if (g && (req.measures || []).some(function (m) { return /cagr/.test(m.id); })) caveats.push("CAGR on a very small first-year base can look extreme; read it next to the value.");
    if (!span) caveats.push("Growth needs at least two full years in scope; there is only one up to " + Y + ".");
    if (/mi_(share_delta|share_lost|cagr|zeta_cagr|delta|decline)/.test((req.measures || []).map(function (m) { return m.id; }).join(" "))) caveats.push("Growth-window measures compare the first and last full year (" + (w && w.ok ? w.base.y + " → " + w.end.y : "n/a") + "), not the previous year.");
    return { ok: true, rows: rows, total: total, caveats: caveats, asOf: String(Y),
      basis: [["Data", "IMS 2022 to April 2026 — annual cube, calendar years " + ys.join(", ")], ["Year", String(Y) + (part.indexOf(Y) >= 0 ? " (Jan–Apr)" : "")],
              ["Growth", w && w.ok ? "CAGR " + w.base.y + "–" + w.end.y + " (" + w.span + " years), full years only" : "not available"]],
      formula: "Values and shares come from the page's rankedRows(); growth is the page's CAGR rule" };
  }

  function vocab() {
    var i = I(); if (!i) return {};
    var o = {};
    Object.keys(DIMS).forEach(function (k) {
      if (k === "dosage") return;
      var names = i.CACHE.lookups[DIMS[k].lookup] || [], seen = {}, out = [];
      names.forEach(function (n) {
        n = String(n == null ? "" : n).trim();
        if (!n || seen[n]) return;
        if ((k === "brand" || k === "molecule") && (n.length < 4 || /^[0-9.\s]+$/.test(n))) return;
        seen[n] = 1; out.push(n);
      });
      o[k] = out;
    });
    return o;
  }

  var provider = {
    id: "marketintel", quietAlias: true, label: "Total Market Intelligence", tabs: ["marketintel"], domains: ["marketintel"],
    defaultMeasure: "mi_value", rankMeasure: "mi_value",
    canUse: function () { var A = global.AUTH; return !!(A && A.canViewMarketIntel && A.canViewMarketIntel() && MI() && MI()._internals); },
    requires: ["market_intel"], measures: M,
    dims: (function () { var o = {}; Object.keys(DIMS).forEach(function (k) { o[k] = { label: DIMS[k].label }; }); return o; })(),
    hierarchy: { ta: "atc4", atc4: "molecule", molecule: "brand", corp: "brand" },
    ladder: ["ta", "atc4", "molecule", "brand"],
    defaultGroup: function (pl, m) { var f = pl.filters || {}; return (f.corp) ? "atc4" : "corp"; },
    vocab: vocab,
    availability: function () {
      var i = I(); if (!i) return { name: "Market Intelligence", months: [] };
      var part = partialYears(i), ks = years(i).map(function (y) { return keyOfYear(y, part.indexOf(y) >= 0); });
      var full = years(i).filter(function (y) { return part.indexOf(y) < 0; }).pop();
      return { name: "Market Intelligence", months: ks, defaultPeriod: keyOfYear(full, false), annual: true };
    },
    scopeLabel: function () { return "Total Market Intelligence (whole market — this dataset has no BU / line scope)"; },
    sourceNote: function () { return "Market Intelligence cache · annual cube 2022–2026"; },
    singleScopeOptions: function () { return []; },
    fetch: fetch, ops: {}
  };
  if (global.AskQuery) global.AskQuery.registerProvider(provider);
  global.AskProvMarketIntel = { provider: provider };
})(typeof window !== "undefined" ? window : this);
