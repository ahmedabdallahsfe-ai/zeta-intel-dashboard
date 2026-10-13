# Market Forecast Engine v2 — Design, Test Evidence and Deviations from the Brief

**Date:** 2026-10-12, updated 2026-10-13 (real-data run, section 6; champion-challenger engine, section 7). **Status:** LIVE. The champion engine feeds the Market Growth Forecast tab and is the `market_forecast` refresh step (`etl/build_market_forecast_v2.py --publish`). Synthetic acceptance tests pass after the champion changes.

**Files:**
- `etl/build_market_forecast_v2.py`: the engine.
- `etl/test_market_forecast_v2.py`: acceptance tests.
- `requirements-forecast-v2.txt`: libraries.

**Relationship to v1:** v1 (`etl/build_market_forecast.py`) is not replaced. Its four methods compete inside the v2 tournament, and `--publish` runs v1 first (page skeleton, history, data checks), then overlays the champion forecasts. If the forecasting libraries are missing, `--publish` keeps the champion cache while IQVIA is unchanged and otherwise publishes plain v1.

---

## 1. Pipeline (6 steps)

| Step | What happens | Key rule |
|---|---|---|
| **1. Ingest** | `cache/iqvia.json` → monthly Standard Units per DM1. BU and Line aggregates use the same rule as the dashboard (the DM1s where Zeta has products of that BU or Line) | One input contract with v1, so market definitions are identical |
| **2. Signal** | Robust STL (period 12) on **log** units. Only the residual is capped at +40% / −40%; trend and seasonality are untouched. A **dated growth-break detector** runs on every continuous market | Raw data is kept for display; only the model input is cleaned |
| **3. Route** | Under 24 months of sales → **launch**. ADI > 1.32 → **intermittent**; with CV² > 0.49 as well → **lumpy**. Everything else → **continuous** | Syntetos–Boylan thresholds |
| **4. Forecast + test** | Launch → Bass uptake (falls back to logistic), with a run-rate safeguard. Intermittent → Croston SBA. Continuous → a **tournament**: Prophet (log, automatic), Prophet (log, break-guided), AutoETS, AutoTheta, seasonal-naive | Rolling-origin test on the 12-month total, with no future data visible. Lowest error wins; Prophet is kept on a near-tie (within 5%) |
| **5. Reconcile** | MinT (shrinkage) over an explicit summing matrix: DM1 → BU / Line → Egypt. Launch and intermittent markets are **locked** | Exact coherence is asserted on every run |
| **6. Range + explain** | Annual Low/Base/High: the model's own distribution, calibrated on its test record, floored at its typical miss, then moved with MinT. `generate_business_insights()` turns the metadata into plain English | No statistical terms in the text; every sentence is triggered by a computed value |

---

## 2. Test evidence (synthetic markets with a known truth)

| Test | Result |
|---|---|
| Growth-break dating (10 markets with a known break) | 10/10 found, 8/10 within 4 months, growth before and after recovered within about 2 points |
| False alarms (30 steady markets) | 0/30 (1/30 at double the noise) |
| Prophet's own changepoints as a dating tool | Unreliable: dates 6–21 months off, false alarms in 5 of 6 steady markets |
| FY error, break markets: automatic Prophet vs break-guided Prophet | 8.2% vs **2.9%** |
| Raw-scale vs log-scale Prophet (6 markets) | Bias −3.9% vs **−1.6%**; monthly 80% coverage 34% vs 66% |
| Annual 80% range, 20 markets | Native Prophet **50%** → calibrated + floor **80%** (median width 23% of base) |
| MinT with overlapping BUs | Exact. Before reconciliation, Egypt differed from the sum of its markets by about 9,700 units; after, by 0 |
| MinT without locking | Moved a small intermittent market by **+162%**; with locking, 0% |
| Launch curve on a market still rising | Without the safeguard, a decline was forecast; with it, the forecast holds at least the current run-rate |
| Insights | No statistical terms; YTD growth is suppressed for launch markets (it showed "+2,240%") |

---

## 3. Deviations from the original brief, and why

1. **Prophet competes; it isn't the default for every continuous market.** On monthly data of this length it doesn't reliably beat AutoETS or Theta. A steady test market chose AutoETS (3.4% error).

2. **Prophet runs on log units.** A linear trend on raw units under-forecasts markets growing by a steady percentage, which is the under-forecasting problem itself.

