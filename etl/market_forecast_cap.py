"""
market_forecast_cap.py -- limit how far the hierarchy alignment may move a defined market (2026-10-16, Ahmed).

Why
    The champion engine reconciles every DM1 market with its BU and Egypt totals (MinT). Less reliable markets
    absorb most of that alignment, and a few were moved a long way from their own forecast (e.g. rosuvastatin
    +7.6% -> -11.4%, -19.1 pts). Rule agreed with Ahmed: no defined market may end more than CAP_PTS points
    (of its FY landing estimate) away from its own forecast.

How (runs after the forecast is published, before the value + rationale overlays)
    1. Per BU, a DM1 outside [own forecast +/- CAP_PTS] is set to the nearest edge of that band.
    2. RESPREAD=False (default, agreed 2026-10-16): no other market is touched. RESPREAD=True: what it gives
       back is spread over the other unlocked DM1s of the same BU, each within its own +/- CAP_PTS band.
       Locked (most reliable) markets are never touched.
    3. Anything not re-spread changes the BU total (bottom-up), so every number still adds up exactly:
       BU, Line and Egypt totals are re-summed from their DM1 markets. DM2 markets are not part of the tree.
    4. Only FY+1 months of the monthly path are scaled (the current-year landing estimate is unchanged);
       low/high scenarios scale with the base. Texts quoting the moved points / growth are refreshed.

Usage
    python etl/market_forecast_cap.py            (rewrites cache/market_forecast.data.js in place)
    called from build_market_forecast_v2.publish() before add_value() / add_rationale()
"""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from market_forecast_rationale import read_cache, write_cache  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAP_PTS = 5.0
RESPREAD = False   # 2026-10-16 decision: cap only; the BU total becomes the sum of its markets (no side effects on other markets)


def _fy_idx(meta):
    ty = str(meta["target_year"])
    return [i for i, p in enumerate(meta["future_periods"]) if str(p).startswith(ty)]


def _set_total(seg, new, idx):
    """Scale the FY+1 months of seg's path (and scenarios) so the FY+1 total becomes `new`."""
    f = seg["forecast"]
    old = f["fy_target"]
    k = new / old if old else 1.0
    path = f.get("path") or []
    for i in idx:
        if i < len(path):
            path[i] = path[i] * k
    f["fy_target"] = new
    le = f.get("fy_le")
    if le:
        f["growth_vs_le_pct"] = (new / le - 1) * 100
    sc = f.get("scenarios") or {}
    for key in ("low", "base", "high"):
        if isinstance(sc.get(key), (int, float)):
            sc[key] = sc[key] * k
    if le:
        if isinstance(sc.get("low"), (int, float)):
            sc["low_growth_pct"] = (sc["low"] / le - 1) * 100
        if isinstance(sc.get("high"), (int, float)):
            sc["high_growth_pct"] = (sc["high"] / le - 1) * 100
    return old


def _refresh_texts(seg, old_g, new_g, old_pts=None, new_pts=None, capped_from=None):
    """Update the few engine texts that quote the FY+1 growth or the alignment points."""
    o1, n1 = f"{old_g:+.1f}%", f"{new_g:+.1f}%"
    word = "growth" if new_g >= 0 else "decline"

    def fix(t):
        if not isinstance(t, str):
            return t
        if old_pts is not None and new_pts is not None:
            t = re.sub(r"Moved [+-]?\d+\.\d points so that markets, BUs and Egypt add up exactly\.",
                       f"Moved {new_pts:+.1f} points so that markets, BUs and Egypt add up exactly"
                       + (f" (limited to {CAP_PTS:.0f} points; the full alignment would have moved it {capped_from:+.1f})" if capped_from is not None else "") + ".", t)
        t = re.sub(r"expected (growth|decline) of " + re.escape(o1), f"expected {word} of {n1}", t)
        t = t.replace("forecast at " + o1, "forecast at " + n1).replace("to " + o1 + " in", "to " + n1 + " in")
        return t

    def walk(x):
        if isinstance(x, dict):
            for k2, v in x.items():
                if k2 in ("path", "monthly_su", "history", "scenarios", "scorecard", "value", "candidates", "backtest"):
                    continue
                x[k2] = walk(v)
            return x
        if isinstance(x, list):
            return [walk(v) for v in x]
        return fix(x)

    for key in ("why", "reliability", "confidence_reasons", "selection_rationale"):
        if key in seg:
            seg[key] = walk(seg[key])


