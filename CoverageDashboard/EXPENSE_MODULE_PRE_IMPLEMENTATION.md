# Expense vs Sales — best practice before implementation

I inspected the data before advising. Nothing has been changed, staged, or
committed. Four findings decide the shape of this build, and three of them are
yours to settle rather than mine.

---

## 1. The join is the whole feature, and it is currently 40%

Every KPI you asked for — Expense-to-Sales, Expense Efficiency, the 2×2
matrix, the drivers — depends on matching an expense row to a sales row.

Measured against `cache/sales.data.js`:

| | Exact | Case-insensitive |
|---|---|---|
| Brands | 8 / 53 | **24 / 53** |
| Products | 49 / 117 | **50 / 117** |
| **SKUs that actually carry budget** | | **30 / 75 (40%)** |

**45 of the 75 budgeted SKUs cannot be matched to any sales record.** The
causes are not the same, and telling them apart matters:

**Naming drift** — the SKU exists in sales under a different spelling:
```
expense:  COXORIZET 60 MG 20 TAB
sales:    COXORIZET 60MG 20 TAB          (no space before MG)
expense:  NEXICURE 20 MG 14 SACH
sales:    NEXICURE 20 MG 14 SACHETS
expense:  DOSOVA NEXIDIGEST 30 T
sales:    DOSOVA NEXIDIGEST 30 TAB
```

**Genuinely absent from sales** — no record under any spelling:
```
B-COMPLEX          DEZOVA GASTROCOL     ALZAZONEX
DOZOVA BRAIN BOOST (all variants)       DOSOVA NEXIDIGEST
```

That second group is the dangerous one. If a SKU has budget but no sales, is
that a **new launch not yet selling** (a real and important finding — money
going out with nothing coming back) or a **broken join** (a reporting bug)?
The dashboard cannot tell the difference, and it must not guess.

> **Best practice: build the mapping as reviewable data, not as fuzzy matching
> in code.** A `Dim_Expense_SKU_Map` — expense SKU → sales product, with an
> explicit status of `matched` / `not-yet-selling` / `unmapped` — that a human
> signs off once and the ETL then applies deterministically. Fuzzy matching at
> runtime would silently map "COXORIZET 60 MG" to the wrong pack size the day
> someone adds a 60MG 30 TAB, and nobody would notice.

Everything unmapped must be **visible and excluded**, never quietly folded
into a total.

---

## 2. Your two budget sheets disagree

`Expenses per line monthly` and `Expenses per SKU's Monthly` do not reconcile
for 7 of 16 lines:

| Line | Line sheet | Sum of SKUs | Difference |
|---|---:|---:|---:|
| CHC | 24,600,000 | 29,600,000 | **−5,000,000** |
| DIAB-IV | 22,089,720 | 17,500,000 | **+4,589,720** |
| DIAB-III | 21,376,218 | 24,000,000 | **−2,623,782** |
| DIAB-II | 20,344,342 | 21,500,000 | **−1,155,658** |
| DIAB-I | 13,689,720 | 14,500,000 | **−810,280** |
| GIT-I | 22,000,000 | 21,700,000 | +300,000 |
| GIT-II | 22,000,000 | 22,300,000 | −300,000 |

Also: a line called **Zetagarouh** holds 5,000,000 in the line sheet with no
SKUs at all — the same magnitude as the CHC gap, which suggests those SKUs may
be tagged CHC in the SKU sheet.

**This is a decision for you, not a bug for me to fix.** Which sheet is
authoritative? Best practice is to pick one as the source of truth, and have
the ETL **report** the variance rather than reconcile it silently. A dashboard
that quietly picks a number when its two sources disagree teaches people to
distrust every number on it.

---

## 3. There is no actual-expense field anywhere, and no way to store one

The workbook has `SKU Forecast` and twelve monthly budget columns. There is no
actual-expense column, no expense category, and no transaction identifier.

And the platform is a **static site with no backend**. Whatever a user types
cannot persist for anyone else.

I'd recommend against `localStorage`, despite it being the fastest path. On a
finance number it is genuinely dangerous: the CEO and the SFE Manager would see
different "actuals" for the same month, each believing they were looking at
company data, with nothing on screen to indicate otherwise. Clearing browser
data silently destroys a month of entries.

**Best practice given the constraint — an import/export cycle:**

```
Dashboard → download a pre-filled template (month, BU, entity, budget)
     ↓  the owner fills in Actual Expense in Excel
Dashboard → upload it back  →  validated  →  parsed  →  rendered
     ↓  refresh.bat commits it as cache/expense_actuals.data.js
Everyone sees the same numbers, and git carries the audit trail
```

