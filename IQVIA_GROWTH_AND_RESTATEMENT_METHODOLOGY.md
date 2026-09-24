# IQVIA Growth & Ownership-Restatement Methodology

**Status:** v1.0, 2026-09-24. **Approved** by Ahmed (SFE Manager): the growth classification (section 5) with the 0.5 % ranking threshold and the +1,000 % Low-base cutoff, and the five register entries (section 7). The numeric decision thresholds in sections 2–3 (3 months, 6 months, 20 %, 10 %) are **proposed defaults, not yet explicitly confirmed**. They were used only to analyse the cases; each entry was individually approved.
**Implemented locally 2026-09-24. Not committed. Git is managed separately by Ahmed.**
**Scope:** IQVIA module (`js/iqvia.js`, `refresh_iqvia.py`). The Total Market Intelligence page uses its own CAGR method (`GROWTH_AS_CAGR.md`). It follows the same zero-base principle: a zero base gives *null*, never *Infinity*.
**Checkpoint before this work:** git tag `mat-aug2026-growth-rule-v1` (commit 7622a1c).

---

## 1. Principles

1. **The raw source is never modified.** `IQVIA_SOURCE.xlsx` and the combined report are read-only. Every transformation happens in memory in `refresh_iqvia.py`, driven by versioned config files.
2. **Like-for-like with the latest organisation structure.** History is compared on the basis of today's owner. This way an ownership change is never reported as organic growth or organic decline.
3. **Every restatement is explicit, approved, reversible and audited.** One register entry per product (`iqvia_source/config/corp_restatements.json`), each with an on/off flag, an approval status and expected row/value counts. The ETL checks those counts on every rebuild.
4. **Undefined arithmetic is never displayed as a number.** Growth from a zero base is "New", not +Infinity%. Ratios of undefined values (EVI, RGI, averages) are "—", not NaN.
5. **One implementation per rule.** One ranking function (`rankGrowth`), one growth classifier, one formatter, one threshold file (`js/iqvia-growth-config.js`). No per-card copies.

## 2. Definitions

| Term | Definition |
|---|---|
| Reference owner | The organisation that reports the product in the **product's latest month with sales**, and is the only one reporting it in the product's **last 3 months with sales**. For a discontinued product this is its final owner. |
| Ownership transfer | A product whose history sits under a different organisation from the reference owner, where the old owner's run **ends when (or shortly after) the reference owner's continuous run begins**. Same molecule, ATC4, form and packs. |
| Effective period | The first month of the reference owner's continuous run. |
| Restatement period | The months whose rows are relabelled. By default this is every month the old owner reported the product. It can be bounded by period (`period_from`/`period_to`) or by pack (`items`) when the evidence supports only a partial transfer. |
| Temporary overlap | From the effective period onward, both organisations report the product for **≤ 6 consecutive months** per episode, and every episode **ends before the last 3 months**. The old owner's share is measured on the product's total sales across the overlap months. Rows under the reference owner **before** its continuous run are anomalies, not overlap. |
| Co-marketing / dual ownership | Both organisations report the product in the **last 3 months**, **or** they overlap for **> 6 months** with each holding **> 10 %** of the product's sales. |
| Anomaly | Stray rows under another organisation making up **< 1 %** of the product's lifetime sales, typically a single month or an unusual pack. |
| Genuine new entrant / new launch | The product (or company, or market) had **no sales under any organisation** in the prior comparison window, **after** restatement. |

## 3. Decision rules (applied per product with more than one organisation)

| Situation | Treatment | Evidence required | Approval |
|---|---|---|---|
| Transfer (acquisition, divestment, licence transfer) | Restate the old owner's rows to the reference owner | Monthly IQVIA series by organisation and pack; identical product identity | SFE Manager |
| Transfer with temporary overlap, where the old owner held ≤ 20 % of product sales in the overlap | Restate (the overlap is part of the transfer) | As above, plus an overlap table | SFE Manager |
| Transfer with temporary overlap, where the old owner held > 20 % | **Flag. Do not restate** until the business confirms the overlap is not co-marketing | As above, plus BU or external confirmation | SFE Manager + BU Head |
| Co-marketing / dual ownership | **No restatement.** Each organisation keeps its own sales. Recorded in the register as `co_marketed`, disabled | Confirmation of the arrangement | SFE Manager |
| Company rename or IQVIA re-coding (every product of X moves) | Restate every product of X, one register entry each | Proof that **all** of X's products moved | SFE Manager |
| Anomaly | Consolidate into the reference owner, tagged `anomaly_consolidation` (not a transfer) | Row listing | SFE Manager |
| Genuine new entrant | No restatement. Classified **New** | – | – |

## 4. Register fields (`corp_restatements.json`)

`id`, `enabled`, `status` (`proposed` / `approved` / `rejected` / `co_marketed`), `classification` (`transfer` / `transfer_with_overlap` / `rename` / `anomaly_consolidation`), `product`, `from_corporation` (previous), `to_corporation` (latest), `transfer_effective_period`, `restatement_period` [from, to], optional `items` (pack filter), `expected_rows`, `expected_lcv`, `evidence`, `approved_by`, `approved_on`.

The ETL applies an entry only when `enabled = true` **and** `status = approved`. It logs the actual rows and LCV and **warns if they differ from the expected values** (a sign the source changed under the mapping). It also writes the audit trail into the cache (`IQVIA_CACHE.restatements`).

**Reversal:** set `enabled: false` and re-run `refresh_iqvia.py`. **Review cadence:** after every IQVIA refresh, run the ownership-change scan (products reported under more than one organisation) and review any new candidates.

