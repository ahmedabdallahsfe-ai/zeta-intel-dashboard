/*
 * js/bu-review.js -- "BU Business Review" tab (2026-09-26, Ahmed: "page in
 * dashboard with BU filter, line filter" -- YTD business performance per BU
 * with comprehensive comments, IQVIA brand / competitor share and growth, and
 * challenge questions for each BU head).
 *
 * Read-only renderer over cache/business_review.data.js, built by
 * etl/build_business_review_cache.py (all numbers and comments are computed
 * there from the existing caches -- this file does no business math beyond
 * ratios for display). Lazy-loaded through js/cache-loader.js
 * ("business_review") when the tab is opened.
 *
 * Access: AUTH.canViewBuReview() -- SFE Manager only (Ahmed: "my
 * challenge notes"). Re-checked in init() (defence in depth, as every gated tab).
 *
 * Public: window.BuReviewDashboard = { init(containerId), destroy(), canView() }
 */
(function (global) {
  'use strict';

  var DATA = null;
  var STATE = { bu: 'ALL', line: 'ALL', openBrand: null, showAll: {}, iqMode: 'YTD' };
  var ROOT_ID = null;

  function canView() {
    return !!(global.AUTH && typeof global.AUTH.canViewBuReview === 'function' && global.AUTH.canViewBuReview());
  }

  function gunzipB64Json(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(pako.ungzip(bytes, { to: 'string' }));
  }

  function load() {
    if (DATA) return true;
    if (!global.BUSINESS_REVIEW_CACHE || !global.BUSINESS_REVIEW_CACHE.b64Data || typeof pako === 'undefined') return false;
    try { DATA = gunzipB64Json(global.BUSINESS_REVIEW_CACHE.b64Data); } catch (e) { console.error('[BuReview] decode failed', e); return false; }
    return true;
  }

  // ------------------------------------------------------------ format helpers
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function pct(x, d) { return x == null || isNaN(x) ? 'n/a' : (x * 100).toFixed(d == null ? 0 : d) + '%'; }
  function pts(x, d) { if (x == null || isNaN(x)) return 'n/a'; var v = x * 100; return (v >= 0 ? '+' : '') + v.toFixed(d == null ? 1 : d) + ' pts'; }
  function mE(v) { return v == null ? 'n/a' : (v / 1e6).toFixed(1) + 'M'; }
  function sgnPct(x, d) { if (x == null || isNaN(x)) return 'n/a'; var v = x * 100; return (v >= 0 ? '+' : '') + v.toFixed(d == null ? 0 : d) + '%'; }
  var MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monLbl(ym) { return MON[parseInt(String(ym).slice(5, 7), 10)] || ym; }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] || 0; return s; }

  function status(kind, v, line) {
    if (v == null || isNaN(v)) return 'na';
    var T = DATA.meta.thresholds;
    switch (kind) {
      case 'sales': return v >= 100 ? 'good' : v >= 90 ? 'warn' : 'bad';
      case 'cov': return v >= T.cov ? 'good' : v >= 0.8 ? 'warn' : 'bad';
      case 'rf': return v > T.rf ? 'good' : v >= 0.65 ? 'warn' : 'bad';
      case 'cpd': var t = line === 'CHC_SALES' ? T.cpdChcSales : T.cpd; return v >= t ? 'good' : v >= t - 1 ? 'warn' : 'bad';
      case 'field': return v >= T.field ? 'good' : v >= 0.7 ? 'warn' : 'bad';
      case 'evi': return v >= 100 ? 'good' : v >= 95 ? 'warn' : 'bad';
      case 'delta': return v > 0.0005 ? 'good' : v >= -0.005 ? 'warn' : 'bad';
    }
    return 'na';
  }
  var ICON = { good: '✓', warn: '!', bad: '✕', na: '–' };
  function chip(st, text) { return '<span class="bur-st bur-st-' + st + '"><span class="bur-ic">' + ICON[st] + '</span>' + text + '</span>'; }

  // ------------------------------------------------------------ entity metrics
  function metrics(E) {
    var s = E.sales, n = s.mA.length;
    var ytdA = sum(s.mA), ytdO = sum(s.mO), ytdS = sum(s.mS);
    var ex = E.exec[E.exec.length - 1];
    var exF = E.exec.filter(Boolean);
    var cl = null; for (var i = E.coach.length - 1; i >= 0; i--) { if (E.coach[i]) { cl = E.coach[i]; break; } }
    var fl = E.field[E.field.length - 1];
    return {
      ytdA: ytdA, ytdO: ytdO, ach: ytdO ? 100 * ytdA / ytdO : null,
      lastA: s.mA[n - 1], lastO: s.mO[n - 1], lastAch: s.mO[n - 1] ? 100 * s.mA[n - 1] / s.mO[n - 1] : null,
      supply: ytdO && ytdS && ytdO > ytdS ? (ytdO - ytdS) / ytdO : 0,
      cov: ex ? ex.cov / ex.n : null, rf: ex ? ex.rf / ex.n : null,
      aRf: ex && ex.aN ? ex.aRf / ex.aN : null, visit: ex && ex.tgt ? ex.vis / ex.tgt : null,
      ytdCov: exF.length ? sum(exF.map(function (x) { return x.cov; })) / sum(exF.map(function (x) { return x.n; })) : null,
      ytdRf: exF.length ? sum(exF.map(function (x) { return x.rf; })) / sum(exF.map(function (x) { return x.n; })) : null,
      hc: ex ? ex.hc : null, below: ex ? ex.below : null, over: ex ? ex.over : null,
      cpd: cl ? cl.vis / cl.days : null, coached: cl && cl.team ? cl.coached / cl.team : null,
      field: fl ? fl.avg : null, fieldLow: fl ? fl.low : null, fieldN: fl ? fl.n : null,
      resigned: E.resignedYtd
    };
  }

  // ---- IQVIA period view (v6, Priority 3): YTD (default; all comments use YTD) or MAT
  function isMat() { return STATE.iqMode === 'MAT' && DATA.meta.iqviaMat; }
  function iqLbl() { return isMat() ? 'MAT' : 'YTD'; }
  function iqCmp() { return isMat() ? 'prior 12 months' : 'last year'; }
  function iqOf(L) { return isMat() ? L.iqviaMat : L.iqvia; }
  function iqView(E) {
    if (!isMat()) return E;
    var V = {}; for (var k in E) V[k] = E[k];
    V.iqvia = E.iqviaMat; V.iqBrands = E.iqBrandsMat || [];
    return V;
  }
  function iqPeriodTxt() {
    var m = DATA.meta;
    if (isMat()) return 'IQVIA MAT ' + monLbl(m.iqviaMat.cur[0]) + ' ' + m.iqviaMat.cur[0].slice(0, 4) + '–' + monLbl(m.iqviaMat.cur[1]) + ' ' + m.iqviaMat.cur[1].slice(0, 4) + ' vs the 12 months before';
    return 'IQVIA YTD to ' + monLbl(m.iqviaPeriod) + ' vs same months ' + (parseInt(m.iqviaPeriod.slice(0, 4), 10) - 1);
  }

  function currentKey() {
    if (STATE.line !== 'ALL') return 'LINE:' + STATE.line;
    if (STATE.bu !== 'ALL') return 'BU:' + STATE.bu;
    return 'ALL';
  }

  // ------------------------------------------------------------ SVG charts
  function salesChart(E) {
    var s = E.sales, months = DATA.meta.salesMonths, n = months.length;
    var W = 560, H = 210, m = { l: 40, r: 12, t: 14, b: 30 };
    var ach = s.mA.map(function (a, i) { return s.mO[i] ? 100 * a / s.mO[i] : null; });
    var mx = Math.max(140, Math.ceil(Math.max.apply(null, ach.filter(function (v) { return v != null; }).concat([100])) / 20) * 20);
    mx = Math.min(mx, 220);
    var bw = (W - m.l - m.r) / n;
    var Y = function (v) { return H - m.b - Math.min(v, mx) / mx * (H - m.t - m.b); };
    var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="bur-svg" role="img" aria-label="Monthly sales achievement">';
    for (var g = 0; g <= mx; g += (mx > 160 ? 40 : 20)) {
      h += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(g) + '" y2="' + Y(g) + '" class="bur-grid"/>';
      h += '<text x="' + (m.l - 6) + '" y="' + (Y(g) + 4) + '" text-anchor="end" class="bur-ax">' + g + '%</text>';
    }
    ach.forEach(function (v, i) {
      var x = m.l + i * bw + bw * 0.18, w = bw * 0.64;
      if (v != null) {
        var st = status('sales', v);
        h += '<rect x="' + x + '" y="' + Y(v) + '" width="' + w + '" height="' + (Y(0) - Y(v)) + '" rx="3" class="bur-bar bur-fill-' + st + '"><title>' + monLbl(months[i]) + ': ' + v.toFixed(0) + '% (' + mE(s.mA[i]) + ' of ' + mE(s.mO[i]) + ')</title></rect>';
        h += '<text x="' + (x + w / 2) + '" y="' + (Y(v) - 4) + '" text-anchor="middle" class="bur-lab">' + v.toFixed(0) + (v > mx ? '↑' : '') + '</text>';
      }
      h += '<text x="' + (x + w / 2) + '" y="' + (H - 10) + '" text-anchor="middle" class="bur-ax">' + monLbl(months[i]) + '</text>';
    });
    h += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(100) + '" y2="' + Y(100) + '" class="bur-ref"/>';
    return h + '</svg>';
  }

  function execChart(E) {
    var periods = DATA.meta.execPeriods, n = periods.length;
    var W = 560, H = 210, m = { l: 40, r: 12, t: 14, b: 30 };
    var X = function (i) { return m.l + (n > 1 ? i * (W - m.l - m.r) / (n - 1) : 0); };
    var Y = function (v) { return H - m.b - v * (H - m.t - m.b); };
    var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="bur-svg" role="img" aria-label="Coverage and Right Frequency trend">';
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(function (g) {
      h += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(g) + '" y2="' + Y(g) + '" class="bur-grid"/>';
      h += '<text x="' + (m.l - 6) + '" y="' + (Y(g) + 4) + '" text-anchor="end" class="bur-ax">' + (g * 100) + '%</text>';
    });
    h += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(0.9) + '" y2="' + Y(0.9) + '" class="bur-ref bur-ref-a"/>';
    h += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(0.8) + '" y2="' + Y(0.8) + '" class="bur-ref bur-ref-b"/>';
    [['cov', 'bur-s1', 'Coverage'], ['rf', 'bur-s2', 'Right Freq.']].forEach(function (sr) {
      var d = '', pts2 = [];
      E.exec.forEach(function (x, i) {
        if (!x) return;
        var v = x[sr[0]] / x.n; d += (d ? 'L' : 'M') + X(i) + ' ' + Y(v); pts2.push([X(i), Y(v), v, periods[i]]);
      });
      h += '<path d="' + d + '" class="bur-line ' + sr[1] + '"/>';
      pts2.forEach(function (p) { h += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" class="bur-dot ' + sr[1] + '"><title>' + sr[2] + ' ' + p[3] + ': ' + pct(p[2], 1) + '</title></circle>'; });
      var last = pts2[pts2.length - 1];
      if (last) h += '<text x="' + (last[0] - 4) + '" y="' + (last[1] - 8) + '" text-anchor="end" class="bur-lab">' + pct(last[2]) + '</text>';
    });
    periods.forEach(function (p, i) { h += '<text x="' + X(i) + '" y="' + (H - 10) + '" text-anchor="middle" class="bur-ax">' + p.slice(0, 3) + '</text>'; });
    return h + '</svg>';
  }

  // ------------------------------------------------------------ sections
  function tile(label, value, st, sub) {
    return '<div class="bur-tile"><div class="bur-tl">' + label + '</div><div class="bur-tv">' + value + ' ' + (st ? chip(st, st === 'good' ? 'On track' : st === 'warn' ? 'Watch' : st === 'bad' ? 'Below bar' : 'n/a') : '') + '</div><div class="bur-ts">' + sub + '</div></div>';
  }

  function tilesHtml(E, M) {
    var iq = E.iqvia, line1 = E.kind === 'line' ? E.lines[0] : null;
    var lastMon = monLbl(DATA.meta.salesMonths[DATA.meta.salesMonths.length - 1]);
    var h = '<div class="bur-tiles">';
    h += tile('Sales YTD vs Official', M.ach == null ? 'n/a' : M.ach.toFixed(0) + '%', status('sales', M.ach), mE(M.ytdA) + ' of ' + mE(M.ytdO) + ' · ' + lastMon + ' ' + (M.lastAch == null ? 'n/a' : M.lastAch.toFixed(0) + '%'));
    if (iq) {
      h += tile('IQVIA share ' + iqLbl() + ' (units)', pct(iq.shareSU, 2), status('delta', iq.shareSU - iq.shareSUp), pts(iq.shareSU - iq.shareSUp, 2) + ' vs ' + iqCmp() + ' · value ' + pct(iq.shareV, 2));
      h += tile('Evolution index (units)', iq.evi == null ? 'n/a' : String(iq.evi), status('evi', iq.evi), 'Market ' + sgnPct(iq.mktG) + ' · Zeta ' + sgnPct(iq.zG) + ' value growth');
    } else {
      h += tile('IQVIA share', '—', null, 'No IQVIA market data for this scope');
    }
    h += tile('Coverage (' + DATA.meta.execPeriods[DATA.meta.execPeriods.length - 1].slice(0, 3) + ')', pct(M.cov, 1), status('cov', M.cov), 'bar ≥ 90% · YTD ' + pct(M.ytdCov, 1));
    h += tile('Right Frequency', pct(M.rf, 1), status('rf', M.rf), 'bar > 80% · A-class ' + pct(M.aRf, 0));
    h += tile('Calls / coaching day', M.cpd == null ? 'n/a' : M.cpd.toFixed(1), status('cpd', M.cpd, line1), 'target ' + (line1 === 'CHC_SALES' ? 12 : 7) + ' · coached ' + pct(M.coached, 0));
    h += tile('DM field days', pct(M.field, 0), status('field', M.field), M.fieldN ? (M.fieldLow + ' of ' + M.fieldN + ' DMs below 70%') : 'no DM data');
    return h + '</div>';
  }

  // Comments are facts only (Ahmed 2026-09-26: "don't make any hypothesis"),
  // already ranked by EGP at stake in the ETL. Top 5 shown, the rest behind
  // "Show all"; the EGP chip shows what the item is worth.
  var TOP_N = 5;
  function commentList(items, col) {
    if (!items || !items.length) return '<div class="bur-empty">Nothing flagged.</div>';
    var all = !!STATE.showAll[col], shown = all ? items : items.slice(0, TOP_N);
    var h = '<ul class="bur-cl">' + shown.map(function (c) {
      return '<li>' + (c.impact ? '<span class="bur-imp" title="EGP at stake">' + mE(c.impact) + '</span>' : '') + esc(c.text) + '</li>';
    }).join('') + '</ul>';
    if (items.length > TOP_N) h += '<button type="button" class="bur-more" data-more="' + col + '">' + (all ? 'Show top ' + TOP_N : 'Show all (' + items.length + ')') + '</button>';
    return h;
  }

  function commentsHtml(E) {
    var C = E.comments;
    return '<div class="bur-grid3">' +
      '<div class="bur-card bur-good"><h3>What went well</h3>' + commentList(C.strengths, 'st') + '</div>' +
      '<div class="bur-card bur-bad"><h3>What needs attention</h3>' + commentList(C.concerns, 'co') + '</div>' +
      '<div class="bur-card bur-mkt"><h3>Market (IQVIA)</h3>' + (E.iqvia ? commentList(C.market, 'mk') : '<div class="bur-empty">No IQVIA market data for this scope.</div>') + '</div>' +
      '</div>';
  }

  // ------------------------------------------------------------ full-year outlook
  function landingHtml(E) {
    var LD = E.landing; if (!LD) return '';
    var s = E.sales, months = DATA.meta.salesMonths, n = months.length;
    var ytdA = sum(s.mA), ytdO = sum(s.mO);
    var pl = monLbl(LD.paceMonths[0]) + '–' + monLbl(LD.paceMonths[LD.paceMonths.length - 1]);
    var nxt = parseInt(months[n - 1].slice(5, 7), 10) + 1, rl = (MON[nxt] || '') + '–Dec';
    var t = '<div class="bur-land">';
    t += '<div class="bur-lk"><div class="bur-tl">YTD sales</div><div class="bur-lv">' + mE(ytdA) + '</div><div class="bur-ts">target ' + mE(ytdO) + '</div></div>';
    t += '<div class="bur-lk"><div class="bur-tl">Current pace (' + pl + ' avg)</div><div class="bur-lv">' + mE(LD.pace) + '<span class="bur-u">/month</span></div><div class="bur-ts">&nbsp;</div></div>';
    t += '<div class="bur-lk"><div class="bur-tl">Year-end at current pace</div><div class="bur-lv">' + mE(LD.landing) + '</div><div class="bur-ts">YTD + ' + LD.remMonths + ' × pace</div></div>';
    if (LD.fy) {
      var st = status('sales', 100 * LD.landing / LD.fy);
      t += '<div class="bur-lk"><div class="bur-tl">Full-year target</div><div class="bur-lv">' + mE(LD.fy) + '</div><div class="bur-ts">at pace: ' + chip(st, (100 * LD.landing / LD.fy).toFixed(0) + '%') + ' · gap ' + (LD.landing - LD.fy >= 0 ? '+' : '') + mE(LD.landing - LD.fy) + '</div></div>';
      var up = LD.required / LD.pace - 1;
      t += '<div class="bur-lk bur-lk-hi"><div class="bur-tl">Needed per month, ' + rl + '</div><div class="bur-lv">' + mE(LD.required) + '<span class="bur-u">/month</span></div><div class="bur-ts">' + (up >= 0 ? '+' : '') + (100 * up).toFixed(0) + '% vs current pace</div></div>';
    } else {
      t += '<div class="bur-lk bur-lk-na"><div class="bur-tl">Full-year target</div><div class="bur-lv">not loaded</div><div class="bur-ts">No Sep–Dec target in the source files for this scope</div></div>';
    }
    t += '</div>';
    return '<div class="bur-card"><h3>Full-year outlook</h3>' + t + landingChart(E) +
      '<div class="bur-foot">Arithmetic only: year-end at current pace = YTD actual + remaining months × the ' + pl + ' monthly average. ' + (LD.fy ? 'Full-year target from ' + esc(LD.fySource) + '.' : '') + '</div></div>';
  }

  function landingChart(E) {
    var LD = E.landing, s = E.sales, n = s.mA.length;
    var W = 1100, H = 190, m = { l: 50, r: 16, t: 12, b: 26 };
    var cumA = [], c = 0; s.mA.forEach(function (v) { c += v; cumA.push(c); });
    var proj = [cumA[n - 1]]; for (var i = 0; i < LD.remMonths; i++) proj.push(proj[proj.length - 1] + LD.pace);
    var tgt = null;
    if (LD.fy) { var co = 0; tgt = []; s.mO.forEach(function (v) { co += v; tgt.push(co); }); var rem = (LD.fy - co) / LD.remMonths; for (var j = 0; j < LD.remMonths; j++) { co += rem; tgt.push(co); } }
    var mx = Math.max(proj[proj.length - 1], tgt ? tgt[tgt.length - 1] : 0, cumA[n - 1]) * 1.08;
    var X = function (k) { return m.l + k * (W - m.l - m.r) / 11; }, Y = function (v) { return H - m.b - v / mx * (H - m.t - m.b); };
    var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="bur-svg" role="img" aria-label="Cumulative sales, projection and target">';
    for (var g = 0; g <= 4; g++) { var gv = mx * g / 4; h += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(gv) + '" y2="' + Y(gv) + '" class="bur-grid"/><text x="' + (m.l - 6) + '" y="' + (Y(gv) + 4) + '" text-anchor="end" class="bur-ax">' + (gv / 1e6).toFixed(0) + 'M</text>'; }
    MON.slice(1).forEach(function (mn, k) { h += '<text x="' + X(k) + '" y="' + (H - 8) + '" text-anchor="middle" class="bur-ax">' + mn + '</text>'; });
    var path = function (arr, off) { return arr.map(function (v, k) { return (k ? 'L' : 'M') + X(k + off) + ' ' + Y(v); }).join(''); };
    if (tgt) h += '<path d="' + path(tgt, 0) + '" class="bur-line bur-tgt"/><text x="' + (X(11) - 10) + '" y="' + (Y(tgt[11]) - 10) + '" text-anchor="end" class="bur-lab bur-halo">Target ' + mE(tgt[11]) + '</text>';
    h += '<path d="' + path(cumA, 0) + '" class="bur-line bur-s1"/>';
    h += '<path d="' + path(proj, n - 1) + '" class="bur-line bur-s1 bur-dash"/>';
    h += '<circle cx="' + X(11) + '" cy="' + Y(proj[proj.length - 1]) + '" r="4" class="bur-dot bur-s1"/><text x="' + (X(11) - 10) + '" y="' + (Y(proj[proj.length - 1]) + ((tgt && tgt[11] > proj[proj.length - 1]) ? 20 : -10)) + '" text-anchor="end" class="bur-lab bur-halo">At pace ' + mE(proj[proj.length - 1]) + '</text>';
    return h + '</svg><div class="bur-legend"><span><i class="bur-sw bur-s1"></i>Actual (cumulative)</span><span><i class="bur-sw bur-s1 bur-sw-dash"></i>Current pace</span>' + (tgt ? '<span><i class="bur-sw bur-sw-tgt"></i>Target (cumulative)</span>' : '') + '</div>';
  }

  // ------------------------------------------------------------ gap bridge
  function bridgeHtml(E) {
    var rows, by;
    if (E.kind === 'all') { by = 'BU'; rows = Object.keys(DATA.meta.buLines).map(function (b) { var e = DATA.entities['BU:' + b]; return { name: b, gap: sum(e.sales.mA) - sum(e.sales.mO) }; }); }
    else if (E.kind === 'bu') { by = 'line'; rows = E.lines.filter(function (l) { return l !== 'CHC_SALES' || E.lines.length === 1; }).map(function (l) { var e = DATA.entities['LINE:' + l]; return { name: l, gap: sum(e.sales.mA) - sum(e.sales.mO) }; }); }
    else { by = 'brand'; rows = (E.salesBrands || []).map(function (b) { return { name: b.brand, gap: b.ytdA - b.ytdO }; }); }
    rows = rows.filter(function (r) { return Math.abs(r.gap) >= 0.05e6; }).sort(function (a, b) { return b.gap - a.gap; });
    if (!rows.length) return '';
    var s = E.sales, total = sum(s.mA) - sum(s.mO), vol = sum(s.mVol), prc = sum(s.mPrice), oth = sum(s.mOther);
    var all = rows.concat([{ name: 'Total', gap: total, total: true }]);
    var mx = Math.max.apply(null, all.map(function (r) { return Math.abs(r.gap); })) || 1;
    var W = 1100, rh = 24, m = { l: 190, r: 90 }, H = all.length * rh + 12;
    var X = function (v) { return m.l + (v + mx) / (2 * mx) * (W - m.l - m.r); };
    var h = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="bur-svg" role="img" aria-label="Contribution to the gap vs target">';
    h += '<line x1="' + X(0) + '" x2="' + X(0) + '" y1="0" y2="' + H + '" class="bur-zero"/>';
    all.forEach(function (r, i) {
      var y = i * rh + (r.total ? 10 : 2), x0 = X(0), x1 = X(r.gap);
      if (r.total) h += '<line x1="10" x2="' + (W - 10) + '" y1="' + (y - 4) + '" y2="' + (y - 4) + '" class="bur-grid"/>';
      h += '<text x="' + (m.l - 8) + '" y="' + (y + 15) + '" text-anchor="end" class="' + (r.total ? 'bur-lab' : 'bur-ax bur-ax-l') + '">' + esc(r.name) + '</text>';
      h += '<rect x="' + Math.min(x0, x1) + '" y="' + (y + 4) + '" width="' + Math.max(2, Math.abs(x1 - x0)) + '" height="' + (rh - 8) + '" rx="3" class="bur-bar ' + (r.gap >= 0 ? 'bur-fill-good' : 'bur-fill-bad') + '"><title>' + esc(r.name) + ': ' + (r.gap >= 0 ? '+' : '') + mE(r.gap) + '</title></rect>';
      h += '<text x="' + (r.gap >= 0 ? x1 + 5 : x1 - 5) + '" y="' + (y + 15) + '" text-anchor="' + (r.gap >= 0 ? 'start' : 'end') + '" class="bur-lab">' + (r.gap >= 0 ? '+' : '') + mE(r.gap) + '</text>';
    });
    h += '</svg>';
    var split = '<div class="bur-split"><span class="bur-tl">Total gap split</span>' +
      '<span>Volume (units) <b class="' + (vol >= 0 ? 'bur-pos' : 'bur-neg') + '">' + (vol >= 0 ? '+' : '') + mE(vol) + '</b></span>' +
      '<span>Price / mix <b class="' + (prc >= 0 ? 'bur-pos' : 'bur-neg') + '">' + (prc >= 0 ? '+' : '') + mE(prc) + '</b></span>' +
      (Math.abs(oth) >= 0.05e6 ? '<span>Months without unit targets <b>' + (oth >= 0 ? '+' : '') + mE(oth) + '</b></span>' : '') + '</div>';
    return '<div class="bur-card"><h3>Where the YTD result came from: actual − Official target, by ' + by + '</h3>' + h + split +
      '<div class="bur-foot">Volume = (actual units − target units) × target price. Price / mix = actual value − actual units × target price. The two add up to the total gap' + (by === 'brand' ? '' : ' (CHC_SALES is not in the BU total)') + '.</div></div>';
  }

  function questionsHtml(E) {
    var q = E.comments.questions || [];
    if (!q.length) return '';
    return '<div class="bur-card"><div class="bur-h"><h3>Questions to ask ' + esc(E.kind === 'all' ? 'the BU heads' : E.name) + '</h3><button type="button" class="bur-btn" data-act="copy">Copy comments</button></div><ol class="bur-q">' +
      q.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol></div>';
  }

  function lineTableHtml(E) {
    if (E.kind === 'line') return '';
    var rows = E.lines.map(function (l) { return DATA.entities['LINE:' + l]; }).filter(Boolean);
    var mk = bestMarks(rows);
    var h = '<div class="bur-card"><h3>Lines at a glance</h3><div class="bur-scroll"><table class="bur-t"><thead><tr><th>Line</th><th>YTD sales</th><th>YTD ach.</th><th>' + monLbl(DATA.meta.salesMonths[DATA.meta.salesMonths.length - 1]) + ' ach.</th><th>IQVIA share Δ <span class="bur-note">' + iqLbl() + '</span></th><th>EVI</th><th>Coverage</th><th>Right Freq.</th><th>Calls/coach day</th><th>DM field days</th><th>Resigned YTD</th></tr></thead><tbody>';
    rows.forEach(function (L) {
      var M = metrics(L), iq = iqOf(L), l = L.lines[0];
      var dsh = iq ? iq.shareSU - iq.shareSUp : null;
      h += '<tr data-line="' + esc(l) + '" class="bur-click"><td class="bur-ln">' + esc(l) + (l === 'CHC_SALES' ? ' <span class="bur-note">not in BU total</span>' : '') + '</td>' +
        '<td>' + mE(M.ytdA) + '</td>' +
        '<td class="bur-c-' + status('sales', M.ach) + '">' + (M.ach == null ? 'n/a' : M.ach.toFixed(0) + '%') + star(mk, 'ach', l) + '</td>' +
        '<td class="bur-c-' + status('sales', M.lastAch) + '">' + (M.lastAch == null ? 'n/a' : M.lastAch.toFixed(0) + '%') + star(mk, 'lastAch', l) + '</td>' +
        '<td class="bur-c-' + status('delta', dsh) + '">' + (dsh == null ? 'n/a' : pts(dsh, 2)) + (l === 'CHC_SALES' ? '*' : '') + star(mk, 'dsh', l) + '</td>' +
        '<td class="bur-c-' + status('evi', iq && iq.evi) + '">' + (iq && iq.evi != null ? iq.evi : 'n/a') + star(mk, 'evi', l) + '</td>' +
        '<td class="bur-c-' + status('cov', M.cov) + '">' + pct(M.cov, 1) + star(mk, 'cov', l) + '</td>' +
        '<td class="bur-c-' + status('rf', M.rf) + '">' + pct(M.rf, 1) + star(mk, 'rf', l) + '</td>' +
        '<td class="bur-c-' + status('cpd', M.cpd, l) + '">' + (M.cpd == null ? 'n/a' : M.cpd.toFixed(1)) + star(mk, 'cpd', l) + '</td>' +
        '<td class="bur-c-' + status('field', M.field) + '">' + pct(M.field, 0) + star(mk, 'field', l) + '</td>' +
        '<td>' + (M.resigned || 0) + '</td></tr>';
    });
    return h + '</tbody></table></div><div class="bur-foot">Click a line to open its review. ★ = best line in this table (CHC_SALES not ranked). *CHC_SALES shares the CHC market in IQVIA.</div></div>';
  }

  function salesBrandsHtml(E) {
    var b = E.salesBrands || [];
    if (!b.length) return '';
    var lastMon = monLbl(DATA.meta.salesMonths[DATA.meta.salesMonths.length - 1]);
    var h = '<div class="bur-card"><h3>Brand sales vs Official target (sell-in, YTD)</h3><div class="bur-scroll"><table class="bur-t"><thead><tr><th>Brand</th>' + (E.kind !== 'line' ? '<th>Line</th>' : '') + '<th>YTD sales</th><th>YTD target</th><th>Gap</th><th>YTD ach.</th><th>' + lastMon + ' ach.</th><th>' + lastMon + ' vs prior month</th></tr></thead><tbody>';
    b.forEach(function (r) {
      var ach = r.ytdO ? 100 * r.ytdA / r.ytdO : null, la = r.lastO ? 100 * r.lastA / r.lastO : null;
      var mom = r.prevA ? (r.lastA / r.prevA - 1) : null;
      h += '<tr><td class="bur-ln">' + esc(r.brand) + '</td>' + (E.kind !== 'line' ? '<td>' + esc(r.line) + '</td>' : '') +
        '<td>' + mE(r.ytdA) + '</td><td>' + mE(r.ytdO) + '</td><td class="' + (r.ytdA - r.ytdO >= 0 ? 'bur-pos' : 'bur-neg') + '">' + (r.ytdA - r.ytdO >= 0 ? '+' : '') + mE(r.ytdA - r.ytdO) + '</td>' +
        '<td class="bur-c-' + status('sales', ach) + '">' + (ach == null ? 'n/a' : ach.toFixed(0) + '%') + '</td>' +
        '<td class="bur-c-' + status('sales', la) + '">' + (la == null ? 'n/a' : la.toFixed(0) + '%') + '</td>' +
        '<td class="' + (mom == null ? '' : mom >= 0 ? 'bur-pos' : 'bur-neg') + '">' + sgnPct(mom) + '</td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }

  function iqBrandsHtml(E) {
    var b = E.iqBrands || [];
    if (!b.length) return E.kind === 'all' ? '' : '<div class="bur-card"><h3>IQVIA brand performance</h3><div class="bur-empty">No Zeta brand with an IQVIA market in this scope.</div></div>';
    var h = '<div class="bur-card"><div class="bur-h"><h3>IQVIA brand performance and competitors (' + (isMat() ? 'MAT vs prior 12 months' : 'YTD ' + DATA.meta.iqviaYtdMonths + ' months vs last year') + ', value)</h3></div><div class="bur-scroll"><table class="bur-t bur-tb"><thead><tr><th>Zeta brand</th><th>Market (DM1)</th><th>Market size</th><th>Market growth</th><th>Brand growth</th><th>Value share</th><th>Share Δ</th><th>Units share</th><th>EVI</th><th>Rank</th><th>Biggest gainer in market</th><th>New competitors</th></tr></thead><tbody>';
    b.forEach(function (r, i) {
      var d = r.share - r.shareP, open = STATE.openBrand === r.name;
      var rk = r.rank ? ('#' + r.rank + (r.rankP && r.rankP !== r.rank ? ' <span class="bur-note">(was #' + r.rankP + ')</span>' : '') + ' / ' + r.nProds) : 'n/a';
      var g = r.topGainer;
      h += '<tr class="bur-click" data-brand="' + esc(r.name) + '"><td class="bur-ln"><span class="bur-caret">' + (open ? '▾' : '▸') + '</span>' + esc(r.name) + (E.kind !== 'line' ? ' <span class="bur-note">' + esc(r.line || '') + '</span>' : '') + '</td>' +
        '<td>' + esc(r.dm1) + '</td><td>' + mE(r.mktV) + '</td><td>' + sgnPct(r.mktG) + '</td><td>' + (r.growth == null ? 'New' : sgnPct(r.growth)) + '</td>' +
        '<td>' + pct(r.share, 1) + '</td><td class="bur-c-' + status('delta', r.shareP ? d : null) + '">' + (r.shareP ? pts(d) : 'New') + '</td>' +
        '<td>' + pct(r.shareSU, 1) + '</td><td class="bur-c-' + status('evi', r.evi) + '">' + (r.evi == null ? 'n/a' : r.evi) + '</td><td>' + rk + '</td>' +
        '<td>' + (g ? esc(g.prod) + ' <span class="bur-note">' + esc(g.corp) + '</span> ' + pts(g.share - g.shareP) : '—') + '</td>' +
        '<td>' + ((r.newEntrants && r.newEntrants.length) ? r.newEntrants.map(function (x) { return '<span class="bur-new">New</span> ' + esc(x.prod) + ' ' + pct(x.share, 1); }).join('<br>') : '—') + '</td></tr>';
      if (open) {
        h += '<tr class="bur-sub"><td colspan="12"><div class="bur-comp"><div class="bur-comp-h">Top competitors in ' + esc(r.dm1) + '</div><table class="bur-t bur-t-in"><thead><tr><th>Product</th><th>Company</th><th>Value share</th><th>Share Δ</th><th>Growth</th></tr></thead><tbody>' +
          r.competitors.map(function (c) {
            var dd = c.shareP ? c.share - c.shareP : null;
            return '<tr><td>' + esc(c.prod) + (c.zeta ? ' <span class="bur-zeta">Zeta</span>' : '') + '</td><td>' + esc(c.corp) + '</td><td>' + pct(c.share, 1) + '</td><td class="' + (dd == null ? '' : dd >= 0 ? 'bur-pos' : 'bur-neg') + '">' + (dd == null ? 'New' : pts(dd)) + '</td><td>' + (c.growth == null ? 'New' : sgnPct(c.growth)) + '</td></tr>';
          }).join('') + '</tbody></table>' +
          (r.topLoser ? '<div class="bur-foot">Biggest share loser (≥0.5% share): ' + esc(r.topLoser.prod) + ' (' + esc(r.topLoser.corp) + ') ' + pts(r.topLoser.share - r.topLoser.shareP) + '</div>' : '') +
          '</div></td></tr>';
      }
    });
    return h + '</tbody></table></div><div class="bur-foot">Click a brand to see its competitors. Market = the brand\'s main DM1 market, OTHER MARKET excluded. EVI = brand growth ÷ market growth × 100.</div></div>';
  }

  function moverRow(c, cls) {
    return '<div class="bur-mv-r"><span>' + esc(c.corp) + (c.zeta ? ' <span class="bur-zeta">Zeta</span>' : '') + '</span><span class="' + cls + '">' + pts(c.dShare, 2) + '</span></div>' +
      ((c.prods && c.prods.length) ? '<div class="bur-mv-p">' + c.prods.map(function (p) { return esc(p.prod) + ' <span class="' + cls + '">' + pts(p.dShare, 2) + '</span>'; }).join(' · ') + '</div>' : '');
  }

  function landscapeHtml(E) {
    var iq = E.iqvia;
    if (!iq) return '';
    var h = '<div class="bur-card"><h3>Company landscape in the ' + esc(E.kind === 'bu' ? E.bu + ' BU' : E.kind === 'all' ? 'promoted BUs\'' : E.name) + ' market (IQVIA ' + iqLbl() + ', value)</h3><div class="bur-grid2 bur-land">';
    h += '<div><div class="bur-scroll"><table class="bur-t"><thead><tr><th>#</th><th>Company</th><th>Share</th><th>Share Δ</th><th>Growth</th><th>Top products <span class="bur-note">(share of this market · growth)</span></th></tr></thead><tbody>' +
      iq.topCorps.map(function (c, i) {
        var d = c.shareP != null ? c.share - c.shareP : null;
        return '<tr class="' + (c.zeta ? 'bur-zrow' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(c.corp) + (c.zeta ? ' <span class="bur-zeta">Zeta</span>' : '') + '</td><td>' + pct(c.share, 1) + '</td><td class="' + (d == null ? '' : d >= 0 ? 'bur-pos' : 'bur-neg') + '">' + (d == null ? 'n/a' : pts(d)) + '</td><td>' + (c.growth == null ? 'New' : sgnPct(c.growth)) + '</td>' +
          '<td class="bur-prods">' + (c.prods || []).map(function (p) { return '<div><b>' + esc(p.prod) + '</b> ' + pct(p.share, 1) + ' <span class="' + (p.growth == null ? 'bur-note' : p.growth >= 0 ? 'bur-pos' : 'bur-neg') + '">' + (p.growth == null ? 'new' : sgnPct(p.growth)) + '</span></div>'; }).join('') + '</td></tr>';
      }).join('') + '</tbody></table></div><div class="bur-foot">Zeta rank #' + (iq.rank || 'n/a') + ' of ' + iq.nCorps + (iq.rankP && iq.rankP !== iq.rank ? ' (last year #' + iq.rankP + ')' : '') + '.</div></div>';
    h += '<div><div class="bur-mv"><div class="bur-mv-h">Biggest share gainers</div>' + iq.gainers.map(function (c) { return moverRow(c, 'bur-pos'); }).join('') + '</div>' +
      '<div class="bur-mv"><div class="bur-mv-h">Biggest share losers</div>' + iq.losers.map(function (c) { return moverRow(c, 'bur-neg'); }).join('') + '</div>' +
      '<div class="bur-foot">Companies with ≥0.5% share and sales in the comparison period (the dashboard\'s growth-ranking rule). Under each company: its products with the largest share change in this market.</div></div>';
    return h + '</div></div>';
  }

  // ------------------------------------------------------------ copy text
  function commentsText(E) {
    var C = E.comments, out = [E.name + ' — Business Review YTD ' + monLbl(DATA.meta.salesMonths[0]) + '–' + monLbl(DATA.meta.salesMonths[DATA.meta.salesMonths.length - 1]) + ' 2026', '', C.headline, ''];
    [['WHAT WENT WELL', C.strengths], ['WHAT NEEDS ATTENTION', C.concerns], ['MARKET (IQVIA)', C.market]].forEach(function (s) {
      if (!s[1] || !s[1].length) return;
      out.push(s[0]); s[1].forEach(function (c) { out.push('- ' + (c.impact ? '[' + mE(c.impact) + '] ' : '') + c.text); }); out.push('');
    });
    if (C.questions.length) { out.push('QUESTIONS'); C.questions.forEach(function (q, i) { out.push((i + 1) + '. ' + q); }); }
    return out.join('\n');
  }

  // ------------------------------------------------------------ render
  function filtersHtml() {
    var bl = DATA.meta.buLines;
    var bus = ['ALL'].concat(Object.keys(bl));
    var lines = STATE.bu === 'ALL' ? [].concat.apply([], Object.keys(bl).map(function (b) { return bl[b]; })) : bl[STATE.bu];
    return '<div class="bur-filters">' +
      '<label>Business Unit<select id="bur-f-bu">' + bus.map(function (b) { return '<option value="' + b + '"' + (STATE.bu === b ? ' selected' : '') + '>' + (b === 'ALL' ? 'All BUs' : b) + '</option>'; }).join('') + '</select></label>' +
      (DATA.meta.iqviaMat ? '<div class="bur-seg" role="group" aria-label="IQVIA period"><span>IQVIA</span><button type="button" data-iq="YTD" class="' + (STATE.iqMode !== 'MAT' ? 'on' : '') + '">YTD</button><button type="button" data-iq="MAT" class="' + (STATE.iqMode === 'MAT' ? 'on' : '') + '">MAT</button></div>' : '') +
      '<label>Line<select id="bur-f-line"><option value="ALL">' + (STATE.bu === 'ALL' ? 'All lines' : 'All ' + STATE.bu + ' lines') + '</option>' + lines.map(function (l) { return '<option value="' + l + '"' + (STATE.line === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></label>' +
      '<div class="bur-exp"><button type="button" class="bur-btn" data-act="xlsx">Export Excel</button><button type="button" class="bur-btn" data-act="print">Print / PDF</button></div>' +
      '</div>';
  }

  // ---- Priority 2 (v5): sell-in vs IQVIA in-market, customer base, action tracker
  function spark(a, cls) {
    var mx = Math.max.apply(null, a.concat([1])), W = 84, H = 22;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="bur-spark"><polyline class="' + cls + '" fill="none" points="' +
      a.map(function (v, i) { return (i * W / Math.max(1, a.length - 1)).toFixed(1) + ',' + (H - 2 - v / mx * (H - 4)).toFixed(1); }).join(' ') + '"/></svg>';
  }
  function selloutHtml(E) {
    var g = E.sellout || [], bm = DATA.meta.brandMap || {};
    if (!g.length && !bm.file) return '';
    var sm = DATA.meta.salesMonths, n = sm.length;
    var base = monLbl(sm[0]) + '–' + monLbl(sm[n - 3]), rec = monLbl(sm[n - 2]) + '–' + monLbl(sm[n - 1]);
    var h = '<div class="bur-card"><h3>Sell-in (our sales) vs IQVIA in-market, by brand</h3><div class="bur-scroll"><table class="bur-t"><thead><tr><th>Brand (sales)</th><th>IQVIA products</th><th>YTD sell-in</th><th>YTD in-market</th><th>Monthly trend<br><span class="bur-note"><i class="bur-sw bur-s1"></i>sell-in <i class="bur-sw bur-s2"></i>in-market</span></th><th>Sell-in ' + rec + '<br>vs ' + base + ' avg</th><th>In-market ' + rec + '<br>vs ' + base + ' avg</th><th>Gap</th><th>In-market YTD<br>vs last year</th></tr></thead><tbody>';
    g.forEach(function (r) {
      var gap = r.siChg != null && r.imChg != null ? r.siChg - r.imChg : null;
      var flag = gap != null && Math.abs(gap) >= 0.2 && !r.smallBase;
      h += '<tr' + (flag ? ' class="bur-flag"' : '') + '><td class="bur-ln">' + esc(r.name) + '</td><td class="bur-sm">' + esc(r.iqvia.join(', ')) + '</td>' +
        '<td>' + mE(r.ytdSi) + '</td><td>' + mE(r.ytdIm) + '</td>' +
        '<td>' + spark(r.si, 'bur-sp1') + spark(r.im, 'bur-sp2') + '</td>' +
        '<td class="' + (r.siChg == null ? '' : r.siChg >= 0 ? 'bur-pos' : 'bur-neg') + '">' + sgnPct(r.siChg) + '</td>' +
        '<td class="' + (r.imChg == null ? '' : r.imChg >= 0 ? 'bur-pos' : 'bur-neg') + '">' + sgnPct(r.imChg) + '</td>' +
        '<td>' + (gap == null ? 'n/a' : (r.smallBase ? '<span class="bur-note">small base</span>' : (gap >= 0 ? '+' : '') + (gap * 100).toFixed(0) + ' pts')) + '</td>' +
        '<td class="' + (r.imYoY == null ? '' : r.imYoY >= 0 ? 'bur-pos' : 'bur-neg') + '">' + (r.imYoY == null ? 'no sales LY' : sgnPct(r.imYoY)) + '</td></tr>';
    });
    if (!g.length) h += '<tr><td colspan="9" class="bur-note">No mapped brand in this scope.</td></tr>';
    return h + '</tbody></table></div><div class="bur-foot">Highlighted rows: the two recent-month changes differ by 20 points or more. Sell-in = invoiced sales (Tender excluded, CHC_SALES not added); in-market = IQVIA value for the mapped products, all markets. The two are on different price bases, so compare changes, not amounts. ' +
      'Mapping file: ' + esc(bm.file || 'n/a') + ' — ' + (bm.review && bm.review.length ? '<b>' + bm.review.length + ' links waiting for your review</b> (not used until set to Confirmed): ' + esc(bm.review.map(function (x) { return x.prod + ' → ' + x.brand; }).join('; ')) : 'no links waiting for review') + '.</div></div>';
  }
  function customersHtml(E) {
    var C = E.customers;
    if (!C || !C.total) return '';
    var c = C.counts, v = C.values, cm = DATA.meta.customerMonths || DATA.meta.salesMonths;
    var last = monLbl(cm[cm.length - 1]), prev = monLbl(cm[cm.length - 2]);
    var active = c.New + c.Retained + c.Reactivated;
    var segs = [['Retained', 'bought in ' + prev + ' and ' + last, 'bur-cu-ret'], ['Reactivated', 'bought in ' + last + ', not ' + prev + ', but earlier', 'bur-cu-rea'], ['New', 'first purchase in ' + last, 'bur-cu-new'], ['Lost', 'bought in ' + prev + ', not ' + last, 'bur-cu-lost'], ['Inactive', 'bought earlier this year, not in ' + prev + ' or ' + last, 'bur-cu-ina']];
    var h = '<div class="bur-card"><h3>Customer base (pharmacies: chains + retail)</h3><div class="bur-cu-bar">' +
      segs.map(function (s) { return '<span class="' + s[2] + '" style="flex:' + (c[s[0]] || 0) + '" title="' + s[0] + ': ' + (c[s[0]] || 0).toLocaleString() + '"></span>'; }).join('') + '</div>' +
      '<div class="bur-scroll"><table class="bur-t"><thead><tr><th>Segment</th><th>Meaning</th><th>Pharmacies</th><th>% of base</th><th>YTD value</th></tr></thead><tbody>' +
      segs.map(function (s) { return '<tr><td class="bur-ln"><i class="bur-sw ' + s[2] + '"></i>' + s[0] + '</td><td class="bur-sm">' + s[1] + '</td><td>' + (c[s[0]] || 0).toLocaleString() + '</td><td>' + pct((c[s[0]] || 0) / C.total, 0) + '</td><td>' + mE(v[s[0]]) + '</td></tr>'; }).join('') +
      '</tbody></table></div><div class="bur-foot">Active in ' + last + ': <b>' + active.toLocaleString() + '</b> of ' + C.total.toLocaleString() + ' pharmacies that bought this year. Gained in ' + last + ' (new + reactivated): ' + (c.New + c.Reactivated).toLocaleString() + ' · lost: ' + c.Lost.toLocaleString() + '. Same segment rules as the Customer Health page.</div></div>';
    return h;
  }
  function actionsHtml(E) {
    var a = E.actions || [], f = DATA.meta.actionsFile;
    if (!f) return '';
    var open = a.filter(function (x) { return !x.done; }), od = a.filter(function (x) { return x.overdue; }), dn = a.length - open.length;
    var rows = a.slice().sort(function (x, y) { return (y.overdue - x.overdue) || (x.done - y.done) || String(x.due || '9').localeCompare(String(y.due || '9')); });
    var showAll = STATE.showAll && STATE.showAll.actions, shown = showAll ? rows : rows.slice(0, 8);
    var h = '<div class="bur-card"><div class="bur-h"><h3>Action tracker</h3><div class="bur-act-k"><span>Open <b>' + open.length + '</b></span><span class="bur-neg">Overdue <b>' + od.length + '</b></span><span class="bur-pos">Done <b>' + dn + '</b></span></div></div>';
    if (!a.length) return h + '<div class="bur-note">No actions for this scope in ' + esc(f) + '.</div></div>';
    h += '<div class="bur-scroll"><table class="bur-t"><thead><tr><th>ID</th>' + (E.kind !== 'line' ? '<th>Scope</th>' : '') + '<th>Action / question</th><th>Owner</th><th>Due</th><th>Status</th><th>Update</th></tr></thead><tbody>' +
      shown.map(function (x) {
        var st = x.done ? 'done' : x.overdue ? 'over' : 'open';
        return '<tr><td>' + esc(x.id) + '</td>' + (E.kind !== 'line' ? '<td>' + esc(x.scope) + '</td>' : '') + '<td class="bur-act-t">' + esc(x.action) + '</td><td class="bur-sm">' + esc(x.owner || '—') + '</td><td>' + esc(x.due || '—') + '</td><td><span class="bur-act-s bur-act-' + st + '">' + esc(x.overdue ? 'Overdue' : x.status) + '</span></td><td class="bur-sm">' + esc(x.update || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (rows.length > 8) h += '<button type="button" class="bur-more" data-more="actions">' + (showAll ? 'Show fewer' : 'Show all ' + rows.length) + '</button>';
    return h + '<div class="bur-foot">Maintained in ' + esc(f) + ' (Owner, Due date, Status, Update). The refresh reads it and never overwrites it.</div></div>';
  }

  // ---- Priority 3 (v6): vs best line, data gaps, export
  // KPI definitions shared by the "vs best line" card, the ★ markers in the lines table and the Excel export.
  var PEER_KPIS = [
    { k: 'ach', lbl: 'Sales YTD vs Official', f: function (M) { return M.ach; }, fmt: function (v) { return v == null ? 'n/a' : v.toFixed(0) + '%'; }, gap: function (d) { return (d >= 0 ? '+' : '') + d.toFixed(0) + ' pts'; } },
    { k: 'lastAch', lbl: 'Sales last month vs Official', f: function (M) { return M.lastAch; }, fmt: function (v) { return v == null ? 'n/a' : v.toFixed(0) + '%'; }, gap: function (d) { return (d >= 0 ? '+' : '') + d.toFixed(0) + ' pts'; } },
    { k: 'dsh', lbl: 'IQVIA units share change', iq: true, f: function (M, iq) { return iq && iq.shareSUp != null ? iq.shareSU - iq.shareSUp : null; }, fmt: function (v) { return pts(v, 2); }, gap: function (d) { return pts(d, 2); } },
    { k: 'evi', lbl: 'Evolution index (units)', iq: true, launchOut: true, f: function (M, iq) { return iq ? iq.evi : null; }, fmt: function (v) { return v == null ? 'n/a' : String(v); }, gap: function (d) { return (d >= 0 ? '+' : '') + d.toFixed(0); } },
    { k: 'cov', lbl: 'Coverage (last month)', f: function (M) { return M.cov; }, fmt: function (v) { return pct(v, 1); }, gap: function (d) { return pts(d, 1); } },
    { k: 'rf', lbl: 'Right Frequency (last month)', f: function (M) { return M.rf; }, fmt: function (v) { return pct(v, 1); }, gap: function (d) { return pts(d, 1); } },
    { k: 'aRf', lbl: 'A-class Right Frequency', f: function (M) { return M.aRf; }, fmt: function (v) { return pct(v, 0); }, gap: function (d) { return pts(d, 0); } },
    { k: 'cpd', lbl: 'Calls / coaching day', noChcSales: true, f: function (M) { return M.cpd; }, fmt: function (v) { return v == null ? 'n/a' : v.toFixed(1); }, gap: function (d) { return (d >= 0 ? '+' : '') + d.toFixed(1); } },
    { k: 'field', lbl: 'DM field days', f: function (M) { return M.field; }, fmt: function (v) { return pct(v, 0); }, gap: function (d) { return pts(d, 0); } }
  ];
  // Launch-phase line: Zeta IQVIA value more than 4x the comparison period -> its EVI is not comparable, so it is not ranked on EVI.
  var LAUNCH_X = 4;
  function isLaunch(iq) { return !!(iq && iq.zVp != null && (iq.zVp === 0 || iq.zV / iq.zVp > LAUNCH_X)); }
  function lineKeys() { return Object.keys(DATA.entities).filter(function (k) { return k.indexOf('LINE:') === 0; }); }
  // Values of one KPI for every line (CHC_SALES excluded from peers: it mirrors CHC sales and has its own call target).
  function peerVals(kp, onlyBu) {
    var out = [];
    lineKeys().forEach(function (k) {
      var L = DATA.entities[k], l = L.lines[0];
      if (l === 'CHC_SALES') return;
      if (onlyBu && L.bu !== onlyBu) return;
      if (kp.launchOut && isLaunch(iqOf(L))) return;
      var v = kp.f(metrics(L), iqOf(L));
      if (v != null && !isNaN(v)) out.push({ line: l, v: v });
    });
    out.sort(function (a, b) { return b.v - a.v; });
    return out;
  }
  function bestLineHtml(E) {
    if (E.kind !== 'line') return '';
    var l = E.lines[0], M = metrics(E), iq = iqOf(E);
    var h = '<div class="bur-card"><h3>' + esc(l) + ' vs the best line</h3><div class="bur-scroll"><table class="bur-t"><thead><tr><th>KPI</th><th>' + esc(l) + '</th><th>Best line in ' + esc(E.bu) + ' BU</th><th>Best line company-wide</th><th>Gap to company best</th><th>Rank</th></tr></thead><tbody>';
    PEER_KPIS.forEach(function (kp) {
      if (kp.noChcSales && l === 'CHC_SALES') return;
      var v = kp.f(M, iq), all = peerVals(kp), bu = peerVals(kp, E.bu);
      var bA = all[0], bB = bu[0];
      var rank = null; for (var i = 0; i < all.length; i++) if (all[i].line === l) { rank = i + 1; break; }
      var isBest = bA && bA.line === l;
      h += '<tr><td class="bur-ln">' + kp.lbl + (kp.iq ? ' <span class="bur-note">' + iqLbl() + '</span>' : '') + '</td><td><b>' + kp.fmt(v) + '</b></td>' +
        '<td>' + (bB ? kp.fmt(bB.v) + ' <span class="bur-note">' + esc(bB.line) + '</span>' : 'n/a') + '</td>' +
        '<td>' + (bA ? kp.fmt(bA.v) + ' <span class="bur-note">' + esc(bA.line) + '</span>' : 'n/a') + '</td>' +
        '<td class="' + (v == null || !bA ? '' : isBest ? 'bur-pos' : 'bur-neg') + '">' + (v == null || !bA ? 'n/a' : isBest ? '★ best' : kp.gap(v - bA.v)) + '</td>' +
        '<td>' + (rank ? rank + ' of ' + all.length : (l === 'CHC_SALES' || (kp.launchOut && isLaunch(iq))) ? '<span class="bur-note">not ranked</span>' : 'n/a') + '</td></tr>';
    });
    return h + '</tbody></table></div><div class="bur-foot">Peers = all promoted lines except CHC_SALES (it mirrors CHC sales and has its own calls-per-day target). Higher is better for every KPI shown. EVI ranking leaves out launch-phase lines (Zeta IQVIA value more than 4× the comparison period' + (function () { var x = lineKeys().filter(function (k) { return isLaunch(iqOf(DATA.entities[k])); }).map(function (k) { return k.slice(5); }); return x.length ? ': ' + x.join(', ') : ''; })() + ').</div></div>';
  }
  function bestMarks(rows) {
    // KPI key -> line holding the best value among the lines shown in the table
    var marks = {};
    PEER_KPIS.forEach(function (kp) {
      var best = null;
      rows.forEach(function (L) {
        var l = L.lines[0]; if (l === 'CHC_SALES') return;
        if (kp.launchOut && isLaunch(iqOf(L))) return;
        var v = kp.f(metrics(L), iqOf(L));
        if (v != null && !isNaN(v) && (best == null || v > best.v)) best = { l: l, v: v };
      });
      if (best) marks[kp.k] = best.l;
    });
    return marks;
  }
  function star(marks, k, l) { return marks[k] === l ? ' <span class="bur-best" title="Best line in this table">★</span>' : ''; }

  function gapsHtml(E) {
    var g = E.gaps || [];
    if (!g.length) return '';
    return '<div class="bur-card bur-gaps" id="bur-gaps"><h3>Data gaps: what this page cannot show for ' + esc(E.name) + '</h3><ul>' +
      g.map(function (x) { return '<li><span class="bur-gap-a">' + esc(x.area) + '</span>' + esc(x.text) + '</li>'; }).join('') + '</ul></div>';
  }

  // ---- export (Excel via the vendored SheetJS core build; PDF via the browser print dialog)
  function exportXlsx(E) {
    if (!global.XLSX) { alertNote('Excel library not loaded.'); return; }
    var X = global.XLSX, wb = X.utils.book_new(), V = iqView(E), M = metrics(E), meta = DATA.meta, sm = meta.salesMonths;
    var add = function (name, aoa) { var ws = X.utils.aoa_to_sheet(aoa); X.utils.book_append_sheet(wb, ws, name.slice(0, 31)); };
    var r2 = function (v, d) { return v == null || isNaN(v) ? null : +(+v).toFixed(d == null ? 4 : d); };
    var iq = V.iqvia;
    add('Summary', [['BU Business Review', E.name], ['Sales period', sm[0] + ' to ' + sm[sm.length - 1]], ['IQVIA view', iqPeriodTxt()], ['Built', meta.generatedAt], [],
      ['Headline', E.comments.headline], [],
      ['KPI', 'Value', 'Note'],
      ['YTD sales (EGP)', r2(M.ytdA, 0), 'Official target ' + Math.round(M.ytdO)],
      ['YTD achievement %', r2(M.ach, 1), ''],
      ['Last month achievement %', r2(M.lastAch, 1), monLbl(sm[sm.length - 1])],
      ['IQVIA units share %', iq ? r2(100 * iq.shareSU, 2) : null, iq ? 'prior ' + r2(100 * iq.shareSUp, 2) : 'no IQVIA'],
      ['IQVIA value share %', iq ? r2(100 * iq.shareV, 2) : null, iq ? 'prior ' + r2(100 * iq.shareVp, 2) : ''],
      ['Evolution index (units)', iq ? iq.evi : null, ''],
      ['Coverage % (last month)', r2(100 * M.cov, 1), ''], ['Right Frequency % (last month)', r2(100 * M.rf, 1), ''],
      ['Calls / coaching day', r2(M.cpd, 1), ''], ['DM field days %', r2(100 * M.field, 0), ''], ['Resigned YTD', M.resigned, '']]);
    var C = E.comments, cm = [['Section', 'Comment (fact)', 'EGP at stake']];
    [['Went well', C.strengths], ['Needs attention', C.concerns], ['Market (IQVIA)', C.market]].forEach(function (x) { x[1].forEach(function (c) { cm.push([x[0], c.text, c.impact]); }); });
    C.questions.forEach(function (q) { cm.push(['Question', q, null]); });
    add('Comments', cm);
    if (E.kind === 'line') {
      var bl = [['KPI', E.lines[0], 'Best in BU', 'Best in BU line', 'Best company-wide', 'Best line']];
      PEER_KPIS.forEach(function (kp) { var a = peerVals(kp), b = peerVals(kp, E.bu); bl.push([kp.lbl, r2(kp.f(M, iqOf(E))), b[0] ? r2(b[0].v) : null, b[0] ? b[0].line : '', a[0] ? r2(a[0].v) : null, a[0] ? a[0].line : '']); });
      add('Vs best line', bl);
    } else {
      var lt = [['Line', 'YTD sales', 'YTD ach %', 'Last month ach %', 'IQVIA units share chg (pts)', 'EVI', 'Coverage %', 'Right Freq %', 'Calls/coach day', 'DM field days %', 'Resigned YTD']];
      E.lines.forEach(function (l) { var L = DATA.entities['LINE:' + l]; if (!L) return; var m = metrics(L), q = iqOf(L); lt.push([l, r2(m.ytdA, 0), r2(m.ach, 1), r2(m.lastAch, 1), q && q.shareSUp != null ? r2(100 * (q.shareSU - q.shareSUp), 2) : null, q ? q.evi : null, r2(100 * m.cov, 1), r2(100 * m.rf, 1), r2(m.cpd, 1), r2(100 * m.field, 0), m.resigned]); });
      add('Lines', lt);
    }
    var ib = [['Zeta brand', 'Line', 'Market (DM1)', 'Market size', 'Market growth %', 'Brand growth %', 'Value share %', 'Prior share %', 'Units share %', 'EVI', 'Rank', 'Biggest gainer', 'New competitors']];
    (V.iqBrands || []).forEach(function (b) { ib.push([b.name, b.line, b.dm1, r2(b.mktV, 0), r2(100 * b.mktG, 1), r2(100 * b.growth, 1), r2(100 * b.share, 2), r2(100 * b.shareP, 2), r2(100 * b.shareSU, 2), b.evi, b.rank, b.topGainer ? b.topGainer.prod + ' (' + b.topGainer.corp + ')' : '', (b.newEntrants || []).map(function (x) { return x.prod + ' ' + (100 * x.share).toFixed(1) + '%'; }).join('; ')]); });
    add('IQVIA brands ' + iqLbl(), ib);
    if (iq) {
      var co = [['#', 'Company', 'Share %', 'Prior share %', 'Growth %', 'Top products (share % · growth %)']];
      iq.topCorps.forEach(function (c, i) { co.push([i + 1, c.corp, r2(100 * c.share, 2), r2(100 * c.shareP, 2), r2(100 * c.growth, 1), (c.prods || []).map(function (p) { return p.prod + ' ' + (100 * p.share).toFixed(1) + '% · ' + (p.growth == null ? 'new' : (100 * p.growth).toFixed(0) + '%'); }).join('; ')]); });
      co.push([]); co.push(['', 'Gainers / losers', 'Share chg (pts)', '', '', 'Products driving the change (pts)']);
      iq.gainers.concat(iq.losers).forEach(function (c) { co.push(['', c.corp, r2(100 * c.dShare, 2), '', r2(100 * c.growth, 1), (c.prods || []).map(function (p) { return p.prod + ' ' + (100 * p.dShare).toFixed(2); }).join('; ')]); });
      add('Companies ' + iqLbl(), co);
    }
    var so = [['Brand (sales)', 'IQVIA products', 'YTD sell-in', 'YTD in-market', 'Sell-in recent vs base %', 'In-market recent vs base %', 'In-market YTD vs LY %']];
    (E.sellout || []).forEach(function (g) { so.push([g.name, g.iqvia.join(', '), g.ytdSi, g.ytdIm, r2(100 * g.siChg, 1), r2(100 * g.imChg, 1), r2(100 * g.imYoY, 1)]); });
    add('Sell-in vs in-market', so);
    if (E.customers) { var cu = [['Segment', 'Pharmacies', 'YTD value']]; ['Retained', 'Reactivated', 'New', 'Lost', 'Inactive'].forEach(function (k) { cu.push([k, E.customers.counts[k], E.customers.values[k]]); }); add('Customers', cu); }
    var ac = [['ID', 'Scope', 'Action / question', 'Owner', 'Due', 'Status', 'Overdue', 'Update']];
    (E.actions || []).forEach(function (a) { ac.push([a.id, a.scope, a.action, a.owner, a.due, a.status, a.overdue ? 'yes' : '', a.update]); });
    add('Actions', ac);
    var gp = [['Area', 'Data gap']]; (E.gaps || []).forEach(function (x) { gp.push([x.area, x.text]); }); add('Data gaps', gp);
    X.writeFile(wb, 'BU_Review_' + E.name.replace(/[^A-Za-z0-9_-]+/g, '_') + '_' + sm[sm.length - 1] + '_' + iqLbl() + '.xlsx');
  }
  function alertNote(t) { var r = document.getElementById(ROOT_ID); if (r) { var d = document.createElement('div'); d.className = 'bur-empty'; d.textContent = t; r.prepend(d); } }

  function render() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    var E = DATA.entities[currentKey()];
    if (!E) { root.innerHTML = '<div class="bur-root"><div class="bur-empty">No data for this selection.</div></div>'; return; }
    var M = metrics(E), meta = DATA.meta, V = iqView(E);
    var sm = meta.salesMonths, ep = meta.execPeriods;
    var html = '<div class="bur-root">' +
      '<div class="bur-top"><div><h1>BU Business Review <span class="bur-scope">' + esc(E.name) + '</span></h1>' +
      '<div class="bur-sub">YTD ' + monLbl(sm[0]) + '–' + monLbl(sm[sm.length - 1]) + ' 2026 · sales vs Official target (Tender excluded) · ' + iqPeriodTxt() + ' · private SFE challenge notes' + ((E.gaps || []).length ? ' · <a href="#bur-gaps" class="bur-gaplink">Data gaps (' + E.gaps.length + ')</a>' : '') + '</div></div>' + filtersHtml() + '</div>' +
      '<div class="bur-headline">' + esc(E.comments.headline) + '</div>' +
      tilesHtml(V, M) + (isMat() ? '<div class="bur-matnote">IQVIA sections show MAT. Comments, questions and the headline always use YTD.</div>' : '') +
      '<div class="bur-grid2">' +
      '<div class="bur-card"><h3>Monthly sales achievement vs Official target</h3>' + salesChart(E) + '<div class="bur-foot">Dashed line = 100%. Bars coloured: ≥100% on track · 90–99% watch · &lt;90% below.' + (M.supply > 0.01 ? ' Stock shortage explains ' + pct(M.supply) + ' of YTD target.' : '') + '</div></div>' +
      '<div class="bur-card"><h3>Coverage and Right Frequency, ' + ep[0].slice(0, 3) + '–' + ep[ep.length - 1].slice(0, 3) + '</h3>' + execChart(E) + '<div class="bur-legend"><span><i class="bur-sw bur-s1"></i>Coverage (bar 90%)</span><span><i class="bur-sw bur-s2"></i>Right Frequency (bar 80%)</span></div></div>' +
      '</div>' +
      landingHtml(E) + commentsHtml(E) + questionsHtml(E) + actionsHtml(E) + bridgeHtml(E) + lineTableHtml(E) + bestLineHtml(E) + customersHtml(E) + iqBrandsHtml(V) + selloutHtml(E) + landscapeHtml(V) + salesBrandsHtml(E) + gapsHtml(E) +
      '<div class="bur-card bur-method"><h3>How to read this page</h3><ul>' +
      '<li>Every comment is a fact read or computed directly from the data (no interpretations or hypotheses). Comments are ranked by EGP at stake (the grey amount), top 5 shown.</li>' +
      '<li>Sales: Official target, Tender excluded; CHC BU = CHC line (CHC_SALES shown separately). Execution: the Coverage page rule (active reps, sick-leave exempt excluded, prorated frequency). Good execution = Coverage ≥ 90% and Right Frequency &gt; 80%.</li>' +
      '<li>IQVIA: OTHER MARKET excluded; BU/line market = rows tagged to that BU/line (same as the Executive market share card); share headline in units, value alongside; brand market = its main DM1. IQVIA is in-market (sell-out); sales are sell-in. Sell-in vs in-market links sales brands to IQVIA products through Business Review/Brand_IQVIA_Map.xlsx (only Auto and Confirmed links are used).</li>' +
      '<li>IQVIA toggle: YTD = Jan to the latest month vs the same months last year; MAT = the latest 12 months vs the 12 months before. ★ and "vs best line" compare promoted lines (CHC_SALES excluded). Export Excel writes every section of the current view.</li>' +
      '<li>Customer base: pharmacies (chains + retail) from the Customer Health cache; for a BU or line only purchases of its products count. Actions: Business Review/BU_Review_Actions.xlsx.</li>' +
      '<li>Built ' + esc(meta.generatedAt.replace('T', ' ')) + ' by etl/build_business_review_cache.py from the dashboard caches.</li></ul></div>' +
      '</div>';
    root.innerHTML = html;
    wire(root, E);
  }

  function wire(root, E) {
    var fb = root.querySelector('#bur-f-bu'), fl = root.querySelector('#bur-f-line');
    if (fb) fb.addEventListener('change', function () { STATE.bu = fb.value; STATE.line = 'ALL'; STATE.openBrand = null; STATE.showAll = {}; render(); });
    if (fl) fl.addEventListener('change', function () { STATE.line = fl.value; STATE.openBrand = null; if (fl.value !== 'ALL') STATE.bu = DATA.entities['LINE:' + fl.value].bu || STATE.bu; render(); });
    Array.prototype.forEach.call(root.querySelectorAll('tr[data-line]'), function (tr) {
      tr.addEventListener('click', function () { var l = tr.getAttribute('data-line'); STATE.line = l; STATE.bu = DATA.entities['LINE:' + l].bu; STATE.openBrand = null; render(); root.scrollIntoView && window.scrollTo(0, 0); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('tr[data-brand]'), function (tr) {
      tr.addEventListener('click', function () { var b = tr.getAttribute('data-brand'); STATE.openBrand = STATE.openBrand === b ? null : b; render(); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-more]'), function (b) {
      b.addEventListener('click', function () { var c = b.getAttribute('data-more'); STATE.showAll[c] = !STATE.showAll[c]; var y = window.scrollY; render(); window.scrollTo(0, y); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-iq]'), function (b) {
      b.addEventListener('click', function () { STATE.iqMode = b.getAttribute('data-iq'); STATE.openBrand = null; var y = window.scrollY; render(); window.scrollTo(0, y); });
    });
    var xb = root.querySelector('[data-act="xlsx"]'); if (xb) xb.addEventListener('click', function () { exportXlsx(E); });
    var pb = root.querySelector('[data-act="print"]'); if (pb) pb.addEventListener('click', function () {
      STATE.showAll = { st: true, co: true, mk: true, actions: true }; render();
      setTimeout(function () { window.print(); }, 150);
    });
    var cp = root.querySelector('[data-act="copy"]');
    if (cp) cp.addEventListener('click', function () {
      var txt = commentsText(E);
      var done = function () { cp.textContent = 'Copied ✓'; setTimeout(function () { cp.textContent = 'Copy comments'; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt); done(); });
      else { fallbackCopy(txt); done(); }
    });
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { } document.body.removeChild(ta);
  }

  global.BuReviewDashboard = {
    canView: canView,
    init: function (containerId) {
      ROOT_ID = containerId;
      var root = document.getElementById(containerId);
      if (!root) return;
      document.body.classList.add('bu-review-mode');
      if (!canView()) { root.innerHTML = '<div class="bur-root"><div class="bur-empty">Access restricted: the BU Business Review is available to the SFE Manager only.</div></div>'; return; }
      if (!load()) { root.innerHTML = '<div class="bur-root"><div class="bur-empty">Business review data not found. Run etl/build_business_review_cache.py (it is part of refresh.bat).</div></div>'; return; }
      render();
    },
    destroy: function () { document.body.classList.remove('bu-review-mode'); },
    _debug: function () { return { STATE: STATE, DATA: DATA }; }
  };
})(window);
