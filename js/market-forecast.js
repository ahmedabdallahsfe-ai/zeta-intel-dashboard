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
  // 2026-10-15 (Ahmed) v2: BEX plans BOTTOM-UP — a share % per Zeta item; brand / total = sum of items (never typed);
  // BEX may also edit the market FY forecast (SU). Saved per market: { mkt: SU|null, items: {item: share%}, saved, by }.
  // Markets without item detail use items.__total__ (one share for all Zeta).
  function bex2Key() { return 'zeta_mf_bex2_fy' + D.meta.target_year; }
  function bex2All() { try { return JSON.parse(localStorage.getItem(bex2Key()) || '{}') || {}; } catch (e) { return {}; } }
  function bex2Put(map) { try { localStorage.setItem(bex2Key(), JSON.stringify(map)); return true; } catch (e) { return false; } }
  var LIVE_T = null;
  var DRAFT = {};   // unsaved edits per market (segKey -> {mkt, items})
  // 2026-10-15 (Ahmed): items are presentations (brand + form + strength, pack sizes merged). BEX shares saved / imported
  // under an old pack name (e.g. "NEXICUREFILM C.TABS 40MG 20") are added to their presentation ("NEXICURE FILM C.TABS 40MG").
  function bexSaved(r) {
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
    var k = segKey(r);
    if (!DRAFT[k]) { var sv = bexSaved(r) || {}; DRAFT[k] = { mkt: fin(sv.mkt) ? sv.mkt : null, items: JSON.parse(JSON.stringify(sv.items || {})) }; }
    return DRAFT[k];
  }
  function bexDirty(r) {
    var d = DRAFT[segKey(r)]; if (!d) return false;
    var sv = bexSaved(r) || { mkt: null, items: {} };
    return JSON.stringify({ m: d.mkt, i: d.items }) !== JSON.stringify({ m: fin(sv.mkt) ? sv.mkt : null, i: sv.items || {} });
  }
  function itemPrice(i) { return i.s6 && i.s6[0] > 0 ? i.s6[1] / i.s6[0] : (i.mat && i.mat[0] > 0 ? i.mat[1] / i.mat[0] : null); }
  // BEX numbers for the current Zeta selection of market r (sum of the selected items' BEX)
  function bexCalc(r, z) {
    var f = r.forecast || {}, vv = r.value || {}, d = ZF_OFF || !segKey(r) ? (DRAFT[segKey(r)] || (bexSaved(r) ? bexDraft(r) : null)) : bexDraft(r);
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
      out.push({ y: String(ty), basis: 'BEX forecast' + (B.mktEdited ? ' (BEX market)' : ''), msu: fin(B.mkt) ? B.mkt : f.fy_target, msug: fin(B.mkt) ? B.mktGrowth : f.growth_vs_le_pct,
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
    var mfcCell = '<td class="num r mkt">' + (fin(mfc) ? fmtM(mfc, val) : '—') + (bm_.mktEdited ? '<br><small class="mut" title="BEX market">BEX ' + fmtM(val ? bm_.mktVal : bm_.mkt, val) + '</small>' : '') + '</td>' +
      '<td class="num r mkt">' + fmtP(mfg) + (bm_.mktEdited ? '<br><small class="mut">BEX ' + fmtP(val ? bm_.mktValGrowth : bm_.mktGrowth) + '</small>' : '') + '</td>';
    var rows = G.map(function (x) {
      var ZC = zCagr(x.years, k);
      var P = x.P, sh = mk > 0 ? x.mat[k] / mk : null, shp = mkp > 0 ? x.mat[k + 2] / mkp : null, d = fin(sh) && fin(shp) ? (sh - shp) * 100 : null, g = x.mat[k + 2] > 0 ? (x.mat[k] / x.mat[k + 2] - 1) * 100 : null;
      var obj = P.present ? (val ? P.objVal : P.objSU) : null, bx = P.bex && fin(P.bex.su) ? (val ? P.bex.val : P.bex.su) : null, dd = bexDraft(r);
      var sel = (x.kind === 'item' && x.item === ZF.item) || (x.kind === 'brand' && !ZF.item && ZF.brand === x.brand);
      var cls = x.kind === 'item' ? 'irow' : x.kind === 'brand' ? 'irow brow' : 'irow trow';
      var name = x.kind === 'item' ? '<span class="ind">↳</span> <span title="' + esc('Packs: ' + ((x.packs || []).join(' · ') || x.label)) + '">' + esc(x.label) + '</span>' + ((x.packs || []).length > 1 ? ' <small class="mut">(' + x.packs.length + ' packs)</small>' : '') : '<b>' + esc(x.label) + '</b>' + (x.n ? ' <span class="mut small">(' + x.n + ' item' + (x.n > 1 ? 's' : '') + ')</span>' : '');
      return '<tr class="' + cls + (sel ? ' sel' : '') + '" data-kind="' + x.kind + '" data-br="' + esc(x.brand) + '" data-it="' + esc(x.item || '') + '"><td>' + name + '</td><td class="mut">' + esc(x.kind === 'total' ? '' : x.brand) + '</td><td class="mut small">' + esc((x.atc || '').split(' ')[0]) + '</td>' + (showDM ? '<td class="mut small">' + esc(x.kind === 'item' ? dmOf('DM1', [x.item]) : '') + '</td>' : '') + mmCell +
        '<td class="num r">' + fmtM(x.mat[k], val) + '</td><td class="num r">' + fmtP(g) + '</td><td class="num r mut">' + fmtP(MC.pct) + '</td><td class="num r" title="' + esc(ZC.span) + '">' + fmtP(ZC.pct) + (ZC.span && ZC.span !== MC.span ? ' <small class="mut">(' + esc(ZC.span) + ')</small>' : '') + '</td><td class="num r">' + (fin(sh) ? (sh * 100).toFixed(2) + '%' : '—') + '</td><td class="num r ' + (d == null ? '' : d >= 0.05 ? 'pos' : d <= -0.05 ? 'neg' : '') + '">' + (d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(2) + ' pts') + '</td>' +
        mfcCell + '<td>' + (P.present ? chip(P.strategy, P.strategy === 'Grow' ? 'up' : 'n') : '<span class="mut">—</span>') + '</td><td class="num r">' + (P.present ? (P.objShare * 100).toFixed(2) + '%' : '—') + '</td><td class="num r">' + (fin(obj) ? fmtM(obj, val) : '—') + '</td><td class="num r bexc">' + (x.kind === 'item' ? '<input type="text" inputmode="decimal" class="bexi" data-item="' + esc(x.item) + '" min="0" max="100" step="0.01" placeholder="share %" value="' + (fin(dd.items[x.item]) ? dd.items[x.item] : '') + '"> %<br>' : '') + (fin(bx) ? '<b>' + fmtM(bx, val) + '</b> <span class="mut">(' + ((val ? P.bex.valShare : P.bex.share) * 100).toFixed(2) + '%' + (x.kind !== 'item' ? ', ' + P.bex.n + '/' + P.bex.nItems + ' items' : '') + ')</span>' : '<span class="mut">—</span>') + '</td>' +
        '<td class="num r bexg">' + (function (q) { return fin(q) ? fmtP(q * 100) + (x.kind !== 'item' && P.bex.n < P.bex.nItems ? ' <small class="mut" title="Like-for-like: only the items with a BEX share">(' + P.bex.n + '/' + P.bex.nItems + ')</small>' : '') : '<span class="mut">—</span>'; })(bexGrowth(r, x, k)) + '</td></tr>';
    });
    return '<div class="h2row"><h3 class="mt">By brand and item — ' + matLbl() + ' and FY' + D.meta.target_year + ' objective <span class="mut small">(click a brand or an item to plan it above)</span></h3>' +
      '<div class="btns"><button type="button" class="xbtn" id="mf-xtbl" title="All Zeta brands and items (filters ignored) for this market and for every market at this level, SU and value, with objective and BEX forecast">⬇ Excel — full table, all products</button></div></div><div class="tblwrap"><table class="tbl yby itbl"><thead><tr><th>Brand / item</th><th>Brand</th><th>ATC4</th>' + (showDM ? '<th>Defined market</th>' : '') + '<th class="r">Market ' + matLbl() + '</th><th class="r">Market growth<br><small class="mut">vs previous MAT</small></th><th class="r">Zeta ' + matLbl() + '</th><th class="r">Zeta growth<br><small class="mut">vs previous MAT</small></th><th class="r">Market CAGR ' + esc(MC.span) + '</th><th class="r">Zeta CAGR</th><th class="r">Share' + (val ? ' (value)' : ' (SU)') + '</th><th class="r">Share change</th><th class="r">Market FY' + D.meta.target_year + '<br><small class="mut">forecast</small></th><th class="r">Market growth<br><small class="mut">FY' + D.meta.target_year + ' vs ' + D.meta.partial_year + '</small></th><th>Strategy</th><th class="r">Objective share</th><th class="r">Objective FY' + D.meta.target_year + '</th><th class="r">BEX forecast<br><small class="mut">share % per item → SU / value</small></th><th class="r">BEX growth<br><small class="mut">FY' + D.meta.target_year + ' vs ' + D.meta.partial_year + '</small></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function planNotes(r) {
    var P = zplan(r);
    var B = P.bex || {}, st = bexSaved(r), dirty = bexDirty(r);
    var msg = dirty ? '<b class="warnt">Unsaved changes</b> — press Save.' : st && st.saved ? 'Saved ' + esc(st.saved) + (st.by ? ' by ' + esc(st.by) : '') + '.' : 'Plan bottom-up: type the BEX share for each item in the table below (brand and total add up). Edit the market only if BEX disagrees with the forecast.';
    return '<div class="bexbar"><button type="button" class="xbtn" id="mf-bsave"' + (dirty ? '' : ' disabled') + '>Save BEX forecast</button>' +
      '<button type="button" class="xbtn ghost" id="mf-bfill" title="Pre-fill every item with its system objective share">Fill items with objective</button>' +
      '<button type="button" class="xbtn ghost" id="mf-bundo"' + (dirty ? '' : ' disabled') + '>Undo changes</button>' +
      '<button type="button" class="xbtn danger" id="mf-bclear"' + (st || dirty ? '' : ' disabled') + '>Clear BEX forecast</button>' +
      '<span class="mut" id="mf-bmsg">' + msg + '</span></div>' +
      '<p class="note mut">' + esc(zProd(r)) + ' SU = share × market forecast (' + fmtM(P.mktSU, false) + '). Value = SU × ' + esc(zProd(r)) + '\'s own price per SU today (EGP ' + (fin(P.price) ? P.price.toFixed(2) : '—') + ', last 6 months), no new price increase. ' +
      'Objective: Defend = biggest brand in the market, ≥ ' + (OBJ_RULES.dominant * 100) + '% share, or lost ≥ ' + Math.abs(OBJ_RULES.losing) + ' pts vs the previous MAT → hold today\'s share. Grow = otherwise → add the share gain of the latest MAT (min +' + OBJ_RULES.gainMin + ' pts or +25% of a small share; max +' + OBJ_RULES.gainMax + ' pts or double the share). ' +
      'Growth on ' + D.meta.target_year + ' Zeta rows = vs the ' + leLbl() + ' (actual ' + esc(r.ytd.months || 'YTD') + ' + remaining months at Zeta\'s YTD share of the market forecast). BEX forecasts are saved in this browser; share them with the Excel buttons and Import.</p>' +
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
      if (has) a[segKey(r)] = { mkt: fin(D_.mkt) ? D_.mkt : null, items: JSON.parse(JSON.stringify(D_.items)), saved: new Date().toLocaleString(), by: who }; else delete a[segKey(r)];
      var ok = bex2Put(a); overview();
      if (!ok) { var m2 = ROOT.querySelector('#mf-bmsg'); if (m2) m2.textContent = 'Could not save in this browser — use the Excel export.'; } };
    var bu = el.querySelector('#mf-bundo'); if (bu) bu.onclick = function () { delete DRAFT[segKey(r)]; overview(); };
    var bc = el.querySelector('#mf-bclear'); if (bc) bc.onclick = function () {
      if (bc.getAttribute('data-arm') !== '1') { bc.setAttribute('data-arm', '1'); bc.textContent = 'Click again to clear'; setTimeout(function () { if (bc.isConnected) { bc.removeAttribute('data-arm'); bc.textContent = 'Clear BEX forecast'; } }, 4000); return; }
      var a = bex2All(); delete a[segKey(r)]; bex2Put(a); delete DRAFT[segKey(r)]; overview();
      var m3 = ROOT.querySelector('#mf-bmsg'); if (m3) m3.textContent = 'BEX forecast cleared for ' + r.name + '.'; };
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
      var blk = ROOT.querySelector('#mf-ov .plan'); if (blk && blk.scrollIntoView) blk.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
    var x1 = el.querySelector('#mf-xone'); if (x1) x1.onclick = function () { try { exportOne(r); } catch (e) { console.error('[MarketForecast] export', e); alert('Excel export failed: ' + (e && e.message || e)); } };
    var xa = el.querySelector('#mf-xall'); if (xa) xa.onclick = function () { try { exportAll(); } catch (e) { console.error('[MarketForecast] export', e); alert('Excel export failed: ' + (e && e.message || e)); } };
    var xt = el.querySelector('#mf-xtbl'); if (xt) xt.onclick = function () { try { exportTable(r); } catch (e) { console.error('[MarketForecast] export', e); alert('Excel export failed: ' + (e && e.message || e)); } };
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
    if (P.bex && fin(P.bex.su)) aoa.push(['BEX forecast (sum of items)', (P.bex.dirty ? 'UNSAVED ' : '') + (P.bex.saved ? 'saved ' + P.bex.saved : '') + (P.bex.mktEdited ? ' · BEX market ' + Math.round(P.bex.mkt) + ' SU' : ''), n(P.bex.share), n(P.bex.su), n(P.bex.val), n(P.bex.valShare), P.bex.su > 0 ? P.bex.val / P.bex.su : null, (function (L) { return L && L.su > 0 ? P.bex.su / L.su - 1 : null; })(bexLE(r) || zLE(r, (zdata(r).ytd || {}).su, 0))]);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    fmtCells(ws, aoa, hdr, [null, null, '#,##0', '0.0%', '#,##0', '0.0%', '0.0%', '#,##0', '0.0%', '#,##0', '0.0%', '0.0%'], lastYby);
    fmtCells(ws, aoa, t2, [null, null, '0.0%', '#,##0', '#,##0', '0.0%', '0.00', '0.0%']);
    ws['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 17 }, { wch: 12 }, { wch: 17 }, { wch: 12 }, { wch: 12 }, { wch: 40 }];
    var mm0 = (r.scorecard || {}).market_mat || {};
    var it = [['Level', 'Brand / item', 'Brand', 'ATC4', 'SU ' + matLbl(), 'Value ' + matLbl() + ' (EGP)', 'SU growth vs previous MAT', 'Market CAGR SU ' + mktCagr(r, 0).span, 'Zeta CAGR SU', 'Market CAGR value', 'Zeta CAGR value', 'Zeta CAGR period', 'Share (SU)', 'Share change (pts)', 'Price per SU (EGP, 6m)', 'Strategy', 'Objective share (SU)', 'Objective SU FY' + ty, 'Objective value FY' + ty + ' (EGP)', 'BEX share (SU)', 'BEX SU FY' + ty, 'BEX value FY' + ty + ' (EGP)']];
    var mc0 = mktCagr(r, 0), mc1 = mktCagr(r, 1);
    itemGroups(r).forEach(function (x) {
      var Q = x.P, sh = mm0.su > 0 ? x.mat[0] / mm0.su : null, shp = mm0.su_py > 0 ? x.mat[2] / mm0.su_py : null;
      it.push([x.kind === 'total' ? 'Total' : x.kind === 'brand' ? 'Brand total' : 'Item', x.label, x.kind === 'total' ? '' : x.brand, x.atc, x.mat[0], x.mat[1], x.mat[2] > 0 ? x.mat[0] / x.mat[2] - 1 : null, fin(mc0.pct) ? mc0.pct / 100 : null, fin(zCagr(x.years, 0).pct) ? zCagr(x.years, 0).pct / 100 : null, fin(mc1.pct) ? mc1.pct / 100 : null, fin(zCagr(x.years, 1).pct) ? zCagr(x.years, 1).pct / 100 : null, zCagr(x.years, 0).span, n(sh), fin(sh) && fin(shp) ? (sh - shp) * 100 : null, x.s6[0] > 0 ? x.s6[1] / x.s6[0] : null,
        Q.strategy, Q.present ? Q.objShare : null, n(Q.objSU), n(Q.objVal), Q.bex ? Q.bex.share : null, Q.bex ? n(Q.bex.su) : null, Q.bex ? n(Q.bex.val) : null]);
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
      'Market SU FY' + ty + ' (forecast)', 'Market growth SU FY' + ty + ' vs ' + m.partial_year, 'Market value FY' + ty + ' (forecast, EGP)', 'Market growth value FY' + ty + ' vs ' + m.partial_year, 'BEX market SU FY' + ty + ' (if edited)', 'BEX share (SU)', 'BEX SU FY' + ty, 'BEX value FY' + ty + ' (EGP)', 'BEX status',
      'SU ' + leLbl(), 'Value ' + leLbl() + ' (EGP)', 'BEX growth SU FY' + ty + ' vs ' + m.partial_year, 'BEX growth value FY' + ty + ' vs ' + m.partial_year, 'Market SU ' + matLbl(), 'Market value ' + matLbl() + ' (EGP)', 'Market growth SU vs previous MAT', 'Market growth value vs previous MAT', 'Packs (IQVIA items)'];
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
      ['Market MAT', 'Market SU / value and growth = the market in column "Market" (' + matLbl() + ' vs the previous 12 months). ' + m.partial_year + ' full year (estimate) = actual ' + (r.ytd.months || 'YTD') + ' + remaining months at the row\'s YTD share of the market landing estimate. BEX growth = BEX FY' + ty + ' vs that ' + m.partial_year + ' estimate; brand / total rows compare like-for-like (only the items that have a BEX share).'],
      ['Objective', 'Defend = biggest brand, >= ' + (OBJ_RULES.dominant * 100) + '% share, or lost >= ' + Math.abs(OBJ_RULES.losing) + ' pts -> hold share. Grow = add the latest MAT share gain (min +' + OBJ_RULES.gainMin + ' pts or +25% of a small share; max +' + OBJ_RULES.gainMax + ' pts or double the share).'],
      ['BEX', 'Item BEX SU = BEX share x market forecast (or BEX market if edited). Value = SU x the item\'s own price per SU (last 6 months). Brand and total = sum of items. "Unsaved" = typed but not saved yet.'],
      ['IQVIA data to', per(m.data_period)], ['Exported', new Date().toLocaleString()]];
    var wn = XLSX.utils.aoa_to_sheet(note); wn['!cols'] = [{ wch: 20 }, { wch: 120 }];
    XLSX.utils.book_append_sheet(wb, wn, 'Read me');
    XLSX.writeFile(wb, 'Zeta_Brand_Item_FY' + ty + '_' + safeName(r.name) + '.xlsx', { compression: true });
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
      'Strategy', 'Objective share (SU)', 'Objective Zeta SU FY' + ty, 'Objective Zeta value FY' + ty + ' (EGP)', 'BEX market SU FY' + ty, 'BEX share (SU) %', 'BEX Zeta SU FY' + ty, 'BEX Zeta value FY' + ty + ' (EGP)', 'BEX saved'];
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
    var HB = ['Level', 'Market', 'Brand', 'Item', 'ATC4', 'Market SU FY' + ty + ' (forecast)', 'BEX market SU FY' + ty + ' (optional)', 'Item share ' + matLbl(), 'Objective share', 'BEX share %', 'BEX SU FY' + ty, 'BEX value FY' + ty + ' (EGP)', 'Packs (IQVIA items)'];
    var bb = [HB];
    LEVELS.forEach(function (lv) { segs(lv[0]).forEach(function (r) {
      var f = r.forecast || {}, d = bexSaved(r) ? bexDraft(r) : (DRAFT[segKey(r)] || { mkt: null, items: {} }), mkt = fin(d.mkt) ? d.mkt : f.fy_target, mm = (r.scorecard || {}).market_mat || {};
      var its = (((r.scorecard || {}).zeta) || {}).items || [];
      if (!its.length || !(its[0] || {}).years) { var P0 = zplan(r); if (P0.present) bb.push([lv[1], r.name, P0.brands.join(', '), '__total__', '', f.fy_target, fin(d.mkt) ? d.mkt : null, P0.s, P0.objShare, fin(d.items.__total__) ? d.items.__total__ : null, null, null]); return; }
      its.forEach(function (i) {
        var keep = ZF, off = ZF_OFF; ZF_OFF = false; ZF = { key: segKey(r), atc: i.atc4, brand: i.brand, item: i.item }; var Q = zplan(r); ZF = keep; ZF_OFF = off;
        var sh = d.items[i.item], su = fin(sh) && fin(mkt) ? sh / 100 * mkt : null, pr = itemPrice(i);
        bb.push([lv[1], r.name, i.brand, i.item, i.atc4, f.fy_target, fin(d.mkt) ? d.mkt : null, mm.su > 0 ? i.mat[0] / mm.su : null, Q.present ? Q.objShare : null, fin(sh) ? sh : null, su, fin(su) && fin(pr) ? su * pr : null, (i.packs || []).join(' | ')]);
      });
    }); });
    var wsb = XLSX.utils.aoa_to_sheet(bb); fmtCells(wsb, bb, 0, [null, null, null, null, null, '#,##0', '#,##0', '0.00%', '0.00%', '0.00', '#,##0', '#,##0']);
    wsb['!cols'] = [{ wch: 22 }, { wch: 34 }, { wch: 16 }, { wch: 40 }, { wch: 28 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 18 }];
    wsb['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: bb.length - 1, c: HB.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, wsb, 'BEX by item');
    var note = [['How to use'], ['Sheet "BEX by item": type "BEX share %" for each Zeta item (share of the whole market, SU) and, if BEX disagrees with the market forecast, "BEX market SU". Save the file and use "Import BEX file" on the page. Brand and total BEX are always the sum of their items.'],
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
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' }), shn = wb.SheetNames.find(function (n) { return /^BEX by item/.test(n); });
        if (!shn) { alert('No "BEX by item" sheet in ' + file.name + '. Export "Excel — all markets" first, fill the BEX columns there, then import it.'); return; }
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[shn], { defval: null }), a = bex2All(), lvl = {}, nI = 0, nM = 0, touched = {};
        LEVELS.forEach(function (l) { lvl[l[1]] = l[0]; });
        rows.forEach(function (x) {
          var t = lvl[x['Level']] || x['Level'], nm = x['Market'], it = x['Item']; if (!t || !nm || !it) return;
          var k = t + '|' + nm, sh = parseFloat(x['BEX share %']), mk = parseFloat(String(x[Object.keys(x).find(function (c) { return /^BEX market SU/.test(c); })] || '').replace(/,/g, ''));
          if (!touched[k]) { touched[k] = 1; a[k] = { mkt: null, items: {}, saved: 'imported ' + new Date().toLocaleString(), by: file.name }; }
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
    // BEX row: market edit (M SU) + Zeta = sum of item BEX (computed); one share input only when the market has no item detail
    YR.rows.forEach(function (x, i) {
      if (x.fc !== 3) return;
      var rr = rows[i], Bx = PL.bex || {}, d = bexDraft(r), f0 = r.forecast || {}, noItems = !((((r.scorecard || {}).zeta) || {}).items || []).length;
      rr[2] = '<input type="text" inputmode="decimal" id="mf-bmkt" class="bexm" title="BEX view of the FY market in million SU — leave empty to use the forecast" placeholder="' + (fin(f0.fy_target) ? (f0.fy_target / 1e6).toFixed(1) : '') + '" value="' + (fin(d.mkt) ? (d.mkt / 1e6).toFixed(1) : '') + '"> M SU' + (val && fin(x.mval) ? '<br><small class="mut">' + fmtM(x.mval, true) + '</small>' : '');
      if (noItems) rr[6] = '<input type="text" inputmode="decimal" class="bexi" data-item="__total__" min="0" max="100" step="0.1" placeholder="share" value="' + (fin(d.items.__total__) ? d.items.__total__ : '') + '"> %';
      else rr[6] = fin(Bx.share) ? ((val ? Bx.valShare : Bx.share) * 100).toFixed(1) + '% <small class="mut">(' + Bx.n + '/' + Bx.nItems + ' items)</small>' : '<small class="mut">enter item shares below</small>';
    });
    h += '<div class="plan">' + planCard(r) +
      '<div class="tblwrap"><table class="tbl yby"><thead><tr><th>Year</th><th>Basis</th><th class="r">Market</th><th class="r">Market growth</th><th class="r">' + esc(zProd(r)) + '</th><th class="r">' + esc(zProd(r)) + ' growth</th><th class="r">' + esc(zProd(r)) + ' share' + (val ? ' (value)' : '') + '</th></tr></thead><tbody>' +
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
