/**
 * filters.js
 * ==========
 * Owns the global filter bar. ALL filters are now custom multi-select
 * checkbox-dropdowns (Power BI / Tableau style): click the button to open
 * a panel with a search box, "Select All" toggle, and a checked list.
 *
 * State shape (v3):
 *   { period: [],           // [] = "Latest" (auto-resolves to last period)
 *     period: ["Jun"],      // specific single period
 *     period: ["Feb","Jun"],// multiple periods
 *     team: [],             // [] = all teams (no restriction)
 *     team: ["A","B"],      // specific selection
 *     ...same for every other field }
 *
 * Period is special only in that [] means "latest period" (not "all"), so
 * the button label shows "Period: Latest (Jun)" rather than just "Period ".
 *
 * Cascading (cross-filtering): after every render, app.js calls
 * applyAvailability() with the availableOptions block from Analytics.run().
 * Unavailable options are grayed-out and disabled; if a currently-selected
 * value becomes unavailable it is automatically deselected and a re-render fires.
 */

const Filters = (() => {
  const STORAGE_KEY = "coverageDashboard.filters.v3"; // v3 = period also array
  let state = null;
  let onChangeCallback = null;
  let containerEl = null;
  let chipsEl = null;
  let dims = null;

  // -------------------------------------------------------------------------
  // State helpers
  // -------------------------------------------------------------------------

  function defaults() {
    const d = {};
    CONFIG.filters.fields.forEach((f) => { d[f.id] = []; });
    return d; // [] = "latest" for period, "all" for others
  }

  function loadPersisted() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Accept v3 (arrays for all fields).
      // Migrate from v2 (period was a string) and v1 (all strings).
      const clean = defaults();
      Object.keys(clean).forEach((k) => {
        if (!(k in parsed)) return;
        if (k === "period") {
          if (Array.isArray(parsed[k])) {
            clean[k] = parsed[k]; // already v3
          } else if (typeof parsed[k] === "string") {
            // v2 migration: "latest"/"all" → [] (default), specific name → [name]
            const old = parsed[k];
            clean[k] = (old === "latest" || old === "all") ? [] : [old];
          }
        } else {
          // v1 stored "all" or a string; v2/v3 expect an array
          clean[k] = Array.isArray(parsed[k]) ? parsed[k] : [];
        }
      });
      return clean;
    } catch (e) {
      console.warn("[Filters] Failed to read persisted filters, using defaults.", e);
      return null;
    }
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("[Filters] Failed to persist filters.", e);
    }
  }

  function dimListFor(fieldId) {
    // "class" key used inside state (reserved word only matters at object literals,
    // not as a key in state[]); "klass" translation happens only in getState().
    const map = {
      period: dims.periods, team: dims.teams, businessUnit: dims.businessUnits,
      nsm: dims.nsms, areaManager: dims.areaManagers, manager: dims.managers,
      employee: dims.employeeNames, specialty: dims.specialties, class: dims.classes,
      status: dims.statuses, experience: dims.experiences, type: dims.types,
      title: dims.titles,
    };
    return map[fieldId] || [];
  }

  // -------------------------------------------------------------------------
  // DOM build
  // -------------------------------------------------------------------------

  /** Build the entire filter bar once. `dimensions` is dashboard.dimensions. */
  function init(containerElArg, chipsElArg, dimensions, onChange) {
    containerEl = containerElArg;
    chipsEl = chipsElArg;
    dims = dimensions;
    onChangeCallback = onChange;
    state = loadPersisted() || defaults();

    containerEl.innerHTML = CONFIG.filters.fields.map((f) => buildMultiSelect(f)).join("");

    // All multi-select events delegated to the container
    containerEl.addEventListener("click", onContainerClick);
    containerEl.addEventListener("change", onContainerChange);
    containerEl.addEventListener("input", onSearchInput);

    // Close open panel when clicking outside the filter bar
    document.addEventListener("click", (e) => {
      if (!containerEl.contains(e.target)) closeAllPanels();
    });

    renderChips();
    onChangeCallback(getState());
  }

  // -------------------------------------------------------------------------
  // Multi-select: custom checkbox dropdown (Power BI style)
  // Period uses the same component; empty selection means "Latest period"
  // (not "all periods") — handled in analytics.js and the button label.
  // -------------------------------------------------------------------------

  function buildMultiSelect(f) {
    const options = dimListFor(f.id);
    const selected = new Set(state[f.id] || []);
    const btnLabel = selectionLabel(f, state[f.id]);
    const allChecked = selected.size === 0 ? "checked" : "";

    const items = options.map((opt) => {
      const isChecked = selected.has(opt) ? "checked" : "";
      const displayText = UI.escapeHtml(opt || "(Blank)");
      const val = UI.escapeHtml(opt);
      return `<label class="ms-item"><input type="checkbox" data-field="${f.id}" value="${val}" ${isChecked}><span>${displayText}</span></label>`;
    }).join("");

    return `
      <div class="ms-wrap" data-field="${f.id}">
        <span class="filter-label">${UI.escapeHtml(f.label)}</span>
        <button type="button" class="ms-btn" data-field="${f.id}">${btnLabel}<span class="ms-arrow" aria-hidden="true">▾</span></button>
        <div class="ms-panel hidden" data-field="${f.id}">
          <input class="ms-search" type="text" placeholder="Search..." data-field="${f.id}" autocomplete="off">
          <label class="ms-item ms-selectall">
            <input type="checkbox" class="ms-selectall-cb" data-field="${f.id}" ${allChecked}><span>Select All</span>
          </label>
          <div class="ms-divider"></div>
          <div class="ms-list" data-field="${f.id}">${items}</div>
        </div>
      </div>`;
  }

  /** Button label text. For period, empty = "Latest (Jun)" (not "All").
   * For other fields, empty = plain label (meaning "all").
   * Inner HTML so the count badge renders. */
  function selectionLabel(f, arr) {
    const label = typeof f === "string" ? f : f.label;
    const fieldId = typeof f === "string" ? f : f.id;
    if (!arr || arr.length === 0) {
      if (fieldId === "period") {
        const latest = dims.periods[dims.periods.length - 1];
        return `${UI.escapeHtml(label)}: Latest (${UI.escapeHtml(latest)}) `;
      }
      return `${UI.escapeHtml(label)} `;
    }
    if (arr.length === 1) return `${UI.escapeHtml(label)}: ${UI.escapeHtml(arr[0])} `;
    return `${UI.escapeHtml(label)} <span class="ms-count">${arr.length}</span> `;
  }

  // -------------------------------------------------------------------------
  // Event handlers (all delegated)
  // -------------------------------------------------------------------------

  function onContainerClick(e) {
    // Toggle open/close when the trigger button is clicked
    const btn = e.target.closest(".ms-btn");
    if (!btn) return;
    const fieldId = btn.dataset.field;
    const panel = containerEl.querySelector(`.ms-panel[data-field="${fieldId}"]`);
    if (!panel) return;
    const isOpen = !panel.classList.contains("hidden");
    closeAllPanels();
    if (!isOpen) {
      panel.classList.remove("hidden");
      const searchInput = panel.querySelector(".ms-search");
      if (searchInput) { searchInput.value = ""; applySearch(fieldId, ""); searchInput.focus(); }
    }
  }

  function onContainerChange(e) {
    const cb = e.target;
    if (cb.tagName !== "INPUT" || cb.type !== "checkbox") return;
    const fieldId = cb.dataset.field;
    if (!fieldId) return;

    const panel = containerEl.querySelector(`.ms-panel[data-field="${fieldId}"]`);
    if (!panel) return;
    const allCb = panel.querySelector(".ms-selectall-cb");
    const allItemCbs = Array.from(panel.querySelectorAll(`.ms-list input[type="checkbox"]`));

    if (cb.classList.contains("ms-selectall-cb")) {
      // "Select All" toggled: clear selection (empty = all pass) or select all visible+available
      const visibleCbs = allItemCbs.filter((c) => {
        const item = c.closest(".ms-item");
        return !item.classList.contains("ms-hidden-search") && !item.classList.contains("ms-unavailable");
      });
      if (cb.checked) {
        // Deselect everything: empty array = all pass through analytics
        state[fieldId] = [];
        visibleCbs.forEach((c) => { c.checked = false; });
      } else {
        // Explicitly select everything visible
        const vals = visibleCbs.map((c) => c.value);
        state[fieldId] = vals;
        visibleCbs.forEach((c) => { c.checked = true; });
      }
    } else {
      // Individual item toggled
      const checkedVals = allItemCbs.filter((c) => c.checked).map((c) => c.value);
      state[fieldId] = checkedVals;
      // Sync "Select All": checked iff no individual items are checked
      if (allCb) allCb.checked = checkedVals.length === 0;
    }

    updateBtnLabel(fieldId);
    persist(); renderChips(); onChangeCallback(getState());
  }

  function onSearchInput(e) {
    const input = e.target;
    if (!input.classList.contains("ms-search")) return;
    applySearch(input.dataset.field, input.value);
  }

  function applySearch(fieldId, term) {
    const list = containerEl.querySelector(`.ms-list[data-field="${fieldId}"]`);
    if (!list) return;
    const lc = term.toLowerCase();
    list.querySelectorAll(".ms-item").forEach((item) => {
      const label = item.textContent.toLowerCase();
      item.classList.toggle("ms-hidden-search", lc.length > 0 && !label.includes(lc));
    });
  }

  function closeAllPanels() {
    containerEl.querySelectorAll(".ms-panel").forEach((p) => p.classList.add("hidden"));
  }

  function updateBtnLabel(fieldId) {
    const btn = containerEl.querySelector(`.ms-btn[data-field="${fieldId}"]`);
    const f = CONFIG.filters.fields.find((x) => x.id === fieldId);
    if (btn && f) {
      btn.innerHTML = `${selectionLabel(f, state[fieldId])}<span class="ms-arrow" aria-hidden="true">▾</span>`;
    }
  }

  // -------------------------------------------------------------------------
  // Chips
  // -------------------------------------------------------------------------

  function renderChips() {
    UI.renderFilterChips(
      chipsEl, state, dims,
      (fieldId) => {
        state[fieldId] = []; // [] = "latest" for period, "all" for others
        updateBtnLabel(fieldId);
        // Uncheck all individual boxes; check "Select All"
        const panel = containerEl.querySelector(`.ms-panel[data-field="${fieldId}"]`);
        if (panel) {
          panel.querySelectorAll(`.ms-list input[type="checkbox"]`).forEach((cb) => { cb.checked = false; });
          const allCb = panel.querySelector(".ms-selectall-cb");
          if (allCb) allCb.checked = true;
        }
        persist(); renderChips(); onChangeCallback(getState());
      },
      () => resetAll()
    );
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  function getState() {
    // analytics.js expects "klass" for the class filter (reserved-word boundary).
    // period is now also an array: [] = latest, ["Jun"] = specific, etc.
    return Object.assign({}, state, { klass: state.class });
  }

  function resetAll() {
    state = defaults();
    persist();
    // Reset all fields (period is now also an array-based multi-select)
    CONFIG.filters.fields.forEach((f) => {
      updateBtnLabel(f.id);
      const panel = containerEl.querySelector(`.ms-panel[data-field="${f.id}"]`);
      if (panel) {
        panel.querySelectorAll(`.ms-list input[type="checkbox"]`).forEach((cb) => { cb.checked = false; });
        const allCb = panel.querySelector(".ms-selectall-cb");
        if (allCb) allCb.checked = true;
      }
    });
    renderChips();
    onChangeCallback(getState());
  }

  /**
   * Gray out + disable every option that Analytics.run()'s cross-filter
   * computation determined is unreachable given every OTHER currently-active
   * filter. Auto-deselects any selected value that becomes unavailable and
   * triggers one extra re-render so the data stays consistent.
   */
  function applyAvailability(availableOptions) {
    if (!availableOptions || !containerEl) return;
    let anyReset = false;

    CONFIG.filters.fields.forEach((f) => {
      // availableOptions uses "period" key for period, same as other fields
      const allowedList = availableOptions[f.id];
      if (!allowedList) return;
      const allowed = new Set(allowedList);

      // All filters are now multi-select: gray-out + disable unavailable checkboxes
      const list = containerEl.querySelector(`.ms-list[data-field="${f.id}"]`);
      if (!list) return;

      list.querySelectorAll(".ms-item").forEach((item) => {
        const cb = item.querySelector("input[type='checkbox']");
        if (!cb) return;
        const isUnavailable = !allowed.has(cb.value);
        item.classList.toggle("ms-unavailable", isUnavailable);
        cb.disabled = isUnavailable;
      });

      // Auto-deselect currently-selected values that became unavailable
      const currentSel = state[f.id] || [];
      const stillAvailable = currentSel.filter((v) => allowed.has(v));
      if (stillAvailable.length !== currentSel.length) {
        state[f.id] = stillAvailable;
        list.querySelectorAll("input[type='checkbox']").forEach((cb) => {
          cb.checked = !cb.disabled && stillAvailable.includes(cb.value);
        });
        const allCb = containerEl.querySelector(`.ms-selectall-cb[data-field="${f.id}"]`);
        if (allCb) allCb.checked = stillAvailable.length === 0;
        updateBtnLabel(f.id);
        anyReset = true;
      }
    });

    if (anyReset) { persist(); renderChips(); onChangeCallback(getState()); }
  }

  return { init, getState, applyAvailability };
})();
