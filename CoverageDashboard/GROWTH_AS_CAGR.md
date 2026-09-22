# Growth is now CAGR, everywhere on Market Intelligence

Ahmed's instruction, 2026-08-06. Every growth figure on the Total Market
Intelligence page is a compound annual growth rate.

---

## This was a change of window, not a relabelling

The page used to compare the latest year against the one before it. It now
compares the **first and last full years in scope** and annualises. With
the default scope that is **2022 → 2025, three years**.

| | Before | Now |
|---|---|---|
| Zeta | +98.6% (2024→2025) | **+77.6% a year** (2022→2025) |
| Market | +34.4% (2024→2025) | **+34.9% a year** (2022→2025) |
| Zeta vs market | +64.1 pts | **+42.8 pts a year** |

Both are true. The second is the one that survives a business review: a
single year-on-year step is easily a restock, a tender, or a shipment
landing either side of a year end. Over three years those wash out and what
is left is trajectory.

---

## What changed

**One window, used by everything.** `growthWindow()` returns the first and
last full years in scope; `cagrPct()` computes the rate. Every consumer
reads from these two, so no two numbers on the page can disagree about what
period they describe.

**`rankedRows()` now accumulates three buckets** in one pass: `cur` (the
latest year in scope — what the value, units, share and price columns
report), `base` and `end` (the window endpoints). They are the same year in
the normal case and diverge only when the partial year is pulled into
scope. Keeping them separate is what stops a four-month endpoint from
becoming the terminal value of a compound rate.

New row fields: `baseValue`, `endValue`, `deltaValue`, `totalGrowthPct`
(un-annualised, across the whole window). `prevValue` still exists as an
alias of `baseValue` — it means "the comparison point", which is now the
start of the window.

**Every consumer moved with it** — KPI cards, ranked tables, the Growth
Analysis bridge and mover lists, the Zeta position panel, the insights
engine, drill-through, CSV export, and Ask the Data.

---

## Three decisions worth knowing

**Partial years never enter a compound rate.** 2026 is January–April. As a
CAGR endpoint it would drag every rate down by roughly two thirds, and the
error would be invisible in the output. It still appears in the value
columns; it is simply excluded from the window.

**Fewer than two full years produces "—", not a fallback.** Filter to a
single year and growth reads `needs 2 full years`, insights explain why,
and Ask the Data answers *"Needs at least two full years in scope to
compute a CAGR"*. Quietly falling back to a year-on-year step wearing a
CAGR label would be worse than showing nothing.

**A zero base produces `null`, not `Infinity`.** 580 of 1,294 corporations
have no 2022 value. They sort last in a CAGR ranking, because a compound
rate from zero is undefined rather than infinite.

---

## The bug this surfaced

Widening the window to include base-year data changed which rows exist:
companies that traded in 2022 but have since left the market now appear.
The corporation count moved **1,135 → 1,294**, and every "ranks #39 of N"
sentence silently inflated with it.

Those rows belong in the growth bridge — a competitor that shut down is a
real negative contribution, and dropping it would leave the bridge unable
to reconcile to its own endpoints. They do **not** belong in "of N
corporations", which means *of the companies competing today*.

So `rankedRows` now returns both: `rows` (everything, for growth) and
`activeCount` (trading in the current year, for rank denominators). Rank
statements read **#39 of 1,135** again, and Ask the Data agrees with the
page.

---

## Where the number is stated on the page

- Page header — `2025 · growth as CAGR 2022–2025`
- Every table column header — `CAGR 2022–2025`, with the full basis on hover
- Trend note — points out that the rightmost bar of the CAGR chart is the
  same number driving the KPI cards, the tables and the insights
- Top Performers and Corporation Analysis notes — explain why compound
  rather than year-on-year
- Ask the Data — the CAGR formula written out, the window named, and the
  year-on-year step retained as *context only*

---

## An observation the change made visible

Market **value** compounds at **+34.9% a year**. Market **units** compound
at **−0.2% a year**.

The Egyptian pharmaceutical market has grown almost entirely on price and
mix over 2022–2025, with volume essentially flat. That was hard to see in
single-year steps and is unmissable across the window. Worth a look before
any volume-based target setting.

---

## Testing

`test_cagr.js` — 55 checks. Every expectation is recomputed from the raw
cube in the test file rather than from the module's helpers, so an engine
that is wrong the same way twice cannot pass. Covers the window, the
arithmetic against hand-computed CAGRs at several ranks, null handling,
sort behaviour, the `activeCount` split, insight wording, Ask the Data,
single-year degradation, partial-year exclusion, and a full page render
with no `undefined` / `NaN` / `Infinity` leaking into the HTML.

`test_ask.js` — 75 checks, updated for the new basis.

Cache-buster: `?v=20260806_cagr`.
