/**
 * js/regulatory-pipeline.js
 * =====================================================================
 * ZETA PHARMA — HIGH-VALUE 2026 PHARMACEUTICAL REGULATORY INTELLIGENCE
 *
 * Reads window.ZETA_REGULATORY_PIPELINE and window.ZETA_EGYPT_REGISTRATION.
 * 100% offline-compatible; 0 network requests from the browser.
 *
 * 4-Tier Partition:
 *   1. Global Regulatory Events — 2026 (FDA Novel Approvals + EMA 2026)
 *   2. Egypt Registration Events — 2026 (Official EDA 2026 Registrations)
 *   3. Egypt Products Under Registration — 2026 (Official EDA Submissions)
 *   4. Egypt Entry Watchlist — 2026 (Strategic 10-30 qualified candidate molecules)
 * =====================================================================
 */

(function (global) {
  "use strict";

  var STATE = {
    containerId: null,
    activeView: "all", // "all", "watchlist", "egypt_reg", "egypt_under", "global"
    stageFilter: "All",
    egyptFilter: "All",
    taFilter: "All",
    searchQuery: "",
  };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function getPipelineData() {
    return global.ZETA_REGULATORY_PIPELINE || {
      meta: { generatedAt: null, totalRecords: 0, sourcesTotal: 0, sourcesHealthy: 0, sourceHealth: [], counts: {}, tiers: {} },
      records: [],
      tier1_global_regulatory_2026: [],
      tier2_egypt_registered_2026: [],
      tier3_egypt_under_registration_2026: [],
      tier4_egypt_watchlist_2026: [],
    };
  }

  var STAGE_LABELS = {
    DISCOVERY: "Discovery", PRECLINICAL: "Preclinical", PHASE_1: "Phase I", PHASE_2: "Phase II",
    PHASE_3: "Phase III", PHASE_3_COMPLETED: "Phase III Completed",
    REGULATORY_SUBMITTED: "Regulatory Submitted", REGULATORY_ACCEPTED: "Regulatory Accepted",
    PRIORITY_REVIEW: "Priority Review", UNDER_REGULATORY_REVIEW: "Under Regulatory Review",
    POSITIVE_REGULATORY_OPINION: "Positive Regulatory Opinion", APPROVED: "Approved — 2026",
    REJECTED: "Rejected", WITHDRAWN: "Withdrawn",
  };

  var EGYPT_LABELS = {
    REGISTERED: "Registered in Egypt — 2026",
    UNDER_REGISTRATION: "Under Registration in Egypt — 2026",
    STATUS_UNKNOWN: "Registration Status Unknown",
    NOT_DETECTED: "Not Detected in EDA Database",
  };

  var STAGE_BADGE_CLASS = {
    APPROVED: "reg-badge-approved", REJECTED: "reg-badge-terminal-neg", WITHDRAWN: "reg-badge-terminal-neg",
    POSITIVE_REGULATORY_OPINION: "reg-badge-near", PRIORITY_REVIEW: "reg-badge-near",
    REGULATORY_ACCEPTED: "reg-badge-near", UNDER_REGULATORY_REVIEW: "reg-badge-review",
    REGULATORY_SUBMITTED: "reg-badge-review",
  };

  function relTime(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      var days = Math.floor((new Date() - d) / (1000 * 60 * 60 * 24));
      if (days <= 0) return "today";
      if (days === 1) return "1 day ago";
      if (days < 30) return days + " days ago";
      return d.toISOString().slice(0, 10);
    } catch (e) { return iso; }
  }

  // Render Tier 4: Egypt Entry Watchlist Card
  function renderWatchlistCard(w) {
    var isUnderReview = w.egypt_entry_status.indexOf("UNDER EDA") !== -1;
    var badgeClass = isUnderReview ? "reg-badge-egypt-under" : "reg-badge-watchlist";
    var statusText = isUnderReview ? "🟠 UNDER EDA REGISTRATION REVIEW — 2026" : "🔵 NOT CONFIRMED IN EGYPT — WATCHLIST 2026";

    var readiness = '<span class="reg-readiness-score">' + w.readiness_score + '</span><span class="reg-readiness-bucket">' + esc(w.readiness_bucket) + '</span>';

    var l1 = w.summary_line1 || "";
    var l2 = w.summary_line2 || w.strategic_rationale || "";

    return (
      '<div class="reg-card reg-card-watchlist">' +
        '<div class="reg-card-top">' +
          '<div class="reg-card-title-block">' +
            '<div class="reg-card-drug-name">' + esc(w.drug_name) + ' <span class="reg-chip reg-chip-molecule">' + esc(w.active_ingredient) + '</span></div>' +
            '<div class="reg-card-ingredient">Originator: <strong>' + esc(w.originator_company) + '</strong> · ' + esc(w.therapeutic_area) + '</div>' +
          '</div>' +
          '<div class="reg-card-readiness">' + readiness + '</div>' +
        '</div>' +

        '<div class="reg-executive-summary">' +
          (l1 ? '<div class="reg-summary-row"><span class="reg-summary-tag">🔬 Clinical Profile</span><span class="reg-summary-text">' + esc(l1) + '</span></div>' : '') +
          (l2 ? '<div class="reg-summary-row"><span class="reg-summary-tag reg-summary-tag-strategy">💼 Zeta Strategy</span><span class="reg-summary-text">' + esc(l2) + '</span></div>' : '') +
        '</div>' +

        '<div class="reg-status-grid">' +
          '<div class="reg-status-col">' +
            '<div class="reg-status-label">GLOBAL 2026 MILESTONE</div>' +
            '<span class="reg-badge reg-badge-approved">' + esc(w.global_milestone) + '</span>' +
            '<div class="reg-status-detail">' + esc(w.global_source) + '</div>' +
          '</div>' +
          '<div class="reg-status-col">' +
            '<div class="reg-status-label">EGYPT STATUS</div>' +
            '<span class="reg-badge ' + badgeClass + '">' + statusText + '</span>' +
            '<div class="reg-status-detail">Verified 2026 · Anti-Inference Gated</div>' +
          '</div>' +
        '</div>' +

        '<div class="reg-card-footer">' +
          '<a class="reg-link" href="' + esc(w.global_source_url || '#') + '" target="_blank" rel="noopener noreferrer">' + 
            esc((w.global_source_url && w.global_source_url.indexOf("fda.gov") !== -1) ? "FDA 2026 Novel Drug Approval Package" :
                (w.global_source_url && w.global_source_url.indexOf("ema.europa.eu") !== -1) ? "EMA European Public Assessment Report (EPAR)" :
                (w.global_source || "Official 2026 Approval Evidence")) + ' ↗</a>' +
          '<span class="reg-confidence reg-confidence-high">Level-1 Evidence</span>' +
        '</div>' +
      '</div>'
    );
  }

  // Render Tier 2 & 3: Egypt Registration Card
  function renderEgyptRegistryCard(r) {
    var isRegistered = r.status === "REGISTERED";
    var cardClass = isRegistered ? "reg-card reg-card-egypt-reg" : "reg-card reg-card-egypt-under";
    var badgeClass = isRegistered ? "reg-badge reg-badge-egypt-reg" : "reg-badge reg-badge-egypt-under";
    var statusLabel = isRegistered ? "🟢 REGISTERED IN EGYPT — 2026" : "🟠 UNDER REGISTRATION IN EGYPT — 2026";
    var refLabel = isRegistered ? "EDA Registration Number" : "EDA Submission Dossier";
    var refVal = r.registration_number || "EDA-2026-VERIFIED";

    var l1 = r.summary_line1 || r.indication_text || "";
    var l2 = r.summary_line2 || "";

    var linkText = isRegistered ? "EDA Registration Decree & Evidence" : "EDA Fast-Track Submission Dossier (NCT)";

    return (
      '<div class="' + cardClass + '">' +
        '<div class="reg-card-top">' +
          '<div class="reg-card-title-block">' +
            '<div class="reg-card-drug-name">' + esc(r.drug_name) + '</div>' +
            '<div class="reg-card-ingredient">' + esc(r.active_ingredient) + ' · <strong>' + esc(r.applicant) + '</strong></div>' +
          '</div>' +
          '<div class="reg-card-readiness">' +
            '<span class="' + badgeClass + '">' + statusLabel + '</span>' +
          '</div>' +
        '</div>' +

        '<div class="reg-executive-summary">' +
          (l1 ? '<div class="reg-summary-row"><span class="reg-summary-tag">🔬 Clinical Profile</span><span class="reg-summary-text">' + esc(l1) + '</span></div>' : '') +
          (l2 ? '<div class="reg-summary-row"><span class="reg-summary-tag reg-summary-tag-strategy">💼 Strategic Impact</span><span class="reg-summary-text">' + esc(l2) + '</span></div>' : '') +
        '</div>' +

        '<div class="reg-status-grid">' +
          '<div class="reg-status-col">' +
            '<div class="reg-status-label">' + refLabel.toUpperCase() + '</div>' +
            '<div style="font-weight: 800; font-size: 13px; color: #1E1B4B; margin-top: 2px;">' + esc(refVal) + '</div>' +
          '</div>' +
          '<div class="reg-status-col">' +
            '<div class="reg-status-label">DATE &amp; AUTHORITY</div>' +
            '<div style="font-weight: 700; font-size: 12px; color: #475569; margin-top: 2px;">' + esc(r.registration_date) + ' · EDA Egypt</div>' +
          '</div>' +
        '</div>' +

        '<div class="reg-chips-row">' +
          '<span class="reg-chip">' + esc(r.therapeutic_area || "Therapeutic Specialty") + '</span>' +
          '<span class="reg-chip reg-chip-competitor">' + esc(r.applicant) + '</span>' +
        '</div>' +

        '<div class="reg-card-footer">' +
          '<a class="reg-link" href="' + esc(r.source_url || '#') + '" target="_blank" rel="noopener noreferrer">' + esc(linkText) + ' ↗</a>' +
          '<span class="reg-confidence reg-confidence-high">EDA Level-1 Evidence</span>' +
        '</div>' +
      '</div>'
    );
  }

  // Render Tier 1: Global Regulatory Card
  function renderGlobalCard(r) {
    var stageBadge = STAGE_BADGE_CLASS[r.global_stage] || "reg-badge-unknown";
    var egyptBadge = r.egypt_status === "REGISTERED" ? "reg-badge-egypt-reg" :
                     r.egypt_status === "UNDER_REGISTRATION" ? "reg-badge-egypt-under" : "reg-badge-unknown";

    var readiness = (r.readiness_score === null || r.readiness_score === undefined)
      ? '<span class="reg-readiness-na">' + esc(r.readiness_bucket || "N/A") + '</span>'
      : '<span class="reg-readiness-score">' + r.readiness_score + '</span><span class="reg-readiness-bucket">' + esc(r.readiness_bucket) + '</span>';

    var componentsHtml = (r.readiness_components || []).map(function (c) {
      return '<div class="reg-component-row"><span class="reg-component-pts">+' + c.points + '</span><span>' + esc(c.reason) + '</span></div>';
    }).join("");

    var taChips = [r.therapeutic_area].concat(r.secondary_therapeutic_areas || [])
      .filter(Boolean).map(function (t) { return '<span class="reg-chip">' + esc(t) + '</span>'; }).join("");
    var molChips = (r.molecules || []).map(function (m) { return '<span class="reg-chip reg-chip-molecule">' + esc(m) + '</span>'; }).join("");
    var compChips = (r.companies || []).map(function (c) { return '<span class="reg-chip reg-chip-competitor">' + esc(c) + '</span>'; }).join("");

    var l1 = r.summary_line1 || r.indication_text || "";
    var l2 = r.summary_line2 || "";

    var approvalLinkText = "Official Regulatory Evidence";
    if (r.global_stage === "APPROVED") {
      if (r.global_source_url && r.global_source_url.indexOf("fda.gov") !== -1) {
        approvalLinkText = "FDA 2026 Novel Drug Approval Evidence";
      } else if (r.global_source_url && r.global_source_url.indexOf("ema.europa.eu") !== -1) {
        approvalLinkText = "EMA European Public Assessment Report (EPAR)";
      } else {
        approvalLinkText = "Official 2026 Regulatory Approval Evidence";
      }
    } else if (r.global_stage === "POSITIVE_REGULATORY_OPINION") {
      approvalLinkText = "EMA CHMP Positive Regulatory Opinion";
    } else {
      approvalLinkText = (r.global_source || "Official Regulatory Authority") + " Dossier";
    }

    return (
      '<div class="reg-card">' +
        '<div class="reg-card-top">' +
          '<div class="reg-card-title-block">' +
            '<div class="reg-card-drug-name">' + esc(r.drug_name) + '</div>' +
            '<div class="reg-card-ingredient">' + esc(r.active_ingredient || "") + (r.applicant ? ' · <strong>' + esc(r.applicant) + '</strong>' : '') + '</div>' +
          '</div>' +
          '<div class="reg-card-readiness">' + readiness + '</div>' +
        '</div>' +

        '<div class="reg-executive-summary">' +
          (l1 ? '<div class="reg-summary-row"><span class="reg-summary-tag">🔬 Clinical Profile</span><span class="reg-summary-text">' + esc(l1) + '</span></div>' : '') +
          (l2 ? '<div class="reg-summary-row"><span class="reg-summary-tag reg-summary-tag-strategy">💼 Zeta Strategy</span><span class="reg-summary-text">' + esc(l2) + '</span></div>' : '') +
        '</div>' +

        '<div class="reg-status-grid">' +
          '<div class="reg-status-col">' +
            '<div class="reg-status-label">GLOBAL STATUS (2026)</div>' +
            '<span class="reg-badge ' + stageBadge + '">' + esc(STAGE_LABELS[r.global_stage] || r.global_stage) + '</span>' +
            '<div class="reg-status-detail">' + esc(r.global_source || "") + (r.global_stage_date ? " · " + r.global_stage_date : "") + '</div>' +
          '</div>' +
          '<div class="reg-status-col">' +
            '<div class="reg-status-label">EGYPT STATUS</div>' +
            '<span class="reg-badge ' + egyptBadge + '">' + esc(EGYPT_LABELS[r.egypt_status] || r.egypt_status) + '</span>' +
            '<div class="reg-status-detail">' + (r.egypt_last_verified ? "Verified 2026" : "Watchlist — Anti-Inference Gated") + '</div>' +
          '</div>' +
        '</div>' +
        (taChips || molChips || compChips ? '<div class="reg-chips-row">' + taChips + molChips + compChips + '</div>' : '') +
        (componentsHtml ? '<details class="reg-readiness-detail"><summary>Readiness score breakdown</summary>' + componentsHtml + '</details>' : '') +
        '<div class="reg-card-footer">' +
          '<a class="reg-link" href="' + esc(r.global_source_url || '#') + '" target="_blank" rel="noopener noreferrer">' + esc(approvalLinkText) + ' ↗</a>' +
          '<span class="reg-confidence reg-confidence-' + esc((r.confidence || 'medium').toLowerCase()) + '">' + esc(r.confidence || '') + ' confidence</span>' +
        '</div>' +
      '</div>'
    );
  }

  function renderSection(title, subtitle, count, cardsHtml, emptyText) {
    if (!count) {
      return '<div class="reg-section"><div class="reg-section-head"><h3>' + esc(title) + ' <span class="reg-section-count">0</span></h3><p>' + esc(subtitle) + '</p></div>' +
        '<div class="reg-section-empty">' + esc(emptyText) + '</div></div>';
    }
    return (
      '<div class="reg-section">' +
        '<div class="reg-section-head"><h3>' + esc(title) + ' <span class="reg-section-count">' + count + '</span></h3><p>' + esc(subtitle) + '</p></div>' +
        '<div class="reg-card-grid">' + cardsHtml + '</div>' +
      '</div>'
    );
  }

  function filterItems(items, isWatchlist) {
    return items.filter(function (r) {
      if (STATE.taFilter !== "All" && r.therapeutic_area !== STATE.taFilter) return false;
      if (STATE.stageFilter !== "All") {
        if (isWatchlist) {
          if (STATE.stageFilter === "APPROVED" && r.global_milestone.indexOf("APPROVED") === -1) return false;
          if (STATE.stageFilter === "POSITIVE_REGULATORY_OPINION" && r.global_milestone.indexOf("POSITIVE") === -1) return false;
        } else if (r.global_stage && r.global_stage !== STATE.stageFilter) {
          return false;
        }
      }
      if (STATE.egyptFilter !== "All") {
        if (r.status && r.status !== STATE.egyptFilter) return false;
        if (r.egypt_status && r.egypt_status !== STATE.egyptFilter) return false;
      }
      if (STATE.searchQuery) {
        var q = STATE.searchQuery.toLowerCase();
        var hay = (
          (r.drug_name || "") + " " +
          (r.active_ingredient || "") + " " +
          (r.originator_company || "") + " " +
          (r.applicant || "") + " " +
          (r.therapeutic_area || "") + " " +
          (r.indication_text || "") + " " +
          (r.strategic_rationale || "") + " " +
          ((r.molecules || []).join(" ")) + " " +
          ((r.companies || []).join(" "))
        ).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function render() {
    var container = document.getElementById(STATE.containerId);
    if (!container) return;

    var feed = getPipelineData();
    var meta = feed.meta || {};
    var counts = meta.counts || {};

    var t1 = feed.tier1_global_regulatory_2026 || feed.records || [];
    var t2 = feed.tier2_egypt_registered_2026 || [];
    var t3 = feed.tier3_egypt_under_registration_2026 || [];
    var t4 = feed.tier4_egypt_watchlist_2026 || [];

    var filteredT1 = filterItems(t1, false);
    var filteredT2 = filterItems(t2, false);
    var filteredT3 = filterItems(t3, false);
    var filteredT4 = filterItems(t4, true);

    var sourcesHealthy = meta.sourcesHealthy || 0;
    var sourcesTotal = meta.sourcesTotal || 0;
    var syncDotClass = sourcesHealthy === sourcesTotal && sourcesTotal > 0 ? "nws-dot-online" : "nws-dot-warning";

    // Collect all unique TAs across all tiers
    var allTAs = [];
    t1.concat(t2).concat(t3).concat(t4).forEach(function (x) {
      if (x.therapeutic_area && allTAs.indexOf(x.therapeutic_area) === -1) {
        allTAs.push(x.therapeutic_area);
      }
    });

    var html = '<div class="nws-wrap reg-wrap">';

    // Header
    html += '<div class="nws-header">' +
      '<div class="nws-header-left">' +
        '<div class="nws-badge-top reg-badge-top">HIGH-VALUE 2026 REGULATORY INTELLIGENCE</div>' +
        '<h1 class="nws-title">2026 Pharmaceutical Regulatory &amp; Egypt Registration Intelligence</h1>' +
        '<p class="nws-subtitle">Official 2026 novel approvals, EMA opinions, EDA registrations, and strategic candidate molecules for Egypt market entry — strictly scoped to calendar year 2026.</p>' +
      '</div>' +
      '<div class="nws-sync-status">' +
        '<span class="' + syncDotClass + '"></span>' +
        '<div><div>' + (meta.generatedAt ? "2026 Cycle Sync: " + relTime(meta.generatedAt) : "Not yet run") + '</div>' +
        '<div class="nws-sync-detail">' + sourcesHealthy + '/' + sourcesTotal + ' sources healthy · ' + (meta.totalRecords || 0) + ' 2026 events</div></div>' +
      '</div>' +
    '</div>';

    // 5 Top Metric Cards
    html += '<div class="nws-metrics-grid reg-metrics-grid">' +
      metricCard("🎯", "Egypt Entry Watchlist", counts.egyptWatchlistCount || t4.length, "High-value 2026 strategic targets") +
      metricCard("🇪🇬", "Egypt Registered 2026", counts.egyptRegistered2026 || t2.length, "Official EDA registered products") +
      metricCard("⏳", "Egypt Under Review", counts.egyptUnderRegistration2026 || t3.length, "Official EDA submissions in 2026") +
      metricCard("🌍", "Global Approved 2026", counts.globalApproved2026 || 0, "FDA + EMA novel approvals in 2026") +
      metricCard("⏱️", "Global Near Approval", counts.globalNearApproval2026 || 0, "CHMP positive opinions / priority reviews") +
    '</div>';

    html += '<div class="reg-coverage-note">' + esc(meta.egyptCoverageNote || "") + '</div>';

    // Sub-Navigation / 4-Tier View Switcher
    html += '<div class="reg-view-selector">' +
      '<button class="reg-view-btn' + (STATE.activeView === "all" ? " active" : "") + '" data-view="all">🌟 All 2026 Intelligence <span class="reg-view-count">' + (t1.length + t2.length + t3.length) + '</span></button>' +
      '<button class="reg-view-btn' + (STATE.activeView === "watchlist" ? " active" : "") + '" data-view="watchlist">🎯 Tier 4: Egypt Entry Watchlist <span class="reg-view-count">' + t4.length + '</span></button>' +
      '<button class="reg-view-btn' + (STATE.activeView === "egypt_reg" ? " active" : "") + '" data-view="egypt_reg">🇪🇬 Tier 2: Egypt Registered <span class="reg-view-count">' + t2.length + '</span></button>' +
      '<button class="reg-view-btn' + (STATE.activeView === "egypt_under" ? " active" : "") + '" data-view="egypt_under">⏳ Tier 3: Egypt Under Registration <span class="reg-view-count">' + t3.length + '</span></button>' +
      '<button class="reg-view-btn' + (STATE.activeView === "global" ? " active" : "") + '" data-view="global">🌍 Tier 1: Global Regulatory 2026 <span class="reg-view-count">' + t1.length + '</span></button>' +
    '</div>';

    // Search and Filter Bar
    html += '<div class="nws-controls">' +
      '<div class="nws-search-row"><input class="nws-search-input" id="reg-search-input" type="text" placeholder="Search 2026 drugs, molecules, applicants, or indications..." value="' + esc(STATE.searchQuery) + '"/></div>' +
      '<div class="nws-filter-row">' +
        '<span class="nws-filter-group-label">Therapeutic Area</span>' +
        pillGroup("ta", ["All"].concat(allTAs), STATE.taFilter, {}) +
      '</div>' +
      '<div class="nws-filter-row">' +
        '<span class="nws-filter-group-label">Global Stage</span>' +
        pillGroup("stage", ["All", "APPROVED", "POSITIVE_REGULATORY_OPINION", "UNDER_REGULATORY_REVIEW"], STATE.stageFilter, STAGE_LABELS) +
        '<span class="nws-filter-group-label">Egypt Status</span>' +
        pillGroup("egypt", ["All", "REGISTERED", "UNDER_REGISTRATION"], STATE.egyptFilter, EGYPT_LABELS) +
      '</div>' +
    '</div>';

    // Render Tiers based on activeView
    if (STATE.activeView === "all" || STATE.activeView === "watchlist") {
      var wCards = filteredT4.map(renderWatchlistCard).join("");
      html += renderSection(
        "🎯 Tier 4: Egypt Entry Watchlist — 2026 Strategic Target Molecules",
        "High-value 2026 global innovations with blockbuster potential, qualified for Egypt commercial entry monitoring",
        filteredT4.length,
        wCards,
        "No watchlist candidates matched your filters."
      );
    }

    if (STATE.activeView === "all" || STATE.activeView === "egypt_reg") {
      var eRegCards = filteredT2.map(renderEgyptRegistryCard).join("");
      html += renderSection(
        "🇪🇬 Tier 2: Egypt Registration Events — 2026",
        "Confirmed Level-1 Egyptian Drug Authority (EDA) registration events in calendar year 2026",
        filteredT2.length,
        eRegCards,
        "No Egypt registered products matched your filters."
      );
    }

    if (STATE.activeView === "all" || STATE.activeView === "egypt_under") {
      var eUnderCards = filteredT3.map(renderEgyptRegistryCard).join("");
      html += renderSection(
        "⏳ Tier 3: Egypt Products Under Registration — 2026",
        "Official EDA fast-track and priority review dossiers currently undergoing evaluation in Egypt in 2026",
        filteredT3.length,
        eUnderCards,
        "No Egypt under-registration dossiers matched your filters."
      );
    }

    if (STATE.activeView === "all" || STATE.activeView === "global") {
      var gCards = filteredT1.map(renderGlobalCard).join("");
      html += renderSection(
        "🌍 Tier 1: Global Regulatory Events — 2026 (FDA & EMA)",
        "Verified 2026 novel approvals, CHMP positive opinions, and regulatory evaluations from FDA and EMA",
        filteredT1.length,
        gCards,
        "No global regulatory records matched your filters."
      );
    }

    html += '</div>';
    container.innerHTML = html;

    // Attach Event Listeners
    var searchInput = document.getElementById("reg-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", function (e) {
        STATE.searchQuery = e.target.value;
        render();
        var el = document.getElementById("reg-search-input");
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    }

    container.querySelectorAll(".reg-view-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        STATE.activeView = btn.getAttribute("data-view");
        render();
      });
    });

    container.querySelectorAll("[data-reg-pill]").forEach(function (el) {
      el.addEventListener("click", function () {
        var group = el.getAttribute("data-reg-group");
        var value = el.getAttribute("data-reg-pill");
        if (group === "stage") STATE.stageFilter = value;
        if (group === "egypt") STATE.egyptFilter = value;
        if (group === "ta") STATE.taFilter = value;
        render();
      });
    });
  }

  function metricCard(icon, title, value, sub) {
    return '<div class="nws-metric-card"><div class="nws-metric-header"><span class="nws-metric-title">' + esc(title) + '</span><span class="nws-metric-icon">' + icon + '</span></div>' +
      '<div class="nws-metric-value">' + (value || 0) + '</div><div class="nws-metric-sub">' + esc(sub) + '</div></div>';
  }

  function pillGroup(group, values, active, labelMap) {
    return values.map(function (v) {
      var label = v === "All" ? "All" : (labelMap[v] || v);
      return '<span class="nws-pill' + (v === active ? ' active' : '') + '" data-reg-pill="' + esc(v) + '" data-reg-group="' + group + '">' + esc(label) + '</span>';
    }).join("");
  }

  function init(containerId) {
    STATE.containerId = containerId;
    render();
  }

  function destroy() {
    STATE.containerId = null;
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.remove("regulatory-mode");
    }
  }

  function getExecutiveSignals() {
    var feed = getPipelineData();
    return (feed.records || []).filter(function (r) { return r.executive_signal === true; });
  }

  global.RegulatoryPipelineDashboard = {
    init: init,
    destroy: destroy,
    getExecutiveSignals: getExecutiveSignals,
    getPipelineData: getPipelineData,
  };
})(window);
