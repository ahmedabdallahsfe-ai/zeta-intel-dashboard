/**
 * analytics.js
 * ============
 * The client-side Aggregation Engine. Mirrors refresh.py's aggregation
 * formulas exactly (see refresh.py's module docstring for the business
 * logic behind them) so that filtering never requires touching the
 * workbook or re-running refresh.bat -- every KPI/chart/table/ranking is
 * recomputed here, in the browser, from the dictionary-encoded row-level
 * cache in cache/records.json.
 *
 * Design: ONE single pass over the (up to 1,000,000+) row array per
 * filter change, accumulating into plain Maps keyed by dimension index.
 * No nested loops, no repeated filtering per chart/table -- every section
 * reads from the single AggregationResult this module produces.
 *
 * Field layout of a records row (must stay in sync with refresh.py's
 * RECORD_DIMENSION_FIELDS + the trailing numeric columns):
 *   0 periodIdx        6 employeeIdx        12 coveredDoctor
 *   1 teamIdx          7 specialtyIdx       13 rightFreq
 *   2 businessUnitIdx  8 classIdx           14 visits
 *   3 nsmIdx           9 statusIdx          15 isActive
 *   4 areaManagerIdx  10 experienceIdx      16 actualPlanCoverageX1000
 *   5 managerIdx      11 typeIdx            17 plansCount  18 titleIdx  19 profileIdx  20 customerNameIdx  21 frequency
 */

