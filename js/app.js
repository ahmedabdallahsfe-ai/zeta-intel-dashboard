/**
 * app.js
 * ======
 * Application entry point and orchestrator. Boot sequence:
 *   Loader.show -> CacheStore.init -> Analytics.init -> self-check ->
 *   build static section shells (once) -> Filters.init (drives the first
 *   render) -> Loader.hide.
 *
 * Every subsequent filter change re-runs Analytics.run() and calls
 * renderAll() again -- charts update in place (charts.js), tables
 * re-render against their own remembered sort/search/page state
 * (tables.js), everything else is cheap innerHTML replacement.
 */

let sections = {}; // id -> section-body element, populated once by buildLayout()
let filenameSuffix = "AllData"; // active-filter suffix, refreshed every render, read by every export button's exportFileName
let _lastFilterState = null; // stored so the Not-Seen modal can call getNotSeenCustomers with current filters
let _lastResult = null; // stored so the At-Risk tiers modal can find tier lists
let currentTab = "coverage";

document.addEventListener("DOMContentLoaded", () => {
  Loader.init();
  Loader.show("Loading dashboard...");

  const cacheOk = CacheStore.init();
  if (!cacheOk) {
    renderMissingCacheNotice();
    Loader.hide();
    return;
  }

  const dashboard = CacheStore.getDashboard();
  const metadata = CacheStore.getMetadata();

  renderTopBar(metadata, dashboard);
  wireDashboardExport();

  const records = CacheStore.getRecords();
  const hasRecords = !!records;

  Loader.setMessage("Building aggregations...");
  if (hasRecords) {
    Analytics.init(records, dashboard.dimensions);
    const selfCheck = Analytics.selfCheck(dashboard.kpis);
    window.__selfCheck = selfCheck; // surfaced in the Data Quality panel
  } else {
    window.__selfCheck = { ok: true, mismatches: [] };
  }

  Loader.setMessage("Creating dashboard layout...");
  buildLayout();
  wireChartExportDelegation();

  if (hasRecords) {
    const filterBarEl = document.getElementById("filter-bar");
    const chipsEl = document.getElementById("filter-chips");
    Filters.init(filterBarEl, chipsEl, dashboard.dimensions, (filterState) => {
      // Per-section busy indicator: cheap at today's row counts (recompute
      // is well under 100ms) but keeps every section honest if the dataset
      // grows large enough for the recompute to become perceptible.
      markAllSectionsRecomputing(true);

      const t0 = CONFIG.debug ? performance.now() : 0;
      const result = Analytics.run(filterState);
      if (CONFIG.debug) console.log(`[Perf] Analytics.run(): ${(performance.now() - t0).toFixed(1)}ms for ${records.rows.length.toLocaleString()} records`);

      _lastFilterState = filterState;
      filenameSuffix = Exporter.filenameSuffixFromFilters(filterState);
      renderAll(result, dashboard.dimensions, filterState);
      // Cascading filters: disable options in every OTHER dropdown that
      // can't produce any rows given the filters just applied. Computed by
      // Analytics.run() in the same single pass as the aggregation itself.
      Filters.applyAvailability(result.availableOptions);
      markAllSectionsRecomputing(false);
    });
  } else {
    // View-only mode (no records.data.js): filters apply client-side to the
    // pre-computed arrays (teamComparison, leaderboards, managerRanking,
    // quarterlyCustomerCoverage). KPI summary and trends stay as the full
    // June snapshot — they require raw records to recompute.
    const filterBarEl = document.getElementById("filter-bar");
    const chipsEl = document.getElementById("filter-chips");
    Filters.init(filterBarEl, chipsEl, dashboard.dimensions, (filterState) => {
      const hasFilters = Object.values(filterState).some(v => Array.isArray(v) && v.length > 0);
      const filtered = hasFilters
        ? applyViewOnlyFilters(dashboard, dashboard.dimensions, filterState)
        : dashboard;
      renderAll(filtered, dashboard.dimensions, filterState);
    });
    // Render the pre-computed June snapshot directly.
    renderAll(dashboard, dashboard.dimensions, {});
  }

  // Sidebar toggle collapse
  const sidebarNav = document.getElementById("sidebar-nav");
  const toggleBtn = document.getElementById("sidebar-toggle");
  if (toggleBtn && sidebarNav) {
    toggleBtn.addEventListener("click", () => {
      sidebarNav.classList.toggle("collapsed");
    });
  }

  // Helper to dynamically update the topbar title
  function updateTopbarTitle(tab) {
    const titleEl = document.getElementById("topbar-title");
    if (!titleEl) return;
    if (tab === "coverage") {
      titleEl.textContent = "Zeta Commercial Excellence Dashboard - Operational and Execution";
    } else if (tab === "sfe") {
      titleEl.textContent = "Zeta Commercial Excellence Dashboard - Zeta Organogram";
    } else if (tab === "iqvia") {
      titleEl.textContent = "Zeta Commercial Excellence Dashboard - IQVIA Market Share";
    } else {
      titleEl.textContent = "Zeta Commercial Excellence Dashboard";
    }
  }

  // Initialize title
  updateTopbarTitle(currentTab);

  // Sidebar tab switching
  const menuItems = document.querySelectorAll("#sidebar-nav .menu-item");
  menuItems.forEach(item => {
    item.addEventListener("click", (e) => {
      const clickedItem = e.target.closest(".menu-item");
      if (!clickedItem || clickedItem.classList.contains("active")) return;
      
      menuItems.forEach(mi => mi.classList.remove("active"));
      clickedItem.classList.add("active");
      
      const tab = clickedItem.dataset.tab;
      if (currentTab === "iqvia" && window.IQVIADashboard) {
        window.IQVIADashboard.destroy();
      }
      currentTab = tab;
      updateTopbarTitle(tab);
      
      if (tab === "coverage") {
        if (window.SFEDashboard) {
          window.SFEDashboard.destroy();
        }
        // Fix rendering bug: destroy old Chart.js instances and clear registry
        Charts.destroyAll();
        buildLayout();
        if (hasRecords) {
          const result = Analytics.run(_lastFilterState || {});
          renderAll(result, dashboard.dimensions, _lastFilterState || {});
        } else {
          renderAll(dashboard, dashboard.dimensions, {});
        }
      } else if (tab === "sfe") {
        if (window.SFEDashboard) {
          window.SFEDashboard.init("app-root");
        }
      } else if (tab === "iqvia") {
        if (window.SFEDashboard) {
          window.SFEDashboard.destroy();
        }
        if (window.IQVIADashboard) {
          window.IQVIADashboard.init("app-root");
        }
      }
    });
  });

  Loader.hide();
  wireNotSeenModal();
});

/** Wire the topbar "Export Dashboard as PDF" button once at boot. */
function wireDashboardExport() {
  const btn = document.getElementById("topbar-export-pdf");
  if (btn) btn.addEventListener("click", () => Exporter.dashboardToPdf());
}

/** Wire every chart card's "PNG" button once, via a single delegated
 * listener on #app-root -- simpler than attaching a listener per card
 * and still correct since buildLayout() only runs once (chart cards
 * are never torn down/recreated on filter changes, only their data is). */
function wireChartExportDelegation() {
  const root = document.getElementById("app-root");
  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".chart-export-btn");
    if (!btn) return;
    const canvasId = btn.dataset.canvas;
    const label = btn.dataset.label || canvasId;
    Exporter.chartToPng(canvasId, `${Exporter.sanitize(label)}_${filenameSuffix}`);
  });
}

/** Toggle the "recomputing" busy state on every built section at once. */
function markAllSectionsRecomputing(isRecomputing) {
  document.querySelectorAll(".dashboard-section").forEach((el) => UI.markRecomputing(el, isRecomputing));
}

function renderMissingCacheNotice() {
  const root = document.getElementById("app-root");
  root.innerHTML = `
    <div class="container">
      <div class="card">
        <h2>No cached data found</h2>
        <p class="notice">
          This dashboard reads only from the <code>cache/</code> folder and never
          opens the workbook itself. Run <code>refresh.bat</code> next to this
          file to generate the cache, then reopen the dashboard.
        </p>
      </div>
    </div>`;
}

function renderTopBar(metadata, dashboard) {
  // Title is static in HTML; nothing dynamic needed in the topbar now.
  // (Workbook, Last Refresh, Latest Period, and health pill have been
  //  removed per design update — 2026-07-20.)
}

/** Standard chart-card markup: title + a small "PNG" export button, both
 * sharing one row so the export affordance never displaces the chart
 * itself. `extraClass` covers modifiers like "chart-card-small". */
function chartCardHtml(canvasId, title, extraClass = "", wrapClass = "chart-wrap") {
  return `
    <div class="chart-card ${extraClass}">
      <div class="chart-card-header">
        <h3>${title}</h3>
        <button type="button" class="chart-export-btn" data-canvas="${canvasId}" data-label="${title.replace(/<[^>]+>/g, "").replace(/&amp;/g, "and")}" title="Export chart as PNG">PNG</button>
      </div>
      <div class="${wrapClass}"><canvas id="${canvasId}"></canvas></div>
    </div>`;
}

/** Build every section container ONCE. Filter changes only touch each
 * section's inner content (kpi cards, chart data, table rows) -- the
 * page layout itself never gets torn down and rebuilt. */
