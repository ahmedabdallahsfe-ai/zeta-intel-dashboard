/**
 * expense-interface.js — Expense vs Sales semantic layer
 * =============================================================================
 * PLATFORM ASSET. Exposes window.ExpenseDashboard.
 *
 * The one and only way the Expense vs Sales workspace reads expense data. It
 * owns three things and delegates everything else:
 *
 *   1. The GRAIN RULE   — non-CHC reports by Brand, CHC by Product/SKU.
 *   2. The ACTIVE FILTER — active / inactive / all, with the guardrails.
 *   3. The JOIN         — expense budget to sales, via SalesDashboard only.
 *
 * EVERY SALES FIGURE COMES FROM SalesDashboard
 * -----------------------------------------------------------------------------
 * Not one line of sales arithmetic is reimplemented here. getBrandAchievement()
 * and getItemAchievement() already encode Non-Tender only, Value basis, the
 * CHC / CHC_SALES rollup exception, the Official vs Working scenario and the
 * June target authority. Re-deriving any of that would produce an Expense page
 * whose sales numbers disagree with the Sales page, and a reader would have no
 * way to tell which was wrong.
 *
 * WHY THE GRAIN RULE LIVES HERE AND NOT IN semantic-model.js
 * -----------------------------------------------------------------------------
 * The design called for it in semantic-model.js. Ahmed's standing instruction
 * is not to modify that file, and this module is its only consumer, so it lives
 * here instead. The rule is still expressed EXACTLY ONCE — which was the actual
 * requirement. If a second workspace ever needs it, it moves up then.
 *
 * AUTHORIZATION
 * -----------------------------------------------------------------------------
 * No second auth system. Rows are filtered through AUTH.isLineAllowed() at
 * source, so an out-of-scope line's budget cannot be read, totalled or ranked —
 * not merely hidden after the fact.
 */
