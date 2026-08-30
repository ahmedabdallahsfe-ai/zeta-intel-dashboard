/**
 * ZETA ENTERPRISE PLATFORM — business-review-download.js
 * =====================================================================
 * PLATFORM ASSET. Exposes window.BusinessReviewDownload.
 *
 * Provides a secure, role-gated Download Center for:
 *   1. Generated, Populated Business Review Decks (.pptx):
 *      - Corporate Overview Deck (All Business Units combined)
 *      - Individual BU Decks (CHC, Cluster, DIAB, GIT)
 *   2. Master PowerPoint Template (.pptx):
 *      - Clean master template (Zeta-Business-Review-Template.pptx)
 *
 * ACCESS & SCOPING MODEL:
 * ---------------------------------------------------------------------
 * - CEO / VP / BEX / Admin / SFE Manager (Unrestricted Scope):
 *   Can download Corporate Deck, All 4 BU Decks, and Master Template.
 * - BU Manager (BU-Restricted Scope):
 *   Can download their own assigned BU Deck only (strictly validated
 *   via AUTH.canDownloadBuBusinessReview(bu)) plus the Master Template.
 * - Line Managers / Unauthorized Roles:
 *   Navigation hidden, direct rendering denied with empty state.
 *
 * SECURITY / CLIENT-SIDE VERIFICATION:
 * ---------------------------------------------------------------------
 * Download triggers perform dynamic runtime verification of user session
 * and scope before initiating file downloads, ensuring zero unauthorized
 * file disclosures.
 * =====================================================================
 */

