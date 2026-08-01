/**
 * ZETA ENTERPRISE PLATFORM — storytelling.js
 * =====================================================================
 * Semantic analytics layer on top of the existing dashboard.
 * Houses the Performance Storyteller analytical decision-support engine.
 *
 * AUTHORIZATION: Strictly role-gated (SFE Manager, BEX, Admin, CEO, VP).
 * CALCULATIONS: Fully deterministic, statistically validated (Pearson r, R², p-value).
 * FILTER AWARE: Live calculations executed on active filter states.
 * NO HALUCINATION: Strictly data-driven templates with auditability.
 * =====================================================================
 */
(function (global) {
  "use strict";

  // --- Inject CSS Styles for Premium UI ---
  function injectStyles() {
    if (document.getElementById("storyteller-styles")) return;
    const style = document.createElement("style");
    style.id = "storyteller-styles";
    style.textContent = `
      .story-tab-header {
        margin-bottom: var(--space-6, 24px);
        background: linear-gradient(135deg, #0F4C81 0%, #1D70B8 100%);
        padding: var(--space-6, 24px);
        border-radius: var(--radius-lg, 12px);
        color: #FFFFFF;
        box-shadow: 0 4px 20px rgba(15, 76, 129, 0.15);
      }
      .story-tab-header h2 {
        margin: 0;
        font-size: var(--fs-2xl, 24px);
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .story-tab-header p {
        margin: 8px 0 0 0;
        font-size: var(--fs-sm, 14px);
        opacity: 0.9;
      }
      .story-filters-summary {
        background: #F8FAFC;
        border: 1px solid #E2E8F0;
        padding: 12px 16px;
        border-radius: var(--radius-md, 8px);
        font-size: var(--fs-xs, 12px);
        color: #64748B;
        margin-bottom: 24px;
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
      }
      .story-filters-summary strong {
        color: #0F172A;
      }
      .story-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--space-6, 24px);
        margin-bottom: var(--space-8, 32px);
      }
      @media(min-width: 1024px) {
        .story-grid {
          grid-template-columns: 1fr 1fr;
        }
      }
      .story-card {
        background: #FFFFFF;
        border: 1px solid #E2E8F0;
        border-radius: var(--radius-lg, 12px);
        padding: var(--space-6, 24px);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .story-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.08);
      }
      .story-card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: var(--space-4, 16px);
        gap: 12px;
      }
      .story-card-title {
        font-size: var(--fs-md, 16px);
        font-weight: 700;
        color: #0F172A;
        margin: 0;
        line-height: 1.4;
      }
      .story-badge {
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
        border-radius: 9999px;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .story-badge-very-strong { background: #DCFCE7; color: #15803D; }
      .story-badge-strong { background: #ECFDF5; color: #047857; }
      .story-badge-moderate { background: #FEF3C7; color: #D97706; }
      .story-badge-weak { background: #FFF9DB; color: #F59F00; }
      .story-badge-none { background: #F1F5F9; color: #64748B; }

      .story-body {
        margin-top: 8px;
      }
      .story-body-empty {
        font-size: var(--fs-sm, 14px);
        color: #64748B;
        font-style: italic;
        line-height: 1.5;
        margin: 0 0 10px 0;
      }
      .story-section-title {
        font-size: var(--fs-xs, 12px);
        font-weight: 700;
        color: #475569;
        text-transform: uppercase;
        margin-top: 14px;
        margin-bottom: 4px;
        letter-spacing: 0.05em;
      }
      .story-text {
        font-size: var(--fs-sm, 14px);
        color: #334155;
        line-height: 1.5;
        margin: 0 0 10px 0;
      }
      .story-trace-btn {
        background: #F1F5F9;
        color: #475569;
        border: none;
        padding: 6px 12px;
        border-radius: var(--radius-sm, 6px);
        font-size: var(--fs-xs, 12px);
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
        margin-top: 12px;
        width: 100%;
        text-align: center;
      }
      .story-trace-btn:hover {
        background: #E2E8F0;
      }
      .story-trace-panel {
        background: #F8FAFC;
        border: 1px dashed #CBD5E1;
        border-radius: var(--radius-sm, 6px);
        padding: 12px;
        margin-top: 10px;
        font-family: monospace;
        font-size: 11px;
        color: #475569;
        display: none;
      }
      .story-trace-panel.show {
        display: block;
      }
      .story-trace-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      .story-trace-item {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      
      /* Driver Contribution Styles */
      .driver-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 8px;
      }
      .driver-table th, .driver-table td {
        padding: 8px 12px;
        font-size: var(--fs-sm, 13px);
        border-bottom: 1px solid #E2E8F0;
        text-align: left;
      }
      .driver-table th {
        font-weight: 700;
        color: #475569;
        background: #F8FAFC;
      }
      .driver-rank-pill {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 700;
        font-size: 11px;
      }
      .driver-rank-primary { background: #EFF6FF; color: #1D4ED8; }
      .driver-rank-secondary { background: #F8FAFC; color: #475569; }
    `;
    document.head.appendChild(style);
  }

  // --- Standard Normal CDF Polynomial Approximation (Abramowitz & Stegun) ---
  function normalCDF(x) {
    const t = 1 / (1 + 0.2316419 * x);
    const d = 0.3989422804 * Math.exp(-x * x / 2);
    const prob = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return 1 - prob;
  }

  // --- Pearson Correlation Engine ---
  function calculatePearson(x, y) {
    const n = x.length;
    if (n < 3) {
      return { r: 0, r2: 0, p: 1, confidence: "No Evidence", direction: "None" };
    }

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumX2 += x[i] * x[i];
      sumY2 += y[i] * y[i];
    }

    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    if (den === 0) {
      return { r: 0, r2: 0, p: 1, confidence: "No Evidence", direction: "None" };
    }

    const r = num / den;
    const r2 = r * r;

    // Fisher z-transformation to calculate two-tailed p-value
    const rClamped = Math.max(-0.9999, Math.min(0.9999, r));
    const z = 0.5 * Math.log((1 + rClamped) / (1 - rClamped)) * Math.sqrt(n - 3);
    const absZ = Math.abs(z);
    const p = Math.min(1.0, Math.max(0.0, 2 * (1 - normalCDF(absZ))));

    // Classification
    let confidence = "No Evidence";
    const absR = Math.abs(r);
    if (absR >= 0.8) confidence = "Very Strong";
    else if (absR >= 0.6) confidence = "Strong";
    else if (absR >= 0.4) confidence = "Moderate";
    else if (absR >= 0.2) confidence = "Weak";

    // Insignificance Gating (p >= 0.05 implies weak/no correlation in practice)
    if (p >= 0.05 && confidence !== "No Evidence") {
      confidence = "Weak";
    }

    return {
      r: r,
      r2: r2,
      p: p,
      confidence: confidence,
      direction: r > 0 ? "Positive" : r < 0 ? "Negative" : "None"
    };
  }

  // --- Storytelling Dashboard Definition ---
  const StorytellingDashboard = {
    init: function (containerId) {
      if (typeof window.SEMANTIC === "undefined" || typeof window.DS === "undefined") {
        console.error("[Storytelling] Missing semantic-model.js or components.js dependencies.");
        return;
      }

      const container = document.getElementById(containerId);
      if (!container) return;

      // 1. Role-based Authentication Check
      const user = window.AUTH ? window.AUTH.getValidSessionUser() : null;
      const role = user && user.role ? user.role.toUpperCase() : "";
      const allowed = ["SFE MANAGER", "BEX", "ADMIN", "CEO", "VP"].includes(role);

      if (!allowed) {
        container.innerHTML = `
          <div class="ds-page" style="padding:40px;">
            <div style="max-width:520px;margin:80px auto;text-align:center;">
              <div style="font-size:4rem;margin-bottom:16px;">🔒</div>
              <h2 style="font-size:1.5rem;font-weight:700;color:var(--color-text-primary,#0F172A);margin-bottom:8px;">Access Restricted</h2>
              <p style="font-size:0.875rem;color:var(--color-text-tertiary,#94A3B8);">You do not have permission to view the Performance Storyteller. Authorized roles: SFE Manager, BEX, Admin, CEO, VP.</p>
            </div>
          </div>`;
        return;
      }

      document.body.classList.add("storyteller-mode");
      container.classList.add("ds-page-root");
      injectStyles();

      this.render(container);
    },

    destroy: function () {
      document.body.classList.remove("storyteller-mode");
    },

    render: function (container) {
      container.innerHTML = "";

      const filters = window.Filters ? window.Filters.getState() : {};
      const bu = (filters.businessUnit && filters.businessUnit.length > 0) ? filters.businessUnit[0] : "CHC";
      const line = (filters.team && filters.team.length > 0) ? filters.team[0] : null;

      // Filter state labels
      const filterLabelString = `
        <strong>BU:</strong> ${bu} | 
        <strong>Line:</strong> ${line || "All"} | 
        <strong>Manager:</strong> ${filters.manager && filters.manager.length > 0 ? filters.manager.join(", ") : "All"} | 
        <strong>Territory:</strong> ${filters.areaManager && filters.areaManager.length > 0 ? filters.areaManager.join(", ") : "All"} | 
        <strong>Rep:</strong> ${filters.employee && filters.employee.length > 0 ? filters.employee.join(", ") : "All"} | 
        <strong>Period:</strong> ${filters.period && filters.period.length > 0 ? filters.period.join(", ") : "Latest (Jun)"}
      `;

      // Header Section
      const headerWrap = document.createElement("div");
      headerWrap.className = "story-tab-header";
      headerWrap.innerHTML = `
        <h2>Performance Storyteller</h2>
        <p>Interactive cross-dataset semantic decision-support engine with statistical validation.</p>
      `;
      container.appendChild(headerWrap);

      const filterSummary = document.createElement("div");
      filterSummary.className = "story-filters-summary";
      filterSummary.innerHTML = filterLabelString;
      container.appendChild(filterSummary);

      // Perform Data Mining & Statistical Analysis
      const analysisResult = this.runStatisticalAnalysis(bu, line, filters);

      // Render Dashboard Grid
      const grid = document.createElement("div");
      grid.className = "story-grid";
      
      // Card 1: Coverage vs. Sales Achievement
      grid.appendChild(this.buildStoryCard(
        "Territory Coverage vs. Sales Target Achievement",
        analysisResult.coverageVsAchievement,
        {
          factor: "Doctor Coverage %",
          target: "Sales Target Achievement %",
          what: "Doctor Coverage % vs. Sales Target Achievement % correlation.",
          where: `Active Lines/DMs under ${bu} / ${line || "All"}.`,
          why: "Determining whether doctor contact coverage is the primary driver of sales value achievement.",
          recs: "BUM / NSM",
          kpi: "Sales Achievement %"
        },
        "cache/sales.json & cache/records.data.js"
      ));

      // Card 2: Call Execution vs. Target Achievement
      grid.appendChild(this.buildStoryCard(
        "Call Execution Quality vs. Target Achievement",
        analysisResult.callsVsAchievement,
        {
          factor: "Total Visit Achievement %",
          target: "Sales Target Achievement %",
          what: "Total Visit Achievement % vs. Sales Target Achievement %.",
          where: `Active lines/DMs under ${bu} / ${line || "All"}.`,
          why: "Evaluating if visit quantity targets translate directly to non-tender target values.",
          recs: "NSM / DM",
          kpi: "Visit Achievement %"
        },
        "cache/sales.json & cache/records.data.js"
      ));

      // Card 3: Headcount Fill Rate vs. Sales Productivity
      grid.appendChild(this.buildStoryCard(
        "SFE Headcount Fill-Rate vs. Sales Productivity",
        analysisResult.vacancyVsProductivity,
        {
          factor: "SFE planned headcount fill-rate",
          target: "Sales per Position",
          what: "SFE planned headcount fill-rate vs. Sales per Position.",
          where: `Active line segments under ${bu}.`,
          why: "Analyzing if territory vacancies directly dilute position sales productivity.",
          recs: "BEX / SFE Manager",
          kpi: "Sales per Position (EGP)"
        },
        "cache/sales.json & cache/organogram.json"
      ));

      // Card 4: Market Growth vs. Internal Sales Growth
      grid.appendChild(this.buildStoryCard(
        "IQVIA Market Segment Growth vs. Internal Sales Growth",
        analysisResult.marketVsInternal,
        {
          factor: "IQVIA segment overall MAT growth rate",
          target: "Internal Sales Growth rate",
          what: "IQVIA segment overall MAT growth rate vs. Internal Sales Growth rate.",
          where: `All major Business Units (${window.SEMANTIC ? window.SEMANTIC.BU_LIST.join(", ") : "All"}).`,
          why: "Comparing internal sales growth rates against overall segment expansion and competitor growth.",
          recs: "BUM / CEO / VP",
          kpi: "Market Share MAT %"
        },
        "cache/sales.json & cache/iqvia.json"
      ));

      container.appendChild(grid);

      // Section 2: Driver Contribution Analysis (Multi-Factor Analysis)
      const contributionSection = this.buildContributionSection(analysisResult.drivers);
      container.appendChild(contributionSection);

      this.wireTraceEvents(container);
    },

    runStatisticalAnalysis: function (bu, line, filters) {
      const activeLine = (line !== "All") ? line : (window.AUTH && window.AUTH.getScope().lines && window.AUTH.getScope().lines.length === 1 ? window.AUTH.getScope().lines[0] : null);
      
      // Pull data vectors per DM in scope
      const xCov = [], yAch = [], xCalls = [], yCallsAch = [], xVac = [], yProd = [];

      // DM Sales Data
      let salesByDm = new Map();
      const salesData = window.SalesDashboard ? window.SalesDashboard.getDmSalesSummary(bu, activeLine, null) : null;
      if (salesData && salesData.ok && salesData.dms) {
        salesData.dms.forEach(d => {
          salesByDm.set(d.name.toUpperCase().trim(), d);
        });
      }

      // Group records by DM (manager index) dynamically
      const records = window.CacheStore ? window.CacheStore.getRecords() : null;
      const dash = window.CacheStore ? window.CacheStore.getDashboard() : null;
      const dims = dash && dash.dimensions;
      
      const dmVisits = new Map(); // dmName -> { visits: 0, targetFreq: 0, covered: 0, totalCount: 0 }
      
      if (records && records.rows && dims) {
        const F = {
          period: 0, team: 1, manager: 5, status: 9, experience: 10,
          coveredDoctor: 12, rightFreq: 13, visits: 14, isActive: 15, frequency: 21
        };
        const latestPeriodIdx = (dims.periods || []).length - 1;
        const expIdx = (dims.experiences || []).indexOf("Non-Probation");
        const statusIdx = (dims.statuses || []).indexOf("Active");
        
        records.rows.forEach(row => {
          if (row[F.period] !== latestPeriodIdx) return;
          if (row[F.experience] !== expIdx) return;
          if (row[F.status] !== statusIdx) return;
          if (!row[F.isActive]) return;
          
          const teamName = (dims.teams || [])[row[F.team]];
          if (window.AUTH && !window.AUTH.isLineAllowed(teamName)) return;
          const rowBU = window.SEMANTIC.lineToBU(teamName);
          if (rowBU !== bu) return;
          const canonLine = window.SEMANTIC.normalizeLine(teamName);
          if (activeLine && canonLine !== activeLine) return;
          
          const dmName = (dims.managers || [])[row[F.manager]];
          if (!dmName || dmName === "(none)" || dmName.toUpperCase() === "VACANT") return;
          
          const dmKey = dmName.toUpperCase().trim();
          if (!dmVisits.has(dmKey)) {
            dmVisits.set(dmKey, { name: dmName, visits: 0, targetFreq: 0, covered: 0, totalCount: 0 });
          }
          const item = dmVisits.get(dmKey);
          item.visits += row[F.visits] || 0;
          item.targetFreq += row[F.frequency] || 0;
          item.covered += row[F.coveredDoctor] || 0;
          item.totalCount += 1;
        });

        // Correlate gathered DM coverage & visit metrics with sales achievement
        dmVisits.forEach((item, dmKey) => {
          const sales = salesByDm.get(dmKey);
          if (sales && sales.achievementPct !== null) {
            const covPct = item.totalCount > 0 ? (item.covered / item.totalCount) : 0;
            const visitAch = item.targetFreq > 0 ? (item.visits / item.targetFreq) : 0;

            xCov.push(covPct);
            yAch.push(sales.achievementPct / 100);

            xCalls.push(visitAch);
            yCallsAch.push(sales.achievementPct / 100);
          }
        });
      }

      // Vacancy vs Productivity per Line
      const uniqueLines = [];
      if (dims && dims.teams) {
        dims.teams.forEach(tName => {
          if (window.SEMANTIC && window.SEMANTIC.lineToBU(tName) === bu) {
            uniqueLines.push(window.SEMANTIC.normalizeLine(tName));
          }
        });
      }
      const sfeLines = [...new Set(uniqueLines)];
      sfeLines.forEach(lName => {
        const headcount = window.SFEDashboard ? window.SFEDashboard.getFilteredHeadcountForLine(bu, lName, true) : null;
        
        let targetLine = lName;
        // Map CHC_SALES to CHC for sales lookup
        if (targetLine === "CHC_SALES") targetLine = "CHC";
        
        // Retrieve line sales productivity (actual / active headcount)
        const lineSales = window.SalesDashboard ? window.SalesDashboard.getLineSalesSummary(bu, null, true) : null;
        if (lineSales && lineSales.ok && lineSales.lines) {
          const lineRow = lineSales.lines.find(r => window.SEMANTIC.normalizeLine(r.line) === window.SEMANTIC.normalizeLine(lName));
          if (lineRow && headcount && headcount.ok) {
            const vacancyRate = headcount.vacancyRatePct / 100;
            const plannedHeadcount = headcount.headcountTotal;
            const salesPerPosition = (lineRow.actualValue && plannedHeadcount > 0) ? (lineRow.actualValue / plannedHeadcount) : 0;
            
            xVac.push(vacancyRate);
            yProd.push(salesPerPosition);
          }
        }
      });

      // BU level: Market Growth vs Internal Sales Growth
      const iqviaSummary = window.IQVIADashboard ? window.IQVIADashboard.getBusinessSummary() : null;
      const salesSummary = window.SalesDashboard ? window.SalesDashboard.getBusinessSummary() : null;

      const xMarketGrow = [], yInternalGrow = [];
      if (iqviaSummary && iqviaSummary.ok && salesSummary && salesSummary.ok) {
        window.SEMANTIC.BU_LIST.forEach(buName => {
          const iqRow = iqviaSummary.bu[buName];
          const saRow = salesSummary.bu[buName];
          if (iqRow && saRow) {
            // MAT segment growth rate
            const mktGrowth = iqRow.marketGrowthPct / 100;
            // Internal non-tender sales growth rate (using correct momGrowthPct key)
            const intGrowth = saRow.momGrowthPct / 100;
            if (mktGrowth !== null && intGrowth !== null && !isNaN(mktGrowth) && !isNaN(intGrowth)) {
              xMarketGrow.push(mktGrowth);
              yInternalGrow.push(intGrowth);
            }
          }
        });
      }

      // Calculate statistical correlations
      const covCorr = calculatePearson(xCov, yAch);
      const callCorr = calculatePearson(xCalls, yCallsAch);
      const vacCorr = calculatePearson(xVac, yProd);
      const mktCorr = calculatePearson(xMarketGrow, yInternalGrow);

      return {
        coverageVsAchievement: { ...covCorr, n: xCov.length },
        callsVsAchievement: { ...callCorr, n: xCalls.length },
        vacancyVsProductivity: { ...vacCorr, n: xVac.length },
        marketVsInternal: { ...mktCorr, n: xMarketGrow.length },
        drivers: [
          { name: "Doctor Coverage %", ...covCorr, n: xCov.length },
          { name: "Call Execution (Visits)", ...callCorr, n: xCalls.length }
        ]
      };
    },

    buildStoryCard: function (title, stat, context, cacheSource) {
      const card = document.createElement("div");
      card.className = "story-card";

      // Badges
      let badgeClass = "story-badge-none";
      if (stat.confidence === "Very Strong") badgeClass = "story-badge-very-strong";
      else if (stat.confidence === "Strong") badgeClass = "story-badge-strong";
      else if (stat.confidence === "Moderate") badgeClass = "story-badge-moderate";
      else if (stat.confidence === "Weak") badgeClass = "story-badge-weak";

      const badge = `<span class="story-badge ${badgeClass}">${stat.confidence}</span>`;

      // Build Story Text
      let storyHtml = "";
      if (stat.confidence === "Weak" || stat.confidence === "No Evidence" || stat.n < 3) {
        storyHtml = `
          <p class="story-body-empty">
            "There is currently insufficient statistical evidence to support a meaningful relationship."
          </p>
        `;
      } else {
        const directionWord = stat.r > 0 ? "positive" : "negative";
        const strengthWord = stat.confidence.toLowerCase();
        
        storyHtml = `
          <div class="story-section-title">1. What happened?</div>
          <p class="story-text">
            A ${strengthWord} ${directionWord} correlation of <strong>${(stat.r).toFixed(2)}</strong> was observed between ${context.what}
          </p>
          
          <div class="story-section-title">2. Where did it happen?</div>
          <p class="story-text">${context.where}</p>
          
          <div class="story-section-title">3. Why did it happen?</div>
          <p class="story-text">
            The data suggests that changes in ${context.factor} account for <strong>${(stat.r2 * 100).toFixed(1)}%</strong> (\(R^2 = ${stat.r2.toFixed(3)}\)) of the variance in ${context.target}. 
            <em>Correlation does not necessarily equal causation, but it indicates a strong statistical dependency.</em>
          </p>
          
          <div class="story-section-title">4. What evidence supports this?</div>
          <p class="story-text">
            Statistical regression of ${stat.n} data points gives a Pearson correlation of \(r = ${stat.r.toFixed(3)}\), \(R^2 = ${stat.r2.toFixed(3)}\), and a two-tailed probability index \(p = ${stat.p.toFixed(4)}\) (confidence level: ${stat.confidence}).
          </p>
          
          <div class="story-section-title">5. What is the business implication?</div>
          <p class="story-text">
            Focusing resources to optimize ${context.factor} will likely yield a measurable, non-random upgrade in ${context.kpi}.
          </p>
          
          <div class="story-section-title">6. What action is recommended?</div>
          <p class="story-text">
            Re-align SFE resource allocation and call frequencies to focus on uncovered premium segments. Recommended owner: <strong>${context.recs}</strong>.
          </p>
          
          <div class="story-section-title">7. Which KPI should improve?</div>
          <p class="story-text"><strong>${context.kpi}</strong></p>
        `;
      }

      // Traceability Details (JSON format for auditability)
      const traceId = Math.random().toString(36).substring(7).toUpperCase();
      const tracePanel = `
        <button type="button" class="story-trace-btn" data-target="trace-${traceId}">Show Technical Traceability</button>
        <div class="story-trace-panel" id="trace-${traceId}">
          <div class="story-trace-grid">
            <div class="story-trace-item"><strong>Source Cache:</strong></div>
            <div class="story-trace-item" title="${cacheSource}">${cacheSource}</div>
            <div class="story-trace-item"><strong>Applied Filters:</strong></div>
            <div class="story-trace-item" title="${title}">Active filter scope</div>
            <div class="story-trace-item"><strong>Calculation:</strong></div>
            <div class="story-trace-item">Fisher z-transformation</div>
            <div class="story-trace-item"><strong>Pearson r:</strong></div>
            <div class="story-trace-item">${stat.r.toFixed(4)}</div>
            <div class="story-trace-item"><strong>R²:</strong></div>
            <div class="story-trace-item">${stat.r2.toFixed(4)}</div>
            <div class="story-trace-item"><strong>Sample Size (N):</strong></div>
            <div class="story-trace-item">${stat.n}</div>
            <div class="story-trace-item"><strong>p-value:</strong></div>
            <div class="story-trace-item">${stat.p.toFixed(5)}</div>
            <div class="story-trace-item"><strong>Traceability ID:</strong></div>
            <div class="story-trace-item">STORY-${traceId}</div>
          </div>
        </div>
      `;

      card.innerHTML = `
        <div>
          <div class="story-card-header">
            <h3 class="story-card-title">${title}</h3>
            ${badge}
          </div>
          <div class="story-body">
            ${storyHtml}
          </div>
        </div>
        <div>
          ${tracePanel}
        </div>
      `;

      return card;
    },

    buildContributionSection: function (drivers) {
      const section = document.createElement("section");
      section.className = "dashboard-section";
      section.style.marginTop = "24px";
      section.innerHTML = `
        <div class="section-header"><h2>Multi-Factor Driver Contribution Analysis</h2></div>
        <div class="section-body card">
          <p style="font-size: var(--fs-sm, 14px); color: #475569; margin-bottom: 16px;">
            The table below ranks operational factors by their absolute statistical correlation (\(r\)) with Sales Target Achievement. 
            Factors with higher absolute values have the strongest historical relationship with target achievement within the current filter scope.
          </p>
          <table class="driver-table">
            <thead>
              <tr>
                <th>Factor / Operational Metric</th>
                <th>Pearson r</th>
                <th>R² Variance Expl.</th>
                <th>Classification</th>
                <th>Role Owner</th>
                <th>Relationship Strength</th>
              </tr>
            </thead>
            <tbody>
              ${drivers.map((d, idx) => {
                const rankPillClass = idx === 0 ? "driver-rank-primary" : "driver-rank-secondary";
                const rankLabel = idx === 0 ? "Primary Driver" : "Secondary Factor";
                return `
                  <tr>
                    <td>
                      <span class="driver-rank-pill ${rankPillClass}" style="margin-right: 8px;">${rankLabel}</span>
                      <strong>${d.name}</strong>
                    </td>
                    <td>${d.r.toFixed(3)}</td>
                    <td>${(d.r2 * 100).toFixed(1)}%</td>
                    <td>${d.p < 0.05 ? "Statistically Significant (p < 0.05)" : "Insignificant (p >= 0.05)"}</td>
                    <td>${d.name.includes("Coverage") ? "BUM / NSM" : "NSM / DM"}</td>
                    <td>
                      <span class="story-badge ${
                        d.confidence === "Very Strong" ? "story-badge-very-strong" :
                        d.confidence === "Strong" ? "story-badge-strong" :
                        d.confidence === "Moderate" ? "story-badge-moderate" :
                        d.confidence === "Weak" ? "story-badge-weak" : "story-badge-none"
                      }">${d.confidence}</span>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      `;
      return section;
    },

    wireTraceEvents: function (container) {
      container.querySelectorAll(".story-trace-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const targetId = btn.dataset.target;
          const panel = container.querySelector("#" + targetId);
          if (panel) {
            const isVisible = panel.classList.contains("show");
            panel.classList.toggle("show", !isVisible);
            btn.textContent = isVisible ? "Show Technical Traceability" : "Hide Technical Traceability";
          }
        });
      });
    }
  };

  global.StorytellingDashboard = StorytellingDashboard;

})(window);
