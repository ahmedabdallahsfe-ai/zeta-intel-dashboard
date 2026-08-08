/**
 * js/coverage-interface.js
 * =====================================================================
 * Coverage & Frequency's ENTERPRISE SEMANTIC INTERFACE.
 *
 * Coverage predates the Sales/SFE/IQVIA "windows.XDashboard" convention
 * -- it's organized as CacheStore (data) + Analytics (aggregation) +
 * Charts (rendering), always active, not tab-switched the same way.
 * This file does not change any of that. It adds exactly one thing:
 * a `window.CoverageDashboard.getBusinessSummary()` method with the
 * SAME external shape as Sales/SFE/IQVIA's interfaces, so the
 * Executive Command Center can call one consistent naming pattern
 * across all four modules without knowing that Coverage happens to be
 * built differently underneath. It reads only through CacheStore --
 * the existing "ONLY interface to data" rule -- and never touches
 * window.DASHBOARD_CACHE directly.
 *
 * Coverage's dashboard.json already carries a pre-computed
 * `teamComparison` array (one row per line/team, at the latest period)
 * with coveragePct/rightFreqPct/headcount/attritionRate -- computed
 * once by refresh.py and mirrored by analytics.js. This interface
 * rolls those existing, already-correct numbers up to Business Unit
 * via the shared Line -> BU crosswalk (semantic-model.js), rather
 * than re-deriving coverage/frequency formulas a second time.
 * =====================================================================
 */

