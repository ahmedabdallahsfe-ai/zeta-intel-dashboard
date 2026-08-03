# Business Review Framework — Enterprise Methodology
### Version 2 (Executive Decision Framework) | Validated against CHC | Applies identically to Cluster, DIAB, GIT, and any future Business Unit

**Ownership:** this framework belongs to the platform, not to any single BU review. Every BU review consumes it; no BU review may deviate from its structure, scoring formulas, or evidence rules. The reasoning engine (`js/business-review-engine.js`, `js/semantic-model.js`) implements this spec in code — nothing here is CHC-specific, and nothing in the code is either.

---

## 1. Evidence & Confidence Rubric

Every major insight in a BU review must carry four things, not a bare assertion:

| Field | Definition |
|---|---|
| **Evidence Level** | High / Medium / Low — how directly the available data supports the claim |
| **Supporting KPIs** | The exact metrics used, by name |
| **Confidence Score** | A 0–100 number, derived from Evidence Level + source agreement (see below) |
| **Data Sources Used** | Which of Sales / Coverage / SFE / IQVIA the claim draws on |

**Confidence scoring rule (mechanical, not a feeling):**

| Condition | Confidence |
|---|---|
| Two or more independent sources agree on direction | 80–95 |
| One source, strong/consistent trend (e.g. 5/5 months) | 60–75 |
| One source, single-period snapshot only | 40–55 |
| Sources disagree, or only a proxy metric is available | ≤35, and must be labeled a Hypothesis, not a Fact or Interpretation |

**Evidence Level mapping:** High = Confidence ≥70; Medium = 40–69; Low = <40.

---

## 2. FACT / INTERPRETATION / HYPOTHESIS — mandatory tagging

Every claim in a review must be tagged as exactly one of:

- **FACT** — a number read directly from a cache, no inference (e.g., "CHC vacancy rate is 26.5%").
- **INTERPRETATION** — the most likely explanation given the facts, stated with its confidence score (e.g., "Vacancy is the primary driver of CHC's coverage and sales shortfall — Confidence 78").
- **HYPOTHESIS** — a plausible alternative explanation that current data cannot confirm or rule out, paired with the evidence that would resolve it (e.g., "The 194.5% growth figure may partly reflect a small starting base rather than a durable trend — would need multi-year MAT history to confirm").

A review section that only ever states FACTs is descriptive analytics. A review that jumps straight to INTERPRETATION without showing the FACTs underneath is unearned confidence. Both are framework violations.

---

## 3. Business Review Scorecard — the 8-Dimension Health Index

Computed by `BUSINESS_REVIEW_ENGINE.computeHealthIndex(bu, summaries)`. Every sub-score is 0–100, higher = healthier, so scores are always comparable across BUs and across time.

| # | Dimension | Formula | Source |
|---|---|---|---|
| 1 | Commercial Performance | `min(achievementPct, 100)` | Sales |
| 2 | Execution Excellence | `coveragePct` | Coverage |
| 3 | Market Competitiveness | `50 + shareDeltaPts×5 + (zetaGrowthPct − marketGrowthPct)×0.15` | IQVIA |
| 4 | Sales Force Health | `100 − vacancyRatePct` | SFE |
| 5 | Customer Engagement | `rightFreqPct` | Coverage |
| 6 | Growth Potential | `50 + marketGrowthPct×0.5` | IQVIA |
| 7 | Operational Risk (higher=safer) | `100 − (vacancyRatePct×1.5 + attritionRatePct×3)` | SFE + Coverage |
| 8 | **Overall Business Health** | Weighted average of 1–7 (weights below) | All four |

**Default weights** (configurable per Executive Committee direction, not empirically fitted — state any change explicitly if adjusted): Commercial Performance 25%, Execution Excellence 15%, Market Competitiveness 15%, Sales Force Health 15%, Customer Engagement 10%, Growth Potential 10%, Operational Risk 10%.

**Health bands:** Strong ≥75 · At Risk 55–74 · Critical <55.

