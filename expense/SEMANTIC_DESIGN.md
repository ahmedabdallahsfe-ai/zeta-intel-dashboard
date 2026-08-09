# Expense semantic layer — design

Deliverable G of Phase A. **Design only — no code has been written or wired.**
Implementation is a Phase B action requiring your approval, because it means
adding to `js/semantic-model.js`.

---

## Target architecture — confirmed by Ahmed, 2026-08-09

**Expense vs Sales is a new page inside the existing Zeta Intelligence
Dashboard. It is not a standalone application and not a separate dashboard.**

```
Zeta Intelligence Dashboard
  ├── Executive
  ├── Sales
  ├── Coverage
  ├── SFE
  └── Expense vs Sales      ← new integrated page
```

It reuses, rather than reimplements, every one of:

| | |
|---|---|
| Shell & navigation | the existing sidebar, tab routing and teardown in `js/app.js` |
| Authentication | `AUTH` — no second authorization system |
| Filters | the existing BU / Line / Month filter architecture |
| Semantic layer | `SalesDashboard` for every sales figure |
| UX patterns | the existing CSS, `DS.table`, KPI card and modal conventions |
| Ask the Data | the existing engine and adapter contract, later |
| Explore | `window.DashboardNavigation`, later |

Required capability on that page, for the record:

- Non-CHC → Brand-driven; CHC → Product/SKU-driven, via `expenseGrainFor(bu)`
- Monthly Budget vs Actual Expense vs Sales
- Expense-to-Sales %, budget-vs-actual variance
- Monthly trends
- Top Brands / SKUs
- Expense and variance drivers
- Existing BU/Line filters and authorization throughout
- Ask the Data and Explore integration in a later phase

**The "MATCHED SKUs only" MVP I proposed is withdrawn.** Ahmed's decision: for
a management-facing financial page the data foundation is resolved first, so
the page presents complete numbers rather than a disclosed subset. No partial
build proceeds without explicit approval.

---

## The grain rule, expressed once

```js
// js/semantic-model.js
function expenseGrainFor(bu) {
  return normalizeBU(bu) === "CHC" ? "product" : "brand";
}
```

Everything downstream asks this function rather than deciding for itself: the
dashboard tables, the Ask adapter, the driver calculation, the rankings, the
Explore chips.

That single-source discipline is not tidiness. The moment the rule is expressed
in two places, an Ask answer will show SKU drivers while the table beside it
shows brands, and the reader has no way to tell which is right. The same
reasoning is why the Ask engine already computes every figure from the sales
semantic layer instead of re-deriving it.

**Physical grain stays SKU for every BU.** The source budget is SKU-level
throughout, so brand figures are *derived by aggregation*, never collected
separately. Storing brand totals as their own facts would create a second
number that could disagree with the sum of its parts.

---

## Proposed surface

Mirrors the existing `SalesDashboard` conventions — `ok` / `status` result
envelopes, scenario-aware, auth-filtered at source.

```js
ExpenseDashboard = {
  getExpenseSummary(bu, line, months, grain)      // KPI cards
  getEntityExpense(bu, line, months)              // grain-aware table rows
  getExpenseTrend(bu, line, grain)                // monthly series
  getExpenseVarianceDrivers(bu, line, months)     // overspend contribution
  getBudgetReconciliation()                       // the control report
  getExpenseCoverage()                            // mapping coverage, for disclosure
  getAvailableExpenseMonths()
}
```

### Every row carries its mapping status

```js
{ entity, entityType, budget, actual, variance, variancePct,
  sales, salesTarget, salesAchievementPct,
  expenseToSalesPct, expenseEfficiency,
  mappingStatus, salesJoinable }
```

`salesJoinable` is not decoration. `expenseToSalesPct` must be `null` — not
zero — when the entity has no joinable sales, and the renderer must show `—`.
A zero would be read as "we spend nothing relative to sales", the exact
opposite of the truth.

---

## Sales comes from the existing layer, untouched

Every sales figure is fetched from `SalesDashboard.getBrandAchievement()`,
`getItemAchievement()` and `getSalesAchievementSummary()`. No sales arithmetic
is reimplemented here.