function buildLayout() {
  const root = document.getElementById("app-root");
  root.innerHTML = "";
  sections = {};

  const execSection = document.createElement("section");
  execSection.className = "dashboard-section exec-summary-section";
  execSection.id = "sec-executive-summary";
  execSection.innerHTML = `
    <div class="section-header"><h2>Executive Co-Pilot &amp; Strategic Advisory</h2></div>
    <div class="section-body" id="executive-summary-body"></div>`;
  root.appendChild(execSection);
  sections.execSummary = execSection.querySelector("#executive-summary-body");

  sections.kpis = UI.buildSection(root, "sec-kpis", "Key Performance Indicators");

  const callEffSection = document.createElement("section");
  callEffSection.className = "dashboard-section";
  callEffSection.id = "sec-call-efficiency";
  callEffSection.innerHTML = `
    <div class="section-header"><h2>Call Execution &amp; Resource Efficiency</h2></div>
    <div class="section-body" id="call-efficiency-body"></div>`;
  root.appendChild(callEffSection);
  sections.callEfficiency = callEffSection.querySelector("#call-efficiency-body");

  const trendsSection = document.createElement("section");
  trendsSection.className = "dashboard-section";
  trendsSection.id = "sec-trends";
  trendsSection.innerHTML = `
    <div class="section-header"><h2>Trends &amp; Distributions</h2></div>
    <div class="section-body">
      <div style="margin-bottom: 24px;">
        ${chartCardHtml("chart-coverage-trend", "Coverage % &amp; Right Frequency % Trend", "", "chart-wrap chart-wrap-wide")}
      </div>
      <div class="distribution-grid">
        ${chartCardHtml("chart-type-distribution", "Customer Type Distribution", "chart-card-small")}
        ${chartCardHtml("chart-class-distribution", "Customer Class Distribution", "chart-card-small")}
        ${chartCardHtml("chart-specialty-distribution", "Customer Specialty Distribution", "chart-card-small")}
      </div>
      <div class="visits-contribution-grid" style="margin-top: 24px; border-top: 1px solid #E2E8F0; padding-top: 24px;">
        ${chartCardHtml("chart-class-visits-distribution", "Class Visits Contribution", "chart-card-small")}
        ${chartCardHtml("chart-specialty-visits-distribution", "Specialty Visits Contribution", "chart-card-small")}
      </div>
    </div>`;
  root.appendChild(trendsSection);

  const teamSection = document.createElement("section");
  teamSection.className = "dashboard-section";
  teamSection.id = "sec-team-comparison";
  teamSection.innerHTML = `
    <div class="section-header"><h2>Team Comparison (Latest Period)</h2></div>
    <div class="section-body">
      <div style="margin-bottom:16px;">${chartCardHtml("chart-team-coverage", "Coverage % by Team", "", "chart-wrap chart-wrap-wide")}</div>
      <div id="table-team-comparison"></div>
    </div>`;
  root.appendChild(teamSection);
  sections.teamTable = teamSection.querySelector("#table-team-comparison");

  const rfNarrSection = document.createElement("section");
  rfNarrSection.className = "dashboard-section";
  rfNarrSection.id = "sec-rf-intelligence";
  rfNarrSection.innerHTML = `
    <div class="section-header">
      <h2>Right Frequency Intelligence</h2>
      <span class="section-subtitle">Dynamic RF insights — all panels respond to active filters</span>
    </div>
    <div id="rf-narrative-body"></div>`;
  root.appendChild(rfNarrSection);
  sections.rfNarrative = rfNarrSection.querySelector("#rf-narrative-body");

  const rankingSection = document.createElement("section");
  rankingSection.className = "dashboard-section";
  rankingSection.id = "sec-rankings";
  rankingSection.innerHTML = `
    <div class="section-header"><h2>Manager &amp; Area Manager Ranking</h2></div>
    <div class="section-body two-col">
      <div><h3>Manager Ranking</h3><div id="table-manager-ranking"></div></div>
      <div><h3>Area Manager Ranking</h3><div id="table-area-manager-ranking"></div></div>
    </div>`;
  root.appendChild(rankingSection);
  sections.managerTable = rankingSection.querySelector("#table-manager-ranking");
  sections.areaManagerTable = rankingSection.querySelector("#table-area-manager-ranking");

  const kolSection = document.createElement("section");
  kolSection.className = "dashboard-section";
  kolSection.id = "sec-kol-coverage";
  kolSection.innerHTML = `
    <div class="section-header"><h2>Quarterly Customer Coverage by Employee</h2></div>
    <div class="kol-legend">
      <span class="kol-rag kol-green">100%</span>
      <span class="kol-rag kol-amber">&ge;80%</span>
      <span class="kol-rag kol-red">&lt;80%</span>
      <span class="kol-legend-note">Coverage = visited at least once within the quarter &nbsp;|&nbsp; Q1: Feb–Mar &nbsp;|&nbsp; Q2: Apr–Jun &nbsp;|&nbsp; Period filter ignored &nbsp;|&nbsp; Hierarchy filter shows self + full team</span>
    </div>
    <div id="table-kol-coverage"></div>`;
  root.appendChild(kolSection);
  sections.kolTable = kolSection.querySelector("#table-kol-coverage");

  const specClassSection = document.createElement("section");
  specClassSection.className = "dashboard-section";
  specClassSection.id = "sec-specialty-class";
  specClassSection.innerHTML = `
    <div class="section-header"><h2>Coverage by Specialty &amp; Class</h2></div>
    <div class="section-body chart-grid">
      ${chartCardHtml("chart-specialty", "Coverage % by Specialty (Top 15)")}
      ${chartCardHtml("chart-class", "Coverage % by Class (Top 15)")}
    </div>`;
  root.appendChild(specClassSection);

  const leaderboardSection = document.createElement("section");
  leaderboardSection.className = "dashboard-section";
  leaderboardSection.id = "sec-leaderboards";
  leaderboardSection.innerHTML = `
    <div class="section-header"><h2>Leaderboards (Latest Period, &ge; 5 customers)</h2></div>
    <div class="section-body two-col">
      <div><h3>Top Employees</h3><div id="table-leaderboard-top"></div></div>
      <div><h3>Bottom Employees</h3><div id="table-leaderboard-bottom"></div></div>
    </div>`;
  root.appendChild(leaderboardSection);
  sections.leaderboardTop = leaderboardSection.querySelector("#table-leaderboard-top");
  sections.leaderboardBottom = leaderboardSection.querySelector("#table-leaderboard-bottom");

  const attritionSection = document.createElement("section");
  attritionSection.className = "dashboard-section";
  attritionSection.id = "sec-attrition-vacancy";
  attritionSection.innerHTML = `
    <div class="section-header"><h2>Attrition &amp; Vacancy</h2></div>
    <div class="section-body two-col">
      <div>
        <h3>Attrition by Team</h3>
        <div id="table-attrition"></div>
      </div>
      <div>
        <h3>Vacancy Panel</h3>
        <div id="panel-vacancy"></div>
      </div>
    </div>`;
  root.appendChild(attritionSection);
  sections.attritionTable = attritionSection.querySelector("#table-attrition");
  sections.vacancyPanel = attritionSection.querySelector("#panel-vacancy");
}

/**
 * View-only mode: filter pre-computed cache arrays by the active filter state.
 * Sections that need raw records (KPIs, trends, rfInsights, specialty/class)
 * stay as the full-period snapshot. Tables with hierarchy fields are filtered.
 */
