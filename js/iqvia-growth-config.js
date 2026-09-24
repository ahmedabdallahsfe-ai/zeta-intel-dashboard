/* ═══════════════════════════════════════════════════════════════════
   IQVIA GROWTH-RANKING RULES — business configuration (2026-09-24)
   Read by js/iqvia.js (rankGrowth / growthRuleMinShare). Change the
   value here only; no code change needed. Missing file -> default 0.5.

   Applies to every "Fastest Growing / Biggest Decliner" card:
   Executive (Company), DM1, DM2 and ATC4.
   Eligible to be ranked when ALL of:
     - prior-period sales > 0 on the selected metric (LCV or SU)
     - current share of the CURRENTLY FILTERED market >= minSharePct
   Growth is computed on the selected metric. Items with no prior sales
   are shown separately as "New entrant" (never ranked).
   Growth classes everywhere: Normal / Low base / New / Exit
   (see IQVIA_GROWTH_AND_RESTATEMENT_METHODOLOGY.md).
   Approved: Ahmed (SFE Manager), 2026-09-24.
═══════════════════════════════════════════════════════════════════ */
window.IQVIA_GROWTH_RULES = {
  minSharePct: 0.5,        // % of the currently filtered market (selected metric) to be ranked
  lowBaseGrowthPct: 1000   // growth above +1,000% (current > 11x prior) = 'Low base': shown as
                           // Low base (actual % on hover), no EVI/RGI, excluded from rankings,
                           // counts and averages. Approved 2026-09-24 (methodology v1.0).
};
