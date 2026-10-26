"""
build_market_forecast.py  --  Market Growth Forecast engine (Phase 0 + Phase 1)
Created 2026-10-12 for Ahmed (SFE Manager). Scope approved 2026-10-12:
  * Headline = FY2027 full-year Standard Units (SU), with FY2026 Landing Estimate (LE).
  * Grain    = DM1, DM2, BU, Line (+ Egypt total for reference).
  * Launch markets = run-rate floor, confidence "Lower", labelled
    "not statistically forecastable" (no interval, no extrapolated growth).
  * Phase 0 + 1 only: NO dashboard / cache / refresh_map change.

READ-ONLY on every input. Single input: cache/iqvia.json, i.e. the output of the
existing refresh_iqvia.py (restatements + product_market_overrides already applied),
so market definitions are identical to the Market Intelligence page.

BU / Line market = the DM1 markets in which Zeta has products of that BU / Line
(same rule as refresh_iqvia.py section 6 "bu_dm1s").

Outputs (default folder "Claude outputs/Market Forecast"):
  market_forecast_fy2027.json          per-segment results (Phase 2 UI contract)
  Market_Forecast_Backtest_FY2027.xlsx review workbook
  DATA_QUALITY_AUDIT_FY2027.md         Phase 0 audit

Usage:  python etl/build_market_forecast.py [--out DIR] [--perms 200]
Dependencies: numpy, openpyxl (both already installed). No scipy/statsmodels.
"""
import os, sys, json, gzip, base64, math, argparse
from datetime import datetime
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(ROOT, 'Claude outputs', 'Market Forecast'))
ap.add_argument('--perms', type=int, default=200)
ap.add_argument('--no-xlsx', action='store_true')
ap.add_argument('--cache', action='store_true', help='dashboard mode: write cache/market_forecast.data.js only (used by UPDATE_DASHBOARD)')
ARGS = ap.parse_args()
if not ARGS.cache: os.makedirs(ARGS.out, exist_ok=True)
RNG = np.random.default_rng(20261012)

# ── Proposed thresholds (PENDING Ahmed's approval; one place only) ───────────
CFG = {
    'launch_months': 36,        # < 36 consecutive positive months -> Launch
    'established_months': 60,   # >= 60 -> Established, else Developing
    'bt_first_origin_months': 36,   # first backtest origin needs 36 months
    'min_common_origins': 6,    # below this: validation insufficient
    'interval_min_origins': 12, # below this: no interval shown
    'outlier_hi': 1.8, 'outlier_lo': 0.55,  # month vs local median (+-3 months)
    'seasonal_p': 0.05,
    'med_tolerance': 0.10,      # prefer median-combination if within 10% of best WAPE
    'higher': {'wape': 0.06, 'bias': 0.03, 'spread_pts': 6.0, 'min_origins': 15},
    'moderate': {'wape': 0.12, 'bias': 0.06},
    'trend_band_pts': 3.0,      # stable vs acceleration/slowdown
    'runrate_months': 3,
}

# ── Load existing IQVIA cache ────────────────────────────────────────────────
SRC = os.environ.get('MF_IQVIA_SRC') or os.path.join(ROOT, 'cache', 'iqvia.json')   # 2026-10-26: env override = 'Original IQVIA' build (etl/build_market_forecast_raw.py)
d = json.load(open(SRC, encoding='utf-8'))
L = d['lookups']; P = L['periods']; T = len(P)
flat = np.array(json.loads(gzip.decompress(base64.b64decode(d['b64Data']))), dtype=np.int64).reshape(-1, 14)
CI, PI, TI, AI, D1I, D2I, LI, SI, LINEI, BUI = range(10)
data_period = d.get('kpis', {}).get('data_period', P[-1])

def ym(i):  # month index -> (year, month); P[0] must be 2021-01
    y0, m0 = int(P[0][:4]), int(P[0][5:7])
    k = (m0 - 1) + i
    return y0 + k // 12, k % 12 + 1

# Contiguity check (missing periods)
missing_periods = []
for i in range(1, T):
    if ym(i) != (int(P[i][:4]), int(P[i][5:7])):
        missing_periods.append(P[i])
assert not missing_periods, f'Non-contiguous periods: {missing_periods}'
MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
O = T - 1                       # forecast origin (latest actual month)
oy, om = ym(O)
TARGET_YEAR = oy + 1            # FY2027
H = (12 - om) + 12              # months from origin to end of target year (16)
YEARS = sorted({ym(i)[0] for i in range(T)})
FULL_YEARS = [y for y in YEARS if sum(1 for i in range(T) if ym(i)[0] == y) == 12]

def idx(y, m):
    y0, m0 = int(P[0][:4]), int(P[0][5:7])
    return (y - y0) * 12 + (m - m0)

# ── Global data checks (Phase 0) ─────────────────────────────────────────────
glob = {}
glob['rows'] = int(len(flat)); glob['periods'] = f'{P[0]}..{P[-1]} ({T} months, contiguous)'
glob['full_years'] = FULL_YEARS; glob['partial_year'] = f'{oy} (Jan-{MON[om-1]} only, {om} months)'
glob['negative_su_rows'] = int((flat[:, SI] < 0).sum())
glob['zero_su_with_value_rows'] = int(((flat[:, SI] == 0) & (flat[:, LI] > 0)).sum())
u, cnt = np.unique(flat, axis=0, return_counts=True)
dup_extra = cnt > 1
glob['exact_duplicate_rows'] = int((cnt[dup_extra] - 1).sum())
glob['exact_duplicate_su'] = int(((cnt[dup_extra] - 1) * u[dup_extra, SI]).sum())
glob['exact_duplicate_su_share'] = glob['exact_duplicate_su'] / max(1, int(flat[:, SI].sum()))
BACKFILL_ATC4 = ['B03A1 IRON PLAIN', 'C09D9 AT2 ANTG COMB OTH DRUGS', 'G03A1 MONOPHAS PREPS<50MCG OEST',
                 'H01C1 GONADOTROP-RELEAS HORM', 'L02A3 CYTO GONAD HORMON ANALOG', 'L04D0 JAK INHIBITORS',
                 'M01C0 SPEC ANTIRHEUMATIC AGENT', 'N02A0 NARCOTIC ANALGESICS', 'N07X0 ALL OTHER CNS DRUGS']