(function (global) {
  "use strict";

  var CACHE = null;
  var DECODED = false;

  // Row layout — mirrors payload.columns in etl/build_expense_cache.py.
  var BU = 0, LINE = 1, BRAND = 2, SKU = 3, ACTIVE = 4, STATUS = 5,
      REVIEWED = 6, SPROD = 7, SBRAND = 8, BUDGET = 9, MONTHLY = 10, JOINABLE = 11;

  var ACTIVE_YES = 1, ACTIVE_NO = 0, ACTIVE_BLANK = -1;

  /**
   * BRANDS REPORTED AT SKU GRAIN despite belonging to a brand-grain BU.
   *
   * Ahmed, 2026-08-09: "DEFINE ELIMBOSIS AS 2.5 AND 5". ELIMBOSIS carries two
   * separate budgets (2.5 MG and 5 MG, 5,500,000 each) and they perform
   * differently in sales, so a single brand row hides the thing worth seeing.
   *
   * A declared exception list, not a heuristic. Splitting every brand whose
   * SKUs happen to map to distinct sales products would silently restructure
   * the whole page the day a new mapping is ratified. Adding a brand here is a
   * deliberate one-line act.
   */
  var SPLIT_BRANDS = { "ELIMBOSIS": true };

  /**
   * User-entered actual expense.
   *
   * NOT in the cache — the cache is built from the source workbook and carries
   * no actuals, because the source has none. These are values a person typed.
   * Keyed  BU|entity  and held here rather than in the page so the ratio
   * arithmetic stays in the semantic layer with every other calculation.
   */
  var ACTUALS = {};
  function actualKey(bu, entity) { return String(bu) + "|" + String(entity); }

  /**
   * REVISED BUDGET — a SEPARATE store, never a mutation of the source.
   *
   * The workbook budget is official finance data. If a user could overwrite it
   * in place, the reconciliation against Finance's line sheet would stop
   * meaning anything and the page could disagree with Finance while looking
   * authoritative.
   *
   * So a revision is recorded beside the original, both are shown, and the
   * variance between them is itself reportable. The official figure survives
   * every edit.
   */
  var REVISED = {};

  // ---------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------
  function decompress() {
    if (DECODED) return !!CACHE;
    DECODED = true;
    var raw = global.EXPENSE_BUDGET_CACHE;
    if (!raw || !raw.b64Data) return false;
    try {
      var bin = atob(raw.b64Data);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      CACHE = JSON.parse(pako.ungzip(bytes, { to: "string" }));
      return true;
    } catch (e) {
      console.error("[Expense] cache decode failed:", e);
      CACHE = null;
      return false;
    }
  }

  function isReady() { return decompress() && !!CACHE && Array.isArray(CACHE.rows); }

  function fail(status, extra) {
    var out = { ok: false, status: status, source: "expense" };
    for (var k in (extra || {})) out[k] = extra[k];
    return out;
  }

  // ---------------------------------------------------------------------
  // The grain rule — expressed exactly once
  // ---------------------------------------------------------------------
  function expenseGrainFor(bu) {
    return "brand";
  }

  // ---------------------------------------------------------------------
  // Row access, always through the user's scope
  // ---------------------------------------------------------------------
  /**
   * activeFilter is tri-state on the DATA, not just the control:
   *   "active"   -> Active = Yes only            (the default)
   *   "inactive" -> Active = No only
   *   "all"      -> everything, INCLUDING blank
   *
   * A blank flag is never folded into "No". An unset value has not been
   * answered; treating it as a deliberate exclusion would invent a business
   * statement nobody made.
   */
  function passesActive(code, filter) {
    if (filter === "all") return true;
    if (filter === "inactive") return code === ACTIVE_NO;
    return code === ACTIVE_YES;
  }

  function rowsFor(bu, line, activeFilter) {
    var L = CACHE.lookups;
    var out = [];
    for (var i = 0; i < CACHE.rows.length; i++) {
      var r = CACHE.rows[i];
      var rawLine = L.lines[r[LINE]];
      // THE SCOPE GUARD. Applied before anything else reads the row, so an
      // out-of-scope line never enters a total, a ranking or a chart.
      if (global.AUTH && !global.AUTH.isLineAllowed(rawLine)) continue;
      if (bu && bu !== "All" && L.bus[r[BU]] !== bu) continue;
      if (line && line !== "All" && rawLine !== line) continue;
      if (!passesActive(r[ACTIVE], activeFilter)) continue;
      out.push(r);
    }
    return out;
  }

  function opt(o) {
    o = o || {};
    return {
      activeFilter: o.activeFilter || "active",
      scenario: o.scenario || (global.SEMANTIC && global.SEMANTIC.DEFAULT_SCENARIO),
      period: o.period || "YTD"
    };
  }

  /**
   * THE YTD WINDOW — the single most important correction on this page.
   *
   * Budget is a full 12-month plan (2026-01..2026-12). Sales only exist for the
   * months actually closed (2026-01..2026-06 today). Comparing the whole year's
   * budget against half a year's sales overstated Budget-%-of-Sales by roughly
   * 2.2x, and every reader would have taken that number at face value.
   *
   * So budget is summed ONLY over the months the sales cube actually covers.
   * That is an exact cut using the real monthly phasing, not a 6/12 proration —
   * budget is not spread evenly, so prorating would introduce its own error.
   *
   * The window follows the sales cache. When July closes and the cache is
   * refreshed, this widens on its own with no code change.
   */
  function ytdMonthCount(period) {
    if (!CACHE) return 0;
    if (period && period !== "YTD") {
      var idx = CACHE.months.indexOf(period);
      if (idx >= 0) return idx + 1;
    }
    // getAvailableMonths() returns { ok, months:[{idx,key,label}] } -- an
    // ENVELOPE of objects, not an array of strings. Reading it as strings
    // silently yielded no usable last month and fell through to the full year,
    // which is precisely the 12-vs-6 error this function exists to prevent.
    var res = (global.SalesDashboard && global.SalesDashboard.getAvailableMonths)
      ? global.SalesDashboard.getAvailableMonths() : null;
    var sm = (res && res.ok && Array.isArray(res.months)) ? res.months : null;
    if (!sm || !sm.length) return CACHE.months.length;   // no sales cache -> full year
    var last = sm[sm.length - 1];
    var key = (last && typeof last === "object") ? last.key : last;
    var i = CACHE.months.indexOf(key);
    return i >= 0 ? i + 1 : Math.min(sm.length, CACHE.months.length);
  }
  function ytdBudget(row, n) {
    var t = 0, m = row[MONTHLY];
    for (var i = 0; i < n && i < m.length; i++) t += (m[i] || 0);
    return t;
  }

  // ---------------------------------------------------------------------
  // Sales lookup, delegated
  // ---------------------------------------------------------------------
  function salesByEntity(bu, line, grain, scenario, period) {
    var map = {};
    if (!global.SalesDashboard) return map;
    var res;
    if (grain === "product") {
      res = global.SalesDashboard.getItemAchievement(bu, null, line, scenario, period);
      if (res && res.ok) {
        res.items.forEach(function (it) {
          var cleanName = it.name.replace(/\xA0/g, " ");
          if (!map[cleanName]) {
            map[cleanName] = { name: cleanName, actualValue: 0, targetValue: 0, actualQty: 0, targetQty: 0 };
          }
          map[cleanName].actualValue += it.actualValue || 0;
          map[cleanName].targetValue += it.targetValue || 0;
          map[cleanName].actualQty += it.actualQty || 0;
          map[cleanName].targetQty += it.targetQty || 0;
        });
      }
    } else {
      res = global.SalesDashboard.getBrandAchievement(bu, line, false, scenario, period);
      if (res && res.ok) {
        res.brands.forEach(function (b) {
          var cleanName = b.name.replace(/\xA0/g, " ");
          if (!map[cleanName]) {
            map[cleanName] = { name: cleanName, actualValue: 0, targetValue: 0, actualQty: 0, targetQty: 0 };
          }
          map[cleanName].actualValue += b.actualValue || 0;
          map[cleanName].targetValue += b.targetValue || 0;
          map[cleanName].actualQty += b.actualQty || 0;
          map[cleanName].targetQty += b.targetQty || 0;
        });
      }
    }
    return map;
  }

  // ---------------------------------------------------------------------
  // Public: entity rows (the table)
  // ---------------------------------------------------------------------
  function getEntityExpense(bu, line, options) {
    if (!isReady()) return fail("cache_unavailable", { entities: [] });
    var o = opt(options);
    var buGrain = expenseGrainFor(bu);
    var L = CACHE.lookups;
    var rows = rowsFor(bu, line, o.activeFilter);
    var nY = ytdMonthCount(o.period);

    // Sales at BOTH grains. A brand-grain BU can still contain a split brand
    // reported at SKU level, so both lookups are needed for one BU.
    var brandSales = salesByEntity(bu, line, "brand", o.scenario, o.period);
    var itemSales = null;
    function items() {
      if (itemSales === null) itemSales = salesByEntity(bu, line, "product", o.scenario, o.period);
      return itemSales;
    }

    var acc = {};
    rows.forEach(function (r) {
      var joinable = r[JOINABLE] === 1;
      var expBrand = L.brands[r[BRAND]];
      // A row reports at SKU grain when its BU does, OR when its brand is a
      // declared split. Everything downstream reads rowGrain, never the BU's.
      var rowGrain = (buGrain === "product" || SPLIT_BRANDS[String(expBrand).toUpperCase()])
        ? "product" : "brand";
      var key = rowGrain === "product" ? L.skus[r[SKU]] : expBrand;
      var useProductSalesForKey = (rowGrain === "product" || bu === "CHC");
      var salesKey = !joinable ? null
        : (useProductSalesForKey ? L.salesProducts[r[SPROD]] : L.brands[r[SBRAND]]);

      if (!acc[key]) {
        acc[key] = {
          entity: key, entityType: rowGrain, parentBrand: expBrand,
          budgetFull: 0, budget: 0,
          monthly: new Array(CACHE.months.length).fill(0),
          skuCount: 0, joinableBudget: 0, salesKeys: {},
          active: null, statuses: {}
        };
      }
      var acr = acc[key];
      acr.budgetFull += r[BUDGET];
      acr.budget += ytdBudget(r, nY);              // <-- YTD, the comparable figure
      acr.skuCount += 1;
      acr.statuses[r[STATUS]] = true;
      for (var m = 0; m < acr.monthly.length; m++) acr.monthly[m] += (r[MONTHLY][m] || 0);
      if (joinable) {
        acr.joinableBudget += ytdBudget(r, nY);
        if (salesKey) acr.salesKeys[salesKey] = true;
      }
      var code = r[ACTIVE];
      acr.active = (acr.active === null) ? code : (acr.active === code ? code : "mixed");
    });

    var out = Object.keys(acc).map(function (k) {
      var a = acc[k];
      var useProductSales = (a.entityType === "product" || bu === "CHC");
      var pool = useProductSales ? items() : brandSales;
      var salesVal = 0, salesTgt = 0, matched = 0;
      Object.keys(a.salesKeys).forEach(function (sk) {
        var sv = pool[sk];
        if (sv) { salesVal += sv.actualValue; salesTgt += sv.targetValue; matched++; }
      });
      var hasSales = matched > 0 && salesVal > 0;

      // Actual expense: user-entered, null when nothing has been typed.
      // null is NOT zero. "Nobody has reported this yet" and "we spent nothing"
      // are different facts and must not render the same.
      var av = ACTUALS[actualKey(bu, a.entity)];
      var actual = (typeof av === "number" && isFinite(av)) ? av : null;

      // Revised full-year budget, if a person has entered one. The YTD share
      // is derived from the ORIGINAL phasing -- a revision restates the size
      // of the plan, not how it is spread across the year, and inventing a new
      // phasing curve would be a claim nobody made.
      var rv = REVISED[actualKey(bu, a.entity)];
      var revisedFY = (typeof rv === "number" && isFinite(rv)) ? rv : null;
      var revisedYtd = (revisedFY !== null && a.budgetFull > 0)
        ? revisedFY * (a.budget / a.budgetFull) : null;

      // The budget the ratios should use: the revision when one exists,
      // otherwise the original. Named so no caller has to re-decide.
      var effYtd = revisedYtd !== null ? revisedYtd : a.budget;
      var effFY = revisedFY !== null ? revisedFY : a.budgetFull;
      var effJoinable = a.budget > 0 ? effYtd * (a.joinableBudget / a.budget) : 0;

      return {
        entity: a.entity,
        entityType: a.entityType,
        parentBrand: a.parentBrand,
        skuCount: a.skuCount,
        active: a.active === "mixed" ? "Mixed"
              : a.active === ACTIVE_YES ? "Yes"
              : a.active === ACTIVE_NO ? "No" : "\u2014",

        // YTD is the headline figure. The full-year plan is kept alongside so
        // the page can show what the YTD number is a part of.
        budget: a.budget,
        budgetFullYear: a.budgetFull,
        monthly: a.monthly,

        actual: actual,
        // Utilization = how much of the YTD budget has actually been spent.
        // Undefined when no actual has been entered, and when budget is zero
        // (dividing by a zero budget yields infinity, not a finding).
        revisedBudgetFullYear: revisedFY,
        revisedBudget: revisedYtd,
        effectiveBudget: effYtd,
        effectiveBudgetFullYear: effFY,

        utilizationPct: (actual !== null && effYtd > 0) ? (actual / effYtd) * 100 : null,
        variance: actual !== null ? actual - effYtd : null,
        variancePct: (actual !== null && effYtd > 0)
          ? ((actual - effYtd) / effYtd) * 100 : null,

        // Remaining budget for the rest of the year. Can go negative — that is
        // a real finding (already over the full-year plan), not an error.
        remainingBudget: actual !== null ? effFY - actual : null,

        // Projected full-year spend at the current run rate. Straight-line on
        // elapsed months, which is the assumption a reader can check; anything
        // cleverer would hide its own guesswork.
        projectedFullYear: (actual !== null && nY > 0)
          ? (actual / nY) * CACHE.months.length : null,
        projectedVsPlanPct: (actual !== null && nY > 0 && effFY > 0)
          ? (((actual / nY) * CACHE.months.length) / effFY) * 100 : null,

        salesJoinable: hasSales,
        joinableBudget: a.joinableBudget,
        sales: hasSales ? salesVal : null,
        salesTarget: hasSales && salesTgt > 0 ? salesTgt : null,
        salesAchievementPct: hasSales && salesTgt > 0 ? (salesVal / salesTgt) * 100 : null,

        // Both ratios divide by the SAME sales figure and use the MAPPED
        // portion of spend, so budget and actual are directly comparable to
        // each other and to every other row.
        expenseToSalesPct: hasSales && effJoinable > 0
          ? (effJoinable / salesVal) * 100 : null,
        actualToSalesPct: (hasSales && actual !== null && a.budget > 0)
          ? (actual * (a.joinableBudget / a.budget) / salesVal) * 100 : null,

        // "Sales per EGP spent". Deliberately NOT called efficiency in the UI:
        // Sales/Expense reads as a productivity ratio and invites the causal
        // reading — that spend PRODUCED the sales — which this data cannot
        // support. Reported because it is asked for and is genuinely useful for
        // ranking, alongside the causally neutral Expense-to-Sales.
        salesPerEgpSpent: (hasSales && actual !== null && actual > 0)
          ? salesVal / actual : null,
        ratioIsPartial: hasSales && a.joinableBudget > 0 && a.joinableBudget < a.budget - 0.5,
        mappingStatus: Object.keys(a.statuses).sort().join(" + ")
      };
    });

    out.sort(function (x, y) { return y.budget - x.budget; });

    return {
      ok: true, status: "ready", source: "expense",
      bu: bu, line: line || "All", grain: buGrain,
      activeFilter: o.activeFilter, scenario: o.scenario,
      unit: "EGP",
      ytdMonths: nY,
      ytdThrough: CACHE.months[nY - 1] || null,
      basis: "YTD budget vs Non-Tender sales, Value basis",
      entities: out
    };
  }

  // ---------------------------------------------------------------------
  // Public: summary (the KPI cards)
  // ---------------------------------------------------------------------
  function getExpenseSummary(bu, line, options) {
    if (!isReady()) return fail("cache_unavailable");
    var o = opt(options);
    var res = getEntityExpense(bu, line, options);
    if (!res.ok) return res;

    var budget = 0, joinableBudget = 0, sales = 0, salesTarget = 0;
    var budgetFullYear = 0, actual = 0, actualCount = 0, actualJoinable = 0;
    var effBudget = 0, effFullYear = 0, revisedCount = 0;
    res.entities.forEach(function (e) {
      budget += e.budget;
      budgetFullYear += e.budgetFullYear;
      effBudget += e.effectiveBudget;
      effFullYear += e.effectiveBudgetFullYear;
      if (e.revisedBudgetFullYear !== null) revisedCount++;
      joinableBudget += e.joinableBudget;
      if (e.actual !== null) {
        actual += e.actual;
        actualCount++;
        // The mapped share of this entity's actual, so the actual-to-sales
        // ratio is built on the same population as the budget one.
        actualJoinable += e.budget > 0 ? e.actual * (e.joinableBudget / e.budget) : 0;
      }
      if (e.salesJoinable) {
        sales += e.sales;
        if (e.salesTarget) salesTarget += e.salesTarget;
      }
    });

    // FULL-YEAR coverage, alongside the YTD figure.
    //
    // Both are true and they are not the same number: YTD coverage weights each
    // SKU by the budget phased into the closed months, full-year weights it by
    // the whole plan. The Phase A gate (92.7%) is a full-year measure, so
    // reporting only the YTD figure would look like the gate had moved when it
    // had not. Exposing both keeps the page and the Phase A record tied.
    var fyTotal = 0, fyJoin = 0;
    res.entities.forEach(function (e) {
      fyTotal += e.budgetFullYear;
      if (e.budget > 0) fyJoin += e.budgetFullYear * (e.joinableBudget / e.budget);
    });

    // Coverage is computed on the SAME population the cards describe, so the
    // disclosure and the headline can never drift apart.
    var covPct = budget > 0 ? (joinableBudget / budget) * 100 : null;

    // Scope-wide totals, so the page can say what the filter is holding back.
    // Measured on the same YTD window as everything else.
    var nY = ytdMonthCount(o.period);
    var all = rowsFor(bu, line, "all");
    var scopeBudget = 0, inactiveBudget = 0, inactiveCount = 0;
    all.forEach(function (r) {
      scopeBudget += ytdBudget(r, nY);
      if (r[ACTIVE] === ACTIVE_NO) { inactiveBudget += ytdBudget(r, nY); inactiveCount++; }
    });

    return {
      ok: true, status: "ready", source: "expense",
      bu: bu, line: line || "All", grain: res.grain,
      activeFilter: o.activeFilter, scenario: o.scenario,
      unit: "EGP",
      ytdMonths: nY,
      ytdThrough: CACHE.months[nY - 1] || null,
      budget: budget,
      budgetFullYear: budgetFullYear,
      actual: actualCount > 0 ? actual : null,
      actualEnteredCount: actualCount,
      effectiveBudget: effBudget,
      effectiveBudgetFullYear: effFullYear,
      revisedCount: revisedCount,

      utilizationPct: (actualCount > 0 && effBudget > 0) ? (actual / effBudget) * 100 : null,
      variance: actualCount > 0 ? actual - effBudget : null,
      variancePct: (actualCount > 0 && effBudget > 0)
        ? ((actual - effBudget) / effBudget) * 100 : null,

      /**
       * BURN RATE vs ELAPSED TIME — the measure utilization alone cannot give.
       *
       *   burnIndex = utilization% / (elapsed months / total months)
       *
       * 1.0 = spending exactly in step with the calendar. Above 1.0 = ahead of
       * pace. 50% utilization means opposite things in March and in June, and
       * this is the number that tells them apart.
       *
       * Measured against the FULL-YEAR plan, because pace only means something
       * relative to the whole year.
       */
      elapsedShare: CACHE.months.length > 0 ? nY / CACHE.months.length : null,
      burnIndex: (actualCount > 0 && effFullYear > 0 && nY > 0)
        ? (actual / effFullYear) / (nY / CACHE.months.length) : null,

      // Straight-line projection to year end at the current run rate.
      projectedFullYear: (actualCount > 0 && nY > 0)
        ? (actual / nY) * CACHE.months.length : null,
      projectedVsPlanPct: (actualCount > 0 && nY > 0 && effFullYear > 0)
        ? (((actual / nY) * CACHE.months.length) / effFullYear) * 100 : null,
      projectedOverspend: (actualCount > 0 && nY > 0)
        ? ((actual / nY) * CACHE.months.length) - effFullYear : null,

      // What is left of the full-year plan. Negative = already past it.
      remainingBudget: actualCount > 0 ? effFullYear - actual : null,
      sales: sales > 0 ? sales : null,
      salesTarget: salesTarget > 0 ? salesTarget : null,
      salesAchievementPct: salesTarget > 0 ? (sales / salesTarget) * 100 : null,
      // Undefined, never zero — see Rule 2 of the Active filter spec. Under
      // activeFilter="inactive" there are no sales by measurement, so this
      // stays null and the page suppresses the ratio rather than printing 0%.
      //
      // Numerator is joinableBudget for the same reason as the row-level
      // ratio: sales only covers mapped SKUs, so the budget in the ratio must
      // too. Using the full budget here would inflate the headline by exactly
      // the unmapped share -- currently 7.3% of active budget.
      expenseToSalesPct: sales > 0 && joinableBudget > 0
        ? (joinableBudget / sales) * 100 : null,
      // Same denominator, same mapped population — so the two ratios can be
      // read side by side without a footnote explaining why they differ.
      actualToSalesPct: (sales > 0 && actualCount > 0 && actualJoinable > 0)
        ? (actualJoinable / sales) * 100 : null,
      salesPerEgpSpent: (sales > 0 && actualCount > 0 && actual > 0)
        ? sales / actual : null,
      coverage: {
        budgetTotal: budget,
        budgetJoinable: joinableBudget,
        joinablePct: covPct,
        excludedBudget: budget - joinableBudget,
        budgetTotalFullYear: fyTotal,
        budgetJoinableFullYear: fyJoin,
        joinablePctFullYear: fyTotal > 0 ? (fyJoin / fyTotal) * 100 : null
      },
      scope: {
        totalBudget: scopeBudget,
        inactiveBudget: inactiveBudget,
        inactiveCount: inactiveCount,
        excludedByFilter: scopeBudget - budget
      },
      entityCount: res.entities.length
    };
  }

  /**
   * CORPORATE BENCHMARK — blended Expense-to-Sales across every BU.
   *
   * Answers the question a single ratio cannot: is 8.8% good? Follows the
   * ungated-aggregate pattern already used for the Executive page's "vs
   * Corporate" reference — a BU-restricted user sees the blended company
   * figure, which reveals no other BU's individual numbers.
   *
   * Deliberately computed with ignoreScope, and it returns ONE number. Any
   * per-BU breakdown would leak exactly what the scope guard exists to stop.
   */
  function getCorporateBenchmark(options) {
    if (!isReady()) return null;
    var o = opt(options);
    var nY = ytdMonthCount(o.period);
    var L = CACHE.lookups;
    var byBu = {};
    CACHE.rows.forEach(function (r) {
      if (!passesActive(r[ACTIVE], o.activeFilter)) return;
      var b = L.bus[r[BU]];
      if (!byBu[b]) byBu[b] = 0;
      if (r[JOINABLE] === 1) byBu[b] += ytdBudget(r, nY);
    });
    var totBudget = 0, totSales = 0;
    Object.keys(byBu).forEach(function (b) {
      var sales = salesByEntity(b, "All", "brand", o.scenario, o.period);
      var sv = 0;
      Object.keys(sales).forEach(function (k) { sv += sales[k].actualValue; });
      if (sv > 0) { totBudget += byBu[b]; totSales += sv; }
    });
    return totSales > 0 ? {
      expenseToSalesPct: (totBudget / totSales) * 100,
      basis: "All business units, mapped budget \u00f7 sales, same period and Active filter"
    } : null;
  }

  // ---------------------------------------------------------------------
  // Public: monthly trend
  // ---------------------------------------------------------------------
  function getExpenseTrend(bu, line, options) {
    if (!isReady()) return fail("cache_unavailable", { months: [], series: [] });
    var o = opt(options);
    var rows = rowsFor(bu, line, o.activeFilter);
    var series = new Array(CACHE.months.length).fill(0);
    rows.forEach(function (r) {
      for (var m = 0; m < series.length; m++) series[m] += (r[MONTHLY][m] || 0);
    });
    return {
      ok: true, status: "ready", source: "expense",
      bu: bu, line: line || "All", unit: "EGP",
      months: CACHE.months.slice(),
      series: series,
      ytdMonths: ytdMonthCount()
    };
  }

  // ---------------------------------------------------------------------
  // Public: reconciliation (the control report)
  // ---------------------------------------------------------------------
  /**
   * DELIBERATELY IGNORES bu, line AND the Active filter.
   *
   * This is a control total against Finance's line budget. It must cover all
   * budget at all times. If a filter could move it, "total budget" would mean
   * different things on different screens, and the first person to notice would
   * stop trusting every number on the page.
   */
  function getBudgetReconciliation() {
    if (!isReady()) return fail("cache_unavailable", { lines: [] });
    var lines = (CACHE.reconciliation || []).slice();
    var lineSheet = 0, skuSheet = 0;
    lines.forEach(function (x) { lineSheet += x.lineSheet; skuSheet += x.skuSheet; });
    return {
      ok: true, status: "ready", source: "expense",
      lines: lines,
      openCount: lines.filter(function (x) { return !x.decided; }).length,
      decidedCount: lines.filter(function (x) { return x.decided; }).length,
      exceptionLineSheet: lineSheet,
      exceptionSkuSheet: skuSheet
    };
  }

  // ---------------------------------------------------------------------
  // Public: dimensions
  // ---------------------------------------------------------------------
  function getAllowedBUs() {
    if (!isReady()) return [];
    var seen = {};
    CACHE.rows.forEach(function (r) {
      var rawLine = CACHE.lookups.lines[r[LINE]];
      if (global.AUTH && !global.AUTH.isLineAllowed(rawLine)) return;
      seen[CACHE.lookups.bus[r[BU]]] = true;
    });
    var list = Object.keys(seen).filter(Boolean).sort();
    return global.AUTH ? global.AUTH.filterAllowedBUs(list) : list;
  }

  function getLinesForBU(bu) {
    if (!isReady()) return [];
    var seen = {};
    CACHE.rows.forEach(function (r) {
      if (bu && bu !== "All" && CACHE.lookups.bus[r[BU]] !== bu) return;
      var rawLine = CACHE.lookups.lines[r[LINE]];
      if (global.AUTH && !global.AUTH.isLineAllowed(rawLine)) return;
      seen[rawLine] = true;
    });
    return Object.keys(seen).filter(Boolean).sort();
  }

  function getMeta() {
    if (!isReady()) return null;
    return {
      builtAt: CACHE.builtAt, source: CACHE.source,
      months: CACHE.months.slice(), schemaVersion: CACHE.schemaVersion,
      notes: CACHE.notes
    };
  }

  // ---------------------------------------------------------------------
  // Actuals — user-entered, held here so the arithmetic stays in one place
  // ---------------------------------------------------------------------
  function setActual(bu, entity, value) {
    var k = actualKey(bu, entity);
    if (value === null || value === undefined || value === "") {
      delete ACTUALS[k];                       // cleared, not zeroed
      return true;
    }
    var n = Number(value);
    // A negative actual is almost always a sign-convention mistake, and
    // accepting it would quietly reduce a BU's spend. Same rule the import
    // validation spec applies to file-loaded values.
    if (!isFinite(n) || n < 0) return false;
    ACTUALS[k] = n;
    return true;
  }
  function getActual(bu, entity) {
    var v = ACTUALS[actualKey(bu, entity)];
    return (typeof v === "number") ? v : null;
  }
  function getAllActuals() {
    var out = {};
    for (var k in ACTUALS) out[k] = ACTUALS[k];
    return out;
  }
  function loadActuals(map, replace) {
    if (replace) ACTUALS = {};
    var n = 0;
    for (var k in (map || {})) {
      var v = Number(map[k]);
      if (isFinite(v) && v >= 0) { ACTUALS[k] = v; n++; }
    }
    return n;
  }
  function clearActuals() { ACTUALS = {}; }

  function setRevisedBudget(bu, entity, value) {
    var k = actualKey(bu, entity);
    if (value === null || value === undefined || value === "") { delete REVISED[k]; return true; }
    var n = Number(value);
    if (!isFinite(n) || n < 0) return false;
    REVISED[k] = n;
    return true;
  }
  function getRevisedBudget(bu, entity) {
    var v = REVISED[actualKey(bu, entity)];
    return (typeof v === "number") ? v : null;
  }
  function getAllRevised() {
    var out = {};
    for (var k in REVISED) out[k] = REVISED[k];
    return out;
  }
  function loadRevised(map, replace) {
    if (replace) REVISED = {};
    var n = 0;
    for (var k in (map || {})) {
      var v = Number(map[k]);
      if (isFinite(v) && v >= 0) { REVISED[k] = v; n++; }
    }
    return n;
  }

  global.ExpenseDashboard = {
    isReady: isReady,
    expenseGrainFor: expenseGrainFor,
    setActual: setActual,
    getActual: getActual,
    getAllActuals: getAllActuals,
    loadActuals: loadActuals,
    clearActuals: clearActuals,
    setRevisedBudget: setRevisedBudget,
    getRevisedBudget: getRevisedBudget,
    getAllRevised: getAllRevised,
    loadRevised: loadRevised,
    getCorporateBenchmark: getCorporateBenchmark,
    getYtdMonthCount: function () { return isReady() ? ytdMonthCount() : 0; },
    getExpenseSummary: getExpenseSummary,
    getEntityExpense: getEntityExpense,
    getExpenseTrend: getExpenseTrend,
    getBudgetReconciliation: getBudgetReconciliation,
    getAllowedBUs: getAllowedBUs,
    getLinesForBU: getLinesForBU,
    getAvailableMonths: function () { return isReady() ? CACHE.months.slice() : []; },
    getMeta: getMeta
  };
})(window);
