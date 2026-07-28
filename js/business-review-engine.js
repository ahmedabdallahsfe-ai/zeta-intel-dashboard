/**
 * ZETA ENTERPRISE PLATFORM — business-review-engine.js
 * =====================================================================
 * PLATFORM ASSET. The reusable scoring/ranking engine behind every
 * Business Unit Executive Review. Built once against CHC as the pilot,
 * but nothing in this file references CHC, Cluster, DIAB, or GIT by
 * name -- every function is parameterized by BU key and by the four
 * modules' standardized getBusinessSummary() outputs. Running this
 * file against a different BU, or a fifth BU added in the future,
 * requires zero code changes here -- see BUSINESS_REVIEW_FRAMEWORK.md
 * for the methodology this code implements and the rationale for each
 * formula and weight.
 *
 * Input contract: every function below takes a `summaries` object of
 * the shape:
 *   {
 *     sales:    SalesDashboard.getBusinessSummary(),
 *     coverage: CoverageDashboard.getBusinessSummary(),
 *     sfe:      SFEDashboard.getBusinessSummary(),
 *     iqvia:    IQVIADashboard.getBusinessSummary()
 *   }
 * i.e. the caller collects the four standardized business objects once;
 * this engine only ever reads through that, never through any module's
 * internals -- same module-boundary rule as the interfaces themselves.
 * =====================================================================
 */

