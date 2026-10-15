"""Market Growth Forecast - Value (EGP) view (2026-10-15, Ahmed: "add value or navigate between SU or value - best practice").

Best practice used: forecast VOLUME (IQVIA Standard Units, the champion engine) and convert it to VALUE with an explicit
price - never forecast EGP directly (Egyptian value history mixes volume with price waves and devaluation steps, so a
statistical value trend would silently extrapolate inflation).

    value forecast = SU forecast x today's price per SU
    today's price per SU = IQVIA LC value / Standard Units over the last 6 actual months, per defined market
                           (includes the current product mix; no further price increase is assumed for FY+1)

- DM1 / DM2 markets: priced with their own last-6-month price per SU.
- BU / Line / Egypt: the exact sum of their DM1 values, so value adds up like volume does.
- FY current-year landing estimate (value) = actual Jan-to-last-month LC value + remaining months' SU forecast x today's price.
- Value growth is split into volume growth and price carry-over (today's price vs this year's average price).

Adds seg["value"]; never changes the SU forecast. Runs in build_market_forecast_v2.py --publish before the rationale step.
Run alone: python etl/market_forecast_value.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from market_forecast_rationale import ROOT, MON, read_cache, write_cache, load_iqvia, D1I, D2I, TI, SI, LI  # noqa: E402

PRICE_MONTHS = 6


def _cagr(a, b, n):
    return ((b / a) ** (1 / n) - 1) * 100 if a and b and a > 0 and b > 0 and n > 0 else None


def add_value(cache_path=None, iqvia_path=None, write=True):
    cache_path = cache_path or os.path.join(ROOT, "cache", "market_forecast.data.js")
    iqvia_path = iqvia_path or os.path.join(ROOT, "cache", "iqvia.json")
    obj = read_cache(cache_path)
    flat, L = load_iqvia(iqvia_path)
    meta = obj["meta"]
    P = meta["periods"]
    if L["periods"] != P:
        raise SystemExit("iqvia.json periods differ from the forecast cache - rebuild the forecast first")
    T = len(P)
    py, ty, pm = meta["partial_year"], meta["target_year"], meta["partial_months"]
    full = [int(y) for y in meta["full_years"]]
    yidx = np.array([int(p[:4]) for p in P])
    midx = np.array([int(p[5:7]) for p in P])
    pw0 = T - PRICE_MONTHS
    d1 = {n: i for i, n in enumerate(L["dm1s"])}
    d2 = {n: i for i, n in enumerate(L["dm2s"])}

    def series(mask):
        su = np.bincount(flat[mask, TI], weights=flat[mask, SI], minlength=T)
        lc = np.bincount(flat[mask, TI], weights=flat[mask, LI], minlength=T)
        return su, lc

    def base_block(lc, su):
        hist = {str(y): float(lc[yidx == y].sum()) for y in full}
        hsu = {str(y): float(su[yidx == y].sum()) for y in full}
        ycur = float(lc[yidx == py].sum())
        ypy = float(lc[(yidx == py - 1) & (midx <= pm)].sum())
        yoy = {f"{a}-{b}": ((hist[str(b)] / hist[str(a)] - 1) * 100 if hist[str(a)] > 0 else None) for a, b in zip(full, full[1:])}
        price_y = {str(y): (hist[str(y)] / hsu[str(y)] if hsu[str(y)] > 0 else None) for y in full}
        su_ytd = float(su[yidx == py].sum())
        price_y[f"{py} YTD"] = ycur / su_ytd if su_ytd > 0 else None
        firstfull = next((y for y in full if hsu[str(y)] > 0 and (su[yidx == y] > 0).all()), None)
        return {"history": hist, "ytd": {"months": f"{MON[0]}-{MON[pm - 1]}", "cur": ycur, "py": ypy,
                                         "growth_pct": (ycur / ypy - 1) * 100 if ypy > 0 else None},
                "yoy_pct": yoy, "price_by_year": price_y,
                "hist_cagr": {"span": f"{firstfull}-{full[-1]}" if firstfull and firstfull < full[-1] else "",
                              "pct": _cagr(hist[str(firstfull)], hist[str(full[-1])], full[-1] - firstfull) if firstfull and firstfull < full[-1] else None},
                "recent_cagr": {"span": f"{full[-3]}-{full[-1]}", "pct": _cagr(hist[str(full[-3])], hist[str(full[-1])], 2)},
                "monthly": [float(v) for v in lc]}

    out = {}
    # 1) defined markets priced on their own
    for seg in obj["segments"]:
        if seg["type"] not in ("DM1", "DM2"):
            continue
        idx = d1 if seg["type"] == "DM1" else d2
        col = D1I if seg["type"] == "DM1" else D2I
        su, lc = series(flat[:, col] == idx[seg["name"]])
        f = seg.get("forecast") or {}
        v = base_block(lc, su)
        su6, lc6 = su[pw0:].sum(), lc[pw0:].sum()
        price = lc6 / su6 if su6 > 0 else None
        su_ytd = float(su[yidx == py].sum())
        if price and f.get("fy_target") is not None:
            path = [float(x) * price for x in (f.get("path") or [])]
            le = v["ytd"]["cur"] + max(0.0, f["fy_le"] - su_ytd) * price
            tgt = f["fy_target"] * price
            v.update({"price_now": price, "fy_le": le, "fy_target": tgt, "path": path})
        out[(seg["type"], seg["name"])] = (v, su_ytd)
    # 2) BU / Line / Egypt = sum of their DM1 values (coherent with the SU hierarchy)
    dm1_names = [s["name"] for s in obj["segments"] if s["type"] == "DM1"]
    for seg in obj["segments"]:
        if seg["type"] in ("DM1", "DM2"):
            continue
        members = dm1_names if seg["type"] == "Total" else (seg.get("members") or [])
        mask = np.ones(len(flat), bool) if seg["type"] == "Total" else np.isin(flat[:, D1I], [d1[m] for m in members if m in d1])
        su, lc = series(mask)
        v = base_block(lc, su)
        parts = [out.get(("DM1", m), (None, 0))[0] for m in members]
        if parts and all(p and p.get("fy_target") is not None for p in parts):
            n = max(len(p["path"]) for p in parts)
            v["path"] = [sum(p["path"][i] for p in parts if i < len(p["path"])) for i in range(n)]
            v["fy_le"] = sum(p["fy_le"] for p in parts)
            v["fy_target"] = sum(p["fy_target"] for p in parts)
            ftsu = (seg.get("forecast") or {}).get("fy_target")
            v["price_now"] = v["fy_target"] / ftsu if ftsu else None
        out[(seg["type"], seg["name"])] = (v, float(su[yidx == py].sum()))

    # 3) growth + volume / price split
    n_ok = 0
    for seg in obj["segments"]:
        v, su_ytd = out[(seg["type"], seg["name"])]
        f = seg.get("forecast") or {}
        if v.get("fy_target") is not None and v.get("fy_le"):
            v["growth_vs_le_pct"] = (v["fy_target"] / v["fy_le"] - 1) * 100
            vol = f.get("growth_vs_le_pct")
            p_le = v["fy_le"] / f["fy_le"] if f.get("fy_le") else None
            p_tg = v["fy_target"] / f["fy_target"] if f.get("fy_target") else None
            v["price_le"] = p_le
            v["volume_effect_pct"] = vol
            v["price_effect_pct"] = (p_tg / p_le - 1) * 100 if p_le and p_tg else None
            n_ok += 1
        v["basis"] = (f"Today's price per Standard Unit = IQVIA LC value / SU, {MON[int(P[pw0][5:7]) - 1]}-{MON[int(P[-1][5:7]) - 1]} "
                      f"{P[-1][:4]} average (current product mix); no further price change assumed for FY{ty}.")
        seg["value"] = v
    meta["value"] = {"unit": "EGP", "measure": "IQVIA LC value", "price_months": PRICE_MONTHS,
                     "price_window": f"{P[pw0]}..{P[-1]}", "built": datetime.now().strftime("%Y-%m-%d %H:%M")}
    if write:
        size = write_cache(obj, cache_path)
        print(f"value OK: {n_ok}/{len(obj['segments'])} markets priced -> {os.path.relpath(cache_path, ROOT)} ({size / 1e6:.2f} MB)")
    return obj


if __name__ == "__main__":
    add_value()
