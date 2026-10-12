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
  var ST = { level: 'DM1', seg: {}, sort: 'size' };
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
  function size(r) { return r.forecast ? r.forecast.fy_target : (r.history[String(D.meta.full_years[D.meta.full_years.length - 1])] || {}).su || 0; }

  // ── markup ──
  function shell() {
    var m = D.meta;
    return '<div class="wrap">' +
      '<header class="top"><div><h1>Market Growth Forecast — FY' + m.target_year + '</h1>' +
      '<div class="sub">IQVIA Standard Units. Each market is forecast separately from its own monthly history and checked against what actually happened in past periods. Volume only, not value or price.</div></div>' +
      '<div class="sub asof">Actuals to <b>' + esc(per(m.data_period)) + '</b> · built ' + esc(m.generated_at) + '</div></header>' +
      '<section class="card controls" aria-label="Filters">' +
      '<div class="ctl"><label>Market level</label><div class="seg" id="mf-lvl">' +
      LEVELS.filter(function (l) { return segs(l[0]).length; }).map(function (l) { return '<button data-v="' + l[0] + '" aria-pressed="' + (l[0] === ST.level) + '">' + esc(l[1]) + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="ctl grow"><label for="mf-seg">Market</label><select id="mf-seg"></select></div>' +
      '</section>' +
      '<div id="mf-detail"></div>' +
      '<section class="card"><div class="h2row"><h2>All markets at this level</h2><div class="sub">Click a row to open it. Sorted by FY' + m.target_year + ' size.</div></div><div class="tblwrap" id="mf-ov"></div></section>' +
      '<details class="card method" id="mf-method"><summary><h2>Methodology & data notes</h2></summary><div id="mf-methodbody"></div></details>' +
      '</div>';
  }

  function fillSelect() {
    var sel = ROOT.querySelector('#mf-seg'), list = segs(ST.level).slice().sort(function (a, b) { return size(b) - size(a); });
    var c = cur();
    sel.innerHTML = list.map(function (r) { return '<option' + (c && r.name === c.name ? ' selected' : '') + ' value="' + esc(r.name) + '">' + esc(r.name) + '</option>'; }).join('');
    sel.disabled = list.length < 2;
  }

  function badge(r) { return '<span class="conf ' + confCls(r.confidence) + '">' + esc(r.confidence) + ' confidence</span>'; }

  function kpis(r) {
    var f = r.forecast, m = D.meta, ly = String(m.full_years[m.full_years.length - 1]);
    var sc = f && f.scenarios;
    var rr = r.forecast_type === 'run_rate_floor';
    var cards = [
      ['FY' + ly + ' actual', fmtSU(r.history[ly].su), 'Latest complete year (SU)'],
      ['FY' + m.partial_year + ' landing estimate', f ? fmtSU(f.fy_le) : '—', MON[0] + '–' + MON[m.partial_months - 1] + ' actual ' + fmtSU(r.ytd.cur) + ' + ' + MON[m.partial_months % 12] + '–Dec forecast'],
      ['FY' + m.target_year + (rr ? ' run-rate floor' : ' forecast'), f ? fmtSU(f.fy_target) : '—', f ? esc(MODEL_SHORT[r.selected_model] || r.selected_model) : 'No forecast'],
      [(rr ? 'Floor vs FY' : 'FY' + m.target_year + ' growth vs FY') + m.partial_year + ' LE', f ? fmtP(f.growth_vs_le_pct) : '—',
        sc ? 'Range ' + fmtP(sc.low_growth_pct) + ' to ' + fmtP(sc.high_growth_pct) : (rr ? 'Not a growth forecast; no range' : 'No statistically supportable range')],
      ['Confidence', '<span class="conf big ' + confCls(r.confidence) + '">' + esc(r.confidence) + '</span>', esc((r.confidence_reasons || [])[0] || '')]
    ];
    return '<section class="kpis">' + cards.map(function (c) {
      return '<div class="kpi"><div class="kl">' + esc(c[0]) + '</div><div class="kv num">' + c[1] + '</div><div class="ks">' + c[2] + '</div></div>';
    }).join('') + '</section>';
  }

  function banners(r) {
    var h = '';
    if (r.forecast_type === 'run_rate_floor') {
      var why_ = r.lifecycle === 'Launch'
        ? 'Only ' + r.consecutive_positive_months + ' consecutive months of sales (a validated forecast needs ' + D.meta.config.launch_months + ').'
        : 'Too few past test points (' + r.backtest.n_common + ') to validate any method.';
      h += '<div class="banner warn"><b>Not statistically forecastable.</b> ' + esc(why_) +
        ' A credible launch-type forecast needs analog uptake curves or brand-team input. The figure shown is a <b>run-rate floor</b> (last 3 months average × 12): a minimum to plan from, not a growth forecast and not a target.</div>';
    }
    if (r.same_as && r.same_as.length) h += '<div class="banner info">Same market (identical products) as ' + esc(r.same_as.join(', ')) + '.</div>';
    if (r.residual_market) h += '<div class="banner info">Includes <b>OTHER MARKET</b>, the residual of everything outside Zeta\'s defined markets. Read it as the background market, not a promoted market.</div>';
    return h;
  }

  // ── charts (inline SVG, colours from CSS variables so night mode works) ──
  function annualChart(r) {
    var m = D.meta, f = r.forecast, sc = f && f.scenarios, py = m.partial_year;
    var bars = m.full_years.map(function (y) { return { lab: String(y), a: r.history[String(y)].su, f: 0 }; });
    bars.push({ lab: py + ' LE', a: r.ytd.cur, f: f ? Math.max(0, f.fy_le - r.ytd.cur) : 0, note: 'actual ' + MON[0] + '–' + MON[m.partial_months - 1] + ' + forecast' });
    if (f) bars.push({ lab: 'FY' + m.target_year, a: 0, f: f.fy_target, lo: sc && sc.low, hi: sc && sc.high, last: true });
    var W = 760, H = 250, L = 56, R = 12, T = 18, B = 34, n = bars.length;
    var mx = Math.max.apply(null, bars.map(function (b) { return Math.max(b.a + b.f, b.hi || 0); })) * 1.08 || 1;
    var bw = (W - L - R) / n, y = function (v) { return T + (H - T - B) * (1 - v / mx); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Annual Standard Units, actual and forecast">' +
      '<defs><pattern id="mf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="hb"/><line x1="0" y1="0" x2="0" y2="6" class="hl"/></pattern></defs>';
    for (var g = 0; g <= 4; g++) { var gv = mx * g / 4; s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(gv) + '" y2="' + y(gv) + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y(gv) + 4) + '" class="ax" text-anchor="end">' + fmtSU(gv) + '</text>'; }
    bars.forEach(function (b, i) {
      var x = L + i * bw + bw * 0.18, w = bw * 0.64;
      if (b.a > 0) s += '<rect x="' + x + '" y="' + y(b.a) + '" width="' + w + '" height="' + (y(0) - y(b.a)) + '" class="ba"><title>' + esc(b.lab) + ' actual: ' + fmtSU(b.a) + ' SU</title></rect>';
      if (b.f > 0) s += '<rect x="' + x + '" y="' + y(b.a + b.f) + '" width="' + w + '" height="' + (y(b.a) - y(b.a + b.f)) + '" class="bf"><title>' + esc(b.lab) + ' forecast part: ' + fmtSU(b.f) + ' SU</title></rect>';
      if (fin(b.lo) && fin(b.hi)) {
        var cx = x + w / 2;
        s += '<line x1="' + cx + '" x2="' + cx + '" y1="' + y(b.hi) + '" y2="' + y(b.lo) + '" class="wh"/><line x1="' + (cx - 8) + '" x2="' + (cx + 8) + '" y1="' + y(b.hi) + '" y2="' + y(b.hi) + '" class="wh"/><line x1="' + (cx - 8) + '" x2="' + (cx + 8) + '" y1="' + y(b.lo) + '" y2="' + y(b.lo) + '" class="wh"><title>Range ' + fmtSU(b.lo) + ' – ' + fmtSU(b.hi) + '</title></line>';
      }
      s += '<text x="' + (x + w / 2) + '" y="' + (y(Math.max(b.a + b.f, fin(b.hi) ? b.hi : 0)) - 5) + '" class="val" text-anchor="middle">' + fmtSU(b.a + b.f) + '</text>';
      s += '<text x="' + (x + w / 2) + '" y="' + (H - B + 16) + '" class="ax" text-anchor="middle">' + esc(b.lab) + '</text>';
    });
    s += '</svg>';
    return s + '<div class="legend"><span><i class="sw a"></i>Actual</span><span><i class="sw f"></i>Forecast</span>' + (sc ? '<span><i class="sw w"></i>Low–High range</span>' : '') + '</div>';
  }

  function monthlyChart(r) {
    var m = D.meta, P = m.periods, nA = Math.min(36, P.length), a0 = P.length - nA;
    var act = r.monthly_su.slice(a0), fp = (r.forecast && r.forecast.path) || [];
    var labs = P.slice(a0).concat(m.future_periods.slice(0, fp.length));
    var all = act.concat(fp), n = all.length;
    var W = 1300, H = 260, L = 64, R = 12, T = 14, B = 30;
    var mx = Math.max.apply(null, all) * 1.1 || 1;
    var x = function (i) { return L + (W - L - R) * i / (n - 1); }, y = function (v) { return T + (H - T - B) * (1 - v / mx); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Monthly Standard Units, last 36 months and forecast">';
    for (var g = 0; g <= 4; g++) { var gv = mx * g / 4; s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(gv) + '" y2="' + y(gv) + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y(gv) + 4) + '" class="ax" text-anchor="end">' + fmtSU(gv) + '</text>'; }
    if (fp.length) s += '<rect x="' + x(nA - 1) + '" y="' + T + '" width="' + (x(n - 1) - x(nA - 1)) + '" height="' + (H - T - B) + '" class="fz"/>';
    s += '<polyline class="la" points="' + act.map(function (v, i) { return x(i) + ',' + y(v); }).join(' ') + '"/>';
    if (fp.length) s += '<polyline class="lf" points="' + [x(nA - 1) + ',' + y(act[nA - 1])].concat(fp.map(function (v, i) { return x(nA + i) + ',' + y(v); })).join(' ') + '"/>';
    all.forEach(function (v, i) { s += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="2.4" class="' + (i < nA ? 'pa' : 'pf') + '"><title>' + per(labs[i]) + (i < nA ? ' actual: ' : ' forecast: ') + fmtSU(v) + ' SU</title></circle>'; });
    labs.forEach(function (p, i) { if (p.slice(5, 7) === '01') s += '<text x="' + x(i) + '" y="' + (H - B + 16) + '" class="ax" text-anchor="middle">Jan ' + p.slice(0, 4) + '</text>'; });
    s += '</svg>';
    return s + '<div class="legend"><span><i class="sw a"></i>Actual (last 36 months)</span>' + (fp.length ? '<span><i class="sw f"></i>Forecast path to Dec ' + m.target_year + '</span>' : '') +
      (r.model_info && r.model_info.seasonal ? '<span>Seasonality: significant, applied</span>' : '<span>Seasonality: not significant / not applied</span>') + '</div>';
  }

  function trendTable(r) {
    var rows = [
      ['Historical trend' + (r.hist_cagr.span ? ' (' + r.hist_cagr.span + ', a year)' : ''), fmtP(r.hist_cagr.pct), 'CAGR, first full year after launch to last full year'],
      ['Recent trend (' + r.recent_cagr.span + ', a year)', fmtP(r.recent_cagr.pct), 'CAGR over the last two full years'],
      ['YTD ' + r.ytd.months + ' ' + D.meta.partial_year + ' vs ' + (D.meta.partial_year - 1), fmtP(r.ytd.growth_pct), fmtSU(r.ytd.cur) + ' vs ' + fmtSU(r.ytd.py) + ' SU']
    ];
    Object.keys(r.yoy_pct).forEach(function (k) { rows.push(['Year on year ' + k.replace('-', ' → '), fmtP(r.yoy_pct[k]), '']); });
    return '<table class="tbl"><tbody>' + rows.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td class="num r">' + x[1] + '</td><td class="mut">' + esc(x[2]) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  function candTable(r) {
    var order = ['NAIVE', 'A', 'B', 'C1', 'C2', 'MED', 'RUNRATE'], met = r.backtest.metrics || {};
    var rr = r.forecast_type === 'run_rate_floor';
    var h = '<table class="tbl"><thead><tr><th>Method</th><th class="r">FY' + D.meta.target_year + ' SU</th><th class="r">Growth vs LE</th><th class="r">Tests</th><th class="r">Error (WAPE)</th><th class="r">Bias</th><th class="r">vs benchmark</th><th></th></tr></thead><tbody>';
    order.forEach(function (k) {
      var c = r.candidates[k]; if (!c) return;
      var mt = met[k] || {}, sel = k === r.selected_model;
      var rel = fin(mt.rel_to_naive) && k !== 'NAIVE' ? ((1 - mt.rel_to_naive) * 100) : null;
      h += '<tr class="' + (sel ? 'sel' : '') + '"><td>' + esc(MODEL_SHORT[k] || k) + '</td><td class="num r">' + fmtSU(c.fy_target) + '</td><td class="num r">' + fmtP(c.growth_vs_le_pct) + '</td>' +
        '<td class="num r">' + (mt.n || '—') + '</td><td class="num r">' + (fin(mt.wape) ? (mt.wape * 100).toFixed(1) + '%' : '—') + '</td><td class="num r">' + fmtF(mt.bias) + '</td>' +
        '<td class="num r">' + (rel == null ? '—' : (rel >= 0 ? rel.toFixed(0) + '% better' : (-rel).toFixed(0) + '% worse')) + '</td><td>' + (sel ? '<span class="chip">Selected</span>' : '') + '</td></tr>';
    });
    h += '</tbody></table>';
    var bt = r.backtest;
    h += '<p class="note"><b>Why this method:</b> ' + esc(r.selection_rationale) + '</p>';
    h += '<p class="note mut">Tests: forecast the next 12 months from each month-end ' + (bt.origins ? '(' + esc(bt.origins.replace('..', ' to ')) + ', ' + bt.n_common + ' starting points)' : '') +
      ' using only the data available at that time, then compare with what IQVIA actually reported. WAPE = total absolute error ÷ total actual. Bias: negative = the method under-forecast. Starting points overlap, so small differences between methods are not meaningful.' +
      (rr ? ' Model results are listed for reference only: none could be validated for this market.' : '') + '</p>';
    return h;
  }

  function why(r) {
    var w = r.why || { facts: [], assumptions: [] };
    return '<div class="why"><div><h3>Calculated from the data</h3><ul>' + w.facts.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' +
      '<div><h3>Assumptions</h3><ul>' + w.assumptions.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div></div>';
  }

  function scen(r) {
    var f = r.forecast, sc = f && f.scenarios;
    if (!sc) return '<p class="note mut">' + (r.forecast_type === 'run_rate_floor' ? 'No Low/High scenarios: the run-rate floor is not a statistical forecast.' :
      'No Low/High scenarios: fewer than ' + D.meta.config.interval_min_origins + ' validated test points, so a range would not be statistically supportable.') + '</p>';
    var rows = [['Low', sc.low, sc.low_growth_pct], ['Base', sc.base, f.growth_vs_le_pct], ['High', sc.high, sc.high_growth_pct]];
    return '<div class="scn">' + rows.map(function (x) { return '<div class="sc ' + x[0].toLowerCase() + '"><div class="kl">' + x[0] + '</div><div class="kv num">' + fmtSU(x[1]) + '</div><div class="ks num">' + fmtP(x[2]) + ' vs FY' + D.meta.partial_year + ' LE</div></div>'; }).join('') + '</div>' +
      '<p class="note mut">' + esc(sc.method) + (fin(sc.median_backtest_error_pct) ? ' In past tests this method\'s typical miss was ' + fmtP(sc.median_backtest_error_pct) + ' (actual vs forecast).' : '') + '</p>';
  }

  function dq(r) {
    var fl = (r.data_quality_flags || []).filter(function (f) { return f.code !== 'RESIDUAL'; });
    var h = '';
    if (!fl.length) h += '<p class="note">No data-quality warnings for this market.</p>';
    else h += '<ul class="dql">' + fl.map(function (f) { return '<li><span class="sev ' + esc(f.sev) + '">' + esc(f.sev) + '</span> ' + esc(f.text) + '</li>'; }).join('') + '</ul>';
    if (r.outlier_sensitivity) h += '<p class="note mut">If the flagged months were replaced by their local median, the FY' + D.meta.target_year + ' forecast would change by ' + fmtP(r.outlier_sensitivity.delta_pct) + '. Shown for transparency only; the headline keeps the reported data.</p>';
    return h;
  }

  function detail() {
    var r = cur(), el = ROOT.querySelector('#mf-detail');
    if (!r) { el.innerHTML = '<section class="card"><p>No market available for your access scope at this level.</p></section>'; return; }
    el.innerHTML =
      '<section class="card head"><div class="ttl"><div><div class="eyebrow">' + esc(r.type === 'Total' ? 'Market' : (LEVELS.find(function (l) { return l[0] === r.type; }) || [0, r.type])[1]) + '</div><h2 class="mname">' + esc(r.name) + '</h2></div>' +
      '<div class="chips"><span class="chip">' + esc(r.lifecycle) + ' · ' + r.consecutive_positive_months + ' months of sales</span>' + badge(r) + '</div></div>' + banners(r) + '</section>' +
      kpis(r) +
      '<div class="g2"><section class="card"><h2>Annual Standard Units</h2>' + annualChart(r) + '</section>' +
      '<section class="card"><h2>Low / Base / High</h2>' + scen(r) + '<h2 class="mt">Growth trend</h2>' + trendTable(r) + '</section></div>' +
      '<section class="card"><h2>Monthly trend and forecast path</h2>' + monthlyChart(r) + '</section>' +
      '<section class="card"><h2>Why this forecast?</h2>' + why(r) + '</section>' +
      '<section class="card"><h2>Candidate methods and test accuracy</h2>' + candTable(r) + '</section>' +
      '<section class="card"><h2>Data quality</h2>' + dq(r) + '</section>';
  }

  function overview() {
    var list = segs(ST.level).slice().sort(function (a, b) { return size(b) - size(a); }), c = cur(), m = D.meta;
    var h = '<table class="tbl ov"><thead><tr><th>Market</th><th>Stage</th><th class="r">FY' + m.full_years[m.full_years.length - 1] + ' SU</th><th class="r">FY' + m.partial_year + ' LE</th><th class="r">FY' + m.target_year + '</th><th class="r">Growth</th><th class="r">Range</th><th>Confidence</th><th>Method</th></tr></thead><tbody>';
    list.forEach(function (r) {
      var f = r.forecast || {}, sc = f.scenarios, rr = r.forecast_type === 'run_rate_floor';
      h += '<tr data-n="' + esc(r.name) + '" class="' + (c && r.name === c.name ? 'sel' : '') + '"><td class="mk">' + esc(r.name) + (r.same_as && r.same_as.length ? ' <span class="mut" title="' + esc(r.same_as.join(', ')) + '">(=)</span>' : '') + '</td>' +
        '<td>' + esc(r.lifecycle) + '</td><td class="num r">' + fmtSU(r.history[String(m.full_years[m.full_years.length - 1])].su) + '</td><td class="num r">' + fmtSU(f.fy_le) + '</td><td class="num r">' + fmtSU(f.fy_target) + '</td>' +
        '<td class="num r">' + (rr ? '<span class="mut">floor</span>' : fmtP(f.growth_vs_le_pct)) + '</td><td class="num r mut">' + (sc ? fmtP(sc.low_growth_pct, 0) + ' / ' + fmtP(sc.high_growth_pct, 0) : '—') + '</td>' +
        '<td><span class="conf ' + confCls(r.confidence) + '">' + esc(r.confidence) + '</span></td><td class="mut">' + esc(rr ? 'Run-rate floor' : (r.selected_model || '—')) + '</td></tr>';
    });
    ROOT.querySelector('#mf-ov').innerHTML = h + '</tbody></table>';
  }

  function methodology() {
    var m = D.meta, c = m.config, g = m.global_checks || {}, bc = g.backfill_unit_check || {};
    var li = [
      'Source: IQVIA monthly Standard Units from the Market Intelligence cache (' + esc(g.periods || '') + '), with the approved ownership restatements and market overrides already applied. Market definitions are the same as on the Market Intelligence page. BU and Line markets = the DM1 markets where Zeta has products of that BU or Line.',
      'FY' + m.partial_year + ' has ' + m.partial_months + ' actual months, so it is completed with a forecast (Landing Estimate, LE). FY' + m.target_year + ' growth = FY' + m.target_year + ' forecast ÷ FY' + m.partial_year + ' LE − 1. Growth is always derived from the Standard Units forecast, never the other way round.',
      'Stage: Launch = under ' + c.launch_months + ' consecutive months of sales; Developing = ' + c.launch_months + '–' + (c.established_months - 1) + '; Established = ' + c.established_months + '+. Launch markets, and any market with fewer than ' + c.min_common_origins + ' test points, are not statistically forecastable: a run-rate floor (last ' + c.runrate_months + ' months average) is shown with Lower confidence.',
      'Methods: seasonal naive benchmark (last 12 months carried flat); A historical CAGR on moving annual totals; B recent 2-year CAGR; C1 linear trend on annual totals; C2 Holt damped trend on monthly log units, seasonally adjusted when a permutation test finds significant seasonality (p < ' + c.seasonal_p + '); MED = median of A, B, C1, C2.',
      'Selection: lowest out-of-sample WAPE; the median combination is preferred when it is within ' + Math.round(c.med_tolerance * 100) + '% of the best single method. No weights are fitted.',
      'Low/High: the spread (10th–90th percentile around the median) of the selected method\'s own past forecast errors, widened for the longer horizon, shown only with ' + c.interval_min_origins + '+ test points. Systematic bias is shown separately, not hidden in the range.',
      'Confidence: Higher = Established, ' + c.higher.min_origins + '+ test points, WAPE ≤ ' + (c.higher.wape * 100) + '%, |bias| ≤ ' + (c.higher.bias * 100) + '%, methods within ' + c.higher.spread_pts + ' pts, no high-severity data flag. Moderate = WAPE ≤ ' + (c.moderate.wape * 100) + '%, |bias| ≤ ' + (c.moderate.bias * 100) + '%. Otherwise Lower.',
      'Abnormal months: a month above ' + c.outlier_hi + '× or below ' + c.outlier_lo + '× the median of the 3 months on either side is flagged, never removed. Zero months after first sale are shown as gaps, not treated as missing data.',
      'Data checks this build: ' + (g.negative_su_rows === 0 ? 'no negative units' : g.negative_su_rows + ' negative-unit rows') + '; ' + (g.exact_duplicate_rows || 0) + ' exact duplicate rows (' + ((g.exact_duplicate_su_share || 0) * 100).toFixed(4) + '% of units, kept as in the dashboard); backfilled ATC4 history (' + ((bc.share_of_egypt_su_last12 || 0) * 100).toFixed(1) + '% of units): ' + esc(bc.verdict || 'n/a') + '.',
      'Not modelled: launches, withdrawals, shortages, price changes, tenders, and IQVIA panel or mapping revisions after the data period. No market drivers are assumed. IQVIA can restate history; every refresh re-runs the tests.'
    ];
    ROOT.querySelector('#mf-methodbody').innerHTML = '<ol class="ml">' + li.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ol>';
  }

  function render() { fillSelect(); detail(); overview(); }

  function wire() {
    ROOT.querySelector('#mf-lvl').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      ST.level = b.dataset.v;
      ROOT.querySelectorAll('#mf-lvl button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
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
      var sv = loadState(); if (sv && sv.level) { ST.level = sv.level; ST.seg = sv.seg || {}; }
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
