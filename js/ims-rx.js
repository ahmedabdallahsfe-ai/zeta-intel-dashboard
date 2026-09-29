/**
 * js/ims-rx.js
 * =============================================================================
 * IMS Rx -- physician-panel prescription-volume market intelligence workspace.
 *
 * SOURCE: cache/ims_rx.data.js (window.IMS_RX_CACHE.b64Data), built by
 * etl/build_ims_rx_cache.py from "IMS RX TOTAL YEAR 2025.xlsx" (a Rx-COUNT
 * physician-panel audit, 3 annual MAT snapshots: Dec 2023 / 2024 / 2025) with
 * Corporation joined in from "IMS 2022 to April 2026.xlsx" (the Total Market
 * Intelligence source) by brand-name match. See that ETL script's header for
 * the full data-quality writeup: exact-duplicate dedup, retirement of the
 * broken "Dosage Form" VLOOKUP column, the dosage_form_category replacement,
 * and the Corporation-join confidence levels (unmatched / ambiguous /
 * unambiguous). Also see IMS_RX_2025_Assessment.docx for the underlying
 * data-discovery and architecture assessment this page implements.
 *
 * Loaded via the standard eager <script defer> cache pattern (see
 * dashboard.html) -- decompressed lazily on first init() via pako, same
 * gzip+base64 convention as every other cache on this platform, because this
 * dashboard runs over file:// and Chrome blocks fetch()/XHR to local files.
 *
 * PAGE STATUS: this file implements pages 1-3 of the recommended 5-page
 * architecture (assessment Section H) -- Executive Market Overview, Market
 * Dynamics, and Company Performance. The remaining pages (Product
 * Performance, Molecule & Diagnosis Deep Dive, Watchlist & Data Quality) are
 * queued as separate follow-on builds. STATE.subTab / getPageContentHTML()
 * below already anticipate a .sc-nav-tabs sub-page switcher (same global
 * classes Sprint and Sales reuse from dashboard.css) for when they land --
 * adding a page is: write a render*() function, add one entry to the NAV_TABS
 * array, add one branch to getPageContentHTML(). No other wiring changes.
 *
 * COMPANY PERFORMANCE (this page) attributes Rx to a Corporation using the
 * SAME brand-name join as the Product Spotlight -- ONLY products with
 * corpConfidence === 2 (unambiguous) are rolled up into a company. Ambiguous
 * (multiple manufacturers, e.g. off-patent generics) and unmatched products
 * are deliberately excluded from every company total rather than guessed --
 * see the "Attributable to a Company" KPI, which reports what fraction of
 * in-scope Rx that exclusion actually covers so the leaderboard is never
 * mistaken for 100% of the market.
 *
 * DENOMINATOR / GROWTH DISCIPLINE (assessment Section G -- read before
 * touching this file): every growth and share figure on this page is
 * computed HERE, at query time, as SUM(current) vs SUM(prior), aggregated
 * first and divided once. The source file's own row-level "Growth % PP"
 * column is NEVER read by this module -- it is unsafe (27% of its populated
 * values are a hard -100% against a NULL, not zero, current-period volume).
 * Do not add a KPI that averages or sums a stored percentage.
 * =============================================================================
 */
