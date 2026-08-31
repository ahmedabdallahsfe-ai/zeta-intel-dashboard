/**
 * ZETA Coaching Intelligence -- js/coaching.js
 * =====================================================================
 * PLATFORM ASSET. Exposes window.CoachingDashboard = { init, destroy }.
 *
 * New tab (2026-08-31, Ahmed) built on cache/coaching.data.js, produced
 * by etl/build_coaching_cache.py from "Visits Details S1 DM.xlsx" (Total
 * sheet -- one row per JOINT/COACHED field visit, Coached=Coached on
 * every row already) joined against Database Shortcut.xlsx for active
 * team rosters and confirmed name matching (0 unmatched reps, 0
 * unmatched coaching managers, out of 757 reps / 165 managers -- see
 * that script's header for the alias list and why it is NOT fuzzy
 * matching).
 *
 * SCOPE, confirmed with Ahmed 2026-08-31:
 *   - Period Feb 1 - Jun 30 2026 (S1). Every metric below has both a
 *     Cumulative (S1) and a per-month (Feb..Jun) view via the toggle.
 *   - Fields used: Employee, Coach Employee 1, Title 1, Date, Team, Area,
 *     Customer (name only, in the coached-employee drill-down's customer
 *     popup -- never in a main KPI table).
 *   - Fields deliberately EXCLUDED from every KPI here: Duration, GPS
 *     Deviation, Specialty, Customer Type, Status.
 *   - DV Coverage % (own active team coached / own active team size,
 *     capped at 100% for display -- reps coached who are NOT on the
 *     manager's own roster are shown separately as "cross-team", never
 *     silently folded in or dropped) and the two numeric targets
 *     (Coverage >=75%, Avg Coaching Visits/Day >=7) apply ONLY to
 *     District Manager and Field force supervisor -- the two levels
 *     with a real "own team" concept. Every other coaching level (Sr.
 *     District Manager, National Sales Manager, Area Manager, Business
 *     Unit Manager, Brand Manager, Field Force Trainer, Group Brand
 *     lead) gets visits / coaching days / zones visited with no target.
 *
 * ACCESS MODEL (mirrors Sprint's split -- auth.js's canViewCoaching()
 * only gates whether the menu entry/tab renders at all; this file does
 * the finer split the business actually asked for):
 *   - District Manager / Field force supervisor (matched by the signed
 *     -in user's name against this cache): see ONLY their own record and
 *     their own coached employees.
 *   - Every other signed-in role (Sr.DM/NSM/AM/BUM/Brand Manager/FF
 *     Trainer/BU Manager/unmatched Line Manager): see every manager
 *     within their existing AUTH.isBuAllowed()/isLineAllowed() scope --
 *     deliberately reusing that mechanism rather than building a second,
 *     parallel hierarchy-walk, per Ahmed's explicit instruction to keep
 *     it "consistent with the rest of the dashboard".
 *   - CEO/VP/BEX/Admin/SFE Manager: full access within their (usually
 *     unrestricted) BU/Line scope, same as every other tab.
 * =====================================================================
 */