(function (global) {
  "use strict";

  function getBusinessSummary() {
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      // CacheStore.init() runs from app.js at page load; if it hasn't
      // run yet (e.g. this is called extremely early), attempt it here
      // rather than silently returning empty data.
      if (typeof CacheStore !== "undefined" && !CacheStore.isReady()) {
        CacheStore.init();
      }
    }
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage", bu: {} };
    }
    if (typeof window.SEMANTIC === "undefined") {
      console.error("[Coverage] getBusinessSummary() requires js/semantic-model.js to be loaded first.");
      return { ok: false, status: "semantic_model_missing", asOfDate: null, source: "coverage", bu: {} };
    }

    const dash = CacheStore.getDashboard();
    const teamComparison = (dash && dash.teamComparison) || [];
    const latestPeriod = dash && dash.latestPeriod ? dash.latestPeriod : null;

    // Weighted rollup: headcount-weighted average for rate metrics
    // (coveragePct, rightFreqPct), simple sums for headcount/attrition.
    const acc = {};
    window.SEMANTIC.BU_LIST.forEach(bu => {
      acc[bu] = { headcount: 0, resignedCount: 0, coverageWeighted: 0, rightFreqWeighted: 0 };
    });

    teamComparison.forEach(row => {
      if (window.AUTH && !window.AUTH.isLineAllowed(row.team)) return;
      const bu = window.SEMANTIC.lineToBU(row.team);
      if (!bu) return; // Non-Promoted/Other Markets or unrecognized -- out of scope here
      const hc = row.headcount || 0;
      acc[bu].headcount += hc;
      acc[bu].resignedCount += row.resignedCount || 0;
      acc[bu].coverageWeighted += (row.coveragePct || 0) * hc;
      acc[bu].rightFreqWeighted += (row.rightFreqPct || 0) * hc;
    });

    const buOut = {};
    window.SEMANTIC.BU_LIST.forEach(bu => {
      const a = acc[bu];
      const coveragePct = a.headcount > 0 ? (a.coverageWeighted / a.headcount) * 100 : null;
      const rightFreqPct = a.headcount > 0 ? (a.rightFreqWeighted / a.headcount) * 100 : null;
      const attritionRatePct = a.headcount > 0 ? (a.resignedCount / a.headcount) * 100 : null;
      buOut[bu] = {
        headcount: a.headcount,
        coveragePct: coveragePct,
        rightFreqPct: rightFreqPct,
        attritionRatePct: attritionRatePct,
        confidence: a.headcount > 0 ? "high" : "low"
      };
    });

    return {
      ok: true,
      status: "ready",
      asOfDate: latestPeriod,
      source: "coverage",
      bu: buOut
    };
  }

  /**
   * ENTERPRISE SEMANTIC INTERFACE -- getFilteredCoverageSummary()
   * ------------------------------------------------------------------
   * A second, more granular Coverage cut for the Executive Business
   * Review's Evidence Dashboard: Coverage % and Right-Frequency %
   * scoped to exactly Title = "Medical Representative", Experience =
   * "Non-Probation", Status = "Active", Customer Type in {Contract,
   * Doctor, Hospital} (Distributor and Pharmacy excluded), at the
   * latest period -- i.e. the field-force segment executives actually
   * mean when they ask "what's our coverage?", excluding probation
   * reps, resigned reps, non-MR titles, and non-clinical customer
   * types that would otherwise dilute the headline number.
   *
   * Reads raw rows through CacheStore.getRecords() (the same
   * dictionary-encoded row cache analytics.js recomputes every
   * chart/table from) rather than the pre-aggregated teamComparison
   * getBusinessSummary() uses above, because teamComparison has no
   * Title/Experience/Status/Type cuts baked in -- only a fresh pass
   * over row-level data can answer this specific question.
   *
   * Formula mirrors analytics.js's accumulate()/pct() EXACTLY:
   * coveragePct = mean(Covered Doctors), rightFreqPct = mean(Right
   * Freq), both scoped to isActive rows only within the filtered set
   * (a resigned rep's stale rows never dilute a live percentage --
   * same rule analytics.js documents on its own emptyGroup()).
   *
   * Grouped by Business Unit via the SAME Line -> BU crosswalk
   * getBusinessSummary() uses (row.team, NOT row.businessUnit --
   * semantic-model.js's own audit found Coverage's "businessUnit"
   * field is mislabeled and actually holds BU Head person names).
   */
  function getFilteredCoverageSummary() {
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      if (typeof CacheStore !== "undefined" && !CacheStore.isReady()) {
        CacheStore.init();
      }
    }
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage", bu: {} };
    }
    if (typeof window.SEMANTIC === "undefined") {
      console.error("[Coverage] getFilteredCoverageSummary() requires js/semantic-model.js to be loaded first.");
      return { ok: false, status: "semantic_model_missing", asOfDate: null, source: "coverage", bu: {} };
    }

    const records = CacheStore.getRecords();
    if (!records || !Array.isArray(records.rows) || records.rows.length === 0) {
      // records.data.js is optional -- if it wasn't loaded, this specific
      // cut simply isn't available (the rest of the dashboard still
      // works fine from the pre-aggregated cache).
      return { ok: false, status: "records_unavailable", asOfDate: null, source: "coverage", bu: {} };
    }

    const dash = CacheStore.getDashboard();
    const dims = dash && dash.dimensions;
    const latestPeriod = dash && dash.latestPeriod ? dash.latestPeriod : null;
    if (!dims) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage", bu: {} };
    }

    // Field layout -- must stay in sync with analytics.js's own F map.
    const F = {
      period: 0, team: 1, businessUnit: 2, nsm: 3, areaManager: 4, manager: 5,
      employee: 6, specialty: 7, klass: 8, status: 9, experience: 10, type: 11,
      coveredDoctor: 12, rightFreq: 13, visits: 14, isActive: 15, actualPlanX1000: 16,
      plansCount: 17, title: 18, customerName: 19, profile: 20, frequency: 21,
      lastVisitDate: 22, area: 23,
    };

    const latestPeriodIdx = (dims.periods || []).length - 1;
    const titleIdx = (dims.titles || []).indexOf("Medical Representative");
    const expIdx = (dims.experiences || []).indexOf("Non-Probation");
    const statusIdx = (dims.statuses || []).indexOf("Active");
    const wantTypes = ["Contract", "Doctor", "Hospital"];
    const typeIdxSet = new Set(
      wantTypes.map(t => (dims.types || []).indexOf(t)).filter(i => i >= 0)
    );

    if (titleIdx < 0 || expIdx < 0 || statusIdx < 0 || typeIdxSet.size === 0) {
      // The exact dimension values this filter needs aren't present in
      // this cache build -- report clearly rather than silently
      // returning an all-zero (and misleading) result.
      return { ok: false, status: "dimension_mismatch", asOfDate: latestPeriod, source: "coverage", bu: {} };
    }

    const acc = {};
    window.SEMANTIC.BU_LIST.forEach(bu => {
      acc[bu] = { coveredSum: 0, rightFreqSum: 0, rowCount: 0, repSet: new Set(), visitCount: 0, plannedVisitCount: 0 };
    });

    records.rows.forEach(row => {
      if (row[F.title] !== titleIdx) return;
      if (row[F.experience] !== expIdx) return;
      if (row[F.status] !== statusIdx) return;
      if (!typeIdxSet.has(row[F.type])) return;

      const teamName = (dims.teams || [])[row[F.team]];
      if (window.AUTH && !window.AUTH.isLineAllowed(teamName)) return;
      const bu = window.SEMANTIC.lineToBU(teamName);
      if (!bu) return; // Non-Promoted/Other Markets/unrecognized -- out of scope

      // Mirror analytics.js's accumulate(): coveredSum/rightFreqSum/
      // rowCount are ACTIVE ROWS ONLY -- a resigned rep's stale row
      // (status filter above already excludes them, but this keeps the
      // formula identical to the platform's one authoritative version)
      // never dilutes the percentage.
      if (row[F.isActive]) {
        const a = acc[bu];
        a.coveredSum += row[F.coveredDoctor] || 0;
        a.rightFreqSum += row[F.rightFreq] || 0;
        a.rowCount += 1;
        a.repSet.add(row[F.employee]);
        a.visitCount += row[F.visits] || 0;
        a.plannedVisitCount += row[F.frequency] || 0;
      }
    });

    const buOut = {};
    let totalVisits = 0;
    let totalPlannedVisits = 0;
    let totalReps = 0;
    const allRepsSet = new Set();

    window.SEMANTIC.BU_LIST.forEach(bu => {
      const a = acc[bu];
      buOut[bu] = {
        coveragePct: a.rowCount > 0 ? (a.coveredSum / a.rowCount) * 100 : null,
        rightFreqPct: a.rowCount > 0 ? (a.rightFreqSum / a.rowCount) * 100 : null,
        repCount: a.repSet.size,
        customerRowCount: a.rowCount,
        visitCount: a.visitCount,
        plannedVisitCount: a.plannedVisitCount,
        confidence: a.rowCount > 0 ? "high" : "low",
      };
      totalVisits += a.visitCount;
      totalPlannedVisits += a.plannedVisitCount;
      a.repSet.forEach(rep => allRepsSet.add(rep));
    });

    return {
      ok: true,
      status: "ready",
      asOfDate: latestPeriod,
      source: "coverage",
      filterScope: { title: "Medical Representative", experience: "Non-Probation", status: "Active", types: wantTypes },
      bu: buOut,
      visitCount: totalVisits,
      plannedVisitCount: totalPlannedVisits,
      repCount: allRepsSet.size
    };
  }

  /**
   * ENTERPRISE SEMANTIC INTERFACE -- getFilteredCoverageByType(bu, line)
   * ------------------------------------------------------------------
   * Executive KPI cards (2026-07-27): Operational Coverage and Right
   * Frequency each need a click-through breakdown of the SAME filtered
   * population getFilteredCoverageForLine() already scopes, but split BY
   * customer type instead of merged into one number -- same filter
   * scope, same source rows, just grouped one level finer.
   *
   * `line` (added 2026-08-04, Ahmed): previously this took only `bu`, so
   * the modal ignored the Line filter entirely -- selecting CHC_SALES
   * showed a card scoped to the Pharmacy/Sales-Rep team (95.1% coverage)
   * above a popup still listing Contract/Doctor/Hospital under
   * "Title=Medical Representative". The card and its own drill-down
   * disagreed about which population they described.
   *
   * The per-row Title/Type flip is identical to
   * getFilteredCoverageForLine()'s: CHC_SALES rows are matched on
   * Title="Sales Representative" and Type="Pharmacy", every other line on
   * Title="Medical Representative" and Type in {Contract, Doctor,
   * Hospital}. Experience=Non-Probation and Status=Active apply to all
   * lines. Because the type universe itself depends on the line, the
   * returned `types` array is built from whichever types are actually in
   * scope -- so a CHC_SALES drill-down returns a single "Pharmacy" row,
   * not three empty ones.
   */
  function getFilteredCoverageByType(bu, line) {
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      if (typeof CacheStore !== "undefined" && !CacheStore.isReady()) {
        CacheStore.init();
      }
    }
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage", bu: bu, types: [] };
    }
    if (typeof window.SEMANTIC === "undefined") {
      console.error("[Coverage] getFilteredCoverageByType() requires js/semantic-model.js to be loaded first.");
      return { ok: false, status: "semantic_model_missing", asOfDate: null, source: "coverage", bu: bu, types: [] };
    }

    const records = CacheStore.getRecords();
    if (!records || !Array.isArray(records.rows) || records.rows.length === 0) {
      return { ok: false, status: "records_unavailable", asOfDate: null, source: "coverage", bu: bu, types: [] };
    }

    const dash = CacheStore.getDashboard();
    const dims = dash && dash.dimensions;
    const latestPeriod = dash && dash.latestPeriod ? dash.latestPeriod : null;
    if (!dims) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage", bu: bu, types: [] };
    }

    const F = {
      period: 0, team: 1, businessUnit: 2, nsm: 3, areaManager: 4, manager: 5,
      employee: 6, specialty: 7, klass: 8, status: 9, experience: 10, type: 11,
      coveredDoctor: 12, rightFreq: 13, visits: 14, isActive: 15, actualPlanX1000: 16,
      plansCount: 17, title: 18, customerName: 19, profile: 20, frequency: 21,
      lastVisitDate: 22, area: 23,
    };

    const latestPeriodIdx = (dims.periods || []).length - 1;
    const titleIdx = (dims.titles || []).indexOf("Medical Representative");
    // CHC_SALES reps are titled "Sales Representative" and their customers
    // are Type="Pharmacy" -- both dimensions flip together for that one
    // team, exactly as in getFilteredCoverageForLine().
    const salesRepTitleIdx = (dims.titles || []).indexOf("Sales Representative");
    const expIdx = (dims.experiences || []).indexOf("Non-Probation");
    const statusIdx = (dims.statuses || []).indexOf("Active");
    const standardTypes = ["Contract", "Doctor", "Hospital"];
    const pharmacyTypes = ["Pharmacy"];
    const normLineArg = line && line !== "All" ? window.SEMANTIC.normalizeLine(line) : null;

    // Which types can appear at all for this BU/line selection. Scoping
    // to CHC_SALES yields ["Pharmacy"]; anything else yields the standard
    // three. Selecting the whole CHC BU yields all four, since both
    // populations are legitimately in scope and each row is matched
    // against ITS OWN applicable title/type pair below.
    const chcSalesOnly = (bu === "CHC" && normLineArg === "CHC_SALES");
    const chcBuAll = (bu === "CHC" && !normLineArg);
    const wantTypes = chcSalesOnly ? pharmacyTypes
                    : chcBuAll ? standardTypes.concat(pharmacyTypes)
                    : standardTypes;

    const typeIdxByName = {};
    wantTypes.forEach(t => { const i = (dims.types || []).indexOf(t); if (i >= 0) typeIdxByName[t] = i; });

    if (titleIdx < 0 || expIdx < 0 || statusIdx < 0 || Object.keys(typeIdxByName).length === 0) {
      return { ok: false, status: "dimension_mismatch", asOfDate: latestPeriod, source: "coverage", bu: bu, line: line || "All", types: [] };
    }

    const acc = {};
    wantTypes.forEach(t => { acc[t] = { coveredSum: 0, rightFreqSum: 0, rowCount: 0, repSet: new Set(), classes: {}, visitCount: 0, plannedVisitCount: 0 }; });

    records.rows.forEach(row => {
      if (row[F.experience] !== expIdx) return;
      if (row[F.status] !== statusIdx) return;

      const teamName = (dims.teams || [])[row[F.team]];
      if (window.AUTH && !window.AUTH.isLineAllowed(teamName)) return;
      if (window.SEMANTIC.lineToBU(teamName) !== bu) return;
      const canonLine = window.SEMANTIC.normalizeLine(teamName);
      if (normLineArg && canonLine !== normLineArg) return;

      // Per-row title/type scope -- resolved from which line the row
      // belongs to, not from the filter selection, so a whole-BU CHC
      // drill-down measures each of its two teams correctly.
      const isChcSalesTeam = (bu === "CHC" && canonLine === "CHC_SALES");
      if (row[F.title] !== (isChcSalesTeam ? salesRepTitleIdx : titleIdx)) return;
      const applicableTypes = isChcSalesTeam ? pharmacyTypes : standardTypes;
      const typeName = applicableTypes.find(t => typeIdxByName[t] === row[F.type]);
      if (!typeName || !acc[typeName]) return;

      if (row[F.isActive]) {
        const a = acc[typeName];
        a.coveredSum += row[F.coveredDoctor] || 0;
        a.rightFreqSum += row[F.rightFreq] || 0;
        a.rowCount += 1;
        a.repSet.add(row[F.employee]);
        a.visitCount += row[F.visits] || 0;
        a.plannedVisitCount += row[F.frequency] || 0;

        // Class-level aggregation
        const classIdx = row[F.klass];
        if (classIdx !== null && classIdx !== undefined && classIdx >= 0) {
          if (!a.classes[classIdx]) {
            a.classes[classIdx] = { coveredSum: 0, rightFreqSum: 0, rowCount: 0 };
          }
          const c = a.classes[classIdx];
          c.coveredSum += row[F.coveredDoctor] || 0;
          c.rightFreqSum += row[F.rightFreq] || 0;
          c.rowCount += 1;
        }
      }
    });

    const types = wantTypes.map(t => {
      const a = acc[t];
      
      const classRates = [];
      Object.keys(a.classes).forEach(cIdxKey => {
        const cIdx = parseInt(cIdxKey, 10);
        const className = (dims.classes || [])[cIdx] || "Unknown";
        const c = a.classes[cIdx];
        if (c.rowCount > 0) {
          classRates.push({
            name: className,
            coveragePct: (c.coveredSum / c.rowCount) * 100,
            rightFreqPct: (c.rightFreqSum / c.rowCount) * 100
          });
        }
      });

      let topClassCov = null;
      let bottomClassCov = null;
      let topClassRf = null;
      let bottomClassRf = null;

      if (classRates.length > 0) {
        // Sort for Coverage
        const sortedCov = [...classRates].sort((x, y) => x.coveragePct - y.coveragePct);
        bottomClassCov = sortedCov[0];
        topClassCov = sortedCov[sortedCov.length - 1];

        // Sort for RF
        const sortedRf = [...classRates].sort((x, y) => x.rightFreqPct - y.rightFreqPct);
        bottomClassRf = sortedRf[0];
        topClassRf = sortedRf[sortedRf.length - 1];
      }

      return {
        name: t,
        coveragePct: a.rowCount > 0 ? (a.coveredSum / a.rowCount) * 100 : null,
        rightFreqPct: a.rowCount > 0 ? (a.rightFreqSum / a.rowCount) * 100 : null,
        repCount: a.repSet.size,
        customerRowCount: a.rowCount,
        plannedVisits: a.plannedVisitCount,
        actualVisits: a.visitCount,
        topClassCov: topClassCov ? { name: topClassCov.name, pct: topClassCov.coveragePct } : null,
        bottomClassCov: bottomClassCov ? { name: bottomClassCov.name, pct: bottomClassCov.coveragePct } : null,
        topClassRf: topClassRf ? { name: topClassRf.name, pct: topClassRf.rightFreqPct } : null,
        bottomClassRf: bottomClassRf ? { name: bottomClassRf.name, pct: bottomClassRf.rightFreqPct } : null,
      };
    });

    return {
      ok: true,
      status: "ready",
      asOfDate: latestPeriod,
      source: "coverage",
      bu: bu,
      line: line || "All",
      // Reports the scope ACTUALLY applied so the modal can caption itself
      // honestly instead of hardcoding "Title=Medical Representative" --
      // which was wrong the moment CHC_SALES was selected (2026-08-04).
      filterScope: {
        title: chcSalesOnly ? "Sales Representative"
             : chcBuAll ? "Medical Representative / Sales Representative (per line)"
             : "Medical Representative",
        experience: "Non-Probation",
        status: "Active",
        types: wantTypes,
      },
      // Drop types with no rows in scope, so a CHC_SALES drill shows one
      // Pharmacy row rather than three empty Contract/Doctor/Hospital ones.
      types: types.filter(t => t.customerRowCount > 0),
    };
  }

  /**
   * ENTERPRISE SEMANTIC INTERFACE -- getFilteredCoverageForLine(bu, line)
   * ------------------------------------------------------------------
   * Executive KPI 1/2 Line-filter support (2026-07-27): when the global
   * Line filter narrows to one specific line, Coverage %/RF % must use
   * the SAME Title=Medical Representative/Experience=Non-Probation/
   * Status=Active scope getFilteredCoverageSummary() uses at BU level --
   * reusing getLineAndTerritoryBreakdown()'s per-line rows here would
   * silently switch to a DIFFERENT (unfiltered) population and the
   * BU-level vs Line-level numbers would no longer reconcile. `line` is
   * a CANONICAL name (SEMANTIC.normalizeLine() already applied by the
   * caller); pass null/omit for the whole-BU figure.
   *
   * CHC SPECIAL CASE (2026-07-27, user correction): CHC has TWO real
   * lines -- "CHC" (Doctor/Hospital/Contract-facing reps, the standard
   * Title="Medical Representative"/Type-in-{Contract,Doctor,Hospital}
   * scope every other line uses) and "CHC_SALES" (a distinct
   * Pharmacy-facing sales team). Verified directly against the records
   * cache: CHC_SALES's rep-level rows are titled "Sales Representative"
   * (not "Medical Representative" -- that title literally does not
   * occur on this team), and its customers are Type="Pharmacy" (not
   * Contract/Doctor/Hospital). Filtering CHC_SALES on the standard
   * Title/Type scope would silently return zero rows every time, not a
   * smaller-but-real number -- both dimensions have to flip together
   * for this one team. So both Title and Type scope are resolved PER
   * ROW based on which of CHC's two lines that row belongs to; every
   * other BU/line still uses the single standard Title/Type scope
   * uniformly (no other BU has this dual-line/dual-scope pattern). When
   * line="All" (whole BU), both of CHC's populations are correctly
   * included, each measured against ITS OWN applicable scope -- this is
   * an intentional, real change to CHC's headline Coverage/RF (it
   * previously excluded the Pharmacy-facing team's rows entirely).
   */
  function getFilteredCoverageForLine(bu, line, ignoreLineAuth) {
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      if (typeof CacheStore !== "undefined" && !CacheStore.isReady()) {
        CacheStore.init();
      }
    }
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage", bu: bu, line: line || null };
    }
    if (typeof window.SEMANTIC === "undefined") {
      console.error("[Coverage] getFilteredCoverageForLine() requires js/semantic-model.js to be loaded first.");
      return { ok: false, status: "semantic_model_missing", asOfDate: null, source: "coverage", bu: bu, line: line || null };
    }

    const records = CacheStore.getRecords();
    if (!records || !Array.isArray(records.rows) || records.rows.length === 0) {
      return { ok: false, status: "records_unavailable", asOfDate: null, source: "coverage", bu: bu, line: line || null };
    }

    const dash = CacheStore.getDashboard();
    const dims = dash && dash.dimensions;
    const latestPeriod = dash && dash.latestPeriod ? dash.latestPeriod : null;
    if (!dims) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage", bu: bu, line: line || null };
    }

    // ROLE-BASED ACCESS SCOPE (2026-07-29): a signed-in user restricted
    // to specific BUs/Lines (Zeta_Dashboard_User_Config.xlsx) must never
    // get real numbers back for a BU/Line outside that scope, even if a
    // caller (buggy or otherwise) asks for one directly -- same
    // "authentication is not bypassed" rule IQVIA's getBusinessSummary()
    // already enforces for the no-session case, extended to per-user
    // scope. The Executive Command Center's own filter dropdown already
    // only offers allowed BUs/Lines (see js/executive.js), so this
    // should never actually trigger in normal use -- it's the backstop.
    if (window.AUTH && !window.AUTH.isBuAllowed(bu)) {
      return { ok: false, status: "access_denied", asOfDate: latestPeriod, source: "coverage", bu: bu, line: line || null };
    }
    if (!ignoreLineAuth && window.AUTH && line && !window.AUTH.isLineAllowed(line)) {
      return { ok: false, status: "access_denied", asOfDate: latestPeriod, source: "coverage", bu: bu, line: line || null };
    }

    const F = {
      period: 0, team: 1, businessUnit: 2, nsm: 3, areaManager: 4, manager: 5,
      employee: 6, specialty: 7, klass: 8, status: 9, experience: 10, type: 11,
      coveredDoctor: 12, rightFreq: 13, visits: 14, isActive: 15, actualPlanX1000: 16,
      plansCount: 17, title: 18, customerName: 19, profile: 20, frequency: 21,
      lastVisitDate: 22, area: 23,
    };

    const latestPeriodIdx = (dims.periods || []).length - 1;
    const titleIdx = (dims.titles || []).indexOf("Medical Representative");
    // CHC_SALES reps are titled "Sales Representative", never "Medical
    // Representative" -- confirmed against the records cache (2026-07-27).
    const salesRepTitleIdx = (dims.titles || []).indexOf("Sales Representative");
    const expIdx = (dims.experiences || []).indexOf("Non-Probation");
    const statusIdx = (dims.statuses || []).indexOf("Active");
    const wantTypes = ["Contract", "Doctor", "Hospital"];
    const standardTypeIdxSet = new Set(wantTypes.map(t => (dims.types || []).indexOf(t)).filter(i => i >= 0));
    // CHC's "CHC_SALES" team is Pharmacy-facing -- its Coverage/RF uses the
    // Pharmacy customer Type instead of the standard Contract/Doctor/Hospital
    // scope every other line uses (see doc comment above).
    const pharmacyTypes = ["Pharmacy"];
    const pharmacyTypeIdxSet = new Set(pharmacyTypes.map(t => (dims.types || []).indexOf(t)).filter(i => i >= 0));

    const normLineArg = line && line !== "All" ? window.SEMANTIC.normalizeLine(line) : null;

    if (titleIdx < 0 || expIdx < 0 || statusIdx < 0 || standardTypeIdxSet.size === 0) {
      return { ok: false, status: "dimension_mismatch", asOfDate: latestPeriod, source: "coverage", bu: bu, line: line || null };
    }

    let coveredSum = 0, rightFreqSum = 0, rowCount = 0;
    const repSet = new Set();
    let visitCount = 0, plannedVisitCount = 0;

    let coveredSumLatest = 0, rightFreqSumLatest = 0, rowCountLatest = 0;
    const repSetLatest = new Set();
    let visitCountLatest = 0, plannedVisitCountLatest = 0;

    records.rows.forEach(row => {
      if (row[F.experience] !== expIdx) return;
      if (row[F.status] !== statusIdx) return;

      const teamName = (dims.teams || [])[row[F.team]];
      if (!ignoreLineAuth && window.AUTH && !window.AUTH.isLineAllowed(teamName)) return;
      const rowBU = window.SEMANTIC.lineToBU(teamName);
      if (rowBU !== bu) return;
      const canonLine = window.SEMANTIC.normalizeLine(teamName);
      if (normLineArg && canonLine !== normLineArg) return;

      const isChcSalesTeam = (bu === "CHC" && canonLine === "CHC_SALES");
      const applicableTitleIdx = isChcSalesTeam ? salesRepTitleIdx : titleIdx;
      if (row[F.title] !== applicableTitleIdx) return;
      const applicableTypeIdxSet = isChcSalesTeam ? pharmacyTypeIdxSet : standardTypeIdxSet;
      if (!applicableTypeIdxSet.has(row[F.type])) return;

      if (row[F.isActive]) {
        coveredSum += row[F.coveredDoctor] || 0;
        rightFreqSum += row[F.rightFreq] || 0;
        rowCount += 1;
        repSet.add(row[F.employee]);

        visitCount += row[F.visits] || 0;
        plannedVisitCount += row[F.frequency] || 0;

        if (row[F.period] === latestPeriodIdx) {
          coveredSumLatest += row[F.coveredDoctor] || 0;
          rightFreqSumLatest += row[F.rightFreq] || 0;
          rowCountLatest += 1;
          repSetLatest.add(row[F.employee]);

          visitCountLatest += row[F.visits] || 0;
          plannedVisitCountLatest += row[F.frequency] || 0;
        }
      }
    });

    return {
      ok: true,
      status: "ready",
      asOfDate: latestPeriod,
      source: "coverage",
      bu: bu,
      line: line || "All",
      // Pooled across every period in the cache. Kept as the primary
      // field names for backward compatibility -- every existing consumer
      // (rankings, corporate benchmark, Evidence dashboard) keeps reading
      // exactly what it read before.
      coveragePct: rowCount > 0 ? (coveredSum / rowCount) * 100 : null,
      rightFreqPct: rowCount > 0 ? (rightFreqSum / rowCount) * 100 : null,
      repCount: repSet.size,
      customerRowCount: rowCount,
      visitCount: visitCount,
      plannedVisitCount: plannedVisitCount,
      // Latest period only (2026-08-04) -- see the accumulator comment
      // above for why rates need this. `periodsPooled` lets a caller
      // caption the pooled figure accurately instead of guessing.
      latestPeriod: latestPeriod,
      periodsPooled: (dims.periods || []).length,
      coveragePctLatest: rowCountLatest > 0 ? (coveredSumLatest / rowCountLatest) * 100 : null,
      rightFreqPctLatest: rowCountLatest > 0 ? (rightFreqSumLatest / rowCountLatest) * 100 : null,
      repCountLatest: repSetLatest.size,
      customerRowCountLatest: rowCountLatest,
      visitCountLatest: visitCountLatest,
      plannedVisitCountLatest: plannedVisitCountLatest,
      filterScope: {
        title: "Medical Representative", experience: "Non-Probation", status: "Active",
        types: wantTypes,
        chcSalesTitle: (bu === "CHC" && (!line || line === "All" || line === "CHC_SALES")) ? "Sales Representative" : undefined,
        chcSalesTypes: (bu === "CHC" && (!line || line === "All" || line === "CHC_SALES")) ? pharmacyTypes : undefined,
      },
    };
  }

  /**
   * ENTERPRISE SEMANTIC INTERFACE -- getExecutionWorkloadSummary()
   * ------------------------------------------------------------------
   * Two more Evidence Dashboard components (2026-07-26 V4 proposal),
   * both derived from the SAME single pass over raw rows (no reason to
   * scan twice):
   *
   *   - fieldExecutionPct = onTargetCalls / (onTargetCalls + missedCalls
   *     + wastedCalls) -- "of all the calls that should have happened,
   *     how many actually landed on-target" (mirrors analytics.js's own
   *     accumulate(): onTargetCalls = min(visits,target), missedCalls =
   *     max(0,target-visits), wastedCalls = max(0,visits-target), all
   *     isActive-scoped). Unlike getFilteredCoverageSummary(), this is
   *     computed over ALL titles/customer types -- same scope as the
   *     existing headline Coverage %/RF % row -- so it's a second lens
   *     on the same population, not a third different segment.
   *
   *   - workloadPct = this BU's Customers-per-Rep ÷ the PLATFORM-WIDE
   *     (all 4 BUs) average Customers-per-Rep x 100. 100 = carrying
   *     exactly the average load; >100 = overloaded vs the rest of the
   *     field force, <100 = underutilized. NOTE: the benchmark here is
   *     "platform average," a reasonable default absent an official SFE
   *     span-of-control target -- flagged explicitly in
   *     EXECUTIVE_COMMAND_CENTER_V4_PROPOSAL.md §4/§7, not silently
   *     assumed. Swap in an official benchmark the moment SFE sets one.
   */
  function getExecutionWorkloadSummary() {
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      if (typeof CacheStore !== "undefined" && !CacheStore.isReady()) {
        CacheStore.init();
      }
    }
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage", bu: {} };
    }
    if (typeof window.SEMANTIC === "undefined") {
      console.error("[Coverage] getExecutionWorkloadSummary() requires js/semantic-model.js to be loaded first.");
      return { ok: false, status: "semantic_model_missing", asOfDate: null, source: "coverage", bu: {} };
    }

    const records = CacheStore.getRecords();
    if (!records || !Array.isArray(records.rows) || records.rows.length === 0) {
      return { ok: false, status: "records_unavailable", asOfDate: null, source: "coverage", bu: {} };
    }

    const dash = CacheStore.getDashboard();
    const dims = dash && dash.dimensions;
    const latestPeriod = dash && dash.latestPeriod ? dash.latestPeriod : null;
    if (!dims) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage", bu: {} };
    }

    const F = {
      period: 0, team: 1, businessUnit: 2, nsm: 3, areaManager: 4, manager: 5,
      employee: 6, specialty: 7, klass: 8, status: 9, experience: 10, type: 11,
      coveredDoctor: 12, rightFreq: 13, visits: 14, isActive: 15, actualPlanX1000: 16,
      plansCount: 17, title: 18, customerName: 19, profile: 20, frequency: 21,
      lastVisitDate: 22, area: 23,
    };

    const latestPeriodIdx = (dims.periods || []).length - 1;

    const acc = {};
    window.SEMANTIC.BU_LIST.forEach(bu => {
      acc[bu] = { onTargetCalls: 0, missedCalls: 0, wastedCalls: 0, rowCount: 0, repSet: new Set() };
    });

    records.rows.forEach(row => {
      if (!row[F.isActive]) return; // same isActive scoping as every other Coverage KPI
      const teamName = (dims.teams || [])[row[F.team]];
      if (window.AUTH && !window.AUTH.isLineAllowed(teamName)) return;
      const bu = window.SEMANTIC.lineToBU(teamName);
      if (!bu) return;

      const a = acc[bu];
      const target = row[F.frequency] || 0;
      const visits = row[F.visits] || 0;
      a.onTargetCalls += Math.min(visits, target);
      a.missedCalls += Math.max(0, target - visits);
      a.wastedCalls += Math.max(0, visits - target);
      a.rowCount += 1;
      a.repSet.add(row[F.employee]);
    });

    // Platform-wide Customers-per-Rep benchmark -- the denominator for
    // every BU's workloadPct, computed once across all 4 BUs together.
    let platformRowCount = 0, platformRepCount = 0;
    const platformReps = new Set();
    window.SEMANTIC.BU_LIST.forEach(bu => {
      platformRowCount += acc[bu].rowCount;
      acc[bu].repSet.forEach(e => platformReps.add(bu + "::" + e)); // bu-qualified so the same name in two BUs isn't merged
    });
    platformRepCount = platformReps.size;
    const platformCustomersPerRep = platformRepCount > 0 ? platformRowCount / platformRepCount : null;

    const buOut = {};
    window.SEMANTIC.BU_LIST.forEach(bu => {
      const a = acc[bu];
      const totalCalls = a.onTargetCalls + a.missedCalls + a.wastedCalls;
      const fieldExecutionPct = totalCalls > 0 ? (a.onTargetCalls / totalCalls) * 100 : null;
      const customersPerRep = a.repSet.size > 0 ? a.rowCount / a.repSet.size : null;
      const workloadPct = (customersPerRep !== null && platformCustomersPerRep !== null && platformCustomersPerRep > 0)
        ? (customersPerRep / platformCustomersPerRep) * 100 : null;
      buOut[bu] = {
        fieldExecutionPct: fieldExecutionPct,
        customersPerRep: customersPerRep,
        workloadPct: workloadPct,
        repCount: a.repSet.size,
        confidence: a.rowCount > 0 ? "high" : "low",
      };
    });

    return {
      ok: true,
      status: "ready",
      asOfDate: latestPeriod,
      source: "coverage",
      benchmark: { platformCustomersPerRep: platformCustomersPerRep, note: "Platform-wide average across all 4 BUs -- provisional benchmark absent an official SFE span-of-control target." },
      bu: buOut,
    };
  }

  /**
   * ENTERPRISE SEMANTIC INTERFACE -- getLineAndTerritoryBreakdown(bu)
   * ------------------------------------------------------------------
   * "Impact of Lines and Territories" (2026-07-26 V4 proposal) -- one
   * BU's Lines (already pre-aggregated in dashboard.teamComparison, just
   * filtered to this BU via the same Line->BU crosswalk every other
   * interface here uses) and Territories (Area, one raw-row pass,
   * isActive-scoped, latest period -- same technique as
   * getFilteredCoverageSummary()/getExecutionWorkloadSummary() above).
   * Territories returns ALL areas sorted by coveragePct descending --
   * the caller (Executive) decides how many to show (top/bottom N) so
   * this interface stays a plain data source, not a presentation choice.
   */
  function getLineAndTerritoryBreakdown(bu) {
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      if (typeof CacheStore !== "undefined" && !CacheStore.isReady()) {
        CacheStore.init();
      }
    }
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage", bu: bu, lines: [], territories: [] };
    }
    if (typeof window.SEMANTIC === "undefined") {
      console.error("[Coverage] getLineAndTerritoryBreakdown() requires js/semantic-model.js to be loaded first.");
      return { ok: false, status: "semantic_model_missing", asOfDate: null, source: "coverage", bu: bu, lines: [], territories: [] };
    }

    const dash = CacheStore.getDashboard();
    const latestPeriod = dash && dash.latestPeriod ? dash.latestPeriod : null;
    const teamComparison = (dash && dash.teamComparison) || [];

    const lines = teamComparison
      .filter(row => window.SEMANTIC.lineToBU(row.team) === bu)
      .filter(row => !window.AUTH || window.AUTH.isLineAllowed(row.team))
      .map(row => ({
        name: row.team,
        coveragePct: (row.coveragePct || 0) * 100,
        rightFreqPct: (row.rightFreqPct || 0) * 100,
        headcount: row.headcount || 0,
      }))
      .sort((a, b) => b.coveragePct - a.coveragePct);

    const records = CacheStore.getRecords();
    let territories = [];
    if (records && Array.isArray(records.rows) && records.rows.length) {
      const dims = dash && dash.dimensions;
      if (dims && dims.areas) {
        const F = {
          period: 0, team: 1, businessUnit: 2, nsm: 3, areaManager: 4, manager: 5,
          employee: 6, specialty: 7, klass: 8, status: 9, experience: 10, type: 11,
          coveredDoctor: 12, rightFreq: 13, visits: 14, isActive: 15, actualPlanX1000: 16,
          plansCount: 17, title: 18, customerName: 19, profile: 20, frequency: 21,
          lastVisitDate: 22, area: 23,
        };
        const latestPeriodIdx = (dims.periods || []).length - 1;
        const acc = new Map(); // areaIdx -> { coveredSum, rowCount }
        records.rows.forEach(row => {
          if (!row[F.isActive]) return;
          const teamName = (dims.teams || [])[row[F.team]];
          if (window.AUTH && !window.AUTH.isLineAllowed(teamName)) return;
          if (window.SEMANTIC.lineToBU(teamName) !== bu) return;
          const areaIdx = row[F.area];
          if (areaIdx === undefined || areaIdx === null || areaIdx < 0) return;
          if (!acc.has(areaIdx)) acc.set(areaIdx, { coveredSum: 0, rowCount: 0 });
          const a = acc.get(areaIdx);
          a.coveredSum += row[F.coveredDoctor] || 0;
          a.rowCount += 1;
        });
        territories = Array.from(acc.entries())
          .map(([areaIdx, a]) => ({
            name: dims.areas[areaIdx] || ("Area " + areaIdx),
            coveragePct: a.rowCount > 0 ? (a.coveredSum / a.rowCount) * 100 : null,
            customerRowCount: a.rowCount,
          }))
          .filter(t => t.name && t.coveragePct !== null)
          .sort((a, b) => b.coveragePct - a.coveragePct);
      }
    }

    return {
      ok: true,
      status: "ready",
      asOfDate: latestPeriod,
      source: "coverage",
      bu: bu,
      lines: lines,
      territories: territories,
    };
  }

  /**
   * getCorporateCoverageTotals() -- ADDED 2026-07-31 ("add corporate
   * performance to each Executive KPI card as reference"). Company-wide
   * (all 4 BUs, every allowed line) blended Coverage %/Right Frequency
   * %, using the EXACT SAME row-level scope as getFilteredCoverageForLine()
   * above (latest period, Non-Probation, Active, Medical Representative
   * title + standard Contract/Doctor/Hospital types, with CHC's
   * CHC_SALES carve-out to Sales Representative/Pharmacy) -- just summed
   * across every BU instead of one, so it's the same methodology as the
   * per-BU cards, not a different approximation.
   *
   * Deliberately UNGATED (no AUTH.isBuAllowed() check): it never returns
   * a per-BU breakdown, only the single blended company total, so it
   * can never be used to recover any one out-of-scope BU's individual
   * number -- same reasoning as IQVIA's getCorporateMarketIntel() and
   * the platform's existing getExecutionWorkloadSummary() (also loops
   * every BU ungated for a platform-wide benchmark).
   */
  function getCorporateCoverageTotals() {
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      if (typeof CacheStore !== "undefined" && !CacheStore.isReady()) {
        CacheStore.init();
      }
    }
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage" };
    }
    if (typeof window.SEMANTIC === "undefined") {
      console.error("[Coverage] getCorporateCoverageTotals() requires js/semantic-model.js to be loaded first.");
      return { ok: false, status: "semantic_model_missing", asOfDate: null, source: "coverage" };
    }

    const records = CacheStore.getRecords();
    if (!records || !Array.isArray(records.rows) || records.rows.length === 0) {
      return { ok: false, status: "records_unavailable", asOfDate: null, source: "coverage" };
    }

    const dash = CacheStore.getDashboard();
    const dims = dash && dash.dimensions;
    const latestPeriod = dash && dash.latestPeriod ? dash.latestPeriod : null;
    if (!dims) {
      return { ok: false, status: "cache_unavailable", asOfDate: null, source: "coverage" };
    }

    const F = {
      period: 0, team: 1, businessUnit: 2, nsm: 3, areaManager: 4, manager: 5,
      employee: 6, specialty: 7, klass: 8, status: 9, experience: 10, type: 11,
      coveredDoctor: 12, rightFreq: 13, visits: 14, isActive: 15, actualPlanX1000: 16,
      plansCount: 17, title: 18, customerName: 19, profile: 20, frequency: 21,
      lastVisitDate: 22, area: 23,
    };

    const latestPeriodIdx = (dims.periods || []).length - 1;
    const titleIdx = (dims.titles || []).indexOf("Medical Representative");
    const salesRepTitleIdx = (dims.titles || []).indexOf("Sales Representative");
    const expIdx = (dims.experiences || []).indexOf("Non-Probation");
    const statusIdx = (dims.statuses || []).indexOf("Active");
    const wantTypes = ["Contract", "Doctor", "Hospital"];
    const standardTypeIdxSet = new Set(wantTypes.map(t => (dims.types || []).indexOf(t)).filter(i => i >= 0));
    const pharmacyTypes = ["Pharmacy"];
    const pharmacyTypeIdxSet = new Set(pharmacyTypes.map(t => (dims.types || []).indexOf(t)).filter(i => i >= 0));


    if (titleIdx < 0 || expIdx < 0 || statusIdx < 0 || standardTypeIdxSet.size === 0) {
      return { ok: false, status: "dimension_mismatch", asOfDate: latestPeriod, source: "coverage" };
    }

    let coveredSum = 0, rightFreqSum = 0, rowCount = 0;
    // Latest-period corporate figures (2026-08-04) -- the Executive cards
    // now lead with the latest period for these rate metrics, and a
    // benchmark computed on a different period basis than the number it
    // sits under would be actively misleading. Same single pass.
    let coveredSumLatest = 0, rightFreqSumLatest = 0, rowCountLatest = 0;

    records.rows.forEach(row => {
      if (row[F.experience] !== expIdx) return;
      if (row[F.status] !== statusIdx) return;

      const teamName = (dims.teams || [])[row[F.team]];
      if (window.AUTH && !window.AUTH.isLineAllowed(teamName)) return;
      const rowBU = window.SEMANTIC.lineToBU(teamName);
      if (!rowBU) return; // Non-Promoted/Other Markets -- out of scope, same as every BU-level call

      const canonLine = window.SEMANTIC.normalizeLine(teamName);
      const isChcSalesTeam = (rowBU === "CHC" && canonLine === "CHC_SALES");
      const applicableTitleIdx = isChcSalesTeam ? salesRepTitleIdx : titleIdx;
      if (row[F.title] !== applicableTitleIdx) return;
      const applicableTypeIdxSet = isChcSalesTeam ? pharmacyTypeIdxSet : standardTypeIdxSet;
      if (!applicableTypeIdxSet.has(row[F.type])) return;

      if (row[F.isActive]) {
        coveredSum += row[F.coveredDoctor] || 0;
        rightFreqSum += row[F.rightFreq] || 0;
        rowCount += 1;

        if (row[F.period] === latestPeriodIdx) {
          coveredSumLatest += row[F.coveredDoctor] || 0;
          rightFreqSumLatest += row[F.rightFreq] || 0;
          rowCountLatest += 1;
        }
      }
    });

    return {
      ok: true,
      status: "ready",
      asOfDate: latestPeriod,
      source: "coverage",
      coveragePct: rowCount > 0 ? (coveredSum / rowCount) * 100 : null,
      rightFreqPct: rowCount > 0 ? (rightFreqSum / rowCount) * 100 : null,
      customerRowCount: rowCount,
      latestPeriod: latestPeriod,
      periodsPooled: (dims.periods || []).length,
      coveragePctLatest: rowCountLatest > 0 ? (coveredSumLatest / rowCountLatest) * 100 : null,
      rightFreqPctLatest: rowCountLatest > 0 ? (rightFreqSumLatest / rowCountLatest) * 100 : null,
      customerRowCountLatest: rowCountLatest,
    };
  }

  function getFilteredCoverageForDm(bu, line, dmName) {
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      CacheStore.init();
    }
    const records = CacheStore.getRecords();
    if (!records || !Array.isArray(records.rows)) return null;
    const dash = CacheStore.getDashboard();
    const dims = dash && dash.dimensions;
    if (!dims) return null;

    const F = {
      period: 0, team: 1, businessUnit: 2, nsm: 3, areaManager: 4, manager: 5,
      employee: 6, specialty: 7, klass: 8, status: 9, experience: 10, type: 11,
      coveredDoctor: 12, rightFreq: 13, visits: 14, isActive: 15, actualPlanX1000: 16,
      plansCount: 17, title: 18, customerName: 19, profile: 20, frequency: 21,
      lastVisitDate: 22, area: 23,
    };

    const latestPeriodIdx = (dims.periods || []).length - 1;
    const titleIdx = (dims.titles || []).indexOf("Medical Representative");
    const expIdx = (dims.experiences || []).indexOf("Non-Probation");
    const statusIdx = (dims.statuses || []).indexOf("Active");
    const salesRepTitleIdx = (dims.titles || []).indexOf("Sales Representative");

    const wantTypes = ["Contract", "Doctor", "Hospital"];
    const standardTypeIdxSet = new Set(wantTypes.map(t => (dims.types || []).indexOf(t)).filter(i => i >= 0));
    const pharmacyTypes = ["Pharmacy"];
    const pharmacyTypeIdxSet = new Set(pharmacyTypes.map(t => (dims.types || []).indexOf(t)).filter(i => i >= 0));

    const normLineArg = line && line !== "All" ? window.SEMANTIC.normalizeLine(line) : null;

    // CASE-INSENSITIVE SEARCH
    const cleanDm = dmName.toUpperCase().trim();
    const dmIdx = (dims.managers || []).findIndex(m => m && m.toUpperCase().trim() === cleanDm);
    if (dmIdx < 0) return null;

    let coveredSum = 0, rightFreqSum = 0, rowCount = 0;
    const repSet = new Set();

    records.rows.forEach(row => {
      if (row[F.experience] !== expIdx) return;
      if (row[F.status] !== statusIdx) return;
      if (row[F.manager] !== dmIdx) return;

      const teamName = (dims.teams || [])[row[F.team]];
      if (window.AUTH && !window.AUTH.isLineAllowed(teamName)) return;
      const rowBU = window.SEMANTIC.lineToBU(teamName);
      if (rowBU !== bu) return;
      const canonLine = window.SEMANTIC.normalizeLine(teamName);
      if (normLineArg && canonLine !== normLineArg) return;

      const isChcSalesTeam = (bu === "CHC" && canonLine === "CHC_SALES");
      const applicableTitleIdx = isChcSalesTeam ? salesRepTitleIdx : titleIdx;
      if (row[F.title] !== applicableTitleIdx) return;
      const applicableTypeIdxSet = isChcSalesTeam ? pharmacyTypeIdxSet : standardTypeIdxSet;
      if (!applicableTypeIdxSet.has(row[F.type])) return;

      if (row[F.isActive]) {
        coveredSum += row[F.coveredDoctor] || 0;
        rightFreqSum += row[F.rightFreq] || 0;
        rowCount += 1;
        repSet.add(row[F.employee]);
      }
    });

    return {
      ok: true,
      coveragePct: rowCount > 0 ? (coveredSum / rowCount) * 100 : null,
      rightFreqPct: rowCount > 0 ? (rightFreqSum / rowCount) * 100 : null,
      repCount: repSet.size,
      customerRowCount: rowCount,
    };
  }

  function getDmRepsList(bu, line, dmName) {
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      CacheStore.init();
    }
    const records = CacheStore.getRecords();
    if (!records || !Array.isArray(records.rows)) return [];
    const dash = CacheStore.getDashboard();
    const dims = dash && dash.dimensions;
    if (!dims) return [];

    const F = {
      period: 0, team: 1, businessUnit: 2, nsm: 3, areaManager: 4, manager: 5,
      employee: 6, specialty: 7, klass: 8, status: 9, experience: 10, type: 11,
      coveredDoctor: 12, rightFreq: 13, visits: 14, isActive: 15, actualPlanX1000: 16,
      plansCount: 17, title: 18, customerName: 19, profile: 20, frequency: 21,
      lastVisitDate: 22, area: 23,
    };

    const latestPeriodIdx = (dims.periods || []).length - 1;
    const titleIdx = (dims.titles || []).indexOf("Medical Representative");
    const expIdx = (dims.experiences || []).indexOf("Non-Probation");
    const statusIdx = (dims.statuses || []).indexOf("Active");
    const salesRepTitleIdx = (dims.titles || []).indexOf("Sales Representative");

    const wantTypes = ["Contract", "Doctor", "Hospital"];
    const standardTypeIdxSet = new Set(wantTypes.map(t => (dims.types || []).indexOf(t)).filter(i => i >= 0));
    const pharmacyTypes = ["Pharmacy"];
    const pharmacyTypeIdxSet = new Set(pharmacyTypes.map(t => (dims.types || []).indexOf(t)).filter(i => i >= 0));

    const normLineArg = line && line !== "All" ? window.SEMANTIC.normalizeLine(line) : null;

    // CASE-INSENSITIVE SEARCH
    const cleanDm = dmName.toUpperCase().trim();
    const dmIdx = (dims.managers || []).findIndex(m => m && m.toUpperCase().trim() === cleanDm);
    if (dmIdx < 0) return [];

    const repMap = new Map(); // employeeIdx -> { coveredSum, rightFreqSum, rowCount }

    records.rows.forEach(row => {
      if (row[F.experience] !== expIdx) return;
      if (row[F.status] !== statusIdx) return;
      if (row[F.manager] !== dmIdx) return;

      const teamName = (dims.teams || [])[row[F.team]];
      if (window.AUTH && !window.AUTH.isLineAllowed(teamName)) return;
      const rowBU = window.SEMANTIC.lineToBU(teamName);
      if (rowBU !== bu) return;
      const canonLine = window.SEMANTIC.normalizeLine(teamName);
      if (normLineArg && canonLine !== normLineArg) return;

      const isChcSalesTeam = (bu === "CHC" && canonLine === "CHC_SALES");
      const applicableTitleIdx = isChcSalesTeam ? salesRepTitleIdx : titleIdx;
      if (row[F.title] !== applicableTitleIdx) return;
      const applicableTypeIdxSet = isChcSalesTeam ? pharmacyTypeIdxSet : standardTypeIdxSet;
      if (!applicableTypeIdxSet.has(row[F.type])) return;

      const empIdx = row[F.employee];
      if (!repMap.has(empIdx)) {
        repMap.set(empIdx, { coveredSum: 0, rightFreqSum: 0, rowCount: 0 });
      }
      const a = repMap.get(empIdx);
      if (row[F.isActive]) {
        a.coveredSum += row[F.coveredDoctor] || 0;
        a.rightFreqSum += row[F.rightFreq] || 0;
        a.rowCount += 1;
      }
    });

    const reps = Array.from(repMap.entries()).map(([empIdx, a]) => {
      const empName = dims.employeeNames[empIdx] || "";
      const empCode = dims.employeeCodes[empIdx] || "";
      return {
        name: empName,
        code: empCode,
        coveragePct: a.rowCount > 0 ? (a.coveredSum / a.rowCount) * 100 : null,
        rightFreqPct: a.rowCount > 0 ? (a.rightFreqSum / a.rowCount) * 100 : null,
        rowCount: a.rowCount,
      };
    });

    return reps;
  }

  /**
   * ENTERPRISE SEMANTIC INTERFACE -- getDmPositionsMap()
   * --------------------------------------------------------------------
   * Map of District Manager name -> their own position (territory), e.g.
   * "ORTHO-I DM DELTA B", "CVM-II DM ALEX-BEHIRA".
   *
   * Added 2026-08-07 (Ahmed: "when filter line and dsm shown show under
   * name his position"), for the Executive Line Performance table.
   *
   * WHY NOT getRepPositionsMap(). That map is built from the SALES cache's
   * reps/rep_positions lookups and contains 980 medical representatives.
   * District Managers are not in it -- measured: 0 of 47 DMs resolved. A
   * DM's position lives in the COVERAGE records instead, on the DM's own
   * row, which is the row whose title is "District Manager" and whose
   * employee IS the manager rather than someone reporting to them.
   *
   * Note "position" here means TERRITORY, not job title -- the platform
   * uses the word the way the source workbooks do ("ORTHO-I FAYOUM"),
   * matching the Position column already shown in the DM drill-down.
   *
   * A handful of DMs (4 of 102 measured) carry two positions because they
   * cover two districts. Both are returned, joined, rather than silently
   * dropping one -- a manager covering two districts is a real and
   * relevant fact about their span.
   */
  function getDmPositionsMap() {
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      CacheStore.init();
    }
    const records = CacheStore.getRecords();
    if (!records || !Array.isArray(records.rows)) return {};
    const dash = CacheStore.getDashboard();
    const dims = dash && dash.dimensions;
    if (!dims) return {};

    const F = { employee: 6, title: 18, profile: 20 };
    const dmTitleIdx = (dims.titles || []).indexOf("District Manager");
    if (dmTitleIdx < 0) return {};

    const acc = new Map();
    records.rows.forEach(function (row) {
      if (row[F.title] !== dmTitleIdx) return;
      const name = dims.employeeNames[row[F.employee]];
      if (!name) return;
      const profile = dims.profiles[row[F.profile]];
      if (!profile) return;
      const key = String(name).toUpperCase().trim();
      if (!acc.has(key)) acc.set(key, new Set());
      acc.get(key).add(profile);
    });

    const out = {};
    acc.forEach(function (set, key) {
      out[key] = Array.from(set).join(" · ");
    });
    return out;
  }

  global.CoverageDashboard = global.CoverageDashboard || {};
  global.CoverageDashboard.getDmPositionsMap = getDmPositionsMap;
  global.CoverageDashboard.getBusinessSummary = getBusinessSummary;
  global.CoverageDashboard.getFilteredCoverageSummary = getFilteredCoverageSummary;
  global.CoverageDashboard.getFilteredCoverageByType = getFilteredCoverageByType;
  global.CoverageDashboard.getFilteredCoverageForLine = getFilteredCoverageForLine;
  global.CoverageDashboard.getFilteredCoverageForDm = getFilteredCoverageForDm;
  global.CoverageDashboard.getDmRepsList = getDmRepsList;
  global.CoverageDashboard.getExecutionWorkloadSummary = getExecutionWorkloadSummary;
  global.CoverageDashboard.getLineAndTerritoryBreakdown = getLineAndTerritoryBreakdown;
  global.CoverageDashboard.getCorporateCoverageTotals = getCorporateCoverageTotals;
})(window);
