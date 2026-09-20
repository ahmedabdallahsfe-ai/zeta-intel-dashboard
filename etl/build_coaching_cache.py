"""
ZETA Coaching Intelligence -- Cache Compiler Script
====================================================
Reads the joint/coached field-visit log ("Visits Details S1 DM.xlsx"),
joins it against Database Shortcut.xlsx (the same authoritative HR
active-roster / hierarchy source refresh_sales.py and build_sprint_cache.py
use) to resolve active-team rosters and confirm every name, and outputs
cache/coaching.json + cache/coaching.data.js in the same gzip+base64
"window.<NAME>_CACHE = {b64Data:...}" shape as every other cache in this
project.

Scope (confirmed 2026-08-31, period extended to YTD 2026-09-02):
  - Source file: "Visits Details S1 DM.xlsx" (filename kept as-is; the
    source now carries Feb-Jul data, no longer just S1), sheet "Total"
    only.
  - Period: Feb 1 - Jul 31 2026 (YTD, renamed 2026-09-02 from "S1" now
    that July is included -- "S1" no longer accurately describes a
    Feb-Jul range). Both monthly and YTD-cumulative aggregates are
    produced for every manager.
  - Fields used: Employee, Coach Employee 1, Title 1, Date, Team, Area,
    Customer (customer name only, used solely inside the coached-employee
    drill-down popup -- never in the main KPI tables).
  - Fields deliberately NOT used for any KPI: Duration, GPS Deviation,
    Specialty, Customer Type, Status (all rows are "Approved" anyway).
  - DV Coverage % (coached reps on the manager's own active roster /
    active roster size) is only computed for District Manager and Field
    force supervisor -- the two levels with a real "own team" concept.
    It is capped at 100% for display; reps coached who are NOT on the
    manager's own roster are counted separately as "cross-team" coaching,
    never silently folded into -- or silently dropped from -- coverage.
  - Every other coaching level (Senior District Manager, National Sales
    Manager, Area Manager, Business Unit Manager, Brand Manager, Field
    Force Trainer, Group Brand lead) gets visits / coaching days / zones
    visited, with NO coverage %% and NO target (there is no "own team"
    concept at those levels the way there is for a DM/FS).

Name matching (2026-08-31): confirmed by manual, byte-for-byte candidate
search against Database Shortcut.xlsx (NOT fuzzy/edit-distance matching --
same deliberate policy as refresh.py's SALES_NAME_ALIASES, to avoid ever
silently merging two different people). Before aliases: 754/757 reps and
162/165 coaching managers matched by norm_name() alone. After the 7
aliases below: 757/757 reps and 165/165 managers matched -- 0 unmatched.

Roster denominator fix (2026-08-31, user-reported): DV Coverage's
denominator used to be a single CURRENT active-team-size snapshot applied
to every Feb-Jun monthly bucket AND the S1 cumulative bucket alike. A
user spot-check on Shady Emeil Basta Israel ("in June is 100%" vs. the
60% shown) found the real bug: 2 of his 5 current reps were hired
2026-06-20 and 2026-07-18, so the old code was crediting his June (and
February through May) coverage against reps who, in June, either hadn't
joined yet at all or had only just joined. Fixed by making each month's
roster use Database Shortcut's Hiring date to ask "was this rep already
on the team as of this month's start" instead of "is this rep on the
team today" -- see team_as_of() and its comment below for the exact
rule (the cumulative roster is the union of all five monthly rosters --
see the sales-sheet cross-check note further down for why it's a full
union and not just the last month). This is a
real recomputation, not a display tweak: cache/coaching.json's monthly
and cumulative dvCoveragePct/dvCoverageRawPct values changed for any
manager whose team grew during S1, and each metrics object now also
carries its own activeTeamSize (the denominator actually used for that
period) -- js/coaching.js's aggregate KPI math was updated to sum that
field per period instead of the manager's top-level (current-snapshot)
activeTeamCount, so the Executive-row aggregate stays consistent with
the per-manager numbers.

Sales-sheet cross-check follow-up (2026-08-31, same day): the Hiring-
date fix above only catches JOINERS -- it is blind to reps who LEFT
during S1, since Database Shortcut's Status=="Active" filter drops them
from active_direct_reports entirely, for every month, not just the ones
after they left. Caught by re-checking Shady's team against
cache/sales.json (built by refresh_sales.py from this project's
authoritative sales actuals): Karim Lotfy Menesy AbdelSalam recorded
real DIAB-I sales under Shady in Feb/Mar/Apr but is no longer
Status=="Active" today, so he was silently missing from all three
months' rosters, not just May/Jun when he'd genuinely left. Fixed by
UNION'ing team_as_of()'s Hiring-date roster with cache/sales.json's own
per-month rep-under-manager sales records (see the comment above
manager_month_teams below) -- names resolved through the same
hr_by_norm identity as everywhere else, never fuzzy-matched.

Coached / Not Coached name breakdown (2026-08-31, user-requested): every
DV Coverage metrics object (each of the 5 monthly buckets, plus the S1
cumulative one) now also carries coachedNames/notCoachedNames -- the
period's roster split by whether that rep actually received a coaching
visit that period. This is the name-level detail behind the coverage %,
for the UI's "click a DV Coverage cell to see who was/wasn't coached"
popup. Computed from data already on hand (the period's roster names vs.
buckets_by_key[bkey]["onRoster"]), not re-derived from the visit log, so
a roster member with zero visits still shows up in notCoachedNames.
  2026-09-01 follow-up (user-requested: "add here hiring or resigned
  date when it according to rule and add position"): each entry in
  coachedNames/notCoachedNames is now an object -- {name, position,
  note} -- not a bare string. position is the same human territory
  label shown on the Coached Employees table (hr_name_to_position,
  falling back to Database Shortcut's own raw HR position field). note
  is "Hired <date>" / "Resigned <date>", populated ONLY when that date
  falls inside the exact period this popup is showing -- i.e. only
  when the half-month roster rule actually had that date in play for
  this specific month (or the full S1 range for the cumulative popup),
  not a stale hire/resignation from a different period. See
  roster_name_detail() below.

Half-month roster refinement (2026-08-31, user-requested): the monthly
roster's Hiring-date cutoff was a hard "on or before month start" test --
a rep hired on the 3rd of a month didn't count for that month at all,
even though they worked its other ~27 days. Now a rep hired in a
month's first half (day <= 15) counts for that month; hired in the
second half, they still don't count until the following month.
Symmetrically -- and this is new -- a departed rep now counts for their
departure month if Database Shortcut's own "Last Day of Work" falls in
that month's second half, but not if it falls in the first half. This
reads Last Day of Work directly for every HR-linked employee (not just
those still Status=="Active"), which is a more exact signal for
departures than the sales-sheet cross-check's "had any sales that
month" proxy -- see team_as_of_month()/active_in_month() below for the
exact rule, and the "Half-month refinement" comment above them for a
worked example (Karim Lotfy Menesy AbdelSalam under Shady Emeil Basta
Israel). The sales cross-check stays in place as a safety net for gaps
this HR-based logic can't see (e.g. a stale Direct-Manager link).

Coach-side gate (2026-08-31, same day, user-reported): the refinement
above only ever asked whether a REP was active a given month under
their coach -- nothing checked whether the COACH THEMSELVES was even
employed that month. Found via a user spot-check on Michael Adel
AbdelMassih Awad (Last Day of Work 2026-02-06): he showed an 8-person
roster and 0% DV Coverage for March AND April, a month and two months
after he'd left -- caused by cache/sales.json still listing 8 reps
under his DM code in those months (their real, HR-correct manager by
then was Aml ElKahlawy Awad AbdelBary; the sales system's territory
assignment just hadn't caught up). Fixed by applying the exact same
active_in_month() half-month rule to the coach's own Hiring date/Last
Day of Work before computing their roster for a month at all -- see the
comment above the manager_month_teams loop below.

Currently-active manager flag (2026-08-31, same day, user-requested):
the fix above corrects a departed coach's PER-PERIOD numbers, but a
manager who has since left the company could still contribute real
historical visits/days to the company-wide AGGREGATE (Executive KPI
row / ranked-table totals) for periods they were genuinely present for
-- including S1 Cumulative. Each manager record now carries
currentlyActive (Database Shortcut's current Status snapshot), which
js/coaching.js's aggregateOwnTier() uses to exclude such a manager
entirely from every aggregate total, for every period -- their own
Manager Profile drawer is unaffected and still shows their accurate
individual history.

Usage:  python etl/build_coaching_cache.py
"""

import os
import sys
import json
import gzip
import base64
import calendar
import datetime
from collections import defaultdict, Counter

import openpyxl

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The SFE Sick Leave Impact Rule lives in ONE place for the whole platform --
# refresh.py (Coverage/Right Frequency) and this ETL both import it, so the
# two engines cannot drift to different definitions of "absent this month".
# See leave_rules.py's header before changing any threshold.
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)
import leave_rules  # noqa: E402  (path must be set first)