This matches how every other number in the platform already works, has version
history for free, and needs no backend. The cost is that entry is a deliberate
act rather than an inline edit — which for finance data is a feature.

If you want true in-app entry by multiple users, that requires a backend, and
you told me not to introduce one without authorisation. **Which of these you
want is decision #1.**

---

## 4. Dimensions don't line up yet

| | Expense workbook | Platform |
|---|---|---|
| BU | `CLUSTER` | `Cluster` |
| Line | `NEUROSCIENCE` | `CNS` |
| Line | `Gyna` | *not in `CANONICAL_LINE_TO_BU`* |
| Line | *absent* | `CHC_SALES`, `Non-Promoted` |

Best practice: normalise in the **ETL**, against the existing
`CANONICAL_LINE_TO_BU`, and fail loudly on anything unmapped. Do not add a
second BU or Line dimension — you already have an authoritative one, and two
would drift apart within a month.

`Gyna` needs a decision: which BU does it belong to?

---

## 5. On the grain rule

Your rule is Brand for non-CHC, SKU for CHC. The data supports it —
**budget is captured at SKU level for every BU**, so brand budget is simply the
sum of its SKUs. No new collection needed.

Best practice for implementing it: put the rule in **one function** in the
semantic layer —

```js
SEMANTIC.expenseGrainFor(bu)   // "product" for CHC, "brand" otherwise
```

— and have the dashboard, the Ask adapter, the drivers and the Explore chips
all call it. The moment that rule is expressed twice, the Ask answer and the
table beside it will disagree, and the reader will have no way to tell which
is right.

One caveat worth stating on screen: **42 of 126 SKUs carry no budget at all.**
A brand total that silently omits them will not match the line sheet.

---

## 6. What I'd recommend building, in this order

**Phase A — trustworthy data, no UI.** ETL + mapping table + reconciliation
report. Deliverable: a signed-off `Dim_Expense_SKU_Map` and a variance report
between the two budget sheets. **Nothing else is safe to build until the join
is above ~95% or the gaps are explicitly classified.**

**Phase B — budget-only analysis.** Budget vs Sales, Budget Expense-to-Sales,
budget efficiency, the trend, the 2×2. This is genuinely useful on its own and
carries no persistence risk, because budget is official read-only data.

**Phase C — actual expense.** Import/export cycle, validation, variance,
drivers, the diagnostic story.

**Phase D — Ask the Data + Explore.** Once the numbers are settled.

Phases B and C each stand alone. Building C before A produces a module whose
numbers are wrong for 60% of budgeted SKUs and — worse — wrong quietly.

---

## 7. Two things in your spec I'd push back on

**"Expense Efficiency = Sales / Expense"** is arithmetically fine but reads as
a productivity ratio, which invites exactly the causal reading you asked me to
avoid — a high number sounds like spending *produced* sales. **Expense-to-Sales
%** already carries the same information, is the standard commercial measure,
and is causally neutral. I'd lead with it and make efficiency secondary.

**The 2×2 matrix quadrant labels.** "Low Sales / High Expense" is factual, but
placement is not: a brand at 89% achievement sitting in "LOW SALES" is a
judgement encoded as a threshold. Best practice is to **state the thresholds on
the chart** and make them the same 100/90/70 bands already used in Line
Performance, so the platform says one thing about what "on target" means.

---

## 8. Regression risk

The spec touches Sales, Ask, filters, auth and navigation. Three notes:

- **Sales must stay read-only.** Every sales figure should come from the
  existing semantic functions — the same discipline that keeps the Ask
  adapter's numbers identical to the cards above it.
- **Auth is the risk area.** The existing Ask engine restricts by building the
  user's vocabulary through their scope. Expense entities must go through the
  same path, or a Line Manager will see another BU's spending.
- The repo has moved on since I last worked in it — there are now coverage,
  executive and sfe Ask adapters I have not reviewed, plus a storytelling
  engine and correlation diagnostics. I'd read those before touching
  `ask-engine.js`, and I'd run your golden tests **first**, to establish they
  pass before I start rather than discovering it afterwards.

---

## Decisions I need from you

1. **Persistence** — import/export cycle (my recommendation), `localStorage`
   prototype, or authorise a backend?
2. **Authoritative budget** — line sheet or SKU sheet? And what should the
   dashboard do when they disagree?
3. **Unmapped SKUs** — will someone sign off a mapping table, or should
   unmatched SKUs be shown as a named exclusion?
4. **`Gyna` and `Zetagarouh`** — which BU, and is Zetagarouh's 5M real?
5. **Scope for this phase** — all four phases, or A+B first?

I have not written any implementation code. Say which way on these five and
I'll start with Phase A.
