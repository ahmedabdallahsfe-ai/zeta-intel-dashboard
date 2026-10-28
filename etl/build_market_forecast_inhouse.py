"""
build_market_forecast_inhouse.py -- In-house calibrated market (Market Growth Forecast, 2026-10-28, Ahmed).

Request: "Data basis in Market Growth Forecast: create a new tab to calibrate the IQVIA market with the in-house sales
from Sales Performance. Keep the estimated Zeta market share SU 2026 and the estimated market growth % 2027, create the
new market SU and EGP values (2026 and expected 2027), let me input the expected market share SU and auto-calculate the
target SU, EGP and packs. No other brands."

This ETL only prepares the in-house side: Zeta net sales (Sales Performance cache, cache/sales.json) per IQVIA item of the
forecast's DM1 markets, by month, in packs, Standard Units and EGP. All market maths runs in js/market-forecast.js
(in-house tab) on top of the calibrated forecast cache, so the market growth % stays the forecast's own.

  in-house rows  : every transaction type (sales + returns = net), lines CHC_SALES (duplicate of CHC) and
                   Non-Promoted excluded -- the same rows Sales Performance totals.
  product -> item: config/inhouse_iqvia_item_map.json ("product": "DM1||IQVIA item", or null = not in IQVIA).
                   Products missing from the file are matched automatically (brand alias + strengths + form) and
                   listed under meta.auto so they can be confirmed; unmatched products are listed under meta.unmapped.
  SU per pack    : the unit count in the product name (30 TAB -> 30 SU) for tablets / capsules / sachets / ampoules;
                   otherwise (syrup, cream) the IQVIA item's own SU per pack (scorecard_pk, last YTD).

Output: cache/market_forecast_inhouse.data.js  (window.MARKET_FORECAST_INHOUSE = {...};)
Never fails the refresh: exits 0 and keeps the previous output on error.
"""
from __future__ import annotations

import json
import os
import re
import sys
import traceback
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import market_forecast_rationale as MR  # noqa: E402

ROOT = MR.ROOT
SALES = os.environ.get("MF_SALES_SRC") or os.path.join(ROOT, "cache", "sales.json")
FCST = os.environ.get("MF_CACHE_DST") or os.path.join(ROOT, "cache", "market_forecast.data.js")
MAP = os.path.join(ROOT, "config", "inhouse_iqvia_item_map.json")
OUT = os.path.join(ROOT, "cache", "market_forecast_inhouse.data.js")
EXCL_LINES = {"CHC_SALES", "NON-PROMOTED"}
I_M, I_LINE, I_BRAND, I_PROD, I_QTY, I_VAL = 0, 1, 2, 3, 18, 19

# in-house brand word -> IQVIA brand word (only where the spelling differs)
ALIAS = [("ZETAKARDOVAL HCT", "ZKARDOVAL HCT"), ("ZETAKARDOVAL", "ZKARDOVAL"), ("EPILOSMIDE", "EPILOSAMIDE"), ("DOZOVA ASHWAGANDA", "DOZOVA A KSM66"),
         ("DOZOVA WOMEN MAX", "DOZOVA WOMAN MAX"), ("DOZOVA Q10 COENZYME", "DOZOVA Q10 C E"),
         ("DOZOVA ALPHA AMYLASE", "DOZOVA ALPHA AMYLA"), ("DOZOVA BRAIN BOOST", "DOZOVA BRAINBOOST"),
         ("EMPACOZA TRIO", "EMPACOZA TRIO XR")]


def norm(s):
    return re.sub(r"\s+", " ", str(s or "").upper()).strip()


def strengths(s):
    """sorted strength numbers: '25/5/1000 MG' -> ['1000','25','5']; pack counts (30 TAB, 14 SACHETS) are ignored."""
    s = norm(s)
    s = re.sub(r"\b\d+\s*(TABS?|CAPS?|SACH\w*|AMP\w*|'S|S)\b", " ", s)
    s = re.sub(r"\b\d+(\.\d+)?\s*(ML|GM?|DOS)\b", " ", s)
    nums = re.findall(r"\d+(?:\.\d+)?", s)
    return sorted(set(n.rstrip("0").rstrip(".") if "." in n else n for n in nums))


def form(s):
    s = norm(s)
    if re.search(r"SACH|SAC\b|PO\.SUS", s): return "SACHET"
    if re.search(r"SYRUP|\bSY\b|ORAL SOLUT|\bML\b", s): return "LIQUID"
    if re.search(r"CREAM|\bGM\b|30G\b", s): return "CREAM"
    if re.search(r"\bCAPS?\b|HGC|\bCAP\b", s): return "CAP"
    if re.search(r"AMP", s): return "AMP"
    return "TAB"


def count(s):
    m = re.search(r"\b(\d+)\s*(TABS?|CAPS?|SACH\w*|AMP\w*|'S)\b", norm(s)) or re.search(r"\b(\d+)(TAB|CAP)\b", norm(s))
    return int(m.group(1)) if m else None


def ibrand(p):
    p = norm(p)
    for a, b in ALIAS:
        if p.startswith(a + " ") or p == a: return b, p[len(a):].strip()
    return None, p


