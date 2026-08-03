# Handoff Brief — 2026-08-04
**Project:** `D:\2026\ZETA_INTEL_DASHBOARD\CoverageDashboard` (Zeta Commercial Excellence Dashboard)

Two items: **(A)** a code bug already found and fixed — for review/context only, no action needed; **(B)** an open blocker that needs someone with an unconstrained machine to resolve.

---

## A. FIXED — Official/Working Target toggle showed inverted/broken results

**Symptom.** In the Executive Command Center, selecting "Official Target" in the Target Basis dropdown showed `N/A` / `EGP 0.0M` for Sales Achievement, Sales Value, and Sales Units Achievement. Selecting "Working Target" showed the real numbers (EGP 445.4M target, 132.7% achievement) — backwards, since Official should always have data.

**Root cause.** The Target Scenario feature encodes Official(1)/Working(0) into **bit 5 of each row's `mask` field**. That bit only exists starting with the v3 ETL (`refresh_sales.py`, `SCHEMA_VERSION` bumped 2→3). The live production cache (`cache/sales.json`) is still v2 — generated before the bit existed. On a v2 cache every target row has bit 5 = 0 despite being 100% real Official data (the bit was simply never written). Under the new convention bit 5 = 0 reads as "Working", so all real Official data was misread as Working, and "Official" (which requires bit 5 = 1) matched nothing and returned zero/N/A.

**Compounding issue.** A hard version gate (`REQUIRED_SCHEMA_VERSION = 3`) had also been added, which blocked the entire Sales Performance page from rendering against a pre-v3 cache, showing "Cache Update Pending" instead. A page that previously worked was now blocked, even though its underlying data was fine.

**Fix — `js/sales.js` (plus a matching UI note in `js/executive.js`):**

1. Added `scenarioSchemaAvailable()` — checks `cache.meta.schemaVersion >= 3`.
2. `includeTargetRow(mask, wantOfficial)` now skips the bit-5 check entirely when `scenarioSchemaAvailable()` is false — every target row counts toward whichever scenario is requested, matching pre-feature behavior exactly. Real differentiation activates automatically once the cache is genuinely v3.
3. Reverted `REQUIRED_SCHEMA_VERSION` back to `2` (the real structural/hierarchy gate, unrelated to this feature) — the hard block became unnecessary once reads degrade safely.
4. Added `window.SalesDashboard.isScenarioDataAvailable()` export, and a small note beside both Target Basis selectors (Sales Performance page and Executive Command Center): *"Working Target activates after the next cache refresh"* — so the no-op state is visible rather than silently confusing.

**Verification.** Two Node.js harnesses against synthetic v2-style and v3-style caches: both scenarios return identical, correct, non-null totals on a v2 cache; scenarios correctly differentiate on a v3 cache; the Sales Performance page renders instead of blocking. 26 checks total, all passing. `node --check` clean on all touched files.

**Status.** Fixed and verified in code. Not yet visible in the running dashboard because `cache/sales.json` itself is still v2 — which is item B.

---

## B. OPEN BLOCKER — `refresh_sales.py` never completes, `cache/sales.json` stays stale

**What's wrong.** `cache/sales.json` and `cache/sales.data.js` are still dated **2026-07-29, schemaVersion 2**, while every other cache in the project regenerated successfully today (2026-08-04) via `refresh.bat`:

| Cache file | Last generated |
|---|---|
| `dashboard.json` | 2026-08-04 01:39 |
| `records.json` | 2026-08-04 01:39 |
| `organogram.json` | 2026-08-04 01:39 |
| `iqvia.json` | 2026-08-04 01:41 |
| `customer_analytics.json` | 2026-08-04 01:42 |
| **`sales.json`** | **2026-07-29 00:27 — schemaVersion 2** |

Sales is the only step that never produces fresh output — it either errors silently, hangs, or takes far longer than expected against the ~199MB / ~1.2M-row `TOTAL_SALES_2026.xlsx`.

**Goal.** Run `refresh_sales.py` to full completion, then confirm `cache/sales.json`'s `meta.schemaVersion` is `3` and `meta.generatedAt` is today.

**How to run:**

```
cd /d "D:\2026\ZETA_INTEL_DASHBOARD\CoverageDashboard"
python refresh_sales.py > refresh_log.txt 2>&1
```

Note `cd /d` — plain `cd` will not switch drives from `C:` to `D:` on Windows and silently leaves you in the wrong folder. This already caused one failed attempt (the prompt stayed at `C:\Users\Dell>` and `refresh_log.txt` landed in the user profile folder rather than the project). Confirm the prompt reads `D:\2026\ZETA_INTEL_DASHBOARD\CoverageDashboard>` before running the python line.

**Notes for whoever picks this up:**

- **Close `TOTAL_SALES_2026.xlsx` in Excel first** — a locked source file is a likely silent-failure cause and has not yet been ruled out.
- The script has its own **resumable checkpoint** (SQLite DB in the OS temp folder). Interrupting and re-running resumes rather than restarting from zero — expected behavior, not a bug.
- A successful run prints progress through 5 stages (`[1-2/5] Loading + aggregating Sales workbook...` etc.) and ends with `Sales Aggregation Complete!`.
- **Why this can't be done in the Claude sandbox:** the sandbox enforces a hard 45-second ceiling per command and cannot keep a background process alive between commands. Opening/streaming the 199MB workbook alone consumes that entire budget, so a resumed run at the 780,000 / 996,720-row checkpoint made **zero** net progress in a full 42-second attempt. This is an environment limit, not a script defect — the user's own machine has no such ceiling, which is why every other (smaller) ETL step completes fine there.
- Please capture the full `refresh_log.txt`, or at minimum the last 20–30 lines plus any `Traceback`/`Error`, so the actual cause can be diagnosed rather than guessed.

---

## Git status

Nothing from either item has been committed or pushed. The Claude sandbox has no GitHub credentials — this is a standing constraint across the whole session, not a new issue.

Files modified for item A: `js/sales.js`, `js/executive.js`, `dashboard.html` (cache-busters bumped to `?v=20260804_targetscenario_fix2`).
