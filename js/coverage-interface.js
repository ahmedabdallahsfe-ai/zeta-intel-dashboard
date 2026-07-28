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
      acc[bu] = { coveredSum: 0, rightFreqSum: 0, rowCount: 0, repSet: new Set() };
    });

    records.rows.forEach(row => {
      if (row[F.period] !== latestPeriodIdx) return;
      if (row[F.title] !== titleIdx) return;
      if (row[F.experience] !== expIdx) return;
      if (row[F.status] !== statusIdx) return;
      if (!typeIdxSet.has(row[F.type])) return;

      const teamName = (dims.teams || [])[row[F.team]];
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
      }
    });

    const buOut = {};
    window.SEMANTIC.BU_LIST.forEach(bu => {
      const a = acc[bu];
      buOut[bu] = {
        coveragePct: a.rowCount > 0 ? (a.coveredSum / a.rowCount) * 100 : null,
        rightFreqPct: a.rowCount > 0 ? (a.rightFreqSum / a.rowCount) * 100 : null,
        repCount: a.repSet.size,
        customerRowCount: a.rowCount,
        confidence: a.rowCount > 0 ? "high" : "low",
      };
    });

    return {
      ok: true,
      status: "ready",
      asOfDate: latestPeriod,
      source: "coverage",
      filterScope: { title: "Medical Representative", experience: "Non-Probation", status: "Active", types: wantTypes },
      bu: buOut,
    };
  }

  /**
   * ENTERPRISE SEMANTIC INTERFACE -- getFilteredCoverageByType(bu)
   * ------------------------------------------------------------------
   * Executive KPI cards (2026-07-27): Operational Coverage and Right
   * Frequency each need a click-through breakdown of the SAME filtered
   * population getFilteredCoverageSummary() already scopes (Title=Medical
   * Representative, Experience=Non-Probation, Status=Active), but split
   * BY customer type (Contract/Doctor/Hospital) instead of merged into
   * one number -- same filter scope, same source rows, just grouped one
   * level finer. Single BU per call (the modal only ever needs the BU
   * the user clicked into).
   */
  function getFilteredCoverageByType(bu) {
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
    const expIdx = (dims.experiences || []).indexOf("Non-Probation");
    const statusIdx = (dims.statuses || []).indexOf("Active");
    // Same 3-type scope as getFilteredCoverageSummary() -- kept identical
    // on purpose so the modal's per-type rows sum back to the headline
    // card's merged number.
    const wantTypes = ["Contract", "Doctor", "Hospital"];
    const typeIdxByName = {};
    wantTypes.forEach(t => { const i = (dims.types || []).indexOf(t); if (i >= 0) typeIdxByName[t] = i; });

    if (titleIdx < 0 || expIdx < 0 || statusIdx < 0 || Object.keys(typeIdxByName).length === 0) {
      return { ok: false, status: "dimension_mismatch", asOfDate: latestPeriod, source: "coverage", bu: bu, types: [] };
    }

    const acc = {};
    wantTypes.forEach(t => { acc[t] = { coveredSum: 0, rightFreqSum: 0, rowCount: 0, repSet: new Set() }; });

    records.rows.forEach(row => {
      if (row[F.period] !== latestPeriodIdx) return;
      if (row[F.title] !== titleIdx) return;
      if (row[F.experience] !== expIdx) return;
      if (row[F.status] !== statusIdx) return;
      const typeName = wantTypes.find(t => typeIdxByName[t] === row[F.type]);
      if (!typeName) return;

      const teamName = (dims.teams || [])[row[F.team]];
      if (window.SEMANTIC.lineToBU(teamName) !== bu) return;

      if (row[F.isActive]) {
        const a = acc[typeName];
        a.coveredSum += row[F.coveredDoctor] || 0;
        a.rightFreqSum += row[F.rightFreq] || 0;
        a.rowCount += 1;
        a.repSet.add(row[F.employee]);
      }
    });

    const types = wantTypes.map(t => {
      const a = acc[t];
      return {
        name: t,
        coveragePct: a.rowCount > 0 ? (a.coveredSum / a.rowCount) * 100 : null,
        rightFreqPct: a.rowCount > 0 ? (a.rightFreqSum / a.rowCount) * 100 : null,
        repCount: a.repSet.size,
        customerRowCount: a.rowCount,
      };
    });

    return {
      ok: true,
      status: "ready",
      asOfDate: latestPeriod,
      source: "coverage",
      bu: bu,
      filterScope: { title: "Medical Representative", experience: "Non-Probation", status: "Active" },
      types: types,
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
  function getFilteredCoverageForLine(bu, line) {
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

    if (titleIdx < 0 || expIdx < 0 || statusIdx < 0 || standardTypeIdxSet.size === 0) {
      return { ok: false, status: "dimension_mismatch", asOfDate: latestPeriod, source: "coverage", bu: bu, line: line || null };
    }

    let coveredSum = 0, rightFreqSum = 0, rowCount = 0;
    const repSet = new Set();

    records.rows.forEach(row => {
      if (row[F.period] !== latestPeriodIdx) return;
      if (row[F.experience] !== expIdx) return;
      if (row[F.status] !== statusIdx) return;

      const teamName = (dims.teams || [])[row[F.team]];
      const rowBU = window.SEMANTIC.lineToBU(teamName);
      if (rowBU !== bu) return;
      const canonLine = window.SEMANTIC.normalizeLine(teamName);
      if (line && line !== "All" && canonLine !== line) return;

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
      status: "ready",
      asOfDate: latestPeriod,
      source: "coverage",
      bu: bu,
      line: line || "All",
      coveragePct: rowCount > 0 ? (coveredSum / rowCount) * 100 : null,
      rightFreqPct: rowCount > 0 ? (rightFreqSum / rowCount) * 100 : null,
      repCount: repSet.size,
      customerRowCount: rowCount,
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
      if (row[F.period] !== latestPeriodIdx) return;
      if (!row[F.isActive]) return; // same isActive scoping as every other Coverage KPI
      const teamName = (dims.teams || [])[row[F.team]];
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
          if (row[F.period] !== latestPeriodIdx) return;
          if (!row[F.isActive]) return;
          const teamName = (dims.teams || [])[row[F.team]];
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

  global.CoverageDashboard = global.CoverageDashboard || {};
  global.CoverageDashboard.getBusinessSummary = getBusinessSummary;
  global.CoverageDashboard.getFilteredCoverageSummary = getFilteredCoverageSummary;
  global.CoverageDashboard.getFilteredCoverageByType = getFilteredCoverageByType;
  global.CoverageDashboard.getFilteredCoverageForLine = getFilteredCoverageForLine;
  global.CoverageDashboard.getExecutionWorkloadSummary = getExecutionWorkloadSummary;
  global.CoverageDashboard.getLineAndTerritoryBreakdown = getLineAndTerritoryBreakdown;
})(window);
