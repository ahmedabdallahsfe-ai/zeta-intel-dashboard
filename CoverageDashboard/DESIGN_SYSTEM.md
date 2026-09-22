# Zeta Enterprise Design System

**Status:** Phase 3 foundation — additive, not yet consumed by any live workspace.
**Ownership:** The Design System belongs to the Enterprise Platform, not to any individual
workspace. Every workspace consumes it. No workspace owns it or forks it.
**Validate here first:** [`design-system-preview.html`](./design-system-preview.html) renders
every token and component in isolation, with no dependency on `dashboard.html` or any cache file.
Open it directly to review the foundation before any migration work begins.

---

## 1. File structure

```
css/
  design-system.css   tokens only — colors, type scale, spacing, radius, shadow, transition, z-index
  animations.css       keyframes + animation utility classes (the platform "Animation System")
  layout.css           structural grids/flex primitives (no color, no typography)
  components.css       one canonical implementation per component, built on the tokens above
  utilities.css         small set of single-purpose helpers (truncation, visually-hidden, spacing overrides)

js/
  components.js        window.DS — builder functions for every interactive/rendered component
```

**Load order** (required — later files assume earlier ones are present):

```html
<link rel="stylesheet" href="css/design-system.css" />
<link rel="stylesheet" href="css/animations.css" />
<link rel="stylesheet" href="css/layout.css" />
<link rel="stylesheet" href="css/components.css" />
<link rel="stylesheet" href="css/utilities.css" />
<script src="js/components.js"></script>
```

`utilities.css` loads last on purpose — utility classes are meant to win the cascade when applied
directly in markup.

### Naming and collision safety

Every selector in this system is prefixed `.ds-` (or targets `[data-tooltip]`). This was chosen
specifically so nothing here can collide with the class names already in use by existing
workspaces: `.sc-*` (Sales), `.sfe-*` (Sales Force Effectiveness), `.iqvia-*` under
`.iqvia-dashboard-wrap` (Market Intelligence), or Coverage's unprefixed `.card`/`.badge`/etc.
Migrating a workspace onto the design system means adopting `.ds-*` markup, not merging
namespaces.

### A note on `js/ui.js`, `js/charts.js`, `js/filters.js`

The platform brief for this phase named four shared JS files: `components.js`, `ui.js`,
`charts.js`, `filters.js`. Three of those names — `js/ui.js`, `js/charts.js`, `js/filters.js` —
already exist today as live, Coverage-specific files that the Coverage workspace depends on in
production. Rewriting them now would mean modifying a live workspace's dependencies before this
foundation has been validated independently, which the brief explicitly said not to do.

For this phase, **all new shared component logic lives in `js/components.js` only**, exposed as
`window.DS`. Reconciling or retiring the existing `js/ui.js` / `js/charts.js` / `js/filters.js`
into this namespace is planned for their turn in the one-workspace-at-a-time migration phase
(Coverage → Sales → SFE → IQVIA), not before. This is a scope decision, not an oversight — flagged
here so it's explicit rather than silently discovered later.

---

## 2. Design tokens (`design-system.css`)

All tokens are CSS custom properties on `:root`. Components must consume tokens — never a literal
hex value, pixel size, or duration — so a future rebrand or density change is a one-file edit.

### Color

| Token | Value | Usage |
|---|---|---|
| `--color-primary` | `#0F4C81` | Primary brand color — buttons, active states, links, chart series 1 |
| `--color-primary-hover` | `#0B3A63` | Hover state for primary elements |
| `--color-primary-active` | `#082C4C` | Pressed/active state |
| `--color-primary-light` | `#E8F0F7` | Tinted backgrounds, selected filter chips |
| `--color-success` / `-light` | `#15803D` / `#DCFCE7` | Positive deltas, success toasts, achieved targets |
| `--color-warning` / `-light` | `#B45309` / `#FEF3C7` | At-risk states, warning toasts |
| `--color-danger` / `-light` | `#DC2626` / `#FEE2E2` | Negative deltas, critical states, destructive actions |
| `--color-info` / `-light` | `#0891B2` / `#CFFAFE` | Informational callouts, neutral notices |
| `--color-background` | `#F4F6F9` | App/page background |
| `--color-surface` | `#FFFFFF` | Card/panel background |
| `--color-surface-alt` | `#F8FAFC` | Secondary surface — table headers, KPI tiles |
| `--color-surface-inverse` | `#0F172A` | Dark surfaces — tooltips, dark toasts |
| `--color-border` / `-strong` | `#E2E8F0` / `#CBD5E1` | Dividers, card borders, input borders |
| `--color-text-primary` | `#0F172A` | Headings, body copy, values |
| `--color-text-secondary` | `#64748B` | Labels, captions, secondary copy |
| `--color-text-tertiary` | `#94A3B8` | Placeholder text, hints |
| `--color-text-inverse` | `#FFFFFF` | Text on dark/colored backgrounds |

