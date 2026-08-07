/**
 * ASK THE DATA — Sales adapter (Sales + Executive Command Center)
 * ============================================================================
 *
 * BUILT ON THE SEMANTIC API, NOT ON A RE-SCAN OF THE CUBE.
 *
 * Every figure here comes from `window.SalesDashboard`'s existing semantic
 * functions — getBusinessSummary, getLineSalesSummary, getBrandAchievement,
 * getItemAchievement, getDmSalesSummary, getSalesAchievementSummary.
 *
 * That is deliberate and it is the most important decision in this file. Those
 * functions already encode a pile of hard-won rules: Non-Tender only, Value
 * basis, the CHC / CHC_SALES rollup exception, the Official vs Working target
 * scenario, the June target authority, and the per-user line entitlement
 * filter. Re-deriving any of it here would produce an Ask panel that quietly
 * disagrees with the cards directly above it — which is worse than having no
 * Ask panel, because the reader has no way to tell which number is wrong.
 *
 * So: if a number is available from the semantic layer, take it from there. If
 * it is not available, say so rather than computing a near-enough substitute.
 *
 * ---------------------------------------------------------------------------
 * SCOPE
 * ---------------------------------------------------------------------------
 * `ignoreLineAuth` is passed as FALSE everywhere, always. The semantic layer
 * then applies `AUTH.isLineAllowed()` itself and a restricted user's lines
 * simply do not come back. Combined with the engine building the entity
 * vocabulary through `visibleDimValues()`, an out-of-scope line or brand can
 * be neither named nor ranked nor totalled.
 *
 * BU list comes from `AUTH.filterAllowedBUs(SEMANTIC.BU_LIST)`, so the same
 * holds one level up.
 */
