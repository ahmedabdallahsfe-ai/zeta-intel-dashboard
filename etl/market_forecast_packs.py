"""
market_forecast_packs.py -- Packs (boxes) view of the Market Growth Forecast (2026-10-20, Ahmed: "add packs beside SU and value").

Definition (agreed with Ahmed): packs = IQVIA Standard Units / IQVIA "Pack Size" of each item
    (IQVIA_SOURCE.xlsx sheet "Pack Mapping": key "<Pack>|<standard dosage form>", e.g. "FILM C.TABS 15MG 30|Tablet" -> 30;
     the same Pack Size the source rows carry, so packs = the source "Units" column).
Forecast: FY packs = SU forecast x packs per SU of the last 6 actual months (the current pack mix), exactly like the
value view converts SU with the last-6-month price per SU (etl/market_forecast_value.py). BU / Line / Egypt = sum of DM1.

How: the IQVIA rows are re-weighted (value column := packs) and the existing value and scorecard builders are run on a copy,
so packs follow the very same rules and structure as value. Adds seg["packs"] (same shape as seg["value"]) and
seg["scorecard_pk"] (same shape as seg["scorecard"], "val" slots = packs). Never changes SU, value or the plan.
Runs after add_rationale() in build_market_forecast_v2.publish(); alone: python etl/market_forecast_packs.py
"""
from __future__ import annotations

import copy
import json
import os
import sys
from datetime import datetime

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import market_forecast_rationale as MR  # noqa: E402
import market_forecast_value as MV  # noqa: E402

ROOT = MR.ROOT
SRC = os.path.join(ROOT, "iqvia_source", "IQVIA_SOURCE.xlsx")
PACK_JSON = os.path.join(ROOT, "cache", "iqvia_pack_sizes.json")
K = 1000   # packs are carried x1000 as integers through the builders, then scaled back
PI_, DOSEI, ITEMI = 1, 11, 12


def pack_map():
    """{"<Pack>|<dosage form>": pack size} from the source's Pack Mapping sheet (cached in cache/iqvia_pack_sizes.json)."""
    try:
        if os.path.exists(PACK_JSON) and (not os.path.exists(SRC) or os.path.getmtime(PACK_JSON) >= os.path.getmtime(SRC)):
            return json.load(open(PACK_JSON, encoding="utf-8"))["map"]
    except Exception:  # noqa: BLE001
        pass
    import openpyxl
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    rows = list(wb["Pack Mapping"].iter_rows(values_only=True))
    h = [str(c).strip() if c is not None else "" for c in rows[0]]
    ik, ip = h.index("Key (Pack|Dosage Form)"), h.index("Pack Size")
    m = {}
    for r in rows[1:]:
        if r and r[ik] is not None:
            try:
                v = float(r[ip])
                if v > 0: m[str(r[ik]).strip()] = v
            except Exception:  # noqa: BLE001
                pass
    json.dump({"source": os.path.relpath(SRC, ROOT), "built": datetime.now().strftime("%Y-%m-%d %H:%M"), "map": m},
              open(PACK_JSON, "w", encoding="utf-8"), ensure_ascii=False)
    return m


def packs_flat(flat, L, pm):
    """Copy of the IQVIA flat array with the value column replaced by packs x K. Returns (flat_pk, coverage)."""
    prods, items, doses = L["prods"], L["items"], L["doses"]
    combo = np.unique(flat[:, [PI_, DOSEI, ITEMI]], axis=0)
    size = {}
    for p, ds, it in combo.tolist():
        prod, item, dose = prods[p], items[it], doses[ds]
        pack = item[len(prod):].strip() if item.startswith(prod) else item
        size[(p, ds, it)] = pm.get(pack + "|" + dose)
    ps = np.array([size.get((p, ds, it)) or 1.0 for p, ds, it in flat[:, [PI_, DOSEI, ITEMI]].tolist()], dtype=float)
    miss = np.array([size.get((p, ds, it)) is None for p, ds, it in flat[:, [PI_, DOSEI, ITEMI]].tolist()])
    out = flat.copy()
    out[:, MR.LI] = np.rint(flat[:, MR.SI] / ps * K).astype(np.int64)
    su = flat[:, MR.SI].sum()
    return out, (1 - (flat[miss, MR.SI].sum() / su if su else 0))


