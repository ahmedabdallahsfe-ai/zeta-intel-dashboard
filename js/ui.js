/**
 * ui.js
 * =====
 * Shared, presentation-only rendering primitives used by app.js to build
 * every section of the dashboard: KPI cards, section wrappers, filter
 * chips, and the empty-state message shown when a filter combination
 * matches zero rows. No aggregation logic lives here -- this module only
 * turns already-computed data into DOM.
 */

const UI = {
  /** Escape text pulled from the workbook before inserting into HTML. */
  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str === null || str === undefined ? "" : String(str);
    return div.innerHTML;
  },

  /** Render the 6 KPI cards from CONFIG.kpiCards + a kpis object.
   * `kpiDeltas` (from Analytics.run()'s result.kpiDeltas) is null when
   * there's no prior period to compare against (e.g. Period=February
   * selected explicitly, the first period on record) -- in that case the
   * delta chip and "vs <period>" caption are simply omitted, not shown as
   * "-", since there IS no comparison to report, which is a different
   * situation from "compared, and it was zero change".
   * `trendSeries` (from result.trend.series) feeds the inline sparkline;
   * defaults to [] so callers that haven't been updated yet don't throw. */
  renderKpiCards(containerEl, kpis, kpiDeltas = null, trendSeries = []) {
    containerEl.innerHTML = CONFIG.kpiCards.map((card) => {
      const sparkValues = trendSeries.map((p) => (p ? p[card.key] : null));
      const sparkSvg = UI.renderSparkline(sparkValues);
      const deltaEntry = kpiDeltas ? kpiDeltas[card.id] : null;

      let deltaBlockHtml = "";
      if (deltaEntry && deltaEntry.delta !== null && deltaEntry.delta !== undefined) {
        const deltaText = Utils.formatDelta(deltaEntry.delta, card.format);
        const direction = deltaEntry.delta > 0 ? "up" : deltaEntry.delta < 0 ? "down" : "flat";
        const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "–";
        const toneClass = UI.deltaTone(card.polarity, direction);
        deltaBlockHtml = `
          <div class="kpi-delta ${toneClass}">
            <span class="kpi-delta-arrow" aria-hidden="true">${arrow}</span>
            <span class="kpi-delta-value">${UI.escapeHtml(deltaText)}</span>
          </div>
          <div class="kpi-delta-caption">vs ${UI.escapeHtml(kpiDeltas.previousPeriod)}</div>`;
      }

      return `
      <div class="kpi-card" data-kpi="${card.id}">
        <div class="kpi-info">
          <div class="kpi-label">${UI.escapeHtml(card.label)}</div>
          <div class="kpi-value">${Utils.formatByType(kpis[card.key], card.format)}</div>
          ${deltaBlockHtml}
        </div>
        ${sparkSvg}
      </div>`;
    }).join("");
  },

  /** Maps a KPI's configured polarity + this period's delta direction to a
   * CSS tone class. A "flat" (zero-change) delta is always neutral --
   * no movement isn't good or bad. "neutral"-polarity KPIs (currently
   * just Customers/Rep) never render as good/bad regardless of direction,
   * per the reasoning in config.js: workload rising isn't inherently a
   * win or a problem, so color-coding it would assert a judgment this
   * dashboard shouldn't make. */
  deltaTone(polarity, direction) {
    if (direction === "flat" || polarity === "neutral") return "kpi-delta-neutral";
    if (polarity === "up-good") return direction === "up" ? "kpi-delta-good" : "kpi-delta-bad";
    if (polarity === "up-bad") return direction === "up" ? "kpi-delta-bad" : "kpi-delta-good";
    return "kpi-delta-neutral";
  },

  /** Inline SVG sparkline for a KPI card: a plain polyline over `values`
   * (one entry per period, same order as trend.series), min/max-normalized
   * to the box, with a dot marking the latest point. Null/undefined
   * entries (a period with zero matching rows) are skipped rather than
   * interpolated -- the line simply connects the nearest real points on
   * either side of the gap, instead of inventing a value for the missing
   * period. Returns "" (renders nothing) when fewer than 2 real points
   * exist, since a single point can't show a trend shape. */
  renderSparkline(values, width = 96, height = 28) {
    const pad = 2;
    const pts = values
      .map((v, i) => ({ i, v: v === null || v === undefined ? null : Number(v) }))
      .filter((p) => p.v !== null && !Number.isNaN(p.v));
    if (pts.length < 2) return "";

    const n = values.length;
    const vals = pts.map((p) => p.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1; // flat series: avoid /0, render a straight mid-line

    const xAt = (i) => (n > 1 ? pad + (i / (n - 1)) * (width - 2 * pad) : width / 2);
    const yAt = (v) => height - pad - ((v - min) / range) * (height - 2 * pad);

    const coords = pts.map((p) => `${xAt(p.i).toFixed(1)},${yAt(p.v).toFixed(1)}`).join(" ");
    const last = pts[pts.length - 1];

    return `<svg class="kpi-sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Trend across periods">
      <polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx="${xAt(last.i).toFixed(1)}" cy="${yAt(last.v).toFixed(1)}" r="2" fill="currentColor" />
    </svg>`;
  },

  /**
   * Renders an initials avatar circle beside a person's name.
   * Color is deterministic from the name string so the same person
   * always gets the same color across renders and filter changes.
   * Returns an HTML string safe to inject into a table cell.
   */
  nameWithAvatar(name, subtitle) {
    const str = name || "";
    const safe = UI.escapeHtml(str);
    const sub = subtitle ? `<span class="name-subtitle">${UI.escapeHtml(subtitle)}</span>` : "";
    return `<span class="name-cell">
      <span class="name-meta"><span class="name-text">${safe}</span>${sub}</span>
    </span>`;
  },

  /** Standard "no data for this filter" placeholder, used inside chart/table containers. */
  emptyState(message = "No data matches the current filters.") {
    return `<div class="empty-state">${UI.escapeHtml(message)}</div>`;
  },

  /** True when a dataset that should drive a chart/table is empty. */
  isEmpty(rows) {
    return !rows || rows.length === 0;
  },

  /** Per-section inline "recomputing..." indicator (lighter than the
   * full-screen loading overlay, shown only while a filter change is
   * being processed -- which is near-instant, so this is mostly a subtle
   * opacity flicker rather than a spinner). */
  markRecomputing(containerEl, isRecomputing) {
    containerEl.classList.toggle("recomputing", Boolean(isRecomputing));
  },

  /** Renders the active-filter chip row + a "Clear all" action. `state`
   * is the current filter object; `onRemove(fieldId)` clears one filter;
   * `onClearAll()` resets everything to defaults.
   *
   * State shape (v2):
   *   period  — string ("latest" | "all" | "June")
   *   others  — array ([] = all, ["A"] = single, ["A","B"] = multi)
   */
  renderFilterChips(containerEl, state, dims, onRemove, onClearAll) {
    // v3: all fields including period are arrays. [] = default (no chip shown).
    const active = CONFIG.filters.fields.filter((f) => {
      const val = state[f.id];
      return Array.isArray(val) ? val.length > 0 : val !== "all";
    });

    if (!active.length) {
      containerEl.innerHTML = "";
      containerEl.classList.add("hidden");
      return;
    }

    /** Chip label for the given field + current value. */
    function chipLabel(f) {
      const arr = Array.isArray(state[f.id]) ? state[f.id] : [];
      if (arr.length === 1) return `${UI.escapeHtml(f.label)}: ${UI.escapeHtml(arr[0] || "(Blank)")}`;
      return `${UI.escapeHtml(f.label)} (${arr.length})`;
    }

    containerEl.classList.remove("hidden");
    containerEl.innerHTML = active.map((f) => `
      <button type="button" class="filter-chip" data-field="${f.id}">
        ${chipLabel(f)}
        <span class="chip-remove" aria-hidden="true">&times;</span>
      </button>`).join("") + `<button type="button" class="filter-clear-all">Clear all</button>`;

    containerEl.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => onRemove(chip.dataset.field));
    });
    const clearBtn = containerEl.querySelector(".filter-clear-all");
    if (clearBtn) clearBtn.addEventListener("click", onClearAll);
  },

  /** Builds a labeled <section class="dashboard-section"> wrapper with a
   * title bar, so every section (charts, tables, panels) looks consistent
   * without repeating markup everywhere. Returns the inner content div
   * the caller should render into. */
  buildSection(parentEl, id, title, extraHeaderHtml = "") {
    const section = document.createElement("section");
    section.className = "dashboard-section";
    section.id = id;
    section.innerHTML = `
      <div class="section-header">
        <h2>${UI.escapeHtml(title)}</h2>
        ${extraHeaderHtml}
      </div>
      <div class="section-body"></div>`;
    parentEl.appendChild(section);
    return section.querySelector(".section-body");
  },

  /** Data Health pill in the top bar. */
  renderHealthPill(el, health) {
    el.textContent = health;
    el.className = `health-pill health-${health}`;
  },
};
