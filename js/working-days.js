/**
 * js/working-days.js
 * ===================
 * Field Working Days Intelligence -- DM/DSM / ASM / NSM working-days-only
 * view (Ahmed 2026-09-05/06: "make dashboard page for dm asm nsm working
 * days only focus on it dont focus on coverage or emp coverage").
 *
 * Reads cache/working_days.data.js (window.WORKING_DAYS_CACHE), built by
 * etl/build_working_days_cache.py from Sprint_Missing_KPI_Template.xlsx
 * (DM_DSM/ASM/NSM tabs) plus the canonical BU/Line already scored in
 * cache/sprint.json. Follows the same module convention as js/sprint.js: a
 * self-contained IIFE exposing window.WorkingDaysDashboard =
 * { init(containerId), destroy(), canView }.
 *
 * ACCESS MODEL: gated on AUTH.canViewSprint() -- same audience as Zeta
 * Sprint (CEO/VP/BEX/Admin/SFE Manager), since this reads the identical
 * DM/DSM/ASM/NSM roster. No dedicated permission was requested; if Ahmed
 * wants a different audience later, add AUTH.canViewWorkingDays() in
 * auth.js and swap the two references below (menu-item gate is in
 * js/app.js, page-level gate is canViewPage() here).
 *
 * SCOPE FILTERING: a Line/BU-restricted login must not see other
 * territories' individual working-days data, same rule Sprint enforces
 * (js/sprint.js's dmOrBmInScope/asmNsmInScope). Applied once right after
 * decompression, before anything renders -- DM_DSM checks both
 * AUTH.isBuAllowed(bu) and AUTH.isLineAllowed(line) (one meaningful home
 * line, like Sprint's DM/DSM rows); ASM/NSM check BU only (their `line`
 * field is a majority-vote artifact over their own DM/DSMs, not a home
 * territory -- same reasoning as Sprint's asmNsmInScope). Every BU/Line/
 * Profile filter dropdown in this UI is built FROM the already-scoped
 * data, so an in-scope user simply never sees an option outside their
 * territory to begin with.
 *
 * TOT = Time Out of Territory (Ahmed 2026-09-05), the off-day categories
 * subtracted from Calendar Days before applying each tier's multiplier.
 * See etl/build_working_days_cache.py's header for the full formula.
 */