(function (global) {
  "use strict";

  var ID = "sales";

  function SD() { return global.SalesDashboard; }
  function SEM() { return global.SEMANTIC; }

  function scenario() {
    return global.AUTH && global.AUTH.getActiveScenario
      ? global.AUTH.getActiveScenario() : "official";
  }

  /** BUs this user may see, in canonical order. */
  function allowedBUs() {
    if (!SEM() || !SEM().BU_LIST) return [];
    var list = SEM().BU_LIST.slice();
    if (global.AUTH && global.AUTH.filterAllowedBUs) {
      return global.AUTH.filterAllowedBUs(list);
    }
    return list;
  }

  /** Lines this user may see, from the semantic layer's own entitlement test. */
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

  // -------------------------------------------------------------------------
  // Vocabulary
  // -------------------------------------------------------------------------
  // Brand and DM names are pulled through the scoped semantic calls, so the
  // vocabulary is already restricted before the engine ever sees it. Building
  // it costs one pass over each allowed BU; the engine caches the result per
  // user, so this runs once per sign-in, not once per question.
  var _vocab = null;
  var _vocabKey = null;

  function vocab() {
    var key = (global.AskEngine ? global.AskEngine._currentUserKey() : "?") + "|" + scenario();
    if (_vocab && _vocabKey === key) return _vocab;

    var bus = allowedBUs();
    var lines = allowedLines();
    var brands = {}, dms = {};

    bus.forEach(function (bu) {
      try {
        var b = SD().getBrandAchievement(bu, null, false, scenario());
        if (b && b.ok) (b.brands || []).forEach(function (x) {
          if (x.name && x.name !== "Unknown") brands[x.name] = true;
        });
      } catch (e) {}
      try {
        var d = SD().getDmSalesSummary(bu, null, null, scenario());
        if (d && d.ok) (d.dms || []).forEach(function (x) {
          if (x.name) dms[x.name] = true;
        });
      } catch (e) {}
    });

    _vocab = {
      bus: bus,
      lines: lines,
      brands: Object.keys(brands).sort(),
      dms: Object.keys(dms).sort()
    };
    _vocabKey = key;
    return _vocab;
  }

  function invalidate() { _vocab = null; _vocabKey = null; }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------
  function lineBU(line) {
    var map = SEM() && SEM().CANONICAL_LINE_TO_BU;
    return map ? (map[line] || null) : null;
  }

  /** The BU a question is really about, given the entities named. */
  function contextFor(ents) {
    var bu = null, line = null, brand = null, dm = null;
    ents.forEach(function (e) {
      if (e.dim.key === "bu" && !bu) bu = e.name;
      else if (e.dim.key === "line" && !line) line = e.name;
      else if (e.dim.key === "brand" && !brand) brand = e.name;
      else if (e.dim.key === "dm" && !dm) dm = e.name;
    });
    if (!bu && line) bu = lineBU(line);
    return { bu: bu, line: line, brand: brand, dm: dm };
  }

  function fmtEGP(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return global.AskEngine.fmtNum(v) + " EGP";
  }

  function asOf(res) { return (res && res.asOfDate) ? String(res.asOfDate) : "latest month in cache"; }

  function scenarioLabel() {
    var s = scenario();
    var t = SEM() && SEM().TARGET_SCENARIOS && SEM().TARGET_SCENARIOS[s];
    return t && t.label ? t.label : s;
  }

  // -------------------------------------------------------------------------
  // Answer branches
  // -------------------------------------------------------------------------

  /** Sales / target / achievement for one BU, line or brand. */
  function answerFigure(q, ctx, parsed) {
    var E = global.AskEngine;

    if (ctx.brand) {
      var bu = ctx.bu || lineBU(ctx.line) || allowedBUs()[0];
      var br = SD().getBrandAchievement(bu, ctx.line || null, false, scenario());
      if (!br || !br.ok) return unavailable(br);
      var row = (br.brands || []).filter(function (x) { return x.name === ctx.brand; })[0];
      if (!row) {
        return {
          ok: false,
          message: "“" + ctx.brand + "” has no recorded sales in " + bu +
                   (ctx.line ? " / " + ctx.line : "") + " for this period.",
          hint: "It may sit under a different business unit, or outside your access."
        };
      }
      return {
        ok: true,
        headline: ctx.brand + " — " + fmtEGP(row.actualValue) +
          (row.achievementPct !== null ? " · " + E.fmtPct(row.achievementPct) + " of target" : ""),
        detail: "Target " + fmtEGP(row.targetValue) + " · " +
          E.fmtNum(row.actualQty) + " units · " +
          (row.contributionPct !== null ? E.fmtPct(row.contributionPct) + " of " + bu + "'s value" : ""),
        formula: "achievement % = actual value ÷ target value × 100",
        evidence: [
          ["Brand", ctx.brand],
          ["Business unit", bu + (ctx.line ? " · line " + ctx.line : "")],
          ["Actual", fmtEGP(row.actualValue)],
          ["Target", fmtEGP(row.targetValue) + "  (" + scenarioLabel() + ")"],
          ["Basis", br.scope || "Non-Tender transactions only, Value basis"],
          ["As of", asOf(br)]
        ]
      };
    }

    if (ctx.line || ctx.bu) {
      var b2 = ctx.bu || lineBU(ctx.line);
      var s = SD().getSalesAchievementSummary(b2, ctx.line || null, false, scenario());
      if (!s || !s.ok) return unavailable(s);
      var who = ctx.line || b2;
      return {
        ok: true,
        headline: who + " — " + fmtEGP(s.actualYTD) +
          (s.achievementPct !== null ? " · " + E.fmtPct(s.achievementPct) + " of target" : ""),
        detail: "Target " + fmtEGP(s.targetYTD) +
          (s.momGrowthPct !== null && s.momGrowthPct !== undefined
            ? " · " + E.fmtSignedPct(s.momGrowthPct) + " month on month" : "") + ".",
        formula: "achievement % = actual YTD ÷ target YTD × 100",
        evidence: [
          [ctx.line ? "Line" : "Business unit", who],
          ["Actual YTD", fmtEGP(s.actualYTD)],
          ["Target YTD", fmtEGP(s.targetYTD) + "  (" + scenarioLabel() + ")"],
          ["Basis", s.scope || "Non-Tender transactions only, Value basis"],
          ["Confidence", s.confidence === "high"
            ? "High — three or more months in the trend"
            : "Low — fewer than three months, month-on-month is noisy"],
          ["As of", asOf(s)]
        ]
      };
    }

    // Nothing named — whole allowed scope.
    var bs = SD().getBusinessSummary(scenario());
    if (!bs || !bs.ok) return unavailable(bs);
    var bus = allowedBUs();
    var tot = 0, tgt = 0;
    bus.forEach(function (name) {
      var x = bs.bu && bs.bu[name];
      if (!x) return;
      tot += x.actualYTD || 0; tgt += x.targetYTD || 0;
    });
    return {
      ok: true,
      headline: fmtEGP(tot) + (tgt > 0 ? " · " + E.fmtPct((tot / tgt) * 100) + " of target" : ""),
      detail: "Across " + bus.length + " business unit" + (bus.length === 1 ? "" : "s") +
        " you have access to: " + bus.join(", ") + ".",
      formula: "Sum of actual YTD across your business units ÷ sum of target YTD × 100",
      evidence: [
        ["Business units", bus.join(", ")],
        ["Actual YTD", fmtEGP(tot)],
        ["Target YTD", fmtEGP(tgt) + "  (" + scenarioLabel() + ")"],
        ["Basis", "Non-Tender transactions only, Value basis"],
        ["As of", asOf(bs)]
      ]
    };
  }

  /**
   * Collect rows across every BU the user may see.
   *
   * A restricted user cannot pass `bu = null` to the semantic layer — it
   * answers `access_denied`, which is correct but useless here. Asking BU by
   * BU and merging gives them a real ranking across everything they hold,
   * and by construction nothing they do not.
   *
   * `pull(bu)` returns { res, rows } for one BU; a BU that errors is skipped
   * rather than failing the whole answer, so one bad slice cannot blank a
   * ranking that is otherwise fine.
   */
  function acrossBUs(ctxBu, pull) {
    var bus = ctxBu ? [ctxBu] : allowedBUs();
    var all = [], last = null, seen = {};
    bus.forEach(function (bu) {
      var got;
      try { got = pull(bu); } catch (e) { return; }
      if (!got || !got.res || !got.res.ok) return;
      last = got.res;
      got.rows.forEach(function (r) {
        // The same brand can appear under two BUs; merge rather than
        // listing it twice with half its value in each row.
        var k = r.name;
        if (seen[k]) {
          seen[k].sort += r.sort;
          seen[k].actual += r.actual || 0;
          seen[k].target += r.target || 0;
          seen[k].merged = true;
        } else {
          seen[k] = r; all.push(r);
        }
      });
    });
    return { rows: all, res: last, bus: bus };
  }

  /** Ranked list of lines, brands, items, DMs or BUs. */
  function answerTop(q, ctx, parsed) {
    var E = global.AskEngine;
    var n = parsed.n, bottom = parsed.bottom;
    var wantBrand = /\bbrand/i.test(q);
    var wantItem = /\bitem|\bsku|\bproduct/i.test(q);
    var wantDm = /\bdistrict|\bdm\b|\bmanager/i.test(q);
    var wantLine = /\bline/i.test(q);
    var wantBU = /\bbusiness unit|\bbu\b/i.test(q);

    var rows = [], nameHeader = "", columns = ["Actual", "Target", "Achievement"], src = null, scopeTxt = "";
    var got;

    if (wantDm) {
      got = acrossBUs(ctx.bu, function (bu) {
        var res = SD().getDmSalesSummary(bu, ctx.line || null, null, scenario());
        return { res: res, rows: ((res && res.dms) || []).map(function (d) {
          return { name: d.name, sort: d.actualValue, actual: d.actualValue,
                   target: d.targetValue, perPos: d.salesPerPosition };
        }) };
      });
      nameHeader = "District Manager";
      columns = ["Actual", "Target", "Achievement", "Sales / position"];
      scopeTxt = (ctx.bu || got.bus.join(", ")) + (ctx.line ? " · " + ctx.line : "");
      src = got.res;
      rows = got.rows.map(function (d) {
        return { name: d.name, sort: d.sort, cells: [
          fmtEGP(d.actual), fmtEGP(d.target),
          E.fmtPct(d.target > 0 ? (d.actual / d.target) * 100 : null),
          fmtEGP(d.perPos)
        ] };
      });
    } else if (wantItem) {
      var bu2 = ctx.bu || lineBU(ctx.line) || allowedBUs()[0];
      src = SD().getItemAchievement(bu2, ctx.brand || null, ctx.line || null, scenario());
      if (!src || !src.ok) {
        if (src && src.status === "bu_not_supported") {
          return { ok: false,
            message: "Item-level detail is only available for CHC.",
            hint: "Ask for brands instead, or name a CHC brand." };
        }
        return unavailable(src);
      }
      nameHeader = "Item";
      scopeTxt = bu2 + (ctx.brand ? " · " + ctx.brand : "");
      rows = (src.items || []).map(function (d) {
        return { name: d.name, sort: d.actualValue, cells: [
          fmtEGP(d.actualValue), fmtEGP(d.targetValue), E.fmtPct(d.achievementPct)
        ] };
      });
    } else if (wantBU || (!wantBrand && !wantLine && !wantDm && !ctx.bu && !ctx.line)) {
      src = SD().getBusinessSummary(scenario());
      if (!src || !src.ok) return unavailable(src);
      nameHeader = "Business Unit";
      scopeTxt = "your business units";
      rows = allowedBUs().map(function (name) {
        var x = (src.bu && src.bu[name]) || {};
        return { name: name, sort: x.actualYTD || 0, cells: [
          fmtEGP(x.actualYTD), fmtEGP(x.targetYTD), E.fmtPct(x.achievementPct)
        ] };
      });
    } else if (wantBrand || ctx.brand) {
      got = acrossBUs(ctx.bu, function (bu) {
        var res = SD().getBrandAchievement(bu, ctx.line || null, false, scenario());
        return { res: res, rows: ((res && res.brands) || []).map(function (d) {
          return { name: d.name, sort: d.actualValue, actual: d.actualValue, target: d.targetValue };
        }) };
      });
      nameHeader = "Brand";
      scopeTxt = (ctx.bu || got.bus.join(", ")) + (ctx.line ? " · " + ctx.line : "");
      src = got.res;
      var brandTotal = 0;
      got.rows.forEach(function (d) { brandTotal += d.actual || 0; });
      columns = ["Actual", "Target", "Achievement", "Contribution"];
      rows = got.rows.map(function (d) {
        return { name: d.name, sort: d.sort, cells: [
          fmtEGP(d.actual), fmtEGP(d.target),
          E.fmtPct(d.target > 0 ? (d.actual / d.target) * 100 : null),
          E.fmtPct(brandTotal > 0 ? (d.actual / brandTotal) * 100 : null)
        ] };
      });
    } else {
      got = acrossBUs(ctx.bu, function (bu) {
        var res = SD().getLineSalesSummary(bu, null, false, scenario());
        return { res: res, rows: ((res && res.lines) || []).map(function (d) {
          return { name: d.name, sort: d.actualValue, actual: d.actualValue, target: d.targetValue };
        }) };
      });
      nameHeader = "Line";
      scopeTxt = ctx.bu || got.bus.join(", ");
      src = got.res;
      rows = got.rows.map(function (d) {
        return { name: d.name, sort: d.sort, cells: [
          fmtEGP(d.actual), fmtEGP(d.target),
          E.fmtPct(d.target > 0 ? (d.actual / d.target) * 100 : null)
        ] };
      });
    }

    if (!rows.length) {
      return { ok: false,
        message: "No " + nameHeader.toLowerCase() + " data is available in your scope for this period.",
        hint: "Try naming a business unit or line you have access to." };
    }

    rows.sort(function (a, b) { return bottom ? a.sort - b.sort : b.sort - a.sort; });
    var shown = rows.slice(0, n).map(function (r, i) {
      return { rank: i + 1, name: r.name, cells: r.cells };
    });

    return {
      ok: true,
      headline: (bottom ? "Bottom " : "Top ") + shown.length + " " +
        nameHeader.toLowerCase() + (shown.length === 1 ? "" : "s") + " by sales value",
      detail: "Within " + scopeTxt + ", ranked on actual value.",
      nameHeader: nameHeader,
      columns: columns,
      rows: shown,
      formula: "Ranked by actual sales value, " + (bottom ? "ascending" : "descending"),
      evidence: [
        ["Ranked across", rows.length + " " + nameHeader.toLowerCase() +
          (rows.length === 1 ? "" : "s") + " in your scope"],
        ["Measure", "Actual sales value, EGP"],
        ["Target basis", scenarioLabel()],
        ["Basis", (src && src.scope) || "Non-Tender transactions only, Value basis"],
        ["As of", asOf(src)]
      ]
    };
  }

  /** Two named things, side by side. */
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
    return {
      ok: true,
      headline: cols[0].name + "  vs  " + cols[1].name,
      detail: cols[0].actual >= cols[1].actual
        ? cols[0].name + " is larger by value."
        : cols[1].name + " is larger by value.",
      compare: cols,
      compareRows: [
        ["Actual", function (c) { return fmtEGP(c.actual); }],
        ["Target", function (c) { return fmtEGP(c.target); }],
        ["Achievement", function (c) { return E.fmtPct(c.achievementPct); }]
      ],
      formula: "Both on actual sales value, same period, same target basis",
      evidence: [
        ["Measure", "Actual sales value, EGP"],
        ["Target basis", scenarioLabel()],
        ["Basis", "Non-Tender transactions only, Value basis"]
      ]
    };
  }

  /** Actual/target/achievement for a single resolved entity. */
  function figureFor(e) {
    var key = e.dim.key, name = e.name;
    if (key === "bu") {
      var bs = SD().getBusinessSummary(scenario());
      if (!bs || !bs.ok) return null;
      var x = bs.bu && bs.bu[name];
      if (!x) return null;
      return { name: name, actual: x.actualYTD, target: x.targetYTD, achievementPct: x.achievementPct };
    }
    if (key === "line") {
      var s = SD().getSalesAchievementSummary(lineBU(name), name, false, scenario());
      if (!s || !s.ok) return null;
      return { name: name, actual: s.actualYTD, target: s.targetYTD, achievementPct: s.achievementPct };
    }
    if (key === "brand") {
      var bus = allowedBUs();
      for (var i = 0; i < bus.length; i++) {
        var br = SD().getBrandAchievement(bus[i], null, false, scenario());
        if (!br || !br.ok) continue;
        var row = (br.brands || []).filter(function (b) { return b.name === name; })[0];
        if (row) return { name: name, actual: row.actualValue, target: row.targetValue,
                          achievementPct: row.achievementPct };
      }
      return null;
    }
    if (key === "dm") {
      var bus2 = allowedBUs();
      for (var j = 0; j < bus2.length; j++) {
        var d = SD().getDmSalesSummary(bus2[j], null, null, scenario());
        if (!d || !d.ok) continue;
        var r = (d.dms || []).filter(function (x2) { return x2.name === name; })[0];
        if (r) return { name: name, actual: r.actualValue, target: r.targetValue,
                        achievementPct: r.achievementPct };
      }
      return null;
    }
    return null;
  }

  function unavailable(res) {
    var status = res && res.status ? res.status : "unavailable";
    var msg = {
      cache_unavailable: "The sales cache has not loaded yet.",
      semantic_model_missing: "The semantic model has not loaded yet.",
      access_denied: "That is outside the data you have access to.",
      bu_not_supported: "That level of detail is not available for this business unit."
    }[status] || "That figure is not available from the sales layer.";
    return { ok: false, message: msg,
             hint: status === "access_denied"
               ? "Ask about a business unit or line you have access to."
               : "Reload the page and try again." };
  }

  // -------------------------------------------------------------------------
  // Adapter
  // -------------------------------------------------------------------------
  var adapter = {
    id: ID,
    title: "Ask the Data",
    subtitle: "Type a question about sales, targets or achievement. Every answer is " +
      "computed by the same semantic layer that produces the cards on this page, " +
      "and shows its formula, inputs and basis.",
    placeholder: "Ask about a business unit, line, brand, item or district manager…",
    notFoundHint: "Name a business unit, line, brand or district manager you have access to " +
      "— for example “CHC achievement” or “top 10 brands”.",

    /**
     * Suggestion chips, built from THIS user's vocabulary.
     *
     * These were hardcoded ("How is CHC performing?", "Compare CHC and DIAB")
     * and the scope-leak harness caught it: a Cluster BU Manager was being
     * shown buttons naming CHC and DIAB — business units they have no access
     * to. Two problems at once. It discloses names outside their scope, and
     * every one of those buttons would have returned "outside your access",
     * which reads as a broken feature rather than a boundary.
     *
     * Examples are part of the scope surface, not decoration.
     */
    get examples() {
      var v = vocab();
      var out = [];
      if (v.bus.length) out.push("How is " + v.bus[0] + " performing?");
      if (v.brands.length) out.push("Top 10 brands");
      if (v.lines.length > 1) out.push("Top lines by sales");
      if (v.dms.length) out.push("Which district managers are behind target?");
      if (v.bus.length >= 2) out.push("Compare " + v.bus[0] + " and " + v.bus[1]);
      else if (v.lines.length >= 2) out.push("Compare " + v.lines[0] + " and " + v.lines[1]);
      if (!out.length) out.push("How are we performing?");
      return out;
    },

    get dims() {
      var v = vocab();
      return [
        { key: "bu",    label: "Business Unit",    names: v.bus,    minAlias: 3 },
        { key: "line",  label: "Line",             names: v.lines,  minAlias: 3 },
        { key: "brand", label: "Brand",            names: v.brands, minAlias: 4 },
        { key: "dm",    label: "District Manager", names: v.dms,    minAlias: 4 }
      ];
    },

    // Vocabulary is already scope-filtered at source, so nothing further to
    // exclude here. Declared explicitly rather than omitted so the engine's
    // contract stays visible at the call site.
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
      return "Sales cache · target basis " + scenarioLabel();
    },

    answer: function (q, parsed) {
      if (!SD() || !SEM()) {
        return { ok: false, message: "The sales layer has not loaded yet.",
                 hint: "Give the page a moment and try again." };
      }
      var ctx = contextFor(parsed.entities);

      if (parsed.intent === "compare" && parsed.entities.length >= 2) {
        var cmp = answerCompare(q, parsed.entities);
        if (cmp) return cmp;
      }
      if (parsed.intent === "top" || parsed.bottom) return answerTop(q, ctx, parsed);
      if (!parsed.entities.length && !/\ball\b|\btotal\b|\boverall\b|\bcompany\b|\bhow are we\b/i.test(q)) {
        // Nothing named and no whole-scope phrasing: a ranking is the more
        // useful reading of a bare "sales" or "achievement" question.
        if (/\bbrand|\bline|\bmanager|\bitem|\bsku/i.test(q)) return answerTop(q, ctx, parsed);
      }
      return answerFigure(q, ctx, parsed);
    }
  };

  global.AskSales = { adapter: adapter, invalidate: invalidate, _vocab: vocab };
})(typeof window !== "undefined" ? window : this);
