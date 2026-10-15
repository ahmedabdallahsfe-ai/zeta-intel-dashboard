"""Market Growth Forecast - business rationale & insights (2026-10-14, Ahmed).

Ahmed: "add rationale and insights about the forecast, the reason behind it, and use one high-confidence
forecast - no ranges, no statistics."

Engine-agnostic post-processor: it reads the finished cache/market_forecast.data.js (champion v1+v2 OR the
v1 fallback - the forecast numbers are NOT changed) plus product-level IQVIA Standard Units from
cache/iqvia.json, and adds to every segment:

  seg["rationale"] = {
      "statement": one-line forecast statement (one number, no range),
      "why":       [plain business reasons behind the number: momentum, this year, volume added],
      "insights":  [where growth comes from, what holds it back, new brands, treatment shift],
      "drivers":   {"up": [...], "down": [...], "new": {...}, "level": "brand"|"market"},
      "shift":     treatment / molecule shift sentence or None,
      "zeta":      [what the forecast means for Zeta],
      "watch":     [business watch-outs - no statistics],
      "key_driver": short label for the overview table,
      "added_su":  FY target - FY LE (volume the market adds),
  }

Every sentence is triggered by a computed value; no driver is invented. No statistical vocabulary
(error, bias, confidence, range, test, model) is written.

Run alone:   python etl/market_forecast_rationale.py          (updates the cache in place)
Refresh:     called at the end of build_market_forecast_v2.py --publish (all branches).
"""
from __future__ import annotations

import base64
import gzip
import json
import os
import re
import sys
from datetime import datetime

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
CI, PI, TI, AI, D1I, D2I, LI, SI, LINEI, BUI, MOLI = 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
STRIDE = 14


# ---------------------------------------------------------------- io
def read_cache(path):
    txt = open(path, encoding="utf-8").read()
    return json.loads(gzip.decompress(base64.b64decode(re.search(r'b64Data:"([^"]+)"', txt).group(1))))


def write_cache(obj, path):
    js = json.dumps(obj, separators=(",", ":"), default=float)
    b64 = base64.b64encode(gzip.compress(js.encode("utf-8"), compresslevel=9)).decode()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write('window.MARKET_FORECAST_CACHE = {b64Data:"' + b64 + '"};\n')
    os.replace(tmp, path)
    return len(b64)


def load_iqvia(path):
    d = json.load(open(path, encoding="utf-8"))
    flat = np.array(json.loads(gzip.decompress(base64.b64decode(d["b64Data"]))), dtype=np.int64).reshape(-1, STRIDE)
    return flat, d["lookups"]


# ---------------------------------------------------------------- formatting
def su(v):
    a = abs(v)
    if a >= 1e9:
        return f"{v / 1e9:.2f} B SU"
    if a >= 1e6:
        return f"{v / 1e6:.1f} M SU"
    if a >= 1e3:
        return f"{v / 1e3:.0f} K SU"
    return f"{v:,.0f} SU"


def egp(v):
    a = abs(v)
    return (f"EGP {v / 1e9:.2f} B" if a >= 1e9 else f"EGP {v / 1e6:.1f} M" if a >= 1e6 else f"EGP {v / 1e3:.0f} K" if a >= 1e3 else f"EGP {v:,.0f}")


def pc(x, d=1):
    r = round(float(x), d)
    return ("+" if r > 0 else "") + (f"{r:.{d}f}" if d else f"{int(r)}") + "%"


def nm(s):
    """IQVIA names are upper case; keep codes like A10P1 but soften long names a little."""
    return s.strip()


# ---------------------------------------------------------------- core
def _by(key_col, msk, flat, t0, t1, n):
    """Standard Units per key over period indices [t0, t1]."""
    sel = msk & (flat[:, TI] >= t0) & (flat[:, TI] <= t1)
    return np.bincount(flat[sel, key_col], weights=flat[sel, SI], minlength=n)