Those functions already encode Non-Tender only, Value basis, the CHC /
CHC_SALES rollup exception, the Official vs Working scenario and the June
target authority. Re-deriving any of it would produce an expense page that
disagrees with the Sales page, and the reader could not tell which was wrong.

---

## The Active flag — how it must be treated

Added 2026-08-09 at Ahmed's request. It turned out to be the single most
important cut in the dataset.

Read across all budgeted SKUs, mapping coverage is **72.2%** and looks alarming.
Split by the source sheet's `Active` column:

| | SKUs | Budget EGP | Usable coverage |
|---|---:|---:|---:|
| Active = Yes | 40 | 207,990,000 | **92.7%** |
| Active = No | 36 | 59,110,000 | — (34 unmapped) |

**Measured: 0 of the 36 inactive budgeted SKUs have any recorded sales.** That
is a clean separation, so the flag tracks something real. Judging the data on
the blended 72.2% would understate a dataset that is largely sound.

### The Active filter — specification

**Ahmed's instruction, 2026-08-09:** *"product active no still not yet have sales
so will not be included in analysis — make filter of active to filter yes or no."*

So the exclusion becomes a **visible, user-controlled filter** rather than a
hard-coded rule. That is the better design: a hard exclusion makes 59,110,000 EGP
invisible, and money nobody can see is money nobody asks about. A filter with a
declared default makes it discoverable while keeping the analysis clean.

The control ships with the Expense vs Sales page in Phase B. The arithmetic
behind it already exists and is checkable now, in
`expense/reports/active_split.csv`.

```js
// three options, not a checkbox
activeFilter: "active" | "inactive" | "all"     // default "active"
```

**Rule 1 — the default must be visible, never hidden.**
The page opens on Active only. The control shows that, and the KPI header reads
"Active SKUs". A silent pre-filter is how a reader comes to believe a partial
total is the company total.

**Rule 2 — ratio KPIs go UNDEFINED, not zero, when non-active SKUs are in scope.**
Measured: 0 of 36 inactive budgeted SKUs have any recorded sales. So
Expense-to-Sales on that population divides by zero. It must render `—`.
Rendering `0%` would say "we spend nothing relative to sales" — the precise
opposite of the truth. Under `inactive`, the page shows budget and
reconciliation views only; efficiency and 2×2 quadrants are suppressed with a
stated reason, not blanked.

**Rule 3 — the filter NEVER changes reconciliation.**
Reconciliation is a control total against Finance's line budget. It always
covers all budget at all times, whatever the filter says. If the filter could
move it, "total budget" would mean different things on different screens and the
first person to notice would stop trusting the page.

**Rule 4 — every exclusion is disclosed on the same screen.**
Whenever the filter removes money, the amount removed is shown next to the
total: *"207,990,000 of 267,100,000 — 59,110,000 excluded on 36 SKUs marked not
active."* Not in a tooltip.

**Rule 5 — tri-state, because blank is not No.**
`Yes` / `No` / blank are three claims. An unset flag has not been answered;
collapsing it into `No` invents a business statement nobody made. `active_split.csv`
reports blank as its own row. Currently there are none — the rule exists so that
the day one appears, it surfaces instead of quietly joining the excluded pile.

**Rule 6 — it is a data filter, never an auth filter.**
It composes *after* `AUTH.filterAllowedBUs()` and can only narrow, never widen.
Selecting `all` shows all Active states within the user's scope — never another
BU's spend.

**Rule 7 — Active travels with the actuals.**
The flag is a column in the import template and survives source → template →
import → cache. If it were re-derived at import time there would be two sources
of truth for the same fact, and they would disagree the first time the workbook
changed.

### What a review owns — and what it does not

Found as a live bug on 2026-08-09, worth recording because it is the same class
of error the mapping table exists to prevent.

The workbook changed `EPILOSAMIDE 5 MG/1 ML SYRUP` from `Active = Yes` to
`Active = No`. That row had been human-reviewed, so the ETL preserved it whole —
including the stale `Active = Yes`. The summary read the source, the mapping CSV
read the review, and the two disagreed by 200,000 EGP with nothing on screen to
indicate it.