function applyViewOnlyFilters(dashboard, dims, filterState) {
  const result = Object.assign({}, dashboard);

  // filterState values are name strings (not indices) — use them directly
  const act = {};
  const filterKeys = ["team", "businessUnit", "nsm", "areaManager", "manager", "employee"];
  for (const key of filterKeys) {
    const vals = filterState[key];
    if (vals && vals.length) act[key] = new Set(vals);
  }

  // ── Resolve active teams from hierarchy filters ───────────────────────────
  // BU / NSM / AM selections expand to the set of teams they contain.
  // Hierarchy maps come from window.DASHBOARD_TEAM_KPIS (the small sidecar
  // file loaded in view-only mode) or from dashboard itself if pre-embedded.
  const tkData = window.DASHBOARD_TEAM_KPIS || dashboard;
  let activeTeams = null; // null = no team-level restriction
  if (act.team || act.businessUnit || act.nsm || act.areaManager) {
    activeTeams = new Set();
    if (act.team) act.team.forEach(t => activeTeams.add(t));
    if (act.businessUnit && tkData.buToTeams) {
      act.businessUnit.forEach(bu => (tkData.buToTeams[bu] || []).forEach(t => activeTeams.add(t)));
    }
    if (act.nsm && tkData.nsmToTeams) {
      act.nsm.forEach(nsm => (tkData.nsmToTeams[nsm] || []).forEach(t => activeTeams.add(t)));
    }
    if (act.areaManager && tkData.amToTeams) {
      act.areaManager.forEach(am => (tkData.amToTeams[am] || []).forEach(t => activeTeams.add(t)));
    }
  }

  // ── KPI cards — aggregate teamKpis for the resolved team set ─────────────
  if (activeTeams && tkData.teamKpis) {
    const agg = { totalRows:0, covCount:0, rfCount:0, notSeen:0,
                  tgtVis:0, actVis:0, reps:0, resigned:0, custs:0 };
    for (const team of activeTeams) {
      const tk = tkData.teamKpis[team];
      if (!tk) continue;
      agg.totalRows += tk._totalRows         || 0;
      agg.covCount  += tk._covCount          || 0;
      agg.rfCount   += tk._rfCount           || 0;
      agg.notSeen   += tk._notSeenCount      || 0;
      agg.tgtVis    += tk.totalTargetVisits  || 0;
      agg.actVis    += tk.totalActualVisits  || 0;
      agg.reps      += tk.activeEmployees    || 0;
      agg.resigned  += tk.resignedEmployees  || 0;
      agg.custs     += tk.totalUniqueCustomers || 0;
    }
    const tot = agg.totalRows || 1;
    result.kpis = Object.assign({}, dashboard.kpis, {
      coveragePct:          agg.covCount / tot,
      rightFreqPct:         agg.rfCount  / tot,
      activeReps:           agg.reps,
      resignedReps:         agg.resigned,
      totalUniqueCustomers: agg.custs,
      totalSharedCustomers: agg.totalRows,
      customersPerRep:      agg.reps > 0 ? agg.custs / agg.reps : 0,
      totalTargetVisits:    agg.tgtVis,
      totalActualVisits:    agg.actVis,
      visitAchievementPct:  agg.tgtVis ? agg.actVis / agg.tgtVis : null,
      notSeenCount:         agg.notSeen,
      notSeenPct:           agg.notSeen / tot,
    });
    // Suppress deltas — filtered KPIs have no meaningful prior-period comparison
    result.kpiDeltas = {};
  }

  // ── teamComparison — keyed on .team ──────────────────────────────────────
  if (activeTeams) {
    result.teamComparison = dashboard.teamComparison.filter(r => activeTeams.has(r.team));
  }

  // ── managerRanking — filter by direct manager selection OR by team ────────
  if (act.manager) {
    result.managerRanking = dashboard.managerRanking.filter(r => act.manager.has(r.name));
  } else if (activeTeams && tkData.managerToTeam) {
    result.managerRanking = dashboard.managerRanking.filter(r =>
      activeTeams.has(tkData.managerToTeam[r.name])
    );
  }

  // ── areaManagerRanking — filter by direct AM selection OR by team ─────────
  if (act.areaManager) {
    result.areaManagerRanking = dashboard.areaManagerRanking.filter(r => act.areaManager.has(r.name));
  } else if (activeTeams && tkData.amToTeams) {
    result.areaManagerRanking = dashboard.areaManagerRanking.filter(r => {
      const amTeams = tkData.amToTeams[r.name] || [];
      return amTeams.some(t => activeTeams.has(t));
    });
  }

  // ── leaderboards — have .team, .manager, .employee ───────────────────────
  if (activeTeams || act.manager || act.employee) {
    const lbOk = r => (!activeTeams || activeTeams.has(r.team))
                   && (!act.manager  || act.manager.has(r.manager))
                   && (!act.employee || act.employee.has(r.employee));
    result.leaderboards = {
      top:    dashboard.leaderboards.top.filter(lbOk),
      bottom: dashboard.leaderboards.bottom.filter(lbOk),
    };
  }

  // ── quarterlyCustomerCoverage — has .team and .name (employee name) ───────
  if (activeTeams || act.employee) {
    result.quarterlyCustomerCoverage = dashboard.quarterlyCustomerCoverage.filter(r =>
      (!activeTeams  || activeTeams.has(r.team)) &&
      (!act.employee || act.employee.has(r.name))
    );
  }

  return result;
}

/** Re-render every section from a fresh Analytics.run() result. Called on
 * initial load and on every filter change. */
function renderAll(result, dims, filterState) {
  if (currentTab === "sfe") return;
  _lastResult = result;
  renderExecutiveSummary(result, filterState);
  UI.renderKpiCards(sections.kpis, result.kpis, result.kpiDeltas, result.trend.series);
  renderCallEfficiency(result);

  renderTrendCharts(result);
  renderTeamComparison(result);
  renderRFNarrative(result);
  renderRankingTables(result);
  renderKolCoverage(filterState, result.quarterlyCustomerCoverage);
  renderSpecialtyClassCharts(result);
  renderLeaderboards(result);
  renderAttritionVacancyQuality(result, dims);
}

