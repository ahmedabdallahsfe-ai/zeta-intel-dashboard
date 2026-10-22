/* 2026-10-13: champion engine -- v1 and v2 methods compete per market (etl/build_market_forecast_v2.py --publish).
   Reads the same cache contract; extra fields (engine, method_plain, why.headline / watch_outs, forecast_type
   'launch_curve' | 'intermittent' | 'safeguard') are optional, so an older v1 cache still renders. */
/* market-forecast.js — Market Growth Forecast (FY next year, IQVIA Standard Units). Added 2026-10-12 (Ahmed).
   Data: window.MARKET_FORECAST_CACHE (cache/market_forecast.data.js, built by `etl/build_market_forecast.py --cache`
   from cache/iqvia.json). Opened from the sidebar (app.js renderMarketForecastTab). Ids prefixed "mf-", CSS scoped to
   .mfc (css/market-forecast.css). Every number on this page is computed in the ETL; this file only displays it.
   Methodology: the ETL docstring + the "Methodology" panel at the bottom of the page. */
(function (global) {
  'use strict';

  function decode() {
    var c = global.MARKET_FORECAST_CACHE;
    if (!c || !c.b64Data || typeof pako === 'undefined') return null;
    var bin = atob(c.b64Data), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var d = JSON.parse(pako.ungzip(bytes, { to: 'string' }));
    // 2026-10-16 (Ahmed): non-promoted lines are not planned here - drop the Non-Promoted BU / Line views
    // (their Zeta products are already left out of every market by the ETL).
    if (d && d.segments) d.segments = d.segments.filter(function (r) { return !((r.type === 'BU' || r.type === 'Line') && /^non[-_ ]?promoted$/i.test(String(r.name || '').trim())); });
    return d;
  }

  var D = null, HOST = null, ROOT = null;
  var ST = { level: 'DM1', seg: {}, sort: 'size', meas: 'su', f: { BU: '', Line: '', DM1: '', DM2: '' } };   // meas: 'su' | 'val' (2026-10-15)
  var KEY = 'zeta_mf_state';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LEVELS = [['DM1', 'Defined market (DM1)'], ['DM2', 'Defined market (DM2)'], ['BU', 'Business unit'], ['Line', 'Line'], ['Total', 'Egypt total']];
  var MODEL_SHORT = { NAIVE: 'Seasonal naive (benchmark)', A: 'A · Historical CAGR', B: 'B · Recent 2-yr CAGR', C1: 'C1 · Linear trend',
    C2: 'C2 · Holt damped trend', MED: 'Median of A, B, C1, C2', RUNRATE: 'Run-rate floor' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fin(v) { return v != null && isFinite(v); }
  function fmtSU(v) {
    if (!fin(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + ' B';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + ' M';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + ' K';
    return Math.round(v).toLocaleString();
  }
  function fmtP(p, d) { if (!fin(p)) return '—'; if (p >= 1000) return 'New'; return (p > 0 ? '+' : '') + p.toFixed(d == null ? 1 : d) + '%'; }   // p already in %; >= +1000% = launch base -> "New" (2026-10-16)
  function fmtF(x, d) { return fin(x) ? fmtP(x * 100, d) : '—'; }                                                    // x is a fraction
  function per(p) { return MON[+p.slice(5, 7) - 1] + ' ' + p.slice(0, 4); }
  function confCls(c) { return c === 'Higher' ? 'hi' : c === 'Moderate' ? 'mo' : 'lo'; }

  // ── access scope (page is SFE/Admin only today; scope rules make a later widening safe) ──
  function AU() { return global.AUTH || {}; }
  function buOk(b) { var a = AU(); return typeof a.isBuAllowed !== 'function' || a.isBuAllowed(b); }
  function lineOk(l) { var a = AU(); return typeof a.isLineAllowed !== 'function' || a.isLineAllowed(l); }
  var ALLOWED = null;
  function computeScope() {
    var bus = D.segments.filter(function (r) { return r.type === 'BU'; });
    var lines = D.segments.filter(function (r) { return r.type === 'Line'; });
    var unrestricted = bus.every(function (r) { return buOk(r.name); }) && lines.every(function (r) { return lineOk(r.name); });
    var dm1 = {};
    bus.forEach(function (r) { if (buOk(r.name)) (r.members || []).forEach(function (m) { dm1[m] = 1; }); });
    lines.forEach(function (r) { if (lineOk(r.name)) (r.members || []).forEach(function (m) { dm1[m] = 1; }); });
    ALLOWED = function (r) {
      if (unrestricted) return true;
      if (r.type === 'BU') return buOk(r.name);
      if (r.type === 'Line') return lineOk(r.name);
      if (r.type === 'DM1') return !!dm1[r.name];
      return false;   // DM2 + Egypt total: unrestricted users only (no DM2 -> BU link in the cache)
    };
  }

  function segs(level) { return D.segments.filter(function (r) { return r.type === level && ALLOWED(r); }); }
  function cur() {
    var list = segs(ST.level); if (!list.length) return null;
    var n = ST.seg[ST.level];
    var r = list.find(function (x) { return x.name === n; });
    if (!r) { r = list.slice().sort(function (a, b) { return size(b) - size(a); })[0]; ST.seg[ST.level] = r.name; }
    return r;
  }
  function size(r) { var v = V(r); return fin(v.fy_target) ? v.fy_target : (v.hist(String(D.meta.full_years[D.meta.full_years.length - 1])) || 0); }

  // 2026-10-15 (Ahmed): Standard Units <-> Value (EGP). Value = SU forecast x today's price per SU (etl/market_forecast_value.py).
  function isV() { return (ST.meas === 'val' || ST.meas === 'pk') && hasVal(); }
  // 2026-10-20 (Ahmed: "add packs beside SU and value"): Packs view = the value machinery run on a copy of the data whose
  // value slots hold packs (seg.packs / seg.scorecard_pk from etl/market_forecast_packs.py: SU / IQVIA pack size; FY packs =
  // SU forecast x packs per SU of the last 6 months). Plans stay in SU shares; packs follow from each item's own pack mix.
  var D_SU = null, D_PK = null;
  function hasPK() { var b = D_SU || D; return !!b && b.segments.some(function (r) { return r.packs && fin(r.packs.fy_target); }); }
  function isPK() { return ST.meas === 'pk' && hasPK(); }
  function pkData() {
    if (!D_PK) D_PK = { meta: D_SU.meta, segments: D_SU.segments.map(function (r) { return r.packs ? Object.assign({}, r, { value: r.packs, scorecard: r.scorecard_pk || r.scorecard }) : r; }) };
    return D_PK;
  }
  function setD() { if (D_SU) D = isPK() ? pkData() : D_SU; }
  function withMeasD(pk, fn) {   // run fn with the SU/value data (pk=false) or the packs data (pk=true); restores the page state
    var d0 = D, m0 = ST.meas; D = pk ? pkData() : D_SU; ST.meas = pk ? 'pk' : (m0 === 'pk' ? 'val' : m0);
    try { return fn(); } finally { D = d0; ST.meas = m0; }
  }
  function VU() { return isPK() ? 'packs' : 'EGP'; }
  var PK_TX = [[/Value \(EGP\)/g, 'Packs'], [/value \(EGP\)/g, 'packs'], [/value \(EGP, at today's prices for the forecast\)/g, 'packs (at today\'s pack mix for the forecast)'], [/\(EGP, /g, '(packs, '], [/\(EGP\)/g, '(packs)'],
    [/At today's prices/g, "At today's pack mix"], [/at today's prices/g, "at today's pack mix"], [/Price per SU/g, 'Packs per SU'], [/price per SU/g, 'packs per SU'], [/\(value\)/g, '(packs)'], [/ value /g, ' packs '], [/Value /g, 'Packs '], [/EGP/g, 'packs']];
  function pkLabels(el) {   // Packs view: relabel the value wording that is written inline in the page
    if (!el || !isPK() || !el.ownerDocument) return;
    var fix = function (t) { PK_TX.forEach(function (p) { t = t.replace(p[0], p[1]); }); return t; };
    var w = el.ownerDocument.createTreeWalker(el, 4), n;
    while ((n = w.nextNode())) { if (n.parentNode && (/^(SCRIPT|STYLE|OPTION)$/.test(n.parentNode.nodeName) || (n.parentNode.closest && n.parentNode.closest('#mf-meas')))) continue; if (/EGP|[Vv]alue|[Pp]rice/.test(n.nodeValue)) n.nodeValue = fix(n.nodeValue); }
    el.querySelectorAll('[title],[aria-label]').forEach(function (e) { ['title', 'aria-label'].forEach(function (a) { var v = e.getAttribute(a); if (v && /EGP|[Vv]alue|[Pp]rice/.test(v)) e.setAttribute(a, fix(v)); }); });
  }
  function hasVal() { return D && D.segments.some(function (r) { return r.value && fin(r.value.fy_target); }); }
  function V(r) {
    var f = r.forecast || {};
    if (isV() && r.value) {
      var v = r.value;
      return { val: true, unit: VU(), hist: function (y) { return (v.history || {})[y]; }, ytd: v.ytd || {}, monthly: v.monthly || [], path: v.path || [],
        fy_le: v.fy_le, fy_target: v.fy_target, growth: v.growth_vs_le_pct, yoy: v.yoy_pct || {}, hc: v.hist_cagr || {}, rc: v.recent_cagr || {} };
    }
    return { val: false, unit: 'SU', hist: function (y) { return (r.history[y] || {}).su; }, ytd: r.ytd, monthly: r.monthly_su, path: f.path || [],
      fy_le: f.fy_le, fy_target: f.fy_target, growth: f.growth_vs_le_pct, yoy: r.yoy_pct, hc: r.hist_cagr, rc: r.recent_cagr };
  }
  function fmtM(v, val) { if (!fin(v)) return '—'; return val ? (isPK() ? fmtSU(v) + ' packs' : 'EGP ' + fmtSU(v)) : fmtSU(v) + ' SU'; }

  // ── markup ──
  function shell() {
    var m = D.meta;
    return '<div class="wrap">' +
      '<header class="top"><div><h1>Market Growth Forecast — FY' + m.target_year + '</h1>' +
      '<div class="sub" id="mf-hsub"></div></div>' +
      '<div class="sub asof">Actuals to <b>' + esc(per(m.data_period)) + '</b> · built ' + esc(m.generated_at) + '</div></header>' +
      '<div class="mfstick" id="mf-stick"><section class="card controls" aria-label="Filters">' +
      FK.filter(function (k) { return segs(k).length; }).map(function (k) { return '<div class="ctl grow fdd"><label for="mf-f' + k + '">' + esc(FLBL[k]) + '</label><select id="mf-f' + k + '" data-f="' + k + '"></select></div>'; }).join('') +
      '<div class="ctl"><label>&nbsp;</label><button type="button" class="xbtn ghost" id="mf-freset" title="Clear all market filters">Reset</button></div>' +
      (hasVal() ? '<div class="ctl"><label>Measure</label><div class="seg" id="mf-meas"><button data-v="su" aria-pressed="' + (ST.meas !== 'val' && ST.meas !== 'pk') + '">Standard Units</button><button data-v="val" aria-pressed="' + (ST.meas === 'val') + '">Value (EGP)</button>' + (hasPK() ? '<button data-v="pk" aria-pressed="' + (ST.meas === 'pk') + '" title="IQVIA Standard Units ÷ pack size of each item">Packs</button>' : '') + '</div></div>' : '') +
      '</section>' +
      '<nav class="mfnav" id="mf-nav" aria-label="Page sections">' + SECS.map(function (x, i) { return '<a href="#' + x[0] + '" data-t="' + x[0] + '"><span class="secn">' + (i + 1) + '</span>' + esc(x[1]) + '</a>'; }).join('') + '</nav></div>' +
      secHd(1, 'Summary', 'the market, its FY' + m.target_year + ' forecast and where Zeta stands') + '<div id="mf-sum"></div>' +
      secHd(2, 'Zeta portfolio', 'where FY' + m.target_year + ' is won or lost (SFE view)') + '<section class="card pf" id="mf-pf"></section>' +
      secHd(3, 'Market forecast', 'why this number, history and monthly path') + '<div id="mf-detail"></div>' +
      secHd(4, 'Competition', 'who wins the market and what moves it') + '<div id="mf-comp"></div>' +
      secHd(5, 'Zeta FY' + m.target_year + ' plan', 'objective, ' + PN() + ' forecast' + (isSFEView() ? ' and share verdict' : '')) + '<div id="mf-ov"></div>' +
      '</div>';
  }

  // 2026-10-17 (Ahmed): ONE filter section — Business unit / Line / DM1 / DM2 drop-downs that narrow each other.
  // The page shows the most specific choice (DM2, else DM1, else Line, else BU, else the Egypt total).
  var FK = ['BU', 'Line', 'DM1', 'DM2'], FLBL = { BU: 'Business unit', Line: 'Line', DM1: 'Defined market (DM1)', DM2: 'Defined market (DM2)' };
  var LK = null;
  function links() {
    if (LK) return LK;
    var L0 = (D.meta && D.meta.links) || {}, d12 = L0.dm1_dm2 || null, lb = L0.line_bu || null, d21 = {};
    if (d12) Object.keys(d12).forEach(function (a) { d12[a].forEach(function (b) { (d21[b] = d21[b] || []).push(a); }); });
    else segs('DM2').forEach(function (r) { if (segs('DM1').some(function (q) { return q.name === r.name; })) d21[r.name] = [r.name]; });   // fallback: same-name twin
    if (!lb) { lb = {}; segs('Line').forEach(function (l) { segs('BU').forEach(function (b) { if ((l.members || []).length && l.members.every(function (m) { return (b.members || []).indexOf(m) >= 0; })) (lb[l.name] = lb[l.name] || []).push(b.name); }); }); }
    return (LK = { d21: d21, lb: lb });
  }
  function bySize(a) { return a.slice().sort(function (x, y) { return size(y) - size(x); }); }
  function segOf(k, n) { return segs(k).find(function (q) { return q.name === n; }); }
  function fOpts(k) {
    var F = ST.f, X = links();
    if (k === 'BU') return bySize(segs('BU'));
    if (k === 'Line') return bySize(segs('Line').filter(function (l) { return !F.BU || (X.lb[l.name] || []).indexOf(F.BU) >= 0; }));
    var base = F.Line && segOf('Line', F.Line) ? segOf('Line', F.Line).members : F.BU && segOf('BU', F.BU) ? segOf('BU', F.BU).members : null;
    if (k === 'DM1') return bySize(segs('DM1').filter(function (q) { return !base || base.indexOf(q.name) >= 0; }));
    var d1 = F.DM1 ? [F.DM1] : base ? fOpts('DM1').map(function (q) { return q.name; }) : null;
    return bySize(segs('DM2').filter(function (q) { return !d1 || (X.d21[q.name] || []).some(function (a) { return d1.indexOf(a) >= 0; }); }));
  }
  function fFix() { FK.forEach(function (k) { if (ST.f[k] && !fOpts(k).some(function (q) { return q.name === ST.f[k]; })) ST.f[k] = ''; }); }
  function fUp(k) {   // a lower choice fills the level above it when that is unambiguous
    var F = ST.f, X = links();
    if (k === 'DM2' && F.DM2 && !F.DM1) { var a = (X.d21[F.DM2] || []).filter(function (n) { return segOf('DM1', n); }); if (a.length === 1) F.DM1 = a[0]; }
    if ((k === 'DM2' || k === 'DM1') && F.DM1 && !F.Line && !F.BU) { /* a DM1 can sit in several BUs / Lines: leave them open */ }
    if (k === 'Line' && F.Line && !F.BU) { var b = (X.lb[F.Line] || []).filter(function (n) { return segOf('BU', n); }); if (b.length === 1) F.BU = b[0]; }
  }
  function fView() {
    var F = ST.f, k = F.DM2 ? 'DM2' : F.DM1 ? 'DM1' : F.Line ? 'Line' : F.BU ? 'BU' : 'Total';
    if (k === 'Total' && !segs('Total').length) { k = ['BU', 'Line', 'DM1'].find(function (x) { return segs(x).length; }) || 'DM1'; var q = bySize(segs(k))[0]; if (q) F[k] = q.name; }
    ST.level = k; if (k !== 'Total') ST.seg[k] = F[k];
  }
  function fFrom(type, name) {   // navigation from elsewhere on the page (portfolio, tables)
    var F = ST.f, X = links();
    if (type === 'Total') { ST.f = { BU: '', Line: '', DM1: '', DM2: '' }; }
    else if (type === 'BU') { ST.f = { BU: name, Line: '', DM1: '', DM2: '' }; }
    else if (type === 'Line') { ST.f = { BU: F.BU, Line: name, DM1: '', DM2: '' }; fUp('Line'); }
    else if (type === 'DM1') { ST.f = { BU: F.BU, Line: F.Line, DM1: name, DM2: '' }; }
    else if (type === 'DM2') { ST.f = { BU: F.BU, Line: F.Line, DM1: '', DM2: name }; fUp('DM2'); }
    FK.forEach(function (k) { if (ST.f[k] && !fOpts(k).some(function (q) { return q.name === ST.f[k]; })) { if (k === 'BU' || k === 'Line') { ST.f[k] = ''; } } });
    if (type === 'DM1' || type === 'DM2') { fFix(); if (!ST.f[type]) { ST.f.BU = ''; ST.f.Line = ''; ST.f[type] = name; if (type === 'DM2') fUp('DM2'); } }
    fFix(); fView(); saveState();
  }
  function navTo(type, name, scroll) {
    fFrom(type, name); render();
    if (scroll) goSec(ROOT.querySelector('#mf-s1'));
  }
  function fillSelect() {
    var F = ST.f;
    FK.forEach(function (k) {
      var sel = ROOT.querySelector('#mf-f' + k); if (!sel) return;
      var list = fOpts(k), all = k === 'BU' ? 'All business units' : k === 'Line' ? 'All lines' : 'All ' + k + ' markets';
      sel.innerHTML = '<option value="">' + esc(all) + ' (' + list.length + ')</option>' + list.map(function (r) { return '<option value="' + esc(r.name) + '"' + (r.name === F[k] ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('');
      sel.parentNode.classList.toggle('on', !!F[k] && ST.level === k);
      sel.parentNode.classList.toggle('set', !!F[k]);
    });
    var rb = ROOT.querySelector('#mf-freset'); if (rb) rb.disabled = !FK.some(function (k) { return F[k]; });
  }

  function methodShort(r, k) {
    var m = (D.meta.models || {});
    return m[k] || MODEL_SHORT[k] || k;
  }
  function engineChip(e) {
    if (!e) return '';
    var lbl = e === 'v1' ? 'classic' : e === 'v2' ? 'advanced' : e === 'benchmark' ? 'benchmark' : e === 'safeguard' ? 'safeguard' : e;
    return ' <span class="eng eng-' + esc(e) + '">' + esc(lbl) + '</span>';
  }


  // 2026-10-14 (Ahmed): one forecast per market, no ranges, no statistics -- KPI cards carry business facts only
  function kpis(r) {
    var m = D.meta, ly = String(m.full_years[m.full_years.length - 1]), ra = r.rationale || {}, v = V(r), vv = r.value || {};
    var add = fin(v.fy_target) && fin(v.fy_le) ? v.fy_target - v.fy_le : null;
    var c5 = v.val && isPK()
      ? ['Pack mix', '<span class="kdrv">' + (fin(vv.price_now) && vv.price_now > 0 ? (1 / vv.price_now).toFixed(1) + ' SU per pack' : '—') + '</span>', 'Last 6 months, held for FY' + m.target_year]
      : v.val
      ? ['Value growth split', fmtP(vv.volume_effect_pct) + ' <span class="kss">volume</span> · ' + fmtP(vv.price_effect_pct) + ' <span class="kss">' + (r.type === 'DM1' || r.type === 'DM2' ? 'price' : 'price & mix') + '</span>', 'Today\'s price EGP ' + (fin(vv.price_now) ? vv.price_now.toFixed(2) : '—') + ' per SU, held for FY' + m.target_year]
      : ['Main growth driver', '<span class="kdrv">' + esc(ra.key_driver || '—') + '</span>', ra.drivers && ra.drivers.level === 'market' ? 'Sub-market adding most volume (last 12 months)' : 'Brand adding most volume (last 12 months)'];
    var cards = [
      ['FY' + ly + ' actual', fmtM(v.hist(ly), v.val), 'Latest complete year'],
      ['FY' + m.partial_year + ' landing estimate', fmtM(v.fy_le, v.val), MON[0] + '–' + MON[m.partial_months - 1] + ' actual ' + fmtM(v.ytd.cur, v.val) + ' + ' + MON[m.partial_months % 12] + '–Dec forecast'],
      ['FY' + m.target_year + ' forecast', fmtM(v.fy_target, v.val), v.val ? 'At today\'s prices (EGP)' : 'Standard Units'],
      ['FY' + m.target_year + ' growth vs FY' + m.partial_year, fmtP(v.growth), fin(add) ? (add >= 0 ? 'Market adds ' : 'Market loses ') + fmtM(Math.abs(add), v.val) : ''],
      c5
    ];
    return '<section class="kpis">' + cards.map(function (c) {
      return '<div class="kpi"><div class="kl">' + esc(c[0]) + '</div><div class="kv num">' + c[1] + '</div><div class="ks">' + c[2] + '</div></div>';
    }).join('') + '</section>';
  }

  function banners(r) {
    var h = '';
    if (r.type === 'DM2') h += '<div class="banner info">DM2 markets cut across the DM1 market tree, so they are forecast on their own and are not part of the aligned BU and national totals.</div>';
    if (r.same_as && r.same_as.length) h += '<div class="banner info">Same market (identical products) as ' + esc(r.same_as.join(', ')) + '.</div>';
    var Q = qualityFlags(r);
    if (Q.adjusted) h += '<div class="banner warn"><b>Heavily adjusted to add up.</b> This market on its own was forecast at <b>' + fmtP(Q.baseG) + '</b>; to add up to ' + esc(Q.parent) + ' it was moved to <b>' + fmtP(Q.recG) + '</b> (' + (Q.pts > 0 ? '+' : '') + Q.pts.toFixed(1) + ' pts). Treat the FY' + D.meta.target_year + ' number with caution — ' + PN() + ' can set its own market figure in the ' + PN() + ' forecast row below.</div>';
    if (Q.limited) h += '<div class="banner info"><b>Alignment limited.</b> Adding up to ' + esc(Q.parent) + ' would have moved this market ' + (Q.fullPts > 0 ? '+' : '') + Q.fullPts.toFixed(1) + ' pts away from its own forecast (' + fmtP(Q.baseG) + '). It is limited to ' + Q.capPts + ' pts, so FY' + D.meta.target_year + ' is <b>' + fmtP(Q.recG) + '</b>; the BU total is the sum of its markets.</div>';
    if (Q.contradicts) h += '<div class="banner warn"><b>Check this forecast.</b> FY' + D.meta.target_year + ' growth (' + fmtP(Q.fcG) + ') is ' + Math.abs(Q.fcG - Q.ytdG).toFixed(0) + ' pts away from this year\'s sales so far (' + fmtP(Q.ytdG) + ', ' + esc((r.ytd || {}).months || 'YTD') + '). Confirm launches, supply or competitor changes before using it.</div>';
    if (r.residual_market) h += '<div class="banner info">Includes <b>OTHER MARKET</b>, the residual of everything outside Zeta\'s defined markets. Read it as the background market, not a promoted market.</div>';
    return h;
  }

  // ── charts (inline SVG, colours from CSS variables so night mode works) ──
  function annualChart(r) {
    var m = D.meta, v = V(r), f = fin(v.fy_target) ? v : null, py = m.partial_year, U = v.val ? ' EGP' : ' SU';
    var bars = m.full_years.map(function (y) { return { lab: String(y), a: v.hist(String(y)) || 0, f: 0 }; });
    bars.push({ lab: py + ' LE', a: v.ytd.cur, f: f ? Math.max(0, f.fy_le - v.ytd.cur) : 0, note: 'actual ' + MON[0] + '–' + MON[m.partial_months - 1] + ' + forecast' });
    if (f) bars.push({ lab: 'FY' + m.target_year, a: 0, f: f.fy_target, last: true });   // 2026-10-13: no Low/High range on the page
    var W = 760, H = 250, L = 56, R = 12, T = 18, B = 34, n = bars.length;
    var mx = Math.max.apply(null, bars.map(function (b) { return Math.max(b.a + b.f, b.hi || 0); })) * 1.08 || 1;
    var bw = (W - L - R) / n, y = function (v) { return T + (H - T - B) * (1 - v / mx); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Annual ' + (v.val ? 'value (EGP)' : 'Standard Units') + ', actual and forecast">' +
      '<defs><pattern id="mf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="hb"/><line x1="0" y1="0" x2="0" y2="6" class="hl"/></pattern></defs>';
    for (var g = 0; g <= 4; g++) { var gv = mx * g / 4; s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(gv) + '" y2="' + y(gv) + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y(gv) + 4) + '" class="ax" text-anchor="end">' + fmtSU(gv) + '</text>'; }
    bars.forEach(function (b, i) {
      var x = L + i * bw + bw * 0.18, w = bw * 0.64;
      if (b.a > 0) s += '<rect x="' + x + '" y="' + y(b.a) + '" width="' + w + '" height="' + (y(0) - y(b.a)) + '" class="ba"><title>' + esc(b.lab) + ' actual: ' + fmtSU(b.a) + U + '</title></rect>';
      if (b.f > 0) s += '<rect x="' + x + '" y="' + y(b.a + b.f) + '" width="' + w + '" height="' + (y(b.a) - y(b.a + b.f)) + '" class="bf"><title>' + esc(b.lab) + ' forecast part: ' + fmtSU(b.f) + U + '</title></rect>';
      if (fin(b.lo) && fin(b.hi)) {
        var cx = x + w / 2;
        s += '<line x1="' + cx + '" x2="' + cx + '" y1="' + y(b.hi) + '" y2="' + y(b.lo) + '" class="wh"/><line x1="' + (cx - 8) + '" x2="' + (cx + 8) + '" y1="' + y(b.hi) + '" y2="' + y(b.hi) + '" class="wh"/><line x1="' + (cx - 8) + '" x2="' + (cx + 8) + '" y1="' + y(b.lo) + '" y2="' + y(b.lo) + '" class="wh"><title>Range ' + fmtSU(b.lo) + ' – ' + fmtSU(b.hi) + '</title></line>';
      }
      s += '<text x="' + (x + w / 2) + '" y="' + (y(Math.max(b.a + b.f, fin(b.hi) ? b.hi : 0)) - 5) + '" class="val" text-anchor="middle">' + fmtSU(b.a + b.f) + '</text>';
      s += '<text x="' + (x + w / 2) + '" y="' + (H - B + 16) + '" class="ax" text-anchor="middle">' + esc(b.lab) + '</text>';
    });
    s += '</svg>';
    return s + '<div class="legend"><span><i class="sw a"></i>Actual</span><span><i class="sw f"></i>Forecast</span>' + '</div>';
  }

  function monthlyChart(r) {
    var m = D.meta, P = m.periods, nA = Math.min(36, P.length), a0 = P.length - nA;
    var v = V(r), U = v.val ? ' EGP' : ' SU', act = (v.monthly || []).slice(a0), fp = v.path || [];
    var labs = P.slice(a0).concat(m.future_periods.slice(0, fp.length));
    var all = act.concat(fp), n = all.length;
    var W = 1300, H = 260, L = 64, R = 12, T = 14, B = 30;
    var mx = Math.max.apply(null, all) * 1.1 || 1;
    var x = function (i) { return L + (W - L - R) * i / (n - 1); }, y = function (v) { return T + (H - T - B) * (1 - v / mx); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Monthly ' + (v.val ? 'value (EGP)' : 'Standard Units') + ', last 36 months and forecast">';
    for (var g = 0; g <= 4; g++) { var gv = mx * g / 4; s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(gv) + '" y2="' + y(gv) + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y(gv) + 4) + '" class="ax" text-anchor="end">' + fmtSU(gv) + '</text>'; }
    if (fp.length) s += '<rect x="' + x(nA - 1) + '" y="' + T + '" width="' + (x(n - 1) - x(nA - 1)) + '" height="' + (H - T - B) + '" class="fz"/>';
    s += '<polyline class="la" points="' + act.map(function (v, i) { return x(i) + ',' + y(v); }).join(' ') + '"/>';
    if (fp.length) s += '<polyline class="lf" points="' + [x(nA - 1) + ',' + y(act[nA - 1])].concat(fp.map(function (v, i) { return x(nA + i) + ',' + y(v); })).join(' ') + '"/>';
    all.forEach(function (v, i) { s += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="2.4" class="' + (i < nA ? 'pa' : 'pf') + '"><title>' + per(labs[i]) + (i < nA ? ' actual: ' : ' forecast: ') + fmtSU(v) + U + '</title></circle>'; });
    labs.forEach(function (p, i) { if (p.slice(5, 7) === '01') s += '<text x="' + x(i) + '" y="' + (H - B + 16) + '" class="ax" text-anchor="middle">Jan ' + p.slice(0, 4) + '</text>'; });
    s += '</svg>';
    return s + '<div class="legend"><span><i class="sw a"></i>Actual (last 36 months)</span>' + (fp.length ? '<span><i class="sw f"></i>Forecast path to Dec ' + m.target_year + '</span>' : '') +
      (r.model_info && r.model_info.seasonal ? '<span>Follows the usual seasonal pattern</span>' : '') + '</div>';
  }

  function trendTable(r) {
    var v = V(r), y = v.ytd || {};
    var rows = [
      ['Historical trend' + (v.hc.span ? ' (' + v.hc.span + ', a year)' : ''), fmtP(v.hc.pct), 'Average a year, first full year to last full year'],
      ['Recent trend (' + v.rc.span + ', a year)', fmtP(v.rc.pct), 'Average a year, last two full years'],
      ['YTD ' + (y.months || '') + ' ' + D.meta.partial_year + ' vs ' + (D.meta.partial_year - 1), fmtP(y.growth_pct), fmtM(y.cur, v.val) + ' vs ' + fmtM(y.py, v.val)]
    ];
    Object.keys(v.yoy || {}).forEach(function (k) { rows.push(['Year on year ' + k.replace('-', ' → '), fmtP(v.yoy[k]), '']); });
    if (v.val && r.value && r.value.price_by_year) {
      var pb = r.value.price_by_year;
      rows.push(['Price per SU (EGP)', '', Object.keys(pb).filter(function (k) { return fin(pb[k]); }).map(function (k) { return k + ': ' + pb[k].toFixed(2); }).join(' · ')]);
    }
    return '<table class="tbl"><tbody>' + rows.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td class="num r">' + x[1] + '</td><td class="mut">' + esc(x[2]) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  // 2026-10-14 (Ahmed): business rationale & insights (etl/market_forecast_rationale.py) replace the statistical cards
  function li(arr, cls) { return (arr || []).length ? '<ul class="' + (cls || 'rl') + '">' + arr.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : ''; }
  function rationale(r) {
    var ra = r.rationale;
    if (!ra) return '<p class="note mut">Rationale not built yet: run UPDATE_DASHBOARD.bat (or <code>python etl/market_forecast_rationale.py</code>).</p>';
    if (isV() && !isPK() && ra.value) return '<p class="stmt">' + esc(ra.value.statement) + '</p>' + li(ra.value.why, 'rl why') +
      '<h3 class="mt">Volume behind it (Standard Units)</h3><p class="stmt2">' + esc(ra.statement) + '</p>' + li(ra.why, 'rl why');
    return '<p class="stmt">' + esc(ra.statement) + '</p>' + li(ra.why, 'rl why');
  }
  function insights(r) {
    var ra = r.rationale || {};
    return (ra.insights || []).length ? li(ra.insights, 'rl ins') : '<p class="note mut">No brand-level movement to report for this market.</p>';
  }
  function zetaCard(r) {
    var ra = r.rationale || {};
    var z = (isV() && !isPK() && ra.value ? (ra.value.zeta || []) : []).concat(ra.zeta || []);
    return z.length ? li(z, 'rl zeta') : '<p class="note mut">Zeta has no sales in this market.</p>';
  }

  // ── 2026-10-16 (Ahmed): forecast quality flags (shown on the market header and in the portfolio) ──
  var ADJ_PTS = 5, CONTRA_PTS = 15;
  function qualityFlags(r) {
    var f = r.forecast || {}, a = ((r.v2 || {}).alignment) || {}, le = f.fy_le, o = { adjusted: false, contradicts: false };
    if (fin(a.base_total) && fin(a.reconciled_total) && le > 0 && !a.locked && (r.type === 'DM1' || r.type === 'DM2')) {
      o.pts = (a.reconciled_total - a.base_total) / le * 100; o.baseG = (a.base_total / le - 1) * 100; o.recG = (a.reconciled_total / le - 1) * 100;
      o.parent = String(a.parent || 'its BU').replace('BU/', 'BU ').replace('Egypt', 'Egypt total'); o.adjusted = !a.capped && Math.abs(o.pts) > ADJ_PTS + 0.05;
    }
    if (a.capped) { o.limited = true; o.fullPts = a.capped.mint_pts; o.capPts = a.capped.cap_pts; }
    o.fcG = f.growth_vs_le_pct; o.ytdG = (r.ytd || {}).growth_pct;
    // check = forecast speeds up > 15 pts vs this year's pace, or slows by more than max(15 pts, half of this year's growth)
    o.contradicts = fin(o.fcG) && fin(o.ytdG) && r.lifecycle !== 'Launch' && (o.fcG - o.ytdG > CONTRA_PTS || o.ytdG - o.fcG > Math.max(CONTRA_PTS, Math.abs(o.ytdG) / 2));
    return o;
  }

  // ── 2026-10-16 (Ahmed): ZETA PORTFOLIO — every defined market (DM1) with Zeta sales on one screen ──
  // Class: Fix = losing >= 0.3 pts share (MAT vs previous MAT) · Protect = share >= 20% · Invest = market grows
  // >= 5 pts faster than Egypt in FY+1 · Maintain = the rest. OTHER MARKET (residual) is listed apart.
  var PF_RULES = { losing: -0.3, lead: 0.20, investGap: 5 };
  var PF_CLASS = { Fix: { c: 'neg', t: 'Losing share — find the cause and act' }, Protect: { c: 'pro', t: 'Leading position — defend share' },
    Invest: { c: 'pos', t: 'Fast-growing market — push for share' }, Maintain: { c: 'mut', t: 'Slower market — keep efficient' } };
  function egyptGrowth(val) { var t = D.segments.find(function (x) { return x.type === 'Total'; }); if (!t) return null; return val ? (t.value || {}).growth_vs_le_pct : (t.forecast || {}).growth_vs_le_pct; }
  function pfRows(scope, seg) {   // scope = array of DM1 names, or null = all defined markets; seg = one DM2 market shown on its own
    var val = isV(), k = val ? 'val' : 'su', eg = egyptGrowth(val), rows = [], other = [];
    D.segments.forEach(function (r) {
      if (!(r.type === 'DM1' || r === seg) || !ALLOWED(r)) return;
      var sc = r.scorecard || {}, z = sc.zeta || {}, zm = z.mat || {}, mm = sc.market_mat || {};
      if (!(zm.su > 0) && !(zm.val > 0)) return;
      if (r.residual_market) { other.push(r); return; }
      var f = r.forecast || {}, vv = r.value || {}, sh = mm[k] > 0 ? zm[k] / mm[k] : null, shp = mm[k + '_py'] > 0 ? (zm[k + '_py'] || 0) / mm[k + '_py'] : null;
      var d = fin(sh) && fin(shp) ? (sh - shp) * 100 : null, g = val ? vv.growth_vs_le_pct : f.growth_vs_le_pct, Q = qualityFlags(r);
      var cls = fin(d) && d <= PF_RULES.losing ? 'Fix' : fin(sh) && sh >= PF_RULES.lead ? 'Protect' : fin(g) && fin(eg) && g >= eg + PF_RULES.investGap ? 'Invest' : 'Maintain';
      var risk = cls === 'Fix' && fin(vv.fy_target) && fin(d) ? d / 100 * vv.fy_target : null;   // EGP, if the share keeps falling at this pace
      rows.push({ r: r, name: r.name, cls: cls, sh: sh, d: d, g: g, mg: mm[k + '_py'] > 0 ? (mm[k] / mm[k + '_py'] - 1) * 100 : null, zval: zm.val || 0, zsu: zm.su || 0,
        zg: zm[k + '_py'] > 0 ? (zm[k] / zm[k + '_py'] - 1) * 100 : null, conf: r.confidence || '', rel: ((r.reliability || {}).verdict) || '', Q: Q, risk: risk,
        brands: (z.brands || []).slice(0, 3) });
    });
    var totAll = rows.reduce(function (a, x) { return a + x.zval; }, 0);
    if (seg) { var sr = rows.filter(function (x) { return x.r === seg; }); rows = rows.filter(function (x) { return x.r !== seg; }); totAll = rows.reduce(function (a, x) { return a + x.zval; }, 0); rows = sr; other = other.filter(function (r) { return r === seg; }); }
    rows.forEach(function (x) { x.wtAll = totAll > 0 ? x.zval / totAll : 0; });
    if (scope && !seg) { rows = rows.filter(function (x) { return scope.indexOf(x.name) >= 0; }); other = other.filter(function (r) { return scope.indexOf(r.name) >= 0; }); }
    var tot = rows.reduce(function (a, x) { return a + x.zval; }, 0);
    rows.forEach(function (x) { x.wt = tot > 0 ? x.zval / tot : 0; });
    var order = { Fix: 0, Protect: 1, Invest: 2, Maintain: 3 };
    rows.sort(function (a, b) { return order[a.cls] - order[b.cls] || b.zval - a.zval; });
    return { rows: rows, other: other, tot: tot, totAll: totAll, eg: eg, val: val };
  }
  // 2026-10-16 (Ahmed): the portfolio is an SFE view, and it follows the market filter (option: all defined markets)
  function isSFEView() { var u = curUser(), r = String((u && u.role) || '').toLowerCase(); return r.indexOf('sfe') >= 0 || r === 'admin'; }
  function pfScope() {
    var r = cur();
    if (ST.pfAll || !r || r.type === 'Total') return { names: null, label: 'all defined markets', all: true };
    if (r.type === 'DM1') return { names: [r.name], label: r.name, one: true };
    if (r.type === 'DM2') {
      return { names: [r.name], seg: r, label: r.name + ' (DM2)', one: true };   // 2026-10-17 (Ahmed): only the selected DM2 market
    }
    return { names: (r.members || []).slice(), label: r.name + ' (' + (LEVELS.find(function (l) { return l[0] === r.type; }) || [0, r.type])[1] + ')' };
  }
  // MECE insights: one market -> Market / Zeta position / Competition / Forecast confidence / Action;
  // several -> Where the value is / Where we lose / Where we win / Forecast confidence / Value at stake
  function pfInsights(P, sc0) {
    var ty = D.meta.target_year, val = P.val, k = val ? 'val' : 'su', box = [];
    var B = function (t, items) { items = items.filter(Boolean); if (items.length) box.push('<div class="pfi"><div class="pfit">' + t + '</div><ul>' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>'); };
    var pct = function (v) { return fin(v) ? (v * 100).toFixed(1) + '%' : '—'; };
    if (sc0.one && P.rows.length === 1) {
      var x = P.rows[0], r = x.r, sc = r.scorecard || {}, mm = sc.market_mat || {}, f = r.forecast || {}, vv = r.value || {};
      var br = (sc.brands || []).map(function (b) { var s1 = mm[k] > 0 ? (b[k] || 0) / mm[k] : null, s0 = mm[k + '_py'] > 0 ? (b[k + '_py'] || 0) / mm[k + '_py'] : null; return { n: b.n, c: b.c, z: b.z, s: s1, d: fin(s1) && fin(s0) ? (s1 - s0) * 100 : null, g: b[k + '_py'] > 0 ? (b[k] / b[k + '_py'] - 1) * 100 : null }; })
        .sort(function (a, b) { return (b.s || 0) - (a.s || 0); });
      var rank = br.findIndex(function (b) { return b.z; }) + 1, comp = br.filter(function (b) { return !b.z && fin(b.d); });
      var gain = comp.slice().sort(function (a, b) { return b.d - a.d; })[0], lose = comp.slice().sort(function (a, b) { return a.d - b.d; })[0], lead = br[0];
      B('1 · Market', [
        'Size ' + matLbl() + ': <b>' + fmtM(mm[k], val) + '</b>, growing <b>' + fmtP(x.mg) + '</b> vs the previous 12 months.',
        'FY' + ty + ' forecast: <b>' + fmtP(x.g) + '</b> vs ' + D.meta.partial_year + ' (Egypt ' + fmtP(P.eg) + ') — the market grows ' + (fin(x.g) && fin(P.eg) ? (x.g >= P.eg ? '<b>faster</b> than Egypt' : '<b>slower</b> than Egypt') : '—') + '.'
      ]);
      B('2 · Zeta position', [
        esc(x.brands.join(', ') || 'Zeta') + ': share <b>' + pct(x.sh) + '</b> (' + (fin(x.d) ? (x.d >= 0 ? '+' : '') + x.d.toFixed(2) + ' pts' : '—') + ')' + (rank ? ', rank <b>#' + rank + '</b> of ' + br.length + ' brands' : '') + '.',
        'Zeta grows ' + fmtP(x.zg) + ' vs market ' + fmtP(x.mg) + ' → ' + (fin(x.zg) && fin(x.mg) ? (x.zg > x.mg ? '<b>gaining</b> share' : x.zg < x.mg ? '<b>losing</b> share' : 'holding share') : '—') + '. Zeta value here: ' + fmtM(x.zval, true) + ' = ' + (x.wtAll * 100).toFixed(1) + '% of all Zeta in defined markets.'
      ]);
      B('3 · Competition', [
        lead && !lead.z ? 'Market leader: <b>' + esc(lead.n) + '</b> (' + esc(lead.c) + ') with ' + pct(lead.s) + '.' : lead && lead.z ? 'Zeta leads the market with ' + pct(lead.s) + '.' : '',
        gain && gain.d > 0.05 ? 'Biggest share gainer: <b>' + esc(gain.n) + '</b> (' + esc(gain.c) + ') +' + gain.d.toFixed(2) + ' pts, growing ' + fmtP(gain.g) + '.' : '',
        lose && lose.d < -0.05 ? 'Biggest share loser: <b>' + esc(lose.n) + '</b> (' + esc(lose.c) + ') ' + lose.d.toFixed(2) + ' pts.' : ''
      ]);
      B('4 · Forecast confidence', [
        'Reliability: <b>' + esc(x.rel || x.conf || '—') + '</b>.',
        x.Q.limited ? 'Alignment limited: adding up to ' + esc(x.Q.parent) + ' would have moved it ' + x.Q.fullPts.toFixed(1) + ' pts.' : '',
        x.Q.contradicts ? 'Check: FY' + ty + ' growth ' + fmtP(x.Q.fcG) + ' is far from this year so far (' + fmtP(x.Q.ytdG) + ').' : ''
      ]);
      B('5 · Action — <span class="vchip ' + PF_CLASS[x.cls].c + '">' + x.cls + '</span>', [pfAction(x, P.eg)]);
      return box.join('');
    }
    var pc0 = function (v) { return v > 0 && v < 0.005 ? '<1%' : (v * 100).toFixed(0) + '%'; };
    var R = P.rows, byVal = R.slice().sort(function (a, b) { return b.zval - a.zval; }), top = byVal.slice(0, Math.min(5, byVal.length)), tw = top.reduce(function (a, x) { return a + x.wt; }, 0);
    var fix = R.filter(function (x) { return x.cls === 'Fix'; }), fixV = fix.reduce(function (a, x) { return a + x.wt; }, 0), risk = fix.reduce(function (a, x) { return a + (fin(x.risk) ? Math.abs(x.risk) : 0); }, 0);
    var win = R.filter(function (x) { return (x.cls === 'Invest' || x.cls === 'Protect') && fin(x.d) && x.d > 0; }).sort(function (a, b) { return b.zval - a.zval; });
    var low = R.filter(function (x) { return x.conf === 'Lower'; }), lowV = low.reduce(function (a, x) { return a + x.wt; }, 0), flg = R.filter(function (x) { return x.Q.adjusted || x.Q.contradicts || x.Q.limited; });
    var g2 = R.filter(function (x) { return fin(x.g); }), wg = g2.reduce(function (a, x) { return a + x.g * x.wt; }, 0) / (g2.reduce(function (a, x) { return a + x.wt; }, 0) || 1);
    B('1 · Where the value is', [
      'Zeta ' + matLbl() + ': <b>' + fmtM(P.tot, true) + '</b> in ' + R.length + ' defined markets' + (P.totAll > 0 && !sc0.all ? ' = ' + (P.tot / P.totAll * 100).toFixed(0) + '% of all Zeta' : '') + '.',
      R.length > 1 ? 'Top ' + top.length + ' markets = <b>' + (tw * 100).toFixed(0) + '%</b>: ' + top.map(function (x) { return esc(x.name) + ' ' + pc0(x.wt); }).join(', ') + '.' : '',
      'Value-weighted market growth FY' + ty + ': <b>' + fmtP(wg) + '</b> vs Egypt ' + fmtP(P.eg) + '.'
    ]);
    B('2 · Where Zeta loses', [fix.length ? '<b>' + fix.length + '</b> market' + (fix.length > 1 ? 's' : '') + ' losing share = <b>' + pc0(fixV) + '</b> of the value: ' + fix.slice(0, 4).map(function (x) { return esc(x.name) + ' (' + x.d.toFixed(1) + ' pts)'; }).join(', ') + '.' : 'No market losing ≥ ' + Math.abs(PF_RULES.losing) + ' pts of share.']);
    B('3 · Where Zeta wins', [win.length ? '<b>' + win.length + '</b> fast-growing or leading market' + (win.length > 1 ? 's' : '') + ' where Zeta gains share: ' + win.slice(0, 4).map(function (x) { return esc(x.name) + ' (+' + x.d.toFixed(1) + ' pts)'; }).join(', ') + '.' : 'No fast-growing or leading market with a share gain.']);
    B('4 · Forecast confidence', [
      '<b>' + pc0(lowV) + '</b> of the value sits in markets whose forecast is "indicative only"' + (low.length ? ' (' + low.length + ')' : '') + '.',
      flg.length ? flg.length + ' market' + (flg.length > 1 ? 's carry' : ' carries') + ' a ⚑ flag (limited / check) — plan these with your own market view.' : ''
    ]);
    B('5 · Value at stake', [risk > 0 ? 'If share keeps falling at today\'s pace in the losing markets, FY' + ty + ' gives up about <b>' + fmtM(risk, true) + '</b>.' : 'No value at risk from share losses.']);
    return box.join('');
  }
  function pfAction(x, eg) {
    var B = esc(x.brands.join(', ') || 'Zeta');
    if (x.cls === 'Fix') return B + ' lost ' + Math.abs(x.d).toFixed(1) + ' pts (share now ' + (x.sh * 100).toFixed(1) + '%) while the market grew ' + fmtP(x.mg) + '. Find the cause: competitor entry, supply, coverage or price.' + (fin(x.risk) ? ' If the loss continues, FY' + D.meta.target_year + ' gives up about <b>' + fmtM(Math.abs(x.risk), true) + '</b>.' : '');
    if (x.cls === 'Protect') return B + ' leads with ' + (x.sh * 100).toFixed(1) + '% share (' + (x.d >= 0 ? '+' : '') + (fin(x.d) ? x.d.toFixed(1) : '—') + ' pts). Defend: coverage of top prescribers, watch new entrants.';
    if (x.cls === 'Invest') return 'Market grows ' + fmtP(x.g) + ' in FY' + D.meta.target_year + ' vs Egypt ' + fmtP(eg) + '. ' + B + ' at ' + (x.sh * 100).toFixed(1) + '% — every share point is worth more here.';
    return 'Market grows ' + fmtP(x.g) + ' (Egypt ' + fmtP(eg) + '). ' + B + ' at ' + (x.sh * 100).toFixed(1) + '% share — keep spend efficient.';
  }
  function pfChart(P) {
    var R = P.rows; if (!R.length) return '';
    var W = 760, H = 330, L = 52, Rm = 16, T = 16, B = 40;
    var xs = R.map(function (x) { return x.g; }).filter(fin), ys = R.map(function (x) { return x.d; }).filter(fin);
    var x0 = Math.max(-25, Math.min.apply(null, xs.concat([P.eg || 0, 0])) - 5), x1 = Math.min(120, Math.max.apply(null, xs.concat([P.eg || 0])) + 5);
    var yA = Math.min(15, Math.max(3, Math.max.apply(null, ys.map(Math.abs)) + 1)), y0 = -yA, y1 = yA;
    var sx = function (v) { return L + (Math.max(x0, Math.min(x1, v)) - x0) / (x1 - x0) * (W - L - Rm); }, sy = function (v) { return T + (y1 - Math.max(y0, Math.min(y1, v))) / (y1 - y0) * (H - T - B); };
    var mx = Math.max.apply(null, R.map(function (x) { return x.zval; })) || 1, rad = function (v) { return 4 + 22 * Math.sqrt(v / mx); };
    var g = '<svg class="pfsvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Zeta portfolio: market growth vs share change">';
    var ticks = function (a, b, n) { var st = (b - a) / n, out = []; for (var i = 0; i <= n; i++) out.push(a + st * i); return out; };
    ticks(x0, x1, 6).forEach(function (v) { g += '<line class="grid" x1="' + sx(v) + '" x2="' + sx(v) + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="ax" x="' + sx(v) + '" y="' + (H - B + 14) + '" text-anchor="middle">' + v.toFixed(0) + '%</text>'; });
    ticks(y0, y1, 6).forEach(function (v) { g += '<line class="grid" x1="' + L + '" x2="' + (W - Rm) + '" y1="' + sy(v) + '" y2="' + sy(v) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (sy(v) + 4) + '" text-anchor="end">' + (v > 0 ? '+' : '') + v.toFixed(1) + '</text>'; });
    g += '<line class="zero" x1="' + L + '" x2="' + (W - Rm) + '" y1="' + sy(0) + '" y2="' + sy(0) + '"/>';
    if (fin(P.eg)) g += '<line class="egl" x1="' + sx(P.eg) + '" x2="' + sx(P.eg) + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="ax egt" x="' + (sx(P.eg) + 4) + '" y="' + (T + 10) + '">Egypt ' + fmtP(P.eg) + '</text>';
    g += '<text class="ax" x="' + ((L + W - Rm) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Market growth FY' + D.meta.target_year + ' vs ' + D.meta.partial_year + ' →</text>';
    g += '<text class="ax" transform="rotate(-90)" x="' + (-(T + H - B) / 2) + '" y="13" text-anchor="middle">Zeta share change, pts (MAT) →</text>';
    var lab = R.slice().sort(function (a, b) { return b.zval - a.zval; }).slice(0, 8).map(function (x) { return x.name; });
    R.slice().sort(function (a, b) { return b.zval - a.zval; }).forEach(function (x) {
      if (!fin(x.g) || !fin(x.d)) return;
      var cx = sx(x.g), cy = sy(x.d), rr = rad(x.zval);
      g += '<g class="pfb ' + x.cls.toLowerCase() + '" data-n="' + esc(x.name) + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + rr + '"' + (x.conf === 'Lower' ? ' stroke-dasharray="3 2"' : '') + '><title>' + esc(x.name + ' — ' + x.cls + ' · Zeta ' + fmtM(x.zval, true) + ' MAT · share ' + (x.sh * 100).toFixed(1) + '% (' + (x.d >= 0 ? '+' : '') + x.d.toFixed(1) + ' pts) · market FY' + D.meta.target_year + ' ' + fmtP(x.g) + ' · forecast ' + (x.rel || x.conf)) + '</title></circle>' +
        (lab.indexOf(x.name) >= 0 ? '<text class="pfl" x="' + (cx + rr + 3) + '" y="' + (cy + 4) + '">' + esc(x.name.length > 24 ? x.name.slice(0, 23) + '…' : x.name) + '</text>' : '') + '</g>';
    });
    return g + '</svg>';
  }
  function portfolio() {
    var el = ROOT.querySelector('#mf-pf'); if (!el) return;
    if (!isSFEView()) { el.innerHTML = ''; el.style.display = 'none'; return; }   // SFE (and Admin) only
    var SC = pfScope(), P = pfRows(SC.names, SC.seg), val = P.val;
    if (!P.rows.length) { el.style.display = ''; el.innerHTML = '<p class="note mut">Zeta portfolio: no defined market with Zeta sales in ' + esc(SC.label) + '. <button type="button" class="xbtn ghost" id="mf-pfall">Show all defined markets</button></p>'; var b0 = el.querySelector('#mf-pfall'); if (b0) b0.onclick = function () { ST.pfAll = true; saveState(); portfolio(); }; return; }
    el.style.display = '';
    var cls = ['Fix', 'Protect', 'Invest', 'Maintain'], open = el.hasAttribute('data-closed') ? '' : ' open';
    var tiles = cls.map(function (c) {
      var L = P.rows.filter(function (x) { return x.cls === c; }), v = L.reduce(function (a, x) { return a + x.zval; }, 0);
      return '<div class="pft ' + PF_CLASS[c].c + '"><div class="pfk">' + c + '</div><div class="pfv num">' + L.length + ' market' + (L.length === 1 ? '' : 's') + '</div><div class="pfs">' + fmtM(v, true) + ' · ' + (P.tot > 0 ? (v / P.tot * 100).toFixed(0) : 0) + '% of Zeta</div><div class="pfd mut">' + PF_CLASS[c].t + '</div></div>';
    }).join('');
    var rows = P.rows.map(function (x, i) {
      var fl = (x.Q.adjusted ? '<span class="flag" title="Moved ' + x.Q.pts.toFixed(1) + ' pts to add up to ' + esc(x.Q.parent) + ' (own forecast ' + fmtP(x.Q.baseG) + ')">⚑ adjusted</span>' : '') + (x.Q.limited ? '<span class="flag" title="Alignment limited to ' + x.Q.capPts + ' pts (full alignment ' + x.Q.fullPts.toFixed(1) + ' pts)">⚑ limited</span>' : '') + (x.Q.contradicts ? '<span class="flag" title="FY growth ' + fmtP(x.Q.fcG) + ' vs this year so far ' + fmtP(x.Q.ytdG) + '">⚑ check</span>' : '');
      return '<tr class="pfr" data-n="' + esc(x.name) + '"><td class="num r mut">' + (i + 1) + '</td><td><b>' + esc(x.name) + '</b><br><small class="mut">' + esc(x.brands.join(', ')) + '</small></td>' +
        '<td>' + '<span class="vchip ' + PF_CLASS[x.cls].c + '">' + x.cls + '</span></td>' +
        '<td class="num r">' + fmtM(x.zval, true) + '<br><small class="mut">' + (x.wt * 100).toFixed(1) + '% of Zeta</small></td>' +
        '<td class="num r">' + (fin(x.sh) ? (x.sh * 100).toFixed(1) + '%' : '—') + '</td><td class="num r ' + (fin(x.d) ? (x.d >= 0.05 ? 'pos' : x.d <= -0.05 ? 'neg' : '') : '') + '">' + (fin(x.d) ? (x.d >= 0 ? '+' : '') + x.d.toFixed(1) + ' pts' : '—') + '</td>' +
        '<td class="num r">' + fmtP(x.zg) + '</td><td class="num r">' + fmtP(x.mg) + '</td><td class="num r"><b>' + fmtP(x.g) + '</b></td>' +
        '<td class="small">' + esc(x.rel || x.conf) + fl + '</td><td class="small">' + pfAction(x, P.eg) + '</td></tr>';
    }).join('');
    var oth = P.other.length ? '<p class="note mut">Not ranked: Zeta items in <b>OTHER MARKET</b> (no defined market) — ' + P.other.map(function (r) { return ((((r.scorecard || {}).zeta) || {}).items || []).map(function (i) { return esc(i.item); }).join(', '); }).join('; ') + '. Map them to a defined market in the IQVIA source to plan them properly.</p>' : '';
    var many = P.rows.length > 1, cur0 = cur();
    var tog = '<div class="seg pfscope" role="group" aria-label="Portfolio scope">' +
      '<button type="button" data-pf="sel" aria-pressed="' + (!ST.pfAll) + '"' + (cur0 && cur0.type === 'Total' ? ' disabled' : '') + '>Selected: ' + esc(cur0 ? cur0.name : '—') + '</button>' +
      '<button type="button" data-pf="all" aria-pressed="' + (!!ST.pfAll) + '">All defined markets</button></div>';
    el.innerHTML = '<details class="pfwrap"' + open + '><summary><h2>Zeta portfolio — ' + (SC.one ? esc(SC.label) : 'where FY' + D.meta.target_year + ' is won or lost') + ' <span class="mut small">(' + (SC.one ? 'one defined market' : P.rows.length + ' defined markets' + (SC.all ? '' : ' in ' + esc(SC.label))) + ', ' + (val ? 'value' : 'SU') + ' share, Zeta value in EGP · SFE view)</span></h2></summary>' +
      '<div class="h2row">' + tog + '<div class="btns"><button type="button" class="xbtn" id="mf-xpf">⬇ Excel — portfolio</button></div></div>' +
      '<div class="pfins">' + pfInsights(P, SC) + '</div>' +
      (many ? '<div class="pftiles">' + tiles + '</div>' : '') +
      (P.rows.length >= 3 ? '<div class="pfgrid"><div>' + pfChart(P) + '<p class="note mut">Bubble = Zeta MAT value. Dashed = forecast "indicative only". Right of the Egypt line = market grows faster than Egypt; below zero = Zeta losing share. Click a bubble or a row to open the market.</p></div></div>' : '') +
      '<div class="tblwrap"><table class="tbl pftbl"><thead><tr><th class="r">#</th><th>Defined market · Zeta brands</th><th>Priority</th><th class="r">Zeta MAT value</th><th class="r">Zeta share</th><th class="r">Share change</th><th class="r">Zeta growth (MAT)</th><th class="r">Market growth (MAT)</th><th class="r">Market FY' + D.meta.target_year + '</th><th>Forecast</th><th>What to do</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="note mut">Priority rules: <b>Fix</b> = share down ≥ ' + Math.abs(PF_RULES.losing) + ' pts (MAT vs previous MAT) · <b>Protect</b> = share ≥ ' + (PF_RULES.lead * 100) + '% · <b>Invest</b> = market grows ≥ ' + PF_RULES.investGap + ' pts faster than Egypt in FY' + D.meta.target_year + ' · <b>Maintain</b> = the rest. "% of Zeta" in the table = share of Zeta value in this selection.</p>' + (SC.all ? oth : '') + '</details>';
    el.querySelectorAll('.pfscope button').forEach(function (bt) { bt.onclick = function (ev) { ev.preventDefault(); ev.stopPropagation(); ST.pfAll = bt.getAttribute('data-pf') === 'all'; saveState(); portfolio(); }; });
    var det = el.querySelector('details'); det.ontoggle = function () { if (det.open) el.removeAttribute('data-closed'); else el.setAttribute('data-closed', '1'); };
    var go = function (n) { navTo(SC.seg && SC.seg.name === n ? 'DM2' : 'DM1', n, true); };
    el.querySelectorAll('.pfr, .pfb').forEach(function (n) { n.onclick = function () { go(n.getAttribute('data-n')); }; });
    var xb = el.querySelector('#mf-xpf'); if (xb) xb.onclick = function () { try { if (isPK()) withMeasD(false, function () { var S2 = pfScope(); exportPortfolio(pfRows(S2.names, S2.seg)); }); else exportPortfolio(P); } catch (e) { console.error('[MarketForecast] export', e); alert('Excel export failed: ' + (e && e.message || e)); } };
  }
  function exportPortfolio(P) {
    if (!xlsxOk()) return;
    var ty = D.meta.target_year, H = ['#', 'Defined market', 'Zeta brands', 'Priority', 'Zeta MAT value (EGP)', '% of Zeta value', 'Zeta MAT SU', 'Zeta share (' + (P.val ? 'value' : 'SU') + ')', 'Share change (pts)', 'Zeta growth MAT', 'Market growth MAT', 'Market growth FY' + ty, 'Egypt growth FY' + ty, 'Forecast reliability', 'Adjusted to add up (pts)', 'Own forecast before adjustment', 'Check: FY vs YTD gap (pts)', 'If the loss continues FY' + ty + ' (EGP)', 'What to do'];
    var aoa = [H];
    P.rows.forEach(function (x, i) {
      aoa.push([i + 1, x.name, x.brands.join(', '), x.cls, x.zval, x.wt, x.zsu, x.sh, x.d, fin(x.zg) ? x.zg / 100 : null, fin(x.mg) ? x.mg / 100 : null, fin(x.g) ? x.g / 100 : null, fin(P.eg) ? P.eg / 100 : null, x.rel || x.conf,
        fin(x.Q.pts) ? x.Q.pts : null, fin(x.Q.baseG) ? x.Q.baseG / 100 : null, x.Q.contradicts ? Math.abs(x.Q.fcG - x.Q.ytdG) : null, fin(x.risk) ? x.risk : null, pfAction(x, P.eg).replace(/<[^>]+>/g, '')]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    fmtCells(ws, aoa, 0, [null, null, null, null, '#,##0', '0.0%', '#,##0', '0.0%', '+0.0;-0.0;0.0', '0.0%', '0.0%', '0.0%', '0.0%', null, '+0.0;-0.0;0.0', '0.0%', '0', '#,##0']);
    ws['!cols'] = H.map(function (h, i) { return { wch: i === 1 ? 34 : i === 2 ? 30 : i === 18 ? 90 : Math.max(10, Math.min(22, h.length + 2)) }; });
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: H.length - 1 } }) };
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Zeta portfolio FY' + ty);
    XLSX.writeFile(wb, 'Zeta_Portfolio_FY' + ty + '.xlsx', { compression: true });
  }

  // ── 2026-10-16 (Ahmed): growth bridge — Zeta FY+1 change = market effect + share effect ──
  function bridge(r) {
    var val = isV(), f = r.forecast || {}, vv = r.value || {}, z = zdata(r), P = zplan(r);
    var L26 = zLE(r, (z.ytd || {}).su, (z.ytd || {}).val), Z26 = val ? L26.val : L26.su, M26 = val ? vv.fy_le : f.fy_le;
    if (!fin(Z26) || !(M26 > 0)) return '';
    var s26 = Z26 / M26, out = [];
    var add = function (lab, M27, Z27, note) {
      if (!fin(M27) || !fin(Z27)) return;
      var me = s26 * (M27 - M26), se = Z27 - Z26 - me;
      out.push({ lab: lab, M27: M27, Z27: Z27, me: me, se: se, s27: Z27 / M27, note: note });
    };
    if (P.present) add('Objective — ' + P.strategy, val ? vv.fy_target : f.fy_target, val ? P.objVal : P.objSU);
    var B = P.bex;
    if (B && fin(B.su)) {
      if (B.n >= B.nItems) add('' + PN() + ' forecast', val ? B.mktVal : B.mkt, val ? B.val : B.su, B.mktEdited ? '' + PN() + ' market' : '');
      else {   // like-for-like: only the items BEX has planned (same rule as BEX growth)
        var BL = bexLE(r), Zb = BL ? (val ? BL.val : BL.su) : null, Mb = val ? B.mktVal : B.mkt;
        if (fin(Zb) && Zb > 0 && fin(Mb)) { var sb = Zb / M26, meb = sb * (Mb - M26), Zb27 = val ? B.val : B.su;
          out.push({ lab: '' + PN() + ' forecast', M27: Mb, Z27: Zb27, Z26: Zb, s26: sb, me: meb, se: Zb27 - Zb - meb, s27: Zb27 / Mb, note: B.n + ' of ' + B.nItems + ' items, like-for-like' + (B.mktEdited ? ' · ' + PN() + ' market' : ''), lfl: true }); }
        else out.push({ lab: '' + PN() + ' forecast', partial: true, n: B.n, N: B.nItems });
      }
    }
    if (!out.length) return '';
    var rows = out.map(function (x) {
      if (x.partial) return '<tr><td>' + esc(x.lab) + '</td><td colspan="6" class="mut">' + PN() + ' has planned ' + x.n + ' of ' + x.N + ' items — the bridge appears when every item has a ' + PN() + ' share.</td></tr>';
      var z0 = x.lfl ? x.Z26 : Z26, s0 = x.lfl ? x.s26 : s26, tot = x.Z27 - z0;
      return '<tr><td><b>' + esc(x.lab) + '</b>' + (x.note ? ' <small class="mut">(' + esc(x.note) + ')</small>' : '') + '</td><td class="num r">' + fmtM(z0, val) + '</td>' +
        '<td class="num r ' + (x.me >= 0 ? 'pos' : 'neg') + '">' + (x.me >= 0 ? '+' : '−') + fmtM(Math.abs(x.me), val) + '</td>' +
        '<td class="num r ' + (x.se >= 0 ? 'pos' : 'neg') + '">' + (x.se >= 0 ? '+' : '−') + fmtM(Math.abs(x.se), val) + ' <small class="mut">(' + (s0 * 100).toFixed(1) + '% → ' + (x.s27 * 100).toFixed(1) + '%)</small></td>' +
        '<td class="num r"><b>' + fmtM(x.Z27, val) + '</b></td><td class="num r">' + fmtP(z0 > 0 ? (x.Z27 / z0 - 1) * 100 : null) + '</td>' +
        '<td class="small">' + (tot !== 0 && x.me * x.se >= 0 ? Math.round(x.me / tot * 100) + '% from the market growing, ' + Math.round(x.se / tot * 100) + '% from share' : tot !== 0 ? 'Market growth ' + (x.me >= 0 ? 'adds ' : 'takes away ') + fmtM(Math.abs(x.me), val) + '; share change ' + (x.se >= 0 ? 'adds ' : 'takes away ') + fmtM(Math.abs(x.se), val) : '') + '</td></tr>';
    });
    var full = out.filter(function (x) { return !x.partial && !x.lfl; }), gap = '';
    if (full.length === 2) { var d = full[1].Z27 - full[0].Z27; gap = '<p class="note"><b>' + PN() + ' vs objective:</b> ' + (d >= 0 ? '+' : '−') + fmtM(Math.abs(d), val) + ' (' + fmtP((full[1].Z27 / full[0].Z27 - 1) * 100) + '). ' + (d < 0 ? '' + PN() + ' is below the objective — agree what closes the gap (share actions, launches) or accept a lower target.' : '' + PN() + ' is above the objective — confirm the share gain is resourced.') + '</p>'; }
    return '<h3 class="mt">Where ' + esc(zProd(r)) + '\'s FY' + D.meta.target_year + ' growth comes from <span class="mut small">(vs ' + leLbl() + ')</span></h3>' +
      '<div class="tblwrap"><table class="tbl yby brg"><thead><tr><th>Plan</th><th class="r">' + D.meta.partial_year + ' (estimate)</th><th class="r">+ Market growth<br><small class="mut">at today\'s share</small></th><th class="r">+ Share gain / loss</th><th class="r">= FY' + D.meta.target_year + '</th><th class="r">Growth</th><th>Read</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' + gap +
      '<p class="note mut">Market growth = ' + esc(zProd(r)) + ' keeps its ' + D.meta.partial_year + ' share (' + (s26 * 100).toFixed(1) + '%) of the bigger market. Share gain / loss = the rest of the change.' + (val ? ' In value, share includes product mix and price differences (no new price increase is assumed).' : '') + '</p>';
  }

  // 2026-10-17 (Ahmed): page organised for reading and navigating — answer first, then evidence, then the plan.
  // 1 Summary · 2 Zeta portfolio (SFE) · 3 Market forecast · 4 Competition · 5 Zeta FY plan · 6 Brands & items · 7 Method
  var SECS = [['mf-s1', 'Summary'], ['mf-s2', 'Zeta portfolio'], ['mf-s3', 'Market forecast'], ['mf-s4', 'Competition'], ['mf-s5', 'Zeta plan'], ['mf-s6', 'Brands & items']];
  function secHd(n, title, sub) { return '<div class="sechd" id="' + SECS[n - 1][0] + '"><span class="secn">' + n + '</span><h2>' + esc(title) + '</h2>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>'; }
  function goSec(el) {
    if (!el) return;
    var st = ROOT && ROOT.querySelector('#mf-stick'), off = st && getComputedStyle(st).position === 'sticky' ? st.offsetHeight + 8 : 8;
    var y = el.getBoundingClientRect().top + (global.pageYOffset || 0) - off;
    try { global.scrollTo({ top: Math.max(0, y), behavior: 'smooth' }); } catch (e) { if (el.scrollIntoView) el.scrollIntoView(); }
  }
  function navSync() {   // highlight the section being read; hide links to hidden sections
    if (!ROOT) return;
    var st = ROOT.querySelector('#mf-stick'), off = (st ? st.offsetHeight : 0) + 24, act = SECS[0][0], no = 0;
    SECS.forEach(function (x) { var e = ROOT.querySelector('#' + x[0]); if (!e || e.style.display === 'none') return; no++;   // number only the sections this user sees
      var a = ROOT.querySelector('#mf-nav a[data-t="' + x[0] + '"] .secn'), h = e.querySelector('.secn'); if (a) a.textContent = no; if (h) h.textContent = no; });
    SECS.forEach(function (x) { var e = ROOT.querySelector('#' + x[0]); if (e && e.offsetParent !== null && e.getBoundingClientRect().top - off <= 0) act = x[0]; });
    ROOT.querySelectorAll('#mf-nav a').forEach(function (a) {
      var e = ROOT.querySelector('#' + a.getAttribute('data-t')); a.style.display = e && e.style.display !== 'none' ? '' : 'none';
      a.classList.toggle('on', a.getAttribute('data-t') === act);
    });
  }
  var NAV_RAF = 0;
  function onScroll() { if (NAV_RAF) return; NAV_RAF = (global.requestAnimationFrame || setTimeout)(function () { NAV_RAF = 0; navSync(); }); }

  function detail() {
    var r = cur(), el = ROOT.querySelector('#mf-detail'), sm = ROOT.querySelector('#mf-sum'), cp = ROOT.querySelector('#mf-comp');
    if (!r) { sm.innerHTML = '<section class="card"><p>No market available for your access scope at this level.</p></section>'; el.innerHTML = ''; cp.innerHTML = ''; return; }
    var ra = r.rationale || {}, ty = D.meta.target_year;
    // 1) Summary — the answer: market, FY forecast, Zeta position, share verdict
    sm.innerHTML =
      '<section class="card head"><div class="ttl"><div><div class="eyebrow">' + esc(r.type === 'Total' ? 'Market' : (LEVELS.find(function (l) { return l[0] === r.type; }) || [0, r.type])[1]) + '</div><h2 class="mname">' + esc(r.name) + '</h2></div>' +
      '<div class="chips"><span class="chip">' + esc(r.lifecycle) + ' · ' + r.consecutive_positive_months + ' months of sales</span></div></div>' + banners(r) +
      ((isV() && !isPK() && ra.value ? ra.value.statement : ra.statement) ? '<p class="sumst">' + esc(isV() && !isPK() && ra.value ? ra.value.statement : ra.statement) + '</p>' : '') + '</section>' +
      kpis(r) + '<div id="mf-sumz"></div>';
    // 3) Market forecast — why, history, path
    el.innerHTML =
      '<section class="card rat"><h2>Why this forecast</h2>' + rationale(r) +
      ((ra.watch || []).length ? '<h3 class="mt">Watch-outs</h3>' + li(ra.watch, 'rl watch') : '') + '</section>' +
      '<div class="g2"><section class="card"><h2>Annual ' + (isV() ? 'value (EGP, at today\'s prices for the forecast)' : 'Standard Units') + '</h2>' + annualChart(r) + '</section>' +
      '<section class="card"><h2>Growth history</h2>' + trendTable(r) + '</section></div>' +
      '<section class="card"><h2>Monthly trend and forecast path</h2>' + monthlyChart(r) + '</section>';
    // 4) Competition — what moves the market, who wins it (the "who wins" table is filled by overview())
    cp.innerHTML = '<div class="g2"><section class="card" id="mf-who"></section>' +
      '<section class="card"><h2>Market insights — what moves the market' + (isV() ? ' <span class="mut small">(volume)</span>' : '') + '</h2>' + insights(r) + '</section></div>';
  }



  // ── 2026-10-15 (Ahmed): Zeta FY+1 objective (Defend / Grow), BEX forecast input (saved), Excel export / import ──
  function bexKey() { return 'zeta_mf_bex_fy' + D.meta.target_year; }
  function bexAll() { try { return JSON.parse(localStorage.getItem(bexKey()) || '{}') || {}; } catch (e) { return {}; } }
  function bexPut(map) { try { localStorage.setItem(bexKey(), JSON.stringify(map)); return true; } catch (e) { return false; } }
  // 2026-10-15 (Ahmed) v2: BEX plans BOTTOM-UP — a share % per Zeta item; brand / total = sum of items (never typed);
  // BEX may also edit the market FY forecast (SU). Saved per market: { mkt: SU|null, items: {item: share%}, saved, by }.
  // Markets without item detail use items.__total__ (one share for all Zeta).
  // 2026-10-16 (Ahmed): every title keeps its OWN plan on its own computer, labelled with the title
  // ("BEX forecast", "VP forecast", "CEO forecast", "SFE forecast"). Nothing is shared between users.
  function curUser() { try { return window.AUTH && window.AUTH.getValidSessionUser ? window.AUTH.getValidSessionUser() : null; } catch (e) { return null; } }
  function PN() {
    var u = curUser(), r = String((u && u.role) || '').trim(), l = r.toLowerCase();
    if (l === 'bex') return 'BEX'; if (l.indexOf('sfe') >= 0) return 'SFE'; if (l === 'ceo') return 'CEO'; if (l === 'vp') return 'VP'; if (l === 'admin') return 'Admin';
    return r ? r.replace(/[^A-Za-z ]/g, '').split(' ').map(function (w) { return w.charAt(0); }).join('').toUpperCase() || 'My' : 'My';
  }
  function bex2Legacy() { return 'zeta_mf_bex2_fy' + D.meta.target_year; }
  function bex2Key() { var u = curUser(); return bex2Legacy() + '|' + String((u && u.email) || 'local').toLowerCase(); }
  function bex2All() {
    try {
      var v = localStorage.getItem(bex2Key());
      if (v == null) {   // one-time: the plan saved before 2026-10-16 (single key) moves to the first user who opens the page
        var old = localStorage.getItem(bex2Legacy());
        if (old && !localStorage.getItem(bex2Legacy() + '|claimed')) { localStorage.setItem(bex2Key(), old); localStorage.setItem(bex2Legacy() + '|claimed', bex2Key()); v = old; }
      }
      return JSON.parse(v || '{}') || {};
    } catch (e) { return {}; }
  }

  // 2026-10-19 (Ahmed: "all what I saved yesterday in forecast I didn't find").
  // (1) Plans saved at BU / Line / Egypt level (before 2026-10-18 the totals were planned on their own) are no longer
  //     read there: totals now add up the DM1 plans. migrateAggPlans() moves each saved item share down to its DM1
  //     market (same SU, re-expressed as a share of that market), only where the DM1 has no share for the item, and
  //     keeps the original record (flag "migrated") plus a one-time backup of the whole plan store.
  // (2) Plans are kept per login on this computer: planInventory() finds plans saved under another login (e.g. while
  //     using "Act As") so they can be copied into the current one.
  var MIGR = { moved: 0, from: [] };
  function migrateAggPlans() {
    var a = bex2All(), keys = Object.keys(a).filter(function (k) { var v = a[k]; return /^(BU|Line|Total)\|/.test(k) && v && !v.migrated && Object.keys(v.items || {}).some(function (i) { return i !== '__total__' && fin(v.items[i]); }); });
    if (!keys.length) return 0;
    try { var bk = bex2Key() + '|backup_before_dm1_move'; if (!localStorage.getItem(bk)) localStorage.setItem(bk, JSON.stringify(a)); } catch (e) { }
    var rank = { Line: 0, BU: 1, Total: 2 }, moved = 0;
    keys.sort(function (x, y) { return rank[x.split('|')[0]] - rank[y.split('|')[0]]; }).forEach(function (k) {
      var ty = k.split('|')[0], nm = k.slice(ty.length + 1), seg = D.segments.find(function (q) { return q.type === ty && q.name === nm; }), v = a[k];
      if (!seg) return;
      var ms = aggMembers(seg).map(function (q) { return q.name; }), aggMkt = fin(v.mkt) && v.mkt > 0 ? v.mkt : (seg.forecast || {}).fy_target, n0 = moved;
      if (!fin(aggMkt)) return;
      Object.keys(v.items || {}).forEach(function (it) {
        var sh = v.items[it]; if (it === '__total__' || !fin(sh)) return;
        var d1 = dmOf('DM1', [it]); if (!d1 || ms.indexOf(d1) < 0) return;
        var q = D.segments.find(function (x) { return x.type === 'DM1' && x.name === d1; }); if (!q) return;
        var lk = 'DM1|' + d1, leaf = a[lk] || { mkt: null, items: {}, saved: v.saved, by: 'moved from ' + nm };
        leaf.items = leaf.items || {};
        if (fin(leaf.items[it])) return;   // the DM1 plan already has this item: it wins
        var mq = fin(leaf.mkt) && leaf.mkt > 0 ? leaf.mkt : (q.forecast || {}).fy_target; if (!(mq > 0)) return;
        leaf.items[it] = Math.round(sh / 100 * aggMkt / mq * 100 * 10000) / 10000;
        if (!leaf.saved) leaf.saved = v.saved;
        a[lk] = leaf; moved++;
      });
      v.migrated = new Date().toLocaleString();
      if (moved > n0) MIGR.from.push(nm);
    });
    bex2Put(a); MIGR.moved = moved; return moved;
  }
  function planInventory() {
    var pre = bex2Legacy() + '|', mine = bex2Key(), out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i); if (!k || k.indexOf(pre) !== 0 || k === mine || /\|(claimed|backup_[^|]*)$/.test(k)) continue;
        var m = {}; try { m = JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { }
        var n = Object.keys(m).filter(function (x) { return /^(DM1|DM2)\|/.test(x) && Object.keys((m[x] || {}).items || {}).length; }).length;
        var nAgg = Object.keys(m).filter(function (x) { return /^(BU|Line|Total)\|/.test(x) && Object.keys((m[x] || {}).items || {}).length; }).length;
        if (n + nAgg) out.push({ key: k, who: k.slice(pre.length), n: n, nAgg: nAgg });
      }
    } catch (e) { }
    return out;
  }
  function copyPlansFrom(key) {   // other login -> mine; my own shares win; BU/Line records are moved down to DM1 afterwards
    var src = {}; try { src = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return 0; }
    var a = bex2All(), n = 0;
    Object.keys(src).forEach(function (k) {
      var v = src[k]; if (!v || !v.items) return;
      var t = a[k] || { mkt: v.mkt, items: {}, saved: v.saved, by: (v.by || '') + ' (copied)' }; t.items = t.items || {};
      Object.keys(v.items).forEach(function (it) { if (!fin(t.items[it]) && fin(v.items[it])) { t.items[it] = v.items[it]; n++; } });
      if (!fin(t.mkt) && fin(v.mkt)) t.mkt = v.mkt;
      if (/^(BU|Line|Total)\|/.test(k)) delete t.migrated;
      a[k] = t;
    });
    bex2Put(a); DRAFT = {}; migrateAggPlans(); return n;
  }
  function planRecoveryNote() {
    var h = '';
    if (MIGR.moved) h += '<p class="note" style="border-left:3px solid var(--hi);padding-left:8px"><b>' + MIGR.moved + ' item shares you saved at BU / Line level' + (MIGR.from.length ? ' (' + esc(MIGR.from.join(', ')) + ')' : '') + ' were moved into their DM1 markets</b>, so the totals add them up again. Nothing was deleted (a backup of your saved plans is kept on this computer).</p>';
    var inv = planInventory();
    if (inv.length) h += '<p class="note" style="border-left:3px solid var(--warn-bd);padding-left:8px">Plans saved on this computer under another login: ' + inv.map(function (x) { return '<b>' + esc(x.who) + '</b> (' + x.n + ' market' + (x.n === 1 ? '' : 's') + (x.nAgg ? ' + ' + x.nAgg + ' totals' : '') + ') <button type="button" class="xbtn ghost mf-bcopy" data-k="' + esc(x.key) + '">Copy into my plan</button>'; }).join(' · ') + '</p>';
    return h;
  }
  function bex2Put(map) { try { localStorage.setItem(bex2Key(), JSON.stringify(map)); } catch (e) { return false; } try { sfMirror(map); } catch (e) { } return true; }
  // 2026-10-19 (Ahmed: "STILL NO DATA ... I DIDN'T HAVE ANY BACKUP"): Edge rebuilt its Local Storage and the plans were lost.
  // Three safety layers, all automatic after every save:
  //  (1) a mirror copy in this browser's IndexedDB (separate store) -- restored automatically if Local Storage comes back empty;
  //  (2) a JSON backup file in a folder Ahmed chooses once (File System Access API, Edge / Chrome): latest + one copy per day;
  //  (3) "Download backup" / "Restore from backup" (backup .json, or any FY plan Excel exported from this page).
  var SAFE = { db: null, dir: null, dirName: '', last: null, err: '', restored: 0, T: null, perm: '' };
  function sfDB(cb) {
    if (SAFE.db) return cb(SAFE.db);
    try {
      var rq = indexedDB.open('zeta_mf_safe', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
      rq.onsuccess = function () { SAFE.db = rq.result; cb(SAFE.db); };
      rq.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }
  function sfGet(k, cb) { sfDB(function (db) { if (!db) return cb(null); try { var q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { cb(q.result || null); }; q.onerror = function () { cb(null); }; } catch (e) { cb(null); } }); }
  function sfPut(k, v) { sfDB(function (db) { if (!db) return; try { db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch (e) { } }); }
  function planCount(map) { return Object.keys(map || {}).filter(function (k) { var v = map[k]; return /^(DM1|DM2|BU|Line|Total)\|/.test(k) && v && (fin(v.mkt) || Object.keys(v.items || {}).some(function (i) { return fin(v.items[i]); })); }).length; }
  function sfWho() { var u = curUser(); return String((u && u.email) || 'local').toLowerCase(); }
  function sfPayload(map) { return { app: 'zeta-market-forecast-plans', version: 1, target_year: D.meta.target_year, email: sfWho(), title: PN(), exported: new Date().toISOString(), markets: planCount(map), plans: map }; }
  function sfFile(day) { return 'Zeta_FY' + D.meta.target_year + '_plans_' + sfWho().replace(/[^a-z0-9._-]+/g, '_') + (day ? '_' + new Date().toISOString().slice(0, 10) : '') + '.json'; }
  function sfMirror(map) {   // called after every successful save of the plan store
    sfPut('plans|' + bex2Key(), { ts: Date.now(), map: map });
    clearTimeout(SAFE.T); SAFE.T = setTimeout(function () { sfWriteFile(map); }, 600);
  }
  function sfWriteFile(map) {
    var d = SAFE.dir; if (!d) return;
    var go = function () {
      var txt = JSON.stringify(sfPayload(map), null, 1), n = planCount(map);
      // never lose a fuller backup: if the file on disk has more planned markets than now, keep it under a time-stamped name first
      d.getFileHandle(sfFile(false)).then(function (fh) { return fh.getFile(); }).then(function (f) { return f.text(); }).then(function (t) {
        var old = JSON.parse(t); if (!(old && old.markets > n)) return;
        return d.getFileHandle(sfFile(false).replace(/\.json$/, '_kept_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'), { create: true }).then(function (h) { return h.createWritable(); }).then(function (w) { return w.write(t).then(function () { return w.close(); }); });
      }).catch(function () { }).then(function () { return [sfFile(false), sfFile(true)].reduce(function (p, nm) {
        return p.then(function () { return d.getFileHandle(nm, { create: true }); }).then(function (fh) { return fh.createWritable(); }).then(function (w) { return w.write(txt).then(function () { return w.close(); }); });
      }, Promise.resolve()); }).then(function () { SAFE.last = new Date(); SAFE.err = ''; sfPut('last|' + bex2Key(), SAFE.last.toISOString()); sfStatus(); })
        .catch(function (e) { SAFE.err = 'backup file not written (' + (e && e.message || e) + ')'; sfStatus(); });
    };
    try {
      d.queryPermission({ mode: 'readwrite' }).then(function (s) { SAFE.perm = s; if (s === 'granted') go(); else { SAFE.err = 'press Save once to allow writing to the backup folder'; sfStatus(); } });
    } catch (e) { }
  }
  function sfAsk() {   // must run inside a click: re-allows the backup folder after the browser was restarted
    var d = SAFE.dir; if (!d || SAFE.perm === 'granted') return;
    try { d.requestPermission({ mode: 'readwrite' }).then(function (s) { SAFE.perm = s; if (s === 'granted') sfWriteFile(bex2All()); }); } catch (e) { }
  }
  function sfChooseDir() {
    if (!global.showDirectoryPicker) { alert('This browser cannot write to a folder. Use "Download backup" after each planning session.'); return; }
    global.showDirectoryPicker({ id: 'zeta-plans', mode: 'readwrite' }).then(function (d) {
      SAFE.dir = d; SAFE.dirName = d.name; SAFE.perm = 'granted'; sfPut('dir|' + sfWho(), d);
      sfWriteFile(bex2All()); sfStatus();
    }).catch(function () { });
  }
  function sfDownload() {
    var map = bex2All(), blob = new Blob([JSON.stringify(sfPayload(map), null, 1)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = sfFile(true); document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function sfMerge(src, label) {   // backup -> my plan. A market record is taken when I have none, or when the backup's is newer.
    var a = bex2All(), nM = 0, nI = 0, kept = 0;
    Object.keys(src || {}).forEach(function (k) {
      var v = src[k]; if (!/^(DM1|DM2|BU|Line|Total)\|/.test(k) || !v || typeof v !== 'object') return;
      var c = a[k], has = c && (fin(c.mkt) || Object.keys(c.items || {}).length);
      if (has && !(fin(v.ts) && (!fin(c.ts) || v.ts > c.ts))) { kept++; return; }
      a[k] = JSON.parse(JSON.stringify(v)); if (!a[k].by) a[k].by = label; nM++; nI += Object.keys(v.items || {}).filter(function (i) { return fin(v.items[i]); }).length;
    });
    bex2Put(a); DRAFT = {}; migrateAggPlans();
    return { m: nM, i: nI, kept: kept };
  }
  function sfStatus() {
    var s = ROOT && ROOT.querySelector('#mf-bkst'); if (!s) return;
    s.innerHTML = sfStatusTxt();
  }
  function sfStatusTxt() {
    var n = planCount(bex2All());
    if (SAFE.dir) return 'Backup folder <b>' + esc(SAFE.dirName) + '</b>' + (SAFE.last ? ' — last written ' + esc(SAFE.last.toLocaleString()) : '') + (SAFE.err ? ' · <span class="warnt">' + esc(SAFE.err) + '</span>' : '') + ' · ' + n + ' market' + (n === 1 ? '' : 's') + ' planned.';
    return '<span class="warnt">No backup folder</span> — ' + n + ' planned market' + (n === 1 ? ' is' : 's are') + ' kept only in this browser (plus an automatic copy in its database).' + (global.showDirectoryPicker ? ' Choose a folder once (e.g. OneDrive or Documents) and every save writes a backup file there.' : ' Use "Download backup" after each planning session.');
  }
  function sfBar() {
    return '<div class="bexbar mfsafe" style="flex-wrap:wrap"><span>🛡 <b>Plan backup:</b> <span id="mf-bkst">' + sfStatusTxt() + '</span></span>' +
      (global.showDirectoryPicker ? '<button type="button" class="xbtn ghost" id="mf-bkdir">' + (SAFE.dir ? 'Change backup folder' : 'Choose backup folder') + '</button>' : '') +
      '<button type="button" class="xbtn ghost" id="mf-bkdl">⬇ Download backup</button>' +
      '<label class="xbtn ghost" title="Load a backup .json, or a FY' + D.meta.target_year + ' plan Excel exported from this page">⬆ Restore from backup<input type="file" id="mf-bkfile" accept=".json,.xlsx" hidden></label>' +
      (SAFE.restored ? '<span class="note" style="flex-basis:100%;border-left:3px solid var(--hi);padding-left:8px"><b>' + SAFE.restored + ' planned market' + (SAFE.restored === 1 ? ' was' : 's were') + ' restored automatically</b> from this browser\'s backup copy (its normal storage was found empty).</span>' : '') + '</div>';
  }
  function sfRestoreFile(file) {
    if (!file) return;
    if (/\.json$/i.test(file.name)) {
      var rd = new FileReader();
      rd.onload = function (e) {
        try {
          var j = JSON.parse(e.target.result), src = j && j.plans ? j.plans : j;
          if (j && j.target_year && j.target_year !== D.meta.target_year) { alert('This backup is for FY' + j.target_year + ', not FY' + D.meta.target_year + '.'); return; }
          var r = sfMerge(src, file.name);
          alert(r.m + ' market' + (r.m === 1 ? '' : 's') + ' (' + r.i + ' item shares) restored from ' + file.name + '.' + (r.kept ? ' ' + r.kept + ' markets kept as they are (your current plan is newer).' : '')); overview();
        } catch (err) { alert('Could not read the backup: ' + (err && err.message || err)); }
      };
      rd.readAsText(file); return;
    }
    importBex(file);
  }
  // A FY plan workbook ("Excel — FY plan (SU & Value)"): its "All markets SU" sheet holds every market of that level with
  // the item shares (fraction) and the market view on each ▸ row. Returns {a, nI, nM} or null when the sheet is absent.
  function importProSheet(wb, a, fname) {
    var shn = wb.SheetNames.find(function (n) { return n === 'All markets SU'; }); if (!shn) return null;
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[shn], { header: 1, defval: null }), t0 = String((rows[0] || [])[0] || ''), ty = 'DM1';
    LEVELS.forEach(function (l) { if (t0.indexOf(l[1]) >= 0) ty = l[0]; });
    var hi = rows.findIndex(function (r) { return r && r.indexOf('Brand / item') >= 0; }); if (hi < 0) return null;
    var H = rows[hi].map(function (c) { return String(c == null ? '' : c).trim(); });
    var iM = H.indexOf('Market'), iI = H.indexOf('Brand / item'), iL = H.indexOf('Level');
    var iS = H.findIndex(function (c) { return /^[A-Za-z]+ share$/.test(c) && c !== 'Objective share'; });
    var iV = H.findIndex(function (c) { return /^Market FY\d+ — [A-Za-z]+ view/.test(c); }), iY = H.findIndex(function (c) { return /system forecast/.test(c); });
    var nI = 0, nM = 0, stamp = 'imported ' + new Date().toLocaleString();
    var rec = function (k) { if (!a[k]) a[k] = { mkt: null, items: {}, saved: stamp, by: fname, ts: Date.now() }; a[k].items = a[k].items || {}; return a[k]; };
    rows.slice(hi + 1).forEach(function (r) {
      if (!r || !r[iM] || !r[iI]) return;
      var nm = String(r[iM]), it = String(r[iI]), lv = iL >= 0 ? r[iL] : null, k = ty + '|' + nm;
      if (!D.segments.some(function (q) { return q.type === ty && q.name === nm; })) return;
      var isMkt = lv === 'Market' || it.charAt(0) === '▸';
      if (isMkt) {
        var v = r[iV], y = r[iY];
        if (iV >= 0 && fin(v) && v > 0 && fin(y) && Math.abs(v - y) > Math.max(1, 1e-6 * y)) { rec(k).mkt = v; nM++; }
        return;
      }
      if (lv ? lv !== 'Item' : /brand total|^Total /i.test(it)) return;
      var sh = iS >= 0 ? r[iS] : null;
      if (fin(sh) && sh >= 0 && sh <= 1) { rec(k).items[it] = Math.round(sh * 10000) / 100; nI++; }
    });
    return { nI: nI, nM: nM };
  }
  function sfBoot() {   // on page open: reconnect the backup folder; refill an empty plan store from the mirror copy
    var key = bex2Key();
    sfGet('dir|' + sfWho(), function (d) {
      if (d && d.queryPermission) { SAFE.dir = d; SAFE.dirName = d.name; try { d.queryPermission({ mode: 'readwrite' }).then(function (s) { SAFE.perm = s; sfStatus(); }); } catch (e) { } }
      sfGet('last|' + key, function (t) { if (t) SAFE.last = new Date(t); sfStatus(); });
    });
    sfGet('plans|' + key, function (m) {
      var cur0 = bex2All(), raw = null; try { raw = localStorage.getItem(key); } catch (e) { }
      if (m && m.map && planCount(m.map) && raw == null) {   // store missing (browser wiped it), not merely cleared by the user
        try { localStorage.setItem(key, JSON.stringify(m.map)); } catch (e) { return; }
        SAFE.restored = planCount(m.map); DRAFT = {};
        try { migrateAggPlans(); } catch (e) { }
        if (ROOT) { try { render(); } catch (e) { } }
      } else if (planCount(cur0) && !(m && m.map)) sfMirror(cur0);   // first run: seed the mirror from what is saved today
    });
  }
  var LIVE_T = null;
  var DRAFT = {};   // unsaved edits per market (segKey -> {mkt, items})
  // 2026-10-15 (Ahmed): items are presentations (brand + form + strength, pack sizes merged). BEX shares saved / imported
  // under an old pack name (e.g. "NEXICUREFILM C.TABS 40MG 20") are added to their presentation ("NEXICURE FILM C.TABS 40MG").
  // 2026-10-18 (Ahmed: "CNS total should be 57.4, I found 48.1"): a BU / Line / Egypt total plan is NOT typed --
  // it is the SUM of the plans of its defined markets (DM1), item by item, like the market forecast itself.
  // Item share at the total = sum of the member markets' item SU / the total's market. DM2 markets keep their own plan.
  function isAgg(r) { return !!r && (r.type === 'BU' || r.type === 'Line' || r.type === 'Total'); }
  function aggMembers(r) {
    return D.segments.filter(function (q) { return q.type === 'DM1' && (r.type === 'Total' || (r.members || []).indexOf(q.name) >= 0); });
  }
  function aggPlan(r) {
    var ms = aggMembers(r), items = {}, mktSum = 0, edited = false, planned = 0, last = null, by = null;
    ms.forEach(function (q) {
      var f = q.forecast || {}, d = DRAFT[segKey(q)] || bexSavedOwn(q), sv = bexSavedOwn(q);
      var mq = d && fin(d.mkt) && d.mkt > 0 ? d.mkt : f.fy_target;
      if (d && fin(d.mkt) && d.mkt > 0) edited = true;
      if (fin(mq)) mktSum += mq;
      var any = false;
      if (d && fin(mq)) Object.keys(d.items || {}).forEach(function (k) { var sh = d.items[k]; if (k === '__total__' || !fin(sh)) return; items[k] = (items[k] || 0) + sh / 100 * mq; any = true; });
      if (any) planned++;
      if (sv && sv.saved && (!last || String(sv.saved) > String(last))) { last = sv.saved; by = sv.by; }
    });
    if (!planned) return null;
    var f0 = r.forecast || {}, useMkt = edited || !(fin(f0.fy_target) && Math.abs(f0.fy_target - mktSum) <= 0.001 * Math.max(1, mktSum));
    var base = useMkt ? mktSum : f0.fy_target, out = {};
    Object.keys(items).forEach(function (k) { out[k] = base > 0 ? items[k] / base * 100 : 0; });
    return { mkt: useMkt ? mktSum : null, items: out, saved: last, by: by, agg: true, planned: planned, markets: ms.length };
  }
  // 2026-10-19 (Ahmed: "ELEMBOSIS 5 MKT TOTAL is ok but not shown for APIX 5 DM2, also for 2.5"): a DM2 market without
  // its own saved plan shows the plan of its DM1 market(s): same item SU (DM1 share x DM1 market), re-expressed as a share
  // of the DM2 market. Read-only there (edit it on the DM1). A DM2 with its own saved plan keeps it (own plan wins).
  function dm2FromDM1(r) {
    if (!r || r.type !== 'DM2') return null;
    var its = (((r.scorecard || {}).zeta) || {}).items || [], f2 = r.forecast || {}, items = {}, n = 0, scale = 0, base = 0, last = null, by = null, from = [];
    if (!its.length || !(f2.fy_target > 0)) return null;
    (dmOf('DM1', its.map(function (i) { return i.item; })) || '').split(' / ').filter(Boolean).forEach(function (nm) {
      var q = D.segments.find(function (x) { return x.type === 'DM1' && x.name === nm; }); if (!q) return;
      var d = DRAFT[segKey(q)] || bexSavedOwn(q), sv = bexSavedOwn(q), fq = (q.forecast || {}).fy_target;
      if (!d || !(fq > 0)) return;
      var mq = fin(d.mkt) && d.mkt > 0 ? d.mkt : fq, any = false;
      its.forEach(function (i) { var sh = (d.items || {})[i.item]; if (fin(sh)) { items[i.item] = sh / 100 * mq; n++; any = true; } });
      if (any) { from.push(nm); scale += mq / fq; base++; }
      if (sv && sv.saved && (!last || String(sv.saved) > String(last))) { last = sv.saved; by = sv.by; }
    });
    if (!n) return null;
    var k = base ? scale / base : 1, mkt2 = f2.fy_target * k, out = {};   // DM1 market edited by x% -> its DM2 market moves by the same x%
    Object.keys(items).forEach(function (it) { out[it] = Math.round(items[it] / mkt2 * 100 * 10000) / 10000; });
    return { mkt: Math.abs(k - 1) > 1e-9 ? mkt2 : null, items: out, saved: last, by: by, derived: true, from: from };
  }
  function isDm2Derived(r) { return !!r && r.type === 'DM2' && !bex2All()[segKey(r)] && !!dm2FromDM1(r); }
  function isRO(r) { return isAgg(r) || isDm2Derived(r); }
  function roPlan(r) { return isAgg(r) ? aggPlan(r) : dm2FromDM1(r); }
  function bexSaved(r) { return isAgg(r) ? aggPlan(r) : (r && r.type === 'DM2' && !bex2All()[segKey(r)] ? dm2FromDM1(r) : bexSavedOwn(r)); }
  function bexSavedOwn(r) {
    var sv = bex2All()[segKey(r)]; if (!sv) return null;
    var its = (((r.scorecard || {}).zeta) || {}).items || [], names = {}, pk = {}, moved = false, out = {};
    its.forEach(function (i) { names[i.item] = 1; (i.packs || []).forEach(function (p) { pk[p] = i.item; }); });
    Object.keys(sv.items || {}).forEach(function (k) {
      var v = sv.items[k], to = names[k] || k === '__total__' ? k : pk[k];
      if (!to) return;
      if (to !== k) moved = true;
      out[to] = Math.round(((out[to] || 0) + v) * 100) / 100;
    });
    return moved || Object.keys(out).length !== Object.keys(sv.items || {}).length ? Object.assign({}, sv, { items: out }) : sv;
  }
  function bexDraft(r) {
    if (isRO(r)) return roPlan(r) || { mkt: null, items: {} };   // computed, never edited at this level
    var k = segKey(r);
    if (!DRAFT[k]) { var sv = bexSaved(r) || {}; DRAFT[k] = { mkt: fin(sv.mkt) ? sv.mkt : null, items: JSON.parse(JSON.stringify(sv.items || {})) }; }
    return DRAFT[k];
  }
  function bexDirty(r) {
    if (isRO(r)) return false;
    var d = DRAFT[segKey(r)]; if (!d) return false;
    var sv = bexSaved(r) || { mkt: null, items: {} };
    return JSON.stringify({ m: d.mkt, i: d.items }) !== JSON.stringify({ m: fin(sv.mkt) ? sv.mkt : null, i: sv.items || {} });
  }
  function itemPrice(i) { return i.s6 && i.s6[0] > 0 ? i.s6[1] / i.s6[0] : (i.mat && i.mat[0] > 0 ? i.mat[1] / i.mat[0] : null); }
  // BEX numbers for the current Zeta selection of market r (sum of the selected items' BEX)
  function bexCalc(r, z) {
    var f = r.forecast || {}, vv = r.value || {}, d = isRO(r) ? roPlan(r) : ZF_OFF || !segKey(r) ? (DRAFT[segKey(r)] || (bexSaved(r) ? bexDraft(r) : null)) : bexDraft(r);
    if (!d || !fin(f.fy_target)) return null;
    var mkt = fin(d.mkt) && d.mkt > 0 ? d.mkt : f.fy_target, pm = f.fy_target > 0 && fin(vv.fy_target) ? vv.fy_target / f.fy_target : null, mktVal = fin(pm) ? mkt * pm : null;
    var its = zItems(r), su = 0, val = 0, n = 0, hasDetail = its.length && (its[0] || {}).years;
    if (hasDetail) its.forEach(function (i) { var sh = d.items[i.item]; if (fin(sh)) { var u = sh / 100 * mkt, pr = itemPrice(i); su += u; val += fin(pr) ? u * pr : 0; n++; } });
    else if (fin(d.items.__total__)) { su = d.items.__total__ / 100 * mkt; val = fin(z.price_su) ? su * z.price_su : 0; n = 1; }
    if (!n && !(fin(d.mkt) && d.mkt > 0)) return null;
    var sv = bexSaved(r) || {};
    return { n: n, nItems: hasDetail ? its.length : 1, su: n ? su : null, val: n ? val : null, share: n ? su / mkt : null, valShare: n && mktVal > 0 ? val / mktVal : null,
      mkt: mkt, mktVal: mktVal, mktEdited: fin(d.mkt) && d.mkt > 0, mktGrowth: f.fy_le > 0 ? (mkt / f.fy_le - 1) * 100 : null,
      mktValGrowth: fin(mktVal) && vv.fy_le > 0 ? (mktVal / vv.fy_le - 1) * 100 : null, saved: sv.saved, by: sv.by, dirty: bexDirty(r) };
  }
  function segKey(r) { return r.type + '|' + r.name; }
  // 2026-10-15 (Ahmed): name the Zeta product(s) instead of "Zeta", and call the last 12 months MAT <month-yy>
  // 2026-10-15 (Ahmed): Zeta by ITEM — filters ATC4 / Brand / Item narrow the Zeta columns (market stays the whole market)
  var ZF = { key: '', atc: '', brand: '', item: '' }, ZF_OFF = false;
  function zfOn(r) { return !ZF_OFF && ZF.key === segKey(r) && !!(ZF.atc || ZF.brand || ZF.item); }
  function zfSync(r) { if (ZF.key !== segKey(r)) ZF = { key: segKey(r), atc: '', brand: '', item: '' }; }
  function zfSuffix(r) { return zfOn(r) ? '|' + [ZF.atc, ZF.brand, ZF.item].join('|') : ''; }
  function bk(r) { return segKey(r) + zfSuffix(r); }
  function zItems(r, ignoreItem) {
    var it = (((r.scorecard || {}).zeta) || {}).items || [];
    if (!zfOn(r)) return it;
    return it.filter(function (i) { return (!ZF.atc || i.atc4 === ZF.atc) && (!ZF.brand || i.brand === ZF.brand) && (ignoreItem || !ZF.item || i.item === ZF.item); });
  }
  function zdata(r) {
    var z = ((r.scorecard || {}).zeta) || {};
    if (!zfOn(r) || !(z.items || []).length || !(z.items[0] || {}).years) return z;
    var it = zItems(r), o = { years: {}, ytd: { su: 0, val: 0, su_py: 0, val_py: 0 }, mat: { su: 0, val: 0, su_py: 0, val_py: 0 }, items: it, brands: [] }, s6 = [0, 0];
    D.meta.full_years.forEach(function (y) { o.years[String(y)] = { zsu: 0, zval: 0 }; });
    it.forEach(function (i) {
      Object.keys(i.years || {}).forEach(function (y) { if (o.years[y]) { o.years[y].zsu += i.years[y][0]; o.years[y].zval += i.years[y][1]; } });
      o.ytd.su += i.ytd[0]; o.ytd.val += i.ytd[1]; o.ytd.su_py += i.ytd[2]; o.ytd.val_py += i.ytd[3];
      o.mat.su += i.mat[0]; o.mat.val += i.mat[1]; o.mat.su_py += i.mat[2]; o.mat.val_py += i.mat[3];
      s6[0] += i.s6[0]; s6[1] += i.s6[1];
      if (o.brands.indexOf(i.brand) < 0) o.brands.push(i.brand);
    });
    o.price_su = s6[0] > 0 ? s6[1] / s6[0] : (o.mat.su > 0 ? o.mat.val / o.mat.su : null);
    return o;
  }
  function zSelLabel(r) { return ZF.item ? ZF.item : ZF.brand ? ZF.brand + (ZF.atc ? ' (' + ZF.atc.split(' ')[0] + ')' : '') : ZF.atc ? 'Zeta in ' + ZF.atc : ''; }
  function zProd(r) { if (zfOn(r)) return zSelLabel(r); var b = (((r.scorecard || {}).zeta) || {}).brands || []; return !b.length ? 'Zeta' : b.length <= 2 ? b.join(' + ') : b.slice(0, 2).join(' + ') + ' + ' + (b.length - 2) + ' more'; }
  function zProdAll(r) { var b = (((r.scorecard || {}).zeta) || {}).brands || []; return b.join(', ') || 'Zeta'; }
  function matLbl() { var p = D.meta.data_period; return 'MAT ' + MON[+p.slice(5, 7) - 1] + '-' + p.slice(2, 4); }
  function cagr(a, b, n) { return fin(a) && fin(b) && a > 0 && b > 0 && n > 0 ? (Math.pow(b / a, 1 / n) - 1) * 100 : null; }
  var OBJ_RULES = { minPresence: 0.001, dominant: 0.35, losing: -0.3, gainMin: 0.5, gainMax: 5 };
  // 2026-10-16 (Ahmed: "top-down, cascaded"): the objective is set top-down (whole market rule) and cascaded
  // total -> brands -> items in proportion to each one's own rule objective, so items, brands and total ADD UP
  // (page, all Excel exports and the formula workbook). Strategy / reason still come from each selection's own rule.
  var CASC = {};
  function cascadeObj(r) {
    var key = segKey(r); if (CASC.hasOwnProperty(key)) return CASC[key];
    var its = (((r.scorecard || {}).zeta) || {}).items || [];
    if (!its.length || !(its[0] || {}).years) return (CASC[key] = null);
    var keep = ZF, off = ZF_OFF;
    var raw = function (brand, item) { ZF_OFF = !brand && !item; ZF = { key: key, atc: '', brand: brand, item: item }; var P = zplanRaw(r); return P.present && fin(P.objSU) ? P.objSU : 0; };
    try {
      var T = raw('', ''), brands = [], out = {};
      its.forEach(function (i) { if (brands.indexOf(i.brand) < 0) brands.push(i.brand); });
      var rb = brands.map(function (b) { return brands.length > 1 ? raw(b, '') : T; }), sb = rb.reduce(function (a, v) { return a + v; }, 0);
      var bMat = brands.map(function (b) { return its.filter(function (i) { return i.brand === b; }).reduce(function (a, i) { return a + (i.mat[0] || 0); }, 0); }), sbm = bMat.reduce(function (a, v) { return a + v; }, 0);
      brands.forEach(function (b, bi) {
        var bObj = sb > 0 ? T * rb[bi] / sb : (sbm > 0 ? T * bMat[bi] / sbm : 0);
        var bi_ = its.filter(function (i) { return i.brand === b; }), ri = bi_.map(function (i) { return raw(b, i.item); }), si = ri.reduce(function (a, v) { return a + v; }, 0);
        var im = bi_.map(function (i) { return i.mat[0] || 0; }), sim = im.reduce(function (a, v) { return a + v; }, 0);
        bi_.forEach(function (i, ii) { out[i.item] = si > 0 ? bObj * ri[ii] / si : (sim > 0 ? bObj * im[ii] / sim : 0); });
      });
      CASC[key] = { T: T, items: out };
    } finally { ZF = keep; ZF_OFF = off; }
    return CASC[key];
  }
  function zplan(r) {
    var o = zplanRaw(r);
    var C = cascadeObj(r); if (!C) return o;
    var su = 0, val = 0, okVal = true;
    zItems(r).forEach(function (i) { var v = C.items[i.item] || 0, pr = itemPrice(i); su += v; if (fin(pr)) val += v * pr; else if (v) okVal = false; });
    if (!o.present) {   // very small item / brand at this level: still carries its part of the cascaded objective so everything adds up
      if (!(su > 0) || !fin(o.mktSU)) return o;
      o.present = true; o.strategy = 'Defend'; o.objSU = su;
      o.reason = 'Very small at this market level (under ' + (OBJ_RULES.minPresence * 100).toFixed(1) + '% share): it carries its part of the brand objective (cascaded) so that items, brands and the total add up.';
    }
    o.rawObjSU = o.objSU; o.objSU = su; o.objShare = o.mktSU > 0 ? su / o.mktSU : o.objShare;
    if (okVal) o.objVal = val;
    o.objValShare = fin(o.objVal) && o.mktVal > 0 ? o.objVal / o.mktVal : null;
    if (zfOn(r) && Math.abs(su - o.rawObjSU) > 0.005 * Math.max(1, o.rawObjSU)) o.reason += ' Objective cascaded from the total so that items, brands and the total add up.';
    return o;
  }
  function zplanRaw(r) {
    var sc = r.scorecard || {}, z = zdata(r), zm = z.mat || {}, mm = sc.market_mat || {}, f = r.forecast || {}, vv = r.value || {};
    var o = { present: false, mktSU: f.fy_target, mktVal: vv.fy_target, price: z.price_su, brands: z.brands || [], items: z.items || [] };
    o.s = mm.su > 0 ? (zm.su || 0) / mm.su : 0; o.sp = mm.su_py > 0 ? (zm.su_py || 0) / mm.su_py : null;
    o.sv = mm.val > 0 ? (zm.val || 0) / mm.val : 0;
    o.d = fin(o.sp) ? (o.s - o.sp) * 100 : null; o.zsu = zm.su || 0; o.zval = zm.val || 0;
    var br = (sc.brands || []).slice().sort(function (a, b) { return (b.su || 0) - (a.su || 0); });
    o.lead = zfOn(r) ? !!(br[0] && br[0].z && (o.brands || []).length === 1 && br[0].n === o.brands[0]) : !!(br[0] && br[0].z);   // item / brand of the market's leading Zeta brand -> Defend
    if (o.s < OBJ_RULES.minPresence || !fin(o.mktSU)) {
      o.strategy = 'Not present'; o.reason = 'Zeta has no meaningful sales in this market in ' + matLbl() + ', so no share objective is set.';
    } else {
      o.present = true;
      var gain;
      if (o.lead || o.s >= OBJ_RULES.dominant) { o.strategy = 'Defend'; gain = 0;
        o.reason = (o.lead ? zProd(r) + ' is the market\'s biggest brand' : zProd(r) + ' already holds ' + (o.s * 100).toFixed(1) + '% of the market') + ': defend — keep today\'s share while the market grows ' + fmtP(f.growth_vs_le_pct) + '.';
      } else if (fin(o.d) && o.d <= OBJ_RULES.losing) { o.strategy = 'Defend'; gain = 0;
        o.reason = zProd(r) + ' lost ' + Math.abs(o.d).toFixed(1) + ' pts of share (' + matLbl() + ' vs the previous MAT): defend — stop the loss and hold ' + (o.s * 100).toFixed(1) + '%.';
      } else { o.strategy = 'Grow';
        var gMin = Math.min(OBJ_RULES.gainMin, o.s * 100 * 0.25), gMax = Math.min(OBJ_RULES.gainMax, o.s * 100);   // small shares: min +25% of today's share, max double it
        gain = Math.min(gMax, Math.max(gMin, fin(o.d) ? o.d : gMin));
        o.reason = zProd(r) + ' is ' + (fin(o.d) && o.d > 0 ? 'gaining share (+' + o.d.toFixed(1) + ' pts, ' + matLbl() + ' vs the previous MAT)' : 'holding share') + ' without leading the market: grow — add ' + gain.toFixed(1) + ' pts' + (fin(o.d) && o.d > gMax ? ' (capped: at most +' + OBJ_RULES.gainMax + ' pts or double today\'s share)' : (!fin(o.d) || o.d < gMin) ? ' (minimum step)' : ' (same gain as ' + matLbl() + ')') + '.';
      }
      o.objShare = Math.min(1, o.s + gain / 100);
      o.objSU = o.objShare * o.mktSU; o.objVal = fin(o.price) ? o.objSU * o.price : null;
      o.objValShare = fin(o.objVal) && o.mktVal > 0 ? o.objVal / o.mktVal : null;
    }
    o.bex = bexCalc(r, z);
    return o;
  }
  // year-by-year rows in BOTH measures (used by the page and the Excel)
  // 2026-10-15 (Ahmed): growth of 2027 Zeta rows = vs the 2026 full year (estimate), like the market
  function leRatio(r) {
    var f = r.forecast || {}, vv = r.value || {}, yt = r.ytd || {}, vy = vv.ytd || {};
    return [fin(f.fy_le) && yt.cur > 0 ? f.fy_le / yt.cur : null, fin(vv.fy_le) && vy.cur > 0 ? vv.fy_le / vy.cur : null];
  }
  function zLE(r, su, val) { var q = leRatio(r); return { su: fin(q[0]) && su > 0 ? su * q[0] : null, val: fin(q[1]) && val > 0 ? val * q[1] : null }; }
  function bexLE(r) {   // {su, val}: 2026 estimate of the selected items that have a BEX share; null when no item detail
    var its = zItems(r); if (!its.length || !(its[0] || {}).years) return null;
    var d = DRAFT[segKey(r)] || bexSaved(r) || { items: {} }, su = 0, val = 0;
    its.forEach(function (i) { if (fin((d.items || {})[i.item])) { su += (i.ytd || [0, 0])[0]; val += (i.ytd || [0, 0])[1]; } });
    return zLE(r, su, val);
  }
  function leLbl() { return D.meta.partial_year + ' full year (estimate)'; }
  function yearRows(r) {
    var m = D.meta, sc = r.scorecard || {}, z = zdata(r), yrs = z.years || {}, vv = r.value || {}, f = r.forecast || {}, py = m.partial_year, ty = m.target_year, P = zplan(r);
    var gr_ = function (a, b) { return fin(a) && fin(b) && b > 0 ? (a / b - 1) * 100 : null; };
    var out = [], pm = null, pz = null, pmv = null, pzv = null;
    m.full_years.forEach(function (yy) {
      var Y = String(yy), ms = (r.history[Y] || {}).su, zs = (yrs[Y] || {}).zsu, mv = (vv.history || {})[Y], zv = (yrs[Y] || {}).zval;
      out.push({ y: Y, basis: 'Actual', msu: ms, msug: gr_(ms, pm), zsu: zs || null, zsug: zs ? gr_(zs, pz) : null, mval: mv, mvalg: gr_(mv, pmv), zval: zv || null, zvalg: zv ? gr_(zv, pzv) : null });
      pm = ms; pz = zs; pmv = mv; pzv = zv;
    });
    var zy = z.ytd || {}, vy = vv.ytd || {};
    out.push({ y: py + ' ' + (r.ytd.months || ''), basis: 'Actual so far', msu: r.ytd.cur, msug: r.ytd.growth_pct, zsu: zy.su || null, zsug: gr_(zy.su, zy.su_py), mval: vy.cur, mvalg: vy.growth_pct, zval: zy.val || null, zvalg: gr_(zy.val, zy.val_py) });
    var mm_ = sc.market_mat || {}, zm_ = z.mat || {};
    out.push({ y: matLbl(), basis: 'Actual, last 12 months (' + (sc.mat_label || '') + ')', msu: mm_.su, msug: gr_(mm_.su, mm_.su_py), zsu: zm_.su || null, zsug: gr_(zm_.su, zm_.su_py), mval: mm_.val, mvalg: gr_(mm_.val, mm_.val_py), zval: zm_.val || null, zvalg: gr_(zm_.val, zm_.val_py), mat: 1, note: 'Growth vs the previous MAT' });
    var ly = String(m.full_years[m.full_years.length - 1]);
    var ZL = zLE(r, zy.su, zy.val);
    out.push({ y: py + ' full year', basis: 'Landing estimate', msu: f.fy_le, msug: gr_(f.fy_le, (r.history[ly] || {}).su), mval: vv.fy_le, mvalg: gr_(vv.fy_le, (vv.history || {})[ly]),
      zsu: ZL.su, zsug: gr_(ZL.su, (yrs[ly] || {}).zsu), zval: ZL.val, zvalg: gr_(ZL.val, (yrs[ly] || {}).zval), note: 'Estimate: actual ' + (r.ytd.months || 'YTD') + ' + remaining months at the YTD share' });
    out.push({ y: String(ty), basis: 'Market forecast', msu: f.fy_target, msug: f.growth_vs_le_pct, mval: vv.fy_target, mvalg: vv.growth_vs_le_pct, fc: 1 });
    if (P.present) out.push({ y: String(ty), basis: zProd(r) + ' objective — ' + P.strategy, msu: f.fy_target, msug: f.growth_vs_le_pct, zsu: P.objSU, zsug: gr_(P.objSU, ZL.su), mval: vv.fy_target, mvalg: vv.growth_vs_le_pct, zval: P.objVal, zvalg: gr_(P.objVal, ZL.val), fc: 2, note: 'Growth vs ' + leLbl() });
    if (fin(f.fy_target)) { var B = P.bex || {}, BL = bexLE(r) || ZL;
      out.push({ y: String(ty), basis: '' + PN() + ' forecast' + (B.mktEdited ? ' (' + PN() + ' market)' : ''), msu: fin(B.mkt) ? B.mkt : f.fy_target, msug: fin(B.mkt) ? B.mktGrowth : f.growth_vs_le_pct,
        mval: fin(B.mktVal) ? B.mktVal : vv.fy_target, mvalg: fin(B.mktVal) ? B.mktValGrowth : vv.growth_vs_le_pct,
        zsu: fin(B.su) ? B.su : null, zsug: fin(B.su) ? gr_(B.su, BL.su) : null, zval: fin(B.val) ? B.val : null, zvalg: fin(B.val) ? gr_(B.val, BL.val) : null, fc: 3, empty: !fin(B.su) && !B.mktEdited, note: 'Growth vs ' + leLbl() }); }
    out.forEach(function (x) { x.zsush = x.msu > 0 && fin(x.zsu) ? x.zsu / x.msu : null; x.zvalsh = x.mval > 0 && fin(x.zval) ? x.zval / x.mval : null; });
    var fy = m.full_years, y0 = fy[0], yN = fy[fy.length - 1], zf = fy.find(function (yy) { return (yrs[String(yy)] || {}).zsu > 0; });
    var C = { hist: { span: y0 + '–' + yN, msu: cagr((r.history[y0] || {}).su, (r.history[yN] || {}).su, yN - y0), mval: cagr((vv.history || {})[y0], (vv.history || {})[yN], yN - y0),
        zspan: zf ? zf + '–' + yN : '', zsu: zf ? cagr(yrs[zf].zsu, (yrs[yN] || {}).zsu, yN - zf) : null, zval: zf ? cagr(yrs[zf].zval, (yrs[yN] || {}).zval, yN - zf) : null },
      fc: { span: yN + '–' + ty, msu: cagr((r.history[yN] || {}).su, f.fy_target, ty - yN), mval: cagr((vv.history || {})[yN], vv.fy_target, ty - yN),
        zsu: P.present ? cagr((yrs[yN] || {}).zsu, P.objSU, ty - yN) : null, zval: P.present ? cagr((yrs[yN] || {}).zval, P.objVal, ty - yN) : null,
        bsu: P.bex ? cagr((yrs[yN] || {}).zsu, P.bex.su, ty - yN) : null, bval: P.bex ? cagr((yrs[yN] || {}).zval, P.bex.val, ty - yN) : null } };
    return { rows: out, cagr: C, plan: P };
  }
  // 2026-10-17 (Ahmed): defined-market filter (DM1 / DM2) inside the plan sections, synced with the top filter
  function mktBar(r, at) {   // 2026-10-17 (Ahmed): two drop-down lists, one for DM1 and one for DM2
    var lv = ['DM1', 'DM2'].filter(function (l) { return segs(l).length; }); if (!lv.length) return '';
    var dd = function (l) {
      var list = segs(l).slice().sort(function (a, b) { return size(b) - size(a); }), on = r.type === l;
      return '<label class="mkdd' + (on ? ' on' : '') + '">' + l + ' <select class="mksel" data-lv="' + l + '">' + (on ? '' : '<option value="" selected>— select a ' + l + ' market (' + list.length + ') —</option>') +
        list.map(function (q) { return '<option value="' + esc(q.name) + '"' + (on && q.name === r.name ? ' selected' : '') + '>' + esc(q.name) + '</option>'; }).join('') + '</select></label>';
    };
    return '<div class="mkbar" data-at="' + at + '"><span class="kl">Defined market</span>' + lv.map(dd).join('') +
      '<span class="mut small">Showing: <b>' + esc(r.type === 'Total' ? 'Egypt total' : r.type + ' · ' + r.name) + '</b></span></div>';
  }
  // 2026-10-17 (Ahmed): "will the <title> share forecast achieve the strategic share objective?" -> verdict
  function riskBand(os) { return Math.min(0.5, Math.max(0.05, os * 100 * 0.1)); }   // pts: 0.5 pts, or 10% of a small objective share
  function shareVerdict(P) {
    var B = P && P.bex;
    if (!P || !P.present || !fin(P.objShare)) return { k: 'na' };
    if (!B || !fin(B.share)) return { k: 'none' };
    var gap = (B.share - P.objShare) * 100, band = riskBand(P.objShare), part = B.nItems > 1 && B.n < B.nItems;
    var k = gap >= -0.05 ? 'yes' : gap >= -band ? 'risk' : 'no';
    return { k: k, gap: gap, band: band, part: part, fs: B.share, os: P.objShare, cls: k === 'yes' ? 'up' : k === 'risk' ? 'n' : 'dn',
      lbl: k === 'yes' ? 'YES — achieves the objective' : k === 'risk' ? 'AT RISK — just short of the objective' : 'NO — misses the objective' };
  }
  function vCell(P) {
    var V_ = shareVerdict(P);
    if (V_.k === 'na') return '<span class="mut">—</span>';
    if (V_.k === 'none') return '<span class="mut small">no ' + PN() + ' share</span>';
    return '<span class="vchip ' + V_.cls + '" title="' + esc(V_.lbl + (V_.part ? ' (provisional: not every item has a share)' : '')) + '">' + (V_.k === 'yes' ? '✓' : V_.k === 'risk' ? '!' : '✗') + ' ' + (Math.abs(V_.gap) < 0.005 ? '' : V_.gap > 0 ? '+' : '−') + Math.abs(V_.gap).toFixed(2) + ' pts</span>' + (V_.part ? '<br><small class="mut">provisional</small>' : '');
  }
  function verdictBox(r) {
    var P = zplan(r), V_ = shareVerdict(P), pn = PN(), ty = D.meta.target_year, zn = zProd(r), val = isV(), B = P.bex || {};
    var q = '<div class="vq">Will the ' + esc(pn) + ' share forecast achieve the strategic share objective for ' + esc(zn) + ' in FY' + ty + '?</div>';
    if (V_.k === 'na') return '<div class="vrd n">' + q + '<p>' + chip('No objective', 'n') + ' ' + esc(P.reason || 'No share objective is set for this market.') + '</p></div>';
    if (V_.k === 'none') return '<div class="vrd n">' + q + '<p>' + chip('Not answered yet', 'n') + ' The objective is <b>' + (P.objShare * 100).toFixed(2) + '%</b> share (' + fmtM(P.objSU, false) + '). Type the ' + esc(pn) + ' share for each item in the table below (or press "Fill items with objective") to get the verdict.</p></div>';
    var pts = function (x) { return (Math.abs(x) < 0.005 ? '' : x > 0 ? '+' : '−') + Math.abs(x).toFixed(2) + ' pts'; };
    var s0 = P.s, dSU = (B.su || 0) - P.objSU, needF = (V_.fs - s0) * 100, needO = (V_.os - s0) * 100;
    var bl = [];
    bl.push('<b>Share:</b> ' + esc(pn) + ' ' + (V_.fs * 100).toFixed(2) + '% vs objective ' + (V_.os * 100).toFixed(2) + '% → <b>' + pts(V_.gap) + '</b>' + (V_.k === 'risk' ? ' (inside the ±' + V_.band.toFixed(2) + ' pts at-risk band)' : '') + '.');
    bl.push('<b>Volume:</b> ' + esc(pn) + ' ' + fmtM(B.su, false) + ' vs objective ' + fmtM(P.objSU, false) + ' → ' + (dSU >= 0 ? '+' : '−') + fmtM(Math.abs(dSU), false) +
      (fin(B.val) && fin(P.objVal) ? '; value ' + fmtM(B.val, true) + ' vs ' + fmtM(P.objVal, true) + ' (' + (B.val - P.objVal >= 0 ? '+' : '−') + fmtM(Math.abs(B.val - P.objVal), true) + ')' : '') + '.');
    bl.push('<b>Share move vs ' + matLbl() + ' (' + (s0 * 100).toFixed(2) + '%):</b> objective needs ' + pts(needO) + ', ' + esc(pn) + ' plans ' + pts(needF) + (fin(P.d) ? '; last MAT Zeta moved ' + pts(P.d) + ' — the ' + esc(pn) + ' plan is ' + (needF > Math.max(P.d, 0) + 0.5 ? 'more ambitious than the recent trend (needs new share actions)' : needF < Math.min(P.d, 0) - 0.5 ? 'below the recent trend' : 'in line with the recent trend') : '') + '.');
    bl.push('<b>Market assumption:</b> ' + (B.mktEdited ? esc(pn) + ' market ' + fmtM(B.mkt, false) + ' vs forecast ' + fmtM(P.mktSU, false) + ' — share is judged on the ' + esc(pn) + ' market, volume on both.' : 'same market forecast as the objective (' + fmtM(P.mktSU, false) + ').'));
    var act = V_.k === 'yes' ? (V_.gap > 2 ? 'Above the objective by more than 2 pts: confirm the share gain is resourced (calls, coverage, stock) before committing.' : 'Commit: the plan delivers the strategic share. Track monthly share vs ' + (V_.os * 100).toFixed(2) + '%.')
      : 'Close ' + pts(-V_.gap).replace('+', '') + ' (≈ ' + fmtM(Math.max(0, P.objSU * (B.mkt > 0 ? B.mkt / P.mktSU : 1) - (B.su || 0)), false) + '): ' + (V_.k === 'risk' ? 'small gap — focus on the items with the largest shortfall in the table below.' : 'agree the share actions that close it, or formally accept a lower objective.');
    bl.push('<b>Action:</b> ' + act);
    return '<div class="vrd ' + V_.cls + '">' + q + '<p class="vv">' + chip(V_.lbl, V_.cls) + (V_.part ? ' <span class="flag" title="Items without a ' + esc(pn) + ' share count as zero">provisional — ' + B.n + ' of ' + B.nItems + ' items have a share</span>' : '') + '</p><ul>' + bl.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
      '<p class="note mut">YES = ' + esc(pn) + ' share ≥ objective share. AT RISK = short by at most ' + V_.band.toFixed(2) + ' pts (0.5 pts, or 10% of a small objective share). NO = short by more. Objective = the strategic (top-down, cascaded) share' + (val ? '; the verdict is on SU share (value follows from price)' : '') + '.</p></div>';
  }
  function planCard(r) {   // 2026-10-15: header, strategy and notes; the objective + BEX rows are in the year-by-year table
    var P = zplan(r), m = D.meta, ty = m.target_year;
    var h = '<div class="h2row"><h3 class="mt">Year by year — market and ' + esc(zProd(r)) + ' · FY' + ty + ' objective & ' + PN() + ' forecast</h3>' +
      '<div class="btns"><button type="button" class="xbtn pro" id="mf-xpro" title="Formatted workbook: Summary, SU sheet, Value sheet, all markets, notes">⬇ Excel — FY' + ty + ' plan (SU & Value)</button><button type="button" class="xbtn pro" id="mf-xsfe" title="Template: total market SU, Value and Packs for every Zeta market — type market growth, Zeta share or Zeta growth FY' + ty + '">⬇ Excel — ' + PN() + ' FCST template</button><button type="button" class="xbtn pro" id="mf-xmsz" title="Market sizing by brand: FY' + D.meta.partial_year + ' and FY' + ty + ', business unit plan vs Business Excellence">⬇ Excel — Market sizing (BU vs BE)</button><button type="button" class="xbtn" id="mf-xone">⬇ Excel — this market</button><button type="button" class="xbtn" id="mf-xall">⬇ Excel — all markets (FY' + ty + ' plan)</button><label class="xbtn" title="Load ' + PN() + ' shares from an exported all-markets file">⬆ Import ' + PN() + ' file<input type="file" id="mf-ximp" accept=".xlsx,.xls" hidden></label></div></div>';
    h += zfBar(r);
    h += '<p class="pstrat">' + chip(P.strategy, P.strategy === 'Grow' ? 'up' : 'n') + ' ' + esc(P.reason) + '</p>';
    return h;
  }
  function zfBar(r) {
    var all = (((r.scorecard || {}).zeta) || {}).items || [];
    if (!all.length || !(all[0] || {}).years) return '';
    var uniq = function (a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); };
    var atcs = uniq(all.map(function (i) { return i.atc4; })).sort();
    var brs = uniq(all.filter(function (i) { return !ZF.atc || i.atc4 === ZF.atc; }).map(function (i) { return i.brand; })).sort();
    var its = all.filter(function (i) { return (!ZF.atc || i.atc4 === ZF.atc) && (!ZF.brand || i.brand === ZF.brand); });
    var opt = function (v, t, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; };
    return '<div class="zfbar"><span class="kl">Zeta selection</span>' +
      '<label>ATC4 <select id="mf-zatc">' + opt('', 'All ATC4 (' + atcs.length + ')', ZF.atc) + atcs.map(function (a) { return opt(a, a, ZF.atc); }).join('') + '</select></label>' +
      '<label>Brand <select id="mf-zbr">' + opt('', 'All brands (' + brs.length + ')', ZF.brand) + brs.map(function (b) { return opt(b, b, ZF.brand); }).join('') + '</select></label>' +
      '<label>Item <select id="mf-zit">' + opt('', 'All items (' + its.length + ')', ZF.item) + its.map(function (i) { return opt(i.item, i.item, ZF.item); }).join('') + '</select></label>' +
      (zfOn(r) ? '<button type="button" class="xbtn ghost" id="mf-zclr">Reset</button><span class="mut small">Market = the whole ' + esc(r.name) + '; ' + esc(zSelLabel(r)) + ' columns = selected Zeta sales only.</span>' : '') + '</div>';
  }
  // 2026-10-15 (Ahmed): item table grouped by brand — brand total row, then its items; grand total when > 1 brand
  function itemGroups(r) {
    var all = zItems(r, true);
    if (!all.length || !(all[0] || {}).years) return [];
    var save = { key: ZF.key, atc: ZF.atc, brand: ZF.brand, item: ZF.item }, out = [];
    var plan = function (brand, item) { ZF = { key: segKey(r), atc: save.atc, brand: brand, item: item }; var P = zplan(r); ZF = save; return P; };
    var sumOf = function (list) { var m = [0, 0, 0, 0], s6 = [0, 0], y = {}, yt = [0, 0, 0, 0]; list.forEach(function (i) { for (var q = 0; q < 4; q++) { m[q] += i.mat[q]; yt[q] += (i.ytd || [0, 0, 0, 0])[q]; } s6[0] += i.s6[0]; s6[1] += i.s6[1];
      Object.keys(i.years || {}).forEach(function (k) { y[k] = y[k] || [0, 0]; y[k][0] += i.years[k][0]; y[k][1] += i.years[k][1]; }); }); return { mat: m, s6: s6, years: y, ytd: yt }; };
    var brands = [];
    all.forEach(function (i) { var g = brands.find(function (x) { return x.brand === i.brand; }); if (!g) { g = { brand: i.brand, items: [] }; brands.push(g); } g.items.push(i); });
    brands.forEach(function (g) { g.tot = sumOf(g.items); });
    brands.sort(function (x, y) { return y.tot.mat[0] - x.tot.mat[0]; });
    if (brands.length > 1 && !save.brand) {
      var t = sumOf(all), atcs = all.map(function (i) { return i.atc4; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
      ZF = { key: segKey(r), atc: save.atc, brand: '', item: '' };
      var Pt = save.atc ? zplan(r) : (ZF_OFF = true, (function () { var q = zplan(r); ZF_OFF = false; return q; })());
      ZF = save;
      out.push({ kind: 'total', label: 'Total Zeta' + (save.atc ? ' in ' + save.atc.split(' ')[0] : ''), brand: '', atc: atcs.length === 1 ? atcs[0] : atcs.length + ' ATC4', mat: t.mat, s6: t.s6, years: t.years, ytd: t.ytd, P: Pt, n: all.length });
    }
    brands.forEach(function (g) {
      var a4 = g.items.map(function (i) { return i.atc4; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
      out.push({ kind: 'brand', label: g.brand + ' — brand total', brand: g.brand, atc: a4.length === 1 ? a4[0] : a4.length + ' ATC4', mat: g.tot.mat, s6: g.tot.s6, years: g.tot.years, ytd: g.tot.ytd, P: plan(g.brand, ''), n: g.items.length });
      g.items.forEach(function (i) { out.push({ kind: 'item', label: i.item, brand: i.brand, atc: i.atc4, mat: i.mat, s6: i.s6, years: i.years, ytd: i.ytd, packs: i.packs, P: plan(i.brand, i.item), item: i.item }); });
    });
    return out;
  }
  // 2026-10-15 (Ahmed): defined market of each Zeta item (every item sits in exactly one DM1 and one DM2)
  var DM_MAP = null;
  function dmOf(level, items) {
    if (!DM_MAP) { DM_MAP = { DM1: {}, DM2: {} }; D.segments.forEach(function (q) { if (!DM_MAP[q.type]) return; ((((q.scorecard || {}).zeta) || {}).items || []).forEach(function (i) { DM_MAP[q.type][i.item] = q.name; }); }); }
    var out = []; (items || []).forEach(function (it) { var n = DM_MAP[level][it]; if (n && out.indexOf(n) < 0) out.push(n); });
    return out.join(' / ');
  }
  // the "other" defined market of a row: DM2 market(s) in a DM1 (or any non-DM2) workbook, the parent DM1 in a DM2 workbook
  function dm2Mkt(r, x, k, what) { return r && r.type === 'DM2' ? upMkt('DM1', r, x, k, what) : upMkt('DM2', r, x, k, what); }
  function upMkt(level, r, x, k, what) {   // market total(s) of that level for a table row (SU k=0 / value k=1): mat | le | fc
    if (!r || r.type === level) return null;
    var names = (dmOf(level, rowItems(r, x)) || '').split(' / ').filter(Boolean), t = 0, ok = false;
    names.forEach(function (nm) {
      var q = D.segments.find(function (s) { return s.type === level && s.name === nm; }); if (!q) return;
      var mm = (q.scorecard || {}).market_mat || {}, f = q.forecast || {}, vv = q.value || {};
      var v = what === 'mat' ? mm[k ? 'val' : 'su'] : what === 'le' ? (k ? vv.fy_le : f.fy_le) : (k ? vv.fy_target : f.fy_target);
      if (fin(v)) { t += v; ok = true; }
    });
    return ok ? t : null;
  }
  function rowItems(r, x) {
    var all = (((r.scorecard || {}).zeta) || {}).items || [];
    if (x.kind === 'item') return [x.item];
    return all.filter(function (i) { return (x.kind === 'total' || i.brand === x.brand) && (!ZF.atc || i.atc4 === ZF.atc); }).map(function (i) { return i.item; });
  }
  // BEX growth like-for-like: BEX FY2027 vs the 2026 full-year estimate of the items that have a BEX share (k 0 = SU, 1 = value)
  function bexGrowth(r, x, k) {
    var B = x.P && x.P.bex; if (!B || !fin(B.su)) return null;
    var bx = k ? B.val : B.su, d = DRAFT[segKey(r)] || bexSaved(r) || { items: {} }, set = rowItems(r, x), base = 0;
    ((((r.scorecard || {}).zeta) || {}).items || []).forEach(function (i) { if (set.indexOf(i.item) >= 0 && fin((d.items || {})[i.item])) base += (i.ytd || [0, 0])[k]; });
    var q = leRatio(r)[k]; base = fin(q) ? base * q : 0;
    return fin(bx) && base > 0 ? bx / base - 1 : null;
  }
  function zCagr(years, k) {
    var fy = D.meta.full_years, yN = fy[fy.length - 1], y0 = fy.find(function (y) { return ((years || {})[String(y)] || [0, 0])[k] > 0; });
    if (!y0 || y0 >= yN) return { pct: null, span: '' };
    return { pct: cagr(years[String(y0)][k], (years[String(yN)] || [0, 0])[k], yN - y0), span: y0 + '–' + yN };
  }
  function mktCagr(r, k) {
    var fy = D.meta.full_years, y0 = fy[0], yN = fy[fy.length - 1], h = k ? ((r.value || {}).history || {}) : null;
    var a = k ? h[y0] : (r.history[y0] || {}).su, b = k ? h[yN] : (r.history[yN] || {}).su;
    return { pct: cagr(a, b, yN - y0), span: y0 + '–' + yN };
  }
  function itemTable(r) {
    var G = itemGroups(r);
    if (!G.length) return '';
    var val = isV(), k = val ? 1 : 0, sc = r.scorecard || {}, mm = sc.market_mat || {}, mk = val ? mm.val : mm.su, mkp = val ? mm.val_py : mm.su_py;
    var MC = mktCagr(r, k), showDM = r.type !== 'DM1' && r.type !== 'DM2';
    var f_ = r.forecast || {}, v_ = r.value || {}, mfc = val ? v_.fy_target : f_.fy_target, mfg = val ? v_.growth_vs_le_pct : f_.growth_vs_le_pct, bm_ = (zplan(r).bex || {});
    var mmCell = '<td class="num r mkt">' + (fin(mk) ? fmtM(mk, val) : '—') + '</td><td class="num r mkt">' + (mkp > 0 && fin(mk) ? fmtP((mk / mkp - 1) * 100) : '—') + '</td>';
    var mfcCell = '<td class="num r mkt">' + (fin(mfc) ? fmtM(mfc, val) : '—') + (bm_.mktEdited ? '<br><small class="mut" title="' + PN() + ' market">' + PN() + ' ' + fmtM(val ? bm_.mktVal : bm_.mkt, val) + '</small>' : '') + '</td>' +
      '<td class="num r mkt">' + fmtP(mfg) + (bm_.mktEdited ? '<br><small class="mut">' + PN() + ' ' + fmtP(val ? bm_.mktValGrowth : bm_.mktGrowth) + '</small>' : '') + '</td>';
    var rows = G.map(function (x) {
      var ZC = zCagr(x.years, k);
      var P = x.P, sh = mk > 0 ? x.mat[k] / mk : null, shp = mkp > 0 ? x.mat[k + 2] / mkp : null, d = fin(sh) && fin(shp) ? (sh - shp) * 100 : null, g = x.mat[k + 2] > 0 ? (x.mat[k] / x.mat[k + 2] - 1) * 100 : null;
      var obj = P.present ? (val ? P.objVal : P.objSU) : null, bx = P.bex && fin(P.bex.su) ? (val ? P.bex.val : P.bex.su) : null, dd = bexDraft(r);
      var sel = (x.kind === 'item' && x.item === ZF.item) || (x.kind === 'brand' && !ZF.item && ZF.brand === x.brand);
      var cls = x.kind === 'item' ? 'irow' : x.kind === 'brand' ? 'irow brow' : 'irow trow';
      var name = x.kind === 'item' ? '<span class="ind">↳</span> <span title="' + esc('Packs: ' + ((x.packs || []).join(' · ') || x.label)) + '">' + esc(x.label) + '</span>' + ((x.packs || []).length > 1 ? ' <small class="mut">(' + x.packs.length + ' packs)</small>' : '') : '<b>' + esc(x.label) + '</b>' + (x.n ? ' <span class="mut small">(' + x.n + ' item' + (x.n > 1 ? 's' : '') + ')</span>' : '');
      return '<tr class="' + cls + (sel ? ' sel' : '') + '" data-kind="' + x.kind + '" data-br="' + esc(x.brand) + '" data-it="' + esc(x.item || '') + '"><td>' + name + '</td><td class="mut">' + esc(x.kind === 'total' ? '' : x.brand) + '</td><td class="mut small">' + esc((x.atc || '').split(' ')[0]) + '</td>' + (showDM ? '<td class="mut small">' + esc(x.kind === 'item' ? dmOf('DM1', [x.item]) : '') + '</td>' : '') + mmCell +
        '<td class="num r">' + fmtM(x.mat[k], val) + '</td><td class="num r">' + fmtP(g) + '</td><td class="num r mut">' + fmtP(MC.pct) + '</td><td class="num r" title="' + esc(ZC.span) + '">' + fmtP(ZC.pct) + (ZC.span && ZC.span !== MC.span ? ' <small class="mut">(' + esc(ZC.span) + ')</small>' : '') + '</td><td class="num r">' + (fin(sh) ? (sh * 100).toFixed(2) + '%' : '—') + '</td><td class="num r ' + (d == null ? '' : d >= 0.05 ? 'pos' : d <= -0.05 ? 'neg' : '') + '">' + (d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(2) + ' pts') + '</td>' +
        mfcCell + '<td>' + (P.present ? chip(P.strategy, P.strategy === 'Grow' ? 'up' : 'n') : '<span class="mut">—</span>') + '</td><td class="num r">' + (P.present ? (P.objShare * 100).toFixed(2) + '%' : '—') + '</td><td class="num r">' + (fin(obj) ? fmtM(obj, val) : '—') + '</td><td class="num r bexc">' + (x.kind === 'item' && !isRO(r) ? '<input type="text" inputmode="decimal" class="bexi" data-item="' + esc(x.item) + '" min="0" max="100" step="0.01" placeholder="share %" value="' + (fin(dd.items[x.item]) ? dd.items[x.item] : '') + '"> %<br>' : '') + (fin(bx) ? '<b>' + fmtM(bx, val) + '</b> <span class="mut">(' + ((val ? P.bex.valShare : P.bex.share) * 100).toFixed(2) + '%' + (x.kind !== 'item' ? ', ' + P.bex.n + '/' + P.bex.nItems + ' items' : '') + ')</span>' : '<span class="mut">—</span>') + '</td>' +
        '<td class="num r bexg">' + (function (q) { return fin(q) ? fmtP(q * 100) + (x.kind !== 'item' && P.bex.n < P.bex.nItems ? ' <small class="mut" title="Like-for-like: only the items with a ' + PN() + ' share">(' + P.bex.n + '/' + P.bex.nItems + ')</small>' : '') : '<span class="mut">—</span>'; })(bexGrowth(r, x, k)) + '</td>' + (isSFEView() ? '<td class="num r">' + vCell(P) + '</td>' : '') + '</tr>';
    });
    return '<div class="h2row"><h3 class="mt">By brand and item — ' + matLbl() + ' and FY' + D.meta.target_year + ' objective <span class="mut small">(click a brand or an item to plan it above)</span></h3>' +
      '<div class="btns"><button type="button" class="xbtn" id="mf-xtbl" title="All Zeta brands and items (filters ignored) for this market and for every market at this level, SU and value, with objective and ' + PN() + ' forecast">⬇ Excel — full table, all products</button></div></div><div class="tblwrap"><table class="tbl yby itbl"><thead><tr><th>Brand / item</th><th>Brand</th><th>ATC4</th>' + (showDM ? '<th>Defined market</th>' : '') + '<th class="r">Market ' + matLbl() + '</th><th class="r">Market growth<br><small class="mut">vs previous MAT</small></th><th class="r">Zeta ' + matLbl() + '</th><th class="r">Zeta growth<br><small class="mut">vs previous MAT</small></th><th class="r">Market CAGR ' + esc(MC.span) + '</th><th class="r">Zeta CAGR</th><th class="r">Share' + (val ? ' (value)' : ' (SU)') + '</th><th class="r">Share change</th><th class="r">Market FY' + D.meta.target_year + '<br><small class="mut">forecast</small></th><th class="r">Market growth<br><small class="mut">FY' + D.meta.target_year + ' vs ' + D.meta.partial_year + '</small></th><th>Strategy</th><th class="r">Objective share</th><th class="r">Objective FY' + D.meta.target_year + '</th><th class="r">' + PN() + ' forecast<br><small class="mut">share % per item → SU / value</small></th><th class="r">' + PN() + ' growth<br><small class="mut">FY' + D.meta.target_year + ' vs ' + D.meta.partial_year + '</small></th>' + (isSFEView() ? '<th class="r">Share verdict<br><small class="mut">' + PN() + ' vs objective</small></th>' : '') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function planNotes(r) {
    var P = zplan(r);
    var B = P.bex || {}, st = bexSaved(r), dirty = bexDirty(r);
    var msg = dirty ? '<b class="warnt">Unsaved changes</b> — press Save.' : st && st.saved ? 'Saved ' + esc(st.saved) + (st.by ? ' by ' + esc(st.by) : '') + '.' : 'Plan bottom-up: type the ' + PN() + ' share for each item in the table below (brand and total add up). Edit the market only if ' + PN() + ' disagrees with the forecast.';
    var rec = sfBar() + planRecoveryNote();
    if (isDm2Derived(r)) {
      var dp = dm2FromDM1(r);
      return rec + '<div class="bexbar agg"><span><b>' + esc(PN()) + ' forecast here comes from the DM1 plan of ' + esc(dp.from.join(' / ')) + '.</b> Same item SU, shown as a share of this DM2 market (' + fmtM(fin(dp.mkt) ? dp.mkt : (r.forecast || {}).fy_target, false) + (fin(dp.mkt) ? ', moved with the DM1 ' + esc(PN()) + ' market' : '') + ')' + (dp.saved ? ' — last saved ' + esc(dp.saved) : '') + '. To change it, choose the DM1 market with DM2 = All and edit the shares there.</span></div>';
    }
    if (isAgg(r)) {
      var ap = aggPlan(r), ms = aggMembers(r), notp = ms.filter(function (q) { var d = DRAFT[segKey(q)] || bexSavedOwn(q); return !(d && Object.keys(d.items || {}).some(function (k) { return k !== '__total__' && fin(d.items[k]); })) && (((q.scorecard || {}).zeta || {}).items || []).length; });
      return rec + '<div class="bexbar agg"><span><b>' + esc(PN()) + ' forecast here = the sum of its defined markets (DM1).</b> Plan each DM1 market (choose it in the DM1 filter); this total adds them up item by item' +
        (ap ? ' — ' + ap.planned + ' of ' + ms.length + ' markets planned' + (ap.saved ? ', last saved ' + esc(ap.saved) : '') : ' — no market planned yet') + '.</span>' +
        (notp.length ? '<br><span class="mut small">Zeta markets without a ' + esc(PN()) + ' plan: ' + notp.map(function (q) { return esc(q.name); }).join(', ') + '.</span>' : '') + '</div>' +
        '<p class="note mut">' + esc(zProd(r)) + ' SU = sum of the DM1 plans. Share = that SU ÷ this total\'s market (' + fmtM(P.mktSU, false) + '). Value = each item\'s SU × its own price per SU today.</p>';
    }
    return rec + '<div class="bexbar"><button type="button" class="xbtn" id="mf-bsave"' + (dirty ? '' : ' disabled') + '>Save ' + PN() + ' forecast</button>' +
      '<button type="button" class="xbtn ghost" id="mf-bfill" title="Pre-fill every item with its system objective share">Fill items with objective</button>' +
      '<button type="button" class="xbtn ghost" id="mf-bundo"' + (dirty ? '' : ' disabled') + '>Undo changes</button>' +
      '<button type="button" class="xbtn danger" id="mf-bclear"' + (st || dirty ? '' : ' disabled') + '>Clear ' + PN() + ' forecast</button>' +
      '<span class="mut" id="mf-bmsg">' + msg + '</span></div>' +
      '<p class="note mut">' + esc(zProd(r)) + ' SU = share × market forecast (' + fmtM(P.mktSU, false) + '). Value = SU × ' + esc(zProd(r)) + '\'s own price per SU today (EGP ' + (fin(P.price) ? P.price.toFixed(2) : '—') + ', last 6 months), no new price increase. ' +
      'Objective: Defend = biggest brand in the market, ≥ ' + (OBJ_RULES.dominant * 100) + '% share, or lost ≥ ' + Math.abs(OBJ_RULES.losing) + ' pts vs the previous MAT → hold today\'s share. Grow = otherwise → add the share gain of the latest MAT (min +' + OBJ_RULES.gainMin + ' pts or +25% of a small share; max +' + OBJ_RULES.gainMax + ' pts or double the share). ' +
      'Growth on ' + D.meta.target_year + ' Zeta rows = vs the ' + leLbl() + ' (actual ' + esc(r.ytd.months || 'YTD') + ' + remaining months at Zeta\'s YTD share of the market forecast). ' + PN() + ' forecasts are saved in this browser; share them with the Excel buttons and Import.</p>' +
      '<p class="note"><b>Zeta product' + (P.brands.length > 1 ? 's' : '') + ':</b> ' + esc(P.brands.join(', ') || '—') + ' · <b>Items:</b> ' + esc(P.items.map(function (i) { return i.item; }).join(' · ') || '—') + '</p>';
  }
  function wirePlan(r) {
    var el = ROOT.querySelector('#mf-ov'); if (!el) return;
    var D_ = bexDraft(r), cu = (typeof AU().getValidSessionUser === 'function' ? AU().getValidSessionUser() : null) || {}, who = cu.name || cu.email || '';
    var num = function (v) { var x = parseFloat(String(v).replace(/,/g, '')); return fin(x) ? x : null; };
    // market edit (in M SU)
    // 2026-10-15: BEX updates LIVE while typing (debounced re-render; focus and cursor are kept)
    var refocus = function (sel, pos) { var nx = ROOT.querySelector(sel); if (nx) { nx.focus(); try { nx.setSelectionRange(pos, pos); } catch (e) { } } };
    var live = function (inp, sel, apply) {
      var run = function () { var pos = inp.selectionStart; apply(); clearTimeout(LIVE_T); overview(); refocus(sel, pos); };
      inp.oninput = function () { clearTimeout(LIVE_T); LIVE_T = setTimeout(run, 350); };
      inp.onchange = function () { clearTimeout(LIVE_T); run(); };
      inp.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(LIVE_T); run(); } };
    };
    var mi = el.querySelector('#mf-bmkt');
    if (mi) live(mi, '#mf-bmkt', function () { var v = num(mi.value); D_.mkt = fin(v) && v > 0 ? v * 1e6 : null; });
    var mg = el.querySelector('#mf-bmg');   // growth % -> market SU = FY landing estimate x (1 + %)
    if (mg) live(mg, '#mf-bmg', function () { var v = num(mg.value), le = (r.forecast || {}).fy_le; D_.mkt = fin(v) && v > -100 && le > 0 ? Math.round(le * (1 + v / 100)) : null; });
    // item shares (and the one-share fallback)
    el.querySelectorAll('input.bexi').forEach(function (inp) {
      var key = inp.getAttribute('data-item');
      live(inp, 'input.bexi[data-item="' + (window.CSS && CSS.escape ? CSS.escape(key) : key.replace(/"/g, '\\"')) + '"]', function () {
        var v = num(inp.value);
        if (fin(v) && v >= 0 && v <= 100) D_.items[key] = Math.round(v * 100) / 100; else delete D_.items[key];
      });
    });
    var bf = el.querySelector('#mf-bfill'); if (bf) bf.onclick = function () {
      itemGroups(r).forEach(function (x) { if (x.kind === 'item' && x.P.present && D_.items[x.item] == null) D_.items[x.item] = Math.round(x.P.objShare * 10000) / 100; });
      if (!((((r.scorecard || {}).zeta) || {}).items || []).length) { var P0 = zplan(r); if (P0.present && D_.items.__total__ == null) D_.items.__total__ = Math.round(P0.objShare * 10000) / 100; }
      overview(); };
    var bs = el.querySelector('#mf-bsave'); if (bs) bs.onclick = function () {
      var a = bex2All(), has = fin(D_.mkt) || Object.keys(D_.items).length;
      if (has) a[segKey(r)] = { mkt: fin(D_.mkt) ? D_.mkt : null, items: JSON.parse(JSON.stringify(D_.items)), saved: new Date().toLocaleString(), by: who, ts: Date.now() }; else delete a[segKey(r)];
      sfAsk();
      var ok = bex2Put(a); overview();
      if (!ok) { var m2 = ROOT.querySelector('#mf-bmsg'); if (m2) m2.textContent = 'Could not save in this browser — use the Excel export.'; } };
    var kd = el.querySelector('#mf-bkdir'); if (kd) kd.onclick = sfChooseDir;
    var kl = el.querySelector('#mf-bkdl'); if (kl) kl.onclick = sfDownload;
    var kf = el.querySelector('#mf-bkfile'); if (kf) kf.onchange = function () { sfRestoreFile(kf.files && kf.files[0]); kf.value = ''; };
    var bu = el.querySelector('#mf-bundo'); if (bu) bu.onclick = function () { delete DRAFT[segKey(r)]; overview(); };
    el.querySelectorAll('.mf-bcopy').forEach(function (b) { b.onclick = function () { var n = copyPlansFrom(b.getAttribute('data-k')); overview(); var m4 = ROOT.querySelector('#mf-bmsg'); if (m4) m4.textContent = n + ' item shares copied into your plan.'; }; });
    var bc = el.querySelector('#mf-bclear'); if (bc) bc.onclick = function () {
      if (bc.getAttribute('data-arm') !== '1') { bc.setAttribute('data-arm', '1'); bc.textContent = 'Click again to clear'; setTimeout(function () { if (bc.isConnected) { bc.removeAttribute('data-arm'); bc.textContent = 'Clear ' + PN() + ' forecast'; } }, 4000); return; }
      var a = bex2All(); delete a[segKey(r)]; bex2Put(a); delete DRAFT[segKey(r)]; overview();
      var m3 = ROOT.querySelector('#mf-bmsg'); if (m3) m3.textContent = '' + PN() + ' forecast cleared for ' + r.name + '.'; };
    var setZ = function (k, v) { ZF.key = segKey(r); ZF[k] = v; if (k === 'atc') { ZF.brand = ''; ZF.item = ''; } if (k === 'brand') ZF.item = ''; overview(); };
    var za = el.querySelector('#mf-zatc'); if (za) za.onchange = function () { setZ('atc', za.value); };
    var zb = el.querySelector('#mf-zbr'); if (zb) zb.onchange = function () { setZ('brand', zb.value); };
    var zi = el.querySelector('#mf-zit'); if (zi) zi.onchange = function () {
      var it = ((((r.scorecard || {}).zeta) || {}).items || []).find(function (i) { return i.item === zi.value; });
      ZF.key = segKey(r); ZF.item = zi.value; if (it) { ZF.brand = it.brand; ZF.atc = it.atc4; } overview(); };
    var zc = el.querySelector('#mf-zclr'); if (zc) zc.onclick = function () { ZF = { key: segKey(r), atc: '', brand: '', item: '' }; overview(); };
    el.querySelectorAll('tr.irow').forEach(function (tr) { tr.onclick = function (ev) {
      if (ev && ev.target && ev.target.closest && ev.target.closest('input')) return;
      var kind = tr.getAttribute('data-kind'), br = tr.getAttribute('data-br'), itn = tr.getAttribute('data-it');
      if (kind === 'item') { var it = ((((r.scorecard || {}).zeta) || {}).items || []).find(function (i) { return i.item === itn; }); if (!it) return; ZF = { key: segKey(r), atc: it.atc4, brand: it.brand, item: it.item }; }
      else if (kind === 'brand') { ZF = { key: segKey(r), atc: ZF.atc, brand: br, item: '' }; }
      else { ZF = { key: segKey(r), atc: ZF.atc, brand: '', item: '' }; }
      overview();
      goSec(ROOT.querySelector('#mf-ov .plan')); }; });
    var x1 = el.querySelector('#mf-xone'); if (x1) x1.onclick = function () { try { withMeasD(false, function () { exportOne(suSeg(r)); }); } catch (e) { console.error('[MarketForecast] export', e); alert('Excel export failed: ' + (e && e.message || e)); } };
    var xa = el.querySelector('#mf-xall'); if (xa) xa.onclick = function () { try { withMeasD(false, exportAll); } catch (e) { console.error('[MarketForecast] export', e); alert('Excel export failed: ' + (e && e.message || e)); } };
    var xp = el.querySelector('#mf-xpro'); if (xp) xp.onclick = function () { exportPro(r); };
    var xsf = el.querySelector('#mf-xsfe'); if (xsf) xsf.onclick = function () { exportSfeTpl(); };
    var xms = el.querySelector('#mf-xmsz'); if (xms) xms.onclick = function () { exportMktSizing(); };
    var xt = el.querySelector('#mf-xtbl'); if (xt) xt.onclick = function () { try { withMeasD(false, function () { exportTable(suSeg(r)); }); } catch (e) { console.error('[MarketForecast] export', e); alert('Excel export failed: ' + (e && e.message || e)); } };
    var xi = el.querySelector('#mf-ximp'); if (xi) xi.onchange = function () { importBex(xi.files && xi.files[0]); };
  }

  // ── Excel ──
  function xlsxOk() { if (typeof XLSX === 'undefined') { alert('Excel library not loaded (assets/xlsx.core.min.js).'); return false; } return true; }
  function fmtCells(ws, aoa, hdrRow, fmts, lastRow) {
    var end = lastRow == null ? aoa.length - 1 : lastRow;
    for (var r = hdrRow + 1; r <= end; r++) for (var c = 0; c < fmts.length; c++) { if (!fmts[c]) continue; var ref = XLSX.utils.encode_cell({ r: r, c: c }); if (ws[ref] && ws[ref].t === 'n') ws[ref].z = fmts[c]; }
  }
  function safeName(x) { return String(x).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 40); }
  function exportOne(r) {
    if (!xlsxOk()) return;
    var m = D.meta, Y = yearRows(r), P = Y.plan, C = Y.cagr, ty = m.target_year;
    var n = function (x) { return fin(x) ? x : null; }, p = function (x) { return fin(x) ? x / 100 : null; };
    var aoa = [['Market Growth Forecast — FY' + ty + ' plan'], ['Market', r.name], ['Level', (LEVELS.find(function (l) { return l[0] === r.type; }) || [0, r.type])[1]],
      ['Zeta product(s)', P.brands.join(', ') || '—'], ['Zeta selection', zfOn(r) ? 'ATC4: ' + (ZF.atc || 'all') + ' · Brand: ' + (ZF.brand || 'all') + ' · Item: ' + (ZF.item || 'all') + ' (market = whole market)' : 'All Zeta items in the market'], ['MAT period', matLbl() + ' (' + ((r.scorecard || {}).mat_label || '') + ')'], ['Zeta items', P.items.map(function (i) { return i.item; }).join(' · ') || '—'],
      ['Zeta strategy FY' + ty, P.present ? P.strategy + ' — ' + P.reason : P.reason], ['IQVIA data to', per(m.data_period)], ['Exported', new Date().toLocaleString()], [],
      (function (zn) { return ['Year', 'Basis', 'Market SU', 'Market growth (SU)', zn + ' SU', zn + ' growth (SU)', zn + ' share (SU)', 'Market value (EGP)', 'Market growth (value)', zn + ' value (EGP)', zn + ' growth (value)', zn + ' share (value)', 'Note']; })(zProd(r))];
    var hdr = aoa.length - 1;
    Y.rows.forEach(function (x) { if (x.empty) return; aoa.push([x.y, x.basis, n(x.msu), p(x.msug), n(x.zsu), p(x.zsug), n(x.zsush), n(x.mval), p(x.mvalg), n(x.zval), p(x.zvalg), n(x.zvalsh), x.note || '']); });
    aoa.push(['CAGR ' + C.hist.span, 'Actual (a year)', null, p(C.hist.msu), null, p(C.hist.zsu), null, null, p(C.hist.mval), null, p(C.hist.zval), null, C.hist.zspan && C.hist.zspan !== C.hist.span ? 'Zeta CAGR from its first full year ' + C.hist.zspan : '']);
    var lastYby = aoa.length - 1;
    aoa.push([]); aoa.push([zProd(r) + ' target FY' + ty, '', 'Share (SU)', zProd(r) + ' SU', zProd(r) + ' value (EGP)', 'Share (value)', 'Price per SU (EGP)', 'Growth vs ' + leLbl() + ' (SU)']);
    var t2 = aoa.length - 1;
    if (P.present) aoa.push(['System objective', P.strategy, n(P.objShare), n(P.objSU), n(P.objVal), n(P.objValShare), n(P.price), (function (L) { return L.su > 0 ? P.objSU / L.su - 1 : null; })(zLE(r, (zdata(r).ytd || {}).su, 0))]);
    if (P.bex && fin(P.bex.su)) aoa.push(['' + PN() + ' forecast (sum of items)', (P.bex.dirty ? 'UNSAVED ' : '') + (P.bex.saved ? 'saved ' + P.bex.saved : '') + (P.bex.mktEdited ? ' · ' + PN() + ' market ' + Math.round(P.bex.mkt) + ' SU' : ''), n(P.bex.share), n(P.bex.su), n(P.bex.val), n(P.bex.valShare), P.bex.su > 0 ? P.bex.val / P.bex.su : null, (function (L) { return L && L.su > 0 ? P.bex.su / L.su - 1 : null; })(bexLE(r) || zLE(r, (zdata(r).ytd || {}).su, 0))]);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    fmtCells(ws, aoa, hdr, [null, null, '#,##0', '0.0%', '#,##0', '0.0%', '0.0%', '#,##0', '0.0%', '#,##0', '0.0%', '0.0%'], lastYby);
    fmtCells(ws, aoa, t2, [null, null, '0.0%', '#,##0', '#,##0', '0.0%', '0.00', '0.0%']);
    ws['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 17 }, { wch: 12 }, { wch: 17 }, { wch: 12 }, { wch: 12 }, { wch: 40 }];
    var mm0 = (r.scorecard || {}).market_mat || {};
    var it = [['Level', 'Brand / item', 'Brand', 'ATC4', 'SU ' + matLbl(), 'Value ' + matLbl() + ' (EGP)', 'SU growth vs previous MAT', 'Market CAGR SU ' + mktCagr(r, 0).span, 'Zeta CAGR SU', 'Market CAGR value', 'Zeta CAGR value', 'Zeta CAGR period', 'Share (SU)', 'Share change (pts)', 'Price per SU (EGP, 6m)', 'Strategy', 'Objective share (SU)', 'Objective SU FY' + ty, 'Objective value FY' + ty + ' (EGP)', '' + PN() + ' share (SU)', '' + PN() + ' SU FY' + ty, '' + PN() + ' value FY' + ty + ' (EGP)', 'Defined market (DM1)', 'Defined market (DM2)']];
    var mc0 = mktCagr(r, 0), mc1 = mktCagr(r, 1);
    itemGroups(r).forEach(function (x) {
      var Q = x.P, sh = mm0.su > 0 ? x.mat[0] / mm0.su : null, shp = mm0.su_py > 0 ? x.mat[2] / mm0.su_py : null;
      it.push([x.kind === 'total' ? 'Total' : x.kind === 'brand' ? 'Brand total' : 'Item', x.label, x.kind === 'total' ? '' : x.brand, x.atc, x.mat[0], x.mat[1], x.mat[2] > 0 ? x.mat[0] / x.mat[2] - 1 : null, fin(mc0.pct) ? mc0.pct / 100 : null, fin(zCagr(x.years, 0).pct) ? zCagr(x.years, 0).pct / 100 : null, fin(mc1.pct) ? mc1.pct / 100 : null, fin(zCagr(x.years, 1).pct) ? zCagr(x.years, 1).pct / 100 : null, zCagr(x.years, 0).span, n(sh), fin(sh) && fin(shp) ? (sh - shp) * 100 : null, x.s6[0] > 0 ? x.s6[1] / x.s6[0] : null,
        Q.strategy, Q.present ? Q.objShare : null, n(Q.objSU), n(Q.objVal), Q.bex ? Q.bex.share : null, Q.bex ? n(Q.bex.su) : null, Q.bex ? n(Q.bex.val) : null, dmOf('DM1', rowItems(r, x)), dmOf('DM2', rowItems(r, x))]);
    });
    var ws2 = XLSX.utils.aoa_to_sheet(it); fmtCells(ws2, it, 0, [null, null, null, null, '#,##0', '#,##0', '0.0%', '0.0%', '0.0%', '0.0%', '0.0%', null, '0.00%', '+0.00;-0.00;0.00', '0.00', null, '0.00%', '#,##0', '#,##0', '0.00%', '#,##0', '#,##0']);
    ws2['!cols'] = [{ wch: 12 }, { wch: 40 }, { wch: 16 }, { wch: 30 }].concat(it[0].slice(4).map(function () { return { wch: 16 }; }));
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Market plan FY' + ty); XLSX.utils.book_append_sheet(wb, ws2, 'Zeta by brand & item');
    XLSX.writeFile(wb, 'Market_Plan_FY' + ty + '_' + safeName(r.name) + (zfOn(r) ? '_' + safeName(zSelLabel(r)) : '') + '.xlsx', { compression: true });
  }
  // 2026-10-15 (Ahmed): full "By brand and item" table — every Zeta brand and item, ATC4/brand/item filters ignored
  function tableRows(r, lvlName) {
    var keep = ZF, off = ZF_OFF, out = [];
    ZF_OFF = false; ZF = { key: segKey(r), atc: '', brand: '', item: '' };
    try {
      var mm = (r.scorecard || {}).market_mat || {}, mc0 = mktCagr(r, 0), mc1 = mktCagr(r, 1), st = bexSaved(r), dirty = bexDirty(r), d = bexDraft(r);
      var n = function (x) { return fin(x) ? x : null; };
      var bstat = dirty ? 'Unsaved' : st && st.saved ? 'Saved ' + st.saved + (st.by ? ' by ' + st.by : '') : '';
      itemGroups(r).forEach(function (x) {
        var Q = x.P, B = Q.bex && fin(Q.bex.su) ? Q.bex : null, z0 = zCagr(x.years, 0), z1 = zCagr(x.years, 1);
        var sh = mm.su > 0 ? x.mat[0] / mm.su : null, shp = mm.su_py > 0 ? x.mat[2] / mm.su_py : null, shv = mm.val > 0 ? x.mat[1] / mm.val : null;
        var its = rowItems(r, x);
        out.push([lvlName, r.name, x.kind === 'total' ? 'Total' : x.kind === 'brand' ? 'Brand total' : 'Item', x.label, x.kind === 'total' ? '' : x.brand, x.atc, dmOf('DM1', its), dmOf('DM2', its),
          x.mat[0], x.mat[1], x.mat[2] > 0 ? x.mat[0] / x.mat[2] - 1 : null, x.mat[3] > 0 ? x.mat[1] / x.mat[3] - 1 : null,
          fin(mc0.pct) ? mc0.pct / 100 : null, fin(z0.pct) ? z0.pct / 100 : null, fin(mc1.pct) ? mc1.pct / 100 : null, fin(z1.pct) ? z1.pct / 100 : null, z0.span,
          n(sh), n(shv), fin(sh) && fin(shp) ? (sh - shp) * 100 : null, x.s6[0] > 0 ? x.s6[1] / x.s6[0] : null,
          Q.present ? Q.strategy : 'Not present', Q.present ? Q.objShare : null, Q.present ? n(Q.objSU) : null, Q.present ? n(Q.objVal) : null,
          fin((r.forecast || {}).fy_target) ? r.forecast.fy_target : null, fin((r.forecast || {}).growth_vs_le_pct) ? r.forecast.growth_vs_le_pct / 100 : null,
          fin((r.value || {}).fy_target) ? r.value.fy_target : null, fin((r.value || {}).growth_vs_le_pct) ? r.value.growth_vs_le_pct / 100 : null, fin(d.mkt) ? d.mkt : null,
          B ? n(B.share) : null, B ? n(B.su) : null, B ? n(B.val) : null, B ? bstat : '',
          (function (L) { return n(L.su); })(zLE(r, (x.ytd || [0, 0])[0], (x.ytd || [0, 0])[1])), (function (L) { return n(L.val); })(zLE(r, (x.ytd || [0, 0])[0], (x.ytd || [0, 0])[1])),
          n(bexGrowth(r, x, 0)), n(bexGrowth(r, x, 1)),
          n(mm.su), n(mm.val), mm.su_py > 0 ? mm.su / mm.su_py - 1 : null, mm.val_py > 0 ? mm.val / mm.val_py - 1 : null,
          x.kind === 'item' ? (x.packs || []).join(' | ') : '']);
      });
    } finally { ZF = keep; ZF_OFF = off; }
    return out;
  }
  function exportTable(r) {
    if (!xlsxOk()) return;
    var m = D.meta, ty = m.target_year, lv = (LEVELS.find(function (l) { return l[0] === r.type; }) || [0, r.type])[1];
    var H = ['Level', 'Market', 'Row', 'Brand / item', 'Brand', 'ATC4', 'Defined market (DM1)', 'Defined market (DM2)', 'SU ' + matLbl(), 'Value ' + matLbl() + ' (EGP)', 'SU growth vs previous MAT', 'Value growth vs previous MAT',
      'Market CAGR SU ' + mktCagr(r, 0).span, 'Zeta CAGR SU', 'Market CAGR value', 'Zeta CAGR value', 'Zeta CAGR period',
      'Share (SU)', 'Share (value)', 'Share change SU (pts)', 'Price per SU (EGP, 6m)',
      'Strategy', 'Objective share (SU)', 'Objective SU FY' + ty, 'Objective value FY' + ty + ' (EGP)',
      'Market SU FY' + ty + ' (forecast)', 'Market growth SU FY' + ty + ' vs ' + m.partial_year, 'Market value FY' + ty + ' (forecast, EGP)', 'Market growth value FY' + ty + ' vs ' + m.partial_year, '' + PN() + ' market SU FY' + ty + ' (if edited)', '' + PN() + ' share (SU)', '' + PN() + ' SU FY' + ty, '' + PN() + ' value FY' + ty + ' (EGP)', '' + PN() + ' status',
      'SU ' + leLbl(), 'Value ' + leLbl() + ' (EGP)', '' + PN() + ' growth SU FY' + ty + ' vs ' + m.partial_year, '' + PN() + ' growth value FY' + ty + ' vs ' + m.partial_year, 'Market SU ' + matLbl(), 'Market value ' + matLbl() + ' (EGP)', 'Market growth SU vs previous MAT', 'Market growth value vs previous MAT', 'Packs (IQVIA items)'];
    var F = [null, null, null, null, null, null, null, null, '#,##0', '#,##0', '0.0%', '0.0%', '0.0%', '0.0%', '0.0%', '0.0%', null, '0.00%', '0.00%', '+0.00;-0.00;0.00', '0.00', null, '0.00%', '#,##0', '#,##0', '#,##0', '0.0%', '#,##0', '0.0%', '#,##0', '0.00%', '#,##0', '#,##0', null, '#,##0', '#,##0', '0.0%', '0.0%', '#,##0', '#,##0', '0.0%', '0.0%'];
    var mkSheet = function (aoa) {
      var ws = XLSX.utils.aoa_to_sheet(aoa); fmtCells(ws, aoa, 0, F);
      ws['!cols'] = H.map(function (h, i) { return { wch: i === 1 ? 32 : i === 3 ? 42 : i === 5 || i === 6 || i === 7 ? 28 : Math.max(11, Math.min(22, h.length + 2)) }; });
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, aoa.length - 1), c: H.length - 1 } }) };
      ws['!freeze'] = { xSplit: 4, ySplit: 1 }; return ws;
    };
    var one = [H].concat(tableRows(r, lv));
    var all = [H];
    segs(r.type).slice().sort(function (a, b) { return (((b.scorecard || {}).zeta || {}).mat || {}).su - (((a.scorecard || {}).zeta || {}).mat || {}).su || 0; })
      .forEach(function (q) { all = all.concat(tableRows(q, lv)); });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, mkSheet(one), 'This market');
    XLSX.utils.book_append_sheet(wb, mkSheet(all), 'All markets - ' + safeName(r.type).slice(0, 18));
    var note = [['Full brand & item table — FY' + ty], ['Market', r.name], ['Level', lv],
      ['Rows', 'Total = all Zeta in the market · Brand total = sum of its items · Item = one Zeta pack. ATC4 / brand / item filters on the page are ignored: every Zeta product is included.'],
      ['Sheet "All markets"', 'Every ' + lv + ' market with Zeta sales, same columns; use the filter arrows to pick a market, brand or item.'],
      ['Share', 'Share of the whole market (SU or value), ' + matLbl() + '.'],
      ['Defined market', 'The IQVIA defined market (DM1 / DM2) each Zeta item belongs to; brand and total rows list the defined markets of their items.'],
      ['Market MAT', 'Market SU / value and growth = the market in column "Market" (' + matLbl() + ' vs the previous 12 months). ' + m.partial_year + ' full year (estimate) = actual ' + (r.ytd.months || 'YTD') + ' + remaining months at the row\'s YTD share of the market landing estimate. ' + PN() + ' growth = ' + PN() + ' FY' + ty + ' vs that ' + m.partial_year + ' estimate; brand / total rows compare like-for-like (only the items that have a ' + PN() + ' share).'],
      ['Objective', 'Defend = biggest brand, >= ' + (OBJ_RULES.dominant * 100) + '% share, or lost >= ' + Math.abs(OBJ_RULES.losing) + ' pts -> hold share. Grow = add the latest MAT share gain (min +' + OBJ_RULES.gainMin + ' pts or +25% of a small share; max +' + OBJ_RULES.gainMax + ' pts or double the share).'],
      ['' + PN() + '', 'Item ' + PN() + ' SU = ' + PN() + ' share x market forecast (or ' + PN() + ' market if edited). Value = SU x the item\'s own price per SU (last 6 months). Brand and total = sum of items. "Unsaved" = typed but not saved yet.'],
      ['IQVIA data to', per(m.data_period)], ['Exported', new Date().toLocaleString()]];
    var wn = XLSX.utils.aoa_to_sheet(note); wn['!cols'] = [{ wch: 20 }, { wch: 120 }];
    XLSX.utils.book_append_sheet(wb, wn, 'Read me');
    XLSX.writeFile(wb, 'Zeta_Brand_Item_FY' + ty + '_' + safeName(r.name) + '.xlsx', { compression: true });
  }

  // ── 2026-10-16 (Ahmed): PROFESSIONAL EXCEL v2 — Summary + SU sheet + Value sheet (+ all markets, notes) ──
  // "Best-practice formula option if I need to change any value": a driver model.
  //   INPUTS (yellow fill, blue numbers): <title> market FY+1 (SU), price change % (value), per item objective share
  //   and <title> share. Everything in the plan columns, brand / total rows, year-by-year plan rows and the Summary
  //   is an Excel FORMULA on those inputs. Actuals (MAT, history, 2026 estimate) are values.
  // Styled with ExcelJS (assets/exceljs.min.js, MIT, loaded only when the button is clicked).
  // NOTE: ExcelJS writes <sheetPr> children in an order Excel rejects when outlineProperties AND fitToPage are both
  // set -> never set outlineProperties (2026-10-16 "Repairs ... sheet2.xml" incident).
  var EXJS_SRC = 'assets/exceljs.min.js?v=4.4.0';
  function loadExcelJS(cb) {
    if (window.ExcelJS) return cb();
    var sc = document.createElement('script'); sc.src = EXJS_SRC;
    sc.onload = function () { if (window.ExcelJS) cb(); else alert('Excel styling library did not load (assets/exceljs.min.js).'); };
    sc.onerror = function () { alert('Could not load assets/exceljs.min.js — the professional Excel needs it in the dashboard folder.'); };
    document.head.appendChild(sc);
  }
  function withAll(r, fn) { var keep = ZF, off = ZF_OFF; ZF_OFF = false; ZF = { key: segKey(r), atc: '', brand: '', item: '' }; try { return fn(); } finally { ZF = keep; ZF_OFF = off; } }
  var XC = { navy: 'FF0F4C81', navyL: 'FFE8F0F7', tot: 'FFD6E4F0', plan: 'FFFFF4D6', planH: 'FFB7791F', obj: 'FFF1F5F9', grey: 'FF64748B', line: 'FFCBD5E1', white: 'FFFFFFFF', ink: 'FF0F172A', sec: 'FF1E3A5F', inFill: 'FFFFF2CC', inFont: 'FF1D4ED8', mkt: 'FFEEF2FF' };
  var XF = { n: '#,##0', p1: '0.0%', p2: '0.00%', g: '+0.0%;[Red]-0.0%;0.0%', pts: '+0.00;[Red]-0.00;0.00', d: '+#,##0;[Red]-#,##0;0', px: '#,##0.00' };
  function xFill(c) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: c } }; }
  function xBorder(c) { var b = { style: 'thin', color: { argb: c || XC.line } }; return { top: b, left: b, bottom: b, right: b }; }
  function colN(c) { var n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + c.charCodeAt(i) - 64; return n; }
  function colL(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function qs(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }

  // 2026-10-18 (Ahmed: "why data not written in Excel when I download"): a downloaded file opens in Protected View,
  // where Excel shows only the values saved in the file and does not calculate. Some formula cells (plan rows of the
  // year table, Summary plan lines, growth bridge) were written without a saved value, so they looked empty.
  // xFillCache() computes those values before saving: a small evaluator for the formula subset these workbooks use
  // (cell refs incl. other sheets, + - * / &, comparisons, IF, IFERROR, OR). Anything else is left to Excel.
  function xFillCache(wb) {
    var BL = { blank: true }, ER = function (c) { return { err: c }; }, isE = function (v) { return v && v.err; };
    var colN = function (c) { var n = 0; for (var i = 0; i < c.length; i++) n = n * 26 + c.charCodeAt(i) - 64; return n; };
    var PEND = {};
    function cellVal(ws, addr) {
      var m = /^\$?([A-Z]+)\$?(\d+)$/.exec(addr); if (!m) throw PEND;
      var v = ws.getRow(+m[2]).getCell(colN(m[1])).value;
      if (v == null || v === '') return BL;
      if (typeof v === 'object' && !(v instanceof Date)) {
        if (v.formula != null || v.sharedFormula != null) { if (v.result === undefined) throw PEND; return v.result === '' ? '' : (v.result && v.result.error ? ER(v.result.error) : v.result); }
        if (v.richText) return v.richText.map(function (t) { return t.text; }).join('');
        if (v.text != null) return v.text;
        return BL;
      }
      return v;
    }
    function tok(f) {
      var t = [], i = 0, m;
      while (i < f.length) {
        var c = f[i];
        if (c === ' ') { i++; continue; }
        if (c === '"') { var j = i + 1, s = ''; while (j < f.length) { if (f[j] === '"') { if (f[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += f[j++]; } t.push({ k: 's', v: s }); i = j + 1; continue; }
        if ((m = /^('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_ .()]*?)!(\$?[A-Z]+\$?\d+)(?![:A-Za-z0-9])/.exec(f.slice(i)))) { var sh = m[1].replace(/^'|'$/g, '').replace(/''/g, "'"); t.push({ k: 'r', sh: sh, a: m[2] }); i += m[0].length; continue; }
        if ((m = /^\$?[A-Z]{1,3}\$?\d+(?![:A-Za-z0-9(])/.exec(f.slice(i)))) { t.push({ k: 'r', a: m[0] }); i += m[0].length; continue; }
        if ((m = /^\d+(\.\d+)?(E[+-]?\d+)?/i.exec(f.slice(i)))) { t.push({ k: 'n', v: +m[0] }); i += m[0].length; continue; }
        if ((m = /^[A-Z][A-Z0-9.]*(?=\()/.exec(f.slice(i)))) { t.push({ k: 'f', v: m[0] }); i += m[0].length; continue; }
        if ((m = /^(<=|>=|<>|[-+*\/&=<>(),%])/.exec(f.slice(i)))) { t.push({ k: 'o', v: m[0] }); i += m[0].length; continue; }
        throw PEND;   // ranges, unknown syntax
      }
      return t;
    }
    function evalF(ws, f) {
      var t = tok(f), p = 0;
      var peek = function () { return t[p]; }, eat = function (v) { if (t[p] && t[p].v === v) { p++; return true; } return false; };
      var num = function (v) { if (isE(v)) throw v; if (v === BL || v === '') return 0; if (typeof v === 'number') return v; if (typeof v === 'boolean') return v ? 1 : 0; var n = +v; if (isNaN(n)) throw ER('#VALUE!'); return n; };
      var str = function (v) { if (isE(v)) throw v; if (v === BL) return ''; if (typeof v === 'number') return String(+v.toPrecision(15)); if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'; return String(v); };
      function cmpV(a, b, op) {
        if (isE(a)) throw a; if (isE(b)) throw b;
        if (a === BL) a = typeof b === 'number' ? 0 : ''; if (b === BL) b = typeof a === 'number' ? 0 : '';
        var r; if (typeof a === 'number' && typeof b === 'number') r = a - b; else if (typeof a === 'string' && typeof b === 'string') r = a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0; else r = typeof a === 'number' ? -1 : 1;
        return op === '=' ? r === 0 : op === '<>' ? r !== 0 : op === '<' ? r < 0 : op === '>' ? r > 0 : op === '<=' ? r <= 0 : r >= 0;
      }
      function E0() { var a = E1(); while (peek() && /^(=|<>|<=|>=|<|>)$/.test(peek().v) && peek().k === 'o') { var op = t[p++].v; a = cmpV(a, E1(), op); } return a; }
      function E1() { var a = E2(); while (peek() && peek().v === '&' && peek().k === 'o') { p++; a = str(a) + str(E2()); } return a; }
      function E2() { var a = E3(); while (peek() && peek().k === 'o' && (peek().v === '+' || peek().v === '-')) { var op = t[p++].v, b = E3(); a = op === '+' ? num(a) + num(b) : num(a) - num(b); } return a; }
      function E3() { var a = E4(); while (peek() && peek().k === 'o' && (peek().v === '*' || peek().v === '/')) { var op = t[p++].v, b = E4(); if (op === '*') a = num(a) * num(b); else { var d = num(b); if (d === 0) throw ER('#DIV/0!'); a = num(a) / d; } } return a; }
      function E4() { if (peek() && peek().k === 'o' && peek().v === '-') { p++; return -num(E4()); } if (peek() && peek().k === 'o' && peek().v === '+') { p++; return num(E4()); } var v = E5(); if (peek() && peek().v === '%' && peek().k === 'o') { p++; v = num(v) / 100; } return v; }
      function args() { var a = []; if (eat(')')) return a; for (;;) { a.push(p); skip(); if (eat(',')) continue; if (eat(')')) return a; throw PEND; } }
      function skip() { var d = 0; while (p < t.length) { var x = t[p]; if (x.k === 'o' && x.v === '(') d++; else if (x.k === 'o' && x.v === ')') { if (d === 0) return; d--; } else if (x.k === 'o' && x.v === ',' && d === 0) return; p++; } }
      function at(pos) { var keep = p; p = pos; try { return E0(); } finally { p = keep; } }
      function E5() {
        var x = t[p++]; if (!x) throw PEND;
        if (x.k === 'n') return x.v; if (x.k === 's') return x.v;
        if (x.k === 'r') { var w2 = x.sh ? wb.getWorksheet(x.sh) : ws; if (!w2) throw PEND; return cellVal(w2, x.a); }
        if (x.k === 'o' && x.v === '(') { var v = E0(); if (!eat(')')) throw PEND; return v; }
        if (x.k === 'f') {
          p++;   // '('
          var A = args(), fn = x.v;
          var safe = function (pos) { try { return at(pos); } catch (e) { if (e === PEND) throw e; return isE(e) ? e : ER('#VALUE!'); } };
          if (fn === 'IF') { var c = safe(A[0]); if (isE(c)) return c; var tr = c === BL ? false : typeof c === 'number' ? c !== 0 : typeof c === 'boolean' ? c : (function () { throw ER('#VALUE!'); })(); return tr ? (A.length > 1 ? safe(A[1]) : true) : (A.length > 2 ? safe(A[2]) : false); }
          if (fn === 'IFERROR') { var v1 = safe(A[0]); return isE(v1) ? safe(A[1]) : v1; }
          if (fn === 'OR' || fn === 'AND') { var any = false, all = true; A.forEach(function (q) { var v2 = safe(q); if (isE(v2)) throw v2; var b = v2 === BL ? false : typeof v2 === 'number' ? v2 !== 0 : !!v2; any = any || b; all = all && b; }); return fn === 'OR' ? any : all; }
          throw PEND;
        }
        throw PEND;
      }
      var r;
      try { r = E0(); if (p < t.length) throw PEND; } catch (e) { if (e === PEND) throw e; r = isE(e) ? e : ER('#VALUE!'); }
      return r;
    }
    for (var pass = 0; pass < 6; pass++) {
      var done = 0;
      wb.eachSheet(function (ws) {
        ws.eachRow({ includeEmpty: false }, function (row) {
          row.eachCell({ includeEmpty: false }, function (cell) {
            var v = cell.value;
            if (!v || typeof v !== 'object' || v.formula == null || v.result !== undefined) return;
            try {
              var res = evalF(ws, v.formula);
              if (isE(res)) return;   // leave errors to Excel
              cell.value = { formula: v.formula, result: res === BL ? 0 : res };
              done++;
            } catch (e) { /* pending or unsupported: Excel calculates it when editing is enabled */ }
          });
        });
      });
      if (!done) break;
    }
  }
  function fx(f, res) { return (fin(res) || (typeof res === 'string' && res !== '')) ? { formula: f, result: res } : { formula: f }; }
  function xInput(cell, fmt, kind) {
    cell.fill = xFill(XC.inFill); cell.font = { size: 10, bold: true, color: { argb: XC.inFont } }; if (fmt) cell.numFmt = fmt;
    cell.border = xBorder('FFB45309');
    if (kind === 'share') cell.dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 1], showErrorMessage: true, errorTitle: 'Share', error: 'Enter a share between 0% and 100% (e.g. 4.5%).' };
    if (kind === 'gr') cell.dataValidation = { type: 'decimal', operator: 'between', allowBlank: false, formulae: [-0.95, 20], showErrorMessage: true, errorTitle: 'Market growth', error: 'Enter the market growth as a % (e.g. 12% or -5%).' };
    if (kind === 'zg') cell.dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [-1, 20], showErrorMessage: true, errorTitle: 'Zeta growth', error: 'Enter the Zeta growth as a % (e.g. 15% or -5%), or leave it empty to use the share.' };
    if (kind === 'pct') cell.dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [-0.5, 2], showErrorMessage: true, errorTitle: 'Price change', error: 'Enter a % between -50% and +200%.' };
    if (kind === 'num') cell.dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: false, formulae: [0], showErrorMessage: true, errorTitle: 'Market', error: 'Enter a number (Standard Units).' };
  }
  // columns of the brand / item table. val(x,c) = number written / cached; f(x,c,R) = Excel formula (no "=")
  function proCols(k, ty, py, lvl) {
    var UP = lvl === 'DM2' ? 'DM1' : 'DM2';
    var U = k ? ' (EGP)' : ' (SU)', n = function (v) { return fin(v) ? v : null; }, f = function (pp) { return fin(pp) ? pp / 100 : null; }, mk = k ? 'val' : 'su', pn = PN();
    var bx = function (x) { var B = x.P && x.P.bex; return B && fin(B.su) ? B : null; };
    var est = function (x, c) { var L = zLE(c.r, (x.ytd || [0, 0])[0], (x.ytd || [0, 0])[1]); return n(L[mk]); };
    var obj = function (x) { return x.P && x.P.present ? n(k ? x.P.objVal : x.P.objSU) : null; };
    var agg = function (x) { return x.kind !== 'item'; };
    var nI = function (R) { return 'COUNTIFS(' + R.rng('lvl') + ',"Item",' + R.rng('pfc') + ',">=0")'; }, NI = function (R) { return 'COUNTIF(' + R.rng('lvl') + ',"Item")'; };
    var C = [
      { key: 'lbl', h: 'Brand / item', w: 44, val: function (x) { return x.label; } },
      { key: 'lvl', h: 'Level', w: 8, val: function (x) { return x.kind === 'total' ? 'Total' : x.kind === 'brand' ? 'Brand' : 'Item'; } },
      { key: 'atc', h: 'ATC4', w: 9, val: function (x) { return / ATC4$/.test(x.atc || '') ? x.atc : (x.atc || '').split(' ')[0]; } },
      { key: 'bu', h: 'Business unit', w: 16, val: function (x, c) { return orgOf('BU', (dmOf('DM1', rowItems(c.r, x)) || '').split(' / ').filter(Boolean)); } },
      { key: 'line', h: 'Line', w: 18, val: function (x, c) { return orgOf('Line', (dmOf('DM1', rowItems(c.r, x)) || '').split(' / ').filter(Boolean)); } },
      { key: 'dm', h: 'Defined market (DM1)', w: 26, val: function (x, c) { var d = dmOf('DM1', rowItems(c.r, x)), a = d ? d.split(' / ') : []; return a.length > 2 ? a.length + ' defined markets' : d; } },
      { key: 'dm2', h: 'Defined market (DM2)', w: 30, val: function (x, c) { var d = dmOf('DM2', rowItems(c.r, x)), a = d ? d.split(' / ') : []; return a.length > 2 ? a.length + ' DM2 markets' : d; } },
      // 2026-10-19 (Ahmed: "I need to see the ELEMBOSIS total market in DM2 APIXPAN LOW DOSE / 5 MG and NEXICURE PLUS SACH / CAPS"):
      // the DM2 market(s) of the row next to its DM2 name. Brand rows spanning several DM2 = sum of those DM2 markets.
      // Blank on a DM2 workbook (the market columns are already the DM2 market there).
      { key: 'd2mat', h: UP + ' market ' + matLbl() + U, w: 15, fmt: XF.n, cls: 'mkt', val: function (x, c) { return dm2Mkt(c.r, x, k, 'mat'); } },
      { key: 'd2le', h: UP + ' market ' + py + ' (estimate)' + U, w: 15, fmt: XF.n, cls: 'mkt', val: function (x, c) { return dm2Mkt(c.r, x, k, 'le'); } },
      { key: 'd2fc', h: UP + ' market FY' + ty + ' — system forecast' + U, w: 15, fmt: XF.n, cls: 'mkt', val: function (x, c) { return dm2Mkt(c.r, x, k, 'fc'); } },
      { key: 'd2g', h: UP + ' market growth FY' + ty + ' vs ' + py, w: 12, fmt: XF.g, cls: 'mkt', val: function (x, c) { var a = dm2Mkt(c.r, x, k, 'fc'), b = dm2Mkt(c.r, x, k, 'le'); return fin(a) && b > 0 ? a / b - 1 : null; },
        f: function (x, c, R) { return 'IF(OR(' + R.ref('d2fc') + '="",' + R.ref('d2le') + '=""),"",IFERROR(' + R.ref('d2fc') + '/' + R.ref('d2le') + '-1,""))'; } },
      { key: 'd2sh', h: 'Zeta share of ' + UP + ' market ' + matLbl(), w: 11, fmt: XF.p2, val: function (x, c) { var m = dm2Mkt(c.r, x, k, 'mat'); return m > 0 && fin(x.mat[k]) ? x.mat[k] / m : null; } },
      { key: 'mmat', h: 'Market ' + matLbl() + U, w: 15, fmt: XF.n, val: function (x, c) { return n(c.mm[mk]); } },
      { key: 'mg', h: 'Market growth vs previous MAT', w: 12, fmt: XF.g, val: function (x, c) { return c.mm[mk + '_py'] > 0 ? c.mm[mk] / c.mm[mk + '_py'] - 1 : null; } },
      { key: 'zmat', h: 'Zeta ' + matLbl() + U, w: 15, fmt: XF.n, val: function (x) { return n(x.mat[k]); } },
      { key: 'zg', h: 'Zeta growth vs previous MAT', w: 12, fmt: XF.g, val: function (x) { return x.mat[k + 2] > 0 ? x.mat[k] / x.mat[k + 2] - 1 : null; } },
      { key: 'sh', h: 'Share ' + matLbl(), w: 10, fmt: XF.p2, val: function (x, c) { return c.mm[mk] > 0 ? x.mat[k] / c.mm[mk] : null; } },
      { key: 'shc', h: 'Share change (pts)', w: 10, fmt: XF.pts, val: function (x, c) { return c.mm[mk] > 0 && c.mm[mk + '_py'] > 0 ? (x.mat[k] / c.mm[mk] - x.mat[k + 2] / c.mm[mk + '_py']) * 100 : null; } },
      { key: 'mcagr', h: 'Market CAGR {MC}', w: 11, fmt: XF.g, val: function (x, c) { return f(c.mc.pct); } },
      { key: 'zcagr', h: 'Zeta CAGR', w: 10, fmt: XF.g, val: function (x) { return f(zCagr(x.years, k).pct); } },
      { key: 'est', h: 'Zeta ' + py + ' (estimate)' + U, w: 15, fmt: XF.n, val: est },
      { key: 'mle', h: 'Market ' + py + ' (estimate)' + U, w: 15, fmt: XF.n, cls: 'mkt', val: function (x, c) { return n(c.mle); }, f: function (x, c) { return c.mleRef; } },
      { key: 'msys', h: 'Market FY' + ty + ' — system forecast' + U, w: 15, fmt: XF.n, cls: 'mkt', val: function (x, c) { return n(c.msys); }, f: function (x, c) { return c.msysRef; } },
      { key: 'mfc', h: 'Market FY' + ty + ' — ' + pn + ' view' + U, w: 15, fmt: XF.n, cls: 'mkt', val: function (x, c) { return n(c.mfc); }, f: function (x, c) { return c.mfcRef; } },
      { key: 'mfg', h: 'Market growth FY' + ty + ' vs ' + py, w: 12, fmt: XF.g, cls: 'mkt', val: function (x, c) { return fin(c.mfc) && c.mle > 0 ? c.mfc / c.mle - 1 : null; }, f: function (x, c, R) { return 'IFERROR(' + R.ref('mfc') + '/' + R.ref('mle') + '-1,"")'; } },
      k ? { key: 'price', h: 'Price per SU today (EGP)', w: 10, fmt: XF.px, val: function (x) { return x.kind === 'item' ? n(itemPrice(x)) : null; } } : null,
      { key: 'strat', h: 'Strategy', w: 10, val: function (x) { return x.P && x.P.present ? x.P.strategy : 'Not present'; } },
      { key: 'objsh', h: 'Objective share' + (k ? ' (value)' : ''), w: 10, fmt: XF.p2, cls: 'obj', inp: function (x) { return !k && x.kind === 'item'; },
        val: function (x) { return x.P && x.P.present ? n(k ? x.P.objValShare : x.P.objShare) : null; },
        f: function (x, c, R) { return k ? 'IF(' + R.ref('obj') + '="","",IFERROR(' + R.ref('obj') + '/(' + R.ref('msys') + '*(1+' + c.pRef + ')),""))' : agg(x) ? 'IF(' + R.ref('obj') + '="","",IFERROR(' + R.ref('obj') + '/' + R.ref('msys') + ',""))' : null; } },
      { key: 'obj', h: 'Objective FY' + ty + U, w: 15, fmt: XF.n, cls: 'obj', val: obj,
        f: function (x, c, R) {
          if (agg(x)) return 'IF(COUNTIFS(' + R.rng('lvl') + ',"Item",' + R.rng('obj') + ',">=0")=0,"",SUMIFS(' + R.rng('obj') + ',' + R.rng('lvl') + ',"Item"))';
          if (k) return 'IF(' + R.tw('obj') + '="","",' + R.tw('obj') + '*' + R.ref('price') + '*(1+' + c.pRef + '))';
          return 'IF(' + R.ref('objsh') + '="","",' + R.ref('objsh') + '*' + R.ref('msys') + ')';
        } },
      { key: 'objg', h: 'Objective growth vs ' + py, w: 12, fmt: XF.g, cls: 'obj', val: function (x, c) { var o = obj(x), e = est(x, c); return fin(o) && e > 0 ? o / e - 1 : null; },
        f: function (x, c, R) { return 'IF(' + R.ref('obj') + '="","",IFERROR(' + R.ref('obj') + '/' + R.ref('est') + '-1,""))'; } },
      { key: 'psh', h: pn + ' share' + (k ? ' (value)' : ''), w: 10, fmt: XF.p2, cls: 'plan', inp: function (x) { return !k && x.kind === 'item'; },
        val: function (x) { var B = bx(x); return B ? n(k ? B.valShare : B.share) : null; },
        f: function (x, c, R) { return (k || agg(x)) ? 'IF(' + R.ref('pfc') + '="","",IFERROR(' + R.ref('pfc') + '/' + R.ref('mfc') + ',""))' : null; } },
      { key: 'pfc', h: pn + ' forecast FY' + ty + U, w: 15, fmt: XF.n, cls: 'plan', val: function (x) { var B = bx(x); return B ? n(k ? B.val : B.su) : null; },
        f: function (x, c, R) {
          if (agg(x)) return 'IF(' + nI(R) + '=0,"",SUMIFS(' + R.rng('pfc') + ',' + R.rng('lvl') + ',"Item"))';
          if (k) return 'IF(' + R.tw('pfc') + '="","",' + R.tw('pfc') + '*' + R.ref('price') + '*(1+' + c.pRef + '))';
          return 'IF(' + R.ref('psh') + '="","",' + R.ref('psh') + '*' + R.ref('mfc') + ')';
        } },
      { key: 'pd2', h: pn + ' share of ' + UP + ' market', w: 11, fmt: XF.p2, cls: 'plan', val: function (x, c) { var B = bx(x), m = dm2Mkt(c.r, x, k, 'fc'), sc = fin(c.mfc) && c.msys > 0 ? c.mfc / c.msys : 1; return B && m > 0 && fin(k ? B.val : B.su) ? (k ? B.val : B.su) / (m * sc) : null; },
        // DM2 market moves with the plan's market view (same % as the DM1 market edit), like the DM2 page
        f: function (x, c, R) { return 'IF(OR(' + R.ref('pfc') + '="",' + R.ref('d2fc') + '=""),"",IFERROR(' + R.ref('pfc') + '/(' + R.ref('d2fc') + '*' + R.ref('mfc') + '/' + R.ref('msys') + '),""))'; } },
      { key: 'pg', h: pn + ' growth vs ' + py, w: 12, fmt: XF.g, cls: 'plan', val: function (x, c) { return bx(x) ? n(bexGrowth(c.r, x, k)) : null; },
        f: function (x, c, R) {
          return agg(x) ? 'IF(' + R.ref('pfc') + '="","",IFERROR(' + R.ref('pfc') + '/SUMPRODUCT((' + R.rng('lvl') + '="Item")*ISNUMBER(' + R.rng('pfc') + ')*' + R.rng('est') + ')-1,""))'
            : 'IF(' + R.ref('pfc') + '="","",IFERROR(' + R.ref('pfc') + '/' + R.ref('est') + '-1,""))';
        } },
      { key: 'pvo', h: pn + ' vs objective' + U, w: 14, fmt: XF.d, cls: 'plan', val: function (x) { var B = bx(x), o = obj(x); return B && fin(o) && (x.kind === 'item' || B.n >= B.nItems) ? (k ? B.val : B.su) - o : null; },
        f: function (x, c, R) { return 'IF(OR(' + R.ref('pfc') + '="",' + R.ref('obj') + '=""' + (agg(x) ? ',' + nI(R) + '<' + NI(R) : '') + '),"",' + R.ref('pfc') + '-' + R.ref('obj') + ')'; } },
      { key: 'pitems', h: pn + ' items planned', w: 10, cls: 'plan', val: function (x) { var B = bx(x), N = B ? B.nItems : (x.n || 0); return agg(x) && N > 0 ? (B ? B.n : 0) + ' of ' + N : ''; },
        f: function (x, c, R) { return agg(x) ? 'IF(' + NI(R) + '=0,"",' + nI(R) + '&" of "&' + NI(R) + ')' : null; } },
      { key: 'packs', h: 'Packs (IQVIA items)', w: 30, val: function (x) { return x.kind === 'item' ? (x.packs || []).join(' | ') : ''; } }
    ];
    return C.filter(Boolean);
  }
  function proCtx(r, k) {
    var sc = r.scorecard || {}, f = r.forecast || {}, vv = r.value || {};
    return { r: r, mm: sc.market_mat || {}, mc: mktCagr(r, k), mle: k ? vv.fy_le : f.fy_le, msys: k ? vv.fy_target : f.fy_target, mfg: k ? vv.growth_vs_le_pct : f.growth_vs_le_pct };
  }
  function xHeader(ws, row, cols, off) {
    var R = ws.getRow(row);
    cols.forEach(function (c, i) {
      var cell = R.getCell(i + 1 + (off || 0)); cell.value = c.h;
      cell.font = { bold: true, color: { argb: XC.white }, size: 10 };
      cell.fill = xFill(c.cls === 'plan' ? XC.planH : c.cls === 'mkt' ? 'FF3B5B8C' : XC.navy);
      cell.alignment = { wrapText: true, vertical: 'middle', horizontal: i === 0 && !off ? 'left' : 'center' };
      cell.border = xBorder(XC.navy);
    });
    R.height = 44;
  }
  // writes the brand / item rows of market r; returns { next, top, L } (top = first data row = Total or the only brand)
  function xTableRows(ws, row, r, k, cols, c, opt) {
    opt = opt || {};
    var G = withAll(r, function () { return itemGroups(r); }), off = opt.prefix ? 1 : 0, L = {}, first = row, last = row + G.length - 1;
    cols.forEach(function (cc, i) { L[cc.key] = colL(i + 1 + off); });
    G.forEach(function (x, gi) {
      var rr = row + gi, a = rr, b = rr;
      if (x.kind === 'total') { a = first; b = last; }
      else if (x.kind === 'brand') { a = rr + 1; b = rr; for (var j = gi + 1; j < G.length && G[j].kind === 'item'; j++) b = row + j; }
      var R = { ref: function (key) { return L[key] + rr; }, rng: function (key) { return '$' + L[key] + '$' + a + ':$' + L[key] + '$' + b; }, tw: function (key) { return qs(opt.twin) + '!' + (opt.twinL || L)[key] + rr; } };
      var Row = ws.getRow(rr);
      if (off) { var c0 = Row.getCell(1); c0.value = opt.prefix; c0.font = { color: { argb: XC.grey }, size: 9 }; c0.border = xBorder(); }
      cols.forEach(function (cc, i) {
        var v = cc.val ? cc.val(x, c) : null, fml = cc.f ? cc.f(x, c, R) : null, cell = Row.getCell(i + 1 + off);
        cell.value = fml ? fx(fml, v) : (v === '' || v == null ? null : v);
        if (cc.fmt) cell.numFmt = cc.fmt;
        cell.border = xBorder();
        cell.font = { size: 10, bold: x.kind !== 'item', color: { argb: XC.ink } };
        if (x.kind === 'total') cell.fill = xFill(XC.tot); else if (x.kind === 'brand') cell.fill = xFill(XC.navyL);
        else if (cc.cls === 'plan') cell.fill = xFill(XC.plan); else if (cc.cls === 'obj') cell.fill = xFill(XC.obj); else if (cc.cls === 'mkt') cell.fill = xFill(XC.mkt);
        if (cc.inp && cc.inp(x)) xInput(cell, cc.fmt, 'share');
        if (i === 0) cell.alignment = { indent: x.kind === 'item' ? 2 : 0 };
      });
      if (x.kind === 'item') Row.outlineLevel = off ? 2 : 1; else if (x.kind === 'brand' && off) Row.outlineLevel = 1;
    });
    return { next: row + G.length, top: first, L: L };
  }
  function xSection(ws, row, txt) {
    var c = ws.getRow(row).getCell(1); c.value = txt; c.font = { bold: true, size: 12, color: { argb: XC.sec } };
    ws.getRow(row).height = 20; return row + 1;
  }
  // year-by-year rows; returns row numbers so the plan rows can be linked to the table afterwards
  function xYears(ws, row, r, k) {
    var Y = withAll(r, function () { return yearRows(r); }), zn = withAll(r, function () { return zProd(r); }), U = k ? ' (EGP)' : ' (SU)', out = { est: 0, obj: 0, plan: 0 };
    var H = [{ h: 'Year' }, { h: 'Basis' }, { h: 'Market' + U, fmt: XF.n }, { h: 'Market growth', fmt: XF.g }, { h: zn + U, fmt: XF.n }, { h: 'Zeta growth', fmt: XF.g }, { h: 'Zeta share', fmt: XF.p2 }, { h: 'Note' }];
    xHeader(ws, row, H); row++;
    Y.rows.forEach(function (x) {
      if (x.empty && x.fc !== 3) return;
      var R = ws.getRow(row);
      var vals = [x.y, x.basis, k ? x.mval : x.msu, k ? x.mvalg : x.msug, k ? x.zval : x.zsu, k ? x.zvalg : x.zsug, k ? x.zvalsh : x.zsush, x.note || ''];
      vals.forEach(function (v, i) {
        var cell = R.getCell(i + 1), pct = i === 3 || i === 5;
        cell.value = fin(v) ? (pct ? v / 100 : v) : (typeof v === 'string' && v ? v : null);
        if (H[i].fmt) cell.numFmt = H[i].fmt;
        cell.border = xBorder(); cell.font = { size: 10, bold: !!x.fc, color: { argb: XC.ink } };
        if (x.fc === 3) cell.fill = xFill(XC.plan); else if (x.fc === 2) cell.fill = xFill(XC.obj); else if (x.fc === 1) cell.fill = xFill(XC.navyL);
      });
      if (x.basis === 'Landing estimate') out.est = row; else if (x.fc === 2) out.obj = row; else if (x.fc === 3) out.plan = row;
      row++;
    });
    out.next = row;
    return out;
  }
  // link the objective / plan rows of the year table to the totals of the brand / item table and to the input market
  function xLinkYears(ws, Yr, T, mktRef, sysRef) {
    var link = function (row, key, mref) {
      if (!row) return;
      var R = ws.getRow(row), E = T.L[key] + T.top, est = 'E' + Yr.est;
      R.getCell(3).value = { formula: mref }; R.getCell(4).value = { formula: 'IFERROR(C' + row + '/C' + Yr.est + '-1,"")' };
      R.getCell(5).value = { formula: 'IF(' + E + '="","",' + E + ')' };
      R.getCell(6).value = { formula: 'IF(E' + row + '="","",IFERROR(E' + row + '/' + est + '-1,""))' };
      R.getCell(7).value = { formula: 'IF(E' + row + '="","",IFERROR(E' + row + '/C' + row + ',""))' };
      R.getCell(8).value = 'Linked to the table below and to the input market (formula)';
    };
    if (Yr.est) { link(Yr.obj, 'obj', sysRef || mktRef); link(Yr.plan, 'pfc', mktRef); }
  }
  function xMeasureSheet(wb, r, k, ty, py, suName, twinL) {
    var name = k ? (PKX ? 'Packs' : 'Value (EGP)') : 'SU', pn = PN(), f = r.forecast || {}, vv = r.value || {}, P = withAll(r, function () { return zplan(r); }), B = P.bex && fin(P.bex.su) ? P.bex : null;
    var ws = wb.addWorksheet(name, { properties: { tabColor: { argb: k ? 'FF15803D' : XC.navy }, outlineLevelRow: 1 }, views: [{ showGridLines: false }] });
    var cols = proCols(k, ty, py, r.type).map(function (c) { return c.h.indexOf('{MC}') >= 0 ? Object.assign({}, c, { h: c.h.replace('{MC}', mktCagr(r, k).span) }) : c; });
    cols.forEach(function (c, i) { ws.getColumn(i + 1).width = c.w || 14; });
    var t = ws.getCell('A1'); t.value = r.name + ' — FY' + ty + ' plan · ' + (k ? 'Value (EGP)' : 'Standard Units'); t.font = { bold: true, size: 15, color: { argb: XC.navy } };
    ws.getCell('A2').value = 'Yellow cells with blue numbers are INPUTS — change them and every forecast, value, share, growth and total recalculates. ' + pn + ' forecast of ' + userLabel() + ' · IQVIA data to ' + per(D.meta.data_period) + ' · exported ' + new Date().toLocaleString();
    ws.getCell('A2').font = { size: 9, color: { argb: XC.grey } };
    // assumptions block (rows 4-9, values in column D) — identical row layout on both sheets
    var lab = function (row, txt, bold) { var c = ws.getCell('A' + row); c.value = txt; c.font = { size: 10, bold: !!bold, color: { argb: XC.ink } }; };
    var ac = ws.getCell('A4'); ac.value = 'Assumptions'; ac.font = { bold: true, size: 12, color: { argb: XC.sec } };
    var ctx = proCtx(r, k);
    if (!k) {
      lab(5, 'Market FY' + ty + ' forecast — system (SU)'); ws.getCell('D5').value = fin(f.fy_target) ? f.fy_target : null; ws.getCell('D5').numFmt = XF.n;
      var mk0 = fin(B && B.mktEdited ? B.mkt : f.fy_target) ? (B && B.mktEdited ? B.mkt : f.fy_target) : null;
      lab(7, 'Market ' + py + ' full year (estimate, SU)'); ws.getCell('D7').value = fin(f.fy_le) ? f.fy_le : null; ws.getCell('D7').numFmt = XF.n;
      if (fin(f.fy_le) && f.fy_le > 0 && fin(mk0)) {   // 2026-10-20 (Ahmed): type the market growth %, the market SU follows
        lab(6, pn + ' market FY' + ty + ' (SU) = ' + py + ' estimate × (1 + growth)', true); ws.getCell('D6').value = fx('D7*(1+D8)', mk0); ws.getCell('D6').numFmt = XF.n; ws.getCell('D6').font = { bold: true, size: 10 };
        lab(8, 'Market growth FY' + ty + ' vs ' + py + ' (' + pn + ' view) — INPUT (default = system forecast)', true); ws.getCell('D8').value = mk0 / f.fy_le - 1; xInput(ws.getCell('D8'), XF.g, 'gr');
      } else {
        lab(6, pn + ' market FY' + ty + ' (SU) — INPUT (default = system forecast)', true); ws.getCell('D6').value = mk0; xInput(ws.getCell('D6'), XF.n, 'num');
        lab(8, 'Market growth FY' + ty + ' vs ' + py + ' (' + pn + ' view)'); ws.getCell('D8').value = fx('IFERROR(D6/D7-1,"")', fin(f.fy_le) && f.fy_le > 0 && fin(mk0) ? mk0 / f.fy_le - 1 : null); ws.getCell('D8').numFmt = XF.g;
      }
      lab(9, 'Price change: see the Value (EGP) sheet'); ws.getCell('A9').font = { size: 9, italic: true, color: { argb: XC.grey } };
      ctx.mfcRef = '$D$6'; ctx.mleRef = '$D$7'; ctx.msysRef = '$D$5'; ctx.mfc = ws.getCell('D6').value;
    } else {
      var mp = f.fy_target > 0 && fin(vv.fy_target) ? vv.fy_target / f.fy_target : null, mkt = (B && B.mktEdited ? B.mkt : f.fy_target);
      lab(5, 'Market price per SU today (EGP)'); ws.getCell('D5').value = mp; ws.getCell('D5').numFmt = XF.px;
      lab(6, 'Price change FY' + ty + ' vs today — INPUT (0% = no new price increase)', true); ws.getCell('D6').value = 0; xInput(ws.getCell('D6'), XF.p1, 'pct');
      lab(7, 'Market value FY' + ty + ' (EGP) = ' + pn + ' market SU × price × (1 + price change)'); ws.getCell('D7').value = fx(qs(suName) + '!$D$6*D5*(1+D6)', fin(mp) && fin(mkt) ? mkt * mp : null); ws.getCell('D7').numFmt = XF.n;
      lab(8, 'Market value ' + py + ' full year (estimate, EGP)'); ws.getCell('D8').value = fin(vv.fy_le) ? vv.fy_le : null; ws.getCell('D8').numFmt = XF.n;
      lab(9, 'Market growth FY' + ty + ' vs ' + py + ' (value)'); ws.getCell('D9').value = fx('IFERROR(D7/D8-1,"")', fin(mp) && fin(mkt) && vv.fy_le > 0 ? mkt * mp / vv.fy_le - 1 : null); ws.getCell('D9').numFmt = XF.g;
      lab(10, 'Market value FY' + ty + ' — system forecast (EGP, today\'s prices; objective basis)'); ws.getCell('D10').value = fin(vv.fy_target) ? vv.fy_target : null; ws.getCell('D10').numFmt = XF.n;
      ctx.mfcRef = '$D$7'; ctx.mleRef = '$D$8'; ctx.pRef = '$D$6'; ctx.msysRef = '$D$10'; ctx.mfc = fin(mp) && fin(mkt) ? mkt * mp : null;
    }
    var row = 12;
    row = xSection(ws, row, 'Year by year — market and Zeta');
    var Yr = xYears(ws, row, r, k); row = Yr.next + 1;
    row = xSection(ws, row, 'By brand and item — ' + matLbl() + ', FY' + ty + ' objective and ' + pn + ' forecast');
    var hr = row; xHeader(ws, row, cols); row++;
    var T = xTableRows(ws, row, r, k, cols, ctx, { twin: suName, twinL: twinL });
    xLinkYears(ws, Yr, T, ctx.mfcRef, k ? ctx.msysRef + '*(1+' + ctx.pRef + ')' : ctx.msysRef);
    ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: Math.max(hr, T.next - 1), column: cols.length } };
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: hr, showGridLines: false }];
    xPrint(ws, hr);
    return { ws: ws, name: name, T: T, Y: Yr };
  }
  function xAllSheet(wb, r, k, ty, py, suName, twinL) {
    var lvl = (LEVELS.find(function (l) { return l[0] === r.type; }) || [0, r.type])[1], pn = PN(), name = k ? (PKX ? 'All markets Packs' : 'All markets Value') : 'All markets SU';
    var ws = wb.addWorksheet(name, { properties: { tabColor: { argb: k ? 'FF86EFAC' : 'FF93C5FD' }, outlineLevelRow: 2 } });
    var cols = proCols(k, ty, py, r.type).map(function (c) { return c.h.indexOf('{MC}') >= 0 ? Object.assign({}, c, { h: 'Market CAGR (hist.)' }) : c; });
    ws.getColumn(1).width = 30; cols.forEach(function (c, i) { ws.getColumn(i + 2).width = c.w || 14; });
    var t = ws.getCell('A1'); t.value = 'All ' + lvl + ' markets with Zeta — ' + (k ? 'Value (EGP)' : 'Standard Units') + ' · FY' + ty; t.font = { bold: true, size: 15, color: { argb: XC.navy } };
    ws.getCell('A2').value = 'Each market starts with a ▸ row holding its inputs (yellow). Items are grouped under brand and market: use the 1 / 2 / 3 buttons at the top-left to collapse. ' + pn + ' columns = your own plan on this computer.'; ws.getCell('A2').font = { size: 9, color: { argb: XC.grey } };
    var pRef = null;
    if (k) { ws.getCell('A3').value = 'Price change FY' + ty + ' vs today — INPUT'; ws.getCell('A3').font = { size: 10, bold: true }; ws.getCell('B3').value = 0; xInput(ws.getCell('B3'), XF.p1, 'pct'); pRef = '$B$3'; }
    else { ws.getCell('A3').value = 'Inputs: market growth FY' + ty + ' % on each ▸ row (the market SU follows), objective share and ' + pn + ' share on item rows.'; ws.getCell('A3').font = { size: 10, bold: true }; }
    var hr = 5, H = [{ h: 'Market', w: 30 }].concat(cols); xHeader(ws, hr, H);
    var L = {}; cols.forEach(function (cc, i) { L[cc.key] = colL(i + 2); });
    var row = hr + 1;
    segs(r.type).filter(function (q) { var it = ((((q.scorecard || {}).zeta) || {}).items || []); return it.length && (it[0] || {}).years; })
      .sort(function (a, b) { var zv = function (q) { var s0 = PKX ? suSeg(q) : q; return ((((s0.scorecard || {}).zeta) || {}).mat || {}).val || 0; }; return zv(b) - zv(a); })   // packs sheet keeps the SU / value row order (formulas link row by row)
      .forEach(function (q) {
        var f = q.forecast || {}, vv = q.value || {}, P = withAll(q, function () { return zplan(q); }), B = P.bex && fin(P.bex.su) ? P.bex : null, mkt = B && B.mktEdited ? B.mkt : f.fy_target;
        var mp = f.fy_target > 0 && fin(vv.fy_target) ? vv.fy_target / f.fy_target : null, mh = row, R0 = ws.getRow(mh), ctx = proCtx(q, k);
        // ▸ market row: name, market MAT, market estimate, market FY+1 (input on SU, formula on value), growth, price (value)
        for (var ci = 1; ci <= cols.length + 1; ci++) { var cc0 = R0.getCell(ci); cc0.fill = xFill(XC.mkt); cc0.border = xBorder(); cc0.font = { size: 10, bold: true, color: { argb: XC.navy } }; }
        R0.getCell(1).value = q.name; R0.getCell(2).value = '▸ ' + q.name;
        R0.getCell(cols.findIndex(function (c) { return c.key === 'lvl'; }) + 2).value = 'Market';
        (function () { var d1 = q.type === 'DM1' ? [q.name] : (dmOf('DM1', ((((q.scorecard || {}).zeta) || {}).items || []).map(function (i) { return i.item; })) || '').split(' / ').filter(Boolean);   // BU / Line on the ▸ row too (filters)
          [['bu', orgOf('BU', d1)], ['line', orgOf('Line', d1)], ['dm', q.type === 'DM1' ? q.name : d1.join(' / ')], ['dm2', q.type === 'DM2' ? q.name : '']].forEach(function (p) { var i = cols.findIndex(function (c) { return c.key === p[0]; }); if (i >= 0 && p[1]) R0.getCell(i + 2).value = p[1]; }); })();
        var cm = R0.getCell(cols.findIndex(function (c) { return c.key === 'mmat'; }) + 2); cm.value = fin(ctx.mm[k ? 'val' : 'su']) ? ctx.mm[k ? 'val' : 'su'] : null; cm.numFmt = XF.n;
        var cl = R0.getCell(cols.findIndex(function (c) { return c.key === 'mle'; }) + 2); cl.value = fin(ctx.mle) ? ctx.mle : null; cl.numFmt = XF.n;
        var cf = R0.getCell(cols.findIndex(function (c) { return c.key === 'mfc'; }) + 2);
        var grIn = !k && fin(mkt) && ctx.mle > 0;   // 2026-10-20 (Ahmed): growth % is the input, market SU = estimate x (1 + growth)
        if (!k) { if (grIn) { cf.value = fx(L.mle + mh + '*(1+' + L.mfg + mh + ')', mkt); cf.numFmt = XF.n; } else { cf.value = fin(mkt) ? mkt : null; xInput(cf, XF.n, 'num'); } ctx.mfc = mkt; }
        else {
          var cp = R0.getCell(cols.findIndex(function (c) { return c.key === 'price'; }) + 2); cp.value = mp; cp.numFmt = XF.px;
          cf.value = fx(qs(suName) + '!' + (twinL || L).mfc + mh + '*' + L.price + mh + '*(1+' + pRef + ')', fin(mp) && fin(mkt) ? mkt * mp : null); cf.numFmt = XF.n; ctx.mfc = fin(mp) && fin(mkt) ? mkt * mp : null;
        }
        var cs = R0.getCell(cols.findIndex(function (c) { return c.key === 'msys'; }) + 2); cs.value = fin(ctx.msys) ? ctx.msys : null; cs.numFmt = XF.n;
        var cg = R0.getCell(cols.findIndex(function (c) { return c.key === 'mfg'; }) + 2);
        if (grIn) { cg.value = mkt / ctx.mle - 1; xInput(cg, XF.g, 'gr'); }
        else { cg.value = fx('IFERROR(' + L.mfc + mh + '/' + L.mle + mh + '-1,"")', fin(ctx.mfc) && ctx.mle > 0 ? ctx.mfc / ctx.mle - 1 : null); cg.numFmt = XF.g; }
        ctx.mfcRef = '$' + L.mfc + '$' + mh; ctx.mleRef = '$' + L.mle + '$' + mh; ctx.msysRef = '$' + L.msys + '$' + mh; ctx.pRef = pRef || '0';
        row = xTableRows(ws, mh + 1, q, k, cols, ctx, { prefix: q.name, twin: suName, twinL: twinL }).next;
        try { row = xCtxRows(ws, row, q, k, cols, ctx, L, mh); } catch (e) { console.warn('[MarketForecast] context rows', e); }
      });
    ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: Math.max(hr, row - 1), column: H.length } };
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: hr, showGridLines: false }];
    xPrint(ws, hr);
    return { L: L, last: row - 1, name: name, ws: ws };
  }
  // 2026-10-19 (Ahmed: "add row for APIX total"): after each market block of the All markets sheets, one row per related
  // market — in a DM1 workbook the DM2 markets the DM1 is split into, in a DM2 workbook the DM1 total it belongs to.
  // Level "DM2 market" / "DM1 total": not an item, so brand / total formulas and Import ignore it.
  function xCtxRows(ws, row, q, k, cols, ctx, L, mh) {
    var up = q.type === 'DM2' ? 'DM1' : 'DM2', its = ((((q.scorecard || {}).zeta) || {}).items || []).map(function (i) { return i.item; });
    var names = up === 'DM2' ? ((((D.meta.links || {}).dm1_dm2 || {})[q.name]) || (dmOf('DM2', its) || '').split(' / ')).filter(Boolean) : (dmOf('DM1', its) || '').split(' / ').filter(Boolean);
    if (up === 'DM2' && names.length === 1 && names[0] === q.name) return row;
    if (up === 'DM1' && names.every(function (n) { return n === q.name; })) return row;
    var G = up === 'DM2' ? withAll(q, function () { return itemGroups(q); }).filter(function (x) { return x.kind === 'item'; }) : [];
    var ci = function (key) { return cols.findIndex(function (c) { return c.key === key; }) + 2; }, has = function (key) { return ci(key) > 1; };
    names.forEach(function (nm) {
      var s = D.segments.find(function (x) { return x.type === up && x.name === nm; }); if (!s) return;
      var f = s.forecast || {}, vv = s.value || {}, mm = (s.scorecard || {}).market_mat || {}, mk = k ? 'val' : 'su', R = ws.getRow(row);
      var mat = mm[mk], matPy = mm[mk + '_py'], le = k ? vv.fy_le : f.fy_le, sys = k ? vv.fy_target : f.fy_target, sc = fin(ctx.mfc) && ctx.msys > 0 ? ctx.mfc / ctx.msys : 1;
      var zm = null, pfc = null;
      if (up === 'DM2') { var mine = G.filter(function (x) { return dmOf('DM2', [x.item]) === nm; }); zm = mine.length ? mine.reduce(function (a, x) { return a + (x.mat[k] || 0); }, 0) : null; }
      else { var Pz = withAll(s, function () { return zplan(s); }); zm = ((((s.scorecard || {}).zeta) || {}).mat || {})[mk]; pfc = Pz.bex && fin(Pz.bex.su) ? (k ? Pz.bex.val : Pz.bex.su) : null; }
      for (var c0 = 1; c0 <= cols.length + 1; c0++) { var cc = R.getCell(c0); cc.border = xBorder(); cc.fill = xFill('FFF5F3FF'); cc.font = { size: 10, italic: true, color: { argb: 'FF5B21B6' } }; }
      var put = function (key, v, fmt) { if (!has(key)) return; var cl = R.getCell(ci(key)); cl.value = v; if (fmt) cl.numFmt = fmt; };
      R.getCell(1).value = q.name;
      put('lbl', (up === 'DM2' ? '◦ DM2 market: ' : '◦ DM1 total: ') + nm);
      put('lvl', up === 'DM2' ? 'DM2 market' : 'DM1 total');
      put('bu', orgOf('BU', up === 'DM1' ? [nm] : (dmOf('DM1', its) || '').split(' / '))); put('line', orgOf('Line', up === 'DM1' ? [nm] : (dmOf('DM1', its) || '').split(' / ')));
      put('dm', up === 'DM1' ? nm : q.name); put('dm2', up === 'DM2' ? nm : '');
      put('mmat', fin(mat) ? mat : null, XF.n);
      put('mg', matPy > 0 && fin(mat) ? mat / matPy - 1 : null, XF.g);
      put('mle', fin(le) ? le : null, XF.n); put('msys', fin(sys) ? sys : null, XF.n);
      if (has('mfc')) put('mfc', fx(String(sys) + '*$' + L.mfc + '$' + mh + '/$' + L.msys + '$' + mh, fin(sys) ? sys * sc : null), XF.n);
      if (has('mfg')) put('mfg', fx('IFERROR(' + L.mfc + row + '/' + L.mle + row + '-1,"")', fin(sys) && le > 0 ? sys * sc / le - 1 : ''), XF.g);
      put('zmat', fin(zm) ? zm : null, XF.n);
      if (has('sh')) put('sh', fx('IF(' + L.zmat + row + '="","",IFERROR(' + L.zmat + row + '/' + L.mmat + row + ',""))', fin(zm) && mat > 0 ? zm / mat : ''), XF.p2);
      if (up === 'DM2') {   // SFE forecast of the items of this DM2 = live sum of the item rows above
        var top = mh + 1, bot = row - 1, mineP = G.filter(function (x) { return dmOf('DM2', [x.item]) === nm && x.P && x.P.bex && fin(x.P.bex.su); }), cv = mineP.reduce(function (a, x) { return a + (k ? x.P.bex.val || 0 : x.P.bex.su); }, 0);
        if (has('pfc')) put('pfc', fx('IF(COUNTIFS($' + L.lvl + '$' + top + ':$' + L.lvl + '$' + bot + ',"Item",$' + L.dm2 + '$' + top + ':$' + L.dm2 + '$' + bot + ',"' + nm.replace(/"/g, '""') + '",$' + L.pfc + '$' + top + ':$' + L.pfc + '$' + bot + ',">=0")=0,"",SUMIFS($' + L.pfc + '$' + top + ':$' + L.pfc + '$' + bot + ',$' + L.lvl + '$' + top + ':$' + L.lvl + '$' + bot + ',"Item",$' + L.dm2 + '$' + top + ':$' + L.dm2 + '$' + bot + ',"' + nm.replace(/"/g, '""') + '"))', mineP.length ? cv : ''), XF.n);
      } else if (has('pfc')) put('pfc', fin(pfc) ? pfc : null, XF.n);
      if (has('psh')) put('psh', fx('IF(' + L.pfc + row + '="","",IFERROR(' + L.pfc + row + '/' + L.mfc + row + ',""))', (up === 'DM2' ? (mineP.length ? cv : null) : pfc) != null && fin(sys) && sys * sc > 0 ? (up === 'DM2' ? cv : pfc) / (sys * sc) : ''), XF.p2);
      R.outlineLevel = 1; row++;
    });
    return row;
  }
  // 2026-10-20: Packs sheets are the value sheets built on the packs data (value slots = packs, "price" = packs per SU);
  // this relabels their text. Formulas are untouched.
  var PKX = false;
  var PKX_TX = [[/Market price per SU today \(EGP\)/g, 'Market packs per SU today (last 6 months)'], [/Price per SU today \(EGP\)/g, 'Packs per SU today'], [/Price per SU/g, 'Packs per SU'], [/price per SU/g, 'packs per SU'],
    [/Price change FY(\d+) vs today — INPUT \(0% = no new price increase\)/g, 'Pack-mix change FY$1 vs today — INPUT (0% = today\'s pack mix)'], [/Price change/g, 'Pack-mix change'], [/price change/g, 'pack-mix change'],
    [/ × price × /g, ' × packs per SU × '], [/today's prices/g, "today's pack mix"], [/no new price increase/g, "today's pack mix"], [/Value \(EGP\)/g, 'Packs'], [/\(EGP\)/g, '(packs)'], [/\(EGP, /g, '(packs, '], [/EGP/g, 'packs'],
    [/\bvalue\b/g, 'packs'], [/\bValue\b/g, 'Packs']];
  function pkSheetText(ws) {
    if (!ws) return;
    var fix = function (t) { PKX_TX.forEach(function (q) { t = t.replace(q[0], q[1]); }); return t; };
    ws.eachRow({ includeEmpty: false }, function (R) { R.eachCell({ includeEmpty: false }, function (c) { if (typeof c.value === 'string' && /EGP|[Vv]alue|[Pp]rice/.test(c.value)) c.value = fix(c.value); }); });
  }
  function xPrint(ws, hr) {
    ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }, printTitlesRow: hr + ':' + hr };
    ws.headerFooter = { oddFooter: '&L&8Zeta Pharma · Market Growth Forecast&R&8Page &P of &N' };
  }
  function userLabel() { var u = curUser(); return (u && (u.name || u.email)) || 'this computer'; }
  // Summary: every plan number is a formula on the SU / Value sheets, so it follows the inputs
  function xSummary(ws, r, ty, py, S, V) {
    [46, 20, 22, 70].forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    var P = withAll(r, function () { return zplan(r); }), z = (r.scorecard || {}).zeta || {}, zm = z.mat || {}, mm = (r.scorecard || {}).market_mat || {}, f = r.forecast || {}, vv = r.value || {}, B = P.bex && fin(P.bex.su) ? P.bex : null, pn = PN();
    var L26 = withAll(r, function () { var zz = zdata(r); return zLE(r, (zz.ytd || {}).su, (zz.ytd || {}).val); });
    var g = function (a, b) { return fin(a) && b > 0 ? a / b - 1 : null; };
    var sR = function (key) { return qs(S.name) + '!' + S.T.L[key] + S.T.top; }, vR = function (key) { return V ? qs(V.name) + '!' + V.T.L[key] + V.T.top : null; };
    ws.mergeCells('A1:D1'); var t = ws.getCell('A1'); t.value = 'Market Growth Forecast — FY' + ty + ' plan'; t.font = { bold: true, size: 18, color: { argb: XC.white } }; t.fill = xFill(XC.navy); t.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(1).height = 34;
    ws.mergeCells('A2:D2'); var t2 = ws.getCell('A2'); t2.value = r.name + ' · ' + ((LEVELS.find(function (l) { return l[0] === r.type; }) || [0, r.type])[1]) + ' · Zeta: ' + withAll(r, function () { return zProd(r); }); t2.font = { bold: true, size: 12, color: { argb: XC.navy } }; t2.fill = xFill(XC.navyL); t2.alignment = { indent: 1 }; ws.getRow(2).height = 22;
    ws.mergeCells('A3:D3'); var t3 = ws.getCell('A3'); t3.value = pn + ' forecast of ' + userLabel() + (B ? (B.dirty ? ' (UNSAVED changes on the page)' : B.saved ? ' (saved ' + B.saved + ')' : '') : ' (not entered on the page yet)') + ' · plan numbers below are formulas: change the yellow inputs on the SU / Value sheets · IQVIA data to ' + per(D.meta.data_period); t3.font = { size: 9, color: { argb: XC.grey } }; t3.alignment = { indent: 1, wrapText: true }; ws.getRow(3).height = 26;
    var row = 5;
    var head = function (txt) { ws.mergeCells('A' + row + ':D' + row); var c = ws.getCell('A' + row); c.value = txt; c.font = { bold: true, color: { argb: XC.white } }; c.fill = xFill(XC.sec); c.alignment = { indent: 1 }; ws.getRow(row).height = 18; row++; };
    var colh = function () { ['', 'Standard Units', 'Value (EGP)', 'Comment'].forEach(function (h, i) { var c = ws.getRow(row).getCell(i + 1); c.value = h || null; c.font = { bold: true, size: 9, color: { argb: XC.grey } }; c.border = { bottom: { style: 'thin', color: { argb: XC.line } } }; c.alignment = { horizontal: i ? 'right' : 'left' }; }); row++; };
    var cellv = function (v) { return v && typeof v === 'object' ? v : (fin(v) ? v : null); };
    var line = function (lab, a, b, fmt, note, kind) {
      var R = ws.getRow(row);
      [lab, cellv(a), cellv(b), note || null].forEach(function (v, i) {
        var c = R.getCell(i + 1); c.value = (i === 0 || i === 3) ? (v || null) : v;
        if (i === 1 || i === 2) { c.numFmt = fmt; c.alignment = { horizontal: 'right' }; }
        c.font = { size: 10, bold: kind === 'b', color: { argb: i === 3 ? XC.grey : XC.ink } };
        c.border = { bottom: { style: 'hair', color: { argb: XC.line } } };
        if (kind === 'plan') c.fill = xFill(XC.plan); else if (kind === 'obj') c.fill = xFill(XC.obj);
        if (i === 3) c.alignment = { wrapText: true, vertical: 'top' };
      });
      row++; return row - 1;
    };
    var suM = qs(S.name) + '!$D$6', suLE = qs(S.name) + '!$D$7', vaM = V ? qs(V.name) + '!$D$7' : null, vaLE = V ? qs(V.name) + '!$D$8' : null;
    var mkt = B && B.mktEdited ? B.mkt : f.fy_target, mp = f.fy_target > 0 && fin(vv.fy_target) ? vv.fy_target / f.fy_target : null;
    head('Market'); colh();
    line('Market ' + matLbl(), mm.su, mm.val, XF.n);
    line('Market growth vs previous MAT', g(mm.su, mm.su_py), g(mm.val, mm.val_py), XF.g);
    line('Market ' + py + ' full year (estimate)', f.fy_le, vv.fy_le, XF.n, 'Actual ' + ((r.ytd || {}).months || 'YTD') + ' + forecast to December');
    var rS = line('Market FY' + ty + ' forecast — system (objective basis)', f.fy_target, vv.fy_target, XF.n, (r.reliability || {}).verdict ? 'Forecast reliability: ' + r.reliability.verdict : '');
    var rM = line(pn + ' market FY' + ty + ' (input on SU sheet)', fx(suM, mkt), V ? fx(vaM, fin(mp) ? mkt * mp : null) : null, XF.n, 'Value includes the price change input on the Value sheet', 'b');
    line('Market growth FY' + ty + ' vs ' + py, fx('IFERROR(B' + rM + '/' + suLE + '-1,"")', g(mkt, f.fy_le)), V ? fx('IFERROR(C' + rM + '/' + vaLE + '-1,"")', fin(mp) ? g(mkt * mp, vv.fy_le) : null) : null, XF.g, '', 'b');
    row++; head('Zeta'); colh();
    line('Zeta ' + matLbl(), zm.su, zm.val, XF.n);
    line('Zeta share ' + matLbl(), P.s, P.sv, XF.p2, fin(P.d) ? 'Share change vs previous MAT: ' + (P.d >= 0 ? '+' : '') + P.d.toFixed(2) + ' pts (SU)' : '');
    var rE = line('Zeta ' + py + ' full year (estimate)', fx(sR('est'), L26.su), V ? fx(vR('est'), L26.val) : null, XF.n, 'Actual YTD + remaining months at the YTD share of the market estimate');
    row++; head('FY' + ty + ' plan (formulas)'); colh();
    var rO = line('Objective — ' + (P.present ? P.strategy : 'not set'), fx('IF(' + sR('obj') + '="","",' + sR('obj') + ')', P.present ? P.objSU : null), V ? fx('IF(' + vR('obj') + '="","",' + vR('obj') + ')', P.present ? P.objVal : null) : null, XF.n, P.reason, 'obj');
    var vP = V ? qs(V.name) + '!$D$6' : '0';
    line('Objective share', fx('IFERROR(B' + rO + '/B' + rS + ',"")', P.present ? P.objShare : null), V ? fx('IFERROR(C' + rO + '/(C' + rS + '*(1+' + vP + ')),"")', P.present ? P.objValShare : null) : null, XF.p2, 'Change the objective share per item on the SU sheet', 'obj');
    line('Objective growth vs ' + py, fx('IFERROR(B' + rO + '/B' + rE + '-1,"")', P.present ? g(P.objSU, L26.su) : null), V ? fx('IFERROR(C' + rO + '/C' + rE + '-1,"")', P.present ? g(P.objVal, L26.val) : null) : null, XF.g, '', 'obj');
    var rP = line(pn + ' forecast', fx('IF(' + sR('pfc') + '="","",' + sR('pfc') + ')', B ? B.su : null), V ? fx('IF(' + vR('pfc') + '="","",' + vR('pfc') + ')', B ? B.val : null) : null, XF.n, { formula: 'IF(' + sR('pitems') + '="","Type the ' + pn + ' share per item on the SU sheet","' + pn + ' planned "&' + sR('pitems') + '&" items")' }, 'plan');
    line(pn + ' share', fx('IF(B' + rP + '="","",IFERROR(B' + rP + '/B' + rM + ',""))', B ? B.share : null), V ? fx('IF(C' + rP + '="","",IFERROR(C' + rP + '/C' + rM + ',""))', B ? B.valShare : null) : null, XF.p2, '', 'plan');
    line(pn + ' growth vs ' + py + ' (like-for-like)', fx('IF(' + sR('pg') + '="","",' + sR('pg') + ')'), V ? fx('IF(' + vR('pg') + '="","",' + vR('pg') + ')') : null, XF.g, 'Compared with the ' + py + ' estimate of the planned items only', 'plan');
    line(pn + ' vs objective', fx('IF(' + sR('pvo') + '="","",' + sR('pvo') + ')'), V ? fx('IF(' + vR('pvo') + '="","",' + vR('pvo') + ')') : null, XF.d, 'Shown when every item has a ' + pn + ' share', 'plan');
    row++; head('Where the FY' + ty + ' objective comes from (growth bridge, formulas)'); colh();
    var rb0 = line('Zeta ' + py + ' (estimate)', fx('B' + rE, L26.su), V ? fx('C' + rE, L26.val) : null, XF.n);
    var rb1 = line('+ Market growth at today\'s share', fx('IFERROR(B' + rE + '/' + suLE + '*(B' + rS + '-' + suLE + '),"")'), V ? fx('IFERROR(C' + rE + '/' + vaLE + '*(C' + rS + '*(1+' + vP + ')-' + vaLE + '),"")') : null, XF.d, 'Zeta keeps its ' + py + ' share of a bigger market');
    line('+ Share gain / loss', fx('IFERROR(B' + rO + '-B' + rb0 + '-B' + rb1 + ',"")'), V ? fx('IFERROR(C' + rO + '-C' + rb0 + '-C' + rb1 + ',"")') : null, XF.d, 'The rest of the change (in value also mix and price)');
    line('= Objective FY' + ty, fx('B' + rO), V ? fx('C' + rO) : null, XF.n, '', 'b');
    var ra = r.rationale || {}, Q = qualityFlags(r);
    row++; head('Why this forecast');
    var txt = [ra.statement, ra.key_driver ? 'Main driver: ' + ra.key_driver : ''].concat((ra.watch || []).slice(0, 3).map(function (w) { return 'Watch: ' + w; }));
    if (Q.limited) txt.push('Alignment limited: adding up to ' + Q.parent + ' would have moved this market ' + Q.fullPts.toFixed(1) + ' pts; limited to ' + Q.capPts + ' pts.');
    if (Q.contradicts) txt.push('Check: FY' + ty + ' growth (' + fmtP(Q.fcG) + ') is far from this year\'s sales so far (' + fmtP(Q.ytdG) + ').');
    txt.filter(Boolean).forEach(function (tx) { ws.mergeCells('A' + row + ':D' + row); var c = ws.getCell('A' + row); c.value = String(tx).replace(/<[^>]+>/g, ''); c.alignment = { wrapText: true, vertical: 'top', indent: 1 }; c.font = { size: 10, color: { argb: XC.ink } }; ws.getRow(row).height = Math.min(60, 15 * Math.ceil(String(tx).length / 150)); row++; });
    ws.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    ws.headerFooter = { oddFooter: '&L&8Zeta Pharma · Market Growth Forecast&R&8Page &P of &N' };
  }
  function xNotes(wb, ty, py) {
    var ws = wb.addWorksheet('Notes', { properties: { tabColor: { argb: 'FF94A3B8' } }, views: [{ showGridLines: false }] });
    ws.getColumn(1).width = 26; ws.getColumn(2).width = 120;
    var pn = PN(), rows = [
      ['How to change the plan', 'Change only the YELLOW cells with BLUE numbers: SU sheet → ' + pn + ' market growth FY' + ty + ' % (D8; the market SU in D6 = ' + D.meta.partial_year + ' estimate × (1 + growth)), objective share and ' + pn + ' share per item; Value sheet → price change (D6); All markets SU → market growth % on each ▸ row (market SU, value and packs follow), shares on item rows, price change (B3 on All markets Value). Everything else is a formula: forecasts, value, shares, growth, brand and total rows, the year-by-year plan rows and the Summary.'],
      ['Formulas', 'Item objective SU = objective share × the SYSTEM market forecast (as on the dashboard). Item ' + pn + ' forecast SU = ' + pn + ' share × YOUR market view (input). Item value = forecast SU × the item\'s own price per SU today × (1 + price change). Brand / total = SUM of their items. ' + pn + ' growth on brand / total rows is like-for-like (only items with a share).'],
      ['Summary sheet', 'All Zeta in the one-market layout (Market / Zeta / FY plan, SU and EGP). Below it, one row per DM2 market inside each Zeta DM1 with Business unit and Line: use the ▼ filter buttons on its header to tick / untick any BU, Line, Market (DM1) or DM2; every number in the summary (SUBTOTAL) and the TOTAL row add up only the rows you keep. Zeta, objective and ' + pn + ' come from the DM1 item plan saved on the page (a snapshot: edits on the SU / Value sheets do not change it).'],
      ['This market', 'The summary of the market you exported (' + 'growth bridge, objective and ' + pn + ' forecast, formulas linked to the SU / Value sheets).'],
      ['Standard Units (SU)', 'IQVIA standard units. Market = the whole defined market; Zeta = Zeta items in it.'],
      ['Value (EGP)', 'Market value = market SU × market price per SU today × (1 + price change). With 0% price change this equals the dashboard\'s value forecast.'],
      ['MAT', matLbl() + ' = the 12 months to ' + per(D.meta.data_period) + '; growth vs the 12 months before.'],
      [py + ' (estimate)', 'Actual Jan–' + MON[D.meta.partial_months - 1] + ' + remaining months: market = forecast; Zeta = its YTD share of the market estimate.'],
      ['Objective', 'Pre-filled with the system rule: Defend = biggest brand, ≥ ' + (OBJ_RULES.dominant * 100) + '% share, or lost ≥ ' + Math.abs(OBJ_RULES.losing) + ' pts → hold today\'s share. Grow = add the latest MAT share gain (min +' + OBJ_RULES.gainMin + ' pts or +25% of a small share; max +' + OBJ_RULES.gainMax + ' pts or double the share). You may overwrite the objective share.'],
      [pn + ' forecast', 'Your own plan, kept on this computer: pre-filled with the shares saved on the dashboard page. Changes made in Excel stay in Excel (use the page or "Import" to load shares back).'],
      ['Alignment limit', 'Markets are aligned so that markets, BUs and Egypt add up; no defined market is moved more than 5 pts from its own forecast.'],
      ['Colours', 'Yellow + blue = input · navy = market & history · lilac = market FY' + ty + ' view · grey-blue = objective · amber = your ' + pn + ' plan · red numbers = decline.']
    ];
    var t = ws.getCell('A1'); t.value = 'Notes and definitions'; t.font = { bold: true, size: 15, color: { argb: XC.navy } };
    rows.forEach(function (x, i) { var R = ws.getRow(i + 3); R.getCell(1).value = x[0]; R.getCell(1).font = { bold: true, size: 10 }; R.getCell(2).value = x[1]; R.getCell(2).alignment = { wrapText: true, vertical: 'top' }; R.getCell(2).font = { size: 10 }; R.getCell(1).alignment = { vertical: 'top' }; });
  }
  // 2026-10-19 (Ahmed: "Summary to be for all Zeta and filter BU / Line / market / DM1 / DM2"): first sheet of the plan
  // workbook = every Zeta DM1 market split into its DM2 markets (DM2s add up to their DM1, so every column is additive).
  // Row 4 = SUBTOTAL of the rows left visible by the filter. Market = IQVIA forecast; Zeta / objective / plan = DM1 item plan.
  function orgOf(type, dm1s) {   // BU / Line names whose members include any of these DM1 markets
    var out = [];
    D.segments.forEach(function (s) { if (s.type === type && (s.members || []).some(function (m) { return dm1s.indexOf(m) >= 0; }) && out.indexOf(s.name) < 0) out.push(s.name); });
    return out.join(' / ');
  }
  function xZetaSummary(ws, ty, py, HR0, LK) {
    var pn = PN(), V = hasVal(), n = function (v) { return fin(v) ? v : null; };
    var C = [
      { k: 'bu', h: 'Business unit', w: 16 }, { k: 'line', h: 'Line', w: 18 }, { k: 'dm1', h: 'Market (DM1)', w: 30 }, { k: 'dm2', h: 'DM2', w: 30 }, { k: 'br', h: 'Zeta brand(s)', w: 22 },
      { k: 'mmat', h: 'Market ' + matLbl() + ' (SU)', w: 15, f: XF.n, s: 1, c: 'mkt' }, { k: 'mle', h: 'Market ' + py + ' (estimate, SU)', w: 15, f: XF.n, s: 1, c: 'mkt' },
      { k: 'mfc', h: 'Market FY' + ty + ' — system forecast (SU)', w: 15, f: XF.n, s: 1, c: 'mkt' }, { k: 'mg', h: 'Market growth FY' + ty + ' vs ' + py, w: 11, f: XF.g, c: 'mkt' },
      { k: 'mview', h: 'Market FY' + ty + ' — ' + pn + ' view (SU)', w: 15, f: XF.n, s: 1, c: 'mkt' },
      { k: 'zmat', h: 'Zeta ' + matLbl() + ' (SU)', w: 14, f: XF.n, s: 1 }, { k: 'zsh', h: 'Zeta share ' + matLbl(), w: 10, f: XF.p2 }, { k: 'zle', h: 'Zeta ' + py + ' (estimate, SU)', w: 14, f: XF.n, s: 1 },
      { k: 'obj', h: 'Objective FY' + ty + ' (SU)', w: 14, f: XF.n, s: 1 }, { k: 'objsh', h: 'Objective share', w: 10, f: XF.p2 },
      { k: 'sfe', h: pn + ' forecast FY' + ty + ' (SU)', w: 14, f: XF.n, s: 1, c: 'plan' }, { k: 'sfesh', h: pn + ' share', w: 10, f: XF.p2, c: 'plan' },
      { k: 'sfeg', h: pn + ' growth vs ' + py + ' (like-for-like)', w: 11, f: XF.g, c: 'plan' }, { k: 'gap', h: pn + ' vs objective (SU, planned items)', w: 13, f: XF.d, s: 1, c: 'plan' },
      { k: 'sfele', h: 'Zeta ' + py + ' estimate of planned items (SU)', w: 14, f: XF.n, s: 1, c: 'plan' }, { k: 'np', h: pn + ' items planned', w: 10, c: 'plan' }
    ];
    if (V) C = C.concat([{ k: 'vmat', h: 'Market ' + matLbl() + ' (EGP)', w: 16, f: XF.n, s: 1, c: 'mkt' }, { k: 'vfc', h: 'Market FY' + ty + ' (EGP)', w: 16, f: XF.n, s: 1, c: 'mkt' },
      { k: 'zvmat', h: 'Zeta ' + matLbl() + ' (EGP)', w: 15, f: XF.n, s: 1 }, { k: 'vobj', h: 'Objective FY' + ty + ' (EGP)', w: 15, f: XF.n, s: 1 }, { k: 'vsfe', h: pn + ' forecast FY' + ty + ' (EGP)', w: 15, f: XF.n, s: 1, c: 'plan' }]);
    if (LK && LK.pk) C = C.concat([{ k: 'pmat', h: 'Market ' + matLbl() + ' (packs)', w: 14, f: XF.n, s: 1, c: 'mkt' }, { k: 'pfc2', h: 'Market FY' + ty + ' (packs)', w: 14, f: XF.n, s: 1, c: 'mkt' },
      { k: 'zpmat', h: 'Zeta ' + matLbl() + ' (packs)', w: 13, f: XF.n, s: 1 }, { k: 'pobj', h: 'Objective FY' + ty + ' (packs)', w: 13, f: XF.n, s: 1 }, { k: 'psfe', h: pn + ' forecast FY' + ty + ' (packs)', w: 13, f: XF.n, s: 1, c: 'plan' },
      { k: 'pmatpy', h: 'Market previous MAT (packs)', w: 12, f: XF.n, hid: 1 }, { k: 'ple', h: 'Market ' + py + ' estimate (packs)', w: 12, f: XF.n, hid: 1 }, { k: 'pview', h: 'Market FY' + ty + ' ' + pn + ' view (packs)', w: 12, f: XF.n, hid: 1 },
      { k: 'zple', h: 'Zeta ' + py + ' estimate (packs)', w: 12, f: XF.n, hid: 1 }, { k: 'psfele', h: 'Zeta ' + py + ' estimate of planned items (packs)', w: 12, f: XF.n, hid: 1 }, { k: 'pgap', h: pn + ' vs objective (packs, planned items)', w: 12, f: XF.n, hid: 1 }]);
    // helper columns (hidden) used by the Summary sheet's filter formulas
    C = C.concat([{ k: 'buK', h: 'BU key', w: 10, hid: 1 }, { k: 'lnK', h: 'Line key', w: 10, hid: 1 }, { k: 'mmatpy', h: 'Market previous MAT (SU)', w: 12, f: XF.n, hid: 1 }, { k: 'vmatpy', h: 'Market previous MAT (EGP)', w: 12, f: XF.n, hid: 1 },
      { k: 'vle', h: 'Market ' + py + ' estimate (EGP)', w: 12, f: XF.n, hid: 1 }, { k: 'vview', h: 'Market FY' + ty + ' ' + pn + ' view (EGP)', w: 12, f: XF.n, hid: 1 }, { k: 'zvle', h: 'Zeta ' + py + ' estimate (EGP)', w: 12, f: XF.n, hid: 1 },
      { k: 'vsfele', h: 'Zeta ' + py + ' estimate of planned items (EGP)', w: 12, f: XF.n, hid: 1 }, { k: 'vgap', h: pn + ' vs objective (EGP, planned items)', w: 12, f: XF.n, hid: 1 }, { k: 'npn', h: 'Items planned', w: 8, hid: 1 }, { k: 'ni', h: 'Zeta items', w: 8, hid: 1 }]);
    C = C.filter(function (c) { return !c.hid; }).concat(C.filter(function (c) { return c.hid; }));
    var L = {}; C.forEach(function (c, i) { L[c.k] = colL(i + 1); if (!HR0 || i > 4) ws.getColumn(i + 1).width = c.w; });
    if (!HR0) { var t = ws.getCell('A1'); t.value = 'Summary data — all Zeta markets by BU, Line, DM1 and DM2 (FY' + ty + ')'; t.font = { bold: true, size: 15, color: { argb: XC.navy } };
    ws.getCell('A2').value = 'One row per DM2 market inside each Zeta DM1 market (the DM2 markets add up to their DM1). Filter Business unit / Line / Market (DM1) / DM2 in row 5 — the TOTAL row 4 follows the filter. ' +
      'Market = IQVIA forecast; Zeta, objective and ' + pn + ' = the DM1 item plan (' + pn + ' plan of ' + userLabel() + ' on this computer) · IQVIA data to ' + per(D.meta.data_period) + ' · exported ' + new Date().toLocaleString();
    ws.getCell('A2').font = { size: 9, color: { argb: XC.grey } }; }
    var HR = HR0 || 5, TR = HR - 1, r0 = HR + 1, rows = [];
    function buildRows() { var rows = [];
    segs('DM1').filter(function (q) { var it = ((((q.scorecard || {}).zeta) || {}).items || []); return it.length && (it[0] || {}).years; })
      .sort(function (a, b) { return ((((b.scorecard || {}).zeta) || {}).mat || {}).su - ((((a.scorecard || {}).zeta) || {}).mat || {}).su || 0; })
      .forEach(function (q) {
        var G = withAll(q, function () { return itemGroups(q); }).filter(function (x) { return x.kind === 'item'; });
        var P = withAll(q, function () { return zplan(q); }), fq = q.forecast || {}, view = P.bex && fin(P.bex.mkt) ? P.bex.mkt : fq.fy_target, sc = fq.fy_target > 0 && fin(view) ? view / fq.fy_target : 1;
        var kids = ((D.meta.links || {}).dm1_dm2 || {})[q.name] || [];
        G.forEach(function (x) { var d2 = dmOf('DM2', [x.item]); if (d2 && kids.indexOf(d2) < 0) kids.push(d2); });
        if (!kids.length) kids = [q.name];
        var bu = orgOf('BU', [q.name]), ln = orgOf('Line', [q.name]);
        kids.forEach(function (d2) {
          var s2 = D.segments.find(function (s) { return s.type === 'DM2' && s.name === d2; }) || (kids.length === 1 ? q : null), f2 = (s2 || {}).forecast || {}, mm = ((s2 || {}).scorecard || {}).market_mat || {}, v2 = (s2 || {}).value || {};
          var its = G.filter(function (x) { return (dmOf('DM2', [x.item]) || d2) === d2; }), z = { zmat: 0, zle: 0, obj: 0, sfe: 0, sfele: 0, zvmat: 0, vobj: 0, vsfe: 0, np: 0, nobj: 0, zvle: 0, vsfele: 0, gap: 0, vgap: 0, ng: 0 };
          its.forEach(function (x) {
            var e = zLE(q, (x.ytd || [0, 0])[0], (x.ytd || [0, 0])[1]), B = x.P && x.P.bex && fin(x.P.bex.su) ? x.P.bex : null;
            z.zmat += x.mat[0] || 0; z.zvmat += x.mat[1] || 0; z.zle += e.su || 0; z.zvle += e.val || 0;
            var hasObj = x.P && x.P.present && fin(x.P.objSU);
            if (hasObj) { z.obj += x.P.objSU; z.vobj += x.P.objVal || 0; z.nobj++; }
            if (B) { z.sfe += B.su; z.vsfe += B.val || 0; z.sfele += e.su || 0; z.vsfele += e.val || 0; z.np++; }
            if (B && hasObj) { z.gap += B.su - x.P.objSU; z.vgap += (B.val || 0) - (x.P.objVal || 0); z.ng++; }
          });
          rows.push({ bu: bu, line: ln, dm1: q.name, dm2: d2, br: its.map(function (x) { return x.brand; }).filter(function (b, i, a) { return a.indexOf(b) === i; }).join(', '),
            mmat: n(mm.su), mle: n(f2.fy_le), mfc: n(f2.fy_target), mview: fin(f2.fy_target) ? f2.fy_target * sc : null,
            zmat: its.length ? z.zmat : null, zle: its.length ? z.zle : null, obj: z.nobj ? z.obj : null, sfe: z.np ? z.sfe : null, sfele: z.np ? z.sfele : null, np: its.length ? z.np + ' of ' + its.length : '',
            vmat: n(mm.val), vfc: n(v2.fy_target), zvmat: its.length ? z.zvmat : null, vobj: z.nobj ? z.vobj : null, vsfe: z.np ? z.vsfe : null,
            gap: z.ng ? z.gap : null, buK: '|' + bu.split(' / ').join('|') + '|', lnK: '|' + ln.split(' / ').join('|') + '|', mmatpy: n(mm.su_py), vmatpy: n(mm.val_py), vle: n(v2.fy_le), vview: fin(v2.fy_target) ? v2.fy_target * sc : null,
            zvle: its.length ? z.zvle : null, vsfele: z.np ? z.vsfele : null, vgap: z.ng ? z.vgap : null, npn: z.np, ni: its.length });
        });
      });
    return rows; }
    rows = buildRows();
    if (LK && LK.pk) {   // packs: the same rows built on the packs data; its value slots are packs
      var rp = withMeasD(true, buildRows), PMAP = { pmat: 'vmat', pmatpy: 'vmatpy', ple: 'vle', pfc2: 'vfc', pview: 'vview', zpmat: 'zvmat', zple: 'zvle', pobj: 'vobj', psfe: 'vsfe', psfele: 'vsfele', pgap: 'vgap' };
      rows.forEach(function (x, i) { var y = rp[i] || {}; Object.keys(PMAP).forEach(function (pk) { x[pk] = y[PMAP[pk]] == null ? null : y[PMAP[pk]]; }); });
    }
    var last = r0 + rows.length - 1;
    var ratio = function (R, x) {   // formula + cached value of the ratio columns on row R (x = numbers of that row)
      var q = function (a, b) { return fin(a) && fin(b) && b !== 0 ? a / b : null; };
      return {
        mg: fx('IFERROR(' + L.mfc + R + '/' + L.mle + R + '-1,"")', fin(q(x.mfc, x.mle)) ? q(x.mfc, x.mle) - 1 : ''),
        zsh: fx('IF(' + L.zmat + R + '="","",IFERROR(' + L.zmat + R + '/' + L.mmat + R + ',""))', fin(q(x.zmat, x.mmat)) ? q(x.zmat, x.mmat) : ''),
        objsh: fx('IF(' + L.obj + R + '="","",IFERROR(' + L.obj + R + '/' + L.mfc + R + ',""))', fin(x.obj) && fin(q(x.obj, x.mfc)) ? q(x.obj, x.mfc) : ''),
        sfesh: fx('IF(' + L.sfe + R + '="","",IFERROR(' + L.sfe + R + '/' + L.mview + R + ',""))', fin(x.sfe) && fin(q(x.sfe, x.mview)) ? q(x.sfe, x.mview) : ''),
        sfeg: fx('IF(' + L.sfe + R + '="","",IFERROR(' + L.sfe + R + '/' + L.sfele + R + '-1,""))', fin(x.sfe) && fin(q(x.sfe, x.sfele)) ? q(x.sfe, x.sfele) - 1 : '')
      };
    };
    var style = function (cell, c, tot) {
      if (c.f) cell.numFmt = c.f;
      cell.border = xBorder(); cell.font = { size: 10, bold: !!tot, color: { argb: XC.ink } };
      if (tot) cell.fill = xFill(XC.tot); else if (c.c === 'plan') cell.fill = xFill(XC.plan); else if (c.c === 'mkt') cell.fill = xFill(XC.mkt);
    };
    // 2026-10-19 (Ahmed: "if I change the SFE share in All markets SU, All markets Value and the Summary must respond"):
    // plan columns of each row = live SUMIFS / COUNTIFS over the item rows of the All markets sheets (Level = Item,
    // same DM1 + DM2); the market view follows the ▸ market input. Only where each item sits in exactly one block
    // (DM1, DM2 or Egypt-total workbook); a BU / Line workbook keeps the saved-plan snapshot.
    var LIVE = LK && LK.su && /^(DM1|DM2|Total)$/.test(LK.type);
    function liveF(x) {
      if (!LIVE) return {};
      var q = function (t) { return '"' + String(t).replace(/"/g, '""') + '"'; };
      var mk = function (A) {
        var sh = qs(A.name) + '!', R = function (key) { return sh + '$' + A.L[key] + '$6:$' + A.L[key] + '$' + Math.max(6, A.last); };
        var crit = R('lvl') + ',"Item",' + R('dm') + ',' + q(x.dm1) + ',' + R('dm2') + ',' + q(x.dm2);
        var mcrit = LK.type === 'DM2' ? R('lvl') + ',"Market",' + R('dm2') + ',' + q(x.dm2) : LK.type === 'DM1' ? R('lvl') + ',"Market",' + R('dm') + ',' + q(x.dm1) : R('lvl') + ',"Market"';
        // cached results = the same sums read from the sheet as written (so Protected View shows the right numbers)
        var cv = function (r0, key) { var v = A.ws.getRow(r0).getCell(colN(A.L[key])).value; if (v && typeof v === 'object') v = v.result; return v; };
        var a = { pfc: 0, obj: 0, est: 0, n: 0, gp: 0, go: 0, ng: 0, nO: 0, mfc: 0, msys: 0, nm: 0 };
        for (var rr = 6; rr <= A.last; rr++) {
          var lv = cv(rr, 'lvl');
          if (lv === 'Market') {
            if (LK.type === 'DM2' ? cv(rr, 'dm2') !== x.dm2 : LK.type === 'DM1' ? cv(rr, 'dm') !== x.dm1 : false) continue;
            if (fin(cv(rr, 'mfc'))) { a.mfc += cv(rr, 'mfc'); a.nm++; } if (fin(cv(rr, 'msys'))) a.msys += cv(rr, 'msys');
            continue;
          }
          if (lv !== 'Item' || cv(rr, 'dm') !== x.dm1 || cv(rr, 'dm2') !== x.dm2) continue;
          var pf = cv(rr, 'pfc'), ob = cv(rr, 'obj'), es = cv(rr, 'est');
          if (fin(ob) && ob >= 0) { a.obj += ob; a.nO++; }
          if (fin(pf) && pf >= 0) { a.pfc += pf; a.n++; a.est += fin(es) ? es : 0; if (fin(ob) && ob >= 0) { a.gp += pf; a.go += ob; a.ng++; } }
        }
        return { R: R, crit: crit, mcrit: mcrit, a: a };
      };
      var o = {}, S = mk(LK.su), Vv = LK.val ? mk(LK.val) : null, P = S.crit + ',' + S.R('pfc') + ',">=0"', O = S.crit + ',' + S.R('obj') + ',">=0"';
      var a = S.a, vw = function (A2, sys, stat) { var b = A2.a; if (LK.type === 'DM2') return b.nm ? b.mfc : stat; return b.nm && b.msys ? sys * b.mfc / b.msys : stat; };
      if (x.ni) {
      o.sfe = fx('IF(COUNTIFS(' + P + ')=0,"",SUMIFS(' + S.R('pfc') + ',' + P + '))', a.n ? a.pfc : '');
      o.obj = fx('IF(COUNTIFS(' + O + ')=0,"",SUMIFS(' + S.R('obj') + ',' + O + '))', a.nO ? a.obj : '');
      o.sfele = fx('IF(COUNTIFS(' + P + ')=0,"",SUMIFS(' + S.R('est') + ',' + P + '))', a.n ? a.est : '');
      o.npn = fx('COUNTIFS(' + P + ')', a.n);
      o.np = fx('COUNTIFS(' + P + ')&" of ' + x.ni + '"', a.n + ' of ' + x.ni);
      o.gap = fx('IF(COUNTIFS(' + P + ',' + S.R('obj') + ',">=0")=0,"",SUMIFS(' + S.R('pfc') + ',' + P + ',' + S.R('obj') + ',">=0")-SUMIFS(' + S.R('obj') + ',' + P + ',' + S.R('obj') + ',">=0"))', a.ng ? a.gp - a.go : '');
      }
      if (fin(x.mfc)) o.mview = fx(LK.type === 'DM2' ? 'IF(COUNTIFS(' + S.mcrit + ')=0,' + x.mview + ',SUMIFS(' + S.R('mfc') + ',' + S.mcrit + '))' : 'IFERROR(' + x.mfc + '*SUMIFS(' + S.R('mfc') + ',' + S.mcrit + ')/SUMIFS(' + S.R('msys') + ',' + S.mcrit + '),' + x.mview + ')', vw(S, x.mfc, x.mview));
      if (Vv) {
        var PV = Vv.crit + ',' + Vv.R('pfc') + ',">=0"', OV = Vv.crit + ',' + Vv.R('obj') + ',">=0"';
        var b = Vv.a;
        if (x.ni) {
        o.vsfe = fx('IF(COUNTIFS(' + PV + ')=0,"",SUMIFS(' + Vv.R('pfc') + ',' + PV + '))', b.n ? b.pfc : '');
        o.vobj = fx('IF(COUNTIFS(' + OV + ')=0,"",SUMIFS(' + Vv.R('obj') + ',' + OV + '))', b.nO ? b.obj : '');
        o.vsfele = fx('IF(COUNTIFS(' + PV + ')=0,"",SUMIFS(' + Vv.R('est') + ',' + PV + '))', b.n ? b.est : '');
        o.vgap = fx('IF(COUNTIFS(' + PV + ',' + Vv.R('obj') + ',">=0")=0,"",SUMIFS(' + Vv.R('pfc') + ',' + PV + ',' + Vv.R('obj') + ',">=0")-SUMIFS(' + Vv.R('obj') + ',' + PV + ',' + Vv.R('obj') + ',">=0"))', b.ng ? b.gp - b.go : '');
        }
        if (fin(x.vfc)) o.vview = fx(LK.type === 'DM2' ? 'IF(COUNTIFS(' + Vv.mcrit + ')=0,' + x.vview + ',SUMIFS(' + Vv.R('mfc') + ',' + Vv.mcrit + '))' : 'IFERROR(' + x.vfc + '*SUMIFS(' + Vv.R('mfc') + ',' + Vv.mcrit + ')/SUMIFS(' + Vv.R('msys') + ',' + Vv.mcrit + '),' + x.vview + ')', vw(Vv, x.vfc, x.vview));
      }
      if (LK.pk) {   // packs: the same sums on "All markets Packs"
        var Pk = mk(LK.pk), c2 = Pk.a, PP = Pk.crit + ',' + Pk.R('pfc') + ',">=0"', OP = Pk.crit + ',' + Pk.R('obj') + ',">=0"';
        if (x.ni) {
          o.psfe = fx('IF(COUNTIFS(' + PP + ')=0,"",SUMIFS(' + Pk.R('pfc') + ',' + PP + '))', c2.n ? c2.pfc : '');
          o.pobj = fx('IF(COUNTIFS(' + OP + ')=0,"",SUMIFS(' + Pk.R('obj') + ',' + OP + '))', c2.nO ? c2.obj : '');
          o.psfele = fx('IF(COUNTIFS(' + PP + ')=0,"",SUMIFS(' + Pk.R('est') + ',' + PP + '))', c2.n ? c2.est : '');
          o.pgap = fx('IF(COUNTIFS(' + PP + ',' + Pk.R('obj') + ',">=0")=0,"",SUMIFS(' + Pk.R('pfc') + ',' + PP + ',' + Pk.R('obj') + ',">=0")-SUMIFS(' + Pk.R('obj') + ',' + PP + ',' + Pk.R('obj') + ',">=0"))', c2.ng ? c2.gp - c2.go : '');
        }
        if (fin(x.pfc2)) o.pview = fx(LK.type === 'DM2' ? 'IF(COUNTIFS(' + Pk.mcrit + ')=0,' + x.pview + ',SUMIFS(' + Pk.R('mfc') + ',' + Pk.mcrit + '))' : 'IFERROR(' + x.pfc2 + '*SUMIFS(' + Pk.R('mfc') + ',' + Pk.mcrit + ')/SUMIFS(' + Pk.R('msys') + ',' + Pk.mcrit + '),' + x.pview + ')', vw(Pk, x.pfc2, x.pview));
      }
      return o;
    }
    xHeader(ws, HR, C);
    rows.forEach(function (x, i) {
      var R = r0 + i, row = ws.getRow(R), rt = ratio(R, x);
      var lf = liveF(x);
      ['sfe', 'obj', 'sfele', 'npn', 'gap', 'mview', 'vsfe', 'vobj', 'vsfele', 'vgap', 'vview', 'np', 'psfe', 'pobj', 'psfele', 'pgap', 'pview'].forEach(function (k3) { if (lf[k3] !== undefined) { var rv = lf[k3].result; x[k3] = rv === '' || rv === undefined ? null : rv; } });
      rt = ratio(R, x);
      C.forEach(function (c, j) { var cell = row.getCell(j + 1); cell.value = lf[c.k] !== undefined ? lf[c.k] : rt[c.k] !== undefined ? rt[c.k] : (x[c.k] == null ? null : x[c.k]); style(cell, c); });
    });
    // TOTAL row (SUBTOTAL 109 = sum of visible rows only)
    var T = {}; C.forEach(function (c) { if (c.s) T[c.k] = rows.reduce(function (a, x) { return a + (fin(x[c.k]) ? x[c.k] : 0); }, 0); });
    ['obj', 'sfe', 'sfele', 'vobj', 'vsfe', 'pobj', 'psfe'].forEach(function (k2) { if (!rows.some(function (x) { return fin(x[k2]); })) T[k2] = null; });
    var tr = ws.getRow(TR), trt = ratio(TR, T);
    C.forEach(function (c, j) {
      var cell = tr.getCell(j + 1);
      if (j === 0) cell.value = HR0 ? 'TOTAL of the rows kept by the filters ▼' : 'TOTAL (filtered rows)';
      else if (c.s) cell.value = rows.length ? fx('SUBTOTAL(109,' + L[c.k] + r0 + ':' + L[c.k] + last + ')', fin(T[c.k]) ? T[c.k] : 0) : null;
      else if (trt[c.k] !== undefined) cell.value = trt[c.k];
      style(cell, c, true);
    });
    ['obj', 'sfe', 'sfele', 'vobj', 'vsfe', 'pobj', 'psfe'].forEach(function (k2) {   // blank (not 0) when nothing planned, so the ratios stay blank
      if (L[k2]) { var cl = tr.getCell(C.findIndex(function (c) { return c.k === k2; }) + 1); cl.value = rows.length ? fx('IF(SUBTOTAL(109,' + L[k2] + r0 + ':' + L[k2] + last + ')=0,"",SUBTOTAL(109,' + L[k2] + r0 + ':' + L[k2] + last + '))', fin(T[k2]) ? T[k2] : '') : null; }
    });
    C.forEach(function (c, j) { if (c.hid) ws.getColumn(j + 1).hidden = true; });
    ws.autoFilter = { from: { row: HR, column: 1 }, to: { row: Math.max(HR, last), column: C.filter(function (c) { return !c.hid; }).length } };
    ws.views = [{ state: 'frozen', xSplit: HR0 ? 0 : 4, ySplit: HR, showGridLines: false }];
    return { rows: rows, L: L, r0: r0, last: last, HR: HR, pk: !!(LK && LK.pk) };
  }

  // 2026-10-19 (Ahmed: "Summary with this format" + "I need to select and deselect"): Summary sheet = the one-market layout
  // (Market / Zeta / FY plan) for ALL Zeta, in Standard Units, Value (EGP) and Packs side by side (2026-10-20: packs added).
  // Below it, one row per DM2 market inside each Zeta DM1 with Excel filter buttons: tick / untick any Business unit, Line,
  // Market (DM1) or DM2. Every number above is SUBTOTAL(109) = visible rows only.
  function xZetaFront(ws, Dt, ty, py) {
    var pn = PN(), V = hasVal(), PKx = !!Dt.pk, rows = Dt.rows, L = Dt.L, r0 = Dt.r0, last = Math.max(Dt.r0, Dt.last), HR = Dt.HR;
    var MS = [0].concat(V ? [1] : []).concat(PKx ? [2] : []), COL = ['B', 'C', 'D'], CM = 'E', NC = 5;
    var KEY = { mat: ['mmat', 'vmat', 'pmat'], matpy: ['mmatpy', 'vmatpy', 'pmatpy'], le: ['mle', 'vle', 'ple'], fc: ['mfc', 'vfc', 'pfc2'], view: ['mview', 'vview', 'pview'],
      zmat: ['zmat', 'zvmat', 'zpmat'], zle: ['zle', 'zvle', 'zple'], obj: ['obj', 'vobj', 'pobj'], sfe: ['sfe', 'vsfe', 'psfe'], sfele: ['sfele', 'vsfele', 'psfele'], gap: ['gap', 'vgap', 'pgap'] };
    [46, 20, 22, 20, 44].forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    var A = function (row, txt, o) { var c = ws.getCell('A' + row); c.value = txt; c.font = Object.assign({ size: 10, color: { argb: XC.ink } }, o || {}); return c; };
    var HD = ['Standard Units', 'Value (EGP)', 'Packs'];
    var band = function (row, txt, heads) {
      for (var cI = 1; cI <= NC; cI++) ws.getRow(row).getCell(cI).fill = xFill(XC.navy);
      var c1 = ws.getCell('A' + row); c1.value = txt; c1.font = { bold: true, size: 12, color: { argb: XC.white } };
      if (heads) { MS.forEach(function (m) { var c = ws.getCell(COL[m] + row); c.value = HD[m]; c.font = { bold: true, size: 9, color: { argb: XC.white } }; c.alignment = { horizontal: 'right' }; });
        var cc = ws.getCell(CM + row); cc.value = 'Comment'; cc.font = { bold: true, size: 9, color: { argb: XC.white } }; }
    };
    for (var cI = 1; cI <= NC; cI++) ws.getRow(1).getCell(cI).fill = xFill(XC.navy);
    var t = ws.getCell('A1'); t.value = 'Market Growth Forecast — FY' + ty + ' plan · all Zeta'; t.font = { bold: true, size: 16, color: { argb: XC.white } }; ws.getRow(1).height = 30;
    var t2 = ws.getCell('A2'); t2.value = 'FILTER: use the ▼ buttons on the table header (row ' + HR + ') — tick / untick Business unit, Line, Market (DM1), DM2 (any number). Every number here adds up only the rows you keep.';
    t2.font = { size: 10, bold: true, color: { argb: 'FF7C3AED' } };
    ws.getCell('A3').value = pn + ' forecast of ' + userLabel() + ' (plans saved on this computer) · IQVIA data to ' + per(D.meta.data_period) + ' · exported ' + new Date().toLocaleString() + (PKx ? ' · Packs = SU ÷ IQVIA pack size' : ''); ws.getCell('A3').font = { size: 9, color: { argb: XC.grey } };
    var rng = function (key) { return '$' + L[key] + '$' + r0 + ':$' + L[key] + '$' + last; };
    var S = function (key) { return 'SUBTOTAL(109,' + rng(key) + ')'; };
    var NZ = function (key) { return 'IF(SUBTOTAL(109,' + rng(key) + ')=0,"",SUBTOTAL(109,' + rng(key) + '))'; };   // blank when nothing planned
    var tot = function (key) { return rows.reduce(function (a, x) { return a + (fin(x[key]) ? x[key] : 0); }, 0); };
    var any = function (key) { return rows.some(function (x) { return fin(x[key]); }); };
    var g = function (a, b) { return fin(a) && fin(b) && b !== 0 ? a / b - 1 : ''; }, d = function (a, b) { return fin(a) && fin(b) && b !== 0 ? a / b : ''; };
    var row = 4;
    // one line: cell(m, R) returns the cell value for measure m (0 SU, 1 value, 2 packs); R = this row's number
    var put = function (lbl, cell, fmt, cmt, o) {
      A(row, lbl, o && o.bold ? { bold: true } : null);
      MS.forEach(function (m) { var c = ws.getCell(COL[m] + row); c.value = cell(m, row); c.numFmt = fmt; c.font = { size: 10, bold: !!(o && o.bold), color: { argb: XC.ink } }; c.alignment = { horizontal: 'right' }; });
      if (cmt) { var cc = ws.getCell(CM + row); cc.value = cmt; cc.font = { size: 9, color: { argb: XC.grey } }; }
      for (var q = 1; q <= NC; q++) { var cq = ws.getRow(row).getCell(q); cq.border = { bottom: { style: 'hair', color: { argb: XC.line } } }; if (o && o.fill) cq.fill = xFill(o.fill); }
      return row++;
    };
    var k = function (name, m) { return KEY[name][m]; };
    band(row++, 'Market', true);
    var rM = put('Market ' + matLbl(), function (m) { return fx(S(k('mat', m)), tot(k('mat', m))); }, XF.n);
    put('Market growth vs previous MAT', function (m) { return fx('IFERROR(' + COL[m] + rM + '/' + S(k('matpy', m)) + '-1,"")', g(tot(k('mat', m)), tot(k('matpy', m)))); }, XF.g);
    var rL = put('Market ' + py + ' full year (estimate)', function (m) { return fx(S(k('le', m)), tot(k('le', m))); }, XF.n, 'Actual Jan-' + MON[D.meta.partial_months - 1] + ' + forecast to December');
    var rS = put('Market FY' + ty + ' forecast — system (objective basis)', function (m) { return fx(S(k('fc', m)), tot(k('fc', m))); }, XF.n, 'IQVIA forecast (DM2 markets add up to their DM1)');
    var rV = put(pn + ' market FY' + ty + ' (' + pn + ' view)', function (m) { return fx(S(k('view', m)), tot(k('view', m))); }, XF.n, 'System forecast, moved where ' + pn + ' edited a market', { bold: true });
    put('Market growth FY' + ty + ' vs ' + py, function (m) { return fx('IFERROR(' + COL[m] + rV + '/' + COL[m] + rL + '-1,"")', g(tot(k('view', m)), tot(k('le', m)))); }, XF.g, null, { bold: true });
    band(row++, 'Zeta', true);
    var rZ = put('Zeta ' + matLbl(), function (m) { return fx(S(k('zmat', m)), tot(k('zmat', m))); }, XF.n);
    put('Zeta share ' + matLbl(), function (m) { return fx('IFERROR(' + COL[m] + rZ + '/' + COL[m] + rM + ',"")', d(tot(k('zmat', m)), tot(k('mat', m)))); }, XF.p2);
    var rE = put('Zeta ' + py + ' full year (estimate)', function (m) { return fx(S(k('zle', m)), tot(k('zle', m))); }, XF.n, 'Actual YTD + remaining months at the YTD share');
    band(row++, 'FY' + ty + ' plan', true);
    var rO = put('Objective FY' + ty, function (m) { return fx(NZ(k('obj', m)), any(k('obj', m)) ? tot(k('obj', m)) : ''); }, XF.n, 'Sum of the item objectives (Defend / Grow rule)', { fill: XC.obj });
    put('Objective share', function (m) { return fx('IF(' + COL[m] + rO + '="","",IFERROR(' + COL[m] + rO + '/' + COL[m] + rS + ',""))', any(k('obj', m)) ? d(tot(k('obj', m)), tot(k('fc', m))) : ''); }, XF.p2, null, { fill: XC.obj });
    put('Objective growth vs ' + py, function (m) { return fx('IF(' + COL[m] + rO + '="","",IFERROR(' + COL[m] + rO + '/' + COL[m] + rE + '-1,""))', any(k('obj', m)) ? g(tot(k('obj', m)), tot(k('zle', m))) : ''); }, XF.g, null, { fill: XC.obj });
    var rP = put(pn + ' forecast', function (m) { return fx(NZ(k('sfe', m)), any(k('sfe', m)) ? tot(k('sfe', m)) : ''); }, XF.n, null, { bold: true, fill: XC.plan });
    ws.getCell(CM + rP).value = fx('"' + pn + ' planned "&' + S('npn') + '&" of "&' + S('ni') + '&" items"', pn + ' planned ' + tot('npn') + ' of ' + tot('ni') + ' items'); ws.getCell(CM + rP).font = { size: 9, color: { argb: XC.grey } };
    put(pn + ' share', function (m) { return fx('IF(' + COL[m] + rP + '="","",IFERROR(' + COL[m] + rP + '/' + COL[m] + rV + ',""))', any(k('sfe', m)) ? d(tot(k('sfe', m)), tot(k('view', m))) : ''); }, XF.p2, null, { fill: XC.plan });
    put(pn + ' growth vs ' + py + ' (like-for-like)', function (m) { return fx('IF(' + COL[m] + rP + '="","",IFERROR(' + COL[m] + rP + '/' + S(k('sfele', m)) + '-1,""))', any(k('sfe', m)) ? g(tot(k('sfe', m)), tot(k('sfele', m))) : ''); }, XF.g, 'vs the ' + py + ' estimate of the planned items only', { fill: XC.plan });
    put(pn + ' vs objective', function (m) { return fx('IF(' + COL[m] + rP + '="","",' + S(k('gap', m)) + ')', any(k('sfe', m)) ? tot(k('gap', m)) : ''); }, XF.d, 'Planned items only', { fill: XC.plan });
    return row;   // first free row (the table starts below)
  }
  function suSeg(r) { return (D_SU && r ? D_SU.segments.find(function (q) { return q.type === r.type && q.name === r.name; }) : null) || r; }
  function exportPro(r0x) {
    loadExcelJS(function () { withMeasD(false, function () {
      try {
        var r = suSeg(r0x), PKon = hasPK();
        var m = D.meta, ty = m.target_year, py = m.partial_year, wb = new window.ExcelJS.Workbook();
        wb.creator = 'Zeta Intel Dashboard'; wb.created = new Date(); wb.title = 'Market Growth Forecast FY' + ty + ' — ' + r.name;
        wb.calcProperties = { fullCalcOnLoad: true };
        var zf = wb.addWorksheet('Summary', { properties: { tabColor: { argb: 'FF7C3AED' } }, views: [{ showGridLines: false }] });
        var sum = wb.addWorksheet('This market', { properties: { tabColor: { argb: XC.navy } }, views: [{ showGridLines: false }] });
        var S = xMeasureSheet(wb, r, 0, ty, py, 'SU'), V = hasVal() ? xMeasureSheet(wb, r, 1, ty, py, 'SU', S.T.L) : null;
        var withPKX = function (fn) { return withMeasD(true, function () { PKX = true; try { return fn(); } finally { PKX = false; } }); };
        var PS = PKon ? withPKX(function () { return xMeasureSheet(wb, pkData().segments.find(function (q) { return q.type === r.type && q.name === r.name; }) || r, 1, ty, py, 'SU', S.T.L); }) : null;
        if (PS) { pkSheetText(PS.ws); PS.ws.properties.tabColor = { argb: 'FF0E7490' }; }
        xSummary(sum, r, ty, py, S, V);
        var AS = xAllSheet(wb, r, 0, ty, py, 'All markets SU');
        var AV = hasVal() ? xAllSheet(wb, r, 1, ty, py, 'All markets SU', AS.L) : null;
        var AP = PKon ? withPKX(function () { return xAllSheet(wb, r, 1, ty, py, 'All markets SU', AS.L); }) : null;
        if (AP) { pkSheetText(AP.ws); AP.ws.properties.tabColor = { argb: 'FF67E8F9' }; }
        var zrows = 4 + 1 + 6 + 1 + 3 + 1 + 7;   // summary block height (title rows 1-3, three sections) -> band, TOTAL, header
        var zb = zrows + 1; for (var zc = 1; zc <= 4; zc++) zf.getRow(zb).getCell(zc).fill = xFill('FF7C3AED');
        zf.getCell('A' + zb).value = 'Detail by market — ▼ tick / untick to filter (the summary above follows)'; zf.getCell('A' + zb).font = { bold: true, size: 12, color: { argb: XC.white } };
        xZetaFront(zf, xZetaSummary(zf, ty, py, zb + 2, { type: r.type, su: AS, val: AV, pk: AP }), ty, py);
        xNotes(wb, ty, py);
        try { xFillCache(wb); } catch (e) { console.warn('[MarketForecast] cache fill', e); }
        var fn = 'Zeta_FY' + ty + '_Plan_' + PN() + '_' + safeName(r.name) + '.xlsx';
        wb.xlsx.writeBuffer().then(function (buf) {
          if (window.__MF_XLSX_SINK) return window.__MF_XLSX_SINK(buf, fn);
          var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = fn; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        }).catch(function (e) { console.error('[MarketForecast] pro export', e); alert('Excel export failed: ' + (e && e.message || e)); });
      } catch (e) { console.error('[MarketForecast] pro export', e); alert('Excel export failed: ' + (e && e.message || e)); }
    }); });
  }
  // 2026-10-20 (Ahmed: "Excel download template: SFE FCST in 3 sheets — total market SU, Value, Packs; value and packs
  // calculated from SU; BU / Line filters dynamic with each other; market YTD, estimate 2026, market growth, Zeta share,
  // market 2027 + growth, Zeta target share 2027 + growth; change market growth %, Zeta share %, Zeta growth %"):
  // one row per Zeta market (DM1). Markets split into DM2 markets (NEXICURE PLUS = capsules + sachets, ELEMBOSIS 5 / 2.5)
  // get one row per DM2 market under the total: the inputs sit on the DM2 rows and the total row adds them up.
  // Inputs (SU sheet only): market growth 2027 %, Zeta target share 2027 %, Zeta growth 2027 % (optional, wins when filled).
  // Value / Packs = SU x price per SU / packs per SU (today, as on the dashboard) of each row. TOTAL row = visible rows only.
  function sfeTplRows() {   // rows of the active data (SU + value slots; with the packs data the value slots hold packs)
    var m = D.meta, ly = String(m.full_years[m.full_years.length - 1]), dd = ((m.links || {}).dm1_dm2) || {}, out = [];
    var one = function (q, lvl, dm1, dm2, bu, line) {
      var f = q.forecast || {}, vv = q.value || {}, yt = q.ytd || {}, vy = vv.ytd || {};
      var z = withAll(q, function () { return zdata(q); }), P = withAll(q, function () { return zplan(q); }), B = P.bex && fin(P.bex.su) ? P.bex : null;
      var zy = (z.ytd || {}).su || 0, zyv = (z.ytd || {}).val || 0, le = withAll(q, function () { return zLE(q, zy, zyv); });
      var mk = B && B.mktEdited ? B.mkt : f.fy_target, z27 = B ? B.su : (P.present && fin(P.objSU) ? P.objSU : null);
      var zpx = B && B.su > 0 && fin(B.val) ? B.val / B.su : (P.present && P.objSU > 0 && fin(P.objVal) ? P.objVal / P.objSU : z.price_su);
      return { lvl: lvl, dm1: dm1, dm2: dm2, bu: bu, line: line, br: ((z.brands && z.brands.length ? z.brands : ((((q.scorecard || {}).zeta) || {}).brands || [])) || []).join(', '),
        src: B ? PN() + ' plan' + (B.saved ? ' (saved ' + B.saved + ')' : '') : P.present ? 'Objective (' + P.strategy + ')' : (zy > 0 ? 'No plan — type the share' : 'No Zeta sales'),
        su: { y25: yt.py, y26: yt.cur, a25: (f.fy_last_actual || {}).su, le: f.fy_le, m27: mk, zy: zy, zle: le.su, z27: z27 },
        v: { y25: vy.py, y26: vy.cur, a25: (vv.history || {})[ly], le: vv.fy_le, mpx: f.fy_target > 0 && fin(vv.fy_target) ? vv.fy_target / f.fy_target : null, zy: zyv, zle: le.val, zpx: zpx } };
    };
    segs('DM1').filter(function (q) { var it = ((((q.scorecard || {}).zeta) || {}).items || []); return it.length && (it[0] || {}).years; }).forEach(function (q) {
      var bu = orgOf('BU', [q.name]), line = orgOf('Line', [q.name]), subs = (dd[q.name] || []).filter(function (n) { return n !== q.name; })
        .map(function (n) { return D.segments.find(function (x) { return x.type === 'DM2' && x.name === n; }); }).filter(Boolean);
      var g = { tot: one(q, 'Market total', q.name, subs.length >= 2 ? '(total of DM2 markets)' : '—', bu, line), subs: [] };
      if (subs.length >= 2) g.subs = subs.map(function (s) { return one(s, 'Sub-market', q.name, s.name, bu, line); });
      out.push(g);
    });
    out.sort(function (a, b) { return (a.tot.bu || '~').localeCompare(b.tot.bu || '~') || (a.tot.line || '~').localeCompare(b.tot.line || '~') || ((b.tot.su.le || 0) - (a.tot.su.le || 0)); });
    return out;
  }
  function exportSfeTpl() {
    loadExcelJS(function () { withMeasD(false, function () {
      try {
        var m = D.meta, ty = m.target_year, py = m.partial_year, ly = m.full_years[m.full_years.length - 1], pn = PN(), mon = 'Jan-' + MON[m.partial_months - 1];
        var G = sfeTplRows(), PKon = hasPK(), GP = PKon ? withMeasD(true, function () { return sfeTplRows(); }) : null;
        if (GP && (GP.length !== G.length || GP.some(function (g, i) { return g.tot.dm1 !== G[i].tot.dm1 || g.subs.length !== G[i].subs.length; }))) GP = null;   // safety: rows must match 1:1
        var wb = new window.ExcelJS.Workbook(); wb.creator = 'Zeta Intel Dashboard'; wb.created = new Date(); wb.title = pn + ' FCST FY' + ty; wb.calcProperties = { fullCalcOnLoad: true };
        var n0 = function (v) { return fin(v) ? v : null; }, gr = function (a, b) { var q = fin(a) && fin(b) && b !== 0 ? a / b : null; return q == null ? null : q - 1; }, dv = function (a, b) { return fin(a) && fin(b) && b !== 0 ? a / b : null; }, sum = function (a, k, s) { var t = 0, any = false; a.forEach(function (x) { var v = x[s][k]; if (fin(v)) { t += v; any = true; } }); return any ? t : null; };
        // plan model in SU (defaults) -> cached values
        var flat = []; G.forEach(function (g) { flat.push({ r: g.tot, g: g, total: true }); g.subs.forEach(function (s) { flat.push({ r: s, g: g, total: false }); }); });
        flat.forEach(function (x) { var s = x.r.su; x.mg = s.le > 0 && fin(s.m27) ? s.m27 / s.le - 1 : null; x.tsh = fin(s.z27) && s.m27 > 0 ? s.z27 / s.m27 : null; });
        var HR = 5, R0 = HR + 1, RN = R0 + flat.length - 1;
        var mk = function (k) {   // k: 0 SU, 1 value, 2 packs
          var nm = ['Total market SU', 'Total market Value', 'Total market Packs'][k], U = ['SU', 'EGP', 'packs'][k], S = k ? (k === 2 ? 'v' : 'v') : 'su';
          var ws = wb.addWorksheet(nm, { properties: { tabColor: { argb: ['FF2563EB', 'FF16A34A', 'FF0E7490'][k] } } });
          // 2026-10-20 (Ahmed): column order = BU, Line (filters first), market, YTD 2026 + growth, market 2026, Zeta share 2026 % + value,
          // market 2027 + growth, Zeta share 2027 % + value + growth. Inputs (SU sheet): market growth 2027 % and SFE share 2027 %.
          var C = [['bu', 'Business unit ▼', 16], ['line', 'Line ▼', 18], ['dm1', 'Market (DM1)', 30], ['dm2', 'Sub-market (DM2)', 28], ['lvl', 'Level', 12], ['br', 'Zeta brand(s)', 18],
            ['y26', 'Market YTD ' + py + ' (' + mon + ')', 15, 'm'], ['yg', 'Market YTD growth vs ' + (py - 1), 11, 'm'], ['le', 'Market size ' + py + ' (estimate)', 15, 'm'],
            ['zsh', 'Zeta share ' + py + ' (estimate) %', 11, 'z'], ['zle', 'Zeta ' + py + ' (estimate)', 14, 'z']]
            .concat(k ? [['mpx', (k === 2 ? 'Packs per SU' : 'Price per SU (EGP)') + ' — market', 11, 'm']] : [])
            .concat([['m27', 'Market size ' + ty, 15, 'p'], ['mg', 'Market growth ' + ty + (k ? '' : ' % — INPUT'), 11, 'p']])
            .concat(k ? [['zpx', (k === 2 ? 'Packs per SU' : 'Price per SU (EGP)') + ' — Zeta', 11, 'z'], ['zsh27', 'Zeta share ' + ty + ' %', 11, 'p']] : [['tsh', pn + ' Zeta share ' + ty + ' % — INPUT', 12, 'p']])
            .concat([['z27', 'Zeta ' + ty + ' (' + pn + ' FCST)', 15, 'p'], ['zg27', 'Zeta growth ' + ty + ' vs ' + py, 11, 'p'], ['dp', 'Share change (pts)', 10, 'p']])
            .concat(k ? [] : [['src', 'Pre-filled from', 26]]).concat([['y25', 'Market YTD ' + (py - 1) + ' (helper)', 6], ['zy', 'Zeta YTD ' + py + ' (helper)', 6], ['vis', 'visible (helper)', 6], ['inc', 'in TOTAL (helper)', 6]]);
          var L = {}; C.forEach(function (c, i) { L[c[0]] = colL(i + 1); ws.getColumn(i + 1).width = c[2]; });
          for (var hc = C.length - 3; hc <= C.length; hc++) ws.getColumn(hc).hidden = true;
          var t = ws.getCell('A1'); t.value = pn + ' FCST FY' + ty + ' — total market ' + ['Standard Units', 'Value (EGP)', 'Packs'][k] + ' · Zeta markets'; t.font = { bold: true, size: 15, color: { argb: XC.navy } };
          ws.getCell('A2').value = k ? (k === 2 ? 'Packs' : 'Value') + ' is calculated from the "Total market SU" sheet: SU × ' + (k === 2 ? 'packs per SU (last 6 months pack mix)' : 'price per SU (today, no new price increase)') + ' of each row. Change the inputs on the SU sheet.'
            : 'Type in the YELLOW cells: market growth ' + ty + ' % and ' + pn + ' Zeta share ' + ty + ' %. Market size ' + ty + ', Zeta ' + ty + ' and Zeta growth follow, and so do the Value and Packs sheets. Markets split into DM2 markets: type on the DM2 rows; the total row adds them up.';
          ws.getCell('A2').font = { size: 9, color: { argb: XC.grey } };
          ws.getCell('A3').value = '▼ Filter Business unit / Line / Market on the header row (tick / untick; each list shows only what fits the other filters). The TOTAL row adds up only the visible rows (no double counting of total and DM2 rows). IQVIA data to ' + per(m.data_period) + '.';
          ws.getCell('A3').font = { size: 9, color: { argb: XC.grey } };
          var H = ws.getRow(HR); C.forEach(function (c, i) { var cell = H.getCell(i + 1); cell.value = c[1]; cell.font = { bold: true, color: { argb: XC.white }, size: 10 };
            cell.fill = xFill(/INPUT/.test(c[1]) ? 'FFB45309' : c[3] === 'p' ? XC.planH : c[3] === 'z' ? 'FF7C3AED' : c[3] === 'm' ? 'FF3B5B8C' : XC.navy);
            cell.alignment = { wrapText: true, vertical: 'middle', horizontal: i < 6 ? 'left' : 'center' }; cell.border = xBorder(XC.navy); }); H.height = 58;
          var FM = { y25: XF.n, y26: XF.n, yg: XF.g, a25: XF.n, le: XF.n, leg: XF.g, mpx: k === 2 ? '0.0000' : XF.px, mg: XF.g, m27: XF.n, zy: XF.n, zle: XF.n, zsh: XF.p2, zpx: k === 2 ? '0.0000' : XF.px, tsh: XF.p2, tg: XF.g, z27: XF.n, zsh27: XF.p2, zg27: XF.g, dp: XF.pts };
          var ref = function (key, row) { return L[key] + row; }, su = function (key, row) { return qs('Total market SU') + '!' + L0[key] + row; };
          var row = R0, vals = [];
          G.forEach(function (g, gi) {
            var a = row + 1, b = row + g.subs.length, gp = GP ? GP[gi] : null;
            [g.tot].concat(g.subs).forEach(function (r, j) {
              var x = flat[row - R0], R = ws.getRow(row), split = j === 0 && g.subs.length > 0, rv = k === 2 ? (j ? gp.subs[j - 1] : gp.tot).v : r.v, s = r.su, V = {};
              var put = function (key, v, fmt) { if (!L[key]) return null; var c = R.getCell(L[key]); c.value = v; if (fmt || FM[key]) c.numFmt = fmt || FM[key]; return c; };
              ['bu', 'line', 'dm1', 'dm2', 'lvl', 'br'].forEach(function (kk) { put(kk, r[kk] || null); });
              var src = k ? rv : s, base = ['y25', 'y26', 'a25', 'le', 'zy', 'zle'];
              // numbers of this row (for cached results)
              if (!k) { V.mg = x.mg; V.m27 = s.m27; V.tsh = x.tsh; V.z27 = s.z27; }
              else { var mp = rv.mpx, zp = rv.zpx; V.m27 = fin(s.m27) && fin(mp) ? s.m27 * mp : null; V.z27 = fin(s.z27) && fin(zp) ? s.z27 * zp : null; V.mpx = mp; V.zpx = zp; }
              base.forEach(function (kk) { V[kk] = src[kk]; });
              x['V' + k] = V;
              if (split) { R.getCell(1).value = r.bu || null; row++; return; }   // written after its sub-rows (needs their values)
              base.forEach(function (kk) { put(kk, n0(V[kk])); });
              if (!k) {
                if (s.le > 0) { var ci = put('mg', fin(x.mg) ? x.mg : 0); xInput(ci, XF.g, 'gr'); put('m27', fx(ref('le', row) + '*(1+' + ref('mg', row) + ')', s.m27)); }
                else { put('mg', fx('IFERROR(' + ref('m27', row) + '/' + ref('le', row) + '-1,"")', '')); var cm = put('m27', n0(s.m27)); xInput(cm, XF.n, 'num'); }
                var ct = put('tsh', n0(x.tsh)); xInput(ct, XF.p2, 'share');
                put('z27', fx('IF(' + ref('tsh', row) + '="","",' + ref('m27', row) + '*' + ref('tsh', row) + ')', fin(s.z27) ? s.z27 : ''));
                put('src', r.src);
              } else {
                put('mpx', n0(V.mpx)); put('zpx', n0(V.zpx));
                put('m27', fx(su('m27', row) + '*' + ref('mpx', row), V.m27));
                put('mg', fx('IFERROR(' + ref('m27', row) + '/' + ref('le', row) + '-1,"")', dv(V.m27, V.le) != null ? dv(V.m27, V.le) - 1 : ''));
                put('z27', fx('IF(' + su('z27', row) + '="","",' + su('z27', row) + '*' + ref('zpx', row) + ')', fin(V.z27) ? V.z27 : ''));
              }
              row++;
            });
            // the split total row (above its DM2 rows): sums
            if (g.subs.length) {
              var tr = a - 1, R = ws.getRow(tr), x = flat[tr - R0], V = x['V' + k], subs = flat.slice(a - R0, b - R0 + 1);
              var put2 = function (key, v, fmt) { if (!L[key]) return null; var c = R.getCell(L[key]); c.value = v; if (fmt || FM[key]) c.numFmt = fmt || FM[key]; return c; };
              ['bu', 'line', 'dm1', 'dm2', 'lvl', 'br'].forEach(function (kk) { put2(kk, g.tot[kk] || null); });
              ['y25', 'y26', 'a25', 'le', 'm27', 'zy', 'zle', 'z27'].forEach(function (kk) {
                var t0 = 0, any = false; subs.forEach(function (sx) { var v = sx['V' + k][kk]; if (fin(v)) { t0 += v; any = true; } }); V[kk] = any ? t0 : (kk === 'z27' || kk === 'm27' ? 0 : null);
                put2(kk, fx('SUM(' + ref(kk, a) + ':' + ref(kk, b) + ')', fin(V[kk]) ? V[kk] : 0));
              });
              put2('mg', fx('IFERROR(' + ref('m27', tr) + '/' + ref('le', tr) + '-1,"")', dv(V.m27, V.le) != null ? dv(V.m27, V.le) - 1 : ''));
              if (k) { put2('mpx', fx('IFERROR(' + ref('m27', tr) + '/' + su('m27', tr) + ',"")', dv(V.m27, x.V0.m27) != null ? dv(V.m27, x.V0.m27) : ''));
                put2('zpx', fx('IFERROR(' + ref('z27', tr) + '/' + su('z27', tr) + ',"")', dv(V.z27, x.V0.z27) != null ? dv(V.z27, x.V0.z27) : '')); }
              else { put2('tsh', fx('IFERROR(' + ref('z27', tr) + '/' + ref('m27', tr) + ',"")', dv(V.z27, V.m27) != null ? dv(V.z27, V.m27) : '')); put2('src', 'Sum of the DM2 rows below'); }
              for (var c0 = 1; c0 <= C.length - 4; c0++) { var cc = R.getCell(c0); cc.font = Object.assign({}, cc.font || {}, { bold: true }); if (!(cc.fill && cc.fill.fgColor && cc.fill.fgColor.argb === XC.inFill)) cc.fill = xFill(XC.tot); }
            }
          });
          // ratio columns + helpers on every row
          for (var rr = R0; rr <= RN; rr++) {
            var x = flat[rr - R0], V = x['V' + k], R = ws.getRow(rr), P = function (key, f, v) { if (!L[key]) return; var c = R.getCell(L[key]); c.value = fx(f, fin(v) ? v : ''); c.numFmt = FM[key]; };
            P('yg', 'IFERROR(' + ref('y26', rr) + '/' + ref('y25', rr) + '-1,"")', dv(V.y26, V.y25) != null ? dv(V.y26, V.y25) - 1 : null);
            P('leg', 'IFERROR(' + ref('le', rr) + '/' + ref('a25', rr) + '-1,"")', dv(V.le, V.a25) != null ? dv(V.le, V.a25) - 1 : null);
            P('zsh', 'IFERROR(' + ref('zle', rr) + '/' + ref('le', rr) + ',"")', dv(V.zle, V.le));
            var zs27 = fin(V.z27) ? dv(V.z27, V.m27) : null, zs = dv(V.zle, V.le);
            P('zsh27', 'IF(' + ref('z27', rr) + '="","",IFERROR(' + ref('z27', rr) + '/' + ref('m27', rr) + ',""))', zs27);
            P('zg27', 'IF(' + ref('z27', rr) + '="","",IFERROR(' + ref('z27', rr) + '/' + ref('zle', rr) + '-1,""))', fin(V.z27) && dv(V.z27, V.zle) != null ? dv(V.z27, V.zle) - 1 : null);
            P('dp', 'IF(' + ref('z27', rr) + '="","",IFERROR((' + ref('z27', rr) + '/' + ref('m27', rr) + '-' + ref('zsh', rr) + ')*100,""))', fin(zs27) && fin(zs) ? (zs27 - zs) * 100 : null);
            R.getCell(L.vis).value = fx('SUBTOTAL(103,' + ref('dm1', rr) + ')', 1);
            var g = x.g, inc;
            if (x.total && g.subs.length) { var a = rr + 1, b = rr + g.subs.length; inc = fx('IF(AND(' + ref('vis', rr) + '=1,SUM(' + ref('vis', a) + ':' + ref('vis', b) + ')=0),1,0)', 0); }
            else inc = fx(ref('vis', rr), 1);
            R.getCell(L.inc).value = inc;
            for (var c1 = 1; c1 <= C.length - 4; c1++) { var cl = R.getCell(c1); if (!cl.border || !cl.border.top) cl.border = xBorder(); if (!cl.font) cl.font = { size: 10 }; }
            if (!x.total) { R.getCell(L.dm2).font = { size: 10, italic: true, color: { argb: 'FF5B21B6' } }; R.getCell(L.lvl).font = { size: 10, italic: true, color: { argb: 'FF5B21B6' } }; }
          }
          // TOTAL of the visible rows (row 4)
          var T = ws.getRow(HR - 1), TV = {};
          ['y25', 'y26', 'a25', 'le', 'm27', 'zy', 'zle', 'z27'].forEach(function (kk) { if (!L[kk]) return; var t0 = 0; flat.forEach(function (x) { if (!(x.total && x.g.subs.length)) { var v = x['V' + k][kk]; if (fin(v)) t0 += v; } }); TV[kk] = t0;
            var c = T.getCell(L[kk]); c.value = fx('SUMIFS(' + L[kk] + R0 + ':' + L[kk] + RN + ',' + L.inc + R0 + ':' + L.inc + RN + ',1)', t0); c.numFmt = FM[kk]; });
          var TP = function (key, f, v) { if (!L[key]) return; var c = T.getCell(L[key]); c.value = fx(f, fin(v) ? v : ''); c.numFmt = FM[key]; };
          var t4 = function (kk) { return L[kk] + (HR - 1); };
          TP('yg', 'IFERROR(' + t4('y26') + '/' + t4('y25') + '-1,"")', gr(TV.y26, TV.y25));
          TP('leg', 'IFERROR(' + t4('le') + '/' + t4('a25') + '-1,"")', gr(TV.le, TV.a25));
          TP('mg', 'IFERROR(' + t4('m27') + '/' + t4('le') + '-1,"")', gr(TV.m27, TV.le));
          TP('zsh', 'IFERROR(' + t4('zle') + '/' + t4('le') + ',"")', dv(TV.zle, TV.le));
          TP('zsh27', 'IFERROR(' + t4('z27') + '/' + t4('m27') + ',"")', dv(TV.z27, TV.m27));
          TP('zg27', 'IFERROR(' + t4('z27') + '/' + t4('zle') + '-1,"")', gr(TV.z27, TV.zle));
          TP('dp', 'IFERROR((' + t4('z27') + '/' + t4('m27') + '-' + t4('zsh') + ')*100,"")', (dv(TV.z27, TV.m27) - dv(TV.zle, TV.le)) * 100);
          if (!k) { TP('tsh', 'IFERROR(' + t4('z27') + '/' + t4('m27') + ',"")', dv(TV.z27, TV.m27)); }
          T.getCell(1).value = { formula: '"TOTAL — "&SUBTOTAL(103,' + L.dm1 + R0 + ':' + L.dm1 + RN + ')&" rows shown"', result: 'TOTAL — ' + flat.length + ' rows shown' };
          for (var c2 = 1; c2 <= C.length - 4; c2++) { var tc = T.getCell(c2); tc.font = { bold: true, size: 11, color: { argb: XC.white } }; tc.fill = xFill(XC.navy); tc.border = xBorder(XC.navy); }
          T.height = 22;
          ws.autoFilter = { from: { row: HR, column: 1 }, to: { row: RN, column: C.length } };
          ws.views = [{ state: 'frozen', xSplit: 4, ySplit: HR, showGridLines: false }];
          xPrint(ws, HR);
          return L;
        };
        var L0 = null; L0 = mk(0); if (hasVal()) mk(1); if (GP) mk(2);
        try { xFillCache(wb); } catch (e) { console.warn('[MarketForecast] cache fill', e); }
        var fn = 'Zeta_FY' + ty + '_' + pn + '_FCST_Template.xlsx';
        wb.xlsx.writeBuffer().then(function (buf) {
          if (window.__MF_XLSX_SINK) return window.__MF_XLSX_SINK(buf, fn);
          var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = fn; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        }).catch(function (e) { console.error('[MarketForecast] FCST template', e); alert('Excel export failed: ' + (e && e.message || e)); });
      } catch (e) { console.error('[MarketForecast] FCST template', e); alert('Excel export failed: ' + (e && e.message || e)); }
    }); });
  }
  // 2026-10-22 (Ahmed: "make Excel sheet like this [Zeta Budget > Market Sizing] downloadable with data, with items and brand"):
  // Blocks as on the budget planner: FY2026 Business Excellence (estimate), FY2027 business unit plan (INPUTS: target
  // share %, market growth %), FY2027 Business Excellence (= the SFE input on this page), Difference (BU - BE).
  // V = value (EGP), ST = standard units; Zeta V / ST in every block ("V ST 2026 Zeta estimate ... 2027 ST and V Zeta").
  // 2026-10-22 (Ahmed: "make it brand based, remove other markets; if a brand has 2 SKUs in different lines consider it
  // as a brand: ELEMBOSIS 5 is CVM-II and so on"): one row per brand x line (a brand promoted by two lines becomes two
  // rows, named with its SKU strengths, e.g. ELIMBOSIS 5MG / CVM-II and ELIMBOSIS 2.5MG / ORTHO-II); OTHER MARKET left out.
  // The row's market = the sum of the distinct DM1 markets of its SKUs; Zeta = the sum of its SKUs.
  function exportMktSizing() {
    loadExcelJS(function () { withMeasD(false, function () {
      try {
        var m = D.meta, ty = m.target_year, py = m.partial_year, pn = PN(), items = [], isOther = function (s) { return /^other/i.test(String(s || '').trim()); };
        segs('DM1').forEach(function (r) {
          if (isOther(r.name)) return;
          var its = (((r.scorecard || {}).zeta) || {}).items || []; if (!its.length || !(its[0] || {}).years) return;
          var f = r.forecast || {}, vv = r.value || {}, k = segKey(r), d = DRAFT[k] || bexSaved(r) || { items: {} };
          var mkt27 = fin(d.mkt) && d.mkt > 0 ? d.mkt : f.fy_target, mp = f.fy_target > 0 && fin(vv.fy_target) ? vv.fy_target / f.fy_target : null;
          var bu = orgOf('BU', [r.name]), line = orgOf('Line', [r.name]);
          if (isOther(bu) && isOther(line)) return;
          // 2026-10-22 (Ahmed: "NEXICURE PLUS make for capsule and sachets based on DM2"): when a brand's SKUs fall into two or
          // more DM2 markets of this DM1, each DM2 becomes its own row (market, SFE plan and Zeta of that DM2 segment).
          var bDm2 = {}; its.forEach(function (i) { var d2n = dmOf('DM2', [i.item]); if (d2n && d2n !== r.name && d2n.indexOf(' / ') < 0) { (bDm2[i.brand] = bDm2[i.brand] || {})[d2n] = 1; } });
          its.forEach(function (i) {
            var rr = r, ii = i, ff = f, v2 = vv, dd = d, m27 = mkt27, mp2 = mp, sub = '';
            var d2n = dmOf('DM2', [i.item]), s2 = Object.keys(bDm2[i.brand] || {}).length > 1 ? D.segments.find(function (x) { return x.type === 'DM2' && x.name === d2n; }) : null;
            var i2 = s2 ? ((((s2.scorecard || {}).zeta) || {}).items || []).find(function (x) { return x.item === i.item; }) : null;
            if (s2 && i2) {
              rr = s2; ii = i2; ff = s2.forecast || {}; v2 = s2.value || {}; dd = DRAFT[segKey(s2)] || bexSaved(s2) || { items: {} };
              m27 = fin(dd.mkt) && dd.mkt > 0 ? dd.mkt : ff.fy_target; mp2 = ff.fy_target > 0 && fin(v2.fy_target) ? v2.fy_target / ff.fy_target : null;
              var tail = s2.name.indexOf(r.name) === 0 ? s2.name.slice(r.name.length).replace(/^[\s_\-]+/, '') : s2.name;
              sub = ({ CAP: 'CAPSULES', CAPS: 'CAPSULES', SACH: 'SACHETS', SAC: 'SACHETS' })[tail.toUpperCase()] || tail;
            }
            var le = zLE(rr, (ii.ytd || [0, 0])[0], (ii.ytd || [0, 0])[1]), sh = (dd.items || {})[i.item];
            items.push({ bu: bu, line: line, dm: rr.name, sub: sub, brand: i.brand, item: i.item, st26: ff.fy_le, v26: v2.fy_le, z26: le.su, zv26: le.val, mp: mp2, st27: m27,
              mktEd: fin(dd.mkt) && dd.mkt > 0, sh: fin(sh) ? sh / 100 : null, s6: ii.s6 || [0, 0], zp: itemPrice(ii) });
          });
        });
        // group: brand x line
        // 2026-10-22 (Ahmed: "NEXICURE brand related to GIT-I not shown"): a brand with SKUs in two different markets of the same
        // line (NEXICURE GIT-I = PPI oral solid tablets + esomeprazole sachet 20-40MG) is split by market, named by form + strength,
        // so each row is one market and its SFE plan shows on its own (a market without a saved SFE share no longer blanks the brand).
        var FORM = [[/C\.?TABS|\bTABS?\b|\bTAB\b/, 'TABS'], [/\bSAC\b|SACHET/, 'SACHET'], [/\bHGC\b|CAPS?\b|CAPSULE/, 'CAPS'], [/\bSY\b|SYRUP/, 'SYRUP'], [/PO\.?SUS|SUSP/, 'SUSP'], [/DROPS?\b/, 'DROPS'], [/AMP|INJ|VIAL/, 'INJ']];
        var formOf = function (s) { s = String(s).toUpperCase(); for (var q = 0; q < FORM.length; q++) if (FORM[q][0].test(s)) return FORM[q][1]; return ''; };
        var strOf = function (s) { var mm = String(s).toUpperCase().match(/\d+(?:\.\d+)?\s*(?:MG|MCG|G|IU|%)/g); return mm ? mm.map(function (t) { return t.replace(/\s+/g, ''); }) : []; };
        var byBL = {}; items.forEach(function (x) { if (x.sub) return; var k2 = x.brand + '|' + x.line; (byBL[k2] = byBL[k2] || {})[x.dm] = 1; });
        items.forEach(function (x) {
          if (x.sub || Object.keys(byBL[x.brand + '|' + x.line] || {}).length < 2) return;
          var mine = items.filter(function (y) { return !y.sub && y.brand === x.brand && y.line === x.line && y.dm === x.dm; }), fo = [], st = [];
          mine.forEach(function (y) { var t1 = formOf(y.item.slice(y.brand.length)); if (t1 && fo.indexOf(t1) < 0) fo.push(t1); strOf(y.item.slice(y.brand.length)).forEach(function (t2) { if (st.indexOf(t2) < 0) st.push(t2); }); });
          x.sub2 = [fo.join('/'), st.join('/')].filter(Boolean).join(' ') || x.dm;
        });
        items.forEach(function (x) { if (x.sub2) x.sub = x.sub2; });
        var G = []; items.forEach(function (x) { var g = G.find(function (y) { return y.brand === x.brand && y.line === x.line && y.sub === x.sub; }); if (!g) G.push(g = { brand: x.brand, line: x.line, sub: x.sub, bu: x.bu, its: [] }); g.its.push(x); });
        var split = {}; G.forEach(function (g) { split[g.brand] = (split[g.brand] || 0) + 1; });
        var strength = function (s) { var mm = String(s).toUpperCase().match(/\d+(?:\.\d+)?\s*(?:MG|MCG|G|IU|%)/g); return mm ? mm.map(function (t) { return t.replace(/\s+/g, ''); }) : []; };
        var fin0 = function (v) { return fin(v) ? v : 0; };
        G.forEach(function (g) {
          var st = []; g.its.forEach(function (x) { strength(x.item.slice(x.brand.length)).forEach(function (t) { if (st.indexOf(t) < 0) st.push(t); }); });
          g.name = g.sub ? g.brand + ' ' + g.sub : split[g.brand] > 1 ? g.brand + ' ' + (st.length ? st.join('/') : '(' + g.line + ')') : g.brand;
          var dms = {}; g.its.forEach(function (x) { if (!dms[x.dm]) dms[x.dm] = x; });
          var D1 = Object.keys(dms).map(function (k) { return dms[k]; });
          g.dms = Object.keys(dms).join(' / ');
          g.st26 = D1.reduce(function (a, x) { return a + fin0(x.st26); }, 0); g.v26 = D1.reduce(function (a, x) { return a + fin0(x.v26); }, 0);
          g.st27 = D1.reduce(function (a, x) { return a + fin0(x.st27); }, 0);
          g.v27 = D1.reduce(function (a, x) { return a + (fin(x.mp) ? fin0(x.st27) * x.mp : 0); }, 0);
          var fyt = D1.reduce(function (a, x) { return a + (fin(x.mp) ? fin0(x.st27) : 0); }, 0);
          g.mp = fyt > 0 ? g.v27 / fyt : null;   // market price per SU of the row (weighted by the BE market)
          g.z26 = g.its.reduce(function (a, x) { return a + fin0(x.z26); }, 0); g.zv26 = g.its.reduce(function (a, x) { return a + fin0(x.zv26); }, 0);
          var s6 = g.its.reduce(function (a, x) { return [a[0] + fin0(x.s6[0]), a[1] + fin0(x.s6[1])]; }, [0, 0]);
          g.zp = s6[0] > 0 ? s6[1] / s6[0] : (g.z26 > 0 ? g.zv26 / g.z26 : null);
          g.nSh = g.its.filter(function (x) { return fin(x.sh); }).length;
          g.zst27e = g.nSh === g.its.length ? g.its.reduce(function (a, x) { return a + x.sh * fin0(x.st27); }, 0) : null;
          g.zv27e = fin(g.zst27e) ? g.its.reduce(function (a, x) { return a + x.sh * fin0(x.st27) * (fin(x.zp) ? x.zp : (g.zp || 0)); }, 0) : null;
          g.mktEd = g.its.some(function (x) { return x.mktEd; });
          g.src = g.nSh === g.its.length ? pn + ' share' + (g.mktEd ? ' + ' + pn + ' market' : ', market = forecast') : (g.nSh ? g.nSh + ' of ' + g.its.length + ' SKUs have an ' + pn + ' share' : 'No ' + pn + ' share saved');
        });
        G.sort(function (a, b) { return (a.bu || '~').localeCompare(b.bu || '~') || (a.line || '~').localeCompare(b.line || '~') || a.name.localeCompare(b.name); });
        var wb = new window.ExcelJS.Workbook(); wb.creator = 'Zeta Intel Dashboard'; wb.created = new Date(); wb.calcProperties = { fullCalcOnLoad: true };
        var ws = wb.addWorksheet('Market Sizing', { properties: { tabColor: { argb: 'FF2563EB' } } });
        var K = ['bu', 'line', 'brand', 'dm', 'skus', 'mv26', 'mst26', 'zv26', 'zst26', 'ms26', 'mv27u', 'mst27u', 'shu', 'gu', 'zv27u', 'zst27u',
          'mv27e', 'mst27e', 'she', 'ge', 'zv27e', 'zst27e', 'dmv', 'dmst', 'dsh', 'dzv', 'dzst', 'src', 'mp', 'zp'];
        var C = {}; K.forEach(function (k, i) { C[k] = i + 1; });
        var L = function (k) { return colL(C[k]); };
        var Wd = { bu: 12, line: 11, brand: 24, dm: 30, skus: 34, src: 26, mp: 8, zp: 8 };
        K.forEach(function (k) { ws.getColumn(C[k]).width = Wd[k] || 14; });
        ['mp', 'zp'].forEach(function (k) { ws.getColumn(C[k]).hidden = true; });
        var t = ws.getCell('A1'); t.value = 'Market Sizing by brand — FY' + py + ' and FY' + ty + ': business unit plan vs Business Excellence'; t.font = { bold: true, size: 16, color: { argb: XC.navy } };
        ws.getCell('A2').value = 'One row per brand and line (a brand promoted by two lines is split, named by its strengths; a brand whose SKUs sit in two DM2 markets of one DM1 is split by DM2, e.g. NEXICURE PLUS capsules / sachets). V = value (EGP), ST = standard units; market = the defined market(s) of the brand\'s SKUs, Zeta = the brand. Business unit: type the target share % and the market growth % (yellow). Business Excellence = your ' + pn + ' input on the dashboard (' + pn + ' market, or the forecast when not edited, and ' + pn + ' share per SKU, added up to the brand). Zeta FY' + ty + ' = market ST × target share; Zeta value at the brand\'s price per SU (last 6 months). Other markets are left out.';
        ws.getCell('A2').font = { size: 9, color: { argb: XC.grey } }; ws.getCell('A2').alignment = { wrapText: true, vertical: 'top' }; ws.mergeCells(2, 1, 2, C.src); ws.getRow(2).height = 40;
        var G1 = 4, H = 5, R0 = 6;
        var groups = [['bu', 'skus', '', XC.navy], ['mv26', 'ms26', py + ' · Business Excellence (estimate)', 'FF3B5B8C'], ['mv27u', 'zst27u', ty + ' · business unit plan', 'FFB45309'], ['mv27e', 'zst27e', ty + ' · Business Excellence (' + pn + ' input)', 'FF7C3AED'], ['dmv', 'dzst', 'Difference (BU − BE)', 'FF0E7490'], ['src', 'src', '', XC.navy]];
        var colOf = {}; groups.forEach(function (g) { for (var j = C[g[0]]; j <= C[g[1]]; j++) { colOf[j] = g[3]; ws.getCell(G1, j).fill = xFill(g[3]); } if (C[g[1]] > C[g[0]]) ws.mergeCells(G1, C[g[0]], G1, C[g[1]]); var c = ws.getCell(G1, C[g[0]]); c.value = g[2] || null; c.font = { bold: true, color: { argb: XC.white } }; c.alignment = { horizontal: 'center' }; });
        var HD = { bu: 'Business unit', line: 'Line', brand: 'Brand', dm: 'Market (DM1 / DM2)', skus: 'SKUs included',
          mv26: 'Market V', mst26: 'Market ST', zv26: 'Zeta V (estimate)', zst26: 'Zeta ST (estimate)', ms26: 'Market share (estimate)',
          mv27u: 'Market V', mst27u: 'Market ST', shu: 'Target share — INPUT', gu: 'Market growth (BU) — INPUT', zv27u: 'Zeta V', zst27u: 'Zeta ST',
          mv27e: 'Market V', mst27e: 'Market ST', she: 'Target share', ge: 'Market growth (BE)', zv27e: 'Zeta V', zst27e: 'Zeta ST',
          dmv: 'Market V', dmst: 'Market ST', dsh: 'Target share (pts)', dzv: 'Zeta V', dzst: 'Zeta ST', src: 'BE source (' + pn + ' input)',
          mp: 'market price per SU (helper)', zp: 'Zeta price per SU (helper)' };
        K.forEach(function (k) { var c = ws.getCell(H, C[k]); c.value = HD[k]; c.font = { bold: true, color: { argb: XC.white }, size: 9 }; c.fill = xFill(colOf[C[k]] || XC.navy); c.alignment = { wrapText: true, horizontal: 'center', vertical: 'middle' }; c.border = xBorder(XC.navy); });
        ws.getRow(H).height = 36;
        var FMT = { mv26: XF.n, mst26: XF.n, zv26: XF.n, zst26: XF.n, ms26: XF.p2, mv27u: XF.n, mst27u: XF.n, shu: XF.p2, gu: XF.g, zv27u: XF.n, zst27u: XF.n,
          mv27e: XF.n, mst27e: XF.n, she: XF.p2, ge: XF.g, zv27e: XF.n, zst27e: XF.n, dmv: XF.d, dmst: XF.d, dsh: XF.pts, dzv: XF.d, dzst: XF.d, mp: XF.px, zp: XF.px };
        var n0 = function (v) { return fin(v) ? v : null; };
        G.forEach(function (g, gi) {
          var r = R0 + gi, R = ws.getRow(r);
          var put = function (k, v) { var cl = R.getCell(C[k]); cl.value = v; if (FMT[k]) cl.numFmt = FMT[k]; cl.border = xBorder(); cl.font = { size: 10 }; return cl; };
          var ms26 = g.st26 > 0 ? g.z26 / g.st26 : null, she = fin(g.zst27e) && g.st27 > 0 ? g.zst27e / g.st27 : null;
          put('bu', g.bu || null); put('line', g.line || null); put('brand', g.name); put('dm', g.dms);
          put('skus', g.its.length + ': ' + g.its.map(function (x) { return x.item; }).join(' | ')).alignment = { wrapText: false };
          R.getCell(C.brand).font = { size: 10, bold: true, color: { argb: XC.navy } };
          put('mv26', n0(g.v26)); put('mst26', n0(g.st26)); put('zv26', n0(g.zv26)); put('zst26', n0(g.z26));
          put('ms26', fx('IFERROR(' + L('zst26') + r + '/' + L('mst26') + r + ',"")', fin(ms26) ? ms26 : ''));
          xInput(put('gu', null), XF.g, 'zg'); xInput(put('shu', null), XF.p2, 'share');
          put('mst27u', fx('IF(' + L('gu') + r + '="","",' + L('mst26') + r + '*(1+' + L('gu') + r + '))', ''));
          put('mv27u', fx('IF(' + L('mst27u') + r + '="","",' + L('mst27u') + r + '*' + L('mp') + r + ')', ''));
          put('zst27u', fx('IF(OR(' + L('mst27u') + r + '="",' + L('shu') + r + '=""),"",' + L('mst27u') + r + '*' + L('shu') + r + ')', ''));
          put('zv27u', fx('IF(' + L('zst27u') + r + '="","",' + L('zst27u') + r + '*' + L('zp') + r + ')', ''));
          put('mst27e', n0(g.st27)); put('mv27e', n0(g.v27));
          put('ge', fx('IFERROR(' + L('mst27e') + r + '/' + L('mst26') + r + '-1,"")', g.st26 > 0 ? g.st27 / g.st26 - 1 : ''));
          put('zst27e', n0(g.zst27e)); put('zv27e', n0(g.zv27e));
          put('she', fx('IF(' + L('zst27e') + r + '="","",IFERROR(' + L('zst27e') + r + '/' + L('mst27e') + r + ',""))', fin(she) ? she : ''));
          var dif = function (k, a, b) { put(k, fx('IF(OR(' + L(a) + r + '="",' + L(b) + r + '=""),"",' + L(a) + r + '-' + L(b) + r + ')', '')); };
          dif('dmv', 'mv27u', 'mv27e'); dif('dmst', 'mst27u', 'mst27e'); dif('dzv', 'zv27u', 'zv27e'); dif('dzst', 'zst27u', 'zst27e');
          put('dsh', fx('IF(OR(' + L('shu') + r + '="",' + L('she') + r + '=""),"",(' + L('shu') + r + '-' + L('she') + r + ')*100)', ''));
          put('src', g.src); put('mp', n0(g.mp)); put('zp', n0(g.zp));
        });
        var RN = R0 + G.length - 1;
        ws.autoFilter = { from: { row: H, column: 1 }, to: { row: RN, column: C.src } };
        ws.views = [{ state: 'frozen', xSplit: 3, ySplit: H, showGridLines: false }];
        xPrint(ws, H);
        try { xFillCache(wb); } catch (e) { console.warn('[MarketForecast] cache fill', e); }
        var fn = 'Zeta_Market_Sizing_FY' + ty + '_BU_vs_BE.xlsx';
        wb.xlsx.writeBuffer().then(function (buf) {
          if (window.__MF_XLSX_SINK) return window.__MF_XLSX_SINK(buf, fn);
          var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = fn; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        }).catch(function (e) { console.error('[MarketForecast] market sizing', e); alert('Excel export failed: ' + (e && e.message || e)); });
      } catch (e) { console.error('[MarketForecast] market sizing', e); alert('Excel export failed: ' + (e && e.message || e)); }
    }); });
  }
  function exportAll() {
    if (!xlsxOk()) return;
    ZF_OFF = true; try { exportAll_(); } finally { ZF_OFF = false; }
  }
  function exportAll_() {
    var m = D.meta, ty = m.target_year, ly = m.full_years[m.full_years.length - 1];
    var H = ['Level', 'Market', 'Zeta product(s)', 'Zeta items', 'Market SU ' + ly, 'Market SU FY' + ty, 'Market growth FY' + ty + ' (SU)', 'Market CAGR (SU) ' + m.full_years[0] + '–' + ly,
      'Market value ' + ly + ' (EGP)', 'Market value FY' + ty + ' (EGP)', 'Market growth FY' + ty + ' (value)', 'Market CAGR (value)',
      'Zeta SU ' + matLbl(), 'Zeta value ' + matLbl() + ' (EGP)', 'Zeta share (SU) ' + matLbl(), 'Share change vs previous MAT (pts)', 'Zeta CAGR (SU)', 'Zeta price per SU (EGP)',
      'Strategy', 'Objective share (SU)', 'Objective Zeta SU FY' + ty, 'Objective Zeta value FY' + ty + ' (EGP)', '' + PN() + ' market SU FY' + ty, '' + PN() + ' share (SU) %', '' + PN() + ' Zeta SU FY' + ty, '' + PN() + ' Zeta value FY' + ty + ' (EGP)', '' + PN() + ' saved'];
    var aoa = [H];
    LEVELS.forEach(function (lv) { segs(lv[0]).slice().sort(function (a, b) { return (b.forecast ? b.forecast.fy_target : 0) - (a.forecast ? a.forecast.fy_target : 0); }).forEach(function (r) {
      var Y = yearRows(r), P = Y.plan, C = Y.cagr, f = r.forecast || {}, vv = r.value || {}, n = function (x) { return fin(x) ? x : null; }, p = function (x) { return fin(x) ? x / 100 : null; };
      aoa.push([lv[1], r.name, P.brands.join(', '), P.items.map(function (i) { return i.item; }).join(' · '), n((r.history[ly] || {}).su), n(f.fy_target), p(f.growth_vs_le_pct), p(C.hist.msu),
        n((vv.history || {})[ly]), n(vv.fy_target), p(vv.growth_vs_le_pct), p(C.hist.mval),
        n(P.zsu), n(P.zval), n(P.s), fin(P.d) ? P.d : null, p(C.hist.zsu), n(P.price),
        P.strategy, P.present ? P.objShare : null, n(P.objSU), n(P.objVal), P.bex && P.bex.mktEdited ? n(P.bex.mkt) : null, P.bex && fin(P.bex.share) ? P.bex.share * 100 : null, P.bex ? n(P.bex.su) : null, P.bex ? n(P.bex.val) : null, P.bex ? (P.bex.saved || '') : '']);
    }); });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    fmtCells(ws, aoa, 0, [null, null, null, null, '#,##0', '#,##0', '0.0%', '0.0%', '#,##0', '#,##0', '0.0%', '0.0%', '#,##0', '#,##0', '0.0%', '+0.0;-0.0;0.0', '0.0%', '0.00', null, '0.0%', '#,##0', '#,##0', '#,##0', '0.00', '#,##0', '#,##0']);
    ws['!cols'] = H.map(function (h, i) { return { wch: i === 1 ? 34 : i === 3 ? 40 : Math.max(12, Math.min(24, h.length + 2)) }; });
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: H.length - 1 } }) };
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'All markets FY' + ty);
    // BEX by item — the sheet BEX fills in and imports back (one row per Zeta item; brand / total are sums)
    var HB = ['Level', 'Market', 'Brand', 'Item', 'ATC4', 'Market SU FY' + ty + ' (forecast)', '' + PN() + ' market SU FY' + ty + ' (optional)', 'Item share ' + matLbl(), 'Objective share', '' + PN() + ' share %', '' + PN() + ' SU FY' + ty, '' + PN() + ' value FY' + ty + ' (EGP)', 'Packs (IQVIA items)', 'Defined market (DM1)', 'Defined market (DM2)'];
    var bb = [HB];
    LEVELS.forEach(function (lv) { segs(lv[0]).forEach(function (r) {
      var f = r.forecast || {}, d = bexSaved(r) ? bexDraft(r) : (DRAFT[segKey(r)] || { mkt: null, items: {} }), mkt = fin(d.mkt) ? d.mkt : f.fy_target, mm = (r.scorecard || {}).market_mat || {};
      var its = (((r.scorecard || {}).zeta) || {}).items || [];
      if (!its.length || !(its[0] || {}).years) { var P0 = zplan(r); if (P0.present) bb.push([lv[1], r.name, P0.brands.join(', '), '__total__', '', f.fy_target, fin(d.mkt) ? d.mkt : null, P0.s, P0.objShare, fin(d.items.__total__) ? d.items.__total__ : null, null, null]); return; }
      its.forEach(function (i) {
        var keep = ZF, off = ZF_OFF; ZF_OFF = false; ZF = { key: segKey(r), atc: i.atc4, brand: i.brand, item: i.item }; var Q = zplan(r); ZF = keep; ZF_OFF = off;
        var sh = d.items[i.item], su = fin(sh) && fin(mkt) ? sh / 100 * mkt : null, pr = itemPrice(i);
        bb.push([lv[1], r.name, i.brand, i.item, i.atc4, f.fy_target, fin(d.mkt) ? d.mkt : null, mm.su > 0 ? i.mat[0] / mm.su : null, Q.present ? Q.objShare : null, fin(sh) ? sh : null, su, fin(su) && fin(pr) ? su * pr : null, (i.packs || []).join(' | '), dmOf('DM1', [i.item]), dmOf('DM2', [i.item])]);
      });
    }); });
    var wsb = XLSX.utils.aoa_to_sheet(bb); fmtCells(wsb, bb, 0, [null, null, null, null, null, '#,##0', '#,##0', '0.00%', '0.00%', '0.00', '#,##0', '#,##0']);
    wsb['!cols'] = [{ wch: 22 }, { wch: 34 }, { wch: 16 }, { wch: 40 }, { wch: 28 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 18 }];
    wsb['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: bb.length - 1, c: HB.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, wsb, '' + PN() + ' by item');
    var note = [['How to use'], ['Sheet "' + PN() + ' by item": type "' + PN() + ' share %" for each Zeta item (share of the whole market, SU) and, if ' + PN() + ' disagrees with the market forecast, "' + PN() + ' market SU". Save the file and use "Import ' + PN() + ' file" on the page. Brand and total ' + PN() + ' are always the sum of their items.'],
      ['Objective rules: Defend = Zeta has the biggest brand, holds >= 35% share, or lost >= 0.3 pts in the last 12 months -> hold today\'s share. Grow = otherwise -> add the latest MAT share gain (min +0.5 pts or +25% of a small share; max +5 pts or double the share).'],
      ['Zeta value = Zeta SU x Zeta\'s own price per SU today (last 6 months); no new price increase assumed.'], ['IQVIA data to ' + per(m.data_period) + '; exported ' + new Date().toLocaleString()]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(note), 'Read me');
    XLSX.writeFile(wb, 'Market_Plan_FY' + ty + '_All_markets.xlsx', { compression: true });
  }
  function importBex(file) {
    if (!file || !xlsxOk()) return;
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' }), shn = wb.SheetNames.find(function (n) { return /^[A-Za-z]+ by item/.test(n); });
        if (!shn) {
          var a0 = bex2All(), pr = importProSheet(wb, a0, file.name);
          if (!pr) { alert('No "' + PN() + ' by item" or "All markets SU" sheet in ' + file.name + '. Use a file exported from this page ("Excel — all markets" or "Excel — FY plan (SU & Value)").'); return; }
          bex2Put(a0); DRAFT = {}; try { migrateAggPlans(); } catch (e) { }
          alert(pr.nI + ' item shares and ' + pr.nM + ' market edits loaded from ' + file.name + '.'); overview(); return;
        }
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[shn], { defval: null }), a = bex2All(), lvl = {}, nI = 0, nM = 0, touched = {};
        LEVELS.forEach(function (l) { lvl[l[1]] = l[0]; });
        rows.forEach(function (x) {
          var t = lvl[x['Level']] || x['Level'], nm = x['Market'], it = x['Item']; if (!t || !nm || !it) return;
          var k = t + '|' + nm, sh = parseFloat(x[Object.keys(x).find(function (c) { return /^[A-Za-z]+ share %$/.test(c); })]), mk = parseFloat(String(x[Object.keys(x).find(function (c) { return /^[A-Za-z]+ market SU/.test(c); })] || '').replace(/,/g, ''));
          if (!touched[k]) { touched[k] = 1; a[k] = { mkt: null, items: {}, saved: 'imported ' + new Date().toLocaleString(), by: file.name, ts: Date.now() }; }
          if (fin(mk) && mk > 0 && !fin(a[k].mkt)) { a[k].mkt = mk; nM++; }
          if (fin(sh) && sh >= 0 && sh <= 100) { a[k].items[it] = Math.round(sh * 100) / 100; nI++; }
        });
        Object.keys(touched).forEach(function (k) { if (!fin(a[k].mkt) && !Object.keys(a[k].items).length) delete a[k]; delete DRAFT[k]; });
        bex2Put(a); alert(nI + ' item shares and ' + nM + ' market edits loaded from ' + file.name + '.'); overview();
      } catch (err) { console.error('[MarketForecast] import', err); alert('Could not read the file: ' + (err && err.message || err)); }
    };
    rd.readAsArrayBuffer(file);
  }

  // 2026-10-15 (Ahmed): the bottom section shows ONLY the selected market — performance + forecast in plain words
  function chip(txt, cls) { return '<span class="vchip ' + cls + '">' + esc(txt) + '</span>'; }
  function overview() { overview_(); pkLabels(ROOT.querySelector('#mf-ov')); pkLabels(ROOT.querySelector('#mf-sumz')); }
  function overview_() {
    var r = cur(), el = ROOT.querySelector('#mf-ov');
    if (!r) { el.innerHTML = ''; return; }
    zfSync(r);
    var m = D.meta, v = V(r), val = v.val, k = val ? 'val' : 'su', sc = r.scorecard || {}, z = sc.zeta || {}, mm = sc.market_mat || {};
    var ly = String(m.full_years[m.full_years.length - 1]), py = m.partial_year, ty = m.target_year;
    var g = function (a, b) { return fin(a) && fin(b) && b > 0 ? (a / b - 1) * 100 : null; };
    var lastYoy = v.yoy[(m.full_years[m.full_years.length - 2]) + '-' + ly];
    var ytdG = (v.ytd || {}).growth_pct, leG = g(v.fy_le, v.hist(ly)), fG = v.growth;
    // 1) market trend
    var mt = fin(ytdG) ? ytdG : lastYoy;
    var t1 = !fin(mt) ? ['No trend yet', 'n'] : mt >= 15 ? ['Growing fast', 'up'] : mt >= 3 ? ['Growing', 'up'] : mt > -3 ? ['Flat', 'n'] : ['Declining', 'dn'];
    // 2) next year
    var t2 = !fin(fG) ? ['No forecast', 'n'] : !fin(leG) ? [fG >= 0 ? 'Growth expected' : 'Decline expected', fG >= 0 ? 'up' : 'dn'] :
      Math.abs(fG - leG) <= 3 ? ['Same pace as this year', fG >= 0 ? 'up' : 'dn'] : fG > leG ? ['Faster than this year', 'up'] : ['Slower than this year', fG >= 0 ? 'n' : 'dn'];
    // 3) Zeta position (last 12 months)
    var zm = z.mat || {}, zs = mm[k] > 0 ? (zm[k] || 0) / mm[k] : null, zsp = mm[k + '_py'] > 0 ? (zm[k + '_py'] || 0) / mm[k + '_py'] : null;
    var dpts = fin(zs) && fin(zsp) ? (zs - zsp) * 100 : null, zg = g(zm[k], zm[k + '_py']), mg = g(mm[k], mm[k + '_py']);
    var t3 = !zs ? ['Zeta not present', 'n'] : !fin(dpts) ? ['New for Zeta', 'up'] : dpts >= 0.3 ? ['Zeta gaining share', 'up'] : dpts <= -0.3 ? ['Zeta losing share', 'dn'] : ['Zeta holding share', 'n'];
    // 4) leader
    var br = (sc.brands || []).slice().sort(function (a, b) { return (b[k] || 0) - (a[k] || 0); });
    var lead = br[0], zr = br.findIndex(function (b) { return b.z; });
    var tiles = [
      ['Market trend', t1, fmtM(v.hist(ly), val) + ' in ' + ly + ' (' + fmtP(lastYoy) + '). ' + (fin(ytdG) ? 'This year so far ' + fmtP(ytdG) + ' vs last year.' : '')],
      ['Next year (FY' + ty + ')', t2, 'Forecast ' + fmtM(v.fy_target, val) + ' (' + fmtP(fG) + '), after ' + fmtP(leG) + ' expected for ' + py + '.'],
      [zProd(r) + ' position', t3, zs ? zProd(r) + ' ' + (zs * 100).toFixed(1) + '% of the market' + (fin(dpts) ? ' (' + (dpts >= 0 ? '+' : '') + dpts.toFixed(1) + ' pts)' : '') + '. ' + zProd(r) + ' ' + fmtP(zg) + ' vs market ' + fmtP(mg) + ' (' + matLbl() + ').' : 'Zeta has no sales in this market.'],
      ['Market leader', [lead ? lead.n : '—', lead && lead.z ? 'up' : 'n'], lead ? (lead.c || '').replace('*', '') + ' · ' + (mm[k] > 0 ? (lead[k] / mm[k] * 100).toFixed(1) + '% of the market' : '') + (zr > 0 ? ' · Zeta\'s top brand ' + br[zr].n + ' ranks #' + (zr + 1) : zr === 0 ? ' · Zeta leads the market' : '') : '']
    ];
    var h = '';
    var sumz = '<div class="gtiles">' + tiles.map(function (x) { return '<div class="gtile"><div class="kl">' + esc(x[0]) + '</div><div class="gv">' + chip(x[1][0], x[1][1]) + '</div><div class="ks">' + esc(x[2]) + '</div></div>'; }).join('') + '</div>';
    // year by year (+ Zeta objective, BEX forecast and CAGR)
    var YR = yearRows(r), kk = val ? ['mval', 'mvalg', 'zval', 'zvalg', 'zvalsh'] : ['msu', 'msug', 'zsu', 'zsug', 'zsush'];
    var rows = YR.rows.map(function (x) { var sp = x.y.indexOf(' ');
      return ['<b>' + esc(sp > 0 ? x.y.slice(0, sp) : x.y) + '</b>' + (sp > 0 ? ' ' + esc(x.y.slice(sp + 1)) : ''),
      (x.fc ? '<b>' : '') + esc(x.basis) + (x.fc ? '</b>' : ''), fmtM(x[kk[0]], val), fmtP(x[kk[1]]), fin(x[kk[2]]) ? fmtM(x[kk[2]], val) : '—', fin(x[kk[3]]) ? fmtP(x[kk[3]]) : '—', fin(x[kk[4]]) ? (x[kk[4]] * 100).toFixed(1) + '%' : '—', x.fc || 0]; });
    var C = YR.cagr, ck = val ? ['mval', 'zval'] : ['msu', 'zsu'], PL = YR.plan;
    rows.push(['<b>CAGR</b> ' + esc(C.hist.span), 'Actual, average a year', '', fmtP(C.hist[ck[0]]), '', fmtP(C.hist[ck[1]]) + (C.hist.zspan && C.hist.zspan !== C.hist.span ? ' <span class="mut">(' + esc(C.hist.zspan) + ')</span>' : ''), '', 9]);
    // BEX row: market edit (M SU) + Zeta = sum of item BEX (computed); one share input only when the market has no item detail
    YR.rows.forEach(function (x, i) {
      if (x.fc !== 3) return;
      var rr = rows[i], Bx = PL.bex || {}, d = bexDraft(r), f0 = r.forecast || {}, noItems = !((((r.scorecard || {}).zeta) || {}).items || []).length;
      if (isRO(r)) { rr[2] = fmtM(fin(Bx.mkt) ? Bx.mkt : f0.fy_target, false) + (Bx.mktEdited ? ' <small class="mut">(' + (isAgg(r) ? 'sum of ' + PN() + ' markets' : 'moved with the DM1 ' + PN() + ' market') + ')</small>' : ''); rr[6] = fin(Bx.share) ? ((val ? Bx.valShare : Bx.share) * 100).toFixed(1) + '% <small class="mut">(' + Bx.n + '/' + Bx.nItems + ' items)</small>' : '<small class="mut">no DM1 plan yet</small>'; return; }
      rr[2] = '<input type="text" inputmode="decimal" id="mf-bmkt" class="bexm" title="' + PN() + ' view of the FY market in million SU — leave empty to use the forecast" placeholder="' + (fin(f0.fy_target) ? (f0.fy_target / 1e6).toFixed(1) : '') + '" value="' + (fin(d.mkt) ? (d.mkt / 1e6).toFixed(1) : '') + '"> M SU' + (val && fin(x.mval) ? '<br><small class="mut">' + fmtM(x.mval, true) + '</small>' : '');
      // 2026-10-20 (Ahmed: "in edit market 2027 put the % and then update SU and value"): growth % vs the FY landing estimate
      if (fin(f0.fy_le) && f0.fy_le > 0) { var gNow = fin(d.mkt) ? (d.mkt / f0.fy_le - 1) * 100 : null;
        rr[3] = '<input type="text" inputmode="decimal" id="mf-bmg" class="bexm" title="' + PN() + ' market growth FY' + D.meta.target_year + ' vs ' + D.meta.partial_year + ' (Standard Units) — type a % and the market SU, value and packs update; leave empty to use the forecast" placeholder="' + (fin(f0.growth_vs_le_pct) ? f0.growth_vs_le_pct.toFixed(1) : '') + '" value="' + (fin(gNow) ? gNow.toFixed(1) : '') + '"> %' + (val && fin(x[kk[1]]) ? '<br><small class="mut">' + fmtP(x[kk[1]]) + ' ' + (isPK() ? 'packs' : 'value') + '</small>' : ''); }
      if (noItems) rr[6] = '<input type="text" inputmode="decimal" class="bexi" data-item="__total__" min="0" max="100" step="0.1" placeholder="share" value="' + (fin(d.items.__total__) ? d.items.__total__ : '') + '"> %';
      else rr[6] = fin(Bx.share) ? ((val ? Bx.valShare : Bx.share) * 100).toFixed(1) + '% <small class="mut">(' + Bx.n + '/' + Bx.nItems + ' items)</small>' : '<small class="mut">enter item shares below</small>';
    });
    var V0 = shareVerdict(zplan(r));
    // 2026-10-17 (Ahmed): the share-objective verdict is shown to SFE (and Admin) only
    if (isSFEView()) sumz += '<div class="sumv">' + '<span class="kl">FY' + ty + ' share objective — will the ' + esc(PN()) + ' forecast achieve it?</span> ' +
      (V0.k === 'na' ? chip('No objective', 'n') + ' <span class="mut small">Zeta is not present in this market.</span>' :
       V0.k === 'none' ? chip('Not answered yet', 'n') + ' <span class="mut small">Enter the ' + esc(PN()) + ' item shares in Brands & items.</span>' :
       chip(V0.lbl, V0.cls) + ' <span class="small">' + esc(PN()) + ' ' + (V0.fs * 100).toFixed(2) + '% vs objective ' + (V0.os * 100).toFixed(2) + '% (' + (Math.abs(V0.gap) < 0.005 ? '' : V0.gap > 0 ? '+' : '−') + Math.abs(V0.gap).toFixed(2) + ' pts)' + (V0.part ? ' · provisional' : '') + '</span>') +
      ' <a href="#mf-s5" class="golink" data-t="mf-s5">Open the plan →</a></div>';
    var sz = ROOT.querySelector('#mf-sumz'); if (sz) sz.innerHTML = sumz;
    var IT = itemTable(r);
    h += '<section class="card"><h2>What it means for Zeta</h2>' + zetaCard(r) + '</section>';
    h += '<section class="card"><div class="plan">' + planCard(r) +
      '<div class="tblwrap"><table class="tbl yby"><thead><tr><th>Year</th><th>Basis</th><th class="r">Market</th><th class="r">Market growth</th><th class="r">' + esc(zProd(r)) + '</th><th class="r">' + esc(zProd(r)) + ' growth</th><th class="r">' + esc(zProd(r)) + ' share' + (val ? ' (value)' : '') + '</th></tr></thead><tbody>' +
      rows.map(function (x, i) { var c = x[7], mt = (YR.rows[i] || {}).mat; return '<tr class="' + (c === 1 ? 'fc' : c === 2 ? 'fc obj' : c === 3 ? 'fc bex bexrow' : c === 9 ? 'cg' : mt ? 'matrow' : '') + '">' + x.slice(0, 7).map(function (cc, j) { return '<td' + (j >= 2 ? ' class="num r"' : '') + '>' + cc + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>' + (isSFEView() ? verdictBox(r) : '') + planNotes(r) + bridge(r) +
      '<p class="note mut">Growth = vs the year before (' + py + ' so far = vs the same months last year; ' + matLbl() + ' = vs the previous 12 months). CAGR = average growth a year.</p></div></section>';
    h += secHd(6, 'Brands & items', 'every Zeta brand and item — objective, ' + PN() + ' share input' + (isSFEView() ? ' and verdict' : '')) +
      '<section class="card">' + (IT || '<p class="note mut">No Zeta item detail in this market.</p>') + '</section>';
    // who wins the market
    var top = br.slice(0, 8), zIn = top.some(function (b) { return b.z; });
    if (!zIn) { var zb = br.find(function (b) { return b.z; }); if (zb) top.push(zb); }
    var who = '<div><h2>Who wins the market — ' + matLbl() + ' (' + esc(sc.mat_label || '') + ')</h3><div class="tblwrap"><table class="tbl yby"><thead><tr><th>#</th><th>Brand</th><th>Company</th><th class="r">Sales</th><th class="r">Share</th><th class="r">Share change</th><th class="r">Growth</th></tr></thead><tbody>' +
      top.map(function (b) {
        var s1 = mm[k] > 0 ? b[k] / mm[k] : null, s0 = mm[k + '_py'] > 0 ? b[k + '_py'] / mm[k + '_py'] : null, d = fin(s1) && fin(s0) ? (s1 - s0) * 100 : null, gb = g(b[k], b[k + '_py']);
        return '<tr class="' + (b.z ? 'zrow' : '') + '"><td class="mut">' + (br.indexOf(b) + 1) + '</td><td>' + esc(b.n) + (b.z ? ' <span class="zt">Zeta</span>' : '') + '</td><td class="mut">' + esc((b.c || '').replace('*', '')) + '</td><td class="num r">' + fmtM(b[k], val) + '</td><td class="num r">' + (fin(s1) ? (s1 * 100).toFixed(1) + '%' : '—') + '</td>' +
          '<td class="num r ' + (d == null ? '' : d >= 0.05 ? 'pos' : d <= -0.05 ? 'neg' : '') + '">' + (d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(1) + ' pts') + '</td><td class="num r">' + (gb == null ? (b[k] > 0 ? 'new' : '—') : fmtP(gb)) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="note mut">Share = brand ÷ the whole market. Share change = points won or lost vs the 12 months before. A brand growing faster than the market (' + fmtP(mg) + ') is taking share.</p></div>';
    var wh = ROOT.querySelector('#mf-who'); if (wh) wh.innerHTML = who;
    el.innerHTML = h;
    wirePlan(r);
    navSync();
  }

  // 2026-10-14 (Ahmed): plain-language methodology, no statistics
  function methodology() {
    var m = D.meta;
    var li_ = [
      'Source: IQVIA monthly Standard Units (the Market Intelligence data, with the approved ownership restatements and market definitions). A BU or Line market = the defined markets (DM1) where Zeta has products of that BU or Line.',
      'One forecast per market: FY' + m.target_year + ' full-year Standard Units. Growth = FY' + m.target_year + ' forecast vs the FY' + m.partial_year + ' landing estimate (' + m.partial_months + ' actual months + the rest of the year forecast).',
      'How the number is built: each market is projected from its own sales history since 2021 — its long-term direction, its recent pace and the usual seasonal pattern. Unusual one-off months (stock building, supply gaps) are not allowed to drive the result. New markets are built on today\'s monthly sales rate.',
      'Markets add up: every BU and the Egypt total equal the sum of their markets; Lines are the sum of their markets. DM2 markets stand on their own. A market that belongs to two BUs counts in both. Zeta products in non-promoted lines are not shown on this page (not in Zeta share, brands or plans); their volume stays in the market totals.',
      'Why this forecast / Market insights: written automatically from the same IQVIA data — the market\'s growth pattern, this year\'s sales, the brands (or sub-markets) adding and losing the most volume over the last 12 months, brands launched in the last 24 months, and the shift between molecules over two years.',
      'Value (EGP) view: best practice is to forecast volume and price separately. Value = each defined market\'s Standard Units forecast × its own price per SU today (IQVIA LC value ÷ SU, last 6 months, current product mix); BUs, Lines and Egypt add up their markets. FY' + m.partial_year + ' landing estimate (value) = actual Jan–' + MON[m.partial_months - 1] + ' value + the remaining months\' volume × today\'s price. No new price increase is assumed for FY' + m.target_year + ': value growth = volume growth + the carry-over of prices (and mix) already in the market.',
      'What it means for Zeta: Zeta\'s share of the last 12 months, and the volume Zeta needs in FY' + m.target_year + ' to keep that share if the market lands on the forecast.',
      'Not built in: new launches, withdrawals, shortages, price changes or tenders that are not yet visible in IQVIA sales. IQVIA can restate history; every refresh rebuilds the forecast and its rationale.'
    ];
    var mb_ = ROOT.querySelector('#mf-methodbody'); if (!mb_) return;   // section removed 2026-10-17
    mb_.innerHTML = '<ol class="ml">' + li_.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ol>';
  }

  function hsub() {
    var el = ROOT.querySelector('#mf-hsub'); if (!el) return;
    el.textContent = isPK() ? 'IQVIA packs (boxes) = Standard Units ÷ each item\'s pack size. Each market\'s volume forecast × its packs per SU of the last 6 months (today\'s pack mix).' : isV() ? 'IQVIA value (EGP). Each market\'s volume forecast × its price per Standard Unit today — one forecast per market, with the reasons behind it. No new price increase assumed.'
      : 'IQVIA Standard Units. One forecast per market, built from its own IQVIA sales history, with the business reasons behind it. Switch the measure to see value (EGP).';
  }
  function render() {
    hsub(); fillSelect(); portfolio();
    var pf = ROOT.querySelector('#mf-pf'), h2 = ROOT.querySelector('#mf-s2'); if (h2) h2.style.display = pf && pf.style.display !== 'none' && pf.innerHTML ? '' : 'none';
    detail(); overview(); navSync(); pkLabels(ROOT);
  }

  function wire() {
    FK.forEach(function (k) {
      var sel = ROOT.querySelector('#mf-f' + k); if (!sel) return;
      sel.addEventListener('change', function () { ST.f[k] = sel.value; fUp(k); fFix(); fView(); saveState(); render(); });
    });
    ROOT.addEventListener('click', function (e) {
      var a = e.target.closest('#mf-nav a, a.golink'); if (!a) return;
      e.preventDefault(); var t = ROOT.querySelector('#' + a.getAttribute('data-t'));
      if (a.getAttribute('data-t') === 'mf-s7') { var md = ROOT.querySelector('#mf-method'); if (md) md.open = true; }
      goSec(t);
    });
    global.addEventListener('scroll', onScroll, { passive: true });
    var rb = ROOT.querySelector('#mf-freset'); if (rb) rb.addEventListener('click', function () { ST.f = { BU: '', Line: '', DM1: '', DM2: '' }; fView(); saveState(); render(); });
    var mz = ROOT.querySelector('#mf-meas');
    if (mz) mz.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      ST.meas = b.dataset.v; setD(); saveState();
      mz.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      render();
    });
    var mkGo = function (lv, name, at) {
      if (!segs(lv).some(function (q) { return q.name === name; })) return;
      fFrom(lv, name); render();
      var b = ROOT.querySelector('.mkbar[data-at="' + at + '"]'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'center' });
    };
    ROOT.querySelector('#mf-ov').addEventListener('click', function (e) {
      var mb = e.target.closest('.mkbar button[data-mk]'); if (!mb) return;
      var lv = mb.dataset.mk, at = mb.closest('.mkbar').dataset.at, c = cur(), list = segs(lv).slice().sort(function (a, b) { return size(b) - size(a); });
      if (c && c.type === lv) return;
      var t = c && c.type === 'DM1' && lv === 'DM2' && list.find(function (q) { return q.name === c.name; }) || c && c.type === 'DM2' && lv === 'DM1' && list.find(function (q) { return q.name === c.name; }) || list.find(function (q) { return q.name === ST.seg[lv]; }) || list[0];
      if (t) mkGo(lv, t.name, at);
    });
    ROOT.querySelector('#mf-ov').addEventListener('change', function (e) {
      var s = e.target.closest('select.mksel'); if (!s || !s.value) return;
      mkGo(s.dataset.lv, s.value, s.closest('.mkbar').dataset.at);
    });
    ROOT.querySelector('#mf-ov').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-n]'); if (!tr) return;
      navTo(ST.level, tr.getAttribute('data-n'), true);
    });
  }

  function loadState() { try { var s = sessionStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function saveState() { try { sessionStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) { } }

  function init(containerId) {
    var c = document.getElementById(containerId); if (!c) return;
    document.body.classList.add('mfc-mode');
    c.innerHTML = '<div class="mfc" id="mfc-host"></div>'; HOST = ROOT = document.getElementById('mfc-host');
    try {
      D_SU = D_SU || decode(); D = D_SU;
      if (!D) { ROOT.innerHTML = '<div style="padding:24px">Market forecast data not loaded (cache/market_forecast.data.js). Run UPDATE_DASHBOARD.bat or <code>python etl/build_market_forecast.py --cache</code>.</div>'; return; }
      computeScope();
      try { migrateAggPlans(); } catch (e) { console.warn('[MarketForecast] plan move', e); }
      try { sfBoot(); } catch (e) { console.warn('[MarketForecast] backup', e); }
      var sv = loadState(); if (sv && sv.level) { ST.level = sv.level; ST.seg = sv.seg || {}; ST.meas = sv.meas === 'val' || sv.meas === 'pk' ? sv.meas : 'su'; }
      if (!segs(ST.level).length) ST.level = (LEVELS.find(function (l) { return segs(l[0]).length; }) || ['DM1'])[0];
      if (sv && sv.f) { ST.f = { BU: sv.f.BU || '', Line: sv.f.Line || '', DM1: sv.f.DM1 || '', DM2: sv.f.DM2 || '' }; fFix(); fView(); }
      else if (sv && sv.level) { var c0 = cur(); fFrom(c0 ? c0.type : 'Total', c0 ? c0.name : ''); }
      else { fFix(); fView(); }   // first visit: Egypt total (all filters open)
      ROOT.innerHTML = shell(); wire(); methodology(); render();
    } catch (e) {
      console.error('[MarketForecast]', e);
      ROOT.innerHTML = '<div style="padding:24px">Market Forecast could not render: ' + esc(e && e.message || e) + '</div>';
    }
  }
  function destroy() { saveState(); global.removeEventListener('scroll', onScroll); document.body.classList.remove('mfc-mode'); if (HOST) { HOST.innerHTML = ''; HOST = ROOT = null; } }

  global.addEventListener('beforeunload', saveState);
  global.MarketForecastDashboard = { init: init, destroy: destroy };
})(window);