def build_rationale(seg, flat, L, meta, masks_cache):
    P = meta["periods"]
    t = len(P) - 1                                   # data period index (e.g. 2026-08)
    py, ty, pm = meta["partial_year"], meta["target_year"], meta["partial_months"]
    months = f"Jan–{MON[pm - 1]} {py}"
    mat_lbl = f"{MON[(int(P[t][5:7]) % 12)]} {int(P[t][:4]) - 1}–{MON[int(P[t][5:7]) - 1]} {P[t][:4]}"

    msk = masks_cache(seg)
    f = seg.get("forecast") or {}
    g = f.get("growth_vs_le_pct")
    fy_t, fy_le = f.get("fy_target"), f.get("fy_le")
    name = seg["name"]
    ftype = seg.get("forecast_type")
    new_mkt = ftype in ("run_rate_floor", "launch_curve")
    why, ins, watch, zeta = [], [], [], []

    # ---- statement (one number)
    if fy_t is None:
        return {"statement": "No forecast available for this market.", "why": [], "insights": [], "drivers": {}, "shift": None,
                "zeta": [], "watch": [], "key_driver": "", "added_su": None}
    added = fy_t - fy_le
    verb = "grow" if g > 0.5 else "decline" if g < -0.5 else "stay broadly flat"
    statement = (f"FY{ty} forecast: {su(fy_t)} — the market is expected to {verb} "
                 f"{pc(g) + ' ' if verb != 'stay broadly flat' else '(' + pc(g) + ') '}vs FY{py}"
                 + (f", adding {su(added)}." if added > 0 else f", losing {su(-added)}." if added < 0 else "."))

    # ---- 1. momentum pattern (full years) + this year
    yoy = [(k, v) for k, v in (seg.get("yoy_pct") or {}).items() if v is not None]
    ytd = (seg.get("ytd") or {}).get("growth_pct")
    last_full = str(meta["full_years"][-1])
    if new_mkt:
        ms = seg.get("consecutive_positive_months")
        why.append(f"New market with {ms} months of sales. The forecast is built on today's monthly sales rate"
                   + (" and the typical uptake path of a new market" if ftype == "launch_curve" else
                      ", carried over 12 months") + f": FY{ty} = {su(fy_t)}.")
        if ytd is not None and abs(ytd) <= 300:
            why.append(f"Sales are still building: {months} is {pc(ytd)} vs the same months last year.")
    elif len(yoy) == 1:
        k, v = yoy[0]
        why.append(f"Young market: {k[-4:]} was its first full year-on-year comparison ({pc(v, 0)}). The FY{ty} forecast ({pc(g)}) "
                   + ("assumes growth continues but at a more normal pace as the market matures." if g < v else "assumes the build-up continues."))
    elif yoy:
        vals = [v for _, v in yoy[-4:]]
        yrs = ", ".join(f"{k[-4:]} {pc(v, 0)}" for k, v in yoy[-4:])
        if all(v > 0 for v in vals) and all(b <= a + 1 for a, b in zip(vals, vals[1:])) and vals[0] - vals[-1] > 3:
            why.append(f"The market has grown every year, but each year a little slower ({yrs}). "
                       f"The FY{ty} forecast ({pc(g)}) continues this gradual slowdown rather than repeating the fast growth of earlier years."
                       if g < vals[-1] else
                       f"The market has grown every year, but more slowly each year ({yrs}); the FY{ty} forecast ({pc(g)}) stays close to last year's pace.")
        elif all(v > 0 for v in vals) and all(b >= a - 1 for a, b in zip(vals, vals[1:])) and vals[-1] - vals[0] > 3:
            why.append(f"Growth has been speeding up ({yrs}). The FY{ty} forecast ({pc(g)}) builds on this momentum."
                       if g >= vals[-1] - 3 else
                       f"Growth has been speeding up ({yrs}). The FY{ty} forecast ({pc(g)}) keeps the market growing but does not assume "
                       f"a further acceleration beyond last year's {pc(vals[-1], 0)}.")
        elif all(v > 0 for v in vals) and max(vals) - min(vals) > 20:
            why.append(f"The market has grown every year, though at an uneven pace ({yrs}). The FY{ty} forecast ({pc(g)}) follows "
                       "the market's underlying growth rather than the peak or the low year.")
        elif all(v > 0 for v in vals):
            why.append(f"Steady, consistent growth year after year ({yrs}). The FY{ty} forecast ({pc(g)}) continues the established trend.")
        elif all(v < 0 for v in vals):
            why.append(f"The market has been shrinking every year ({yrs}). The FY{ty} forecast ({pc(g)}) assumes this erosion continues.")
        else:
            why.append(f"Growth has moved up and down in recent years ({yrs}). The FY{ty} forecast ({pc(g)}) follows the market's underlying direction, "
                       "not the swings of a single year.")
    if ytd is not None and not new_mkt and abs(ytd) <= 300:
        gap = g - ytd
        if abs(gap) <= 4:
            why.append(f"This year confirms it: {months} is running {pc(ytd)} vs last year, in line with the forecast.")
        elif gap < 0:
            why.append(f"{months} is running {pc(ytd)} vs last year; the forecast expects the market to level off in FY{ty} ({pc(g)}) "
                       "after this year's gain, in line with its longer-term level." if abs(g) <= 0.5 else
                       f"{months} is running {pc(ytd)} vs last year; the forecast expects growth to ease to {pc(g)} next year as the market gets bigger "
                       "and the earlier growth drivers mature." if g > 0 else
                       f"{months} is running {pc(ytd)} vs last year; the forecast expects the market to turn down next year ({pc(g)}), in line with its longer-term direction.")
        elif abs(g) <= 0.5:
            why.append(f"{months} is running {pc(ytd)} vs last year; the forecast expects the market to stabilise in FY{ty} ({pc(g)}), "
                       "in line with its longer-term level rather than this year's dip.")
        else:
            why.append(f"{months} is running {pc(ytd)} vs last year; the forecast expects a stronger FY{ty} ({pc(g)}), in line with the market's longer-term trend.")
    # volume added vs this year's gain
    fy_last = (seg.get("history") or {}).get(last_full, {}).get("su")
    if fy_last and not new_mkt:
        gain_now = fy_le - fy_last
        if added > 0 and gain_now > 0:
            ratio = added / gain_now
            why.append(f"In volume terms the market adds {su(added)} in FY{ty}, "
                       + ("about the same as the " if 0.85 <= ratio <= 1.15 else "less than the " if ratio < 0.85 else "more than the ")
                       + f"{su(gain_now)} it is adding in FY{py}.")

    # ---- 2. drivers (who makes the growth)
    t0c, t0p = t - 11, t - 23
    # a BU/Line made of one defined market is explained at brand level (its sub-market list would be itself)
    agg = seg["type"] == "Total" or (seg["type"] in ("BU", "Line") and len(seg.get("members") or []) > 1)
    key_col, lk = (D1I, "dm1s") if agg else (PI, "prods")
    n = len(L[lk])
    cur = _by(key_col, msk, flat, t0c, t, n)
    pri = _by(key_col, msk, flat, t0p, t0c - 1, n)
    chg = cur - pri
    mkt_cur, mkt_pri = cur.sum(), pri.sum()
    gross_up = chg[chg > 0].sum()
    gross_dn = -chg[chg < 0].sum()
    zi = L["corps"].index("ZETA PHARM*") if "ZETA PHARM*" in L["corps"] else -1
    zeta_prod = set()
    if not agg and zi >= 0:
        zeta_prod = set(np.unique(flat[msk & (flat[:, CI] == zi), PI]).tolist())

    def lab(i):
        s = nm(L[lk][i])
        return s + (" (Zeta)" if i in zeta_prod else "")

    up_idx = [i for i in np.argsort(-chg) if chg[i] > 0][:3]
    dn_idx = [i for i in np.argsort(chg) if chg[i] < 0][:2]
    up = [{"name": lab(i), "su": float(chg[i]), "share_of_gain": float(chg[i] / gross_up) if gross_up else None} for i in up_idx]
    dn = [{"name": lab(i), "su": float(chg[i])} for i in dn_idx if gross_dn and -chg[i] / max(mkt_pri, 1) >= 0.005]
    unit = "sub-markets" if agg else "brands"
    if up and mkt_cur > 0:
        top_share = sum(x["share_of_gain"] or 0 for x in up)
        lst = "; ".join(f"{x['name']} {('+' if x['su'] > 0 else '')}{su(x['su'])}" for x in up)
        ins.append(f"Where the growth comes from (last 12 months, {mat_lbl}): {lst}"
                   + (f" — together {top_share * 100:.0f}% of all volume gains in the market." if len(up) > 1 and top_share else "."))
    if dn:
        ins.append("Holding the market back: " + "; ".join(f"{x['name']} {su(x['su'])}" for x in dn) + ".")
    key_driver = up[0]["name"] if up else ""

    # new entrants (brand level only): first sale within the last 24 months
    new = None
    if not agg:
        sel = msk & (flat[:, SI] > 0)
        first = np.full(n, 10 ** 6, dtype=np.int64)
        np.minimum.at(first, flat[sel, PI], flat[sel, TI])
        recent = np.where((first >= t - 23) & (first <= t))[0]
        recent = [i for i in recent if cur[i] > 0]
        if recent and mkt_cur > 0:
            nsu = float(cur[recent].sum())
            shr = nsu / mkt_cur
            if shr >= 0.01 and not new_mkt and not seg.get("residual_market"):
                top = sorted(recent, key=lambda i: -cur[i])[:3]
                new = {"count": len(recent), "su": nsu, "share": shr, "names": [lab(i) for i in top]}
                ins.append(f"New brands are adding volume: {len(recent)} brand{'s' if len(recent) > 1 else ''} launched in the last 24 months "
                           f"({', '.join(new['names'])}) already hold {shr * 100:.0f}% of the market.")

    # ---- 3. treatment shift (molecules), brand-level markets only
    shift = None
    if not agg:
        nmol = len(L["molecules"])
        mc = _by(MOLI, msk, flat, t0c, t, nmol)
        mp = _by(MOLI, msk, flat, t - 35, t - 24, nmol)
        if mc.sum() > 0 and mp.sum() > 0 and (mc / mc.sum() >= 0.05).sum() >= 2:
            sc, sp = mc / mc.sum(), mp / mp.sum()
            d = sc - sp
            gi, li = int(np.argmax(d)), int(np.argmin(d))
            if d[gi] >= 0.02 and L["molecules"][gi] != "(none)":
                def mlab(i):
                    s = L["molecules"][i]
                    return s if len(s) <= 60 else s[:57] + "…"
                shift = (f"Treatment is shifting toward {mlab(gi)} (share {sp[gi] * 100:.0f}% → {sc[gi] * 100:.0f}% over two years)"
                         + (f", away from {mlab(li)} ({sp[li] * 100:.0f}% → {sc[li] * 100:.0f}%)" if d[li] <= -0.02 else "") + ".")
                ins.append(shift)

    # ---- 4. what it means for Zeta
    if zi >= 0 and mkt_cur > 0:
        zsel = msk & (flat[:, CI] == zi)
        z_cur = float(flat[zsel & (flat[:, TI] >= t0c), SI].sum())
        z_pri = float(flat[zsel & (flat[:, TI] >= t0p) & (flat[:, TI] < t0c), SI].sum())
        if z_cur > 0 and z_cur / mkt_cur < 0.001:
            zeta.append(f"Zeta's presence in this market is negligible ({su(z_cur)} in the last 12 months).")
        elif z_cur > 0:
            s_cur, s_pri = z_cur / mkt_cur, (z_pri / mkt_pri if mkt_pri else 0)
            m_g = (mkt_cur / mkt_pri - 1) * 100 if mkt_pri else None
            z_g = (z_cur / z_pri - 1) * 100 if z_pri else None
            line = f"Zeta holds {s_cur * 100:.1f}% of this market ({su(z_cur)} in the last 12 months"
            if z_pri and m_g is not None:
                line += (f"; share {'up' if s_cur > s_pri else 'down'} from {s_pri * 100:.1f}% — Zeta {pc(z_g)} vs market {pc(m_g)})."
                         if abs(s_cur - s_pri) >= 0.001 else f"; share stable — Zeta {pc(z_g)} vs market {pc(m_g)}).")
            else:
                line += ")."
            zeta.append(line)
            need = s_cur * fy_t
            # Zeta's run-rate equivalent for FY next: last-12-months volume
            zeta.append(f"To keep this share in FY{ty}, Zeta needs about {su(need)} — {pc((need / z_cur - 1) * 100)} on its last 12 months. "
                        + ("Anything below that loses share in a growing market." if g > 0.5 else
                           "Holding volume flat is enough to keep share." if g > -0.5 else
                           "In a shrinking market, holding volume flat gains share."))
            if not agg and up and up[0]["name"].endswith("(Zeta)") and (up[0]["share_of_gain"] or 0) >= 0.25 and s_cur >= 0.10:
                zeta.append("Zeta's own brand is the market's biggest growth contributor: the forecast partly rests on Zeta keeping its momentum.")
        elif seg["type"] != "Total":
            zeta.append("Zeta has no sales in this market in the last 12 months.")

    # ---- 5. watch-outs (business, no statistics)
    if ftype == "run_rate_floor":
        watch.append("New market: further uptake beyond today's sales rate is upside to this number; update it with the brand team's launch plan.")
    elif ftype == "launch_curve":
        watch.append("New market: the speed of uptake depends on launch execution and competitor entries; review each quarter.")
    elif ftype == "intermittent":
        watch.append("Volumes come in irregular orders (tenders / institutions): monthly figures will be lumpy around the yearly total.")
    if up and gross_up and (up[0]["share_of_gain"] or 0) >= 0.5 and not new_mkt and gross_up >= 0.02 * max(mkt_pri, 1) \
            and not (agg and len(seg.get("members") or []) <= 2):
        watch.append(f"Growth depends heavily on one {unit[:-1]}: {up[0]['name']} delivers {up[0]['share_of_gain'] * 100:.0f}% of all volume gains. "
                     "A supply gap or price move there would change the market's growth.")
    if ytd is not None and not new_mkt and abs(g - ytd) > 15 and abs(ytd) <= 300:
        watch.append(f"This year's sales ({pc(ytd)}) and the FY{ty} forecast ({pc(g)}) differ widely; re-check after the next IQVIA quarter.")
    if seg.get("residual_market"):
        watch.append("Includes OTHER MARKET (everything outside Zeta's defined markets): read it as the background market.")
    watch.append("Not built in: new launches, withdrawals, shortages, price changes or tenders that are not yet visible in IQVIA sales.")

    # ---- 6. value view (2026-10-15): SU forecast x today's price per SU (etl/market_forecast_value.py)
    val = None
    v = seg.get("value") or {}
    if v.get("fy_target") is not None and v.get("fy_le"):
        gv, pe = v.get("growth_vs_le_pct"), v.get("price_effect_pct")
        verb_v = "grow" if gv > 0.5 else "decline" if gv < -0.5 else "stay broadly flat"
        addv = v["fy_target"] - v["fy_le"]
        lbl = "price & mix" if seg["type"] in ("BU", "Line", "Total") else "price"
        vst = (f"FY{ty} forecast at today's prices: {egp(v['fy_target'])} — the market is expected to {verb_v} "
               f"{pc(gv) + ' ' if verb_v != 'stay broadly flat' else '(' + pc(gv) + ') '}vs FY{py}"
               + (f", adding {egp(addv)}." if addv > 0 else f", losing {egp(-addv)}." if addv < 0 else "."))
        vw = [(f"Value = the volume forecast ({pc(g)}) × today's price per Standard Unit (EGP {v['price_now']:.2f}, average of the last 6 months, "
               "current product mix)." if lbl == "price" else
               f"Value = each market's volume forecast × its own price per Standard Unit today (last 6 months, current product mix), added up "
               f"(average EGP {v['price_now']:.2f} per SU).") + " No new price increase is assumed for next year — add one only when it is approved."]
        if pe is not None and abs(pe) >= 0.5:
            vw.append(f"Value grows {'faster' if pe > 0 else 'slower'} than volume ({pc(gv)} vs {pc(g)}): today's average price per SU is "
                      f"{'above' if pe > 0 else 'below'} the FY{py} average (EGP {v['price_now']:.2f} vs {v['price_le']:.2f}), so "
                      + ("the price increases already in the market carry over into next year." if lbl == "price" and pe > 0 else
                         "the lower price level already in the market reduces next year's value." if lbl == "price" else
                         "the higher-priced markets are taking a bigger part of the volume (mix) and recent price moves carry over." if pe > 0 else
                         "the lower-priced markets are growing faster (mix) and recent price moves carry over."))
        else:
            vw.append(f"Value grows in line with volume ({pc(gv)} vs {pc(g)}): today's price per SU is close to this year's average.")
        pb = v.get("price_by_year") or {}
        ys = [k for k in pb if pb.get(k)]
        if len(ys) >= 3:
            ch = [(ys[i], (pb[ys[i]] / pb[ys[i - 1]] - 1) * 100) for i in range(1, len(ys))][-4:]
            vw.append("Price per SU in the market over recent years: " + ", ".join(f"{k} {pc(c, 0)}" for k, c in ch)
                      + ". These increases are history only; they are not projected forward.")
        zv = []
        if zi >= 0:
            zsel = msk & (flat[:, CI] == zi)
            zl_cur = float(flat[zsel & (flat[:, TI] >= t0c), LI].sum())
            ml_cur = float(flat[msk & (flat[:, TI] >= t0c), LI].sum())
            if zl_cur > 0 and ml_cur > 0 and zl_cur / ml_cur >= 0.001:
                vs_ = zl_cur / ml_cur
                need = vs_ * v["fy_target"]
                zv.append(f"Zeta holds {vs_ * 100:.1f}% of this market's value ({egp(zl_cur)} in the last 12 months). To keep that value share in "
                          f"FY{ty}, Zeta needs about {egp(need)} — {pc((need / zl_cur - 1) * 100)} on its last 12 months.")
        val = {"statement": vst, "why": vw, "zeta": zv}

    return {"statement": statement, "why": why, "insights": ins, "value": val,
            "drivers": {"up": up, "down": dn, "new": new, "level": "market" if agg else "brand"},
            "shift": shift, "zeta": zeta, "watch": watch, "key_driver": key_driver,
            "added_su": float(added)}