3. **Prophet's changepoints are not used to explain the forecast.** They fail at dating a shift. A dedicated break detector supplies the date and the growth before and after. It also guides Prophet: one allowed trend change at the detected break gave about 3× lower error.

4. **Native intervals are kept, but they're calibrated, not trusted as-is.** Prophet's annual 80% range covered the truth only 50% of the time. With a single changepoint the range shrinks to about ±2%. Each market's range is widened by the factor its own test record needs, and is never narrower than its typical past miss.

5. **Locked markets.** MinT gives the biggest adjustments to the noisiest series. Launch and intermittent markets therefore keep their own forecast, and the continuous markets absorb the alignment. If alignment moves any market by more than 5%, it is flagged for review.

6. **The hierarchy is not a tree.** PPI _ORAL_SOLID FORM sits in both GIT and Non-Promoted, and OTHER MARKET sits in two BUs. The summing matrix is built explicitly, so every BU equals the sum of its own DM1s exactly. **The BU totals added together will not equal Egypt.** That is already true in the dashboard today.

7. **DM2 is outside the reconciled hierarchy.** DM2 cuts across DM1, so a DM2 can't be built from whole DM1s. Options:
   - reconcile DM2 separately against Egypt;
   - use DM1 × DM2 cells as the bottom level.

8. **Launch uptake needs a business input.** With fewer than 24 points the Bass "market potential" can't be pinned down from data alone. It is capped at 6× the units sold to date, and the page states this as an assumption. Brand-team patient potential or analog launches should replace the cap.

9. **Croston will rarely trigger on this data.** IQVIA Egypt is a retail audit and doesn't capture tenders or institutional purchasing. Today the zero months come from launches, not intermittent buying.

10. **"Eliminate under-forecasting" is only partly within reach.** Log trends and break guidance cut the bias sharply in tests (to about −1.6% for log-scale Prophet). But a model fitted to an acceleration will over-forecast if the acceleration fades, as it would if the 2024 surge was partly stock-building. The tournament and the bias warnings are the protection.

---

## 4. Run time and operations

