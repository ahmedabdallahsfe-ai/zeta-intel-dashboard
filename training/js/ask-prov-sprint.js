(function(g){(g.AskBuild=g.AskBuild||{})["ask-prov-sprint.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — Zeta Sprint 2026 provider
 * ============================================================================
 * Source of every number: SprintDashboard.askApi() — the page's own month caches and its own scope
 * predicates (repInScope for reps, dmOrBmInScope for DM/DSM and Brand Managers, asmNsmInScope for
 * ASM/NSM, excludedInScope for the excluded lists) and band(). Points are the page's stored points:
 * this provider never recomputes a curve, floor or weight.
 *
 * Sprint is a MONTHLY competition. The page defines a period for one month; Q3 / Total Year are
 * "cumulative" periods whose summing rule the page itself says is not defined, so any multi-month
 * period is answered as "not defined", never by adding months.
 *
 * Tiers are never mixed: each tier is scored on different KPIs and maxima (Medical Rep 50/40/10,
 * CHC Sales Rep 60/40, DM/DSM team-average 70 + 3×10, ASM/NSM team-average 80 + 20, Brand Manager
 * 50/20/30). A question that names no tier is answered for Medical Rep and says so.
 */
(function (global) {
  "use strict";
  function L() { return global.AskProvLib; }
  function SP() { return global.SprintDashboard; }
  function P() { return global.AskPeriod; }

  function api() { try { return SP() && SP().askApi ? SP().askApi() : null; } catch (e) { return null; } }
  function pushOnce(a, s) { if (a && a.indexOf(s) < 0) a.push(s); }
  function canonLine(l) { var S = global.SEMANTIC; return l && S && S.normalizeLine ? (S.normalizeLine(l) || l) : l; }

  var TIERS = ["msr", "sr", "dm", "asm", "nsm", "bm"];
  var TIER_NAME = { msr: "Medical Rep", sr: "CHC Sales Rep", dm: "DM / DSM", asm: "ASM", nsm: "NSM", bm: "Brand Manager" };
  var INDIV_DIM = { msr: "rep", sr: "rep", dm: "dm", asm: "am", nsm: "nsm", bm: "bm" };
  var MAXES = {
    msr: [["Sales Achievement", "salesPts", 50], ["Right Frequency", "rfPts", 40], ["Coverage", "covPts", 10]],
    sr: [["Sales Achievement", "salesPts", 60], ["Coverage", "covPts", 40]]
  };

  function kpi(r, key) { var k = (r.kpis || []).filter(function (x) { return x.key === key; })[0]; return k || null; }

  // ---- records ------------------------------------------------------------------------
  function tierRows(a, data, tier) {
    var out = [];
    if (tier === "msr" || tier === "sr") {
      var role = tier === "msr" ? "Medical Rep" : "Sales Rep (CHC)";
      (data.medicalRepSalesRep.ranked || []).filter(function (r) { return r.role === role && a.repInScope(r); }).forEach(function (r) {
        out.push({ tier: tier, r: r, name: r.name, code: r.code, bu: r.bu, line: r.canonLine || canonLine(r.line || r.team), ex: false });
      });
      (data.medicalRepSalesRep.excluded || []).filter(function (e) { return e.role === role && a.excludedInScope(e); }).forEach(function (e) {
        out.push({ tier: tier, r: e, name: e.name, code: e.code, bu: e.bu, line: e.canonLine || canonLine(e.line), ex: true });
      });
    } else {
      var block = tier === "dm" ? data.dmDsm : tier === "asm" ? data.asm : tier === "nsm" ? data.nsm : data.brandManager;
      var scope = (tier === "asm" || tier === "nsm") ? a.asmNsmInScope : a.dmOrBmInScope;
      ((block && block.ranked) || []).filter(scope).forEach(function (r) {
        out.push({ tier: tier, r: r, name: r.name, code: r.code, bu: r.bu, line: canonLine(r.line), ex: false });
      });
      ((block && block.excluded) || []).filter(a.excludedInScope).forEach(function (e) {
        out.push({ tier: tier, r: e, name: e.name, code: e.code, bu: e.bu, line: canonLine(e.line), ex: true });
      });
    }
    return out.filter(function (x) { return L().attributable(x.bu, x.line, x.tier !== "asm" && x.tier !== "nsm"); });
  }

  function keep(x) {
    var needLine = x.tier !== "asm" && x.tier !== "nsm";
    return L().attributable(x.bu, x.line, needLine);
  }
  function live(rows) { return rows.filter(function (x) { return !x.ex; }); }
  function scored(rows) { return live(rows).filter(function (x) { return typeof x.r.totalPts === "number" && !isNaN(x.r.totalPts); }); }
  function mean(rows, f) { return L().mean(rows, f); }

  var M = [
    { id: "sp_points", label: "Zeta Sprint points", unit: "num1", better: "high",
      aliases: ["zeta sprint points", "sprint points", "sprint score", "sprint scores", "zeta sprint score", "zeta sprint", "sprint ranking", "sprint total points", "total sprint points", "points in sprint"],
      def: "The page's total points for the month (out of 100). For a group it is the mean of its members' points; a tier with KPI slots still pending a data feed shows only the points that are live.",
      formula: "mean of each member's totalPts (page-stored)", agg: function (rows) { return mean(scored(rows), function (x) { return x.r.totalPts; }); } },
    { id: "sp_participants", label: "Ranked participants", unit: "count", better: "high",
      aliases: ["sprint participants", "ranked participants", "how many are ranked in sprint", "sprint ranked", "participants in sprint", "sprint headcount"],
      def: "Members with a scored total this month (past probation, active, data present).", formula: "count of members with totalPts",
      agg: function (rows) { return scored(rows).length; } },
    { id: "sp_champions", label: "Corporate Champions", unit: "count", better: "high",
      aliases: ["corporate champions", "sprint champions", "champions", "champion band"],
      def: "Members whose points fall in the page's “Champion” band.", formula: "count of members where band(totalPts) = Champion",
      agg: function (rows, ctx) { var a = ctx.load.api; return scored(rows).filter(function (x) { return a.band(x.r.totalPts) === "Champion"; }).length; } },
    { id: "sp_excluded", label: "Excluded from Sprint", unit: "count", better: "low",
      aliases: ["excluded from sprint", "sprint excluded", "excluded this month sprint", "not eligible for sprint", "sprint exclusions"],
      def: "Members left out of the month's ranking (probation not passed, resigned / inactive, leave band).", formula: "count of excluded-list entries in scope",
      agg: function (rows) { return rows.filter(function (x) { return x.ex; }).length; } },
    { id: "sp_sales_pts", label: "Sprint sales points", unit: "num1", better: "high",
      aliases: ["sprint sales points", "sales points in sprint", "sales achievement points"],
      def: "Points earned on the Sales Achievement KPI (Medical Rep max 50, CHC Sales Rep max 60).", formula: "mean of salesPts", agg: function (rows) { return mean(scored(rows), function (x) { return x.r.salesPts; }); } },
    { id: "sp_rf_pts", label: "Sprint right-frequency points", unit: "num1", better: "high",
      aliases: ["sprint right frequency points", "right frequency points", "rf points"],
      def: "Points earned on Right Frequency (Medical Rep only, max 40).", formula: "mean of rfPts", agg: function (rows) { return mean(scored(rows), function (x) { return x.r.rfPts; }); } },
    { id: "sp_cov_pts", label: "Sprint coverage points", unit: "num1", better: "high",
      aliases: ["sprint coverage points", "coverage points"],
      def: "Points earned on Coverage (Medical Rep max 10, CHC Sales Rep max 40).", formula: "mean of covPts", agg: function (rows) { return mean(scored(rows), function (x) { return x.r.covPts; }); } },
    { id: "sp_ach", label: "Sprint sales achievement %", unit: "pct", better: "high", target100: true,
      aliases: ["sprint sales achievement", "sprint achievement", "sprint achievement percent", "sprint sales achievement percent"],
      def: "Each rep's Sales Achievement % as used by Sprint (their own sales ÷ their own target), averaged over the reps in view.", formula: "mean of each rep's achPct × 100",
      agg: function (rows) { return mean(live(rows), function (x) { return typeof x.r.achPct === "number" ? x.r.achPct * 100 : null; }); } },
    { id: "sp_cov_raw", label: "Sprint coverage %", unit: "pct", better: "high",
      aliases: ["sprint coverage", "sprint coverage percent"],
      def: "Each rep's Coverage % as used by Sprint, averaged over the reps in view.", formula: "mean of coveragePct",
      agg: function (rows) { return mean(live(rows), function (x) { return x.r.coveragePct; }); } },
    { id: "sp_rf_raw", label: "Sprint right frequency %", unit: "pct", better: "high",
      aliases: ["sprint right frequency", "sprint right frequency percent", "sprint rf"],
      def: "Each Medical Rep's Right Frequency % as used by Sprint, averaged over the reps in view.", formula: "mean of rightFreqPct",
      agg: function (rows) { return mean(live(rows), function (x) { return x.r.rightFreqPct; }); } },
    { id: "sp_team_avg", label: "Sprint team-average points", unit: "num1", better: "high",
      aliases: ["sprint team average", "team average points", "team avg points", "team avg sprint"],
      def: "For DM/DSM: the average points of their own reps (weighted 70 of 100). For ASM/NSM: the average of their DM/DSMs (80 of 100).", formula: "mean of teamAvgPts",
      agg: function (rows) { return mean(scored(rows), function (x) { return x.r.teamAvgPts; }); } },
    { id: "sp_fielddays_pts", label: "Sprint field-working-days points", unit: "num1", better: "high",
      aliases: ["sprint field working days points", "sprint field days points"],
      def: "Points on the Field Working Days KPI (DM/DSM max 10; ASM/NSM max 20).", formula: "mean of the fieldDays KPI points",
      agg: function (rows) { return mean(scored(rows), function (x) { var k = kpi(x.r, "fieldDays"); return k ? k.pts : null; }); } },
    { id: "sp_dvcov_pts", label: "Sprint DV-coverage points", unit: "num1", better: "high",
      aliases: ["sprint dv coverage points", "sprint double visit coverage points"],
      def: "Points on the DV Coverage KPI (DM/DSM only, max 10).", formula: "mean of the dvCoverage KPI points",
      agg: function (rows) { return mean(scored(rows), function (x) { var k = kpi(x.r, "dvCoverage"); return k ? k.pts : null; }); } },
    { id: "sp_callsdv_pts", label: "Sprint calls-per-DV points", unit: "num1", better: "high",
      aliases: ["sprint calls per dv points", "calls per dv points", "sprint calls per double visit points"],
      def: "Points on the Calls-per-DV KPI (DM/DSM only, max 10).", formula: "mean of the callsPerDv KPI points",
      agg: function (rows) { return mean(scored(rows), function (x) { var k = kpi(x.r, "callsPerDv"); return k ? k.pts : null; }); } },
    { id: "sp_points_lost", label: "Sprint points lost", unit: "num1", better: "low", kind: "list",
      aliases: ["sprint points lost", "points lost in sprint", "sprint kpi points lost", "which sprint kpi loses the most points", "which kpi loses the most points"],
      def: "Points below each KPI's maximum, by KPI, for the members in view (only KPIs that are live on the page count).", formula: "Σ (KPI max − KPI points earned) per KPI, averaged per member",
      grains: [], agg: null }
  ];

  var DIMS = {
    tier: { label: "Tier", get: function (x) { return TIER_NAME[x.tier]; } },
    bu: { label: "Business Unit", get: function (x) { return x.bu; } },
    line: { label: "Line", get: function (x) { return x.line; } },
    rep: { label: "Representative", get: function (x) { return (x.tier === "msr" || x.tier === "sr") ? x.name : null; } },
    dm: { label: "District Manager", get: function (x) { return x.tier === "dm" ? x.name : null; } },
    am: { label: "Area Manager", get: function (x) { return x.tier === "asm" ? x.name : null; } },
    nsm: { label: "National Sales Manager", get: function (x) { return x.tier === "nsm" ? x.name : null; } },
    bm: { label: "Brand Manager", get: function (x) { return x.tier === "bm" ? x.name : null; } }
  };

  function pickTiers(req) {
    var f = req.filters || {}, g = req.groupBy, pl = req.plan || {}, nq = " " + (pl.nq || "") + " ";
    if (g === "tier") return TIERS.slice();
    if (g === "am" || f.am) return ["asm"];
    if (g === "nsm" || f.nsm) return ["nsm"];
    if (g === "dm" || f.dm) return ["dm"];
    if (g === "bm" || f.bm) return ["bm"];
    if (/ (chc sales reps?|sales reps?|sr) /.test(nq) && !/ medical / .test(nq)) return ["sr"];
    if (/ (medical reps?|msrs?|med reps?) /.test(nq)) return ["msr"];
    if (/ (dsm|dsms|dms?|district (sales )?managers?) /.test(nq)) return ["dm"];
    if (/ (asm|asms|area (sales )?managers?) /.test(nq)) return ["asm"];
    if (/ (nsm|nsms|national sales managers?) /.test(nq)) return ["nsm"];
    if (/ (brand managers?|bms?) /.test(nq)) return ["bm"];
    pushOnce(pl.assumptions, "No tier named — Sprint tiers are scored on different KPIs and maxima, so they are never mixed. Showing Medical Rep (the largest tier); say “DM/DSM”, “ASM”, “NSM”, “CHC sales rep” or “brand manager” for the others.");
    return ["msr"];
  }

  function monthOfKey(a, key) { var m = a.months().filter(function (x) { return x.key === key; })[0]; return m ? m.name : null; }

  function load(req) {
    var a = api();
    if (!a) return { ok: false, missing: "Zeta Sprint is not available to this account, or its cache is missing or stale." };
    var period = req.period || {}, keys = (period.keys || []).filter(Boolean);
    if (!keys.length) keys = [a.liveKey];
    var MULTI = ["quarter", "relquarter", "half", "range", "rolling", "ytd", "all", "year"];
    if (keys.length > 1 || MULTI.indexOf(period.kind) >= 0) return { ok: false, missing: "Zeta Sprint is ranked per calendar month. Its page marks multi-month periods (Q3, Total Year) as “not yet available” because the summing rule has not been defined, so I will not add months together (" + (period.label || keys.join(", ")) + "). Ask for one month." };
    var name = monthOfKey(a, keys[0]);
    if (!name) return { ok: false, missing: "Zeta Sprint holds no ranking for " + (period.label || keys[0]) + "." };
    var data = a.data(name);
    if (!data) return { ok: false, missing: "The archived Sprint month " + name + " has not been loaded yet." };
    var tiers = pickTiers(req), rows = [];
    tiers.forEach(function (t) { tierRows(a, data, t).forEach(function (x) { rows.push(x); }); });
    if (!rows.length) return { ok: false, missing: "Zeta Sprint holds no " + tiers.map(function (t) { return TIER_NAME[t]; }).join(" / ") + " entries in your access for " + name + "." };
    var caveats = [];
    if (tiers.some(function (t) { return t === "dm" || t === "asm" || t === "nsm" || t === "bm"; })) caveats.push("DM/DSM, ASM, NSM and Brand Manager totals include only the KPIs that are live on the page; KPI slots still waiting for a data feed are shown as pending there and are not scored as zero here.");
    if (tiers.indexOf("asm") >= 0 || tiers.indexOf("nsm") >= 0) caveats.push("ASM / NSM are scoped by BU only (their line is a majority-vote of their teams), exactly as on the page.");
    if (tiers.length > 1) caveats.push("Tiers are scored on different KPIs and maxima; points are not directly comparable across tiers.");
    var meta = data.meta || {};
    return { ok: true, rows: rows, api: a, tiers: tiers, month: name, meta: meta, caveats: caveats, asOf: name + " " + String(meta.periodStart || "").slice(0, 4),
             basis: [["Data", "Zeta Sprint cache — " + name + " (" + (meta.periodStart || "?") + " – " + (meta.periodEnd || "?") + "), scoped by the page's own rules"],
                     ["Tier", tiers.map(function (t) { return TIER_NAME[t]; }).join(", ")]],
             formula: "Sprint points = page-stored totalPts (sum of KPI points); group value = mean of members" };
  }

  function vocab() {
    var a = api(); if (!a) return {};
    var data = a.data(a.liveMonth); if (!data) return {};
    var seen = { bu: {}, line: {}, rep: {}, dm: {}, am: {}, nsm: {}, bm: {} };
    TIERS.forEach(function (t) {
      tierRows(a, data, t).forEach(function (x) {
        if (x.bu) seen.bu[x.bu] = 1;
        if (x.line) seen.line[x.line] = 1;
        var d = INDIV_DIM[t];
        if (!x.ex && x.name) seen[d][x.name] = 1;
      });
    });
    var o = {}; Object.keys(seen).forEach(function (k) { o[k] = Object.keys(seen[k]).sort(); }); return o;
  }

  // ---- provider-specific ops ------------------------------------------------------------
  function kpiTable(tier, r) {
    // [label, earned, max, note]
    var rows = [];
    if (tier === "msr" || tier === "sr") {
      MAXES[tier].forEach(function (k) { rows.push([k[0], r[k[1]], k[2], null]); });
    } else {
      if (tier === "dm" || tier === "asm" || tier === "nsm") rows.push(["Team average of " + (r.memberNoun || "team"), r.teamAvgPts, r.teamAvgWeight, null]);
      (r.kpis || []).forEach(function (k) { rows.push([String(k.label || k.key).split(" -- ")[0], k.pts, k.weight, k.pts == null ? "pending data feed" : null]); });
    }
    return rows;
  }
  function rawLine(tier, r) {
    if (tier === "msr") return "Sales achievement " + (r.achPct == null ? "no data" : (r.achPct * 100).toFixed(1) + "%") + " · Right frequency " + (r.rightFreqPct == null ? "no data" : r.rightFreqPct.toFixed(1) + "%") + " · Coverage " + (r.coveragePct == null ? "no data" : r.coveragePct.toFixed(1) + "%");
    if (tier === "sr") return "Sales achievement " + (r.achPct == null ? "no data" : (r.achPct * 100).toFixed(1) + "%") + " · Coverage " + (r.coveragePct == null ? "no data" : r.coveragePct.toFixed(1) + "%");
    return (r.kpis || []).map(function (k) { return String(k.label || k.key).split(" -- ")[0] + " " + (k.raw == null ? "pending" : (k.raw * 100).toFixed(1) + "%"); }).join(" · ");
  }

  function subjectRows(pl, pr) {
    var a = api(); if (!a) return null;
    var keys = pr && pr.primary && pr.primary.keys; var name = monthOfKey(a, (keys && keys[0]) || a.liveKey);
    var data = name ? a.data(name) : null; if (!data) return null;
    var req = { filters: pl.filters || {}, groupBy: null, plan: pl };
    var tiers = pickTiers(req), rows = [];
    tiers.forEach(function (t) { tierRows(a, data, t).forEach(function (x) { rows.push(x); }); });
    var f = pl.filters || {};
    ["bu", "line", "rep", "dm", "am", "nsm", "bm"].forEach(function (k) { if (f[k]) rows = rows.filter(function (x) { return L().same(DIMS[k].get(x), f[k]); }); });
    return { rows: rows, month: name, tiers: tiers, meta: data.meta || {} };
  }

  function whyOne(pl, pr) {
    var f = pl.filters || {};
    if (!(f.rep || f.dm || f.am || f.nsm || f.bm)) return null;
    var s = subjectRows(pl, pr); if (!s) return { ok: false, missing: "Zeta Sprint is not available to this account, or that month is not loaded." };
    var one = s.rows.filter(function (x) { return !x.ex; })[0];
    if (!one) {
      var ex = s.rows[0];
      if (ex) return { ok: true, headline: ex.name + " is not scored in " + s.month, detail: "Excluded: " + (ex.r.reason || "no reason recorded") + (ex.r.detail ? " — " + ex.r.detail : "") + ".",
        evidence: [["Source", "Sprint excluded list (" + s.month + ")"]], measureIds: ["sp_points"], formula: "Excluded members have no Sprint total" };
      return { ok: false, missing: "No Sprint record for that name in " + s.month + " within your access." };
    }
    var r = one.r, tier = one.tier, t = kpiTable(tier, r);
    var rows = t.map(function (k, i) { var lost = (typeof k[1] === "number") ? (k[2] - k[1]) : null; return { rank: i + 1, name: k[0], cells: [k[1] == null ? "—" : k[1].toFixed(1) + " / " + k[2], lost == null ? (k[3] || "—") : lost.toFixed(1)] }; });
    var lostRows = t.filter(function (k) { return typeof k[1] === "number"; }).sort(function (a, b) { return (b[2] - b[1]) - (a[2] - a[1]); });
    var big = lostRows[0];
    return {
      ok: true, headline: one.name + " scored " + (typeof r.totalPts === "number" ? r.totalPts.toFixed(1) : "—") + " points in " + s.month + " (" + TIER_NAME[tier] + ")",
      detail: (big ? "The largest points loss is " + big[0] + " (" + (big[2] - big[1]).toFixed(1) + " of " + big[2] + " points). " : "") + rawLine(tier, r) + ".",
      rows: rows, columns: ["Points earned / max", "Points lost"], nameHeader: "KPI",
      formula: "totalPts = Σ KPI points (page-stored); each KPI's points come from the page's own scoring curve",
      evidence: [["Record", one.name + " · " + TIER_NAME[tier] + (r.code ? " · code " + r.code : "")], ["Period", s.month], ["Underlying values", rawLine(tier, r)],
                 ["Team", r.teamSize != null ? r.teamSize + " " + (r.memberNoun || "member") + (r.teamSize === 1 ? "" : "s") : "—"]],
      measureIds: ["sp_points"],
      caveats: ["Points are the page's stored values; the scoring curve and floors are applied by the Sprint build, not re-derived here.", "This shows where the points were lost. It does not explain why the underlying KPI value was low."],
      drill: r.teamMembers && r.teamMembers.length ? [{ label: "Show the team behind it", question: "show the underlying reps of " + one.name }] : []
    };
  }

  function driversOp(pl, pr) {
    var s = subjectRows(pl, pr); if (!s) return { ok: false, missing: "Zeta Sprint is not available to this account, or that month is not loaded." };
    var live0 = s.rows.filter(function (x) { return !x.ex && typeof x.r.totalPts === "number"; });
    if (!live0.length) return { ok: false, missing: "No scored Sprint members for that cut in " + s.month + "." };
    if (s.tiers.length !== 1) return { ok: false, missing: "Points lost by KPI is per tier; name one tier." };
    var tier = s.tiers[0], acc = {}, order = [];
    live0.forEach(function (x) {
      kpiTable(tier, x.r).forEach(function (k) {
        if (typeof k[1] !== "number") return;
        var a = acc[k[0]] || (acc[k[0]] = { max: k[2], earned: 0, n: 0 }); if (!acc[k[0]].seen) { acc[k[0]].seen = 1; order.push(k[0]); }
        a.earned += k[1]; a.n++;
      });
    });
    var tbl = order.map(function (k) { var a = acc[k]; return { k: k, max: a.max, avg: a.earned / a.n, lost: a.max - a.earned / a.n }; }).sort(function (x, y) { return y.lost - x.lost; });
    var totalLost = tbl.reduce(function (t, x) { return t + x.lost; }, 0);
    var scope = (pl.filters && (pl.filters.line || pl.filters.bu)) || "your scope";
    return {
      ok: true, headline: tbl[0].k + " loses the most Sprint points for " + TIER_NAME[tier] + " (" + scope + "): " + tbl[0].lost.toFixed(1) + " of " + tbl[0].max + " per member",
      detail: live0.length + " scored " + TIER_NAME[tier] + " member" + (live0.length === 1 ? "" : "s") + " · " + s.month + ". Only KPIs that are live on the page are counted.",
      rows: tbl.map(function (x, i) { return { rank: i + 1, name: x.k, cells: [x.max.toFixed(0), x.avg.toFixed(1), x.lost.toFixed(1), totalLost > 0 ? (x.lost / totalLost * 100).toFixed(1) + "%" : "—"] }; }),
      columns: ["Max points", "Avg earned", "Avg lost", "Share of points lost"], nameHeader: "KPI",
      formula: "points lost per KPI = KPI max − mean points earned across members in view",
      evidence: [["Period", s.month], ["Members", String(live0.length)], ["Source", "Zeta Sprint cache, scoped by the page's own rules"]],
      measureIds: ["sp_points"], caveats: ["Where the page shows a KPI as pending a data feed it is left out, not counted as fully lost."],
      drill: [{ label: "Points by line", question: "sprint points by line" }]
    };
  }

  var ops = {
    why: function (pl, pr) { return whyOne(pl, pr) || driversOp(pl, pr); },
    evidence: function (pl, pr) {
      var f = pl.filters || {};
      if (f.rep || f.dm || f.am || f.nsm || f.bm) {
        var one = whyOne(pl, pr);
        if (one && one.ok) {
          // add the team roster the page lists in its drill-down
          var s = subjectRows(pl, pr), rec = s && s.rows.filter(function (x) { return !x.ex; })[0];
          if (rec && rec.r.teamMembers && rec.r.teamMembers.length) {
            one.evidence.push(["Team members (page drill-down)", rec.r.teamMembers.slice(0, 15).map(function (t) { return t.name + " " + (typeof t.totalPts === "number" ? t.totalPts.toFixed(1) : "—"); }).join(" · ") + (rec.r.teamMembers.length > 15 ? " … +" + (rec.r.teamMembers.length - 15) + " more" : "")]);
          }
        }
        return one;
      }
      return driversOp(pl, pr);
    },
    drivers: function (pl, pr) { return driversOp(pl, pr); },
    list: function (pl, pr) { return driversOp(pl, pr); }
  };

  var provider = L().make({
    id: "sprint", label: "Zeta Sprint 2026", tabs: ["sprint"], domains: ["sprint"],
    defaultMeasure: "sp_points", rankMeasure: "sp_points",
    canUse: function () { return !!(SP() && SP().canView && SP().canView() && SP().askApi); },
    measures: M, dims: DIMS, hierarchy: { tier: "bu", bu: "line", line: "rep" }, ladder: ["bu", "line", "rep"],
    load: load, vocab: vocab, ops: ops,
    defaultGroup: function (pl) {
      if (pl.intent !== "rank" && !pl.who) return null;
      var tiers = pickTiers({ filters: pl.filters || {}, groupBy: null, plan: pl });
      return INDIV_DIM[tiers[0]];
    },
    availability: function () { var a = api(); return { name: "Zeta Sprint", months: a ? a.months().map(function (m) { return m.key; }) : [] }; },
    sourceNote: function () { return "Zeta Sprint cache · monthly ranking"; },
    ensureAsync: function (pl) {
      var a = api(); if (!a) return Promise.resolve(false);
      return a.ensureIndex().then(function () {
        var av = { name: "Zeta Sprint", months: a.months().map(function (m) { return m.key; }) };
        var ti = P().interpret(pl.q, av), keys = {};
        [ti.primary, ti.secondary].forEach(function (p) { if (p && p.keys && p.keys.length === 1) keys[p.keys[0]] = 1; });
        var jobs = Object.keys(keys).map(function (k) { var n = monthOfKey(a, k); return n && !a.data(n) ? a.ensure(n) : Promise.resolve(true); });
        return Promise.all(jobs).then(function () { return true; });
      }).catch(function () { return false; });
    }
  });
  global.AskProvSprint = { provider: provider };
})(typeof window !== "undefined" ? window : this);