def build_scorecard(seg, flat, L, meta, masks_cache):
    """2026-10-15 (Ahmed): "Market at a glance" for the selected market - Zeta by year (SU + value), market and Zeta
    over the last 12 months vs the 12 before, and the main brands (share, growth) in both measures."""
    P = meta["periods"]; t = len(P) - 1; py, pm = meta["partial_year"], meta["partial_months"]
    msk = masks_cache(seg)
    yi = flat[:, TI]
    pyear = np.array([int(p[:4]) for p in P]); pmon = np.array([int(p[5:7]) for p in P])
    zi = L["corps"].index("ZETA PHARM*") if "ZETA PHARM*" in L["corps"] else -1
    zm = msk & (flat[:, CI] == zi)

    def tot(m, col, sel):
        return float(flat[m & sel, col].sum())
    years = {}
    for y in [int(x) for x in meta["full_years"]]:
        sel = np.isin(yi, np.where(pyear == y)[0])
        years[str(y)] = {"zsu": tot(zm, SI, sel), "zval": tot(zm, LI, sel)}
    ytd_c = np.isin(yi, np.where(pyear == py)[0]); ytd_p = np.isin(yi, np.where((pyear == py - 1) & (pmon <= pm))[0])
    mat_c = yi >= t - 11; mat_p = (yi >= t - 23) & (yi < t - 11)
    z = {"ytd": {"su": tot(zm, SI, ytd_c), "val": tot(zm, LI, ytd_c), "su_py": tot(zm, SI, ytd_p), "val_py": tot(zm, LI, ytd_p)},
         "mat": {"su": tot(zm, SI, mat_c), "val": tot(zm, LI, mat_c), "su_py": tot(zm, SI, mat_p), "val_py": tot(zm, LI, mat_p)}}
    mk = {"su": tot(msk, SI, mat_c), "val": tot(msk, LI, mat_c), "su_py": tot(msk, SI, mat_p), "val_py": tot(msk, LI, mat_p)}
    # brands (products) over the last 12 months vs the 12 before
    n = len(L["prods"])
    def by(col, sel):
        m = msk & sel
        return np.bincount(flat[m, PI], weights=flat[m, col], minlength=n)
    sc, sp, vc, vp = by(SI, mat_c), by(SI, mat_p), by(LI, mat_c), by(LI, mat_p)
    keep = set(np.argsort(-sc)[:10].tolist()) | set(np.argsort(-vc)[:10].tolist())
    keep = [i for i in keep if sc[i] > 0 or vc[i] > 0]
    cm = msk & mat_c
    corp_of = {}
    for i in keep:
        r = flat[cm & (flat[:, PI] == i)]
        if len(r):
            c = np.bincount(r[:, CI], weights=r[:, LI]).argmax()
            corp_of[i] = L["corps"][int(c)]
    zp = set(np.unique(flat[zm, PI]).tolist()) if zi >= 0 else set()
    brands = [{"n": L["prods"][i], "c": corp_of.get(i, ""), "z": i in zp, "su": float(sc[i]), "su_py": float(sp[i]),
               "val": float(vc[i]), "val_py": float(vp[i])} for i in keep]
    # 2026-10-15: Zeta brands + items (SKUs) in this market and Zeta's own price per SU (last 6 months) for the FY+1 objective
    zb, zitems, zprice = [], [], None
    if zi >= 0 and zm.any():
        m6 = yi >= t - 5
        zsu6, zlc6 = float(flat[zm & m6, SI].sum()), float(flat[zm & m6, LI].sum())
        zprice = zlc6 / zsu6 if zsu6 > 0 else None
        r = flat[zm & mat_c]
        if len(r):
            pb = np.bincount(r[:, PI], weights=r[:, SI], minlength=n)
            zb = [L["prods"][i] for i in np.argsort(-pb) if pb[i] > 0]
            ni = len(L["items"]); isu = np.bincount(r[:, 12], weights=r[:, SI], minlength=ni); ilc = np.bincount(r[:, 12], weights=r[:, LI], minlength=ni)
        # 2026-10-15 (Ahmed): Zeta by ITEM (with brand + ATC4) - years, YTD, MAT, last-6-month price basis
        za = flat[zm]
        if len(za):
            ni = len(L["items"]); fyrs = [int(x) for x in meta["full_years"]]
            ids = np.unique(za[:, 12])
            def isum(sel, col):
                return np.bincount(za[sel, 12], weights=za[sel, col], minlength=ni)
            zy = za[:, TI]
            yy = {y: np.isin(zy, np.where(pyear == y)[0]) for y in fyrs}
            S = {"ytd": np.isin(zy, np.where(pyear == py)[0]), "ytdp": np.isin(zy, np.where((pyear == py - 1) & (pmon <= pm))[0]),
                 "mat": zy >= t - 11, "matp": (zy >= t - 23) & (zy < t - 11), "s6": zy >= t - 5}
            acc = {k: (isum(v, SI), isum(v, LI)) for k, v in S.items()}
            accy = {y: (isum(v, SI), isum(v, LI)) for y, v in yy.items()}
            out = []
            for i in ids.tolist():
                rr = za[za[:, 12] == i]
                pb_ = np.bincount(rr[:, PI], weights=rr[:, SI] + 1).argmax(); ab_ = np.bincount(rr[:, AI], weights=rr[:, SI] + 1).argmax()
                g = lambda k: [float(acc[k][0][i]), float(acc[k][1][i])]
                out.append({"item": L["items"][i], "brand": L["prods"][int(pb_)], "atc4": L["atc4s"][int(ab_)],
                            "su": g("mat")[0], "val": g("mat")[1], "years": {str(y): [float(accy[y][0][i]), float(accy[y][1][i])] for y in fyrs},
                            "ytd": g("ytd") + g("ytdp"), "mat": g("mat") + g("matp"), "s6": g("s6")})
            zitems = sorted(out, key=lambda x: (-x["su"], x["item"]))
    return {"zeta": {"years": years, **z, "brands": zb, "items": zitems, "price_su": zprice}, "market_mat": mk, "brands": brands,
            "mat_label": f"{MON[(int(P[t][5:7])) % 12]} {int(P[t][:4]) - 1}–{MON[int(P[t][5:7]) - 1]} {P[t][:4]}"}