Execution Excellence and Customer Engagement are deliberately kept as two separate single-metric dimensions (coverage breadth vs. frequency depth) rather than blended, so no dimension double-counts the same underlying Coverage data under two names.

### 3a. The Health Index is decision-SUPPORT, never the decision itself

**Governing rule (non-negotiable):** no review may present the Health Index, or the cross-BU ranking in section 4, as a conclusion in itself. A score of 68 or a rank of #1 is an input to judgment, not a verdict. Every review must state, explicitly, that final investment and resourcing decisions rest on business evidence, commercial context, strategic priorities, and expected return — of which these scores are only some of the inputs (see section 4a).

This matters most where the index and the ranking point in different directions from a BU's actual strategic weight (see the CHC case: highest Expected ROI, lowest Strategic Importance-by-size, in section 4). The framework's job is to surface that tension clearly — never to resolve it by declaring a winner.

---

## 4. Cross-BU Prioritization — the 6-Dimension Ranking

Computed by `BUSINESS_REVIEW_ENGINE.computeCrossBURanking(summaries)`, across **all** in-scope BUs at once — a BU is never ranked in isolation.

| Dimension | Formula | Better direction |
|---|---|---|
| Growth Potential | `marketGrowthPct` (raw, IQVIA) | Higher |
| Execution Risk | `vacancyRatePct + (100−coveragePct)×0.3 + (100−rightFreqPct)×0.3` | Lower |
| Market Opportunity | `marketSizeMAT × (1 + marketGrowthPct/100)` | Higher |
| Resource Need | `vacancyRatePct` | Lower |
| Strategic Importance | `(shareOfPortfolioTarget×0.5 + shareOfPortfolioMarketSize×0.5) × 100` | Higher |
| Expected ROI | `marketGrowthPct × (vacancyRatePct/100)` | Higher |

**Strategic Importance is an explicit proxy, not a claim of completeness.** It captures relative size (revenue commitment + market size) because that's what the data can compute — it does NOT capture patient burden, pipeline dependency, or competitive/regulatory positioning, which are legitimate strategic inputs an Executive Committee should still apply on top of this number.

**Expected ROI is the framework's signature metric**: it rewards BUs where a large, unclaimed opportunity (high growth × high vacancy) exists, rather than simply rewarding the biggest or fastest-growing BU outright. A BU can rank last on size and still rank first on Expected ROI — that tension is the point, and every review must surface it explicitly as a Decision Point (below), not resolve it silently.

---

## 4a. Investment Consideration Matrix (12 dimensions)

Cross-BU ranking (section 4) covers six data-computable dimensions. A real investment decision requires twelve. Every review's Strategic Decision Point must present all twelve, honestly marked as either data-backed today or requiring qualitative executive input — never silently filled in or skipped.

| # | Dimension | Status | Source when data-backed |
|---|---|---|---|
| 1 | Strategic importance to the company | Data proxy only (size-based) — **incomplete** | Sales target share + IQVIA market-size share |
| 2 | Market size | Data-backed | IQVIA |
| 3 | Market growth | Data-backed | IQVIA |
| 4 | Market share position | Data-backed (relative AND absolute — report both; a BU can lead on share momentum while trailing on absolute share) | IQVIA |
| 5 | Commercial profitability | **Not available** — no margin/cost data in any current cache | Requires Finance input or a future margin data source |
| 6 | Growth potential | Data-backed | IQVIA |
| 7 | Execution capability | Data-backed | Coverage + SFE |
| 8 | Resource requirements | Data-backed | SFE |
| 9 | Opportunity cost | Data-derived (section 6) | Cross-BU ranking, all four modules |
| 10 | Risk profile | Partially data-backed (operational risk only) — **competitive, regulatory, and execution-timing risk are not modeled** | SFE + Coverage (operational only) |
| 11 | Portfolio strategy | **Not computable** — requires Marketing/Executive input (is this BU core, adjacent, or divesting?) | Executive input required |
| 12 | Corporate priorities | **Not computable** — requires Executive Committee input (board-level priority independent of current size) | Executive input required |

