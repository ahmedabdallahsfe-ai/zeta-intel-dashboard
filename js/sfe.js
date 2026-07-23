/**
 * js/sfe.js
 * SFE & Organogram Dashboard Module
 * Handles calculations, templates, tab routing, search filters, and charts for SFE views.
 */

(function () {
  const SFE = {
    container: null,
    activeTab: 'vacancy', // 'vacancy', 'span', 'tenure'
    searchVacantQuery: '',
    searchSpanQuery: '',

    init(containerId) {
      this.container = document.getElementById(containerId);
      if (!this.container) return;

      // Add 'sfe-mode' class to body to dynamically hide global filters
      document.body.classList.add('sfe-mode');

      this.renderLayout();
      this.switchTab(this.activeTab);
    },

    destroy() {
      document.body.classList.remove('sfe-mode');
    },

    getData() {
      // Check if organogram cache is loaded
      if (window.DASHBOARD_ORGANOGRAM) {
        return window.DASHBOARD_ORGANOGRAM;
      }
      // Return fallback empty data structure if missing
      return {
        vacancyByLine: [],
        vacancyByManager: [],
        vacantPositions: [],
        spanOfControl: { dmSpan: [], asmSpan: [], averageDmSpan: 0, averageAsmSpan: 0 },
        brickWorkload: { averageBricksPerRep: 0, buckets: { light: 0, balanced: 0, dense: 0, overloaded: 0 }, overloadedReps: [] },
        tenureStability: { probationTurnover: [], nonProbationTurnover: [], currentRampUpRate: 0, averageRepTenureMonths: 0, lifecycleCounts: { probation: 0, nonProbation: 0 }, trainingAlerts: [] }
      };
    },

    renderLayout() {
      const data = this.getData();
      
      // Calculate overall vacancy metrics
      let totalHeadcount = 0;
      let totalVacant = 0;
      data.vacancyByLine.forEach(l => {
        totalHeadcount += l.total;
        totalVacant += l.vacant;
      });
      const activeHeadcount = totalHeadcount - totalVacant;
      const overallVacancyRate = totalHeadcount > 0 ? (totalVacant / totalHeadcount * 100).toFixed(1) : '0.0';

      this.container.innerHTML = `
        <div class="sfe-dashboard-container">
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
                <span class="sfe-kpi-val">${totalVacant} <span style="font-size: 0.9rem; font-weight: normal; color: #8a94a6;">(${overallVacancyRate}%)</span></span>
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

      // Set up tab click listeners
      const tabs = this.container.querySelectorAll('.sfe-tab-btn');
      tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
          tabs.forEach(t => t.classList.remove('active'));
          e.target.classList.add('active');
          this.switchTab(e.target.dataset.tab);
        });
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

    renderPanel(tabId, panelEl) {
      const data = this.getData();

      if (tabId === 'vacancy') {
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
                    ${data.vacancyByLine.map(l => `
                      <tr>
                        <td style="font-weight: 700; color: #ffffff;">${l.line}</td>
                        <td>${l.total}</td>
                        <td style="${l.vacant > 0 ? 'color: #ef4444; font-weight: 700;' : ''}">${l.vacant}</td>
                        <td>
                          <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="flex-grow: 1; height: 8px; background: #232845; border-radius: 4px; overflow: hidden;">
                              <div style="width: ${l.vacancyRate}%; height: 100%; background: #4e80f7; border-radius: 4px;"></div>
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
                    ${data.vacancyByManager.map(m => `
                      <tr>
                        <td style="font-weight: 700; color: #ffffff;">${m.manager}</td>
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
              <span style="font-size: 0.85rem; font-weight: normal; color: #8a94a6; border-left: none;">
                Total vacant positions: <strong style="color: #ef4444;">${data.vacantPositions.length}</strong>
              </span>
            </div>
            <div class="search-wrap" style="margin-bottom: 8px;">
              <input type="search" id="sfe-vacant-search" class="ns-modal-search" style="width: 100%; margin: 0; box-sizing: border-box;" 
                placeholder="Search vacant positions by Line, BUM, NSM, ASM, DM or Area..." value="${this.searchVacantQuery}" />
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
          this.filterVacantTable(data.vacantPositions, panelEl.querySelector('#sfe-vacant-tbody'));
        });

        this.filterVacantTable(data.vacantPositions, panelEl.querySelector('#sfe-vacant-tbody'));

      } else if (tabId === 'span') {
        // Calculate overstretched DMs/ASMs
        const overstretchedDms = data.spanOfControl.dmSpan.filter(dm => dm.overloaded).length;
        const overstretchedAsms = data.spanOfControl.asmSpan.filter(asm => asm.overloaded).length;

        panelEl.innerHTML = `
          <!-- KPI Cards row -->
          <div class="sfe-grid-3">
            <div class="sfe-kpi-card">
              <div class="sfe-kpi-icon">📈</div>
              <div class="sfe-kpi-info">
                <span class="sfe-kpi-val">${data.spanOfControl.averageDmSpan}</span>
                <span class="sfe-kpi-lbl">Avg Reps per DM</span>
              </div>
            </div>
            <div class="sfe-kpi-card">
              <div class="sfe-kpi-icon">📁</div>
              <div class="sfe-kpi-info">
                <span class="sfe-kpi-val">${data.spanOfControl.averageAsmSpan}</span>
                <span class="sfe-kpi-lbl">Avg DMs per ASM</span>
              </div>
            </div>
            <div class="sfe-kpi-card">
              <div class="sfe-kpi-icon" style="color: #f59e0b; background: rgba(245, 158, 11, 0.1);">🚨</div>
              <div class="sfe-kpi-info">
                <span class="sfe-kpi-val">${overstretchedDms + overstretchedAsms} <span style="font-size: 0.9rem; font-weight: normal; color: #8a94a6;">(${overstretchedDms} DMs / ${overstretchedAsms} ASMs)</span></span>
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
                  placeholder="Search managers by name or line..." value="${this.searchSpanQuery}" />
              </div>
              <div class="sfe-table-scroll" style="max-height: 420px;">
                <table class="sfe-table">
                  <thead>
                    <tr>
                      <th>Manager Name</th>
                      <th>Role</th>
                      <th>Line</th>
                      <th>Active Span</th>
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
              <div style="display: flex; flex-direction: column; gap: 14px; background: #1a1e38; padding: 18px; border-radius: 10px; border: 1px solid #282f54;">
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                  <span>Average Bricks / Rep:</span>
                  <strong style="color: #4e80f7;">${data.brickWorkload.averageBricksPerRep} Bricks</strong>
                </div>
                
                <!-- Buckets Breakdown -->
                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
                  <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                    <span>Light (&lt;5 bricks):</span>
                    <strong style="color: #8a94a6;">${data.brickWorkload.buckets.light} reps</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                    <span>Balanced (5-15 bricks):</span>
                    <strong style="color: #10b981;">${data.brickWorkload.buckets.balanced} reps</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                    <span>Dense (16-30 bricks):</span>
                    <strong style="color: #f59e0b;">${data.brickWorkload.buckets.dense} reps</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                    <span>Overloaded (&gt;30 bricks):</span>
                    <strong style="color: #ef4444;">${data.brickWorkload.buckets.overloaded} reps</strong>
                  </div>
                </div>
              </div>

              <!-- Overloaded Reps list -->
              <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
                <h4 style="margin: 0 0 6px 0; font-size: 0.95rem; color: #ffffff;">Overloaded Reps Spotlight (&gt;30 Bricks)</h4>
                <div class="sfe-list" style="max-height: 220px;">
                  ${data.brickWorkload.overloadedReps.length === 0 ? `
                    <div style="padding: 12px; text-align: center; color: #8a94a6; font-size: 0.85rem;">
                      No reps exceed the 30-brick guidelines.
                    </div>
                  ` : data.brickWorkload.overloadedReps.map(r => `
                    <div class="sfe-list-item" style="padding: 10px 14px;">
                      <div class="sfe-item-info">
                        <span class="sfe-item-name" style="font-size: 0.9rem;">${r.rep}</span>
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
          this.filterSpanTable(data.spanOfControl, panelEl.querySelector('#sfe-span-tbody'));
        });

        this.filterSpanTable(data.spanOfControl, panelEl.querySelector('#sfe-span-tbody'));

      } else if (tabId === 'tenure') {
        const tenure = data.tenureStability;
        const totalLifecycle = tenure.lifecycleCounts.probation + tenure.lifecycleCounts.nonProbation;
        const probationPct = totalLifecycle > 0 ? (tenure.lifecycleCounts.probation / totalLifecycle * 100).toFixed(1) : '0.0';

        panelEl.innerHTML = `
          <!-- KPI Cards row -->
          <div class="sfe-grid-2">
            <div class="sfe-grid-2" style="gap: 16px;">
              <div class="sfe-kpi-card">
                <div class="sfe-kpi-icon">⏳</div>
                <div class="sfe-kpi-info">
                  <span class="sfe-kpi-val">${tenure.lifecycleCounts.probation} <span style="font-size: 0.9rem; font-weight: normal; color: #8a94a6;">(${probationPct}%)</span></span>
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
                <div class="sfe-kpi-icon" style="color: #4e80f7; background: rgba(78, 128, 247, 0.1);">⚡</div>
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
                ${tenure.trainingAlerts.length === 0 ? `
                  <div style="padding: 20px; text-align: center; color: #8a94a6; font-size: 0.85rem;">
                    All manager team probation rates are within the 15% guideline threshold.
                  </div>
                ` : tenure.trainingAlerts.map(a => `
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
            <td colspan="7" style="text-align: center; color: #8a94a6; padding: 24px;">
              No vacant positions found matching "${this.searchVacantQuery}".
            </td>
          </tr>
        `;
        return;
      }

      tbodyEl.innerHTML = filtered.map(p => `
        <tr>
          <td style="font-weight: 700; color: #ffffff;">
            <span class="badge-overload" style="margin-right: 8px;">VACANT</span> ${p.position}
          </td>
          <td>${p.line}</td>
          <td>${p.bum || '-'}</td>
          <td>${p.nsm || '-'}</td>
          <td>${p.asm || '-'}</td>
          <td>${p.dm || '-'}</td>
          <td>
            <span style="font-size: 0.8rem; color: #8a94a6;">${p.area || '-'} / ${p.district || '-'}</span>
          </td>
        </tr>
      `).join('');
    },

    filterSpanTable(spanData, tbodyEl) {
      if (!tbodyEl) return;

      const dms = spanData.dmSpan.map(dm => ({ ...dm, role: 'DM' }));
      const asms = spanData.asmSpan.map(asm => ({ ...asm, role: 'ASM' }));
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
            <td colspan="5" style="text-align: center; color: #8a94a6; padding: 24px;">
              No managers found matching "${this.searchSpanQuery}".
            </td>
          </tr>
        `;
        return;
      }

      tbodyEl.innerHTML = filtered.map(m => `
        <tr>
          <td style="font-weight: 700; color: #ffffff;">${m.managerName}</td>
          <td>
            <span style="font-size: 0.8rem; font-weight: 700; background: #232845; padding: 2px 6px; border-radius: 4px;">
              ${m.role}
            </span>
          </td>
          <td>${m.line}</td>
          <td style="font-weight: 700; ${m.overloaded ? 'color: #ef4444;' : ''}">
            ${m.spanCount} ${m.role === 'DM' ? 'Reps' : 'DMs'}
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
