"""
etl/build_sprint_cache.py
==========================
Builds cache/sprint.data.js -- the Zeta Sprint 2026 monthly competition
standings (Medical Rep, CHC Sales Rep, DM/DSM, ASM/NSM tiers).

Mirrors the other etl/build_*_cache.py scripts: reads source workbooks +
the existing Coverage/Sales caches, computes a self-contained JSON payload,
gzip+base64 encodes it, and writes it as `window.SPRINT_CACHE = {b64Data:"..."}`
so js/sprint.js can load it exactly like every other page's cache.

METHODOLOGY (confirmed with Ahmed, 2026-08-15):
  - Ranking is PER MONTH, not a rolling "as of today" snapshot. This build
    produces the June 2026 ranking; re-run monthly as new periods close.
  - Probation: hire day 1-15 -> reference = 1st of same month; day 16-31
    -> reference = 1st of next month; probation passes 3 months later.
    A rep is eligible for month M's ranking only if their probation-passed
    date is on/before the 1st of M. Verified against the Coverage cache's
    own period-level "Non-Probation" flag: zero disagreements (837
    employees x 5 periods).
  - Active/not-resigned: sourced from Database Shortcut.xlsx (the HR
    database) by employee Code -- never by name. Uses Last Day of Work as
    the ground truth for period membership (Status alone lags real
    resignations by weeks in ~36 cases company-wide); Status is only a
    fallback when no Last Day is on file.
  - Curve sheet: "medical rep points scheme" / "SALES REP" in
    scaling scores.xlsx -- confirmed final (only sheet whose point caps
    sum to the deck's stated 100).
  - CHC/Sales Rep Coverage: sheet's Coverage curve tops out at 10 pts;
    scaled x4 to hit the deck's stated 40pt weight -- confirmed approach
    pending workbook-author verification.
  - DM/DSM: Team Avg component (70 of 100), computed as the mean June
    totalPts of eligible reps directly under each DM/DSM, using the SAME
    hierarchy fields already in the Coverage cache.
  - ASM/NSM: Team Avg component (80 of 100) -- per Ahmed 2026-08-15
    ("ASM and NSM average points for their DSM"), computed as the mean
    totalPts of the DM/DSMs reporting up to that ASM/NSM (NOT individual
    reps directly), matching the real org chain Rep -> DM/DSM -> ASM/NSM.
    Each DM/DSM's ASM/NSM is derived by majority vote over their own
    reps' direct ASM/NSM field in the Coverage cache.
  - Field Working Days / DV Coverage / Calls-per-DV are NOT computable
    from any existing source -- Ahmed provides a sheet (see
    TEMPLATE_SHEETS). Those KPI slots are emitted as null
    (pendingDataFeed=true), never silently scored as zero.
  - Brand Manager: NOT built yet -- Ahmed will provide data later.
  - WINNER FLOOR, extended to DM/DSM/ASM/NSM 2026-08-16 (see js/sprint.js
    module doc for the full rule and UI): every manager tier now carries
    teamSalesVal/teamSalesTgt/teamSalesAchPct, computed as SUM(each
    eligible rep's raw sales value)/SUM(their raw sales target) across
    the WHOLE reporting subtree beneath that manager, divided exactly
    ONCE at output -- never an average of already-divided percentages at
    any tier. DM/DSM sums its own reps directly; ASM/NSM sums its DM/DSMs'
    already-team-summed val/tgt (propagated via the ASM/NSM pool build),
    so the ratio always traces back to raw rep-level sales no matter how
    many hierarchy levels up. js/sprint.js gates the 🏆 WINNER/🥈
    RUNNER-UP and (DM/DSM only) 🎖 BU Leader badges plus the cash payout
    on teamSalesAchPct >= 70%, cascading to the next eligible manager in
    rank order exactly like the rep-level floor -- never re-sorting the
    honest ranking itself. If nobody in a scope (Line for reps, BU for
    DM/DSM, company-wide for ASM/NSM) clears 70%, that scope has no
    winner and no payout that month.
"""
import re
import os
import sys
import base64
import gzip
import json
import time
import datetime
from collections import defaultdict, Counter

import openpyxl

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT_DIR, 'cache')

# Sick Leave Impact Rule -- THE shared definition, never a local copy.
# See leave_rules.py's header. Zeta Sprint deliberately re-derives NOTHING:
# every band, day count and proration outcome it displays is read straight
# out of what refresh.py already computed (dashboard.json's leaveImpact
# block). Only the leave TYPE and the date span -- which the band math
# discards on purpose -- are read from the report itself, through the same
# shared module. A second engine computing "the same" bands here is exactly
# how the two would quietly drift apart.
sys.path.insert(0, ROOT_DIR)
import leave_rules  # noqa: E402

LEAVE_REPORT_PATH = os.path.join(ROOT_DIR, leave_rules.LEAVE_REPORT_FILENAME)
DB_PATH = os.path.join(ROOT_DIR, 'Database Shortcut.xlsx')
SCALING_PATH = os.path.join(ROOT_DIR, 'zeta sprint', 'scaling scores.xlsx')
TEMPLATE_PATH = os.path.join(ROOT_DIR, 'zeta sprint', 'Sprint_Missing_KPI_Template.xlsx')
# Coaching Intelligence (2026-09-01, Ahmed: "from Coaching Intelligence make
# it source for zeta sprint june") -- see load_coaching_dv_coverage() below.
COACHING_CACHE_PATH = os.path.join(CACHE_DIR, 'coaching.json')
# Calls per DV target, ADDED 2026-09-10 (Ahmed: "work zeta sprint from field
# working days and coaching intel for dm dsm and nsm and asm"). Coaching
# Intelligence's own avgVisitsPerDay target is a flat 7/day for everyone;
# Sprint's own Calls-per-DV KPI has always scored against a different target
# per Ahmed 2026-08-16 (and js/sprint.js's own KPI_METHODOLOGY.callsPerDv
# text) -- 8/day generally, 12/day specifically for a DM/DSM whose team is
# majority CHC_SALES. Used to rescale Coaching's raw visits/day into the "%
# of target" fraction this KPI's curve expects, exactly like Ahmed's own
# manual-template column asks him to pre-compute by hand.
# Changed 2026-09-17 (Ahmed: "CALLS_PER_DV_TARGET_DEFAULT = 8.0 if we make it
# as 7 any changes will happen in winners") -- lowered the DEFAULT
# (non-CHC_SALES) Calls-per-DV target from 8/day to 7/day. Simulated first:
# 60 of 92 DM/DSMs gain Calls-per-DV points, but no Winner/Runner-up identity
# changed for July across CHC/Cluster/DIAB/GIT. CHC_SALES target (12.0) below
# is untouched, and any manual-template-entered Calls-per-DV values are NOT
# auto-retargeted by this constant -- only source=='coaching' records are.
CALLS_PER_DV_TARGET_DEFAULT = 7.0
CALLS_PER_DV_TARGET_CHC_SALES = 12.0
# Field Working Days Intelligence's own cache (2026-09-11, Ahmed: "i need
# field working days to be like [DV Coverage/Calls per DV, i.e. clickable
# with a detail popup] and also for asm and nsm source is field working
# days page") -- see load_working_days_data() below.
WORKING_DAYS_CACHE_PATH = os.path.join(CACHE_DIR, 'working_days.json')
OUT_JS = os.path.join(CACHE_DIR, 'sprint.data.js')
OUT_JSON = os.path.join(CACHE_DIR, 'sprint.json')
HISTORY_DIR = os.path.join(CACHE_DIR, 'sprint_history')
HISTORY_INDEX_JS = os.path.join(HISTORY_DIR, 'index.js')

SCHEMA_VERSION = 14  # 14 (2026-09-16): every tier's record gains leaveDetail
                      # wherever the Sick Leave report has a row in the eval
                      # month -- band, sick days, active ratio, Right
                      # Frequency before -> after, plus each leave row's TYPE
                      # and date span. meta.leaveRule carries the thresholds
                      # and this period's counts. Read verbatim from
                      # dashboard.json's leaveImpact block (refresh.py's own
                      # output) + leave_rules.load_leave_rows(); NOTHING is
                      # recomputed and no score, rank, badge or payout moves.
                      # Ahmed 2026-09-16: "in zeta sprint any case is prorated
                      # flag it as prorated and if zero in kpi coverage and
                      # right frequency due to leave flag leave type and popup
                      # duration".
                      # 13 (2026-09-11): fieldDays KPI (DM/DSM, ASM, AND NSM)
                      # gains a workingDaysDetail record + source='workingdays'
                      # wherever cache/working_days.json has a matching
                      # code+month -- makes the Field Working Days KPI cell
                      # clickable with a breakdown popup (Calendar Days, each
                      # deduction, Target Working Days, All Visit Days, hire/
                      # last-day/left-company), mirroring the existing DV
                      # Coverage/Calls per DV popup. Does NOT change any
                      # scored raw/pts value -- both this script and
                      # etl/build_working_days_cache.py read the identical
                      # xlsx column for the identical code+month, so this is
                      # purely additive detail + a UI hook. Ahmed 2026-09-11:
                      # "i need field working days to be like [DV Coverage/
                      # Calls per DV] and also for asm and nsm source is
                      # field working days page".
                      # 12 (2026-09-10): DM/DSM Calls per DV now sourced from
                      # Coaching Intelligence (avgVisitsPerDay) wherever it has
                      # a match for the eval month, rescored against Sprint's
                      # own target (8/day, 12/day for a majority-CHC_SALES
                      # DM/DSM) instead of Coaching's flat 7/day -- falls back
                      # to the manual template exactly like DV Coverage
                      # already does. Ahmed 2026-09-10: "work zeta sprint from
                      # field working days and coaching intel for dm dsm and
                      # nsm and asm".
                      # 11 (2026-09-01): coachingDetail gains repBreakdown (per-
                      # coached-rep visits/coachingDays/avgVisitsPerDay + a
                      # Best Practice flag) and dvCoverageRank/callsPerDvRank
                      # (this manager's position among all DM/DSM coaching-
                      # matched peers on that KPI) -- Ahmed 2026-09-01: "show
                      # coched rep how many days visits per each day make the
                      # best practice and show position if this rep".
                      # 10 (2026-09-01): DM/DSM DV Coverage now sourced from
                     # Coaching Intelligence (cache/coaching.json) instead of
                     # the manual KPI template, wherever it has a match --
                     # see load_coaching_dv_coverage().

# ---------------------------------------------------------------------
# KPI slots not computable from any existing cache -- Ahmed fills these
# into TEMPLATE_PATH (auto-generated the first time this script runs
# with no existing template; never overwritten after that, so his fills
# survive every future re-run).
#
# As of 2026-08-15: each column asks for the REAL ACHIEVEMENT metric
# (a raw fraction, e.g. 0.85 for 85%; Region Coverage asks for a raw
# count 1-5), NOT pre-scaled points -- per Ahmed's instruction "excel
# template according to real achievement in kpi not points". This is
# possible because the actual scoring curves for these KPIs were found
# in scaling scores.xlsx's 'dsm points scheme', 'ASM&NSM SCHEME', and
# 'Brand Managers' sheets (previously overlooked -- only the two
# Medical Rep / CHC Sales Rep sheets had been read). build_sprint_cache.py
# now converts Ahmed's raw achievement number into points itself via
# those curves (see Step 3/6/7), the same way it already does for
# Sales Achievement / Right Frequency / Coverage.
#
# DM/DSM confirmed by Ahmed 2026-08-15 ("dm dsm is right for these
# parameters as in scaling and in ppt") back to its original 3-KPI
# structure: Team Avg (70) + Field Working Days (10) + DV Coverage (10)
# + Calls per DV (10). ASM/NSM stay at Team Avg (80) + Field Days (20)
# -- that was never in question, the ASM&NSM SCHEME sheet confirms it.
# ---------------------------------------------------------------------
TEMPLATE_SHEETS = {
    'DM_DSM': [
        ('fieldDays', 'Field Working Days -- Actual % Achieved (e.g. 0.85 for 85%)', 10),
        ('dvCoverage', 'DV Coverage -- Actual % Achieved (e.g. 0.90 for 90%)', 10),
        ('callsPerDv', 'Calls per DV -- Actual % of Target (e.g. 0.95 for 95%)', 10),
    ],
    'ASM': [
        ('fieldDays', 'Field Working Days -- Actual % Achieved (e.g. 0.85 for 85%)', 20),
    ],
    'NSM': [
        ('fieldDays', 'Field Working Days -- Actual % Achieved (e.g. 0.85 for 85%)', 20),
    ],
    # National Sales is no longer in this sheet -- it's auto-calculated
    # from the Sales cache per the Brand Manager's assigned Line (see
    # Step 7), per Ahmed 2026-08-15 ("calculate bm achievement according
    # to brands they are responsible for").
    'Brand_Manager': [
        ('regionCount', 'Regions Covered -- Actual Count (1-5)', 20),
        ('tacticalPlan', 'Tactical Plan Execution -- Actual % Achieved (e.g. 0.90 for 90%)', 30),
    ],
}

# The month being ranked. Bump these three lines each time this script is
# re-run for a newly-closed period -- everything else derives from them.
EVAL_PERIOD_NAME = 'July'        # must match a label in dims['periods']
EVAL_MONTH_STR = '2026-07'       # must match a label in sales lookups['months']
EVAL_PERIOD_START = datetime.date(2026, 7, 1)
EVAL_PERIOD_END = datetime.date(2026, 7, 31)


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}')


def load_b64(fname):
    raw = open(os.path.join(CACHE_DIR, fname), encoding='utf-8').read()
    m = re.search(r'b64Data\s*:\s*"([^"]+)"', raw)
    return json.loads(gzip.decompress(base64.b64decode(m.group(1))))


def as_date(v):
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date) and not isinstance(v, datetime.time):
        return v
    return None


# Known Sales-cache spelling typos that break the exact-string name join
# below (reps_coverage / rep_sales_month / name_to_salesposition are all
# keyed by norm_name() -- a single wrong character means "no match", which
# silently reads as salesVal=0/salesTgt=0/achPct=None, i.e. a real rep with
# real sales looking like he has zero data). Confirmed 2026-08-19 (Ahmed
# flagged Adel AbdelAzim ElSayed AbdelAziz Asfour, code 1262, CVM-I -- Sales
# Performance tab shows him at 127% YTD achievement, but the Sprint
# leaderboard showed achPct=None): Database Shortcut / Coverage source
# spells him "...AbdelAziz Asfour", the Sales cache's own rep-name column
# spells him "...AbelAziz Asfour" (missing the "d"). This map corrects
# KNOWN Sales-cache misspellings to the Coverage-source spelling BEFORE the
# join, name by name, on purpose -- deliberately not a fuzzy/edit-distance
# matcher, which risks silently merging two different people with similar
# names. Add further confirmed cases here (uppercase, exactly as norm_name
# would produce) if the same class of bug turns up elsewhere; each entry
# should first be verified the same way this one was (grep the Sales cache
# for the rep's surname, compare byte-for-byte against Database Shortcut).
SALES_NAME_ALIASES = {
    "ADEL ABDELAZIM ELSAYED ABELAZIZ ASFOUR": "ADEL ABDELAZIM ELSAYED ABDELAZIZ ASFOUR",
}


