/**
 * js/executive.js
 * =====================================================================
 * Executive Command Center -- PHASE 1: Executive KPI Section
 * (2026-07-27 rebuild -- replaces the earlier 16-section Business Review
 * workspace entirely; that framework is not part of this spec).
 *
 * PURPOSE (per 2026-07-27 brief): this is the platform's default landing
 * page. Not a dashboard -- a page that answers, within 10 seconds, how
 * the business is performing, which BU needs attention, where the
 * opportunities/risks are, and where to drill next. Phase 1 ships ONLY
 * the 9 Executive KPI cards + global filter bar; no AI narrative, no
 * additional charts, per the brief.
 *
 * ARCHITECTURE RULE (unchanged from the prior build): this module reads
 * ONLY through each source module's public interface (SalesDashboard,
 * CoverageDashboard, SFEDashboard, IQVIADashboard) plus SEMANTIC. It
 * never touches window.SALES_CACHE / window.DASHBOARD_CACHE / `flat` /
 * any other module-internal state directly, and never duplicates a
 * calculation another module already owns.
 *
 * KPI 6 (Customer Dynamics) and KPI 7 (SKU Penetration) are DEFERRED
 * (2026-07-27 decision) -- the sales cache doesn't yet carry customer x
 * type or customer x product granularity; refresh_sales.py needs an ETL
 * update + re-run before those two can be built for real. The other 9
 * ship now.
 *
 * DESIGN DECISIONS made explicit here (documented, not silent, so they
 * can be corrected on request):
 *   - BU filter has no "All" option. Every KPI's Ranking section must
 *     show "#N of 4 Business Units" (per spec) which only makes sense
 *     framed around ONE selected BU -- so the filter is CHC/Cluster/
 *     DIAB/GIT, default CHC, exactly like the platform's prior
 *     single-BU review pattern the user already approved.
 *   - Line filter is dependent on BU (populated from that BU's own
 *     lines) and, where the underlying interface supports it (Coverage,
 *     Sales), re-scopes the card to that line and re-frames the Ranking
 *     section as "#N of <lines> Lines within <BU>" instead of "of 4
 *     Business Units". Sales Force Health / Market Share / BU Growth
 *     don't have a line-level breakdown built yet -- those 3 cards stay
 *     BU-level regardless of the Line filter, with a small caption.
 *   - Comparison Period: YTD only for Phase 1 (per 2026-07-27 decision)
 *     -- the selector exists and is wired for future options, but only
 *     one is offered today.
 *   - Period: every source interface here is already fixed to "latest
 *     period" / "YTD across all months in cache" -- there is no
 *     historical period-by-period recompute built anywhere in the
 *     platform. The Period selector reflects that honestly (one option,
 *     "Latest Period") rather than pretending to support arbitrary
 *     historical periods it can't actually deliver.
 *   - CHC has TWO real lines (corrected 2026-07-27, user correction,
 *     reversing an earlier same-day dedup decision): "CHC" (standard
 *     Medical Representative / Contract-Doctor-Hospital channel) and
 *     "CHC_SALES" (a distinct Pharmacy-facing / Sales Representative
 *     channel). Both appear as separate Line filter options and
 *     separate Line Performance rows for CHC; Sales never tags anything
 *     plain "CHC" (100% of its CHC transactions are "CHC_SALES"), so the
 *     plain "CHC" line's Sales-derived fields are correctly null. See
 *     CANONICAL_LINE_TO_BU / getFilteredCoverageForLine() in
 *     semantic-model.js / coverage-interface.js for the full mechanics,
 *     and PLATFORM_ROADMAP.md's "CHC de-dup reversed" section for the
 *     validated numbers.
 * =====================================================================
 */

