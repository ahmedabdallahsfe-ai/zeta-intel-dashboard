/**
 * ASK THE DATA — Coverage adapter (Operational & Execution)
 * ============================================================================
 *
 * BUILT ON THE COVERAGE SEMANTIC INTERFACE.
 *
 * Every figure here comes from `window.CoverageDashboard`'s semantic functions:
 * getBusinessSummary, getFilteredCoverageSummary, getFilteredCoverageByType,
 * getFilteredCoverageForLine, getFilteredCoverageForDm, getDmRepsList.
 *
 * Same role-based data scoping is preserved: restricted users can only query
 * and view coverage stats within their authorized BUs and lines.
 */
(function (global) {
  "use strict";

  var ID = "coverage";

  function CD() { return global.CoverageDashboard; }
  function SEM() { return global.SEMANTIC; }

  function getDims() {
    if (typeof CacheStore === "undefined" || !CacheStore.isReady()) {
      try { CacheStore.init(); } catch (e) {}
    }
    var dash = typeof CacheStore !== "undefined" ? CacheStore.getDashboard() : null;
    return dash && dash.dimensions ? dash.dimensions : null;
  }

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

    var dims = getDims() || {};
    var bus = allowedBUs();
    var lines = allowedLines();

    _vocab = {
      bus: bus,
      lines: lines,
      dms: (dims.managers || []).filter(Boolean).sort(),
      specialties: (dims.specialties || []).filter(Boolean).sort(),
      classes: (dims.classes || []).filter(Boolean).sort(),
      types: (dims.types || []).filter(Boolean).sort()
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
    var bu = null, line = null, dm = null, specialty = null, klass = null, type = null;
    ents.forEach(function (e) {
      if (e.dim.key === "bu" && !bu) bu = e.name;
      else if (e.dim.key === "line" && !line) line = e.name;
      else if (e.dim.key === "dm" && !dm) dm = e.name;
      else if (e.dim.key === "specialty" && !specialty) specialty = e.name;
      else if (e.dim.key === "class" && !klass) klass = e.name;
      else if (e.dim.key === "type" && !type) type = e.name;
    });
    if (!bu && line) bu = lineBU(line);
    return { bu: bu, line: line, dm: dm, specialty: specialty, klass: klass, type: type };
  }

  function asOf() {
    return "latest period in cache";
  }

  function figureFor(e) {
    var key = e.dim.key, name = e.name;
    if (key === "bu") {
      var buSum = CD().getFilteredCoverageForLine(name, null);
      if (!buSum || !buSum.ok) return null;
      return { name: name, coverage: buSum.coveragePct, rightFreq: buSum.rightFreqPct, reps: buSum.repCount, customers: buSum.customerCount };
    }
    if (key === "line") {
      var lineSum = CD().getFilteredCoverageForLine(lineBU(name), name);
      if (!lineSum || !lineSum.ok) return null;
      return { name: name, coverage: lineSum.coveragePct, rightFreq: lineSum.rightFreqPct, reps: lineSum.repCount, customers: lineSum.customerCount };
    }
    if (key === "dm") {
      var bus = allowedBUs();
      for (var i = 0; i < bus.length; i++) {
        var dmSum = CD().getFilteredCoverageForDm(bus[i], null, name);
        if (dmSum && dmSum.ok && dmSum.customerRowCount > 0) {
          return { name: name, coverage: dmSum.coveragePct, rightFreq: dmSum.rightFreqPct, reps: dmSum.repCount, customers: dmSum.customerRowCount };
        }
      }
    }
    return null;
  }

  function answerFigure(q, ctx, parsed) {
    var E = global.AskEngine;

    if (ctx.dm) {
      var bu = ctx.bu || allowedBUs()[0];
      var dmSum = CD().getFilteredCoverageForDm(bu, ctx.line || null, ctx.dm);
      if (!dmSum || !dmSum.ok) return { ok: false, message: "No operational data found for District Manager " + ctx.dm };
      var headline = ctx.dm + " — " + E.fmtPct(dmSum.coveragePct) + " coverage · " + E.fmtPct(dmSum.rightFreqPct) + " right frequency";
      var detail = dmSum.repCount + " representative(s) overseeing " + dmSum.customerRowCount + " customers in " + bu + (ctx.line ? " / " + ctx.line : "") + ".";

      return {
        ok: true,
        type: "figure",
        headline: headline,
        detail: detail,
        answer: {
          headline: headline,
          interpretation: detail
        },
        formula: "coverage % = active customers seen ÷ total plan customers × 100",
        evidence: [
          ["District Manager", ctx.dm],
          ["Business Unit", bu],
          ["Line", ctx.line || "All"],
          ["Coverage", E.fmtPct(dmSum.coveragePct)],
          ["Right Frequency", E.fmtPct(dmSum.rightFreqPct)],
          ["Active Representatives", dmSum.repCount],
          ["As of", asOf()]
        ]
      };
    }

    if (ctx.line || ctx.bu) {
      var targetBU = ctx.bu || lineBU(ctx.line);
      var lineSum = CD().getFilteredCoverageForLine(targetBU, ctx.line || null);
      if (!lineSum || !lineSum.ok) return { ok: false, message: "No operational data found for " + (ctx.line || targetBU) };
      var labelName = ctx.line || targetBU;
      var headline = labelName + " — " + E.fmtPct(lineSum.coveragePct) + " coverage · " + E.fmtPct(lineSum.rightFreqPct) + " right frequency";
      var detail = "Visited " + E.fmtNum(lineSum.visitCount) + " / " + E.fmtNum(lineSum.plannedVisitCount) + " times across " + E.fmtNum(lineSum.customerCount) + " customer(s) with " + lineSum.repCount + " active rep(s).";

      return {
        ok: true,
        type: "figure",
        headline: headline,
        detail: detail,
        answer: {
          headline: headline,
          interpretation: detail
        },
        formula: "coverage % = visited customers ÷ total customer plan × 100",
        evidence: [
          ["Scope Target", labelName],
          ["Coverage", E.fmtPct(lineSum.coveragePct)],
          ["Right Frequency", E.fmtPct(lineSum.rightFreqPct)],
          ["Actual Visits", E.fmtNum(lineSum.visitCount)],
          ["Target Visits", E.fmtNum(lineSum.plannedVisitCount)],
          ["Active Representatives", lineSum.repCount],
          ["As of", asOf()]
        ]
      };
    }

    // Default: Blended corporate totals for the user's allowed scope
    var bus = allowedBUs();
    var covSum = CD().getFilteredCoverageSummary(null, null);
    if (!covSum || !covSum.ok) return { ok: false, message: "Operational coverage cache is loading..." };
    var headline = E.fmtPct(covSum.coveragePct) + " coverage · " + E.fmtPct(covSum.rightFreqPct) + " right frequency overall";
    var detail = "Blended across " + bus.length + " Business Unit(s): " + bus.join(", ") + ". Total reps: " + covSum.repCount + ".";

    return {
      ok: true,
      type: "figure",
      headline: headline,
      detail: detail,
      answer: {
        headline: headline,
        interpretation: detail
      },
      formula: "blended coverage = total customers visited ÷ total plan customers across allowed BUs",
      evidence: [
        ["Allowed BUs", bus.join(", ")],
        ["Blended Coverage", E.fmtPct(covSum.coveragePct)],
        ["Blended Right Freq", E.fmtPct(covSum.rightFreqPct)],
        ["Total Representatives", covSum.repCount],
        ["Total Visited Customers", E.fmtNum(covSum.visitCount)],
        ["As of", asOf()]
      ]
    };
  }

  function answerTop(q, ctx, parsed) {
    var E = global.AskEngine;
    var n = parsed.n, bottom = parsed.bottom;
    var wantLine = /\b(line|team)s?\b/i.test(q);
    var wantDm = /\b(manager|dm|district)s?\b/i.test(q);
    var wantRep = /\b(rep|medical|employee)s?\b/i.test(q);
    var wantSpecialty = /\bspecialt/i.test(q) || /\bdoctors?\b/i.test(q);
    var wantClass = /\bclass(es)?\b|\bklass/i.test(q);
    var wantType = /\btype|category/i.test(q);

    var rows = [], nameHeader = "", columns = ["Coverage", "Right Freq", "Active Reps"], scopeTxt = "";
    var got;

    if (wantRep && ctx.dm) {
      // Reps under a specific DM
      var bu = ctx.bu || allowedBUs()[0];
      var repList = CD().getDmRepsList(bu, ctx.line || null, ctx.dm);
      nameHeader = "Representative";
      columns = ["Coverage", "Right Freq", "Plan Customers"];
      scopeTxt = "reps under " + ctx.dm;
      rows = repList.map(function (r) {
        return { name: r.name, sort: r.coveragePct || 0, cells: [
          E.fmtPct(r.coveragePct), E.fmtPct(r.rightFreqPct), E.fmtNum(r.rowCount)
        ] };
      });
    } else if (wantDm) {
      // Rank DMs in current BU
      var targetBU = ctx.bu || allowedBUs()[0];
      var list = vocab().dms;
      nameHeader = "District Manager";
      scopeTxt = "DMs in " + targetBU;
      list.forEach(function (dm) {
        var dmSum = CD().getFilteredCoverageForDm(targetBU, ctx.line || null, dm);
        if (dmSum && dmSum.ok && dmSum.customerRowCount > 0) {
          rows.push({
            name: dm,
            sort: dmSum.coveragePct || 0,
            cells: [E.fmtPct(dmSum.coveragePct), E.fmtPct(dmSum.rightFreqPct), dmSum.repCount]
          });
        }
      });
    } else if (wantLine || (!wantRep && !wantDm && !wantSpecialty && !wantClass && !wantType && ctx.bu)) {
      // Rank lines inside a BU
      var bus = ctx.bu ? [ctx.bu] : allowedBUs();
      rows = [];
      bus.forEach(function (bu) {
        var breakdown = CD().getLineAndTerritoryBreakdown(bu);
        if (breakdown && breakdown.ok && breakdown.lines) {
          breakdown.lines.forEach(function (l) {
            rows.push({
              name: l.name,
              sort: l.coveragePct || 0,
              cells: [E.fmtPct(l.coveragePct), E.fmtPct(l.rightFreqPct), l.headcount]
            });
          });
        }
      });
      nameHeader = "Line";
      scopeTxt = "lines in " + bus.join(", ");
    } else if (wantSpecialty || wantClass || wantType) {
      // Specialty / Class / Type breakdown
      var targetBU3 = ctx.bu || allowedBUs()[0];
      var typeSum = CD().getFilteredCoverageByType(targetBU3, ctx.line || null);
      var dataset = [];
      if (wantSpecialty) { nameHeader = "Specialty"; dataset = typeSum.specialty || []; }
      else if (wantClass) { nameHeader = "Class"; dataset = typeSum.klass || []; }
      else { nameHeader = "Customer Type"; dataset = typeSum.type || []; }

      columns = ["Coverage", "Right Freq", "Target Visits", "Actual Visits"];
      scopeTxt = nameHeader.toLowerCase() + "s in " + targetBU3;
      rows = dataset.map(function (d) {
        return { name: d.name, sort: d.coveragePct || 0, cells: [
          E.fmtPct(d.coveragePct), E.fmtPct(d.rightFreqPct), E.fmtNum(d.plannedVisits), E.fmtNum(d.actualVisits)
        ] };
      });
    } else {
      // Fallback: rank BUs
      nameHeader = "Business Unit";
      scopeTxt = "your allowed BUs";
      allowedBUs().forEach(function (bu) {
        var buSum = CD().getFilteredCoverageForLine(bu, null);
        if (buSum && buSum.ok) {
          rows.push({ name: bu, sort: buSum.coveragePct || 0, cells: [
            E.fmtPct(buSum.coveragePct), E.fmtPct(buSum.rightFreqPct), buSum.repCount
          ] });
        }
      });
    }

    if (!rows.length) {
      return { ok: false, message: "No coverage ranking available for that selection." };
    }

    rows.sort(function (a, b) { return bottom ? a.sort - b.sort : b.sort - a.sort; });
    var shown = rows.slice(0, n).map(function (r, i) {
      return { rank: i + 1, name: r.name, cells: r.cells };
    });

    var headline = (bottom ? "Bottom " : "Top ") + shown.length + " " + nameHeader.toLowerCase() + (shown.length === 1 ? "" : "s") + " by coverage %";
    var detail = "Within " + scopeTxt + ", ranked by coverage rate.";

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
      formula: "Ranked by coverage % (seen/total plan), " + (bottom ? "ascending" : "descending"),
      evidence: [
        ["Total Items Ranked", rows.length],
        ["As of", asOf()]
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
    var headline = cols[0].name + " vs " + cols[1].name + " coverage comparison";
    var detail = cols[0].coverage >= cols[1].coverage
      ? cols[0].name + " has higher coverage."
      : cols[1].name + " has higher coverage.";

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
        ["Coverage Rate", function (c) { return E.fmtPct(c.coverage); }],
        ["Right Frequency", function (c) { return E.fmtPct(c.rightFreq); }],
        ["Rep Count", function (c) { return E.fmtNum(c.reps); }],
        ["Total Customers", function (c) { return E.fmtNum(c.customers); }]
      ],
      formula: "Compare coverage rate (visited/planned) side-by-side",
      evidence: [
        ["Measure", "Coverage and right frequency %"],
        ["As of", asOf()]
      ]
    };
  }

  var adapter = {
    id: ID,
    title: "Ask the Data",
    subtitle: "Type a question about coverage, visiting frequencies or client counts. Answers respect your access role.",
    get placeholder() {
      var v = vocab();
      var user = global.AUTH ? global.AUTH.getValidSessionUser() : null;
      var isLineManager = user && user.role === "Line Manager";
      if (isLineManager && v.lines.length) {
        return "Ask about " + v.lines[0] + ", its district managers or its specialties…";
      }
      return "Ask about a BU, line, DM, specialty, or customer class…";
    },
    get notFoundHint() {
      var v = vocab();
      var user = global.AUTH ? global.AUTH.getValidSessionUser() : null;
      var isLineManager = user && user.role === "Line Manager";
      if (isLineManager && v.lines.length) {
        return "Name a specialty in " + v.lines[0] + " or a district manager you have access to.";
      }
      return "Name a BU, line, DM, specialty, or customer class you have access to — for example “CHC coverage” or “top DMs by coverage”.";
    },

    get examples() {
      var v = vocab();
      var out = [];
      var user = global.AUTH ? global.AUTH.getValidSessionUser() : null;
      var isLineManager = user && user.role === "Line Manager";

      if (isLineManager && v.lines.length) {
        out.push("How is " + v.lines[0] + " coverage performing?");
        if (v.lines.length > 1) out.push("Top lines by coverage");
        if (v.dms.length) out.push("Top DMs by coverage");
        if (v.specialties.length) out.push("Top specialties by coverage");
        if (v.lines.length >= 2) out.push("Compare " + v.lines[0] + " and " + v.lines[1] + " coverage");
      } else {
        if (v.bus.length) out.push("How is " + v.bus[0] + " coverage performing?");
        if (v.bus.length) out.push("Top lines by coverage");
        if (v.dms.length) out.push("Top DMs by coverage");
        if (v.specialties.length) out.push("Top specialties by coverage");
        if (v.bus.length >= 2) out.push("Compare " + v.bus[0] + " and " + v.bus[1] + " coverage");
      }
      return out;
    },

    get dims() {
      var v = vocab();
      return [
        { key: "bu",        label: "Business Unit",    names: v.bus,         minAlias: 3 },
        { key: "line",      label: "Line",             names: v.lines,       minAlias: 3 },
        { key: "dm",        label: "District Manager", names: v.dms,         minAlias: 4 },
        { key: "specialty", label: "Specialty",        names: v.specialties, minAlias: 4 },
        { key: "class",     label: "Class",            names: v.classes,     minAlias: 1 },
        { key: "type",      label: "Customer Type",    names: v.types,       minAlias: 4 }
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
      return "Coverage cache · " + asOf();
    },

    answer: function (q, parsed) {
      if (!CD() || !SEM()) {
        return { ok: false, message: "The coverage layer has not loaded yet." };
      }
      var ctx = contextFor(parsed.entities);

      // If user is a Line Manager, default to their restricted line if none is specified in query context
      var user = global.AUTH ? global.AUTH.getValidSessionUser() : null;
      var isLineManager = user && user.role === "Line Manager";
      if (isLineManager && !ctx.line && !ctx.dm && !ctx.specialty) {
        var v = vocab();
        if (v.lines && v.lines.length) {
          ctx.line = v.lines[0];
          ctx.bu = lineBU(ctx.line);
        }
      }

      var res;
      if (parsed.intent === "compare" && parsed.entities.length >= 2) {
        res = answerCompare(q, parsed.entities);
      } else if (parsed.intent === "top" || parsed.bottom) {
        res = answerTop(q, ctx, parsed);
      } else {
        if (!parsed.entities.length && !/\ball\b|\btotal\b|\boverall\b|\bcompany\b|\bhow are we\b/i.test(q)) {
          if (/\b(line|team|manager|dm|district|specialty|specialties|class|classes|klass|type|category)s?\b/i.test(q)) {
            res = answerTop(q, ctx, parsed);
          }
        }
        if (!res) res = answerFigure(q, ctx, parsed);
      }

      // Inject explore navigation chips
      if (res && res.ok) {
        var targetLine = ctx.line || null;
        var targetBU = ctx.bu || (targetLine ? lineBU(targetLine) : null);
        if (targetLine || targetBU) {
          var displayFilterKey = targetLine ? "line" : "bu";
          var displayFilterVal = targetLine || targetBU;
          res.explore = [
            {
              label: "Diagnose " + displayFilterVal + " performance",
              targetTab: "executive",
              filterKey: displayFilterKey,
              filterValue: displayFilterVal
            },
            {
              label: "How is " + displayFilterVal + " sales performing?",
              targetTab: "sales",
              filterKey: displayFilterKey,
              filterValue: displayFilterVal
            },
            {
              label: "What is " + displayFilterVal + " vacancy rate?",
              targetTab: "sfe",
              filterKey: displayFilterKey,
              filterValue: displayFilterVal
            }
          ];
        }
      }

      return res;
    }
  };

  global.AskCoverage = { adapter: adapter, invalidate: invalidate, _vocab: vocab };
})(typeof window !== "undefined" ? window : this);
