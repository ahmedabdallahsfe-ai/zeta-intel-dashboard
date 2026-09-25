/* ==========================================================================
 * "Ask the Data" docked behind a top-bar button — ALL pages (2026-09-25)
 * --------------------------------------------------------------------------
 * Generalises js/iqvia-ask-dock.js (Market Intelligence only) to every page
 * that has an Ask panel, and replaces it. UI layer ONLY: ask-engine.js,
 * app.js and the page modules are not modified.
 * The file name deliberately does NOT start with "ask-": ask-engine.js's
 * build-sync check treats every ask-*.js script tag as an Ask module that
 * must register in AskBuild, and would show "may be out of date".
 * Every page's panel is mounted by app.js mountAskPanel() into
 * #ask-panel-slot. On desktop (>768px) this script takes that slot out of
 * the page flow (.mi-ask-docked) and adds an "Ask the Data" button:
 *   - Market Intelligence (IQVIA): in the module's own top bar (unchanged
 *     from the IQVIA-only version);
 *   - every other page: in the app header, before "What's New".
 * The button opens the panel as a floating card under that bar
 * (.mi-ask-open). Close: button, Esc, the × in the panel, a click outside,
 * or switching page. An answer stays in the panel after closing (dot on the
 * button). Panel markup / engine wiring untouched, so questions, chips,
 * answers and Clear work exactly as before. Mobile (<=768px) keeps the
 * original in-page panel.
 * ========================================================================== */
(function () {
  'use strict';
  var HERO = '.mi-ask-hero[data-ask-panel]';
  var globals = false;

  function isDesktop() { return window.innerWidth > 768; }
  function slot() { return document.getElementById('ask-panel-slot'); }
  function hero() { var s = slot(); return s ? s.querySelector(HERO) : null; }
  function iqviaBar() {
    var tb = document.querySelector('#app-root > .iqvia-dashboard-wrap #topbar');
    return (tb && tb.querySelector('.tb-fgroup')) ? tb : null;
  }
  function appHeader() { return document.querySelector('.main-content-area > .topbar'); }

  // Where the button lives for the panel currently in the slot
  function host() {
    var h = hero(); if (!h) return null;
    var iq = h.getAttribute('data-ask-panel') === 'iqvia' ? iqviaBar() : null;
    if (iq) return { mode: 'iqvia', bar: iq };
    var ah = appHeader();
    return ah ? { mode: 'app', bar: ah } : null;
  }
  function btn() {
    var hs = host(); if (!hs) return null;
    return hs.bar.querySelector(hs.mode === 'iqvia' ? '#mi-ask-btn' : '#app-ask-btn');
  }
  function isOpen() { var s = slot(); return !!(s && s.classList.contains('mi-ask-open')); }

  function place() {
    var s = slot(), hs = host();
    if (!s || !hs || !isOpen()) return;
    var r = hs.bar.getBoundingClientRect();
    var top = Math.max(8, Math.round(r.bottom + 8));
    s.style.top = top + 'px';
    s.style.right = Math.max(12, Math.round(window.innerWidth - r.right + 12)) + 'px';
    s.style.maxHeight = (window.innerHeight - top - 16) + 'px';
  }

  function setOpen(open) {
    var s = slot(); if (!s) return;
    if (open && !s.classList.contains('mi-ask-docked')) return;
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
    var b = btn(), h = hero(); if (!b) return;
    b.classList.toggle('mi-ask-has-answer', !!(h && h.classList.contains('is-answered')));
  }

  function makeBtn(id, cls) {
    var b = document.createElement('button');
    b.type = 'button'; b.id = id; b.className = cls;
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'ask-panel-slot');
    b.setAttribute('aria-label', 'Ask the Data');
    b.title = 'Ask the Data — type a question about this page';
    b.innerHTML = '<span class="mi-ask-btn-ico" aria-hidden="true">&#128269;</span><span class="mi-ask-btn-txt">Ask<span class="mi-ask-btn-long"> the Data</span></span><span class="mi-ask-btn-dot" aria-hidden="true"></span>';
    b.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!isOpen()); });
    return b;
  }

  function ensureButton(hs) {
    var appBtn = document.getElementById('app-ask-btn');
    if (hs.mode === 'iqvia') {
      if (appBtn) appBtn.remove();                        // one button per page
      if (!hs.bar.querySelector('#mi-ask-btn')) {
        hs.bar.insertBefore(makeBtn('mi-ask-btn', 'tb-btn mi-ask-btn'), hs.bar.querySelector('.tb-metric') || null);
      }
    } else if (!appBtn) {
      var actions = hs.bar.querySelector('.topbar-actions') || hs.bar;
      var before = actions.querySelector('#topbar-notif-btn') || actions.firstChild;
      actions.insertBefore(makeBtn('app-ask-btn', 'app-ask-btn'), before || null);
    }
  }

  function addClose(h) {
    if (h.querySelector('.mi-ask-dock-x')) return;
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'mi-ask-dock-x'; x.setAttribute('aria-label', 'Close Ask the Data');
    x.innerHTML = '&times;';
    x.addEventListener('click', function (e) { e.stopPropagation(); setOpen(false); });
    h.appendChild(x);
  }

  function undock(s) {
    s.classList.remove('mi-ask-docked', 'mi-ask-open');
    s.style.top = s.style.right = s.style.maxHeight = '';
    var appBtn = document.getElementById('app-ask-btn'); if (appBtn) appBtn.remove();
  }

  function check() {
    var s = slot(); if (!s) return;
    var h = hero();
    var id = h ? h.getAttribute('data-ask-panel') : null;
    if (s.__askId !== id) {                 // page switched: never carry an open panel over
      s.__askId = id;
      if (isOpen()) setOpen(false);
    }
    var hs = (h && isDesktop()) ? host() : null;
    if (!hs) { if (s.classList.contains('mi-ask-docked') || document.getElementById('app-ask-btn')) undock(s); return; }
    s.classList.add('mi-ask-docked');
    ensureButton(hs);
    addClose(h);                            // the engine re-paints the panel; re-add the ×
    syncDot();
    if (isOpen()) place();
  }

  function boot() {
    check();
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
    if (globals) return; globals = true;
    window.addEventListener('resize', function () { check(); place(); });
    window.addEventListener('scroll', place, { passive: true });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) setOpen(false); });
    document.addEventListener('mousedown', function (e) {
      if (!isOpen()) return;
      var s = slot(), b = btn();
      if ((s && s.contains(e.target)) || (b && b.contains(e.target))) return;
      setOpen(false);
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.AskDock = { open: function () { setOpen(true); }, close: function () { setOpen(false); } };
})();
