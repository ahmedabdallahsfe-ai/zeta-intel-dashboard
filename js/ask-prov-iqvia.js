(function(g){(g.AskBuild=g.AskBuild||{})["ask-prov-iqvia.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — IQVIA market intelligence provider
 * ============================================================================
 * Source of every number: IQVIADashboard.askApi(), which runs the page's OWN aggBy() /
 * getPeriodIndices() / getPrevPeriodIndices() / dimFilter() / growth() over a private copy
 * of the IQVIA cache that is scoped to the signed-in user with the page's own applyUserFilter().
 * No Executive card, page control or global is changed by a question.
 *
 * Definitions (unchanged from the page):
 *   LCV = local-currency value (EGP), SU = standard units. Other Market rows are excluded by default.
 *   Share  = value (or units) of a row ÷ value of the cut. Zeta share = Zeta rows ÷ all rows of the same cut.
 *   Growth = (current − previous) ÷ previous, aggregated first and divided once, where "previous" follows the
 *            page's own convention for the period: month → previous month, YTD → same months last year,
 *            MAT (12 months) → the 12 months before, 3M / 6M → the block before.
 *   EVI    = (1 + Zeta growth) ÷ (1 + market growth) × 100  (Executive company card definition).
 * The default period is MAT (the IQVIA page's default and the Executive BU market-share basis).
 * With BU = DIAB / GIT / CHC / Cluster, MAT and LCV, Zeta share equals the Executive BU card exactly
 * (getBusinessSummary) — this is asserted by ask_tests/test_ask_parity.js.
 */
(function (global) {
  "use strict";
  function L() { return global.AskProvLib; }
  function IQ() { return global.IQVIADashboard; }
  function api() { try { return IQ() && IQ().askApi ? IQ().askApi() : null; } catch (e) { return null; } }
  function SEM() { return global.SEMANTIC; }

  // dim key -> {label, sel (askApi selector key), dim (askApi DIM key), lookup, present}
  var DIMS = {
    corp:     { label: "Corporation",    sel: "corp", dim: "corp", lookup: "corps",     present: "corp" },
    market:   { label: "Market (DM1)",   sel: "dm1",  dim: "dm1",  lookup: "dm1s",      present: "dm1" },
    market2:  { label: "Market (DM2)",   sel: "dm2",  dim: "dm2",  lookup: "dm2s",      present: "dm2" },
    atc4:     { label: "ATC4 class",     sel: "atc4", dim: "atc4", lookup: "atc4s",     present: "atc4" },
    brand:    { label: "Brand",          sel: "prod", dim: "prod", lookup: "prods",     present: "prod" },
    molecule: { label: "Molecule",       sel: "mol",  dim: "mol",  lookup: "molecules", present: "mol" },
    dosage:   { label: "Dosage form",    sel: "dose", dim: "dose", lookup: "doses",     present: "dose" },
    bu:       { label: "Business Unit",  sel: "bu",   dim: "bu",   lookup: "bus",       present: "bu" },
    line:     { label: "Line",           sel: "line", dim: "line", lookup: "lines",     present: "line" },
    item:     { label: "Item",           sel: "item", dim: "item", lookup: "items",     present: "item" },
    strength: { label: "Strength",       sel: "strength", dim: "strength", lookup: "strengths", present: "strength" }
  };
  var NON_LINES = { "Non-Promoted": 1, "Other Markets": 1 };

  function nameOk(dim, name) {
    if (dim === "bu") { var S = SEM(); return !!(S && S.BU_LIST && S.BU_LIST.indexOf(name) >= 0) && (!global.AUTH || !global.AUTH.isBuAllowed || global.AUTH.isBuAllowed(name)); }
    if (dim === "line") return !NON_LINES[name] && (!global.AUTH || !global.AUTH.isLineAllowed || global.AUTH.isLineAllowed(name));
    return true;
  }
  function periodMonths(a) { return a.periods.slice(); }

  // ---- measures ---------------------------------------------------------------------------
  var GR = "growth = (current − previous) ÷ previous, aggregated first and divided once; previous follows the page's convention for the period";
  var M = [
    { id: "iq_lcv", label: "Market sales (LCV)", unit: "egp", better: "high", gapMeasure: "iq_lost_lcv",
      aliases: ["market sales", "market size", "market value", "lcv", "local currency value", "total market sales", "market sales value", "sales value of the market", "iqvia sales", "market sales lcv", "sales", "sales value"],
      def: "Local-currency value (EGP) of the IQVIA rows in the cut, Other Market excluded.", formula: "SUM(LCV) over the rows in the cut for the period" },
    { id: "iq_su", label: "Market units (SU)", unit: "units", better: "high", gapMeasure: "iq_lost_su",
      aliases: ["standard units", "su", "market units", "market volume", "market sales units", "iqvia units"],
      def: "Standard units of the IQVIA rows in the cut, Other Market excluded.", formula: "SUM(SU) over the rows in the cut for the period" },
    { id: "iq_share_lcv", label: "Value share of the cut", unit: "pct", better: "high",
      aliases: ["value share", "lcv share", "share of value", "share of market value", "share of sales", "corporation share", "competitor share", "corporation market share"],
      def: "Each row's LCV as a share of the LCV of the whole cut (e.g. each corporation's share of a market).", formula: "row LCV ÷ LCV of the cut × 100" },
    { id: "iq_share_su", label: "Unit share of the cut", unit: "pct", better: "high",
      aliases: ["unit share", "su share", "share of units", "share of market units", "volume share"],
      def: "Each row's SU as a share of the SU of the whole cut.", formula: "row SU ÷ SU of the cut × 100" },
    { id: "iq_zeta_share_lcv", label: "Zeta market share (value)", unit: "pct", better: "high", gapMeasure: "iq_share_lost_lcv",
      aliases: ["zeta market share", "market share", "zeta share", "our market share", "zeta value share", "zeta lcv share", "zeta share of market", "zeta share of value", "market share of zeta", "share of zeta"],
      def: "Zeta's LCV as a share of the market's LCV in the same cut. By BU, MAT: the Executive BU market-share card. By corporation, it is each corporation's own share.",
      formula: "Zeta LCV ÷ all-corporation LCV of the same cut × 100" },
    { id: "iq_zeta_share_su", label: "Zeta market share (units)", unit: "pct", better: "high", gapMeasure: "iq_share_lost_su",
      aliases: ["zeta unit share", "zeta su share", "zeta share of units", "zeta share in units", "zeta volume share"],
      def: "Zeta's SU as a share of the market's SU in the same cut.", formula: "Zeta SU ÷ all-corporation SU of the same cut × 100" },
    { id: "iq_growth_lcv", label: "Market growth (value)", unit: "spct", better: "high", gapMeasure: "iq_lost_lcv",
      aliases: ["market growth", "growth", "market value growth", "value growth", "growth of the market", "market growth lcv", "market growth rate", "growth rate", "growing", "fastest growing"],
      def: "LCV growth of the cut versus the previous period (page convention).", formula: GR },
    { id: "iq_growth_su", label: "Market growth (units)", unit: "spct", better: "high", gapMeasure: "iq_lost_su",
      aliases: ["unit growth", "su growth", "growth in units", "market unit growth", "volume growth", "market growth su"],
      def: "SU growth of the cut versus the previous period (page convention).", formula: GR },
    { id: "iq_zeta_growth_lcv", label: "Zeta growth (value)", unit: "spct", better: "high", gapMeasure: "iq_lag_lcv",
      aliases: ["zeta growth", "zeta value growth", "our growth", "zeta lcv growth", "growth of zeta"],
      def: "Zeta's LCV growth in the cut versus the previous period (page convention).", formula: GR },
    { id: "iq_zeta_growth_su", label: "Zeta growth (units)", unit: "spct", better: "high", gapMeasure: "iq_lag_su",
      aliases: ["zeta unit growth", "zeta su growth", "zeta growth in units", "zeta volume growth"],
      def: "Zeta's SU growth in the cut versus the previous period (page convention).", formula: GR },
    { id: "iq_growth_gap", label: "Growth gap (Zeta − market, value)", unit: "pts", better: "high", gapMeasure: "iq_lag_lcv",
      aliases: ["growth gap", "zeta growth gap", "growth vs market", "growth versus market", "zeta vs market growth", "outperformance", "zeta growth versus market", "market growth vs zeta growth", "zeta growth vs market growth"],
      def: "Zeta's LCV growth minus the market's LCV growth, in percentage points (positive = Zeta growing faster).", formula: "Zeta growth % − market growth %" },
    { id: "iq_evi", label: "EVI (Zeta vs market, value)", unit: "num1", better: "high", gapMeasure: "iq_lag_lcv",
      aliases: ["evi", "evolution index", "zeta evi", "evolution value index"],
      def: "Evolution index: Zeta growth relative to market growth; 100 = growing with the market (the Executive company-card definition).", formula: "(1 + Zeta growth) ÷ (1 + market growth) × 100" },
    { id: "iq_share_delta_lcv", label: "Zeta share change (value)", unit: "pts", better: "high", gapMeasure: "iq_share_lost_lcv",
      aliases: ["share change", "share delta", "change in market share", "market share change", "zeta share change", "share gain", "share gained", "gained share", "share movement"],
      def: "Zeta's LCV share in the current period minus its share in the previous period, in percentage points.", formula: "Zeta share now − Zeta share previous period" },
    { id: "iq_lost_lcv", label: "Market value lost vs previous period", unit: "egp", better: "low", gap: true,
      aliases: ["market value lost", "value lost", "markets that declined", "declining markets", "market decline"],
      def: "LCV decline versus the previous period where a row fell; zero where it grew.", formula: "max(0, previous LCV − current LCV)" },
    { id: "iq_lost_su", label: "Market units lost vs previous period", unit: "units", better: "low", gap: true,
      aliases: ["units lost", "market units lost", "unit decline"],
      def: "SU decline versus the previous period where a row fell; zero where it grew.", formula: "max(0, previous SU − current SU)" },
    { id: "iq_lag_lcv", label: "Zeta growth lag vs market (value)", unit: "pts", better: "low", gap: true,
      aliases: ["growth lag", "zeta lag", "zeta lags the market", "lagging the market", "markets where zeta lags", "growth shortfall"],
      def: "Percentage points by which Zeta's LCV growth trails the market's; zero where Zeta grew at least as fast.", formula: "max(0, market growth % − Zeta growth %)" },
    { id: "iq_lag_su", label: "Zeta growth lag vs market (units)", unit: "pts", better: "low", gap: true,
      aliases: ["unit growth lag", "su growth lag"],
      def: "Percentage points by which Zeta's SU growth trails the market's; zero where Zeta grew at least as fast.", formula: "max(0, market SU growth % − Zeta SU growth %)" },
    { id: "iq_share_lost_lcv", label: "Zeta share lost vs previous period (value)", unit: "pts", better: "low", gap: true,
      aliases: ["share lost", "share loss", "markets where zeta lost share", "zeta share lost", "lost share", "losing share", "lose share", "zeta losing share", "zeta is losing share"],
      def: "Percentage points of LCV share Zeta gave up versus the previous period; zero where it held or gained.", formula: "max(0, previous Zeta share − current Zeta share)" },
    { id: "iq_share_lost_su", label: "Zeta share lost vs previous period (units)", unit: "pts", better: "low", gap: true,
      aliases: ["unit share lost", "su share lost"],
      def: "Percentage points of SU share Zeta gave up versus the previous period.", formula: "max(0, previous Zeta SU share − current Zeta SU share)" }
  ];
  M.forEach(function (m) { m.grains = Object.keys(DIMS); });

  // ---- period -> the page's own range ------------------------------------------------------
  function rangeFor(a, period) {
    var P = a.periods, keys = (period.keys || []).filter(Boolean);
    var idx = keys.map(function (k) { return P.indexOf(k); }).filter(function (i) { return i >= 0; }).sort(function (x, y) { return x - y; });
    if (!idx.length) return null;
    var last = idx[idx.length - 1], n = idx.length, cons = idx.every(function (v, i) { return i === 0 || v === idx[i - 1] + 1; });
    var out = { cur: new Set(idx), prev: null, name: null, how: null, ref: last };
    function viaPage(name, how) { var r = a.range(name, last); out.name = name; out.how = how; out.prev = r.prev; if (r.cur.size === idx.length) { var same = true; r.cur.forEach(function (i) { if (!out.cur.has(i)) same = false; }); if (same) return; } out.name = null; out.prev = null; out.how = null; }
    var jan = cons && P[idx[0]].slice(5, 7) === "01" && P[idx[0]].slice(0, 4) === P[last].slice(0, 4);
    if (n === 1) viaPage("curr", "the previous month");
    else if (n === 12 && cons) viaPage("mat", "the 12 months before");
    else if (jan && n < 12) viaPage("ytd", "the same months a year earlier");
    else if (n === 3 && cons && period.kind === "rolling") viaPage("3m", "the 3 months before");
    else if (n === 6 && cons && period.kind === "rolling") viaPage("6m", "the 6 months before");
    return out;
  }

  // ---- selection ----------------------------------------------------------------------------
  function resolveSel(a, filters) {
    var sel = {}, bad = [], k;
    for (k in (filters || {})) {
      var d = DIMS[k]; if (!d) continue;
      var names = a.lookup(d.lookup) || [], hit = -1;
      for (var i = 0; i < names.length; i++) { if (names[i] != null && L().same(names[i], filters[k])) { hit = i; break; } }
      if (hit < 0 || !a.present[d.present].has(hit) || !nameOk(k, names[hit])) { bad.push(filters[k]); continue; }
      sel[d.sel] = [hit];
    }
    return { sel: sel, bad: bad };
  }
  function promotedBuIdx(a) {
    var S = SEM(), names = a.lookup("bus") || [], out = [];
    names.forEach(function (n, i) { if (n && S && S.BU_LIST && S.BU_LIST.indexOf(n) >= 0 && a.present.bu.has(i)) out.push(i); });
    return out;
  }
  function toMap(entries) { var m = {}; entries.forEach(function (e) { m[e[0]] = e[1]; }); return m; }
  function growth(cur, prev) { if (!prev) return null; return (cur - prev) / prev * 100; } // page: (cur−prev)/prev; no prior sales → not defined

  function fetch(req) {
    var a = api();
    if (!a || !a.ok) return { ok: false, missing: "IQVIA is not available to this account, or its cache is missing." };
    var period = req.period || {};
    var R = rangeFor(a, period);
    if (!R) return { ok: false, missing: "IQVIA holds no data for " + (period.label || "that period") + "." };
    var ids = (req.measures || []).map(function (m) { return m.id; });
    var needZeta = ids.some(function (id) { return /zeta|gap|evi|lag|share_lost|share_delta/.test(id) && !/^iq_(share_lcv|share_su)$/.test(id); });
    var needPrev = ids.some(function (id) { return /growth|gap|evi|lag|lost|delta/.test(id); });
    var g = req.groupBy;
    if (g && !DIMS[g]) return { ok: false, missing: "IQVIA cannot be broken down by " + g + ". Its cuts are corporation, market (DM1/DM2), ATC4, brand, molecule, dosage form, BU and line." };
    var rs = resolveSel(a, req.filters);
    if (rs.bad.length) return { ok: false, missing: "IQVIA has no " + rs.bad.join(", ") + " within your access." };
    var sel = rs.sel, caveats = [], assumeNote = null;
    var explicitBu = !!sel.bu;
    // Zeta measures on an un-scoped cut: the universe of every ATC row is NOT the market Zeta competes in;
    // limit to the promoted BUs (what the Executive BU cards do) and say so.
    if (needZeta && !g && !explicitBu && !sel.line && !sel.dm1 && !sel.dm2 && !sel.atc4 && !sel.prod && !sel.mol && !sel.dose && !sel.corp) {
      sel = Object.assign({}, sel, { bu: promotedBuIdx(a) });
      caveats.push("No BU or market named: Zeta measures are pooled over the promoted BUs (CHC, Cluster, DIAB, GIT), as the Executive BU cards define them — not over every ATC row in IQVIA.");
    }
    if (needPrev && !R.prev) return { ok: false, missing: "Growth, change and share-movement need a comparison period, and the page defines one only for a single month (vs the previous month), YTD, MAT, 3M and 6M. " + (period.label || "That period") + " is none of these — ask for one of them, or compare two periods, e.g. “market sales Q2 vs Q1”." };

    var dimIdx = g ? a.DIM[DIMS[g].dim] : null;
    var zsel = Object.assign({}, sel, { corp: [a.zetaIdx] });
    function run(dimI, s, set) { return toMap(a.agg(dimI, s, set)); }
    var curAll, prevAll, curZ, prevZ;
    if (g) {
      curAll = run(dimIdx, sel, R.cur); prevAll = R.prev ? run(dimIdx, sel, R.prev) : {};
      if (g === "corp") { curZ = curAll; prevZ = prevAll; }
      else if (needZeta) { curZ = run(dimIdx, zsel, R.cur); prevZ = R.prev ? run(dimIdx, zsel, R.prev) : {}; }
    } else {
      var one = function (s, set) { var t = { lcv: 0, su: 0 }; a.agg(a.DIM.period, s, set).forEach(function (e) { t.lcv += e[1].lcv; t.su += e[1].su; }); return t; };
      curAll = { _: one(sel, R.cur) }; prevAll = R.prev ? { _: one(sel, R.prev) } : {};
      if (needZeta) { curZ = { _: one(zsel, R.cur) }; prevZ = R.prev ? { _: one(zsel, R.prev) } : {}; }
    }
    var Z0 = { lcv: 0, su: 0 };
    var totCur = { lcv: 0, su: 0 };
    Object.keys(curAll).forEach(function (k) { totCur.lcv += curAll[k].lcv; totCur.su += curAll[k].su; });
    if (!totCur.lcv && !totCur.su) return { ok: false, missing: "IQVIA holds no sales for that cut in " + (period.label || "that period") + " within your access." };

    function vals(c, p, zc, zp) {
      c = c || { lcv: 0, su: 0 }; p = R.prev ? (p || { lcv: 0, su: 0 }) : null; zc = zc || Z0; zp = R.prev ? (zp || Z0) : null;
      var v = { iq_lcv: c.lcv, iq_su: c.su,
        iq_share_lcv: totCur.lcv ? c.lcv / totCur.lcv * 100 : null, iq_share_su: totCur.su ? c.su / totCur.su * 100 : null };
      var own = (g === "corp");
      function sh(z, all, key) { return all[key] ? (own ? all[key] : z[key]) / all[key] * 100 : null; }
      v.iq_zeta_share_lcv = own ? v.iq_share_lcv : (needZeta && c.lcv ? zc.lcv / c.lcv * 100 : null);
      v.iq_zeta_share_su = own ? v.iq_share_su : (needZeta && c.su ? zc.su / c.su * 100 : null);
      if (p) {
        v.iq_growth_lcv = growth(c.lcv, p.lcv); v.iq_growth_su = growth(c.su, p.su);
        v.iq_lost_lcv = Math.max(0, p.lcv - c.lcv); v.iq_lost_su = Math.max(0, p.su - c.su);
        var totPrev = totalOf(prevAll);
        var zl = growth(zc.lcv, zp.lcv), zs = growth(zc.su, zp.su);
        if (own) {  // the corporation's own growth stands in for "Zeta" when the rows ARE corporations
          zl = v.iq_growth_lcv; zs = v.iq_growth_su;
        }
        v.iq_zeta_growth_lcv = needZeta || own ? zl : null; v.iq_zeta_growth_su = needZeta || own ? zs : null;
        if (!own && zl !== null && v.iq_growth_lcv !== null) {
          v.iq_growth_gap = zl - v.iq_growth_lcv;
          v.iq_evi = (1 + zl / 100) / (1 + v.iq_growth_lcv / 100) * 100;
          v.iq_lag_lcv = Math.max(0, v.iq_growth_lcv - zl);
        }
        if (!own && zs !== null && v.iq_growth_su !== null) v.iq_lag_su = Math.max(0, v.iq_growth_su - zs);
        var pl = p.lcv ? (own ? p.lcv : zp.lcv) / p.lcv * 100 : null, ps = p.su ? (own ? p.su : zp.su) / p.su * 100 : null;
        if (!own && pl !== null && v.iq_zeta_share_lcv !== null) { v.iq_share_delta_lcv = v.iq_zeta_share_lcv - pl; v.iq_share_lost_lcv = Math.max(0, pl - v.iq_zeta_share_lcv); }
        if (!own && ps !== null && v.iq_zeta_share_su !== null) v.iq_share_lost_su = Math.max(0, ps - v.iq_zeta_share_su);
      }
      return v;
    }
    function totalOf(map) { var t = { lcv: 0, su: 0 }; Object.keys(map).forEach(function (k) { t.lcv += map[k].lcv; t.su += map[k].su; }); return t; }

    var lk = g ? (a.lookup(DIMS[g].lookup) || []) : null, rows = [], total;
    if (g) {
      var keySet = {}; Object.keys(curAll).concat(Object.keys(prevAll)).forEach(function (k) { keySet[k] = 1; });
      Object.keys(keySet).forEach(function (k) {
        var nm = lk[+k]; if (nm == null || nm === "") return;
        if (!nameOk(g, nm) && (g === "bu" || g === "line")) return;
        if (!curAll[k] || (!curAll[k].lcv && !curAll[k].su)) return;
        rows.push({ name: String(nm), v: vals(curAll[k], prevAll[k], curZ && curZ[k], prevZ && prevZ[k]) });
      });
      if (!rows.length) return { ok: false, missing: "IQVIA has no rows for that grouping in " + (period.label || "that period") + " within your access." };
      if (g === "bu" || g === "line") caveats.push("Non-Promoted and Other Markets rows are left out of the BU / line ranking, as on the Executive cards.");
    } else {
      total = vals(curAll._, prevAll._, curZ && curZ._, prevZ && prevZ._);
      var f = req.filters || {}, nm2 = f.line || f.bu || f.brand || f.molecule || f.corp || f.market || f.market2 || f.atc4 || f.dosage || "IQVIA market in your scope";
      rows = [{ name: nm2, v: total }];
    }
    if (g === "corp" && ids.some(function (id) { return /zeta_(share|growth)|gap|evi|lag|share_lost|share_delta/.test(id); })) caveats.push("Grouped by corporation, “Zeta share / growth” shows each corporation's own share and growth (Zeta's row is Zeta's).");
    var A = global.AUTH, restricted = A && A.getScope && (function () { var s = A.getScope(); return s && !s.unrestricted; })();
    if (restricted) caveats.push("Scoped to the markets your BU / line manages (the page's own row-level scope), so market sizes and shares can be smaller than the BU-wide Executive cards.");
    if (period.kind === "all") caveats.push("“All loaded months” adds every month since " + a.periods[0] + ".");
    var basis = [["Data", "IQVIA cache — " + a.periods[0] + " to " + a.periods[a.periods.length - 1] + ", Other Market excluded, scoped to your access"],
                 ["Period", (period.label || "") + " → " + R.cur.size + " month" + (R.cur.size === 1 ? "" : "s")]];
    if (R.prev) basis.push(["Growth", "vs " + R.how + " (page convention for this period)"]);
    return { ok: true, rows: rows, total: total || vals(totalOf(curAll), totalOf(prevAll), needZeta ? totalOf(curZ || {}) : null, needZeta ? totalOf(prevZ || {}) : null),
      caveats: caveats, asOf: a.periods[a.periods.length - 1], basis: basis,
      formula: "Sums come from the page's aggBy() over the period's month set; shares and growth are aggregated first and divided once" };
  }

  function vocab() {
    var a = api(); if (!a || !a.ok) return {};
    var o = {};
    Object.keys(DIMS).forEach(function (k) {
      var d = DIMS[k], names = a.lookup(d.lookup) || [], seen = {}, out = [];
      a.present[d.present].forEach(function (i) {
        var n = String(names[i] == null ? "" : names[i]).trim();
        if (!n || seen[n] || !nameOk(k, n)) return;
        if ((k === "brand" || k === "molecule") && (n.length < 4 || /^[0-9.\s]+$/.test(n))) return;
        if (k === "corp" && /^(other|others|unknown)/i.test(n)) return;
        seen[n] = 1; out.push(n);
      });
      o[k] = out;
    });
    return o;
  }

  var provider = {
    id: "iqvia", quietAlias: true, label: "IQVIA market intelligence", tabs: ["iqvia"], domains: ["iqvia"],
    defaultMeasure: "iq_lcv", rankMeasure: "iq_lcv",
    canUse: function () { var A = global.AUTH; return !!(A && A.canViewIqvia && A.canViewIqvia() && IQ() && IQ().askApi); },
    requires: [], measures: M,
    dims: (function () { var o = {}; Object.keys(DIMS).forEach(function (k) { o[k] = { label: DIMS[k].label }; }); return o; })(),
    hierarchy: { bu: "line", line: "market", market: "corp", market2: "corp", corp: "brand", atc4: "brand", molecule: "brand" },
    ladder: ["bu", "line", "market", "corp", "brand"],
    defaultGroup: function (pl, m) {
      var f = pl.filters || {}, zeta = /zeta|gap|evi|lag|share_lost|share_delta/.test(m.id);
      if (zeta) return (f.bu || f.line) ? "market" : "bu";
      return f.corp ? "market" : "corp";
    },
    vocab: vocab,
    availability: function () {
      var a = api(); if (!a || !a.ok) return { name: "IQVIA", months: [] };
      var sel = null; try { sel = a.selected().keys; } catch (e) {}
      return { name: "IQVIA", months: periodMonths(a), selected: sel, defaultPeriod: "mat" };
    },
    scopeLabel: function () { return L().scopeLabel(); },
    sourceNote: function () { return "IQVIA cache · monthly, LCV and SU"; },
    singleScopeOptions: function () { return L().singleScopeOptions(); },
    fetch: fetch, ops: {}
  };
  if (global.AskQuery) global.AskQuery.registerProvider(provider);
  global.AskProvIqvia = { provider: provider };
})(typeof window !== "undefined" ? window : this);