def norm_name(s):
    n = str(s).upper().replace(chr(160), ' ').strip()
    return SALES_NAME_ALIASES.get(n, n)


def probation_passed_date(hire_date):
    if hire_date is None:
        return None
    if hire_date.day <= 15:
        ref_y, ref_m = hire_date.year, hire_date.month
    else:
        ref_y, ref_m = hire_date.year, hire_date.month + 1
        if ref_m == 13:
            ref_y += 1
            ref_m = 1
    py, pm = ref_y, ref_m + 3
    while pm > 12:
        pm -= 12
        py += 1
    return datetime.date(py, pm, 1)


CANONICAL_LINE_TO_BU = {
    "CHC": "CHC", "CHC_SALES": "CHC",
    "PEDIA": "Cluster", "ORTHO-I": "Cluster", "ORTHO-II": "Cluster", "CVM-I": "Cluster", "CVM-II": "Cluster",
    "DIAB-I": "DIAB", "DIAB-II": "DIAB", "DIAB-III": "DIAB", "DIAB-IV": "DIAB",
    "Derma": "GIT", "CNS": "GIT", "GIT-I": "GIT", "GIT-II": "GIT", "GIT-III": "GIT",
}
LINE_SYNONYMS = {
    "NEUROSCIENCE": "CNS", "DERMA": "Derma", "CHC_SALES": "CHC_SALES",
    "GIT I": "GIT-I", "GIT II": "GIT-II", "GIT III": "GIT-III",
    "ORTHO I": "ORTHO-I", "ORTHO II": "ORTHO-II",
    "CVM I": "CVM-I", "CVM II": "CVM-II",
}


def normalize_line(raw):
    if raw is None:
        return None
    s = str(raw).strip()
    su = s.upper()
    if su in LINE_SYNONYMS:
        return LINE_SYNONYMS[su]
    for c in CANONICAL_LINE_TO_BU:
        if c.upper() == su:
            return c
    return s


def line_to_bu(raw):
    return CANONICAL_LINE_TO_BU.get(normalize_line(raw))


def extract_curve(ws, col_pct, col_pts, start_row=2):
    pts = []
    for row in ws.iter_rows(min_row=start_row, max_row=ws.max_row, min_col=col_pct, max_col=col_pts):
        pct, val = row[0].value, row[-1].value
        if pct is None or val is None:
            continue
        pts.append((float(pct), float(val)))
    pts.sort()
    return pts


def interp(curve, x):
    if not curve:
        return None
    if x <= curve[0][0]:
        return 0.0
    if x >= curve[-1][0]:
        return curve[-1][1]
    for i in range(1, len(curve)):
        x0, y0 = curve[i - 1]
        x1, y1 = curve[i]
        if x0 <= x <= x1:
            if x1 == x0:
                return y0
            frac = (x - x0) / (x1 - x0)
            return y0 + frac * (y1 - y0)
    return curve[-1][1]


def _rescaled_power_curve(x0_pct, span_pct, lo=1.0, hi=10.0, exp=1.1, x_max_pct=100):
    """Ahmed's rule (2026-08-27): DM/DSM Double Visit Coverage and Avg Calls
    per DV Day starting thresholds lowered (80%->75%, 90%->70%). The
    original 'dsm points scheme' table values are exactly reproduced by
    y = lo + (hi-lo) * ((x-x0)/span)^exp (fit confirmed to ~1e-6 against the
    real table). That formula is undefined (negative base, non-integer
    exponent) below its own anchor (x0), so a straight downward extension
    of the ORIGINAL x0/span is mathematically impossible for either KPI at
    the new thresholds. Per Ahmed's explicit choice (2026-08-26/27,
    confirmed for this live cache too via follow-up question): reuse the
    identical formula/exponent, rescaled over the new wider domain -- same
    treatment already applied to the standalone calculator
    ("Zeta Sprint Points Calculator - FINAL.html"). This deliberately
    shifts the existing 80-100%/90-100% point values slightly (a longer
    span raises the fraction-of-progress at any given %) -- an informed,
    explicit tradeoff, not an oversight. Returns (fraction, points) pairs
    at 1%-point granularity, same shape `extract_curve()` returns, so
    `interp()` itself is completely unchanged -- only the curve DATA is
    replaced for these two KPIs.

    Boundary fix (Ahmed 2026-08-27): interp()'s untouched `x <= curve[0][0]`
    check means landing EXACTLY on the round-number threshold (raw
    achievement typed as literally 0.75/0.70 in Ahmed's KPI template) fell
    into the "at or below the curve" branch and scored 0, not the intended
    starting value -- the SAME pre-existing edge case that already zeroed
    anyone landing exactly on the OLD anchor (80.0%/90.0%) too, just newly
    visible now that real people (5 DM/DSMs this month) sit exactly at the
    new 75.0% DVC threshold. Fixed by nudging only this curve's own
    leftmost x-coordinate a hair (1e-9) below the literal threshold, so an
    exact hit falls into interp()'s normal interpolation branch instead of
    its zero branch. interp() itself, and every other KPI's curve
    (Field Working Days, ASM/NSM, Brand Manager, Medical Rep, CHC), are
    completely untouched -- this only changes how these two curves
    represent their own first data point.
    """
    curve = []
    for pct in range(x0_pct, x_max_pct + 1):
        frac = (pct - x0_pct) / span_pct
        y = lo + (hi - lo) * (frac ** exp)
        x = pct / 100.0
        if pct == x0_pct:
            x -= 1e-9
        curve.append((x, round(y, 6)))
    return curve


def build_leave_detail(dash, period_name):
    """Per-employee Sick Leave Impact detail for ONE period, keyed by code.

    Ahmed, 2026-09-16: "in zeta sprint any case is prorated flag it as
    prorated and if zero in kpi coverage and right frequency due to leave
    flag leave type and popup duration."

    Two sources, each used for exactly what it is authoritative for:

      1. dashboard.json's leaveImpact[period].reps -- refresh.py's OWN
         output. Band, sick-day count, active ratio, and the before/after
         Right Frequency pair are taken verbatim from here. Sprint never
         recomputes them. (It could not do so honestly anyway: the source
         workbook's Right Freq column is not a pure visits>=frequency test
         -- 812 of July's 64,491 Normal-band rows disagree with that
         recomputation in both directions -- so any "what would it have
         been without proration" number Sprint derived for itself would be
         wrong for ~1.3% of rows and unfalsifiable. rightFreqBefore is the
         real pre-proration snapshot, taken inside refresh.py before it
         touched anything.)

      2. leave_rules.load_leave_rows() -- the report's own rows, for the
         leave TYPE and the date span, which (1) discards by design.

    Emits `affectsScore` per rep: whether the leave actually moved that
    rep's SPRINT points, which is narrower than "was prorated" and must not
    be conflated with it:
      - Medical Rep, Moderate  -> yes. Right Frequency is 40 of their 100
        points and its target was prorated.
      - CHC Sales Rep, Moderate -> NO. CHC scores Sales (60) + Coverage
        (40) only; Right Frequency plays no part in CHC at all (removed
        2026-08-19), and Coverage reach is never prorated. Badging a CHC
        rep "Prorated" would claim a scoring effect that did not happen.
      - DM/DSM/ASM/NSM, Moderate -> NO. Their Sprint score is Team Avg +
        their own manager KPIs; their personal coverage rows are not
        scored here at all, even though refresh.py did prorate them for
        the Coverage dashboard.
      - Any tier, Excluded (>15 sick days or Maternity) -> yes. Their
        Coverage/RF collapse toward zero because they were not in
        territory, and Sprint still scores those raw values.
    """
    out = {}
    block = ((dash.get('leaveImpact') or {}).get('periods') or {}).get(period_name) or {}
    raw_rows = leave_rules.load_leave_rows(LEAVE_REPORT_PATH)

    # Every code touched by EITHER source -- a rep can have an Annual-only
    # row (no leaveImpact entry, since Annual drives no band) and still
    # deserve the absence shown when a manager asks why a number is low.
    codes = {str(r.get('employeeCode') or '') for r in (block.get('reps') or [])}
    for code, rows in raw_rows.items():
        if leave_rules.rows_in_month(rows, period_name):
            codes.add(code)
    codes.discard('')

    impact_by_code = {str(r.get('employeeCode') or ''): r for r in (block.get('reps') or [])}

    for code in codes:
        imp = impact_by_code.get(code) or {}
        month_rows = leave_rules.rows_in_month(raw_rows.get(code, []), period_name)
        # Ordered longest-first: the row that explains the band leads.
        month_rows.sort(key=lambda r: (-(r.get('monthDays') or 0), r.get('dateFrom') or ''))
        # Band source, in order of authority:
        #   1. refresh.py's own leaveImpact entry -- verbatim, always wins.
        #   2. No entry at all (rep has leave on file but no Coverage rows
        #      this month -- e.g. on probation, or absent the whole month
        #      so nothing was planned). refresh.py never saw them, so there
        #      is nothing to copy; fall back to the SHARED leave_band()
        #      with the same day count, which is the same function refresh.py
        #      itself ran. Without this, a rep on maternity leave for the
        #      entire month reads "band: Normal" next to "type: Maternity"
        #      -- self-contradictory on screen, and wrong.
        month_sick = sum((r.get('monthDays') or 0) for r in month_rows if r.get('countsTowardBand'))
        month_maternity = any(r.get('isMaternity') for r in month_rows)
        if imp:
            band = imp.get('band') or leave_rules.BAND_NORMAL
            band_source = 'coverage-etl'
        else:
            band = leave_rules.leave_band(month_sick, month_maternity)
            band_source = 'leave-report'
        types = []
        for r in month_rows:
            t = (r.get('type') or 'Leave').strip().title()
            if t not in types:
                types.append(t)
        rf_before = imp.get('rightFreqBefore')
        rf_after = imp.get('rightFreqAfter')
        out[code] = {
            'band': band,
            'bandSource': band_source,
            'reason': imp.get('reason') or ('Maternity Leave' if month_maternity else ''),
            # Band-driving (Sick) days this month. refresh.py's number where
            # it has one; otherwise the same sum off the report's own rows.
            'leaveDays': imp.get('leaveDays') if imp else round(month_sick, 1),
            'activeRatio': imp.get('activeRatio') if imp else round(leave_rules.active_ratio(month_sick), 3),
            'rightFreqBefore': rf_before,
            'rightFreqAfter': rf_after,
            'rightFreqUpliftPp': (round((rf_after - rf_before) * 1000) / 10.0
                                   if (rf_before is not None and rf_after is not None) else None),
            'coveragePct': imp.get('coveragePct'),
            'customerCount': imp.get('customerCount'),
            'tierAAccounts': imp.get('tierAAccounts'),
            'tierAUncovered': imp.get('tierAUncovered'),
            'typesLabel': ' + '.join(types) if types else '',
            'totalMonthDays': round(sum((r.get('monthDays') or 0) for r in month_rows), 1),
            'rows': month_rows,
            'isProrated': band == leave_rules.BAND_MODERATE,
            'isExcludedBand': band == leave_rules.BAND_EXCLUDED,
        }
    return out


def attach_leave_detail(rec_lists, leave_detail, scored_kpi_tiers):
    """Hang build_leave_detail()'s per-code entry on every record that has
    one, setting `affectsScore` per that record's own role (see
    build_leave_detail's docstring for why this is narrower than band).
    Returns the records it touched."""
    touched = []
    for rec_list in rec_lists:
        for rec in rec_list:
            d = leave_detail.get(str(rec.get('code') or ''))
            if not d:
                continue
            role = rec.get('role') or ''
            rf_is_scored = role in scored_kpi_tiers
            detail = dict(d)
            detail['affectsScore'] = bool(
                d['isExcludedBand'] or (d['isProrated'] and rf_is_scored)
            )
            # "Prorated" is a claim about THIS rep's Sprint points, not about
            # what refresh.py did to the Coverage dashboard -- see above.
            detail['showAsProrated'] = bool(d['isProrated'] and rf_is_scored)
            rec['leaveDetail'] = detail
            touched.append(rec)
    return touched