bf_idx = [L['atc4s'].index(a) for a in BACKFILL_ATC4 if a in L['atc4s']]
bfm = np.isin(flat[:, AI], bf_idx)
bf_su = np.bincount(flat[bfm, TI], weights=flat[bfm, SI], minlength=T)
bf_lc = np.bincount(flat[bfm, TI], weights=flat[bfm, LI], minlength=T)
eg_su = np.bincount(flat[:, TI], weights=flat[:, SI], minlength=T)
price = np.where(bf_su > 0, bf_lc / np.maximum(bf_su, 1), np.nan)
pre = np.nanmedian(price[O - 13:O - 1]); post = np.nanmedian(price[O - 1:O + 1])
glob['backfill_unit_check'] = {
    'atc4s': BACKFILL_ATC4,
    'share_of_egypt_su_last12': float(bf_su[-12:].sum() / eg_su[-12:].sum()),
    'egp_per_su_median_prior12': float(pre), 'egp_per_su_median_last2': float(post),
    'ratio': float(post / pre),
    'verdict': ('no unit break detected' if 0.67 <= post / pre <= 1.5 else 'POSSIBLE unit break'),
    'note': ("History of these 9 ATC4s (all DM1/DM2 = OTHER MARKET) is backfilled from the raw combined "
             "report's 'Units' column; latest months come from 'Standard Units Sales'. A pack-unit vs "
             "standard-unit mix would move EGP-per-SU by roughly the pack size (x10-x30); the ratio test "
             "checks for that."),
}
UNIT_BREAK = glob['backfill_unit_check']['verdict'] != 'no unit break detected'

# ── Segments ─────────────────────────────────────────────────────────────────
zeta_i = L['corps'].index('ZETA PHARM*') if 'ZETA PHARM*' in L['corps'] else -1
zr = flat[flat[:, CI] == zeta_i]
RESIDUAL = {'OTHER MARKET'}
segments = []   # dict(type, name, mask, dm1s)

def add(typ, name, mask, members=None):
    if mask.sum() == 0: return
    segments.append({'type': typ, 'name': name, 'mask': mask, 'members': members})

add('Total', 'EGYPT TOTAL MARKET', np.ones(len(flat), bool))
for i, n in enumerate(L['dm1s']):
    if n == '(none)': continue
    add('DM1', n, flat[:, D1I] == i)
for i, n in enumerate(L['dm2s']):
    if n == '(none)': continue
    add('DM2', n, flat[:, D2I] == i)
for typ, col, lk in (('BU', BUI, 'bus'), ('Line', LINEI, 'lines')):
    for i, n in enumerate(L[lk]):
        if n in ('(none)', ''): continue
        s = sorted(set(zr[zr[:, col] == i, D1I].tolist()))
        if not s: continue
        add(typ, n, np.isin(flat[:, D1I], s), [L['dm1s'][x] for x in s])

# Duplicate-market check: segments with an identical row set are the same market
import hashlib
_sig = {}
for sg in segments:
    h_ = hashlib.md5(np.flatnonzero(sg['mask']).tobytes()).hexdigest()
    sg['same_as'] = [f"{t_}:{n_}" for t_, n_ in _sig.get(h_, [])]
    _sig.setdefault(h_, []).append((sg['type'], sg['name']))

# ── Helpers ──────────────────────────────────────────────────────────────────
def mat(y, t): return float(y[t - 11:t + 1].sum()) if t >= 11 else None

def run_start(y, t):
    """first index of the consecutive positive run that ends at t"""
    s = t
    while s - 1 >= 0 and y[s - 1] > 0: s -= 1
    return s if y[t] > 0 else None

def seasonal_indices(y, s, t, perms):
    """multiplicative indices from ratio-to-2x12 centred MA on y[s..t]; permutation F-test"""
    x = y[s:t + 1].astype(float); n = len(x)
    if n < 36: return None, None
    ratios, months = [], []
    for i in range(6, n - 6):
        cma = (0.5 * x[i - 6] + x[i - 5:i + 6].sum() + 0.5 * x[i + 6]) / 12.0
        if cma > 0: ratios.append(x[i] / cma); months.append(ym(s + i)[1] - 1)
    r = np.array(ratios); g = np.array(months); N = len(r)
    if N < 24 or len(set(g.tolist())) < 12: return None, None
    def F(lbl):
        oh = np.zeros((lbl.shape[0], 12)) if lbl.ndim == 1 else None
        cnts = np.bincount(lbl, minlength=12); sums = np.bincount(lbl, weights=r, minlength=12)
        means = sums / np.maximum(cnts, 1); gm = r.mean()
        ssb = (cnts * (means - gm) ** 2).sum(); ssw = ((r - means[lbl]) ** 2).sum()
        return (ssb / 11) / (ssw / (N - 12)) if ssw > 0 else np.inf
    f0 = F(g); ge = 0
    for _ in range(perms):
        if F(RNG.permutation(g)) >= f0: ge += 1
    p = (ge + 1) / (perms + 1)
    cn = np.bincount(g, minlength=12); sm = np.bincount(g, weights=r, minlength=12)
    si = sm / np.maximum(cn, 1); si = si / si.mean()
    return si, p

_A = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
_B = np.array([0.01, 0.05, 0.1, 0.2, 0.3])
_F = np.array([0.80, 0.85, 0.90, 0.95, 0.98])
GA, GB, GF = [g.ravel() for g in np.meshgrid(_A, _B, _F, indexing='ij')]

def holt_damped_log(x, h):
    """Holt damped trend on log(x); grid-searched alpha/beta/phi by in-sample 1-step SSE"""
    z = np.log(np.asarray(x, float)); n = len(z)
    if n < 24: return None, None
    l = np.full(GA.shape, z[:12].mean()); b = np.full(GA.shape, (z[12:24].mean() - z[:12].mean()) / 12.0)
    l = l - b * 5.5  # level at start of series
    sse = np.zeros(GA.shape)
    for i in range(n):
        f = l + GF * b
        e = z[i] - f
        if i >= 12: sse += e * e
        ln = GA * z[i] + (1 - GA) * f
        b = GB * (ln - l) + (1 - GB) * GF * b
        l = ln
    k = int(np.argmin(sse)); phi = GF[k]
    cum = np.cumsum(phi ** np.arange(1, h + 1))
    return np.exp(l[k] + cum * b[k]), {'alpha': float(GA[k]), 'beta': float(GB[k]), 'phi': float(phi)}

