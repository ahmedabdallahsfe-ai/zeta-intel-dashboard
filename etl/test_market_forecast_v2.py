"""
test_market_forecast_v2.py -- synthetic-market acceptance tests for etl/build_market_forecast_v2.py
Run:  python etl/test_market_forecast_v2.py            (about 5-8 minutes; needs requirements-forecast-v2.txt)

What it checks (2026-10-12 results in brackets):
  T1  growth-break dating        10 markets with a known break + 30 steady markets
                                 [10/10 found, 8/10 within 4 months, 0/30 false alarms]
  T2  annual 80% range           20 markets, true FY2027 vs Low/High
                                 [native Prophet 45-50% -> calibrated + floor 80%]
  T3  end-to-end hierarchy       continuous + launch + intermittent DM1s, overlapping BUs
                                 [exact coherence, locked markets unmoved, no jargon in insights]
"""
import importlib.util, json, logging, os, sys, warnings
import numpy as np, pandas as pd

warnings.filterwarnings("ignore")
logging.getLogger("cmdstanpy").setLevel(logging.ERROR)
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("v2", os.path.join(HERE, "build_market_forecast_v2.py"))
m = importlib.util.module_from_spec(spec); sys.modules["v2"] = m; spec.loader.exec_module(m)

T = 84; t = np.arange(T); DS = pd.date_range("2021-01-01", periods=T, freq="MS")


def synth(seed, brk=None, s1=0.004, s2=0.015, noise=0.05, season=0.15, level=1e6):
    rng = np.random.default_rng(seed)
    slope = np.full(T, s1) if brk is None else np.where(t < brk, s1, s2)
    return level * np.exp(np.cumsum(slope)) * (1 + season * np.cos(2 * np.pi * t / 12)) * rng.lognormal(0, noise, T)


def t1_break_dating():
    found = close = 0
    for seed in range(10):
        rng = np.random.default_rng(100 + seed); brk = int(rng.integers(30, 48))
        s1 = rng.uniform(0, 0.005); s2 = s1 + rng.uniform(0.008, 0.015)
        r = m.detect_trend_break(synth(seed, brk, s1, s2)[:68])
        found += r is not None; close += r is not None and abs(r["index"] - brk) <= 4
    fa = sum(m.detect_trend_break(synth(200 + s, None, 0.006, 0.006)[:68]) is not None for s in range(30))
    print(f"T1 breaks found {found}/10, within 4 months {close}/10, false alarms {fa}/30")
    assert found >= 9 and close >= 7 and fa <= 2


def t2_range_coverage():
    inside_native = inside_final = 0; n = 20
    for seed in range(n):
        rng = np.random.default_rng(500 + seed)
        if seed % 2 == 0:
            brk = int(rng.integers(30, 48)); s1 = rng.uniform(0, 0.005); s2 = s1 + rng.uniform(0.008, 0.015)
        else:
            brk = None; s1 = s2 = rng.uniform(0.002, 0.012)
        full = synth(500 + seed, brk, s1, s2, noise=rng.uniform(0.03, 0.08)); y, ds = full[:68], DS[:68]
        groups = {"p": lambda d, v, hh: {"Prophet": m.fit_prophet(d, v, hh)},
                  "g": lambda d, v, hh: {"Prophet-guided": m.fit_prophet(d, v, hh, guided=True)}}
        sc = m.backtest_tournament(groups, ds, y); best = min(sc, key=lambda k: sc[k]["wape"])
        f = m.fit_prophet(ds, y, 16, guided=(best == "Prophet-guided"))
        idx = np.arange(4, 16); base, lo, hi, _ = m.annual_interval(f, idx); act = full[68:][idx].sum()
        inside_native += lo <= act <= hi
        k, fl = sc[best]["calib"], sc[best]["error_floor"]
        lo2, hi2 = base * (lo / base) ** k, base * (hi / base) ** k
        lo2, hi2 = min(lo2, base * np.exp(-fl)), max(hi2, base * np.exp(fl))
        inside_final += lo2 <= act <= hi2
    print(f"T2 80% range coverage: native {inside_native / n:.0%}, calibrated+floor {inside_final / n:.0%}")
    assert inside_final / n >= 0.65


def t3_end_to_end():
    rng = np.random.default_rng(42); n = 68; ds = DS[:n]
    A = synth(1, 38, 0.003, 0.016, noise=0.04, season=0.2)[:n]; A[57] *= 1.8
    B = synth(2, None, 0.006, 0.006, noise=0.04, season=0.1, level=6e5)[:n]
    C = np.zeros(n); k = np.arange(16); C[52:] = 2e5 / (1 + np.exp(-0.35 * (k - 10))) * rng.lognormal(0, 0.05, 16)
    D = np.where(rng.random(n) < 0.45, 0.0, rng.lognormal(np.log(3e4), 0.3, n))
    bottom = ["DM1/A", "DM1/B", "DM1/C", "DM1/D"]; ser = dict(zip(bottom, [A, B, C, D]))
    aggs = {"Egypt": bottom, "BU/X": ["DM1/A", "DM1/B"], "BU/Y": ["DM1/B", "DM1/C", "DM1/D"]}
    for a, mm in aggs.items():
        ser[a] = np.sum([ser[x] for x in mm], axis=0)
    h = 16; dsf = pd.date_range(ds[-1] + pd.offsets.MonthBegin(1), periods=h, freq="MS")
    res = {}
    for uid, y in ser.items():
        r = m.forecast_series(uid, ds, y, h); r["y_raw"] = y; res[uid] = r
    S, tags = m.build_summing_matrix(bottom, aggs)
    out = {o["id"]: o for o in m.assemble_outputs(res, m.reconcile_mint(res, ds, dsf, S, tags), aggs, ds, dsf, 2027)}
    tot = {k: v["fy_target"] for k, v in out.items()}
    assert abs(tot["Egypt"] - sum(tot[b] for b in bottom)) < 1e-3
    assert abs(tot["BU/Y"] - tot["DM1/B"] - tot["DM1/C"] - tot["DM1/D"]) < 1e-3
    assert res["DM1/C"]["meta"]["segment"] == "launch" and res["DM1/D"]["meta"]["segment"] == "intermittent"
    assert out["DM1/D"]["meta"]["reconciliation"]["locked"]
    assert out["DM1/A"]["meta"]["trend_break"]["date"] in ("2024-01", "2024-02", "2024-03", "2024-04", "2024-05")
    assert any(a["period"] == "2025-10" for a in out["DM1/A"]["meta"]["adjustments"])
    text = json.dumps([o["why"] for o in out.values()]).lower()
    banned = ["wape", "alpha", "changepoint", "stl", "mint", "prophet", "croston", "residual", "winsor", "bass", "loess"]
    assert not [w for w in banned if w in text], "statistical jargon leaked into insights"
    print("T3 end-to-end OK:", {k: f"{v['meta']['growth_pct']:+.1f}%" for k, v in out.items()})


if __name__ == "__main__":
    t1_break_dating(); t2_range_coverage(); t3_end_to_end(); print("ALL TESTS PASSED")
