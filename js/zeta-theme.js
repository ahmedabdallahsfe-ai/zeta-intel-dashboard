/* ==========================================================================
 * ZETA THEME LAYER -- Night mode + readable sidebar (2026-09-25, approved by Ahmed)
 * --------------------------------------------------------------------------
 * UI layer only; no module file is modified. Pairs with css/zeta-theme.css.
 *  - Sidebar: inserts section headers (Overview / Field Force / Sales /
 *    Market), hides a header when every page under it is hidden for the
 *    signed-in role, and copies each label to data-label for the tooltip
 *    on the collapsed rail.
 *  - Night mode: a Day/Night button in the top bar; the choice is kept per
 *    browser (localStorage "zeta_theme"). html[data-theme] drives the CSS.
 *    Module content that still hard-codes light colours (inline styles,
 *    per-module hex) is darkened at render time by recolor(): light
 *    surfaces -> dark, dark text -> light, keeping each colour's hue so
 *    status colours (green/amber/red) still read the same. Everything it
 *    changes is recorded and put back when switching to Day.
 *  - Chart.js: a global plugin sets tick / grid / legend colours per theme.
 *  - Market Intelligence keeps its own built-in dark theme (synced).
 * ========================================================================== */
(function () {
  'use strict';
  var KEY = 'zeta_theme';
  var root = document.documentElement;
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function isDark() { return root.getAttribute('data-theme') === 'dark'; }
  root.setAttribute('data-theme', saved() === 'dark' ? 'dark' : 'light');   // before first paint

  /* ---------------- sidebar groups ---------------- */
  var GROUPS = [
    ['Overview',    ['executive']],
    ['Field Force', ['coverage', 'listintel', 'coaching', 'workingdays', 'sprint', 'sfe']],
    ['Sales',       ['sales', 'tomarket']],
    ['Market',      ['iqvia', 'marketintel', 'imsrx', 'marketnews', 'regulatory']]
  ];
  function buildSidebar() {
    var ul = document.querySelector('.sidebar-menu');
    if (!ul || ul.__zt) return; ul.__zt = true;
    var items = {}; ul.querySelectorAll('.menu-item[data-tab]').forEach(function (li) {
      items[li.dataset.tab] = li;
      var lbl = li.querySelector('.menu-label'); if (lbl) { li.setAttribute('data-label', lbl.textContent.trim()); li.title = ''; }
    });
    var placed = {};
    GROUPS.forEach(function (g) {
      var h = document.createElement('li'); h.className = 'zt-group'; h.textContent = g[0]; h.setAttribute('role', 'presentation');
      h.__tabs = g[1]; ul.appendChild(h);
      g[1].forEach(function (t) { if (items[t]) { ul.appendChild(items[t]); placed[t] = 1; } });
    });
    Object.keys(items).forEach(function (t) { if (!placed[t]) ul.appendChild(items[t]); });   // any future page keeps working
    syncGroups();
    new MutationObserver(syncGroups).observe(ul, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
  }
  function syncGroups() {
    document.querySelectorAll('.sidebar-menu .zt-group').forEach(function (h) {
      var any = h.__tabs.some(function (t) { var li = document.querySelector('.sidebar-menu .menu-item[data-tab="' + t + '"]'); return li && li.style.display !== 'none'; });
      if ((h.style.display === 'none') === any) h.style.display = any ? '' : 'none';
    });
  }

  /* ---------------- theme button ---------------- */
  function buildButton() {
    var slot = document.querySelector('.topbar-actions');
    if (!slot || slot.querySelector('.zt-theme-btn')) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'zt-theme-btn';
    b.addEventListener('click', function () { setTheme(isDark() ? 'light' : 'dark'); });
    slot.insertBefore(b, slot.firstChild); paintButton();
  }
  function paintButton() {
    var b = document.querySelector('.zt-theme-btn'); if (!b) return;
    b.innerHTML = isDark() ? '<span class="zt-ico">☀️</span>Day mode' : '<span class="zt-ico">🌙</span>Night mode';
    b.title = isDark() ? 'Switch to day mode' : 'Switch to night mode';
  }

  /* ---------------- colour helpers ---------------- */
  function parse(c) { var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; var p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  function hsl(c) { var r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) { var d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return { h: h, s: s, l: l }; }
  function css(h, s, l, a) { return 'hsla(' + Math.round(h * 360) + ',' + Math.round(s * 100) + '%,' + Math.round(l * 100) + '%,' + (a == null ? 1 : a) + ')'; }
  function darkSurface(c) { var x = hsl(c); if (x.l < .78) return x.s < .25 && x.l > .55 ? css(x.h, x.s * .5, .26 - (x.l - .55) * .2, c.a) : null;
    return css(x.h, Math.min(x.s, 1) * (x.s > .4 ? .55 : .35), .10 + (1 - x.l) * .5, c.a); }
  function lightText(c) { var x = hsl(c); if (x.l > .52) return null;
    return css(x.h, x.s * (x.s > .3 ? .85 : .35), Math.min(.93, .93 - x.l * .45 + (x.s > .3 ? .05 : 0)), c.a); }
  function darkBorder(c) { var x = hsl(c); return x.l > .75 ? css(x.h, x.s * .4, .23, c.a) : null; }

  /* ---------------- recolor ---------------- */
  var touched = new Set();
  function setProp(el, prop, val) {
    if (!el.__ztOrig) el.__ztOrig = {};
    if (!(prop in el.__ztOrig)) el.__ztOrig[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
    el.style.setProperty(prop, val, 'important'); touched.add(el);
  }
  function restore(el) { var o = el.__ztOrig; if (!o) return; el.__ztOrig = null;
    Object.keys(o).forEach(function (p) { el.style.removeProperty(p); if (o[p][0]) el.style.setProperty(p, o[p][0], o[p][1]); }); }
  var SKIP = '.sidebar-nav, .zt-theme-btn, .iqvia-dashboard-wrap[data-theme="dark"], canvas, img, video, script, style, noscript';
  function recolorEl(el) {
    if (el.__ztDone) return; el.__ztDone = true;
    if (el.closest && el.closest(SKIP)) return;
    var cs = getComputedStyle(el), isSvg = el instanceof SVGElement;
    if (isSvg) {
      var tag = el.tagName.toLowerCase(), f = parse(cs.fill);
      if (f && f.a > 0) { var nf = (tag === 'text' || tag === 'tspan') ? lightText(f) : (hsl(f).l > .9 ? darkSurface(f) : null); if (nf) setProp(el, 'fill', nf); }
      var st = parse(cs.stroke); if (st && st.a > 0 && hsl(st).l > .85 && tag !== 'text') setProp(el, 'stroke', css(0, 0, .25, st.a));
      return;
    }
    var bg = parse(cs.backgroundColor);
    if (bg && bg.a > .04) { var nb = darkSurface(bg); if (nb) setProp(el, 'background-color', nb); }
    var bi = cs.backgroundImage;
    if (bi && bi.indexOf('gradient') >= 0) {
      var cols = (bi.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(function (c) { return c && c.a > .04; }), light = cols.filter(function (c) { return hsl(c).l > .8; });
      if (cols.length && light.length === cols.length) { setProp(el, 'background-image', 'none'); if (!bg || bg.a < .05) setProp(el, 'background-color', darkSurface(light[0])); }
    }
    var tc = parse(cs.color); if (tc) { var nt = lightText(tc); if (nt) setProp(el, 'color', nt); }
    ['top', 'right', 'bottom', 'left'].forEach(function (s) {
      if (parseFloat(cs['border-' + s + '-width']) > 0) { var bc = parse(cs['border-' + s + '-color']); var nb2 = bc && darkBorder(bc); if (nb2) setProp(el, 'border-' + s + '-color', nb2); }
    });
  }
  // Colour transitions (e.g. cards with "transition: all") would make getComputedStyle
  // report a half-way colour; they are paused while a pass reads and writes colours.
  var noTransTimer = 0;
  function pauseTransitions() {
    root.classList.add('zt-notrans');
    clearTimeout(noTransTimer); noTransTimer = setTimeout(function () { root.classList.remove('zt-notrans'); }, 120);
  }
  function recolorTree(node) {
    if (!isDark() || !node || node.nodeType !== 1) return;
    pauseTransitions();
    recolorEl(node); var all = node.getElementsByTagName('*'); for (var i = 0; i < all.length; i++) recolorEl(all[i]);
  }
  var pending = [], raf = 0;
  function queue(n) { pending.push(n); if (!raf) raf = requestAnimationFrame(flush); }
  function flush() { raf = 0; var list = pending; pending = []; list.forEach(recolorTree); }
  function watchContent() {
    new MutationObserver(function (muts) {
      if (!isDark()) return;
      muts.forEach(function (m) {
        if (m.type === 'childList') m.addedNodes.forEach(function (n) { if (n.nodeType === 1) queue(n); });
        else if (m.target.nodeType === 1 && m.target.__ztDone) {
          var el = m.target;
          if (m.attributeName === 'style') {                 // a module rewrote an inline colour we had darkened
            var o = el.__ztOrig, lost = false;
            if (o) Object.keys(o).forEach(function (p) { if (el.style.getPropertyPriority(p) !== 'important') { delete o[p]; lost = true; } });
            if (lost) { el.__ztDone = false; queue(el); }
          } else if (!el.__ztBusy) {                         // class changed: re-evaluate from the module's own colours
            el.__ztBusy = true; restore(el); el.__ztDone = false; recolorEl(el);
            setTimeout(function () { el.__ztBusy = false; }, 0);
          }
        }
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  }

  /* ---------------- Chart.js ---------------- */
  var chartPlugin = { id: 'ztTheme', beforeUpdate: function (ch) {
    var d = isDark(), tick = d ? '#A3B1C6' : null, grid = d ? 'rgba(148,163,184,0.14)' : null, o = ch.options;
    if (!ch.__ztBase) ch.__ztBase = JSON.stringify({ s: Object.keys(o.scales || {}).map(function (k) { var s = o.scales[k]; return [k, s.ticks && s.ticks.color, s.grid && s.grid.color, s.title && s.title.color]; }),
      l: o.plugins && o.plugins.legend && o.plugins.legend.labels && o.plugins.legend.labels.color, t: o.plugins && o.plugins.title && o.plugins.title.color });
    var base = JSON.parse(ch.__ztBase);
    base.s.forEach(function (x) { var s = o.scales[x[0]]; if (!s) return;
      if (s.ticks) s.ticks.color = d ? tick : x[1]; if (s.grid) s.grid.color = d ? grid : x[2]; if (s.title) s.title.color = d ? tick : x[3]; });
    if (o.plugins && o.plugins.legend && o.plugins.legend.labels) o.plugins.legend.labels.color = d ? '#CBD5E1' : base.l;
    if (o.plugins && o.plugins.title) o.plugins.title.color = d ? '#E6EDF7' : base.t;
  } };
  function hookCharts() {
    if (!window.Chart || window.Chart.__zt) return; window.Chart.__zt = true;
    try { window.Chart.register(chartPlugin); } catch (e) {}
  }
  function refreshCharts() {
    if (!window.Chart) return;
    window.Chart.defaults.color = isDark() ? '#A3B1C6' : '#666';
    window.Chart.defaults.borderColor = isDark() ? 'rgba(148,163,184,0.14)' : 'rgba(0,0,0,0.1)';
    Object.values(window.Chart.instances || {}).forEach(function (c) { try { c.update('none'); } catch (e) {} });
  }

  /* ---------------- Market Intelligence built-in theme ---------------- */
  function syncIqvia() {
    var w = document.querySelector('.iqvia-dashboard-wrap'); if (!w || !document.getElementById('iqvia-app')) return;
    try { if (typeof STATE !== 'undefined' && typeof applyTheme === 'function' && STATE.darkMode !== isDark()) { STATE.darkMode = isDark(); applyTheme(); } } catch (e) {}
  }

  /* ---------------- same-origin iframes (To-Market vs In-Market) ---------------- */
  var SELF = (document.currentScript && document.currentScript.src) || '';
  var CSS_URL = SELF ? SELF.replace(/js\/zeta-theme\.js.*$/, 'css/zeta-theme.css') : '';
  function themeFrames() {
    document.querySelectorAll('iframe').forEach(function (f) {
      if (!f.__ztHooked) { f.__ztHooked = true; f.addEventListener('load', themeFrames); }
      try {
        var d = f.contentDocument, w = f.contentWindow; if (!d || !d.head) return;
        if (w.ZetaTheme) { if (w.ZetaTheme.get() !== (isDark() ? 'dark' : 'light')) w.ZetaTheme.set(isDark() ? 'dark' : 'light', true); return; }
        if (d.__ztInj || !SELF) return; d.__ztInj = true;
        var l = d.createElement('link'); l.rel = 'stylesheet'; l.href = CSS_URL; d.head.appendChild(l);
        var sc = d.createElement('script'); sc.src = SELF; d.head.appendChild(sc);
      } catch (e) {}                                        // cross-origin frame: left as is
    });
  }

  /* ---------------- print / PDF export always in Day ---------------- */
  var printSwap = false;
  window.addEventListener('beforeprint', function () { if (isDark()) { printSwap = true; setTheme('light', true); } });
  window.addEventListener('afterprint', function () { if (printSwap) { printSwap = false; setTheme('dark', true); } });

  /* ---------------- switch ---------------- */
  function setTheme(t, noSave) {
    root.setAttribute('data-theme', t); if (!noSave) { try { localStorage.setItem(KEY, t); } catch (e) {} }
    paintButton(); syncIqvia(); themeFrames();
    if (t === 'dark') { document.querySelectorAll('*').forEach(function (el) { el.__ztDone = false; }); recolorTree(document.body); }
    else { pauseTransitions(); touched.forEach(restore); touched.clear(); document.querySelectorAll('*').forEach(function (el) { el.__ztDone = false; }); }
    refreshCharts();
  }

  function boot() {
    buildSidebar(); buildButton(); hookCharts(); watchContent();
    var t0 = 0;
    new MutationObserver(function () { if (t0) return; t0 = setTimeout(function () { t0 = 0; buildButton(); syncIqvia(); hookCharts(); themeFrames(); }, 150); })
      .observe(document.body, { childList: true, subtree: true });
    if (isDark()) { recolorTree(document.body); refreshCharts(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.ZetaTheme = { set: function (t, noSave) { setTheme(t === 'dark' ? 'dark' : 'light', noSave); }, get: function () { return isDark() ? 'dark' : 'light'; } };
})();