(function (global) {
  "use strict";

  // ---------------------------------------------------------------------
  // Safe cross-module calls -- same defensive contract as the rest of
  // the platform: never throw into the caller, always return a
  // recognizable {ok:false, status:...} shape on failure.
  // ---------------------------------------------------------------------
  function safeCall(moduleName, globalName, methodName) {
    const args = Array.prototype.slice.call(arguments, 3);
    try {
      const mod = global[globalName];
      if (!mod || typeof mod[methodName] !== "function") {
        return { ok: false, status: "module_unavailable" };
      }
      return mod[methodName].apply(mod, args);
    } catch (e) {
      console.error("[Executive] " + methodName + "() failed for " + moduleName, e);
      return { ok: false, status: "error" };
    }
  }

  function collectSummaries() {
    return {
      sales: safeCall("sales", "SalesDashboard", "getBusinessSummary"),
      coverage: safeCall("coverage", "CoverageDashboard", "getBusinessSummary"),
      sfe: safeCall("sfe", "SFEDashboard", "getBusinessSummary"),
      iqvia: safeCall("iqvia", "IQVIADashboard", "getBusinessSummary"),
    };
  }

  // ---------------------------------------------------------------------
  // Generic helpers: ranking, status, trend, formatting.
  // ---------------------------------------------------------------------

  // valuesByKey: { key: number|null }. direction: "desc" (higher better,
  // default) or "asc" (lower better, e.g. vacancy rate). Keys with a
  // null/undefined value are excluded from the ranking entirely (both
  // from getting a rank AND from the "of N" denominator).
  function rank(valuesByKey, direction) {
    const keys = Object.keys(valuesByKey).filter(k => valuesByKey[k] !== null && valuesByKey[k] !== undefined && !isNaN(valuesByKey[k]));
    const sorted = keys.slice().sort((a, b) => direction === "asc" ? valuesByKey[a] - valuesByKey[b] : valuesByKey[b] - valuesByKey[a]);
    const out = {};
    sorted.forEach((k, i) => { out[k] = { rank: i + 1, of: sorted.length }; });
    return out;
  }

  // Achievement-style status thresholds -- one consistent scale reused
  // by every KPI whose "Performance" section has a genuine Achievement %
  // (Coverage/RF/Sales Achievement/Market Share/Sales Force fill rate/
  // Sales Productivity vs benchmark). Documented assumption, not a
  // fitted model -- adjustable on request.
  function statusFromAchievement(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return null;
    if (pct >= 100) return "Excellent";
    if (pct >= 90) return "On Track";
    if (pct >= 75) return "At Risk";
    return "Critical";
  }

  function trendFromDelta(delta, eps) {
    if (delta === null || delta === undefined || isNaN(delta)) return null;
    eps = eps === undefined ? 0.5 : eps;
    if (delta > eps) return "up";
    if (delta < -eps) return "down";
    return "flat";
  }

  function fmtPct1(v) { return (v === null || v === undefined || isNaN(v)) ? "N/A" : v.toFixed(1) + "%"; }
  function fmtSignedPts(v) { return (v === null || v === undefined || isNaN(v)) ? "N/A" : (v >= 0 ? "+" : "") + v.toFixed(1) + " pts"; }
  function fmtSignedPct(v) { return (v === null || v === undefined || isNaN(v)) ? "N/A" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%"; }
  function fmtM(v) { return (v === null || v === undefined || isNaN(v)) ? "N/A" : "EGP " + (v / 1e6).toFixed(1) + "M"; }
  function fmtSignedM(v) { return (v === null || v === undefined || isNaN(v)) ? "N/A" : (v >= 0 ? "+" : "") + "EGP " + (v / 1e6).toFixed(1) + "M"; }
  function fmtInt(v) { return (v === null || v === undefined || isNaN(v)) ? "N/A" : Math.round(v).toLocaleString(); }
  function escapeAttr(s) { return String(s === null || s === undefined ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;"); }

  function unavailableCard(kpiId, name, reason) {
    return {
      kpiId: kpiId, name: name,
      mainValue: "N/A", mainValueSub: "Data unavailable (" + (reason || "module_unavailable") + ")",
      performance: null, comparison: null, rank: null, rankOf: null, rankUnit: null,
      status: null, trend: null, trendLabel: null, clickable: false, dblClickable: false,
    };
  }

  // ---------------------------------------------------------------------
  // Filter state + BU line lists.
  // ---------------------------------------------------------------------
  let _filters = { bu: "CHC", line: "All" };
  let _container = null;

  function linesForBU(bu) {
    // Canonical line list for this BU, derived from Coverage's own line
    // breakdown (already dedupes nothing -- callers that need the
    // canonical/deduped view apply SEMANTIC.normalizeLine() themselves).
    const data = safeCall("coverage", "CoverageDashboard", "getLineAndTerritoryBreakdown", bu);
    if (!data || !data.ok) return [];
    const seen = new Set();
    const out = [];
    data.lines.forEach(l => {
      const canon = global.SEMANTIC.normalizeLine(l.name);
      if (!seen.has(canon)) { seen.add(canon); out.push(canon); }
    });
    return out;
  }

  // ---------------------------------------------------------------------
  // KPI 1 & 2 -- Operational Coverage / Right Frequency
  // Source: Coverage. Same filtered population (Title=Medical
  // Representative, Experience=Non-Probation, Status=Active, Type in
  // {Contract, Doctor, Hospital}) for both, just a different metric.
  // ---------------------------------------------------------------------
  function buildCoverageFamilyCard(kpiId, name, metricKey, target, filters) {
    const bu = filters.bu, line = filters.line;
    const scoped = safeCall("coverage", "CoverageDashboard", "getFilteredCoverageForLine", bu, line === "All" ? null : line);
    if (!scoped || !scoped.ok) return unavailableCard(kpiId, name, scoped ? scoped.status : "module_unavailable");

    const mainVal = scoped[metricKey];
    const achievementPct = mainVal !== null ? (mainVal / target) * 100 : null;
    const variance = mainVal !== null ? mainVal - target : null;

    let rankInfo, rankUnit;
    if (line === "All") {
      const vals = {};
      global.SEMANTIC.BU_LIST.forEach(b => {
        const r = safeCall("coverage", "CoverageDashboard", "getFilteredCoverageForLine", b, null);
        vals[b] = (r && r.ok) ? r[metricKey] : null;
      });
      rankInfo = rank(vals, "desc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = linesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const r = safeCall("coverage", "CoverageDashboard", "getFilteredCoverageForLine", bu, l);
        vals[l] = (r && r.ok) ? r[metricKey] : null;
      });
      rankInfo = rank(vals, "desc")[line];
      rankUnit = "Lines within " + bu;
    }

    return {
      kpiId: kpiId, name: name,
      mainValue: fmtPct1(mainVal), mainValueSub: "Current YTD" + (line !== "All" ? " · " + line : ""),
      performance: { target: target + "%", achievementPct: fmtPct1(achievementPct), variance: fmtSignedPts(variance) },
      comparison: null,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: rankUnit,
      status: statusFromAchievement(achievementPct),
      trend: null, trendLabel: "Trend not yet available (single-period snapshot)",
      clickable: true, dblClickable: true,
    };
  }

  // ---------------------------------------------------------------------
  // KPI 3 -- Sales Force Health
  // Source: Organogram/SFE. No published headcount target exists on the
  // platform, so "Performance" is framed against the only defensible
  // implicit target -- 100% filled (0% vacancy) -- documented, not
  // silently invented.
  // ---------------------------------------------------------------------
  function buildSFECard(summaries, filters) {
    const bu = filters.bu;
    if (!summaries.sfe || !summaries.sfe.ok || !summaries.sfe.bu[bu]) {
      return unavailableCard("sfe", "Sales Force Health", summaries.sfe ? summaries.sfe.status : "module_unavailable");
    }
    const a = summaries.sfe.bu[bu];
    const fillRatePct = a.vacancyRatePct !== null ? 100 - a.vacancyRatePct : null;

    const vals = {};
    global.SEMANTIC.BU_LIST.forEach(b => {
      const s = summaries.sfe.bu[b];
      vals[b] = s && s.vacancyRatePct !== null ? s.vacancyRatePct : null;
    });
    const rankInfo = rank(vals, "asc")[bu]; // lower vacancy = better = rank 1

    return {
      kpiId: "sfe", name: "Sales Force Health",
      mainValue: fmtInt(a.headcountTotal), mainValueSub: "Total Manpower · Active " + fmtInt(a.headcountActive) + " · Vacant " + fmtInt(a.headcountVacant),
      performance: { target: "100% Filled", achievementPct: fmtPct1(fillRatePct), variance: fmtSignedPts(a.vacancyRatePct !== null ? -a.vacancyRatePct : null) + " vacancy" },
      comparison: null,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: "Business Units",
      status: statusFromAchievement(fillRatePct),
      trend: null, trendLabel: "Point-in-time headcount snapshot (organogram.json is not period-stamped)",
      clickable: true, dblClickable: true,
    };
  }

  // ---------------------------------------------------------------------
  // KPI 5 -- Sales Achievement
  // Source: Sales, Non-Tender transactions only, Value basis.
  //
  // CORRECTED 2026-07-27 (user: "make right calculation for sales
  // achievement"): now reads SalesDashboard.getSalesAchievementSummary(),
  // the SAME Non-Tender definition already used by Brand Portfolio
  // Health (getBrandAchievement), the Sales Value card, and the Line
  // Performance table (getLineSalesSummary) -- previously this card was
  // the one outlier still reading getBusinessSummary()'s all-transaction
  // figure, which included Tender business and didn't reconcile with
  // every other Achievement-basis number on the platform. If a number
  // INCLUDING Tender is ever needed again, getBusinessSummary()'s
  // achievementPct is still there and unchanged -- it's just no longer
  // what "Sales Achievement" means on this page.
  // ---------------------------------------------------------------------
  function buildSalesAchievementCard(filters) {
    const bu = filters.bu, line = filters.line;
    const scoped = safeCall("sales", "SalesDashboard", "getSalesAchievementSummary", bu, line === "All" ? null : line);
    if (!scoped || !scoped.ok) return unavailableCard("salesAchievement", "Sales Achievement", scoped ? scoped.status : "module_unavailable");

    let rankInfo, rankUnit;
    if (line === "All") {
      const vals = {};
      global.SEMANTIC.BU_LIST.forEach(b => {
        const s = safeCall("sales", "SalesDashboard", "getSalesAchievementSummary", b, null);
        vals[b] = (s && s.ok) ? s.achievementPct : null;
      });
      rankInfo = rank(vals, "desc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = linesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const s = safeCall("sales", "SalesDashboard", "getSalesAchievementSummary", bu, l);
        vals[l] = (s && s.ok) ? s.achievementPct : null;
      });
      rankInfo = rank(vals, "desc")[line];
      rankUnit = "Lines within " + bu;
    }

    return {
      kpiId: "salesAchievement", name: "Sales Achievement",
      mainValue: fmtPct1(scoped.achievementPct), mainValueSub: "Non-Tender · Current YTD" + (line !== "All" ? " · " + line : ""),
      performance: { target: fmtM(scoped.targetYTD), achievementPct: fmtPct1(scoped.achievementPct), variance: fmtSignedM(scoped.actualYTD - scoped.targetYTD) },
      comparison: null,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: rankUnit,
      status: statusFromAchievement(scoped.achievementPct),
      trend: trendFromDelta(scoped.momGrowthPct, 1),
      trendLabel: scoped.momGrowthPct !== null ? "MoM " + fmtSignedPct(scoped.momGrowthPct) : "MoM trend unavailable",
      clickable: true, dblClickable: true,
    };
  }

  // ---------------------------------------------------------------------
  // KPI -- Sales Value (2026-07-27 addition)
  // Source: Sales, Non-Tender transactions only -- a deliberately
  // DIFFERENT basis from Sales Achievement above (which uses
  // getBusinessSummary()'s all-transaction figure). Non-Tender business
  // behaves differently commercially (pricing/margin/predictability), so
  // this is its own card with its own Achievement %, not a duplicate.
  // Built by summing getBrandAchievement()'s per-brand rows -- that
  // interface is ALREADY the Non-Tender, BU/line-scoped, per-brand truth
  // (built 2026-07-26 for Brand Portfolio Health); summing its brands
  // gives the exact BU-level Non-Tender total with no separate
  // calculation to maintain or drift out of sync.
  // ---------------------------------------------------------------------
  function nonTenderTotals(bu, line) {
    const data = safeCall("sales", "SalesDashboard", "getBrandAchievement", bu, line && line !== "All" ? line : null);
    if (!data || !data.ok) return null;
    let actualValue = 0, targetValue = 0;
    data.brands.forEach(b => { actualValue += b.actualValue; targetValue += b.targetValue; });
    return { actualValue: actualValue, targetValue: targetValue, achievementPct: targetValue > 0 ? (actualValue / targetValue) * 100 : null };
  }

  function buildSalesValueCard(filters) {
    const bu = filters.bu, line = filters.line;
    const t = nonTenderTotals(bu, line);
    if (!t) return unavailableCard("salesValue", "Sales Value", "module_unavailable");

    let rankInfo, rankUnit;
    if (line === "All") {
      const vals = {};
      global.SEMANTIC.BU_LIST.forEach(b => {
        const bt = nonTenderTotals(b, "All");
        vals[b] = bt ? bt.achievementPct : null;
      });
      rankInfo = rank(vals, "desc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = linesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const lt = nonTenderTotals(bu, l);
        vals[l] = lt ? lt.achievementPct : null;
      });
      rankInfo = rank(vals, "desc")[line];
      rankUnit = "Lines within " + bu;
    }

    return {
      kpiId: "salesValue", name: "Sales Value",
      mainValue: fmtM(t.actualValue), mainValueSub: "Non-Tender · Current YTD" + (line !== "All" ? " · " + line : ""),
      performance: { target: fmtM(t.targetValue), achievementPct: fmtPct1(t.achievementPct), variance: fmtSignedM(t.actualValue - t.targetValue) },
      comparison: null,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: rankUnit,
      status: statusFromAchievement(t.achievementPct),
      trend: null, trendLabel: null,
      clickable: true, dblClickable: true,
    };
  }

  // ---------------------------------------------------------------------
  // Customer Channel Mix (2026-07-28) -- revives the spirit of the
  // deferred KPI 6 (Customer Dynamics) at the granularity the Sales
  // cache actually supports today: it has no individual customer name
  // or ID at the transaction level, only the `sub_types` lookup (a mix
  // of named pharmacy/institution accounts and generic trade-channel
  // labels), grouped into commercial clusters via
  // SalesDashboard.getCustomerClusterMix() (see SUBTYPE_TO_CLUSTER in
  // js/sales.js for the mapping, jointly defined with the business
  // owner in sales_subtypes.xlsx). True per-doctor/per-pharmacy
  // granularity would need an ETL enhancement -- same constraint that
  // deferred KPI 6 originally.
  //
  // Headline metric is channel CONCENTRATION (the top cluster's share
  // of Non-Tender value), not achievement-vs-target -- there's no
  // target for a customer-mix metric, so the card's Performance section
  // is intentionally omitted rather than forcing a fake Target/
  // Achievement/Variance framing onto a distribution metric.
  //
  // Ranking is by concentration ASCENDING (lower = more diversified
  // customer base = better, rank #1) -- a documented judgment call: a
  // BU overly reliant on one channel carries more channel risk than one
  // spread more evenly, regardless of which channel happens to lead.
  // Status thresholds are similarly a documented assumption (adjustable
  // on request): <25% Excellent, 25-40% On Track, 40-55% At Risk, >=55%
  // Critical concentration risk.
  // ---------------------------------------------------------------------
  function buildCustomerClusterMixCard(filters) {
    const bu = filters.bu, line = filters.line;
    const data = safeCall("sales", "SalesDashboard", "getCustomerClusterMix", bu, line === "All" ? null : line);
    if (!data || !data.ok || !data.clusters.length) return unavailableCard("customerClusterMix", "Customer Channel Mix", data ? data.status : "module_unavailable");

    const top = data.clusters[0]; // already sorted desc by actualValue in sales.js
    const concentrationPct = top.contributionPct;

    function statusFromConcentration(pct) {
      if (pct === null || pct === undefined || isNaN(pct)) return null;
      if (pct < 25) return "Excellent";
      if (pct < 40) return "On Track";
      if (pct < 55) return "At Risk";
      return "Critical";
    }

    let rankInfo, rankUnit;
    if (line === "All") {
      const vals = {};
      global.SEMANTIC.BU_LIST.forEach(b => {
        const bd = safeCall("sales", "SalesDashboard", "getCustomerClusterMix", b, null);
        vals[b] = (bd && bd.ok && bd.clusters.length) ? bd.clusters[0].contributionPct : null;
      });
      rankInfo = rank(vals, "asc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = linesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const ld = safeCall("sales", "SalesDashboard", "getCustomerClusterMix", bu, l);
        vals[l] = (ld && ld.ok && ld.clusters.length) ? ld.clusters[0].contributionPct : null;
      });
      rankInfo = rank(vals, "asc")[line];
      rankUnit = "Lines within " + bu;
    }

    return {
      kpiId: "customerClusterMix", name: "Customer Channel Mix",
      mainValue: fmtPct1(concentrationPct), mainValueSub: "Top Channel: " + top.name + " · Non-Tender YTD" + (line !== "All" ? " · " + line : ""),
      performance: null,
      comparison: null,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: rankUnit,
      status: statusFromConcentration(concentrationPct),
      trend: null, trendLabel: null,
      clickable: true, dblClickable: false,
    };
  }

  // ---------------------------------------------------------------------
  // KPI 8 -- Market Share
  // Source: IQVIA (getDM1DM2MarketIntel -- already excludes Other
  // Markets by construction). YTD, SU basis. Headline = simple average
  // of DM1 and DM2's blended share/target/achievement (documented
  // approximation, same convention as the platform's prior Total
  // Portfolio cards); "vs DM1"/"vs DM2" comparison section shows each
  // market definition individually.
  // ---------------------------------------------------------------------
  function buildMarketShareCard(filters) {
    const bu = filters.bu;
    const dm1dm2 = safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", bu);
    if (!dm1dm2 || !dm1dm2.ok || !dm1dm2.total) {
      const reason = dm1dm2 ? dm1dm2.status : "module_unavailable";
      const card = unavailableCard("marketShare", "Market Share", reason);
      card.mainValueSub = reason === "auth_required" ? "Sign in to the Market Intelligence workspace" : card.mainValueSub;
      return card;
    }
    const d1 = dm1dm2.total.dm1.ytd.su, d2 = dm1dm2.total.dm2.ytd.su;
    const avg = (a, b) => (a != null && b != null) ? (a + b) / 2 : (a != null ? a : b);
    const sharePct = avg(d1.sharePct, d2.sharePct);
    const targetPct = avg(d1.blendedTargetPct, d2.blendedTargetPct);
    const achievementPct = avg(d1.achievementPct, d2.achievementPct);
    const gapPts = (sharePct != null && targetPct != null) ? sharePct - targetPct : null;
    const evi = avg(d1.evi, d2.evi);

    const vals = {};
    global.SEMANTIC.BU_LIST.forEach(b => {
      const bd1d2 = b === bu ? dm1dm2 : safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", b);
      if (bd1d2 && bd1d2.ok && bd1d2.total) {
        vals[b] = avg(bd1d2.total.dm1.ytd.su.sharePct, bd1d2.total.dm2.ytd.su.sharePct);
      } else {
        vals[b] = null;
      }
    });
    const rankInfo = rank(vals, "desc")[bu];

    return {
      kpiId: "marketShare", name: "Market Share",
      mainValue: fmtPct1(sharePct), mainValueSub: "YTD · SU basis · excl. Other Markets",
      performance: { target: fmtPct1(targetPct), achievementPct: fmtPct1(achievementPct), variance: fmtSignedPts(gapPts) },
      comparison: { dm1: fmtPct1(d1.sharePct), dm2: fmtPct1(d2.sharePct) },
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: "Business Units",
      status: statusFromAchievement(achievementPct),
      trend: evi !== null ? (evi >= 100 ? "up" : "down") : null,
      trendLabel: evi !== null ? "EI Index " + Math.round(evi) : "EI Index unavailable",
      clickable: true, dblClickable: true,
    };
  }

  // ---------------------------------------------------------------------
  // KPI 9 -- Business Unit Growth
  // Source: IQVIA, YTD, SU basis for the headline (comparison section
  // folds in the Value basis too, per "EI ytd su and value").
  // ---------------------------------------------------------------------
  function buildBUGrowthCard(filters) {
    const bu = filters.bu;
    const dm1dm2 = safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", bu);
    if (!dm1dm2 || !dm1dm2.ok || !dm1dm2.total) {
      const reason = dm1dm2 ? dm1dm2.status : "module_unavailable";
      const card = unavailableCard("buGrowth", "Business Unit Growth", reason);
      card.mainValueSub = reason === "auth_required" ? "Sign in to the Market Intelligence workspace" : card.mainValueSub;
      return card;
    }
    const avg = (a, b) => (a != null && b != null) ? (a + b) / 2 : (a != null ? a : b);
    const d1su = dm1dm2.total.dm1.ytd.su, d2su = dm1dm2.total.dm2.ytd.su;
    const d1val = dm1dm2.total.dm1.ytd.value, d2val = dm1dm2.total.dm2.ytd.value;
    const zetaGrowth = avg(d1su.zetaGrowthPct, d2su.zetaGrowthPct);
    const marketGrowth = avg(d1su.marketGrowthPct, d2su.marketGrowthPct);
    const growthGap = (zetaGrowth != null && marketGrowth != null) ? zetaGrowth - marketGrowth : null;
    const evi = avg(d1su.evi, d2su.evi);
    const zetaGrowthVal = avg(d1val.zetaGrowthPct, d2val.zetaGrowthPct);

    const vals = {};
    global.SEMANTIC.BU_LIST.forEach(b => {
      const bd1d2 = b === bu ? dm1dm2 : safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", b);
      if (bd1d2 && bd1d2.ok && bd1d2.total) {
        const bz = avg(bd1d2.total.dm1.ytd.su.zetaGrowthPct, bd1d2.total.dm2.ytd.su.zetaGrowthPct);
        const bm = avg(bd1d2.total.dm1.ytd.su.marketGrowthPct, bd1d2.total.dm2.ytd.su.marketGrowthPct);
        vals[b] = (bz != null && bm != null) ? bz - bm : null;
      } else {
        vals[b] = null;
      }
    });
    const rankInfo = rank(vals, "desc")[bu];

    return {
      kpiId: "buGrowth", name: "Business Unit Growth",
      mainValue: fmtSignedPct(zetaGrowth), mainValueSub: "Zeta Growth · YTD SU (Value basis: " + fmtSignedPct(zetaGrowthVal) + ")",
      performance: { target: "Market " + fmtSignedPct(marketGrowth), achievementPct: fmtPct1(evi), variance: fmtSignedPts(growthGap) + " gap" },
      comparison: { dm1: "SU " + fmtSignedPct(d1su.zetaGrowthPct) + " · Val " + fmtSignedPct(d1val.zetaGrowthPct), dm2: "SU " + fmtSignedPct(d2su.zetaGrowthPct) + " · Val " + fmtSignedPct(d2val.zetaGrowthPct) },
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: "Business Units",
      status: statusFromAchievement(evi),
      trend: evi !== null ? (evi >= 100 ? "up" : "down") : null,
      trendLabel: evi !== null ? "EI Index " + Math.round(evi) : "EI Index unavailable",
      clickable: false, dblClickable: true,
    };
  }

  // ---------------------------------------------------------------------
  // KPI 10 -- Sales Productivity
  // Composed at this layer (not duplicated in Sales or SFE): Sales'
  // actualYTD (EGP) / SFE's headcountActive (real reps), platform-wide
  // average as the benchmark -- exactly the "platform average" pattern
  // already established for Workload % elsewhere on this platform.
  // ---------------------------------------------------------------------
  function buildSalesProductivityCard(summaries, filters) {
    const bu = filters.bu;
    if (!summaries.sales || !summaries.sales.ok || !summaries.sfe || !summaries.sfe.ok) {
      return unavailableCard("salesProductivity", "Sales Productivity", "module_unavailable");
    }
    const perBU = {};
    let platformActual = 0, platformHeads = 0;
    global.SEMANTIC.BU_LIST.forEach(b => {
      const s = summaries.sales.bu[b], h = summaries.sfe.bu[b];
      if (s && h && h.headcountActive > 0) {
        perBU[b] = s.actualYTD / h.headcountActive;
        platformActual += s.actualYTD; platformHeads += h.headcountActive;
      } else {
        perBU[b] = null;
      }
    });
    const platformAvg = platformHeads > 0 ? platformActual / platformHeads : null;
    const val = perBU[bu];
    const achievementPct = (val !== null && platformAvg) ? (val / platformAvg) * 100 : null;
    const rankInfo = rank(perBU, "desc")[bu];

    return {
      kpiId: "salesProductivity", name: "Sales Productivity",
      mainValue: fmtM(val), mainValueSub: "Sales per Medical Rep · Current YTD",
      performance: { target: fmtM(platformAvg) + " (platform avg)", achievementPct: fmtPct1(achievementPct), variance: fmtSignedM(val !== null && platformAvg !== null ? val - platformAvg : null) },
      comparison: null,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: "Business Units",
      status: statusFromAchievement(achievementPct),
      trend: null, trendLabel: "Benchmark = platform-wide average, not an official SFE target",
      clickable: false, dblClickable: true,
    };
  }

  // ---------------------------------------------------------------------
  // KPI 11 -- Line Performance (within selected BU only; hidden when a
  // specific Line is already selected, since a breakdown-by-line doesn't
  // apply once you've drilled to one line).
  //
  // EXTENDED 2026-07-27: added Sales Value, Target Value, and
  // Contribution % (this line's share of the BU's total Non-Tender
  // sales VALUE -- same "contribution based on value" convention as the
  // Sales Value KPI card's brand/item popup, just at the Line level
  // here).
  //
  // CHC now correctly produces TWO rows here -- "CHC" and "CHC_SALES"
  // (2026-07-27 correction, see semantic-model.js) -- since they are
  // real distinct lines, not a duplicate spelling to collapse. "CHC"'s
  // row will show null Sales-derived fields (Sales never tags
  // transactions plain "CHC" -- it tags all of CHC's sales
  // "CHC_SALES"), which is expected.
  // ---------------------------------------------------------------------
  function buildLinePerformanceTable(bu) {
    const covData = safeCall("coverage", "CoverageDashboard", "getLineAndTerritoryBreakdown", bu);
    const salesData = safeCall("sales", "SalesDashboard", "getLineSalesSummary", bu);
    if (!covData || !covData.ok) return { ok: false, status: covData ? covData.status : "module_unavailable" };

    // Group Coverage's raw per-team rows by canonical line (CHC and
    // CHC_SALES stay separate -- see comment above).
    const covByLine = new Map(); // canon -> { coveredWeighted, rfWeighted, headcount }
    covData.lines.forEach(l => {
      const canon = global.SEMANTIC.normalizeLine(l.name);
      if (!covByLine.has(canon)) covByLine.set(canon, { coveredWeighted: 0, rfWeighted: 0, headcount: 0 });
      const c = covByLine.get(canon);
      c.coveredWeighted += l.coveragePct * l.headcount;
      c.rfWeighted += l.rightFreqPct * l.headcount;
      c.headcount += l.headcount;
    });

    const salesByLine = new Map();
    let totalSalesValue = 0;
    if (salesData && salesData.ok) {
      salesData.lines.forEach(l => { salesByLine.set(l.name, l); totalSalesValue += l.actualValue; });
    }

    const rows = Array.from(covByLine.entries()).map(([name, c]) => {
      const s = salesByLine.get(name);
      const coveragePct = c.headcount > 0 ? c.coveredWeighted / c.headcount : null;
      const rightFreqPct = c.headcount > 0 ? c.rfWeighted / c.headcount : null;
      return {
        name: name,
        coveragePct: coveragePct,
        rightFreqPct: rightFreqPct,
        salesAchievementPct: s ? s.achievementPct : null,
        salesValue: s ? s.actualValue : null,
        targetValue: s ? s.targetValue : null,
        contributionPct: (s && totalSalesValue > 0) ? (s.actualValue / totalSalesValue) * 100 : null,
        salesPerRep: (s && c.headcount > 0) ? s.actualValue / c.headcount : null,
        headcount: c.headcount,
      };
    }).sort((a, b) => (b.salesAchievementPct === null ? -Infinity : b.salesAchievementPct) - (a.salesAchievementPct === null ? -Infinity : a.salesAchievementPct));

    return { ok: true, bu: bu, scope: (salesData && salesData.ok) ? salesData.scope : null, rows: rows };
  }

  // ---------------------------------------------------------------------
  // Modals -- type breakdown (Coverage/RF), Brand Achievement + Item
  // drill (Sales), per-product Market Share breakdown (IQVIA).
  // ---------------------------------------------------------------------
  function openTypeBreakdownModal(bu, kind) {
    const data = safeCall("coverage", "CoverageDashboard", "getFilteredCoverageByType", bu);
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;
    if (!data || !data.ok) {
      global.DS.openModal({ title: bu + " — " + (kind === "coverage" ? "Coverage" : "Right Frequency") + " by Type", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>Data unavailable.</div>" });
      return;
    }
    const metricKey = kind === "coverage" ? "coveragePct" : "rightFreqPct";
    const table = global.DS.table({
      columns: [
        { key: "name", label: "Type" },
        { key: "value", label: kind === "coverage" ? "Coverage %" : "Right-Freq %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
        { key: "repCount", label: "Reps", align: "right" },
      ],
      rows: data.types.map(t => ({ name: t.name, value: t[metricKey], repCount: t.repCount })),
    });
    global.DS.openModal({ title: bu + " — " + (kind === "coverage" ? "Operational Coverage" : "Right Frequency") + " by Type", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">Title=Medical Representative, Experience=Non-Probation, Status=Active, as of ${escapeAttr(data.asOfDate)}.</div>` + table });
  }

  function openBrandAchievementModal(bu, line) {
    const data = safeCall("sales", "SalesDashboard", "getBrandAchievement", bu, line && line !== "All" ? line : null);
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;
    if (!data || !data.ok || !data.brands.length) {
      global.DS.openModal({ title: bu + " — Brand Achievement", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No brand-level data available.</div>" });
      return;
    }
    const rows = data.brands.map(b => ({ name: b.name, actualValue: b.actualValue, targetValue: b.targetValue, achievementPct: b.achievementPct }));
    const table = global.DS.table({
      columns: [
        { key: "name", label: "Brand" },
        { key: "actualValue", label: "Actual (EGP)", align: "right", format: v => Math.round(v).toLocaleString() },
        { key: "targetValue", label: "Target (EGP)", align: "right", format: v => Math.round(v).toLocaleString() },
        { key: "achievementPct", label: "Achievement %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      ],
      rows: rows,
    });
    const note = bu === "CHC"
      ? `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}. Click a brand row for Item-level detail (CHC only).</div>`
      : `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}.</div>`;
    global.DS.openModal({ title: bu + " — Brand Achievement", bodyHtml: note + table });

    if (bu === "CHC") {
      // Wire per-row click -> Item modal. openModal() appends to
      // document.body -- query it fresh after the modal is in the DOM.
      setTimeout(() => {
        const overlay = document.querySelector(".ds-modal-overlay");
        if (!overlay) return;
        const trs = overlay.querySelectorAll("tbody tr");
        trs.forEach((tr, i) => {
          tr.style.cursor = "pointer";
          tr.addEventListener("click", () => openItemAchievementModal(bu, rows[i].name));
        });
      }, 0);
    }
  }

  function openItemAchievementModal(bu, brandName) {
    const data = safeCall("sales", "SalesDashboard", "getItemAchievement", bu, brandName);
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;
    if (!data || !data.ok || !data.items.length) {
      global.DS.openModal({ title: bu + " — " + brandName + " — Item Detail", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No item-level data available.</div>" });
      return;
    }
    const table = global.DS.table({
      columns: [
        { key: "name", label: "Item (SKU)" },
        { key: "actualValue", label: "Actual (EGP)", align: "right", format: v => Math.round(v).toLocaleString() },
        { key: "targetValue", label: "Target (EGP)", align: "right", format: v => Math.round(v).toLocaleString() },
        { key: "achievementPct", label: "Achievement %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      ],
      rows: data.items,
    });
    global.DS.openModal({ title: bu + " — " + brandName + " — Item Detail", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}.</div>` + table });
  }

  // Sales Value card's popup (2026-07-27): Value + Units + Target +
  // Achievement % + Contribution % (share of the card's total, based on
  // Value). CHC shows ITEMS directly (per request -- "for chc units show
  // items in popups not brand"), every other BU shows Brands. Reuses
  // getBrandAchievement()/getItemAchievement()'s already-computed
  // contributionPct -- no separate share calculation here.
  function openSalesValueModal(bu, line) {
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;
    const scopedLine = line && line !== "All" ? line : null;
    const columns = [
      { key: "name", label: null }, // label filled in per-mode below
      { key: "actualQty", label: "Units", align: "right", format: v => v === null ? "—" : Math.round(v).toLocaleString() },
      { key: "actualValue", label: "Value (EGP)", align: "right", format: v => Math.round(v).toLocaleString() },
      { key: "targetValue", label: "Target (EGP)", align: "right", format: v => Math.round(v).toLocaleString() },
      { key: "achievementPct", label: "Achievement %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      { key: "contributionPct", label: "Contribution %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
    ];

    if (bu === "CHC") {
      const data = safeCall("sales", "SalesDashboard", "getItemAchievement", bu, null, scopedLine);
      columns[0].label = "Item (SKU)";
      if (!data || !data.ok || !data.items.length) {
        global.DS.openModal({ title: bu + " — Sales Value by Item", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No item-level data available.</div>" });
        return;
      }
      const table = global.DS.table({ columns: columns, rows: data.items });
      global.DS.openModal({ title: bu + " — Sales Value by Item", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}. CHC shows items directly (no brand grouping).</div>` + table });
      return;
    }

    const data = safeCall("sales", "SalesDashboard", "getBrandAchievement", bu, scopedLine);
    columns[0].label = "Brand";
    if (!data || !data.ok || !data.brands.length) {
      global.DS.openModal({ title: bu + " — Sales Value by Brand", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No brand-level data available.</div>" });
      return;
    }
    const table = global.DS.table({ columns: columns, rows: data.brands });
    global.DS.openModal({ title: bu + " — Sales Value by Brand", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}.</div>` + table });
  }

  // Customer Channel Mix modal (2026-07-28) -- cluster-level table,
  // click a row to drill into that cluster's sub_type ("customer")
  // breakdown. Mirrors openBrandAchievementModal()/
  // openItemAchievementModal()'s two-level click pattern exactly.
  function openCustomerClusterMixModal(bu, line) {
    const data = safeCall("sales", "SalesDashboard", "getCustomerClusterMix", bu, line && line !== "All" ? line : null);
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;
    if (!data || !data.ok || !data.clusters.length) {
      global.DS.openModal({ title: bu + " — Customer Channel Mix", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No customer-channel data available.</div>" });
      return;
    }
    const rows = data.clusters.map(c => ({ name: c.name, actualValue: c.actualValue, contributionPct: c.contributionPct, customerCount: c.customerCount }));
    const table = global.DS.table({
      columns: [
        { key: "name", label: "Channel Cluster" },
        { key: "actualValue", label: "Value (EGP)", align: "right", format: v => Math.round(v).toLocaleString() },
        { key: "contributionPct", label: "Contribution %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
        { key: "customerCount", label: "# Sub-Types", align: "right" },
      ],
      rows: rows,
    });
    global.DS.openModal({
      title: bu + " — Customer Channel Mix",
      bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}. Click a cluster row for its sub-type ("customer") breakdown.</div>` + table,
    });

    setTimeout(() => {
      const overlay = document.querySelector(".ds-modal-overlay");
      if (!overlay) return;
      const trs = overlay.querySelectorAll("tbody tr");
      trs.forEach((tr, i) => {
        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => openClusterCustomersModal(bu, line, rows[i].name));
      });
    }, 0);
  }

  // Cluster Customer Health drill (2026-07-28): when the customer-analytics
  // ETL cache (etl/build_customer_analytics_cache.py -> getClusterCustomerHealth())
  // has rich per-customer data for this cluster -- currently Retail and
  // Chain Pharmacy, see the script's CLUSTERS_TO_BUILD -- show a
  // four-section Executive Summary overlay (bridge / frequency / basket /
  // SKU penetration) with a full paginated customer list one click away.
  // Every other cluster falls back to the original flat sub_type table
  // (openClusterFlatModal, unchanged from the first Customer Channel Mix
  // build) since no customer-grain data exists for it yet.
  function openClusterCustomersModal(bu, line, clusterName) {
    const health = safeCall("sales", "SalesDashboard", "getClusterCustomerHealth", bu, clusterName);
    if (health && health.ok) {
      openClusterHealthModal(bu, clusterName, health);
      return;
    }
    openClusterFlatModal(bu, line, clusterName);
  }

  function openClusterFlatModal(bu, line, clusterName) {
    const data = safeCall("sales", "SalesDashboard", "getCustomerClusterMix", bu, line && line !== "All" ? line : null);
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;
    const cluster = data && data.ok ? data.clusters.find(c => c.name === clusterName) : null;
    if (!cluster || !cluster.customers.length) {
      global.DS.openModal({ title: bu + " — " + clusterName + " — Customers", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No sub-type-level data available.</div>" });
      return;
    }
    const table = global.DS.table({
      columns: [
        { key: "name", label: "Customer / Sub-Type" },
        { key: "actualValue", label: "Value (EGP)", align: "right", format: v => Math.round(v).toLocaleString() },
        { key: "contributionPctOfCluster", label: "% of Cluster", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
        { key: "contributionPctOfTotal", label: "% of Total", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      ],
      rows: cluster.customers,
    });
    global.DS.openModal({
      title: bu + " — " + clusterName + " — Customers",
      bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}. "Customer" = the Sales sub_type value -- a named account for Chain/Independent Pharmacy clusters, a generic channel label for institutional/retail clusters (no finer identity exists in this cache).</div>` + table,
    });
  }

  // ---- Rich Customer Health overlay (Retail / Chain Pharmacy today) ----

  function buildClusterHealthSummaryHtml(clusterName, health) {
    const months = health.months || [];
    const latestM = months[months.length - 1] || "—";
    const prevM = months[months.length - 2] || "—";
    const b = health.bridge || { new: 0, lost: 0, retained: 0, reactivated: 0 };
    const prevTotal = b.retained + b.lost;
    const latestTotal = b.retained + b.new + b.reactivated;

    const freq = health.frequencyBuckets || { frequent: 0, occasional: 0, oneTime: 0 };
    const basket = health.basketBuckets || { full: 0, partial: 0, none: 0 };

    const topSkus = (health.skuPenetration || [])
      .slice()
      .sort((a, c) => c.penetrationPct - a.penetrationPct)
      .slice(0, 10)
      .map(s => ({ label: s.sku + (s.inCore ? " (core)" : ""), value: s.penetrationPct, pctLabel: s.penetrationPct.toFixed(1) + "%" }));
    // 2026-07-28: SKU penetration is BU-scoped when a specific BU is
    // selected (see getClusterCustomerHealth's skuPenetrationScope) --
    // label it explicitly so it's clear the list isn't the all-BU view.
    const skuScopeLabel = health.skuPenetrationScope && health.skuPenetrationScope !== "All"
      ? ` — ${health.skuPenetrationScope} only`
      : " — All BUs";

    return `
      <div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:14px;">
        ${escapeAttr(clusterName)} — Non-Tender transactions only. ${health.totalCustomers.toLocaleString()} unique customers across ${months.length} active month${months.length === 1 ? "" : "s"} (${escapeAttr(months[0] || "—")} to ${escapeAttr(latestM)}).
      </div>

      <div style="margin-bottom:18px;">
        <div style="font-size:13px;font-weight:600;color:var(--color-text-primary,#0F172A);margin-bottom:4px;">Customer Bridge — ${escapeAttr(prevM)} → ${escapeAttr(latestM)}</div>
        ${global.DS.customerBridge({
          startLabel: prevM, startValue: prevTotal,
          newV: b.new, retainedV: b.retained, reactivatedV: b.reactivated, lostV: b.lost,
          endLabel: latestM, endValue: latestTotal,
        })}
      </div>

      <div style="margin-bottom:18px;">
        <div style="font-size:13px;font-weight:600;color:var(--color-text-primary,#0F172A);margin-bottom:8px;">Purchase Frequency (across ${months.length} months)</div>
        ${global.DS.segmentBar({ segments: [
          { label: "Frequent (4-5 mo)", value: freq.frequent, variant: "success" },
          { label: "Occasional (2-3 mo)", value: freq.occasional, variant: "warning" },
          { label: "One-time (1 mo)", value: freq.oneTime, variant: "neutral" },
        ] })}
      </div>

      <div style="margin-bottom:18px;">
        <div style="font-size:13px;font-weight:600;color:var(--color-text-primary,#0F172A);margin-bottom:8px;">SKU Basket Depth (core SKU list = top ${health.coreSkuCount} of ${health.totalSkuCount} SKUs covering 80% of cluster value)</div>
        ${global.DS.segmentBar({ segments: [
          { label: "Full basket (≥80% of core)", value: basket.full, variant: "success" },
          { label: "Partial basket", value: basket.partial, variant: "warning" },
          { label: "None of core", value: basket.none, variant: "danger" },
        ] })}
      </div>

      <div>
        <div style="font-size:13px;font-weight:600;color:var(--color-text-primary,#0F172A);margin-bottom:8px;">Top SKU Penetration${skuScopeLabel} (% of cluster's customers who bought it at least once)</div>
        ${global.DS.rankedBarList({ items: topSkus, maxItems: 10 })}
      </div>
    `;
  }

  function buildClusterHealthGridShellHtml(clusterName) {
    return `
      <div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">
        ${escapeAttr(clusterName)} — full customer list. Search by name or ID, click a column header to sort, export the current filtered view as CSV.
      </div>
      ${global.DS.dataGrid({ id: "exec-cluster-health-grid", searchPlaceholder: "Search customer name or ID..." })}
    `;
  }

  function mountClusterHealthGrid(clusterName, health) {
    global.DS.mountDataGrid("exec-cluster-health-grid", {
      columns: [
        { key: "name", label: "Customer Name" },
        { key: "bridgeSegment", label: "Status" },
        { key: "frequencySegment", label: "Frequency" },
        { key: "basketSegment", label: "Basket" },
        { key: "monthsActive", label: "Months Active", align: "right" },
        { key: "distinctSkus", label: "Distinct SKUs", align: "right" },
        { key: "value", label: "Value (EGP)", align: "right", format: v => Math.round(v).toLocaleString() },
        { key: "bus", label: "Business Units", format: v => Array.isArray(v) ? v.join(", ") : v },
      ],
      rows: health.customers || [],
      pageSize: 25,
      searchKeys: ["name", "id"],
      exportFilename: clusterName.replace(/[^a-z0-9]+/gi, "_") + "_customers",
    });
  }

  function openClusterHealthModal(bu, clusterName, health) {
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;

    let showingGrid = false;
    const toggleBtnHtml = global.DS.button({
      label: "View Full Customer List (" + health.totalCustomers.toLocaleString() + ")",
      variant: "primary",
      attrs: 'id="exec-cluster-health-toggle"',
    });

    const overlay = global.DS.openModal({
      title: bu + " — " + clusterName + " — Customer Health",
      bodyHtml: buildClusterHealthSummaryHtml(clusterName, health),
      footerHtml: toggleBtnHtml,
    });

    setTimeout(() => {
      const btn = overlay.querySelector("#exec-cluster-health-toggle");
      const body = overlay.querySelector(".ds-modal-body");
      if (!btn || !body) return;
      btn.addEventListener("click", () => {
        showingGrid = !showingGrid;
        if (showingGrid) {
          body.innerHTML = buildClusterHealthGridShellHtml(clusterName);
          mountClusterHealthGrid(clusterName, health);
          btn.querySelector("span").textContent = "Back to Summary";
        } else {
          body.innerHTML = buildClusterHealthSummaryHtml(clusterName, health);
          btn.querySelector("span").textContent = "View Full Customer List (" + health.totalCustomers.toLocaleString() + ")";
        }
      });
    }, 0);
  }

  function openMarketShareProductModal(bu) {
    const data = safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", bu);
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;
    if (!data || !data.ok || !data.segments.length) {
      global.DS.openModal({ title: bu + " — Market Share by Product", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No product-level data available.</div>" });
      return;
    }
    const rows = data.segments.map(s => ({
      product: s.product,
      dm1SharePct: s.dm1 && s.dm1.ytd && s.dm1.ytd.su ? s.dm1.ytd.su.sharePct : null,
      dm2SharePct: s.dm2 && s.dm2.ytd && s.dm2.ytd.su ? s.dm2.ytd.su.sharePct : null,
    }));
    const table = global.DS.table({
      columns: [
        { key: "product", label: "Product" },
        { key: "dm1SharePct", label: "DM1 Share % (YTD SU)", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
        { key: "dm2SharePct", label: "DM2 Share % (YTD SU)", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      ],
      rows: rows,
    });
    global.DS.openModal({ title: bu + " — Market Share by Product", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">Excludes Other Markets. As of ${escapeAttr(data.asOfDate)}.</div>` + table });
  }

  function switchToTab(tabName) {
    const item = document.querySelector('#sidebar-nav .menu-item[data-tab="' + tabName + '"]');
    if (item) item.dispatchEvent(new Event("click", { bubbles: true }));
  }

  // ---------------------------------------------------------------------
  // Rendering.
  // ---------------------------------------------------------------------
  function renderFilterBar(ctx) {
    const buOptions = global.SEMANTIC.BU_LIST.map(b => ({ value: b, label: b }));
    const lineOptions = [{ value: "All", label: "All Lines" }].concat(linesForBU(ctx.filters.bu).map(l => ({ value: l, label: l })));

    const wrap = document.createElement("div");
    wrap.className = "ds-exec-filterbar";

    const buSelect = global.DS.select({ id: "exec-filter-bu", label: "Business Unit", options: buOptions, value: ctx.filters.bu });
    const lineSelect = global.DS.select({ id: "exec-filter-line", label: "Line", options: lineOptions, value: ctx.filters.line });
    const periodSelect = global.DS.select({ id: "exec-filter-period", label: "Period", options: [{ value: "latest", label: "Latest Period" }], value: "latest", disabled: true });
    const cmpSelect = global.DS.select({ id: "exec-filter-cmp", label: "Comparison Period", options: [{ value: "YTD", label: "YTD" }], value: "YTD", disabled: true });

    wrap.appendChild(buSelect);
    wrap.appendChild(lineSelect);
    wrap.appendChild(periodSelect);
    wrap.appendChild(cmpSelect);

    buSelect.querySelector("select").addEventListener("change", (e) => {
      ctx.filters.bu = e.target.value;
      ctx.filters.line = "All"; // Line is BU-dependent -- reset on BU change
      render(ctx.container);
    });
    lineSelect.querySelector("select").addEventListener("change", (e) => {
      ctx.filters.line = e.target.value;
      render(ctx.container);
    });

    return wrap;
  }

  function renderCard(data) {
    return global.DS.executiveKpiCard(data);
  }

  function renderKPIGrid(ctx) {
    const summaries = ctx.summaries, filters = ctx.filters;
    const cardsHtml = []
      .concat(renderCard(buildCoverageFamilyCard("coverage", "Operational Coverage", "coveragePct", 90, filters)))
      .concat(renderCard(buildCoverageFamilyCard("rightFrequency", "Right Frequency", "rightFreqPct", 70, filters)))
      .concat(renderCard(buildSFECard(summaries, filters)))
      .concat(renderCard(buildSalesAchievementCard(filters)))
      .concat(renderCard(buildSalesValueCard(filters)))
      .concat(renderCard(buildCustomerClusterMixCard(filters)))
      .concat(renderCard(buildMarketShareCard(filters)))
      .concat(renderCard(buildBUGrowthCard(filters)))
      .concat(renderCard(buildSalesProductivityCard(summaries, filters)));

    const grid = document.createElement("div");
    grid.className = "ds-grid-kpi";
    grid.innerHTML = cardsHtml.join("");
    return grid;
  }

  function renderLinePerformanceSection(ctx) {
    if (ctx.filters.line !== "All") return null; // redundant once a single line is already selected
    const data = buildLinePerformanceTable(ctx.filters.bu);
    const wrap = document.createElement("div");
    wrap.className = "ds-mt-4";
    if (!data.ok) {
      wrap.innerHTML = `<div style="font-size:var(--fs-xs,12px);color:var(--color-text-tertiary,#94A3B8);">Line Performance unavailable (${escapeAttr(data.status)}).</div>`;
      return wrap;
    }
    const table = global.DS.table({
      columns: [
        { key: "name", label: "Line" },
        { key: "coveragePct", label: "Coverage %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
        { key: "rightFreqPct", label: "Right-Freq %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
        { key: "salesValue", label: "Sales Value (EGP)", align: "right", format: v => v === null ? "—" : Math.round(v).toLocaleString() },
        { key: "targetValue", label: "Target Value (EGP)", align: "right", format: v => v === null ? "—" : Math.round(v).toLocaleString() },
        { key: "salesAchievementPct", label: "Sales Achievement %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
        { key: "contributionPct", label: "Contribution %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
        { key: "salesPerRep", label: "Sales per Rep", align: "right", format: v => v === null ? "—" : fmtM(v) },
        { key: "headcount", label: "Headcount", align: "right" },
      ],
      rows: data.rows,
    });
    const scopeNote = data.scope ? `<div style="font-size:var(--fs-xs,12px);color:var(--color-text-tertiary,#94A3B8);margin-bottom:var(--space-2,8px);">Sales figures: ${escapeAttr(data.scope)}. Contribution % = share of ${escapeAttr(ctx.filters.bu)}'s total Sales Value.</div>` : "";
    wrap.innerHTML = `<div style="font-weight:600;font-size:var(--fs-sm,13px);margin-bottom:var(--space-2,8px);">Line Performance within ${escapeAttr(ctx.filters.bu)}</div>` + scopeNote + table;
    return wrap;
  }

  function wireCardEvents(container, ctx) {
    container.querySelectorAll("[data-exec-kpi]").forEach(el => {
      el.addEventListener("click", () => {
        const kpiId = el.getAttribute("data-exec-kpi");
        const bu = ctx.filters.bu;
        if (kpiId === "coverage") openTypeBreakdownModal(bu, "coverage");
        else if (kpiId === "rightFrequency") openTypeBreakdownModal(bu, "rf");
        else if (kpiId === "salesAchievement") openBrandAchievementModal(bu, ctx.filters.line);
        else if (kpiId === "salesValue") openSalesValueModal(bu, ctx.filters.line);
        else if (kpiId === "customerClusterMix") openCustomerClusterMixModal(bu, ctx.filters.line);
        else if (kpiId === "marketShare") openMarketShareProductModal(bu);
        else if (kpiId === "sfe") switchToTab("sfe");
      });
    });
    container.querySelectorAll("[data-exec-kpi-dbl]").forEach(el => {
      el.addEventListener("dblclick", () => {
        const kpiId = el.getAttribute("data-exec-kpi-dbl");
        const tabByKpi = { coverage: "coverage", rightFrequency: "coverage", sfe: "sfe", salesAchievement: "sales", salesValue: "sales", marketShare: "iqvia", buGrowth: "iqvia", salesProductivity: "sales" };
        if (tabByKpi[kpiId]) switchToTab(tabByKpi[kpiId]);
      });
    });
  }

  function render(container) {
    container.innerHTML = "";
    const ctx = { container: container, filters: _filters, summaries: collectSummaries() };

    const header = document.createElement("div");
    header.className = "ds-mb-4";
    header.innerHTML = `<div style="font-size:var(--fs-2xl,28px);font-weight:800;color:var(--color-text-primary,#0F172A);">Executive Command Center</div>
      <div style="font-size:var(--fs-sm,13px);color:var(--color-text-tertiary,#94A3B8);margin-top:4px;">Zeta Pharma — ${escapeAttr(ctx.filters.bu)} — how the business is performing, right now.</div>`;
    container.appendChild(header);

    container.appendChild(renderFilterBar(ctx));
    container.appendChild(renderKPIGrid(ctx));
    const lineSection = renderLinePerformanceSection(ctx);
    if (lineSection) container.appendChild(lineSection);

    wireCardEvents(container, ctx);
  }

  global.ExecutiveDashboard = {
    init(containerId) {
      if (typeof global.SEMANTIC === "undefined" || typeof global.DS === "undefined") {
        console.error("[Executive] Missing dependency -- requires semantic-model.js and components.js to load first.");
        return;
      }
      const container = document.getElementById(containerId);
      if (!container) return;
      document.body.classList.add("executive-mode");
      container.classList.add("ds-page-root");
      _container = container;
      render(container);
    },
    destroy() {
      document.body.classList.remove("executive-mode");
    }
  };
})(window);
