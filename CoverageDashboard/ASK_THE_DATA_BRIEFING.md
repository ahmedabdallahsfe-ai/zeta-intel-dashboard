# "Ask the Data" — what it is and how it works

*A self-contained briefing. Assumes no prior knowledge of the project.*

---

## 1. Context

The **Zeta Commercial Excellence Dashboard** is a pharmaceutical commercial
intelligence platform used by a CEO, VP, Business Excellence lead, SFE
Manager, Business Unit Managers and Line Managers at an Egyptian pharma
company.

Architecturally it is unusual, and this constrains everything below:

- It is a **fully static site** — plain HTML, CSS and vanilla JavaScript,
  deployed on GitHub Pages. There is **no backend, no server, no database**.
- All data ships as **pre-built compressed caches**: Python ETL scripts read
  Excel workbooks, aggregate them, then gzip + base64 the result into
  `.js` files that the browser decodes into typed arrays at page load.
- The largest is a sales cube of **629,410 rows**; a competitor-market cube
  holds 62,010 aggregated cells covering 1,418 corporations, 4,232 molecules
  and 17,924 products.
- Access control is **client-side** and per user: of 24 accounts, 15 are Line
  Managers restricted to specific product lines and 4 are BU Managers
  restricted to one business unit.

**Ask the Data** is a natural-language question box that answers from these
cubes and shows its working.

---

## 2. The core design decision: it is NOT an LLM

The obvious implementation would call an LLM API. That was rejected for two
reasons.

**Practical.** With no backend, the API key would have to ship inside
client-side JavaScript, readable by anyone who opens devtools.

**Substantive, and more important.** Every figure this engine returns is
computed from the same cube the charts on the page read. A number in an
answer *is* the number on the page — by construction, not by coincidence. It
cannot invent a competitor, misremember a denominator, or produce a confident
figure from nothing.

The trade is explicit:

| Gives up | Buys |
|---|---|
| Free-form conversational phrasing | Numbers that cannot contradict the page |
| Handling arbitrary questions | Every answer carries its formula and inputs |
| Explaining *why* something happened | Refusal instead of a plausible wrong answer |

For a tool whose output feeds board packs, the second column matters more.

---

## 3. How a question is processed

```
question text
   │
   ├─ 1. NORMALISE      lowercase, strip punctuation, collapse whitespace
   │
   ├─ 2. SYNONYMS       "cardio"→"cardiovascular", "PPIs"→"A02B2 proton pump inhibitors"
   │
   ├─ 3. ENTITY MATCH   whole-word match against a pre-built vocabulary index
   │                    (fuzzy fallback only if nothing matched exactly)
   │
   ├─ 4. INTENT         regex classification into one of:
   │                    share · growth · achievement · coverage · frequency ·
   │                    rank · top-N · compare · price · size
   │
   ├─ 5. COMPUTE        scan the cube (or call the page's semantic layer)
   │
   └─ 6. RENDER         headline + detail + formula + evidence + caveats
```

### The entity index

Names are pre-processed once per user session into a searchable index. Two
transformations matter:

**Alias stripping.** Nobody types `AMOUN PHARM.CO.*`. Corporate-form suffixes
(PHARM, PLC, CO, SAE, HEALTHCARE, LABORATORIES…) and leading ATC
classification codes are stripped to produce aliases, so "amoun", "hikma" and
"proton pump inhibitors" all resolve.

**Whole-word matching.** A plain substring search matches "eva" inside
"PREVACID" and "GIT" inside "DIGITALIS". Matching is padded to word
boundaries so a question can only resolve to an entity the user actually
named.

### Evidence

Every answer renders with, at minimum:

- **Measure** — what is being counted, and in what unit
- **Period** — and whether it came from the question or the page's filters
- **Denominator** — the exact total a percentage is measured against
- **Formula** — written out in full
- **Filter scope** — what the page's filter bar is currently narrowing
- **Rows aggregated** — how many source cells produced the figure
- **Caveats** — partial periods, active filters, incomparable denominators
- **Source** — the workbook and the cache build timestamp