SOURCE_VISITS = os.path.join(ROOT_DIR, "Visits Details S1 DM.xlsx")
SOURCE_HR = os.path.join(ROOT_DIR, "Database Shortcut.xlsx")
SOURCE_LEAVE = os.path.join(ROOT_DIR, leave_rules.LEAVE_REPORT_FILENAME)
OUTPUT_JSON = os.path.join(ROOT_DIR, "cache", "coaching.json")
OUTPUT_JS = os.path.join(ROOT_DIR, "cache", "coaching.data.js")
JS_VAR_NAME = "COACHING_CACHE"

PERIOD_START = datetime.date(2026, 2, 1)
PERIOD_END = datetime.date(2026, 8, 31)
MONTHS = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]

# 2026-08-31 (user-set): DV Coverage target raised from 75% to 100% --
# full roster coverage is the actual bar, not 3-in-4. This single
# constant drives every "ON TARGET"/"BELOW TARGET" badge, the Monthly
# Trend reference line, and every "+X pp vs target" figure in the UI --
# nothing else needs to change, js/coaching.js always reads the target
# from data.targets.dvCoveragePct rather than hardcoding 75.
TARGET_DV_COVERAGE_PCT = 100
TARGET_AVG_VISITS_PER_DAY = 7

# Levels with a real "own active team" -> get DV Coverage %.
# 2026-09-08, Ahmed ("senior district manager include with district
# manager and ffs performance not within Other Coaching Levels"):
# Senior District Manager added. It was excluded from v1 through
# 2026-09-03 as one of the "no real own team" levels (see js/
# coaching.js's DATA SOURCE/SCOPE header, since updated) -- but all 3
# current Senior District Managers (Karim Mohamed Nagib Mohamed
# Eldemerdash, Mohamed Rezk Aly Nour, Ahmed Fathy Ahmed Hamed Nada) DO
# have a real active_direct_reports roster (2, 7 and 7 reps respectively,
# each with real S1 visit history) -- verified before this change, not
# assumed. They now get a computed DV Coverage % / target exactly like
# District Manager and Field force supervisor, move into the main
# ranked table (js/coaching.js OWN_ONLY_TITLES, kept in lockstep with
# this set), and drop out of Other Coaching Levels.
COVERAGE_TITLES = {"District Manager", "Field force supervisor", "Senior District Manager"}

# Confirmed manual aliases (visits-file spelling -> Database Shortcut
# spelling). Verified 2026-08-31 by candidate search against Database
# Shortcut.xlsx -- each is unambiguously the same person (identical
# given+family name structure, differing only by transliteration:
# hyphenation, spacing, or a single Arabic-to-English letter variant).
# Deliberately NOT fuzzy matching -- see build_sprint_cache.py's
# SALES_NAME_ALIASES for why (same policy, same risk being avoided).
COACHING_NAME_ALIASES = {
    "DOAA EL-SAIED YOUSSEF ABU EL-MAATY": "DOAA ELSAIED YOUSSEF ABUELMAATY",
    "MARYAN HANY KAMAL MESEHA": "MARIAN HANY KAMAL MESEHA",
    "YOUSSEF MAGED HAROUN SAIF": "YOUSSEF MAGED HAROUN SEIF",
    "HASSAN MOHAMED MOKHTAR GAB ALLAH": "HASSAN MOHAMED MOKHTAR GABALLAH",
    "MAHMOUD HASSAN ABDELRAOUF MOHAMED EL-BADAWY": "MAHMOUD HASSAN ABDELRAOUF MOHAMED ELBADAWY",
    "YASMIN ALY MOURSY ISMAIL MOURSY": "YASMIN ALY MOURSY ESMAIL MOURSY",
    "BESHOY BALAMON FELBS TADRES": "BESHOY BALAMON FELBS TADROS",
    "LAMIAA SAMIR KHALIL ABDEL RAHMAN": "LAMIAA SAMIR KHALIL ABDELRAHMAN",
    "LAMIAA SAMIR KHALIL ABD EL RAHMAN ZAGHDAN": "LAMIAA SAMIR KHALIL ABDELRAHMAN",
}


def norm_name(s):
    if s is None:
        return ""
    n = str(s).upper().replace(chr(160), " ").strip()
    n = " ".join(n.split())
    return COACHING_NAME_ALIASES.get(n, n)


# Database Shortcut's own "Line" column is inconsistently keyed --
# confirmed 2026-08-31 by dumping every distinct value in the sheet:
# trailing-space duplicates ("Diabetes I " vs "Diabetes I", "GIT II  "
# vs "GIT II " vs "GIT II"), which trimming + collapsing whitespace
# fixes generically -- and, flagged directly by the user, "Pedia/Gyn"
# and a stray lowercase "pedia" both being used for what is really just
# the Pedia line, which needs an explicit rename since it isn't a
# whitespace/case artifact trimming alone would catch (Pedia/Gyn reads
# as a different, real line name unless you already know it isn't).
# Applied once at hr_by_norm construction time (the single source of
# truth every manager/rep "line" field reads from), not re-applied ad
# hoc at each call site.
LINE_RENAMES = {"PEDIA/GYN": "Pedia", "PEDIA": "Pedia"}


def norm_line(raw):
    if raw is None:
        return None
    trimmed = " ".join(str(raw).split())
    if not trimmed:
        return None
    return LINE_RENAMES.get(trimmed.upper(), trimmed)


# CHC_SALES split (2026-09-01, user-reported: "CHC_Sales check this line i
# cannt see" -- confirmed root cause, fix approved by the user via
# clarifying question). Database Shortcut's own "Line" column is never
# granular enough to separate CHC's two genuinely distinct teams -- every
# CHC-BU record says Line="CHC" whether the person is on the Medical/
# Doctor-facing channel or the Pharmacy-facing Sales channel (verified:
# 0/92 CHC-line rows ever say "CHC_SALES"), even though the rest of this
# platform already treats "CHC_SALES" as a distinct, well-established
# line that must never be merged with plain "CHC" (see js/semantic-
# model.js's BU_ROLLUP_EXCLUDED_LINES / LINE_ALIASES and its comment
# about a past bug that inflated CHC's own numbers +43.8% by summing the
# two). Coaching Intelligence's ETL sourced "line" purely from that flat
# HR column, so CHC_SALES could never appear in the BU/Line filter or any
# BU/Line column here -- both teams' managers and reps (confirmed: e.g.
# Mahmoud Mohamed ElSayed AbdelMoula and Rimon Shohdy Makeen Gabriel, both
# coaching District Managers, both HR Position "Sales Supervisor") were
# silently shown as plain "CHC".
#
# Fix: within the CHC BU only, re-derive the effective line from HR's own
# "Position (English)" field -- the one field that actually separates the
# two channels. CHC_SALES_POSITIONS are confirmed Sales-channel titles;
# everything else (the Medical channel's own titles, plus the BU-wide/
# cross-channel roles that oversee both teams together -- National Sales
# Manager, Business Unit Manager, Brand Manager, Area Sales Manager --
# none of which is itself Sales-channel-only) stays plain "CHC". Applies
# ONLY within CHC -- every other BU's line is left exactly as Database
# Shortcut states it, since this Medical/Sales channel split is CHC's own
# and does not exist elsewhere in the org.
CHC_SALES_POSITIONS = {"SALES REPRESENTATIVE", "SALES SUPERVISOR", "DISTRICT SALES MANAGER"}


def resolve_chc_line(bu, line, position):
    if bu != "CHC" or line != "CHC":
        return line
    pos_upper = (str(position).strip().upper()) if position is not None else ""
    if pos_upper in CHC_SALES_POSITIONS:
        return "CHC_SALES"
    return line


def safe_date(v):
    """Hiring date / Last Day of Work cells are expected to be real dates,
    but a blank cell is read back by openpyxl as a bare datetime.time(0,0)
    rather than None -- the same Excel quirk already fixed for Status
    (see safe_str's malformed-Status note). A bare time object has no
    date component (hasattr(time_obj, 'date') is actually False, so the
    old `hire_raw.date() if hasattr(hire_raw, 'date') else hire_raw` line
    silently left the raw time object in place instead of catching it --
    harmless for currently-Active reps, whose Hiring date is always a
    real date in this sheet, but a live TypeError-in-waiting once
    2026-08-31's day-precise roster logic below started reading Hiring
    date AND Last Day of Work for every employee, active or not: 54 rows
    have a bare-time Hiring date and 1263 have a bare-time Last Day of
    Work (i.e. every employee who hasn't left)). Coerced to None here --
    treated as "no date on file", exactly like a genuinely blank cell,
    never as a crash or as a fabricated date."""
    if v is None:
        return None
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    return None


