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
      product: null, company: null, molecule: null, atc3: null, atc4: null,
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
    { key: "molecule", label: "Molecule", lookup: "molecules", field: "molecule" },
    { key: "atc3", label: "ATC3", lookup: "atc3s", field: "atc3" },
    { key: "atc4", label: "ATC4", lookup: "atc4s", field: "atc4" },
    { key: "specialty", label: "Prescriber Specialty", lookup: "specialties", field: "specialty" },
    { key: "region", label: "Region", lookup: "regions", field: "region" },
    { key: "cat", label: "Dosage Form", lookup: "dosageFormCategories", field: "dosageFormCategory" },
  ];

  function mdFieldValue(base, fieldKey) {
    const f = cache.fact;
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
      if (!sel.has(mdFieldValue(base, spec.field))) return false;
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
    MD_FILTER_SPECS.forEach((spec) => {
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
    let h = `<table class="imsrx-rank-table"><thead><tr><th class="imsrx-th-rank">#</th><th>${label}</th><th class="imsrx-num">Rx</th></tr></thead><tbody>`;
    shown.forEach((r, i) => {
      const bar = maxV > 0 ? (r.value / maxV) * 100 : 0;
      h += `<tr><td class="imsrx-th-rank">${i + 1}</td>
        <td class="imsrx-cell-name"><span class="imsrx-bar" style="width:${bar.toFixed(1)}%"></span>
          <span class="imsrx-name-txt" title="${escAttr(r.name)}">${escAttr(r.name)}</span></td>
        <td class="imsrx-num imsrx-strong">${fmtBig(r.value)}</td></tr>`;
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
      ? `<div class="imsrx-spotlight-ratio">≈ ${(units2025 / rx2025).toFixed(1)} sell-out units per physician-panel prescription &mdash; a rough scale check only (different measurement methodologies, not a conversion factor).</div>`
      : "";

    return `
      <div class="imsrx-spotlight">
        <div class="imsrx-spotlight-head">
          <h3>Product Spotlight — ${escAttr(name)}</h3>
          ${corpBadge}
        </div>
        <div class="imsrx-spotlight-row">
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">IMS Rx <span>MAT Dec 2025 · physician panel</span></div>
            <div class="imsrx-spotlight-stat-value">${fmtBig(rx2025)}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">Market Intel Units <span>Calendar 2025 · sell-out</span></div>
            <div class="imsrx-spotlight-stat-value">${units2025 > 0 ? fmtBig(units2025) : "—"}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">Market Intel Value <span>Calendar 2025 · LC</span></div>
            <div class="imsrx-spotlight-stat-value">${value2025 > 0 ? fmtBig(value2025) : "—"}</div>
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

    function toRows(map, names) {
      const rows = [];
      map.forEach((v, idx) => { if (names[idx] !== undefined) rows.push({ idx, name: String(names[idx]), value: v }); });
      rows.sort((a, b) => b.value - a.value);
      return rows;
    }

    return {
      total, growth,
      trend: [byPeriod.get(0) || 0, byPeriod.get(1) || 0, byPeriod.get(2) || 0],
      productCount: products.size,
      productRows: toRows(byProduct, cache.lookups.products),
      moleculeRows: toRows(byMolecule, cache.lookups.molecules),
      atc4Rows: toRows(byAtc4, cache.lookups.atc4s),
      specialtyRows: toRows(bySpecialty, cache.lookups.specialties),
      regionRows: toRows(byRegion, cache.lookups.regions),
      catRows: toRows(byCat, cache.lookups.dosageFormCategories),
    };
  }

  function mdSpotlightShell(title, badge, stats, sectionsHtml) {
    const gCls = stats.growth == null ? "" : (stats.growth >= 0 ? "imsrx-positive" : "imsrx-negative");
    return `
      <div class="imsrx-spotlight">
        <div class="imsrx-spotlight-head">
          <h3>${title}</h3>
          ${badge}
        </div>
        <div class="imsrx-spotlight-row">
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">Rx in Scope</div>
            <div class="imsrx-spotlight-stat-value">${fmtBig(stats.total)}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">YoY Growth <span>MAT 2024 → 2025, ignores Period filter</span></div>
            <div class="imsrx-spotlight-stat-value ${gCls}">${fmtPct(stats.growth, 1)}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">3-Yr Trend <span>MAT Dec 2023 · 2024 · 2025</span></div>
            <div class="imsrx-spotlight-stat-value" style="font-size:16px;">${fmtBig(stats.trend[0])} → ${fmtBig(stats.trend[1])} → ${fmtBig(stats.trend[2])}</div>
          </div>
        </div>
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
      company: null, product: null, molecule: null, atc3: null, atc4: null,
      specialty: null, region: null, cat: null,
    };
  }

  const CF_FILTER_SPECS = [
    { key: "period", label: "Period", lookup: "periods", field: "period", sort: "index" },
    { key: "company", label: "Company", lookup: "companies", field: "company" },
    { key: "product", label: "Product", lookup: "products", field: "product" },
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
      if (!sel.has(cfFieldValue(base, spec.field))) return false;
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
  function cfCompanyLeaderboard() {
    const f = cache.fact;
    const stride = f.stride;
    const pField = f.fields.indexOf("product");
    const perField = f.fields.indexOf("period");

    const acc = new Map();
    for (let i = 0; i < f.rx.length; i++) {
      const base = i * stride;
      if (!cfRowMatches(base, null)) continue;
      const cIdx = companyOfProduct[f.rows[base + pField]];
      if (cIdx < 0) continue;
      acc.set(cIdx, (acc.get(cIdx) || 0) + f.rx[i]);
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

    const rows = [];
    acc.forEach((val, idx) => {
      const cur = growthCur.get(idx) || 0;
      const prev = growthPrev.get(idx) || 0;
      const growth = prev > 0 ? (cur - prev) / prev * 100 : null;
      rows.push({
        idx, name: companyNames[idx], value: val,
        share: attributableTotal > 0 ? (val / attributableTotal) * 100 : 0,
        growth,
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
      <th class="imsrx-num">Rx</th><th class="imsrx-num">Share</th>
      <th class="imsrx-num">YoY <span class="imsrx-chart-caption">2024→2025</span></th>
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
        <td class="imsrx-num ${gCls}">${fmtPct(r.growth, 1)}</td>
      </tr>`;
    });
    h += "</tbody></table>";
    return h;
  }

  // ---- rendering ---------------------------------------------------------

  function cfRenderFilterBar() {
    let h = '<div class="imsrx-filterbar">';
    CF_FILTER_SPECS.forEach((spec) => {
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

    function toRows(map, names) {
      const rows = [];
      map.forEach((v, idx) => { if (names[idx] !== undefined) rows.push({ idx, name: String(names[idx]), value: v }); });
      rows.sort((a, b) => b.value - a.value);
      return rows;
    }

    const productRows = toRows(byProduct, cache.lookups.products);
    const molRows = toRows(byMolecule, cache.lookups.molecules);
    const atc4Rows = toRows(byAtc4, cache.lookups.atc4s);
    const regionRows = toRows(byRegion, cache.lookups.regions);
    const catRows = toRows(byCat, cache.lookups.dosageFormCategories);

    return `
      <div class="imsrx-spotlight">
        <div class="imsrx-spotlight-head">
          <h3>Company Spotlight — ${escAttr(name)}</h3>
          <span class="imsrx-badge imsrx-badge-ok">${products.size.toLocaleString()} product${products.size === 1 ? "" : "s"} in scope</span>
        </div>
        <div class="imsrx-spotlight-row">
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">Rx in Scope</div>
            <div class="imsrx-spotlight-stat-value">${fmtBig(total)}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">YoY Growth <span>MAT 2024 → 2025, ignores Period filter</span></div>
            <div class="imsrx-spotlight-stat-value ${gCls}">${fmtPct(growth, 1)}</div>
          </div>
          <div class="imsrx-spotlight-stat">
            <div class="imsrx-spotlight-stat-label">3-Yr Trend <span>MAT Dec 2023 · 2024 · 2025</span></div>
            <div class="imsrx-spotlight-stat-value" style="font-size:16px;">${fmtBig(byPeriod.get(0) || 0)} → ${fmtBig(byPeriod.get(1) || 0)} → ${fmtBig(byPeriod.get(2) || 0)}</div>
          </div>
        </div>
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
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + "K";
    return sign + Math.round(abs).toLocaleString();
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

  window.ImsRxDashboard = {
    init,
    destroy,
    canView,
  };
})();
