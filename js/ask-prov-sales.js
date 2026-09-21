(function(g){(g.AskBuild=g.AskBuild||{})["ask-prov-sales.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — Sales provider for the AskQuery layer
 * ============================================================================
 *
 * Adapts js/sales.js to the AskQuery provider contract. It computes NO business
 * KPI of its own: every figure is a value returned by the dashboard's existing
 * semantic functions, called with the user's own scope and the active target
 * scenario:
 *
 *   BU / company totals   SalesDashboard.getSalesAchievementSummary(bu, line, false, scenario, months)
 *   by line               SalesDashboard.getLineSalesSummary(bu, months, false, scenario)
 *   by brand              SalesDashboard.getBrandAchievement(bu, line, false, scenario, maxMonth)
 *   by product (item)     SalesDashboard.getItemAchievement(bu, brand, line, scenario, maxMonth)
 *   by district manager   SalesDashboard.getDmSalesSummary(bu, line, months, scenario)
 *
 * TIME. The BU / line / DM functions take a list of month indices, so a period
 * is passed straight through. Brand and item functions accept only a cumulative
 * cut-off ("maxMonth"); a single month or a quarter is therefore obtained as
 * the DIFFERENCE of two cumulative calls (actual, target and units are all
 * additive), and the achievement % is recomputed as difference-actual ÷
 * difference-target — the dashboard's own formula on the dashboard's own sums.
 * A period that covers every loaded month passes null (the dashboard default),
 * so YTD answers are the dashboard's numbers untouched.
 *
 * SCOPE. `ignoreLineAuth` is always false, so AUTH.isLineAllowed() drops any
 * line the user may not see inside the semantic layer. The one semantic function
 * with no line-level entitlement check, getItemAchievement, is only called when
 * the user's entitlement covers the whole business unit (or the named line is
 * allowed), so product-level detail can never expose a line the user cannot see.
 */
(function (global) {
  "use strict";

  function SD() { return global.SalesDashboard; }
  function SEM() { return global.SEMANTIC; }
  function AU() { return global.AUTH; }
  function ENG() { return global.AskEngine; }

  // -------------------------------------------------------------------------
  // Memo: results of dashboard calls, per signed-in user (never shared across users)
  // -------------------------------------------------------------------------
  var _memo = {}, _memoUser = null;
  function memo(key, fn) {
    var u = ENG() ? ENG()._currentUserKey() : "?";
    if (_memoUser !== u) { _memo = {}; _memoUser = u; }
    if (Object.prototype.hasOwnProperty.call(_memo, key)) return _memo[key];
    var v = fn();
    _memo[key] = v;
    return v;
  }

  function scenarioNow() { return AU() && AU().getActiveScenario ? AU().getActiveScenario() : "official"; }
  function scenarioLabel(s) {
    var t = SEM() && SEM().TARGET_SCENARIOS && SEM().TARGET_SCENARIOS[s];
    return t && t.label ? t.label : s;
  }

  /** A target scenario named in the question, honoured only if the account may toggle it. */
  function scenarioFor(req) {
    var nq = (req.plan && req.plan.nq) || "";
    var active = scenarioNow(), want = null;
    if (/\bshortage target\b|\bshortage scenario\b|\bshortage basis\b/.test(nq)) want = "shortage";
    else if (/\bworking target\b|\bworking scenario\b/.test(nq)) want = "working";
    else if (/\bofficial target\b|\bofficial scenario\b/.test(nq)) want = "official";
    var out = { key: active, note: null };
    if (want && want !== active) {
      var can = AU() && AU().canToggleScenario ? AU().canToggleScenario() : false;
      var ok = true;
      if (want === "shortage" && SD().isShortageDataAvailable && !SD().isShortageDataAvailable()) ok = false;
      if (want === "working" && SD().isScenarioDataAvailable && !SD().isScenarioDataAvailable()) ok = false;
      if (can && ok) { out.key = want; out.note = "Target basis switched to " + scenarioLabel(want) + " because you asked for it (your account may toggle it)."; }
      else out.note = "You asked for the " + scenarioLabel(want) + ", but " + (can ? "that target set is not loaded" : "your account is locked to the " + scenarioLabel(active)) + " — using the " + scenarioLabel(active) + ".";
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Scope helpers
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
  function buFullyAllowed(bu) {
    var m = SEM() && SEM().CANONICAL_LINE_TO_BU;
    if (!m) return false;
    return Object.keys(m).filter(function (n) { return m[n] === bu; }).every(function (n) { return !AU() || !AU().isLineAllowed || AU().isLineAllowed(n); });
  }

  // -------------------------------------------------------------------------
  // Months
  // -------------------------------------------------------------------------
  function monthInfo() {
    return memo("months", function () {
      var r = SD().getAvailableMonths();
      var list = (r && r.ok ? r.months : []).filter(function (m) { return /^\d{4}-\d{2}$/.test(m.key); });
      var orderOk = true;
      for (var i = 1; i < list.length; i++) if (list[i].idx < list[i - 1].idx) orderOk = false;
      return { list: list, orderOk: orderOk, lastIdx: list.length ? list[list.length - 1].idx : -1 };
    });
  }
  function keyOfIdx(idx) { var l = monthInfo().list; for (var i = 0; i < l.length; i++) if (l[i].idx === idx) return l[i].key; return null; }
  function idxsOf(keys) {
    var map = {}; monthInfo().list.forEach(function (m) { map[m.key] = m.idx; });
    return (keys || []).map(function (k) { return map[k]; }).filter(function (x) { return x !== undefined; }).sort(function (a, b) { return a - b; });
  }
  function coversAll(ix) { return ix.length === monthInfo().list.length; }
  /** null = "every month" (the dashboard default). */
  function monthsParam(ix) { return coversAll(ix) ? null : ix; }
  function runsOf(ix) {
    var runs = [], cur = null;
    ix.forEach(function (i) {
      if (cur && i === cur[1] + 1) cur[1] = i; else { cur = [i, i]; runs.push(cur); }
    });
    return runs;
  }

  // -------------------------------------------------------------------------
  // Dashboard calls (memoised)
  // -------------------------------------------------------------------------
  function callSummary(bu, line, sc, ix) {
    var mp = monthsParam(ix);
    return memo(["sum", bu, line || "", sc, mp ? mp.join(",") : "ALL"].join("|"), function () {
      return SD().getSalesAchievementSummary(bu, line || null, false, sc, mp || undefined);
    });
  }
  function callLines(bu, sc, ix) {
    var mp = monthsParam(ix);
    return memo(["lines", bu, sc, mp ? mp.join(",") : "ALL"].join("|"), function () {
      return SD().getLineSalesSummary(bu, mp, false, sc);
    });
  }
  function callDms(bu, line, sc, ix) {
    var mp = monthsParam(ix);
    return memo(["dms", bu, line || "", sc, mp ? mp.join(",") : "ALL"].join("|"), function () {
      return SD().getDmSalesSummary(bu, line || null, mp, sc);
    });
  }
  function cumBrand(bu, line, sc, idx) {
    var last = monthInfo().lastIdx, key = idx === last ? null : keyOfIdx(idx);
    return memo(["brand", bu, line || "", sc, key || "ALL"].join("|"), function () {
      return SD().getBrandAchievement(bu, line || null, false, sc, key || undefined);
    });
  }
  function cumItem(bu, brand, line, sc, idx) {
    var last = monthInfo().lastIdx, key = idx === last ? null : keyOfIdx(idx);
    return memo(["item", bu, brand || "", line || "", sc, key || "ALL"].join("|"), function () {
      return SD().getItemAchievement(bu, brand || null, line || null, sc, key || undefined);
    });
  }

  /** Period slice of a cumulative-only function: sum over runs of cum(hi) − cum(lo−1). */
  function sliceCumulative(callAt, listKey, ix) {
    var acc = {}, ok = true, status = null, meta = null;
    runsOf(ix).forEach(function (run) {
      var hi = callAt(run[1]);
      if (!hi || !hi.ok) { ok = false; status = hi && hi.status; return; }
      meta = meta || hi;
      var lo = run[0] > 0 ? callAt(run[0] - 1) : null;
      if (run[0] > 0 && (!lo || !lo.ok)) { ok = false; status = lo && lo.status; return; }
      var add = function (rows, sign) {
        (rows || []).forEach(function (r) {
          var m = acc[r.name] || (acc[r.name] = { name: r.name, a: 0, t: 0, q: 0, tq: 0 });
          m.a += sign * (r.actualValue || 0); m.t += sign * (r.targetValue || 0);
          m.q += sign * (r.actualQty || 0); m.tq += sign * (r.targetQty || 0);
        });
      };
      add(hi[listKey], +1);
      if (lo) add(lo[listKey], -1);
    });
    return { ok: ok, status: status, rows: Object.keys(acc).map(function (k) { return acc[k]; }), meta: meta };
  }

  // -------------------------------------------------------------------------
  // Row builders
  // -------------------------------------------------------------------------
  function vOf(a, t, extra) {
    var v = { sales_value: a, sales_target: t, achievement: t > 0 ? (a / t) * 100 : null, sales_gap: t > 0 ? t - a : null };
    if (extra) Object.keys(extra).forEach(function (k) { v[k] = extra[k]; });
    return v;
  }

  // -------------------------------------------------------------------------
  // fetch
  // -------------------------------------------------------------------------
  var ALL_M = null; // filled below (measure list)

  function fetch(req) {
    if (!SD() || !SEM()) return { ok: false, missing: "The sales layer has not loaded yet." };
    var period = req.period || {}, ix = idxsOf(period.keys);
    if (!ix.length) return { ok: false, missing: "Sales has no month loaded for " + (period.label || "that period") + "." };
    if (!monthInfo().orderOk && !coversAll(ix)) return { ok: false, missing: "The sales cache's month order is not chronological, so a partial period cannot be sliced safely." };

    var scn = scenarioFor(req), sc = scn.key;
    var f = req.filters || {}, g = req.groupBy || null;
    var caveats = [], basis = [], extraMeasures = [];
    if (scn.note) caveats.push(scn.note);
    basis.push(["Target basis", scenarioLabel(sc)]);
    basis.push(["Sales basis", "Non-Tender transactions only, Value basis (EGP)"]);

    // ---- BU list in scope ------------------------------------------------
    var mine = allowedBUs(), bus;
    if (f.bu && mine.indexOf(f.bu) < 0) return { ok: false, missing: "“" + f.bu + "” is outside the data you have access to." };
    if (f.line && AU() && AU().isLineAllowed && !AU().isLineAllowed(f.line)) return { ok: false, missing: "“" + f.line + "” is outside the data you have access to." };
    if (f.line) {
      var lb = lineBU(f.line);
      if (!lb) return { ok: false, missing: "The sales layer has no line called “" + f.line + "”." };
      bus = [lb];
    } else if (f.bu) bus = [f.bu];
    else bus = mine;
    if (!bus.length) return { ok: false, missing: "Your account has no business unit in the sales data." };

    function scopeTotal() {
      var a = 0, t = 0, any = false, asOf = null;
      bus.forEach(function (bu) {
        var s = callSummary(bu, f.line || null, sc, ix);
        if (!s || !s.ok) return;
        any = true; a += s.actualYTD || 0; t += s.targetYTD || 0; asOf = asOf || s.asOfDate;
      });
      return any ? { a: a, t: t, asOf: asOf } : null;
    }

    var rows = [], total = null, asOf = null;

    // ---- group by --------------------------------------------------------
    var dim = g;
    if (!dim) {
      if (f.brand) dim = "brand";
      else if (f.dm) dim = "dm";
    }

    if (dim === "bu") {
      bus.forEach(function (bu) {
        var s = callSummary(bu, f.line || null, sc, ix);
        if (!s || !s.ok) return;
        asOf = asOf || s.asOfDate;
        rows.push({ name: bu, v: vOf(s.actualYTD || 0, s.targetYTD || 0) });
      });
    } else if (dim === "line") {
      bus.forEach(function (bu) {
        var r = callLines(bu, sc, ix);
        if (!r || !r.ok) return;
        asOf = asOf || r.asOfDate;
        (r.lines || []).forEach(function (l) {
          if (f.line && l.name !== f.line) return;
          rows.push({ name: l.name, bu: bu, v: vOf(l.actualValue, l.targetValue, { sales_per_position: l.salesPerPosition }) });
        });
      });
      caveats.push("CHC_SALES is a second channel view of CHC's own catalogue; the dashboard folds it into CHC in the line table and leaves it out of unscoped BU totals.");
    } else if (dim === "dm") {
      bus.forEach(function (bu) {
        var r = callDms(bu, f.line || null, sc, ix);
        if (!r || !r.ok) return;
        asOf = asOf || r.asOfDate;
        (r.dms || []).forEach(function (d) {
          rows.push({ name: d.name, bu: bu, v: vOf(d.actualValue, d.targetValue, { sales_per_position: d.salesPerPosition }) });
        });
      });
      caveats.push("District-manager rows include every line that manager covers within your scope.");
    } else if (dim === "brand") {
      bus.forEach(function (bu) {
        var sl = sliceCumulative(function (i) { return cumBrand(bu, f.line || null, sc, i); }, "brands", ix);
        if (!sl.ok) return;
        asOf = asOf || (sl.meta && sl.meta.asOfDate);
        var tot = sl.rows.reduce(function (s, r) { return s + r.a; }, 0);
        sl.rows.forEach(function (r) {
          if (!(r.t > 0 || r.a > 0)) return;
          rows.push({ name: r.name, bu: bu, v: vOf(r.a, r.t, { units: r.q, contribution: tot > 0 ? (r.a / tot) * 100 : null }) });
        });
      });
      if (!coversAll(ix)) caveats.push("Brand figures for a partial period are the difference of two cumulative dashboard calls (cut-off month minus the month before the period), so they reconcile exactly to the YTD figure.");
    } else if (dim === "item") {
      var itemBus = bus.filter(function (bu) { return f.line ? true : buFullyAllowed(bu); });
      if (!itemBus.length) return { ok: false, missing: "Product-level detail is only available where your access covers the whole business unit; your account is restricted to specific lines." };
      var skipped = [];
      itemBus.forEach(function (bu) {
        var sl = sliceCumulative(function (i) { return cumItem(bu, f.brand || null, f.line || null, sc, i); }, "items", ix);
        if (!sl.ok) { skipped.push(bu); return; }
        asOf = asOf || (sl.meta && sl.meta.asOfDate);
        var tot = sl.rows.reduce(function (s, r) { return s + r.a; }, 0);
        sl.rows.forEach(function (r) {
          if (!(r.t > 0 || r.a > 0)) return;
          rows.push({ name: r.name, bu: bu, v: vOf(r.a, r.t, { units: r.q, contribution: tot > 0 ? (r.a / tot) * 100 : null }) });
        });
      });
      if (skipped.length) caveats.push("Product-level detail is not available for " + skipped.join(", ") + " in the sales layer.");
      if (bus.length > itemBus.length) caveats.push("Product-level detail was left out for business units where your access covers only some lines.");
    }

    // duplicate names across BUs: label with the BU so nothing is silently merged
    if (dim && dim !== "bu") {
      var cnt = {};
      rows.forEach(function (r) { cnt[r.name] = (cnt[r.name] || 0) + 1; });
      rows.forEach(function (r) { if (cnt[r.name] > 1 && r.bu) r.name = r.name + " (" + r.bu + ")"; });
    }

    // ---- filters applied to grouped rows --------------------------------
    var wantsFilter = !g && (f.brand || f.dm);
    if (wantsFilter) {
      var key = f.brand ? f.brand : f.dm, KEY = String(key).toUpperCase();
      rows = rows.filter(function (r) { return r.name.toUpperCase() === KEY || r.name.toUpperCase().indexOf(KEY + " (") === 0; });
      if (!rows.length) return { ok: false, missing: "The sales layer has no figures for “" + key + "” in " + (f.line || f.bu || "your scope") + " for " + (period.label || "that period") + "." };
      var a = 0, t = 0; rows.forEach(function (r) { a += r.v.sales_value; t += r.v.sales_target; });
      total = vOf(a, t);
      if (f.brand) { var u = 0, cn = 0; rows.forEach(function (r) { u += r.v.units || 0; cn += r.v.contribution || 0; }); total.units = u; if (rows.length === 1) total.contribution = rows[0].v.contribution; }
      if (rows.length > 1) caveats.push("“" + key + "” appears under " + rows.length + " business units; the figure adds them (each shown in the table).");
      if (f.brand && f.dm) caveats.push("Brand and district manager were both named; the sales layer cannot cross them, so the district manager is not applied.");
    } else if (dim) {
      var st = scopeTotal();
      if (st) { total = vOf(st.a, st.t); asOf = asOf || st.asOf; }
      if (f.brand && g) caveats.push("You also named the brand “" + f.brand + "”; it is not applied to a “by " + g + "” breakdown.");
    } else {
      var s2 = scopeTotal();
      if (!s2) return { ok: false, missing: "The sales layer returned no figure for " + (f.line || f.bu || "your scope") + "." };
      if (s2.a === 0 && s2.t === 0) return { ok: false, missing: "The sales layer holds no sales or target rows for " + (f.line || f.bu || "this scope") + " in " + (period.label || "that period") + "." };
      total = vOf(s2.a, s2.t); asOf = s2.asOf;
      rows = [{ name: f.line || f.bu || "Total", v: total }];
    }

    if (!rows.length) return { ok: false, missing: "The sales layer has no rows for that cut in " + (period.label || "that period") + "." };
    extraMeasures = [ALL_M.sales_value, ALL_M.sales_target];
    if (dim === "brand" || dim === "item") extraMeasures.push(ALL_M.contribution);
    if (bus.length > 1) basis.push(["Business units", bus.join(", ")]);
    return {
      ok: true, rows: rows, total: total, basis: basis, caveats: caveats, asOf: asOf ? String(asOf) : null,
      extraMeasures: extraMeasures,
      formula: "Achievement % = actual value ÷ target value × 100  ·  Gap = target − actual"
    };
  }

  // -------------------------------------------------------------------------
  // Measures
  // -------------------------------------------------------------------------
  var G_ALL = ["bu", "line", "brand", "item", "dm"];
  var M = [
    { id: "achievement", label: "Sales achievement", unit: "pct", better: "high", target100: true, gapMeasure: "sales_gap",
      aliases: ["sales achievement", "achievement", "achievement pct", "ach", "ach pct", "target achievement", "achieved", "vs target", "performance vs target", "how is performing", "performing", "performance"],
      def: "Actual sales value as a percentage of the target for the same period and scope.",
      formula: "actual value ÷ target value × 100", grains: G_ALL },
    { id: "sales_value", label: "Sales value", unit: "egp", better: "high", gapMeasure: "sales_gap",
      aliases: ["sales value", "sales", "revenue", "actual sales", "actual value", "sold", "turnover", "net sales"],
      def: "Non-Tender sales, Value basis, in EGP.", formula: "sum of Non-Tender value", grains: G_ALL },
    { id: "sales_target", label: "Sales target", unit: "egp", better: "high",
      aliases: ["sales target", "target value", "targets", "target"],
      def: "The target value of the active target basis (Official / Working / Shortage).", formula: "sum of target value for the active scenario", grains: G_ALL },
    { id: "sales_gap", label: "Gap to target", unit: "egp", better: "low", gap: true,
      aliases: ["gap to target", "sales gap", "shortfall", "gap", "shortage in sales", "below target by", "how far from target", "distance to target"],
      def: "Target minus actual value — positive means behind target.", formula: "target value − actual value (only where a target exists)", grains: G_ALL },
    { id: "units", label: "Units", unit: "units", better: "high",
      aliases: ["units", "quantity", "qty", "packs", "volume"],
      def: "Non-Tender units sold.", formula: "sum of Non-Tender quantity", grains: ["brand", "item"] },
    { id: "contribution", label: "Contribution", unit: "pct", better: "high",
      aliases: ["contribution", "share of bu", "share of sales", "mix", "portfolio share"],
      def: "Share of the business unit's Non-Tender value.", formula: "own value ÷ business-unit value × 100", grains: ["brand", "item"] },
    { id: "sales_per_position", label: "Sales per position", unit: "egp", better: "high",
      aliases: ["sales per position", "sales per rep", "sales per territory", "productivity", "per position"],
      def: "Actual value divided by the distinct deployed position codes (placeholder codes excluded).", formula: "actual value ÷ active positions", grains: ["line", "dm"] }
  ];
  ALL_M = {}; M.forEach(function (m) { ALL_M[m.id] = m; });

  // -------------------------------------------------------------------------
  // Vocabulary (scoped): brand and DM names are pulled through the scoped calls
  // -------------------------------------------------------------------------
  function vocab() {
    return memo("vocab|" + scenarioNow(), function () {
      var bus = allowedBUs(), lines = allowedLines(), brands = {}, dms = {};
      var sc = scenarioNow();
      bus.forEach(function (bu) {
        try {
          var b = SD().getBrandAchievement(bu, null, false, sc);
          if (b && b.ok) (b.brands || []).forEach(function (x) { if (x.name && x.name !== "Unknown") brands[x.name] = true; });
        } catch (e) {}
        try {
          var d = SD().getDmSalesSummary(bu, null, null, sc);
          if (d && d.ok) (d.dms || []).forEach(function (x) { if (x.name) dms[x.name] = true; });
        } catch (e) {}
      });
      return { bu: bus, line: lines, brand: Object.keys(brands).sort(), dm: Object.keys(dms).sort() };
    });
  }

  var provider = {
    id: "sales", label: "Sales", tabs: ["sales", "executive"],
    domains: ["sales"], defaultMeasure: "achievement", rankMeasure: "sales_value",
    canUse: function () { return !!(SD() && SEM()); },
    requires: [],
    measures: M,
    dims: { bu: { label: "Business Unit" }, line: { label: "Line" }, brand: { label: "Brand" }, item: { label: "Product" }, dm: { label: "District Manager" } },
    hierarchy: { bu: "line", line: "brand", brand: "item", dm: null },
    vocab: function () { return vocab(); },
    availability: function () {
      var l = monthInfo().list;
      return { name: "Sales", months: l.map(function (m) { return m.key; }), defaultPeriod: "ytd" };
    },
    scopeLabel: function () {
      var s = AU() && AU().getScope ? AU().getScope() : null;
      if (!s || s.unrestricted) return "whole company";
      var parts = [];
      if (s.bus && s.bus.length) parts.push(s.bus.join(", "));
      if (s.lines && s.lines.length) parts.push(s.lines.length > 4 ? s.lines.slice(0, 4).join(", ") + " +" + (s.lines.length - 4) + " more" : s.lines.join(", "));
      return parts.length ? parts.join(" · ") : "your scope";
    },
    sourceNote: function () { return "Sales cache · target basis " + scenarioLabel(scenarioNow()); },
    singleScopeOptions: function () {
      var ls = allowedLines(), bus = allowedBUs();
      var s = AU() && AU().getScope ? AU().getScope() : null;
      if (s && !s.unrestricted && s.lines && s.lines.length === 1) return [{ dim: "line", name: s.lines[0] }];
      if (bus.length === 1) return [{ dim: "bu", name: bus[0] }];
      return bus.map(function (b) { return { dim: "bu", name: b }; });
    },
    fetch: fetch,
    _memoReset: function () { _memo = {}; _memoUser = null; }
  };

  if (global.AskQuery) global.AskQuery.registerProvider(provider);
  global.AskProvSales = { provider: provider, fetch: fetch, monthInfo: monthInfo };
})(typeof window !== "undefined" ? window : this);
