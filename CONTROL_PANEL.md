# Control Panel — data health and freshness

A new page answering one question an executive should never have to guess at
before a business review: **is what I am looking at current?**

Visible to **SFE Manager** and **Admin**.

---

## Why read-only

The platform is a static site with no backend. A panel that *wrote* anything
would have to persist it in one browser's `localStorage` — invisible to
everyone else, and silently disagreeing with the Excel config and the ETL that
actually govern the system.

Two sources of truth for the same setting is worse than one inconvenient
source of truth. Changes continue to happen where they already happen: the
config workbook and `refresh.bat`. The panel's job is to tell you when
something needs doing, not to do it.

---

## Two kinds of evidence, and the difference matters

**1. The build manifest** — `cache/build_manifest.data.js`, written by
`etl/build_manifest.py` at the end of every refresh.

The browser cannot stat a file on disk. It has no way of knowing that
`TOTAL_SALES_2026.xlsx` was updated after the sales cache was built. Only the
machine running the ETL can see both sides, so it records them: every source
workbook's timestamp and size, every cache's self-reported build time, row
counts, period coverage.

**2. Live cache inspection** — done in the browser, from the caches the page
has already loaded. Needs no ETL cooperation and cannot itself go stale,
because it is reading the very data the dashboard is rendering.

**Where the two disagree, the live inspection wins, and the panel says so.**
That gap is real: on 2026-08-06 a refresh rebuilt every cache and then failed
to push, so the live site ran for hours on caches the build machine believed
were current.

---

## What "stale" means here

Something specific and checkable: **a source workbook changed after the cache
was built.** Not merely "old".

A cache built six months ago from a workbook nobody has touched since is
perfectly current, and calling it stale would teach people to ignore the
panel. Age alone produces a softer "Check" after 14 days.

| Verdict | Meaning |
|---|---|
| **Current** | Every source is older than the build |
| **Stale** | A source workbook changed after the cache was built, or a cache file is missing |
| **Check** | A source workbook isn't on the build machine, or the build is over 14 days old |
| **Unknown** | No build timestamp could be established |

---

## Period alignment — the check that earns its place

The most useful section on the page. Each dataset is built by a separate
script from a separate workbook, so they drift apart one refresh at a time —
and nothing on any other page reveals it.

A Customer Analytics cache sitting a month behind Sales looks completely
normal until someone compares two pages and finds they disagree. This has
happened here before: Customer Health was stuck on May data while everything
else had moved to June.

The panel reads the actual period coverage out of each loaded cache, finds the
newest period any of them reaches, and names anything behind it.

Currently: Sales and Customer Analytics both run **2026-01 → 2026-06**,
aligned. Market Intelligence is listed separately — it is annual (2022–2026),
a different grain, and comparing it to monthly caches would be meaningless.

---

## Honest about weak evidence

Three ETLs — Coverage/SFE, IQVIA and TMS/IMS — do not stamp a build time into
their output. For those the manifest falls back to the cache file's
modification date and **labels it "from file date"**, because that is weaker
evidence: copying or re-committing a file changes its mtime without the data
changing at all.

Presenting the two kinds of timestamp as equivalent would be the easy thing
and the wrong one. If you want them upgraded, each of those three scripts
needs a `generatedAt` in its payload — a few lines each.

---

## What it will not do

It does not judge whether the numbers are **right**. It reports mechanical
facts — timestamps, row counts, period coverage, the data-quality counts the
ETL itself recorded — and flags disagreements between them.

A health panel that editorialises is one more thing to keep true.

---

## Files

| File | What it is |
|---|---|
| `etl/build_manifest.py` | Records what was built, from what, when. **Runs last** in `refresh.bat` — it stats the caches, so anything built after it won't be reflected until the next refresh. Non-fatal. |
| `js/control-panel.js` | The page: access gate, verdict logic, rendering |
| `css/components.css` | `.cp-*` block at the end |
| `dashboard.html` | Menu entry, manifest script tag, page script tag |
| `js/app.js` | Menu gating, tab routing, teardown, topbar title |
| `refresh.bat` | Manifest step + `git add -f` for the manifest cache |

The manifest needs `git add -f` for the same reason every other cache does:
`.gitignore` line 2 is `cache/`, and `git add -A` will not override an ignore
rule for a file git does not already track.

---

## Access

Gated in two places, as with Market Intelligence: the sidebar entry is hidden,
**and** `ControlPanel.init()` refuses to render for anyone else — so
un-hiding the entry in devtools gains nothing.

`CONTROL_PANEL_ROLES` is its own constant rather than reusing an existing role
list. It answers "who operates the data pipeline", which is a different
question from "who may see company-wide totals", and sharing a constant would
couple two things that should be free to diverge.

Admin is included because a control panel is by definition administrative. If
you want SFE Manager alone, remove `"Admin"` from that one array.

---

## Testing

`test_control_panel.js` — 30 checks:

- every role in the live roster resolves to the correct visibility (8 roles),
  and a signed-out session sees nothing
- the manifest decodes and every dataset produces a verdict
- verdict logic across all five cases, including the important negative:
  **an old build from an older workbook is "Check", not "Stale"**
- live cache inspection reads real period coverage
- period alignment is computable and detects drift
- the page renders with no `undefined` or `NaN`
- a denied role gets a clear refusal that leaks no dataset names

Cache-buster: `?v=20260807_control`.

---

## Next, if useful

You picked data health only. The other three options remain available:

- **Refresh run log** — what `refresh.bat` did step by step, with timings and
  failures, so a scrolled-past console window becomes a record.
- **Users & access** — view the roster and each user's scope; validate the
  config workbook before `sync_users.py` runs.
- **Business thresholds** — the achievement bands (100/90/70), materiality
  floors, CAGR window and default scenario, currently hard-coded across
  several files.