**A review owns the mapping — which sales product this SKU joins to. It does not
own the source facts around it.** Budget, Active, BU, Line and Brand belong to
the workbook and are re-read on every run. Only `MappingStatus`,
`ProposedSalesProduct`, `Reviewed`, `ReviewedBy` and the notes are preserved.

Budget was already being refreshed for exactly this reason. Active was not. The
principle now applies to every source-owned field.

### What the flag means is undefined, and stays undefined

The source workbook carries **no definition**: no cell comment, no data
validation list, no legend sheet, no defined name, no document description. It
is a bare Yes/No column.

**Ahmed's instruction, 2026-08-09: do not label `Active = No` as pre-launch,
discontinued, or any other business status unless the source explicitly defines
it.** The semantic layer, the reports and any future UI report the measurement
and stop there.

This is not pedantry. "22% of budget on discontinued products" and "22% of
budget on products launching this year" are opposite findings that would
trigger opposite actions, and the data supports neither.

Rules for the semantic layer:

- **`activeFilter` defaults to `"active"`** for every expense-vs-sales calculation —
  KPI cards, rankings, drivers, correlation, efficiency. Inactive SKUs have no
  sales by definition, so including them would drag every efficiency ratio
  toward zero for a reason that has nothing to do with performance.
- **Inactive budget is never dropped from reconciliation.** It remains in the
  control totals so budget is never silently lost, and it is separately
  reportable — 59,110,000 EGP on SKUs marked not active is a finding in its
  own right.
- **The flag is tri-state**, not boolean: `Yes` / `No` / unset. An unset flag is
  not the same claim as an explicit `No`, and collapsing them would invent a
  business statement nobody made.
- **Row-level disclosure**: every entity row carries `active`, so a table can
  show why a SKU has budget and no sales.

---

## Two disclosures the layer must force

**Coverage.** `getExpenseSummary()` returns `coverage: { budgetTotal,
budgetJoinable, joinablePct }` and every consumer must render it. At today's
**92.7% of active budget** — but **72.2% of all budget** — a headline
expense-to-sales figure is describing the active population only. Showing it
without that context would be misleading even though every individual number is
correct.

**Reconciliation.** The SKU sheet is authoritative for analysis, but
`getBudgetReconciliation()` exposes the line-sheet variance so the control
figure is reachable from inside the product. A dashboard whose totals disagree
with Finance's line budget, without saying so, will be argued with once and
then ignored.

---

## Driver contribution

```
excess(e)       = max(actual(e) - budget(e), 0)
contribution(e) = excess(e) / Σ excess × 100
```

Only overspending entities contribute. Underspend contributes zero, never a
negative — otherwise a single large underspend could make an overspender's
contribution exceed 100%, or flip its sign.

Contributions reconcile to 100.0% within floating-point tolerance, and the
entity set is `expenseGrainFor(bu)`: brands for non-CHC, SKUs for CHC.

---

## Authorization

Expense entities pass through the **same** path the Ask engine already uses:
the vocabulary is built through the user's scope, so an out-of-scope brand or
SKU cannot be named, ranked, totalled or reached by an Explore chip.

No second authorization system. `AUTH.isLineAllowed()` and
`AUTH.filterAllowedBUs()` remain the only gatekeepers.

---

## Loading

`cache/expense_actuals.data.js` and `cache/expense_budget.data.js` are small —
a few hundred KB against the 12.8 MB sales cube — but they are needed by one
page. They should follow whatever on-demand pattern the platform settles on
rather than being added to the boot path.

---

## What Phase B would touch

| File | Change |
|---|---|
| `js/semantic-model.js` | **+** `expenseGrainFor()`, `normalizeExpenseBU()` — additive only |
| `js/expense-interface.js` | **new** — the semantic layer above |
| `etl/build_expense_cache.py` | **new** — budget + actuals → caches |

No modification to Sales, Coverage, SFE, Executive, AUTH, Ask routing or
existing caches. Adding to `semantic-model.js` is the only change to an
existing file, and I would confirm it with you before making it.