const Analytics = (() => {
  const F = {
    period: 0, team: 1, businessUnit: 2, nsm: 3, areaManager: 4, manager: 5,
    employee: 6, specialty: 7, klass: 8, status: 9, experience: 10,
    type: 11,
    coveredDoctor: 12, rightFreq: 13, visits: 14, isActive: 15, actualPlanX1000: 16,
    plansCount: 17, title: 18, customerName: 19, profile: 20, frequency: 21,
    lastVisitDate: 22, area: 23,
  };

  // Every dimension that participates in cross-filtering (cascading
  // dropdowns): picking a value in ANY of these narrows the AVAILABLE
  // options in every OTHER one, not just a fixed one-directional
  // "Business Unit determines everything else" relationship. Order here
  // doesn't matter functionally, just needs to match keys used in `want`.
  const CROSS_FILTER_DIMS = [
    "period", "team", "businessUnit", "nsm", "areaManager", "manager",
    "employee", "specialty", "klass", "status", "experience", "type", "title",
  ];

  const MIN_CUSTOMERS_FOR_LEADERBOARD = 20;
  const TOP_BOTTOM_N = 10;
  const TOP_N_SPECIALTY_CLASS = 15;
  const VACANT_PREFIX = "VACANT";

  let rows = null;          // records.rows (array of arrays)
  let dims = null;          // dashboard.dimensions
  let vacantManagerSet = null;
  let vacantAreaManagerSet = null;
  let vacantNsmSet = null;
  let resignedStatusIdx = -1;
  let latestPeriodIdx = -1;

  // mgrNameToEmpIdx: bridges name mismatches between dims.managers and
  // dims.employeeNames (source data inconsistency — same person can have
  // different spellings in the Manager vs Employee columns of the source file).
  // Built once at init; used by getKolCoverage self-match logic.
  let mgrNameToEmpIdx = null;

  /** Prepare lookups that never change between filter runs. */
  function init(records, dimensions) {
    rows = records.rows;
    dims = dimensions;

    vacantManagerSet = indicesStartingWith(dims.managers, VACANT_PREFIX);
    vacantAreaManagerSet = indicesStartingWith(dims.areaManagers, VACANT_PREFIX);
    vacantNsmSet = indicesStartingWith(dims.nsms, VACANT_PREFIX);
    resignedStatusIdx = dims.statuses.indexOf("Resigned");
    latestPeriodIdx = dims.periods.length - 1; // periods[] is chronologically sorted by refresh.py

    // Build manager-name → employee-idx cross-reference.
    // Step 1: exact match.
    // Step 2: normalised match (lowercase, ignore extra repeated tokens).
    //         Egyptian names repeat common words (Mohamed, Ahmed, Aly) so we
    //         compare the SORTED UNIQUE TOKEN SETS — if they're equal the
    //         names refer to the same person with a data-entry variation.
    const empNormMap = new Map(); // normKey → empIdx
    dims.employeeNames.forEach((n, i) => {
      empNormMap.set(_normName(n), i);
    });
    mgrNameToEmpIdx = new Map();
    dims.managers.forEach((mgrName) => {
      // skip VACANT slots
      if (String(mgrName).toUpperCase().startsWith(VACANT_PREFIX)) return;
      // Step 1: exact
      let ei = dims.employeeNames.indexOf(mgrName);
      // Step 2: normalised unique-token set
      if (ei < 0) ei = empNormMap.get(_normName(mgrName)) ?? -1;
      if (ei >= 0) mgrNameToEmpIdx.set(mgrName, ei);
    });
  }

  /** Normalise a name to a sorted unique-token key for fuzzy matching. */
  function _normName(name) {
    const tokens = [...new Set(name.toLowerCase().split(/\s+/).filter(Boolean))];
    tokens.sort();
    return tokens.join(' ');
  }

  function indicesStartingWith(list, prefix) {
    const set = new Set();
    list.forEach((v, i) => { if (String(v).toUpperCase().startsWith(prefix)) set.add(i); });
    return set;
  }

  /** Resolve period multi-select state ([] | ["Jun"] | ["Feb","Jun"]) to
   * null (no restriction = all periods in pass) or a Set<number> of
   * allowed period indices.
   *   [] (empty) → Set containing only the latest period index ("Latest" default)
   *   Specific values → Set of those period indices
   *   All periods selected → null (most efficient: no restriction needed)
   */
  function resolvePeriodSet(values) {
    if (!Array.isArray(values) || values.length === 0) {
      // Default: show only the latest period
      return new Set([latestPeriodIdx]);
    }
    const s = new Set();
    values.forEach((v) => {
      const idx = dims.periods.indexOf(v);
      if (idx !== -1) s.add(idx);
    });
    // If every known period is selected, treat as null (no restriction) --
    // this is both more efficient and semantically equivalent to "all".
    if (s.size >= dims.periods.length) return null;
    return s.size > 0 ? s : new Set([latestPeriodIdx]);
  }

  /** Resolve a multi-select filter value ([] = all, ["A","B"] = specific set)
   * to null (all rows pass) or a Set<number> of allowed dimension indices.
   * Used for every non-period filter. */
  function resolveIndexSet(dimName, values) {
    if (!Array.isArray(values) || values.length === 0) return null; // empty = all
    const list = dims[DIM_LIST_FOR[dimName]];
    const s = new Set();
    values.forEach((v) => {
      const idx = list.indexOf(v);
      if (idx !== -1) s.add(idx);
    });
    return s.size > 0 ? s : null;
  }

  const DIM_LIST_FOR = {
    period: "periods", team: "teams", businessUnit: "businessUnits", nsm: "nsms",
    areaManager: "areaManagers", manager: "managers", employee: "employeeNames",
    specialty: "specialties", klass: "classes", status: "statuses", experience: "experiences",
    type: "types", title: "titles",
  };

  function emptyGroup() {
    return {
      // coveredSum/rightFreqSum/rowCount are ACTIVE ROWS ONLY, mirroring
      // refresh.py's coverage_rollup() and build_kpis(), which both
      // scope to df[df.IsActive] before computing mean(Covered Doctors) /
      // mean(Right Freq). A resigned rep's stale rows must never dilute
      // a live coverage percentage.
      coveredSum: 0, rightFreqSum: 0, rowCount: 0, visitsSum: 0, plansSum: 0, freqSum: 0,
      onTargetCalls: 0, missedCalls: 0, wastedCalls: 0,
      activeEmployees: new Set(), resignedEmployees: new Set(),
    };
  }

  function accumulate(group, row) {
    if (row[F.isActive]) {
      group.coveredSum += row[F.coveredDoctor];
      group.rightFreqSum += row[F.rightFreq];
      group.rowCount += 1;
      group.visitsSum += row[F.visits];
      group.plansSum += row[F.plansCount];
      group.freqSum += row[F.frequency];
      
      const target = row[F.frequency] || 0;
      const visits = row[F.visits] || 0;
      group.onTargetCalls += Math.min(visits, target);
      group.missedCalls += Math.max(0, target - visits);
      group.wastedCalls += Math.max(0, visits - target);
      
      group.activeEmployees.add(row[F.employee]);
    } else if (row[F.status] === resignedStatusIdx) {
      group.resignedEmployees.add(row[F.employee]);
    }
  }

  function pct(sum, count) {
    return count > 0 ? sum / count : null;
  }

  /**
   * Run the full aggregation engine once for the given filter state.
   * filters: { period, team, businessUnit, nsm, areaManager, manager,
   *            employee, specialty, klass, status, experience } -- each
   *            "all"/"latest"/name.
   * Returns an object shaped exactly like cache/dashboard.json (plus an
   * `availableOptions` block -- see below) so every rendering module
   * (ui.js/charts.js/tables.js) can consume either the server-computed
   * default or this client-recomputed result identically.
   *
   * Cascading filter dropdowns: computed in the SAME single pass as
   * every other aggregation, not a second scan. For each row, count how
   * many of the currently-active filters (across ALL cross-filterable
   * dimensions, `want`) it fails to match:
   *   - 0 mismatches: the row is part of the current result set. Every
   *     dimension's value on this row is confirmed reachable, so it's
   *     added to every dimension's available-options set.
   *   - exactly 1 mismatch (on dimension X): relaxing/changing ONLY
   *     filter X to this row's value would make the row fully match
   *     every other active filter -- so this row's X-value is added to
   *     X's available-options set (it's a still-reachable alternative),
   *     but nothing else.
   *   - 2+ mismatches: this row can't become part of the result by
   *     changing any single filter, so it contributes nothing.
   * This is the same symmetric "faceted search" approach Power BI/Tableau
   * use: picking a value in ANY filter narrows every OTHER filter's
   * options, not just a fixed one-directional hierarchy.
   */
  function run(filters) {
    // Period is now multi-select: null (all) | Set<number> of period indices.
    // [] (empty) resolves to Set([latestPeriodIdx]) via resolvePeriodSet.
    // All other filters: null (all) | Set<number> via resolveIndexSet.
    const want = { period: resolvePeriodSet(filters.period) };
    CROSS_FILTER_DIMS.forEach((f) => {
      if (f !== "period") want[f] = resolveIndexSet(f, filters[f]);
    });

    // --- Performance note -----------------------------------------------
    // wantArr stores null (pass all) | Set<number> for every dimension.
    // Period's Set comes directly from resolvePeriodSet — no extra wrapping
    // needed since it already returns a Set (not a bare index).
    const numDims = CROSS_FILTER_DIMS.length;
    const wantArr = new Array(numDims);
    const fieldRowIdxArr = new Array(numDims);
    const dimMaxSizeArr = new Array(numDims);
    const availableSetsArr = new Array(numDims);
    let periodDimPos = -1;
    for (let d = 0; d < numDims; d++) {
      const f = CROSS_FILTER_DIMS[d];
      if (f === "period") {
        wantArr[d] = want.period; // null | Set<number> (already the right shape)
        periodDimPos = d;
      } else {
        wantArr[d] = want[f]; // null | Set<number>
      }
      fieldRowIdxArr[d] = F[f];
      dimMaxSizeArr[d] = dims[DIM_LIST_FOR[f]].length;
      availableSetsArr[d] = new Set();
    }

    const global = emptyGroup();
    const byPeriod = new Map();
    const byTeam = new Map();
    const byManager = new Map();
    const byAreaManager = new Map();
    const bySpecialty = new Map();
    const byClass = new Map();
    const byType = new Map(); // typeIdx -> { rowCount } (all active rows, not just matching employee)
    const byEmployeePeriod = new Map(); // key: `${employeeIdx}|${periodIdx}` -> {..., customerCount, actualPlanSum, actualPlanCount}
    const vacantSeenByPeriod = new Map(); // periodIdx -> { managers:Set, areaManagers:Set, nsms:Set }
    const empProfileMap = new Map(); // employeeIdx → profileIdx (the employee's own territory profile)
    const byExperience     = new Map(); // experienceIdx → emptyGroup() — for RF Probation vs Non-Probation split
    const custRfTracker    = new Map(); // customerNameIdx → { total, rf } — for at-risk (zero RF) customer count
    const custUniqByPeriod = new Map(); // periodIdx → Set<custIdx> — unique customers per period (deduplicates multi-rep visits)
    const atRiskTiers = {
      tier1: { count: 0, list: [] },
      tier2: { count: 0, list: [] },
      tier3: { count: 0, list: [] },
    };

    const n = rows.length;
    for (let i = 0; i < n; i++) {
      const row = rows[i];

      // --- Cascading-filter bookkeeping: figure out how many active
      // filters this row fails, and which single one (if exactly one). ---
      let mismatchCount = 0;
      let mismatchPos = -1;
      for (let d = 0; d < numDims; d++) {
        const ws = wantArr[d]; // null | Set<number>
        if (ws === null || ws.has(row[fieldRowIdxArr[d]])) continue;
        mismatchCount++;
        if (mismatchCount === 1) { mismatchPos = d; } else { break; } // 2+ mismatches: no further use, stop counting
      }

      if (mismatchCount === 0) {
        for (let d = 0; d < numDims; d++) {
          const set = availableSetsArr[d];
          if (set.size < dimMaxSizeArr[d]) set.add(row[fieldRowIdxArr[d]]); // already-saturated sets skip the add() cost
        }
      } else if (mismatchCount === 1) {
        const set = availableSetsArr[mismatchPos];
        if (set.size < dimMaxSizeArr[mismatchPos]) set.add(row[fieldRowIdxArr[mismatchPos]]);
      }

      // A row qualifies for the period-spanning grains (trend chart,
      // employee-period roster) when it matches every active filter
      // EXCEPT possibly period itself -- those grains must span every
      // period regardless of the period filter. Point-in-time grains
      // (KPIs, team/manager/specialty rollups) require a full match,
      // enforced further below via the explicit period check.
      const matchesExcludingPeriod = mismatchCount === 0 || (mismatchCount === 1 && mismatchPos === periodDimPos);
      if (!matchesExcludingPeriod) continue;

      const periodIdx = row[F.period];
      const managerIdx = row[F.manager];
      const areaManagerIdx = row[F.areaManager];

      // --- period-spanning grains (trend, roster, vacancy history) ---
      if (!byPeriod.has(periodIdx)) byPeriod.set(periodIdx, emptyGroup());
      accumulate(byPeriod.get(periodIdx), row);

      const empKey = row[F.employee] + "|" + periodIdx;
      let empGroup = byEmployeePeriod.get(empKey);
      if (!empGroup) {
        empGroup = {
          employeeIdx: row[F.employee], periodIdx, teamIdx: row[F.team], managerIdx: row[F.manager],
          profileIdx: row[F.profile],
          coveredSum: 0, rightFreqSum: 0, customerCount: 0, visitsSum: 0,
          actualPlanSum: 0, isActive: !!row[F.isActive],
        };
        byEmployeePeriod.set(empKey, empGroup);
      }
      if (row[F.isActive]) {
        empGroup.coveredSum += row[F.coveredDoctor];
        empGroup.rightFreqSum += row[F.rightFreq];
        empGroup.customerCount += 1;
        empGroup.visitsSum += row[F.visits];
        empGroup.actualPlanSum += row[F.actualPlanX1000] / 1000;

        if (vacantManagerSet.has(managerIdx) || vacantAreaManagerSet.has(areaManagerIdx) || vacantNsmSet.has(row[F.nsm])) {
          if (!vacantSeenByPeriod.has(periodIdx)) {
            vacantSeenByPeriod.set(periodIdx, { managers: new Set(), areaManagers: new Set(), nsms: new Set() });
          }
          const v = vacantSeenByPeriod.get(periodIdx);
          if (vacantManagerSet.has(managerIdx)) v.managers.add(managerIdx);
          if (vacantAreaManagerSet.has(areaManagerIdx)) v.areaManagers.add(areaManagerIdx);
          if (vacantNsmSet.has(row[F.nsm])) v.nsms.add(row[F.nsm]);
        }
      }

      // --- point-in-time grains: further restricted to selected period(s) ---
      if (want.period !== null && !want.period.has(periodIdx)) continue;

      accumulate(global, row);

      const teamIdx = row[F.team];
      if (!byTeam.has(teamIdx)) byTeam.set(teamIdx, emptyGroup());
      accumulate(byTeam.get(teamIdx), row);

      if (!byManager.has(managerIdx)) { const g = emptyGroup(); g.teamIdx = teamIdx; byManager.set(managerIdx, g); }
      accumulate(byManager.get(managerIdx), row);

      if (!byAreaManager.has(areaManagerIdx)) { const g = emptyGroup(); g.teamIdx = teamIdx; byAreaManager.set(areaManagerIdx, g); }
      accumulate(byAreaManager.get(areaManagerIdx), row);

      const specialtyIdx = row[F.specialty];
      if (!bySpecialty.has(specialtyIdx)) bySpecialty.set(specialtyIdx, emptyGroup());
      accumulate(bySpecialty.get(specialtyIdx), row);

      const classIdx = row[F.klass];
      if (!byClass.has(classIdx)) byClass.set(classIdx, emptyGroup());
      accumulate(byClass.get(classIdx), row);

      // RF by experience (Probation vs Non-Probation)
      const experienceIdx = row[F.experience];
      if (!byExperience.has(experienceIdx)) byExperience.set(experienceIdx, emptyGroup());
      accumulate(byExperience.get(experienceIdx), row);

      // Type distribution + at-risk customer tracker (active rows only)
      if (row[F.isActive]) {
        const typeIdx = row[F.type];
        const tg = byType.get(typeIdx);
        if (tg) { tg.rowCount++; } else { byType.set(typeIdx, { rowCount: 1 }); }

        // At-risk: customers who never receive a right-frequency visit in the
        // selected filter window.  custIdx = customerNameIdx (unique per doctor).
        const custIdx = row[F.customerName];
        if (!custRfTracker.has(custIdx)) custRfTracker.set(custIdx, { total: 0, rf: 0 });
        const ct = custRfTracker.get(custIdx);
        ct.total++;
        ct.rf += row[F.rightFreq];

        // Unique customer count per period — one Set<custIdx> per periodIdx.
        // A customer appearing across multiple rep rows in the same period is
        // counted once.  Used for the "Total Customers" KPI card.
        if (!custUniqByPeriod.has(periodIdx)) custUniqByPeriod.set(periodIdx, new Set());
        custUniqByPeriod.get(periodIdx).add(custIdx);

        // Calculate At-Risk Tiers (rows where Right Freq is 0)
        if (row[F.rightFreq] === 0) {
          const missedCalls = row[F.frequency] - row[F.visits];
          const docInfo = {
            customerName: dims.customerNames ? (dims.customerNames[custIdx] || "") : "",
            specialty: dims.specialties[row[F.specialty]] || "",
            klass: dims.classes[row[F.klass]] || "",
            type: dims.types[row[F.type]] || "",
            employee: dims.employeeNames[row[F.employee]] || "",
            team: dims.teams[row[F.team]] || "",
            manager: dims.managers[row[F.manager]] || "",
            frequency: row[F.frequency],
            visits: row[F.visits],
            missedCalls: missedCalls,
            lastVisitDate: dims.lastVisitDates ? (dims.lastVisitDates[row[F.lastVisitDate]] || "Never") : "Never",
            area: dims.areas ? (dims.areas[row[F.area]] || "") : "",
          };
          if (missedCalls === 1) {
            atRiskTiers.tier1.count++;
            atRiskTiers.tier1.list.push(docInfo);
          } else if (missedCalls === 2) {
            atRiskTiers.tier2.count++;
            atRiskTiers.tier2.list.push(docInfo);
          } else if (missedCalls >= 3) {
            atRiskTiers.tier3.count++;
            atRiskTiers.tier3.list.push(docInfo);
          }
        }
      }
      // Capture each employee's own profile (territory) — used to show a
      // manager's profile subtitle by cross-referencing their employee entry.
      if (!empProfileMap.has(row[F.employee])) empProfileMap.set(row[F.employee], row[F.profile]);
    }

    return buildResult({
      global, byPeriod, byTeam, byManager, byAreaManager, bySpecialty, byClass,
      byType, byEmployeePeriod, vacantSeenByPeriod, empProfileMap, want, availableSetsArr,
      byExperience, custRfTracker, custUniqByPeriod, atRiskTiers,
    });
  }

  /** Convert the per-dimension Sets of row indices collected during the
   * pass above into arrays of actual display values (in the same order
   * as dims.X), one per cross-filterable field. `filters.js` uses this
   * to disable <option>s that can't produce any rows given every OTHER
   * currently-active filter -- "all"/"latest" meta-options are always
   * left enabled since they don't correspond to a real dimension value. */
  function buildAvailableOptions(availableSetsArr) {
    const out = {};
    CROSS_FILTER_DIMS.forEach((f, d) => {
      const list = dims[DIM_LIST_FOR[f]];
      out[f] = Array.from(availableSetsArr[d]).filter((idx) => idx >= 0 && idx < list.length).map((idx) => list[idx]);
    });
    return out;
  }

  function vacancyCountForPeriod(vacantSeenByPeriod, periodIdx) {
    const v = vacantSeenByPeriod.get(periodIdx);
    if (!v) return 0;
    return v.managers.size + v.areaManagers.size + v.nsms.size;
  }

  /** `wantPeriodSet`: null (all periods) | Set<number> of selected period indices. */
  function totalVacancyCount(vacantSeenByPeriod, wantPeriodSet) {
    if (wantPeriodSet !== null) {
      // Use the latest selected period for the vacancy snapshot
      const latestSel = Math.max(...Array.from(wantPeriodSet));
      return vacancyCountForPeriod(vacantSeenByPeriod, latestSel);
    }
    // No period restriction: union across all periods
    const managers = new Set(), areaManagers = new Set(), nsms = new Set();
    vacantSeenByPeriod.forEach((v) => {
      v.managers.forEach((x) => managers.add(x));
      v.areaManagers.forEach((x) => areaManagers.add(x));
      v.nsms.forEach((x) => nsms.add(x));
    });
    return managers.size + areaManagers.size + nsms.size;
  }

  function buildResult(ctx) {
    const { global, byPeriod, byTeam, byManager, byAreaManager, bySpecialty, byClass, byType, byEmployeePeriod, vacantSeenByPeriod, empProfileMap, want, availableSetsArr, byExperience, custRfTracker, custUniqByPeriod } = ctx;

    // Build manager/areaManager name → profileIdx lookup by cross-referencing
    // dims.managers (manager names) with dims.employeeNames (employee names).
    // Managers who also appear as employees have their own territory profile.
    const empNameToIdx = new Map(dims.employeeNames.map((n, i) => [n, i]));
    const mgrProfileIdx = new Map(); // managerListIdx → profileIdx
    dims.managers.forEach((mgrName, i) => {
      const empIdx = empNameToIdx.get(mgrName);
      if (empIdx !== undefined && empProfileMap.has(empIdx)) {
        mgrProfileIdx.set(i, empProfileMap.get(empIdx));
      }
    });
    const areaMgrProfileIdx = new Map();
    dims.areaManagers.forEach((mgrName, i) => {
      const empIdx = empNameToIdx.get(mgrName);
      if (empIdx !== undefined && empProfileMap.has(empIdx)) {
        areaMgrProfileIdx.set(i, empProfileMap.get(empIdx));
      }
    });

    // Which period represents "the KPI period" for headline cards.
    // want.period is now a Set<number> or null:
    //   null = all periods → use latest
    //   Set with one entry → that entry
    //   Set with multiple → use the latest (max index) among selected
    const kpiPeriodIdx = want.period !== null
      ? Math.max(...Array.from(want.period))
      : latestPeriodIdx;

    const headcount = global.activeEmployees.size;
    const resigned = global.resignedEmployees.size;
    const vacancy = totalVacancyCount(vacantSeenByPeriod, want.period); // want.period is Set|null
    const spanValues = Array.from(byManager.values()).map((g) => g.activeEmployees.size).filter((v) => v > 0);
    const spanOfControl = spanValues.length ? average(spanValues) : 0;

    // Average Frequency Achievement: mean of each active employee's own
    // mean(Actual Plan Coverage) -- matches refresh.py's
    // roster["AvgFrequencyAchievement"].mean() (mean-of-means, unweighted
    // by customer count), NOT the row-weighted approach used for
    // Coverage%/Right Freq% above.
    const employeeFreqMeans = [];
    let totalVisitsForAvg = 0;
    byEmployeePeriod.forEach((g) => {
      if (g.isActive && g.periodIdx === kpiPeriodIdx) {
        employeeFreqMeans.push(g.actualPlanSum / g.customerCount);
        totalVisitsForAvg += g.visitsSum;
      }
    });
    const avgFrequencyAchievement = employeeFreqMeans.length ? average(employeeFreqMeans) : 0;
    const kpiHeadcount = employeeFreqMeans.length; // active employees within kpiPeriodIdx specifically
    const avgVisits = kpiHeadcount ? totalVisitsForAvg / kpiHeadcount : 0;
    const kpiPeriodGroup = byPeriod.get(kpiPeriodIdx) || emptyGroup();
    const customersPerRep = kpiHeadcount ? kpiPeriodGroup.rowCount / kpiHeadcount : 0;
    const kpiResigned = Array.from(byEmployeePeriod.values())
      .filter((g) => !g.isActive && g.periodIdx === kpiPeriodIdx).length;
    const kpiVacancy = vacancyCountForPeriod(vacantSeenByPeriod, kpiPeriodIdx);
    const attritionRate = (kpiHeadcount + kpiResigned) ? kpiResigned / (kpiHeadcount + kpiResigned) : 0;

    const kpis = {
      activeReps: kpiHeadcount,
      resignedReps: kpiResigned,
      headcount: kpiHeadcount,
      vacancyCount: kpiVacancy,
      coveragePct: round4(pct(kpiPeriodGroup.coveredSum, kpiPeriodGroup.rowCount)),
      rightFreqPct: round4(pct(kpiPeriodGroup.rightFreqSum, kpiPeriodGroup.rowCount)),
      customersPerRep: round2(customersPerRep),
      spanOfControl: round2(spanOfControl),
      attritionRate: round4(attritionRate),
      avgVisits: round2(avgVisits),
      avgFrequencyAchievement: round4(avgFrequencyAchievement),
      latestMonth: dims.periods[kpiPeriodIdx],
      // Visit productivity KPIs
      totalTargetVisits: kpiPeriodGroup.freqSum,
      totalActualVisits: kpiPeriodGroup.visitsSum,
      visitAchievementPct: round4(kpiPeriodGroup.freqSum > 0 ? kpiPeriodGroup.visitsSum / kpiPeriodGroup.freqSum : null),
      // Coverage gap KPIs
      notSeenCount: kpiPeriodGroup.rowCount - kpiPeriodGroup.coveredSum,
      notSeenPct: round4(kpiPeriodGroup.rowCount > 0 ? (kpiPeriodGroup.rowCount - kpiPeriodGroup.coveredSum) / kpiPeriodGroup.rowCount : null),
      // Unique customer count for KPI period — each doctor counted once
      // regardless of how many reps target them (no duplication across reps).
      totalUniqueCustomers: (custUniqByPeriod.get(kpiPeriodIdx) || new Set()).size,
      totalSharedCustomers: kpiPeriodGroup.rowCount,
      onTargetCalls: kpiPeriodGroup.onTargetCalls,
      missedCalls: kpiPeriodGroup.missedCalls,
      wastedCalls: kpiPeriodGroup.wastedCalls,
    };

    const trend = {
      periods: dims.periods,
      series: dims.periods.map((periodName, idx) => {
        const g = byPeriod.get(idx);
        if (!g) return { period: periodName, coveragePct: null, rightFreqPct: null, headcount: 0, activeReps: 0, resignedReps: 0, vacancyCount: 0, customersPerRep: null, totalTargetVisits: 0, totalActualVisits: 0, visitAchievementPct: null, notSeenCount: 0, notSeenPct: null, totalUniqueCustomers: 0, totalSharedCustomers: 0 };
        const activeCount = g.activeEmployees.size;
        return {
          period: periodName,
          coveragePct: round4(pct(g.coveredSum, g.rowCount)),
          rightFreqPct: round4(pct(g.rightFreqSum, g.rowCount)),
          headcount: activeCount,
          activeReps: activeCount,
          resignedReps: g.resignedEmployees.size,
          vacancyCount: vacancyCountForPeriod(vacantSeenByPeriod, idx),
          customersPerRep: activeCount ? round2(g.rowCount / activeCount) : null,
          totalTargetVisits: g.freqSum,
          totalActualVisits: g.visitsSum,
          visitAchievementPct: round4(g.freqSum > 0 ? g.visitsSum / g.freqSum : null),
          notSeenCount: g.rowCount - g.coveredSum,
          notSeenPct: round4(g.rowCount > 0 ? (g.rowCount - g.coveredSum) / g.rowCount : null),
          totalUniqueCustomers: (custUniqByPeriod.get(idx) || new Set()).size,
          totalSharedCustomers: g.rowCount,
        };
      }),
    };

    // Period-over-period deltas for the 6 KPI cards: a bare number has
    // no context, so every card compares against the immediately prior
    // period ON RECORD *within whatever other filters are active* (trend
    // series already respects the current Team/Manager/etc. filters --
    // this isn't a separate query). null when there's no earlier period
    // to compare against (e.g. Period=February selected explicitly).
    const kpiDeltas = buildKpiDeltas(trend.series, kpiPeriodIdx, kpis);

    const teamComparison = mapGroupsToRows(byTeam, dims.teams, (name, g) => ({
      team: name,
      headcount: g.activeEmployees.size,
      resignedCount: g.resignedEmployees.size,
      attritionRate: round4(pct(g.resignedEmployees.size, g.activeEmployees.size + g.resignedEmployees.size)),
      coveragePct: round4(pct(g.coveredSum, g.rowCount)),
      rightFreqPct: round4(pct(g.rightFreqSum, g.rowCount)),
      customersPerRep: g.activeEmployees.size ? round2(g.rowCount / g.activeEmployees.size) : null,
    })).sort(byCoverageDesc);

    const managerRanking = mapGroupsToRows(byManager, dims.managers, (name, g, idx) => ({
      name,
      profile: dims.profiles ? (dims.profiles[mgrProfileIdx.get(idx)] || "") : "",
      status: name.toUpperCase().startsWith(VACANT_PREFIX) ? "Vacant" : "Filled",
      span: g.activeEmployees.size,
      coveragePct: round4(pct(g.coveredSum, g.rowCount)),
      rightFreqPct: round4(pct(g.rightFreqSum, g.rowCount)),
    })).sort(byCoverageDesc);

    const areaManagerRanking = mapGroupsToRows(byAreaManager, dims.areaManagers, (name, g, idx) => ({
      name,
      profile: dims.profiles ? (dims.profiles[areaMgrProfileIdx.get(idx)] || "") : "",
      status: name.toUpperCase().startsWith(VACANT_PREFIX) ? "Vacant" : "Filled",
      span: g.activeEmployees.size,
      coveragePct: round4(pct(g.coveredSum, g.rowCount)),
      rightFreqPct: round4(pct(g.rightFreqSum, g.rowCount)),
    })).sort(byCoverageDesc);

    const specialtyCoverage = mapGroupsToRows(bySpecialty, dims.specialties, (name, g) => ({
      name, customerCount: g.rowCount,
      coveragePct: round4(pct(g.coveredSum, g.rowCount)),
      rightFreqPct: round4(pct(g.rightFreqSum, g.rowCount)),
    })).sort((a, b) => b.customerCount - a.customerCount).slice(0, TOP_N_SPECIALTY_CLASS);

    const classCoverage = mapGroupsToRows(byClass, dims.classes, (name, g) => ({
      name, customerCount: g.rowCount,
      coveragePct: round4(pct(g.coveredSum, g.rowCount)),
      rightFreqPct: round4(pct(g.rightFreqSum, g.rowCount)),
    })).sort((a, b) => b.customerCount - a.customerCount).slice(0, TOP_N_SPECIALTY_CLASS);

    // Type distribution: customer row count per Type, sorted by count desc,
    // used by the Type Distribution pie chart. Only includes types that
    // actually have rows under the current filter combination.
    const typeDistribution = [];
    byType.forEach((g, typeIdx) => {
      const name = dims.types[typeIdx];
      if (name !== undefined && g.rowCount > 0) typeDistribution.push({ name, count: g.rowCount });
    });
    typeDistribution.sort((a, b) => b.count - a.count);

    const classDistribution = [];
    const classVisitsDistribution = [];
    byClass.forEach((g, classIdx) => {
      const name = dims.classes[classIdx];
      if (name !== undefined && g.rowCount > 0) {
        classDistribution.push({ name, count: g.rowCount });
        classVisitsDistribution.push({ name, count: g.visitsSum });
      }
    });
    classDistribution.sort((a, b) => b.count - a.count);
    classVisitsDistribution.sort((a, b) => b.count - a.count);

    const specialtyDistribution = [];
    const specialtyVisitsDistribution = [];
    bySpecialty.forEach((g, specIdx) => {
      const name = dims.specialties[specIdx];
      if (name !== undefined && g.rowCount > 0) {
        specialtyDistribution.push({ name, count: g.rowCount });
        specialtyVisitsDistribution.push({ name, count: g.visitsSum });
      }
    });
    specialtyDistribution.sort((a, b) => b.count - a.count);
    specialtyVisitsDistribution.sort((a, b) => b.count - a.count);

    const qualified = Array.from(byEmployeePeriod.values()).filter(
      (g) => g.isActive && g.periodIdx === kpiPeriodIdx && g.customerCount >= MIN_CUSTOMERS_FOR_LEADERBOARD
    );
    const toLeaderboardRow = (g) => ({
      employee: dims.employeeNames[g.employeeIdx],
      profile: dims.profiles ? (dims.profiles[g.profileIdx] || "") : "",
      team: dims.teams[g.teamIdx],
      manager: dims.managers[g.managerIdx],
      customerCount: g.customerCount,
      coveragePct: round4(pct(g.coveredSum, g.customerCount)),
      rightFreqPct: round4(pct(g.rightFreqSum, g.customerCount)),
    });
    const byEmpName = (g) => dims.employeeNames[g.employeeIdx];
    const top = [...qualified].sort((a, b) => {
      const diff = (b.coveredSum / b.customerCount) - (a.coveredSum / a.customerCount);
      return diff !== 0 ? diff : byEmpName(a).localeCompare(byEmpName(b));
    }).map(toLeaderboardRow);
    const bottom = [...qualified].sort((a, b) => {
      const diff = (a.coveredSum / a.customerCount) - (b.coveredSum / b.customerCount);
      return diff !== 0 ? diff : byEmpName(a).localeCompare(byEmpName(b));
    }).map(toLeaderboardRow);

    const byPeriodAttrition = dims.periods.map((periodName, idx) => {
      const activeCount = Array.from(byEmployeePeriod.values()).filter((g) => g.isActive && g.periodIdx === idx).length;
      const resignedCount = Array.from(byEmployeePeriod.values()).filter((g) => !g.isActive && g.periodIdx === idx).length;
      return {
        period: periodName, activeReps: activeCount, resignedReps: resignedCount,
        attritionRate: round4(pct(resignedCount, activeCount + resignedCount)),
      };
    });
    const attritionByTeam = mapGroupsToRows(byTeam, dims.teams, (name, g) => ({
      team: name, activeReps: g.activeEmployees.size, resignedReps: g.resignedEmployees.size,
      attritionRate: round4(pct(g.resignedEmployees.size, g.activeEmployees.size + g.resignedEmployees.size)),
    })).sort((a, b) => {
      const diff = (b.attritionRate || 0) - (a.attritionRate || 0);
      return diff !== 0 ? diff : a.team.localeCompare(b.team);
    });

    const vacantAtKpiPeriod = vacantSeenByPeriod.get(kpiPeriodIdx) || { managers: new Set(), areaManagers: new Set(), nsms: new Set() };
    const vacancyByTeamMap = new Map();
    const vacancyDetails = [];
    vacantAtKpiPeriod.managers.forEach((idx) => vacancyDetails.push({ level: "Manager", slot: dims.managers[idx] }));
    vacantAtKpiPeriod.areaManagers.forEach((idx) => vacancyDetails.push({ level: "Area Manager", slot: dims.areaManagers[idx] }));
    vacantAtKpiPeriod.nsms.forEach((idx) => vacancyDetails.push({ level: "NSM", slot: dims.nsms[idx] }));

    // ── RF Narrative Insights ──────────────────────────────────────────────
    // Reuse the already-computed classCoverage / specialtyCoverage arrays,
    // re-sorted by rightFreqPct for the narrative.  Minimum 10 rows to
    // avoid single-doctor noise distorting the RF percentages.
    const rfByClass = [...classCoverage]
      .filter(c => c.customerCount >= 10 && c.rightFreqPct !== null)
      .sort((a, b) => (b.rightFreqPct || 0) - (a.rightFreqPct || 0));

    const rfBySpecialty = [...specialtyCoverage]
      .filter(s => s.customerCount >= 10 && s.rightFreqPct !== null)
      .sort((a, b) => (b.rightFreqPct || 0) - (a.rightFreqPct || 0));

    // RF by experience (Probation vs Non-Probation)
    const rfByExperience = [];
    byExperience.forEach((g, expIdx) => {
      if (expIdx >= 0 && expIdx < dims.experiences.length) {
        rfByExperience.push({
          experience: dims.experiences[expIdx],
          rfPct:      round4(pct(g.rightFreqSum, g.rowCount)),
          empCount:   g.activeEmployees.size,
          rowCount:   g.rowCount,
        });
      }
    });

    // RF top-5 / bottom-5 employees by RF% (latest KPI period, ≥5 customers)
    const rfEmpRows = [...byEmployeePeriod.values()]
      .filter(g => g.isActive && g.periodIdx === kpiPeriodIdx && g.customerCount >= MIN_CUSTOMERS_FOR_LEADERBOARD)
      .map(g => ({
        name:          dims.employeeNames[g.employeeIdx] || "",
        team:          dims.teams[g.teamIdx] || "",
        rfPct:         round4(pct(g.rightFreqSum, g.customerCount)),
        customerCount: g.customerCount,
      }))
      .filter(e => e.rfPct !== null)
      .sort((a, b) => b.rfPct - a.rfPct);
    const rfTop10    = rfEmpRows.slice(0, 10);
    const rfBottom10 = [...rfEmpRows].reverse().slice(0, 10);

    // At-risk customers: unique doctors who received ZERO right-frequency
    // visits in every selected period row (within current filter scope).
    let atRiskCount = ctx.atRiskTiers.tier1.count + ctx.atRiskTiers.tier2.count + ctx.atRiskTiers.tier3.count;

    const rfInsights = {
      overallRfPct: kpis.rightFreqPct,    // already computed, re-use
      rfByClass,
      rfBySpecialty,
      rfByExperience,
      rfTop10,
      rfBottom10,
      atRiskCount,
      totalCustomers: kpiPeriodGroup.rowCount,  // shared active customers in scope
      atRiskTiers: ctx.atRiskTiers,
    };
    // ──────────────────────────────────────────────────────────────────────

    return {
      kpis, trend, teamComparison, managerRanking, areaManagerRanking,
      specialtyCoverage, classCoverage, typeDistribution, classDistribution, specialtyDistribution,
      classVisitsDistribution, specialtyVisitsDistribution,
      leaderboards: { top, bottom },
      attrition: { byPeriod: byPeriodAttrition, byTeam: attritionByTeam },
      vacancies: { total: kpiVacancy, byTeam: vacancyByTeamMap, details: vacancyDetails },
      latestPeriod: dims.periods[latestPeriodIdx],
      kpiPeriod: dims.periods[kpiPeriodIdx],
      availableOptions: buildAvailableOptions(availableSetsArr),
      kpiDeltas,
      rfInsights,
    };
  }

  /** One entry per KPI card: { previous, delta } vs the prior period in
   * `trendSeries`, or null if there's no earlier period to compare
   * against. `delta` is a signed raw difference (not yet formatted --
   * ui.js/utils.js decide "+2.3pts" vs "+14" display per the card's
   * format type). */
  function buildKpiDeltas(trendSeries, kpiPeriodIdx, currentKpis) {
    const prevIdx = kpiPeriodIdx - 1;
    const prev = prevIdx >= 0 ? trendSeries[prevIdx] : null;
    if (!prev) return null;

    const diff = (curr, prevVal, rounder) => {
      if (curr === null || curr === undefined || prevVal === null || prevVal === undefined) return null;
      return rounder(curr - prevVal);
    };

    return {
      previousPeriod: prev.period,
      activeReps: { previous: prev.activeReps, delta: diff(currentKpis.activeReps, prev.activeReps, (v) => v) },
      resignedReps: { previous: prev.resignedReps, delta: diff(currentKpis.resignedReps, prev.resignedReps, (v) => v) },
      coveragePct: { previous: prev.coveragePct, delta: diff(currentKpis.coveragePct, prev.coveragePct, round4) },
      rightFreqPct: { previous: prev.rightFreqPct, delta: diff(currentKpis.rightFreqPct, prev.rightFreqPct, round4) },
      customersPerRep: { previous: prev.customersPerRep, delta: diff(currentKpis.customersPerRep, prev.customersPerRep, round2) },
      vacancyCount: { previous: prev.vacancyCount, delta: diff(currentKpis.vacancyCount, prev.vacancyCount, (v) => v) },
      totalTargetVisits: { previous: prev.totalTargetVisits, delta: diff(currentKpis.totalTargetVisits, prev.totalTargetVisits, (v) => v) },
      totalActualVisits: { previous: prev.totalActualVisits, delta: diff(currentKpis.totalActualVisits, prev.totalActualVisits, (v) => v) },
      visitAchievementPct: { previous: prev.visitAchievementPct, delta: diff(currentKpis.visitAchievementPct, prev.visitAchievementPct, round4) },
      notSeenCount: { previous: prev.notSeenCount, delta: diff(currentKpis.notSeenCount, prev.notSeenCount, (v) => v) },
      notSeenPct: { previous: prev.notSeenPct, delta: diff(currentKpis.notSeenPct, prev.notSeenPct, round4) },
      totalUniqueCustomers: { previous: prev.totalUniqueCustomers, delta: diff(currentKpis.totalUniqueCustomers, prev.totalUniqueCustomers, (v) => v) },
      totalSharedCustomers: { previous: prev.totalSharedCustomers, delta: diff(currentKpis.totalSharedCustomers, prev.totalSharedCustomers, (v) => v) },
    };
  }

  function mapGroupsToRows(map, dimList, toRow) {
    const out = [];
    map.forEach((g, idx) => {
      if (idx < 0 || idx >= dimList.length) return;
      out.push(toRow(dimList[idx], g, idx));
    });
    return out;
  }

  /** Sorts by coveragePct descending; ties break alphabetically by
   * name/team so ordering is deterministic and matches refresh.py's
   * server-computed sort exactly (both use the same secondary key). */
  function byCoverageDesc(a, b) {
    if (a.coveragePct === null) return 1;
    if (b.coveragePct === null) return -1;
    if (b.coveragePct !== a.coveragePct) return b.coveragePct - a.coveragePct;
    const aKey = a.team || a.name || "";
    const bKey = b.team || b.name || "";
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  }

  function average(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  function round4(v) { return v === null || v === undefined ? null : Math.round(v * 10000) / 10000; }
  function round2(v) { return v === null || v === undefined ? null : Math.round(v * 100) / 100; }

  /**
   * Best-practice safety check: recompute the DEFAULT view (no filters,
   * latest period) and compare it against the server-computed
   * cache/dashboard.json KPIs. If the two implementations have drifted
   * (a bug in either refresh.py or here), this catches it immediately
   * instead of silently shipping wrong numbers.
   */
  function selfCheck(serverKpis) {
    const recomputed = run(defaultFilters()).kpis;
    const mismatches = [];
    const tolerance = 0.002;
    Object.keys(serverKpis).forEach((key) => {
      const serverVal = serverKpis[key];
      const clientVal = recomputed[key];
      if (typeof serverVal === "number" && typeof clientVal === "number") {
        if (Math.abs(serverVal - clientVal) > tolerance) {
          mismatches.push({ key, server: serverVal, client: clientVal });
        }
      } else if (serverVal !== clientVal) {
        mismatches.push({ key, server: serverVal, client: clientVal });
      }
    });
    if (mismatches.length) {
      console.warn("[Analytics.selfCheck] Client/server KPI mismatch:", mismatches);
    }
    return { ok: mismatches.length === 0, mismatches };
  }

  function defaultFilters() {
    const f = {};
    // DIM_LIST_FOR includes "title" — generates f.title = [] automatically
    Object.keys(DIM_LIST_FOR).forEach((k) => {
      f[k] = []; // v3: period [] = latest, others [] = all
    });
    return f;
  }

  /**
   * Lazy drill-down scan for the "Not Seen Customers" modal.
   * Applies the same filter logic as run() but collects individual
   * not-seen rep-customer rows instead of aggregating them.
   * Called once when the modal opens; results are not cached here
   * (the caller may cache them per filter state if desired).
   *
   * Returns an array of plain objects:
   *   { customerName, specialty, class, type, employee, team, manager, frequency }
   * sorted by employee name then customer name.
   */
  function getNotSeenCustomers(filters) {
    if (!rows || !dims) return [];
    const latestPeriodIdx = dims.periods.length - 1;

    // Resolve period set (same logic as run())
    const periodVals = filters.period || [];
    let wantPeriod;
    if (periodVals.length === 0) {
      wantPeriod = new Set([latestPeriodIdx]);
    } else {
      wantPeriod = new Set(periodVals.map((v) => dims.periods.indexOf(v)).filter((i) => i >= 0));
    }

    // Build wantSets for all other dims (same as run())
    const dimKeys = ["team","businessUnit","nsm","areaManager","manager","employee","specialty","klass","status","experience","type","title"];
    const dimFields  = [F.team, F.businessUnit, F.nsm, F.areaManager, F.manager, F.employee, F.specialty, F.klass, F.status, F.experience, F.type, F.title];
    const dimLists   = ["teams","businessUnits","nsms","areaManagers","managers","employeeNames","specialties","classes","statuses","experiences","types","titles"];
    const wantSets = dimKeys.map((k, i) => {
      const vals = (k === "klass" ? filters.class : filters[k]) || [];
      if (vals.length === 0) return null;
      const s = new Set();
      vals.forEach((v) => { const idx = dims[dimLists[i]].indexOf(v); if (idx >= 0) s.add(idx); });
      return s;
    });

    const result = [];
    const n = rows.length;
    for (let i = 0; i < n; i++) {
      const row = rows[i];
      // Period filter
      if (!wantPeriod.has(row[F.period])) continue;
      // Active rep only
      if (!row[F.isActive]) continue;
      // Not seen = coveredDoctor is 0
      if (row[F.coveredDoctor] !== 0) continue;
      // Dimension filters
      let skip = false;
      for (let d = 0; d < dimFields.length; d++) {
        if (wantSets[d] && !wantSets[d].has(row[dimFields[d]])) { skip = true; break; }
      }
      if (skip) continue;

      result.push({
        customerName : dims.customerNames ? (dims.customerNames[row[F.customerName]] || "") : "",
        specialty    : dims.specialties[row[F.specialty]] || "",
        klass        : dims.classes[row[F.klass]] || "",
        type         : dims.types[row[F.type]] || "",
        employee     : dims.employeeNames[row[F.employee]] || "",
        team         : dims.teams[row[F.team]] || "",
        manager      : dims.managers[row[F.manager]] || "",
        frequency    : row[F.frequency],
        lastVisitDate: dims.lastVisitDates ? (dims.lastVisitDates[row[F.lastVisitDate]] || "Never") : "Never",
        area         : dims.areas ? (dims.areas[row[F.area]] || "") : "",
      });
    }

    result.sort((a, b) =>
      a.employee.localeCompare(b.employee) || a.customerName.localeCompare(b.customerName)
    );
    return result;
  }

  /**
   * getKolCoverage(filters)
   * =======================
   * Computes quarterly KOL coverage for every active employee whose Title
   * contains "manager" (case-insensitive match on dims.titles).
   *
   * Period filter is intentionally IGNORED — quarters are fixed calendar
   * groupings (Q1=Feb+Mar, Q2=Apr+May+Jun) and filtering by period would
   * produce misleading partial-quarter numbers.
   *
   * All other dimension filters (team, BU, NSM, area manager, manager,
   * employee, specialty, class, status, experience, type) are respected
   * so the section stays in sync with the global dashboard filter state.
   *
   * Coverage rule: a KOL customer is "covered in quarter Q" if
   * coveredDoctor === 1 in AT LEAST ONE period belonging to Q.
   *
   * Returns an array of per-manager objects, sorted by manager name:
   * { name, profile, team,
   *   kolCount,
   *   q1Total, q1Covered, q1CoveragePct, q1NotSeen,
   *   q2Total, q2Covered, q2CoveragePct, q2NotSeen,
   *   q1NotSeenList: [{customerName, specialty, klass, frequency}],
   *   q2NotSeenList: [{customerName, specialty, klass, frequency}] }
   */
  function getKolCoverage(filters) {
    if (!rows || !dims) return [];

    // Quarter assignment: periodIdx → "q1" | "q2" | null
    const periodQuarter = dims.periods.map((name) => {
      const n = name.toLowerCase();
      if (n.includes("feb") || n.includes("mar")) return "q1";
      if (n.includes("apr") || n.includes("may") || n.includes("jun")) return "q2";
      return null; // future quarters ignored
    });

    // Dimension filter sets (same logic as run(), minus period)
    const dimKeys   = ["team","businessUnit","nsm","areaManager","manager","employee","specialty","klass","status","experience","type","title"];
    const dimFields = [F.team, F.businessUnit, F.nsm, F.areaManager, F.manager, F.employee, F.specialty, F.klass, F.status, F.experience, F.type, F.title];
    const dimLists  = ["teams","businessUnits","nsms","areaManagers","managers","employeeNames","specialties","classes","statuses","experiences","types","titles"];
    const wantSets  = dimKeys.map((k, i) => {
      const vals = (k === "klass" ? filters.class : filters[k]) || [];
      if (vals.length === 0) return null;
      const s = new Set();
      vals.forEach((v) => { const idx = dims[dimLists[i]].indexOf(v); if (idx >= 0) s.add(idx); });
      return s;
    });

    // KOL hierarchical OR-filter for nsm / areaManager / manager:
    // ─────────────────────────────────────────────────────────────
    // A manager's OWN KOL rows have their BOSS in the hierarchy fields,
    // not themselves. Standard wantSet logic would exclude their own rows.
    //
    // Rule: include a row if the employee IS the filtered person (self)
    //       OR if the employee sits UNDER that person in the hierarchy.
    //
    // Example: filter = NSM Ahmed
    //   → include rows where row[F.nsm] = Ahmed's nsmIdx  (all his hierarchy)
    //   → OR where row[F.employee] = Ahmed's employeeIdx  (Ahmed's own KOL)
    //
    // Pull nsm / areaManager / manager out of the standard wantSets loop
    // and handle them here with the OR gate.
    const hierKeys    = ["nsm", "areaManager", "manager"];
    const hierFields2 = [F.nsm,  F.areaManager,  F.manager];
    const hierLists2  = ["nsms", "areaManagers",  "managers"];

    // For each hier dim: wantSet (subordinate check) + selfEmpSet (self check)
    const hierWantSets = hierKeys.map((k, h) => {
      const idx = dimKeys.indexOf(k);
      const ws  = wantSets[idx];
      wantSets[idx] = null; // remove from standard loop
      return ws; // null if not filtered
    });
    const hierSelfEmpSets = hierKeys.map((k, h) => {
      if (!hierWantSets[h]) return null;
      const s = new Set();
      (filters[k] || []).forEach((name) => {
        // Primary lookup: exact match in employeeNames
        let ei = dims.employeeNames.indexOf(name);
        // Fallback: use pre-built normalised map (handles source-data name mismatches)
        if (ei < 0 && mgrNameToEmpIdx) ei = mgrNameToEmpIdx.get(name) ?? -1;
        if (ei >= 0) s.add(ei);
      });
      return s;
    });

    // mgrMap: employeeIdx → { custQ1: Map<custIdx,bool>, custQ2: Map<custIdx,bool>, teamIdx, profileIdx, titleIdx }
    const mgrMap = new Map();
    const n = rows.length;

    for (let i = 0; i < n; i++) {
      const row = rows[i];
      if (!row[F.isActive]) continue;

      // Apply standard dimension filters (period and hier dims already excluded)
      let skip = false;
      for (let d = 0; d < dimFields.length; d++) {
        if (wantSets[d] && !wantSets[d].has(row[dimFields[d]])) { skip = true; break; }
      }
      if (skip) continue;

      // KOL hierarchical OR-filter: for each active hier dimension,
      // include if employee IS the filtered person OR sits under them.
      let hierFail = false;
      for (let h = 0; h < hierKeys.length; h++) {
        if (!hierWantSets[h]) continue; // dimension not filtered
        const isSelf        = hierSelfEmpSets[h].has(row[F.employee]);
        const isSubordinate = hierWantSets[h].has(row[hierFields2[h]]);
        if (!isSelf && !isSubordinate) { hierFail = true; break; }
      }
      if (hierFail) continue;

      const empIdx  = row[F.employee];
      const custIdx = row[F.customerName];
      const q       = periodQuarter[row[F.period]];
      if (!q) continue; // period not in a defined quarter

      if (!mgrMap.has(empIdx)) {
        mgrMap.set(empIdx, {
          teamIdx: row[F.team],
          profileIdx: row[F.profile],
          titleIdx: row[F.title],
          custQ1: new Map(), // custIdx → true if covered
          custQ2: new Map(),
        });
      }
      const entry = mgrMap.get(empIdx);

      // Map value: { covered, specialtyIdx, klassIdx, typeIdx, frequency, lastVisitDateIdx, areaIdx }
      // First encounter seeds the metadata; subsequent encounters only update covered.
      const custMeta = {
        covered: !!row[F.coveredDoctor],
        specialtyIdx: row[F.specialty],
        klassIdx:     row[F.klass],
        typeIdx:      row[F.type],
        frequency:    row[F.frequency],
        lastVisitDateIdx: row[F.lastVisitDate],
        areaIdx:      row[F.area],
      };
      if (q === "q1") {
        if (!entry.custQ1.has(custIdx)) {
          entry.custQ1.set(custIdx, custMeta);
        } else if (row[F.coveredDoctor]) {
          entry.custQ1.get(custIdx).covered = true;
        }
      } else {
        if (!entry.custQ2.has(custIdx)) {
          entry.custQ2.set(custIdx, custMeta);
        } else if (row[F.coveredDoctor]) {
          entry.custQ2.get(custIdx).covered = true;
        }
      }
      // Update team/profile from latest row (stable within a manager)
      entry.teamIdx    = row[F.team];
      entry.profileIdx = row[F.profile];
      entry.titleIdx   = row[F.title];
    }

    // Build output rows
    const result = [];
    mgrMap.forEach((entry, empIdx) => {
      const name    = dims.employeeNames[empIdx] || "";
      const profile = dims.profiles[entry.profileIdx] || "";
      const team    = dims.teams[entry.teamIdx] || "";
      const title   = dims.titles[entry.titleIdx] || "";

      function quarterStats(custMap) {
        const total   = custMap.size;
        const covered = [...custMap.values()].filter((m) => m.covered).length;
        const notSeenList = [];
        custMap.forEach((meta, cIdx) => {
          if (!meta.covered) {
            notSeenList.push({
              customerName: dims.customerNames ? (dims.customerNames[cIdx] || "") : "",
              specialty:    dims.specialties[meta.specialtyIdx] || "",
              klass:        dims.classes[meta.klassIdx] || "",
              type:         dims.types[meta.typeIdx] || "",
              frequency:    meta.frequency,
              lastVisitDate: dims.lastVisitDates ? (dims.lastVisitDates[meta.lastVisitDateIdx] || "Never") : "Never",
              area:         dims.areas ? (dims.areas[meta.areaIdx] || "") : "",
            });
          }
        });
        notSeenList.sort((a, b) => a.customerName.localeCompare(b.customerName));
        return {
          total,
          covered,
          coveragePct: total > 0 ? Math.round((covered / total) * 10000) / 10000 : null,
          notSeen: total - covered,
          notSeenList,
        };
      }

      // Only include if manager has KOLs in at least one quarter
      const q1 = quarterStats(entry.custQ1);
      const q2 = quarterStats(entry.custQ2);
      if (q1.total + q2.total === 0) return;

      const kolCount = new Set([...entry.custQ1.keys(), ...entry.custQ2.keys()]).size;

      result.push({
        name, profile, team, title, kolCount,
        q1Total: q1.total, q1Covered: q1.covered,
        q1CoveragePct: q1.coveragePct, q1NotSeen: q1.notSeen,
        q1NotSeenList: q1.notSeenList,
        q2Total: q2.total, q2Covered: q2.covered,
        q2CoveragePct: q2.coveragePct, q2NotSeen: q2.notSeen,
        q2NotSeenList: q2.notSeenList,
      });
    });

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  return { init, run, defaultFilters, selfCheck, getNotSeenCustomers, getKolCoverage };
})();
