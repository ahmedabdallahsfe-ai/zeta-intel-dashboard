/**
 * Zeta Sales Performance Dashboard Module
 * Handles YTD Sales Achievement, Productivity, Hierarchy Cascades,
 * and Variance Analysis.
 */

(function() {
  let cache = null;
  let decodedRows = [];
  
  // State for Sales Dashboard
  const STATE = {
    subTab: "executive", // executive, line, product, team, territory, transaction
    year: "2026",
    quarter: "all",
    month: "all",
    region: "all",
    brick: "all",
    line: "all",
    brand: "all",
    product: "all",
    buhead: "all",
    nsm: "all",
    rm: "all",
    dm: "all",
    am: "all",
    rep: "all",
    metric: "value" // value, quantity
  };

  // Helper indices for decodedRows
  // [month_i, line_i, brand_i, prod_i, rep_i, dm_i, am_i, rm_i, nsm_i, bu_i, reg_i, brick_i, dist_i, qty, val, tgt_qty, tgt_val, cust_count]
  const MONTH = 0, LINE = 1, BRAND = 2, PROD = 3, REP = 4, DM = 5, AM = 6, RM = 7, NSM = 8, BU = 9, REG = 10, BRICK = 11, DIST = 12;
  const QTY = 13, VAL = 14, TGT_QTY = 15, TGT_VAL = 16, CUST_COUNT = 17;

  let repHierarchy = {};
  
  function decompressCache() {
    if (cache) return;
    try {
      const t0 = performance.now();
      const b64 = window.SALES_CACHE.b64Data;
      const binStr = atob(b64);
      const len = binStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binStr.charCodeAt(i);
      }
      const decompressed = pako.ungzip(bytes, { to: 'string' });
      cache = JSON.parse(decompressed);
      decodedRows = cache.rows;
      
      // Build representative hierarchy mapping
      const rows = decodedRows;
      const rlen = rows.length;
      for (let i = 0; i < rlen; i++) {
        const r = rows[i];
        const rep_i = r[REP];
        if (rep_i !== undefined && !repHierarchy[rep_i]) {
          repHierarchy[rep_i] = {
            dm: r[DM],
            am: r[AM],
            rm: r[RM],
            nsm: r[NSM],
            bu: r[BU]
          };
        }
      }
      
      console.log(`[Sales] Cache loaded & decompressed in ${(performance.now() - t0).toFixed(1)}ms. Rows: ${decodedRows.length}`);
    } catch (e) {
      console.error("[Sales] Failed to decompress sales cache", e);
    }
  }

  function getLookup(type, idx) {
    if (!cache || !cache.lookups[type]) return "";
    return cache.lookups[type][idx] || "";
  }

  // --- Dynamic Cascading Hierarchy Helpers ---
  function getFilteredLookupList(type, filters) {
    if (!cache) return [];
    const set = new Set();
    const rows = decodedRows;
    const len = rows.length;

    for (let i = 0; i < len; i++) {
      const r = rows[i];
      let ok = true;
      if (filters.buhead !== "all" && r[BU] !== filters.buhead) ok = false;
      if (filters.nsm !== "all" && r[NSM] !== filters.nsm) ok = false;
      if (filters.rm !== "all" && r[RM] !== filters.rm) ok = false;
      if (filters.dm !== "all" && r[DM] !== filters.dm) ok = false;
      if (filters.am !== "all" && r[AM] !== filters.am) ok = false;
      if (filters.rep !== "all" && r[REP] !== filters.rep) ok = false;

      if (ok) {
        set.add(r[type]);
      }
    }
    return Array.from(set).map(idx => ({ idx, name: cache.lookups[type][idx] })).sort((a,b) => a.name.localeCompare(b.name));
  }

  // --- Core Aggregator ---
  function runAggregator() {
    decompressCache();
    const rows = decodedRows;
    const len = rows.length;
    
    let actVal = 0, tgtVal = 0;
    let actQty = 0, tgtQty = 0;
    
    const activeReps = new Set();
    const activeCusts = new Set();
    let totalCustReach = 0;

    const monthlySales = {};
    const buSales = {};
    const lineSales = {};
    const brandSales = {};
    const productSales = {};
    const regionSales = {};
    const territorySales = {};
    const distributorSales = {};
    const typeSales = { private: 0, tender: 0, bulk: 0 };
    
    // Rep & Manager sales for leaderboards
    const repData = {};
    const dmData = {};
    const amData = {};
    const rmData = {};
    const nsmData = {};
    const buData = {};

    // Filter values
    const fYear = STATE.year;
    const fQtr = STATE.quarter;
    const fMonth = STATE.month;
    const fRegion = STATE.region;
    const fBrick = STATE.brick;
    const fLine = STATE.line;
    const fBrand = STATE.brand;
    const fProd = STATE.product;
    
    const fBuhead = STATE.buhead;
    const fNsm = STATE.nsm;
    const fRm = STATE.rm;
    const fDm = STATE.dm;
    const fAm = STATE.am;
    const fRep = STATE.rep;

    for (let i = 0; i < len; i++) {
      const r = rows[i];
      
      // Filter: Date Range (Year/Quarter/Month)
      const mStr = cache.lookups.months[r[MONTH]]; // e.g., '2026-01'
      const yr = mStr.substring(0, 4);
      const mo = parseInt(mStr.substring(5, 7));
      let qtr = "Q1";
      if (mo >= 4) qtr = "Q2"; // Jan-Mar Q1, Apr-Jun Q2
      
      if (fYear !== "all" && yr !== fYear) continue;
      if (fQtr !== "all" && qtr !== fQtr) continue;
      if (fMonth !== "all" && mStr !== fMonth) continue;

      // Filter: Region & Brick
      if (fRegion !== "all" && r[REG] !== fRegion) continue;
      if (fBrick !== "all" && r[BRICK] !== fBrick) continue;

      // Filter: Product details
      if (fLine !== "all" && r[LINE] !== fLine) continue;
      if (fBrand !== "all" && r[BRAND] !== fBrand) continue;
      if (fProd !== "all" && r[PROD] !== fProd) continue;

      // Filter: Hierarchy
      if (fBuhead !== "all" && r[BU] !== fBuhead) continue;
      if (fNsm !== "all" && r[NSM] !== fNsm) continue;
      if (fRm !== "all" && r[RM] !== fRm) continue;
      if (fDm !== "all" && r[DM] !== fDm) continue;
      if (fAm !== "all" && r[AM] !== fAm) continue;
      if (fRep !== "all" && r[REP] !== fRep) continue;

      // Actual sums
      const v = r[VAL];
      const q = r[QTY];
      const tv = r[TGT_VAL];
      const tq = r[TGT_QTY];
      const cc = r[CUST_COUNT];

      actVal += v;
      tgtVal += tv;
      actQty += q;
      tgtQty += tq;
      totalCustReach += cc;

      if (v > 0) {
        activeReps.add(r[REP]);
      }

      // Group monthly sales
      if (!monthlySales[mStr]) monthlySales[mStr] = { act: 0, tgt: 0 };
      monthlySales[mStr].act += v;
      monthlySales[mStr].tgt += tv;

      // Group by BU
      const buName = cache.lookups.buheads[r[BU]];
      if (!buSales[buName]) buSales[buName] = { act: 0, tgt: 0 };
      buSales[buName].act += v;
      buSales[buName].tgt += tv;

      // Group by Line
      const lineName = cache.lookups.lines[r[LINE]];
      if (!lineSales[lineName]) lineSales[lineName] = { act: 0, tgt: 0 };
      lineSales[lineName].act += v;
      lineSales[lineName].tgt += tv;

      // Group by Brand
      const brandName = cache.lookups.brands[r[BRAND]];
      if (!brandSales[brandName]) brandSales[brandName] = { act: 0, tgt: 0 };
      brandSales[brandName].act += v;
      brandSales[brandName].tgt += tv;

      // Group by Product
      const prodName = cache.lookups.products[r[PROD]];
      if (!productSales[prodName]) productSales[prodName] = { act: 0, tgt: 0, qty: 0 };
      productSales[prodName].act += v;
      productSales[prodName].tgt += tv;
      productSales[prodName].qty += q;

      // Group by Region & Brick
      const regName = cache.lookups.regions[r[REG]];
      if (!regionSales[regName]) regionSales[regName] = { act: 0, tgt: 0 };
      regionSales[regName].act += v;
      regionSales[regName].tgt += tv;

      const brickName = cache.lookups.bricks[r[BRICK]];
      if (!territorySales[brickName]) territorySales[brickName] = { act: 0, tgt: 0, reg: regName };
      territorySales[brickName].act += v;
      territorySales[brickName].tgt += tv;

      // Group by Distributor
      const distName = cache.lookups.distributors[r[DIST]];
      if (!distributorSales[distName]) distributorSales[distName] = { act: 0, tgt: 0 };
      distributorSales[distName].act += v;
      distributorSales[distName].tgt += tv;

      // Group by Rep & Manager YTD achievement
      const repName = cache.lookups.reps[r[REP]];
      if (repName !== "(none)") {
        if (!repData[repName]) repData[repName] = { act: 0, tgt: 0, position: cache.lookups.lines[r[LINE]] };
        repData[repName].act += v;
        repData[repName].tgt += tv;
      }

      const dmName = cache.lookups.dms[r[DM]];
      if (dmName !== "(none)") {
        if (!dmData[dmName]) dmData[dmName] = { act: 0, tgt: 0 };
        dmData[dmName].act += v;
        dmData[dmName].tgt += tv;
      }

      const amName = cache.lookups.ams[r[AM]];
      if (amName !== "(none)") {
        if (!amData[amName]) amData[amName] = { act: 0, tgt: 0 };
        amData[amName].act += v;
        amData[amName].tgt += tv;
      }
    }

    // Exact active customers from filtered roster
    const custs = cache.customers;
    const clen = custs.length;
    let exactActiveCustomers = 0;
    
    // Convert monthly mask filter
    let activeMonthIndices = [];
    if (fMonth !== "all") {
      activeMonthIndices.push(cache.lookups.months.indexOf(fMonth));
    } else {
      cache.lookups.months.forEach((mStr, idx) => {
        const yr = mStr.substring(0, 4);
        const mo = parseInt(mStr.substring(5, 7));
        let qtr = "Q1";
        if (mo >= 4) qtr = "Q2";
        if (fYear !== "all" && yr !== fYear) return;
        if (fQtr !== "all" && qtr !== fQtr) return;
        activeMonthIndices.push(idx);
      });
    }

    for (let i = 0; i < clen; i++) {
      const c = custs[i];
      const rep_i = c[1];
      // Filter: Region, Brick, Line, Rep
      if (fRegion !== "all" && c[3] !== fRegion) continue;
      if (fBrick !== "all" && c[2] !== fBrick) continue;
      if (fLine !== "all" && c[4] !== fLine) continue;
      if (fRep !== "all" && rep_i !== fRep) continue;

      // Filter: Hierarchy
      const h = repHierarchy[rep_i];
      if (h) {
        if (fBuhead !== "all" && h.bu !== fBuhead) continue;
        if (fNsm !== "all" && h.nsm !== fNsm) continue;
        if (fRm !== "all" && h.rm !== fRm) continue;
        if (fDm !== "all" && h.dm !== fDm) continue;
        if (fAm !== "all" && h.am !== fAm) continue;
      } else {
        if (fBuhead !== "all" || fNsm !== "all" || fRm !== "all" || fDm !== "all" || fAm !== "all") {
          continue;
        }
      }

      // Check month mask activity
      let isActiveInMonths = false;
      const mask = c[5];
      for (let j = 0; j < activeMonthIndices.length; j++) {
        if ((mask & (1 << activeMonthIndices[j])) !== 0) {
          isActiveInMonths = true;
          break;
        }
      }
      if (isActiveInMonths) {
        exactActiveCustomers++;
      }
    }

    return {
      actVal, tgtVal, actQty, tgtQty,
      repCount: activeReps.size,
      activeCustomers: exactActiveCustomers || totalCustReach,
      monthlySales, buSales, lineSales, brandSales, productSales, regionSales, territorySales, distributorSales,
      leaderboards: { repData, dmData, amData }
    };
  }

  // Helper to resolve rep parent properties
  function r_match(level, repIdx) {
    // Lookup if rep has the matching manager
    return false;
  }

  // --- Dynamic AI Narrative Engine ---
  function generateAINarrative(res) {
    const ach = res.tgtVal > 0 ? (res.actVal / res.tgtVal * 100).toFixed(1) : "0";
    const gap = res.tgtVal - res.actVal;
    
    // Find biggest risk (BU or Brand with lowest achievement under 80%)
    let riskName = "None";
    let riskPct = 100;
    Object.keys(res.brandSales).forEach(b => {
      const s = res.brandSales[b];
      if (s.tgt > 500000) {
        const pct = (s.act / s.tgt * 100);
        if (pct < riskPct) {
          riskPct = pct;
          riskName = b;
        }
      }
    });

    const averageSalesRep = res.repCount > 0 ? (res.actVal / res.repCount) : 0;
    const salesPerCust = res.activeCustomers > 0 ? (res.actVal / res.activeCustomers) : 0;

    let html = `
      <div class="sfe-card" style="background: linear-gradient(135deg, rgba(15, 76, 129, 0.05) 0%, rgba(20, 30, 55, 0.02) 100%); border-left: 4px solid var(--acc1); margin-bottom: 20px;">
        <h4 style="margin-top:0; color:var(--acc1); font-size:14px; font-weight:700; display:flex; align-items:center; gap:8px;">
          <span>🤖</span> YTD Strategic Executive Summary
        </h4>
        <p style="font-size:13px; line-height:1.6; margin:0; color:var(--txt1);">
          Zeta sales for the selected period reached <strong>EGP ${_fmtVal(res.actVal)}</strong> against a target of <strong>EGP ${_fmtVal(res.tgtVal)}</strong>, representing a YTD achievement of <strong style="color:${ach >= 100 ? 'var(--acc2)' : 'var(--acc3)'};">${ach}%</strong>. 
          ${gap > 0 ? `The current target gap stands at <strong style="color:var(--acc3)">EGP ${_fmtVal(gap)}</strong>.` : 'We have exceeded our YTD targets!'}
        </p>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-top:14px;">
          <div style="background:#fff; border:1px solid #eef0f7; border-radius:6px; padding:10px;">
            <div style="font-size:11px; color:#8a94a6; font-weight:600;">⚠️ HIGHEST BRAND RISK</div>
            <div style="font-size:13px; font-weight:700; color:var(--acc3); margin-top:2px;">${riskName} (${riskPct.toFixed(1)}%)</div>
          </div>
          <div style="background:#fff; border:1px solid #eef0f7; border-radius:6px; padding:10px;">
            <div style="font-size:11px; color:#8a94a6; font-weight:600;">💼 REP PRODUCTIVITY</div>
            <div style="font-size:13px; font-weight:700; color:var(--acc1); margin-top:2px;">EGP ${_fmtVal(averageSalesRep)} / Rep</div>
          </div>
          <div style="background:#fff; border:1px solid #eef0f7; border-radius:6px; padding:10px;">
            <div style="font-size:11px; color:#8a94a6; font-weight:600;">👥 OUTLET COHORT YIELD</div>
            <div style="font-size:13px; font-weight:700; color:var(--acc2); margin-top:2px;">EGP ${_fmtVal(salesPerCust)} / Customer</div>
          </div>
        </div>
      </div>
    `;
    return html;
  }

  // --- Formatting Helpers ---
  function _fmtVal(v) {
    if (v == null) return "-";
    if (v >= 1000000000) return (v / 1000000000).toFixed(2) + "B";
    if (v >= 1000000) return (v / 1000000).toFixed(2) + "M";
    if (v >= 1000) return (v / 1000).toFixed(0) + "K";
    return v.toLocaleString();
  }

  // --- UI Render Router ---
  function renderLayout() {
    const res = runAggregator();
    const container = document.getElementById("app-root");
    if (!container) return;

    const ach = res.tgtVal > 0 ? (res.actVal / res.tgtVal * 100).toFixed(1) : "0";
    const gap = res.tgtVal - res.actVal;
    
    const averageSalesRep = res.repCount > 0 ? (res.actVal / res.repCount) : 0;
    const salesPerCust = res.activeCustomers > 0 ? (res.actVal / res.activeCustomers) : 0;

    // Render Filters and Sub-Nav template
    let html = `
      <!-- Filters Sidebar & Header Layout -->
      <div style="display: flex; flex: 1; height: 100%; overflow: hidden; width:100%;">
        <!-- Left Filter panel -->
        <div style="width: 250px; background: #131625; color: #fff; padding: 16px; display: flex; flex-direction: column; gap: 12px; border-right: 1px solid #1e2238; overflow-y: auto; flex-shrink:0;">
          <h3 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #8a94a6; margin: 0 0 6px 0; font-weight:700;">Sales Filter Console</h3>
          
          <!-- Date Range filters -->
          <div>
            <label style="font-size: 11px; color:#8a94a6; font-weight:600; display:block; margin-bottom:4px;">YEAR</label>
            <select id="sales-f-year" class="sfe-select" style="background:#1e2238; border-color:#2e3456; color:#fff; width:100%;">
              <option value="2026" ${STATE.year==="2026"?'selected':''}>2026</option>
            </select>
          </div>

          <div>
            <label style="font-size: 11px; color:#8a94a6; font-weight:600; display:block; margin-bottom:4px;">QUARTER</label>
            <select id="sales-f-qtr" class="sfe-select" style="background:#1e2238; border-color:#2e3456; color:#fff; width:100%;">
              <option value="all" ${STATE.quarter==="all"?'selected':''}>YTD (All)</option>
              <option value="Q1" ${STATE.quarter==="Q1"?'selected':''}>Q1 (Jan-Mar)</option>
              <option value="Q2" ${STATE.quarter==="Q2"?'selected':''}>Q2 (Apr-Jun)</option>
            </select>
          </div>

          <div>
            <label style="font-size: 11px; color:#8a94a6; font-weight:600; display:block; margin-bottom:4px;">MONTH</label>
            <select id="sales-f-month" class="sfe-select" style="background:#1e2238; border-color:#2e3456; color:#fff; width:100%;">
              <option value="all">All Months</option>
              ${cache.lookups.months.map(m => `<option value="${m}" ${STATE.month===m?'selected':''}>${m}</option>`).join('')}
            </select>
          </div>

          <div style="border-top:1px solid #1e2238; margin: 6px 0;"></div>

          <!-- Product taxonomy filters -->
          <div>
            <label style="font-size: 11px; color:#8a94a6; font-weight:600; display:block; margin-bottom:4px;">BUSINESS UNIT (LINE)</label>
            <select id="sales-f-line" class="sfe-select" style="background:#1e2238; border-color:#2e3456; color:#fff; width:100%;">
              <option value="all">All Lines</option>
              ${cache.lookups.lines.map((l, i) => `<option value="${i}" ${STATE.line===i?'selected':''}>${l}</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="font-size: 11px; color:#8a94a6; font-weight:600; display:block; margin-bottom:4px;">BRAND</label>
            <select id="sales-f-brand" class="sfe-select" style="background:#1e2238; border-color:#2e3456; color:#fff; width:100%;">
              <option value="all">All Brands</option>
              ${cache.lookups.brands.map((b, i) => `<option value="${i}" ${STATE.brand===i?'selected':''}>${b}</option>`).join('')}
            </select>
          </div>

          <div style="border-top:1px solid #1e2238; margin: 6px 0;"></div>

          <!-- Hierarchy cascading selector console -->
          <h3 style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #8a94a6; margin: 6px 0; font-weight:700;">Sales Org Cascade</h3>
          
          <div>
            <label style="font-size: 10px; color:#8a94a6; font-weight:600; display:block; margin-bottom:2px;">BU HEAD</label>
            <select id="sales-f-bu" class="sfe-select" style="background:#1e2238; border-color:#2e3456; color:#fff; width:100%; font-size:11px; padding:4px 8px;">
              <option value="all">All BU Heads</option>
              ${getFilteredLookupList(BU, { buhead: "all", nsm: "all", rm: "all", dm: "all", am: "all", rep: "all" }).map(item => `<option value="${item.idx}" ${STATE.buhead===item.idx?'selected':''}>${item.name}</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="font-size: 10px; color:#8a94a6; font-weight:600; display:block; margin-bottom:2px;">NSM</label>
            <select id="sales-f-nsm" class="sfe-select" style="background:#1e2238; border-color:#2e3456; color:#fff; width:100%; font-size:11px; padding:4px 8px;">
              <option value="all">All NSMs</option>
              ${getFilteredLookupList(NSM, { buhead: STATE.buhead, nsm: "all", rm: "all", dm: "all", am: "all", rep: "all" }).map(item => `<option value="${item.idx}" ${STATE.nsm===item.idx?'selected':''}>${item.name}</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="font-size: 10px; color:#8a94a6; font-weight:600; display:block; margin-bottom:2px;">RM (REGIONAL MANAGER)</label>
            <select id="sales-f-rm" class="sfe-select" style="background:#1e2238; border-color:#2e3456; color:#fff; width:100%; font-size:11px; padding:4px 8px;">
              <option value="all">All RMs</option>
              ${getFilteredLookupList(RM, { buhead: STATE.buhead, nsm: STATE.nsm, rm: "all", dm: "all", am: "all", rep: "all" }).map(item => `<option value="${item.idx}" ${STATE.rm===item.idx?'selected':''}>${item.name}</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="font-size: 10px; color:#8a94a6; font-weight:600; display:block; margin-bottom:2px;">DM (DISTRICT MANAGER)</label>
            <select id="sales-f-dm" class="sfe-select" style="background:#1e2238; border-color:#2e3456; color:#fff; width:100%; font-size:11px; padding:4px 8px;">
              <option value="all">All DMs</option>
              ${getFilteredLookupList(DM, { buhead: STATE.buhead, nsm: STATE.nsm, rm: STATE.rm, dm: "all", am: "all", rep: "all" }).map(item => `<option value="${item.idx}" ${STATE.dm===item.idx?'selected':''}>${item.name}</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="font-size: 10px; color:#8a94a6; font-weight:600; display:block; margin-bottom:2px;">SUPERVISOR (AM)</label>
            <select id="sales-f-am" class="sfe-select" style="background:#1e2238; border-color:#2e3456; color:#fff; width:100%; font-size:11px; padding:4px 8px;">
              <option value="all">All Supervisors</option>
              ${getFilteredLookupList(AM, { buhead: STATE.buhead, nsm: STATE.nsm, rm: STATE.rm, dm: STATE.dm, am: "all", rep: "all" }).map(item => `<option value="${item.idx}" ${STATE.am===item.idx?'selected':''}>${item.name}</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="font-size: 10px; color:#8a94a6; font-weight:600; display:block; margin-bottom:2px;">MEDICAL REP</label>
            <select id="sales-f-rep" class="sfe-select" style="background:#1e2238; border-color:#2e3456; color:#fff; width:100%; font-size:11px; padding:4px 8px;">
              <option value="all">All Reps</option>
              ${getFilteredLookupList(REP, { buhead: STATE.buhead, nsm: STATE.nsm, rm: STATE.rm, dm: STATE.dm, am: STATE.am, rep: "all" }).map(item => `<option value="${item.idx}" ${STATE.rep===item.idx?'selected':''}>${item.name}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Main Content Area -->
        <div style="flex: 1; display: flex; flex-direction: column; background: #f8fafc; overflow-y: auto;">
          <!-- Sales Sub-tabs Navigation -->
          <div style="background:#fff; border-bottom:1px solid #e2e8f0; padding:0 24px; display:flex; align-items:center; gap:20px; flex-shrink:0;">
            <button class="sales-tab-btn ${STATE.subTab==='executive'?'active':''}" data-subtab="executive" style="padding:16px 4px; border:none; background:transparent; font-size:13px; font-weight:600; cursor:pointer; color: ${STATE.subTab==='executive'?'var(--acc1)':'#64748b'}; border-bottom: 2px solid ${STATE.subTab==='executive'?'var(--acc1)':'transparent'};">Executive Command</button>
            <button class="sales-tab-btn ${STATE.subTab==='line'?'active':''}" data-subtab="line" style="padding:16px 4px; border:none; background:transparent; font-size:13px; font-weight:600; cursor:pointer; color: ${STATE.subTab==='line'?'var(--acc1)':'#64748b'}; border-bottom: 2px solid ${STATE.subTab==='line'?'var(--acc1)':'transparent'};">Line Performance</button>
            <button class="sales-tab-btn ${STATE.subTab==='product'?'active':''}" data-subtab="product" style="padding:16px 4px; border:none; background:transparent; font-size:13px; font-weight:600; cursor:pointer; color: ${STATE.subTab==='product'?'var(--acc1)':'#64748b'}; border-bottom: 2px solid ${STATE.subTab==='product'?'var(--acc1)':'transparent'};">Brand & Product Intel</button>
            <button class="sales-tab-btn ${STATE.subTab==='team'?'active':''}" data-subtab="team" style="padding:16px 4px; border:none; background:transparent; font-size:13px; font-weight:600; cursor:pointer; color: ${STATE.subTab==='team'?'var(--acc1)':'#64748b'}; border-bottom: 2px solid ${STATE.subTab==='team'?'var(--acc1)':'transparent'};">Team Rankings</button>
            <button class="sales-tab-btn ${STATE.subTab==='territory'?'active':''}" data-subtab="territory" style="padding:16px 4px; border:none; background:transparent; font-size:13px; font-weight:600; cursor:pointer; color: ${STATE.subTab==='territory'?'var(--acc1)':'#64748b'}; border-bottom: 2px solid ${STATE.subTab==='territory'?'var(--acc1)':'transparent'};">Territory Breakdown</button>
          </div>

          <div style="padding: 24px; flex: 1;">
            <!-- AI Summary Narrative Box -->
            ${generateAINarrative(res)}

            <!-- Executive View -->
            ${STATE.subTab === 'executive' ? `
              <!-- KPI Card Grid -->
              <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:18px; margin-bottom:24px;">
                <div class="sfe-card" style="padding: 20px;">
                  <div style="font-size:11px; color:#8a94a6; font-weight:700; text-transform:uppercase;">YTD Actual Sales</div>
                  <div style="font-size:24px; font-weight:700; color:var(--acc1); margin-top:8px;">EGP ${_fmtVal(res.actVal)}</div>
                  <div style="font-size:12px; color:#8a94a6; margin-top:6px;">Qty: ${res.actQty.toLocaleString()} units</div>
                </div>
                <div class="sfe-card" style="padding: 20px;">
                  <div style="font-size:11px; color:#8a94a6; font-weight:700; text-transform:uppercase;">YTD Target Sales</div>
                  <div style="font-size:24px; font-weight:700; color:#1e293b; margin-top:8px;">EGP ${_fmtVal(res.tgtVal)}</div>
                  <div style="font-size:12px; color:#8a94a6; margin-top:6px;">Qty: ${res.tgtQty.toLocaleString()} units</div>
                </div>
                <div class="sfe-card" style="padding: 20px;">
                  <div style="font-size:11px; color:#8a94a6; font-weight:700; text-transform:uppercase;">Achievement Ratio</div>
                  <div style="font-size:24px; font-weight:700; color:${ach >= 100 ? 'var(--acc2)' : 'var(--acc3)'}; margin-top:8px;">${ach}%</div>
                  <div style="font-size:12px; color:#8a94a6; margin-top:6px; display:flex; align-items:center; gap:4px;">
                    ${gap > 0 ? `Gap: <strong style="color:var(--acc3)">EGP ${_fmtVal(gap)}</strong>` : 'Target Exceeded!'}
                  </div>
                </div>
                <div class="sfe-card" style="padding: 20px;">
                  <div style="font-size:11px; color:#8a94a6; font-weight:700; text-transform:uppercase;">Active Customers</div>
                  <div style="font-size:24px; font-weight:700; color:var(--acc2); margin-top:8px;">${res.activeCustomers.toLocaleString()}</div>
                  <div style="font-size:12px; color:#8a94a6; margin-top:6px;">Average Sales/Customer: EGP ${_fmtVal(salesPerCust)}</div>
                </div>
              </div>

              <!-- Charts Section -->
              <div style="display:grid; grid-template-columns: 2fr 1fr; gap:18px; margin-bottom:24px;">
                <div class="sfe-card" style="padding:20px; display:flex; flex-direction:column; min-height:350px;">
                  <h3 style="font-size:14px; color:#1e293b; margin:0 0 16px 0; font-weight:700;">Sales Achievement Monthly Trend</h3>
                  <div style="flex:1; position:relative;">
                    <canvas id="sales-trend-chart"></canvas>
                  </div>
                </div>
                <div class="sfe-card" style="padding:20px; display:flex; flex-direction:column; min-height:350px;">
                  <h3 style="font-size:14px; color:#1e293b; margin:0 0 16px 0; font-weight:700;">Contribution by BU</h3>
                  <div style="flex:1; position:relative; max-height:260px; display:flex; justify-content:center;">
                    <canvas id="sales-bu-chart"></canvas>
                  </div>
                </div>
              </div>
            ` : ''}

            <!-- Line View -->
            ${STATE.subTab === 'line' ? `
              <div class="sfe-card" style="padding: 20px;">
                <h3 style="font-size:14px; color:#1e293b; margin:0 0 16px 0; font-weight:700;">Business Unit Performance Table</h3>
                <div class="table-container">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Business Unit / Line</th>
                        <th style="text-align:right;">Actual Sales (Value)</th>
                        <th style="text-align:right;">Target Sales (Value)</th>
                        <th style="text-align:right;">Achievement %</th>
                        <th style="text-align:right;">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${Object.keys(res.lineSales).map(line => {
                        const s = res.lineSales[line];
                        const aPct = s.tgt > 0 ? (s.act / s.tgt * 100).toFixed(1) : "0.0";
                        const vDiff = s.act - s.tgt;
                        return `
                          <tr>
                            <td style="font-weight:600; color:var(--acc1);">${line}</td>
                            <td style="text-align:right; font-weight:600;">EGP ${s.act.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                            <td style="text-align:right;">EGP ${s.tgt.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                            <td style="text-align:right; font-weight:700; color:${aPct >= 100 ? 'var(--acc2)' : 'var(--acc3)'};">${aPct}%</td>
                            <td style="text-align:right; font-weight:600; color:${vDiff >= 0 ? 'var(--acc2)' : 'var(--acc3)'};">${vDiff >= 0 ? '+' : ''}EGP ${vDiff.toLocaleString(undefined, {maximumFractionDigits:0})}</td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : ''}

            <!-- Brand View -->
            ${STATE.subTab === 'product' ? `
              <div class="sfe-card" style="padding: 20px;">
                <h3 style="font-size:14px; color:#1e293b; margin:0 0 16px 0; font-weight:700;">Brand-Level Performance Grid</h3>
                <div class="table-container">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Brand</th>
                        <th style="text-align:right;">Actual Sales</th>
                        <th style="text-align:right;">Target</th>
                        <th style="text-align:right;">Achievement %</th>
                        <th style="text-align:right;">Variance</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${Object.keys(res.brandSales).map(brand => {
                        const s = res.brandSales[brand];
                        const aPct = s.tgt > 0 ? (s.act / s.tgt * 100).toFixed(1) : "0.0";
                        const vDiff = s.act - s.tgt;
                        return `
                          <tr>
                            <td style="font-weight:600; color:var(--acc1);">${brand}</td>
                            <td style="text-align:right; font-weight:600;">EGP ${s.act.toLocaleString(undefined, {maximumFractionDigits:0})}</td>
                            <td style="text-align:right;">EGP ${s.tgt.toLocaleString(undefined, {maximumFractionDigits:0})}</td>
                            <td style="text-align:right; font-weight:700; color:${aPct >= 100 ? 'var(--acc2)' : 'var(--acc3)'};">${aPct}%</td>
                            <td style="text-align:right; font-weight:600; color:${vDiff >= 0 ? 'var(--acc2)' : 'var(--acc3)'};">${vDiff >= 0 ? '+' : ''}EGP ${vDiff.toLocaleString(undefined, {maximumFractionDigits:0})}</td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : ''}

            <!-- Team View -->
            ${STATE.subTab === 'team' ? `
              <div style="display:grid; grid-template-columns: 1fr 1fr; gap:18px;">
                <div class="sfe-card" style="padding: 20px;">
                  <h3 style="font-size:14px; color:#1e293b; margin:0 0 16px 0; font-weight:700;">Medical Representatives Leaderboard</h3>
                  <div class="table-container" style="max-height: 450px; overflow-y:auto;">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Representative</th>
                          <th>Position</th>
                          <th style="text-align:right;">Achievement</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${Object.keys(res.leaderboards.repData)
                          .map(name => ({ name, ...res.leaderboards.repData[name] }))
                          .sort((a,b) => b.act - a.act)
                          .slice(0, 100)
                          .map(r => {
                            const aPct = r.tgt > 0 ? (r.act / r.tgt * 100).toFixed(0) : "0";
                            return `
                              <tr>
                                <td style="font-weight:600; font-size:12px;">${r.name}</td>
                                <td style="font-size:11px; color:#64748b;">${r.position}</td>
                                <td style="text-align:right; font-weight:700; color:${aPct >= 100 ? 'var(--acc2)' : 'var(--acc3)'};">${aPct}%</td>
                              </tr>
                            `;
                          }).join('')}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div class="sfe-card" style="padding: 20px;">
                  <h3 style="font-size:14px; color:#1e293b; margin:0 0 16px 0; font-weight:700;">District Managers Leaderboard</h3>
                  <div class="table-container" style="max-height: 450px; overflow-y:auto;">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>District Manager</th>
                          <th style="text-align:right;">Achievement</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${Object.keys(res.leaderboards.dmData)
                          .map(name => ({ name, ...res.leaderboards.dmData[name] }))
                          .sort((a,b) => b.act - a.act)
                          .map(r => {
                            const aPct = r.tgt > 0 ? (r.act / r.tgt * 100).toFixed(0) : "0";
                            return `
                              <tr>
                                <td style="font-weight:600; font-size:12px;">${r.name}</td>
                                <td style="text-align:right; font-weight:700; color:${aPct >= 100 ? 'var(--acc2)' : 'var(--acc3)'};">${aPct}%</td>
                              </tr>
                            `;
                          }).join('')}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ` : ''}

            <!-- Territory View -->
            ${STATE.subTab === 'territory' ? `
              <div style="display:grid; grid-template-columns: 1fr 1.5fr; gap:18px;">
                <div class="sfe-card" style="padding: 20px;">
                  <h3 style="font-size:14px; color:#1e293b; margin:0 0 16px 0; font-weight:700;">Sales by Region</h3>
                  <div class="table-container">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Region</th>
                          <th style="text-align:right;">Actual Sales</th>
                          <th style="text-align:right;">Achievement</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${Object.keys(res.regionSales).map(reg => {
                          const s = res.regionSales[reg];
                          const aPct = s.tgt > 0 ? (s.act / s.tgt * 100).toFixed(1) : "0.0";
                          return `
                            <tr>
                              <td style="font-weight:600;">${reg}</td>
                              <td style="text-align:right;">EGP ${s.act.toLocaleString(undefined, {maximumFractionDigits:0})}</td>
                              <td style="text-align:right; font-weight:700; color:${aPct >= 100 ? 'var(--acc2)' : 'var(--acc3)'};">${aPct}%</td>
                            </tr>
                          `;
                        }).join('')}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div class="sfe-card" style="padding: 20px;">
                  <h3 style="font-size:14px; color:#1e293b; margin:0 0 16px 0; font-weight:700;">Sales by Brick Territory (Top 50)</h3>
                  <div class="table-container" style="max-height: 450px; overflow-y:auto;">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>Brick</th>
                          <th>Region</th>
                          <th style="text-align:right;">Actual Sales</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${Object.keys(res.territorySales)
                          .map(name => ({ name, ...res.territorySales[name] }))
                          .sort((a,b) => b.act - a.act)
                          .slice(0, 50)
                          .map(t => `
                            <tr>
                              <td style="font-weight:600;">${t.name}</td>
                              <td style="font-size:11px; color:#64748b;">${t.reg}</td>
                              <td style="text-align:right; font-weight:600; color:var(--acc1);">EGP ${t.act.toLocaleString(undefined, {maximumFractionDigits:0})}</td>
                            </tr>
                          `).join('')}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ` : ''}

          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
    
    // Bind Event Listeners
    bindFilters();
    bindTabs();
    
    // Render Charts
    if (STATE.subTab === "executive") {
      renderExecutiveCharts(res);
    }
  }

  function bindFilters() {
    const elYear = document.getElementById("sales-f-year");
    const elQtr = document.getElementById("sales-f-qtr");
    const elMonth = document.getElementById("sales-f-month");
    
    const elLine = document.getElementById("sales-f-line");
    const elBrand = document.getElementById("sales-f-brand");
    
    const elBu = document.getElementById("sales-f-bu");
    const elNsm = document.getElementById("sales-f-nsm");
    const elRm = document.getElementById("sales-f-rm");
    const elDm = document.getElementById("sales-f-dm");
    const elAm = document.getElementById("sales-f-am");
    const elRep = document.getElementById("sales-f-rep");

    const setFilter = (key, el) => {
      if (!el) return;
      el.addEventListener("change", () => {
        const val = el.value;
        let parsedVal = val;
        if (val !== "all" && /^\d+$/.test(val)) {
          parsedVal = parseInt(val, 10);
        }
        STATE[key] = parsedVal;
        
        // Reset sub-levels if hierarchy parent changes
        if (key === "buhead") { STATE.nsm = "all"; STATE.rm = "all"; STATE.dm = "all"; STATE.am = "all"; STATE.rep = "all"; }
        if (key === "nsm") { STATE.rm = "all"; STATE.dm = "all"; STATE.am = "all"; STATE.rep = "all"; }
        if (key === "rm") { STATE.dm = "all"; STATE.am = "all"; STATE.rep = "all"; }
        if (key === "dm") { STATE.am = "all"; STATE.rep = "all"; }
        if (key === "am") { STATE.rep = "all"; }

        renderLayout();
      });
    };

    setFilter("year", elYear);
    setFilter("quarter", elQtr);
    setFilter("month", elMonth);
    setFilter("line", elLine);
    setFilter("brand", elBrand);
    setFilter("buhead", elBu);
    setFilter("nsm", elNsm);
    setFilter("rm", elRm);
    setFilter("dm", elDm);
    setFilter("am", elAm);
    setFilter("rep", elRep);
  }

  function bindTabs() {
    document.querySelectorAll(".sales-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        STATE.subTab = btn.dataset.subtab;
        renderLayout();
      });
    });
  }

  // --- Chart.js Render Core ---
  let trendChartInstance = null;
  let buChartInstance = null;

  function renderExecutiveCharts(res) {
    // 1. Sales Achievement Trend Chart (Line + Bar combo)
    const trendCtx = document.getElementById("sales-trend-chart");
    if (trendCtx) {
      if (trendChartInstance) trendChartInstance.destroy();
      
      const labels = Object.keys(res.monthlySales).sort();
      const actuals = labels.map(l => res.monthlySales[l].act);
      const targets = labels.map(l => res.monthlySales[l].tgt);
      
      trendChartInstance = new Chart(trendCtx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Actual Sales Value (EGP)',
              data: actuals,
              backgroundColor: 'rgba(15, 76, 129, 0.85)',
              borderColor: 'var(--acc1)',
              borderWidth: 1,
              order: 2
            },
            {
              label: 'Target Sales Value (EGP)',
              data: targets,
              type: 'line',
              borderColor: 'var(--acc3)',
              backgroundColor: 'transparent',
              borderWidth: 2,
              pointBackgroundColor: 'var(--acc3)',
              pointRadius: 4,
              order: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: '#eef0f7' },
              ticks: {
                callback: function(value) { return 'EGP ' + _fmtVal(value); },
                color: '#64748b',
                font: { size: 10 }
              }
            },
            x: {
              grid: { display: false },
              ticks: { color: '#64748b', font: { size: 10 } }
            }
          },
          plugins: {
            legend: {
              position: 'top',
              labels: { boxWidth: 12, font: { size: 11, weight: '600' } }
            }
          }
        }
      });
    }

    // 2. BU Sales Contribution Donut Chart
    const buCtx = document.getElementById("sales-bu-chart");
    if (buCtx) {
      if (buChartInstance) buChartInstance.destroy();
      
      const buLabels = Object.keys(res.buSales).filter(bu => res.buSales[bu].act > 0);
      const buValues = buLabels.map(bu => res.buSales[bu].act);
      
      buChartInstance = new Chart(buCtx, {
        type: 'doughnut',
        data: {
          labels: buLabels,
          datasets: [{
            data: buValues,
            backgroundColor: [
              '#0f4c81', '#1d4ed8', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#f43f5e'
            ],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { boxWidth: 8, font: { size: 10, weight: '600' } }
            }
          },
          cutout: '65%'
        }
      });
    }
  }

  // Define global namespace
  window.SalesDashboard = {
    init(containerId) {
      document.body.classList.add('sales-mode');
      decompressCache();
      renderLayout();
    },
    destroy() {
      document.body.classList.remove('sales-mode');
      if (trendChartInstance) { trendChartInstance.destroy(); trendChartInstance = null; }
      if (buChartInstance) { buChartInstance.destroy(); buChartInstance = null; }
    }
  };
})();
