/**
 * ZETA Pharmaceutical Commercial Analytics Suite
 * ==============================================
 * A multi-page executive BI application supporting 10 distinct drill-down views,
 * left-hand collapsible multi-select filter panel, synchronized global filters,
 * interactive SVG geography map, client-side advanced analytics forecasting/outliers,
 * saved filter views, and dynamic dynamic business AI narrative.
 */

(function () {
  // Enterprise hierarchy taxonomy (validated against cache/organogram.json):
  // REP -> DM -> RM (Regional Manager) -> NSM -> BUHEAD (Business Unit Head) -> CM (Commercial Manager).
  // CM is captured in the cache (lookups.cms) but deliberately has no filter dropdown below —
  // single company-wide value, no analytical slicing power.
  const MONTH = 0, LINE = 1, BRAND = 2, PROD = 3, REP = 4, DM = 5, RM = 6, NSM = 7, BUHEAD = 8, CM = 9, REG = 10, BRICK = 11, DIST = 12;
  const CHAIN = 13, MTYPE = 14, STYPE = 15, TXTYPE = 16, MASK = 17;
  const QTY = 18, VAL = 19, TGT_QTY = 20, TGT_VAL = 21, TRANS_QTY = 22, BULK_QTY = 23, NAT_CEIL = 24, REG_CEIL = 25, CUST_COUNT = 26;

  // =====================================================================
  // TARGET SCENARIO (2026-08-04) -- Dual Target Scenario feature.
  // =====================================================================
  // Mask Bit 5 (32): see refresh_sales.py's mask-bitfield comment. Only
  // meaningful when Bit 4 (isMirror, 16) is set -- 1 = row's TargetIndex
  // was 1 (Official), 0 = TargetIndex was 0 (Working). This is the ONLY
  // place in this file that reads Bit 5 directly; every accumulation
  // site below goes through includeTargetRow()/buildLineScenarioMap(),
  // never the raw bit, per the single-source-of-truth requirement.
  function rowIsOfficialScenario(mask) { return (mask & 32) > 0; }

  /**
   * Should THIS row's TGT_VAL/TGT_QTY be added to a sum being built for
   * `wantOfficial` (true = Official Target, false = Working Target)?
   * Non-mirror (actual transaction) rows always pass through -- their
   * TGT_VAL/TGT_QTY are already 0 by the ETL's row convention (a row is
   * EITHER a real transaction OR a mirror/target row, never both), so
   * including them unconditionally is harmless and keeps every
   * accumulation loop's actual-value summation (r[VAL]) exactly as it
   * was before this feature, with zero special-casing needed there.
   *
   * Graceful-degradation fix (2026-08-04, same day as the feature
   * shipped): a cache produced by the pre-v3 ETL never set mask Bit 5
   * at all (it didn't exist yet). Every one of ITS mirror rows is 100%
   * real Official Target data, but under the Bit-5 convention it would
   * read as Bit5=0, i.e. "Working". Filtering it by wantOfficial would
   * make "Official Target" return zero/N/A (nothing has Bit5=1 yet)
   * while "Working Target" quietly showed the real Official numbers
   * mislabeled -- exactly backwards, and exactly what was observed in
   * production against the live (still pre-v3) cache. When the loaded
   * cache predates v3, skip the Bit-5 discrimination entirely and treat
   * every mirror row as valid for whichever scenario was requested --
   * this matches exactly how this function behaved before the Target
   * Scenario feature existed. Real differentiation activates
   * automatically the moment cache.meta.schemaVersion reaches 3.
   */
  function includeTargetRow(mask, wantOfficial) {
    if ((mask & 16) === 0) return true;
    if (!scenarioSchemaAvailable()) return true;
    return rowIsOfficialScenario(mask) === wantOfficial;
  }

  /**
   * Precomputes, ONCE per aggregation call (not per row), which scenario
   * each line in cache.lookups.lines should actually resolve to for the
   * given requested scenario -- applying SEMANTIC.resolveScenario()'s
   * CHC/CHC_SALES fallback per line. Returns a plain array indexed by
   * the same line-lookup index every row already carries at r[LINE], so
   * the hot per-row loop only ever does an O(1) array read
   * (`wantOfficialByLine[r[LINE]]`), never a function call or string
   * compare -- this is what keeps the added scenario-awareness from
   * having a measurable performance cost on ~1M-row aggregation passes.
   *
   * Per-LINE (not per-BU) resolution matters because a single
   * aggregation pass (e.g. getBusinessSummary's BU loop) can blend rows
   * from CHC (single-scenario, must fall back) and DIAB/GIT/Cluster
   * lines (normal, honor the request) in the very same loop.
   */
  /**
   * Lookup-indices of lines excluded from unscoped BU/Corporate rollups
   * (CHC_SALES today -- see SEMANTIC.countsInBuRollup). Built once from
   * the loaded cache and memoized, since isRowAllowed() runs per row on
   * ~600k rows: an index Set lookup is O(1), whereas resolving the line
   * name and calling the semantic helper per row is not. Invalidated
   * whenever the cache is (re)decompressed.
   */
  let _rollupExcludedIdx = null;
  function rollupExcludedLineIdx() {
    if (_rollupExcludedIdx) return _rollupExcludedIdx;
    const s = new Set();
    const lines = (cache && cache.lookups && cache.lookups.lines) || [];
    for (let i = 0; i < lines.length; i++) {
      if (window.SEMANTIC && !window.SEMANTIC.countsInBuRollup(lines[i])) s.add(i);
    }
    _rollupExcludedIdx = s;
    return s;
  }

  function buildLineScenarioMap(requestedScenario) {
    const linesLookup = (cache && cache.lookups && cache.lookups.lines) || [];
    const map = new Array(linesLookup.length);
    for (let i = 0; i < linesLookup.length; i++) {
      const resolved = window.SEMANTIC.resolveScenario(linesLookup[i], requestedScenario);
      map[i] = (resolved.scenario === "official");
    }
    return map;
  }

  const COLUMN_TO_LOOKUP = {
    [MONTH]: 'months',
    [LINE]: 'lines',
    [BRAND]: 'brands',
    [PROD]: 'products',
    [REP]: 'reps',
    [DM]: 'dms',
    [RM]: 'rms',
    [NSM]: 'nsms',
    [BUHEAD]: 'buheads',
    [CM]: 'cms',
    [REG]: 'regions',
    [BRICK]: 'bricks',
    [DIST]: 'distributors',
    [CHAIN]: 'chains',
    [MTYPE]: 'main_types',
    [STYPE]: 'sub_types',
    [TXTYPE]: 'transaction_types'
  };

  // ---------------------------------------------------------------------
  // Customer Channel Mix -- sub_type -> commercial cluster (2026-07-28).
  //
  // Sales' row-level cache has no individual customer name or ID -- its
  // finest granularity for "who bought this" is the `sub_types` lookup
  // (58 raw values), which is itself a mix of named pharmacy/institution
  // accounts (e.g. "Ezzaby", "Abdeen Ph") and generic trade-channel
  // labels (e.g. "Retail", "MOH", "Stores"). This map groups those 58
  // raw values into commercially meaningful clusters for executive
  // reporting. Defined jointly with the business owner (deliverable:
  // sales_subtypes.xlsx, "Sub Types" + "Group Analysis" tabs) --
  // update BOTH the spreadsheet and this map together if the grouping
  // changes; they must stay in sync.
  //
  // NOTE (important limitation, do not overclaim in the UI): within a
  // cluster, "customer name" in the Customer Channel Mix card actually
  // means "sub_type value" -- for named-account sub_types (Chain
  // Pharmacy, Independent Pharmacy) this genuinely reads like a customer
  // name; for the generic-label sub_types (Retail, Stores, MOH, etc.)
  // it is a channel label, not an individual account. There is no
  // deeper per-doctor/per-pharmacy identity available in this cache
  // (see cache.customers -- it carries only an anonymized numeric ID,
  // no name lookup) -- that would require an ETL enhancement, same
  // constraint that deferred KPI 6 (Customer Dynamics).
  const SUBTYPE_TO_CLUSTER = {
    "Abdeen Ph": "Chain Pharmacy", "Abo Ali Ph": "Chain Pharmacy", "Agzakhana Ph": "Chain Pharmacy",
    "Al Fouad Ph": "Chain Pharmacy", "Alserafy Ph": "Chain Pharmacy", "Auxilio": "Chain Pharmacy",
    "Balbaa Ph": "Chain Pharmacy", "Delmar&Attalla Ph": "Chain Pharmacy", "El Khabiry": "Chain Pharmacy",
    "El Taiby PH": "Chain Pharmacy", "El-Biesy": "Chain Pharmacy", "Eslam fathy Ph": "Chain Pharmacy",
    "Ezz Eldin PH": "Chain Pharmacy", "Ezzaby": "Chain Pharmacy", "Khalil PH": "Chain Pharmacy",
    "Maher Chain Alex": "Chain Pharmacy", "Mahfouz": "Chain Pharmacy", "Misr Chain": "Chain Pharmacy",
    "Nabil Eltarshouby Ph": "Chain Pharmacy", "Nour Ph": "Chain Pharmacy", "Ramadan Pharmacy": "Chain Pharmacy",
    "Sally PH": "Chain Pharmacy", "Seif PH": "Chain Pharmacy", "Shokr": "Chain Pharmacy",
    "Tarshobi PH": "Chain Pharmacy", "Walid El Tarshobi": "Chain Pharmacy", "Yasser Hefny": "Chain Pharmacy",
    "Al Safa": "Chain Pharmacy", "Dawaa": "Chain Pharmacy", "Gardenia": "Chain Pharmacy",
    "HEFNY PHs": "Chain Pharmacy", "Optimus": "Chain Pharmacy", "Sehha": "Chain Pharmacy",
    "Yodawi": "Chain Pharmacy", "Chain": "Chain Pharmacy",
    "EgyDrug_Pharmacies": "Retail",
    "Behera PHs": "Stores", "Elsyadla": "Stores", "Stores": "Stores", "SubAgent": "Stores",
    "Special PHs": "Retail", "Account": "Retail", "Retail": "Retail",
    "Army": "Institutional / Government", "Educational Hosp.": "Institutional / Government",
    "HI": "Institutional / Government", "MOH": "Institutional / Government",
    "Petrol": "Institutional / Government", "Police": "Institutional / Government",
    "Univ.": "Institutional / Government",
    "POLY Clinic": "POLY Clinic",
    "Private": "Retail",
    "Private Clinic": "Private Clinic",
    "Private Hospital": "Private Hospital",
    "E-Commerce Allocated": "E-Commerce",
    "Non UPA": "OTHERS", "NON WORKING": "OTHERS", "Other": "OTHERS",
  };
  function subTypeToCluster(rawSubType) {
    if (rawSubType === null || rawSubType === undefined || rawSubType === "(none)") return null;
    return SUBTYPE_TO_CLUSTER.hasOwnProperty(rawSubType) ? SUBTYPE_TO_CLUSTER[rawSubType] : "Uncategorized";
  }

  let cache = null;
  let decodedRows = [];
  let currentChartInstances = [];

  // SALES / POSITION denominator exclusions (2026-07-29, per Ahmed's
  // request). These are placeholder position codes (auto-generated for
  // unfilled/unknown/vacant territory slots), not real deployed positions
  // -- counting them in the "how many territories are we dividing revenue
  // across" denominator would understate true per-territory productivity.
  // Their sales VALUE is still included in the numerator; only the
  // position headcount is affected. Exact-string match against
  // cache.lookups.rep_positions values.
  const EXCLUDED_POSITIONS = new Set([
    "POS_Diab_MR_Unknown_1054",
    "POS_GIT II_MR_Unknown_1061",
    "POS_Unknown_MR_CHC",
    "POS_Unknown_MR_CVM-II",
    "POS_Unknown_MR_DIAB-III",
    "POS_Unknown_MR_GIT-III",
    "POS_Vacant_MR_ORTHO-I",
  ]);

  // Customer Analytics cache (2026-07-28) -- SEPARATE from the main Sales
  // cache above, loaded from window.CUSTOMER_ANALYTICS_CACHE (see
  // etl/build_customer_analytics_cache.py + dashboard.html's script tag
  // comment for why this is a distinct cache/source). Decompressed lazily,
  // once, on first use -- same pattern as decompressCache() below.
  let customerAnalyticsCache = null;
  function decompressCustomerAnalyticsCache() {
    if (customerAnalyticsCache !== null) return;
    if (typeof window.CUSTOMER_ANALYTICS_CACHE === 'undefined') {
      customerAnalyticsCache = false; // sentinel: "checked, not available" (not null = "not yet checked")
      return;
    }
    try {
      const b64 = window.CUSTOMER_ANALYTICS_CACHE.b64Data;
      const strData = atob(b64);
      const charData = strData.split('').map(x => x.charCodeAt(0));
      const bytes = new Uint8Array(charData);
      const decompressed = pako.ungzip(bytes, { to: 'string' });
      customerAnalyticsCache = JSON.parse(decompressed);
    } catch (e) {
      console.error('[Sales] Failed to decompress customer analytics cache', e);
      customerAnalyticsCache = false;
    }
  }

  // Bumped in refresh_sales.py whenever the row layout or lookups' key
  // naming changes. Must match cache.meta.schemaVersion or this module
  // refuses to render (see isCacheStale/renderCachePendingState below) --
  // guards against ever reading an old cache with the corrected hierarchy
  // naming and silently showing wrong BUHEAD/NSM/RM names.
  //
  // v3 (2026-08-04, Target Scenario feature): refresh_sales.py now packs
  // an Official(1)/Working(0) scenario flag into mask Bit 5 for every
  // mirror/target row, and keeps BOTH TargetIndex=0 and =1 rows (v2 and
  // earlier discarded TargetIndex=0 entirely).
  //
  // SAME-DAY FIX (2026-08-04): this was originally wired as a hard block
  // -- bumping REQUIRED_SCHEMA_VERSION to 3 so the whole Sales tab (and,
  // transitively, every Executive KPI that reads through SalesDashboard)
  // would refuse to render against a pre-v3 cache rather than misread
  // Bit 5. In production against the live (still v2) cache this blocked
  // the entire Sales Performance page -- a bigger regression than the
  // problem it prevented, since the feature was meant to be additive.
  // includeTargetRow() below now degrades gracefully instead (treats
  // every mirror row as valid regardless of requested scenario when
  // Bit-5 data isn't present), so the hard block is no longer needed for
  // correctness. REQUIRED_SCHEMA_VERSION is reverted to 2 -- the real,
  // structural hierarchy/cms-lookup requirement this gate has always
  // existed for. v3 (scenario Bit 5) is now a soft/optional capability,
  // detected live via scenarioSchemaAvailable() just below.
  const REQUIRED_SCHEMA_VERSION = 2;

  // True if the loaded cache predates the hierarchy-naming fix (missing
  // meta entirely, wrong/old schemaVersion, or missing the 'cms' lookup
  // that v2 introduced for Emp6/Commercial Manager).
  function isCacheStale() {
    if (!cache) return true;
    if (!cache.meta || typeof cache.meta.schemaVersion !== 'number') return true;
    if (cache.meta.schemaVersion < REQUIRED_SCHEMA_VERSION) return true;
    if (!cache.lookups || !Array.isArray(cache.lookups.cms)) return true;
    return false;
  }

  // True once the loaded cache was produced by the v3+ ETL that tags
  // Official/Working onto mask Bit 5 for every mirror row. See
  // includeTargetRow()'s doc comment above for why this matters --
  // before v3, Bit 5 is always 0 for every row (the bit didn't exist),
  // which would misread 100% Official data as "Working" if trusted.
  // Also used by the UI to show an informational note next to the
  // Target Basis control so nobody is left thinking a toggle that isn't
  // really differentiating anything yet is broken.
  function scenarioSchemaAvailable() {
    return !!(cache && cache.meta && typeof cache.meta.schemaVersion === 'number' && cache.meta.schemaVersion >= 3);
  }

  const STATE = {
    subTab: "executive",
    theme: "light", // platform default is light ("sun") mode across every workspace; unused today (no theme toggle wired in Sales), kept consistent for whenever one is added
    collapsedFilters: false,
    
    // Multi-select lists (arrays of indices, or "all")
    month: "all",
    line: "all",
    brand: "all",
    prod: "all",
    buhead: "all",
    nsm: "all",
    rm: "all",
    dm: "all",
    rep: "all",
    reg: "all",
    brick: "all",
    dist: "all",
    chain: "all",
    txtype: "all",
    position: "all",

    // Flag toggles ("all", true, false)
    isBulk: "all",
    // Defaults to false (Non-Tenders Only), not "all" (2026-07-29, per
    // Ahmed's request): several standalone KPI computations elsewhere in
    // this file (getBrandAchievement, getLinePerformance, etc.) already
    // unconditionally exclude tender rows -- "TENDER STATUS default
    // unselect tenders only" brings the main global filter's DEFAULT
    // view in line with that same convention. "All Transactions" and
    // "Tenders Only" both remain one dropdown click away.
    isTender: false,
    isOffer: "all",
    isUpa: "all",
    isMirror: "all",

    // Target Scenario (2026-08-04): "official" | "working". Set once at
    // init() from AUTH.getActiveScenario() (the user's role default, or
    // their own in-session selector choice if their role can toggle) --
    // never read ambiently by any aggregation function below, which all
    // take scenario as an explicit parameter instead (see
    // buildLineScenarioMap()). Changed only via setScenario(), which both
    // updates this and re-renders, exactly like every other STATE filter.
    scenario: "official"
  };

  // Helper to decompress Base64 gzipped cache
  function decompressCache() {
    if (decodedRows.length > 0) return;
    try {
      const t0 = performance.now();
      const b64 = window.SALES_CACHE.b64Data;
      const strData = atob(b64);
      const bytes = new Uint8Array(strData.length);
      for (let i = 0; i < strData.length; i++) {
        bytes[i] = strData.charCodeAt(i);
      }
      const decompressed = pako.ungzip(bytes, { to: 'string' });
      cache = JSON.parse(decompressed);
      decodedRows = cache.rows;

      // Fix data anomaly for Mahmoud Mohamed Gharib Farghaly:
      // His raw transactions in sales cache are mistakenly marked under 'DIAB-II' (line index),
      // but his true organizational line is 'ORTHO-II'.
      if (cache && cache.lookups && Array.isArray(decodedRows)) {
        const dms = cache.lookups.dms || [];
        const lines = cache.lookups.lines || [];
        const targetDmIdx = dms.indexOf("MAHMOUD MOHAMED GHARIB FARGHALY");
        const ortho2Idx = lines.indexOf("ORTHO-II");
        if (targetDmIdx >= 0 && ortho2Idx >= 0) {
          decodedRows.forEach(r => {
            if (r[DM] === targetDmIdx) {
              r[LINE] = ortho2Idx;
            }
          });
        }
      }

      // Target Scenario coverage (2026-08-04): hand the ETL's measured
      // per-line scenario coverage to the semantic layer, which resolves
      // fallback from it instead of a hardcoded line list. Done here --
      // once, right after decompression -- so every consumer sees it
      // before the first aggregation runs. A pre-coverage cache simply
      // passes undefined, and resolveScenario() degrades to honoring the
      // request untouched (pre-feature behavior).
      if (window.SEMANTIC && typeof window.SEMANTIC.setScenarioCoverage === "function") {
        window.SEMANTIC.setScenarioCoverage(cache.meta && cache.meta.scenarioCoverage);
      }
      _rollupExcludedIdx = null; // rebuild against this cache's line lookup

      console.log(`[Sales] Cache loaded & decompressed in ${(performance.now() - t0).toFixed(1)}ms. Rows: ${decodedRows.length}`);
    } catch (e) {
      console.error("[Sales] Failed to decompress sales cache", e);
    }
  }

  // Shown instead of the dashboard when cache/sales.json predates the
  // hierarchy-naming fix (see isCacheStale). Keeps the tab visible and
  // navigable while making it unmistakable that nothing is broken --
  // the corrected ETL just hasn't been run yet.
  function renderCachePendingState() {
    const root = document.getElementById("app-root");
    if (!root) return;
    root.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:center; min-height:calc(100vh - 140px); padding:24px;">
        <div style="max-width:520px; text-align:center; background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:40px 36px; box-shadow:0 1px 3px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.04);">
          <div style="width:56px; height:56px; margin:0 auto 20px; border-radius:14px; background:#eff6ff; display:flex; align-items:center; justify-content:center;">
            <svg width="28" height="28" fill="none" stroke="#0f4c81" stroke-width="1.8" viewBox="0 0 24 24"><path d="M4 4v16h16M4 15l4-4 4 3 6-7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div style="font-size:17px; font-weight:700; color:#0f172a; margin-bottom:8px;">Sales Performance — Cache Update Pending</div>
          <div style="font-size:13px; color:#64748b; line-height:1.6; margin-bottom:20px;">
            This tab's data cache predates the corrected commercial hierarchy
            (BU Head &rarr; NSM &rarr; RM &rarr; DM &rarr; Rep). Run
            <code style="background:#f1f5f9; padding:1px 6px; border-radius:4px; font-size:12px;">refresh_sales.py</code>
            (or <code style="background:#f1f5f9; padding:1px 6px; border-radius:4px; font-size:12px;">refresh.bat</code>)
            to regenerate <code style="background:#f1f5f9; padding:1px 6px; border-radius:4px; font-size:12px;">cache/sales.json</code> —
            this page will render automatically the next time it loads, no further changes needed.
          </div>
          <div style="display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:600; color:#b45309; background:#fffbeb; border:1px solid #fde68a; border-radius:20px; padding:5px 14px;">
            <span style="width:6px; height:6px; border-radius:50%; background:#f59e0b; display:inline-block;"></span>
            WAITING ON CACHE SCHEMA v${REQUIRED_SCHEMA_VERSION}
          </div>
        </div>
      </div>
    `;
  }

  // Check if row is allowed by global filters, with an optional field to ignore for dropdown cascading
  function isRowAllowed(r, ignoreKey = null) {
    const mask = r[MASK];
    const isMirror = (mask & 16) > 0;

    if (ignoreKey !== "month" && STATE.month !== "all" && !STATE.month.includes(r[MONTH])) return false;

    const rowLine = r[LINE];
    if (ignoreKey !== "line") {
      if (STATE.line === "all") {
        // Unscoped ("All Lines") totals exclude any line that doesn't
        // count in a BU/Corporate rollup -- CHC_SALES today, a second
        // channel view of CHC's own catalogue. This page has behaved this
        // way since 2026-07 via a hardcoded CHC_SALES index check; as of
        // 2026-08-04 it defers to SEMANTIC.countsInBuRollup() instead, so
        // this page and the Executive Command Center (which now applies
        // the same rule in its semantic interface) can never drift apart.
        // Explicitly selecting the line still includes it in full.
        if (rollupExcludedLineIdx().has(rowLine)) return false;
      } else {
        if (!STATE.line.includes(rowLine)) return false;
      }
    }
    // ROLE-BASED ACCESS SCOPE (2026-07-29): regardless of the user's own
    // filter selection (or the "all" default above), never surface rows
    // outside their permitted lines. Single choke point -- isRowAllowed()
    // gates both the main aggregator loop AND the cascading dropdown-
    // option builder (getFilteredLookupList()), so this scopes the whole
    // Sales workspace (data + filter options) in one place.
    if (window.AUTH && window.AUTH.getScope().lines !== null) {
      const rowLineName = cache.lookups.lines[rowLine];
      if (!window.AUTH.isLineAllowed(rowLineName)) return false;
    }
    if (ignoreKey !== "brand" && STATE.brand !== "all" && !STATE.brand.includes(r[BRAND])) return false;
    if (ignoreKey !== "prod" && STATE.prod !== "all" && !STATE.prod.includes(r[PROD])) return false;
    // Note: CM (Emp6/Commercial Manager, r[CM]) is intentionally not filterable —
    // single company-wide value, no analytical slicing power.

    // BU HEAD: "Non-Promoted" excluded from the default ("all") state
    // (2026-07-29, per Ahmed's request) -- same pattern as Line/CHC_SALES
    // above. Non-Promoted is out of commercial scope platform-wide (see
    // semantic-model.js's CONTEXT_SEGMENTS), so it shouldn't silently
    // inflate headline BU-level totals; it's still explicitly selectable
    // via the dropdown if someone specifically wants to look at it.
    const rowBuhead = r[BUHEAD];
    const nonPromotedIdx = cache && cache.lookups && cache.lookups.buheads ? cache.lookups.buheads.indexOf("Non-Promoted") : -1;
    if (ignoreKey !== "buhead") {
      if (STATE.buhead === "all") {
        if (nonPromotedIdx !== -1 && rowBuhead === nonPromotedIdx) return false;
      } else {
        if (!STATE.buhead.includes(rowBuhead)) return false;
      }
    }
    if (ignoreKey !== "nsm" && STATE.nsm !== "all" && !STATE.nsm.includes(r[NSM])) return false;
    if (ignoreKey !== "rm" && STATE.rm !== "all" && !STATE.rm.includes(r[RM])) return false;
    if (ignoreKey !== "dm" && STATE.dm !== "all" && !STATE.dm.includes(r[DM])) return false;
    if (ignoreKey !== "rep" && STATE.rep !== "all" && !STATE.rep.includes(r[REP])) return false;
    if (ignoreKey !== "reg" && STATE.reg !== "all" && !STATE.reg.includes(r[REG])) return false;
    if (ignoreKey !== "brick" && STATE.brick !== "all" && !STATE.brick.includes(r[BRICK])) return false;

    // Position filter (maps rep position list)
    if (ignoreKey !== "position" && STATE.position !== "all") {
      const repPos = cache.lookups.rep_positions[r[REP]];
      if (!STATE.position.includes(repPos)) return false;
    }

    // Only apply customer-level and transaction type filters to actual sales rows (not target rows)
    if (!isMirror) {
      if (ignoreKey !== "dist" && STATE.dist !== "all" && !STATE.dist.includes(r[DIST])) return false;
      if (ignoreKey !== "chain" && STATE.chain !== "all" && !STATE.chain.includes(r[CHAIN])) return false;
      if (ignoreKey !== "txtype" && STATE.txtype !== "all" && !STATE.txtype.includes(r[TXTYPE])) return false;

      const isBulk = (mask & 1) > 0;
      const isTender = (mask & 2) > 0;
      const isOffer = (mask & 4) > 0;
      const isUpa = (mask & 8) > 0;

      if (ignoreKey !== "isBulk" && STATE.isBulk !== "all" && isBulk !== STATE.isBulk) return false;
      if (ignoreKey !== "isTender" && STATE.isTender !== "all" && isTender !== STATE.isTender) return false;
      if (ignoreKey !== "isOffer" && STATE.isOffer !== "all" && isOffer !== STATE.isOffer) return false;
      if (ignoreKey !== "isUpa" && STATE.isUpa !== "all" && isUpa !== STATE.isUpa) return false;
    }

    return true;
  }

  // Get cascading lookup items matching active filters (ignoring the active stateKey filter list itself)
  function getFilteredLookupList(type, ignoreKey) {
    if (!cache) return [];

    if (type === "position") {
      const set = new Set();
      const rows = decodedRows;
      const len = rows.length;
      for (let i = 0; i < len; i++) {
        const r = rows[i];
        if (isRowAllowed(r, ignoreKey)) {
          const repPos = cache.lookups.rep_positions[r[REP]];
          if (repPos) set.add(repPos);
        }
      }
      return Array.from(set).map(name => ({ idx: name, name })).sort((a,b) => a.name.localeCompare(b.name));
    }

    const lookupKey = COLUMN_TO_LOOKUP[type];
    if (!lookupKey) return [];
    
    const set = new Set();
    const rows = decodedRows;
    const len = rows.length;

    for (let i = 0; i < len; i++) {
      const r = rows[i];
      if (isRowAllowed(r, ignoreKey)) {
        set.add(r[type]);
      }
    }
    const lookupArray = cache.lookups[lookupKey];
    return Array.from(set).map(idx => ({ idx, name: lookupArray[idx] || "" })).sort((a,b) => a.name.localeCompare(b.name));
  }

  // Core Aggregator
  function runAggregator() {
    decompressCache();
    const rows = decodedRows;
    const len = rows.length;
    
    let res = {
      salesValue: 0.0,
      salesQty: 0.0,
      tgtValue: 0.0,
      tgtQty: 0.0,
      transferQty: 0.0,
      bulkQty: 0.0,
      natCeiling: 0.0,
      regCeiling: 0.0,
      
      activeCusts: new Set(),
      activeReps: new Set(),
      activePositions: new Set(),
      activeDms: new Set(),
      activeRms: new Set(),
      activeNsms: new Set(),
      activeBuheads: new Set(),
      activeCms: new Set(),
      
      monthlyData: {},
      regionalData: {},
      brandData: {},
      buData: {},
      lineData: {},
      nsmData: {},
      dmData: {},
      prodData: {},
      chainData: {},
      distData: {},
      repData: {},
      txData: {},
      positionData: {},
      clusterData: {}
    };

    // Target Scenario (2026-08-04): resolved ONCE per line (not per row)
    // via buildLineScenarioMap(), which applies the CHC/CHC_SALES
    // fallback per SEMANTIC.resolveScenario(). The per-row check below
    // (includeTargetRow) is then a cheap O(1) mask test -- every one of
    // this function's many downstream buckets (monthlyData, regionalData,
    // brandData, buData, lineData, nsmData, dmData, prodData, chainData,
    // distData, repData, txData, positionData, clusterData) reads tqty/
    // tval AFTER this gate, so they all become scenario-aware for free
    // with no changes needed anywhere else in this function.
    const wantOfficialByLine = buildLineScenarioMap(STATE.scenario);

    for (let i = 0; i < len; i++) {
      const r = rows[i];
      if (!isRowAllowed(r)) continue;

      const mask = r[MASK];
      const includeTgt = includeTargetRow(mask, wantOfficialByLine[r[LINE]]);
      const qty = r[QTY];
      const val = r[VAL];
      const tqty = includeTgt ? r[TGT_QTY] : 0;
      const tval = includeTgt ? r[TGT_VAL] : 0;
      const tran = r[TRANS_QTY];
      const bulk = r[BULK_QTY];
      const nat = r[NAT_CEIL];
      const regc = r[REG_CEIL];

      res.salesValue += val;
      res.salesQty += qty;
      res.tgtValue += tval;
      res.tgtQty += tqty;
      res.transferQty += tran;
      res.bulkQty += bulk;
      res.natCeiling += nat;
      res.regCeiling += regc;

      if (r[REP] !== 0) res.activeReps.add(r[REP]);
      // SALES / POSITION denominator (2026-07-29, per Ahmed's request):
      // distinct deployed positions/territories with activity this
      // period, excluding placeholder Unknown/Vacant position codes (see
      // EXCLUDED_POSITIONS below) -- those aren't real assigned
      // territories, so counting them would understate per-territory
      // productivity. Their sales VALUE still counts in the numerator
      // (totalVal, unchanged) -- only the headcount denominator excludes
      // them.
      const rowPos = cache.lookups.rep_positions[r[REP]];
      if (rowPos && !EXCLUDED_POSITIONS.has(rowPos)) res.activePositions.add(rowPos);
      if (r[DM] !== 0) res.activeDms.add(r[DM]);
      if (r[RM] !== 0) res.activeRms.add(r[RM]);
      if (r[NSM] !== 0) res.activeNsms.add(r[NSM]);
      if (r[BUHEAD] !== 0) res.activeBuheads.add(r[BUHEAD]);
      if (r[CM] !== 0) res.activeCms.add(r[CM]);

      // Monthly aggregation
      const mIdx = r[MONTH];
      if (!res.monthlyData[mIdx]) res.monthlyData[mIdx] = { val: 0, qty: 0, tgtVal: 0, tgtQty: 0 };
      res.monthlyData[mIdx].val += val;
      res.monthlyData[mIdx].qty += qty;
      res.monthlyData[mIdx].tgtVal += tval;
      res.monthlyData[mIdx].tgtQty += tqty;

      // Regional
      // tgtVal/tgtQty added 2026-07-29 (Geography tab redesign attempt),
      // then found to be uniformly zero at this granularity -- verified
      // directly against the cache: every mirror/target row (TGT_VAL>0)
      // carries REG=0 ("(none)"), meaning targets are set at Line/Brand/
      // Product/Rep level only, never broken down by Region. Kept (not
      // reverted) since the field is honest -- it just always reads 0 --
      // and costs nothing; the Geography tab itself was corrected to a
      // contribution/concentration framing instead of achievement, since
      // that's the metric that's actually real here.
      const rIdx = r[REG];
      if (!res.regionalData[rIdx]) res.regionalData[rIdx] = { val: 0, qty: 0, tgtVal: 0, tgtQty: 0 };
      res.regionalData[rIdx].val += val;
      res.regionalData[rIdx].qty += qty;
      res.regionalData[rIdx].tgtVal += tval;
      res.regionalData[rIdx].tgtQty += tqty;

      // Customer commercial cluster (2026-07-29, Customer tab redesign) --
      // same SUBTYPE_TO_CLUSTER grouping the Executive Customer Channel
      // Mix KPI uses (getCustomerClusterMix), applied here so the Sales
      // tab's own Customer subtab respects the FULL current filter set
      // (getCustomerClusterMix is BU/Line-scoped only, built for the
      // Executive Command Center's narrower semantic interface).
      // tgtVal here has the SAME "always zero" property as regionalData
      // above (mirror rows carry STYPE=0 too) -- kept for the same
      // reason, unused by the Customer tab's own (concentration-based)
      // rendering.
      const rawSubType = cache.lookups.sub_types[r[STYPE]];
      const clusterName = subTypeToCluster(rawSubType);
      if (clusterName) {
        if (!res.clusterData[clusterName]) res.clusterData[clusterName] = { val: 0, qty: 0, tgtVal: 0 };
        res.clusterData[clusterName].val += val;
        res.clusterData[clusterName].qty += qty;
        res.clusterData[clusterName].tgtVal += tval;
      }

      // Brands
      // NOTE: tgtVal/tgtQty added 2026-07-26 -- this accumulator previously
      // only summed val/qty, so every downstream brandEntries.ach/.tgt read
      // (atRiskBrands, overBrands, Brand Performance Ranking, Target Gap by
      // Brand) was silently always 0/0% regardless of real performance.
      // Fixed to mirror lineData/monthlyData's existing tgtVal pattern below.
      const bIdx = r[BRAND];
      if (!res.brandData[bIdx]) res.brandData[bIdx] = { val: 0, qty: 0, tgtVal: 0, tgtQty: 0 };
      res.brandData[bIdx].val += val;
      res.brandData[bIdx].qty += qty;
      res.brandData[bIdx].tgtVal += tval;
      res.brandData[bIdx].tgtQty += tqty;

      // Products
      const pIdx = r[PROD];
      if (!res.prodData[pIdx]) res.prodData[pIdx] = { val: 0, qty: 0 };
      res.prodData[pIdx].val += val;
      res.prodData[pIdx].qty += qty;

      // Chains
      const cIdx = r[CHAIN];
      if (!res.chainData[cIdx]) res.chainData[cIdx] = { val: 0, qty: 0 };
      res.chainData[cIdx].val += val;
      res.chainData[cIdx].qty += qty;

      // Distributors
      const dIdx = r[DIST];
      if (!res.distData[dIdx]) res.distData[dIdx] = { val: 0, qty: 0 };
      res.distData[dIdx].val += val;
      res.distData[dIdx].qty += qty;

      // Representatives
      const repIdx = r[REP];
      if (!res.repData[repIdx]) res.repData[repIdx] = { val: 0, tgtVal: 0, qty: 0 };
      res.repData[repIdx].val += val;
      res.repData[repIdx].tgtVal += tval;
      res.repData[repIdx].qty += qty;

      // Product Lines
      const lnIdx = r[LINE];
      if (!res.lineData[lnIdx]) res.lineData[lnIdx] = { val: 0, qty: 0, tgtVal: 0, tgtQty: 0 };
      res.lineData[lnIdx].val    += val;
      res.lineData[lnIdx].qty    += qty;
      res.lineData[lnIdx].tgtVal += tval;
      res.lineData[lnIdx].tgtQty += tqty;

      // Business Units (BU Head level)
      const buIdx = r[BUHEAD];
      if (!res.buData[buIdx]) res.buData[buIdx] = { val: 0, qty: 0, tgtVal: 0 };
      res.buData[buIdx].val += val;
      res.buData[buIdx].qty += qty;
      res.buData[buIdx].tgtVal += tval;

      // NSM level
      const nsmIdx = r[NSM];
      if (!res.nsmData[nsmIdx]) res.nsmData[nsmIdx] = { val: 0, qty: 0, tgtVal: 0 };
      res.nsmData[nsmIdx].val += val;
      res.nsmData[nsmIdx].qty += qty;
      res.nsmData[nsmIdx].tgtVal += tval;

      // DM level
      const dmIdx = r[DM];
      if (!res.dmData[dmIdx]) res.dmData[dmIdx] = { val: 0, qty: 0, tgtVal: 0 };
      res.dmData[dmIdx].val += val;
      res.dmData[dmIdx].qty += qty;
      res.dmData[dmIdx].tgtVal += tval;

      // Transaction Types
      const txIdx = r[TXTYPE];
      if (!res.txData[txIdx]) res.txData[txIdx] = { val: 0, qty: 0 };
      res.txData[txIdx].val += val;
      res.txData[txIdx].qty += qty;
    }

    // Active customer resolution from active roster
    const custs = cache.customers;
    const clen = custs.length;
    for (let i = 0; i < clen; i++) {
      const c = custs[i];
      // Apply filters on customer entry (rep, brick, region, line)
      if (STATE.rep !== "all" && !STATE.rep.includes(c[1])) continue;
      if (STATE.brick !== "all" && !STATE.brick.includes(c[2])) continue;
      if (STATE.reg !== "all" && !STATE.reg.includes(c[3])) continue;
      if (STATE.line !== "all" && !STATE.line.includes(c[4])) continue;

      res.activeCusts.add(c[0]);
    }

    return res;
  }

  // --- Dynamic Searchable Multi-Select Dropdown Helper ---
  function renderSearchableDropdown(containerId, label, listType, stateKey) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Resolve active selection text
    const lookupKey = COLUMN_TO_LOOKUP[listType];
    const fullList = cache.lookups[lookupKey] || [];
    const activeSelection = STATE[stateKey];
    let selectionText = "All";
    if (Array.isArray(activeSelection)) {
      if (activeSelection.length === 0) selectionText = "None Selected";
      else if (activeSelection.length === 1) selectionText = fullList[activeSelection[0]] || "";
      else selectionText = `${activeSelection.length} Selected`;
    }

    // Render component skeleton
    container.innerHTML = `
      <div class="search-drop-wrap" style="position:relative; margin-bottom:8px;">
        <label style="font-size:10px; color:#64748b; font-weight:600; display:block; margin-bottom:3px;">${label}</label>
        <button class="search-drop-btn" style="background:#f8fafc; border:1px solid #e2e8f0; color:#0f172a; width:100%; font-size:11px; padding:6px 10px; border-radius:6px; text-align:left; display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
          <span>${selectionText}</span>
          <span style="font-size:8px;">▼</span>
        </button>
        <div class="search-drop-menu" style="display:none; position:absolute; top:42px; left:0; width:100%; background:#fff; border:1px solid #e2e8f0; border-radius:8px; z-index:999; padding:10px; box-shadow:0 8px 24px rgba(15,23,42,0.12);">
          <input type="text" placeholder="Search..." class="search-drop-input" style="width:100%; background:#f8fafc; border:1px solid #e2e8f0; color:#0f172a; font-size:11px; padding:5px 8px; border-radius:5px; margin-bottom:8px; box-sizing:border-box;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:10px;">
            <span class="search-drop-all" style="color:#0f4c81; cursor:pointer; font-weight:600;">Select All</span>
            <span class="search-drop-clear" style="color:#94a3b8; cursor:pointer; font-weight:600;">Clear</span>
          </div>
          <div class="search-drop-list" style="max-height:150px; overflow-y:auto; font-size:11px; display:flex; flex-direction:column; gap:4px;">
            <!-- Options populated here -->
          </div>
        </div>
      </div>
    `;

    // Dropdown toggle logic
    const btn = container.querySelector(".search-drop-btn");
    const menu = container.querySelector(".search-drop-menu");
    const input = container.querySelector(".search-drop-input");
    const listDiv = container.querySelector(".search-drop-list");
    const selectAllBtn = container.querySelector(".search-drop-all");
    const clearBtn = container.querySelector(".search-drop-clear");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Close other menus first
      document.querySelectorAll(".search-drop-menu").forEach(m => { if (m !== menu) m.style.display = "none"; });
      menu.style.display = (menu.style.display === "none") ? "block" : "none";
      if (menu.style.display === "block") {
        input.value = "";
        populateList("");
        input.focus();
      }
    });

    // Close when clicking outside
    document.addEventListener("click", () => { menu.style.display = "none"; });
    menu.addEventListener("click", (e) => { e.stopPropagation(); });

    // Populate filter list
    function populateList(query) {
      const availableItems = getFilteredLookupList(listType, stateKey);
      
      const filtered = availableItems.filter(item => item.name.toLowerCase().includes(query.toLowerCase()));
      
      if (filtered.length === 0) {
        listDiv.innerHTML = `<div style="color:#94a3b8; font-style:italic; padding:4px;">No items found</div>`;
        return;
      }

      // Values excluded from the default ("all") checked state -- picked
      // by name, not hardcoded index, so this survives the lookup array
      // being reordered by a future cache refresh. Add an entry here (not
      // a copy-pasted if/else branch) for any future stateKey that needs
      // the same treatment. Line/CHC_SALES was the original case (BU
      // Sales Rep channel double-counting a BU's Pharmacy-channel line);
      // BU Head/Non-Promoted added 2026-07-29 per Ahmed's request --
      // Non-Promoted is out of commercial scope platform-wide (see
      // semantic-model.js's CONTEXT_SEGMENTS) so it shouldn't silently
      // inflate headline BU-level totals by default.
      const DEFAULT_EXCLUDED_VALUE = { line: "CHC_SALES", buhead: "Non-Promoted" };
      function getDefaultExcludedIdx(key) {
        const name = DEFAULT_EXCLUDED_VALUE[key];
        if (!name || !cache || !cache.lookups) return -1;
        const lookupKey = COLUMN_TO_LOOKUP[
          key === "line" ? LINE : key === "buhead" ? BUHEAD : -1
        ];
        const list = lookupKey ? cache.lookups[lookupKey] : null;
        return list ? list.indexOf(name) : -1;
      }

      listDiv.innerHTML = filtered.map(item => {
        let isChecked;
        if (STATE[stateKey] === "all") {
          const excludedIdx = getDefaultExcludedIdx(stateKey);
          isChecked = (excludedIdx === -1 || item.idx !== excludedIdx);
        } else {
          isChecked = STATE[stateKey].includes(item.idx);
        }

        return `
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; color:#0f172a; padding:2px 0; font-size:11px;">
            <input type="checkbox" value="${item.idx}" ${isChecked ? 'checked' : ''} style="accent-color:#0f4c81; margin:0;">
            <span>${item.name}</span>
          </label>
        `;
      }).join('');

      // Add change listeners to checkboxes
      listDiv.querySelectorAll("input").forEach(cb => {
        cb.addEventListener("change", () => {
          const idx = (stateKey === "position") ? cb.value : parseInt(cb.value, 10);
          let currentSelection = STATE[stateKey];

          if (currentSelection === "all") {
            // Convert to explicit selection -- start from what was actually
            // checked (respects the default-excluded value above), not the
            // raw available list, otherwise the excluded item would sneak
            // back in as soon as the user toggles any OTHER checkbox.
            const excludedIdx = getDefaultExcludedIdx(stateKey);
            currentSelection = availableItems.map(x => x.idx).filter(i => i !== excludedIdx);
          }

          if (cb.checked) {
            if (!currentSelection.includes(idx)) currentSelection.push(idx);
          } else {
            currentSelection = currentSelection.filter(x => x !== idx);
          }

          // If all items are selected or empty, reset to "all"
          if (currentSelection.length === availableItems.length) {
            STATE[stateKey] = "all";
          } else {
            STATE[stateKey] = currentSelection;
          }

          triggerFilterUpdate(stateKey);
        });
      });
    }

    // Search input handler
    input.addEventListener("input", (e) => {
      populateList(e.target.value);
    });

    // Select All handler
    selectAllBtn.addEventListener("click", () => {
      STATE[stateKey] = "all";
      triggerFilterUpdate(stateKey);
    });

    // Clear handler
    clearBtn.addEventListener("click", () => {
      STATE[stateKey] = [];
      triggerFilterUpdate(stateKey);
    });
  }

  function triggerFilterUpdate(key) {
    // Cascade: BUHEAD -> NSM -> RM -> DM -> REP. CM (Emp6) has no filter, so no cascade entry.
    if (key === "buhead") { STATE.nsm = "all"; STATE.rm = "all"; STATE.dm = "all"; STATE.rep = "all"; }
    if (key === "nsm") { STATE.rm = "all"; STATE.dm = "all"; STATE.rep = "all"; }
    if (key === "rm") { STATE.dm = "all"; STATE.rep = "all"; }
    if (key === "dm") { STATE.rep = "all"; }
    if (key === "line") { STATE.brand = "all"; STATE.prod = "all"; }
    if (key === "brand") { STATE.prod = "all"; }

    if (window.AskEngine && window.AskEngine.AskContext) {
      window.AskEngine.AskContext.clear();
    }
    renderLayout();
  }

  // --- Dynamic Business AI Narrative ---
  function getStrategicNarrative(res) {
    const actual = res.salesValue;
    const target = res.tgtValue;
    const ach = target > 0 ? (actual / target) * 100 : 0;

    const sortedBrands = Object.entries(res.brandData).map(([idx, val]) => ({
      name: cache.lookups.brands[idx] || "Unknown",
      val: val.val
    })).sort((a,b) => b.val - a.val);

    const topBrandStr = sortedBrands[0] ? `${sortedBrands[0].name} (EGP ${formatM(sortedBrands[0].val)})` : "N/A";
    const statusText  = ach >= 95 ? "exceeding commercial objectives" : ach >= 80 ? "within acceptable range but below threshold" : "below target — requires management intervention";
    const achColor    = ach >= 95 ? '#15803d' : ach >= 80 ? '#b45309' : '#b91c1c';
    const achBg       = ach >= 95 ? '#f0fdf4' : ach >= 80 ? '#fffbeb' : '#fef2f2';

    return `
      <div class="sc-ai-panel" style="margin-top:20px;">
        <div class="sc-ai-header">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:32px; height:32px; background:linear-gradient(135deg,#0f4c81,#3b82f6); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0;">✦</div>
            <div>
              <div style="font-size:14px; font-weight:700; color:#0f172a;">AI Executive Insights</div>
              <div style="font-size:11px; color:#64748b; margin-top:1px;">Dynamic commercial intelligence · Auto-generated</div>
            </div>
          </div>
          <div style="background:${achBg}; border:1px solid ${achColor}30; border-radius:8px; padding:8px 16px; text-align:center;">
            <div style="font-size:9px; font-weight:700; color:${achColor}; text-transform:uppercase; letter-spacing:0.08em;">Achievement</div>
            <div style="font-size:22px; font-weight:800; color:${achColor};">${ach.toFixed(1)}%</div>
          </div>
        </div>
        <div class="sc-ai-body">
          <div class="sc-ai-card sc-ai-status">
            <div class="sc-ai-card-label">📋 Business Status</div>
            <p>Commercial performance stands at <strong>${ach.toFixed(1)}% target achievement</strong>, ${statusText}. The top revenue driver is <strong>${topBrandStr}</strong>, holding the highest share of total sales value in the current period.</p>
          </div>
          <div class="sc-ai-card sc-ai-risk">
            <div class="sc-ai-card-label">⚠ Risk Signals</div>
            <p>Elevated return rates in peripheral bricks are creating inventory pipeline risk. If regional ceilings are reached prematurely, secondary line execution may stall. Distributor fulfillment requires active monitoring.</p>
          </div>
          <div class="sc-ai-card sc-ai-action">
            <div class="sc-ai-card-label">⚡ Priority Actions</div>
            <ol style="margin:0; padding-left:16px; line-height:1.8;">
              <li>Reallocate ceiling balances to highest-performing territories</li>
              <li>Issue performance alerts to DMs below 85% target achievement</li>
              <li>Deploy focused pharmacy promotions in at-risk bricks</li>
            </ol>
          </div>
        </div>
      </div>
    `;
  }

  // Formatting utilities
  function formatM(val) {
    if (val >= 1000000) return (val / 1000000).toFixed(2) + "M";
    if (val >= 1000) return (val / 1000).toFixed(1) + "K";
    return val.toFixed(0);
  }

  // --- SVG Vector Region Map Helper ---
  function getSVGMapHTML(res) {
    // Dynamically calculate region shares to update path colors
    const regions = res.regionalData;
    const totalVal = res.salesValue || 1.0;
    
    // Normalize region fills ( Cairo=index 0, Delta=index 1, Upper Egypt=index 2, Alexandria=index 3, Giza=index 4, etc. depending on lookups )
    // We map lookup names dynamically
    let cairoShare = 0, deltaShare = 0, upperShare = 0, alexShare = 0;
    Object.entries(regions).forEach(([idx, data]) => {
      const name = (cache.lookups.regions[idx] || "").toLowerCase();
      const share = data.val / totalVal;
      if (name.includes("cairo")) cairoShare = share;
      else if (name.includes("delta")) deltaShare = share;
      else if (name.includes("upper") || name.includes("south")) upperShare = share;
      else if (name.includes("alex")) alexShare = share;
    });

    const getHexColor = (share) => {
      if (share > 0.3) return "#0F6CBD"; // High Share
      if (share > 0.1) return "#2C81C8"; // Medium Share
      if (share > 0.01) return "#67A6DE"; // Low Share
      return "#e2e8f0"; // Minimal Share / Empty
    };

    return `
      <div style="display:flex; gap:16px; align-items:center; background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
        <div style="flex:1; max-width:280px;">
          <svg viewBox="0 0 300 240" style="width:100%; height:auto;">
            <!-- Delta / Alexandria -->
            <path d="M 60,40 L 140,20 L 220,50 L 180,90 L 100,80 Z" fill="${getHexColor(deltaShare)}" stroke="#f8fafc" stroke-width="2" class="map-path" data-name="Delta &amp; Alex" style="cursor:pointer; transition: fill 0.3s;"></path>
            <!-- Cairo Metro -->
            <circle cx="160" cy="110" r="28" fill="${getHexColor(cairoShare)}" stroke="#f8fafc" stroke-width="2" class="map-path" data-name="Cairo Metro" style="cursor:pointer; transition: fill 0.3s;"></circle>
            <!-- Upper Egypt -->
            <path d="M 120,120 L 200,120 L 210,220 L 130,210 Z" fill="${getHexColor(upperShare)}" stroke="#f8fafc" stroke-width="2" class="map-path" data-name="Upper Egypt" style="cursor:pointer; transition: fill 0.3s;"></path>
          </svg>
        </div>
        <div style="flex:1;">
          <h4 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:8px;">Egypt Regional Value Share</h4>
          <div style="display:flex; flex-direction:column; gap:6px; font-size:11px;">
            <div style="display:flex; align-items:center; gap:8px;"><span style="display:inline-block; width:12px; height:12px; background:#0F6CBD; border-radius:2px;"></span> Cairo Metro: ${(cairoShare*100).toFixed(1)}%</div>
            <div style="display:flex; align-items:center; gap:8px;"><span style="display:inline-block; width:12px; height:12px; background:#2C81C8; border-radius:2px;"></span> Delta &amp; Alexandria: ${(deltaShare*100).toFixed(1)}%</div>
            <div style="display:flex; align-items:center; gap:8px;"><span style="display:inline-block; width:12px; height:12px; background:#67A6DE; border-radius:2px;"></span> Upper Egypt: ${(upperShare*100).toFixed(1)}%</div>
          </div>
        </div>
      </div>
    `;
  }

  // res.monthlyData / res.dmData / etc. are keyed by the numeric lookup
  // INDEX (0,1,2...), not the "2026-01" string itself -- that string only
  // lives at cache.lookups.months[idx]. Every chart that labels an axis
  // with months must resolve through this lookup first, or it prints the
  // raw index (e.g. "0","1","2" instead of "Jan","Feb","Mar").
  const MONTH_SHORT_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function monthIndexToLabel(idx) {
    const monthStr = (cache && cache.lookups && cache.lookups.months) ? cache.lookups.months[idx] : null;
    if (!monthStr) return String(idx);
    const monthNum = parseInt(monthStr.split("-")[1], 10);
    return MONTH_SHORT_NAMES[monthNum - 1] || monthStr;
  }

  // --- Client-Side Analytics Algorithms (Page 10) ---
  function computeForecastData(res) {
    // Generate exponential smoothing forecast for next 3 periods
    const sortedMonths = Object.keys(res.monthlyData).sort();
    const actuals = sortedMonths.map(m => res.monthlyData[m].val);
    if (actuals.length < 3) return { labels: ["Month +1", "Month +2"], values: [0, 0] };

    // Simple Exponential Smoothing (alpha = 0.4)
    const alpha = 0.4;
    let level = actuals[0];
    for (let i = 1; i < actuals.length; i++) {
      level = alpha * actuals[i] + (1 - alpha) * level;
    }

    const labels = ["Jul Forecast", "Aug Forecast", "Sep Forecast"];
    const values = [level, level * 1.02, level * 1.04];
    return { labels, values };
  }


  // ── Dynamic Commercial Intelligence Engine ──────────────────────────────────
  // Computes real business insights from aggregated data. Called once per render.
  function computeInsights(res) {
    const totalVal  = res.salesValue  || 0;
    const totalTgt  = res.tgtValue    || 1;
    const ach       = (totalVal / totalTgt) * 100;

    // Monthly performance analysis
    const months    = cache.lookups.months || [];
    const mEntries  = Object.entries(res.monthlyData)
      .map(([idx, d]) => ({ month: months[idx] || `M${idx}`, val: d.val, tgt: d.tgtVal,
                             ach: d.tgtVal > 0 ? (d.val / d.tgtVal) * 100 : 0,
                             gap: d.val - d.tgtVal }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const bestMonth  = mEntries.reduce((a, b) => b.ach > a.ach ? b : a, mEntries[0] || {});
    const worstMonth = mEntries.reduce((a, b) => b.ach < a.ach ? b : a, mEntries[0] || {});

    // Month-over-month trend
    let momTrend = 'stable';
    if (mEntries.length >= 2) {
      const last = mEntries[mEntries.length - 1].ach;
      const prev = mEntries[mEntries.length - 2].ach;
      momTrend = last > prev + 3 ? 'accelerating' : last < prev - 3 ? 'decelerating' : 'stable';
    }

    // Brand analysis
    const brands = cache.lookups.brands || [];
    const brandEntries = Object.entries(res.brandData)
      .map(([idx, d]) => ({
        name: brands[idx] || 'Unknown',
        val: d.val, tgt: d.tgtVal || 0,
        ach: d.tgtVal > 0 ? (d.val / d.tgtVal) * 100 : 0,
        share: totalVal > 0 ? (d.val / totalVal) * 100 : 0,
        gap: d.val - (d.tgtVal || 0)
      }))
      .filter(b => b.val > 0)
      .sort((a, b) => b.val - a.val);

    const topBrand   = brandEntries[0] || { name: 'N/A', val: 0, ach: 0 };
    const atRiskBrands = brandEntries.filter(b => b.tgt > 0 && b.ach < 80)
      .sort((a, b) => a.gap - b.gap); // most negative first
    const overBrands   = brandEntries.filter(b => b.tgt > 0 && b.ach >= 110)
      .sort((a, b) => b.ach - a.ach);

    // Line analysis
    const lines = cache.lookups.lines || [];
    const lineEntries = Object.entries(res.brandData.lines || {});

    // Rep performance
    const repEntries = Object.entries(res.repData)
      .filter(([idx]) => res.activeReps.has(parseInt(idx)))
      .map(([idx, d]) => ({ ach: d.tgtVal > 0 ? (d.val / d.tgtVal) * 100 : null }))
      .filter(d => d.ach !== null);
    const repsBelow80  = repEntries.filter(r => r.ach < 80).length;
    const repsAbove100 = repEntries.filter(r => r.ach >= 100).length;
    const repsTotal    = repEntries.length;

    // Distributor concentration
    const dists = cache.lookups.distributors || [];
    const distEntries = Object.entries(res.distData)
      .map(([idx, d]) => ({ name: dists[idx] || 'Unknown', val: d.val,
                             share: totalVal > 0 ? (d.val / totalVal) * 100 : 0 }))
      .sort((a, b) => b.val - a.val);
    const topDist = distEntries[0] || { name: 'N/A', share: 0 };

    // Bulk concentration
    const bulkRows   = res.bulkQty  || 0;
    const bulkVal    = Object.values(res.txData || {}).reduce((s, d) => s, 0);

    // Return rate
    const returnVal = totalVal < 0 ? Math.abs(totalVal) : 0;

    // Region analysis
    const regions = cache.lookups.regions || [];
    const regEntries = Object.entries(res.regionalData)
      .map(([idx, d]) => ({ name: regions[idx] || 'Unknown', val: d.val,
                             share: totalVal > 0 ? (d.val / totalVal) * 100 : 0 }))
      .filter(r => r.name !== '(none)' && r.val > 0)
      .sort((a, b) => b.val - a.val);
    const topRegion = regEntries[0] || { name: 'N/A', share: 0 };

    // Cumulative gap
    const totalGap   = totalVal - totalTgt;
    const gapFmt     = (g) => (g >= 0 ? '+' : '') + 'EGP ' + formatM(Math.abs(g)) + (g >= 0 ? ' above' : ' below') + ' target';

    // Health score (composite 0-100)
    const achScore   = Math.min(ach / 100, 1.3) * 40;                                         // 40 pts
    const repScore   = repsTotal > 0 ? ((repsTotal - repsBelow80) / repsTotal) * 30 : 15;    // 30 pts
    const concScore  = topDist.share < 50 ? 20 : topDist.share < 70 ? 12 : 5;               // 20 pts
    const trendScore = momTrend === 'accelerating' ? 10 : momTrend === 'stable' ? 6 : 2;     // 10 pts
    const healthScore = Math.min(100, Math.round(achScore + repScore + concScore + trendScore));
    const healthColor = healthScore >= 80 ? '#15803d' : healthScore >= 60 ? '#b45309' : '#b91c1c';
    const healthLabel = healthScore >= 80 ? 'STRONG' : healthScore >= 60 ? 'AT RISK' : 'CRITICAL';

    return {
      ach, totalVal, totalTgt, totalGap,
      mEntries, bestMonth, worstMonth, momTrend,
      brandEntries, topBrand, atRiskBrands, overBrands,
      repsBelow80, repsAbove100, repsTotal,
      topDist, distEntries,
      topRegion, regEntries,
      healthScore, healthColor, healthLabel,
      gapFmt
    };
  }

  // Main UI Renderer
  function renderLayout() {
    const res = runAggregator();
    destroyCharts();

    const root = document.getElementById("app-root");
    if (!root) return;

    const actual = res.salesValue;
    const target = res.tgtValue;
    const ach = target > 0 ? (actual / target) * 100 : 0;
    const achColor = ach >= 95 ? '#15803d' : ach >= 80 ? '#b45309' : '#b91c1c';
    const achBg   = ach >= 95 ? '#f0fdf4' : ach >= 80 ? '#fffbeb' : '#fef2f2';

    // Target Scenario (2026-08-04): role-gated selector, not a global
    // toggle everyone sees -- AUTH.canToggleScenario() renders nothing at
    // all (not a disabled control) for roles locked to their default, so
    // a Line Manager's UI never implies a choice exists. Roles without
    // toggle rights still see their current basis as a plain label, so
    // nobody is left wondering what number they're looking at.
    const canToggleScenario = !!(window.AUTH && typeof window.AUTH.canToggleScenario === "function" && window.AUTH.canToggleScenario());
    const scenarioMeta = (window.SEMANTIC && window.SEMANTIC.TARGET_SCENARIOS[STATE.scenario]) || { label: "Official Target" };
    // 2026-08-04 same-day fix: while the cache hasn't been refreshed
    // under v3 yet, Official and Working both read identical (Official)
    // data -- see scenarioSchemaAvailable()/includeTargetRow(). Surface
    // that plainly next to the control rather than let it look broken.
    const scenarioNoteHtml = !scenarioSchemaAvailable() ? `
        <div style="font-size:9px; color:#b45309; margin-top:3px; max-width:170px; line-height:1.35;">Working Target activates after the next cache refresh</div>
      ` : '';
    const scenarioControlHtml = canToggleScenario ? `
      <div style="display:flex; flex-direction:column; align-items:flex-start; gap:2px;">
        <span style="font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#64748b;">Target Basis</span>
        <select id="select-scenario" class="sc-select" style="width:auto; min-width:150px; height:28px; padding:2px 8px;">
          <option value="official" ${STATE.scenario==='official'?'selected':''}>Official Target</option>
          <option value="working" ${STATE.scenario==='working'?'selected':''}>Working Target</option>
        </select>
        ${scenarioNoteHtml}
      </div>
    ` : `
      <div style="display:flex; flex-direction:column; align-items:flex-start; gap:2px; background:#f1f5f9; border-radius:8px; padding:5px 12px;">
        <span style="font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#64748b;">Target Basis</span>
        <span style="font-size:12px; font-weight:700; color:#0f172a;">${scenarioMeta.label}</span>
        ${scenarioNoteHtml}
      </div>
    `;

    root.innerHTML = `
      <div class="sc-shell" style="display:flex; background:#f8fafc; color:#0f172a; font-family:'Inter','Outfit',system-ui,sans-serif; min-height:calc(100vh - 70px);">

        <!-- ── LEFT FILTER PANEL ── -->
        <div id="sales-filter-panel" class="sc-filter-panel" style="
          width:${STATE.collapsedFilters ? '0px' : '256px'};
          min-width:${STATE.collapsedFilters ? '0px' : '256px'};
          overflow:hidden;
          background:#fff;
          border-right:1px solid #e2e8f0;
          padding:${STATE.collapsedFilters ? '0' : '20px 16px'};
          transition:all 0.25s cubic-bezier(0.4,0,0.2,1);
          box-sizing:border-box;
          overflow-y:auto;
        ">
          <div style="display:${STATE.collapsedFilters ? 'none' : 'block'}; opacity:${STATE.collapsedFilters ? '0' : '1'};">

            <!-- Panel Header -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
              <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#64748b;">Analysis Filters</span>
              <button id="sales-preset-reset" style="background:none; border:1px solid #fca5a5; color:#dc2626; font-size:10px; font-weight:600; padding:3px 8px; border-radius:6px; cursor:pointer; letter-spacing:0.02em;">Reset All</button>
            </div>

            <!-- Saved Views -->
            <div style="display:flex; gap:6px; margin-bottom:14px;">
              <button id="sales-preset-save" style="flex:1; background:#0f4c81; color:#fff; border:none; font-size:10px; font-weight:600; padding:6px; border-radius:6px; cursor:pointer;">Save View</button>
              <button id="sales-preset-load" style="flex:1; background:#f1f5f9; color:#334155; border:1px solid #e2e8f0; font-size:10px; font-weight:600; padding:6px; border-radius:6px; cursor:pointer;">Load View</button>
            </div>

            <!-- Date Shortcuts -->
            <!-- LTM button replaced 2026-07-29 with a proper Month multi-select
                 (per Ahmed's request) -- driven by cache.lookups.months via
                 renderSearchableDropdown, same mechanism as every other filter
                 here, so it's dynamic: whatever months are actually in the
                 refreshed cache show up automatically, no hardcoded list to
                 maintain as new months get added. -->
            <div style="margin-bottom:14px;">
              <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:6px;">Period</div>
              <button class="sales-date-shortcut sc-period-btn" data-type="ytd" style="width:100%; margin-bottom:8px;">YTD</button>
              <div id="drop-month"></div>
            </div>

            <div class="sc-filter-sep"></div>

            <!-- Hierarchy Filters -->
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:8px;">Organization</div>
            <!-- CM (Emp6/Commercial Manager) intentionally has no filter control: single company-wide value -->
            <div id="drop-buhead"></div>
            <div id="drop-nsm"></div>
            <div id="drop-rm"></div>
            <div id="drop-dm"></div>
            <div id="drop-rep"></div>

            <div class="sc-filter-sep"></div>

            <!-- Product Filters -->
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:8px;">Product</div>
            <div id="drop-line"></div>
            <div id="drop-brand"></div>
            <div id="drop-prod"></div>

            <div class="sc-filter-sep"></div>

            <!-- Geography Filters -->
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:8px;">Geography</div>
            <div id="drop-reg"></div>
            <div id="drop-brick"></div>

            <div class="sc-filter-sep"></div>

            <!-- Channel Filters -->
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:8px;">Channel</div>
            <div id="drop-dist"></div>
            <div id="drop-chain"></div>
            <div id="drop-txtype"></div>
            <div id="drop-position"></div>

            <div class="sc-filter-sep"></div>

            <!-- Boolean Flags -->
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:8px;">Transaction Flags</div>
            <div style="margin-bottom:8px;">
              <label style="font-size:10px; color:#64748b; font-weight:600; display:block; margin-bottom:4px;">TENDER STATUS</label>
              <select id="select-tender" class="sc-select">
                <option value="all" ${STATE.isTender==='all'?'selected':''}>All Transactions</option>
                <option value="true" ${STATE.isTender===true?'selected':''}>Tenders Only</option>
                <option value="false" ${STATE.isTender===false?'selected':''}>Non-Tenders Only</option>
              </select>
            </div>
            <div style="margin-bottom:8px;">
              <label style="font-size:10px; color:#64748b; font-weight:600; display:block; margin-bottom:4px;">BULK STATUS</label>
              <select id="select-bulk" class="sc-select">
                <option value="all" ${STATE.isBulk==='all'?'selected':''}>All Transactions</option>
                <option value="true" ${STATE.isBulk===true?'selected':''}>Bulk Only</option>
                <option value="false" ${STATE.isBulk===false?'selected':''}>Non-Bulk Only</option>
              </select>
            </div>
          </div>
        </div>

        <!-- ── MAIN WORKSPACE ── -->
        <div style="flex:1; min-width:0; display:flex; flex-direction:column;">

          <!-- Top Command Bar -->
          <div class="sc-topbar">
            <div style="display:flex; align-items:center; gap:12px;">
              <button id="toggle-filters-btn" class="sc-icon-btn" title="${STATE.collapsedFilters ? 'Show Filters' : 'Hide Filters'}">
                ${STATE.collapsedFilters ? '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h7"/></svg>' : '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'}
              </button>
              <div>
                <div style="font-size:17px; font-weight:700; color:#0f172a; line-height:1.2;">Sales Performance</div>
                <div style="font-size:11px; color:#64748b; font-weight:500; margin-top:1px;">Commercial Analytics · Zeta Pharmaceutical</div>
              </div>
            </div>

            <!-- Achievement Badge -->
            <div style="display:flex; align-items:center; gap:10px;">
              ${scenarioControlHtml}
              <div style="background:${achBg}; border:1px solid ${achColor}20; border-radius:10px; padding:6px 14px; text-align:center;">
                <div style="font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:${achColor}; margin-bottom:1px;">Target Achievement</div>
                <div style="font-size:20px; font-weight:800; color:${achColor}; line-height:1;">${ach.toFixed(1)}%</div>
              </div>
              <div style="display:flex; gap:6px;">
                <button class="sales-export-btn sc-action-btn" data-type="csv">⬇ CSV</button>
                <button class="sales-export-btn sc-action-btn" data-type="pdf">⬇ PDF</button>
                <button class="sales-export-btn sc-action-btn" data-type="png">⬇ PNG</button>
              </div>
            </div>
          </div>

          <!-- Sub-Tab Navigation -->
          <div class="sc-nav-tabs">
            ${[
              ['executive',   '📊 Executive'],
              ['line',        '📋 Line P&L'],
              ['geography',   '🗺 Geography'],
              ['product',     '💊 Product'],
              ['customer',    '🏥 Customer'],
              ['distributor', '🏭 Distributor'],
              ['salesforce',  '👥 Sales Force'],
              ['target',      '🎯 Target'],
              ['advanced',    '🧠 Advanced'],
            ].map(([key, label]) => `
              <button class="sc-tab ${STATE.subTab===key?'sc-tab-active':''}" data-tab="${key}">${label}</button>
            `).join('')}
          </div>

          <!-- Page Content -->
          <div style="flex:1; padding:24px; overflow-y:auto;">
            <div id="sales-tab-content">
              ${getPageContentHTML(res)}
            </div>
            ${getStrategicNarrative(res)}
          </div>
        </div>
      </div>
    `;

    // Render dropdown inputs (5-level hierarchy mapping)
    renderSearchableDropdown("drop-month", "MONTH", MONTH, "month");
    renderSearchableDropdown("drop-buhead", "BU HEAD", BUHEAD, "buhead");
    renderSearchableDropdown("drop-nsm", "NSM", NSM, "nsm");
    renderSearchableDropdown("drop-rm", "RM (REGIONAL MANAGER)", RM, "rm");
    renderSearchableDropdown("drop-dm", "DM (DISTRICT MANAGER)", DM, "dm");
    renderSearchableDropdown("drop-rep", "MEDICAL REP", REP, "rep");
    
    renderSearchableDropdown("drop-line", "LINE", LINE, "line");
    renderSearchableDropdown("drop-brand", "BRAND", BRAND, "brand");
    renderSearchableDropdown("drop-prod", "ITEM (PRODUCT)", PROD, "prod");
    
    renderSearchableDropdown("drop-reg", "REGION", REG, "reg");
    renderSearchableDropdown("drop-brick", "BRICK", BRICK, "brick");
    renderSearchableDropdown("drop-dist", "DISTRIBUTOR", DIST, "dist");
    renderSearchableDropdown("drop-chain", "CHAIN", CHAIN, "chain");
    renderSearchableDropdown("drop-txtype", "TRANSACTION TYPE", TXTYPE, "txtype");
    renderSearchableDropdown("drop-position", "EMPLOYEE POSITION", "position", "position");

    // Bind event hooks
    bindEvents();
    renderPageCharts(res);
  }

  // Switch Sub-tabs content HTML
  function getPageContentHTML(res) {
    const totalVal = res.salesValue;
    const totalQty = res.salesQty;
    const target = res.tgtValue;
    const ach = target > 0 ? (totalVal / target) * 100 : 0;
    
    // KPI Cards computations
    const activeEmpNames = new Set();
    if (res.activeReps) res.activeReps.forEach(idx => { const n = cache.lookups.reps[idx]; if (n && n !== "(none)") activeEmpNames.add(n); });
    if (res.activeDms) res.activeDms.forEach(idx => { const n = cache.lookups.dms[idx]; if (n && n !== "(none)") activeEmpNames.add(n); });
    if (res.activeRms) res.activeRms.forEach(idx => { const n = cache.lookups.rms[idx]; if (n && n !== "(none)") activeEmpNames.add(n); });
    if (res.activeNsms) res.activeNsms.forEach(idx => { const n = cache.lookups.nsms[idx]; if (n && n !== "(none)") activeEmpNames.add(n); });
    if (res.activeBuheads) res.activeBuheads.forEach(idx => { const n = cache.lookups.buheads[idx]; if (n && n !== "(none)") activeEmpNames.add(n); });
    // CM (res.activeCms / cache.lookups.cms) intentionally excluded — not filterable, not shown in this panel.

    const activeEmpsCount = activeEmpNames.size || 1;
    // SALES / POSITION (2026-07-29, redefined from "sales / distinct rep
    // name" per Ahmed's request): denominator is distinct deployed
    // positions/territories (res.activePositions, EXCLUDED_POSITIONS
    // filtered out during aggregation), numerator is totalVal unchanged
    // -- ALL sales value counts, including any attributed to excluded
    // positions, since only the headcount denominator is affected.
    const activePositionsCount = res.activePositions.size || 1;
    const salesPerPosition = totalVal / activePositionsCount;
    const salesPerCust = res.activeCusts.size > 0 ? totalVal / res.activeCusts.size : 0;
    const asp = totalQty > 0 ? totalVal / totalQty : 0;

    const achColor = ach >= 95 ? '#15803d' : ach >= 80 ? '#b45309' : '#b91c1c';
    const achBg   = ach >= 95 ? '#f0fdf4' : ach >= 80 ? '#fffbeb' : '#fef2f2';

    const kpiRowHTML = `
      <div class="sc-kpi-grid">
        <div class="sc-kpi-card">
          <div class="sc-kpi-label">SALES VALUE</div>
          <div class="sc-kpi-value">EGP ${formatM(totalVal)}</div>
          <div class="sc-kpi-sub">Actual invoiced revenue</div>
        </div>
        <div class="sc-kpi-card">
          <div class="sc-kpi-label">TARGET VALUE</div>
          <div class="sc-kpi-value">EGP ${formatM(target)}</div>
          <div class="sc-kpi-sub">Period plan</div>
        </div>
        <div class="sc-kpi-card" style="border-top:3px solid ${achColor};">
          <div class="sc-kpi-label">TARGET ACH</div>
          <div class="sc-kpi-value" style="color:${achColor};">${ach.toFixed(1)}%</div>
          <div class="sc-kpi-sub" style="color:${achColor}; font-weight:600;">${ach>=95?'On Track':ach>=80?'At Risk':'Below Target'}</div>
        </div>
        <div class="sc-kpi-card">
          <div class="sc-kpi-label">SALES QTY</div>
          <div class="sc-kpi-value">${formatM(totalQty)}</div>
          <div class="sc-kpi-sub">Units sold</div>
        </div>
        <div class="sc-kpi-card">
          <div class="sc-kpi-label">TARGET QTY</div>
          <div class="sc-kpi-value">${formatM(res.tgtQty)}</div>
          <div class="sc-kpi-sub">Planned units</div>
        </div>
        <div class="sc-kpi-card">
          <div class="sc-kpi-label">ACTIVE CUSTOMERS</div>
          <div class="sc-kpi-value">${res.activeCusts.size.toLocaleString()}</div>
          <div class="sc-kpi-sub">Covered accounts</div>
        </div>
        <div class="sc-kpi-card">
          <div class="sc-kpi-label">ACTIVE EMPLOYEES</div>
          <div class="sc-kpi-value">${activeEmpsCount}</div>
          <div class="sc-kpi-sub">Field headcount</div>
        </div>
        <div class="sc-kpi-card">
          <div class="sc-kpi-label">SALES / POSITION</div>
          <div class="sc-kpi-value">EGP ${formatM(salesPerPosition)}</div>
          <div class="sc-kpi-sub">Per deployed territory</div>
        </div>
        <div class="sc-kpi-card">
          <div class="sc-kpi-label">AVG SELLING PRICE</div>
          <div class="sc-kpi-value">EGP ${asp.toFixed(1)}</div>
          <div class="sc-kpi-sub">Per unit</div>
        </div>
        <div class="sc-kpi-card">
          <div class="sc-kpi-label">SALES / CUSTOMER</div>
          <div class="sc-kpi-value">EGP ${formatM(salesPerCust)}</div>
          <div class="sc-kpi-sub">Wallet share proxy</div>
        </div>
      </div>
    `;

    if (STATE.subTab === "executive") {
      const ins = computeInsights(res);
      const achColor  = ins.ach >= 100 ? '#15803d' : ins.ach >= 85 ? '#b45309' : '#b91c1c';
      const achBg     = ins.ach >= 100 ? '#f0fdf4' : ins.ach >= 85 ? '#fffbeb' : '#fef2f2';
      const gapLabel  = ins.totalGap >= 0 ? `▲ EGP ${formatM(ins.totalGap)} above target` : `▼ EGP ${formatM(Math.abs(ins.totalGap))} below target`;
      const gapColor  = ins.totalGap >= 0 ? '#15803d' : '#b91c1c';

      // Opportunity signals
      const oppHtml = ins.overBrands.slice(0, 3).map(b =>
        `<div class="sc-signal sc-signal-green">▲ <strong>${b.name}</strong> — ${b.ach.toFixed(0)}% achievement. Potential to expand.</div>`
      ).join('') || '<div class="sc-signal sc-signal-muted">No significant overperformers detected.</div>';

      // Risk signals
      const riskHtml = ins.atRiskBrands.slice(0, 3).map(b =>
        `<div class="sc-signal sc-signal-red">⚠ <strong>${b.name}</strong> — ${b.ach.toFixed(0)}% · EGP ${formatM(Math.abs(b.gap))} gap</div>`
      ).join('') + (ins.repsBelow80 > 0
        ? `<div class="sc-signal sc-signal-red">⚠ <strong>${ins.repsBelow80} reps</strong> below 80% target achievement</div>`
        : '');

      // Monthly sparkline badges
      const sparkBadges = ins.mEntries.map(m => {
        const c = m.ach >= 100 ? '#15803d' : m.ach >= 85 ? '#b45309' : '#b91c1c';
        const bg = m.ach >= 100 ? '#f0fdf4' : m.ach >= 85 ? '#fffbeb' : '#fef2f2';
        const shortM = m.month.replace('2026-', '').replace('01','Jan').replace('02','Feb').replace('03','Mar').replace('04','Apr').replace('05','May').replace('06','Jun').replace('07','Jul');
        return `<div style="text-align:center; padding:8px 12px; background:${bg}; border-radius:8px; min-width:60px; flex:1;">
          <div style="font-size:10px; color:${c}; font-weight:700; text-transform:uppercase;">${shortM}</div>
          <div style="font-size:16px; font-weight:800; color:${c};">${m.ach.toFixed(0)}%</div>
          <div style="font-size:9px; color:${c}; font-weight:600;">${m.gap >= 0 ? '+' : ''}${formatM(m.gap)}</div>
        </div>`;
      }).join('');

      // Priority actions (data-driven)
      const actions = [];
      if (ins.atRiskBrands.length > 0) actions.push(`Intervene on <strong>${ins.atRiskBrands[0].name}</strong> (${ins.atRiskBrands[0].ach.toFixed(0)}% ach) — largest value gap in portfolio`);
      if (ins.repsBelow80 > 0) actions.push(`Review field execution for <strong>${ins.repsBelow80} reps below 80%</strong> — escalate to DM level`);
      if (ins.worstMonth && ins.worstMonth.ach < 85) actions.push(`Investigate <strong>${ins.worstMonth.month} performance collapse</strong> (${ins.worstMonth.ach.toFixed(0)}%) — identify root cause bricks`);
      if (ins.topDist.share > 45) actions.push(`<strong>Distributor concentration risk</strong> — ${ins.topDist.name} controls ${ins.topDist.share.toFixed(0)}% of sales`);
      if (ins.overBrands.length > 0) actions.push(`Scale success model of <strong>${ins.overBrands[0].name}</strong> (${ins.overBrands[0].ach.toFixed(0)}%) to at-risk brands`);
      const actionsHtml = actions.map((a, i) =>
        `<div class="sc-action-item"><span class="sc-action-num">${i + 1}</span><span>${a}</span></div>`
      ).join('');

      return `
        <!-- ── COMMAND HEADER: Achievement + Monthly Pulse ── -->
        <!-- COMMERCIAL HEALTH block removed 2026-07-29 per Ahmed's request --
             was a composite score (Achievement/SFE/Distribution/Trend) shown
             alongside YTD Achievement here. computeInsights() still computes
             ins.healthScore/healthColor/healthLabel -- they're used by the AI
             Executive Briefing's separate "Health Score" badge, which was
             intentionally kept (different subtab, different label). -->
        <div class="sc-command-header">
          <div class="sc-ach-block" style="background:${achBg}; border:1px solid ${achColor}20;">
            <div style="font-size:10px; font-weight:700; color:${achColor}; text-transform:uppercase; letter-spacing:0.06em;">YTD ACHIEVEMENT</div>
            <div style="font-size:42px; font-weight:900; color:${achColor}; line-height:1; margin:4px 0;">${ins.ach.toFixed(1)}%</div>
            <div style="font-size:12px; font-weight:600; color:${gapColor};">${gapLabel}</div>
            <div style="font-size:10px; color:#64748b; margin-top:4px;">EGP ${formatM(ins.totalVal)} actual · EGP ${formatM(ins.totalTgt)} target</div>
          </div>
          <div class="sc-monthly-strip">
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#64748b; margin-bottom:8px;">MONTHLY PULSE</div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">${sparkBadges}</div>
          </div>
        </div>

        <!-- ── KPI METRICS ROW ── -->
        ${kpiRowHTML}

        <!-- ── INTELLIGENCE PANELS ── -->
        <!-- Was two panels (Monthly Trend + Contribution drilldown); the
             drilldown panel removed 2026-07-29 per Ahmed's request ("remove
             this chart Line Contribution" -- its default/unfiltered state
             showed a "Line Contribution" title, drilling into DM/RM/NSM
             relabeled it to DM/Rep Contribution, same chart/canvas
             throughout). Monthly Trend now spans the full row. -->
        <div class="sc-intel-grid">

          <!-- Monthly trend chart -->
          <div class="sc-intel-card" style="grid-column: span 2;">
            <div class="sc-intel-card-header">
              <div>
                <div class="sc-intel-title">Monthly Performance Trend</div>
                <div class="sc-intel-sub">Actual vs Target · Monthly achievement % overlay</div>
              </div>
              <div class="sc-trend-badge sc-trend-${ins.momTrend}">
                ${ins.momTrend === 'accelerating' ? '↗ Accelerating' : ins.momTrend === 'decelerating' ? '↘ Decelerating' : '→ Stable'}
              </div>
            </div>
            <div style="height:220px; position:relative;"><canvas id="chart-exec-monthly"></canvas></div>
          </div>

        </div>

        <!-- ── SIGNAL ROWS: Opportunities + Risks ── -->
        <div class="sc-signal-grid">
          <div class="sc-signal-panel">
            <div class="sc-signal-title sc-signal-title-green">🚀 Opportunities</div>
            ${oppHtml || '<div class="sc-signal sc-signal-muted">No significant opportunities detected in current filters.</div>'}
          </div>
          <div class="sc-signal-panel">
            <div class="sc-signal-title sc-signal-title-red">⚠ Risk Signals</div>
            ${riskHtml || '<div class="sc-signal sc-signal-muted">No critical risks detected.</div>'}
          </div>
          <div class="sc-signal-panel">
            <div class="sc-signal-title sc-signal-title-blue">⚡ Priority Actions</div>
            ${actionsHtml || '<div class="sc-signal sc-signal-muted">No priority actions at this time.</div>'}
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "line") {
      const lines = cache.lookups.lines || [];
      const lineEntries = Object.entries(res.lineData)
        .map(([idx, d]) => ({
          name: lines[idx] || 'Unknown',
          val: d.val, tgt: d.tgtVal, qty: d.qty,
          ach: d.tgtVal > 0 ? (d.val / d.tgtVal) * 100 : 0,
          gap: d.val - d.tgtVal
        }))
        .filter(l => l.val > 0 || l.tgt > 0)
        .sort((a, b) => b.val - a.val);

      const totalLineVal = lineEntries.reduce((s, l) => s + l.val, 0) || 1;

      const lineRows = lineEntries.map((l, i) => {
        const achC  = l.ach >= 100 ? '#15803d' : l.ach >= 85 ? '#b45309' : '#b91c1c';
        const achBg = l.ach >= 100 ? '#f0fdf4' : l.ach >= 85 ? '#fffbeb' : '#fef2f2';
        const share = (l.val / totalLineVal) * 100;
        const barW  = Math.min(100, share).toFixed(1);
        const rank  = i + 1;
        return `<tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:9px 0; width:28px; font-size:10px; font-weight:800; color:#94a3b8;">${rank}</td>
          <td style="padding:9px 0;">
            <div style="font-size:11px; font-weight:700; color:#0f172a; margin-bottom:4px;">${l.name}</div>
            <div style="height:5px; background:#f1f5f9; border-radius:3px; width:100%;">
              <div style="width:${barW}%; height:100%; background:${achC}; border-radius:3px; transition:width 0.4s;"></div>
            </div>
          </td>
          <td style="text-align:right; font-size:11px; white-space:nowrap; padding-left:8px;">EGP ${formatM(l.val)}</td>
          <td style="text-align:right; font-size:11px; color:#64748b;">EGP ${formatM(l.tgt)}</td>
          <td style="text-align:right; font-size:11px; font-weight:700; color:${achC}; background:${achBg}; padding:3px 8px; border-radius:5px;">${l.tgt > 0 ? l.ach.toFixed(1)+'%' : '—'}</td>
          <td style="text-align:right; font-size:11px; font-weight:600; color:${l.gap >= 0 ? '#15803d' : '#b91c1c'};">${l.gap >= 0 ? '+' : ''}EGP ${formatM(Math.abs(l.gap))}</td>
          <td style="text-align:right; font-size:11px; color:#64748b;">${share.toFixed(1)}%</td>
        </tr>`;
      }).join('');

      // Line status summary
      const onTrack   = lineEntries.filter(l => l.tgt > 0 && l.ach >= 100).length;
      const atRisk    = lineEntries.filter(l => l.tgt > 0 && l.ach >= 80 && l.ach < 100).length;
      const critical  = lineEntries.filter(l => l.tgt > 0 && l.ach < 80).length;
      const totalGapM = lineEntries.reduce((s, l) => s + l.gap, 0);

      return `
        <!-- Line Status KPIs -->
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px;">
          <div class="sc-kpi-card" style="border-top-color:#15803d;">
            <div class="sc-kpi-label">ON TRACK LINES</div>
            <div class="sc-kpi-value" style="color:#15803d;">${onTrack}</div>
            <div class="sc-kpi-sub">≥ 100% achievement</div>
          </div>
          <div class="sc-kpi-card" style="border-top-color:#b45309;">
            <div class="sc-kpi-label">AT RISK LINES</div>
            <div class="sc-kpi-value" style="color:#b45309;">${atRisk}</div>
            <div class="sc-kpi-sub">80–99% achievement</div>
          </div>
          <div class="sc-kpi-card" style="border-top-color:#b91c1c;">
            <div class="sc-kpi-label">CRITICAL LINES</div>
            <div class="sc-kpi-value" style="color:#b91c1c;">${critical}</div>
            <div class="sc-kpi-sub">< 80% achievement</div>
          </div>
          <div class="sc-kpi-card" style="border-top-color:${totalGapM>=0?'#15803d':'#b91c1c'};">
            <div class="sc-kpi-label">PORTFOLIO GAP</div>
            <div class="sc-kpi-value" style="color:${totalGapM>=0?'#15803d':'#b91c1c'};">${totalGapM>=0?'+':''}EGP ${formatM(Math.abs(totalGapM))}</div>
            <div class="sc-kpi-sub">${totalGapM>=0?'Above':'Below'} target portfolio-wide</div>
          </div>
        </div>

        <!-- Line breakdown chart + table -->
        <div style="display:grid; grid-template-columns:1fr 1.8fr; gap:16px; margin-bottom:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <div style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:4px;">Line Achievement</div>
            <div style="font-size:10px; color:#94a3b8; margin-bottom:14px;">Ranked by achievement %</div>
            <div style="height:320px; position:relative;"><canvas id="chart-line-ach"></canvas></div>
          </div>
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <div style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:4px;">Line P&L Scorecard</div>
            <div style="font-size:10px; color:#94a3b8; margin-bottom:14px;">All lines · Actual vs Target · Achievement % · Gap</div>
            <div style="max-height:340px; overflow-y:auto;">
              <table style="width:100%; border-collapse:collapse; font-size:11px;">
                <thead>
                  <tr style="border-bottom:2px solid #e2e8f0;">
                    <th style="padding:6px 0; text-align:left; color:#64748b; font-size:10px; text-transform:uppercase;">#</th>
                    <th style="text-align:left; color:#64748b; font-size:10px; text-transform:uppercase;">Line</th>
                    <th style="text-align:right; color:#64748b; font-size:10px; text-transform:uppercase;">Actual</th>
                    <th style="text-align:right; color:#64748b; font-size:10px; text-transform:uppercase;">Target</th>
                    <th style="text-align:right; color:#64748b; font-size:10px; text-transform:uppercase;">Ach%</th>
                    <th style="text-align:right; color:#64748b; font-size:10px; text-transform:uppercase;">Gap</th>
                    <th style="text-align:right; color:#64748b; font-size:10px; text-transform:uppercase;">Share</th>
                  </tr>
                </thead>
                <tbody>${lineRows}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "line") {
      const lines = cache.lookups.lines || [];
      const lineEntries = Object.entries(res.lineData)
        .map(([idx, d]) => ({
          name: lines[idx] || 'Unknown',
          val: d.val, tgt: d.tgtVal, qty: d.qty,
          ach: d.tgtVal > 0 ? (d.val / d.tgtVal) * 100 : 0,
          gap: d.val - d.tgtVal
        }))
        .filter(l => l.val > 0 || l.tgt > 0)
        .sort((a, b) => b.val - a.val);

      const totalLineVal = lineEntries.reduce((s, l) => s + l.val, 0) || 1;
      const onTrack  = lineEntries.filter(l => l.tgt > 0 && l.ach >= 100).length;
      const atRisk   = lineEntries.filter(l => l.tgt > 0 && l.ach >= 80 && l.ach < 100).length;
      const critical = lineEntries.filter(l => l.tgt > 0 && l.ach < 80).length;
      const totalGapM = lineEntries.reduce((s, l) => s + l.gap, 0);

      const lineRows = lineEntries.map((l, i) => {
        const achC  = l.ach >= 100 ? '#15803d' : l.ach >= 85 ? '#b45309' : '#b91c1c';
        const achBg = l.ach >= 100 ? '#f0fdf4' : l.ach >= 85 ? '#fffbeb' : '#fef2f2';
        const share = (l.val / totalLineVal) * 100;
        const barW  = Math.min(100, share).toFixed(1);
        return `<tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:9px 4px; width:24px; font-size:10px; font-weight:800; color:#94a3b8;">${i+1}</td>
          <td style="padding:9px 0;">
            <div style="font-size:11px; font-weight:700; color:#0f172a; margin-bottom:4px;">${l.name}</div>
            <div style="height:4px; background:#f1f5f9; border-radius:2px; width:100%;">
              <div style="width:${barW}%; height:100%; background:${achC}; border-radius:2px;"></div>
            </div>
          </td>
          <td style="text-align:right; font-size:11px; white-space:nowrap; padding-left:8px;">EGP ${formatM(l.val)}</td>
          <td style="text-align:right; font-size:11px; color:#64748b;">EGP ${formatM(l.tgt)}</td>
          <td style="text-align:right; padding:3px 6px;">
            <span style="font-size:11px; font-weight:700; color:${achC}; background:${achBg}; padding:2px 6px; border-radius:4px;">${l.tgt > 0 ? l.ach.toFixed(1)+'%' : '—'}</span>
          </td>
          <td style="text-align:right; font-size:11px; font-weight:600; color:${l.gap >= 0 ? '#15803d' : '#b91c1c'};">${l.gap >= 0 ? '+' : ''}EGP ${formatM(Math.abs(l.gap))}</td>
          <td style="text-align:right; font-size:11px; color:#64748b;">${share.toFixed(1)}%</td>
        </tr>`;
      }).join('');

      return `
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px;">
          <div class="sc-kpi-card" style="border-top-color:#15803d;">
            <div class="sc-kpi-label">ON TRACK</div>
            <div class="sc-kpi-value" style="color:#15803d;">${onTrack}</div>
            <div class="sc-kpi-sub">Lines ≥ 100% achievement</div>
          </div>
          <div class="sc-kpi-card" style="border-top-color:#b45309;">
            <div class="sc-kpi-label">AT RISK</div>
            <div class="sc-kpi-value" style="color:#b45309;">${atRisk}</div>
            <div class="sc-kpi-sub">Lines 80–99% achievement</div>
          </div>
          <div class="sc-kpi-card" style="border-top-color:#b91c1c;">
            <div class="sc-kpi-label">CRITICAL</div>
            <div class="sc-kpi-value" style="color:#b91c1c;">${critical}</div>
            <div class="sc-kpi-sub">Lines < 80% achievement</div>
          </div>
          <div class="sc-kpi-card" style="border-top-color:${totalGapM>=0?'#15803d':'#b91c1c'};">
            <div class="sc-kpi-label">PORTFOLIO GAP</div>
            <div class="sc-kpi-value" style="color:${totalGapM>=0?'#15803d':'#b91c1c'};">${totalGapM>=0?'+':''}EGP ${formatM(Math.abs(totalGapM))}</div>
            <div class="sc-kpi-sub">Combined variance to plan</div>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1.8fr; gap:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <div style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:4px;">Line Achievement Ranking</div>
            <div style="font-size:10px; color:#94a3b8; margin-bottom:14px;">Horizontal bar · sorted high→low</div>
            <div style="height:320px; position:relative;"><canvas id="chart-line-ach"></canvas></div>
          </div>
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <div style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:4px;">Line P&L Scorecard</div>
            <div style="font-size:10px; color:#94a3b8; margin-bottom:14px;">All lines · Actual vs Target · Ach% · Gap · Share</div>
            <div style="max-height:340px; overflow-y:auto;">
              <table style="width:100%; border-collapse:collapse; font-size:11px;">
                <thead>
                  <tr style="border-bottom:2px solid #e2e8f0;">
                    <th style="padding:6px 4px; text-align:left; color:#64748b; font-size:10px; text-transform:uppercase;">#</th>
                    <th style="text-align:left; color:#64748b; font-size:10px; text-transform:uppercase;">Line</th>
                    <th style="text-align:right; color:#64748b; font-size:10px; text-transform:uppercase;">Actual</th>
                    <th style="text-align:right; color:#64748b; font-size:10px; text-transform:uppercase;">Target</th>
                    <th style="text-align:right; color:#64748b; font-size:10px; text-transform:uppercase;">Ach%</th>
                    <th style="text-align:right; color:#64748b; font-size:10px; text-transform:uppercase;">Gap</th>
                    <th style="text-align:right; color:#64748b; font-size:10px; text-transform:uppercase;">Share</th>
                  </tr>
                </thead>
                <tbody>${lineRows}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "geography") {
      // REDESIGNED 2026-07-29 ("make best practice geography tab
      // analysis"), 2nd pass: the FIRST redesign attempt added Target/
      // Achievement/Gap columns, then live-data validation caught that
      // this cache's target/mirror rows all carry REG=0 ("(none)") --
      // targets are only ever set at Line/Brand/Product/Rep granularity,
      // never at Region level (confirmed: every mirror row's REG index
      // is 0, vs. 16 distinct Lines carrying real targets). An
      // achievement framing here would have shown "—"/EGP 0 in every
      // row and a fake "total gap" equal to the full actual value --
      // worse than the original, not better. Corrected to the metric
      // that's actually real at this granularity: CONTRIBUTION/
      // CONCENTRATION (same honest framing Executive's Customer Channel
      // Mix KPI already established for an analogous no-target
      // dimension -- see buildCustomerClusterMixCard() in
      // js/executive.js and the Customer tab redesign just below).
      // Map visualization kept; ranking now shows share, rank, and a
      // running Pareto cumulative % (which regions make up 80% of
      // revenue) -- a genuinely answerable, non-fabricated question.
      const regions = cache.lookups.regions || [];
      const geoEntries = Object.entries(res.regionalData)
        .map(([idx, d]) => ({ name: regions[idx] || 'Unknown', val: d.val, qty: d.qty }))
        .filter(r => r.name !== '(none)' && r.val > 0)
        .sort((a, b) => b.val - a.val);

      const totalGeoVal = geoEntries.reduce((s, r) => s + r.val, 0) || 1;
      const topRegion = geoEntries[0] || { name: 'N/A', val: 0 };
      const concentrationPct = (topRegion.val / totalGeoVal) * 100;
      const concTier = concentrationPct < 25 ? { label: 'Excellent', color: '#15803d' }
        : concentrationPct < 40 ? { label: 'On Track', color: '#0f6cbd' }
        : concentrationPct < 55 ? { label: 'At Risk', color: '#b45309' }
        : { label: 'Critical', color: '#b91c1c' };

      let cum = 0;
      const geoRows = geoEntries.map((r, i) => {
        const share = (r.val / totalGeoVal) * 100;
        cum += share;
        const barC = i === 0 ? '#0f6cbd' : '#67a6de';
        const barW = Math.min(100, share).toFixed(1);
        return `<tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:9px 0; width:24px; font-size:10px; font-weight:800; color:#94a3b8;">${i + 1}</td>
          <td style="padding:9px 0;">
            <div style="font-size:11px; font-weight:700; color:#0f172a; margin-bottom:4px;">${r.name}</div>
            <div style="height:5px; background:#f1f5f9; border-radius:3px; width:100%;">
              <div style="width:${barW}%; height:100%; background:${barC}; border-radius:3px;"></div>
            </div>
          </td>
          <td style="text-align:right; font-size:11px; white-space:nowrap; padding-left:8px;">EGP ${formatM(r.val)}</td>
          <td style="text-align:right; font-size:11px; font-weight:700; color:#0f6cbd;">${share.toFixed(1)}%</td>
          <td style="text-align:right; font-size:11px; color:#64748b;">${cum.toFixed(1)}%</td>
        </tr>`;
      }).join('');

      return `
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px;">
          <div class="sc-kpi-card">
            <div class="sc-kpi-label">REGIONS ACTIVE</div>
            <div class="sc-kpi-value">${geoEntries.length}</div>
            <div class="sc-kpi-sub">With recorded sales</div>
          </div>
          <div class="sc-kpi-card">
            <div class="sc-kpi-label">TOP REGION</div>
            <div class="sc-kpi-value" style="font-size:16px;">${topRegion.name}</div>
            <div class="sc-kpi-sub">EGP ${formatM(topRegion.val)}</div>
          </div>
          <div class="sc-kpi-card" style="border-top-color:${concTier.color};">
            <div class="sc-kpi-label">REGIONAL CONCENTRATION</div>
            <div class="sc-kpi-value" style="color:${concTier.color};">${concentrationPct.toFixed(1)}%</div>
            <div class="sc-kpi-sub" style="color:${concTier.color}; font-weight:600;">${concTier.label}</div>
          </div>
          <div class="sc-kpi-card">
            <div class="sc-kpi-label">TOTAL SALES VALUE</div>
            <div class="sc-kpi-value">EGP ${formatM(totalGeoVal)}</div>
            <div class="sc-kpi-sub">All regions, current filters</div>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1.3fr 1.7fr; gap:16px; margin-bottom:16px;">
          ${getSVGMapHTML(res)}
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Region Contribution Ranking</h3>
            <div style="max-height:320px; overflow-y:auto;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:2px solid #e2e8f0; color:#64748b;">
                    <th style="padding:6px 0; font-size:10px; font-weight:700; text-transform:uppercase;">#</th>
                    <th style="font-size:10px; font-weight:700; text-transform:uppercase;">Region</th>
                    <th style="text-align:right; font-size:10px; font-weight:700; text-transform:uppercase;">Sales (EGP)</th>
                    <th style="text-align:right; font-size:10px; font-weight:700; text-transform:uppercase;">Share%</th>
                    <th style="text-align:right; font-size:10px; font-weight:700; text-transform:uppercase;">Cumulative%</th>
                  </tr>
                </thead>
                <tbody>${geoRows}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "product") {
      // Brand Performance Ranking -- relocated here 2026-07-29 from the
      // now-removed Performance tab (user request: "remove Performance
      // tab and move Brand Performance Ranking chart to Product tab").
      // A product-level view (SKU) plus a brand-level ranking (roll-up
      // of SKUs) belong together -- Product is the natural home, not a
      // standalone Performance tab duplicating Executive's own
      // achievement framing.
      const ins = computeInsights(res);
      const brandRows = ins.brandEntries.slice(0, 12).map((b) => {
        const achC = b.ach >= 100 ? '#15803d' : b.ach >= 85 ? '#b45309' : '#b91c1c';
        const bar = Math.min(100, b.share);
        return `<tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:7px 0;">
            <div style="font-size:11px; font-weight:600; color:#0f172a; margin-bottom:3px;">${b.name}</div>
            <div style="height:4px; background:#f1f5f9; border-radius:2px;">
              <div style="width:${bar}%; height:100%; background:${achC}; border-radius:2px;"></div>
            </div>
          </td>
          <td style="text-align:right; font-size:11px; white-space:nowrap;">EGP ${formatM(b.val)}</td>
          <td style="text-align:right; font-size:11px; color:#64748b;">${b.share.toFixed(1)}%</td>
          <td style="text-align:right; font-size:11px; font-weight:700; color:${achC};">${b.tgt>0?b.ach.toFixed(1)+'%':'—'}</td>
        </tr>`;
      }).join('');

      return `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Top 10 Product SKUs</h3>
            <div style="max-height:260px; overflow-y:auto; font-size:11px;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:2px solid #e2e8f0; color:#64748b;">
                    <th style="padding:6px 0;">Product SKU</th>
                    <th>Value (EGP)</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(res.prodData).sort((a,b)=>b[1].val - a[1].val).slice(0, 10).map(([idx, data]) => `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                      <td style="padding:6px 0; font-weight:600; color:#0f172a;">${cache.lookups.products[idx] || "Unknown"}</td>
                      <td>${data.val.toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">SKU Contribution Pareto (80/20)</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-prod-pareto"></canvas></div>
          </div>
        </div>
        <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
          <div style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:14px;">Brand Performance Ranking</div>
          <div style="max-height:300px; overflow-y:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:11px;">
              <thead>
                <tr style="border-bottom:2px solid #e2e8f0;">
                  <th style="padding:6px 0; text-align:left; color:#64748b; font-weight:700; font-size:10px; text-transform:uppercase; width:45%;">Brand</th>
                  <th style="text-align:right; color:#64748b; font-weight:700; font-size:10px; text-transform:uppercase;">Actual</th>
                  <th style="text-align:right; color:#64748b; font-weight:700; font-size:10px; text-transform:uppercase;">Share%</th>
                  <th style="text-align:right; color:#64748b; font-weight:700; font-size:10px; text-transform:uppercase;">Ach%</th>
                </tr>
              </thead>
              <tbody>${brandRows}</tbody>
            </table>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "customer") {
      // REDESIGNED 2026-07-29 ("make best practice customer tab analysis
      // based on customer analysis and clustering made"), 2nd pass:
      // replaces the old Chain-only view with the SAME commercial-
      // cluster methodology behind the Executive Command Center's
      // Customer Channel Mix KPI (SUBTYPE_TO_CLUSTER, jointly defined
      // with the business owner in sales_subtypes.xlsx -- see the
      // mapping's own comment above). "Chain" alone under-represented
      // the real customer base: institutions, clinics, hospitals,
      // e-commerce, and generic trade channels never showed up in the
      // old Chain-only table at all. Sourced from res.clusterData
      // (added this same pass to runAggregator()), which -- unlike the
      // Executive interface's BU/Line-scoped getCustomerClusterMix() --
      // respects the Sales tab's FULL current filter set.
      //
      // CORRECTED (same day, 2nd pass): the first version of this
      // redesign added a Target/Achievement% column -- live-data
      // validation then showed every mirror/target row carries STYPE=0
      // ("(none)"), i.e. targets are never set at customer-channel
      // granularity, only Line/Brand/Product/Rep. Achievement% would
      // have shown "—" for every channel. Dropped in favor of the
      // metric that's actually real here: CONCENTRATION (top channel's
      // share of total), exactly matching buildCustomerClusterMixCard()
      // in js/executive.js's own established thresholds and rationale
      // (a customer base overly reliant on one channel carries more
      // channel risk than one spread more evenly) -- kept, not removed,
      // since that part of the design was already correct.
      const clusterEntries = Object.entries(res.clusterData)
        .map(([name, d]) => ({ name: name, val: d.val, qty: d.qty }))
        .filter(c => c.val > 0)
        .sort((a, b) => b.val - a.val);

      const totalCustVal = clusterEntries.reduce((s, c) => s + c.val, 0) || 1;
      const topCluster = clusterEntries[0] || { name: 'N/A', val: 0 };
      const concentrationPct = (topCluster.val / totalCustVal) * 100;
      const concTierFor = (pct) => pct < 25 ? { label: 'Excellent', color: '#15803d', bg: '#f0fdf4' }
        : pct < 40 ? { label: 'On Track', color: '#0f6cbd', bg: '#eff6ff' }
        : pct < 55 ? { label: 'At Risk', color: '#b45309', bg: '#fffbeb' }
        : { label: 'Critical', color: '#b91c1c', bg: '#fef2f2' };
      const concTier = concTierFor(concentrationPct);

      let cum = 0;
      const custRows = clusterEntries.map((c, i) => {
        const share = (c.val / totalCustVal) * 100;
        cum += share;
        const tier = concTierFor(share);
        const barW = Math.min(100, share).toFixed(1);
        return `<tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:9px 0; width:24px; font-size:10px; font-weight:800; color:#94a3b8;">${i + 1}</td>
          <td style="padding:9px 0;">
            <div style="font-size:11px; font-weight:700; color:#0f172a; margin-bottom:4px;">${c.name}</div>
            <div style="height:5px; background:#f1f5f9; border-radius:3px; width:100%;">
              <div style="width:${barW}%; height:100%; background:${tier.color}; border-radius:3px;"></div>
            </div>
          </td>
          <td style="text-align:right; font-size:11px; white-space:nowrap; padding-left:8px;">EGP ${formatM(c.val)}</td>
          <td style="text-align:right; font-size:11px; font-weight:700; color:${tier.color}; background:${tier.bg}; padding:3px 8px; border-radius:5px;">${share.toFixed(1)}%</td>
          <td style="text-align:right; font-size:11px; color:#64748b;">${cum.toFixed(1)}%</td>
        </tr>`;
      }).join('');

      return `
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px;">
          <div class="sc-kpi-card">
            <div class="sc-kpi-label">ACTIVE CUSTOMERS</div>
            <div class="sc-kpi-value">${res.activeCusts.size.toLocaleString()}</div>
            <div class="sc-kpi-sub">Unique accounts, current filters</div>
          </div>
          <div class="sc-kpi-card">
            <div class="sc-kpi-label">TOP CHANNEL</div>
            <div class="sc-kpi-value" style="font-size:16px;">${topCluster.name}</div>
            <div class="sc-kpi-sub">EGP ${formatM(topCluster.val)}</div>
          </div>
          <div class="sc-kpi-card" style="border-top-color:${concTier.color};">
            <div class="sc-kpi-label">CHANNEL CONCENTRATION</div>
            <div class="sc-kpi-value" style="color:${concTier.color};">${concentrationPct.toFixed(1)}%</div>
            <div class="sc-kpi-sub" style="color:${concTier.color}; font-weight:600;">${concTier.label}</div>
          </div>
          <div class="sc-kpi-card">
            <div class="sc-kpi-label">CHANNELS ACTIVE</div>
            <div class="sc-kpi-value">${clusterEntries.length}</div>
            <div class="sc-kpi-sub">Commercial clusters with sales</div>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1.3fr; gap:16px; margin-bottom:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Channel Concentration</h3>
            <div style="height:280px; position:relative;"><canvas id="chart-cust-dist"></canvas></div>
          </div>
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Channel Contribution Ranking</h3>
            <div style="max-height:320px; overflow-y:auto;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:2px solid #e2e8f0; color:#64748b;">
                    <th style="padding:6px 0; font-size:10px; font-weight:700; text-transform:uppercase;">#</th>
                    <th style="font-size:10px; font-weight:700; text-transform:uppercase;">Channel</th>
                    <th style="text-align:right; font-size:10px; font-weight:700; text-transform:uppercase;">Sales (EGP)</th>
                    <th style="text-align:right; font-size:10px; font-weight:700; text-transform:uppercase;">Share%</th>
                    <th style="text-align:right; font-size:10px; font-weight:700; text-transform:uppercase;">Cumulative%</th>
                  </tr>
                </thead>
                <tbody>${custRows}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "distributor") {
      return `
        <div style="display:grid; grid-template-columns:1fr 1.2fr; gap:16px; margin-bottom:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Distributor Channel Volume Share</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-dist-share"></canvas></div>
          </div>
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Distributor Leaderboard</h3>
            <div style="max-height:240px; overflow-y:auto; font-size:11px;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:2px solid #e2e8f0; color:#64748b;">
                    <th style="padding:6px 0;">Distributor</th>
                    <th>Value (EGP)</th>
                    <th>Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(res.distData).sort((a,b)=>b[1].val - a[1].val).map(([idx, data]) => {
                    const name = cache.lookups.distributors[idx] || "Unknown";
                    const share = (data.val / (res.salesValue || 1)) * 100;
                    return `
                      <tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:6px 0; font-weight:600; color:#0f172a;">${name}</td>
                        <td>${data.val.toLocaleString()}</td>
                        <td style="color:#0f6cbd; font-weight:700;">${share.toFixed(1)}%</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "salesforce") {
      return `
        <div style="display:grid; grid-template-columns:1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Medical Representative Leaderboard</h3>
            <div style="max-height:280px; overflow-y:auto; font-size:11px;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:2px solid #e2e8f0; color:#64748b;">
                    <th style="padding:6px 0;">Rep Name</th>
                    <th>Hiring Date</th>
                    <th>Position Role</th>
                    <th>Actual Sales (EGP)</th>
                    <th>Target Achievement %</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(res.repData).sort((a,b)=>b[1].val - a[1].val).slice(0, 50).map(([idx, data]) => {
                    const name = cache.lookups.reps[idx] || "Unknown";
                    const hDate = cache.lookups.rep_hiring_dates[idx] || "N/A";
                    const pos = cache.lookups.rep_positions[idx] || "Representative";
                    const achievementPct = data.tgtVal > 0 ? (data.val / data.tgtVal) * 100 : 0;
                    return `
                      <tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:6px 0; font-weight:600; color:#0f172a;">${name}</td>
                        <td>${hDate}</td>
                        <td style="color:#64748b;">${pos}</td>
                        <td>${data.val.toLocaleString()}</td>
                        <td style="font-weight:700; color:${achievementPct>=95?'#16a34a':'#f59e0b'};">${achievementPct.toFixed(1)}%</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "target") {
      const ins = computeInsights(res);
      const achColor = ins.ach >= 100 ? '#15803d' : ins.ach >= 85 ? '#b45309' : '#b91c1c';
      const nMonths  = ins.mEntries.length || 1;
      const runRate  = ins.totalVal / nMonths;

      // Rep distribution buckets
      const repEntries = Object.entries(res.repData)
        .filter(([idx]) => res.activeReps.has(parseInt(idx)))
        .map(([idx, d]) => ({
          name: cache.lookups.reps[idx] || 'Unknown',
          ach: d.tgtVal > 0 ? (d.val / d.tgtVal) * 100 : null
        }))
        .filter(r => r.ach !== null);

      const b120 = repEntries.filter(r => r.ach >= 120).length;
      const b100 = repEntries.filter(r => r.ach >= 100 && r.ach < 120).length;
      const b90  = repEntries.filter(r => r.ach >= 90  && r.ach < 100).length;
      const b80  = repEntries.filter(r => r.ach >= 80  && r.ach < 90).length;
      const bLow = repEntries.filter(r => r.ach < 80).length;
      const total = repEntries.length || 1;

      const bucket = (n, label, color, bg) =>
        `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:${bg};border-radius:8px;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:600;color:${color};">${label}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="font-size:18px;font-weight:800;color:${color};">${n}</div>
            <div style="font-size:10px;color:${color};font-weight:600;min-width:36px;">${((n/total)*100).toFixed(0)}%</div>
          </div>
        </div>`;

      const brandGapRows = ins.brandEntries.slice(0,15).map(b => {
        const achC = b.ach >= 100 ? '#15803d' : b.ach >= 85 ? '#b45309' : '#b91c1c';
        return `<tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:7px 0;font-size:11px;font-weight:600;color:#0f172a;">${b.name}</td>
          <td style="text-align:right;font-size:11px;">EGP ${formatM(b.val)}</td>
          <td style="text-align:right;font-size:11px;color:#64748b;">EGP ${formatM(b.tgt)}</td>
          <td style="text-align:right;font-size:11px;font-weight:700;color:${achC};">${b.tgt>0?b.ach.toFixed(1)+'%':'—'}</td>
          <td style="text-align:right;font-size:11px;font-weight:600;color:${b.gap>=0?'#15803d':'#b91c1c'};">${b.gap>=0?'+':''}EGP ${formatM(Math.abs(b.gap))}</td>
        </tr>`;
      }).join('');

      return `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
          <div class="sc-kpi-card" style="border-top-color:${achColor};">
            <div class="sc-kpi-label">YTD ACHIEVEMENT</div>
            <div class="sc-kpi-value" style="color:${achColor};">${ins.ach.toFixed(1)}%</div>
            <div class="sc-kpi-sub">EGP ${formatM(ins.totalVal)} of EGP ${formatM(ins.totalTgt)}</div>
          </div>
          <div class="sc-kpi-card" style="border-top-color:${ins.totalGap>=0?'#15803d':'#b91c1c'};">
            <div class="sc-kpi-label">PORTFOLIO GAP</div>
            <div class="sc-kpi-value" style="color:${ins.totalGap>=0?'#15803d':'#b91c1c'};">${ins.totalGap>=0?'+':''}EGP ${formatM(Math.abs(ins.totalGap))}</div>
            <div class="sc-kpi-sub">${ins.totalGap>=0?'Surplus':'Deficit to close'}</div>
          </div>
          <div class="sc-kpi-card" style="border-top-color:#0f4c81;">
            <div class="sc-kpi-label">MONTHLY RUN RATE</div>
            <div class="sc-kpi-value">EGP ${formatM(runRate)}</div>
            <div class="sc-kpi-sub">Avg over ${nMonths} months</div>
          </div>
          <div class="sc-kpi-card" style="border-top-color:#7c3aed;">
            <div class="sc-kpi-label">REPS ON TARGET</div>
            <div class="sc-kpi-value" style="color:#7c3aed;">${ins.repsAbove100}/${ins.repsTotal}</div>
            <div class="sc-kpi-sub">${ins.repsBelow80} reps below 80%</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:16px;">
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
            <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:4px;">Target Gap by Brand</div>
            <div style="font-size:10px;color:#94a3b8;margin-bottom:14px;">EGP gap (Actual − Target) · top brands</div>
            <div style="height:280px;position:relative;"><canvas id="chart-target-bullet"></canvas></div>
          </div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
            <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:4px;">Rep Achievement Distribution</div>
            <div style="font-size:10px;color:#94a3b8;margin-bottom:14px;">${total} reps with targets</div>
            ${bucket(b120,'🏆 ≥ 120% — Champions','#15803d','#f0fdf4')}
            ${bucket(b100,'✅ 100–119% — On Target','#15803d','#f7fef9')}
            ${bucket(b90, '⚡ 90–99% — Close','#b45309','#fffbeb')}
            ${bucket(b80, '⚠ 80–89% — At Risk','#b45309','#fefce8')}
            ${bucket(bLow,'🔴 < 80% — Critical','#b91c1c','#fef2f2')}
            <div style="margin-top:14px;height:6px;background:#f1f5f9;border-radius:3px;display:flex;overflow:hidden;gap:1px;">
              <div style="width:${((b120+b100)/total*100).toFixed(0)}%;background:#15803d;border-radius:3px 0 0 3px;"></div>
              <div style="width:${((b90+b80)/total*100).toFixed(0)}%;background:#b45309;"></div>
              <div style="width:${(bLow/total*100).toFixed(0)}%;background:#b91c1c;border-radius:0 3px 3px 0;"></div>
            </div>
          </div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
            <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:4px;">Brand Gap Priority</div>
            <div style="font-size:10px;color:#94a3b8;margin-bottom:14px;">Sorted by EGP value · top 15</div>
            <div style="max-height:290px;overflow-y:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:11px;">
                <thead>
                  <tr style="border-bottom:2px solid #e2e8f0;">
                    <th style="text-align:left;color:#64748b;font-size:10px;text-transform:uppercase;padding:5px 0;">Brand</th>
                    <th style="text-align:right;color:#64748b;font-size:10px;text-transform:uppercase;">Actual</th>
                    <th style="text-align:right;color:#64748b;font-size:10px;text-transform:uppercase;">Target</th>
                    <th style="text-align:right;color:#64748b;font-size:10px;text-transform:uppercase;">Ach%</th>
                    <th style="text-align:right;color:#64748b;font-size:10px;text-transform:uppercase;">Gap</th>
                  </tr>
                </thead>
                <tbody>${brandGapRows}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }
    if (STATE.subTab === "advanced") {
      const ins = computeInsights(res);
      const achColor = ins.ach >= 100 ? '#15803d' : ins.ach >= 85 ? '#b45309' : '#b91c1c';
      const nMonths = ins.mEntries.length;
      const trend3  = ins.mEntries.slice(-3).map(m => m.ach.toFixed(0)+'%').join(' → ');
      const bestM   = ins.bestMonth  ? ins.bestMonth.month  + ' (' + ins.bestMonth.ach.toFixed(0)  + '%)' : 'N/A';
      const worstM  = ins.worstMonth ? ins.worstMonth.month + ' (' + ins.worstMonth.ach.toFixed(0) + '%)' : 'N/A';

      const item = (dot, text) =>
        `<div class="sc-brief-item"><span class="sc-brief-dot" style="background:${dot};"></span>${text}</div>`;

      const whatHtml = [
        item('#0f4c81', `YTD sales: <strong>EGP ${formatM(ins.totalVal)}</strong> — <strong style="color:${achColor}">${ins.ach.toFixed(1)}% of target</strong> over ${nMonths} months.`),
        item('#0f4c81', `Best month: <strong>${bestM}</strong> · Worst: <strong style="color:#b91c1c">${worstM}</strong>.`),
        item('#0f4c81', `Last 3 months: <strong>${trend3}</strong> — momentum is <strong>${ins.momTrend}</strong>.`),
        item('#0f4c81', `Top brand: <strong>${ins.topBrand.name}</strong> (EGP ${formatM(ins.topBrand.val)} · ${ins.topBrand.ach.toFixed(0)}% ach).`)
      ].join('');

      const whyItems = [];
      if (ins.atRiskBrands.length > 0) whyItems.push(item('#b91c1c', `<strong>${ins.atRiskBrands.slice(0,3).map(b=>b.name).join(', ')}</strong> underperforming — combined EGP ${formatM(ins.atRiskBrands.slice(0,3).reduce((s,b)=>s+Math.abs(b.gap),0))} below target.`));
      if (ins.repsBelow80 > 0) whyItems.push(item('#b91c1c', `<strong>${ins.repsBelow80}/${ins.repsTotal} reps (${((ins.repsBelow80/ins.repsTotal)*100).toFixed(0)}%)</strong> below 80% achievement — field execution gap.`));
      if (ins.topDist.share > 40) whyItems.push(item('#b91c1c', `<strong>${ins.topDist.name}</strong> = ${ins.topDist.share.toFixed(0)}% of revenue — channel concentration limiting growth.`));
      if (ins.worstMonth && ins.worstMonth.ach < 85) whyItems.push(item('#b91c1c', `<strong>${ins.worstMonth.month}</strong> at ${ins.worstMonth.ach.toFixed(0)}% — possible seasonality or field disruption.`));
      const whyHtml = whyItems.join('') || item('#94a3b8', 'Insufficient variation for root cause detection at this filter level.');

      const oppItems = [];
      ins.overBrands.slice(0,3).forEach(b => oppItems.push(item('#15803d', `<strong>${b.name}</strong> at ${b.ach.toFixed(0)}% — replicate promotion model across at-risk lines.`)));
      if (ins.repsBelow80 > 30) oppItems.push(item('#15803d', `Targeted coaching for ${ins.repsBelow80} underperforming reps could unlock EGP ${formatM(ins.totalTgt*0.05)}+ incremental.`));
      const oppHtml = oppItems.join('') || item('#94a3b8', 'No significant opportunities at this filter level.');

      const riskItems = [];
      ins.atRiskBrands.slice(0,3).forEach(b => riskItems.push(item('#b91c1c', `<strong>${b.name}</strong> — ${b.ach.toFixed(0)}%, EGP ${formatM(Math.abs(b.gap))} below trajectory.`)));
      if (ins.topDist.share > 45) riskItems.push(item('#b91c1c', `Single-distributor dependency: <strong>${ins.topDist.name}</strong> = ${ins.topDist.share.toFixed(0)}% of all revenue.`));
      if (ins.repsBelow80 / ins.repsTotal > 0.3) riskItems.push(item('#b91c1c', `<strong>${((ins.repsBelow80/ins.repsTotal)*100).toFixed(0)}% of reps below 80%</strong> — systemic, not isolated.`));
      const riskHtml = riskItems.join('') || item('#94a3b8', 'No critical risks at this filter level.');

      const actions = [];
      ins.atRiskBrands.slice(0,2).forEach(b => actions.push(`Commercial review: <strong>${b.name}</strong> ${b.ach.toFixed(0)}% ach, EGP ${formatM(Math.abs(b.gap))} gap — escalate to BU Head.`));
      if (ins.repsBelow80 > 0) actions.push(`DM reviews for <strong>${ins.repsBelow80} reps < 80%</strong> — coaching vs. territory structure audit.`);
      if (ins.worstMonth) actions.push(`Root cause: <strong>${ins.worstMonth.month}</strong> collapse — brick/rep/DM pattern analysis.`);
      if (ins.overBrands.length) actions.push(`Scale <strong>${ins.overBrands[0].name}</strong> success model — proven demand signal.`);
      if (ins.topDist.share > 45) actions.push(`Distributor diversification — reduce <strong>${ins.topDist.name}</strong> dependency below 40%.`);
      const actHtml = actions.map((a,i) =>
        `<div class="sc-action-item"><span class="sc-action-num">${i+1}</span><span>${a}</span></div>`
      ).join('');

      return `
        <div style="background:linear-gradient(135deg,#0f4c81 0%,#1e40af 100%);border-radius:14px;padding:20px 24px;margin-bottom:16px;display:flex;align-items:center;gap:16px;">
          <div style="font-size:28px;">🧠</div>
          <div>
            <div style="font-size:15px;font-weight:800;color:#fff;letter-spacing:-0.01em;">AI Executive Briefing</div>
            <div style="font-size:11px;color:#93c5fd;margin-top:3px;">Auto-generated · ${nMonths} months · ${ins.repsTotal} reps · ${new Date().toLocaleTimeString()}</div>
          </div>
          <div style="margin-left:auto;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);border-radius:10px;padding:10px 16px;text-align:center;">
            <div style="font-size:10px;color:#bfdbfe;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Health Score</div>
            <div style="font-size:26px;font-weight:900;color:#fff;line-height:1.1;">${ins.healthScore}</div>
            <div style="font-size:10px;font-weight:700;color:${ins.healthScore>=80?'#86efac':ins.healthScore>=60?'#fde68a':'#fca5a5'};">${ins.healthLabel}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div class="sc-brief-panel sc-brief-blue">
            <div class="sc-brief-heading">📊 What Happened</div>
            ${whatHtml}
          </div>
          <div class="sc-brief-panel sc-brief-red">
            <div class="sc-brief-heading">🔍 Why It Happened</div>
            ${whyHtml}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;">
          <div class="sc-brief-panel sc-brief-green">
            <div class="sc-brief-heading">🚀 Opportunities</div>
            ${oppHtml}
          </div>
          <div class="sc-brief-panel sc-brief-red">
            <div class="sc-brief-heading">⚠ Risks</div>
            ${riskHtml}
          </div>
          <div class="sc-brief-panel sc-brief-blue">
            <div class="sc-brief-heading">⚡ Priority Actions</div>
            ${actHtml}
          </div>
        </div>
      `;
    }
    return "";
  }

  // Destroy previous charts to prevent canvas recycling crash
  function destroyCharts() {
    currentChartInstances.forEach(c => c.destroy());
    currentChartInstances = [];
  }

  // Render sub-page Chart.js instances
  function renderPageCharts(res) {
    if (STATE.subTab === "line") {
      const ctxLineAch = document.getElementById("chart-line-ach");
      if (ctxLineAch) {
        const lines = cache.lookups.lines || [];
        const lineEntries = Object.entries(res.lineData)
          .map(([idx, d]) => ({
            name: (lines[idx] || "Unknown"),
            ach: d.tgtVal > 0 ? (d.val / d.tgtVal) * 100 : 0,
            val: d.val, tgt: d.tgtVal
          }))
          .filter(l => l.val > 0 || l.tgt > 0)
          .sort((a, b) => b.ach - a.ach);
        const colors = lineEntries.map(l =>
          l.ach >= 100 ? "#15803d" : l.ach >= 85 ? "#b45309" : "#b91c1c"
        );
        const chart = new Chart(ctxLineAch, {
          type: "bar",
          data: {
            labels: lineEntries.map(l => l.name),
            datasets: [{ label: "Ach %", data: lineEntries.map(l => l.ach), backgroundColor: colors, borderRadius: 5, borderSkipped: false }]
          },
          options: {
            indexAxis: "y",
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (ctx) => {
                const l = lineEntries[ctx.dataIndex];
                return [` Ach: ${ctx.parsed.x.toFixed(1)}%`, ` Actual: EGP ${(l.val/1e6).toFixed(2)}M`, ` Target: EGP ${(l.tgt/1e6).toFixed(2)}M`];
              }}}
            },
            scales: {
              x: { grid: { color: "#f1f5f9" }, ticks: { color: "#64748b", font:{size:10}, callback: v => v+"%" }, title:{display:true,text:"Achievement %",color:"#94a3b8",font:{size:10}} },
              y: { ticks: { color: "#334155", font:{size:10,weight:"600"} }, grid: { display:false } }
            }
          }
        });
        currentChartInstances.push(chart);
      }
    }

    if (STATE.subTab === "executive") {
      const ctxMonthly = document.getElementById("chart-exec-monthly");
      if (ctxMonthly) {
        // Redesigned 2026-07-29 ("make best practice view", per Ahmed).
        // Prior version had two real problems, not just polish:
        //  1. Tick/gridline colors (#a3aed0 ticks, #2e3456 gridlines) were
        //     leftover dark-theme values on a WHITE .sc-intel-card
        //     background -- close to invisible in practice.
        //  2. No visual signal for "did this month hit target" beyond
        //     eyeballing bar-vs-line height -- forces the reader to do the
        //     comparison manually every month, every time.
        // Fixes applied, matching conventions already established
        // elsewhere in this exact file (monthly pulse sparkline badges
        // use the identical green/amber/red achievement tiering; KPI
        // achievement colors reused verbatim):
        //  - Actual bars colored by achievement tier (pre-attentive scan,
        //    no mental math required)
        //  - Target rendered as a dashed line (standard "goal vs actual"
        //    convention -- solid = what happened, dashed = the plan)
        //  - Y axis starts at zero (bar charts must, or height comparisons
        //    lie) and ticks are EGP-formatted instead of raw numbers
        //  - Unified tooltip (mode:'index') shows Actual, Target, and
        //    Achievement % together for whichever month is hovered
        //  - Neutral light-theme colors that are actually legible on #fff
        const sortedMonths = Object.keys(res.monthlyData).sort();
        const vals = sortedMonths.map(m => res.monthlyData[m].val);
        const tgts = sortedMonths.map(m => res.monthlyData[m].tgtVal);
        const achs = sortedMonths.map((m, i) => tgts[i] > 0 ? (vals[i] / tgts[i]) * 100 : null);
        const labels = sortedMonths.map(monthIndexToLabel);

        const achColorFor = (ach) => ach === null ? '#94a3b8' : ach >= 100 ? '#15803d' : ach >= 85 ? '#b45309' : '#b91c1c';
        const barColors = achs.map(achColorFor);

        const chart = new Chart(ctxMonthly, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [
              {
                label: 'Actual Sales',
                data: vals,
                backgroundColor: barColors,
                borderRadius: 6,
                maxBarThickness: 42,
                order: 2
              },
              {
                label: 'Target',
                data: tgts,
                type: 'line',
                borderColor: '#64748b',
                backgroundColor: 'transparent',
                borderWidth: 2,
                borderDash: [6, 4],
                pointRadius: 4,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#64748b',
                pointBorderWidth: 2,
                tension: 0,
                order: 1
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                position: 'top',
                align: 'end',
                labels: { color: '#334155', font: { size: 11, weight: '600' }, usePointStyle: true, boxWidth: 8, padding: 14 }
              },
              tooltip: {
                backgroundColor: '#0f172a',
                titleFont: { size: 12, weight: '700' },
                bodyFont: { size: 11 },
                padding: 10,
                callbacks: {
                  label: (ctx) => {
                    const egp = 'EGP ' + formatM(ctx.parsed.y);
                    if (ctx.dataset.label === 'Actual Sales') {
                      const i = ctx.dataIndex;
                      const achLabel = achs[i] === null ? 'no target' : `${achs[i].toFixed(1)}% of target`;
                      return `  Actual: ${egp}  (${achLabel})`;
                    }
                    return `  Target: ${egp}`;
                  }
                }
              }
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: '#64748b', font: { size: 11, weight: '600' } }
              },
              y: {
                beginAtZero: true,
                grid: { color: '#f1f5f9' },
                border: { display: false },
                ticks: {
                  color: '#94a3b8',
                  font: { size: 10 },
                  callback: (v) => 'EGP ' + formatM(v)
                }
              }
            }
          }
        });
        currentChartInstances.push(chart);
      }

      // chart-exec-drilldown (the "Line/DM/Rep Contribution" doughnut,
      // relabeled by drill depth) removed 2026-07-29 -- see the HTML-side
      // comment above the Monthly Trend panel for why.
    }

    if (STATE.subTab === "product") {
      const ctxPareto = document.getElementById("chart-prod-pareto");
      if (ctxPareto) {
        const sorted = Object.entries(res.prodData).sort((a,b)=>b[1].val - a[1].val).slice(0, 15);
        const labels = sorted.map(([idx]) => cache.lookups.products[idx] ? cache.lookups.products[idx].substring(0, 12) : "Unknown");
        const vals = sorted.map(([, val]) => val.val);
        
        let sum = 0;
        const total = vals.reduce((a,b)=>a+b, 0) || 1;
        const cumulative = vals.map(v => {
          sum += v;
          return (sum / total) * 100;
        });

        const chart = new Chart(ctxPareto, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [
              { label: 'Sales Value', data: vals, backgroundColor: '#0f6cbd' },
              { label: 'Cumulative %', data: cumulative, type: 'line', borderColor: '#f59e0b', yAxisID: 'y2' }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { grid: { display: false } },
              y: { position: 'left' },
              y2: { position: 'right', max: 100 }
            }
          }
        });
        currentChartInstances.push(chart);
      }
    }

    if (STATE.subTab === "customer") {
      // REDESIGNED 2026-07-29 alongside the Customer tab HTML above --
      // horizontal bar of commercial clusters (res.clusterData).
      // CORRECTED (2nd pass, same day): tiered by each channel's own
      // CONCENTRATION share, not Target Achievement% -- customer-channel
      // targets don't exist in this cache (every mirror/target row
      // carries STYPE=0/"(none)"), so achievement coloring would have
      // shown gray ("no target") for every single bar. Same 25/40/55%
      // thresholds as the KPI strip's concentration badge and
      // buildCustomerClusterMixCard() in js/executive.js. Replaces the
      // old chainData pie chart, which (a) only covered named chains,
      // missing every institutional/generic-channel customer, and (b)
      // used leftover dark-theme tick/legend colors barely visible on
      // this light card.
      const ctxDist = document.getElementById("chart-cust-dist");
      if (ctxDist) {
        const sorted = Object.entries(res.clusterData)
          .filter(([, d]) => d.val > 0)
          .sort((a, b) => a[1].val - b[1].val); // ascending so the biggest bar renders at the top of a horizontal chart
        const totalVal = sorted.reduce((s, [, d]) => s + d.val, 0) || 1;
        const labels = sorted.map(([name]) => name);
        const vals = sorted.map(([, d]) => d.val);
        const concColorFor = (share) => share < 25 ? '#15803d' : share < 40 ? '#0f6cbd' : share < 55 ? '#b45309' : '#b91c1c';
        const barColors = sorted.map(([, d]) => concColorFor((d.val / totalVal) * 100));

        const chart = new Chart(ctxDist, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [{ label: 'Sales Value', data: vals, backgroundColor: barColors, borderRadius: 4, maxBarThickness: 22 }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: '#0f172a', titleFont: { size: 12, weight: '700' }, bodyFont: { size: 11 }, padding: 10,
                callbacks: {
                  label: (ctx) => {
                    const share = (ctx.parsed.x / totalVal) * 100;
                    return '  EGP ' + formatM(ctx.parsed.x) + '  (' + share.toFixed(1) + '% of total)';
                  }
                }
              }
            },
            scales: {
              x: { beginAtZero: true, grid: { color: '#f1f5f9' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: v => 'EGP ' + formatM(v) } },
              y: { grid: { display: false }, ticks: { color: '#334155', font: { size: 11, weight: '600' } } }
            }
          }
        });
        currentChartInstances.push(chart);
      }
    }

    if (STATE.subTab === "distributor") {
      const ctxDistShare = document.getElementById("chart-dist-share");
      if (ctxDistShare) {
        const sorted = Object.entries(res.distData).sort((a,b)=>b[1].val - a[1].val).slice(0, 5);
        const labels = sorted.map(([idx]) => cache.lookups.distributors[idx]);
        const vals = sorted.map(([, val]) => val.val);

        const chart = new Chart(ctxDistShare, {
          type: 'doughnut',
          data: {
            labels: labels,
            datasets: [{
              data: vals,
              backgroundColor: ['#0f6cbd', '#16a34a', '#f59e0b', '#dc2626', '#8a94a6'],
              borderWidth: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: '#a3aed0' } } }
          }
        });
        currentChartInstances.push(chart);
      }
    }

    if (STATE.subTab === "target") {
      const ctxTarget = document.getElementById("chart-target-bullet");
      if (ctxTarget) {
        const sortedMonths = Object.keys(res.monthlyData).sort();
        const labels = sortedMonths.map(monthIndexToLabel);
        const actuals = sortedMonths.map(m => res.monthlyData[m].val);
        const targets = sortedMonths.map(m => res.monthlyData[m].tgtVal);

        const chart = new Chart(ctxTarget, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [
              { label: 'Actual Sales', data: actuals, backgroundColor: '#0f6cbd' },
              { label: 'Target', data: targets, backgroundColor: 'rgba(245,158,11,0.4)', borderColor: '#f59e0b', borderWidth: 1 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { grid: { display: false } },
              y: { grid: { color: '#2e3456' } }
            }
          }
        });
        currentChartInstances.push(chart);
      }
    }


    if (STATE.subTab === "advanced") {
      const ctxFc = document.getElementById("chart-advanced-forecast");
      if (ctxFc) {
        const forecast = computeForecastData(res);
        const sortedMonths = Object.keys(res.monthlyData).sort();
        
        const labels = [...sortedMonths.slice(-3).map(monthIndexToLabel), ...forecast.labels];
        const actuals = [...sortedMonths.slice(-3).map(m => res.monthlyData[m].val), null, null, null];
        const forecastVals = [null, null, null, ...forecast.values];

        const chart = new Chart(ctxFc, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              { label: 'Historical Sales', data: actuals, borderColor: '#0f6cbd', borderWidth: 2, tension: 0.1 },
              { label: 'AI Forecast', data: forecastVals, borderColor: '#f59e0b', borderDash: [5, 5], borderWidth: 2, tension: 0.1 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { grid: { display: false } },
              y: { grid: { color: '#2e3456' } }
            }
          }
        });
        currentChartInstances.push(chart);
      }
    }
  }

  // Export engine
  function exportCSV(res) {
    // Target Scenario (2026-08-04): this export writes one CSV line per
    // RAW cache row (not per aggregated group), including mirror/target
    // rows -- previously exactly one mirror row existed per month/line/
    // brand/... group, so `${r[TGT_QTY]},${r[TGT_VAL]}` was always
    // unambiguous. Now that both Official and Working mirror rows exist
    // in the cache, a mirror row that doesn't match the active scenario
    // is skipped entirely (not emitted with zeroed columns, which would
    // look like a phantom empty row) -- this is a raw-row read, so it
    // goes through the same includeTargetRow()/buildLineScenarioMap()
    // gate as every other accumulation site rather than a parallel check.
    const wantOfficialByLine = buildLineScenarioMap(STATE.scenario);
    let csv = "Month,Line,Brand,Product,RepName,DMName,ActualQty,ActualValue,TargetQty,TargetValue\n";
    decodedRows.forEach(r => {
      if (!isRowAllowed(r)) return;
      const mask = r[MASK];
      if ((mask & 16) > 0 && !includeTargetRow(mask, wantOfficialByLine[r[LINE]])) return;
      const m = cache.lookups.months[r[MONTH]];
      const l = cache.lookups.lines[r[LINE]];
      const b = cache.lookups.brands[r[BRAND]];
      const p = cache.lookups.products[r[PROD]];
      const rep = cache.lookups.reps[r[REP]];
      const dm = cache.lookups.dms[r[DM]];

      csv += `"${m}","${l}","${b}","${p}","${rep}","${dm}",${r[QTY]},${r[VAL]},${r[TGT_QTY]},${r[TGT_VAL]}\n`;
    });

    // UTF-8 BOM (2026-07-30): without this, Excel opens the CSV using the
    // system's ANSI codepage instead of UTF-8, and any non-ASCII text --
    // Arabic rep/DM names being the common case here -- renders as
    // mojibake instead of the correct characters.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `zeta_sales_snapshot_${STATE.subTab}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Saved presets manager
  function savePreset() {
    const presetName = prompt("Enter a name for this filter preset:");
    if (!presetName) return;

    const saved = localStorage.getItem("zeta_sales_presets") || "{}";
    const presets = JSON.parse(saved);
    
    // Store current filter values
    presets[presetName] = {
      month: STATE.month,
      line: STATE.line,
      brand: STATE.brand,
      prod: STATE.prod,
      buhead: STATE.buhead,
      nsm: STATE.nsm,
      rm: STATE.rm,
      dm: STATE.dm,
      rep: STATE.rep,
      reg: STATE.reg,
      brick: STATE.brick,
      dist: STATE.dist,
      chain: STATE.chain,
      txtype: STATE.txtype,
      position: STATE.position,
      isBulk: STATE.isBulk,
      isTender: STATE.isTender,
      isOffer: STATE.isOffer,
      isUpa: STATE.isUpa,
      isMirror: STATE.isMirror
    };

    localStorage.setItem("zeta_sales_presets", JSON.stringify(presets));
    alert(`Preset "${presetName}" saved successfully!`);
  }

  function loadPreset() {
    const saved = localStorage.getItem("zeta_sales_presets");
    if (!saved) {
      alert("No saved filter views found.");
      return;
    }
    const presets = JSON.parse(saved);
    const names = Object.keys(presets);
    if (names.length === 0) {
      alert("No saved filter views found.");
      return;
    }

    const selectedName = prompt(`Enter the name of the preset to load:\nAvailable: ${names.join(", ")}`);
    if (!selectedName || !presets[selectedName]) return;

    const preset = presets[selectedName];
    Object.keys(preset).forEach(k => {
      STATE[k] = preset[k];
    });

    renderLayout();
  }

  function resetFilters() {
    STATE.month = "all";
    STATE.line = "all";
    STATE.brand = "all";
    STATE.prod = "all";
    STATE.buhead = "all";
    STATE.nsm = "all";
    STATE.rm = "all";
    STATE.dm = "all";
    STATE.rep = "all";
    STATE.reg = "all";
    STATE.brick = "all";
    STATE.dist = "all";
    STATE.chain = "all";
    STATE.txtype = "all";
    STATE.position = "all";
    STATE.isBulk = "all";
    STATE.isTender = false; // matches the STATE initializer default -- see its comment
    STATE.isOffer = "all";
    STATE.isUpa = "all";
    STATE.isMirror = "all";

    if (window.AskEngine && window.AskEngine.AskContext) {
      window.AskEngine.AskContext.clear();
    }
    renderLayout();
  }

  // Date shortcut helpers
  function applyDateShortcut(type) {
    if (!cache) return;
    const sorted = [...cache.lookups.months].sort();
    if (sorted.length === 0) return;

    if (type === "ytd") {
      // Find latest month and filter all months in that year up to latest
      const latest = sorted[sorted.length - 1];
      const year = latest.substring(0, 4);
      const filtered = sorted.filter(m => m.startsWith(year) && m <= latest).map(m => cache.lookups.months.indexOf(m));
      STATE.month = filtered;
    }
    // "ltm" (Last 12 Months) shortcut removed 2026-07-29 -- replaced by the
    // Month dropdown filter (drop-month), which lets Ahmed pick any exact
    // set of months instead of a fixed trailing-12 window.

    renderLayout();
  }

  // Bind interactive DOM hooks
  function bindEvents() {
    // Collapsible filters
    const filterBtn = document.getElementById("toggle-filters-btn");
    if (filterBtn) {
      filterBtn.addEventListener("click", () => {
        STATE.collapsedFilters = !STATE.collapsedFilters;
        renderLayout();
      });
    }

    // Sub-page switching (buttons render with class "sc-tab" — see the
    // sc-nav-tabs template above; this selector must match that, not a
    // "sales-subtab" class that was never actually rendered anywhere)
    document.querySelectorAll(".sc-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        STATE.subTab = tab.dataset.tab;
        renderLayout();
      });
    });

    // Preset View buttons
    const saveBtn = document.getElementById("sales-preset-save");
    if (saveBtn) saveBtn.addEventListener("click", savePreset);

    const loadBtn = document.getElementById("sales-preset-load");
    if (loadBtn) loadBtn.addEventListener("click", loadPreset);

    const resetBtn = document.getElementById("sales-preset-reset");
    if (resetBtn) resetBtn.addEventListener("click", resetFilters);

    // Date Shortcuts
    document.querySelectorAll(".sales-date-shortcut").forEach(btn => {
      btn.addEventListener("click", () => {
        applyDateShortcut(btn.dataset.type);
      });
    });

    // Special flags selects
    const selectTender = document.getElementById("select-tender");
    if (selectTender) {
      selectTender.addEventListener("change", () => {
        const val = selectTender.value;
        if (val === "all") STATE.isTender = "all";
        else if (val === "true") STATE.isTender = true;
        else if (val === "false") STATE.isTender = false;
        if (window.AskEngine && window.AskEngine.AskContext) {
          window.AskEngine.AskContext.clear();
        }
        renderLayout();
      });
    }

    const selectBulk = document.getElementById("select-bulk");
    if (selectBulk) {
      selectBulk.addEventListener("change", () => {
        const val = selectBulk.value;
        if (val === "all") STATE.isBulk = "all";
        else if (val === "true") STATE.isBulk = true;
        else if (val === "false") STATE.isBulk = false;
        if (window.AskEngine && window.AskEngine.AskContext) {
          window.AskEngine.AskContext.clear();
        }
        renderLayout();
      });
    }

    // Target Scenario selector (2026-08-04) -- only rendered at all for
    // toggle-capable roles (see scenarioControlHtml above), but
    // AUTH.setActiveScenario() re-checks canToggleScenario() itself too,
    // so this can never set a locked role's session scenario even if
    // called some other way. Persists the choice for the rest of this
    // browser session (AUTH.getActiveScenario()) and updates STATE here
    // so this render pass picks it up immediately.
    const selectScenario = document.getElementById("select-scenario");
    if (selectScenario) {
      selectScenario.addEventListener("change", () => {
        const val = selectScenario.value;
        if (window.AUTH && window.AUTH.setActiveScenario(val)) {
          STATE.scenario = val;
          if (window.AskEngine && window.AskEngine.AskContext) {
            window.AskEngine.AskContext.clear();
          }
          renderLayout();
        }
      });
    }

    // Interactive SVG Map path clicks
    document.querySelectorAll(".map-path").forEach(path => {
      path.addEventListener("click", () => {
        const name = path.dataset.name.toLowerCase();
        // Resolve closest lookup index
        const idx = cache.lookups.regions.findIndex(r => r.toLowerCase().includes(name.split(" ")[0]));
        if (idx !== -1) {
          STATE.reg = [idx];
          if (window.AskEngine && window.AskEngine.AskContext) {
            window.AskEngine.AskContext.clear();
          }
          renderLayout();
        }
      });
    });

    // Export Hub actions
    document.querySelectorAll(".sales-export-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.type;
        const res = runAggregator();
        if (type === "csv") {
          exportCSV(res);
        } else {
          alert(`Generating ${type.toUpperCase()} snapshot file...`);
        }
      });
    });
  }

  // Register dashboard interface hook
  window.SalesDashboard = {
    init(containerId) {
      decompressCache();
      if (isCacheStale()) {
        // Old/missing cache: show the pending-refresh placeholder and stop.
        // Deliberately skip 'sales-mode' body class + renderLayout() so no
        // filter/chart wiring runs against data that doesn't match this
        // version of the module.
        console.warn('[Sales] cache is stale or missing (schemaVersion < ' + REQUIRED_SCHEMA_VERSION + '); showing pending-refresh placeholder.');
        renderCachePendingState();
        return;
      }
      document.body.classList.add('sales-mode');
      // Target Scenario (2026-08-04): seed STATE from the signed-in
      // user's role default / in-session choice every time this page is
      // (re)entered, rather than once at script-load -- a user's own
      // toggle choice from a prior visit this session should still
      // apply, but a freshly signed-in user (or one whose role has no
      // toggle rights) must never inherit a stale scenario left over
      // from a previous session's module state.
      if (window.AUTH && typeof window.AUTH.getActiveScenario === "function") {
        STATE.scenario = window.AUTH.getActiveScenario();
      }
      renderLayout();
    },
    /**
     * ENTERPRISE SEMANTIC INTERFACE -- getBusinessSummary()
     * ------------------------------------------------------------------
     * The one and only way the Executive Command Center (or any future
     * workspace) reads Sales data. It never reaches into `cache`,
     * `decodedRows`, or any other internal of this module directly --
     * this module owns its own calculations and exposes only this
     * standardized business object, per the platform's module-boundary
     * principle (2026-07-26 architecture direction).
     *
     * Contract (identical shape across Sales/Coverage/SFE/IQVIA):
     *   { ok, status, asOfDate, source, bu: { <BU>: {...metrics} } }
     * `bu` is keyed by SEMANTIC.BU_LIST only (CHC/Cluster/DIAB/GIT) --
     * Non-Promoted/Other Markets are out of scope for this interface
     * by design (see semantic-model.js).
     *
     * `activePositions` (added 2026-07-29): distinct count of deployed
     * territory/position codes for the BU, EXCLUDED_POSITIONS filtered out
     * (same 7 placeholder codes as the Sales tab's own "SALES / POSITION"
     * KPI). This is Sales' own denominator for productivity metrics --
     * consumers like the Executive Command Center should prefer this over
     * SFE's headcountActive when the goal is "revenue per deployed
     * territory" rather than "revenue per employed rep."
     *
     * YTD here means "all months present in this cache" -- the cache
     * currently holds Jan-May 2026 only, with no prior-year rows, so
     * Sales cannot compute its own YoY growth. That comparison is
     * IQVIA's job (it has multi-year history); Sales' contribution is
     * Target vs Actual achievement and internal MoM trend.
     */
    getBusinessSummary(scenario) {
      decompressCache();
      if (!cache || !Array.isArray(decodedRows) || decodedRows.length === 0) {
        return { ok: false, status: 'cache_unavailable', asOfDate: null, source: 'sales', bu: {} };
      }
      if (typeof window.SEMANTIC === 'undefined') {
        console.error('[Sales] getBusinessSummary() requires js/semantic-model.js to be loaded first.');
        return { ok: false, status: 'semantic_model_missing', asOfDate: null, source: 'sales', bu: {} };
      }
      // Target Scenario (2026-08-04): defaults to "official" when omitted
      // so any pre-existing caller that doesn't pass scenario is 100%
      // backward compatible -- identical output to before this feature.
      scenario = window.SEMANTIC.isValidScenario(scenario) ? scenario : window.SEMANTIC.DEFAULT_SCENARIO;
      const wantOfficialByLine = buildLineScenarioMap(scenario);
      const lines = cache.lookups.lines;
      const months = cache.lookups.months;
      const lastIdx = months.length - 1;
      const prevIdx = months.length - 2;

      const totals = {};
      const byMonth = {}; // bu -> { monthIdx -> actualVal }
      const activePositions = {}; // bu -> Set of deployed, non-placeholder position codes
      window.SEMANTIC.BU_LIST.forEach(bu => {
        totals[bu] = { actualYTD: 0, targetYTD: 0 };
        byMonth[bu] = {};
        activePositions[bu] = new Set();
      });

      for (let i = 0; i < decodedRows.length; i++) {
        const r = decodedRows[i];
        const rawLineName = lines[r[LINE]];
        if (window.AUTH && !window.AUTH.isLineAllowed(rawLineName)) continue;
        const bu = window.SEMANTIC.lineToBU(rawLineName);
        if (!bu) continue;
        // BU/Corporate rollup exclusion (2026-08-04): CHC_SALES is a
        // second channel view of CHC's own catalogue, so it must not be
        // added into an unscoped BU total. This function is BU-level by
        // definition (no line parameter), so the exclusion always
        // applies here. See SEMANTIC.countsInBuRollup().
        if (!window.SEMANTIC.countsInBuRollup(rawLineName)) continue;
        const t = totals[bu];
        t.actualYTD += r[VAL];
        if (includeTargetRow(r[MASK], wantOfficialByLine[r[LINE]])) t.targetYTD += r[TGT_VAL];
        const m = r[MONTH];
        byMonth[bu][m] = (byMonth[bu][m] || 0) + r[VAL];
        // Deployed-territory count, same convention as the Sales tab's own
        // "SALES / POSITION" KPI (2026-07-29): distinct position codes,
        // excluding the 7 known placeholder/unknown codes in
        // EXCLUDED_POSITIONS. Numerator (actualYTD above) is unaffected --
        // it still includes revenue booked against those placeholder codes.
        const rowPos = cache.lookups.rep_positions[r[REP]];
        if (rowPos && !EXCLUDED_POSITIONS.has(rowPos)) activePositions[bu].add(rowPos);
      }

      const buOut = {};
      window.SEMANTIC.BU_LIST.forEach(bu => {
        const t = totals[bu];
        const achievementPct = t.targetYTD > 0 ? (t.actualYTD / t.targetYTD) * 100 : null;
        const lastVal = byMonth[bu][lastIdx] || 0;
        const prevVal = byMonth[bu][prevIdx] || 0;
        const momGrowthPct = prevVal > 0 ? ((lastVal - prevVal) / prevVal) * 100 : null;
        buOut[bu] = {
          actualYTD: t.actualYTD,
          targetYTD: t.targetYTD,
          achievementPct: achievementPct,
          momGrowthPct: momGrowthPct,
          activePositions: activePositions[bu].size,
          unit: 'EGP',
          confidence: months.length >= 3 ? 'high' : 'low' // trend needs >=3 months to mean much
        };
      });

      return {
        ok: true,
        status: 'ready',
        asOfDate: months[lastIdx] || null,
        source: 'sales',
        scenario: scenario,
        bu: buOut
      };
    },
    /**
     * ENTERPRISE SEMANTIC INTERFACE -- getBrandAchievement(bu)
     * ------------------------------------------------------------------
     * Per-brand Value-basis achievement for ONE Business Unit, Non-Tender
     * transactions only (2026-07-26 request -- "Brand Portfolio Health"
     * in the Executive Evidence Score now sources from Sales, not IQVIA
     * market share). Deliberately a FRESH single-row pass over
     * decodedRows, not a read of runAggregator()'s STATE-dependent
     * brandData -- the Executive Command Center is a separate consumer
     * and must not depend on whatever filters happen to be set on the
     * interactive Sales tab at the moment this is called.
     *
     * Row-level convention confirmed empirically before writing this:
     * every row is EITHER a real transaction row (VAL>0, TGT_VAL=0) OR a
     * "mirror" target row (VAL=0, TGT_VAL>0) -- summing both columns
     * across all rows in a filtered set gives the correct combined
     * actual-vs-target without double counting. Mirror/target rows are
     * NEVER tender-flagged (confirmed: 0 rows are both isMirror and
     * isTender in the current cache), so excluding isTender rows only
     * ever removes real tender transactions -- it never silently drops
     * target data for the remaining non-tender brands.
     *
     * achievementPct = actualValue / targetValue * 100, Value basis
     * (EGP), exactly what "ach is value based" asked for.
     *
     * EXTENDED 2026-07-27 (Sales Value KPI card): now also accumulates
     * units (QTY/TGT_QTY) alongside value, and computes each brand's
     * contributionPct = its share of this BU's total Non-Tender VALUE
     * (not units -- "contribution based on value" per request). Optional
     * `line` param (a canonical line name, e.g. from SEMANTIC.normalizeLine())
     * additionally scopes to one line within the BU -- omit/pass null for
     * the whole-BU figure (identical to the pre-2026-07-27 behavior).
     */
    getBrandAchievement(bu, line, ignoreLineAuth, scenario, maxMonth) {
      decompressCache();
      if (!cache || !Array.isArray(decodedRows) || decodedRows.length === 0) {
        return { ok: false, status: 'cache_unavailable', asOfDate: null, source: 'sales', bu: bu, brands: [] };
      }
      if (typeof window.SEMANTIC === 'undefined') {
        console.error('[Sales] getBrandAchievement() requires js/semantic-model.js to be loaded first.');
        return { ok: false, status: 'semantic_model_missing', asOfDate: null, source: 'sales', bu: bu, brands: [] };
      }
      scenario = window.SEMANTIC.isValidScenario(scenario) ? scenario : window.SEMANTIC.DEFAULT_SCENARIO;
      const wantOfficialByLine = buildLineScenarioMap(scenario);
      const lines = cache.lookups.lines;
      const brandsLk = cache.lookups.brands || [];
      const months = cache.lookups.months;
      const maxMonthIdx = maxMonth && maxMonth !== 'YTD' ? months.indexOf(maxMonth) : -1;

      const acc = new Map(); // brandIdx -> { val, tgtVal, qty, tgtQty }
      let totalVal = 0;
      for (let i = 0; i < decodedRows.length; i++) {
        const r = decodedRows[i];
        if (maxMonthIdx >= 0 && r[MONTH] > maxMonthIdx) continue;
        const rawLine = lines[r[LINE]];
        if (!ignoreLineAuth && window.AUTH && !window.AUTH.isLineAllowed(rawLine)) continue;
        const rBu = window.SEMANTIC.lineToBU(rawLine);
        if (rBu !== bu) continue;
        if (line && line !== 'All' && window.SEMANTIC.normalizeLine(rawLine) !== line) continue;
        // BU rollup exclusion (2026-08-04): only when NO specific line was
        // asked for. Selecting CHC_SALES explicitly still returns its full
        // brand breakdown. See SEMANTIC.countsInBuRollup().
        if ((!line || line === 'All') && !window.SEMANTIC.countsInBuRollup(rawLine)) continue;
        const isTender = (r[MASK] & 2) > 0;
        if (isTender) continue; // Non-Tender only, per request
        const bIdx = r[BRAND];
        if (!acc.has(bIdx)) acc.set(bIdx, { val: 0, tgtVal: 0, qty: 0, tgtQty: 0 });
        const a = acc.get(bIdx);
        a.val += r[VAL];
        a.qty += r[QTY];
        if (includeTargetRow(r[MASK], wantOfficialByLine[r[LINE]])) {
          a.tgtVal += r[TGT_VAL];
          a.tgtQty += r[TGT_QTY];
        }
        totalVal += r[VAL];
      }

      const brands = Array.from(acc.entries())
        .map(([idx, a]) => ({
          name: brandsLk[idx] || 'Unknown',
          actualValue: a.val,
          targetValue: a.tgtVal,
          actualQty: a.qty,
          targetQty: a.tgtQty,
          achievementPct: a.tgtVal > 0 ? (a.val / a.tgtVal) * 100 : null,
          contributionPct: totalVal > 0 ? (a.val / totalVal) * 100 : null,
        }))
        .filter(b => b.targetValue > 0 || b.actualValue > 0) // drop dimension noise with nothing on either side
        .sort((x, y) => (x.achievementPct === null ? Infinity : x.achievementPct) - (y.achievementPct === null ? Infinity : y.achievementPct));

      return {
        ok: true,
        status: 'ready',
        asOfDate: months[months.length - 1] || null,
        source: 'sales',
        bu: bu,
        line: line || 'All',
        unit: 'EGP',
        scope: 'Non-Tender transactions only, Value basis',
        scenario: scenario,
        totalActualValue: totalVal,
        brands: brands,
      };
    },

    /**
     * ENTERPRISE SEMANTIC INTERFACE -- getLineSalesSummary(bu)
     * ------------------------------------------------------------------
     * Executive KPI 11 (Line Performance, 2026-07-27): per-Line Sales
     * Achievement within one BU. Grouped by SEMANTIC.normalizeLine(), NOT
     * the raw cache.lookups.lines string -- Sales tags the CHC line
     * "CHC_SALES" while every other cache calls it "CHC" (see
     * LINE_SYNONYMS in semantic-model.js). Grouping by the raw string
     * would show CHC_SALES as a second, phantom line and -- per the
     * user's explicit confirmation (2026-07-27) -- double the apparent
     * CHC total if ever summed, since CHC_SALES's rows ARE CHC's sales,
     * just under a different spelling. normalizeLine() collapses both
     * spellings into the single canonical "CHC" bucket before grouping,
     * exactly like lineToBU() already does for the BU-level rollup.
     *
     * CORRECTED 2026-07-27 (user: "make right calculation for sales
     * achievement"): now Non-Tender only, matching getBrandAchievement()'s
     * and getSalesAchievementSummary()'s definition of "Achievement" --
     * this is a Line cut of the SAME "Sales Achievement" headline number
     * KPI 5 shows, so it must use the identical definition or the two
     * won't reconcile. Was previously all-transaction basis; that was the
     * bug (KPI 5's headline and its own Line-filtered mode used different
     * bases depending on whether a Line was selected).
     *
     * EXTENDED 2026-07-29 (Line Performance headcount/Sales-per-Rep fix):
     * each line now also carries activePositions (distinct deployed
     * position codes, EXCLUDED_POSITIONS filtered out -- not
     * tender-scoped) and salesPerPosition (actualValue / activePositions).
     * Replaces Coverage's per-line rep headcount as the denominator for
     * Executive KPI 11's "Headcount"/"Sales per Rep" columns, which were
     * previously mismatched against this platform's SALES/POSITION
     * convention (a Coverage rep headcount, not a Sales deployed-position
     * count).
     *
     * EXTENDED 2026-07-29 (Line Performance Period filter): optional
     * `months` param -- null/undefined/"all"/[] means every month in the
     * cache (previous behavior, unchanged). An array of month INDEX
     * values (numbers or numeric strings, matching cache.lookups.months
     * indices -- see getAvailableMonths()) scopes both the value/target
     * accumulation AND the deployed-position count to just those months.
     * An empty array is treated the same as "all", not "zero months" --
     * matches DS.filterDropdown's own "0 selected reads as All" label
     * convention, so the Period control's summary text and the actual
     * data never disagree.
     */
    getLineSalesSummary(bu, months, ignoreLineAuth, scenario) {
      decompressCache();
      if (!cache || !Array.isArray(decodedRows) || decodedRows.length === 0) {
        return { ok: false, status: 'cache_unavailable', asOfDate: null, source: 'sales', bu: bu, lines: [] };
      }
      if (typeof window.SEMANTIC === 'undefined') {
        console.error('[Sales] getLineSalesSummary() requires js/semantic-model.js to be loaded first.');
        return { ok: false, status: 'semantic_model_missing', asOfDate: null, source: 'sales', bu: bu, lines: [] };
      }
      // ROLE-BASED ACCESS SCOPE (2026-07-29): backstop, mirrors
      // coverage-interface.js/sfe.js's equivalent interfaces.
      if (window.AUTH && !window.AUTH.isBuAllowed(bu)) {
        return { ok: false, status: 'access_denied', asOfDate: null, source: 'sales', bu: bu, lines: [] };
      }
      scenario = window.SEMANTIC.isValidScenario(scenario) ? scenario : window.SEMANTIC.DEFAULT_SCENARIO;
      const wantOfficialByLine = buildLineScenarioMap(scenario);
      const linesLk = cache.lookups.lines;
      const monthsLk = cache.lookups.months;
      const monthFilter = (Array.isArray(months) && months.length > 0) ? new Set(months.map(Number)) : null;

      const acc = new Map(); // canonicalLineName -> { val, tgtVal }
      const posByLine = new Map(); // canonicalLineName -> Set of deployed position codes
      for (let i = 0; i < decodedRows.length; i++) {
        const r = decodedRows[i];
        const rawLine = linesLk[r[LINE]];
        if (!ignoreLineAuth && window.AUTH && !window.AUTH.isLineAllowed(rawLine)) continue;
        if (window.SEMANTIC.lineToBU(rawLine) !== bu) continue;
        if (monthFilter && !monthFilter.has(r[MONTH])) continue;
        const canon = window.SEMANTIC.normalizeLine(rawLine);
        // Deployed-position tracking is NOT tender-filtered -- a
        // territory is deployed regardless of transaction type, same
        // convention as getBusinessSummary()'s activePositions (2026-07-29).
        const rowPos = cache.lookups.rep_positions[r[REP]];
        if (rowPos && !EXCLUDED_POSITIONS.has(rowPos)) {
          if (!posByLine.has(canon)) posByLine.set(canon, new Set());
          posByLine.get(canon).add(rowPos);
        }
        const isTender = (r[MASK] & 2) > 0;
        if (isTender) continue; // Non-Tender only -- see header comment
        if (!acc.has(canon)) acc.set(canon, { val: 0, tgtVal: 0 });
        const a = acc.get(canon);
        a.val += r[VAL];
        if (includeTargetRow(r[MASK], wantOfficialByLine[r[LINE]])) a.tgtVal += r[TGT_VAL];
      }

      const lines = Array.from(acc.entries())
        .map(([name, a]) => {
          const activePositions = posByLine.has(name) ? posByLine.get(name).size : 0;
          return {
            name: name,
            actualValue: a.val,
            targetValue: a.tgtVal,
            achievementPct: a.tgtVal > 0 ? (a.val / a.tgtVal) * 100 : null,
            activePositions: activePositions,
            salesPerPosition: activePositions > 0 ? a.val / activePositions : null,
            // BU rollup membership (2026-08-04). This function deliberately
            // still returns EVERY line, including ones excluded from the BU
            // total (CHC_SALES today) -- Ahmed's confirmed decision was
            // "keep it selectable and visible", so hiding it here would be
            // wrong. But a consumer that naively SUMS these rows would then
            // disagree with the BU's own Sales Value card, so each row
            // states whether it counts. Sum only rows where this is true.
            countsInBuRollup: window.SEMANTIC.countsInBuRollup(name),
          };
        })
        .filter(l => l.targetValue > 0 || l.actualValue > 0)
        // Role-based scope: exclude any line the signed-in user isn't
        // allowed (e.g. Amr Khalifa's Allowed Lines is "CHC" only, not
        // "CHC,CHC_SALES", even though bu="CHC" itself is allowed).
        .filter(l => ignoreLineAuth || !window.AUTH || window.AUTH.isLineAllowed(l.name))
        .sort((x, y) => y.actualValue - x.actualValue);

      return {
        ok: true,
        status: 'ready',
        asOfDate: monthsLk[monthsLk.length - 1] || null,
        source: 'sales',
        bu: bu,
        unit: 'EGP',
        scope: 'Non-Tender transactions only, Value basis',
        scenario: scenario,
        lines: lines,
      };
    },

    /**
     * ENTERPRISE SEMANTIC INTERFACE -- getAvailableMonths()
     * ------------------------------------------------------------------
     * Added 2026-07-29 for the Executive Command Center's Line
     * Performance Period filter (scoped to that section only -- the
     * platform-wide Period selector in the global filter bar is a
     * separate, still-disabled control, since Coverage/SFE have no
     * month dimension to filter by). Returns the cache's month index ->
     * display-label mapping so a consumer never has to reach into
     * cache.lookups.months directly, per the module-boundary principle.
     */
    getAvailableMonths() {
      decompressCache();
      if (!cache || !cache.lookups || !Array.isArray(cache.lookups.months)) {
        return { ok: false, months: [] };
      }
      const months = cache.lookups.months
        .map((key, idx) => ({ idx: idx, key: key, label: monthIndexToLabel(idx) }))
        .sort((a, b) => a.key.localeCompare(b.key));
      return { ok: true, months: months };
    },

    /**
     * ENTERPRISE SEMANTIC INTERFACE -- getSalesAchievementSummary(bu, line)
     * ------------------------------------------------------------------
     * Executive KPI 5 (2026-07-27 correction -- "make right calculation
     * for sales achievement"): THE canonical Sales Achievement number,
     * Non-Tender transactions only, Value basis -- the SAME definition
     * getBrandAchievement()/getLineSalesSummary()/getItemAchievement()
     * already use. Previously KPI 5 read getBusinessSummary()'s
     * all-transaction achievementPct instead, which included Tender
     * business and didn't reconcile with every other Achievement-basis
     * figure on this platform (Brand Portfolio Health, Sales Value, the
     * Line Performance table). This function replaces that as KPI 5's
     * source of truth. `line` is optional (a canonical line name) to
     * scope to one line within the BU; omit/pass null for the whole-BU
     * figure. Includes a Non-Tender MoM growth figure (byMonth, same
     * two-month-lookback convention as getBusinessSummary()'s
     * momGrowthPct) so the trend indicator is on the same basis as the
     * headline, not silently mixing bases.
     */
    getSalesAchievementSummary(bu, line, ignoreLineAuth, scenario) {
      decompressCache();
      if (!cache || !Array.isArray(decodedRows) || decodedRows.length === 0) {
        return { ok: false, status: 'cache_unavailable', asOfDate: null, source: 'sales', bu: bu, line: line || 'All' };
      }
      if (typeof window.SEMANTIC === 'undefined') {
        console.error('[Sales] getSalesAchievementSummary() requires js/semantic-model.js to be loaded first.');
        return { ok: false, status: 'semantic_model_missing', asOfDate: null, source: 'sales', bu: bu, line: line || 'All' };
      }
      scenario = window.SEMANTIC.isValidScenario(scenario) ? scenario : window.SEMANTIC.DEFAULT_SCENARIO;
      const wantOfficialByLine = buildLineScenarioMap(scenario);
      const linesLk = cache.lookups.lines;
      const months = cache.lookups.months;
      const lastIdx = months.length - 1;
      const prevIdx = months.length - 2;

      let actualYTD = 0, targetYTD = 0;
      const byMonth = {};
      for (let i = 0; i < decodedRows.length; i++) {
        const r = decodedRows[i];
        const rawLine = linesLk[r[LINE]];
        if (!ignoreLineAuth && window.AUTH && !window.AUTH.isLineAllowed(rawLine)) continue;
        if (window.SEMANTIC.lineToBU(rawLine) !== bu) continue;
        if (line && line !== 'All' && window.SEMANTIC.normalizeLine(rawLine) !== line) continue;
        // BU rollup exclusion (2026-08-04): only when NO specific line was
        // asked for -- selecting CHC_SALES explicitly still returns its
        // own full figures. See SEMANTIC.countsInBuRollup().
        if ((!line || line === 'All') && !window.SEMANTIC.countsInBuRollup(rawLine)) continue;
        const isTender = (r[MASK] & 2) > 0;
        if (isTender) continue; // Non-Tender only -- see header comment
        actualYTD += r[VAL];
        if (includeTargetRow(r[MASK], wantOfficialByLine[r[LINE]])) targetYTD += r[TGT_VAL];
        const m = r[MONTH];
        byMonth[m] = (byMonth[m] || 0) + r[VAL];
      }

      const achievementPct = targetYTD > 0 ? (actualYTD / targetYTD) * 100 : null;
      const lastVal = byMonth[lastIdx] || 0;
      const prevVal = byMonth[prevIdx] || 0;
      const momGrowthPct = prevVal > 0 ? ((lastVal - prevVal) / prevVal) * 100 : null;

      return {
        ok: true,
        status: 'ready',
        asOfDate: months[lastIdx] || null,
        source: 'sales',
        bu: bu,
        line: line || 'All',
        unit: 'EGP',
        scope: 'Non-Tender transactions only, Value basis',
        scenario: scenario,
        actualYTD: actualYTD,
        targetYTD: targetYTD,
        achievementPct: achievementPct,
        momGrowthPct: momGrowthPct,
        confidence: months.length >= 3 ? 'high' : 'low',
      };
    },

    /**
     * ENTERPRISE SEMANTIC INTERFACE -- getItemAchievement(bu, brandName, line)
     * ------------------------------------------------------------------
     * Executive KPI 5 drill-down (2026-07-27 request): "Only for CHC,
     * Brand cards become clickable to Item level." Mirrors
     * getBrandAchievement()'s exact convention (Non-Tender, Value basis)
     * one level finer -- grouped by PROD (SKU/item). Enforces the
     * CHC-only rule itself (returns a clear 'bu_not_supported' status for
     * the other 3 BUs) so callers can't accidentally wire this into a
     * Cluster/DIAB/GIT brand card.
     *
     * EXTENDED 2026-07-27 (Sales Value KPI card): `brandName` is now
     * OPTIONAL -- pass null/undefined to aggregate items across ALL of
     * CHC's brands at once (the Sales Value card's CHC popup shows items
     * directly, not brands, per request). Also accumulates units
     * (QTY/TGT_QTY) and each item's contributionPct (share of the
     * returned scope's total Non-Tender VALUE), and accepts an optional
     * `line` param exactly like getBrandAchievement()'s.
     */
    getItemAchievement(bu, brandName, line, scenario, maxMonth) {
      // GUARD RELAXED 2026-08-09 (Ahmed: "DEFINE ELIMBOSIS AS 2.5 AND 5").
      //
      // This used to hard-refuse anything but CHC. The refusal was a SCOPING
      // decision, not a technical limit -- the body below is already BU-
      // agnostic (it filters on SEMANTIC.lineToBU(rawLine) === bu like every
      // other function here), so it produces correct item-level figures for
      // any BU.
      //
      // The Expense vs Sales page needs SKU-level sales for a non-CHC brand:
      // ELIMBOSIS carries separate 2.5 MG and 5 MG budgets and Ahmed wants
      // them reported separately, which is impossible from a brand total.
      //
      // SAFE BY CONSTRUCTION: every BU except CHC previously received an
      // error from this function, so no existing caller can be passing one.
      // Nothing that works today changes behaviour -- this only turns a
      // refusal into an answer.
      if (!bu || bu === 'All') {
        return { ok: false, status: 'bu_required', asOfDate: null, source: 'sales', bu: bu, brand: brandName || null, items: [] };
      }
      decompressCache();
      if (!cache || !Array.isArray(decodedRows) || decodedRows.length === 0) {
        return { ok: false, status: 'cache_unavailable', asOfDate: null, source: 'sales', bu: bu, brand: brandName || null, items: [] };
      }
      if (typeof window.SEMANTIC === 'undefined') {
        console.error('[Sales] getItemAchievement() requires js/semantic-model.js to be loaded first.');
        return { ok: false, status: 'semantic_model_missing', asOfDate: null, source: 'sales', bu: bu, brand: brandName || null, items: [] };
      }
      // bu is always 'CHC' here (see the bu_not_supported gate above), and
      // both CHC lines are single-scenario -- this always resolves to
      // Official today. Still routed through buildLineScenarioMap() (not
      // hardcoded) so this function needs no changes if CHC ever gains a
      // real Working Target.
      scenario = window.SEMANTIC.isValidScenario(scenario) ? scenario : window.SEMANTIC.DEFAULT_SCENARIO;
      const wantOfficialByLine = buildLineScenarioMap(scenario);
      const lines = cache.lookups.lines;
      const brandsLk = cache.lookups.brands || [];
      const productsLk = cache.lookups.products || [];
      const months = cache.lookups.months;
      const maxMonthIdx = maxMonth && maxMonth !== 'YTD' ? months.indexOf(maxMonth) : -1;
      let brandIdx = null;
      if (brandName) {
        brandIdx = brandsLk.indexOf(brandName);
        if (brandIdx < 0) {
          return { ok: false, status: 'brand_not_found', asOfDate: null, source: 'sales', bu: bu, brand: brandName, items: [] };
        }
      }

      const acc = new Map(); // productIdx -> { val, tgtVal, qty, tgtQty }
      let totalVal = 0;
      for (let i = 0; i < decodedRows.length; i++) {
        const r = decodedRows[i];
        if (maxMonthIdx >= 0 && r[MONTH] > maxMonthIdx) continue;
        const rawLine = lines[r[LINE]];
        if (window.SEMANTIC.lineToBU(rawLine) !== bu) continue;
        if (line && line !== 'All' && window.SEMANTIC.normalizeLine(rawLine) !== line) continue;
        // BU rollup exclusion (2026-08-04): only when NO specific line was
        // asked for -- drilling into CHC_SALES still shows its own items.
        if ((!line || line === 'All') && !window.SEMANTIC.countsInBuRollup(rawLine)) continue;
        if (brandIdx !== null && r[BRAND] !== brandIdx) continue;
        const isTender = (r[MASK] & 2) > 0;
        if (isTender) continue; // Non-Tender only, same convention as getBrandAchievement()
        const pIdx = r[PROD];
        if (!acc.has(pIdx)) acc.set(pIdx, { val: 0, tgtVal: 0, qty: 0, tgtQty: 0 });
        const a = acc.get(pIdx);
        a.val += r[VAL];
        a.qty += r[QTY];
        if (includeTargetRow(r[MASK], wantOfficialByLine[r[LINE]])) {
          a.tgtVal += r[TGT_VAL];
          a.tgtQty += r[TGT_QTY];
        }
        totalVal += r[VAL];
      }

      const items = Array.from(acc.entries())
        .map(([idx, a]) => ({
          name: productsLk[idx] || 'Unknown',
          actualValue: a.val,
          targetValue: a.tgtVal,
          actualQty: a.qty,
          targetQty: a.tgtQty,
          achievementPct: a.tgtVal > 0 ? (a.val / a.tgtVal) * 100 : null,
          contributionPct: totalVal > 0 ? (a.val / totalVal) * 100 : null,
        }))
        .filter(it => it.targetValue > 0 || it.actualValue > 0)
        .sort((x, y) => (x.achievementPct === null ? Infinity : x.achievementPct) - (y.achievementPct === null ? Infinity : y.achievementPct));

      return {
        ok: true,
        status: 'ready',
        asOfDate: months[months.length - 1] || null,
        source: 'sales',
        bu: bu,
        brand: brandName || null,
        line: line || 'All',
        unit: 'EGP',
        scope: 'Non-Tender transactions only, Value basis',
        scenario: scenario,
        totalActualValue: totalVal,
        items: items,
      };
    },

    /**
     * ENTERPRISE SEMANTIC INTERFACE -- getCustomerClusterMix(bu, line)
     * ------------------------------------------------------------------
     * Executive "Customer Channel Mix" KPI card (2026-07-28). Non-Tender,
     * Value basis -- same convention as every other Achievement-family
     * figure on this platform (getBrandAchievement, getLineSalesSummary,
     * getSalesAchievementSummary, getItemAchievement). Groups every
     * transaction's `sub_types` value into a commercial cluster via
     * subTypeToCluster() (see the SUBTYPE_TO_CLUSTER map above for the
     * mapping and its source-of-truth spreadsheet). Two-level result:
     * cluster-level totals (for the card's main view) and, nested inside
     * each cluster, the raw sub_type ("customer") breakdown for the
     * drill-down modal -- mirrors getBrandAchievement()/
     * getItemAchievement()'s brand-then-item drill pattern, just
     * cluster-then-sub_type instead. `line` is optional (a canonical
     * line name) to scope to one line within the BU; omit/pass null for
     * the whole-BU figure.
     */
    getCustomerClusterMix(bu, line, ignoreLineAuth) {
      decompressCache();
      if (!cache || !Array.isArray(decodedRows) || decodedRows.length === 0) {
        return { ok: false, status: 'cache_unavailable', asOfDate: null, source: 'sales', bu: bu, line: line || 'All', clusters: [] };
      }
      if (typeof window.SEMANTIC === 'undefined') {
        console.error('[Sales] getCustomerClusterMix() requires js/semantic-model.js to be loaded first.');
        return { ok: false, status: 'semantic_model_missing', asOfDate: null, source: 'sales', bu: bu, line: line || 'All', clusters: [] };
      }
      const linesLk = cache.lookups.lines;
      const subTypesLk = cache.lookups.sub_types;
      const months = cache.lookups.months;

      // clusterName -> { val, subTypes: Map(subTypeName -> val) }
      const clusterAcc = new Map();
      let totalVal = 0;

      for (let i = 0; i < decodedRows.length; i++) {
        const r = decodedRows[i];
        const rawLine = linesLk[r[LINE]];
        if (!ignoreLineAuth && window.AUTH && !window.AUTH.isLineAllowed(rawLine)) continue;
        if (window.SEMANTIC.lineToBU(rawLine) !== bu) continue;
        if (line && line !== 'All' && window.SEMANTIC.normalizeLine(rawLine) !== line) continue;
        // BU rollup exclusion (2026-08-04): only when NO specific line was
        // asked for. Keeps the channel mix reconciling with the BU's own
        // Sales Value card. See SEMANTIC.countsInBuRollup().
        if ((!line || line === 'All') && !window.SEMANTIC.countsInBuRollup(rawLine)) continue;
        const isTender = (r[MASK] & 2) > 0;
        if (isTender) continue; // Non-Tender only -- see header comment

        const rawSubType = subTypesLk[r[STYPE]];
        const cluster = subTypeToCluster(rawSubType);
        if (cluster === null) continue; // "(none)" sub_type -- unattributed, excluded from the mix

        if (!clusterAcc.has(cluster)) clusterAcc.set(cluster, { val: 0, subTypes: new Map() });
        const c = clusterAcc.get(cluster);
        c.val += r[VAL];
        c.subTypes.set(rawSubType, (c.subTypes.get(rawSubType) || 0) + r[VAL]);
        totalVal += r[VAL];
      }

      const clusters = Array.from(clusterAcc.entries())
        .map(([name, c]) => ({
          name: name,
          actualValue: c.val,
          contributionPct: totalVal > 0 ? (c.val / totalVal) * 100 : null,
          customerCount: c.subTypes.size,
          customers: Array.from(c.subTypes.entries())
            .map(([subTypeName, val]) => ({
              name: subTypeName,
              actualValue: val,
              contributionPctOfCluster: c.val > 0 ? (val / c.val) * 100 : null,
              contributionPctOfTotal: totalVal > 0 ? (val / totalVal) * 100 : null,
            }))
            .sort((a, b) => b.actualValue - a.actualValue),
        }))
        .sort((a, b) => b.actualValue - a.actualValue);

      return {
        ok: true,
        status: 'ready',
        asOfDate: months[months.length - 1] || null,
        source: 'sales',
        bu: bu,
        line: line || 'All',
        unit: 'EGP',
        scope: 'Non-Tender transactions only, Value basis',
        totalActualValue: totalVal,
        clusters: clusters,
      };
    },

    /**
     * ENTERPRISE SEMANTIC INTERFACE -- getClusterCustomerHealth(bu, cluster)
     * ------------------------------------------------------------------
     * Customer Channel Mix's "Customer Health" drill (2026-07-28): unique
     * customers, New/Lost/Retained/Reactivated bridge, frequency
     * segmentation, and Full/Partial/None SKU-basket segmentation for one
     * cluster, plus the full per-customer list (for the paginated grid)
     * and the ranked SKU penetration list. Reads the SEPARATE Customer
     * Analytics cache (window.CUSTOMER_ANALYTICS_CACHE) -- see
     * decompressCustomerAnalyticsCache() above and
     * etl/build_customer_analytics_cache.py for why this isn't the same
     * cache getCustomerClusterMix() reads.
     *
     * Currently only covers clusters the ETL script has been run for
     * (Retail, Chain Pharmacy as of 2026-07-28) -- returns status
     * 'cluster_not_available' for any other cluster so callers can fall
     * back to the flatter sub_type list getCustomerClusterMix() already
     * provides, rather than showing broken/empty UI.
     *
     * `bu` narrows the customer list and re-derives every count from that
     * narrowed list (a customer counts toward a BU if ANY of their
     * transactions in this cluster were tagged to a line in that BU --
     * see the cache's per-customer `bus` field). Pass bu=null/"All" for
     * the company-wide, all-BU figure.
     *
     * PER-CUSTOMER FIELDS ARE ALSO BU-SCOPED WHEN `bu` IS SET (2026-07-31):
     * each returned customer row's monthsActive/distinctSkus/value/
     * bridgeSegment/frequencySegment/basketSegment/lines/items reflect
     * ONLY that BU's transactions -- not the customer's blended activity
     * across all 4 BUs -- via the cache's per-customer `byBU` field (see
     * etl/build_customer_analytics_cache.py). The summary bridge/
     * frequencyBuckets/basketBuckets counts below are tallied from these
     * same BU-scoped per-customer segments, so the summary bars and the
     * grid rows are always consistent with each other.
     *
     * SKU penetration is ALSO BU-scoped when `bu` is set (2026-07-28): the
     * returned `skuPenetration` list and its penetration %s reflect only
     * that BU's purchases and that BU's customer count as the denominator
     * -- see etl/build_customer_analytics_cache.py's skuPenetrationByBU.
     * `skuPenetrationScope` on the result tells the caller which list it
     * actually got ('All' or the BU name) in case of a fallback.
     */
    getClusterCustomerHealth(bu, cluster, line, dmName) {
      decompressCustomerAnalyticsCache();
      if (!customerAnalyticsCache) {
        return { ok: false, status: 'cache_unavailable', source: 'customerAnalytics', bu: bu || 'All', cluster: cluster };
      }
      const clusterData = customerAnalyticsCache.clusters && customerAnalyticsCache.clusters[cluster];
      if (!clusterData) {
        return { ok: false, status: 'cluster_not_available', source: 'customerAnalytics', bu: bu || 'All', cluster: cluster };
      }

      const wantBU = bu && bu !== 'All' ? bu : null;
      const wantLine = line && line !== 'All' ? line : null;
      // Line-scoping (2026-08-03, "position of chosen line"): the ETL's
      // byBU[bu].byLine[line] breakdown only exists in caches built after
      // this date -- feature-detect it so an older cache degrades to the
      // pre-existing BU-only scoping (Line filter simply has no effect)
      // instead of the customer list silently coming back empty.
      const lineDataAvailable = !!(wantBU && wantLine && clusterData.customers.some(c =>
        c.byBU && c.byBU[wantBU] && c.byBU[wantBU].byLine && Object.keys(c.byBU[wantBU].byLine).length > 0
      ));
      const effectiveLine = lineDataAvailable ? wantLine : null;

      let scopedCustomers = wantBU
        ? clusterData.customers.filter(c => c.bus && c.bus.indexOf(wantBU) >= 0)
        : clusterData.customers;

      // Narrow further to customers actually active under the chosen Line
      // within this BU -- a customer with zero byLine[effectiveLine] entry
      // never transacted under that Line at all.
      if (effectiveLine) {
        scopedCustomers = scopedCustomers.filter(c =>
          c.byBU && c.byBU[wantBU] && c.byBU[wantBU].byLine && c.byBU[wantBU].byLine[effectiveLine]
        );
      }

      // DM-scoping: filter to only customers who have positions under the selected DM
      if (dmName) {
        if (window.SFEDashboard && typeof window.SFEDashboard.getData === "function") {
          const sfeData = window.SFEDashboard.getData();
          if (sfeData) {
            const positionToDm = new Map();
            (sfeData.activePositions || []).forEach(p => {
              if (p.position && p.dm) {
                positionToDm.set(p.position.toUpperCase().trim(), p.dm.toUpperCase().trim());
              }
            });
            (sfeData.vacantPositions || []).forEach(p => {
              if (p.position && p.dm) {
                positionToDm.set(p.position.toUpperCase().trim(), p.dm.toUpperCase().trim());
              }
            });

            const targetDmUpper = dmName.toUpperCase().trim();
            scopedCustomers = scopedCustomers.filter(c => {
              const custPositions = (effectiveLine && c.byBU && c.byBU[wantBU] && c.byBU[wantBU].byLine && c.byBU[wantBU].byLine[effectiveLine] && c.byBU[wantBU].byLine[effectiveLine].positions)
                || (wantBU && c.byBU && c.byBU[wantBU] && c.byBU[wantBU].positions)
                || c.positions
                || [];
              return custPositions.some(p => {
                const cleanPos = p.toUpperCase().trim();
                const dm = positionToDm.get(cleanPos);
                return dm === targetDmUpper;
              });
            });
          }
        }
      }

      // LINE-LEVEL FILTERING FOR LINE MANAGERS (Added 2026-08-01):
      if (window.AUTH && window.AUTH.getScope().lines !== null) {
        const allowedLines = new Set(window.AUTH.getScope().lines);
        scopedCustomers = scopedCustomers.filter(c => {
          let cLines = [];
          if (wantBU) {
            cLines = (c.byBU && c.byBU[wantBU] && c.byBU[wantBU].lines) || [];
          } else {
            cLines = c.lines || [];
          }
          return cLines.some(l => allowedLines.has(l));
        });
      }
      // Per-BU item list + per-BU customer stats (2026-07-30 / 2026-07-31,
      // "distinct skus should refer to chosen bu and status/frequency/
      // basket/value should be related to chosen bu"): when a specific BU
      // is selected, overlay that customer's own SKU list, months-active,
      // distinct-SKU count, value, Status/Frequency/Basket segments, and
      // lines touched -- all scoped to ONLY that BU (etl/
      // build_customer_analytics_cache.py's itemsByBU + byBU, added
      // 2026-07-30/31) -- instead of the customer's blended activity across
      // all 4 BUs. Falls back to the pre-existing global fields (and an
      // empty items/lines list) for caches built before byBU existed, so
      // this stays safe to ship ahead of the next customer-analytics ETL
      // run -- no throw, just a less-scoped (but still correct) number.
  const LINE_PRODUCTS = {
    'GIT-I': ['BILASTIGEC', 'MEDIHYALO', 'NEXICURE', 'PRUCANETIC'],
    'GIT-II': ['BUTAZORELLA', 'ULCEBISMO', 'VONSECA'],
    'GIT-III': ['NEXICURE PLUS CAP', 'NEXICURE PLUS SACHETS', 'NEXICURE PLUS'],
    'CNS': ['DUXNORZET', 'EPILOSAMIDE', 'EPILOSMIDE', 'VORTAXMODE', 'ZETAZOLEX'],
    'NEUROSCIENCE': ['DUXNORZET', 'EPILOSAMIDE', 'EPILOSMIDE', 'VORTAXMODE', 'ZETAZOLEX'],
    'Derma': ['BILASTIGEC', 'MEDIHYALO'],
    'DERMA': ['BILASTIGEC', 'MEDIHYALO'],
    'CVM-I': ['NEXIROZOVA', 'ZETACOLEST', 'ZETACOLEST PLUS'],
    'CVM-II': ['ELIMBOSIS 5', 'ZETAKARDOVAL HCT', 'ZETAKARDOVAL'],
    'ORTHO-I': ['COXORIZET', 'DOZOVA FLEXETA'],
    'ORTHO-II': ['DUXNORZET', 'ELIMBOSIS 2.5'],
    'PEDIA': ['BILASTIGEC', 'DOZOVA', 'DOZOVA ALPHA AMYLASE', 'NEXIBRONCH', 'NEXICURE'],
    'DIAB-I': ['EMPACOZA'],
    'DIAB-II': ['EMPACOMBOMET'],
    'DIAB-III': ['EMPACOZA TRIO'],
    'DIAB-IV': ['EMPACOZA PLUS'],
    'CHC': ['DOZOVA'],
    'CHC_SALES': ['DOZOVA']
  };

  function isSkuAllowedForLines(skuName, allowedLines) {
    if (!allowedLines || allowedLines.size === 0) return true;
    var skuUp = skuName.toUpperCase().trim();
    
    // Normalize allowed lines to include synonyms
    var normAllowed = new Set();
    allowedLines.forEach(function(l) {
      normAllowed.add(l.toUpperCase());
      if (l.toUpperCase() === 'CNS') normAllowed.add('NEUROSCIENCE');
      if (l.toUpperCase() === 'NEUROSCIENCE') normAllowed.add('CNS');
      if (l.toUpperCase() === 'DERMA') normAllowed.add('DERMA');
      if (l.toUpperCase() === 'CHC') normAllowed.add('CHC_SALES');
      if (l.toUpperCase() === 'CHC_SALES') normAllowed.add('CHC');
    });

    var allProducts = [];
    var prodToLine = {};
    Object.keys(LINE_PRODUCTS).forEach(function(l) {
      var prods = LINE_PRODUCTS[l] || [];
      prods.forEach(function(p) {
        var pUp = p.toUpperCase().trim();
        allProducts.push(pUp);
        if (!prodToLine[pUp]) prodToLine[pUp] = [];
        prodToLine[pUp].push(l.toUpperCase());
      });
    });
    
    allProducts.sort(function(a, b) { return b.length - a.length; });
    
    var matchedProd = null;
    for (var i = 0; i < allProducts.length; i++) {
      var p = allProducts[i];
      if (skuUp.indexOf(p) >= 0) {
        matchedProd = p;
        break;
      }
    }
    
    if (matchedProd) {
      var linesOfProd = prodToLine[matchedProd];
      return linesOfProd.some(function(l) { return normAllowed.has(l); });
    }
    
    return true; // Keep it if no matching product (fallback)
  }

    // Refactored customers mapping with line-level SKU items filter:
    const customers = scopedCustomers.map(c => {
      const buStats = wantBU ? ((c.byBU && c.byBU[wantBU]) || null) : null;
      // Line-scoped stats (2026-08-03, "position of chosen line") -- overlay
      // ON TOP of buStats when the ETL's byLine breakdown exists for this
      // customer's exact BU+Line combo; falls back to buStats (the BU-
      // blended view) otherwise, same "no throw, less-scoped but correct"
      // convention as every other byBU field.
      const lineStats = (effectiveLine && buStats && buStats.byLine) ? (buStats.byLine[effectiveLine] || null) : null;
      let items = wantBU
        ? (effectiveLine && c.itemsByBULine && c.itemsByBULine[wantBU] && c.itemsByBULine[wantBU][effectiveLine]
            ? c.itemsByBULine[wantBU][effectiveLine]
            : ((c.itemsByBU && c.itemsByBU[wantBU]) || []))
        : (c.items || []);

      if (window.AUTH && window.AUTH.getScope().lines !== null) {
        const allowedLines = new Set(window.AUTH.getScope().lines);
        items = items.filter(itemName => isSkuAllowedForLines(itemName, allowedLines));
      }

      if (wantBU) {
        return Object.assign({}, c, {
          items: items,
          lines: (buStats && buStats.lines) || [],
          monthsActive: lineStats ? lineStats.monthsActive : (buStats ? buStats.monthsActive : c.monthsActive),
          distinctSkus: items.length,
          value: lineStats ? lineStats.value : (buStats ? buStats.value : c.value),
          bridgeSegment: lineStats ? lineStats.bridgeSegment : (buStats ? buStats.bridgeSegment : c.bridgeSegment),
          frequencySegment: lineStats ? lineStats.frequencySegment : (buStats ? buStats.frequencySegment : c.frequencySegment),
          basketSegment: lineStats ? lineStats.basketSegment : (buStats ? buStats.basketSegment : c.basketSegment),
          bricks: (lineStats && lineStats.bricks) || (buStats && buStats.bricks) || [],
          regions: (lineStats && lineStats.regions) || (buStats && buStats.regions) || [],
          positions: (lineStats && lineStats.positions) || (buStats && buStats.positions) || [],
          lastPurchase: lineStats ? lineStats.lastPurchase : (buStats ? buStats.lastPurchase : c.lastPurchase),
        });
      } else {
        return Object.assign({}, c, {
          items: items,
          distinctSkus: items.length,
        });
      }
    });

      // Recompute every aggregate from the (possibly BU-narrowed) customer
      // list rather than reusing the cache's pre-baked company-wide
      // totals, so bu-scoping is honest rather than approximate.
      const bridge = { new: 0, lost: 0, retained: 0, reactivated: 0 };
      const frequencyBuckets = { frequent: 0, occasional: 0, oneTime: 0 };
      const basketBuckets = { full: 0, partial: 0, none: 0 };
      customers.forEach(c => {
        const segKey = c.bridgeSegment === 'New' ? 'new' : c.bridgeSegment === 'Lost' ? 'lost'
          : c.bridgeSegment === 'Retained' ? 'retained' : c.bridgeSegment === 'Reactivated' ? 'reactivated' : null;
        if (segKey) bridge[segKey] += 1;
        const freqKey = c.frequencySegment === 'Frequent' ? 'frequent' : c.frequencySegment === 'Occasional' ? 'occasional' : 'oneTime';
        frequencyBuckets[freqKey] += 1;
        const basketKey = c.basketSegment === 'Full' ? 'full' : c.basketSegment === 'Partial' ? 'partial' : 'none';
        basketBuckets[basketKey] += 1;
      });

      let coreSkuCount = (wantBU && clusterData.coreSkuCountByBU && clusterData.coreSkuCountByBU[wantBU] != null)
        ? clusterData.coreSkuCountByBU[wantBU]
        : clusterData.coreSkuCount;
      let totalSkuCount = (wantBU && clusterData.totalSkuCountByBU && clusterData.totalSkuCountByBU[wantBU] != null)
        ? clusterData.totalSkuCountByBU[wantBU]
        : clusterData.totalSkuCount;
      let skuPenetration = (wantBU && clusterData.skuPenetrationByBU && clusterData.skuPenetrationByBU[wantBU])
        ? clusterData.skuPenetrationByBU[wantBU]
        : clusterData.skuPenetration;
      let skuPenetrationScope = (wantBU && clusterData.skuPenetrationByBU && clusterData.skuPenetrationByBU[wantBU]) ? wantBU : 'All';

      // Recalculate penetration stats dynamically whenever the customer
      // list has been narrowed BEYOND plain BU-scoping -- either an AUTH
      // line-restriction (Line Manager, added 2026-08-01) or a chosen Line
      // filter in the Executive filter bar (added 2026-08-03, "to be
      // dynamic when choosing cluster and line": the Top SKU Penetration
      // panel was still showing the BU-wide ranked list even when a Line
      // was picked -- Position/SKU in the customer grid already scoped to
      // the chosen Line via itemsByBULine, this panel hadn't caught up).
      //
      // Both cases can now share ONE code path: `customers[].items` is
      // ALREADY the fully-correct, fully-scoped item list at this point --
      // itemsByBULine handled the chosen-Line narrowing above (line ~3501),
      // and isSkuAllowedForLines has ALREADY been applied per-customer
      // above (line ~3507) for AUTH-restricted users regardless of Line
      // selection. So tallying straight from customers[].items is correct
      // for every combination, instead of re-filtering a separate list.
      //
      // KNOWN APPROXIMATION: `inCore` here is carried over from the BU-
      // level 80%-of-value core-SKU definition (etl's core_set_by_bu), not
      // re-derived per Line -- the ETL's core_set_by_bu_line exists
      // (2026-08-03) but isn't exposed to this cache yet. Good enough to
      // keep the "(core)" tag meaningful; a true Line-level core-SKU cut
      // would need that field piped through customer_analytics.json.
      const lineOrAuthNarrowed = !!effectiveLine || (window.AUTH && window.AUTH.getScope().lines !== null);
      if (lineOrAuthNarrowed) {
        const denom = customers.length || 1;
        const priorInCore = new Map((skuPenetration || []).map(s => [s.sku, !!s.inCore]));
        const skuTally = new Map();
        customers.forEach(c => {
          const seen = new Set(c.items || []); // de-dupe in case an item ever appears twice for one customer
          seen.forEach(sku => skuTally.set(sku, (skuTally.get(sku) || 0) + 1));
        });

        skuPenetration = Array.from(skuTally.entries()).map(([sku, count]) => ({
          sku: sku,
          count: count,
          penetrationPct: (count / denom) * 100,
          inCore: priorInCore.get(sku) || false,
        })).sort((a, b) => b.penetrationPct - a.penetrationPct);

        coreSkuCount = skuPenetration.filter(s => s.inCore).length;
        totalSkuCount = skuPenetration.length;
        skuPenetrationScope = effectiveLine
          || (window.AUTH && window.AUTH.getScope().lines ? window.AUTH.getScope().lines.join(", ") : skuPenetrationScope);
      }

      return {
        ok: true,
        status: 'ready',
        source: 'customerAnalytics',
        bu: bu || 'All',
        lines: (window.AUTH && window.AUTH.getScope().lines) || null,
        // Chosen-Line scoping (2026-08-03, "position of chosen line") --
        // distinct from `lines` above, which is the signed-in user's AUTH
        // restriction, not the Executive filter-bar selection.
        requestedLine: wantLine,
        effectiveLine: effectiveLine,
        lineDataAvailable: lineDataAvailable,
        cluster: cluster,
        months: clusterData.months,
        totalCustomers: customers.length,
        bridge: bridge,
        frequencyBuckets: frequencyBuckets,
        basketBuckets: basketBuckets,
        coreSkuCount: coreSkuCount,
        totalSkuCount: totalSkuCount,
        skuPenetration: skuPenetration,
        skuPenetrationScope: skuPenetrationScope,
        customers: customers,
        generatedAt: customerAnalyticsCache.generatedAt,
      };
    },

    getDmSalesSummary(bu, line, months, scenario) {
      decompressCache();
      if (!cache || !Array.isArray(decodedRows) || decodedRows.length === 0) {
        return { ok: false, status: 'cache_unavailable', asOfDate: null, source: 'sales', bu: bu, dms: [] };
      }
      if (typeof window.SEMANTIC === 'undefined') {
        console.error('[Sales] getDmSalesSummary() requires js/semantic-model.js to be loaded first.');
        return { ok: false, status: 'semantic_model_missing', asOfDate: null, source: 'sales', bu: bu, dms: [] };
      }
      if (window.AUTH && !window.AUTH.isBuAllowed(bu)) {
        return { ok: false, status: 'access_denied', asOfDate: null, source: 'sales', bu: bu, dms: [] };
      }
      scenario = window.SEMANTIC.isValidScenario(scenario) ? scenario : window.SEMANTIC.DEFAULT_SCENARIO;
      const wantOfficialByLine = buildLineScenarioMap(scenario);
      const linesLk = cache.lookups.lines;
      const dmsLk = cache.lookups.dms;
      const monthFilter = (Array.isArray(months) && months.length > 0) ? new Set(months.map(Number)) : null;

      const acc = new Map(); // dmName -> { val, tgtVal }
      const posByDm = new Map(); // dmName -> Set of deployed position codes
      for (let i = 0; i < decodedRows.length; i++) {
        const r = decodedRows[i];
        const rawLine = linesLk[r[LINE]];
        if (window.AUTH && !window.AUTH.isLineAllowed(rawLine)) continue;
        if (window.SEMANTIC.lineToBU(rawLine) !== bu) continue;
        const canonLine = window.SEMANTIC.normalizeLine(rawLine);
        if (line && line !== "All" && canonLine !== line) continue;
        if (monthFilter && !monthFilter.has(r[MONTH])) continue;

        const dmName = dmsLk[r[DM]];
        if (!dmName || dmName === "(none)") continue;

        const rowPos = cache.lookups.rep_positions[r[REP]];
        if (rowPos && !EXCLUDED_POSITIONS.has(rowPos)) {
          if (!posByDm.has(dmName)) posByDm.set(dmName, new Set());
          posByDm.get(dmName).add(rowPos);
        }
        const isTender = (r[MASK] & 2) > 0;
        if (isTender) continue; // Non-Tender only -- see header comment
        if (!acc.has(dmName)) acc.set(dmName, { val: 0, tgtVal: 0 });
        const a = acc.get(dmName);
        a.val += r[VAL];
        if (includeTargetRow(r[MASK], wantOfficialByLine[r[LINE]])) a.tgtVal += r[TGT_VAL];
      }

      const dms = Array.from(acc.entries())
        .map(([name, a]) => {
          const activePositions = posByDm.has(name) ? posByDm.get(name).size : 0;
          return {
            name: name,
            actualValue: a.val,
            targetValue: a.tgtVal,
            achievementPct: a.tgtVal > 0 ? (a.val / a.tgtVal) * 100 : null,
            activePositions: activePositions,
            salesPerPosition: activePositions > 0 ? a.val / activePositions : null,
          };
        });

      const monthsLk = cache.lookups.months;
      const lastIdx = monthsLk.length - 1;

      return {
        ok: true,
        status: 'ready',
        asOfDate: monthsLk[lastIdx] || null,
        source: 'sales',
        bu: bu,
        line: line || 'All',
        scope: 'Non-Tender transactions only, Value basis',
        scenario: scenario,
        dms: dms,
      };
    },

    getRepPositionsMap() {
      decompressCache();
      if (!cache || !cache.lookups) return {};
      const reps = cache.lookups.reps || [];
      const positions = cache.lookups.rep_positions || [];
      const map = {};
      reps.forEach((name, i) => {
        if (name && positions[i]) {
          map[name.toUpperCase().trim()] = positions[i];
        }
      });
      return map;
    },

    getDmRepsSalesSummary(bu, line, dmName, months, scenario) {
      decompressCache();
      if (!cache || !Array.isArray(decodedRows) || decodedRows.length === 0) return {};
      scenario = (window.SEMANTIC && window.SEMANTIC.isValidScenario(scenario)) ? scenario : (window.SEMANTIC ? window.SEMANTIC.DEFAULT_SCENARIO : "official");
      const wantOfficialByLine = window.SEMANTIC ? buildLineScenarioMap(scenario) : [];
      const dmsLk = cache.lookups.dms;
      const linesLk = cache.lookups.lines;
      const repsLk = cache.lookups.reps;
      const monthFilter = (Array.isArray(months) && months.length > 0) ? new Set(months.map(Number)) : null;

      const targetDmUpper = dmName ? dmName.toUpperCase().trim() : "";
      const map = {}; // repName (uppercase) -> { val, tgtVal }

      for (let i = 0; i < decodedRows.length; i++) {
        const r = decodedRows[i];
        const rawLine = linesLk[r[LINE]];
        if (window.AUTH && !window.AUTH.isLineAllowed(rawLine)) continue;
        if (window.SEMANTIC.lineToBU(rawLine) !== bu) continue;
        const canonLine = window.SEMANTIC.normalizeLine(rawLine);
        if (line && line !== "All" && canonLine !== line) continue;
        if (monthFilter && !monthFilter.has(r[MONTH])) continue;

        const rowDmName = dmsLk[r[DM]];
        if (!rowDmName || rowDmName.toUpperCase().trim() !== targetDmUpper) continue;

        const isTender = (r[MASK] & 2) > 0;
        if (isTender) continue;

        const repName = repsLk[r[REP]];
        if (!repName) continue;
        const key = repName.toUpperCase().trim();
        if (!map[key]) {
          map[key] = { val: 0, tgtVal: 0 };
        }
        map[key].val += r[VAL] || 0;
        if (includeTargetRow(r[MASK], wantOfficialByLine[r[LINE]])) map[key].tgtVal += r[TGT_VAL] || 0;
      }
      return map;
    },

    getSalesSummaryForDm(bu, line, dmName, scenario) {
      decompressCache();
      if (!cache || !Array.isArray(decodedRows) || decodedRows.length === 0) {
        return { ok: false };
      }
      scenario = (window.SEMANTIC && window.SEMANTIC.isValidScenario(scenario)) ? scenario : (window.SEMANTIC ? window.SEMANTIC.DEFAULT_SCENARIO : "official");
      const wantOfficialByLine = window.SEMANTIC ? buildLineScenarioMap(scenario) : [];
      const linesLk = cache.lookups.lines;
      const dmsLk = cache.lookups.dms;

      const targetDmUpper = dmName ? dmName.toUpperCase().trim() : "";
      let actualValue = 0, targetValue = 0;
      let actualQty = 0, targetQty = 0;

      for (let i = 0; i < decodedRows.length; i++) {
        const r = decodedRows[i];
        const rawLine = linesLk[r[LINE]];
        if (window.AUTH && !window.AUTH.isLineAllowed(rawLine)) continue;
        if (window.SEMANTIC.lineToBU(rawLine) !== bu) continue;
        const canonLine = window.SEMANTIC.normalizeLine(rawLine);
        if (line && line !== "All" && canonLine !== line) continue;

        const dmRowName = dmsLk[r[DM]];
        if (!dmRowName || dmRowName.toUpperCase().trim() !== targetDmUpper) continue;

        const isTender = (r[MASK] & 2) > 0;
        if (isTender) continue;

        actualValue += r[VAL] || 0;
        actualQty += r[QTY] || 0;
        if (includeTargetRow(r[MASK], wantOfficialByLine[r[LINE]])) {
          targetValue += r[TGT_VAL] || 0;
          targetQty += r[TGT_QTY] || 0;
        }
      }

      return {
        ok: true,
        actualValue: actualValue,
        targetValue: targetValue,
        achievementPct: targetValue > 0 ? (actualValue / targetValue) * 100 : null,
        actualQty: actualQty,
        targetQty: targetQty,
        qtyAchievementPct: targetQty > 0 ? (actualQty / targetQty) * 100 : null
      };
    },

    getCustomerClusterMixForDm(bu, line, dmName) {
      decompressCache();
      if (!cache || !Array.isArray(decodedRows) || decodedRows.length === 0) {
        return { ok: false, status: 'cache_unavailable', asOfDate: null, source: 'sales', bu: bu, line: line || 'All', clusters: [] };
      }
      if (typeof window.SEMANTIC === 'undefined') {
        return { ok: false, status: 'semantic_model_missing', asOfDate: null, source: 'sales', bu: bu, line: line || 'All', clusters: [] };
      }
      const linesLk = cache.lookups.lines;
      const subTypesLk = cache.lookups.sub_types;
      const dmsLk = cache.lookups.dms;
      const months = cache.lookups.months;

      const targetDmUpper = dmName ? dmName.toUpperCase().trim() : "";
      const clusterAcc = new Map();
      let totalVal = 0;

      for (let i = 0; i < decodedRows.length; i++) {
        const r = decodedRows[i];
        const rawLine = linesLk[r[LINE]];
        if (window.AUTH && !window.AUTH.isLineAllowed(rawLine)) continue;
        if (window.SEMANTIC.lineToBU(rawLine) !== bu) continue;
        const canonLine = window.SEMANTIC.normalizeLine(rawLine);
        if (line && line !== "All" && canonLine !== line) continue;

        const dmRowName = dmsLk[r[DM]];
        if (!dmRowName || dmRowName.toUpperCase().trim() !== targetDmUpper) continue;

        const isTender = (r[MASK] & 2) > 0;
        if (isTender) continue;

        const rawSubType = subTypesLk[r[STYPE]];
        const cluster = subTypeToCluster(rawSubType);
        if (cluster === null) continue;

        if (!clusterAcc.has(cluster)) clusterAcc.set(cluster, { val: 0, subTypes: new Map() });
        const c = clusterAcc.get(cluster);
        c.val += r[VAL] || 0;
        c.subTypes.set(rawSubType, (c.subTypes.get(rawSubType) || 0) + (r[VAL] || 0));
        totalVal += r[VAL] || 0;
      }

      const clusters = Array.from(clusterAcc.entries())
        .map(([name, c]) => ({
          name: name,
          actualValue: c.val,
          contributionPct: totalVal > 0 ? (c.val / totalVal) * 100 : null,
          customerCount: c.subTypes.size,
          customers: Array.from(c.subTypes.entries())
            .map(([subTypeName, val]) => ({
              name: subTypeName,
              actualValue: val,
              contributionPctOfCluster: c.val > 0 ? (val / c.val) * 100 : null,
              contributionPctOfTotal: totalVal > 0 ? (val / totalVal) * 100 : null,
            }))
            .sort((a, b) => b.actualValue - a.actualValue),
        }))
        .sort((a, b) => b.actualValue - a.actualValue);

      return {
        ok: true,
        status: 'ready',
        asOfDate: months[months.length - 1] || null,
        source: 'sales',
        bu: bu,
        line: line || 'All',
        unit: 'EGP',
        scope: 'Non-Tender transactions only, Value basis, filtered for DM ' + dmName,
        totalActualValue: totalVal,
        clusters: clusters,
      };
    },

    // Target Scenario (2026-08-04 same-day fix): lets other modules
    // (executive.js) know whether Official/Working actually differentiate
    // real data yet, so they can show the same "activates after refresh"
    // note next to their own Target Basis control rather than let a
    // no-op toggle look broken. Deliberately excluded from heavyFns
    // memoization below -- it's a cheap boolean read, not a data
    // aggregation, and must always reflect the live cache state.
    isScenarioDataAvailable() {
      decompressCache();
      return scenarioSchemaAvailable();
    },

    setFilters(newFilters) {
      if (!newFilters) return;
      decompressCache();
      if (!cache || !cache.lookups) return;
      
      if (newFilters.line !== undefined) {
        if (newFilters.line === null || newFilters.line === "All") {
          STATE.line = "all";
        } else {
          const idx = cache.lookups.lines.findIndex(l => window.SEMANTIC.normalizeLine(l) === newFilters.line);
          if (idx !== -1) STATE.line = [idx];
        }
      }
      if (newFilters.brand !== undefined) {
        if (newFilters.brand === null || newFilters.brand === "All") {
          STATE.brand = "all";
        } else {
          const idx = cache.lookups.brands.findIndex(b => b.toUpperCase().trim() === newFilters.brand.toUpperCase().trim());
          if (idx !== -1) STATE.brand = [idx];
        }
      }
      if (newFilters.dm !== undefined) {
        if (newFilters.dm === null || newFilters.dm === "All") {
          STATE.dm = "all";
        } else {
          const idx = cache.lookups.dms.findIndex(d => d.toUpperCase().trim() === newFilters.dm.toUpperCase().trim());
          if (idx !== -1) STATE.dm = [idx];
        }
      }
      if (newFilters.scenario !== undefined) {
        if (window.AUTH && window.AUTH.setActiveScenario(newFilters.scenario)) {
          STATE.scenario = newFilters.scenario;
        }
      }
      
      renderLayout();
    },

    destroy() {
      document.body.classList.remove('sales-mode');
      destroyCharts();
      _memoCache = {}; // free memoized cache memory
    }
  };

  // Memoization wrapper to solve boot performance issues (2026-08-01)
  let _memoCache = {};
  const heavyFns = [
    "getBusinessSummary",
    "getSalesAchievementSummary",
    "getLineSalesSummary",
    "getCustomerClusterMix",
    "getBrandAchievement",
    "getItemAchievement",
    "getDmSalesSummary",
    "getRepPositionsMap",
    "getDmRepsSalesSummary",
    "getSalesSummaryForDm",
    "getCustomerClusterMixForDm"
  ];
  heavyFns.forEach(fnName => {
    const orig = window.SalesDashboard[fnName];
    if (typeof orig === "function") {
      window.SalesDashboard[fnName] = function(...args) {
        const userEmail = (window.AUTH && window.AUTH.getValidSessionUser()) ? window.AUTH.getValidSessionUser().email : "guest";
        const cleanArgs = args.map(arg => {
          if (arg instanceof Set) return Array.from(arg).sort();
          return arg;
        });
        const key = userEmail + "_" + fnName + "_" + JSON.stringify(cleanArgs);
        if (_memoCache.hasOwnProperty(key)) {
          return _memoCache[key];
        }
        const result = orig.apply(this, args);
        _memoCache[key] = result;
        return result;
      };
    }
  });
})();