## 5. Growth classification (every IQVIA table, card and KPI)

Uses the selected metric (LCV in LCV mode, SU in SU mode) and the currently filtered market.

| Class | Condition (c = current, p = prior) | Growth cell | EVI / RGI | Rankings, counts, averages |
|---|---|---|---|---|
| Normal | p > 0, c > 0, c ≤ 11 × p | % | number | included |
| Low base | p > 0 and growth > +1,000 % (c > 11 × p) | "Low base" (the % is shown on hover) | — | excluded |
| New (launch / entrant / market) | p = 0, c > 0 | "NEW" plus current value | — | excluded, listed separately |
| Exit | p > 0, c = 0 | "Exit" | — | excluded (the share rule already covers this) |
| No sales | p = 0, c = 0 | — | — | excluded |

**Fastest Growing / Biggest Decliner** (Company, DM1, DM2, ATC4): class = Normal **and** current share ≥ `minSharePct` (0.5 %) of the filtered market. Biggest decliner must have negative growth. Thresholds live in `js/iqvia-growth-config.js`: `minSharePct` = 0.5, `lowBaseGrowthPct` = 1000 (approved).

**Implementation (single source of truth, `js/iqvia.js`):** `growthClassOf()` (class from the growth ratio), `fmtGrowth()` / `fmtGrowthTxt()` (every growth cell and sentence), `growthIndex()` / `evolutionIndex()` (RGI / EVI, null unless Normal), `eviClassLabel()` / `fmtIndexNA()` (labels for null indices), `rankGrowth()` (Fastest / Decliner). No page computes its own zero-base or Low-base handling.

**Rank movement** (Winners page): only for items ranked in both periods. New items are shown as "NEW" (and exits as "Exit"), never as climbers or fallers from a placeholder rank (#99 / #9999). Rank movement is based on rank positions, not growth %, so a Low-base item ranked in both periods still appears in the climber list; its growth cell shows "Low base".

"Excluded" in the table above means excluded from **growth-based** rankings (Fastest / Decliner), EVI/RGI outperformance counts and growth averages.

## 6. Audit trail

1. Git tag before every methodology release.
2. Register entries carry the evidence and the approval.
3. The ETL log and the cache audit array record what was applied.
4. A before/after snapshot of every affected card is kept in `Claude outputs/` for each release.
5. The raw-source MD5 is compared before and after the ETL run.

## 7. Register (as applied 2026-09-24, `corp_restatements.json` schema v2)

The effect on MAT Aug-2026 is measured on the dashboard's default view (Other Market excluded).

| ID | Product | Previous → Latest organisation | Effective | Restatement period | Rows | Sales moved (all history) | MAT Aug-26 impact | Classification | Status |
|---|---|---|---|---|---|---|---|---|---|
| OPELLA-2026-01 | BRONCHICUM, MAXILASE, TELFAST | SANOFI → OPELLA* | 2026-01 | 2021-01..2025-12 | 738 | 5,781.8 M LCV | OPELLA: N/A → 1.11 B, +0.3 %; SANOFI no longer the Biggest Decliner | transfer | approved, enabled |
| KARBALTA-2025-07 | KARBALTA | MASH* → RAMEDA* | 2025-07 | 2021-01..2025-06 | 217 | 129.8 M LCV | Prior MAT 15.07 M LCV / 2.06 M SU moves: RAMEDA +19.3 → +17.4 % LCV, MASH +18.2 → +28.1 % | transfer | approved, enabled |
| REFLUXELOC-2026-06 | REFLUXELOC | MODERN PHARMA → MODERN EGYPT PHARM | 2026-06 | 2025-06..2026-05 | 24 | 3.4 M LCV | MODERN EGYPT PHARM: New → +362 % (not ranked, 0.009 % share); new entrants 10 → 9 | transfer (likely IQVIA re-coding) | approved, enabled |
| MEROSATIN-DQ-2022-06 | MEROSATIN | REPHARMA* → SPIMACO* | n/a | 2022-06 | 1 | 30 EGP | None (product discontinued 2022-09) | anomaly_consolidation (data-quality) | approved, enabled |
| VAXATO-2021-07 | VAXATO | LIPTIS → RAMEDA* | 2021-07 | 2021-01..2022-01 (bounded) | 46 | 87.3 M LCV | None on MAT Aug-26 | transfer_bounded (Option B) | approved, enabled |

**Open item: VAXATO 2025-10..2026-03.** 11 rows (5.61 M LCV, 0.33 M SU) of the new 10MG 20 pack were reported under LIPTIS while RAMEDA* also sold it. They are **not restated** (Option B) and stay under LIPTIS until independent evidence (contract, MoH registration, BU confirmation) settles the attribution. For that reason LIPTIS appears as a **Low base** grower in MAT Aug-26 tables.

## 8. Known exceptions (not changed; each needs a decision)

1. **Zeta Competitors `isLaunch`**: an existing page rule flags a company as launch-boosted when prior sales are below 12 % of current (about +733 % growth). That differs from the approved Low-base cutoff (+1,000 %). It is kept unchanged, pending a decision to align or keep both.
2. **BCG matrix 3-year CAGR**: a zero base gives 0 % (not New), and the market CAGR falls back to a hard-coded 10 % when the base is zero. Changing this moves products between BCG quadrants, which is business logic, so it is not changed here.
3. **Growth scatter charts** (DM1 / DM2 / ATC4): Low-base points are still plotted at their raw growth (e.g. +96,282 %), which compresses the axis. Tooltips now use the class labels.
4. **Positive SU / price growth display bug** (ATC4 tables): positive values render as a bare "+" because of an operator-precedence error. This predates this work.

