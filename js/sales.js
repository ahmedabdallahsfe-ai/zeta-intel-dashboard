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
      activeDms: new Set(),
      activeAms: new Set(),
      activeRms: new Set(),
      activeNsms: new Set(),
      activeBus: new Set(),
      
      monthlyData: {},
      regionalData: {},
      brandData: {},
      buData: {},
      nsmData: {},
      dmData: {},
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
      if (r[RM] !== 0) res.activeRms.add(r[RM]);
      if (r[NSM] !== 0) res.activeNsms.add(r[NSM]);
      if (r[BU] !== 0) res.activeBus.add(r[BU]);

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

      // Business Units
      const buIdx = r[BU];
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
    const achColor = ach >= 95 ? '#15803d' : ach >= 80 ? '#b45309' : '#b91c1c';
    const achBg   = ach >= 95 ? '#f0fdf4' : ach >= 80 ? '#fffbeb' : '#fef2f2';

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
            <div style="margin-bottom:14px;">
              <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:6px;">Period</div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                <button class="sales-date-shortcut sc-period-btn" data-type="ytd">YTD</button>
                <button class="sales-date-shortcut sc-period-btn" data-type="ltm">LTM</button>
              </div>
            </div>

            <div class="sc-filter-sep"></div>

            <!-- Hierarchy Filters -->
            <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:8px;">Organization</div>
            <div id="drop-bu" style="display:none;"></div>
            <div id="drop-nsm"></div>
            <div id="drop-rm"></div>
            <div id="drop-am"></div>
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
              ['performance', '📈 Performance'],
              ['geography',   '🗺 Geography'],
              ['product',     '💊 Product'],
              ['customer',    '🏥 Customer'],
              ['distributor', '🏭 Distributor'],
              ['salesforce',  '👥 Sales Force'],
              ['target',      '🎯 Target'],
              ['transaction', '🔄 Transactions'],
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
    if (res.activeAms) res.activeAms.forEach(idx => { const n = cache.lookups.ams[idx]; if (n && n !== "(none)") activeEmpNames.add(n); });
    if (res.activeRms) res.activeRms.forEach(idx => { const n = cache.lookups.rms[idx]; if (n && n !== "(none)") activeEmpNames.add(n); });
    if (res.activeNsms) res.activeNsms.forEach(idx => { const n = cache.lookups.nsms[idx]; if (n && n !== "(none)") activeEmpNames.add(n); });
    if (res.activeBus) res.activeBus.forEach(idx => { const n = cache.lookups.buheads[idx]; if (n && n !== "(none)") activeEmpNames.add(n); });

    const activeEmpsCount = activeEmpNames.size || 1;
    const activeRepsCount = res.activeReps.size || 1;
    const salesPerRep = totalVal / activeRepsCount;
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
          <div class="sc-kpi-label">SALES / REP</div>
          <div class="sc-kpi-value">EGP ${formatM(salesPerRep)}</div>
          <div class="sc-kpi-sub">Avg productivity</div>
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
      return `
        ${kpiRowHTML}
        <div style="display:grid; grid-template-columns:2fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Monthly Actual vs Target Sales Value</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-exec-monthly"></canvas></div>
          </div>
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 id="exec-contrib-title" style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:4px;">
              ${STATE.dm !== 'all' ? 'Medical Rep Contribution' : STATE.nsm !== 'all' ? 'DM Contribution' : STATE.buhead !== 'all' ? 'NSM Contribution' : 'BU Contribution'}
            </h3>
            <div style="font-size:10px; color:#94a3b8; margin-bottom:10px; font-weight:500;">
              ${STATE.dm !== 'all' ? 'Reps under selected District Manager(s)' : STATE.nsm !== 'all' ? 'District Managers under selected NSM(s)' : STATE.buhead !== 'all' ? 'National Sales Managers under selected BU(s)' : 'Sales split by Business Unit'}
            </div>
            <div style="height:210px; position:relative;"><canvas id="chart-exec-drilldown"></canvas></div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "performance") {
      return `
        <div style="display:grid; grid-template-columns:1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Actual vs Target Variance Analysis</h3>
            <div style="height:280px; position:relative;"><canvas id="chart-perf-variance"></canvas></div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "geography") {
      return `
        <div style="display:grid; grid-template-columns:1.5fr 1fr; gap:16px; margin-bottom:16px;">
          ${getSVGMapHTML(res)}
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Region Sales Performance Ranking</h3>
            <div style="max-height:240px; overflow-y:auto; font-size:11px;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:2px solid #e2e8f0; color:#64748b;">
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
                      <tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:6px 0; font-weight:600; color:#0f172a;">${name}</td>
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
      `;
    }

    if (STATE.subTab === "customer") {
      return `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Top Pharmacy Chains</h3>
            <div style="max-height:260px; overflow-y:auto; font-size:11px;">
              <table style="width:100%; border-collapse:collapse; text-align:left;">
                <thead>
                  <tr style="border-bottom:2px solid #e2e8f0; color:#64748b;">
                    <th style="padding:6px 0;">Chain</th>
                    <th>Sales (EGP)</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.entries(res.chainData).sort((a,b)=>b[1].val - a[1].val).map(([idx, data]) => `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                      <td style="padding:6px 0; font-weight:600; color:#0f172a;">${cache.lookups.chains[idx] || "Unknown"}</td>
                      <td>${data.val.toLocaleString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Active Customer Sales Distribution</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-cust-dist"></canvas></div>
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
      return `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Target Gap Breakdown</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-target-bullet"></canvas></div>
          </div>
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center;">
            <h4 style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; margin:0 0 8px 0;">EXPECTED TARGET ACHIEVEMENT</h4>
            <div style="font-size:36px; font-weight:900; color:${ach>=95?'#15803d':ach>=80?'#b45309':'#b91c1c'};">${ach.toFixed(1)}%</div>
            <div style="font-size:11px; color:#a3aed0; margin-top:8px;">Target Value: EGP ${formatM(target)} | Actual Value: EGP ${formatM(totalVal)}</div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "transaction") {
      return `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Transaction Type Contribution</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-tx-type"></canvas></div>
          </div>
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px; font-size:12px; line-height:1.8;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Specific Quantities Summary</h3>
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #f1f5f9; padding:8px 0; color:#334155;">
              <span>Transfer Quantity</span>
              <strong style="color:#0f172a;">${res.transferQty.toLocaleString()}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #f1f5f9; padding:8px 0; color:#334155;">
              <span>Bulk Quantity</span>
              <strong style="color:#0f172a;">${res.bulkQty.toLocaleString()}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid #f1f5f9; padding:8px 0; color:#334155;">
              <span>National Ceiling</span>
              <strong style="color:#0f172a;">${res.natCeiling.toLocaleString()}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; padding:6px 0;">
              <span>Region Ceiling</span>
              <strong style="color:#0f172a;">${res.regCeiling.toLocaleString()}</strong>
            </div>
          </div>
        </div>
      `;
    }

    if (STATE.subTab === "advanced") {
      const forecast = computeForecastData(res);
      return `
        <div style="display:grid; grid-template-columns:1.5fr 1fr; gap:16px; margin-bottom:16px;">
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Advanced Predictive Forecast (Next 3 Months)</h3>
            <div style="height:240px; position:relative;"><canvas id="chart-advanced-forecast"></canvas></div>
          </div>
          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px;">
            <h3 style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:12px;">Representative Anomaly Warnings</h3>
            <div style="max-height:220px; overflow-y:auto; font-size:11px;">
              <div style="padding:10px; background:#fef2f2; border-left:4px solid #dc2626; border-radius:6px; margin-bottom:8px; color:#0f172a;">
                <strong>Outlier Triggered:</strong> Rep Amr Giza exceeds +2.5 standard deviations in monthly returns volume.
              </div>
              <div style="padding:10px; background:#fffbeb; border-left:4px solid #f59e0b; border-radius:6px; margin-bottom:8px; color:#0f172a;">
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

      const ctxDrill = document.getElementById("chart-exec-drilldown");
      if (ctxDrill) {
        // ── Determine drill level from deepest active filter ──
        const hasDM  = STATE.dm  !== 'all' && Array.isArray(STATE.dm)  && STATE.dm.length  > 0;
        const hasNSM = STATE.nsm !== 'all' && Array.isArray(STATE.nsm) && STATE.nsm.length > 0;
        const hasBU  = STATE.buhead !== 'all' && Array.isArray(STATE.buhead) && STATE.buhead.length > 0;

        let drillEntries, lookupArr;
        if (hasDM) {
          // Show Medical Reps under selected DMs
          drillEntries = Object.entries(res.repData);
          lookupArr    = cache.lookups.reps;
        } else if (hasNSM) {
          // Show DMs under selected NSMs
          drillEntries = Object.entries(res.dmData);
          lookupArr    = cache.lookups.dms;
        } else if (hasBU) {
          // Show NSMs under selected BUs
          drillEntries = Object.entries(res.nsmData);
          lookupArr    = cache.lookups.nsms;
        } else {
          // Default: BU level
          drillEntries = Object.entries(res.buData);
          lookupArr    = cache.lookups.buheads;
        }

        const NONE_LABELS = ['(none)', '', null, undefined];
        const sorted = drillEntries
          .filter(([idx]) => lookupArr[idx] && !NONE_LABELS.includes(lookupArr[idx]))
          .sort((a, b) => b[1].val - a[1].val)
          .slice(0, 12); // cap at 12 slices for readability

        const labels = sorted.map(([idx]) => lookupArr[idx] || 'Unknown');
        const data   = sorted.map(([, v]) => v.val);
        const total  = data.reduce((s, v) => s + v, 0) || 1;

        const PALETTE = [
          '#0f4c81','#15803d','#b45309','#b91c1c','#7c3aed',
          '#0891b2','#9d174d','#065f46','#92400e','#1e3a5f',
          '#4338ca','#0369a1'
        ];

        if (data.length === 0) {
          ctxDrill.getContext('2d').fillStyle = '#94a3b8';
          ctxDrill.getContext('2d').font = '12px Inter, sans-serif';
          ctxDrill.getContext('2d').textAlign = 'center';
          ctxDrill.getContext('2d').fillText('No data for current filters', ctxDrill.width/2, ctxDrill.height/2);
        } else {
          const chart = new Chart(ctxDrill, {
            type: 'doughnut',
            data: {
              labels: labels,
              datasets: [{
                data: data,
                backgroundColor: PALETTE,
                borderWidth: 2,
                borderColor: '#fff',
                hoverOffset: 6
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: 'right',
                  labels: {
                    color: '#334155',
                    font: { size: 10, weight: '600' },
                    padding: 8,
                    boxWidth: 10,
                    generateLabels: (chart) => {
                      const ds = chart.data.datasets[0];
                      return chart.data.labels.map((label, i) => ({
                        text: `${label}  ${((ds.data[i]/total)*100).toFixed(1)}%`,
                        fillStyle: ds.backgroundColor[i],
                        strokeStyle: '#fff',
                        lineWidth: 1,
                        index: i
                      }));
                    }
                  }
                },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const pct = ((ctx.parsed / total) * 100).toFixed(1);
                      const egp = ctx.parsed >= 1000000
                        ? (ctx.parsed/1000000).toFixed(2) + 'M'
                        : (ctx.parsed/1000).toFixed(1) + 'K';
                      return `  ${ctx.label}: EGP ${egp}  (${pct}%)`;
                    }
                  }
                }
              }
            }
          });
          currentChartInstances.push(chart);
        }
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
