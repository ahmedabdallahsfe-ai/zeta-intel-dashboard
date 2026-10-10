/* iqvia-geo.js — Territory Market Insights (IQVIA geo & territory view). LOCAL ONLY for now. Data: window.IQVIA_GEO_CACHE (cache/iqvia_geo.data.js,
   built by etl/build_iqvia_geo_cache.py). Mount: IqviaGeo.mount(el). Ids prefixed "ig-", CSS scoped to .igeo.
   Generated from the approved prototype by conv.py; opened from the dashboard sidebar (app.js renderTerritoryMarketTab). */
(function(global){
  'use strict';
  function decode(){var c=global.IQVIA_GEO_CACHE; if(!c||!c.b64Data||typeof pako==='undefined') return null;
    var bin=atob(c.b64Data), bytes=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    return JSON.parse(pako.ungzip(bytes,{to:'string'}));}
  var MARKUP=`<div class="wrap">
  <header class="top">
    <div>
      <h1>Territory Market Insights</h1>
      <div class="sub">IQVIA retail audit by brick and sales position — where the market is, where Zeta is below its national share, and which positions to act on first.</div>
    </div>
    <div class="sub" id="ig-asof"></div>
  </header>

  <section class="card controls" aria-label="Filters">
    <div class="ctl"><label for="ig-fBU">Business unit</label><select id="ig-fBU"></select></div>
    <div class="ctl"><label for="ig-fLine">Line</label><select id="ig-fLine"></select></div>
    <div class="ctl" style="flex:1 1 240px"><label for="ig-fMkt">Defined market (DM1)</label><select id="ig-fMkt"></select></div>
    <div class="ctl" style="flex:1 1 200px"><label for="ig-fD2">Defined market (DM2)</label><select id="ig-fD2"></select></div>
    <div class="ctl"><label for="ig-fPt">Period</label><select id="ig-fPt"><option value="mat">MAT (last 12 months)</option><option value="ytd">YTD</option><option value="r3">Rolling 3 months</option><option value="r6">Rolling 6 months</option><option value="q">Quarter</option><option value="m">Single month</option><option value="cy">Calendar year</option><option value="cus">Custom range</option></select></div>
    <div class="ctl" id="ig-pSub1" hidden><label for="ig-fPs1" id="ig-pSub1L">Quarter</label><select id="ig-fPs1"></select></div>
    <div class="ctl" id="ig-pSub2" hidden><label for="ig-fPs2">To</label><select id="ig-fPs2"></select></div>
    <div class="ctl"><label>Measure</label><div class="seg" id="ig-fMeas"><button data-v="v" aria-pressed="true">Value (EGP)</button><button data-v="u" aria-pressed="false">Units</button></div></div>
    <div class="ctl"><label>Sector</label><div class="seg" id="ig-fSec"><button data-v="0" aria-pressed="true">Pharmacies</button><button data-v="1" aria-pressed="false">Stores</button><button data-v="all" aria-pressed="false">All</button></div></div>
    <div class="ctl"><label>Brands IQVIA reports nationally only</label><label class="toggle" for="ig-fAlloc" title="Some Zeta brands (e.g. NEXICURE sachet, ZETAZOLEX, BILASTIGEC) are reported by IQVIA for Egypt as a whole, not by brick. When this is on, their national IQVIA sales are split across positions using each position&#39;s share of Zeta&#39;s own sales (Q1–Q3 2026) and marked ≈. Good for direction and priorities — not for targets, incentives or rep ranking."><input type="checkbox" id="ig-fAlloc"> Add estimated Zeta sales <span class="info">ⓘ</span></label></div>
  </section>

  <div class="dq" id="ig-dq"></div>
  <div id="ig-warn"></div>
  <section class="kpis" id="ig-kpis" aria-label="Headline KPIs"></section>
  <div id="ig-allocCard"></div>

  <section class="card">
    <h2>Region contribution — Zeta vs market vs competitors</h2>
    <div class="sub">How much of the national market and of Zeta sales each region delivers, and who owns the share there.</div>
    <div class="rgrid">
      <div><div id="ig-rcBars"></div><div class="legend" id="ig-rcLeg"></div></div>
      <div><div class="dh">Brand share by region (share vs tracked market)</div><div id="ig-stBars"></div><div class="legend" id="ig-stLeg"></div></div>
    </div>
  </section>

  <section class="card">
    <h2>Competitor scorecard</h2>
    <div class="sub">All brands IQVIA tracks in the selection, ranked by sales. <b>Share change</b> = points gained or lost vs the same months last year · <b>Evolution Index</b> above 100 = growing faster than the market.</div>
    <div class="tbl-wrap" style="max-height:360px"><table class="dt" id="ig-cTbl"></table></div>
    <p class="foot" id="ig-cNote"></p>
  </section>

  <section class="card">
    <h2>Where to act — positions</h2>
    <div class="sub">Every position grouped by the next action, using its <b>Fair Share Index</b> (Zeta share in the position ÷ Zeta share across the line × 100; 100 = in line) and whether it is vacant. <b>Click a group</b> to list its positions, <b>click a position</b> for its full profile.</div>
    <table class="segtbl" id="ig-psegTbl"></table>
    <p class="foot" id="ig-psegNote"></p>
  </section>

  <section class="card">
    <h2>All positions — Zeta vs competitors</h2>
    <div class="sub"><b>How to read:</b> <b>Market</b> = size and growth of the market the position covers · <b>Zeta</b> = sales, growth and share in the position · <b>Fair Share Index</b> 100 = same share as nationally, <span class="idx i-lo">below 90</span> under-performing, <span class="idx i-hi">above 110</span> over-performing · <b>Evolution Index</b> above 100 = Zeta growing faster than the market · <b>% of national</b> = part of the national total that sits in this position · competitor cells = share, Fair Share Index, points gained/lost vs last year, growth. Click ▸ for the bricks, click a row for the position profile.</div>
    <div class="toolbar"><div id="ig-pRegChips" style="display:flex;flex-wrap:wrap;gap:6px" role="group" aria-label="Region filter"></div></div>
    <div class="toolbar"><input type="search" id="ig-pSearch" placeholder="Search position, rep or DM" aria-label="Search position, rep or DM"><span class="foot" id="ig-pSum"></span></div>
    <div class="tbl-wrap"><table class="dt" id="ig-pTbl"></table></div>
    <button class="more" id="ig-pMore" hidden>Show all positions</button>
  </section>

  <section class="card defs">
    <details class="defs" id="ig-defs">
      <summary>KPI definitions and governance rules used on this page</summary>
      <table>
        <tr><th>KPI</th><th>Formula</th><th>Rule</th></tr>
        <tr><td>Market value</td><td><code>Σ IQVIA LC value, tracked brands of the selected market(s)</code></td><td>IQVIA Actual only. Default sector Pharmacies; Stores are recorded at the wholesaler.</td></tr>
        <tr><td>Share vs tracked competitors</td><td><code>Zeta ÷ (Zeta + competitor brands IQVIA delivers)</code></td><td>Never labelled "Market Share". Value or Units measure (toggle); the other measure's share is shown in the KPI row.</td></tr>
        <tr><td>Growth</td><td><code>period ÷ same period last year − 1</code></td><td>Any period (MAT, YTD, rolling 3/6 months, quarter, month, calendar year, custom) vs the same months last year. If last year's months are not in the IQVIA delivery (before Sep-24) growth shows n/a.</td></tr>
        <tr><td>Evolution Index (EI)</td><td><code>100 × (1 + Zeta growth) ÷ (1 + market growth)</code></td><td>&gt;100 = gaining share.</td></tr>
        <tr><td>Fair Share Index</td><td><code>brick share ÷ national share × 100</code></td><td>&lt;90 under-indexed · 90–110 in line · &gt;110 over-indexed.</td></tr>
        <tr><td>Gap to fair share (EGP)</td><td><code>max(0, national share − brick share) × brick market</code></td><td>Value Zeta would add at national share. Summed = opportunity.</td></tr>
        <tr><td>Segment</td><td><code>Large = brick market ≥ median of qualifying bricks</code></td><td>Grow: large &amp; index &lt;90 · Defend: large &amp; &gt;110 · Maintain: large &amp; 90–110 · Develop: small &amp; market growing faster than national · Monitor: other small.</td></tr>
        <tr><td>Discontinuity flag ⚠</td><td><code>|brick growth| &gt; 60%</code></td><td>Usually an IQVIA brick re-split (e.g. BRICK1/BRICK2 boundary change). Check before acting on growth or EI.</td></tr>
        <tr><td>Low base</td><td><code>brick market value &lt; EGP 250K × months in period ÷ 12</code></td><td>Share, index and segment suppressed (shown as “low base”).</td></tr>
        <tr><td>Region contribution</td><td><code>region value ÷ national value</code> (market and Zeta)</td><td>Region index = Zeta contribution ÷ market contribution × 100 (same as region share ÷ national share).</td></tr>
        <tr><td>Competitor Δ share</td><td><code>(brand ÷ tracked market) − same ratio last year</code></td><td>In percentage points. Brand colours are fixed per market selection: Zeta first, then the top 5 competitors by national value.</td></tr>
        <tr><td>Where to act (position groups)</td><td><code>vacant → Fill vacancy · Fair Share Index &lt;90 → Close the gap · &gt;110 → Protect · 90–110 → On track</code></td><td>Fair Share Index at position level = position Zeta share ÷ Zeta share of all positions in the line × 100. Gap = sales Zeta would add at that line share.</td></tr>
        <tr><td>Position geo share</td><td><code>position market ÷ national market of the line · position Zeta ÷ national Zeta of the line</code></td><td>Where the line's market and Zeta business sit. Brick rows show the full brick ÷ national.</td></tr>
        <tr><td>Position potential</td><td><code>Σ brick market × Allocation % (organogram Share ÷ Σ Shares in brick-line)</code></td><td>Additive. Responsibility credit (100% each) is never totalled.</td></tr>
        <tr><td>Zeta brand allocation</td><td><code>IQVIA national Pharmacies YTD × position share of Zeta sales</code></td><td>Directional only (back-test ≈20% position error). Hatched. "Of which" brands never added to IQVIA rows. Not for incentives, ranking or targets.</td></tr>
        <tr><td>≈ Estimated Zeta sales (brands IQVIA reports nationally only)</td><td><code>IQVIA_SOURCE national month × position share of Zeta in-house sales (Q1–Q3 2026, IsTender = FALSE; Pharmacies and Stores+SubAgent separately)</code></td><td>For Zeta brands IQVIA does not deliver by territory (NEXICURE sachet, DUXNORZET 60, ZETAZOLEX, EPILOSAMIDE, PRUCANETIC, ULCEBISMO). Market = Zeta + tracked competitors; a brand inside an IQVIA molecule total (DUXNORZET 60 in “Duloxetine 60”) is carved out of that total, never added. Position level only (no brick split). Fixed 2026 position share, so Zeta growth by region / position follows the national trend. Directional (≈20% position error); not for incentives, ranking or targets. Switch off with the toggle. Also MEDIHYALO, NEXIROZOVA (carved out of the rosuvastatin total “Rosuvastatin Mono solid”), BILASTIGEC tablets (carved out of “Total BILASTINE Tablet”) and BILASTIGEC syrup (IQVIA_SOURCE by sector × in-house share).</td></tr>
        <tr><td>Form split</td><td><code>brick value × national form share (IQVIA_SOURCE, month × sector)</code></td><td>IQVIA territory “Evastine” = tablets + oral solution. Tablets stay in BELASTINE_CETRIZINE TAB MKT (Derma); oral solution goes to the PEDIA market ORAL SELECTED ANTIHISTAMIN… (vs BILASTIGEC syrup). Totals unchanged; assumes the national form mix in every brick.</td></tr>
      </table>
    </details>
  </section>
  <p class="foot" id="ig-srcFoot"></p>
</div>
<aside class="drawer" id="ig-drawer" hidden aria-label="Brick detail"></aside>`;
  function mount(root){
    const D=decode();
    if(!D){ root.innerHTML='<div style="padding:24px;font:14px sans-serif">IQVIA Geo cache not loaded (cache/iqvia_geo.data.js).</div>'; return; }
    root.classList.add('igeo'); root.innerHTML=MARKUP;


const $=s=>root.querySelector(s);
const ST={segOpen:'Close the gap',segAll:'',bu:'',line:'GIT-I',mkt:'',d2:'',ptype:'mat',meas:'v',pqtr:'',pmon:'',pyr:'',pfrom:'',pto:'',sec:'0',alloc:false,anc:true,region:'ALL',bq:'',pq:'',pAll:false,bSort:'gap',bDir:-1,open:new Set()};
const SEGS=['Grow','Defend','Maintain','Develop','Monitor'];
const SEGACT={Grow:'Raise frequency and targeting — biggest EGP gap',Defend:'Protect coverage; watch competitor launches',Maintain:'Hold call plan; track EI monthly',Develop:'Build selectively where market is accelerating',Monitor:'Low effort; review quarterly'};
const SEGCOL={Grow:'var(--grow)',Defend:'var(--defend)',Maintain:'var(--maintain)',Develop:'var(--develop)',Monitor:'var(--monitor)'};
const REG=[...new Set(D.bricks.map(b=>b.r))].sort();
const lineOfMkt=D.markets.map(m=>m.line), buOfLine={};
D.markets.forEach(m=>buOfLine[m.line]=m.bu);
const fmt=v=>{if(v==null||!isFinite(v))return '–';const a=Math.abs(v);return a>=1e9?(v/1e9).toFixed(2)+'B':a>=1e6?(v/1e6).toFixed(a>=1e8?0:1)+'M':a>=1e3?(v/1e3).toFixed(0)+'K':v.toFixed(0)};
const pct=(v,d=1)=>v==null||!isFinite(v)?'–':(v*100).toFixed(d)+'%';
const gr=(c,p)=>p>0?c/p-1:null;
const grH=g=>g==null?(HASPREV?'<span class="muted">new</span>':'<span class="muted" title="No same-period data last year in the IQVIA delivery">n/a</span>'):`<span class="${g>=0?'up':'dn'}">${g>=0?'+':''}${(g*100).toFixed(1)}%</span>`;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const idxH=i=>i==null?'<span class="muted">–</span>':`<span class="idx ${i<90?'i-lo':i>110?'i-hi':'i-mid'}">${Math.round(i)}</span>`;

function selMarkets(){
  return D.markets.map((m,i)=>i).filter(i=>{const m=D.markets[i];
    if(ST.mkt!=='') return i==+ST.mkt;
    if(ST.line) return m.line===ST.line;
    if(ST.bu) return m.bu===ST.bu;
    return m.line!=='Other Markets';});
}
/* ---------- period & measure ---------- */
const MON=D.meta.months, NM=MON.length, LIDX=NM-1;
const MNAME=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const mLab=i=>{const [y,m]=MON[i].split('-');return MNAME[+m-1]+'-'+y.slice(2);};
let HASPREV=true;
function periodIdx(){
  const t=ST.ptype; let cur=[], lab='';
  const rng=(a,b)=>{const o=[];for(let i=Math.max(0,a);i<=b;i++)o.push(i);return o;};
  if(t==='mat'){cur=rng(LIDX-11,LIDX);lab='MAT';}
  else if(t==='ytd'){const y=MON[LIDX].slice(0,4);cur=MON.map((m,i)=>i).filter(i=>MON[i].startsWith(y));lab='YTD';}
  else if(t==='r3'){cur=rng(LIDX-2,LIDX);lab='Rolling 3 months';}
  else if(t==='r6'){cur=rng(LIDX-5,LIDX);lab='Rolling 6 months';}
  else if(t==='q'){const [y,q]=ST.pqtr.split('-Q');cur=MON.map((m,i)=>i).filter(i=>MON[i].startsWith(y)&&Math.ceil(+MON[i].slice(5)/3)==+q);lab=ST.pqtr;}
  else if(t==='m'){cur=[+ST.pmon];lab='Month';}
  else if(t==='cy'){cur=MON.map((m,i)=>i).filter(i=>MON[i].startsWith(ST.pyr));lab='Year '+ST.pyr+(cur.length<12?' (partial)':'');}
  else {const a=Math.min(+ST.pfrom,+ST.pto),b=Math.max(+ST.pfrom,+ST.pto);cur=rng(a,b);lab='Custom';}
  const prev=cur.map(i=>i-12); const ok=prev.every(i=>i>=0);
  return {cur,prev:ok?prev:[],ok,label:`${lab} ${mLab(cur[0])}${cur.length>1?'–'+mLab(cur[cur.length-1]):''}`,n:cur.length};
}
const sIdx=(a,ix)=>{let s=0;for(const i of ix)s+=a[i];return s;};
const UL=()=>ST.meas==='v'?'EGP':'units';
function compute(){
  const ms=new Set(selMarkets()), PI=periodIdx(); HASPREV=PI.ok; const mi=ST.meas==='v'?3:4, oi=ST.meas==='v'?4:3;
  const nb=D.bricks.length, mkE=new Float64Array(nb),mkEp=new Float64Array(nb),zE=new Float64Array(nb),zEp=new Float64Array(nb), mk=new Float64Array(nb),mkp=new Float64Array(nb),z=new Float64Array(nb),zp=new Float64Array(nb),mO=new Float64Array(nb),zO=new Float64Array(nb),mV=new Float64Array(nb);
  const byL={}; const bb=D.bricks.map(()=>new Map()); const zb=new Map();
  for(const f of D.facts){if(f[5]&&!ST.anc)continue; const b=D.brands[f[0]]; if(!ms.has(b.m)||!okD2(b))continue; if(ST.sec!=='all'&&f[2]!=+ST.sec)continue;
    const k=f[1], c=sIdx(f[mi],PI.cur), p=PI.ok?sIdx(f[mi],PI.prev):0, o=sIdx(f[oi],PI.cur), v=mi===3?c:o;
    if(!c&&!p)continue;
    mk[k]+=c;mkp[k]+=p;mO[k]+=o;mV[k]+=v; const ex=ST.anc&&D.markets[b.m].anc; if(!ex){mkE[k]+=c;mkEp[k]+=p;}
    {const m=bb[k],x=m.get(f[0])||[0,0];x[0]+=c;x[1]+=p;m.set(f[0],x);}
    const L=lineOfMkt[b.m]; (byL[L]??={mk:new Float64Array(nb),z:new Float64Array(nb)}).mk[k]+=c;
    if(b.z){z[k]+=c;zp[k]+=p;zO[k]+=o;byL[L].z[k]+=c;zb.set(f[0],(zb.get(f[0])||0)+c); if(!ex){zE[k]+=c;zEp[k]+=p;}}}
  const sum=a=>a.reduce((s,v)=>s+v,0);
  const N={mk:sum(mk),mkp:sum(mkp),z:sum(z),zp:sum(zp),mO:sum(mO),zO:sum(zO)};
  N.sh=N.mk>0?N.z/N.mk:0; N.gm=gr(N.mk,N.mkp); N.gz=gr(N.z,N.zp);
  const thr=250000*PI.n/12, hasZ=N.z>0; const sE=sum(mkE), hasZE=sum(zE)>0; N.shE=sE>0?sum(zE)/sE:0; // brick-level metrics: markets with an IQVIA Zeta track only
  const rows=D.bricks.map((b,k)=>{const r={k,n:b.n,t:b.t,r:b.r,mk:mk[k],mkp:mkp[k],z:z[k],zp:zp[k],mO:mO[k],zO:zO[k]};
    r.ps=!!D.bricks[k].ps; r.gm=gr(r.mk,r.mkp); r.sh=mkE[k]>0?zE[k]/mkE[k]:null; r.low=r.ps||mV[k]<thr;
    r.idx=(!r.low&&hasZE&&r.sh!=null&&N.shE>0)?r.sh/N.shE*100:null;
    const gz=gr(zE[k],zEp[k]), gmE=gr(mkE[k],mkEp[k]); r.ei=(!r.low&&gz!=null&&gmE!=null)?100*(1+gz)/(1+gmE):null;
    r.gap=(!r.low&&hasZE&&r.sh!=null)?Math.max(0,N.shE-r.sh)*mkE[k]:0; return r;});
  const q=rows.filter(r=>!r.low).map(r=>r.mk).sort((a,b)=>a-b); const med=q.length?q[Math.floor(q.length/2)]:0;
  rows.forEach(r=>{ if(r.low){r.seg='Low';return;} const big=r.mk>=med;
    if(big&&hasZE) r.seg=r.idx<90?'Grow':r.idx>110?'Defend':'Maintain';
    else if(big) r.seg='Maintain';
    else r.seg=(r.gm!=null&&N.gm!=null&&r.gm>N.gm)?'Develop':'Monitor';});
  const zBrands=[...zb].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
  const zl=b=>lineOfMkt[D.brands[b].m], aL=new Set(zBrands.filter(b=>D.brands[b].a).map(zl)), nL=new Set(zBrands.filter(b=>!D.brands[b].a).map(zl));
  const ancOnly=new Set([...aL].filter(l=>!nL.has(l))), ancM=zBrands.some(b=>D.brands[b].a), allAnc=zBrands.length>0&&zBrands.every(b=>D.brands[b].a);
  return {rows,N,med,hasZ,byL,ms,bb,PI,thr,zBrands,ancOnly,ancM,allAnc};
}
const zName=C=>C.zBrands.length?C.zBrands.map(b=>D.brands[b].n).join(' + '):'Zeta';
const zShort=n=>n.replace(/ Solid Oral.*| Oral cap.*| \(tablets\)/,'');
const zLab=C=>{let z=(C&&C.zBrands||[]).map(b=>zShort(D.brands[b].n));
  if(!z.length&&C&&C.ms) z=[...new Set(D.brands.filter(b=>C.ms.has(b.m)&&b.in).map(b=>zShort(b.in)))]; // Zeta brand inside an IQVIA aggregate row
  return !z.length?'Zeta':z.length<=3?z.join(' + '):'Zeta brands ('+z.length+')';};

/* ---------- controls ---------- */
function fillSelect(el,opts,val){el.innerHTML=opts.map(o=>`<option value="${esc(o[0])}"${o[0]==val?' selected':''}>${esc(o[1])}</option>`).join('');}
function syncControls(){
  const bus=[...new Set(D.markets.map(m=>m.bu))].sort();
  fillSelect($('#ig-fBU'),[['','All BUs'],...bus.map(b=>[b,b])],ST.bu);
  const lines=[...new Set(D.markets.filter(m=>!ST.bu||m.bu===ST.bu).map(m=>m.line))].sort();
  if(ST.line&&!lines.includes(ST.line)) ST.line='';
  fillSelect($('#ig-fLine'),[['','All lines'+(ST.bu?' in '+ST.bu:'')],...lines.map(l=>[l,l])],ST.line);
  const mkts=D.markets.map((m,i)=>[String(i),m.n+(D.brands.some(b=>b.z&&!b.a&&b.m===i)?'':m.anc?'  · Zeta estimated (≈)':'  · Zeta not tracked by IQVIA'),m]).filter(x=>(!ST.bu||x[2].bu===ST.bu)&&(!ST.line||x[2].line===ST.line));
  if(ST.mkt!==''&&!mkts.some(x=>x[0]===ST.mkt)) ST.mkt='';
  fillSelect($('#ig-fMkt'),[['','All markets in selection'],...mkts.map(x=>[x[0],x[1]])],ST.mkt);
  const mset=new Set(ST.mkt!==''?[+ST.mkt]:mkts.map(x=>+x[0]));
  const d2s=[...new Set(D.brands.filter(b=>mset.has(b.m)).map(d2Of))].sort();
  if(ST.d2&&!d2s.includes(ST.d2)) ST.d2='';
  fillSelect($('#ig-fD2'),[['','All DM2 in selection'],...d2s.map(d=>[d,d])],ST.d2);
}
function d2Of(b){ return b.d2||D.markets[b.m].n; }
function okD2(b){ return !ST.d2||d2Of(b)===ST.d2; }
$('#ig-fBU').onchange=e=>{ST.bu=e.target.value;ST.line='';ST.mkt='';ST.d2='';syncControls();render();};
$('#ig-fLine').onchange=e=>{ST.line=e.target.value;ST.mkt='';ST.d2='';syncControls();render();};
$('#ig-fMkt').onchange=e=>{ST.mkt=e.target.value;ST.d2='';syncControls();render();};
$('#ig-fD2').onchange=e=>{ST.d2=e.target.value;render();};
for(const [id,key] of [['#ig-fMeas','meas'],['#ig-fSec','sec']]) $(id).onclick=e=>{const b=e.target.closest('button');if(!b)return;ST[key]=b.dataset.v;$(id).querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));render();};
function syncPeriod(){
  const t=ST.ptype, s1=$('#ig-pSub1'), s2=$('#ig-pSub2'), q=[...new Set(MON.map(m=>m.slice(0,4)+'-Q'+Math.ceil(+m.slice(5)/3)))], yrs=[...new Set(MON.map(m=>m.slice(0,4)))];
  const mo=MON.map((m,i)=>[String(i),mLab(i)]);
  s1.hidden=!['q','m','cy','cus'].includes(t); s2.hidden=t!=='cus';
  if(t==='q'){$('#ig-pSub1L').textContent='Quarter'; if(!ST.pqtr)ST.pqtr=q[q.length-1]; fillSelect($('#ig-fPs1'),q.slice().reverse().map(x=>[x,x]),ST.pqtr);}
  if(t==='m'){$('#ig-pSub1L').textContent='Month'; if(ST.pmon==='')ST.pmon=String(LIDX); fillSelect($('#ig-fPs1'),mo.slice().reverse(),ST.pmon);}
  if(t==='cy'){$('#ig-pSub1L').textContent='Year'; if(!ST.pyr)ST.pyr=yrs[yrs.length-1]; fillSelect($('#ig-fPs1'),yrs.slice().reverse().map(y=>[y,y]),ST.pyr);}
  if(t==='cus'){$('#ig-pSub1L').textContent='From'; if(ST.pfrom==='')ST.pfrom=String(Math.max(0,LIDX-5)); if(ST.pto==='')ST.pto=String(LIDX); fillSelect($('#ig-fPs1'),mo,ST.pfrom); fillSelect($('#ig-fPs2'),mo,ST.pto);}
}
$('#ig-fPt').onchange=e=>{ST.ptype=e.target.value;syncPeriod();render();};
$('#ig-fPs1').onchange=e=>{const v=e.target.value; if(ST.ptype==='q')ST.pqtr=v; else if(ST.ptype==='m')ST.pmon=v; else if(ST.ptype==='cy')ST.pyr=v; else ST.pfrom=v; render();};
$('#ig-fPs2').onchange=e=>{ST.pto=e.target.value;render();};
$('#ig-fAlloc').onchange=e=>{ST.anc=e.target.checked;render();};
$('#ig-pSearch').oninput=e=>{ST.pq=e.target.value.toLowerCase();renderPos(LAST,LASTP);};
$('#ig-pMore').onclick=()=>{ST.pAll=true;renderPos(LAST,LASTP);};

/* ---------- render ---------- */
let LAST=null;
function render(){
  const C=compute(); LAST=C; const {N,rows,hasZ}=C; const PM=posModel(C);
  const scope=ST.d2&&(ST.mkt===''||ST.d2!==D.markets[+ST.mkt].n)?(ST.mkt!==''?D.markets[+ST.mkt].n+' › ':'')+'DM2 '+ST.d2:ST.mkt!==''?D.markets[+ST.mkt].n:ST.line?('Line '+ST.line+' · all markets'):ST.bu?('BU '+ST.bu):'All Zeta markets';
  const secL={0:'Pharmacies',1:'Stores',all:'Pharmacies + Stores'}[ST.sec];
  const perL=C.PI.label+(C.PI.ok?' vs same months last year':' · no prior-year comparison'), ul=UL(), other=ST.meas==='v'?'units':'value';
  const npos=new Set(D.alloc.map(a=>a[0])).size, called=D.pos.filter(p=>p[6]!=null).length, filled=D.pos.filter(p=>p[5]==='Filled').length;
  $('#ig-asof').innerHTML=`${esc(scope)}<br>${perL} · ${secL} · ${ST.meas==='v'?'Value':'Units'}<br><b>Zeta product: ${esc(zName(C))}</b>`;
  $('#ig-dq').innerHTML=`<span>Source <b>IQVIA Egypt Sales Territory</b>, delivered to ${mLab(LIDX)}</span><span>Data <b>IQVIA Actual</b>${ST.anc&&D.anchInt?` + <b>≈ estimated Zeta sales</b> for ${D.anchInt.length} brands IQVIA reports nationally only`:''}</span><span>Totals reconcile to IQVIA <span class="ok">OK</span></span><span>Bricks <b>148/148</b> mapped</span><span>Organogram <b>July 2026</b> · ${npos} positions</span>`;
  let w='';
  if(!hasZ) w+=`<div class="banner" style="margin-top:6px">No Zeta brand is tracked by IQVIA in this selection, so share, index and gap are not available. Market size and growth are still valid. Turn on “Add estimated Zeta sales” for a directional read.</div>`;
  const aZ=C.zBrands.filter(b=>D.brands[b].a);
  if(aZ.length){const ofs=aZ.filter(b=>D.brands[b].of>=0);
    w+=`<div class="banner" style="margin-top:6px"><b>≈ Estimated: ${aZ.map(b=>esc(D.brands[b].n)).join(', ')}.</b> IQVIA reports ${aZ.length>1?'these Zeta brands':'this Zeta brand'} for Egypt as a whole, not by brick. The national IQVIA sales are split across positions using each position's share of Zeta's own sales (Q1–Q3 2026); the market = ${aZ.length>1?'these brands':'the brand'} + the competitors IQVIA tracks${ofs.length?'. '+ofs.map(b=>esc(D.brands[b].n)+' is already inside the IQVIA total “'+esc(D.brands[D.brands[b].of].n)+'”, so it is taken out of that total (not counted twice)').join('. '):''}. Use for direction and priorities — not for targets, incentives or rep ranking (a position can be about ±20% off). Growth by region and position follows the national trend.</div>`;}
  $('#ig-warn').innerHTML=w;
  const reg=ST.region==='ALL'?null:ST.region, R=rows.filter(r=>!reg||r.r===reg);
  const s=a=>R.reduce((t,r)=>t+r[a],0); const mk=s('mk'),mkp=s('mkp'),z=s('z'),zp=s('zp'),mO=s('mO'),zO=s('zO');
  const sh=mk>0?z/mk:null, gm=gr(mk,mkp), gz=gr(z,zp), ei=(gz!=null&&gm!=null)?100*(1+gz)/(1+gm):null, gap=s('gap');
  const where=reg?reg:'National';
  $('#ig-kpis').innerHTML=[
    ['Market '+(ST.meas==='v'?'value':'units'),fmt(mk)+' '+ul,`${where} · growth ${grH(gm)}`],
    [esc(zLab(C))+(aZ.length?' <span class="muted">≈ estimated</span>':''),hasZ?fmt(z)+' '+ul:'–',hasZ?`growth ${grH(gz)}`:'not tracked'],
    [`Share of tracked market (${ST.meas==='v'?'value':'units'})`,hasZ?pct(sh):'–',hasZ?(reg?`national ${pct(N.sh)}`:esc(zLab(C))+' ÷ tracked market'):'–'],
    [`Share of tracked market (${other})`,hasZ&&mO>0?pct(zO/mO):'–',hasZ&&mO>0&&sh!=null?(((ST.meas==='v'?zO/mO:sh)>(ST.meas==='v'?sh:zO/mO))?'units share higher → priced below market':'value share higher → priced above market'):'–'],
    ['Evolution Index',hasZ&&ei!=null?Math.round(ei):'–',hasZ&&ei!=null?(ei>=100?'<span class="up">growing faster than the market</span>':'<span class="dn">growing slower than the market</span>'):'–'],
    C.ancM?['Opportunity — gap to fair share',hasZ?fmt(PM.reduce((t,o)=>t+o.gap,0))+' '+ul:'–',hasZ?`${PM.filter(o=>o.gap>0).length} positions below fair share`:'–']
      :['Opportunity — gap to fair share',hasZ?fmt(gap)+' '+ul:'–',hasZ?`${R.filter(r=>r.gap>0).length} bricks below national share`:'–']
  ].map(k=>`<div class="kpi"><span class="l">${k[0]}</span><span class="v">${k[1]}</span><span class="d">${k[2]}</span></div>`).join('');
  renderAlloc(); renderRegion(C); renderComp(C); LASTP=PM; renderPosSeg(C,LASTP); renderPos(C,LASTP);
  $('#ig-srcFoot').textContent=`Built ${D.meta.built} from ${D.meta.source}; Brand_Map / Line_BU_Ref mapping; ${D.meta.org}. Low-base threshold ${fmt(C.thr)} EGP for this period.`;
}
function renderAlloc(){
  const el=$('#ig-allocCard'); if(!ST.anc){el.innerHTML='';return;}
  const lines=new Set([...LAST.ms].map(i=>lineOfMkt[i]));
  const br=D.anchBrands.filter(b=>lines.has(b.line)&&!(D.anchInt||[]).includes(b.b));
  if(!br.length){el.innerHTML='';return;}
  if(0){el.innerHTML=`<div class="card alloc"><span class="badge-alloc">◐ Zeta brand allocation (directional)</span><p class="foot">No allocated Zeta brand belongs to the selected line(s). Allocated brands: ${D.anchBrands.map(b=>esc(b.b)+' ('+b.line+')').join(', ')}.</p></div>`;return;}
  const rows=br.map(b=>{const cells=REG.map(r=>{const a=D.anch.find(x=>x[0]===b.b&&x[1]===r);return a?a[2]:0;});const tot=cells.reduce((s,v)=>s+v,0);
    const sh=REG.map(r=>{const a=D.anch.find(x=>x[0]===b.b&&x[1]===r);return a&&a[3]>0?a[2]/a[3]:null;});
    return `<tr><td>${esc(b.b)}${b.of?` <span class="chip s-Low" title="Already inside IQVIA row ${esc(b.of)}">of which</span>`:''}</td>${cells.map((v,i)=>`<td class="r num">${fmt(v)}<br><span class="muted">${sh[i]==null?'n/a':pct(sh[i])}</span></td>`).join('')}<td class="r num">${fmt(tot)}</td></tr>`;}).join('');
  el.innerHTML=`<div class="card alloc"><span class="badge-alloc">◐ Estimated Zeta sales — not included in the totals above · Pharmacies YTD Jan–Aug 2026</span>
  <div class="sub">National IQVIA sales split by each region&#39;s share of Zeta&#39;s own sales (directional: region about ±9%). Second line = share of the tracked market in the region.</div>
  <div class="tbl-wrap" style="max-height:none"><table class="dt"><thead><tr><th>Brand</th>${REG.map(r=>`<th class="r">${esc(r)}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function renderRegions(){
  $('#ig-regChips').innerHTML=['ALL',...REG].map(r=>`<button class="rchip" data-r="${esc(r)}" aria-pressed="${ST.region===r}">${r==='ALL'?'All regions':esc(r)}</button>`).join('');
  $('#ig-regChips').querySelectorAll('button').forEach(b=>b.onclick=()=>{ST.region=b.dataset.r;render();});
}
const BCOLS=[['n','Brick',0],['t','Territory',0],['r','Region',0],['mk','Market',1],['gm','Growth',1],['sh','Zeta share',1],['idx','Index',1],['ei','EI',1],['gap','Gap EGP',1],['seg','Segment',0]];
function renderBricks(C){
  let R=C.rows.filter(r=>(ST.region==='ALL'||r.r===ST.region)&&(!ST.bq||(r.n+' '+r.t).toLowerCase().includes(ST.bq)));
  const k=ST.bSort,d=ST.bDir; R=R.slice().sort((a,b)=>{const x=a[k],y=b[k]; if(x==null)return 1; if(y==null)return -1; return (typeof x==='string'?x.localeCompare(y):x-y)*d;});
  const mmax=Math.max(1,...R.map(r=>r.mk));
  $('#ig-bTbl').innerHTML=`<thead><tr>${BCOLS.map(c=>`<th data-k="${c[0]}" class="${c[2]?'r':''}">${c[1]}${ST.bSort===c[0]?(ST.bDir<0?' ↓':' ↑'):''}</th>`).join('')}</tr></thead><tbody>${R.map(r=>`<tr data-k="${r.k}">
    <td>${esc(r.n)}</td><td>${esc(r.t)}</td><td class="muted">${esc(r.r)}</td>
    <td class="r num"><div style="display:flex;gap:6px;align-items:center;justify-content:flex-end"><span>${fmt(r.mk)}</span><div class="bar" style="width:${Math.max(2,50*r.mk/mmax)}px"></div></div></td>
    <td class="r num">${grH(r.gm)}${r.gm!=null&&Math.abs(r.gm)>0.6?' <span title="Growth beyond ±60% — check for an IQVIA brick re-definition before acting" style="color:var(--warn)">⚠</span>':''}</td><td class="r num">${r.low||!C.hasZ?'<span class="muted">–</span>':pct(r.sh)}</td><td class="r">${idxH(r.idx)}</td>
    <td class="r num">${r.ei==null?'<span class="muted">–</span>':Math.round(r.ei)}</td><td class="r num">${r.gap>0?fmt(r.gap):'<span class="muted">–</span>'}</td>
    <td><span class="chip s-${r.seg}">${r.seg==='Low'?'Low base':r.seg}</span></td></tr>`).join('')}</tbody>`;
  $('#ig-bTbl').querySelectorAll('th').forEach(th=>th.onclick=()=>{const kk=th.dataset.k; if(ST.bSort===kk)ST.bDir*=-1; else {ST.bSort=kk;ST.bDir=['n','t','r','seg'].includes(kk)?1:-1;} renderBricks(LAST);});
  $('#ig-bTbl').querySelectorAll('tbody tr').forEach(tr=>tr.onclick=()=>openBrick(+tr.dataset.k));
}
/* ---------- brand colours: fixed slot per entity for the current market selection ---------- */
const isAgg=B=>B.c==='Others'||B.c==='Multiple';
const SER=['var(--s1)','var(--s2)','var(--s3)','var(--s4)','var(--s5)','var(--s6)'];
function brandSlots(C){ // Zeta = slot 1; top-5 competitors nationally = slots 2..6; rest = Others
  const tot=new Map(); for(const m of C.bb) for(const [b,v] of m) tot.set(b,(tot.get(b)||0)+v[0]);
  const comp=[...tot].filter(([b])=>!D.brands[b].z&&!isAgg(D.brands[b])).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);
  const col=new Map(); comp.forEach((b,i)=>col.set(b,SER[i+1])); return {comp,col,tot};
}
function regionAgg(C){
  const R={}; REG.forEach(r=>R[r]={r,mk:0,mkp:0,z:0,zp:0,br:new Map()});
  C.rows.forEach(x=>{const o=R[x.r];o.mk+=x.mk;o.mkp+=x.mkp;o.z+=x.z;o.zp+=x.zp;});
  C.bb.forEach((m,k)=>{const o=R[D.bricks[k].r]; for(const [b,v] of m){const t=o.br.get(b)||[0,0];t[0]+=v[0];t[1]+=v[1];o.br.set(b,t);}});
  return REG.map(r=>R[r]);
}
function renderRegion(C){
  const RG=regionAgg(C), N=C.N, S=brandSlots(C); LASTS=S;
  const mx=Math.max(...RG.map(o=>Math.max(o.mk/N.mk,C.hasZ?o.z/N.z:0)),0.01);
  // contribution bars
  $('#ig-rcBars').innerHTML=`<div class="rc-head"><span>Region</span><span>Contribution to national (bar = % of national)</span><span class="r">Fair Share Index</span><span class="r">Market growth</span><span class="r" title="${esc(zLab(C))}">Zeta growth</span><span class="r">Evolution Index</span></div>`+RG.map(o=>{
    const mc=o.mk/N.mk, zc=C.hasZ?o.z/N.z:null, idx=C.hasZ&&mc>0?zc/mc*100:null, gm=gr(o.mk,o.mkp), gz=gr(o.z,o.zp), ei=(C.hasZ&&gz!=null&&gm!=null)?100*(1+gz)/(1+gm):null;
    return `<div class="rc-row${ST.region===o.r?' sel':''}" data-r="${esc(o.r)}" title="${esc(o.r)}: market ${fmt(o.mk)} EGP (${pct(mc)}) · Zeta ${fmt(o.z)} EGP (${pct(zc)})">
     <span class="rc-name">${esc(o.r)}</span>
     <span class="rc-bars"><span class="rc-b"><i style="width:${(mc/mx*100).toFixed(1)}%;background:var(--mkt)"></i><em>${pct(mc)}</em></span>${C.hasZ?`<span class="rc-b"><i style="width:${(zc/mx*100).toFixed(1)}%;background:var(--s1)"></i><em>${pct(zc)}</em></span>`:''}</span>
     <span class="r">${idxH(idx)}</span><span class="r num">${grH(gm)}</span><span class="r num">${C.hasZ?(C.allAnc?'<span class="muted" title="≈ Estimated sales use a fixed 2026 split, so growth here equals the national trend">nat.</span>':grH(gz)):'–'}</span><span class="r num">${ei==null||C.allAnc?'–':Math.round(ei)}</span></div>`;}).join('');
  $('#ig-rcLeg').innerHTML=`<span><i class="sw" style="background:var(--mkt)"></i>Market (tracked brands)</span>${C.hasZ?'<span><i class="sw" style="background:var(--s1)"></i>'+esc(zLab(C))+'</span>':''}<span class="muted">Fair Share Index = region&#39;s part of ${esc(zLab(C))} sales ÷ region&#39;s part of the market × 100 (100 = in line, below 90 = Zeta under-represented). Click a region to filter the page.</span>`;
  $('#ig-rcBars').querySelectorAll('.rc-row').forEach(el=>el.onclick=()=>{ST.region=ST.region===el.dataset.r?'ALL':el.dataset.r;render();});
  // brand share 100% stacks
  const seg=(br,mk)=>{const z=[...br].filter(([b])=>D.brands[b].z).reduce((t,[,v])=>t+v[0],0);
    const parts=[]; if(C.hasZ) parts.push({n:zLab(C),v:z,c:SER[0]});
    S.comp.forEach(b=>parts.push({n:D.brands[b].n,v:(br.get(b)||[0])[0],c:S.col.get(b)}));
    const used=parts.reduce((t,p)=>t+p.v,0); parts.push({n:'Others / generics (IQVIA aggregate rows + smaller brands)',v:Math.max(0,mk-used),c:'var(--other)'}); return parts;};
  const natBr=new Map(); RG.forEach(o=>{for(const [b,v] of o.br){const t=natBr.get(b)||[0,0];t[0]+=v[0];natBr.set(b,t);}});
  const rowsH=[['NATIONAL',natBr,N.mk],...RG.map(o=>[o.r,o.br,o.mk])].map(([n,br,mk])=>{const ps=seg(br,mk);
    return `<div class="st-row${n==='NATIONAL'?' nat':''}${ST.region===n?' sel':''}"><span class="rc-name">${esc(n)}</span><span class="st-bar">${ps.map(p=>{const w=mk>0?p.v/mk:0; return w>0?`<i style="width:${(w*100).toFixed(2)}%;background:${p.c}" title="${esc(n)} · ${esc(p.n)}: ${pct(w)} (${fmt(p.v)} EGP)">${w>=0.08?`<b${p.c==='var(--other)'?' class="lo"':''}>${(w*100).toFixed(0)}%</b>`:''}</i>`:'';}).join('')}</span></div>`;}).join('');
  $('#ig-stBars').innerHTML=rowsH;
  $('#ig-stLeg').innerHTML=[...(C.hasZ?[[zLab(C),SER[0]]]:[]),...S.comp.map(b=>[D.brands[b].n+' · '+D.brands[b].c.replace('*',''),S.col.get(b)]),['Others / generics + smaller brands','var(--other)']].map(([n,c])=>`<span><i class="sw" style="background:${c}"></i>${esc(n)}</span>`).join('');
}
function renderComp(C){
  const RG=regionAgg(C), N=C.N, S=LASTS, carved=new Set(ST.anc?C.zBrands.filter(b=>D.brands[b].a&&D.brands[b].of>=0).map(b=>D.brands[b].of):[]);
  const tot=new Map(); for(const o of RG) for(const [b,v] of o.br){const t=tot.get(b)||[0,0];t[0]+=v[0];t[1]+=v[1];tot.set(b,t);}
  const rows=[...tot].filter(([,v])=>v[0]>0||v[1]>0).map(([b,v])=>{const sh=N.mk>0?v[0]/N.mk:0, shp=N.mkp>0?v[1]/N.mkp:0, g=gr(v[0],v[1]);
    const ei=(g!=null&&N.gm!=null)?100*(1+g)/(1+N.gm):null;
    const rs=RG.filter(o=>o.mk>0).map(o=>({r:o.r,s:(o.br.get(b)||[0])[0]/o.mk})).sort((a,b)=>b.s-a.s);
    return {b,B:D.brands[b],v:v[0],sh,d:(sh-shp)*100,g,ei,best:rs[0],worst:rs[rs.length-1]};}).sort((a,b)=>b.v-a.v);
  $('#ig-cTbl').innerHTML=`<thead><tr><th>Brand</th><th>Corporation</th><th class="r">Value</th><th class="r">Share</th><th class="r">Share change (pts)</th><th class="r">Growth</th><th class="r">Evolution Index</th><th>Strongest region</th><th>Weakest region</th></tr></thead><tbody>${rows.map((o,i)=>`<tr class="${o.B.z?'zeta':''}">
    <td><i class="sw" style="background:${o.B.z?SER[0]:(S.col.get(o.b)||'var(--other)')}"></i>${i+1}. ${esc(o.B.n)}${o.B.a?' <span class="chip s-Low" title="Estimated from national IQVIA: IQVIA reports this brand nationally only, so its national sales are split across positions by each position&#39;s share of Zeta&#39;s own sales (Q1–Q3 2026). Directional only.">≈ estimated</span>':''}${o.B.fs?` <span class="chip s-Low" title="IQVIA territory brand “${esc(o.B.fs)}” covers all forms; split in every brick by the IQVIA_SOURCE national form mix (by month, Pharmacies and Stores separately)">form split</span>`:''}${o.B.in?(carved.has(o.b)?` <span class="chip s-Low" title="IQVIA molecule total; Zeta (${esc(o.B.in)}) carved out and shown as its own row">excl. ${esc(o.B.in)}</span>`:` <span class="chip s-Low" title="IQVIA combined row — contains ${esc(o.B.in)}">incl. ${esc(o.B.in)}</span>`):''}${isAgg(o.B)&&!o.B.in?' <span class="chip s-Low" title="IQVIA aggregate row (molecule total or residual), not a single competitor">aggregate</span>':''}</td><td class="muted">${esc(o.B.c)}</td>
    <td class="r num">${fmt(o.v)}</td><td class="r num">${pct(o.sh)}</td><td class="r num"><span class="${o.d>=0?'up':'dn'}">${o.d>=0?'+':''}${o.d.toFixed(1)}</span></td><td class="r num">${grH(o.g)}</td>
    <td class="r num">${o.ei==null?'–':Math.round(o.ei)}</td><td>${o.best?esc(o.best.r)+' <span class="muted num">'+pct(o.best.s)+'</span>':'–'}</td><td>${o.worst?esc(o.worst.r)+' <span class="muted num">'+pct(o.worst.s)+'</span>':'–'}</td></tr>`).join('')}</tbody>`;
  const zr=rows.find(o=>o.B.z), lead=rows.find(o=>!o.B.z&&!isAgg(o.B)), rise=rows.filter(o=>!o.B.z&&!isAgg(o.B)&&o.d>=1);
  $('#ig-cNote').innerHTML=lead?`Market leader: <b>${esc(lead.B.n)}</b> (${esc(lead.B.c)}) ${pct(lead.sh)} share, ${lead.d>=0?'+':''}${lead.d.toFixed(1)} pts. ${zr?`Best Zeta brand: <b>${esc(zr.B.n)}</b> rank #${rows.indexOf(zr)+1}, ${pct(zr.sh)}.`:''} ${rise.length?`Taking share (≥1 pt): ${rise.map(o=>'<b>'+esc(o.B.n)+'</b> +'+o.d.toFixed(1)).join(', ')}.`:'No named competitor gained ≥1 pt.'} Rows marked “aggregate” are IQVIA molecule totals / residual pools, not single competitors.`:'';
}
let LASTS=null;
function lineBrick(C,b,L){ // one brick, markets of line L: market, Zeta and every brand, current + previous period
  const o={mk:0,mkp:0,z:0,zp:0,br:new Map()};
  for(const [bi,v] of C.bb[b]){const B=D.brands[bi]; if(lineOfMkt[B.m]!==L)continue;
    o.mk+=v[0];o.mkp+=v[1]; if(B.z){o.z+=v[0];o.zp+=v[1];} o.br.set(bi,v);}
  return o;
}
function posModel(C){
  const lines=new Set([...C.ms].map(i=>lineOfMkt[i]));
  const acc=new Map();
  for(const [p,b,al] of D.alloc){const P=D.pos[p], L=P[1]; if(!lines.has(L)||al<=0)continue;
    if(ST.region!=='ALL'&&D.bricks[b].r!==ST.region)continue;
    const lb=lineBrick(C,b,L); if(lb.mk<=0&&lb.mkp<=0)continue;
    const o=acc.get(p)||{p,pot:0,potP:0,z:0,zp:0,br:[],cb:new Map()};
    o.pot+=al*lb.mk; o.potP+=al*lb.mkp; o.z+=al*lb.z; o.zp+=al*lb.zp; o.br.push([b,al]);
    for(const [bi,v] of lb.br){const t=o.cb.get(bi)||[0,0]; t[0]+=al*v[0]; t[1]+=al*v[1]; o.cb.set(bi,t);}
    acc.set(p,o);}
  if(ST.anc&&D.pfacts){const mi=ST.meas==='v'?3:4; // ≈ IQVIA-anchored Zeta: added at position level (carved out of the IQVIA total for "of which" brands)
    for(const f of D.pfacts){const B=D.brands[f[0]]; if(!C.ms.has(B.m)||!okD2(B))continue; if(ST.sec!=='all'&&f[2]!=+ST.sec)continue;
      const L=D.pos[f[1]][1]; if(!lines.has(L))continue; if(ST.region!=='ALL'&&f[5]!==ST.region)continue;
      const c=sIdx(f[mi],C.PI.cur), pp=C.PI.ok?sIdx(f[mi],C.PI.prev):0; if(!c&&!pp)continue;
      const o=acc.get(f[1])||{p:f[1],pot:0,potP:0,z:0,zp:0,br:[],cb:new Map()};
      o.z+=c; o.zp+=pp; o.anc=(o.anc||0)+c; {const t=o.cb.get(f[0])||[0,0]; t[0]+=c; t[1]+=pp; o.cb.set(f[0],t);}
      let sc=0, sp=0; if(B.of>=0){const t=o.cb.get(B.of)||[0,0]; sc=Math.min(c,Math.max(0,t[0])); sp=Math.min(pp,Math.max(0,t[1])); t[0]-=sc; t[1]-=sp; o.cb.set(B.of,t);}
      o.pot+=c-sc; o.potP+=pp-sp; acc.set(f[1],o);}}
  const out=[...acc.values()].filter(o=>o.pot>0).map(o=>{const P=D.pos[o.p];return {...o,name:P[0],line:P[1],rep:P[2],dm:P[3],nsm:P[4],vac:P[5],calls:P[6]};});
  const byLine={}; out.forEach(o=>{const t=byLine[o.line]??={pot:0,z:0,calls:0}; t.pot+=o.pot; t.z+=o.z; if(o.calls!=null&&o.vac==='Filled')t.calls+=o.calls;});
  out.forEach(o=>{const t=byLine[o.line]; o.potSh=o.pot/t.pot; o.sh=o.z/o.pot; o.shp=o.potP>0?o.zp/o.potP:null; o.idx=t.z>0?o.sh/(t.z/t.pot)*100:null;
    o.gm=gr(o.pot,o.potP); o.gz=gr(o.z,o.zp); o.ei=(o.gz!=null&&o.gm!=null)?100*(1+o.gz)/(1+o.gm):null;
    o.callSh=(o.calls!=null&&o.vac==='Filled'&&t.calls>0)?o.calls/t.calls:null; o.eff=o.callSh!=null?o.callSh/o.potSh:null;
    o.gap=t.z>0?Math.max(0,t.z/t.pot-o.sh)*o.pot:0;
    o.comp=new Map([...o.cb].filter(([bi])=>!D.brands[bi].z&&!isAgg(D.brands[bi])).map(([bi,v])=>[bi,v[0]]));
    const lc=[...o.comp].sort((a,b)=>b[1]-a[1])[0]; o.lead=lc?{b:lc[0],sh:lc[1]/o.pot}:null;
    if(C.ancOnly.has(o.line)){o.ei=null;o.gzNat=true;}
    o.seg=o.idx==null?'n/a':o.vac!=='Filled'?'Fill vacancy':o.idx<90?'Close the gap':o.idx>110?'Protect':'On track';});
  return out;
}
const PSEG=['Close the gap','Fill vacancy','Protect','On track'];
const PCOL={'Close the gap':'var(--s2)','Fill vacancy':'var(--warn)','Protect':'var(--s3)','On track':'var(--other)','n/a':'var(--other)'};
const PACT={'Close the gap':'Rep in place, Zeta share below 90% of the line level → focus calls on the bricks with the biggest gap; sharpen the message against the lead competitor','Fill vacancy':'No rep in place → prioritise hiring by market size and gap; cover the top bricks meanwhile','Protect':'Zeta share above 110% of the line level → keep call frequency, watch the lead competitor','On track':'Share close to the line level (90–110) → hold the plan, track the Evolution Index'};
function renderPosSeg(C,P){
  if(!C.hasZ){$('#ig-psegTbl').innerHTML='<tr><td class="muted">No Zeta brand is tracked in this selection — position groups need a Zeta share. Turn on “Add estimated Zeta sales” if available.</td></tr>';$('#ig-psegNote').textContent='';return;}
  const zl=esc(zLab(C)), ul=UL();
  const rows=PSEG.map(s=>{const x=P.filter(o=>o.seg===s);return {s,x,n:x.length,v:x.filter(o=>o.vac!=='Filled').length,pot:x.reduce((t,o)=>t+o.pot,0),gap:x.reduce((t,o)=>t+o.gap,0)};});
  const tp=rows.reduce((t,r)=>t+r.pot,0)||1;
  const list=r=>{const x=r.x.slice().sort((a,b)=>b.gap-a.gap||b.pot-a.pot), lim=ST.segAll===r.s?x.length:10;
    if(!x.length) return '<tr class="segdet"><td></td><td colspan="4" class="muted">No position in this group for the current selection.</td></tr>';
    return `<tr class="segdet"><td></td><td colspan="4"><div class="tbl-wrap" style="max-height:none"><table class="dt"><thead><tr><th>#</th><th>Position</th><th>Medical rep</th><th>District manager</th><th class="r">Market (${ul})</th><th class="r">${zl} share</th><th class="r" title="Position Zeta share ÷ line Zeta share × 100">Fair Share Index</th><th class="r" title="Sales ${zl} would add at the line share">Gap to fair share</th><th>Lead competitor here</th></tr></thead><tbody>${x.slice(0,lim).map((o,i)=>`<tr class="sp" data-p="${o.p}" title="Open the position profile"><td class="muted">${i+1}</td><td><b>${esc(o.name)}</b></td><td>${o.vac!=='Filled'?'<span class="chip s-Grow">Vacant</span>':esc(o.rep)}</td><td class="muted">${esc(o.dm)}</td><td class="r num">${fmt(o.pot)}</td><td class="r num">${pct(o.sh)}</td><td class="r">${idxH(o.idx)}</td><td class="r num">${o.gap>0?fmt(o.gap):'<span class="muted">–</span>'}</td><td>${o.lead?esc(D.brands[o.lead.b].n)+' <span class="muted num">'+pct(o.lead.sh)+'</span>':'–'}</td></tr>`).join('')}</tbody></table></div>${x.length>lim?`<button class="more" data-sa="${esc(r.s)}">Show all ${x.length} positions</button>`:''}</td></tr>`;};
  $('#ig-psegTbl').innerHTML=`<thead><tr><th></th><th>Group · what to do</th><th class="r">Positions</th><th class="r">Share of market</th><th class="r">Gap to fair share</th></tr></thead><tbody>`+rows.map(r=>{const open=ST.segOpen===r.s;
    return `<tr class="segrow${open?' open':''}" data-s="${esc(r.s)}" aria-expanded="${open}" title="Click to ${open?'hide':'list'} the positions"><td class="tog">${open?'▾':'▸'}</td><td><span class="chip" style="background:color-mix(in srgb,${PCOL[r.s]} 18%,transparent);color:var(--fg)"><i class="dot" style="background:${PCOL[r.s]}"></i>${r.s}</span><div class="act">${PACT[r.s]}</div></td><td class="r num">${r.n}<div class="act">${r.v?r.v+' vacant':'positions'}</div></td><td class="r num">${pct(r.pot/tp,0)}<div class="act">of the market</div></td><td class="r num">${r.gap>0?fmt(r.gap):'–'}<div class="act">${ul}</div></td></tr>`+(open?list(r):'');}).join('')+'</tbody>';
  const T=$('#ig-psegTbl');
  T.querySelectorAll('tr.segrow').forEach(tr=>tr.onclick=()=>{ST.segOpen=ST.segOpen===tr.dataset.s?'':tr.dataset.s; renderPosSeg(LAST,LASTP);});
  T.querySelectorAll('tr.sp').forEach(tr=>tr.onclick=()=>openPos(+tr.dataset.p));
  T.querySelectorAll('button[data-sa]').forEach(bt=>bt.onclick=e=>{e.stopPropagation(); ST.segAll=bt.dataset.sa; renderPosSeg(LAST,LASTP);});
  const top=P.filter(o=>o.seg==='Close the gap'||o.seg==='Fill vacancy').sort((a,b)=>b.gap-a.gap).slice(0,3).filter(o=>o.gap>0);
  $('#ig-psegNote').innerHTML=top.length?`<b>Start with:</b> ${top.map(o=>`<a href="#" class="plink" data-p="${o.p}">${esc(o.name)}</a>${o.vac!=='Filled'?' (vacant)':''} — gap ${fmt(o.gap)} ${ul}`).join(' · ')}`:'';
  $('#ig-psegNote').querySelectorAll('a.plink').forEach(a=>a.onclick=e=>{e.preventDefault(); openPos(+a.dataset.p);});
}
function shareCells(mk,mkp,cb,zbs,comps,NB,brick,skipZ){ // each Zeta product, each named competitor, Others — share, change in points, growth, index vs national share
  const cell=(c,p,cls,ns)=>{const s=mk>0?c/mk:null, ix=(s!=null&&ns>0)?s/ns*100:null, sp=(HASPREV&&mkp>0)?p/mkp:null, d=(s!=null&&sp!=null)?(s-sp)*100:null;
    const g=HASPREV?gr(c,p):null;
    return `<td class="r num shc${cls||''}">${s==null?'–':pct(s)}<small class="ixl">${ix==null?'':`<span class="idx ${ix<90?'i-lo':ix>110?'i-hi':'i-mid'}" title="Fair Share Index: share here ÷ national share of this brand × 100">FSI ${Math.round(ix)}</span>`}</small><small class="${d==null?'muted':d>=0?'up':'dn'}">${d==null?'':(d>=0?'+':'')+d.toFixed(1)+' pts'}</small><small class="gl ${g==null?'muted':g>=0?'up':'dn'}">${g==null?(HASPREV&&c>0?'new':''):'gr '+(g>=0?'+':'')+(g*100).toFixed(0)+'%'}</small></td>`;};
  let h='', uc=0, up=0, ns=0; const nsh=bi=>NB&&NB.T>0?(NB.b.get(bi)||0)/NB.T:null;
  zbs.forEach(bi=>{if(brick&&D.brands[bi].a){if(!skipZ)h+='<td class="r num shc zc"><span class="muted" title="Estimated at position level only — no brick split">pos.</span></td>';return;} const v=cb.get(bi)||[0,0]; uc+=v[0]; up+=v[1]; const n=nsh(bi); ns+=n||0; if(!skipZ)h+=cell(v[0],v[1],' zc',n);});
  comps.forEach(bi=>{const v=cb.get(bi)||[0,0]; uc+=v[0]; up+=v[1]; const n=nsh(bi); ns+=n||0; h+=cell(v[0],v[1],'',n);});
  return h+cell(Math.max(0,mk-uc),Math.max(0,mkp-up),'',NB&&NB.T>0?Math.max(0,1-ns):null);
}
function renderPosRegions(){
  $('#ig-pRegChips').innerHTML=['ALL',...REG].map(r=>`<button class="rchip" data-r="${esc(r)}" aria-pressed="${ST.region===r}">${r==='ALL'?'All regions':esc(r)}</button>`).join('');
  $('#ig-pRegChips').querySelectorAll('button').forEach(b=>b.onclick=()=>{ST.region=b.dataset.r;render();});
}
function renderPos(C,P){
  renderPosRegions();
  P=P.slice().sort((a,b)=>b.pot-a.pot);
  const comps=(LASTS&&LASTS.comp?LASTS.comp:[]).slice(0,5), zbs=C.zBrands, ul=UL();
  const nat={}; for(const L in C.byL){nat[L]={mk:C.byL[L].mk.reduce((t,v)=>t+v,0),z:C.byL[L].z.reduce((t,v)=>t+v,0)};}
  const gs=(v,L,k)=>{const d=nat[L]&&nat[L][k]; return d>0?pct(v/d):'–';};
  const NBL={}; C.bb.forEach(m=>{for(const [bi,v] of m){const L=lineOfMkt[D.brands[bi].m]; const t=NBL[L]??={T:0,b:new Map()}; t.T+=v[0]; t.b.set(bi,(t.b.get(bi)||0)+v[0]);}});
  const zIx=v=>v==null?'<span class="muted">–</span>':`<span class="idx ${v<90?'i-lo':v>110?'i-hi':'i-mid'}">${Math.round(v)}</span>`;
  $('#ig-pSum').innerHTML=`${ST.region==='ALL'?'All regions':esc(ST.region)} · ${P.length} positions · ${P.filter(o=>o.vac!=='Filled').length} vacant · click ▸ to open bricks`;
  if(ST.pq) P=P.filter(o=>(o.name+' '+o.rep+' '+o.dm).toLowerCase().includes(ST.pq));
  const lim=ST.pAll||ST.pq?P.length:40; $('#ig-pMore').hidden=P.length<=lim;
  const eff=e=>e==null?'<span class="muted">–</span>':`<span class="idx ${e<0.8?'i-lo':e>1.2?'i-hi':'i-mid'}">${e.toFixed(2)}</span>`;
  const segChip=s=>`<span class="chip" style="background:color-mix(in srgb,${PCOL[s]} 18%,transparent);color:var(--fg)">${s}</span>`;
  const short=n=>n.replace(/ Solid Oral.*| Oral cap.*/,'');
  const zn=esc(zName(C));
  const zl=esc(zLab(C)), one=zbs.length<=1, nComp=(one?0:zbs.length)+comps.length+1, gth='style="position:static;text-align:center;border-bottom:2px solid var(--border-strong);cursor:default"';
  const head=`<thead><tr><th colspan="3" ${gth}>Position</th><th colspan="3" ${gth}>Market · ${ul}</th><th colspan="6" class="zh" ${gth}>${zl} performance</th><th colspan="${nComp}" ${gth} title="Each cell: share of the position's market · FSI = Fair Share Index vs the brand's national share (100 = national) · pts = change vs same months last year · gr = growth">Share of this position's market — vs competitors</th></tr>
    <tr><th></th><th>Position / brick</th><th>Medical rep / allocation</th>
    <th class="r" title="Position market (bricks × organogram allocation)">Size</th><th class="r" title="vs same months last year">Growth</th><th class="r" title="Position market ÷ national market of the line">% of<br>national</th>
    <th class="r zh" title="${zn}">Sales</th><th class="r zh" title="vs same months last year">Growth</th><th class="r zh" title="${zl} ÷ position market · pts = change vs same months last year">Share</th><th class="r zh" title="Fair Share Index = share here ÷ national share × 100 · 100 = national level · below 90 weak · above 110 strong">Fair Share<br>Index</th><th class="r zh" title="Evolution Index = 100 × (1 + product growth) ÷ (1 + market growth) · above 100 = growing faster than the market">Evolution<br>Index</th><th class="r zh" title="Position ${zl} ÷ national ${zl} of the line">% of<br>national</th>
    ${one?'':zbs.map(bi=>`<th class="r zh" title="${esc(D.brands[bi].n)} share${D.brands[bi].a?' — ≈ estimated from national IQVIA (directional)':''}"><i class="sw" style="background:var(--s1)"></i>${esc(short(D.brands[bi].n))}${D.brands[bi].a?' ≈':''}</th>`).join('')}
    ${comps.map(bi=>`<th class="r" title="${esc(D.brands[bi].n)} · ${esc(D.brands[bi].c)}"><i class="sw" style="background:${LASTS.col.get(bi)}"></i>${esc(short(D.brands[bi].n))}</th>`).join('')}
    <th class="r" title="IQVIA aggregate rows + smaller brands"><i class="sw" style="background:var(--other)"></i>Others</th></tr></thead>`;
  const shCell=(z,mk,zp,mkp)=>{const s=mk>0?z/mk:null, sp=(HASPREV&&mkp>0)?zp/mkp:null, d=(s!=null&&sp!=null)?(s-sp)*100:null; return `<td class="r num zc shc"><b>${s==null?'–':pct(s)}</b><small class="${d==null?'muted':d>=0?'up':'dn'}">${d==null?'':(d>=0?'+':'')+d.toFixed(1)+' pts'}</small></td>`;};
  let rows='';
  for(const o of P.slice(0,lim)){
    const open=ST.open.has(o.p);
    rows+=`<tr class="prow" data-p="${o.p}"><td class="tog" data-t="${o.p}" title="Show bricks">${open?'▾':'▸'}</td><td><b>${esc(o.name)}</b></td><td>${o.vac!=='Filled'?'<span class="chip s-Grow">Vacant</span>':esc(o.rep)}</td>
      <td class="r num">${fmt(o.pot)}</td><td class="r num">${grH(o.gm)}</td><td class="r num muted">${gs(o.pot,o.line,'mk')}</td>
      <td class="r num zc">${fmt(o.z)}</td><td class="r num zc">${C.hasZ?(o.gzNat?'<span class="muted" title="≈ Estimated sales use a fixed 2026 split, so growth here equals the national trend">nat.</span>':grH(o.gz)):'–'}</td>${C.hasZ?shCell(o.z,o.pot,o.zp,o.potP):'<td class="r num zc">–</td>'}<td class="r num zc">${C.hasZ?zIx((nat[o.line]&&nat[o.line].z>0&&o.pot>0)?(o.z/o.pot)/(nat[o.line].z/nat[o.line].mk)*100:null):'–'}</td><td class="r num zc">${o.ei==null?'–':Math.round(o.ei)}</td><td class="r num zc muted">${C.hasZ?gs(o.z,o.line,'z'):'–'}</td>
      ${shareCells(o.pot,o.potP,o.cb,zbs,comps,NBL[o.line],0,one)}</tr>`;
    if(open){
      const brs=o.br.map(([b,al])=>({b,al,...lineBrick(C,b,o.line)})).sort((a,b)=>b.mk*b.al-a.mk*a.al);
      const n=nat[o.line]||{mk:0,z:0}, natSh=n.mk>0?n.z/n.mk:0;
      for(const x of brs){const sh=x.mk>0?x.z/x.mk:null, idx=(sh!=null&&natSh>0)?sh/natSh*100:null, gm=gr(x.mk,x.mkp), gz=gr(x.z,x.zp), ei=(gz!=null&&gm!=null)?100*(1+gz)/(1+gm):null;
        rows+=`<tr class="brow" data-k="${x.b}"><td></td><td>↳ ${esc(D.bricks[x.b].n)} <span class="muted">${esc(D.bricks[x.b].t)}</span></td><td class="muted">allocation ${pct(x.al,0)}</td>
          <td class="r num">${fmt(x.mk)}</td><td class="r num">${grH(gm)}${gm!=null&&Math.abs(gm)>0.6?' <span title="Possible IQVIA brick re-definition" style="color:var(--warn)">⚠</span>':''}</td><td class="r num muted">${gs(x.mk,o.line,'mk')}</td>
          ${C.ancOnly.has(o.line)?'<td class="r num zc"><span class="muted" title="Estimated at position level only — no brick split">pos.</span></td>'.repeat(6):`<td class="r num zc">${fmt(x.z)}</td><td class="r num zc">${C.hasZ?grH(gz):'–'}</td>${C.hasZ?shCell(x.z,x.mk,x.zp,x.mkp):'<td class="r num zc">–</td>'}<td class="r num zc">${C.hasZ?zIx(idx):'–'}</td><td class="r num zc">${ei==null?'–':Math.round(ei)}</td><td class="r num zc muted">${C.hasZ?gs(x.z,o.line,'z'):'–'}</td>`}
          ${shareCells(x.mk,x.mkp,x.br,zbs,comps,NBL[o.line],1,one)}</tr>`;}
    }
  }
  $('#ig-pTbl').innerHTML=head+`<tbody>${rows}</tbody>`;
  $('#ig-pTbl').querySelectorAll('td.tog').forEach(td=>td.onclick=e=>{e.stopPropagation();const p=+td.dataset.t; ST.open.has(p)?ST.open.delete(p):ST.open.add(p); renderPos(LAST,LASTP);});
  $('#ig-pTbl').querySelectorAll('tr.prow').forEach(tr=>tr.onclick=()=>openPos(+tr.dataset.p));
  $('#ig-pTbl').querySelectorAll('tr.brow').forEach(tr=>tr.onclick=()=>openBrick(+tr.dataset.k));
}
function openPos(p){
  const C=LAST, o=(LASTP||[]).find(x=>x.p===p); if(!o)return; const dr=$('#ig-drawer'), L=o.line;
  const brs=o.br.map(([b,al])=>{const mk=C.byL[L].mk[b], z=C.byL[L].z[b]; let lb=null,lv=0; for(const [bi,v] of C.bb[b]){const B=D.brands[bi]; if(!B.z&&!isAgg(B)&&lineOfMkt[B.m]===L&&v[0]>lv){lv=v[0];lb=bi;}}
    return {b,al,mk,sh:(mk>0&&!C.ancOnly.has(L))?z/mk:null,lb,lsh:mk>0?lv/mk:null};}).sort((a,b)=>b.mk*b.al-a.mk*a.al);
  const nat=new Map(); C.bb.forEach(m=>{for(const [bi,v] of m){const B=D.brands[bi]; if(lineOfMkt[B.m]===L) nat.set(bi,(nat.get(bi)||0)+v[0]);}});
  const natT=C.byL[L].mk.reduce((t,v)=>t+v,0);
  const comp=[...o.comp].sort((a,b)=>b[1]-a[1]).slice(0,6);
  const natZ=natT>0?C.byL[L].z.reduce((t,v)=>t+v,0)/natT:null;
  const CR=[{n:zLab(C),z:1,col:'var(--s1)',ts:o.sh,ns:natZ,g:o.gzNat?'nat':o.gz},...comp.map(([bi,v])=>{const x=o.cb.get(bi)||[0,0]; return {n:D.brands[bi].n,c:D.brands[bi].c.replace('*',''),col:LASTS.col.get(bi)||'var(--other)',ts:o.pot>0?v/o.pot:null,ns:natT>0?(nat.get(bi)||0)/natT:null,g:HASPREV?gr(x[0],x[1]):null};})];
  const rd=r=>{if(r.ts==null||r.ns==null)return {d:null,t:'–',c:'muted'}; const d=(r.ts-r.ns)*100;
    if(Math.abs(d)<1)return {d,t:'Same as national',c:'muted'};
    return r.z?(d>0?{d,t:'Stronger here',c:'up'}:{d,t:'Weaker here',c:'dn'}):(d>0?{d,t:'Stronger here — threat',c:'dn'}:{d,t:'Weaker here',c:'up'});};
  const thr=CR.filter(r=>!r.z).map(r=>({r,x:rd(r)})).filter(o_=>o_.x.d!=null&&o_.x.d>=1).sort((a,b)=>b.x.d-a.x.d)[0], zr=rd(CR[0]);
  const headline=`${CR[0].ts==null?'':`<b>${esc(CR[0].n)}</b> has ${pct(CR[0].ts)} of this position's market vs ${pct(CR[0].ns)} nationally (${zr.d==null?'':(zr.d>=0?'+':'')+zr.d.toFixed(1)+' pts'}). `}${thr?`Biggest threat here: <b>${esc(thr.r.n)}</b> — ${pct(thr.r.ts)} here vs ${pct(thr.r.ns)} nationally (+${thr.x.d.toFixed(1)} pts).`:'No competitor is clearly stronger here than nationally.'}`;
  const compBlock=`<div><h2 class="dh">Who is winning in this position vs nationally</h2><p class="lead">${headline}</p><div class="tbl-wrap" style="max-height:none"><table class="dt cmpx"><thead><tr><th>Brand</th><th class="r">Share here</th><th class="r">Nationally</th><th class="r">Difference</th></tr></thead><tbody>${CR.map(r=>{const x=rd(r); return `<tr class="${r.z?'zeta':''}"><td><i class="sw" style="background:${r.col}"></i><b>${esc(r.n)}</b>${r.c?`<small class="muted">${esc(r.c)}</small>`:''}<small class="muted">growth here ${r.g==='nat'?'= national trend':r.g==null?'n/a':(r.g>=0?'+':'')+(r.g*100).toFixed(0)+'%'}</small></td><td class="r num">${pct(r.ts)}</td><td class="r num">${pct(r.ns)}</td><td class="r num"><b class="${x.c}">${x.d==null?'–':(x.d>=0?'+':'')+x.d.toFixed(1)+' pts'}</b><small class="${x.c}">${x.t}</small></td></tr>`;}).join('')}</tbody></table></div><p class="foot">Share = the brand's part of the tracked market in this position (all bricks the position covers). Difference = share here minus national share, in points. A competitor that is stronger here than nationally is the one to counter in this territory.</p></div>`;
  dr.innerHTML=`<button class="x" aria-label="Close">×</button>
   <div><div class="sub">${esc(o.line)} · DM ${esc(o.dm)} · NSM ${esc(o.nsm)}</div><h1 style="font-size:18px">${esc(o.name)}</h1><div>${o.vac!=='Filled'?'<span class="chip s-Grow">Vacant</span>':esc(o.rep)} <span class="chip" style="background:color-mix(in srgb,${PCOL[o.seg]} 18%,transparent);color:var(--fg)">${o.seg}</span></div></div>
   <div class="mini"><div><div class="l">Market size</div><div class="v">${fmt(o.pot)}</div></div><div><div class="l">${esc(zLab(C))} share</div><div class="v">${pct(o.sh)}</div></div><div><div class="l">Fair Share Index</div><div class="v">${o.idx==null?'–':Math.round(o.idx)}</div></div>
   <div><div class="l">Gap to fair share</div><div class="v">${fmt(o.gap)}</div></div><div><div class="l">Market growth</div><div class="v">${grH(o.gm)}</div></div><div><div class="l">Lead competitor</div><div class="v" style="font-size:13px">${o.lead?esc(D.brands[o.lead.b].n)+' '+pct(o.lead.sh):'–'}</div></div></div>
   ${compBlock}
   <div><h2 class="dh">Bricks covered</h2><div class="tbl-wrap" style="max-height:280px"><table class="dt"><thead><tr><th>Brick</th><th class="r">Allocation</th><th class="r">Brick market</th><th class="r">${esc(zLab(C))} share</th><th>Lead competitor</th></tr></thead><tbody>
   ${brs.map(x=>`<tr data-k="${x.b}"><td>${esc(D.bricks[x.b].n)}</td><td class="r num">${pct(x.al,0)}</td><td class="r num">${fmt(x.mk)}</td><td class="r num">${pct(x.sh)}</td><td>${x.lb==null?'–':esc(D.brands[x.lb].n)+' <span class="muted num">'+pct(x.lsh)+'</span>'}</td></tr>`).join('')}
   </tbody></table></div></div>`;
  dr.hidden=false; dr.querySelector('.x').onclick=()=>dr.hidden=true; dr.querySelector('.x').focus();
  dr.querySelectorAll('tbody tr[data-k]').forEach(tr=>tr.onclick=()=>openBrick(+tr.dataset.k));
}
let LASTP=null;

function openBrick(k){
  const C=LAST, r=C.rows[k], dr=$('#ig-drawer'), mi=ST.meas==='v'?3:4;
  const agg={}; for(const f of D.facts){if(f[1]!==k)continue;const b=D.brands[f[0]]; if(!C.ms.has(b.m)||!okD2(b))continue; if(ST.sec!=='all'&&f[2]!=+ST.sec)continue;
    const o=agg[f[0]]??={b,c:0,p:0}; o.c+=sIdx(f[mi],C.PI.cur); o.p+=C.PI.ok?sIdx(f[mi],C.PI.prev):0;}
  const comp=Object.values(agg).filter(o=>o.c>0||o.p>0).sort((a,b)=>b.c-a.c);
  const lines=new Set([...C.ms].map(i=>lineOfMkt[i]));
  const cov=D.alloc.filter(a=>a[1]===k&&lines.has(D.pos[a[0]][1])).map(a=>({P:D.pos[a[0]],al:a[2],resp:a[3]})).sort((a,b)=>b.al-a.al);
  dr.innerHTML=`<button class="x" aria-label="Close">×</button>
   <div><div class="sub">${esc(r.r)} › ${esc(r.t)}</div><h1 style="font-size:18px">${esc(r.n)}</h1><span class="chip s-${r.seg}">${r.seg==='Low'?'Low base':r.seg}</span></div>
   <div class="mini"><div><div class="l">Market</div><div class="v">${fmt(r.mk)}</div></div><div><div class="l">Growth</div><div class="v">${grH(r.gm)}</div></div><div><div class="l">${esc(zLab(C))} share</div><div class="v">${C.hasZ&&!r.low?pct(r.sh):'–'}</div></div>
   <div><div class="l">Fair Share Index</div><div class="v">${r.idx==null?'–':Math.round(r.idx)}</div></div><div><div class="l">Evolution index</div><div class="v">${r.ei==null?'–':Math.round(r.ei)}</div></div><div><div class="l">Gap to fair share</div><div class="v">${r.gap>0?fmt(r.gap):'–'}</div></div></div>
   <div><h2 style="font-size:12px;text-transform:uppercase;color:var(--fg-2);letter-spacing:.05em;margin:0 0 6px">Tracked brands in this brick</h2>
   <div class="tbl-wrap" style="max-height:300px"><table class="dt"><thead><tr><th>Brand</th><th>Corporation</th><th class="r">Value</th><th class="r">Share</th><th class="r">Growth</th></tr></thead><tbody>
   ${comp.map(o=>`<tr class="${o.b.z?'zeta':''}"><td>${esc(o.b.n)}${o.b.in?` <span class="chip s-Low" title="Contains ${esc(o.b.in)}">incl. ${esc(o.b.in)}</span>`:''}</td><td class="muted">${esc(o.b.c)}</td><td class="r num">${fmt(o.c)}</td><td class="r num">${pct(r.mk>0?o.c/r.mk:null)}</td><td class="r num">${grH(gr(o.c,o.p))}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No tracked sales</td></tr>'}
   </tbody></table></div></div>
   <div><h2 style="font-size:12px;text-transform:uppercase;color:var(--fg-2);letter-spacing:.05em;margin:0 0 6px">Covering positions (organogram July 2026)</h2>
   <div class="tbl-wrap" style="max-height:260px"><table class="dt"><thead><tr><th>Position</th><th>Rep</th><th class="r">Responsibility</th><th class="r">Allocation</th></tr></thead><tbody>
   ${cov.map(c=>`<tr><td>${esc(c.P[0])}</td><td>${c.P[5]!=='Filled'?'<span class="chip s-Grow">Vacant</span>':esc(c.P[2])}</td><td class="r num">${pct(c.resp,0)}</td><td class="r num">${pct(c.al,0)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No position of the selected line covers this brick (white space)</td></tr>'}
   </tbody></table></div><p class="foot">Responsibility = organogram Share (credit, not additive). Allocation = share of the brick's market value used for position potential (adds to 100%).</p></div>`;
  dr.hidden=false; dr.querySelector('.x').onclick=()=>dr.hidden=true; dr.querySelector('.x').focus();
}



    if(!global.__igeoEsc){global.__igeoEsc=1; root.ownerDocument.addEventListener('keydown',e=>{if(e.key!=='Escape')return; const d=document.getElementById('ig-drawer'); if(d) d.hidden=true;});}
    $('#ig-asof').title='Built '+D.meta.built;
    syncPeriod(); syncControls();
    const SV=loadState();
    if(SV){ Object.assign(ST,SV,{open:new Set(SV.open||[])}); } else { const dflt=D.markets.findIndex(m=>m.n==='PPI _ORAL_SOLID FORM'); if(dflt>=0) ST.mkt=String(dflt); }
    $('#ig-fPt').value=ST.ptype; syncControls(); syncPeriod();
    [['#ig-fMeas','meas'],['#ig-fSec','sec']].forEach(([id,k])=>root.querySelectorAll(id+' button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===ST[k]))));
    if(ST.anc===undefined) ST.anc=true; const al=$('#ig-fAlloc'); if(al) al.checked=ST.anc!==false; const ps=$('#ig-pSearch'); if(ps) ps.value=ST.pq||'';
    try{ render(); }catch(e){ if(!SV) throw e; console.warn('[TerritoryMarket] saved filters no longer valid, reset',e); clearState(); root.innerHTML=''; return mount(root); }
    SNAP=()=>Object.assign({},ST,{open:[...ST.open]});
  }
  var HOST=null, SNAP=null, KEY='zeta_tmi_filters';
  // Filters survive leaving the page and coming back (and a reload in the same browser tab).
  function loadState(){ if(global.__tmiState) return global.__tmiState; try{ var s=sessionStorage.getItem(KEY); return s?JSON.parse(s):null; }catch(e){ return null; } }
  function saveState(){ if(!SNAP) return; try{ var s=SNAP(); global.__tmiState=s; sessionStorage.setItem(KEY,JSON.stringify(s)); }catch(e){} }
  function clearState(){ global.__tmiState=null; try{ sessionStorage.removeItem(KEY); }catch(e){} }
  function init(containerId){
    var c=document.getElementById(containerId); if(!c) return;
    document.body.classList.add('tmi-mode');
    c.innerHTML='<div id="tmi-host"></div>'; HOST=document.getElementById('tmi-host');
    try{ mount(HOST); }catch(e){ console.error('[TerritoryMarket]',e); HOST.innerHTML='<div style="padding:24px">Territory Market Insights could not render: '+String(e&&e.message||e)+'</div>'; }
  }
  function destroy(){ saveState(); SNAP=null; document.body.classList.remove('tmi-mode'); var d=document.getElementById('ig-drawer'); if(d) d.hidden=true; if(HOST){HOST.innerHTML='';HOST=null;} }
  global.IqviaGeo={mount:mount};
  global.addEventListener('beforeunload',saveState);
  global.TerritoryMarketDashboard={init:init,destroy:destroy};
})(window);
