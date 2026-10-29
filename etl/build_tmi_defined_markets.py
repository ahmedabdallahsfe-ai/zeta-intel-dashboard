"""
build_tmi_defined_markets.py -- defined markets on Total Market Intelligence (2026-10-29, Ahmed: "add what you didn't
find in IQVIA data from Total Market Intelligence", CHC 2027 structure proposal).

Reads config/tmi_defined_markets.json + cache/market_intel.json (read-only). Writes cache/tmi_defined_markets.data.js
(window.TMI_DEFINED_MARKETS = config + per-market match report + annual summary). The Total Market Intelligence page
(js/market-intel.js) resolves brand / corp names against its own lookups, so the page always follows the live cache.
Never fails the refresh: exits 0 and keeps the previous output on error.
"""
import json, os, sys, traceback
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = os.path.join(ROOT, "config", "tmi_defined_markets.json")
SRC = os.path.join(ROOT, "cache", "market_intel.json")
OUT = os.path.join(ROOT, "cache", "tmi_defined_markets.data.js")


def norm(s):
    return " ".join(str(s or "").upper().split())


def build():
    cfg = json.load(open(CFG, encoding="utf-8"))
    d = json.load(open(SRC, encoding="utf-8"))
    L, A = d["lookups"], d["annual"]
    brands = [norm(b) for b in L["brands"]]; corps = [norm(c) for c in L["corps"]]; years = L["years"]
    R, V, U, s = A["rows"], A["value"], A["units"], A["stride"]
    bidx = {}
    for i, b in enumerate(brands): bidx.setdefault(b, []).append(i)
    # brand -> {corp idx: [value per year, units per year]}
    want = {}
    for m in cfg["markets"]:
        for e in m["members"]:
            for i in bidx.get(norm(e["brand"]), []): want[i] = 1
    cube = {}
    for k in range(len(V)):
        o = k * s; b = R[o + 6]
        if b not in want: continue
        c = R[o + 3]; y = R[o]
        a = cube.setdefault((b, c), [[0.0] * len(years), [0.0] * len(years)])
        a[0][y] += V[k]; a[1][y] += U[k]
    zeta = norm((d.get("meta") or {}).get("zeta_corp") or "ZETA PHARM*")
    for m in cfg["markets"]:
        found, missing = [], []
        tv = [0.0] * len(years); tu = [0.0] * len(years); zv = [0.0] * len(years); zu = [0.0] * len(years); per = []
        for e in m["members"]:
            hit = False
            for bi in bidx.get(norm(e["brand"]), []):
                for (b, c), (vv, uu) in cube.items():
                    if b != bi: continue
                    if e.get("corp") and norm(e["corp"]) not in corps[c]: continue
                    hit = True
                    per.append({"brand": L["brands"][b], "corp": L["corps"][c], "value": [round(x) for x in vv], "units": [round(x) for x in uu]})
                    for y in range(len(years)):
                        tv[y] += vv[y]; tu[y] += uu[y]
                        if corps[c].startswith("ZETA PHARM"): zv[y] += vv[y]; zu[y] += uu[y]
            (found if hit else missing).append(e["brand"] + (" (" + e["corp"] + ")" if e.get("corp") else ""))
        per.sort(key=lambda x: -x["value"][years.index(2025)] if 2025 in years else 0)
        m["found"], m["missing"] = found, missing
        m["summary"] = {"years": years, "value": [round(x) for x in tv], "units": [round(x) for x in tu],
                        "zeta_value": [round(x) for x in zv], "zeta_units": [round(x) for x in zu], "brands": per}
    cfg["built"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    cfg["source"] = os.path.relpath(SRC, ROOT); cfg["partial_years"] = (d.get("meta") or {}).get("partialYears") or []
    return cfg


def main():
    try:
        obj = build()
        tmp = OUT + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write("window.TMI_DEFINED_MARKETS = " + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n")
        os.replace(tmp, OUT)
        print("[tmi-dm] %d markets -> %s" % (len(obj["markets"]), OUT))
        for m in obj["markets"]:
            y = obj["markets"][0]["summary"]["years"]; i = y.index(2025) if 2025 in y else -1
            print("  %-40s 2025 EGP %8.1fM | found %d | missing: %s" % (m["name"][:40], m["summary"]["value"][i] / 1e6, len(m["found"]), ", ".join(m["missing"]) or "-"))
    except Exception:  # noqa: BLE001
        traceback.print_exc(); print("[tmi-dm] FAILED - previous output kept")
    return 0


if __name__ == "__main__":
    sys.exit(main())
