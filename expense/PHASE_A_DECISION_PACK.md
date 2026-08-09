# Phase A — Decision Pack

**2026-08-09 (rev. 3)** · Zeta Commercial Excellence Platform · Expense vs Sales foundation
**Gate: NO-GO for Phase B** · No UI built · Nothing committed, pushed or deployed

---

## Status of this revision

| | |
|---|---|
| `ZETAKARDOVAL HCT 10/160/12.5 MG 30 TAB` | ✅ Confirmed by name → **MATCHED, Reviewed = YES** |
| `DOZOVA NAD 300 MG 30 CAP` | ⏸ Remains **PROPOSED** — not authorised to map |
| `DOZOVA Q10 COENZYME 200 MG 30 CAP` | ⏸ Remains **PROPOSED** — not authorised to map |
| DIAB-I…IV reconciliation | ⛔ Documented and **unresolved** — no allocation chosen |
| Active filter (Yes / No / All) | ✅ Specified + data built — control ships with the page |
| Source workbook | ⚠ Changed at 14:00 today — one SKU moved to `Active = No` |
| **Ratified coverage** | **92.7%** |
| **95% gate** | **NOT passed** |
| Phase B | **NO-GO** |

The naming discrepancy in the previous round is resolved. Recording it for the
audit trail: the third mapping was described as an EMPACOZA TRIO, was held
rather than inferred, and turned out to be a different brand in a different BU.
The hold cost one round trip.

---

## 1. Final ratified mappings — 10 SKUs, 53,500,000 EGP

Signed off by you. Preserved across every future ETL run; the build cannot
overwrite them.

| # | Expense SKU | Sales product | Status | Budget EGP |
|---|---|---|---|---:|
| 1 | COXORIZET 60 MG 20 TAB | COXORIZET 60MG 20 TAB | MATCHED | 6,000,000 |
| 2 | EMPACOZA 25 MG 30 TAB | EMPACOZA 25MG 30 TAB | MATCHED | 6,000,000 |
| 3 | NEXICURE PLUS 40/1100 MG 14 CAP | NEXICURE PLUS 40 /1100 MG 14 CAP | MATCHED | 5,500,000 |
| 4 | EMPACOZA TRIO 25/5/1000 MG 30 TAB | EMPACOZA TRIO 25/5/1000 30 TAB | MATCHED | 12,000,000 |
| 5 | EMPACOZA TRIO 10/5/1000 MG 30 TAB | EMPACOZA TRIO 10/5/1000 30 TAB | MATCHED | 10,000,000 |
| 6 | **ZETAKARDOVAL HCT 10/160/12.5 MG 30 TAB** | **ZETAKARDOVAL HCT 10/160/12.5 30 TAB** | **MATCHED** | **5,000,000** |
| 7 | NEXICURE PLUS 40/1680 MG 14 SACHETS | — | UNMAPPED (confirmed) | 4,500,000 |
| 8 | EPILOSAMIDE 5 MG/1 ML SYRUP | — | UNMAPPED (confirmed) | 200,000 |
| 9 | NEXIROZOVA 5 MG 28 TAB | — | NOT_YET_SELLING | 2,500,000 |
| 10 | ZETAZOLEX 0.25 MG 30 TAB | — | NOT_YET_SELLING | 1,800,000 |

Bold = ratified in this round. Items 7–10 are ratified *decisions not to map*.
"A person looked and said no" is recorded as firmly as an approval, so the ETL
stops re-proposing them every run.

---

## 2. Remaining proposed mappings — 2 SKUs, 6,440,000 EGP

Held as `Reviewed = PROPOSED`. **Not authorised to map.** Excluded from ratified
coverage.

| Expense SKU | Proposed status | Budget EGP | Sales candidate | Why not authorised |
|---|---|---:|---|---|
| DOZOVA NAD 300 MG 30 CAP | UNMAPPED | 4,200,000 | `DOZOVA NAD 30 CAP` (6,032,587)<br>`DOZOVA NAD 60 CAP` (8,822,841) | Neither sales name states a strength. The 300 MG cannot be verified. |
| DOZOVA Q10 COENZYME 200 MG 30 CAP | UNMAPPED | 2,240,000 | `DOZOVA Q10 COENZYME 30 CAP` (14,868,071) | No strength stated. The 200 MG cannot be verified. |

