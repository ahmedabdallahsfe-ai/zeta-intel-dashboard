/* ==========================================================================
 * Market Intelligence -- "Ask the Data" docked into the top bar (2026-09-25)
 * --------------------------------------------------------------------------
 * UI layer ONLY. ask-engine.js, app.js and iqvia.js are not modified.
 * On the Market Intelligence (IQVIA) tab the Ask panel no longer takes a
 * full-width band above the module. It is hidden from the page flow and
 * opened from a "Ask the Data" button in the Market Intelligence top bar, as a
 * floating panel just under it. The panel itself is untouched: it stays
 * inside #ask-panel-slot, so app.js's mount/re-paint and the engine's
 * wiring work exactly as before (questions, chips, answers, Clear).
 *  - Open: button click (focuses the question box). Close: button, Esc,
 *    the × in the panel, or a click outside it. An answer stays in the
 *    panel after closing; the button shows a dot while one is there.
 *  - Desktop only (>768px). Other tabs' Ask panels are unaffected (the
 *    classes are removed as soon as the slot holds another page's panel).
 *  - js/iqvia-fit.js re-fits automatically (it watches #ask-panel-slot),
 *    so the freed height goes to the Market Intelligence content.
 * ========================================================================== */
(function () {
  'use strict';
  var HERO = '.mi-ask-hero[data-ask-panel="iqvia"]';
  var globals = false;

  function isDesktop() { return window.innerWidth > 768; }
  function slot() { return document.getElementById('ask-panel-slot'); }
  function topbar() {
    var tb = document.querySelector('#app-root > .iqvia-dashboard-wrap #topbar');
    return (tb && tb.querySelector('.tb-fgroup')) ? tb : null;
  }
  function btn() { var tb = topbar(); return tb ? tb.querySelector('#mi-ask-btn') : null; }
  function isOpen() { var s = slot(); return !!(s && s.classList.contains('mi-ask-open')); }

  function place() {
    var s = slot(), tb = topbar();
    if (!s || !tb || !isOpen()) return;
    var r = tb.getBoundingClientRect();
    var top = Math.max(8, Math.round(r.bottom + 8));
    s.style.top = top + 'px';
    s.style.right = Math.max(12, Math.round(window.innerWidth - r.right + 12)) + 'px';
    s.style.maxHeight = (window.innerHeight - top - 16) + 'px';
  }

  function setOpen(open) {
    var s = slot(); if (!s || !s.classList.contains('mi-ask-docked')) return;
    s.classList.toggle('mi-ask-open', !!open);
    var b = btn(); if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      place();
      var inp = s.querySelector('.mi-ask-input');
      if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }
    } else {
      s.style.top = s.style.right = s.style.maxHeight = '';
    }
  }

  function syncDot() {
    var b = btn(), s = slot(); if (!b || !s) return;
    var h = s.querySelector(HERO);
    b.classList.toggle('mi-ask-has-answer', !!(h && h.classList.contains('is-answered')));
  }

  function addButton(tb) {
    if (tb.querySelector('#mi-ask-btn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'mi-ask-btn'; b.className = 'tb-btn mi-ask-btn';
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'ask-panel-slot');
    b.setAttribute('aria-label', 'Ask the Data');
    b.title = 'Ask the Data — type a question about this market';
    b.innerHTML = '<span class="mi-ask-btn-ico" aria-hidden="true">&#128269;</span><span class="mi-ask-btn-txt">Ask<span class="mi-ask-btn-long"> the Data</span></span><span class="mi-ask-btn-dot" aria-hidden="true"></span>';
    var anchor = tb.querySelector('.tb-metric');
    tb.insertBefore(b, anchor || null);
    b.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!isOpen()); });
  }

  function addClose(s) {
    var h = s.querySelector(HERO);
    if (!h || h.querySelector('.mi-ask-dock-x')) return;
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'mi-ask-dock-x'; x.setAttribute('aria-label', 'Close Ask the Data');
    x.innerHTML = '&times;';
    x.addEventListener('click', function (e) { e.stopPropagation(); setOpen(false); });
    h.appendChild(x);
  }

  function check() {
    var s = slot(); if (!s) return;
    var tb = topbar();
    var hero = s.querySelector(HERO);
    if (hero && tb && isDesktop()) {
      s.classList.add('mi-ask-docked');
      addButton(tb);
      addClose(s);          // the engine re-paints the panel; re-add the ×
      syncDot();
      if (isOpen()) place();
    } else if (s.classList.contains('mi-ask-docked')) {
      s.classList.remove('mi-ask-docked', 'mi-ask-open');
      s.style.top = s.style.right = s.style.maxHeight = '';
    }
  }

  function boot() {
    check();
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
    if (globals) return; globals = true;
    window.addEventListener('resize', function () { check(); place(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) setOpen(false); });
    document.addEventListener('mousedown', function (e) {
      if (!isOpen()) return;
      var s = slot(), b = btn();
      if ((s && s.contains(e.target)) || (b && b.contains(e.target))) return;
      setOpen(false);
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.MIAskDock = { open: function () { setOpen(true); }, close: function () { setOpen(false); } };
})();
