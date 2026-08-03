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
      // Target Scenario (2026-08-04): _filters.scenario isn't seeded yet
      // the very first time this runs (collectSummaries() is called while
      // building ctx, before clampFiltersToScope() -- see init()), so
      // this reads AUTH directly rather than via activeScenario() (which
      // is defined below _filters but that's not the ordering issue here;
      // this is just the one call site that predates ctx existing at all).
      sales: safeCall("sales", "SalesDashboard", "getBusinessSummary", _filters.scenario || (global.AUTH && global.AUTH.getActiveScenario())),
      coverage: safeCall("coverage", "CoverageDashboard", "getBusinessSummary"),
      sfe: safeCall("sfe", "SFEDashboard", "getBusinessSummary"),
      iqvia: safeCall("iqvia", "IQVIADashboard", "getBusinessSummary"),
    };
  }

  /**
   * Target Scenario (2026-08-04) -- Business Review governance pin.
   * Ahmed's explicit decision: the Business Review workspace (board/
   * executive reporting, js/business-review-engine.js) must ALWAYS use
   * Official Target, regardless of whatever scenario the signed-in
   * user currently has toggled on the Executive Command Center or Sales
   * Performance page. collectSummaries() above intentionally reads the
   * user's active scenario -- do NOT reuse it for Business Review.
   *
   * business-review-engine.js's input contract takes an opaque
   * `summaries` object (see that file's header) and never calls
   * SalesDashboard itself, so pinning happens at the collection point --
   * this function is that point. Not currently wired to a live page
   * (business-review-engine.js has no consumer yet in dashboard.html),
   * but exported now so the correct, safe entry point already exists
   * the moment that integration is built -- the alternative is relying
   * on whoever writes that integration to remember this rule.
   */
  function collectSummariesPinnedOfficial() {
    return {
      sales: safeCall("sales", "SalesDashboard", "getBusinessSummary", "official"),
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

  // ---------------------------------------------------------------------
  // CORPORATE REFERENCE HELPERS (added 2026-07-31, "add corporate
  // performance to each Executive KPI card as reference"): a company-
  // wide (all 4 BUs blended) figure for the SAME metric each card
  // already shows, rendered as a "vs Corporate" entry in the card's
  // comparison row (DS.executiveKpiCard's generalized `comparison`
  // array -- see js/components.js). Shown to EVERY signed-in user,
  // restricted or not (2026-07-31 decision): a blended company total
  // never reveals any other single BU's individual number, only the
  // combined figure, so it doesn't weaken the existing BU/Line access
  // scoping (js/auth.js) -- see the module doc comments on
  // CoverageDashboard.getCorporateCoverageTotals() and
  // IQVIADashboard.getCorporateMarketIntel() for the same reasoning
  // applied inside those two gated interfaces.
  //
  // Sales' own KPI functions (getSalesAchievementSummary,
  // getBrandAchievement, getCustomerClusterMix, getBusinessSummary) were
  // never BU-gated to begin with (only getLineSalesSummary is) --
  // confirmed by reading sales.js before writing these -- so the Sales-
  // sourced helpers below simply loop SEMANTIC.BU_LIST directly with no
  // new module-level function needed.
  // ---------------------------------------------------------------------
  function corporateCoveragePct(metricKey) {
    const r = safeCall("coverage", "CoverageDashboard", "getCorporateCoverageTotals");
    return (r && r.ok) ? r[metricKey] : null;
  }

  function corporateSfeFillRate(summaries) {
    if (!summaries.sfe || !summaries.sfe.ok) return null;
    let total = 0, vacant = 0;
    global.SEMANTIC.BU_LIST.forEach(b => {
      const s = summaries.sfe.bu[b];
      if (s) { total += s.headcountTotal || 0; vacant += s.headcountVacant || 0; }
    });
    return total > 0 ? 100 - (vacant / total) * 100 : null;
  }

  // CORRECTED 2026-07-31 (user: "sales achievement vs corporate should be
  // 105%, from sales excluding tender and CHC_SALES line as YTD June"):
  // the platform's own Sales dashboard corporate/company Sales Achievement
  // figure excludes CHC's Pharmacy-facing CHC_SALES line entirely, not
  // just Tender business -- CHC_SALES is tracked as a separate channel,
  // not part of headline company Sales Achievement reporting. Confirmed
  // empirically against the June cache: summing Non-Tender actual/target
  // across all 4 BUs with BOTH of CHC's lines included gives 101.1%;
  // excluding CHC_SALES's contribution (keep CHC's plain "CHC" line only,
  // plus Cluster/DIAB/GIT in full) gives 105.2%, matching the user's
  // reference number exactly. Applied to BOTH Sales-family corporate
  // helpers below (Sales Achievement AND Sales Value) since they share
  // the identical Non-Tender methodology -- flagged to the user, not
  // silently assumed, since only Sales Achievement was explicitly
  // confirmed.
  // Target Scenario (2026-08-04): each of these 3 corporate benchmarks
  // feeds the "vs Corporate" reference row on the SAME card that shows
  // the scenario-scoped BU/line figure -- must resolve the identical
  // scenario, via activeScenario(), or a Working-Target card view would
  // silently compare itself against an Official-Target corporate number.
  function corporateSalesAchievementPct() {
    let actual = 0, target = 0, any = false;
    const scenario = activeScenario();
    global.SEMANTIC.BU_LIST.forEach(b => {
      const line = (b === "CHC") ? "CHC" : null; // exclude CHC_SALES
      const s = safeCall("sales", "SalesDashboard", "getSalesAchievementSummary", b, line, undefined, scenario);
      if (s && s.ok) { actual += s.actualYTD; target += s.targetYTD; any = true; }
    });
    return (any && target > 0) ? (actual / target) * 100 : null;
  }

  function corporateSalesValueAchievementPct() {
    let actual = 0, target = 0, any = false;
    const scenario = activeScenario();
    global.SEMANTIC.BU_LIST.forEach(b => {
      const line = (b === "CHC") ? "CHC" : "All"; // exclude CHC_SALES, same convention as corporateSalesAchievementPct()
      const t = nonTenderTotals(b, line, undefined, scenario);
      if (t) { actual += t.actualValue; target += t.targetValue; any = true; }
    });
    return (any && target > 0) ? (actual / target) * 100 : null;
  }

  function corporateSalesUnitsAchievementPct() {
    let actual = 0, target = 0, any = false;
    const scenario = activeScenario();
    global.SEMANTIC.BU_LIST.forEach(b => {
      const line = (b === "CHC") ? "CHC" : "All"; // exclude CHC_SALES, same convention as corporateSalesValueAchievementPct()
      const t = nonTenderUnitsTotals(b, line, undefined, scenario);
      if (t) { actual += t.actualQty; target += t.targetQty; any = true; }
    });
    return (any && target > 0) ? (actual / target) * 100 : null;
  }

  function corporateClusterConcentrationPct() {
    const merged = new Map();
    let any = false;
    global.SEMANTIC.BU_LIST.forEach(b => {
      const d = safeCall("sales", "SalesDashboard", "getCustomerClusterMix", b, null);
      if (d && d.ok) {
        any = true;
        d.clusters.forEach(c => merged.set(c.name, (merged.get(c.name) || 0) + c.actualValue));
      }
    });
    if (!any || merged.size === 0) return null;
    const values = Array.from(merged.values());
    const total = values.reduce((s, v) => s + v, 0);
    if (total <= 0) return null;
    return (Math.max.apply(null, values) / total) * 100;
  }

  function corporateSalesProductivity(summaries) {
    if (!summaries.sales || !summaries.sales.ok) return null;
    let actual = 0, positions = 0;
    global.SEMANTIC.BU_LIST.forEach(b => {
      const s = summaries.sales.bu[b];
      if (s && s.activePositions > 0) { actual += s.actualYTD; positions += s.activePositions; }
    });
    return positions > 0 ? actual / positions : null;
  }

  // ---------------------------------------------------------------------
  // REFERENCE ENTRY BUILDERS (2026-07-31, user: "vs Corporate when
  // selecting line get data vs bu") -- comparing a single LINE's number
  // against the whole 4-BU company total was misleading (apples to
  // oranges: a line is a small slice of one BU). When a specific Line is
  // selected, the comparison row now shows "vs BU" -- the parent
  // Business Unit's own whole-BU total for the same metric -- instead of
  // the company-wide Corporate figure. "vs Corporate" only appears when
  // Line = All, i.e. when the card itself is already at BU-level, which
  // is the case the Corporate comparison was actually designed for. Same
  // reframing convention this page already uses for Ranking ("of 4
  // Business Units" -> "Lines within BU") and Sales Productivity's own
  // benchmark label ("platform avg" -> "<BU> avg").
  // ---------------------------------------------------------------------
  function coverageReferenceEntry(metricKey, bu, line) {
    const isLineMgr = global.AUTH && global.AUTH.getScope().lines !== null;
    if (isLineMgr || (line && line !== "All")) {
      const r = safeCall("coverage", "CoverageDashboard", "getFilteredCoverageForLine", bu, null, true);
      const v = (r && r.ok) ? r[metricKey] : null;
      return v !== null && v !== undefined ? { label: "vs " + bu, value: fmtPct1(v) } : null;
    }
    const v = corporateCoveragePct(metricKey);
    return v !== null ? { label: "vs Corporate", value: fmtPct1(v) } : null;
  }

  function sfeReferenceEntry(bu, line, summaries) {
    const isLineMgr = global.AUTH && global.AUTH.getScope().lines !== null;
    if (isLineMgr || (line && line !== "All")) {
      const r = safeCall("sfe", "SFEDashboard", "getFilteredHeadcountForLine", bu, null, true);
      const v = (r && r.ok && r.vacancyRatePct !== null) ? 100 - r.vacancyRatePct : null;
      return v !== null ? { label: "vs " + bu, value: fmtPct1(v) } : null;
    }
    const v = corporateSfeFillRate(summaries);
    return v !== null ? { label: "vs Corporate", value: fmtPct1(v) } : null;
  }

  function salesAchievementReferenceEntry(bu, line) {
    const isLineMgr = global.AUTH && global.AUTH.getScope().lines !== null;
    if (isLineMgr || (line && line !== "All")) {
      const s = safeCall("sales", "SalesDashboard", "getSalesAchievementSummary", bu, null, true, activeScenario());
      const v = (s && s.ok) ? s.achievementPct : null;
      return v !== null ? { label: "vs " + bu, value: fmtPct1(v) } : null;
    }
    const v = corporateSalesAchievementPct();
    return v !== null ? { label: "vs Corporate", value: fmtPct1(v) } : null;
  }

  function salesValueReferenceEntry(bu, line) {
    const isLineMgr = global.AUTH && global.AUTH.getScope().lines !== null;
    if (isLineMgr || (line && line !== "All")) {
      const t = nonTenderTotals(bu, "All", true);
      const v = t ? t.achievementPct : null;
      return v !== null ? { label: "vs " + bu, value: fmtPct1(v) } : null;
    }
    const v = corporateSalesValueAchievementPct();
    return v !== null ? { label: "vs Corporate", value: fmtPct1(v) } : null;
  }

  function salesUnitsReferenceEntry(bu, line) {
    const isLineMgr = global.AUTH && global.AUTH.getScope().lines !== null;
    if (isLineMgr || (line && line !== "All")) {
      const t = nonTenderUnitsTotals(bu, "All", true);
      const v = t ? t.achievementPct : null;
      return v !== null ? { label: "vs " + bu, value: fmtPct1(v) } : null;
    }
    const v = corporateSalesUnitsAchievementPct();
    return v !== null ? { label: "vs Corporate", value: fmtPct1(v) } : null;
  }

  function clusterMixReferenceEntry(bu, line) {
    const isLineMgr = global.AUTH && global.AUTH.getScope().lines !== null;
    if (isLineMgr || (line && line !== "All")) {
      const d = safeCall("sales", "SalesDashboard", "getCustomerClusterMix", bu, null, true);
      const v = (d && d.ok && d.clusters.length) ? d.clusters[0].contributionPct : null;
      return v !== null ? { label: "vs " + bu, value: fmtPct1(v) } : null;
    }
    const v = corporateClusterConcentrationPct();
    return v !== null ? { label: "vs Corporate", value: fmtPct1(v) } : null;
  }

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
  let _filters = { bu: "CHC", line: "All", scenario: "official" }; // re-clamped to the signed-in user's scope/role in init(), see clampFiltersToScope()
  // Local Period state for the Line Performance section ONLY (2026-07-29)
  // -- NOT the platform-wide Period selector in the global filter bar,
  // which stays disabled since Coverage/SFE have no month dimension to
  // filter by (see renderFilterBar()). "all" = every month in the cache
  // (default, unchanged prior behavior); an array of month index values
  // scopes the table's Sales-derived columns to just those months.
  let _linePerfMonths = "all";
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
  // ROLE-BASED ACCESS SCOPE (2026-07-29): "Kamal Allam should see only
  // DIAB" -- every BU/Line selection this page offers, and every
  // ranking loop that walks BU_LIST/linesForBU(), is clamped to the
  // signed-in user's Allowed BU/Lines (js/auth.js). Falls back to
  // "everyone allowed" if AUTH isn't loaded (defensive only -- it's
  // always loaded before this file, see dashboard.html script order).
  // ---------------------------------------------------------------------
  function isBuRestricted() {
    return !!(global.AUTH && global.AUTH.getScope().bus !== null);
  }

  function getAllowedBUList() {
    if (!global.AUTH) return global.SEMANTIC.BU_LIST.slice();
    return global.AUTH.filterAllowedBUs(global.SEMANTIC.BU_LIST);
  }

  function getAllowedLinesForBU(bu) {
    const all = linesForBU(bu);
    if (!global.AUTH) return all;
    return global.AUTH.filterAllowedLines(all);
  }

  /** Default filter state on first load: restricted users land directly
   * on their own (first) allowed BU instead of the hardcoded "CHC". */
  function defaultFilters() {
    const allowed = getAllowedBUList();
    return { bu: allowed.length > 0 ? allowed[0] : "CHC", line: "All" };
  }

  /** Re-clamp module-level filter state to the current user's scope.
   * Called at init() so a stale/hardcoded default (evaluated at script
   * load, before any session exists) can never leak an out-of-scope BU
   * or line into the very first render. */
  function clampFiltersToScope() {
    const allowedBUs = getAllowedBUList();
    if (allowedBUs.length === 0) return; // AUTH not ready yet -- leave as-is, nothing to clamp against
    if (allowedBUs.indexOf(_filters.bu) < 0) {
      _filters.bu = allowedBUs[0];
      _filters.line = "All";
    }
    if (_filters.line !== "All") {
      const allowedLines = getAllowedLinesForBU(_filters.bu);
      if (allowedLines.indexOf(_filters.line) < 0) _filters.line = "All";
    }
    // Target Scenario (2026-08-04): seed from the signed-in user's role
    // default / in-session choice, same convention as sales.js's
    // STATE.scenario seeding in init(). Re-run every time init() runs
    // (not just once at script load) so a freshly signed-in user, or one
    // whose role has no toggle rights, never inherits a stale scenario
    // from a previous session's module state.
    if (global.AUTH && typeof global.AUTH.getActiveScenario === "function") {
      _filters.scenario = global.AUTH.getActiveScenario();
    }
  }

  /** Target Scenario (2026-08-04): single read point, explicitly passed
   * as a real argument at every safeCall("sales", "SalesDashboard", ...)
   * site below -- never left implicit -- so it participates in that
   * module's own per-argument memoization key, exactly like this file's
   * existing ctx.filters.bu/line convention. */
  function activeScenario() {
    return _filters.scenario || (global.AUTH && typeof global.AUTH.getActiveScenario === "function" ? global.AUTH.getActiveScenario() : "official");
  }

  /** Target Scenario CHC fallback note (2026-08-04): CHC/CHC_SALES have
   * no real Working Target (js/semantic-model.js's resolveScenario()
   * silently substitutes Official for these two lines at the data
   * layer) -- this returns the small informational string the CHC
   * exception's approved design calls for ("automatic fallback with a
   * small informational message. No broken KPIs, blank charts, or
   * special UI"), or "" when it doesn't apply, so callers can always
   * just concatenate it onto an existing basisNote/scope string. Checks
   * the BU/line SEMANTIC name, not the raw filter value, so it fires
   * correctly whether the card is scoped to CHC as a BU or to
   * CHC/CHC_SALES as a specific line. */
  function scenarioFallbackNote(buOrLine) {
    if (activeScenario() === "official") return "";
    if (!buOrLine || !global.SEMANTIC || !global.SEMANTIC.isChcSingleScenarioLine(buOrLine)) return "";
    return " Showing Official Target -- no Working Target is defined for " + buOrLine + ".";
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
    if (line === "All" && !isBuRestricted()) {
      const vals = {};
      getAllowedBUList().forEach(b => {
        const r = safeCall("coverage", "CoverageDashboard", "getFilteredCoverageForLine", b, null);
        vals[b] = (r && r.ok) ? r[metricKey] : null;
      });
      rankInfo = rank(vals, "desc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = getAllowedLinesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const r = safeCall("coverage", "CoverageDashboard", "getFilteredCoverageForLine", bu, l);
        vals[l] = (r && r.ok) ? r[metricKey] : null;
      });
      rankInfo = rank(vals, "desc")[line];
      rankUnit = "Lines within " + bu;
    }

    const refEntry = coverageReferenceEntry(metricKey, bu, line);

    return {
      kpiId: kpiId, name: name,
      mainValue: fmtPct1(mainVal), mainValueSub: "Current YTD" + (line !== "All" ? " · " + line : ""),
      performance: { target: target + "%", achievementPct: fmtPct1(achievementPct), variance: fmtSignedPts(variance) },
      comparison: refEntry ? [refEntry] : null,
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
  //
  // MADE LINE-AWARE 2026-07-29 ("let all cards dynamic with filters
  // line"): now reads SFEDashboard.getFilteredHeadcountForLine(bu, line)
  // directly instead of the pre-collected multi-BU summaries.sfe dict --
  // same pattern buildCoverageFamilyCard()/buildSalesAchievementCard()
  // already use, so ranking flips to "Lines within BU" when a line is
  // selected, exactly like every other Line-aware card on this page.
  // ---------------------------------------------------------------------
  function buildSFECard(filters, summaries) {
    const bu = filters.bu, line = filters.line;
    const scoped = safeCall("sfe", "SFEDashboard", "getFilteredHeadcountForLine", bu, line === "All" ? null : line);
    if (!scoped || !scoped.ok) return unavailableCard("sfe", "Sales Force Health", scoped ? scoped.status : "module_unavailable");
    const fillRatePct = scoped.vacancyRatePct !== null ? 100 - scoped.vacancyRatePct : null;

    let rankInfo, rankUnit;
    const activeLine = (line !== "All") ? line : (global.AUTH && global.AUTH.getScope().lines && global.AUTH.getScope().lines.length === 1 ? global.AUTH.getScope().lines[0] : null);
    if (!activeLine && !isBuRestricted()) {
      const vals = {};
      getAllowedBUList().forEach(b => {
        const r = safeCall("sfe", "SFEDashboard", "getFilteredHeadcountForLine", b, null);
        vals[b] = (r && r.ok && r.vacancyRatePct !== null) ? r.vacancyRatePct : null;
      });
      rankInfo = rank(vals, "asc")[bu]; // lower vacancy = better = rank 1
      rankUnit = "Business Units";
    } else {
      const lines = getAllowedLinesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const r = safeCall("sfe", "SFEDashboard", "getFilteredHeadcountForLine", bu, l);
        vals[l] = (r && r.ok && r.vacancyRatePct !== null) ? r.vacancyRatePct : null;
      });
      const rankKey = activeLine || line;
      rankInfo = rank(vals, "asc")[rankKey];
      rankUnit = "Lines within " + bu;
    }

    const refEntry = sfeReferenceEntry(bu, line, summaries);
    const activeLineLabel = activeLine || (global.AUTH && global.AUTH.getScope().lines ? global.AUTH.getScope().lines.join(", ") : "");

    return {
      kpiId: "sfe", name: "Sales Force Health",
      mainValue: fmtInt(scoped.headcountTotal), mainValueSub: "Total Manpower · Active " + fmtInt(scoped.headcountActive) + " · Vacant " + fmtInt(scoped.headcountVacant) + (activeLineLabel ? " · " + activeLineLabel : ""),
      performance: { target: "100% Filled", achievementPct: fmtPct1(fillRatePct), variance: fmtSignedPts(scoped.vacancyRatePct !== null ? -scoped.vacancyRatePct : null) + " vacancy" },
      comparison: refEntry ? [refEntry] : null,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: rankUnit,
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
    // CHC Exception: use "CHC" line when BU is CHC and line is "All" or null
    const targetLine = (bu === "CHC" && (line === "All" || !line)) ? "CHC" : (line === "All" ? null : line);
    const scoped = safeCall("sales", "SalesDashboard", "getSalesAchievementSummary", bu, targetLine, undefined, activeScenario());
    if (!scoped || !scoped.ok) return unavailableCard("salesAchievement", "Sales Achievement", scoped ? scoped.status : "module_unavailable");

    let rankInfo, rankUnit;
    const activeLine = (line !== "All") ? line : (global.AUTH && global.AUTH.getScope().lines && global.AUTH.getScope().lines.length === 1 ? global.AUTH.getScope().lines[0] : null);
    if (!activeLine && !isBuRestricted()) {
      const vals = {};
      getAllowedBUList().forEach(b => {
        const targetBLine = (b === "CHC") ? "CHC" : null;
        const s = safeCall("sales", "SalesDashboard", "getSalesAchievementSummary", b, targetBLine, undefined, activeScenario());
        vals[b] = (s && s.ok) ? s.achievementPct : null;
      });
      rankInfo = rank(vals, "desc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = getAllowedLinesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const s = safeCall("sales", "SalesDashboard", "getSalesAchievementSummary", bu, l, undefined, activeScenario());
        vals[l] = (s && s.ok) ? s.achievementPct : null;
      });
      const rankKey = activeLine || line;
      rankInfo = rank(vals, "desc")[rankKey];
      rankUnit = "Lines within " + bu;
    }

    const refEntry = salesAchievementReferenceEntry(bu, line);
    const activeLineLabel = activeLine || (global.AUTH && global.AUTH.getScope().lines ? global.AUTH.getScope().lines.join(", ") : "");

    return {
      kpiId: "salesAchievement", name: "Sales Achievement",
      mainValue: fmtPct1(scoped.achievementPct), mainValueSub: "Non-Tender · Current YTD" + (activeLineLabel ? " · " + activeLineLabel : ""),
      performance: { target: fmtM(scoped.targetYTD), achievementPct: fmtPct1(scoped.achievementPct), variance: fmtSignedM(scoped.actualYTD - scoped.targetYTD) },
      comparison: refEntry ? [refEntry] : null,
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
  function nonTenderTotals(bu, line, ignoreLineAuth, scenario) {
    const targetLine = (bu === "CHC" && (line === "All" || !line)) ? "CHC" : (line === "All" ? null : line);
    const data = safeCall("sales", "SalesDashboard", "getBrandAchievement", bu, targetLine, ignoreLineAuth, scenario || activeScenario());
    if (!data || !data.ok) return null;
    let actualValue = 0, targetValue = 0;
    data.brands.forEach(b => { actualValue += b.actualValue; targetValue += b.targetValue; });
    return { actualValue: actualValue, targetValue: targetValue, achievementPct: targetValue > 0 ? (actualValue / targetValue) * 100 : null, scenario: data.scenario };
  }

  // ---------------------------------------------------------------------
  // KPI -- Sales Units Achievement (2026-08-02 addition)
  // UNITS basis (actualQty/targetQty), a deliberately DIFFERENT cut from
  // Sales Value above (Value/EGP basis) -- a brand/line can be ahead on
  // Value while behind on Units (mix/pricing effects) or vice versa, so
  // this is its own card, not a relabeling of Sales Value. Same source
  // (getBrandAchievement()'s already-computed Non-Tender, BU/line-scoped
  // per-brand rows) and same "sum the brands" pattern as
  // nonTenderTotals() -- just totals actualQty/targetQty instead of
  // actualValue/targetValue, so it can never drift out of sync with the
  // Value card's underlying row set.
  // ---------------------------------------------------------------------
  function nonTenderUnitsTotals(bu, line, ignoreLineAuth, scenario) {
    const targetLine = (bu === "CHC" && (line === "All" || !line)) ? "CHC" : (line === "All" ? null : line);
    const data = safeCall("sales", "SalesDashboard", "getBrandAchievement", bu, targetLine, ignoreLineAuth, scenario || activeScenario());
    if (!data || !data.ok) return null;
    let actualQty = 0, targetQty = 0;
    data.brands.forEach(b => { actualQty += b.actualQty; targetQty += b.targetQty; });
    return { actualQty: actualQty, targetQty: targetQty, achievementPct: targetQty > 0 ? (actualQty / targetQty) * 100 : null, scenario: data.scenario };
  }

  function buildSalesValueCard(filters) {
    const bu = filters.bu, line = filters.line;
    const t = nonTenderTotals(bu, line);
    if (!t) return unavailableCard("salesValue", "Sales Value", "module_unavailable");

    let rankInfo, rankUnit;
    const activeLine = (line !== "All") ? line : (global.AUTH && global.AUTH.getScope().lines && global.AUTH.getScope().lines.length === 1 ? global.AUTH.getScope().lines[0] : null);
    if (!activeLine && !isBuRestricted()) {
      const vals = {};
      getAllowedBUList().forEach(b => {
        const bt = nonTenderTotals(b, b === "CHC" ? "CHC" : "All");
        vals[b] = bt ? bt.achievementPct : null;
      });
      rankInfo = rank(vals, "desc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = getAllowedLinesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const lt = nonTenderTotals(bu, l);
        vals[l] = lt ? lt.achievementPct : null;
      });
      const rankKey = activeLine || line;
      rankInfo = rank(vals, "desc")[rankKey];
      rankUnit = "Lines within " + bu;
    }

    const refEntry = salesValueReferenceEntry(bu, line);
    const activeLineLabel = activeLine || (global.AUTH && global.AUTH.getScope().lines ? global.AUTH.getScope().lines.join(", ") : "");

    return {
      kpiId: "salesValue", name: "Sales Value",
      mainValue: fmtM(t.actualValue), mainValueSub: "Non-Tender · Current YTD" + (activeLineLabel ? " · " + activeLineLabel : ""),
      performance: { target: fmtM(t.targetValue), achievementPct: fmtPct1(t.achievementPct), variance: fmtSignedM(t.actualValue - t.targetValue) },
      comparison: refEntry ? [refEntry] : null,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: rankUnit,
      status: statusFromAchievement(t.achievementPct),
      trend: null, trendLabel: null,
      clickable: true, dblClickable: true,
    };
  }

  // ---------------------------------------------------------------------
  // KPI -- Sales Units Achievement (2026-08-02, "add card for sales units
  // achievement with popup show brand units target actual and achievement
  // and contribution by brand and item for chc"): mirrors buildSalesValueCard()
  // exactly, but on UNITS basis throughout -- main value, target/variance,
  // ranking, comparison row and status all key off actualQty/targetQty
  // (nonTenderUnitsTotals()) instead of actualValue/targetValue.
  // ---------------------------------------------------------------------
  function buildSalesUnitsAchievementCard(filters) {
    const bu = filters.bu, line = filters.line;
    const t = nonTenderUnitsTotals(bu, line);
    if (!t) return unavailableCard("salesUnitsAchievement", "Sales Units Achievement", "module_unavailable");

    let rankInfo, rankUnit;
    const activeLine = (line !== "All") ? line : (global.AUTH && global.AUTH.getScope().lines && global.AUTH.getScope().lines.length === 1 ? global.AUTH.getScope().lines[0] : null);
    if (!activeLine && !isBuRestricted()) {
      const vals = {};
      getAllowedBUList().forEach(b => {
        const bt = nonTenderUnitsTotals(b, b === "CHC" ? "CHC" : "All");
        vals[b] = bt ? bt.achievementPct : null;
      });
      rankInfo = rank(vals, "desc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = getAllowedLinesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const lt = nonTenderUnitsTotals(bu, l);
        vals[l] = lt ? lt.achievementPct : null;
      });
      const rankKey = activeLine || line;
      rankInfo = rank(vals, "desc")[rankKey];
      rankUnit = "Lines within " + bu;
    }

    const refEntry = salesUnitsReferenceEntry(bu, line);
    const activeLineLabel = activeLine || (global.AUTH && global.AUTH.getScope().lines ? global.AUTH.getScope().lines.join(", ") : "");

    return {
      kpiId: "salesUnitsAchievement", name: "Sales Units Achievement",
      mainValue: fmtInt(t.actualQty) + " units", mainValueSub: "Non-Tender · Current YTD" + (activeLineLabel ? " · " + activeLineLabel : ""),
      performance: { target: fmtInt(t.targetQty) + " units", achievementPct: fmtPct1(t.achievementPct), variance: fmtInt(t.actualQty - t.targetQty) + " units" },
      comparison: refEntry ? [refEntry] : null,
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
    if (line === "All" && !isBuRestricted()) {
      const vals = {};
      getAllowedBUList().forEach(b => {
        const bd = safeCall("sales", "SalesDashboard", "getCustomerClusterMix", b, null);
        vals[b] = (bd && bd.ok && bd.clusters.length) ? bd.clusters[0].contributionPct : null;
      });
      rankInfo = rank(vals, "asc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = getAllowedLinesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const ld = safeCall("sales", "SalesDashboard", "getCustomerClusterMix", bu, l);
        vals[l] = (ld && ld.ok && ld.clusters.length) ? ld.clusters[0].contributionPct : null;
      });
      rankInfo = rank(vals, "asc")[line];
      rankUnit = "Lines within " + bu;
    }

    const refEntry = clusterMixReferenceEntry(bu, line);

    return {
      kpiId: "customerClusterMix", name: "Customer Channel Mix",
      mainValue: fmtPct1(concentrationPct), mainValueSub: "Top Channel: " + top.name + " · Non-Tender YTD" + (line !== "All" ? " · " + line : ""),
      performance: null,
      comparison: refEntry ? [refEntry] : null,
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
  //
  // MADE LINE-AWARE 2026-07-29 ("let all cards dynamic with filters
  // line"): getDM1DM2MarketIntel(bu, line) now scopes its blended total
  // to just that line's DM1/DM2 markets (see the extended doc comment on
  // that function in js/iqvia.js). Ranking flips to "Lines within BU",
  // same pattern as every other Line-aware card.
  // ---------------------------------------------------------------------
  function buildMarketShareCard(filters) {
    const bu = filters.bu, line = filters.line;
    const lineArg = line === "All" ? null : (line === "CHC_SALES" ? "CHC" : line);
    const dm1dm2 = safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", bu, lineArg);
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

    let rankInfo, rankUnit;
    const activeLine = (line !== "All") ? line : (global.AUTH && global.AUTH.getScope().lines && global.AUTH.getScope().lines.length === 1 ? global.AUTH.getScope().lines[0] : null);
    if (!activeLine && !isBuRestricted()) {
      const vals = {};
      getAllowedBUList().forEach(b => {
        const bd1d2 = b === bu ? dm1dm2 : safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", b, null);
        vals[b] = (bd1d2 && bd1d2.ok && bd1d2.total) ? avg(bd1d2.total.dm1.ytd.su.sharePct, bd1d2.total.dm2.ytd.su.sharePct) : null;
      });
      rankInfo = rank(vals, "desc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = getAllowedLinesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const queryLine = l === "CHC_SALES" ? "CHC" : l;
        const ld1d2 = l === activeLine ? dm1dm2 : safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", bu, queryLine);
        vals[l] = (ld1d2 && ld1d2.ok && ld1d2.total) ? avg(ld1d2.total.dm1.ytd.su.sharePct, ld1d2.total.dm2.ytd.su.sharePct) : null;
      });
      const rankKey = activeLine || line;
      rankInfo = rank(vals, "desc")[rankKey];
      rankUnit = "Lines within " + bu;
    }

    function formatDmLabel(name, fallback) {
      if (!name) return fallback;
      name = name.trim();
      if (name.length > 22) {
        return "vs " + name.substring(0, 19) + "...";
      }
      return "vs " + name;
    }

    const isSingleSegment = (dm1dm2.segments && dm1dm2.segments.length === 1);
    const dm1Label = isSingleSegment ? formatDmLabel(dm1dm2.segments[0].dm1Name, "vs DM1") : "vs DM1";
    const dm2Label = isSingleSegment ? formatDmLabel(dm1dm2.segments[0].dm2Name, "vs DM2") : "vs DM2";

    const comparison = [
      { label: dm1Label, value: fmtPct1(d1.sharePct) },
      { label: dm2Label, value: fmtPct1(d2.sharePct) },
    ];

    const activeLineLabel = activeLine || (global.AUTH && global.AUTH.getScope().lines ? global.AUTH.getScope().lines.join(", ") : "");

    return {
      kpiId: "marketShare", name: "Market Share",
      mainValue: fmtPct1(sharePct), mainValueSub: "YTD · SU basis · excl. Other Markets" + (activeLineLabel ? " · " + activeLineLabel : ""),
      performance: { target: fmtPct1(targetPct), achievementPct: fmtPct1(achievementPct), variance: fmtSignedPts(gapPts) },
      comparison: comparison,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: rankUnit,
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
  //
  // MADE LINE-AWARE 2026-07-29 ("let all cards dynamic with filters
  // line"): same getDM1DM2MarketIntel(bu, line) extension as Market
  // Share (KPI 8) above. Ranking flips to "Lines within BU" when a line
  // is selected.
  // ---------------------------------------------------------------------
  function buildBUGrowthCard(filters) {
    const bu = filters.bu, line = filters.line;
    const lineArg = line === "All" ? null : (line === "CHC_SALES" ? "CHC" : line);
    const dm1dm2 = safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", bu, lineArg);
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

    function growthGapFor(d1d2) {
      if (!d1d2 || !d1d2.ok || !d1d2.total) return null;
      const bz = avg(d1d2.total.dm1.ytd.su.zetaGrowthPct, d1d2.total.dm2.ytd.su.zetaGrowthPct);
      const bm = avg(d1d2.total.dm1.ytd.su.marketGrowthPct, d1d2.total.dm2.ytd.su.marketGrowthPct);
      return (bz != null && bm != null) ? bz - bm : null;
    }

    let rankInfo, rankUnit;
    const activeLine = (line !== "All") ? line : (global.AUTH && global.AUTH.getScope().lines && global.AUTH.getScope().lines.length === 1 ? global.AUTH.getScope().lines[0] : null);
    if (!activeLine && !isBuRestricted()) {
      const vals = {};
      getAllowedBUList().forEach(b => {
        const bd1d2 = b === bu ? dm1dm2 : safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", b, null);
        vals[b] = growthGapFor(bd1d2);
      });
      rankInfo = rank(vals, "desc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = getAllowedLinesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const queryLine = l === "CHC_SALES" ? "CHC" : l;
        const ld1d2 = l === activeLine ? dm1dm2 : safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", bu, queryLine);
        vals[l] = growthGapFor(ld1d2);
      });
      const rankKey = activeLine || line;
      rankInfo = rank(vals, "desc")[rankKey];
      rankUnit = "Lines within " + bu;
    }

    function formatDmLabel(name, fallback) {
      if (!name) return fallback;
      name = name.trim();
      if (name.length > 22) {
        return "vs " + name.substring(0, 19) + "...";
      }
      return "vs " + name;
    }

    const isSingleSegment = (dm1dm2.segments && dm1dm2.segments.length === 1);
    const dm1Label = isSingleSegment ? formatDmLabel(dm1dm2.segments[0].dm1Name, "vs DM1") : "vs DM1";
    const dm2Label = isSingleSegment ? formatDmLabel(dm1dm2.segments[0].dm2Name, "vs DM2") : "vs DM2";

    const comparison = [
      { label: dm1Label, value: "SU " + fmtSignedPct(d1su.zetaGrowthPct) + " · Val " + fmtSignedPct(d1val.zetaGrowthPct) },
      { label: dm2Label, value: "SU " + fmtSignedPct(d2su.zetaGrowthPct) + " · Val " + fmtSignedPct(d2val.zetaGrowthPct) },
    ];

    const activeLineLabel = activeLine || (global.AUTH && global.AUTH.getScope().lines ? global.AUTH.getScope().lines.join(", ") : "");
    const cardName = (global.AUTH && global.AUTH.getScope().lines) ? "Line Growth" : "Business Unit Growth";

    return {
      kpiId: "buGrowth", name: cardName,
      mainValue: fmtSignedPct(zetaGrowth), mainValueSub: "Zeta Growth · YTD SU (Value basis: " + fmtSignedPct(zetaGrowthVal) + ")" + (activeLineLabel ? " · " + activeLineLabel : ""),
      performance: { target: "Market " + fmtSignedPct(marketGrowth), achievementPct: fmtPct1(evi), variance: fmtSignedPts(growthGap) + " gap" },
      comparison: comparison,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: rankUnit,
      status: statusFromAchievement(evi),
      trend: evi !== null ? (evi >= 100 ? "up" : "down") : null,
      trendLabel: evi !== null ? "EI Index " + Math.round(evi) : "EI Index unavailable",
      clickable: false, dblClickable: true,
    };
  }

  // ---------------------------------------------------------------------
  // KPI 10 -- Sales Productivity
  // REDEFINED 2026-07-29 to match the Sales tab's own "SALES / POSITION"
  // KPI methodology: Sales' actualYTD (EGP) / Sales' own activePositions
  // (distinct deployed territory codes, 7 known placeholder/unknown codes
  // excluded -- see EXCLUDED_POSITIONS in js/sales.js), platform-wide
  // average as the benchmark. Previously this divided by SFE's
  // headcountActive (employed reps) instead -- switched to Sales' own
  // position count so this KPI reads "revenue per deployed territory"
  // consistently with the Sales tab, rather than "revenue per employed
  // rep" (a materially different denominator: headcount includes reps on
  // leave/vacant-adjacent assignments, position count reflects actual
  // territory deployment).
  //
  // MADE LINE-AWARE 2026-07-29 ("let all cards dynamic with filters
  // line"). Two branches, each internally consistent but on a DIFFERENT
  // basis from each other -- flagged here and in the card's trendLabel
  // rather than silently glossed over:
  //   - line="All": unchanged from the redefinition above. Sourced from
  //     Sales' getBusinessSummary() (per-BU actualYTD/activePositions),
  //     which is an ALL-TRANSACTION basis (Tender + Non-Tender) --
  //     matches the Sales tab's own SALES/POSITION card exactly.
  //   - line set: sourced from Sales' getLineSalesSummary(bu), which is
  //     Non-Tender ONLY (same basis as Sales Achievement/Line
  //     Performance elsewhere on this page -- see that function's own
  //     doc comment in js/sales.js). Benchmark reframes from "platform
  //     avg" to "<BU> avg" (this BU's own other lines), since comparing
  //     one line's per-position productivity against the whole
  //     platform's would compare very different population sizes.
  // A value discontinuity when toggling Line between "All" and a
  // specific line is therefore expected (different transaction scope,
  // different benchmark population) -- not a bug. Unifying both onto one
  // basis is a reasonable follow-up if wanted, but wasn't done here to
  // avoid silently changing the already-validated "All" mode numbers.
  // ---------------------------------------------------------------------
  function buildSalesProductivityCard(summaries, filters) {
    const bu = filters.bu, line = filters.line;
    if (!summaries.sales || !summaries.sales.ok) {
      return unavailableCard("salesProductivity", "Sales Productivity", "module_unavailable");
    }

    let val, platformAvg, targetPerPosition, rankInfo, rankUnit, basisNote, isWholeBuView = false;
    const activeLine = (line !== "All") ? line : (global.AUTH && global.AUTH.getScope().lines && global.AUTH.getScope().lines.length === 1 ? global.AUTH.getScope().lines[0] : null);

    if (!activeLine && !isBuRestricted()) {
      const perBU = {};
      let platformActual = 0, platformPositions = 0;
      getAllowedBUList().forEach(b => {
        const s = summaries.sales.bu[b];
        if (s && s.activePositions > 0) {
          perBU[b] = s.actualYTD / s.activePositions;
          platformActual += s.actualYTD; platformPositions += s.activePositions;
        } else {
          perBU[b] = null;
        }
      });
      platformAvg = platformPositions > 0 ? platformActual / platformPositions : null;

      // Target per Position (2026-08-04, "Target is target per position"):
      // this BU's own assigned sales target (summaries.sales.bu[bu].targetYTD,
      // already computed by getSalesOverview from cache TGT_VAL) divided by
      // its deployed positions -- a real SFE target, not a peer-average
      // benchmark. The old behavior showed platformAvg (other BUs' actual
      // performance) relabeled as "Target", which conflated "what similar
      // teams achieved" with "what this team was assigned to hit" -- two
      // different things. Peer comparison is NOT removed, just no longer
      // masquerading as the target -- it still shows below as "vs Corporate".
      let thisBuTargetYTD = (summaries.sales.bu[bu] || {}).targetYTD || null;
      let thisBuPositions = (summaries.sales.bu[bu] || {}).activePositions || null;

      // CHC mirror-image special case (2026-08-04, Ahmed: "chc and chc
      // sales is mirror image to each other... productivity of bu = [CHC
      // line's own] actual/49 and target/49" -- 49 = SFE's PLANNED
      // headcount for CHC (31) + CHC_SALES (18), confirmed against
      // cache/organogram.data.js's vacancyByLine; this differs from the
      // Sales-cache activePositions count (31+19=50) used elsewhere on
      // this card, which counts distinct position CODES seen in actual
      // transactions rather than planned/budgeted headcount.
      //
      // Unlike every OTHER multi-line BU (DIAB's 4 lines are genuinely
      // independent products, not mirrors of one another -- this rule does
      // NOT generalize past CHC), CHC's "CHC" and "CHC_SALES" lines are
      // explicitly confirmed as a mirrored pair. So the BU-wide
      // productivity figure uses CHC line's OWN actual/target as the
      // numerator (NOT summed with CHC_SALES -- that 46.4M/98.6M is still
      // tracked as its own separate line everywhere else: Sales Value/
      // Achievement KPIs, Line Performance table, and this same card's own
      // per-Line view when CHC_SALES is selected directly -- none of that
      // changes), but the FULL combined planned headcount of BOTH lines as
      // the denominator, since both lines' reps are deployed CHC BU
      // workforce regardless of which line's revenue is being measured.
      if (bu === "CHC") {
        const chcLineData = safeCall("sales", "SalesDashboard", "getLineSalesSummary", "CHC", null, true, activeScenario());
        const chcHeadcount = safeCall("sfe", "SFEDashboard", "getFilteredHeadcountForLine", "CHC", null, true);
        const chcLineOnly = (chcLineData && chcLineData.ok) ? chcLineData.lines.find(l => l.name === "CHC") : null;
        const combinedPositions = (chcHeadcount && chcHeadcount.ok) ? chcHeadcount.headcountTotal : null;
        if (chcLineOnly && combinedPositions > 0) {
          perBU["CHC"] = chcLineOnly.actualValue / combinedPositions;
          thisBuTargetYTD = chcLineOnly.targetValue;
          thisBuPositions = combinedPositions;
        }
      }

      val = perBU[bu];
      rankInfo = rank(perBU, "desc")[bu];
      rankUnit = "Business Units";
      targetPerPosition = (thisBuPositions && thisBuPositions > 0) ? thisBuTargetYTD / thisBuPositions : null;
      basisNote = "Target = " + bu + "'s assigned sales target ÷ deployed positions. All-transaction basis."
        + (bu === "CHC" ? " CHC figure uses CHC line's own actual/target ÷ CHC+CHC_SALES combined planned positions (49) -- the two lines mirror each other, see 2026-08-04 note." : "")
        + scenarioFallbackNote(bu);
    } else {
      const isLineMgr = global.AUTH && global.AUTH.getScope().lines !== null;
      const lineData = safeCall("sales", "SalesDashboard", "getLineSalesSummary", bu, null, isLineMgr || activeLine || line !== "All", activeScenario());
      if (!lineData || !lineData.ok) {
        return unavailableCard("salesProductivity", "Sales Productivity", lineData ? lineData.status : "module_unavailable");
      }
      const perLine = {};
      let buActual = 0, buTarget = 0, buPositions = 0;
      const allowedLines = new Set(getAllowedLinesForBU(bu));
      lineData.lines.forEach(l => {
        if (allowedLines.has(l.name)) {
          perLine[l.name] = l.activePositions > 0 ? l.salesPerPosition : null;
        }
        buActual += l.actualValue; buTarget += l.targetValue; buPositions += l.activePositions;
      });
      platformAvg = buPositions > 0 ? buActual / buPositions : null;
      // Target per Position, Line-aware (2026-08-04, "when filter line the
      // target per position within line as well"): a specific Line's own
      // targetValue/activePositions when one is selected (getLineSalesSummary
      // already carries both per line); the whole-BU blended target/position
      // across every visible line otherwise. This is now a genuine,
      // independent figure (target isn't necessarily proportional to
      // headcount the way actuals roughly are), so -- unlike the old
      // platformAvg-as-target, which was circular here since val WAS
      // platformAvg -- achievement is meaningful in the whole-BU view too,
      // not just the single-Line view.
      if (!activeLine) {
        val = platformAvg;
        targetPerPosition = buPositions > 0 ? buTarget / buPositions : null;
        // CHC mirror-image special case (2026-08-04) -- same rule as the
        // cross-BU branch above, for a BU-restricted CHC user (or CHC_SALES
        // Line Manager) viewing the whole-BU figure with no Line filter:
        // CHC line's own actual/target, divided by BOTH lines' combined
        // SFE planned headcount (31+18=49), not the blended
        // actual/target-across-both-lines this branch normally computes.
        if (bu === "CHC") {
          const chcLineOnly = lineData.lines.find(l => l.name === "CHC");
          const chcHeadcount = safeCall("sfe", "SFEDashboard", "getFilteredHeadcountForLine", "CHC", null, true);
          const combinedPositions = (chcHeadcount && chcHeadcount.ok) ? chcHeadcount.headcountTotal : null;
          if (chcLineOnly && combinedPositions > 0) {
            val = chcLineOnly.actualValue / combinedPositions;
            targetPerPosition = chcLineOnly.targetValue / combinedPositions;
          }
        }
        rankInfo = null;
        rankUnit = null;
        isWholeBuView = true;
      } else {
        val = perLine[activeLine] !== undefined ? perLine[activeLine] : null;
        const lineEntry = lineData.lines.find(l => l.name === activeLine);
        targetPerPosition = (lineEntry && lineEntry.activePositions > 0) ? lineEntry.targetValue / lineEntry.activePositions : null;
        const rankKey = activeLine || line;
        rankInfo = rank(perLine, "desc")[rankKey];
        rankUnit = "Lines within " + bu;
      }
      basisNote = (isWholeBuView ? "Target = " + bu + "'s" : "Target = " + activeLine + "'s") + " assigned sales target ÷ deployed positions. Non-Tender basis (differs from the platform-wide 'All' view, which is all-transaction)."
        + scenarioFallbackNote(isWholeBuView ? bu : activeLine);
    }

    const achievementPct = (val !== null && targetPerPosition) ? (val / targetPerPosition) * 100 : null;
    const isLineMgr = global.AUTH && global.AUTH.getScope().lines !== null;
    const refEntry = (isLineMgr || activeLine || line !== "All")
      ? (platformAvg !== null ? { label: "vs " + bu, value: fmtM(platformAvg) } : null)
      : (function () {
          const v = corporateSalesProductivity(summaries);
          return v !== null ? { label: "vs Corporate", value: fmtM(v) } : null;
        })();

    const activeLineLabel = activeLine || (global.AUTH && global.AUTH.getScope().lines ? global.AUTH.getScope().lines.join(", ") : "");

    return {
      kpiId: "salesProductivity", name: "Sales Productivity",
      mainValue: fmtM(val), mainValueSub: "Sales per Deployed Position · Current YTD" + (activeLineLabel ? " · " + activeLineLabel : ""),
      performance: { target: targetPerPosition !== null ? fmtM(targetPerPosition) : "—", achievementPct: fmtPct1(achievementPct), variance: fmtSignedM(val !== null && targetPerPosition !== null ? val - targetPerPosition : null) },
      comparison: refEntry ? [refEntry] : null,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: rankUnit,
      status: statusFromAchievement(achievementPct),
      trend: null, trendLabel: basisNote,
      clickable: false, dblClickable: true,
    };
  }

  // ---------------------------------------------------------------------
  // TMS vs IMS Helper & KPI Card Builders
  // ---------------------------------------------------------------------
  function getTmsImsMetrics(bu, line) {
    if (line === "CHC_SALES") {
      line = "CHC";
    }
    if (!window.TMS_IMS_CACHE) {
      return { ok: false, status: "cache_unavailable" };
    }
    const cache = window.TMS_IMS_CACHE;
    const buMap = { "CHC": "CHC", "Cluster": "Cluster", "DIAB": "Diabetes", "GIT": "GIT" };
    const targetBuName = buMap[bu] || bu;
    const buIdx = cache.BUS.indexOf(targetBuName);
    if (buIdx < 0) return { ok: false, status: "bu_not_found" };

    const privateIdx = cache.STYPES.indexOf("Private");
    if (privateIdx < 0) return { ok: false, status: "type_not_found" };

    // Determine target lines in scope
    let lineIndices = null;
    if (line && line !== "All") {
      const normLine = window.SEMANTIC.normalizeLine(line).toUpperCase();
      lineIndices = [];
      cache.LINES.forEach((l, idx) => {
        const canonL = window.SEMANTIC.normalizeLine(l).toUpperCase();
        if (canonL === normLine || l.toUpperCase() === normLine) {
          lineIndices.push(idx);
        }
      });
    }

    const latestMonthIdx = cache.MONTHS.length - 1;
    const prevMonthIdx = latestMonthIdx - 1;
    let tmsLatestUnits = 0;
    let imsLatestUnits = 0;
    let tmsPreviousUnits = 0;
    let totalTmsUnits = 0;
    let totalImsUnits = 0;

    const monthlyTms = {};
    const monthlyIms = {};

    const velocityMonthIndices = [latestMonthIdx, latestMonthIdx - 1, latestMonthIdx - 2].filter(m => m >= 0);
    let imsVelocityUnits = 0;

    cache.ROWS.forEach(r => {
      if (r[1] !== buIdx) return;
      if (r[5] !== privateIdx) return;
      if (lineIndices && !lineIndices.includes(r[2])) return;

      const mIdx = r[0];
      const isIms = (r[6] === 1);
      const isTms = (r[6] === 0);
      const qty = r[7] || 0;

      if (isTms) {
        totalTmsUnits += qty;
        monthlyTms[mIdx] = (monthlyTms[mIdx] || 0) + qty;
      }
      if (isIms) {
        totalImsUnits += qty;
        monthlyIms[mIdx] = (monthlyIms[mIdx] || 0) + qty;
      }

      if (mIdx === latestMonthIdx) {
        if (isTms) tmsLatestUnits += qty;
        if (isIms) imsLatestUnits += qty;
      }

      if (mIdx === prevMonthIdx) {
        if (isTms) tmsPreviousUnits += qty;
      }

      if (isIms && velocityMonthIndices.includes(mIdx)) {
        imsVelocityUnits += qty;
      }
    });

    let sumRates = 0;
    let countRates = 0;
    for (let m = 1; m < cache.MONTHS.length; m++) {
      const tmsPrev = monthlyTms[m - 1] || 0;
      const imsCurr = monthlyIms[m] || 0;
      if (tmsPrev > 0) {
        sumRates += (imsCurr / tmsPrev) * 100;
        countRates++;
      }
    }
    const pullThroughRate = countRates > 0 ? (sumRates / countRates) : null;
    const activeMonthsCount = velocityMonthIndices.length;
    const dailyVelocity = (activeMonthsCount > 0) ? (imsVelocityUnits / (activeMonthsCount * 30)) : 0;
    const calculatedInventory = totalTmsUnits - totalImsUnits;
    const currentInventory = calculatedInventory > 0 ? calculatedInventory : null;
    const stockDays = (currentInventory !== null && dailyVelocity > 0) ? (currentInventory / dailyVelocity) : null;

    return {
      ok: true,
      pullThroughRate,
      stockDays,
      currentInventory,
      latestMonthLabel: cache.MONTHS[latestMonthIdx]
    };
  }

  function getTmsImsDetailedBreakdown(bu, line) {
    if (line === "CHC_SALES") {
      line = "CHC";
    }
    if (!window.TMS_IMS_CACHE) return null;
    const cache = window.TMS_IMS_CACHE;
    const buMap = { "CHC": "CHC", "Cluster": "Cluster", "DIAB": "Diabetes", "GIT": "GIT" };
    const targetBuName = buMap[bu] || bu;
    const buIdx = cache.BUS.indexOf(targetBuName);
    if (buIdx < 0) return null;

    const privateIdx = cache.STYPES.indexOf("Private");
    if (privateIdx < 0) return null;

    // Determine target lines in scope
    let lineIndices = null;
    if (line && line !== "All") {
      const normLine = window.SEMANTIC.normalizeLine(line).toUpperCase();
      lineIndices = [];
      cache.LINES.forEach((l, idx) => {
        const canonL = window.SEMANTIC.normalizeLine(l).toUpperCase();
        if (canonL === normLine || l.toUpperCase() === normLine) {
          lineIndices.push(idx);
        }
      });
    }

    const latestMonthIdx = cache.MONTHS.length - 1;
    const prevMonthIdx = latestMonthIdx - 1;
    const velocityMonthIndices = [latestMonthIdx, latestMonthIdx - 1, latestMonthIdx - 2].filter(m => m >= 0);

    const brandData = {};
    const productData = {};

    cache.ROWS.forEach(r => {
      if (r[1] !== buIdx) return;
      if (r[5] !== privateIdx) return;
      if (lineIndices && !lineIndices.includes(r[2])) return;

      const mIdx = r[0];
      const brIdx = r[3];
      const prodIdx = r[4];
      const isIms = (r[6] === 1);
      const isTms = (r[6] === 0);
      const qty = r[7] || 0;

      if (!brandData[brIdx]) {
        brandData[brIdx] = { totalTms: 0, totalIms: 0, velocityIms: 0, monthlyTms: {}, monthlyIms: {} };
      }
      if (!productData[prodIdx]) {
        productData[prodIdx] = { brandIdx: brIdx, totalTms: 0, totalIms: 0, velocityIms: 0, monthlyTms: {}, monthlyIms: {} };
      }

      const br = brandData[brIdx];
      const prod = productData[prodIdx];

      if (isTms) {
        br.totalTms += qty;
        prod.totalTms += qty;
        br.monthlyTms[mIdx] = (br.monthlyTms[mIdx] || 0) + qty;
        prod.monthlyTms[mIdx] = (prod.monthlyTms[mIdx] || 0) + qty;
      }
      if (isIms) {
        br.totalIms += qty;
        prod.totalIms += qty;
        br.monthlyIms[mIdx] = (br.monthlyIms[mIdx] || 0) + qty;
        prod.monthlyIms[mIdx] = (prod.monthlyIms[mIdx] || 0) + qty;
      }

      if (isIms && velocityMonthIndices.includes(mIdx)) {
        br.velocityIms += qty;
        prod.velocityIms += qty;
      }
    });

    const activeMonthsCount = velocityMonthIndices.length;

    const brandsList = Object.keys(brandData).map(k => {
      const brIdx = parseInt(k, 10);
      const data = brandData[brIdx];
      
      let sumRates = 0;
      let countRates = 0;
      for (let m = 1; m < cache.MONTHS.length; m++) {
        const tmsPrev = data.monthlyTms[m - 1] || 0;
        const imsCurr = data.monthlyIms[m] || 0;
        if (tmsPrev > 0) {
          sumRates += (imsCurr / tmsPrev) * 100;
          countRates++;
        }
      }
      const pullThrough = countRates > 0 ? (sumRates / countRates) : null;
      const dailyVelocity = (activeMonthsCount > 0) ? (data.velocityIms / (activeMonthsCount * 30)) : 0;
      const calculatedInventory = data.totalTms - data.totalIms;
      const inventory = calculatedInventory > 0 ? calculatedInventory : null;
      const stockDays = (inventory !== null && dailyVelocity > 0) ? (inventory / dailyVelocity) : null;

      return {
        name: cache.BRANDS[brIdx],
        pullThrough,
        stockDays,
        inventory
      };
    });

    const productsList = Object.keys(productData).map(k => {
      const prodIdx = parseInt(k, 10);
      const data = productData[prodIdx];

      let sumRates = 0;
      let countRates = 0;
      for (let m = 1; m < cache.MONTHS.length; m++) {
        const tmsPrev = data.monthlyTms[m - 1] || 0;
        const imsCurr = data.monthlyIms[m] || 0;
        if (tmsPrev > 0) {
          sumRates += (imsCurr / tmsPrev) * 100;
          countRates++;
        }
      }
      const pullThrough = countRates > 0 ? (sumRates / countRates) : null;
      const dailyVelocity = (activeMonthsCount > 0) ? (data.velocityIms / (activeMonthsCount * 30)) : 0;
      const calculatedInventory = data.totalTms - data.totalIms;
      const inventory = calculatedInventory > 0 ? calculatedInventory : null;
      const stockDays = (inventory !== null && dailyVelocity > 0) ? (inventory / dailyVelocity) : null;

      const rawProdName = cache.PRODUCTS[prodIdx];
      const prodName = rawProdName.includes("|") ? rawProdName.split("|")[1] : rawProdName;

      return {
        name: prodName,
        brandName: cache.BRANDS[data.brandIdx],
        pullThrough,
        stockDays,
        inventory
      };
    });

    return { brands: brandsList, products: productsList };
  }

  function getFlagSpan(val, type) {
    if (val === null || val === undefined || isNaN(val)) {
      return `<span class="ds-exec-status-badge ds-exec-status--no-baseline">No Baseline</span>`;
    }
    if (type === "pullThrough") {
      const status = statusFromAchievement(val);
      const statusClass = "ds-exec-status--" + status.toLowerCase().replace(/\s+/g, "-");
      return `<span class="ds-exec-status-badge ${statusClass}">${status}</span>`;
    } else {
      const status = statusFromStockDays(val);
      const statusClass = "ds-exec-status--" + status.toLowerCase().replace(/\s+/g, "-");
      return `<span class="ds-exec-status-badge ${statusClass}">${status}</span>`;
    }
  }

  function openTmsImsModal(bu, line, metricType) {
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;
    const data = getTmsImsDetailedBreakdown(bu, line);
    if (!data) {
      global.DS.openModal({ title: bu + " — Supply Chain Details", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No data available.</div>" });
      return;
    }

    const isPt = (metricType === "pullThrough");
    const labelBuLine = (line && line !== "All") ? line : bu;

    const brandRows = data.brands.map(b => {
      const val = isPt ? b.pullThrough : b.stockDays;
      const formattedVal = isPt ? (val !== null ? val.toFixed(1) + "%" : "—") : (val !== null ? Math.round(val) + " Days" : "—");
      return {
        name: b.name,
        value: formattedVal,
        flag: getFlagSpan(val, metricType),
        inventory: Math.round(b.inventory).toLocaleString()
      };
    });

    const brandTable = global.DS.table({
      columns: [
        { key: "name", label: "Brand Name" },
        { key: "inventory", label: "Current Inventory (Units)", align: "right" },
        { key: "value", label: isPt ? "Pull-Through Rate" : "Stock Days", align: "right" },
        { key: "flag", label: "Flag", align: "center", isHtml: true }
      ],
      rows: brandRows
    });

    let bodyHtml = `<div style="font-size:14px;font-weight:600;margin-bottom:8px;">Brand Summary (${labelBuLine})</div>` + brandTable;

    if (bu === "CHC") {
      const productRows = data.products.map(p => {
        const val = isPt ? p.pullThrough : p.stockDays;
        const formattedVal = isPt ? (val !== null ? val.toFixed(1) + "%" : "—") : (val !== null ? Math.round(val) + " Days" : "—");
        return {
          name: p.name,
          brandName: p.brandName,
          value: formattedVal,
          flag: getFlagSpan(val, metricType),
          inventory: Math.round(p.inventory).toLocaleString()
        };
      });

      const productTable = global.DS.table({
        columns: [
          { key: "name", label: "Product / SKU" },
          { key: "brandName", label: "Brand" },
          { key: "inventory", label: "Current Inventory (Units)", align: "right" },
          { key: "value", label: isPt ? "Pull-Through Rate" : "Stock Days", align: "right" },
          { key: "flag", label: "Flag", align: "center", isHtml: true }
        ],
        rows: productRows
      });

      bodyHtml += `<div style="font-size:14px;font-weight:600;margin-top:20px;margin-bottom:8px;">SKU / Product Details (CHC)</div> scoped to Private segment. Pull-Through Rate uses formula: IMS(M) ÷ TMS(M-1) × 100.<br/><br/>` + productTable;
    }

    const title = isPt ? `${labelBuLine} — Pull-Through Rate Details` : `${labelBuLine} — Distributor Stock Days Details`;
    global.DS.openModal({
      title: title,
      bodyHtml: `<div style="max-height:600px;overflow-y:auto;padding-right:4px;">${bodyHtml}</div>`
    });
  }

  function statusFromStockDays(val) {
    if (val === null || val === undefined || isNaN(val)) return "No Baseline";
    if (val >= 30 && val <= 45) return "Excellent";
    if ((val >= 20 && val < 30) || (val > 45 && val <= 60)) return "On Track";
    if ((val >= 15 && val < 20) || (val > 60 && val <= 90)) return "At Risk";
    return "Critical";
  }

  function buildPullThroughCard(filters) {
    const bu = filters.bu, line = filters.line;
    const scoped = getTmsImsMetrics(bu, line);
    if (!scoped || !scoped.ok) {
      return unavailableCard("pullThroughRate", "Pull-Through Rate", scoped ? scoped.status : "cache_unavailable");
    }

    let rankInfo, rankUnit;
    const activeLine = (line !== "All") ? line : (global.AUTH && global.AUTH.getScope().lines && global.AUTH.getScope().lines.length === 1 ? global.AUTH.getScope().lines[0] : null);
    if (!activeLine && !isBuRestricted()) {
      const vals = {};
      getAllowedBUList().forEach(b => {
        const s = getTmsImsMetrics(b, null);
        vals[b] = (s && s.ok) ? s.pullThroughRate : null;
      });
      rankInfo = rank(vals, "desc")[bu];
      rankUnit = "Business Units";
    } else {
      const lines = getAllowedLinesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const s = getTmsImsMetrics(bu, l);
        vals[l] = (s && s.ok) ? s.pullThroughRate : null;
      });
      const rankKey = activeLine || line;
      rankInfo = rank(vals, "desc")[rankKey];
      rankUnit = "Lines within " + bu;
    }

    const activeLineLabel = activeLine || (global.AUTH && global.AUTH.getScope().lines ? global.AUTH.getScope().lines.join(", ") : "");

    return {
      kpiId: "pullThroughRate", name: "Pull-Through Rate",
      mainValue: scoped.pullThroughRate !== null ? fmtPct1(scoped.pullThroughRate) : "0.0%",
      mainValueSub: "Private Units · " + scoped.latestMonthLabel + (activeLineLabel ? " · " + activeLineLabel : ""),
      performance: { target: "100.0%", achievementPct: scoped.pullThroughRate !== null ? fmtPct1(scoped.pullThroughRate) : "0.0%", variance: scoped.pullThroughRate !== null ? fmtPct1(scoped.pullThroughRate - 100) : "-100.0%" },
      comparison: null,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: rankUnit,
      status: statusFromAchievement(scoped.pullThroughRate),
      trend: null, trendLabel: "Target pull-through velocity threshold: 100% of sell-in units.",
      clickable: true, dblClickable: true,
    };
  }

  function buildStockDaysCard(filters) {
    const bu = filters.bu, line = filters.line;
    const scoped = getTmsImsMetrics(bu, line);
    if (!scoped || !scoped.ok) {
      return unavailableCard("stockDays", "Distributor Stock Days", scoped ? scoped.status : "cache_unavailable");
    }

    let rankInfo, rankUnit;
    const activeLine = (line !== "All") ? line : (global.AUTH && global.AUTH.getScope().lines && global.AUTH.getScope().lines.length === 1 ? global.AUTH.getScope().lines[0] : null);
    if (!activeLine && !isBuRestricted()) {
      const vals = {};
      getAllowedBUList().forEach(b => {
        const s = getTmsImsMetrics(b, null);
        vals[b] = (s && s.ok) ? s.stockDays : null;
      });
      rankInfo = rank(vals, "asc")[bu]; // lower stock days is faster rotation
      rankUnit = "Business Units";
    } else {
      const lines = getAllowedLinesForBU(bu);
      const vals = {};
      lines.forEach(l => {
        const s = getTmsImsMetrics(bu, l);
        vals[l] = (s && s.ok) ? s.stockDays : null;
      });
      const rankKey = activeLine || line;
      rankInfo = rank(vals, "asc")[rankKey];
      rankUnit = "Lines within " + bu;
    }

    const activeLineLabel = activeLine || (global.AUTH && global.AUTH.getScope().lines ? global.AUTH.getScope().lines.join(", ") : "");

    const hasStock = scoped.stockDays !== null && scoped.stockDays !== undefined;
    const hasInventory = scoped.currentInventory !== null && scoped.currentInventory !== undefined;

    return {
      kpiId: "stockDays", name: "Distributor Stock Days",
      mainValue: hasStock ? Math.round(scoped.stockDays) + " Days" : "—",
      mainValueSub: "Private Channel · " + scoped.latestMonthLabel + (activeLineLabel ? " · " + activeLineLabel : ""),
      performance: { 
        target: "30-45 Days", 
        achievementPct: hasStock ? Math.round(scoped.stockDays) + " Days" : "—", 
        variance: hasInventory ? Math.round(scoped.currentInventory).toLocaleString() + " Units" : "— (Excludes Opening Stock)" 
      },
      comparison: null,
      rank: rankInfo ? rankInfo.rank : null, rankOf: rankInfo ? rankInfo.of : null, rankUnit: rankUnit,
      status: statusFromStockDays(scoped.stockDays),
      trend: null, 
      trendLabel: hasInventory 
        ? "Target inventory cover: 30 to 45 stock days. Current: " + Math.round(scoped.currentInventory).toLocaleString() + " Units." 
        : "Target inventory cover: 30 to 45 stock days. Current stock calculation excludes opening stock.",
      clickable: true, dblClickable: true,
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
  function buildLinePerformanceTable(bu, line, months) {
    const scenario = activeScenario();
    const activeLine = (line !== "All") ? line : (global.AUTH && global.AUTH.getScope().lines && global.AUTH.getScope().lines.length === 1 ? global.AUTH.getScope().lines[0] : null);

    if (activeLine) {
      const hierarchy = safeCall("sfe", "SFEDashboard", "getHierarchyList") || [];
      const sfeDms = hierarchy
        .filter(h => window.SEMANTIC.normalizeLine(h.line) === activeLine)
        .map(h => h.dm.trim())
        .filter(dm => dm && dm !== "(none)" && dm.toUpperCase() !== "VACANT");

      const allDms = [...new Set(sfeDms)];

      const salesData = safeCall("sales", "SalesDashboard", "getDmSalesSummary", bu, activeLine, months, scenario);
      const salesByDm = new Map();
      let totalSalesValue = 0;
      if (salesData && salesData.ok) {
        salesData.dms.forEach(d => { salesByDm.set(d.name.toUpperCase().trim(), d); totalSalesValue += d.actualValue; });
      }

      const rows = allDms.map(name => {
        const cov = safeCall("coverage", "CoverageDashboard", "getFilteredCoverageForDm", bu, activeLine, name);
        const coveragePct = (cov && cov.ok) ? cov.coveragePct : null;
        const rightFreqPct = (cov && cov.ok) ? cov.rightFreqPct : null;

        const s = salesByDm.get(name.toUpperCase().trim());
        const plannedHeadcount = sfeDms.filter(d => d === name).length;

        return {
          name: name,
          coveragePct: coveragePct,
          rightFreqPct: rightFreqPct,
          salesAchievementPct: s ? s.achievementPct : null,
          salesValue: s ? s.actualValue : null,
          targetValue: s ? s.targetValue : null,
          // Target per Position (2026-08-04, "add column in this Line
          // Performance"): same targetValue this row already carries,
          // divided by the SAME plannedHeadcount denominator salesPerPosition
          // uses -- this row is already scoped to one DM WITHIN the chosen
          // Line (activeLine branch), so this is naturally Line-scoped too,
          // no extra plumbing needed.
          targetPerPosition: (s && plannedHeadcount > 0) ? s.targetValue / plannedHeadcount : null,
          contributionPct: (s && totalSalesValue > 0) ? (s.actualValue / totalSalesValue) * 100 : null,
          salesPerPosition: (s && plannedHeadcount > 0) ? s.actualValue / plannedHeadcount : null,
          activePositions: plannedHeadcount,
        };
      }).sort((a, b) => (b.salesAchievementPct === null ? -Infinity : b.salesAchievementPct) - (a.salesAchievementPct === null ? -Infinity : a.salesAchievementPct));

      return { ok: true, bu: bu, scope: (salesData && salesData.ok) ? salesData.scope : null, rows: rows };
    } else {
      const covProbe = safeCall("coverage", "CoverageDashboard", "getLineAndTerritoryBreakdown", bu);
      const salesData = safeCall("sales", "SalesDashboard", "getLineSalesSummary", bu, months, undefined, scenario);
      if (!covProbe || !covProbe.ok) return { ok: false, status: covProbe ? covProbe.status : "module_unavailable" };

      const salesByLine = new Map();
      let totalSalesValue = 0;
      if (salesData && salesData.ok) {
        salesData.lines.forEach(l => { salesByLine.set(l.name, l); totalSalesValue += l.actualValue; });
      }

      const rows = getAllowedLinesForBU(bu).map(name => {
        const cov = safeCall("coverage", "CoverageDashboard", "getFilteredCoverageForLine", bu, name);
        const coveragePct = (cov && cov.ok) ? cov.coveragePct : null;
        const rightFreqPct = (cov && cov.ok) ? cov.rightFreqPct : null;

        const s = salesByLine.get(name);
        const sfeLine = safeCall("sfe", "SFEDashboard", "getFilteredHeadcountForLine", bu, name);
        const plannedHeadcount = (sfeLine && sfeLine.ok) ? sfeLine.headcountTotal : 0;
        return {
          name: name,
          coveragePct: coveragePct,
          rightFreqPct: rightFreqPct,
          salesAchievementPct: s ? s.achievementPct : null,
          salesValue: s ? s.actualValue : null,
          targetValue: s ? s.targetValue : null,
          // Target per Position (2026-08-04, "add column in this Line
          // Performance and dynamically added within line filter"): each
          // row here IS one Line already, so targetValue/plannedHeadcount
          // is naturally per-Line -- switching the Line filter re-runs this
          // whole function (buildLinePerformanceTable is called fresh on
          // every filter change via renderLinePerformanceSection), so this
          // column is dynamic by construction, no separate wiring needed.
          targetPerPosition: (s && plannedHeadcount > 0) ? s.targetValue / plannedHeadcount : null,
          contributionPct: (s && totalSalesValue > 0) ? (s.actualValue / totalSalesValue) * 100 : null,
          salesPerPosition: (s && plannedHeadcount > 0) ? s.actualValue / plannedHeadcount : null,
          activePositions: plannedHeadcount,
        };
      }).sort((a, b) => (b.salesAchievementPct === null ? -Infinity : b.salesAchievementPct) - (a.salesAchievementPct === null ? -Infinity : a.salesAchievementPct));

      return { ok: true, bu: bu, scope: (salesData && salesData.ok) ? salesData.scope : null, rows: rows };
    }
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
    const topKey = kind === "coverage" ? "topClassCov" : "topClassRf";
    const bottomKey = kind === "coverage" ? "bottomClassCov" : "bottomClassRf";

    const rows = data.types.map(t => {
      const topClass = t[topKey];
      const bottomClass = t[bottomKey];
      return {
        name: t.name,
        value: t[metricKey],
        repCount: t.repCount,
        topClass: topClass ? `${topClass.name} (${topClass.pct.toFixed(1)}%)` : "—",
        bottomClass: bottomClass ? `${bottomClass.name} (${bottomClass.pct.toFixed(1)}%)` : "—"
      };
    });

    const table = global.DS.table({
      columns: [
        { key: "name", label: "Type" },
        { key: "value", label: kind === "coverage" ? "Coverage %" : "Right-Freq %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
        { key: "topClass", label: "Top-Performing Class" },
        { key: "bottomClass", label: "Bottom-Performing Class" },
        { key: "repCount", label: "Reps", align: "right" },
      ],
      rows: rows,
    });
    global.DS.openModal({ title: bu + " — " + (kind === "coverage" ? "Operational Coverage" : "Right Frequency") + " by Type", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">Title=Medical Representative, Experience=Non-Probation, Status=Active, as of ${escapeAttr(data.asOfDate)}.</div>` + table });
  }

  function openBrandAchievementModal(bu, line) {
    const data = safeCall("sales", "SalesDashboard", "getBrandAchievement", bu, line && line !== "All" ? line : null, undefined, activeScenario());
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
      ? `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}. Click a brand row for Item-level detail (CHC only).${escapeAttr(scenarioFallbackNote(line && line !== "All" ? line : bu))}</div>`
      : `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}.${escapeAttr(scenarioFallbackNote(line && line !== "All" ? line : bu))}</div>`;
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
    const data = safeCall("sales", "SalesDashboard", "getItemAchievement", bu, brandName, undefined, activeScenario());
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
    global.DS.openModal({ title: bu + " — " + brandName + " — Item Detail", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}.${escapeAttr(scenarioFallbackNote(bu))}</div>` + table });
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

    const scenario = activeScenario();
    if (bu === "CHC") {
      const data = safeCall("sales", "SalesDashboard", "getItemAchievement", bu, null, scopedLine, scenario);
      columns[0].label = "Item (SKU)";
      if (!data || !data.ok || !data.items.length) {
        global.DS.openModal({ title: bu + " — Sales Value by Item", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No item-level data available.</div>" });
        return;
      }
      const table = global.DS.table({ columns: columns, rows: data.items });
      global.DS.openModal({ title: bu + " — Sales Value by Item", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}. CHC shows items directly (no brand grouping).${escapeAttr(scenarioFallbackNote(scopedLine || bu))}</div>` + table });
      return;
    }

    const data = safeCall("sales", "SalesDashboard", "getBrandAchievement", bu, scopedLine, undefined, scenario);
    columns[0].label = "Brand";
    if (!data || !data.ok || !data.brands.length) {
      global.DS.openModal({ title: bu + " — Sales Value by Brand", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No brand-level data available.</div>" });
      return;
    }
    const table = global.DS.table({ columns: columns, rows: data.brands });
    global.DS.openModal({ title: bu + " — Sales Value by Brand", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}.${escapeAttr(scenarioFallbackNote(scopedLine || bu))}</div>` + table });
  }

  // Sales Units Achievement card's popup (2026-08-02, "popup show brand
  // units target actual and achievement and contribution by brand and
  // item for chc"): same brand/item source + CHC-shows-items-not-brands
  // convention as openSalesValueModal() immediately above, but Achievement
  // % here is computed on UNITS basis (actualQty/targetQty) instead of
  // Value basis -- getBrandAchievement()/getItemAchievement() only return
  // a Value-basis achievementPct, so it's recomputed client-side from the
  // same actualQty/targetQty fields those interfaces already return (no
  // sales.js change needed, can never disagree with the row-level source).
  // Contribution % stays Value-basis, same definition used everywhere else
  // on this platform ("contribution based on value" -- see
  // getBrandAchievement()'s own doc comment) -- deliberately NOT
  // reinterpreted as a units-share, to avoid a second, conflicting meaning
  // of "contribution" existing side by side with the established one.
  function openSalesUnitsModal(bu, line) {
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;
    const scopedLine = line && line !== "All" ? line : null;
    const columns = [
      { key: "name", label: null }, // label filled in per-mode below
      { key: "actualQty", label: "Actual Units", align: "right", format: v => v === null ? "—" : Math.round(v).toLocaleString() },
      { key: "targetQty", label: "Target Units", align: "right", format: v => v === null ? "—" : Math.round(v).toLocaleString() },
      { key: "unitsAchievementPct", label: "Achievement %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      { key: "actualValue", label: "Value (EGP)", align: "right", format: v => Math.round(v).toLocaleString() },
      { key: "contributionPct", label: "Contribution %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
    ];
    const withUnitsAchievement = rows => rows.map(r => Object.assign({}, r, {
      unitsAchievementPct: r.targetQty > 0 ? (r.actualQty / r.targetQty) * 100 : null,
    }));

    const scenario = activeScenario();
    if (bu === "CHC") {
      const data = safeCall("sales", "SalesDashboard", "getItemAchievement", bu, null, scopedLine, scenario);
      columns[0].label = "Item (SKU)";
      if (!data || !data.ok || !data.items.length) {
        global.DS.openModal({ title: bu + " — Sales Units by Item", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No item-level data available.</div>" });
        return;
      }
      const table = global.DS.table({ columns: columns, rows: withUnitsAchievement(data.items) });
      global.DS.openModal({ title: bu + " — Sales Units by Item", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}. Achievement % is Units basis (Actual/Target quantity); Contribution % is Value basis. CHC shows items directly (no brand grouping).${escapeAttr(scenarioFallbackNote(scopedLine || bu))}</div>` + table });
      return;
    }

    const data = safeCall("sales", "SalesDashboard", "getBrandAchievement", bu, scopedLine, undefined, scenario);
    columns[0].label = "Brand";
    if (!data || !data.ok || !data.brands.length) {
      global.DS.openModal({ title: bu + " — Sales Units by Brand", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No brand-level data available.</div>" });
      return;
    }
    const table = global.DS.table({ columns: columns, rows: withUnitsAchievement(data.brands) });
    global.DS.openModal({ title: bu + " — Sales Units by Brand", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">${data.scope}, as of ${escapeAttr(data.asOfDate)}. Achievement % is Units basis (Actual/Target quantity); Contribution % is Value basis.${escapeAttr(scenarioFallbackNote(scopedLine || bu))}</div>` + table });
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

  function openDmDetailsModal(bu, line, dmName) {
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;
    const reps = safeCall("coverage", "CoverageDashboard", "getDmRepsList", bu, line, dmName) || [];
    const posMap = safeCall("sales", "SalesDashboard", "getRepPositionsMap") || {};
    const monthsParam = _linePerfMonths === "all" ? null : _linePerfMonths;
    const salesMap = safeCall("sales", "SalesDashboard", "getDmRepsSalesSummary", bu, line, dmName, monthsParam, activeScenario()) || {};

    if (!reps.length) {
      global.DS.openModal({
        title: dmName + " — Representative List",
        bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No active, non-probation representative data found.</div>"
      });
      return;
    }

    // Enrich with position and sales data
    const rows = reps.map(r => {
      const pos = posMap[r.name.toUpperCase().trim()] || "N/A";
      const s = salesMap[r.name.toUpperCase().trim()] || { val: 0, tgtVal: 0 };
      return {
        name: r.name,
        code: r.code,
        position: pos,
        coveragePct: r.coveragePct,
        rightFreqPct: r.rightFreqPct,
        salesValue: s.val,
        targetValue: s.tgtVal,
        salesAchievementPct: s.tgtVal > 0 ? (s.val / s.tgtVal) * 100 : null
      };
    });

    const dmColumns = [
      { key: "name", label: "Representative" },
      { key: "position", label: "Position" },
      { key: "coveragePct", label: "Coverage %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      { key: "rightFreqPct", label: "Right-Freq %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      { key: "salesValue", label: "Sales Value (EGP)", align: "right", format: v => v === null ? "—" : Math.round(v).toLocaleString() },
      { key: "targetValue", label: "Target Value (EGP)", align: "right", format: v => v === null ? "—" : Math.round(v).toLocaleString() },
      { key: "salesAchievementPct", label: "Sales Achievement %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" }
    ];
    const table = global.DS.table({ columns: dmColumns, rows: rows });
    const exportBtnHtml = global.DS.button({ label: "Export to Excel (CSV)", variant: "secondary", attrs: 'id="exec-dm-details-export"' });

    const overlay = global.DS.openModal({
      title: dmName + " — Representatives & Positions",
      bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">Active, Non-Probation Medical Representatives (or Sales Representatives for CHC) under ${dmName}. Period: ${_linePerfMonths === "all" ? "All Months" : _linePerfMonths.map(String).join(", ")}.</div>` + table,
      footerHtml: exportBtnHtml,
    });
    setTimeout(() => {
      const exportBtn = overlay.querySelector("#exec-dm-details-export");
      if (exportBtn) exportBtn.addEventListener("click", () => exportTableRowsCSV(dmName + "_Representatives", dmColumns, rows));
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
    // Line-scoped (2026-08-03, "position of chosen line"): forward the
    // Executive filter bar's Line selection through to Customer Health so
    // Status/Frequency/Basket/Distinct SKUs/Value/Position/Brick/Region/
    // Last Purchase all reflect that specific Line, not just the BU.
    const health = safeCall("sales", "SalesDashboard", "getClusterCustomerHealth", bu, clusterName, line);
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
    const labelBuLine = (line && line !== "All") ? line : bu;
    if (!cluster || !cluster.customers.length) {
      global.DS.openModal({ title: labelBuLine + " — " + clusterName + " — Customers", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No sub-type-level data available.</div>" });
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
      title: labelBuLine + " — " + clusterName + " — Customers",
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

  // Shared scope helpers (2026-08-03): a single definition of "what Line/BU
  // tag should this modal show" and "should the ETL-staleness warning show",
  // used by BOTH the summary view (openClusterHealthModal's bodyHtml) and
  // the grid view (buildClusterHealthGridShellHtml) plus the CSV export --
  // previously each place recomputed its own version and only the summary
  // view got the warning, so switching to "View Full Customer List" silently
  // dropped the one piece of context explaining why Position/SKU weren't
  // Line-scoped yet (Ahmed's 2026-08-03 report: chose PEDIA, still saw a
  // blended, all-lines Position list and non-PEDIA SKUs in the GRID view
  // specifically, with no warning visible there).
  function computeHealthScopeTag(health) {
    const isBuScoped = health.bu && health.bu !== "All";
    return health.effectiveLine || (health.lines && health.lines.length ? health.lines.join(", ") : (isBuScoped ? health.bu : null));
  }

  function buildLineUnavailableNote(health) {
    return (health.requestedLine && !health.lineDataAvailable)
      ? `<div style="font-size:12px;color:var(--color-warning,#B45309);margin-bottom:10px;">"${escapeAttr(health.requestedLine)}" selected, but this cache predates Line-level data -- showing ${escapeAttr(health.bu || "All")}'s BU-wide figures instead. Re-run the customer-analytics ETL to enable Line scoping here.</div>`
      : "";
  }

  function buildClusterHealthGridShellHtml(clusterName, health) {
    return `
      ${buildLineUnavailableNote(health)}
      <div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">
        ${escapeAttr(clusterName)} — full customer list. Search by name or ID, click a column header to sort, export the current filtered view as CSV.
      </div>
      ${global.DS.dataGrid({ id: "exec-cluster-health-grid", searchPlaceholder: "Search customer name or ID..." })}
    `;
  }

  // Shared date formatter for the Last Purchase column/CSV cell
  // (2026-07-31): source dates arrive as ISO strings from the ETL
  // (etl/build_customer_analytics_cache.py's fmt_date()); render as
  // "15 Jun 2026" instead of a raw ISO string.
  function formatLastPurchase(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function mountClusterHealthGrid(clusterName, health) {
    // Brick / Position / Last Purchase (2026-07-31, "give brick name
    // position name only... add column of last time purchase"): sourced
    // from the 'Brick'/'Position' columns confirmed present in the raw
    // sales source, and from each customer's most recent transaction date
    // -- both BU-scoped (health.customers[].bricks/positions/lastPurchase,
    // see js/sales.js and the ETL's byBU). Blank for the All-BU view,
    // where there's no single well-defined brick/position/last-purchase
    // the way there's a combined value total.
    //
    // "Line"/"Business Units" columns stay REMOVED (2026-07-31 request).
    // SKU still lists each item on its own line inside the cell (numbered,
    // stacked, via the grid's `wrap` flag -- see js/components.js's
    // mountDataGrid) -- BU-scoped only, empty for the All-BU view.
    // Column-label scope tag (2026-08-03): prefer the CHOSEN filter Line
    // (health.effectiveLine) over health.lines (a Line Manager's fixed AUTH
    // restriction) -- these are different things, and effectiveLine is the
    // one that tells Ahmed at a glance whether Position/SKU/etc. actually
    // narrowed to his Line selection or fell back to the BU-wide view
    // (falls back automatically when the cache predates byLine -- see
    // buildLineUnavailableNote, now shown in this grid view too).
    const scopeTag = computeHealthScopeTag(health);
    const brickColumn = { key: "bricks", label: "Brick", format: v => Array.isArray(v) && v.length ? v.join(", ") : "—" };
    const regionColumn = { key: "regions", label: "Region", format: v => Array.isArray(v) && v.length ? v.join(", ") : "—" };
    // Position (2026-08-02, "add column of position"): the underlying data
    // was already there -- health.customers[].positions has been flowing
    // through getClusterCustomerHealth()'s byBU overlay since 2026-07-31,
    // it just wasn't rendered as its own grid column. Same BU-scoped,
    // comma-joined pattern as Brick/Region.
    const positionColumn = { key: "positions", label: scopeTag ? "Position (" + scopeTag + ")" : "Position", format: v => Array.isArray(v) && v.length ? v.join(", ") : "—" };
    const lastPurchaseColumn = { key: "lastPurchase", label: "Last Purchase", format: formatLastPurchase };
    const skuColumn = {
      key: "items",
      label: scopeTag ? "SKU (" + scopeTag + ")" : "SKU",
      isHtml: true,
      format: v => {
        if (!Array.isArray(v) || !v.length) return "—";
        const text = v.map((name, i) => (i + 1) + ". " + name).join("<br>");
        return `<div class="sku-cell-scrollable" style="max-height: 70px; overflow-y: auto; line-height: 1.3; font-size: 11px; padding: 2px 0; text-align: left; white-space: nowrap;">${text}</div>`;
      }
    };

    global.DS.mountDataGrid("exec-cluster-health-grid", {
      columns: [
        { key: "name", label: "Customer Name" },
        brickColumn,
        regionColumn,
        positionColumn,
        { key: "bridgeSegment", label: "Status" },
        lastPurchaseColumn,
        { key: "frequencySegment", label: "Frequency" },
        { key: "basketSegment", label: "Basket" },
        { key: "monthsActive", label: "Months Active", align: "right" },
        { key: "distinctSkus", label: "Distinct SKUs", align: "right" },
        skuColumn,
        { key: "value", label: "Value (EGP)", align: "right", format: v => Math.round(v).toLocaleString() },
      ],
      rows: health.customers || [],
      pageSize: 25,
      searchKeys: ["name", "id"],
      exportFilename: clusterName.replace(/[^a-z0-9]+/gi, "_") + "_customers",
    });
  }

  // Direct CSV export (2026-07-30, "need to export to excel"): the
  // previous export path only existed inside the full customer-list grid
  // view (mountClusterHealthGrid's own export button), one extra click
  // away from the summary view this modal opens on by default -- easy to
  // miss. Builds the CSV straight from health.customers, independent of
  // the grid's search/sort state, so it works whether or not the user has
  // ever switched to grid view. Same column set as the grid (2026-07-31:
  // Line/Business Units removed, SKU listed one-per-line same as the grid
  // -- a quoted CSV field may contain embedded newlines per RFC4180, Excel
  // renders it as a taller wrapped cell) and the same UTF-8-BOM fix as
  // every other export in this app (2026-07-30, js/components.js/
  // js/sales.js) so Arabic customer names open correctly in Excel instead
  // of as mojibake.
  // Generic CSV-from-DS.table-columns exporter (2026-08-03): reused by the
  // Line/DSM Performance section and the DM Details (Representatives)
  // popup. Takes the same {key,label,format} column shape already passed
  // to global.DS.table() so no export-specific column list needs to be
  // maintained separately -- and applies the same UTF-8 BOM fix used
  // everywhere else in this app (2026-07-30) so Arabic names don't render
  // as mojibake in Excel.
  function exportTableRowsCSV(filename, columns, rows) {
    const header = columns.map(c => c.label).join(",");
    const csvRows = rows.map(row => columns.map(c => {
      const raw = typeof c.format === "function" ? c.format(row[c.key], row) : row[c.key];
      const s = raw === undefined || raw === null ? "" : String(raw);
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(","));
    const csv = [header].concat(csvRows).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.replace(/[^a-z0-9]+/gi, "_") + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportClusterCustomersCSV(clusterName, health) {
    // Column set mirrors mountClusterHealthGrid() (2026-08-02): Brick,
    // Region, Position, Last Purchase. Position/SKU header scope tag
    // (2026-08-03) uses the same computeHealthScopeTag() as the on-screen
    // grid, so the exported CSV never disagrees with what's shown on
    // screen about which Line/BU the figures are scoped to.
    const scopeTag = computeHealthScopeTag(health);
    const rows = health.customers || [];
    const header = ["Customer Name", "Brick", "Region", scopeTag ? "Position (" + scopeTag + ")" : "Position", "Status", "Last Purchase", "Frequency", "Basket",
      "Months Active", "Distinct SKUs", scopeTag ? "SKU (" + scopeTag + ")" : "SKU", "Value (EGP)"];
    const csvRows = rows.map(c => {
      const brickCell = (c.bricks && c.bricks.length) ? c.bricks.join("; ") : "";
      const regionCell = (c.regions && c.regions.length) ? c.regions.join("; ") : "";
      const positionCell = (c.positions && c.positions.length) ? c.positions.join("; ") : "";
      const skuCell = (c.items && c.items.length) ? c.items.map((name, i) => (i + 1) + ". " + name).join("; ") : "";
      return [c.name, brickCell, regionCell, positionCell, c.bridgeSegment, formatLastPurchase(c.lastPurchase), c.frequencySegment,
        c.basketSegment, c.monthsActive, c.distinctSkus, skuCell, Math.round(c.value)]
        .map(v => '"' + String(v === undefined || v === null ? "" : v).replace(/"/g, '""') + '"')
        .join(",");
    });
    const csv = [header.join(",")].concat(csvRows).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = clusterName.replace(/[^a-z0-9]+/gi, "_") + "_customers.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function openClusterHealthModal(bu, clusterName, health) {
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;

    let showingGrid = false;
    const toggleBtnHtml = global.DS.button({
      label: "View Full Customer List (" + health.totalCustomers.toLocaleString() + ")",
      variant: "primary",
      attrs: 'id="exec-cluster-health-toggle"',
    });
    const exportBtnHtml = global.DS.button({
      label: "Export to Excel (CSV)",
      variant: "secondary",
      attrs: 'id="exec-cluster-health-export"',
    });

    // Title prefers the CHOSEN filter Line (health.effectiveLine, 2026-08-03)
    // over the AUTH-restricted health.lines -- those are two different
    // things: effectiveLine is what the user picked in the filter bar,
    // health.lines is a Line Manager's fixed access restriction.
    const titleScope = health.effectiveLine || (health.lines && health.lines.length ? health.lines.join(", ") : bu);
    const lineUnavailableNote = buildLineUnavailableNote(health);
    const overlay = global.DS.openModal({
      title: titleScope + " — " + clusterName + " — Customer Health",
      bodyHtml: lineUnavailableNote + buildClusterHealthSummaryHtml(clusterName, health),
      footerHtml: toggleBtnHtml + exportBtnHtml,
    });

    setTimeout(() => {
      const btn = overlay.querySelector("#exec-cluster-health-toggle");
      const exportBtn = overlay.querySelector("#exec-cluster-health-export");
      const body = overlay.querySelector(".ds-modal-body");
      if (exportBtn) exportBtn.addEventListener("click", () => exportClusterCustomersCSV(clusterName, health));
      if (!btn || !body) return;
      btn.addEventListener("click", () => {
        showingGrid = !showingGrid;
        if (showingGrid) {
          body.innerHTML = buildClusterHealthGridShellHtml(clusterName, health);
          mountClusterHealthGrid(clusterName, health);
          btn.querySelector("span").textContent = "Back to Summary";
        } else {
          body.innerHTML = buildClusterHealthSummaryHtml(clusterName, health);
          btn.querySelector("span").textContent = "View Full Customer List (" + health.totalCustomers.toLocaleString() + ")";
        }
      });
    }, 0);
  }

  function openMarketShareProductModal(bu, line) {
    // Line-scoped (2026-08-03): every other KPI popup on this page already
    // forwards ctx.filters.line -- this one didn't, so picking a Line in
    // the filter bar had no effect here and the Line/Market columns always
    // showed every Line's target rows blended together. getDM1DM2MarketIntel
    // already accepts an optional line and filters TARGETS_2026 by it, so
    // this is purely a wiring fix, no data-layer change needed.
    const scopedLine = line && line !== "All" ? line : null;
    const data = safeCall("iqvia", "IQVIADashboard", "getDM1DM2MarketIntel", bu, scopedLine);
    if (typeof global.DS === "undefined" || typeof global.DS.openModal !== "function") return;
    if (!data || !data.ok || !data.segments.length) {
      global.DS.openModal({ title: bu + " — Market Share by Product", bodyHtml: "<div style='font-size:13px;color:var(--color-text-tertiary,#94A3B8);'>No product-level data available.</div>" });
      return;
    }
    // A product can carry more than one target row (e.g. sold under two
    // Lines against two different IQVIA market definitions -- ELIMBOSIS is
    // tracked separately for ORTHO-II vs CVM-II with distinct DM1/DM2
    // baskets). Each target row is its own segment, so the same product
    // name can legitimately appear more than once here; show the Line and
    // the actual DM1/DM2 market names on every row so no row's context is
    // ambiguous, whether or not its product happens to repeat.
    const rows = data.segments.map(s => ({
      product: s.product,
      line: s.line || "—",
      dm1Name: s.dm1Name || "—",
      dm2Name: s.dm2Name || "—",
      dm1SharePct: s.dm1 && s.dm1.ytd && s.dm1.ytd.su ? s.dm1.ytd.su.sharePct : null,
      dm2SharePct: s.dm2 && s.dm2.ytd && s.dm2.ytd.su ? s.dm2.ytd.su.sharePct : null,
    }));
    const columns = [
      { key: "product", label: "Product" },
      { key: "line", label: "Line" },
      { key: "dm1Name", label: "DM1 Market" },
      { key: "dm1SharePct", label: "DM1 Share % (YTD SU)", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      { key: "dm2Name", label: "DM2 Market" },
      { key: "dm2SharePct", label: "DM2 Share % (YTD SU)", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
    ];
    const table = global.DS.table({ columns: columns, rows: rows });
    const scopeNote = scopedLine ? ` Scope: ${escapeAttr(scopedLine)} only.` : "";
    global.DS.openModal({ title: bu + " — Market Share by Product", bodyHtml: `<div style="font-size:12px;color:var(--color-text-tertiary,#94A3B8);margin-bottom:10px;">Excludes Other Markets. As of ${escapeAttr(data.asOfDate)}.${scopeNote}</div>` + table });
  }

  function switchToTab(tabName) {
    const item = document.querySelector('#sidebar-nav .menu-item[data-tab="' + tabName + '"]');
    if (item) item.dispatchEvent(new Event("click", { bubbles: true }));
  }

  // ---------------------------------------------------------------------
  // Rendering.
  // ---------------------------------------------------------------------
  function renderFilterBar(ctx) {
    // Role-based scope (2026-07-29): restricted users only ever see their
    // own allowed BUs/lines as selectable options -- there is no way to
    // switch into another BU's data through this dropdown at all, not
    // just a data-layer block after the fact.
    const buOptions = getAllowedBUList().map(b => ({ value: b, label: b }));
    const lineOptions = [{ value: "All", label: "All Lines" }].concat(getAllowedLinesForBU(ctx.filters.bu).map(l => ({ value: l, label: l })));

    const wrap = document.createElement("div");
    wrap.className = "ds-exec-filterbar";

    const buSelect = global.DS.select({ id: "exec-filter-bu", label: "Business Unit", options: buOptions, value: ctx.filters.bu, disabled: buOptions.length <= 1 });
    const lineSelect = global.DS.select({ id: "exec-filter-line", label: "Line", options: lineOptions, value: ctx.filters.line });
    const periodSelect = global.DS.select({ id: "exec-filter-period", label: "Period", options: [{ value: "latest", label: "Latest Period" }], value: "latest", disabled: true });
    const cmpSelect = global.DS.select({ id: "exec-filter-cmp", label: "Comparison Period", options: [{ value: "YTD", label: "YTD" }], value: "YTD", disabled: true });

    wrap.appendChild(buSelect);
    wrap.appendChild(lineSelect);
    wrap.appendChild(periodSelect);
    wrap.appendChild(cmpSelect);

    // Target Scenario (2026-08-04): role-gated, same convention as the
    // Sales Performance page's own selector (js/sales.js renderLayout).
    // Roles without canToggleScenario() rights get no <select> at all --
    // not a disabled one -- so their UI never implies a choice exists;
    // they still see their current basis as a plain read-only label so
    // nobody is left guessing what number is on screen.
    const canToggleScenario = !!(global.AUTH && typeof global.AUTH.canToggleScenario === "function" && global.AUTH.canToggleScenario());
    const scenarioMeta = (global.SEMANTIC && global.SEMANTIC.TARGET_SCENARIOS[ctx.filters.scenario]) || { label: "Official Target" };
    // 2026-08-04 same-day fix: mirrors the note added to the Sales
    // Performance page's own selector -- while the cache hasn't been
    // refreshed under v3 yet, Official and Working both read identical
    // (Official) data (see sales.js's scenarioSchemaAvailable() /
    // includeTargetRow()). Surface that here too rather than let a
    // toggle that isn't differentiating anything yet look broken.
    const scenarioDataReady = !!(global.SalesDashboard && typeof global.SalesDashboard.isScenarioDataAvailable === "function" && global.SalesDashboard.isScenarioDataAvailable());
    if (canToggleScenario) {
      const scenarioOptions = Object.keys(global.SEMANTIC.TARGET_SCENARIOS).map(key => ({ value: key, label: global.SEMANTIC.TARGET_SCENARIOS[key].label }));
      const scenarioSelect = global.DS.select({ id: "exec-filter-scenario", label: "Target Basis", options: scenarioOptions, value: ctx.filters.scenario });
      if (!scenarioDataReady) {
        const note = document.createElement("div");
        note.style.cssText = "font-size:9px;color:#b45309;margin-top:3px;max-width:170px;line-height:1.35;";
        note.textContent = "Working Target activates after the next cache refresh";
        scenarioSelect.appendChild(note);
      }
      wrap.appendChild(scenarioSelect);
      scenarioSelect.querySelector("select").addEventListener("change", (e) => {
        if (global.AUTH && global.AUTH.setActiveScenario(e.target.value)) {
          ctx.filters.scenario = e.target.value;
          render(ctx.container);
        }
      });
    } else {
      const scenarioLabel = document.createElement("div");
      scenarioLabel.className = "ds-select-wrap";
      scenarioLabel.innerHTML = `<label class="ds-select-label">Target Basis</label><div style="font-size:13px;font-weight:700;color:var(--color-text-primary,#0F172A);padding:6px 0;">${scenarioMeta.label}</div>`
        + (!scenarioDataReady ? `<div style="font-size:9px;color:#b45309;margin-top:3px;max-width:170px;line-height:1.35;">Working Target activates after the next cache refresh</div>` : '');
      wrap.appendChild(scenarioLabel);
    }

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
    
    // Role-based restriction (2026-08-01): BU and Line Managers (restricted scopes)
    // do not have access to supply chain/inventory KPIs.
    const isManager = global.AUTH && (global.AUTH.getScope().bus !== null || global.AUTH.getScope().lines !== null);

    const cards = [
      buildCoverageFamilyCard("coverage", "Operational Coverage", "coveragePct", 100, filters),
      buildCoverageFamilyCard("rightFrequency", "Right Frequency", "rightFreqPct", 90, filters),
      buildSFECard(filters, summaries),
      buildSalesAchievementCard(filters),
      buildSalesValueCard(filters),
      buildSalesUnitsAchievementCard(filters),
      buildCustomerClusterMixCard(filters),
      buildMarketShareCard(filters),
      buildBUGrowthCard(filters),
      buildSalesProductivityCard(summaries, filters)
    ];

    if (!isManager) {
      cards.push(buildPullThroughCard(filters));
      cards.push(buildStockDaysCard(filters));
    }

    const cardsHtml = cards.map(c => renderCard(c));

    const grid = document.createElement("div");
    grid.className = "ds-grid-kpi";
    grid.innerHTML = cardsHtml.join("");
    return grid;
  }

  function renderLinePerformanceSection(ctx) {
    const monthsInfo = safeCall("sales", "SalesDashboard", "getAvailableMonths");
    const monthsParam = _linePerfMonths === "all" ? null : _linePerfMonths;
    const data = buildLinePerformanceTable(ctx.filters.bu, ctx.filters.line, monthsParam);

    const wrap = document.createElement("div");
    wrap.className = "ds-mt-4";

    const headerRow = document.createElement("div");
    headerRow.style.cssText = "display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:var(--space-2,8px);";
    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-weight:600;font-size:var(--fs-sm,13px);";

    const activeLine = (ctx.filters.line !== "All") ? ctx.filters.line : (global.AUTH && global.AUTH.getScope().lines && global.AUTH.getScope().lines.length === 1 ? global.AUTH.getScope().lines[0] : null);
    const activeLineLabel = activeLine || (global.AUTH && global.AUTH.getScope().lines ? global.AUTH.getScope().lines.join(", ") : ctx.filters.bu);

    titleEl.textContent = activeLine ? "DSM Performance within " + activeLineLabel : "Line Performance within " + activeLineLabel;
    headerRow.appendChild(titleEl);

    // Shared between the DS.table() render below and the Export-to-Excel
    // button so the exported CSV always matches what's on screen.
    const lpColumns = [
      { key: "name", label: activeLine ? "District Manager" : "Line" },
      { key: "coveragePct", label: "Coverage %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      { key: "rightFreqPct", label: "Right-Freq %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      { key: "salesValue", label: "Sales Value (EGP)", align: "right", format: v => v === null ? "—" : Math.round(v).toLocaleString() },
      { key: "targetValue", label: "Target Value (EGP)", align: "right", format: v => v === null ? "—" : Math.round(v).toLocaleString() },
      { key: "salesAchievementPct", label: "Sales Achievement %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      { key: "contributionPct", label: "Contribution %", align: "right", format: v => v === null ? "—" : v.toFixed(1) + "%" },
      { key: "salesPerPosition", label: "Sales per Position", align: "right", format: v => v === null ? "—" : fmtM(v) },
      // Target per Position (2026-08-04, "add column in this Line
      // Performance"): sits next to Sales per Position for a direct actual-
      // vs-target-per-head comparison. Values come from
      // buildLinePerformanceTable's targetPerPosition field, which is
      // already Line-scoped whenever a Line filter is active (see that
      // function's comments) -- this column just renders it, no extra
      // filter-wiring needed here.
      { key: "targetPerPosition", label: "Target per Position", align: "right", format: v => v === null ? "—" : fmtM(v) },
      { key: "activePositions", label: "Positions", align: "right" },
    ];

    // Period filter, scoped to this section only -- Coverage %/Right-Freq %
    // columns have no month dimension (organogram is a point-in-time
    // snapshot) and stay unaffected regardless of the selection; only the
    // Sales-derived columns (Sales Value/Target/Achievement/Contribution/
    // Sales per Position/Positions) recompute for the chosen months.
    if (monthsInfo && monthsInfo.ok && monthsInfo.months.length > 1) {
      const periodDropdown = global.DS.filterDropdown({
        label: "Period",
        options: monthsInfo.months.map(m => ({ value: String(m.idx), label: m.label })),
        selected: _linePerfMonths === "all" ? [] : _linePerfMonths.map(String),
        onChange: function (selectedArr) {
          _linePerfMonths = selectedArr.length === 0 ? "all" : selectedArr;
          render(ctx.container);
        },
      });
      headerRow.appendChild(periodDropdown);
    }

    if (data.ok && data.rows && data.rows.length) {
      const exportWrap = document.createElement("div");
      exportWrap.innerHTML = global.DS.button({ label: "Export to Excel (CSV)", variant: "secondary", size: "sm", attrs: 'id="exec-lineperf-export"' });
      const exportBtnEl = exportWrap.firstElementChild;
      headerRow.appendChild(exportBtnEl);
      exportBtnEl.addEventListener("click", () => {
        exportTableRowsCSV(
          activeLine ? "DSM_Performance_" + activeLine : "Line_Performance_" + ctx.filters.bu,
          lpColumns,
          data.rows
        );
      });
    }
    wrap.appendChild(headerRow);

    if (!data.ok) {
      const msg = document.createElement("div");
      msg.style.cssText = "font-size:var(--fs-xs,12px);color:var(--color-text-tertiary,#94A3B8);";
      msg.textContent = (activeLine ? "DSM" : "Line") + " Performance unavailable (" + data.status + ").";
      wrap.appendChild(msg);
      return wrap;
    }

    const table = global.DS.table({ columns: lpColumns, rows: data.rows });
    const scopeNote = data.scope ? `<div style="font-size:var(--fs-xs,12px);color:var(--color-text-tertiary,#94A3B8);margin-bottom:var(--space-2,8px);">Sales figures: ${escapeAttr(data.scope)}. Contribution % = share of ${escapeAttr(ctx.filters.bu)}'s total Sales Value.${escapeAttr(scenarioFallbackNote(activeLine || ctx.filters.bu))}</div>` : "";
    const bodyWrap = document.createElement("div");
    bodyWrap.innerHTML = scopeNote + table;
    if (activeLine) {
      bodyWrap.querySelectorAll("tbody tr").forEach((tr, i) => {
        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => {
          openDmDetailsModal(ctx.filters.bu, activeLine, data.rows[i].name);
        });
      });
    }
    wrap.appendChild(bodyWrap);
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
        else if (kpiId === "salesUnitsAchievement") openSalesUnitsModal(bu, ctx.filters.line);
        else if (kpiId === "customerClusterMix") openCustomerClusterMixModal(bu, ctx.filters.line);
        else if (kpiId === "marketShare") openMarketShareProductModal(bu, ctx.filters.line);
        else if (kpiId === "sfe") switchToTab("sfe");
        else if (kpiId === "pullThroughRate") openTmsImsModal(bu, ctx.filters.line, "pullThrough");
        else if (kpiId === "stockDays") openTmsImsModal(bu, ctx.filters.line, "stockDays");
      });
    });
    container.querySelectorAll("[data-exec-kpi-dbl]").forEach(el => {
      el.addEventListener("dblclick", () => {
        const kpiId = el.getAttribute("data-exec-kpi-dbl");
        const tabByKpi = { coverage: "coverage", rightFrequency: "coverage", sfe: "sfe", salesAchievement: "sales", salesValue: "sales", salesUnitsAchievement: "sales", marketShare: "iqvia", buGrowth: "iqvia", salesProductivity: "sales", pullThroughRate: "tomarket", stockDays: "tomarket" };
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
      clampFiltersToScope();
      render(container);
    },
    destroy() {
      document.body.classList.remove("executive-mode");
    },
    // Target Scenario governance pin (2026-08-04) -- see the function's
    // own doc comment above. Any future Business Review integration
    // should call this, not collectSummaries()/getActiveScenario(), to
    // guarantee Official Target regardless of the user's dashboard toggle.
    collectSummariesPinnedOfficial: collectSummariesPinnedOfficial
  };
})(window);