**These are open questions, not pending coverage.** Both are currently proposed
as *not joinable* — so ratifying the proposals as they stand would not move
coverage by a single point. What moves coverage is the product master
confirming the strengths, which would convert them to MATCHED.

**Owner: product / regulatory. Question:** does `DOZOVA NAD` exist in any
strength other than 300 MG, and `DOZOVA Q10 COENZYME` in any strength other than
200 MG? If each exists in only one strength, both become MATCHED.

---

## 2b. The Active filter

**Your instruction:** *Active = No products still have no sales, so they will not
be included in analysis — make a filter of Active to filter Yes or No.*

Implemented as a **three-option filter, defaulting to Active only** — rather than
a hard-coded exclusion. Reasoning: a hard exclusion makes 59,110,000 EGP
invisible, and money nobody can see is money nobody asks about. A declared
default keeps the analysis clean and the excluded budget discoverable.

| Filter | SKUs | Budget EGP | Joinable to sales | Coverage |
|---|---:|---:|---:|---:|
| **Active = Yes** (default) | 40 | 207,990,000 | 192,750,000 | **92.7%** |
| Active = No | 36 | 59,110,000 | 0 | 0.0% |
| All | 76 | 267,100,000 | 192,750,000 | 72.2% |

Seven rules govern it. Four are worth your attention:

1. **The default is visible, never hidden.** The page opens on Active only, the
   control says so, and the KPI header reads "Active SKUs". A silent pre-filter
   is how a reader comes to believe a partial total is the company total.
2. **Ratio KPIs go undefined — not zero — when inactive SKUs are in scope.**
   0 of 36 have sales, so Expense-to-Sales divides by zero. It renders `—`.
   Showing `0%` would say "we spend nothing relative to sales", the opposite of
   the truth. Under Active = No the page shows budget and reconciliation only.
3. **The filter never changes reconciliation.** That is a control total against
   Finance's line budget and always covers all 267,100,000. If a filter could
   move it, "total budget" would mean different things on different screens.
4. **Tri-state, because blank is not No.** There are no blanks today. The rule
   exists so the day one appears it surfaces, instead of quietly joining the
   excluded pile.

Full specification in `expense/SEMANTIC_DESIGN.md`. The arithmetic is already
built and checkable in `expense/reports/active_split.csv` — 33 rows, budget by
Active × BU × Line × mapping status. When the control ships, every number it can
display is reproducible from that file.

**Deferred to Phase B:** the control itself, since no Expense vs Sales page
exists yet and UI remains unauthorised.

---

## 2c. Two findings from today's rebuild

**The source workbook changed at 14:00 today.**
`EPILOSAMIDE 5 MG/1 ML SYRUP` moved from `Active = Yes` to `Active = No`
(200,000 EGP). If that was not you, it is worth knowing who edited it. All
figures in this revision reflect the current file.

**That change exposed a bug in my preservation logic — now fixed.**
The row had been human-reviewed, so the ETL preserved it whole *including the
stale `Active = Yes`*. The summary read the source, the mapping table read the
review, and they disagreed by 200,000 EGP with nothing on screen to show it.

The principle it violated: **a review owns the mapping — which sales product a
SKU joins to. It does not own the source facts around it.** Budget, Active, BU,
Line and Brand belong to the workbook and are now re-read on every run. Only the
mapping decision and its audit fields are preserved.

Budget was already being refreshed for exactly this reason; Active was not. Same
argument, so it now applies to every source-owned field.

---

## 3. Remaining unmapped / not-yet-selling — ACTIVE population

