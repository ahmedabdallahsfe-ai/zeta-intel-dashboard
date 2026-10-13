/* market-dynamics.js — Market Dynamics & Treatment Shift. Added 2026-10-13 (Ahmed).
   2026-10-13 (Ahmed): SOURCE = TOTAL MARKET INTELLIGENCE (same IMS cube as that page): every ATC4 and therapeutic area,
   annual 2022–2025 + H1 2026, measured in packs (IMS units) with a switch to LC Value. The FY2027 outlook stays in its own
   panel in IQVIA Standard Units (champion forecast, unchanged).
   Data: window.MARKET_DYNAMICS_CACHE (cache/market_dynamics.data.js, `etl/build_market_dynamics.py --cache`).
   Opened from the sidebar (app.js renderMarketDynamicsTab), SFE / BEX roles only (auth.js canViewMarketDynamics).
   Every number is computed in the ETL; this file only displays it. Ids prefixed "md-", CSS scoped to .mdx. */
(function (global) {
  'use strict';

  function decode(name) {
    var c = global[name || 'MARKET_DYNAMICS_CACHE'];
    if (!c || !c.b64Data || typeof pako === 'undefined') return null;
    var bin = atob(c.b64Data), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(pako.ungzip(bytes, { to: 'string' }));
  }

  var D = null, SC = null, SC_LOADING = false, HOST = null, ROOT = null, TIP = null;
  var ST = { ind: null, level: 'classes', sort: 'su', meas: 'su', zeta: false, drill: null, ovAll: false, scope: null, f: { atc: '', dm1: '', dm2: '', whole: false }, cg: '2022' };
  var KEY = 'zeta_md_state_v4';
  var SEGCOL = ['#2a78d6', '#15803D', '#D97706', '#7C3AED', '#0891B2', '#DB2777', '#64748B', '#A16207'];
  var LEVELS = [['classes', 'Classes'], ['atc4', 'ATC4'], ['dm1', 'DM1 markets'], ['molecules', 'Molecules'], ['combo', 'Plain vs combination'], ['form', 'Form']];
  // 2026-10-13: ATC4 / DM1 / DM2 filters. A "scope" is one ATC4 inside the selected area, or one of our defined markets
  // (DM1 / DM2 from the IQVIA extract, mapped onto Total Market packs in the ETL). Scopes live in a second, lazy cache file.
  var SLEVELS = [['molecules', 'Molecules'], ['brands', 'Brands'], ['corps', 'Companies'], ['combo', 'Plain vs combination'], ['form', 'Form']];
  // CAGR start year (selector): 2022 or 2023 -> 2025; each row starts later if it launched later (ETL: cagr / cagr23)
  function cg(m) { return ST.cg === '2023' ? [m.cagr23, m.window23] : [m.cagr, m.window]; }
  function ytdLabel() { var y = D.meta.ytd; return y ? 'YTD ' + y.months.split('–')[1] + ' ' + String(y.year).slice(2) : 'YTD'; }
  function ytdCell(m) {
    if (fin(m.ytd)) return '<span class="num' + (m.ytd < 0 ? ' neg' : '') + '">' + fmtP(m.ytd) + '</span>';
    return '<span class="mut" title="' + (fin(m.ytd_cov) ? 'The IQVIA monthly extract covers only ' + Math.round(m.ytd_cov) + '% of this row (needs 95%)' : 'No monthly data') + '">—</span>';
  }
  function levels() { return ST.scope ? SLEVELS : LEVELS; }
  // Cascading filters: Area -> ATC4 -> DM1 -> DM2 (AND). Options come from meta.filter_index (every leaf combination with data);
  // the selected combination resolves to a pre-computed scope through meta.filter_alias. "whole" = the DM market across all areas.
  function fx() { return D.meta.filter_index || []; }
  function uniq(a) { var o = [], seen = {}; a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; o.push(x); } }); return o.sort(); }
  function fopts(level) {
    var f = ST.f, cur = ind().id;
    var rows = fx().filter(function (r) { return (f.whole || r[0] === cur); });
    if (level === 'atc') return uniq(rows.map(function (r) { return r[1]; }));
    if (f.atc && !f.whole) rows = rows.filter(function (r) { return r[1] === f.atc; });
    if (level === 'dm1') return uniq(rows.map(function (r) { return r[2]; }));
    if (f.dm1) rows = rows.filter(function (r) { return r[2] === f.dm1; });
    return uniq(rows.map(function (r) { return r[3]; }));
  }
  function spansAreas() {
    var f = ST.f; if (!f.dm1 && !f.dm2) return false;
    return uniq(fx().filter(function (r) { return (!f.dm1 || r[2] === f.dm1) && (!f.dm2 || r[3] === f.dm2); }).map(function (r) { return r[0]; })).length > 1;
  }
  function syncScope() {
    var f = ST.f;
    if (f.whole && !(f.dm1 || f.dm2)) f.whole = false;
    if (f.whole) f.atc = '';
    if (f.atc && fopts('atc').indexOf(f.atc) < 0) f.atc = '';
    if (f.dm1 && fopts('dm1').indexOf(f.dm1) < 0) f.dm1 = '';
    if (f.dm2 && fopts('dm2').indexOf(f.dm2) < 0) f.dm2 = '';
    if (f.whole && !spansAreas()) f.whole = false;
    var k = [f.whole ? '*' : ind().id, f.atc, f.dm1, f.dm2].join('|');
    ST.scope = (f.atc || f.dm1 || f.dm2) ? ((D.meta.filter_alias || {})[k] || null) : null;
    var lv = levels().map(function (l) { return l[0]; }); if (lv.indexOf(ST.level) < 0) ST.level = ST.scope ? 'molecules' : 'classes';
  }
  function scope() { return ST.scope && SC ? SC[ST.scope] || null : null; }
  function ensureScopes(cb) {
    if (SC) return cb();
    if (!global.MARKET_DYNAMICS_SCOPES_CACHE && global.CacheLoader && global.CacheLoader.ensure) {
      if (SC_LOADING) return; SC_LOADING = true;
      var d = ROOT.querySelector('#md-detail'); if (d) d.innerHTML = '<section class="card"><p class="mut">Loading ATC4 / DM1 / DM2 views…</p></section>';
      global.CacheLoader.ensure('market_dynamics_scopes').then(function () { SC_LOADING = false; SC = decode('MARKET_DYNAMICS_SCOPES_CACHE'); if (!SC) ST.scope = null; if (ROOT) cb(); });
      return;
    }
    SC = decode('MARKET_DYNAMICS_SCOPES_CACHE'); if (!SC) ST.scope = null; cb();
  }
  var Y = ['2022', '2023', '2024', '2025'];
  var QUADS = ['Volume Anchor', 'Growth Engine', 'Mature / Plateauing', 'Niche / Stable', 'Contracting / At-Risk'];
  var QCLS = { 'Volume Anchor': 'qa', 'Growth Engine': 'qe', 'Mature / Plateauing': 'qm', 'Niche / Stable': 'qn', 'Contracting / At-Risk': 'qc' };
  var FCLS = { 'Class Substitution': 'fs', 'Segment Deepening': 'fd', 'Mixed': 'fx', 'No next-gen gain': 'fn', 'Legacy Decline (not replaced)': 'fl' };
  var BCLS = { 'Expanding Market': 'be', 'Structural Substitution Underway': 'bs', 'Mature / Replacement Demand': 'bm', 'Contracting Market': 'bc' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fin(v) { return v != null && isFinite(v); }
  function big(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + ' B';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + ' M';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + ' K';
    return Math.round(v).toLocaleString();
  }
  function fmtV(v) { if (!fin(v)) return '—'; return (ST.meas === 'value' ? 'EGP ' : '') + big(v); }
  function fmtD(v) { return fin(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + (ST.meas === 'value' ? 'EGP ' : '') + big(Math.abs(v)) : '—'; }
  function fmtP(p, d) { if (!fin(p)) return '—'; return (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(d == null ? 1 : d) + '%'; }
  function fmtS(p) { return fin(p) ? p.toFixed(p < 10 ? 1 : 0) + '%' : '—'; }
  function fmtPts(p) { return fin(p) ? (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(1) + ' pts' : '—'; }
  function M(o) { return o.m[ST.meas]; }
  function unitWord() { return ST.meas === 'value' ? 'LC Value (EGP)' : ST.meas === 'su' ? 'SU (est.)' : 'packs'; }
  function yoy(o, y) {
    var m = M(o), v = m.yoy[y], l = m.yoy_label[y];
    if (fin(v)) return '<span class="num' + (v < 0 ? ' neg' : '') + '" title="' + esc(l || '') + '">' + fmtP(v) + (l ? '<sup>' + (l === 'Low base' ? 'LB' : '†') + '</sup>' : '') + '</span>';
    return '<span class="mut">' + esc(l || '—') + '</span>';
  }
  function chip(map, v, cls) { return v ? '<span class="' + (cls || 'qchip') + ' ' + (map[v] || '') + '">' + esc(v) + '</span>' : '<span class="mut">—</span>'; }
  function inds() { var za = D.meta.zeta_areas || []; return D.indications.filter(function (i) { return !ST.zeta || za.indexOf(i.id) >= 0; }).sort(function (a, b) { return (M(b).su['2025'] || 0) - (M(a).su['2025'] || 0); }); }
  function ind() { return D.indications.find(function (i) { return i.id === ST.ind; }) || inds()[0]; }
  function members(i) {
    var sc = scope(); if (sc) return sc.members[ST.level] || [];
    if (['combo', 'form', 'atc4', 'dm1'].indexOf(ST.level) >= 0) return (i.splits && i.splits[ST.level]) || [];
    return (ST.level === 'molecules' ? D.molecules : D.classes).filter(function (c) { return c.indication === i.id; });
  }
  function levelWord() { return { classes: 'classes', atc4: 'ATC4s', dm1: 'DM1 markets', molecules: 'molecules', brands: 'brands', corps: 'companies', combo: 'plain vs combination', form: 'pharmaceutical forms' }[ST.level]; }
  // label / context always from the selection itself (identical combinations share one pre-computed scope)
  function scopeLabel() { var f = ST.f, an = D.meta.atc_names || {};
    return [f.atc ? 'ATC4 ' + (an[f.atc] || f.atc) : '', f.dm1 ? 'DM1 ' + f.dm1 : '', f.dm2 ? 'DM2 ' + f.dm2 : ''].filter(Boolean).join(' · ') + (f.whole ? ' (all areas)' : ''); }
  function marketTotal(meas) { var t = 0; D.indications.forEach(function (i) { t += i.m[meas].su['2025'] || 0; }); return t; }
  function spark(arr, w, h) {
    var v = arr.filter(fin); if (v.length < 2) return '';
    var mx = Math.max.apply(null, v), mn = Math.min(0, Math.min.apply(null, v)), n = arr.length;
    var pts = arr.map(function (a, k) { return fin(a) ? (k * (w - 4) / (n - 1) + 2).toFixed(1) + ',' + (h - 2 - (a - mn) / ((mx - mn) || 1) * (h - 4)).toFixed(1) : null; }).filter(Boolean);
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><polyline points="' + pts.join(' ') + '"/></svg>';
  }

  // ---------------------------------------------------------------- shell
  function shell() {
    var m = D.meta;
    return '<div class="wrap">' +
      '<header class="top"><div><h1>Market Dynamics &amp; Treatment Shift</h1>' +
      '<div class="sub">How each therapeutic area of the Egyptian market is growing, where every class and molecule sits within it, and whether newer therapies ' +
      'are replacing older ones or adding new volume. Source: <b>Total Market Intelligence</b> (IMS, all ' + esc(m.n_atc4) + ' ATC4 classes), full years 2022–2025 plus ' + esc(m.partial_label) + '.</div></div>' +
      '<div class="mut small">' + esc(m.source_file || '') + ' · built ' + esc(m.generated_at) + '</div></header>' +
      '<section class="card controls">' +
      '<div class="ctl"><label>Measure</label><div class="seg" id="md-meas"><button type="button" data-v="su" title="Packs x pack count (tablets, capsules, sachets, vials); other forms count 1 per pack">SU (est.)</button><button type="button" data-v="units">Packs</button><button type="button" data-v="value">LC Value</button></div></div>' +
      '<div class="ctl grow"><label for="md-ind">Therapeutic area</label><select id="md-ind"></select></div>' +
      '<div class="ctl"><label>&nbsp;</label><label class="chk"><input type="checkbox" id="md-zeta"> Zeta areas only</label></div>' +
      '<div class="ctl"><label>CAGR from</label><div class="seg" id="md-cg"><button type="button" data-v="2022">2022</button><button type="button" data-v="2023">2023</button></div></div>' +
      '<div class="ctl"><label>Compare</label><div class="seg" id="md-lvl"></div></div>' +
      '<div class="frow"><div class="ctl grow"><label for="md-atc">ATC4 <span class="mut">(in this area)</span></label><select id="md-atc"></select></div>' +
      '<div class="ctl grow"><label for="md-dm1">DM1 market <span class="mut">(narrows with ATC4)</span></label><select id="md-dm1"></select></div>' +
      '<div class="ctl grow"><label for="md-dm2">DM2 market <span class="mut">(narrows with DM1)</span></label><select id="md-dm2"></select></div>' +
      '<div class="ctl"><label>&nbsp;</label><label class="chk" id="md-whole-w" title="The DM market across every therapeutic area it is filed in"><input type="checkbox" id="md-whole"> Whole market (all areas)</label></div>' +
      '<div class="ctl"><label>&nbsp;</label><button type="button" class="btn" id="md-clr">Clear all</button></div>' +
      '<div class="chips" id="md-chips"></div></div>' +
      '</section>' +
      '<div id="md-valnote"></div>' +
      '<section class="card"><div class="h2row"><h2 id="md-ov-title">All therapeutic areas</h2><span class="mut small"><span id="md-ov-hint"></span> <button type="button" class="lnk" id="md-ov-all"></button></span></div>' +
      '<div class="tblwrap"><table class="tbl ov" id="md-ov"></table></div>' +
      '<div class="note mut">2026 is January–June only and the source has no month split, so it is shown as volume and share, never as growth.</div></section>' +
      '<div id="md-detail"></div>' +
      '<details class="card method" id="md-method"><summary><h2>Methodology &amp; data checks</h2></summary><div id="md-method-body"></div></details>' +
      '</div>';
  }

  function controls() {
    syncScope();
    ROOT.querySelector('#md-ind').innerHTML = inds().map(function (i) { return '<option value="' + esc(i.id) + '">' + esc(i.name) + '</option>'; }).join('');
    if (!inds().some(function (x) { return x.id === ST.ind; })) ST.ind = inds()[0].id;
    ROOT.querySelector('#md-ind').value = ind().id;
    ROOT.querySelector('#md-zeta').checked = !!ST.zeta;
    ROOT.querySelectorAll('#md-meas button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === ST.meas ? 'true' : 'false'); });
    ROOT.querySelector('#md-lvl').innerHTML = levels().map(function (l) { return '<button type="button" data-v="' + l[0] + '">' + l[1] + '</button>'; }).join('');
    var f = ST.f, an = D.meta.atc_names || {};
    var opt = function (v, t) { return '<option value="' + esc(v) + '">' + esc(t) + '</option>'; };
    var oa = fopts('atc'), o1 = fopts('dm1'), o2 = fopts('dm2');
    var sa = ROOT.querySelector('#md-atc'), s1 = ROOT.querySelector('#md-dm1'), s2 = ROOT.querySelector('#md-dm2');
    sa.innerHTML = opt('', f.whole ? 'Not used with whole market' : 'All ATC4s (' + oa.length + ')') + oa.map(function (c) { return opt(c, an[c] || c); }).join('');
    s1.innerHTML = opt('', o1.length ? 'All DM1 markets (' + o1.length + ')' : 'No DM1 market here') + o1.map(function (x) { return opt(x, x); }).join('');
    s2.innerHTML = opt('', o2.length ? 'All DM2 markets (' + o2.length + ')' : 'No DM2 market here') + o2.map(function (x) { return opt(x, x); }).join('');
    sa.value = f.atc; s1.value = f.dm1; s2.value = f.dm2;
    sa.disabled = f.whole; s1.disabled = !o1.length; s2.disabled = !o2.length;
    var wv = spansAreas() && !f.atc;
    ROOT.querySelector('#md-whole-w').style.display = wv || f.whole ? '' : 'none';
    ROOT.querySelector('#md-whole').checked = f.whole;
    ROOT.querySelector('#md-clr').disabled = !(f.atc || f.dm1 || f.dm2);
    var chip_ = function (k, t) { return '<span class="fchip">' + esc(t) + ' <button type="button" data-rm="' + k + '" aria-label="Remove">✕</button></span>'; };
    ROOT.querySelector('#md-chips').innerHTML = (f.atc || f.dm1 || f.dm2) ? '<span class="mut small">Active:</span> ' + (f.whole ? chip_('area', 'All areas') : '<span class="fchip">' + esc(ind().name) + '</span>') +
      (f.atc ? chip_('atc', 'ATC4 ' + (an[f.atc] || f.atc)) : '') + (f.dm1 ? chip_('dm1', 'DM1 ' + f.dm1) : '') + (f.dm2 ? chip_('dm2', 'DM2 ' + f.dm2) : '') +
      (ST.scope ? '' : ' <span class="neg small">no data for this combination</span>') : '';
    ROOT.querySelectorAll('#md-cg button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === ST.cg ? 'true' : 'false'); });
    ROOT.querySelectorAll('#md-lvl button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === ST.level ? 'true' : 'false'); });
    ROOT.querySelector('#md-valnote').innerHTML = ST.meas === 'value'
      ? '<div class="banner warn"><b>Value includes price.</b> The whole market grew from ' + fmtV(D.indications.reduce(function (t, i) { return t + (i.m.value.su['2023'] || 0); }, 0)) +
        ' in 2023 to ' + fmtV(marketTotal('value')) + ' in 2025, mostly through price increases. Read value growth as price + volume; SU and packs show real demand.</div>'
      : ST.meas === 'su' ? '<div class="banner info"><b>SU (est.)</b> = packs × the pack count printed in the product name (tablets, capsules, sachets, vials, suppositories). Liquids, topicals and drops count one unit per pack. ' +
        'For tablet classes this matches IQVIA Standard Units within 0–5% (e.g. PPIs 1,701 M vs 1,720 M in 2025).</div>' : '';
  }

  function overview() {
    var h = '<thead><tr><th>Therapeutic area</th><th class="r">2025</th><th class="r">Δ 2025</th><th class="r">YoY 2025</th><th class="r">YoY 2024</th>' +
      '<th class="r">Acceleration</th><th class="r">CAGR</th><th class="r">H1 2026</th><th class="r">Zeta share 2025</th><th>Trend 2022–25</th><th>Outlook (provisional)</th></tr></thead><tbody>';
    var all = inds(), cur = ind(), list = ST.ovAll ? all : all.filter(function (i) { return i.id === cur.id; });
    ROOT.querySelector('#md-ov-title').textContent = ST.ovAll ? (ST.zeta ? 'Zeta therapeutic areas' : 'All therapeutic areas') : 'Selected therapeutic area — ' + cur.name;
    ROOT.querySelector('#md-ov-hint').textContent = ST.ovAll ? 'Click a row to open it below. Sorted by 2025 volume.' : 'Filtered by the Therapeutic area selector.';
    ROOT.querySelector('#md-ov-all').textContent = ST.ovAll ? 'Show selected area only' : 'Show all ' + all.length + (ST.zeta ? ' Zeta' : '') + ' areas';
    list.forEach(function (i) {
      var m = M(i);
      h += '<tr data-id="' + esc(i.id) + '"' + (i.id === ST.ind ? ' class="sel"' : '') + '><td>' + esc(i.name) + '<div class="mut tiny">' + i.n_classes + ' classes · ' + i.n_molecules + ' molecules</div></td>' +
        '<td class="r num">' + fmtV(m.su['2025']) + '</td><td class="r num">' + fmtD(m.delta['2025']) + '</td>' +
        '<td class="r">' + yoy(i, '2025') + '</td><td class="r">' + yoy(i, '2024') + '</td>' +
        '<td class="r num' + (m.accel < 0 ? ' neg' : '') + '">' + fmtPts(m.accel) + '</td>' +
        '<td class="r num">' + (fin(cg(m)[0]) ? fmtP(cg(m)[0]) + '<div class="mut tiny">' + esc(cg(m)[1]) + '</div>' : '—') + '</td>' +
        '<td class="r num">' + fmtV(m.h1) + '</td><td class="r num">' + fmtS(m.zeta_share2025) + '</td>' +
        '<td>' + spark(Y.map(function (y) { return m.su[y]; }), 72, 20) + '</td><td>' + chip(BCLS, i.badge[ST.meas], 'badge') + '</td></tr>';
    });
    ROOT.querySelector('#md-ov').innerHTML = h + '</tbody>';
  }

  // ---------------------------------------------------------------- detail
  function detail() {
    if (ST.scope && !SC) return ensureScopes(function () { controls(); detail(); });
    var area = ind(), sc = scope(), i = sc || area, pairs = D.pairs.filter(function (p) { return p.indication === area.id; }), mem = members(i);
    var h = (sc ? scopeBanner(sc, area) : '') + cards(i, sc ? [] : pairs) +
      '<section class="card"><div class="h2row"><h2>A · Growth &amp; metric grid — ' + levelWord() + ' in ' + esc(sc ? scopeLabel() : i.name) + ' (' + unitWord() + ')</h2>' +
      '<span class="mut small">Ranked within the area. ● = Zeta sells here. † = special base (hover). Click a blue column title to sort.' + (ST.level === 'classes' ? ' Click a class with ▸ to see its split.' : '') + '</span></div>' +
      grid(i, mem) + (ST.meas === 'su' && fin(i.su_coverage_pct) ? '<div class="note mut">SU estimated from pack counts for ' + fmtS(i.su_coverage_pct) + ' of this area\'s 2025 packs; the rest count one unit per pack.</div>' : '') +
      (D.meta.ytd ? '<div class="note mut"><b>Share column:</b> ' + (fin(M(i).ytd_cur) ? '<b>Share ' + ytdLabel() + '</b> = share of this view\'s total in ' + esc(D.meta.ytd.months) + ' ' + D.meta.ytd.year + ' (IQVIA monthly extract), with the change against the same months of ' + (D.meta.ytd.year - 1) + '.'
        : '<b>Share H1-26</b> (Total Market, Jan–Jun 2026, change vs full-year 2025). The ' + ytdLabel() + ' share needs IQVIA monthly data for the whole of this view, and the extract covers only ' + Math.round(M(i).ytd_cov || 0) + '% of it — open an ATC4 or DM1 market (filters above) to see the ' + ytdLabel() + ' share.') + '</div>' : '') +
      (D.meta.ytd ? '<div class="note mut"><b>' + ytdLabel() + ' growth</b> = ' + esc(D.meta.ytd.months) + ' ' + D.meta.ytd.year + ' vs the same months of ' + (D.meta.ytd.year - 1) + ', from the IQVIA monthly extract (' + (ST.meas === 'value' ? 'LC Value' : 'Standard Units') + '). Shown only where that extract covers at least 95% of the row — our 59 ATC4 classes and DM markets; "—" elsewhere (hover for coverage). <b>CAGR</b> runs from the selected year (or the first full year after launch) to 2025.</div>' : '') +
      '<div id="md-drill">' + drillPanel() + '</div></section>' +
      '<div class="g2"><section class="card"><h2>B · Portfolio matrix</h2>' + matrix(mem) + '</section>' +
      '<section class="card"><h2>C · Treatment shift' + (sc && pairs.length ? ' <span class="mut small">(whole ' + esc(area.name) + ' area, not filtered)</span>' : '') + '</h2>' + (pairs.length ? pairs.map(shift).join('') :
        '<p class="mut">No legacy → next-gen pair is defined for this area. Pairs are set in <code>config/market_dynamics_map.json</code>.</p>') + '</section></div>' +
      outlook(area, sc);
    ROOT.querySelector('#md-detail').innerHTML = h;
    ROOT.querySelectorAll('#md-ov tr[data-id]').forEach(function (tr) { tr.classList.toggle('sel', tr.getAttribute('data-id') === area.id); });
  }
  function scopeBanner(sc, area) {
    var isDM = !!(ST.f.dm1 || ST.f.dm2);
    var t = 'Filtered to <b>' + esc(scopeLabel().replace(' (all areas)', '')) + '</b> ' + (ST.f.whole ? 'across all areas (' + esc((sc.tas || []).join(', ')) + ')' : 'inside ' + esc(area.name)) + '.' +
      (isDM ? ' DM markets are the packs defined in the IQVIA extract.' : '') +
      (fin(sc.share_of_market_pct) && sc.share_of_market_pct < 99.5 ? ' This area holds <b>' + Math.round(sc.share_of_market_pct) + '%</b> of the market\'s 2025 packs — tick "Whole market" to see all of it.' : '');
    var rc = isDM && fin(sc.lcv_gap_pct) ? ' Mapped onto Total Market packs by pack name: 2025 LC Value ' + fmtV2(sc.m.value.su['2025']) + ' vs IQVIA ' + fmtV2(sc.iqvia_lcv2025) +
      ' (' + (sc.lcv_gap_pct >= 0 ? '+' : '') + sc.lcv_gap_pct.toFixed(1) + '%)' + (Math.abs(sc.lcv_gap_pct) > 1 ? ' — some packs are named differently in the two sources.' : '.') : '';
    var sr = isDM && sc.iqvia_su2025 > 0 ? sc.m.su.su['2025'] / sc.iqvia_su2025 * 100 : null;
    if (fin(sr)) rc += ' SU (est.) 2025 = ' + Math.round(sr) + '% of IQVIA Standard Units' + (Math.abs(sr - 100) > 10 ? ' — pack counts could not be read for some packs here, so use Packs or LC Value for this market.' : '.');
    var warn = isDM && (Math.abs(sc.lcv_gap_pct || 0) > 1 || (fin(sr) && Math.abs(sr - 100) > 10));
    return '<div class="banner ' + (warn ? 'warn' : 'info') + '">' + t + rc + ' <button type="button" class="lnk" id="md-clr2">Clear all ✕</button></div>';
  }
  function fmtV2(v) { var a = Math.abs(v || 0); return 'EGP ' + (a >= 1e9 ? (v / 1e9).toFixed(2) + ' B' : a >= 1e6 ? (v / 1e6).toFixed(1) + ' M' : Math.round(v || 0).toLocaleString());
  }

  function cards(i, pairs) {
    var m = M(i), p = pairs[0];
    var share = m.su['2025'] / (marketTotal(ST.meas) || 1) * 100;
    function card(l, v, s) { return '<div class="kpi"><div class="kl">' + l + '</div><div class="kv num">' + v + '</div><div class="ks">' + s + '</div></div>'; }
    var pc = '';
    if (p) {
      var rows = p.m[ST.meas].rows, last = rows.filter(function (r) { return r.flag; }).slice(-1)[0], h1 = rows.filter(function (r) { return r.h1; })[0];
      pc = card('Next-gen share — ' + esc(p.name.split('→')[1] ? p.name.split('→')[1].trim() : ''), fmtS(h1 && h1.next_share_ind),
        'of the area in H1 2026 · ' + fmtS(last && last.next_share_ind) + ' in 2025' + (h1 && fin(h1.share_chg_pts) ? ' (' + fmtPts(h1.share_chg_pts) + ')' : ''));
    } else pc = card('Zeta share 2025', fmtS(m.zeta_share2025), 'H1 2026: ' + fmtS(m.zeta_share_h1));
    return '<div class="kpis">' +
      card((i.kind ? 'Filter' : 'Area') + ' 2025 (' + unitWord() + ')', fmtV(m.su['2025']), fmtP(m.yoy['2025']) + ' · ' + fmtD(m.delta['2025']) + ' vs 2024 · ' + fmtS(share) + ' of the market') +
      card('Acceleration', fmtPts(m.accel), 'YoY ' + fmtP(m.yoy['2024']) + ' → ' + fmtP(m.yoy['2025'])) +
      card('H1 2026 (Jan–Jun)', fmtV(m.h1), 'shown as volume only: no comparable H1 2025 in the source') + pc +
      (i.badge ? '<div class="kpi"><div class="kl">Outlook (provisional)</div><div class="kv">' + chip(BCLS, i.badge[ST.meas], 'badge big') + '</div>' +
      '<div class="ks">' + (p ? 'Latest shift: ' + esc(p.m[ST.meas].latest_flag) : 'From 2025 and 2024 growth') + '</div></div>' :
      card('Players', String((i.counts && i.counts.corps) || '—'), (i.counts ? i.counts.brands + ' brands · ' + i.counts.molecules + ' molecules' : ''))) + '</div>';
  }

  function grid(i, mem) {
    // Share column: YTD (IQVIA months, vs the same months last year) when the total of this view is covered by the
    // IQVIA extract; otherwise the Total Market H1 2026 share vs full-year 2025.
    var useY = fin(M(i).ytd_cur) && !!D.meta.ytd;
    if (!mem.length && ST.level === 'dm1') return '<p class="mut">None of our DM1 markets sits in this area. Pick another area, or tick "Zeta areas only" to see the areas where we compete.</p>';
    var keyf = { su: function (o) { return M(o).su['2025'] || 0; }, yoy: function (o) { return fin(M(o).yoy['2025']) ? M(o).yoy['2025'] : -1e9; },
      accel: function (o) { return fin(M(o).accel) ? M(o).accel : -1e9; }, share: function (o) { return M(o).share2025 || 0; },
      cagr: function (o) { return fin(cg(M(o))[0]) ? cg(M(o))[0] : -1e9; }, ytd: function (o) { return fin(M(o).ytd) ? M(o).ytd : -1e9; }, chg: function (o) { var v = useY ? M(o).share_ytd_chg_pts : M(o).share_chg_pts; return fin(v) ? v : -1e9; } }[ST.sort] || function (o) { return M(o).su['2025'] || 0; };
    var rows = mem.slice().sort(function (a, b) { if (a.other) return 1; if (b.other) return -1; return keyf(b) - keyf(a); });
    function th(k, t) { return '<th class="r"' + (k ? ' data-sort="' + k + '"' : '') + '>' + t + (ST.sort === k ? ' ▾' : '') + '</th>'; }
    var h = '<div class="tblwrap"><table class="tbl" id="md-grid"><thead><tr><th>' + ({ molecules: 'Molecule', brands: 'Brand', corps: 'Company', combo: 'Segment', form: 'Form', atc4: 'ATC4', dm1: 'DM1 market' }[ST.level] || 'Class') + '</th>' +
      Y.map(function (y) { return th(y === '2025' ? 'su' : null, y); }).join('') + th(null, 'H1 2026') + th(null, 'Δ 2025') + th('ytd', ytdLabel() + ' growth') + th('yoy', 'YoY 2025') + th(null, 'YoY 2024') +
      th('accel', 'Accel.') + th('cagr', 'CAGR ' + (ST.cg === '2023' ? '23' : '22') + '–25') + th('share', 'Share 2025') + th('chg', useY ? 'Share ' + ytdLabel().replace('YTD ', 'YTD ') : 'Share H1-26') + th(null, 'Rank vol / growth') + '<th>Quadrant</th>' + th(null, 'Zeta share') + '</tr></thead><tbody>';
    rows.forEach(function (o) {
      var m = M(o);
      var nm = esc(o.name) + (o.zeta_active ? ' <span class="dot" title="Zeta sells here">●</span>' : '') +
        '<div class="mut tiny">' + esc((o.atc4 || []).slice(0, 4).join(', ')) + ((o.atc4 || []).length > 4 ? '…' : '') +
        (o.rule && o.rule.molecules ? ' · molecule rule' : '') + (o.rule && o.rule.components ? ' · ' + o.rule.components + '-molecule combos' : '') + '</div>';
      var dr = ST.level === 'classes' && D.drill && D.drill[o.id];
      if (dr) nm = '<span class="caret">' + (ST.drill === o.id ? '▾' : '▸') + '</span> ' + nm;
      var fv = !o.other && !ST.scope && (ST.level === 'atc4' ? o.code : ST.level === 'dm1' ? o.name : '');
      if (fv) nm = '<span class="caret">▸</span> ' + nm;
      h += '<tr' + (o.other ? ' class="oth"' : dr ? ' class="drillable' + (ST.drill === o.id ? ' sel' : '') + '" data-cls="' + esc(o.id) + '"' : fv ? ' class="drillable" data-flt="' + ST.level + '" data-fv="' + esc(fv) + '"' : '') + '><td class="mk">' + nm + '</td>' + Y.map(function (y) { return '<td class="r num">' + fmtV(m.su[y]) + '</td>'; }).join('') +
        '<td class="r num">' + fmtV(m.h1) + '</td><td class="r num">' + fmtD(m.delta['2025']) + '</td><td class="r">' + ytdCell(m) + '</td><td class="r">' + yoy(o, '2025') + '</td><td class="r">' + yoy(o, '2024') + '</td>' +
        '<td class="r num' + (m.accel < 0 ? ' neg' : '') + '">' + fmtPts(m.accel) + '</td>' +
        '<td class="r num">' + (fin(cg(m)[0]) ? fmtP(cg(m)[0]) + '<div class="mut tiny">' + esc(cg(m)[1]) + '</div>' : '—') + '</td>' +
        '<td class="r num">' + fmtS(m.share2025) + '<div class="mut tiny">fair ' + fmtS(m.fair_share) + '</div></td>' +
        (useY ? '<td class="r num">' + (fin(m.share_ytd) ? fmtS(m.share_ytd) + '<div class="tiny ' + (m.share_ytd_chg_pts < 0 ? 'neg' : 'mut') + '">' + fmtPts(m.share_ytd_chg_pts) + '</div>' : '<span class="mut">—</span>') + '</td>'
          : '<td class="r num">' + fmtS(m.share_h1) + '<div class="tiny ' + (m.share_chg_pts < 0 ? 'neg' : 'mut') + '">' + fmtPts(m.share_chg_pts) + '</div></td>') +
        '<td class="r num">' + (m.rank_volume || '—') + ' / ' + (m.rank_growth || '—') + '</td><td>' + (o.other ? '<span class="mut small">not ranked</span>' : chip(QCLS, m.quadrant)) + '</td>' +
        '<td class="r num">' + fmtS(m.zeta_share2025) + '</td></tr>';
    });
    var im = M(i);
    h += '<tr class="tot"><td>' + (i.kind ? 'Filter total' : 'Area total') + '</td>' + Y.map(function (y) { return '<td class="r num">' + fmtV(im.su[y]) + '</td>'; }).join('') +
      '<td class="r num">' + fmtV(im.h1) + '</td><td class="r num">' + fmtD(im.delta['2025']) + '</td><td class="r">' + ytdCell(im) + '</td><td class="r">' + yoy(i, '2025') + '</td><td class="r">' + yoy(i, '2024') + '</td>' +
      '<td class="r num">' + fmtPts(im.accel) + '</td><td class="r num">' + (fin(cg(im)[0]) ? fmtP(cg(im)[0]) : '—') + '</td><td class="r num">100%</td><td class="r num">100%</td><td></td><td></td>' +
      '<td class="r num">' + fmtS(im.zeta_share2025) + '</td></tr>';
    return h + '</tbody></table></div>' + (ST.level === 'atc4' ? '<div class="note mut">Every ATC4 of this area (IMS filing). Fair share = 1 / number of ATC4s here. Click a row to open it as a filter (molecules, brands, companies, DM1 markets inside it).</div>' :
      ST.level === 'dm1' ? '<div class="note mut">Our DM1 markets as defined in the IQVIA extract, mapped onto Total Market packs; the rest of the area is one unranked row so shares add to 100%. Fair share = 1 / number of DM1 markets here. Click a row to open it as a filter.</div>' : ST.level === 'combo' ? '<div class="note mut">Plain = single molecule; Combination = two or more molecules in one product (e.g. empagliflozin + metformin).</div>' :
      ST.level === 'form' ? '<div class="note mut">Form from IMS, with sachets taken from the product name (IMS files many sachets as solid oral). Injectables = vials and ampoules.</div>' : ST.scope && ['molecules', 'brands', 'corps'].indexOf(ST.level) >= 0 ? '<div class="note mut">Top 15 by 2025 + H1 2026 volume; the rest are grouped and not ranked. Shares are of the filter total.</div>' : ST.level === 'molecules' ? '<div class="note mut">Top ' + D.meta.n_molecules_top + ' molecules by packs in this area; the rest are grouped and not ranked. Combinations count as their own molecule.</div>' :
      '<div class="note mut">"Share H1-26" = share of the area in January–June 2026 and its change against the full-year 2025 share (a like-for-like share, not growth).</div>');
  }

  function drillPanel() {
    var d = ST.drill && D.drill && D.drill[ST.drill];
    if (!d || ST.level !== 'classes') return '';
    var t = d.total.m[ST.meas];
    var h = '<div class="drill"><div class="h2row"><h3>Inside ' + esc(d.name) + ' — all therapeutic areas (' + esc(unitWord()) + ')</h3>' +
      '<span class="mut small">2025 ' + fmtV(t.su['2025']) + ' · YoY ' + fmtP(t.yoy['2025']) + ' · accel. ' + fmtPts(t.accel) + ' · H1 2026 ' + fmtV(t.h1) +
      ' <button type="button" class="lnk" data-close="1">Close ✕</button></span></div><div class="g3">';
    [['area', 'By therapeutic area (adult vs pediatric filing)'], ['combo', 'Plain vs combination'], ['form', 'By pharmaceutical form']].forEach(function (k) {
      var segs = d.splits[k[0]] || [];
      h += '<div class="dcard"><div class="dh">' + k[1] + '</div>' + (segs.length > 1 ? stack(segs) + segTable(segs) : '<p class="mut small">Only one: ' + esc(segs[0] ? segs[0].name : '—') + '</p>') + '</div>';
    });
    return h + '</div></div>';
  }
  function stack(segs) {
    var top = segs.slice(0, 7), rest = segs.slice(7);
    var rows = [['2022', 'share2022'], ['2023', 'share2023'], ['2024', 'share2024'], ['2025', 'share2025'], ['H1 26', 'share_h1']];
    var W = 360, L = 44, R = 8, bh = 16, gap = 7, T = 4, H = T + rows.length * (bh + gap), pw = W - L - R;
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Share of each segment by year">';
    rows.forEach(function (r, k) {
      var x = L, y = T + k * (bh + gap);
      s += '<text class="ax" x="0" y="' + (y + 12) + '">' + r[0] + '</text>';
      top.forEach(function (sg, j) {
        var v = sg.m[ST.meas][r[1]] || 0, w = v / 100 * pw;
        if (w > 0) {
          s += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + Math.max(0, w - 1).toFixed(1) + '" height="' + bh + '" fill="' + SEGCOL[j] + '" data-tip="' + esc(sg.name) + '|' + r[0] + ': ' + fmtS(v) + ' of the class"/>';
          if (w > 30) s += '<text class="sv" x="' + (x + w / 2).toFixed(1) + '" y="' + (y + 12) + '" text-anchor="middle">' + Math.round(v) + '%</text>';
        }
        x += w;
      });
      var rv = rest.reduce(function (a, sg) { return a + (sg.m[ST.meas][r[1]] || 0); }, 0);
      if (rv > 0) s += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + Math.max(0, rv / 100 * pw - 1).toFixed(1) + '" height="' + bh + '" fill="#94A3B8" data-tip="Other (' + rest.length + ')|' + r[0] + ': ' + fmtS(rv) + '"/>';
    });
    return s + '</svg>';
  }
  function segTable(segs) {
    var h = '<table class="tbl mini"><thead><tr><th>Segment</th><th class="r">2025</th><th class="r">YoY 25</th><th class="r">Share 25</th><th class="r">H1-26 share</th></tr></thead><tbody>';
    segs.slice(0, 8).forEach(function (sg, j) {
      var m = sg.m[ST.meas];
      h += '<tr><td><i class="sw" style="background:' + (SEGCOL[j] || '#94A3B8') + '"></i>' + esc(sg.name) + '</td><td class="r num">' + fmtV(m.su['2025']) + '</td><td class="r">' +
        (fin(m.yoy['2025']) ? '<span class="num' + (m.yoy['2025'] < 0 ? ' neg' : '') + '">' + fmtP(m.yoy['2025']) + '</span>' : '<span class="mut">' + esc(m.yoy_label['2025'] || '—') + '</span>') +
        '</td><td class="r num">' + fmtS(m.share2025) + '</td><td class="r num">' + fmtS(m.share_h1) + '<span class="tiny ' + (m.share_chg_pts < 0 ? 'neg' : 'mut') + '"> ' + fmtPts(m.share_chg_pts) + '</span></td></tr>';
    });
    return h + '</tbody></table>';
  }

  function matrix(mem) {
    var pts = mem.filter(function (o) { return !o.other && fin(M(o).share2025) && M(o).su['2025'] > 0; });
    if (!pts.length) return '<p class="mut">Nothing to plot for this selection.</p>';
    var W = 560, H = 380, L = 52, R = 16, T = 20, B = 44, pw = W - L - R, ph = H - T - B;
    var ys = pts.map(function (o) { return fin(M(o).yoy['2025']) ? M(o).yoy['2025'] : 0; });
    var ymin = Math.max(-60, Math.min(-10, Math.floor(Math.min.apply(null, ys) / 10) * 10)), ymax = Math.max(30, Math.ceil(Math.min(150, Math.max.apply(null, ys)) / 10) * 10);
    var X = function (s) { return L + Math.sqrt(Math.max(0, s) / 100) * pw; };
    var Yp = function (v) { return T + (ymax - Math.max(ymin, Math.min(ymax, v))) / (ymax - ymin) * ph; };
    var smax = Math.max.apply(null, pts.map(function (o) { return M(o).su['2025']; }));
    var rad = function (v) { return 4 + 10 * Math.sqrt(v / smax); };
    var fair = M(pts[0]).fair_share, th = D.meta.thresholds;
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Portfolio matrix: share of the area against 2025 growth">';
    for (var t = Math.ceil(ymin / 20) * 20; t <= ymax; t += 20) s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Yp(t) + '" y2="' + Yp(t) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (Yp(t) + 3.5) + '" text-anchor="end">' + t + '%</text>';
    [1, 5, 10, 25, 50, 100].forEach(function (x) { s += '<text class="ax" x="' + X(x) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + x + '%</text>'; });
    s += '<line class="zero" x1="' + L + '" x2="' + (W - R) + '" y1="' + Yp(0) + '" y2="' + Yp(0) + '"/>';
    s += '<line class="ref" x1="' + X(fair) + '" x2="' + X(fair) + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="ax" x="' + (X(fair) + 4) + '" y="' + (H - B - 24) + '">fair share ' + fmtS(fair) + '</text>';
    s += '<line class="ref" x1="' + L + '" x2="' + X(fair) + '" y1="' + Yp(th.engine_min_yoy_pct) + '" y2="' + Yp(th.engine_min_yoy_pct) + '"/>';
    s += '<line class="ref" x1="' + X(fair) + '" x2="' + (W - R) + '" y1="' + Yp(th.anchor_min_yoy_pct) + '" y2="' + Yp(th.anchor_min_yoy_pct) + '"/>';
    s += '<text class="qz" x="' + (L + 6) + '" y="' + (T + 14) + '">Growth Engines</text><text class="qz" x="' + (W - R - 6) + '" y="' + (T + 14) + '" text-anchor="end">Volume Anchors</text>' +
      '<text class="qz" x="' + (L + 6) + '" y="' + (H - B - 8) + '">Niche / Stable</text><text class="qz" x="' + (W - R - 6) + '" y="' + (H - B - 8) + '" text-anchor="end">Mature / Plateauing</text>';
    s += '<text class="ax" x="' + (L + pw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Share of the area, 2025 ' + esc(unitWord()) + ' (square-root scale)</text>' +
      '<text class="ax" transform="rotate(-90 14 ' + (T + ph / 2) + ')" x="14" y="' + (T + ph / 2) + '" text-anchor="middle">YoY growth 2025</text>';
    var order = pts.slice().sort(function (a, b) { return M(b).su['2025'] - M(a).su['2025']; });
    var labelled = order.slice(0, 8).map(function (o) { return o.id; }), placed = [];
    function labelY(x, y, w) {                                   // nudge a label down/up until it clears earlier ones
      for (var k = 0; k < 8; k++) {
        var yy = y + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 13, hit = placed.some(function (b) { return x < b.x + b.w && b.x < x + w && Math.abs(yy - b.y) < 12; });
        if (!hit) { placed.push({ x: x, y: yy, w: w }); return yy; }
      }
      placed.push({ x: x, y: y, w: w }); return y;
    }
    order.forEach(function (o) {
      if (labelled.indexOf(o.id) < 0) return;
      var m = M(o), v = fin(m.yoy['2025']) ? m.yoy['2025'] : 0, nm = short(o.name);
      o._lx = X(m.share2025) + rad(m.su['2025']) + 4; o._ly = labelY(o._lx, Yp(v) + 4, nm.length * 6);
    });
    order.slice().reverse().forEach(function (o) {
      var m = M(o), v = fin(m.yoy['2025']) ? m.yoy['2025'] : 0, cx = X(m.share2025), cy = Yp(v), clipped = v > ymax || v < ymin;
      var tip = esc(o.name) + '|Share ' + fmtS(m.share2025) + ' · 2025 ' + fmtV(m.su['2025']) + '|YoY 2025 ' + (fin(m.yoy['2025']) ? fmtP(m.yoy['2025']) : (m.yoy_label['2025'] || '—')) + ' · accel. ' + fmtPts(m.accel) + '|' + m.quadrant;
      s += '<circle class="pt ' + (QCLS[m.quadrant] || '') + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + rad(m.su['2025']).toFixed(1) + '" data-tip="' + tip + '"/>';
      if (clipped && labelled.indexOf(o.id) >= 0) s += '<text class="ax" x="' + cx + '" y="' + (cy + (v > ymax ? -14 : 22)) + '" text-anchor="middle">' + (v > ymax ? '▲ ' : '▼ ') + fmtP(v, 0) + '</text>';
      if (labelled.indexOf(o.id) >= 0) s += '<text class="lbl" x="' + o._lx.toFixed(1) + '" y="' + o._ly.toFixed(1) + '">' + esc(short(o.name)) + '</text>';
    });
    s += '</svg>';
    return s + '<div class="legend">' + QUADS.map(function (q) { return '<span><i class="sw ' + QCLS[q] + '"></i>' + esc(q) + '</span>'; }).join('') +
      '<span class="mut">Dot size = 2025 volume · largest 8 labelled · hover for detail</span></div>';
  }
  function short(n) { n = String(n).replace(/\s*\(.*?\)\s*/g, ' ').trim(); return n.length > 26 ? n.slice(0, 25) + '…' : n; }

  function shift(p) {
    var all = p.m[ST.meas].rows, rows = all.filter(function (r) { return r.flag; }), h1 = all.filter(function (r) { return r.h1; })[0];
    var vals = [0]; rows.forEach(function (r) { vals.push(r.legacy_delta, r.next_delta, r.ind_delta); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var W = 560, L = 92, R = 150, LAB = 70, rowH = 50, T = 26, H = T + rows.length * rowH + 8;
    var padL = lo < 0 ? LAB : 0, pw = W - L - R - LAB - padL, span = (hi - lo) || 1, x0 = L + padL + (-lo / span) * pw;
    var X = function (v) { return x0 + v / span * pw; };
    var s = '<div class="pairhd"><b>' + esc(p.name) + '</b>' + (p.gap ? '<span class="mut small"> · ' + esc(p.gap) + '</span>' : '') + '</div>' +
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(p.name) + ': change per year">' +
      '<text class="ax" x="' + x0 + '" y="14" text-anchor="middle">Change vs previous year, ' + esc(unitWord()) + '</text>' +
      '<line class="zero" x1="' + x0 + '" x2="' + x0 + '" y1="' + (T - 6) + '" y2="' + (H - 4) + '"/>';
    rows.forEach(function (r, k) {
      var y = T + k * rowH;
      s += '<text class="lbl" x="0" y="' + (y + 24) + '">' + esc(r.period) + '</text>';
      [['legacy_delta', 'bl', 'Legacy', 'legacy_growth'], ['next_delta', 'bn', 'Next-gen', 'next_growth'], ['ind_delta', 'bi', 'Area', 'ind_growth']].forEach(function (b, j) {
        var v = r[b[0]], a = X(Math.min(0, v)), w = Math.max(1, Math.abs(X(v) - x0)), by = y + 4 + j * 13;
        s += '<rect class="' + b[1] + '" x="' + a.toFixed(1) + '" y="' + by + '" width="' + w.toFixed(1) + '" height="10" rx="2" data-tip="' + esc(r.period) + '|' + b[2] + ' ' + fmtD(v) + ' (' + (fin(r[b[3]]) ? fmtP(r[b[3]]) : 'new') + ')"/>';
        s += '<text class="val" x="' + (v >= 0 ? X(v) + 4 : X(v) - 4).toFixed(1) + '" y="' + (by + 9) + '"' + (v < 0 ? ' text-anchor="end"' : '') + '>' + fmtD(v) + '</text>';
      });
      s += '<foreignObject x="' + (W - R + 8) + '" y="' + (y + 2) + '" width="' + (R - 8) + '" height="46"><div xmlns="http://www.w3.org/1999/xhtml" class="fo">' + chip(FCLS, r.flag, 'flag') +
        '<div class="tiny mut">next-gen ' + fmtS(r.next_share_ind) + ' of area' + (fin(r.substitution_ratio) && r.substitution_ratio > 0 ? ' · ratio ' + Math.round(r.substitution_ratio) + '%' : '') + '</div></div></foreignObject>';
    });
    s += '</svg><div class="legend"><span><i class="sw bl"></i>Legacy: ' + esc(p.legacy_names.join(' + ')) + '</span><span><i class="sw bn"></i>Next-gen: ' + esc(p.next_names.join(' + ')) + '</span><span><i class="sw bi"></i>Area net</span></div>';
    var last = rows[rows.length - 1];
    if (last) s += '<p class="note">' + explain(p, last) + '</p>';
    if (h1) s += '<p class="note mut"><b>H1 2026:</b> next-gen holds ' + fmtS(h1.next_share_ind) + ' of the area (' + fmtPts(h1.share_chg_pts) + ' vs full-year 2025) and ' + fmtS(h1.next_share_pair) + ' of the pair. Share only; no growth for a half year.</p>';
    return '<div class="pair">' + s + '</div>';
  }
  function explain(p, r) {
    var nx = p.name.split('→')[1] ? p.name.split('→')[1].trim() : 'next-gen', lg = p.name.split('→')[0].trim();
    var t = { 'Segment Deepening': 'The older therapy is still growing, so the newer one is adding treated volume rather than taking it.',
      'Class Substitution': 'The older therapy is losing volume and that loss explains at least half of the newer therapy\'s gain: patients are switching.',
      'Legacy Decline (not replaced)': 'The older therapy lost more than twice what the newer one gained: most of that volume left the market rather than switching.',
      'Mixed': 'The older therapy is slowing or falling, but only part of the newer therapy\'s gain can be explained by it.',
      'No next-gen gain': 'The newer therapy did not grow in this period.' }[r.flag] || '';
    return '<b>' + esc(r.period) + ':</b> ' + esc(nx) + ' ' + fmtD(r.next_delta) + ', ' + esc(lg) + ' ' + fmtD(r.legacy_delta) + ', area ' + fmtD(r.ind_delta) + '. ' + t;
  }

  function outlook(i, sc) {
    var mk = (D.forecast || []).filter(function (m) {
      var f = ST.f;
      if (sc && (f.dm1 || f.dm2)) return (f.dm1 && m.type === 'DM1' && m.name === f.dm1) || (f.dm2 && m.type === 'DM2' && m.name === f.dm2);
      if (sc && f.atc) return m.atc4 === f.atc;
      return m.indication === i.id; })
      .sort(function (a, b) { return a.type === b.type ? (b.le || 0) - (a.le || 0) : (a.type < b.type ? -1 : 1); });
    var h = '<section class="card"><div class="h2row"><h2>D · FY2027 outlook — our markets, champion forecast</h2><span class="unitchip">IQVIA Standard Units — a different measure from A–C</span></div>';
    if (!mk.length) return h + '<p class="mut">' + (sc ? 'No champion forecast for this filter.' : 'None of our forecast markets (DM1 / DM2) sit in this area.') + '</p></section>';
    h += '<div class="tblwrap"><table class="tbl"><thead><tr><th>Type</th><th>Market</th><th>Main ATC4</th><th class="r">SU 2026 LE</th><th class="r">SU FY2027</th>' +
      '<th class="r">Growth</th><th>Reliability</th><th>Method</th></tr></thead><tbody>';
    mk.forEach(function (m) {
      h += '<tr class="link" data-mk="' + esc(m.type + '|' + m.name) + '"><td>' + m.type + '</td><td>' + esc(m.name) + '</td><td class="mut small">' + esc(m.atc4 || '') + '</td>' +
        '<td class="r num">' + (fin(m.le) ? big(m.le) : '—') + '</td><td class="r num">' + (fin(m.fy27) ? big(m.fy27) : '—') + '</td><td class="r num' + (m.growth < 0 ? ' neg' : '') + '">' + fmtP(m.growth) + '</td>' +
        '<td title="' + esc((m.reliability_points || []).join('\n')) + '">' + esc(m.reliability || m.confidence || '—') + (m.engine === 'safeguard' ? ' <span class="qchip qm">safeguard</span>' : '') + '</td>' +
        '<td class="small">' + esc(m.method || '—') + '</td></tr>';
    });
    return h + '</tbody></table></div><div class="note mut">Same figures as the Market Growth Forecast tab (click a row to open it there). The outlook badge above is provisional: it comes from 2024–2025 growth and the treatment-shift flag, not from a forecast of the whole area.</div></section>';
  }

  function methodology() {
    var m = D.meta, th = m.thresholds;
    var ck = (D.checks || []).map(function (c) { var st = c[3] === null ? 'INFO' : c[3] ? 'PASS' : 'CHECK'; return '<li><span class="sev ' + (st === 'PASS' ? 'ok' : st === 'INFO' ? 'inf' : 'bad') + '">' + st + '</span> ' + esc(c[0]) + ': ' + esc(c[1]) + ' ' + esc(c[2]) + '</li>'; }).join('');
    ROOT.querySelector('#md-method-body').innerHTML = '<ol class="ml">' +
      '<li><b>Source.</b> Total Market Intelligence — ' + esc(m.source_file) + ' (built ' + esc(m.source_built) + '): every ATC4 and therapeutic area of the Egyptian market, annual 2022–2025 plus January–June 2026. Measures: SU (est.) = packs × the pack count in the product name (tablets, capsules, sachets, vials, suppositories; other forms count one unit per pack), packs (IMS units) and LC Value (EGP).</li>' +
      '<li><b>Areas and classes.</b> The therapeutic area is the IMS area on each row, as on the Total Market Intelligence page. A class is an ATC4, or a molecule-level split set in <code>config/market_dynamics_map.json</code> (e.g. vonoprazan out of the PPIs). A class filed under two areas appears in each.</li>' +
      '<li><b>Growth.</b> Volumes are summed first. YoY % = year ÷ previous year − 1; acceleration = YoY 2025 − YoY 2024 in percentage points. "New" = no sales the year before; LB = growth above +' + (m.growth_rules.low_base_growth_pct || 1000).toLocaleString() + '%; † = against a launch year (treated as partial).</li>' +
      '<li><b>2026.</b> January–June only with no month split, so there is no comparable H1 2025: 2026 is shown as volume and as share of the area, compared with the full-year 2025 share.</li>' +
      '<li><b>Quadrants</b> (first match): Contracting / At-Risk = YoY below 0 in 2025 and 2024 → at or above fair share: Volume Anchor if YoY ≥ ' + th.anchor_min_yoy_pct + '% and acceleration ≥ ' + th.anchor_min_accel_pts + ' pts, else Mature / Plateauing → below fair share: Growth Engine if YoY ≥ ' + th.engine_min_yoy_pct + '% or acceleration ≥ +' + th.engine_min_accel_pts + ' pts, else Niche / Stable. Fair share = 1 ÷ number of classes (or listed molecules) in the area.</li>' +
      '<li><b>Treatment shift.</b> Within the pair\'s area. Substitution ratio = share of the next-gen gain that legacy losses explain (capped at 100%). Legacy Decline (not replaced) = legacy lost more than ' + (th.legacy_decline_multiple || 2) + '× the next-gen gain; Class Substitution = legacy falling and ratio ≥ ' + th.substitution_min_ratio_pct + '%; Segment Deepening = legacy stable or growing; otherwise Mixed.</li>' +
      '<li><b>FY2027.</b> Section D shows our markets\' champion forecast in IQVIA Standard Units, unchanged (built ' + esc(m.forecast_generated_at || '—') + '). Each market is placed in the area of its main ATC4.</li></ol>' +
      '<h3>Data checks at build time</h3><ul class="dql">' + ck + '</ul>';
  }

  // ---------------------------------------------------------------- events
  function openForecast(key) {
    var p = key.split('|'), lv = p[0], nm = p.slice(1).join('|');
    try { var s = JSON.parse(sessionStorage.getItem('zeta_mf_state') || '{}'); s.level = lv; s.seg = s.seg || {}; s.seg[lv] = nm; sessionStorage.setItem('zeta_mf_state', JSON.stringify(s)); } catch (e) { }
    var mi = document.querySelector('[data-tab="marketforecast"]'); if (mi) mi.click();
  }
  function rerender() { controls(); overview(); detail(); }
  function wire() {
    ROOT.querySelector('#md-ind').addEventListener('change', function (e) { ST.ind = e.target.value; ST.drill = null; ST.ovAll = false; ST.f.whole = false; controls(); overview(); detail(); });
    ROOT.querySelector('#md-cg').addEventListener('click', function (e) { var b = e.target.closest('button[data-v]'); if (!b) return; ST.cg = b.getAttribute('data-v'); controls(); overview(); detail(); });
    function refilter() { ST.drill = null; ST.sort = 'su'; ST.ovAll = false; controls(); overview(); detail(); }
    ROOT.querySelector('#md-atc').addEventListener('change', function (e) { ST.f.atc = e.target.value; refilter(); });
    ROOT.querySelector('#md-dm1').addEventListener('change', function (e) { ST.f.dm1 = e.target.value; refilter(); });
    ROOT.querySelector('#md-dm2').addEventListener('change', function (e) { ST.f.dm2 = e.target.value; refilter(); });
    ROOT.querySelector('#md-whole').addEventListener('change', function (e) { ST.f.whole = e.target.checked; refilter(); });
    ROOT.querySelector('#md-clr').addEventListener('click', function () { ST.f = { atc: '', dm1: '', dm2: '', whole: false }; refilter(); });
    ROOT.querySelector('#md-chips').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-rm]'); if (!b) return; var k = b.getAttribute('data-rm');
      if (k === 'area') ST.f.whole = false; else ST.f[k] = ''; refilter();
    });
    ROOT.querySelector('#md-ov-all').addEventListener('click', function () { ST.ovAll = !ST.ovAll; overview(); });
    ROOT.querySelector('#md-meas').addEventListener('click', function (e) { var b = e.target.closest('button[data-v]'); if (!b) return; ST.meas = b.getAttribute('data-v'); rerender(); });
    ROOT.querySelector('#md-lvl').addEventListener('click', function (e) { var b = e.target.closest('button[data-v]'); if (!b) return; ST.level = b.getAttribute('data-v'); controls(); detail(); });
    ROOT.querySelector('#md-zeta').addEventListener('change', function (e) { ST.zeta = e.target.checked; ST.drill = null; rerender(); });
    ROOT.querySelector('#md-ov').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-id]'); if (!tr) return; ST.ind = tr.getAttribute('data-id'); ST.drill = null; ST.f.whole = false; controls(); overview(); detail();
      var d = ROOT.querySelector('#md-detail'); if (d && d.scrollIntoView) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    ROOT.querySelector('#md-detail').addEventListener('click', function (e) {
      var th = e.target.closest('th[data-sort]'); if (th) { ST.sort = th.getAttribute('data-sort'); detail(); return; }
      if (e.target.closest('[data-close]')) { ST.drill = null; detail(); return; }
      if (e.target.closest('#md-clr2')) { ROOT.querySelector('#md-clr').click(); return; }
      var ft = e.target.closest('tr[data-flt]');
      if (ft) { var k = ft.getAttribute('data-flt') === 'atc4' ? 'atc' : 'dm1'; ST.f = { atc: '', dm1: '', dm2: '', whole: false }; ST.f[k] = ft.getAttribute('data-fv');
        ST.drill = null; ST.sort = 'su'; controls(); overview(); detail(); var top = ROOT.querySelector('#md-detail'); if (top && top.scrollIntoView) top.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      var dc = e.target.closest('tr[data-cls]');
      if (dc) { var id = dc.getAttribute('data-cls'); ST.drill = ST.drill === id ? null : id; detail(); var el = ROOT.querySelector('#md-drill'); if (ST.drill && el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
      var tr = e.target.closest('tr[data-mk]'); if (tr) openForecast(tr.getAttribute('data-mk'));
    });
    ROOT.addEventListener('mouseover', function (e) {
      var t = e.target.closest('[data-tip]'); if (!t) { TIP.style.display = 'none'; return; }
      var parts = t.getAttribute('data-tip').split('|');
      TIP.innerHTML = '<b>' + esc(parts[0]) + '</b>' + parts.slice(1).map(function (x) { return '<div>' + esc(x) + '</div>'; }).join(''); TIP.style.display = 'block';
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
      if (!D || !D.molecules) { ROOT.innerHTML = '<div style="padding:24px">Market dynamics data not loaded (cache/market_dynamics.data.js). Run UPDATE_DASHBOARD.bat or <code>python etl/build_market_dynamics.py --cache</code>.</div>'; return; }
      var sv = loadState(); if (sv) { ST.ind = sv.ind || null; ST.cg = sv.cg === '2023' ? '2023' : '2022'; var sf = sv.f && typeof sv.f === 'object' ? sv.f : {};
        ST.f = { atc: String(sf.atc || ''), dm1: String(sf.dm1 || ''), dm2: String(sf.dm2 || ''), whole: !!sf.whole }; ST.scope = null;
        ST.level = ['classes', 'atc4', 'dm1', 'molecules', 'brands', 'corps', 'combo', 'form'].indexOf(sv.level) >= 0 ? sv.level : 'classes'; ST.sort = sv.sort || 'su';
        ST.meas = ['su', 'units', 'value'].indexOf(sv.meas) >= 0 ? sv.meas : 'su'; ST.zeta = !!sv.zeta; ST.drill = null; }
      if (!ST.ind || !D.indications.some(function (i) { return i.id === ST.ind; })) ST.ind = (D.indications.find(function (i) { return i.id === 'Gastroenterology'; }) || inds()[0]).id;
      ROOT.innerHTML = shell();
      TIP = document.createElement('div'); TIP.className = 'mdx-tip'; ROOT.appendChild(TIP);
      wire(); methodology(); rerender();
    } catch (e) {
      console.error('[MarketDynamics]', e);
      ROOT.innerHTML = '<div style="padding:24px">Market Dynamics could not render: ' + esc(e && e.message || e) + '</div>';
    }
  }
  function destroy() { saveState(); document.body.classList.remove('mdx-mode'); if (HOST) { HOST.innerHTML = ''; HOST = ROOT = TIP = null; } }

  global.addEventListener('beforeunload', saveState);
  global.MarketDynamicsDashboard = { init: init, destroy: destroy };
})(window);
