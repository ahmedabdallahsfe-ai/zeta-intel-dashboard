# Phase A — final readiness report

**Date:** 2026-08-09 · **Status:** Phase A complete · **Gate: NO-GO for Phase B**

Nothing has been committed, pushed or deployed. No UI exists. No existing
dashboard page, `semantic-model.js` calculation or cache has been modified.

---

## 1. The seven ACTIVE / NOT_YET_SELLING SKUs — classification with evidence

Each SKU was searched against the sales cube on its brand token, and every sales
product containing that token was listed. No fuzzy matching, no edit distance,
no inferred equivalence. The classifications below follow from the evidence
shown, and each is recorded as **PROPOSED** — awaiting your ratification.

### MATCHED — 3 SKUs, 27,000,000 EGP

These three differ from their sales counterpart by **one token: the unit word
"MG"**. Same brand, same combination strength, same pack size, same form. In
each case exactly one sales product carries that strength *and* that pack, so
there is no second candidate to be wrong about.

| Expense SKU | Budget | Sales product | 2026 sales |
|---|---:|---|---:|
| `EMPACOZA TRIO 25/5/1000 MG 30 TAB` | 12,000,000 | `EMPACOZA TRIO 25/5/1000 30 TAB` | 196,395,664 |
| `EMPACOZA TRIO 10/5/1000 MG 30 TAB` | 10,000,000 | `EMPACOZA TRIO 10/5/1000 30 TAB` | 72,344,292 |
| `ZETAKARDOVAL HCT 10/160/12.5 MG 30 TAB` | 5,000,000 | `ZETAKARDOVAL HCT 10/160/12.5 30 TAB` | 701,994 |

This is the same class of difference you already approved three times —
`COXORIZET 60 MG` / `60MG`, `EMPACOZA 25 MG` / `25MG`, `NEXICURE PLUS 40/1100` /
`40 /1100`. It is a formatting difference in how the two sheets write a strength,
not a difference in product.

### UNMAPPED — 2 SKUs, 6,440,000 EGP

Both have a single plausible sales counterpart. Neither is **demonstrable**,
because the sales product name carries **no strength at all** — so the specific
strength the budget names cannot be verified from the data.

| Expense SKU | Budget | Sales candidates | Why not matched |
|---|---:|---|---|
| `DOZOVA NAD 300 MG 30 CAP` | 4,200,000 | `DOZOVA NAD 30 CAP` (6,032,587)<br>`DOZOVA NAD 60 CAP` (8,822,841) | Neither states a strength. The 30 CAP pack matches, but "300 MG" is unverifiable. |
| `DOZOVA Q10 COENZYME 200 MG 30 CAP` | 2,240,000 | `DOZOVA Q10 COENZYME 30 CAP` (14,868,071) | No strength stated. Pack matches; "200 MG" is unverifiable. |

**These are probably the same products.** I am not mapping them on "probably".
If DOZOVA NAD and DOZOVA Q10 COENZYME each exist in only one strength, you can
confirm that from the product master and both become MATCHED, taking coverage to
**95.7%**. That is a one-line confirmation from someone who knows the portfolio —
not something the data can settle.

### NOT_YET_SELLING — 2 SKUs, 4,300,000 EGP

The brand sells. This strength/pack combination has no sales record. Stated as a
measurement only; the cause is not determinable from the data.

| Expense SKU | Budget | What sales has | What is absent |
|---|---:|---|---|
| `NEXIROZOVA 5 MG 28 TAB` | 2,500,000 | `NEXIROZOVA 5 MG 14 TAB` (71,051); 28 TAB packs at 10 MG and 20 MG | No 5 MG in a 28 TAB pack |
| `ZETAZOLEX 0.25 MG 30 TAB` | 1,800,000 | `ZETAZOLEX` at 1 MG, 2 MG, 4 MG — all 30 TAB | No 0.25 MG in any pack |

Both are internally consistent: the brand and the pack format both exist, only
this specific presentation does not appear in sales.

---

## 2. Recalculated ACTIVE budget-value coverage

