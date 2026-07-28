/**
 * js/business-review-content.js
 * =====================================================================
 * PLATFORM ASSET. Exposes window.BUSINESS_REVIEW_CONTENT.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * js/executive.js's per-BU Executive Business Review is built once, as a
 * reusable 16-section schema that runs identically for every BU using
 * live computed data (js/business-review-engine.js). Most sections are
 * fully data-driven and need no per-BU authoring. A handful of narrative
 * sections (Executive Summary, Root Cause Analysis, Cause-and-Effect
 * Chain, Investment Scenarios, Opportunity Cost Analysis, Strategic
 * Decision Points narrative, Recommended Actions, Management Action
 * Tracker, Executive Outlook) carry more executive nuance when written
 * by an analyst than a generic template can produce.
 *
 * This file is that swappable content layer -- NOT a code file. Every
 * field below is OPTIONAL. When a field is present for a BU,
 * js/executive.js renders it verbatim in place of its generic,
 * data-driven fallback. When absent (as for every BU except CHC today),
 * the generic fallback runs instead -- every BU still gets a fully
 * populated, non-fabricated review, never a "coming soon" gap.
 *
 * CHC's content below is transcribed verbatim from the analyst-authored
 * `CHC_Pilot_Executive_Business_Review.md` (V3, the Management Decision
 * Pack that validated this platform's methodology). Cluster/DIAB/GIT are
 * intentionally empty objects -- populate them here, in this same
 * shape, once each BU has its own analyst-authored pass. This is also
 * the exact target shape Phase 5a (AI Executive Analyst) will need to
 * auto-generate once built -- see PLATFORM_ROADMAP.md.
 * =====================================================================
 */

