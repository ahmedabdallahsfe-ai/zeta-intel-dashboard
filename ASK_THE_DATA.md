# Ask the Data — Market Intelligence

A question box at the top of the Total Market Intelligence page. You type a
question, it computes the answer from the cube and shows the working.

---

## Why it is not an AI chatbot

The platform is a static GitHub Pages site with no backend. A model-backed
assistant needs an API key, and the only place to put one here is inside
client-side JavaScript — where anyone who opens devtools can read it and
spend against your account. That is not a trade worth making for a
convenience feature.

It is also the wrong tool for this particular job. Every figure this engine
returns is computed from the same cube the charts read, so a number in an
answer **is** the number on the page. It cannot invent a competitor,
misremember a denominator, or produce a confident figure from nothing —
the three ways an LLM quietly ruins a board pack.

What it gives up is free-form phrasing. What it buys is that every answer
arrives carrying its formula, its inputs, its period, its denominator and
its caveats. That is the half of "ask anything and get evidence" that
actually matters when someone is about to act on the reply.

If it cannot resolve a question it says so and tells you how to rephrase.
It never falls back to a plausible-sounding number for the wrong entity.

---

## What it can answer

| Question type | Examples |
|---|---|
| **Share** | "What is Zeta's share?" · "Amoun share of Diabetes" |
| **Growth** | "How did Zeta grow?" · "Is Hikma growing?" · "Pharco growth in 2024" |
| **Rank** | "Where does Zeta rank?" · "Sanofi position" |
| **Top N** | "Top 10 corporations" · "Top molecules in Diabetes" · "Biggest ATC4 classes" |
| **Compare** | "Compare Zeta and Pharco" · "Amoun vs Eva" |
| **Price** | "Average price of Zeta" · "Semaglutide price" |
| **Size** | "Zeta" · "Diabetes 2024" · any bare entity name |

Recognised across six dimensions: **Corporation, Therapeutic Area, ATC4
class, Molecule, Brand, Product**.

`we`, `our` and `us` all resolve to Zeta.

---

## Evidence shown with every answer

- **Measure** — LC Value, and what that means
- **Period** — and whether it came from your question or the filter bar
- **The entity's own value** — LC and units
- **Denominator** — the exact total the share is measured against
- **Filter scope** — what the filter bar is currently narrowing
- **Rows aggregated** — how many source cells went into the figure
- **Formula** — written out
- **Caveats** — partial year, active filters, incomparable denominators
- **Source** — the workbook and the cache build timestamp

---

## Three behaviours worth knowing

**A year in your question overrides the filter bar.** The bar defaults to
full years only, so 2026 is normally excluded. Ask "Zeta share in 2026" and
you get a real 2026 figure, with the January–April caveat attached. Without
this, a question that names its own period would answer with a dash.

**Filters narrow the answer, and it tells you.** With Therapeutic Area =
Diabetes selected, "What is Zeta's share?" returns **4.68%** (share of
Diabetes), not the **0.82%** whole-market figure — and raises a caveat
saying so. The answer can never silently contradict the charts beside it.

**Partial names work.** Nobody types `AMOUN PHARM.CO.*`. Corporate-form
suffixes (PHARM, PLC, CO, SAE, HEALTHCARE…) and leading ATC codes are
stripped to build aliases, so "amoun", "hikma" and "proton pump inhibitors"
all resolve.

---

## The bug this design caught

There is a corporation in the IMS panel called **SHARE PHARMACEUTICALS**.
Its alias is `share`. So the very first question anyone would type —
*"What is Zeta's share?"* — resolved to that company, computed its 2025
value (zero), and answered:

> **SHARE PHARMACEUTICALS holds 0.00% share**

Fluent, sourced, evidenced, and about entirely the wrong company. That is
the worst thing this feature could do, so the rule is now strict: a
candidate whose entire matched text is question vocabulary is never treated
as an entity. SHARE PHARMACEUTICALS is still reachable by its full name,
which nobody types by accident.

Worth remembering when reviewing anything else that maps text to entities.

---

## Performance

First question ~150 ms (it builds an alias index over 34,000 lookup names),
every question after that 7–40 ms. The index is cache-derived, so it is
rebuilt only when the cache is reloaded, never when filters change.

---

## Files

| File | Change |
|---|---|
| `js/market-intel.js` | `answerQuestion()` engine, entity resolver, renderer, `wireAsk()` |
| `css/market-intel.css` | `.mi-ask-*` block at the end |
| `dashboard.html` | cache-buster → `?v=20260806_cagr` |

Tested by `test_ask.js` — 73 checks, all expectations computed
independently from the raw cube rather than from the code under test.

---

## Extending it

New question types go in `ASK_INTENTS` (a regex plus an id) with a matching
branch in `answerQuestionFor`. Two rules for anything added:

1. Compute from `askScan` / `askRankList` — never from a chart's already
   aggregated output, or the answer can drift from the page.
2. Every branch must set `formula` and push its inputs into `evidence`. An
   answer without its basis is the thing this feature exists to prevent.