def safe_str(v):
    """CustomerName/Area cells are expected to be plain text, but a
    handful of source rows have them mis-typed as Excel date/time values
    (a data-entry artifact, not something this ETL should paper over
    silently) -- found 2026-08-31 when the per-visit log below tried to
    JSON-serialize a raw datetime.time object and crashed the whole
    build. isoformat() for date/time/datetime keeps the value visible
    (rather than dropping it) so a real data issue stays discoverable
    instead of disappearing into an empty string."""
    if v is None:
        return ""
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


def is_blank_lookup_status(v):
    """Database Shortcut's Status column is a VLOOKUP into upstream HR
    workbooks. When the upstream Status cell is EMPTY the lookup returns 0,
    which Excel stores as a time value (00:00) -- not the text 'Active' /
    'Inactive'. Found 2026-09-20 on Hanan Atef Magdy Abdelmessih (code 556,
    the ONLY real employee with this defect), whose blank Status made every
    downstream rule read her as 'resigned'. A blank lookup is NOT evidence
    of departure: callers treat it as unknown (= active, same principle as
    a missing HR match) and log a data-quality warning. Only applied when
    there is also no Last Day of Work on file."""
    return isinstance(v, datetime.time) or (isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0)


def safe_position(v):
    """Database Shortcut's "Position (English)" column is never blank
    (verified 2026-09-01: 0/2466 rows), but 393 rows carry leading/
    trailing whitespace ("Sales Representative " etc.) -- strip it so
    the roster popup and Coached Employees table never render an
    invisible-looking gap after a rep's territory/title. Returns None
    (not "") for a genuinely blank/whitespace-only cell, so callers can
    `or`-fall-through to another source exactly like every other
    optional field in this file."""
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def log(msg):
    print(f"  {msg}", flush=True)


def month_key(d):
    return d.strftime("%Y-%m")


def new_bucket():
    return {"visits": 0, "days": set(), "onRoster": set(), "offRoster": set(), "areas": set()}


def new_emp_bucket():
    return {"visits": 0, "days": set()}


def bucket_to_metrics(b, active_team_size, is_coverage_title):
    visits = b["visits"]
    days = len(b["days"])
    avg_per_day = round(visits / days, 2) if days else 0.0
    on_roster = len(b["onRoster"])
    off_roster = len(b["offRoster"])
    zones = len(b["areas"])
    out = {
        "visits": visits,
        "coachingDays": days,
        "avgVisitsPerDay": avg_per_day,
        "avgVsTargetPct": round(100 * avg_per_day / TARGET_AVG_VISITS_PER_DAY, 1) if TARGET_AVG_VISITS_PER_DAY else None,
        "coachedOnRoster": on_roster,
        "coachedOffRoster": off_roster,
        "zones": zones,
    }
    if is_coverage_title:
        # The team size actually used as this bucket's denominator (time-
        # aware for monthly buckets, see team_as_of() above) -- distinct
        # from the manager's top-level activeTeamCount/activeTeam, which
        # stay a CURRENT-roster snapshot for display purposes only. The
        # UI's aggregate (Executive KPI row / trend) math must sum THIS
        # field per period, never the top-level activeTeamCount, or it
        # would silently reintroduce the same back-dating bug at the
        # aggregate level.
        out["activeTeamSize"] = active_team_size
        if active_team_size:
            raw_cov = 100 * on_roster / active_team_size
            out["dvCoveragePct"] = round(min(raw_cov, 100.0), 1)
            out["dvCoverageRawPct"] = round(raw_cov, 1)  # uncapped, for transparency
        else:
            out["dvCoveragePct"] = None
            out["dvCoverageRawPct"] = None
    return out