MODEL_LABEL = {
    'NAIVE': 'Benchmark: seasonal naive (last 12 months carried flat)',
    'A': 'Model A: historical CAGR (longest whole-year MAT span, max 4 yrs)',
    'B': 'Model B: recent 2-year MAT CAGR',
    'C1': 'Model C1: linear trend on annual MAT points',
    'C2': 'Model C2: Holt damped trend, monthly (log, seasonally adjusted if seasonal)',
    'MED': 'Median combination of A, B, C1, C2 (per month)',
    'RUNRATE': 'Run-rate floor: last 3 months average x months (launch markets)',
}

def model_paths(y, t, h, perms, want=('NAIVE', 'A', 'B', 'C1', 'C2', 'MED')):
    """Forecast paths y[t+1..t+h] for each model using ONLY y[0..t] (no leakage)."""
    y = y[:t + 1]                                   # hard cut: nothing after origin is visible
    s = run_start(y, t); out = {}; info = {}
    if s is None: return out, info
    n_run = t - s + 1
    def ratio_path(r1, r2):
        p = np.empty(h)
        for k in range(1, h + 1):
            if k <= 12: p[k - 1] = y[t + k - 12] * r1
            else:       p[k - 1] = y[t + k - 24] * r2 if t + k - 24 >= 0 else np.nan
        return p
    M0 = mat(y, t)
    if 'NAIVE' in want and n_run >= 12: out['NAIVE'] = ratio_path(1.0, 1.0)
    # Model A: longest whole-year MAT span inside the positive run (2..4 years)
    kmax = 0
    for k in (4, 3, 2):
        if t - 12 * k - 11 >= s: kmax = k; break
    if kmax:
        g = (M0 / mat(y, t - 12 * kmax)) ** (1 / kmax) - 1
        out['A'] = ratio_path(1 + g, (1 + g) ** 2); info['A_years'] = kmax; info['A_g'] = g
    if t - 35 >= s:
        g = (M0 / mat(y, t - 24)) ** 0.5 - 1
        out['B'] = ratio_path(1 + g, (1 + g) ** 2); info['B_g'] = g
    pts = [mat(y, t - 12 * j) for j in range(5) if t - 12 * j - 11 >= s][::-1]
    if len(pts) >= 3:
        xs = np.arange(len(pts)); sl, ic = np.polyfit(xs, pts, 1)
        f1, f2 = ic + sl * len(pts), ic + sl * (len(pts) + 1)
        if f1 > 0 and f2 > 0:
            out['C1'] = ratio_path(f1 / M0, f2 / M0); info['C1_points'] = len(pts)
    if n_run >= 24:
        si, p = seasonal_indices(y, s, t, perms)
        seas = si is not None and p < CFG['seasonal_p']
        x = y[s:t + 1].astype(float)
        if seas: x = x / si[[ym(s + i)[1] - 1 for i in range(len(x))]]
        f, prm = holt_damped_log(x, h)
        if f is not None:
            if seas: f = f * si[[ym(t + k)[1] - 1 for k in range(1, h + 1)]]
            out['C2'] = f; info['C2'] = prm; info['seasonal'] = bool(seas); info['seasonal_p'] = None if p is None else float(p)
    comb = [out[k] for k in ('A', 'B', 'C1', 'C2') if k in out]
    if 'MED' in want and len(comb) >= 2: out['MED'] = np.median(np.vstack(comb), axis=0)
    rr = y[t - CFG['runrate_months'] + 1:t + 1]
    if (rr > 0).all(): out['RUNRATE'] = np.full(h, rr.mean())
    info['run_start'] = s; info['n_run'] = n_run
    return out, info

# ── Per-segment analysis ─────────────────────────────────────────────────────
def year_total(y, yr):
    ii = [i for i in range(T) if ym(i)[0] == yr]
    return float(y[ii].sum()), len(ii)

def cagr(a, b, n): return (b / a) ** (1 / n) - 1 if (a and b and a > 0 and b > 0 and n > 0) else None

def pct(x): return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(100 * x, 2)

def outliers(y, s):
    fl = []
    for t in range(s, T):
        w = [y[j] for j in range(max(s, t - 3), min(T, t + 4)) if j != t and y[j] > 0]
        if len(w) < 4: continue
        med = float(np.median(w)); r = y[t] / med if med > 0 else None
        if r is not None and (r > CFG['outlier_hi'] or r < CFG['outlier_lo']):
            fl.append({'period': P[t], 'su': float(y[t]), 'local_median': med, 'ratio': round(r, 2),
                       'type': 'spike' if r > 1 else 'drop'})
    return fl

results, bt_rows, metric_rows = [], [], []
first_origin = CFG['bt_first_origin_months'] - 1
origins = list(range(first_origin, T - 12))   # each backtest target = next 12 actual months

