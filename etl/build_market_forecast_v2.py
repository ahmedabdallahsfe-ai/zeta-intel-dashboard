"""
build_market_forecast_v2.py  --  NEXT-GENERATION MARKET FORECAST ENGINE (2026-10-12)

STATUS (2026-10-13): CHAMPION-CHALLENGER engine feeding the live "Market Growth Forecast" tab.
v1's methods (etl/build_market_forecast.py) compete with the v2 models per market; lowest backtest error wins.
  python etl/build_market_forecast_v2.py --publish   dashboard refresh step (falls back to v1 safely)
  python etl/build_market_forecast_v2.py             review JSON -> "Claude outputs/Market Forecast v2/"
Same input contract as v1: cache/iqvia.json (Standard Units).

SIX STEPS
  1. Ingest          cache/iqvia.json -> long table [unique_id, ds, y] at DM1 level + aggregate maps
  2. Signal          robust STL on log units; winsorise ONLY the residual beyond +-40% (raw kept for display);
                     dated growth-break detector (piecewise trend) for every continuous market
  3. Route           launch (<24 m) -> Bass/logistic uptake (+run-rate safeguard) | intermittent (ADI/CV2)
                     -> Croston SBA | continuous -> tournament
  4. Forecast+test   Prophet (log units, automatic) and Prophet (log units, break-guided) vs AutoETS / AutoTheta /
                     seasonal-naive; leak-free rolling-origin test on the 12-month total picks the model
  5. Reconcile       MinT (shrinkage) over an explicit summing matrix S (DM1 -> BU / Line -> Egypt);
                     launch + intermittent markets locked, exact coherence asserted
  6. Explain+publish annual Low/Base/High (model distribution -> calibrated on its own test record ->
                     floor at its typical miss -> moved with MinT), generate_business_insights()

Tested 2026-10-12 with test_market_forecast_v2.py on synthetic markets (prophet 1.5.0, statsforecast 2.1.1,
hierarchicalforecast 1.5.3, statsmodels 0.15.0, scipy 1.18.1):
  * break dating 10/10 found, 8/10 within 4 months, 0/30 false alarms
  * break-guided Prophet FY error |2.9%| vs |8.2%| for automatic changepoints (10 break markets)
  * log-scale vs raw-scale Prophet: bias -1.6% vs -3.9%
  * annual 80% range coverage: native Prophet 45-50% -> calibrated + floor 80%
Real-data run 2026-10-13 and the fixes it triggered: DESIGN_market_forecast_v2.md section 6.
  * MinT exact coherence with overlapping BUs; locked launch / intermittent markets unmoved
Deliberate deviations from the original brief are documented in DESIGN_market_forecast_v2.md.
"""
from __future__ import annotations

import base64
import gzip
import json
import math
import os
import sys
import warnings
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = {
    "freq": "MS",
    "target_year_offset": 1,          # forecast FY(origin year + 1)
    "level": 80,                      # prediction-interval level (%)
    # Step 2 - signal extraction
    "stl_min_months": 24,
    "winsor_up": math.log(1.40),      # residual cap +40% (log space)
    "winsor_down": math.log(0.60),    # residual floor -40%
    # Step 3 - routing (Syntetos-Boylan)
    "launch_months": 24,
    "adi_cut": 1.32,
    "cv2_cut": 0.49,
    # Step 3a - uptake curve guard-rails (MONTHLY coefficients)
    "bass_p": (1e-4, 0.02),
    "bass_q": (0.005, 0.30),
    "max_peak_multiple": 4.0,         # launch peak monthly volume <= 4x current run-rate (business assumption)
    "uptake_bootstrap": 200,
    # Step 4 - Prophet
    # Prophet library defaults for trend flexibility (0.05 / 0.8) + yearly Fourier order 3 for ~4-5 years of
    # monthly data. Real-data check 2026-10-13: the earlier, more flexible setting (order 10, 0.10 / 0.9)
    # over-fitted badly (BU Cluster test error 13.6% vs 7.5%). Not tuned further on the test set on purpose.
    "prophet": {"changepoint_prior_scale": 0.05, "changepoint_range": 0.80, "yearly_order": 3,
                "n_changepoints": 15, "uncertainty_samples": 1000},
    "changepoint_min_abs": 0.05,      # |delta| on Prophet's log-trend (0.05 ~ 5% change in growth rate)
    "changepoint_rel_share": 0.30,    # ...and >= 30% of the largest shift in that market
    "seasonal_min_amplitude": 0.08,   # peak-to-trough >= 8% to call a market seasonal
    "prophet_tie_margin": 0.05,       # a v2 method keeps a near-tie: within 5% of the best backtest error
    "volatile_wape": 0.15,            # safeguard: top method still missed by >15% -> consensus, capped at MAT growth
    "break_min_segment": 12,          # >= 12 months on each side of a growth break
    "break_bic_gain": 10.0,           # evidence margin vs a single straight line
    "break_min_change_pts": 3.0,      # growth must change by >= 3 pts a year to count
    "guided_prior": 0.5,              # Prophet flexibility at the detected break only
    "range_floor_quantile": 0.50,     # range never narrower than this market's typical (median) past miss
    "lock_segments": ("launch", "intermittent", "lumpy"),
    # 2026-10-13 (Ahmed approved): ALSO lock "trusted" DM1s in the alignment - established, tested 10+ times,
    # past error <= 6%, |bias| <= 3%, top methods within 6 pts, no safeguard (= the "Higher" confidence rule).
    # Before this, MinT cut A10P1 SGLT2 plain from +15.8% to +5.8% to absorb two capped combination markets.
    # Now the less reliable markets absorb the alignment; totals still add up exactly.
    "lock_trusted": True,
    # MinT runs on DM1 -> BU -> Egypt (the business hierarchy); Lines are then the exact sum of their
    # reconciled DM1s. Real-data check 2026-10-13: adding the 17 overlapping Lines as extra MinT
    # constraints pushed 3 DM1s by >10% (max +16%); without them none moves >10% (max 7.4%).
    "mint_levels": ("Egypt", "BU"),   # kept as forecast; reconciliation adjusts the rest
    "backtest_step": 2,               # test every 2nd month-end (11 origins) to keep run time ~minutes
    "backtest_first_origin": 35,      # month index (Dec-2023)
    "backtest_h": 12,
}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# =====================================================================================
# STEP 1 - INGEST
# =====================================================================================
def load_iqvia_dm1(path: str):
    """Return (Y_df [unique_id, ds, y] for every DM1, aggregates {agg_id: [dm1 ids]}).
    Identical market definitions to refresh_iqvia.py / v1: BU or Line market = the DM1s in
    which Zeta has products of that BU / Line."""
    d = json.load(open(path, encoding="utf-8"))
    L = d["lookups"]
    flat = np.array(json.loads(gzip.decompress(base64.b64decode(d["b64Data"]))), dtype=np.int64).reshape(-1, 14)
    CI, TI, D1I, SI, LINEI, BUI = 0, 2, 4, 7, 8, 9
    periods = pd.to_datetime(L["periods"], format="%Y-%m")
    rows = []
    for i, name in enumerate(L["dm1s"]):
        if name == "(none)":
            continue
        m = flat[:, D1I] == i
        y = np.bincount(flat[m, TI], weights=flat[m, SI], minlength=len(periods))
        rows.append(pd.DataFrame({"unique_id": f"DM1/{name}", "ds": periods, "y": y.astype(float)}))
    Y = pd.concat(rows, ignore_index=True)

    zeta = L["corps"].index("ZETA PHARM*")
    zr = flat[flat[:, CI] == zeta]
    aggs = {"Egypt": sorted(Y["unique_id"].unique())}
    for typ, col, lk in (("BU", BUI, "bus"), ("Line", LINEI, "lines")):
        for i, n in enumerate(L[lk]):
            if n in ("(none)", ""):
                continue
            members = sorted({f"DM1/{L['dm1s'][x]}" for x in zr[zr[:, col] == i, D1I].tolist()})
            if members:
                aggs[f"{typ}/{n}"] = members
    return Y, aggs


def load_iqvia_dm2(path: str):
    """DM2 markets as standalone series (DM2 cuts across DM1, so they sit outside the aligned
    hierarchy and are forecast on their own)."""
    d = json.load(open(path, encoding="utf-8"))
    L = d["lookups"]
    flat = np.array(json.loads(gzip.decompress(base64.b64decode(d["b64Data"]))), dtype=np.int64).reshape(-1, 14)
    periods = pd.to_datetime(L["periods"], format="%Y-%m")
    out = {}
    for i, name in enumerate(L["dm2s"]):
        if name == "(none)":
            continue
        msk = flat[:, 5] == i
        if msk.any():
            out[f"DM2/{name}"] = np.bincount(flat[msk, 2], weights=flat[msk, 7], minlength=len(periods)).astype(float)
    return out, periods


# =====================================================================================
# STEP 2 - SIGNAL EXTRACTION (robust STL + residual winsorisation)
# =====================================================================================
def extract_signal(y: np.ndarray, cfg=CFG):
    """Clean model input. Trend + seasonality are untouched (winter peaks survive); only the
    irregular part beyond +-40% is capped. Returns (y_clean, adjustments)."""
    from statsmodels.tsa.seasonal import STL

    y = np.asarray(y, float)
    pos = np.flatnonzero(y > 0)
    adjustments = []
    if len(pos) == 0:
        return y.copy(), adjustments
    s = pos[0]
    z = y[s:]
    if len(z) < cfg["stl_min_months"] or (z <= 0).any():
        return y.copy(), adjustments                      # too short / gaps: leave untouched
    lz = np.log(z)
    res = STL(lz, period=12, robust=True).fit()
    resid = res.resid
    capped = np.clip(resid, cfg["winsor_down"], cfg["winsor_up"])
    lz_clean = res.trend + res.seasonal + capped
    y_clean = y.copy()
    y_clean[s:] = np.exp(lz_clean)
    for k in np.flatnonzero(capped != resid):
        adjustments.append({"index": int(s + k), "raw": float(z[k]), "clean": float(np.exp(lz_clean[k])),
                            "type": "spike" if resid[k] > 0 else "dip",
                            "pct": float(np.exp(resid[k]) - 1)})
    return y_clean, adjustments