(function (global) {
  "use strict";

  var FULL_ACCESS_ROLES = ["CEO", "VP", "BEX", "Admin", "SFE Manager"];
  var OWN_ONLY_TITLES = ["District Manager", "Field force supervisor"];

  var _cache = null;      // decompressed coaching.json payload
  var _visible = [];      // managers this signed-in user may see (after scoping)
  var _state = {
    period: "ALL",         // "ALL" (S1 cumulative) or a "YYYY-MM" key
    drillManagerId: null,  // manager id whose coached-employee table is open
    customerPopupKey: null // "managerId::empId" whose customer popup is open
  };

  // ---------------------------------------------------------------
  // Cache load / decompression (same pako gzip+b64 pattern as
  // js/sprint.js's gunzipB64Json / js/cache.js's decompressB64Gzip)
  // ---------------------------------------------------------------
  function gunzipB64Json(b64) {
    if (!b64) return null;
    try {
      var strData = atob(b64);
      var bytes = new Uint8Array(strData.length);
      for (var i = 0; i < strData.length; i++) bytes[i] = strData.charCodeAt(i);
      return JSON.parse(pako.ungzip(bytes, { to: "string" }));
    } catch (e) {
      console.error("[Coaching] cache decompression failed", e);
      return null;
    }
  }

  function loadCache() {
    if (_cache) return _cache;
    if (!global.COACHING_CACHE || !global.COACHING_CACHE.b64Data) return null;
    _cache = gunzipB64Json(global.COACHING_CACHE.b64Data);
    return _cache;
  }

  function normName(s) {
    if (!s) return "";
    return String(s).toUpperCase().replace(/ /g, " ").trim().replace(/\s+/g, " ");
  }

  // ---------------------------------------------------------------
  // Visibility scoping -- see header comment for the rule
  // ---------------------------------------------------------------
  function getVisibleManagers(data) {
    var u = global.AUTH && global.AUTH.getValidSessionUser && global.AUTH.getValidSessionUser();
    if (!u) return [];
    var isBuAllowed = (global.AUTH && global.AUTH.isBuAllowed) || function () { return true; };
    var isLineAllowed = (global.AUTH && global.AUTH.isLineAllowed) || function () { return true; };

    var scoped = data.managers.filter(function (m) {
      return isBuAllowed(m.bu) && isLineAllowed(m.line);
    });

    if (FULL_ACCESS_ROLES.indexOf(u.role) >= 0) return scoped;

    var selfNorm = normName(u.name);
    var myRecord = data.managers.filter(function (m) { return m.id === selfNorm; })[0];
    if (myRecord && OWN_ONLY_TITLES.indexOf(myRecord.title) >= 0) {
      return scoped.filter(function (m) { return m.id === selfNorm; });
    }
    return scoped; // Sr.DM/NSM/AM/BUM/Brand Manager/FFT/BU Manager/unmatched: BU+Line scope only
  }

  // ---------------------------------------------------------------
  // Metric helpers -- pick the current period's bucket for a manager
  // ---------------------------------------------------------------
  function metricsFor(manager) {
    if (_state.period === "ALL") return manager.cumulative;
    return manager.monthly[_state.period] || {
      visits: 0, coachingDays: 0, avgVisitsPerDay: 0, avgVsTargetPct: 0,
      coachedOnRoster: 0, coachedOffRoster: 0, zones: 0,
      dvCoveragePct: manager.cumulative.dvCoveragePct !== undefined ? null : undefined,
    };
  }

  function fmtPct(v) { return (v === null || v === undefined) ? "—" : v.toFixed(1) + "%"; }
  function fmtNum(v) { return (v === null || v === undefined) ? "—" : v; }

  function badgeFor(value, target, higherIsBetter) {
    if (value === null || value === undefined) return '<span class="badge badge-neutral">n/a</span>';
    var ok = higherIsBetter ? value >= target : value <= target;
    var near = higherIsBetter ? value >= target * 0.85 : value <= target * 1.15;
    var cls = ok ? "badge-up" : (near ? "badge-warn" : "badge-down");
    var icon = ok ? "✓" : (near ? "▲" : "▼");
    return '<span class="badge ' + cls + '">' + icon + " " + (ok ? "On target" : "Below target") + "</span>";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------------------------------------------------------------
  // Render: top summary KPI row (scope + period aware)
  // ---------------------------------------------------------------
  function renderSummary(data, ownTierManagers) {
    var totalVisits = _visible.reduce(function (s, m) { return s + metricsFor(m).visits; }, 0);
    var covVals = ownTierManagers.map(function (m) { return metricsFor(m).dvCoveragePct; }).filter(function (v) { return v !== null && v !== undefined; });
    var avgCov = covVals.length ? (covVals.reduce(function (a, b) { return a + b; }, 0) / covVals.length) : null;
    var avgDayVals = ownTierManagers.map(function (m) { return metricsFor(m).avgVisitsPerDay; }).filter(function (v) { return v !== null && v !== undefined; });
    var avgDay = avgDayVals.length ? (avgDayVals.reduce(function (a, b) { return a + b; }, 0) / avgDayVals.length) : null;
    var onTargetCount = ownTierManagers.filter(function (m) {
      var mm = metricsFor(m);
      return mm.dvCoveragePct !== null && mm.dvCoveragePct !== undefined && mm.dvCoveragePct >= data.targets.dvCoveragePct;
    }).length;

    return '' +
      '<div class="kpi-grid">' +
      '<div class="kpi-card blue"><div class="kpi-label">Coaching Visits</div><div class="kpi-value">' + totalVisits.toLocaleString() + '</div><div class="kpi-sub">in scope, ' + periodLabel() + '</div></div>' +
      '<div class="kpi-card purple"><div class="kpi-label">Coaching Managers</div><div class="kpi-value">' + _visible.length + '</div><div class="kpi-sub">DM/FS: ' + ownTierManagers.length + ' with an own team</div></div>' +
      '<div class="kpi-card green"><div class="kpi-label">Avg DV Coverage (DM/FS)</div><div class="kpi-value">' + fmtPct(avgCov) + '</div><div class="kpi-sub">target ' + data.targets.dvCoveragePct + '% &middot; ' + onTargetCount + '/' + ownTierManagers.length + ' on target</div></div>' +
      '<div class="kpi-card orange"><div class="kpi-label">Avg Visits / Coaching Day (DM/FS)</div><div class="kpi-value">' + (avgDay === null ? "—" : avgDay.toFixed(1)) + '</div><div class="kpi-sub">target ' + data.targets.avgVisitsPerDay + '/day</div></div>' +
      '</div>';
  }

  function periodLabel() {
    if (_state.period === "ALL") return "S1 cumulative (Feb–Jun)";
    var d = new Date(_state.period + "-01T00:00:00");
    return d.toLocaleString("en-US", { month: "long", year: "numeric" });
  }

  // ---------------------------------------------------------------
  // Render: period toggle (Monthly buttons + Cumulative)
  // ---------------------------------------------------------------
  function renderPeriodToggle(data) {
    var btns = ['<button class="tb-btn' + (_state.period === "ALL" ? " tb-btn-active" : "") + '" data-period="ALL">S1 Cumulative</button>'];
    data.period.months.forEach(function (m) {
      var d = new Date(m + "-01T00:00:00");
      var label = d.toLocaleString("en-US", { month: "short" });
      btns.push('<button class="tb-btn' + (_state.period === m ? " tb-btn-active" : "") + '" data-period="' + m + '">' + label + '</button>');
    });
    return '<div id="coaching-period-toggle" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:var(--gap-grid);">' + btns.join("") + '</div>';
  }

  // ---------------------------------------------------------------
  // Render: DM / Field force supervisor scorecards
  // ---------------------------------------------------------------
  function renderOwnTierCards(data, managers) {
    if (!managers.length) {
      return '<p style="opacity:.7;padding:12px 0;">No District Manager / Field force supervisor records in your scope for this period.</p>';
    }
    var cards = managers
      .slice()
      .sort(function (a, b) { return metricsFor(b).visits - metricsFor(a).visits; })
      .map(function (m) {
        var mm = metricsFor(m);
        var covBadge = badgeFor(mm.dvCoveragePct, data.targets.dvCoveragePct, true);
        var dayBadge = badgeFor(mm.avgVisitsPerDay, data.targets.avgVisitsPerDay, true);
        var crossTeam = mm.coachedOffRoster > 0
          ? '<div class="kpi-sub" style="margin-top:4px;">+' + mm.coachedOffRoster + ' cross-team coaching visits (not counted toward coverage)</div>'
          : "";
        return '' +
          '<div class="kpi-card blue" style="cursor:pointer;" data-drill="' + esc(m.id) + '">' +
          '<div class="kpi-label">' + esc(m.name) + '</div>' +
          '<div class="kpi-sub">' + esc(m.title) + (m.line ? " &middot; " + esc(m.line) : "") + '</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;">' +
          '<div><div class="kpi-value" style="font-size:20px;">' + mm.visits + '</div><div class="kpi-sub">Visits</div></div>' +
          '<div><div class="kpi-value" style="font-size:20px;">' + mm.coachingDays + '</div><div class="kpi-sub">Coaching Days</div></div>' +
          '<div><div class="kpi-value" style="font-size:20px;">' + mm.avgVisitsPerDay.toFixed(1) + '</div><div class="kpi-sub">Avg/Day ' + dayBadge + '</div></div>' +
          '<div><div class="kpi-value" style="font-size:20px;">' + fmtPct(mm.dvCoveragePct) + '</div><div class="kpi-sub">DV Coverage ' + covBadge + '</div></div>' +
          '</div>' + crossTeam +
          '<div class="kpi-sub" style="margin-top:6px;text-decoration:underline;">View coached employees &rarr;</div>' +
          '</div>';
      }).join("");
    return '<div class="kpi-grid" id="coaching-own-tier-grid">' + cards + '</div>';
  }

  // ---------------------------------------------------------------
  // Render: other coaching levels (no target)
  // ---------------------------------------------------------------
  function renderOtherLevelsTable(managers) {
    var others = managers.filter(function (m) { return OWN_ONLY_TITLES.indexOf(m.title) < 0; });
    if (!others.length) {
      return '<p style="opacity:.7;padding:12px 0;">No other-level coaching records in your scope for this period.</p>';
    }
    others = others.slice().sort(function (a, b) { return metricsFor(b).visits - metricsFor(a).visits; });
    var rows = others.map(function (m) {
      var mm = metricsFor(m);
      return '<tr>' +
        '<td>' + esc(m.name) + '</td>' +
        '<td>' + esc(m.title) + '</td>' +
        '<td>' + esc(m.line || "—") + '</td>' +
        '<td>' + mm.visits + '</td>' +
        '<td>' + mm.coachingDays + '</td>' +
        '<td>' + mm.avgVisitsPerDay.toFixed(1) + '</td>' +
        '<td>' + mm.zones + '</td>' +
        '<td><a href="#" data-drill="' + esc(m.id) + '">View coached &rarr;</a></td>' +
        '</tr>';
    }).join("");
    return '' +
      '<table class="data-table" id="coaching-other-levels-table">' +
      '<thead><tr><th>Name</th><th>Title</th><th>Line</th><th>Visits</th><th>Coaching Days</th><th>Avg/Day</th><th>Zones Visited</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  // ---------------------------------------------------------------
  // Render: coached-employee drill-down (visit-count focused, with a
  // customer popup per row -- per Ahmed's explicit instruction to keep
  // the main table visit-count-only and put customers behind a popup)
  // ---------------------------------------------------------------
  function renderDrillDown(manager) {
    var mkey = _state.period;
    var rows = manager.coachedEmployees.slice().sort(function (a, b) {
      var av = mkey === "ALL" ? a.visits : ((a.monthly[mkey] || {}).visits || 0);
      var bv = mkey === "ALL" ? b.visits : ((b.monthly[mkey] || {}).visits || 0);
      return bv - av;
    });
    var body = rows.map(function (ce, i) {
      var v = mkey === "ALL" ? ce.visits : ((ce.monthly[mkey] || {}).visits || 0);
      var d = mkey === "ALL" ? ce.coachingDays : ((ce.monthly[mkey] || {}).coachingDays || 0);
      if (mkey !== "ALL" && v === 0) return "";
      var popKey = manager.id + "::" + i;
      return '<tr>' +
        '<td>' + esc(ce.name) + '</td>' +
        '<td>' + (ce.onRoster ? '<span class="badge badge-up">Own team</span>' : '<span class="badge badge-warn">Cross-team</span>') + '</td>' +
        '<td>' + v + '</td>' +
        '<td>' + d + '</td>' +
        '<td>' + esc(ce.firstDate) + ' → ' + esc(ce.lastDate) + '</td>' +
        '<td>' + ce.zones + '</td>' +
        '<td><button class="tb-btn" data-cust-popup="' + esc(popKey) + '" data-cust-idx="' + i + '" data-cust-mgr="' + esc(manager.id) + '">Customers (' + ce.customers.length + ')</button></td>' +
        '</tr>';
    }).join("");
    return '' +
      '<div class="section active" id="coaching-drilldown-panel" style="margin-top:var(--gap-grid);">' +
      '<div class="section-title">' + esc(manager.name) + ' — Coached Employees <span style="font-weight:400;font-size:.7em;opacity:.7;">(' + periodLabel() + ')</span></div>' +
      '<button class="tb-btn" id="coaching-close-drill" style="margin-bottom:10px;">&larr; Close</button>' +
      '<table class="data-table"><thead><tr><th>Employee</th><th>Roster</th><th>Visits</th><th>Coaching Days</th><th>First → Last</th><th>Zones</th><th>Customers</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>' +
      '</div>';
  }

  function renderCustomerPopup(manager, idx) {
    var ce = manager.coachedEmployees[idx];
    if (!ce) return "";
    var rows = ce.customers.map(function (c) {
      return '<tr><td>' + esc(c.name) + '</td><td>' + c.visits + '</td></tr>';
    }).join("");
    return '' +
      '<div id="coaching-customer-modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;"></div>' +
      '<div id="coaching-customer-modal" style="position:fixed;top:10%;left:50%;transform:translateX(-50%);max-width:520px;width:90%;max-height:70vh;overflow:auto;background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius-card);box-shadow:var(--card-sh);padding:var(--pad-card);z-index:9999;">' +
      '<div class="section-title">' + esc(ce.name) + ' — Customers Visited Together</div>' +
      '<button class="tb-btn" id="coaching-close-cust-popup" style="margin-bottom:10px;">&times; Close</button>' +
      '<table class="data-table"><thead><tr><th>Customer</th><th>Joint Visits</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div>';
  }

  // ---------------------------------------------------------------
  // Reconciliation footnote -- surfaces the ETL's own QA numbers so a
  // stale/broken cache is visible on the page, not just in a console.
  // ---------------------------------------------------------------
  function renderFootnote(data) {
    var r = data.reconciliation || {};
    return '<div style="margin-top:24px;font-size:11px;opacity:.55;">' +
      'Source: Visits Details S1 DM.xlsx (Total sheet) &middot; generated ' + esc(data.generatedAt) +
      ' &middot; ' + r.rowsProcessed + '/' + r.totalVisitRowsInSheet + ' rows &middot; ' +
      r.totalCoachingManagers + ' coaching managers &middot; monthly = cumulative: ' + (r.monthlyEqualsCumulative ? "yes" : "NO — CHECK CACHE") +
      ' &middot; unmatched names: ' + ((r.unmatchedReps || []).length + (r.unmatchedCoaches || []).length) +
      '</div>';
  }

  // ---------------------------------------------------------------
  // Full render
  // ---------------------------------------------------------------
  function render(root, data) {
    var ownTier = _visible.filter(function (m) { return OWN_ONLY_TITLES.indexOf(m.title) >= 0; });

    var html = '<div class="iqvia-dashboard-wrap" style="height:auto;overflow:visible;padding:var(--pad-section);">' +
      '<div class="section active">' +
      '<div class="section-title">Coaching Intelligence</div>' +
      '<div class="section-sub">S1 2026 (Feb 1 – Jun 30) &middot; joint / coached field visits</div>' +
      renderPeriodToggle(data) +
      renderSummary(data, ownTier) +
      '<div class="section-title" style="margin-top:24px;font-size:18px;">District Managers &amp; Field Force Supervisors</div>' +
      '<div class="section-sub">DV Coverage target ' + data.targets.dvCoveragePct + '% of own active team &middot; Avg Visits/Day target ' + data.targets.avgVisitsPerDay + '</div>' +
      renderOwnTierCards(data, ownTier) +
      '<div class="section-title" style="margin-top:24px;font-size:18px;">Other Coaching Levels</div>' +
      '<div class="section-sub">Senior District Manager, National Sales Manager, Area Manager, Business Unit Manager, Brand Manager, Field Force Trainer — no coverage target</div>' +
      renderOtherLevelsTable(_visible) +
      '<div id="coaching-drilldown-slot"></div>' +
      renderFootnote(data) +
      '</div></div>';

    root.innerHTML = html;

    if (_state.drillManagerId) {
      var m = _visible.filter(function (x) { return x.id === _state.drillManagerId; })[0];
      var slot = document.getElementById("coaching-drilldown-slot");
      if (m && slot) slot.innerHTML = renderDrillDown(m);
    }
    if (_state.customerPopupKey) {
      var parts = _state.customerPopupKey.split("::");
      var mgr = _visible.filter(function (x) { return x.id === parts[0]; })[0];
      if (mgr) {
        var wrap = document.createElement("div");
        wrap.innerHTML = renderCustomerPopup(mgr, parseInt(parts[1], 10));
        while (wrap.firstChild) root.appendChild(wrap.firstChild);
      }
    }

    wireEvents(root, data);
  }

  function wireEvents(root, data) {
    var toggle = document.getElementById("coaching-period-toggle");
    if (toggle) {
      toggle.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-period]");
        if (!btn) return;
        _state.period = btn.getAttribute("data-period");
        render(root, data);
      });
    }
    root.addEventListener("click", function (e) {
      var drillEl = e.target.closest("[data-drill]");
      if (drillEl) {
        e.preventDefault();
        _state.drillManagerId = drillEl.getAttribute("data-drill");
        _state.customerPopupKey = null;
        render(root, data);
        return;
      }
      var custBtn = e.target.closest("[data-cust-popup]");
      if (custBtn) {
        _state.customerPopupKey = custBtn.getAttribute("data-cust-mgr") + "::" + custBtn.getAttribute("data-cust-idx");
        render(root, data);
        return;
      }
      if (e.target.id === "coaching-close-drill") {
        _state.drillManagerId = null;
        render(root, data);
        return;
      }
      if (e.target.id === "coaching-close-cust-popup" || e.target.id === "coaching-customer-modal-backdrop") {
        _state.customerPopupKey = null;
        render(root, data);
        return;
      }
    });
  }

  function renderNoAccess(root) {
    root.innerHTML = '<div class="iqvia-dashboard-wrap" style="height:auto;padding:var(--pad-section);">' +
      '<div class="section active"><div class="section-title">Coaching Intelligence</div>' +
      '<p style="opacity:.7;">No coaching records are visible for your account/BU/Line scope for S1 2026.</p></div></div>';
  }

  function init(rootId) {
    var root = document.getElementById(rootId);
    if (!root) return;
    document.body.classList.add("coaching-mode");
    var data = loadCache();
    if (!data) {
      root.innerHTML = '<div class="iqvia-dashboard-wrap" style="height:auto;padding:var(--pad-section);">' +
        '<div class="section active"><div class="section-title">Coaching Intelligence</div>' +
        '<p style="opacity:.7;">Coaching data is not available in this build (cache/coaching.data.js missing or failed to load). Run etl/build_coaching_cache.py.</p></div></div>';
      return;
    }
    _state.drillManagerId = null;
    _state.customerPopupKey = null;
    _visible = getVisibleManagers(data);
    if (!_visible.length) {
      renderNoAccess(root);
      return;
    }
    render(root, data);
  }

  function destroy() {
    document.body.classList.remove("coaching-mode");
  }

  global.CoachingDashboard = { init: init, destroy: destroy };
})(window);