for sg in segments:
    m = sg['mask']
    y = np.bincount(flat[m, TI], weights=flat[m, SI], minlength=T).astype(float)
    yz = np.bincount(flat[m & (flat[:, CI] == zeta_i), TI], weights=flat[m & (flat[:, CI] == zeta_i), SI], minlength=T).astype(float)
    rec = {'type': sg['type'], 'name': sg['name'], 'members': sg['members'],
           'residual_market': sg['name'] in RESIDUAL or (sg['members'] is not None and set(sg['members']) <= RESIDUAL) or
                              (sg['members'] is not None and 'OTHER MARKET' in sg['members']),
           'unit': 'Standard Units', 'data_period': data_period, 'same_as': sg['same_as']}
    flags = []
    s = run_start(y, O)
    first_pos = int(np.argmax(y > 0)) if (y > 0).any() else None
    rec['first_month_with_sales'] = P[first_pos] if first_pos is not None else None
    interior_zero = [P[i] for i in range(first_pos or 0, T) if y[i] == 0] if first_pos is not None else []
    rec['interior_zero_months'] = interior_zero
    if interior_zero: flags.append({'sev': 'high' if any(P.index(p) >= O - 23 for p in interior_zero) else 'medium',
                                    'code': 'ZERO_GAPS', 'text': f'{len(interior_zero)} month(s) with zero SU after first sale ({interior_zero[0]}..{interior_zero[-1]}); treated as no recorded sales, not as missing.'})
    n_run = (O - s + 1) if s is not None else 0
    rec['consecutive_positive_months'] = n_run
    life = 'Launch' if n_run < CFG['launch_months'] else ('Established' if n_run >= CFG['established_months'] else 'Developing')
    rec['lifecycle'] = life
    # history facts (calendar years; partial year flagged)
    hist = {}
    for yr in YEARS:
        v, nm = year_total(y, yr); hist[str(yr)] = {'su': v, 'months': nm, 'complete': nm == 12}
    rec['history'] = hist
    ytd_cur = float(y[idx(oy, 1):O + 1].sum()); ytd_py = float(y[idx(oy - 1, 1):idx(oy - 1, om) + 1].sum())
    rec['ytd'] = {'months': f'Jan-{MON[om-1]}', 'cur': ytd_cur, 'py': ytd_py, 'growth_pct': pct(ytd_cur / ytd_py - 1) if ytd_py > 0 else None}
    fy = [hist[str(yr)]['su'] for yr in FULL_YEARS]
    first_full = next((yr for yr in FULL_YEARS if s is not None and idx(yr, 1) >= s), None)
    long_cagr = None; long_span = None
    if first_full is not None and first_full < FULL_YEARS[-1]:
        long_span = f'{first_full}-{FULL_YEARS[-1]}'
        long_cagr = cagr(hist[str(first_full)]['su'], hist[str(FULL_YEARS[-1])]['su'], FULL_YEARS[-1] - first_full)
    rec['hist_cagr'] = {'span': long_span, 'pct': pct(long_cagr), 'basis': 'calendar full years, first full year after launch'}
    y2 = FULL_YEARS[-1] - 2
    rec_cagr = cagr(hist[str(y2)]['su'], hist[str(FULL_YEARS[-1])]['su'], 2) if (s is not None and idx(y2, 1) >= s) else None
    rec['recent_cagr'] = {'span': f'{y2}-{FULL_YEARS[-1]}', 'pct': pct(rec_cagr)}
    yoy = {}
    for a, b in zip(FULL_YEARS[:-1], FULL_YEARS[1:]):
        va, vb = hist[str(a)]['su'], hist[str(b)]['su']
        yoy[f'{a}-{b}'] = pct(vb / va - 1) if (va > 0 and s is not None and idx(a, 1) >= s) else None
    rec['yoy_pct'] = yoy
    out_l = outliers(y, s) if s is not None else []
    rec['outliers'] = out_l
    recent_out = [o for o in out_l if P.index(o['period']) >= O - 11]
    if out_l: flags.append({'sev': 'high' if len(recent_out) >= 2 else 'medium', 'code': 'OUTLIERS',
                            'text': f"{len(out_l)} abnormal month(s) flagged (not removed): " + ', '.join(f"{o['period']} {o['type']} x{o['ratio']}" for o in out_l[:6]) + ('...' if len(out_l) > 6 else '')})
    for k, v in yoy.items():
        if v is not None and abs(v) >= 40 and life != 'Launch':
            flags.append({'sev': 'medium', 'code': 'LEVEL_SHIFT', 'text': f'Full-year change {k} of {v:+.1f}% (possible structural break / mapping or panel change).'})
    if rec['residual_market']:
        flags.append({'sev': 'info', 'code': 'RESIDUAL', 'text': 'Contains OTHER MARKET (residual, non-defined market); forecast describes the residual pool, not a promoted market.'})
    if sg['type'] in ('Total', 'DM1', 'DM2', 'BU', 'Line') and rec['residual_market']:
        rec['backfill_su_share_last12'] = float(np.bincount(flat[m & bfm, TI], weights=flat[m & bfm, SI], minlength=T)[-12:].sum() / max(1, y[-12:].sum()))
        if UNIT_BREAK: flags.append({'sev': 'high', 'code': 'UNIT_MIX', 'text': 'Backfilled ATC4 history may be pack units, not SU.'})
    rec['monthly_su'] = [float(v) for v in y]; rec['monthly_zeta_su'] = [float(v) for v in yz]

    # ── Backtest (rolling origin, 12-month-ahead total, no leakage) ──
    cand = ['NAIVE', 'A', 'B', 'C1', 'C2', 'MED']
    errs = {k: [] for k in cand + ['RUNRATE']}
    for o in origins:
        paths, _ = model_paths(y, o, 12, ARGS.perms)
        act = float(y[o + 1:o + 13].sum())
        if act <= 0: continue
        for k, p in paths.items():
            if np.isnan(p).any(): continue
            fc = float(p.sum()); errs[k].append((o, fc, act))
            bt_rows.append([sg['type'], sg['name'], k, P[o], f'{P[o + 1]}..{P[o + 12]}', fc, act, fc - act, (fc - act) / act])
    common = None
    for k in ('NAIVE', 'A', 'B', 'C1', 'C2'):
        oo = {e[0] for e in errs[k]}
        common = oo if common is None else common & oo
    common = sorted(common or [])
    met = {}
    for k in cand + ['RUNRATE']:
        e = [x for x in errs[k] if x[0] in common] if k != 'RUNRATE' else errs[k]
        if not e: continue
        fc = np.array([x[1] for x in e]); ac = np.array([x[2] for x in e])
        met[k] = {'n': len(e), 'mae': float(np.abs(fc - ac).mean()), 'wape': float(np.abs(fc - ac).sum() / ac.sum()),
                  'bias': float((fc - ac).sum() / ac.sum()),
                  'logerr': [float(math.log(a / f)) for f, a in zip(fc, ac) if f > 0]}
    if 'NAIVE' in met:
        for k in met: met[k]['rel_to_naive'] = met[k]['wape'] / met['NAIVE']['wape'] if met['NAIVE']['wape'] > 0 else None
    for k, v in met.items():
        metric_rows.append([sg['type'], sg['name'], k, MODEL_LABEL[k], v['n'], v['mae'], v['wape'], v['bias'], v.get('rel_to_naive')])
    rec['backtest'] = {'design': 'rolling origin, forecast of the next 12 months total from each month-end origin, data cut at origin',
                       'origins': f'{P[common[0]]}..{P[common[-1]]}' if common else None, 'n_common': len(common),
                       'metrics': {k: {kk: vv for kk, vv in v.items() if kk != 'logerr'} for k, v in met.items()}}

    # ── Final forecast from origin (latest month) ──
    paths, info = model_paths(y, O, H, ARGS.perms)
    rec['model_info'] = {k: v for k, v in info.items() if k not in ('run_start',)}
    cut = 12 - om                      # months of current year still to forecast (Sep-Dec = 4)
    def le_fy(p):
        le = ytd_cur + float(p[:cut].sum()); f27 = float(p[cut:cut + 12].sum()); return le, f27
    cands = {}
    for k, p in paths.items():
        if np.isnan(p).any(): continue
        le, f27 = le_fy(p)
        cands[k] = {'label': MODEL_LABEL[k], 'fy_le': le, 'fy_target': f27, 'growth_vs_le_pct': pct(f27 / le - 1) if le > 0 else None,
                    'growth_vs_last_full_year_cagr_pct': pct(cagr(hist[str(FULL_YEARS[-1])]['su'], f27, 2))}
    rec['candidates'] = cands
    n_common = len(common)
    sel, why_sel, conf, conf_reasons = None, '', 'Lower', []
    if life == 'Launch':
        sel = 'RUNRATE' if 'RUNRATE' in cands else None
        why_sel = (f'Launch market ({n_run} consecutive months with sales < {CFG["launch_months"]}): not statistically forecastable. '
                   'A run-rate floor is shown (last 3 months average, no growth extrapolated). '
                   'A credible launch forecast needs analog uptake curves / brand-team input.')
        conf_reasons.append('Launch market: no validated statistical forecast')
    else:
        pool = {k: met[k] for k in cand if k in met and k in cands}
        if n_common < CFG['min_common_origins'] or not pool:
            sel = 'RUNRATE' if 'RUNRATE' in cands else None
            why_sel = (f'Only {n_common} backtest origins where all models could run (< {CFG["min_common_origins"]}): '
                       'no model can be validated, so the market is treated as not statistically forecastable and a run-rate floor is shown. '
                       'Unvalidated model results are listed for reference only.')
            conf_reasons.append('Validation insufficient: not statistically forecastable')
        else:
            best = min(pool, key=lambda k: pool[k]['wape'])
            if best != 'MED' and 'MED' in pool and pool['MED']['wape'] <= pool[best]['wape'] * (1 + CFG['med_tolerance']):
                sel = 'MED'
                why_sel = (f"Best single model {best} (WAPE {pool[best]['wape']*100:.1f}%) is within {int(CFG['med_tolerance']*100)}% of the median "
                           f"combination (WAPE {pool['MED']['wape']*100:.1f}%) on {n_common} origins; the combination is preferred because "
                           "overlapping 12-month origins exaggerate small differences between models.")
            else:
                sel = best
                why_sel = (f"Lowest out-of-sample WAPE ({pool[best]['wape']*100:.1f}%) over {n_common} rolling origins"
                           + (f"; {(1-pool[best].get('rel_to_naive',1))*100:.0f}% better than the seasonal-naive benchmark." if pool[best].get('rel_to_naive') else '.'))
    rec['forecast_type'] = 'run_rate_floor' if sel == 'RUNRATE' else ('statistical' if sel else 'none')
    rec['statistically_forecastable'] = sel not in ('RUNRATE', None)
    rec['selected_model'] = sel; rec['selected_label'] = MODEL_LABEL.get(sel); rec['selection_rationale'] = why_sel
    base = cands.get(sel) if sel else None
    rec['forecast'] = None
    if base:
        fc = dict(base); fc['basis_note'] = (f'FY{oy} LE = actual Jan-{MON[om-1]} {oy} + forecast {MON[om % 12]}-Dec. '
                                            f'Growth % = FY{TARGET_YEAR} / FY{oy} LE - 1 (FY{oy} is part-forecast).')
        fc['fy_last_actual'] = {'year': FULL_YEARS[-1], 'su': hist[str(FULL_YEARS[-1])]['su']}
        fc['path'] = [float(v) for v in paths[sel]]   # monthly forecast, origin+1 .. Dec of target year
        # empirical interval
        if sel != 'RUNRATE' and sel in met and len(met[sel]['logerr']) >= CFG['interval_min_origins']:
            le_ = np.array(met[sel]['logerr']); scale = math.sqrt((cut + 6.5) / 6.5)
            med_ = float(np.median(le_))
            q10, q90 = np.quantile(le_, 0.10) - med_, np.quantile(le_, 0.90) - med_
            lo, hi = fc['fy_target'] * math.exp(q10 * scale), fc['fy_target'] * math.exp(q90 * scale)
            fc['scenarios'] = {'low': lo, 'base': fc['fy_target'], 'high': hi,
                               'low_growth_pct': pct(lo / fc['fy_le'] - 1), 'high_growth_pct': pct(hi / fc['fy_le'] - 1),
                               'median_backtest_error_pct': pct(math.exp(med_) - 1),
                               'method': (f'Spread of the selected model\'s own out-of-sample errors (P10/P90 around their median, n={len(le_)}), '
                                          f'widened by sqrt(horizon ratio)={scale:.2f} for the longer FY{TARGET_YEAR} horizon (assumption). '
                                          'Systematic bias is NOT folded into the range; it is reported separately.')}
        else:
            fc['scenarios'] = None
        rec['forecast'] = fc
    # model spread (A,B,C1,C2 growth vs own LE)
    gs = [cands[k]['growth_vs_le_pct'] for k in ('A', 'B', 'C1', 'C2') if k in cands and cands[k]['growth_vs_le_pct'] is not None]
    spread = (max(gs) - min(gs)) if len(gs) >= 2 else None
    rec['model_spread_pts'] = None if spread is None else round(spread, 2)
    # confidence
    hi_flags = [f for f in flags if f['sev'] == 'high']
    if sel not in ('RUNRATE', None) and sel in met:
        w, b = met[sel]['wape'], abs(met[sel]['bias'])
        H_, M_ = CFG['higher'], CFG['moderate']
        if (life == 'Established' and n_common >= H_['min_origins'] and w <= H_['wape'] and b <= H_['bias']
                and spread is not None and spread <= H_['spread_pts'] and not hi_flags):
            conf = 'Higher'
        elif n_common >= CFG['min_common_origins'] and w <= M_['wape'] and b <= M_['bias'] and not any(f['code'] == 'UNIT_MIX' for f in hi_flags):
            conf = 'Moderate'
        else:
            conf = 'Lower'
        conf_reasons.append(f"Backtest WAPE {w*100:.1f}%, bias {met[sel]['bias']*100:+.1f}%, {n_common} origins, lifecycle {life}"
                            + (f", model spread {spread:.1f} pts" if spread is not None else '')
                            + (f", {len(hi_flags)} high-severity data flag(s)" if hi_flags else ''))
    rec['confidence'] = conf; rec['confidence_reasons'] = conf_reasons
    rec['data_quality_flags'] = flags

    # outlier sensitivity (impact documentation only, never used for the headline)
    if base and out_l and sel != 'RUNRATE':
        yc = y.copy()
        for o_ in out_l:
            i = P.index(o_['period']); yc[i] = o_['local_median']
        p2, _ = model_paths(yc, O, H, ARGS.perms)
        if sel in p2:
            ytd_c = float(yc[idx(oy, 1):O + 1].sum())
            f27c = float(p2[sel][cut:cut + 12].sum())
            rec['outlier_sensitivity'] = {'fy_target_if_outliers_replaced': f27c, 'delta_pct': pct(f27c / base['fy_target'] - 1)}

    # ── "Why This Forecast?" (rule-based, facts vs assumptions) ──
    facts, assumptions = [], []
    if rec['hist_cagr']['pct'] is not None: facts.append(f"Long-run trend {rec['hist_cagr']['span']}: {rec['hist_cagr']['pct']:+.1f}% a year (Standard Units).")
    if rec['recent_cagr']['pct'] is not None: facts.append(f"Recent trend {rec['recent_cagr']['span']}: {rec['recent_cagr']['pct']:+.1f}% a year.")
    if rec['ytd']['growth_pct'] is not None: facts.append(f"YTD {rec['ytd']['months']} {oy} vs {oy-1}: {rec['ytd']['growth_pct']:+.1f}%.")
    lc_, rc_ = rec['hist_cagr']['pct'], rec['recent_cagr']['pct']
    if lc_ is not None and rc_ is not None:
        dlt = rc_ - lc_; band = CFG['trend_band_pts']
        facts.append('Pattern: ' + ('stable trend (recent within ±%.0f pts of long-run).' % band if abs(dlt) <= band else
                     (f'recent acceleration (+{dlt:.1f} pts vs long-run).' if dlt > 0 else f'recent slowdown ({dlt:.1f} pts vs long-run).')))
    if sel == 'RUNRATE':
        if life == 'Launch':
            facts.append(f"Market has {n_run} consecutive months of recorded sales: too short to validate a statistical model.")
        else:
            facts.append(f"{'No' if n_common == 0 else 'Only ' + str(n_common)} backtest origin(s) where all models could run: no statistical model can be validated for this market.")
        if 'RUNRATE' in met and met['RUNRATE']['n'] >= 3:
            facts.append(f"In {met['RUNRATE']['n']} past tests a 3-month run-rate {'under' if met['RUNRATE']['bias'] < 0 else 'over'}-stated the next 12 months by {abs(met['RUNRATE']['bias'])*100:.0f}% on average.")
        if len(y) >= 6 and y[O - 5:O - 2].sum() > 0:
            facts.append(f"Momentum: last 3 months vs previous 3 months {pct(y[O-2:O+1].sum()/y[O-5:O-2].sum()-1):+.1f}%.")
        assumptions.append('Run-rate floor assumes volume stays at the last-3-month level; real launch markets usually keep growing, so treat it as a minimum, not a target.')
    else:
        if spread is not None:
            facts.append(('Candidate models agree' if spread <= 3 else ('Candidate models broadly agree' if spread <= 6 else 'Candidate models disagree'))
                         + f" (FY{TARGET_YEAR} growth range {min(gs):+.1f}% to {max(gs):+.1f}%).")
        if sel in met:
            bb = met[sel]['bias']
            facts.append(f"Selected {sel}: backtest WAPE {met[sel]['wape']*100:.1f}%, historically {'over' if bb > 0 else 'under'}-forecast by {abs(bb)*100:.1f}% on average.")
        if info.get('seasonal'): facts.append('Monthly seasonality is statistically significant and is applied.')
        assumptions.append('Assumes the historical volume pattern continues. Launches, withdrawals, shortages, price changes, tenders and IQVIA panel/mapping changes after the data period are not modelled.')
    if hi_flags: facts.append('Data quality: ' + '; '.join(f['code'] for f in hi_flags) + ' (see warnings).')
    assumptions.append(f'FY{oy} base is a Landing Estimate ({om} actual months + {cut} forecast months).')
    rec['why'] = {'facts': facts, 'assumptions': assumptions}
    results.append(rec)