**Why `#0F4C81`:** it is the color already used for the brand/logo text in the sidebar
(`dashboard.html .brand-text`) — the one place brand identity was already explicit before this
system existed. `#E2E8F0` (border) and `#64748B` (secondary text) were near-universal across all
four existing modules already; that consensus is preserved rather than replaced.

### Categorical chart palette

`--chart-1` through `--chart-10`, ordered so any chart with N categories looks identical
regardless of which workspace renders it. Series/slices should always consume in order
(1, 2, 3…) rather than picking colors arbitrarily.

### Typography

`--font-family-base` (Inter/system stack), `--font-family-mono`. Fluid type scale via `clamp()` —
`--fs-xs` through `--fs-3xl`, plus `--fs-kpi-value` for headline KPI numbers — so every workspace
scales identically across laptop and external-monitor widths. This pattern is inherited from
IQVIA, which was the only existing module to have tokenized type before this file existed.
Weights: `--fw-regular` (400) through `--fw-black` (800). Line heights: `--line-height-tight/base/loose`.

### Spacing, radius, shadow, motion, z-index

- Spacing: `--space-1` (4px) through `--space-12` (48px), a strict 4px rhythm.
- Radius: `--radius-sm` (4px) through `--radius-2xl` (16px), plus `--radius-full` for pills/avatars.
- Shadow: `--shadow-xs/sm/md/lg`, plus `--shadow-hover` and `--shadow-focus` (primary-tinted ring).
- Transition: `--transition-fast` (0.15s), `--transition-base` (0.2s), `--transition-slow` (0.3s
  cubic-bezier), `--transition-sidebar` (matches the existing sidebar-collapse feel).
- Z-index: named scale — `--z-dropdown` (100), `--z-sticky` (200), `--z-overlay` (900),
  `--z-modal` (1000), `--z-toast` (1100), `--z-tooltip` (1200) — so components never guess.

---

## 3. Animation system (`animations.css`)

Keyframes: `ds-spin`, `ds-fade-in`, `ds-fade-out`, `ds-slide-in-right`, `ds-slide-up`,
`ds-shimmer`, `ds-pulse`, `ds-scale-in`.

Utility classes: `.ds-animate-fade-in`, `-slide-in`, `-slide-up`, `-scale-in`, `-spin`, `-pulse`.
Stagger a grid of cards with `.ds-stagger-1` through `.ds-stagger-6` (0.03s increments) alongside
an animate class. `.ds-shimmer-bg` supplies the moving-gradient background for skeleton loaders.

All animation and transition is disabled under `@media (prefers-reduced-motion: reduce)`.

---

## 4. Layout primitives (`layout.css`)

- `.ds-page` — top-level page padding/gap wrapper.
- `.ds-section`, `.ds-section-header` — a titled block with a trailing action area.
- `.ds-grid-kpi` — auto-fitting KPI row, minimum 180px per tile.
- `.ds-grid-2/-3/-4` — equal-width grids, collapsing to fewer columns at 1024px/640px.
- `.ds-grid-main-side` — 2fr/1fr chart-plus-sidebar layout, collapsing to one column at 1024px.
- Flex helpers: `.ds-flex`, `.ds-flex-col`, `.ds-flex-wrap`, `.ds-items-*`, `.ds-justify-*`, `.ds-gap-1..6`.
- `.ds-panel-fixed-width` — 280px fixed sidebar (240px under 1024px), for filter panels.

---

## 5. Components (`components.css` + `js/components.js`)

Every component below has exactly one implementation. `DS.*` builder functions return either an
HTML string (insert directly) or a live wired DOM node (dropdowns, modal, export button, toast —
anything with attached event listeners).

