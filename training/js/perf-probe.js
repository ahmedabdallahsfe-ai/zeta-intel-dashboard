/**
 * PERF PROBE — where does the loading time actually go?
 * ============================================================================
 *
 * OFF BY DEFAULT. Does nothing at all unless the page is opened with ?perf=1.
 * That is the whole point: this instruments hot paths (atob, gzip, JSON.parse)
 * that every page load depends on, and a measurement tool that slows down the
 * thing it measures — for everyone, all the time — is worse than no
 * measurement. Normal users never execute a line of it beyond the URL check.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Server-side estimates of decode cost are not evidence. pako's throughput
 * swings by an order of magnitude depending on JIT warmth alone — measured on
 * the same data, same machine, same day: 0.4 MB/s cold in a sandboxed context
 * versus 13.4 MB/s warm. Extrapolating a real user's laptop from either number
 * would be guesswork dressed up as a measurement.
 *
 * So: measure on the machine that is actually slow.
 *
 * WHAT IT MEASURES
 * ---------------------------------------------------------------------------
 *   1. Network + JS parse per cache file, from the Resource Timing API. A
 *      14 MB .js file containing one enormous string literal costs real time
 *      to fetch AND to compile, before a single byte is decoded.
 *   2. Decode cost, split into its three stages — atob, gzip inflate, and
 *      JSON.parse — by wrapping those three functions and attributing time to
 *      whichever runs. The split matters: the fix for a JSON.parse-dominated
 *      profile (binary buffers) is completely different from the fix for a
 *      gzip-dominated one (native decompression via fetch).
 *   3. Main-thread blocking, via long-task observation. This is what "slow"
 *      actually feels like — a 2-second decode does not merely delay the page,
 *      it freezes it: the loader stops animating and clicks do nothing.
 *   4. Milestones — first paint, DOM ready, load.
 *
 * HOW TO USE
 * ---------------------------------------------------------------------------
 *   Open the dashboard with ?perf=1 on the end of the URL, wait for it to
 *   finish loading, then either read the table printed to the console (F12)
 *   or run  ZetaPerf.copy()  to put a shareable report on the clipboard.
 */