function renderExecutiveSummary(result, filterState) {
  const el = sections.execSummary;
  if (!el) return;

  const kpis = result.kpis;
  const deltas = result.kpiDeltas;
  const rf = result.rfInsights;
  if (!kpis || !rf) { el.innerHTML = ""; return; }

  // --- 1. Resolve Active Scope Name ---
  let scopeName = "overall CHC organization";
  if (filterState.employee && filterState.employee.length > 0) {
    scopeName = `representative <strong>${filterState.employee.join(", ")}</strong>`;
  } else if (filterState.manager && filterState.manager.length > 0) {
    scopeName = `team under Manager <strong>${filterState.manager.join(", ")}</strong>`;
  } else if (filterState.team && filterState.team.length > 0) {
    scopeName = `<strong>${filterState.team.join(", ")}</strong> Team`;
  } else if (filterState.businessUnit && filterState.businessUnit.length > 0) {
    scopeName = `<strong>${filterState.businessUnit.join(", ")}</strong> Business Unit`;
  }

  // --- 2. KPI Metrics & Formatting ---
  const fmtPct = v => v == null ? "–" : (v * 100).toFixed(1) + "%";
  const fmtDelta = v => {
    if (v == null) return "flat";
    const val = v * 100;
    return val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`;
  };
  const fmtN = v => v == null ? "–" : v.toLocaleString();

  const rfPct = kpis.rightFreqPct;
  const covPct = kpis.coveragePct;
  const achPct = kpis.visitAchievementPct;
  const atRiskPct = rf.totalCustomers > 0 ? (rf.atRiskCount / rf.totalCustomers) : 0;
  
  const rfDeltaStr = fmtDelta(deltas.rightFreqPctDelta);
  const rfDirection = (deltas.rightFreqPctDelta || 0) > 0.005 ? "improving" : (deltas.rightFreqPctDelta || 0) < -0.005 ? "declining" : "stable";

  // --- 3. Identify Strengths & Opportunities (Drivers) ---
  let topSegmentDesc = "";
  if (rf.rfByClass && rf.rfByClass.length > 0) {
    const topClass = rf.rfByClass[0];
    topSegmentDesc = `Class ${topClass.name} (tracking at ${fmtPct(topClass.rightFreqPct)} RF)`;
  }
  if (rf.rfBySpecialty && rf.rfBySpecialty.length > 0) {
    const topSpec = rf.rfBySpecialty[0];
    if (topSegmentDesc) topSegmentDesc += ` and `;
    topSegmentDesc += `Specialty ${topSpec.name} (${fmtPct(topSpec.rightFreqPct)} RF)`;
  }
  if (!topSegmentDesc) topSegmentDesc = "general call coverage";

  // --- 4. Identify Risks & Leakage ---
  let riskDesc = "";
  if (rf.atRiskCount > 0) {
    riskDesc = `<strong>${fmtN(rf.atRiskCount)} at-risk doctors</strong> (${fmtPct(atRiskPct)} of scope) receiving zero right-frequency visits`;
  }
  let bottomSegmentDesc = "";
  if (rf.rfByClass && rf.rfByClass.length > 0) {
    const bottomClass = rf.rfByClass[rf.rfByClass.length - 1];
    bottomSegmentDesc = `Class ${bottomClass.name} (lagging at ${fmtPct(bottomClass.rightFreqPct)} RF)`;
  }
  if (rf.rfBySpecialty && rf.rfBySpecialty.length > 0) {
    const bottomSpec = rf.rfBySpecialty[rf.rfBySpecialty.length - 1];
    if (bottomSegmentDesc) bottomSegmentDesc += ` and `;
    bottomSegmentDesc += `Specialty ${bottomSpec.name} (${fmtPct(bottomSpec.rightFreqPct)} RF)`;
  }
  if (!bottomSegmentDesc) bottomSegmentDesc = "minor segments";

  // Call Efficiency numbers
  const onTarget = kpis.onTargetCalls || 0;
  const wasted   = kpis.wastedCalls || 0;
  const missed   = kpis.missedCalls || 0;
  const totalCalls = onTarget + wasted + missed;
  const wastedPctStr = totalCalls > 0 ? ((wasted / totalCalls) * 100).toFixed(1) + "%" : "0%";
  const missedPctStr = totalCalls > 0 ? ((missed / totalCalls) * 100).toFixed(1) + "%" : "0%";

  // --- 5. Action Items ---
  const bottomReps = rf.rfBottom10 ? rf.rfBottom10.slice(0, 3).map(r => r.name).join(", ") : "";

  // --- 6. Formulate Executive Paragraph ---
  let summaryText = "";
  const periodName = kpis.latestMonth || "June";

  if (rfPct >= 0.80) {
    summaryText = `For the period ending **${periodName}**, ${scopeName} delivered **exceptional commercial performance** with a Right Frequency (RF) score of **${fmtPct(rfPct)}** (an ${rfDirection} trend of **${rfDeltaStr}**). This success is backed by highly optimized execution in **${topSegmentDesc}**. While overall health is excellent, management should monitor minor leakage in **${bottomSegmentDesc}** and re-allocate the **${fmtN(wasted)} wasted visits** (${wastedPctStr} of call capacity) to cover the remaining **${fmtN(rf.atRiskCount)} zero-visit doctors** to lock in 100% compliance.`;
  } else if (rfPct >= 0.60) {
    summaryText = `For the period ending **${periodName}**, ${scopeName} is tracking in the **watch zone** with a Right Frequency (RF) score of **${fmtPct(rfPct)}** (${rfDirection} at **${rfDeltaStr}**). Strong performance in **${topSegmentDesc}** is currently offsetting execution gaps in **${bottomSegmentDesc}**. The primary bottleneck is call dilution: **${wastedPctStr}** of actual calls (**${fmtN(wasted)} visits**) were wasted on over-servicing, while **${fmtN(rf.atRiskCount)} critical doctors** received zero frequency achievement. Immediate reallocation of this capacity is recommended to rescue these at-risk accounts.`;
  } else {
    summaryText = `For the period ending **${periodName}**, ${scopeName} displays a **critical frequency deficit**, tracking at a Right Frequency (RF) score of **${fmtPct(rfPct)}** (a ${rfDirection} trend of **${rfDeltaStr}**). Although visit coverage stands at ${fmtPct(covPct)}, poor call plan compliance has resulted in **${fmtN(missed)} missed visits** (${missedPctStr} of total planned effort) and **${fmtN(rf.atRiskCount)} doctors** receiving zero visits. Management must intervene to enforce call-cadence compliance, particularly in **${bottomSegmentDesc}**, and redirect the **${fmtN(wasted)} wasted over-target visits** to high-priority accounts.`;
  }

  // --- 7. Assemble HTML ---
  el.innerHTML = `
    <div class="exec-summary-card">
      <div class="exec-summary-paragraph">
        ${summaryText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}
      </div>
      <div class="exec-grid-cards">
        <div class="exec-kpi-card diagnostic">
          <div class="exec-card-title">🔍 Performance Diagnosis</div>
          <div class="exec-card-body">
            <ul>
              <li>Right Frequency is at <strong>${fmtPct(rfPct)}</strong> (trend: <strong>${rfDeltaStr}</strong>).</li>
              <li>Overall Call Coverage is <strong>${fmtPct(covPct)}</strong> against <strong>${fmtN(rf.totalCustomers)}</strong> shared customer accounts.</li>
              <li>Visit Achievement reached <strong>${fmtPct(achPct)}</strong>, executing <strong>${fmtN(kpis.totalActualVisits)}</strong> out of <strong>${fmtN(kpis.totalTargetVisits)}</strong> planned visits.</li>
            </ul>
          </div>
        </div>
        <div class="exec-kpi-card driver">
          <div class="exec-card-title">📈 Productivity Drivers</div>
          <div class="exec-card-body">
            <ul>
              <li>Top performing segment is <strong>${topSegmentDesc}</strong>.</li>
              <li>On-Target efficiency: <strong>${((onTarget / (totalCalls || 1)) * 100).toFixed(1)}%</strong> of executed calls directly contributed to meeting planned frequency targets.</li>
            </ul>
          </div>
        </div>
        <div class="exec-kpi-card leakage">
          <div class="exec-card-title">⚠️ Leakage &amp; Risks</div>
          <div class="exec-card-body">
            <ul>
              <li><strong>${riskDesc || "No significant customer leakage"}</strong>.</li>
              <li>Bottom performing segment is <strong>${bottomSegmentDesc}</strong>.</li>
              <li>Call Dilution: <strong>${wastedPctStr}</strong> of field efforts (${fmtN(wasted)} visits) were wasted on over-servicing.</li>
            </ul>
          </div>
        </div>
        <div class="exec-kpi-card action">
          <div class="exec-card-title">💡 Strategic Executive Actions</div>
          <div class="exec-card-body">
            <ul>
              <li><strong>Redirect</strong> ${fmtN(wasted)} wasted over-target calls to cover the ${fmtN(rf.atRiskCount)} zero-visit doctors.</li>
              ${bottomReps ? `<li><strong>Audit</strong> call planning and target compliance for bottom reps: <em>${bottomReps}</em>.</li>` : ""}
              <li><strong>Enforce</strong> strict call planning in weekly line-manager reviews to curb call dilution.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>`;
}

function renderCallEfficiency(result) {
  const el = sections.callEfficiency;
  if (!el) return;

  const onTarget = result.kpis.onTargetCalls || 0;
  const wasted   = result.kpis.wastedCalls || 0;
  const missed   = result.kpis.missedCalls || 0;
  const totalPool = onTarget + wasted + missed;
  const onTargetPct = totalPool > 0 ? Math.round((onTarget / totalPool) * 100) : 0;
  const wastedPct   = totalPool > 0 ? Math.round((wasted / totalPool) * 100) : 0;
  const missedPct   = totalPool > 0 ? (100 - onTargetPct - wastedPct) : 0;

  const fmtN = v => v == null ? "–" : v.toLocaleString();

  el.innerHTML = `
    <div class="call-eff-bar-wrap">
      <div class="call-eff-bar-fill on-target" style="width: ${onTargetPct}%;" title="On-Target: ${onTargetPct}%"></div>
      <div class="call-eff-bar-fill wasted" style="width: ${wastedPct}%;" title="Wasted: ${wastedPct}%"></div>
      <div class="call-eff-bar-fill missed" style="width: ${missedPct}%;" title="Missed: ${missedPct}%"></div>
    </div>
    <div class="call-eff-legend-row">
      <div class="call-eff-legend-item on-target">
        <div class="legend-color-dot on-target"></div>
        <div class="legend-text">
          <span class="legend-title">On-Target Visits</span>
          <span class="legend-desc"><strong>${fmtN(onTarget)}</strong> (${onTargetPct}%) visits within target</span>
        </div>
      </div>
      <div class="call-eff-legend-item wasted">
        <div class="legend-color-dot wasted"></div>
        <div class="legend-text">
          <span class="legend-title">Wasted Visits (Over-target)</span>
          <span class="legend-desc"><strong>${fmtN(wasted)}</strong> (${wastedPct}%) visits above target</span>
        </div>
      </div>
      <div class="call-eff-legend-item missed">
        <div class="legend-color-dot missed"></div>
        <div class="legend-text">
          <span class="legend-title">Missed Visits (Planned)</span>
          <span class="legend-desc"><strong>${fmtN(missed)}</strong> (${missedPct}%) planned visits missed</span>
        </div>
      </div>
    </div>`;
}

function renderTrendCharts(result) {
  const labels = result.trend.periods;
  Charts.lineChart("chart-coverage-trend", labels, [
    Charts.percentSeries("Coverage %", result.trend.series.map((s) => s.coveragePct * 100), CONFIG.theme.colors.primary),
    Charts.percentSeries("Right Frequency %", result.trend.series.map((s) => s.rightFreqPct * 100), CONFIG.theme.colors.success),
  ]);

  // Customer Type Distribution doughnut
  const typeData = result.typeDistribution || [];
  if (typeData.length) {
    const typeTotal = typeData.reduce((s, r) => s + r.count, 0);
    const typeLabels = typeData.map((r) => {
      const pct = typeTotal > 0 ? ((r.count / typeTotal) * 100).toFixed(1) : "0.0";
      return `${r.name || "(Blank)"} (${pct}%)`;
    });
    const typeValues = typeData.map((r) => (typeTotal > 0 ? Math.round((r.count / typeTotal) * 1000) / 10 : 0));
    Charts.doughnutChart("chart-type-distribution", typeLabels, typeValues, {
      plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.toFixed(1)}%` } } },
    });
  } else {
    const canvas = document.getElementById("chart-type-distribution");
    if (canvas && canvas.parentElement) canvas.parentElement.innerHTML = UI.emptyState("No type data for the current filters.");
  }

  // Customer Class Distribution doughnut
  const classData = result.classDistribution || [];
  if (classData.length) {
    const classTotal = classData.reduce((s, r) => s + r.count, 0);
    const classLabels = classData.map((r) => {
      const pct = classTotal > 0 ? ((r.count / classTotal) * 100).toFixed(1) : "0.0";
      return `${r.name || "(Blank)"} (${pct}%)`;
    });
    const classValues = classData.map((r) => (classTotal > 0 ? Math.round((r.count / classTotal) * 1000) / 10 : 0));
    Charts.doughnutChart("chart-class-distribution", classLabels, classValues, {
      plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.toFixed(1)}%` } } },
    });
  } else {
    const canvas = document.getElementById("chart-class-distribution");
    if (canvas && canvas.parentElement) canvas.parentElement.innerHTML = UI.emptyState("No class data.");
  }

  // Customer Specialty Distribution doughnut
  const specialtyData = result.specialtyDistribution || [];
  if (specialtyData.length) {
    let displayData = specialtyData;
    if (specialtyData.length > 6) {
      const top6 = specialtyData.slice(0, 6);
      const otherCount = specialtyData.slice(6).reduce((s, r) => s + r.count, 0);
      displayData = [...top6, { name: "Other", count: otherCount }];
    }
    const specTotal = displayData.reduce((s, r) => s + r.count, 0);
    const specLabels = displayData.map((r) => {
      const pct = specTotal > 0 ? ((r.count / specTotal) * 100).toFixed(1) : "0.0";
      return `${r.name || "(Blank)"} (${pct}%)`;
    });
    const specValues = displayData.map((r) => (specTotal > 0 ? Math.round((r.count / specTotal) * 1000) / 10 : 0));
    Charts.doughnutChart("chart-specialty-distribution", specLabels, specValues, {
      plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.toFixed(1)}%` } } },
    });
  } else {
    const canvas = document.getElementById("chart-specialty-distribution");
    if (canvas && canvas.parentElement) canvas.parentElement.innerHTML = UI.emptyState("No specialty data.");
  }

  // Class Visits Contribution horizontal bar chart
  const classVisitsData = result.classVisitsDistribution || [];
  if (classVisitsData.length) {
    const classVisitsTotal = classVisitsData.reduce((s, r) => s + r.count, 0);
    const labels = classVisitsData.map(r => r.name || "(Blank)");
    const values = classVisitsData.map(r => classVisitsTotal > 0 ? Math.round((r.count / classVisitsTotal) * 1000) / 10 : 0);
    
    Charts.horizontalBarChart(
      "chart-class-visits-distribution",
      labels,
      [Charts.coloredBarDataset("Visits %", labels, values)],
      {
        plugins: { legend: { display: false } }
      }
    );
  } else {
    const canvas = document.getElementById("chart-class-visits-distribution");
    if (canvas && canvas.parentElement) canvas.parentElement.innerHTML = UI.emptyState("No class visits data.");
  }

  // Specialty Visits Contribution horizontal bar chart
  const specialtyVisitsData = result.specialtyVisitsDistribution || [];
  if (specialtyVisitsData.length) {
    let displayVisitsData = specialtyVisitsData;
    if (specialtyVisitsData.length > 8) {
      const top8 = specialtyVisitsData.slice(0, 8);
      const otherVisitsCount = specialtyVisitsData.slice(8).reduce((s, r) => s + r.count, 0);
      displayVisitsData = [...top8, { name: "Other", count: otherVisitsCount }];
    }
    const specVisitsTotal = displayVisitsData.reduce((s, r) => s + r.count, 0);
    const labels = displayVisitsData.map(r => r.name || "(Blank)");
    const values = displayVisitsData.map(r => specVisitsTotal > 0 ? Math.round((r.count / specVisitsTotal) * 1000) / 10 : 0);

    Charts.horizontalBarChart(
      "chart-specialty-visits-distribution",
      labels,
      [Charts.coloredBarDataset("Visits %", labels, values)],
      {
        plugins: { legend: { display: false } }
      }
    );
  } else {
    const canvas = document.getElementById("chart-specialty-visits-distribution");
    if (canvas && canvas.parentElement) canvas.parentElement.innerHTML = UI.emptyState("No specialty visits data.");
  }
}