| Status | SKUs | Budget EGP | % of active | Awaiting |
|---|---:|---:|---:|---|
| UNMAPPED — ratified | 1 | 4,500,000 | 2.2% | Nobody. Decided. |
| UNMAPPED — proposed | 2 | 6,440,000 | 3.1% | Product master |
| NOT_YET_SELLING — ratified | 2 | 4,300,000 | 2.1% | Nobody. Decided. |
| **Total not joinable** | **5** | **15,240,000** | **7.3%** | |

`EPILOSAMIDE 5 MG/1 ML SYRUP` (200,000 EGP) is no longer in this table — the
workbook moved it to `Active = No` today. Its ratified UNMAPPED decision stands
and travels with it.

No reason has been inferred for any of these. `NOT_YET_SELLING` states only that
no sales record exists for that strength and pack — not why.

**Separately: `Active = No`** — 36 SKUs, **59,110,000 EGP** (22% of total budget).
Excluded from KPIs by your rule, retained in full in reconciliation, no status
label applied. The source workbook still carries no definition of this flag.

---

## 4. Ratified vs provisional coverage

```
ACTIVE-only, RATIFIED : 92.7%   (192,750,000 of 207,990,000 EGP)   <-- the gate
95% gate              : NOT PASSED
```

There is no provisional figure this round. Both outstanding proposals are
proposed as *not joinable*, so provisional and ratified coverage are the same
number — the gap to 95% is not sitting in a queue awaiting sign-off.

| Step | Ratified coverage |
|---|---:|
| Start of Phase A | 57.6% |
| After the `Active` split | 73.9% |
| After the normaliser fix (digit/letter boundary) | 79.6% |
| After your EMPACOZA TRIO approvals | 90.2% |
| After ZETAKARDOVAL confirmation | 92.6% |
| **After today's workbook change** | **92.7%** |
| If the product master confirms both DOZOVA strengths | 95.8% |

**2.3 points short of the gate**, and closing it depends on data that does not
exist in either source file. The RATIFIED / PROPOSED separation stays as you
directed: the build cannot clear its own gate using its own classifications.

---

## 5. Company-level budget reconciliation

```
Line budget sheet    267,100,000 EGP
SKU budget sheet     267,100,000 EGP
Difference                     0 EGP
```

**No budget is missing, duplicated or lost.** All eight exceptions are
classification differences — the same money filed under different lines in the
two sheets. Neither sheet has been made authoritative. No variance has been
reallocated.

---

## 6. BU / Line-level classification variances

| Group | Line | Line sheet | Sum of SKUs | Variance | Net at BU | Status |
|---|---|---:|---:|---:|---:|---|
| **A** | Zetagarouh | 5,000,000 | 0 | −5,000,000 | | ✅ Decided |
| **A** | CHC | 24,600,000 | 29,600,000 | +5,000,000 | **0** | ✅ Decided |
| **B** | DIAB-I | 13,689,720 | 14,500,000 | +810,280 | | ⛔ **UNRESOLVED** |
| **B** | DIAB-II | 20,344,342 | 21,500,000 | +1,155,658 | | ⛔ **UNRESOLVED** |
| **B** | DIAB-III | 21,376,218 | 24,000,000 | +2,623,782 | | ⛔ **UNRESOLVED** |
| **B** | DIAB-IV | 22,089,720 | 17,500,000 | −4,589,720 | **0** | ⛔ **UNRESOLVED** |
| **C** | GIT-I | 22,000,000 | 21,700,000 | −300,000 | | ✅ Decided |
| **C** | GIT-II | 22,000,000 | 22,300,000 | +300,000 | **0** | ✅ Decided |

**Group A — Zetagarouh / CHC.** Confirmed by you as a classification difference,
not a budget difference. Evidence: the SKU sheet holds a `ZETAGAROUH` brand
tagged BU=CHC at exactly 5,000,000; the line sheet holds `Zetagarouh` as its own
line at exactly 5,000,000. Variance preserved in the report, not corrected.

**Group C — GIT-I / GIT-II.** Preserved by your decision. **No auto-reallocation.**
BU total unchanged at 75,000,000 in both sheets. 0.4% of the affected lines.

