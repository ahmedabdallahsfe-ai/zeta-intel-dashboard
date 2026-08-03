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
  // and the CHC/CHC_SALES single-scenario fallback rule. Per the approved
  // architecture (TARGET_SCENARIO_ARCHITECTURE_PROPOSAL.md /
  // TARGET_SCENARIO_DEPENDENCY_ANALYSIS.md), this registry is the ONLY
  // place either concept is encoded -- js/sales.js and js/executive.js
  // call resolveScenario() rather than re-implementing the CHC exception
  // or hardcoding TargetIndex anywhere else. `TargetIndex` itself is
  // never exposed in the UI; only the labels below are.
  //
  // "Working Target" is a deliberate placeholder label (business owner
  // confirmation of TargetIndex=0's true meaning is still pending) --
  // NOT "Buffer": the real data shows Working >= Official for every line
  // that has both (100%-174%), the opposite of what "buffer" implies.
  // Do not rename this without an explicit decision (see proposal §3/§13).
  var TARGET_SCENARIOS = {
    official: { index: 1, label: "Official Target", isDefault: true },
    working:  { index: 0, label: "Working Target", isDefault: false }
  };
  var DEFAULT_SCENARIO = "official";

  // CHC and CHC_SALES have no real Working Target (confirmed by direct
  // data audit, 2026-08-03): the annual source file's TargetIndex=0 rows
  // for these two lines sum to zero/don't exist at all -- only June
  // carries an incidental value nearly identical to Official. Any request
  // for a non-official scenario against these two lines silently falls
  // back to Official (see resolveScenario() below) rather than showing a
  // blank/zero/NaN figure.
  var CHC_SINGLE_SCENARIO_LINES = ["CHC", "CHC_SALES"];

  function isValidScenario(key) {
    return TARGET_SCENARIOS.hasOwnProperty(key);
  }

  function isChcSingleScenarioLine(rawLine) {
    var canon = normalizeLine(rawLine);
    return CHC_SINGLE_SCENARIO_LINES.indexOf(canon) >= 0;
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
    if (requested !== "official" && isChcSingleScenarioLine(rawLine)) {
      return { scenario: "official", requestedScenario: requested, isFallback: true };
    }
    return { scenario: requested, requestedScenario: requested, isFallback: false };
  }

  global.SEMANTIC = {
    BU_LIST: BU_LIST,
    BU_META: BU_META,
    CONTEXT_SEGMENTS: CONTEXT_SEGMENTS,
    lineToBU: lineToBU,
    classifyLine: classifyLine,
    normalizeLine: normalizeLine,
    isInScope: isInScope,
    groupByBU: groupByBU,
    TARGET_SCENARIOS: TARGET_SCENARIOS,
    DEFAULT_SCENARIO: DEFAULT_SCENARIO,
    CHC_SINGLE_SCENARIO_LINES: CHC_SINGLE_SCENARIO_LINES,
    isValidScenario: isValidScenario,
    isChcSingleScenarioLine: isChcSingleScenarioLine,
    resolveScenario: resolveScenario
  };
})(window);
