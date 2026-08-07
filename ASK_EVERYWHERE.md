# Ask the Data on every page — architecture and progress

Ahmed, 2026-08-07: put Ask the Data on all internal pages, **own scope only,
nothing else**, visible to **every role**.

---

## The problem Market Intelligence didn't have

Market Intelligence was the easy case. It sits on purchased IMS panel data
with no Zeta BU dimension — there was nothing to restrict, so the page was
simply role-gated and the Ask box could answer freely.

Every other page carries internal data that is scoped per user. Of 24
accounts, **15 are Line Managers and 4 are BU Managers**. An Ask box on the
Sales page cannot just be role-gated: a Line Manager types "top performers"
and reads another BU's numbers.

---

## The scope guard is structural, not a check

Enforcing "own scope only" with an `if` inside each answer branch would be a
mistake. There are dozens of branches across the adapters, and one forgotten
guard leaks another BU's figures.

So the guard is built into the shape of the thing instead:

**1. The entity vocabulary is built through the user's scope.**
`AskEngine.buildIndex()` skips any lookup value the adapter reports as
invisible. A Line Manager's index simply does not contain another BU's
brands, lines or district managers — those names cannot be resolved, cannot
be ranked, cannot appear in an answer. The user isn't blocked from asking;
the entity does not exist in their world.

**2. The index cache key includes the signed-in user.**
An index cached across a sign-out would hand the next account the previous
account's vocabulary. Verified by test: CEO 16 lines → Line Manager 1 line →
CEO again 16 lines.

**3. Scope evidence is appended centrally.**
`AskEngine.answer()` adds the scope row and the scope caveat to every result,
so no adapter branch can produce an answer that fails to state what it covers.

---

## Two real leaks the harness caught

**Example chips were hardcoded.** A Cluster BU Manager was shown buttons
reading "How is CHC performing?" and "Compare CHC and DIAB" — business units
they have no access to. Two faults at once: it discloses names outside their
scope, and every one of those buttons would have answered "outside your
access", which reads as a broken feature rather than a boundary. Examples are
now generated from the user's own vocabulary.

**Rankings failed for restricted users.** A restricted user cannot pass
`bu = null` to the semantic layer — it answers `access_denied`, correctly but
uselessly. `acrossBUs()` now asks BU by BU and merges, giving a real ranking
across everything they hold and, by construction, nothing they don't.

---

## Built on the semantic layer, not a re-scan

Every figure in the Sales adapter comes from `SalesDashboard`'s existing
functions — `getBusinessSummary`, `getLineSalesSummary`, `getBrandAchievement`,
`getItemAchievement`, `getDmSalesSummary`, `getSalesAchievementSummary`.

Those already encode Non-Tender only, Value basis, the CHC / CHC_SALES rollup
exception, the Official vs Working scenario, the June target authority, and
the per-user line entitlement filter. Re-deriving any of it would produce an
Ask panel that quietly disagrees with the cards directly above it — worse
than no panel, because the reader can't tell which number is wrong.

---

## Status

| Page | Adapter | State |
|---|---|---|
| Executive Command Center | `ask-sales` | **Live** |
| Sales Performance | `ask-sales` | **Live** |
| Total Market Intelligence | own panel | Live since 2026-08-06 |
| Coverage | `ask-coverage` | Not yet built |
| SFE | `ask-coverage` | Not yet built |
| IQVIA Market Share | `ask-iqvia` | Not yet built |

Executive and Sales share one adapter because they share one cube and one
semantic layer. Two adapters over the same data would eventually disagree.

An unlisted tab gets **no panel** rather than a panel answering from the wrong
cube.

### Still to build

- **Coverage + SFE** over the RECORDS cube (341,569 rows: period, team,
  businessUnit, nsm, areaManager, manager, employee, specialty, class,
  status, experience, type, coveredDoctor, rightFreq, visits, frequency,
  title, area). Note the `dashboard.data.js` cache is pre-aggregated
  rollups with no fact table — the adapter must read RECORDS.
- **IQVIA** over the IQVIA cube, scoped to the user's DM1 segments.
- Migrate Market Intelligence onto the shared engine so there is one
  implementation and one look.

---

## Files

| File | What it is |
|---|---|
| `js/ask-engine.js` | Shared: panel UI, evidence renderer, entity resolver, intent parser, scope guard |
| `js/ask-sales.js` | Sales adapter (Executive + Sales) |
| `js/app.js` | `askAdapterForTab()` + `mountAskPanel()` |
| `dashboard.html` | `#ask-panel-slot`, script tags |
| `css/market-intel.css` | `.mi-ask-*` — already global, not scoped under `.mi-root` |

The panel mounts into `#ask-panel-slot`, **outside `#app-root`**. Every
workspace rewrites `app-root`'s innerHTML on any filter change, so a panel
inside it would vanish the moment a filter was touched — taking the user's
typed question with it.

Switching tabs clears the question. A stale answer sitting above a different
page's charts invites exactly the mismatch this feature exists to prevent.

---

## Testing

`test_ask_sales.js` — 24 checks against the real cache and the real roster,
signing in as an actual CEO, BU Manager (Cluster) and Line Manager (Derma):

- vocabulary narrows to the user's scope
- no forbidden BU or line resolves as an entity
- rankings list nothing outside scope
- **the rendered HTML contains no out-of-scope name anywhere** — this is the
  check that caught the example-chip leak
- switching users rebuilds the vocabulary, and switching back restores it
- every answer carries a formula and a basis

Cache-buster: `?v=20260807_ask`.
