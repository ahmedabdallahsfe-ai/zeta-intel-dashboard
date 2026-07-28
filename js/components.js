/**
 * ZETA ENTERPRISE DESIGN SYSTEM — components.js
 * =====================================================================
 * PLATFORM ASSET. Exposes window.DS — the single set of builder
 * functions every workspace uses to render KPI cards, tables, chart
 * containers, filters, modals, toasts, tooltips, and empty/loading
 * states. Pairs 1:1 with css/components.css (each builder emits markup
 * whose classes are documented there).
 *
 * Scope note: this file is intentionally the ONLY new shared JS this
 * phase. The platform brief asked for js/ui.js, js/charts.js, and
 * js/filters.js as well — but those three names already exist today as
 * live, workspace-specific files that Coverage depends on in production
 * (js/ui.js, js/charts.js, js/filters.js). Rewriting them now would be
 * "migrating a workspace" before this foundation has been validated
 * independently, which the platform brief explicitly said not to do.
 * So: all new shared component logic lives here in DS for this phase.
 * Reconciling/retiring the old ui.js/charts.js/filters.js into this
 * namespace is planned for their turn in the one-workspace-at-a-time
 * migration phase (Coverage/Sales/SFE/IQVIA), not before.
 *
 * Every builder returns either an HTML string (render-and-insert
 * pattern) or, where interactivity requires it (dropdowns, modal,
 * toast), a live DOM node plus attached behavior. No builder reaches
 * into a specific workspace's state — everything is passed in as
 * plain data.
 *
 * Depends on: css/design-system.css, css/animations.css, css/layout.css,
 * css/components.css already loaded on the page.
 * =====================================================================
 */

