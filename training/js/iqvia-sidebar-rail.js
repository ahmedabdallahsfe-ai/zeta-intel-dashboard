/* ═══════════════════════════════════════════════════════════════════
   IQVIA SIDEBAR — slim icon rail by default (2026-09-24)
   Visual-only layer. Does NOT change navigation or filter logic.
   - Desktop (>1024px): #iqvia-sidebar starts in the existing
     `.collapsed` state (52px icon rail).
   - Hover the rail for ~200ms → it "peeks" open over the content
     (no reflow of charts); leaving it or picking a section retracts it.
   - The existing "Collapse" nav item still toggles; the choice is
     remembered per viewer (localStorage key mi_sb_pinned).
   - ≤1024px: untouched (existing mobile slide-in behaviour).
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var KEY = 'mi_sb_pinned';
  var DESKTOP = function () { return window.innerWidth > 1024; };
  function getPinned() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function setPinned(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {} }

  var timer = null;
  function peek(sb, on) {
    clearTimeout(timer);
    if (!on) { sb.classList.remove('mi-rail-peek'); return; }
    if (!sb.classList.contains('collapsed') || !DESKTOP()) return;
    timer = setTimeout(function () { sb.classList.add('mi-rail-peek'); }, 200);
  }

  function addTooltips(sb) {
    var items = sb.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      var lbl = items[i].querySelector('.nav-label, .sb-toggle-lbl');
      if (lbl && !items[i].getAttribute('title')) items[i].setAttribute('title', (lbl.textContent || '').trim());
    }
  }

  function setup(sb) {
    if (sb.__miRail) return;
    sb.__miRail = true;
    sb.classList.add('mi-rail');
    addTooltips(sb);
    if (DESKTOP() && !getPinned()) sb.classList.add('collapsed');

    sb.addEventListener('mouseenter', function () { peek(sb, true); });
    sb.addEventListener('mouseleave', function () { peek(sb, false); });
    // Choosing a section retracts the peek (the click itself runs unchanged)
    sb.addEventListener('click', function (e) {
      var it = e.target.closest && e.target.closest('.nav-item');
      if (it && !/toggleSidebar/.test(it.getAttribute('onclick') || '')) peek(sb, false);
    });
  }

  // Remember the user's explicit Collapse/Expand choice (desktop only)
  function wrapToggle() {
    if (typeof window.toggleSidebar !== 'function' || window.toggleSidebar.__miRail) return;
    var orig = window.toggleSidebar;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      var sb = document.getElementById('iqvia-sidebar');
      if (sb && DESKTOP()) { sb.classList.remove('mi-rail-peek'); clearTimeout(timer); setPinned(!sb.classList.contains('collapsed')); }
      return r;
    };
    wrapped.__miRail = true;
    window.toggleSidebar = wrapped;
  }

  function tryInit() {
    wrapToggle();
    var sb = document.getElementById('iqvia-sidebar');
    if (sb) setup(sb);
    return !!sb;
  }

  // IQVIADashboard.init() rebuilds the DOM every time the tab opens, so the
  // observer stays alive; the callback is a cheap id lookup + flag check.
  function start() {
    tryInit();
    var mo = new MutationObserver(function () { tryInit(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // Crossing the tablet breakpoint: drop peek state
  window.addEventListener('resize', function () {
    var sb = document.getElementById('iqvia-sidebar');
    if (sb && !DESKTOP()) sb.classList.remove('mi-rail-peek');
  });

  window.MISidebarRail = { pin: function (v) { setPinned(!!v); } };
})();
