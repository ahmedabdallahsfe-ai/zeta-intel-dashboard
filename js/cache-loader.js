/**
 * CACHE LOADER — fetch a data cache only when something needs it
 * ============================================================================
 *
 * THE PROBLEM
 * ---------------------------------------------------------------------------
 * Every data cache was a `<script defer>` tag in dashboard.html, so all of them
 * downloaded and were JavaScript-parsed on every page load — 38.7 MB — no
 * matter which page the user opened. Opening the Executive Command Center paid
 * for the IQVIA competitor panel, the customer analytics cube and the IMS
 * market data, none of which it reads.
 *
 * Three of those caches are needed by exactly one page each:
 *
 *     customer_analytics   14.3 MB   Customer Health drill only
 *     iqvia                 4.4 MB   IQVIA Market Share page only*
 *     market_intel          1.4 MB   Total Market Intelligence page only
 *     --------------------------------------------------------------
 *                          20.1 MB   off every single page load
 *
 * (*) iqvia was previously unavoidable because `auth.js` read the sign-in
 *     roster from `IQVIA_CACHE.users` — 20 KB of roster holding 4.4 MB of
 *     market data hostage on every load. `etl/build_auth_cache.py` now writes
 *     that roster to its own 6 KB file.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHANGE
 * ---------------------------------------------------------------------------
 * Nothing about the data. Same cache files, same decoders, same globals, same
 * results. The only difference is WHEN the `<script>` element is created.
 * Every consumer still finds `window.X_CACHE` exactly where it always was.
 *
 * That constraint is the whole design: a page that loads faster but computes
 * differently is not an optimisation, it is a regression with a stopwatch.
 *
 * FAILURE BEHAVIOUR
 * ---------------------------------------------------------------------------
 * `ensure()` never rejects. If a cache cannot load, it resolves `false` and the
 * calling page falls back to whatever it already does when the global is
 * absent — every one of these caches was already optional in its consumer,
 * because they had to cope with a user who had never run refresh.bat.
 */
(function (global) {
  "use strict";

  // key -> { file, globalVar, label }
  // `globalVar` is what the consumer actually reads; it is also how we detect
  // a cache that is already present (eagerly loaded, or loaded earlier).
  // NOTE (2026-09-11): iqvia is deliberately NOT in this table. js/iqvia.js
  // reads window.IQVIA_CACHE.b64Data/.lookups/etc into its OWN top-level
  // `var`s the instant that script executes (not inside a function), so
  // cache/iqvia.data.js must still finish loading before js/iqvia.js's
  // <script> tag runs -- lazy-loading the cache without also lazy-loading
  // and restructuring iqvia.js itself would throw on every page load.
  // That is a real fix worth doing (4.85 MB), just a bigger one -- flagged
  // to Ahmed, not done in this pass. See loading_performance_regression.md.
  var CACHES = {
    customer_analytics: {
      file: "cache/customer_analytics.data.js",
      globalVar: "CUSTOMER_ANALYTICS_CACHE",
      label: "Customer analytics",
      version: "20260731_skunocap",
    },
    market_intel: {
      file: "cache/market_intel.data.js",
      globalVar: "MARKET_INTEL_CACHE",
      label: "Market intelligence",
      version: "20260806_annual",
    },
    coaching: {
      file: "cache/coaching.data.js",
      globalVar: "COACHING_CACHE",
      label: "Coaching intelligence",
      version: "20260908_srdmcoverage",
    },
    ims_rx: {
      file: "cache/ims_rx.data.js",
      globalVar: "IMS_RX_CACHE",
      label: "IMS Rx",
      version: "20260815_v1",
    },
  };

  // Fallback cache-busting version, used only for an entry that doesn't set
  // its own `version` above. Each cache normally carries its own, matching
  // whatever the ETL/ dashboard.html comment last bumped it to -- keeping
  // them independent means adding a cache here never forces a redundant
  // reload of the other three.
  var VERSION = "20260808_lazy";

  var _promises = {};   // key -> Promise<boolean>, so N callers cause 1 fetch

  function isLoaded(key) {
    var spec = CACHES[key];
    if (!spec) return false;
    return typeof global[spec.globalVar] !== "undefined" && global[spec.globalVar] !== null;
  }

  /**
   * Ensure a cache's script has run. Resolves true if the global is present
   * afterwards, false if it could not be loaded.
   *
   * Idempotent and concurrency-safe: the promise is memoised per key, so a
   * tab switch that fires twice, or two components asking at once, still
   * produce exactly one network request.
   */
  function ensure(key) {
    var spec = CACHES[key];
    if (!spec) return Promise.resolve(false);
    if (isLoaded(key)) return Promise.resolve(true);
    if (_promises[key]) return _promises[key];

    _promises[key] = new Promise(function (resolve) {
      var t0 = (global.performance && performance.now) ? performance.now() : 0;
      var el = document.createElement("script");
      el.src = spec.file + "?v=" + (spec.version || VERSION);
      el.async = false;   // preserve execution order if several are queued

      el.onload = function () {
        var ok = isLoaded(key);
        if (global.console && global.performance) {
          console.log("[CacheLoader] " + spec.label + " loaded in " +
            Math.round(performance.now() - t0) + "ms" + (ok ? "" : " (global missing!)"));
        }
        resolve(ok);
      };
      el.onerror = function () {
        // Do not reject. A missing optional cache is a degraded page, not a
        // broken one, and every consumer already handles the global's absence.
        if (global.console) {
          console.warn("[CacheLoader] " + spec.label + " could not be loaded from " + spec.file);
        }
        resolve(false);
      };

      document.head.appendChild(el);
    });

    return _promises[key];
  }

  /**
   * Start loading in the background, without waiting.
   *
   * Used for caches that a page will PROBABLY need soon but does not need to
   * render — Customer Analytics is only read if someone opens the Customer
   * Health drill, so fetching it while they read the page means it is already
   * there when they click, with no cost to first paint.
   *
   * Deliberately scheduled on idle. Kicking off a 14 MB download the instant a
   * page renders competes with the rendering.
   */
  function preload(key, delayMs) {
    if (isLoaded(key) || _promises[key]) return;
    var start = function () { ensure(key); };
    if (typeof global.requestIdleCallback === "function") {
      global.requestIdleCallback(start, { timeout: delayMs || 4000 });
    } else {
      setTimeout(start, delayMs || 1500);
    }
  }

  function status() {
    var out = {};
    Object.keys(CACHES).forEach(function (k) {
      out[k] = { loaded: isLoaded(k), requested: !!_promises[k], file: CACHES[k].file };
    });
    return out;
  }

  global.CacheLoader = {
    ensure: ensure,
    preload: preload,
    isLoaded: isLoaded,
    status: status,
    VERSION: VERSION,
    _caches: CACHES,
  };
})(typeof window !== "undefined" ? window : this);
