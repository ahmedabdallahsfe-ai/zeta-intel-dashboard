/* ==========================================================================
 * Market Intelligence -- single scrollbar ("fit to screen", 2026-09-25)
 * --------------------------------------------------------------------------
 * UI layer ONLY. js/iqvia.js is not modified.
 * Problem: IQVIADashboard.init() gives .iqvia-dashboard-wrap a fixed
 * height of calc(100vh - 74px), but the app header and the Ask the Data
 * panel above it are taller than 74px. The browser page therefore scrolls
 * too, on top of #iqvia-content's own scroll -> two scrollbars, and the
 * bottom of the content drifts off-screen.
 * Fix: size the wrap to exactly the space left below whatever sits above
 * it, so the page itself never scrolls and #iqvia-content is the only
 * scroller. Re-fits on window resize, when the Ask panel / header change
 * height (ResizeObserver) and each time the tab is rebuilt (the observer
 * stays alive because init() replaces the DOM on every visit).
 * Desktop only (>768px); the mobile layout is untouched. If the space left
 * would be under MIN_H (360px; e.g. a long Ask answer is open) the wrap keeps
 * MIN_H and the page may scroll, so the content never gets squeezed.
 * ========================================================================== */
(function () {
  'use strict';
  var MIN_H = 360;
  var ro = null, raf = 0;

  function isDesktop() { return window.innerWidth > 768; }
  function wrapEl() {
    var w = document.querySelector('#app-root > .iqvia-dashboard-wrap');
    return (w && w.querySelector('#iqvia-app')) ? w : null;
  }

  function fit() {
    raf = 0;
    var w = wrapEl();
    if (!w) return;
    if (!isDesktop()) {                      // hand back to the original inline height
      if (w.__miFitOrig != null) { w.style.height = w.__miFitOrig; }
      return;
    }
    if (w.__miFitOrig == null) w.__miFitOrig = w.style.height;
    var se = document.scrollingElement || document.documentElement;
    var top = w.getBoundingClientRect().top + (window.scrollY || se.scrollTop || 0);
    var h = Math.max(MIN_H, Math.floor(window.innerHeight - top - spaceBelow(w)));
    w.style.height = h + 'px';
    // Safety pass: anything the measurement missed still makes the page scroll
    var over = se.scrollHeight - window.innerHeight;
    if (over > 0 && h > MIN_H) w.style.height = Math.max(MIN_H, h - over) + 'px';
  }
  // Padding/margins/elements stacked BELOW the wrap, up to <body>. Siblings
  // are counted only if they sit below (so the left nav beside the content
  // area is ignored).
  function spaceBelow(w) {
    var px = function (v) { return parseFloat(v) || 0; };
    var below = 0, el = w;
    while (el && el !== document.body && el.parentElement) {
      var cs = getComputedStyle(el);
      below += px(cs.marginBottom);
      var bottom = el.getBoundingClientRect().bottom;
      for (var sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
        var ss = getComputedStyle(sib);
        if (ss.display === 'none' || ss.position === 'absolute' || ss.position === 'fixed') continue;
        if (sib.getBoundingClientRect().top >= bottom - 1) below += sib.offsetHeight + px(ss.marginTop) + px(ss.marginBottom);
      }
      var ps = getComputedStyle(el.parentElement);
      below += px(ps.paddingBottom) + px(ps.borderBottomWidth);
      el = el.parentElement;
    }
    return below;
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(fit); }

  function watchAbove() {
    if (typeof ResizeObserver === 'undefined') return;
    if (!ro) ro = new ResizeObserver(schedule);
    ['#ask-panel-slot', '.main-content-area > .topbar', '.filter-bar-wrap'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el && !el.__miFitObs) { el.__miFitObs = true; ro.observe(el); }
    });
  }

  // Step 2 (2026-09-25): while the Market Intelligence tab is open on a
  // desktop, <body> gets .mi-iqvia-mode; css/iqvia.css "SLIM APP CHROME" uses
  // it to slim the app header and drop the empty band above the module.
  // Removed as soon as the tab is left (the wrap is gone).
  function check() {
    var w = wrapEl();
    var on = !!w && isDesktop();
    if (document.body && document.body.classList.contains('mi-iqvia-mode') !== on) {
      document.body.classList.toggle('mi-iqvia-mode', on);
      schedule();
    }
    if (w && !w.__miFit) { w.__miFit = true; watchAbove(); schedule(); }
  }

  function boot() {
    check();
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', function () { check(); schedule(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.MIFit = { refit: schedule };
})();