| # | Component | CSS classes | JS builder |
|---|---|---|---|
| 1 | KPI Card | `.ds-kpi-card`, `.ds-kpi-label`, `.ds-kpi-value`, `.ds-kpi-delta--up/down/flat` | `DS.kpiCard({label, value, delta, direction})` |
| 2 | Executive Insight Card | `.ds-insight-card--opportunity/risk/action`, `.ds-insight-item` | `DS.insightCard({title, variant, icon, items})` |
| 3 | Table | `.ds-table-wrap`, `.ds-table`, `.ds-table--compact` | `DS.table({columns, rows, compact, sortable})` |
| 4 | Chart Container | `.ds-chart-container`, `.ds-chart-header/-title/-subtitle/-actions/-body` | `DS.chartContainer({title, subtitle, canvasId, actionsHtml})` |
| 5 | Filter Control | `.ds-filter`, `.ds-filter-trigger`, `.ds-filter-menu`, `.ds-filter-option` | `DS.filterDropdown({label, options, selected, onChange})` — returns a live node |
| 6 | Button | `.ds-btn--primary/secondary/ghost/danger`, `.ds-btn--sm` | `DS.button({label, variant, size, icon, attrs})` |
| 7 | Navigation (sub-tabs) | `.ds-tabs`, `.ds-tab`, `.ds-tab--active` | `DS.tabs({tabs, activeKey})` — wire clicks via `[data-ds-tab]` |
| 8 | Empty State | `.ds-empty-state`, `-icon`, `-title`, `-hint` | `DS.emptyState({title, hint, icon})` |
| 9 | Loading State | `.ds-spinner`, `.ds-loading-block`, `.ds-skeleton` + `.ds-shimmer-bg` | `DS.loadingSpinner({message})`, `DS.skeleton({width, height, radius})` |
| 10 | Export Control | `.ds-export`, `.ds-export-trigger`, `.ds-export-menu`, `.ds-export-option` | `DS.exportButton({formats, onExport})` — returns a live node |
| 11 | Modal | `.ds-modal-overlay`, `.ds-modal`, `-header/-body/-footer` | `DS.openModal({title, bodyHtml, footerHtml})`, `DS.closeModal(node)` |
| 12 | Notifications | `.ds-toast-stack`, `.ds-toast--success/warning/danger/info`, `.ds-notif-badge` | `DS.toast({message, variant, duration})`, `DS.notifBadge(count)` |
| 13 | Tooltip | `[data-tooltip]` (pure CSS, no wrapper markup needed) | `DS.attachTooltip(node, text)` for dynamically-built nodes |

### Usage examples

```js
// KPI row
container.innerHTML = DS.kpiCard({
  label: "Actual Sales", value: "EGP 237.6M", delta: "4.2% vs prior period", direction: "up"
});

// Table with a formatter
container.innerHTML = DS.table({
  columns: [
    { key: "rep", label: "Rep" },
    { key: "sales", label: "Sales", align: "right", format: v => Number(v).toLocaleString() }
  ],
  rows: repRows
});

// Filter dropdown (live node — must be appended, not stringified)
const regionFilter = DS.filterDropdown({
  label: "Region", options: regionOptions, selected: ["cairo"],
  onChange: (selected) => applyRegionFilter(selected)
});
filterBar.appendChild(regionFilter);

// Modal
DS.openModal({
  title: "Confirm Export",
  bodyHtml: "<p>Export the current view as Excel?</p>",
  footerHtml: DS.button({label:"Cancel",variant:"ghost",attrs:'onclick="DS.closeModal(this.closest(\'.ds-modal-overlay\'))"'}) +
              DS.button({label:"Confirm",variant:"primary",attrs:'onclick="DS.closeModal(this.closest(\'.ds-modal-overlay\'))"'})
});

// Toast
DS.toast({ message: "Export complete", variant: "success" });
```

---

## 6. Utilities (`utilities.css`)

Deliberately small — not a Tailwind-style utility framework. Only recurring, single-purpose
helpers: `.ds-truncate`, `.ds-clamp-2` (text truncation), `.ds-visually-hidden` (a11y labels),
`.ds-text-success/warning/danger/muted/mono`, `.ds-font-medium/semibold/bold`,
`.ds-text-right/center`, `.ds-mt-0/2/4/6` + `.ds-mb-0/2/4` (spacing escape hatches),
`.ds-divider`, `.ds-scrollbar-thin` (opt-in slim scrollbar), `.ds-clickable`, `.ds-disabled`,
`.ds-full-width`, `.ds-hidden`, `.ds-inline-block`.

---

## 7. Migration plan (not yet started)

Per the approved phased approach: this foundation ships additively first and is validated
independently via `design-system-preview.html`. Only after that validation is approved does
migration begin, one workspace at a time, with regression testing after each:

1. Coverage & Frequency
2. Sales Performance
3. Sales Force Effectiveness (Organogram)
4. Market Intelligence (IQVIA)

Each migration replaces a workspace's local card/table/button/filter/modal/toast markup with the
equivalent `.ds-*` component, removes the now-duplicated local CSS, and is regression-tested
against its own KPI output before being considered complete. No workspace's calculations, cache
schema, or business logic change as part of this — only presentation.