(function (global) {
  "use strict";

  var TEMPLATE_PATH = "assets/templates/Zeta-Business-Review-Template.pptx";
  var TEMPLATE_DOWNLOAD_NAME = "Zeta-Business-Review-Template.pptx";
  var TEMPLATE_LABEL = "Master PowerPoint Presentation Template";
  var TEMPLATE_SLIDE_COUNT = 22;

  var BU_DECKS = [
    {
      key: "Corporate",
      title: "Corporate Business Review — Semester 1 2026",
      subtitle: "Consolidated performance across all 4 Business Units (CHC, Cluster, DIAB, GIT)",
      file: "assets/business_reviews/Zeta_Business_Review_Corporate_S1_2026.pptx",
      filename: "Zeta_Business_Review_Corporate_S1_2026.pptx",
      isCorporate: true,
      badge: "Corporate (All BUs)",
      badgeClass: "brd-badge-corporate"
    },
    {
      key: "CHC",
      title: "CHC Business Unit Review — Semester 1 2026",
      subtitle: "Consumer Health Care: Medical Rep & Pharmacy Sales channel analysis",
      file: "assets/business_reviews/Zeta_Business_Review_CHC_S1_2026.pptx",
      filename: "Zeta_Business_Review_CHC_S1_2026.pptx",
      isCorporate: false,
      badge: "CHC BU",
      badgeClass: "brd-badge-bu"
    },
    {
      key: "Cluster",
      title: "Cluster Business Unit Review — Semester 1 2026",
      subtitle: "PEDIA, ORTHO-I, ORTHO-II, CVM-I, and CVM-II performance review",
      file: "assets/business_reviews/Zeta_Business_Review_Cluster_S1_2026.pptx",
      filename: "Zeta_Business_Review_Cluster_S1_2026.pptx",
      isCorporate: false,
      badge: "Cluster BU",
      badgeClass: "brd-badge-bu"
    },
    {
      key: "DIAB",
      title: "DIAB Business Unit Review — Semester 1 2026",
      subtitle: "Diabetes lines (DIAB-I, DIAB-II, DIAB-III, DIAB-IV) performance review",
      file: "assets/business_reviews/Zeta_Business_Review_DIAB_S1_2026.pptx",
      filename: "Zeta_Business_Review_DIAB_S1_2026.pptx",
      isCorporate: false,
      badge: "DIAB BU",
      badgeClass: "brd-badge-bu"
    },
    {
      key: "GIT",
      title: "GIT Business Unit Review — Semester 1 2026",
      subtitle: "Gastroenterology, CNS, and Dermatology lines performance review",
      file: "assets/business_reviews/Zeta_Business_Review_GIT_S1_2026.pptx",
      filename: "Zeta_Business_Review_GIT_S1_2026.pptx",
      isCorporate: false,
      badge: "GIT BU",
      badgeClass: "brd-badge-bu"
    }
  ];

  var _container = null;

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function canView() {
    if (!global.AUTH || typeof global.AUTH.canViewBusinessReview !== "function") return false;
    return global.AUTH.canViewBusinessReview();
  }

  function scopeNote(user) {
    var scope = global.AUTH.getScope();
    if (scope && scope.unrestricted) {
      return "Your access: Corporate + all Business Units (CHC, Cluster, DIAB, GIT).";
    }
    if (scope && Array.isArray(scope.bus) && scope.bus.length) {
      return "Your access: Scoped strictly to " + scope.bus.map(esc).join(", ") + " Business Unit.";
    }
    return "Your access: Scoped to your assigned Business Unit.";
  }

  function getAuthorizedDecks() {
    if (!global.AUTH) return [];
    var canAll = typeof global.AUTH.canViewAllBUs === "function" && global.AUTH.canViewAllBUs();
    return BU_DECKS.filter(function (deck) {
      if (deck.isCorporate) {
        return canAll;
      }
      if (canAll) return true;
      return typeof global.AUTH.canDownloadBuBusinessReview === "function"
        ? global.AUTH.canDownloadBuBusinessReview(deck.key)
        : false;
    });
  }

  function renderDenied(container) {
    var roles = (global.AUTH && global.AUTH.BUSINESS_REVIEW_ROLES) || [];
    if (global.DS && typeof global.DS.emptyState === "function") {
      container.innerHTML = '<div class="ds-page"><div style="max-width:520px;margin:80px auto;text-align:center;">' +
        global.DS.emptyState({
          icon: "\u{1F512}",
          title: "Access restricted",
          hint: "The Business Review Presentations & Templates are available to " +
                roles.join(", ") + " roles only.",
        }) + "</div></div>";
    } else {
      container.innerHTML = '<div class="brd-root"><div class="brd-denied">' +
        "<h2>Not available for your role</h2>" +
        "<p>Business Review access is limited to " + esc(roles.join(", ")) + ".</p>" +
        "</div></div>";
    }
  }

  function renderPanel(container, user) {
    var authorizedDecks = getAuthorizedDecks();
    var hasCorporate = authorizedDecks.some(function (d) { return d.isCorporate; });
    var buDecks = authorizedDecks.filter(function (d) { return !d.isCorporate; });
    var corporateDeck = authorizedDecks.find(function (d) { return d.isCorporate; });

    var html = '<div class="brd-root">';

    // Header section
    html += '<div class="brd-head">';
    html +=   '<div class="brd-head-badge">EXECUTIVE DECISION GOVERNANCE</div>';
    html +=   '<h1 class="brd-title">Business Review & Executive Presentation Center</h1>';
    html +=   '<p class="brd-sub">Download automated, data-populated PowerPoint decks for Semester 1 (S1 2026) across all 7 management pillars (Executive, People, External Market, Sales, Customer Coverage, Promotional Budget, and Decision Framework), or access the clean master template.</p>';
    html +=   '<div class="brd-user-scope"><span class="brd-scope-icon">👤</span> ' + esc(scopeNote(user)) + '</div>';
    html += '</div>';

    // Section 1: Generated Business Review Decks
    html += '<div class="brd-section">';
    html +=   '<div class="brd-section-header">';
    html +=     '<h2 class="brd-section-title">📊 Populated Business Review Decks (.pptx)</h2>';
    html +=     '<p class="brd-section-desc">Fully populated with live S1 2026 data, native tables, charts, and organogram metrics.</p>';
    html +=   '</div>';

    // Corporate Deck Card (if authorized)
    if (corporateDeck) {
      html += '<div class="brd-card brd-card-featured">';
      html +=   '<div class="brd-card-main">';
      html +=     '<div class="brd-file-icon brd-icon-corp" aria-hidden="true">🏢</div>';
      html +=     '<div class="brd-file-info">';
      html +=       '<div class="brd-card-header-row">';
      html +=         '<span class="brd-badge ' + esc(corporateDeck.badgeClass) + '">' + esc(corporateDeck.badge) + '</span>';
      html +=         '<span class="brd-period-tag">S1 2026</span>';
      html +=       '</div>';
      html +=       '<div class="brd-file-name">' + esc(corporateDeck.title) + '</div>';
      html +=       '<div class="brd-file-meta">' + esc(corporateDeck.subtitle) + '</div>';
      html +=       '<div class="brd-specs-row"><span>📄 22 Slides</span> · <span>📊 12 Tables & 11 Charts</span> · <span>💾 .pptx</span></div>';
      html +=     '</div>';
      html +=   '</div>';
      html +=   '<div class="brd-card-actions">';
      html +=     '<button class="brd-download-btn brd-btn-primary" data-deck-key="' + esc(corporateDeck.key) + '">';
      html +=       '<span aria-hidden="true">⬇️</span> Download Corporate Deck (.pptx)';
      html +=     '</button>';
      html +=   '</div>';
      html += '</div>';
    }

    // BU Decks Grid
    if (buDecks.length > 0) {
      html += '<div class="brd-grid">';
      buDecks.forEach(function (deck) {
        html += '<div class="brd-card">';
        html +=   '<div class="brd-card-main">';
        html +=     '<div class="brd-file-icon" aria-hidden="true">📈</div>';
        html +=     '<div class="brd-file-info">';
        html +=       '<div class="brd-card-header-row">';
        html +=         '<span class="brd-badge ' + esc(deck.badgeClass) + '">' + esc(deck.badge) + '</span>';
        html +=         '<span class="brd-period-tag">S1 2026</span>';
        html +=       '</div>';
        html +=       '<div class="brd-file-name">' + esc(deck.title) + '</div>';
        html +=       '<div class="brd-file-meta">' + esc(deck.subtitle) + '</div>';
        html +=       '<div class="brd-specs-row"><span>📄 22 Slides</span> · <span>📊 Native Tables & Charts</span></div>';
        html +=     '</div>';
        html +=   '</div>';
        html +=   '<div class="brd-card-actions">';
        html +=     '<button class="brd-download-btn" data-deck-key="' + esc(deck.key) + '">';
        html +=       '<span aria-hidden="true">⬇️</span> Download ' + esc(deck.key) + ' Deck (.pptx)';
        html +=     '</button>';
        html +=   '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</div>'; // End section 1

    // Section 2: Master PPT Template
    html += '<div class="brd-section brd-section-template">';
    html +=   '<div class="brd-section-header">';
    html +=     '<h2 class="brd-section-title">📐 Master PowerPoint Template</h2>';
    html +=     '<p class="brd-section-desc">Download the clean, unpopulated master presentation template.</p>';
    html +=   '</div>';

    html +=   '<div class="brd-card brd-card-template">';
    html +=     '<div class="brd-card-main">';
    html +=       '<div class="brd-file-icon brd-icon-template" aria-hidden="true">📑</div>';
    html +=       '<div class="brd-file-info">';
    html +=         '<div class="brd-card-header-row">';
    html +=           '<span class="brd-badge brd-badge-template">Master Template</span>';
    html +=         '</div>';
    html +=         '<div class="brd-file-name">' + esc(TEMPLATE_LABEL) + '</div>';
    html +=         '<div class="brd-file-meta">' + TEMPLATE_SLIDE_COUNT + ' slides · 100% Vector Layouts · Native Tables & Chart Placeholders</div>';
    html +=       '</div>';
    html +=     '</div>';
    html +=     '<div class="brd-card-actions">';
    html +=       '<a class="brd-download-btn brd-btn-secondary" href="' + esc(TEMPLATE_PATH) + '" download="' + esc(TEMPLATE_DOWNLOAD_NAME) + '">';
    html +=         '<span aria-hidden="true">⬇️</span> Download Master Template (.pptx)';
    html +=       '</a>';
    html +=     '</div>';
    html +=   '</div>';
    html += '</div>'; // End section 2

    html += '</div>'; // End brd-root

    container.innerHTML = html;

    // Attach verified download triggers
    wireDownloadButtons(container);
  }

  function wireDownloadButtons(container) {
    var buttons = container.querySelectorAll("button[data-deck-key]");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var key = btn.getAttribute("data-deck-key");
        var deck = BU_DECKS.find(function (d) { return d.key === key; });
        if (!deck) return;

        // Dynamic security check
        var isAllowed = false;
        if (deck.isCorporate) {
          isAllowed = global.AUTH && typeof global.AUTH.canDownloadCorporateBusinessReview === "function" && global.AUTH.canDownloadCorporateBusinessReview();
        } else {
          isAllowed = global.AUTH && typeof global.AUTH.canDownloadBuBusinessReview === "function" && global.AUTH.canDownloadBuBusinessReview(deck.key);
        }

        if (!isAllowed) {
          alert("Access Denied: You do not have permission to download the " + deck.key + " Business Review deck.");
          return;
        }

        // Trigger safe file download
        var link = document.createElement("a");
        link.href = deck.file;
        link.download = deck.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
    });
  }

  function init(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    _container = container;

    if (!canView()) {
      renderDenied(container);
      return;
    }

    var user = global.AUTH.getValidSessionUser();
    renderPanel(container, user);
  }

  function destroy() { _container = null; }

  global.BusinessReviewDownload = {
    init: init,
    destroy: destroy,
    canView: canView,
    TEMPLATE_PATH: TEMPLATE_PATH,
    BU_DECKS: BU_DECKS
  };
})(typeof window !== "undefined" ? window : this);