// ── RF Narrative Intelligence ────────────────────────────────────────────────
function renderRFNarrative(result) {
  const el = sections.rfNarrative;
  if (!el) return;
  const rf = result.rfInsights;
  if (!rf) { el.innerHTML = ""; return; }

  // ── helpers ──
  const fmt  = v => v == null ? "–" : (v * 100).toFixed(1) + "%";
  const fmtN = v => v == null ? "–" : v.toLocaleString();

  function severity(v) {
    if (v == null) return "watch";
    if (v >= 0.80) return "win";
    if (v >= 0.60) return "watch";
    return "alert";
  }

  function sevLabel(v) {
    const s = severity(v);
    return s === "win" ? "WIN" : s === "watch" ? "WATCH" : "ALERT";
  }

  // ── 1. Headline strip ──
  const overallSev = severity(rf.overallRfPct);
  const atRiskPct  = rf.totalCustomers > 0 ? rf.atRiskCount / rf.totalCustomers : 0;

  let headlineLine = "";
  if (overallSev === "win") {
    headlineLine = `Right Frequency is tracking well at <strong>${fmt(rf.overallRfPct)}</strong>. Sustain the cadence and focus on the bottom performers to push coverage higher.`;
  } else if (overallSev === "watch") {
    headlineLine = `Right Frequency is at <strong>${fmt(rf.overallRfPct)}</strong> — in the WATCH zone. Targeted coaching on class mix and visit planning could unlock a step change.`;
  } else {
    headlineLine = `Right Frequency is <strong>${fmt(rf.overallRfPct)}</strong> — a critical gap. Immediate action is needed on visit planning, doctor prioritisation, and manager accountability.`;
  }

  // ── 2. By-class bars ──
  const maxClassRf = rf.rfByClass.length ? (rf.rfByClass[0].rightFreqPct || 0) : 1;
  const classBars = rf.rfByClass.map(c => {
    const pctVal = c.rightFreqPct || 0;
    const barW   = maxClassRf > 0 ? Math.round((pctVal / maxClassRf) * 100) : 0;
    const sev    = severity(c.rightFreqPct);
    return `<div class="rf-bar-row">
      <span class="rf-bar-label">${c.name || "—"}</span>
      <div class="rf-bar-track">
        <div class="rf-bar-fill rf-sev-${sev}" style="width:${barW}%"></div>
      </div>
      <span class="rf-bar-value rf-sev-${sev}-text">${fmt(c.rightFreqPct)}</span>
      <span class="rf-bar-count">(${fmtN(c.customerCount)} drs)</span>
    </div>`;
  }).join("");

  // ── 3. By-specialty pills ──
  const specPills = rf.rfBySpecialty.map(s => {
    const sev = severity(s.rightFreqPct);
    return `<span class="rf-pill rf-sev-${sev}" title="${fmtN(s.customerCount)} doctors">
      ${s.name || "—"} <strong>${fmt(s.rightFreqPct)}</strong>
    </span>`;
  }).join("");

  // ── 4. Top / bottom 5 employees ──
  function empRow(e, rank) {
    const sev = severity(e.rfPct);
    return `<tr>
      <td class="rf-rank">${rank}</td>
      <td>${e.name}</td>
      <td>${e.team}</td>
      <td class="rf-sev-${sev}-text fw-bold">${fmt(e.rfPct)}</td>
      <td class="rf-muted">${fmtN(e.customerCount)} drs</td>
    </tr>`;
  }
  const topRows    = rf.rfTop10 ? rf.rfTop10.map((e, i) => empRow(e, i + 1)).join("") : "";
  const bottomRows = rf.rfBottom10 ? rf.rfBottom10.map((e, i) => empRow(e, rf.rfBottom10.length - i)).join("") : "";

  const empTableHtml = (title, rows) => `
    <div class="rf-emp-block">
      <div class="rf-block-title">${title}</div>
      <table class="rf-emp-table">
        <thead><tr><th>#</th><th>Employee</th><th>Team</th><th>RF%</th><th>Scope</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="rf-muted">No data</td></tr>'}</tbody>
      </table>
    </div>`;

  // ── 5. Probation vs Non-Probation split ──
  const expBlocks = rf.rfByExperience.map(e => {
    const sev = severity(e.rfPct);
    let advice = "";
    if (e.experience === "Probation") {
      advice = e.rfPct < 0.60
        ? "Probationers are struggling with visit cadence. Consider intensive onboarding coaching."
        : e.rfPct < 0.80
        ? "Probationers are developing well. Pair lowest performers with top-quartile reps."
        : "Probationers are performing above expectations. Retain and recognize.";
    } else {
      advice = e.rfPct < 0.60
        ? "Seasoned reps falling short signals a systemic issue — check territory load and doctor frequency targets."
        : e.rfPct < 0.80
        ? "Experienced reps have room to improve. Review call plan compliance and territory management."
        : "Non-probationers are setting the standard. Leverage them as internal coaches.";
    }
    return `<div class="rf-exp-card rf-sev-${sev}-border">
      <div class="rf-exp-label">${e.experience}</div>
      <div class="rf-exp-pct rf-sev-${sev}-text">${fmt(e.rfPct)}</div>
      <div class="rf-exp-meta">${fmtN(e.empCount)} reps &nbsp;·&nbsp; ${fmtN(e.rowCount)} rows</div>
      <div class="rf-exp-advice">${advice}</div>
    </div>`;
  }).join("");

  // ── 6. At-risk customers ──
  const atRiskSev = atRiskPct >= 0.20 ? "alert" : atRiskPct >= 0.10 ? "watch" : "win";
  const atRiskMsg = atRiskPct >= 0.20
    ? `<strong>${fmtN(rf.atRiskCount)}</strong> doctors (<strong>${fmt(atRiskPct)}</strong> of your active base) received <em>zero</em> right-frequency visits — a critical leakage point.`
    : atRiskPct >= 0.10
    ? `<strong>${fmtN(rf.atRiskCount)}</strong> doctors (${fmt(atRiskPct)}) have not received a right-frequency visit yet. Address these before end of cycle.`
    : `Only <strong>${fmtN(rf.atRiskCount)}</strong> doctors (${fmt(atRiskPct)}) are without a right-frequency visit. Strong position — maintain it.`;

  // ── 7. Dynamic action plan ──
  const actions = [];

  // Low RF class actions
  const lowClasses = rf.rfByClass.filter(c => (c.rightFreqPct || 0) < 0.60);
  if (lowClasses.length) {
    actions.push(`🔴 <strong>Priority Class Rescue:</strong> Classes <em>${lowClasses.map(c => c.name).join(", ")}</em> are below 60% RF. Run targeted call-plan reviews for all reps covering these segments.`);
  }

  // Low RF specialty actions
  const lowSpec = rf.rfBySpecialty.filter(s => (s.rightFreqPct || 0) < 0.60);
  if (lowSpec.length) {
    actions.push(`🔴 <strong>Specialty Focus:</strong> <em>${lowSpec.map(s => s.name).join(", ")}</em> are below 60% RF. Ensure frequency targets are set correctly for these specialties.`);
  }

  // Bottom performers
  if (rf.rfBottom10 && rf.rfBottom10.length) {
    const names = rf.rfBottom10.slice(0, 5).map(e => e.name).join(", ");
    actions.push(`🟠 <strong>Coaching Targets:</strong> <em>${names}</em> (and others) are in the bottom 10 by RF%. Schedule 1-on-1 call-plan reviews with their managers.`);
  }

  // At-risk customers
  if (rf.atRiskCount > 0) {
    actions.push(`🟠 <strong>At-Risk Doctors:</strong> ${fmtN(rf.atRiskCount)} doctors have zero right-frequency visits. Identify them in the details sheet and assign recovery calls this cycle.`);
  }

  // Probation gap
  const prob = rf.rfByExperience.find(e => e.experience === "Probation");
  const nonProb = rf.rfByExperience.find(e => e.experience === "Non-Probation");
  if (prob && nonProb && nonProb.rfPct != null && prob.rfPct != null) {
    const gap = nonProb.rfPct - prob.rfPct;
    if (gap > 0.15) {
      actions.push(`🟡 <strong>Probationer Gap:</strong> Non-probationers exceed probationers by ${fmt(gap)} in RF%. Pair new reps with high performers and review onboarding call-plan guidance.`);
    }
  }

  // High performers — sustain
  if (rf.rfTop10 && rf.rfTop10.length && (rf.rfTop10[0].rfPct || 0) >= 0.80) {
    actions.push(`🟢 <strong>Sustain Excellence:</strong> <em>${rf.rfTop10[0].name}</em> (${fmt(rf.rfTop10[0].rfPct)}) leads the field. Capture and share their territory strategy as a best-practice model.`);
  }

  if (!actions.length) {
    actions.push("✅ <strong>All metrics within acceptable range.</strong> Continue monitoring at next period refresh.");
  }

  const actionHtml = actions.map(a => `<li class="rf-action-item">${a}</li>`).join("");

  // ── Assemble HTML ──
  el.innerHTML = `
    <div class="rf-headline rf-sev-${overallSev}-bg">
      <span class="rf-headline-badge rf-sev-${overallSev}-badge">${sevLabel(rf.overallRfPct)}</span>
      <span class="rf-headline-text">${headlineLine}</span>
    </div>

    <div class="rf-insight-grid">

      <div class="rf-panel rf-panel-full">
        <div class="rf-panel-title">RF% by Class</div>
        <div class="rf-bar-list">${classBars || '<span class="rf-muted">No class data in current filter</span>'}</div>
      </div>

      <div class="rf-panel rf-panel-full">
        <div class="rf-panel-title">RF% by Specialty</div>
        <div class="rf-pill-wrap">${specPills || '<span class="rf-muted">No specialty data in current filter</span>'}</div>
      </div>

      <div class="rf-panel rf-panel-half rf-panel-top-employees">
        ${empTableHtml("🏆 Top 10 Employees by RF%", topRows)}
      </div>

      <div class="rf-panel rf-panel-half rf-panel-bottom-employees">
        ${empTableHtml("⚠️ Bottom 10 Employees by RF%", bottomRows)}
      </div>

      <div class="rf-panel rf-panel-half rf-at-risk rf-sev-${atRiskSev}-border">
        <div class="rf-panel-title">At-Risk Doctors</div>
        <div class="rf-at-risk-stat rf-sev-${atRiskSev}-text">${fmtN(rf.atRiskCount)}<span class="rf-at-risk-denom"> / ${fmtN(rf.totalCustomers)}</span></div>
        <div class="rf-at-risk-msg">${atRiskMsg}</div>
        <div class="rf-at-risk-tiers">
          <div class="rf-at-risk-tier-item" data-tier="1">
            <span class="tier-label">Tier 1: Easy Win (1 missed call)</span>
            <span class="tier-value">${fmtN(rf.atRiskTiers ? rf.atRiskTiers.tier1.count : 0)} doctors</span>
          </div>
          <div class="rf-at-risk-tier-item" data-tier="2">
            <span class="tier-label">Tier 2: Moderate Gap (2 missed calls)</span>
            <span class="tier-value">${fmtN(rf.atRiskTiers ? rf.atRiskTiers.tier2.count : 0)} doctors</span>
          </div>
          <div class="rf-at-risk-tier-item" data-tier="3">
            <span class="tier-label">Tier 3: Major Gap (3+ missed calls)</span>
            <span class="tier-value">${fmtN(rf.atRiskTiers ? rf.atRiskTiers.tier3.count : 0)} doctors</span>
          </div>
        </div>
      </div>

      <div class="rf-panel rf-panel-half rf-panel-action-plan">
        <div class="rf-panel-title">📋 Action Plan</div>
        <ul class="rf-action-list">${actionHtml}</ul>
      </div>

    </div>`;
}
// ─────────────────────────────────────────────────────────────────────────────

