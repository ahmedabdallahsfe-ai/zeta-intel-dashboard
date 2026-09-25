/* ==========================================================================
 * js/list-intel.js — "List Intelligence" tab (2026-09-25, Phase 2)
 * --------------------------------------------------------------------------
 * CRM customer lists vs Promo Grid targets, per Line / Plan / Representative.
 *
 * DATA: cache/list_intel.data.js (window.LIST_INTEL_CACHE, gzip+base64) built by
 * etl/build_list_intel_cache.py; loaded lazily by js/cache-loader.js only when
 * the tab is opened. Parity with the original standalone page is proven by
 * etl/validate_list_intel_baseline.py (logs/list_intel_parity.md).
 *
 * LOGIC: the calculation code below (repMetrics, aggregateLines, scopes, views,
 * exports) is carried over VERBATIM from the standalone page
 * "List Intell/field_force_dashboard (9).html" so every number is identical.
 * Deliberate changes only:
 *   - element ids prefixed li_, colliding classes renamed (pill/num/table-scroll/
 *     two-col -> li-*), all CSS scoped under .li-root (css/list-intel.css);
 *   - customer rows carry no street address (privacy decision 2026-09-25);
 *   - capacity = CRM call rate x 20 (PM) / x 22 (AM) — confirmed standard; the
 *     CRM export's x20 figures stay visible as reference;
 *   - Data Quality counts are computed live (the standalone page had them typed);
 *   - Overview adds line capacity cards: in-post reps vs vacancies vs Planned MR;
 *   - downloads use a plain browser download (no Claude-artifact capability);
 *   - tooltips react only to this page's own [data-tip] elements.
 * ACCESS (Phase 3, 2026-09-25): AUTH.listIntelScope() (js/auth.js). All-lines
 * roles get everything; a Line Manager gets ONLY reps whose original CRM line is
 * in their entitlement — applied by applyScope() right after decoding and BEFORE
 * anything renders, so every view, count, card and export sees the same subset.
 * ========================================================================== */