(function (global) {
  "use strict";

  // ---- activation -------------------------------------------------------
  var ON = false;
  try {
    ON = /[?&]perf=1\b/.test(global.location.search) ||
         global.localStorage.getItem("zeta_perf") === "1";
  } catch (e) { ON = false; }

  // Aliases. `ZetaPerf` is case-sensitive and easy to mistype from memory
  // (observed live: "zetapref"), and a profiler nobody can invoke measures
  // nothing. Every plausible spelling points at the same object.
  function publish(obj) {
    ["ZetaPerf", "zetaPerf", "zetaperf", "ZETAPERF", "Zetaperf", "perf"].forEach(function (n) {
      try { global[n] = obj; } catch (e) {}
    });
  }

  if (!ON) {
    // Only the switch is defined, so it can be armed from the console without
    // anyone editing a URL. Nothing is patched and nothing is timed.
    publish({
      enabled: false,
      why: "Not armed. Run  ZetaPerf.enable()  or add ?perf=1 to the URL.",
      enable: function () {
        try { global.localStorage.setItem("zeta_perf", "1"); } catch (e) {}
        if (global.console) console.log("Perf probe armed — reloading…");
        global.location.reload();
        return "reloading";
      },
      report: function () {
        var m = "The perf probe is not armed, so nothing was measured.\n" +
                "Run  ZetaPerf.enable()  — the page reloads and starts profiling.";
        if (global.console) console.log("%c" + m, "color:#b45309;font-weight:700");
        return m;
      },
      copy: function () { return this.report(); }
    });
    return;
  }

  var T0 = (global.performance && performance.now) ? performance.now() : 0;
  var stages = { atob: 0, gzip: 0, json: 0 };
  var counts = { atob: 0, gzip: 0, json: 0 };
  var bytes = { atob: 0, gzip: 0, json: 0 };
  var marks = [];
  var longTasks = [];

  function mark(label) {
    marks.push({ label: label, at: performance.now() - T0 });
  }
  mark("probe armed");

  // ---- stage timers -----------------------------------------------------
  // Wrapping the three primitives rather than editing each module's decoder
  // keeps this file removable in one line and guarantees it sees EVERY decode
  // path, including ones added later that nobody remembers to instrument.
  var _atob = global.atob;
  if (typeof _atob === "function") {
    global.atob = function (s) {
      var t = performance.now();
      var r = _atob.call(global, s);
      stages.atob += performance.now() - t;
      counts.atob++;
      bytes.atob += (s && s.length) || 0;
      return r;
    };
  }

  function wrapPako() {
    if (!global.pako || global.pako.__zetaWrapped) return false;
    ["ungzip", "inflate"].forEach(function (fn) {
      if (typeof global.pako[fn] !== "function") return;
      var orig = global.pako[fn];
      global.pako[fn] = function (data, opts) {
        var t = performance.now();
        var r = orig.call(global.pako, data, opts);
        stages.gzip += performance.now() - t;
        counts.gzip++;
        bytes.gzip += (data && data.length) || 0;
        return r;
      };
    });
    global.pako.__zetaWrapped = true;
    return true;
  }
  // pako may not have executed yet depending on script order; keep trying
  // until it appears rather than assuming a position in the tag list.
  if (!wrapPako()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (wrapPako() || ++tries > 400) clearInterval(iv);
    }, 25);
  }

  var _parse = JSON.parse;
  JSON.parse = function (text, reviver) {
    // Only time the big ones. Instrumenting every tiny JSON.parse in the app
    // would add more overhead than it measures and drown the signal.
    if (typeof text === "string" && text.length > 200000) {
      var t = performance.now();
      var r = _parse.call(JSON, text, reviver);
      stages.json += performance.now() - t;
      counts.json++;
      bytes.json += text.length;
      return r;
    }
    return _parse.call(JSON, text, reviver);
  };

  // ---- main-thread blocking --------------------------------------------
  // The number that matches what a user calls "slow". A long task is any
  // uninterrupted main-thread block over 50 ms; during one, nothing paints
  // and no click is handled.
  try {
    if (global.PerformanceObserver) {
      var po = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          longTasks.push({ start: e.startTime - T0, dur: e.duration });
        });
      });
      po.observe({ entryTypes: ["longtask"] });
    }
  } catch (e) { /* Safari and older Firefox lack longtask */ }

  // ---- reporting --------------------------------------------------------
  function fmt(ms) { return (ms >= 1000 ? (ms / 1000).toFixed(2) + " s" : Math.round(ms) + " ms"); }
  function mb(b) { return (b / 1e6).toFixed(1) + " MB"; }

  function resources() {
    var out = [];
    try {
      performance.getEntriesByType("resource").forEach(function (r) {
        if (!/\/(cache|assets|js)\//.test(r.name)) return;
        if (!/\.js(\?|$)/.test(r.name)) return;
        out.push({
          name: r.name.split("/").slice(-1)[0].split("?")[0],
          kind: /\/cache\//.test(r.name) ? "cache" : "code",
          bytes: r.transferSize || r.encodedBodySize || 0,
          decoded: r.decodedBodySize || 0,
          net: r.responseEnd - r.startTime,
        });
      });
    } catch (e) {}
    out.sort(function (a, b) { return b.net - a.net; });
    return out;
  }

  function summary() {
    var res = resources();
    var cacheRes = res.filter(function (r) { return r.kind === "cache"; });
    var codeRes = res.filter(function (r) { return r.kind === "code"; });
    var sum = function (a, k) { return a.reduce(function (s, r) { return s + (r[k] || 0); }, 0); };

    var nav = null;
    try { nav = performance.getEntriesByType("navigation")[0] || null; } catch (e) {}
    var paint = 0;
    try {
      (performance.getEntriesByType("paint") || []).forEach(function (p) {
        if (p.name === "first-contentful-paint") paint = p.startTime;
      });
    } catch (e) {}

    var blocked = longTasks.reduce(function (s, t) { return s + t.dur; }, 0);
    var worst = longTasks.reduce(function (m, t) { return Math.max(m, t.dur); }, 0);

    return {
      decode: {
        atob: stages.atob, gzip: stages.gzip, json: stages.json,
        total: stages.atob + stages.gzip + stages.json,
        counts: counts, bytes: bytes,
      },
      network: {
        cacheFiles: cacheRes.length,
        cacheBytesTransferred: sum(cacheRes, "bytes"),
        cacheBytesDecoded: sum(cacheRes, "decoded"),
        codeBytesTransferred: sum(codeRes, "bytes"),
        slowest: res.slice(0, 12),
      },
      blocking: { totalMs: blocked, worstTaskMs: worst, taskCount: longTasks.length },
      milestones: {
        firstContentfulPaint: paint,
        domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
        loadEvent: nav ? nav.loadEventEnd : null,
        marks: marks,
      },
      ua: (global.navigator && navigator.userAgent) || "",
      cores: (global.navigator && navigator.hardwareConcurrency) || null,
      memoryGB: (global.navigator && navigator.deviceMemory) || null,
      when: new Date().toISOString(),
    };
  }

  function textReport() {
    var s = summary();
    var L = [];
    L.push("ZETA DASHBOARD — LOAD PROFILE");
    L.push("=".repeat(68));
    L.push("when      " + s.when);
    L.push("cores     " + (s.cores || "?") + "        device memory " + (s.memoryGB || "?") + " GB");
    L.push("browser   " + s.ua);
    L.push("");
    L.push("MILESTONES");
    L.push("  first contentful paint   " + fmt(s.milestones.firstContentfulPaint));
    L.push("  DOM content loaded       " + fmt(s.milestones.domContentLoaded || 0));
    L.push("  load event               " + fmt(s.milestones.loadEvent || 0));
    L.push("");
    L.push("MAIN THREAD BLOCKED  (this is what 'slow' feels like)");
    L.push("  total blocked            " + fmt(s.blocking.totalMs) +
           "   across " + s.blocking.taskCount + " long tasks");
    L.push("  worst single freeze      " + fmt(s.blocking.worstTaskMs));
    L.push("");
    L.push("DECODE  (atob -> gzip inflate -> JSON.parse)");
    L.push("  base64 decode            " + fmt(s.decode.atob) +
           "   x" + s.decode.counts.atob + "   " + mb(s.decode.bytes.atob) + " in");
    L.push("  gzip inflate (pako)      " + fmt(s.decode.gzip) +
           "   x" + s.decode.counts.gzip + "   " + mb(s.decode.bytes.gzip) + " in");
    L.push("  JSON.parse               " + fmt(s.decode.json) +
           "   x" + s.decode.counts.json + "   " + mb(s.decode.bytes.json) + " in");
    L.push("  ------------------------------------");
    L.push("  decode total             " + fmt(s.decode.total));
    L.push("");
    L.push("NETWORK + JS PARSE");
    L.push("  cache files              " + s.network.cacheFiles +
           "   " + mb(s.network.cacheBytesTransferred) + " transferred, " +
           mb(s.network.cacheBytesDecoded) + " uncompressed");
    L.push("  app code                 " + mb(s.network.codeBytesTransferred) + " transferred");
    L.push("");
    L.push("  slowest files:");
    s.network.slowest.forEach(function (r) {
      L.push("    " + (r.name + "                                ").slice(0, 32) +
             (fmt(r.net) + "        ").slice(0, 10) + mb(r.bytes));
    });
    L.push("=".repeat(68));
    return L.join("\n");
  }

  function report() {
    var txt = textReport();
    if (global.console) {
      console.log("%c" + txt, "font-family:monospace;font-size:11px;line-height:1.5");
    }
    return txt;
  }

  /**
   * Put the report somewhere the user can actually get at it.
   *
   * `navigator.clipboard` needs a SECURE CONTEXT. Opening the dashboard by
   * double-click gives a `file://` origin, which is not secure, so the modern
   * clipboard API is simply absent there — and `file://` is exactly how this
   * dashboard gets opened after every refresh.bat run.
   *
   * So there are three fallbacks, in descending order of convenience, ending
   * with one that cannot fail: a visible textarea with the text already
   * selected, ready for Ctrl+C.
   */
  function copy() {
    var txt = textReport();

    // 1. Modern clipboard — https only.
    try {
      if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt);
        console.log("%cLoad profile copied to clipboard.",
          "color:#0EA5E9;font-weight:700;font-size:13px");
        return txt;
      }
    } catch (e) { /* fall through */ }

    // 2 and 3. Textarea: try execCommand, and leave it on screen selected
    // either way so a manual Ctrl+C always works.
    try {
      var wrap = document.createElement("div");
      wrap.setAttribute("style",
        "position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.55);" +
        "display:flex;align-items:center;justify-content:center;padding:24px;");
      var box = document.createElement("div");
      box.setAttribute("style",
        "background:#fff;border-radius:12px;padding:18px;max-width:820px;width:100%;" +
        "box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:sans-serif;");
      var msg = document.createElement("div");
      msg.setAttribute("style", "font-size:13px;font-weight:700;margin-bottom:10px;color:#0f172a;");
      msg.textContent = "Load profile — press Ctrl+C to copy, then Esc to close";
      var ta = document.createElement("textarea");
      ta.value = txt;
      ta.setAttribute("style",
        "width:100%;height:420px;font-family:ui-monospace,Consolas,monospace;" +
        "font-size:11px;line-height:1.45;border:1px solid #cbd5e1;border-radius:8px;padding:10px;");
      box.appendChild(msg); box.appendChild(ta); wrap.appendChild(box);
      document.body.appendChild(wrap);
      ta.focus(); ta.select();
      try { document.execCommand("copy"); } catch (e) { /* manual Ctrl+C then */ }
      function close(ev) {
        if (ev && ev.type === "keydown" && ev.key !== "Escape") return;
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        document.removeEventListener("keydown", close);
      }
      wrap.addEventListener("click", function (ev) { if (ev.target === wrap) close(); });
      document.addEventListener("keydown", close);
      console.log("%cProfile shown on screen — Ctrl+C to copy, Esc to close.",
        "color:#0EA5E9;font-weight:700;font-size:13px");
    } catch (e) {
      console.log(txt);
      console.log("Copy the text above by hand.");
    }
    return txt;
  }

  publish({
    enabled: true,
    report: report,
    copy: copy,
    show: copy,
    summary: summary,
    text: textReport,
    mark: mark,
    disable: function () {
      try { global.localStorage.removeItem("zeta_perf"); } catch (e) {}
      console.log("Perf probe off. Reload without ?perf=1.");
    },
  });

  // Report once everything has settled. `load` fires before the app finishes
  // its deferred boot work, so wait a further beat rather than reporting a
  // profile that stops halfway through the thing being profiled.
  global.addEventListener("load", function () {
    mark("load event");
    setTimeout(function () {
      mark("report");
      report();
      if (global.console) {
        console.log("%cRun ZetaPerf.copy() to copy this report to the clipboard.",
          "color:#0EA5E9;font-weight:700;font-size:12px");
      }
    }, 2500);
  });
})(typeof window !== "undefined" ? window : this);
