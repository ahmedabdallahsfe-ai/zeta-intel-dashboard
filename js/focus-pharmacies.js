/**
 * GIT-S FOCUS PHARMACIES — Sales Performance sub-tab (2026-11-05, Ahmed)
 * ============================================================================
 * Data : cache/focus_pharmacies.data.js (window.FOCUS_PHARMACIES_CACHE), built by
 *        etl/build_focus_pharmacies_cache.py from GIT_SALES_SPCEIAL PHARMACIES.xlsx
 *        + the sales sources. Loaded on demand through CacheLoader.
 * Rules (Ahmed 2026-11-05):
 *   - Sales basis  : GIT_SALES line (months before the team started = the same
 *                    GIT_SALES SKU basket bought through GIT-I/II/III, see the ETL).
 *   - Active       : net sales > 0 in the month.
 *   - Repeated     : active in >= 2 months of the selected period.
 *   - Previous     : average month before launch (baseline) vs the selected period.
 *   - Access       : AUTH.canViewFocusPharmacies(); a GIT-S DM / rep whose login
 *                    name matches the list sees only their own pharmacies.
 *   - Best practice: score = average percentile rank of Active %, Repeat %,
 *                    Uplift vs baseline and Sales per active pharmacy; benchmark =
 *                    top-quartile (P75) rep value of each KPI.
 * This tab has its OWN filters (DM, Rep, period); the Sales global filter bar
 * does not apply to it.
 */
