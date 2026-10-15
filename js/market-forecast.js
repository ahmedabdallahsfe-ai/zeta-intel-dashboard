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


  // ── 2026-10-15 (Ahmed): Zeta FY+1 objective (Defend / Grow), BEX forecast input (saved), Excel export / import ──
  function bexKey() { return 'zeta_mf_bex_fy' + D.meta.target_year; }
  function bexAll() { try { return JSON.parse(localStorage.getItem(bexKey()) || '{}') || {}; } catch (e) { return {}; } }
  function bexPut(map) { try { localStorage.setItem(bexKey(), JSON.stringify(map)); return true; } catch (e) { return false; } }
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
  function zplan(r) {
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
    var b = bexAll()[bk(r)];
    if (b && fin(b.share) && fin(o.mktSU)) { o.bex = { share: b.share / 100, su: b.share / 100 * o.mktSU, saved: b.saved, by: b.by };
      o.bex.val = fin(o.price) ? o.bex.su * o.price : null; o.bex.valShare = fin(o.bex.val) && o.mktVal > 0 ? o.bex.val / o.mktVal : null; }
    return o;
  }
  // year-by-year rows in BOTH measures (used by the page and the Excel)
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
    out.push({ y: py + ' full year', basis: 'Market landing estimate', msu: f.fy_le, msug: gr_(f.fy_le, (r.history[ly] || {}).su), mval: vv.fy_le, mvalg: gr_(vv.fy_le, (vv.history || {})[ly]) });
    out.push({ y: String(ty), basis: 'Market forecast', msu: f.fy_target, msug: f.growth_vs_le_pct, mval: vv.fy_target, mvalg: vv.growth_vs_le_pct, fc: 1 });
    if (P.present) out.push({ y: String(ty), basis: zProd(r) + ' objective — ' + P.strategy, msu: f.fy_target, msug: f.growth_vs_le_pct, zsu: P.objSU, zsug: gr_(P.objSU, P.zsu), mval: vv.fy_target, mvalg: vv.growth_vs_le_pct, zval: P.objVal, zvalg: gr_(P.objVal, P.zval), fc: 2, note: 'Growth vs ' + matLbl() });
    if (P.bex) out.push({ y: String(ty), basis: 'BEX forecast', msu: f.fy_target, msug: f.growth_vs_le_pct, zsu: P.bex.su, zsug: gr_(P.bex.su, P.zsu), mval: vv.fy_target, mvalg: vv.growth_vs_le_pct, zval: P.bex.val, zvalg: gr_(P.bex.val, P.zval), fc: 3, note: 'Growth vs ' + matLbl() });
    else if (fin(f.fy_target)) out.push({ y: String(ty), basis: 'BEX forecast', msu: f.fy_target, msug: f.growth_vs_le_pct, mval: vv.fy_target, mvalg: vv.growth_vs_le_pct, fc: 3, empty: 1 });
    out.forEach(function (x) { x.zsush = x.msu > 0 && fin(x.zsu) ? x.zsu / x.msu : null; x.zvalsh = x.mval > 0 && fin(x.zval) ? x.zval / x.mval : null; });
    var fy = m.full_years, y0 = fy[0], yN = fy[fy.length - 1], zf = fy.find(function (yy) { return (yrs[String(yy)] || {}).zsu > 0; });
    var C = { hist: { span: y0 + '–' + yN, msu: cagr((r.history[y0] || {}).su, (r.history[yN] || {}).su, yN - y0), mval: cagr((vv.history || {})[y0], (vv.history || {})[yN], yN - y0),
        zspan: zf ? zf + '–' + yN : '', zsu: zf ? cagr(yrs[zf].zsu, (yrs[yN] || {}).zsu, yN - zf) : null, zval: zf ? cagr(yrs[zf].zval, (yrs[yN] || {}).zval, yN - zf) : null },
      fc: { span: yN + '–' + ty, msu: cagr((r.history[yN] || {}).su, f.fy_target, ty - yN), mval: cagr((vv.history || {})[yN], vv.fy_target, ty - yN),
        zsu: P.present ? cagr((yrs[yN] || {}).zsu, P.objSU, ty - yN) : null, zval: P.present ? cagr((yrs[yN] || {}).zval, P.objVal, ty - yN) : null,
        bsu: P.bex ? cagr((yrs[yN] || {}).zsu, P.bex.su, ty - yN) : null, bval: P.bex ? cagr((yrs[yN] || {}).zval, P.bex.val, ty - yN) : null } };
    return { rows: out, cagr: C, plan: P };
  }
  function planCard(r) {   // 2026-10-15: header, strategy and notes; the objective + BEX rows are in the year-by-year table
    var P = zplan(r), m = D.meta, ty = m.target_year;
    var h = '<div class="h2row"><h3 class="mt">Year by year — market and ' + esc(zProd(r)) + ' · FY' + ty + ' objective & BEX forecast</h3>' +
      '<div class="btns"><button type="button" class="xbtn" id="mf-xone">⬇ Excel — this market</button><button type="button" class="xbtn" id="mf-xall">⬇ Excel — all markets (FY' + ty + ' plan)</button><label class="xbtn" title="Load BEX shares from an exported all-markets file">⬆ Import BEX file<input type="file" id="mf-ximp" accept=".xlsx,.xls" hidden></label></div></div>';
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
  function itemTable(r) {
    var all = zItems(r, true);
    if (!all.length || !(all[0] || {}).years) return '';
    var val = isV(), k = val ? 1 : 0, sc = r.scorecard || {}, mm = sc.market_mat || {}, mk = val ? mm.val : mm.su, mkp = val ? mm.val_py : mm.su_py, keep = ZF.item;
    var rows = all.map(function (i) {
      ZF.item = i.item; ZF.key = segKey(r); var P = zplan(r); ZF.item = keep;
      var sh = mk > 0 ? i.mat[k] / mk : null, shp = mkp > 0 ? i.mat[k + 2] / mkp : null, d = fin(sh) && fin(shp) ? (sh - shp) * 100 : null, g = i.mat[k + 2] > 0 ? (i.mat[k] / i.mat[k + 2] - 1) * 100 : null;
      var obj = P.present ? (val ? P.objVal : P.objSU) : null, bx = P.bex ? (val ? P.bex.val : P.bex.su) : null;
      return '<tr class="irow' + (i.item === keep ? ' sel' : '') + '" data-it="' + esc(i.item) + '"><td>' + esc(i.item) + '</td><td class="mut">' + esc(i.brand) + '</td><td class="mut small">' + esc((i.atc4 || '').split(' ')[0]) + '</td>' +
        '<td class="num r">' + fmtM(i.mat[k], val) + '</td><td class="num r">' + fmtP(g) + '</td><td class="num r">' + (fin(sh) ? (sh * 100).toFixed(2) + '%' : '—') + '</td><td class="num r ' + (d == null ? '' : d >= 0.05 ? 'pos' : d <= -0.05 ? 'neg' : '') + '">' + (d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(2) + ' pts') + '</td>' +
        '<td>' + (P.present ? chip(P.strategy, P.strategy === 'Grow' ? 'up' : 'n') : '<span class="mut">—</span>') + '</td><td class="num r">' + (P.present ? (P.objShare * 100).toFixed(2) + '%' : '—') + '</td><td class="num r">' + (fin(obj) ? fmtM(obj, val) : '—') + '</td><td class="num r">' + (fin(bx) ? fmtM(bx, val) + ' <span class="mut">(' + (P.bex.share * 100).toFixed(2) + '%)</span>' : '—') + '</td></tr>';
    });
    return '<h3 class="mt">By item — ' + matLbl() + ' and FY' + D.meta.target_year + ' objective <span class="mut small">(click an item to plan it above)</span></h3><div class="tblwrap"><table class="tbl yby itbl"><thead><tr><th>Item</th><th>Brand</th><th>ATC4</th><th class="r">' + matLbl() + '</th><th class="r">Growth</th><th class="r">Share' + (val ? ' (value)' : ' (SU)') + '</th><th class="r">Share change</th><th>Strategy</th><th class="r">Objective share</th><th class="r">Objective FY' + D.meta.target_year + '</th><th class="r">BEX forecast</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function planNotes(r) {
    var P = zplan(r);
    return '<div class="bexbar"><button type="button" class="xbtn" id="mf-bsave">Save BEX forecast</button><button type="button" class="xbtn ghost" id="mf-bclear">Clear</button><span class="mut" id="mf-bmsg">' + (P.bex && P.bex.saved ? 'Saved ' + esc(P.bex.saved) : 'Type the BEX share (SU %) in the BEX forecast row — ' + esc(zProd(r)) + ' SU and value calculate automatically.') + '</span></div>' +
      '<p class="note mut">' + esc(zProd(r)) + ' SU = share × market forecast (' + fmtM(P.mktSU, false) + '). Value = SU × ' + esc(zProd(r)) + '\'s own price per SU today (EGP ' + (fin(P.price) ? P.price.toFixed(2) : '—') + ', last 6 months), no new price increase. ' +
      'Objective: Defend = biggest brand in the market, ≥ ' + (OBJ_RULES.dominant * 100) + '% share, or lost ≥ ' + Math.abs(OBJ_RULES.losing) + ' pts vs the previous MAT → hold today\'s share. Grow = otherwise → add the share gain of the latest MAT (min +' + OBJ_RULES.gainMin + ' pts or +25% of a small share; max +' + OBJ_RULES.gainMax + ' pts or double the share). ' +
      'Growth on ' + D.meta.target_year + ' Zeta rows = vs ' + matLbl() + '. BEX forecasts are saved in this browser; share them with the Excel buttons and Import.</p>' +
      '<p class="note"><b>Zeta product' + (P.brands.length > 1 ? 's' : '') + ':</b> ' + esc(P.brands.join(', ') || '—') + ' · <b>Items:</b> ' + esc(P.items.map(function (i) { return i.item; }).join(' · ') || '—') + '</p>';
  }
  function wirePlan(r) {
    var el = ROOT.querySelector('#mf-ov'); if (!el) return;
    var inp = el.querySelector('#mf-bex'), P = zplan(r);
    var calc = function () {
      var v = parseFloat(inp.value), ok = fin(v) && v >= 0 && v <= 100, isv = isV();
      var su = ok ? v / 100 * P.mktSU : null, val = ok && fin(P.price) ? su * P.price : null, amt = isv ? val : su, base = isv ? P.zval : P.zsu;
      var a1 = el.querySelector('#mf-bz'), a2 = el.querySelector('#mf-bg'), a3 = el.querySelector('#mf-bvsh');
      if (a1) a1.textContent = ok && fin(amt) ? fmtM(amt, isv) : '—';
      if (a2) a2.textContent = ok && fin(amt) && base > 0 ? fmtP((amt / base - 1) * 100) : '—';
      if (a3) a3.textContent = isv && ok && fin(val) && P.mktVal > 0 ? '= ' + (val / P.mktVal * 100).toFixed(1) + '% value' : '';
    };
    if (inp) inp.addEventListener('input', calc);
    var bs = el.querySelector('#mf-bsave'); if (bs) bs.onclick = function () {
      var v = parseFloat(inp.value), msg = el.querySelector('#mf-bmsg');
      if (!(fin(v) && v >= 0 && v <= 100)) { msg.textContent = 'Enter a share between 0 and 100.'; return; }
      var a = bexAll(), cu = (typeof AU().getValidSessionUser === 'function' ? AU().getValidSessionUser() : null) || {}, who = cu.name || cu.email || '';
      a[bk(r)] = { share: Math.round(v * 100) / 100, saved: new Date().toLocaleString(), by: who };
      var ok = bexPut(a); overview();
      var m2 = ROOT.querySelector('#mf-bmsg'); if (m2) m2.textContent = ok ? 'Saved ' + a[bk(r)].saved : 'Could not save in this browser — use the Excel export.';
    };
    var bc = el.querySelector('#mf-bclear'); if (bc) bc.onclick = function () { var a = bexAll(); delete a[bk(r)]; bexPut(a); overview(); };
    var setZ = function (k, v) { ZF.key = segKey(r); ZF[k] = v; if (k === 'atc') { ZF.brand = ''; ZF.item = ''; } if (k === 'brand') ZF.item = ''; overview(); };
    var za = el.querySelector('#mf-zatc'); if (za) za.onchange = function () { setZ('atc', za.value); };
    var zb = el.querySelector('#mf-zbr'); if (zb) zb.onchange = function () { setZ('brand', zb.value); };
    var zi = el.querySelector('#mf-zit'); if (zi) zi.onchange = function () {
      var it = ((((r.scorecard || {}).zeta) || {}).items || []).find(function (i) { return i.item === zi.value; });
      ZF.key = segKey(r); ZF.item = zi.value; if (it) { ZF.brand = it.brand; ZF.atc = it.atc4; } overview(); };
    var zc = el.querySelector('#mf-zclr'); if (zc) zc.onclick = function () { ZF = { key: segKey(r), atc: '', brand: '', item: '' }; overview(); };
    el.querySelectorAll('tr.irow').forEach(function (tr) { tr.onclick = function () {
      var it = ((((r.scorecard || {}).zeta) || {}).items || []).find(function (i) { return i.item === tr.getAttribute('data-it'); });
      if (!it) return; ZF = { key: segKey(r), atc: it.atc4, brand: it.brand, item: it.item }; overview();
      var blk = ROOT.querySelector('#mf-ov .plan'); if (blk && blk.scrollIntoView) blk.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
    var x1 = el.querySelector('#mf-xone'); if (x1) x1.onclick = function () { try { exportOne(r); } catch (e) { console.error('[MarketForecast] export', e); alert('Excel export failed: ' + (e && e.message || e)); } };
    var xa = el.querySelector('#mf-xall'); if (xa) xa.onclick = function () { try { exportAll(); } catch (e) { console.error('[MarketForecast] export', e); alert('Excel export failed: ' + (e && e.message || e)); } };
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
    aoa.push([]); aoa.push([zProd(r) + ' target FY' + ty, '', 'Share (SU)', zProd(r) + ' SU', zProd(r) + ' value (EGP)', 'Share (value)', 'Price per SU (EGP)', 'Growth vs ' + matLbl() + ' (SU)']);
    var t2 = aoa.length - 1;
    if (P.present) aoa.push(['System objective', P.strategy, n(P.objShare), n(P.objSU), n(P.objVal), n(P.objValShare), n(P.price), P.zsu > 0 ? P.objSU / P.zsu - 1 : null]);
    if (P.bex) aoa.push(['BEX forecast', P.bex.saved ? 'saved ' + P.bex.saved : '', n(P.bex.share), n(P.bex.su), n(P.bex.val), n(P.bex.valShare), n(P.price), P.zsu > 0 ? P.bex.su / P.zsu - 1 : null]);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    fmtCells(ws, aoa, hdr, [null, null, '#,##0', '0.0%', '#,##0', '0.0%', '0.0%', '#,##0', '0.0%', '#,##0', '0.0%', '0.0%'], lastYby);
    fmtCells(ws, aoa, t2, [null, null, '0.0%', '#,##0', '#,##0', '0.0%', '0.00', '0.0%']);
    ws['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 17 }, { wch: 12 }, { wch: 17 }, { wch: 12 }, { wch: 12 }, { wch: 40 }];
    var keepI = ZF.item, mm0 = (r.scorecard || {}).market_mat || {};
    var it = [['Zeta item', 'Brand', 'ATC4', 'SU ' + matLbl(), 'Value ' + matLbl() + ' (EGP)', 'SU growth vs previous MAT', 'Share (SU)', 'Share change (pts)', 'Price per SU (EGP, 6m)', 'Strategy', 'Objective share (SU)', 'Objective SU FY' + ty, 'Objective value FY' + ty + ' (EGP)', 'BEX share (SU)', 'BEX SU FY' + ty, 'BEX value FY' + ty + ' (EGP)']];
    zItems(r, true).forEach(function (i) {
      ZF.item = i.item; ZF.key = segKey(r); var Q = zplan(r); ZF.item = keepI;
      var sh = mm0.su > 0 ? i.mat[0] / mm0.su : null, shp = mm0.su_py > 0 ? i.mat[2] / mm0.su_py : null;
      it.push([i.item, i.brand, i.atc4, i.mat[0], i.mat[1], i.mat[2] > 0 ? i.mat[0] / i.mat[2] - 1 : null, n(sh), fin(sh) && fin(shp) ? (sh - shp) * 100 : null, i.s6[0] > 0 ? i.s6[1] / i.s6[0] : null,
        Q.strategy, Q.present ? Q.objShare : null, n(Q.objSU), n(Q.objVal), Q.bex ? Q.bex.share : null, Q.bex ? n(Q.bex.su) : null, Q.bex ? n(Q.bex.val) : null]);
    });
    var ws2 = XLSX.utils.aoa_to_sheet(it); fmtCells(ws2, it, 0, [null, null, null, '#,##0', '#,##0', '0.0%', '0.00%', '+0.00;-0.00;0.00', '0.00', null, '0.00%', '#,##0', '#,##0', '0.00%', '#,##0', '#,##0']);
    ws2['!cols'] = [{ wch: 40 }, { wch: 16 }, { wch: 30 }].concat(it[0].slice(3).map(function () { return { wch: 16 }; }));
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Market plan FY' + ty); XLSX.utils.book_append_sheet(wb, ws2, 'Zeta by item');
    XLSX.writeFile(wb, 'Market_Plan_FY' + ty + '_' + safeName(r.name) + (zfOn(r) ? '_' + safeName(zSelLabel(r)) : '') + '.xlsx', { compression: true });
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
      'Strategy', 'Objective share (SU)', 'Objective Zeta SU FY' + ty, 'Objective Zeta value FY' + ty + ' (EGP)', 'BEX share (SU) %', 'BEX Zeta SU FY' + ty, 'BEX Zeta value FY' + ty + ' (EGP)', 'BEX saved'];
    var aoa = [H];
    LEVELS.forEach(function (lv) { segs(lv[0]).slice().sort(function (a, b) { return (b.forecast ? b.forecast.fy_target : 0) - (a.forecast ? a.forecast.fy_target : 0); }).forEach(function (r) {
      var Y = yearRows(r), P = Y.plan, C = Y.cagr, f = r.forecast || {}, vv = r.value || {}, n = function (x) { return fin(x) ? x : null; }, p = function (x) { return fin(x) ? x / 100 : null; };
      aoa.push([lv[1], r.name, P.brands.join(', '), P.items.map(function (i) { return i.item; }).join(' · '), n((r.history[ly] || {}).su), n(f.fy_target), p(f.growth_vs_le_pct), p(C.hist.msu),
        n((vv.history || {})[ly]), n(vv.fy_target), p(vv.growth_vs_le_pct), p(C.hist.mval),
        n(P.zsu), n(P.zval), n(P.s), fin(P.d) ? P.d : null, p(C.hist.zsu), n(P.price),
        P.strategy, P.present ? P.objShare : null, n(P.objSU), n(P.objVal), P.bex ? P.bex.share * 100 : null, P.bex ? n(P.bex.su) : null, P.bex ? n(P.bex.val) : null, P.bex ? (P.bex.saved || '') : '']);
    }); });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    fmtCells(ws, aoa, 0, [null, null, null, null, '#,##0', '#,##0', '0.0%', '0.0%', '#,##0', '#,##0', '0.0%', '0.0%', '#,##0', '#,##0', '0.0%', '+0.0;-0.0;0.0', '0.0%', '0.00', null, '0.0%', '#,##0', '#,##0', '0.0', '#,##0', '#,##0']);
    ws['!cols'] = H.map(function (h, i) { return { wch: i === 1 ? 34 : i === 3 ? 40 : Math.max(12, Math.min(24, h.length + 2)) }; });
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: H.length - 1 } }) };
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'All markets FY' + ty);
    var note = [['How to use'], ['Type or change "BEX share (SU) %" for any market, save the file, then use "Import BEX file" on the page to load it (Level + Market identify the row).'],
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
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' }), sh = wb.Sheets[wb.SheetNames.find(function (n) { return /^All markets/.test(n); }) || wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(sh, { defval: null }), a = bexAll(), n = 0, lvl = {};
        LEVELS.forEach(function (l) { lvl[l[1]] = l[0]; });
        rows.forEach(function (x) { var t = lvl[x['Level']] || x['Level'], nm = x['Market'], v = parseFloat(x['BEX share (SU) %']);
          if (!t || !nm) return;
          if (fin(v) && v >= 0 && v <= 100) { a[t + '|' + nm] = { share: Math.round(v * 100) / 100, saved: 'imported ' + new Date().toLocaleString(), by: file.name }; n++; } });
        bexPut(a); alert(n + ' BEX forecasts loaded from ' + file.name + '.'); overview();
      } catch (err) { console.error('[MarketForecast] import', err); alert('Could not read the file: ' + (err && err.message || err)); }
    };
    rd.readAsArrayBuffer(file);
  }

  // 2026-10-15 (Ahmed): the bottom section shows ONLY the selected market — performance + forecast in plain words
  function chip(txt, cls) { return '<span class="vchip ' + cls + '">' + esc(txt) + '</span>'; }
  function overview() {
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
    var h = '<div class="h2row"><h2>' + esc(r.name) + ' — at a glance</h2><div class="sub">Performance and forecast in one view · ' + (val ? 'Value (EGP; forecast at today\'s prices)' : 'Standard Units') + '</div></div>';
    h += '<div class="gtiles">' + tiles.map(function (x) { return '<div class="gtile"><div class="kl">' + esc(x[0]) + '</div><div class="gv">' + chip(x[1][0], x[1][1]) + '</div><div class="ks">' + esc(x[2]) + '</div></div>'; }).join('') + '</div>';
    // year by year (+ Zeta objective, BEX forecast and CAGR)
    var YR = yearRows(r), kk = val ? ['mval', 'mvalg', 'zval', 'zvalg', 'zvalsh'] : ['msu', 'msug', 'zsu', 'zsug', 'zsush'];
    var rows = YR.rows.map(function (x) { var sp = x.y.indexOf(' ');
      return ['<b>' + esc(sp > 0 ? x.y.slice(0, sp) : x.y) + '</b>' + (sp > 0 ? ' ' + esc(x.y.slice(sp + 1)) : ''),
      (x.fc ? '<b>' : '') + esc(x.basis) + (x.fc ? '</b>' : ''), fmtM(x[kk[0]], val), fmtP(x[kk[1]]), fin(x[kk[2]]) ? fmtM(x[kk[2]], val) : '—', fin(x[kk[3]]) ? fmtP(x[kk[3]]) : '—', fin(x[kk[4]]) ? (x[kk[4]] * 100).toFixed(1) + '%' : '—', x.fc || 0]; });
    var C = YR.cagr, ck = val ? ['mval', 'zval'] : ['msu', 'zsu'], PL = YR.plan;
    rows.push(['<b>CAGR</b> ' + esc(C.hist.span), 'Actual, average a year', '', fmtP(C.hist[ck[0]]), '', fmtP(C.hist[ck[1]]) + (C.hist.zspan && C.hist.zspan !== C.hist.span ? ' <span class="mut">(' + esc(C.hist.zspan) + ')</span>' : ''), '', 9]);
    // BEX row: share input + live Zeta amount / growth
    YR.rows.forEach(function (x, i) {
      if (x.fc !== 3) return;
      var rr = rows[i];
      rr[4] = '<span id="mf-bz">' + (fin(x[kk[2]]) ? fmtM(x[kk[2]], val) : '—') + '</span>';
      rr[5] = '<span id="mf-bg">' + (fin(x[kk[3]]) ? fmtP(x[kk[3]]) : '—') + '</span>';
      rr[6] = '<input type="number" id="mf-bex" min="0" max="100" step="0.1" placeholder="SU share" value="' + (PL.bex ? (PL.bex.share * 100).toFixed(1) : '') + '"> %' +
        (val ? ' <small class="mut" id="mf-bvsh">' + (PL.bex && fin(PL.bex.valShare) ? '= ' + (PL.bex.valShare * 100).toFixed(1) + '% value' : '') + '</small>' : '');
    });
    h += '<div class="plan">' + planCard(r) +
      '<div class="tblwrap"><table class="tbl yby"><thead><tr><th>Year</th><th>Basis</th><th class="r">Market</th><th class="r">Market growth</th><th class="r">' + esc(zProd(r)) + '</th><th class="r">' + esc(zProd(r)) + ' growth</th><th class="r">' + esc(zProd(r)) + ' share' + (val ? ' (value; BEX input = SU share)' : '') + '</th></tr></thead><tbody>' +
      rows.map(function (x, i) { var c = x[7], mt = (YR.rows[i] || {}).mat; return '<tr class="' + (c === 1 ? 'fc' : c === 2 ? 'fc obj' : c === 3 ? 'fc bex bexrow' : c === 9 ? 'cg' : mt ? 'matrow' : '') + '">' + x.slice(0, 7).map(function (cc, j) { return '<td' + (j >= 2 ? ' class="num r"' : '') + '>' + cc + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>' + planNotes(r) + itemTable(r) +
      '<p class="note mut">Growth = vs the year before (' + py + ' so far = vs the same months last year; ' + matLbl() + ' = vs the previous 12 months). CAGR = average growth a year.</p></div>';
    // who wins the market
    var top = br.slice(0, 8), zIn = top.some(function (b) { return b.z; });
    if (!zIn) { var zb = br.find(function (b) { return b.z; }); if (zb) top.push(zb); }
    h += '<div class="g2"><div><h3 class="mt">Who wins the market — ' + matLbl() + ' (' + esc(sc.mat_label || '') + ')</h3><div class="tblwrap"><table class="tbl yby"><thead><tr><th>#</th><th>Brand</th><th>Company</th><th class="r">Sales</th><th class="r">Share</th><th class="r">Share change</th><th class="r">Growth</th></tr></thead><tbody>' +
      top.map(function (b) {
        var s1 = mm[k] > 0 ? b[k] / mm[k] : null, s0 = mm[k + '_py'] > 0 ? b[k + '_py'] / mm[k + '_py'] : null, d = fin(s1) && fin(s0) ? (s1 - s0) * 100 : null, gb = g(b[k], b[k + '_py']);
        return '<tr class="' + (b.z ? 'zrow' : '') + '"><td class="mut">' + (br.indexOf(b) + 1) + '</td><td>' + esc(b.n) + (b.z ? ' <span class="zt">Zeta</span>' : '') + '</td><td class="mut">' + esc((b.c || '').replace('*', '')) + '</td><td class="num r">' + fmtM(b[k], val) + '</td><td class="num r">' + (fin(s1) ? (s1 * 100).toFixed(1) + '%' : '—') + '</td>' +
          '<td class="num r ' + (d == null ? '' : d >= 0.05 ? 'pos' : d <= -0.05 ? 'neg' : '') + '">' + (d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(1) + ' pts') + '</td><td class="num r">' + (gb == null ? (b[k] > 0 ? 'new' : '—') : fmtP(gb)) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="note mut">Share = brand ÷ the whole market. Share change = points won or lost vs the 12 months before. A brand growing faster than the market (' + fmtP(mg) + ') is taking share.</p></div></div>';
    el.innerHTML = h;
    wirePlan(r);
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