- **Run time:** about 10–25 seconds per continuous series (5 candidate models × 11 test origins). Roughly 15–30 minutes for the full set of about 57 DM1 + BU + Line series, against 17 seconds for v1.
  - Mitigation: parallel fitting with joblib; run only when IQVIA changes (it's monthly).
- **Installation:** a separate virtual environment (`requirements-forecast-v2.txt`). Prophet brings its own Stan compiler (CmdStan).
- **Promotion gate:**
  1. Run v2 and v1 on the real cache.
  2. Compare test error, bias and coverage market by market.
  3. Review with the SFE Manager.
  4. Only then add a `market_forecast_v2` step to `config/refresh_map.json`, and point the tab at the v2 output.

## 5. `generate_business_insights` input contract

`market, level, segment, model, months_of_sales, growth_pct, low_pct, high_pct, hist_growth_pct, recent_growth_pct, ytd_growth_pct, trend_break{date, direction, growth_before_pct, growth_after_pct}, recent_trend_pct, adjustments[{period, type, pct}], seasonal, peak_months, uptake{phase, share_of_potential_reached, floored_at_run_rate}, reconciliation{base_total, reconciled_total, parent, children, locked}, backtest{n, bias, coverage, calib}, interval_width_pct, range_widened, data_flags[]`

**Returns:** `{headline, drivers[], assumptions[], watch_outs[]}`.

---

## 6. Real-data validation (2026-10-13, cache/iqvia.json, data to Aug-2026)

**Setup:** 58 series (34 DM1 + 6 BU + 17 Line + Egypt). v1's chosen method and v2's chosen method are scored on the **same** test windows: every 2nd month-end from Dec-2023 to Aug-2025, 12-month totals, against the raw IQVIA actuals. Both engines picked their method on these same tests, so both numbers are slightly optimistic.

**Fixes made because of the real data, applied before the final numbers below:**

1. **Prophet settings:** yearly Fourier order 10 → 3, and trend flexibility back to the library defaults (0.05 / 0.8). The earlier setting over-fitted (BU Cluster test error 13.6% → 7.5%). Not tuned further on the test set.
2. **Launch curve fitted to monthly volume, not new adopters.** Textbook Bass on monthly units forecast **−91%** for ZKARDOVAL HCT, a chronic market on a plateau. Volume follows patients **on** therapy. The curve now rises to a peak monthly volume (capped at 4× today's run-rate) and stays there. Recent months weigh more, and the Low end always includes a "stays at today's rate" scenario.
3. **MinT on DM1 → BU → Egypt only; Lines are summed from the aligned DM1s.** With the 17 overlapping Lines as extra constraints, 3 DM1s moved by more than 10% (max +16%). Without them, none moves by more than 10% (max −9.2%).
4. **Tests score against raw actuals.** Previously the scoring used the cleaned series, which flattered v2 wherever spikes had been capped.

**Results (volume-weighted WAPE and bias on 12-month totals):**

| Level | Markets | WAPE v1 → v2 | Bias v1 → v2 | Median market WAPE v1 → v2 | v2 better |
|---|---|---|---|---|---|
| Egypt total | 1 | 4.3% → **1.7%** | −4.3% → **+0.4%** | | yes |
| BU (all 6) | 6 | 4.5% → **3.0%** | −4.3% → **+0.7%** | 5.0% → 4.6% | 5/6 |
| Promoted BUs (CHC, Cluster, DIAB, GIT) | 4 | 5.8% → 5.8% | −3.9% → +2.0% | 6.0% → 6.1% | 3/4 |
| Line | 17 | 4.8% → **3.2%** | −4.3% → +0.2% | 7.3% → 6.8% | 10/17 |
| DM1 (all) | 33 | 5.1% → **4.1%** | −4.1% → −0.1% | 9.9% → **12.4%** | 18/33 |
| DM1 excluding OTHER MARKET | 32 | 8.6% → 8.4% | −3.8% → −3.7% | 10.9% → 12.4% | 17/32 |

**Reading:**
- v2 fixes the **national and residual-market** bias, because OTHER MARKET is about 85% of units.
- On the **promoted markets** it is a wash on average. It is better on young and launch-type markets: the Zetacolest pair, A10P9, ONLY_DOZOVA, MEDIHYALO, BISMUTH. It is worse on several established ones: P-CAB 3.5% → 9.9%, Melatonin 4.2% → 12.8%, Lacosamide 7.9% → 11.9%, Flexeta 7.7% → 13.1%, A10P5 18.9% → 25.2%.

**Recommendation:** do not replace v1 wholesale. Put v1's best methods (MED / A / B / C1) into v2's competition, so each market keeps whichever engine forecasts it best. Re-run this comparison, then promote.

**Growth breaks in the real data:**
- The national acceleration began in **Feb 2023** (Egypt growth ~0% → +8% a year; GIT +2% → +18%; PPI oral solid −1% → +14%), not 2024.
- 2024 breaks: A10P5 (Jan 2024), Flexeta (Mar 2024, slowdown), Vortaxmode (Apr 2024), Esomeprazole sachet (Jun 2024).

**MinT check (FY2027, real data):**
- Egypt and every BU equal the exact sum of their DM1s (gap 0).
- PPI _ORAL_SOLID FORM sits in both GIT and Non-Promoted and is counted in both. The BU totals added together (39.5 B SU) are not the Egypt total (21.4 B SU).
- The only locked market is ZKARDOVAL HCT (the only DM1 under 24 months).

**Open risks:**
- **BU CHC FY2027 +90%** (v1 +43%), driven by MAN_WOMEN_MULTI_VIT. That market's v2 test error is 22.5% and it under-forecast by 20% in tests. Needs a brand-team review before anyone uses it.
- **DIAB +23% vs v1 +15%.**
- **ZKARDOVAL HCT +33%** (v1 +0.5%): the curve's parameters sit at their bounds, so the shape is weakly determined.
- **Run time:** about 6 minutes on 2 cores for the whole set.

---

## 7. Champion-challenger engine (2026-10-13, live)

**Rules:**
- Every continuous market runs one tournament: v1 methods (Recent 2-yr CAGR, Holt damped, Historical CAGR, Linear trend), v2 models (Prophet, Prophet-guided, AutoETS, AutoTheta) and the seasonal-naive benchmark.
- Eligible methods have at least max(4, 80% of the most-tested method's) test origins. Lowest 12-month WAPE wins; a v2 model keeps the pick only on a near-tie (within 5% relative).
- **Safeguard:** if the winner's past error is above 15%, the forecast is the middle (median) of all tested methods' paths, and FY growth is capped between 0 and the latest 12-month growth (MAT). The market is always Lower confidence.
- Launch (<24 months) and intermittent markets keep their own routes and stay locked in MinT. MinT runs on DM1 → BU → Egypt. Lines and DM2 are not reconciled: Lines are sums of aligned DM1s, DM2 stands alone.

**Winners (96 series; 58 in the hierarchy):**

| Level | Series | v1 method | v2 model | Benchmark | Launch curve | Safeguard |
|---|---|---|---|---|---|---|
| DM1 | 34 | 8 | 11 | 2 | 1 | 12 |
| BU | 6 | 1 | 4 | – | – | 1 |
| Line | 17 | 4 | 9 | 1 | – | 3 |
| Egypt | 1 | – | 1 (Prophet-guided) | – | – | – |
| DM2 | 38 | 10 | 12 | 2 | 1 | 13 |

**Confidence mix:** 18 Higher, 22 Moderate, 56 Lower.

**Accuracy, same test windows (in-sample selection, slightly optimistic):**

| Level | v1 | v2 | Champion |
|---|---|---|---|
| Egypt | 4.3% / bias −4.3% | 1.7% / +0.4% | 1.7% / +0.4% |
| BU | 4.5% | 3.0% | 3.0% / +0.1% |
| Line | 4.8% | 3.2% | 3.2% |
| DM1 excluding OTHER MARKET | 8.6% / −3.8% | 8.4% | 8.7% / −4.5% |

**Out-of-sample check:** methods were chosen on test origins Dec-23..Oct-24 and scored on Dec-24..Aug-25.

| Level | v1 | Champion |
|---|---|---|
| DM1 excluding OTHER MARKET (27) | 11.0% / −8.6% | **8.8% / −6.4%** |
| Promoted BUs | 9.9% | **8.8%** |
| Lines | 4.4% | **4.1%** |
| Egypt | 4.4% | **2.4%** |
| DM1 including OTHER MARKET | **4.3%** | 4.9% |

**Safeguard examples:**
- CHC +39.8% (v1 +42.6%; v2 alone had +90%).
- MAN_WOMEN_MULTI_VIT +30.1%.
- CoQ10 capped at its 12-month growth of +172%.
- Zetacolest Plus: best method missed by 986%; the middle of all methods gives +69%.

**FY2027 headlines:**
- Egypt +8.4% (range +5.7..+11.8, Prophet-guided, Higher)
- GIT +16.4% (Recent 2-yr CAGR, Moderate)
- Cluster +10.1% (AutoETS, Higher)
- DIAB +25.2% (AutoTheta)
- Non-Promoted +6.4%
- PPI oral solid +9.4%
- P-CAB +55.5%
- ZKARDOVAL HCT +33.1% (launch curve, range −7.7..+68.8)

**Operations:**
- `--publish` takes about 4 minutes on 2 cores (container) for 96 series.
- The forecast is identical to the reviewed run (max growth difference 0.0 points, same method in all 96).
- Coherence is asserted for Egypt and every BU on every run.
- The `--publish` path was tested with the libraries missing (champion cache kept, exit 0) and with a deliberately failed champion step (fresh v1 cache kept).

**Open risks:**
- 25 of 34 DM1s are not Higher confidence; 12 DM1s needed the safeguard. These are the volatile, young or promotion-driven markets. Treat them as directional and review with brand teams.
- The out-of-sample bias is still negative (−6.4% on promoted DM1s), so the engine under-forecasts less than v1 but still under-forecasts.
- The Windows refresh needs `pip install -r requirements-forecast-v2.txt` once. Until then the champion cache is kept only until the next IQVIA update, then v1 is published.

**Fixes after review (2026-10-13 pm):**
- **Safeguard ranges.** These used the best method's own past misses (above 15% by definition, up to 986%), which gave bands such as Zetacolest Plus −100%..+6,500,000%. The range is now the 20th–80th percentile of the tested methods' FY projections, never above today's 12-month growth (MAT), and always containing the base. Zetacolest Plus is now +13%..+168% and CoQ10 +18%..+175%. 29 safeguard series are affected; no base figure changed.
- **Prophet ranges are now reproducible.** A fixed random seed is set before the simulated paths, so the same data gives the same range. Previously, two runs moved some ranges by up to 33 points (e.g. Brexpiprazole DM2 high).
