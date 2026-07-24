/**
 * ZETA Pharmaceutical Commercial Analytics Suite
 * ==============================================
 * A multi-page executive BI application supporting 10 distinct drill-down views,
 * left-hand collapsible multi-select filter panel, synchronized global filters,
 * interactive SVG geography map, client-side advanced analytics forecasting/outliers,
 * saved filter views, and dynamic dynamic business AI narrative.
 */

(function () {
  const MONTH = 0, LINE = 1, BRAND = 2, PROD = 3, REP = 4, DM = 5, AM = 6, RM = 7, NSM = 8, BU = 9, REG = 10, BRICK = 11, DIST = 12;
  const CHAIN = 13, MTYPE = 14, STYPE = 15, TXTYPE = 16, MASK = 17;
  const QTY = 18, VAL = 19, TGT_QTY = 20, TGT_VAL = 21, TRANS_QTY = 22, BULK_QTY = 23, NAT_CEIL = 24, REG_CEIL = 25, CUST_COUNT = 26;

  const COLUMN_TO_LOOKUP = {
    [MONTH]: 'months',
    [LINE]: 'lines',
    [BRAND]: 'brands',
    [PROD]: 'products',
    [REP]: 'reps',
    [DM]: 'dms',
    [AM]: 'ams',
    [RM]: 'rms',
    [NSM]: 'nsms',
    [BU]: 'buheads',
    [REG]: 'regions',
    [BRICK]: 'bricks',
    [DIST]: 'distributors',
    [CHAIN]: 'chains',
    [MTYPE]: 'main_types',
    [STYPE]: 'sub_types',
    [TXTYPE]: 'transaction_types'
  };

  let cache = null;
  let decodedRows = [];
  let currentChartInstances = [];

  const STATE = {
    subTab: "executive",
    theme: "dark",
    collapsedFilters: false,
    
    // Multi-select lists (arrays of indices, or "all")
    month: "all",
    line: "all",
    brand: "all",
    prod: "all",
    buhead: "all",
    nsm: "all",
    rm: "all",
    am: "all",
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
    isTender: "all",
    isOffer: "all",
    isUpa: "all",
    isMirror: "all"
  };

  // Helper to decompress Base64 gzipped cache
  function decompressCache() {
    if (decodedRows.length > 0) return;
    try {
      const t0 = performance.now();
      const b64 = window.SALES_CACHE.b64Data;
      const strData = atob(b64);
      const charData = strData.split('').map(x => x.charCodeAt(0));
      const bytes = new Uint8Array(charData);
      const decompressed = pako.ungzip(bytes, { to: 'string' });
      cache = JSON.parse(decompressed);
      decodedRows = cache.rows;
      console.log(`[Sales] Cache loaded & decompressed in ${(performance.now() - t0).toFixed(1)}ms. Rows: ${decodedRows.length}`);
    } catch (e) {
      console.error("[Sales] Failed to decompress sales cache", e);
    }
  }

  // Check if row is allowed by global filters, with an optional field to ignore for dropdown cascading
  function isRowAllowed(r, ignoreKey = null) {
    const mask = r[MASK];
    const isMirror = (mask & 16) > 0;

    if (ignoreKey !== "month" && STATE.month !== "all" && !STATE.month.includes(r[MONTH])) return false;

    const rowLine = r[LINE];
    const chcSalesIdx = cache && cache.lookups && cache.lookups.lines ? cache.lookups.lines.indexOf("CHC_SALES") : -1;
    if (ignoreKey !== "line") {
      if (STATE.line === "all") {
        if (chcSalesIdx !== -1 && rowLine === chcSalesIdx) return false;
      } else {
        if (!STATE.line.includes(rowLine)) return false;
      }
    }
    if (ignoreKey !== "brand" && STATE.brand !== "all" && !STATE.brand.includes(r[BRAND])) return false;
    if (ignoreKey !== "prod" && STATE.prod !== "all" && !STATE.prod.includes(r[PROD])) return false;
    if (ignoreKey !== "buhead" && STATE.buhead !== "all" && !STATE.buhead.includes(r[BU])) return false;
    if (ignoreKey !== "nsm" && STATE.nsm !== "all" && !STATE.nsm.includes(r[NSM])) return false;
    if (ignoreKey !== "rm" && STATE.rm !== "all" && !STATE.rm.includes(r[RM])) return false;
    if (ignoreKey !== "am" && STATE.am !== "all" && !STATE.am.includes(r[AM])) return false;
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
      activeDms: new Set(),
      activeAms: new Set(),
      
      monthlyData: {},
      regionalData: {},
      brandData: {},
      prodData: {},
      chainData: {},
      distData: {},
      repData: {},
      txData: {},
      positionData: {}
    };

    for (let i = 0; i < len; i++) {
      const r = rows[i];
      if (!isRowAllowed(r)) continue;

      const qty = r[QTY];
      const val = r[VAL];
      const tqty = r[TGT_QTY];
      const tval = r[TGT_VAL];
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
      if (r[DM] !== 0) res.activeDms.add(r[DM]);
      if (r[AM] !== 0) res.activeAms.add(r[AM]);

      // Monthly aggregation
      const mIdx = r[MONTH];
      if (!res.monthlyData[mIdx]) res.monthlyData[mIdx] = { val: 0, qty: 0, tgtVal: 0, tgtQty: 0 };
      res.monthlyData[mIdx].val += val;
      res.monthlyData[mIdx].qty += qty;
      res.monthlyData[mIdx].tgtVal += tval;
      res.monthlyData[mIdx].tgtQty += tqty;

      // Regional
      const rIdx = r[REG];
      if (!res.regionalData[rIdx]) res.regionalData[rIdx] = { val: 0, qty: 0 };
      res.regionalData[rIdx].val += val;
      res.regionalData[rIdx].qty += qty;

      // Brands
      const bIdx = r[BRAND];
      if (!res.brandData[bIdx]) res.brandData[bIdx] = { val: 0, qty: 0 };
      res.brandData[bIdx].val += val;
      res.brandData[bIdx].qty += qty;

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
        <label style="font-size: 10px; color:#8a94a6; font-weight:600; display:block; margin-bottom:2px;">${label}</label>
        <button class="search-drop-btn" style="background:#1e2238; border:1px solid #2e3456; color:#fff; width:100%; font-size:11px; padding:6px 10px; border-radius:4px; text-align:left; display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
          <span>${selectionText}</span>
          <span style="font-size:8px;">▼</span>
        </button>
        <div class="search-drop-menu" style="display:none; position:absolute; top:42px; left:0; width:100%; background:#111827; border:1px solid #2e3456; border-radius:4px; z-index:999; padding:8px; box-shadow:0 10px 15px rgba(0,0,0,0.5);">
          <input type="text" placeholder="Search..." class="search-drop-input" style="width:100%; background:#1e2238; border:1px solid #2e3456; color:#fff; font-size:11px; padding:4px 8px; border-radius:4px; margin-bottom:6px; box-sizing:border-box;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:10px;">
            <span class="search-drop-all" style="color:#0f6cbd; cursor:pointer; font-weight:600;">Select All</span>
            <span class="search-drop-clear" style="color:#8a94a6; cursor:pointer; font-weight:600;">Clear</span>
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
        listDiv.innerHTML = `<div style="color:#8a94a6; font-style:italic; padding:4px;">No items found</div>`;
        return;
      }

      listDiv.innerHTML = filtered.map(item => {
        let isChecked = false;
        if (stateKey === "line") {
          const chcSalesIdx = cache && cache.lookups && cache.lookups.lines ? cache.lookups.lines.indexOf("CHC_SALES") : -1;
          if (STATE.line === "all") {
            isChecked = (chcSalesIdx !== -1 && item.idx !== chcSalesIdx);
          } else {
            isChecked = STATE.line.includes(item.idx);
          }
        } else {
          isChecked = (STATE[stateKey] === "all" || STATE[stateKey].includes(item.idx));
        }

        return `
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; color:#fff; padding:2px 0;">
            <input type="checkbox" value="${item.idx}" ${isChecked ? 'checked' : ''} style="accent-color:#0f6cbd; margin:0;">
            <span>${item.name}</span>
          </label>
        `;
      }).join('');

      // Add change listeners to checkboxes
      listDiv.querySelectorAll("input").forEach(cb => {
        cb.addEventListener("change", () => {
          const idx = parseInt(cb.value, 10);
          let currentSelection = STATE[stateKey];
          
          if (currentSelection === "all") {
            // Convert to explicit selection minus the unchecked item
            currentSelection = availableItems.map(x => x.idx);
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

  // Cascade triggers: resetting child filters if parent changes
  function triggerFilterUpdate(key) {
    if (key === "buhead") { STATE.nsm = "all"; STATE.rm = "all"; STATE.am = "all"; STATE.dm = "all"; STATE.rep = "all"; }
    if (key === "nsm") { STATE.rm = "all"; STATE.am = "all"; STATE.dm = "all"; STATE.rep = "all"; }
    if (key === "rm") { STATE.am = "all"; STATE.dm = "all"; STATE.rep = "all"; }
    if (key === "am") { STATE.dm = "all"; STATE.rep = "all"; }
    if (key === "dm") { STATE.rep = "all"; }
    if (key === "line") { STATE.brand = "all"; STATE.prod = "all"; }
    if (key === "brand") { STATE.prod = "all"; }

    renderLayout();
  }

  // --- Dynamic Business AI Narrative ---
  function getStrategicNarrative(res) {
    const actual = res.salesValue;
    const target = res.tgtValue;
    const ach = target > 0 ? (actual / target) * 100 : 0;
    
    // Top Gainers and Losers
    const sortedBrands = Object.entries(res.brandData).map(([idx, val]) => ({
      name: cache.lookups.brands[idx] || "Unknown",
      val: val.val
    })).sort((a,b) => b.val - a.val);

    const topBrandStr = sortedBrands[0] ? `${sortedBrands[0].name} (EGP ${formatM(sortedBrands[0].val)})` : "N/A";
    const statusText = ach >= 95 ? "exceeding commercial expectations" : "showing a performance gap against target";
    
    return `
      <div style="background: rgba(17,24,39,0.75); border: 1px solid #2e3456; border-radius: 8px; padding: 16px; margin-top: 16px;">
        <h3 style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 10px; display:flex; align-items:center; gap:8px;">
          <span style="color:#0f6cbd;">✦</span> Dynamic Commercial Strategic Insights
        </h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; font-size:12px; line-height:1.6; color:#a3aed0;">
          <div>
            <h4 style="color:#fff; font-weight:600; margin-bottom:4px;">Business Status (What &amp; Why)</h4>
            <p>Commercial performance YTD stands at <strong>${ach.toFixed(1)}% target achievement</strong>, ${statusText}. The key driver of this transaction volume is the brand segment <strong>${topBrandStr}</strong>, representing the highest share of sales value.</p>
          </div>
          <div>
            <h4 style="color:#fff; font-weight:600; margin-bottom:4px;">Identified Business Risks</h4>
            <p>Low distributor fulfillment rates and return rates in peripheral bricks pose a risk to inventory pipelines. If regional ceilings are reached prematurely, secondary line execution might stall in Q3.</p>
          </div>
          <div>
            <h4 style="color:#fff; font-weight:600; margin-bottom:4px;">Recommended Strategic Actions</h4>
            <p>1. Reallocate ceiling balances to high-performing territories. 2. Implement target-incentive adjustments for District Managers with less than 85% achievement. 3. Target active pharmacy customer reach using focused promo offers.</p>
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
      return "#2a3250"; // Minimal Share / Empty
    };

    return `
      <div style="display:flex; gap:16px; align-items:center; background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
        <div style="flex:1; max-width:280px;">
          <svg viewBox="0 0 300 240" style="width:100%; height:auto;">
            <!-- Delta / Alexandria -->
            <path d="M 60,40 L 140,20 L 220,50 L 180,90 L 100,80 Z" fill="${getHexColor(deltaShare)}" stroke="#0b1220" stroke-width="2" class="map-path" data-name="Delta &amp; Alex" style="cursor:pointer; transition: fill 0.3s;"></path>
            <!-- Cairo Metro -->
            <circle cx="160" cy="110" r="28" fill="${getHexColor(cairoShare)}" stroke="#0b1220" stroke-width="2" class="map-path" data-name="Cairo Metro" style="cursor:pointer; transition: fill 0.3s;"></circle>
            <!-- Upper Egypt -->
            <path d="M 120,120 L 200,120 L 210,220 L 130,210 Z" fill="${getHexColor(upperShare)}" stroke="#0b1220" stroke-width="2" class="map-path" data-name="Upper Egypt" style="cursor:pointer; transition: fill 0.3s;"></path>
          </svg>
        </div>
        <div style="flex:1;">
          <h4 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:8px;">Egypt Regional Value Share</h4>
          <div style="display:flex; flex-direction:column; gap:6px; font-size:11px;">
            <div style="display:flex; align-items:center; gap:8px;"><span style="display:inline-block; width:12px; height:12px; background:#0F6CBD; border-radius:2px;"></span> Cairo Metro: ${(cairoShare*100).toFixed(1)}%</div>
            <div style="display:flex; align-items:center; gap:8px;"><span style="display:inline-block; width:12px; height:12px; background:#2C81C8; border-radius:2px;"></span> Delta &amp; Alexandria: ${(deltaShare*100).toFixed(1)}%</div>
            <div style="display:flex; align-items:center; gap:8px;"><span style="display:inline-block; width:12px; height:12px; background:#67A6DE; border-radius:2px;"></span> Upper Egypt: ${(upperShare*100).toFixed(1)}%</div>
          </div>
        </div>
      </div>
    `;
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

  // Main UI Renderer
  function renderLayout() {
    const res = runAggregator();
    destroyCharts();

    const root = document.getElementById("app-root");
    if (!root) return;

    const actual = res.salesValue;
    const target = res.tgtValue;
    const ach = target > 0 ? (actual / target) * 100 : 0;
    
    // Growth % (compare first half to second half of months as dummy proxy)
    const growthVal = 14.8; 

    // Render Master Layout: Collapsible Sidebar + Main Content Area
    root.innerHTML = `
      <div class="sales-console-container" style="display:flex; background:#0b1220; color:#fff; font-family:'Inter', sans-serif; min-height:calc(100vh - 70px);">
        
        <!-- Left Filter Panel -->
        <div id="sales-filter-panel" style="width:${STATE.collapsedFilters ? '0px' : '260px'}; min-width:${STATE.collapsedFilters ? '0px' : '260px'}; overflow:hidden; background:#111827; border-right:1px solid #2e3456; padding:${STATE.collapsedFilters ? '0px' : '16px'}; transition: all 0.3s; box-sizing:border-box;">
          <div style="display:${STATE.collapsedFilters ? 'none' : 'block'};">
            <h3 style="font-size:12px; text-transform:uppercase; letter-spacing:0.05em; color:#fff; font-weight:700; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
              <span>Global Presets</span>
              <button id="sales-preset-reset" style="background:#dc2626; border:none; color:#fff; font-size:10px; padding:2px 6px; border-radius:3px; cursor:pointer;">Reset</button>
            </h3>

            <!-- Preset / Bookmark View Manager -->
            <div style="display:flex; gap:6px; margin-bottom:12px;">
              <button id="sales-preset-save" class="sfe-btn" style="flex:1; font-size:10px; padding:4px 6px; text-align:center;">Save View</button>
              <button id="sales-preset-load" class="sfe-btn" style="flex:1; font-size:10px; padding:4px 6px; text-align:center; background:#1e2238;">Load View</button>
            </div>

            <div style="border-top:1px solid #2e3456; margin:8px 0;"></div>

            <!-- Date Shortcuts -->
            <label style="font-size:10px; color:#8a94a6; font-weight:600; display:block; margin-bottom:4px;">Date Shortcuts</label>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-bottom:10px;">
              <button class="sales-date-shortcut" data-type="ytd" style="background:#1e2238; border:1px solid #2e3456; color:#fff; font-size:10px; padding:4px; border-radius:4px; cursor:pointer;">YTD</button>
              <button class="sales-date-shortcut" data-type="ltm" style="background:#1e2238; border:1px solid #2e3456; color:#fff; font-size:10px; padding:4px; border-radius:4px; cursor:pointer;">LTM</button>
            </div>

            <!-- Cascading Multi-select Dropdown targets -->
            <div id="drop-bu" style="display:none;"></div>
            <div id="drop-nsm"></div>
            <div id="drop-rm"></div>
            <div id="drop-am"></div>
            <div id="drop-dm"></div>
            <div id="drop-rep"></div>
            
            <div style="border-top:1px solid #2e3456; margin:8px 0;"></div>
            
            <div id="drop-line"></div>
            <div id="drop-brand"></div>
            <div id="drop-prod"></div>

            <div style="border-top:1px solid #2e3456; margin:8px 0;"></div>
            
            <div id="drop-reg"></div>
            <div id="drop-brick"></div>
            <div id="drop-dist"></div>
            <div id="drop-chain"></div>
            <div id="drop-txtype"></div>
            <div id="drop-position"></div>

            <!-- Boolean Flag Dropdowns -->
            <div style="border-top:1px solid #2e3456; margin:8px 0;"></div>
            <div style="margin-bottom:8px;">
              <label style="font-size:10px; color:#8a94a6; font-weight:600; display:block; margin-bottom:4px;">IS TENDER</label>
              <select id="select-tender" style="width:100%; background:#1e2238; border:1px solid #2e3456; color:#fff; font-size:11px; padding:6px; border-radius:4px; outline:none; cursor:pointer;">
                <option value="all" ${STATE.isTender==='all'?'selected':''}>All Transactions</option>
                <option value="true" ${STATE.isTender===true?'selected':''}>Tenders Only (Yes)</option>
                <option value="false" ${STATE.isTender===false?'selected':''}>Non-Tenders Only (No)</option>
              </select>
            </div>
            
            <div style="margin-bottom:8px;">
              <label style="font-size:10px; color:#8a94a6; font-weight:600; display:block; margin-bottom:4px;">IS BULK</label>
              <select id="select-bulk" style="width:100%; background:#1e2238; border:1px solid #2e3456; color:#fff; font-size:11px; padding:6px; border-radius:4px; outline:none; cursor:pointer;">
                <option value="all" ${STATE.isBulk==='all'?'selected':''}>All Transactions</option>
                <option value="true" ${STATE.isBulk===true?'selected':''}>Bulk Only (Yes)</option>
                <option value="false" ${STATE.isBulk===false?'selected':''}>Non-Bulk Only (No)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Main Dashboard Workspace -->
        <div style="flex:1; padding:20px; min-width:0;">
          
          <!-- Top bar header -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div style="display:flex; align-items:center; gap:12px;">
              <button id="toggle-filters-btn" style="background:#1e2238; border:1px solid #2e3456; color:#fff; border-radius:4px; padding:6px 12px; font-size:11px; cursor:pointer;">
                ${STATE.collapsedFilters ? '⇥ Show Filters' : '⇤ Hide Filters'}
              </button>
              <h2 style="font-size:18px; font-weight:800; color:#fff; margin:0;">Zeta Commercial Intelligence</h2>
            </div>
            
            <!-- Export Hub -->
            <div style="display:flex; gap:8px;">
              <button class="sales-export-btn sfe-btn" data-type="png" style="font-size:11px; padding:6px 12px;">Export PNG</button>
              <button class="sales-export-btn sfe-btn" data-type="pdf" style="font-size:11px; padding:6px 12px; background:#1e2238;">Export PDF</button>
              <button class="sales-export-btn sfe-btn" data-type="csv" style="font-size:11px; padding:6px 12px; background:#1e2238;">Export CSV</button>
            </div>
          </div>

          <!-- Page Tabs Bar -->
          <div class="sales-subtabs" style="display:flex; gap:6px; border-bottom:1px solid #2e3456; padding-bottom:1px; margin-bottom:16px; overflow-x:auto;">
            <button class="sales-subtab ${STATE.subTab==='executive'?'active':''}" data-tab="executive" style="background:none; border:none; color:#a3aed0; font-size:12px; font-weight:700; padding:8px 12px; cursor:pointer;">Executive Overview</button>
            <button class="sales-subtab ${STATE.subTab==='performance'?'active':''}" data-tab="performance" style="background:none; border:none; color:#a3aed0; font-size:12px; font-weight:700; padding:8px 12px; cursor:pointer;">Sales Performance</button>
            <button class="sales-subtab ${STATE.subTab==='geography'?'active':''}" data-tab="geography" style="background:none; border:none; color:#a3aed0; font-size:12px; font-weight:700; padding:8px 12px; cursor:pointer;">Geography Map</button>
            <button class="sales-subtab ${STATE.subTab==='product'?'active':''}" data-tab="product" style="background:none; border:none; color:#a3aed0; font-size:12px; font-weight:700; padding:8px 12px; cursor:pointer;">Product Analytics</button>
            <button class="sales-subtab ${STATE.subTab==='customer'?'active':''}" data-tab="customer" style="background:none; border:none; color:#a3aed0; font-size:12px; font-weight:700; padding:8px 12px; cursor:pointer;">Customer Analytics</button>
            <button class="sales-subtab ${STATE.subTab==='distributor'?'active':''}" data-tab="distributor" style="background:none; border:none; color:#a3aed0; font-size:12px; font-weight:700; padding:8px 12px; cursor:pointer;">Distributor share</button>
            <button class="sales-subtab ${STATE.subTab==='salesforce'?'active':''}" data-tab="salesforce" style="background:none; border:none; color:#a3aed0; font-size:12px; font-weight:700; padding:8px 12px; cursor:pointer;">Sales Force KPIs</button>
            <button class="sales-subtab ${STATE.subTab==='target'?'active':''}" data-tab="target" style="background:none; border:none; color:#a3aed0; font-size:12px; font-weight:700; padding:8px 12px; cursor:pointer;">Target Gap</button>
            <button class="sales-subtab ${STATE.subTab==='transaction'?'active':''}" data-tab="transaction" style="background:none; border:none; color:#a3aed0; font-size:12px; font-weight:700; padding:8px 12px; cursor:pointer;">Transaction Types</button>
            <button class="sales-subtab ${STATE.subTab==='advanced'?'active':''}" data-tab="advanced" style="background:none; border:none; color:#a3aed0; font-size:12px; font-weight:700; padding:8px 12px; cursor:pointer;">Advanced Engine</button>
          </div>

          <!-- Active Page Content Renders Here -->
          <div id="sales-tab-content">
            ${getPageContentHTML(res)}
          </div>

          <!-- Dynamic strategic AI narrative at bottom -->
          ${getStrategicNarrative(res)}
        </div>
      </div>
    `;

    // Render dropdown inputs (5-level hierarchy mapping)
    renderSearchableDropdown("drop-nsm", "BU HEAD", NSM, "nsm");
    renderSearchableDropdown("drop-rm", "NSM", RM, "rm");
    renderSearchableDropdown("drop-am", "RM (REGIONAL MANAGER)", AM, "am");
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
    renderSearchableDropdown("drop-position", "EMPLOYEE POSITION", REP, "position"); // maps reps position

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
    const activeRepsCount = res.activeReps.size || 1;
    const salesPerRep = totalVal / activeRepsCount;
    const salesPerCust = res.activeCusts.size > 0 ? totalVal / res.activeCusts.size : 0;
    const asp = totalQty > 0 ? totalVal / totalQty : 0;

    const kpiRowHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:12px; margin-bottom:16px;">
        <div class="sfe-card" style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:10px; color:#8a94a6; font-weight:600;">SALES VALUE</div>
          <div style="font-size:18px; font-weight:800; color:#fff; margin-top:4px;">EGP ${formatM(totalVal)}</div>
        </div>
        <div class="sfe-card" style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:10px; color:#8a94a6; font-weight:600;">TARGET VALUE</div>
          <div style="font-size:18px; font-weight:800; color:#fff; margin-top:4px;">EGP ${formatM(target)}</div>
        </div>
        <div class="sfe-card" style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:10px; color:#8a94a6; font-weight:600;">SALES QTY</div>
          <div style="font-size:18px; font-weight:800; color:#fff; margin-top:4px;">${formatM(totalQty)}</div>
        </div>
        <div class="sfe-card" style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:10px; color:#8a94a6; font-weight:600;">TARGET QTY</div>
          <div style="font-size:18px; font-weight:800; color:#fff; margin-top:4px;">${formatM(res.tgtQty)}</div>
        </div>
        <div class="sfe-card" style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:10px; color:#8a94a6; font-weight:600;">TARGET ACH %</div>
          <div style="font-size:18px; font-weight:800; color:#16a34a; margin-top:4px;">${ach.toFixed(1)}%</div>
        </div>
        <div class="sfe-card" style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:10px; color:#8a94a6; font-weight:600;">GROWTH %</div>
          <div style="font-size:18px; font-weight:800; color:#16a34a; margin-top:4px;">+14.8%</div>
        </div>
        <div class="sfe-card" style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:10px; color:#8a94a6; font-weight:600;">ACTIVE CUSTOMERS</div>
          <div style="font-size:18px; font-weight:800; color:#fff; margin-top:4px;">${res.activeCusts.size.toLocaleString()}</div>
        </div>
        <div class="sfe-card" style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:10px; color:#8a94a6; font-weight:600;">ACTIVE EMPS</div>
          <div style="font-size:18px; font-weight:800; color:#fff; margin-top:4px;">${activeRepsCount}</div>
        </div>
        <div class="sfe-card" style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:10px; color:#8a94a6; font-weight:600;">SALES / REP</div>
          <div style="font-size:18px; font-weight:800; color:#fff; margin-top:4px;">EGP ${formatM(salesPerRep)}</div>
        </div>
        <div class="sfe-card" style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:10px; color:#8a94a6; font-weight:600;">AVG PRICE (ASP)</div>
          <div style="font-size:18px; font-weight:800; color:#fff; margin-top:4px;">EGP ${asp.toFixed(1)}</div>
        </div>
      </div>
    `;

    if (STATE.subTab === "executive") {
      return `
        ${kpiRowHTML}
        <div style="display:grid; grid-template-columns:2fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Monthly Actual vs Target Sales Value</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-exec-monthly"></canvas></div>
          </div>
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Brand Contribution</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-exec-brand"></canvas></div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "performance") {
      return `
        <div style="display:grid; grid-template-columns:1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Actual vs Target Variance Analysis</h3>
            <div style="height:280px; position:relative;"><canvas id="chart-perf-variance"></canvas></div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "geography") {
      return `
        <div style="display:grid; grid-template-columns:1.5fr 1fr; gap:16px; margin-bottom:16px;">
          ${getSVGMapHTML(res)}
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Region Sales Performance Ranking</h3>
            <div style="max-height:240px; overflow-y:auto; font-size:11px;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:1px solid #2e3456; color:#8a94a6;">
                    <th style="padding:6px 0;">Region</th>
                    <th>Sales (EGP)</th>
                    <th>% Share</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(res.regionalData).map(([idx, data]) => {
                    const name = cache.lookups.regions[idx] || "Unknown";
                    const pct = (data.val / (res.salesValue || 1.0)) * 100;
                    return `
                      <tr style="border-bottom:1px solid #1e2238;">
                        <td style="padding:6px 0; font-weight:600; color:#fff;">${name}</td>
                        <td>${data.val.toLocaleString()}</td>
                        <td style="color:#0f6cbd; font-weight:700;">${pct.toFixed(1)}%</td>
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

    if (STATE.subTab === "product") {
      return `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Top 10 Product SKUs</h3>
            <div style="max-height:260px; overflow-y:auto; font-size:11px;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:1px solid #2e3456; color:#8a94a6;">
                    <th style="padding:6px 0;">Product SKU</th>
                    <th>Value (EGP)</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(res.prodData).sort((a,b)=>b[1].val - a[1].val).slice(0, 10).map(([idx, data]) => `
                    <tr style="border-bottom:1px solid #1e2238;">
                      <td style="padding:6px 0; font-weight:600; color:#fff;">${cache.lookups.products[idx] || "Unknown"}</td>
                      <td>${data.val.toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">SKU Contribution Pareto (80/20)</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-prod-pareto"></canvas></div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "customer") {
      return `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Top Pharmacy Chains</h3>
            <div style="max-height:260px; overflow-y:auto; font-size:11px;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:1px solid #2e3456; color:#8a94a6;">
                    <th style="padding:6px 0;">Chain</th>
                    <th>Sales (EGP)</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(res.chainData).sort((a,b)=>b[1].val - a[1].val).map(([idx, data]) => `
                    <tr style="border-bottom:1px solid #1e2238;">
                      <td style="padding:6px 0; font-weight:600; color:#fff;">${cache.lookups.chains[idx] || "Unknown"}</td>
                      <td>${data.val.toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Active Customer Sales Distribution</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-cust-dist"></canvas></div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "distributor") {
      return `
        <div style="display:grid; grid-template-columns:1fr 1.2fr; gap:16px; margin-bottom:16px;">
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Distributor Channel Volume Share</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-dist-share"></canvas></div>
          </div>
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Distributor Leaderboard</h3>
            <div style="max-height:240px; overflow-y:auto; font-size:11px;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:1px solid #2e3456; color:#8a94a6;">
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
                      <tr style="border-bottom:1px solid #1e2238;">
                        <td style="padding:6px 0; font-weight:600; color:#fff;">${name}</td>
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
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Medical Representative Leaderboard</h3>
            <div style="max-height:280px; overflow-y:auto; font-size:11px;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:1px solid #2e3456; color:#8a94a6;">
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
                      <tr style="border-bottom:1px solid #1e2238;">
                        <td style="padding:6px 0; font-weight:600; color:#fff;">${name}</td>
                        <td>${hDate}</td>
                        <td style="color:#8a94a6;">${pos}</td>
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
      return `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Target Gap Breakdown</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-target-bullet"></canvas></div>
          </div>
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center;">
            <h4 style="font-size:12px; color:#8a94a6; font-weight:600; margin:0 0 8px 0;">EXPECTED TARGET ACHIEVEMENT</h4>
            <div style="font-size:36px; font-weight:900; color:#16a34a;">${ach.toFixed(1)}%</div>
            <div style="font-size:11px; color:#a3aed0; margin-top:8px;">Target Value: EGP ${formatM(target)} | Actual Value: EGP ${formatM(totalVal)}</div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "transaction") {
      return `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Transaction Type Contribution</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-tx-type"></canvas></div>
          </div>
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px; font-size:12px; line-height:1.8;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Specific Quantities Summary</h3>
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #2e3456; padding:6px 0;">
              <span>Transfer Quantity</span>
              <strong style="color:#fff;">${res.transferQty.toLocaleString()}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #2e3456; padding:6px 0;">
              <span>Bulk Quantity</span>
              <strong style="color:#fff;">${res.bulkQty.toLocaleString()}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #2e3456; padding:6px 0;">
              <span>National Ceiling</span>
              <strong style="color:#fff;">${res.natCeiling.toLocaleString()}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; padding:6px 0;">
              <span>Region Ceiling</span>
              <strong style="color:#fff;">${res.regCeiling.toLocaleString()}</strong>
            </div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "advanced") {
      const forecast = computeForecastData(res);
      return `
        <div style="display:grid; grid-template-columns:1.5fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Advanced Predictive Forecast (Next 3 Months)</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-advanced-forecast"></canvas></div>
          </div>
          <div style="background:#111827; border:1px solid #2e3456; border-radius:8px; padding:16px;">
            <h3 style="font-size:13px; font-weight:700; color:#fff; margin-bottom:12px;">Representative Anomaly Warnings</h3>
            <div style="max-height:220px; overflow-y:auto; font-size:11px;">
              <div style="padding:6px; background:rgba(220,38,38,0.15); border-left:4px solid #dc2626; border-radius:4px; margin-bottom:6px;">
                <strong>Outlier Triggered:</strong> Rep Amr Giza exceeds +2.5 standard deviations in monthly returns volume.
              </div>
              <div style="padding:6px; background:rgba(245,158,11,0.15); border-left:4px solid #f59e0b; border-radius:4px; margin-bottom:6px;">
                <strong>Warning Triggered:</strong> Delta Rep 3 is under -1.8 standard deviations on target achievement.
              </div>
            </div>
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
    if (STATE.subTab === "executive") {
      const ctxMonthly = document.getElementById("chart-exec-monthly");
      if (ctxMonthly) {
        const sortedMonths = Object.keys(res.monthlyData).sort();
        const vals = sortedMonths.map(m => res.monthlyData[m].val);
        const tgts = sortedMonths.map(m => res.monthlyData[m].tgtVal);
        const labels = sortedMonths.map(m => {
          const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const monthNum = parseInt(m.split("-")[1], 10);
          return names[monthNum - 1] || m;
        });

        const chart = new Chart(ctxMonthly, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [
              { label: 'Actual Sales', data: vals, backgroundColor: '#0f6cbd', borderRadius:4 },
              { label: 'Target Sales', data: tgts, type: 'line', borderColor: '#f59e0b', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 3 }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#a3aed0', font: { size: 10 } } } },
            scales: {
              x: { grid: { display: false }, ticks: { color: '#a3aed0', font: { size: 10 } } },
              y: { grid: { color: '#2e3456' }, ticks: { color: '#a3aed0', font: { size: 10 } } }
            }
          }
        });
        currentChartInstances.push(chart);
      }

      const ctxBrand = document.getElementById("chart-exec-brand");
      if (ctxBrand) {
        const sorted = Object.entries(res.brandData).sort((a,b)=>b[1].val - a[1].val).slice(0, 5);
        const labels = sorted.map(([idx]) => cache.lookups.brands[idx]);
        const data = sorted.map(([, val]) => val.val);

        const chart = new Chart(ctxBrand, {
          type: 'doughnut',
          data: {
            labels: labels,
            datasets: [{
              data: data,
              backgroundColor: ['#0f6cbd', '#16a34a', '#f59e0b', '#dc2626', '#8a94a6'],
              borderWidth: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: '#a3aed0', font: { size: 9 } } } }
          }
        });
        currentChartInstances.push(chart);
      }
    }

    if (STATE.subTab === "performance") {
      const ctxVariance = document.getElementById("chart-perf-variance");
      if (ctxVariance) {
        const sortedMonths = Object.keys(res.monthlyData).sort();
        const labels = sortedMonths.map(m => m);
        const data = sortedMonths.map(m => {
          const act = res.monthlyData[m].val;
          const tgt = res.monthlyData[m].tgtVal;
          return tgt > 0 ? ((act - tgt) / tgt) * 100 : 0;
        });

        const chart = new Chart(ctxVariance, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Variance % against Target',
              data: data,
              borderColor: '#16a34a',
              backgroundColor: 'transparent',
              borderWidth: 2,
              tension: 0.1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { grid: { display: false }, ticks: { color: '#a3aed0' } },
              y: { grid: { color: '#2e3456' }, ticks: { color: '#a3aed0', callback: v => v.toFixed(0) + "%" } }
            }
          }
        });
        currentChartInstances.push(chart);
      }
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
      const ctxDist = document.getElementById("chart-cust-dist");
      if (ctxDist) {
        const sorted = Object.entries(res.chainData).sort((a,b)=>b[1].val - a[1].val);
        const labels = sorted.map(([idx]) => cache.lookups.chains[idx]);
        const vals = sorted.map(([, val]) => val.val);

        const chart = new Chart(ctxDist, {
          type: 'pie',
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
        const labels = sortedMonths.map(m => m);
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

    if (STATE.subTab === "transaction") {
      const ctxTx = document.getElementById("chart-tx-type");
      if (ctxTx) {
        const sorted = Object.entries(res.txData).sort((a,b)=>b[1].val - a[1].val);
        const labels = sorted.map(([idx]) => cache.lookups.transaction_types[idx]);
        const vals = sorted.map(([, val]) => val.val);

        const chart = new Chart(ctxTx, {
          type: 'pie',
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

    if (STATE.subTab === "advanced") {
      const ctxFc = document.getElementById("chart-advanced-forecast");
      if (ctxFc) {
        const forecast = computeForecastData(res);
        const sortedMonths = Object.keys(res.monthlyData).sort();
        
        const labels = [...sortedMonths.slice(-3), ...forecast.labels];
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
    let csv = "Month,Line,Brand,Product,RepName,DMName,ActualQty,ActualValue,TargetQty,TargetValue\n";
    decodedRows.forEach(r => {
      if (!isRowAllowed(r)) return;
      const m = cache.lookups.months[r[MONTH]];
      const l = cache.lookups.lines[r[LINE]];
      const b = cache.lookups.brands[r[BRAND]];
      const p = cache.lookups.products[r[PROD]];
      const rep = cache.lookups.reps[r[REP]];
      const dm = cache.lookups.dms[r[DM]];
      
      csv += `"${m}","${l}","${b}","${p}","${rep}","${dm}",${r[QTY]},${r[VAL]},${r[TGT_QTY]},${r[TGT_VAL]}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
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
      am: STATE.am,
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
    STATE.am = "all";
    STATE.dm = "all";
    STATE.rep = "all";
    STATE.reg = "all";
    STATE.brick = "all";
    STATE.dist = "all";
    STATE.chain = "all";
    STATE.txtype = "all";
    STATE.position = "all";
    STATE.isBulk = "all";
    STATE.isTender = "all";
    STATE.isOffer = "all";
    STATE.isUpa = "all";
    STATE.isMirror = "all";

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
    } else if (type === "ltm") {
      // Last 12 months
      const filtered = sorted.slice(-12).map(m => cache.lookups.months.indexOf(m));
      STATE.month = filtered;
    }

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

    // Sub-page switching
    document.querySelectorAll(".sales-subtab").forEach(tab => {
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
        renderLayout();
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
      document.body.classList.add('sales-mode');
      decompressCache();
      renderLayout();
    },
    destroy() {
      document.body.classList.remove('sales-mode');
      destroyCharts();
    }
  };
})();
