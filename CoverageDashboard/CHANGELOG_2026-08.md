# Zeta Commercial Excellence Dashboard — August 2026 changes

Compiled 2026-08-09 by reading the repository, not from memory. Where I did
not do the work myself I say so — a good deal has been committed since my last
change and I can only see it through git.

---

## Where things stand

```
local   1cac9fb
origin  1cac9fb        in sync — everything below is live
```

Uncommitted right now: refresh artefacts only (`refresh_log.txt`,
`target_analysis.txt`, regenerated caches) plus an untracked `zeta_logo.png.png`.

---

## Part 1 — What I built this session

### Ask the Data
A natural-language question box that answers from the in-browser cubes and
shows its working. **Deterministic, not an LLM** — the site is static with no
backend, so a model would need an API key in client-side JavaScript. More
importantly, every figure is computed from the same cube the charts read, so a
number in an answer *is* the number on the page.

Shipped: the shared engine (`js/ask-engine.js`) and the Sales adapter
(`js/ask-sales.js`), mounted on Executive and Sales.

**The scope guard is structural.** Rather than checking permissions in each
answer branch — dozens of branches, one forgotten `if` leaks another BU's
numbers — the engine builds each user's *entity vocabulary* through their
scope filter. A Line Manager cannot ask about another BU's brand because that
brand is not in their index.

Two real leaks the harness caught:
- **Example chips were hardcoded**, showing a Cluster manager buttons naming
  CHC and DIAB — units they cannot see, on buttons that would have failed.
- **Rankings failed for restricted users**: passing `bu = null` to the semantic
  layer returns `access_denied`. Now it asks BU by BU and merges.

And one bug of a kind worth remembering: a corporation called **SHARE
PHARMACEUTICALS** meant *"What is Zeta's share?"* resolved to that company and
answered "SHARE PHARMACEUTICALS holds 0.00% share" — fluent, sourced, and
about entirely the wrong company. Fixed with a question-vocabulary stoplist.

### Growth is now CAGR everywhere
A change of measurement window, not a relabelling. The page compared latest-vs-
prior year; it now compares the first and last **full** years in scope and
annualises — 2022 → 2025 by default.

| | Before | Now |
|---|---|---|
| Zeta | +98.6% (2024→2025) | **+77.6% a year** |
| Market | +34.4% | **+34.9% a year** |

Partial years never enter a compound rate. Fewer than two full years shows "—"
and says why rather than falling back to a year-on-year step wearing a CAGR
label. A zero base gives `null`, not `Infinity`.

This surfaced a subtle bug: widening the window pulled in companies that traded
in 2022 but have since left, so the corporation count went 1,135 → 1,294 and
every *"ranks #39 of N"* inflated silently. Split into `rows` (for the growth
bridge) and `activeCount` (for rank denominators).

It also made something visible: market **value** compounds at +34.9%/yr while
**units** compound at −0.2%/yr. Growth 2022–2025 has been almost entirely price
and mix, with volume flat.

### Line Performance
- **Serial numbers**, stamped onto the row data after sorting so the CSV export
  carries the same numbering as the screen.
- **District Manager position under the name.** `getRepPositionsMap()` covers
  980 reps but **zero of 47 DMs** — a DM's position lives in the coverage
  records, on their own row. New `getDmPositionsMap()`; 102 DMs resolve, four
  covering two districts keep both.
- **Result banding**, deliberately restrained: colour on the decision column
  only (≥100 / 90 / 70 bands), row marks on the two extremes. Colouring every
  metric produces a rainbow nobody can read.

Caught on the way: making cells render HTML would have written
`<span class="lp-pill…">98.3%</span>` into your CSV exports. Columns now take
an `exportFormat`.

### Control Panel
Data health and freshness, read-only, SFE Manager and Admin. The browser cannot
stat a file, so `etl/build_manifest.py` records at build time what was built
from what and when.

"Stale" means something checkable — a source workbook changed *after* the cache
was built — not merely old. Period alignment across datasets is the section
that earns its place: each cube is built by a separate script, so they drift
apart one refresh at a time and nothing else reveals it.

Honest about weak evidence: three ETLs stamp no build time, so the panel falls
back to file dates and **labels them as such**.

### Load-time investigation
Measured: 41.3 MB shipped per page load, ~2.3 s of blocked main thread. Built
`js/perf-probe.js` — inert unless `?perf=1`.

**I then built lazy cache loading and you cancelled it.** The wiring is
reverted; see Part 3 for what that left behind.

### Fixed refresh.bat failing silently
A stale `.git/index.lock` — created by a read-only `git status` I ran — blocked
every `git add`, and `refresh.bat` only checked the exit code of `git push`.
The run looked successful while nothing reached GitHub. It now clears stale
locks, **stops on `git add` failure**, and verifies local SHA against remote
instead of trusting `git push`'s exit code.

---

## Part 2 — Committed since, not by me

Visible in git history; I have not reviewed this code.

| Commit | |
|---|---|
| `1cac9fb` | Actual/target visits on the Coverage Ask adapter |
| `edf992c`, `1c673ce` | Ask the Data + explore chips scoped for Line Managers across all pages |
| `d9d12ca` | Slogan → **"One Connected Performance Ecosystem View"** |
| `fb94c04` | **Client/server KPI selfCheck mismatch fixed** — the 11 mismatches I flagged |
| `70a060e`, `5920ab1` | Login page branding, official Zeta logo |
| `b9902e9` … `72074e7` | Ask the Data storytelling engine |
| `2c16e1e`, `b4f9ad2` | Sales vs Coverage correlation diagnostics |
| `89733e7` … `0a82c5a` | DM filter across Executive, Customer Channel Mix, Customer Health |
| `8514f13`, `c817a94` | Coverage line ranking, synonyms, headcount field mismatches |

**Ask the Data now covers every page** — adapters exist for coverage,
executive, sfe and sales, and `ask-engine.js` has grown from ~30 KB to 47.6 KB.
That completes what I had left outstanding.

---

## Part 3 — Loose ends worth a decision

**Four files from the cancelled performance work are committed and live.**
Nothing references them, so they are inert, but they are in the repo:

```
js/cache-loader.js          etl/build_auth_cache.py
cache/auth.data.js          PERFORMANCE_FIX.md
```

`PERFORMANCE_FIX.md` is the problem one — it documents a change that no longer
exists. Documentation describing reverted work is worse than no documentation.
I could not delete them; the sandbox denies deletes on your folder.

**Loading speed is still unaddressed.** 38.7 MB of caches load on every page
regardless of which page you open, and ~2.3 s of main-thread freeze remains.
The single safest lever is the one holding the rest hostage: `auth.js` reads
the sign-in roster from `IQVIA_CACHE.users`, forcing 4.4 MB to download before
anyone can log in, for 20 KB of roster.

**Docs are accumulating** — 20 markdown files, 260 KB. Several describe
proposals rather than shipped state.

---

## Testing

Seven suites, 228 checks, all green at revert:

| Suite | Checks |
|---|---|
| `test_ask.js` | 75 |
| `test_cagr.js` | 55 |
| `test_control_panel.js` | 30 |
| `test_perf_probe.js` | 27 |
| `test_ask_sales.js` | 24 |
| `test_lineperf.js` | 17 |

Expectations are recomputed from the raw cubes inside each test file rather
than read from the code under test — an engine wrong the same way twice would
otherwise pass its own tests.

These were **not** re-run against the commits in Part 2.