def detect_trend_break(y: np.ndarray, cfg=CFG):
    """Single structural break in the growth rate (piecewise-linear trend on de-seasonalised log
    units, continuous at the break). Accepted only if it beats a single straight line by a clear
    information-criterion margin AND growth changes by >= min_change_pts a year.
    Tested on synthetic markets: 10/10 known breaks found (8/10 within 4 months, growth before /
    after recovered within ~2 pts), 0/30 false alarms on steady markets (1/30 at double noise).
    Used (a) to guide Prophet and (b) as the dated fact behind the 'acceleration since...' insight
    -- Prophet's own changepoint weights proved unreliable for DATING a shift (5/6 false alarms)."""
    from statsmodels.tsa.seasonal import STL

    y = np.asarray(y, float)
    pos = np.flatnonzero(y > 0)
    if len(pos) == 0:
        return None
    s = int(pos[0]); z = np.log(_positive(y[s:])); n = len(z); ms = cfg["break_min_segment"]
    if n < 2 * ms + 6:
        return None
    x = z - STL(z, period=12, robust=True).fit().seasonal
    t = np.arange(n, dtype=float)
    X0 = np.c_[np.ones(n), t]
    sse0 = float(((x - X0 @ np.linalg.lstsq(X0, x, rcond=None)[0]) ** 2).sum())
    best = None
    for k in range(ms, n - ms):
        X = np.c_[np.ones(n), t, np.maximum(0.0, t - k)]
        b = np.linalg.lstsq(X, x, rcond=None)[0]
        sse = float(((x - X @ b) ** 2).sum())
        if best is None or sse < best[1]:
            best = (k, sse, b)
    k, sse, b = best
    gain = (n * math.log(sse0 / n) + 2 * math.log(n)) - (n * math.log(sse / n) + 4 * math.log(n))
    g0, g1 = (math.exp(12 * b[1]) - 1) * 100, (math.exp(12 * (b[1] + b[2])) - 1) * 100
    if gain < cfg["break_bic_gain"] or abs(g1 - g0) < cfg["break_min_change_pts"]:
        return None
    return {"index": s + k, "direction": "acceleration" if g1 > g0 else "slowdown",
            "growth_before_pct": round(g0, 1), "growth_after_pct": round(g1, 1), "evidence": round(gain, 1)}


# =====================================================================================
# STEP 3 - SEGMENTATION / ROUTING
# =====================================================================================
def classify_demand(y: np.ndarray, cfg=CFG) -> dict:
    y = np.asarray(y, float)
    pos = np.flatnonzero(y > 0)
    if len(pos) == 0:
        return {"segment": "no_sales"}
    life = len(y) - pos[0]                                # months since first recorded sale
    z = y[pos[0]:]
    nz = z[z > 0]
    adi = len(z) / len(nz)                                # average demand interval
    cv2 = (nz.std() / nz.mean()) ** 2 if len(nz) > 1 and nz.mean() > 0 else 0.0
    if life < cfg["launch_months"]:
        seg = "launch"
    elif adi > cfg["adi_cut"]:
        seg = "intermittent" if cv2 <= cfg["cv2_cut"] else "lumpy"
    else:
        seg = "continuous"
    return {"segment": seg, "months_of_sales": int(life), "adi": round(adi, 3), "cv2": round(cv2, 3)}


# =====================================================================================
# STEP 4 - MODELS (every model returns the same contract)
# =====================================================================================
@dataclass
class Fit:
    model: str
    mean: np.ndarray                  # h future months
    lo: np.ndarray                    # monthly lower bound (level %)
    hi: np.ndarray                    # monthly upper bound (level %)
    fitted: np.ndarray                # in-sample fitted values (same length as history) - needed by MinT
    info: dict = field(default_factory=dict)
    samples: np.ndarray | None = None  # (n_samples, h) future paths when the model provides them


def _positive(y):
    y = np.asarray(y, float)
    floor = max(1.0, 0.5 * y[y > 0].min()) if (y > 0).any() else 1.0
    return np.where(y > 0, y, floor)


def _cluster_changepoints(dates, delta, cfg=CFG):
    """Keep only material trend shifts: |delta| >= max(abs floor, share of the largest shift)."""
    mx = float(np.abs(delta).max()) if len(delta) else 0.0
    thr = max(cfg["changepoint_min_abs"], cfg["changepoint_rel_share"] * mx)
    return [{"date": pd.Timestamp(c).strftime("%Y-%m"), "direction": "acceleration" if dv > 0 else "slowdown",
             "strength": round(float(dv), 4)} for c, dv in zip(dates, delta) if abs(dv) >= thr and mx > 0]


def fit_prophet(ds: pd.DatetimeIndex, y: np.ndarray, h: int, cfg=CFG, with_samples=True, guided=False) -> Fit:
    """Prophet on LOG units: a linear trend in log space is constant % growth, which is how
    pharma volume markets behave. (Tested: raw-scale Prophet under-forecast exponential markets
    by ~4% with 34% interval coverage; log-scale cut the bias to ~-1.6%, coverage 66% before
    calibration.) Seasonality is additive in log space = multiplicative in units."""
    import logging
    from prophet import Prophet
    logging.getLogger("cmdstanpy").setLevel(logging.ERROR)

    yp = _positive(y)
    df = pd.DataFrame({"ds": ds, "y": np.log(yp)})
    p = cfg["prophet"]
    # guided = one trend change allowed, placed where detect_trend_break() finds it (computed on
    # the data passed in, so inside the backtest it only sees data up to each origin). Tested on
    # synthetic break markets: FY error |2.9%| guided vs |8.2%| automatic changepoints.
    brk = detect_trend_break(y, cfg) if guided else None
    if brk is not None:
        cp_kw = {"changepoints": [ds[brk["index"]]], "changepoint_prior_scale": cfg["guided_prior"]}
    else:
        cp_kw = {"n_changepoints": p["n_changepoints"], "changepoint_range": p["changepoint_range"],
                 "changepoint_prior_scale": p["changepoint_prior_scale"]}
    m = Prophet(growth="linear", yearly_seasonality=p["yearly_order"], weekly_seasonality=False, daily_seasonality=False,
                seasonality_mode="additive", interval_width=cfg["level"] / 100,
                uncertainty_samples=p["uncertainty_samples"], **cp_kw)
    m.fit(df)
    fut = m.make_future_dataframe(periods=h, freq=cfg["freq"])
    np.random.seed(cfg.get("seed", 20261012))     # Prophet's simulated ranges: same data -> same range
    fc = m.predict(fut)
    n = len(y)
    delta = np.asarray(m.params["delta"]).mean(axis=0)
    cps = _cluster_changepoints(m.changepoints, delta, cfg)
    # current momentum = slope of the log trend over the last 12 fitted months, annualised
    tr = fc["trend"].values
    recent_trend_pct = float((np.exp(tr[n - 1] - tr[n - 13]) - 1) * 100) if n >= 13 else None
    yearly = fc["yearly"].values[n - 12:n]                       # log-scale seasonal effect, last 12 months
    months = [d.month for d in fc["ds"].iloc[n - 12:n]]
    amp = float(np.exp(yearly.max() - yearly.min()) - 1)
    peak_months = [months[i] for i in np.argsort(yearly)[-2:][::-1]] if amp >= cfg["seasonal_min_amplitude"] else []
    samples = None
    if with_samples:
        np.random.seed(cfg.get("seed", 20261012))
        samples = np.exp(m.predictive_samples(fut)["yhat"][n:].T)   # (n_samples, h)
    return Fit("Prophet-guided" if brk is not None else "Prophet", np.exp(fc["yhat"].values[n:]), np.exp(fc["yhat_lower"].values[n:]),
               np.exp(fc["yhat_upper"].values[n:]), np.exp(fc["yhat"].values[:n]),
               {"changepoints": cps, "guided_break": brk, "seasonal": bool(peak_months), "peak_months": peak_months,
                "seasonal_amplitude_pct": round(amp * 100, 1), "recent_trend_pct": recent_trend_pct},
               samples)


def fit_statsforecast(ds, y, h, uid, cfg=CFG, models=("AutoETS", "AutoTheta", "SeasonalNaive", "CrostonSBA")) -> dict[str, Fit]:
    """AutoETS, AutoTheta, SeasonalNaive, CrostonSBA in one call (tested statsforecast 2.1.1).
    CrostonSBA has no native interval -> conformal intervals from 2 rolling windows."""
    from statsforecast import StatsForecast
    from statsforecast.models import AutoETS, AutoTheta, SeasonalNaive, CrostonSBA
    from statsforecast.utils import ConformalIntervals

    lib = {"AutoETS": lambda: AutoETS(season_length=12, model="ZZZ"), "AutoTheta": lambda: AutoTheta(season_length=12),
           "SeasonalNaive": lambda: SeasonalNaive(season_length=12), "CrostonSBA": lambda: CrostonSBA()}
    df = pd.DataFrame({"unique_id": uid, "ds": ds, "y": np.asarray(y, float)})
    sf = StatsForecast(models=[lib[k]() for k in models], freq=cfg["freq"], n_jobs=1)
    lvl = cfg["level"]
    fc = sf.forecast(df=df, h=h, level=[lvl], fitted=True, prediction_intervals=ConformalIntervals(h=h, n_windows=2))
    ins = sf.forecast_fitted_values()
    out = {}
    for name in models:
        out[name] = Fit(name, fc[name].values.clip(min=0), fc[f"{name}-lo-{lvl}"].values.clip(min=0),
                        fc[f"{name}-hi-{lvl}"].values, np.nan_to_num(ins[name].values, nan=0.0), {})
    return out


# ---- v1 methods (ported from etl/build_market_forecast.py so they compete in the same tournament) ----
_HA = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
_HB = np.array([0.01, 0.05, 0.1, 0.2, 0.3])
_HF = np.array([0.80, 0.85, 0.90, 0.95, 0.98])
_GA, _GB, _GF = [g.ravel() for g in np.meshgrid(_HA, _HB, _HF, indexing="ij")]


def _v1_seasonal_indices(x, months0, perms=200, seed=20261012):
    """v1 rule: ratio-to-2x12 centred MA indices + permutation F-test (p<0.05 -> seasonal)."""
    n = len(x)
    if n < 36:
        return None, None
    ratios, months = [], []
    for i in range(6, n - 6):
        cma = (0.5 * x[i - 6] + x[i - 5:i + 6].sum() + 0.5 * x[i + 6]) / 12.0
        if cma > 0:
            ratios.append(x[i] / cma); months.append((months0 + i) % 12)
    r, g = np.array(ratios), np.array(months); N = len(r)
    if N < 24 or len(set(g.tolist())) < 12:
        return None, None
    def F(lbl):
        cn = np.bincount(lbl, minlength=12); sm = np.bincount(lbl, weights=r, minlength=12)
        mu = sm / np.maximum(cn, 1); ssb = (cn * (mu - r.mean()) ** 2).sum(); ssw = ((r - mu[lbl]) ** 2).sum()
        return (ssb / 11) / (ssw / (N - 12)) if ssw > 0 else np.inf
    rng = np.random.default_rng(seed); f0 = F(g)
    p = (sum(F(rng.permutation(g)) >= f0 for _ in range(perms)) + 1) / (perms + 1)
    cn = np.bincount(g, minlength=12); sm = np.bincount(g, weights=r, minlength=12)
    si = sm / np.maximum(cn, 1)
    return si / si.mean(), p


def _v1_holt(z_pos, h):
    z = np.log(z_pos); n = len(z)
    if n < 24:
        return None
    l = np.full(_GA.shape, z[:12].mean()); b = np.full(_GA.shape, (z[12:24].mean() - z[:12].mean()) / 12.0)
    l = l - b * 5.5; sse = np.zeros(_GA.shape)
    for i in range(n):
        f = l + _GF * b; e = z[i] - f
        if i >= 12:
            sse += e * e
        ln = _GA * z[i] + (1 - _GA) * f; b = _GB * (ln - l) + (1 - _GB) * _GF * b; l = ln
    k = int(np.argmin(sse)); cum = np.cumsum(_GF[k] ** np.arange(1, h + 1))
    return np.exp(l[k] + cum * b[k])


