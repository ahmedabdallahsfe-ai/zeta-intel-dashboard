/**
 * The real-question bank used by test_ask_rbac.js (scope-leak battery) and qa_report.js (the 50+ question report).
 * Placeholders are resolved per signed-in account from THAT account's own scoped vocabulary:
 *   {BU} {LINE} {BRAND} {DM}  -> the first entity of that kind the account can see.
 * Nothing here is an "FAQ": every question goes through the same plan -> period -> filters -> authorised data ->
 * dashboard calculation path, and the bank only exists so that path can be exercised and audited.
 */
"use strict";
const Q = [
  // ---- Sales (Sales Performance tab) -------------------------------------------------------
  ["SAL-01", "Sales", "sales", "what is the sales achievement"],
  ["SAL-02", "Sales", "sales", "top 5 brands by sales"],
  ["SAL-03", "Sales", "sales", "sales achievement by line"],
  ["SAL-04", "Sales", "sales", "which brands are below target"],
  ["SAL-05", "Sales", "sales", "bottom 5 district managers by sales achievement"],
  ["SAL-06", "Sales", "sales", "sales achievement in March 2026"],
  ["SAL-07", "Sales", "sales", "sales achievement Q1 2026"],
  ["SAL-08", "Sales", "sales", "sales achievement MoM"],
  ["SAL-09", "Sales", "sales", "how is {BRAND} performing"],
  ["SAL-10", "Sales", "sales", "sales of {LINE} YTD"],
  // ---- Coverage / Executive ----------------------------------------------------------------
  ["COV-01", "Coverage", "coverage", "what is the coverage %"],
  ["COV-02", "Coverage", "coverage", "top 5 district managers by right frequency"],
  ["COV-03", "Coverage", "coverage", "coverage by line"],
  ["COV-04", "Coverage", "coverage", "which lines have coverage below 80%"],
  ["COV-05", "Coverage", "coverage", "coverage of {DM}"],
  ["COV-06", "Coverage", "coverage", "coverage in March 2026"],
  ["COV-07", "Coverage", "coverage", "bottom 5 district managers by call rate"],
  ["COV-08", "Coverage", "coverage", "coverage of specialties"],
  ["COV-09", "Coverage", "coverage", "shared customers by line"],
  // ---- SFE / organogram ---------------------------------------------------------------------
  ["SFE-01", "SFE", "sfe", "what is the vacancy rate"],
  ["SFE-02", "SFE", "sfe", "vacancy rate by line"],
  ["SFE-03", "SFE", "sfe", "top 5 managers by vacancy rate"],
  ["SFE-04", "SFE", "sfe", "headcount by line"],
  ["SFE-05", "SFE", "sfe", "which managers are overloaded"],
  // ---- Executive ----------------------------------------------------------------------------
  ["EXE-01", "Executive", "executive", "how is performance"],
  ["EXE-02", "Executive", "executive", "why is sales below target"],
  ["EXE-03", "Executive", "executive", "diagnose {LINE} performance"],
  ["EXE-04", "Executive", "executive", "sales achievement vs coverage"],
  // ---- Field Working Days -------------------------------------------------------------------
  ["WDY-01", "Working Days", "workingdays", "average field working days"],
  ["WDY-02", "Working Days", "workingdays", "field working days by line"],
  ["WDY-03", "Working Days", "workingdays", "bottom 5 district managers by field working days"],
  // ---- Coaching -----------------------------------------------------------------------------
  ["COA-01", "Coaching", "coaching", "what is the coaching coverage"],
  ["COA-02", "Coaching", "coaching", "which lines have the lowest coaching coverage"],
  ["COA-03", "Coaching", "coaching", "how many reps were coached in July 2026"],
  // ---- Zeta Sprint 2026 ---------------------------------------------------------------------
  ["SPR-01", "Sprint", "sprint", "sprint points by line"],
  ["SPR-02", "Sprint", "sprint", "top 5 district managers by sprint points"],
  ["SPR-03", "Sprint", "sprint", "who is winning the sprint"],
  // ---- IQVIA market share -------------------------------------------------------------------
  ["IQV-01", "IQVIA", "iqvia", "what is Zeta market share"],
  ["IQV-02", "IQVIA", "iqvia", "top 5 corporations by sales"],
  ["IQV-03", "IQVIA", "iqvia", "which markets is Zeta growing fastest in"],
  ["IQV-04", "IQVIA", "iqvia", "market growth YTD"],
  // ---- Total Market Intelligence ------------------------------------------------------------
  ["MKT-01", "Market Intelligence", "marketintel", "what is the total market size"],
  ["MKT-02", "Market Intelligence", "marketintel", "top 5 brands by sales value"],
  ["MKT-03", "Market Intelligence", "marketintel", "market CAGR"],
  // ---- IMS Rx -------------------------------------------------------------------------------
  ["RX-01", "IMS Rx", "imsrx", "total prescriptions"],
  ["RX-02", "IMS Rx", "imsrx", "top 5 brands by rx"],
  ["RX-03", "IMS Rx", "imsrx", "which brands lost rx"],
  ["RX-04", "IMS Rx", "imsrx", "rx 2024"],
  // ---- To-Market vs In-Market ---------------------------------------------------------------
  ["TMK-01", "To-Market", "tomarket", "what is the pull-through rate"],
  ["TMK-02", "To-Market", "tomarket", "stock days by business unit"],
  ["TMK-03", "To-Market", "tomarket", "which brands have the biggest stock build"],
  // ---- Definitions / evidence / executive cross-cuts ----------------------------------------
  ["DEF-01", "Definition", "coverage", "how is coverage calculated"],
  ["DEF-02", "Definition", "sales", "how is sales achievement calculated"],
  ["DEF-03", "Definition", "sfe", "what does vacancy rate mean"],
  // ---- Honest-failure probes (the dashboard cannot answer these) ---------------------------
  ["MIS-01", "Missing data", "sales", "what is the gross margin by brand"],
  ["MIS-02", "Missing data", "coverage", "coverage in December 2024"],
  ["MIS-03", "Missing data", "sales", "predict next quarter sales"],
];
module.exports = { QUESTIONS: Q.map(([id, domain, tab, q]) => ({ id, domain, tab, q })) };
