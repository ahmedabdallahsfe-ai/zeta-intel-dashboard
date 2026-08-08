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

  function lineBU(line) {
    return SEM() && SEM().lineToBU ? SEM().lineToBU(line) : null;
  }

  function scenarioLabel() {
    return scenario() === "official" ? "official" : "latest_lbe";
  }

  /** Run cross-domain diagnostics for a Business Unit or Line */
  function runDiagnostics(bu, line, q) {
    var E = global.AskEngine;
    
    // --- 1. Commercial (Sales) ---
    var actual = 0, target = 0, achPct = null;
    var name = line || bu;

    var salesSum = SD().getSalesAchievementSummary(bu, line || null, false, scenario());
    var salesOk = salesSum && salesSum.ok;
    if (salesOk) {
      actual = salesSum.actualYTD;
      target = salesSum.targetYTD;
      achPct = salesSum.achievementPct;
    }

    var netGap = actual - target;
    var shortfall = Math.max(target - actual, 0);

    // MECE contributions calculations
    var contribs = [];
    var sumChildShortfalls = 0;

    if (line) {
      // Level 3 Brand decomposition within a line
      var brandSum = SD().getBrandAchievement(bu, line, false, scenario());
      if (brandSum && brandSum.ok && brandSum.brands) {
        brandSum.brands.forEach(function (b) {
          var bActual = b.actualValue || 0;
          var bTarget = b.targetValue || 0;
          var bShortfall = Math.max(bTarget - bActual, 0);
          var bNetGap = bActual - bTarget;
          contribs.push({
            name: "Brand: " + b.name,
            actual: bActual,
            target: bTarget,
            shortfall: bShortfall,
            netGap: bNetGap,
            achPct: b.achievementPct
          });
          sumChildShortfalls += bShortfall;
        });
      }
    } else {
      // Level 2 Line decomposition within a BU (fallback to brands if getLineSalesSummary is not defined)
      var lineSum = (typeof SD().getLineSalesSummary === "function")
        ? SD().getLineSalesSummary(bu, null, false, scenario())
        : null;
      if (lineSum && lineSum.ok && lineSum.lines) {
        lineSum.lines.forEach(function (l) {
          var lActual = l.actualValue || 0;
          var lTarget = l.targetValue || 0;
          var lShortfall = Math.max(lTarget - lActual, 0);
          var lNetGap = lActual - lTarget;
          contribs.push({
            name: "Line: " + l.name,
            actual: lActual,
            target: lTarget,
            shortfall: lShortfall,
            netGap: lNetGap,
            achPct: l.achievementPct
          });
          sumChildShortfalls += lShortfall;
        });
      } else {
        // Fallback: Level 3 Brand decomposition directly for the BU
        var brandSum = SD().getBrandAchievement(bu, null, false, scenario());
        if (brandSum && brandSum.ok && brandSum.brands) {
          brandSum.brands.forEach(function (b) {
            var bActual = b.actualValue || 0;
            var bTarget = b.targetValue || 0;
            var bShortfall = Math.max(bTarget - bActual, 0);
            var bNetGap = bActual - bTarget;
            contribs.push({
              name: "Brand: " + b.name,
              actual: bActual,
              target: bTarget,
              shortfall: bShortfall,
              netGap: bNetGap,
              achPct: b.achievementPct
            });
            sumChildShortfalls += bShortfall;
          });
        }
      }
    }

    // Set contribution %
    contribs.forEach(function (c) {
      c.contributionPct = sumChildShortfalls > 0 ? (c.shortfall / sumChildShortfalls) * 100 : 0;
    });

    // Sort contributions descending by shortfall
    contribs.sort(function (a, b) { return b.shortfall - a.shortfall; });

    // Legacy sales reports lists for rows
    var salesReport = {
      achPct: achPct,
      variance: netGap,
      actual: actual,
      target: target,
      bottomBrands: [],
      bottomDMs: []
    };

    var brandSum = SD().getBrandAchievement(bu, line || null, false, scenario());
    if (brandSum && brandSum.ok) {
      var brandList = (brandSum.brands || []).map(function (b) {
        return { name: b.name, variance: (b.actualValue - b.targetValue), achPct: b.achievementPct };
      });
      brandList.sort(function (a, b) { return a.variance - b.variance; });
      salesReport.bottomBrands = brandList.slice(0, 2);
    }

    var dmSum = SD().getDmSalesSummary(bu, line || null, null, scenario());
    if (dmSum && dmSum.ok) {
      var dmList = (dmSum.dms || []).map(function (d) {
        var ach = d.targetValue > 0 ? (d.actualValue / d.targetValue) * 100 : 0;
        return { name: d.name, achPct: ach, variance: (d.actualValue - d.targetValue) };
      });
      dmList.sort(function (a, b) { return a.achPct - b.achPct; });
      salesReport.bottomDMs = dmList.slice(0, 2);
    }

    // --- 2. Operational (Coverage) ---
    var covSum = CD().getFilteredCoverageForLine(bu, line || null);
    var coverageReport = {
      coveragePct: covSum && covSum.ok ? covSum.coveragePct : null,
      rightFreqPct: covSum && covSum.ok ? covSum.rightFreqPct : null,
      repCount: covSum && covSum.ok ? covSum.repCount : 0
    };

    // --- 3. People (SFE / Headcount) ---
    var hcSum = SFE().getFilteredHeadcountForLine(bu, line || null);
    var headcountReport = {
      total: hcSum && hcSum.ok ? hcSum.headcountTotal : 0,
      active: hcSum && hcSum.ok ? hcSum.headcountActive : 0,
      vacant: hcSum && hcSum.ok ? hcSum.headcountVacant : 0,
      vacancyRate: hcSum && hcSum.ok ? hcSum.vacancyRatePct : 0
    };

    // --- Synthesis ---
    var isBehindTarget = netGap < 0;
    var headline = name + " Diagnostics: Sales at " + E.fmtPct(achPct) + " of target (" + (isBehindTarget ? "" : "+") + fmtEGP(netGap) + " variance)";
    var detail = "Multi-domain root cause summary for " + name + ":\n";
    if (isBehindTarget) {
      detail += "• Sales underperformed target by " + fmtEGP(Math.abs(netGap)) + ". ";
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

    // Build legacy rows
    var rows = [];
    var cellIdx = 1;

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

    if (headcountReport.total > 0) {
      rows.push({
        rank: cellIdx++,
        name: "SFE Roster Positions",
        cells: ["People", headcountReport.active + " active / " + headcountReport.total + " budgeted", headcountReport.vacant + " vacant (" + E.fmtPct(headcountReport.vacancyRate) + ")"]
      });
    }

    // Dynamic clean narrative
    var story = name + " sales achieved " + E.fmtPct(achPct) + " of the YTD target, resulting in a shortfall of " + fmtEGP(shortfall) + " (actual: " + fmtEGP(actual) + " vs target: " + fmtEGP(target) + "). ";
    if (contribs.length > 0) {
      var underperforming = contribs.filter(function (c) { return c.shortfall > 0; });
      if (underperforming.length > 0) {
        story += "The sales gap is concentrated in: " +
          underperforming.slice(0, 2).map(function (c) {
            return c.name + " (" + fmtEGP(c.shortfall) + " shortfall, accounting for " + E.fmtPct(c.contributionPct) + " of the gap)";
          }).join(", ") + ". ";
      }
    }
    var obsParts = [];
    if (coverageReport.coveragePct !== null && coverageReport.coveragePct < 90) {
      obsParts.push("field coverage is below the 90% benchmark at " + E.fmtPct(coverageReport.coveragePct));
    }
    if (coverageReport.rightFreqPct !== null && coverageReport.rightFreqPct < 80) {
      obsParts.push("right frequency stands at " + E.fmtPct(coverageReport.rightFreqPct) + " (benchmark 80%)");
    }
    if (headcountReport.vacant > 0) {
      obsParts.push("team vacancy rate is " + E.fmtPct(headcountReport.vacancyRate) + " (" + headcountReport.vacant + " open seats)");
    }
    if (obsParts.length > 0) {
      story += "These commercial outcomes coincide with the following operational observations: " + obsParts.join(" and ") + ".";
    } else {
      story += "Operational execution and SFE headcount indicators are within stable parameters.";
    }

    // Explore opportunities
    var explore = [];
    if (!line && contribs.length > 0 && contribs[0].shortfall > 0) {
      var cleanLineName = contribs[0].name.replace(/^Line:\s*/, "");
      explore.push("Analyze " + cleanLineName + " target gap");
    }
    explore.push("How is " + bu + " coverage performing?");
    explore.push("What is " + bu + " vacancy rate?");

    var evidence = [
      ["Target BU", bu],
      ["Sales Achievement", E.fmtPct(achPct)],
      ["Sales Variance", fmtEGP(netGap)],
      ["Shortfall", fmtEGP(shortfall)],
      ["Active Reps", headcountReport.active + " reps"],
      ["As of", "Latest calendar sync period"]
    ];
    if (line) {
      evidence.splice(1, 0, ["Line", line]);
    }

    return {
      ok: true,
      type: "diagnose",
      question: q,
      headline: headline,
      detail: detail,
      answer: {
        headline: headline,
        interpretation: detail
      },
      nameHeader: "Diagnostic Factor",
      columns: ["Domain/Metric", "Current Level", "Variance/Status"],
      rows: rows,
      formula: "Cross-workspace diagnostics = Sales Actuals + Field Coverage + SFE Headcount",
      evidence: evidence,
      contributions: contribs.map(function (c) {
        return {
          entity: c.name,
          actual: c.actual,
          target: c.target,
          gap: c.netGap,
          shortfall: c.shortfall,
          contributionPct: c.contributionPct
        };
      }),
      indicators: (function () {
        var list = [];
        contribs.forEach(function (c) {
          var entName = c.name;
          if (entName.indexOf("Line: ") === 0) {
            var cleanLine = entName.substring(6);
            var lineCov = CD().getFilteredCoverageForLine(bu, cleanLine);
            var lineHc = SFE().getFilteredHeadcountForLine(bu, cleanLine);
            if (lineCov && lineCov.ok) {
              list.push({
                entity: entName,
                metric: "Coverage",
                actual: lineCov.coveragePct !== null ? lineCov.coveragePct.toFixed(1) + "%" : "—",
                benchmark: "90%",
                unit: ""
              });
              list.push({
                entity: entName,
                metric: "Right Frequency",
                actual: lineCov.rightFreqPct !== null ? lineCov.rightFreqPct.toFixed(1) + "%" : "—",
                benchmark: "80%",
                unit: ""
              });
            }
            if (lineHc && lineHc.ok) {
              list.push({
                entity: entName,
                metric: "Vacancy Rate",
                actual: lineHc.vacancyRatePct !== null ? lineHc.vacancyRatePct.toFixed(1) + "%" : "—",
                vacantCount: lineHc.headcountVacant !== undefined ? lineHc.headcountVacant : 0,
                benchmark: "0%",
                unit: ""
              });
            }
          } else if (entName.indexOf("Brand: ") === 0) {
            var targetLine = line || null;
            var lineCov = CD().getFilteredCoverageForLine(bu, targetLine);
            var lineHc = SFE().getFilteredHeadcountForLine(bu, targetLine);
            if (lineCov && lineCov.ok) {
              list.push({
                entity: entName,
                metric: "Coverage",
                actual: lineCov.coveragePct !== null ? lineCov.coveragePct.toFixed(1) + "%" : "—",
                benchmark: "90%",
                unit: ""
              });
              list.push({
                entity: entName,
                metric: "Right Frequency",
                actual: lineCov.rightFreqPct !== null ? lineCov.rightFreqPct.toFixed(1) + "%" : "—",
                benchmark: "80%",
                unit: ""
              });
            }
            if (lineHc && lineHc.ok) {
              list.push({
                entity: entName,
                metric: "Vacancy Rate",
                actual: lineHc.vacancyRatePct !== null ? lineHc.vacancyRatePct.toFixed(1) + "%" : "—",
                vacantCount: lineHc.headcountVacant !== undefined ? lineHc.headcountVacant : 0,
                benchmark: "0%",
                unit: ""
              });
            }
          }
        });
        return list;
      })(),
      story: story,
      explore: explore,
      caveats: []
    };
  }

  function runCommercialExecutionCorrelation(bu, q) {
    var E = global.AskEngine;
    var lines = allowedLines().filter(function (line) {
      return !bu || SEM().lineToBU(line) === bu;
    });

    var rows = [];
    var unsustainableCount = 0;
    var effortNoReturnCount = 0;
    var healthyCount = 0;
    var criticalCount = 0;

    lines.forEach(function (line) {
      var targetBU = bu || SEM().lineToBU(line);
      var salesSum = SD().getSalesAchievementSummary(targetBU, line, false, scenario());
      var covSum = CD().getFilteredCoverageForLine(targetBU, line);

      if (!salesSum || !salesSum.ok || !covSum || !covSum.ok) return;

      var ach = salesSum.achievementPct || 0;
      var cov = covSum.coveragePct || 0;
      var rf = covSum.rightFreqPct || 0;

      var salesHigh = ach >= 95.0;
      var execHigh = cov >= 90.0;

      var status = "";
      if (salesHigh && execHigh) {
        status = "Healthy Core";
        healthyCount++;
      } else if (salesHigh && !execHigh) {
        status = "Unsustainable Growth";
        unsustainableCount++;
      } else if (!salesHigh && execHigh) {
        status = "Effort Without Return";
        effortNoReturnCount++;
      } else {
        status = "Critical Risk";
        criticalCount++;
      }

      rows.push({
        name: line,
        sort: ach,
        cells: [
          E.fmtPct(ach),
          E.fmtPct(cov),
          E.fmtPct(rf),
          status
        ]
      });
    });

    rows.sort(function (a, b) { return b.sort - a.sort; });

    var rankedRows = rows.map(function (r, i) {
      return { rank: i + 1, name: r.name, cells: r.cells };
    });

    var scopeName = bu || "All BUs";
    var headline = scopeName + " Correlation Analysis: " + unsustainableCount + " unsustainable line(s) flagged";
    var detail = "Commercial-Execution correlation summary for " + scopeName + ":\n" +
      "• Healthy Core: " + healthyCount + " line(s) meeting both sales & execution targets.\n" +
      "• Unsustainable Growth: " + unsustainableCount + " line(s) meeting sales but with sub-target coverage (potential distributor loading risk).\n" +
      "• Effort Without Return: " + effortNoReturnCount + " line(s) with high coverage but failing to meet sales targets.\n" +
      "• Critical Risk: " + criticalCount + " line(s) failing both sales and coverage.";

    var story = "The commercial-execution correlation across " + scopeName +
      " segments lines into status quadrants based on a sales achievement threshold of 95% and coverage target of 90%. " +
      "A total of " + healthyCount + " line(s) are categorized as Healthy Core, meeting both criteria. " +
      "There are " + unsustainableCount + " line(s) categorized as Unsustainable Growth (high sales achievement coinciding with low operational coverage), and " +
      effortNoReturnCount + " line(s) in Effort Without Return. " +
      criticalCount + " line(s) are flagged as Critical Risk, exhibiting below-target performance in both domains.";

    return {
      ok: true,
      type: "correlation",
      question: q,
      headline: headline,
      detail: detail,
      answer: {
        headline: headline,
        interpretation: detail
      },
      nameHeader: "Line / Team",
      columns: ["Sales Achievement", "Field Coverage", "Right Freq", "Diagnostic Status"],
      rows: rankedRows,
      formula: "Status Quadrants = Sales Achievement (Threshold: 95%) vs. Coverage (Threshold: 90%)",
      evidence: [
        ["Total Lines Analysed", lines.length],
        ["Unsustainable Growth Lines", unsustainableCount],
        ["Effort Without Return Lines", effortNoReturnCount],
        ["Critical Risk Lines", criticalCount]
      ],
      story: story,
      explore: [],
      caveats: []
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

      // Correlation Intent: Sales vs. Coverage/Execution
      if (parsed.intent === "correlation") {
        var correlationBU = ctx.bu || null;
        return runCommercialExecutionCorrelation(correlationBU, q);
      }

      // LLM-like Intent: Why / Root Cause Diagnosis
      if (parsed.intent === "why") {
        var targetBU = ctx.bu || (ctx.line ? lineBU(ctx.line) : null) || allowedBUs()[0];
        return runDiagnostics(targetBU, ctx.line || null, q);
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