function renderTeamComparison(result) {
  const teams = result.teamComparison;
  Charts.horizontalBarChart(
    "chart-team-coverage",
    teams.map((t) => t.team),
    [Charts.coloredBarDataset("Coverage %", teams.map((t) => t.team), teams.map((t) => t.coveragePct * 100))]
  );

  Tables.render(sections.teamTable, {
    id: "team-comparison",
    columns: [
      { key: "team", label: "Team" },
      { key: "headcount", label: "Headcount", format: "number", align: "right" },
      { key: "resignedCount", label: "Resigned", format: "number", align: "right" },
      { key: "attritionRate", label: "Attrition %", format: "percent1", align: "right" },
      { key: "coveragePct", label: "Coverage %", format: "percent1", align: "right", defaultSort: "desc" },
      { key: "rightFreqPct", label: "Right Freq %", format: "percent1", align: "right" },
      { key: "customersPerRep", label: "Customers/Rep", format: "decimal1", align: "right" },
    ],
    rows: teams,
    exportFileName: `team-comparison_${filenameSuffix}`,
    emptyMessage: "No teams match the current filters.",
  });
}

function renderRankingTables(result) {
  const rankingColumns = [
    { key: "name", label: "Name", width: "44%", render: (row) => UI.nameWithAvatar(row.name, row.profile) },
    { key: "status", label: "Status", width: "14%" },
    { key: "span", label: "Span", width: "10%", format: "number", align: "right" },
    { key: "coveragePct", label: "Coverage %", width: "16%", format: "percent1", align: "right", defaultSort: "desc" },
    { key: "rightFreqPct", label: "Right Freq %", width: "16%", format: "percent1", align: "right" },
  ];

  Tables.render(sections.managerTable, {
    id: "manager-ranking", columns: rankingColumns, rows: result.managerRanking,
    exportFileName: `manager-ranking_${filenameSuffix}`, emptyMessage: "No managers match the current filters.",
  });
  Tables.render(sections.areaManagerTable, {
    id: "area-manager-ranking", columns: rankingColumns, rows: result.areaManagerRanking,
    exportFileName: `area-manager-ranking_${filenameSuffix}`, emptyMessage: "No area managers match the current filters.",
  });
}

function renderSpecialtyClassCharts(result) {
  const spec = result.specialtyCoverage;
  const specLabels = spec.map((s) => s.name || "(Blank)");
  Charts.horizontalBarChart(
    "chart-specialty",
    specLabels,
    [Charts.coloredBarDataset("Coverage %", spec.map((s) => s.name), spec.map((s) => s.coveragePct * 100))]
  );

  const klass = result.classCoverage;
  const classLabels = klass.map((c) => c.name || "(Blank)");
  Charts.horizontalBarChart(
    "chart-class",
    classLabels,
    [Charts.coloredBarDataset("Coverage %", klass.map((c) => c.name), klass.map((c) => c.coveragePct * 100))]
  );
}

function renderLeaderboards(result) {
  const topColumns = [
    { key: "employee", label: "Employee", width: "30%", render: (row) => UI.nameWithAvatar(row.employee, row.profile) },
    { key: "team", label: "Team", width: "10%" },
    { key: "manager", label: "Manager", width: "28%", titleKey: "manager", render: (row) => UI.nameWithAvatar(row.manager) },
    { key: "customerCount", label: "Customers", width: "9%", format: "number", align: "right" },
    { key: "coveragePct", label: "Coverage %", width: "12%", format: "percent1", align: "right", defaultSort: "desc" },
    { key: "rightFreqPct", label: "Right Freq %", width: "11%", format: "percent1", align: "right" },
  ];
  const bottomColumns = [
    { key: "employee", label: "Employee", width: "30%", render: (row) => UI.nameWithAvatar(row.employee, row.profile) },
    { key: "team", label: "Team", width: "10%" },
    { key: "manager", label: "Manager", width: "28%", titleKey: "manager", render: (row) => UI.nameWithAvatar(row.manager) },
    { key: "customerCount", label: "Customers", width: "9%", format: "number", align: "right" },
    { key: "coveragePct", label: "Coverage %", width: "12%", format: "percent1", align: "right", defaultSort: "asc" },
    { key: "rightFreqPct", label: "Right Freq %", width: "11%", format: "percent1", align: "right" },
  ];

  Tables.render(sections.leaderboardTop, {
    id: "leaderboard-top", columns: topColumns, rows: result.leaderboards.top,
    pageSize: 10, exportFileName: `leaderboard-top-employees_${filenameSuffix}`,
    emptyMessage: "No qualifying employees (need 5+ customers) match the current filters.",
  });
  Tables.render(sections.leaderboardBottom, {
    id: "leaderboard-bottom", columns: bottomColumns, rows: result.leaderboards.bottom,
    pageSize: 10, exportFileName: `leaderboard-bottom-employees_${filenameSuffix}`,
    emptyMessage: "No qualifying employees (need 5+ customers) match the current filters.",
  });
}

function renderAttritionVacancyQuality(result, dims) {
  Tables.render(sections.attritionTable, {
    id: "attrition-by-team",
    columns: [
      { key: "team", label: "Team" },
      { key: "activeReps", label: "Active", format: "number", align: "right" },
      { key: "resignedReps", label: "Resigned", format: "number", align: "right" },
      { key: "attritionRate", label: "Attrition %", format: "percent1", align: "right", defaultSort: "desc" },
    ],
    rows: result.attrition.byTeam,
    pageSize: 10,
    exportFileName: `attrition-by-team_${filenameSuffix}`,
    emptyMessage: "No attrition data for the current filters.",
  });

  const vac = result.vacancies;
  if (!vac.details.length) {
    sections.vacancyPanel.innerHTML = `<div class="stat"><div class="value">0</div><div class="label">Vacant Slots</div></div>` + UI.emptyState("No vacant slots for the current filters.");
  } else {
    sections.vacancyPanel.innerHTML = `
      <div class="stat" style="margin-bottom:12px;"><div class="value">${vac.total}</div><div class="label">Vacant Slots</div></div>
      <ul class="issue-list">
        ${vac.details.map((d) => `<li><strong>${UI.escapeHtml(d.level)}:</strong> ${UI.escapeHtml(d.slot)}</li>`).join("")}
      </ul>`;
  }

}

