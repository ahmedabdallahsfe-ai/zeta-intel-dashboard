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
    return JSON.parse(pako.ungzip(bytes, { to: 'string' }));
  }

  var D = null, HOST = null, ROOT = null;
  var ST = { level: 'DM1', seg: {}, sort: 'size', meas: 'su' };   // meas: 'su' | 'val' (2026-10-15)
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
  function fmtP(p, d) { if (!fin(p)) return '—'; return (p > 0 ? '+' : '') + p.toFixed(d == null ? 1 : d) + '%'; }   // p already in %
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
  function isV() { return ST.meas === 'val' && hasVal(); }
  function hasVal() { return D && D.segments.some(function (r) { return r.value && fin(r.value.fy_target); }); }
  function V(r) {
    var f = r.forecast || {};
    if (isV() && r.value) {
      var v = r.value;
      return { val: true, unit: 'EGP', hist: function (y) { return (v.history || {})[y]; }, ytd: v.ytd || {}, monthly: v.monthly || [], path: v.path || [],
        fy_le: v.fy_le, fy_target: v.fy_target, growth: v.growth_vs_le_pct, yoy: v.yoy_pct || {}, hc: v.hist_cagr || {}, rc: v.recent_cagr || {} };
    }
    return { val: false, unit: 'SU', hist: function (y) { return (r.history[y] || {}).su; }, ytd: r.ytd, monthly: r.monthly_su, path: f.path || [],
      fy_le: f.fy_le, fy_target: f.fy_target, growth: f.growth_vs_le_pct, yoy: r.yoy_pct, hc: r.hist_cagr, rc: r.recent_cagr };
  }
  function fmtM(v, val) { if (!fin(v)) return '—'; return val ? 'EGP ' + fmtSU(v) : fmtSU(v) + ' SU'; }

  // ── markup ──
  function shell() {
    var m = D.meta;
    return '<div class="wrap">' +
      '<header class="top"><div><h1>Market Growth Forecast — FY' + m.target_year + '</h1>' +
      '<div class="sub" id="mf-hsub"></div></div>' +
      '<div class="sub asof">Actuals to <b>' + esc(per(m.data_period)) + '</b> · built ' + esc(m.generated_at) + '</div></header>' +
      '<section class="card controls" aria-label="Filters">' +
      '<div class="ctl"><label>Market level</label><div class="seg" id="mf-lvl">' +
      LEVELS.filter(function (l) { return segs(l[0]).length; }).map(function (l) { return '<button data-v="' + l[0] + '" aria-pressed="' + (l[0] === ST.level) + '">' + esc(l[1]) + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="ctl grow"><label for="mf-seg">Market</label><select id="mf-seg"></select></div>' +
      (hasVal() ? '<div class="ctl"><label>Measure</label><div class="seg" id="mf-meas"><button data-v="su" aria-pressed="' + (ST.meas !== 'val') + '">Standard Units</button><button data-v="val" aria-pressed="' + (ST.meas === 'val') + '">Value (EGP)</button></div></div>' : '') +
      '</section>' +
      '<div id="mf-detail"></div>' +
      '<section class="card glance" id="mf-ov"></section>' +
      '<details class="card method" id="mf-method"><summary><h2>How the forecast is built</h2></summary><div id="mf-methodbody"></div></details>' +
      '</div>';
  }

  function fillSelect() {
    var sel = ROOT.querySelector('#mf-seg'), list = segs(ST.level).slice().sort(function (a, b) { return size(b) - size(a); });
    var c = cur();
    sel.innerHTML = list.map(function (r) { return '<option' + (c && r.name === c.name ? ' selected' : '') + ' value="' + esc(r.name) + '">' + esc(r.name) + '</option>'; }).join('');
    sel.disabled = list.length < 2;
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
    var c5 = v.val
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
    if (isV() && ra.value) return '<p class="stmt">' + esc(ra.value.statement) + '</p>' + li(ra.value.why, 'rl why') +
      '<h3 class="mt">Volume behind it (Standard Units)</h3><p class="stmt2">' + esc(ra.statement) + '</p>' + li(ra.why, 'rl why');
    return '<p class="stmt">' + esc(ra.statement) + '</p>' + li(ra.why, 'rl why');
  }
  function insights(r) {
    var ra = r.rationale || {};
    return (ra.insights || []).length ? li(ra.insights, 'rl ins') : '<p class="note mut">No brand-level movement to report for this market.</p>';
  }
  function zetaCard(r) {
    var ra = r.rationale || {};
    var z = (isV() && ra.value ? (ra.value.zeta || []) : []).concat(ra.zeta || []);
    return z.length ? li(z, 'rl zeta') : '<p class="note mut">Zeta has no sales in this market.</p>';
  }

  function detail() {
    var r = cur(), el = ROOT.querySelector('#mf-detail');
    if (!r) { el.innerHTML = '<section class="card"><p>No market available for your access scope at this level.</p></section>'; return; }
    var ra = r.rationale || {};
    el.innerHTML =
      '<section class="card head"><div class="ttl"><div><div class="eyebrow">' + esc(r.type === 'Total' ? 'Market' : (LEVELS.find(function (l) { return l[0] === r.type; }) || [0, r.type])[1]) + '</div><h2 class="mname">' + esc(r.name) + '</h2></div>' +
      '<div class="chips"><span class="chip">' + esc(r.lifecycle) + ' · ' + r.consecutive_positive_months + ' months of sales</span></div></div>' + banners(r) + '</section>' +
      kpis(r) +
      '<section class="card rat"><h2>Why this forecast</h2>' + rationale(r) + '</section>' +
      '<div class="g2"><section class="card"><h2>Annual ' + (isV() ? 'value (EGP, at today\'s prices for the forecast)' : 'Standard Units') + '</h2>' + annualChart(r) + '</section>' +
      '<section class="card"><h2>Market insights — what moves the market' + (isV() ? ' <span class="mut small">(volume)</span>' : '') + '</h2>' + insights(r) + '</section></div>' +
      '<div class="g2"><section class="card"><h2>What it means for Zeta</h2>' + zetaCard(r) +
      ((ra.watch || []).length ? '<h2 class="mt">Watch-outs</h2>' + li(ra.watch, 'rl watch') : '') + '</section>' +
      '<section class="card"><h2>Growth history</h2>' + trendTable(r) + '</section></div>' +
      '<section class="card"><h2>Monthly trend and forecast path</h2>' + monthlyChart(r) + '</section>';
  }

  // 2026-10-15 (Ahmed): the bottom section shows ONLY the selected market — performance + forecast in plain words
  function chip(txt, cls) { return '<span class="vchip ' + cls + '">' + esc(txt) + '</span>'; }
  function overview() {
    var r = cur(), el = ROOT.querySelector('#mf-ov');
    if (!r) { el.innerHTML = ''; return; }
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
      ['Zeta position', t3, zs ? 'Zeta ' + (zs * 100).toFixed(1) + '% of the market' + (fin(dpts) ? ' (' + (dpts >= 0 ? '+' : '') + dpts.toFixed(1) + ' pts)' : '') + '. Zeta ' + fmtP(zg) + ' vs market ' + fmtP(mg) + ' (last 12 months).' : 'Zeta has no sales in this market.'],
      ['Market leader', [lead ? lead.n : '—', lead && lead.z ? 'up' : 'n'], lead ? (lead.c || '').replace('*', '') + ' · ' + (mm[k] > 0 ? (lead[k] / mm[k] * 100).toFixed(1) + '% of the market' : '') + (zr > 0 ? ' · Zeta\'s top brand ' + br[zr].n + ' ranks #' + (zr + 1) : zr === 0 ? ' · Zeta leads the market' : '') : '']
    ];
    var h = '<div class="h2row"><h2>' + esc(r.name) + ' — at a glance</h2><div class="sub">Performance and forecast in one view · ' + (val ? 'Value (EGP; forecast at today\'s prices)' : 'Standard Units') + '</div></div>';
    h += '<div class="gtiles">' + tiles.map(function (x) { return '<div class="gtile"><div class="kl">' + esc(x[0]) + '</div><div class="gv">' + chip(x[1][0], x[1][1]) + '</div><div class="ks">' + esc(x[2]) + '</div></div>'; }).join('') + '</div>';
    // year by year
    var yrs = z.years || {}, rows = [], prevM = null, prevZ = null;
    m.full_years.forEach(function (yy) {
      var Y = String(yy), mv = v.hist(Y), zv = (yrs[Y] || {})[val ? 'zval' : 'zsu'];
      rows.push(['<b>' + Y + '</b>', 'Actual', fmtM(mv, val), fmtP(g(mv, prevM)), zv ? fmtM(zv, val) : '—', zv ? fmtP(g(zv, prevZ)) : '—', mv > 0 && zv ? (zv / mv * 100).toFixed(1) + '%' : '—']);
      prevM = mv; prevZ = zv;
    });
    var zy = z.ytd || {}, yc = (v.ytd || {}).cur, ypy = (v.ytd || {}).py, zyc = zy[k], zyp = zy[k + '_py'];
    rows.push(['<b>' + py + '</b> ' + esc((v.ytd || {}).months || ''), 'Actual so far', fmtM(yc, val), fmtP(ytdG), zyc ? fmtM(zyc, val) : '—', zyc ? fmtP(g(zyc, zyp)) : '—', yc > 0 && zyc ? (zyc / yc * 100).toFixed(1) + '%' : '—']);
    rows.push(['<b>' + py + '</b> full year', 'Landing estimate', fmtM(v.fy_le, val), fmtP(leG), '—', '—', '—']);
    var need = zs && fin(v.fy_target) ? zs * v.fy_target : null;
    rows.push(['<b>' + ty + '</b>', '<b>Forecast</b>', '<b>' + fmtM(v.fy_target, val) + '</b>', '<b>' + fmtP(fG) + '</b>', need ? fmtM(need, val) + ' <span class="mut">to hold share</span>' : '—', '—', zs ? (zs * 100).toFixed(1) + '% <span class="mut">(hold)</span>' : '—']);
    h += '<div class="g2"><div><h3 class="mt">Year by year — market and Zeta</h3><div class="tblwrap"><table class="tbl yby"><thead><tr><th>Year</th><th>Basis</th><th class="r">Market</th><th class="r">Market growth</th><th class="r">Zeta</th><th class="r">Zeta growth</th><th class="r">Zeta share</th></tr></thead><tbody>' +
      rows.map(function (x, i) { return '<tr class="' + (i === rows.length - 1 ? 'fc' : '') + '">' + x.map(function (c, j) { return '<td' + (j >= 2 ? ' class="num r"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div><p class="note mut">Growth = vs the year before (' + py + ' so far = vs the same months last year). The ' + ty + ' Zeta figure is the ' + (val ? 'value' : 'volume') + ' Zeta needs to keep today\'s share if the market lands on the forecast.</p></div>';
    // who wins the market
    var top = br.slice(0, 8), zIn = top.some(function (b) { return b.z; });
    if (!zIn) { var zb = br.find(function (b) { return b.z; }); if (zb) top.push(zb); }
    h += '<div><h3 class="mt">Who wins the market — last 12 months (' + esc(sc.mat_label || '') + ')</h3><div class="tblwrap"><table class="tbl yby"><thead><tr><th>#</th><th>Brand</th><th>Company</th><th class="r">Sales</th><th class="r">Share</th><th class="r">Share change</th><th class="r">Growth</th></tr></thead><tbody>' +
      top.map(function (b) {
        var s1 = mm[k] > 0 ? b[k] / mm[k] : null, s0 = mm[k + '_py'] > 0 ? b[k + '_py'] / mm[k + '_py'] : null, d = fin(s1) && fin(s0) ? (s1 - s0) * 100 : null, gb = g(b[k], b[k + '_py']);
        return '<tr class="' + (b.z ? 'zrow' : '') + '"><td class="mut">' + (br.indexOf(b) + 1) + '</td><td>' + esc(b.n) + (b.z ? ' <span class="zt">Zeta</span>' : '') + '</td><td class="mut">' + esc((b.c || '').replace('*', '')) + '</td><td class="num r">' + fmtM(b[k], val) + '</td><td class="num r">' + (fin(s1) ? (s1 * 100).toFixed(1) + '%' : '—') + '</td>' +
          '<td class="num r ' + (d == null ? '' : d >= 0.05 ? 'pos' : d <= -0.05 ? 'neg' : '') + '">' + (d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(1) + ' pts') + '</td><td class="num r">' + (gb == null ? (b[k] > 0 ? 'new' : '—') : fmtP(gb)) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="note mut">Share = brand ÷ the whole market. Share change = points won or lost vs the 12 months before. A brand growing faster than the market (' + fmtP(mg) + ') is taking share.</p></div></div>';
    el.innerHTML = h;
  }

  // 2026-10-14 (Ahmed): plain-language methodology, no statistics
  function methodology() {
    var m = D.meta;
    var li_ = [
      'Source: IQVIA monthly Standard Units (the Market Intelligence data, with the approved ownership restatements and market definitions). A BU or Line market = the defined markets (DM1) where Zeta has products of that BU or Line.',
      'One forecast per market: FY' + m.target_year + ' full-year Standard Units. Growth = FY' + m.target_year + ' forecast vs the FY' + m.partial_year + ' landing estimate (' + m.partial_months + ' actual months + the rest of the year forecast).',
      'How the number is built: each market is projected from its own sales history since 2021 — its long-term direction, its recent pace and the usual seasonal pattern. Unusual one-off months (stock building, supply gaps) are not allowed to drive the result. New markets are built on today\'s monthly sales rate.',
      'Markets add up: every BU and the Egypt total equal the sum of their markets; Lines are the sum of their markets. DM2 markets stand on their own. A market that belongs to two BUs (e.g. PPI oral solid in GIT and Non-Promoted) counts in both.',
      'Why this forecast / Market insights: written automatically from the same IQVIA data — the market\'s growth pattern, this year\'s sales, the brands (or sub-markets) adding and losing the most volume over the last 12 months, brands launched in the last 24 months, and the shift between molecules over two years.',
      'Value (EGP) view: best practice is to forecast volume and price separately. Value = each defined market\'s Standard Units forecast × its own price per SU today (IQVIA LC value ÷ SU, last 6 months, current product mix); BUs, Lines and Egypt add up their markets. FY' + m.partial_year + ' landing estimate (value) = actual Jan–' + MON[m.partial_months - 1] + ' value + the remaining months\' volume × today\'s price. No new price increase is assumed for FY' + m.target_year + ': value growth = volume growth + the carry-over of prices (and mix) already in the market.',
      'What it means for Zeta: Zeta\'s share of the last 12 months, and the volume Zeta needs in FY' + m.target_year + ' to keep that share if the market lands on the forecast.',
      'Not built in: new launches, withdrawals, shortages, price changes or tenders that are not yet visible in IQVIA sales. IQVIA can restate history; every refresh rebuilds the forecast and its rationale.'
    ];
    ROOT.querySelector('#mf-methodbody').innerHTML = '<ol class="ml">' + li_.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ol>';
  }

  function hsub() {
    var el = ROOT.querySelector('#mf-hsub'); if (!el) return;
    el.textContent = isV() ? 'IQVIA value (EGP). Each market\'s volume forecast × its price per Standard Unit today — one forecast per market, with the reasons behind it. No new price increase assumed.'
      : 'IQVIA Standard Units. One forecast per market, built from its own IQVIA sales history, with the business reasons behind it. Switch the measure to see value (EGP).';
  }
  function render() { hsub(); fillSelect(); detail(); overview(); }

  function wire() {
    ROOT.querySelector('#mf-lvl').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      ST.level = b.dataset.v;
      ROOT.querySelectorAll('#mf-lvl button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      render();
    });
    var mz = ROOT.querySelector('#mf-meas');
    if (mz) mz.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      ST.meas = b.dataset.v; saveState();
      mz.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      render();
    });
    ROOT.querySelector('#mf-seg').addEventListener('change', function (e) { ST.seg[ST.level] = e.target.value; detail(); overview(); });
    ROOT.querySelector('#mf-ov').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-n]'); if (!tr) return;
      ST.seg[ST.level] = tr.getAttribute('data-n'); render();
      var d = ROOT.querySelector('#mf-detail'); if (d && d.scrollIntoView) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function loadState() { try { var s = sessionStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function saveState() { try { sessionStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) { } }

  function init(containerId) {
    var c = document.getElementById(containerId); if (!c) return;
    document.body.classList.add('mfc-mode');
    c.innerHTML = '<div class="mfc" id="mfc-host"></div>'; HOST = ROOT = document.getElementById('mfc-host');
    try {
      D = D || decode();
      if (!D) { ROOT.innerHTML = '<div style="padding:24px">Market forecast data not loaded (cache/market_forecast.data.js). Run UPDATE_DASHBOARD.bat or <code>python etl/build_market_forecast.py --cache</code>.</div>'; return; }
      computeScope();
      var sv = loadState(); if (sv && sv.level) { ST.level = sv.level; ST.seg = sv.seg || {}; ST.meas = sv.meas === 'val' ? 'val' : 'su'; }
      if (!segs(ST.level).length) ST.level = (LEVELS.find(function (l) { return segs(l[0]).length; }) || ['DM1'])[0];
      ROOT.innerHTML = shell(); wire(); methodology(); render();
    } catch (e) {
      console.error('[MarketForecast]', e);
      ROOT.innerHTML = '<div style="padding:24px">Market Forecast could not render: ' + esc(e && e.message || e) + '</div>';
    }
  }
  function destroy() { saveState(); document.body.classList.remove('mfc-mode'); if (HOST) { HOST.innerHTML = ''; HOST = ROOT = null; } }

  global.addEventListener('beforeunload', saveState);
  global.MarketForecastDashboard = { init: init, destroy: destroy };
})(window);