def main():
    print("\n[1/5] Loading Database Shortcut.xlsx (authoritative HR active roster)...", flush=True)
    if not os.path.exists(SOURCE_HR):
        print(f"ERROR: {SOURCE_HR} not found.")
        sys.exit(1)
    wb_hr = openpyxl.load_workbook(SOURCE_HR, read_only=True, data_only=True)
    ws_hr = wb_hr["Sheet1"]
    hdr = [c.value for c in next(ws_hr.iter_rows(min_row=1, max_row=1))]
    hi = {h: i for i, h in enumerate(hdr)}
    hr_rows = list(ws_hr.iter_rows(min_row=2, values_only=True))

    # ---- Direct-Manager resolution (2026-09-20, shadow-tested) ----
    # Root cause of "PENDING / No active team" for managers such as code 166
    # Mohamed Thabet Elsayed Esmail: the ETL keyed a rep's manager on the
    # TEXT of "Name of Direct Manager", and HR spells the same manager
    # several ways ("El Sayed Esmail", "El-Sayed Ismail", "V. ...",
    # "Vacant ...") so the rep never linked to the manager's own record.
    # Rule (additive only -- never overrides an existing match):
    #   1. If the Direct Manager text already resolves to an HR employee
    #      name (after COACHING_NAME_ALIASES) -> use it, EXACTLY as before.
    #   2. ONLY otherwise, if "Emp. Code of Direct Manager" is a real code
    #      that belongs to an HR employee -> use that employee's name.
    #   3. Else keep the text, as before.
    # A code that points to a DIFFERENT person than a resolvable name is a
    # data conflict: keep the name (old behaviour) and log it.
    _hr_names = set()
    _code2norm = {}
    for _r in hr_rows:
        _nm = _r[hi["Employee Name (English)"]]
        if _nm is None:
            continue
        _hr_names.add(norm_name(_nm))
        _c = _r[hi["Code"]]
        if _c not in (None, "", 0):
            _code2norm[_c] = norm_name(_nm)
    dq_status_assumed = []  # (code, name) rows whose Status was a blank lookup -> assumed Active
    dm_rescued = []     # (report, dm text, resolved-by-code manager)
    dm_conflicts = []   # (report, dm text, code, code-holder)
    def resolve_dm_key(dm_text, dm_code, report_name):
        name_key = norm_name(dm_text) if dm_text else ""
        code_key = _code2norm.get(dm_code) if dm_code not in (None, "", 0) else None
        if name_key and name_key in _hr_names:
            if code_key and code_key != name_key:
                dm_conflicts.append((report_name, dm_text, dm_code, code_key))
            return name_key
        if code_key:
            dm_rescued.append((report_name, dm_text, code_key))
            return code_key
        return name_key

    hr_by_norm = {}
    active_direct_reports = defaultdict(set)  # norm(Direct Manager) -> {employee names}, CURRENT status=="Active" only -- display/legacy use, see below
    all_direct_reports = defaultdict(set)     # norm(Direct Manager) -> {employee names}, EVERY status -- feeds the day-precise monthly roster (team_as_of_month)
    for r in hr_rows:
        name = r[hi["Employee Name (English)"]]
        if name is None:
            continue
        status = r[hi["Status"]]
        dm = r[hi["Name of Direct Manager"]]
        hire_date = safe_date(r[hi["Hiring date"]])
        last_day_of_work = safe_date(r[hi["Last Day of Work"]])
        if is_blank_lookup_status(status) and last_day_of_work is None:
            dq_status_assumed.append((r[hi["Code"]], name))
            status = "Active"  # unknown != resigned -- see is_blank_lookup_status()
        n = norm_name(name)
        raw_bu = r[hi["Business Unit"]]
        raw_position = r[hi["Position (English)"]]
        hr_by_norm[n] = {
            "name": name,
            "code": r[hi["Code"]],
            "status": status,
            # CHC_SALES split, see resolve_chc_line()'s comment above.
            "line": resolve_chc_line(raw_bu, norm_line(r[hi["Line"]]), raw_position),
            "bu": raw_bu,
            "position": safe_position(raw_position),
            "directManager": dm,
            "dmKey": None,  # filled just below
            "hireDate": hire_date,
            "lastDayOfWork": last_day_of_work,
        }
        _dm_key = resolve_dm_key(dm, r[hi["Emp. Code of Direct Manager"]], name)
        hr_by_norm[n]["dmKey"] = _dm_key
        if dm or _dm_key:
            all_direct_reports[_dm_key].add(name)
            if status == "Active":
                active_direct_reports[_dm_key].add(name)
    log(f"Direct-Manager code fallback: {len(dm_rescued)} report rows rescued by manager code, "
        f"{len(dm_conflicts)} name-vs-code conflicts (kept name)")
    # Data-quality warning for the refresh log: HR's Direct Manager TEXT does not
    # match the manager's own HR name. Harmless now (rescued by code) but HR
    # should standardise the spelling. Full list: HR_DirectManager_Name_Mismatches_*.csv
    _variants = {}
    for _rep, _txt, _mgr in dm_rescued:
        _variants.setdefault(_mgr, set()).add(str(_txt))
    log(f"WARNING (HR data quality): {len(_variants)} managers are spelled differently in "
        f"'Name of Direct Manager' than in their own HR record -- linked by manager code.")
    for _rep, _txt, _code, _holder in dm_conflicts:
        log(f"WARNING (HR conflict): report '{_rep}' lists Direct Manager text '{_txt}' "
            f"but manager code {_code} belongs to '{_holder}' -- kept the NAME match; please review in HR.")
    for _c, _n in dq_status_assumed:
        log(f"WARNING (HR data quality): Status for code {_c} '{_n}' is a blank lookup "
            f"(upstream HR workbook has no Status) -- treated as Active, NOT resigned. Please fill it in HR.")
    log(f"HR master rows: {len(hr_rows)} | unique normalized names: {len(hr_by_norm)}")

    # ---- Per-manager, per-month "team as of the start of that month" ----
    # WHY (bug found 2026-08-31, reported by a user spot-check on Shady
    # Emeil Basta Israel's DV Coverage): active_direct_reports above is a
    # single CURRENT snapshot (status == "Active" as of whenever Database
    # Shortcut.xlsx was last exported). Using it unmodified as the
    # denominator for every Feb-Jun monthly bucket silently back-dates
    # today's team onto earlier months. Concretely: 2 of Shady's 5 current
    # reps were hired 2026-06-20 and 2026-07-18 (mid-June and after S1
    # ended entirely) -- yet the old code counted both against his
    # February through June coverage, capping every month at 3-on-roster
    # / 5-team = 60% even though he had actually coached 100% of the reps
    # who were genuinely his team at the time (3 of 3) in Feb, Mar, Apr
    # and Jun.
    #
    # Fix (original, 2026-08-31): a rep counts toward a given month's
    # roster only if their Hiring date is on or before that month's first
    # day. A rep with no recorded hire date is always counted (missing
    # data must never silently shrink a manager's coverage credit). By
    # itself this still does not model historical departures -- Database
    # Shortcut is a current-status snapshot, so someone who resigned
    # before today would be invisible here exactly as before this fix --
    # but see the sales-sheet cross-check further down, which closes that
    # gap by union'ing in cache/sales.json's own per-month rep-under-
    # manager records. Because of that cross-check, a manager's
    # month-to-month roster can both grow AND shrink across S1, so the S1
    # cumulative roster is computed as the union of all five monthly
    # rosters, not assumed to equal any single month's (see
    # cumulative_team_size below for why that assumption broke once
    # departures were added).
    #
    # Half-month refinement (2026-08-31, same day, user-requested): the
    # fix above is a hard cutoff at each month's FIRST day -- a rep hired
    # on, say, the 3rd of a month was excluded from that whole month even
    # though they worked 27-28 of its ~30 days. The user asked for a
    # fairer rule: a rep hired in the first half of a month (day <= 15)
    # counts for that month (they worked its majority); hired in the
    # second half (day 16+) still doesn't count until the following
    # month, unchanged from before. Symmetrically, a rep who resigned
    # counts for their departure month if their Last Day of Work falls in
    # that month's second half (day >= 15 -- they worked its majority)
    # but NOT if it falls in the first half (day < 15). This directly
    # replaces the old status-snapshot blind spot for departures too:
    # Database Shortcut's own "Last Day of Work" column (previously
    # unused by this ETL) gives an exact date rather than the sales-sheet
    # cross-check's coarser "had any sales that calendar month" proxy --
    # e.g. Karim Lotfy Menesy AbdelSalam (Shady Emeil Basta Israel's
    # team) has Last Day of Work 2026-04-04: under the sales-only proxy
    # he still counted toward Shady's April roster (he had April sales
    # before leaving), but under this day-15 rule he correctly drops out
    # of April (left on the 4th, well before the month's midpoint) while
    # still correctly counting for Feb and Mar in full.
    #
    # This roster logic now needs EVERY employee's HR record, not just
    # those currently Status=="Active" (all_direct_reports, built above,
    # vs. active_direct_reports which stays a current-snapshot for
    # display purposes only -- see activeTeamCount/activeTeam below) --
    # otherwise a rep who has since left would never be evaluated against
    # their actual Hiring date / Last Day of Work at all, the exact gap
    # the sales cross-check (still kept below, as an extra safety net for
    # DM-link/data gaps this HR-based logic can't see) was built to
    # patch.
    MONTH_START = {m: datetime.date(int(m[:4]), int(m[5:7]), 1) for m in MONTHS}
    MONTH_END = {
        m: datetime.date(int(m[:4]), int(m[5:7]), calendar.monthrange(int(m[:4]), int(m[5:7]))[1])
        for m in MONTHS
    }

    def active_in_month(hire_date, last_day_of_work, month_start, month_end):
        """True if a rep with these dates counts toward the roster for
        the month spanning [month_start, month_end] -- see the
        "Half-month refinement" comment above for the exact rule. None
        for either date means no evidence of a late start / early exit
        that month, so it never excludes on its own."""
        if hire_date is not None:
            if hire_date > month_end:
                return False  # not yet hired this month at all
            if hire_date > month_start and hire_date.day > 15:
                return False  # hired this month, but in its second half
        if last_day_of_work is not None:
            if last_day_of_work < month_start:
                return False  # already gone before this month started
            if last_day_of_work <= month_end and last_day_of_work.day < 15:
                return False  # left this month, but in its first half
        return True

    def team_as_of_month(coach_norm, m):
        """Returns (included, hard_excluded_norm) for this coach/month.
        hard_excluded_norm is the set of norm-names EXPLICITLY excluded
        by active_in_month() above -- i.e. HR itself has a dated Hiring
        date / Last Day of Work fact that answers "on roster this month?"
        for this specific person. This is threaded through to the
        sales-cross-check union below on purpose: a precise, dated HR
        fact (e.g. "left 2026-04-04") must win over the sales sheet's
        coarser "had any sales that calendar month" signal, or the fix
        above is silently undone the moment someone with real sales data
        also has a hard HR exclusion -- exactly Karim Lotfy Menesy
        AbdelSalam's case (Last Day of Work 2026-04-04, but still shows
        April sales recorded before he left). A name NOT in
        all_direct_reports[coach_norm] at all (no HR record links them
        to this coach) is untouched by this -- that's the sales
        cross-check's other, still-intact job: catching people HR's own
        Direct-Manager link misses entirely."""
        out = set()
        hard_excluded_norm = set()
        month_start, month_end = MONTH_START[m], MONTH_END[m]
        for nm in all_direct_reports.get(coach_norm, set()):
            hr = hr_by_norm.get(norm_name(nm), {})
            if active_in_month(hr.get("hireDate"), hr.get("lastDayOfWork"), month_start, month_end):
                out.add(nm)
            else:
                hard_excluded_norm.add(norm_name(nm))
        return out, hard_excluded_norm

    # ---- Sales-sheet cross-check / supplement for monthly rosters ----
    # WHY: team_as_of() above (Hiring date vs. month start) correctly
    # excludes reps who joined AFTER a given month, but it is blind to
    # reps who LEFT before today -- Database Shortcut's Status=="Active"
    # filter drops them from active_direct_reports entirely, so a rep who
    # was genuinely on a manager's team for the first months of S1 and
    # then resigned is invisible to EVERY month's roster, not just the
    # months after they left. Found 2026-08-31 via a user spot-check:
    # cache/sales.json (built by etl/refresh_sales.py from this project's
    # authoritative sales actuals -- Q1_Sales.xlsx, Q2_Sales.xlsx,
    # june.xlsx; see refresh_sales.py's own header for the full source
    # list) shows Karim Lotfy Menesy AbdelSalam recording real DIAB-I
    # sales under Shady Emeil Basta Israel's territory in Feb, Mar AND
    # Apr -- but Karim's current Database Shortcut Status is no longer
    # "Active", so team_as_of() silently dropped him from all three
    # months, not just the ones after he actually left.
    #
    # Fix: a rep also counts toward a given month's roster if the sales
    # sheet recorded real production for them, that month, under that
    # manager -- UNION'd with the Hiring-date test above, never replacing
    # it (a brand-new hire can be on the roster before their first sale
    # closes). This is read from cache/sales.json rather than the raw
    # multi-hundred-MB source workbooks directly -- refresh_sales.py has
    # already validated and reconciled that cache from the exact same
    # sheets, so re-parsing them here would just re-derive the same
    # numbers slower. Names are matched through the exact same
    # hr_by_norm identity used everywhere else in this script (never
    # fuzzy, see COACHING_NAME_ALIASES) -- a sales-sheet name that
    # doesn't resolve to a known HR employee (an open "Vacant ..."
    # territory placeholder, an "Unknown_..." bucket, a stray
    # house-account label, or a genuinely unmatched spelling) contributes
    # nothing, rather than ever being merged in as if it were a person.
    # Missing/unreadable sales.json degrades gracefully to Hiring-date-
    # only rosters (this project's existing, already-shipped behavior),
    # not a hard failure.
    sales_month_reps = defaultdict(lambda: defaultdict(set))  # coach_norm -> {month: {HR-canonical names}}
    # HR-canonical rep name -> sales-sheet "position" (Line + territory,
    # e.g. "DIAB-I ASSUIT") -- this is the only place in the project's
    # data that carries a human territory label per rep (Database
    # Shortcut's own "Assigment Code" field is a code like
    # "ZE-SA-D1-0008", not a readable territory). Populated alongside
    # the roster cross-check below, from the same source, using the same
    # name resolution -- surfaced on the Coached Employees table so a
    # rep reads as e.g. "PEDIA NASR CITY" instead of just a bare name.
    # NOTE: only covers a rep who appears in cache/sales.json's own rep
    # list -- every lookup site (coached_employees below, and
    # roster_name_detail() further down) falls back to Database
    # Shortcut's own raw HR "Position (English)" field (a plain job
    # title, e.g. "Sales Representative" -- never actually blank, see
    # safe_position()'s docstring) when this dict has no entry, so a
    # rep with zero sales records this S1 still shows a position rather
    # than a bare "--".
    hr_name_to_position = {}
    sales_path = os.path.join(ROOT_DIR, "cache", "sales.json")
    if os.path.exists(sales_path):
        try:
            with open(sales_path, "r", encoding="utf-8") as f:
                sales = json.load(f)
            s_months = sales["lookups"]["months"]
            s_reps = sales["lookups"]["reps"]
            s_dms = sales["lookups"]["dms"]
            s_positions = sales["lookups"]["rep_positions"]

            def resolve_hr_name(raw_name):
                n = norm_name(raw_name[:-4] if raw_name.endswith("_Rep") else raw_name)
                hr = hr_by_norm.get(n)
                return hr["name"] if hr else None

            dm_idx_to_coach_norm = {}
            for i, raw in enumerate(s_dms):
                resolved = resolve_hr_name(raw)
                if resolved:
                    dm_idx_to_coach_norm[i] = norm_name(resolved)

            rep_idx_to_hr_name = {}
            for i, raw in enumerate(s_reps):
                resolved = resolve_hr_name(raw)
                if resolved:
                    rep_idx_to_hr_name[i] = resolved
                    pos = safe_position(s_positions[i]) if i < len(s_positions) else None
                    if pos:
                        hr_name_to_position[resolved] = pos

            month_set = set(MONTHS)
            cells_added = 0
            for row in sales["rows"]:
                m = s_months[row[0]]
                if m not in month_set:
                    continue
                coach_n = dm_idx_to_coach_norm.get(row[5])
                rep_n = rep_idx_to_hr_name.get(row[4])
                if coach_n and rep_n:
                    before = len(sales_month_reps[coach_n][m])
                    sales_month_reps[coach_n][m].add(rep_n)
                    if len(sales_month_reps[coach_n][m]) > before:
                        cells_added += 1
            log(f"sales roster cross-check: {os.path.basename(sales_path)} contributed "
                f"{cells_added} manager/rep/month roster entries across "
                f"{len(sales_month_reps)} managers")
        except Exception as e:
            log(f"WARNING: could not read/parse {sales_path} ({e}) -- "
                f"monthly rosters fall back to Hiring date alone for this run.")
    else:
        log(f"WARNING: {sales_path} not found -- monthly rosters fall back to "
            f"Hiring date alone for this run.")

    manager_month_teams = {}       # coach_norm -> {month: {names}}
    manager_month_teams_norm = {}  # coach_norm -> {month: {norm names}}
    # coach_norm -> {month: [names]} of reps dropped from the DV Coverage
    # denominator by the Sick Leave Impact Rule. Surfaced per month in the
    # output so a shrunken denominator is always explainable on screen --
    # a coverage % that silently moves is worse than one that is wrong.
    leave_absent_by_coach_month = defaultdict(dict)

    # Month key ("2026-07") -> canonical month name ("July"), which is how
    # the leave report keys its buckets.
    month_names = {m: leave_rules.month_key_to_name(m) for m in MONTHS}

    leave_report = leave_rules.load_leave_report(SOURCE_LEAVE)
    if leave_report.get("found"):
        log("  Sick Leave report loaded: %d rows, %d rep-month sick buckets, %d maternity"
            % (leave_report["rowsRead"], len(leave_report["sickDays"]), len(leave_report["maternity"])))
    else:
        log("  NOTE: %s not found -- DV Coverage denominators will not be leave-adjusted."
            % leave_rules.LEAVE_REPORT_FILENAME)
    # Iterate all_direct_reports (every HR-linked coach, any status) union
    # sales_month_reps -- NOT active_direct_reports -- so a coach whose
    # entire historical team has since left (so they have zero CURRENT
    # active reports) still gets a correct month-by-month roster instead
    # of being silently skipped here before team_as_of_month() ever runs.
    #
    # Coach-side half-month gate (2026-08-31, user-reported: Michael Adel
    # AbdelMassih Awad showing an 8-person roster, 0% DV Coverage, for
    # March AND April -- months entirely AFTER his own Last Day of Work,
    # 2026-02-06). Root cause: everything above (team_as_of_month, the
    # sales cross-check) only ever asks "was this REP active this month
    # under this coach" -- nothing checked whether the COACH himself was
    # even employed that month. Michael's HR-linked direct reports are
    # correctly empty (Layer 1 = 0 in every month), but cache/sales.json
    # still listed 8 reps under his DM code for March/April specifically
    # -- a stale territory-to-manager assignment in the sales system that
    # hadn't been corrected to their real (and HR-correct) manager, Aml
    # ElKahlawy Awad AbdelBary, yet. Fix: apply the exact same
    # active_in_month() half-month rule to the COACH's own hireDate/
    # lastDayOfWork before computing either roster layer for a given
    # month -- a manager who wasn't actively employed that month (by the
    # same rule used for reps) cannot have ANYONE counted against them
    # that month, regardless of what either layer would otherwise
    # compute, since there is no one there to have coached. A coach with
    # no HR record at all (hr_by_norm lookup misses) is never gated by
    # this -- missing data must never silently shrink coverage credit,
    # same principle as everywhere else in this file.
    for coach_norm in set(all_direct_reports) | set(sales_month_reps):
        coach_hr = hr_by_norm.get(coach_norm, {})
        per_month = {}
        for m in MONTHS:
            month_start, month_end = MONTH_START[m], MONTH_END[m]
            if not active_in_month(coach_hr.get("hireDate"), coach_hr.get("lastDayOfWork"), month_start, month_end):
                per_month[m] = set()
                continue
            hire_based, hard_excluded_norm = team_as_of_month(coach_norm, m)
            sales_based_raw = sales_month_reps.get(coach_norm, {}).get(m, set())
            # A precise HR hard-exclusion for THIS person/month wins over
            # the sales cross-check's coarser monthly signal -- see
            # team_as_of_month()'s docstring above.
            sales_based = set(n for n in sales_based_raw if norm_name(n) not in hard_excluded_norm)
            roster = hire_based | sales_based

            # Sick Leave Impact Rule (Ahmed, 2026-09-16): a rep in the
            # Excluded band that month (>15 sick days, or Maternity) drops
            # out of this manager's DV Coverage denominator. His example:
            # "if dm has 5 medical rep in jul, 1 of them leave all july and
            # he make double visits with 4 medical rep, his dv coverage is
            # 100%" -- a manager cannot double-visit someone who was not
            # there, and scoring him 80% for it punishes him for HR's
            # calendar. Verified before shipping: 10 coach-months move, 8 of
            # them to exactly 100%.
            #
            # Same Excluded band the Coverage/RF rule uses, on purpose --
            # one definition of "not available this month" platform-wide
            # (leave_rules.is_absent_for_coaching).
            #
            # DENOMINATOR ONLY. The rep stays on the roster set, so a joint
            # visit that did happen with them still counts in the numerator
            # and they still appear in the roster popup. Removing them from
            # both halves of the ratio was the first implementation and it
            # was wrong: for a manager who DID coach a mostly-absent rep it
            # moved 6-of-7 to 5-of-6 and LOWERED his score (verified on real
            # data -- Ahmed Mohamed Khalil Youssef, March 85.7% -> 83.3%).
            # The rule exists to stop absence hurting a manager, so absence
            # must only ever help or be neutral. The existing min(raw,100)
            # cap in bucket_to_metrics handles the overflow case where every
            # available rep plus an absent one were all coached.
            absent = set()
            if leave_report.get("found"):
                for nm in roster:
                    rep_code = hr_by_norm.get(norm_name(nm), {}).get("code")
                    if rep_code and leave_rules.is_absent_for_coaching(leave_report, rep_code, month_names[m]):
                        absent.add(nm)
            per_month[m] = roster
            if absent:
                leave_absent_by_coach_month[coach_norm][m] = sorted(absent)
        manager_month_teams[coach_norm] = per_month
        manager_month_teams_norm[coach_norm] = {
            m: set(norm_name(x) for x in s) for m, s in per_month.items()
        }

    # Roster popup name detail (2026-09-01, user-requested: "add here
    # hiring or resigned date when it according to rule and add
    # position" -- the Coached/Not Coached popup on a DV Coverage cell,
    # see js/coaching.js renderRosterPopup(), previously showed bare
    # names only). For each rep on a roster popup's list, surface:
    #   - position: the same human territory label already shown on the
    #     Coached Employees table (hr_name_to_position, e.g. "DIAB-I
    #     ASSUIT") -- falls back to Database Shortcut's own raw HR
    #     "Position (English)" field when the sales-sheet lookup has no
    #     entry for this person (e.g. someone with zero visits all S1,
    #     so never appears in cache/sales.json's rep list either).
    #   - note: a "Hired <date>" / "Resigned <date>" annotation, but
    #     ONLY when that date falls inside the exact period this popup
    #     is showing (this month's [month_start, month_end], or the
    #     full Feb1-Jun30 S1 range for the cumulative popup) -- i.e.
    #     only when the half-month roster rule (active_in_month() above)
    #     actually had that date in play for this period, not a stale
    #     hire/resignation from a different period that isn't relevant
    #     here. A rep who was on roster the whole period gets no note.
    def roster_name_detail(name, period_start, period_end):
        hr = hr_by_norm.get(norm_name(name), {})
        position = hr_name_to_position.get(name) or hr.get("position")
        note = None
        hire_date = hr.get("hireDate")
        last_day = hr.get("lastDayOfWork")
        if hire_date is not None and period_start <= hire_date <= period_end:
            note = "Hired " + hire_date.strftime("%b %d, %Y")
        elif last_day is not None and period_start <= last_day <= period_end:
            note = "Resigned " + last_day.strftime("%b %d, %Y")
        return {"name": name, "position": position, "note": note}

    YTD_START, YTD_END = MONTH_START[MONTHS[0]], MONTH_END[MONTHS[-1]]

    print("\n[2/5] Loading Visits Details S1 DM.xlsx (Total sheet)...", flush=True)
    if not os.path.exists(SOURCE_VISITS):
        print(f"ERROR: {SOURCE_VISITS} not found.")
        sys.exit(1)
    wb_v = openpyxl.load_workbook(SOURCE_VISITS, read_only=True, data_only=True)
    ws_v = wb_v["Total"]
    vrows = list(ws_v.iter_rows(min_row=2, values_only=True))
    cols = ["CustType", "CustomerName", "ClinicGroup", "Specialty", "Date", "Time", "Employee", "Team",
            "Coach1", "Title1", "Coach2", "Title2", "Coach3", "Title3", "Coach4", "Title4",
            "Area", "Platform", "PlatformDesc", "GPSDeviation", "Duration", "Comments", "Products",
            "SpotCall", "Coached", "Planned", "OutOfBoundaries", "Status"]
    idx = {c: i for i, c in enumerate(cols)}
    log(f"visit rows: {len(vrows)}")

    print("\n[3/5] Matching names + aggregating (monthly + cumulative)...", flush=True)
    emp_names_all = set(r[idx["Employee"]] for r in vrows if r[idx["Employee"]])
    coach_names_all = set(r[idx["Coach1"]].strip() for r in vrows if r[idx["Coach1"]])
    unmatched_reps = sorted(e for e in emp_names_all if norm_name(e) not in hr_by_norm)
    unmatched_coaches = sorted(c for c in coach_names_all if norm_name(c) not in hr_by_norm)
    log(f"unmatched reps: {len(unmatched_reps)} | unmatched coaches: {len(unmatched_coaches)}")
    if unmatched_reps or unmatched_coaches:
        log("WARNING: unresolved names remain -- see 'unmatched' block in output. "
            "Add confirmed aliases to COACHING_NAME_ALIASES before treating this cache as final.")

    # manager norm-name -> title (mode of Title1 seen for that coach)
    manager_title_votes = defaultdict(Counter)
    # manager norm-name -> {'ALL': bucket, '2026-02': bucket, ...}
    manager_buckets = defaultdict(lambda: defaultdict(new_bucket))
    # manager norm-name -> rep norm-name -> {'ALL':.., month:..}
    manager_emp_buckets = defaultdict(lambda: defaultdict(lambda: defaultdict(new_emp_bucket)))
    # manager norm-name -> rep norm-name -> {'name','onRoster','first','last','areas','customers':Counter}
    manager_emp_meta = defaultdict(dict)

    rows_processed = 0
    rows_skipped_no_coach = 0
    rows_out_of_period = 0

    for r in vrows:
        coach_raw = r[idx["Coach1"]]
        if not coach_raw:
            rows_skipped_no_coach += 1
            continue
        d = r[idx["Date"]]
        if d is None:
            continue
        d = d.date() if hasattr(d, "date") else d
        if d < PERIOD_START or d > PERIOD_END:
            rows_out_of_period += 1
            continue

        coach_norm = norm_name(coach_raw)
        title = r[idx["Title1"]]
        manager_title_votes[coach_norm][title] += 1

        emp_raw = r[idx["Employee"]]
        emp_norm = norm_name(emp_raw) if emp_raw else None
        area = r[idx["Area"]]
        cust = r[idx["CustomerName"]]
        mkey = month_key(d)

        month_team_norm = manager_month_teams_norm.get(coach_norm, {}).get(mkey, set())
        on_roster = bool(emp_norm and emp_norm in month_team_norm)

        for bkey in ("ALL", mkey):
            b = manager_buckets[coach_norm][bkey]
            b["visits"] += 1
            b["days"].add(d)
            if area:
                b["areas"].add(area)
            if emp_norm:
                (b["onRoster"] if on_roster else b["offRoster"]).add(emp_norm)

        if emp_norm:
            meta = manager_emp_meta[coach_norm].setdefault(emp_norm, {
                "name": emp_raw, "onRoster": on_roster, "first": d, "last": d,
                "areas": set(), "customers": Counter(), "visitLog": [],
            })
            meta["onRoster"] = meta["onRoster"] or on_roster
            meta["first"] = min(meta["first"], d)
            meta["last"] = max(meta["last"], d)
            if area:
                meta["areas"].add(area)
            if cust:
                meta["customers"][cust] += 1
            # Per-visit detail (date/customer/area) for the Coached
            # Employees drill-down's "detailed visits" view -- 2026-08-31,
            # user-requested, reversing the earlier "no HCP/customer
            # names anywhere" rule for this ONE new view only (see the
            # header comment's CUSTOMER / HCP DATA note in js/coaching.js
            # for the full history of that rule and this exception to it).
            meta["visitLog"].append({
                "date": d.isoformat(), "customer": safe_str(cust), "area": safe_str(area),
            })
            for bkey in ("ALL", mkey):
                eb = manager_emp_buckets[coach_norm][emp_norm][bkey]
                eb["visits"] += 1
                eb["days"].add(d)

        rows_processed += 1

    log(f"rows processed: {rows_processed} | skipped (no coach): {rows_skipped_no_coach} | "
        f"out of Feb1-Aug31 period: {rows_out_of_period}")

    print("\n[4/5] Building manager records...", flush=True)
    managers_out = []
    for coach_norm, buckets_by_key in manager_buckets.items():
        title = manager_title_votes[coach_norm].most_common(1)[0][0]
        hr = hr_by_norm.get(coach_norm, {})
        hr_pos = hr.get("position")
        if hr_pos:
            hr_pos_clean = str(hr_pos).replace("\ufffd", "").strip()
            pos_upper = hr_pos_clean.upper()
            if "AREA SALES MANAGER" in pos_upper or "AREA MANAGER" in pos_upper:
                title = "Area Manager"
            elif "NATIONAL SALES MANAGER" in pos_upper:
                title = "National Sales Manager"
            elif "BUSINESS UNIT MANAGER" in pos_upper:
                title = "Business Unit Manager"
            elif "BRAND MANAGER" in pos_upper:
                title = "Brand Manager"
        team = active_direct_reports.get(coach_norm, set())  # CURRENT roster -- display only, see below
        is_cov = title in COVERAGE_TITLES
        # Role change (2026-09-20, Ahmed decision (a)): a coach whose CURRENT
        # HR position is a plain Medical/Sales Representative is no longer a
        # coaching manager. Their earlier supervisor visits (before the HR
        # hire date) stay in their own profile/YTD history, but from the HR
        # hire month onward they are not a manager row and never enter the
        # KPI averages. Verified 2026-09-20: only Hanan Atef Magdy
        # Abdelmessih (556) matches this rule -- no other coach is affected.
        role_change = None
        if is_cov and hr_pos:
            _pu = str(hr_pos).replace("\ufffd", "").strip().upper()
            if _pu.startswith("MEDICAL REP") or _pu.startswith("SALES REP"):
                _hd = hr.get("hireDate")
                role_change = {"currentPosition": str(hr_pos).replace("\ufffd", "").strip(),
                               "since": _hd.isoformat() if _hd else None}
        team_size = len(team)

        # 2026-09-01, Ahmed (after asking Ingy Mousa Guirgis Mashrqay's
        # Hiring date and finding it's 2026-07-18, AFTER S1 ends
        # 2026-06-30): a rep hired after the period closes can never have
        # a real S1 visit, so flagging them in the front-end's "Reps Not
        # Coached in 30+ Days" section as a coaching gap is misleading --
        # it's a pending new hire, not a missed coach. Ships each CURRENT
        # roster rep's Hiring date (ISO date string, or None if unknown)
        # alongside activeTeam so js/coaching.js's buildNotSeenRows() can
        # exclude anyone hired after data.period.end from that list.
        team_hire_dates = {}
        for rep_name in team:
            rep_hr = hr_by_norm.get(norm_name(rep_name), {})
            hd = rep_hr.get("hireDate")
            team_hire_dates[rep_name] = hd.isoformat() if hd else None

        month_teams = manager_month_teams.get(coach_norm, {m: set() for m in MONTHS})
        # S1 cumulative roster = the UNION of all five monthly rosters.
        # NOTE: this is NOT simply "the last month's roster" -- that
        # shortcut only held back when team_as_of() (Hiring date) was the
        # sole source and rosters could only grow across the period. Once
        # the sales-sheet cross-check above can also surface someone who
        # was on the team in an EARLIER month and genuinely left before a
        # LATER one (a real S1 departure, not a data gap), rosters can
        # shrink month to month too, so "last month" would silently drop
        # that person from the cumulative denominator while their coached
        # visits still counted in the cumulative numerator -- exactly the
        # >100% raw-coverage bug this comment replaces (caught 2026-08-31
        # on Karim Lotfy Menesy AbdelSalam under Shady Emeil Basta Israel:
        # cumulative_team_size was computing 3, but Karim -- on the team
        # Feb-Apr -- made the true S1 roster 4, and his being coached
        # pushed dvCoverageRawPct to a nonsensical 133.3%).
        cumulative_roster_names = set().union(*month_teams.values()) if month_teams else set()
        cumulative_team_size = len(cumulative_roster_names)

        cumulative = bucket_to_metrics(buckets_by_key["ALL"], cumulative_team_size, is_cov)
        if is_cov:
            # 2026-08-31, user-requested ("popup to see with whom made
            # coached and not"): name-level breakdown of the DV Coverage
            # numerator/denominator, so a DV Coverage % is never just a
            # number -- it's inspectable down to which roster reps were
            # actually visited that period and which weren't. Built from
            # data already computed above: the period's roster (a set of
            # display names) and buckets_by_key[bkey]["onRoster"] (the
            # set of norm-names who were both on-roster AND visited).
            # Sourced from the roster, not the visit log, so a roster
            # member with zero visits still appears in notCoachedNames
            # rather than being silently absent.
            coached_norm_all = buckets_by_key["ALL"]["onRoster"]
            cumulative["coachedNames"] = sorted(
                (roster_name_detail(n, YTD_START, YTD_END) for n in cumulative_roster_names if norm_name(n) in coached_norm_all),
                key=lambda d: d["name"],
            )
            cumulative["notCoachedNames"] = sorted(
                (roster_name_detail(n, YTD_START, YTD_END) for n in cumulative_roster_names if norm_name(n) not in coached_norm_all),
                key=lambda d: d["name"],
            )
        # Always emit all 5 months, even ones with zero visits -- a
        # manager who did no coaching in a month they had an active team
        # is a genuine 0% that month, not an absent data point, and the
        # UI's aggregate KPI needs every period's activeTeamSize present
        # to sum correctly (see bucket_to_metrics's comment). buckets_by_key
        # is a defaultdict, so buckets_by_key[m] safely returns an empty
        # bucket for a month with no rows instead of KeyError.
        monthly = {}
        for m in MONTHS:
            # Sick Leave Impact Rule (2026-09-16): the DV Coverage
            # DENOMINATOR drops reps who were in the Excluded band that month
            # -- a manager cannot double-visit someone who was not there.
            # The roster itself is untouched (see the per_month loop above),
            # so the numerator and the roster popup still include them.
            absent_m = leave_absent_by_coach_month.get(coach_norm, {}).get(m, [])
            roster_size = len(month_teams[m])
            monthly[m] = bucket_to_metrics(
                buckets_by_key[m], max(0, roster_size - len(absent_m)), is_cov)
            # Name who was dropped and what the denominator would have been,
            # so a shrunken denominator is always explainable on screen: a
            # manager looking at 100% can see it was 5-of-5 available, not
            # 5-of-6 quietly rounded up.
            # Only for the titles that actually get a DV Coverage % --
            # bucket_to_metrics omits activeTeamSize for everyone else, and
            # emitting a "before leave" denominator with no denominator
            # beside it would be meaningless.
            if absent_m and is_cov:
                monthly[m]["leaveExcludedNames"] = absent_m
                monthly[m]["leaveExcludedCount"] = len(absent_m)
                monthly[m]["activeTeamSizeBeforeLeave"] = roster_size
            # 2026-09-03, Ahmed ("so any dsm resgned in specific month
            # reomve him from analysis", scope confirmed as "Remove from
            # that month's table + KPI averages"): stamp this MANAGER's
            # own monthly bucket with the SAME half-month
            # hire/resignation rule already used for their REPS' roster
            # (team_as_of_month() above) and for reps' own
            # activeHalfMonth flag (emp_monthly[m], further below) -- so
            # js/coaching.js can drop a manager's row entirely from that
            # month's own-tier table, Other Coaching Levels list, and
            # Executive KPI averages when their Last Day of Work (or
            # Hiring date) falls inside that specific month, while every
            # earlier month they were genuinely active is left
            # untouched. Applies to every manager tier (DM/DSM, ASM,
            # NSM, Sr. DM, etc.) since Coaching Intelligence tracks all
            # of them the same way -- not just DM/DSM. Reuses this
            # manager's own `hr` dict (Database Shortcut's Hiring date /
            # Last Day of Work for THIS person), which is distinct from
            # the coach-side gate above (that gate only zeroes their
            # REPS' roster for a month they weren't employed -- it never
            # removed their OWN row, which is exactly the gap this
            # closes; see Eslam AbdelLatif Aly Ibrahim ElSabagh's case,
            # resigned 2026-07-31, whose July row showed a misleading 0%
            # before this fix).
            monthly[m]["activeHalfMonth"] = active_in_month(
                hr.get("hireDate"), hr.get("lastDayOfWork"),
                MONTH_START[m], MONTH_END[m],
            )
            # activeHalfMonth alone under-covers resignation: a manager
            # who worked most of a month and left on, say, day 28-31
            # still reads as active_in_month()==True for that month (by
            # design -- the half-month rule exists so a rep/manager who
            # worked the bulk of a month still counts toward that
            # month's ROSTER SIZE). But Eslam AbdelLatif Aly Ibrahim
            # ElSabagh's exact case -- Last Day of Work 2026-07-31,
            # genuinely on payroll nearly all of July, yet 0 visits --
            # is precisely what looked like a data error to Ahmed and is
            # what this feature exists to stop showing as a bare
            # "0%" row. So stamp a second, independent flag: does this
            # month CONTAIN this manager's Last Day of Work at all,
            # regardless of which half. js/coaching.js's
            # managerActiveInPeriod() drops the manager's row from that
            # month's own-tier table / Other Coaching Levels list / KPI
            # averages when EITHER flag says "not really here" --
            # activeHalfMonth catches not-yet-hired and resigned-in-the-
            # first-half months (and, as a side effect, every month
            # after this one once they're gone), resignedThisMonth
            # additionally catches the resignation month itself no
            # matter which half of it they left in.
            if role_change and role_change["since"] and MONTH_END[m].isoformat() >= role_change["since"]:
                # not a coaching manager from the month they became a rep
                monthly[m]["activeHalfMonth"] = False
            last_day = hr.get("lastDayOfWork")
            monthly[m]["resignedThisMonth"] = bool(
                last_day is not None and MONTH_START[m] <= last_day <= MONTH_END[m]
            )
            if is_cov:
                roster_names_m = month_teams[m]
                coached_norm_m = buckets_by_key[m]["onRoster"]
                m_start, m_end = MONTH_START[m], MONTH_END[m]
                monthly[m]["coachedNames"] = sorted(
                    (roster_name_detail(n, m_start, m_end) for n in roster_names_m if norm_name(n) in coached_norm_m),
                    key=lambda d: d["name"],
                )
                monthly[m]["notCoachedNames"] = sorted(
                    (roster_name_detail(n, m_start, m_end) for n in roster_names_m if norm_name(n) not in coached_norm_m),
                    key=lambda d: d["name"],
                )

        coached_employees = []
        for emp_norm, meta in manager_emp_meta[coach_norm].items():
            eb_all = manager_emp_buckets[coach_norm][emp_norm]["ALL"]
            emp_hr = hr_by_norm.get(emp_norm, {})
            emp_monthly = {}
            for m in MONTHS:
                if m in manager_emp_buckets[coach_norm][emp_norm]:
                    mb = manager_emp_buckets[coach_norm][emp_norm][m]
                    emp_monthly[m] = {
                        "visits": mb["visits"], "coachingDays": len(mb["days"]),
                        "activeHalfMonth": active_in_month(
                            emp_hr.get("hireDate"), emp_hr.get("lastDayOfWork"),
                            MONTH_START[m], MONTH_END[m],
                        ),
                    }
            emp_status = emp_hr.get("status")
            # A handful of Database Shortcut rows have a malformed/blank
            # Status cell that openpyxl reads back as a bare
            # datetime.time(0, 0) instead of text (found 2026-08-31 --
            # same Excel quirk as blank date cells reading as 00:00:00).
            # That is not a real status value, so treat it exactly like
            # a missing one rather than emit it or let it flow into the
            # "== 'Active'" check below.
            if not isinstance(emp_status, str):
                emp_status = None
            # 2026-08-31, user-requested: a coached employee who has
            # since left the company shows as Inactive, distinct from
            # (and independent of) their Own-team/Cross-team roster
            # badge -- someone can be Own-team-but-now-Inactive (left
            # after being coached) just as easily as Cross-team. Unknown
            # status (no HR match, or the malformed cell above) is
            # treated as active rather than guessed at -- never mark
            # someone Inactive without evidence.
            emp_active = True if emp_status is None else (emp_status == "Active")
            actual_manager = None
            if not meta["onRoster"]:
                # 2026-08-31, user-requested ("define why cross-team"):
                # show whose roster this person is really on, not just
                # that they aren't on THIS manager's.
                real_dm = emp_hr.get("directManager")
                _real_key = emp_hr.get("dmKey") or (norm_name(real_dm) if real_dm else "")
                if real_dm and _real_key != coach_norm:
                    actual_manager = real_dm
                    if _real_key != norm_name(real_dm):
                        # rescued by manager code -- show the canonical HR name
                        actual_manager = hr_by_norm.get(_real_key, {}).get("name") or real_dm
            coached_employees.append({
                "name": meta["name"],
                "onRoster": meta["onRoster"],
                "active": emp_active,
                "status": emp_status,
                "line": emp_hr.get("line"),
                # 2026-09-01, user-requested ("check that all position
                # appeared correctly"): hr_name_to_position (sales-derived
                # territory label, e.g. "DIAB-I ASSUIT") only has an entry
                # for a rep who appears in cache/sales.json's own rep
                # list -- 238/1848 (12.9%) Coached Employees rows had NO
                # sales record at all this S1 (e.g. Peter Mekhael Sobhy
                # Mekhael, first coaching visit only in May) and so showed
                # a bare "--" even though Database Shortcut's own raw HR
                # "Position (English)" field (e.g. "Sales Representative")
                # is never actually blank (0/2466 rows) -- it just wasn't
                # being fallen back to. Same fallback pattern as
                # roster_name_detail() above, for the same reason.
                "position": hr_name_to_position.get(meta["name"]) or emp_hr.get("position"),
                "actualManager": actual_manager,
                "visits": eb_all["visits"],
                "coachingDays": len(eb_all["days"]),
                "firstDate": meta["first"].isoformat(),
                "lastDate": meta["last"].isoformat(),
                "zones": len(meta["areas"]),
                "monthly": emp_monthly,
                # Aggregated customer/visit counts (kept from v1, still
                # unused by the main table) PLUS, as of 2026-08-31, the
                # full per-visit log (date/customer/area) backing the
                # Coached Employees drill-down's "detailed visits" view.
                "customers": [{"name": cn, "visits": v} for cn, v in meta["customers"].most_common()],
                "visitLog": sorted(meta["visitLog"], key=lambda v: v["date"]),
            })
        coached_employees.sort(key=lambda x: -x["visits"])

        # 2026-08-31, user-requested ("make S1 cumulative for current
        # active [managers] as well as when choosing months"): whether
        # THIS coach is still actively employed TODAY, per Database
        # Shortcut's own current Status snapshot -- distinct from (and a
        # coarser signal than) the day-15 half-month logic used per-
        # period above. That logic already correctly zeroes out a
        # departed coach's roster for months they weren't employed
        # (e.g. Michael Adel AbdelMassih Awad), but a manager whose
        # entire S1 tenure was brief and who has since left the company
        # can still contribute real historical visits/days to a period
        # they were genuinely present for. This flag lets the UI's
        # company-wide aggregate (Executive KPI row / ranked-table
        # totals -- see js/coaching.js's aggregateOwnTier) exclude such
        # a manager ENTIRELY, from every period including S1 Cumulative,
        # so former employees never factor into a headline "how is the
        # CURRENT org performing" number -- while their own Manager
        # Profile drawer, opened directly, still shows their accurate
        # historical record unaffected by this flag. Unknown status (no
        # HR match) defaults to True -- missing data must never silently
        # shrink credit, same principle as everywhere else in this file.
        currently_active = (hr.get("status") == "Active") if hr.get("status") is not None else True
        managers_out.append({
            "id": coach_norm,
            "name": hr.get("name") or (manager_emp_meta[coach_norm] and None) or coach_norm.title(),
            "code": hr.get("code"),
            "title": title,
            "line": hr.get("line"),
            "bu": hr.get("bu"),
            "activeTeamCount": team_size,
            "activeTeam": sorted(team),
            "activeTeamHireDates": team_hire_dates,
            "currentlyActive": currently_active,
            **({"roleChange": role_change} if role_change else {}),
            "cumulative": cumulative,
            "monthly": monthly,
            "coachedEmployees": coached_employees,
        })

    # use the confirmed HR-master spelling for name where available
    for m in managers_out:
        if not m["name"]:
            m["name"] = m["id"].title()

    managers_out.sort(key=lambda x: -x["cumulative"]["visits"])

    total_visits_check = sum(m["cumulative"]["visits"] for m in managers_out)
    monthly_sum_check = {}
    for m in managers_out:
        for mk, mv in m["monthly"].items():
            monthly_sum_check[mk] = monthly_sum_check.get(mk, 0) + mv["visits"]
    monthly_total_check = sum(monthly_sum_check.values())

    reconciliation = {
        "totalVisitRowsInSheet": len(vrows),
        "rowsProcessed": rows_processed,
        "rowsSkippedNoCoach": rows_skipped_no_coach,
        "rowsOutOfPeriod": rows_out_of_period,
        "totalCoachingManagers": len(managers_out),
        "cumulativeVisitsAcrossManagers": total_visits_check,
        "monthlyVisitsAcrossManagers": monthly_total_check,
        "monthlyEqualsCumulative": monthly_total_check == total_visits_check,
        "monthlyBreakdown": monthly_sum_check,
        "unmatchedReps": unmatched_reps,
        "unmatchedCoaches": unmatched_coaches,
    }

    cache_obj = {
        "schemaVersion": 1,
        "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "sourceFiles": ["Visits Details S1 DM.xlsx (Total sheet)", "Database Shortcut.xlsx"],
        "period": {"start": PERIOD_START.isoformat(), "end": PERIOD_END.isoformat(), "months": MONTHS},
        "targets": {"dvCoveragePct": TARGET_DV_COVERAGE_PCT, "avgVisitsPerDay": TARGET_AVG_VISITS_PER_DAY},
        "coverageTitles": sorted(COVERAGE_TITLES),
        "nameAliasesApplied": [{"from": k, "to": v} for k, v in COACHING_NAME_ALIASES.items()],
        "reconciliation": reconciliation,
        "managers": managers_out,
    }

    print("\n[5/5] Writing cache/coaching.json + cache/coaching.data.js...", flush=True)
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    json_str = json.dumps(cache_obj, ensure_ascii=False, separators=(",", ":"))
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        f.write(json_str)

    gz = gzip.compress(json_str.encode("utf-8"), compresslevel=9)
    b64 = base64.b64encode(gz).decode("ascii")
    with open(OUTPUT_JS, "w", encoding="utf-8") as f:
        f.write('window.' + JS_VAR_NAME + ' = {b64Data:"' + b64 + '"};\n')

    log(f"wrote {OUTPUT_JSON} ({len(json_str):,} bytes uncompressed)")
    log(f"wrote {OUTPUT_JS} ({len(b64):,} bytes b64, {len(gz):,} bytes gzipped)")

    print("\n=== RECONCILIATION ===")
    for k, v in reconciliation.items():
        if k not in ("unmatchedReps", "unmatchedCoaches", "monthlyBreakdown"):
            print(f"  {k}: {v}")
    print(f"  monthlyBreakdown: {reconciliation['monthlyBreakdown']}")
    print(f"  unmatchedReps: {reconciliation['unmatchedReps']}")
    print(f"  unmatchedCoaches: {reconciliation['unmatchedCoaches']}")
    print("\nCoaching Cache Build Complete!")


if __name__ == "__main__":
    main()
