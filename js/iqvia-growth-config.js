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
   Approved: Ahmed (SFE Manager), 2026-09-24.
═══════════════════════════════════════════════════════════════════ */
window.IQVIA_GROWTH_RULES = {
  minSharePct: 0.5   // % of the currently filtered market (selected metric)
};
