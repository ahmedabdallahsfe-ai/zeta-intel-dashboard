/**
 * ZETA ENTERPRISE PLATFORM — semantic-model.js
 * =====================================================================
 * PLATFORM ASSET (Phase-4-lite). Exposes window.SEMANTIC.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * "Business Unit" is not a native, consistent field anywhere except
 * IQVIA. Audited before building the Executive Command Center:
 *
 *   Dashboard            | Field labeled "BU"     | What it actually is
 *   ----------------------|-------------------------|----------------------
 *   Sales                 | lookups.buheads         | 5 PERSON NAMES (an
 *                          |                         | org-chart role)
 *   Coverage & Frequency   | dimensions.businessUnits| Same person names,
 *                          |                         | mislabeled in the
 *                          |                         | cache itself
 *   SFE / Organogram       | (none)                  | only has `line`
 *   IQVIA                  | lookups.bus             | The real product-BU
 *                          |                         | taxonomy: CHC,
 *                          |                         | Cluster, DIAB, GIT,
 *                          |                         | Non-Promoted, Other
 *                          |                         | Markets
 *
 * A BU Head is an organizational role and can change scope; a Business
 * Unit is a product/therapeutic grouping. They correlate today (one
 * person per BU) but are not the same dimension, and joining Sales'
 * "buhead" directly to IQVIA's "bu" would silently break the moment a
 * role changes hands or goes vacant.
 *
 * All four dashboards DO agree on one thing: `line` (CHC, DIAB-I..IV,
 * GIT-I..III, CVM-I/II, ORTHO-I/II, PEDIA, Derma, etc). IQVIA's own
 * target data (TARGETS_2026 in js/iqvia.js) already encodes the
 * authoritative Line -> BU crosswalk. This file extracts that
 * crosswalk once, reconciles the handful of naming variants between
 * Sales/Coverage's line lists and IQVIA's, and exposes it as the one
 * place any workspace derives a Business Unit from a line value.
 *
 * SCOPE DECISION (confirmed by business owner, 2026-07-26): the
 * Executive Command Center's Business Unit Executive Review covers
 * only the four actively-managed commercial BUs: CHC, Cluster, DIAB,
 * GIT. "Non-Promoted" and "Other Markets" are explicitly OUT of scope
 * for that review -- lineToBU() returns null for lines in those
 * buckets so callers naturally exclude them from BU-level aggregation
 * without special-casing.
 *
 * IMPORTANT — these two segments are EXCLUDED, not DISCARDED (business
 * owner correction, 2026-07-26): they still carry real analytical
 * value for market sizing, portfolio whitespace, and competitive
 * benchmarking inside IQVIA's own Market Intelligence workspace. This
 * file therefore classifies every line into exactly one of two
 * buckets -- "bu" (one of the 4 in-scope BUs) or "context" (Non-
 * Promoted / Other Markets) -- via classifyLine(), rather than just
 * mapping-or-null. Executive Command Center consumes only the "bu"
 * bucket; IQVIA's own workspace can still slice by the "context"
 * bucket for its market-intelligence-specific views.
 * =====================================================================
 */