def cap_alignment(cache_path=None, cap_pts=CAP_PTS, write=True, verbose=True, respread=RESPREAD):
    cache_path = cache_path or os.path.join(ROOT, "cache", "market_forecast.data.js")
    obj = read_cache(cache_path)
    meta, segs = obj["meta"], obj["segments"]
    idx = _fy_idx(meta)
    dm1 = [s for s in segs if s["type"] == "DM1"]
    groups = {}
    for s in dm1:
        a = (s.get("v2") or {}).get("alignment") or {}
        groups.setdefault(a.get("parent") or "?", []).append(s)

    log, changed = [], {}
    for parent, members in groups.items():
        rows = []
        for s in members:
            a = (s.get("v2") or {}).get("alignment") or {}
            f = s.get("forecast") or {}
            le, b, r = f.get("fy_le"), a.get("base_total"), f.get("fy_target")
            if a.get("locked") or a.get("capped") or not (le and b and r):
                continue
            band = cap_pts / 100 * le
            rows.append({"s": s, "b": b, "r": r, "lo": max(0.0, b - band), "hi": b + band, "le": le})
        excess = 0.0
        for x in rows:
            x["new"] = min(max(x["r"], x["lo"]), x["hi"])
            x["viol"] = abs(x["new"] - x["r"]) > 1e-6
            excess += x["r"] - x["new"]          # >0: must be added to siblings; <0: removed from siblings
        if not any(x["viol"] for x in rows):
            continue
        pool = [x for x in rows if not x["viol"]] if respread else []
        room = [(x["hi"] - x["r"]) if excess > 0 else (x["r"] - x["lo"]) for x in pool]
        tot_room = sum(max(0.0, q) for q in room)
        share = min(1.0, abs(excess) / tot_room) if tot_room > 0 else 0.0
        for x, q in zip(pool, room):
            x["new"] = x["r"] + (1 if excess > 0 else -1) * max(0.0, q) * share
        left = abs(excess) - tot_room * share
        log.append(f"{parent}: {sum(x['viol'] for x in rows)} market(s) limited to +/-{cap_pts:.0f} pts; "
                   + (f"{abs(excess) / 1e6:.1f} M SU re-spread over {len(pool)} market(s)" if respread else "no other market changed")
                   + (f" -> {parent} total {'+' if excess < 0 else '-'}{left / 1e6:.1f} M SU (sum of its markets)" if left > 1 else ""))
        for x in rows:
            if abs(x["new"] - x["r"]) <= 1e-6:
                continue
            s, a = x["s"], s_al(x["s"])
            old_g = s["forecast"]["growth_vs_le_pct"]
            old_pts = (x["r"] - x["b"]) / x["le"] * 100
            _set_total(s, x["new"], idx)
            new_pts = (x["new"] - x["b"]) / x["le"] * 100
            a["reconciled_total"] = x["new"]
            if x["viol"]:
                a["capped"] = {"cap_pts": cap_pts, "mint_total": x["r"], "mint_pts": old_pts}
            else:
                a["absorbed"] = {"mint_total": x["r"], "mint_pts": old_pts}
            _refresh_texts(s, old_g, s["forecast"]["growth_vs_le_pct"], old_pts, new_pts, old_pts if x["viol"] else None)
            changed[s["name"]] = (old_g, s["forecast"]["growth_vs_le_pct"])
            if verbose:
                log.append(f"   {s['name'][:40]:40} {old_g:+6.1f}% -> {s['forecast']['growth_vs_le_pct']:+6.1f}%  "
                           f"(alignment {old_pts:+.1f} -> {new_pts:+.1f} pts){'  LIMITED' if x['viol'] else ''}")

    if changed:   # re-sum every aggregate from its DM1 markets (BU / Line members, Egypt = all DM1)
        by = {s["name"]: s for s in dm1}
        for s in segs:
            if s["type"] not in ("BU", "Line", "Total"):
                continue
            mem = [by[m] for m in (s.get("members") or []) if m in by] if s["type"] != "Total" else dm1
            if not mem or not any(m["name"] in changed for m in mem):
                continue
            f = s["forecast"]
            old_g = f["growth_vs_le_pct"]
            new_path = [sum((m["forecast"].get("path") or [0] * len(f["path"]))[i] for m in mem) for i in range(len(f["path"]))]
            new_fy = sum(m["forecast"]["fy_target"] for m in mem)
            _set_total(s, new_fy, idx)
            f["path"] = new_path
            al = s_al(s)
            if "reconciled_total" in al:
                al["reconciled_total"] = new_fy
            _refresh_texts(s, old_g, f["growth_vs_le_pct"])
            if verbose and abs(f["growth_vs_le_pct"] - old_g) >= 0.05:
                log.append(f"   [{s['type']}] {s['name'][:34]:34} {old_g:+6.1f}% -> {f['growth_vs_le_pct']:+6.1f}%")

    meta["alignment_cap"] = {"cap_pts": cap_pts, "changed": len(changed),
                             "rule": f"No defined market ends more than {cap_pts:.0f} pts away from its own forecast; "
                                     "the rest is spread over the other markets of its BU within the same limit."}
    if verbose:
        print("alignment cap: " + (f"{len(changed)} market(s) changed" if changed else "nothing to change"))
        for line in log:
            print("  " + line)
    if write:
        write_cache(obj, cache_path)
    return obj


def s_al(s):
    s.setdefault("v2", {})
    s["v2"].setdefault("alignment", {})
    return s["v2"]["alignment"]


if __name__ == "__main__":
    cap_alignment()
    sys.exit(0)
