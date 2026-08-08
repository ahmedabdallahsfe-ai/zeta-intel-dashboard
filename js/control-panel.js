/**
 * CONTROL PANEL — data health and freshness
 * ============================================================================
 *
 * Answers one question an executive should never have to guess at before a
 * business review: is what I am looking at current?
 *
 * READ-ONLY, DELIBERATELY.
 * ---------------------------------------------------------------------------
 * The platform is a static site with no backend, so a panel that WROTE
 * anything would have to persist it in one browser's localStorage — invisible
 * to everyone else, and silently disagreeing with the Excel config and the ETL
 * that actually govern the system. Two sources of truth for the same setting
 * is worse than one inconvenient source of truth. Changes continue to happen
 * where they already happen: the config workbook and refresh.bat.
 *
 * TWO KINDS OF EVIDENCE, AND THE DIFFERENCE MATTERS.
 * ---------------------------------------------------------------------------
 *   1. The BUILD MANIFEST (cache/build_manifest.data.js) is written by
 *      etl/build_manifest.py at the end of every refresh. Only the ETL machine
 *      can see both a cache and its source workbook on disk, so this is the
 *      only way the browser can ever learn that a workbook was updated after
 *      the cache was built.
 *
 *   2. LIVE CACHE INSPECTION happens here, in the browser, from the caches the
 *      page has already loaded. It needs no ETL cooperation and cannot go
 *      stale, because it is reading the very data the dashboard is rendering.
 *
 * Where the two disagree, the live inspection wins and the panel says so — a
 * manifest describes the machine that built the caches, not necessarily the
 * files that were actually deployed. That gap is real: on 2026-08-06 a
 * refresh rebuilt every cache and then failed to push, so the live site ran
 * for hours on caches that the build machine believed were current.
 *
 * WHAT IT WILL NOT DO
 * ---------------------------------------------------------------------------
 * It does not judge whether the numbers are RIGHT. It reports mechanical facts
 * — timestamps, row counts, period coverage, declared data-quality counts —
 * and flags disagreements between them. A health panel that editorialises is
 * one more thing to keep true.
 */