FUTURE = []
for k in range(1, H + 1):
    yy, mm = ym(O + k); FUTURE.append(f'{yy}-{mm:02d}')

# ── Dashboard cache mode ─────────────────────────────────────────────────────
if ARGS.cache:
    slim = []
    for r in results:
        r2 = {k: v for k, v in r.items() if k != 'monthly_zeta_su'}
        slim.append(r2)
    meta_c = {'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M'), 'source': 'cache/iqvia.json',
              'data_period': data_period, 'origin': P[O], 'target_year': TARGET_YEAR, 'horizon_months': H,
              'periods': P, 'future_periods': FUTURE, 'full_years': FULL_YEARS, 'partial_year': oy, 'partial_months': om,
              'measure': 'IQVIA Standard Units', 'config': CFG, 'models': MODEL_LABEL, 'global_checks': glob}
    js = json.dumps({'meta': meta_c, 'segments': slim}, separators=(',', ':'))
    b64 = base64.b64encode(gzip.compress(js.encode('utf-8'), compresslevel=9)).decode('ascii')
    outp = os.environ.get('MF_CACHE_DST') or os.path.join(ROOT, 'cache', 'market_forecast.data.js')
    tmp = outp + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write('window.MARKET_FORECAST_CACHE = {b64Data:"' + b64 + '"};\n')
    os.replace(tmp, outp)
    print(f'OK: {len(results)} segments, origin {P[O]}, target FY{TARGET_YEAR} -> cache/market_forecast.data.js ({len(b64)/1e6:.2f} MB)')
    sys.exit(0)

