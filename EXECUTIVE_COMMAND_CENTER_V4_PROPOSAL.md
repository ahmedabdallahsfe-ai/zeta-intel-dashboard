# Executive Command Center V4 — Simplification & Insight Proposal

**Status:** Proposal for sign-off — no code changed yet.
**Scope:** Evidence Dashboard (Section 4 of the per-BU Executive Business Review) + the scoring logic behind it. Rest of the 16-section schema untouched unless you extend this later.

---

## 1. Executive Summary

The last two builds made Evidence Dashboard *more* complete but *less* simple — two 18-column tables are analyst-grade, not executive-grade. This proposal keeps every metric you asked for, adds the ones you just requested (Brand Achievement Rate, Workload %, Execution %), but restructures the section around **one Total Score, six scored components, and a What/Why/Action card per component** — with the dense tables demoted to an optional "Show detail" toggle instead of always-on.

Everything below is buildable from data already flowing through the platform. Nothing requires a new source file. The only open item is where to set two benchmarks (Workload %, Brand Achievement threshold) — flagged explicitly, not silently assumed.

---

## 2. OODA Analysis

### Observe — current state, facts only
| Fact | Evidence |
|---|---|
| Evidence Dashboard has 2 tables with 18 data columns each (DM1, DM2) | Built last session |
| No narrative — every row is a number, zero "what does this mean" | `section4_evidenceDashboard()` today |
| Score logic exists (8-dimension Health Index) but lives separately from Evidence Dashboard, uses abstract dimension names not tied 1:1 to the metrics on this page | `business-review-engine.js` |
| No Line filter anywhere in the BU review; BU itself is chosen by clicking a landing-page tile, not a persistent selector | `renderBUOverviewGrid()` |
| Territories, call execution, workload have zero presence today | Confirmed — not computed anywhere yet |
| Brand Achievement Rate (%≥60%) is NOT computed anywhere today | New ask |

### Orient — why this happened, and the fix
Root cause: each build added metrics as **more columns**, not **more insight**. Best-practice BI (Tableau Pulse, Stripe dashboards) inverts this — a metric earns space on the page by being interpreted, not just displayed. The fix is architectural, not cosmetic: cap the headline view at 6 scored components, generate the story once per component, and push raw detail one click down (`<details>` already exists in this codebase — just underused).

### Decide — three options considered
| Option | What it is | Verdict |
|---|---|---|
| A. Leave as-is, add more tables | Fastest, zero redesign | Rejected — directly contradicts "very simpler way" |
| B. Replace Evidence Dashboard with 6-component **Evidence Score** + insight cards, tables become opt-in detail | Matches every ask, reuses 100% of data already built | **Recommended** |
| C. Full 16-section schema rewrite | Addresses more than was asked | Rejected — out of scope, risks regressing the CHC V3 narrative work |

### Act — see §7 Recommended Next Actions

---

## 3. The Evidence Score — 6 components, 1 Total, BU-range benchmarked

Replaces (not duplicates) the current 8-dimension Health Index with 6 components mapped directly to what's on this page. Each scores 0–100. Total Score = weighted average. Every component shows the **same BU-range bar** already used elsewhere (`otherBURange` pattern) so a BU is never read in isolation.

| # | Component | Formula (0–100 normalization) | Source (already built) | Default weight |
|---|---|---|---|---|
| 1 | **Sales Performance** | `min(100, achievementPct)` | Sales interface | 25% |
| 2 | **Brand Portfolio Health** *(new)* | `% of targeted brands with Achievement % ≥ 60%` (MAT, Value basis) | `getDM1DM2MarketIntel(bu).segments` | 20% |
| 3 | **Market Competitiveness** | Blended Achievement % from `total.mat.value`, capped at 100 | `getDM1DM2MarketIntel(bu).total` | 15% |
| 4 | **Field Execution** *(new)* | Call Execution % = onTargetCalls ÷ (onTarget+missed+wasted) | New: `analytics.js` already computes these sums, needs one BU rollup | 15% |
| 5 | **Organization Readiness** | `100 − vacancyRatePct` (Active vs Vacancy) | SFE interface | 15% |
| 6 | **Growth Momentum** | EVI-based: `min(150, evi) / 1.5` (150 EVI → 100 score) | IQVIA `total.mat.value.evi` | 10% |

**Total Score = Σ(component × weight).** Rendered as one big number + a ranked horizontal bar of all 4 BUs (reuses the existing `horizontalBarChart` already in `charts.js` — no new chart tech).

**Weights are a business judgment call, not a fact** — defaults above are my recommendation; happy to reweight per your priorities (e.g., if Brand Portfolio Health should outweigh Sales Performance this quarter).

---

## 4. New metrics — exact definitions (nothing fabricated, nothing silently assumed)