The build now reports **two figures**, and the gate reads the conservative one.

```
ACTIVE-only, ratified   : 79.6%     <-- the gate figure
ACTIVE-only, provisional: 92.6%     (incl. 3 proposed mappings, 27,000,000 EGP)
```

**Why two.** A row I classified but you have not seen is marked
`Reviewed = PROPOSED`, not `YES`. Letting the build count its own unreviewed
opinion toward its own gate would defeat the entire purpose of a human-reviewed
mapping table. The provisional figure is shown because it is the honest estimate
of where coverage lands once you ratify; the ratified figure is what decides
GO / NO-GO.

| Population | SKUs | Budget EGP | % of active |
|---|---:|---:|---:|
| MATCHED (incl. 3 proposed) | 35 | 192,750,000 | 92.6% |
| NOT_YET_SELLING | 2 | 4,300,000 | 2.1% |
| UNMAPPED | 4 | 11,140,000 | 5.4% |
| **Active total** | **41** | **208,190,000** | |

Coverage path, for the record: **57.6% → 73.9%** (Active split) → **79.6%**
(normaliser fix) → **92.6%** on ratification → **95.7%** if the two DOZOVA
strengths are confirmed.

---

## 3. The 8 budget reconciliation exceptions

**Neither sheet has been chosen as authoritative and nothing has been
reconciled.** Both sheets are preserved as-is and the variance is reported.

### The finding that frames all eight

```
COMPANY TOTAL   line sheet  267,100,000
                SKU sheet   267,100,000
                difference            0
```

**No money is missing.** All eight exceptions are *classification* differences —
the same budget filed under different lines in the two sheets. That is a
materially different problem from a budget disagreement, and it changes what
decision you need to make.

### Group A — Zetagarouh / CHC (±5,000,000)

| | Line sheet | Sum of SKUs | Variance | BU |
|---|---:|---:|---:|---|
| Zetagarouh | 5,000,000 | 0 | −5,000,000 | (line not present in SKU sheet) |
| CHC | 24,600,000 | 29,600,000 | +5,000,000 | CHC |
| **Net** | | | **0** | |

**Structural reason — directly supported by the data.** The SKU sheet contains a
brand `ZETAGAROUH`, tagged `BU = CHC`, `Line = CHC`, budget exactly
**5,000,000**, `Active = No`. The line sheet keeps `Zetagarouh` as its own
separate line with exactly 5,000,000. Same money, two classifications: the SKU
sheet folds it into CHC, the line sheet treats it as a line of its own.

**Recommended business decision:** confirm whether Zetagarouh is a CHC line or a
line in its own right, then align the two sheets at source. You already
confirmed the CHC placement is intentional — if that is also how Finance wants
it reported, the *line sheet* is the one carrying the outdated structure.
Until then the variance is reported and neither sheet is overwritten.

### Group B — DIAB-I to DIAB-IV (nets to exactly zero)

| Line | Line sheet | Sum of SKUs | Variance |
|---|---:|---:|---:|
| DIAB-I | 13,689,720 | 14,500,000 | +810,280 |
| DIAB-II | 20,344,342 | 21,500,000 | +1,155,658 |
| DIAB-III | 21,376,218 | 24,000,000 | +2,623,782 |
| DIAB-IV | 22,089,720 | 17,500,000 | −4,589,720 |
| **DIAB total** | **92,500,000** | **92,500,000** | **0** |

**Structural reason — directly supported by the data.** The DIAB business unit
total agrees exactly between the two sheets. The four sub-lines do not. This is
an internal redistribution across DIAB-I…IV, not a difference in DIAB's budget.

The non-round line-sheet figures (13,689,720; 20,344,342) against round SKU-sheet
figures (14,500,000; 21,500,000) is consistent with one sheet holding an
allocated or driver-based split and the other holding a planned split — but
**the data does not establish which is which**, and I am not asserting it.

**Recommended business decision:** ask the DIAB BU owner which split is the one
used for accountability. A field-force line manager is measured against a line
budget, and the two sheets currently give DIAB-IV a 4.6M different number —
26% of that line. This is the exception with real operational consequence.

