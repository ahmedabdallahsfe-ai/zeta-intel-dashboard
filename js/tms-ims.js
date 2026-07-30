/**
 * ZETA ENTERPRISE PLATFORM — js/tms-ims.js
 * =====================================================================
 * "To-Market vs In-Market" workspace (Sell-In vs Sell-Out Control Tower).
 *
 * TMS = Trade/sell-in shipments into the channel (what Zeta ships out).
 * IMS = IQVIA-reported sell-out (what the channel actually sells through
 * to patients). Comparing the two, brand by brand and month by month,
 * surfaces two distinct commercial risks that neither number shows
 * alone: (a) demand outrunning supply (stockout risk -- IMS > TMS) and
 * (b) shipments building up unsold stock in the channel (inventory
 * bottleneck -- sell-out rate well below 100%).
 *
 * SOURCE: this reimplements the analysis originally prototyped as a
 * standalone React page in "TO MARKET_IN MARKET/tms-ims-dashboard.jsx"
 * (its own index.html + refresh_dashboard.py, pushing to two separate
 * GitHub repos outside this platform). That prototype is preserved as
 * reference for the exact formulas/thresholds below; this file is a
 * from-scratch vanilla-JS port so the analysis lives inside this
 * platform's normal cache/auth/refresh pipeline instead of a second,
 * disconnected deployment. See etl/build_tms_ims_cache.py for the data
 * extraction step (window.TMS_IMS_CACHE).
 *
 * ACCESS: brand/SKU-level trade shipment data crosses every Business
 * Unit and Line at once -- there is no meaningful way to scope it to a
 * single BU Manager's territory the way Coverage/Sales/SFE are scoped.
 * So this workspace is visible ONLY to unrestricted users (Allowed BU =
 * ALL and Allowed Lines = ALL in Zeta_Dashboard_User_Config.xlsx, i.e.
 * AUTH.getScope().unrestricted === true). Sidebar visibility is gated in
 * js/app.js; this module also defends itself in init() in case it's ever
 * reached another way.
 *
 * Depends on: js/auth.js, js/components.js (window.DS), Chart.js, pako.js,
 * cache/tms_ims.data.js (window.TMS_IMS_CACHE) already loaded.
 * =====================================================================
 */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------------
  // Cache decompression (identical pattern to sales.js's
  // decompressCustomerAnalyticsCache() for window.CUSTOMER_ANALYTICS_CACHE)
  // ---------------------------------------------------------------------
  let _raw = null; // decoded { meta, months, bus, lines, brands, stypes, products, rows }
  let DATA = [];   // decoded row objects
  let LAST_IMS_MONTH = -1;
  let GAP_MONTHS = [];
  let LAST_DATA_MONTH = -1;

  function decompressCache() {
    if (_raw !== null) return;
    if (typeof global.TMS_IMS_CACHE === "undefined") {
      _raw = false; // sentinel: checked, unavailable
      return;
    }
    try {
      const b64 = global.TMS_IMS_CACHE.b64Data;
      const strData = atob(b64);
      const charData = strData.split("").map(x => x.charCodeAt(0));
      const bytes = new Uint8Array(charData);
      const decompressed = global.pako.ungzip(bytes, { to: "string" });
      _raw = JSON.parse(decompressed);
      decodeData();
    } catch (e) {
      console.error("[TMS/IMS] Failed to decompress cache", e);
      _raw = false;
    }
  }

  function decodeData() {
    const MONTHS = _raw.months, BUS = _raw.bus, LINES = _raw.lines,
          BRANDS = _raw.brands, STYPES = _raw.stypes, PRODUCTS = _raw.products;
    DATA = (_raw.rows || []).map(r => {
      const productKey = PRODUCTS[r[4]] || "";
      const cut = productKey.indexOf("|");
      return {
        month: r[0],
        monthLabel: MONTHS[r[0]] || "?",
        bu: BUS[r[1]] || "Unknown",
        line: LINES[r[2]] || "Unknown",
        brand: BRANDS[r[3]] || "Unknown",
        productKey: productKey,
        code: cut >= 0 ? productKey.slice(0, cut) : productKey,
        product: cut >= 0 ? productKey.slice(cut + 1) : productKey,
        salesType: STYPES[r[5]] || "",
        type: r[6], // 0 = TMS, 1 = IMS
        qty: r[7],
        value: r[8],
      };
    });
    LAST_IMS_MONTH = Math.max(-1, ...DATA.filter(d => d.type === 1 && d.qty > 0).map(d => d.month));
    LAST_DATA_MONTH = Math.max(-1, ...DATA.map(d => d.month));
    GAP_MONTHS = MONTHS.filter((_, i) => i > LAST_IMS_MONTH);
  }

  // ---------------------------------------------------------------------
  // Formatting / classification helpers (formulas match the source jsx
  // prototype's mocStatus/mocCellColor/sell-out/portfolio-MoC bandings)
  // ---------------------------------------------------------------------
  function fmtCompact(n) {
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }
  function fmtFull(n) { return Math.round(n).toLocaleString("en-US"); }
  function sel(arr, v) { return arr.length === 0 || arr.indexOf(v) >= 0; }

  function mocStatus(inv, moc) {
    if (inv < 0) return { label: "Pre-period stock", bg: "#ede9fe", fg: "#6d28d9" };
    if (moc === null) return { label: "No offtake", bg: "#f1f5f9", fg: "#64748b" };
    if (moc < 1) return { label: "Stockout risk", bg: "#fee2e2", fg: "#b91c1c" };
    if (moc <= 3) return { label: "Healthy", bg: "#d1fae5", fg: "#065f46" };
    if (moc <= 6) return { label: "High stock", bg: "#fef3c7", fg: "#92400e" };
    return { label: "Overstock", bg: "#ffedd5", fg: "#9a3412" };
  }
  function mocCellColor(moc) {
    if (moc === null) return { bg: "#f1f5f9", fg: "#94a3b8" };
    if (moc < 0) return { bg: "#f5f3ff", fg: "#6d28d9" };
    if (moc < 1) return { bg: "#fee2e2", fg: "#991b1b" };
    if (moc <= 3) return { bg: "#d1fae5", fg: "#065f46" };
    if (moc <= 6) return { bg: "#fef3c7", fg: "#92400e" };
    return { bg: "#fed7aa", fg: "#7c2d12" };
  }

  const MONTH_NAME_TO_NUM = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  function projectDate(fromMonthIdx, addMonths) {
    const months = _raw.months;
    const label = months[fromMonthIdx] || months[months.length - 1];
    const parts = String(label).split(" ");
    const mn = MONTH_NAME_TO_NUM[parts[0]] !== undefined ? MONTH_NAME_TO_NUM[parts[0]] : 0;
    const yr = parseInt(parts[1], 10) || new Date().getFullYear();
    const total = yr * 12 + mn + Math.ceil(addMonths);
    const y2 = Math.floor(total / 12);
    const m2 = ((total % 12) + 12) % 12;
    const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return MN[m2] + " " + y2;
  }

  // ---------------------------------------------------------------------
  // Module state
  // ---------------------------------------------------------------------
  let _container = null;
  let _filters = { months: [], bus: [], lines: [], brands: [], products: [], stypes: [] };
  let _subTab = "overview"; // "overview" | "inventory"
  let _invLevel = "brand";  // "brand" | "sku"
  let _metric = "value";    // "value" | "qty"
  let _charts = [];

  function destroyCharts() {
    _charts.forEach(c => { try { c.destroy(); } catch (e) {} });
    _charts = [];
  }

  function activeFilterCount() {
    return ["months", "bus", "lines", "brands", "products", "stypes"]
      .reduce((n, k) => n + (_filters[k].length > 0 ? 1 : 0), 0);
  }

  // dimOk: BU/Line/Brand/Product/SalesType only -- NEVER Month. Matches
  // the source prototype's dimOk(): the Inventory tab is a cumulative
  // view by design (Month filter would break the cumulative-since-Jan-1
  // math), and the trend chart intentionally shows every month too.
  function dimOk(d) {
    return sel(_filters.bus, d.bu) && sel(_filters.lines, d.line) &&
           sel(_filters.brands, d.brand) && sel(_filters.products, d.productKey) &&
           sel(_filters.stypes, d.salesType);
  }
  function monthOk(d) { return sel(_filters.months, d.monthLabel); }
  function metricOf(d) { return _metric === "qty" ? d.qty : d.value; }

  // =====================================================================
  // Computations (ported 1:1 from the source jsx's formulas)
  // =====================================================================
  function computeOverviewTotals() {
    let tms = 0, ims = 0;
    DATA.forEach(d => {
      if (!dimOk(d) || !monthOk(d)) return;
      if (d.type === 0) tms += metricOf(d); else ims += metricOf(d);
    });
    const variance = tms - ims;
    const sellOut = tms > 0 ? (ims / tms) * 100 : null;
    return { tms, ims, variance, sellOut };
  }

  function computeBrandChart() {
    const m = new Map();
    DATA.forEach(d => {
      if (!dimOk(d) || !monthOk(d)) return;
      if (!m.has(d.brand)) m.set(d.brand, { brand: d.brand, TMS: 0, IMS: 0 });
      const row = m.get(d.brand);
      if (d.type === 0) row.TMS += metricOf(d); else row.IMS += metricOf(d);
    });
    return Array.from(m.values()).sort((a, b) => (b.TMS + b.IMS) - (a.TMS + a.IMS)).slice(0, 12);
  }

  function computeTrendChart() {
    const months = _raw.months;
    const tms = new Array(months.length).fill(0);
    const ims = new Array(months.length).fill(0);
    DATA.forEach(d => {
      if (!dimOk(d)) return; // month filter intentionally NOT applied here
      if (d.type === 0) tms[d.month] += metricOf(d); else ims[d.month] += metricOf(d);
    });
    return { months, tms, ims };
  }

  function computeInsights() {
    // Risks/opportunities: BU/Line/SalesType filters apply, Brand/Product
    // filters do NOT (matches source), months beyond LAST_IMS_MONTH excluded.
    const m = new Map();
    DATA.forEach(d => {
      if (d.month > LAST_IMS_MONTH) return;
      if (!sel(_filters.bus, d.bu) || !sel(_filters.lines, d.line) || !sel(_filters.stypes, d.salesType)) return;
      if (!m.has(d.brand)) m.set(d.brand, { TMS: 0, IMS: 0 });
      const row = m.get(d.brand);
      if (d.type === 0) row.TMS += metricOf(d); else row.IMS += metricOf(d);
    });
    const risks = [], bottlenecks = [];
    m.forEach((v, brand) => {
      if (v.TMS === 0 && v.IMS === 0) return;
      if (v.IMS > v.TMS) {
        risks.push({ brand, gap: v.IMS - v.TMS, rate: v.TMS > 0 ? (v.IMS / v.TMS) * 100 : null });
      } else if (v.TMS > 0 && (v.IMS / v.TMS) * 100 < 50) {
        bottlenecks.push({ brand, gap: v.TMS - v.IMS, rate: (v.IMS / v.TMS) * 100 });
      }
    });
    risks.sort((a, b) => b.gap - a.gap);
    bottlenecks.sort((a, b) => b.gap - a.gap);
    return { risks, bottlenecks };
  }

  function computeInventory(level) {
    const groupKeyOf = level === "sku" ? (d => d.productKey) : (d => d.brand);
    const labelOf = level === "sku" ? (d => d.product) : (d => d.brand);
    const N = _raw.months.length;
    const m = new Map();
    DATA.forEach(d => {
      if (!dimOk(d)) return; // cumulative view -- Month filter not applied
      const key = groupKeyOf(d);
      if (!m.has(key)) m.set(key, { key, label: labelOf(d), brand: d.brand, tms: new Array(N).fill(0), ims: new Array(N).fill(0) });
      const row = m.get(key);
      if (d.type === 0) row.tms[d.month] += metricOf(d); else row.ims[d.month] += metricOf(d);
    });

    let totInv = 0, totRun = 0, nRisk = 0, nOver = 0;
    const rows = Array.from(m.values()).map(row => {
      const cumT = row.tms.reduce((s, x) => s + x, 0);
      const cumI = row.ims.slice(0, LAST_IMS_MONTH + 1).reduce((s, x) => s + x, 0);
      const inv = cumT - cumI;
      const winStart = Math.max(0, LAST_IMS_MONTH - 2);
      const window = row.ims.slice(winStart, LAST_IMS_MONTH + 1);
      const run = window.length > 0 ? window.reduce((s, x) => s + x, 0) / window.length : 0;
      const runP = LAST_IMS_MONTH >= 0 ? cumI / (LAST_IMS_MONTH + 1) : 0;
      const moc = run > 0 ? inv / run : null;
      totInv += inv; totRun += run;
      if (moc !== null && moc < 1) nRisk++;
      if (moc !== null && moc > 3) nOver++;
      const status = mocStatus(inv, moc);
      let projected;
      if (moc === null) projected = "—";
      else if (moc < 0) projected = "Already depleted";
      else if (moc > 12) projected = "> 12 months";
      else projected = "~" + projectDate(LAST_DATA_MONTH, moc);
      return { key: row.key, label: row.label, brand: row.brand, cumT, cumI, inv, run, runP, moc, status, projected };
    });

    rows.sort((a, b) => {
      if (a.moc === null && b.moc === null) return b.inv - a.inv;
      if (a.moc === null) return 1;
      if (b.moc === null) return -1;
      return a.moc - b.moc;
    });

    const portMoc = totRun > 0 ? totInv / totRun : null;
    return { rows, totInv, portMoc, nRisk, nOver };
  }

  function computeHeatmap() {
    const N = _raw.months.length;
    const m = new Map();
    DATA.forEach(d => {
      if (!dimOk(d)) return;
      if (!m.has(d.brand)) m.set(d.brand, { brand: d.brand, tms: new Array(N).fill(0), ims: new Array(N).fill(0), size: 0 });
      const row = m.get(d.brand);
      if (d.type === 0) row.tms[d.month] += metricOf(d); else row.ims[d.month] += metricOf(d);
    });
    const rows = Array.from(m.values()).map(row => {
      row.size = row.tms.reduce((s, x) => s + x, 0) + row.ims.reduce((s, x) => s + x, 0);
      let cumT = 0, cumI = 0;
      row.cells = [];
      for (let mo = 0; mo < N; mo++) {
        cumT += row.tms[mo];
        if (mo <= LAST_IMS_MONTH) cumI += row.ims[mo];
        if (mo > LAST_IMS_MONTH) { row.cells.push(null); continue; }
        const winStart = Math.max(0, mo - 2);
        const window = row.ims.slice(winStart, mo + 1);
        const run = window.length > 0 ? window.reduce((s, x) => s + x, 0) / window.length : 0;
        row.cells.push(run > 0 ? (cumT - cumI) / run : null);
      }
      return row;
    });
    rows.sort((a, b) => b.size - a.size);
    return rows.slice(0, 20);
  }

  // =====================================================================
  // Narrative builders (auto-generated bullet text)
  // =====================================================================
  function buildOverviewNarrative(totals, brandChart) {
    const items = [];
    const scopeParts = [];
    if (_filters.bus.length) scopeParts.push(_filters.bus.join(", "));
    if (_filters.lines.length) scopeParts.push(_filters.lines.join(", "));
    items.push(scopeParts.length
      ? "Scope: " + scopeParts.join(" · ") + "."
      : "Scope: all Business Units and Lines.");

    if (totals.sellOut === null) {
      items.push("No sell-in (TMS) recorded for the current selection.");
    } else if (totals.sellOut > 100) {
      items.push("Sell-out rate is " + totals.sellOut.toFixed(0) + "% — demand is exceeding shipments; channel is drawing down stock faster than it's being replenished.");
    } else if (totals.sellOut >= 80) {
      items.push("Sell-out rate is " + totals.sellOut.toFixed(0) + "% — healthy channel throughput.");
    } else {
      items.push("Sell-out rate is " + totals.sellOut.toFixed(0) + "% — slow channel offtake relative to shipments.");
    }

    if (brandChart.length) {
      const top = brandChart[0];
      const totalAll = brandChart.reduce((s, b) => s + b.TMS + b.IMS, 0);
      const sharePct = totalAll > 0 ? ((top.TMS + top.IMS) / totalAll * 100).toFixed(0) : "0";
      items.push(top.brand + " is the largest brand in view (" + sharePct + "% of shown TMS+IMS volume).");
    }

    const ins = computeInsights();
    if (ins.risks.length || ins.bottlenecks.length) {
      const parts = [];
      if (ins.risks.length) parts.push(ins.risks.length + " brand(s) at stockout risk (top: " + ins.risks[0].brand + ")");
      if (ins.bottlenecks.length) parts.push(ins.bottlenecks.length + " brand(s) with inventory bottlenecks (top: " + ins.bottlenecks[0].brand + ")");
      items.push("Exceptions: " + parts.join("; ") + ".");
    } else {
      items.push("No exception alerts for the current selection.");
    }
    return items;
  }

  function buildInventoryNarrative(inv) {
    const items = [];
    if (inv.totInv < 0) {
      items.push("Implied channel inventory is negative (" + fmtCompact(inv.totInv) + ") — sell-out is running ahead of tracked shipments; treat as a data-timing gap, not literal negative stock.");
    } else {
      items.push("Implied channel inventory: " + fmtCompact(inv.totInv) + (inv.portMoc !== null ? ", Portfolio Months of Coverage: " + inv.portMoc.toFixed(1) + "." : "."));
    }
    const riskRows = inv.rows.filter(r => r.moc !== null && r.moc >= 0 && r.moc < 1);
    if (riskRows.length) {
      const worst = riskRows.reduce((a, b) => (a.moc < b.moc ? a : b));
      items.push(riskRows.length + " item(s) at stockout risk — most urgent: " + worst.label + " (" + worst.projected + ").");
    }
    const overRows = inv.rows.filter(r => r.moc !== null && r.moc > 3);
    if (overRows.length) {
      const heaviest = overRows.reduce((a, b) => (b.moc > a.moc ? b : a));
      items.push(overRows.length + " item(s) overstocked — heaviest: " + heaviest.label + " (" + heaviest.moc.toFixed(1) + " months of cover).");
    }
    const negRows = inv.rows.filter(r => r.inv < 0);
    if (negRows.length) items.push(negRows.length + " item(s) show negative implied inventory (pre-period stock or reporting gap).");
    return items;
  }

  // =====================================================================
  // Rendering
  // =====================================================================
  function optionList(values) { return values.map(v => ({ value: v, label: v })); }

  function renderFilterBar() {
    const wrap = document.createElement("div");
    wrap.className = "ds-flex ds-mb-4";
    wrap.style.cssText = "gap:12px;flex-wrap:wrap;align-items:flex-end;";

    const specs = [
      { key: "months", label: "Month", values: _raw.months },
      { key: "bus", label: "Business Unit", values: _raw.bus },
      { key: "lines", label: "Line", values: _raw.lines },
      { key: "brands", label: "Brand", values: _raw.brands },
      { key: "products", label: "SKU", values: _raw.products.map(p => p) },
      { key: "stypes", label: "Sales Type", values: _raw.stypes },
    ];
    specs.forEach(s => {
      const node = global.DS.filterDropdown({
        label: s.label,
        options: optionList(s.values),
        selected: _filters[s.key],
        onChange: (next) => { _filters[s.key] = next; renderBody(); },
      });
      wrap.appendChild(node);
    });

    const metricToggle = document.createElement("div");
    metricToggle.className = "ds-flex";
    metricToggle.style.cssText = "gap:6px;margin-left:auto;";
    metricToggle.innerHTML =
      global.DS.button({ label: "Value (EGP)", variant: _metric === "value" ? "primary" : "secondary", size: "sm", attrs: 'data-metric="value"' }) +
      global.DS.button({ label: "QTY (units)", variant: _metric === "qty" ? "primary" : "secondary", size: "sm", attrs: 'data-metric="qty"' });
    wrap.appendChild(metricToggle);

    const resetBtn = document.createElement("div");
    resetBtn.innerHTML = global.DS.button({ label: "Reset (" + activeFilterCount() + ")", variant: "ghost", size: "sm", attrs: 'data-action="reset-filters"' });
    wrap.appendChild(resetBtn);

    return wrap;
  }

  function renderTabsNav() {
    const wrap = document.createElement("div");
    wrap.className = "ds-mb-4";
    wrap.innerHTML = global.DS.tabs({
      tabs: [{ key: "overview", label: "Overview" }, { key: "inventory", label: "Channel Inventory" }],
      activeKey: _subTab,
    });
    return wrap;
  }

  function renderGapBanner() {
    if (_subTab !== "overview" || GAP_MONTHS.length === 0) return null;
    const activeGap = GAP_MONTHS.filter(m => sel(_filters.months, m));
    if (_filters.months.length > 0 && activeGap.length === 0) return null;
    const onlyGap = _filters.months.length > 0 && activeGap.length === _filters.months.length;
    const banner = document.createElement("div");
    banner.className = "ds-mb-4";
    banner.style.cssText = "background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:var(--radius-lg,10px);padding:10px 14px;font-size:13px;";
    banner.textContent = onlyGap
      ? "IMS not yet reported for " + GAP_MONTHS.join(", ") + " — every month currently selected is in this reporting gap."
      : "IMS not yet reported for " + GAP_MONTHS.join(", ") + " (TMS/shipment data may still be current).";
    return banner;
  }

  function renderOverviewTab() {
    const section = document.createElement("div");
    section.className = "ds-section";

    const gapBanner = renderGapBanner();
    if (gapBanner) section.appendChild(gapBanner);

    const totals = computeOverviewTotals();
    const kpiWrap = document.createElement("div");
    kpiWrap.className = "ds-grid-kpi ds-mb-4";
    const unit = _metric === "qty" ? " units" : " EGP";
    kpiWrap.innerHTML =
      global.DS.kpiCard({ label: "Total TMS (Sell-In)", value: fmtCompact(totals.tms) + unit }) +
      global.DS.kpiCard({ label: "Total IMS (Sell-Out)", value: fmtCompact(totals.ims) + unit }) +
      global.DS.kpiCard({
        label: "Variance (TMS − IMS)", value: fmtCompact(totals.variance) + unit,
        delta: totals.variance < 0 ? "Stock depletion" : "Stock buildup",
        direction: totals.variance < 0 ? "down" : "up",
      }) +
      global.DS.kpiCard({
        label: "Sell-Out Rate", value: totals.sellOut === null ? "—" : totals.sellOut.toFixed(1) + "%",
        delta: totals.sellOut === null ? "No sell-in" : totals.sellOut > 100 ? "Demand exceeds shipments" : totals.sellOut >= 80 ? "Healthy throughput" : "Slow offtake",
        direction: totals.sellOut === null ? "flat" : totals.sellOut >= 80 && totals.sellOut <= 100 ? "up" : "down",
      });
    section.appendChild(kpiWrap);

    const brandChart = computeBrandChart();
    section.insertAdjacentHTML("beforeend", global.DS.insightCard({
      title: "Executive Narrative", icon: "✨", variant: "neutral",
      items: buildOverviewNarrative(totals, brandChart),
    }));

    const chartsWrap = document.createElement("div");
    chartsWrap.className = "ds-grid-2 ds-mt-4";
    chartsWrap.innerHTML =
      global.DS.chartContainer({ title: "Brand Comparison", subtitle: "To-Market (TMS) vs In-Market (IMS) — top 12 brands", canvasId: "tms-ims-brand-chart" }) +
      global.DS.chartContainer({ title: "Monthly Trend", subtitle: "Seasonality & divergence — all months (month filter not applied here)", canvasId: "tms-ims-trend-chart" });
    section.appendChild(chartsWrap);

    const ins = computeInsights();
    const risksHtml = ins.risks.length
      ? ins.risks.slice(0, 8).map(r => r.brand + " — sell-out " + (r.rate === null ? "n/a" : r.rate.toFixed(0) + "%") + ", gap " + fmtCompact(-r.gap))
      : [];
    const bottlenecksHtml = ins.bottlenecks.length
      ? ins.bottlenecks.slice(0, 8).map(b => b.brand + " — sell-out " + b.rate.toFixed(0) + "%, idle " + fmtCompact(b.gap))
      : [];
    const exceptionsWrap = document.createElement("div");
    exceptionsWrap.className = "ds-grid-2 ds-mt-4";
    exceptionsWrap.innerHTML =
      global.DS.insightCard({ title: "Out-of-Stock Risk (IMS > TMS)", icon: "⚠️", variant: "risk", items: risksHtml }) +
      global.DS.insightCard({ title: "Inventory Bottleneck (< 50% Sell-Out)", icon: "📦", variant: "opportunity", items: bottlenecksHtml });
    section.appendChild(exceptionsWrap);

    requestAnimationFrame(() => {
      renderBrandChart(brandChart);
      renderTrendChart(computeTrendChart());
    });

    return section;
  }

  function renderBrandChart(brandChart) {
    const ctx = document.getElementById("tms-ims-brand-chart");
    if (!ctx || typeof Chart === "undefined") return;
    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: brandChart.map(b => b.brand),
        datasets: [
          { label: "TMS (Sell-In)", data: brandChart.map(b => b.TMS), backgroundColor: "#4338ca", borderRadius: 4 },
          { label: "IMS (Sell-Out)", data: brandChart.map(b => b.IMS), backgroundColor: "#0d9488", borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "top" } },
        scales: {
          x: { ticks: { color: "#64748b", font: { size: 10 }, maxRotation: 45, minRotation: 45 }, grid: { display: false } },
          y: { ticks: { color: "#64748b", font: { size: 10 }, callback: v => fmtCompact(v) }, grid: { color: "#f1f5f9" } },
        },
      },
    });
    _charts.push(chart);
  }

  function renderTrendChart(trend) {
    const ctx = document.getElementById("tms-ims-trend-chart");
    if (!ctx || typeof Chart === "undefined") return;
    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: trend.months,
        datasets: [
          { label: "TMS (Sell-In)", data: trend.tms, borderColor: "#4338ca", backgroundColor: "rgba(67,56,202,0.12)", fill: true, tension: 0.3 },
          { label: "IMS (Sell-Out)", data: trend.ims, borderColor: "#0d9488", backgroundColor: "rgba(13,148,136,0.12)", fill: true, tension: 0.3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "top" } },
        scales: {
          x: { ticks: { color: "#64748b", font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: "#64748b", font: { size: 10 }, callback: v => fmtCompact(v) }, grid: { color: "#f1f5f9" } },
        },
      },
    });
    _charts.push(chart);
  }

  function renderInventoryTab() {
    const section = document.createElement("div");
    section.className = "ds-section";

    const banner = document.createElement("div");
    banner.className = "ds-mb-4";
    banner.style.cssText = "background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;border-radius:var(--radius-lg,10px);padding:10px 14px;font-size:13px;line-height:1.5;";
    banner.textContent = "Implied Channel Inventory = cumulative TMS (all months) − cumulative IMS (through the last reported month). Months of Coverage (MoC) = inventory ÷ trailing 3-month IMS run-rate. Assumes zero opening stock on the first month in the dataset. Month filter does not apply on this tab (cumulative view). QTY view is recommended for physical inventory decisions.";
    section.appendChild(banner);

    const inv = computeInventory(_invLevel);
    const kpiWrap = document.createElement("div");
    kpiWrap.className = "ds-grid-kpi ds-mb-4";
    const unitLabel = _invLevel === "sku" ? "SKUs" : "Brands";
    kpiWrap.innerHTML =
      global.DS.kpiCard({ label: "Implied Channel Inventory", value: fmtCompact(inv.totInv) + (_metric === "qty" ? " units" : " EGP") }) +
      global.DS.kpiCard({ label: "Portfolio Months of Coverage", value: inv.portMoc === null ? "—" : inv.portMoc.toFixed(1) }) +
      global.DS.kpiCard({ label: "Stockout Risk (< 1 mo)", value: String(inv.nRisk) + " " + unitLabel, direction: inv.nRisk > 0 ? "down" : "flat" }) +
      global.DS.kpiCard({ label: "Overstock (> 3 mo)", value: String(inv.nOver) + " " + unitLabel, direction: inv.nOver > 0 ? "down" : "flat" });
    section.appendChild(kpiWrap);

    section.insertAdjacentHTML("beforeend", global.DS.insightCard({
      title: "Channel Inventory Narrative", icon: "✨", variant: "neutral",
      items: buildInventoryNarrative(inv),
    }));

    const toggleWrap = document.createElement("div");
    toggleWrap.className = "ds-flex ds-mt-4 ds-mb-2";
    toggleWrap.style.cssText = "gap:8px;";
    toggleWrap.innerHTML =
      global.DS.button({ label: "By Brand", variant: _invLevel === "brand" ? "primary" : "secondary", size: "sm", attrs: 'data-invlevel="brand"' }) +
      global.DS.button({ label: "By Product (SKU)", variant: _invLevel === "sku" ? "primary" : "secondary", size: "sm", attrs: 'data-invlevel="sku"' });
    section.appendChild(toggleWrap);

    const tableWrap = document.createElement("div");
    tableWrap.innerHTML = renderCoverageTable(inv.rows, _invLevel);
    section.appendChild(tableWrap);

    const heatmapWrap = document.createElement("div");
    heatmapWrap.className = "ds-mt-4";
    heatmapWrap.innerHTML = renderHeatmap(computeHeatmap());
    section.appendChild(heatmapWrap);

    const src = _raw.meta || {};
    const footer = document.createElement("div");
    footer.className = "ds-mt-4";
    footer.style.cssText = "font-size:11px;color:var(--color-text-tertiary,#94A3B8);";
    footer.textContent = "Source: " + (src.sourceFile || "TMS VS IMS.xlsx") + " · " + (src.sourceRows || DATA.length).toLocaleString() + " rows · viewing " + (_metric === "qty" ? "QTY (units)" : "Value (EGP)") + " · inventory figures assume zero opening stock at the start of the dataset.";
    section.appendChild(footer);

    return section;
  }

  function renderCoverageTable(rows, level) {
    const esc = global.DS._escapeHtml;
    const cols = level === "sku"
      ? ["SKU", "Brand", "Cum TMS", "Cum IMS", "Implied Inv.", "Run-rate/mo (3M)", "Period Run-rate/mo", "MoC", "Status", "Proj. Stockout"]
      : ["Brand", "Cum TMS", "Cum IMS", "Implied Inv.", "Run-rate/mo (3M)", "Period Run-rate/mo", "MoC", "Status", "Proj. Stockout"];
    const thead = "<tr>" + cols.map(c => `<th>${esc(c)}</th>`).join("") + "</tr>";
    const tbody = rows.length
      ? rows.map(r => {
          const st = mocStatus(r.inv, r.moc);
          const cells = [];
          cells.push(`<td class="ds-truncate" style="max-width:220px" title="${esc(r.label)}">${esc(r.label)}</td>`);
          if (level === "sku") cells.push(`<td>${esc(r.brand)}</td>`);
          cells.push(`<td style="text-align:right">${esc(fmtFull(r.cumT))}</td>`);
          cells.push(`<td style="text-align:right">${esc(fmtFull(r.cumI))}</td>`);
          cells.push(`<td style="text-align:right">${esc(fmtFull(r.inv))}</td>`);
          cells.push(`<td style="text-align:right">${esc(fmtFull(r.run))}</td>`);
          cells.push(`<td style="text-align:right">${esc(fmtFull(r.runP))}</td>`);
          cells.push(`<td style="text-align:right">${r.moc === null ? "—" : esc(r.moc.toFixed(1))}</td>`);
          cells.push(`<td><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${st.bg};color:${st.fg}">${esc(st.label)}</span></td>`);
          cells.push(`<td>${esc(r.projected)}</td>`);
          return "<tr>" + cells.join("") + "</tr>";
        }).join("")
      : `<tr><td colspan="${cols.length}" style="text-align:center;padding:24px;color:#94a3b8;">No rows for the current filters.</td></tr>`;
    return `<div class="ds-table-wrap ds-scrollbar-thin" style="max-height:520px;overflow:auto;"><table class="ds-table ds-table--compact"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
  }

  function renderHeatmap(rows) {
    const esc = global.DS._escapeHtml;
    const months = _raw.months;
    const thead = "<tr><th>Brand</th>" + months.map(m => `<th style="text-align:center">${esc(m)}</th>`).join("") + "</tr>";
    const tbody = rows.length
      ? rows.map(row => {
          const cells = row.cells.map(v => {
            if (v === null) return `<td style="text-align:center;background:#f8fafc;color:#cbd5e1;">·</td>`;
            const c = mocCellColor(v);
            return `<td style="text-align:center;background:${c.bg};color:${c.fg};font-weight:600;">${esc(v.toFixed(1))}</td>`;
          }).join("");
          return `<tr><td class="ds-truncate" style="max-width:160px" title="${esc(row.brand)}">${esc(row.brand)}</td>${cells}</tr>`;
        }).join("")
      : `<tr><td colspan="${months.length + 1}" style="text-align:center;padding:24px;color:#94a3b8;">No rows for the current filters.</td></tr>`;
    return `<div class="ds-chart-container"><div class="ds-chart-header"><div><div class="ds-chart-title">Months-of-Coverage Heatmap</div><div class="ds-chart-subtitle">Top 20 brands by TMS+IMS volume — cumulative inventory ÷ trailing 3-month IMS run-rate, per month</div></div></div>` +
      `<div class="ds-table-wrap ds-scrollbar-thin" style="overflow:auto;"><table class="ds-table ds-table--compact"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div></div>`;
  }

  function renderBody() {
    const mount = document.getElementById("tms-ims-tab-body");
    if (!mount) return;
    destroyCharts();
    mount.innerHTML = "";
    mount.appendChild(_subTab === "inventory" ? renderInventoryTab() : renderOverviewTab());
    // refresh reset-count label + active button states without a full re-render
    const resetBtn = _container ? _container.querySelector('[data-action="reset-filters"]') : null;
    if (resetBtn) resetBtn.querySelector("span") && (resetBtn.querySelector("span").textContent = "Reset (" + activeFilterCount() + ")");
  }

  function wireStaticEvents(container) {
    container.addEventListener("click", (e) => {
      const tabBtn = e.target.closest("[data-ds-tab]");
      if (tabBtn) {
        _subTab = tabBtn.getAttribute("data-ds-tab");
        container.querySelectorAll(".ds-tab").forEach(t => t.classList.toggle("ds-tab--active", t === tabBtn));
        renderBody();
        return;
      }
      const metricBtn = e.target.closest("[data-metric]");
      if (metricBtn) {
        _metric = metricBtn.getAttribute("data-metric");
        render(container);
        return;
      }
      const invBtn = e.target.closest("[data-invlevel]");
      if (invBtn) {
        _invLevel = invBtn.getAttribute("data-invlevel");
        render(container);
        return;
      }
      const resetBtn = e.target.closest('[data-action="reset-filters"]');
      if (resetBtn) {
        _filters = { months: [], bus: [], lines: [], brands: [], products: [], stypes: [] };
        render(container);
        return;
      }
    });
  }

  function renderAccessDenied(container) {
    container.innerHTML = "";
    container.appendChild(document.createElement("div")).outerHTML =
      `<div class="ds-page"><div style="max-width:520px;margin:80px auto;text-align:center;">` +
      global.DS.emptyState({ icon: "🔒", title: "Access restricted", hint: "The To-Market vs In-Market workspace is available to unrestricted (Allowed BU = ALL, Allowed Lines = ALL) users only." }) +
      `</div></div>`;
  }

  function render(container) {
    container.innerHTML = "";
    container.classList.add("ds-page-root");
    destroyCharts();

    const wrap = document.createElement("div");
    wrap.className = "ds-page";

    const header = document.createElement("div");
    header.className = "ds-mb-4";
    header.innerHTML = `<div style="font-size:var(--fs-2xl,28px);font-weight:800;color:var(--color-text-primary,#0F172A);">To-Market vs In-Market</div>
      <div style="font-size:var(--fs-sm,13px);color:var(--color-text-tertiary,#94A3B8);margin-top:4px;">Sell-In (TMS) vs Sell-Out (IMS) Control Tower — channel stockout &amp; overstock risk, all Business Units.</div>`;
    wrap.appendChild(header);

    wrap.appendChild(renderFilterBar());
    wrap.appendChild(renderTabsNav());

    const tabBody = document.createElement("div");
    tabBody.id = "tms-ims-tab-body";
    wrap.appendChild(tabBody);

    container.appendChild(wrap);
    _container = container;
    wireStaticEvents(container);
    renderBody();
  }

  // =====================================================================
  // Public module controller (matches every other workspace's
  // window.<Name>Dashboard.init(containerId)/.destroy() contract)
  // =====================================================================
  global.TmsImsDashboard = {
    init(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      // Global filter bar (Coverage's) is irrelevant here, same as IQVIA/
      // Executive/Sales workspaces -- hide it while this tab is active.
      const fb = document.getElementById("filter-bar");
      if (fb) fb.style.display = "none";
      const fc = document.getElementById("filter-chips");
      if (fc) fc.style.display = "none";

      const scope = global.AUTH ? global.AUTH.getScope() : { unrestricted: false };
      if (!scope.unrestricted) {
        renderAccessDenied(container);
        return;
      }

      decompressCache();
      if (!_raw) {
        container.innerHTML = "";
        container.appendChild(document.createElement("div")).outerHTML =
          `<div class="ds-page">` +
          global.DS.emptyState({ icon: "📭", title: "To-Market vs In-Market cache not available", hint: "Run refresh.bat (or python etl/build_tms_ims_cache.py) to build cache/tms_ims.data.js." }) +
          `</div>`;
        return;
      }
      render(container);
    },
    destroy() {
      destroyCharts();
      _container = null;
    },
  };
})(window);
