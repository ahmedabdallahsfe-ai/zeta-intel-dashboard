/**
 * expense.js — Expense vs Sales workspace
 * =============================================================================
 * Exposes window.ExpenseVsSales ({ init, destroy }), the same contract every
 * other workspace in the shell uses.
 *
 * WHAT THIS PAGE IS, AND IS NOT
 * -----------------------------------------------------------------------------
 * BUDGET vs Sales. There is no actual-expense data anywhere in the source, and
 * none is invented here. Every "expense" figure on this page is BUDGETED
 * expense, and every label says so. Actual-expense entry is Phase C.
 *
 * OBSERVATIONAL, NOT CAUSAL
 * -----------------------------------------------------------------------------
 * Ahmed's standing instruction: state what moved together, never why. The page
 * says "budget is X% of sales", never "spending drove sales". Expense-to-Sales
 * leads over "efficiency" for exactly that reason — Sales/Expense reads as a
 * productivity ratio and invites the causal reading.
 *
 * READS, NEVER WRITES
 * -----------------------------------------------------------------------------
 * All expense figures come from ExpenseDashboard, all sales figures from
 * SalesDashboard. This file computes no business arithmetic of its own.
 */
(function (global) {
  "use strict";

  var CONTAINER_ID = null;

  var STATE = {
    bu: null,
    line: "All",
    activeFilter: "active",
    scenario: null,
    period: "YTD"
  };

  var ALL_BU = "__ALL__";
  var STORE_KEY = "zeta.expense.actuals.v1";

  /**
   * ACTUAL EXPENSE PERSISTENCE — and the honest limits of it.
   *
   * The platform is a static site with no backend, so a value typed here
   * cannot reach anyone else's screen by itself. Two things follow, and both
   * are handled rather than hidden:
   *
   *  1. Edits are saved to THIS BROWSER so a refresh does not destroy an
   *     hour of typing. Losing entries to an accidental reload would be a
   *     worse failure than the one below.
   *  2. Because they are local, the page states so ON SCREEN — including the
   *     count and when they were last exported. Ahmed's original objection to
   *     browser storage was that two people could see different "actuals" with
   *     nothing indicating it. The storage is not the problem; the silence was.
   *     Sharing is a deliberate act: Export -> commit via refresh.bat.
   */
  var STORAGE_WARNED = false;
  function loadStore() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (o && o.values) {
        global.ExpenseDashboard.loadActuals(o.values, true);
        if (o.revised) global.ExpenseDashboard.loadRevised(o.revised, true);
        return o;
      }
    } catch (e) {
      // Storage can be unavailable (private mode, a sandboxed origin, a
      // policy). That is not an error worth repeating on every render -- the
      // page still works, edits just do not survive a refresh.
      if (!STORAGE_WARNED) {
        STORAGE_WARNED = true;
        console.warn("[Expense] browser storage unavailable; actuals will not persist:", e);
      }
    }
    return null;
  }
  function saveStore(exportedAt) {
    try {
      var prev = {};
      try { prev = JSON.parse(global.localStorage.getItem(STORE_KEY) || "{}"); } catch (e) {}
      global.localStorage.setItem(STORE_KEY, JSON.stringify({
        values: global.ExpenseDashboard.getAllActuals(),
        revised: global.ExpenseDashboard.getAllRevised(),
        savedAt: new Date().toISOString(),
        exportedAt: exportedAt || prev.exportedAt || null
      }));
    } catch (e) {
      if (!STORAGE_WARNED) {
        STORAGE_WARNED = true;
        console.warn("[Expense] browser storage unavailable; actuals will not persist:", e);
      }
    }
  }
  function storeMeta() {
    try { return JSON.parse(global.localStorage.getItem(STORE_KEY) || "{}"); }
    catch (e) { return {}; }
  }

  // ---------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------
  function fmtEGP(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return v.toFixed(0);
  }
  function fmtFull(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return Math.round(v).toLocaleString("en-US");
  }
  /**
   * The dash rule, in one function.
   * null means NOT DEFINED and must render as an em dash. It must never fall
   * through to "0.0%" — a zero would be read as a measured value, and on
   * Expense-to-Sales it would say the opposite of the truth.
   */
  function fmtPct(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return v.toFixed(digits === undefined ? 1 : digits) + "%";
  }
  function esc(s) {
    return global.DS && global.DS._escapeHtml ? global.DS._escapeHtml(String(s)) : String(s);
  }

  /**
   * charts.js declares `const Charts = ...` at top level. A const declaration
   * creates a global LEXICAL binding, not a property of window — so
   * `window.Charts` is undefined even though the bare identifier resolves
   * fine. Every other module reaches it bare; this helper does the same, with
   * a typeof guard so a load-order change degrades to "no chart" rather than
   * a ReferenceError that takes the whole page down.
   */
  function charts() {
    return (typeof Charts !== "undefined") ? Charts : null;
  }

  /**
   * Viewing and editing are separate rights. CEO / VP / Commercial Director /
   * BEx read these numbers to decide; SFE and BU Managers own and report them.
   * A read-only role sees the values as plain text, not a disabled input --
   * a greyed-out box still implies "you could type here if only...", which is
   * a worse experience than a clean read-only view.
   */
  function canEdit() {
    return !!(global.AUTH && typeof global.AUTH.canEditExpense === "function"
      && global.AUTH.canEditExpense());
  }

  // ---------------------------------------------------------------------
  // Scope helpers
  // ---------------------------------------------------------------------
  function allowedBUs() {
    return (global.ExpenseDashboard && global.ExpenseDashboard.getAllowedBUs()) || [];
  }
  function canSelectAllBUs() {
    return !!(global.AUTH && typeof global.AUTH.canViewAllBUs === "function"
      && global.AUTH.canViewAllBUs() && allowedBUs().length > 1);
  }
  function isAllBU(bu) { return bu === ALL_BU; }

  function currentScenario() {
    if (STATE.scenario) return STATE.scenario;
    if (global.AUTH && typeof global.AUTH.getActiveScenario === "function") {
      return global.AUTH.getActiveScenario();
    }
    return global.SEMANTIC ? global.SEMANTIC.DEFAULT_SCENARIO : "official";
  }

  /**
   * Company view = the sum of each BU computed separately, never one blended
   * query. The grain rule differs per BU (CHC is SKU, everything else is
   * Brand), so a single cross-BU query would have to pick one grain and would
   * silently misreport the other.
   */
  function acrossBUs(fn) {
    var out = [];
    allowedBUs().forEach(function (bu) { out.push({ bu: bu, res: fn(bu) }); });
    return out;
  }

  function summaryFor(bu, line) {
    var o = { activeFilter: STATE.activeFilter, scenario: currentScenario(), period: STATE.period };
    if (!isAllBU(bu)) return global.ExpenseDashboard.getExpenseSummary(bu, line, o);

    var parts = acrossBUs(function (b) {
      return global.ExpenseDashboard.getExpenseSummary(b, "All", o);
    }).filter(function (p) { return p.res && p.res.ok; });

    var agg = {
      ok: true, status: "ready", source: "expense", bu: ALL_BU, line: "All",
      grain: "brand", activeFilter: STATE.activeFilter, scenario: currentScenario(),
      unit: "EGP", budget: 0, budgetFullYear: 0, sales: 0, salesTarget: 0, entityCount: 0,
      actual: 0, actualEnteredCount: 0, ytdMonths: 0, ytdThrough: null,
      // The company view must carry EVERY field a single-BU summary does.
      // Anything missing here arrives as `undefined` in renderKPIs and takes
      // the page down the moment someone selects All Business Units -- which
      // is exactly what happened before these were added.
      effectiveBudget: 0, effectiveBudgetFullYear: 0, revisedCount: 0,
      coverage: { budgetTotal: 0, budgetJoinable: 0, joinablePct: null, excludedBudget: 0 },
      scope: { totalBudget: 0, inactiveBudget: 0, inactiveCount: 0, excludedByFilter: 0 }
    };
    parts.forEach(function (p) {
      var s = p.res;
      agg.budget += s.budget;
      agg.budgetFullYear += s.budgetFullYear || 0;
      agg.effectiveBudget += s.effectiveBudget || 0;
      agg.effectiveBudgetFullYear += s.effectiveBudgetFullYear || 0;
      agg.revisedCount += s.revisedCount || 0;
      agg.actual += s.actual || 0;
      agg.actualEnteredCount += s.actualEnteredCount || 0;
      agg.ytdMonths = s.ytdMonths || agg.ytdMonths;
      agg.ytdThrough = s.ytdThrough || agg.ytdThrough;
      // The actual-to-sales numerator has to be rebuilt from each BU's own
      // mapped share; summing the percentages would weight every BU equally
      // regardless of size.
      if (s.actualToSalesPct !== null && s.sales) {
        agg.__actJoin = (agg.__actJoin || 0) + (s.actualToSalesPct / 100) * s.sales;
      }
      agg.sales += s.sales || 0;
      agg.salesTarget += s.salesTarget || 0;
      agg.entityCount += s.entityCount;
      agg.coverage.budgetTotal += s.coverage.budgetTotal;
      agg.coverage.budgetJoinable += s.coverage.budgetJoinable;
      agg.coverage.excludedBudget += s.coverage.excludedBudget;
      agg.scope.totalBudget += s.scope.totalBudget;
      agg.scope.inactiveBudget += s.scope.inactiveBudget;
      agg.scope.inactiveCount += s.scope.inactiveCount;
      agg.scope.excludedByFilter += s.scope.excludedByFilter;
    });
    agg.coverage.joinablePct = agg.coverage.budgetTotal > 0
      ? (agg.coverage.budgetJoinable / agg.coverage.budgetTotal) * 100 : null;
    agg.salesAchievementPct = agg.salesTarget > 0 ? (agg.sales / agg.salesTarget) * 100 : null;
    // Mapped budget over sales, matching the per-BU definition exactly.
    agg.expenseToSalesPct = (agg.sales > 0 && agg.coverage.budgetJoinable > 0)
      ? (agg.coverage.budgetJoinable / agg.sales) * 100 : null;
    agg.actualToSalesPct = (agg.sales > 0 && agg.__actJoin > 0)
      ? (agg.__actJoin / agg.sales) * 100 : null;
    agg.utilizationPct = (agg.actualEnteredCount > 0 && agg.effectiveBudget > 0)
      ? (agg.actual / agg.effectiveBudget) * 100 : null;
    agg.variance = agg.actualEnteredCount > 0 ? agg.actual - agg.effectiveBudget : null;
    agg.variancePct = (agg.actualEnteredCount > 0 && agg.effectiveBudget > 0)
      ? ((agg.actual - agg.effectiveBudget) / agg.effectiveBudget) * 100 : null;

    // Pace and projection, rebuilt from the aggregated totals rather than
    // averaged across BUs -- averaging percentages would weight a small BU
    // the same as a large one.
    var totalMonths = (global.ExpenseDashboard.getAvailableMonths() || []).length || 12;
    agg.elapsedShare = agg.ytdMonths > 0 ? agg.ytdMonths / totalMonths : null;
    agg.burnIndex = (agg.actualEnteredCount > 0 && agg.effectiveBudgetFullYear > 0 && agg.elapsedShare)
      ? (agg.actual / agg.effectiveBudgetFullYear) / agg.elapsedShare : null;
    agg.projectedFullYear = (agg.actualEnteredCount > 0 && agg.ytdMonths > 0)
      ? (agg.actual / agg.ytdMonths) * totalMonths : null;
    agg.projectedVsPlanPct = (agg.projectedFullYear !== null && agg.effectiveBudgetFullYear > 0)
      ? (agg.projectedFullYear / agg.effectiveBudgetFullYear) * 100 : null;
    agg.projectedOverspend = agg.projectedFullYear !== null
      ? agg.projectedFullYear - agg.effectiveBudgetFullYear : null;
    agg.remainingBudget = agg.actualEnteredCount > 0
      ? agg.effectiveBudgetFullYear - agg.actual : null;
    agg.salesPerEgpSpent = (agg.sales > 0 && agg.actualEnteredCount > 0 && agg.actual > 0)
      ? agg.sales / agg.actual : null;
    if (!agg.actualEnteredCount) agg.actual = null;
    if (!agg.sales) agg.sales = null;
    if (!agg.salesTarget) agg.salesTarget = null;
    delete agg.__actJoin;
    return agg;
  }

  function entitiesFor(bu, line) {
    var o = { activeFilter: STATE.activeFilter, scenario: currentScenario(), period: STATE.period };
    if (!isAllBU(bu)) return global.ExpenseDashboard.getEntityExpense(bu, line, o);
    var rows = [];
    acrossBUs(function (b) {
      var r = global.ExpenseDashboard.getEntityExpense(b, "All", o);
      if (r && r.ok) {
        r.entities.forEach(function (e) { e.__bu = b; rows.push(e); });
      }
      return r;
    });
    rows.sort(function (x, y) { return y.budget - x.budget; });
    return { ok: true, status: "ready", grain: "brand", entities: rows, bu: ALL_BU, line: "All" };
  }

  // ---------------------------------------------------------------------
  // Filter bar
  // ---------------------------------------------------------------------
  function renderFilterBar() {
    var wrap = document.createElement("div");
    wrap.className = "ds-exec-filterbar";

    var buOptions = (canSelectAllBUs() ? [{ value: ALL_BU, label: "All Business Units" }] : [])
      .concat(allowedBUs().map(function (b) { return { value: b, label: b }; }));

    var allBu = isAllBU(STATE.bu);
    var lineOptions = allBu
      ? [{ value: "All", label: "All Lines" }]
      : [{ value: "All", label: "All Lines" }].concat(
          global.ExpenseDashboard.getLinesForBU(STATE.bu).map(function (l) {
            return { value: l, label: l };
          }));

    var buSel = global.DS.select({
      id: "exp-filter-bu", label: "Business Unit", options: buOptions,
      value: STATE.bu, disabled: buOptions.length <= 1
    });
    var lineSel = global.DS.select({
      id: "exp-filter-line", label: "Line", options: lineOptions,
      value: allBu ? "All" : STATE.line, disabled: allBu
    });
    // The Active control. Three options, never a checkbox — see the Phase A
    // spec. "All" deliberately sits last so the default reads first.
    var activeSel = global.DS.select({
      id: "exp-filter-active", label: "Active SKUs",
      options: [
        { value: "active", label: "Active only (Yes)" },
        { value: "inactive", label: "Not active (No)" },
        { value: "all", label: "All SKUs" }
      ],
      value: STATE.activeFilter
    });

    var smRes = (global.SalesDashboard && global.SalesDashboard.getAvailableMonths)
      ? global.SalesDashboard.getAvailableMonths() : null;
    var months = (smRes && smRes.ok && Array.isArray(smRes.months)) ? smRes.months : [];
    var lastMonthLabel = months.length > 0 ? months[months.length - 1].label : "Jun";
    var periodOptions = [{ value: "YTD", label: "YTD (Jan - " + lastMonthLabel + ")" }];
    months.forEach(function (m) {
      periodOptions.push({ value: m.key, label: "YTD through " + m.label });
    });

    var periodSel = global.DS.select({
      id: "exp-filter-period", label: "Period", options: periodOptions,
      value: STATE.period || "YTD"
    });

    wrap.appendChild(buSel);
    wrap.appendChild(lineSel);
    wrap.appendChild(activeSel);
    wrap.appendChild(periodSel);

    // Target basis, role-gated exactly as Sales and Executive do it. Roles
    // without the entitlement get a read-only label rather than a disabled
    // control, so their UI never implies a choice they do not have.
    var canToggle = !!(global.AUTH && typeof global.AUTH.canToggleScenario === "function"
      && global.AUTH.canToggleScenario());
    var meta = (global.SEMANTIC && global.SEMANTIC.TARGET_SCENARIOS[currentScenario()])
      || { label: "Official Target" };
    if (canToggle) {
      var scOpts = Object.keys(global.SEMANTIC.TARGET_SCENARIOS).map(function (k) {
        return { value: k, label: global.SEMANTIC.TARGET_SCENARIOS[k].label };
      });
      var scSel = global.DS.select({
        id: "exp-filter-scenario", label: "Target Basis",
        options: scOpts, value: currentScenario()
      });
      wrap.appendChild(scSel);
      scSel.querySelector("select").addEventListener("change", function (e) {
        if (global.AUTH && global.AUTH.setActiveScenario(e.target.value)) {
          STATE.scenario = e.target.value;
          render();
        }
      });
    } else {
      var lbl = document.createElement("div");
      lbl.className = "ds-select-wrap";
      lbl.innerHTML = '<label class="ds-select-label">Target Basis</label>'
        + '<div style="font-size:13px;font-weight:700;color:var(--color-text-primary,#0F172A);padding:6px 0;">'
        + esc(meta.label) + '</div>';
      wrap.appendChild(lbl);
    }

    buSel.querySelector("select").addEventListener("change", function (e) {
      STATE.bu = e.target.value;
      STATE.line = "All";
      render();
    });
    lineSel.querySelector("select").addEventListener("change", function (e) {
      STATE.line = e.target.value;
      render();
    });
    activeSel.querySelector("select").addEventListener("change", function (e) {
      STATE.activeFilter = e.target.value;
      render();
    });
    periodSel.querySelector("select").addEventListener("change", function (e) {
      STATE.period = e.target.value;
      render();
    });

    return wrap;
  }

  // ---------------------------------------------------------------------
  // Disclosure banner
  // ---------------------------------------------------------------------
  /**
   * Two disclosures the page is not allowed to omit:
   *   1. how much budget cannot be joined to sales
   *   2. how much budget the Active filter is holding back
   *
   * Both live next to the numbers, not in a tooltip. A total that excludes
   * money without saying so will be read as the company total, and it is not.
   */
  function renderDisclosure(sum) {
    var bits = [];
    var cov = sum.coverage;
    if (sum.ytdMonths) {
      bits.push('All figures are <strong>year-to-date through ' + esc(sum.ytdThrough)
        + '</strong> (' + sum.ytdMonths + ' months). Budget is summed over those months '
        + 'using its real monthly phasing — not prorated — so it is directly comparable '
        + 'to sales. The full-year plan is ' + fmtFull(sum.budgetFullYear) + ' EGP; '
        + 'comparing that against ' + sum.ytdMonths + ' months of sales would overstate '
        + 'every ratio on this page.');
    }
    if (cov && cov.excludedBudget > 0) {
      bits.push('<strong>' + fmtPct(cov.joinablePct) + '</strong> of budget in view can be '
        + 'joined to sales (' + fmtFull(cov.budgetJoinable) + ' of ' + fmtFull(cov.budgetTotal)
        + ' EGP). The remaining <strong>' + fmtFull(cov.excludedBudget) + ' EGP</strong> has no '
        + 'ratified sales match, so it is counted in budget totals but not in any '
        + 'Expense-to-Sales figure.');
    }
    if (STATE.activeFilter === "active" && sum.scope && sum.scope.excludedByFilter > 0) {
      bits.push('Showing <strong>Active SKUs only</strong>. '
        + fmtFull(sum.scope.excludedByFilter) + ' EGP on '
        + sum.scope.inactiveCount + ' SKU(s) marked <em>not active</em> is excluded from these '
        + 'figures and retained in full in reconciliation below.');
    }
    if (STATE.activeFilter === "inactive") {
      bits.push('Showing <strong>SKUs marked not active</strong>. Measured: none of these have '
        + 'recorded sales, so Expense-to-Sales and achievement are <strong>not defined</strong> '
        + 'and shown as &mdash;. The source workbook carries no definition of what this flag '
        + 'means; no status is inferred.');
    }
    var meta = storeMeta();
    var n = Object.keys(global.ExpenseDashboard.getAllActuals()).length;
    if (n > 0) {
      var exported = meta.exportedAt
        ? 'last exported ' + esc(String(meta.exportedAt).slice(0, 16).replace("T", " "))
        : '<strong>never exported</strong>';
      bits.push('<span style="color:var(--color-warning);font-weight:700;">Local edits:</span> '
        + n + ' actual value(s) are saved in <strong>this browser only</strong> and are not '
        + 'visible to anyone else — ' + exported + '. Use <em>Export actuals</em> and commit '
        + 'the file to share them.');
    }

    if (!bits.length) return "";
    return '<div class="exp-note">'
      + '<div class="exp-note-title">How to read these numbers</div>'
      + bits.map(function (b) {
          return '<div class="exp-note-item">' + b + '</div>';
        }).join("")
      + '</div>';
  }

  // ---------------------------------------------------------------------
  // KPI cards
  // ---------------------------------------------------------------------
  function renderKPIs(sum) {
    var mo = sum.ytdMonths ? " (" + sum.ytdMonths + "mo YTD)" : "";
    var cards = [];

    cards.push(global.DS.kpiCard({
      label: "Budget YTD" + mo, value: fmtEGP(sum.effectiveBudget) + " EGP",
      delta: (sum.revisedCount > 0 ? sum.revisedCount + " revised · " : "")
        + "of " + fmtEGP(sum.effectiveBudgetFullYear) + " full-year"
    }));

    cards.push(global.DS.kpiCard({
      label: "Actual Expense",
      value: sum.actual === null ? "—" : fmtEGP(sum.actual) + " EGP",
      delta: sum.actual === null ? "none entered yet"
        : sum.actualEnteredCount + " of " + sum.entityCount + " entered"
    }));

    cards.push(global.DS.kpiCard({
      label: "Budget Utilization",
      value: fmtPct(sum.utilizationPct),
      delta: sum.variance === null ? "no actual entered"
        : (sum.variance > 0 ? "+" : "") + fmtEGP(sum.variance) + " vs YTD budget",
      direction: sum.utilizationPct === null ? "flat"
        : sum.utilizationPct > 100 ? "up" : "down"
    }));

    // BURN RATE — the card that makes Utilization interpretable.
    // 50% spent means opposite things in March and in June.
    cards.push(global.DS.kpiCard({
      label: "Burn Rate vs Elapsed",
      value: sum.burnIndex === null ? "—" : sum.burnIndex.toFixed(2) + "×",
      delta: sum.burnIndex === null ? "no actual entered"
        : (sum.burnIndex > 1.05 ? "ahead of pace"
          : sum.burnIndex < 0.95 ? "behind pace" : "on pace")
          + " · " + fmtPct(sum.elapsedShare * 100, 0) + " of year elapsed",
      direction: sum.burnIndex === null ? "flat" : sum.burnIndex > 1.05 ? "up" : "down"
    }));

    cards.push(global.DS.kpiCard({
      label: "Projected Full-Year",
      value: sum.projectedFullYear === null ? "—" : fmtEGP(sum.projectedFullYear) + " EGP",
      delta: sum.projectedOverspend === null ? "needs actual to project"
        : (sum.projectedOverspend > 0 ? "+" : "") + fmtEGP(sum.projectedOverspend)
          + " vs plan (" + fmtPct(sum.projectedVsPlanPct, 0) + ")",
      direction: sum.projectedOverspend === null ? "flat"
        : sum.projectedOverspend > 0 ? "up" : "down"
    }));

    cards.push(global.DS.kpiCard({
      label: "Remaining Budget",
      value: sum.remainingBudget === null ? "—" : fmtEGP(sum.remainingBudget) + " EGP",
      delta: sum.remainingBudget === null ? "no actual entered"
        : sum.remainingBudget < 0 ? "full-year plan already exceeded"
        : "left of the full-year plan"
    }));

    // Budget % of Sales, with the corporate benchmark beside it. A ratio with
    // nothing to compare against cannot be judged.
    var bench = global.ExpenseDashboard.getCorporateBenchmark({
      activeFilter: STATE.activeFilter, scenario: currentScenario(), period: STATE.period
    });
    var benchDelta = "mapped budget ÷ sales";
    if (bench && sum.expenseToSalesPct !== null) {
      var d = sum.expenseToSalesPct - bench.expenseToSalesPct;
      benchDelta = "Corporate " + fmtPct(bench.expenseToSalesPct)
        + " · " + (d > 0 ? "+" : "") + d.toFixed(1) + " pts";
    }
    cards.push(global.DS.kpiCard({
      label: "Budget % of Sales",
      value: fmtPct(sum.expenseToSalesPct),
      delta: sum.expenseToSalesPct === null ? "not defined — no sales in scope" : benchDelta
    }));

    cards.push(global.DS.kpiCard({
      label: "Actual % of Sales",
      value: fmtPct(sum.actualToSalesPct),
      delta: sum.actualToSalesPct === null ? "no actual entered" : "mapped actual ÷ sales"
    }));

    // "Sales per EGP spent" rather than "efficiency" -- same arithmetic,
    // without implying the spend CAUSED the sales.
    cards.push(global.DS.kpiCard({
      label: "Sales per EGP Spent",
      value: sum.salesPerEgpSpent === null ? "—" : sum.salesPerEgpSpent.toFixed(1) + "×",
      delta: sum.salesPerEgpSpent === null ? "needs actual expense"
        : "observational — not a causal claim"
    }));

    cards.push(global.DS.kpiCard({
      label: "Sales Achievement",
      value: fmtPct(sum.salesAchievementPct),
      delta: sum.salesTarget === null ? "no target in scope"
        : "vs " + fmtEGP(sum.salesTarget) + " EGP target",
      direction: sum.salesAchievementPct === null ? "flat"
        : sum.salesAchievementPct >= 100 ? "up" : "down"
    }));

    return '<div class="ds-grid-kpi">' + cards.join("") + '</div>';
  }

  // ---------------------------------------------------------------------
  // Entity table
  // ---------------------------------------------------------------------
  function renderTable(res) {
    var grainMixed = res.entities.some(function (e) { return e.entityType === "product"; })
      && res.entities.some(function (e) { return e.entityType === "brand"; });
    var grainLabel = res.grain === "product" ? "SKU" : (grainMixed ? "Brand / SKU" : "Brand");

    var cols = [];
    cols.push({ key: "__sn", label: "#", align: "right" });
    if (isAllBU(STATE.bu)) cols.push({ key: "__bu", label: "BU" });
    cols.push({ key: "entity", label: grainLabel });
    cols.push({ key: "active", label: "Active", align: "center" });
    cols.push({
      key: "budget", label: "Budget YTD (EGP)", align: "right", isHtml: true,
      format: function (v, row) {
        return '<span title="Full-year plan: ' + fmtFull(row.budgetFullYear)
          + ' EGP">' + fmtFull(v) + '</span>';
      },
      exportFormat: function (v) { return v; }
    });
    // THE EDITABLE COLUMN.
    // A blank input means "not entered", which is not zero. The placeholder
    // says so rather than showing a 0 the reader would take as a measurement.
    // REVISED BUDGET — full-year, and separate from the official figure.
    // Blank means "no revision"; the original stands. It never overwrites the
    // source, so the reconciliation against Finance keeps its meaning.
    cols.push({
      key: "revisedBudgetFullYear", label: "Revised Budget FY (EGP)", align: "right", isHtml: true,
      format: function (v, row) {
        if (!canEdit()) {
          return v === null
            ? '<span style="color:var(--color-text-tertiary);">—</span>'
            : fmtFull(v);
        }
        return '<input class="exp-revised-input" type="text" inputmode="decimal"'
          + ' data-entity="' + esc(row.entity) + '"'
          + ' data-bu="' + esc(row.__bu || STATE.bu) + '"'
          + ' value="' + (v === null ? "" : v) + '"'
          + ' placeholder="' + fmtFull(row.budgetFullYear) + '"'
          + ' title="Official full-year budget: ' + fmtFull(row.budgetFullYear)
          + ' EGP. Leave blank to keep it."'
          + ' aria-label="Revised full-year budget for ' + esc(row.entity) + '">';
      },
      exportFormat: function (v) { return v === null ? "" : v; }
    });
    cols.push({
      key: "actual", label: "Actual (EGP)", align: "right", isHtml: true,
      format: function (v, row) {
        if (!canEdit()) {
          return v === null
            ? '<span style="color:var(--color-text-tertiary);font-style:italic;">not entered</span>'
            : fmtFull(v);
        }
        return '<input class="exp-actual-input" type="text" inputmode="decimal"'
          + ' data-entity="' + esc(row.entity) + '"'
          + ' data-bu="' + esc(row.__bu || STATE.bu) + '"'
          + ' value="' + (v === null ? "" : v) + '"'
          + ' placeholder="not entered"'
          + ' aria-label="Actual expense for ' + esc(row.entity) + '">';
      },
      exportFormat: function (v) { return v === null ? "" : v; }
    });
    cols.push({
      key: "utilizationPct", label: "Utilization %", align: "right", isHtml: true,
      format: function (v) {
        if (v === null) return "—";
        var over = v > 100;
        return '<span style="font-weight:600;color:' + (over ? "var(--color-danger)" : "var(--color-success)")
          + ';">' + fmtPct(v) + '</span>';
      },
      exportFormat: function (v) { return v === null ? "" : v; }
    });
    cols.push({
      key: "sales", label: "Sales YTD (EGP)", align: "right",
      format: function (v) { return v === null ? "—" : fmtFull(v); },
      exportFormat: function (v) { return v === null ? "" : v; }
    });
    cols.push({
      key: "expenseToSalesPct", label: "Budget % of Sales", align: "right", isHtml: true,
      format: function (v, row) {
        if (v === null) return "—";
        return fmtPct(v) + (row.ratioIsPartial
          ? '<span title="Computed on mapped SKUs only (' + fmtFull(row.joinableBudget)
            + ' of ' + fmtFull(row.budget) + ' EGP YTD budget)" '
            + 'style="color:var(--color-warning);font-weight:700;"> †</span>'
          : "");
      },
      exportFormat: function (v) { return v === null ? "" : v; }
    });
    cols.push({
      key: "actualToSalesPct", label: "Actual % of Sales", align: "right",
      format: function (v) { return fmtPct(v); },
      exportFormat: function (v) { return v === null ? "" : v; }
    });
    cols.push({
      key: "salesAchievementPct", label: "Sales Ach.", align: "right",
      format: function (v) { return fmtPct(v); }
    });
    cols.push({
      key: "mappingStatus", label: "Mapping", isHtml: true,
      format: function (v, row) {
        if (row.salesJoinable) return '<span style="color:#15803d;font-weight:600;">Joined</span>';
        return '<span style="color:#b45309;" title="' + esc(v) + '">Not joined</span>';
      },
      exportFormat: function (v, row) { return row.salesJoinable ? "Joined" : v; }
    });

    var rows = res.entities.map(function (e, i) { e.__sn = i + 1; return e; });

    return global.DS.table({
      columns: cols,
      rows: rows,
      compact: true,
      rowClass: function (row) {
        if (!row.salesJoinable) return "exp-unjoined";
        if (row.salesAchievementPct === null) return "";
        if (row.salesAchievementPct >= 100) return "lp-band-good";
        if (row.salesAchievementPct >= 90) return "lp-band-near";
        if (row.salesAchievementPct >= 70) return "lp-band-below";
        return "lp-band-risk";
      }
    });
  }

  // ---------------------------------------------------------------------
  // Actual entry: wiring, export, import
  // ---------------------------------------------------------------------
  function wireActualInputs(container) {
    // Delegated, and bound to "change" rather than "input" -- change fires on
    // blur or Enter, so the table is not rebuilt under the user's cursor on
    // every keystroke.
    container.addEventListener("change", function (e) {
      var el = e.target;
      if (el && el.classList && el.classList.contains("exp-revised-input")) {
        var rraw = String(el.value || "").replace(/[,\s]/g, "");
        var rok = global.ExpenseDashboard.setRevisedBudget(el.dataset.bu, el.dataset.entity,
          rraw === "" ? null : rraw);
        if (!rok) {
          el.classList.add("exp-input-error");
          el.title = "Enter a number of 0 or more, or leave blank to keep the official budget.";
          return;
        }
        el.classList.remove("exp-input-error");
        saveStore();
        render();
        return;
      }
      if (!el || !el.classList || !el.classList.contains("exp-actual-input")) return;
      var raw = String(el.value || "").replace(/[,\s]/g, "");
      var ok = global.ExpenseDashboard.setActual(el.dataset.bu, el.dataset.entity,
        raw === "" ? null : raw);
      if (!ok) {
        // Rejected rather than silently coerced. A negative or non-numeric
        // actual is a mistake, and quietly turning it into something valid
        // would put a wrong number into a financial total.
        el.classList.add("exp-input-error");
        el.title = "Enter a number of 0 or more. Negative values are rejected — "
          + "a credit note belongs in the import file with a reason, not here.";
        return;
      }
      el.classList.remove("exp-input-error");
      saveStore();
      render();
    });
  }

  function exportActuals() {
    var vals = global.ExpenseDashboard.getAllActuals();
    var revs = global.ExpenseDashboard.getAllRevised();
    // Union of both keys -- a row may carry a revised budget with no actual yet,
    // and dropping it would silently lose a deliberate revision.
    var keys = {};
    Object.keys(vals).forEach(function (k) { keys[k] = true; });
    Object.keys(revs).forEach(function (k) { keys[k] = true; });
    var lines = ["BU,Entity,ActualExpense,RevisedBudgetFY"];
    Object.keys(keys).sort().forEach(function (k) {
      var i = k.indexOf("|");
      var bu = k.slice(0, i), ent = k.slice(i + 1);
      lines.push('"' + bu.replace(/"/g, '""') + '","' + ent.replace(/"/g, '""') + '",'
        + (vals[k] === undefined ? "" : vals[k]) + ','
        + (revs[k] === undefined ? "" : revs[k]));
    });
    var blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "zeta_expense_actuals_" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    saveStore(new Date().toISOString());
    render();
  }

  /**
   * EXCEL DOWNLOAD — two sheets, because they answer different questions.
   *
   *   "Expense vs Sales"  the table exactly as displayed, with every derived
   *                       measure as a NUMBER (not a formatted string), so the
   *                       recipient can pivot and re-total it.
   *   "Summary"           the KPI figures plus the basis, period and coverage,
   *                       so a file that leaves this page still says what it
   *                       is measuring. A spreadsheet with no stated basis is
   *                       how two people end up arguing over one number.
   *
   * Uses the SheetJS build the platform already loads, via the same
   * aoa_to_sheet / writeFile pattern as js/exporter.js.
   */
  function exportExcel(res, sum) {
    if (typeof XLSX === "undefined") {
      if (global.DS && global.DS.toast) global.DS.toast("Excel library not loaded.");
      return false;
    }
    var header = ["BU", "Entity", "Grain", "Active", "Budget YTD", "Budget Full Year",
      "Revised Budget FY", "Actual", "Utilization %", "Variance", "Remaining Budget",
      "Projected Full Year", "Sales YTD", "Budget % of Sales", "Actual % of Sales",
      "Sales per EGP Spent", "Sales Achievement %", "Mapping"];
    var body = res.entities.map(function (e) {
      return [
        e.__bu || STATE.bu, e.entity, e.entityType, e.active,
        round2(e.effectiveBudget), round2(e.effectiveBudgetFullYear),
        e.revisedBudgetFullYear, e.actual,
        round2(e.utilizationPct), round2(e.variance), round2(e.remainingBudget),
        round2(e.projectedFullYear), e.sales,
        round2(e.expenseToSalesPct), round2(e.actualToSalesPct),
        round2(e.salesPerEgpSpent), round2(e.salesAchievementPct),
        e.salesJoinable ? "Joined" : "Not joined"
      ];
    });
    var ws = XLSX.utils.aoa_to_sheet([header].concat(body));
    ws["!cols"] = header.map(function (h) { return { wch: Math.max(12, h.length + 3) }; });

    var s2 = XLSX.utils.aoa_to_sheet([
      ["Zeta Commercial Excellence \u2014 Expense vs Sales"],
      [],
      ["Business Unit", isAllBU(STATE.bu) ? "All Business Units" : STATE.bu],
      ["Line", STATE.line],
      ["Active filter", STATE.activeFilter],
      ["Period", "YTD through " + (sum.ytdThrough || "") + " (" + sum.ytdMonths + " months)"],
      ["Target basis", ((global.SEMANTIC && global.SEMANTIC.TARGET_SCENARIOS[currentScenario()]) || {}).label || ""],
      [],
      ["Budget YTD (EGP)", round2(sum.effectiveBudget)],
      ["Budget full-year (EGP)", round2(sum.effectiveBudgetFullYear)],
      ["Actual expense (EGP)", sum.actual],
      ["Budget utilization %", round2(sum.utilizationPct)],
      ["Burn rate vs elapsed", round2(sum.burnIndex)],
      ["Projected full-year (EGP)", round2(sum.projectedFullYear)],
      ["Remaining budget (EGP)", round2(sum.remainingBudget)],
      ["Sales YTD (EGP)", sum.sales],
      ["Budget % of sales", round2(sum.expenseToSalesPct)],
      ["Actual % of sales", round2(sum.actualToSalesPct)],
      ["Sales per EGP spent", round2(sum.salesPerEgpSpent)],
      ["Sales achievement %", round2(sum.salesAchievementPct)],
      [],
      ["Mapping coverage %", round2(sum.coverage.joinablePct)],
      ["Budget not joinable to sales (EGP)", round2(sum.coverage.excludedBudget)],
      [],
      ["Basis", "Budget from the source workbook. Actual expense is user-entered and is not in "
        + "any source file. Sales are Non-Tender, Value basis, from the Sales semantic layer."],
      ["Note", "Relationships are observational. No causal link between spend and sales is implied."],
      ["Generated", new Date().toISOString().slice(0, 16).replace("T", " ")]
    ]);
    s2["!cols"] = [{ wch: 38 }, { wch: 62 }];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Expense vs Sales");
    XLSX.utils.book_append_sheet(wb, s2, "Summary");
    XLSX.writeFile(wb, "zeta_expense_vs_sales_"
      + (isAllBU(STATE.bu) ? "AllBU" : String(STATE.bu).replace(/[^A-Za-z0-9]/g, ""))
      + "_" + new Date().toISOString().slice(0, 10) + ".xlsx");
    return true;
  }
  function round2(v) {
    return (v === null || v === undefined || isNaN(v)) ? null : Math.round(v * 100) / 100;
  }

  function importActuals(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || "");
      var rows = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (!rows.length) return;
      if (/^\s*"?BU"?\s*,/i.test(rows[0])) rows.shift();   // drop the header
      var map = {}, rmap = {}, bad = 0;
      rows.forEach(function (l) {
        // Split on commas outside quotes, so an entity name containing a comma
        // survives the round trip.
        var f = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g);
        if (!f || f.length < 3) { bad++; return; }
        function clean(x) {
          return String(x || "").replace(/,$/, "").trim()
            .replace(/^"(.*)"$/, "$1").replace(/""/g, '"').trim();
        }
        var bu = clean(f[0]), ent = clean(f[1]);
        var av = clean(f[2]), rv = f.length > 3 ? clean(f[3]) : "";
        if (!bu || !ent) { bad++; return; }
        var k = bu + "|" + ent;
        if (av !== "" && isFinite(Number(av))) map[k] = Number(av);
        if (rv !== "" && isFinite(Number(rv))) rmap[k] = Number(rv);
      });
      // Replace, not merge. Merging would let a stale file leave old values
      // behind that the file's author believed they had removed.
      var n = global.ExpenseDashboard.loadActuals(map, true);
      var nr = global.ExpenseDashboard.loadRevised(rmap, true);
      saveStore();
      render();
      if (global.DS && global.DS.toast) {
        global.DS.toast(n + " actual(s) and " + nr + " revised budget(s) imported"
          + (bad ? ", " + bad + " row(s) skipped" : ""));
      }
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------
  // Reconciliation
  // ---------------------------------------------------------------------
  function renderReconciliation() {
    var rec = global.ExpenseDashboard.getBudgetReconciliation();
    if (!rec.ok || !rec.lines.length) return "";

    var rows = rec.lines.map(function (x) { return x; });
    var tbl = global.DS.table({
      columns: [
        { key: "line", label: "Line" },
        { key: "lineSheet", label: "Line budget sheet", align: "right",
          format: function (v) { return fmtFull(v); } },
        { key: "skuSheet", label: "Sum of SKU budgets", align: "right",
          format: function (v) { return fmtFull(v); } },
        { key: "variance", label: "Variance", align: "right",
          format: function (v) { return (v > 0 ? "+" : "") + fmtFull(v); } },
        { key: "decided", label: "Status", isHtml: true,
          format: function (v, row) {
            return v
              ? '<span style="color:#15803d;font-weight:600;">Decided</span>'
              : '<span style="color:#b91c1c;font-weight:700;">OPEN</span>';
          },
          exportFormat: function (v) { return v ? "Decided" : "OPEN"; } },
        { key: "note", label: "Note" }
      ],
      rows: rows,
      compact: true
    });

    var openNote = rec.openCount > 0
      ? '<div class="exp-note exp-note--risk">'
        + '<div class="exp-note-title">' + rec.openCount + ' exception(s) still open</div>'
        + '<div class="exp-note-item">These lines carry two '
        + 'different budget allocations and no authoritative split has been chosen. '
        + '<strong>Line-level budget figures for these lines are not settled</strong>, so treat '
        + 'them as provisional until the business confirms which allocation governs. '
        + 'Brand and SKU figures above are unaffected — they come from the SKU sheet only.</div>'
        + '</div>'
      : "";

    return '<div class="exp-section">'
      + '<div class="exp-section-head' + (rec.openCount > 0 ? ' exp-section-head--caution' : '') + '">'
      + '<h3 class="exp-section-title">Budget Reconciliation</h3>'
      + '<p class="exp-section-sub">Line budget sheet vs sum of SKU budgets. '
      + 'Neither sheet is treated as authoritative and no variance is reallocated. '
      + 'This control total covers all budget and is deliberately unaffected by the '
      + 'filters above.</p></div>'
      + openNote + tbl + '</div>';
  }

  // ---------------------------------------------------------------------
  // Trend chart
  // ---------------------------------------------------------------------
  function drawTrend() {
    var o = { activeFilter: STATE.activeFilter, scenario: currentScenario() };
    var months, series;
    if (isAllBU(STATE.bu)) {
      months = global.ExpenseDashboard.getAvailableMonths();
      series = new Array(months.length).fill(0);
      allowedBUs().forEach(function (b) {
        var t = global.ExpenseDashboard.getExpenseTrend(b, "All", o);
        if (t.ok) t.series.forEach(function (v, i) { series[i] += v; });
      });
    } else {
      var t = global.ExpenseDashboard.getExpenseTrend(STATE.bu, STATE.line, o);
      if (!t.ok) return;
      months = t.months; series = t.series;
    }
    if (!charts() || !months.length) return;
    charts().lineChart("expense-trend-chart", months, [{
      label: "Budgeted expense (EGP)",
      data: series,
      borderColor: "#0F4C81",
      backgroundColor: "rgba(15,76,129,0.12)",
      fill: true,
      tension: 0.3
    }]);
  }

  /**
   * BUDGET vs ACTUAL, by entity.
   *
   * Paired horizontal bars on the top N by budget. Horizontal because entity
   * names are long and would be unreadable rotated; top N because 40 rows of
   * paired bars is a wall, not a chart.
   *
   * Entities with no actual entered are still shown -- their missing bar is
   * itself the finding ("nobody has reported this yet"), and dropping them
   * would make the chart quietly disagree with the table above it.
   */
  function drawBudgetVsActual(entities) {
    var C = charts();
    if (!C || !entities || !entities.length) return;
    var top = entities.slice(0, 12);
    var labels = top.map(function (e) {
      return e.entity.length > 30 ? e.entity.slice(0, 29) + "\u2026" : e.entity;
    });
    C.horizontalBarChart("expense-bva-chart", labels, [
      {
        label: "Budget YTD",
        data: top.map(function (e) { return Math.round(e.effectiveBudget); }),
        backgroundColor: "rgba(15,76,129,0.85)",
        borderColor: "#0F4C81",
        borderWidth: 1
      },
      {
        label: "Actual",
        // null, not 0 -- Chart.js leaves a gap rather than drawing a zero-length
        // bar that would read as "reported, and it was nothing".
        data: top.map(function (e) { return e.actual === null ? null : Math.round(e.actual); }),
        backgroundColor: "rgba(180,83,9,0.85)",
        borderColor: "#B45309",
        borderWidth: 1
      }
    ]);
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  function render() {
    var root = document.getElementById(CONTAINER_ID);
    if (!root) return;

    // Charts.lineChart() UPDATES an existing chart when its canvas id is
    // already in the registry, rather than creating a new one. Every render
    // here replaces the DOM -- so without this the registry would still hold
    // an instance bound to a canvas that is no longer on the page, the update
    // would be applied to that detached canvas, and the chart would silently
    // render nothing after the first filter change. Same call app.js makes
    // when re-entering Coverage, for the same reason.
    if (charts() && charts().destroyAll) charts().destroyAll();

    if (!global.ExpenseDashboard || !global.ExpenseDashboard.isReady()) {
      root.innerHTML = global.DS.emptyState({
        title: "Expense data not loaded",
        hint: "cache/expense_budget.data.js is missing or unreadable. Run etl/build_expense_cache.py."
      });
      return;
    }

    var sum = summaryFor(STATE.bu, STATE.line);
    if (!sum.ok) {
      root.innerHTML = global.DS.emptyState({
        title: "Expense summary unavailable", hint: "Status: " + sum.status
      });
      return;
    }
    var ent = entitiesFor(STATE.bu, STATE.line);
    var meta = global.ExpenseDashboard.getMeta() || {};

    root.innerHTML = "";
    var shell = document.createElement("div");
    shell.className = "exp-root";
    root.appendChild(shell);

    shell.innerHTML = ""
      + '<div class="exp-head"><div>'
      + '<h2 class="exp-title">Expense vs Sales</h2>'
      + '<p class="exp-sub">Year-to-date budget and actual expense against sales performance. '
      + 'Budget comes from the source workbook; <strong>actual expense is entered by you</strong> '
      + 'and is not in any source file. Relationships shown are observational; no causal link '
      + 'between spend and sales is implied.</p>'
      + '</div></div>';

    shell.appendChild(renderFilterBar());

    var body = document.createElement("div");
    body.innerHTML = renderDisclosure(sum)
      + renderKPIs(sum)
      + '<div class="exp-section">'
      + global.DS.chartContainer({
          canvasId: "expense-trend-chart",
          title: "Monthly budgeted expense",
          subtitle: "Budget phasing across " + (meta.months ? meta.months.length : 0) + " months"
        })
      + '</div>'
      + '<div class="exp-section">'
      + '<div class="exp-section-head"><h3 class="exp-section-title">Budget vs Actual</h3>'
      + '<p class="exp-section-sub">Top 12 by budget. A missing Actual bar means nothing has '
      + 'been reported for that entity yet &mdash; not that nothing was spent.</p></div>'
      + global.DS.chartContainer({
          canvasId: "expense-bva-chart",
          title: "Budget vs Actual, YTD",
          subtitle: "Year-to-date through " + esc(sum.ytdThrough || "\u2014")
        })
      + '</div>'
      + '<div class="exp-section">'
      + '<div class="exp-section-head"><h3 class="exp-section-title">'
      + (ent.grain === "product" ? "By SKU" : "By Brand")
      + '</h3><p class="exp-section-sub">'
      + (ent.grain === "product"
          ? "SKU-level reporting."
          : "Business units report at brand level; brand budget is the sum of its SKUs.")
      + ' Rows without a ratified sales mapping show &mdash; rather than zero.</p></div>'
      + '<div class="exp-toolbar">'
      +   '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="exp-export-xlsx">Download Excel</button>'
      +   (canEdit()
            ? '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="exp-export">Export for sharing (CSV)</button>'
              + '<label class="ds-btn ds-btn--ghost ds-btn--sm" style="cursor:pointer;">Import'
              +   '<input type="file" id="exp-import" accept=".csv,text/csv" style="display:none;">'
              + '</label>'
            : '')
      +   '<span class="exp-toolbar-hint">'
      +   (canEdit()
            ? 'Type in the Actual and Revised Budget columns. Values save to this browser as you '
              + 'go &mdash; export and commit the file to make them visible to everyone else.'
            : 'You have <strong>view access</strong>. Actual expense is entered by SFE and BU '
              + 'Managers and becomes visible here once they export and it is committed.')
      +   '</span>'
      + '</div>'
      + renderTable(ent)
      + '</div>'
      + '<div class="exp-meta">'
      + 'Source: ' + esc(meta.source || "expense workbook")
      + ' · cache built ' + esc(meta.builtAt || "—")
      + ' · sales figures from the Sales semantic layer (Non-Tender, Value basis, '
      + esc(((global.SEMANTIC && global.SEMANTIC.TARGET_SCENARIOS[currentScenario()]) || {}).label || "Official Target")
      + ').</div>';
    shell.appendChild(body);

    wireActualInputs(body);
    var ex = body.querySelector("#exp-export");
    if (ex) ex.addEventListener("click", exportActuals);
    var xl = body.querySelector("#exp-export-xlsx");
    if (xl) xl.addEventListener("click", function () { exportExcel(ent, sum); });
    var im = body.querySelector("#exp-import");
    if (im) im.addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) importActuals(e.target.files[0]);
    });

    drawTrend();
    drawBudgetVsActual(ent.entities);
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------
  global.ExpenseVsSales = {
    init: function (containerId) {
      document.body.classList.add("expense-mode");
      CONTAINER_ID = containerId;
      var allowed = global.AUTH && typeof global.AUTH.canViewExpense === "function"
        ? global.AUTH.canViewExpense() : false;
      if (!allowed) {
        var root = document.getElementById(containerId);
        if (root) {
          root.innerHTML = global.DS && typeof global.DS.emptyState === "function"
            ? '<div class="ds-page"><div style="max-width:520px;margin:80px auto;text-align:center;">' +
              global.DS.emptyState({
                icon: "\u{1F512}",
                title: "Access restricted",
                hint: "Expense vs Sales contains budget and expense data and is available to CEO, VP, Commercial Director, BEx, Admin, SFE Manager and BU Manager roles only."
              }) + '</div></div>'
            : "<p>Access restricted.</p>";
        }
        return;
      }
      if (!global.ExpenseDashboard || !global.ExpenseDashboard.isReady()) {
        render();
        return;
      }
      // Seed the BU from the user's own scope every time the page is entered,
      // never once at script load — a freshly signed-in user must not inherit
      // a BU left over from a previous session's module state.
      var bus = allowedBUs();
      if (!STATE.bu || (!isAllBU(STATE.bu) && bus.indexOf(STATE.bu) < 0)) {
        STATE.bu = canSelectAllBUs() ? ALL_BU : (bus[0] || null);
        STATE.line = "All";
      }
      if (global.AUTH && typeof global.AUTH.getActiveScenario === "function") {
        STATE.scenario = global.AUTH.getActiveScenario();
      }
      loadStore();
      render();
    },
    destroy: function () {
      document.body.classList.remove("expense-mode");
      // destroyAll() both destroys AND clears the registry. Destroying by id
      // alone would leave the entry in place, and the next visit would try to
      // update a destroyed chart.
      if (charts() && charts().destroyAll) charts().destroyAll();
      var root = CONTAINER_ID ? document.getElementById(CONTAINER_ID) : null;
      if (root) root.innerHTML = "";
    }
  };
})(window);