/* ── Not-Seen Customers Modal ─────────────────────────────────────────────── */
function wireNotSeenModal() {
  const overlay  = document.getElementById("ns-modal-overlay");
  const closeBtn = document.getElementById("ns-modal-close");
  const searchEl = document.getElementById("ns-modal-search");
  const body     = document.getElementById("ns-modal-body");
  const badge    = document.getElementById("ns-modal-badge");
  const info     = document.getElementById("ns-modal-info");
  const prevBtn  = document.getElementById("ns-modal-prev");
  const nextBtn  = document.getElementById("ns-modal-next");
  const pageLabel= document.getElementById("ns-modal-page-label");
  const exportBtn= document.getElementById("ns-modal-export");

  const PAGE_SIZE = 50;
  let _allRows = [];
  let _filtered = [];
  let _page = 1;

  const COLS = [
    { key: "customerName", label: "Customer Name", width: "18%" },
    { key: "specialty",    label: "Specialty",     width: "10%" },
    { key: "klass",        label: "Class",         width: "6%"  },
    { key: "type",         label: "Type",          width: "6%"  },
    { key: "employee",     label: "Employee",       width: "14%" },
    { key: "team",         label: "Team",           width: "10%" },
    { key: "manager",      label: "Manager",        width: "12%" },
    { key: "frequency",    label: "Freq",           width: "5%", align: "right" },
    { key: "area",         label: "Area",           width: "10%" },
    { key: "lastVisitDate",label: "Last Visit",     width: "9%"  },
  ];

  function esc(s) { return UI.escapeHtml(String(s ?? "")); }

  function applySearch(term) {
    if (!term) return _allRows;
    const q = term.toLowerCase();
    return _allRows.filter((r) =>
      ["customerName","specialty","klass","type","employee","team","manager","area"]
        .some((k) => String(r[k] ?? "").toLowerCase().includes(q))
    );
  }

  function renderBody() {
    const totalPages = Math.max(1, Math.ceil(_filtered.length / PAGE_SIZE));
    _page = Math.min(_page, totalPages);
    const slice = _filtered.slice((_page - 1) * PAGE_SIZE, _page * PAGE_SIZE);

    info.textContent = `${_filtered.length.toLocaleString()} customer${_filtered.length !== 1 ? "s" : ""} not seen`;
    pageLabel.textContent = `${_page} / ${totalPages}`;
    prevBtn.disabled = _page <= 1;
    nextBtn.disabled = _page >= totalPages;

    if (!slice.length) {
      body.innerHTML = `<div style="padding:32px;text-align:center;color:#94A3B8;">No customers match your search.</div>`;
      return;
    }

    const colgroup = COLS.map((c) => `<col style="width:${c.width}">`).join("");
    const thead = COLS.map((c) =>
      `<th style="text-align:${c.align||"left"}">${esc(c.label)}</th>`
    ).join("");
    const tbody = slice.map((r) =>
      `<tr>${COLS.map((c) =>
        `<td style="text-align:${c.align||"left"}" title="${esc(r[c.key])}">${esc(r[c.key])}</td>`
      ).join("")}</tr>`
    ).join("");

    body.innerHTML = `
      <table class="data-table">
        <colgroup>${colgroup}</colgroup>
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>`;
  }

  function openModal() {
    if (typeof Analytics === "undefined" || !Analytics.getNotSeenCustomers) return;
    _allRows = Analytics.getNotSeenCustomers(_lastFilterState || Analytics.defaultFilters());
    badge.textContent = _allRows.length.toLocaleString();
    searchEl.value = "";
    _filtered = _allRows;
    _page = 1;
    renderBody();
    overlay.classList.add("open");
    searchEl.focus();
  }

  function closeModal() {
    overlay.classList.remove("open");
  }

  // Click on notSeen KPI cards or At-Risk Tiers
  document.getElementById("app-root").addEventListener("click", (e) => {
    const card = e.target.closest(".kpi-card");
    if (card) {
      const kpi = card.dataset.kpi;
      if (kpi === "notSeenCount" || kpi === "notSeenPct") openModal();
      return;
    }

    const tierItem = e.target.closest(".rf-at-risk-tier-item");
    if (tierItem && _lastResult && _lastResult.rfInsights && _lastResult.rfInsights.atRiskTiers) {
      const tierNum = tierItem.dataset.tier;
      const tier = _lastResult.rfInsights.atRiskTiers[`tier${tierNum}`];
      if (tier && tier.list) {
        openAtRiskModal(tierNum, tier.list);
      }
    }
  });

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  searchEl.addEventListener("input", Utils.debounce((e) => {
    _filtered = applySearch(e.target.value.trim());
    _page = 1;
    renderBody();
  }, 200));

  prevBtn.addEventListener("click", () => { _page--; renderBody(); });
  nextBtn.addEventListener("click", () => { _page++; renderBody(); });

  exportBtn.addEventListener("click", () => {
    if (typeof Exporter === "undefined") return;
    Exporter.tableToExcel(COLS, _filtered, `not-seen-customers_${filenameSuffix}`);
  });
}

/* ── KOL Coverage ─────────────────────────────────────────────────────────── */
function ragClass(pct) {
  if (pct === null) return "";
  if (pct >= 1)    return "kol-green";
  if (pct >= 0.8)  return "kol-amber";
  return "kol-red";
}

function renderKolCoverage(filterState, cachedRows) {
  let rows = Analytics.getKolCoverage(filterState || Analytics.defaultFilters());
  // View-only mode: Analytics has no raw records — fall back to pre-computed cache
  if (!rows.length && cachedRows && cachedRows.length) rows = cachedRows;

  if (!rows.length) {
    sections.kolTable.innerHTML = UI.emptyState("No customer data for the current filters.");
    return;
  }

  const esc = UI.escapeHtml.bind(UI);
  function pctCell(pct, notSeen, mgrName, quarter) {
    const rag  = ragClass(pct);
    const disp = pct !== null ? (pct * 100).toFixed(1) + "%" : "–";
    const ns   = notSeen > 0
      ? `<span class="kol-not-seen-btn" data-mgr="${esc(mgrName)}" data-q="${quarter}">${notSeen} not seen</span>`
      : `<span class="kol-zero-ns">✓ all seen</span>`;
    return `<td class="kol-pct-cell ${rag}">${disp}<br>${ns}</td>`;
  }

  const thead = `<thead><tr>
    <th style="width:26%">Employee</th>
    <th style="width:12%">Title</th>
    <th style="width:6%;text-align:right">Customer List</th>
    <th style="width:13%;text-align:center">Q1 Coverage %<br><small>Feb–Mar</small></th>
    <th style="width:9%;text-align:center">Q1 Not Seen</th>
    <th style="width:13%;text-align:center">Q2 Coverage %<br><small>Apr–Jun</small></th>
    <th style="width:9%;text-align:center">Q2 Not Seen</th>
    <th style="width:12%;text-align:left">Team</th>
  </tr></thead>`;

  const tbody = rows.map((r) => `<tr>
    <td>${UI.nameWithAvatar(r.name, r.profile)}</td>
    <td style="font-size:11px;color:#475569" title="${esc(r.title)}">${esc(r.title)}</td>
    <td style="text-align:right;font-weight:600">${r.kolCount}</td>
    <td class="kol-pct-cell ${ragClass(r.q1CoveragePct)}" style="text-align:center">
      ${r.q1CoveragePct !== null ? (r.q1CoveragePct * 100).toFixed(1) + "%" : "–"}
    </td>
    <td style="text-align:center">
      ${r.q1NotSeen > 0
        ? `<span class="kol-not-seen-btn" data-mgr="${esc(r.name)}" data-q="q1">${r.q1NotSeen}</span>`
        : `<span class="kol-zero-ns">✓</span>`}
    </td>
    <td class="kol-pct-cell ${ragClass(r.q2CoveragePct)}" style="text-align:center">
      ${r.q2CoveragePct !== null ? (r.q2CoveragePct * 100).toFixed(1) + "%" : "–"}
    </td>
    <td style="text-align:center">
      ${r.q2NotSeen > 0
        ? `<span class="kol-not-seen-btn" data-mgr="${esc(r.name)}" data-q="q2">${r.q2NotSeen}</span>`
        : `<span class="kol-zero-ns">✓</span>`}
    </td>
    <td style="font-size:11px;color:#64748B" title="${esc(r.team)}">${esc(r.team)}</td>
  </tr>`).join("");

  // search + pagination via simple in-memory state
  sections.kolTable.innerHTML = `
    <div class="table-toolbar">
      <input type="search" class="table-search kol-search" placeholder="Search employee, title, team…" />
      <button class="table-export-btn kol-export-btn">Export to Excel</button>
    </div>
    <div class="table-scroll">
      <table class="data-table kol-table">
        <colgroup>
          <col style="width:26%"><col style="width:12%"><col style="width:6%">
          <col style="width:13%"><col style="width:9%"><col style="width:13%">
          <col style="width:9%"><col style="width:12%">
        </colgroup>
        ${thead}
        <tbody id="kol-tbody">${tbody}</tbody>
      </table>
    </div>`;

  // Store rows on the element so the modal can find them by manager name
  sections.kolTable._kolRows = rows;

  // Search
  sections.kolTable.querySelector(".kol-search").addEventListener("input", Utils.debounce((e) => {
    const q = e.target.value.toLowerCase();
    sections.kolTable.querySelectorAll("#kol-tbody tr").forEach((tr) => {
      tr.style.display = q && !tr.textContent.toLowerCase().includes(q) ? "none" : "";
    });
  }, 200));

  // Export
  sections.kolTable.querySelector(".kol-export-btn").addEventListener("click", () => {
    const exportCols = [
      { key: "name", label: "Employee" }, { key: "title", label: "Title" },
      { key: "profile", label: "Profile" }, { key: "team", label: "Team" },
      { key: "kolCount", label: "Customer List" },
      { key: "q1CoveragePct", label: "Q1 Coverage %", format: "percent1" },
      { key: "q1NotSeen", label: "Q1 Not Seen" },
      { key: "q2CoveragePct", label: "Q2 Coverage %", format: "percent1" },
      { key: "q2NotSeen", label: "Q2 Not Seen" },
    ];
    if (typeof Exporter !== "undefined") Exporter.tableToExcel(exportCols, rows, `kol-coverage_${filenameSuffix}`);
  });

  // Not-seen drill-down — delegate to modal
  sections.kolTable.addEventListener("click", (e) => {
    const btn = e.target.closest(".kol-not-seen-btn");
    if (!btn) return;
    const mgrName = btn.dataset.mgr;
    const quarter = btn.dataset.q; // "q1" or "q2"
    openKolModal(mgrName, quarter, sections.kolTable._kolRows);
  });
}