(function (global) {
  "use strict";

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function el(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }

  function uid(prefix) {
    return (prefix || "ds") + "-" + Math.random().toString(36).slice(2, 9);
  }

  // =====================================================================
  // 1. KPI CARD
  // DS.kpiCard({ label, value, delta, direction }) -> HTML string
  //   direction: "up" | "down" | "flat" (controls delta color + arrow)
  // =====================================================================
  function kpiCard(opts) {
    opts = opts || {};
    const direction = opts.direction || "flat";
    const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
    const deltaHtml = opts.delta
      ? `<div class="ds-kpi-delta ds-kpi-delta--${direction}">${arrow} ${escapeHtml(opts.delta)}</div>`
      : "";
    return (
      `<div class="ds-kpi-card">` +
      `<div class="ds-kpi-label">${escapeHtml(opts.label)}</div>` +
      `<div class="ds-kpi-value">${escapeHtml(opts.value)}</div>` +
      deltaHtml +
      `</div>`
    );
  }

  // =====================================================================
  // 1b. EXECUTIVE KPI CARD (Executive Command Center, 2026-07-27)
  // DS.executiveKpiCard({
  //   kpiId, name, mainValue, mainValueSub,
  //   performance: { target, achievementPct, variance, targetUnit } | null,
  //   comparison: { dm1, dm2 } | null,   -- only Market Share/BU Growth use this
  //   rank, rankOf, rankUnit,            -- e.g. rank=2, rankOf=4, rankUnit="Business Units"
  //   status,                            -- "Excellent"|"On Track"|"At Risk"|"Critical"|null
  //   trend, trendLabel,                 -- trend: "up"|"down"|"flat"
  //   clickable, dblClickable            -- data-exec-kpi/data-exec-kpi-dbl hooks for the
  //                                         caller to attach listeners post-render (same
  //                                         pattern as the ds-clickable convention elsewhere)
  // }) -> HTML string
  //
  // NOT a new visual language -- reuses the same tokens/shadows/radii as
  // every other DS component. It's a richer LAYOUT (header, performance
  // row, optional comparison row, ranking + status + trend footer) than
  // the plain kpiCard() above, because these are Executive Insight Cards
  // (KPI Card Standard, 2026-07-27 spec), not ordinary metric tiles --
  // every card must communicate performance/comparison/ranking/status/
  // navigation without a second glance. See css/components.css
  // .ds-exec-kpi-card rules for the paired styling.
  // =====================================================================
  function executiveKpiCard(opts) {
    opts = opts || {};
    const statusClass = opts.status ? " ds-exec-status--" + opts.status.toLowerCase().replace(/\s+/g, "-") : "";
    const trend = opts.trend || "flat";
    const trendArrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "→";
    const trendClass = trend === "up" ? "ds-kpi-delta--up" : trend === "down" ? "ds-kpi-delta--down" : "ds-kpi-delta--flat";

    const perf = opts.performance;
    const perfHtml = perf
      ? `<div class="ds-exec-kpi-row">
          <div class="ds-exec-kpi-metric"><span class="ds-exec-kpi-metric-label">Target</span><span class="ds-exec-kpi-metric-value">${escapeHtml(perf.target)}</span></div>
          <div class="ds-exec-kpi-metric"><span class="ds-exec-kpi-metric-label">Achievement</span><span class="ds-exec-kpi-metric-value">${escapeHtml(perf.achievementPct)}</span></div>
          <div class="ds-exec-kpi-metric"><span class="ds-exec-kpi-metric-label">Variance</span><span class="ds-exec-kpi-metric-value">${escapeHtml(perf.variance)}</span></div>
        </div>`
      : "";

    const cmp = opts.comparison;
    const cmpHtml = cmp
      ? `<div class="ds-exec-kpi-row ds-exec-kpi-row--compare">
          <div class="ds-exec-kpi-metric"><span class="ds-exec-kpi-metric-label">vs DM1</span><span class="ds-exec-kpi-metric-value">${escapeHtml(cmp.dm1)}</span></div>
          <div class="ds-exec-kpi-metric"><span class="ds-exec-kpi-metric-label">vs DM2</span><span class="ds-exec-kpi-metric-value">${escapeHtml(cmp.dm2)}</span></div>
        </div>`
      : "";

    const rankHtml = (opts.rank !== null && opts.rank !== undefined)
      ? `<div class="ds-exec-kpi-rank">#${escapeHtml(opts.rank)} of ${escapeHtml(opts.rankOf)} ${escapeHtml(opts.rankUnit || "")}</div>`
      : `<div class="ds-exec-kpi-rank ds-exec-kpi-rank--na">Ranking unavailable</div>`;

    const statusHtml = opts.status
      ? `<span class="ds-exec-status-badge${statusClass}">${escapeHtml(opts.status)}</span>`
      : "";

    const trendHtml = opts.trend
      ? `<span class="ds-kpi-delta ${trendClass}" style="display:inline-flex;">${trendArrow} ${escapeHtml(opts.trendLabel || "")}</span>`
      : "";

    const clickAttrs = [
      opts.clickable ? `data-exec-kpi="${escapeAttrLocal(opts.kpiId)}"` : "",
      opts.dblClickable ? `data-exec-kpi-dbl="${escapeAttrLocal(opts.kpiId)}"` : "",
      (opts.clickable || opts.dblClickable) ? `class="ds-exec-kpi-card ds-clickable" data-tooltip="${opts.clickable ? "Click" : "Double-click"} for detail"` : `class="ds-exec-kpi-card"`,
    ].filter(Boolean).join(" ");

    return (
      `<div ${clickAttrs}>` +
        `<div class="ds-exec-kpi-header">${escapeHtml(opts.name)}</div>` +
        `<div class="ds-exec-kpi-main">` +
          `<div class="ds-exec-kpi-main-value">${escapeHtml(opts.mainValue)}</div>` +
          (opts.mainValueSub ? `<div class="ds-exec-kpi-main-sub">${escapeHtml(opts.mainValueSub)}</div>` : "") +
        `</div>` +
        perfHtml +
        cmpHtml +
        `<div class="ds-exec-kpi-footer">` +
          rankHtml +
          `<div class="ds-exec-kpi-footer-right">${statusHtml}${trendHtml}</div>` +
        `</div>` +
      `</div>`
    );
  }

  function escapeAttrLocal(v) {
    return escapeHtml(v).replace(/"/g, "&quot;");
  }

  // =====================================================================
  // 1c. SELECT (single-select global filter, e.g. BU/Line/Period)
  // DS.select({ id, label, options: [{value,label}], value, disabled }) -> live DOM node
  //   Caller attaches its own 'change' listener to the returned node's
  //   <select> (node.querySelector('select')) -- this builder only
  //   renders + styles, same division of responsibility as the rest of
  //   this file. Unlike filterDropdown() (multi-select checkboxes, for
  //   Coverage's existing filter bar), this is for single-choice pickers
  //   -- simpler UX for BU/Line/Period/Comparison-Period, which are
  //   mutually exclusive choices, not multi-select facets.
  // =====================================================================
  function select(opts) {
    opts = opts || {};
    const options = opts.options || [];
    const id = opts.id || uid("ds-select");
    const optsHtml = options
      .map(o => `<option value="${escapeAttrLocal(o.value)}"${String(o.value) === String(opts.value) ? " selected" : ""}>${escapeHtml(o.label)}</option>`)
      .join("");
    const root = el(`
      <div class="ds-select-wrap">
        ${opts.label ? `<label class="ds-select-label" for="${id}">${escapeHtml(opts.label)}</label>` : ""}
        <select class="ds-select" id="${id}"${opts.disabled ? " disabled" : ""}>${optsHtml}</select>
      </div>
    `);
    return root;
  }

  // =====================================================================
  // 2. EXECUTIVE INSIGHT CARD
  // DS.insightCard({ title, variant, items, icon }) -> HTML string
  //   variant: "opportunity" | "risk" | "action" | "neutral"
  //   items: string[] (rendered as numbered ds-insight-item rows)
  // =====================================================================
  function insightCard(opts) {
    opts = opts || {};
    const variant = opts.variant || "neutral";
    const variantClass = variant === "neutral" ? "" : ` ds-insight-card--${variant}`;
    const iconHtml = opts.icon ? `<span>${escapeHtml(opts.icon)}</span>` : "";
    const items = Array.isArray(opts.items) ? opts.items : [];

    const bodyHtml = items.length
      ? items
          .map(
            (item, i) =>
              `<div class="ds-insight-item"><span class="ds-insight-item-index">${i + 1}</span>` +
              `<span>${escapeHtml(item)}</span></div>`
          )
          .join("")
      : `<div class="ds-insight-card-empty">No insights available for the current selection.</div>`;

    return (
      `<div class="ds-insight-card${variantClass}">` +
      `<div class="ds-insight-card-header">${iconHtml}${escapeHtml(opts.title || "")}</div>` +
      `<div class="ds-insight-card-body">${bodyHtml}</div>` +
      `</div>`
    );
  }

  // =====================================================================
  // 3. TABLE
  // DS.table({ columns, rows, compact, sortable }) -> HTML string
  //   columns: [{ key, label, align?: "left"|"right"|"center" }]
  //   rows: array of plain objects keyed by column.key
  // Sorting/pagination behavior (if needed) is wired by the caller via
  // data-sortable attributes; this builder only renders markup.
  // =====================================================================
  function table(opts) {
    opts = opts || {};
    const columns = opts.columns || [];
    const rows = opts.rows || [];
    const compactClass = opts.compact ? " ds-table--compact" : "";

    const theadHtml =
      "<tr>" +
      columns
        .map((c) => {
          const alignStyle = c.align ? ` style="text-align:${c.align}"` : "";
          const sortAttr = opts.sortable ? ` data-sortable data-key="${escapeHtml(c.key)}"` : "";
          return `<th${alignStyle}${sortAttr}>${escapeHtml(c.label)}</th>`;
        })
        .join("") +
      "</tr>";

    const tbodyHtml = rows.length
      ? rows
          .map((row) => {
            const cells = columns
              .map((c) => {
                const alignStyle = c.align ? ` style="text-align:${c.align}"` : "";
                const raw = typeof c.format === "function" ? c.format(row[c.key], row) : row[c.key];
                return `<td${alignStyle}>${raw === undefined || raw === null ? "" : escapeHtml(raw)}</td>`;
              })
              .join("");
            return `<tr>${cells}</tr>`;
          })
          .join("")
      : `<tr><td colspan="${columns.length}">` +
        emptyState({ title: "No data for current filters", hint: "Try widening the date range or clearing a filter." }) +
        `</td></tr>`;

    return (
      `<div class="ds-table-wrap ds-scrollbar-thin">` +
      `<table class="ds-table${compactClass}"><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table>` +
      `</div>`
    );
  }

  // =====================================================================
  // 4. CHART CONTAINER
  // DS.chartContainer({ title, subtitle, canvasId, actionsHtml }) -> HTML string
  //   Caller is responsible for instantiating Chart.js against canvasId
  //   after inserting this markup into the DOM.
  // =====================================================================
  function chartContainer(opts) {
    opts = opts || {};
    const canvasId = opts.canvasId || uid("ds-chart");
    const subtitleHtml = opts.subtitle ? `<div class="ds-chart-subtitle">${escapeHtml(opts.subtitle)}</div>` : "";
    const actionsHtml = opts.actionsHtml || "";
    return (
      `<div class="ds-chart-container">` +
      `<div class="ds-chart-header">` +
      `<div><div class="ds-chart-title">${escapeHtml(opts.title || "")}</div>${subtitleHtml}</div>` +
      `<div class="ds-chart-actions">${actionsHtml}</div>` +
      `</div>` +
      `<div class="ds-chart-body"><canvas id="${canvasId}"></canvas></div>` +
      `</div>`
    );
  }

  // =====================================================================
  // 5. FILTER DROPDOWN (searchable multi-select)
  // DS.filterDropdown({ label, options, selected, onChange, container })
  //   options: [{ value, label }]
  //   selected: Set<string> | string[]
  //   onChange(newSelectedArray) called on every checkbox toggle
  //   Returns the live root DOM node (already wired) — caller appends it.
  // =====================================================================
  function filterDropdown(opts) {
    opts = opts || {};
    const options = opts.options || [];
    let selected = new Set(opts.selected instanceof Set ? Array.from(opts.selected) : opts.selected || []);
    const id = uid("ds-filter");

    const root = el(`
      <div class="ds-filter">
        <label class="ds-filter-label">${escapeHtml(opts.label || "")}</label>
        <button type="button" class="ds-filter-trigger" id="${id}-trigger">
          <span class="ds-truncate" id="${id}-summary">All</span>
          <span>▾</span>
        </button>
        <div class="ds-filter-menu ds-scrollbar-thin" id="${id}-menu">
          <div class="ds-filter-menu-actions">
            <button type="button" data-action="all">Select all</button>
            <button type="button" data-action="none">Clear</button>
          </div>
          <div id="${id}-options"></div>
        </div>
      </div>
    `);

    const trigger = root.querySelector(`#${id}-trigger`);
    const menu = root.querySelector(`#${id}-menu`);
    const summary = root.querySelector(`#${id}-summary`);
    const optionsWrap = root.querySelector(`#${id}-options`);

    function renderOptions() {
      optionsWrap.innerHTML = options
        .map((o) => {
          const checked = selected.has(String(o.value)) ? "checked" : "";
          return (
            `<label class="ds-filter-option">` +
            `<input type="checkbox" value="${escapeHtml(o.value)}" ${checked}/>` +
            `<span>${escapeHtml(o.label)}</span></label>`
          );
        })
        .join("");
    }

    function renderSummary() {
      if (selected.size === 0 || selected.size === options.length) {
        summary.textContent = "All";
      } else if (selected.size === 1) {
        const opt = options.find((o) => String(o.value) === Array.from(selected)[0]);
        summary.textContent = opt ? opt.label : "1 selected";
      } else {
        summary.textContent = selected.size + " selected";
      }
      trigger.setAttribute("data-active", selected.size > 0 && selected.size < options.length ? "true" : "false");
    }

    function fireChange() {
      renderSummary();
      if (typeof opts.onChange === "function") opts.onChange(Array.from(selected));
    }

    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      const isOpen = menu.getAttribute("data-open") === "true";
      // close any other open DS filter menus first (single-open-at-a-time UX)
      document.querySelectorAll('.ds-filter-menu[data-open="true"]').forEach((m) => m.setAttribute("data-open", "false"));
      menu.setAttribute("data-open", isOpen ? "false" : "true");
    });

    optionsWrap.addEventListener("change", function (e) {
      if (e.target && e.target.type === "checkbox") {
        if (e.target.checked) selected.add(e.target.value);
        else selected.delete(e.target.value);
        fireChange();
      }
    });

    root.querySelector('[data-action="all"]').addEventListener("click", function () {
      selected = new Set(options.map((o) => String(o.value)));
      renderOptions();
      fireChange();
    });
    root.querySelector('[data-action="none"]').addEventListener("click", function () {
      selected = new Set();
      renderOptions();
      fireChange();
    });

    document.addEventListener("click", function (e) {
      if (!root.contains(e.target)) menu.setAttribute("data-open", "false");
    });

    renderOptions();
    renderSummary();

    root.getSelected = function () {
      return Array.from(selected);
    };
    root.setSelected = function (next) {
      selected = new Set(next);
      renderOptions();
      renderSummary();
    };

    return root;
  }

  // =====================================================================
  // 6. BUTTON
  // DS.button({ label, variant, size, icon, attrs }) -> HTML string
  //   variant: "primary" | "secondary" | "ghost" | "danger"
  // =====================================================================
  function button(opts) {
    opts = opts || {};
    const variant = opts.variant || "secondary";
    const sizeClass = opts.size === "sm" ? " ds-btn--sm" : "";
    const iconHtml = opts.icon ? `<span>${escapeHtml(opts.icon)}</span>` : "";
    const attrs = opts.attrs || "";
    return (
      `<button type="button" class="ds-btn ds-btn--${variant}${sizeClass}" ${attrs}>` +
      iconHtml +
      `<span>${escapeHtml(opts.label || "")}</span></button>`
    );
  }

  // =====================================================================
  // 7. NAVIGATION (in-workspace sub-tabs)
  // DS.tabs({ tabs, activeKey }) -> HTML string
  //   tabs: [{ key, label }]
  //   Caller wires click handling via [data-ds-tab] attribute selector.
  // =====================================================================
  function tabs(opts) {
    opts = opts || {};
    const items = opts.tabs || [];
    const activeKey = opts.activeKey;
    return (
      `<div class="ds-tabs" role="tablist">` +
      items
        .map((t) => {
          const activeClass = t.key === activeKey ? " ds-tab--active" : "";
          return `<button type="button" class="ds-tab${activeClass}" data-ds-tab="${escapeHtml(t.key)}" role="tab">${escapeHtml(t.label)}</button>`;
        })
        .join("") +
      `</div>`
    );
  }

  // =====================================================================
  // 8. EMPTY STATE
  // DS.emptyState({ title, hint, icon }) -> HTML string
  // =====================================================================
  function emptyState(opts) {
    opts = opts || {};
    const icon = opts.icon || "📭"; // mailbox-empty-ish default, workspaces can override
    return (
      `<div class="ds-empty-state">` +
      `<div class="ds-empty-state-icon">${icon}</div>` +
      `<div class="ds-empty-state-title">${escapeHtml(opts.title || "No data")}</div>` +
      (opts.hint ? `<div class="ds-empty-state-hint">${escapeHtml(opts.hint)}</div>` : "") +
      `</div>`
    );
  }

  // =====================================================================
  // 9. LOADING STATES
  // DS.loadingSpinner({ message }) -> HTML string
  // DS.skeleton({ width, height, radius }) -> HTML string
  // =====================================================================
  function loadingSpinner(opts) {
    opts = opts || {};
    return (
      `<div class="ds-loading-block">` +
      `<div class="ds-spinner"></div>` +
      (opts.message ? `<div class="ds-loading-text">${escapeHtml(opts.message)}</div>` : "") +
      `</div>`
    );
  }

  function skeleton(opts) {
    opts = opts || {};
    const width = opts.width || "100%";
    const height = opts.height || "16px";
    const radius = opts.radius || "var(--radius-md)";
    return `<div class="ds-skeleton ds-shimmer-bg" style="width:${escapeHtml(width)};height:${escapeHtml(height)};border-radius:${escapeHtml(radius)};"></div>`;
  }

  // =====================================================================
  // 10. EXPORT CONTROL
  // DS.exportButton({ formats, onExport }) -> live DOM node (wired)
  //   formats: array of { value, label } e.g. [{value:'xlsx',label:'Excel'}]
  //   onExport(formatValue) called when an option is clicked
  // =====================================================================
  function exportButton(opts) {
    opts = opts || {};
    const formats = opts.formats || [
      { value: "xlsx", label: "Excel" },
      { value: "png", label: "PNG" },
      { value: "pdf", label: "PDF" },
    ];
    const id = uid("ds-export");
    const root = el(`
      <div class="ds-export">
        <button type="button" class="ds-btn ds-btn--secondary" id="${id}-trigger">
          <span>⬇</span><span>Export</span>
        </button>
        <div class="ds-export-menu" id="${id}-menu">
          ${formats
            .map((f) => `<button type="button" class="ds-export-option" data-format="${escapeHtml(f.value)}">${escapeHtml(f.label)}</button>`)
            .join("")}
        </div>
      </div>
    `);

    const trigger = root.querySelector(`#${id}-trigger`);
    const menu = root.querySelector(`#${id}-menu`);

    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      const isOpen = menu.getAttribute("data-open") === "true";
      document.querySelectorAll('.ds-export-menu[data-open="true"]').forEach((m) => m.setAttribute("data-open", "false"));
      menu.setAttribute("data-open", isOpen ? "false" : "true");
    });

    menu.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-format]");
      if (!btn) return;
      menu.setAttribute("data-open", "false");
      if (typeof opts.onExport === "function") opts.onExport(btn.getAttribute("data-format"));
    });

    document.addEventListener("click", function (e) {
      if (!root.contains(e.target)) menu.setAttribute("data-open", "false");
    });

    return root;
  }

  // =====================================================================
  // 11. MODAL
  // DS.modal({ title, bodyHtml, footerHtml }) -> live overlay DOM node
  //   Node is appended to document.body by DS.openModal(); DS.closeModal()
  //   removes it. Only one DS modal is expected open at a time.
  // =====================================================================
  function buildModal(opts) {
    opts = opts || {};
    const overlay = el(`
      <div class="ds-modal-overlay" role="presentation">
        <div class="ds-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(opts.title || "Dialog")}">
          <div class="ds-modal-header">
            <div class="ds-modal-title">${escapeHtml(opts.title || "")}</div>
            <button type="button" class="ds-modal-close" aria-label="Close">✕</button>
          </div>
          <div class="ds-modal-body">${opts.bodyHtml || ""}</div>
          <div class="ds-modal-footer">${opts.footerHtml || ""}</div>
        </div>
      </div>
    `);

    function close() {
      overlay.setAttribute("data-open", "false");
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener("keydown", onKeydown);
    }
    function onKeydown(e) {
      if (e.key === "Escape") close();
    }

    overlay.querySelector(".ds-modal-close").addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKeydown);

    overlay.dsClose = close;
    return overlay;
  }

  function openModal(opts) {
    const overlay = buildModal(opts);
    document.body.appendChild(overlay);
    // force layout then flip data-open so the fade/scale-in animation runs
    requestAnimationFrame(() => overlay.setAttribute("data-open", "true"));
    return overlay;
  }

  function closeModal(overlayNode) {
    if (overlayNode && typeof overlayNode.dsClose === "function") overlayNode.dsClose();
  }

  // =====================================================================
  // 12. NOTIFICATIONS (toast)
  // DS.toast({ message, variant, duration }) -> appends + auto-removes
  //   variant: "success" | "warning" | "danger" | "info"
  // DS.notifBadge(count) -> HTML string (small unread-count pill)
  // =====================================================================
  let toastStack = null;
  function ensureToastStack() {
    if (!toastStack || !document.body.contains(toastStack)) {
      toastStack = el('<div class="ds-toast-stack"></div>');
      document.body.appendChild(toastStack);
    }
    return toastStack;
  }

  function toast(opts) {
    opts = opts || {};
    const variant = opts.variant || "info";
    const duration = opts.duration || 3200;
    const stack = ensureToastStack();
    const node = el(`<div class="ds-toast ds-toast--${variant}"><span>${escapeHtml(opts.message || "")}</span></div>`);
    stack.appendChild(node);
    setTimeout(() => {
      node.style.animation = "ds-fade-out var(--transition-base) both";
      setTimeout(() => node.remove(), 220);
    }, duration);
    return node;
  }

  function notifBadge(count) {
    if (!count || count <= 0) return "";
    return `<span class="ds-notif-badge">${count > 99 ? "99+" : escapeHtml(count)}</span>`;
  }

  // =====================================================================
  // 13. TOOLTIP
  // Pure CSS via [data-tooltip="..."] (see components.css) — this helper
  // just documents/attaches it programmatically for dynamically-built
  // nodes where authoring the attribute inline isn't convenient.
  // DS.attachTooltip(node, text) -> void
  // =====================================================================
  function attachTooltip(node, text) {
    if (!node) return;
    node.setAttribute("data-tooltip", text);
  }

  // =====================================================================
  // 14. CUSTOMER BRIDGE (New / Retained / Reactivated / Lost walk)
  // DS.customerBridge({ startLabel, startValue, newV, retainedV, reactivatedV,
  //   lostV, endLabel, endValue }) -> HTML string
  //   A compact "customer walk" -- prior-period total, each movement as a
  //   signed segment, net change, current-period total. Not a literal
  //   waterfall chart (no canvas dependency, consistent with every other
  //   builder in this file being plain HTML/CSS) -- a row of styled
  //   segments reads just as clearly at this scale (4 movements) and
  //   avoids introducing a canvas-lifecycle dependency into the modal
  //   system purely for one chart type.
  // =====================================================================
  function customerBridge(opts) {
    opts = opts || {};
    const segs = [
      { label: "New", value: opts.newV, sign: "+", variant: "info" },
      { label: "Retained", value: opts.retainedV, sign: "", variant: "success" },
      { label: "Reactivated", value: opts.reactivatedV, sign: "+", variant: "success" },
      { label: "Lost", value: opts.lostV, sign: "-", variant: "danger" },
    ];
    const net = (opts.newV || 0) + (opts.reactivatedV || 0) - (opts.lostV || 0);
    const netSign = net > 0 ? "+" : "";
    const netVariant = net > 0 ? "success" : net < 0 ? "danger" : "neutral";

    const segsHtml = segs.map(s => `
      <div class="ds-bridge-seg">
        <div class="ds-bridge-seg-value ds-bridge-seg-value--${s.variant}">${s.sign}${escapeHtml((s.value || 0).toLocaleString())}</div>
        <div class="ds-bridge-seg-label">${escapeHtml(s.label)}</div>
      </div>`).join(`<div class="ds-bridge-arrow">&rarr;</div>`);

    return `
      <div class="ds-bridge">
        <div class="ds-bridge-endpoint">
          <div class="ds-bridge-endpoint-value">${escapeHtml((opts.startValue || 0).toLocaleString())}</div>
          <div class="ds-bridge-endpoint-label">${escapeHtml(opts.startLabel || "Prior period")}</div>
        </div>
        <div class="ds-bridge-arrow">&rarr;</div>
        ${segsHtml}
        <div class="ds-bridge-arrow">&rarr;</div>
        <div class="ds-bridge-endpoint">
          <div class="ds-bridge-endpoint-value">${escapeHtml((opts.endValue || 0).toLocaleString())}</div>
          <div class="ds-bridge-endpoint-label">${escapeHtml(opts.endLabel || "Current period")}</div>
        </div>
      </div>
      <div class="ds-bridge-net ds-bridge-net--${netVariant}">Net change: ${netSign}${escapeHtml(net.toLocaleString())} customers</div>
    `;
  }

  // =====================================================================
  // 15. SEGMENT BAR (100%-stacked horizontal bar, 2-4 categories)
  // DS.segmentBar({ segments: [{label, value, variant}], total }) -> HTML string
  //   Used for Frequency (Frequent/Occasional/One-time) and Basket
  //   (Full/Partial/None) breakdowns -- deliberately not a pie chart
  //   (harder to compare proportions at a glance past 2-3 slices).
  // =====================================================================
  function segmentBar(opts) {
    opts = opts || {};
    const segments = opts.segments || [];
    const total = opts.total !== undefined ? opts.total : segments.reduce((s, x) => s + (x.value || 0), 0);
    const barHtml = segments.map(s => {
      const pct = total > 0 ? (s.value / total) * 100 : 0;
      return `<div class="ds-segbar-slice ds-segbar-slice--${s.variant || "neutral"}" style="width:${pct.toFixed(2)}%" data-tooltip="${escapeAttrLocal(s.label)}: ${escapeAttrLocal((s.value || 0).toLocaleString())} (${pct.toFixed(1)}%)"></div>`;
    }).join("");
    const legendHtml = segments.map(s => {
      const pct = total > 0 ? (s.value / total) * 100 : 0;
      return `<div class="ds-segbar-legend-item">
        <span class="ds-segbar-dot ds-segbar-dot--${s.variant || "neutral"}"></span>
        <span class="ds-segbar-legend-label">${escapeHtml(s.label)}</span>
        <span class="ds-segbar-legend-value">${escapeHtml((s.value || 0).toLocaleString())} (${pct.toFixed(1)}%)</span>
      </div>`;
    }).join("");
    return `<div class="ds-segbar-wrap">
      <div class="ds-segbar">${barHtml}</div>
      <div class="ds-segbar-legend">${legendHtml}</div>
    </div>`;
  }

  // =====================================================================
  // 16. RANKED BAR LIST (horizontal Pareto-style ranking)
  // DS.rankedBarList({ items: [{label, value, pctLabel}], maxItems }) -> HTML string
  //   Used for SKU penetration -- a ranked horizontal bar scans faster
  //   than a table of numbers when the question is "which items matter."
  // =====================================================================
  function rankedBarList(opts) {
    opts = opts || {};
    const items = (opts.items || []).slice(0, opts.maxItems || 10);
    const maxVal = Math.max(1, ...items.map(it => it.value || 0));
    const rowsHtml = items.map(it => {
      const pct = (it.value / maxVal) * 100;
      return `<div class="ds-rankedbar-row">
        <div class="ds-rankedbar-label" title="${escapeAttrLocal(it.label)}">${escapeHtml(it.label)}</div>
        <div class="ds-rankedbar-track"><div class="ds-rankedbar-fill" style="width:${pct.toFixed(2)}%"></div></div>
        <div class="ds-rankedbar-value">${escapeHtml(it.pctLabel !== undefined ? it.pctLabel : it.value)}</div>
      </div>`;
    }).join("");
    return `<div class="ds-rankedbar-list">${rowsHtml}</div>`;
  }

  // =====================================================================
  // 17. DATA GRID (searchable / sortable / paginated / CSV-exportable)
  // DS.dataGrid({ id, columns, rows, pageSize, searchKeys, searchPlaceholder })
  //   -> HTML string (static shell + mount point)
  // DS.mountDataGrid(id, { columns, rows, pageSize, searchKeys }) -> void
  //   Call AFTER the shell above is in the live DOM (same
  //   setTimeout(...,0)-after-openModal pattern every other drill-down
  //   in this app already uses). Needed because DS.table has no
  //   pagination -- fine for the ~100-row Brand/Item lists, unusable for
  //   a 45,000-row customer list. All interaction re-renders only the
  //   grid's own body/pager, not the whole modal.
  // =====================================================================
  function dataGrid(opts) {
    opts = opts || {};
    const id = opts.id || uid("ds-grid");
    return `
      <div class="ds-datagrid" id="${id}">
        <div class="ds-datagrid-toolbar">
          <input type="text" class="ds-datagrid-search" placeholder="${escapeAttrLocal(opts.searchPlaceholder || "Search...")}" />
          <button type="button" class="ds-datagrid-export" data-tooltip="Download the current filtered list as CSV">Export CSV</button>
        </div>
        <div class="ds-datagrid-table-mount"></div>
        <div class="ds-datagrid-pager"></div>
      </div>`;
  }

  function mountDataGrid(id, opts) {
    const root = document.getElementById(id);
    if (!root) return;
    const columns = opts.columns || [];
    const allRows = opts.rows || [];
    const pageSize = opts.pageSize || 25;
    const searchKeys = opts.searchKeys || [];

    const state = { page: 0, sortKey: null, sortDir: "asc", query: "" };
    const tableMount = root.querySelector(".ds-datagrid-table-mount");
    const pagerMount = root.querySelector(".ds-datagrid-pager");
    const searchInput = root.querySelector(".ds-datagrid-search");
    const exportBtn = root.querySelector(".ds-datagrid-export");

    function filteredSorted() {
      let rows = allRows;
      if (state.query) {
        const q = state.query.toLowerCase();
        rows = rows.filter(r => searchKeys.some(k => String(r[k] === undefined || r[k] === null ? "" : r[k]).toLowerCase().indexOf(q) >= 0));
      }
      if (state.sortKey) {
        const key = state.sortKey, dir = state.sortDir;
        rows = rows.slice().sort((a, b) => {
          const av = a[key], bv = b[key];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return dir === "asc" ? cmp : -cmp;
        });
      }
      return rows;
    }

    function render() {
      const rows = filteredSorted();
      const total = rows.length;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      state.page = Math.min(state.page, pageCount - 1);
      const start = state.page * pageSize;
      const pageRows = rows.slice(start, start + pageSize);

      const theadHtml = "<tr>" + columns.map(c => {
        const isSorted = state.sortKey === c.key;
        const arrow = isSorted ? (state.sortDir === "asc" ? " &uarr;" : " &darr;") : "";
        const alignStyle = c.align ? ` style="text-align:${c.align}"` : "";
        return `<th${alignStyle} data-key="${escapeAttrLocal(c.key)}" class="ds-datagrid-th">${escapeHtml(c.label)}${arrow}</th>`;
      }).join("") + "</tr>";

      const tbodyHtml = pageRows.length
        ? pageRows.map(row => {
            const cells = columns.map(c => {
              const alignStyle = c.align ? ` style="text-align:${c.align}"` : "";
              const raw = typeof c.format === "function" ? c.format(row[c.key], row) : row[c.key];
              return `<td${alignStyle}>${raw === undefined || raw === null ? "" : escapeHtml(raw)}</td>`;
            }).join("");
            return `<tr>${cells}</tr>`;
          }).join("")
        : `<tr><td colspan="${columns.length}" style="text-align:center;padding:24px;color:var(--color-text-tertiary,#94A3B8);">No matching rows.</td></tr>`;

      tableMount.innerHTML = `<div class="ds-table-wrap ds-scrollbar-thin"><table class="ds-table ds-table--compact"><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table></div>`;
      pagerMount.innerHTML = `
        <div class="ds-datagrid-pager-info">${total.toLocaleString()} row${total === 1 ? "" : "s"} -- page ${state.page + 1} of ${pageCount}</div>
        <div class="ds-datagrid-pager-controls">
          <button type="button" class="ds-datagrid-pg-prev" ${state.page === 0 ? "disabled" : ""}>&larr; Prev</button>
          <button type="button" class="ds-datagrid-pg-next" ${state.page >= pageCount - 1 ? "disabled" : ""}>Next &rarr;</button>
        </div>`;

      tableMount.querySelectorAll(".ds-datagrid-th").forEach(th => {
        th.addEventListener("click", () => {
          const key = th.getAttribute("data-key");
          if (state.sortKey === key) {
            state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
          } else {
            state.sortKey = key;
            state.sortDir = "asc";
          }
          render();
        });
      });
      const prevBtn = pagerMount.querySelector(".ds-datagrid-pg-prev");
      const nextBtn = pagerMount.querySelector(".ds-datagrid-pg-next");
      if (prevBtn) prevBtn.addEventListener("click", () => { state.page = Math.max(0, state.page - 1); render(); });
      if (nextBtn) nextBtn.addEventListener("click", () => { state.page = Math.min(pageCount - 1, state.page + 1); render(); });
    }

    let searchDebounce = null;
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        clearTimeout(searchDebounce);
        const val = e.target.value;
        searchDebounce = setTimeout(() => { state.query = val; state.page = 0; render(); }, 180);
      });
    }
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const rows = filteredSorted();
        const header = columns.map(c => c.label).join(",");
        const csvRows = rows.map(row => columns.map(c => {
          const raw = typeof c.format === "function" ? c.format(row[c.key], row) : row[c.key];
          const s = raw === undefined || raw === null ? "" : String(raw);
          return '"' + s.replace(/"/g, '""') + '"';
        }).join(","));
        const csv = [header].concat(csvRows).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = (opts.exportFilename || "export") + ".csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }

    render();
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------
  global.DS = {
    // 1-2: cards
    kpiCard: kpiCard,
    executiveKpiCard: executiveKpiCard,
    select: select,
    insightCard: insightCard,
    // 3-4: data display
    table: table,
    chartContainer: chartContainer,
    // 5: filters
    filterDropdown: filterDropdown,
    // 6-7: controls / nav
    button: button,
    tabs: tabs,
    // 8-9: states
    emptyState: emptyState,
    loadingSpinner: loadingSpinner,
    skeleton: skeleton,
    // 10: export
    exportButton: exportButton,
    // 11: modal
    openModal: openModal,
    closeModal: closeModal,
    // 12: notifications
    toast: toast,
    notifBadge: notifBadge,
    // 13: tooltip
    attachTooltip: attachTooltip,
    // 14-17: customer analytics visuals
    customerBridge: customerBridge,
    segmentBar: segmentBar,
    rankedBarList: rankedBarList,
    dataGrid: dataGrid,
    mountDataGrid: mountDataGrid,
    // internal helpers exposed for advanced/edge-case use by workspaces
    _escapeHtml: escapeHtml,
    _el: el,
    _uid: uid,
  };
})(window);