# ── Write JSON ───────────────────────────────────────────────────────────────
meta = {'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M'), 'source': 'cache/iqvia.json',
        'data_period': data_period, 'origin': P[O], 'target_year': TARGET_YEAR, 'horizon_months': H,
        'measure': 'IQVIA Standard Units (Standard Units Sales)', 'config': CFG, 'models': MODEL_LABEL,
        'global_checks': glob, 'status': 'PHASE 1 REVIEW OUTPUT - not wired into dashboard or refresh'}
with open(os.path.join(ARGS.out, f'market_forecast_fy{TARGET_YEAR}.json'), 'w', encoding='utf-8') as fh:
    json.dump({'meta': meta, 'segments': results}, fh, separators=(',', ':'))

# ── Data-quality audit markdown ──────────────────────────────────────────────
bc = glob['backfill_unit_check']
lines = [f'# Market Forecast FY{TARGET_YEAR} -- Phase 0 Data-Quality Audit', '',
         f'Generated {meta["generated_at"]} from `cache/iqvia.json` (data period {data_period}). Read-only; nothing in the dashboard was changed.', '',
         '## Global checks', '',
         f'- Periods: {glob["periods"]}. Full years: {", ".join(map(str, FULL_YEARS))}. Partial: {glob["partial_year"]}.',
         f'- Granularity: **monthly**. Forecasting is done on monthly data and rolled up to FY{TARGET_YEAR}; FY{oy} is a Landing Estimate.',
         f'- Negative SU rows: {glob["negative_su_rows"]}. Rows with value but zero SU: {glob["zero_su_with_value_rows"]}.',
         f'- Exact duplicate rows (all 14 fields identical): {glob["exact_duplicate_rows"]} rows, {glob["exact_duplicate_su_share"]*100:.4f}% of SU. Kept as-is (same as the dashboard); impact immaterial.',
         f'- Backfilled ATC4s (9, all OTHER MARKET): {bc["share_of_egypt_su_last12"]*100:.1f}% of Egypt SU (last 12 m). EGP per SU prior 12 m {bc["egp_per_su_median_prior12"]:.2f} vs last 2 m {bc["egp_per_su_median_last2"]:.2f} (ratio {bc["ratio"]:.2f}) -> **{bc["verdict"]}**.',
         '- Known source revision: IQVIA restated Mar-Jun 2026 upward in the 2026-10-09 source (history can change on any refresh; the backtest is re-run every build).', '',
         '## Segment summary', '', '| Type | Segment | Lifecycle | Months w/ sales | Zero gaps | Outlier months | High flags |', '|---|---|---|---|---|---|---|']