(function (global) {
  "use strict";

  global.BUSINESS_REVIEW_CONTENT = {
    CHC: {
      executiveSummary:
        "CHC is the portfolio's only \"At Risk\" Business Unit, and the reason is resourcing, not demand. " +
        "It has the fastest-growing, highest-momentum market of the four BUs (IQVIA-confirmed) but the " +
        "portfolio's weakest field-force health, coverage, and call frequency — and consequently its weakest " +
        "sales achievement. This review asks the Executive Committee to decide how, not whether, to close " +
        "that resourcing gap, and separately whether CHC's small current size should be weighed against or " +
        "alongside its disproportionately high return on incremental investment.",

      rootCauseRows: [
        { claim: "Vacancy (26.5%) → lowest coverage & frequency → lowest sales achievement", tag: "INTERPRETATION", confidence: 78, basis: "Coverage + SFE + Sales agree on direction" },
        { claim: "The original CHC target was reasonable — the miss is execution, not target-setting", tag: "INTERPRETATION", confidence: 65, basis: "Inferred from confirmed IQVIA market growth; no direct target audit trail" },
        { claim: "194.5% Zeta growth is a durable trend", tag: "HYPOTHESIS", confidence: 30, basis: "Only one YoY MAT comparison point; needs multi-year history" },
        { claim: "Vacancy is evenly spread across CHC territories", tag: "HYPOTHESIS — unresolved", confidence: "—", basis: "No brick-level data yet (Action #3)" }
      ],

      causeEffectChain:
        "Vacancy (26.5%, worst in portfolio) → fewer reps in-territory → lowest coverage (78.5%) & " +
        "right-freq (50.7%) → fewer/less-frequent details in a confirmed-growing market → sales stuck " +
        "~51% of target, despite Zeta still gaining share (+3.2pts) because underlying demand is strong " +
        "enough to partly overcome the gap.",

      decisionOptionsNarrative:
        "CHC ranks #1 of 4 on Expected ROI (18.7 — roughly 6x the next-best BU) and #4 of 4 on Strategic " +
        "Importance-by-size and Market Opportunity (it is the smallest BU by revenue and market value today). " +
        "Both are true simultaneously; neither cancels the other. Options on the table, none pre-selected: " +
        "(A) Prioritize CHC now on the strength of dimensions 2–4, 6–9 — accept the size/strategic-importance " +
        "trade-off because expected marginal return is highest. (B) Hold CHC at current resourcing, prioritize " +
        "a larger/more strategically-weighted BU instead — accept leaving the highest-ROI opportunity " +
        "partially uncaptured. (C) Partial/staged investment in CHC while gathering the missing qualitative " +
        "inputs (dimensions 1, 5, 11, 12) before committing fully. This review does not select between A/B/C " +
        "— that requires dimensions 11 and 12, which only the Executive Committee can supply. The Executive " +
        "Outlook reflects Option C as the pack's working assumption only because it is the lowest-regret path " +
        "while those inputs are gathered — not a modeled recommendation.",

      investmentScenarios: [
        { scenario: "Optimistic", assumption: "Vacancy <10% in 60 days; coverage/right-freq to portfolio average (~85%/65%)", achievementDirection: "High-70s–low-80s%", confidence: "Low (35)" },
        { scenario: "Expected", assumption: "Vacancy ~15% in one quarter; partial improvement (~82%/58%)", achievementDirection: "Mid-60s%", confidence: "Medium (60) — base case" },
        { scenario: "Conservative", assumption: "Hiring delays past one quarter; marginal improvement (~80%/53%)", achievementDirection: "High-50s%, modest only", confidence: "Medium (55)" }
      ],

      opportunityCostRows: [
        { path: "Net-new hiring", donorGivesUp: "Nothing internal; 60–90 day time cost", tradeoff: "Best long-term option, no BU loses capacity" },
        { path: "Reallocate from DIAB", donorGivesUp: "DIAB's vacancy rises from 6.9% toward CHC's need; its Sales Force Health (currently portfolio-best, 93.1) declines", tradeoff: "DIAB has the most spare execution capacity of the four — but this is a real bet, not a free lunch" },
        { path: "Reallocate from Cluster/GIT", donorGivesUp: "Reduces coverage in the two largest revenue bases", tradeoff: "Higher-cost option; not recommended without further modeling" }
      ],

      recommendedActionsOverride: [
        "Interim reallocation into CHC (from DIAB, staged) — de-risks timeline while net-new hiring proceeds.",
        "Net-new hiring for the remaining CHC gap.",
        "Brick-level coverage-vs-potential diagnostic — resolves the \"even vs. concentrated vacancy\" hypothesis, and directly informs how #1–2 should be targeted.",
        "Right-frequency coaching intervention.",
        "Reconcile the Coverage-vs-SFE headcount discrepancy (governance, not commercial)."
      ],

      actionTrackerOverride: [
        { n: 1, action: "Interim reallocation into CHC", priority: "P1", impact: "High", difficulty: "Medium", timeToBenefit: "Weeks", owner: "CHC + DIAB RM/DM", targetDate: "2 weeks", kpi: "CHC coverage ≥85%", status: "Not started" },
        { n: 2, action: "Net-new hiring, remaining gap", priority: "P1", impact: "High", difficulty: "Medium-High", timeToBenefit: "Quarter", owner: "CHC BU Head + TA", targetDate: "90 days", kpi: "CHC vacancy <10%", status: "Not started" },
        { n: 3, action: "Brick-level diagnostic", priority: "P1 (enabling)", impact: "Medium", difficulty: "Low", timeToBenefit: "2 weeks", owner: "SFE/Analytics", targetDate: "2 weeks", kpi: "Heat map delivered", status: "Not started" },
        { n: 4, action: "Right-frequency coaching", priority: "P2", impact: "Medium", difficulty: "Low-Medium", timeToBenefit: "30–60 days", owner: "CHC RM/DM + Training", targetDate: "1 quarter", kpi: "Right-freq ≥65%", status: "Not started" },
        { n: 5, action: "Headcount reconciliation", priority: "P3", impact: "Low", difficulty: "Low", timeToBenefit: "Ongoing", owner: "Data/Analytics", targetDate: "Next refresh", kpi: "One reconciled figure", status: "Not started" }
      ],

      executiveOutlookOverride: {
        whatHappened: "CHC is the portfolio's only At-Risk BU — execution-driven, not demand-driven.",
        why: "Highest vacancy (26.5%) cascades into worst coverage, frequency, and achievement.",
        decide: "(a) Resolve the Strategic Investment Scenario (A/B/C) — needs dimensions 11–12 input; (b) approve the brick-level diagnostic regardless of (a)'s outcome.",
        expectedImpact: "Achievement direction: mid-60s to low-80s%, scenario-dependent.",
        costOfInaction: "Compounding monthly against a market growing 70.6% MAT — unlike a flat market, delay has a rising, not fixed, cost.",
        workingAssumption: "Option C (staged) — lowest-regret path, not a modeled recommendation."
      }
    },

    // Populate in this same shape once each BU has its own analyst-authored
    // pass. Until then, js/executive.js's generic, data-driven fallback
    // covers every field below -- these BUs are not "incomplete" in the UI,
    // they simply run on the reusable formulaic path today.
    Cluster: {},
    DIAB: {},
    GIT: {}
  };
})(window);