def _scale_value(v):
    for k in ("history", "price_by_year"):
        if isinstance(v.get(k), dict):
            v[k] = {a: (b / K if isinstance(b, (int, float)) else b) for a, b in v[k].items()}
    if isinstance(v.get("ytd"), dict):
        for k in ("cur", "py"):
            if isinstance(v["ytd"].get(k), (int, float)): v["ytd"][k] /= K
    for k in ("monthly", "path"):
        if isinstance(v.get(k), list): v[k] = [x / K if isinstance(x, (int, float)) else x for x in v[k]]
    for k in ("fy_le", "fy_target", "price_now", "price_le"):
        if isinstance(v.get(k), (int, float)): v[k] /= K
    return v


def _scale_sc(o, key=None):
    if isinstance(o, dict):
        for k, x in list(o.items()):
            if k in ("val", "val_py", "zval", "price_su") and isinstance(x, (int, float)):
                o[k] = x / K
            elif k in ("ytd", "mat") and isinstance(x, list) and len(x) == 4:
                o[k] = [x[0], x[1] / K, x[2], x[3] / K]
            elif k == "s6" and isinstance(x, list) and len(x) == 2:
                o[k] = [x[0], x[1] / K]
            elif k == "years" and isinstance(x, dict) and all(isinstance(y, list) for y in x.values()):
                o[k] = {a: [y[0], y[1] / K] + y[2:] for a, y in x.items()}
            else:
                _scale_sc(x, k)
    elif isinstance(o, list):
        for x in o: _scale_sc(x, key)
    return o


def add_packs(cache_path=None, iqvia_path=None, write=True, verbose=True):
    cache_path = cache_path or os.path.join(ROOT, "cache", "market_forecast.data.js")
    iqvia_path = iqvia_path or os.path.join(ROOT, "cache", "iqvia.json")
    obj = MR.read_cache(cache_path)
    flat, L = MR.load_iqvia(iqvia_path)
    fpk, cov = packs_flat(flat, L, pack_map())
    work = copy.deepcopy(obj)
    for s in work["segments"]:
        s.pop("packs", None); s.pop("scorecard_pk", None)
    keep = (MV.read_cache, MV.load_iqvia, MR.read_cache, MR.load_iqvia)
    try:
        MV.read_cache = lambda p: work
        MV.load_iqvia = lambda p: (fpk, L)
        MV.add_value(cache_path, iqvia_path, write=False)       # work[seg]["value"] := packs x K
        MR.read_cache = lambda p: work
        MR.load_iqvia = lambda p: (fpk, L)
        MR.add_rationale(cache_path, iqvia_path, write=False)   # work[seg]["scorecard"] := packs x K in the value slots
    finally:
        MV.read_cache, MV.load_iqvia, MR.read_cache, MR.load_iqvia = keep
    by = {(s["type"], s["name"]): s for s in work["segments"]}
    n = 0
    for s in obj["segments"]:
        w = by[(s["type"], s["name"])]
        v = _scale_value(w.get("value") or {})
        v["basis"] = ("Packs = IQVIA Standard Units / IQVIA pack size of each item; FY" + str(obj["meta"]["target_year"]) +
                      " packs = the SU forecast x packs per SU of the last 6 actual months (today's pack mix).")
        v.pop("volume_effect_pct", None); v.pop("price_effect_pct", None)
        s["packs"] = v
        s["scorecard_pk"] = _scale_sc(w.get("scorecard") or {})
        n += fin(v.get("fy_target"))
    obj["meta"]["packs"] = {"unit": "packs", "measure": "IQVIA Standard Units / pack size", "coverage_su_pct": round(cov * 100, 4),
                            "mix_months": MV.PRICE_MONTHS, "built": datetime.now().strftime("%Y-%m-%d %H:%M")}
    if write:
        size = MR.write_cache(obj, cache_path)
        if verbose:
            print(f"packs OK: {n}/{len(obj['segments'])} markets, pack size found for {cov * 100:.3f}% of SU -> "
                  f"{os.path.relpath(cache_path, ROOT)} ({size / 1e6:.2f} MB)")
    return obj


def fin(x):
    return 1 if isinstance(x, (int, float)) and x == x else 0


if __name__ == "__main__":
    add_packs()
    sys.exit(0)