### Group C — GIT-I / GIT-II (±300,000, nets to zero)

| Line | Line sheet | Sum of SKUs | Variance |
|---|---:|---:|---:|
| GIT-I | 22,000,000 | 21,700,000 | −300,000 |
| GIT-II | 22,000,000 | 22,300,000 | +300,000 |
| **GIT total** | **75,000,000** | **75,000,000** | **0** |

**Structural reason — directly supported by the data.** The line sheet holds GIT-I
and GIT-II at an identical 22,000,000 each; the SKU sheet splits the same total
21,700,000 / 22,300,000. A 300,000 shift between two adjacent lines whose BU
total is unchanged.

**Recommended business decision:** lowest materiality of the three groups
(0.4% of the GIT lines). Confirm which split is intended and align at source.
No analytical consequence at BU level.

### Summary of the eight

| Group | Lines | Gross variance | Net at BU level | Materiality |
|---|---|---:|---:|---|
| A — Zetagarouh / CHC | 2 | 5,000,000 | 0 across the pair | Structural classification |
| B — DIAB-I…IV | 4 | 9,179,440 | **0** | High — 26% on DIAB-IV |
| C — GIT-I / II | 2 | 600,000 | **0** | Low |

---

## 4. Phase A gate

```
GATE
  NO-GO for Phase B. Blockers:
    - ACTIVE budget-value coverage 79.6% (ratified) is below 95%
    - 7 classification(s) proposed, awaiting Ahmed's ratification (37,740,000 EGP)
      Ratifying the mapping proposals takes ACTIVE coverage 79.6% -> 92.6%
    - 8 budget reconciliation exception(s)
```

Per your instruction: coverage crossing 95% would not by itself authorise
Phase B. The reconciliation exceptions are a separate gate and remain open.

### What is complete

| Deliverable | Status |
|---|---|
| A — Reviewable SKU mapping table | 118 rows, 12 human-reviewed, preserved across rebuilds |
| B — Budget reconciliation report | 8 exceptions, structurally explained, none auto-reconciled |
| C — Dimension exception report | **0 unresolved** (Gyna→DIAB override applied; NEUROSCIENCE→CNS was my bug, corrected) |
| D — Unmapped SKU report | Complete with per-SKU evidence |
| E — Actuals import template | 56 joinable SKUs × 12 months = 672 rows |
| F — Import validation rules | Specified; importer is Phase C |
| G — Semantic layer design | Designed, not implemented — Phase B needs your approval to touch `semantic-model.js` |

### What is open, and who owns it

| # | Open item | Owner | Effect if resolved |
|---|---|---|---|
| 1 | Ratify the 3 MATCHED / 2 UNMAPPED / 2 NOT_YET_SELLING classifications | You | 79.6% → **92.6%** |
| 2 | Confirm DOZOVA NAD and DOZOVA Q10 COENZYME strengths from the product master | Product/regulatory | 92.6% → **95.7%** — clears the coverage gate |
| 3 | Decide the DIAB-I…IV split (Group B) | DIAB BU owner | Clears the material reconciliation exception |
| 4 | Decide Zetagarouh's line structure (Group A) | Finance | Clears 2 exceptions |
| 5 | Decide the GIT-I / GIT-II split (Group C) | GIT BU owner | Clears 2 exceptions |
| 6 | Define what `Active = No` means | Business | Currently 58,910,000 EGP excluded from KPIs by rule, with no stated meaning |
| 7 | Regression tests before Phase B | Me, on your authorisation | Equivalent suite to be established, not recreated |

Items 1 and 2 together clear the coverage gate. Items 3–5 clear reconciliation.
Item 6 does not block Phase B — it is handled by a recorded rule — but it leaves
22% of total budget in a category nobody has defined.

---

## 5. Phase A remains the only authorised phase

No UI. No Expense vs Sales page. No changes to existing dashboard pages. No
commit, no push, no deployment. Awaiting your decisions on the seven items above.
