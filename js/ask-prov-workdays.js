(function(g){(g.AskBuild=g.AskBuild||{})["ask-prov-workdays.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — Field Working Days provider
 * ============================================================================
 * Source of every number: WorkingDaysDashboard.askApi() — the page's own scoped rows
 * (applyScope: BU + line tests from AUTH) and the page's own computeAgg(). For one month
 * the "Avg Field Working Days %" here is therefore exactly the page's KPI card.
 *
 * Definitions (from the page footnote, unchanged):
 *   Target Working Days = (Calendar Days − TOT) × tier multiplier   (DM/DSM 0.8, ASM 0.6, NSM 0.3)
 *   Field Working Days % = All Visit Days ÷ Target Working Days      (per employee, month)
 * Tiers are never mixed silently: multipliers differ by design, so a question that does not name a
 * tier is answered for DM / DSM (the page's default tier) and says so.
 */
(function (global) {
  "use strict";
  var L = function () { return global.AskProvLib; };
  function WD() { return global.WorkingDaysDashboard; }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var TIERS = ["DM_DSM", "ASM", "NSM"];
  var TIER_LABEL = { DM_DSM: "DM / DSM", ASM: "ASM", NSM: "NSM" };

  function api() { try { return WD() && WD().askApi ? WD().askApi() : null; } catch (e) { return null; } }
  function year(a) { var g = a && a.generatedAt; var y = g ? +String(g).slice(0, 4) : new Date().getFullYear(); return y || 2026; }
  function keyOf(a, monthName) { var i = MONTHS.indexOf(monthName); return i < 0 ? null : year(a) + "-" + (i + 1 < 10 ? "0" : "") + (i + 1); }
  function monthOfKey(k) { return MONTHS[+String(k).split("-")[1] - 1]; }
  function monthKeys(a) {
    var seen = {}, out = [];
    TIERS.forEach(function (t) { a.availableMonths(t).forEach(function (m) { var k = keyOf(a, m); if (k && !seen[k]) { seen[k] = 1; out.push(k); } }); });
    return out.sort();
  }

  function agg(rows) { return api().computeAgg(rows); }
  var TOT_CATS = [
    ["wd_tot_leave", "Leave Days", "leave days", ["leave days", "leave", "days on leave"]],
    ["wd_tot_holidays", "Holidays", "holiday days", ["holiday days", "holidays"]],
    ["wd_tot_travel", "Business Travel", "business travel days", ["business travel days", "business travel"]],
    ["wd_tot_training", "Training", "training days", ["training days", "training"]],
    ["wd_tot_sales_meeting", "Sales Meeting", "sales meeting days", ["sales meeting days", "sales meetings"]],
    ["wd_tot_group_meeting", "Group Meeting (RTD)", "group meeting days", ["group meeting days", "group meetings", "rtd meeting days"]],
    ["wd_tot_gathering", "Gathering Meeting", "gathering meeting days", ["gathering meeting days", "gathering meetings"]],
    ["wd_tot_conference", "Confrance", "conference days", ["conference days", "conferences"]],
    ["wd_tot_av_conference", "AV Confrance", "AV conference days", ["av conference days", "av conferences", "virtual conference days"]],
    ["wd_tot_weekends", "Weekends", "weekend days", ["weekend days", "weekends"]]
  ];

  var M = [
    { id: "wd_field_pct", label: "Avg Field Working Days %", unit: "pct", better: "high", target100: true,
      aliases: ["field working days", "field working days percent", "field days", "field days percent", "working days achievement", "working days percent", "field working days achievement", "avg field days", "average field days", "field days achievement"],
      def: "All Visit Days ÷ Target Working Days, averaged over the employees in view (the page's “Avg Field Days %”). 100% = the tier's target working days were all worked in the field.",
      formula: "mean over employees of (All Visit Days ÷ Target Working Days) × 100",
      agg: function (rows) { var v = agg(rows).avgFieldPct; return v == null ? null : v * 100; } },
    { id: "wd_below70", label: "Employees below 70% of target", unit: "count", better: "low",
      aliases: ["below 70 percent of target", "below 70 percent", "employees below 70", "coaching candidates working days", "low field days", "low field working days"],
      def: "Employees whose Field Working Days % is under 70% — the page's “coaching candidates”.", formula: "count of employees with Field Days % < 70%",
      agg: function (rows) { return agg(rows).bands.below70; } },
    { id: "wd_below70_share", label: "Share of employees below 70%", unit: "pct", better: "low",
      aliases: ["share below 70 percent", "percent below 70", "share of employees below 70", "share with low field days"],
      def: "Employees below 70% of target as a share of the employees in view.", formula: "below-70 count ÷ employees in view × 100",
      agg: function (rows) { var a = agg(rows); return a.count ? (a.bands.below70 / a.count) * 100 : null; } },
    { id: "wd_above100", label: "Employees above 100% of target", unit: "count", better: "high",
      aliases: ["above 100 percent of target", "above 100 percent", "employees above 100", "over target field days"],
      def: "Employees whose Field Working Days % exceeds 100% (the page flags these as “check target calibration”).", formula: "count of employees with Field Days % > 100%",
      agg: function (rows) { return agg(rows).bands.above100; } },
    { id: "wd_headcount", label: "Employees in view", unit: "count", better: "high",
      aliases: ["employees in working days", "working days headcount", "employees tracked in working days"],
      def: "Employees of the tier in the selected month(s), within your access.", formula: "count of employee rows",
      agg: function (rows) { return rows.length; } },
    { id: "wd_tot_days", label: "Avg TOT days per employee", unit: "num", better: "low",
      aliases: ["tot", "tot days", "time out of territory", "time out of territory days", "average tot days", "avg tot", "days out of territory"],
      def: "Time Out of Territory: the off-day categories (weekends, leave, holidays, meetings, training, travel…) subtracted from calendar days.", formula: "mean of each employee's total TOT days",
      agg: function (rows) { return L().mean(rows, function (r) { return r.deductSum; }); } },
    { id: "wd_target_days", label: "Avg Target Working Days", unit: "num", better: "high",
      aliases: ["target working days", "target days", "average target days"],
      def: "(Calendar Days − TOT) × tier multiplier, averaged over employees.", formula: "mean of each employee's Target Working Days",
      agg: function (rows) { return L().mean(rows, function (r) { return r.targetDays; }); } },
    { id: "wd_visit_days", label: "Avg All Visit Days", unit: "num", better: "high",
      aliases: ["all visit days", "visit days", "average visit days", "days with visits", "actual field days"],
      def: "Days on which the employee logged at least one visit, averaged over employees.", formula: "mean of each employee's All Visit Days",
      agg: function (rows) { return L().mean(rows, function (r) { return r.allVisitDays; }); } }
  ];
  TOT_CATS.forEach(function (c) {
    M.push({ id: c[0], label: "Avg " + c[2], unit: "num", better: "low", aliases: c[3],
      def: "Average " + c[1] + " days per employee, one of the TOT (Time Out of Territory) categories.", formula: "mean over employees of the “" + c[1] + "” TOT days",
      agg: function (rows) { var v = agg(rows).deductAvg[c[1]]; return v === undefined ? null : v; } });
  });

  var DIMS = {
    tier: { label: "Tier", get: function (r) { return TIER_LABEL[r.tier]; } },
    bu: { label: "Business Unit", get: function (r) { return r.bu; } },
    line: { label: "Line", get: function (r) { return r.line; } },
    profile: { label: "Profile", get: function (r) { return r.tier === "DM_DSM" ? r.profile : null; } },
    dm: { label: "District Manager", get: function (r) { return r.tier === "DM_DSM" ? r.name : null; } },
    am: { label: "Area Manager", get: function (r) { return r.tier === "ASM" ? r.name : null; } },
    nsm: { label: "National Sales Manager", get: function (r) { return r.tier === "NSM" ? r.name : null; } }
  };

  function pushOnce(arr, s) { if (arr && arr.indexOf(s) < 0) arr.push(s); }

  function pickTiers(req) {
    var f = req.filters || {}, g = req.groupBy, pl = req.plan || {}, nq = " " + (pl.nq || "") + " ";
    var a = req.__assume = req.__assume || [];
    if (g === "tier") return TIERS;
    if (g === "am" || f.am) return ["ASM"];
    if (g === "nsm" || f.nsm) return ["NSM"];
    if (g === "dm" || f.dm || g === "profile") return ["DM_DSM"];
    if (/ (asm|asms|area sales managers?|area managers?) /.test(nq)) return ["ASM"];
    if (/ (nsm|nsms|national sales managers?) /.test(nq)) return ["NSM"];
    if (/ (dm|dsm|dms|dsms|district (sales )?managers?) /.test(nq)) return ["DM_DSM"];
    pushOnce(pl.assumptions, "No tier named — Field Working Days has a different target multiplier per tier (DM/DSM 0.8, ASM 0.6, NSM 0.3), so tiers are never mixed. Showing DM / DSM, the page's default tier; say “ASM” or “NSM” for the others.");
    return ["DM_DSM"];
  }

  function load(req) {
    var a = api();
    if (!a) return { ok: false, missing: "Field Working Days is not available to this account, or its cache is not loaded." };
    var period = req.period || {}, keys = (period.keys || []).filter(Boolean);
    if (!keys.length) keys = [monthKeys(a).slice(-1)[0]];
    var tiers = pickTiers(req), rows = [], used = {}, caveats = [];
    tiers.forEach(function (t) {
      keys.forEach(function (k) {
        var mn = monthOfKey(k);
        if (a.availableMonths(t).indexOf(mn) < 0) return;
        a.rows(t, mn).forEach(function (r) {
          if (!L().attributable(r.bu, r.line, t === "DM_DSM")) return;
          var c = Object.assign({}, r); c.tier = t; c.month = mn; rows.push(c);
        });
        used[k] = 1;
      });
    });
    if (!rows.length) return { ok: false, missing: "Field Working Days holds no " + tiers.map(function (t) { return TIER_LABEL[t]; }).join(" / ") + " rows for " + (period.label || "that period") + "." };
    var mult = a.multiplier || {};
    var basis = [["Data", "Field Working Days cache (Sprint_Missing_KPI_Template.xlsx), scoped to your access by the page's own rule"],
                 ["Tier", tiers.map(function (t) { return TIER_LABEL[t] + " (×" + mult[t] + ")"; }).join(", ")],
                 ["Months", Object.keys(used).map(monthOfKey).join(", ")]];
    if (Object.keys(used).length > 1) caveats.push("Several months are pooled as one list of employee-months (the page shows one month at a time); each employee-month counts once.");
    if (tiers.indexOf("ASM") >= 0 || tiers.indexOf("NSM") >= 0) caveats.push("ASM / NSM rows carry only a BU: their line is a majority-vote of their teams, not a home line, so line cuts are not meaningful for those tiers.");
    if (tiers.length > 1) caveats.push("Multipliers differ by tier by design, so raw percentages are not directly comparable across tiers.");
    return { ok: true, rows: rows, basis: basis, caveats: caveats, asOf: Object.keys(used).map(monthOfKey).join(", "),
             formula: "Field Working Days % = All Visit Days ÷ Target Working Days; Target = (Calendar Days − TOT) × tier multiplier" };
  }

  function vocab() {
    var a = api(); if (!a) return {};
    var seen = { bu: {}, line: {}, profile: {}, dm: {}, am: {}, nsm: {} };
    TIERS.forEach(function (t) {
      a.availableMonths(t).forEach(function (m) {
        a.rows(t, m).forEach(function (r) {
          if (!L().attributable(r.bu, r.line, t === "DM_DSM")) return;
          if (r.bu && r.bu !== "Unassigned") seen.bu[r.bu] = 1;
          if (t === "DM_DSM") { if (r.line && r.line !== "Unassigned") seen.line[r.line] = 1; if (r.profile) seen.profile[r.profile] = 1; if (r.name) seen.dm[r.name] = 1; }
          if (t === "ASM" && r.name) seen.am[r.name] = 1;
          if (t === "NSM" && r.name) seen.nsm[r.name] = 1;
        });
      });
    });
    var o = {}; Object.keys(seen).forEach(function (k) { o[k] = Object.keys(seen[k]).sort(); }); return o;
  }

  var provider = L().make({
    id: "workdays", label: "Field Working Days", tabs: ["workingdays"], domains: ["workdays", "workingdays"],
    defaultMeasure: "wd_field_pct", rankMeasure: "wd_field_pct",
    canUse: function () { return !!(WD() && WD().canView && WD().canView() && api()); },
    measures: M, dims: DIMS, hierarchy: { tier: "bu", bu: "line", line: "dm", dm: null },
    ladder: ["bu", "line", "dm"],
    load: load, vocab: vocab,
    availability: function () { var a = api(); return { name: "Field Working Days", months: a ? monthKeys(a) : [] }; },
    sourceNote: function () { return "Field Working Days cache · Sprint_Missing_KPI_Template.xlsx"; }
  });
  global.AskProvWorkdays = { provider: provider };
})(typeof window !== "undefined" ? window : this);
