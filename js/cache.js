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

  /** Helper to decompress Base64 gzipped cache */
  function decompressB64Gzip(b64Data) {
    if (!b64Data) return null;
    try {
      const strData = atob(b64Data);
      const bytes = new Uint8Array(strData.length);
      for (let i = 0; i < strData.length; i++) {
        bytes[i] = strData.charCodeAt(i);
      }
      const decompressed = pako.ungzip(bytes, { to: 'string' });
      return JSON.parse(decompressed);
    } catch (e) {
      console.error("[CacheStore] Failed to decompress cache", e);
      return null;
    }
  }

  /**
   * Validate that the cache scripts actually loaded. If the user opens
   * dashboard.html without ever running refresh.bat, these globals won't
   * exist -- we want a clear "run refresh.bat first" message, not a
   * silent blank page or a cryptic console error.
   */
  function init() {
    let rawDashboard = window[CONFIG.cache.dashboardVar] || null;
    metadata = window[CONFIG.cache.metadataVar] || null;
    let rawRecords = window[CONFIG.cache.recordsVar] || null;

    // Overwrite globals if they are compressed
    if (rawDashboard && rawDashboard.b64Data) {
      rawDashboard = decompressB64Gzip(rawDashboard.b64Data);
      window[CONFIG.cache.dashboardVar] = rawDashboard;
    }
    if (rawRecords && rawRecords.b64Data) {
      rawRecords = decompressB64Gzip(rawRecords.b64Data);
      window[CONFIG.cache.recordsVar] = rawRecords;
    }
    if (window.DASHBOARD_ORGANOGRAM && window.DASHBOARD_ORGANOGRAM.b64Data) {
      window.DASHBOARD_ORGANOGRAM = decompressB64Gzip(window.DASHBOARD_ORGANOGRAM.b64Data);
    }

    dashboard = rawDashboard;
    records = rawRecords;

    // records.data.js is optional (used for filter recomputation only).
    // Dashboard renders from pre-computed cache even without it.
    ready = Boolean(dashboard && metadata);
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