def main():
    t0 = time.time()

    if not os.path.exists(DB_PATH):
        print(f'ERROR: source not found: {DB_PATH}')
        return
    if not os.path.exists(SCALING_PATH):
        print(f'ERROR: source not found: {SCALING_PATH}')
        return

    # -----------------------------------------------------------------
    # 0. Database Shortcut.xlsx -- authoritative hire/status/resignation
    #    source, keyed by Code. Also build a Name->Code lookup for the
    #    hierarchy roles (DM/ASM/NSM), which have no Code in the Coverage
    #    cache's own dimension lists.
    # -----------------------------------------------------------------
    log('reading Database Shortcut.xlsx ...')
    wb_db = openpyxl.load_workbook(DB_PATH, data_only=True, read_only=True)
    ws_db = wb_db['Sheet1']
    code_to_hire, code_to_status, code_to_lastday, code_to_resignnotif = {}, {}, {}, {}
    code_to_position = {}
    name_to_code = {}
    # Business Email (col 24) -- lets the frontend match a logged-in
    # dashboard user (AUTH session email, from Zeta_Dashboard_User_Config.xlsx)
    # back to their own Sprint record by code, to power a personal "My
    # Performance" card -- per Ahmed 2026-08-15 ("make better page besde
    # zeta sprint"). Confirmed exact-match against the Users sheet for
    # every Sprint-participating manager checked (e.g. code 183 == NSM
    # winner Mahmoud Mokhtar's login email).
    code_to_email = {}
    # Direct/2nd/3rd Manager columns + this file's own Business Unit column
    # (cols 9, 12-17) -- covers EVERY employee code, including ASM/NSM,
    # unlike the sprint cache's teamMembers-based rollups below (those only
    # reach DM/DSM-and-below, hence ASM/NSM never had a Direct Manager
    # before) -- per Ahmed 2026-08-15 ("asm and nsm name of manager and bu
    # not present"). Used in step 7b to attach directManager/directManagerBu
    # to every scored person.
    code_to_orgchart = {}
    bm_roster = []  # (code, name, position, line) -- Brand Manager family, roster sourced by
                     # Position text since Brand Managers own products, not a rep hierarchy.
                     # `line` (Database Shortcut col 10) is the brand/line they're responsible
                     # for -- used to auto-calculate their National Sales Achievement from the
                     # Sales cache, per Ahmed 2026-08-15 ("calculate bm achievement according
                     # to brands they are responsible for").
    for r in ws_db.iter_rows(min_row=2, values_only=True):
        code, name, hire, position, status, resign_notif, last_day = r[0], r[1], r[2], r[3], r[18], r[19], r[20]
        line = r[10]
        if code is None:
            continue
        key = str(int(code)) if isinstance(code, (int, float)) else str(code).strip()
        if isinstance(hire, datetime.datetime):
            code_to_hire[key] = hire.date()
        code_to_status[key] = status
        code_to_lastday[key] = as_date(last_day)
        code_to_resignnotif[key] = as_date(resign_notif)
        if position:
            code_to_position[key] = str(position).strip()
        if r[24]:
            code_to_email[key] = str(r[24]).strip().lower()
        if name:
            name_to_code[norm_name(name)] = key
        if position and 'brand manager' in str(position).lower():
            bm_roster.append((key, name, str(position).strip(), str(line).strip() if line else None))
        code_to_orgchart[key] = dict(
            bu=str(r[9]).strip() if r[9] else None,
            mgr1_code=r[12], mgr1_name=r[13],
            mgr2_code=r[14], mgr2_name=r[15],
            mgr3_code=r[16], mgr3_name=r[17],
        )
    code_to_probation_passed = {c: probation_passed_date(h) for c, h in code_to_hire.items()}

    def _usable_mgr_name(name):
        if not name:
            return False
        return 'vacant' not in str(name).lower()

    def resolve_direct_manager(code):
        """Escalates Direct -> 2nd -> 3rd Manager (Database Shortcut.xlsx),
        skipping any slot on file as literally "Vacant" (an unfilled
        intermediate role) the same way the org chart itself would."""
        entry = code_to_orgchart.get(code)
        if not entry:
            return None, None
        for name_key, code_key in (('mgr1_name', 'mgr1_code'), ('mgr2_name', 'mgr2_code'), ('mgr3_name', 'mgr3_code')):
            nm = entry.get(name_key)
            if _usable_mgr_name(nm):
                mgr_code = entry.get(code_key)
                mgr_code = str(int(mgr_code)) if isinstance(mgr_code, (int, float)) else (str(mgr_code).strip() if mgr_code else None)
                return str(nm).strip(), mgr_code
        return None, None

    def is_active_for_period(code, period_end):
        last_day = code_to_lastday.get(code)
        if last_day is not None:
            if last_day <= period_end:
                return False, f"Last Day of Work {last_day.isoformat()} on/before period end"
            return True, None
        status = code_to_status.get(code)
        # 2026-09-20: a blank upstream Status (the HR VLOOKUP returns 0 =
        # Excel time 00:00) is UNKNOWN, not a resignation -- see
        # build_coaching_cache.is_blank_lookup_status(). Only reached when
        # there is no Last Day of Work (checked above). Code 556 only.
        if isinstance(status, datetime.time) or (isinstance(status, (int, float)) and not isinstance(status, bool) and status == 0):
            return True, None
        if status != 'Active':
            return False, f"DB status = {status!r} (no Last Day of Work on file)"
        return True, None

    def is_probation_passed_for_period(code, period_start):
        pp = code_to_probation_passed.get(code)
        if pp is None:
            return None, None
        return (pp <= period_start), pp

    # -----------------------------------------------------------------
    # 1. Coverage + Right Frequency per rep, restricted to EVAL_PERIOD_NAME.
    # -----------------------------------------------------------------
    log('reading Coverage cache ...')
    records = load_b64('records.data.js')
    dash = load_b64('dashboard.data.js')
    dims = dash['dimensions']

    F = dict(period=0, team=1, businessUnit=2, nsm=3, areaManager=4, manager=5,
              employee=6, specialty=7, klass=8, status=9, experience=10, type=11,
              coveredDoctor=12, rightFreq=13, visits=14, isActive=15, actualPlanX1000=16,
              plansCount=17, title=18, customerName=19, profile=20, frequency=21,
              lastVisitDate=22, area=23)

    titles = dims['titles']
    types = dims['types']
    statuses = dims['statuses']
    teams = dims['teams']
    employeeNames = dims['employeeNames']
    employeeCodes = dims['employeeCodes']

    titleIdx = titles.index('Medical Representative')
    salesRepTitleIdx = titles.index('Sales Representative')
    # CNS/Neuroscience title gap, FIXED 2026-09-10 (Ahmed, after being shown
    # [[sprint_cns_medical_rep_title_gap]]'s diagnosis: "CNS AND NEUROSCIENCE
    # ARE THE SAME LINE" -- confirming they should be treated as one line,
    # then asked to go ahead and fix the gap). 14 of 20 July CNS field staff
    # are coded 'Product Specialist' in the DVR/Coverage source instead of
    # 'Medical Representative' (HR's own Database Shortcut.xlsx Position
    # field often still says 'Medical Representative' for the same person --
    # this is a DVR-source coding quirk unique to this one line, confirmed
    # 2026-09-10: every other line is ~95-100% 'Medical Representative').
    # 'Product Specialist' does not exist as a title in every dataset, so
    # this is guarded rather than assumed present.
    productSpecialistTitleIdx = titles.index('Product Specialist') if 'Product Specialist' in titles else None
    statusIdx = statuses.index('Active')
    standardTypeIdx = {types.index(t) for t in ['Contract', 'Doctor', 'Hospital'] if t in types}
    pharmacyTypeIdx = {types.index(t) for t in ['Pharmacy'] if t in types}

    team_checks = []
    for t in teams:
        canon = normalize_line(t)
        bu = line_to_bu(t)
        is_chc_sales = (bu == 'CHC' and canon == 'CHC_SALES')
        # titleSet (2026-09-10): CNS is the one line where 'Product
        # Specialist'-coded field staff count as Medical-Rep-equivalent for
        # Sprint purposes -- every other line keeps its single-title
        # membership test unchanged. Every other tier (CHC Sales Rep via
        # is_chc_sales, and every non-CNS Medical Rep line) still gets a
        # single-element set, so behaviour for them is byte-identical to the
        # old titleIdx-equality check.
        if is_chc_sales:
            title_set = {salesRepTitleIdx}
        elif canon == 'CNS' and productSpecialistTitleIdx is not None:
            title_set = {titleIdx, productSpecialistTitleIdx}
        else:
            title_set = {titleIdx}
        team_checks.append(dict(bu=bu, canon=canon, is_chc_sales=is_chc_sales,
                                 titleSet=title_set,
                                 typeSet=(pharmacyTypeIdx if is_chc_sales else standardTypeIdx)))

    rep_cov = defaultdict(lambda: dict(coveredSum=0, rightFreqSum=0, rowCount=0))
    emp_to_manager, emp_to_areaManager, emp_to_nsm = {}, {}, {}
    for row in records['rows']:
        empIdx = row[F['employee']]
        # FIXED 2026-09-17 (Ahmed: flagged Karim Mohamed Nagib Mohamed
        # Eldemerdash, code 188, wrongly excluded from DM/DSM and scored as
        # ASM for July, when his own July DVR row says "Senior District
        # Manager" with zero team). Root cause: these three dicts were
        # being overwritten from EVERY period's row in this loop with no
        # period guard at all -- only the code BELOW this block was
        # period-scoped. Since records.data.js now runs through August,
        # and August's rows come after July's, August's manager/Area
        # Manager/NSM assignment silently won over July's for EVERY
        # employee, not just Karim (confirmed period-by-period: his two
        # "reports" show a blank Area Manager on every July row, and only
        # pick up Karim starting August). Now scoped to EVAL_PERIOD_NAME,
        # exactly like every other per-period read in this function.
        if dims['periods'][row[F['period']]] == EVAL_PERIOD_NAME:
            emp_to_manager[empIdx] = dims['managers'][row[F['manager']]]
            emp_to_areaManager[empIdx] = dims['areaManagers'][row[F['areaManager']]]
            emp_to_nsm[empIdx] = dims['nsms'][row[F['nsm']]]

        if dims['periods'][row[F['period']]] != EVAL_PERIOD_NAME:
            continue
        if row[F['status']] != statusIdx:
            continue
        check = team_checks[row[F['team']]]
        if not check['bu']:
            continue
        if row[F['title']] not in check['titleSet']:
            continue
        if row[F['type']] not in check['typeSet']:
            continue
        if not row[F['isActive']]:
            continue
        a = rep_cov[empIdx]
        a['coveredSum'] += row[F['coveredDoctor']] or 0
        a['rightFreqSum'] += row[F['rightFreq']] or 0
        a['rowCount'] += 1
        a['team'] = teams[row[F['team']]]

    reps_coverage = {}
    for empIdx, a in rep_cov.items():
        if a['rowCount'] == 0:
            continue
        name = employeeNames[empIdx]
        code = employeeCodes[empIdx]
        reps_coverage[norm_name(name)] = dict(
            empIdx=empIdx, name=name, code=code, team=a['team'],
            coveragePct=(a['coveredSum'] / a['rowCount']) * 100,
            rightFreqPct=(a['rightFreqSum'] / a['rowCount']) * 100,
            rowCount=a['rowCount'],
        )

    # -----------------------------------------------------------------
    # 2. Sales Achievement, restricted to EVAL_MONTH_STR.
    # -----------------------------------------------------------------
    log('reading Sales cache ...')
    sales_cache = load_b64('sales.data.js')
    MONTH, LINE, BRAND, PROD, REP, MASK, VAL, TGT_VAL = 0, 1, 2, 3, 4, 17, 19, 21
    linesLk = sales_cache['lookups']['lines']
    repsLk = sales_cache['lookups']['reps']
    monthsLk = sales_cache['lookups']['months']
    # Sales cache's own per-rep "position" is a specific territory/specialty
    # label (e.g. "NEUROSCIENCE QALUBIA") -- far more useful on a leaderboard
    # than Database Shortcut's generic Position column (almost always just
    # "Medical Representative"). Falls back to code_to_position if a rep
    # has no Sales cache row this month.
    name_to_salesposition = {}
    rep_positions_lk = sales_cache['lookups'].get('rep_positions', [])
    for i, rname in enumerate(repsLk):
        if i < len(rep_positions_lk) and rep_positions_lk[i]:
            name_to_salesposition[norm_name(rname)] = rep_positions_lk[i]
    scenarioCoverage = sales_cache['meta'].get('scenarioCoverage', {})
    schemaVersion = sales_cache['meta'].get('schemaVersion', 0)

    # Target scenario resolution -- UPDATED 2026-09-07 (Ahmed: "apply to
    # shortage target"), after Ahmed asked which target Sales Achievement
    # uses and was told Official->Working, never Shortage. Shortage Target
    # is a strict refinement of Official Target by construction (see
    # refresh_sales.py's apply_shortage_scenario(): a non-flagged group's
    # Shortage Target literally EQUALS its own Official Target; only a
    # group explicitly confirmed Shortage=Y in Shortage_Conditions.xlsx
    # gets a different (lower, fairer) target = that group's own Actual
    # Sales). So preferring Shortage over Official wherever a Line has
    # Shortage coverage can only ever match or improve fairness -- it
    # never disagrees with Official on a non-flagged group. Verified
    # against the live June cache before wiring this in: GIT-II
    # (26,076,000 -> 24,903,885) and ORTHO-II (8,971,200 -> 8,341,284.1)
    # both have real, non-trivial Shortage-flagged groups this month;
    # every other Line's Shortage total is numerically identical to its
    # Official total (confirmed no other Line is silently affected).
    # CHC/CHC_SALES have no Shortage coverage at all (Working-only, same
    # as before) -- scenarioCoverage confirms shortage=False for both, so
    # they fall through to Working exactly as before this change.
    SCENARIO_PRIORITY = ('shortage', 'official', 'working')

    def resolve_target_scenario(raw):
        canon = normalize_line(raw)
        cov = scenarioCoverage.get(canon) or scenarioCoverage.get(raw)
        if not cov:
            return 'official'  # unchanged fallback for lines with no coverage info at all
        for scenario in SCENARIO_PRIORITY:
            if cov.get(scenario):
                return scenario
        return 'official'

    target_scenario_by_line = [resolve_target_scenario(l) for l in linesLk]

    def include_target_row(mask, scenario):
        if (mask & 16) == 0:
            return True
        if schemaVersion < 3:
            return True
        is_shortage = (mask & 64) > 0
        is_official = (mask & 32) > 0
        if scenario == 'shortage':
            return is_shortage
        if scenario == 'official':
            return is_official and not is_shortage
        return (not is_official) and not is_shortage  # 'working'

    rep_sales_month = defaultdict(lambda: dict(val=0, tgtVal=0))
    # National, line-level val/target totals for the eval month -- used to
    # auto-calculate each Brand Manager's National Sales Achievement from
    # the specific line/brand they're responsible for (see Step 7).
    line_sales_month = defaultdict(lambda: dict(val=0, tgtVal=0))
    # Per-rep line-row counts + original display casing -- ADDED 2026-09-12
    # for the Sales Average widening in Step 4b below (every territory,
    # including vacant, per Ahmed's confirmation). A rep who never enters
    # reps_coverage (Step 1) has no `team`/canon line from the Coverage
    # cube, so Step 4b resolves their line from the Sales cache's own line
    # field instead -- majority line by row count, for the rare case a
    # rep's rows span more than one line this month (same majority-vote
    # pattern already used for a manager's primary_line in
    # score_hierarchy_tier() below). rep_display_name preserves the Sales
    # cache's own casing (incl. literal "VACANT <territory>" placeholders)
    # for the name shown on these new records, since rep_sales_month/
    # rep_lines_seen are keyed by the upper-cased norm_name().
    rep_lines_seen = defaultdict(Counter)
    rep_display_name = {}
    for r in sales_cache['rows']:
        if (r[MASK] & 2) > 0:
            continue
        month_str = monthsLk[r[MONTH]] if r[MONTH] is not None and r[MONTH] < len(monthsLk) else None
        if month_str != EVAL_MONTH_STR:
            continue
        want_official = include_target_row(r[MASK], target_scenario_by_line[r[LINE]])
        la = line_sales_month[r[LINE]]
        la['val'] += r[VAL] or 0
        if want_official:
            la['tgtVal'] += r[TGT_VAL] or 0
        repName = repsLk[r[REP]] if r[REP] is not None and r[REP] < len(repsLk) else None
        if not repName:
            continue
        key = norm_name(repName)
        a = rep_sales_month[key]
        a['val'] += r[VAL] or 0
        if want_official:
            a['tgtVal'] += r[TGT_VAL] or 0
        rep_lines_seen[key][linesLk[r[LINE]]] += 1
        rep_display_name.setdefault(key, repName)

    def line_sales_achievement(sales_line_name):
        """National actual/target achievement fraction for a Sales-cache line
        name this month, or None if the line is unknown or has no target."""
        if sales_line_name not in linesLk:
            return None
        idx = linesLk.index(sales_line_name)
        la = line_sales_month.get(idx)
        if not la or not la['tgtVal']:
            return None
        return la['val'] / la['tgtVal']

    # -----------------------------------------------------------------
    # 3. Point curves.
    # -----------------------------------------------------------------
    log('reading scaling scores.xlsx ...')
    wb_curves = openpyxl.load_workbook(SCALING_PATH, data_only=True)
    msr_ws = wb_curves['medical rep points scheme']
    sr_ws = wb_curves['SALES REP']
    msr_sales_curve = extract_curve(msr_ws, 1, 2)
    msr_rf_curve = extract_curve(msr_ws, 4, 5)
    msr_cov_curve = extract_curve(msr_ws, 10, 11)
    sr_sales_curve = extract_curve(sr_ws, 1, 2)
    # CHC Sales Rep Coverage curve -- FIXED 2026-08-19.
    # SALES REP sheet cols 10-11 ("sr_cov_curve_raw", removed) turned out to
    # be a copy of the MSR-style 10pt Coverage curve (starts scoring at 90%,
    # caps at 10pts @100%), NOT a real CHC-specific curve -- confirmed by
    # comparing it against the deck (Zeta_Sprint_2026_Complete.pptx, slide 6,
    # "Points Calculation -- CHC / Sales Rep"), whose Coverage table (Max 40
    # pts) starts scoring at 60% with breakpoints 60-74%->1-10, 75-89%->11-25,
    # 90-99%->26-39, 100%->40. That exact shape/domain/max already exists
    # elsewhere in this same workbook: msr_rf_curve (medical rep points
    # scheme sheet, cols 4-5, Right Frequency) is numerically identical to
    # the deck's CHC Coverage table at every checkpoint (e.g. 0.99->38.88,
    # 1.00->40). The previous "* 4" scaling hack on the wrong curve
    # undersold Coverage points badly below 100% (e.g. 65% cov scored 0.00
    # instead of the deck's 4.57; 92% cov scored 9.66 instead of 31.17).
    # The CHC Sales Achievement curve (sr_sales_curve, cols 1-2 above) was
    # separately verified correct against the deck and needed no change.
    sr_cov_curve = msr_rf_curve

    # DM/DSM, ASM/NSM, and Brand Manager curves -- found in this same
    # workbook (sheets not read before 2026-08-15: 'dsm points scheme',
    # 'ASM&NSM SCHEME', 'Brand Managers'). Each converts a raw achievement
    # fraction (or, for Region, a raw count) into points already scaled to
    # that KPI's weight -- exactly the same "extract_curve + interp"
    # pattern as the Medical Rep / CHC Sales Rep curves above. Team Avg
    # curves in these sheets are confirmed pure-linear (x * max points),
    # so the existing team_avg_pts = team_avg/100*weight calc already
    # matches them exactly; only the non-Team-Avg KPI columns need curves.
    dsm_ws = wb_curves['dsm points scheme']
    asmnsm_ws = wb_curves['ASM&NSM SCHEME']
    bm_ws = wb_curves['Brand Managers']
    dm_fielddays_curve = extract_curve(dsm_ws, 4, 5)     # Field Working Days, domain 0.6-1.0 -> 1-10 pts
    # DV Coverage / Calls per DV: thresholds lowered 80%->75% / 90%->70%
    # (Ahmed, 2026-08-27). Was: extract_curve(dsm_ws, 7, 8) / (dsm_ws, 10, 11)
    # -- see _rescaled_power_curve() docstring above for the exact rule.
    dm_dvcoverage_curve = _rescaled_power_curve(75, 25)  # was 0.8-1.0 -> 1-10 pts
    dm_callsperdv_curve = _rescaled_power_curve(70, 30)  # was 0.9-1.0 -> 6.1-10 pts
    asmnsm_fielddays_curve = extract_curve(asmnsm_ws, 4, 5)  # Field Working Days, domain 0.6-1.0 -> 1-20 pts
    bm_ach_curve = extract_curve(bm_ws, 1, 2)            # National Sales Ach%, domain 0.7-1.3 -> 1-50 pts
    bm_region_curve = extract_curve(bm_ws, 4, 5)         # Regions Covered (count), domain 1-5 -> 4-20 pts
    bm_tactical_curve = extract_curve(bm_ws, 8, 9)       # Tactical Plan Execution, domain 0.7-1.0 -> 21-30 pts

    # Brand Manager's Database Shortcut "Line" -> Sales cache "lines" lookup.
    # The two sheets name lines slightly differently (e.g. DB says "CNS",
    # Sales cache calls the same line "NEUROSCIENCE"); built by matching
    # every line value seen on the 11 active BM roster rows against the
    # Sales cache's own line list (see investigation 2026-08-15).
    BM_LINE_TO_SALES_LINE = {
        'PEDIA/GYN': 'PEDIA', 'ORTHO II': 'ORTHO-II', 'DIABETES I': 'DIAB-I',
        'CVM II': 'CVM-II', 'DIABETES II': 'DIAB-II', 'GIT II': 'GIT-II',
        'GIT I': 'GIT-I', 'GIT III': 'GIT-III', 'DIABETES III': 'DIAB-III',
        'DERMA': 'Derma', 'CNS': 'NEUROSCIENCE',
        # ADDED 2026-09-17 (Ahmed: flagged Mina Shaher Wahba AbdelShahid,
        # code 1400, Brand Manager for line 'Diabetes IV', showing blank
        # National Sales KPI). 'DIABETES IV' was simply never added when
        # I/II/III were mapped above -- Sales cache genuinely has a
        # 'DIAB-IV' line with real July data, so this was a pure omission,
        # not missing source data.
        'DIABETES IV': 'DIAB-IV',
        # ADDED 2026-09-07 (Ahmed: "check all zeta sprint as per last rule
        # book and fix any mismatch or error"). This dict was originally
        # built 2026-08-15 by matching only the 11 then-ACTIVE BM roster
        # rows' own Line values -- it never needed to cover a resigned or
        # probation-failed BM's Line. That was invisible until today's
        # Sales Average widening (BM_excluded now also carries achPct):
        # 4 excluded BM records carry Line 'CHC' or 'Ortho I', neither of
        # which was in this dict, so BM_LINE_TO_SALES_LINE.get(...) came
        # back None and those 4 people were silently dropped from the
        # widened National Sales Average -- exactly the population Ahmed
        # asked to include. Both Lines have real Sales-cache data this
        # month (verified before adding): 'CHC' -> Sales cache's own 'CHC'
        # line resolves to the Working scenario (no Official coverage,
        # same as CHC_SALES); 'ORTHO I' -> 'ORTHO-I' resolves to Shortage
        # (same pattern as 'ORTHO II' -> 'ORTHO-II' above).
        'CHC': 'CHC', 'ORTHO I': 'ORTHO-I',
    }

    # -----------------------------------------------------------------
    # 4. Score Medical Rep + CHC Sales Rep, with per-period probation +
    #    active/resignation gating.
    # -----------------------------------------------------------------
    log('scoring Medical Rep / CHC Sales Rep ...')
    results = []
    excluded = []
    empidx_to_result = {}

    for key, cov in reps_coverage.items():
        code = cov['code']
        canon_line = normalize_line(cov['team'])
        bu = line_to_bu(cov['team'])

        # Sales Achievement is computed for EVERY rep up front, before the
        # active/probation gates below -- excluded reps (not-active-
        # resigned or probation-not-passed) still carry a raw achPct/role
        # on their excluded record. This is deliberately the ONLY raw KPI
        # computed pre-gate: Coverage/Right Frequency remain gate-only
        # (never computed for an excluded rep), because Ahmed asked for
        # this widened population for the Sales Average specifically, not
        # for every KPI (2026-09-07, "only Sales Average should be all
        # positions included either active or not probation or not").
        sales = rep_sales_month.get(key)
        is_sales_rep = (bu == 'CHC' and canon_line == 'CHC_SALES')
        ach_pct = (sales['val'] / sales['tgtVal']) if sales and sales['tgtVal'] > 0 else None
        excl_role = 'Sales Rep (CHC)' if is_sales_rep else 'Medical Rep'

        active_ok, inactive_reason = is_active_for_period(code, EVAL_PERIOD_END)
        if not active_ok:
            last_day = code_to_lastday.get(code)
            notif = code_to_resignnotif.get(code)
            excluded.append(dict(code=code, name=cov['name'], line=canon_line, canonLine=canon_line, bu=bu,
                                  role=excl_role, achPct=ach_pct, reason='not-active-resigned',
                                  detail=inactive_reason,
                                  lastDay=last_day.isoformat() if last_day else None,
                                  resignationNotif=notif.isoformat() if notif else None))
            continue

        prob_ok, pp = is_probation_passed_for_period(code, EVAL_PERIOD_START)
        if prob_ok is False:
            excluded.append(dict(code=code, name=cov['name'], line=canon_line, canonLine=canon_line, bu=bu,
                                  role=excl_role, achPct=ach_pct, reason='probation-not-passed',
                                  detail=f"passes {pp.isoformat()}, ranking period starts {EVAL_PERIOD_START.isoformat()}",
                                  lastDay=None, resignationNotif=None))
            continue

        if is_sales_rep:
            sales_pts = interp(sr_sales_curve, ach_pct) if ach_pct is not None else None
            cov_pts = interp(sr_cov_curve, cov['coveragePct'] / 100)
            rf_pts = None
            total = (sales_pts or 0) + (cov_pts or 0)
            role = 'Sales Rep (CHC)'
        else:
            sales_pts = interp(msr_sales_curve, ach_pct) if ach_pct is not None else None
            cov_pts = interp(msr_cov_curve, cov['coveragePct'] / 100)
            rf_pts = interp(msr_rf_curve, cov['rightFreqPct'] / 100)
            total = (sales_pts or 0) + (cov_pts or 0) + (rf_pts or 0)
            role = 'Medical Rep'

        last_day = code_to_lastday.get(code)
        is_departing_soon = last_day is not None and last_day > EVAL_PERIOD_END

        rec = dict(
            name=cov['name'], code=code, team=cov['team'], canonLine=canon_line, bu=bu, role=role,
            position=name_to_salesposition.get(key) or code_to_position.get(code),
            hireDate=code_to_hire.get(code).isoformat() if code_to_hire.get(code) else None,
            probationPassed=pp.isoformat() if pp else None,
            achPct=ach_pct, coveragePct=cov['coveragePct'], rightFreqPct=cov['rightFreqPct'],
            salesPts=sales_pts, covPts=cov_pts, rfPts=rf_pts, totalPts=total,
            isDepartingSoon=is_departing_soon,
            departingLastDay=last_day.isoformat() if is_departing_soon else None,
            # Raw sales value/target (not the ach_pct ratio) -- carried up
            # through DM/DSM -> ASM/NSM so each manager tier's own "team
            # floor" can be computed as SUM(val)/SUM(tgtVal) across every
            # rep beneath them, never as an average of already-divided
            # percentages. Per Ahmed 2026-08-16 ("DM DSM HAS REWARD ALSO,
            # MAKE SAME FLOOR LOGIC FOR ASM NSM"). 0/0 when a rep has no
            # matched sales row this month -- contributes nothing to
            # either side of the team sum, exactly as it should.
            salesVal=(sales['val'] if sales else 0.0) or 0.0,
            salesTgt=(sales['tgtVal'] if sales else 0.0) or 0.0,
        )
        results.append(rec)
        empidx_to_result[cov['empIdx']] = rec

    # "Departing soon" -- ranked reps who already have a resignation on
    # file with a Last Day after this period (still correctly included,
    # but useful to see who rolls off and when). Also flagged inline on
    # each rep's own record above (isDepartingSoon) so it can show as a
    # badge directly on the ranked row, per Ahmed 2026-08-15.
    departing_soon = []
    for rec in results:
        if not rec['isDepartingSoon']:
            continue
        code = rec['code']
        departing_soon.append(dict(code=code, name=rec['name'], line=rec['canonLine'], bu=rec['bu'],
                                    resignationNotif=code_to_resignnotif.get(code).isoformat() if code_to_resignnotif.get(code) else None,
                                    lastDay=rec['departingLastDay']))
    departing_soon.sort(key=lambda d: d['lastDay'])

    log(f'  Medical Rep + Sales Rep: {len(results)} ranked, {len(excluded)} excluded, '
        f'{len(departing_soon)} departing soon')

    # -----------------------------------------------------------------
    # 4b. Sales Average widening, part 2 -- "every territory, including
    #     vacant" (Ahmed, 2026-09-12, confirming after being shown the
    #     numbers both ways). The widening above (Step 4) already folds
    #     every Coverage-cube rep into the Sales Average regardless of
    #     active/probation status -- but that loop's whole population
    #     (reps_coverage, Step 1) requires at least one matching DVR row
    #     this period. A territory that was vacant all month, or a rep who
    #     generated real sales but left/joined without ever logging a DVR
    #     row, never enters reps_coverage, so Step 4's widening -- correct
    #     as far as it goes -- still silently dropped them entirely: not
    #     ranked, not even excluded.
    #
    #     Verified against Ahmed's own manual pivot of the Sales cube by
    #     territory: PEDIA's true "every position, staffed or not" Sales
    #     Average across all 60 territories is 63%; the dashboard's
    #     43-position average (66.6%) was overstated because it dropped
    #     exactly the worst-performing territories -- vacant seats and
    #     reps who departed without a DVR trail both skew low, so leaving
    #     them out inflates the average. Folding this population in
    #     reproduces Ahmed's 63% almost exactly (confirmed in a standalone
    #     simulation before this code was written).
    #
    #     Scope: Sales Average ONLY, exactly like Step 4 -- Coverage/Right
    #     Frequency are never computed for a record added here (no DVR
    #     rows exist for them by definition), and none of these records
    #     are ever ranked or Winner-Pool-eligible.
    #
    #     Every Sales-cache rep name with real July sales that Step 4 never
    #     reached is classified with the SAME Database Shortcut lookup and
    #     the SAME active/probation rules Step 4 uses -- just entered from
    #     the Sales cube instead of the Coverage cube:
    #       - not found in Database Shortcut.xlsx at all -- this is every
    #         literal "VACANT <territory>" placeholder the Sales cache uses
    #         for an unstaffed seat, plus any other unmatched name -> reason
    #         'no-database-match' (same name already used for exactly this
    #         situation in score_hierarchy_tier(), the DM/ASM/NSM tier,
    #         below).
    #       - found, but Last Day of Work / DB status says inactive ->
    #         'not-active-resigned' (same rule as Step 4).
    #       - found, active, but still on probation as of period start ->
    #         'probation-not-passed' (same rule as Step 4).
    #       - found, active, probation-passed -- a real, currently-working
    #         rep the Coverage/DVR cube simply has no visit rows for this
    #         period -> reason 'active-no-coverage-data'. New state: before
    #         this change such a rep was invisible everywhere (not ranked,
    #         not excluded, not counted anywhere at all) -- a data-
    #         completeness gap distinct from the Sales Average question,
    #         worth Ahmed's attention on its own.
    # -----------------------------------------------------------------
    sales_only_added = 0
    for key, sales in rep_sales_month.items():
        if key in reps_coverage:
            continue  # already scored via the Coverage-cube loop above (Step 4)
        if not sales['tgtVal'] or sales['tgtVal'] <= 0:
            continue  # no usable target this month -- achPct undefined, nothing to add
        lines_seen = rep_lines_seen.get(key)
        if not lines_seen:
            continue
        raw_line = max(lines_seen.items(), key=lambda kv: kv[1])[0]
        canon_line = normalize_line(raw_line)
        bu = line_to_bu(raw_line)
        if not bu:
            continue  # not a Medical Rep / CHC Sales Rep style line -- out of this tier's scope
        is_sales_rep = (bu == 'CHC' and canon_line == 'CHC_SALES')
        excl_role = 'Sales Rep (CHC)' if is_sales_rep else 'Medical Rep'
        ach_pct = sales['val'] / sales['tgtVal']

        code = name_to_code.get(key)
        if code is None:
            reason = 'no-database-match'
            detail = 'Name not found in Database Shortcut.xlsx'
            last_day, notif = None, None
        else:
            last_day = code_to_lastday.get(code)
            notif = code_to_resignnotif.get(code)
            active_ok, inactive_reason = is_active_for_period(code, EVAL_PERIOD_END)
            if not active_ok:
                reason, detail = 'not-active-resigned', inactive_reason
            else:
                prob_ok, pp = is_probation_passed_for_period(code, EVAL_PERIOD_START)
                if prob_ok is False:
                    reason = 'probation-not-passed'
                    detail = f"passes {pp.isoformat()}, ranking period starts {EVAL_PERIOD_START.isoformat()}"
                else:
                    reason = 'active-no-coverage-data'
                    detail = 'Active & probation-passed per Database Shortcut, but zero matching DVR/Coverage rows this period'

        excluded.append(dict(code=code, name=rep_display_name.get(key, key), line=canon_line,
                              canonLine=canon_line, bu=bu, role=excl_role, achPct=ach_pct,
                              reason=reason, detail=detail,
                              lastDay=last_day.isoformat() if last_day else None,
                              resignationNotif=notif.isoformat() if notif else None))
        sales_only_added += 1

    log(f'  Sales Average widening, every territory incl. vacant (2026-09-12): '
        f'{sales_only_added} additional positions added to the Sales Average only '
        f'(never ranked, never Coverage/Right Frequency)')

    # -----------------------------------------------------------------
    # 5. Missing-KPI template: auto-created once (never overwritten, so
    #    Ahmed's fills always survive a re-run), read back in every run.
    # -----------------------------------------------------------------
    def load_kpi_template():
        if not os.path.exists(TEMPLATE_PATH):
            return {}
        wb_t = openpyxl.load_workbook(TEMPLATE_PATH, data_only=True)
        out = {}
        for sheet_name, col_map in TEMPLATE_SHEETS.items():
            if sheet_name not in wb_t.sheetnames:
                continue
            ws_t = wb_t[sheet_name]
            header = [c.value for c in next(ws_t.iter_rows(min_row=1, max_row=1))]
            # NSM tab was replaced with a raw activity-log layout (Ahmed,
            # 2026-08-26) that uses 'Employee Code' instead of the standard
            # 'Code' header -- accept either so this sheet isn't silently
            # skipped.
            if 'Code' in header:
                code_header = 'Code'
            elif 'Employee Code' in header:
                code_header = 'Employee Code'
            else:
                continue
            code_col = header.index(code_header)
            # Raw activity-log sheets (NSM, and ASM as of 2026-09-02) stack
            # one row per employee per period in the same sheet (e.g. June
            # then July, appended below each other) -- with no filtering,
            # whichever month block comes LAST in the sheet would silently
            # win for every cache rebuild regardless of EVAL_MONTH_STR.
            # Filter to the period being built when a Date/DATE column
            # exists (NSM, ASM). DM_DSM has no Date column but, as of
            # Ahmed's 2026-09-05 restructure to the same raw activity-log
            # layout (stacking Feb-July in one sheet, same bug shape as
            # NSM/ASM on 2026-09-02), it DOES have a text 'Month' column
            # (e.g. 'June', 'July') -- filter on that instead. Brand_Manager
            # has neither and keeps the original code-only behaviour.
            date_col = None
            for date_header in ('DATE', 'Date'):
                if date_header in header:
                    date_col = header.index(date_header)
                    break
            month_col = None
            if date_col is None and 'Month' in header:
                month_col = header.index('Month')
            sheet_data = {}
            for row in ws_t.iter_rows(min_row=2, values_only=True):
                code = row[code_col]
                if code is None:
                    continue
                if date_col is not None:
                    raw_date = row[date_col]
                    row_period = None
                    if isinstance(raw_date, (datetime.datetime, datetime.date)):
                        row_period = f'{raw_date.year:04d}-{raw_date.month:02d}'
                    elif raw_date is not None:
                        parts = re.split(r'[/\-.]', str(raw_date).strip())
                        if len(parts) == 3:
                            try:
                                d, m, y = (int(p) for p in parts)
                                if y < 100:
                                    y += 2000
                                row_period = f'{y:04d}-{m:02d}'
                            except ValueError:
                                row_period = None
                    if row_period != EVAL_MONTH_STR:
                        continue
                elif month_col is not None:
                    row_month = row[month_col]
                    # Text month name (e.g. 'June'), no year column -- the
                    # sheet only ever holds 2026 data, so a bare name match
                    # against EVAL_PERIOD_NAME is unambiguous for now. If
                    # this template ever spans a second year, this will
                    # need a real year column to stay correct.
                    if row_month is None or str(row_month).strip().lower() != EVAL_PERIOD_NAME.strip().lower():
                        continue
                code = str(int(code)) if isinstance(code, (int, float)) else str(code).strip()
                vals = {}
                for key, col_label, _weight in col_map:
                    if col_label in header:
                        v = row[header.index(col_label)]
                        if v is not None and str(v).strip() != '':
                            try:
                                vals[key] = float(v)
                            except (TypeError, ValueError):
                                pass
                if vals:
                    sheet_data[code] = vals
            out[sheet_name] = sheet_data
        return out

    def write_kpi_template(dm_roster, asm_roster, nsm_roster, bm_roster_active):
        if os.path.exists(TEMPLATE_PATH):
            log(f'KPI template already exists at {TEMPLATE_PATH} -- leaving it untouched '
                f'(delete it manually to force a fresh blank template).')
            return
        wb_t = openpyxl.Workbook()
        ws0 = wb_t.active
        ws0.title = 'Instructions'
        ws0.append(['Zeta Sprint 2026 -- Missing KPI Template'])
        ws0.append([])
        ws0.append(['Fill in the columns on each tab below, save this file in place, and tell'])
        ws0.append(['Claude -- the next cache rebuild (etl/build_sprint_cache.py) picks it up'])
        ws0.append(['automatically by employee Code. Leave a cell blank if you don\'t have that'])
        ws0.append(['number yet; it will keep showing as "pending" until filled.'])
        ws0.append([])
        ws0.append(['IMPORTANT: each column asks for the REAL ACHIEVEMENT number, not points.'])
        ws0.append(['Enter a decimal fraction, e.g. "Field Working Days -- Actual % Achieved'])
        ws0.append(['(e.g. 0.85 for 85%)" means enter 0.85 for 85% -- not 85. The one exception'])
        ws0.append(['is "Regions Covered -- Actual Count (1-5)", which is a whole number.'])
        ws0.append(['build_sprint_cache.py converts your number into points itself, using the'])
        ws0.append(['real scoring curves from zeta sprint/scaling scores.xlsx (sheets "dsm points'])
        ws0.append(['scheme", "ASM&NSM SCHEME", "Brand Managers") -- the same curves that already'])
        ws0.append(['score Medical Rep / CHC Sales Rep Sales Achievement, Right Frequency, and'])
        ws0.append(['Coverage. You do not need to do any scaling math yourself.'])
        ws0.append([])
        ws0.append(['Code and Name are pre-filled from Database Shortcut.xlsx for everyone currently'])
        ws0.append(['eligible this ranking period -- do not need to add/remove rows for a normal month.'])
        ws0.append([])
        ws0.append(['Brand_Manager: National Sales is NOT in this template -- it is auto-calculated'])
        ws0.append(['from the Sales cache using the specific Line/brand each Brand Manager is'])
        ws0.append(['responsible for (per Database Shortcut.xlsx), so there is nothing to fill in'])
        ws0.append(['for it. Only Regions Covered and Tactical Plan Execution need your input.'])

        def add_sheet(name, rows, extra_cols):
            ws = wb_t.create_sheet(name)
            header = ['Code', 'Name'] + [c for _k, c, _w in extra_cols]
            ws.append(header)
            for row in rows:
                ws.append(list(row) + [None] * len(extra_cols))
            widths = [10, 34] + [28] * len(extra_cols)
            for i, w in enumerate(widths, start=1):
                ws.column_dimensions[chr(64 + i) if i <= 26 else 'A'].width = w

        add_sheet('DM_DSM', [(r['code'], r['name']) for r in dm_roster], TEMPLATE_SHEETS['DM_DSM'])
        add_sheet('ASM', [(r['code'], r['name']) for r in asm_roster], TEMPLATE_SHEETS['ASM'])
        add_sheet('NSM', [(r['code'], r['name']) for r in nsm_roster], TEMPLATE_SHEETS['NSM'])
        add_sheet('Brand_Manager', [(c, n) for c, n, _p, _l in bm_roster_active], TEMPLATE_SHEETS['Brand_Manager'])

        os.makedirs(os.path.dirname(TEMPLATE_PATH), exist_ok=True)
        wb_t.save(TEMPLATE_PATH)
        log(f'wrote NEW KPI template: {TEMPLATE_PATH}')

    kpi_template = load_kpi_template()

    def load_coaching_data():
        """Coaching Intelligence (etl/build_coaching_cache.py) is now the
        SOURCE for the DM/DSM tier's DV (Double Visit) Coverage KPI --
        replacing Ahmed's manual Sprint_Missing_KPI_Template.xlsx entry for
        any DM/DSM it covers -- per Ahmed's explicit instruction (2026-09-01,
        "from Coaching Intelligence make it source for zeta sprint june").
        Coaching Intelligence computes a real DV Coverage % per manager per
        month straight from the joint/coached field-visit log (Visits
        Details S1 DM.xlsx), for the two titles with a real "own team"
        concept -- District Manager and Field force supervisor -- which
        together ARE the DM/DSM tier's roster (same COVERAGE_TITLES set
        used in etl/build_coaching_cache.py). Matched by employee Code
        (both this script and coaching's ETL key off Database Shortcut.xlsx
        the same way), for EVAL_MONTH_STR only.

        The manual template stays the FALLBACK for any DM/DSM coaching
        doesn't cover (no code match, no visits logged that month, or the
        coaching cache being unavailable/stale) -- never silently dropped
        to pending just because this source exists.

        Returns (dv_by_code, calls_by_code, detail_by_code):
          dv_by_code: {code_str: fraction 0-1}, built from dvCoveragePct
            (capped at 100%, /100) -- NOT the uncapped dvCoverageRawPct --
            to match the 0.75-1.0 domain dm_dvcoverage_curve expects and
            what Coaching Intelligence's own UI displays.
          calls_by_code: {code_str: raw avgVisitsPerDay}. ADDED 2026-09-10
            (Ahmed: "work zeta sprint from field working days and coaching
            intel for dm dsm and nsm and asm"). Deliberately the RAW
            visits/day, not a pre-scored ratio -- Coaching Intelligence's
            own avgVisitsPerDay target is a flat 7/day for every manager,
            while Sprint's Calls per DV KPI has always scored against 8/day
            (12/day for a majority-CHC_SALES DM/DSM) per Ahmed 2026-08-16,
            so score_hierarchy_tier() divides this by the right target for
            that manager's own team before running it through the curve --
            the target-adjustment this KPI always needed to be safely
            coaching-sourced. Falls back to the manual template exactly
            like DV Coverage, wherever a code has no coaching match this
            month.
          detail_by_code: {code_str: {...}} -- the supporting detail behind
            both numbers, attached to each DM/DSM record as `coachingDetail`
            (2026-09-01, Ahmed: "DV Coverage Calls per DV pop up like in
            coaching intel") so js/sprint.js can show the same coached/
            not-coached name breakdown Coaching Intelligence itself shows
            on a DV Coverage cell click, plus the manager's real visit
            activity (visits/coachingDays/avgVisitsPerDay) for the popup.
        """
        if not os.path.exists(COACHING_CACHE_PATH):
            log(f'  WARNING: {COACHING_CACHE_PATH} not found -- DM/DSM DV Coverage '
                f'falls back to the manual KPI template for everyone this run.')
            return {}, {}
        try:
            with open(COACHING_CACHE_PATH, encoding='utf-8') as f:
                coaching = json.load(f)
        except (OSError, ValueError) as e:
            log(f'  WARNING: could not read {COACHING_CACHE_PATH} ({e}) -- DM/DSM DV '
                f'Coverage falls back to the manual KPI template for everyone this run.')
            return {}, {}
        coaching_target_avg_visits = (coaching.get('targets') or {}).get('avgVisitsPerDay')
        dv_out = {}
        calls_out = {}
        detail_out = {}
        for mgr in coaching.get('managers', []):
            code = mgr.get('code')
            if code is None:
                continue
            month = (mgr.get('monthly') or {}).get(EVAL_MONTH_STR)
            if not month:
                continue
            code_str = str(code)
            pct = month.get('dvCoveragePct')
            if pct is not None:
                dv_out[code_str] = pct / 100.0
            # Calls per DV (2026-09-10, Ahmed: "work zeta sprint from field
            # working days and coaching intel for dm dsm and nsm and asm") --
            # raw avgVisitsPerDay; target-adjusted per manager's own BU down
            # in score_hierarchy_tier(), NOT Coaching's own flat 7/day target.
            avg_visits = month.get('avgVisitsPerDay')
            if avg_visits is not None:
                calls_out[code_str] = avg_visits
            # repBreakdown (2026-09-01, Ahmed: "show coched rep how many days
            # visits per each day make the best practice"): per coached
            # rep, THIS month's own coachingDays/visits/avgVisitsPerDay --
            # from coachedEmployees' per-employee `monthly` bucket, not the
            # cumulative Feb-Jun totals on that record. Best Practice is
            # whoever has the highest visits/coachingDays cadence this
            # month (ties all flagged) -- gives Ahmed a concrete "do what
            # this rep's coach did" example inside the same popup, not just
            # an aggregate manager-level number.
            rep_breakdown = []
            for emp in (mgr.get('coachedEmployees') or []):
                emp_month = (emp.get('monthly') or {}).get(EVAL_MONTH_STR)
                if not emp_month:
                    continue
                emp_days = emp_month.get('coachingDays') or 0
                if emp_days <= 0:
                    continue
                emp_visits = emp_month.get('visits') or 0
                emp_avg = round(emp_visits / emp_days, 2) if emp_days else None
                rep_breakdown.append(dict(
                    name=emp.get('name'),
                    position=emp.get('position'),
                    coachingDays=emp_days,
                    visits=emp_visits,
                    avgVisitsPerDay=emp_avg,
                    isBestPractice=False,
                ))
            rep_breakdown.sort(key=lambda row: (row['avgVisitsPerDay'] or 0, row['visits']), reverse=True)
            if rep_breakdown:
                best_avg = rep_breakdown[0]['avgVisitsPerDay']
                for row in rep_breakdown:
                    if best_avg is not None and row['avgVisitsPerDay'] == best_avg:
                        row['isBestPractice'] = True
            detail_out[code_str] = dict(
                dvCoveragePct=month.get('dvCoveragePct'),
                dvCoverageRawPct=month.get('dvCoverageRawPct'),
                activeTeamSize=month.get('activeTeamSize'),
                coachedOnRoster=month.get('coachedOnRoster'),
                coachedOffRoster=month.get('coachedOffRoster'),
                coachedNames=month.get('coachedNames') or [],
                notCoachedNames=month.get('notCoachedNames') or [],
                # Sick Leave Impact Rule (2026-09-16): the reps dropped from
                # this month's DV Coverage DENOMINATOR because they were in
                # the Excluded band. Carried through so Sprint's own DV
                # Coverage popup can reconcile its arithmetic the way
                # Coaching Intelligence's roster popup already does --
                # without it the popup reads "5 of 6 roster reps" directly
                # beneath a 100.0% KPI, which is the contradiction Ahmed
                # caught on 2026-09-16. activeTeamSize above is ALREADY
                # leave-adjusted; these are the names behind the gap.
                leaveExcludedNames=month.get('leaveExcludedNames') or [],
                activeTeamSizeBeforeLeave=month.get('activeTeamSizeBeforeLeave'),
                visits=month.get('visits'),
                coachingDays=month.get('coachingDays'),
                avgVisitsPerDay=month.get('avgVisitsPerDay'),
                avgVsTargetPct=month.get('avgVsTargetPct'),
                coachingTargetAvgVisitsPerDay=coaching_target_avg_visits,
                zones=month.get('zones'),
                repBreakdown=rep_breakdown,
            )

        # dvCoverageRank / callsPerDvRank (2026-09-01, Ahmed: "show position
        # if this rep"): this manager's rank among every DM/DSM Coaching
        # Intelligence matched this month (competition ranking -- equal
        # values share a rank, next rank skips accordingly), computed
        # separately for DV Coverage (dvCoveragePct) and Calls per DV
        # (avgVisitsPerDay, the REAL coaching cadence number shown in that
        # popup -- not the manual-template score, which isn't coaching-
        # sourced and so isn't comparable this way).
        def competition_rank(pairs):
            ranked = sorted(pairs, key=lambda p: p[1], reverse=True)
            ranks = {}
            prev_val, prev_rank = None, 0
            for i, (code_key, val) in enumerate(ranked, start=1):
                if prev_val is None or val != prev_val:
                    prev_rank = i
                    prev_val = val
                ranks[code_key] = prev_rank
            return ranks, len(ranked)

        dv_pairs = [(c, d['dvCoveragePct']) for c, d in detail_out.items() if d.get('dvCoveragePct') is not None]
        dv_ranks, dv_total = competition_rank(dv_pairs)
        calls_pairs = [(c, d['avgVisitsPerDay']) for c, d in detail_out.items() if d.get('avgVisitsPerDay') is not None]
        calls_ranks, calls_total = competition_rank(calls_pairs)
        for c, d in detail_out.items():
            if c in dv_ranks:
                d['dvCoverageRank'] = dv_ranks[c]
                d['dvCoverageRankOf'] = dv_total
            if c in calls_ranks:
                d['callsPerDvRank'] = calls_ranks[c]
                d['callsPerDvRankOf'] = calls_total

        log(f'  Coaching Intelligence DV Coverage: {len(dv_out)} DM/DSM matched for {EVAL_MONTH_STR} '
            f'({len(detail_out)} with popup detail); Calls per DV: {len(calls_out)} matched')
        return dv_out, calls_out, detail_out

    coaching_dv_by_code, coaching_calls_by_code, coaching_detail_by_code = load_coaching_data()

    def load_working_days_data():
        """Field Working Days Intelligence's own cache
        (etl/build_working_days_cache.py, cache/working_days.json) is now the
        SOURCE for the fieldDays KPI's popup detail across ALL THREE
        hierarchy tiers -- DM/DSM, ASM, AND NSM (2026-09-11, Ahmed: "i need
        field working days to be like [DV Coverage/Calls per DV] and also
        for asm and nsm source is field working days page").

        Deliberately reuses that page's own already-computed per-employee
        breakdown rather than re-deriving it a second time here: both
        scripts read the IDENTICAL xlsx header/column for the IDENTICAL
        code+month (TARGET_HEADER / FIELDDAYS_HEADER in
        etl/build_working_days_cache.py match this file's own
        TEMPLATE_SHEETS['fieldDays'] column label exactly), so this changes
        NOTHING about the score -- raw/pts still come from
        load_kpi_template() exactly as before. It only supplies the detail
        a popup needs (Calendar Days, each deduction category, Target
        Working Days, All Visit Days, hire/last-day/left-company) and tags
        source='workingdays' so js/sprint.js knows to make the cell
        clickable -- mirroring the DV Coverage/Calls per DV precedent
        (see load_coaching_data() above), but at record level for every
        tier this time, not DM/DSM only.

        Returns {sheet_name: {code_str: detail_dict}} for EVAL_PERIOD_NAME
        only. Missing/unreadable cache degrades gracefully: the fieldDays
        KPI simply stays non-clickable (source='template'), exactly like
        today, for everyone.
        """
        if not os.path.exists(WORKING_DAYS_CACHE_PATH):
            log(f'  WARNING: {WORKING_DAYS_CACHE_PATH} not found -- Field Working '
                f'Days popup detail unavailable this run (fieldDays KPI itself '
                f'still scores from the manual template as before).')
            return {}
        try:
            with open(WORKING_DAYS_CACHE_PATH, encoding='utf-8') as f:
                wd = json.load(f)
        except (OSError, ValueError) as e:
            log(f'  WARNING: could not read {WORKING_DAYS_CACHE_PATH} ({e}) -- Field '
                f'Working Days popup detail unavailable this run.')
            return {}
        multiplier = wd.get('multiplier') or {}
        out = {}
        for sheet_name in ('DM_DSM', 'ASM', 'NSM'):
            month_rows = ((wd.get('employees') or {}).get(sheet_name) or {}).get(EVAL_PERIOD_NAME, [])
            tier_month = ((wd.get('tiers') or {}).get(sheet_name, {}).get('months') or {}).get(EVAL_PERIOD_NAME, {})
            tier_avg_pct = tier_month.get('avgFieldPct')
            sheet_out = {}
            for row in month_rows:
                code_str = str(row.get('code'))
                sheet_out[code_str] = dict(
                    calendarDays=row.get('calendarDays'),
                    deducts=row.get('deducts') or {},
                    deductSum=row.get('deductSum'),
                    targetDays=row.get('targetDays'),
                    allVisitDays=row.get('allVisitDays'),
                    fieldPct=row.get('fieldPct'),
                    hireDate=row.get('hireDate'),
                    lastDay=row.get('lastDay'),
                    leftCompany=row.get('leftCompany'),
                    multiplier=multiplier.get(sheet_name),
                    tierAvgFieldPct=tier_avg_pct,
                )
            out[sheet_name] = sheet_out
            log(f'  Field Working Days detail: {len(sheet_out)} {sheet_name} matched for {EVAL_PERIOD_NAME}')
        return out

    working_days_by_sheet = load_working_days_data()

    def normalize_raw(key, val):
        """Defensive guard against a common fill-in mistake: entering a
        whole-number percent (e.g. 85) instead of the requested decimal
        fraction (0.85). Every raw-achievement KPI here has a legitimate
        range well under 3 (curves top out around 1.3 for over-achieved
        Sales); 'regionCount' is the one genuinely whole-number field
        (1-5) and must NOT be rescaled."""
        if key == 'regionCount':
            return val
        return val / 100.0 if val > 3 else val

    # -----------------------------------------------------------------
    # 6. DM/DSM, ASM, NSM -- Team Avg rollup (this month's already-scored
    #    reps) + whatever KPI slots Ahmed has filled into the template,
    #    converted from raw achievement to points via the real curves
    #    from scaling scores.xlsx.
    # -----------------------------------------------------------------
    log('rolling up DM/DSM, ASM, NSM ...')

    def score_hierarchy_tier(name_list, team_pool, team_avg_weight, kpi_slots, tier_label, template_sheet, curves,
                              member_noun='rep'):
        # team_pool: dict of mgr_name -> list of member dicts, each already
        # normalized to {name, code, line, bu, role, totalPts}. For DM/DSM
        # the pool is individual reps; for ASM/NSM the pool is DM/DSMs
        # (see call sites below) -- per Ahmed 2026-08-15 ("ASM and NSM
        # average points for their DSM"), ASM/NSM Team Avg now rolls up
        # from each DM/DSM's own total points, not straight from reps,
        # matching the real org chain Rep -> DM/DSM -> ASM/NSM.
        # Only members who themselves passed the active + probation gates
        # (for reps) or were successfully scored (for DM/DSMs) ever appear
        # in a pool, so this Team Avg is already restricted to eligible
        # members only -- confirmed 2026-08-15 per Ahmed's question.
        provided_by_code = kpi_template.get(template_sheet, {})
        out = []
        excl = []
        for mgr_name in name_list:
            if not mgr_name or mgr_name.strip() == '' or mgr_name.upper().startswith('VACANT'):
                continue
            code = name_to_code.get(norm_name(mgr_name))
            team_members = team_pool.get(mgr_name, [])
            line_counts = Counter(m['line'] for m in team_members if m.get('line'))
            bu_counts = Counter(m['bu'] for m in team_members if m.get('bu'))
            primary_line = line_counts.most_common(1)[0][0] if line_counts else None
            primary_bu = bu_counts.most_common(1)[0][0] if bu_counts else None
            team_members_out = [dict(name=m['name'], code=m['code'], line=m['line'], bu=m['bu'],
                                      role=m['role'], totalPts=m['totalPts'])
                                 for m in team_members if m['totalPts'] is not None]
            team_members_out.sort(key=lambda m: m['totalPts'], reverse=True)

            if code is None:
                excl.append(dict(name=mgr_name, code=None, reason='no-database-match',
                                  detail='Name not found in Database Shortcut.xlsx -- cannot verify probation/active status',
                                  line=primary_line, bu=primary_bu))
                continue

            active_ok, inactive_reason = is_active_for_period(code, EVAL_PERIOD_END)
            if not active_ok:
                excl.append(dict(name=mgr_name, code=code, reason='not-active-resigned', detail=inactive_reason,
                                  line=primary_line, bu=primary_bu))
                continue
            prob_ok, pp = is_probation_passed_for_period(code, EVAL_PERIOD_START)
            if prob_ok is False:
                excl.append(dict(name=mgr_name, code=code, reason='probation-not-passed',
                                  detail=f"passes {pp.isoformat()}, ranking period starts {EVAL_PERIOD_START.isoformat()}",
                                  line=primary_line, bu=primary_bu))
                continue

            team_scores = [m['totalPts'] for m in team_members if m['totalPts'] is not None]
            team_avg = (sum(team_scores) / len(team_scores)) if team_scores else None
            team_avg_pts = (team_avg / 100 * team_avg_weight) if team_avg is not None else None

            # Team Sales Achievement % -- SUM(val)/SUM(tgtVal) across every
            # eligible member, divided exactly once (never an average of
            # per-member percentages). For DM/DSM, members are individual
            # reps carrying their own raw salesVal/salesTgt. For ASM/NSM,
            # members are DM/DSMs carrying THEIR team's already-summed
            # salesVal/salesTgt (set below in the ASM/NSM pool build) --
            # so this same sum-once logic rolls all the way up from the
            # rep level with no percentage ever averaged at any tier.
            # Gates the 70% floor for WINNER/RUNNER-UP + BU Leader badges
            # and the cash payout -- per Ahmed 2026-08-16.
            team_sales_val = sum(m.get('salesVal', 0) or 0 for m in team_members)
            team_sales_tgt = sum(m.get('salesTgt', 0) or 0 for m in team_members)
            team_sales_ach_pct = (team_sales_val / team_sales_tgt) if team_sales_tgt > 0 else None

            provided = provided_by_code.get(code, {})
            kpis = []
            extra_pts_sum = 0.0
            any_pending = team_avg_pts is None
            for key, label, weight in kpi_slots:
                raw = provided.get(key)
                source = 'template' if raw is not None else None
                # DV Coverage (2026-09-01): Coaching Intelligence is the
                # SOURCE for this KPI wherever it has a matching DM/DSM for
                # this month -- see load_coaching_dv_coverage() above. Only
                # falls back to the manual template when coaching has no
                # match for this code -- never overrides a real coaching
                # value with a stale manual one.
                if key == 'dvCoverage' and code in coaching_dv_by_code:
                    raw = coaching_dv_by_code[code]
                    source = 'coaching'
                # Calls per DV (2026-09-10, Ahmed: "work zeta sprint from
                # field working days and coaching intel for dm dsm and nsm
                # and asm") -- same precedent as DV Coverage above: prefer
                # Coaching Intelligence's real visit-log cadence wherever it
                # has a match for this manager this month, falling back to
                # the manual template only when it doesn't. Coaching's raw
                # number is visits/day, not "% of target" -- has to be
                # divided by THIS manager's own Calls-per-DV target (8/day,
                # or 12/day when their team is majority CHC_SALES) before it
                # means the same thing the manual template's own column asks
                # Ahmed to enter -- matches js/sprint.js's own documented
                # rule (KPI_METHODOLOGY.callsPerDv: "12 DVs/day specifically
                # for the DM/DSM managing the CHC_SALES line"). primary_line
                # (majority-vote canonical Line of this manager's own team,
                # computed above) is the same signal used everywhere else in
                # this file to identify a CHC_SALES-line team -- BU=='CHC'
                # alone is not specific enough, since the DB's own 'CHC'
                # canonical line (a different population from CHC_SALES)
                # also maps to BU 'CHC'.
                if key == 'callsPerDv' and code in coaching_calls_by_code:
                    target = CALLS_PER_DV_TARGET_CHC_SALES if primary_line == 'CHC_SALES' else CALLS_PER_DV_TARGET_DEFAULT
                    raw = coaching_calls_by_code[code] / target
                    source = 'coaching'
                # Field Working Days (2026-09-11, Ahmed: "i need field working
                # days to be like [DV Coverage/Calls per DV] and also for asm
                # and nsm source is field working days page") -- same
                # source-tagging precedent as the two KPIs above, but the raw
                # score itself is UNCHANGED (still `provided.get('fieldDays')`
                # from the manual template): working_days_by_sheet reads the
                # identical xlsx column, so this only tags the cell as
                # clickable and supplies the popup's breakdown detail below.
                if key == 'fieldDays' and raw is not None and code in working_days_by_sheet.get(template_sheet, {}):
                    source = 'workingdays'
                pts = None
                if raw is not None:
                    raw = normalize_raw(key, raw)
                    pts = max(0.0, min(weight, interp(curves[key], raw)))
                    extra_pts_sum += pts
                else:
                    any_pending = True
                kpis.append(dict(key=key, label=label, weight=weight, pts=pts, raw=raw, source=source))

            total_pts = None if team_avg_pts is None else (team_avg_pts + extra_pts_sum)

            out.append(dict(
                name=mgr_name, code=code, tier=tier_label, line=primary_line, bu=primary_bu,
                hireDate=code_to_hire.get(code).isoformat() if code_to_hire.get(code) else None,
                probationPassed=pp.isoformat() if pp else None,
                teamSize=len(team_scores),
                memberNoun=member_noun,
                teamMembers=team_members_out,
                teamAvgRaw=team_avg,
                teamAvgPts=team_avg_pts,
                teamAvgWeight=team_avg_weight,
                kpis=kpis,
                totalPts=total_pts,
                totalMaxPts=100,
                isPartial=any_pending,
                teamSalesVal=team_sales_val,
                teamSalesTgt=team_sales_tgt,
                teamSalesAchPct=team_sales_ach_pct,
                # Coaching Intelligence popup detail (2026-09-01, Ahmed: "DV
                # Coverage Calls per DV pop up like in coaching intel") --
                # only ever present for DM/DSM (coaching_detail_by_code is
                # keyed by District Manager/Field force supervisor codes);
                # None for ASM/NSM, which is what js/sprint.js uses to
                # decide whether the DV Coverage / Calls per DV KPI cells
                # are clickable at all -- see load_coaching_data() above.
                coachingDetail=coaching_detail_by_code.get(code),
                # Field Working Days popup detail (2026-09-11, Ahmed: "i need
                # field working days to be like [DV Coverage/Calls per DV]
                # and also for asm and nsm source is field working days
                # page") -- unlike coachingDetail above, present for ALL
                # THREE tiers (DM/DSM, ASM, NSM), since Field Working Days
                # Intelligence covers all three. None wherever
                # cache/working_days.json has no matching code+month --
                # js/sprint.js uses that same source=='workingdays' /
                # workingDaysDetail presence to decide whether the Field
                # Working Days KPI cell is clickable.
                workingDaysDetail=working_days_by_sheet.get(template_sheet, {}).get(code),
            ))
        return out, excl

    # DM/DSM: Team Avg 70 + Field Working Days 10 + DV Coverage 10 +
    # Calls per DV 10 -- confirmed by Ahmed 2026-08-15 ("dm dsm is right
    # for these parameters as in scaling and in ppt") against the real
    # 'dsm points scheme' curves. Team Avg pool = individual reps under
    # each DM/DSM.
    dm_curves = {'fieldDays': dm_fielddays_curve, 'dvCoverage': dm_dvcoverage_curve, 'callsPerDv': dm_callsperdv_curve}
    dm_team_pool = defaultdict(list)
    for empIdx, rec in empidx_to_result.items():
        mgr_name = emp_to_manager.get(empIdx)
        if mgr_name:
            dm_team_pool[mgr_name].append(dict(name=rec['name'], code=rec['code'], line=rec['canonLine'],
                                                bu=rec['bu'], role=rec['role'], totalPts=rec['totalPts'],
                                                salesVal=rec['salesVal'], salesTgt=rec['salesTgt']))
    dm_results, dm_excluded = score_hierarchy_tier(dims['managers'], dm_team_pool, 70,
                                                     TEMPLATE_SHEETS['DM_DSM'], 'DM/DSM', 'DM_DSM', dm_curves,
                                                     member_noun='rep')

    # ASM/NSM: (Sub-)Team Avg 80 + Field Days 20, per 'ASM&NSM SCHEME' --
    # weights unchanged, but per Ahmed 2026-08-15 ("ASM and NSM average
    # points for their DSM") the Team Avg pool is now each ASM/NSM's own
    # DM/DSMs (their totalPts, out of 100), not individual reps directly
    # -- matches the real org chain Rep -> DM/DSM -> ASM/NSM. Each DM/DSM's
    # ASM/NSM is derived by majority vote over their own (already-eligible)
    # reps' direct ASM/NSM assignment in the Coverage cache -- the same
    # majority-vote technique already used for each manager's Line/BU.
    asmnsm_curves = {'fieldDays': asmnsm_fielddays_curve}
    dm_asm_votes = defaultdict(Counter)
    dm_nsm_votes = defaultdict(Counter)
    for empIdx, rec in empidx_to_result.items():
        dm_name = emp_to_manager.get(empIdx)
        if not dm_name:
            continue
        asm_name = emp_to_areaManager.get(empIdx)
        nsm_name = emp_to_nsm.get(empIdx)
        if asm_name:
            dm_asm_votes[dm_name][asm_name] += 1
        if nsm_name:
            dm_nsm_votes[dm_name][nsm_name] += 1
    dm_name_to_asm = {dm: votes.most_common(1)[0][0] for dm, votes in dm_asm_votes.items()}
    dm_name_to_nsm = {dm: votes.most_common(1)[0][0] for dm, votes in dm_nsm_votes.items()}

    # FIXED 2026-09-20 (Ahmed: "Karim Mohamed Nagib Mohamed Eldemerdash SHOULD
    # BE SHOWN IN DSM IN JULY") -- was dims['areaManagers'] + dims['nsms'],
    # the FULL distinct-name dimension lists across every month present in
    # records.data.js (Feb-August), not period-scoped at all. Any name that
    # is EVER someone's Area Manager/NSM in ANY month -- past or future --
    # got permanently excluded from DM/DSM for every period's build,
    # including periods before that promotion happened (Karim: DSM through
    # July, Area Manager only from August, but his name sat in
    # dims['areaManagers'] regardless, so July's build excluded him too).
    # This was actually the deciding mechanism -- the 2026-09-17 fixes to
    # emp_to_manager/emp_to_areaManager/emp_to_nsm and hr_higher_tier_codes
    # (both period-scoped that day) turned out NOT to be enough on their
    # own, because this line independently re-derived the same exclusion
    # from the un-scoped dimension lists. Now reuses emp_to_areaManager/
    # emp_to_nsm (already period-scoped to EVAL_PERIOD_NAME by the
    # 2026-09-17 fix above) instead of the raw dimension lists -- the same
    # ground truth, correctly limited to this period.
    higher_tier_manager_names = {norm_name(m) for m in (set(emp_to_areaManager.values()) | set(emp_to_nsm.values())) if m}
    higher_tier_manager_codes = {name_to_code.get(norm_name(m)) for m in (set(emp_to_areaManager.values()) | set(emp_to_nsm.values())) if m and name_to_code.get(norm_name(m))}

    asm_team_pool = defaultdict(list)
    nsm_team_pool = defaultdict(list)
    for dm in dm_results:
        if dm['totalPts'] is None:
            continue
        dm_code = dm.get('code')
        dm_norm = norm_name(dm['name'])

        # Skip placing any manager who is active in higher tier (ASM/NSM) into a DM/DSM team pool
        if dm_code in higher_tier_manager_codes or dm_norm in higher_tier_manager_names:
            continue

        member = dict(name=dm['name'], code=dm['code'], line=dm['line'], bu=dm['bu'],
                      role='DM/DSM', totalPts=dm['totalPts'],
                      salesVal=dm['teamSalesVal'], salesTgt=dm['teamSalesTgt'])
        asm_name = dm_name_to_asm.get(dm['name'])
        if asm_name and norm_name(asm_name) != dm_norm and name_to_code.get(norm_name(asm_name)) != dm_code:
            asm_team_pool[asm_name].append(dict(member))
        nsm_name = dm_name_to_nsm.get(dm['name'])
        if nsm_name and norm_name(nsm_name) != dm_norm and name_to_code.get(norm_name(nsm_name)) != dm_code:
            nsm_team_pool[nsm_name].append(dict(member))

    asm_results, asm_excluded = score_hierarchy_tier(dims['areaManagers'], asm_team_pool, 80,
                                                       TEMPLATE_SHEETS['ASM'], 'ASM', 'ASM', asmnsm_curves,
                                                       member_noun='DM/DSM')
    nsm_results, nsm_excluded = score_hierarchy_tier(dims['nsms'], nsm_team_pool, 80,
                                                       TEMPLATE_SHEETS['NSM'], 'NSM', 'NSM', asmnsm_curves,
                                                       member_noun='DM/DSM')

    # Ensure any manager who is scored as an ASM or NSM in a higher tier, or whose HR Position
    # indicates higher tier (Area Sales Manager, Business Unit Manager, NSM, Brand Manager), is NOT
    # also scored as a DM/DSM for the same period (e.g. Mohamed Yakn code 799, Karim Nagib code 188, Ahmed Othman code 1278).
    # Ahmed explicit directive: "consider it as aarea manager in zeta sprint not as dm
    # and for nsm or asm consider dsm only reported to them"
    #
    # FIXED 2026-09-20 (Ahmed: "Karim Mohamed Nagib Mohamed Eldemerdash SHOULD
    # BE SHOWN IN DSM IN JULY"). Root cause: this used TODAY's Database
    # Shortcut Position snapshot for every period's build, with no period
    # awareness -- so a person promoted AFTER the eval period (Karim: DSM
    # through July, Area Manager only from August; confirmed via
    # records.data.js's own per-period title field, which flips exactly at
    # the July/August boundary) was wrongly excluded from July's DM/DSM list
    # using their CURRENT title. Now prefers the DVR/coverage source's own
    # title for EVAL_PERIOD_NAME when that employee code has one (period-
    # accurate ground truth, same principle as the emp_to_manager/
    # emp_to_areaManager/emp_to_nsm period-scoping fix above) and only falls
    # back to today's HR snapshot when there's no such row -- true for the
    # large majority of ASM/NSM/Brand Manager codes here (61 of 63 checked
    # 2026-09-17), who own no rep-level DVR history at all and have no other
    # signal. Only Karim (188) and Ahmed Othman Mahmoud Mohamed Othman (1278)
    # had a period row showing a still-lower title, so those are the only
    # two whose July DM/DSM inclusion changes from this fix.
    period_title_by_code = {}
    for row in records['rows']:
        if dims['periods'][row[F['period']]] != EVAL_PERIOD_NAME:
            continue
        period_title_by_code[employeeCodes[row[F['employee']]]] = titles[row[F['title']]]

    hr_higher_tier_codes = set()
    for code_val, pos_val in code_to_position.items():
        period_title = period_title_by_code.get(code_val)
        pos_upper = (period_title if period_title is not None else str(pos_val or '')).replace('\ufffd', '').upper()
        if ('AREA' in pos_upper or 'NATIONAL' in pos_upper or 'BUSINESS UNIT' in pos_upper or 'BRAND' in pos_upper) and 'REPRESENTATIVE' not in pos_upper and 'SPECIALIST' not in pos_upper:
            hr_higher_tier_codes.add(code_val)

    higher_tier_codes = {
        rec['code'] for rec in (asm_results + nsm_results)
        if rec.get('code') and rec.get('totalPts') is not None
    } | higher_tier_manager_codes | hr_higher_tier_codes

    if higher_tier_codes:
        filtered_dm_results = []
        for dm in dm_results:
            if dm.get('code') in higher_tier_codes:
                dm_excluded.append(dict(
                    name=dm['name'], code=dm['code'], reason='promoted-higher-tier',
                    detail=f"Scored as Area Manager / NSM / Higher Tier in period {EVAL_PERIOD_NAME}",
                    line=dm['line'], bu=dm['bu']
                ))
            else:
                filtered_dm_results.append(dm)
        dm_results = filtered_dm_results

    log(f'  DM/DSM: {len(dm_results)} scored, {len(dm_excluded)} excluded')
    log(f'  ASM:    {len(asm_results)} scored, {len(asm_excluded)} excluded')
    log(f'  NSM:    {len(nsm_results)} scored, {len(nsm_excluded)} excluded')

    # Mid-period promotion/tier-change safety net -- added 2026-09-03,
    # Ahmed: "Mohamed Yakn Hamed Abuelenein HE WAS DISTRICT TILL JUNE SO
    # LET HIM APPEAR TILL JUNE AND JULY HE BOCOME AREA MANAGER CONSIDER
    # THIS AND ALL LIKE SITUATION". That specific case (code 799) was
    # already handled correctly by existing behavior: DM_DSM tier
    # membership comes from having a row in the DM_DSM template sheet,
    # ASM/NSM tier membership from a template row whose OWN Date column
    # falls in EVAL_MONTH_STR (see load_kpi_template()'s date filter,
    # 2026-09-02) plus the Coverage/Sales source data's own Direct
    # Manager/Area Manager/NSM columns for that period -- so a person who
    # was District Manager through June and became Area Manager in July
    # is scored under DM/DSM for June and (once EVAL_PERIOD moves to
    # July, and the underlying Coverage/Sales source reflects the new
    # reporting line) under ASM for July, automatically, with no code
    # change needed. What COULD go wrong for "all like situations": if
    # Ahmed's DM_DSM/ASM/NSM template rows aren't cleanly period-scoped
    # for a promoted person (e.g. a stale DM_DSM row left in for a month
    # they'd already moved on from), this build would silently score them
    # in two tiers for the same period. Rather than trust a one-off manual
    # check to catch every future case, this cross-checks it on every
    # build: any employee code scored in more than one of DM/DSM, ASM, NSM
    # this run gets a loud console warning (non-fatal -- a real dual role
    # is rare but not impossible, e.g. covering two roles during a
    # handover, so this informs rather than blocks).
    # Only count a tier appearance as "real" when it actually carries a
    # score (totalPts is not None) -- dims['managers']/['areaManagers']/
    # ['nsms'] (the Coverage cache's Direct Manager/Area Manager/NSM name
    # dimensions) can list someone who ISN'T really a manager at that
    # tier at all, e.g. via a vacant-position escalation chain (Database
    # Shortcut's Direct/2nd/3rd Manager fallback) -- score_hierarchy_tier
    # still emits a placeholder record for them (teamSize 0, every KPI
    # raw None, totalPts None, isPartial True) so the front-end has a row
    # to show as pending, but it is never scored, never averaged, and
    # explicitly excluded from feeding ASM/NSM's own team pools (see the
    # `if dm['totalPts'] is None: continue` guard a few lines above this
    # tier's own pool-building loop). Spot-checked 2026-09-03: 23 such
    # placeholder-only overlaps exist right now (real NSMs/ASMs whose name
    # also lands in the DM/DSM dims from an escalation artifact) -- every
    # one had teamSize 0 / totalPts None on the DM/DSM side, confirming
    # they're harmless placeholders, not real double-scoring. Filtering to
    # totalPts is not None here is what keeps this warning limited to
    # genuine same-period double-scoring (the actual risk from a sloppy
    # mid-period promotion) instead of firing on this pre-existing,
    # harmless pattern every single build.
    tier_codes = defaultdict(list)
    for tier_label_chk, tier_results_chk in (('DM/DSM', dm_results), ('ASM', asm_results), ('NSM', nsm_results)):
        for rec_chk in tier_results_chk:
            if rec_chk.get('code') and rec_chk.get('totalPts') is not None:
                tier_codes[rec_chk['code']].append((tier_label_chk, rec_chk['name']))
    dual_tier = {dt_code: dt_tiers for dt_code, dt_tiers in tier_codes.items() if len(dt_tiers) > 1}
    if dual_tier:
        log(f'  [WARNING] {len(dual_tier)} employee(s) scored in MORE THAN ONE tier this period -- '
            f'check for a mid-period promotion/tier-change that needs its template rows tightened to '
            f'the right month(s):')
        for dt_code, dt_tiers in dual_tier.items():
            dt_names = ', '.join(f"{dt_label} ({dt_name})" for dt_label, dt_name in dt_tiers)
            log(f'    code {dt_code}: {dt_names}')
    # Deliberately reusing plain, generic-sounding loop variable names
    # anywhere in THIS function is what caused a real bug the first time
    # this exact block was added (2026-09-03): a `for label, results in
    # (...)` loop here silently clobbered an outer `results` accumulator
    # (532 Medical Rep/CHC Sales Rep records, defined far above at
    # `results = []` and read again far below at `'ranked': results`) --
    # Python for-loops are not block-scoped, so the loop's own local names
    # leak into this whole function and can silently overwrite a
    # same-named variable used elsewhere, with no error at all. Every
    # variable in this block is now prefixed dt_/tier_/_chk specifically
    # so it can never collide with a name used elsewhere in this (very
    # long, single-scope) function again -- do the same for any future
    # addition here rather than trusting short generic names.

    # -----------------------------------------------------------------
    # 7. Brand Manager -- roster from Database Shortcut (owns products,
    #    not a rep hierarchy, so no Team Avg rollup is possible).
    #    National Sales (Ach%) is auto-calculated from the Sales cache,
    #    aggregated nationally over the specific Line/brand this Brand
    #    Manager is responsible for, per Ahmed 2026-08-15 ("calculate bm
    #    achievement according to brands they are responsible for").
    #    Regions Covered + Tactical Plan Execution still come from the
    #    template (raw achievement -> points via the Brand Managers curve).
    # -----------------------------------------------------------------
    log('scoring Brand Manager ...')
    bm_template = kpi_template.get('Brand_Manager', {})
    bm_results, bm_excluded = [], []
    for code, name, position, line in bm_roster:
        # Same pre-gate Sales computation as Medical Rep/CHC Sales Rep
        # above, for the same reason (2026-09-07 widened Sales Average).
        sales_line = BM_LINE_TO_SALES_LINE.get(line.strip().upper()) if line else None
        ach = line_sales_achievement(sales_line) if sales_line else None

        active_ok, inactive_reason = is_active_for_period(code, EVAL_PERIOD_END)
        if not active_ok:
            bm_excluded.append(dict(name=name, code=code, line=line, achPct=ach, reason='not-active-resigned', detail=inactive_reason))
            continue
        prob_ok, pp = is_probation_passed_for_period(code, EVAL_PERIOD_START)
        if prob_ok is False:
            bm_excluded.append(dict(name=name, code=code, line=line, achPct=ach, reason='probation-not-passed',
                                     detail=f"passes {pp.isoformat()}, ranking period starts {EVAL_PERIOD_START.isoformat()}"))
            continue
        kpis = []
        total_pts = 0.0
        any_pending = False
        if ach is not None:
            pts = max(0.0, min(50.0, interp(bm_ach_curve, ach)))
            total_pts += pts
        else:
            pts = None
            any_pending = True
        kpis.append(dict(key='salesAch', label='National Sales -- Ach% (auto)', weight=50, pts=pts, raw=ach,
                          source='auto', line=line, salesLine=sales_line))

        provided = bm_template.get(code, {})
        bm_curves = {'regionCount': bm_region_curve, 'tacticalPlan': bm_tactical_curve}
        for key, label, weight in TEMPLATE_SHEETS['Brand_Manager']:
            raw = provided.get(key)
            if raw is not None:
                raw = normalize_raw(key, raw)
                pts = max(0.0, min(weight, interp(bm_curves[key], raw)))
                total_pts += pts
            else:
                pts = None
                any_pending = True
            kpis.append(dict(key=key, label=label, weight=weight, pts=pts, raw=raw, source='template'))

        bm_results.append(dict(
            name=name, code=code, tier='Brand Manager', position=position, line=line,
            # bu reuses the same sales_line -> canonical-BU lookup already
            # computed above for National Sales -- Brand Managers' own raw
            # Database Shortcut Line strings ("DIABETES I", etc.) don't match
            # the canonical Coverage-cache line vocabulary directly, but the
            # BM_LINE_TO_SALES_LINE-translated sales_line does. Powers BU
            # scoping for a Line/BU-restricted dashboard user, per Ahmed
            # 2026-08-15.
            bu=line_to_bu(sales_line) if sales_line else None,
            hireDate=code_to_hire.get(code).isoformat() if code_to_hire.get(code) else None,
            probationPassed=pp.isoformat() if pp else None,
            kpis=kpis,
            totalPts=total_pts,
            totalMaxPts=100,
            isPartial=any_pending,
        ))

    log(f'  Brand Manager: {len(bm_results)} scored, {len(bm_excluded)} excluded')

    write_kpi_template(dm_results, asm_results, nsm_results,
                        [(c, n, p, l) for c, n, p, l in bm_roster if any(r['code'] == c for r in bm_results)])

    # -----------------------------------------------------------------
    # 7b. Direct Manager + Direct Manager BU, every tier -- sourced from
    #     Database Shortcut.xlsx's own org-chart columns (resolve_direct_
    #     manager above), which cover every employee code including ASM/
    #     NSM -- per Ahmed 2026-08-15 ("asm and nsm name of manager and bu
    #     not present"). BU for the resolved manager prefers this cache's
    #     own canonical bu label (keeps it consistent with the rest of the
    #     dashboard, e.g. "DIAB" not Database Shortcut's raw "Diabetes"),
    #     falling back to Database Shortcut's raw Business Unit column only
    #     when the manager isn't scored anywhere in this cache (e.g. above
    #     NSM level, where there's no sprint tier to canonicalize against).
    # -----------------------------------------------------------------
    code_to_bu = {}
    for rec in results + dm_results + asm_results + nsm_results:
        if rec.get('bu'):
            code_to_bu[rec['code']] = rec['bu']

    def attach_manager_fields(rec_list):
        for rec in rec_list:
            mgr_name, mgr_code = resolve_direct_manager(rec['code'])
            mgr_bu = None
            if mgr_name:
                mgr_bu = code_to_bu.get(mgr_code)
                if not mgr_bu and mgr_code:
                    entry = code_to_orgchart.get(mgr_code)
                    if entry and entry.get('bu'):
                        mgr_bu = entry['bu']
            rec['directManager'] = mgr_name
            rec['directManagerBu'] = mgr_bu
            # Business Email -- lets the frontend match a logged-in dashboard
            # user back to their own record for the "My Performance" card.
            rec['email'] = code_to_email.get(rec['code'])

    attach_manager_fields(results)
    attach_manager_fields(dm_results)
    attach_manager_fields(asm_results)
    attach_manager_fields(nsm_results)
    attach_manager_fields(bm_results)
    log('attached Direct Manager / Direct Manager BU / email to every tier (Database Shortcut.xlsx)')

    # -----------------------------------------------------------------
    # 5b. Sick Leave Impact detail (2026-09-16) -- see build_leave_detail().
    # Purely additive: not one raw value, point, rank, badge or payout
    # above or below this block changes. It attaches the WHY behind a
    # prorated or collapsed KPI so a manager reading a zero can see the
    # leave type and dates without leaving Sprint.
    # -----------------------------------------------------------------
    leave_detail = build_leave_detail(dash, EVAL_PERIOD_NAME)
    attached_recs = attach_leave_detail(
        [results, excluded, dm_results, asm_results, nsm_results, bm_results],
        leave_detail,
        scored_kpi_tiers={'Medical Rep'},   # the only tier whose own Right Frequency is scored
    )
    # Counted over ATTACHED records, not over the raw report. The report
    # covers the whole company (Finance, Office, Field alike) -- 43 codes
    # have July leave but only some are on a Sprint tier at all, and a
    # headline of 43 on a Sprint page would invite a reconciliation that
    # can never close.
    leave_summary = {
        'period': EVAL_PERIOD_NAME,
        'reportFound': os.path.exists(LEAVE_REPORT_PATH),
        'normalMaxDays': leave_rules.SICK_LEAVE_NORMAL_MAX_DAYS,
        'moderateMaxDays': leave_rules.SICK_LEAVE_MODERATE_MAX_DAYS,
        'standardWorkingDays': leave_rules.STANDARD_MONTHLY_WORKING_DAYS,
        'onRecord': len(attached_recs),
        'prorated': sum(1 for r in attached_recs if r['leaveDetail']['showAsProrated']),
        'excludedBand': sum(1 for r in attached_recs if r['leaveDetail']['isExcludedBand']),
        'inReport': len(leave_detail),
    }
    log(f'attached Sick Leave Impact detail to {len(attached_recs)} record(s) across all tiers '
        f'({leave_summary["prorated"]} scored-as-prorated, {leave_summary["excludedBand"]} excluded-band; '
        f'{leave_summary["inReport"]} codes have {EVAL_PERIOD_NAME} leave in the report company-wide)')

    # -----------------------------------------------------------------
    # 6. Assemble + write cache.
    # -----------------------------------------------------------------
    cache = {
        'meta': {
            'schemaVersion': SCHEMA_VERSION,
            'generatedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'evalPeriod': EVAL_PERIOD_NAME,
            'periodStart': EVAL_PERIOD_START.isoformat(),
            'periodEnd': EVAL_PERIOD_END.isoformat(),
            # Sick Leave Impact Rule thresholds + this period's counts, so
            # the UI states the rule from the engine's own constants rather
            # than hard-coding "6-15 days" in a second place.
            'leaveRule': leave_summary,
            'methodology': {
                'probationRule': 'Hire day 1-15 -> ref = 1st of same month; 16-31 -> ref = 1st of next month; '
                                  'probation passes 3 months after ref. Eligible for month M if pass-date <= 1st of M.',
                'activeRule': 'Excluded if Last Day of Work (Database Shortcut.xlsx) is on/before the period end; '
                              'Status field used only when no Last Day is on file.',
                'curveSheet': 'medical rep points scheme / SALES REP',
                'chcCoverageScaling': 'CHC Sales Rep Coverage points read directly off the msr_rf_curve (medical rep points scheme sheet, cols 4-5), '
                                       'confirmed numerically identical to the deck\'s CHC Coverage table (slide 6, Max 40 pts, 60-74%->1-10, '
                                       '75-89%->11-25, 90-99%->26-39, 100%->40) at every checkpoint. Replaces the prior "x4 on SALES REP sheet '
                                       'cols 10-11" hack, which was actually a copy of the MSR 10pt Coverage curve and undersold Coverage points '
                                       'badly below 100% achievement.',
                'confirmedWithAhmed': '2026-08-19',
            },
            'tiersBuilt': ['Medical Rep', 'Sales Rep (CHC)', 'DM/DSM', 'ASM', 'NSM', 'Brand Manager'],
            'tiersPending': [],
            'pendingDataNotes': 'DM/DSM, ASM, NSM and Brand Manager are all live, but each still has KPI slots '
                                 '(Field Working Days / DV Coverage / Calls-per-DV for DM-ASM-NSM; Sales '
                                 'Achievement / Regional Coverage / Tactical Plan Execution for Brand Manager) '
                                 'sourced from zeta sprint/Sprint_Missing_KPI_Template.xlsx, filled in by Ahmed. '
                                 'Any slot still blank there shows as "pending" here, never as zero.',
            'kpiTemplatePath': 'zeta sprint/Sprint_Missing_KPI_Template.xlsx',
            # Period-filter scaffolding, per Ahmed 2026-08-15: June is the
            # Sprint's Pilot Period; July/August are the first two real
            # months; Q3 = Jul+Aug+Sep cumulative; Oct/Nov individually;
            # Total Year = Q3+Oct+Nov+Dec cumulative. Only calendar months
            # actually present in the Coverage/Sales caches can be scored
            # -- as of this build that's only 'periodsBuilt' below. The
            # frontend uses this list to show every other period option as
            # "not yet available" rather than guessing at numbers with no
            # source data behind them. Re-run this script (with
            # EVAL_PERIOD_NAME advanced) once each new month's data lands
            # in the main dashboard cache; the multi-month cumulative
            # scoring engine that sums per-month results for Q3/Total Year
            # is a follow-up build once there's real July data to validate
            # it against -- not guessed at now.
            'periodsBuilt': [EVAL_PERIOD_NAME],
            'sourceDataPeriodsAvailable': dims['periods'],
        },
        'medicalRepSalesRep': {
            'ranked': results,
            'excluded': excluded,
            'departingSoon': departing_soon,
        },
        'dmDsm': {'ranked': dm_results, 'excluded': dm_excluded},
        'asm': {'ranked': asm_results, 'excluded': asm_excluded},
        'nsm': {'ranked': nsm_results, 'excluded': nsm_excluded},
        'brandManager': {'ranked': bm_results, 'excluded': bm_excluded},
    }

    json_str = json.dumps(cache, separators=(',', ':'), ensure_ascii=False, default=str)
    gz = gzip.compress(json_str.encode('utf-8'), compresslevel=9)
    b64 = base64.b64encode(gz).decode('ascii')

    os.makedirs(CACHE_DIR, exist_ok=True)

    tmp = OUT_JSON + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(json_str)
    os.replace(tmp, OUT_JSON)

    tmp = OUT_JS + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('window.SPRINT_CACHE = {b64Data:"' + b64 + '"};\n')
    os.replace(tmp, OUT_JS)

    log(f'wrote {os.path.basename(OUT_JSON)}  {os.path.getsize(OUT_JSON) // 1024:,} KB')
    log(f'wrote {os.path.basename(OUT_JS)}  {os.path.getsize(OUT_JS) // 1024:,} KB (gzip+base64)')

    # -----------------------------------------------------------------
    # 6b. Archive this month's full snapshot + update the history index,
    #     so past months stay viewable in the Period filter after a later
    #     month's re-run overwrites sprint.json/sprint.data.js -- per
    #     Ahmed 2026-08-15 ("if I need to make months update what should
    #     be"). Archived as a `window.X = {...}` script (like every other
    #     *.data.js cache here), NOT plain JSON fetched at runtime --
    #     this dashboard is opened over file:// in production, where
    #     Chrome blocks fetch()/XHR to local files but allows
    #     <script src="local/file.js">. index.json is Python-side
    #     bookkeeping only; index.js is what the browser reads.
    # -----------------------------------------------------------------
    os.makedirs(HISTORY_DIR, exist_ok=True)
    period_key = EVAL_PERIOD_START.strftime('%Y-%m')

    archive_js = os.path.join(HISTORY_DIR, f'sprint_{period_key}.data.js')
    tmp = archive_js + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('window.SPRINT_HISTORY_CACHE = {b64Data:"' + b64 + '"};\n')
    os.replace(tmp, archive_js)

    index_json_path = os.path.join(HISTORY_DIR, 'index.json')
    manifest = []
    if os.path.exists(index_json_path):
        try:
            with open(index_json_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
        except Exception as e:
            log(f'WARNING: could not read existing history index ({e}); starting a fresh one')
            manifest = []
    manifest = [p for p in manifest if p.get('key') != period_key]
    manifest.append({
        'key': period_key,
        'name': EVAL_PERIOD_NAME,
        'file': f'cache/sprint_history/sprint_{period_key}.data.js',
        'generatedAt': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    })
    manifest.sort(key=lambda p: p['key'])

    tmp = index_json_path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
    os.replace(tmp, index_json_path)

    tmp = HISTORY_INDEX_JS + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('window.SPRINT_HISTORY_INDEX = ' + json.dumps(manifest, separators=(',', ':')) + ';\n')
    os.replace(tmp, HISTORY_INDEX_JS)

    log(f'archived {period_key} ({EVAL_PERIOD_NAME}) -> {os.path.basename(archive_js)}; '
        f'history now covers: {", ".join(p["name"] for p in manifest)}')
    log(f'Sprint cache complete in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