The evidence block is never collapsed behind a "details" toggle. A figure
without its basis is precisely what the feature exists to prevent.

---

## 4. Access control: the scope guard

This is the hardest part of the design, and the part most worth understanding.

**The problem.** Most pages carry internal data scoped per user. A Line
Manager restricted to the "Derma" line must never see another business unit's
figures. An "ask anything" box is a wide-open query surface over exactly that
data.

**The rejected approach.** Check permissions inside each answer branch. There
are dozens of branches; one forgotten `if` leaks another BU's numbers, and
nothing about the code makes the omission visible.

**The approach taken — structural, not procedural.** The user's entity
vocabulary is built *through* their permission filter. A Line Manager's index
simply does not contain another BU's brands, lines or managers. Those names
cannot be resolved, cannot be ranked, cannot be totalled, cannot appear.

The user is not blocked from asking. The entity does not exist in their world.

Two supporting details:

- **The index cache key includes the signed-in user.** An index cached across
  a sign-out would hand the next account the previous account's vocabulary.
- **Scope disclosure is added centrally**, in the engine rather than in each
  adapter, so no answer path can produce a figure without stating what it
  covers. Restricted users also see a persistent ribbon: *"Answering within
  Cluster · CVM-I, CVM-II, ORTHO-I…"*.

---

## 5. Architecture

```
js/ask-engine.js        shared: UI, evidence renderer, entity resolver,
                        intent parser, scope guard
   │
   ├── js/ask-sales.js  adapter: Executive + Sales pages
   ├── (ask-coverage)   adapter: Coverage + SFE   — not yet built
   └── (ask-iqvia)      adapter: IQVIA            — not yet built

js/market-intel.js      Market Intelligence has its own embedded copy
                        (it predates the shared engine)
```

An **adapter** declares what a page's data looks like:

```js
{
  id: "sales",
  dims: [ { key, label, names } ],   // dimensions a user may name
  visibleDimValues(dimKey),          // which values this user may see
  scopeLabel(),                      // human description of their scope
  answer(question, parsed, ctx)      // page-specific computation
}
```

**The Sales adapter computes nothing itself.** It calls the page's existing
semantic functions — `getBrandAchievement`, `getLineSalesSummary`,
`getDmSalesSummary` and so on. Those already encode a pile of hard-won
business rules: Non-Tender transactions only, Value basis, a rollup exception
for one product line, an Official-vs-Working target scenario, a target-file
authority override for one month, and the per-user entitlement filter.

Re-deriving any of that in the Ask layer would produce a panel that quietly
disagrees with the cards directly above it — worse than having no panel,
because the reader cannot tell which number is wrong.

---

## 6. Two bugs the design caught

These are worth including because they show the failure mode the whole design
is organised against: **a fluent, sourced, evidenced answer about entirely the
wrong thing.**

### "What is Zeta's share?" → the wrong company

There is a corporation in the market panel called **SHARE PHARMACEUTICALS**.
Its stripped alias is `share`. So the single most obvious question anyone
would type resolved to that company, computed its value (zero for the year),
and answered:

> **SHARE PHARMACEUTICALS holds 0.00% share**

Fix: a candidate whose *entire* matched text is question vocabulary — share,
growth, target, coverage, top, compare, rank… — is never treated as an
entity. The full name still resolves, because nobody types that by accident.

### Fuzzy matching turned nonsense into confident answers

A typo-tolerance layer was added using Levenshtein similarity at a 0.80
threshold with a 4-character minimum. Against a 34,000-name vocabulary,
*something is always within one edit*:

| Question | Match | Similarity | Answered about |
|---|---|---|---|
| "what is the weather in **cairo**" | `chiro` | 0.80 | COLECALCIFEROL + D-CHIRO-INOSITOL + … |
| "how do i **reset** my password" | `RESEPT` | 0.83 | a product called RESEPT |
| "who won the **match** yesterday" | `MATCHA` | 0.83 | GREEN MATCHA |