def automatch(prod, items):
    """items: list of (key, brand, item). Best IQVIA item for an in-house product, or None."""
    b0, rest = ibrand(prod)
    cands = [x for x in items if (b0 and x[1] == b0) or (not b0 and norm(prod).startswith(x[1] + " "))]
    if not b0 and cands:   # longest brand wins (NEXICURE PLUS before NEXICURE)
        L = max(len(x[1]) for x in cands); cands = [x for x in cands if len(x[1]) == L]
    if not cands: return None
    st, fm = strengths(prod), form(prod)
    best = [x for x in cands if strengths(x[2][len(x[1]):]) == st and (form(x[2]) == fm or len(cands) == 1)]
    if not best: best = [x for x in cands if strengths(x[2][len(x[1]):]) == st]
    if not best and len(cands) == 1 and not st: best = cands
    if not best and len(set(x[0].split("||")[0] for x in cands)) == 1 and len(cands) == 1: best = cands
    return best[0][0] if len(best) == 1 else None


def build():
    fc = MR.read_cache(FCST)
    items, pk_su = [], {}
    for s in fc["segments"]:
        if s.get("type") != "DM1" or s.get("name") == "OTHER MARKET": continue
        z = ((s.get("scorecard") or {}).get("zeta") or {})
        zp = {i["item"]: i for i in (((s.get("scorecard_pk") or {}).get("zeta") or {}).get("items") or [])}
        for i in z.get("items") or []:
            k = s["name"] + "||" + i["item"]
            items.append((k, norm(i["brand"]), norm(i["item"])))
            p = zp.get(i["item"]); su, pk = (i.get("ytd") or [0])[0], ((p or {}).get("ytd") or [0, 0])[1]
            if not (su > 0 and pk > 0): su, pk = (i.get("mat") or [0])[0], ((p or {}).get("mat") or [0, 0])[1]
            pk_su[k] = su / pk if su > 0 and pk > 0 else None
    keys = {x[0] for x in items}
    fixed = {}
    if os.path.exists(MAP):
        fixed = {norm(k): v for k, v in (json.load(open(MAP, encoding="utf-8")).get("map") or {}).items()}

    d = json.load(open(SALES, encoding="utf-8"))
    L = d["lookups"]
    agg = {}   # prod -> month -> [qty, val]
    lines_of = {}
    for r in d["rows"]:
        ln = str(L["lines"][r[I_LINE]]).upper()
        if ln in EXCL_LINES: continue
        q, v = r[I_QTY], r[I_VAL]
        if not q and not v: continue
        p = norm(L["products"][r[I_PROD]]); m = L["months"][r[I_M]]
        a = agg.setdefault(p, {}).setdefault(m, [0.0, 0.0]); a[0] += q; a[1] += v
        lines_of.setdefault(p, set()).add(L["lines"][r[I_LINE]])
    out, auto, unmapped, bad = {}, {}, [], []
    for p, mm in sorted(agg.items()):
        tq = sum(x[0] for x in mm.values()); tv = sum(x[1] for x in mm.values())
        if p in fixed:
            k = fixed[p]
            if k is None: continue
            if k not in keys: bad.append({"product": p, "target": k}); continue
        else:
            k = automatch(p, items)
            if k: auto[p] = k
        if not k:
            if abs(tv) > 0.5 or abs(tq) > 0.5: unmapped.append({"product": p, "lines": sorted(lines_of[p]), "packs": round(tq), "val": round(tv)})
            continue
        n = count(p); fm = form(p)
        spp = n if (n and fm in ("TAB", "CAP", "SACHET", "AMP")) else pk_su.get(k)
        if not spp: spp = 1.0; bad.append({"product": p, "target": k, "note": "no SU per pack - 1 used"})
        o = out.setdefault(k, {"brand": next(x[1] for x in items if x[0] == k), "months": {}, "products": []})
        for m, (q, v) in mm.items():
            a = o["months"].setdefault(m, [0.0, 0.0, 0.0]); a[0] += q; a[1] += q * spp; a[2] += v
        o["products"].append({"p": p, "lines": sorted(lines_of[p]), "su_per_pack": spp, "packs": round(tq, 2), "su": round(tq * spp, 2), "val": round(tv, 2),
                              "iqvia_su_per_pack": round(pk_su[k], 2) if pk_su.get(k) else None})
    for o in out.values():
        o["months"] = {m: [round(x, 2) for x in v] for m, v in sorted(o["months"].items())}
    meta = {"built": datetime.now().strftime("%Y-%m-%d %H:%M"), "sales_generated": (d.get("meta") or {}).get("generatedAt"),
            "months": L["months"], "excluded_lines": sorted(EXCL_LINES), "forecast_built": fc["meta"].get("generated_at"),
            "map_file": os.path.relpath(MAP, ROOT), "auto": auto, "unmapped": unmapped, "problems": bad}
    return {"meta": meta, "items": out}


def main():
    try:
        obj = build()
        tmp = OUT + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write("window.MARKET_FORECAST_INHOUSE = " + json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + ";\n")
        os.replace(tmp, OUT)
        m = obj["meta"]
        print("[inhouse] items %d | auto-matched %d | unmapped %d | problems %d -> %s" % (len(obj["items"]), len(m["auto"]), len(m["unmapped"]), len(m["problems"]), OUT))
        for p in m["unmapped"]: print("  unmapped:", p)
        for p in m["problems"]: print("  problem :", p)
    except Exception:  # noqa: BLE001
        traceback.print_exc(); print("[inhouse] FAILED - previous output kept")
    return 0


if __name__ == "__main__":
    sys.exit(main())