(function () {
  "use strict";

  var rawCache = null;   // decompressed, unscoped -- kept for schema/meta only
  var cache = null;      // scoped view actually rendered from
  var charts = { trend: null, dist: null, deduct: null };

  var MONTHS_FALLBACK = ["February", "March", "April", "May", "June", "July", "August"];
  var TIER_LABEL = { DM_DSM: "DM / DSM", ASM: "ASM", NSM: "NSM" };
  var TIER_COLOR = { DM_DSM: "#0F4C81", ASM: "#B45309", NSM: "#15803D" };

  var state = { tier: "DM_DSM", month: null, bu: "", line: "", profile: "", sortKey: "fieldPct", sortDir: -1, search: "" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function gunzipB64Json(b64) {
    var strData = atob(b64);
    var bytes = new Uint8Array(strData.length);
    for (var i = 0; i < strData.length; i++) bytes[i] = strData.charCodeAt(i);
    return JSON.parse(pako.ungzip(bytes, { to: "string" }));
  }

  function canViewPage() {
    if (window.AUTH && typeof window.AUTH.canViewWorkingDays === "function") {
      return window.AUTH.canViewWorkingDays();
    }
    return !!(window.AUTH && typeof window.AUTH.canViewSprint === "function" && window.AUTH.canViewSprint());
  }

  function dmInScope(r) {
    if (!window.AUTH) return true;
    if (r.bu && r.bu !== "Unassigned" && !window.AUTH.isBuAllowed(r.bu)) return false;
    if (r.line && r.line !== "Unassigned" && !window.AUTH.isLineAllowed(r.line)) return false;
    return true;
  }
  function asmNsmInScopeRow(r) {
    if (!window.AUTH) return true;
    if (r.bu && r.bu !== "Unassigned" && !window.AUTH.isBuAllowed(r.bu)) return false;
    return true;
  }

  function applyScope(decoded) {
    var scoped = { meta: decoded.meta, monthOrder: decoded.monthOrder, multiplier: decoded.multiplier, employees: {} };
    ["DM_DSM", "ASM", "NSM"].forEach(function (tier) {
      var filterFn = tier === "DM_DSM" ? dmInScope : asmNsmInScopeRow;
      scoped.employees[tier] = {};
      var monthsObj = (decoded.employees && decoded.employees[tier]) || {};
      Object.keys(monthsObj).forEach(function (m) {
        scoped.employees[tier][m] = monthsObj[m].filter(filterFn);
      });
    });
    return scoped;
  }

  function decompressCache() {
    if (cache) return true;
    if (!window.WORKING_DAYS_CACHE || !window.WORKING_DAYS_CACHE.b64Data) return false;
    try {
      rawCache = gunzipB64Json(window.WORKING_DAYS_CACHE.b64Data);
      cache = applyScope(rawCache);
      return true;
    } catch (e) {
      console.error("[WorkingDays] Failed to decompress working_days cache", e);
      return false;
    }
  }

  function months() { return (cache && cache.monthOrder) || MONTHS_FALLBACK; }
  function availableMonths(tier) { return months().filter(function (m) { return cache.employees[tier][m]; }); }

  function fmtPct(v) { return v == null ? "--" : (v * 100).toFixed(1) + "%"; }
  function badgeClass(v) {
    if (v == null) return "";
    if (v > 1.0) return "over";
    if (v >= 0.85) return "good";
    if (v >= 0.70) return "warn";
    return "bad";
  }

  function employeesFor(tier, month, opts) {
    opts = opts || {};
    var rows = (cache.employees[tier] && cache.employees[tier][month]) || [];
    var bu = opts.bu !== undefined ? opts.bu : state.bu;
    var line = opts.line !== undefined ? opts.line : state.line;
    var profile = opts.profile !== undefined ? opts.profile : state.profile;
    if (bu) rows = rows.filter(function (r) { return r.bu === bu; });
    if (line) rows = rows.filter(function (r) { return r.line === line; });
    if (profile && tier === "DM_DSM") rows = rows.filter(function (r) { return r.profile === profile; });
    return rows;
  }

  function computeAgg(rows) {
    var valid = rows.filter(function (r) { return typeof r.fieldPct === "number"; });
    var avg = valid.length ? valid.reduce(function (s, r) { return s + r.fieldPct; }, 0) / valid.length : null;
    var bands = { below70: 0, "70to85": 0, "85to100": 0, above100: 0 };
    valid.forEach(function (r) {
      var v = r.fieldPct;
      if (v < 0.70) bands.below70++;
      else if (v < 0.85) bands["70to85"]++;
      else if (v <= 1.00) bands["85to100"]++;
      else bands.above100++;
    });
    var dedTotals = {};
    rows.forEach(function (r) {
      Object.keys(r.deducts || {}).forEach(function (k) { dedTotals[k] = (dedTotals[k] || 0) + r.deducts[k]; });
    });
    var dedAvg = {};
    Object.keys(dedTotals).forEach(function (k) { dedAvg[k] = rows.length ? +(dedTotals[k] / rows.length).toFixed(2) : 0; });
    return { count: rows.length, avgFieldPct: avg, bands: bands, deductAvg: dedAvg };
  }

  function el(id) { return document.getElementById(id); }

  function layoutHtml() {
    return (
      '<div class="wd-page">' +
      '<div class="wd-header">' +
      '<div><h1>Field Working Days</h1><p>TOT (Time Out of Territory) &amp; Field Working Days achievement by tier</p></div>' +
      '<div class="wd-tabs" id="wd-tier-tabs">' +
      '<button class="wd-tab-btn active" data-tier="DM_DSM">DM / DSM</button>' +
      '<button class="wd-tab-btn" data-tier="ASM">ASM</button>' +
      '<button class="wd-tab-btn" data-tier="NSM">NSM</button>' +
      "</div></div>" +
      '<div class="wd-filterbar">' +
      '<div class="wd-filter-group"><label>Month</label><select class="wd-select" id="wd-month-select"></select></div>' +
      '<div class="wd-filter-group"><label>BU</label><select class="wd-select" id="wd-bu-select"></select></div>' +
      '<div class="wd-filter-group"><label>Line</label><select class="wd-select" id="wd-line-select"></select></div>' +
      '<div class="wd-filter-group" id="wd-profile-group"><label>Profile</label><select class="wd-select" id="wd-profile-select"></select></div>' +
      '<button class="wd-clear-btn" id="wd-clear-filters">Clear filters</button>' +
      "</div>" +
      '<div class="wd-kpi-grid" id="wd-kpi-grid"></div>' +
      '<div class="wd-grid-2">' +
      '<div class="wd-card"><h2>Avg Field Working Days % &mdash; trend</h2>' +
      '<p class="wd-card-sub">Selected tier vs. the other two for context. BU/Line filters (not Profile) apply to all three.</p>' +
      '<canvas id="wd-trend-chart"></canvas></div>' +
      '<div class="wd-card"><h2>Achievement distribution</h2>' +
      '<p class="wd-card-sub" id="wd-dist-sub">Headcount by band</p>' +
      '<canvas id="wd-dist-chart"></canvas></div>' +
      "</div>" +
      '<div class="wd-card" style="margin-bottom:18px;">' +
      '<h2>TOT (Time Out of Territory) breakdown</h2>' +
      '<p class="wd-card-sub" id="wd-deduct-sub">Avg TOT days per employee by category</p>' +
      '<canvas id="wd-deduct-chart" style="max-height:220px;"></canvas></div>' +
      '<div class="wd-table-wrap">' +
      '<div class="wd-table-head"><h2 id="wd-table-title">Leaderboard</h2>' +
      '<input class="wd-search" id="wd-search" placeholder="Search by name, code, BU, line or profile..." /></div>' +
      '<div class="wd-scroll"><table class="wd-table"><thead><tr>' +
      '<th style="width:40px;">#</th><th data-sort="name">Name</th><th data-sort="bu">BU</th>' +
      '<th data-sort="line">Line</th><th data-sort="profile">Profile</th>' +
      '<th data-sort="targetDays" style="text-align:right;">Target Days</th>' +
      '<th data-sort="allVisitDays" style="text-align:right;">All Visit Days</th>' +
      '<th data-sort="fieldPct" style="text-align:right;">Field Days %</th>' +
      "</tr></thead><tbody id=\"wd-table-body\"></tbody></table></div></div>" +
      '<div class="wd-footnote">Target Working Days = (Calendar Days &minus; TOT [Time Out of Territory]) &times; tier multiplier ' +
      "(DM/DSM 0.8, ASM 0.6, NSM 0.3). Field Working Days % = All Visit Days / Target Working Days. " +
      "Multipliers differ by tier by design, so raw % is not directly comparable across tiers -- shown side-by-side for context only. " +
      "Click any row for the full per-employee calculation. Source: Sprint_Missing_KPI_Template.xlsx (DM_DSM, ASM, NSM).</div>" +
      '<div class="wd-modal-backdrop" id="wd-modal-backdrop" hidden><div class="wd-modal" id="wd-modal-body"></div></div>' +
      "</div>"
    );
  }

  function populateSelects() {
    var monthSel = el("wd-month-select");
    var avail = availableMonths(state.tier);
    monthSel.innerHTML = avail.map(function (m) { return '<option value="' + m + '">' + m + "</option>"; }).join("");
    if (avail.indexOf(state.month) === -1) state.month = avail[avail.length - 1];
    monthSel.value = state.month;

    var allRows = (cache.employees[state.tier] && cache.employees[state.tier][state.month]) || [];
    var buSel = el("wd-bu-select");
    var bus = Array.from(new Set(allRows.map(function (r) { return r.bu; }))).sort();
    buSel.innerHTML = '<option value="">All BUs</option>' + bus.map(function (b) { return '<option value="' + esc(b) + '">' + esc(b) + "</option>"; }).join("");
    if (bus.indexOf(state.bu) === -1) state.bu = "";
    buSel.value = state.bu;

    var lineRows = state.bu ? allRows.filter(function (r) { return r.bu === state.bu; }) : allRows;
    var lineSel = el("wd-line-select");
    var lines = Array.from(new Set(lineRows.map(function (r) { return r.line; }))).sort();
    lineSel.innerHTML = '<option value="">All Lines</option>' + lines.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + "</option>"; }).join("");
    if (lines.indexOf(state.line) === -1) state.line = "";
    lineSel.value = state.line;

    var profileGroup = el("wd-profile-group");
    if (state.tier === "DM_DSM") {
      profileGroup.style.display = "";
      var profRows = employeesFor("DM_DSM", state.month, { profile: "" });
      var profiles = Array.from(new Set(profRows.map(function (r) { return r.profile; }).filter(Boolean))).sort();
      var profSel = el("wd-profile-select");
      profSel.innerHTML = '<option value="">All Profiles</option>' + profiles.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + "</option>"; }).join("");
      if (profiles.indexOf(state.profile) === -1) state.profile = "";
      profSel.value = state.profile;
    } else {
      profileGroup.style.display = "none";
      state.profile = "";
    }
  }

  function renderKpis() {
    var rows = employeesFor(state.tier, state.month);
    var agg = computeAgg(rows);
    var avail = availableMonths(state.tier);
    var idx = avail.indexOf(state.month);
    var prevAgg = idx > 0 ? computeAgg(employeesFor(state.tier, avail[idx - 1])) : null;
    var belowPct = agg.count ? Math.round((100 * agg.bands.below70) / agg.count) : 0;
    var overPct = agg.count ? Math.round((100 * agg.bands.above100) / agg.count) : 0;
    var deltaHtml = "baseline month", deltaCls = "";
    if (prevAgg && prevAgg.avgFieldPct != null && agg.avgFieldPct != null) {
      var d = (agg.avgFieldPct - prevAgg.avgFieldPct) * 100;
      deltaCls = d >= 0 ? "up" : "down";
      deltaHtml = (d >= 0 ? "+" : "") + d.toFixed(1) + " pts vs " + avail[idx - 1];
    }
    el("wd-kpi-grid").innerHTML =
      '<div class="wd-kpi-card"><div class="wd-kpi-label">Avg Field Days %</div>' +
      '<div class="wd-kpi-value">' + fmtPct(agg.avgFieldPct) + "</div>" +
      '<div class="wd-kpi-sub ' + deltaCls + '">' + deltaHtml + "</div></div>" +
      '<div class="wd-kpi-card"><div class="wd-kpi-label">Employees in view</div>' +
      '<div class="wd-kpi-value">' + agg.count + "</div>" +
      '<div class="wd-kpi-sub">' + TIER_LABEL[state.tier] + ", " + state.month + (state.bu || state.line || state.profile ? " (filtered)" : "") + "</div></div>" +
      '<div class="wd-kpi-card"><div class="wd-kpi-label">Below 70% of target</div>' +
      '<div class="wd-kpi-value">' + agg.bands.below70 + "</div>" +
      '<div class="wd-kpi-sub">' + belowPct + "% of this view -- coaching candidates</div></div>" +
      '<div class="wd-kpi-card"><div class="wd-kpi-label">Above 100% of target</div>' +
      '<div class="wd-kpi-value">' + agg.bands.above100 + "</div>" +
      '<div class="wd-kpi-sub">' + overPct + "% of this view -- check target calibration</div></div>";
  }

  function renderTrend() {
    var ctx = el("wd-trend-chart");
    if (!ctx || typeof Chart === "undefined") return;
    var datasets = ["DM_DSM", "ASM", "NSM"].map(function (tier) {
      var isSelected = tier === state.tier;
      return {
        label: TIER_LABEL[tier],
        data: months().map(function (m) {
          if (!cache.employees[tier][m]) return null;
          var agg = computeAgg(employeesFor(tier, m, { profile: "" }));
          return agg.avgFieldPct != null ? +(agg.avgFieldPct * 100).toFixed(1) : null;
        }),
        borderColor: TIER_COLOR[tier], backgroundColor: TIER_COLOR[tier],
        borderWidth: isSelected ? 3 : 1.5, borderDash: isSelected ? [] : [4, 3],
        pointRadius: isSelected ? 3 : 2, spanGaps: true, tension: 0.25,
      };
    });
    if (charts.trend) charts.trend.destroy();
    charts.trend = new Chart(ctx, {
      type: "line",
      data: { labels: months().map(function (m) { return m.slice(0, 3); }), datasets: datasets },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ": " + c.parsed.y + "%"; } } } },
        scales: { y: { ticks: { callback: function (v) { return v + "%"; } }, grid: { color: "#EEF1F5" } }, x: { grid: { display: false } } },
      },
    });
  }

  function renderDist() {
    var rows = employeesFor(state.tier, state.month);
    var agg = computeAgg(rows);
    el("wd-dist-sub").textContent = "Headcount by band, " + TIER_LABEL[state.tier] + " -- " + state.month;
    var ctx = el("wd-dist-chart");
    if (!ctx || typeof Chart === "undefined") return;
    if (charts.dist) charts.dist.destroy();
    charts.dist = new Chart(ctx, {
      type: "bar",
      data: { labels: ["<70%", "70-85%", "85-100%", ">100%"],
        datasets: [{ data: [agg.bands.below70, agg.bands["70to85"], agg.bands["85to100"], agg.bands.above100],
          backgroundColor: ["#DC2626", "#B45309", "#15803D", "#0891B2"], borderRadius: 4 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
    });
  }

  function renderDeduct() {
    var rows = employeesFor(state.tier, state.month);
    var agg = computeAgg(rows);
    el("wd-deduct-sub").textContent = "Avg TOT days per employee by category, " + TIER_LABEL[state.tier] + " -- " + state.month;
    var ctx = el("wd-deduct-chart");
    if (!ctx || typeof Chart === "undefined") return;
    var entries = Object.keys(agg.deductAvg).map(function (k) { return [k, agg.deductAvg[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (charts.deduct) charts.deduct.destroy();
    charts.deduct = new Chart(ctx, {
      type: "bar",
      data: { labels: entries.map(function (e) { return e[0]; }), datasets: [{ data: entries.map(function (e) { return e[1]; }), backgroundColor: "#0F4C81", borderRadius: 4 }] },
      options: { indexAxis: "y", responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: "#EEF1F5" } }, y: { grid: { display: false } } } },
    });
  }

  function renderTable() {
    el("wd-table-title").textContent = TIER_LABEL[state.tier] + " — " + state.month + " leaderboard";
    var rows = employeesFor(state.tier, state.month).slice();
    if (state.search) {
      var q = state.search.toLowerCase();
      rows = rows.filter(function (r) {
        return (r.name || "").toLowerCase().indexOf(q) >= 0 ||
          (r.line || "").toLowerCase().indexOf(q) >= 0 ||
          (r.bu || "").toLowerCase().indexOf(q) >= 0 ||
          (r.profile || "").toLowerCase().indexOf(q) >= 0 ||
          (r.code || "").indexOf(q) >= 0;
      });
    }
    rows.sort(function (a, b) {
      var av = a[state.sortKey], bv = b[state.sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return av.localeCompare(bv) * state.sortDir;
      return (av - bv) * state.sortDir;
    });
    var tbody = el("wd-table-body");
    tbody.innerHTML = rows.map(function (r, i) {
      return '<tr data-code="' + esc(r.code) + '"' + (r.leftCompany ? ' class="wd-row-left"' : "") + '>' +
        '<td><span class="wd-rank">' + (i + 1) + "</span></td>" +
        "<td>" + esc(r.name) + (r.leftCompany ? ' <span class="wd-badge left">Left Company</span>' : "") + "</td>" +
        "<td>" + esc(r.bu) + "</td>" +
        "<td>" + esc(r.line) + "</td>" +
        "<td>" + esc(r.profile || "—") + "</td>" +
        '<td style="text-align:right;">' + (r.targetDays != null ? r.targetDays : "--") + "</td>" +
        '<td style="text-align:right;">' + (r.allVisitDays != null ? r.allVisitDays : "--") + "</td>" +
        '<td style="text-align:right;"><span class="wd-badge ' + badgeClass(r.fieldPct) + '">' + fmtPct(r.fieldPct) + '</span><span class="wd-info-icon">i</span></td>' +
        "</tr>";
    }).join("") || '<tr><td colspan="8" style="text-align:center;color:var(--color-text-tertiary);padding:24px;">No employees match this filter combination.</td></tr>';
    Array.prototype.forEach.call(tbody.querySelectorAll("tr[data-code]"), function (tr) {
      tr.addEventListener("click", function () { openCalcModal(tr.getAttribute("data-code")); });
    });
  }

  function openCalcModal(code) {
    var rows = (cache.employees[state.tier] && cache.employees[state.tier][state.month]) || [];
    var emp = null;
    for (var i = 0; i < rows.length; i++) { if (rows[i].code === code) { emp = rows[i]; break; } }
    if (!emp) return;
    var mult = cache.multiplier[state.tier];
    var dedRows = Object.keys(emp.deducts || {}).map(function (k) {
      return '<div class="wd-calc-row minus"><span class="lbl">' + esc(k) + "</span><span>" + emp.deducts[k] + "</span></div>";
    }).join("");
    var subtitleBits = [TIER_LABEL[state.tier], "code " + esc(emp.code), esc(emp.bu) + (emp.line && emp.line !== emp.bu ? " / " + esc(emp.line) : "")];
    if (emp.profile) subtitleBits.push(esc(emp.profile));
    subtitleBits.push(state.month);
    var hireRow = emp.hireDate ? '<div class="wd-calc-row"><span class="lbl">Hire Date</span><span>' + esc(emp.hireDate) + "</span></div>" : "";
    var lastDayRow = emp.lastDay ? '<div class="wd-calc-row"><span class="lbl">Last Day of Work</span><span>' + esc(emp.lastDay) + "</span></div>" : "";
    var leftBanner = emp.leftCompany
      ? '<div class="wd-banner">Left the company during ' + esc(state.month) + " -- Field Working Days % below reflects a partial month only, not a full-period shortfall.</div>"
      : "";
    el("wd-modal-body").innerHTML =
      '<button class="wd-modal-close" id="wd-modal-close">&times;</button>' +
      "<h3>" + esc(emp.name) + "</h3>" +
      '<p class="wd-modal-sub">' + subtitleBits.join(" &middot; ") + "</p>" +
      leftBanner + hireRow + lastDayRow +
      '<div class="wd-calc-row"><span class="lbl">Calendar Days</span><span>' + emp.calendarDays + "</span></div>" +
      dedRows +
      '<div class="wd-calc-row total"><span class="lbl">Total TOT (Time Out of Territory)</span><span>' + emp.deductSum + "</span></div>" +
      '<div class="wd-calc-formula">Target Working Days<br>= (Calendar Days &minus; TOT) &times; ' + mult + "<br>= (" + emp.calendarDays + " &minus; " + emp.deductSum + ") &times; " + mult + "<br>= <b>" + emp.targetDays + "</b> days</div>" +
      '<div class="wd-calc-row"><span class="lbl">All Visit Days (actual)</span><span>' + emp.allVisitDays + "</span></div>" +
      '<div class="wd-calc-formula">Field Working Days %<br>= All Visit Days / Target Working Days<br>= ' + emp.allVisitDays + " / " + emp.targetDays + "</div>" +
      '<div class="wd-calc-final"><div class="v">' + fmtPct(emp.fieldPct) + '</div><div class="l">Field Working Days Achievement</div></div>';
    el("wd-modal-backdrop").hidden = false;
    el("wd-modal-close").addEventListener("click", closeCalcModal);
  }
  function closeCalcModal() { var b = el("wd-modal-backdrop"); if (b) b.hidden = true; }

  function renderAll() {
    populateSelects();
    renderKpis();
    renderTrend();
    renderDist();
    renderDeduct();
    renderTable();
  }

  function wireEvents() {
    Array.prototype.forEach.call(document.querySelectorAll(".wd-tab-btn"), function (btn) {
      btn.addEventListener("click", function () {
        Array.prototype.forEach.call(document.querySelectorAll(".wd-tab-btn"), function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        state.tier = btn.getAttribute("data-tier");
        state.bu = ""; state.line = ""; state.profile = "";
        var avail = availableMonths(state.tier);
        if (avail.indexOf(state.month) === -1) state.month = avail[avail.length - 1];
        renderAll();
      });
    });
    el("wd-month-select").addEventListener("change", function (e) { state.month = e.target.value; renderAll(); });
    el("wd-bu-select").addEventListener("change", function (e) { state.bu = e.target.value; state.line = ""; renderAll(); });
    el("wd-line-select").addEventListener("change", function (e) { state.line = e.target.value; renderAll(); });
    el("wd-profile-select").addEventListener("change", function (e) { state.profile = e.target.value; renderAll(); });
    el("wd-clear-filters").addEventListener("click", function () { state.bu = ""; state.line = ""; state.profile = ""; renderAll(); });
    el("wd-search").addEventListener("input", function (e) { state.search = e.target.value; renderTable(); });
    Array.prototype.forEach.call(document.querySelectorAll("th[data-sort]"), function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort");
        state.sortDir = state.sortKey === key ? -state.sortDir : -1;
        state.sortKey = key;
        renderTable();
      });
    });
    el("wd-modal-backdrop").addEventListener("click", function (e) {
      if (e.target && e.target.id === "wd-modal-backdrop") closeCalcModal();
    });
  }

  function renderNoCacheState(root) {
    root.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:70vh;flex-direction:column;gap:12px;color:#64748B;">' +
      '<div style="font-size:40px;">\u{1F4C5}</div>' +
      '<div style="font-size:16px;font-weight:700;color:#0F172A;">Field Working Days cache not found</div>' +
      '<div style="font-size:13px;max-width:480px;text-align:center;">Run <code>python etl/build_working_days_cache.py</code> to generate cache/working_days.data.js before opening this tab.</div></div>';
  }

  function renderAccessRestricted(root) {
    document.body.classList.add("working-days-mode");
    root.innerHTML = window.DS
      ? '<div class="ds-page"><div style="max-width:520px;margin:80px auto;text-align:center;">' +
        window.DS.emptyState({ icon: "\u{1F512}", title: "Access restricted", hint: "Field Working Days Intelligence is available to BU Manager, BEx, VP, SFE Manager, Admin and CEO roles only." }) +
        "</div></div>"
      : "<p>Access restricted.</p>";
  }

  window.WorkingDaysDashboard = {
    init: function (containerId) {
      var root = document.getElementById(containerId || "app-root");
      if (!root) return;
      if (!canViewPage()) {
        renderAccessRestricted(root);
        return;
      }
      if (!decompressCache()) {
        renderNoCacheState(root);
        return;
      }
      document.body.classList.add("working-days-mode");
      state.tier = "DM_DSM";
      var avail = availableMonths(state.tier);
      state.month = avail[avail.length - 1] || null;
      root.innerHTML = layoutHtml();
      wireEvents();
      renderAll();
    },
    canView: canViewPage,
    destroy: function () {
      document.body.classList.remove("working-days-mode");
      if (charts.trend) { charts.trend.destroy(); charts.trend = null; }
      if (charts.dist) { charts.dist.destroy(); charts.dist = null; }
      if (charts.deduct) { charts.deduct.destroy(); charts.deduct = null; }
    },
  };
})();
