/**
 * ASK THE DATA — Executive Root-Cause/Depth Analysis Adapter
 * ============================================================================
 *
 * BUILT ON THE EXECUTIVE-KPI MULTI-DOMAIN SEMANTIC INTERFACES.
 *
 * When a user asks "why" or "root cause" about a Business Unit's underperformance,
 * this adapter queries the Sales, Coverage, and SFE dashboards to diagnose the
 * commercial, execution, and organizational drivers behind the numbers.
 *
 * For standard queries, it delegates directly to the Sales adapter.
 */
(function (global) {
  "use strict";

  var ID = "executive";

  function SD() { return global.SalesDashboard; }
  function CD() { return global.CoverageDashboard; }
  function SFE() { return global.SFEDashboard; }
  function SEM() { return global.SEMANTIC; }

  function scenario() {
    return global.AUTH && global.AUTH.getActiveScenario
      ? global.AUTH.getActiveScenario() : "official";
  }

  function allowedBUs() {
    if (!SEM() || !SEM().BU_LIST) return [];
    var list = SEM().BU_LIST.slice();
    if (global.AUTH && global.AUTH.filterAllowedBUs) {
      return global.AUTH.filterAllowedBUs(list);
    }
    return list;
  }

  function allowedLines() {
    var out = [];
    var map = SEM() && SEM().CANONICAL_LINE_TO_BU;
    if (!map) return out;
    Object.keys(map).forEach(function (name) {
      if (!global.AUTH || !global.AUTH.isLineAllowed || global.AUTH.isLineAllowed(name)) {
        out.push(name);
      }
    });
    return out;
  }

  var _vocab = null;
  var _vocabKey = null;

  function vocab() {
    var userKey = global.AskEngine ? global.AskEngine._currentUserKey() : "?";
    if (_vocab && _vocabKey === userKey) return _vocab;

    // Use Sales vocabulary as base since it covers BUs and lines
    var bus = allowedBUs();
    var lines = allowedLines();

    _vocab = {
      bus: bus,
      lines: lines
    };
    _vocabKey = userKey;
    return _vocab;
  }

  function contextFor(ents) {
    var bu = null, line = null;
    ents.forEach(function (e) {
      if (e.dim.key === "bu" && !bu) bu = e.name;
      else if (e.dim.key === "line" && !line) line = e.name;
    });
    if (!bu && line && window.SEMANTIC) bu = window.SEMANTIC.lineToBU(line);
    return { bu: bu, line: line };
  }

  function fmtEGP(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return global.AskEngine.fmtNum(v) + " EGP";
  }

  /** Run cross-domain diagnostics for a Business Unit */
  function runDiagnostics(bu, q) {
    var E = global.AskEngine;
    var reports = [];

    // --- 1. Commercial (Sales) ---
    var salesSum = SD().getSalesAchievementSummary(bu, null, false, scenario());
    var brandSum = SD().getBrandAchievement(bu, null, false, scenario());
    var dmSum = SD().getDmSalesSummary(bu, null, null, scenario());

    var salesOk = salesSum && salesSum.ok;
    var variance = salesOk ? (salesSum.actualYTD - salesSum.targetYTD) : 0;
    var achPct = salesOk ? salesSum.achievementPct : 0;

    var salesReport = {
      achPct: achPct,
      variance: variance,
      actual: salesOk ? salesSum.actualYTD : 0,
      target: salesOk ? salesSum.targetYTD : 0,
      bottomBrands: [],
      bottomDMs: []
    };

    if (brandSum && brandSum.ok) {
      // Find bottom 2 brands by negative variance
      var brandList = (brandSum.brands || []).map(function (b) {
        return { name: b.name, variance: (b.actualValue - b.targetValue), achPct: b.achievementPct };
      });
      brandList.sort(function (a, b) { return a.variance - b.variance; });
      salesReport.bottomBrands = brandList.slice(0, 2);
    }

    if (dmSum && dmSum.ok) {
      // Find bottom 2 DMs by achievement
      var dmList = (dmSum.dms || []).map(function (d) {
        var ach = d.targetValue > 0 ? (d.actualValue / d.targetValue) * 100 : 0;
        return { name: d.name, achPct: ach, variance: (d.actualValue - d.targetValue) };
      });
      dmList.sort(function (a, b) { return a.achPct - b.achPct; });
      salesReport.bottomDMs = dmList.slice(0, 2);
    }

    // --- 2. Operational (Coverage) ---
    var covSum = CD().getFilteredCoverageForLine(bu, null);
    var coverageReport = {
      coveragePct: covSum && covSum.ok ? covSum.coveragePct : null,
      rightFreqPct: covSum && covSum.ok ? covSum.rightFreqPct : null,
      repCount: covSum && covSum.ok ? covSum.repCount : 0
    };

    // --- 3. People (SFE / Headcount) ---
    var hcSum = SFE().getFilteredHeadcountForLine(bu, null);
    var headcountReport = {
      total: hcSum && hcSum.ok ? hcSum.headcountTotal : 0,
      active: hcSum && hcSum.ok ? hcSum.headcountActive : 0,
      vacant: hcSum && hcSum.ok ? hcSum.headcountVacant : 0,
      vacancyRate: hcSum && hcSum.ok ? hcSum.vacancyRatePct : 0
    };

    // --- Synthesis ---
    var isBehindTarget = variance < 0;
    var headline = bu + " Depth Analysis: " + (isBehindTarget ? "Commercial Gap Identified" : "Solid Performance Maintained");
    if (salesOk) {
      headline = bu + " Diagnostics: Sales at " + E.fmtPct(achPct) + " of target (" + (isBehindTarget ? "" : "+") + fmtEGP(variance) + " variance)";
    }

    var detail = "Multi-domain root cause summary for " + bu + ":\n";
    if (isBehindTarget) {
      detail += "• Sales underperformed target by " + fmtEGP(Math.abs(variance)) + ". ";
      if (salesReport.bottomBrands.length) {
        detail += "Commercial gaps in bottom brands (" + salesReport.bottomBrands.map(function (b) { return b.name + " " + E.fmtPct(b.achPct); }).join(", ") + ") ";
      }
      if (coverageReport.coveragePct !== null && coverageReport.coveragePct < 90) {
        detail += "coincide with operational coverage drops (" + E.fmtPct(coverageReport.coveragePct) + " seen, target 90%). ";
      }
      if (headcountReport.vacant > 0) {
        detail += "Additionally, SFE vacancy rate stands at " + E.fmtPct(headcountReport.vacancyRate) + " (" + headcountReport.vacant + " open seats).";
      }
    } else {
      detail += "• Overall sales are on track. Commercial execution (coverage: " + E.fmtPct(coverageReport.coveragePct) + ") and people fills (active: " + headcountReport.active + "/" + headcountReport.total + ") are stable.";
    }

    // Build evidence table cells
    var rows = [];
    var cellIdx = 1;

    // Sales Drivers
    salesReport.bottomBrands.forEach(function (b) {
      rows.push({
        rank: cellIdx++,
        name: "Brand: " + b.name,
        cells: ["Sales Gap", E.fmtPct(b.achPct), fmtEGP(b.variance)]
      });
    });
    salesReport.bottomDMs.forEach(function (d) {
      rows.push({
        rank: cellIdx++,
        name: "DM Area: " + d.name,
        cells: ["Sales Gap", E.fmtPct(d.achPct), fmtEGP(d.variance)]
      });
    });

    // Coverage Drivers
    if (coverageReport.coveragePct !== null) {
      rows.push({
        rank: cellIdx++,
        name: "Field Coverage (Target: 90%)",
        cells: ["Execution", E.fmtPct(coverageReport.coveragePct), coverageReport.coveragePct >= 90 ? "On Track" : "Drop (" + E.fmtPct(90 - coverageReport.coveragePct) + " pts behind)"]
      });
    }
    if (coverageReport.rightFreqPct !== null) {
      rows.push({
        rank: cellIdx++,
        name: "Right Frequency (Target: 80%)",
        cells: ["Execution", E.fmtPct(coverageReport.rightFreqPct), coverageReport.rightFreqPct >= 80 ? "On Track" : "Drop (" + E.fmtPct(80 - coverageReport.rightFreqPct) + " pts behind)"]
      });
    }

    // People Drivers
    if (headcountReport.total > 0) {
      rows.push({
        rank: cellIdx++,
        name: "SFE Roster Positions",
        cells: ["People", headcountReport.active + " active / " + headcountReport.total + " budgeted", headcountReport.vacant + " vacant (" + E.fmtPct(headcountReport.vacancyRate) + ")"]
      });
    }

    return {
      ok: true,
      question: q,
      headline: headline,
      detail: detail,
      nameHeader: "Diagnostic Factor",
      columns: ["Domain/Metric", "Current Level", "Variance/Status"],
      rows: rows,
      formula: "Cross-workspace diagnostics = Sales Actuals + Field Coverage + SFE Headcount",
      evidence: [
        ["Target BU", bu],
        ["Sales Achievement", E.fmtPct(achPct)],
        ["Sales Variance", fmtEGP(variance)],
        ["Active Reps", headcountReport.active + " reps"],
        ["As of", "Latest calendar sync period"]
      ]
    };
  }

  var adapter = {
    id: ID,
    title: "Executive Analysis",
    subtitle: "Type a question about overall performance, or ask a 'why' / 'root cause' question to diagnose underperforming BUs.",
    placeholder: "Ask 'explain underperformance' or 'diagnose performance'...",
    notFoundHint: "Name a BU and ask 'explain underperformance' or ask sales questions.",

    get examples() {
      var v = vocab();
      var out = [];
      if (v.bus.length) {
        out.push("Diagnose " + v.bus[0] + " performance");
        out.push("How is " + v.bus[0] + " performing?");
        if (v.bus.length > 1) {
          out.push("Explain " + v.bus[1] + " underperformance");
        }
      }
      out.push("Top 10 brands");
      return out;
    },

    get dims() {
      var v = vocab();
      return [
        { key: "bu",   label: "Business Unit", names: v.bus,   minAlias: 3 },
        { key: "line", label: "Line",          names: v.lines, minAlias: 3 }
      ];
    },

    visibleDimValues: function () { return null; },

    scopeLabel: function () {
      if (!global.AUTH || !global.AUTH.getScope) return null;
      var s = global.AUTH.getScope();
      if (s.unrestricted) return null;
      var parts = [];
      if (s.bus && s.bus.length) parts.push(s.bus.join(", "));
      if (s.lines && s.lines.length) {
        parts.push(s.lines.length > 4
          ? s.lines.slice(0, 4).join(", ") + " +" + (s.lines.length - 4) + " more"
          : s.lines.join(", "));
      }
      return parts.length ? parts.join(" · ") : null;
    },

    sourceNote: function () {
      return "Executive Command Center Sync · Multi-source cache";
    },

    answer: function (q, parsed) {
      if (!SD() || !CD() || !SFE() || !SEM()) {
        return { ok: false, message: "The executive semantic layer is loading..." };
      }
      var ctx = contextFor(parsed.entities);

      // LLM-like Intent: Why / Root Cause Diagnosis
      if (parsed.intent === "why") {
        var targetBU = ctx.bu || allowedBUs()[0];
        return runDiagnostics(targetBU, q);
      }

      // Default: delegate to Sales adapter for other queries
      if (global.AskSales && global.AskSales.adapter) {
        return global.AskSales.adapter.answer(q, parsed);
      }

      return { ok: false, message: "Sales Performance adapter is not loaded yet." };
    }
  };

  global.AskExecutive = { adapter: adapter, vocab: vocab };
})(typeof window !== "undefined" ? window : this);