for r in results:
    lines.append(f"| {r['type']} | {r['name']} | {r['lifecycle']} | {r['consecutive_positive_months']} | {len(r['interior_zero_months'])} | {len(r['outliers'])} | "
                 + (', '.join(f['code'] for f in r['data_quality_flags'] if f['sev'] == 'high') or '-') + ' |')
lines += ['', '## Flag detail', '']
for r in results:
    fl = [f for f in r['data_quality_flags'] if f['sev'] != 'info']
    if fl:
        lines.append(f"**{r['type']} / {r['name']}**")
        for f in fl: lines.append(f"- [{f['sev']}] {f['code']}: {f['text']}")
        lines.append('')
open(os.path.join(ARGS.out, f'DATA_QUALITY_AUDIT_FY{TARGET_YEAR}.md'), 'w', encoding='utf-8').write('\n'.join(lines))

# ── Review workbook ──────────────────────────────────────────────────────────
if not ARGS.no_xlsx:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook(); HDR = PatternFill('solid', fgColor='1F3864'); HF = Font(bold=True, color='FFFFFF')
    def sheet(name, header, rows, widths=None, fmts=None):
        ws = wb.create_sheet(name); ws.append(header)
        for c in ws[1]: c.fill = HDR; c.font = HF; c.alignment = Alignment(wrap_text=True, vertical='center')
        for r in rows: ws.append(r)
        ws.freeze_panes = 'C2' if len(header) > 3 else 'A2'
        for i, w in enumerate(widths or []): ws.column_dimensions[chr(65 + i) if i < 26 else 'A' + chr(65 + i - 26)].width = w
        for col, f in (fmts or {}).items():
            for cell in ws[col][1:]: cell.number_format = f
        return ws
    ws0 = wb.active; ws0.title = 'README'
    readme = [f'Market Growth Forecast FY{TARGET_YEAR} -- Phase 1 review workbook (generated {meta["generated_at"]})',
              f'Source: cache/iqvia.json (data to {data_period}). Measure: IQVIA Standard Units. Origin: {P[O]}. Horizon: {H} months.',
              'Status: REVIEW ONLY. Not wired into the dashboard or UPDATE_DASHBOARD.bat.', '',
              'METHOD', '1. Each segment (DM1, DM2, BU, Line, Egypt total) is forecast independently from its own monthly SU.',
              '2. Lifecycle: Launch (<36 consecutive months with sales) -> run-rate floor, confidence Lower, no interval.',
              '   Developing (36-59) / Established (>=60) -> statistical models below.',
              '3. Models: seasonal naive benchmark; A historical MAT CAGR; B recent 2-yr MAT CAGR; C1 linear trend on annual MATs;',
              '   C2 Holt damped trend on monthly log SU (seasonally adjusted when a permutation F-test gives p<0.05); MED = per-month median of A,B,C1,C2.',
              '4. Backtest: rolling origin, every month-end from month 36, forecast the next 12 months total using only data up to the origin.',
              '   Metrics on origins common to all models: MAE, WAPE (sum|err|/sum actual), bias (sum err/sum actual; + = over-forecast), WAPE relative to naive.',
              '   Origins overlap (12-month windows), so they are not independent: differences of a few tenths of a point are not meaningful.',
              '5. Selection: lowest WAPE; if MED is within 10% of the best, MED is used (robustness).',
              f'6. FY{oy} LE = actual Jan-{MON[om-1]} + forecast to Dec. FY{TARGET_YEAR} growth % = FY{TARGET_YEAR} forecast / FY{oy} LE - 1.',
              '7. Low/High = empirical P10/P90 of the selected model\'s own out-of-sample errors (needs >=12 origins), widened by sqrt(horizon ratio) -- an explicit assumption.',
              '8. Confidence (PROPOSED thresholds, pending approval): Higher = Established, >=15 origins, WAPE<=6%, |bias|<=3%, model spread<=6 pts, no high flags;',
              '   Moderate = >=6 origins, WAPE<=12%, |bias|<=6%; otherwise Lower. Launch is always Lower.',
              '9. Outliers are flagged, never removed; "Outlier sensitivity" shows the FY change if flagged months were replaced by the local median.',
              '10. No market drivers or future events are assumed beyond the history.']
    for t_ in readme: ws0.append([t_])
    ws0.column_dimensions['A'].width = 150; ws0['A1'].font = Font(bold=True, size=13)
    srows = []
    for r in results:
        fc = r['forecast'] or {}; sc = fc.get('scenarios') or {}; mt = r['backtest']['metrics'].get(r['selected_model'] or '', {})
        srows.append([r['type'], r['name'], r['lifecycle'], r['confidence'], r['selected_model'],
                      r['history'][str(FULL_YEARS[-1])]['su'], fc.get('fy_le'), fc.get('fy_target'),
                      (fc.get('growth_vs_le_pct') or 0) / 100 if fc.get('growth_vs_le_pct') is not None else None,
                      sc.get('low'), sc.get('high'),
                      (sc.get('low_growth_pct') / 100) if sc.get('low_growth_pct') is not None else None,
                      (sc.get('high_growth_pct') / 100) if sc.get('high_growth_pct') is not None else None,
                      (r['hist_cagr']['pct'] / 100) if r['hist_cagr']['pct'] is not None else None, r['hist_cagr']['span'],
                      (r['recent_cagr']['pct'] / 100) if r['recent_cagr']['pct'] is not None else None,
                      (r['ytd']['growth_pct'] / 100) if r['ytd']['growth_pct'] is not None else None,
                      r['backtest']['n_common'], mt.get('wape'), mt.get('bias'), r['model_spread_pts'],
                      (r.get('outlier_sensitivity') or {}).get('delta_pct'),
                      '; '.join(f"[{f['sev']}] {f['code']}" for f in r['data_quality_flags']),
                      r['selection_rationale'], ' '.join(r['why']['facts']), ' '.join(r['why']['assumptions']),
                      r['forecast_type'], ', '.join(r['same_as'])])
    sheet('Summary', ['Type', 'Segment', 'Lifecycle', 'Confidence', 'Selected', f'FY{FULL_YEARS[-1]} actual SU', f'FY{oy} LE SU',
                      f'FY{TARGET_YEAR} forecast SU', f'FY{TARGET_YEAR} growth vs LE', 'Low SU', 'High SU', 'Low growth', 'High growth',
                      'Hist CAGR', 'Hist span', 'Recent 2y CAGR', f'YTD growth', 'Backtest origins', 'Sel WAPE', 'Sel bias',
                      'Model spread (pts)', 'Outlier sensitivity %', 'Data flags', 'Selection rationale', 'Why this forecast (facts)', 'Assumptions',
                      'Forecast type', 'Same market as'],
          srows, [8, 34, 12, 11, 9, 15, 15, 15, 11, 14, 14, 10, 10, 10, 10, 10, 10, 9, 9, 9, 9, 10, 30, 60, 80, 60],
          {'F': '#,##0', 'G': '#,##0', 'H': '#,##0', 'I': '0.0%', 'J': '#,##0', 'K': '#,##0', 'L': '0.0%', 'M': '0.0%',
           'N': '0.0%', 'P': '0.0%', 'Q': '0.0%', 'S': '0.0%', 'T': '0.0%'})
    crow = []
    for r in results:
        for k, c in r['candidates'].items():
            mt = r['backtest']['metrics'].get(k, {})
            crow.append([r['type'], r['name'], k, c['label'], c['fy_le'], c['fy_target'],
                         (c['growth_vs_le_pct'] / 100) if c['growth_vs_le_pct'] is not None else None,
                         mt.get('n'), mt.get('wape'), mt.get('bias'), mt.get('rel_to_naive'), 'SELECTED' if k == r['selected_model'] else ''])
    sheet('Candidates', ['Type', 'Segment', 'Model', 'Description', f'FY{oy} LE', f'FY{TARGET_YEAR} SU', 'Growth vs LE', 'BT n', 'WAPE', 'Bias', 'WAPE / naive', 'Selected'],
          crow, [8, 34, 9, 55, 15, 15, 11, 7, 9, 9, 11, 10], {'E': '#,##0', 'F': '#,##0', 'G': '0.0%', 'I': '0.0%', 'J': '0.0%', 'K': '0.00'})
    sheet('Backtest_Metrics', ['Type', 'Segment', 'Model', 'Description', 'n', 'MAE (SU)', 'WAPE', 'Bias', 'WAPE / naive'], metric_rows,
          [8, 34, 9, 55, 6, 15, 9, 9, 11], {'F': '#,##0', 'G': '0.0%', 'H': '0.0%', 'I': '0.00'})
    sheet('Backtest_Detail', ['Type', 'Segment', 'Model', 'Origin', 'Target window', 'Forecast SU', 'Actual SU', 'Error SU', 'Error %'], bt_rows,
          [8, 34, 9, 9, 18, 15, 15, 15, 9], {'F': '#,##0', 'G': '#,##0', 'H': '#,##0', 'I': '0.0%'})
    sheet('History_Annual', ['Type', 'Segment'] + [f'{y_}{"" if y_ in FULL_YEARS else " (Jan-" + MON[om-1] + ")"}' for y_ in YEARS] + [f'YTD {oy-1} (Jan-{MON[om-1]})'],
          [[r['type'], r['name']] + [r['history'][str(y_)]['su'] for y_ in YEARS] + [r['ytd']['py']] for r in results],
          [8, 34] + [14] * (len(YEARS) + 1), {c: '#,##0' for c in 'CDEFGHI'})
    sheet('Monthly_SU', ['Type', 'Segment'] + P, [[r['type'], r['name']] + r['monthly_su'] for r in results], [8, 34])
    dq = []
    for r in results:
        for f in r['data_quality_flags']: dq.append([r['type'], r['name'], f['sev'], f['code'], f['text']])
        for o_ in r['outliers']: dq.append([r['type'], r['name'], 'detail', 'OUTLIER_MONTH', f"{o_['period']} {o_['type']}: {o_['su']:,.0f} SU vs local median {o_['local_median']:,.0f} (x{o_['ratio']})"])
    sheet('Data_Quality', ['Type', 'Segment', 'Severity', 'Code', 'Detail'], dq, [8, 34, 9, 15, 120])
    g = [[k, json.dumps(v) if isinstance(v, (dict, list)) else v] for k, v in glob.items()]
    sheet('Global_Checks', ['Check', 'Result'], g, [32, 150])
    wb.save(os.path.join(ARGS.out, f'Market_Forecast_Backtest_FY{TARGET_YEAR}.xlsx'))

print(f'OK: {len(results)} segments, origin {P[O]}, target FY{TARGET_YEAR}, horizon {H} -> {ARGS.out}')
