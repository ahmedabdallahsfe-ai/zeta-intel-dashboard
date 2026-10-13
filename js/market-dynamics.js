/* market-dynamics.js — Market Dynamics & Treatment Shift (IQVIA Standard Units). Added 2026-10-13 (Ahmed, Phase 2).
   Data: window.MARKET_DYNAMICS_CACHE (cache/market_dynamics.data.js, built by `etl/build_market_dynamics.py --cache`
   from cache/iqvia.json + cache/market_forecast.data.js + config/market_dynamics_map.json).
   Opened from the sidebar (app.js renderMarketDynamicsTab), SFE / BEX roles only (auth.js canViewMarketDynamics).
   Every number on this page is computed in the ETL; this file only displays it. Ids prefixed "md-", CSS scoped to .mdx. */
(function (global) {
  'use strict';

  function decode() {
    var c = global.MARKET_DYNAMICS_CACHE;
    if (!c || !c.b64Data || typeof pako === 'undefined') return null;
    var bin = atob(c.b64Data), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(pako.ungzip(bytes, { to: 'string' }));
  }

  var D = null, HOST = null, ROOT = null, TIP = null;
  var ST = { ind: null, level: 'classes', sort: 'su' };
  var KEY = 'zeta_md_state';
  var Y = ['2021', '2022', '2023', '2024', '2025'];
  var QUADS = ['Volume Anchor', 'Growth Engine', 'Mature / Plateauing', 'Niche / Stable', 'Contracting / At-Risk'];
  var QCLS = { 'Volume Anchor': 'qa', 'Growth Engine': 'qe', 'Mature / Plateauing': 'qm', 'Niche / Stable': 'qn', 'Contracting / At-Risk': 'qc' };
  var FCLS = { 'Class Substitution': 'fs', 'Segment Deepening': 'fd', 'Mixed': 'fx', 'No next-gen gain': 'fn', 'Legacy Decline (not replaced)': 'fl' };
  var BCLS = { 'Expanding Market': 'be', 'Structural Substitution Underway': 'bs', 'Mature / Replacement Demand': 'bm', 'Contracting Market': 'bc' };

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
  function fmtD(v) { return fin(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + fmtSU(Math.abs(v)) : '—'; }
  function fmtP(p, d) { if (!fin(p)) return '—'; return (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(d == null ? 1 : d) + '%'; }
  function fmtS(p) { return fin(p) ? p.toFixed(p < 10 ? 1 : 0) + '%' : '—'; }
  function fmtPts(p) { return fin(p) ? (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(1) + ' pts' : '—'; }
  function yoy(o, y) {                                        // growth cell honouring the ETL labels
    var v = o.yoy && o.yoy[y], l = o.yoy_label && o.yoy_label[y];
    if (fin(v)) return '<span class="num' + (v < 0 ? ' neg' : '') + '" title="' + esc(l || '') + '">' + fmtP(v) + (l ? '<sup>' + (l === 'Low base' ? 'LB' : '†') + '</sup>' : '') + '</span>';
    return '<span class="mut">' + esc(l || '—') + '</span>';
  }
  function chip(map, v, cls) { return v ? '<span class="' + (cls || 'qchip') + ' ' + (map[v] || '') + '">' + esc(v) + '</span>' : '<span class="mut">—</span>'; }
  function ytdLabel() { var y = D.indications[0].ytd; return y.months + ' ' + y.year; }
  function inds() { return D.indications.slice().sort(function (a, b) { return (b.su['2025'] || 0) - (a.su['2025'] || 0); }); }
  function ind() { return D.indications.find(function (i) { return i.id === ST.ind; }) || inds()[0]; }
  function members(i) {
    if (ST.level === 'classes') return D.classes.filter(function (c) { return c.indication === i.id; });
    var t = ST.level === 'dm1' ? 'DM1' : 'DM2';
    return D.markets.filter(function (m) { return m.indication === i.id && m.type === t; });
  }
  function spark(arr, w, h) {
    var v = arr.filter(fin); if (v.length < 2) return '';
    var mx = Math.max.apply(null, v), mn = Math.min(0, Math.min.apply(null, v)), n = arr.length;
    var pts = arr.map(function (a, k) { return fin(a) ? (k * (w - 4) / (n - 1) + 2).toFixed(1) + ',' + (h - 2 - (a - mn) / ((mx - mn) || 1) * (h - 4)).toFixed(1) : null; }).filter(Boolean);
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><polyline points="' + pts.join(' ') + '"/></svg>';
  }

  // ---------------------------------------------------------------- shell
  function shell() {
    var m = D.meta, opts = inds().map(function (i) { return '<option value="' + esc(i.id) + '">' + esc(i.name) + '</option>'; }).join('');
    return '<div class="wrap">' +
      '<header class="top"><div><h1>Market Dynamics &amp; Treatment Shift</h1>' +
      '<div class="sub">How each therapeutic indication is growing in IQVIA Standard Units, where every class and market sits within it, ' +
      'and whether newer therapies are replacing older ones or adding new volume. FY2027 figures come unchanged from the Market Growth Forecast.</div></div>' +
      '<div class="mut small">Actuals to <b>' + esc(m.data_period) + '</b> · built ' + esc(m.generated_at) + '</div></header>' +
      '<section class="card"><div class="h2row"><h2>All indications</h2><span class="mut small">Click a row to open it below. Sorted by 2025 volume. SU = Standard Units.</span></div>' +
      '<div class="tblwrap"><table class="tbl ov" id="md-ov"></table></div>' +
      '<div class="note mut">Scope: the IQVIA extract holds 59 classes, not the whole Egypt market. An indication total is the sum of its classes in the extract.</div></section>' +
      '<section class="card controls">' +
      '<div class="ctl grow"><label for="md-ind">Indication</label><select id="md-ind">' + opts + '</select></div>' +
      '<div class="ctl"><label>Compare</label><div class="seg" id="md-lvl">' +
      [['classes', 'Classes'], ['dm1', 'Our DM1 markets'], ['dm2', 'Our DM2 markets']].map(function (l) {
        return '<button type="button" data-v="' + l[0] + '">' + l[1] + '</button>';
      }).join('') + '</div></div></section>' +
      '<div id="md-detail"></div>' +
      '<details class="card method" id="md-method"><summary><h2>Methodology &amp; data checks</h2></summary><div id="md-method-body"></div></details>' +
      '</div>';
  }

  function overview() {
    var yl = ytdLabel();
    var h = '<thead><tr><th>Indication</th><th class="r">SU 2025</th><th class="r">ΔSU 2025</th><th class="r">YoY 2025</th><th class="r">YoY 2024</th>' +
      '<th class="r">Acceleration</th><th class="r">YTD ' + esc(yl) + '</th><th class="r">Zeta share 2025</th><th>Trend 2021–25</th><th>Outlook (provisional)</th></tr></thead><tbody>';
    inds().forEach(function (i) {
      h += '<tr data-id="' + esc(i.id) + '"' + (i.id === ST.ind ? ' class="sel"' : '') + '><td>' + esc(i.name) + '</td>' +
        '<td class="r num">' + fmtSU(i.su['2025']) + '</td><td class="r num">' + fmtD(i.delta['2025']) + '</td>' +
        '<td class="r">' + yoy(i, '2025') + '</td><td class="r">' + yoy(i, '2024') + '</td>' +
        '<td class="r num' + (i.accel < 0 ? ' neg' : '') + '">' + fmtPts(i.accel) + '</td>' +
        '<td class="r num' + (i.ytd.growth < 0 ? ' neg' : '') + '">' + (fin(i.ytd.growth) ? fmtP(i.ytd.growth) : esc(i.ytd.label || '—')) + '</td>' +
        '<td class="r num">' + fmtS(i.zeta_share2025) + '</td>' +
        '<td>' + spark(Y.map(function (y) { return i.su[y]; }), 72, 20) + '</td>' +
        '<td>' + chip(BCLS, i.outlook_badge, 'badge') + '</td></tr>';
    });
    ROOT.querySelector('#md-ov').innerHTML = h + '</tbody>';
  }

  // ---------------------------------------------------------------- detail
  function detail() {
    var i = ind(), pairs = D.pairs.filter(function (p) { return p.indication === i.id; });
    ROOT.querySelector('#md-ind').value = i.id;
    ROOT.querySelectorAll('#md-lvl button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === ST.level ? 'true' : 'false'); });
    var mem = members(i);
    var h = cards(i, pairs) +
      '<section class="card"><div class="h2row"><h2>A · Growth &amp; metric grid — ' + esc(levelName()) + ' in ' + esc(i.name) + '</h2>' +
      '<span class="mut small">Ranked within the indication. ● = Zeta sells here. † = special base (hover). Click a column title to sort.</span></div>' +
      grid(i, mem) + '</section>' +
      '<div class="g2"><section class="card"><h2>B · Portfolio matrix</h2>' + matrix(i, mem) + '</section>' +
      '<section class="card"><h2>C · Treatment shift</h2>' + (pairs.length ? pairs.map(shift).join('') :
        '<p class="mut">No legacy → next-gen pair is defined for this indication. Pairs are set in <code>config/market_dynamics_map.json</code>.</p>') + '</section></div>' +
      outlook(i, pairs);
    ROOT.querySelector('#md-detail').innerHTML = h;
    ROOT.querySelectorAll('#md-ov tr[data-id]').forEach(function (tr) { tr.classList.toggle('sel', tr.getAttribute('data-id') === i.id); });
  }
  function levelName() { return ST.level === 'classes' ? 'classes' : ST.level === 'dm1' ? 'our DM1 markets' : 'our DM2 markets'; }

  function cards(i, pairs) {
    var p = pairs[0], last = p ? p.rows.filter(function (r) { return r.flag; }).slice(-2) : [];
    var share = last.length ? last[last.length - 1].next_share_ind : null, prevShare = last.length > 1 ? last[0].next_share_ind : null;
    function card(l, v, s, extra) { return '<div class="kpi"><div class="kl">' + l + '</div><div class="kv num">' + v + '</div><div class="ks">' + s + '</div>' + (extra || '') + '</div>'; }
    return '<div class="kpis">' +
      card('Indication SU 2025', fmtSU(i.su['2025']), fmtP(i.yoy['2025']) + ' · ' + fmtD(i.delta['2025']) + ' SU vs 2024') +
      card('Acceleration', fmtPts(i.accel), 'YoY ' + fmtP(i.yoy['2024']) + ' → ' + fmtP(i.yoy['2025'])) +
      card('YTD ' + esc(ytdLabel()), fin(i.ytd.growth) ? fmtP(i.ytd.growth) : '—', fmtSU(i.ytd.cur) + ' vs ' + fmtSU(i.ytd.py) + ' SU') +
      (p ? card('Next-gen share (' + esc(p.name.split('→')[1] || '').trim() + ')', fmtS(share),
        'of the indication · ' + esc(last[last.length - 1].period) + (fin(prevShare) ? ' (was ' + fmtS(prevShare) + ')' : ''))
         : card('Zeta share 2025', fmtS(i.zeta_share2025), fmtSU(i.zeta_su2025) + ' SU of the indication')) +
      '<div class="kpi"><div class="kl">Outlook (provisional)</div><div class="kv">' + chip(BCLS, i.outlook_badge, 'badge big') + '</div>' +
      '<div class="ks">' + (p ? 'Latest shift: ' + esc(p.latest_flag || '—') : 'From 2025 and YTD growth') + '</div></div></div>';
  }

  function grid(i, mem) {
    var keyf = { su: function (o) { return o.su['2025'] || 0; }, yoy: function (o) { return fin(o.yoy['2025']) ? o.yoy['2025'] : -1e9; },
      accel: function (o) { return fin(o.accel) ? o.accel : -1e9; }, share: function (o) { return o.share2025 || 0; }, cagr: function (o) { return fin(o.cagr) ? o.cagr : -1e9; } }[ST.sort] || function (o) { return o.su['2025'] || 0; };
    var rows = mem.slice().sort(function (a, b) { return keyf(b) - keyf(a); });
    var isCls = ST.level === 'classes';
    function th(k, t, r) { return '<th' + (r ? ' class="r"' : '') + (k ? ' data-sort="' + k + '"' + (ST.sort === k ? ' aria-sort="descending"' : '') : '') + '>' + t + (ST.sort === k ? ' ▾' : '') + '</th>'; }
    var h = '<div class="tblwrap"><table class="tbl" id="md-grid"><thead><tr>' + th(null, isCls ? 'Class' : 'Market') +
      Y.map(function (y) { return th(y === '2025' ? 'su' : null, 'SU ' + y, 1); }).join('') +
      th(null, 'ΔSU 2025', 1) + th('yoy', 'YoY 2025', 1) + th(null, 'YoY 2024', 1) + th('accel', 'Accel.', 1) +
      th(null, 'YTD ' + esc(ytdLabel()), 1) + th('cagr', 'CAGR', 1) + th('share', 'Share 2025', 1) + th(null, 'Rank vol / growth', 1) + th(null, 'Quadrant') +
      (isCls ? '' : th(null, 'FY2027 (champion)', 1)) + '</tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="16" class="mut">None of our ' + esc(levelName()) + ' sit in this indication. Switch to Classes.</td></tr>';
    rows.forEach(function (o) {
      var zeta = isCls ? o.zeta_active : true, f = o.forecast;
      var nm = isCls ? esc(o.name) + (zeta ? ' <span class="dot" title="Zeta sells in this class">●</span>' : '') +
        '<div class="mut tiny">' + esc((o.atc4 || []).map(function (a) { return a.split(' ')[0]; }).join(', ')) + (o.rule && o.rule.molecules ? ' · molecule rule' : '') + (o.rule && o.rule.components ? ' · ' + o.rule.components + '-molecule combos' : '') + '</div>'
        : esc(o.name) + '<div class="mut tiny">' + esc(o.class_relation) + '</div>';
      h += '<tr' + (isCls ? '' : ' class="link" data-mk="' + esc(o.type + '|' + o.name) + '"') + '><td class="mk">' + nm + '</td>' +
        Y.map(function (y) { return '<td class="r num' + ((o.incomplete_years || []).indexOf(+y) >= 0 ? ' inc" title="Incomplete year in the IQVIA extract (coverage starts mid-2021)' : '') + '">' + fmtSU(o.su[y]) + '</td>'; }).join('') +
        '<td class="r num">' + fmtD(o.delta['2025']) + '</td><td class="r">' + yoy(o, '2025') + '</td><td class="r">' + yoy(o, '2024') + '</td>' +
        '<td class="r num' + (o.accel < 0 ? ' neg' : '') + '">' + fmtPts(o.accel) + '</td>' +
        '<td class="r num' + (o.ytd.growth < 0 ? ' neg' : '') + '">' + (fin(o.ytd.growth) ? fmtP(o.ytd.growth) : esc(o.ytd.label || '—')) + '</td>' +
        '<td class="r num" title="' + esc(o.window ? 'CAGR ' + o.window : 'Not enough complete years') + '">' + (fin(o.cagr) ? fmtP(o.cagr) + '<div class="mut tiny">' + esc(o.window) + '</div>' : '—') + '</td>' +
        '<td class="r num">' + fmtS(o.share2025) + '<div class="mut tiny">fair ' + fmtS(o.fair_share) + '</div></td>' +
        '<td class="r num">' + (o.rank_volume || '—') + ' / ' + (o.rank_growth || '—') + '</td><td>' + chip(QCLS, o.quadrant) + '</td>' +
        (isCls ? '' : '<td class="r num">' + (f ? fmtSU(f.fy27) + '<div class="tiny ' + (f.growth < 0 ? 'neg' : 'mut') + '">' + fmtP(f.growth) + ' · ' + esc(f.confidence || '') + '</div>' : '—') + '</td>') + '</tr>';
    });
    h += '<tr class="tot"><td>Indication total</td>' + Y.map(function (y) { return '<td class="r num">' + fmtSU(i.su[y]) + '</td>'; }).join('') +
      '<td class="r num">' + fmtD(i.delta['2025']) + '</td><td class="r">' + yoy(i, '2025') + '</td><td class="r">' + yoy(i, '2024') + '</td>' +
      '<td class="r num">' + fmtPts(i.accel) + '</td><td class="r num">' + fmtP(i.ytd.growth) + '</td><td class="r num">' + (fin(i.cagr) ? fmtP(i.cagr) : '—') + '</td>' +
      '<td class="r num">100%</td><td></td><td></td>' + (isCls ? '' : '<td></td>') + '</tr>';
    return h + '</tbody></table></div>' + (isCls ? '' : '<div class="note mut">Click a market to open it on the Market Growth Forecast tab. Markets do not add up to the indication: the rest of the indication is other companies\' or non-defined volume.</div>');
  }

  // B: x = share of indication (sqrt scale), y = YoY 2025 (clipped), size = SU 2025, colour = quadrant
  function matrix(i, mem) {
    var pts = mem.filter(function (o) { return fin(o.share2025) && o.su['2025'] > 0; });
    if (!pts.length) return '<p class="mut">Nothing to plot for this selection.</p>';
    var W = 560, H = 380, L = 52, R = 16, T = 20, B = 44, pw = W - L - R, ph = H - T - B;
    var ys = pts.map(function (o) { return fin(o.yoy['2025']) ? o.yoy['2025'] : 0; });
    var ymin = Math.min(-10, Math.floor(Math.min.apply(null, ys) / 10) * 10), ymax = Math.max(30, Math.ceil(Math.min(150, Math.max.apply(null, ys)) / 10) * 10);
    ymin = Math.max(ymin, -60);
    var X = function (s) { return L + Math.sqrt(Math.max(0, s) / 100) * pw; };
    var Yp = function (v) { return T + (ymax - Math.max(ymin, Math.min(ymax, v))) / (ymax - ymin) * ph; };
    var smax = Math.max.apply(null, pts.map(function (o) { return o.su['2025']; }));
    var rad = function (su) { return 4 + 10 * Math.sqrt(su / smax); };
    var fair = pts[0].fair_share;
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Portfolio matrix: share of indication against 2025 growth">';
    var ticks = []; for (var t = Math.ceil(ymin / 20) * 20; t <= ymax; t += 20) ticks.push(t);
    ticks.forEach(function (t) { s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Yp(t) + '" y2="' + Yp(t) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (Yp(t) + 3.5) + '" text-anchor="end">' + t + '%</text>'; });
    [1, 5, 10, 25, 50, 100].forEach(function (x) { s += '<text class="ax" x="' + X(x) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + x + '%</text>'; });
    s += '<line class="zero" x1="' + L + '" x2="' + (W - R) + '" y1="' + Yp(0) + '" y2="' + Yp(0) + '"/>';
    var th = D.meta.thresholds;
    s += '<line class="ref" x1="' + X(fair) + '" x2="' + X(fair) + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="ax" x="' + (X(fair) + 4) + '" y="' + (T + 10) + '">fair share ' + fmtS(fair) + '</text>';
    s += '<line class="ref" x1="' + L + '" x2="' + X(fair) + '" y1="' + Yp(th.engine_min_yoy_pct) + '" y2="' + Yp(th.engine_min_yoy_pct) + '"/>';
    s += '<line class="ref" x1="' + X(fair) + '" x2="' + (W - R) + '" y1="' + Yp(th.anchor_min_yoy_pct) + '" y2="' + Yp(th.anchor_min_yoy_pct) + '"/>';
    s += '<text class="qz" x="' + (L + 6) + '" y="' + (T + 24) + '">Growth Engines</text><text class="qz" x="' + (W - R - 6) + '" y="' + (T + 24) + '" text-anchor="end">Volume Anchors</text>' +
      '<text class="qz" x="' + (L + 6) + '" y="' + (H - B - 8) + '">Niche / Stable</text><text class="qz" x="' + (W - R - 6) + '" y="' + (H - B - 8) + '" text-anchor="end">Mature / Plateauing</text>';
    s += '<text class="ax" x="' + (L + pw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Share of the indication, SU 2025 (square-root scale)</text>' +
      '<text class="ax" transform="rotate(-90 14 ' + (T + ph / 2) + ')" x="14" y="' + (T + ph / 2) + '" text-anchor="middle">YoY growth 2025</text>';
    var order = pts.slice().sort(function (a, b) { return b.su['2025'] - a.su['2025']; });
    var labelled = order.slice(0, 8).map(function (o) { return o.id; });
    order.forEach(function (o) {
      var v = fin(o.yoy['2025']) ? o.yoy['2025'] : 0, cx = X(o.share2025), cy = Yp(v), clipped = v > ymax || v < ymin;
      var tip = esc(o.name) + '|Share ' + fmtS(o.share2025) + ' · SU 2025 ' + fmtSU(o.su['2025']) + '|YoY 2025 ' + (fin(o.yoy['2025']) ? fmtP(o.yoy['2025']) : (o.yoy_label['2025'] || '—')) + ' · accel. ' + fmtPts(o.accel) + '|' + o.quadrant;
      s += '<circle class="pt ' + (QCLS[o.quadrant] || '') + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + rad(o.su['2025']).toFixed(1) + '" data-tip="' + tip + '"/>';
      if (clipped) s += '<text class="ax" x="' + cx + '" y="' + (cy + (v > ymax ? -14 : 22)) + '" text-anchor="middle">' + (v > ymax ? '▲ ' : '▼ ') + fmtP(v, 0) + '</text>';
      if (labelled.indexOf(o.id) >= 0) s += '<text class="lbl" x="' + (cx + rad(o.su['2025']) + 4).toFixed(1) + '" y="' + (cy + 4).toFixed(1) + '">' + esc(short(o.name)) + '</text>';
    });
    s += '</svg>';
    var lg = '<div class="legend">' + QUADS.map(function (q) { return '<span><i class="sw ' + QCLS[q] + '"></i>' + esc(q) + '</span>'; }).join('') + '<span class="mut">Dot size = SU 2025 · hover for detail</span></div>';
    return s + lg;
  }
  function short(n) { n = String(n).replace(/\s*\(.*?\)\s*/g, ' ').trim(); return n.length > 26 ? n.slice(0, 25) + '…' : n; }

  // C: per period, Δ legacy / Δ next-gen / Δ indication on one zero axis + flag
  function shift(p) {
    var rows = p.rows.filter(function (r) { return r.flag; });
    var all = [0];
    rows.forEach(function (r) { all.push(r.legacy_delta, r.next_delta, r.ind_delta); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    var W = 560, L = 132, R = 150, LAB = 54, rowH = 50, T = 26, H = T + rows.length * rowH + 8;
    var padL = lo < 0 ? LAB : 0, pw = W - L - R - LAB - padL;                    // room for value labels on both sides
    var span = (hi - lo) || 1, x0 = L + padL + (-lo / span) * pw;
    var X = function (v) { return x0 + v / span * pw; };
    var s = '<div class="pairhd"><b>' + esc(p.name) + '</b>' + (p.gap ? '<span class="mut small"> · ' + esc(p.gap) + '</span>' : '') + '</div>' +
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(p.name) + ': change in SU per period">';
    s += '<text class="ax" x="' + x0 + '" y="14" text-anchor="middle">ΔSU vs previous period (0 = no change)</text>';
    s += '<line class="zero" x1="' + x0 + '" x2="' + x0 + '" y1="' + (T - 6) + '" y2="' + (H - 4) + '"/>';
    rows.forEach(function (r, k) {
      var y = T + k * rowH;
      s += '<text class="lbl" x="0" y="' + (y + 24) + '">' + esc(r.period.replace(' vs ', ' vs ')) + '</text>';
      [['legacy_delta', 'bl', 'Legacy'], ['next_delta', 'bn', 'Next-gen'], ['ind_delta', 'bi', 'Indication']].forEach(function (b, j) {
        var v = r[b[0]], a = X(Math.min(0, v)), w = Math.max(1, Math.abs(X(v) - x0)), by = y + 4 + j * 13;
        s += '<rect class="' + b[1] + '" x="' + a.toFixed(1) + '" y="' + by + '" width="' + w.toFixed(1) + '" height="10" rx="2" data-tip="' + esc(r.period) + '|' + b[2] + ' ' + fmtD(v) + ' SU' +
          (b[0] === 'legacy_delta' ? ' (' + fmtP(r.legacy_growth) + ')' : b[0] === 'next_delta' ? ' (' + (fin(r.next_growth) ? fmtP(r.next_growth) : 'new') + ')' : ' (' + fmtP(r.ind_growth) + ')') + '"/>';
        s += '<text class="val" x="' + (v >= 0 ? X(v) + 4 : X(v) - 4).toFixed(1) + '" y="' + (by + 9) + '"' + (v < 0 ? ' text-anchor="end"' : '') + '>' + fmtD(v) + '</text>';
      });
      s += '<foreignObject x="' + (W - R + 8) + '" y="' + (y + 2) + '" width="' + (R - 8) + '" height="44"><div xmlns="http://www.w3.org/1999/xhtml" class="fo">' +
        chip(FCLS, r.flag, 'flag') + '<div class="tiny mut">next-gen ' + fmtS(r.next_share_ind) + ' of indication' + (fin(r.substitution_ratio) && r.substitution_ratio > 0 ? ' · ratio ' + Math.round(r.substitution_ratio) + '%' : '') + '</div></div></foreignObject>';
    });
    s += '</svg><div class="legend"><span><i class="sw bl"></i>Legacy (' + esc(p.legacy.join(' + ')) + ')</span><span><i class="sw bn"></i>Next-gen (' + esc(p.next_gen.join(' + ')) + ')</span><span><i class="sw bi"></i>Indication net</span></div>';
    var last = rows[rows.length - 1];
    if (last) s += '<p class="note">' + explain(p, last) + '</p>';
    return '<div class="pair">' + s + '</div>';
  }
  function explain(p, r) {
    var nx = p.name.split('→')[1] ? p.name.split('→')[1].trim() : 'next-gen', lg = p.name.split('→')[0].trim();
    var base = '<b>' + esc(r.period) + ':</b> ' + esc(nx) + ' ' + fmtD(r.next_delta) + ' SU, ' + esc(lg) + ' ' + fmtD(r.legacy_delta) + ' SU, indication ' + fmtD(r.ind_delta) + ' SU. ';
    var t = {
      'Segment Deepening': 'The older therapy is still growing, so the newer one is adding treated volume rather than taking it.',
      'Class Substitution': 'The older therapy is losing volume and that loss explains at least half of the newer therapy\'s gain: patients are switching.',
      'Legacy Decline (not replaced)': 'The older therapy lost more than twice what the newer one gained: most of that volume left the market rather than switching.',
      'Mixed': 'The older therapy is slowing or falling, but only part of the newer therapy\'s gain can be explained by it.',
      'No next-gen gain': 'The newer therapy did not grow in this period.' }[r.flag] || '';
    return base + t;
  }

  // D: FY2027 outlook from the champion forecast (DM1 + DM2 in this indication)
  function outlook(i, pairs) {
    var mk = D.markets.filter(function (m) { return m.indication === i.id && m.forecast; })
      .sort(function (a, b) { return a.type === b.type ? (b.forecast.le || 0) - (a.forecast.le || 0) : (a.type < b.type ? -1 : 1); });
    var h = '<section class="card"><div class="h2row"><h2>D · FY2027 outlook — champion forecast (same figures as the Market Growth Forecast tab)</h2>' +
      chip(BCLS, i.outlook_badge, 'badge') + '</div>';
    if (!mk.length) return h + '<p class="mut">None of our markets sit in this indication, so there is no champion forecast to show yet. The indication-level FY2027 forecast is added in Phase 3.</p></section>';
    h += '<div class="tblwrap"><table class="tbl"><thead><tr><th>Type</th><th>Market</th><th>Relation to classes</th><th class="r">2026 LE</th><th class="r">FY2027</th>' +
      '<th class="r">Growth</th><th class="r">Range</th><th>Confidence</th><th>Method</th><th class="r">Share of indication 2025</th></tr></thead><tbody>';
    mk.forEach(function (m) {
      var f = m.forecast;
      h += '<tr class="link" data-mk="' + esc(m.type + '|' + m.name) + '"><td>' + m.type + '</td><td>' + esc(m.name) + '</td><td class="mut small">' + esc(m.class_relation) + '</td>' +
        '<td class="r num">' + fmtSU(f.le) + '</td><td class="r num">' + fmtSU(f.fy27) + '</td><td class="r num' + (f.growth < 0 ? ' neg' : '') + '">' + fmtP(f.growth) + '</td>' +
        '<td class="r num">' + fmtP(f.low_pct, 0) + ' to ' + fmtP(f.high_pct, 0) + '</td><td>' + esc(f.confidence || '—') + (f.engine === 'safeguard' ? ' <span class="qchip qm">safeguard</span>' : '') + '</td>' +
        '<td class="small">' + esc(f.method || '—') + '</td><td class="r num">' + fmtS(m.share2025) + '</td></tr>';
    });
    h += '</tbody></table></div><div class="note mut">The badge is provisional (2025 and YTD growth plus the treatment-shift flag). ' +
      'Indication totals for 2026 LE / FY2027 and class-share evolution to FY2027 join in Phase 3, when indications and classes get their own champion forecast. Click a row to open it on the forecast tab.</div></section>';
    return h;
  }

  function methodology() {
    var m = D.meta, th = m.thresholds, gaps = Object.keys(m.coverage_gaps || {}).map(function (a) { return a.split(' ')[0]; }).join(', ');
    var ck = (D.checks || []).map(function (c) { return '<li><span class="sev ' + (c[3] ? 'ok' : 'bad') + '">' + (c[3] ? 'PASS' : 'CHECK') + '</span> ' + esc(c[0]) + ': ' + esc(c[1]) + ' ' + esc(c[2]) + '</li>'; }).join('');
    ROOT.querySelector('#md-method-body').innerHTML = '<ol class="ml">' +
      '<li><b>Measure.</b> IQVIA Standard Units only. Volumes are summed first; an indication\'s growth is never an average of its classes\' growth rates.</li>' +
      '<li><b>Growth.</b> YoY % = SU year ÷ SU previous year − 1. ΔSU = SU year − SU previous year. Acceleration = YoY 2025 − YoY 2024, in percentage points. ' +
      '"New" = no sales the year before; "Low base" (LB) = growth above +' + (m.growth_rules.low_base_growth_pct || 1000).toLocaleString() + '% (same rule as Market Intelligence); † = growth against a partial launch year.</li>' +
      '<li><b>Incomplete years.</b> These ATC4s are first reported mid-2021 in the extract, so their 2021 is shown greyed and never used as a growth base: ' + esc(gaps || 'none') + '.</li>' +
      '<li><b>Ranks.</b> Within the indication; growth rank only for items with at least ' + m.growth_rules.min_share_pct + '% share and a valid, non-low-base growth.</li>' +
      '<li><b>Quadrants</b> (first match wins): Contracting / At-Risk = YoY below 0 two years running, or 2025 and YTD both below 0 → at or above fair share: Volume Anchor if YoY ≥ ' + th.anchor_min_yoy_pct + '% and acceleration ≥ ' + th.anchor_min_accel_pts + ' pts, otherwise Mature / Plateauing → below fair share: Growth Engine if YoY ≥ ' + th.engine_min_yoy_pct + '% or acceleration ≥ +' + th.engine_min_accel_pts + ' pts, otherwise Niche / Stable. ' +
      'Fair share for classes = 1 ÷ number of classes in the indication; for markets = 1 ÷ number of our markets in the indication, plus the rest of the indication as one more competitor.</li>' +
      '<li><b>Treatment shift.</b> Substitution ratio = share of the next-gen SU gain that legacy SU losses can explain (capped at 100%). Flags, first match wins: Legacy Decline (not replaced) = legacy lost more than ' + (th.legacy_decline_multiple || 2) + '× the next-gen gain; Class Substitution = legacy falling and ratio ≥ ' + th.substitution_min_ratio_pct + '%; Segment Deepening = legacy stable or growing and its shortfall versus its own trend explains less than ' + th.substitution_min_ratio_pct + '% of the gain; otherwise Mixed.</li>' +
      '<li><b>FY2027.</b> Read unchanged from the champion forecast (built ' + esc(m.forecast_generated_at || '—') + '). Business rules: <code>config/market_dynamics_map.json</code> (version ' + esc(m.map_version) + ').</li>' +
      '</ol><h3>Data checks at build time</h3><ul class="dql">' + ck + '</ul>';
  }

  // ---------------------------------------------------------------- events
  function openForecast(key) {
    var p = key.split('|'), lv = p[0], nm = p.slice(1).join('|');
    try {
      var s = JSON.parse(sessionStorage.getItem('zeta_mf_state') || '{}');
      s.level = lv; s.seg = s.seg || {}; s.seg[lv] = nm;
      sessionStorage.setItem('zeta_mf_state', JSON.stringify(s));
    } catch (e) { }
    var mi = document.querySelector('[data-tab="marketforecast"]');
    if (mi) mi.click();
  }
  function wire() {
    ROOT.querySelector('#md-ind').addEventListener('change', function (e) { ST.ind = e.target.value; detail(); });
    ROOT.querySelector('#md-lvl').addEventListener('click', function (e) { var b = e.target.closest('button[data-v]'); if (!b) return; ST.level = b.getAttribute('data-v'); detail(); });
    ROOT.querySelector('#md-ov').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-id]'); if (!tr) return; ST.ind = tr.getAttribute('data-id'); detail();
      var d = ROOT.querySelector('.controls'); if (d && d.scrollIntoView) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    ROOT.querySelector('#md-detail').addEventListener('click', function (e) {
      var th = e.target.closest('th[data-sort]'); if (th) { ST.sort = th.getAttribute('data-sort'); detail(); return; }
      var tr = e.target.closest('tr[data-mk]'); if (tr) openForecast(tr.getAttribute('data-mk'));
    });
    ROOT.addEventListener('mouseover', function (e) {
      var t = e.target.closest('[data-tip]'); if (!t) { TIP.style.display = 'none'; return; }
      var parts = t.getAttribute('data-tip').split('|');
      TIP.innerHTML = '<b>' + esc(parts[0]) + '</b>' + parts.slice(1).map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('');
      TIP.style.display = 'block';
    });
    ROOT.addEventListener('mousemove', function (e) {
      if (TIP.style.display !== 'block') return;
      var x = e.clientX + 14, y = e.clientY + 14, w = TIP.offsetWidth, h = TIP.offsetHeight;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14; if (y + h > innerHeight - 8) y = e.clientY - h - 14;
      TIP.style.left = x + 'px'; TIP.style.top = y + 'px';
    });
    ROOT.addEventListener('mouseleave', function () { TIP.style.display = 'none'; });
  }

  function loadState() { try { var s = sessionStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function saveState() { try { sessionStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) { } }

  function init(containerId) {
    var c = document.getElementById(containerId); if (!c) return;
    document.body.classList.add('mdx-mode');
    c.innerHTML = '<div class="mdx" id="mdx-host"></div>'; HOST = ROOT = document.getElementById('mdx-host');
    try {
      D = D || decode();
      if (!D) { ROOT.innerHTML = '<div style="padding:24px">Market dynamics data not loaded (cache/market_dynamics.data.js). Run UPDATE_DASHBOARD.bat or <code>python etl/build_market_dynamics.py --cache</code>.</div>'; return; }
      var sv = loadState(); if (sv) { ST.ind = sv.ind || null; ST.level = sv.level || 'classes'; ST.sort = sv.sort || 'su'; }
      if (!ST.ind || !D.indications.some(function (i) { return i.id === ST.ind; })) ST.ind = inds()[0].id;
      ROOT.innerHTML = shell();
      TIP = document.createElement('div'); TIP.className = 'mdx-tip'; ROOT.appendChild(TIP);
      wire(); methodology(); overview(); detail();
    } catch (e) {
      console.error('[MarketDynamics]', e);
      ROOT.innerHTML = '<div style="padding:24px">Market Dynamics could not render: ' + esc(e && e.message || e) + '</div>';
    }
  }
  function destroy() { saveState(); document.body.classList.remove('mdx-mode'); if (HOST) { HOST.innerHTML = ''; HOST = ROOT = TIP = null; } }

  global.addEventListener('beforeunload', saveState);
  global.MarketDynamicsDashboard = { init: init, destroy: destroy };
})(window);
