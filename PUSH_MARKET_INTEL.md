# Publish Total Market Intelligence to the live site

Target: https://ahmedabdallahsfe-ai.github.io/zeta-intel-dashboard/dashboard.html

---

## The one thing that will break if you skip it

`.gitignore` line 2 is `cache/`. The other cache files are on the live site
only because they were **force-added** at some point in the past — gitignore
does not affect files git is already tracking.

`cache/market_intel.data.js` is **brand new**, so it is still ignored.
`git add -A` — which is what `refresh.bat` runs — will silently skip it.
The page would deploy fine and then show *"Market Intelligence cache not
found"*, because the 1.4 MB data file never left your machine.

It needs `git add -f` (force). That is the only unusual step below.

---

## Run this

```
cd /d "D:\2026\ZETA_INTEL_DASHBOARD\CoverageDashboard"

git add dashboard.html js/app.js js/auth.js js/market-intel.js css/market-intel.css etl/build_market_intel_cache.py refresh.bat
git add -f cache/market_intel.data.js

git commit -m "Add Total Market Intelligence workspace (IMS 2022-2026)"
git push
```

Note `cd /d` — plain `cd` will not switch from C: to D: on Windows.

### Confirm the cache actually staged

Before committing, check it is there:

```
git status --short
```

You should see `A  cache/market_intel.data.js` in the list. If that line is
missing, the `git add -f` did not take and the page will deploy without data.

---

## Access control

The page is restricted to **CEO, VP, BEx, Admin and SFE Manager**. Verified
against the live roster: BU Manager, Line Manager and Marketing Consultant
do not see it.

Gated in two places, deliberately:
- the sidebar entry is hidden for everyone else, and
- the render path checks entitlement itself, so deep-linking the tab or
  un-hiding the menu item in devtools gains nothing.

Note this is a *client-side* gate, same as the rest of the platform — see
the honest-limitation note at the top of `js/auth.js`. It is a real control
for normal internal use, not a defence against someone with devtools.

---

## What is being published

| File | Size | What it is |
|---|---|---|
| `js/market-intel.js` | 111 KB | The workspace — filters, KPIs, all analysis sections, insights engine |
| `css/market-intel.css` | 19 KB | Styling, scoped under `.mi-root` |
| `cache/market_intel.data.js` | **1.4 MB** | The data — 62,010 aggregated cells, 2022–2026 |
| `dashboard.html` | — | Sidebar entry, stylesheet link, script tags |
| `js/app.js` | — | Tab routing + teardown for the new page |
| `etl/build_market_intel_cache.py` | 13 KB | Rebuilds the cache from the IMS workbook |

`IMS 2022 to April 2026.xlsx` is **not** pushed — `*.xlsx` is gitignored, and
at 83 MB it should stay out of the repo. The cache is the shipped artefact;
the workbook stays local and is only needed when you rebuild.

---

## After it deploys

GitHub Pages takes 1–2 minutes. Then **hard-refresh** the live page with
`Ctrl+Shift+R` — a normal refresh can reuse cached JS/CSS.

Cache-busters on this build: `?v=20260806_ask`.

Check: the sidebar should show **🌐 Total Market Intelligence**, and opening
it should land on Total Market Value **292.06B** for 2025 with Zeta at
**#39, 0.82% share**.

---

## Rebuilding the cache later

When the IMS workbook is updated:

```
cd /d "D:\2026\ZETA_INTEL_DASHBOARD\CoverageDashboard"
python etl/build_market_intel_cache.py
git add -f cache/market_intel.data.js
git commit -m "Refresh market intelligence cache"
git push
```

Takes about 6 seconds. The `-f` is needed every time, for the same reason.

---

## refresh.bat now handles this (updated 2026-08-06)

`refresh.bat` has been updated, so **after this first push you can just run
`refresh.bat`** and everything is handled:

- It now runs `etl\build_market_intel_cache.py` alongside the other ETL
  steps (~6 seconds).
- It force-adds `cache/market_intel.data.js` with `-f`, next to the other
  cache files. Without `-f` the `git add -A` further down would skip it,
  because `.gitignore` line 2 is `cache/`.

The market-intel step is deliberately **non-fatal**: if
`IMS 2022 to April 2026.xlsx` is missing, it prints a warning and continues
rather than aborting the whole refresh. That workbook is a periodic IMS
delivery that may not always be present, and blocking the push of everything
else over an optional dataset would be the wrong trade.

You still need the manual commands above for THIS first push, because the
new files are not yet tracked.

And as before: do **not** run `push_to_github.bat`. It overwrites
`.gitignore` with its own hardcoded copy and wipes the credential
protections at the top of the file.