def fit_v1_methods(ds, y, h, cfg=CFG) -> dict:
    """v1's four core methods on the same data: Historical CAGR (longest whole-year span <= 4 yrs),
    Recent 2-yr CAGR, Linear trend on annual totals, Holt damped (monthly, log, seasonal if
    significant). No native range -> the range comes from the method's own past misses."""
    y = np.asarray(y, float); t = len(y) - 1
    pos = np.flatnonzero(y > 0)
    if len(pos) == 0 or y[t] <= 0:
        return {}
    s = t
    while s - 1 >= 0 and y[s - 1] > 0:
        s -= 1
    n_run = t - s + 1
    mat = lambda i: float(y[i - 11:i + 1].sum())
    M0 = mat(t)
    def ratio_path(r1, r2):
        return np.array([y[t + k - 12] * r1 if k <= 12 else y[t + k - 24] * r2 for k in range(1, h + 1)])
    def fitted_like(r1):            # in-sample proxy for MinT: same month last year x growth
        f = y.copy(); f[12:] = y[:-12] * r1; return f
    out = {}
    def add(name, r1, r2):
        p = ratio_path(r1, r2)
        if np.isfinite(p).all() and (p >= 0).all():
            out[name] = Fit(name, p, p.copy(), p.copy(), fitted_like(r1), {"engine": "v1"})
    for k in (4, 3, 2):
        if t - 12 * k - 11 >= s:
            g = (M0 / mat(t - 12 * k)) ** (1 / k) - 1; add("Historical CAGR", 1 + g, (1 + g) ** 2); break
    if t - 35 >= s:
        g = (M0 / mat(t - 24)) ** 0.5 - 1; add("Recent 2-yr CAGR", 1 + g, (1 + g) ** 2)
    pts = [mat(t - 12 * j) for j in range(5) if t - 12 * j - 11 >= s][::-1]
    if len(pts) >= 3:
        sl, ic = np.polyfit(np.arange(len(pts)), pts, 1)
        f1, f2 = ic + sl * len(pts), ic + sl * (len(pts) + 1)
        if f1 > 0 and f2 > 0:
            add("Linear trend", f1 / M0, f2 / M0)
    if n_run >= 24:
        x = y[s:t + 1].astype(float); m0 = (ds[s].month - 1)
        si, pv = _v1_seasonal_indices(x, m0)
        seas = si is not None and pv < 0.05
        xs = x / si[[(m0 + i) % 12 for i in range(len(x))]] if seas else x
        f = _v1_holt(xs, h)
        if f is not None:
            if seas:
                f = f * si[[(m0 + len(x) - 1 + k) % 12 for k in range(1, h + 1)]]
            fit = np.zeros(len(y)); fit[s:] = x          # (in-sample proxy)
            out["Holt damped"] = Fit("Holt damped", f, f.copy(), f.copy(), fitted_like(1.0), {"engine": "v1", "seasonal": bool(seas)})
    return out


ENGINE = {"Historical CAGR": "v1", "Recent 2-yr CAGR": "v1", "Linear trend": "v1", "Holt damped": "v1",
          "Prophet": "v2", "Prophet-guided": "v2", "AutoETS": "v2", "AutoTheta": "v2", "CrostonSBA": "v2",
          "Bass uptake": "v2", "Logistic uptake": "v2", "SeasonalNaive": "benchmark", "Consensus (capped)": "safeguard"}

# plain-English description of each method, used by the page and by the insight text
METHOD_PLAIN = {
    "Historical CAGR": "projects the market's long-run average growth rate forward",
    "Recent 2-yr CAGR": "projects the market's growth rate of the last two years forward",
    "Linear trend": "extends the straight-line trend of the yearly totals",
    "Holt damped": "follows the recent monthly trend and gradually flattens it",
    "Prophet": "follows the current growth pace and the usual seasonal pattern",
    "Prophet-guided": "follows the growth pace since the market's last change in trend, with the usual seasonal pattern",
    "AutoETS": "follows the latest level and trend of monthly sales, giving most weight to recent months",
    "AutoTheta": "blends the long-term trend with the most recent level of sales",
    "SeasonalNaive": "repeats the last twelve months' pattern",
    "CrostonSBA": "averages irregular orders into an expected monthly rate",
    "Bass uptake": "follows a typical launch adoption curve toward a peak monthly volume",
    "Logistic uptake": "follows an S-shaped launch curve toward a peak monthly volume",
    "Consensus (capped)": "takes the middle of all tested methods, held to the market's current growth pace",
}


def annual_interval(fit: Fit, idx: np.ndarray, level=CFG["level"]):
    """Annual Low/Base/High for the months in idx. With sample paths (Prophet) the quantiles of
    the summed paths are used (correct for an annual total). Without them the monthly bounds are
    summed, which assumes all months miss together -> deliberately conservative (flagged)."""
    base = float(fit.mean[idx].sum())
    if fit.samples is not None:
        tot = fit.samples[:, idx].sum(axis=1)
        a = (100 - level) / 2
        lo, hi = float(np.percentile(tot, a)), float(np.percentile(tot, 100 - a))
        return base, lo, hi, "sampled"
    lo, hi = float(fit.lo[idx].sum()), float(fit.hi[idx].sum())
    if abs(hi - lo) <= 1e-9 * max(1.0, base):
        return base, base, base, "none"
    return base, lo, hi, "summed (conservative)"