(function () {
  "use strict";

  const REQUIRED_SCHEMA_VERSION = 1;
  const BANNER_DISMISS_KEY = "imsrx_banner_dismissed_v1";

  let cache = null;
  let charts = [];

  const STATE = { subTab: "overview" };

  const NAV_TABS = [
    ["overview", "🧭 Executive Overview"],
    ["dynamics", "📈 Market Dynamics"],
    ["company", "🏢 Company Performance"],
    ["geo", "🗺️ Geo & Specialty"],
    // Queued, not yet built -- see file header. Left commented rather than
    // rendered-but-broken so the nav bar never advertises a page that
    // doesn't exist yet:
    // ["product", "💊 Product Performance"],
    // ["molecule", "🔬 Molecule & Diagnosis"],
    // ["watchlist", "🔍 Watchlist & Data Quality"],
  ];

  // -------------------------------------------------------------------
  // Cache load / decompress (mirrors js/sprint.js's gunzipB64Json exactly)
  // -------------------------------------------------------------------

  function gunzipB64Json(b64) {
    const strData = atob(b64);
    const bytes = new Uint8Array(strData.length);
    for (let i = 0; i < strData.length; i++) bytes[i] = strData.charCodeAt(i);
    return JSON.parse(pako.ungzip(bytes, { to: "string" }));
  }

  function decompressCache() {
    if (cache) return;
    if (!window.IMS_RX_CACHE) return;
    try {
      const t0 = performance.now();
      cache = gunzipB64Json(window.IMS_RX_CACHE.b64Data);
      buildCompanyIndex();
      buildMarketIndex();
      console.log(`[IMS Rx] Cache loaded & decompressed in ${(performance.now() - t0).toFixed(1)}ms.`);
    } catch (e) {
      console.error("[IMS Rx] Failed to decompress IMS Rx cache", e);
    }
  }

  // -------------------------------------------------------------------
  // Company index -- derived once from lookups.corps / corpConfidence.
  // ONLY corpConfidence === 2 (unambiguous single-manufacturer match)
  // products are attributed to a company; ambiguous (1) and unmatched (0)
  // products get companyOfProduct = -1 and are excluded from every
  // company-level rollup (see COMPANY PERFORMANCE note in file header).
  // -------------------------------------------------------------------

  let companyOfProduct = null; // parallel to lookups.products; -1 = not attributable
  let companyNames = null;     // company display names, index = companyIdx

  function buildCompanyIndex() {
    if (companyOfProduct) return;
    const products = cache.lookups.products;
    const corps = cache.lookups.corps;
    const conf = cache.lookups.corpConfidence;
    const nameToIdx = new Map();
    companyNames = [];
    companyOfProduct = new Array(products.length).fill(-1);
    for (let p = 0; p < products.length; p++) {
      if (conf[p] !== 2) continue;
      const name = corps[p] && corps[p][0];
      if (!name) continue;
      let idx = nameToIdx.get(name);
      if (idx === undefined) {
        idx = companyNames.length;
        companyNames.push(name);
        nameToIdx.set(name, idx);
      }
      companyOfProduct[p] = idx;
    }
  }

  // "companies" isn't a real cache.lookups array -- it's synthesized by
  // buildCompanyIndex(). Every place that resolves a filter spec's display
  // names goes through this, on both Market Dynamics (md*) and Company
  // Performance (cf*).
  // -------------------------------------------------------------------
  // DM1 / DM2 market index (added 2026-09-28). lookups.prodAtc4Dm is built
  // by etl/build_ims_rx_cache.py's attach_market_defs() from cache/iqvia.json
  // -- the SAME DEFIND Market_1/2 definitions Market Intelligence uses,
  // joined on Product + ATC4. MEMBERSHIP, not allocation: IMS Rx is
  // brand-level (no strength/pack), so a brand whose IQVIA SKUs sit in two
  // markets (e.g. ELEMBOSIS 2.5 and 5) counts fully in BOTH. Market totals
  // overlap -- never sum Rx across DM selections as if they were exclusive.
  // A row with no market returns [] and is excluded when a DM filter is on.
  // -------------------------------------------------------------------

  let marketOfPair = null; // Map(product*atc4Count + atc4 -> {dm1:[..], dm2:[..]})
  const NO_MARKETS = [];

  function buildMarketIndex() {
    if (marketOfPair) return;
    marketOfPair = new Map();
    const L = cache.lookups;
    const k = (L.atc4s || []).length;
    (L.prodAtc4Dm || []).forEach((r) => {
      marketOfPair.set(r[0] * k + r[1], { dm1: r[2], dm2: r[3] });
    });
  }

  function hasMarketDefs() {
    return !!(cache && cache.lookups && cache.lookups.dm1s && cache.lookups.dm1s.length);
  }

  function marketsOfRow(base, which) {
    if (!marketOfPair) buildMarketIndex();
    const f = cache.fact;
    const key = f.rows[base + f.fields.indexOf("product")] * cache.lookups.atc4s.length
      + f.rows[base + f.fields.indexOf("atc4")];
    const m = marketOfPair.get(key);
    return m ? m[which] : NO_MARKETS;
  }

  /** Filter membership test that understands multi-valued fields (DM1/DM2
   * return an array of market indices; every other field a single index). */
  function selHasValue(sel, v) {
    if (Array.isArray(v)) {
      for (let j = 0; j < v.length; j++) if (sel.has(v[j])) return true;
      return false;
    }
    return sel.has(v);
  }

  /** Visible filter specs -- DM filters are hidden when the loaded cache
   * predates the market-definition step (no lookups.dm1s). */
  function visibleSpecs(specs) {
    return hasMarketDefs() ? specs : specs.filter((s) => !s.multi);
  }

  function namesForSpec(spec) {
    return spec.key === "company" ? companyNames : cache.lookups[spec.lookup];
  }

  function isCacheStale() {
    if (!window.IMS_RX_CACHE) return true;
    if (!cache) return true;
    if (!cache.meta || cache.meta.schemaVersion < REQUIRED_SCHEMA_VERSION) return true;
    return false;
  }

  function renderCacheMissing() {
    const root = document.getElementById("app-root");
    if (!root) return;
    root.innerHTML = (window.DS && typeof window.DS.emptyState === "function")
      ? `<div class="imsrx-page"><div style="max-width:520px;margin:80px auto;text-align:center;">${window.DS.emptyState({
          icon: "\u{1F48A}",
          title: "IMS Rx data not loaded",
          hint: "cache/ims_rx.data.js is missing or unreadable. Run etl/build_ims_rx_cache.py, then reload.",
        })}</div></div>`
      : '<div style="padding:40px;text-align:center;color:#64748B;">IMS Rx cache not found. Run etl/build_ims_rx_cache.py.</div>';
  }

  // -------------------------------------------------------------------
  // Aggregate-first KPI math -- see module header. Nothing here reads a
  // stored percentage; everything sums raw Rx first, divides once.
  // -------------------------------------------------------------------

  function totalsByPeriod() {
    const f = cache.fact;
    const periodIdx = f.fields.indexOf("period");
    const totals = [0, 0, 0];
    for (let i = 0; i < f.rx.length; i++) {
      totals[f.rows[i * f.stride + periodIdx]] += f.rx[i];
    }
    return totals; // [MAT2023, MAT2024, MAT2025]
  }

  function atc3Movers() {
    const f = cache.fact;
    const periodIdx = f.fields.indexOf("period");
    const atc4Idx = f.fields.indexOf("atc4");
    const atc4Parent = cache.lookups.atc4ParentAtc3;
    const atc3Names = cache.lookups.atc3s;

    const byAtc3 = new Map(); // atc3Index -> { p1: MAT2024 sum, p2: MAT2025 sum }
    for (let i = 0; i < f.rx.length; i++) {
      const base = i * f.stride;
      const p = f.rows[base + periodIdx];
      if (p !== 1 && p !== 2) continue;
      const a3 = atc4Parent[f.rows[base + atc4Idx]];
      if (!byAtc3.has(a3)) byAtc3.set(a3, { p1: 0, p2: 0 });
      const e = byAtc3.get(a3);
      if (p === 1) e.p1 += f.rx[i]; else e.p2 += f.rx[i];
    }

    const movers = [];
    byAtc3.forEach((e, a3) => {
      movers.push({ name: atc3Names[a3], delta: e.p2 - e.p1 });
    });
    return movers;
  }

  function computeKPIs() {
    const [t2023, t2024, t2025] = totalsByPeriod();
    const yoy = t2024 ? (t2025 - t2024) / t2024 * 100 : null;
    const cagr = t2023 > 0 ? (Math.pow(t2025 / t2023, 1 / 2) - 1) * 100 : null;
    const corpCov = cache.meta.corpJoinCoverageMatDec2025 || null;
    return {
      total2025: t2025,
      yoy,
      cagr,
      productsTracked: cache.lookups.products.length,
      corpUnambiguousPct: corpCov ? corpCov.unambiguousPct : null,
    };
  }

  // =====================================================================
  // MARKET DYNAMICS -- filterable prescriber / product / molecule / ATC4 /
  // region / dosage-form analysis, styled after the Total Market
  // Intelligence workspace's filter-bar + KPI-card + ranked-table pattern
  // (js/market-intel.js: FILTER_SPECS / renderFilterBar / rankedRows /
  // renderZetaPanel). Self-contained classes (.imsrx-*), not a dependency
  // on css/market-intel.css -- see css/imsrx.css header.
  // =====================================================================

  // Filter state. Each entry is null ("all") or a Set of lookup indices,
  // exactly like market-intel.js's Fx -- same reasoning: O(1) membership
  // tests over a quarter-million fact rows on every filter change.
  let MDx = null;
  function resetMdFilters() {
    MDx = {
      period: new Set([2]),   // defaults to MAT Dec 2025
      product: null, company: null, dm1: null, dm2: null, molecule: null, atc3: null, atc4: null,
      specialty: null, region: null, cat: null,
    };
  }

  // spec.field is a literal fact field name, except "atc3" (derived from
  // atc4 via atc4ParentAtc3) and "company" (derived from product via
  // companyOfProduct -- see buildCompanyIndex) -- neither has a fact
  // column of its own.
  const MD_FILTER_SPECS = [
    { key: "period", label: "Period", lookup: "periods", field: "period", sort: "index" },
    { key: "product", label: "Product", lookup: "products", field: "product" },
    { key: "company", label: "Company", lookup: "companies", field: "company" },
    { key: "dm1", label: "Market (DM1)", lookup: "dm1s", field: "dm1", multi: true },
    { key: "dm2", label: "Market (DM2)", lookup: "dm2s", field: "dm2", multi: true },
    { key: "molecule", label: "Molecule", lookup: "molecules", field: "molecule" },
    { key: "atc3", label: "ATC3", lookup: "atc3s", field: "atc3" },
    { key: "atc4", label: "ATC4", lookup: "atc4s", field: "atc4" },
    { key: "specialty", label: "Prescriber Specialty", lookup: "specialties", field: "specialty" },
    { key: "region", label: "Region", lookup: "regions", field: "region" },
    { key: "cat", label: "Dosage Form", lookup: "dosageFormCategories", field: "dosageFormCategory" },
  ];

  function mdFieldValue(base, fieldKey) {
    const f = cache.fact;
    if (fieldKey === "dm1" || fieldKey === "dm2") return marketsOfRow(base, fieldKey);
    if (fieldKey === "atc3") {
      return cache.lookups.atc4ParentAtc3[f.rows[base + f.fields.indexOf("atc4")]];
    }
    if (fieldKey === "company") {
      return companyOfProduct[f.rows[base + f.fields.indexOf("product")]];
    }
    return f.rows[base + f.fields.indexOf(fieldKey)];
  }

  function mdRowMatches(base, excludeKey) {
    for (let s = 0; s < MD_FILTER_SPECS.length; s++) {
      const spec = MD_FILTER_SPECS[s];
      if (spec.key === excludeKey) continue;
      const sel = MDx[spec.key];
      if (!sel || sel.size === 0) continue;
      if (!selHasValue(sel, mdFieldValue(base, spec.field))) return false;
    }
    return true;
  }

  /** Faceted option list for one filter: aggregate Rx per distinct value
   * of spec.field, applying every OTHER active filter (not this one's own
   * dimension) so picking a Region doesn't erase the other Region options. */
  function mdOptionsFor(spec) {
    const f = cache.fact;
    const stride = f.stride;
    const names = namesForSpec(spec);
    const acc = new Map();
    for (let i = 0; i < f.rx.length; i++) {
      const base = i * stride;
      if (!mdRowMatches(base, spec.key)) continue;
      const v = mdFieldValue(base, spec.field);
      if (Array.isArray(v)) { v.forEach((m) => acc.set(m, (acc.get(m) || 0) + f.rx[i])); continue; }
      acc.set(v, (acc.get(v) || 0) + f.rx[i]);
    }
    const out = [];
    acc.forEach((val, idx) => {
      if (idx < 0 || names[idx] === undefined) return; // -1 = unattributed company, not selectable
      out.push({ idx, label: String(names[idx]), value: val });
    });
    if (spec.sort === "index") out.sort((a, b) => a.idx - b.idx);
    else out.sort((a, b) => b.value - a.value);
    return out;
  }

  /** Rx aggregated by one dimension, under ALL current filters (including
   * that dimension's own selection, unlike mdOptionsFor) -- used for the
   * breakdown charts/tables, e.g. "Rx by Specialty" scoped to whatever
   * Product/Region/etc. is currently selected. */
  function mdRankedRows(fieldKey, lookupKey) {
    const f = cache.fact;
    const stride = f.stride;
    const names = cache.lookups[lookupKey];
    const acc = new Map();
    for (let i = 0; i < f.rx.length; i++) {
      const base = i * stride;
      if (!mdRowMatches(base, null)) continue;
      const v = mdFieldValue(base, fieldKey);
      acc.set(v, (acc.get(v) || 0) + f.rx[i]);
    }
    const rows = [];
    acc.forEach((val, idx) => {
      if (names[idx] === undefined) return;
      rows.push({ idx, name: String(names[idx]), value: val });
    });
    rows.sort((a, b) => b.value - a.value);
    return rows;
  }

  function mdFilteredTotal() {
    const f = cache.fact;
    const stride = f.stride;
    let total = 0;
    let products = new Set();
    let molecules = new Set();
    for (let i = 0; i < f.rx.length; i++) {
      const base = i * stride;
      if (!mdRowMatches(base, null)) continue;
      total += f.rx[i];
      products.add(f.rows[base + f.fields.indexOf("product")]);
      molecules.add(f.rows[base + f.fields.indexOf("molecule")]);
    }
    return { total, productCount: products.size, moleculeCount: molecules.size };
  }

  function mdActiveFilterCount() {
    let n = 0;
    MD_FILTER_SPECS.forEach((s) => { if (MDx[s.key] && MDx[s.key].size > 0 && s.key !== "period") n++; });
    return n;
  }

  function mdFilterSummary(spec) {
    const sel = MDx[spec.key];
    const n = sel ? sel.size : 0;
    if (n === 0) return "All";
    if (n === 1) {
      let only = null;
      sel.forEach((i) => { only = i; });
      const names = namesForSpec(spec);
      return String(names[only]);
    }
    return n + " selected";
  }

  // ---- rendering -------------------------------------------------------

  function mdRenderFilterBar() {
    let h = '<div class="imsrx-filterbar">';
    visibleSpecs(MD_FILTER_SPECS).forEach((spec) => {
      const opts = mdOptionsFor(spec);
      const sel = MDx[spec.key];
      const n = sel ? sel.size : 0;
      const summary = mdFilterSummary(spec);
      h += `<div class="imsrx-f" data-f="${spec.key}">
        <label class="imsrx-f-label">${spec.label}${n ? `<span class="imsrx-f-count">${n}</span>` : ""}</label>
        <button type="button" class="imsrx-f-btn" data-open="${spec.key}" title="${escAttr(summary)}">
          <span class="imsrx-f-sum">${escAttr(summary)}</span><span class="imsrx-f-caret">▾</span>
        </button>
        <div class="imsrx-f-menu" data-menu="${spec.key}" hidden>
          <input type="text" class="imsrx-f-search" placeholder="Search ${spec.label}…" />
          <div class="imsrx-f-actions">
            <button type="button" data-all="${spec.key}">Select all</button>
            <button type="button" data-none="${spec.key}">Clear</button>
          </div>
          <div class="imsrx-f-list">
            ${opts.map((o) => {
              const on = sel && sel.has(o.idx);
              return `<label class="imsrx-f-opt${on ? " on" : ""}">
                <input type="checkbox" data-k="${spec.key}" value="${o.idx}"${on ? " checked" : ""} />
                <span class="imsrx-f-opt-lbl">${escAttr(o.label)}</span>
                <span class="imsrx-f-opt-val">${fmtBig(o.value)}</span></label>`;
            }).join("")}
          </div>
        </div>
      </div>`;
    });
    if (MDx.dm1 || MDx.dm2) h += `<div class="imsrx-dm-note" style="flex-basis:100%;font-size:11px;color:var(--txt3,#64748B);margin-top:4px">Market (DM1/DM2) uses the IQVIA market definitions (Product + ATC4). IMS Rx is brand-level, so a brand in several markets (e.g. different strengths) counts fully in each &mdash; don't add market totals together.</div>`;
    h += `<button type="button" class="imsrx-reset" id="imsrx-md-reset">Reset filters${mdActiveFilterCount() ? ` (${mdActiveFilterCount()})` : ""}</button>`;
    h += "</div>";
    return h;
  }

  function mdKpisHtml() {
    const { total, productCount, moleculeCount } = mdFilteredTotal();
    return `
      <div class="imsrx-stats-row imsrx-stats-row-4">
        <div class="imsrx-stat-tile imsrx-stat-highlight">
          <div class="imsrx-stat-label">Rx in Scope</div>
          <div class="imsrx-stat-value">${fmtBig(total)}</div>
        </div>
        <div class="imsrx-stat-tile">
          <div class="imsrx-stat-label">Products in Scope</div>
          <div class="imsrx-stat-value">${productCount.toLocaleString()}</div>
        </div>
        <div class="imsrx-stat-tile">
          <div class="imsrx-stat-label">Molecules in Scope</div>
          <div class="imsrx-stat-value">${moleculeCount.toLocaleString()}</div>
        </div>
        <div class="imsrx-stat-tile">
          <div class="imsrx-stat-label">Active Filters</div>
          <div class="imsrx-stat-value">${mdActiveFilterCount()}</div>
        </div>
      </div>`;
  }

  function mdRankedTableHtml(rows, label, limit) {
    if (!rows.length) return '<div class="imsrx-empty">No data matches the current filters.</div>';
    const shown = rows.slice(0, limit || 10);
    const maxV = shown[0] ? shown[0].value : 0;
    const hasMi = shown.some((r) => r.units !== undefined || r.salesValue !== undefined);
    let h = `<table class="imsrx-rank-table"><thead><tr>
      <th class="imsrx-th-rank">#</th>
      <th>${label}</th>
      <th class="imsrx-num">IMS Rx</th>
      ${hasMi ? '<th class="imsrx-num">MI Units</th><th class="imsrx-num">MI Value (EGP)</th>' : ''}
    </tr></thead><tbody>`;
    shown.forEach((r, i) => {
      const bar = maxV > 0 ? (r.value / maxV) * 100 : 0;
      h += `<tr><td class="imsrx-th-rank">${i + 1}</td>
        <td class="imsrx-cell-name"><span class="imsrx-bar" style="width:${bar.toFixed(1)}%"></span>
          <span class="imsrx-name-txt" title="${escAttr(r.name)}">${escAttr(r.name)}</span></td>
        <td class="imsrx-num imsrx-strong">${fmtBig(r.value)}</td>
        ${hasMi ? `<td class="imsrx-num">${r.units > 0 ? fmtBig(r.units) : "—"}</td><td class="imsrx-num">${r.salesValue > 0 ? fmtValEGP(r.salesValue) : "—"}</td>` : ''}
      </tr>`;
    });
    h += "</tbody></table>";
    return h;
  }

  /** Product spotlight -- the Rx-vs-Units relationship Ahmed asked for.
   * Mirrors market-intel.js's renderZetaPanel(): a standing panel that
   * only renders when exactly one Product is the active filter, showing
   * the full picture for that one product regardless of Specialty/Region
   * sub-filters (Market Intel has no specialty/region dimension to match
   * against, so this compares the WHOLE product, not the filtered slice). */
  function mdProductSpotlightHtml() {
    if (!MDx.product || MDx.product.size !== 1) return "";
    let productIdx = null;
    MDx.product.forEach((i) => { productIdx = i; });
    const name = cache.lookups.products[productIdx];
    const corps = cache.lookups.corps[productIdx] || [];
    const conf = cache.lookups.corpConfidence[productIdx];
    const units2025 = cache.lookups.unitsMarketIntel2025[productIdx] || 0;
    const value2025 = cache.lookups.valueMarketIntel2025[productIdx] || 0;

    // Whole-product Rx 2025 (Period=MAT Dec 2025, Product=this one, every
    // other dimension open) -- independent of the page's other filters.
    const f = cache.fact;
    const stride = f.stride;
    const pIdxField = f.fields.indexOf("product");
    const perField = f.fields.indexOf("period");
    let rx2025 = 0;
    const bySpecialty = new Map();
    const specField = f.fields.indexOf("specialty");
    for (let i = 0; i < f.rx.length; i++) {
      const base = i * stride;
      if (f.rows[base + pIdxField] !== productIdx) continue;
      if (f.rows[base + perField] !== 2) continue;
      rx2025 += f.rx[i];
      const sIdx = f.rows[base + specField];
      bySpecialty.set(sIdx, (bySpecialty.get(sIdx) || 0) + f.rx[i]);
    }
    const specRows = [];
    bySpecialty.forEach((v, idx) => specRows.push({ idx, name: cache.lookups.specialties[idx], value: v }));
    specRows.sort((a, b) => b.value - a.value);

    let corpBadge;
    if (conf === 2) corpBadge = `<span class="imsrx-badge imsrx-badge-ok">${escAttr(corps[0])}</span>`;
    else if (conf === 1) corpBadge = `<span class="imsrx-badge imsrx-badge-warn">${corps.length} manufacturers (generic)</span>`;
    else corpBadge = `<span class="imsrx-badge imsrx-badge-muted">Not matched</span>`;

    const ratioNote = (rx2025 > 0 && units2025 > 0)
      ? `<div class="imsrx-spotlight-ratio"><span class="imsrx-ratio-icon">⚖️</span><strong>Cross-Intelligence Bridge:</strong> ≈ ${(units2025 / rx2025).toFixed(1)} sell-out units per physician prescription &mdash; comparative benchmark between physician demand and retail distribution.</div>`
      : "";

    return `
      <div class="imsrx-spotlight">
        <div class="imsrx-spotlight-head">
          <h3>Product Spotlight — ${escAttr(name)}</h3>
          ${corpBadge}
        </div>
        <div class="imsrx-spotlight-row imsrx-spotlight-row-4">
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">IMS Rx <span>MAT Dec 2025 · physician panel</span></div>
            <div class="imsrx-spotlight-stat-value">${fmtBig(rx2025)}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">Market Intel Units <span>Calendar 2025 · sell-out</span></div>
            <div class="imsrx-spotlight-stat-value">${units2025 > 0 ? fmtBig(units2025) : "—"}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">Market Intel Value <span>Calendar 2025 · LC / EGP</span></div>
            <div class="imsrx-spotlight-stat-value">${value2025 > 0 ? fmtValEGP(value2025) : "—"}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">Manufacturer Status <span>Brand Match</span></div>
            <div class="imsrx-spotlight-stat-value" style="font-size:16px;line-height:1.4;">${conf === 2 ? escAttr(corps[0]) : (conf === 1 ? "Multi-Source Generic" : "Unmatched")}</div>
          </div>
        </div>
        ${ratioNote}
        <div class="imsrx-spotlight-sub">Prescribed by (Rx, MAT Dec 2025, all specialties for this product)</div>
        ${mdRankedTableHtml(specRows, "Prescriber Specialty", 15)}
      </div>`;
  }

  /** Generic entity-scope aggregator behind the Molecule / ATC4 / Company
   * spotlights below. Unlike the Product Spotlight above (which shows the
   * WHOLE product regardless of sibling filters, by design, so it always
   * reads as "this product's full picture"), these respect ALL other
   * active Market Dynamics filters -- more useful once you're already
   * narrowing by Region/Specialty/etc. and want the spotlight to reflect
   * that same slice. Growth and the 3-period trend deliberately ignore
   * the Period filter itself (same pattern Company Performance uses for
   * its own YoY column), since a growth% is meaningless once Period has
   * already been narrowed to one value. */
  function mdEntityStats(fieldKey, entityIdx) {
    const f = cache.fact;
    const stride = f.stride;
    const perField = f.fields.indexOf("period");
    const pField = f.fields.indexOf("product");
    const molField = f.fields.indexOf("molecule");
    const atc4Field = f.fields.indexOf("atc4");
    const specField = f.fields.indexOf("specialty");
    const regField = f.fields.indexOf("region");
    const catField = f.fields.indexOf("dosageFormCategory");

    let total = 0;
    const byPeriod = new Map();
    const byProduct = new Map();
    const byMolecule = new Map();
    const byAtc4 = new Map();
    const bySpecialty = new Map();
    const byRegion = new Map();
    const byCat = new Map();
    const products = new Set();

    for (let i = 0; i < f.rx.length; i++) {
      const base = i * stride;
      if (mdFieldValue(base, fieldKey) !== entityIdx) continue;

      if (mdRowMatches(base, "period")) {
        const p = f.rows[base + perField];
        byPeriod.set(p, (byPeriod.get(p) || 0) + f.rx[i]);
      }

      if (!mdRowMatches(base, null)) continue;
      total += f.rx[i];
      const prod = f.rows[base + pField];
      products.add(prod);
      byProduct.set(prod, (byProduct.get(prod) || 0) + f.rx[i]);
      byMolecule.set(f.rows[base + molField], (byMolecule.get(f.rows[base + molField]) || 0) + f.rx[i]);
      byAtc4.set(f.rows[base + atc4Field], (byAtc4.get(f.rows[base + atc4Field]) || 0) + f.rx[i]);
      bySpecialty.set(f.rows[base + specField], (bySpecialty.get(f.rows[base + specField]) || 0) + f.rx[i]);
      byRegion.set(f.rows[base + regField], (byRegion.get(f.rows[base + regField]) || 0) + f.rx[i]);
      byCat.set(f.rows[base + catField], (byCat.get(f.rows[base + catField]) || 0) + f.rx[i]);
    }

    const cur = byPeriod.get(2) || 0;
    const prev = byPeriod.get(1) || 0;
    const growth = prev > 0 ? (cur - prev) / prev * 100 : null;

    const uArr = cache.lookups.unitsMarketIntel2025 || [];
    const vArr = cache.lookups.valueMarketIntel2025 || [];
    let marketIntelUnits = 0;
    let marketIntelValue = 0;
    products.forEach((p) => {
      marketIntelUnits += uArr[p] || 0;
      marketIntelValue += vArr[p] || 0;
    });

    function toRows(map, names, isProduct) {
      const rows = [];
      map.forEach((v, idx) => {
        if (names[idx] !== undefined) {
          const r = { idx, name: String(names[idx]), value: v };
          if (isProduct) {
            r.units = uArr[idx] || 0;
            r.salesValue = vArr[idx] || 0;
          }
          rows.push(r);
        }
      });
      rows.sort((a, b) => b.value - a.value);
      return rows;
    }

    return {
      total, growth,
      trend: [byPeriod.get(0) || 0, byPeriod.get(1) || 0, byPeriod.get(2) || 0],
      productCount: products.size,
      marketIntelUnits,
      marketIntelValue,
      productRows: toRows(byProduct, cache.lookups.products, true),
      moleculeRows: toRows(byMolecule, cache.lookups.molecules, false),
      atc4Rows: toRows(byAtc4, cache.lookups.atc4s, false),
      specialtyRows: toRows(bySpecialty, cache.lookups.specialties, false),
      regionRows: toRows(byRegion, cache.lookups.regions, false),
      catRows: toRows(byCat, cache.lookups.dosageFormCategories, false),
    };
  }

  function mdSpotlightShell(title, badge, stats, sectionsHtml) {
    const gCls = stats.growth == null ? "" : (stats.growth >= 0 ? "imsrx-positive" : "imsrx-negative");
    const ratioNote = (stats.total > 0 && stats.marketIntelUnits > 0)
      ? `<div class="imsrx-spotlight-ratio"><span class="imsrx-ratio-icon">⚖️</span><strong>Cross-Intelligence Bridge:</strong> ≈ ${(stats.marketIntelUnits / stats.total).toFixed(1)} sell-out units per physician prescription across ${stats.productCount.toLocaleString()} product${stats.productCount === 1 ? "" : "s"} &mdash; comparative benchmark between physician demand and retail distribution.</div>`
      : "";
    return `
      <div class="imsrx-spotlight">
        <div class="imsrx-spotlight-head">
          <h3>${title}</h3>
          ${badge}
        </div>
        <div class="imsrx-spotlight-row imsrx-spotlight-row-4">
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">IMS Rx in Scope <span>MAT Dec 2025 · panel</span></div>
            <div class="imsrx-spotlight-stat-value">${fmtBig(stats.total)}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">Market Intel Units <span>Calendar 2025 · sell-out</span></div>
            <div class="imsrx-spotlight-stat-value">${stats.marketIntelUnits > 0 ? fmtBig(stats.marketIntelUnits) : "—"}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">Market Intel Value <span>Calendar 2025 · LC / EGP</span></div>
            <div class="imsrx-spotlight-stat-value">${stats.marketIntelValue > 0 ? fmtValEGP(stats.marketIntelValue) : "—"}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">YoY Rx Growth <span>MAT 2024 → 2025</span></div>
            <div class="imsrx-spotlight-stat-value ${gCls}">${fmtPct(stats.growth, 1)}</div>
          </div>
        </div>
        ${ratioNote}
        ${sectionsHtml}
      </div>`;
  }

  function mdMoleculeSpotlightHtml(moleculeIdx) {
    const name = cache.lookups.molecules[moleculeIdx];
    const s = mdEntityStats("molecule", moleculeIdx);
    const sections = `
      <div class="imsrx-chart-grid-2">
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>Top Products <span class="imsrx-chart-caption">by Rx</span></h3></div>
          ${mdRankedTableHtml(s.productRows, "Product", 10)}
        </div>
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>ATC4 Mix</h3></div>
          ${mdRankedTableHtml(s.atc4Rows, "ATC4", 10)}
        </div>
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>Rx by Prescriber Specialty</h3></div>
          ${mdRankedTableHtml(s.specialtyRows, "Prescriber Specialty", 10)}
        </div>
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>Rx by Region</h3></div>
          ${mdRankedTableHtml(s.regionRows, "Region", 10)}
        </div>
      </div>`;
    return mdSpotlightShell(
      `Molecule Spotlight — ${escAttr(name)}`,
      `<span class="imsrx-badge imsrx-badge-ok">${s.productCount.toLocaleString()} product${s.productCount === 1 ? "" : "s"} in scope</span>`,
      s, sections
    );
  }

  function mdAtc4SpotlightHtml(atc4Idx) {
    const name = cache.lookups.atc4s[atc4Idx];
    const s = mdEntityStats("atc4", atc4Idx);
    const sections = `
      <div class="imsrx-chart-grid-2">
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>Top Products <span class="imsrx-chart-caption">by Rx</span></h3></div>
          ${mdRankedTableHtml(s.productRows, "Product", 10)}
        </div>
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>Top Molecules <span class="imsrx-chart-caption">by Rx</span></h3></div>
          ${mdRankedTableHtml(s.moleculeRows, "Molecule", 10)}
        </div>
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>Rx by Prescriber Specialty</h3></div>
          ${mdRankedTableHtml(s.specialtyRows, "Prescriber Specialty", 10)}
        </div>
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>Rx by Region</h3></div>
          ${mdRankedTableHtml(s.regionRows, "Region", 10)}
        </div>
      </div>`;
    return mdSpotlightShell(
      `ATC4 Spotlight — ${escAttr(name)}`,
      `<span class="imsrx-badge imsrx-badge-ok">${s.productCount.toLocaleString()} product${s.productCount === 1 ? "" : "s"} in scope</span>`,
      s, sections
    );
  }

  function mdCompanySpotlightHtml(companyIdx) {
    const name = companyNames[companyIdx];
    const s = mdEntityStats("company", companyIdx);
    const sections = `
      <div class="imsrx-chart-grid-2">
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>Top Products <span class="imsrx-chart-caption">by Rx</span></h3></div>
          ${mdRankedTableHtml(s.productRows, "Product", 10)}
        </div>
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>Top Molecules <span class="imsrx-chart-caption">by Rx</span></h3></div>
          ${mdRankedTableHtml(s.moleculeRows, "Molecule", 10)}
        </div>
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>ATC4 Mix</h3></div>
          ${mdRankedTableHtml(s.atc4Rows, "ATC4", 10)}
        </div>
        <div class="imsrx-chart-card">
          <div class="imsrx-chart-card-header"><h3>Region Mix</h3></div>
          ${mdRankedTableHtml(s.regionRows, "Region", 10)}
        </div>
      </div>
      <div class="imsrx-spotlight-sub">Dosage Form Mix</div>
      ${mdRankedTableHtml(s.catRows, "Dosage Form", 10)}`;
    return mdSpotlightShell(
      `Company Spotlight — ${escAttr(name)}`,
      `<span class="imsrx-badge imsrx-badge-ok">${s.productCount.toLocaleString()} product${s.productCount === 1 ? "" : "s"} in scope</span>`,
      s, sections
    );
  }

  /** Dispatcher: which single-selection filter (if any) should drive the
   * standing spotlight panel. Priority = most specific / richest first --
   * Product (has the Rx-vs-Units join) beats Company beats Molecule beats
   * ATC4. Only one spotlight renders at a time. */
  function mdSpotlightHtml() {
    if (MDx.product && MDx.product.size === 1) return mdProductSpotlightHtml();
    if (MDx.company && MDx.company.size === 1) {
      let idx = null;
      MDx.company.forEach((i) => { idx = i; });
      return mdCompanySpotlightHtml(idx);
    }
    if (MDx.molecule && MDx.molecule.size === 1) {
      let idx = null;
      MDx.molecule.forEach((i) => { idx = i; });
      return mdMoleculeSpotlightHtml(idx);
    }
    if (MDx.atc4 && MDx.atc4.size === 1) {
      let idx = null;
      MDx.atc4.forEach((i) => { idx = i; });
      return mdAtc4SpotlightHtml(idx);
    }
    return "";
  }

  function mdDimensionSectionsHtml() {
    const atc4Rows = mdRankedRows("atc4", "atc4s");
    const specRows = mdRankedRows("specialty", "specialties");
    const regionRows = mdRankedRows("region", "regions");
    const catRows = mdRankedRows("dosageFormCategory", "dosageFormCategories");
    const productRows = mdRankedRows("product", "products");

    return `
      <div class="imsrx-chart-card">
        <div class="imsrx-chart-card-header"><h3>Rx by Prescriber Specialty</h3></div>
        <div class="imsrx-chart-wrap imsrx-chart-wrap-sm"><canvas id="imsrx-md-specialty-chart"></canvas></div>
      </div>
      <div class="imsrx-chart-card">
        <div class="imsrx-chart-card-header"><h3>Rx by Region</h3></div>
        <div class="imsrx-chart-wrap imsrx-chart-wrap-sm"><canvas id="imsrx-md-region-chart"></canvas></div>
      </div>
      <div class="imsrx-chart-card">
        <div class="imsrx-chart-card-header"><h3>Rx by ATC4 <span class="imsrx-chart-caption">top 10</span></h3></div>
        <div class="imsrx-chart-wrap imsrx-chart-wrap-sm"><canvas id="imsrx-md-atc4-chart"></canvas></div>
      </div>
      <div class="imsrx-chart-card">
        <div class="imsrx-chart-card-header"><h3>Rx by Dosage Form</h3></div>
        <div class="imsrx-chart-wrap imsrx-chart-wrap-sm"><canvas id="imsrx-md-cat-chart"></canvas></div>
      </div>
      <div class="imsrx-chart-card imsrx-chart-card-wide">
        <div class="imsrx-chart-card-header"><h3>Products in Scope <span class="imsrx-chart-caption">top 20 by Rx</span></h3></div>
        ${mdRankedTableHtml(productRows, "Product", 20)}
      </div>
      <script type="application/json" id="imsrx-md-chart-data">${JSON.stringify({ atc4Rows: atc4Rows.slice(0, 10), specRows, regionRows, catRows })}</script>`;
  }

  function renderDynamics() {
    if (!MDx) resetMdFilters();
    return `
      ${mdRenderFilterBar()}
      ${mdKpisHtml()}
      ${mdSpotlightHtml()}
      <div class="imsrx-chart-grid-2">
        ${mdDimensionSectionsHtml()}
      </div>`;
  }

  function mdCloseAllMenus(container) {
    container.querySelectorAll(".imsrx-f-menu").forEach((m) => { m.hidden = true; });
  }

  function wireMdFilterBar(container) {
    container.querySelectorAll(".imsrx-f-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const key = btn.getAttribute("data-open");
        const menu = container.querySelector(`.imsrx-f-menu[data-menu="${key}"]`);
        const wasHidden = menu.hidden;
        mdCloseAllMenus(container);
        menu.hidden = !wasHidden;
      });
    });
    container.querySelectorAll(".imsrx-f-menu").forEach((m) => {
      m.addEventListener("click", (e) => e.stopPropagation());
    });
    document.addEventListener("click", () => mdCloseAllMenus(container), { once: true });

    container.querySelectorAll('.imsrx-f-opt input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", () => {
        const k = cb.getAttribute("data-k");
        const idx = parseInt(cb.value, 10);
        if (!MDx[k]) MDx[k] = new Set();
        if (cb.checked) MDx[k].add(idx); else MDx[k].delete(idx);
        if (MDx[k].size === 0) MDx[k] = null;
        renderLayout();
      });
    });
    container.querySelectorAll("[data-all]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.getAttribute("data-all");
        const spec = MD_FILTER_SPECS.find((s) => s.key === k);
        const all = mdOptionsFor(spec).map((o) => o.idx);
        MDx[k] = new Set(all);
        renderLayout();
      });
    });
    container.querySelectorAll("[data-none]").forEach((btn) => {
      btn.addEventListener("click", () => {
        MDx[btn.getAttribute("data-none")] = null;
        renderLayout();
      });
    });
    container.querySelectorAll(".imsrx-f-search").forEach((inp) => {
      inp.addEventListener("input", () => {
        const q = inp.value.trim().toLowerCase();
        inp.closest(".imsrx-f-menu").querySelectorAll(".imsrx-f-opt").forEach((o) => {
          const t = o.querySelector(".imsrx-f-opt-lbl").textContent.toLowerCase();
          o.style.display = !q || t.indexOf(q) >= 0 ? "" : "none";
        });
      });
    });
    const resetBtn = container.querySelector("#imsrx-md-reset");
    if (resetBtn) resetBtn.addEventListener("click", () => { resetMdFilters(); renderLayout(); });
  }

  function drawMdCharts() {
    const dataEl = document.getElementById("imsrx-md-chart-data");
    if (!dataEl || typeof Chart === "undefined") return;
    const { atc4Rows, specRows, regionRows, catRows } = JSON.parse(dataEl.textContent);

    function rankedBarChart(canvasId, rows, color) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const ordered = rows.slice().reverse(); // biggest at bottom->top reading order matches table above
      const chart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: ordered.map((r) => r.name),
          datasets: [{ data: ordered.map((r) => r.value), backgroundColor: color, borderRadius: 3 }],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 250 },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => `${Math.round(ctx.raw).toLocaleString()} Rx` } },
          },
          scales: {
            x: { grid: { color: "#E2E8F0" }, ticks: { callback: (v) => fmtBig(v) } },
            y: { grid: { display: false }, ticks: { font: { size: 10.5 } } },
          },
        },
      });
      charts.push(chart);
    }

    rankedBarChart("imsrx-md-specialty-chart", specRows, "#0F4C81");
    rankedBarChart("imsrx-md-region-chart", regionRows, "#7C3AED");
    rankedBarChart("imsrx-md-atc4-chart", atc4Rows, "#0891B2");
    rankedBarChart("imsrx-md-cat-chart", catRows, "#B45309");
  }

  function escAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // =====================================================================
  // COMPANY PERFORMANCE -- same filter-bar architecture as Market Dynamics
  // (separate cf* namespace / CFx state so the two pages never share
  // mutable state), with an added "Company" facet derived from
  // companyOfProduct. See file header for the attribution-confidence
  // discipline this page enforces.
  // =====================================================================

  let CFx = null;
  function resetCfFilters() {
    CFx = {
      period: new Set([2]),   // defaults to MAT Dec 2025
      company: null, product: null, dm1: null, dm2: null, molecule: null, atc3: null, atc4: null,
      specialty: null, region: null, cat: null,
    };
  }

  const CF_FILTER_SPECS = [
    { key: "period", label: "Period", lookup: "periods", field: "period", sort: "index" },
    { key: "company", label: "Company", lookup: "companies", field: "company" },
    { key: "product", label: "Product", lookup: "products", field: "product" },
    { key: "dm1", label: "Market (DM1)", lookup: "dm1s", field: "dm1", multi: true },
    { key: "dm2", label: "Market (DM2)", lookup: "dm2s", field: "dm2", multi: true },
    { key: "molecule", label: "Molecule", lookup: "molecules", field: "molecule" },
    { key: "atc3", label: "ATC3", lookup: "atc3s", field: "atc3" },
    { key: "atc4", label: "ATC4", lookup: "atc4s", field: "atc4" },
    { key: "specialty", label: "Prescriber Specialty", lookup: "specialties", field: "specialty" },
    { key: "region", label: "Region", lookup: "regions", field: "region" },
    { key: "cat", label: "Dosage Form", lookup: "dosageFormCategories", field: "dosageFormCategory" },
  ];

  // See namesForSpec() near buildCompanyIndex() -- same helper, shared
  // with Market Dynamics's "company" filter facet.
  function cfNamesForSpec(spec) {
    return namesForSpec(spec);
  }

  function cfFieldValue(base, fieldKey) {
    const f = cache.fact;
    if (fieldKey === "dm1" || fieldKey === "dm2") return marketsOfRow(base, fieldKey);
    if (fieldKey === "atc3") {
      return cache.lookups.atc4ParentAtc3[f.rows[base + f.fields.indexOf("atc4")]];
    }
    if (fieldKey === "company") {
      return companyOfProduct[f.rows[base + f.fields.indexOf("product")]];
    }
    return f.rows[base + f.fields.indexOf(fieldKey)];
  }

  function cfRowMatches(base, excludeKey) {
    for (let s = 0; s < CF_FILTER_SPECS.length; s++) {
      const spec = CF_FILTER_SPECS[s];
      if (spec.key === excludeKey) continue;
      const sel = CFx[spec.key];
      if (!sel || sel.size === 0) continue;
      if (!selHasValue(sel, cfFieldValue(base, spec.field))) return false;
    }
    return true;
  }

  function cfOptionsFor(spec) {
    const f = cache.fact;
    const stride = f.stride;
    const names = cfNamesForSpec(spec);
    const acc = new Map();
    for (let i = 0; i < f.rx.length; i++) {
      const base = i * stride;
      if (!cfRowMatches(base, spec.key)) continue;
      const v = cfFieldValue(base, spec.field);
      if (Array.isArray(v)) { v.forEach((m) => acc.set(m, (acc.get(m) || 0) + f.rx[i])); continue; }
      acc.set(v, (acc.get(v) || 0) + f.rx[i]);
    }
    const out = [];
    acc.forEach((val, idx) => {
      if (idx < 0 || names[idx] === undefined) return; // -1 = unattributed, not a selectable company
      out.push({ idx, label: String(names[idx]), value: val });
    });
    if (spec.sort === "index") out.sort((a, b) => a.idx - b.idx);
    else out.sort((a, b) => b.value - a.value);
    return out;
  }

  function cfActiveFilterCount() {
    let n = 0;
    CF_FILTER_SPECS.forEach((s) => { if (CFx[s.key] && CFx[s.key].size > 0 && s.key !== "period") n++; });
    return n;
  }

  function cfFilterSummary(spec) {
    const sel = CFx[spec.key];
    const n = sel ? sel.size : 0;
    if (n === 0) return "All";
    if (n === 1) {
      let only = null;
      sel.forEach((i) => { only = i; });
      const names = cfNamesForSpec(spec);
      return String(names[only]);
    }
    return n + " selected";
  }

  /** Total Rx in scope, how much of it is attributable to a named company
   * (corpConfidence === 2 products only), and how many distinct companies
   * are present -- the transparency KPI row for this page. */
  function cfFilteredTotal() {
    const f = cache.fact;
    const stride = f.stride;
    const pField = f.fields.indexOf("product");
    let total = 0;
    let attributable = 0;
    const companies = new Set();
    for (let i = 0; i < f.rx.length; i++) {
      const base = i * stride;
      if (!cfRowMatches(base, null)) continue;
      total += f.rx[i];
      const cIdx = companyOfProduct[f.rows[base + pField]];
      if (cIdx >= 0) {
        attributable += f.rx[i];
        companies.add(cIdx);
      }
    }
    return { total, attributable, companyCount: companies.size };
  }

  /** Company leaderboard: Rx (respecting the page's period filter), share
   * of the attributable market, and YoY growth. Growth is DELIBERATELY
   * computed independent of the period filter -- always SUM(MAT2025) vs
   * SUM(MAT2024) under every OTHER active filter -- because a growth% is
   * meaningless once the period facet itself has been narrowed to one
   * period; this mirrors the Product Spotlight's "ignore this one filter
   * for this one number" pattern in Market Dynamics. */
  /** Company leaderboard: Rx (respecting the page's period filter), share
   * of the attributable market, and YoY growth. Growth is DELIBERATELY
   * computed independent of the period filter -- always SUM(MAT2025) vs
   * SUM(MAT2024) under every OTHER active filter -- because a growth% is
   * meaningless once the period facet itself has been narrowed to one
   * period; this mirrors the Product Spotlight's "ignore this one filter
   * for this one number" pattern in Market Dynamics. */
  function cfCompanyLeaderboard() {
    const f = cache.fact;
    const stride = f.stride;
    const pField = f.fields.indexOf("product");
    const perField = f.fields.indexOf("period");

    const acc = new Map();
    const companyProducts = new Map();
    for (let i = 0; i < f.rx.length; i++) {
      const base = i * stride;
      if (!cfRowMatches(base, null)) continue;
      const pIdx = f.rows[base + pField];
      const cIdx = companyOfProduct[pIdx];
      if (cIdx < 0) continue;
      acc.set(cIdx, (acc.get(cIdx) || 0) + f.rx[i]);
      if (!companyProducts.has(cIdx)) companyProducts.set(cIdx, new Set());
      companyProducts.get(cIdx).add(pIdx);
    }

    const growthCur = new Map();
    const growthPrev = new Map();
    for (let i = 0; i < f.rx.length; i++) {
      const base = i * stride;
      if (!cfRowMatches(base, "period")) continue;
      const p = f.rows[base + perField];
      if (p !== 1 && p !== 2) continue;
      const cIdx = companyOfProduct[f.rows[base + pField]];
      if (cIdx < 0) continue;
      const m = p === 2 ? growthCur : growthPrev;
      m.set(cIdx, (m.get(cIdx) || 0) + f.rx[i]);
    }

    let attributableTotal = 0;
    acc.forEach((v) => { attributableTotal += v; });

    const uArr = cache.lookups.unitsMarketIntel2025 || [];
    const vArr = cache.lookups.valueMarketIntel2025 || [];
    const rows = [];
    acc.forEach((val, idx) => {
      const cur = growthCur.get(idx) || 0;
      const prev = growthPrev.get(idx) || 0;
      const growth = prev > 0 ? (cur - prev) / prev * 100 : null;
      let miUnits = 0;
      let miValue = 0;
      const pSet = companyProducts.get(idx);
      if (pSet) {
        pSet.forEach((p) => {
          miUnits += uArr[p] || 0;
          miValue += vArr[p] || 0;
        });
      }
      rows.push({
        idx, name: companyNames[idx], value: val,
        share: attributableTotal > 0 ? (val / attributableTotal) * 100 : 0,
        growth,
        units: miUnits,
        salesValue: miValue,
      });
    });
    rows.sort((a, b) => b.value - a.value);
    return rows;
  }

  function cfLeaderboardTableHtml(rows, limit) {
    if (!rows.length) return '<div class="imsrx-empty">No data matches the current filters.</div>';
    const shown = rows.slice(0, limit || 25);
    const maxV = shown[0] ? shown[0].value : 0;
    let h = `<table class="imsrx-rank-table"><thead><tr>
      <th class="imsrx-th-rank">#</th><th>Company</th>
      <th class="imsrx-num">IMS Rx</th><th class="imsrx-num">Rx Share</th>
      <th class="imsrx-num">Market Intel Units <span class="imsrx-chart-caption">Cal 2025</span></th>
      <th class="imsrx-num">Market Intel Value <span class="imsrx-chart-caption">LC / EGP</span></th>
      <th class="imsrx-num">YoY Rx <span class="imsrx-chart-caption">2024→2025</span></th>
    </tr></thead><tbody>`;
    shown.forEach((r, i) => {
      const bar = maxV > 0 ? (r.value / maxV) * 100 : 0;
      const gCls = r.growth == null ? "" : (r.growth >= 0 ? "imsrx-positive" : "imsrx-negative");
      h += `<tr>
        <td class="imsrx-th-rank">${i + 1}</td>
        <td class="imsrx-cell-name"><span class="imsrx-bar" style="width:${bar.toFixed(1)}%"></span>
          <span class="imsrx-name-txt" title="${escAttr(r.name)}">${escAttr(r.name)}</span></td>
        <td class="imsrx-num imsrx-strong">${fmtBig(r.value)}</td>
        <td class="imsrx-num">${r.share.toFixed(1)}%</td>
        <td class="imsrx-num">${r.units > 0 ? fmtBig(r.units) : "—"}</td>
        <td class="imsrx-num">${r.salesValue > 0 ? fmtValEGP(r.salesValue) : "—"}</td>
        <td class="imsrx-num ${gCls}">${fmtPct(r.growth, 1)}</td>
      </tr>`;
    });
    h += "</tbody></table>";
    return h;
  }

  // ---- rendering ---------------------------------------------------------

  function cfRenderFilterBar() {
    let h = '<div class="imsrx-filterbar">';
    visibleSpecs(CF_FILTER_SPECS).forEach((spec) => {
      const opts = cfOptionsFor(spec);
      const sel = CFx[spec.key];
      const n = sel ? sel.size : 0;
      const summary = cfFilterSummary(spec);
      h += `<div class="imsrx-f" data-f="${spec.key}">
        <label class="imsrx-f-label">${spec.label}${n ? `<span class="imsrx-f-count">${n}</span>` : ""}</label>
        <button type="button" class="imsrx-f-btn" data-open="${spec.key}" title="${escAttr(summary)}">
          <span class="imsrx-f-sum">${escAttr(summary)}</span><span class="imsrx-f-caret">▾</span>
        </button>
        <div class="imsrx-f-menu" data-menu="${spec.key}" hidden>
          <input type="text" class="imsrx-f-search" placeholder="Search ${spec.label}…" />
          <div class="imsrx-f-actions">
            <button type="button" data-all="${spec.key}">Select all</button>
            <button type="button" data-none="${spec.key}">Clear</button>
          </div>
          <div class="imsrx-f-list">
            ${opts.map((o) => {
              const on = sel && sel.has(o.idx);
              return `<label class="imsrx-f-opt${on ? " on" : ""}">
                <input type="checkbox" data-k="${spec.key}" value="${o.idx}"${on ? " checked" : ""} />
                <span class="imsrx-f-opt-lbl">${escAttr(o.label)}</span>
                <span class="imsrx-f-opt-val">${fmtBig(o.value)}</span></label>`;
            }).join("")}
          </div>
        </div>
      </div>`;
    });
    if (CFx.dm1 || CFx.dm2) h += `<div class="imsrx-dm-note" style="flex-basis:100%;font-size:11px;color:var(--txt3,#64748B);margin-top:4px">Market (DM1/DM2) uses the IQVIA market definitions (Product + ATC4). IMS Rx is brand-level, so a brand in several markets (e.g. different strengths) counts fully in each &mdash; don't add market totals together.</div>`;
    h += `<button type="button" class="imsrx-reset" id="imsrx-cf-reset">Reset filters${cfActiveFilterCount() ? ` (${cfActiveFilterCount()})` : ""}</button>`;
    h += "</div>";
    return h;
  }

  function cfKpisHtml() {
    const { total, attributable, companyCount } = cfFilteredTotal();
    const attributablePct = total > 0 ? (attributable / total) * 100 : null;
    return `
      <div class="imsrx-stats-row imsrx-stats-row-4">
        <div class="imsrx-stat-tile imsrx-stat-highlight">
          <div class="imsrx-stat-label">Rx in Scope</div>
          <div class="imsrx-stat-value">${fmtBig(total)}</div>
        </div>
        <div class="imsrx-stat-tile">
          <div class="imsrx-stat-label">Attributable to a Company <span class="imsrx-stat-sub">unambiguous brand match</span></div>
          <div class="imsrx-stat-value">${attributablePct != null ? attributablePct.toFixed(1) + "%" : "—"}</div>
        </div>
        <div class="imsrx-stat-tile">
          <div class="imsrx-stat-label">Companies in Scope</div>
          <div class="imsrx-stat-value">${companyCount.toLocaleString()}</div>
        </div>
        <div class="imsrx-stat-tile">
          <div class="imsrx-stat-label">Active Filters</div>
          <div class="imsrx-stat-value">${cfActiveFilterCount()}</div>
        </div>
      </div>`;
  }

  /** Company spotlight -- renders when exactly one Company is the active
   * filter: full picture for that one company (products, molecules, ATC4
   * and region mix, dosage-form mix, 3-period trend, YoY growth) under
   * whatever other filters are active. */
  function cfCompanySpotlightHtml() {
    if (!CFx.company || CFx.company.size !== 1) return "";
    let companyIdx = null;
    CFx.company.forEach((i) => { companyIdx = i; });
    const name = companyNames[companyIdx];

    const f = cache.fact;
    const stride = f.stride;
    const pField = f.fields.indexOf("product");
    const perField = f.fields.indexOf("period");
    const molField = f.fields.indexOf("molecule");
    const atc4Field = f.fields.indexOf("atc4");
    const regField = f.fields.indexOf("region");
    const catField = f.fields.indexOf("dosageFormCategory");

    let total = 0;
    const products = new Set();
    const byMolecule = new Map();
    const byAtc4 = new Map();
    const byRegion = new Map();
    const byCat = new Map();
    const byProduct = new Map();
    const byPeriod = new Map(); // ignores the period filter itself, like growth above

    for (let i = 0; i < f.rx.length; i++) {
      const base = i * stride;
      if (companyOfProduct[f.rows[base + pField]] !== companyIdx) continue;

      if (cfRowMatches(base, "period")) {
        const p = f.rows[base + perField];
        byPeriod.set(p, (byPeriod.get(p) || 0) + f.rx[i]);
      }

      if (!cfRowMatches(base, null)) continue;
      total += f.rx[i];
      const pIdx = f.rows[base + pField];
      products.add(pIdx);
      byProduct.set(pIdx, (byProduct.get(pIdx) || 0) + f.rx[i]);
      byMolecule.set(f.rows[base + molField], (byMolecule.get(f.rows[base + molField]) || 0) + f.rx[i]);
      byAtc4.set(f.rows[base + atc4Field], (byAtc4.get(f.rows[base + atc4Field]) || 0) + f.rx[i]);
      byRegion.set(f.rows[base + regField], (byRegion.get(f.rows[base + regField]) || 0) + f.rx[i]);
      byCat.set(f.rows[base + catField], (byCat.get(f.rows[base + catField]) || 0) + f.rx[i]);
    }

    const cur = byPeriod.get(2) || 0;
    const prev = byPeriod.get(1) || 0;
    const growth = prev > 0 ? (cur - prev) / prev * 100 : null;
    const gCls = growth == null ? "" : (growth >= 0 ? "imsrx-positive" : "imsrx-negative");

    const uArr = cache.lookups.unitsMarketIntel2025 || [];
    const vArr = cache.lookups.valueMarketIntel2025 || [];
    let marketIntelUnits = 0;
    let marketIntelValue = 0;
    products.forEach((p) => {
      marketIntelUnits += uArr[p] || 0;
      marketIntelValue += vArr[p] || 0;
    });

    function toRows(map, names, isProduct) {
      const rows = [];
      map.forEach((v, idx) => {
        if (names[idx] !== undefined) {
          const r = { idx, name: String(names[idx]), value: v };
          if (isProduct) {
            r.units = uArr[idx] || 0;
            r.salesValue = vArr[idx] || 0;
          }
          rows.push(r);
        }
      });
      rows.sort((a, b) => b.value - a.value);
      return rows;
    }

    const productRows = toRows(byProduct, cache.lookups.products, true);
    const molRows = toRows(byMolecule, cache.lookups.molecules, false);
    const atc4Rows = toRows(byAtc4, cache.lookups.atc4s, false);
    const regionRows = toRows(byRegion, cache.lookups.regions, false);
    const catRows = toRows(byCat, cache.lookups.dosageFormCategories, false);

    const ratioNote = (total > 0 && marketIntelUnits > 0)
      ? `<div class="imsrx-spotlight-ratio"><span class="imsrx-ratio-icon">⚖️</span><strong>Cross-Intelligence Bridge:</strong> ≈ ${(marketIntelUnits / total).toFixed(1)} sell-out units per physician prescription across ${products.size.toLocaleString()} product${products.size === 1 ? "" : "s"} &mdash; comparative benchmark between physician demand and retail distribution.</div>`
      : "";

    return `
      <div class="imsrx-spotlight">
        <div class="imsrx-spotlight-head">
          <h3>Company Spotlight — ${escAttr(name)}</h3>
          <span class="imsrx-badge imsrx-badge-ok">${products.size.toLocaleString()} product${products.size === 1 ? "" : "s"} in scope</span>
        </div>
        <div class="imsrx-spotlight-row imsrx-spotlight-row-4">
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">IMS Rx in Scope <span>MAT Dec 2025 · panel</span></div>
            <div class="imsrx-spotlight-stat-value">${fmtBig(total)}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">Market Intel Units <span>Calendar 2025 · sell-out</span></div>
            <div class="imsrx-spotlight-stat-value">${marketIntelUnits > 0 ? fmtBig(marketIntelUnits) : "—"}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">Market Intel Value <span>Calendar 2025 · LC / EGP</span></div>
            <div class="imsrx-spotlight-stat-value">${marketIntelValue > 0 ? fmtValEGP(marketIntelValue) : "—"}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">YoY Rx Growth <span>MAT 2024 → 2025</span></div>
            <div class="imsrx-spotlight-stat-value ${gCls}">${fmtPct(growth, 1)}</div>
          </div>
        </div>
        ${ratioNote}
        <div class="imsrx-chart-grid-2">
          <div class="imsrx-chart-card">
            <div class="imsrx-chart-card-header"><h3>Top Products <span class="imsrx-chart-caption">by Rx</span></h3></div>
            ${mdRankedTableHtml(productRows, "Product", 10)}
          </div>
          <div class="imsrx-chart-card">
            <div class="imsrx-chart-card-header"><h3>Top Molecules <span class="imsrx-chart-caption">by Rx</span></h3></div>
            ${mdRankedTableHtml(molRows, "Molecule", 10)}
          </div>
          <div class="imsrx-chart-card">
            <div class="imsrx-chart-card-header"><h3>ATC4 Mix</h3></div>
            ${mdRankedTableHtml(atc4Rows, "ATC4", 10)}
          </div>
          <div class="imsrx-chart-card">
            <div class="imsrx-chart-card-header"><h3>Region Mix</h3></div>
            ${mdRankedTableHtml(regionRows, "Region", 10)}
          </div>
        </div>
        <div class="imsrx-spotlight-sub">Dosage Form Mix</div>
        ${mdRankedTableHtml(catRows, "Dosage Form", 10)}
      </div>`;
  }

  function cfLeaderboardSectionHtml() {
    const rows = cfCompanyLeaderboard();
    return `
      <div class="imsrx-chart-card imsrx-chart-card-wide">
        <div class="imsrx-chart-card-header"><h3>Top Companies <span class="imsrx-chart-caption">top 10 by Rx in scope</span></h3></div>
        <div class="imsrx-chart-wrap imsrx-chart-wrap-sm"><canvas id="imsrx-cf-leaderboard-chart"></canvas></div>
      </div>
      <div class="imsrx-chart-card imsrx-chart-card-wide">
        <div class="imsrx-chart-card-header"><h3>Company Leaderboard <span class="imsrx-chart-caption">ranked by Rx, with YoY growth</span></h3></div>
        ${cfLeaderboardTableHtml(rows, 30)}
      </div>
      <script type="application/json" id="imsrx-cf-chart-data">${JSON.stringify({ topRows: rows.slice(0, 10) })}</script>`;
  }

  function renderCompany() {
    if (!CFx) resetCfFilters();
    buildCompanyIndex();
    const spotlight = cfCompanySpotlightHtml();
    return `
      ${cfRenderFilterBar()}
      ${cfKpisHtml()}
      ${spotlight || cfLeaderboardSectionHtml()}`;
  }

  function cfCloseAllMenus(container) {
    container.querySelectorAll(".imsrx-f-menu").forEach((m) => { m.hidden = true; });
  }

  function wireCfFilterBar(container) {
    container.querySelectorAll(".imsrx-f-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const key = btn.getAttribute("data-open");
        const menu = container.querySelector(`.imsrx-f-menu[data-menu="${key}"]`);
        const wasHidden = menu.hidden;
        cfCloseAllMenus(container);
        menu.hidden = !wasHidden;
      });
    });
    container.querySelectorAll(".imsrx-f-menu").forEach((m) => {
      m.addEventListener("click", (e) => e.stopPropagation());
    });
    document.addEventListener("click", () => cfCloseAllMenus(container), { once: true });

    container.querySelectorAll('.imsrx-f-opt input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", () => {
        const k = cb.getAttribute("data-k");
        const idx = parseInt(cb.value, 10);
        if (!CFx[k]) CFx[k] = new Set();
        if (cb.checked) CFx[k].add(idx); else CFx[k].delete(idx);
        if (CFx[k].size === 0) CFx[k] = null;
        renderLayout();
      });
    });
    container.querySelectorAll("[data-all]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.getAttribute("data-all");
        const spec = CF_FILTER_SPECS.find((s) => s.key === k);
        const all = cfOptionsFor(spec).map((o) => o.idx);
        CFx[k] = new Set(all);
        renderLayout();
      });
    });
    container.querySelectorAll("[data-none]").forEach((btn) => {
      btn.addEventListener("click", () => {
        CFx[btn.getAttribute("data-none")] = null;
        renderLayout();
      });
    });
    container.querySelectorAll(".imsrx-f-search").forEach((inp) => {
      inp.addEventListener("input", () => {
        const q = inp.value.trim().toLowerCase();
        inp.closest(".imsrx-f-menu").querySelectorAll(".imsrx-f-opt").forEach((o) => {
          const t = o.querySelector(".imsrx-f-opt-lbl").textContent.toLowerCase();
          o.style.display = !q || t.indexOf(q) >= 0 ? "" : "none";
        });
      });
    });
    const resetBtn = container.querySelector("#imsrx-cf-reset");
    if (resetBtn) resetBtn.addEventListener("click", () => { resetCfFilters(); renderLayout(); });
  }

  function drawCfCharts() {
    const dataEl = document.getElementById("imsrx-cf-chart-data");
    if (!dataEl || typeof Chart === "undefined") return;
    const { topRows } = JSON.parse(dataEl.textContent);
    const canvas = document.getElementById("imsrx-cf-leaderboard-chart");
    if (!canvas) return;
    const ordered = topRows.slice().reverse();
    const chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: ordered.map((r) => r.name),
        datasets: [{ data: ordered.map((r) => r.value), backgroundColor: "#0F4C81", borderRadius: 3 }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${Math.round(ctx.raw).toLocaleString()} Rx` } },
        },
        scales: {
          x: { grid: { color: "#E2E8F0" }, ticks: { callback: (v) => fmtBig(v) } },
          y: { grid: { display: false }, ticks: { font: { size: 10.5 } } },
        },
      },
    });
    charts.push(chart);
  }

  // -------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------

  function fmtBig(n) {
    if (n == null || isNaN(n)) return "—";
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + "K";
    return sign + Math.round(abs).toLocaleString();
  }

  function fmtValEGP(n) {
    if (n == null || isNaN(n) || n === 0) return "—";
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    if (abs >= 1e9) return sign + "EGP " + (abs / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return sign + "EGP " + (abs / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return sign + "EGP " + (abs / 1e3).toFixed(0) + "K";
    return sign + "EGP " + Math.round(abs).toLocaleString();
  }

  function fmtPct(n, digits) {
    if (n == null || isNaN(n)) return "—";
    const d = digits == null ? 1 : digits;
    return (n > 0 ? "+" : "") + n.toFixed(d) + "%";
  }

  // -------------------------------------------------------------------
  // Rendering -- Executive Overview
  // -------------------------------------------------------------------

  function bannerHtml() {
    if (localStorage.getItem(BANNER_DISMISS_KEY) === "1") return "";
    return `
      <div class="imsrx-banner" id="imsrx-banner">
        <div class="imsrx-banner-icon">ℹ️</div>
        <div class="imsrx-banner-body">
          <div class="imsrx-banner-title">Known data limitations</div>
          <div class="imsrx-banner-text">
            Physician-panel Rx-volume audit &mdash; 3 annual snapshots only (MAT Dec 2023 / 2024 / 2025),
            no monthly or quarterly trend, no monetary value. Corporation is not native to this source;
            it is joined by brand-name match against a separate file (96.0% unambiguous, 2.1% ambiguous
            generics with multiple manufacturers, 1.8% unmatched).
          </div>
        </div>
        <button type="button" class="imsrx-banner-close" id="imsrx-banner-close" aria-label="Dismiss">&times;</button>
      </div>`;
  }

  function statTilesHtml(kpi) {
    const yoyClass = kpi.yoy == null ? "" : (kpi.yoy >= 0 ? "imsrx-stat-positive" : "imsrx-stat-negative");
    return `
      <div class="imsrx-stats-row">
        <div class="imsrx-stat-tile imsrx-stat-highlight">
          <div class="imsrx-stat-label">Total Market Rx <span class="imsrx-stat-sub">MAT Dec 2025</span></div>
          <div class="imsrx-stat-value">${fmtBig(kpi.total2025)}</div>
        </div>
        <div class="imsrx-stat-tile ${yoyClass}">
          <div class="imsrx-stat-label">YoY Growth <span class="imsrx-stat-sub">2024 → 2025</span></div>
          <div class="imsrx-stat-value">${fmtPct(kpi.yoy, 2)}</div>
        </div>
        <div class="imsrx-stat-tile">
          <div class="imsrx-stat-label">2-Yr CAGR <span class="imsrx-stat-sub">2023 → 2025</span></div>
          <div class="imsrx-stat-value">${fmtPct(kpi.cagr, 2)}</div>
        </div>
        <div class="imsrx-stat-tile">
          <div class="imsrx-stat-label">Products Tracked</div>
          <div class="imsrx-stat-value">${kpi.productsTracked.toLocaleString()}</div>
        </div>
        <div class="imsrx-stat-tile">
          <div class="imsrx-stat-label">Corporation ID Coverage <span class="imsrx-stat-sub">of MAT 2025 Rx, unambiguous</span></div>
          <div class="imsrx-stat-value">${kpi.corpUnambiguousPct != null ? kpi.corpUnambiguousPct.toFixed(1) + "%" : "—"}</div>
        </div>
      </div>`;
  }

  function renderOverview() {
    const kpi = computeKPIs();
    return `
      ${bannerHtml()}
      ${statTilesHtml(kpi)}
      <div class="imsrx-chart-card">
        <div class="imsrx-chart-card-header">
          <h3>What's driving the 2024 → 2025 change</h3>
          <span class="imsrx-chart-caption">Top ATC3 segments by Rx-volume change &middot; aggregated &Sigma;current &minus; &Sigma;prior, not row-level averaging</span>
        </div>
        <div class="imsrx-chart-wrap"><canvas id="imsrx-movers-chart"></canvas></div>
      </div>`;
  }

  function getPageContentHTML() {
    if (STATE.subTab === "dynamics") return renderDynamics();
    if (STATE.subTab === "company") return renderCompany();
    if (STATE.subTab === "geo") return renderGeo();
    return renderOverview();
  }

  function destroyAllCharts() {
    charts.forEach((c) => { try { c.destroy(); } catch (e) { /* already gone */ } });
    charts = [];
  }

  function renderLayout() {
    const root = document.getElementById("app-root");
    if (!root) return;

    destroyAllCharts();

    const navHtml = NAV_TABS.length > 1
      ? `<div class="sc-nav-tabs">${NAV_TABS.map(([key, label]) =>
          `<button class="sc-tab ${STATE.subTab === key ? "sc-tab-active" : ""}" data-tab="${key}">${label}</button>`
        ).join("")}</div>`
      : "";

    root.innerHTML = `
      <div class="imsrx-page">
        <div class="imsrx-header">
          <h1>IMS Rx — Market Intelligence</h1>
          <p class="imsrx-subhead">Physician-panel prescription-volume audit &middot; Egypt &middot; MAT Dec 2023&ndash;2025</p>
        </div>
        ${navHtml}
        <div id="imsrx-tab-content">${getPageContentHTML()}</div>
      </div>`;

    const closeBtn = document.getElementById("imsrx-banner-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        localStorage.setItem(BANNER_DISMISS_KEY, "1");
        const el = document.getElementById("imsrx-banner");
        if (el) el.remove();
      });
    }

    document.querySelectorAll(".imsrx-page .sc-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        STATE.subTab = tab.dataset.tab;
        renderLayout();
      });
    });

    if (STATE.subTab === "dynamics") {
      wireMdFilterBar(root);
      drawMdCharts();
    } else if (STATE.subTab === "company") {
      wireCfFilterBar(root);
      drawCfCharts();
    } else if (STATE.subTab === "geo") {
      wireGeo(document.getElementById("imsrx-tab-content"));
    } else {
      renderMoversChart();
    }
  }

  function renderMoversChart() {
    const canvas = document.getElementById("imsrx-movers-chart");
    if (!canvas || typeof Chart === "undefined") return;

    const movers = atc3Movers();
    const positives = movers.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
    const negatives = movers.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
    // Worst decliner at top, best gainer at bottom -- reads top-to-bottom.
    const ordered = negatives.slice().reverse().concat(positives.slice().reverse());

    const chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: ordered.map((m) => m.name),
        datasets: [{
          data: ordered.map((m) => m.delta),
          backgroundColor: ordered.map((m) => (m.delta >= 0 ? "#15803D" : "#B91C1C")),
          borderRadius: 3,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.raw >= 0 ? "+" : ""}${Math.round(ctx.raw).toLocaleString()} Rx`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: "#E2E8F0" },
            ticks: { callback: (v) => (v >= 0 ? "+" : "") + fmtBig(v) },
          },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } },
        },
      },
    });
    charts.push(chart);
  }

  // =====================================================================
  // GEO & SPECIALTY (added 2026-09-28, design approved by Ahmed)
  // ---------------------------------------------------------------------
  // Market Rx distribution by Region and Specialty for ONE selected IQVIA
  // market (DM1 or DM2 -- see buildMarketIndex) and one Product focus,
  // reading from "where is the volume?" to "where is the opportunity?":
  //   Market Rx -> Market Mix % -> Product Rx -> Product Mix % ->
  //   Product Share % -> Fair-Share Index -> Rx Gap
  //
  // FORMULAS (row x = one region or one specialty, context C = period +
  // market + the OTHER panel's chip selection):
  //   Market Mix %(x)  = MktRx(x) / SUM MktRx(C)
  //   Product Mix %(x) = ProdRx(x) / SUM ProdRx(C)
  //   Share %(x)       = ProdRx(x) / MktRx(x)
  //   Index(x)         = ProdMix(x) / MktMix(x) * 100  (= Share(x)/Share(C)*100)
  //                      <90 Under-indexed | 90-110 In-line | >110 Over-indexed
  //   Rx Gap(x)        = MktRx(x) * Share(C) - ProdRx(x)   (+ = shortfall)
  // MATRIX / OPPORTUNITY cells use the product's share of the WHOLE market
  // (period, no chips) as benchmark so cells are comparable across the grid.
  // Only positive gaps count as opportunity (gaps net to ~0 by construction).
  // SMALL-CELL RULE: a row/cell whose market Rx is < 0.5% of the market's
  // total Rx in the period shows "—" for Share / Index / Gap (Rx still shown).
  // OPPORTUNITY TYPE: specialty promoted for the focus brand in the line that
  // owns this market (cache.promo, from the Promo Grids via
  // config/promo_specialty_map.json) -> "Focus-specialty growth" (was Execution Gap); otherwise "New-specialty potential" (was Targeting
  // Gap; no Promo Grid data for the brand -> "No Promo data" (never guessed).
  // ACCESS: page role gate unchanged; the MARKET list is scoped like the
  // Target Achievement page (js/iqvia.js applyUserFilter): explicit
  // "Allowed Markets DM1" wins, else markets of the user's Lines, else BU,
  // from the target file. Unrestricted users see every market.
  // =====================================================================

  const GEO_SMALL_CELL = 0.005;
  const GEO_IDX_LO = 90;
  const GEO_IDX_HI = 110;
  const GEO_TOP_SPECS = 8;
  let GEO = null;
  const geoMemo = new Map();

  function geoNorm(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().toUpperCase(); }

  function geoUser() {
    return (window.AUTH && typeof window.AUTH.getValidSessionUser === "function")
      ? window.AUTH.getValidSessionUser() : null;
  }

  /** Allowed market indices for kind ('dm1'|'dm2') -- null = unrestricted.
   * Mirrors js/iqvia.js applyUserFilter()'s market-scope rule. */
  function geoAllowedMarkets(kind) {
    if (kind === "atc4") {
      // ATC4 basis: restricted users get the ATC4 classes their assigned DM1 markets sit in.
      const dm = geoAllowedMarkets("dm1");
      if (!dm) return null;
      const out = new Set();
      (cache.lookups.prodAtc4Dm || []).forEach((r) => { if (r[2].some((d) => dm.has(d))) out.add(r[1]); });
      return out;
    }
    const u = geoUser();
    if (!u) return null;
    const bu = u.bu, ln = u.lines, dm = u.dm1s;
    if (!(bu && bu.length) && !(ln && ln.length) && !(dm && dm.length)) return null;
    const names = new Set();
    if (dm && dm.length) {
      dm.forEach((d) => names.add(geoNorm(d)));          // DM2 mirrors DM1 names (same as iqvia.js)
    } else {
      const lnSet = new Set((ln || []).map(geoNorm));
      const buSet = new Set((bu || []).map(geoNorm));
      ((cache.promo && cache.promo.targets) || []).forEach((t) => {
        const ok = lnSet.size ? lnSet.has(geoNorm(t.line)) : buSet.has(geoNorm(t.bu));
        if (ok) names.add(geoNorm(kind === "dm1" ? t.dm1 : t.dm2));
      });
    }
    const out = new Set();
    (cache.lookups[kind + "s"] || []).forEach((n, i) => { if (names.has(geoNorm(n))) out.add(i); });
    return out;
  }

  function geoZetaSet() {
    const s = new Set();
    for (let p = 0; p < companyOfProduct.length; p++) {
      const c = companyOfProduct[p];
      if (c >= 0 && /^ZETA\b/i.test(companyNames[c] || "")) s.add(p); // ^ZETA: "ERBOZETA*" is a different company (fixed 2026-09-29)
    }
    return s;
  }

  // ---- Market "All" + Corporation filter (added 2026-09-29, Ahmed) -------
  // GEO.market === "all" -> union of every market the user may see under the
  // current basis (unrestricted: every DM1/DM2-mapped row, or the whole
  // panel for ATC4). Each fact row is counted ONCE even when its brand sits
  // in several markets, so "All markets" never double counts.
  // GEO.corp: null = all corporations, else a companyIdx (see
  // buildCompanyIndex; only confidence-2 attributions). Focus values:
  //   "zeta" -> every Zeta brand | "corp" -> every brand of GEO.corp |
  //   number -> one brand.
  function geoCorpSet(ci) {
    const s = new Set();
    for (let p = 0; p < companyOfProduct.length; p++) if (companyOfProduct[p] === ci) s.add(p);
    return s;
  }
  function geoIsZetaCorp(ci) { return ci != null && /^ZETA\b/i.test(companyNames[ci] || ""); }
  function geoFocusSet(focus) {
    if (focus === "zeta") return geoZetaSet();
    if (focus === "corp") return GEO.corp != null ? geoCorpSet(GEO.corp) : geoZetaSet();
    return new Set([focus]);
  }
  function geoFocusIsGroup(focus) { return focus === "zeta" || focus === "corp"; }
  function geoMarketName(kind, m) { return m === "all" ? "All markets" : cache.lookups[kind + "s"][m]; }

  /** One pass over the fact table for (kind, market, period, prior):
   * per-brand Region x Specialty cells (current + prior). Memoised. */
  function geoCube(kind, market, period) {
    const key = kind + "|" + market + "|" + period + (market === "all" ? "|" + (geoUser() ? geoUser().email || geoUser().name || "u" : "anon") : "");
    if (geoMemo.has(key)) return geoMemo.get(key);
    const f = cache.fact, st = f.stride;
    const fi = (k) => f.fields.indexOf(k);
    const PI = fi("period"), PR = fi("product"), RG = fi("region"), SP = fi("specialty"), AT = fi("atc4");
    const nR = cache.lookups.regions.length, nS = cache.lookups.specialties.length, nC = nR * nS;
    const prior = period - 1;
    const isAll = market === "all";
    const allowedAll = isAll ? geoAllowedMarkets(kind) : null;
    const brands = new Map(); // product -> {cur:Float64Array, pri:Float64Array}
    const mktCur = new Float64Array(nC), mktPri = new Float64Array(nC);
    for (let i = 0; i < f.rx.length; i++) {
      const b = i * st;
      const p = f.rows[b + PI];
      if (p !== period && p !== prior) continue;
      if (isAll) {
        if (kind === "atc4") { if (allowedAll && !allowedAll.has(f.rows[b + AT])) continue; }
        else {
          const ms = marketsOfRow(b, kind);
          if (!ms.length) continue;
          if (allowedAll) { let hit = false; for (let j = 0; j < ms.length; j++) if (allowedAll.has(ms[j])) { hit = true; break; } if (!hit) continue; }
        }
      }
      else if (kind === "atc4") { if (f.rows[b + AT] !== market) continue; }
      else if (marketsOfRow(b, kind).indexOf(market) < 0) continue;
      const c = f.rows[b + RG] * nS + f.rows[b + SP];
      const prod = f.rows[b + PR];
      let e = brands.get(prod);
      if (!e) { e = { cur: new Float64Array(nC), pri: new Float64Array(nC) }; brands.set(prod, e); }
      if (p === period) { e.cur[c] += f.rx[i]; mktCur[c] += f.rx[i]; }
      else { e.pri[c] += f.rx[i]; mktPri[c] += f.rx[i]; }
    }
    const cube = { nR, nS, brands, mktCur, mktPri, hasPrior: prior >= 0 };
    geoMemo.set(key, cube);
    return cube;
  }

  function geoFocusCells(cube, focus) {
    const nC = cube.nR * cube.nS;
    const cur = new Float64Array(nC), pri = new Float64Array(nC);
    const set = geoFocusSet(focus);
    cube.brands.forEach((e, p) => {
      if (!set.has(p)) return;
      for (let c = 0; c < nC; c++) { cur[c] += e.cur[c]; pri[c] += e.pri[c]; }
    });
    return { cur, pri };
  }

  function geoSum(arr, nS, rSet, sSet) {
    let t = 0;
    for (let c = 0; c < arr.length; c++) {
      const r = Math.floor(c / nS), s = c % nS;
      if (rSet && rSet.size && !rSet.has(r)) continue;
      if (sSet && sSet.size && !sSet.has(s)) continue;
      t += arr[c];
    }
    return t;
  }

  /** Target-file rows that belong to market idx under basis kind. For ATC4, a target
   * belongs when its brand has Rx pairs in that ATC4 (a brand promoted by two lines,
   * e.g. BILASTIGEC Pedia + Derma, contributes both lines' promoted specialties). */
  function geoTargetsFor(kind, mIdx) {
    const T = (cache.promo && cache.promo.targets) || [];
    if (mIdx === "all") {
      const allowed = geoAllowedMarkets(kind);
      if (!allowed) return T;
      const seen = new Set(), out = [];
      allowed.forEach((m) => geoTargetsFor(kind, m).forEach((t) => { if (!seen.has(t)) { seen.add(t); out.push(t); } }));
      return out;
    }
    if (kind !== "atc4") {
      const mn = geoNorm(cache.lookups[kind + "s"][mIdx]);
      return T.filter((t) => geoNorm(kind === "dm1" ? t.dm1 : t.dm2) === mn);
    }
    const names = new Set();
    (cache.lookups.prodAtc4Dm || []).forEach((r) => { if (r[1] === mIdx) names.add(geoNorm(cache.lookups.products[r[0]])); });
    return T.filter((t) => names.has(geoNorm(t.prod)));
  }

  /** Promo info for the focus in this market -- {known, promoted:Set, unmeasurable:[], source, reason}. */
  function geoPromo(kind, mIdx, focus) {
    const rows = geoTargetsFor(kind, mIdx);
    let pick = rows;
    if (focus === "corp") {
      if (!geoIsZetaCorp(GEO.corp)) return { known: false, reason: "Promo Grids cover Zeta brands only — not applicable to " + (companyNames[GEO.corp] || "this corporation"), promoted: new Set(), unmeasurable: [] };
      const cs = new Set([...geoCorpSet(GEO.corp)].map((p) => geoNorm(cache.lookups.products[p])));
      pick = rows.filter((t) => cs.has(geoNorm(t.prod)));
    } else if (focus !== "zeta") {
      const pn = geoNorm(cache.lookups.products[focus]);
      pick = rows.filter((t) => geoNorm(t.prod) === pn);
    }
    if (!pick.length) return { known: false, reason: geoFocusIsGroup(focus) ? "No Zeta target brand in this market" : "Not a Zeta target brand in this market", promoted: new Set(), unmeasurable: [] };
    const ok = pick.filter((t) => t.status === "ok");
    if (!ok.length) {
      const why = { grid_has_no_specialty_sheet: "Promo Grid has no specialty sheet (" + (pick[0].gridFiles || []).join(", ") + ")",
        not_in_grid: "Brand not found in the " + pick[0].line + " Promo Grid", no_grid_file: "No Promo Grid file for line " + pick[0].line };
      return { known: false, reason: why[pick[0].status] || pick[0].status, promoted: new Set(), unmeasurable: [] };
    }
    const promoted = new Set(), unm = new Set(), src = [];
    ok.forEach((t) => {
      t.promoted.forEach((i) => promoted.add(i));
      (t.promotedUnmeasurable || []).forEach((x) => unm.add(x));
      src.push(t.line + " grid: " + t.gridBrand);
    });
    return { known: true, promoted, unmeasurable: [...unm], source: [...new Set(src)].join(" · ") };
  }

  // ---- "How to read this" guides (added 2026-09-28) ----------------------
  // One highlighted box per section: plain-language WHAT / HOW + a live
  // "What it says now" sentence computed from the numbers on screen.
  // Toggle: GEO.guides (remembered per browser, best-effort localStorage).
  const GEO_GUIDE_KEY = "imsrx_geo_guides_v1";
  function geoGuidesPref() { try { return localStorage.getItem(GEO_GUIDE_KEY) !== "0"; } catch (e) { return true; } }
  function geoGuidesSave(on) { try { localStorage.setItem(GEO_GUIDE_KEY, on ? "1" : "0"); } catch (e) { /* private mode */ } }

  function geoGuide(what, how, now) {
    if (!GEO.guides) return "";
    return `<div class="imsrx-geo-guide"><div class="gd-h">💡 How to read this</div>
      <p><b>What it shows:</b> ${what}</p><p><b>How to use it:</b> ${how}</p>
      ${now ? `<p class="gd-now"><b>What it says now:</b> ${now}</p>` : ""}</div>`;
  }

  function geoGuidePanel(dim, data, promo) {
    const noun = dim === "region" ? "region" : "doctor specialty";
    const rows = data.rows;
    const short = rows.filter((r) => r.gap != null && r.gap > 0).sort((a, b) => b.gap - a.gap)[0];
    const strong = rows.filter((r) => r.index != null).sort((a, b) => b.index - a.index)[0];
    let now;
    if (!(data.pT > 0)) now = "Our product has no prescriptions in this selection.";
    else {
      now = short
        ? `Biggest room to grow is <b>${escAttr(short.name)}</b> — our share there is ${gPct(short.share, 2)} vs our ${gPct(data.ctxShare, 2)} average ${(dim === "region" ? GEO.specs.size : GEO.regions.size) ? "in this selection" : "in the market"}, about <b>${gRx(short.gap)} Rx</b> of potential.`
        : "No " + noun + " is below our average share.";
      if (strong && (!short || strong.idx !== short.idx) && strong.index > GEO_IDX_HI)
        now += ` Strongest is <b>${escAttr(strong.name)}</b> (share ${gPct(strong.share, 2)}, ${Math.round(strong.index)} vs 100 average).`;
    }
    const promoLine = dim === "specialty" && promo.known ? " <b>●</b> = a specialty we promote to (Promo Grid); <b>○</b> = not promoted." : "";
    return geoGuide(
      `How the market's prescriptions split by ${noun} (<b>Market Mix %</b>), how <b>our</b> prescriptions split (<b>Product Mix %</b>), and how strong we are in each ${noun}.`,
      `If our mix % is <b>lower</b> than the market's in a ${noun}, we are under-represented there. <b>Share %</b> = our Rx ÷ all Rx in that ${noun}. ` +
      `<b>Index</b> compares that share with our average: 100 = average, <b>below 90 = below average</b>, <b>above 110 = above average</b>. ` +
      `<b>Rx Gap</b> = extra prescriptions we would get if this ${noun} reached our average share (orange/red = room to grow, green = ahead). Click a row to filter the rest of the page.${promoLine}`,
      now);
  }

  function geoGuideMatrix(cells) {
    const judged = cells.filter((x) => x.index != null);
    const weak = judged.filter((x) => x.index < GEO_IDX_LO).length, strong = judged.filter((x) => x.index > GEO_IDX_HI).length;
    return geoGuide(
      "Every region × specialty combination in one grid, compared with our share of the whole market.",
      "Switch between <b>Share %</b>, <b>Index</b> and <b>Rx Gap</b> with the buttons. <b style='color:#B91C1C'>Red</b> = below our average, <b>grey</b> = in line, <b style='color:#15803D'>green</b> = above. " +
      "In Rx Gap mode, darker orange = more room to grow. “—” = too small to judge (under 0.5% of the market). Click a cell to focus the whole page on it.",
      judged.length ? `<b>${weak}</b> cells below our average (red) and <b>${strong}</b> above it (green) out of ${judged.length} that are large enough to judge.` : "");
  }

  function geoGuideOpportunity(tot, top, promo) {
    let now = "";
    if (top) {
      now = promo.known
        ? `Growth available in focus specialties <b>${gRx(tot.exec)} Rx</b> and in new specialties <b>${gRx(tot.target)} Rx</b>. ` : `Total potential <b>${gRx(tot.none)} Rx</b> (no Promo Grid data to split it). `;
      now += `Biggest single opportunity: <b>${escAttr(cache.lookups.regions[top.r])} × ${escAttr(cache.lookups.specialties[top.s])}</b>, about <b>${gRx(top.gap)} Rx</b>.`;
    }
    return geoGuide(
      "The region × specialty cells with the most room to grow, ranked by the extra prescriptions available if we reached our normal share.",
      "<b>📈 Focus-specialty growth</b> = a specialty we already promote to, where our share is below our average → the quickest place to grow (coverage, call frequency, message). " +
      "<b>🌱 New-specialty potential</b> = a specialty we do not promote to yet → worth reviewing whether it should join the promotion plan. " +
      "<b>Cell leader</b> = the brand winning that cell — the competitor to study.",
      now);
  }

  function geoGuideCompetitors(rows, tot, focusRank) {
    let now = "";
    if (rows.length && tot > 0) {
      now = `Leader is <b>${escAttr(cache.lookups.products[rows[0].p])}</b> with ${gPct(rows[0].v / tot, 1)} of prescriptions.`;
      if (focusRank >= 0) now += ` Our brand ranks <b>#${focusRank + 1}</b> of ${rows.length} with ${gPct(rows[focusRank].v / tot, 1)}.`;
    }
    return geoGuide(
      "Who wins the prescriptions in exactly what you have selected (market, region, specialty).",
      "Look at <b>Share %</b> to see who dominates, and <b>Δ Share</b> to see who is gaining (green) or losing (red) vs last year. Our brand is highlighted.",
      now);
  }

  function resetGeo() {
    GEO = { period: 2, kind: "dm1", market: null, corp: null, focus: null, regions: new Set(), specs: new Set(), matrix: "share", allSpecs: false, guides: geoGuidesPref() };
  }

  function geoMarketOptions() {
    const names = cache.lookups[GEO.kind + "s"] || [];
    const allowed = geoAllowedMarkets(GEO.kind);
    const out = [];
    names.forEach((n, i) => { if (!allowed || allowed.has(i)) out.push({ idx: i, name: n }); });
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  function geoEnsureSelection() {
    const opts = geoMarketOptions();
    if (!opts.length) { GEO.market = null; return; }
    if (GEO.market == null || (GEO.market !== "all" && !opts.some((o) => o.idx === GEO.market))) {
      // default: first allowed market that has Rx in the period
      const withRx = opts.find((o) => { const c = geoCube(GEO.kind, o.idx, GEO.period); return c.mktCur.some((v) => v > 0); });
      GEO.market = (withRx || opts[0]).idx;
      GEO.focus = null;
    }
    if (GEO.focus == null && GEO.corp != null) GEO.focus = "corp";
    if (GEO.focus == null) {
      const cube = geoCube(GEO.kind, GEO.market, GEO.period);
      const tProds = new Set(geoTargetsFor(GEO.kind, GEO.market).map((t) => geoNorm(t.prod)));
      const zeta = geoZetaSet();
      let best = null, bestV = -1, bestZ = null, bestZV = -1;
      cube.brands.forEach((e, p) => {
        const v = e.cur.reduce((a, b) => a + b, 0);
        if (tProds.has(geoNorm(cache.lookups.products[p])) && v > bestV) { best = p; bestV = v; }
        if (zeta.has(p) && v > bestZV) { bestZ = p; bestZV = v; }
      });
      GEO.focus = best != null ? best : (bestZ != null ? bestZ : "zeta");
    }
  }

  // ---- formatting helpers (local to this tab) ----
  function gPct(v, d) { return v == null || !isFinite(v) ? "—" : (v * 100).toFixed(d == null ? 1 : d) + "%"; }
  function gRx(v) { return v == null ? "—" : fmtBig(v); }
  function gSigned(v) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + fmtBig(Math.abs(v)); }
  function gPp(v) { return v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(1) + " pp"; }
  function gBand(ix) { return ix == null ? "" : ix < GEO_IDX_LO ? "under" : ix > GEO_IDX_HI ? "over" : "inline"; }
  function gIndexBadge(ix) {
    if (ix == null || !isFinite(ix)) return '<span class="imsrx-geo-muted">—</span>';
    const b = gBand(ix), lbl = b === "under" ? "Under" : b === "over" ? "Over" : "In-line";
    return `<span class="imsrx-geo-ix imsrx-geo-ix-${b}" title="${lbl}-indexed">${Math.round(ix)}</span>`;
  }

  /** Panel rows for one dimension ('region'|'specialty') under the OTHER panel's chips. */
  function geoPanelRows(dim, cube, fc, mktTotalAll) {
    const nS = cube.nS, nR = cube.nR;
    const n = dim === "region" ? nR : nS;
    const rSel = dim === "region" ? null : GEO.regions;
    const sSel = dim === "region" ? GEO.specs : null;
    const mkt = new Float64Array(n), prod = new Float64Array(n), mktP = new Float64Array(n), prodP = new Float64Array(n);
    for (let c = 0; c < cube.mktCur.length; c++) {
      const r = Math.floor(c / nS), s = c % nS;
      if (rSel && rSel.size && !rSel.has(r)) continue;
      if (sSel && sSel.size && !sSel.has(s)) continue;
      const x = dim === "region" ? r : s;
      mkt[x] += cube.mktCur[c]; prod[x] += fc.cur[c]; mktP[x] += cube.mktPri[c]; prodP[x] += fc.pri[c];
    }
    const mT = mkt.reduce((a, b) => a + b, 0), pT = prod.reduce((a, b) => a + b, 0);
    const ctxShare = mT > 0 ? pT / mT : 0;
    const rows = [];
    for (let x = 0; x < n; x++) {
      if (mkt[x] <= 0 && prod[x] <= 0) continue;
      const small = mkt[x] < GEO_SMALL_CELL * mktTotalAll;
      const share = mkt[x] > 0 ? prod[x] / mkt[x] : null;
      const shareP = mktP[x] > 0 ? prodP[x] / mktP[x] : null;
      rows.push({
        idx: x,
        name: dim === "region" ? cache.lookups.regions[x] : cache.lookups.specialties[x],
        mkt: mkt[x], mktMix: mT > 0 ? mkt[x] / mT : null,
        prod: prod[x], prodMix: pT > 0 ? prod[x] / pT : null,
        share: small ? null : share,
        dShare: small || !cube.hasPrior || share == null || shareP == null ? null : share - shareP,
        index: small || !(ctxShare > 0) || share == null ? null : share / ctxShare * 100,
        gap: small ? null : mkt[x] * ctxShare - prod[x],
        small,
      });
    }
    rows.sort((a, b) => b.mkt - a.mkt);
    return { rows, mT, pT, ctxShare };
  }

  function geoMixBar(mMix, pMix) {
    const m = mMix == null ? 0 : mMix * 100, p = pMix == null ? 0 : pMix * 100;
    return `<div class="imsrx-geo-twin" title="Market mix ${m.toFixed(1)}% · Product mix ${p.toFixed(1)}%">
      <span class="imsrx-geo-twin-m" style="width:${Math.min(100, m).toFixed(1)}%"></span>
      <span class="imsrx-geo-twin-p" style="width:${Math.min(100, p).toFixed(1)}%"></span></div>`;
  }

  function geoPanelHtml(dim, data, promo) {
    const sel = dim === "region" ? GEO.regions : GEO.specs;
    let rows = data.rows;
    let others = null;
    if (dim === "specialty" && !GEO.allSpecs && rows.length > GEO_TOP_SPECS) {
      const rest = rows.slice(GEO_TOP_SPECS).filter((r) => !sel.has(r.idx));
      rows = rows.slice(0, GEO_TOP_SPECS).concat(rows.slice(GEO_TOP_SPECS).filter((r) => sel.has(r.idx)));
      if (rest.length) {
        others = rest.reduce((a, r) => ({ mkt: a.mkt + r.mkt, prod: a.prod + r.prod }), { mkt: 0, prod: 0 });
        others.n = rest.length;
      }
    }
    const title = dim === "region" ? "① Region distribution" : "② Specialty distribution";
    const ctx = dim === "region"
      ? (GEO.specs.size ? `for ${GEO.specs.size === 1 ? escAttr(cache.lookups.specialties[[...GEO.specs][0]]) : GEO.specs.size + " specialties"}` : "all specialties")
      : (GEO.regions.size ? `in ${GEO.regions.size === 1 ? escAttr(cache.lookups.regions[[...GEO.regions][0]]) : GEO.regions.size + " regions"}` : "all regions");
    let h = `<div class="imsrx-geo-card">
      <div class="imsrx-geo-card-h"><h3>${title}</h3><span class="imsrx-geo-ctx">${ctx} · click to filter, Ctrl/⌘+click to multi-select</span></div>
      ${geoGuidePanel(dim, data, promo)}
      <div class="imsrx-geo-tbl-wrap"><table class="imsrx-geo-tbl${sel.size ? " has-sel" : ""}">
      <thead>
        <tr class="imsrx-geo-grp"><th></th>
          <th colspan="2" class="g-vol">Where is the volume?</th>
          <th colspan="2" class="g-we">Where are we?</th>
          <th colspan="2" class="g-str">How strong?</th>
          <th class="g-ix">Over / under?</th>
          <th class="g-gap">At stake</th></tr>
        <tr><th>${dim === "region" ? "Region" : "Specialty"}</th>
          <th class="num g-vol">Market Rx</th><th class="num g-vol">Market Mix %</th>
          <th class="num g-we">Product Rx</th><th class="num g-we">Product Mix %</th>
          <th class="num g-str">Share %</th><th class="num g-str">Δ Share</th>
          <th class="num g-ix">Index</th><th class="num g-gap">Rx Gap</th></tr>
      </thead><tbody>`;
    rows.forEach((r) => {
      const on = sel.has(r.idx);
      const promoTag = dim === "specialty" && promo.known
        ? (promo.promoted.has(r.idx) ? '<span class="imsrx-geo-pm" title="Promoted specialty (Promo Grid)">●</span>' : '<span class="imsrx-geo-npm" title="Not promoted">○</span>') : "";
      h += `<tr class="imsrx-geo-row${on ? " on" : ""}" data-geo-dim="${dim}" data-geo-idx="${r.idx}" tabindex="0">
        <td class="nm">${promoTag}${escAttr(r.name)}</td>
        <td class="num">${gRx(r.mkt)}</td>
        <td class="num mix">${gPct(r.mktMix)}${geoMixBar(r.mktMix, r.prodMix)}</td>
        <td class="num">${gRx(r.prod)}</td>
        <td class="num">${gPct(r.prodMix)}</td>
        <td class="num strong">${r.small ? '<span class="imsrx-geo-muted" title="Market Rx below 0.5% of market total">—</span>' : gPct(r.share, 2)}</td>
        <td class="num ${r.dShare > 0 ? "pos" : r.dShare < 0 ? "neg" : ""}">${gPp(r.dShare)}</td>
        <td class="num">${gIndexBadge(r.index)}</td>
        <td class="num ${r.gap > 0 ? "neg" : r.gap < 0 ? "pos" : ""}">${gSigned(r.gap)}</td></tr>`;
    });
    if (others) {
      h += `<tr class="imsrx-geo-others"><td class="nm">Others (${others.n})</td><td class="num">${gRx(others.mkt)}</td>
        <td class="num">${gPct(data.mT ? others.mkt / data.mT : null)}</td><td class="num">${gRx(others.prod)}</td>
        <td class="num">${gPct(data.pT ? others.prod / data.pT : null)}</td><td colspan="4"></td></tr>`;
    }
    h += `<tr class="imsrx-geo-total"><td class="nm">Total in context</td><td class="num">${gRx(data.mT)}</td><td class="num">100%</td>
      <td class="num">${gRx(data.pT)}</td><td class="num">100%</td><td class="num strong">${gPct(data.ctxShare, 2)}</td><td colspan="3"></td></tr>`;
    h += "</tbody></table></div>";
    if (dim === "specialty" && data.rows.length > GEO_TOP_SPECS) {
      h += `<button type="button" class="imsrx-geo-link" id="imsrx-geo-allspecs">${GEO.allSpecs ? "Show top " + GEO_TOP_SPECS : "Show all " + data.rows.length + " specialties"}</button>`;
    }
    return h + "</div>";
  }

  function geoCellStats(cube, fc, nationalShare, mktTotalAll) {
    const cells = [];
    for (let c = 0; c < cube.mktCur.length; c++) {
      const m = cube.mktCur[c], p = fc.cur[c];
      const small = m < GEO_SMALL_CELL * mktTotalAll;
      const share = m > 0 ? p / m : null;
      cells.push({
        c, r: Math.floor(c / cube.nS), s: c % cube.nS, mkt: m, prod: p, small,
        share: small ? null : share,
        index: small || !(nationalShare > 0) || share == null ? null : share / nationalShare * 100,
        gap: small ? null : m * nationalShare - p,
      });
    }
    return cells;
  }

  function geoMatrixHtml(cube, cells, specOrder, promo) {
    const mode = GEO.matrix;
    const maxGap = Math.max(1, ...cells.filter((x) => x.gap > 0).map((x) => x.gap));
    let h = `<div class="imsrx-geo-card">
      <div class="imsrx-geo-card-h"><h3>③ Region × Specialty matrix</h3>
        <div class="imsrx-geo-seg">${[["share", "Share %"], ["index", "Index"], ["gap", "Rx Gap"]].map(([k, l]) =>
          `<button type="button" data-geo-matrix="${k}" class="${mode === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <span class="imsrx-geo-ctx">benchmark = product share of the whole market · colour: <span class="imsrx-geo-ix imsrx-geo-ix-under">&lt;90</span> <span class="imsrx-geo-ix imsrx-geo-ix-inline">90–110</span> <span class="imsrx-geo-ix imsrx-geo-ix-over">&gt;110</span>${mode === "gap" ? " · darker = larger shortfall" : ""}</span></div>
      ${geoGuideMatrix(cells)}
      <div class="imsrx-geo-tbl-wrap"><table class="imsrx-geo-mx"><thead><tr><th></th>`;
    specOrder.forEach((s) => {
      const pm = promo.known && promo.promoted.has(s) ? '<span class="imsrx-geo-pm">●</span>' : "";
      h += `<th class="${GEO.specs.has(s) ? "on" : ""}">${pm}${escAttr(cache.lookups.specialties[s])}</th>`;
    });
    h += "</tr></thead><tbody>";
    for (let r = 0; r < cube.nR; r++) {
      h += `<tr><th class="${GEO.regions.has(r) ? "on" : ""}">${escAttr(cache.lookups.regions[r])}</th>`;
      specOrder.forEach((s) => {
        const x = cells[r * cube.nS + s];
        const sel = (GEO.regions.size || GEO.specs.size) && (!GEO.regions.size || GEO.regions.has(r)) && (!GEO.specs.size || GEO.specs.has(s));
        let txt, cls = "", style = "";
        if (x.mkt <= 0) { txt = ""; cls = "empty"; }
        else if (x.small) { txt = "—"; cls = "small"; }
        else if (mode === "gap") {
          txt = gSigned(x.gap);
          if (x.gap > 0) style = `background:rgba(234,88,12,${(0.12 + 0.6 * x.gap / maxGap).toFixed(2)})`;
          else cls = "neutral";
        } else {
          txt = mode === "share" ? gPct(x.share, 1) : Math.round(x.index);
          cls = "b-" + gBand(x.index);
        }
        const tip = `${cache.lookups.regions[r]} × ${cache.lookups.specialties[s]} — Market Rx ${gRx(x.mkt)}, Product Rx ${gRx(x.prod)}, Share ${gPct(x.share, 2)}, Index ${x.index == null ? "—" : Math.round(x.index)}, Gap ${gSigned(x.gap)}`;
        h += `<td class="imsrx-geo-cell ${cls}${sel ? " on" : ""}" style="${style}" data-geo-cell="${r},${s}" title="${escAttr(tip)}">${txt}</td>`;
      });
      h += "</tr>";
    }
    return h + "</tbody></table></div></div>";
  }

  function geoLeaderIn(cube, cellFilter) {
    let best = null, bestV = 0, tot = 0;
    cube.brands.forEach((e, p) => {
      let v = 0;
      for (let c = 0; c < e.cur.length; c++) if (cellFilter(c)) v += e.cur[c];
      tot += v;
      if (v > bestV) { bestV = v; best = p; }
    });
    return best == null ? null : { p: best, share: tot > 0 ? bestV / tot : 0 };
  }

  function geoOpportunityHtml(cube, cells, promo) {
    const inCtx = (x) => (!GEO.regions.size || GEO.regions.has(x.r)) && (!GEO.specs.size || GEO.specs.has(x.s));
    const opp = cells.filter((x) => inCtx(x) && x.gap != null && x.gap > 0).sort((a, b) => b.gap - a.gap);
    const typeOf = (x) => !promo.known ? "none" : promo.promoted.has(x.s) ? "exec" : "target";
    const tot = { exec: 0, target: 0, none: 0 };
    opp.forEach((x) => { tot[typeOf(x)] += x.gap; });
    const TY = { exec: ["📈", "Focus-specialty growth", "A specialty we already promote to — room to grow our share here"],
      target: ["🌱", "New-specialty potential", "A specialty we do not promote to yet — potential worth reviewing"],
      none: ["⚪", "No Promo data", promo.reason || "No Promo Grid data for this brand"] };
    let h = `<div class="imsrx-geo-card">
      <div class="imsrx-geo-card-h"><h3>④ Opportunity — Region × Specialty ranked by Rx Gap</h3>
      <span class="imsrx-geo-ctx">positive gaps only · benchmark = product share of the whole market</span></div>
      ${geoGuideOpportunity(tot, opp[0], promo)}
      <div class="imsrx-geo-opp-sum">
        ${promo.known ? `<div class="imsrx-geo-opp-tile exec"><span>📈 Focus-specialty growth</span><strong>${gRx(tot.exec)} Rx</strong><em>specialties we already promote to</em></div>
        <div class="imsrx-geo-opp-tile target"><span>🌱 New-specialty potential</span><strong>${gRx(tot.target)} Rx</strong><em>specialties not yet in our plan</em></div>`
        : `<div class="imsrx-geo-opp-tile none"><span>⚪ No Promo data — potential not split</span><strong>${gRx(tot.none)} Rx</strong><em>${escAttr(promo.reason || "")}</em></div>`}
      </div>`;
    if (!cells.some((x) => x.prod > 0)) return h + '<div class="imsrx-empty">The selected product has no Rx in this market in the IMS panel, so there is no fair-share benchmark. See Competitors below.</div></div>';
    if (!opp.length) return h + '<div class="imsrx-empty">No positive Rx gap in the current selection — the product is at or above its market-wide share in every measurable cell.</div></div>';
    h += `<div class="imsrx-geo-tbl-wrap"><table class="imsrx-geo-tbl"><thead><tr><th>#</th><th>Region</th><th>Specialty</th>
      <th class="num">Market Rx</th><th class="num">Product Rx</th><th class="num">Share %</th><th class="num">Index</th><th class="num">Rx Gap</th><th>Cell leader</th></tr></thead><tbody>`;
    opp.slice(0, 15).forEach((x, i) => {
      const t = TY[typeOf(x)];
      const lead = geoLeaderIn(cube, (c) => c === x.c);
      const leadNm = lead ? cache.lookups.products[lead.p] : "—";
      h += `<tr class="imsrx-geo-row" data-geo-cell="${x.r},${x.s}" tabindex="0"><td>${i + 1}</td><td>${escAttr(cache.lookups.regions[x.r])}</td>
        <td>${escAttr(cache.lookups.specialties[x.s])}</td>
        <td class="num">${gRx(x.mkt)}</td><td class="num">${gRx(x.prod)}</td><td class="num">${gPct(x.share, 2)}</td>
        <td class="num">${gIndexBadge(x.index)}</td><td class="num neg strong">${gSigned(x.gap)}</td>
        <td>${escAttr(leadNm)}${lead ? ` <span class="imsrx-geo-muted">${gPct(lead.share, 0)}</span>` : ""}</td></tr>`;
    });
    h += `</tbody></table></div>${opp.length > 15 ? `<div class="imsrx-geo-muted" style="margin-top:6px">Showing top 15 of ${opp.length} cells with a positive gap.</div>` : ""}</div>`;
    return h;
  }

  function geoCompetitorsHtml(cube, focus) {
    const nS = cube.nS;
    const inCtx = (c) => (!GEO.regions.size || GEO.regions.has(Math.floor(c / nS))) && (!GEO.specs.size || GEO.specs.has(c % nS));
    const rows = [];
    let tot = 0, totP = 0;
    cube.brands.forEach((e, p) => {
      let v = 0, vp = 0;
      for (let c = 0; c < e.cur.length; c++) if (inCtx(c)) { v += e.cur[c]; vp += e.pri[c]; }
      tot += v; totP += vp;
      if (v > 0 || vp > 0) rows.push({ p, v, vp });
    });
    rows.sort((a, b) => b.v - a.v);
    const fset = geoFocusSet(focus);
    const isFocus = (p) => fset.has(p);
    const top = rows.slice(0, 5);
    const fRank = rows.findIndex((r) => isFocus(r.p));
    if (fRank >= 5 && !geoFocusIsGroup(focus)) top.push(rows[fRank]);
    const chips = [...GEO.regions].map((r) => cache.lookups.regions[r]).concat([...GEO.specs].map((s) => cache.lookups.specialties[s]));
    let h = `<div class="imsrx-geo-card"><div class="imsrx-geo-card-h"><h3>⑤ Competitors in current selection</h3>
      <span class="imsrx-geo-ctx">${chips.length ? escAttr(chips.join(" · ")) : "whole market"}</span></div>
      ${geoGuideCompetitors(rows, tot, fRank)}
      <table class="imsrx-geo-tbl"><thead><tr><th>#</th><th>Brand</th><th>Company</th><th class="num">Rx</th><th class="num">Share %</th><th class="num">Δ Share</th></tr></thead><tbody>`;
    top.forEach((r) => {
      const rank = rows.indexOf(r) + 1;
      const share = tot > 0 ? r.v / tot : null, shareP = totP > 0 ? r.vp / totP : null;
      const d = cube.hasPrior && share != null && shareP != null ? share - shareP : null;
      const comp = companyOfProduct[r.p] >= 0 ? companyNames[companyOfProduct[r.p]] : "—";
      h += `<tr class="${isFocus(r.p) ? "imsrx-geo-focus" : ""}"><td>${rank}</td><td>${escAttr(cache.lookups.products[r.p])}</td><td class="imsrx-geo-muted">${escAttr(comp)}</td>
        <td class="num">${gRx(r.v)}</td><td class="num strong">${gPct(share, 1)}</td><td class="num ${d > 0 ? "pos" : d < 0 ? "neg" : ""}">${gPp(d)}</td></tr>`;
    });
    return h + "</tbody></table></div>";
  }

  function renderGeo() {
    if (!GEO) resetGeo();
    if (!hasMarketDefs()) return '<div class="imsrx-empty">Market definitions are not in the IMS Rx cache yet — run <code>python etl/build_ims_rx_cache.py --dm-only</code>.</div>';
    geoEnsureSelection();
    if (GEO.market == null) return '<div class="imsrx-empty">No IQVIA markets are assigned to your account, so there is nothing to show on this tab.</div>';
    const kind = GEO.kind, mName = geoMarketName(kind, GEO.market);
    const cube = geoCube(kind, GEO.market, GEO.period);
    const fc = geoFocusCells(cube, GEO.focus);
    const mktAll = cube.mktCur.reduce((a, b) => a + b, 0), prodAll = fc.cur.reduce((a, b) => a + b, 0);
    const national = mktAll > 0 ? prodAll / mktAll : 0;
    const promo = geoPromo(kind, GEO.market, GEO.focus);

    // context KPIs (both chip sets)
    const mC = geoSum(cube.mktCur, cube.nS, GEO.regions, GEO.specs), pC = geoSum(fc.cur, cube.nS, GEO.regions, GEO.specs);
    const mCp = geoSum(cube.mktPri, cube.nS, GEO.regions, GEO.specs), pCp = geoSum(fc.pri, cube.nS, GEO.regions, GEO.specs);
    const shC = mC > 0 ? pC / mC : null, shCp = mCp > 0 ? pCp / mCp : null;
    const cells = geoCellStats(cube, fc, national, mktAll);
    const inCtx = (x) => (!GEO.regions.size || GEO.regions.has(x.r)) && (!GEO.specs.size || GEO.specs.has(x.s));
    const oppCells = cells.filter((x) => inCtx(x) && x.gap > 0);
    const totGap = oppCells.reduce((a, x) => a + x.gap, 0);
    const topOpp = oppCells.slice().sort((a, b) => b.gap - a.gap)[0];

    const regionData = geoPanelRows("region", cube, fc, mktAll);
    const specData = geoPanelRows("specialty", cube, fc, mktAll);
    const specOrder = [];
    const specTot = new Float64Array(cube.nS);
    for (let c = 0; c < cube.mktCur.length; c++) specTot[c % cube.nS] += cube.mktCur[c];
    for (let s = 0; s < cube.nS; s++) if (specTot[s] > 0) specOrder.push(s);
    specOrder.sort((a, b) => specTot[b] - specTot[a]);

    // focus options: Zeta total + every brand in the market (by Rx)
    const brandOpts = [];
    cube.brands.forEach((e, p) => {
      if (GEO.corp != null && companyOfProduct[p] !== GEO.corp) return;
      brandOpts.push({ p, v: e.cur.reduce((a, b) => a + b, 0) });
    });
    brandOpts.sort((a, b) => b.v - a.v);
    const zeta = geoZetaSet();
    // corporation options: every attributable company with Rx in this market (by Rx)
    const corpRx = new Map();
    cube.brands.forEach((e, p) => {
      const ci = companyOfProduct[p];
      if (ci < 0) return;
      corpRx.set(ci, (corpRx.get(ci) || 0) + e.cur.reduce((a, b) => a + b, 0));
    });
    if (GEO.corp != null && !corpRx.has(GEO.corp)) corpRx.set(GEO.corp, 0);
    const corpOpts = [...corpRx.entries()].map(([ci, v]) => ({ ci, v })).sort((a, b) => b.v - a.v);
    const corpNm = GEO.corp != null ? companyNames[GEO.corp] : null;
    const mOpts = geoMarketOptions();
    const allowed = geoAllowedMarkets(kind);

    const chips = [...GEO.regions].map((r) => `<span class="imsrx-geo-chip">Region: ${escAttr(cache.lookups.regions[r])}<button type="button" data-geo-unchip="region:${r}" aria-label="Remove">✕</button></span>`)
      .concat([...GEO.specs].map((s) => `<span class="imsrx-geo-chip">Specialty: ${escAttr(cache.lookups.specialties[s])}<button type="button" data-geo-unchip="specialty:${s}" aria-label="Remove">✕</button></span>`));

    return `
      <div class="imsrx-geo">
      <div class="imsrx-geo-bar">
        <label>Period<select id="imsrx-geo-period">${cache.lookups.periods.map((p, i) => `<option value="${i}"${i === GEO.period ? " selected" : ""}>${escAttr(p)}</option>`).join("")}</select></label>
        <label>Market<span class="imsrx-geo-seg sm">${["dm1", "dm2", "atc4"].map((k) => `<button type="button" data-geo-kind="${k}" class="${kind === k ? "on" : ""}">${k.toUpperCase()}</button>`).join("")}</span>
          <select id="imsrx-geo-market"><option value="all"${GEO.market === "all" ? " selected" : ""}>★ All markets${allowed ? " (my " + mOpts.length + ")" : ""}</option>${mOpts.map((o) => `<option value="${o.idx}"${o.idx === GEO.market ? " selected" : ""}>${escAttr(o.name)}</option>`).join("")}</select></label>
        <label>Corporation<select id="imsrx-geo-corp">
          <option value=""${GEO.corp == null ? " selected" : ""}>All corporations</option>
          ${corpOpts.map((c) => `<option value="${c.ci}"${c.ci === GEO.corp ? " selected" : ""}>${geoIsZetaCorp(c.ci) ? "★ " : ""}${escAttr(companyNames[c.ci])}</option>`).join("")}
        </select></label>
        <label>Product focus<select id="imsrx-geo-focus">
          ${corpNm != null
            ? `<option value="corp"${GEO.focus === "corp" ? " selected" : ""}>All ${escAttr(corpNm)} brands</option>`
            : `<option value="zeta"${GEO.focus === "zeta" ? " selected" : ""}>All Zeta brands in market</option>`}
          ${brandOpts.map((b) => `<option value="${b.p}"${b.p === GEO.focus ? " selected" : ""}>${zeta.has(b.p) ? "★ " : ""}${escAttr(cache.lookups.products[b.p])}</option>`).join("")}
        </select></label>
        <button type="button" class="imsrx-geo-guidebtn${GEO.guides ? " on" : ""}" data-geo-guides="1" title="Show or hide the explanation boxes">💡 Guides ${GEO.guides ? "on" : "off"}</button>
        ${allowed ? `<span class="imsrx-geo-scope" title="Markets limited to your assigned markets, same rule as Target Achievement">🔒 ${mOpts.length} assigned market${mOpts.length === 1 ? "" : "s"}</span>` : ""}
      </div>
      <div class="imsrx-geo-chips">${chips.length ? chips.join("") + '<button type="button" class="imsrx-geo-link" data-geo-clear="1">Clear all</button>' : '<span class="imsrx-geo-muted">No region / specialty selected — click a row, a column or a matrix cell to focus.</span>'}</div>

      ${!(mktAll > 0) ? '<div class="imsrx-empty">No IMS Rx prescriptions map to this market in the selected period — its brands are not in the physician panel.</div>' : `
      <div class="imsrx-stats-row imsrx-geo-kpis">
        <div class="imsrx-stat-tile"><div class="imsrx-stat-label">Market Rx</div><div class="imsrx-stat-value">${gRx(mC)}</div></div>
        <div class="imsrx-stat-tile"><div class="imsrx-stat-label">Product Rx</div><div class="imsrx-stat-value">${gRx(pC)}</div></div>
        <div class="imsrx-stat-tile imsrx-stat-highlight"><div class="imsrx-stat-label">Product Share</div><div class="imsrx-stat-value">${gPct(shC, 2)}</div></div>
        <div class="imsrx-stat-tile"><div class="imsrx-stat-label">Share Δ vs prior MAT</div><div class="imsrx-stat-value ${shC - shCp > 0 ? "pos" : shC - shCp < 0 ? "neg" : ""}">${cube.hasPrior && shC != null && shCp != null ? gPp(shC - shCp) : "—"}</div></div>
        <div class="imsrx-stat-tile"><div class="imsrx-stat-label">Total Rx Gap</div><div class="imsrx-stat-value">${gRx(totGap)}</div></div>
        <div class="imsrx-stat-tile"><div class="imsrx-stat-label">Top opportunity</div><div class="imsrx-stat-value imsrx-geo-kpi-sm">${topOpp ? escAttr(cache.lookups.regions[topOpp.r] + " × " + cache.lookups.specialties[topOpp.s]) : "—"}</div></div>
      </div>

      <div class="imsrx-geo-flow"><span>Market Rx</span>→<span>Market Mix %</span>→<span>Product Rx</span>→<span>Product Mix %</span>→<span>Product Share %</span>→<span>Fair-Share Index</span>→<span>Rx Gap</span></div>
      ${geoGuide(
        "Where the prescriptions of the selected market are written — by <b>region</b> and by <b>doctor specialty</b> — and where our product wins or misses its fair share.",
        "Read the page top to bottom, following the chain above: first <b>where the market volume is</b>, then <b>where our prescriptions are</b>, then <b>how strong we are</b> (share), then <b>where the extra prescriptions are</b> (Rx Gap). Click any region, specialty or matrix cell and every section re-calculates for it; remove a filter with ✕ on its chip.",
        pC > 0
          ? `In this selection we write about <b>${shC != null ? (shC * 100).toFixed(1) : "—"} of every 100 prescriptions</b> (${gRx(pC)} of ${gRx(mC)})${cube.hasPrior && shC != null && shCp != null ? `, ${shC >= shCp ? "up" : "down"} <b>${Math.abs((shC - shCp) * 100).toFixed(1)} points</b> vs last year` : ""}. Lifting every below-average region × specialty cell to our whole-market share (${gPct(national, 2)}) would add about <b>${gRx(totGap)} Rx</b>.`
          : "Our product has no prescriptions in this selection.")}

      ${geoPanelHtml("region", regionData, promo)}
      ${geoPanelHtml("specialty", specData, promo)}
      ${geoMatrixHtml(cube, cells, specOrder, promo)}
      ${geoOpportunityHtml(cube, cells, promo)}
      ${geoCompetitorsHtml(cube, GEO.focus)}

      <div class="imsrx-geo-notes">
        <strong>Promo Grid:</strong> ${promo.known ? escAttr(promo.source) + (promo.unmeasurable.length ? ` · promoted but not measurable in IMS Rx: ${escAttr(promo.unmeasurable.join(", "))}` : "") : escAttr(promo.reason)}<br>
        <strong>Market:</strong> ${GEO.market === "all" ? `All ${allowed ? "your " + mOpts.length + " assigned" : ""} ${kind.toUpperCase()} markets combined — each prescription counted once, even when its brand belongs to several markets.` : kind === "atc4" ? "ATC4 class = every brand IMS Rx classifies in this ATC4 (broader than the IQVIA defined markets inside it)." : `IQVIA ${kind.toUpperCase()} definition joined on Product + ATC4; IMS Rx is brand-level, so a brand in several markets counts fully in each — don't add market totals together.`}<br>
        <strong>Rules:</strong> Index &lt;90 Under · 90–110 In-line · &gt;110 Over. Region/Specialty rows benchmark against the share in the current context; matrix &amp; opportunity cells against the whole-market share (${gPct(national, 2)}). Cells under 0.5% of market Rx show "—". Rx = physician-panel prescription count, not sales.
      </div>`}
      </div>`;
  }

  function geoRerender() {
    const box = document.getElementById("imsrx-tab-content");
    if (!box) return;
    box.innerHTML = renderGeo();
    wireGeo(box);
  }

  function geoToggle(set, idx, multi) {
    if (multi) { if (set.has(idx)) set.delete(idx); else set.add(idx); return; }
    if (set.size === 1 && set.has(idx)) set.clear();
    else { set.clear(); set.add(idx); }
  }

  function wireGeo(root) {
    const q = (s) => root.querySelector(s);
    const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };
    on(q("#imsrx-geo-period"), "change", (e) => { GEO.period = +e.target.value; geoRerender(); });
    on(q("#imsrx-geo-market"), "change", (e) => { const v = e.target.value; GEO.market = v === "all" ? "all" : +v; GEO.focus = null; GEO.regions.clear(); GEO.specs.clear(); geoRerender(); });
    on(q("#imsrx-geo-corp"), "change", (e) => { const v = e.target.value; GEO.corp = v === "" ? null : +v; GEO.focus = null; geoRerender(); });
    on(q("#imsrx-geo-focus"), "change", (e) => { const v = e.target.value; GEO.focus = (v === "zeta" || v === "corp") ? v : +v; geoRerender(); });
    on(q("#imsrx-geo-allspecs"), "click", () => { GEO.allSpecs = !GEO.allSpecs; geoRerender(); });
    root.querySelectorAll("[data-geo-kind]").forEach((b) => on(b, "click", () => {
      if (GEO.kind === b.dataset.geoKind) return;
      GEO.kind = b.dataset.geoKind; GEO.market = GEO.market === "all" ? "all" : null; GEO.focus = null; GEO.regions.clear(); GEO.specs.clear(); geoRerender();
    }));
    root.querySelectorAll("[data-geo-matrix]").forEach((b) => on(b, "click", () => { GEO.matrix = b.dataset.geoMatrix; geoRerender(); }));
    root.querySelectorAll("tr[data-geo-dim]").forEach((tr) => {
      const act = (e) => {
        const set = tr.dataset.geoDim === "region" ? GEO.regions : GEO.specs;
        geoToggle(set, +tr.dataset.geoIdx, e.ctrlKey || e.metaKey);
        geoRerender();
      };
      on(tr, "click", act);
      on(tr, "keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(e); } });
    });
    root.querySelectorAll("[data-geo-cell]").forEach((el) => on(el, "click", (e) => {
      const [r, s] = el.dataset.geoCell.split(",").map(Number);
      if (e.ctrlKey || e.metaKey) { GEO.regions.add(r); GEO.specs.add(s); }
      else if (GEO.regions.size === 1 && GEO.specs.size === 1 && GEO.regions.has(r) && GEO.specs.has(s)) { GEO.regions.clear(); GEO.specs.clear(); }
      else { GEO.regions = new Set([r]); GEO.specs = new Set([s]); }
      geoRerender();
    }));
    root.querySelectorAll("[data-geo-unchip]").forEach((b) => on(b, "click", () => {
      const [d, i] = b.dataset.geoUnchip.split(":");
      (d === "region" ? GEO.regions : GEO.specs).delete(+i);
      geoRerender();
    }));
    on(q("[data-geo-clear]"), "click", () => { GEO.regions.clear(); GEO.specs.clear(); geoRerender(); });
    on(q("[data-geo-guides]"), "click", () => { GEO.guides = !GEO.guides; geoGuidesSave(GEO.guides); geoRerender(); });
  }

  // -------------------------------------------------------------------
  // Lifecycle & Access Gating
  // -------------------------------------------------------------------

  function canView() {
    return window.AUTH && typeof window.AUTH.canViewImsRx === "function"
      ? window.AUTH.canViewImsRx()
      : false;
  }

  function renderAccessRestricted() {
    const root = document.getElementById("app-root");
    if (!root) return;
    root.innerHTML = (window.DS && typeof window.DS.emptyState === "function")
      ? `<div class="imsrx-page"><div style="max-width:520px;margin:80px auto;text-align:center;">${window.DS.emptyState({
          icon: "\u{1F512}",
          title: "Access restricted",
          hint: "IMS Rx contains physician-panel market intelligence and is available to CEO, VP, BEx, Admin and SFE Manager roles only.",
        })}</div></div>`
      : '<div style="padding:40px;text-align:center;color:#64748B;">Access restricted. Available to CEO, VP, BEx, Admin and SFE Manager only.</div>';
  }

  function destroy() {
    destroyAllCharts();
    document.body.classList.remove("imsrx-mode");
  }

  async function init(containerId) {
    document.body.classList.add("imsrx-mode");
    if (!canView()) {
      renderAccessRestricted();
      return;
    }
    decompressCache();
    if (isCacheStale()) {
      renderCacheMissing();
      return;
    }
    renderLayout();
  }

  // -------------------------------------------------------------------
  // Ask-the-Data accessor (READ-ONLY, additive). Runs the page's OWN
  // mdRankedRows / mdFilteredTotal / cfCompanyLeaderboard / cfFilteredTotal
  // under a temporary filter state and restores the page's state afterwards,
  // so nothing the user sees on the page can change. `map` is
  // { filterKey: [lookupIdx, ...] } using the page's own filter keys
  // (period, product, company, molecule, atc3, atc4, specialty, region, cat).
  // -------------------------------------------------------------------
  function askApi() {
    if (!canView()) return { ok: false, reason: "access" };
    decompressCache();
    if (!cache || isCacheStale()) return { ok: false, reason: "nocache" };
    const KEYS = ["period", "product", "company", "dm1", "dm2", "molecule", "atc3", "atc4", "specialty", "region", "cat"];
    function build(map) {
      const o = {};
      KEYS.forEach((k) => { o[k] = (map && map[k] && map[k].length) ? new Set(map[k]) : null; });
      return o;
    }
    function withMd(map, fn) { const s = MDx; MDx = build(map); try { return fn(); } finally { MDx = s; } }
    function withCf(map, fn) { const s = CFx; CFx = build(map); try { return fn(); } finally { CFx = s; } }
    return {
      ok: true,
      meta: cache.meta,
      periods: cache.lookups.periods.slice(),
      lookup: (k) => (k === "company" ? companyNames : cache.lookups[k]),
      ranked: (fieldKey, lookupKey, map) => withMd(map, () => mdRankedRows(fieldKey, lookupKey)),
      total: (map) => withMd(map, () => mdFilteredTotal()),
      leaderboard: (map) => withCf(map, () => cfCompanyLeaderboard()),
      cfTotal: (map) => withCf(map, () => cfFilteredTotal()),
      kpis: () => computeKPIs(),
    };
  }

  window.ImsRxDashboard = {
    init,
    destroy,
    canView,
    askApi,
  };
})();
