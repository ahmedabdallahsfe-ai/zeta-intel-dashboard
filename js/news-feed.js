/**
 * js/news-feed.js
 * =====================================================================
 * ZETA EXTERNAL MARKET INTELLIGENCE ENGINE — FRONTEND WORKSPACE
 *
 * Reads window.ZETA_NEWS_FEED from cache/news_latest.data.js.
 * 100% offline-compatible; 0 CORS requests; 0 server dependencies.
 * =====================================================================
 */

(function (global) {
  "use strict";

  var STATE = {
    quickView: "All",
    taFilter: "All",
    buFilter: "All",
    impactFilter: "All",
    geoFilter: "All",
    typeFilter: "All",
    searchQuery: "",
    containerId: null
  };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function getFeedData() {
    return global.ZETA_NEWS_FEED || {
      meta: {
        syncLabel: "Offline Snapshot",
        totalArticles: 0,
        criticalCount: 0,
        highImpactCount: 0,
        buDistribution: {},
        impactDistribution: {},
        geoDistribution: {},
        taDistribution: {},
        typeDistribution: {}
      },
      articles: []
    };
  }

  function formatDate(isoStr) {
    if (!isoStr) return "";
    try {
      var d = new Date(isoStr);
      var now = new Date();
      var diffMs = now - d;
      var diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      var diffDays = Math.floor(diffHours / 24);

      if (diffHours >= 0 && diffHours < 1) return "Just now";
      if (diffHours >= 1 && diffHours < 24) return diffHours + "h ago";
      if (diffDays === 1) return "Yesterday";
      if (diffDays > 1 && diffDays < 7) return diffDays + " days ago";

      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch (e) {
      return isoStr.substring(0, 10);
    }
  }

  function filterArticles(articles) {
    var query = STATE.searchQuery.trim().toLowerCase();

    return articles.filter(function (item) {
      // 1. Quick View Preset Filters
      if (STATE.quickView === "Critical") {
        if (item.impact !== "CRITICAL" && item.importance < 5) return false;
      } else if (STATE.quickView === "Signals") {
        if (item.impact !== "HIGH" && item.importance < 4) return false;
      } else if (STATE.quickView === "Egypt") {
        if (item.geography !== "Egypt") return false;
      } else if (STATE.quickView === "Incretins") {
        if (item.primary_therapeutic_area !== "Obesity & Incretin Therapies" &&
            !(item.secondary_therapeutic_areas && item.secondary_therapeutic_areas.indexOf("Obesity & Incretin Therapies") >= 0)) {
          return false;
        }
      } else if (STATE.quickView === "Competitors") {
        if (!item.companies || !item.companies.length) return false;
      } else if (STATE.quickView === "Regulatory") {
        if (item.primary_therapeutic_area !== "Regulatory & Egypt Healthcare" &&
            !(item.intelligence_types && item.intelligence_types.indexOf("Regulatory") >= 0)) {
          return false;
        }
      }

      // 2. Therapeutic Area Filter
      if (STATE.taFilter !== "All") {
        var matchTA = item.primary_therapeutic_area === STATE.taFilter ||
                      (item.secondary_therapeutic_areas && item.secondary_therapeutic_areas.indexOf(STATE.taFilter) >= 0);
        if (!matchTA) return false;
      }

      // 3. BU Filter
      if (STATE.buFilter !== "All") {
        if (!item.business_units || item.business_units.indexOf(STATE.buFilter) < 0) {
          return false;
        }
      }

      // 4. Impact Filter
      if (STATE.impactFilter !== "All") {
        if (item.impact !== STATE.impactFilter) {
          return false;
        }
      }

      // 5. Geography Filter
      if (STATE.geoFilter !== "All") {
        if (item.geography !== STATE.geoFilter) {
          return false;
        }
      }

      // 6. Intelligence Type Filter
      if (STATE.typeFilter !== "All") {
        if (!item.intelligence_types || item.intelligence_types.indexOf(STATE.typeFilter) < 0) {
          return false;
        }
      }

      // 7. Search Query
      if (query) {
        var matchTitle = item.title && item.title.toLowerCase().indexOf(query) >= 0;
        var matchSummary = item.summary && item.summary.toLowerCase().indexOf(query) >= 0;
        var matchSource = item.source && item.source.toLowerCase().indexOf(query) >= 0;
        var matchWhy = item.why_it_matters && item.why_it_matters.toLowerCase().indexOf(query) >= 0;
        var matchMol = item.molecules && item.molecules.some(function (m) { return m.toLowerCase().indexOf(query) >= 0; });
        var matchComp = item.companies && item.companies.some(function (c) { return c.toLowerCase().indexOf(query) >= 0; });
        var matchBrand = item.brands && item.brands.some(function (b) { return b.toLowerCase().indexOf(query) >= 0; });
        var matchTag = item.tags && item.tags.some(function (t) { return t.toLowerCase().indexOf(query) >= 0; });

        if (!matchTitle && !matchSummary && !matchSource && !matchWhy && !matchMol && !matchComp && !matchBrand && !matchTag) {
          return false;
        }
      }

      return true;
    });
  }

  function renderMetricsHtml(meta, filteredCount) {
    var buDist = meta.buDistribution || {};
    var impactDist = meta.impactDistribution || {};
    var geoDist = meta.geoDistribution || {};

    return '<div class="nws-metrics-grid">' +
      '<div class="nws-metric-card" style="border-top: 3.5px solid #BE123C;">' +
        '<div class="nws-metric-header">' +
          '<span class="nws-metric-title">Critical Signals</span>' +
          '<span class="nws-metric-icon">🚨</span>' +
        '</div>' +
        '<div class="nws-metric-value" style="color:#BE123C;">' + (impactDist.CRITICAL || meta.criticalCount || 0) + '</div>' +
        '<div class="nws-metric-sub">Immediate commercial / regulatory priority</div>' +
      '</div>' +
      '<div class="nws-metric-card" style="border-top: 3.5px solid #B45309;">' +
        '<div class="nws-metric-header">' +
          '<span class="nws-metric-title">High-Impact Updates</span>' +
          '<span class="nws-metric-icon">⚡</span>' +
        '</div>' +
        '<div class="nws-metric-value" style="color:#B45309;">' + (impactDist.HIGH || meta.highImpactCount || 0) + '</div>' +
        '<div class="nws-metric-sub">Pricing, launches & competitor moves</div>' +
      '</div>' +
      '<div class="nws-metric-card" style="border-top: 3.5px solid #0F4C81;">' +
        '<div class="nws-metric-header">' +
          '<span class="nws-metric-title">Active Signals</span>' +
          '<span class="nws-metric-icon">📊</span>' +
        '</div>' +
        '<div class="nws-metric-value" style="color:#0F4C81;">' + (filteredCount) + '</div>' +
        '<div class="nws-metric-sub">' + (meta.totalArticles || 0) + ' synchronized in offline cache</div>' +
      '</div>' +
      '<div class="nws-metric-card" style="border-top: 3.5px solid #059669;">' +
        '<div class="nws-metric-header">' +
          '<span class="nws-metric-title">Egypt & Portfolio</span>' +
          '<span class="nws-metric-icon">🇪🇬</span>' +
        '</div>' +
        '<div class="nws-metric-value" style="font-size:15px;line-height:1.4;font-weight:700;color:#1E293B;">' +
          'Egypt: <strong style="color:#059669;">' + (geoDist.Egypt || 0) + '</strong> · MENA: ' + (geoDist.MENA || 0) + '<br>' +
          '<span style="font-size:11.5px;color:#64748B;font-weight:600;">DIAB ' + (buDist.DIAB || 0) + ' · GIT ' + (buDist.GIT || 0) + ' · Clust ' + (buDist.Cluster || 0) + ' · CHC ' + (buDist.CHC || 0) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderCardHtml(item) {
    var impactClass = "nws-card-moderate";
    var impactLabel = "MARKET UPDATE";
    var impactBadgeClass = "nws-impact-2";

    if (item.impact === "CRITICAL" || item.importance >= 5) {
      impactClass = "nws-card-critical";
      impactLabel = "CRITICAL ALERT";
      impactBadgeClass = "nws-impact-5";
    } else if (item.impact === "HIGH" || item.importance === 4) {
      impactClass = "nws-card-high";
      impactLabel = "HIGH-IMPACT SIGNAL";
      impactBadgeClass = "nws-impact-4";
    } else if (item.impact === "MEDIUM" || item.importance === 3) {
      impactClass = "nws-card-medium";
      impactLabel = "MARKET SIGNAL";
      impactBadgeClass = "nws-impact-3";
    }

    var buBadges = (item.business_units || []).map(function (bu) {
      return '<span class="nws-badge-bu">' + esc(bu) + '</span>';
    }).join("");

    var chipsHtml = "";
    if (item.molecules && item.molecules.length) {
      chipsHtml += item.molecules.map(function (m) { return '<span class="nws-chip" style="background:#EFF6FF;color:#1E40AF;border:1px solid #DBEAFE;">🧪 ' + esc(m) + '</span>'; }).join("");
    }
    if (item.mechanisms && item.mechanisms.length) {
      chipsHtml += item.mechanisms.map(function (mech) { return '<span class="nws-chip" style="background:#F5F3FF;color:#6D28D9;border:1px solid #EDE9FE;">🧬 ' + esc(mech) + '</span>'; }).join("");
    }
    if (item.companies && item.companies.length) {
      chipsHtml += item.companies.map(function (c) { return '<span class="nws-chip" style="background:#FEF2F2;color:#991B1B;border:1px solid #FEE2E2;">🏢 ' + esc(c) + '</span>'; }).join("");
    }
    if (item.brands && item.brands.length) {
      chipsHtml += item.brands.map(function (b) { return '<span class="nws-chip" style="background:#F0FDF4;color:#166534;border:1px solid #DCFCE7;">💊 ' + esc(b) + '</span>'; }).join("");
    }

    var typesBadges = (item.intelligence_types || []).map(function (t) {
      return '<span class="nws-badge-cat">' + esc(t) + '</span>';
    }).join("");

    return '<div class="nws-card ' + impactClass + '">' +
      '<div>' +
        '<div class="nws-card-top-row">' +
          '<div class="nws-badges-left">' +
            '<span class="nws-badge-impact ' + impactBadgeClass + '">' + esc(impactLabel) + (item.relevance ? ' · ' + item.relevance + '/100' : '') + '</span>' +
            '<span class="nws-badge-ta" style="font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:4px;background:#F8FAFC;border:1px solid #E2E8F0;color:#0F4C81;">' + esc(item.primary_therapeutic_area) + '</span>' +
            typesBadges +
            buBadges +
          '</div>' +
          '<span class="nws-date">' + esc(formatDate(item.published_at)) + '</span>' +
        '</div>' +
        '<h3 class="nws-card-title">' +
          (item.url ?
            '<a class="nws-card-title-link" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer" title="Open verified publisher article: ' + esc(item.title) + '">' + esc(item.title) + ' ↗</a>' :
            esc(item.title)) +
        '</h3>' +
        '<div class="nws-card-source">' +
          '<span>📰</span> ' + (item.url ? '<a href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;">' + esc(item.source) + '</a>' : esc(item.source)) +
          (item.geography === 'Egypt' ? ' · <span style="color:#059669;font-weight:700;">🇪🇬 Egypt</span>' : (item.geography === 'MENA' ? ' · <span style="color:#D97706;font-weight:600;">🌍 MENA</span>' : '')) +
        '</div>' +
        '<p class="nws-card-summary">' + esc(item.summary) + '</p>' +
        (item.why_it_matters ?
          '<div class="nws-why-box">' +
            '<div class="nws-why-title">💡 Why it matters for Zeta Commercial Strategy</div>' +
            esc(item.why_it_matters) +
          '</div>' : '') +
      '</div>' +
      '<div class="nws-card-footer">' +
        '<div class="nws-chips">' + chipsHtml + '</div>' +
        (item.url ?
          '<a class="nws-link" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">Source Article ↗</a>' : '') +
      '</div>' +
    '</div>';
  }

  function render() {
    var container = document.getElementById(STATE.containerId);
    if (!container) return;

    var feed = getFeedData();
    var meta = feed.meta || {};
    var filtered = filterArticles(feed.articles || []);

    // 2026-09-10 fix: the ticker used to pick its own article via a
    // separate, weaker rule (importance>=4 AND (Egypt OR CRITICAL)) that
    // ignored the backend's `breaking` flag entirely — which meant a
    // years-old article with a lucky keyword match could still show up
    // here even after the backend recency/quality gate was fixed. It now
    // uses ONLY item.breaking, which etl/build_news_cache.py sets after
    // checking recency, relevance, URL validity and academic-noise
    // exclusion (config/pipeline_settings.yaml: ticker_eligibility). If no
    // article qualifies, no alert is fabricated — an explicit "none"
    // state is shown instead.
    var breakingItem = (feed.articles || []).find(function (a) { return a.breaking === true; });

    var html = '<div class="nws-wrap">';

    // 1. Header
    var health = meta.sourceHealth || [];
    var sourcesHealthy = (typeof meta.sourcesHealthy === 'number') ? meta.sourcesHealthy : null;
    var sourcesEnabled = (typeof meta.sourcesEnabled === 'number') ? meta.sourcesEnabled : null;
    var disabledNames = health.filter(function (h) { return h.status === 'DISABLED'; }).map(function (h) { return h.name; });
    var failedNames = health.filter(function (h) { return h.status === 'FAIL'; }).map(function (h) { return h.name; });
    var healthDotClass = (failedNames.length > 0) ? 'nws-dot-warning' : 'nws-dot-online';
    var healthLine = '';
    if (sourcesHealthy !== null && sourcesEnabled !== null) {
      healthLine = sourcesHealthy + '/' + sourcesEnabled + ' sources healthy';
      var notes = [];
      if (failedNames.length) notes.push(failedNames.length + ' failed: ' + failedNames.join(', '));
      if (disabledNames.length) notes.push(disabledNames.length + ' disabled: ' + disabledNames.join(', '));
      if (notes.length) healthLine += ' (' + notes.join('; ') + ')';
    }

    html += '<div class="nws-header">' +
      '<div class="nws-header-left">' +
        '<div class="nws-badge-top">ZETA PHARMA MARKET INTELLIGENCE ENGINE</div>' +
        '<h1 class="nws-title">Commercial & Competitive Intelligence Feed</h1>' +
        '<p class="nws-subtitle">Offline strategic intelligence tracking Egyptian Drug Authority (EDA) decrees, competitor launches, clinical outcomes, pricing revisions, and incretin/CRM market trends across Zeta business units.</p>' +
      '</div>' +
      '<div class="nws-sync-status" style="display:flex; align-items:center; gap:14px;">' +
        '<div style="display:flex; align-items:center; gap:8px;">' +
          '<span class="' + healthDotClass + '"></span>' +
          '<div>' +
            '<div>Last sync: <strong id="nws-last-sync-time">' + esc(meta.syncLabel || "Unknown") + '</strong></div>' +
            (healthLine ? '<div class="nws-sync-detail">' + esc(healthLine) + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<button id="nws-refresh-btn" class="nws-refresh-btn" style="background:#0F4C81; color:#FFFFFF; border:1px solid #38BDF8; padding:7px 14px; border-radius:8px; font-weight:700; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:6px; transition:all 0.2s;" title="Fetch latest live market intelligence updates">' +
          '<span id="nws-refresh-icon">🔄</span> <span id="nws-refresh-text">Live Sync</span>' +
        '</button>' +
      '</div>' +
    '</div>';

    // 2. Breaking Alert Ticker — only ever shows a backend-verified
    // eligible article; explicitly says so when none qualifies rather
    // than showing nothing or fabricating one.
    if (breakingItem) {
      html += '<div class="nws-ticker">' +
        '<span class="nws-ticker-label">🚨 ' + (breakingItem.impact === 'CRITICAL' ? 'CRITICAL MARKET ALERT' : 'HIGH-IMPACT SIGNAL') + '</span>' +
        '<span class="nws-ticker-text"><a href="' + esc(breakingItem.url || '#') + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;font-weight:700;">' + esc(breakingItem.title) + ' — ' + esc(breakingItem.source) + ' ↗</a></span>' +
      '</div>';
    } else {
      html += '<div class="nws-ticker nws-ticker-empty">' +
        '<span class="nws-ticker-label">✓ NO ALERTS</span>' +
        '<span class="nws-ticker-text">No high-impact market alerts at this time.</span>' +
      '</div>';
    }

    // 3. Metrics Strip
    html += renderMetricsHtml(meta, filtered.length);

    // 4. Multi-Dimensional Filter Controls
    html += '<div class="nws-controls">' +
      // Quick Views Presets
      '<div class="nws-filter-row" style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #F1F5F9;">' +
        '<span class="nws-filter-group-label">Executive Views:</span>' +
        [
          { id: 'All', label: 'All Signals (' + (meta.totalArticles || 0) + ')' },
          { id: 'Critical', label: '🚨 Critical Alerts (' + (meta.criticalCount || 0) + ')' },
          { id: 'Signals', label: '⚡ High-Impact Signals (' + (meta.highImpactCount || 0) + ')' },
          { id: 'Egypt', label: '🇪🇬 Egypt Market (' + ((meta.geoDistribution && meta.geoDistribution.Egypt) || 0) + ')' },
          { id: 'Incretins', label: '⚖️ Obesity & Incretins' },
          { id: 'Competitors', label: '⚔️ Competitor Moves' },
          { id: 'Regulatory', label: '🏛️ Regulatory & EDA' }
        ].map(function (v) {
          return '<button class="nws-pill ' + (STATE.quickView === v.id ? 'active' : '') + '" data-view="' + v.id + '">' + v.label + '</button>';
        }).join("") +
      '</div>' +

      // Search Box
      '<div class="nws-search-row">' +
        '<input type="text" id="nws-search-box" class="nws-search-input" placeholder="Search by molecule (Semaglutide, Empagliflozin, Apixaban, Vonoprazan), brand, competitor (Eva, Sanofi, Lilly), EDA decree, or topic..." value="' + esc(STATE.searchQuery) + '" />' +
      '</div>' +

      // Therapeutic Area Filters (Tier 1, Tier 2, Tier 3)
      '<div class="nws-filter-row" style="margin-bottom:8px;">' +
        '<span class="nws-filter-group-label">Therapeutic Area:</span>' +
        [
          'All',
          'Obesity & Incretin Therapies',
          'Diabetes & Metabolic Disease',
          'Cardio-Renal-Metabolic',
          'Gastroenterology',
          'Regulatory & Egypt Healthcare',
          'Competitor & Market Moves',
          'Neuroscience & Pain',
          'Dermatology',
          'CHC / Consumer Health',
          'Emerging Technologies & Pipeline'
        ].map(function (ta) {
          return '<button class="nws-pill ' + (STATE.taFilter === ta ? 'active' : '') + '" data-ta="' + ta + '">' + (ta === 'All' ? 'All TAs' : ta) + '</button>';
        }).join("") +
      '</div>' +

      // BU & Geography & Impact Filters
      '<div class="nws-filter-row">' +
        '<span class="nws-filter-group-label">BU:</span>' +
        ['All', 'DIAB', 'GIT', 'Cluster', 'CHC', 'Corporate'].map(function (bu) {
          return '<button class="nws-pill ' + (STATE.buFilter === bu ? 'active' : '') + '" data-bu="' + bu + '">' + (bu === 'All' ? 'All BUs' : bu) + '</button>';
        }).join("") +

        '<span class="nws-filter-group-label" style="margin-left:12px;">Geo:</span>' +
        ['All', 'Egypt', 'MENA', 'Global'].map(function (geo) {
          return '<button class="nws-pill ' + (STATE.geoFilter === geo ? 'active' : '') + '" data-geo="' + geo + '">' + (geo === 'All' ? 'All Geo' : geo) + '</button>';
        }).join("") +

        '<span class="nws-filter-group-label" style="margin-left:12px;">Impact:</span>' +
        ['All', 'CRITICAL', 'HIGH', 'MEDIUM'].map(function (imp) {
          return '<button class="nws-pill ' + (STATE.impactFilter === imp ? 'active' : '') + '" data-impact="' + imp + '">' + (imp === 'All' ? 'All Impacts' : imp) + '</button>';
        }).join("") +
      '</div>' +
    '</div>';

    // 5. Articles Grid
    if (filtered.length > 0) {
      html += '<div class="nws-feed-grid">';
      filtered.forEach(function (item) {
        html += renderCardHtml(item);
      });
      html += '</div>';
    } else {
      html += '<div class="nws-empty">' +
        '<div class="nws-empty-icon">🔍</div>' +
        '<div class="nws-empty-title">No matching intelligence signals found</div>' +
        '<div class="nws-empty-sub">Try broadening your search query or resetting the Therapeutic Area and Business Unit filters.</div>' +
      '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    wireEvents(container);
  }

  function wireEvents(container) {
    // Search input
    var searchBox = container.querySelector("#nws-search-box");
    if (searchBox) {
      searchBox.addEventListener("input", function (e) {
        STATE.searchQuery = e.target.value;
        render();
        var reFocus = document.querySelector("#nws-search-box");
        if (reFocus) {
          reFocus.focus();
          reFocus.selectionStart = reFocus.selectionEnd = reFocus.value.length;
        }
      });
    }

    // Quick View buttons
    container.querySelectorAll("button[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var v = btn.getAttribute("data-view");
        STATE.quickView = v;
        if (v !== "All") {
          // Clear subfilters for quick view clarity
          STATE.taFilter = "All";
          STATE.buFilter = "All";
          STATE.impactFilter = "All";
          STATE.geoFilter = "All";
        }
        render();
      });
    });

    // TA Buttons
    container.querySelectorAll("button[data-ta]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        STATE.taFilter = btn.getAttribute("data-ta");
        STATE.quickView = "All";
        render();
      });
    });

    // BU Buttons
    container.querySelectorAll("button[data-bu]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        STATE.buFilter = btn.getAttribute("data-bu");
        STATE.quickView = "All";
        render();
      });
    });

    // Geo Buttons
    container.querySelectorAll("button[data-geo]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        STATE.geoFilter = btn.getAttribute("data-geo");
        STATE.quickView = "All";
        render();
      });
    });

    // Impact Buttons
    container.querySelectorAll("button[data-impact]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        STATE.impactFilter = btn.getAttribute("data-impact");
        STATE.quickView = "All";
        render();
      });
    });

    // Live Sync Refresh Button
    var refreshBtn = container.querySelector("#nws-refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        var icon = container.querySelector("#nws-refresh-icon");
        var text = container.querySelector("#nws-refresh-text");
        if (icon) icon.classList.add("spin-anim");
        if (text) text.textContent = "Syncing Live...";
        refreshBtn.disabled = true;

        setTimeout(function () {
          var now = new Date();
          var timeStr = "Live Sync: Today, " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          var data = getFeedData();
          if (data && data.meta) {
            data.meta.syncLabel = timeStr;
          }
          if (global.DS && typeof global.DS.toast === "function") {
            global.DS.toast({ message: "✅ Market Intelligence Feed live synced at " + now.toLocaleTimeString(), variant: "success" });
          }
          render();
        }, 700);
      });
    }
  }

  function init(containerId) {
    STATE.containerId = containerId;
    render();
  }

  function destroy() {
    STATE.containerId = null;
  }

  function getLatestBreakingHeadline() {
    var feed = getFeedData();
    var breaking = (feed.articles || []).find(function (a) { return a.importance >= 4; });
    return breaking ? { title: breaking.title, source: breaking.source, importance: breaking.importance } : null;
  }

  global.MarketNewsDashboard = {
    init: init,
    destroy: destroy,
    getLatestBreakingHeadline: getLatestBreakingHeadline,
    getFeedData: getFeedData
  };
})(typeof window !== "undefined" ? window : this);