(function () {
'use strict';

let REPS = [], CUSTOMERS = {}, PROMO_TARGETS = {}, META = {};
let WD_RULE = { PM: 20, AM: 22 };
let _loaded = false;
let RAW = null;          // full decoded cache, never rendered directly
let SCOPE = null;        // { all:true } | { all:false, lines:[...] }
let _scopeKey = null;

function gunzipB64Json(b64) {
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return JSON.parse(pako.ungzip(bytes, { to: 'string' }));
}

function loadCache() {
  if (_loaded) return true;
  if (!window.LIST_INTEL_CACHE || !window.LIST_INTEL_CACHE.b64Data || typeof pako === 'undefined') return false;
  try {
    RAW = gunzipB64Json(window.LIST_INTEL_CACHE.b64Data);
    META = RAW.meta || {};
    if (META.rules && META.rules.crmWorkingDays) WD_RULE = META.rules.crmWorkingDays;
    _loaded = true;
    return true;
  } catch (e) {
    console.error('[ListIntel] failed to decode cache/list_intel.data.js', e);
    return false;
  }
}

function canViewPage() {
  return !!(window.AUTH && typeof window.AUTH.canViewListIntel === 'function' && window.AUTH.canViewListIntel());
}

function currentScope() {
  return (window.AUTH && typeof window.AUTH.listIntelScope === 'function') ? window.AUTH.listIntelScope() : null;
}

/* Row-level entitlement. Line Managers keep only reps whose ORIGINAL CRM line
   (origLine, upper-cased) is entitled — so a CHC-only login never sees the
   CHC_Sales reps that are merged into CHC for reporting. Customers and promo
   grids follow the kept reps. Re-applied whenever the signed-in scope changes. */
function applyScope(scope) {
  const key = JSON.stringify(scope);
  if (key === _scopeKey) return;
  _scopeKey = key;
  SCOPE = scope;
  if (!scope || scope.all) {
    REPS = RAW.reps || [];
    CUSTOMERS = RAW.customers || {};
    PROMO_TARGETS = RAW.promoTargets || {};
  } else {
    const allowed = new Set(scope.lines.map(l => String(l).toUpperCase()));
    REPS = (RAW.reps || []).filter(r => allowed.has(String(r.origLine || r.line).toUpperCase()));
    const emps = new Set(REPS.map(r => r.employee));
    CUSTOMERS = {};
    for (const e in (RAW.customers || {})) if (emps.has(e)) CUSTOMERS[e] = RAW.customers[e];
    const lines = new Set(REPS.map(r => r.line));
    PROMO_TARGETS = {};
    for (const l in (RAW.promoTargets || {})) if (lines.has(l)) PROMO_TARGETS[l] = RAW.promoTargets[l];
  }
  // a different scope must never inherit filters/drill-downs pointing outside it
  STATE.tab = 'overview';
  STATE.filters = { bu:'', line:'', plan:'', area:'', manager:'', repSearch:'', activeVacant:'all', deviationView:'all', specialty:'', cls:'' };
  STATE.selectedLine = null; STATE.expandedRepKey = null; STATE.custPage = 0; STATE.aqPage = 0; STATE.qaLine = null;
}

/* ---- live Data Quality statistics (replaces the standalone page's typed-in counts) ---- */
function computeDataQualityStats() {
  let custRows = 0, dupRows = 0, blankSpec = 0, blankClinic = 0;
  for (const emp in CUSTOMERS) {
    const seen = new Set();
    for (const c of CUSTOMERS[emp]) {
      custRows++;
      const k = (c[0] || '') + '\u0001' + (c[1] || '');
      if (seen.has(k)) dupRows++; else seen.add(k);
      if (c[2] === null || c[2] === undefined || String(c[2]).trim() === '') blankSpec++;
      if (c[6] === null || c[6] === undefined || String(c[6]).trim() === '') blankClinic++;
    }
  }
  const remapped = REPS.filter(r => r.lineRemapped);
  const fractional = [];
  for (const line in PROMO_TARGETS) for (const plan of ['PM', 'AM']) {
    const e = PROMO_TARGETS[line][plan];
    if (!e || !e.classesTarget) continue;
    for (const k of CLASS_KEYS) {
      const v = e.classesTarget[k];
      if (typeof v === 'number' && v !== Math.round(v)) fractional.push(line + ' ' + plan + ' ' + k + ' (' + v + ')');
    }
  }
  return { custRows, dupRows, blankSpec, blankClinic,
    remapTerr: remapped.length, remapVacant: remapped.filter(r => r.vacant).length, fractional };
}

/* ---- Overview: in-post reps vs vacancies vs Planned MR, per line ---- */
function renderLineCapacityCards(scope) {
  const byLine = {};
  for (const r of scope) {
    const g = byLine[r.line] || (byLine[r.line] = { line: r.line, bu: r.bu, planned: r.plannedMR || 0, active: new Set(), vac: { PM: 0, AM: 0 }, remap: new Set() });
    if (r.vacant) g.vac[r.plan]++; else g.active.add(r.employee);
    if (r.lineRemapped && !r.vacant) g.remap.add(r.employee);
  }
  const cards = Object.values(byLine).sort((a, b) => a.bu.localeCompare(b.bu) || a.line.localeCompare(b.line));
  if (!cards.length) return '';
  let tp = 0, ti = 0, tv = 0;
  const html = cards.map(g => {
    const inPost = g.active.size;
    const vacant = STATE.filters.plan ? g.vac[STATE.filters.plan] : Math.max(g.vac.PM, g.vac.AM);
    const gap = Math.max(g.planned - inPost, 0);
    const pct = g.planned ? Math.min(100, Math.round(100 * inPost / g.planned)) : 0;
    tp += g.planned; ti += inPost; tv += vacant;
    const tone = pct >= 95 ? 'good' : (pct >= 85 ? 'mid' : 'low');
    const tip = g.remap.size ? ` data-tip="In post includes ${g.remap.size} CHC_Sales rep${g.remap.size === 1 ? '' : 's'} merged into CHC (unified line reporting). Target stays on CHC's Planned MR."` : '';
    return `<button type="button" class="li-cap-card" data-capline="${esc(g.line)}"${tip} aria-label="Show ${esc(g.line)} only">
      <div class="li-cap-top"><span class="li-cap-line">${esc(g.line)}</span><span class="li-cap-bu">${esc(g.bu)}</span></div>
      <div class="li-cap-main"><span class="li-cap-big">${fmt(inPost)}</span><span class="li-cap-of">in post / ${fmt(g.planned)} planned</span></div>
      <div class="li-cap-bar"><span class="${tone}" style="width:${pct}%"></span></div>
      <div class="li-cap-foot"><span>${pct}% filled</span><span class="${vacant ? 'warn' : ''}">${fmt(vacant)} vacant</span><span class="${gap ? 'warn' : ''}">gap ${fmt(gap)}</span></div>
    </button>`;
  }).join('');
  return `<div class="kpi-row-label">Line capacity — reps in post vs vacant positions (target stays on Planned MR: ${fmt(tp)} planned · ${fmt(ti)} in post · ${fmt(tv)} vacant positions; click a card to focus that line)</div>
    <div class="li-cap-grid">${html}</div>`;
}

/* ============================================================
   CRM vs Promo Grid Field Force Dashboard
   Data is embedded as REPS, CUSTOMERS, PROMO_TARGETS globals.
   ============================================================ */

const CLASS_KEYS = ['A1','A2','A3','B1','B2','B3','C1','C2','C3'];

function round2(n){ return Math.round(n*100)/100; }
function fmt(n){
  if (n===null || n===undefined || Number.isNaN(n)) return '—';
  const r = Math.round(n*100)/100;
  return r.toLocaleString('en-US', {maximumFractionDigits:2});
}
function fmtSigned(n){
  if (n===null || n===undefined || Number.isNaN(n)) return '—';
  const r = round2(n);
  return (r>0?'+':'') + fmt(r);
}
function esc(s){
  if (s===null||s===undefined) return '';
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------------- core metrics ---------------- */
function repMetrics(rep, toleranceOn){
  const target = rep.target;
  const current = rep.current;
  const rawGap = round2(current - target);
  const lower = round2(target*0.9);
  const upper = round2(target*1.1);
  let deviation, status;
  if (toleranceOn){
    if (current>=lower && current<=upper){ deviation=0; status='WITHIN RANGE'; }
    else if (current<lower){ deviation=round2(current-lower); status='BELOW RANGE'; }
    else { deviation=round2(current-upper); status='ABOVE RANGE'; }
  } else {
    deviation = rawGap;
    status = deviation===0 ? 'WITHIN RANGE' : (deviation<0?'BELOW RANGE':'ABOVE RANGE');
  }
  const displayStatus = rep.vacant ? 'VACANT TERRITORY' : status;
  return {target, current, rawGap, lower, upper, deviation, status, displayStatus};
}

function aggregateLines(scopeReps, toleranceOn){
  const groups = {};
  for (const r of scopeReps){
    const key = r.bu+'|'+r.line+'|'+r.plan;
    if (!groups[key]) groups[key] = {bu:r.bu, line:r.line, plan:r.plan, plannedMR:r.plannedMR, targetPerRep:r.target, reconFlag:r.reconFlag, noSegTarget:r.noSegTarget, reps:[]};
    groups[key].reps.push(r);
  }
  const out = [];
  for (const key in groups){
    const g = groups[key];
    const crmTotal = g.reps.length;
    const vacant = g.reps.filter(r=>r.vacant).length;
    const active = crmTotal - vacant;
    const plannedMR = g.plannedMR || 0;
    const unassignedGap = Math.max(plannedMR - crmTotal, 0);
    const surplus = Math.max(crmTotal - plannedMR, 0);
    const targetPerRep = g.targetPerRep;
    const totalTarget = round2(targetPerRep * plannedMR);
    const current = g.reps.reduce((s,r)=>s+r.current,0);
    const rawGap = round2(current-totalTarget);
    const lower = round2(totalTarget*0.9);
    const upper = round2(totalTarget*1.1);
    let deviation, status;
    if (toleranceOn){
      if (current>=lower && current<=upper){ deviation=0; status='WITHIN RANGE'; }
      else if (current<lower){ deviation=round2(current-lower); status='BELOW RANGE'; }
      else { deviation=round2(current-upper); status='ABOVE RANGE'; }
    } else {
      deviation = rawGap;
      status = deviation===0?'WITHIN RANGE':(deviation<0?'BELOW RANGE':'ABOVE RANGE');
    }
    out.push({bu:g.bu, line:g.line, plan:g.plan, plannedMR, crmTotal, active, vacant,
      unassignedGap, surplus, targetPerRep, totalTarget, current, rawGap, lower, upper,
      deviation, status, reconFlag:g.reconFlag, noSegTarget:g.noSegTarget, reps:g.reps});
  }
  out.sort((a,b)=> a.bu.localeCompare(b.bu) || a.line.localeCompare(b.line) || a.plan.localeCompare(b.plan));
  return out;
}

/* ---------------- global state ---------------- */
const STATE = {
  tab: 'overview', // overview | reps | actionqueue | dataquality
  tolerance: true,
  filters: { bu:'', line:'', plan:'', area:'', manager:'', repSearch:'', activeVacant:'all', deviationView:'all', specialty:'', cls:'' },
  selectedLine: null, // {line, plan} once user drills from overview
  expandedRepKey: null,
  custPage: 0,
  custPageSize: 60,
  custFilters: { type:'', specialty:'', cls:'' },
  qaLine: null,
  aqPage: 0,
};

const PAGE_SIZE_CUST = 60;

/* ---------------- derived data helpers ---------------- */
function distinctSorted(arr){ return Array.from(new Set(arr)).sort((a,b)=>String(a).localeCompare(String(b))); }

function allBUs(){ return distinctSorted(REPS.map(r=>r.bu)); }
function allLines(bu){ return distinctSorted(REPS.filter(r=>!bu||r.bu===bu).map(r=>r.line)); }
function allAreas(f){ return distinctSorted(scopedForAreaManager(f).map(r=>r.area)); }
function allManagers(f){ return distinctSorted(scopedForAreaManager(f).map(r=>r.manager)); }

// Specialty/Class options are drawn from the customer universe of reps in the
// current BU/Line/Plan scope, so the dropdowns only ever offer values that
// actually exist for what's currently selected.
function allSpecialties(f){
  const reps = scopedForAreaManager(f);
  const set = new Set();
  for (const r of reps){ for (const c of custsFor(r)){ if (c[2]) set.add(c[2]); } }
  return distinctSorted([...set]);
}
function allClasses(f){
  const reps = scopedForAreaManager(f);
  const set = new Set();
  for (const r of reps){ for (const c of custsFor(r)){ if (c[3]) set.add(c[3]); } }
  return distinctSorted([...set]);
}

function scopedForAreaManager(f){
  return REPS.filter(r=> (!f.bu||r.bu===f.bu) && (!f.line||r.line===f.line) && (!f.plan||r.plan===f.plan) );
}

function lineScopeReps(f){
  return REPS.filter(r=> (!f.bu||r.bu===f.bu) && (!f.line||r.line===f.line) && (!f.plan||r.plan===f.plan) );
}

function repScopeReps(f, toleranceOn){
  return REPS.filter(r=>{
    if (f.bu && r.bu!==f.bu) return false;
    if (f.line && r.line!==f.line) return false;
    if (f.plan && r.plan!==f.plan) return false;
    if (f.area && r.area!==f.area) return false;
    if (f.manager && r.manager!==f.manager) return false;
    if (f.repSearch && !r.employee.toLowerCase().includes(f.repSearch.toLowerCase())) return false;
    if (f.activeVacant==='active' && r.vacant) return false;
    if (f.activeVacant==='vacant' && !r.vacant) return false;
    if (f.capView && f.capView!=='all' && capFlag(r)!==f.capView) return false;
    if (f.deviationView && f.deviationView!=='all'){
      if (f.deviationView==='vacant'){ if (!r.vacant) return false; }
      else {
        if (r.vacant) return false;
        const m = repMetrics(r, toleranceOn);
        if (m.status !== f.deviationView) return false;
      }
    }
    if (f.specialty || f.cls){
      const custs = custsFor(r);
      const hasMatch = custs.some(c => (!f.specialty || c[2]===f.specialty) && (!f.cls || c[3]===f.cls));
      if (!hasMatch) return false;
    }
    return true;
  });
}

function repKey(r){ return r.plan+'|'+r.origLine+'|'+r.employee+'|'+r.area; }

/* Plan-matched customer list (2026-09-25, Ahmed: "when I filter PM only the PM list
   of the medical rep is shown"). CUSTOMERS is keyed by employee and holds BOTH plans'
   accounts plus pharmacies; a rep row is one plan, so only that plan's customer types
   belong to it: PM = Doctor, AM = Hospital / Contract / Distributor. Pharmacy plan is
   out of scope everywhere. Verified: these counts equal the CRM's Total PM / AM List
   figures for all 1,347 rep rows. */
const PLAN_TYPES = { PM: ['Doctor'], AM: ['Hospital','Contract','Distributor'] };
function custsFor(rep){
  const types = PLAN_TYPES[rep.plan] || [];
  return (CUSTOMERS[rep.employee] || []).filter(c => types.includes(c[1]));
}

/* Capacity flag (planned calls vs capacity = call rate x 20 PM / x 22 AM). With the
   tolerance toggle ON, "Capacity OK" = within ±10% of capacity; OFF = exact match. */
function capFlag(rep){
  if (rep.vacant || rep.crmCapacity == null || rep.crmFreq == null) return null;
  const dev = rep.crmFreq - rep.crmCapacity;
  const band = STATE.tolerance ? Math.abs(rep.crmCapacity) * 0.1 : 0;
  if (Math.abs(dev) <= band) return 'OK';
  return dev > 0 ? 'OVER' : 'UNDER';
}
function capPill(rep){
  const f = capFlag(rep);
  if (!f) return '<span class="mini">—</span>';
  const pct = rep.crmCapacity ? Math.round(100 * rep.crmFreq / rep.crmCapacity) : null;
  const tip = `Planned calls ${fmt(rep.crmFreq)} vs capacity ${fmt(rep.crmCapacity)} (call rate ${fmt(rep.crmTargetCallRate)} × ${fmt(rep.crmWorkingDays)} days)${pct!==null?' = '+pct+'%':''}`;
  const lbl = f==='OVER' ? 'Over capacity' : f==='UNDER' ? 'Under capacity' : 'Capacity OK';
  const cls = f==='OVER' ? 'cap-over' : f==='UNDER' ? 'cap-under' : 'cap-ok';
  return `<span class="li-pill ${cls}" tabindex="0" data-tip="${esc(tip)}">${lbl}</span>`;
}


/* ================= RENDERING ================= */

function render(){
  renderTabs();
  renderCrumbs();
  renderToleranceBadge();
  if (STATE.tab==='overview') renderOverview();
  else if (STATE.tab==='reps') renderReps();
  else if (STATE.tab==='actionqueue') renderActionQueue();
  else if (STATE.tab==='insights') renderInsights();
  else renderDataQuality();
}

function renderTabs(){
  const el = document.getElementById('li_tabs');
  const tabs = [
    {id:'overview', label:'Lines Overview'},
    {id:'reps', label:'Representatives'},
    {id:'actionqueue', label:'Action / Review Queue'},
    {id:'insights', label:'Insights & Actions'},
    {id:'dataquality', label:'Data Quality & Validation'},
  ];
  el.innerHTML = tabs.map(t=>`<button class="tab ${STATE.tab===t.id?'active':''}" data-tab="${t.id}">${t.label}</button>`).join('');
  el.querySelectorAll('.tab').forEach(b=> b.addEventListener('click', ()=>{ STATE.tab=b.dataset.tab; render(); }));
}

function renderToleranceBadge(){
  const t = document.getElementById('li_toleranceToggle');
  t.classList.toggle('on', STATE.tolerance);
  document.getElementById('li_tolBandLabel').textContent = STATE.tolerance ? '±10% band applied' : 'Exact target (no band)';
}

function renderCrumbs(){
  const el = document.getElementById('li_crumbs');
  const parts = [];
  parts.push(`<span class="crumb ${STATE.tab==='overview'?'current':''}" data-go="overview">All Business Units</span>`);
  if (STATE.filters.bu){
    parts.push('<span class="crumb-sep">/</span>');
    parts.push(`<span class="crumb" data-go="bu">${esc(STATE.filters.bu)}</span>`);
  }
  if (STATE.selectedLine){
    parts.push('<span class="crumb-sep">/</span>');
    parts.push(`<span class="crumb ${STATE.tab==='reps'?'current':''}" data-go="line">${esc(STATE.selectedLine.line)} — ${STATE.selectedLine.plan}</span>`);
  }
  if (STATE.expandedRepKey){
    const r = REPS.find(x=>repKey(x)===STATE.expandedRepKey);
    if (r){
      parts.push('<span class="crumb-sep">/</span>');
      parts.push(`<span class="crumb current">${esc(r.employee)}</span>`);
    }
  }
  el.innerHTML = parts.join('');
  el.querySelectorAll('.crumb[data-go]').forEach(c=>{
    c.addEventListener('click', ()=>{
      const go = c.dataset.go;
      if (go==='overview'){ STATE.tab='overview'; STATE.filters={bu:'',line:'',plan:'',area:'',manager:'',repSearch:'',activeVacant:'all',deviationView:'all',specialty:'',cls:''}; STATE.selectedLine=null; STATE.expandedRepKey=null; }
      else if (go==='bu'){ STATE.tab='overview'; STATE.filters.line=''; STATE.selectedLine=null; STATE.expandedRepKey=null; }
      else if (go==='line'){ STATE.tab='reps'; STATE.expandedRepKey=null; }
      render();
    });
  });
}

/* ---------------- Overview tab ---------------- */
function renderOverview(){
  const main = document.getElementById('li_main');
  const scope = lineScopeReps(STATE.filters);
  const lineAgg = aggregateLines(scope, STATE.tolerance);

  // Headcount counted ONCE PER LINE (Ahmed, 2026-09-25): PM and AM are the same
  // reps, so Planned MR is not added per plan (the standalone page showed 1,450 =
  // 725 x 2). A line's unassigned gap = its larger PM/AM shortfall, never the sum.
  const perLineHC = {};
  for (const g of lineAgg){
    const L = perLineHC[g.line] || (perLineHC[g.line] = {planned: g.plannedMR || 0, gap: 0});
    L.gap = Math.max(L.gap, g.unassignedGap);
  }
  const totalPlannedHC = Object.values(perLineHC).reduce((s,L)=>s+L.planned,0);
  const lists = STATE.filters.plan ? STATE.filters.plan+' list' : 'PM + AM lists';
  const totalCRMTerritories = lineAgg.reduce((s,g)=>s+g.crmTotal,0);
  const totalActive = lineAgg.reduce((s,g)=>s+g.active,0);
  const totalVacant = lineAgg.reduce((s,g)=>s+g.vacant,0);
  const totalUnassignedGap = Object.values(perLineHC).reduce((s,L)=>s+L.gap,0);
  const totalTarget = lineAgg.reduce((s,g)=>s+g.totalTarget,0);
  const totalCurrent = lineAgg.reduce((s,g)=>s+g.current,0);
  const totalRawGap = round2(totalCurrent-totalTarget);
  const totalActionableDeviation = lineAgg.reduce((s,g)=>s+g.deviation,0);
  const belowCount = lineAgg.filter(g=>g.status==='BELOW RANGE').length;
  const withinCount = lineAgg.filter(g=>g.status==='WITHIN RANGE').length;
  const aboveCount = lineAgg.filter(g=>g.status==='ABOVE RANGE').length;

  main.innerHTML = `
    ${filterBar('overview')}
    <div class="kpi-row-label">Headcount</div>
    <div class="kpi-row">
      ${kpi(totalPlannedHC,'Total Planned HC (field force, per line)','info')}
      ${kpi(totalCRMTerritories,`CRM Territories (${lists})`)}
      ${kpi(totalActive,`Active Territories (${lists})`)}
      ${kpi(totalVacant,`Vacant Territories (${lists})`, totalVacant>0?'warn':'good')}
      ${kpi(totalUnassignedGap,'Unassigned HC Gap (per line)', totalUnassignedGap>0?'warn':'good')}
    </div>
    ${renderLineCapacityCards(scope)}
    <div class="kpi-row-label">Customer List — Target vs Current (Line/Plan basis, tolerance ${STATE.tolerance?'ON':'OFF'})</div>
    <div class="kpi-row">
      ${kpi(totalTarget,'Total Target Customers','info')}
      ${kpi(totalCurrent,'Total Current Customers')}
      ${kpi(fmtSigned(totalRawGap),'Total Raw Gap', totalRawGap<0?'warn':(totalRawGap>0?'':''))}
      ${kpi(fmtSigned(totalActionableDeviation),'Total Actionable Deviation', totalActionableDeviation!==0?'warn':'good')}
    </div>
    ${capacityKpis(scope)}
    <div class="kpi-row-label">Line/Plan groups by status</div>
    <div class="kpi-row">
      ${kpi(belowCount,'Below Range','warn')}
      ${kpi(withinCount,'Within Range','good')}
      ${kpi(aboveCount,'Above Range','')}
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Line / Plan comparison — Target → Current → Deviation</h2>
          <div class="desc">Click a row to open its Representatives. Total Target = Flat Per-Rep Target × Planned MR (master baseline), not adjusted for current staffing.</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn" id="li_exportLinePack">Download Line Summary</button>
          <button class="btn" id="li_exportPromoGrid">Download Promo Grid</button>
        </div>
      </div>
      <div class="li-scroll">
        <table class="data" id="li_lineTable">
          <thead><tr>
            <th>Business Unit</th><th>Line</th><th>Plan</th>
            <th>Planned HC</th><th>CRM Terr.</th><th>Active</th><th>Vacant</th><th>Unassigned Gap</th>
            <th>Target/Rep</th><th>Total Target</th><th>Current</th><th>Raw Gap</th>
            <th>Lower</th><th>Upper</th><th>Actionable Dev.</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${lineAgg.map(g=>lineRow(g)).join('')}
          </tbody>
        </table>
      </div>
      ${lineAgg.length===0? '<div class="empty-note">No Line/Plan groups match the current filters.</div>':''}
      <div class="legend-note">Surplus context: ${lineAgg.filter(g=>g.surplus>0).map(g=>`${g.line}/${g.plan} +${g.surplus}`).join(', ') || 'none'}. A surplus (CRM territories &gt; Planned MR) is shown for context only and is never called an Unassigned HC Gap.</div>
    </div>
  `;
  wireFilterBar('overview');
  document.querySelectorAll('#li_lineTable tbody tr[data-linekey]').forEach(tr=>{
    tr.addEventListener('click', ()=>{
      const [line, plan] = tr.dataset.linekey.split('||');
      STATE.selectedLine = {line, plan};
      STATE.filters.line = line; STATE.filters.plan = plan;
      STATE.tab = 'reps';
      render();
    });
  });
  document.querySelectorAll('#li_lineTable [data-recon-nav]').forEach(dot=>{
    dot.addEventListener('click', (e)=>{
      e.stopPropagation();
      STATE.tab = 'dataquality';
      render();
    });
  });
  document.getElementById('li_exportLinePack').addEventListener('click', ()=> downloadLineSummary(lineAgg));
  document.getElementById('li_exportPromoGrid').addEventListener('click', ()=> downloadPromoGrid());
}

/* ---------------- Promo Grid export (per current BU/Line/Plan filter) ---------------- */
function downloadPromoGrid(){
  const lineToBU = {};
  for (const r of REPS){ if (!lineToBU[r.line]) lineToBU[r.line] = r.bu; }
  const headers = ['Business Unit','Line','Plan','Planned MR','Target/Rep (flat)',
    'A1','A2','A3','B1','B2','B3','C1','C2','C3',
    'A1 Freq','A2 Freq','A3 Freq','B1 Freq','B2 Freq','B3 Freq','C1 Freq','C2 Freq','C3 Freq',
    'Target Visits/Day','Target Calls/Cycle','Reconciliation Status'];
  const rows = [];
  for (const line in PROMO_TARGETS){
    if (STATE.filters.line && STATE.filters.line!==line) continue;
    if (STATE.filters.bu && lineToBU[line]!==STATE.filters.bu) continue;
    for (const plan of ['PM','AM']){
      if (STATE.filters.plan && STATE.filters.plan!==plan) continue;
      const e = PROMO_TARGETS[line][plan];
      if (!e) continue;
      const ct = e.classesTarget || {};
      const cf = e.classesFreqTarget || {};
      rows.push([
        lineToBU[line]||'', line, plan, e.plannedMR, e.targetPerRep,
        ...CLASS_KEYS.map(k=> (ct[k]===undefined||ct[k]===null)?'':ct[k]),
        ...CLASS_KEYS.map(k=> (cf[k]===undefined||cf[k]===null)?'':cf[k]),
        e.targetVisitsPerDay, e.targetCallsPerCycle,
        e.reconFlag ? 'PROMO GRID RECONCILIATION ISSUE' : 'OK'
      ]);
    }
  }
  saveTable('Promo_Grid'+filterSuffix(true), headers, rows, 'Promo Grid');
}

function sumUnique(groups, fn){ return groups.reduce((s,g)=>s+ (fn(g)||0), 0); }



function kpi(value, label, cls){
  return `<div class="kpi ${cls||''}"><div class="v">${typeof value==='number'?fmt(value):value}</div><div class="l">${label}</div></div>`;
}

function statusPill(status){
  const cls = status==='BELOW RANGE'?'below':status==='ABOVE RANGE'?'above':status==='VACANT TERRITORY'?'vacant':'within';
  return `<span class="li-pill ${cls}">${status}</span>`;
}

function lineRow(g){
  const nRemap = g.reps.filter(r=>r.lineRemapped).length;
  const remap = nRemap ? `<span class="remap-badge" tabindex="0" data-tip="Includes ${nRemap} CHC_Sales territor${nRemap===1?'y':'ies'} mapped to CHC">+CHC_Sales</span>` : '';
  const reconIndicator = g.reconFlag ? `<span class="recon-dot" tabindex="0" data-tip="Promo Grid reconciliation issue on this Line/Plan — see Data Quality &amp; Validation for detail" data-recon-nav="1">ⓘ</span>` : '';
  return `<tr data-linekey="${esc(g.line)}||${esc(g.plan)}">
    <td>${esc(g.bu)}</td>
    <td>${esc(g.line)}${remap}${reconIndicator}</td>
    <td>${esc(g.plan)}</td>
    <td class="li-num">${fmt(g.plannedMR)}</td>
    <td class="li-num">${fmt(g.crmTotal)}</td>
    <td class="li-num">${fmt(g.active)}</td>
    <td class="li-num">${fmt(g.vacant)}</td>
    <td class="li-num">${g.unassignedGap>0?fmt(g.unassignedGap):'0'}</td>
    <td class="li-num">${fmt(g.targetPerRep)}</td>
    <td class="li-num">${fmt(g.totalTarget)}</td>
    <td class="li-num">${fmt(g.current)}</td>
    <td class="li-num">${fmtSigned(g.rawGap)}</td>
    <td class="li-num mini">${fmt(g.lower)}</td>
    <td class="li-num mini">${fmt(g.upper)}</td>
    <td class="li-num">${fmtSigned(g.deviation)}</td>
    <td>${statusPill(g.status)}</td>
  </tr>`;
}

/* ---------------- shared filter bar ---------------- */
function filterBar(context){
  const f = STATE.filters;
  const bus = allBUs();
  const lines = allLines(f.bu);
  const showAreaManager = context==='reps';
  const areas = showAreaManager ? allAreas(f) : [];
  const managers = showAreaManager ? allManagers(f) : [];
  return `
  <div class="filters">
    <div class="field"><label>Business Unit</label>
      <select id="li_f_bu"><option value="">All</option>${bus.map(b=>`<option value="${esc(b)}" ${f.bu===b?'selected':''}>${esc(b)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Line</label>
      <select id="li_f_line"><option value="">All</option>${lines.map(l=>`<option value="${esc(l)}" ${f.line===l?'selected':''}>${esc(l)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Plan</label>
      <select id="li_f_plan"><option value="">All</option><option value="PM" ${f.plan==='PM'?'selected':''}>PM</option><option value="AM" ${f.plan==='AM'?'selected':''}>AM</option></select>
    </div>
    ${showAreaManager ? `
    <div class="field"><label>Area</label>
      <select id="li_f_area"><option value="">All</option>${areas.map(a=>`<option value="${esc(a)}" ${f.area===a?'selected':''}>${esc(a)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Manager</label>
      <select id="li_f_manager"><option value="">All</option>${managers.map(m=>`<option value="${esc(m)}" ${f.manager===m?'selected':''}>${esc(m)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Representative</label>
      <input id="li_f_repsearch" type="text" placeholder="Search name…" value="${esc(f.repSearch)}"/>
    </div>
    <div class="field"><label>Active / Vacant</label>
      <select id="li_f_activevacant">
        <option value="all" ${f.activeVacant==='all'?'selected':''}>All</option>
        <option value="active" ${f.activeVacant==='active'?'selected':''}>Active</option>
        <option value="vacant" ${f.activeVacant==='vacant'?'selected':''}>Vacant</option>
      </select>
    </div>
    <div class="field"><label>Status</label>
      <select id="li_f_deviation">
        <option value="all" ${f.deviationView==='all'?'selected':''}>All</option>
        <option value="BELOW RANGE" ${f.deviationView==='BELOW RANGE'?'selected':''}>Below range</option>
        <option value="WITHIN RANGE" ${f.deviationView==='WITHIN RANGE'?'selected':''}>Within range</option>
        <option value="ABOVE RANGE" ${f.deviationView==='ABOVE RANGE'?'selected':''}>Above range</option>
        <option value="vacant" ${f.deviationView==='vacant'?'selected':''}>Vacant territories</option>
      </select>
    </div>
    <div class="field"><label>Capacity</label>
      <select id="li_f_capacity">
        <option value="all" ${!f.capView||f.capView==='all'?'selected':''}>All</option>
        <option value="OVER" ${f.capView==='OVER'?'selected':''}>Over capacity</option>
        <option value="OK" ${f.capView==='OK'?'selected':''}>Capacity OK</option>
        <option value="UNDER" ${f.capView==='UNDER'?'selected':''}>Under capacity</option>
      </select>
    </div>
    <div class="field"><label>Specialty</label>
      <select id="li_f_specialty"><option value="">All</option>${allSpecialties(f).map(s=>`<option value="${esc(s)}" ${f.specialty===s?'selected':''}>${esc(s)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Class</label>
      <select id="li_f_class"><option value="">All</option>${allClasses(f).map(c=>`<option value="${esc(c)}" ${f.cls===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
    </div>` : ''}
    <button class="btn ghost" id="li_f_reset">Reset filters</button>
    ${!showAreaManager ? '<div class="filters-note">Area, Manager, Representative and Status filters apply within the Representatives view (they need a Line/Plan in scope to stay meaningful against a Planned-MR-based target).</div>':''}
  </div>`;
}

function wireFilterBar(context){
  const f = STATE.filters;
  const bind = (id, key, transform)=>{
    const el = document.getElementById('li_'+id);
    if (!el) return;
    el.addEventListener('change', ()=>{ f[key] = transform?transform(el.value):el.value; if(key==='bu'){f.line='';} render(); });
    if (id==='f_repsearch') el.addEventListener('input', ()=>{ f.repSearch = el.value; render(); });
  };
  bind('f_bu','bu'); bind('f_line','line'); bind('f_plan','plan');
  bind('f_area','area'); bind('f_manager','manager'); bind('f_activevacant','activeVacant'); bind('f_deviation','deviationView');
  bind('f_specialty','specialty'); bind('f_class','cls'); bind('f_capacity','capView');
  const reset = document.getElementById('li_f_reset');
  if (reset) reset.addEventListener('click', ()=>{
    STATE.filters = {bu:'',line: context==='reps'?f.line:'', plan: context==='reps'?f.plan:'', area:'',manager:'',repSearch:'',activeVacant:'all',deviationView:'all',specialty:'',cls:''};
    render();
  });
}

/* ---------------- Representatives tab ---------------- */
function renderReps(){
  const main = document.getElementById('li_main');
  const reps = repScopeReps(STATE.filters, STATE.tolerance);
  reps.sort((a,b)=> a.line.localeCompare(b.line) || a.area.localeCompare(b.area) || a.employee.localeCompare(b.employee));

  main.innerHTML = `
    ${filterBar('reps')}
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Representatives${STATE.selectedLine? ' — '+esc(STATE.selectedLine.line)+' / '+esc(STATE.selectedLine.plan):''}</h2>
          <div class="desc">${reps.length} territor${reps.length===1?'y':'ies'} match current filters. Click a row to open segmentation and customer list. Downloads export as .xlsx (falling back to .csv if unavailable) and contain only this filtered set.</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn" id="li_exportCustomerListGlobal">Current Customer List</button>
          <button class="btn" id="li_exportRepSheet">Rep Action List</button>
          <button class="btn" id="li_exportManagerPack">Manager Action List</button>
          <button class="btn" id="li_exportPromoGridReps">Download Promo Grid</button>
        </div>
      </div>
      <div class="li-scroll">
        <table class="data" id="li_repTable">
          <thead><tr>
            <th>Representative</th><th>Manager</th><th>Area</th><th>Line</th><th>Plan</th><th>Status</th>
            <th>Target</th><th>Current</th><th>Raw Gap</th><th>Lower</th><th>Upper</th><th>Actionable Dev.</th><th>Capacity</th><th>Result</th>
          </tr></thead>
          <tbody>${reps.map(r=>repRow(r)).join('')}</tbody>
        </table>
      </div>
      ${reps.length===0? '<div class="empty-note">No representatives match the current filters.</div>':''}
    </div>
    <div id="li_repDetailHost"></div>
  `;
  wireFilterBar('reps');
  document.querySelectorAll('#li_repTable tbody tr[data-repkey]').forEach(tr=>{
    tr.addEventListener('click', ()=>{
      const key = tr.dataset.repkey;
      STATE.expandedRepKey = (STATE.expandedRepKey===key) ? null : key;
      STATE.custPage = 0; STATE.custFilters = {type:'', specialty:'', cls:''};
      render();
      if (STATE.expandedRepKey){
        const host = document.getElementById('li_repDetailHost');
        if (host && typeof host.scrollIntoView === 'function') host.scrollIntoView({behavior:'smooth', block:'start'});
      }
    });
  });
  document.getElementById('li_exportCustomerListGlobal').addEventListener('click', ()=> downloadCurrentCustomerList());
  document.getElementById('li_exportPromoGridReps').addEventListener('click', ()=> downloadPromoGrid());
  document.getElementById('li_exportRepSheet').addEventListener('click', ()=> downloadRepActionList(reps));
  document.getElementById('li_exportManagerPack').addEventListener('click', ()=> downloadManagerActionList(reps));

  if (STATE.expandedRepKey){
    const rep = REPS.find(r=>repKey(r)===STATE.expandedRepKey);
    if (rep) renderRepDetail(rep);
  }
}

function repRow(r){
  const m = repMetrics(r, STATE.tolerance);
  const resultText = r.vacant ? 'Vacant territory – no rep performance assessment.'
    : (m.status==='BELOW RANGE' ? 'Review whether additional customers are required.'
      : m.status==='ABOVE RANGE' ? 'Review customer list and potential optimization.'
      : 'Within agreed tolerance.');
  return `<tr data-repkey="${esc(repKey(r))}">
    <td>${esc(r.employee)}</td>
    <td>${esc(r.manager)}</td>
    <td>${esc(r.area)}</td>
    <td>${esc(r.origLine)}${r.lineRemapped?'<span class="remap-badge">→CHC</span>':''}</td>
    <td>${esc(r.plan)}</td>
    <td>${statusPill(m.displayStatus)}</td>
    <td class="li-num">${fmt(m.target)}</td>
    <td class="li-num">${fmt(m.current)}</td>
    <td class="li-num">${fmtSigned(m.rawGap)}</td>
    <td class="li-num mini">${fmt(m.lower)}</td>
    <td class="li-num mini">${fmt(m.upper)}</td>
    <td class="li-num">${r.vacant? '—' : fmtSigned(m.deviation)}</td>
    <td>${capPill(r)}</td>
    <td class="action-note">${resultText}</td>
  </tr>`;
}

/* ---------------- Rep detail: segmentation + customer drill-down ---------------- */
// Independently sums this rep's own current customer-list call frequencies
// (Type-matched to the Plan: Doctor for PM, Hospital/Contract/Distributor for AM,
// Pharmacy always excluded), rather than trusting the CRM's pre-aggregated figure.
// Verified to reproduce the CRM's own "Total Number Of Frequency"/"Frequency"
// field exactly across all 1,274 active reps checked — shown here as our own
// calculation, not a copy of that CRM field.
function actualTotalCalls(rep){
  const custs = CUSTOMERS[rep.employee] || [];
  const types = rep.plan==='PM' ? ['Doctor'] : ['Hospital','Contract','Distributor'];
  return custs.filter(c=>types.includes(c[1])).reduce((s,c)=> s + (c[5]||0), 0);
}

function renderRepDetail(rep){
  const host = document.getElementById('li_repDetailHost');
  const m = repMetrics(rep, STATE.tolerance);
  const custs = custsFor(rep);
  const totalCalls = actualTotalCalls(rep);
  const callsDev = (rep.targetCallsPerCycle!=null) ? round2(totalCalls - rep.targetCallsPerCycle) : null;

  host.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>${esc(rep.employee)} <span class="mini">— ${esc(rep.plan)} · ${esc(rep.origLine)}${rep.lineRemapped?' (mapped to CHC)':''}</span></h2>
          <div class="desc">${esc(rep.manager)} · ${esc(rep.area)} · ${rep.vacant?'Vacant territory':'Active representative'}</div>
        </div>
      </div>
      <div class="li-2col" style="padding:14px;">
        <div>
          <h3 style="font-size:12.5px;margin:0 0 8px;">Segmentation — Target vs Current</h3>
          ${renderSegmentation(rep)}
        </div>
        <div>
          <h3 style="font-size:12.5px;margin:0 0 8px;">Profile</h3>
          <table class="data" style="min-width:0;">
            <tbody>
              <tr><td>Target (flat, per rep)</td><td class="li-num">${fmt(m.target)}</td></tr>
              <tr><td>Current</td><td class="li-num">${fmt(m.current)}</td></tr>
              <tr><td>Raw Gap</td><td class="li-num">${fmtSigned(m.rawGap)}</td></tr>
              <tr><td>Lower / Upper limit</td><td class="li-num">${fmt(m.lower)} / ${fmt(m.upper)}</td></tr>
              <tr><td>Actionable Deviation</td><td class="li-num">${rep.vacant?'—':fmtSigned(m.deviation)}</td></tr>
              <tr><td>Status</td><td>${statusPill(m.displayStatus)}</td></tr>
              <tr><td>CRM reference: Target Call Rate</td><td class="li-num mini">${fmt(rep.crmTargetCallRate)} <span class="mini">(calls/day — not comparable to customer-count target above)</span></td></tr>
              <tr><td>Capacity (calls/cycle) <span class="mini">= call rate × ${fmt(rep.crmWorkingDays)} working days (${esc(rep.plan)} standard)</span></td><td class="li-num">${fmt(rep.crmCapacity)}</td></tr>
              <tr><td>CRM export reference: Capacity <span class="mini">(call rate × 20)</span></td><td class="li-num mini">${fmt(rep.crmCapacitySource)}</td></tr>
              <tr><td>Promo Grid: Target Calls/Cycle (flat, Visits/Day × Working Days)</td><td class="li-num mini">${fmt(rep.targetCallsPerCycle)} <span class="mini">(${fmt(rep.targetVisitsPerDay)} visits/day in source)</span></td></tr>
              <tr><td><b>Actual Total Calls</b> <span class="mini">(sum of this rep's own customer-list call frequencies)</span></td><td class="li-num"><b>${fmt(totalCalls)}</b></td></tr>
              <tr><td><b>Deviation (Actual Total Calls − Promo Grid Target Calls/Cycle)</b></td><td class="li-num" style="${(callsDev!==null&&callsDev!==0)?`color:${callsDev<0?'var(--below)':'var(--above)'};font-weight:650;`:''}">${callsDev===null?'—':fmtSigned(callsDev)}</td></tr>
              <tr><td><b>Difference (Capacity − Promo Grid Target Calls/Cycle)</b></td><td class="li-num" style="${(rep.crmCapacity!=null&&rep.targetCallsPerCycle!=null&&rep.crmCapacity!==rep.targetCallsPerCycle)?'color:var(--below);font-weight:650;':''}">${(rep.crmCapacity!=null&&rep.targetCallsPerCycle!=null)?fmtSigned(rep.crmCapacity-rep.targetCallsPerCycle):'—'}</td></tr>
              <tr><td>Calls Deviation / Status <span class="mini">(CRM frequency − capacity)</span></td><td class="li-num">${fmtSigned(rep.crmDeviation)} (${esc(rep.crmStatus||'—')})</td></tr>
              <tr><td>CRM export reference: Deviation / Status</td><td class="li-num mini">${fmtSigned(rep.crmDeviationSource)} (${esc(rep.crmStatusSource||'—')})</td></tr>
            </tbody>
          </table>
          ${rep.reconFlag? `<div class="mini" style="margin-top:8px;color:var(--below);">This Line/Plan carries a PROMO GRID RECONCILIATION ISSUE — see Data Quality tab. The Flat Per-Rep Target above (${fmt(m.target)}) is the one still used for this calculation.</div>`:''}
        </div>
      </div>
      <div class="customer-toolbar">
        <div class="field"><label>Type</label>
          <select id="li_cf_type"><option value="">All</option>${distinctSorted(custs.map(c=>c[1]).filter(Boolean)).map(t=>`<option value="${esc(t)}" ${STATE.custFilters.type===t?'selected':''}>${esc(t)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Specialty</label>
          <select id="li_cf_specialty"><option value="">All</option>${distinctSorted(custs.map(c=>c[2]).filter(Boolean)).map(s=>`<option value="${esc(s)}" ${STATE.custFilters.specialty===s?'selected':''}>${esc(s)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Class</label>
          <select id="li_cf_class"><option value="">All</option>${distinctSorted(custs.map(c=>c[3]).filter(Boolean)).map(c=>`<option value="${esc(c)}" ${STATE.custFilters.cls===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
        </div>
        <button class="btn" id="li_exportCustomerList" style="margin-left:auto;">Customer Review List (CSV)</button>
      </div>
      ${renderCustomerTable(custs, rep)}
    </div>
  `;
  document.getElementById('li_cf_type').addEventListener('change', e=>{ STATE.custFilters.type=e.target.value; STATE.custPage=0; renderRepDetail(rep); });
  document.getElementById('li_cf_specialty').addEventListener('change', e=>{ STATE.custFilters.specialty=e.target.value; STATE.custPage=0; renderRepDetail(rep); });
  document.getElementById('li_cf_class').addEventListener('change', e=>{ STATE.custFilters.cls=e.target.value; STATE.custPage=0; renderRepDetail(rep); });
  document.getElementById('li_exportCustomerList').addEventListener('click', ()=> downloadCustomerReviewList(rep, filteredCustomers(custs)));
  const prevBtn = document.getElementById('li_custPrev');
  const nextBtn = document.getElementById('li_custNext');
  if (prevBtn) prevBtn.addEventListener('click', ()=>{ if(STATE.custPage>0){ STATE.custPage--; renderRepDetail(rep);} });
  if (nextBtn) nextBtn.addEventListener('click', ()=>{ STATE.custPage++; renderRepDetail(rep); });
}

function filteredCustomers(custs){
  return custs.filter(c=>
    (!STATE.custFilters.type || c[1]===STATE.custFilters.type) &&
    (!STATE.custFilters.specialty || c[2]===STATE.custFilters.specialty) &&
    (!STATE.custFilters.cls || c[3]===STATE.custFilters.cls)
  );
}

function renderSegmentation(rep){
  if (rep.noSegTarget){
    return `<div class="mini" style="padding:10px;border:1px dashed var(--border);border-radius:6px;">Segmentation target not available for this Line/Plan.<br/>Showing current class distribution only (no target to compare against).</div>
      ${CLASS_KEYS.map(k=>{
        const cur = rep.classesCurrent[k]||0;
        const max = Math.max(1, ...CLASS_KEYS.map(kk=>rep.classesCurrent[kk]||0));
        return segBarRow(k, cur, null, max);
      }).join('')}`;
  }
  const max = Math.max(1, ...CLASS_KEYS.map(k=>Math.max(rep.classesCurrent[k]||0, (rep.classesTarget&&rep.classesTarget[k])||0)));
  return CLASS_KEYS.map(k=>{
    const cur = rep.classesCurrent[k]||0;
    const tgt = rep.classesTarget ? (rep.classesTarget[k]||0) : null;
    return segBarRow(k, cur, tgt, max);
  }).join('');
}

function segBarRow(label, current, target, max){
  const pct = Math.min(100, (current/max)*100);
  let fillClass = '';
  let markStyle = '';
  if (target!==null && target!==undefined){
    if (current>target) fillClass='over'; else if (current<target) fillClass='under';
    const markPct = Math.min(100,(target/max)*100);
    markStyle = `left:${markPct}%;`;
  }
  return `<div class="seg-bar-row">
    <div>${label}</div>
    <div class="seg-track">
      <div class="seg-fill ${fillClass}" style="width:${pct}%;"></div>
      ${target!==null&&target!==undefined? `<div class="seg-target-mark" style="${markStyle}" data-tip="Target: ${target}"></div>`:''}
    </div>
    <div class="li-num mini">${current}${target!==null&&target!==undefined?' / '+target:''}</div>
  </div>`;
}

// Promo Grid's frequency target for a given Class on this rep's Line/Plan (per visit-cycle),
// or null when no segmentation target exists for that Line/Plan, or the class isn't in the target set.
function freqTargetFor(rep, cls){
  if (!rep || rep.noSegTarget || !rep.classesFreqTarget) return null;
  const v = rep.classesFreqTarget[cls];
  return (v===null || v===undefined) ? null : v;
}

function renderCustomerTable(custs, rep){
  const filtered = filteredCustomers(custs);
  const total = filtered.length;
  const start = STATE.custPage * PAGE_SIZE_CUST;
  const page = filtered.slice(start, start+PAGE_SIZE_CUST);
  if (total===0){
    return '<div class="empty-note">No customers on file for this representative (or none match the Specialty/Class filter).</div>';
  }
  const rows = page.map(c=>{
    const [name, type, specialty, cls, area, freq, clinicGroup] = c;
    const target = freqTargetFor(rep, cls);
    const dev = (target!==null && freq!==null && freq!==undefined) ? round2(freq-target) : null;
    const devCell = dev===null ? '—' : fmtSigned(dev);
    const devStyle = (dev!==null && dev!==0) ? `color:${dev<0?'var(--below)':'var(--above)'};font-weight:600;` : '';
    return `<tr class="static">
      <td>${esc(name)}</td><td>${esc(type)}</td><td>${esc(specialty||'—')}</td><td>${esc(cls)}</td>
      <td>${esc(area)}</td><td class="li-num">${fmt(freq)}</td><td class="li-num mini">${target===null?'—':fmt(target)}</td>
      <td class="li-num" style="${devStyle}">${devCell}</td>
      <td class="mini">${esc(clinicGroup||'—')}</td>
    </tr>`;
  }).join('');
  const totalPages = Math.ceil(total/PAGE_SIZE_CUST);
  return `
    <div class="li-scroll">
      <table class="data">
        <thead><tr><th>Customer Name</th><th>Type</th><th>Specialty</th><th>Class</th><th>Area</th><th>Frequency (List)</th><th>Frequency (Promo Grid)</th><th>Deviation</th><th>Clinic Group</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="mini" style="padding:8px 14px 0;">Frequency (Promo Grid) is the target visit frequency for that customer's Class, from this Line/Plan's segmentation targets${rep&&rep.noSegTarget?' — not available for this Line/Plan (no segmentation target in source)':''}. Deviation = Frequency (List) − Frequency (Promo Grid); shown as a raw difference, not tolerance-banded.</div>
    <div class="pager">
      <span>${total} customer${total===1?'':'s'}${total!==custs.length? ' (filtered from '+custs.length+')':''} — page ${STATE.custPage+1} of ${totalPages}</span>
      <button class="btn ghost" id="li_custPrev" ${STATE.custPage===0?'disabled':''}>Prev</button>
      <button class="btn ghost" id="li_custNext" ${STATE.custPage>=totalPages-1?'disabled':''}>Next</button>
    </div>
  `;
}

/* ---------------- Action / Review Queue ---------------- */
const AQ_PAGE_SIZE = 100;
function renderActionQueue(){
  const main = document.getElementById('li_main');
  const reps = repScopeReps(STATE.filters, STATE.tolerance);
  reps.sort((a,b)=> a.line.localeCompare(b.line) || a.employee.localeCompare(b.employee));

  const counts = { 'BELOW RANGE':0, 'WITHIN RANGE':0, 'ABOVE RANGE':0, 'VACANT':0 };
  reps.forEach(r=>{
    if (r.vacant) counts['VACANT']++;
    else counts[repMetrics(r, STATE.tolerance).status]++;
  });

  const total = reps.length;
  const start = STATE.aqPage * AQ_PAGE_SIZE;
  const page = reps.slice(start, start+AQ_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total/AQ_PAGE_SIZE));

  main.innerHTML = `
    ${filterBar('reps')}
    <div class="kpi-row">
      ${kpi(counts['BELOW RANGE'],'Below Range','warn')}
      ${kpi(counts['WITHIN RANGE'],'Within Range','good')}
      ${kpi(counts['ABOVE RANGE'],'Above Range')}
      ${kpi(counts['VACANT'],'Vacant')}
    </div>
    ${capacityKpis(reps)}
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Action / Review Queue</h2>
          <div class="desc">Diagnose → drill down → review → download → action. Every representative across the portfolio matching current filters, worst-first ordering not applied (this is a diagnostic tool, not a ranking). Click a row to open it in Representatives; use the row's Download button for just that rep's customer list.</div>
        </div>
      </div>
      <div class="li-scroll">
        <table class="data" id="li_aqTable">
          <thead><tr>
            <th>Business Unit</th><th>Line</th><th>Plan</th><th>Area</th><th>Manager</th><th>Representative</th><th>Status</th>
            <th>Target</th><th>Current</th><th>Raw Gap</th><th>Actionable Dev.</th><th>Capacity</th><th>Customers</th><th>Action</th><th></th>
          </tr></thead>
          <tbody>${page.map(r=>actionQueueRow(r)).join('')}</tbody>
        </table>
      </div>
      ${total===0? '<div class="empty-note">No representatives match the current filters.</div>':''}
      <div class="pager">
        <span>${fmt(total)} representative${total===1?'':'s'} — page ${STATE.aqPage+1} of ${totalPages}</span>
        <button class="btn ghost" id="li_aqPrev" ${STATE.aqPage===0?'disabled':''}>Prev</button>
        <button class="btn ghost" id="li_aqNext" ${STATE.aqPage>=totalPages-1?'disabled':''}>Next</button>
      </div>
    </div>
  `;
  wireFilterBar('reps');
  document.querySelectorAll('#li_aqTable tbody tr[data-repkey]').forEach(tr=>{
    tr.addEventListener('click', (e)=>{
      if (e.target.closest('[data-aqdownload]')) return;
      const key = tr.dataset.repkey;
      const r = REPS.find(x=>repKey(x)===key);
      STATE.filters.line = r.line; STATE.filters.plan = r.plan;
      STATE.selectedLine = {line:r.line, plan:r.plan};
      STATE.expandedRepKey = key;
      STATE.tab = 'reps';
      STATE.custPage = 0; STATE.custFilters = {type:'',specialty:'',cls:''};
      render();
    });
  });
  document.querySelectorAll('#li_aqTable [data-aqdownload]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const r = REPS.find(x=>repKey(x)===btn.dataset.aqdownload);
      if (r) downloadCustomerReviewList(r, custsFor(r));
    });
  });
  const prevBtn = document.getElementById('li_aqPrev');
  const nextBtn = document.getElementById('li_aqNext');
  if (prevBtn) prevBtn.addEventListener('click', ()=>{ if(STATE.aqPage>0){ STATE.aqPage--; renderActionQueue(); } });
  if (nextBtn) nextBtn.addEventListener('click', ()=>{ STATE.aqPage++; renderActionQueue(); });
}

function actionQueueRow(r){
  const m = repMetrics(r, STATE.tolerance);
  const actionText = r.vacant ? 'Vacant territory – no rep performance assessment.'
    : (m.status==='BELOW RANGE' ? 'Review whether additional customers are required.'
      : m.status==='ABOVE RANGE' ? 'Review customer list and potential optimization.'
      : 'Within agreed tolerance.');
  const custCount = custsFor(r).length;
  return `<tr data-repkey="${esc(repKey(r))}">
    <td>${esc(r.bu)}</td>
    <td>${esc(r.origLine)}${r.lineRemapped?'<span class="remap-badge">→CHC</span>':''}</td>
    <td>${esc(r.plan)}</td>
    <td>${esc(r.area)}</td>
    <td>${esc(r.manager)}</td>
    <td>${esc(r.employee)}</td>
    <td>${statusPill(m.displayStatus)}</td>
    <td class="li-num">${fmt(m.target)}</td>
    <td class="li-num">${fmt(m.current)}</td>
    <td class="li-num">${fmtSigned(m.rawGap)}</td>
    <td class="li-num">${r.vacant?'—':fmtSigned(m.deviation)}</td>
    <td>${capPill(r)}</td>
    <td class="li-num">${fmt(custCount)}</td>
    <td class="action-note">${actionText}</td>
    <td><button class="btn ghost" data-aqdownload="${esc(repKey(r))}">Download</button></td>
  </tr>`;
}


function renderDataQuality(){
  const main = document.getElementById('li_main');
  const dq = computeDataQualityStats();
  const reconRows = [];
  for (const line in PROMO_TARGETS){
    for (const plan of ['PM','AM']){
      const e = PROMO_TARGETS[line][plan];
      if (e && e.reconFlag){
        reconRows.push({line, plan, notes:e.reconNotes, target:e.targetPerRep, sumClasses:e.sumClassesPerRep, segTotal:e.segTotalRowPerRep});
      }
    }
  }
  const noSegLines = [];
  for (const line in PROMO_TARGETS){
    for (const plan of ['PM','AM']){
      const e = PROMO_TARGETS[line][plan];
      if (e && e.noSegmentation) noSegLines.push(`${line} / ${plan}`);
    }
  }

  main.innerHTML = `
    <div class="panel">
      <div class="panel-head"><div><h2>Data Quality &amp; Validation</h2><div class="desc">Everything below reflects known source-data conditions. Nothing here has been corrected in the underlying data — the dashboard calculates on the Flat Per-Rep Target regardless of these flags, per the finalized decisions.</div></div></div>

      <div class="dq-item">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
          <h3>1. Promo Grid reconciliation issues <span class="dq-count">${reconRows.length} Line/Plan combinations</span></h3>
          <button class="btn" id="li_exportDataQualityReport">Download Data Quality Report</button>
        </div>
        <div class="mini">Where the Flat Per-Rep Target disagrees with the sum of A1–C3 targets and/or the segmentation table's own Total row, as entered in the source Promo Grid file. This is a source-data quality flag only — the dashboard still calculates on the Flat Per-Rep Target in every case; no target value shown anywhere else in this dashboard has been changed because of it.</div>
        <div class="li-scroll" style="margin-top:8px;">
          <table class="data" style="min-width:640px;">
            <thead><tr><th>Line / Plan</th><th>Flat Per-Rep Target</th><th>A1–C3 Sum</th><th>Segmentation Total</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              ${reconRows.map(r=>`<tr class="static">
                <td>${esc(r.line)} / ${esc(r.plan)}</td>
                <td class="li-num">${fmt(r.target)}</td>
                <td class="li-num">${fmt(r.sumClasses)}</td>
                <td class="li-num">${r.segTotal===null||r.segTotal===undefined?'(not entered)':fmt(r.segTotal)}</td>
                <td><span class="li-pill flag">RECONCILIATION ISSUE</span></td>
                <td class="mini">${r.notes.map(esc).join('; ')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="dq-item">
        <h3>2. Explicit Line mapping <span class="dq-count">1</span></h3>
        <ul class="dq-list">
          <li>CRM Line <b>CHC_Sales</b> → Promo Grid Line <b>CHC</b> (explicit override, not a name match). ${dq.remapTerr} territor${dq.remapTerr===1?'y':'ies'} (${dq.remapVacant} vacant) are included under CHC's totals throughout this dashboard.</li>
        </ul>
      </div>

      <div class="dq-item">
        <h3>3. Duplicate Details rows <span class="dq-count">${fmt(dq.dupRows)}</span></h3>
        <div class="mini">${fmt(dq.dupRows)} rows in the CRM Details sheet share the same Employee + Customer Name + Type (out of ${fmt(dq.custRows)} total, ≈${fmt(dq.custRows?round2(100*dq.dupRows/dq.custRows):0)}%). They are left exactly as exported, so this page's counts stay consistent with the CRM's own pre-aggregated Total PM/AM List counts.</div>
      </div>

      <div class="dq-item">
        <h3>4. Missing / blank fields</h3>
        <ul class="dq-list">
          <li>Specialty is blank on ${fmt(dq.blankSpec)} of ${fmt(dq.custRows)} Details rows (≈${fmt(dq.custRows?round2(100*dq.blankSpec/dq.custRows):0)}%). Specialty is informational only in this dashboard (see item 8), so this does not affect any target/gap calculation.</li>
          <li>Clinic Group is blank on ${fmt(dq.blankClinic)} of ${fmt(dq.custRows)} Details rows (≈${fmt(dq.custRows?round2(100*dq.blankClinic/dq.custRows):0)}%).</li>
          <li>Customer street addresses are not published in this dashboard (privacy decision, 2026-09-25).</li>
        </ul>
      </div>

      <div class="dq-item">
        <h3>5. Missing segmentation targets <span class="dq-count">${noSegLines.length} Line/Plan combinations</span></h3>
        <ul class="dq-list">${noSegLines.map(l=>`<li>${esc(l)} — no A1–C3 breakdown exists in the source. Segmentation view shows "Segmentation target not available"; only the AM Target Total vs Current Total vs Deviation is shown for these.</li>`).join('')}</ul>
      </div>

      <div class="dq-item">
        <h3>6. Capacity vs Promo Grid Target Calls — not used as a customer-list input, reconciled here</h3>
        <div class="mini">Capacity measures calls, not customer-list counts, so it never feeds this page's Target/Current/Deviation. Standard since 2026-09-25: <b>Capacity = CRM Target Call Rate × ${fmt(WD_RULE.PM)} working days for PM and × ${fmt(WD_RULE.AM)} for AM</b>. The CRM export's own Capacity column is always call rate × 20; it is kept as a reference in each representative's profile.</div>
        ${renderCallsCapacityQA()}
      </div>

      <div class="dq-item">
        <h3>7. Formatting / type conversions</h3>
        <ul class="dq-list">
          <li>Some "No. of MR" cells in the Promo Grid files are stored as text (e.g. <code>'30'</code>) rather than numbers — coerced to numeric on load; value unchanged.</li>
          ${dq.fractional.length? `<li>Non-integer per-rep class targets in the source, preserved exactly (not rounded): ${dq.fractional.map(esc).join(', ')}.</li>`:''}
          <li>Vacant territories are detected by the Employee field containing "vacant" (case-insensitive), covering both the "&nbsp;Vacant &lt;Territory&gt;" and "VACANT &lt;ID/Territory&gt;" conventions found in the source. No other field is used to infer vacancy.</li>
        </ul>
      </div>

      <div class="dq-item">
        <h3>8. Other non-blocking notes</h3>
        <ul class="dq-list">
          <li>Planned MR (field-force headcount) is only explicitly stated in each Line's Physicians (PM) block; the AM block carries no such cell. The same Planned MR is reused for AM as for PM on a given Line, since the same reps carry both lists — this avoids one Line's incorrect AM Line-total cell (DIAB-III) distorting headcount math.</li>
          <li>Promo Grid Specialty sheets are product-detailing-by-specialty matrices, not doctor-specialty target tables, and their specialty vocabulary does not match the CRM's Specialty field. No Specialty Target/Gap/Deviation is calculated anywhere in this dashboard — Specialty is filter and customer-information only.</li>
        </ul>
      </div>
    </div>

    ${renderHeadcountQA()}
  `;
  wireHeadcountQA();
}

function wireHeadcountQA(){
  const sel = document.getElementById('li_qa_line_select');
  if (sel) sel.addEventListener('change', ()=>{ STATE.qaLine = sel.value; renderDataQuality(); });
  document.querySelectorAll('#li_headcountQAPanel tr[data-qaline]').forEach(tr=>{
    tr.addEventListener('click', ()=>{ STATE.qaLine = tr.dataset.qaline; renderDataQuality(); });
  });
  const exportBtn = document.getElementById('li_exportHeadcountRecon');
  if (exportBtn) exportBtn.addEventListener('click', ()=> downloadHeadcountReconciliation());
  const dqExportBtn = document.getElementById('li_exportDataQualityReport');
  if (dqExportBtn) dqExportBtn.addEventListener('click', ()=> downloadDataQualityReport());
}

/* ---------------- Capacity vs Promo Grid Target Calls QA ---------------- */
function computeCallsCapacityQA(){
  const groups = {};
  for (const r of REPS){
    if (r.vacant || r.crmCapacity==null || r.targetCallsPerCycle==null) continue;
    const key = r.line+'|'+r.plan;
    if (!groups[key]) groups[key] = {
      line:r.line, plan:r.plan,
      targetVisitsPerDay:r.targetVisitsPerDay, targetCallsPerCycle:r.targetCallsPerCycle,
      impliedPromoWorkingDays: r.targetVisitsPerDay ? round2(r.targetCallsPerCycle/r.targetVisitsPerDay) : null,
      gridWorkingDays: (PROMO_TARGETS[r.line] && PROMO_TARGETS[r.line][r.plan] && PROMO_TARGETS[r.line][r.plan].workingDaysGrid!=null)
        ? PROMO_TARGETS[r.line][r.plan].workingDaysGrid
        : (r.targetVisitsPerDay ? round2(r.targetCallsPerCycle/r.targetVisitsPerDay) : null),
      n:0, diffN:0, sumAbsDiff:0,
    };
    const g = groups[key];
    g.n++;
    const diff = r.crmCapacity - r.targetCallsPerCycle;
    if (diff!==0){ g.diffN++; g.sumAbsDiff += Math.abs(diff); }
  }
  const rows = Object.values(groups).sort((a,b)=> a.line.localeCompare(b.line) || a.plan.localeCompare(b.plan));
  const totalN = rows.reduce((s,g)=>s+g.n,0);
  const totalDiffN = rows.reduce((s,g)=>s+g.diffN,0);
  return { rows, totalN, totalDiffN };
}

function renderCallsCapacityQA(){
  const { rows, totalN, totalDiffN } = computeCallsCapacityQA();
  return `
    <div class="mini" style="margin:8px 0;"><b>${fmt(totalDiffN)}</b> of <b>${fmt(totalN)}</b> active reps (${fmt(totalN?round2(100*totalDiffN/totalN):0)}%) have a Capacity (standard working days) that differs from the Promo Grid's own flat Target Calls/Cycle. Where the grid's working days match the standard, the remaining difference comes from each rep's own CRM call rate.</div>
    <div class="li-scroll">
      <table class="data" style="min-width:820px;">
        <thead><tr><th>Line / Plan</th><th>Promo Grid Working Days</th><th>Standard working days</th><th>Match?</th><th>Promo Grid Visits/Day</th><th>Promo Grid Target Calls/Cycle</th><th>Active reps</th><th>Reps differing</th></tr></thead>
        <tbody>
          ${rows.map(g=>`<tr class="static">
            <td>${esc(g.line)} / ${esc(g.plan)}</td>
            <td class="li-num">${fmt(g.gridWorkingDays)}</td>
            <td class="li-num">${fmt(WD_RULE[g.plan])}</td>
            <td>${g.gridWorkingDays===WD_RULE[g.plan]? '<span class="li-pill within">match</span>' : `<span class="li-pill flag">${fmt(g.gridWorkingDays)} vs ${fmt(WD_RULE[g.plan])}</span>`}</td>
            <td class="li-num">${fmt(g.targetVisitsPerDay)}</td>
            <td class="li-num">${fmt(g.targetCallsPerCycle)}</td>
            <td class="li-num">${fmt(g.n)}</td>
            <td class="li-num">${fmt(g.diffN)} (${fmt(round2(100*g.diffN/g.n))}%)</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}


function computeHeadcountQA(){
  const lines = distinctSorted(REPS.map(r=>r.line));
  const perLine = lines.map(line=>{
    const pmAll = REPS.filter(r=>r.line===line && r.plan==='PM');
    const amAll = REPS.filter(r=>r.line===line && r.plan==='AM');
    const pmActive = pmAll.filter(r=>!r.vacant);
    const amActive = amAll.filter(r=>!r.vacant);
    const pmVacant = pmAll.filter(r=>r.vacant);
    const amVacant = amAll.filter(r=>r.vacant);
    const pmSet = new Set(pmActive.map(r=>r.employee));
    const amSet = new Set(amActive.map(r=>r.employee));
    const bothNames = pmActive.map(r=>r.employee).filter(e=>amSet.has(e));
    const pmOnlyCount = pmSet.size - bothNames.length;
    const amOnlyCount = amSet.size - bothNames.length;
    const unionSize = new Set([...pmSet, ...amSet]).size;
    const formulaSum = pmOnlyCount + bothNames.length + amOnlyCount;
    const formulaOK = formulaSum === unionSize;
    const pmPlanned = pmAll[0] ? pmAll[0].plannedMR : null;
    const amPlanned = amAll[0] ? amAll[0].plannedMR : null;
    const plannedMatch = pmPlanned===amPlanned;
    const identityLHS = pmSet.size + amSet.size - bothNames.length;
    const identityOK = identityLHS === unionSize;
    return {
      line, pmPlanned, amPlanned, plannedMatch,
      pmActive: pmSet.size, amActive: amSet.size,
      pmOnly: pmOnlyCount, amOnly: amOnlyCount, both: bothNames.length,
      uniqueActive: unionSize, formulaOK,
      pmVacant: pmVacant.length, amVacant: amVacant.length,
      combinedUniqueHC: unionSize,
      plannedDiff: (pmPlanned||0) + (amPlanned||0) - (plannedMatch ? (pmPlanned||0) : NaN),
      bothNames, identityOK,
    };
  });

  const pmActiveAll = new Set(REPS.filter(r=>r.plan==='PM'&&!r.vacant).map(r=>r.employee));
  const amActiveAll = new Set(REPS.filter(r=>r.plan==='AM'&&!r.vacant).map(r=>r.employee));
  const bothAll = [...pmActiveAll].filter(e=>amActiveAll.has(e));
  const unionAll = new Set([...pmActiveAll, ...amActiveAll]);
  const globalIdentityOK = (pmActiveAll.size + amActiveAll.size - bothAll.length) === unionAll.size;

  return { perLine, global: {
    pmTotal: pmActiveAll.size, amTotal: amActiveAll.size,
    bothTotal: bothAll.length, uniqueTotal: unionAll.size, identityOK: globalIdentityOK
  }};
}

function renderHeadcountQA(){
  const qa = computeHeadcountQA();
  const g = qa.global;
  const selectedLine = STATE.qaLine || qa.perLine[0].line;
  const lineData = qa.perLine.find(l=>l.line===selectedLine) || qa.perLine[0];
  // example line for the explanatory note: CHC when in scope (as in the standalone page), else the first line in scope
  const qaEx = qa.perLine.find(l=>l.line==='CHC') || qa.perLine[0];

  return `
  <div class="dq-item" id="li_headcountQAPanel">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
      <h3>Headcount Logic Validation</h3>
      <button class="btn" id="li_exportHeadcountRecon">Download Headcount Reconciliation</button>
    </div>
    <div class="mini">Validates that a representative covering both PM and AM for the same Line is counted once, not twice, in any combined headcount figure. This panel changes no data and feeds no calculation elsewhere in the dashboard — it is a read-only cross-check.</div>

    <div class="kpi-row" style="margin-top:10px;">
      ${kpi(g.pmTotal,'Total PM employees (active)')}
      ${kpi(g.amTotal,'Total AM employees (active)')}
      ${kpi(g.uniqueTotal,'Unique employees, PM+AM','info')}
      ${kpi(g.bothTotal,'Employees in both plans')}
    </div>
    <div class="mini" style="margin:6px 0 12px;">
      Identity check: PM (${g.pmTotal}) + AM (${g.amTotal}) − Both (${g.bothTotal}) = ${g.pmTotal+g.amTotal-g.bothTotal}, vs Unique = ${g.uniqueTotal} —
      ${g.identityOK ? '<span class="li-pill within">RECONCILES</span>' : '<span class="li-pill flag">HEADCOUNT RECONCILIATION ERROR</span>'}
    </div>

    <div class="li-scroll">
      <table class="data" style="min-width:1240px;">
        <thead><tr>
          <th>Line</th><th>PM Planned MR</th><th>AM Planned MR</th><th>Planned MR match</th>
          <th>PM Active</th><th>AM Active</th><th>PM-only</th><th>Both</th><th>AM-only</th>
          <th>Unique Active (PM-only+Both+AM-only)</th><th>Formula check</th>
          <th>PM Vacant</th><th>AM Vacant</th><th>Planned Field-Force HC</th><th>Current Unique Active HC</th>
        </tr></thead>
        <tbody>
          ${qa.perLine.map(l=>`<tr class="static" data-qaline="${esc(l.line)}" style="cursor:pointer;">
            <td>${esc(l.line)}</td>
            <td class="li-num">${fmt(l.pmPlanned)}</td>
            <td class="li-num">${fmt(l.amPlanned)}</td>
            <td>${l.plannedMatch? '<span class="li-pill within">match</span>' : '<span class="li-pill flag">HEADCOUNT RECONCILIATION ERROR</span>'}</td>
            <td class="li-num">${fmt(l.pmActive)}</td>
            <td class="li-num">${fmt(l.amActive)}</td>
            <td class="li-num">${fmt(l.pmOnly)}</td>
            <td class="li-num">${fmt(l.both)}</td>
            <td class="li-num">${fmt(l.amOnly)}</td>
            <td class="li-num">${fmt(l.uniqueActive)}</td>
            <td>${l.formulaOK? '<span class="li-pill within">PASS</span>' : '<span class="li-pill flag">HEADCOUNT RECONCILIATION ERROR</span>'}</td>
            <td class="li-num">${fmt(l.pmVacant)}</td>
            <td class="li-num">${fmt(l.amVacant)}</td>
            <td class="li-num">${fmt(l.pmPlanned)}</td>
            <td class="li-num">${fmt(l.uniqueActive)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="mini" style="margin:8px 0;">
      Formula used: Unique Active = PM-only + Both + AM-only (equivalently PM Active + AM Active − Both). Planned Field-Force HC and Current Unique Active HC are two different metrics and are never forced to match — e.g. ${esc(qaEx.line)}: Planned Field-Force HC = ${fmt(qaEx.pmPlanned)}, Current Unique Active HC = ${fmt(qaEx.uniqueActive)}. A gap between them (here, ${fmt((qaEx.uniqueActive||0) - (qaEx.pmPlanned||0))}) is expected and simply means today's active roster differs from the planned headcount — it is not an error to correct.
    </div>

    <div class="customer-toolbar" style="padding-left:0;padding-right:0;">
      <div class="field"><label>Employees in Both Plans — Line</label>
        <select id="li_qa_line_select">${qa.perLine.map(l=>`<option value="${esc(l.line)}" ${l.line===selectedLine?'selected':''}>${esc(l.line)} (${l.bothNames.length})</option>`).join('')}</select>
      </div>
    </div>
    <div class="li-scroll">
      <table class="data">
        <thead><tr><th>Employee</th><th>PM</th><th>AM</th><th>Counted HC</th></tr></thead>
        <tbody>
          ${lineData.bothNames.map(name=>`<tr class="static"><td>${esc(name)}</td><td>✓</td><td>✓</td><td class="li-num">1</td></tr>`).join('') || '<tr class="static"><td colspan="4" class="empty-note">No employees appear in both plans for this Line.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;
}

function csvEscape(v){
  if (v===null||v===undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
  return s;
}
function toCSV(headers, rows){
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\r\n');
}

// Dashboard build: always a normal browser download (the standalone page's
// Claude-artifact download capability does not exist inside the dashboard).
async function getDownloads(){ return null; }

// Standard browser download via an in-memory Blob and a throwaway <a download> link.
function browserDownload(filename, data){
  const isBinary = (typeof ArrayBuffer !== 'undefined') && (data instanceof ArrayBuffer || (ArrayBuffer.isView && ArrayBuffer.isView(data)));
  const mime = filename.endsWith('.xlsx')
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv;charset=utf-8;';
  const blob = isBinary ? new Blob([data], {type: mime}) : new Blob(['\ufeff'+data], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

// Preferred export path: a real .xlsx workbook via SheetJS (assets/xlsx.core.min.js, vendored locally).
// If that library did not load for any reason, falls back to .csv automatically —
// same headers/rows, just a different container format. Never blocks on this.
async function saveTable(filenameBase, headers, rows, sheetName){
  let filename, data;
  if (typeof XLSX !== 'undefined'){
    try {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, (sheetName||'Sheet1').slice(0,31));
      const buf = XLSX.write(wb, {bookType:'xlsx', type:'array'});
      filename = filenameBase + '.xlsx';
      data = buf;
    } catch(e){
      filename = filenameBase + '.csv';
      data = toCSV(headers, rows);
    }
  } else {
    filename = filenameBase + '.csv';
    data = toCSV(headers, rows);
  }

  const dl = await getDownloads();
  if (dl){
    try {
      await dl.save({filename, data});
      return;
    } catch(err){
      if (err && err.code==='declined') return;
      if (err && err.code==='rejected_extension' && filename.endsWith('.xlsx')){
        // Retry as CSV if xlsx itself was refused for some reason.
        try { await dl.save({filename: filenameBase+'.csv', data: toCSV(headers, rows)}); return; } catch(e2){ /* fall through to browser download below */ }
      }
      // Any other host error: fall through and try a plain browser download instead of just failing.
    }
  }
  try {
    browserDownload(filename, data);
  } catch(e){
    console.error('[ListIntel] download failed', e);
  }
}

/* ---------------- A) Current Customer List (global, filter-aware) ---------------- */
function getFilteredCustomerRows(f, toleranceOn){
  const reps = repScopeReps(f, toleranceOn);
  const out = [];
  for (const r of reps){
    const custs = custsFor(r);
    for (const c of custs){
      if (f.specialty && c[2]!==f.specialty) continue;
      if (f.cls && c[3]!==f.cls) continue;
      const target = freqTargetFor(r, c[3]);
      const dev = (target!==null && c[5]!=null) ? round2(c[5]-target) : null;
      out.push([r.bu, r.origLine, r.plan, r.area, r.manager, r.employee, r.vacant?'Vacant':'Active',
        c[0], c[1], r.title, c[2]||'', c[3], c[6]||'', c[5], target===null?'':target, dev===null?'':dev]);
    }
  }
  return out;
}
function downloadCurrentCustomerList(){
  const headers = ['Business Unit','Line','Plan','Area','Manager','Representative','Employee Status','Customer Name','Type','Title','Specialty','Class','Clinic Group','Frequency (List)','Frequency (Promo Grid)','Frequency Deviation'];
  const rows = getFilteredCustomerRows(STATE.filters, STATE.tolerance);
  const suffix = filterSuffix();
  saveTable('Current_Customer_List'+suffix, headers, rows, 'Customers');
}

/* ---------------- B) Rep Action List ---------------- */
function downloadRepActionList(reps){
  const headers = ['Business Unit','Line','Plan','Area','Manager','Representative','Employee Status','Target','Current','Raw Gap','Lower Limit','Upper Limit','Actionable Deviation','Status','Review Required','Planned Calls','Capacity','Capacity Flag'];
  const rows = reps.map(r=>{
    const m = repMetrics(r, STATE.tolerance);
    const reviewRequired = r.vacant ? 'N/A – Vacant' : (m.status==='WITHIN RANGE' ? 'No' : 'Yes');
    return [r.bu, r.origLine, r.plan, r.area, r.manager, r.employee, r.vacant?'Vacant':'Active',
      m.target, m.current, m.rawGap, m.lower, m.upper, r.vacant?'':m.deviation, m.displayStatus, reviewRequired,
      r.crmFreq, r.crmCapacity, ({OVER:'Over capacity',OK:'Capacity OK',UNDER:'Under capacity'})[capFlag(r)]||''];
  });
  saveTable('Rep_Action_List'+filterSuffix(), headers, rows, 'Rep Action List');
}

/* ---------------- C) Manager Action List ---------------- */
function downloadManagerActionList(reps){
  const headers = ['Business Unit','Line','Area','Manager','Representative','Plan','Target','Current','Raw Gap','Actionable Deviation','Status'];
  const rows = reps.map(r=>{
    const m = repMetrics(r, STATE.tolerance);
    return [r.bu, r.origLine, r.area, r.manager, r.employee, r.plan, m.target, m.current, m.rawGap, r.vacant?'':m.deviation, m.displayStatus];
  });
  saveTable('Manager_Action_List'+filterSuffix(), headers, rows, 'Manager Action List');
}

/* ---------------- D) Line Summary ---------------- */
function downloadLineSummary(lineAgg){
  const qa = computeHeadcountQA();
  const headers = ['Business Unit','Line','Plan','Planned Field Force HC','Current Unique Active HC','Vacant Positions','CRM Territories','Unassigned HC Gap','Target/Rep','Total Target','Current','Raw Gap','Actionable Deviation','Status'];
  const rows = lineAgg.map(g=>{
    const q = qa.perLine.find(l=>l.line===g.line);
    return [g.bu, g.line, g.plan, q?q.pmPlanned:g.plannedMR, q?q.uniqueActive:'', g.vacant, g.crmTotal, g.unassignedGap,
      g.targetPerRep, g.totalTarget, g.current, g.rawGap, g.deviation, g.status];
  });
  saveTable('Line_Summary'+filterSuffix(), headers, rows, 'Line Summary');
}

/* ---------------- E) Headcount Reconciliation ---------------- */
function downloadHeadcountReconciliation(){
  const qa = computeHeadcountQA();
  let rows = qa.perLine;
  if (STATE.filters.bu) rows = rows.filter(l=> REPS.find(r=>r.line===l.line)?.bu===STATE.filters.bu);
  if (STATE.filters.line) rows = rows.filter(l=>l.line===STATE.filters.line);
  const headers = ['Line','PM Planned MR','AM Planned MR','PM Active HC','AM Active HC','Employees in Both','Unique Active HC','PM-only','AM-only','Headcount Reconciliation Status'];
  const outRows = rows.map(l=>[l.line, l.pmPlanned, l.amPlanned, l.pmActive, l.amActive, l.both, l.uniqueActive, l.pmOnly, l.amOnly,
    (l.plannedMatch && l.formulaOK) ? 'RECONCILES' : 'HEADCOUNT RECONCILIATION ERROR']);
  saveTable('Headcount_Reconciliation'+filterSuffix(true), headers, outRows, 'Headcount Reconciliation');
}

/* ---------------- F) Data Quality / Reconciliation ---------------- */
function computeReconExportRows(){
  const rows = [];
  for (const line in PROMO_TARGETS){
    for (const plan of ['PM','AM']){
      const e = PROMO_TARGETS[line][plan];
      if (!e || !e.reconFlag) continue;
      if (STATE.filters.line && STATE.filters.line!==line) continue;
      if (STATE.filters.plan && STATE.filters.plan!==plan) continue;
      const hasPerRep = e.reconNotes.some(n=>n.includes('sum of A1-C3/rep')||n.includes('segmentation Total row/rep'));
      const hasLineLevel = e.reconNotes.some(n=>n.includes('Per-rep x MR'));
      const issueType = [hasPerRep&&'Per-Rep', hasLineLevel&&'Line-Level'].filter(Boolean).join(' + ') || 'Other';
      rows.push([line, plan, issueType, e.targetPerRep, e.sumClassesPerRep,
        e.segTotalRowPerRep===null||e.segTotalRowPerRep===undefined?'(not entered)':e.segTotalRowPerRep,
        'PROMO GRID RECONCILIATION ISSUE', e.reconNotes.join('; ')]);
    }
  }
  return rows;
}
function downloadDataQualityReport(){
  const headers = ['Line','Plan','Issue Type','Flat Target','A1-C3 Sum','Segmentation Total','Status','Explanation'];
  const rows = computeReconExportRows();
  saveTable('Data_Quality_Report'+filterSuffix(true), headers, rows, 'Data Quality');
}

/* ---------------- per-rep Customer Review List (kept) ---------------- */
function downloadCustomerReviewList(rep, custs){
  const headers = ['Representative','Line','Plan','Manager','Area','Customer Name','Type','Specialty','Class','Frequency (List)','Frequency (Promo Grid)','Frequency Deviation','Clinic Group'];
  const rows = custs.map(c=>{
    const target = freqTargetFor(rep, c[3]);
    const dev = (target!==null && c[5]!=null) ? round2(c[5]-target) : null;
    return [rep.employee, rep.origLine, rep.plan, rep.manager, rep.area, c[0], c[1], c[2]||'', c[3], c[5], target===null?'':target, dev===null?'':dev, c[6]||''];
  });
  saveTable(`Customer_Review_${rep.employee.replace(/[^a-z0-9]+/gi,'_')}`, headers, rows, 'Customers');
}

// Builds a short, human-readable filename suffix from the currently active filters,
// so a downloaded file's name reflects what it actually contains (e.g. "_CHC_PM").
// includeAreaManager=true also folds Area/Manager in, for exports where those apply.
function filterSuffix(lineOnly){
  const f = STATE.filters;
  const parts = [];
  if (f.bu) parts.push(f.bu);
  if (f.line) parts.push(f.line);
  if (f.plan) parts.push(f.plan);
  if (!lineOnly){
    if (f.area) parts.push(f.area);
    if (f.manager) parts.push(f.manager);
    if (f.repSearch) parts.push(f.repSearch);
    if (f.activeVacant!=='all') parts.push(f.activeVacant);
    if (f.deviationView!=='all') parts.push(f.deviationView.replace(' ','_'));
    if (f.specialty) parts.push(f.specialty);
    if (f.cls) parts.push(f.cls);
  }
  const cleaned = parts.map(p=>String(p).replace(/[^a-z0-9]+/gi,'_')).filter(Boolean);
  if (cleaned.length) return '_'+cleaned.join('_');
  // a line-scoped login never gets a misleading "_All" file name
  if (SCOPE && !SCOPE.all) return '_'+SCOPE.lines.map(l=>String(l).replace(/[^a-z0-9]+/gi,'_')).join('_');
  return '_All';
}

/* ---------------- init ---------------- */
let _tipsWired = false;
function initTooltips(){
  if (_tipsWired) return;
  _tipsWired = true;
  const tip = document.createElement('div');
  tip.id = 'li_tooltipPopover';
  document.body.appendChild(tip);

  function place(target){
    const rect = target.getBoundingClientRect();
    tip.style.left = '0px'; tip.style.top = '0px'; // reset before measuring
    tip.style.display = 'block';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
    if (left < 8) left = 8;
    if (top + th > window.innerHeight - 8) top = rect.top - th - 6; // flip above if no room below
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function show(el){
    const msg = el.getAttribute('data-tip');
    if (!msg) return;
    tip.textContent = msg;
    place(el);
  }
  function hide(){ tip.style.display = 'none'; }

  // Only this page's own [data-tip] elements (never another tab's markup).
  const own = e => e.target && e.target.closest ? e.target.closest('.li-root [data-tip]') : null;
  document.addEventListener('mouseover', e=>{ const el = own(e); if (el) show(el); });
  document.addEventListener('mouseout', e=>{ const el = own(e); if (el) hide(); });
  document.addEventListener('focusin', e=>{ const el = own(e); if (el) show(el); });
  document.addEventListener('focusout', e=>{ const el = own(e); if (el) hide(); });
  window.addEventListener('scroll', hide, true);
}


/* ================= capacity KPIs + Insights & Actions (2026-09-25) ================= */
function capacityKpis(reps){
  const c = {OVER:0, OK:0, UNDER:0};
  for (const r of reps){ const f = capFlag(r); if (f) c[f]++; }
  const n = c.OVER + c.OK + c.UNDER;
  if (!n) return '';
  const pct = v => n ? Math.round(100*v/n) + '%' : '—';
  return `<div class="kpi-row-label">Call capacity — planned calls vs capacity (call rate × ${fmt(WD_RULE.PM)} PM / × ${fmt(WD_RULE.AM)} AM${STATE.tolerance?', ±10% = OK':', exact'})</div>
    <div class="kpi-row">
      ${kpi(c.OVER, 'Over capacity · ' + pct(c.OVER), c.OVER ? 'warn' : 'good')}
      ${kpi(c.OK, 'Capacity OK · ' + pct(c.OK), 'good')}
      ${kpi(c.UNDER, 'Under capacity · ' + pct(c.UNDER), c.UNDER ? 'warn' : 'good')}
    </div>`;
}

const A_CLASSES = ['A1','A2','A3'];
function insTone(ok, warn){ return ok ? 'good' : (warn ? 'mid' : 'bad'); }

function computeInsights(scope){
  const act = scope.filter(r => !r.vacant);
  // L1 list size
  const l1 = {within:0, below:0, above:0};
  for (const r of act){ const st = repMetrics(r, STATE.tolerance).status; if (st==='WITHIN RANGE') l1.within++; else if (st==='BELOW RANGE') l1.below++; else l1.above++; }
  l1.n = act.length; l1.pct = l1.n ? Math.round(100*l1.within/l1.n) : 0;
  // per-line accumulators
  const L = {};
  const line = r => L[r.line] || (L[r.line] = {line:r.line, bu:r.bu, aCur:0, pmTot:0, aT:0, tT:0, aDocs:0, aBelow:0, over:0, ok:0, under:0, vacCust:0, others:0, reps:0});
  const repA = [];
  for (const r of scope){
    const g = line(r);
    if (r.vacant){ g.vacCust += r.current || 0; continue; }
    g.reps++;
    g.others += (r.classesCurrent && r.classesCurrent.Others) || 0;
    const f = capFlag(r); if (f==='OVER') g.over++; else if (f==='OK') g.ok++; else if (f==='UNDER') g.under++;
    if (r.plan==='PM' && r.classesTarget){
      g.aCur += A_CLASSES.reduce((s,k)=>s+(r.classesCurrent[k]||0),0); g.pmTot += r.current||0;
      g.aT += A_CLASSES.reduce((s,k)=>s+(r.classesTarget[k]||0),0);
      g.tT += CLASS_KEYS.reduce((s,k)=>s+(r.classesTarget[k]||0),0);
    }
    if (r.plan==='PM' && r.classesFreqTarget){
      let docs=0, below=0;
      for (const c of custsFor(r)){
        if (!A_CLASSES.includes(c[3])) continue;
        const ft = r.classesFreqTarget[c[3]]; if (ft==null || c[5]==null) continue;
        docs++; if (c[5] < ft) below++;
      }
      g.aDocs += docs; g.aBelow += below;
      if (below) repA.push({r, docs, below});
    }
  }
  // duplicates: same doctor (name + area) on >1 active PM list within a line
  const seen = {};
  for (const r of act){ if (r.plan!=='PM') continue;
    for (const c of custsFor(r)){ const k = r.line+'\u0001'+c[0]+'\u0001'+(c[4]||''); (seen[k] || (seen[k] = new Set())).add(r.employee); } }
  let dup = 0; const dupByLine = {};
  for (const k in seen) if (seen[k].size > 1){ dup++; const ln = k.split('\u0001')[0]; dupByLine[ln] = (dupByLine[ln]||0) + 1; }
  const lines = Object.values(L).sort((a,b)=>a.bu.localeCompare(b.bu)||a.line.localeCompare(b.line));
  const tot = lines.reduce((t,g)=>{ for (const k of ['aDocs','aBelow','over','ok','under','vacCust','others']) t[k]=(t[k]||0)+g[k]; return t; }, {});
  repA.sort((a,b)=> b.below - a.below || a.r.employee.localeCompare(b.r.employee));
  let recon = 0; for (const ln in PROMO_TARGETS) for (const p of ['PM','AM']) if ((!STATE.filters.plan || STATE.filters.plan===p) && PROMO_TARGETS[ln][p] && PROMO_TARGETS[ln][p].reconFlag && L[ln]) recon++;
  return {l1, lines, tot, dup, dupByLine, repA: repA.slice(0, 15), recon};
}

function renderInsights(){
  const main = document.getElementById('li_main');
  const scope = lineScopeReps(STATE.filters);
  const I = computeInsights(scope);
  const t = I.tot;
  const aPct = t.aDocs ? Math.round(100*t.aBelow/t.aDocs) : 0;
  const capN = (t.over||0)+(t.ok||0)+(t.under||0);
  const segRows = I.lines.filter(g=>g.pmTot && g.tT).map(g=>{
    const cur = Math.round(100*g.aCur/g.pmTot), tgt = Math.round(100*g.aT/g.tT), gap = cur - tgt;
    const flag = gap > 10 ? ['bad','Inflated A-class','Re-validate classification'] : gap < -10 ? ['mid','Too few A-class','Add / upgrade A-class doctors'] : ['good','On target','Maintain'];
    return {g, cur, tgt, gap, flag};
  });
  const segIssues = segRows.filter(x=>x.flag[0]!=='good').length;
  const card = (n, title, label, big, detail, tone, action) => `
    <div class="ins-card ${tone}">
      <div class="ins-n">${n}</div>
      <div class="ins-title">${title}</div>
      <div class="ins-value">${label}</div>
      <div class="ins-big">${big}</div>
      <div class="ins-sub">${detail}</div>
      <div class="ins-action"><b>Action:</b> ${action}</div>
    </div>`;
  main.innerHTML = `
    ${filterBar('overview')}
    <div class="panel"><div class="panel-head"><div>
      <h2>Insights &amp; Actions — five best-practice checks</h2>
      <div class="desc">Size → Mix → Frequency → Capacity → Hygiene. Calculated live on your scope and the Business Unit / Line / Plan filters above (tolerance ${STATE.tolerance?'±10%':'exact'}). Frequency here is the <b>planned</b> frequency on the CRM list — read it together with Operational and Execution (actual visits). Click any line row to open its representatives.</div>
    </div></div>
    <div class="ins-grid">
      ${card(1,'List size','% reps within target', `<b>${I.l1.pct}%</b> within`, `${fmt(I.l1.within)} within · ${fmt(I.l1.below)} below · ${fmt(I.l1.above)} above (of ${fmt(I.l1.n)} active)`, insTone(I.l1.pct>=80, I.l1.pct>=60), 'aim ≥ 80% within band; fix "below" lists first (missing reach).')}
      ${card(2,'Segment mix','A-class share vs target (PM)', `<b>${segIssues}</b> line${segIssues===1?'':'s'} off target`, `more than ±10 pts from the Promo Grid A-class share`, insTone(segIssues===0, segIssues<=2), 're-classify where A-class is inflated; add A-class where short.')}
      ${card(3,'A-class frequency','A-class doctors planned below grid', `<b>${aPct}%</b>`, `${fmt(t.aBelow||0)} of ${fmt(t.aDocs||0)} A-class doctors`, insTone(aPct<=10, aPct<=25), 'shift planned visits from C / B3 to A1–A3.')}
      ${card(4,'Capacity balance','planned calls vs capacity', `<b>${fmt(t.over||0)}</b> over · <b>${fmt(t.under||0)}</b> under`, `${fmt(t.ok||0)} of ${fmt(capN)} reps capacity OK`, insTone(capN && (t.ok/capN)>=0.8, capN && (t.ok/capN)>=0.5), 'over → trim C-class / split territory; under → add doctors or frequency.')}
      ${card(5,'List hygiene','can the list be trusted?', `<b>${fmt(t.vacCust||0)}</b> on vacancies`, `${fmt(I.dup)} doctors on >1 list in a line · ${fmt(t.others||0)} unclassified · ${fmt(I.recon)} grid issues`, insTone(!(t.vacCust||I.dup||t.others), (t.vacCust||0)<500), 'reassign vacant-territory A-class doctors; remove duplicates; classify all.')}
    </div></div>

    <div class="panel"><div class="panel-head"><div><h2>By line</h2>
      <div class="desc">One row per line in scope. A-class share uses the PM physician list; capacity and hygiene use every active rep in scope.</div></div></div>
      <div class="li-scroll"><table class="data" id="li_insTable">
        <thead><tr><th>Line</th><th>BU</th><th>A-class actual</th><th>A-class target</th><th>Gap (pts)</th><th>Mix flag</th><th>A-class below grid freq.</th><th>Over cap.</th><th>Cap. OK</th><th>Under cap.</th><th>Customers on vacancies</th><th>Duplicate doctors</th><th>Suggested action</th></tr></thead>
        <tbody>${I.lines.map(g=>{
          const s = segRows.find(x=>x.g===g);
          const ab = g.aDocs ? Math.round(100*g.aBelow/g.aDocs) : null;
          const acts = [];
          if (s && s.flag[0]!=='good') acts.push(s.flag[2]);
          if (ab!==null && ab>25) acts.push('Raise A-class frequency');
          if (g.over > g.ok) acts.push('Trim overloaded lists');
          if (g.under > g.ok) acts.push('Use spare capacity');
          if (g.vacCust) acts.push('Cover vacant-territory A-class');
          return `<tr data-insline="${esc(g.line)}">
            <td>${esc(g.line)}</td><td>${esc(g.bu)}</td>
            <td class="li-num">${s?s.cur+'%':'—'}</td><td class="li-num">${s?s.tgt+'%':'—'}</td>
            <td class="li-num">${s?(s.gap>0?'+':'')+s.gap:'—'}</td>
            <td>${s?`<span class="li-pill ins-${s.flag[0]}">${s.flag[1]}</span>`:'<span class="mini">no PM segmentation</span>'}</td>
            <td class="li-num">${ab===null?'—':ab+'% <span class="mini">('+fmt(g.aBelow)+'/'+fmt(g.aDocs)+')</span>'}</td>
            <td class="li-num">${fmt(g.over)}</td><td class="li-num">${fmt(g.ok)}</td><td class="li-num">${fmt(g.under)}</td>
            <td class="li-num">${fmt(g.vacCust)}</td><td class="li-num">${fmt(I.dupByLine[g.line]||0)}</td>
            <td class="action-note">${acts.join(' · ') || 'On track'}</td></tr>`; }).join('')}</tbody>
      </table></div>
    </div>

    <div class="panel"><div class="panel-head"><div><h2>Where to start — reps with the most A-class doctors planned below grid frequency</h2>
      <div class="desc">Top ${I.repA.length} in scope. Click a row to open the rep's segmentation and PM customer list.</div></div></div>
      <div class="li-scroll"><table class="data" id="li_insReps">
        <thead><tr><th>Representative</th><th>Line</th><th>Area</th><th>Manager</th><th>A-class doctors</th><th>Below grid freq.</th><th>Share</th><th>Capacity</th></tr></thead>
        <tbody>${I.repA.map(x=>`<tr data-insrep="${esc(repKey(x.r))}">
          <td>${esc(x.r.employee)}</td><td>${esc(x.r.line)}</td><td>${esc(x.r.area)}</td><td>${esc(x.r.manager)}</td>
          <td class="li-num">${fmt(x.docs)}</td><td class="li-num">${fmt(x.below)}</td><td class="li-num">${Math.round(100*x.below/x.docs)}%</td><td>${capPill(x.r)}</td></tr>`).join('') || '<tr class="static"><td colspan="8" class="empty-note">No A-class doctors planned below grid frequency in this scope.</td></tr>'}</tbody>
      </table></div>
    </div>`;
  wireFilterBar('overview');
  main.querySelectorAll('#li_insTable tr[data-insline]').forEach(tr=>tr.addEventListener('click', ()=>{
    STATE.filters.line = tr.dataset.insline; STATE.selectedLine = null; STATE.expandedRepKey = null; STATE.tab = 'reps'; render();
  }));
  main.querySelectorAll('#li_insReps tr[data-insrep]').forEach(tr=>tr.addEventListener('click', ()=>{
    const r = REPS.find(x=>repKey(x)===tr.dataset.insrep); if (!r) return;
    STATE.filters.line = r.line; STATE.filters.plan = r.plan; STATE.selectedLine = {line:r.line, plan:r.plan};
    STATE.expandedRepKey = repKey(r); STATE.custPage = 0; STATE.custFilters = {type:'',specialty:'',cls:''}; STATE.tab = 'reps'; render();
  }));
}

/* ================= dashboard integration ================= */
function shellHtml() {
  const asOf = META.sources && META.sources.listsModified ? META.sources.listsModified.slice(0, 10) : '';
  const nLines = Object.keys(PROMO_TARGETS).length;
  return `<div class="li-root">
    <div class="li-head">
      <div>
        <div class="li-title-row"><span class="li-tag">FIELD FORCE</span><h1>List Intelligence</h1></div>
        <div class="li-sub">CRM customer lists vs Promo Grid targets · ${nLines} line${nLines === 1 ? '' : 's'} · Physicians (PM) &amp; AM Accounts plans · Pharmacy out of scope${asOf ? ' · CRM lists as of ' + esc(asOf) : ''}</div>
        ${SCOPE && !SCOPE.all ? `<div class="li-scope">Your view: ${SCOPE.lines.map(esc).join(', ')} only</div>` : ''}
      </div>
      <div class="li-tol">
        <span class="lbl">Tolerance</span>
        <button class="toggle ${STATE.tolerance ? 'on' : ''}" id="li_toleranceToggle" aria-label="Toggle ±10% tolerance band"></button>
        <span class="tol-band" id="li_tolBandLabel"></span>
      </div>
    </div>
    <div class="tabs" id="li_tabs"></div>
    <div class="crumbbar" id="li_crumbs"></div>
    <div class="main" id="li_main"></div>
    <footer class="credit">Target = flat per-rep Promo Grid figure · Current = CRM Total PM/AM Lists · Capacity = call rate × ${fmt(WD_RULE.PM)} (PM) / × ${fmt(WD_RULE.AM)} (AM) working days · Pharmacy plan excluded · Built ${esc(META.builtAt || '')}</footer>
  </div>`;
}

function message(container, icon, title, hint) {
  container.innerHTML = window.DS
    ? `<div class="ds-page"><div style="max-width:560px;margin:80px auto;text-align:center;">${window.DS.emptyState({ icon, title, hint })}</div></div>`
    : `<p style="padding:40px;text-align:center;">${esc(title)} — ${esc(hint)}</p>`;
}

function wireCapacityCards() {
  const main = document.getElementById('li_main');
  if (!main || main.__liCapWired) return;
  main.__liCapWired = true;
  main.addEventListener('click', e => {
    const card = e.target.closest && e.target.closest('[data-capline]');
    if (!card) return;
    STATE.filters.line = card.getAttribute('data-capline');
    STATE.tab = 'overview';
    render();
  });
}

window.ListIntelDashboard = {
  canView: canViewPage,
  init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    document.body.classList.add('list-intel-mode');
    if (!canViewPage()) {
      message(container, '\u{1F512}', 'Access restricted', 'List Intelligence is available to CEO, VP / Commercial Lead, SFE Manager, BEx, Admin, BU Managers and Line Managers (own lines).');
      return;
    }
    if (!loadCache()) {
      message(container, '\u{1F4C2}', 'List Intelligence data not found', 'Run refresh.bat (etl\\build_list_intel_cache.py) to build cache/list_intel.data.js.');
      return;
    }
    applyScope(currentScope());
    if (!REPS.length) {
      message(container, '\u{1F4ED}', 'No representatives for your lines', 'Your login\'s lines (' + (SCOPE && SCOPE.lines ? SCOPE.lines.join(', ') : '-') + ') have no rows in the current CRM lists.');
      return;
    }
    container.innerHTML = shellHtml();
    initTooltips();
    document.getElementById('li_toleranceToggle').addEventListener('click', () => {
      STATE.tolerance = !STATE.tolerance;
      render();
    });
    wireCapacityCards();
    render();
  },
  destroy() {
    document.body.classList.remove('list-intel-mode');
    const tip = document.getElementById('li_tooltipPopover');
    if (tip) tip.style.display = 'none';
  },
  /** Read-only accessor for tests / a future Ask provider. */
  _debug() { return { reps: REPS.length, customers: Object.keys(CUSTOMERS).length, lines: Object.keys(PROMO_TARGETS).length, scope: SCOPE, state: STATE }; },
};
})();