def fit_uptake(y: np.ndarray, h: int, cfg=CFG) -> Fit:
    """Launch uptake for REPEAT-PRESCRIPTION markets: monthly units follow an S-curve that rises to
    a peak monthly volume and stays there,  units(t) = M * F(t),  F = Bass cumulative-adoption share.
    (Real-data check 2026-10-13: the textbook Bass form -- monthly units = NEW adopters dN/dt --
    forecast -91% for ZKARDOVAL HCT, a chronic market on a plateau, because new-adopter flow falls
    after the peak while patients already on therapy keep buying. Volume tracks patients ON therapy.)
    Peak volume M is bounded to [current run-rate, max_peak_multiple x run-rate] -- a BUSINESS
    assumption shown on the page; falls back to a logistic S-curve if Bass does not converge."""
    from scipy.optimize import curve_fit

    y = np.asarray(y, float)
    s = int(np.flatnonzero(y > 0)[0])
    z = y[s:]
    t = np.arange(1, len(z) + 1, dtype=float)
    run_rate = float(z[-3:].mean())
    M_lo, M_hi = run_rate * 1.0, run_rate * cfg["max_peak_multiple"]
    Fb = lambda tt, p, q: (1 - np.exp(-(p + q) * tt)) / (1 + (q / p) * np.exp(-(p + q) * tt))
    model = "Bass uptake"
    sig = 1.0 / (0.25 + t / len(t))            # recent months weigh up to ~5x more than the first month
    try:
        (p, q, M), _ = curve_fit(lambda tt, p, q, M: M * Fb(tt, p, q), t, z, sigma=sig,
                                 p0=[0.01, 0.15, min(max(run_rate * 1.5, M_lo * 1.01), M_hi * 0.99)],
                                 bounds=([cfg["bass_p"][0], cfg["bass_q"][0], M_lo], [cfg["bass_p"][1] * 5, cfg["bass_q"][1] * 2, M_hi]),
                                 maxfev=20000)
        f = lambda tt: M * Fb(tt, p, q)
        params = {"p": p, "q": q, "peak_monthly": M}
    except Exception:
        model = "Logistic uptake"
        logi = lambda tt, K, r, t0: K / (1 + np.exp(-r * (tt - t0)))
        (K, r, t0), _ = curve_fit(logi, t, z, sigma=sig, p0=[min(run_rate * 1.5, M_hi * 0.99), 0.3, len(t) / 2],
                                  bounds=([M_lo, 0.01, -24], [M_hi, 3, 120]), maxfev=20000)
        f = lambda tt: logi(tt, K, r, t0)
        params = {"peak_monthly": K, "r": r, "t0": t0}
        M = K
    tf = np.arange(len(z) + 1, len(z) + h + 1, dtype=float)
    fitted_tail, mean = f(t), f(tf)
    rng = np.random.default_rng(20261012)
    lr = np.log(np.maximum(z, 1) / np.maximum(fitted_tail, 1))[-12:]     # recent fit errors
    sims = np.array([mean * np.exp(rng.choice(lr, size=h, replace=True)) for _ in range(cfg["uptake_bootstrap"])])
    fitted = np.zeros(len(y)); fitted[s:] = fitted_tail
    # safeguard: never forecast below the current monthly rate while the market is still rising
    momentum = float(z[-3:].sum() / z[-6:-3].sum() - 1) if len(z) >= 6 and z[-6:-3].sum() > 0 else None
    floored = bool(momentum is not None and momentum > 0 and (mean < run_rate).any())
    if floored:
        lift = np.maximum(mean, run_rate) / np.maximum(mean, 1e-9)
        mean = mean * lift
        sims = sims * lift
    # Low end always includes "volume stays at today's run-rate": a launch can stall, and the
    # curve's own fit errors alone made the range exclude that (real check: ZKARDOVAL HCT)
    sims = np.vstack([sims, np.full((max(1, len(sims) // 5), h), run_rate)])
    share_now = float(f(t[-1:])[0] / M)
    phase = "early uptake" if share_now < 0.5 else ("maturing" if share_now < 0.9 else "near peak")
    a_ = (100 - cfg["level"]) / 2
    return Fit(model, mean, np.percentile(sims, a_, axis=0), np.percentile(sims, 100 - a_, axis=0), fitted,
               {"params": {k: float(v) for k, v in params.items()}, "peak_monthly": float(M),
                "floored_at_run_rate": floored, "momentum": momentum,
                "share_of_potential_reached": share_now, "phase": phase}, sims)


def backtest_tournament(groups: dict, ds, y, cfg=CFG, y_eval=None) -> dict:
    """Rolling-origin test for several candidate groups at once. groups = {name: fn(ds, y, h) ->
    {model_name: Fit}}. At each origin only data up to that month is visible (leak-free); each
    model forecasts the next 12 months; scored on the 12-month TOTAL (the business number):
      wape  = sum|forecast-actual| / sum(actual)     bias = sum(forecast-actual) / sum(actual)
      coverage = share of origins whose actual total fell inside the model's annual 80% range
      calib  = factor (>=1) that would have brought coverage to 80% (applied to the final range)."""
    h = cfg["backtest_h"]
    y_eval = y if y_eval is None else np.asarray(y_eval, float)   # score against what IQVIA actually reported
    rec = {}
    for o in range(cfg["backtest_first_origin"], len(y) - h, cfg["backtest_step"]):
        act = float(y_eval[o + 1:o + 1 + h].sum())
        if act <= 0:
            continue
        for g, fn in groups.items():
            try:
                fits = fn(ds[:o + 1], y[:o + 1], h)
            except Exception:
                continue
            for name, f in fits.items():
                base, lo, hi, _ = annual_interval(f, np.arange(h))
                if base <= 0:
                    continue
                r = rec.setdefault(name, {"err": [], "act": [], "inside": [], "need": [], "detail": []})
                r["err"].append(base - act); r["act"].append(act)
                r["detail"].append([int(o), round(float(base), 1), round(act, 1)])
                r["inside"].append(lo <= act <= hi)
                half = (math.log(hi / base) if act >= base else math.log(base / max(lo, 1e-9))) if hi > lo else 0.0
                if half > 1e-6:
                    r["need"].append(abs(math.log(act / base)) / half)
                r.setdefault("abslog", []).append(abs(math.log(act / base)))
    out = {}
    for name, r in rec.items():
        e, a = np.array(r["err"]), np.array(r["act"])
        cov = float(np.mean(r["inside"]))
        calib = max(1.0, float(np.quantile(r["need"], cfg["level"] / 100))) if len(r["need"]) >= 4 else 1.0
        cov = cov if r["need"] else None
        floor = float(np.quantile(r["abslog"], cfg["range_floor_quantile"])) if len(r["abslog"]) >= 4 else 0.0
        err_lvl = float(np.quantile(r["abslog"], cfg["level"] / 100)) if len(r["abslog"]) >= 4 else 0.0
        out[name] = {"n": len(a), "wape": float(np.abs(e).sum() / a.sum()), "bias": float(e.sum() / a.sum()),
                     "coverage": cov, "calib": round(calib, 3), "error_floor": round(floor, 4),
                     "error_at_level": round(err_lvl, 4),
                     "detail": r["detail"]}           # [origin index, forecast 12-m total, actual 12-m total]
    return out


def forecast_series(uid: str, ds, y_raw, h, cfg=CFG) -> dict:
    """Steps 2-4 for one series. Returns the chosen Fit + everything the insight engine needs."""
    seg = classify_demand(y_raw, cfg)
    y, adjustments = extract_signal(y_raw, cfg)
    meta = {"unique_id": uid, **seg, "adjustments": adjustments,
            "trend_break": detect_trend_break(y, cfg) if seg["segment"] == "continuous" else None}
    if seg["segment"] == "launch":
        fit = fit_uptake(y, h, cfg)
        meta["backtest"] = {"n": 0}
    elif seg["segment"] in ("intermittent", "lumpy"):
        g = {"sf": lambda d, v, hh: fit_statsforecast(d, v, hh, uid, cfg, models=("CrostonSBA",))}
        meta["backtest"] = backtest_tournament(g, ds, y, cfg, y_eval=y_raw).get("CrostonSBA", {"n": 0})
        fit = fit_statsforecast(ds, y, h, uid, cfg, models=("CrostonSBA",))["CrostonSBA"]
    else:
        def _guided(d, v, hh):
            # scored under one name at EVERY origin (guided when a break is visible at that
            # date, automatic otherwise) so both Prophet variants face the same test windows
            return {"Prophet-guided": fit_prophet(d, v, hh, cfg, guided=True)}
        groups = {"prophet": lambda d, v, hh: {"Prophet": fit_prophet(d, v, hh, cfg)},
                  "prophet_guided": _guided,
                  "sf": lambda d, v, hh: fit_statsforecast(d, v, hh, uid, cfg, models=("AutoETS", "AutoTheta", "SeasonalNaive")),
                  "v1": lambda d, v, hh: fit_v1_methods(d, v, hh, cfg)}
        scores = backtest_tournament(groups, ds, y, cfg, y_eval=y_raw)
        finals = {}
        for fn in groups.values():
            try:
                finals.update(fn(ds, y, h))
            except Exception:
                pass
        # eligible = tested on (nearly) all windows and able to forecast today
        max_n = max([v["n"] for v in scores.values()] or [0])
        elig = [k for k in scores if k in finals and scores[k]["n"] >= max(4, 0.8 * max_n)]
        ranked = sorted(elig, key=lambda k: scores[k]["wape"])
        best = ranked[0] if ranked else ("SeasonalNaive" if "SeasonalNaive" in finals else next(iter(finals)))
        why_pick = "lowest_error"
        if ENGINE.get(best) != "v2":     # v2 keeps near-ties (<= 5%): it can explain structural shifts
            v2c = [k for k in ranked if ENGINE.get(k) == "v2"]
            if v2c and scores[v2c[0]]["wape"] <= scores[best]["wape"] * (1 + cfg["prophet_tie_margin"]):
                best, why_pick = v2c[0], "v2_tie"
        fit = finals[best]
        meta["backtest"] = scores.get(best, {"n": 0})
        meta["tournament"] = scores
        meta["ranked"] = ranked
        meta["why_pick"] = why_pick
        # FY figures of every candidate at today's origin (before alignment), for the page
        cut = 12 - ds[-1].month
        ytd = float(np.asarray(y_raw)[[d.year == ds[-1].year for d in ds]].sum())
        def le_fy(pth):
            le = ytd + float(pth[:cut].sum()); fy = float(pth[cut:cut + 12].sum())
            return le, fy, ((fy / le - 1) * 100 if le > 0 else None)
        meta["candidates"] = {k: dict(zip(("fy_le", "fy_target", "growth_vs_le_pct"), le_fy(f.mean)))
                              for k, f in finals.items()}
        # SAFEGUARD for volatile series: if even the most accurate method missed by > 15%, use the
        # consensus of all methods and never project faster than the market grows today (MAT).
        if scores.get(best, {}).get("wape", 0) > cfg["volatile_wape"] and len(finals) >= 3:
            yr = np.asarray(y_raw, float)
            mat_g = float(yr[-12:].sum() / yr[-24:-12].sum() - 1) * 100 if yr[-24:-12].sum() > 0 else None
            cons = np.median(np.vstack([f.mean for f in finals.values()]), axis=0)
            le, fy, g = le_fy(cons)
            capped = False
            if mat_g is not None and g is not None:
                hi_cap, lo_cap = max(mat_g, 0.0), min(mat_g, 0.0)
                tgt_g = min(max(g, lo_cap), hi_cap)
                if abs(tgt_g - g) > 1e-9:
                    k = (1 + tgt_g / 100) * le / fy if fy > 0 else 1.0
                    cons = cons.copy(); cons[cut:] *= k; capped = True
            meta["safeguard"] = {"top_model": best, "top_error": scores[best]["wape"], "mat_growth_pct": mat_g,
                                 "consensus_growth_pct": g, "capped": capped}
            fit = Fit("Consensus (capped)", cons, cons.copy(), cons.copy(), finals[best].fitted,
                      {"engine": "safeguard", "seasonal": finals[best].info.get("seasonal", False)})
            meta["backtest"] = dict(scores[best])          # its range = the top method's past misses
    meta["model"] = fit.model
    meta["model_info"] = fit.info
    return {"fit": fit, "meta": meta}


# =====================================================================================
# STEP 5 - HIERARCHICAL RECONCILIATION (MinT)
# =====================================================================================
def build_summing_matrix(bottom_ids: list[str], aggs: dict[str, list[str]]):
    """Explicit S (rows = every series, cols = DM1 bottom series). Works for OVERLAPPING
    aggregates, which a tree-based aggregate() cannot express."""
    rows = {}
    for a, members in aggs.items():
        rows[a] = [1.0 if b in set(members) else 0.0 for b in bottom_ids]
    for b in bottom_ids:
        rows[b] = [1.0 if b == c else 0.0 for c in bottom_ids]
    S_df = pd.DataFrame.from_dict(rows, orient="index", columns=bottom_ids)
    S_df.index.name = "unique_id"
    S_df = S_df.reset_index()
    tags = {
        "Egypt": np.array(["Egypt"]),
        "Egypt/BU": np.array([a for a in aggs if a.startswith("BU/")]),
        "Egypt/Line": np.array([a for a in aggs if a.startswith("Line/")]),
        "Egypt/DM1": np.array(bottom_ids),
    }
    return S_df, tags


def _trusted(meta: dict, cfg=CFG) -> bool:
    """Same test as the 'Higher' confidence rule, applied BEFORE alignment (2026-10-13)."""
    if meta.get("segment") != "continuous" or meta.get("safeguard"):
        return False
    bt = meta.get("backtest") or {}
    if (meta.get("months_of_sales") or 0) < 60 or bt.get("n", 0) < 10:
        return False
    if bt.get("wape", 1) > 0.06 or abs(bt.get("bias", 1)) > 0.03:
        return False
    rk, cands = meta.get("ranked") or [], meta.get("candidates") or {}
    top = [cands[x]["growth_vs_le_pct"] for x in rk[:3] if x in cands and cands[x]["growth_vs_le_pct"] is not None]
    return len(top) >= 2 and max(top) - min(top) <= 6


def reconcile_mint(results: dict[str, dict], ds_hist, ds_fut, S_df, tags, cfg=CFG) -> pd.DataFrame:
    """Coherent forecasts: every BU / Line / Egypt number equals the sum of its DM1s, with
    MinT shrinkage putting more trust in the series that forecast best in-sample.
    API verified on hierarchicalforecast 1.5.3 (S_df with a unique_id column).

    LOCKED children (launch / intermittent DM1s, cfg['lock_segments']): tested end-to-end, plain
    MinT pushed +162% of the aggregates' disagreement onto a small intermittent market, because
    MinT gives the biggest adjustments to the noisiest series. Locked markets keep their own
    forecast; MinT reconciles the remaining (continuous) markets against each aggregate MINUS its
    locked children. Totals are still exactly coherent (asserted below)."""
    from hierarchicalforecast.core import HierarchicalReconciliation
    from hierarchicalforecast.methods import MinTrace, BottomUp

    lvl = cfg["level"]
    S = S_df.set_index("unique_id")
    bottom = list(S.columns)
    aggs_ids = [u for u in S.index if u not in bottom]
    locked = [b for b in bottom if results[b]["meta"].get("segment") in cfg["lock_segments"]
              or (cfg.get("lock_trusted") and _trusted(results[b]["meta"], cfg))]
    for b in bottom:
        results[b]["meta"]["locked_trusted"] = bool(cfg.get("lock_trusted") and _trusted(results[b]["meta"], cfg))
    free = [b for b in bottom if b not in locked]
    nf, nh = len(ds_fut), len(ds_hist)

    def locked_sum(agg, what):
        kids = [b for b in locked if S.at[agg, b] == 1]
        if not kids:
            return np.zeros(nf if what in ("mean",) else nh)
        if what == "mean":
            return np.sum([results[k]["fit"].mean for k in kids], axis=0)
        if what == "fitted":
            return np.sum([results[k]["fit"].fitted for k in kids], axis=0)
        return np.sum([results[k]["y_raw"] for k in kids], axis=0)

    in_mint = lambda a: a == "Egypt" or any(a.startswith(lv + "/") for lv in cfg["mint_levels"] if lv != "Egypt")
    live_aggs = [a for a in aggs_ids if in_mint(a) and any(S.at[a, b] == 1 for b in free)]
    hat, fitted = [], []
    for uid in live_aggs + free:
        f = results[uid]["fit"]
        lm = locked_sum(uid, "mean") if uid in live_aggs else 0.0
        lf = locked_sum(uid, "fitted") if uid in live_aggs else 0.0
        ly = locked_sum(uid, "y") if uid in live_aggs else 0.0
        hat.append(pd.DataFrame({"unique_id": uid, "ds": ds_fut, "base": f.mean - lm,
                                 f"base-lo-{lvl}": f.lo - lm, f"base-hi-{lvl}": f.hi - lm}))
        fitted.append(pd.DataFrame({"unique_id": uid, "ds": ds_hist, "y": results[uid]["y_raw"] - ly,
                                    "base": f.fitted - lf}))
    Y_hat_df = pd.concat(hat, ignore_index=True)
    Y_fit_df = pd.concat(fitted, ignore_index=True)
    S_free = S.loc[live_aggs + free, free].reset_index()
    tags_free = {k: np.array([u for u in v if u in set(live_aggs + free)]) for k, v in tags.items()}
    tags_free = {k: v for k, v in tags_free.items() if len(v)}
    if not any(len(v) and v[0] in set(free) for v in tags_free.values()):
        tags_free["Egypt/DM1"] = np.array(free)
    tags_free = {k: v for k, v in tags_free.items() if len(v)}

    # Probabilistic MinT ("normality"). The library does not allow nonnegative=True together with
    # interval reconciliation, so reconcile with intervals first and re-run the point forecast
    # with nonnegative=True only if a point comes out negative.
    hrec = HierarchicalReconciliation(reconcilers=[MinTrace(method="mint_shrink"), BottomUp()])
    Y_rec = hrec.reconcile(Y_hat_df=Y_hat_df, Y_df=Y_fit_df, S_df=S_free, tags=tags_free,
                           level=[lvl], intervals_method="normality")
    pt = "base/MinTrace_method-mint_shrink"
    if (Y_rec[pt] < 0).any():
        nn = HierarchicalReconciliation(reconcilers=[MinTrace(method="mint_shrink", nonnegative=True)]).reconcile(
            Y_hat_df=Y_hat_df[["unique_id", "ds", "base"]], Y_df=Y_fit_df, S_df=S_free, tags=tags_free)
        Y_rec[pt] = nn[[c for c in nn.columns if c.startswith("base/MinTrace")][0]].values
        Y_rec.attrs["nonnegative_rerun"] = True

    # add locked children back: aggregates += their locked forecasts; locked markets = own forecast
    final = {}
    for uid in bottom:
        final[uid] = (results[uid]["fit"].mean if uid in locked
                      else Y_rec[Y_rec["unique_id"] == uid].sort_values("ds")[pt].values)
    rows = []
    for uid in aggs_ids + bottom:
        if uid in bottom:
            vals = final[uid]
        elif uid in live_aggs:
            vals = Y_rec[Y_rec["unique_id"] == uid].sort_values("ds")[pt].values + locked_sum(uid, "mean")
        else:                                   # Lines / locked-only aggregates: exact sum of reconciled DM1s
            vals = np.sum([final[b] for b in bottom if S.at[uid, b] == 1], axis=0)
        rows.append(pd.DataFrame({"unique_id": uid, "ds": ds_fut, "reconciled": vals,
                                  "locked": uid in locked}))
    out = pd.concat(rows, ignore_index=True)

    # --- hard coherence check: every aggregate equals the sum of its DM1s ---
    piv = out.pivot(index="unique_id", columns="ds", values="reconciled")
    gap = (S.values @ piv.loc[bottom].values) - piv.loc[S.index].values
    assert np.abs(gap).max() < 1e-6 * max(1.0, np.abs(piv.values).max()), "reconciled output is not coherent"
    return out


# =====================================================================================
# STEP 6 - EXPLAINABLE INSIGHTS (business English, no statistical jargon)
# =====================================================================================
def _pct0(x) -> str:
    """Whole-percent with sign; 0 instead of '-0'."""
    r = round(float(x))
    return "0%" if r == 0 else f"{r:+d}%"


def _month_label(ym: str) -> str:
    y, m = ym.split("-")
    return f"{MON[int(m) - 1]} {y}"


def generate_business_insights(market_metadata: dict) -> dict:
    """Translate the pipeline's internals into plain English for "Why this forecast?".

    Expected keys (all optional except market & segment):
      market, level ('DM1'|'BU'|'Line'|'Egypt'), segment ('launch'|'intermittent'|'lumpy'|'continuous'),
      model ('Prophet'|'AutoETS'|'AutoTheta'|'SeasonalNaive'|'CrostonSBA'|'Bass uptake'|'Logistic uptake'),
      months_of_sales, growth_pct (FY next vs current-year estimate), low_pct, high_pct,
      hist_growth_pct, recent_growth_pct, ytd_growth_pct,
      trend_break: {'date':'2024-03','direction':'acceleration'|'slowdown','growth_before_pct':float,'growth_after_pct':float},
      recent_trend_pct (current annualised pace from the model),
      adjustments: [{'index':int,'type':'spike'|'dip','pct':float, 'period':'2025-11'}],
      seasonal (bool), peak_months ([int 1-12]),
      uptake: {'phase':..., 'share_of_potential_reached':float, 'potential': float},
      reconciliation: {'base_total':float, 'reconciled_total':float, 'parent':'BU/GIT'|..., 'children':int},
      backtest: {'n':int, 'bias':float, 'coverage':float, 'wape':float},
      interval_width_pct (High minus Low, % points), data_flags: [str]
    Returns {'headline': str, 'drivers': [str], 'assumptions': [str], 'watch_outs': [str]}.
    Every sentence is triggered by a computed value; nothing is invented.
    """
    md = market_metadata or {}
    drivers, assumptions, watch = [], [], []
    seg, model = md.get("segment"), md.get("model", "")
    g = md.get("growth_pct")

    # -- headline ---------------------------------------------------------------------
    if g is None:
        headline = f"No reliable forecast could be produced for {md.get('market', 'this market')}."
    else:
        name = md.get("market", "This market")
        if g > 0.5:
            headline = f"{name}: expected growth of {g:+.1f}% next year"
        elif g < -0.5:
            headline = f"{name}: expected decline of {g:+.1f}% next year"
        else:
            headline = f"{name}: expected to be broadly flat next year ({g:+.1f}%)"
        if md.get("low_pct") is not None and md.get("high_pct") is not None:
            pass                                   # 2026-10-13: no ranges on the page (Ahmed); see seg["reliability"]
        headline += "."

    # -- 1. momentum / structural shifts (dated growth break) ---------------------------
    tb = md.get("trend_break") or {}
    if tb.get("date"):
        g0, g1 = tb.get("growth_before_pct"), tb.get("growth_after_pct")
        rates = f" (growth moved from about {_pct0(g0)} to {_pct0(g1)} a year)" if g0 is not None and g1 is not None else ""
        if tb.get("direction") == "acceleration":
            drivers.append(f"Forecast accounts for a recent structural market acceleration starting "
                           f"{_month_label(tb['date'])}, prioritizing current momentum over outdated historical trends{rates}.")
        else:
            drivers.append(f"The market has slowed since {_month_label(tb['date'])}{rates}; the forecast follows the "
                           "current, slower pace rather than the stronger growth of earlier years.")
    else:
        hg, rg = md.get("hist_growth_pct"), md.get("recent_growth_pct")
        if hg is not None and rg is not None:
            if abs(rg - hg) <= 3:
                drivers.append(f"Growth has been steady (about {rg:+.0f}% a year recently vs {hg:+.0f}% long-term), "
                               "so the forecast continues the established trend.")
            elif rg > hg:
                drivers.append(f"Recent growth ({rg:+.0f}% a year) is faster than the long-term average ({hg:+.0f}%); "
                               "the forecast gives more weight to the recent pace.")
            else:
                drivers.append(f"Recent growth ({rg:+.0f}% a year) is slower than the long-term average ({hg:+.0f}%); "
                               "the forecast gives more weight to the recent pace.")
    # forecast vs recent pace: say so when they differ (factual, no invented cause)
    ref = (tb.get("growth_after_pct") if tb.get("date") else md.get("recent_growth_pct"))
    if seg == "continuous" and g is not None and ref is not None and abs(g - ref) > 3:
        drivers.append(f"Next year's forecast ({_pct0(g)}) is {'below' if g < ref else 'above'} the recent pace "
                       f"({_pct0(ref)} a year): " + ("the combined forecast" if md.get("safeguard") else "the selected method") + " expects growth to "
                       f"{'ease' if g < ref else 'pick up'}.")
    if md.get("ytd_growth_pct") is not None and seg != "launch" and abs(md["ytd_growth_pct"]) <= 200:
        drivers.append(f"This year to date the market is running {md['ytd_growth_pct']:+.1f}% versus last year.")

    # -- 2. normalised distortions (STL + winsorisation) ---------------------------------
    adj = md.get("adjustments") or []
    if adj:
        spikes = [a for a in adj if a.get("type") == "spike"]
        dips = [a for a in adj if a.get("type") == "dip"]
        when = ", ".join(_month_label(a["period"]) for a in adj[:3] if a.get("period"))
        drivers.append("Historical volume distortions (e.g., supply spikes) were normalized to reflect true organic "
                       "patient demand" + (f" ({when}{'…' if len(adj) > 3 else ''})." if when else "."))
        if spikes and not dips:
            assumptions.append("Unusually high months are treated as one-off stock building, not lasting demand.")
        if dips:
            assumptions.append("Unusually low months are treated as temporary supply gaps, not lost patients.")

    # -- 3. seasonality ----------------------------------------------------------------
    if md.get("seasonal"):
        pk = md.get("peak_months") or []
        drivers.append("The usual seasonal pattern is kept" +
                       (f" (peaks in {', '.join(MON[p - 1] for p in pk)})" if pk else "") +
                       ", so monthly phasing follows real prescribing seasons.")

    # -- 3b. which method won and why (plain words) -------------------------------------
    sg = md.get("safeguard")
    if sg:
        mg = sg.get("mat_growth_pct")
        drivers.append("Even the most accurate method missed this market by more than "
                       f"{int(round(sg['top_error'] * 100))}% in past tests, so the forecast takes the middle of all tested "
                       "methods" + (f" and is held to the market's current growth pace ({_pct0(mg)} over the last 12 months)"
                                    if sg.get("capped") and mg is not None else "") + ".")
        watch.append("Treat this market's figure as directional and review it with the brand team.")
    elif md.get("method_plain") and seg == "continuous":
        bt0 = md.get("backtest") or {}
        txt = f"Method: the forecast {md['method_plain']}."
        if md.get("n_methods", 0) > 1 and bt0.get("n"):
            txt += (f" It was the most accurate of {md['n_methods']} methods tested on {bt0['n']} past periods"
                    if md.get("why_pick") != "v2_tie" else
                    f" It was practically as accurate (within 5%) as the best of {md['n_methods']} methods tested on {bt0['n']} past "
                    "periods, and the newer methods are preferred on a near-tie")
            ru = md.get("runner_up")
            if ru and bt0.get("wape") and md.get("why_pick") != "v2_tie":
                txt += f"; the next best {ru['plain']}"
            txt += "."
        drivers.append(txt)

    # -- 4. routing-specific explanations ----------------------------------------------
    if seg == "launch":
        up = md.get("uptake") or {}
        drivers.append(f"This is a new market ({md.get('months_of_sales', '?')} months of sales). The forecast follows a "
                       "typical launch adoption curve instead of assuming volumes stay flat or grow at a fixed rate.")
        if up.get("phase") and not up.get("floored_at_run_rate"):
            drivers.append({"early uptake": "Adoption is still in its early phase, so the strongest growth is still ahead.",
                            "maturing": "Adoption is well under way; growth is expected to continue but at a slowing pace.",
                            "near peak": "The market is close to its expected peak level, so little further growth is assumed."}
                           .get(up["phase"], ""))
        if up.get("floored_at_run_rate"):
            assumptions.append("The adoption curve pointed to an early slowdown that recent sales do not show, so the "
                               "forecast is held at no lower than the current monthly sales rate.")
        if up.get("share_of_potential_reached") is not None:
            assumptions.append(f"Current monthly volume is estimated at about {up['share_of_potential_reached'] * 100:.0f}% "
                               "of the market's eventual peak. This peak is an estimate; brand-team input on patient "
                               "potential would make it firmer.")
        watch.append("New markets can move faster or slower than any curve; review this forecast each quarter.")
    elif seg in ("intermittent", "lumpy"):
        drivers.append("Accounts for intermittent/institutional purchasing behavior rather than assuming flat monthly consumption.")
        assumptions.append("Monthly figures are an average expected rate; actual orders will arrive in irregular batches.")
    elif model == "SeasonalNaive" and not sg:
        drivers.append("No method beat a simple repeat of last year's pattern in past tests, so next year is "
                       "expected to look like the last twelve months.")

    # -- 5. hierarchy alignment (MinT) -------------------------------------------------
    rec = md.get("reconciliation") or {}
    if rec.get("reconciled_total") and (rec.get("base_total") or rec.get("locked")):
        diff = rec["reconciled_total"] / rec["base_total"] - 1 if rec.get("base_total") else 0.0
        lvl = md.get("level")
        if lvl == "DM1" and rec.get("locked"):
            msg = (f"This market's own forecast is kept as is"
                   + (" because it is one of the most reliable in the portfolio" if md.get("locked_trusted") else "")
                   + f"; the {rec.get('parent', 'business unit').split('/')[-1]} "
                   "and Egypt totals include it exactly, and the other markets absorb any alignment.")
        elif lvl == "DM1":
            msg = (f"The forecast was mathematically aligned with the {rec.get('parent', 'business unit').split('/')[-1]} "
                   "and Egypt totals, so market, BU and national numbers add up exactly.")
        else:
            msg = (f"This total equals the exact sum of its {rec.get('children', '')} underlying markets, so BU, "
                   "market and national numbers always add up.").replace("its  underlying", "its underlying")
        if abs(diff) >= 0.005:
            msg += f" Aligning the levels moved this figure by {diff * 100:+.1f}%."
        drivers.append(msg)
        if abs(diff) >= 0.05:
            watch.append(f"Aligning this market with its totals changed it by {diff * 100:+.1f}%, more than usual: "
                         "the market and its BU trends disagree, so review it with the brand team.")

    # -- 6. track record and certainty (no jargon) -----------------------------------
    bt = md.get("backtest") or {}
    if bt.get("n", 0) >= 6:
        if bt.get("bias") is not None and abs(bt["bias"]) >= 0.03:
            watch.append(f"In past tests {'the best single method' if md.get('safeguard') else 'this method'} tended to {'over' if bt['bias'] > 0 else 'under'}-estimate the "
                         f"market by about {abs(bt['bias']) * 100:.0f}%; read the figure with that in mind.")
        elif not md.get("method_plain"):
            drivers.append(f"Checked against {bt['n']} past periods, this method's forecasts landed close to what actually happened.")
        if bt.get("coverage") is not None and bt["coverage"] < 0.65 and (bt.get("calib") or 1.0) <= 1.0:
            watch.append("The likely range has been too narrow in past tests; treat Low and High as a minimum spread.")
    elif seg != "launch":
        watch.append("There is little history to check this forecast against, so treat it as directional.")
    w = md.get("interval_width_pct")
    if w is not None:
        if w <= 10:
            drivers.append("The likely range is narrow: the market has behaved predictably.")
        elif w >= 30 or md.get("range_widened"):
            watch.append("The likely range is wide" + (" and has been widened to match how often this market surprised "
                         "past forecasts" if md.get("range_widened") else ": this market has been volatile") +
                         "; plan with the Low and High cases too.")

    for f in md.get("data_flags") or []:
        watch.append(f)

    assumptions.append("No launches, withdrawals, shortages, price changes or tenders beyond what is already visible "
                       "in the IQVIA history are assumed.")
    return {"headline": headline, "drivers": [d for d in drivers if d], "assumptions": assumptions, "watch_outs": watch}


# =====================================================================================
# ORCHESTRATION
# =====================================================================================
def _calendar_facts(y, ds_hist):
    """Plain growth facts shown next to the model (calendar years, same definitions as v1)."""
    years = sorted({d.year for d in ds_hist})
    tot = {yr: float(y[ds_hist.year == yr].sum()) for yr in years}
    full = [yr for yr in years if (ds_hist.year == yr).sum() == 12]
    first = next((yr for yr in full if all(y[ds_hist.year == yr] > 0)), None)
    cagr = lambda a, b, n: ((b / a) ** (1 / n) - 1) * 100 if a > 0 and b > 0 and n > 0 else None
    o = ds_hist[-1]
    ytd = y[(ds_hist.year == o.year)].sum(); py = y[(ds_hist.year == o.year - 1) & (ds_hist.month <= o.month)].sum()
    return {"hist_growth_pct": cagr(tot[first], tot[full[-1]], full[-1] - first) if first is not None and first < full[-1] else None,
            "recent_growth_pct": cagr(tot[full[-3]], tot[full[-1]], 2) if len(full) >= 3 and first is not None and full[-3] >= first else None,
            "ytd_growth_pct": (ytd / py - 1) * 100 if py > 0 else None}


def assemble_outputs(results, Y_rec, aggs, ds_hist, ds_fut, target_year, cfg=CFG):
    """Join reconciled point forecasts, calibrated annual ranges and insight metadata."""
    out = []
    in_target = np.flatnonzero(ds_fut.year == target_year)
    before = np.flatnonzero(ds_fut.year < target_year)
    origin = ds_hist[-1]
    for uid, r in results.items():
        f, meta = r["fit"], r["meta"]
        rsub = Y_rec[Y_rec["unique_id"] == uid].sort_values("ds")
        rec, is_locked = rsub["reconciled"].values, bool(rsub["locked"].iloc[0])
        le = float(r["y_raw"][ds_hist.year == origin.year].sum() + rec[before].sum())
        fy = float(rec[in_target].sum())
        # annual range: model's own distribution -> calibrated by its backtest -> moved with MinT
        base, lo, hi, how = annual_interval(f, in_target, cfg["level"])
        bt = meta.get("backtest") or {}
        k = bt.get("calib", 1.0) or 1.0
        if base > 0 and how == "none":
            # methods without a native range (v1 methods, consensus): the range IS the method's own
            # past 12-month misses at the 80% level (v1's empirical approach)
            fl = bt.get("error_at_level", 0.0) or 0.0
            lo, hi = base * math.exp(-fl), base * math.exp(fl)
            how = "past misses (80%)"
        elif base > 0 and lo > 0:
            lo, hi = base * (lo / base) ** k, base * (hi / base) ** k
            # floor: never narrower than this market's own past 12-month misses (Prophet's native
            # band collapses when only one trend change is allowed -- measured, see design note)
            fl = bt.get("error_floor", 0.0) or 0.0
            lo, hi = min(lo, base * math.exp(-fl)), max(hi, base * math.exp(fl))
        ratio = fy / base if base > 0 else 1.0
        lo, hi = lo * ratio, hi * ratio
        sg = meta.get("safeguard")
        if sg and le > 0:
            # Safeguard markets: the best method's own past misses are > 15% by definition (up to ~1,000%),
            # so a band built from them is meaningless (e.g. -100% .. +6,500,000%). Instead the range is the
            # spread of the tested methods (20th-80th percentile of their FY growth), held to the same rule
            # as the base: never above today's 12-month growth pace (MAT). Always contains the base.
            gs = [c["growth_vs_le_pct"] for c in (meta.get("candidates") or {}).values()
                  if c.get("growth_vs_le_pct") is not None and np.isfinite(c["growth_vs_le_pct"])]
            if len(gs) >= 3:
                g_base = (fy / le - 1) * 100
                g_lo, g_hi = float(np.percentile(gs, 20)), float(np.percentile(gs, 80))
                mat = sg.get("mat_growth_pct")
                if mat is not None:
                    g_hi = min(g_hi, max(mat, 0.0, g_base))
                g_lo, g_hi = min(g_lo, g_base), max(g_hi, g_base)
                lo, hi = le * (1 + g_lo / 100), le * (1 + g_hi / 100)
                how = "safeguard spread"
        info = meta.get("model_info", {})
        md = {**meta, **_calendar_facts(r["y_raw"], ds_hist),
              "market": uid.split("/", 1)[-1], "level": uid.split("/", 1)[0],
              "growth_pct": (fy / le - 1) * 100 if le else None,
              "low_pct": (lo / le - 1) * 100 if le else None, "high_pct": (hi / le - 1) * 100 if le else None,
              "interval_width_pct": (hi - lo) / le * 100 if le else None,
              "recent_trend_pct": info.get("recent_trend_pct"),
              "seasonal": info.get("seasonal", False), "peak_months": info.get("peak_months", []),
              "uptake": info if meta.get("segment") == "launch" else None,
              "reconciliation": {"base_total": float(base), "reconciled_total": fy,
                                 "parent": next((a for a, m in aggs.items() if uid in m and a.startswith("BU/")), "Egypt"),
                                 "children": len(aggs.get(uid, [])), "locked": is_locked},
              "data_flags": []}
        if k > 1.25 and how != "past misses (80%)":
            md["range_widened"] = True
        # method facts for the page / insight text
        ms = meta.get("months_of_sales") or 0
        md["lifecycle"] = "Launch" if ms < cfg["launch_months"] else ("Developing" if ms < 60 else "Established")
        md["engine"] = ENGINE.get(meta["model"], "v2")
        md["method_plain"] = METHOD_PLAIN.get(meta["model"], "")
        rk = meta.get("ranked") or []
        md["n_methods"] = len(rk)
        if len(rk) > 1:
            win = meta["safeguard"]["top_model"] if meta.get("safeguard") else meta["model"]
            others = [x for x in rk if x != win]
            md["runner_up"] = {"model": others[0], "plain": METHOD_PLAIN.get(others[0], ""),
                               "wape": meta["tournament"][others[0]]["wape"]} if others else None
        # confidence (v1 thresholds, applied to the winner's own test record)
        btw = meta.get("backtest") or {}
        reasons = []
        if meta.get("segment") == "launch":
            conf = "Lower"; reasons.append("Launch market: adoption curve, no past test possible")
        elif meta.get("safeguard"):
            conf = "Lower"; reasons.append(f"Safeguard applied: the most accurate method still missed by {meta['safeguard']['top_error']*100:.0f}%")
        else:
            w, b_, n_ = btw.get("wape", 1), abs(btw.get("bias", 1)), btw.get("n", 0)
            top = [meta["candidates"][x]["growth_vs_le_pct"] for x in rk[:3] if x in (meta.get("candidates") or {})
                   and meta["candidates"][x]["growth_vs_le_pct"] is not None]
            spread = (max(top) - min(top)) if len(top) >= 2 else None
            if md["lifecycle"] == "Established" and n_ >= 10 and w <= 0.06 and b_ <= 0.03 and spread is not None and spread <= 6:
                conf = "Higher"
            elif n_ >= 6 and w <= 0.12 and b_ <= 0.06:
                conf = "Moderate"
            else:
                conf = "Lower"
            reasons.append(f"Past-test error {w*100:.1f}%, bias {btw.get('bias',0)*100:+.1f}%, {n_} tests, {md['lifecycle']}"
                           + (f", top methods within {spread:.1f} pts" if spread is not None else ""))
        md["confidence"], md["confidence_reasons"] = conf, reasons
        if how.startswith("summed"):
            md["data_flags"].append("The likely range is a cautious estimate (monthly ranges added together).")
        for a in md.get("adjustments", []):
            a["period"] = ds_hist[a["index"]].strftime("%Y-%m")
        if md.get("trend_break"):
            md["trend_break"] = {**md["trend_break"], "date": ds_hist[md["trend_break"]["index"]].strftime("%Y-%m")}
        out.append({"id": uid, "fy_le": le, "fy_target": fy, "low": float(lo), "high": float(hi), "range_method": how,
                    "calibration_factor": k, "why": generate_business_insights(md), "meta": md})
    return out


# =====================================================================================
# PUBLISH - dashboard cache (same contract as v1 so the existing tab keeps working)
# =====================================================================================
SHORT_NAME = {"Historical CAGR": "Historical growth rate", "Recent 2-yr CAGR": "Recent 2-year growth rate",
              "Linear trend": "Straight-line trend", "Holt damped": "Flattening monthly trend",
              "Prophet": "Current-pace trend (seasonal)", "Prophet-guided": "Trend since last shift (seasonal)",
              "AutoETS": "Recent level & trend (seasonal)", "AutoTheta": "Long-term + recent blend",
              "SeasonalNaive": "Repeat last 12 months", "CrostonSBA": "Irregular-order average",
              "Bass uptake": "Launch adoption curve", "Logistic uptake": "Launch S-curve",
              "Consensus (capped)": "Consensus, capped (safeguard)"}


def standalone_outputs(results, ds_hist, ds_fut, target_year, cfg=CFG):
    """DM2 markets: not aligned (DM2 cuts across DM1), so 'reconciled' = own forecast."""
    rows = []
    for uid, r in results.items():
        rows.append(pd.DataFrame({"unique_id": uid, "ds": ds_fut, "reconciled": r["fit"].mean, "locked": True}))
    Y_rec = pd.concat(rows, ignore_index=True)
    outs = assemble_outputs(results, Y_rec, {}, ds_hist, ds_fut, target_year, cfg)
    for o in outs:
        o["meta"]["reconciliation"] = {"base_total": o["fy_target"], "reconciled_total": o["fy_target"],
                                       "standalone": True, "children": 0, "locked": False, "parent": None}
        o["why"] = generate_business_insights({**o["meta"], "reconciliation": {}})
        o["why"]["assumptions"].append("This defined market cuts across the market tree, so it is forecast on its own "
                                       "and is not part of the aligned BU and national totals.")
    return outs


def _reliability(seg: dict, md: dict, o: dict, py: int, ty: int, months: str) -> dict:
    """2026-10-13 (Ahmed): plain-language reasons why the forecast can (or cannot) be relied on - replaces the
    Low/High range on the page. Every sentence is built from this market's own facts."""
    conf = md.get("confidence")
    verdict = {"Higher": "Reliable", "Moderate": "Reasonably reliable"}.get(conf, "Indicative only")
    pts, g = [], md.get("growth_pct")
    bt = md.get("backtest") or {}
    if md.get("segment") == "launch":
        pts.append(f"New market with {md.get('months_of_sales', '?')} months of sales: there is no past to test a forecast "
                   "against, so it follows a typical launch adoption curve. Use it as a direction, and review it each quarter.")
    elif md.get("segment") in ("intermittent", "lumpy"):
        pts.append("Orders arrive irregularly (tenders, institutions), so the forecast is an average monthly rate, not a trend.")
    if md.get("safeguard"):
        sg = md["safeguard"]
        pts.append(f"Even the best method missed this market by about {sg['top_error'] * 100:.0f}% in past tests, so the middle "
                   "of all methods is used" + (" and held to today's growth pace" if sg.get("capped") else "") + ".")
    elif bt.get("n", 0) > 0:
        w = bt.get("wape", 0) * 100
        pts.append(f"Tested {bt['n']} times on past data: each time it forecast the next 12 months using only the sales known "
                   f"then. On average it was {('less than 1' if w < 1 else f'{w:.0f}')}% away from what really happened.")
        b = bt.get("bias", 0) * 100
        pts.append("It did not lean towards forecasting too high or too low." if abs(b) <= 2 else
                   f"It tended to come out about {abs(b):.0f}% too {'high' if b > 0 else 'low'}, so read it as slightly "
                   f"{'optimistic' if b > 0 else 'cautious'}.")
    rk, cands = md.get("ranked") or [], md.get("candidates") or {}
    top = [cands[x]["growth_vs_le_pct"] for x in rk[:3] if x in cands and cands[x]["growth_vs_le_pct"] is not None]
    if len(top) >= 2 and not md.get("safeguard"):
        lo_, hi_ = min(top), max(top)
        pts.append(f"The {len(top)} best-tested methods give similar answers ({lo_:+.0f}% to {hi_:+.0f}%)." if hi_ - lo_ <= 6 else
                   f"The best-tested methods disagree ({lo_:+.0f}% to {hi_:+.0f}%), which makes the number less certain.")
    ytd = (seg.get("ytd") or {}).get("growth_pct")
    if ytd is not None and g is not None and md.get("segment") != "launch" and abs(ytd) <= 200:
        if abs(g - ytd) <= 8:
            pts.append(f"It fits today's sales: {months} {py} is {ytd:+.1f}% vs last year, and {ty} is forecast at {g:+.1f}%.")
        elif g < ytd:
            pts.append(f"It expects growth to slow from {ytd:+.1f}% ({months} {py}) to {g:+.1f}% in {ty}; "
                       "this follows the slowing seen over recent years.")
        else:
            pts.append(f"It expects growth to pick up from {ytd:+.1f}% ({months} {py}) to {g:+.1f}% in {ty}; check that "
                       "new launches or supply support this.")
    rec = md.get("reconciliation") or {}
    le = o.get("fy_le") or 0
    if md.get("locked_trusted"):
        pts.append("Kept exactly as forecast when the BU and Egypt totals were balanced, because it is one of the most reliable "
                   "markets; less reliable markets absorbed the balancing.")
    elif rec.get("base_total") and le and not rec.get("standalone"):
        d = (rec["reconciled_total"] - rec["base_total"]) / le * 100
        if abs(d) >= 1:
            pts.append(f"Moved {d:+.1f} points so that markets, BUs and Egypt add up exactly.")
    ms = md.get("months_of_sales")
    if ms and md.get("segment") != "launch":
        pts.append(f"{ms} months of sales history ({md.get('lifecycle', '').lower()} market).")
    return {"verdict": verdict, "points": pts}


def build_dashboard_cache(v1_obj: dict, champion: list, results: dict, Y_rec: pd.DataFrame, cfg=CFG) -> dict:
    """Overlay the champion forecasts onto the v1 cache structure (history, data-quality checks,
    monthly series etc. stay exactly as v1 computed them)."""
    by_id = {o["id"]: o for o in champion}
    meta = v1_obj["meta"]
    lvl = cfg["level"]
    py, ty = meta["partial_year"], meta["target_year"]
    n_fut = len(meta["future_periods"])
    for seg in v1_obj["segments"]:
        uid = "Egypt" if seg["type"] == "Total" else f"{seg['type']}/{seg['name']}"
        o = by_id.get(uid)
        if o is None:
            seg["engine"] = "v1 (not in champion run)"
            continue
        md = o["meta"]; model = md["model"]; bt = md.get("backtest") or {}
        if not Y_rec.empty and (Y_rec["unique_id"] == uid).any():
            path = Y_rec[Y_rec["unique_id"] == uid].sort_values("ds")["reconciled"].values
        else:
            path = results[uid]["fit"].mean
        seg["lifecycle"] = md["lifecycle"]
        seg["engine"] = md.get("engine")
        seg["selected_model"] = model
        seg["selected_label"] = SHORT_NAME.get(model, model)
        seg["method_plain"] = md.get("method_plain")
        seg["forecast_type"] = ("safeguard" if md.get("safeguard") else "launch_curve" if md["segment"] == "launch"
                                else "intermittent" if md["segment"] in ("intermittent", "lumpy") else "statistical")
        seg["statistically_forecastable"] = md["segment"] != "launch"
        if md.get("safeguard"):
            seg["selection_rationale"] = (f"The most accurate method ({SHORT_NAME.get(md['safeguard']['top_model'])}) still "
                                          f"missed by {md['safeguard']['top_error']*100:.0f}% in past tests (above the 15% limit), so the "
                                          "middle of all tested methods is used"
                                          + (f", held to the market's current growth pace ({_pct0(md['safeguard']['mat_growth_pct'])} MAT)."
                                             if md['safeguard'].get('capped') else "."))
        elif md["segment"] == "launch":
            seg["selection_rationale"] = ("New market (under 24 months of sales): a launch adoption curve toward an estimated "
                                          "peak monthly volume; it cannot be tested on past periods yet.")
        elif md["segment"] in ("intermittent", "lumpy"):
            seg["selection_rationale"] = "Irregular buying pattern: orders are averaged into an expected monthly rate."
        else:
            ru = md.get("runner_up") or {}
            seg["selection_rationale"] = (f"Most accurate of {md.get('n_methods')} methods over {bt.get('n')} past 12-month tests "
                                          f"(error {bt.get('wape', 0)*100:.1f}%"
                                          + (f"; next best: {SHORT_NAME.get(ru.get('model'), ru.get('model'))} {ru.get('wape', 0)*100:.1f}%" if ru else "")
                                          + ")." if md.get("why_pick") != "v2_tie" else
                                          f"Within 5% of the most accurate method over {bt.get('n')} past tests; the newer methods are "
                                          "preferred on a near-tie.")
        le, fy, lo, hi = o["fy_le"], o["fy_target"], o["low"], o["high"]
        seg["forecast"] = {
            "fy_le": le, "fy_target": fy, "growth_vs_le_pct": md.get("growth_pct"),
            "fy_last_actual": {"year": py - 1, "su": seg["history"][str(py - 1)]["su"]},
            "basis_note": f"FY{py} LE = actual Jan-{MON[meta['partial_months']-1]} {py} + forecast to Dec. Growth % = FY{ty} / FY{py} LE - 1.",
            "path": [float(v) for v in path[:n_fut]],
            "scenarios": {"low": lo, "base": fy, "high": hi, "low_growth_pct": md.get("low_pct"),
                          "high_growth_pct": md.get("high_pct"),
                          "method": {"sampled": "From the method's own probability range, widened to match how often this market surprised past forecasts, and never narrower than its typical past miss.",
                                     "past misses (80%)": "From this method's own past 12-month misses: 8 in 10 past tests landed inside this range.",
                                     "summed (conservative)": "Monthly ranges added together (cautious), never narrower than the typical past miss.",
                                     "safeguard spread": "Spread of the tested methods (middle 60% of their projections), never above the market's current 12-month growth pace."}.get(o.get("range_method"), o.get("range_method")),
                          "median_backtest_error_pct": None}}
        cands = {}
        tour = md.get("tournament") or {}
        naive = (tour.get("SeasonalNaive") or {}).get("wape")
        for k, c in (md.get("candidates") or {model: {"fy_le": le, "fy_target": fy, "growth_vs_le_pct": md.get("growth_pct")}}).items():
            cands[k] = {"label": SHORT_NAME.get(k, k), "plain": METHOD_PLAIN.get(k, ""), "engine": ENGINE.get(k, "v2"), **c}
        if md.get("safeguard"):
            cands["Consensus (capped)"] = {"label": SHORT_NAME["Consensus (capped)"], "plain": METHOD_PLAIN["Consensus (capped)"],
                                           "engine": "safeguard", "fy_le": le, "fy_target": fy, "growth_vs_le_pct": md.get("growth_pct"),
                                           "unaligned_note": "after alignment"}
        seg["candidates"] = cands
        mets = {}
        for k, v in tour.items():
            mets[k] = {"n": v["n"], "wape": v["wape"], "bias": v["bias"],
                       "rel_to_naive": (v["wape"] / naive) if naive else None}
        if not tour and bt.get("n"):
            mets[model] = {"n": bt["n"], "wape": bt["wape"], "bias": bt["bias"], "rel_to_naive": None}
        origins = sorted({d[0] for v in tour.values() for d in v.get("detail", [])})
        seg["backtest"] = {"design": "every 2nd month-end, forecast the next 12 months using only data up to that date",
                           "origins": f"{meta['periods'][origins[0]]}..{meta['periods'][origins[-1]]}" if origins else None,
                           "n_common": bt.get("n", 0), "metrics": mets}
        rk = md.get("ranked") or []
        top = [cands[x]["growth_vs_le_pct"] for x in rk[:3] if x in cands and cands[x]["growth_vs_le_pct"] is not None]
        seg["model_spread_pts"] = round(max(top) - min(top), 2) if len(top) >= 2 else None
        seg["confidence"], seg["confidence_reasons"] = md["confidence"], md["confidence_reasons"]
        seg["reliability"] = _reliability(seg, md, o, py, ty, f"Jan–{MON[meta['partial_months'] - 1]}")
        w = o["why"]
        seg["why"] = {"headline": w["headline"], "facts": w["drivers"], "assumptions": w["assumptions"], "watch_outs": w["watch_outs"]}
        seg["model_info"] = {"seasonal": bool((md.get("model_info") or {}).get("seasonal") or md.get("seasonal"))}
        seg["v2"] = {"trend_break": md.get("trend_break"), "normalised_months": [a.get("period") for a in md.get("adjustments", [])],
                     "alignment": md.get("reconciliation"), "safeguard": md.get("safeguard"), "range_method": o.get("range_method")}
        seg.pop("outlier_sensitivity", None)
    meta["engine"] = "champion (v1 + v2 methods compete per market)"
    meta["generated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    meta["models"] = {k: SHORT_NAME.get(k, k) for k in ENGINE}
    meta["method_plain"] = METHOD_PLAIN
    meta["engines"] = ENGINE
    meta["config"].update({"launch_months": cfg["launch_months"], "volatile_wape": cfg["volatile_wape"],
                           "tie_margin": cfg["prophet_tie_margin"], "mint_levels": list(cfg["mint_levels"]),
                           "lock_segments": list(cfg["lock_segments"]), "winsor_pct": 40, "level": lvl})
    return v1_obj


def _libs_ok():
    """True when the forecasting libraries import (requirements-forecast-v2.txt)."""
    try:
        import prophet, statsforecast, hierarchicalforecast, statsmodels, scipy  # noqa: F401
        return True, ""
    except Exception as e:                                          # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def _read_cache(path):
    import re
    txt = open(path, encoding="utf-8").read()
    return json.loads(gzip.decompress(base64.b64decode(re.search(r'b64Data:"([^"]+)"', txt).group(1))))


def _write_cache(obj, path):
    js = json.dumps(obj, separators=(",", ":"), default=float)
    b64 = base64.b64encode(gzip.compress(js.encode("utf-8"), compresslevel=9)).decode()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write('window.MARKET_FORECAST_CACHE = {b64Data:"' + b64 + '"};\n')
    os.replace(tmp, path)                                           # atomic: the tab never sees a half file
    return len(b64)


def _fit_one(uid, ds_hist, y, h):
    """One series (module level so joblib workers can pickle it)."""
    import logging as _lg
    warnings.filterwarnings("ignore"); _lg.getLogger("cmdstanpy").setLevel(_lg.ERROR)
    r = forecast_series(uid, ds_hist, y, h); r["y_raw"] = y
    return uid, r


def run_all(src, n_jobs=1, cfg=CFG):
    """Forecast every DM1 / BU / Line / Egypt / DM2 series, reconcile, assemble. Returns (out, results, Y_rec)."""
    Y, aggs = load_iqvia_dm1(src)
    dm2, _ = load_iqvia_dm2(src)
    ds_hist = pd.DatetimeIndex(sorted(Y["ds"].unique()))
    origin = ds_hist[-1]
    target_year = origin.year + cfg["target_year_offset"]
    h = (12 - origin.month) + 12                                   # to Dec of target year
    ds_fut = pd.date_range(origin + pd.offsets.MonthBegin(1), periods=h, freq=cfg["freq"])

    bottom = sorted(Y["unique_id"].unique())
    series = {uid: g.sort_values("ds")["y"].values for uid, g in Y.groupby("unique_id")}
    for a, members in aggs.items():                                # aggregates get their own base forecast
        series[a] = np.sum([series[m] for m in members], axis=0)
    series.update(dm2)

    items = sorted(series.items())
    if n_jobs > 1:
        from joblib import Parallel, delayed
        pairs = Parallel(n_jobs=n_jobs, backend="multiprocessing")(delayed(_fit_one)(u, ds_hist, y, h) for u, y in items)
    else:
        pairs = []
        for k, (u, y) in enumerate(items, 1):
            pairs.append(_fit_one(u, ds_hist, y, h)); print(f"  [{k}/{len(items)}] {u}", flush=True)
    results = dict(pairs)

    hier = {k: v for k, v in results.items() if not k.startswith("DM2/")}
    dm2r = {k: v for k, v in results.items() if k.startswith("DM2/")}
    S_df, tags = build_summing_matrix(bottom, aggs)
    Y_rec = reconcile_mint(hier, ds_hist, ds_fut, S_df, tags)
    out = assemble_outputs(hier, Y_rec, aggs, ds_hist, ds_fut, target_year)
    out += standalone_outputs(dm2r, ds_hist, ds_fut, target_year)
    R2 = [pd.DataFrame({"unique_id": u, "ds": ds_fut, "reconciled": r["fit"].mean, "locked": True}) for u, r in dm2r.items()]
    Y_all = pd.concat([Y_rec] + R2, ignore_index=True)
    O = {o["id"]: o for o in out}                                   # coherence guard (DM1 -> BU -> Egypt)
    for a in [x for x in aggs if x == "Egypt" or x.startswith("BU/")]:
        gap = O[a]["fy_target"] - sum(O[b]["fy_target"] for b in aggs[a])
        assert abs(gap) <= 1e-6 * max(1.0, abs(O[a]["fy_target"])), f"coherence broken for {a}: {gap}"
    return out, results, Y_all, target_year


def publish(n_jobs=1):
    """Dashboard refresh step: forecast (champion or v1 fallback) + value (EGP) overlay + business rationale overlay."""
    rc = _publish_forecast(n_jobs)
    if rc == 0:
        try:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from market_forecast_cap import cap_alignment        # 2026-10-16: no DM1 moved > 5 pts by the alignment
            cap_alignment()
            from market_forecast_value import add_value          # 2026-10-15: EGP view (SU forecast x today's price)
            add_value()
            from market_forecast_rationale import add_rationale
            add_rationale()
        except Exception as e:                                      # noqa: BLE001
            import traceback; traceback.print_exc()
            print(f"rationale step failed ({type(e).__name__}); forecast cache kept without rationale")
    return rc


def _publish_forecast(n_jobs=1):
    """Refresh step for the dashboard (config/refresh_map.json -> market_forecast).

    1. If the forecasting libraries are missing: keep the current champion cache when IQVIA has not changed
       since it was built; otherwise fall back to v1 (etl/build_market_forecast.py --cache) so the tab never
       shows a forecast older than its data.
    2. Otherwise run v1 --cache (fresh v1 object = the page skeleton and the classic-method candidates), then
       run the champion tournament and overlay it. If the champion run fails, the fresh v1 cache stays.
    """
    import subprocess, sys
    src = os.path.join(ROOT, "cache", "iqvia.json")
    dst = os.path.join(ROOT, "cache", "market_forecast.data.js")
    v1 = os.path.join(ROOT, "etl", "build_market_forecast.py")
    ok, why = _libs_ok()
    if not ok:
        try:
            cur = _read_cache(dst)
            fresh = os.path.getmtime(dst) >= os.path.getmtime(src)
            if cur.get("meta", {}).get("engine") and fresh:
                print(f"champion libraries missing ({why}); IQVIA unchanged -> champion cache kept")
                print("  install once:  pip install -r requirements-forecast-v2.txt")
                return 0
        except Exception:                                           # noqa: BLE001
            pass
        print(f"champion libraries missing ({why}); IQVIA newer than the forecast -> v1 fallback")
        return subprocess.call([sys.executable, v1, "--cache"])
    rc = subprocess.call([sys.executable, v1, "--cache"])
    if rc != 0:
        print("v1 --cache failed; champion overlay needs it -> previous cache kept"); return rc
    try:
        out, results, Y_all, ty = run_all(src, n_jobs=n_jobs)
        cache = build_dashboard_cache(_read_cache(dst), out, results, Y_all)
        size = _write_cache(cache, dst)
        eng = {}
        for s_ in cache.get("segments", []):
            eng[s_.get("engine", "?")] = eng.get(s_.get("engine", "?"), 0) + 1
        print(f"champion OK: FY{ty}, {len(out)} series, cache {size / 1e6:.2f} MB, engines {eng}")
        return 0
    except Exception as e:                                          # noqa: BLE001
        import traceback; traceback.print_exc()
        print(f"champion run failed ({type(e).__name__}); the fresh v1 cache is kept")
        return 0


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Market Forecast champion-challenger engine (v1 + v2)")
    ap.add_argument("--publish", action="store_true", help="refresh cache/market_forecast.data.js (dashboard step)")
    ap.add_argument("--jobs", type=int, default=max(1, min(4, (os.cpu_count() or 2) - 1)), help="parallel workers")
    a = ap.parse_args()
    if a.publish:
        raise SystemExit(publish(a.jobs))
    ok, why = _libs_ok()
    if not ok:
        raise SystemExit(f"forecasting libraries missing ({why}): pip install -r requirements-forecast-v2.txt")
    out, _, _, ty = run_all(os.path.join(ROOT, "cache", "iqvia.json"), n_jobs=a.jobs)
    od = os.path.join(ROOT, "Claude outputs", "Market Forecast v2"); os.makedirs(od, exist_ok=True)
    with open(os.path.join(od, f"market_forecast_v2_fy{ty}.json"), "w", encoding="utf-8") as fh:
        json.dump({"generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"), "segments": out}, fh, default=float)
    print(f"v2 review OK: {len(out)} series, FY{ty} -> {od}")


if __name__ == "__main__":
    main()
