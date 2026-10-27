"""Market Growth Forecast on ORIGINAL (un-calibrated) IQVIA -- 2026-10-26, Ahmed.

The main forecast (cache/market_forecast.data.js) is built on CALIBRATED IQVIA (refresh_iqvia.py step 2e,
iqvia_source/config/iqvia_calibrations.json). This step builds the same forecast a second time on the IQVIA
numbers as delivered, so the page can switch "Data basis: Calibrated / Original IQVIA".

  1. cache/iqvia.json -> cache/iqvia_raw.json (local build input only): the rows listed in
     calibration.raw get their delivered LCV / SU back; the calibration block is dropped.
  2. The normal pipeline (etl/build_market_forecast_v2.py --publish: forecast + cap + DM2 alignment + value +
     rationale + packs) runs with MF_IQVIA_SRC / MF_CACHE_DST pointing at the raw files.
  3. The result is written as window.MARKET_FORECAST_RAW_CACHE in cache/market_forecast_raw.data.js
     (loaded on demand by js/market-forecast.js through CacheLoader 'market_forecast_raw').

No calibration configured -> the raw forecast is simply a copy of the calibrated one (still built, so the
toggle keeps working). Read-only on cache/iqvia.json and cache/market_forecast.data.js.
"""
import base64, gzip, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "cache", "iqvia.json")
RAW_SRC = os.path.join(ROOT, "cache", "iqvia_raw.json")
DST = os.path.join(ROOT, "cache", "market_forecast_raw.data.js")


def _read(path):
    import re
    txt = open(path, encoding="utf-8").read()
    return json.loads(gzip.decompress(base64.b64decode(re.search(r'b64Data:"([^"]+)"', txt).group(1))))


def _write(obj, path, gvar):
    b64 = base64.b64encode(gzip.compress(json.dumps(obj, separators=(",", ":"), default=float).encode("utf-8"), compresslevel=9)).decode("ascii")
    with open(path + ".tmp", "w", encoding="utf-8") as fh:
        fh.write("window." + gvar + ' = {b64Data:"' + b64 + '"};\n')
    os.replace(path + ".tmp", path)


def main():
    d = json.load(open(SRC, encoding="utf-8"))
    cal = d.get("calibration") or {}
    raw = cal.get("raw") or []
    if raw:
        flat = json.loads(gzip.decompress(base64.b64decode(d["b64Data"])))
        for i, lcv, su in raw:
            flat[i * 14 + 6] = lcv; flat[i * 14 + 7] = su
        d["b64Data"] = base64.b64encode(gzip.compress(json.dumps(flat, separators=(",", ":")).encode("utf-8"), compresslevel=9)).decode("ascii")
    d.pop("calibration", None)
    tmp = RAW_SRC + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(d, fh, separators=(",", ":"))
    os.replace(tmp, RAW_SRC)
    print(f"raw IQVIA input: {len(raw)} calibrated row(s) restored -> cache/iqvia_raw.json", flush=True)

    env = dict(os.environ, MF_IQVIA_SRC=RAW_SRC, MF_CACHE_DST=DST)
    rc = subprocess.call([sys.executable, os.path.join(ROOT, "etl", "build_market_forecast_v2.py"), "--publish"], env=env, cwd=ROOT)
    if rc != 0 or not os.path.exists(DST):
        # never fail the market_forecast step (that would roll back the calibrated forecast too): keep the previous raw cache
        print(f"WARNING: Original-IQVIA forecast failed (rc={rc}); previous cache/market_forecast_raw.data.js kept, calibrated forecast unaffected"); return 0
    # 2026-10-27 (Ahmed: "SFE forecast ... right calculation after calibration and IQVIA raw"): each cache carries the
    # FY LE of every market in the OTHER basis (meta.other_le) and its own basis (meta.basis), so a saved plan market
    # typed on one basis is re-expressed on the other with the same growth % vs LE (js/market-forecast.js mktToView).
    cal_p = os.path.join(ROOT, "cache", "market_forecast.data.js")
    cal, rawc = _read(cal_p), _read(DST)
    le = lambda o: {f"{s['type']}|{s['name']}": [(s.get("forecast") or {}).get("fy_le"), (s.get("value") or {}).get("fy_le")] for s in o["segments"]}
    cal["meta"]["basis"], rawc["meta"]["basis"] = "cal", "raw"
    cal["meta"]["other_le"], rawc["meta"]["other_le"] = le(rawc), le(cal)
    _write(cal, cal_p, "MARKET_FORECAST_CACHE")
    _write(rawc, DST, "MARKET_FORECAST_RAW_CACHE")
    print(f"Original-IQVIA forecast OK -> cache/market_forecast_raw.data.js ({os.path.getsize(DST) / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
