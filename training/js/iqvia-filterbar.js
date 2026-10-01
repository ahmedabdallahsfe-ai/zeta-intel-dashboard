/* ==========================================================================
 * Market Intelligence -- compact sticky filter bar (hybrid, 2026-09-24)
 * --------------------------------------------------------------------------
 * UI layer ONLY. Does not modify any filter logic in js/iqvia.js.
 *  - Collapsed by default: one row = title, Period, As Of, "Filters (n)",
 *    active-filter chips, LCV/SU & tools. The grouped panel (Organization /
 *    Market / Company / Product) opens on demand with Apply + Clear All.
 *  - Period, As Of and LCV/SU stay instant (they never pass through here).
 *  - While the panel is open, a dropdown change still runs iqvia.js's own
 *    msCheckChange / msSelectAll / msClearAll IN FULL (state, labels, badge,
 *    cascade, Other-Market rebuild); only the final renderSection() redraw is
 *    held until Apply. Closing the panel any way applies pending changes, so
 *    charts and chips can never disagree.
 *  - Desktop only (>768px). The mobile drawer is untouched.
 * ========================================================================== */
(function () {
  'use strict';
  var DIMS = [
    ['bu', 'BU'], ['line', 'Line'], ['dm1', 'Market (DM1)'], ['dm2', 'Sub-Market (DM2)'],
    ['atc4', 'ATC4'], ['corp', 'Corporation'], ['molecule', 'Molecule'], ['product', 'Product'],
    ['item', 'Item'], ['strength', 'Strength'], ['dosage', 'Dosage Form']
  ];
  var S = { open: false, pending: false, wrapped: false, built: false, globals: false };

  function isDesktop() { return window.innerWidth > 768; }
  function topbar() {
    var all = document.querySelectorAll('.iqvia-dashboard-wrap #topbar');
    for (var i = all.length - 1; i >= 0; i--) { if (all[i].offsetParent !== null) return all[i]; }
    return all.length ? all[all.length - 1] : null;
  }
  // Scoped lookup inside the current topbar (avoids stale/duplicate ids after a re-init)
  function q(id) { var tb = topbar(); return tb ? tb.querySelector('#' + id) : document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function selSize(dim) {
    try {
      var cfg = window.MS_CFG ? window.MS_CFG[dim] : (typeof MS_CFG !== 'undefined' ? MS_CFG[dim] : null);
      var st = (typeof STATE !== 'undefined') ? STATE : window.STATE;
      var set = cfg && st ? st[cfg.stateKey] : null;
      return set ? set.size : 0;
    } catch (e) { return 0; }
  }
  // Full value names for the chip (the dropdown's own label truncates to 14 chars)
  function chipValue(dim) {
    try {
      var cfg = (typeof MS_CFG !== 'undefined') ? MS_CFG[dim] : null;
      var set = cfg ? STATE[cfg.stateKey] : null;
      var names = (cfg && typeof LOOKUPS !== 'undefined') ? LOOKUPS[cfg.lookupKey] : null;
      if (set && names) {
        var arr = Array.from(set);
        if (arr.length === 1) return String(names[arr[0]] || '').trim() || '1 selected';
        if (arr.length === 2) return arr.map(function (i) { return String(names[i] || '').trim(); }).join(', ');
        return arr.length + ' selected';
      }
    } catch (e) { /* fall through */ }
    var lbl = document.getElementById('f-' + dim + '-label');
    return lbl ? lbl.textContent.trim() : '';
  }
  function activeDims() { return DIMS.filter(function (d) { return selSize(d[0]) > 0; }); }

  // ---- wrap the three dropdown entry points (defer only the redraw) -------
  function wrapEntryPoints() {
    if (S.wrapped) return;
    if (typeof window.msCheckChange !== 'function' || typeof window.renderSection !== 'function') return;
    ['msCheckChange', 'msSelectAll', 'msClearAll'].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = function () {
        if (!(S.open && isDesktop())) { var r0 = orig.apply(this, arguments); renderChips(); return r0; }
        var realRender = window.renderSection;
        var realRerender = window.rerenderCurrent;
        window.renderSection = function () { S.pending = true; };      // hold the redraw only
        window.rerenderCurrent = function () { STATE.rendered.clear(); S.pending = true; };
        try { return orig.apply(this, arguments); }
        finally { window.renderSection = realRender; window.rerenderCurrent = realRerender; markPending(); renderChips(); }
      };
    });
    var origBadge = window.updateFilterBadge;
    if (typeof origBadge === 'function') {
      window.updateFilterBadge = function () { var r = origBadge.apply(this, arguments); renderChips(); return r; };
    }
    S.wrapped = true;
  }

  function flush() {
    if (!S.pending) return;
    S.pending = false;
    STATE.rendered.clear();
    window.renderSection(STATE.section);
    markPending();
  }

  // ---- open / close ------------------------------------------------------
  function setOpen(open, tbArg) {
    var tb = tbArg || topbar(); if (!tb) return;
    if (!open) {
      if (typeof window.closeAllDropdowns === 'function') window.closeAllDropdowns();
      flush();
    }
    S.open = !!open;
    tb.classList.toggle('mi-fp-open', S.open);
    tb.classList.toggle('mi-fp-collapsed', !S.open);
    var btn = tb.querySelector('#mi-fp-toggle');
    if (btn) btn.setAttribute('aria-expanded', S.open ? 'true' : 'false');
    renderChips();
  }

  function markPending() {
    var ap = q('mi-fp-apply');
    if (ap) {
      ap.classList.toggle('mi-fp-pending', S.pending);
      ap.textContent = S.pending ? 'Apply changes' : 'Apply';
    }
    var note = q('mi-fp-note');
    if (note) note.textContent = S.pending ? 'Changes not applied yet' : '';
  }

  // ---- chips ---------------------------------------------------------------
  function renderChips() {
    var box = q('mi-fp-chips'); if (!box) return;
    var act = activeDims();
    var cnt = q('mi-fp-count');
    if (cnt) { cnt.textContent = act.length; cnt.classList.toggle('mi-fp-count-on', act.length > 0); }
    if (!act.length) { box.innerHTML = '<span class="mi-fp-none">No filters · all market data</span>'; return; }
    box.innerHTML = act.map(function (d) {
      var val = chipValue(d[0]);
      return '<span class="mi-fp-chip" title="' + esc(d[1] + ': ' + val) + '"><b>' + esc(d[1]) + '</b><span class="mi-fp-chip-v">' + esc(val) + '</span>' +
        '<button type="button" class="mi-fp-chip-x" data-dim="' + d[0] + '" aria-label="Remove ' + esc(d[1]) + ' filter">×</button></span>';
    }).join('') + '<button type="button" class="mi-fp-clear-link" id="mi-fp-clear-link">Clear all</button>';
  }

  // ---- build the controls once the IQVIA topbar exists --------------------
  // IQVIADashboard.init() rebuilds the topbar every time the tab is opened,
  // so enhancement is re-applied whenever a topbar lacks #mi-fp-toggle.
  function freshTopbar() {   // cheap: no layout reads (runs from the MutationObserver)
    var all = document.querySelectorAll('.iqvia-dashboard-wrap #topbar');
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      if (!t.querySelector('#mi-fp-toggle') && t.querySelector('.tb-fgroup')) return t;
    }
    return null;
  }
  function build() {
    var tb = freshTopbar();
    if (!tb) return false;
    wrapEntryPoints();
    S.open = false; S.pending = false;   // fresh DOM = fresh, fully-rendered state

    var toggle = document.createElement('button');
    toggle.type = 'button'; toggle.id = 'mi-fp-toggle'; toggle.className = 'tb-btn mi-fp-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="mi-fp-ico">⚙</span> Filters <span id="mi-fp-count" class="mi-fp-count">0</span> <span class="mi-fp-caret">▾</span>';

    var chips = document.createElement('div');
    chips.id = 'mi-fp-chips'; chips.className = 'mi-fp-chips';

    var actions = document.createElement('div');
    actions.id = 'mi-fp-actions'; actions.className = 'mi-fp-actions';
    actions.innerHTML = '<span id="mi-fp-note" class="mi-fp-note"></span>' +
      '<button type="button" id="mi-fp-close" class="tb-btn mi-fp-close">Close</button>' +
      '<button type="button" id="mi-fp-apply" class="tb-btn mi-fp-apply">Apply</button>';

    var metric = tb.querySelector('.tb-metric');
    tb.insertBefore(toggle, metric || null);
    tb.insertBefore(chips, metric || null);
    tb.appendChild(actions);
    // existing Clear All (calls iqvia.js clearFilters -- unchanged) joins the actions row
    var clr = tb.querySelector('.tb-clear');
    if (clr) actions.insertBefore(clr, actions.querySelector('#mi-fp-close'));

    toggle.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!S.open); });
    actions.querySelector('#mi-fp-apply').addEventListener('click', function () { setOpen(false); });
    actions.querySelector('#mi-fp-close').addEventListener('click', function () { setOpen(false); });
    chips.addEventListener('click', function (e) {
      var x = e.target.closest('.mi-fp-chip-x');
      if (x) { e.stopPropagation(); window.msClearAll(x.getAttribute('data-dim')); return; }
      if (e.target.closest('#mi-fp-clear-link')) { e.stopPropagation(); if (typeof window.clearFilters === 'function') window.clearFilters(); renderChips(); return; }
      if (!S.open) setOpen(true);   // click the chip area to edit
    });
    if (!S.globals) {   // document/window listeners: attach once only
      S.globals = true;
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open) setOpen(false); });
      window.addEventListener('resize', function () { if (!isDesktop() && S.open) setOpen(false); });
    }

    S.built = true;
    setOpen(false, tb);   // collapsed by default (every time the tab is rebuilt)
    return true;
  }

  // Observer stays alive: every return to Market Intelligence brings a new
  // topbar that must be collapsed again. Callback = one lookup + flag check.
  function boot() {
    build();
    var mo = new MutationObserver(function () { build(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.MIFilterBar = { open: function () { setOpen(true); }, close: function () { setOpen(false); }, state: S };
})();
