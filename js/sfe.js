/**
 * js/sfe.js
 * Zeta Organogram Module
 * Handles calculations, templates, cascading filters, search, and charts for Organogram views.
 */

(function () {
  const SFE = {
    container: null,
    activeTab: 'vacancy', // 'vacancy', 'span', 'tenure'
    searchVacantQuery: '',
    searchSpanQuery: '',
    
    // Cascading filter state
    filters: {
      line: 'ALL',
      bum: 'ALL',
      nsm: 'ALL',
      asm: 'ALL',
      dm: 'ALL'
    },

    init(containerId) {
      this.container = document.getElementById(containerId);
      if (!this.container) return;

      // Add 'sfe-mode' class to body to dynamically hide global filters
      document.body.classList.add('sfe-mode');

      // Reset filters on init
      this.resetFilters();
      this.render();
    },

    destroy() {
      document.body.classList.remove('sfe-mode');
    },

    resetFilters() {
      this.filters = {
        line: 'ALL',
        bum: 'ALL',
        nsm: 'ALL',
        asm: 'ALL',
        dm: 'ALL'
      };
      this.searchVacantQuery = '';
      this.searchSpanQuery = '';
    },

    getData() {
      if (window.DASHBOARD_ORGANOGRAM) {
        return window.DASHBOARD_ORGANOGRAM;
      }
      return {
        dmHierarchy: {},
        asmHierarchy: {},
        vacancyByLine: [],
        vacancyByManager: [],
        vacantPositions: [],
        spanOfControl: { dmSpan: [], asmSpan: [], averageDmSpan: 0, averageAsmSpan: 0 },
        brickWorkload: { averageBricksPerRep: 0, buckets: { light: 0, balanced: 0, dense: 0, overloaded: 0 }, overloadedReps: [] },
        tenureStability: { probationTurnover: [], nonProbationTurnover: [], currentRampUpRate: 0, averageRepTenureMonths: 0, lifecycleCounts: { probation: 0, nonProbation: 0 }, trainingAlerts: [] }
      };
    },

    // Build the master planned territories list for cascading filtering
    getHierarchyList() {
      const data = this.getData();
      const list = [];

      // 1. Add active slots from activePositions
      (data.activePositions || []).forEach(p => {
        list.push({
          line: p.line || '',
          bum: p.bum || '',
          nsm: p.nsm || '',
          asm: p.asm || '',
          dm: p.dm || '',
          status: 'Active'
        });
      });

      // 2. Add vacant slots
      (data.vacantPositions || []).forEach(p => {
        list.push({
          line: p.line || '',
          bum: p.bum || '',
          nsm: p.nsm || '',
          asm: p.asm || '',
          dm: p.dm || '',
          status: 'Vacant'
        });
      });

      return list;
    },

    // Get filtered list of territories based on current filter selections
    getFilteredList(masterList) {
      return masterList.filter(row => {
        if (this.filters.line !== 'ALL' && row.line !== this.filters.line) return false;
        if (this.filters.bum !== 'ALL' && row.bum !== this.filters.bum) return false;
        if (this.filters.nsm !== 'ALL' && row.nsm !== this.filters.nsm) return false;
        if (this.filters.asm !== 'ALL' && row.asm !== this.filters.asm) return false;
        if (this.filters.dm !== 'ALL' && row.dm !== this.filters.dm) return false;
        return true;
      });
    },

    render() {
      const data = this.getData();
      const masterList = this.getHierarchyList();
      const filteredList = this.getFilteredList(masterList);

      // Compute filtered KPI metrics
      const totalHeadcount = filteredList.length;
      const totalVacant = filteredList.filter(r => r.status === 'Vacant').length;
      const activeHeadcount = totalHeadcount - totalVacant;
      const overallVacancyRate = totalHeadcount > 0 ? (totalVacant / totalHeadcount * 100).toFixed(1) : '0.0';

      // 1. Render main container structure
      this.container.innerHTML = `
        <div class="sfe-dashboard-container">
          
          <!-- Best Practice Cascading Filter Bar -->
          <div class="sfe-card" style="padding: 16px 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px;">
            <div style="font-size: 0.85rem; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.05em;">
              🔍 ZETA ORGANOGRAM FILTERS
            </div>
            <div class="sfe-filters-bar" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;">
              <div>
                <label style="display:block; font-size:0.75rem; color:#64748b; font-weight:700; margin-bottom:6px;">LINE</label>
                <select id="sf-filter-line" class="filter-select" style="width:100%; padding:8px; background:#ffffff; color:#1e293b; border:1px solid #cbd5e1; border-radius: 4px; border-radius:6px; font-weight:600; cursor:pointer;"></select>
              </div>
              <div>
                <label style="display:block; font-size:0.75rem; color:#64748b; font-weight:700; margin-bottom:6px;">BUSINESS UNIT (BUM)</label>
                <select id="sf-filter-bum" class="filter-select" style="width:100%; padding:8px; background:#ffffff; color:#1e293b; border:1px solid #cbd5e1; border-radius: 4px; border-radius:6px; font-weight:600; cursor:pointer;"></select>
              </div>
              <div>
                <label style="display:block; font-size:0.75rem; color:#64748b; font-weight:700; margin-bottom:6px;">NSM</label>
                <select id="sf-filter-nsm" class="filter-select" style="width:100%; padding:8px; background:#ffffff; color:#1e293b; border:1px solid #cbd5e1; border-radius: 4px; border-radius:6px; font-weight:600; cursor:pointer;"></select>
              </div>
              <div>
                <label style="display:block; font-size:0.75rem; color:#64748b; font-weight:700; margin-bottom:6px;">ASM</label>
                <select id="sf-filter-asm" class="filter-select" style="width:100%; padding:8px; background:#ffffff; color:#1e293b; border:1px solid #cbd5e1; border-radius: 4px; border-radius:6px; font-weight:600; cursor:pointer;"></select>
              </div>
              <div>
                <label style="display:block; font-size:0.75rem; color:#64748b; font-weight:700; margin-bottom:6px;">DISTRICT MANAGER (DM)</label>
                <select id="sf-filter-dm" class="filter-select" style="width:100%; padding:8px; background:#ffffff; color:#1e293b; border:1px solid #cbd5e1; border-radius: 4px; border-radius:6px; font-weight:600; cursor:pointer;"></select>
              </div>
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:12px;">
              <button id="sf-reset-btn" style="background:transparent; border:none; color:#0f4c81; cursor:pointer; font-size:0.85rem; font-weight:700; text-decoration:underline;">Reset Filters</button>
            </div>
          </div>

          <!-- SFE Executive Scorecards -->
          <div class="sfe-grid-3">
            <div class="sfe-kpi-card">
              <div class="sfe-kpi-icon">👥</div>
              <div class="sfe-kpi-info">
                <span class="sfe-kpi-val">${totalHeadcount}</span>
                <span class="sfe-kpi-lbl">Total Planned Positions</span>
              </div>
            </div>
            <div class="sfe-kpi-card">
              <div class="sfe-kpi-icon">✅</div>
              <div class="sfe-kpi-info">
                <span class="sfe-kpi-val">${activeHeadcount}</span>
                <span class="sfe-kpi-lbl">Active Field Force</span>
              </div>
            </div>
            <div class="sfe-kpi-card">
              <div class="sfe-kpi-icon" style="color: #ef4444; background: rgba(239, 68, 68, 0.1);">⚠️</div>
              <div class="sfe-kpi-info">
                <span class="sfe-kpi-val">${totalVacant} <span style="font-size: 0.9rem; font-weight: normal; color: #64748b;">(${overallVacancyRate}%)</span></span>
                <span class="sfe-kpi-lbl">Vacant Positions</span>
              </div>
            </div>
          </div>

          <!-- SFE Tabs Navigation -->
          <div class="sfe-tabs-header">
            <button class="sfe-tab-btn active" data-tab="vacancy">📋 Executive Organogram &amp; Vacancy</button>
            <button class="sfe-tab-btn" data-tab="span">⚙️ Span of Control &amp; Workload</button>
            <button class="sfe-tab-btn" data-tab="tenure">📈 Tenure &amp; stability</button>
          </div>

          <!-- Tab Content Panels -->
          <div id="sfe-panel-vacancy" class="sfe-content-panel active"></div>
          <div id="sfe-panel-span" class="sfe-content-panel"></div>
          <div id="sfe-panel-tenure" class="sfe-content-panel"></div>
        </div>
      `;

      // 2. Populate Dropdowns dynamically (Cascading logic)
      this.populateDropdowns(masterList);

      // 3. Set up event listeners for dropdowns
      const filterSelectors = ['line', 'bum', 'nsm', 'asm', 'dm'];
      filterSelectors.forEach(key => {
        const selectEl = document.getElementById(`sf-filter-${key}`);
        if (selectEl) {
          selectEl.addEventListener('change', (e) => {
            this.filters[key] = e.target.value;
            // Cascading reset: reset lower levels if higher changes
            if (key === 'line') { this.filters.bum = 'ALL'; this.filters.nsm = 'ALL'; this.filters.asm = 'ALL'; this.filters.dm = 'ALL'; }
            else if (key === 'bum') { this.filters.nsm = 'ALL'; this.filters.asm = 'ALL'; this.filters.dm = 'ALL'; }
            else if (key === 'nsm') { this.filters.asm = 'ALL'; this.filters.dm = 'ALL'; }
            else if (key === 'asm') { this.filters.dm = 'ALL'; }
            
            this.render(); // Full re-render to calculate scores, charts, and filter options!
          });
        }
      });

      // Reset button
      const resetBtn = document.getElementById('sf-reset-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          this.resetFilters();
          this.render();
        });
      }

      // Tab navigation listeners
      const tabs = this.container.querySelectorAll('.sfe-tab-btn');
      tabs.forEach(tab => {
        if (tab.dataset.tab === this.activeTab) {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
        }
        tab.addEventListener('click', (e) => {
          tabs.forEach(t => t.classList.remove('active'));
          e.target.classList.add('active');
          this.switchTab(e.target.dataset.tab);
        });
      });

      this.switchTab(this.activeTab);
    },

    // Populate dropdown elements based on available choices in the currently filtered subset
    populateDropdowns(masterList) {
      const keys = ['line', 'bum', 'nsm', 'asm', 'dm'];
      
      keys.forEach(key => {
        const selectEl = document.getElementById(`sf-filter-${key}`);
        if (!selectEl) return;

        // Filter master list using ALL OTHER filters to find available options for THIS dropdown (cascading)
        const subset = masterList.filter(row => {
          for (const k of keys) {
            if (k === key) continue; // Skip active dropdown
            if (this.filters[k] !== 'ALL' && row[k] !== this.filters[k]) return false;
          }
          return true;
        });

        // Get unique sorted values (filtering empty values)
        const uniqueValues = [...new Set(subset.map(row => row[key]))]
          .filter(v => v && v !== 'VACANT')
          .sort();

        // Build HTML options
        selectEl.innerHTML = `<option value="ALL">ALL ${key.toUpperCase()}S</option>` +
          uniqueValues.map(v => `<option value="${v}" ${this.filters[key] === v ? 'selected' : ''}>${v}</option>`).join('');
      });
    },

    switchTab(tabId) {
      this.activeTab = tabId;
      
      // Hide all panels
      const panels = this.container.querySelectorAll('.sfe-content-panel');
      panels.forEach(p => p.classList.remove('active'));

      // Show selected panel
      const targetPanel = this.container.querySelector(`#sfe-panel-${tabId}`);
      if (targetPanel) {
        targetPanel.classList.add('active');
        this.renderPanel(tabId, targetPanel);
      }
    },

    // Helpers to verify if a DM / ASM belongs to the currently active filters
    isDmInFilter(dmName, data) {
      if (!dmName || dmName === 'VACANT') return false;
      const masterList = this.getHierarchyList();
      const match = masterList.find(r => r.dm === dmName);
      if (!match) return false;
      
      if (this.filters.line !== 'ALL' && match.line !== this.filters.line) return false;
      if (this.filters.bum !== 'ALL' && match.bum !== this.filters.bum) return false;
      if (this.filters.nsm !== 'ALL' && match.nsm !== this.filters.nsm) return false;
      if (this.filters.asm !== 'ALL' && match.asm !== this.filters.asm) return false;
      if (this.filters.dm !== 'ALL' && match.dm !== this.filters.dm) return false;
      return true;
    },

    isAsmInFilter(asmName, data) {
      if (!asmName || asmName === 'VACANT') return false;
      const masterList = this.getHierarchyList();
      const matches = masterList.filter(r => r.asm === asmName);
      if (matches.length === 0) return false;
      
      // If ASM matches any record that is within the active filters, return true
      return matches.some(match => {
        if (this.filters.line !== 'ALL' && match.line !== this.filters.line) return false;
        if (this.filters.bum !== 'ALL' && match.bum !== this.filters.bum) return false;
        if (this.filters.nsm !== 'ALL' && match.nsm !== this.filters.nsm) return false;
        if (this.filters.asm !== 'ALL' && match.asm !== this.filters.asm) return false;
        if (this.filters.dm !== 'ALL' && match.dm !== this.filters.dm) return false;
        return true;
      });
    },

    renderPanel(tabId, panelEl) {
      const data = this.getData();
      const masterList = this.getHierarchyList();
      const filteredList = this.getFilteredList(masterList);

      if (tabId === 'vacancy') {
        // Compute filtered vacancy rates by line
        const lineAgg = {};
        filteredList.forEach(r => {
          if (!lineAgg[r.line]) lineAgg[r.line] = { total: 0, vacant: 0 };
          lineAgg[r.line].total++;
          if (r.status === 'Vacant') lineAgg[r.line].vacant++;
        });
        const lineStatsList = Object.entries(lineAgg).map(([lineName, s]) => ({
          line: lineName,
          total: s.total,
          vacant: s.vacant,
          vacancyRate: s.total > 0 ? parseFloat((s.vacant / s.total * 100).toFixed(1)) : 0.0
        })).sort((a, b) => b.vacancyRate - a.vacancyRate);

        // Compute filtered vacancy rates by District Manager
        const dmAgg = {};
        filteredList.forEach(r => {
          if (!r.dm || r.dm === 'VACANT') return;
          if (!dmAgg[r.dm]) dmAgg[r.dm] = { line: r.line, total: 0, vacant: 0 };
          dmAgg[r.dm].total++;
          if (r.status === 'Vacant') dmAgg[r.dm].vacant++;
        });
        const managerVacancyList = Object.entries(dmAgg).map(([dmName, s]) => ({
          manager: dmName,
          line: s.line,
          total: s.total,
          vacant: s.vacant,
          vacancyRate: s.total > 0 ? parseFloat((s.vacant / s.total * 100).toFixed(1)) : 0.0
        })).sort((a, b) => b.vacancyRate - a.vacancyRate).slice(0, 15);

        // Filter vacant positions list
        const filteredVacantPositions = (data.vacantPositions || []).filter(p => {
          if (this.filters.line !== 'ALL' && p.line !== this.filters.line) return false;
          if (this.filters.bum !== 'ALL' && p.bum !== this.filters.bum) return false;
          if (this.filters.nsm !== 'ALL' && p.nsm !== this.filters.nsm) return false;
          if (this.filters.asm !== 'ALL' && p.asm !== this.filters.asm) return false;
          if (this.filters.dm !== 'ALL' && p.dm !== this.filters.dm) return false;
          return true;
        });

        panelEl.innerHTML = `
          <!-- Vacancy breakdown split -->
          <div class="sfe-grid-2">
            <!-- Vacancy by Line -->
            <div class="sfe-card">
              <h3 class="sfe-card-title">Vacancy Rate by Line / Portfolio</h3>
              <div class="sfe-table-scroll" style="max-height: 320px;">
                <table class="sfe-table">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Planned Headcount</th>
                      <th>Vacant Slots</th>
                      <th>Vacancy Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${lineStatsList.length === 0 ? `<tr><td colspan="4" style="text-align:center; color:#64748b;">No matching records</td></tr>` : lineStatsList.map(l => `
                      <tr>
                        <td style="font-weight: 700; color: #1e293b;">${l.line}</td>
                        <td>${l.total}</td>
                        <td style="${l.vacant > 0 ? 'color: #ef4444; font-weight: 700;' : ''}">${l.vacant}</td>
                        <td>
                          <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="flex-grow: 1; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                              <div style="width: ${l.vacancyRate}%; height: 100%; background: #0f4c81; border-radius: 4px;"></div>
                            </div>
                            <span style="font-weight: 700;">${l.vacancyRate}%</span>
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Vacancy by District Manager -->
            <div class="sfe-card">
              <h3 class="sfe-card-title">Top 15 Manager Vacancy Spots</h3>
              <div class="sfe-table-scroll" style="max-height: 320px;">
                <table class="sfe-table">
                  <thead>
                    <tr>
                      <th>District Manager</th>
                      <th>Line</th>
                      <th>Planned Span</th>
                      <th>Vacancies</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${managerVacancyList.length === 0 ? `<tr><td colspan="4" style="text-align:center; color:#64748b;">No matching records</td></tr>` : managerVacancyList.map(m => `
                      <tr>
                        <td style="font-weight: 700; color: #1e293b;">${m.manager}</td>
                        <td>${m.line}</td>
                        <td>${m.total}</td>
                        <td style="color: #ef4444; font-weight: 700;">
                          ${m.vacant} <span class="badge-overload" style="margin-left: 8px;">${m.vacancyRate}%</span>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Bottom: Vacant positions search and list -->
          <div class="sfe-card">
            <div class="sfe-card-title">
              <span>Recruitment Priority Scorecard (Vacant Positions Inspector)</span>
              <span style="font-size: 0.85rem; font-weight: normal; color: #64748b; border-left: none;">
                Total vacant positions in scope: <strong style="color: #ef4444;">${filteredVacantPositions.length}</strong>
              </span>
            </div>
            <div class="search-wrap" style="margin-bottom: 8px;">
              <input type="search" id="sfe-vacant-search" class="ns-modal-search" style="width: 100%; margin: 0; box-sizing: border-box;" 
                placeholder="Search vacant positions by Position ID or Area..." value="${this.searchVacantQuery}" />
            </div>
            <div class="sfe-table-scroll" style="max-height: 380px;">
              <table class="sfe-table" id="sfe-vacant-table">
                <thead>
                  <tr>
                    <th>Position ID</th>
                    <th>Line</th>
                    <th>BUM</th>
                    <th>NSM</th>
                    <th>ASM</th>
                    <th>District Manager</th>
                    <th>Area / District</th>
                  </tr>
                </thead>
                <tbody id="sfe-vacant-tbody">
                  <!-- Rendered dynamically below -->
                </tbody>
              </table>
            </div>
          </div>
        `;

        // Set up vacant search filter
        const searchInput = panelEl.querySelector('#sfe-vacant-search');
        searchInput.addEventListener('input', (e) => {
          this.searchVacantQuery = e.target.value.toLowerCase();
          this.filterVacantTable(filteredVacantPositions, panelEl.querySelector('#sfe-vacant-tbody'));
        });

        this.filterVacantTable(filteredVacantPositions, panelEl.querySelector('#sfe-vacant-tbody'));

      } else if (tabId === 'span') {
        // Filter DM and ASM span arrays
        const filteredDmSpan = (data.spanOfControl.dmSpan || []).filter(dm => this.isDmInFilter(dm.managerName, data));
        const filteredAsmSpan = (data.spanOfControl.asmSpan || []).filter(asm => this.isAsmInFilter(asm.managerName, data));

        // Recompute average span of control for active DMs/ASMs
        let totalDmSpanCount = 0;
        filteredDmSpan.forEach(dm => totalDmSpanCount += dm.spanCount);
        const avgDmSpan = filteredDmSpan.length > 0 ? (totalDmSpanCount / filteredDmSpan.length).toFixed(1) : '0.0';

        let totalAsmSpanCount = 0;
        filteredAsmSpan.forEach(asm => totalAsmSpanCount += asm.spanCount);
        const avgAsmSpan = filteredAsmSpan.length > 0 ? (totalAsmSpanCount / filteredAsmSpan.length).toFixed(1) : '0.0';

        const overstretchedDms = filteredDmSpan.filter(dm => dm.overloaded).length;
        const overstretchedAsms = filteredAsmSpan.filter(asm => asm.overloaded).length;

        // Filter active reps workload list dynamically
        const filteredWorkloadReps = (data.brickWorkload.reps || []).filter(r => {
          if (this.filters.line !== 'ALL' && r.line !== this.filters.line) return false;
          if (this.filters.bum !== 'ALL' && r.bum !== this.filters.bum) return false;
          if (this.filters.nsm !== 'ALL' && r.nsm !== this.filters.nsm) return false;
          if (this.filters.asm !== 'ALL' && r.asm !== this.filters.asm) return false;
          if (this.filters.dm !== 'ALL' && r.dm !== this.filters.dm) return false;
          return true;
        });

        // Compute workload stats dynamically
        let totalBricks = 0;
        let bucketLight = 0;
        let bucketBalanced = 0;
        let bucketDense = 0;
        let bucketOverloaded = 0;

        filteredWorkloadReps.forEach(r => {
          totalBricks += r.bricks;
          if (r.bricks < 5) bucketLight++;
          else if (r.bricks <= 15) bucketBalanced++;
          else if (r.bricks <= 30) bucketDense++;
          else bucketOverloaded++;
        });

        const avgBricks = filteredWorkloadReps.length > 0 
          ? (totalBricks / filteredWorkloadReps.length).toFixed(1) 
          : '0.0';

        // Filter overloaded reps (bricks > 30) from our dynamically filtered workload reps list
        const filteredOverloadedReps = filteredWorkloadReps.filter(r => r.bricks > 30);

        panelEl.innerHTML = `
          <!-- KPI Cards row -->
          <div class="sfe-grid-3">
            <div class="sfe-kpi-card">
              <div class="sfe-kpi-icon">📈</div>
              <div class="sfe-kpi-info">
                <span class="sfe-kpi-val">${avgDmSpan}</span>
                <span class="sfe-kpi-lbl">Avg Reps per DM</span>
              </div>
            </div>
            <div class="sfe-kpi-card">
              <div class="sfe-kpi-icon">📁</div>
              <div class="sfe-kpi-info">
                <span class="sfe-kpi-val">${avgAsmSpan}</span>
                <span class="sfe-kpi-lbl">Avg DMs per ASM</span>
              </div>
            </div>
            <div class="sfe-kpi-card">
              <div class="sfe-kpi-icon" style="color: #f59e0b; background: rgba(245, 158, 11, 0.1);">🚨</div>
              <div class="sfe-kpi-info">
                <span class="sfe-kpi-val">${overstretchedDms + overstretchedAsms} <span style="font-size: 0.9rem; font-weight: normal; color: #64748b;">(${overstretchedDms} DMs / ${overstretchedAsms} ASMs)</span></span>
                <span class="sfe-kpi-lbl">Overstretched Managers</span>
              </div>
            </div>
          </div>

          <!-- Split layout: Brick workload left, Span of control table right -->
          <div class="sfe-grid-2-1">
            <!-- Span of Control Inspector -->
            <div class="sfe-card">
              <h3 class="sfe-card-title">Manager Span of Control Inspector</h3>
              <div class="search-wrap" style="margin-bottom: 8px;">
                <input type="search" id="sfe-span-search" class="ns-modal-search" style="width: 100%; margin: 0; box-sizing: border-box;" 
                  placeholder="Search managers by name..." value="${this.searchSpanQuery}" />
              </div>
              <div class="sfe-table-scroll" style="max-height: 420px;">
                <table class="sfe-table">
                  <thead>
                    <tr>
                      <th>Manager Name</th>
                      <th>Role</th>
                      <th>Line</th>
                      <th>Planned Headcount</th>
                      <th>Active Span</th>
                      <th>Vacancies</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody id="sfe-span-tbody">
                    <!-- Rendered dynamically below -->
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Brick Workload & Overloaded Reps -->
            <div class="sfe-card">
              <h3 class="sfe-card-title">Brick Workload Distribution</h3>
              
              <!-- Workload Progress Buckets -->
              <div style="display: flex; flex-direction: column; gap: 14px; background: #ffffff; padding: 18px; border-radius: 4px; border: 1px solid #e2e8f0;">
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                  <span>Average Bricks / Rep in Scope:</span>
                  <strong style="color: #0f4c81;">${avgBricks} Bricks</strong>
                </div>
                
                <!-- Buckets Breakdown (representing general distributions) -->
                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
                  <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                    <span>Light (&lt;5 bricks):</span>
                    <strong style="color: #64748b;">${bucketLight} reps</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                    <span>Balanced (5-15 bricks):</span>
                    <strong style="color: #10b981;">${bucketBalanced} reps</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                    <span>Dense (16-30 bricks):</span>
                    <strong style="color: #f59e0b;">${bucketDense} reps</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                    <span>Overloaded (&gt;30 bricks):</span>
                    <strong style="color: #ef4444;">${bucketOverloaded} reps</strong>
                  </div>
                </div>
              </div>

              <!-- Overloaded Reps list -->
              <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
                <h4 style="margin: 0 0 6px 0; font-size: 0.95rem; color: #1e293b;">Overloaded Reps Spotlight (&gt;30 Bricks)</h4>
                <div class="sfe-list" style="max-height: 220px;">
                  ${filteredOverloadedReps.length === 0 ? `
                    <div style="padding: 12px; text-align: center; color: #64748b; font-size: 0.85rem;">
                      No reps exceed the 30-brick guidelines in this scope.
                    </div>
                  ` : filteredOverloadedReps.map(r => `
                    <div class="sfe-list-item sfe-overloaded-item" style="padding: 10px 14px; cursor: pointer; transition: background 0.15s ease;" 
                      onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'" data-rep="${r.rep}">
                      <div class="sfe-item-info">
                        <span class="sfe-item-name" style="font-size: 0.9rem; font-weight: 600; color: #0f4c81;">${r.rep}</span>
                        <span class="sfe-item-sub">${r.line} - DM: ${r.dm}</span>
                      </div>
                      <span class="badge-overload">${r.bricks} Bricks</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
        `;

        // Set up span search filter
        const searchInput = panelEl.querySelector('#sfe-span-search');
        searchInput.addEventListener('input', (e) => {
          this.searchSpanQuery = e.target.value.toLowerCase();
          this.filterSpanTable({ dmSpan: filteredDmSpan, asmSpan: filteredAsmSpan }, panelEl.querySelector('#sfe-span-tbody'));
        });

        this.filterSpanTable({ dmSpan: filteredDmSpan, asmSpan: filteredAsmSpan }, panelEl.querySelector('#sfe-span-tbody'));

        // Add click handlers for overloaded reps
        panelEl.querySelectorAll('.sfe-overloaded-item').forEach(item => {
          item.addEventListener('click', () => {
            const repName = item.dataset.rep;
            const repInfo = filteredOverloadedReps.find(x => x.rep === repName);
            if (repInfo) {
              this.openRepBricksModal(repInfo);
            }
          });
        });

      } else if (tabId === 'tenure') {
        const tenure = data.tenureStability;
        
        // Filter training alerts list
        const filteredTrainingAlerts = (tenure.trainingAlerts || []).filter(a => {
          // Team corresponds to the DM name
          return this.isDmInFilter(a.team, data);
        });

        // Filter lifecycle counts
        // Standard counts can be shown overall or mapped
        const totalLifecycle = tenure.lifecycleCounts.probation + tenure.lifecycleCounts.nonProbation;
        const probationPct = totalLifecycle > 0 ? (tenure.lifecycleCounts.probation / totalLifecycle * 100).toFixed(1) : '0.0';

        panelEl.innerHTML = `
          <!-- KPI Cards row -->
          <div class="sfe-grid-2">
            <div class="sfe-grid-2" style="gap: 16px;">
              <div class="sfe-kpi-card">
                <div class="sfe-kpi-icon">⏳</div>
                <div class="sfe-kpi-info">
                  <span class="sfe-kpi-val">${tenure.lifecycleCounts.probation} <span style="font-size: 0.9rem; font-weight: normal; color: #64748b;">(${probationPct}%)</span></span>
                  <span class="sfe-kpi-lbl">Reps under Probation</span>
                </div>
              </div>
              <div class="sfe-kpi-card">
                <div class="sfe-kpi-icon">🎓</div>
                <div class="sfe-kpi-info">
                  <span class="sfe-kpi-val">${tenure.lifecycleCounts.nonProbation}</span>
                  <span class="sfe-kpi-lbl">Confirmed Reps</span>
                </div>
              </div>
              <div class="sfe-kpi-card">
                <div class="sfe-kpi-icon">📅</div>
                <div class="sfe-kpi-info">
                  <span class="sfe-kpi-val">${tenure.averageRepTenureMonths} m</span>
                  <span class="sfe-kpi-lbl">Avg Rep Tenure</span>
                </div>
              </div>
              <div class="sfe-kpi-card">
                <div class="sfe-kpi-icon" style="color: #0f4c81; background: rgba(78, 128, 247, 0.1);">⚡</div>
                <div class="sfe-kpi-info">
                  <span class="sfe-kpi-val">${tenure.currentRampUpRate}%</span>
                  <span class="sfe-kpi-lbl">Ramp-up Ratio (last 6m)</span>
                </div>
              </div>
            </div>

            <!-- Training Alerts & Ramp up spotlights -->
            <div class="sfe-card" style="padding: 20px;">
              <h3 class="sfe-card-title">Training Needs Alert Tracker</h3>
              <div class="training-alerts-list" style="max-height: 220px;">
                ${filteredTrainingAlerts.length === 0 ? `
                  <div style="padding: 20px; text-align: center; color: #64748b; font-size: 0.85rem;">
                    All manager team probation rates are within the 15% guideline threshold.
                  </div>
                ` : filteredTrainingAlerts.map(a => `
                  <div class="sfe-list-item">
                    <div class="sfe-item-info">
                      <span class="sfe-item-name">${a.team}</span>
                      <span class="sfe-item-sub">Active span: ${a.activeReps} reps | Probation: ${a.probationReps} reps</span>
                    </div>
                    <span class="${a.alertLevel === 'High' ? 'badge-overload' : 'badge-probation'}">${a.probationRate}% Probation</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- Bottom: Monthly Historical Turnover Chart Trend (Probation vs Non-Probation) -->
          <div class="sfe-card">
            <h3 class="sfe-card-title">Historical Monthly Attrition Rate (Probation vs. Non-Probation)</h3>
            <div class="chart-container" style="position: relative; height: 320px; width: 100%;">
              <canvas id="sfe-turnover-chart"></canvas>
            </div>
          </div>
        `;

        // Render monthly turnover rate chart
        this.renderTurnoverChart(tenure);
      }
    },

    filterVacantTable(list, tbodyEl) {
      if (!tbodyEl) return;
      
      const filtered = list.filter(p => {
        const query = this.searchVacantQuery;
        if (!query) return true;
        return (
          p.position.toLowerCase().includes(query) ||
          p.line.toLowerCase().includes(query) ||
          p.bum.toLowerCase().includes(query) ||
          p.nsm.toLowerCase().includes(query) ||
          p.asm.toLowerCase().includes(query) ||
          p.dm.toLowerCase().includes(query) ||
          p.area.toLowerCase().includes(query) ||
          p.district.toLowerCase().includes(query)
        );
      });

      if (filtered.length === 0) {
        tbodyEl.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; color: #64748b; padding: 24px;">
              No vacant positions found matching "${this.searchVacantQuery}".
            </td>
          </tr>
        `;
        return;
      }

      tbodyEl.innerHTML = filtered.map(p => `
        <tr>
          <td style="font-weight: 700; color: #1e293b;">
            <span class="badge-overload" style="margin-right: 8px;">VACANT</span> ${p.position}
          </td>
          <td>${p.line}</td>
          <td>${p.bum || '-'}</td>
          <td>${p.nsm || '-'}</td>
          <td>${p.asm || '-'}</td>
          <td>${p.dm || '-'}</td>
          <td>
            <span style="font-size: 0.8rem; color: #64748b;">${p.area || '-'} / ${p.district || '-'}</span>
          </td>
        </tr>
      `).join('');
    },

    filterSpanTable(spanData, tbodyEl) {
      if (!tbodyEl) return;

      const dms = (spanData.dmSpan || []).map(dm => ({ ...dm, role: 'DM' }));
      const asms = (spanData.asmSpan || []).map(asm => ({ ...asm, role: 'ASM' }));
      const allManagers = [...asms, ...dms];

      const filtered = allManagers.filter(m => {
        const query = this.searchSpanQuery;
        if (!query) return true;
        return (
          m.managerName.toLowerCase().includes(query) ||
          m.line.toLowerCase().includes(query) ||
          m.role.toLowerCase().includes(query)
        );
      });

      if (filtered.length === 0) {
        tbodyEl.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; color: #64748b; padding: 24px;">
              No managers found matching "${this.searchSpanQuery}".
            </td>
          </tr>
        `;
        return;
      }

      tbodyEl.innerHTML = filtered.map(m => `
        <tr>
          <td style="font-weight: 700; color: #1e293b;">${m.managerName}</td>
          <td>
            <span style="font-size: 0.8rem; font-weight: 700; background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">
              ${m.role}
            </span>
          </td>
          <td>${m.line}</td>
          <td style="font-weight: 600; color: #475569;">
            ${m.plannedCount || 0} ${m.role === 'DM' ? 'Reps' : 'DMs'}
          </td>
          <td style="font-weight: 700; ${m.overloaded ? 'color: #ef4444;' : 'color: #0f4c81;'}">
            ${m.spanCount} ${m.role === 'DM' ? 'Reps' : 'DMs'}
          </td>
          <td>
            <span style="${m.vacantCount > 0 ? 'color: #ef4444; font-weight: 700;' : 'color: #64748b;'}">
              ${m.vacantCount || 0} ${m.role === 'DM' ? 'Reps' : 'DMs'}
            </span>
          </td>
          <td>
            ${m.overloaded ? 
              `<span class="badge-overload">🚨 Overstretched (&gt;${m.role === 'DM' ? '8' : '4'})</span>` : 
              `<span class="badge-active">Within Guidelines</span>`
            }
          </td>
        </tr>
      `).join('');
    },

    openRepBricksModal(repInfo) {
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

      titleEl.textContent = `Bricks Covered by ${repInfo.rep}`;
      badge.textContent   = repInfo.brickList ? repInfo.brickList.length : 0;
      searchEl.value      = "";
      prevBtn.disabled    = true;
      nextBtn.disabled    = true;
      pageLabel.textContent = "";
      
      const list = repInfo.brickList || [];
      info.textContent    = `${list.length} brick${list.length !== 1 ? "s" : ""} assigned to this position`;

      const COLS = [
        { key: "brick",    label: "Brick ID / Name", width: "25%" },
        { key: "position", label: "Position",        width: "25%" },
        { key: "area",     label: "Area",            width: "25%" },
        { key: "district", label: "District",        width: "25%" }
      ];

      function renderBodyRows(filteredRows) {
        if (!filteredRows.length) {
          body.innerHTML = `<div style="padding:32px;text-align:center;color:#94A3B8;">No bricks match search.</div>`;
          return;
        }
        const colgroup = COLS.map((c) => `<col style="width:${c.width}">`).join("");
        const thead    = COLS.map((c) => `<th>${c.label}</th>`).join("");
        const tbody = filteredRows.map((r) =>
          `<tr>${COLS.map((c) =>
            `<td>${r[c.key] || ''}</td>`
          ).join("")}</tr>`
        ).join("");
        
        body.innerHTML = `<table class="data-table">
          <colgroup>${colgroup}</colgroup>
          <thead><tr>${thead}</tr></thead>
          <tbody>${tbody}</tbody>
        </table>`;
      }

      let filtered = list;
      renderBodyRows(filtered);
      overlay.classList.add("open");
      searchEl.focus();

      // Replace search handler
      const newSearch = searchEl.cloneNode(true);
      newSearch.placeholder = "Search by brick, area, or district...";
      searchEl.parentNode.replaceChild(newSearch, searchEl);
      newSearch.addEventListener("input", (e) => {
        const q = e.target.value.toLowerCase().trim();
        filtered = q
          ? list.filter((r) => 
              ["brick", "position", "area", "district"].some(
                (k) => String(r[k] ?? "").toLowerCase().includes(q)
              )
            )
          : list;
        renderBodyRows(filtered);
      });

      // Replace export handler
      const newExport = exportBtn.cloneNode(true);
      exportBtn.parentNode.replaceChild(newExport, exportBtn);
      newExport.addEventListener("click", () => {
        if (typeof Exporter !== "undefined") {
          Exporter.tableToExcel(COLS, filtered, `bricks_${repInfo.rep.replace(/\s+/g, '_')}`);
        }
      });
    },

    renderTurnoverChart(tenure) {
      const ctx = document.getElementById('sfe-turnover-chart');
      if (!ctx) return;

      // Extract data lists
      const periods = tenure.probationTurnover.map(t => t.period);
      const probationRates = tenure.probationTurnover.map(t => t.rate);
      const nonProbationRates = tenure.nonProbationTurnover.map(t => t.rate);

      new Chart(ctx, {
        type: 'line',
        data: {
          labels: periods,
          datasets: [
            {
              label: 'Probation Attrition Rate (%)',
              data: probationRates,
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              borderWidth: 3,
              tension: 0.25,
              fill: true,
              pointBackgroundColor: '#f59e0b',
              pointRadius: 4
            },
            {
              label: 'Non-Probation (Confirmed) Attrition Rate (%)',
              data: nonProbationRates,
              borderColor: '#4e80f7',
              backgroundColor: 'rgba(78, 128, 247, 0.1)',
              borderWidth: 3,
              tension: 0.25,
              fill: true,
              pointBackgroundColor: '#4e80f7',
              pointRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: {
                color: '#8a94a6',
                font: {
                  family: 'Outfit',
                  weight: '600'
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function (context) {
                  return ` Attrition: ${context.raw}%`;
                }
              }
            }
          },
          scales: {
            y: {
              grid: {
                color: '#232845'
              },
              ticks: {
                color: '#8a94a6',
                font: {
                  family: 'Outfit'
                },
                callback: function (val) {
                  return val + '%';
                }
              }
            },
            x: {
              grid: {
                display: false
              },
              ticks: {
                color: '#8a94a6',
                font: {
                  family: 'Outfit'
                }
              }
            }
          }
        }
      });
    }
  };

  // Expose to window
  window.SFEDashboard = SFE;
})();