(function (global) {
  "use strict";

  var ST = { brand: "all", item: "all", outliers: "exclude", dm: "all", rep: "all", from: null, to: null, status: "all", q: "", sort: "net", lockDm: null, lockRep: null };
  var D = null, root = null, charts = [];
  // Outlier accounts (2026-11-05): a distributor-size account on the list (e.g. one month of
  // EGP -18.5M returns, EGP 36.6M purchases) swamps 4,500 pharmacies averaging ~EGP 3K a month.
  // Any account with a month of |net| >= OUTLIER_EGP is excluded by default (toggle in the filters).
  var OUTLIER_EGP = 1000000, OUT = {};
  // BRAND & ITEM (2026-11-05, Ahmed "include brand and items"): D.items = [item, brandIdx];
  // D.x = flat [pharmacy, month, item, net, qty, returns]. PV / PR / PK / PQ = value, returns,
  // brand bitmask and units per pharmacy x month for the current Brand / Item filter
  // (= D.v / D.r / D.k / D.q when no product filter is set).
  var PV = null, PR = null, PK = null, PQ = null, PKEY = null, XP = null;
  function itemOk(ii) {
    if (ST.item !== "all") return ii === +ST.item;
    if (ST.brand !== "all") return D.items[ii][1] === +ST.brand;
    return true;
  }
  function prepare() {
    var key = ST.brand + "|" + ST.item;
    if (key === PKEY && PV) return;
    PKEY = key;
    if (ST.brand === "all" && ST.item === "all") { PV = D.v; PR = D.r || D.v.map(function (r) { return r.map(function () { return 0; }); }); PK = D.k; PQ = D.q; return; }
    var NM = D.meta.months.length;
    PV = D.ph.map(function () { return new Array(NM).fill(0); }); PR = D.ph.map(function () { return new Array(NM).fill(0); });
    PK = D.ph.map(function () { return new Array(NM).fill(0); }); PQ = D.ph.map(function () { return new Array(NM).fill(0); });
    for (var j = 0; j < D.x.length; j += 6) {
      var p = D.x[j], m = D.x[j + 1], ii = D.x[j + 2];
      if (!itemOk(ii)) continue;
      PV[p][m] += D.x[j + 3]; PQ[p][m] += D.x[j + 4]; PR[p][m] += D.x[j + 5];
      if (D.x[j + 3] > 0) PK[p][m] |= (1 << D.items[ii][1]);
    }
  }
  function productLabel() {
    if (ST.item !== "all") return D.items[+ST.item][0];
    if (ST.brand !== "all") return D.meta.brands[+ST.brand];
    return "All GIT-S products";
  }

  function findOutliers() { OUT = {}; D.v.forEach(function (row, i) { if (row.some(function (v) { return Math.abs(v) >= OUTLIER_EGP; })) OUT[i] = true; }); }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtM(v) { if (v == null || !isFinite(v)) return "n/a"; var a = Math.abs(v); return (a >= 1e6 ? (v / 1e6).toFixed(2) + "M" : a >= 1e3 ? (v / 1e3).toFixed(1) + "K" : Math.round(v).toLocaleString()); }
  function pct(v, d) { return v == null || !isFinite(v) ? "n/a" : v.toFixed(d == null ? 0 : d) + "%"; }
  function monthLabel(m) { var p = String(m).split("-"); var n = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return (n[+p[1] - 1] || m) + "-" + String(p[0]).slice(2); }
  function popcount(x) { var c = 0; while (x) { c += x & 1; x >>>= 1; } return c; }
  function norm(s) { return String(s || "").toUpperCase().replace(/\s+/g, " ").trim(); }

  function canView() { return !!(global.AUTH && typeof global.AUTH.canViewFocusPharmacies === "function" && global.AUTH.canViewFocusPharmacies()); }

  // DM / rep self-scope: a login whose name matches a focus-list DM or rep.
  function applyLock() {
    ST.lockDm = null; ST.lockRep = null;
    var u = global.AUTH && global.AUTH.getValidSessionUser ? global.AUTH.getValidSessionUser() : null;
    if (!u || !u.name) return;
    var n = norm(u.name);
    var dmi = D.dms.findIndex(function (x) { return norm(x) === n; });
    if (dmi >= 0) { ST.lockDm = dmi; ST.dm = dmi; return; }
    var ri = D.reps.findIndex(function (x) { return norm(x.n) === n; });
    if (ri >= 0) { ST.lockRep = ri; ST.rep = ri; ST.dm = D.reps[ri].dm; }
  }

  // ---------------------------------------------------------------- metrics
  function scopePh() {
    var out = [];
    for (var i = 0; i < D.ph.length; i++) {
      var ri = D.ph[i][3], dmi = D.reps[ri].dm;
      if (ST.dm !== "all" && dmi !== +ST.dm) continue;
      if (ST.rep !== "all" && ri !== +ST.rep) continue;
      if (ST.outliers === "exclude" && OUT[i]) continue;
      out.push(i);
    }
    return out;
  }

  function phStats(i, base, per) {
    var v = PV[i], k = PK[i], to = per[per.length - 1], prev = to - 1;
    var b = 0, bAct = 0; base.forEach(function (m) { b += v[m]; if (v[m] > 0) bAct++; });
    var p = 0, act = 0; per.forEach(function (m) { p += v[m]; if (v[m] > 0) act++; });
    return {
      i: i, baseAvg: base.length ? b / base.length : null, baseActive: bAct, perAvg: p / per.length, perNet: p, activeMonths: act,
      activeLast: v[to] > 0, activePrev: prev >= 0 && v[prev] > 0, lastNet: v[to], brandsLast: v[to] > 0 ? popcount(k[to]) : 0
    };
  }

  function status(s) {
    if (s.activeMonths >= 2) return "Repeat";
    if (s.activeMonths === 1) return s.baseActive ? "Active once" : "New";
    return s.baseActive ? "Lapsed" : "Never bought";
  }

  function aggregate(list) {
    var a = { n: list.length, activeLast: 0, ever: 0, repeat: 0, prevAct: 0, retained: 0, baseSum: 0, perSum: 0, lastNet: 0, brands: 0, untapped: 0, lapsed: 0, fresh: 0 };
    list.forEach(function (s) {
      if (s.activeLast) { a.activeLast++; a.lastNet += s.lastNet; a.brands += s.brandsLast; }
      if (s.activeMonths >= 1) a.ever++;
      if (s.activeMonths >= 2) a.repeat++;
      if (s.activePrev) { a.prevAct++; if (s.activeLast) a.retained++; }
      a.baseSum += s.baseAvg || 0; a.perSum += s.perAvg;
      var st = status(s); if (st === "Never bought") a.untapped++; else if (st === "Lapsed") a.lapsed++; else if (st === "New") a.fresh++;
    });
    a.activePct = a.n ? a.activeLast / a.n * 100 : null;
    a.repeatPct = a.n ? a.repeat / a.n * 100 : null;
    a.repeatOfActive = a.ever ? a.repeat / a.ever * 100 : null;
    a.retention = a.prevAct ? a.retained / a.prevAct * 100 : null;
    a.uplift = a.baseSum > 0 ? (a.perSum / a.baseSum - 1) * 100 : null;
    a.salesPerActive = a.activeLast ? a.lastNet / a.activeLast : null;
    a.brandsPerActive = a.activeLast ? a.brands / a.activeLast : null;
    return a;
  }

  function brandsOf(i, R) {
    var mask = 0; R.per.forEach(function (m) { mask |= PK[i][m]; });
    return D.meta.brands.filter(function (b, bi) { return mask & (1 << bi); }).join(" + ");
  }

  // Brand & item table for the DM / Rep / outlier scope (ignores the product filter so every
  // product is listed; the selected brand / item is highlighted).
  function productTable(ids, per, base) {
    var NI = D.items.length, to = per[per.length - 1], pset = {}, bset = {};
    ids.forEach(function (i) { pset[i] = true; });
    var perSet = {}; per.forEach(function (m) { perSet[m] = true; });
    var baseSet = {}; base.forEach(function (m) { baseSet[m] = true; });
    function blank() { return { last: {}, months: {}, perNet: 0, baseNet: 0, qty: 0, first: null }; }
    var it = []; for (var k = 0; k < NI; k++) it.push(blank());
    var br = D.meta.brands.map(blank), tot = blank();
    for (var j = 0; j < D.x.length; j += 6) {
      var p = D.x[j]; if (!pset[p]) continue;
      var m = D.x[j + 1], ii = D.x[j + 2], v = D.x[j + 3], q = D.x[j + 4];
      [it[ii], br[D.items[ii][1]], tot].forEach(function (a) {
        if (perSet[m]) { a.perNet += v; a.qty += q; if (v > 0) { a.months[p] = a.months[p] || {}; a.months[p][m] = (a.months[p][m] || 0) + v; } }
        if (baseSet[m]) a.baseNet += v;
        if (v > 0 && (a.first == null || m < a.first)) a.first = m;
        if (m === to && v > 0) a.last[p] = true;
      });
    }
    function fin(a, name, kind, idx, brandIdx) {
      var rep = 0, buyers = 0;
      Object.keys(a.months).forEach(function (p) { var n = Object.keys(a.months[p]).filter(function (m) { return a.months[p][m] > 0; }).length; if (n >= 1) buyers++; if (n >= 2) rep++; });
      var lastN = Object.keys(a.last).length, perAvg = a.perNet / per.length, baseAvg = base.length ? a.baseNet / base.length : null;
      return { name: name, kind: kind, idx: idx, brand: brandIdx, activeLast: lastN, activePct: ids.length ? lastN / ids.length * 100 : null, buyers: buyers, repeat: rep,
        perNet: a.perNet, perAvg: perAvg, baseAvg: baseAvg, uplift: baseAvg > 0 ? (perAvg / baseAvg - 1) * 100 : null, qty: a.qty, share: tot.perNet ? a.perNet / tot.perNet * 100 : null,
        late: a.first != null && base.length && a.first > base[0] ? a.first : null };
    }
    var rows = [];
    D.meta.brands.map(function (b, bi) { return fin(br[bi], b, "brand", bi, bi); }).sort(function (a, b) { return b.perNet - a.perNet; }).forEach(function (b) {
      rows.push(b);
      D.items.map(function (x, ii) { return { x: x, ii: ii }; }).filter(function (o) { return o.x[1] === b.idx; })
        .map(function (o) { return fin(it[o.ii], o.x[0], "item", o.ii, b.idx); }).sort(function (a, c) { return c.perNet - a.perNet; })
        .forEach(function (r) { rows.push(r); });
    });
    return { rows: rows, total: fin(tot, "All GIT-S products", "total", null, null) };
  }

  function percentile(arr, p) {
    var x = arr.filter(function (v) { return v != null && isFinite(v); }).sort(function (a, b) { return a - b; });
    if (!x.length) return null; var idx = (x.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    return x[lo] + (x[hi] - x[lo]) * (idx - lo);
  }
  function pctRank(arr, v) {
    var x = arr.filter(function (z) { return z != null && isFinite(z); }); if (v == null || !x.length) return 0;
    var below = x.filter(function (z) { return z < v; }).length, eq = x.filter(function (z) { return z === v; }).length;
    return (below + 0.5 * eq) / x.length * 100;
  }

  function compute() {
    prepare();
    var M = D.meta.months, L = M.length;
    var from = ST.from == null ? M.indexOf(D.meta.launchMonth) : ST.from, to = ST.to == null ? L - 1 : ST.to;
    if (from < 0) from = 0; if (to < from) to = from;
    var per = []; for (var m = from; m <= to; m++) per.push(m);
    var base = []; D.meta.baselineMonths.forEach(function (bm) { var j = M.indexOf(bm); if (j >= 0 && j < from) base.push(j); });
    var ids = scopePh();
    var stats = ids.map(function (i) { return phStats(i, base, per); });
    var byRep = {}, byDm = {};
    stats.forEach(function (s) {
      var ri = D.ph[s.i][3], dmi = D.reps[ri].dm;
      (byRep[ri] = byRep[ri] || []).push(s); (byDm[dmi] = byDm[dmi] || []).push(s);
    });
    var reps = Object.keys(byRep).map(function (ri) { var a = aggregate(byRep[ri]); a.ri = +ri; return a; });
    var dms = Object.keys(byDm).map(function (d) { var a = aggregate(byDm[d]); a.dmi = +d; return a; });
    // Best practice score + P75 benchmark across the reps in scope
    var K = ["activePct", "repeatPct", "uplift", "salesPerActive"];
    var bench = {}; K.forEach(function (k) { bench[k] = percentile(reps.map(function (r) { return r[k]; }), 0.75); });
    reps.forEach(function (r) {
      r.score = K.reduce(function (s, k) { return s + pctRank(reps.map(function (x) { return x[k]; }), r[k]); }, 0) / K.length;
      r.gapActive = bench.activePct != null && r.activePct != null ? Math.max(0, Math.ceil(bench.activePct / 100 * r.n - r.activeLast)) : 0;
      r.gapValue = r.gapActive * (r.salesPerActive || 0);
    });
    reps.sort(function (a, b) { return b.score - a.score; });
    reps.forEach(function (r, i) { r.rank = i + 1; });
    // monthly trend (scope, all months)
    var trend = M.map(function (mm, j) {
      var act = 0, net = 0, ret = 0, again = 0, prevA = 0;
      ids.forEach(function (i) {
        var v = PV[i][j]; net += v; ret += PR[i][j]; if (v > 0) act++;
        if (j > 0 && PV[i][j - 1] > 0) { prevA++; if (v > 0) again++; }
      });
      return { m: mm, active: act, net: net, returns: ret, activePct: ids.length ? act / ids.length * 100 : 0, retention: prevA ? again / prevA * 100 : null, src: D.meta.monthSource[mm] };
    });
    return { prod: productTable(ids, per, base), from: from, to: to, per: per, base: base, stats: stats, total: aggregate(stats), reps: reps, dms: dms, bench: bench, trend: trend };
  }

  // ---------------------------------------------------------------- render
  function kpi(label, val, sub, color) {
    return '<div class="sc-kpi-card"' + (color ? ' style="border-top-color:' + color + ';"' : "") + '><div class="sc-kpi-label">' + label + '</div><div class="sc-kpi-value"' + (color ? ' style="color:' + color + ';"' : "") + ">" + val + '</div><div class="sc-kpi-sub">' + sub + "</div></div>";
  }
  var CARD = 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin-bottom:16px;';
  var TH = 'padding:6px 8px;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;white-space:nowrap;';
  var TD = 'padding:7px 8px;font-size:11px;border-bottom:1px solid #f1f5f9;white-space:nowrap;';
  function upColor(v) { return v == null ? "#64748b" : v >= 0 ? "#15803d" : "#b91c1c"; }

  function filtersHTML(R) {
    var M = D.meta.months;
    var dmOpts = '<option value="all">All DMs</option>' + D.dms.map(function (d, i) { return '<option value="' + i + '"' + (String(ST.dm) === String(i) ? " selected" : "") + ">" + esc(d) + "</option>"; }).join("");
    var repOpts = '<option value="all">All reps</option>' + D.reps.map(function (r, i) { return { r: r, i: i }; })
      .filter(function (x) { return ST.dm === "all" || x.r.dm === +ST.dm; })
      .map(function (x) { return '<option value="' + x.i + '"' + (String(ST.rep) === String(x.i) ? " selected" : "") + ">" + esc(x.r.n) + "</option>"; }).join("");
    function mOpts(sel) { return M.map(function (m, i) { return '<option value="' + i + '"' + (i === sel ? " selected" : "") + ">" + monthLabel(m) + (D.meta.monthSource[m] === "GIT_SALES" ? "" : " (pre-launch)") + "</option>"; }).join(""); }
    var S = 'padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;background:#fff;';
    return '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px;">' +
      '<label style="font-size:10px;font-weight:700;color:#64748b;">DM<br><select id="fph-dm" style="' + S + '"' + (ST.lockDm != null || ST.lockRep != null ? " disabled" : "") + ">" + dmOpts + "</select></label>" +
      '<label style="font-size:10px;font-weight:700;color:#64748b;">REP<br><select id="fph-rep" style="' + S + '"' + (ST.lockRep != null ? " disabled" : "") + ">" + repOpts + "</select></label>" +
      '<label style="font-size:10px;font-weight:700;color:#64748b;">BRAND<br><select id="fph-brand" style="' + S + '"><option value="all">All brands</option>' + D.meta.brands.map(function (b, i) { return '<option value="' + i + '"' + (String(ST.brand) === String(i) ? " selected" : "") + ">" + esc(b) + "</option>"; }).join("") + "</select></label>" +
      '<label style="font-size:10px;font-weight:700;color:#64748b;">ITEM<br><select id="fph-item" style="' + S + 'max-width:240px;"><option value="all">All items</option>' + D.items.map(function (x, i) { return { x: x, i: i }; }).filter(function (o) { return ST.brand === "all" || o.x[1] === +ST.brand; }).map(function (o) { return '<option value="' + o.i + '"' + (String(ST.item) === String(o.i) ? " selected" : "") + ">" + esc(o.x[0]) + "</option>"; }).join("") + "</select></label>" +
      '<label style="font-size:10px;font-weight:700;color:#64748b;">OUTLIER ACCOUNTS<br><select id="fph-out" style="' + S + '"><option value="exclude"' + (ST.outliers === "exclude" ? " selected" : "") + '>Exclude (' + Object.keys(OUT).length + ')</option><option value="include"' + (ST.outliers === "include" ? " selected" : "") + ">Include</option></select></label>" +
      '<label style="font-size:10px;font-weight:700;color:#64748b;">PERIOD FROM<br><select id="fph-from" style="' + S + '">' + mOpts(R.from) + "</select></label>" +
      '<label style="font-size:10px;font-weight:700;color:#64748b;">TO<br><select id="fph-to" style="' + S + '">' + mOpts(R.to) + "</select></label>" +
      '<div style="font-size:11px;color:#64748b;max-width:520px;line-height:1.4;">Own filters: the Sales filter bar above does not apply here. Baseline = average month ' +
      (R.base.length ? monthLabel(D.meta.months[R.base[0]]) + "–" + monthLabel(D.meta.months[R.base[R.base.length - 1]]) : "(none before the period)") + ".</div></div>";
  }

  function render() {
    if (!root) return;
    var R = compute(), T = R.total, M = D.meta.months, toM = monthLabel(M[R.to]);
    var perLabel = R.per.length === 1 ? toM : monthLabel(M[R.from]) + "–" + toM;
    var h = '<div class="fph">';
    h += '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:10px;"><h2 style="font-size:16px;font-weight:800;color:#0f172a;margin:0;">GIT-S Focus Pharmacies <span style="font-size:12px;font-weight:600;color:#0f6cbd;">· ' + esc(productLabel()) + '</span></h2>' +
      '<span style="font-size:11px;color:#64748b;">' + D.meta.listRows.toLocaleString() + ' target pharmacies · ' + esc(D.meta.listFile) + ' · built ' + esc(D.meta.generated) + "</span></div>";
    h += filtersHTML(R);
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px;">' +
      kpi("FOCUS PHARMACIES", T.n.toLocaleString(), "Assigned in this scope") +
      kpi("ACTIVE · " + toM, T.activeLast.toLocaleString(), pct(T.activePct) + " of the list bought", "#0f6cbd") +
      kpi("REPEATED · " + perLabel, T.repeat.toLocaleString(), R.per.length < 2 ? "Needs a period of 2+ months" : pct(T.repeatPct) + " of list · " + pct(T.repeatOfActive) + " of buyers", "#7c3aed") +
      kpi("BOUGHT AGAIN", pct(T.retention), "Active last month and again in " + toM) +
      kpi("AVG MONTH · PERIOD", "EGP " + fmtM(T.perSum), "Baseline EGP " + fmtM(T.baseSum) + " / month") +
      kpi("VS BASELINE", T.uplift == null ? "n/a" : (T.uplift >= 0 ? "+" : "") + pct(T.uplift, 1), "Period avg month vs pre-launch avg", upColor(T.uplift)) +
      kpi("SALES / ACTIVE PHARMACY", "EGP " + fmtM(T.salesPerActive), pct(T.brandsPerActive == null ? null : T.brandsPerActive, 1).replace("%", "") + " brands per active pharmacy") +
      kpi("NOT BUYING", (T.untapped + T.lapsed).toLocaleString(), T.lapsed.toLocaleString() + " lapsed · " + T.untapped.toLocaleString() + " never bought", "#b45309") +
      "</div>";
    // trend
    h += '<div style="' + CARD + '"><h3 style="font-size:13px;font-weight:700;margin:0 0 10px;">Monthly trend — active pharmacies and net sales</h3>' +
      '<div style="height:260px;position:relative;"><canvas id="fph-trend"></canvas></div>' +
      '<div style="overflow-x:auto;margin-top:10px;"><table style="width:100%;border-collapse:collapse;"><thead><tr><th style="' + TH + 'text-align:left;">Month</th>' +
      R.trend.map(function (t) { return '<th style="' + TH + 'text-align:right;">' + monthLabel(t.m) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      row("Active pharmacies", function (t) { return t.active.toLocaleString(); }) +
      row("Active %", function (t) { return pct(t.activePct); }) +
      row("Bought again %", function (t) { return pct(t.retention); }) +
      row("Net sales (EGP)", function (t) { return fmtM(t.net); }) +
      row("of which returns", function (t) { return t.returns ? fmtM(t.returns) : "–"; }) +
      row("Source", function (t) { return t.src === "GIT_SALES" ? "GIT_SALES" : "GIT lines"; }) +
      "</tbody></table></div></div>";
    function row(lbl, f) { return '<tr><td style="' + TD + 'font-weight:700;">' + lbl + "</td>" + R.trend.map(function (t) { return '<td style="' + TD + 'text-align:right;">' + f(t) + "</td>"; }).join("") + "</tr>"; }

    // brand & item performance
    var P = R.prod, sel = function (r) { return (r.kind === "brand" && ST.item === "all" && String(ST.brand) === String(r.idx)) || (r.kind === "item" && String(ST.item) === String(r.idx)); };
    h += '<div style="' + CARD + '"><h3 style="font-size:13px;font-weight:700;margin:0 0 4px;">Brand & item performance — ' + perLabel + '</h3><div style="font-size:11px;color:#64748b;margin-bottom:10px;">For the DM / rep scope above; click a brand or item to filter the whole tab. Active = pharmacies buying it in ' + toM + ' · Repeat = buying it in 2+ months of the period.</div>' +
      '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr>' +
      ["Brand / item", "Active " + toM, "% of list", "Buyers in period", "Repeat buyers", "Period sales", "Avg / month", "Baseline / mo", "Vs baseline", "Units", "Share"].map(function (c, i) { return '<th style="' + TH + (i ? "text-align:right;" : "text-align:left;") + '">' + c + "</th>"; }).join("") + "</tr></thead><tbody>" +
      P.rows.concat([P.total]).map(function (r) {
        var isB = r.kind === "brand", isT = r.kind === "total", on = sel(r);
        return '<tr class="' + (isT ? "" : "fph-prod") + '" data-kind="' + r.kind + '" data-idx="' + r.idx + '" style="' + (isT ? "" : "cursor:pointer;") + (on ? "background:#dbeafe;" : isB ? "background:#f8fafc;" : isT ? "background:#f1f5f9;" : "") + '">' +
          '<td style="' + TD + (isB || isT ? "font-weight:800;" : "padding-left:24px;color:#334155;") + '">' + esc(r.name) + "</td>" +
          numTd(r.activeLast.toLocaleString()) + numTd(pct(r.activePct)) + numTd(r.buyers.toLocaleString()) + numTd(R.per.length < 2 ? "–" : r.repeat.toLocaleString()) + numTd(fmtM(r.perNet)) + numTd(fmtM(r.perAvg)) + numTd(fmtM(r.baseAvg)) +
          numTd((r.uplift == null ? "n/a" : (r.uplift >= 0 ? "+" : "") + pct(r.uplift, 1)) + (r.late != null ? ' <span style="font-size:9px;color:#94a3b8;font-weight:400;" title="No sales before this month, so the baseline average includes zero months">since ' + monthLabel(D.meta.months[r.late]) + "</span>" : ""), upColor(r.uplift)) + numTd(Math.round(r.qty).toLocaleString()) + numTd(pct(r.share, 1)) + "</tr>";
      }).join("") + "</tbody></table></div></div>";

    // best practice
    var reps = R.reps, top = reps.slice(0, 3), B = R.bench;
    h += '<div style="' + CARD + '"><h3 style="font-size:13px;font-weight:700;margin:0 0 4px;">Best practice — ' + perLabel + "</h3>" +
      '<div style="font-size:11px;color:#64748b;margin-bottom:10px;">Score = average percentile rank of Active %, Repeat %, vs-baseline growth and sales per active pharmacy across the ' + reps.length + " reps in scope. Benchmark = top-quartile rep (P75).</div>";
    if (reps.length >= 2) {
      h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px;">' + top.map(function (r, i) {
        return '<div style="border:1px solid ' + (i === 0 ? "#86efac" : "#e2e8f0") + ';background:' + (i === 0 ? "#f0fdf4" : "#f8fafc") + ';border-radius:10px;padding:12px;">' +
          '<div style="font-size:10px;font-weight:800;color:#15803d;">#' + (i + 1) + " BEST PRACTICE · score " + r.score.toFixed(0) + '</div><div style="font-size:13px;font-weight:700;margin:4px 0;">' + esc(D.reps[r.ri].n) + '</div>' +
          '<div style="font-size:11px;color:#475569;">' + esc(D.reps[r.ri].terr) + " · DM " + esc(D.dms[D.reps[r.ri].dm]) + '</div><div style="font-size:11px;margin-top:6px;line-height:1.6;">Active ' + pct(r.activePct) + " · Repeat " + pct(r.repeatPct) +
          "<br>Vs baseline " + (r.uplift == null ? "n/a" : (r.uplift >= 0 ? "+" : "") + pct(r.uplift, 1)) + " · EGP " + fmtM(r.salesPerActive) + " / active pharmacy</div></div>";
      }).join("") + "</div>";
      h += '<div style="font-size:11px;background:#eff6ff;border-radius:8px;padding:10px;margin-bottom:10px;">Benchmark (P75): Active ' + pct(B.activePct) + " · Repeat " + pct(B.repeatPct) + " · Vs baseline " + pct(B.uplift, 1) + " · EGP " + fmtM(B.salesPerActive) + " per active pharmacy. " +
        "If every rep below the benchmark reached its Active %: <b>+" + reps.reduce(function (s, r) { return s + r.gapActive; }, 0).toLocaleString() + " active pharmacies ≈ EGP " + fmtM(reps.reduce(function (s, r) { return s + r.gapValue; }, 0)) + " a month</b> at each rep's own sales per active pharmacy.</div>";
    } else h += '<div style="font-size:12px;color:#64748b;">Best practice needs at least 2 reps in scope — clear the Rep filter.</div>';
    h += "</div>";

    // rep table
    h += '<div style="' + CARD + '"><h3 style="font-size:13px;font-weight:700;margin:0 0 10px;">Reps — click a rep to filter</h3><div style="overflow-x:auto;max-height:460px;"><table style="width:100%;border-collapse:collapse;"><thead><tr>' +
      ["Rank", "Rep", "Territory", "DM", "Pharmacies", "Active " + toM, "Active %", "Repeat %", "Bought again", "Baseline / mo", "Period / mo", "Vs baseline", "EGP / active", "Gap to P75", "Score"].map(function (c, i) { return '<th style="' + TH + (i > 3 ? "text-align:right;" : "text-align:left;") + '">' + c + "</th>"; }).join("") + "</tr></thead><tbody>" +
      reps.map(function (r) {
        var rr = D.reps[r.ri], best = r.rank <= 3 && reps.length >= 4;
        return '<tr class="fph-rep" data-ri="' + r.ri + '" style="cursor:pointer;' + (best ? "background:#f0fdf4;" : "") + '"><td style="' + TD + '">' + r.rank + '</td><td style="' + TD + 'font-weight:700;">' + esc(rr.n) + '</td><td style="' + TD + '">' + esc(rr.terr) + '</td><td style="' + TD + '">' + esc(D.dms[rr.dm]) + "</td>" +
          numTd(r.n.toLocaleString()) + numTd(r.activeLast.toLocaleString()) + numTd(pct(r.activePct)) + numTd(pct(r.repeatPct)) + numTd(pct(r.retention)) + numTd(fmtM(r.baseSum)) + numTd(fmtM(r.perSum)) +
          numTd(r.uplift == null ? "n/a" : (r.uplift >= 0 ? "+" : "") + pct(r.uplift, 1), upColor(r.uplift)) + numTd(fmtM(r.salesPerActive)) + numTd(r.gapActive ? "+" + r.gapActive + " ph." : "–") + numTd(r.score.toFixed(0)) + "</tr>";
      }).join("") + "</tbody></table></div></div>";
    function numTd(v, c) { return '<td style="' + TD + 'text-align:right;' + (c ? "color:" + c + ";font-weight:700;" : "") + '">' + v + "</td>"; }

    // DM table
    var dms = R.dms.slice().sort(function (a, b) { return (b.activePct || 0) - (a.activePct || 0); });
    h += '<div style="' + CARD + '"><h3 style="font-size:13px;font-weight:700;margin:0 0 10px;">District managers</h3><div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr>' +
      ["DM", "Reps", "Pharmacies", "Active " + toM, "Active %", "Repeat %", "Bought again", "Baseline / mo", "Period / mo", "Vs baseline", "EGP / active"].map(function (c, i) { return '<th style="' + TH + (i ? "text-align:right;" : "text-align:left;") + '">' + c + "</th>"; }).join("") + "</tr></thead><tbody>" +
      dms.map(function (d) {
        var nr = D.reps.filter(function (r) { return r.dm === d.dmi; }).length;
        return '<tr class="fph-dmrow" data-dmi="' + d.dmi + '" style="cursor:pointer;"><td style="' + TD + 'font-weight:700;">' + esc(D.dms[d.dmi]) + "</td>" + numTd(nr) + numTd(d.n.toLocaleString()) + numTd(d.activeLast.toLocaleString()) + numTd(pct(d.activePct)) + numTd(pct(d.repeatPct)) + numTd(pct(d.retention)) +
          numTd(fmtM(d.baseSum)) + numTd(fmtM(d.perSum)) + numTd(d.uplift == null ? "n/a" : (d.uplift >= 0 ? "+" : "") + pct(d.uplift, 1), upColor(d.uplift)) + numTd(fmtM(d.salesPerActive)) + "</tr>";
      }).join("") + "</tbody></table></div></div>";

    // pharmacy list
    var STS = ["all", "Repeat", "Active once", "New", "Lapsed", "Never bought"];
    var q = norm(ST.q), list = R.stats.filter(function (s) {
      if (ST.status !== "all" && status(s) !== ST.status) return false;
      if (q) { var p = D.ph[s.i]; if (norm(p[1] + " " + p[0] + " " + p[2] + " " + D.reps[p[3]].n).indexOf(q) < 0) return false; }
      return true;
    });
    var sorters = { net: function (a, b) { return b.perNet - a.perNet; }, base: function (a, b) { return (b.baseAvg || 0) - (a.baseAvg || 0); }, months: function (a, b) { return b.activeMonths - a.activeMonths || b.perNet - a.perNet; } };
    list.sort(sorters[ST.sort] || sorters.net);
    var counts = {}; R.stats.forEach(function (s) { var k = status(s); counts[k] = (counts[k] || 0) + 1; });
    h += '<div style="' + CARD + '"><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px;"><h3 style="font-size:13px;font-weight:700;margin:0;">Pharmacies (' + list.length.toLocaleString() + ")</h3>" +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + STS.map(function (s) { var on = ST.status === s; return '<button class="fph-st" data-st="' + s + '" style="padding:4px 10px;border-radius:14px;border:1px solid ' + (on ? "#0f4c81" : "#cbd5e1") + ";background:" + (on ? "#0f4c81" : "#fff") + ";color:" + (on ? "#fff" : "#334155") + ';font-size:11px;cursor:pointer;">' + (s === "all" ? "All" : s) + (s === "all" ? "" : " " + (counts[s] || 0).toLocaleString()) + "</button>"; }).join("") + "</div>" +
      '<div style="display:flex;gap:6px;"><input id="fph-q" placeholder="Search pharmacy / code / area / rep" value="' + esc(ST.q) + '" style="padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;width:230px;">' +
      '<select id="fph-sort" style="padding:6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;"><option value="net"' + (ST.sort === "net" ? " selected" : "") + '>Sort: period sales</option><option value="base"' + (ST.sort === "base" ? " selected" : "") + '>Sort: baseline</option><option value="months"' + (ST.sort === "months" ? " selected" : "") + '>Sort: active months</option></select>' +
      '<button id="fph-csv" class="sc-action-btn" style="padding:6px 10px;">⬇ CSV</button></div></div>' +
      '<div style="overflow-x:auto;max-height:520px;"><table style="width:100%;border-collapse:collapse;"><thead><tr>' +
      ["Code", "Pharmacy", "Area", "Rep", "Status", "Brands in period", "Baseline / mo", "Active months", "Period sales"].concat(M.map(monthLabel)).map(function (c, i) { return '<th style="' + TH + (i > 5 ? "text-align:right;" : "text-align:left;") + 'position:sticky;top:0;background:#fff;">' + c + "</th>"; }).join("") + "</tr></thead><tbody>" +
      list.slice(0, 300).map(function (s) {
        var p = D.ph[s.i], st = status(s), col = { Repeat: "#15803d", "Active once": "#0f6cbd", New: "#7c3aed", Lapsed: "#b45309", "Never bought": "#94a3b8" }[st];
        return '<tr><td style="' + TD + '">' + esc(p[0]) + '</td><td style="' + TD + 'direction:rtl;text-align:left;">' + esc(p[1]) + '</td><td style="' + TD + '">' + esc(p[2]) + '</td><td style="' + TD + '">' + esc(D.reps[p[3]].n) + '</td><td style="' + TD + "color:" + col + ';font-weight:700;">' + st + '</td><td style="' + TD + 'font-size:10px;color:#475569;">' + esc(brandsOf(s.i, R)) + "</td>" +
          numTd(fmtM(s.baseAvg)) + numTd(s.activeMonths + " / " + R.per.length) + numTd(fmtM(s.perNet)) +
          PV[s.i].map(function (v, j) { var inP = j >= R.from && j <= R.to; return '<td style="' + TD + "text-align:right;" + (inP ? "background:#f8fafc;" : "") + (v < 0 ? "color:#b91c1c;" : v > 0 ? "" : "color:#cbd5e1;") + '">' + (v ? fmtM(v) : "·") + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>" + (list.length > 300 ? '<div style="font-size:11px;color:#64748b;margin-top:6px;">Showing the first 300 — CSV has all ' + list.length.toLocaleString() + ".</div>" : "") + "</div>";

    // notes
    var notes = [];
    notes.push("Active = net sales above 0 in the month · Repeated = active in 2+ months of the selected period · Bought again = active last month and again this month.");
    notes.push("Sales = GIT_SALES line from " + monthLabel(D.meta.launchMonth) + ". Earlier months = the same GIT_SALES SKU basket bought through GIT-I/II/III (GIT_SALES mirrors those lines" +
      Object.keys(D.meta.reconciliation).map(function (m) { var r = D.meta.reconciliation[m]; return "; " + monthLabel(m) + " check: GIT_SALES EGP " + fmtM(r.gitSales) + " vs GIT lines EGP " + fmtM(r.gitLinesBasket); }).join("") + ").");
    var outs = Object.keys(OUT).map(Number);
    if (outs.length) notes.push("<b>Outlier accounts " + (ST.outliers === "exclude" ? "excluded" : "included") + "</b> (a month of net sales or returns of EGP " + fmtM(OUTLIER_EGP) + " or more): " + outs.map(function (i) { var p = D.ph[i]; return esc(p[0]) + " " + esc(p[1]) + " (" + esc(D.reps[p[3]].n) + ", total EGP " + fmtM(D.v[i].reduce(function (a, b) { return a + b; }, 0)) + ")"; }).join("; ") + ".");
    (D.meta.largeReturns || []).forEach(function (b) { notes.push("<b>Large return:</b> " + esc(b.cid) + " " + esc(b.name) + " — " + monthLabel(b.month) + " returns EGP " + fmtM(b.returns) + " (net " + fmtM(b.net) + "). It pulls net sales down; check whether this account belongs on the focus list."); });
    if (D.meta.bookedByOtherRep) notes.push(D.meta.bookedByOtherRep.toLocaleString() + " pharmacies had GIT_SALES booked under a different rep than the one assigned in the list; this tab always credits the assigned rep.");
    h += '<div style="font-size:11px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;line-height:1.6;">' + notes.map(function (n) { return "• " + n; }).join("<br>") + "</div>";
    h += "</div>";
    root.innerHTML = h;
    bind(R, list);
    drawTrend(R);
  }

  function drawTrend(R) {
    charts.forEach(function (c) { try { c.destroy(); } catch (e) { } }); charts = [];
    var el = document.getElementById("fph-trend"); if (!el || !global.Chart) return;
    charts.push(new global.Chart(el, {
      data: {
        labels: R.trend.map(function (t) { return monthLabel(t.m); }),
        datasets: [
          { type: "bar", label: "Net sales (EGP)", data: R.trend.map(function (t) { return Math.round(t.net); }), yAxisID: "y", backgroundColor: R.trend.map(function (t, j) { return t.src === "GIT_SALES" ? "#0f4c81" : "#94a3b8"; }), borderRadius: 4 },
          { type: "line", label: "Active pharmacies", data: R.trend.map(function (t) { return t.active; }), yAxisID: "y1", borderColor: "#16a34a", backgroundColor: "#16a34a", tension: 0.25, pointRadius: 3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
        scales: { y: { position: "left", ticks: { callback: function (v) { return fmtM(v); }, font: { size: 10 } } }, y1: { position: "right", grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } }
      }
    }));
  }

  function bind(R, list) {
    function on(id, ev, f) { var e = document.getElementById(id); if (e) e.addEventListener(ev, f); }
    on("fph-dm", "change", function (e) { ST.dm = e.target.value === "all" ? "all" : +e.target.value; ST.rep = "all"; render(); });
    on("fph-rep", "change", function (e) { ST.rep = e.target.value === "all" ? "all" : +e.target.value; render(); });
    on("fph-from", "change", function (e) { ST.from = +e.target.value; if (ST.to != null && ST.to < ST.from) ST.to = ST.from; render(); });
    on("fph-to", "change", function (e) { ST.to = +e.target.value; if (ST.from == null) ST.from = Math.min(ST.to, D.meta.months.indexOf(D.meta.launchMonth)); if (ST.from > ST.to) ST.from = ST.to; render(); });
    on("fph-brand", "change", function (e) { ST.brand = e.target.value === "all" ? "all" : +e.target.value; ST.item = "all"; render(); });
    on("fph-item", "change", function (e) { ST.item = e.target.value === "all" ? "all" : +e.target.value; if (ST.item !== "all") ST.brand = D.items[ST.item][1]; render(); });
    root.querySelectorAll(".fph-prod").forEach(function (tr) { tr.addEventListener("click", function () {
      var k = tr.dataset.kind, i = +tr.dataset.idx;
      if (k === "brand") { ST.brand = (ST.brand === i && ST.item === "all") ? "all" : i; ST.item = "all"; }
      else if (k === "item") { if (ST.item === i) { ST.item = "all"; } else { ST.item = i; ST.brand = D.items[i][1]; } }
      render(); }); });
    on("fph-out", "change", function (e) { ST.outliers = e.target.value; render(); });
    on("fph-sort", "change", function (e) { ST.sort = e.target.value; render(); });
    var qt = null; on("fph-q", "input", function (e) { clearTimeout(qt); var v = e.target.value; qt = setTimeout(function () { ST.q = v; render(); var i = document.getElementById("fph-q"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 300); });
    root.querySelectorAll(".fph-st").forEach(function (b) { b.addEventListener("click", function () { ST.status = b.dataset.st; render(); }); });
    root.querySelectorAll(".fph-rep").forEach(function (tr) { tr.addEventListener("click", function () { if (ST.lockRep != null) return; var ri = +tr.dataset.ri; ST.rep = ST.rep === ri ? "all" : ri; if (ST.rep !== "all" && ST.lockDm == null) ST.dm = D.reps[ri].dm; render(); }); });
    root.querySelectorAll(".fph-dmrow").forEach(function (tr) { tr.addEventListener("click", function () { if (ST.lockDm != null || ST.lockRep != null) return; var d = +tr.dataset.dmi; ST.dm = ST.dm === d ? "all" : d; ST.rep = "all"; render(); }); });
    on("fph-csv", "click", function () {
      var M = D.meta.months, rows = [["Code", "Pharmacy", "Area", "Rep", "Territory", "DM", "Status", "Baseline avg/month", "Active months in period", "Period net sales", "Brands bought in period"].concat(M)];
      list.forEach(function (s) { var p = D.ph[s.i], r = D.reps[p[3]]; rows.push([p[0], p[1], p[2], r.n, r.terr, D.dms[r.dm], status(s), Math.round(s.baseAvg || 0), s.activeMonths, Math.round(s.perNet), brandsOf(s.i, R)].concat(PV[s.i])); });
      var csv = "﻿" + rows.map(function (r) { return r.map(function (c) { c = String(c == null ? "" : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\n");
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "git_s_focus_pharmacies_" + M[R.to] + ".csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
  }

  async function mount(el) {
    root = el; if (!root) return;
    if (!canView()) { root.innerHTML = '<div style="padding:24px;color:#64748b;">Focus Pharmacies is available to SFE, senior management and GIT BU users.</div>'; return; }
    if (!global.FOCUS_PHARMACIES_CACHE && global.CacheLoader) { root.innerHTML = '<div style="padding:24px;color:#64748b;">Loading focus pharmacies…</div>'; await global.CacheLoader.ensure("focus_pharmacies"); }
    if (!global.FOCUS_PHARMACIES_CACHE) { root.innerHTML = '<div style="padding:24px;color:#b91c1c;">Focus pharmacies data not found. Run UPDATE_DASHBOARD (step focus_pharmacies) or python etl\\build_focus_pharmacies_cache.py.</div>'; return; }
    if (D !== global.FOCUS_PHARMACIES_CACHE) { D = global.FOCUS_PHARMACIES_CACHE; ST.from = null; ST.to = null; PKEY = null; PV = null; findOutliers(); applyLock(); }
    if (root !== el || !document.body.contains(root)) return;
    render();
  }

  global.FocusPharmacies = { mount: mount, canView: canView, _compute: function () { return compute(); }, _setData: function (d) { D = d; PKEY = null; PV = null; findOutliers(); applyLock(); }, _st: ST };
})(window);
