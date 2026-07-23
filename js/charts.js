/**
 * charts.js
 * =========
 * Chart.js wrappers. Two rules kept throughout this file:
 *
 * 1. Charts are created ONCE and updated in place on every filter change
 *    (mutate `.data` then call `.update()`), never destroyed and
 *    recreated -- recreating on every filter click is slow and causes
 *    visible flicker.
 * 2. Category colors (teams, managers, etc.) are assigned by a stable
 *    hash of the category name, not by array index -- otherwise colors
 *    reshuffle every time the filtered/sorted category list changes
 *    length or order, which makes cross-chart comparison harder.
 */

const Charts = (() => {
  const registry = new Map(); // canvasId -> Chart.js instance

  /** Deterministic color assignment: same name always gets the same
   * color, regardless of what else is currently in the dataset. */
  function colorFor(name) {
    const palette = CONFIG.chartColors;
    let hash = 0;
    const str = String(name || "");
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return palette[hash % palette.length];
  }

  function baseOptions(overrides = {}) {
    return Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: true, position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { enabled: true },
      },
    }, overrides);
  }

  /** Shared tooltip label callback for percentage charts: formats the
   * data point value as "82.2%" regardless of how Chart.js received it. */
  const pctTooltipLabel = (ctx) => ` ${Number(ctx.parsed.y ?? ctx.parsed).toFixed(1)}%`;
  const pctXTooltipLabel = (ctx) => ` ${Number(ctx.parsed.x ?? ctx.parsed).toFixed(1)}%`;

  /** Line chart for trend series (Coverage%, Right Freq%, Headcount).
   * Values must be passed as 0-100 (not 0-1 fractions) so axis ticks
   * and tooltips render as "82.2%" without a separate scale transform. */
  function lineChart(canvasId, labels, datasets) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    if (registry.has(canvasId)) {
      const chart = registry.get(canvasId);
      chart.data.labels = labels;
      chart.data.datasets = datasets;
      chart.update();
      return chart;
    }
    const chart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: baseOptions({
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => v + "%" } },
        },
        elements: { line: { tension: 0.3 }, point: { radius: 3 } },
        plugins: { tooltip: { callbacks: { label: pctTooltipLabel } } },
      }),
    });
    registry.set(canvasId, chart);
    return chart;
  }

  /** Horizontal bar chart for comparisons/rankings (bars always start at
   * 0 -- never truncate the axis, per standard BI chart practice).
   * Values must be passed as 0-100 (not 0-1 fractions) for percent charts. */
  function horizontalBarChart(canvasId, labels, datasets, optionsOverride = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    if (registry.has(canvasId)) {
      const chart = registry.get(canvasId);
      chart.data.labels = labels;
      chart.data.datasets = datasets;
      chart.update();
      return chart;
    }
    const chart = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets },
      options: baseOptions(Object.assign({
        indexAxis: "y",
        scales: { x: { beginAtZero: true, ticks: { callback: (v) => v + "%" } } },
        plugins: { tooltip: { callbacks: { label: pctXTooltipLabel } } },
      }, optionsOverride)),
    });
    registry.set(canvasId, chart);
    return chart;
  }

  /** Doughnut chart (used sparingly -- e.g. status/tenure-style splits).
   *  `optionsOverride` is merged into baseOptions so callers can add
   *  tooltip callbacks, cutout changes, etc. without a full fork. */
  function doughnutChart(canvasId, labels, values, optionsOverride = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    const colors = labels.map(colorFor);
    if (registry.has(canvasId)) {
      const chart = registry.get(canvasId);
      chart.data.labels = labels;
      chart.data.datasets[0].data = values;
      chart.data.datasets[0].backgroundColor = colors;
      chart.update();
      return chart;
    }
    const chart = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
      options: baseOptions(Object.assign({ cutout: "60%" }, optionsOverride)),
    });
    registry.set(canvasId, chart);
    return chart;
  }

  /** Builds a single-series dataset with per-point stable colors. */
  function coloredBarDataset(label, categories, values) {
    return {
      label,
      data: values,
      backgroundColor: categories.map(colorFor),
      borderRadius: 3,
      barPercentage: 0.7,
    };
  }

  /** Builds a two-series line/percent dataset pair with the primary/
   * success palette colors (used for Coverage%/Right Freq% trend). */
  function percentSeries(label, values, colorKey) {
    return {
      label,
      data: values,
      borderColor: colorKey,
      backgroundColor: colorKey,
      fill: false,
    };
  }

  function destroyAll() {
    registry.forEach((chart) => chart.destroy());
    registry.clear();
  }

  /** Look up an already-created Chart.js instance by canvas id (used by
   * exporter.js for PNG export -- exporter.js has no reason to know about
   * the registry's internals, just whether a given chart currently exists). */
  function getChart(canvasId) {
    return registry.get(canvasId) || null;
  }

  return { lineChart, horizontalBarChart, doughnutChart, coloredBarDataset, percentSeries, colorFor, destroyAll, getChart };
})();
