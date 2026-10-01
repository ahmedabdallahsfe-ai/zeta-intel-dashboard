(function(g){(g.AskBuild=g.AskBuild||{})["ask-prov-tomarket.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — To-Market vs In-Market provider
 * ============================================================================
 * Source of every number: ExecutiveDashboard.askTmsIms(), which hands over the SAME
 * getTmsImsMetrics() / getTmsImsDetailedBreakdown() the Executive Command Center's Pull-Through Rate
 * and Distributor Stock Days cards (and their drill-down modal) use, over the platform cache TMS_IMS_CACHE.
 *
 * Definitions (unchanged from the code):
 *   Scope       Private-sector units only (TMS = sell-in "to market", IMS = sell-out "in market").
 *   Pull-through = the average over months of  IMS(month) ÷ TMS(previous month) × 100   (target 100%).
 *   Inventory    = Σ TMS − Σ IMS over every month in the cache (shown only where positive).
 *   Stock days   = Inventory ÷ daily in-market velocity, where velocity = IMS of the last 3 months ÷ (3 × 30).
 * These are cumulative / trailing measures, not per-period: there is no month selector, so month, YTD and MoM
 * questions are refused rather than approximated.
 *
 * NOTE: the To-Market tab itself embeds a separate workspace ("TO MARKET_IN MARKET/index.html") with its own data
 * file. This provider answers from the platform cache used by the Executive cards; the two are not proven identical.
 * Access: the tab's own rule, tomarketAllowedBU() (unrestricted, or a BU manager holding every line of one BU).
 */
(function (global) {
  "use strict";
  function L() { return global.AskProvLib; }
  function EX() { return global.ExecutiveDashboard; }
  function api() { try { return EX() && EX().askTmsIms ? EX().askTmsIms() : null; } catch (e) { return null; } }
  function tabAllowed() { try { return typeof global.tomarketAllowedBU === "function" ? global.tomarketAllowedBU() !== false : false; } catch (e) { return false; } }

  var DIMS = { bu: "Business Unit", line: "Line", brand: "Brand", item: "Product" };

  var M = [
    { id: "tm_pull_through", label: "Pull-through rate", unit: "pct", better: "high", targetValue: 100, gapMeasure: "tm_pt_gap",
      aliases: ["pull through", "pull through rate", "pull-through", "pull-through rate", "pullthrough", "pt rate", "sell out to sell in", "in market vs to market"],
      def: "Average over months of IMS(month) ÷ TMS(previous month) × 100, Private units. 100% = the channel sold through what was shipped a month earlier.",
      formula: "mean over months of IMS(m) ÷ TMS(m−1) × 100" },
    { id: "tm_stock_days", label: "Distributor stock days", unit: "days", better: "low",
      aliases: ["stock days", "distributor stock days", "days of stock", "channel stock days", "stock cover", "days of inventory", "inventory days"],
      def: "Calculated channel inventory ÷ daily in-market velocity (IMS of the last 3 months ÷ 90). The Executive card's bands: 30–45 days Excellent, 20–60 On Track, 15–90 At Risk, otherwise Critical.",
      formula: "(Σ TMS − Σ IMS) ÷ (IMS last 3 months ÷ 90)" },
    { id: "tm_inventory", label: "Calculated channel inventory (units)", unit: "units", better: "low",
      aliases: ["inventory", "channel inventory", "distributor inventory", "calculated inventory", "stock build", "stock buildup", "channel stock", "stock in the channel"],
      def: "Cumulative to-market units minus cumulative in-market units (Private), shown only where positive.", formula: "Σ TMS − Σ IMS" },
    { id: "tm_pt_gap", label: "Pull-through shortfall vs 100%", unit: "pts", better: "low", gap: true,
      aliases: ["pull through shortfall", "pull through gap", "pull-through gap", "pull-through shortfall"],
      def: "Percentage points by which pull-through falls short of the 100% threshold; zero at or above it.", formula: "max(0, 100 − pull-through)" }
  ];
  M.forEach(function (m) { m.grains = Object.keys(DIMS); });

  function vals(o) {
    if (!o) return null;
    var pt = o.pullThroughRate !== undefined ? o.pullThroughRate : o.pullThrough, sd = o.stockDays, inv = o.currentInventory !== undefined ? o.currentInventory : o.inventory;
    return { tm_pull_through: pt == null ? null : pt, tm_stock_days: sd == null ? null : sd, tm_inventory: inv == null ? null : inv, tm_pt_gap: pt == null ? null : Math.max(0, 100 - pt) };
  }
  function allNull(v) { return !v || (v.tm_pull_through === null && v.tm_stock_days === null && v.tm_inventory === null); }

  function fetch(req) {
    var a = api();
    if (!a || !a.ok || !tabAllowed()) return { ok: false, missing: "To-Market vs In-Market is not available to this account (it needs an unrestricted account or a BU manager holding every line of one BU), or its cache is missing." };
    var period = req.period || {};
    if ((period.keys || []).length && period.explicit !== false && (period.kind !== "latest")) {
      return { ok: false, missing: "To-Market vs In-Market measures are cumulative / trailing (" + a.months[0] + " → " + a.latest + "), with no month selector on the dashboard. I will not slice them into " + (period.label || "that period") + "." };
    }
    var bus = a.allowedBUs(), f = req.filters || {}, notes = [];
    var bu = f.bu ? bus.filter(function (b) { return L().same(b, f.bu); })[0] : null;
    if (f.bu && !bu) return { ok: false, missing: "“" + f.bu + "” is outside your access for To-Market vs In-Market." };
    var line = f.line || null;
    var g = req.groupBy;
    if (g && !DIMS[g]) return { ok: false, missing: "To-Market vs In-Market cannot be broken down by " + g + ". Its cuts are BU, line, brand and product." };
    var scopeBU = bu || (a.canAll() ? "All" : bus[0]);
    if (!bu && !a.canAll() && req.plan && req.plan.assumptions) req.plan.assumptions.push("Your access to this page is limited to " + bus[0] + ".");
    var rows = [], total = null;
    if (g === "bu") {
      bus.forEach(function (b) { if (bu && b !== bu) return; var m = a.metrics(b, null); if (m && m.ok) rows.push({ name: b, v: vals(m) }); });
      if (a.canAll() && !bu) { var t = a.metrics("All", null); if (t && t.ok) total = vals(t); }
    } else if (g === "line") {
      var list = bu ? [bu] : bus;
      list.forEach(function (b) {
        (a.linesForBU(b) || []).forEach(function (l) {
          var m = a.metrics(b, l); if (m && m.ok) rows.push({ name: l, bu: b, v: vals(m) });
        });
      });
      var t2 = a.metrics(scopeBU, null); if (t2 && t2.ok) total = vals(t2);
    } else if (g === "brand" || g === "item") {
      var bd = a.breakdown(scopeBU, line);
      if (!bd) return { ok: false, missing: "To-Market vs In-Market has no brand / product rows for that scope." };
      (g === "brand" ? bd.brands : bd.products).forEach(function (o) { rows.push({ name: o.name, v: vals(o) }); });
      var t3 = a.metrics(scopeBU, line); if (t3 && t3.ok) total = vals(t3);
    } else {
      var m0 = a.metrics(scopeBU, line);
      if (!m0 || !m0.ok) return { ok: false, missing: "To-Market vs In-Market has no data for " + (line || scopeBU) + " (" + ((m0 && m0.status) || "cache") + ")." };
      total = vals(m0); rows = [{ name: line || (scopeBU === "All" ? "All BUs" : scopeBU), v: total }];
    }
    rows = rows.filter(function (r) { return !allNull(r.v); });
    if (!rows.length) return { ok: false, missing: "To-Market vs In-Market holds no rows for that cut within your access." };
    return { ok: true, rows: rows, total: total || rows[0].v, asOf: a.latest,
      basis: [["Data", "TMS_IMS_CACHE — " + a.months[0] + " to " + a.latest + ", Private units"], ["Basis", "cumulative / trailing; no month selector"]],
      caveats: ["Pull-through, stock days and inventory are cumulative over every loaded month (velocity: last 3 months), exactly as the Executive cards compute them.",
                "The To-Market tab embeds its own workspace; this answer uses the platform cache behind the Executive cards."],
      formula: "getTmsImsMetrics() / getTmsImsDetailedBreakdown() — pull-through = mean IMS(m) ÷ TMS(m−1); stock days = (ΣTMS − ΣIMS) ÷ (IMS last 3 months ÷ 90)" };
  }

  function vocab() {
    var a = api(); if (!a || !a.ok || !tabAllowed()) return {};
    var bus = a.allowedBUs(), lines = {}, brands = {}, items = {};
    bus.forEach(function (b) {
      (a.linesForBU(b) || []).forEach(function (l) { lines[l] = 1; });
      var bd = a.breakdown(b, null);
      if (bd) { bd.brands.forEach(function (x) { brands[x.name] = 1; }); bd.products.forEach(function (x) { items[x.name] = 1; }); }
    });
    return { bu: bus.slice(), line: Object.keys(lines).sort(), brand: Object.keys(brands).sort(), item: Object.keys(items).sort() };
  }

  var provider = {
    id: "tomarket", quietAlias: true, label: "To-Market vs In-Market", tabs: ["tomarket"], domains: ["tomarket"],
    defaultMeasure: "tm_pull_through", rankMeasure: "tm_pull_through",
    canUse: function () { return !!(EX() && EX().askTmsIms && tabAllowed()); },
    requires: [], measures: M,
    dims: (function () { var o = {}; Object.keys(DIMS).forEach(function (k) { o[k] = { label: DIMS[k] }; }); return o; })(),
    hierarchy: { bu: "line", line: "brand", brand: "item" }, ladder: ["bu", "line", "brand", "item"],
    defaultGroup: function (pl) { var f = pl.filters || {}; return f.line ? "brand" : (f.bu ? "line" : "bu"); },
    vocab: vocab,
    availability: function () { var a = api(); return { name: "To-Market vs In-Market", months: [], snapshot: true, snapshotNote: a && a.ok ? "cumulative " + a.months[0] + " → " + a.latest : "cumulative" }; },
    scopeLabel: function () { return L().scopeLabel(); },
    sourceNote: function () { return "TMS_IMS_CACHE · Executive To-Market KPIs (cumulative)"; },
    singleScopeOptions: function () { return L().singleScopeOptions(); },
    fetch: fetch, ops: {}
  };
  if (global.AskQuery) global.AskQuery.registerProvider(provider);
  global.AskProvToMarket = { provider: provider };
})(typeof window !== "undefined" ? window : this);
