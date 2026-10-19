"""
market_forecast_dm2_align.py -- make every DM2 forecast add up to its DM1 (2026-10-19, Ahmed).

Why
    Ahmed: "when I choose a DM1 and leave DM2 = All, then pick the DM2, FY2027 and growth change - why?"
    The champion engine aligns DM1 -> Line -> BU -> Egypt, but forecast DM2 markets standalone (assumed to
    cut across DM1). In the IQVIA data every DM2 sits inside exactly ONE DM1 and the DM2s of a DM1 add up to it
    exactly (history 2021-2026), so the same market showed two different forecasts (e.g. BELASTINE_CETRIZINE
    DM1 198.9 M / +4.0% vs DM2 206.0 M / +8.0%; ELEMBOSIS 2.5 DM1 98.4 M vs its two DM2s 92.8 M).

Rule
    For every DM1 whose DM2 markets all belong to it only:
      * every future month of each DM2 path is scaled so the DM2s sum to the DM1 path in that month
        (a DM2 that IS the whole DM1 therefore equals the DM1 exactly; split DM2s keep their own trend
        relative to each other);
      * FY landing estimate, FY+1, growth and low/high scenarios follow; texts quoting growth are refreshed.
    A DM2 found in more than one DM1 is left standalone. DM1, Line, BU and Egypt are never changed.

Runs after market_forecast_cap.cap_alignment() and before add_value() / add_rationale().
    python etl/market_forecast_dm2_align.py   (rewrites cache/market_forecast.data.js in place)
"""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from market_forecast_rationale import read_cache, write_cache, load_iqvia, D1I, D2I, SI, TI  # noqa: E402
from market_forecast_cap import _refresh_texts  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def dm1_dm2_map(flat, L):
    """{dm1: [dm2, ...]} from every IQVIA row with sales; plus the set of DM2 found in more than one DM1."""
    rows = flat[flat[:, SI] != 0]
    pr = np.unique(rows[:, [D1I, D2I]], axis=0).tolist()
    by2 = {}
    for a, b in pr:
        by2.setdefault(L["dm2s"][b], set()).add(L["dm1s"][a])
    multi = {k for k, v in by2.items() if len(v) > 1}
    out = {}
    for k, v in by2.items():
        if k not in multi:
            out.setdefault(next(iter(v)), []).append(k)
    return out, multi


def align_dm2(cache_path=None, iqvia_path=None, write=True, verbose=True):
    cache_path = cache_path or os.path.join(ROOT, "cache", "market_forecast.data.js")
    iqvia_path = iqvia_path or os.path.join(ROOT, "cache", "iqvia.json")
    obj = read_cache(cache_path)
    meta, segs = obj["meta"], obj["segments"]
    flat, L = load_iqvia(iqvia_path)
    if L["periods"] != meta["periods"]:
        raise SystemExit("iqvia.json periods differ from the forecast cache - rebuild the forecast first")
    fut = [str(p) for p in meta["future_periods"]]
    py, ty = str(meta["partial_year"]), str(meta["target_year"])
    i_le = [i for i, p in enumerate(fut) if p.startswith(py)]
    i_ty = [i for i, p in enumerate(fut) if p.startswith(ty)]
    T = len(meta["periods"])
    cur_idx = [i for i, p in enumerate(meta["periods"]) if str(p).startswith(py)]
    seg = {(s["type"], s["name"]): s for s in segs}
    mp, multi = dm1_dm2_map(flat, L)
    d2i = {n: i for i, n in enumerate(L["dm2s"])}
    log, n_changed = [], 0
    for dm1, kids in sorted(mp.items()):
        P = seg.get(("DM1", dm1))
        K = [seg[("DM2", k)] for k in kids if ("DM2", k) in seg]
        if not P or not K or len(K) != len(kids):
            continue
        pp = np.array(P["forecast"].get("path") or [], float)
        kp = [np.array(k["forecast"].get("path") or [], float) for k in K]
        if not len(pp) or any(len(x) != len(pp) for x in kp):
            continue
        tot = np.sum(kp, axis=0)
        for k, x in zip(K, kp):
            f = k["forecast"]
            old_g, old_t = f.get("growth_vs_le_pct"), f.get("fy_target")
            new = np.where(tot > 0, x / np.where(tot > 0, tot, 1) * pp, pp / len(K))
            # current-year actual of this DM2 (IQVIA) + its aligned remaining months = landing estimate
            m = flat[:, D2I] == d2i[k["name"]]
            act = float(np.bincount(flat[m, TI], weights=flat[m, SI], minlength=T)[cur_idx].sum())
            le, tgt = act + float(new[i_le].sum()), float(new[i_ty].sum())
            r = tgt / old_t if old_t else 1.0
            f["path"] = [float(v) for v in new]
            f["fy_le"], f["fy_target"] = le, tgt
            f["growth_vs_le_pct"] = (tgt / le - 1) * 100 if le else None
            sc = f.get("scenarios") or {}
            for key in ("low", "base", "high"):
                if isinstance(sc.get(key), (int, float)):
                    sc[key] = sc[key] * r
            if isinstance(sc.get("base"), (int, float)):
                sc["base"] = tgt
            if le:
                for key in ("low", "high"):
                    if isinstance(sc.get(key), (int, float)):
                        sc[key + "_growth_pct"] = (sc[key] / le - 1) * 100
            k.setdefault("v2", {})
            k["v2"]["dm2_to_dm1"] = {"dm1": dm1, "own_total": old_t, "own_growth_pct": old_g,
                                     "rule": "DM2 markets of a DM1 are scaled month by month to add up to the DM1 forecast"}
            if isinstance(old_g, (int, float)) and isinstance(f["growth_vs_le_pct"], (int, float)):
                _refresh_texts(k, old_g, f["growth_vs_le_pct"])
            n_changed += 1
            if verbose:
                log.append(f"   {k['name'][:38]:38} {old_t / 1e6:9.2f} M {old_g:+6.1f}%  ->  {tgt / 1e6:9.2f} M {f['growth_vs_le_pct']:+6.1f}%   (DM1 {dm1[:30]})")
        chk = sum(seg[("DM2", k)]["forecast"]["fy_target"] for k in kids)
        assert abs(chk - P["forecast"]["fy_target"]) <= 1e-6 * max(1.0, P["forecast"]["fy_target"]), f"DM2 sum != DM1 for {dm1}"
    meta["dm2_alignment"] = {"markets": n_changed, "standalone": sorted(multi),
                             "rule": "Every DM2 adds up to its DM1 (same market = same forecast; split markets scaled month by month)."}
    if verbose:
        print(f"DM2 alignment: {n_changed} DM2 market(s) set to add up to their DM1" + (f"; standalone (in several DM1): {sorted(multi)}" if multi else ""))
        for line in log:
            print(line)
    if write:
        write_cache(obj, cache_path)
    return obj


if __name__ == "__main__":
    align_dm2()
    sys.exit(0)
