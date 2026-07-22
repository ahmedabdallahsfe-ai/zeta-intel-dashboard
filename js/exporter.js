/**
 * exporter.js
 * ===========
 * Phase 4: every export path on the dashboard -- table-to-Excel,
 * chart-to-PNG, dashboard-to-PDF -- lives in this one module so
 * tables.js/charts.js/app.js stay focused on rendering, not I/O.
 *
 * Libraries used (both vendored locally in assets/, never a CDN, so the
 * dashboard keeps working with zero internet connection):
 *   - assets/xlsx.core.min.js (SheetJS "core" build) for .xlsx writing.
 *     We deliberately use the smaller "core" build, not "full" -- this
 *     dashboard only ever WRITES workbooks built from its own in-memory
 *     data, it never reads/parses a user-supplied .xlsx, so none of the
 *     extra format parsers in the full build (ODS, XLS, DIF, PRN, RTF,
 *     SYLK, legacy codepages...) are needed. Smaller file, faster load,
 *     and a smaller surface for the two known SheetJS advisories
 *     (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9), both of which are
 *     triggered by PARSING an untrusted file -- a codepath this
 *     dashboard never exercises. Documented here so this isn't a silent
 *     risk if the project is extended later to import a workbook.
 *   - Chart.js's own built-in `chart.toBase64Image()` for PNG export --
 *     no extra library needed.
 *   - `window.print()` + a dedicated @media print stylesheet for PDF
 *     export -- Chrome's native print-to-PDF is the most reliable path
 *     for a file:// page with no server, and it captures exactly the
 *     on-screen filtered state, which is what "Export Dashboard as PDF"
 *     should mean.
 */

const Exporter = (() => {
  /** Turn a filter-derived label into a safe file name fragment. */
  function sanitize(str) {
    return String(str || "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /** Build a short, human-readable suffix from the active filter state,
   * e.g. "Team-CVM-I_Period-June" -- so two exports taken under
   * different filters never silently collide or overwrite each other,
   * and the filename alone tells you what the numbers represent. Only
   * non-default filters are included; an unfiltered export gets
   * "AllData" instead of a long list of "-All" suffixes. */
  function filenameSuffixFromFilters(filterState) {
    if (!filterState) return "AllData";
    const parts = [];
    CONFIG.filters.fields.forEach((f) => {
      const val = filterState[f.id];
      // v3 state: ALL fields including period are arrays ([] = default)
      const isDefault = Array.isArray(val) ? val.length === 0 : val === "all";
      if (!isDefault && val !== undefined && val !== null) {
        const displayVal = Array.isArray(val)
          ? (val.length === 1 ? val[0] : `${val.length}selected`)
          : val;
        parts.push(`${sanitize(f.label)}-${sanitize(displayVal)}`);
      }
    });
    return parts.length ? parts.join("_") : "AllData";
  }

  /** Convert a 0-1 fraction column to a plain 1-decimal percentage
   * number (82.2 rather than 0.822) so the exported cell reads exactly
   * like the on-screen "82.2%" without needing a custom Excel number
   * format -- simplest, most portable choice for a business audience
   * who will likely just eyeball or re-chart the export in Excel. */
  function cellValue(row, column) {
    const raw = row[column.key];
    if (raw === null || raw === undefined) return "";
    if (column.format === "percent1" && typeof raw === "number") {
      return Math.round(raw * 1000) / 10;
    }
    if (typeof raw === "number") return raw;
    return String(raw);
  }

  /**
   * Export a table's current sorted + filtered + searched rows to .xlsx.
   * `columns`/`rows` are exactly what tables.js already has in hand at
   * click time (post-search, post-sort) -- what the user sees is what
   * they get, not the full unfiltered dataset.
   */
  function tableToExcel(columns, rows, filenameBase) {
    if (typeof XLSX === "undefined") {
      console.warn("[Exporter] SheetJS (assets/xlsx.core.min.js) is not loaded -- cannot export.");
      return false;
    }
    if (!rows || !rows.length) {
      console.warn("[Exporter] Nothing to export -- table has no visible rows.");
      return false;
    }

    // Column labels ("Coverage %", "Attrition %") already say "%" --
    // only append a units hint when the label doesn't already carry one,
    // so exported headers never read "Coverage % (%)".
    const header = columns.map((c) => {
      const alreadyLabeledAsPercent = /%/.test(c.label);
      return c.label + (c.format === "percent1" && !alreadyLabeledAsPercent ? " (%)" : "");
    });
    const body = rows.map((row) => columns.map((c) => cellValue(row, c)));

    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws["!cols"] = columns.map((c) => ({ wch: Math.max(10, c.label.length + 4) }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");

    const filename = `${filenameBase}.xlsx`;
    XLSX.writeFile(wb, filename);
    return true;
  }

  /** Export a single chart's current on-screen state as a PNG. Uses
   * Chart.js's own rasterizer (`toBase64Image`) -- no extra library. */
  function chartToPng(canvasId, filenameBase) {
    const chart = Charts.getChart(canvasId);
    if (!chart) {
      console.warn(`[Exporter] No chart is currently registered for canvas "${canvasId}".`);
      return false;
    }
    const dataUrl = chart.toBase64Image("image/png", 1);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${filenameBase}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  }

  /** Export the full dashboard, in its current filtered state, as a PDF
   * via the browser's native print-to-PDF. A dedicated @media print
   * block in dashboard.css hides interactive chrome (filter controls,
   * search boxes, pagination, export buttons themselves) so the printed
   * output reads like a report, not a screenshot of the app. */
  function dashboardToPdf() {
    window.print();
    return true;
  }

  return { sanitize, filenameSuffixFromFilters, tableToExcel, chartToPng, dashboardToPdf };
})();