(function (global) {
  "use strict";

  // In-scope Business Units for the Executive Command Center.
  var BU_LIST = ["CHC", "Cluster", "DIAB", "GIT"];

  // ---------------------------------------------------------------------
  // BU / CORPORATE SALES ROLLUP EXCLUSIONS (2026-08-04, Ahmed's decision)
  // ---------------------------------------------------------------------
  // "CONSIDER CHC BU SALES AND TARGET = CHC LINE NOT SUM OF CHC+CHC_SALES".
  //
  // CHC has two lines: "CHC" (Medical Rep / Contract-Doctor-Hospital
  // channel) and "CHC_SALES" (Pharmacy-facing Sales Rep channel). Both
  // carry the SAME 11 SKUs -- CHC_SALES is a second channel view of the
  // same catalogue, not incremental business -- so adding them together
  // overstates the BU. Measured on the 2026-08-04 cache, summing them
  // inflated CHC from EGP 59.59M to 105.98M actual (+43.8%) and its
  // target from 131.46M to 230.05M.
  //
  // Confirmed scope (both answered by Ahmed before implementation):
  //   - Excluded from CORPORATE too, not just the CHC BU card, so
  //     Corporate stays equal to the sum of the four BUs and every
  //     "vs Corporate" benchmark reconciles. (~3.27% of all non-tender
  //     sales in the cache.)
  //   - STILL FULLY VISIBLE as its own line: selectable in the Line
  //     filter, present in Line Performance and every drill-down, with
  //     its own sales/target/achievement. Nothing is hidden -- it just
  //     stops contributing to an unscoped BU/Corporate total.
  //
  // Applies to SALES metrics only. Coverage/Frequency deliberately still
  // count both CHC teams (they are genuinely distinct rep populations
  // measured against different customer types -- see
  // getFilteredCoverageForLine() in js/coverage-interface.js). Do not
  // "unify" the two behaviors; they answer different questions.
  var BU_ROLLUP_EXCLUDED_LINES = ["CHC_SALES"];

  /**
   * Should this line be counted in an UNSCOPED BU or Corporate sales
   * rollup? False only for lines in BU_ROLLUP_EXCLUDED_LINES.
   *
   * Callers must apply this ONLY when no specific line was requested.
   * When the user explicitly selects CHC_SALES (or it is being listed as
   * its own row), it must be included in full -- that is the whole point
   * of keeping it visible.
   */
  function countsInBuRollup(rawLine) {
    return BU_ROLLUP_EXCLUDED_LINES.indexOf(normalizeLine(rawLine)) < 0;
  }

  // Excluded from the BU Executive Review, but retained (not discarded)
  // for IQVIA's own market-sizing / whitespace / competitive-benchmark
  // analysis. See classifyLine() below.
  var CONTEXT_SEGMENTS = ["Non-Promoted", "Other Markets"];

  // Display metadata -- one consistent color/order per BU platform-wide,
  // drawn from the design system's categorical chart palette so BU
  // charts anywhere in the app use the same color for the same BU.
  var BU_META = {
    CHC:     { label: "CHC",     chartVar: "--chart-1" },
    Cluster: { label: "Cluster", chartVar: "--chart-2" },
    DIAB:    { label: "DIAB",    chartVar: "--chart-3" },
    GIT:     { label: "GIT",     chartVar: "--chart-4" }
  };

  // Canonical line -> BU, keyed by the line spelling as it appears in
  // IQVIA's own TARGETS_2026 data (the source of truth for this mapping).
  //
  // CHC is the one exception (2026-07-27, user correction): the CHC BU
  // genuinely has TWO real lines, "CHC" (Doctor/Hospital/Contract-facing
  // reps) and "CHC_SALES" (a distinct Pharmacy-facing sales team -- see
  // coverage-interface.js's getFilteredCoverageForLine() for the
  // Pharmacy-type scoping this implies). IQVIA's TARGETS_2026 only has
  // one "CHC" entry, so "CHC_SALES" is listed here as its own canonical
  // line mapped to the same BU, not sourced from IQVIA. Earlier
  // (2026-07-27, same day) this was treated as a DUPLICATE spelling to
  // collapse -- that was wrong; corrected per the user's explicit
  // domain clarification. See [[chc-line-dedup]] in memory for the full
  // history of this correction.
  var CANONICAL_LINE_TO_BU = {
    "CHC": "CHC",
    "CHC_SALES": "CHC",
    "PEDIA": "Cluster",
    "ORTHO-I": "Cluster",
    "ORTHO-II": "Cluster",
    "CVM-I": "Cluster",
    "CVM-II": "Cluster",
    "DIAB-I": "DIAB",
    "DIAB-II": "DIAB",
    "DIAB-III": "DIAB",
    "DIAB-IV": "DIAB",
    "Derma": "GIT",
    "CNS": "GIT",
    "GIT-I": "GIT",
    "GIT-II": "GIT",
    "GIT-III": "GIT"
    // Deliberately absent: "Non-Promoted", "Other Markets" -> out of
    // scope per the business decision above; lineToBU() returns null.
  };

  // Naming variants seen in Sales/Coverage that don't match IQVIA's
  // exact spelling, mapped to the canonical spelling above before
  // lookup. Discovered by diffing lookups.lines across the three
  // caches -- do not assume future data drops will match; recheck
  // this list whenever a cache is regenerated with new line values.
  var LINE_SYNONYMS = {
    // "CHC_SALES" is NOT a synonym of "CHC" -- it's its own real line
    // now listed directly in CANONICAL_LINE_TO_BU above (2026-07-27
    // correction). Do not re-add it here; that would collapse the two
    // lines back into one.
    "NEUROSCIENCE": "CNS",    // Sales/SFE call it NEUROSCIENCE, IQVIA calls it CNS
    "DERMA": "Derma",          // casing difference only (Coverage uppercases it)
    "GIT I": "GIT-I",
    "GIT II": "GIT-II",
    "GIT III": "GIT-III",
    "ORTHO I": "ORTHO-I",
    "ORTHO II": "ORTHO-II",
    "CVM I": "CVM-I",
    "CVM II": "CVM-II",
    "DIABETES I": "DIAB-I",
    "DIABETES II": "DIAB-II",
    "DIABETES III": "DIAB-III",
    "DIABETES IV": "DIAB-IV",
    "DIAB I": "DIAB-I",
    "DIAB II": "DIAB-II",
    "DIAB III": "DIAB-III",
    "DIAB IV": "DIAB-IV"
  };

  /**
   * Normalize a raw line string from ANY of the four caches to the
   * canonical spelling used by CANONICAL_LINE_TO_BU.
   */
  function normalizeLine(rawLine) {
    if (rawLine === null || rawLine === undefined) return null;
    var s = String(rawLine).trim();
    if (LINE_SYNONYMS.hasOwnProperty(s)) return LINE_SYNONYMS[s];
    // Case-insensitive fallback match against known canonical/synonym keys
    var upper = s.toUpperCase();
    for (var key in LINE_SYNONYMS) {
      if (key.toUpperCase() === upper) return LINE_SYNONYMS[key];
    }
    for (var canon in CANONICAL_LINE_TO_BU) {
      if (canon.toUpperCase() === upper) return canon;
    }
    return s;
  }

  /**
   * Resolve a raw line value (from Sales/Coverage/SFE/IQVIA, any
   * spelling) to one of the 4 in-scope Business Units, or null if the
   * line is out of scope (Non-Promoted, Other Markets, or unrecognized).
   */
  function lineToBU(rawLine) {
    var canon = normalizeLine(rawLine);
    if (canon === null) return null;
    return CANONICAL_LINE_TO_BU.hasOwnProperty(canon) ? CANONICAL_LINE_TO_BU[canon] : null;
  }

  function isInScope(bu) {
    return BU_LIST.indexOf(bu) >= 0;
  }

  /**
   * Classify a raw line value into exactly one bucket:
   *   { type: 'bu',      value: 'CHC'|'Cluster'|'DIAB'|'GIT' }  -- Executive Review
   *   { type: 'context', value: 'Non-Promoted'|'Other Markets' } -- IQVIA-only analysis
   *   { type: 'unknown', value: <normalized string> }            -- unrecognized line
   * Use this instead of lineToBU() whenever the caller needs to retain
   * (not drop) Non-Promoted/Other Markets, e.g. IQVIA's own market-
   * sizing views.
   */
  function classifyLine(rawLine) {
    var canon = normalizeLine(rawLine);
    if (canon === null) return { type: "unknown", value: null };
    if (CANONICAL_LINE_TO_BU.hasOwnProperty(canon)) {
      return { type: "bu", value: CANONICAL_LINE_TO_BU[canon] };
    }
    if (CONTEXT_SEGMENTS.indexOf(canon) >= 0) {
      return { type: "context", value: canon };
    }
    return { type: "unknown", value: canon };
  }

  /**
   * Group an arbitrary array of {line, ...rest} records by BU, dropping
   * any record whose line resolves to null (out of scope). Does not
   * aggregate values itself -- callers pass their own reducer since
   * Sales/Coverage/IQVIA each have different value fields.
   */
  function groupByBU(records, lineKey, reduceFn, initFn) {
    var buckets = {};
    BU_LIST.forEach(function (bu) { buckets[bu] = initFn ? initFn() : { count: 0 }; });
    records.forEach(function (rec) {
      var bu = lineToBU(rec[lineKey]);
      if (bu === null) return;
      buckets[bu] = reduceFn(buckets[bu], rec);
    });
    return buckets;
  }

  // =====================================================================
  // TARGET SCENARIO (2026-08-04) -- Dual Target Scenario feature.
  // =====================================================================
  // Single source of truth for the TargetIndex -> business-label mapping
  // and for scenario fallback. Per the approved architecture
  // (TARGET_SCENARIO_ARCHITECTURE_PROPOSAL.md /
  // TARGET_SCENARIO_DEPENDENCY_ANALYSIS.md), this registry is the ONLY
  // place either concept is encoded -- js/sales.js and js/executive.js
  // call resolveScenario() rather than re-implementing fallback or
  // hardcoding TargetIndex anywhere else. `TargetIndex` itself is never
  // exposed in the UI; only the labels below are.
  //
  // TargetIndex 1 = Official Target, 0 = Working Target -- CONFIRMED by
  // Ahmed 2026-08-04. This mapping is settled, and "Working Target" is
  // the agreed business label (NOT "Buffer" -- the data shows Working >=
  // Official on every line that has both, the opposite of what "buffer"
  // implies).
  // shortage (2026-08-26, Ahmed's source-consolidation directive) -- a
  // THIRD scenario, additive to the two above. Unlike Official/Working,
  // it is not sourced from a raw TargetIndex value (index: null) -- it is
  // synthesized by refresh_sales.py's shortage post-processing pass:
  // Shortage Target = Actual Sales for a Line/SKU/Month flagged in
  // Shortage_Conditions.xlsx, else = Official Target (Ahmed's FINAL rule,
  // 2026-08-26 -- supersedes an earlier same-day Working-fallback
  // wording; NOT Working). Official/Working themselves are never
  // modified -- Shortage is purely additive. A line with no Official
  // coverage at all (CHC/CHC_SALES, Working-only by design) has no
  // Official figure for its non-flagged periods to fall back to; those
  // resolve to 0, not a silent Working substitution.
  //
  // ROW EXISTENCE still derives from Working, unrelated to the fallback
  // VALUE above: the ETL decides WHICH Line/SKU/Month combinations get a
  // Shortage row by walking the existing Working row set 1:1 (Working
  // coverage is simply the widest/safest set of dims to enumerate from --
  // every line with any target coverage has Working rows), so in practice
  // cov.shortage === cov.working for every line on a v4+ cache even
  // though Working's own VALUES are no longer read for the non-flagged
  // case. NOTE: unrelated to js/sales.js's pre-existing
  // "Target Basis Filter Shortage" (hasShortage/shortageItems) -- that is
  // a data-coverage-gap flag (rep sold a SKU/month with no target on
  // record at all), not a business scenario. Same English word, two
  // different concepts -- see that file's doc comment for the full
  // disambiguation.
  var TARGET_SCENARIOS = {
    official: { index: 1, label: "Official Target", isDefault: true },
    working:  { index: 0, label: "Working Target", isDefault: false },
    shortage: { index: null, label: "Shortage Target", isDefault: false }
  };
  var DEFAULT_SCENARIO = "official";

  // Fallback preference order per requested scenario, used by
  // resolveScenario() below. official/working keep their EXACT original
  // bidirectional pairing (index 0/1 of their own chain) -- this is a
  // generalization of the pre-existing 2-way logic, not a behavior
  // change for either of them. shortage tries itself, then Working, then
  // Official as a last resort -- this LINE-LEVEL chain only fires when a
  // line has NO shortage row coverage at all (e.g. a pre-v4 cache queried
  // with 'shortage'), an edge case unrelated to the per-row Shortage=Y/N
  // VALUE rule above (which now falls back to Official, baked in by the
  // ETL) -- better than returning nothing for that edge case.
  var SCENARIO_FALLBACK_CHAIN = {
    official: ["official", "working"],
    working:  ["working", "official"],
    shortage: ["shortage", "working", "official"]
  };

  // ---------------------------------------------------------------------
  // DATA-DRIVEN SCENARIO COVERAGE (2026-08-04)
  // ---------------------------------------------------------------------
  // Replaces the former CHC_SINGLE_SCENARIO_LINES constant, which
  // hardcoded ["CHC","CHC_SALES"] from a one-off audit and went stale the
  // same week: the 2026-08-04 June TGT export gave CHC_SALES a genuinely
  // distinct Working Target (169% of Official), which the hardcoded rule
  // was then actively suppressing. Anything measured from the data
  // belongs in the data.
  //
  // refresh_sales.py now emits cache.meta.scenarioCoverage --
  // {lineName: {official: bool, working: bool}} -- computed from the rows
  // it actually wrote. setScenarioCoverage() is called once by
  // js/sales.js right after the cache decompresses; resolveScenario()
  // then answers from measured fact.
  //
  // Fallback is bidirectional by design. The old rule only ever fell back
  // Working -> Official, on the assumption Official is always present.
  // That assumption is now false: per Ahmed's confirmed instruction, CHC
  // and CHC_SALES are classified Working-only at ingest, so for those two
  // an OFFICIAL request must fall back to Working. Direction is derived
  // from coverage, never assumed.
  //
  // Unknown lines (not in coverage, or coverage never set -- e.g. a cache
  // predating this metadata) resolve to the requested scenario with no
  // fallback, which is exactly the pre-feature behavior js/sales.js also
  // degrades to. Never guess a fallback from absent information.
  var _scenarioCoverage = null;

  function setScenarioCoverage(coverage) {
    _scenarioCoverage = (coverage && typeof coverage === "object") ? coverage : null;
  }

  function getScenarioCoverage() {
    return _scenarioCoverage;
  }

  /**
   * What target scenarios does this line actually have data for?
   * Returns null when unknown (no coverage metadata loaded, or the line
   * isn't in it) -- callers must treat null as "don't intervene", not as
   * "has nothing".
   */
  function lineScenarioCoverage(rawLine) {
    if (!_scenarioCoverage) return null;
    var canon = normalizeLine(rawLine);
    if (Object.prototype.hasOwnProperty.call(_scenarioCoverage, canon)) return _scenarioCoverage[canon];
    // Coverage is keyed on the raw line name the ETL wrote; normalizeLine
    // is usually a no-op but check the raw key too rather than silently
    // returning "unknown" on a naming mismatch.
    if (Object.prototype.hasOwnProperty.call(_scenarioCoverage, rawLine)) return _scenarioCoverage[rawLine];
    return null;
  }

  function isValidScenario(key) {
    return TARGET_SCENARIOS.hasOwnProperty(key);
  }

  /**
   * True when this line carries data for one scenario only -- i.e. any
   * request for the other one will fall back. Kept as a named export
   * because the UI uses it to decide whether to show an explanatory note.
   * Replaces isChcSingleScenarioLine(), which asked the same question of
   * a hardcoded list.
   */
  function isSingleScenarioLine(rawLine) {
    var cov = lineScenarioCoverage(rawLine);
    if (!cov) return false;
    return !(cov.official && cov.working);
  }

  /**
   * THE single entry point for target-scenario resolution platform-wide.
   * Given a raw line/BU name and the scenario the signed-in user has
   * requested (or their role default), returns which scenario should
   * ACTUALLY be used to aggregate that line's target rows, plus whether
   * a fallback occurred (so callers can surface an inline "Official
   * Target shown -- no Working Target for this line" note instead of a
   * silent, unexplained number).
   *
   * Deliberately takes a LINE (or BU name -- CHC as a BU name resolves
   * identically to CHC as a line name), not a whole filter/context
   * object: callers that aggregate multiple lines in one pass (e.g.
   * getBusinessSummary's per-BU loop, which blends CHC and CHC_SALES
   * rows under BU "CHC") must resolve PER ROW'S LINE, since CHC's
   * fallback must apply even when the rest of the same aggregation call
   * (DIAB/GIT/Cluster lines) honors the requested scenario normally.
   * See buildLineScenarioMap() in js/sales.js for the perf-conscious
   * per-call precomputation pattern built on top of this function.
   */
  function resolveScenario(rawLine, requestedScenario) {
    var requested = isValidScenario(requestedScenario) ? requestedScenario : DEFAULT_SCENARIO;
    var cov = lineScenarioCoverage(rawLine);

    // Unknown line, or no coverage metadata at all (older cache): honor
    // the request untouched. Same graceful-degradation stance as
    // js/sales.js's includeTargetRow() -- absent information is never
    // grounds for silently substituting a different number.
    if (!cov) return { scenario: requested, requestedScenario: requested, isFallback: false };

    // Walk the requested scenario's fallback chain (see
    // SCENARIO_FALLBACK_CHAIN above) and use the first one the line
    // actually has data for. chain[0] is always `requested` itself, so
    // this is a pure generalization of the original two-scenario
    // official<->working logic -- identical outcome for those two,
    // extended with a third link for shortage. A scenario absent from
    // `cov` (e.g. "shortage" on a pre-v4 cache) reads as falsy here,
    // exactly like an explicit false, so it's skipped the same way.
    var chain = SCENARIO_FALLBACK_CHAIN[requested] || [requested];
    for (var i = 0; i < chain.length; i++) {
      if (cov[chain[i]]) {
        return { scenario: chain[i], requestedScenario: requested, isFallback: i > 0 };
      }
    }

    // Line has none of the chain's scenarios -- nothing to fall back to.
    // Return the request unchanged so the caller surfaces an honest empty
    // figure rather than a borrowed one.
    return { scenario: requested, requestedScenario: requested, isFallback: false };
  }

  global.SEMANTIC = {
    BU_LIST: BU_LIST,
    BU_META: BU_META,
    BU_ROLLUP_EXCLUDED_LINES: BU_ROLLUP_EXCLUDED_LINES,
    countsInBuRollup: countsInBuRollup,
    CONTEXT_SEGMENTS: CONTEXT_SEGMENTS,
    lineToBU: lineToBU,
    // Exposed 2026-08-04 so callers can enumerate a BU's full line list
    // (app.js's tomarketAllowedBU() needs it to tell a BU Manager --
    // who holds every line in their BU -- from a genuinely line-
    // restricted account). Read-only by convention: mutate this and you
    // silently re-map the whole platform's Line -> BU crosswalk.
    CANONICAL_LINE_TO_BU: CANONICAL_LINE_TO_BU,
    classifyLine: classifyLine,
    normalizeLine: normalizeLine,
    isInScope: isInScope,
    groupByBU: groupByBU,
    TARGET_SCENARIOS: TARGET_SCENARIOS,
    DEFAULT_SCENARIO: DEFAULT_SCENARIO,
    isValidScenario: isValidScenario,
    setScenarioCoverage: setScenarioCoverage,
    getScenarioCoverage: getScenarioCoverage,
    lineScenarioCoverage: lineScenarioCoverage,
    isSingleScenarioLine: isSingleScenarioLine,
    // Back-compat alias (2026-08-04): the CHC-specific name is gone, but
    // anything still calling it gets the data-driven answer rather than a
    // hard failure. Prefer isSingleScenarioLine() in new code.
    isChcSingleScenarioLine: isSingleScenarioLine,
    resolveScenario: resolveScenario
  };
})(window);
