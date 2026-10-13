"""
build_market_dynamics.py -- MARKET DYNAMICS, TREATMENT SHIFT & GROWTH OUTLOOK (data layer, 2026-10-13)

Phase 1 of the "Market Dynamics & Treatment Shift" tab (approved by Ahmed, SFE Manager, 2026-10-13).
Reads ONLY existing caches; changes nothing else:
  cache/iqvia.json                  68 months of IQVIA Standard Units (same source as Market Intelligence)
  cache/market_forecast.data.js     champion FY2027 forecast (read-only; DM1 / DM2 outlook rows)
  config/market_dynamics_map.json   indications, classes (ATC4 / molecule rules), legacy -> next-gen pairs, thresholds
  js/iqvia-growth-config.js         the dashboard's growth-ranking rules (min share, low-base label), reused as-is

Outputs:
  python etl/build_market_dynamics.py            -> Claude outputs/Market Dynamics/market_dynamics_review_<date>.xlsx
  python etl/build_market_dynamics.py --cache    -> also cache/market_dynamics.data.js (for the tab, Phase 2)

Rules (all in Standard Units):
  * every IQVIA row lands in exactly one class (first matching rule), so indication = sum of its classes
  * volumes are summed first; growth is never an average of percentages
  * a year with incomplete extract coverage is shown but never used as a growth base (no null-as-zero)
  * prior year = 0 -> "New"; growth above the dashboard's low-base limit is flagged "Low base"
  * acceleration = latest YoY % - previous YoY %, in percentage points
"""
from __future__ import annotations

import argparse
import base64
import gzip
import json
import math
import os
import re
import sys
from datetime import datetime

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IQVIA = os.path.join(ROOT, "cache", "iqvia.json")
FORECAST = os.path.join(ROOT, "cache", "market_forecast.data.js")
MAP = os.path.join(ROOT, "config", "market_dynamics_map.json")
OUT_DIR = os.path.join(ROOT, "Claude outputs", "Market Dynamics")
CACHE_OUT = os.path.join(ROOT, "cache", "market_dynamics.data.js")
STRIDE = 14
CI, PI, TI, AI, D1I, D2I, LCVI, SUI, LINEI, BUI, MOLI = 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
FULL_YEARS = list(range(2021, 2026))          # calendar years shown in full


# ----------------------------------------------------------------------------- inputs
def load_iqvia(path=IQVIA):
    d = json.load(open(path, encoding="utf-8"))
    L = d["lookups"]
    flat = np.array(json.loads(gzip.decompress(base64.b64decode(d["b64Data"]))), dtype=np.int64).reshape(-1, STRIDE)
    return L, flat


def load_growth_rules(path):
    """Reuse the Market Intelligence growth rules so both pages label growth the same way."""
    rules = {}
    try:
        txt = open(path, encoding="utf-8").read()
        for k in ("minSharePct", "lowBaseGrowthPct"):
            m = re.search(k + r"\s*:\s*([0-9.]+)", txt)
            if m:
                rules[k] = float(m.group(1))
    except OSError:
        pass
    return rules


def load_forecast(path=FORECAST):
    try:
        txt = open(path, encoding="utf-8").read()
        obj = json.loads(gzip.decompress(base64.b64decode(re.search(r'b64Data:"([^"]+)"', txt).group(1))))
    except Exception:                                                   # noqa: BLE001
        return {}, {}
    seg = {}
    for s in obj.get("segments", []):
        if s.get("type") in ("DM1", "DM2"):
            seg[(s["type"], s["name"])] = s
    return seg, obj.get("meta", {})


# ----------------------------------------------------------------------------- classification
def n_components(mol: str) -> int:
    return len([p for p in mol.split("|") if p.strip()])


def class_of(atc4: str, mol: str, classes: list) -> str | None:
    code = atc4.split(" ")[0]
    for c in classes:
        if not any(code.startswith(a) for a in c.get("atc4", [])):
            continue
        if c.get("molecules") and mol not in c["molecules"]:
            continue
        if c.get("exclude_molecules") and mol in c["exclude_molecules"]:
            continue
        if c.get("components") and n_components(mol) != c["components"]:
            continue
        return c["id"]
    return None


# ----------------------------------------------------------------------------- metrics
def pct(cur, prev):
    if prev is None or cur is None:
        return None
    if prev <= 0:
        return None
    return (cur / prev - 1.0) * 100.0


def series_metrics(monthly, periods, incomplete_years, low_base_pct):
    """monthly: SU per period (len = len(periods)). Returns the metric dict for one series."""
    yrs = np.array([int(p[:4]) for p in periods])
    mon = np.array([int(p[5:7]) for p in periods])
    last_year, last_month = yrs[-1], mon[-1]
    su = {y: float(monthly[yrs == y].sum()) for y in FULL_YEARS}
    valid = {y: (y not in incomplete_years) for y in FULL_YEARS}
    nz = np.flatnonzero(monthly > 0)
    first = periods[nz[0]] if len(nz) else None
    first_year = int(first[:4]) if first else None
    launch_partial = first is not None and first_year > 2021 and int(first[5:7]) > 1   # launch year < 12 months
    m = {"su": su, "first_month": first, "incomplete_years": sorted(incomplete_years), "flags": []}
    if 2021 in incomplete_years:
        m["flags"].append("2021 incomplete in the IQVIA extract (coverage starts mid-2021); not used as a growth base")
    d, g, gl = {}, {}, {}
    for y in FULL_YEARS[1:]:
        if not (valid[y] and valid[y - 1]):
            d[y], g[y], gl[y] = None, None, "incomplete base"
            continue
        d[y] = su[y] - su[y - 1]
        if su[y - 1] <= 0:
            g[y], gl[y] = None, ("New" if su[y] > 0 else None)
        else:
            g[y] = pct(su[y], su[y - 1])
            gl[y] = "Low base" if g[y] is not None and g[y] > low_base_pct else (
                "vs launch year" if launch_partial and y - 1 == first_year else None)
    m["delta"], m["yoy"], m["yoy_label"] = d, g, gl
    # acceleration (pts)
    m["accel"] = (g[2025] - g[2024]) if (g.get(2025) is not None and g.get(2024) is not None) else None
    # YTD
    ytd_mask = lambda y: (yrs == y) & (mon <= last_month)
    cur, py = float(monthly[ytd_mask(last_year)].sum()), float(monthly[ytd_mask(last_year - 1)].sum())
    m["ytd"] = {"months": f"Jan-{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][last_month - 1]}",
                "year": int(last_year), "cur": cur, "py": py, "growth": pct(cur, py),
                "label": ("New" if py <= 0 and cur > 0 else ("Low base" if (pct(cur, py) or 0) > low_base_pct else None))}
    # 2026 landing estimate (seasonal run-rate): YTD x (FY2025 / YTD2025)
    m["le_runrate"] = cur * su[2025] / py if py > 0 and su[2025] > 0 else None
    # multi-year window: first complete year with sales (and not a partial launch year) -> 2025
    start = None
    for y in FULL_YEARS[:-1]:
        if valid[y] and su[y] > 0 and not (launch_partial and y == first_year):
            start = y
            break
    if start is not None and 2025 - start >= 2:
        m["window"] = f"{start}–{str(2025)[2:]}"
        m["cum_delta"] = su[2025] - su[start]
        m["cagr"] = ((su[2025] / su[start]) ** (1.0 / (2025 - start)) - 1.0) * 100.0 if su[2025] > 0 else -100.0
    else:
        m["window"], m["cum_delta"], m["cagr"] = None, None, None
    return m