| Metric | Formula | Data readiness |
|---|---|---|
| **Brand Achievement Rate** | `COUNT(segments where tgtDm1 ≠ null AND achievementPct(MAT, Value) ≥ 60) / COUNT(segments where tgtDm1 ≠ null) × 100` | **Ready now** — pure derivation from `getDM1DM2MarketIntel()`, already returns `achievementPct` per segment |
| **Field Execution %** | `onTargetCalls ÷ (onTargetCalls + missedCalls + wastedCalls) × 100`, BU-rolled | `analytics.js` sums these already at rep level; needs one new BU rollup method, same pattern as `getFilteredCoverageSummary()` |
| **Workload %** | `Actual Customers-per-Rep ÷ Company-wide Benchmark Customers-per-Rep × 100` | Numerator ready (`customersPerRep`); **benchmark needs a decision** — I'd default to the platform-wide average across all active reps unless SFE has an official target span-of-control |
| **Territory impact** | Top 3 / bottom 3 territories (Manager/Area) by Coverage % or Achievement, within the selected BU/Line | Ready — `analytics.js` already computes per-manager/per-area coverage groups; rendered as a collapsed drill-down, not a headline card (too granular for exec view) |
| **Market Dynamics** | One consolidated card: market growth vs Zeta growth, EVI, Zeta's corp rank (#X of N) | Fully ready — already computed, just needs to be pulled into one card instead of scattered rows |

---

## 5. Storytelling template — every scored component gets this, not a raw number

```
[Component name]                                    Score: 78/100  ▲ vs last period
WHAT   — [current vs previous, variance, trend — auto-generated, never fabricated]
WHY    — [root-cause link to another already-computed metric, e.g. "Field Execution
          is down 8pts, tracking the +5pt rise in Vacancy% — likely a coverage
          gap from unfilled territories, not a productivity problem"]
         or, if no strong correlation exists in the data:
          "HYPOTHESIS — unresolved: no clear driver identified yet"
ACTION — [one specific, owner-ready recommendation, e.g. "Prioritize DIAB-II
          territory backfill — 3 vacant slots correlate with this BU's lowest
          Field Execution score"]
```

This is generated by rules against data already on the page (same honesty standard as the existing Root Cause Analysis section — real correlation or explicitly flagged "unresolved," never invented).

---

## 6. Filters: Line + BU

| Filter | Behavior | Effort |
|---|---|---|
| **BU selector** | Persistent tabs/dropdown at the top of the review (replaces click-only tile navigation) — switch BU without returning to landing page | Low — `ctx.currentBU` already exists, just needs a visible control |
| **Line filter** | Scopes Evidence Score + all 6 components to one Line within the selected BU (e.g., Cluster → PEDIA only) | Medium — `TARGETS_2026` already carries `line` per entry so Brand/Market components filter for free; Sales/Coverage/SFE interfaces currently only expose BU-level rollups and would need an optional `line` parameter added the same way `bu` already works |

**Recommendation:** ship BU selector immediately (low effort, high UX value); ship Line filter as a fast-follow once the three module interfaces accept an optional line argument.

---

## 7. Key Risks

- **Two benchmarks need your call before Workload % and the 60% Brand Achievement threshold go live** — shipping with unvalidated defaults risks a number executives challenge in the room.
- **Line-level filtering is only fully ready for IQVIA data today** — Sales/Coverage/SFE interfaces need a small, low-risk extension (add `line` param, same pattern as existing `bu` param) before the Line filter can scope everything consistently.
- **Reweighting the Total Score changes every BU's rank** — recommend a quick sensitivity check (show Total Score under 2–3 weight scenarios) before treating any single ranking as final for a board deck.

## 8. Leverage Opportunities

- Brand Achievement Rate turns 5–14 buried table rows per BU into one number the CEO can act on in seconds.
- The Evidence Score doubles as the Cross-BU Ranking input — one scoring pipeline instead of two.
- What/Why/Action cards are a template — once built for Evidence Dashboard, the same component drops into Sections 5–14 (Root Cause, Risks, Recommended Actions) for a consistent voice platform-wide.

## 9. Automation Opportunities

- WHY-line generation is rule-based correlation-matching today; a natural extension (later phase) is the already-planned "Phase 5a AI Executive Analyst" seam in `business-review-content.js`.
- Territory drill-down (top/bottom 3) can auto-refresh on every cache rebuild with zero manual curation — it's a pure derivation from existing per-manager rollups.

## 10. Recommended Next Actions

| Step | What | Depends on |
|---|---|---|
| 1 | Confirm/adjust the 6 weights in §3 and the two benchmarks in §4 | Your sign-off |
| 2 | Build Evidence Score (6 components, Total Score, BU-range bar) — replaces current headline table | Step 1 |
| 3 | Build the 3 new BU rollups (Brand Achievement Rate, Field Execution %, Workload %) | None — can start immediately |
| 4 | Rebuild Section 4 UI: score + What/Why/Action cards on top, existing 18-col tables demoted to a collapsed "Full product detail" toggle | Steps 2–3 |
| 5 | Add BU selector (persistent, replaces tile-only nav) | None — can ship independently, any time |
| 6 | Add Line filter (fast-follow, needs module interface extension) | Step 5 |

---

*No code has been changed for this proposal. Say the word and I'll start at Step 3 (zero dependencies, immediately buildable) while we finalize the weights/benchmarks in parallel.*
