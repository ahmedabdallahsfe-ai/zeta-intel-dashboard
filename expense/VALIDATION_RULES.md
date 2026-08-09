# Expense actuals — import validation rules

Deliverable F of Phase A. Specification only; the importer is a Phase C build.

---

## The uniqueness key

```
Month + CanonicalBU + SKU Code + Expense Category
```

Expense Category participates in the key so that Marketing and Congress spend
on the same SKU in the same month are two rows, not a collision. Where the
source has no category, the field is the literal `GENERAL`, never blank —
blanks in a key are how silent duplicates get in.

**A repeated key is rejected, never merged and never overwritten.** Merging
would let someone double a month's spend by uploading a file twice; overwriting
would let a stale file quietly erase a correction. The importer reports the
clash and imports nothing for that key until a human resolves it.

**Re-importing the same month is a replace, not an append** — but only when the
user explicitly confirms it, and the previous file is retained. This is finance
data: every number must be traceable to the file it came from.

---

## Row-level rules

Rejected rows are reported individually with their row number and reason. A
file with rejected rows is **not** partially imported — the importer reports
everything wrong with the file and imports nothing until it is clean. A partial
import produces a month that looks complete and is not, which is worse than a
failed one.

| # | Rule | On failure |
|---|---|---|
| 1 | `Month` matches `YYYY-MM` and exists in the budget calendar | REJECT |
| 2 | `Month` is not in the future relative to the sales cache's latest month | REJECT — you cannot report actual spend for a month that has not happened |
| 3 | `BU` resolves to a canonical BU | REJECT |
| 4 | `Line` resolves via `CANONICAL_LINE_TO_BU`, and that line belongs to the stated BU | REJECT |
| 5 | `SKU Code` exists in `expense_sku_map.csv` | REJECT |
| 6 | The SKU's `CanonicalBU` matches the row's BU | REJECT — catches a copied row pasted under the wrong BU |
| 7 | Mapping status is `MATCHED`, or `NAME_VARIANT` **with `Reviewed = YES`** | REJECT |
| 8 | `Actual Expense` parses as a number | REJECT |
| 9 | `Actual Expense` is not blank | SKIP the row silently — a blank means "nothing to report", which is legitimate |
| 10 | `Actual Expense` ≥ 0 | REJECT by default; see below |
| 11 | Row is within the importing user's AUTH scope | REJECT |
| 12 | Column set is unmodified | REJECT THE WHOLE FILE |

### Negative expenses

Rejected by default. A negative actual is almost always a sign-convention
mistake, and treating it as a credit would quietly reduce a BU's spend.

Where a genuine credit note or accrual reversal exists, it must be entered with
`Expense Category = CREDIT_NOTE` and a mandatory `Note`. That makes the
exception explicit, visible in the audit trail, and countable — rather than
indistinguishable from a typo.

### Budget columns

The template carries budget for reference and **the importer ignores those
columns entirely**. Budget is official data. A user's spreadsheet must never be
able to change it, and the only way to guarantee that is never to read it.

---

## File-level rules

| Rule | On failure |
|---|---|
| Recognised template — header row matches exactly, in order | REJECT FILE |
| At least one importable row | REJECT FILE |
| No duplicate keys within the file | REJECT FILE, listing each clash |
| Every row inside the user's AUTH scope | REJECT FILE — a file straying outside scope is a wrong file, not a partly-wrong one |

---

## Data-quality outcomes that are *not* errors

These must render clearly rather than being suppressed or defaulted to zero.
Each says something real about the business.

| Situation | Treatment |
|---|---|
| Budget present, no actual entered | Actual = **not entered**, distinct from zero. Variance is not computed. |
| Actual entered, no budget | Variance = full actual amount, flagged **unbudgeted spend** |
| Budget = 0 | Variance % is **not defined** — shown as `—`, never ∞ or NaN |
| Sales = 0 | Expense-to-Sales is **not defined** — shown as `—`. A SKU with spend and no sales is a finding, not a divide-by-zero |
| Expense = 0 | Efficiency is **not defined** — shown as `—` |
| Month has no sales data yet | Excluded from YTD, flagged as partial |
| SKU is `NOT_YET_SELLING` | Excluded from correlation; budget still counted in reconciliation |
| SKU is `UNMAPPED` | Excluded from correlation; budget still counted in reconciliation |

The last two matter: **budget is never silently lost.** A total that excludes
unmatched SKUs must say so on the same screen, or it will be read as a company
total and it is not.

---

## Output of a successful import

```
expense/actuals/expense_actuals_<YYYY-MM>.xlsx     the file as submitted, kept
cache/expense_actuals.data.js                      the normalised cache
```

`refresh.bat` commits both, so git carries who changed what and when. That is
the audit trail, and it is why this design was chosen over browser storage.