def quadrant(share, fair, yoy, accel, yoy_prev, ytd_g, label, th):
    """Approved 2026-10-13: Contracting first, then Anchor / Mature (>= fair share), Engine / Niche (below)."""
    if yoy is not None and yoy < 0 and ((yoy_prev is not None and yoy_prev < 0) or (ytd_g is not None and ytd_g < 0)):
        return "Contracting / At-Risk"
    if label == "New":
        return "Growth Engine" if share < fair else "Volume Anchor"
    if yoy is None:
        return "Not classified (no valid growth)"
    if share >= fair:
        if yoy >= th["anchor_min_yoy_pct"] and (accel is None or accel >= th["anchor_min_accel_pts"]):
            return "Volume Anchor"
        return "Mature / Plateauing"
    if yoy >= th["engine_min_yoy_pct"] or (accel is not None and accel >= th["engine_min_accel_pts"]):
        return "Growth Engine"
    return "Niche / Stable"


def rank(items, key, eligible):
    vals = sorted([(key(x), x["id"]) for x in items if eligible(x)], key=lambda t: -t[0])
    return {i: r + 1 for r, (_, i) in enumerate(vals)}


# ----------------------------------------------------------------------------- build
def build(iqvia_path=IQVIA, forecast_path=FORECAST, map_path=MAP, growth_cfg_path=None):
    cfg = json.load(open(map_path, encoding="utf-8"))
    th = cfg["thresholds"]
    rules = load_growth_rules(growth_cfg_path or os.path.join(ROOT, th.get("growth_rules_file", "js/iqvia-growth-config.js")))
    low_base = rules.get("lowBaseGrowthPct", th["default_low_base_growth_pct"])
    min_share = rules.get("minSharePct", th["default_min_share_pct"])
    L, flat = load_iqvia(iqvia_path)
    periods = L["periods"]
    P = len(periods)
    yrs = np.array([int(p[:4]) for p in periods])
    classes = cfg["classes"]
    cls_ids = [c["id"] for c in classes]
    cls_by = {c["id"]: c for c in classes}
    ind_by = {i["id"]: i for i in cfg["indications"]}
    for c in classes:
        assert c["indication"] in ind_by, f"class {c['id']}: unknown indication {c['indication']}"

    # 1. class per (ATC4, molecule) -- fail loudly if any row is unmapped
    pairs_am = np.unique(flat[:, [AI, MOLI]], axis=0)
    cmap, unmapped = {}, []
    for a, mo in pairs_am.tolist():
        cid = class_of(L["atc4s"][a], L["molecules"][mo], classes)
        if cid is None:
            unmapped.append((L["atc4s"][a], L["molecules"][mo]))
        cmap[(a, mo)] = cid
    if unmapped:
        raise SystemExit(f"{len(unmapped)} ATC4/molecule pairs match no class, e.g. {unmapped[:5]} -> edit {map_path}")
    key = flat[:, AI] * 100000 + flat[:, MOLI]
    uk, inv = np.unique(key, return_inverse=True)
    kcls = np.array([cls_ids.index(cmap[(int(k // 100000), int(k % 100000))]) for k in uk])
    row_cls = kcls[inv]
    zeta = L["corps"].index("ZETA PHARM*") if "ZETA PHARM*" in L["corps"] else -1
    is_z = flat[:, CI] == zeta

    def monthly(mask):
        return np.bincount(flat[mask, TI], weights=flat[mask, SUI], minlength=P).astype(float)

    # 2. extract coverage: ATC4 first reported inside 2021 (after January) = coverage gap, not a launch
    atc_first = {}
    tot_by_atc = np.zeros((len(L["atc4s"]), P))
    np.add.at(tot_by_atc, (flat[:, AI], flat[:, TI]), flat[:, SUI])
    coverage_gaps = {}
    for a in range(len(L["atc4s"])):
        nz = np.flatnonzero(tot_by_atc[a] > 0)
        if not len(nz):
            continue
        fp = periods[nz[0]]
        atc_first[a] = fp
        if fp[:4] == "2021" and fp[5:7] != "01":
            coverage_gaps[a] = {2021}

    # 3. classes
    cls_rows = {cid: (row_cls == k) for k, cid in enumerate(cls_ids)}
    out_cls = []
    for k, cid in enumerate(cls_ids):
        msk = cls_rows[cid]
        if not msk.any():
            continue
        atcs = sorted(set(flat[msk, AI].tolist()))
        inc = set().union(*[coverage_gaps.get(a, set()) for a in atcs]) if atcs else set()
        s = monthly(msk)
        z = monthly(msk & is_z)
        met = series_metrics(s, periods, inc, low_base)
        out_cls.append({"id": cid, "name": cls_by[cid]["name"], "indication": cls_by[cid]["indication"],
                        "atc4": [L["atc4s"][a] for a in atcs], "rule": {k2: v for k2, v in cls_by[cid].items() if k2 in ("atc4", "molecules", "exclude_molecules", "components")},
                        "monthly": s, "zeta_su2025": float(z[yrs == 2025].sum()), "zeta_active": bool(z[yrs >= 2025].sum() > 0),
                        "n_molecules": int(len(set(flat[msk, MOLI].tolist()))), **met})

    # 4. indications = sum of classes (incomplete if any class incomplete)
    out_ind = []
    for ind in cfg["indications"]:
        members = [c for c in out_cls if c["indication"] == ind["id"]]
        if not members:
            continue
        s = np.sum([c["monthly"] for c in members], axis=0)
        inc = set().union(*[set(c["incomplete_years"]) for c in members])
        met = series_metrics(s, periods, inc, low_base)
        z25 = sum(c["zeta_su2025"] for c in members)
        out_ind.append({"id": ind["id"], "name": ind["name"], "classes": [c["id"] for c in members], "monthly": s,
                        "zeta_su2025": z25, "zeta_share2025": (z25 / met["su"][2025] * 100) if met["su"][2025] > 0 else None, **met})
    ind_map = {i["id"]: i for i in out_ind}

    # 5. class shares, ranks and quadrants within the indication
    for ind in out_ind:
        members = [c for c in out_cls if c["indication"] == ind["id"]]
        tot = ind["su"][2025]
        fair = 100.0 / len(members)
        for c in members:
            c["share2025"] = c["su"][2025] / tot * 100 if tot > 0 else None
            c["share2024"] = c["su"][2024] / ind["su"][2024] * 100 if ind["su"][2024] > 0 else None
            c["share_ytd"] = c["ytd"]["cur"] / ind["ytd"]["cur"] * 100 if ind["ytd"]["cur"] > 0 else None
            c["fair_share"] = fair
        rv = rank(members, lambda x: x["su"][2025], lambda x: x["su"][2025] > 0)
        rg = rank(members, lambda x: x["yoy"][2025], lambda x: x["yoy"][2025] is not None and x["yoy_label"][2025] != "Low base"
                  and (x["share2025"] or 0) >= min_share)
        for c in members:
            c["rank_volume"], c["rank_growth"] = rv.get(c["id"]), rg.get(c["id"])
            c["quadrant"] = quadrant(c["share2025"] or 0, fair, c["yoy"][2025], c["accel"], c["yoy"][2024],
                                     c["ytd"]["growth"], c["yoy_label"][2025], th)

    # 6. markets (DM1 / DM2): indication = where most of their SU sits; OTHER MARKET is the residual, excluded
    fc, fc_meta = load_forecast(forecast_path)
    out_mkt = []
    for typ, col, lk in (("DM1", D1I, "dm1s"), ("DM2", D2I, "dm2s")):
        for i, name in enumerate(L[lk]):
            if name in ("(none)", "OTHER MARKET", ""):
                continue
            msk = flat[:, col] == i
            if not msk.any():
                continue
            s = monthly(msk)
            tot_all = s.sum()
            by_cls = np.bincount(row_cls[msk], weights=flat[msk, SUI], minlength=len(cls_ids))
            by_ind = {}
            for k, v in enumerate(by_cls):
                if v > 0:
                    by_ind[cls_by[cls_ids[k]]["indication"]] = by_ind.get(cls_by[cls_ids[k]]["indication"], 0) + v
            ind_id = max(by_ind, key=by_ind.get)
            atcs = sorted(set(flat[msk, AI].tolist()))
            inc = set().union(*[coverage_gaps.get(a, set()) for a in atcs])
            met = series_metrics(s, periods, inc, low_base)
            # how the market relates to the classes (= class / part of class / spans)
            yr25 = yrs[flat[msk, TI]] == 2025
            c25 = np.bincount(row_cls[msk][yr25], weights=flat[msk, SUI][yr25], minlength=len(cls_ids))
            top = [(cls_ids[k], v) for k, v in sorted(enumerate(c25), key=lambda t: -t[1]) if v > 0]
            cls_su = {c["id"]: c["su"][2025] for c in out_cls}
            if len(top) == 1:
                cid, v = top[0]
                rel = f"same as {cid}" if cls_su[cid] > 0 and abs(v / cls_su[cid] - 1) < 0.005 else f"part of {cid} ({v / cls_su[cid] * 100:.0f}% of class)"
            elif top:
                rel = "spans " + ", ".join(f"{cid} {v / sum(t[1] for t in top) * 100:.0f}%" for cid, v in top[:3])
            else:
                rel = "no 2025 sales"
            f = fc.get((typ, name))
            fo = None
            if f:
                fcst = f.get("forecast") or {}
                sc = fcst.get("scenarios") or {}
                fo = {"le": fcst.get("fy_le"), "fy27": fcst.get("fy_target"), "growth": fcst.get("growth_vs_le_pct"),
                      "low_pct": sc.get("low_growth_pct"), "high_pct": sc.get("high_growth_pct"),
                      "confidence": f.get("confidence"), "engine": f.get("engine"), "method": f.get("selected_label"),
                      "history": {int(y): v.get("su") for y, v in (f.get("history") or {}).items()}}
            out_mkt.append({"id": f"{typ}/{name}", "type": typ, "name": name, "indication": ind_id,
                            "pct_in_indication": by_ind[ind_id] / tot_all * 100 if tot_all > 0 else None,
                            "class_relation": rel, "atc4": [L["atc4s"][a] for a in atcs], "monthly": s,
                            "zeta_su2025": float(monthly(msk & is_z)[yrs == 2025].sum()), "forecast": fo, **met})
    for ind in out_ind:
        for typ in ("DM1", "DM2"):
            mk = [m for m in out_mkt if m["indication"] == ind["id"] and m["type"] == typ]
            # Approved 2026-10-13 (Ahmed): a market's fair share = 1 / number of MARKETS in the indication
            # (our defined markets of this type + the rest of the indication as one more competitor when it holds
            # >= 0.5% of the indication), not 1 / number of classes.
            rest = ind["su"][2025] - sum(m["su"][2025] for m in mk)
            n_slots = len(mk) + (1 if ind["su"][2025] > 0 and rest / ind["su"][2025] >= 0.005 else 0)
            fair = 100.0 / max(1, n_slots)
            for m in mk:
                m["share2025"] = m["su"][2025] / ind["su"][2025] * 100 if ind["su"][2025] > 0 else None
                m["fair_share"] = fair
            rv = rank(mk, lambda x: x["su"][2025], lambda x: x["su"][2025] > 0)
            rg = rank(mk, lambda x: x["yoy"][2025], lambda x: x["yoy"][2025] is not None and x["yoy_label"][2025] != "Low base"
                      and (x["share2025"] or 0) >= min_share)
            for m in mk:
                m["rank_volume"], m["rank_growth"] = rv.get(m["id"]), rg.get(m["id"])
                m["quadrant"] = quadrant(m["share2025"] or 0, fair, m["yoy"][2025], m["accel"], m["yoy"][2024],
                                         m["ytd"]["growth"], m["yoy_label"][2025], th)

    # 7. treatment shift per pair
    cmet = {c["id"]: c for c in out_cls}
    out_pairs = []
    for p in cfg["pairs"]:
        leg = [cmet[x] for x in p["legacy"] if x in cmet]
        nxt = [cmet[x] for x in p["next_gen"] if x in cmet]
        ind = ind_map[p["indication"]]
        Ls = np.sum([c["monthly"] for c in leg], axis=0)
        Ns = np.sum([c["monthly"] for c in nxt], axis=0)
        inc = set().union(*[set(c["incomplete_years"]) for c in leg + nxt])
        lm = series_metrics(Ls, periods, inc, low_base)
        nm = series_metrics(Ns, periods, inc, low_base)
        rows = []
        steps = [(y, y - 1) for y in FULL_YEARS[1:]] + [("YTD", None)]
        for y, yp in steps:
            if y == "YTD":
                Lc, Lp, Nc, Np_, Ic, Ip = lm["ytd"]["cur"], lm["ytd"]["py"], nm["ytd"]["cur"], nm["ytd"]["py"], ind["ytd"]["cur"], ind["ytd"]["py"]
                lyp = lm["yoy"].get(2025)
                label = f"{lm['ytd']['months']} {lm['ytd']['year']} vs {lm['ytd']['year'] - 1}"
            else:
                if y in inc or yp in inc:
                    rows.append({"period": f"{yp}→{y}", "note": "incomplete base year, not measured"})
                    continue
                Lc, Lp, Nc, Np_, Ic, Ip = lm["su"][y], lm["su"][yp], nm["su"][y], nm["su"][yp], ind["su"][y], ind["su"][yp]
                lyp = lm["yoy"].get(yp)
                label = f"{yp}→{y}"
            ld, nd, idl = Lc - Lp, Nc - Np_, Ic - Ip
            loss = max(0.0, -ld)
            expected = Lp * max(0.0, lyp) / 100.0 if lyp is not None else None
            shortfall = max(0.0, expected - ld) if expected is not None else loss
            # share of the next-gen gain that legacy losses can explain (0-100%); soft = vs the legacy's own trend
            hard = min(loss, nd) / nd * 100 if nd > 0 else None
            soft = min(shortfall, nd) / nd * 100 if nd > 0 else None
            if nd <= 0:
                flag = "No next-gen gain"
            elif ld < 0 and loss > th.get("legacy_decline_multiple", 2.0) * nd:
                flag = "Legacy Decline (not replaced)"       # legacy volume is leaving the market, not moving to next-gen
            elif ld < 0 and (hard or 0) >= th["substitution_min_ratio_pct"]:
                flag = "Class Substitution"
            elif ld >= 0 and (soft or 0) < th["substitution_min_ratio_pct"]:
                flag = "Segment Deepening"
            else:
                flag = "Mixed"
            rows.append({"period": label, "legacy_prev": Lp, "legacy_cur": Lc, "legacy_delta": ld, "legacy_growth": pct(Lc, Lp),
                         "next_prev": Np_, "next_cur": Nc, "next_delta": nd, "next_growth": pct(Nc, Np_) if Np_ > 0 else None,
                         "ind_delta": idl, "ind_growth": pct(Ic, Ip), "legacy_loss": loss, "legacy_shortfall_vs_trend": shortfall,
                         "substitution_ratio": hard, "soft_substitution_ratio": soft,
                         "pool_expanding": bool(idl > 0 and idl > loss),
                         "next_share_pair": Nc / (Lc + Nc) * 100 if (Lc + Nc) > 0 else None,
                         "next_share_ind": Nc / Ic * 100 if Ic > 0 else None, "flag": flag})
        measured = [r for r in rows if "flag" in r]
        latest = measured[-1] if measured else None
        out_pairs.append({"id": p["id"], "name": p["name"], "indication": p["indication"], "legacy": p["legacy"],
                          "next_gen": p["next_gen"], "gap": p.get("_gap"), "rows": rows,
                          "latest_flag": latest["flag"] if latest else None,
                          "latest_period": latest["period"] if latest else None})

    # 8. provisional outlook badge per indication (history only; FY2027 joins in Phase 3)
    for ind in out_ind:
        pf = [p["latest_flag"] for p in out_pairs if p["indication"] == ind["id"]]
        g25, gy = ind["yoy"].get(2025), ind["ytd"]["growth"]
        if "Class Substitution" in pf:
            b = "Structural Substitution Underway"
        elif g25 is not None and gy is not None and g25 >= th["outlook_expanding_min_pct"] and gy >= th["outlook_expanding_min_pct"]:
            b = "Expanding Market"
        elif gy is not None and gy <= th["outlook_contracting_max_pct"] and (g25 is None or g25 <= th["outlook_expanding_min_pct"]):
            b = "Contracting Market"
        else:
            b = "Mature / Replacement Demand"
        ind["outlook_badge"] = b
        ind["outlook_basis"] = "provisional: 2025 and YTD growth + treatment-shift flag; FY2027 indication forecast joins in Phase 3"

    # 9. checks
    total = monthly(np.ones(len(flat), bool))
    checks = []
    csum = np.sum([c["monthly"] for c in out_cls], axis=0)
    checks.append(("All classes add up to the whole IQVIA extract (every month)", float(np.abs(csum - total).max()), "SU", np.abs(csum - total).max() < 0.5))
    worst = 0.0
    for ind in out_ind:
        sm = np.sum([c["monthly"] for c in out_cls if c["indication"] == ind["id"]], axis=0)
        worst = max(worst, float(np.abs(sm - ind["monthly"]).max()))
    checks.append(("Each indication = sum of its classes (every month)", worst, "SU", worst < 0.5))
    hd = []
    for m in out_mkt:
        h = (m.get("forecast") or {}).get("history") or {}
        for y in FULL_YEARS:
            if h.get(y) is not None:
                hd.append(abs(h[y] - m["su"][y]))
    checks.append(("DM1 / DM2 annual SU = Market Growth Forecast tab history (2021-2025)", max(hd) if hd else None, "SU", bool(hd) and max(hd) < 0.5))
    nfc = sum(1 for m in out_mkt if m.get("forecast") is None)
    checks.append(("Markets without a champion forecast", nfc, "markets", nfc == 0))
    checks.append(("ATC4 / molecule pairs mapped", len(pairs_am), "pairs (0 unmapped)", True))
    bad = 0
    for s_ in out_cls + out_ind + out_mkt:
        for y in FULL_YEARS[1:]:
            if s_["yoy"][y] is not None and (y - 1 in s_["incomplete_years"] or s_["su"][y - 1] <= 0):
                bad += 1
    checks.append(("Growth figures computed on a zero or incomplete base", bad, "cells", bad == 0))

    meta = {"generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"), "data_period": periods[-1],
            "periods": periods, "measure": "Standard Units", "map_version": cfg.get("version"),
            "growth_rules": {"min_share_pct": min_share, "low_base_growth_pct": low_base},
            "thresholds": th, "coverage_gaps": {L["atc4s"][a]: sorted(v) for a, v in coverage_gaps.items()},
            "forecast_generated_at": fc_meta.get("generated_at"), "forecast_engine": fc_meta.get("engine"),
            "total_su": {y: float(total[yrs == y].sum()) for y in FULL_YEARS},
            "molecule_map": [(L["atc4s"][a], L["molecules"][mo], cmap[(a, mo)]) for a, mo in pairs_am.tolist()]}
    y25 = yrs[flat[:, TI]] == 2025
    vals =np.bincount(inv[y25], weights=flat[y25, SUI], minlength=len(uk))
    meta["molecule_su2025"] = {(int(k // 100000), int(k % 100000)): float(v) for k, v in zip(uk, vals)}
    return {"meta": meta, "indications": out_ind, "classes": out_cls, "markets": out_mkt, "pairs": out_pairs,
            "checks": checks, "config": cfg, "lookups": {"atc4s": L["atc4s"], "molecules": L["molecules"]}}


# ----------------------------------------------------------------------------- workbook
def write_workbook(M, path):
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    F = "Arial"
    H_FILL = PatternFill("solid", fgColor="0F4C81")
    H_FONT = Font(name=F, bold=True, color="FFFFFF", size=10)
    B_FONT = Font(name=F, size=10)
    BOLD = Font(name=F, size=10, bold=True)
    T_FONT = Font(name=F, size=14, bold=True, color="0F4C81")
    NOTE = Font(name=F, size=9, italic=True, color="64748B")
    BAND = PatternFill("solid", fgColor="F1F5F9")
    OK = PatternFill("solid", fgColor="DCFCE7")
    BADF = PatternFill("solid", fgColor="FEE2E2")
    QF = {"Volume Anchor": "DBEAFE", "Growth Engine": "DCFCE7", "Mature / Plateauing": "FEF3C7",
          "Contracting / At-Risk": "FEE2E2", "Niche / Stable": "F1F5F9"}
    FF = {"Class Substitution": "FEE2E2", "Segment Deepening": "DCFCE7", "Mixed": "FEF3C7", "No next-gen gain": "F1F5F9",
          "Legacy Decline (not replaced)": "E0E7FF"}
    thin = Side(style="thin", color="E2E8F0")
    BORDER = Border(bottom=thin)
    MSU, PCT, PTS = '#,##0.0;-#,##0.0;"-"', '+0.0%;-0.0%;0.0%', '+0.0;-0.0;0.0'
    M_ = lambda v: None if v is None else v / 1e6
    P_ = lambda v: None if v is None else v / 100.0

    wb = Workbook()
    meta = M["meta"]

    def fmt_for(h):
        if h.startswith("Acceleration"):
            return PTS
        if "(M)" in h:
            return MSU
        if h.startswith(("YoY", "YTD growth", "CAGR", "Share", "Fair share", "Zeta share", "% of", "FY2027 growth", "Range",
                         "Legacy growth", "Next-gen growth", "Indication growth", "Substitution", "Soft", "Next-gen share")):
            return PCT
        return None

    def sheet(title, headers, rows, widths=None, fmts=None, title_text=None, note=None, fills=None):
        ws = wb.create_sheet(title)
        r0 = 1
        if title_text:
            ws.cell(1, 1, title_text).font = T_FONT
            if note:
                ws.cell(2, 1, note).font = NOTE
            r0 = 4
        for j, h in enumerate(headers, 1):
            c = ws.cell(r0, j, h)
            c.font, c.fill = H_FONT, H_FILL
            c.alignment = Alignment(wrap_text=True, vertical="center")
        ws.row_dimensions[r0].height = 32
        colfmt = {j: fmt_for(h) for j, h in enumerate(headers, 1)}
        colfill = {j: fills[h] for j, h in enumerate(headers, 1) if fills and h in fills}
        for i, row in enumerate(rows, r0 + 1):
            for j, v in enumerate(row, 1):
                c = ws.cell(i, j, v)
                c.font, c.border = B_FONT, BORDER
                if colfmt.get(j) and isinstance(v, (int, float)) and not isinstance(v, bool):
                    c.number_format = colfmt[j]
                if j in colfill and isinstance(v, str) and v in colfill[j]:
                    c.fill = PatternFill("solid", fgColor=colfill[j][v])
        for j, w in enumerate(widths or [], 1):
            ws.column_dimensions[get_column_letter(j)].width = w
        ws.freeze_panes = ws.cell(r0 + 1, 3)
        if rows:
            ws.auto_filter.ref = f"A{r0}:{get_column_letter(len(headers))}{r0 + len(rows)}"
        return ws, r0

    def g_or_label(m, y):
        lab = m["yoy_label"].get(y)
        v = m["yoy"].get(y)
        if v is None:
            return lab or ("—" if lab is None else lab)
        return P_(v)

    yrs = FULL_YEARS
    ytd = M["indications"][0]["ytd"]
    ytdl = f"{ytd['months']}"
    # ---------- README
    ws = wb.active
    ws.title = "README"
    lines = [
        ("Market Dynamics, Treatment Shift & Growth Outlook — Phase 1 review workbook", T_FONT),
        (f"Built {meta['generated_at']} from cache/iqvia.json (data to {meta['data_period']}) and the champion forecast "
         f"(built {meta.get('forecast_generated_at')}). Measure: IQVIA Standard Units (SU), shown in millions.", B_FONT),
        ("", B_FONT),
        ("What to check", BOLD),
        ("1. Indications: totals and growth per indication (sum of its classes).", B_FONT),
        ("2. Classes: every class with its share, rank, quadrant and flags; the mapping rule is in the Mapping sheet.", B_FONT),
        ("3. Markets: our DM1 and DM2 markets placed in their indication, with the champion FY2027 figures.", B_FONT),
        ("4. Treatment_Shift: each approved legacy → next-gen pair, year by year, with the flag.", B_FONT),
        ("5. Checks: automatic reconciliations (green = pass) plus live Excel formulas that recompute key figures.", B_FONT),
        ("6. Mapping: every ATC4 / molecule and the class it was assigned to, with 2025 SU.", B_FONT),
        ("", B_FONT),
        ("Rules", BOLD),
        ("• Volumes are summed first; indication growth is never an average of class growth rates.", B_FONT),
        ("• YoY % = SU year / SU previous year − 1. ΔSU = SU year − SU previous year. Acceleration = YoY 2025 − YoY 2024, in percentage points.", B_FONT),
        ("• \"New\" = no sales in the previous year. \"—\" = not measurable. \"Low base\" = growth above "
         f"+{meta['growth_rules']['low_base_growth_pct']:,.0f}% (same rule as Market Intelligence).", B_FONT),
        ("• Incomplete years: ATC4s first reported inside 2021 (after January) have an incomplete 2021 in the extract. "
         "That year is shown but never used as a growth base; their multi-year window starts in 2022.", B_FONT),
        ("• Launches after 2021: the launch year is partial, so the multi-year window starts the year after; the growth "
         "against the launch year is labelled \"vs launch year\".", B_FONT),
        (f"• Ranks are within the indication. Growth rank only for items with ≥ {meta['growth_rules']['min_share_pct']}% share "
         "and a valid, non-low-base growth.", B_FONT),
        ("• Quadrants (first match wins): Contracting / At-Risk (YoY < 0 two years running, or 2025 and YTD both < 0) → "
         "at or above fair share: Volume Anchor (YoY ≥ 5% and acceleration ≥ −5 pts) else Mature / Plateauing → below fair share: "
         "Growth Engine (YoY ≥ 10% or acceleration ≥ +5 pts) else Niche / Stable. Fair share = 1 ÷ number of classes in the indication.", B_FONT),
        ("• Treatment shift: substitution ratio = share of the next-gen SU gain that legacy SU losses can explain "
         "(legacy lost ÷ next-gen gained, capped at 100%). Soft ratio uses the legacy shortfall versus its own previous growth rate. "
         "Flags, first match wins: Legacy Decline (not replaced) = legacy lost more than 2× the next-gen gain; Class Substitution = "
         "legacy falling and ratio ≥ 50%; Segment Deepening = legacy stable or growing and soft ratio < 50%; otherwise Mixed.", B_FONT),
        (f"• 2026 LE (run-rate) for classes and indications = {ytdl} 2026 × (FY2025 ÷ {ytdl} 2025). DM1 / DM2 LE and FY2027 come "
         "from the champion forecast unchanged.", B_FONT),
        ("• Outlook badge is provisional (history + shift flag). The indication FY2027 forecast is added in Phase 3.", B_FONT),
        ("", B_FONT),
        ("Scope note: the IQVIA extract holds 59 ATC4 classes, not the whole Egypt market. 'Indication total' means all classes of "
         "that indication in the extract. Gaps per pair are listed in Treatment_Shift.", NOTE),
    ]
    for i, (t, f_) in enumerate(lines, 1):
        c = ws.cell(i, 1, t)
        c.font = f_
        c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.column_dimensions["A"].width = 150

    # ---------- Indications
    H = (["Indication", "ID", "Classes", *[f"SU {y} (M)" for y in yrs], f"SU {ytdl} 2025 (M)", f"SU {ytdl} 2026 (M)", "2026 LE run-rate (M)",
          *[f"ΔSU {y} (M)" for y in yrs[1:]], *[f"YoY {y}" for y in yrs[1:]], f"YTD growth {ytdl} 26", "Acceleration 25 vs 24 (pts)",
          "Multi-year window", "Cumulative ΔSU (M)", "CAGR", "Zeta SU 2025 (M)", "Zeta share 2025", "Outlook badge (provisional)", "Flags"])
    rows = []
    for i in M["indications"]:
        rows.append([i["name"], i["id"], len(i["classes"]), *[M_(i["su"][y]) for y in yrs], M_(i["ytd"]["py"]), M_(i["ytd"]["cur"]),
                     M_(i["le_runrate"]), *[M_(i["delta"][y]) for y in yrs[1:]], *[g_or_label(i, y) for y in yrs[1:]],
                     P_(i["ytd"]["growth"]) if i["ytd"]["growth"] is not None else (i["ytd"]["label"] or "—"),
                     i["accel"], i["window"] or "—", M_(i["cum_delta"]), P_(i["cagr"]), M_(i["zeta_su2025"]),
                     P_(i["zeta_share2025"]), i["outlook_badge"], "; ".join(i["flags"])])
    rows.sort(key=lambda r: -(r[7] or 0))
    fm = {**{j: MSU for j in range(4, 15)}, **{j: MSU for j in range(15, 19)}, **{j: PCT for j in range(19, 24)}, 24: PTS,
          26: MSU, 27: PCT, 28: MSU, 29: PCT}
    sheet("Indications", H, rows, [34, 11, 8] + [10] * 25 + [30, 60], fm,
          "Indications — sum of their classes", "Sorted by 2025 volume. SU in millions. Growth computed on summed SU.")

    # ---------- Classes
    H = (["Indication", "Class", "Class ID", "Pair role", "ATC4", "Molecules", *[f"SU {y} (M)" for y in yrs], f"SU {ytdl} 2026 (M)",
          "2026 LE run-rate (M)", *[f"ΔSU {y} (M)" for y in yrs[1:]], *[f"YoY {y}" for y in yrs[1:]], f"YTD growth {ytdl} 26",
          "Acceleration (pts)", "Multi-year window", "Cumulative ΔSU (M)", "CAGR", "Share of indication 2024", "Share of indication 2025",
          f"Share {ytdl} 26", "Fair share", "Rank volume", "Rank growth", "Quadrant", "Zeta active", "Flags"])
    role = {}
    for p in M["config"]["pairs"]:
        for c in p["legacy"]:
            role[c] = f"Legacy — {p['name']}"
        for c in p["next_gen"]:
            role[c] = f"Next-gen — {p['name']}"
    indname = {i["id"]: i["name"] for i in M["indications"]}
    rows = []
    for c in M["classes"]:
        rows.append([indname[c["indication"]], c["name"], c["id"], role.get(c["id"], "—"), ", ".join(a.split(" ")[0] for a in c["atc4"]),
                     c["n_molecules"], *[M_(c["su"][y]) for y in yrs], M_(c["ytd"]["cur"]), M_(c["le_runrate"]),
                     *[M_(c["delta"][y]) for y in yrs[1:]], *[g_or_label(c, y) for y in yrs[1:]],
                     P_(c["ytd"]["growth"]) if c["ytd"]["growth"] is not None else (c["ytd"]["label"] or "—"),
                     c["accel"], c["window"] or "—", M_(c["cum_delta"]), P_(c["cagr"]), P_(c["share2024"]), P_(c["share2025"]),
                     P_(c["share_ytd"]), P_(c["fair_share"]), c["rank_volume"], c["rank_growth"], c["quadrant"],
                     "Yes" if c["zeta_active"] else "No", "; ".join(c["flags"])])
    rows.sort(key=lambda r: (r[0], -(r[10] or 0)))
    fm = {**{j: MSU for j in range(7, 19)}, **{j: PCT for j in range(19, 24)}, 24: PTS, 26: MSU, 27: PCT,
          28: PCT, 29: PCT, 30: PCT, 31: PCT}
    sheet("Classes", H, rows, [30, 40, 11, 30, 18, 9] + [10] * 25 + [22, 9, 50], fm,
          "Classes — benchmarked within their indication", "Quadrant colours: blue Anchor, green Engine, amber Mature, red Contracting, grey Niche.",
          fills={"Quadrant": QF})

    # ---------- Markets
    H = (["Type", "Market", "Indication", "% of market SU in this indication", "Relation to classes", *[f"SU {y} (M)" for y in yrs],
          f"SU {ytdl} 2026 (M)", *[f"YoY {y}" for y in yrs[1:]], f"YTD growth {ytdl} 26", "Acceleration (pts)", "Multi-year window", "CAGR",
          "Share of indication 2025", "Rank volume", "Rank growth", "Quadrant", "Champion 2026 LE (M)", "Champion FY2027 (M)",
          "FY2027 growth vs LE", "Range low", "Range high", "Confidence", "Winning engine", "Method", "Flags"])
    rows = []
    for m in M["markets"]:
        fo = m.get("forecast") or {}
        rows.append([m["type"], m["name"], indname[m["indication"]], P_(m["pct_in_indication"]), m["class_relation"],
                     *[M_(m["su"][y]) for y in yrs], M_(m["ytd"]["cur"]), *[g_or_label(m, y) for y in yrs[1:]],
                     P_(m["ytd"]["growth"]) if m["ytd"]["growth"] is not None else (m["ytd"]["label"] or "—"),
                     m["accel"], m["window"] or "—", P_(m["cagr"]), P_(m["share2025"]), m["rank_volume"], m["rank_growth"],
                     m["quadrant"], M_(fo.get("le")), M_(fo.get("fy27")), P_(fo.get("growth")), P_(fo.get("low_pct")),
                     P_(fo.get("high_pct")), fo.get("confidence"), fo.get("engine"), fo.get("method"), "; ".join(m["flags"])])
    rows.sort(key=lambda r: (r[0], r[2], -(r[9] or 0)))
    fm = {4: PCT, **{j: MSU for j in range(6, 12)}, **{j: PCT for j in range(12, 17)}, 17: PTS, 19: PCT, 20: PCT,
          24: MSU, 25: MSU, 26: PCT, 27: PCT, 28: PCT}
    sheet("Markets", H, rows, [6, 36, 30, 11, 34] + [10] * 18 + [22] + [11] * 5 + [12, 12, 30, 50], fm,
          "Our markets (DM1 / DM2) in their indication", "FY2027 columns are read unchanged from the champion forecast (Market Growth Forecast tab). "
          "OTHER MARKET is the residual and is excluded.", fills={"Quadrant": QF})

    # ---------- Treatment shift
    H = ["Pair", "Indication", "Period", "Legacy SU prev (M)", "Legacy SU (M)", "Legacy ΔSU (M)", "Legacy growth",
         "Next-gen SU prev (M)", "Next-gen SU (M)", "Next-gen ΔSU (M)", "Next-gen growth", "Indication ΔSU (M)", "Indication growth",
         "Legacy SU lost (M)", "Legacy shortfall vs own trend (M)", "Substitution ratio", "Soft substitution ratio", "Pool expanding?",
         "Next-gen share of pair", "Next-gen share of indication", "Flag", "Data gap"]
    rows = []
    for p in M["pairs"]:
        for r in p["rows"]:
            if "flag" not in r:
                rows.append([p["name"], indname[p["indication"]], r["period"]] + [None] * 17 + [r["note"], p.get("gap") or ""])
                continue
            rows.append([p["name"], indname[p["indication"]], r["period"], M_(r["legacy_prev"]), M_(r["legacy_cur"]), M_(r["legacy_delta"]),
                         P_(r["legacy_growth"]), M_(r["next_prev"]), M_(r["next_cur"]), M_(r["next_delta"]), P_(r["next_growth"]),
                         M_(r["ind_delta"]), P_(r["ind_growth"]), M_(r["legacy_loss"]), M_(r["legacy_shortfall_vs_trend"]),
                         P_(r["substitution_ratio"]), P_(r["soft_substitution_ratio"]), "Yes" if r["pool_expanding"] else "No",
                         P_(r["next_share_pair"]), P_(r["next_share_ind"]), r["flag"], p.get("gap") or ""])
    fm = {4: MSU, 5: MSU, 6: MSU, 7: PCT, 8: MSU, 9: MSU, 10: MSU, 11: PCT, 12: MSU, 13: PCT, 14: MSU, 15: MSU, 16: PCT, 17: PCT,
          19: PCT, 20: PCT}
    sheet("Treatment_Shift", H, rows, [36, 30, 22] + [11] * 17 + [20, 50], fm,
          "Treatment shift — approved legacy → next-gen pairs",
          "Legacy and next-gen are sums of the classes named in the config (Classes sheet, 'Pair role').", fills={"Flag": FF})

    # ---------- Mapping
    H = ["ATC4", "Molecule", "Components", "Class ID", "Class", "Indication", "SU 2025 (M)"]
    cname = {c["id"]: c for c in M["config"]["classes"]}
    L = M["lookups"]
    rows = []
    for (a, mo), cid in zip([(L["atc4s"].index(x[0]), L["molecules"].index(x[1])) for x in meta["molecule_map"]],
                            [x[2] for x in meta["molecule_map"]]):
        su = meta["molecule_su2025"].get((a, mo), 0.0)
        rows.append([L["atc4s"][a], L["molecules"][mo], n_components(L["molecules"][mo]), cid, cname[cid]["name"],
                     indname.get(cname[cid]["indication"], cname[cid]["indication"]), M_(su)])
    rows.sort(key=lambda r: (r[0], -(r[6] or 0)))
    sheet("Mapping", H, rows, [34, 60, 11, 12, 44, 34, 12], {7: MSU}, "Mapping — every ATC4 / molecule and its class",
          "Source: config/market_dynamics_map.json (approved 2026-10-13). Edit the config, not this sheet.")

    # ---------- Checks (values from the ETL + live formulas)
    ws = wb.create_sheet("Checks")
    ws.cell(1, 1, "Checks — reconciliations").font = T_FONT
    ws.cell(2, 1, "Part A: computed by the ETL on the raw rows. Part B: live Excel formulas recomputing figures from the other sheets "
            "(difference should be 0).").font = NOTE
    for j, h in enumerate(["Check", "Result", "Unit", "Pass"], 1):
        c = ws.cell(4, j, h)
        c.font, c.fill = H_FONT, H_FILL
    r = 5
    for name, val, unit, ok in M["checks"]:
        ws.cell(r, 1, name).font = B_FONT
        ws.cell(r, 2, val).font = B_FONT
        ws.cell(r, 3, unit).font = B_FONT
        c = ws.cell(r, 4, "PASS" if ok else "CHECK")
        c.font, c.fill = BOLD, OK if ok else BADF
        r += 1
    r += 1
    for j, h in enumerate(["Indication", "SU 2025 (Indications sheet)", "Sum of classes (formula)", "Difference",
                           "YoY 2025 (Indications sheet)", "YoY 2025 recomputed (formula)", "Difference (pts)"], 1):
        c = ws.cell(r, j, h)
        c.font, c.fill = H_FONT, H_FILL
        c.alignment = Alignment(wrap_text=True)
    hdr_row = r
    n_ind = len(M["indications"])
    col = lambda sh, h: get_column_letter([c.value for c in wb[sh][4]].index(h) + 1)    # header row 4 on data sheets
    iA, i24, i25, iY = col("Indications", "Indication"), col("Indications", "SU 2024 (M)"), col("Indications", "SU 2025 (M)"), col("Indications", "YoY 2025")
    cA, c25 = col("Classes", "Indication"), col("Classes", "SU 2025 (M)")
    for k in range(n_ind):
        rr = hdr_row + 1 + k
        src = 5 + k
        ws.cell(rr, 1, f"=Indications!{iA}{src}")
        ws.cell(rr, 2, f"=Indications!{i25}{src}").number_format = MSU
        ws.cell(rr, 3, f"=SUMIFS(Classes!{c25}:{c25},Classes!{cA}:{cA},Indications!{iA}{src})").number_format = MSU
        ws.cell(rr, 4, f"=B{rr}-C{rr}").number_format = '0.000;-0.000;"-"'
        ws.cell(rr, 5, f"=Indications!{iY}{src}").number_format = PCT
        ws.cell(rr, 6, f"=IF(AND(ISNUMBER(Indications!{i24}{src}),Indications!{i24}{src}>0),Indications!{i25}{src}/Indications!{i24}{src}-1,\"—\")").number_format = PCT
        ws.cell(rr, 7, f"=IF(AND(ISNUMBER(E{rr}),ISNUMBER(F{rr})),(E{rr}-F{rr})*100,0)").number_format = '0.000;-0.000;"-"'
        for j in range(1, 8):
            ws.cell(rr, j).font = B_FONT
    tot = hdr_row + 1 + n_ind
    ws.cell(tot, 1, "Largest difference").font = BOLD
    ws.cell(tot, 4, f"=SUMPRODUCT(MAX(ABS(D{hdr_row + 1}:D{tot - 1})))").number_format = '0.000'
    ws.cell(tot, 7, f"=SUMPRODUCT(MAX(ABS(G{hdr_row + 1}:G{tot - 1})))").number_format = '0.000'
    ws.cell(tot + 2, 1, "Coverage gaps (2021 incomplete in the extract): " + ", ".join(a.split(" ")[0] for a in meta["coverage_gaps"])).font = NOTE
    for j, w in enumerate([62, 16, 16, 12, 16, 16, 14], 1):
        ws.column_dimensions[get_column_letter(j)].width = w
    wb.move_sheet("Checks", offset=-(len(wb.sheetnames) - 2))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb.save(path)
    return path


# ----------------------------------------------------------------------------- cache (Phase 2 reads it)
def write_cache(M, path=CACHE_OUT):
    def clean(o):
        if isinstance(o, dict):
            return {str(k): clean(v) for k, v in o.items() if k not in ("monthly",)}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        if isinstance(o, np.ndarray):
            return [round(float(v), 1) for v in o]
        if isinstance(o, (np.floating, float)):
            return None if (o is None or not math.isfinite(o)) else round(float(o), 4)
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.bool_):
            return bool(o)
        return o
    obj = {"meta": {k: v for k, v in M["meta"].items() if k not in ("molecule_map", "molecule_su2025")},
           "indications": M["indications"], "classes": M["classes"], "markets": M["markets"], "pairs": M["pairs"],
           "checks": M["checks"]}
    for grp in ("indications", "classes", "markets"):
        for s in obj[grp]:
            s["monthly_su"] = [round(float(v), 1) for v in s["monthly"]]
    js = json.dumps(clean(obj), separators=(",", ":"))
    b64 = base64.b64encode(gzip.compress(js.encode("utf-8"), compresslevel=9)).decode()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write('window.MARKET_DYNAMICS_CACHE = {b64Data:"' + b64 + '"};\n')
    os.replace(tmp, path)
    return len(b64)


def main():
    ap = argparse.ArgumentParser(description="Market Dynamics & Treatment Shift data layer")
    ap.add_argument("--cache", action="store_true", help="also write cache/market_dynamics.data.js (tab data, Phase 2)")
    ap.add_argument("--no-review", action="store_true", help="skip the Excel review workbook")
    a = ap.parse_args()
    M = build()
    fails = [c for c in M["checks"] if not c[3]]
    for name, val, unit, ok in M["checks"]:
        print(f"  [{'PASS' if ok else 'CHECK'}] {name}: {val} {unit}")
    if not a.no_review:
        p = write_workbook(M, os.path.join(OUT_DIR, f"market_dynamics_review_{datetime.now():%Y%m%d}.xlsx"))
        print("review workbook ->", p)
    if a.cache:
        n = write_cache(M)
        print(f"cache -> {CACHE_OUT} ({n / 1e6:.2f} MB)")
    print(f"OK: {len(M['indications'])} indications, {len(M['classes'])} classes, {len(M['markets'])} markets, "
          f"{len(M['pairs'])} pairs, data to {M['meta']['data_period']}")
    if fails:
        sys.exit(2)


if __name__ == "__main__":
    main()