(function (global) {
  "use strict";

  function clamp(v, lo, hi) {
    if (v === null || v === undefined || isNaN(v)) return null;
    return Math.max(lo, Math.min(hi, v));
  }

  function get(summaries, source, bu, field) {
    const s = summaries && summaries[source];
    if (!s || !s.ok || !s.bu || !s.bu[bu]) return null;
    return s.bu[bu][field];
  }

  // =====================================================================
  // 8-DIMENSION HEALTH INDEX (per BU)
  // Every sub-score is 0-100, "higher = healthier". See
  // BUSINESS_REVIEW_FRAMEWORK.md section 9 for the rationale behind
  // each formula and why these specific weights were chosen as a
  // starting point (they are configurable, not empirically fitted).
  // =====================================================================
  function computeHealthIndex(bu, summaries) {
    const achievementPct   = get(summaries, 'sales', bu, 'achievementPct');
    const coveragePct      = get(summaries, 'coverage', bu, 'coveragePct');
    const rightFreqPct     = get(summaries, 'coverage', bu, 'rightFreqPct');
    const attritionRatePct = get(summaries, 'coverage', bu, 'attritionRatePct');
    const vacancyRatePct   = get(summaries, 'sfe', bu, 'vacancyRatePct');
    const shareDeltaPts    = get(summaries, 'iqvia', bu, 'shareDeltaPts');
    const zetaGrowthPct    = get(summaries, 'iqvia', bu, 'zetaGrowthPct');
    const marketGrowthPct  = get(summaries, 'iqvia', bu, 'marketGrowthPct');

    // 1. Commercial Performance -- achievement vs target, capped at 100
    //    (hitting target = full health on this axis; overshoot doesn't
    //    inflate the score further, since this is a HEALTH read, not a
    //    performance-ranking read -- overshoot is rewarded separately
    //    in the cross-BU Expected ROI ranking, not here).
    const commercialPerformance = achievementPct === null ? null : clamp(achievementPct, 0, 100);

    // 2. Execution Excellence -- are we reaching the planned universe
    //    (coverage breadth). Kept distinct from Customer Engagement
    //    (below) to avoid double-counting the same underlying Coverage
    //    data under two different dimension names.
    const executionExcellence = coveragePct === null ? null : clamp(coveragePct, 0, 100);

    // 3. Market Competitiveness -- direction and magnitude of share
    //    movement, plus whether Zeta is outgrowing or undergrowing its
    //    own market. Baseline 50 = flat share, flat relative growth.
    const marketCompetitiveness = (shareDeltaPts === null && zetaGrowthPct === null)
      ? null
      : clamp(50
          + (shareDeltaPts || 0) * 5
          + ((zetaGrowthPct !== null && marketGrowthPct !== null) ? (zetaGrowthPct - marketGrowthPct) * 0.15 : 0),
          0, 100);

    // 4. Sales Force Health -- direct inverse of vacancy.
    const salesForceHealth = vacancyRatePct === null ? null : clamp(100 - vacancyRatePct, 0, 100);

    // 5. Customer Engagement -- depth of engagement with already-
    //    covered customers (right-frequency), distinct from breadth
    //    (coverage, used above).
    const customerEngagement = rightFreqPct === null ? null : clamp(rightFreqPct, 0, 100);

    // 6. Growth Potential -- the external market's own growth rate is
    //    the best available proxy for BU upside; this is intentionally
    //    NOT about Zeta's own growth (that's Market Competitiveness).
    const growthPotential = marketGrowthPct === null ? null : clamp(50 + marketGrowthPct * 0.5, 0, 100);

    // 7. Operational Risk (higher = SAFER, consistent with every other
    //    dimension here) -- vacancy is a stock risk, attrition a flow
    //    risk; attrition weighted higher per point since it is the
    //    leading indicator of further vacancy.
    const operationalRisk = (vacancyRatePct === null && attritionRatePct === null)
      ? null
      : clamp(100 - ((vacancyRatePct || 0) * 1.5 + (attritionRatePct || 0) * 3), 0, 100);

    // 8. Overall Business Health -- weighted average of the seven
    //    dimensions above. Weights below are the framework's starting
    //    configuration (documented, adjustable), not a fitted model.
    const weights = {
      commercialPerformance: 0.25,
      executionExcellence: 0.15,
      marketCompetitiveness: 0.15,
      salesForceHealth: 0.15,
      customerEngagement: 0.10,
      growthPotential: 0.10,
      operationalRisk: 0.10
    };
    const parts = {
      commercialPerformance, executionExcellence, marketCompetitiveness,
      salesForceHealth, customerEngagement, growthPotential, operationalRisk
    };
    let weightedSum = 0, weightTotal = 0;
    Object.keys(weights).forEach(k => {
      if (parts[k] !== null) { weightedSum += parts[k] * weights[k]; weightTotal += weights[k]; }
    });
    const overallHealth = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;

    let band = null;
    if (overallHealth !== null) {
      band = overallHealth >= 75 ? 'Strong' : overallHealth >= 55 ? 'At Risk' : 'Critical';
    }

    return {
      bu: bu,
      commercialPerformance: round1(commercialPerformance),
      executionExcellence: round1(executionExcellence),
      marketCompetitiveness: round1(marketCompetitiveness),
      salesForceHealth: round1(salesForceHealth),
      customerEngagement: round1(customerEngagement),
      growthPotential: round1(growthPotential),
      operationalRisk: round1(operationalRisk),
      overallHealth: overallHealth,
      band: band
    };
  }

  function round1(v) { return v === null ? null : Math.round(v * 10) / 10; }

  // =====================================================================
  // CROSS-BU RANKING (all in-scope BUs at once)
  // Six dimensions executives use to allocate resources ACROSS business
  // units, not within one. See BUSINESS_REVIEW_FRAMEWORK.md section 4
  // for the rationale, especially Expected ROI (the formula that
  // produces the CHC pilot's core finding when run generically).
  // =====================================================================
  function computeCrossBURanking(summaries) {
    const rows = window.SEMANTIC.BU_LIST.map(bu => {
      const vacancyRatePct  = get(summaries, 'sfe', bu, 'vacancyRatePct');
      const marketGrowthPct = get(summaries, 'iqvia', bu, 'marketGrowthPct');
      const shareDeltaPts   = get(summaries, 'iqvia', bu, 'shareDeltaPts');
      const marketSize      = get(summaries, 'iqvia', bu, 'marketSizeMATLcv');
      const targetYTD       = get(summaries, 'sales', bu, 'targetYTD');
      const coveragePct     = get(summaries, 'coverage', bu, 'coveragePct');
      const rightFreqPct    = get(summaries, 'coverage', bu, 'rightFreqPct');

      // Growth Potential: external market growth rate, unscaled (raw %,
      // not the 0-100 health-index version) so BUs can be sorted/compared
      // directly on it.
      const growthPotential = marketGrowthPct;

      // Execution Risk (higher = riskier): vacancy plus the shortfall
      // from full coverage/frequency.
      const executionRisk = (vacancyRatePct === null) ? null : round1(
        vacancyRatePct
        + (coveragePct !== null ? (100 - coveragePct) * 0.3 : 0)
        + (rightFreqPct !== null ? (100 - rightFreqPct) * 0.3 : 0)
      );

      // Market Opportunity: absolute market size x growth rate --
      // favors large, fast-growing markets over small fast-growing ones.
      const marketOpportunity = (marketSize !== null && marketGrowthPct !== null)
        ? marketSize * (1 + marketGrowthPct / 100)
        : null;

      // Resource Need: vacancy rate, directly.
      const resourceNeed = vacancyRatePct;

      // Strategic Importance: a DATA-DERIVED PROXY ONLY -- see framework
      // doc. Blends this BU's share of total portfolio Sales target and
      // its share of total portfolio IQVIA market size. Deliberately
      // does NOT claim to capture qualitative strategic factors (patient
      // burden, pipeline dependency, competitive/regulatory positioning).
      const strategicImportance = { targetYTD, marketSize }; // resolved after totals are known, below

      // Expected ROI: growth opportunity multiplied by the fraction of
      // capacity currently unclaimed (vacancy/100). High growth AND high
      // vacancy = high marginal ROI on an incremental rep; high growth
      // but low vacancy = less incremental upside left to capture.
      const expectedROI = (marketGrowthPct !== null && vacancyRatePct !== null)
        ? round1(marketGrowthPct * (vacancyRatePct / 100))
        : null;

      return { bu, growthPotential, executionRisk, marketOpportunity, resourceNeed, strategicImportance, expectedROI };
    });

    // Resolve Strategic Importance now that we have all BUs' totals.
    const totalTarget = rows.reduce((s, r) => s + (r.strategicImportance.targetYTD || 0), 0);
    const totalMarket = rows.reduce((s, r) => s + (r.strategicImportance.marketSize || 0), 0);
    rows.forEach(r => {
      const targetShare = totalTarget > 0 ? (r.strategicImportance.targetYTD || 0) / totalTarget : 0;
      const marketShare = totalMarket > 0 ? (r.strategicImportance.marketSize || 0) / totalMarket : 0;
      r.strategicImportance = round1((targetShare * 0.5 + marketShare * 0.5) * 100); // 0-100 index
    });

    // Rank (1 = best) each dimension independently. For executionRisk and
    // resourceNeed, LOWER is better (less risk/need); for the rest,
    // HIGHER is better.
    function addRanks(field, higherIsBetter) {
      const sorted = rows.slice().filter(r => r[field] !== null)
        .sort((a, b) => higherIsBetter ? b[field] - a[field] : a[field] - b[field]);
      sorted.forEach((r, idx) => { r[field + 'Rank'] = idx + 1; });
    }
    addRanks('growthPotential', true);
    addRanks('executionRisk', false);
    addRanks('marketOpportunity', true);
    addRanks('resourceNeed', false);
    addRanks('strategicImportance', true);
    addRanks('expectedROI', true);

    return rows;
  }

  // =====================================================================
  // EVIDENCE SCORE (per BU) -- 2026-07-26 V4 Evidence Dashboard proposal.
  // ADDITIVE, not a replacement for computeHealthIndex() above:
  // computeHealthIndex() still drives Sections 2/3 (Business Health
  // Assessment, Executive Verdict) and the landing-page BU tiles --
  // changing it would ripple into every section of the 16-part review
  // for a redesign that was only asked for Section 4. This is a
  // deliberately SEPARATE, simpler score -- 6 concrete components tied
  // 1:1 to what's actually shown on the Evidence Dashboard (vs Health
  // Index's more abstract 8 dimensions), used ONLY there. See
  // EXECUTIVE_COMMAND_CENTER_V4_PROPOSAL.md section 3 for the full
  // rationale and the weights below as an explicit, challengeable
  // business judgment call (not a fitted model).
  //
  // Needs three inputs beyond the standard `summaries` object, since
  // these components come from interfaces that take a `bu` parameter
  // rather than returning all 4 BUs at once:
  //   extras.dm1dm2         = IQVIADashboard.getDM1DM2MarketIntel(bu)
  //   extras.execWorkload   = CoverageDashboard.getExecutionWorkloadSummary()
  //   extras.brandAchievement = SalesDashboard.getBrandAchievement(bu)
  // =====================================================================
  function computeEvidenceScore(bu, summaries, extras) {
    extras = extras || {};
    const achievementPct = get(summaries, 'sales', bu, 'achievementPct');
    const vacancyRatePct = get(summaries, 'sfe', bu, 'vacancyRatePct');

    const dm1dm2 = extras.dm1dm2 && extras.dm1dm2.ok ? extras.dm1dm2 : null;
    const execWorkload = extras.execWorkload && extras.execWorkload.ok ? extras.execWorkload : null;
    const brandAchievement = extras.brandAchievement && extras.brandAchievement.ok ? extras.brandAchievement : null;

    // 1. Sales Performance -- achievement vs target, capped at 100 (same
    //    convention as Health Index's commercialPerformance: hitting
    //    target = full score, overshoot doesn't inflate further here).
    const salesPerformance = achievementPct === null ? null : clamp(achievementPct, 0, 100);

    // 2. Brand Portfolio Health (2026-07-26, re-sourced from Sales) -- %
    //    of this BU's targeted brands (targetValue > 0) achieving >=60%
    //    Value-basis achievement, Non-Tender transactions only. Pure
    //    derivation from SalesDashboard.getBrandAchievement(bu) -- NOT
    //    IQVIA market share (that stays in Market Competitiveness below,
    //    unchanged). Brands with no target ("targetValue" 0) are excluded
    //    from both numerator and denominator, not counted as failing.
    let brandPortfolioHealth = null;
    let brandsAtOrAbove60 = null, brandsTargeted = null;
    if (brandAchievement && brandAchievement.brands && brandAchievement.brands.length) {
      const targeted = brandAchievement.brands.filter(b => b.targetValue > 0);
      brandsTargeted = targeted.length;
      brandsAtOrAbove60 = targeted.filter(b => b.achievementPct !== null && b.achievementPct >= 60).length;
      brandPortfolioHealth = brandsTargeted > 0 ? round1((brandsAtOrAbove60 / brandsTargeted) * 100) : null;
    }

    // 3. Market Competitiveness -- this BU's blended DM1 Achievement %
    //    (Zeta's own actual-vs-target across every product, weighted by
    //    market size -- see getDM1DM2MarketIntel's blendAgg()), capped
    //    at 100 for the same "hitting target = full score" reason as #1.
    const marketCompetitiveness = (dm1dm2 && dm1dm2.total && dm1dm2.total.dm1 && dm1dm2.total.dm1.mat.value.achievementPct !== null)
      ? clamp(dm1dm2.total.dm1.mat.value.achievementPct, 0, 100)
      : null;

    // 4. Field Execution -- onTargetCalls / (onTarget+missed+wasted),
    //    already 0-100 by construction.
    const fieldExecution = (execWorkload && execWorkload.bu[bu] && execWorkload.bu[bu].fieldExecutionPct !== null)
      ? clamp(execWorkload.bu[bu].fieldExecutionPct, 0, 100)
      : null;

    // 5. Organization Readiness -- direct inverse of vacancy (same
    //    formula as Health Index's salesForceHealth; kept separate here
    //    since Evidence Score's component set is deliberately its own).
    const organizationReadiness = vacancyRatePct === null ? null : clamp(100 - vacancyRatePct, 0, 100);

    // 6. Growth Momentum -- EVI-based. EVI=100 means growing exactly at
    //    market rate; we treat EVI=150 (growing 50% faster than market)
    //    as a "perfect" 100 score, so score = min(150,evi)/1.5.
    const evi = (dm1dm2 && dm1dm2.total && dm1dm2.total.dm1 && dm1dm2.total.dm1.mat.value.evi !== null) ? dm1dm2.total.dm1.mat.value.evi : null;
    const growthMomentum = evi === null ? null : clamp(Math.min(150, evi) / 1.5, 0, 100);

    const weights = {
      salesPerformance: 0.25,
      brandPortfolioHealth: 0.20,
      marketCompetitiveness: 0.15,
      fieldExecution: 0.15,
      organizationReadiness: 0.15,
      growthMomentum: 0.10
    };
    const parts = { salesPerformance, brandPortfolioHealth, marketCompetitiveness, fieldExecution, organizationReadiness, growthMomentum };
    let weightedSum = 0, weightTotal = 0;
    Object.keys(weights).forEach(k => {
      if (parts[k] !== null) { weightedSum += parts[k] * weights[k]; weightTotal += weights[k]; }
    });
    const totalScore = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;

    return {
      bu: bu,
      salesPerformance: round1(salesPerformance),
      brandPortfolioHealth: round1(brandPortfolioHealth),
      brandsAtOrAbove60: brandsAtOrAbove60,
      brandsTargeted: brandsTargeted,
      marketCompetitiveness: round1(marketCompetitiveness),
      fieldExecution: round1(fieldExecution),
      organizationReadiness: round1(organizationReadiness),
      growthMomentum: round1(growthMomentum),
      totalScore: totalScore,
      weights: weights
    };
  }

  global.BUSINESS_REVIEW_ENGINE = {
    computeHealthIndex: computeHealthIndex,
    computeCrossBURanking: computeCrossBURanking,
    computeEvidenceScore: computeEvidenceScore
  };
})(window);