**Group B — DIAB-I…IV. Explicitly documented and unresolved.**
No authoritative allocation has been chosen, automatically or otherwise. DIAB's
BU total agrees exactly (92,500,000 in both sheets); the four sub-line splits do
not. Both allocations are preserved side by side, and the build is coded to
refuse to pick between them.

| Line | Line-sheet allocation | SKU-sheet allocation | Gap | % of line |
|---|---:|---:|---:|---:|
| DIAB-I | 13,689,720 | 14,500,000 | 810,280 | 5.9% |
| DIAB-II | 20,344,342 | 21,500,000 | 1,155,658 | 5.7% |
| DIAB-III | 21,376,218 | 24,000,000 | 2,623,782 | 12.3% |
| **DIAB-IV** | **22,089,720** | **17,500,000** | **4,589,720** | **20.8%** |

Why this one matters operationally: a line manager measured against a line
budget currently has two possible targets, and on DIAB-IV they differ by over a
fifth. Until you confirm the authoritative allocation, any Expense vs Sales
figure at DIAB sub-line level would be reporting one of two numbers without
being able to say which is right.

---

## 7. Business decisions still required

| # | Decision | Owner | Effect |
|---|---|---|---|
| 1 | Confirm the strength of `DOZOVA NAD` and `DOZOVA Q10 COENZYME` from the product master | Product / regulatory | 92.7% → 95.8% |
| 2 | **Confirm the authoritative DIAB-I…IV allocation** — line sheet or SKU sheet | You + DIAB BU owner / Finance | Clears the last 4 reconciliation exceptions |
| 3 | Define what `Active = No` means in the source workbook | Business / Finance | Does not block Phase B. Leaves 59,110,000 EGP (22% of budget) in an undefined category. You have stated these SKUs do not yet have sales; the workbook itself still carries no definition |
| 4 | Authorise the additive change to `js/semantic-model.js` (`expenseGrainFor()`, `Gyna → DIAB`) | You | Required before any Phase B build |
| 5 | Authorise establishing a regression suite before Phase B | You | Equivalent tests to be established, not recreated |

**Decisions 1 and 2 are the Phase B gate.** 3 is a disclosure. 4 and 5 are
authorisations for the next phase, not blockers on this one.

---

## 8. Current gate

```
NO-GO for Phase B. Blockers:
  - ACTIVE budget-value coverage 92.7% (ratified) is below 95%
  - 2 classification(s) proposed and unresolved (6,440,000 EGP). Both are
    proposed as NOT joinable, so ratifying them would not change coverage —
    they are open questions, not pending coverage. Resolution depends on the
    product master, not on a review of this data.
  - 4 budget reconciliation exception(s) OPEN — DIAB-I, DIAB-II, DIAB-III,
    DIAB-IV. Requires explicit business confirmation; the build will not
    choose an authoritative split.
```

The 95% gate is **not** passed. Per your standing instruction, coverage crossing
95% would not by itself authorise Phase B — reconciliation is a separate gate,
and Phase B begins only on your explicit approval.

---

## 9. What Phase A has produced

| Deliverable | State |
|---|---|
| A — Reviewable SKU mapping table | 118 rows; 10 ratified, 2 proposed; mapping preserved, source fields refreshed |
| B — Budget reconciliation report | 8 exceptions; 4 decided, 4 open; none auto-reconciled |
| C — Dimension exception report | **0 unresolved** |
| D — Unmapped SKU report | Complete, with per-SKU evidence |
| E — Actuals import template | 56 joinable SKUs × 12 months = 672 rows; now carries `Active` |
| F — Import validation rules | Specified; importer is Phase C |
| G — Semantic layer design | Designed, **not implemented** |
| H — Active split report | `expense/reports/active_split.csv`, 33 rows — new |

---

## 10. Repository state

Nothing committed. Nothing pushed. Nothing deployed. No UI. No Expense vs Sales
page. No change to `js/semantic-model.js`, any existing dashboard page, or any
cache.

No further Git commands will be run from the sandbox. `.git\index.lock` is yours
to remove before your next Git operation, as you specified.
