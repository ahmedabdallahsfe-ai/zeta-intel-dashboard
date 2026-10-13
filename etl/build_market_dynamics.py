"""
build_market_dynamics.py -- MARKET DYNAMICS, TREATMENT SHIFT & GROWTH OUTLOOK (data layer)

2026-10-13 (Ahmed): SOURCE = TOTAL MARKET INTELLIGENCE. The tab reads the same full-market IMS cube as the
Total Market Intelligence page, not the 59-class IQVIA extract it was first built on.

Reads (nothing else is changed):
  cache/market_intel.json          etl/build_market_intel_cache.py <- "IMS 2022 to April 2026.xlsx"
                                   every ATC4 / Therapeutic Area / molecule / corporation, ANNUAL 2022..2026,
                                   2026 = Jan-Jun only; measures Units (= packs) and LC Value
  config/market_dynamics_map.json  class rules (ATC4 / molecule / combination size), legacy -> next-gen pairs, thresholds
  js/iqvia-growth-config.js        the dashboard's growth rules (min share, low-base label), reused as-is
  cache/market_forecast.data.js    champion FY2027 forecast (IQVIA Standard Units) -- shown in its own SU panel, unchanged
  cache/iqvia.json                 only to place each forecast market (DM1 / DM2) in its therapeutic area, and to
                                   cross-check LC Value against the monthly IQVIA extract

Approved decisions (2026-10-13):
  * measures: packs (IMS Units) with a switch to LC Value -- the SU-only rule does not apply to this source
  * 2026 is Jan-Jun only and has no monthly split: shown as H1 volume and share, never as growth
  * FY2027 outlook stays as a separate panel in Standard Units (different measure, labelled as such)
  * indication = the IMS Therapeutic Area on each row (same 29 areas as Total Market Intelligence)

Outputs:
  python etl/build_market_dynamics.py            -> Claude outputs/Market Dynamics/market_dynamics_review_<date>.xlsx
  python etl/build_market_dynamics.py --cache    -> also cache/market_dynamics.data.js (the tab)

Rules:
  * every row lands in exactly one class (first matching rule; otherwise its own ATC4), so indication = sum of classes
  * volumes are summed first; growth is never an average of percentages
  * prior year = 0 -> "New"; growth above the dashboard's low-base limit -> "Low base"; launch year treated as partial
  * acceleration = YoY 2025 - YoY 2024, in percentage points
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
MI = os.path.join(ROOT, "cache", "market_intel.json")
IQVIA = os.path.join(ROOT, "cache", "iqvia.json")
FORECAST = os.path.join(ROOT, "cache", "market_forecast.data.js")
MAP = os.path.join(ROOT, "config", "market_dynamics_map.json")
OUT_DIR = os.path.join(ROOT, "Claude outputs", "Market Dynamics")
CACHE_OUT = os.path.join(ROOT, "cache", "market_dynamics.data.js")
FULL = [2022, 2023, 2024, 2025]
H1 = 2026
MEAS = ("units", "value")


# ----------------------------------------------------------------------------- inputs
def load_mi(path=MI):
    d = json.load(open(path, encoding="utf-8"))
    L, a = d["lookups"], d["annual"]
    F = np.array(a["rows"], dtype=np.int64).reshape(-1, a["stride"])
    col = {k: i for i, k in enumerate(a["fields"])}
    return d.get("meta", {}), L, F, col, np.array(a["units"], float), np.array(a["value"], float)


def load_growth_rules(path):
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
        return [], {}
    return [s for s in obj.get("segments", []) if s.get("type") in ("DM1", "DM2")], obj.get("meta", {})


def n_components(mol: str) -> int:
    return len([p for p in re.split(r"\s*[+|]\s*", mol) if p.strip()])


def class_of(atc4: str, mol: str, classes: list):
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
    if cur is None or prev is None or prev <= 0:
        return None
    return (cur / prev - 1.0) * 100.0


def metrics(annual: dict, low_base: float):
    """annual: {year: amount} for FULL + H1. Returns the metric block for one measure."""
    su = {y: float(annual.get(y, 0.0)) for y in FULL}
    h1 = float(annual.get(H1, 0.0))
    first = next((y for y in FULL + [H1] if (annual.get(y, 0.0) or 0) > 0), None)
    launched = first is not None and first > FULL[0]
    m = {"su": su, "h1": h1, "first_year": first, "flags": []}
    if launched:
        m["flags"].append(f"first sales in {first}: that year is treated as a partial launch year")
    d, g, gl = {}, {}, {}
    for y in FULL[1:]:
        d[y] = su[y] - su[y - 1]
        if su[y - 1] <= 0:
            g[y], gl[y] = None, ("New" if su[y] > 0 else None)
        else:
            g[y] = pct(su[y], su[y - 1])
            gl[y] = "Low base" if g[y] is not None and g[y] > low_base else ("vs launch year" if launched and y - 1 == first else None)
    m["delta"], m["yoy"], m["yoy_label"] = d, g, gl
    m["accel"] = (g[2025] - g[2024]) if (g.get(2025) is not None and g.get(2024) is not None) else None
    start = None
    for y in FULL[:-1]:
        if su[y] > 0 and not (launched and y == first):
            start = y
            break
    if start is not None and 2025 - start >= 2:
        m["window"] = f"{start}–{str(2025)[2:]}"
        m["cum_delta"] = su[2025] - su[start]
        m["cagr"] = ((su[2025] / su[start]) ** (1.0 / (2025 - start)) - 1.0) * 100.0 if su[2025] > 0 else -100.0
    else:
        m["window"], m["cum_delta"], m["cagr"] = None, None, None
    return m


def quadrant(share, fair, yoy, accel, yoy_prev, label, th):
    """Approved 2026-10-13 rules; Contracting = YoY below 0 in 2025 and 2024 (no YTD in this source)."""
    if yoy is not None and yoy < 0 and yoy_prev is not None and yoy_prev < 0:
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


def rank(items, key, ok):
    vals = sorted([(key(x), x["id"]) for x in items if ok(x)], key=lambda t: -t[0])
    return {i: r + 1 for r, (_, i) in enumerate(vals)}


# ----------------------------------------------------------------------------- build
def build(mi_path=MI, map_path=MAP, forecast_path=FORECAST, iqvia_path=IQVIA, growth_cfg_path=None, top_molecules=30):
    cfg = json.load(open(map_path, encoding="utf-8"))
    th = cfg["thresholds"]
    src = cfg.get("source", {})
    rules = load_growth_rules(growth_cfg_path or os.path.join(ROOT, th.get("growth_rules_file", "js/iqvia-growth-config.js")))
    low_base = rules.get("lowBaseGrowthPct", th["default_low_base_growth_pct"])
    min_share = rules.get("minSharePct", th["default_min_share_pct"])
    mi_meta, L, F, col, U, V = load_mi(mi_path)
    years = L["years"]
    yidx = np.array(years)[F[:, col["year"]]]
    AMT = {"units": U, "value": V}
    classes = cfg["classes"]
    cls_by = {c["id"]: c for c in classes}

    # 1. class per (ATC4, molecule); unmatched -> its own ATC4 class
    am = np.unique(F[:, [col["atc4"], col["molecule"]]], axis=0)
    cmap = {}
    for a, mo in am.tolist():
        cid = class_of(L["atc4s"][a], L["molecules"][mo], classes)
        cmap[(a, mo)] = cid or ("ATC:" + L["atc4s"][a].split(" ")[0])
    key = F[:, col["atc4"]] * 100000 + F[:, col["molecule"]]
    uk, inv = np.unique(key, return_inverse=True)
    kcls = np.array([cmap[(int(k // 100000), int(k % 100000))] for k in uk], dtype=object)
    row_cls = kcls[inv]
    row_ta = np.array(L["tas"], dtype=object)[F[:, col["ta"]]]
    zeta = L["corps"].index(src.get("zeta_corp", "ZETA PHARM*")) if src.get("zeta_corp", "ZETA PHARM*") in L["corps"] else -1
    is_z = F[:, col["corp"]] == zeta
    atc_name = {}
    for a in range(len(L["atc4s"])):
        atc_name.setdefault(L["atc4s"][a].split(" ")[0], L["atc4s"][a])

    def annual(mask):
        out = {}
        for meas in MEAS:
            v = np.bincount(np.searchsorted(years, yidx[mask]), weights=AMT[meas][mask], minlength=len(years))
            out[meas] = {y: float(v[i]) for i, y in enumerate(years)}
        return out

    def block(ann):
        return {meas: metrics(ann[meas], low_base) for meas in MEAS}

    # 2. indications (TA) and classes within them
    tas = sorted(set(row_ta.tolist()))
    ind_out, cls_out, mol_out = [], [], []
    for ta in tas:
        tm = row_ta == ta
        ann_i = annual(tm)
        z_i = annual(tm & is_z)
        ind = {"id": ta, "name": ta, "m": block(ann_i), "zeta": {k: z_i[k] for k in MEAS}}
        # classes
        cids = sorted(set(row_cls[tm].tolist()))
        members = []
        for cid in cids:
            msk = tm & (row_cls == cid)
            ann = annual(msk)
            z = annual(msk & is_z)
            atcs = sorted(set(L["atc4s"][a].split(" ")[0] for a in F[msk, col["atc4"]]))
            nm = cls_by[cid]["name"] if cid in cls_by else atc_name.get(cid[4:], cid)
            members.append({"id": cid, "key": ta + "|" + cid, "name": nm, "indication": ta, "atc4": atcs,
                            "rule": {k: v for k, v in cls_by[cid].items() if k in ("atc4", "molecules", "components")} if cid in cls_by else {"atc4": [cid[4:]]},
                            "n_molecules": int(len(set(F[msk, col["molecule"]].tolist()))),
                            "zeta": {k: z[k] for k in MEAS}, "zeta_active": bool(z["units"].get(2025, 0) + z["units"].get(H1, 0) > 0),
                            "m": block(ann)})
        ind["n_classes"] = len(members)
        ind["classes"] = [c["key"] for c in members]
        # molecules (top N by 2025 packs, rest grouped)
        mols = F[tm, col["molecule"]]
        mu = np.bincount(mols[yidx[tm] == 2025], weights=U[tm][yidx[tm] == 2025], minlength=len(L["molecules"]))
        mh = np.bincount(mols[yidx[tm] == H1], weights=U[tm][yidx[tm] == H1], minlength=len(L["molecules"]))
        order = [i for i in np.argsort(-(mu + mh)) if mu[i] + mh[i] > 0]
        top = order[:top_molecules]
        mmembers = []
        for mo in top:
            msk = tm & (F[:, col["molecule"]] == mo)
            z = annual(msk & is_z)
            mmembers.append({"id": "MOL:" + str(mo), "key": ta + "|MOL:" + str(mo), "name": L["molecules"][mo], "indication": ta,
                             "atc4": sorted(set(L["atc4s"][a].split(" ")[0] for a in F[msk, col["atc4"]])),
                             "zeta": {k: z[k] for k in MEAS}, "zeta_active": bool(z["units"].get(2025, 0) + z["units"].get(H1, 0) > 0),
                             "m": block(annual(msk))})
        rest = order[top_molecules:]
        if rest:
            msk = tm & np.isin(F[:, col["molecule"]], rest)
            z = annual(msk & is_z)
            mmembers.append({"id": "MOL:OTHER", "key": ta + "|MOL:OTHER", "name": f"All other molecules ({len(rest)})", "indication": ta,
                             "atc4": [], "other": True, "zeta": {k: z[k] for k in MEAS}, "zeta_active": False, "m": block(annual(msk))})
        ind["n_molecules"] = len(order)
        # shares, fair share, ranks, quadrants per measure
        for group, fair_n in ((members, len(members)), (mmembers, len(mmembers))):
            fair = 100.0 / max(1, fair_n)
            for meas in MEAS:
                im = ind["m"][meas]
                for c in group:
                    cm = c["m"][meas]
                    cm["share2025"] = cm["su"][2025] / im["su"][2025] * 100 if im["su"][2025] > 0 else None
                    cm["share2024"] = cm["su"][2024] / im["su"][2024] * 100 if im["su"][2024] > 0 else None
                    cm["share_h1"] = cm["h1"] / im["h1"] * 100 if im["h1"] > 0 else None
                    cm["share_chg_pts"] = (cm["share_h1"] - cm["share2025"]) if (cm["share_h1"] is not None and cm["share2025"] is not None) else None
                    cm["fair_share"] = fair
                    cm["zeta_share2025"] = c["zeta"][meas].get(2025, 0) / cm["su"][2025] * 100 if cm["su"][2025] > 0 else None
                ranked = [c for c in group if not c.get("other")]
                rv = rank(ranked, lambda x: x["m"][meas]["su"][2025], lambda x: x["m"][meas]["su"][2025] > 0)
                rg = rank(ranked, lambda x: x["m"][meas]["yoy"][2025], lambda x: x["m"][meas]["yoy"][2025] is not None
                          and x["m"][meas]["yoy_label"][2025] != "Low base" and (x["m"][meas]["share2025"] or 0) >= min_share)
                for c in group:
                    cm = c["m"][meas]
                    cm["rank_volume"], cm["rank_growth"] = rv.get(c["id"]), rg.get(c["id"])
                    cm["quadrant"] = "Not ranked (residual group)" if c.get("other") else quadrant(
                        cm["share2025"] or 0, fair, cm["yoy"][2025], cm["accel"], cm["yoy"][2024], cm["yoy_label"][2025], th)
        for meas in MEAS:
            ind["m"][meas]["zeta_share2025"] = ind["zeta"][meas].get(2025, 0) / ind["m"][meas]["su"][2025] * 100 if ind["m"][meas]["su"][2025] > 0 else None
            ind["m"][meas]["zeta_share_h1"] = ind["zeta"][meas].get(H1, 0) / ind["m"][meas]["h1"] * 100 if ind["m"][meas]["h1"] > 0 else None
        ind_out.append(ind)
        cls_out += members
        mol_out += mmembers
    ind_map = {i["id"]: i for i in ind_out}
    cls_key = {c["key"]: c for c in cls_out}

    # 3. treatment shift (within the pair's therapeutic area)
    pairs_out = []
    for p in cfg["pairs"]:
        ta = p["ta"]
        if ta not in ind_map:
            continue
        leg = [cls_key[ta + "|" + x] for x in p["legacy"] if ta + "|" + x in cls_key]
        nxt = [cls_key[ta + "|" + x] for x in p["next_gen"] if ta + "|" + x in cls_key]
        if not leg or not nxt:
            continue
        ind = ind_map[ta]
        res = {}
        for meas in MEAS:
            Ls = {y: sum(c["m"][meas]["su"][y] for c in leg) for y in FULL}
            Ns = {y: sum(c["m"][meas]["su"][y] for c in nxt) for y in FULL}
            Lh, Nh = sum(c["m"][meas]["h1"] for c in leg), sum(c["m"][meas]["h1"] for c in nxt)
            I = ind["m"][meas]
            rows = []
            for y in FULL[1:]:
                yp = y - 1
                ld, nd, idl = Ls[y] - Ls[yp], Ns[y] - Ns[yp], I["su"][y] - I["su"][yp]
                lyp = pct(Ls[yp], Ls[yp - 1]) if yp - 1 in Ls else None
                loss = max(0.0, -ld)
                expected = Ls[yp] * max(0.0, lyp) / 100.0 if lyp is not None else None
                shortfall = max(0.0, expected - ld) if expected is not None else loss
                hard = min(loss, nd) / nd * 100 if nd > 0 else None
                soft = min(shortfall, nd) / nd * 100 if nd > 0 else None
                if nd <= 0:
                    flag = "No next-gen gain"
                elif ld < 0 and loss > th.get("legacy_decline_multiple", 2.0) * nd:
                    flag = "Legacy Decline (not replaced)"
                elif ld < 0 and (hard or 0) >= th["substitution_min_ratio_pct"]:
                    flag = "Class Substitution"
                elif ld >= 0 and (soft or 0) < th["substitution_min_ratio_pct"]:
                    flag = "Segment Deepening"
                else:
                    flag = "Mixed"
                rows.append({"period": f"{yp}→{y}", "legacy_prev": Ls[yp], "legacy_cur": Ls[y], "legacy_delta": ld, "legacy_growth": pct(Ls[y], Ls[yp]),
                             "next_prev": Ns[yp], "next_cur": Ns[y], "next_delta": nd, "next_growth": pct(Ns[y], Ns[yp]),
                             "ind_delta": idl, "ind_growth": pct(I["su"][y], I["su"][yp]), "legacy_loss": loss,
                             "legacy_shortfall_vs_trend": shortfall, "substitution_ratio": hard, "soft_substitution_ratio": soft,
                             "pool_expanding": bool(idl > 0 and idl > loss),
                             "next_share_pair": Ns[y] / (Ls[y] + Ns[y]) * 100 if Ls[y] + Ns[y] > 0 else None,
                             "next_share_ind": Ns[y] / I["su"][y] * 100 if I["su"][y] > 0 else None, "flag": flag})
            h1row = {"period": "H1 2026 (share only)", "h1": True, "legacy_cur": Lh, "next_cur": Nh,
                     "next_share_pair": Nh / (Lh + Nh) * 100 if Lh + Nh > 0 else None,
                     "next_share_ind": Nh / I["h1"] * 100 if I["h1"] > 0 else None}
            h1row["share_chg_pts"] = (h1row["next_share_ind"] - rows[-1]["next_share_ind"]) if (h1row["next_share_ind"] is not None and rows[-1]["next_share_ind"] is not None) else None
            rows.append(h1row)
            measured = [r for r in rows if "flag" in r]
            res[meas] = {"rows": rows, "latest_flag": measured[-1]["flag"], "latest_period": measured[-1]["period"]}
        pairs_out.append({"id": p["id"], "name": p["name"], "indication": ta, "legacy": p["legacy"], "next_gen": p["next_gen"],
                          "legacy_names": [c["name"] for c in leg], "next_names": [c["name"] for c in nxt],
                          "gap": p.get("_gap"), "note": p.get("_note"), "m": res})

    # 4. provisional outlook badge per indication and measure (history + shift flag)
    for ind in ind_out:
        ind["badge"] = {}
        for meas in MEAS:
            im = ind["m"][meas]
            pf = [p["m"][meas]["latest_flag"] for p in pairs_out if p["indication"] == ind["id"]]
            g25, g24 = im["yoy"].get(2025), im["yoy"].get(2024)
            if "Class Substitution" in pf:
                b = "Structural Substitution Underway"
            elif g25 is not None and g25 >= th["outlook_expanding_min_pct"] and (g24 is None or g24 >= 0):
                b = "Expanding Market"
            elif g25 is not None and g25 <= th["outlook_contracting_max_pct"] and (g24 is None or g24 <= th["outlook_expanding_min_pct"]):
                b = "Contracting Market"
            else:
                b = "Mature / Replacement Demand"
            ind["badge"][meas] = b

    # 5. FY2027 champion forecast (SU) -> placed in its therapeutic area via its ATC4s
    segs, fc_meta = load_forecast(forecast_path)
    atc_ta = {}
    for a in range(len(L["atc4s"])):
        msk = (F[:, col["atc4"]] == a) & (yidx == 2025)
        if msk.any():
            t = np.bincount(F[msk, col["ta"]], weights=U[msk], minlength=len(L["tas"]))
            code = L["atc4s"][a].split(" ")[0]
            prev = atc_ta.get(code)
            if prev is None or t.max() > prev[1]:
                atc_ta[code] = (L["tas"][int(t.argmax())], float(t.max()))
    mkt_atc = {}
    try:
        q = json.load(open(iqvia_path, encoding="utf-8"))
        QL = q["lookups"]
        f = np.array(json.loads(gzip.decompress(base64.b64decode(q["b64Data"]))), dtype=np.int64).reshape(-1, 14)
        for typ, ci, lk in (("DM1", 4, "dm1s"), ("DM2", 5, "dm2s")):
            for i, nm in enumerate(QL[lk]):
                msk = f[:, ci] == i
                if msk.any():
                    s = np.bincount(f[msk, 3], weights=f[msk, 7], minlength=len(QL["atc4s"]))
                    mkt_atc[(typ, nm)] = QL["atc4s"][int(s.argmax())].split(" ")[0]
        # cross-source check: LC Value 2022-2024 by ATC4 (IQVIA monthly extract vs total market)
        # The IQVIA extract re-files some products under other ATC4s (dm1_corrections / product_market_overrides),
        # so a class can legitimately differ; the check reports how many shared classes match within 0.5%.
        py_ = np.array([int(p[:4]) for p in QL["periods"]])
        n_ok = n_all = 0
        for a, nm in enumerate(QL["atc4s"]):
            code = nm.split(" ")[0]
            mm = np.isin(F[:, col["atc4"]], [i for i, x in enumerate(L["atc4s"]) if x.startswith(code)])
            gaps = []
            for y in (2022, 2023, 2024):
                vq = f[(f[:, 3] == a) & (py_[f[:, 2]] == y), 6].sum()
                vm = V[mm & (yidx == y)].sum()
                if vq > 0:
                    gaps.append(abs(vm / vq - 1) * 100)
            if gaps:
                n_all += 1
                n_ok += max(gaps) <= 0.5
        xcheck = (n_ok, n_all)
    except Exception:                                                   # noqa: BLE001
        xcheck = None
    out_fc = []
    for s in segs:
        if s["name"] in ("OTHER MARKET",):
            continue
        code = mkt_atc.get((s["type"], s["name"]))
        ta = atc_ta.get(code, (None,))[0] if code else None
        f_ = s.get("forecast") or {}
        sc = f_.get("scenarios") or {}
        out_fc.append({"type": s["type"], "name": s["name"], "indication": ta, "atc4": code,
                       "le": f_.get("fy_le"), "fy27": f_.get("fy_target"), "growth": f_.get("growth_vs_le_pct"),
                       "low_pct": sc.get("low_growth_pct"), "high_pct": sc.get("high_growth_pct"),
                       "confidence": s.get("confidence"), "engine": s.get("engine"), "method": s.get("selected_label"),
                       "su2025": ((s.get("history") or {}).get("2025") or {}).get("su")})

    # 6. checks
    checks = []
    for meas in MEAS:
        tot = {y: float(AMT[meas][yidx == y].sum()) for y in years}
        cs = {y: sum(c["m"][meas]["su"][y] if y in FULL else c["m"][meas]["h1"] for c in cls_out) for y in years}
        isum = {y: sum(i["m"][meas]["su"][y] if y in FULL else i["m"][meas]["h1"] for i in ind_out) for y in years}
        checks.append((f"All classes add up to the whole Total Market Intelligence cube ({meas}, every year)",
                       max(abs(cs[y] - tot[y]) for y in years), meas, max(abs(cs[y] - tot[y]) for y in years) < 1.0))
        checks.append((f"Indications add up to the whole market ({meas}, every year)", max(abs(isum[y] - tot[y]) for y in years), meas,
                       max(abs(isum[y] - tot[y]) for y in years) < 1.0))
    mt = {"units": mi_meta.get("totalAnnualUnits"), "value": mi_meta.get("totalAnnualValue")}
    for meas in MEAS:
        if mt[meas]:
            dlt = abs(float(AMT[meas].sum()) - mt[meas])
            checks.append((f"Grand total = Total Market Intelligence build total ({meas})", dlt, meas, dlt < 1.0))
    if xcheck is not None:
        checks.append(("Cross-source: shared ATC4 classes whose LC Value 2022-2024 matches the monthly IQVIA extract within 0.5% "
                       "(the rest differ because the IQVIA extract re-files some products under other ATC4s)", xcheck[0], f"of {xcheck[1]} classes", None))
    nofc = [f_["name"] for f_ in out_fc if not f_["indication"]]
    checks.append(("Forecast markets placed in a therapeutic area", len(out_fc) - len(nofc), f"of {len(out_fc)}", not nofc))
    bad = 0
    for s_ in cls_out + ind_out + mol_out:
        for meas in MEAS:
            mm_ = s_["m"][meas]
            for y in FULL[1:]:
                if mm_["yoy"][y] is not None and mm_["su"][y - 1] <= 0:
                    bad += 1
    checks.append(("Growth figures computed on a zero base", bad, "cells", bad == 0))

    meta = {"generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"), "source": "Total Market Intelligence (cache/market_intel.json)",
            "source_file": mi_meta.get("source"), "source_built": mi_meta.get("generatedAt"), "full_years": FULL, "partial_year": H1,
            "partial_label": src.get("partial_label", "H1 2026 (Jan-Jun)"), "measures": list(MEAS),
            "measure_labels": src.get("measure_labels", {"units": "Packs", "value": "LC Value"}), "map_version": cfg.get("version"),
            "growth_rules": {"min_share_pct": min_share, "low_base_growth_pct": low_base}, "thresholds": th,
            "forecast_generated_at": fc_meta.get("generated_at"), "forecast_engine": fc_meta.get("engine"),
            "n_atc4": len(set(L["atc4s"])), "n_molecules_top": top_molecules,
            "zeta_corp": src.get("zeta_corp", "ZETA PHARM*")}
    return {"meta": meta, "indications": ind_out, "classes": cls_out, "molecules": mol_out, "pairs": pairs_out,
            "forecast": out_fc, "checks": checks, "config": cfg,
            "mapping": [(L["atc4s"][a], L["molecules"][mo], cmap[(a, mo)]) for a, mo in am.tolist()]}


# ----------------------------------------------------------------------------- workbook
def write_workbook(M, path):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    Fn = "Arial"
    H_FILL, H_FONT = PatternFill("solid", fgColor="0F4C81"), Font(name=Fn, bold=True, color="FFFFFF", size=10)
    B_FONT, BOLD = Font(name=Fn, size=10), Font(name=Fn, size=10, bold=True)
    T_FONT, NOTE = Font(name=Fn, size=14, bold=True, color="0F4C81"), Font(name=Fn, size=9, italic=True, color="64748B")
    OK, BADF = PatternFill("solid", fgColor="DCFCE7"), PatternFill("solid", fgColor="FEE2E2")
    QF = {"Volume Anchor": "DBEAFE", "Growth Engine": "DCFCE7", "Mature / Plateauing": "FEF3C7", "Contracting / At-Risk": "FEE2E2", "Niche / Stable": "F1F5F9"}
    FF = {"Class Substitution": "FEE2E2", "Segment Deepening": "DCFCE7", "Mixed": "FEF3C7", "No next-gen gain": "F1F5F9", "Legacy Decline (not replaced)": "E0E7FF"}
    BORDER = Border(bottom=Side(style="thin", color="E2E8F0"))
    MN, PCT, PTS = '#,##0.00;-#,##0.00;"-"', '+0.0%;-0.0%;0.0%', '+0.0;-0.0;0.0'
    P_ = lambda v: None if v is None else v / 100.0
    wb = Workbook()
    meta = M["meta"]
    UL = {"units": "packs (M)", "value": "LC Value (EGP M)"}

    def fmt_for(h):
        if h.startswith("Accel") or "pts" in h:
            return PTS
        if "(M)" in h or "(EGP M)" in h:
            return MN
        if h.startswith(("YoY", "CAGR", "Share", "Fair share", "Zeta share", "Legacy growth", "Next-gen growth", "Indication growth", "Substitution", "Soft", "Next-gen share")):
            return PCT
        return None

    def sheet(title, headers, rows, widths, title_text, note=None, fills=None):
        ws = wb.create_sheet(title)
        ws.cell(1, 1, title_text).font = T_FONT
        if note:
            ws.cell(2, 1, note).font = NOTE
        r0 = 4
        for j, h in enumerate(headers, 1):
            c = ws.cell(r0, j, h)
            c.font, c.fill, c.alignment = H_FONT, H_FILL, Alignment(wrap_text=True, vertical="center")
        ws.row_dimensions[r0].height = 34
        cf = {j: fmt_for(h) for j, h in enumerate(headers, 1)}
        cfill = {j: fills[h] for j, h in enumerate(headers, 1) if fills and h in fills}
        for i, row in enumerate(rows, r0 + 1):
            for j, v in enumerate(row, 1):
                c = ws.cell(i, j, v)
                c.font, c.border = B_FONT, BORDER
                if cf.get(j) and isinstance(v, (int, float)) and not isinstance(v, bool):
                    c.number_format = cf[j]
                if j in cfill and isinstance(v, str) and v in cfill[j]:
                    c.fill = PatternFill("solid", fgColor=cfill[j][v])
        for j, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(j)].width = w
        ws.freeze_panes = ws.cell(r0 + 1, 3)
        if rows:
            ws.auto_filter.ref = f"A{r0}:{get_column_letter(len(headers))}{r0 + len(rows)}"
        return ws

    def gl(m, y):
        v, l = m["yoy"].get(y), m["yoy_label"].get(y)
        return P_(v) if v is not None else (l or "—")

    ws = wb.active
    ws.title = "README"
    lines = [
        ("Market Dynamics, Treatment Shift & Growth Outlook — review workbook (source: Total Market Intelligence)", T_FONT),
        (f"Built {meta['generated_at']} from {meta['source']} — {meta['source_file']} (built {meta['source_built']}). "
         f"{meta['n_atc4']} ATC4 classes, all therapeutic areas, 2022–2025 full years + {meta['partial_label']}.", B_FONT),
        ("Measures: Packs = IMS Units (number of packs). LC Value = EGP. Standard Units are NOT in this source; the FY2027 sheet is in Standard Units (different measure).", B_FONT),
        ("", B_FONT),
        ("Sheets: Checks · Indications (therapeutic areas) · Classes · Molecules (top 30 per area + rest) · Treatment_Shift · FY2027_SU · Mapping", BOLD),
        ("", B_FONT),
        ("Rules", BOLD),
        ("• Indication = the IMS Therapeutic Area on each row, as on the Total Market Intelligence page. A class that sits in two areas (e.g. a few PPI packs in Pediatrics) is shown inside each area.", B_FONT),
        ("• Volumes are summed first; growth is never an average of percentages. YoY = year / previous year − 1. Acceleration = YoY 2025 − YoY 2024 (pts).", B_FONT),
        (f"• \"New\" = no sales the year before. \"Low base\" = growth above +{meta['growth_rules']['low_base_growth_pct']:,.0f}% (Market Intelligence rule). "
         "A class first sold after 2022 has its first year treated as a partial launch year (no month data to tell).", B_FONT),
        ("• 2026 = January–June only, with no month split and no comparable H1 2025, so it is shown as volume and share of the area (H1 share vs full-year 2025 share), never as growth.", B_FONT),
        ("• Quadrants (first match): Contracting / At-Risk (YoY < 0 in 2025 and 2024) → at or above fair share: Volume Anchor (YoY ≥ 5% and acceleration ≥ −5 pts) else "
         "Mature / Plateauing → below: Growth Engine (YoY ≥ 10% or acceleration ≥ +5 pts) else Niche / Stable. Fair share = 1 ÷ number of classes (or molecules) in the area.", B_FONT),
        ("• Treatment shift: substitution ratio = share of the next-gen gain explained by legacy losses (capped at 100%). Flags: Legacy Decline (not replaced) = legacy lost more than "
         "2× the next-gen gain; Class Substitution = legacy falling, ratio ≥ 50%; Segment Deepening = legacy stable/growing and its shortfall vs its own trend explains < 50%; otherwise Mixed.", B_FONT),
        ("• Outlook badge (provisional, per measure): Structural Substitution if the latest pair flag is Class Substitution; Expanding if YoY 2025 ≥ 5% and 2024 ≥ 0; "
         "Contracting if YoY 2025 ≤ −2%; otherwise Mature / Replacement Demand.", B_FONT),
    ]
    for i, (t, f_) in enumerate(lines, 1):
        c = ws.cell(i, 1, t)
        c.font, c.alignment = f_, Alignment(wrap_text=True, vertical="top")
    ws.column_dimensions["A"].width = 160

    def series_rows(items, ind_name=True, with_class_cols=True):
        rows = []
        for o in items:
            for meas in MEAS:
                m = o["m"][meas]
                r = ([o["indication"]] if ind_name else []) + [o["name"]]
                if with_class_cols:
                    r += [o["id"], ", ".join(o.get("atc4", []))]
                r += [UL[meas]] + [m["su"][y] / 1e6 for y in FULL] + [m["h1"] / 1e6] + [m["delta"][y] / 1e6 for y in FULL[1:]] + \
                     [gl(m, y) for y in FULL[1:]] + [m["accel"], m["window"] or "—", (m["cum_delta"] or 0) / 1e6 if m["cum_delta"] is not None else None,
                     P_(m["cagr"]), P_(m.get("share2024")), P_(m.get("share2025")), P_(m.get("share_h1")), m.get("share_chg_pts"),
                     P_(m.get("fair_share")), m.get("rank_volume"), m.get("rank_growth"), m.get("quadrant"), P_(m.get("zeta_share2025")), "; ".join(m["flags"])]
                rows.append(r)
        return rows

    yh = [f"{y} (M)" for y in FULL] + ["H1 2026 (M)"] + [f"Δ {y} (M)" for y in FULL[1:]] + [f"YoY {y}" for y in FULL[1:]] + \
         ["Accel. 25 vs 24 (pts)", "Window", "Cumulative Δ (M)", "CAGR", "Share of area 2024", "Share of area 2025", "Share of area H1 2026",
          "Share change H1-26 vs 2025 (pts)", "Fair share", "Rank volume", "Rank growth", "Quadrant", "Zeta share 2025", "Flags"]
    # Indications
    rows = []
    for i in sorted(M["indications"], key=lambda x: -x["m"]["units"]["su"][2025]):
        for meas in MEAS:
            m = i["m"][meas]
            rows.append([i["name"], i["n_classes"], i["n_molecules"], UL[meas]] + [m["su"][y] / 1e6 for y in FULL] + [m["h1"] / 1e6] +
                        [m["delta"][y] / 1e6 for y in FULL[1:]] + [gl(m, y) for y in FULL[1:]] +
                        [m["accel"], m["window"] or "—", (m["cum_delta"] or 0) / 1e6 if m["cum_delta"] is not None else None, P_(m["cagr"]),
                         P_(m.get("zeta_share2025")), P_(m.get("zeta_share_h1")), i["badge"][meas]])
    sheet("Indications", ["Therapeutic area", "Classes", "Molecules", "Measure"] + yh[:12] + ["Window", "Cumulative Δ (M)", "CAGR", "Zeta share 2025", "Zeta share H1 2026", "Outlook badge (provisional)"],
          rows, [26, 8, 9, 15] + [11] * 15 + [11, 11, 30], "Therapeutic areas — sum of their classes", "Two rows per area: packs and LC Value. Sorted by 2025 packs.")
    cls = sorted(M["classes"], key=lambda c: (c["indication"], -c["m"]["units"]["su"][2025]))
    sheet("Classes", ["Therapeutic area", "Class", "Class ID", "ATC4", "Measure"] + yh, series_rows(cls),
          [24, 44, 12, 16, 15] + [11] * 23 + [22, 10, 40], "Classes — benchmarked within their therapeutic area",
          "Every ATC4 not named in config/market_dynamics_map.json is its own class.", fills={"Quadrant": QF})
    mols = sorted(M["molecules"], key=lambda c: (c["indication"], c.get("other", False), -c["m"]["units"]["su"][2025]))
    sheet("Molecules", ["Therapeutic area", "Molecule", "Measure"] + yh,
          [r[:2] + r[4:] for r in series_rows(mols)], [24, 44, 15] + [11] * 23 + [22, 10, 40],
          f"Molecules — top {meta['n_molecules_top']} per area by packs, the rest grouped", None, fills={"Quadrant": QF})
    # Treatment shift
    H = ["Pair", "Therapeutic area", "Measure", "Period", "Legacy prev (M)", "Legacy (M)", "Legacy Δ (M)", "Legacy growth", "Next-gen prev (M)",
         "Next-gen (M)", "Next-gen Δ (M)", "Next-gen growth", "Area Δ (M)", "Indication growth", "Legacy lost (M)", "Legacy shortfall vs trend (M)",
         "Substitution ratio", "Soft substitution ratio", "Pool expanding?", "Next-gen share of pair", "Next-gen share of area", "Share change (pts)", "Flag", "Note"]
    rows = []
    for p in M["pairs"]:
        for meas in MEAS:
            for r in p["m"][meas]["rows"]:
                if r.get("h1"):
                    rows.append([p["name"], p["indication"], UL[meas], r["period"], None, r["legacy_cur"] / 1e6, None, None, None, r["next_cur"] / 1e6] +
                                [None] * 9 + [P_(r["next_share_pair"]), P_(r["next_share_ind"]), r["share_chg_pts"], "—", "H1 2026 vs full-year 2025 share; no growth"])
                    continue
                rows.append([p["name"], p["indication"], UL[meas], r["period"], r["legacy_prev"] / 1e6, r["legacy_cur"] / 1e6, r["legacy_delta"] / 1e6,
                             P_(r["legacy_growth"]), r["next_prev"] / 1e6, r["next_cur"] / 1e6, r["next_delta"] / 1e6, P_(r["next_growth"]), r["ind_delta"] / 1e6,
                             P_(r["ind_growth"]), r["legacy_loss"] / 1e6, r["legacy_shortfall_vs_trend"] / 1e6, P_(r["substitution_ratio"]),
                             P_(r["soft_substitution_ratio"]), "Yes" if r["pool_expanding"] else "No", P_(r["next_share_pair"]), P_(r["next_share_ind"]),
                             None, r["flag"], p.get("gap") or p.get("note") or ""])
    sheet("Treatment_Shift", H, rows, [36, 20, 15, 20] + [11] * 18 + [24, 50], "Treatment shift — approved legacy → next-gen pairs",
          "Within the pair's therapeutic area. Legacy / next-gen = sums of the classes named in the config.", fills={"Flag": FF})
    rows = [[f_["type"], f_["name"], f_["indication"] or "—", f_["atc4"], (f_["su2025"] or 0) / 1e6 if f_["su2025"] else None,
             (f_["le"] or 0) / 1e6 if f_["le"] else None, (f_["fy27"] or 0) / 1e6 if f_["fy27"] else None, P_(f_["growth"]), P_(f_["low_pct"]),
             P_(f_["high_pct"]), f_["confidence"], f_["engine"], f_["method"]] for f_ in sorted(M["forecast"], key=lambda x: (x["indication"] or "", x["type"], -(x["le"] or 0)))]
    sheet("FY2027_SU", ["Type", "Market", "Therapeutic area", "Main ATC4", "SU 2025 (M)", "SU 2026 LE (M)", "SU FY2027 (M)", "FY2027 growth vs LE", "Range low", "Range high", "Confidence",
                        "Winning engine", "Method"], rows, [6, 36, 22, 10, 12, 12, 12, 12, 10, 10, 12, 12, 30],
          "FY2027 champion forecast — IQVIA Standard Units (a different measure)", "Unchanged from the Market Growth Forecast tab.")
    sheet("Mapping", ["ATC4", "Molecule", "Components", "Class"], sorted([[a, m, n_components(m), c] for a, m, c in M["mapping"]]),
          [36, 70, 11, 16], "Mapping — every ATC4 / molecule and its class", "Source: config/market_dynamics_map.json. Edit the config, not this sheet.")
    # Checks + live formulas
    ws = wb.create_sheet("Checks")
    ws.cell(1, 1, "Checks — reconciliations").font = T_FONT
    ws.cell(2, 1, "Part A: computed by the ETL on the raw rows. Part B: live Excel formulas recomputing area totals and growth from the other sheets (difference should be 0).").font = NOTE
    for j, h in enumerate(["Check", "Result", "Unit", "Pass"], 1):
        c = ws.cell(4, j, h)
        c.font, c.fill = H_FONT, H_FILL
    r = 5
    for name, val, unit, ok in M["checks"]:
        ws.cell(r, 1, name).font = B_FONT
        ws.cell(r, 2, val).font = B_FONT
        ws.cell(r, 3, unit).font = B_FONT
        c = ws.cell(r, 4, "INFO" if ok is None else "PASS" if ok else "CHECK")
        c.font = BOLD
        if ok is not None:
            c.fill = OK if ok else BADF
        r += 1
    r += 1
    hdr = ["Therapeutic area", "Measure", "2025 (Indications sheet)", "Sum of classes (formula)", "Difference", "YoY 2025 (sheet)", "YoY 2025 recomputed", "Difference (pts)"]
    for j, h in enumerate(hdr, 1):
        c = ws.cell(r, j, h)
        c.font, c.fill, c.alignment = H_FONT, H_FILL, Alignment(wrap_text=True)
    colI = lambda h: get_column_letter([c.value for c in wb["Indications"][4]].index(h) + 1)
    colC = lambda h: get_column_letter([c.value for c in wb["Classes"][4]].index(h) + 1)
    iA, iM, i24, i25, iY = colI("Therapeutic area"), colI("Measure"), colI("2024 (M)"), colI("2025 (M)"), colI("YoY 2025")
    cA, cM, c25 = colC("Therapeutic area"), colC("Measure"), colC("2025 (M)")
    n = len(M["indications"]) * 2
    for k in range(n):
        rr, src_ = r + 1 + k, 5 + k
        ws.cell(rr, 1, f"=Indications!{iA}{src_}")
        ws.cell(rr, 2, f"=Indications!{iM}{src_}")
        ws.cell(rr, 3, f"=Indications!{i25}{src_}").number_format = MN
        ws.cell(rr, 4, f"=SUMIFS(Classes!{c25}:{c25},Classes!{cA}:{cA},Indications!{iA}{src_},Classes!{cM}:{cM},Indications!{iM}{src_})").number_format = MN
        ws.cell(rr, 5, f"=C{rr}-D{rr}").number_format = '0.000;-0.000;"-"'
        ws.cell(rr, 6, f"=Indications!{iY}{src_}").number_format = PCT
        ws.cell(rr, 7, f"=IF(AND(ISNUMBER(Indications!{i24}{src_}),Indications!{i24}{src_}>0),Indications!{i25}{src_}/Indications!{i24}{src_}-1,\"—\")").number_format = PCT
        ws.cell(rr, 8, f"=IF(AND(ISNUMBER(F{rr}),ISNUMBER(G{rr})),(F{rr}-G{rr})*100,0)").number_format = '0.000;-0.000;"-"'
    tot = r + 1 + n
    ws.cell(tot, 1, "Largest difference").font = BOLD
    ws.cell(tot, 5, f"=SUMPRODUCT(MAX(ABS(E{r + 1}:E{tot - 1})))").number_format = '0.000'
    ws.cell(tot, 8, f"=SUMPRODUCT(MAX(ABS(H{r + 1}:H{tot - 1})))").number_format = '0.000'
    for j, w in enumerate([70, 16, 16, 16, 12, 14, 14, 14], 1):
        ws.column_dimensions[get_column_letter(j)].width = w
    wb.move_sheet("Checks", offset=-(len(wb.sheetnames) - 2))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb.save(path)
    return path


# ----------------------------------------------------------------------------- cache
def write_cache(M, path=CACHE_OUT):
    def clean(o):
        if isinstance(o, dict):
            return {str(k): clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        if isinstance(o, np.bool_):
            return bool(o)
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, (np.floating, float)):
            return None if not math.isfinite(o) else round(float(o), 4)
        return o
    obj = {k: M[k] for k in ("meta", "indications", "classes", "molecules", "pairs", "forecast", "checks")}
    js = json.dumps(clean(obj), separators=(",", ":"))
    b64 = base64.b64encode(gzip.compress(js.encode("utf-8"), compresslevel=9)).decode()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write('window.MARKET_DYNAMICS_CACHE = {b64Data:"' + b64 + '"};\n')
    os.replace(tmp, path)
    return len(b64)


def main():
    ap = argparse.ArgumentParser(description="Market Dynamics & Treatment Shift data layer (source: Total Market Intelligence)")
    ap.add_argument("--cache", action="store_true", help="also write cache/market_dynamics.data.js")
    ap.add_argument("--no-review", action="store_true", help="skip the Excel review workbook")
    a = ap.parse_args()
    M = build()
    for name, val, unit, ok in M["checks"]:
        print(f"  [{'INFO' if ok is None else 'PASS' if ok else 'CHECK'}] {name}: {val} {unit}")
    if not a.no_review:
        print("review workbook ->", write_workbook(M, os.path.join(OUT_DIR, f"market_dynamics_review_{datetime.now():%Y%m%d}.xlsx")))
    if a.cache:
        print(f"cache -> {CACHE_OUT} ({write_cache(M) / 1e6:.2f} MB)")
    print(f"OK: {len(M['indications'])} therapeutic areas, {len(M['classes'])} classes, {len(M['molecules'])} molecule rows, "
          f"{len(M['pairs'])} pairs, {len(M['forecast'])} forecast markets")
    if any(c[3] is False for c in M["checks"]):
        sys.exit(2)


if __name__ == "__main__":
    main()
