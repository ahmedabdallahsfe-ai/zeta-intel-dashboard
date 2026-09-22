# Customer Value Tier & Action Segment Proposal
**Completes the Customer Analytics module (`getClusterCustomerHealth`) with a Monetary dimension and a single actionable priority score.**

Status: **PROPOSAL — not yet built.** No code changed by this document.

---

## 1. Why this, why now

The Customer Analytics module (`etl/build_customer_analytics_cache.py` → `js/sales.js::getClusterCustomerHealth()`) already computes three of the four dimensions a best-practice customer-value model needs:

| Dimension | Status | What it captures |
|---|---|---|
| Bridge segment (Recency) | **Live** | New / Lost / Retained / Reactivated, month-over-month |
| Frequency segment | **Live** | Frequent (≥4 active months) / Occasional (2–3) / One-time (1) |
| Basket segment (portfolio depth — pharma-specific) | **Live** | Full (≥80% of core-SKU value) / Partial (>0%) / None of core |
| **Value tier (Monetary)** | **Missing** | No tiering of the raw `value` field a customer already carries |
| **Composite Action Segment** | **Missing** | No single field that says which customers to prioritize and why |

Today a rep or DM can see "this customer is Retained, Frequent, Full basket" but cannot see whether that customer is worth EGP 50k or EGP 5M a year, and there is no ranked output telling anyone which customers to act on this month. This proposal adds exactly those two missing pieces — nothing else changes.

**Scope note:** `CLUSTERS_TO_BUILD = {'Retail', 'Chain Pharmacy'}` is currently hardcoded in the ETL. This proposal does NOT expand cluster coverage — that's a separate decision pending confirmation that other clusters (Institutional, Government, etc.) have clean `CustomerID` at transaction grain in the source file. Flagged here as a follow-on, not bundled into this build.

---

## 2. Proposed addition #1 — Value Tier (Monetary)

Standard ABC / Pareto tiering, computed per cluster (optionally per BU) from the `value` figure already aggregated per customer.

**Logic:**
1. Rank customers within the cluster (or cluster×BU) descending by `value`.
2. Walk the ranked list accumulating cumulative % of total cluster value.
3. Assign:
   - **Tier A** — customers up to the cumulative 80% mark
   - **Tier B** — customers from 80% to 95%
   - **Tier C** — remaining customers (bottom 5% of cumulative value, typically the majority of customers by count)

This is the same 80%-of-value convention the Basket segment already uses for "core SKU," so it's consistent with logic already validated and shipped in this codebase — not a new methodology being introduced.

**Output field:** `valueTier: 'A' | 'B' | 'C'` per customer, computed both at cluster-level and BU-scoped (mirroring how `bridgeSegment`/`frequencySegment`/`basketSegment` are already BU-scoped).

---

## 3. Proposed addition #2 — Composite Action Segment

A lookup matrix combining **Bridge (recency/status)** × **Frequency** × **Value Tier**. Basket segment is deliberately excluded from the priority score itself — it informs *what to offer*, not *who to prioritize*.

| | Tier A (high value) | Tier B (mid value) | Tier C (low value) |
|---|---|---|---|
| **Retained + Frequent** | `Protect` | `Grow` | `Monitor` |
| **Retained + Occasional/One-time** | `Grow` | `Grow` | `Low Priority` |
| **Lost** | `Win-Back — Priority` | `Win-Back` | `Deprioritize` |
| **New / Reactivated** | `Onboard — Protect Early` | `Develop` | `Develop Passively` |

**Output field:** `actionSegment` per customer (one of the 9 labels above), plus `actionSegmentReason` (short string: which combination produced it, for UI tooltips).

**Why this shape:** it directly mirrors the Sprint module's call-list pattern already live on this platform (rank → segment → action list) — reps and DMs already understand this UI convention, so this isn't a new interaction model to train people on.

---

## 4. Implementation plan (once approved)

| Step | Change | File |
|---|---|---|
| 1 | Add value-tier computation (ranked walk, 80/95% cutpoints) inside the existing per-cluster/per-BU aggregation pass | `etl/build_customer_analytics_cache.py`, same function block that computes `freq_seg`/`basket_seg` (~line 452–461 and its BU-scoped twin ~line 561–575) |
| 2 | Add the 9-cell lookup and compute `actionSegment` alongside the three existing segments, both cluster-level and BU-scoped | Same file, same block |
| 3 | Surface `valueTier` and `actionSegment` in the API contract returned by `getClusterCustomerHealth()` | `js/sales.js` (~line 4148, the `customers.map()` block that already assembles `bridgeSegment`/`frequencySegment`/`basketSegment`) |
| 4 | Add a ranked "Priority Accounts" view (Win-Back / Protect / Grow lists), reusing the existing Customer Channel Mix → Customer Health drill-down entry point | `js/sales.js` UI layer + `dashboard.html`/`css` as needed |
| 5 | Re-run `refresh_sales.py` / `build_customer_analytics_cache.py`, regenerate cache, verify counts reconcile against current `customerCount` totals (no customer should be dropped or double-counted by adding these two fields) | ETL run + spot-check |

No changes to `cache.rows`, `cache.customers`, or any existing consumer of the current segments — this is purely additive.

---

## 5. Validation before shipping

- **Back-test the thresholds**: the 4-month Frequent cutoff and 80%/95% Value tier cutpoints are judgment calls (same status as the existing Basket 80% threshold — documented as a default, not a fitted value). Recommend spot-checking against 2–3 known accounts with the business owner before trusting `Win-Back — Priority` as a call-list source.
- **Reconciliation check**: `sum(valueTier A+B+C counts) == existing customerCount` per cluster/BU — cheap automated check to add to the ETL's existing verification pattern.

---

## 6. What this does NOT do

- Does not expand cluster coverage beyond Retail/Chain Pharmacy (separate decision, flagged in §1).
- Does not add trend/velocity (quarter-over-quarter value trajectory) or predictive/uplift modeling — those are the next tier up in sophistication, worth revisiting once this ships and is validated, not before.
- Does not touch HCP-side analytics (Sprint/Coverage) — this is customer/account-side only, as requested.

---

## 7. Decision needed from you

1. Approve the Value Tier + Action Segment build as scoped above (§2–4)?
2. Any change to the 80/95% value cutpoints or the 9-cell action matrix before I build against it?
3. Should cluster expansion (§1 scope note) be queued as the next item after this ships, or investigated in parallel?