def add_rationale(cache_path=None, iqvia_path=None, write=True):
    cache_path = cache_path or os.path.join(ROOT, "cache", "market_forecast.data.js")
    iqvia_path = iqvia_path or os.path.join(ROOT, "cache", "iqvia.json")
    obj = read_cache(cache_path)
    flat, L = load_iqvia(iqvia_path)
    meta = obj["meta"]
    if L["periods"] != meta["periods"]:
        raise SystemExit("iqvia.json periods differ from the forecast cache - rebuild the forecast first")
    d1 = {n: i for i, n in enumerate(L["dm1s"])}
    d2 = {n: i for i, n in enumerate(L["dm2s"])}

    def masks(seg):
        tp = seg["type"]
        if tp == "Total":
            return np.ones(len(flat), bool)
        if tp == "DM1":
            return flat[:, D1I] == d1[seg["name"]]
        if tp == "DM2":
            return flat[:, D2I] == d2[seg["name"]]
        return np.isin(flat[:, D1I], [d1[m] for m in (seg.get("members") or []) if m in d1])

    n = 0
    for seg in obj["segments"]:
        seg["rationale"] = build_rationale(seg, flat, L, meta, masks)
        seg["scorecard"] = build_scorecard(seg, flat, L, meta, masks)
        n += 1
    meta["rationale_built"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    if write:
        size = write_cache(obj, cache_path)
        print(f"rationale OK: {n} markets -> {os.path.relpath(cache_path, ROOT)} ({size / 1e6:.2f} MB)")
    return obj


if __name__ == "__main__":
    add_rationale()
    sys.exit(0)
