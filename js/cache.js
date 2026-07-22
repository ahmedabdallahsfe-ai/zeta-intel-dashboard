/**
 * cache.js
 * ========
 * The dashboard's ONLY interface to data. Every other module reads
 * through CacheStore -- nothing else is allowed to reference the raw
 * window.DASHBOARD_CACHE / window.DASHBOARD_METADATA globals directly.
 * This keeps the "dashboard never touches the workbook, only cache"
 * rule enforceable in one place, and means Phase 2's richer cache shape
 * only requires changes here, not in every chart/table module.
 *
 * Cache files are loaded as classic <script> tags (cache/dashboard.data.js,
 * cache/metadata.data.js) before this file runs, so window.DASHBOARD_CACHE
 * and window.DASHBOARD_METADATA already exist by the time CacheStore.init()
 * is called from app.js.
 */

const CacheStore = (() => {
  let dashboard = null;
  let metadata = null;
  let records = null;
  let ready = false;

  /**
   * Validate that the cache scripts actually loaded. If the user opens
   * dashboard.html without ever running refresh.bat, these globals won't
   * exist -- we want a clear "run refresh.bat first" message, not a
   * silent blank page or a cryptic console error.
   */
  function init() {
    dashboard = window[CONFIG.cache.dashboardVar] || null;
    metadata = window[CONFIG.cache.metadataVar] || null;
    records = window[CONFIG.cache.recordsVar] || null;
    ready = Boolean(dashboard && metadata && records);
    return ready;
  }

  function isReady() {
    return ready;
  }

  function getDashboard() {
    return dashboard;
  }

  function getMetadata() {
    return metadata;
  }

  /** Dictionary-encoded row-level data: { fields: [...], rows: [[...]] }.
   * Consumed by analytics.js to recompute every KPI/chart/table when a
   * filter changes, without touching the workbook or refresh.py. */
  function getRecords() {
    return records;
  }

  /** Convenience accessor used throughout the UI layer. */
  function getDataHealth() {
    return Utils.get(metadata, "dataHealth", "unknown");
  }

  return { init, isReady, getDashboard, getMetadata, getRecords, getDataHealth };
})();