**Rule:** any Strategic Decision Point that only cites dimensions 2–4, 6–9 (the data-backed ones) and silently omits 1, 5, 10, 11, 12 has understated the decision's real complexity. State the gaps explicitly instead — "not computable from current data, requires Executive input" is a valid and required entry, not an omission.

## 4b. Adaptive Narrative — presenting-issue classification

Every review opens with a one-line **presenting issue** classification, chosen from: **Market Share** / **Execution & Resourcing** / **Commercial Profitability** (once available) / **Portfolio & Positioning**. This classification determines which of the 16 Management Decision Pack sections (see section 12) get expanded depth and which stay brief — sections are a standard checklist, not a mechanically equal-weighted template every time.

| If the presenting issue is... | Expand | Keep brief |
|---|---|---|
| Market Share | Root Cause Analysis on competitive dynamics, Internal vs External Drivers | Execution/SFE detail, unless also implicated |
| Execution & Resourcing | Root Cause on Coverage/SFE/productivity, Cause-and-Effect Chain, Opportunity Cost | Market/competitive commentary, once confirmed healthy |
| Commercial Profitability (future) | Margin/mix analysis, pricing dynamics | Coverage detail, unless margin-linked |
| Portfolio & Positioning | Product mix, therapeutic-area strategy | Territory-level execution detail |

A review must still touch every one of the 16 sections (so nothing is silently dropped), but "touch" can mean one confirming sentence for a section that isn't the presenting issue — e.g., a review whose presenting issue is Execution & Resourcing can dispatch "Market Share position" in one line ("healthy, gaining +3.2pts — not the issue") rather than a full sub-analysis. This is what keeps the conciseness rule (section 10) compatible with a comprehensive 16-section structure.

## 5. Decision Points (mandatory, not optional)

Every review must end its analysis with explicit decisions for the Executive Committee, in this exact shape:

```
Decision Required: <single yes/no or choose-one question>
Options: <the real choices, not just "yes/do nothing">
Expected commercial impact: <quantified where possible, ranged where not>
Commercial risk: <what could go wrong with this decision specifically>
Required investment: <cost/resource ask>
Alternative options considered: <what else was on the table and why it's listed here, not chosen>
```

A review with only "Recommended Actions" but no "Decision Required" framing has told management what an analyst thinks — not given management something to decide in the room.

---

## 6. Opportunity Cost (mandatory for any resourcing recommendation)

Any recommendation that asks for more of something (headcount, budget, management attention) must answer:

- Where does it come from? (name the specific BU or budget line)
- What does the donor BU give up, quantified using its own Health Index / ranking numbers?
- Is the trade-off net-positive across the portfolio, not just for the receiving BU?

A recommendation that doesn't name its opportunity cost is treated as incomplete, not conservative.

---

## 7. Scenario Analysis (mandatory for the primary recommendation)

Three scenarios, every time: **Optimistic / Expected / Conservative.** Each must state its own assumption explicitly (not just a bigger or smaller number) — e.g. Optimistic assumes full vacancy closure within the stated timeline AND coverage/frequency converging to portfolio average; Conservative assumes partial hiring success and no frequency improvement. Scenarios are modeled estimates, tagged as INTERPRETATION or HYPOTHESIS per section 2 — never presented as FACT.

---

## 8. Short-Term vs. Structural Classification

Every identified issue must be labeled as exactly one of:

| Label | Definition | Typical resolution horizon |
|---|---|---|
| Immediate execution problem | Fixable by field operations without new investment | Days–weeks |
| Structural/organizational issue | Requires headcount, org design, or process change | 1–2 quarters |
| Market dynamics | External, not directly controllable | Monitor, don't "fix" |
| Portfolio issue | Product/positioning-level, needs Marketing/Medical input | Quarters |
| Capability gap | Needs training/coaching investment, not headcount | 1 quarter |

---

## 9. Executive Decision Matrix (the action tracker)

Every recommendation is a row in one table, every time, with exactly these columns:

`Priority | Business Impact | Implementation Difficulty | Expected ROI | Time to Benefit | Owner | Target Date | Success KPI | Current Status`

This table IS the artifact the Executive Committee should walk out of the review with — it becomes the standing action tracker for the next review cycle, not a one-time appendix.

---

## 11a. The Management Decision Pack — 16-Section Structure

The Business Review is a Management Decision Pack, not a report. Every BU instance follows these 16 sections, depth-adjusted per section 4b's presenting-issue rule — every section is touched, not every section is expanded:

1. Executive Summary
2. Business Health Assessment (section 3 index, presented as decision-support per 3a)
3. Executive Verdict
4. Evidence Dashboard (one consolidated table, all four sources, no KPI re-explained elsewhere)
5. Root Cause Analysis (FACT/INTERPRETATION/HYPOTHESIS, per section 2)
6. Cause-and-Effect Chain
7. Internal vs External Drivers
8. Risks
9. Opportunities
10. Strategic Decision Points (framed as scenarios per section 5, never as a pushed single answer where the Investment Consideration Matrix, section 4a, is materially incomplete)
11. Investment Scenarios (Optimistic/Expected/Conservative, per section 7)
12. Opportunity Cost Analysis (per section 6)
13. Recommended Actions
14. Management Action Tracker (the Decision Matrix, per section 9)
15. Executive Outlook
16. Business Review Appendix (methodology, assumptions, confidence, data quality — analyst-facing, not executive-facing)

## 10. Conciseness Rules

- Every section answers exactly one executive question — if a section doesn't map to a question, it doesn't belong.
- No KPI is explained twice. If coverage% is defined in "What Happened," every later section references it by name only.
- Tables over paragraphs wherever a table can carry the same information.
- The Executive Verdict and Decision Points must be readable in under 90 seconds without reading the rest of the document.

---

## 11. Reusability Contract

Nothing in `js/business-review-engine.js` or `js/semantic-model.js` references a specific BU name. To generate a review for a new BU:

1. Confirm the BU exists in `SEMANTIC.BU_LIST` (or add it + its line mappings, if a genuinely new Business Unit is created).
2. Call the same four `getBusinessSummary()` interfaces — no per-BU code needed, they already return all in-scope BUs.
3. Run `computeHealthIndex()` and `computeCrossBURanking()` — identical for every BU.
4. The narrative layer (Executive Verdict, Why-It-Happened causal chain, Decision Points, Scenarios) still requires human/analyst judgment applied ON TOP of the computed scores — the framework guarantees consistent, comparable INPUTS across BUs; it does not yet auto-write the narrative. That automation is the explicit target of the platform's later AI Executive Analyst phase, built on top of this same scoring layer once validated.

## 12. Quality Gate — the standing test for every BU review

Before any BU review is considered final, it must pass one test, asked plainly:

> **"If this were presented in front of the CEO and Executive Committee, would it help them make a better decision than a traditional BI dashboard would?"**

If the answer is not an unequivocal yes, the review is not templated further — it goes back for refinement. This is not a one-time CHC gate; it is a standing quality bar applied to every BU review this framework ever produces, including ones generated automatically in the future. Each review's Appendix (section 16 of the Decision Pack) must answer this question explicitly and honestly, including naming what is still missing when the answer is conditional rather than unequivocal.

## 13. Future Enhancement — Executive Decision Graph

Not built yet; tracked in `PLATFORM_ROADMAP.md`. Concept: rather than presenting Root Cause, Cause-and-Effect, Recommended Actions, and Success KPIs as separate sections a reader must mentally reconnect, render them as one connected visual chain — **cause → effect → recommendation → expected impact → KPI to monitor** — so the evidence-to-action path is a single traceable line, not four independently-read tables. This is a presentation-layer enhancement on top of the existing Root Cause / Cause-and-Effect / Recommended Actions / Action Tracker sections, not a new analytical method — the underlying data and reasoning are already produced by sections 5, 6, 13, and 14 of the Decision Pack.
