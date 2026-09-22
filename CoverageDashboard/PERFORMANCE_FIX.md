# Loading performance — what changed

**20.1 MB removed from every page load, a 52% cut**, with no change to any
number, any calculation, or any file the ETL produces.

---

## The rule this was built under

> "fix slower without affecting data or anything"

So the only lever used was **when** things load — never what they contain.
Same cache files, same decoders, same globals, same results. Every consumer
still finds `window.X_CACHE` exactly where it always looked.

A page that loads faster but computes differently is not an optimisation. It
is a regression with a stopwatch.

---

## What was wrong

Every data cache was a `<script defer>` tag in `dashboard.html`, so **all
38.7 MB downloaded and were JavaScript-parsed on every page load** regardless
of which page you opened. Opening the Executive Command Center paid for the
IQVIA competitor panel, the customer analytics cube and the IMS market data —
none of which it reads.

| Cache | Size | Actually read by |
|---|---|---|
| `customer_analytics` | 14.3 MB | Customer Health drill only |
| `iqvia` | 4.4 MB | IQVIA Market Share page only |
| `market_intel` | 1.4 MB | Total Market Intelligence page only |
| | **20.1 MB** | **on every load, for nothing** |

### The one that was holding the rest hostage

`iqvia.data.js` could not simply be made lazy: `js/auth.js` read the sign-in
roster from `IQVIA_CACHE.users`. **20 KB of roster was forcing 4.4 MB of
market data to download before anyone could log in.**

`cache/userAuth.js` looked like the answer and was not — compared field by
field, 25 accounts in both, all 25 differing, every difference being the
missing `hash`. It is the human-readable mirror written by `sync_users.py`, not
an authentication source. Switching to it would have broken every login.

So `etl/build_auth_cache.py` now extracts the roster — hashes included — into
its own **6.3 KB** file.

---

## What now happens

| | |
|---|---|
| **Eager** (needed to render the landing page) | sales, records, dashboard, organogram, metadata, teamkpis, tms_ims, auth — **18.6 MB** |
| **On tab open** | `iqvia` and `market_intel`, with the spinner held up while they arrive |
| **Background, after first paint** | `customer_analytics`, scheduled on idle so it is already there when someone opens the drill |

---

## Two bugs fixed on the way

**The Customer Health drill would have latched "unavailable" forever.** Its
decoder used a sentinel meaning "checked, not available", and set it whenever
the global was absent. With the cache now arriving a second after boot, anyone
clicking early would have marked it permanently missing — the data would land
and never be looked at again. `false` is now reserved for "arrived and could
not be decoded"; not-yet-arrived leaves the sentinel unset so the next call
retries, and asks the loader to fetch it.

**A pathological allocation in the same decoder.** It built the byte array with
`strData.split('').map(x => x.charCodeAt(0))` — an intermediate JavaScript
array with one element per byte, **147 million of them** for this cache, before
copying into the `Uint8Array`. Replaced with the pre-sized typed array and
plain loop every other decoder here already uses. Identical output, a fraction
of the allocation.

---

## Safety

`ensure()` never rejects — a cache that fails to load resolves `false`, and
every one of these consumers already handled the global's absence, because
they had to cope with a user who had never run `refresh.bat`.

`auth.js` prefers `AUTH_USERS` and **falls back to `IQVIA_CACHE.users`**. If
`build_auth_cache.py` has never run, behaviour is exactly what it was. The
script also refuses to write a roster missing any password hash — a partial
roster would be worse than none, because the file would exist and therefore be
preferred.

---

## Verified

`test_lazy_boot.js` — 26 checks, the important ones being equivalence:

- the extracted roster is **byte-identical** to the one inside the IQVIA cache,
  and every account still carries a 64-character hash
- **all 25 accounts produce identical scope and entitlements** from either
  source — `getScope()`, `canViewAllBUs()`, `canViewMarketIntel()` compared
  account by account
- `auth.data.js` loads before `auth.js`
- the loader fetches once under concurrent callers, and resolves `false`
  rather than throwing when a load fails
- the Customer Health decoder retries instead of latching

Full suite still green: **254 checks** across Ask the Data (75), CAGR (55),
Control Panel (30), perf probe (27), lazy boot (26), Ask sales (24), Line
Performance (17).

---

## What this does not fix

The remaining 18.6 MB still decodes on the main thread at boot — roughly
**2.3 s**, of which sales is 1.4 s (your own console reported 1308 ms). That is
a *freeze*, not a delay: the loader cannot animate because the thread that
would animate it is inflating gzip.

Fixing that needs one of the changes I did not make under the "don't affect
anything" rule:

1. **Web Worker decode** — same work, off the main thread, so the UI stays
   alive. Moderate risk: every consumer currently assumes the decode is
   synchronous.
2. **`fetch()` + native gzip** — the browser's decompressor is native and
   ~5× faster than pako, and drops the 33% base64 overhead. Needs a `file://`
   fallback to keep double-click opening working.
3. **Binary typed arrays for the sales cube** — `JSON.parse` is 836 ms of that
   1.4 s, parsing 66 MB of text to express 629,410 × 27 numbers.

Say the word and I'll take them in that order — each is independently
testable.

---

## Files

| File | Change |
|---|---|
| `js/cache-loader.js` | New. On-demand + background cache loading. |
| `etl/build_auth_cache.py` | New. Extracts the roster to `cache/auth.data.js`. |
| `js/auth.js` | Prefers `AUTH_USERS`, falls back to `IQVIA_CACHE.users`. |
| `js/app.js` | Awaits the cache on IQVIA / Market Intelligence tabs; preloads customer analytics on idle. |
| `js/sales.js` | Customer analytics decoder: retry logic + allocation fix. |
| `dashboard.html` | Three cache tags removed; roster + loader added. |
| `refresh.bat` | Runs `build_auth_cache.py` after IQVIA; force-adds `auth.data.js`. |

Cache-buster: `?v=20260808_lazy`.
