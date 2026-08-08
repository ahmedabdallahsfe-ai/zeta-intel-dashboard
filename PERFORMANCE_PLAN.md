# Dashboard loading performance — findings and plan

Measured 2026-08-08. **Nothing has been optimised yet** — this documents what
the numbers say and what to do about it, pending a real-browser measurement.

---

## Step 1 — measure on the machine that's actually slow

Open the dashboard with `?perf=1` on the end:

```
https://ahmedabdallahsfe-ai.github.io/zeta-intel-dashboard/dashboard.html?perf=1
```

Wait for it to finish loading, press **F12** for the console, then run:

```js
ZetaPerf.copy()
```

That puts the whole profile on your clipboard. Paste it back and we optimise
against real numbers instead of my estimates.

It also works locally — just add `?perf=1` to the file URL.

**The probe is inert without `?perf=1`.** It patches `atob`, `pako` and
`JSON.parse` to time them, and a measurement tool that taxes every user all
the time is worse than no measurement. Normal loads never execute a line of it
beyond the URL check.

---

## Why a real measurement matters

pako's throughput swung by a factor of **33** across measurements on the same
data, same machine, same hour — 0.4 MB/s cold in a sandboxed context versus
13.4 MB/s once the JIT warmed up. Extrapolating a user's laptop from either
figure would be guesswork dressed as a measurement.

So the estimates below are a hypothesis to be tested, not a finding.

---

## What the server-side numbers suggest

**41.3 MB ships on every page load**, 38.7 MB of it data caches — all as
`<script defer>`, so every cache downloads and gets JS-parsed whether or not
you open the page that needs it.

Then the boot path blocks the main thread decoding:

| Cache | gzip | JSON | atob | byte loop | pako | JSON.parse | **Total** |
|---|---|---|---|---|---|---|---|
| sales | 9.6 MB | 66 MB | 14 | 37 | 559 | 836 | **1446 ms** |
| records | 3.0 MB | 30 MB | 4 | 46 | 274 | 248 | **572 ms** |
| dashboard | 1.1 MB | 12 MB | 3 | 6 | 188 | 83 | **280 ms** |
| organogram | 0.1 MB | 1.7 MB | 0 | 5 | 16 | 8 | **29 ms** |
| | | | | | | | **≈ 2.3 s** |

A typical office laptop runs 2–4× slower than this server, so 5–9 seconds is
plausible — and it is *frozen*, not merely slow. The loader cannot animate,
because the thread that would animate it is busy inflating gzip.

### Three structural observations

**pako is pure JavaScript.** It manages ~13 MB/s warm. The browser's own gzip
decoder is native and roughly 5× faster — we are doing by hand something the
browser will do for free.

**base64 costs 33% extra bytes** for no benefit, purely so the data can live
inside a `.js` file.

**JSON.parse is ~40% of the cost.** 66 MB of JSON text to express
629,410 × 27 numbers.

### Two specific defects

`decompressCustomerAnalyticsCache()` in `js/sales.js` decodes with
`.split('').map(x => x.charCodeAt(0))` — that allocates a
**147-million-element array**. Every other decoder in the codebase uses a
pre-sized `Uint8Array` and a plain loop. This path is lazy (Customer Health
drill only), so it is not hurting boot, but it will be brutal when it runs.

`cache/iqvia.data.js` (4.4 MB) downloads on every page load, but at boot only
its user roster is read — and that sits *outside* the compressed blob. The
4.4 MB is fetched and JS-parsed for nothing unless you open IQVIA.

---

## The plan

### Tier 1 — biggest win, contained risk

**1. Load caches on demand.** Executive needs sales + dashboard + records.
Market Intelligence, IQVIA and Customer Health each pull their own when
opened. Removes ~19 MB from first paint, and everything for pages never
visited.

**2. Decode in a Web Worker.** Does not reduce the work; moves it off the main
thread so the loader animates and clicks respond. This is the difference
between "slow" and "broken" from the user's side.

### Tier 2 — the real fix

**3. Replace base64 + pako with `fetch()` + native gzip.** Ship
`cache/sales.json.gz`; GitHub Pages sets `Content-Encoding: gzip`, the browser
inflates natively and `response.json()` parses natively. Eliminates atob, the
byte loop and pako entirely. Estimated 3–5× on decode and −25% bytes.

> **Constraint (confirmed):** local double-click open must keep working.
> `fetch()` is blocked on `file://`, so this needs both paths — `fetch` when
> served over http(s), falling back to today's script-tag method on `file://`.
> Two code paths to keep correct, which is the cost of this option.

**4. Ship the sales cube as binary typed arrays.** 629k × 27 numbers as packed
buffers parse in ~0 ms because there is nothing to parse. Removes the single
largest line in the table above. ETL + reader rewrite.

### Tier 3 — cheap and safe

**5.** Fix the `.split('').map()` decoder — one line.
**6.** Split `customer_analytics` per cluster so opening Retail does not decode
Chain Pharmacy.
**7.** Skip caches a role cannot use — a Line Manager never needs
`market_intel`.
**8.** Cache decoded data in IndexedDB keyed by the cache's build timestamp, so
a repeat visit skips decode entirely.

---

## What the profile will tell us

The fix depends on which stage dominates, and they point in opposite
directions:

| If the profile shows | Then the fix is |
|---|---|
| gzip inflate dominating | Tier 2 #3 — native decompression via fetch |
| JSON.parse dominating | Tier 2 #4 — binary buffers |
| network dominating | Tier 1 #1 — on-demand loading |
| long blocking, modest totals | Tier 1 #2 — Web Worker |

That is exactly why this is worth measuring before writing any of it.

---

## Files

| File | What it is |
|---|---|
| `js/perf-probe.js` | The probe. Inert unless `?perf=1`. |
| `dashboard.html` | One `<script defer>` tag, placed after pako so it can wrap it and before the caches so it sees every decode. |

Tested by `test_perf_probe.js` — 22 checks, including that wrapping `atob`,
`JSON.parse` (with reviver) and `pako.ungzip` returns byte-identical results,
and that the probe defines nothing at all when switched off.