(function (global) {
  "use strict";

  var _container = null;

  // =========================================================================
  // Access
  // =========================================================================
  // SFE Manager owns data operations here — they are the person who actually
  // runs refresh.bat. Admin is included because a control panel is by
  // definition administrative. Declared as its own constant rather than reusing
  // an existing role list: this answers "who operates the data pipeline",
  // which is a different question from "who may see company-wide totals", and
  // sharing a constant would couple two things that should be free to diverge.
  var CONTROL_PANEL_ROLES = ["SFE Manager", "Admin"];

  function canView() {
    if (!global.AUTH || !global.AUTH.getValidSessionUser) return false;
    var u = global.AUTH.getValidSessionUser();
    if (!u) return false;
    return CONTROL_PANEL_ROLES.indexOf(u.role) >= 0;
  }

  // =========================================================================
  // Reading the evidence
  // =========================================================================
  function decodeB64Gzip(holder) {
    if (!holder || !holder.b64Data) return null;
    try {
      var bin = atob(holder.b64Data);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(pako.ungzip(bytes, { to: "string" }));
    } catch (e) {
      return null;
    }
  }

  var _manifest = null;
  function manifest() {
    if (_manifest !== null) return _manifest;
    _manifest = decodeB64Gzip(global.BUILD_MANIFEST) || false;
    return _manifest;
  }

  /**
   * Period coverage as the LOADED caches actually report it.
   *
   * This is the check that matters most in practice. Every dataset here is
   * built by a separate script from a separate workbook, so they drift apart
   * one refresh at a time — and a Customer Analytics cache sitting a month
   * behind Sales looks completely normal on screen until someone compares two
   * pages and finds they disagree.
   */
  function livePeriods() {
    var out = [];

    var sales = decodeB64Gzip(global.SALES_CACHE);
    if (sales && sales.lookups && sales.lookups.months) {
      out.push({
        label: "Sales", periods: sales.lookups.months.slice(),
        rows: (sales.rows || []).length,
        builtAt: sales.meta && sales.meta.generatedAt,
        schema: sales.meta && sales.meta.schemaVersion,
      });
    }

    var dash = null;
    try {
      dash = (global.CacheStore && global.CacheStore.getDashboard)
        ? global.CacheStore.getDashboard() : null;
    } catch (e) { dash = null; }
    if (dash && dash.dimensions && dash.dimensions.periods) {
      out.push({
        label: "Coverage & SFE", periods: dash.dimensions.periods.slice(),
        latest: dash.latestPeriod || null,
        dataQuality: dash.dataQuality || null,
      });
    }

    var ca = decodeB64Gzip(global.CUSTOMER_ANALYTICS_CACHE);
    if (ca && ca.clusters) {
      var months = null;
      Object.keys(ca.clusters).forEach(function (k) {
        var c = ca.clusters[k];
        if (!months && c && c.months) months = c.months.slice();
      });
      if (months) {
        out.push({ label: "Customer Analytics", periods: months,
                   builtAt: ca.generatedAt, rows: ca.sourceRows });
      }
    }

    var mi = decodeB64Gzip(global.MARKET_INTEL_CACHE);
    if (mi && mi.meta && mi.meta.annualYears) {
      out.push({
        label: "Market Intelligence",
        periods: mi.meta.annualYears.map(String),
        builtAt: mi.meta.generatedAt,
        rows: mi.meta.annualCells,
        note: "calendar years, not months",
      });
    }

    return out;
  }

  // =========================================================================
  // Verdicts
  // =========================================================================
  function ageDays(ts) {
    if (!ts) return null;
    var t = Date.parse(String(ts).replace(" ", "T"));
    if (isNaN(t)) return null;
    return (Date.now() - t) / 86400000;
  }

  /**
   * A dataset's verdict.
   *
   * "Stale" here means something specific and checkable — a source workbook
   * changed after the cache was built — not merely "old". A cache built six
   * months ago from a workbook nobody has touched since is perfectly current,
   * and calling it stale would teach people to ignore the panel.
   */
  function verdictFor(ds) {
    if (!ds.builtAt) return { level: "unknown", text: "No build timestamp recorded" };

    var newer = (ds.sources || []).filter(function (s) {
      return s.exists && s.modifiedAt && s.modifiedAt > ds.builtAt;
    });
    if (newer.length) {
      return {
        level: "stale",
        text: "Source updated after this was built — " +
              newer.map(function (s) { return s.name; }).join(", "),
      };
    }

    var missing = (ds.sources || []).filter(function (s) { return !s.exists; });
    if (missing.length) {
      return {
        level: "warn",
        text: "Source workbook not on the build machine — " +
              missing.map(function (s) { return s.name; }).join(", "),
      };
    }

    var noCache = (ds.caches || []).filter(function (c) { return !c.exists; });
    if (noCache.length) {
      return { level: "stale", text: "Cache file missing — " +
               noCache.map(function (c) { return c.name; }).join(", ") };
    }

    var d = ageDays(ds.builtAt);
    if (d !== null && d > 14) {
      return { level: "warn", text: "Built " + Math.floor(d) + " days ago" };
    }
    return { level: "ok", text: "Current" };
  }

  // =========================================================================
  // Rendering
  // =========================================================================
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fmtBytes(b) {
    if (!b && b !== 0) return "—";
    if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
    if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
    if (b >= 1e3) return (b / 1e3).toFixed(0) + " KB";
    return b + " B";
  }

  function fmtAge(ts) {
    var d = ageDays(ts);
    if (d === null) return "";
    if (d < 1 / 24) return "just now";
    if (d < 1) return Math.round(d * 24) + "h ago";
    if (d < 2) return "yesterday";
    return Math.floor(d) + " days ago";
  }

  function badge(level, text) {
    return '<span class="cp-badge cp-badge-' + level + '">' + esc(text) + "</span>";
  }

  function renderHeader(m) {
    var when = m ? m.generatedAt : null;
    return '<div class="cp-head">' +
      "<div>" +
        '<h1 class="cp-title">Control Panel</h1>' +
        '<p class="cp-sub">Data health and freshness. Read-only — changes are made in the ' +
          "config workbook and applied by <code>refresh.bat</code>.</p>" +
      "</div>" +
      '<div class="cp-head-meta">' +
        (when
          ? '<div class="cp-meta-k">Last refresh recorded</div><div class="cp-meta-v">' +
            esc(when) + '</div><div class="cp-meta-s">' + esc(fmtAge(when)) + "</div>"
          : '<div class="cp-meta-k">Build manifest</div><div class="cp-meta-v">not found</div>') +
      "</div>" +
    "</div>";
  }

  function renderSummary(datasets) {
    var counts = { ok: 0, warn: 0, stale: 0, unknown: 0 };
    datasets.forEach(function (d) { counts[verdictFor(d).level]++; });
    var cards = [
      { k: "Datasets", v: datasets.length, cls: "" },
      { k: "Current", v: counts.ok, cls: counts.ok ? "cp-stat-ok" : "" },
      { k: "Needs attention", v: counts.warn + counts.unknown, cls: (counts.warn + counts.unknown) ? "cp-stat-warn" : "" },
      { k: "Stale", v: counts.stale, cls: counts.stale ? "cp-stat-bad" : "" },
    ];
    return '<div class="cp-stats">' + cards.map(function (c) {
      return '<div class="cp-stat ' + c.cls + '"><div class="cp-stat-v">' + c.v +
        '</div><div class="cp-stat-k">' + esc(c.k) + "</div></div>";
    }).join("") + "</div>";
  }

  function renderDatasets(datasets) {
    var rows = datasets.map(function (d) {
      var v = verdictFor(d);
      var f = d.facts || {};
      var srcHtml = (d.sources || []).map(function (s) {
        var flag = !s.exists ? "cp-src-missing"
          : (d.builtAt && s.modifiedAt > d.builtAt ? "cp-src-newer" : "");
        return '<div class="cp-src ' + flag + '">' +
          '<span class="cp-src-name">' + esc(s.name) + "</span>" +
          '<span class="cp-src-meta">' +
            (s.exists ? esc(s.modifiedAt) + " · " + fmtBytes(s.bytes) : "not found") +
          "</span></div>";
      }).join("");

      var factBits = [];
      if (f.rows) factBits.push(Number(f.rows).toLocaleString() + " rows");
      if (f.sourceRows) factBits.push(Number(f.sourceRows).toLocaleString() + " source rows");
      if (f.annualCells) factBits.push(Number(f.annualCells).toLocaleString() + " cells");
      if (f.schemaVersion !== undefined) factBits.push("schema v" + f.schemaVersion);
      if (f.periods && f.periods.length) {
        factBits.push(f.periods.length + " periods (" +
          f.periods[0] + "–" + f.periods[f.periods.length - 1] + ")");
      }

      return '<tr class="cp-row-' + v.level + '">' +
        "<td>" +
          '<div class="cp-ds-name">' + esc(d.label) + "</div>" +
          '<div class="cp-ds-sub">' + esc((d.powers || []).join(" · ")) + "</div>" +
        "</td>" +
        "<td>" + badge(v.level, v.level === "ok" ? "Current"
                       : v.level === "stale" ? "Stale"
                       : v.level === "warn" ? "Check" : "Unknown") +
          '<div class="cp-verdict">' + esc(v.text) + "</div></td>" +
        "<td><div class=\"cp-built\">" + esc(d.builtAt || "—") + "</div>" +
          '<div class="cp-ds-sub">' + esc(fmtAge(d.builtAt)) +
          (d.builtAtSource === "file-mtime"
            ? ' · <span title="This ETL does not stamp a build time into its output, so this is the cache file\'s modification time — weaker evidence, since copying the file changes it.">from file date</span>'
            : "") +
          "</div></td>" +
        "<td>" + srcHtml + "</td>" +
        '<td class="cp-facts">' + esc(factBits.join(" · ")) +
          '<div class="cp-ds-sub">' + esc(d.builder) + "</div></td>" +
      "</tr>";
    }).join("");

    return '<section class="cp-section"><h2 class="cp-h2">Datasets</h2>' +
      '<p class="cp-note">"Stale" means a source workbook changed after the cache ' +
      "was built — a specific, checkable fact, not merely age. A cache built months " +
      "ago from a workbook nobody has touched is current.</p>" +
      '<div class="cp-tablewrap"><table class="cp-table"><thead><tr>' +
        "<th>Dataset</th><th>Status</th><th>Built</th><th>Sources</th><th>Contents</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div></section>";
  }

  /**
   * Period alignment across datasets.
   *
   * The single most useful check on this page. Each dataset is built by its
   * own script from its own workbook, so they drift apart one refresh at a
   * time, and nothing on any page says so.
   */
  function renderAlignment(live) {
    var monthly = live.filter(function (l) {
      return l.periods && l.periods.length && /^\d{4}-\d{2}$/.test(l.periods[0]);
    });
    var body;

    if (monthly.length < 2) {
      body = '<p class="cp-note">Not enough month-based datasets loaded to compare.</p>';
    } else {
      var latest = monthly.map(function (m) { return m.periods[m.periods.length - 1]; });
      var newest = latest.slice().sort()[latest.length - 1];
      var lagging = monthly.filter(function (m) {
        return m.periods[m.periods.length - 1] < newest;
      });

      body =
        (lagging.length
          ? '<div class="cp-alert cp-alert-bad"><strong>' + lagging.length +
            " dataset" + (lagging.length === 1 ? "" : "s") + " behind.</strong> " +
            lagging.map(function (m) {
              return esc(m.label) + " ends " + esc(m.periods[m.periods.length - 1]);
            }).join("; ") + " — the newest data available is " + esc(newest) +
            ". Pages built on the lagging cache will disagree with pages built on the others.</div>"
          : '<div class="cp-alert cp-alert-ok"><strong>Aligned.</strong> ' +
            "Every month-based dataset runs through " + esc(newest) + ".</div>") +
        '<div class="cp-tablewrap"><table class="cp-table"><thead><tr>' +
          "<th>Dataset</th><th>Covers</th><th>Latest</th><th>Built</th>" +
        "</tr></thead><tbody>" +
        monthly.map(function (m) {
          var end = m.periods[m.periods.length - 1];
          var behind = end < newest;
          return '<tr class="' + (behind ? "cp-row-stale" : "") + '">' +
            "<td>" + esc(m.label) + "</td>" +
            "<td>" + esc(m.periods[0]) + " – " + esc(end) +
              ' <span class="cp-ds-sub">(' + m.periods.length + ")</span></td>" +
            "<td>" + (behind ? badge("stale", end + " · behind") : badge("ok", end)) + "</td>" +
            "<td>" + esc(m.builtAt || "—") + "</td>" +
          "</tr>";
        }).join("") + "</tbody></table></div>";
    }

    var others = live.filter(function (l) {
      return !(l.periods && l.periods.length && /^\d{4}-\d{2}$/.test(l.periods[0]));
    });
    if (others.length) {
      body += '<p class="cp-note">Not compared, different grain: ' +
        others.map(function (o) {
          return esc(o.label) + " (" + esc(o.periods ? o.periods.join(", ") : "—") + ")";
        }).join(" · ") + "</p>";
    }

    return '<section class="cp-section"><h2 class="cp-h2">Period alignment</h2>' +
      '<p class="cp-note">Each dataset is built by a separate script from a separate ' +
      "workbook, so they drift apart one refresh at a time. Nothing on any other page " +
      "reveals it.</p>" + body + "</section>";
  }

  function renderQuality(live) {
    var withDq = live.filter(function (l) { return l.dataQuality; });
    if (!withDq.length) return "";
    return '<section class="cp-section"><h2 class="cp-h2">Data quality</h2>' +
      '<p class="cp-note">Counts the ETL itself recorded while reading the workbooks.</p>' +
      withDq.map(function (l) {
        var dq = l.dataQuality;
        var errs = (dq.errors || []).length, warns = (dq.warnings || []).length;
        var lines = [];
        (dq.errors || []).slice(0, 8).forEach(function (e) {
          lines.push('<li class="cp-dq-err">' + esc(typeof e === "string" ? e : JSON.stringify(e)) + "</li>");
        });
        (dq.warnings || []).slice(0, 8).forEach(function (w) {
          lines.push('<li class="cp-dq-warn">' + esc(typeof w === "string" ? w : JSON.stringify(w)) + "</li>");
        });
        return '<div class="cp-dq"><div class="cp-dq-h">' + esc(l.label) + " — " +
          (errs ? badge("stale", errs + " error" + (errs === 1 ? "" : "s")) : badge("ok", "no errors")) +
          " " +
          (warns ? badge("warn", warns + " warning" + (warns === 1 ? "" : "s")) : "") +
          "</div>" + (lines.length ? "<ul class=\"cp-dq-list\">" + lines.join("") + "</ul>" : "") +
        "</div>";
      }).join("") + "</section>";
  }

  function renderLive(live) {
    return '<section class="cp-section"><h2 class="cp-h2">Loaded in this browser</h2>' +
      '<p class="cp-note">Read from the caches this page actually loaded, not from the ' +
      "build manifest. Where the two disagree, this is the truth — the manifest describes " +
      "the machine that built the caches, which is not always the machine that deployed them.</p>" +
      '<div class="cp-tablewrap"><table class="cp-table"><thead><tr>' +
        "<th>Cache</th><th>Built</th><th>Rows</th><th>Periods</th>" +
      "</tr></thead><tbody>" +
      live.map(function (l) {
        return "<tr><td>" + esc(l.label) + "</td>" +
          "<td>" + esc(l.builtAt || "—") + "</td>" +
          "<td>" + (l.rows ? Number(l.rows).toLocaleString() : "—") + "</td>" +
          "<td>" + esc(l.periods ? l.periods.join(", ") : "—") +
            (l.note ? ' <span class="cp-ds-sub">' + esc(l.note) + "</span>" : "") +
          "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
  }

  function renderNoManifest() {
    return '<section class="cp-section"><div class="cp-alert cp-alert-warn">' +
      "<strong>No build manifest found.</strong> Source-workbook freshness cannot be " +
      "checked from the browser — only the machine that runs the ETL can see both a " +
      "cache and its source file. Run <code>refresh.bat</code> once to generate " +
      "<code>cache/build_manifest.data.js</code>. Everything below still works: it is " +
      "read from the caches this page has loaded." +
    "</div></section>";
  }

  // =========================================================================
  // Entry points
  // =========================================================================
  function init(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    _container = container;

    if (!canView()) {
      container.innerHTML = '<div class="cp-root"><div class="cp-denied">' +
        "<h2>Not available for your role</h2>" +
        "<p>The Control Panel is limited to " + esc(CONTROL_PANEL_ROLES.join(" and ")) +
        ".</p></div></div>";
      return;
    }

    var m = manifest();
    var live = livePeriods();
    var datasets = (m && m.datasets) ? m.datasets : [];

    container.innerHTML = '<div class="cp-root">' +
      renderHeader(m) +
      (m ? renderSummary(datasets) : "") +
      (m ? "" : renderNoManifest()) +
      renderAlignment(live) +
      (m ? renderDatasets(datasets) : "") +
      renderQuality(live) +
      renderLive(live) +
      '<div class="cp-foot">Read-only. To change anything: edit the config workbook or ' +
        "the ETL, then run <code>refresh.bat</code>.</div>" +
    "</div>";
  }

  function destroy() { _container = null; }

  global.ControlPanel = {
    init: init,
    destroy: destroy,
    canView: canView,
    _manifest: manifest,
    _livePeriods: livePeriods,
    _verdictFor: verdictFor,
    CONTROL_PANEL_ROLES: CONTROL_PANEL_ROLES,
  };
})(typeof window !== "undefined" ? window : this);
