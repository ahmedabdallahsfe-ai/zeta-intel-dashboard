/**
 * ASK THE DATA — Zeta Organogram (SFE) adapter
 * ============================================================================
 *
 * BUILT ON THE SFE SEMANTIC INTERFACE.
 *
 * Every figure here comes from `window.SFEDashboard`'s semantic functions
 * and data model: getBusinessSummary, getFilteredHeadcountForLine,
 * getHierarchyList, and getData.
 *
 * Same role-based data scoping is preserved: restricted users can only query
 * and view SFE stats within their authorized BUs and lines.
 */
(function (global) {
  "use strict";

  var ID = "sfe";

  function SFE() { return global.SFEDashboard; }
  function SEM() { return global.SEMANTIC; }

  /** BUs this user may see. */
  function allowedBUs() {
    if (!SEM() || !SEM().BU_LIST) return [];
    var list = SEM().BU_LIST.slice();
    if (global.AUTH && global.AUTH.filterAllowedBUs) {
      return global.AUTH.filterAllowedBUs(list);
    }
    return list;
  }

  /** Lines this user may see. */
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

    var sfeData = SFE() ? SFE().getData() : {};
    var bus = allowedBUs();
    var lines = allowedLines();

    // Unique managers
    var mgrSet = new Set();
    if (sfeData.vacancyByManager) {
      sfeData.vacancyByManager.forEach(function (m) {
        if (m.manager) mgrSet.add(m.manager);
      });
    }
    if (sfeData.spanOfControl) {
      if (sfeData.spanOfControl.dmSpan) {
        sfeData.spanOfControl.dmSpan.forEach(function (s) {
          if (s.dm) mgrSet.add(s.dm);
        });
      }
      if (sfeData.spanOfControl.asmSpan) {
        sfeData.spanOfControl.asmSpan.forEach(function (s) {
          if (s.asm) mgrSet.add(s.asm);
        });
      }
    }
    if (sfeData.dmHierarchy) {
      Object.keys(sfeData.dmHierarchy).forEach(function (dm) {
        var info = sfeData.dmHierarchy[dm];
        if (info.asm) mgrSet.add(info.asm);
        if (info.nsm) mgrSet.add(info.nsm);
        if (info.bum) mgrSet.add(info.bum);
      });
    }

    // Unique employees
    var empSet = new Set();
    var list = SFE() ? SFE().getHierarchyList() : [];
    list.forEach(function (x) {
      if (x.name && x.name.toUpperCase() !== "VACANT") {
        empSet.add(x.name);
      }
    });

    _vocab = {
      bus: bus,
      lines: lines,
      managers: Array.from(mgrSet).filter(Boolean).sort(),
      employees: Array.from(empSet).filter(Boolean).sort()
    };
    _vocabKey = userKey;
    return _vocab;
  }

  function invalidate() { _vocab = null; _vocabKey = null; }

  function lineBU(line) {
    var map = SEM() && SEM().CANONICAL_LINE_TO_BU;
    return map ? (map[line] || null) : null;
  }

  function contextFor(ents) {
    var bu = null, line = null, manager = null, employee = null;
    ents.forEach(function (e) {
      if (e.dim.key === "bu" && !bu) bu = e.name;
      else if (e.dim.key === "line" && !line) line = e.name;
      else if (e.dim.key === "manager" && !manager) manager = e.name;
      else if (e.dim.key === "employee" && !employee) employee = e.name;
    });
    if (!bu && line) bu = lineBU(line);
    return { bu: bu, line: line, manager: manager, employee: employee };
  }

  function figureFor(e) {
    var key = e.dim.key, name = e.name;
    if (key === "bu") {
      var buSum = SFE().getFilteredHeadcountForLine(name, null);
      if (!buSum || !buSum.ok) return null;
      return { name: name, total: buSum.headcountTotal, active: buSum.headcountActive, vacant: buSum.headcountVacant, vacancyRate: buSum.vacancyRatePct };
    }
    if (key === "line") {
      var lineSum = SFE().getFilteredHeadcountForLine(lineBU(name), name);
      if (!lineSum || !lineSum.ok) return null;
      return { name: name, total: lineSum.headcountTotal, active: lineSum.headcountActive, vacant: lineSum.headcountVacant, vacancyRate: lineSum.vacancyRatePct };
    }
    return null;
  }

  function answerFigure(q, ctx, parsed) {
    var E = global.AskEngine;
    var data = SFE() ? SFE().getData() : {};

    // 1. Span of Control questions
    var wantSpan = /\bspan|control|ratio|reps per/i.test(q);
    if (wantSpan) {
      if (ctx.manager) {
        var dmMatch = (data.spanOfControl.dmSpan || []).filter(function (s) {
          return s.dm.toLowerCase().trim() === ctx.manager.toLowerCase().trim();
        })[0];
        if (dmMatch) {
          var headline = ctx.manager + " — Span of Control: " + dmMatch.span + " representatives";
          var detail = "Oversees " + dmMatch.span + " active representative(s) in line " + dmMatch.line + ".";
          return {
            ok: true,
            type: "figure",
            headline: headline,
            detail: detail,
            answer: {
              headline: headline,
              interpretation: detail
            },
            formula: "span = count of active representatives reporting to DM",
            evidence: [
              ["District Manager", ctx.manager],
              ["Line", dmMatch.line],
              ["Span of Control", dmMatch.span + " reps"]
            ]
          };
        }
        var asmMatch = (data.spanOfControl.asmSpan || []).filter(function (s) {
          return s.asm.toLowerCase().trim() === ctx.manager.toLowerCase().trim();
        })[0];
        if (asmMatch) {
          var headline = ctx.manager + " — Span of Control: " + asmMatch.span + " District Managers";
          var detail = "Oversees " + asmMatch.span + " active DM(s) in line " + asmMatch.line + ".";
          return {
            ok: true,
            type: "figure",
            headline: headline,
            detail: detail,
            answer: {
              headline: headline,
              interpretation: detail
            },
            formula: "span = count of active DMs reporting to ASM",
            evidence: [
              ["Area Sales Manager", ctx.manager],
              ["Line", asmMatch.line],
              ["Span of Control", asmMatch.span + " DMs"]
            ]
          };
        }
        return { ok: false, message: "No span of control record found for manager " + ctx.manager };
      }
      var headline = "Average Span: " + data.spanOfControl.averageDmSpan.toFixed(1) + " reps/DM · " + data.spanOfControl.averageAsmSpan.toFixed(1) + " DMs/ASM";
      var detail = "Overall active averages computed across the entire organogram.";
      return {
        ok: true,
        type: "figure",
        headline: headline,
        detail: detail,
        answer: {
          headline: headline,
          interpretation: detail
        },
        formula: "average span = active subordinates ÷ active managers",
        evidence: [
          ["Average DM Span", data.spanOfControl.averageDmSpan.toFixed(1) + " reps"],
          ["Average ASM Span", data.spanOfControl.averageAsmSpan.toFixed(1) + " DMs"]
        ]
      };
    }

    // 2. Workload / Bricks questions
    var wantWorkload = /\bworkload|brick|overload/i.test(q);
    if (wantWorkload) {
      var overloadedCount = (data.brickWorkload.overloadedReps || []).length;
      var headline = "Average Bricks: " + data.brickWorkload.averageBricksPerRep.toFixed(1) + " per rep (" + overloadedCount + " overloaded rep(s))";
      var detail = "Workload split: Light: " + data.brickWorkload.buckets.light + " · Balanced: " + data.brickWorkload.buckets.balanced + " · Dense: " + data.brickWorkload.buckets.dense + " · Overloaded: " + data.brickWorkload.buckets.overloaded + ".";
      return {
        ok: true,
        type: "figure",
        headline: headline,
        detail: detail,
        answer: {
          headline: headline,
          interpretation: detail
        },
        formula: "average workload = sum of bricks mapped to reps ÷ total active reps",
        evidence: [
          ["Average Workload", data.brickWorkload.averageBricksPerRep.toFixed(1) + " bricks/rep"],
          ["Overloaded Reps", overloadedCount],
          ["Heavy Load Reps", data.brickWorkload.buckets.dense]
        ]
      };
    }

    // 3. Tenure/stability questions
    var wantTenure = /\btenure|stability|month|probation|turnover|attrition/i.test(q);
    if (wantTenure) {
      var headline = "Average Tenure: " + data.tenureStability.averageRepTenureMonths.toFixed(1) + " months";
      var detail = "Active roster: " + data.tenureStability.lifecycleCounts.probation + " reps on probation · " + data.tenureStability.lifecycleCounts.nonProbation + " reps non-probation.";
      return {
        ok: true,
        type: "figure",
        headline: headline,
        detail: detail,
        answer: {
          headline: headline,
          interpretation: detail
        },
        formula: "average tenure = sum of employment tenure months ÷ total active reps",
        evidence: [
          ["Average Tenure", data.tenureStability.averageRepTenureMonths.toFixed(1) + " months"],
          ["Probation Roster", data.tenureStability.lifecycleCounts.probation],
          ["Non-Probation Roster", data.tenureStability.lifecycleCounts.nonProbation],
          ["As of", "headcount point-in-time snapshot"]
        ]
      };
    }

    // 4. Default: Vacancy & Headcount queries
    if (ctx.manager) {
      var mgrMatch = (data.vacancyByManager || []).filter(function (m) {
        return m.manager.toLowerCase().trim() === ctx.manager.toLowerCase().trim();
      })[0];
      if (!mgrMatch) {
        return {
          ok: false,
          message: "Manager “" + ctx.manager + "” has no vacant position records.",
          hint: "This manager may have a fully filled team, or sits outside your access scope."
        };
      }
      var headline = ctx.manager + " — Vacancy Rate: " + E.fmtPct(mgrMatch.vacancyRate);
      var detail = mgrMatch.vacant + " vacant position(s) out of " + mgrMatch.total + " total budgeted seats.";
      return {
        ok: true,
        type: "figure",
        headline: headline,
        detail: detail,
        answer: {
          headline: headline,
          interpretation: detail
        },
        formula: "vacancy rate = vacant seats ÷ total seats × 100",
        evidence: [
          ["Manager", ctx.manager],
          ["Total Seats", mgrMatch.total],
          ["Active Seats", mgrMatch.active],
          ["Vacant Seats", mgrMatch.vacant],
          ["Vacancy Rate", E.fmtPct(mgrMatch.vacancyRate)]
        ]
      };
    }

    if (ctx.line || ctx.bu) {
      var targetBU = ctx.bu || lineBU(ctx.line);
      var lineSum = SFE().getFilteredHeadcountForLine(targetBU, ctx.line || null);
      if (!lineSum || !lineSum.ok) return { ok: false, message: "No organogram data found for " + (ctx.line || targetBU) };
      var labelName = ctx.line || targetBU;
      var headline = labelName + " — Vacancy Rate: " + E.fmtPct(lineSum.vacancyRatePct);
      var detail = lineSum.headcountVacant + " vacant position(s) out of " + lineSum.headcountTotal + " budgeted positions.";
      return {
        ok: true,
        type: "figure",
        headline: headline,
        detail: detail,
        answer: {
          headline: headline,
          interpretation: detail
        },
        formula: "vacancy rate = vacant positions ÷ total positions × 100",
        evidence: [
          ["BU/Line", labelName],
          ["Total Positions", lineSum.headcountTotal],
          ["Active Headcount", lineSum.headcountActive],
          ["Vacant Positions", lineSum.headcountVacant],
          ["Vacancy Rate", E.fmtPct(lineSum.vacancyRatePct)]
        ]
      };
    }

    // Default blended headcount totals
    var bus = allowedBUs();
    var s = SFE().getBusinessSummary();
    if (!s || !s.ok) return { ok: false, message: "Zeta Organogram cache is loading..." };
    var tot = 0, act = 0, vac = 0;
    bus.forEach(function (name) {
      var x = s.bu[name];
      if (x) {
        tot += x.headcountTotal || 0;
        act += x.headcountActive || 0;
        vac += x.headcountVacant || 0;
      }
    });
    var headline = E.fmtPct(tot > 0 ? (vac / tot) * 100 : 0) + " vacancy rate overall";
    var detail = vac + " vacant positions out of " + tot + " budgeted seats across your allowed BUs (" + bus.join(", ") + ").";
    return {
      ok: true,
      type: "figure",
      headline: headline,
      detail: detail,
      answer: {
        headline: headline,
        interpretation: detail
      },
      formula: "blended vacancy rate = sum of vacant seats ÷ sum of budgeted seats × 100",
      evidence: [
        ["Allowed BUs", bus.join(", ")],
        ["Total Budgeted Seats", tot],
        ["Active Representatives", act],
        ["Vacant Positions", vac]
      ]
    };
  }

  function answerTop(q, ctx, parsed) {
    var E = global.AskEngine;
    var n = parsed.n, bottom = parsed.bottom;
    var wantLine = /\b(line|team)s?\b/i.test(q);
    var wantManager = /\b(manager|dm|district|asm|nsm)s?\b/i.test(q);

    var rows = [], nameHeader = "", columns = ["Vacancy Rate", "Vacancies", "Active Seats"], scopeTxt = "";

    if (wantManager) {
      var data = SFE() ? SFE().getData() : {};
      nameHeader = "Manager";
      scopeTxt = "managers by vacancy rate";
      rows = (data.vacancyByManager || []).map(function (m) {
        return { name: m.manager, sort: m.vacancyRate || 0, cells: [
          E.fmtPct(m.vacancyRate), m.vacant, m.active
        ] };
      });
    } else {
      // Lines vacancy ranking
      var targetBU = ctx.bu || allowedBUs()[0];
      nameHeader = "Line";
      scopeTxt = "lines in " + targetBU;
      allowedLines().forEach(function (line) {
        if (lineBU(line) !== targetBU) return;
        var lineSum = SFE().getFilteredHeadcountForLine(targetBU, line);
        if (lineSum && lineSum.ok && lineSum.total > 0) {
          rows.push({
            name: line,
            sort: lineSum.vacancyRate || 0,
            cells: [E.fmtPct(lineSum.vacancyRate), lineSum.vacant, lineSum.active]
          });
        }
      });
    }

    if (!rows.length) {
      return { ok: false, message: "No organogram ranking available for that selection." };
    }

    rows.sort(function (a, b) { return bottom ? a.sort - b.sort : b.sort - a.sort; });
    var shown = rows.slice(0, n).map(function (r, i) {
      return { rank: i + 1, name: r.name, cells: r.cells };
    });

    var headline = (bottom ? "Bottom " : "Top ") + shown.length + " " + nameHeader.toLowerCase() + (shown.length === 1 ? "" : "s") + " by vacancy rate";
    var detail = "Within " + scopeTxt + ", ranked by vacancy rate.";

    return {
      ok: true,
      type: "top_n",
      headline: headline,
      detail: detail,
      answer: {
        headline: headline,
        interpretation: detail
      },
      nameHeader: nameHeader,
      columns: columns,
      rows: shown,
      formula: "Ranked by vacancy rate (vacant/total budgeted), " + (bottom ? "ascending" : "descending"),
      evidence: [
        ["Total Items Ranked", rows.length]
      ]
    };
  }

  function answerCompare(q, ents) {
    var E = global.AskEngine;
    if (ents.length < 2) return null;
    var cols = [];
    for (var i = 0; i < 2; i++) {
      var e = ents[i];
      var got = figureFor(e);
      if (!got) return null;
      cols.push(got);
    }
    var headline = cols[0].name + " vs " + cols[1].name + " headcount comparison";
    var detail = cols[0].vacancyRate <= cols[1].vacancyRate
      ? cols[0].name + " has a healthier fill rate (lower vacancy rate)."
      : cols[1].name + " has a healthier fill rate (lower vacancy rate).";

    return {
      ok: true,
      type: "compare",
      headline: headline,
      detail: detail,
      answer: {
        headline: headline,
        interpretation: detail
      },
      compare: cols,
      compareRows: [
        ["Vacancy Rate", function (c) { return E.fmtPct(c.vacancyRate); }],
        ["Vacant Positions", function (c) { return E.fmtNum(c.vacant); }],
        ["Active Headcount", function (c) { return E.fmtNum(c.active); }],
        ["Budgeted Positions", function (c) { return E.fmtNum(c.total); }]
      ],
      formula: "Compare headcount and vacancy metrics side-by-side",
      evidence: [
        ["Measure", "Vacancy rate and headcount count"]
      ]
    };
  }

  var adapter = {
    id: ID,
    title: "Ask the Data",
    subtitle: "Type a question about headcount, vacancy, span of control or workload. Answers respect your access role.",
    placeholder: "Ask about a BU, line, manager or employee...",
    notFoundHint: "Name a BU, line, manager or representative you have access to — for example “CHC vacancy rate” or “overloaded reps”.",

    get examples() {
      var v = vocab();
      var out = [];
      if (v.bus.length) out.push("What is " + v.bus[0] + " vacancy rate?");
      if (v.bus.length) out.push("What is average span of control?");
      if (v.bus.length) out.push("Who are the overloaded reps?");
      if (v.managers.length) out.push("Vacancies under " + v.managers[0]);
      if (v.bus.length >= 2) out.push("Compare " + v.bus[0] + " and " + v.bus[1] + " headcount");
      return out;
    },

    get dims() {
      var v = vocab();
      return [
        { key: "bu",       label: "Business Unit", names: v.bus,       minAlias: 3 },
        { key: "line",     label: "Line",          names: v.lines,     minAlias: 3 },
        { key: "manager",  label: "Manager",       names: v.managers,  minAlias: 4 },
        { key: "employee", label: "Employee",      names: v.employees, minAlias: 4 }
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
      return "Zeta Organogram cache · Point-in-time snapshot";
    },

    answer: function (q, parsed) {
      if (!SFE() || !SEM()) {
        return { ok: false, message: "The organogram layer has not loaded yet." };
      }
      var ctx = contextFor(parsed.entities);

      if (parsed.intent === "compare" && parsed.entities.length >= 2) {
        var cmp = answerCompare(q, parsed.entities);
        if (cmp) return cmp;
      }
      if (parsed.intent === "top" || parsed.bottom) return answerTop(q, ctx, parsed);

      if (/\b(workload|brick|overload|span|control|ratio|tenure|stability|month|probation|turnover|attrition)\b/i.test(q)) {
        return answerFigure(q, ctx, parsed);
      }

      if (!parsed.entities.length && !/\ball\b|\btotal\b|\boverall\b|\bcompany\b|\bhow are we\b/i.test(q)) {
        if (/\b(line|team|manager|dm|district|asm|nsm|vacancy|vacancies)s?\b/i.test(q)) return answerTop(q, ctx, parsed);
      }
      return answerFigure(q, ctx, parsed);
    }
  };

  global.AskSFE = { adapter: adapter, invalidate: invalidate, _vocab: vocab };
})(typeof window !== "undefined" ? window : this);