Fix — three tests, all of which must now pass:

1. the typed word is at least **6** characters (short words carry too little
   information to correct safely),
2. similarity is at least **0.85**,
3. absolute edit distance is at most **2**, so a long name cannot accumulate
   a passing ratio out of many small differences.

Comparison is against whole-word tokens only — matching a short token buried
inside a long multi-word name is how "cairo" reached D-CHIRO-INOSITOL.
Anything that still gets through is **disclosed** on the answer: *"Fuzzy
matching: 'semaglutid' interpreted as 'SEMAGLUTIDE'."*

After the fix: all six nonsense questions are refused; genuine typos
("semaglutid", "pharcoo") still resolve correctly.

---

## 7. What it can answer

| Type | Examples |
|---|---|
| Share | "What is Zeta's share?" · "Amoun share of Diabetes" |
| Growth | "How did Zeta grow?" · "Is Hikma growing?" |
| Achievement | "How is CHC performing?" · "Which lines are behind target?" |
| Rank | "Where does Zeta rank?" |
| Top-N | "Top 10 corporations" · "Top molecules in Diabetes" · "Top 10 brands" |
| Compare | "Compare Zeta and Pharco" |
| Price | "Average price of semaglutide" |

`we`, `our` and `us` resolve to the company itself.

When a question cannot be resolved it says so and suggests a rephrasing. It
never falls back to a plausible-sounding number for the wrong entity.

---

## 8. Behaviours worth knowing

**A period named in the question overrides the page filter.** The filter bar
defaults to complete years only, so the current partial year is normally
excluded. Asking "share in 2026" returns a real 2026 figure with a caveat
that it covers January–April and is not annualised. Without this override, a
question that names its own period would answer with a dash.

**Filters narrow the answer, and it says so.** With a therapeutic-area filter
active, "What is Zeta's share?" returns share *of that area* (4.68%), not the
whole-market figure (0.82%) — and raises a caveat. The answer can never
silently contradict the charts beside it.

**Suggestion chips are generated per user.** They were originally hardcoded,
and a test caught that a Cluster BU Manager was being shown buttons naming
business units they had no access to — disclosing out-of-scope names, on
buttons that would have failed. Examples are part of the scope surface, not
decoration.

---

## 9. Performance

First question ≈150 ms — it builds the alias index over the full name
vocabulary. Every question after that: **7–40 ms**. The index depends only on
the cache and the user's permissions, never on the page's filters, so it is
built once per sign-in rather than once per question.

---

## 10. Testing

Three suites, ~154 assertions. The methodological point: **expectations are
recomputed independently from the raw cube inside each test file**, not read
from the code under test. An engine that is wrong the same way twice would
sail through a test written from its own internals.

The scope-leak suite signs in as real accounts from the live roster — a CEO,
a BU Manager restricted to one unit, a Line Manager restricted to one line —
and asserts that:

- the vocabulary narrows to their scope,
- no forbidden entity resolves,
- rankings list nothing outside scope,
- **the rendered HTML contains no out-of-scope name anywhere** (this is the
  check that caught the suggestion-chip leak),
- switching users rebuilds the vocabulary, and switching back restores it,
- every answer carries a formula and a stated basis.

---

## 11. Summary

Ask the Data is a **deterministic natural-language query engine** over
in-browser data cubes, with three organising principles:

1. **Compute from the same source the page renders**, so answers cannot drift
   from the charts beside them.
2. **Show the working on every answer** — formula, inputs, denominator,
   period, scope, caveats — never collapsed.
3. **Enforce access structurally**, by restricting the vocabulary rather than
   checking permissions at each answer path.

It is less capable than an LLM assistant and considerably more trustworthy.
For a tool whose numbers reach a board pack, that is the correct trade.