function openKolModal(mgrName, quarter, kolRows) {
  const entry = kolRows.find((r) => r.name === mgrName);
  if (!entry) return;
  const list = quarter === "q1" ? entry.q1NotSeenList : entry.q2NotSeenList;
  const qLabel = quarter === "q1" ? "Q1 (Feb–Mar)" : "Q2 (Apr–Jun)";

  // Reuse the existing not-seen modal overlay
  const overlay = document.getElementById("ns-modal-overlay");
  const badge   = document.getElementById("ns-modal-badge");
  const body    = document.getElementById("ns-modal-body");
  const info    = document.getElementById("ns-modal-info");
  const titleEl = document.getElementById("ns-modal-title-text");
  const searchEl= document.getElementById("ns-modal-search");
  const prevBtn = document.getElementById("ns-modal-prev");
  const nextBtn = document.getElementById("ns-modal-next");
  const pageLabel=document.getElementById("ns-modal-page-label");
  const exportBtn=document.getElementById("ns-modal-export");

  titleEl.textContent = `Customers Not Seen — ${mgrName} — ${qLabel}`;
  badge.textContent   = list.length;
  searchEl.value      = "";
  prevBtn.disabled    = true;
  nextBtn.disabled    = true;
  pageLabel.textContent = "";
  info.textContent    = `${list.length} customer${list.length !== 1 ? "s" : ""} not visited in ${qLabel}`;

  const COLS = [
    { key: "customerName", label: "Customer Name", width: "30%" },
    { key: "specialty",    label: "Specialty",     width: "15%" },
    { key: "klass",        label: "Class",          width: "8%" },
    { key: "type",         label: "Type",           width: "10%" },
    { key: "area",         label: "Area",           width: "15%" },
    { key: "lastVisitDate",label: "Last Visit",     width: "14%" },
    { key: "frequency",    label: "Target Freq",    width: "8%", align: "right" },
  ];

  function renderKolModalBody(filteredRows) {
    if (!filteredRows.length) {
      body.innerHTML = `<div style="padding:32px;text-align:center;color:#94A3B8;">No customers match.</div>`;
      return;
    }
    const colgroup = COLS.map((c) => `<col style="width:${c.width}">`).join("");
    const thead    = COLS.map((c) =>
      `<th style="text-align:${c.align || "left"}">${UI.escapeHtml(c.label)}</th>`
    ).join("");
    const tbody = filteredRows.map((r) =>
      `<tr>${COLS.map((c) =>
        `<td style="text-align:${c.align || "left"}" title="${UI.escapeHtml(String(r[c.key] ?? ""))}">${UI.escapeHtml(String(r[c.key] ?? ""))}</td>`
      ).join("")}</tr>`
    ).join("");
    body.innerHTML = `<table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;
  }

  let filtered = list;
  renderKolModalBody(filtered);
  overlay.classList.add("open");
  searchEl.focus();

  // Replace search handler for KOL context
  const newSearch = searchEl.cloneNode(true);
  newSearch.placeholder = "Search by customer, specialty, class…";
  searchEl.parentNode.replaceChild(newSearch, searchEl);
  newSearch.addEventListener("input", Utils.debounce((e) => {
    const q = e.target.value.toLowerCase();
    filtered = q
      ? list.filter((r) => ["customerName","specialty","klass","type","area"].some(
          (k) => String(r[k] ?? "").toLowerCase().includes(q)
        ))
      : list;
    renderKolModalBody(filtered);
  }, 200));

  // Replace export handler
  const newExport = exportBtn.cloneNode(true);
  exportBtn.parentNode.replaceChild(newExport, exportBtn);
  newExport.addEventListener("click", () => {
    if (typeof Exporter !== "undefined")
      Exporter.tableToExcel(COLS, filtered, `customers-not-seen_${UI.escapeHtml(mgrName)}_${quarter}_${filenameSuffix}`);
  });
}

function openAtRiskModal(tierNum, list) {
  const tierNames = {
    "1": "Easy Win (1 Missed Call)",
    "2": "Moderate Gap (2 Missed Calls)",
    "3": "Major Gap (3+ Missed Calls)"
  };
  const title = `At-Risk Doctors — ${tierNames[tierNum] || ""}`;

  // Reuse the existing not-seen modal overlay
  const overlay = document.getElementById("ns-modal-overlay");
  const badge   = document.getElementById("ns-modal-badge");
  const body    = document.getElementById("ns-modal-body");
  const info    = document.getElementById("ns-modal-info");
  const titleEl = document.getElementById("ns-modal-title-text");
  const searchEl= document.getElementById("ns-modal-search");
  const prevBtn = document.getElementById("ns-modal-prev");
  const nextBtn = document.getElementById("ns-modal-next");
  const pageLabel=document.getElementById("ns-modal-page-label");
  const exportBtn=document.getElementById("ns-modal-export");

  titleEl.textContent = title;
  badge.textContent   = list.length;
  searchEl.value      = "";
  prevBtn.disabled    = true;
  nextBtn.disabled    = true;
  pageLabel.textContent = "";
  info.textContent    = `${list.length} customer${list.length !== 1 ? "s" : ""} in this tier`;

  const COLS = [
    { key: "customerName", label: "Customer Name", width: "20%" },
    { key: "specialty",    label: "Specialty",     width: "10%" },
    { key: "klass",        label: "Class",          width: "6%" },
    { key: "type",         label: "Type",           width: "8%" },
    { key: "employee",     label: "Employee",       width: "12%" },
    { key: "team",         label: "Team",           width: "10%" },
    { key: "manager",      label: "Manager",        width: "10%" },
    { key: "area",         label: "Area",           width: "10%" },
    { key: "lastVisitDate",label: "Last Visit",     width: "10%" },
    { key: "frequency",    label: "Freq",           width: "6%", align: "right" },
    { key: "visits",       label: "Visits",         width: "6%", align: "right" },
    { key: "missedCalls",  label: "Missed",         width: "6%", align: "right" },
  ];

  function renderAtRiskModalBody(filteredRows) {
    if (!filteredRows.length) {
      body.innerHTML = `<div style="padding:32px;text-align:center;color:#94A3B8;">No doctors match.</div>`;
      return;
    }
    const colgroup = COLS.map((c) => `<col style="width:${c.width}">`).join("");
    const thead    = COLS.map((c) =>
      `<th style="text-align:${c.align || "left"}">${UI.escapeHtml(c.label)}</th>`
    ).join("");
    const tbody = filteredRows.map((r) =>
      `<tr>${COLS.map((c) =>
        `<td style="text-align:${c.align || "left"}" title="${UI.escapeHtml(String(r[c.key] ?? ""))}">
          ${c.key === "missedCalls" ? `<strong>${r[c.key]}</strong>` : UI.escapeHtml(String(r[c.key] ?? ""))}
        </td>`
      ).join("")}</tr>`
    ).join("");
    body.innerHTML = `<table class="data-table">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;
  }

  let filtered = list;
  renderAtRiskModalBody(filtered);
  overlay.classList.add("open");
  searchEl.focus();

  // Replace search handler
  const newSearch = searchEl.cloneNode(true);
  newSearch.placeholder = "Search by customer, employee, area…";
  searchEl.parentNode.replaceChild(newSearch, searchEl);
  newSearch.addEventListener("input", Utils.debounce((e) => {
    const q = e.target.value.toLowerCase();
    filtered = q
      ? list.filter((r) => ["customerName","specialty","klass","type","employee","team","manager","area"].some(
          (k) => String(r[k] ?? "").toLowerCase().includes(q)
        ))
      : list;
    renderAtRiskModalBody(filtered);
  }, 200));

  // Replace export handler
  const newExport = exportBtn.cloneNode(true);
  exportBtn.parentNode.replaceChild(newExport, exportBtn);
  newExport.addEventListener("click", () => {
    if (typeof Exporter !== "undefined")
      Exporter.tableToExcel(COLS, filtered, `at-risk-doctors-tier${tierNum}_${filenameSuffix}`);
  });
}
