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

Scope (confirmed 2026-08-31):
  - Source file: "Visits Details S1 DM.xlsx", sheet "Total" only.
  - Period: Feb 1 - Jun 30 2026 (S1). Both monthly and S1-cumulative
    aggregates are produced for every manager.
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
roster (and hence the cumulative roster, since rosters only grow) use
Database Shortcut's Hiring date to ask "was this rep already on the team
as of this month's start" instead of "is this rep on the team today" --
see team_as_of() and its comment below for the exact rule. This is a
real recomputation, not a display tweak: cache/coaching.json's monthly
and cumulative dvCoveragePct/dvCoverageRawPct values changed for any
manager whose team grew during S1, and each metrics object now also
carries its own activeTeamSize (the denominator actually used for that
period) -- js/coaching.js's aggregate KPI math was updated to sum that
field per period instead of the manager's top-level (current-snapshot)
activeTeamCount, so the Executive-row aggregate stays consistent with
the per-manager numbers.

Usage:  python etl/build_coaching_cache.py
"""

import os
import sys
import json
import gzip
import base64
import datetime
from collections import defaultdict, Counter

import openpyxl

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_VISITS = os.path.join(ROOT_DIR, "Visits Details S1 DM.xlsx")
SOURCE_HR = os.path.join(ROOT_DIR, "Database Shortcut.xlsx")
OUTPUT_JSON = os.path.join(ROOT_DIR, "cache", "coaching.json")
OUTPUT_JS = os.path.join(ROOT_DIR, "cache", "coaching.data.js")
JS_VAR_NAME = "COACHING_CACHE"

PERIOD_START = datetime.date(2026, 2, 1)
PERIOD_END = datetime.date(2026, 6, 30)
MONTHS = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]

TARGET_DV_COVERAGE_PCT = 75
TARGET_AVG_VISITS_PER_DAY = 7

# Levels with a real "own active team" -> get DV Coverage %.
COVERAGE_TITLES = {"District Manager", "Field force supervisor"}

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
}


def norm_name(s):
    if s is None:
        return ""
    n = str(s).upper().replace(chr(160), " ").strip()
    n = " ".join(n.split())
    return COACHING_NAME_ALIASES.get(n, n)


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

    hr_by_norm = {}
    active_direct_reports = defaultdict(set)  # norm(Direct Manager) -> {employee names}
    for r in hr_rows:
        name = r[hi["Employee Name (English)"]]
        if name is None:
            continue
        status = r[hi["Status"]]
        dm = r[hi["Name of Direct Manager"]]
        hire_raw = r[hi["Hiring date"]]
        hire_date = hire_raw.date() if hasattr(hire_raw, "date") else hire_raw
        n = norm_name(name)
        hr_by_norm[n] = {
            "name": name,
            "code": r[hi["Code"]],
            "status": status,
            "line": r[hi["Line"]],
            "bu": r[hi["Business Unit"]],
            "position": r[hi["Position (English)"]],
            "hireDate": hire_date,
        }
        if status == "Active" and dm:
            active_direct_reports[norm_name(dm)].add(name)
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
    # Fix: a rep counts toward a given month's roster only if their
    # Hiring date is on or before that month's first day. A rep with no
    # recorded hire date is always counted (missing data must never
    # silently shrink a manager's coverage credit). This does not model
    # historical departures -- Database Shortcut is a current-status
    # snapshot, so someone who resigned before today is invisible here
    # exactly as it was invisible before this fix; that survivorship
    # limitation is unchanged, not introduced by it. Because rosters only
    # grow across the period under this rule, a manager's S1 cumulative
    # roster equals their roster as of the LAST period month's start
    # (2026-06-01) -- the union of all five monthly rosters.
    MONTH_START = {m: datetime.date(int(m[:4]), int(m[5:7]), 1) for m in MONTHS}

    def team_as_of(coach_norm, cutoff_date):
        out = set()
        for nm in active_direct_reports.get(coach_norm, set()):
            hd = hr_by_norm.get(norm_name(nm), {}).get("hireDate")
            if hd is None or hd <= cutoff_date:
                out.add(nm)
        return out

    manager_month_teams = {}       # coach_norm -> {month: {names}}
    manager_month_teams_norm = {}  # coach_norm -> {month: {norm names}}
    for coach_norm in active_direct_reports:
        per_month = {m: team_as_of(coach_norm, MONTH_START[m]) for m in MONTHS}
        manager_month_teams[coach_norm] = per_month
        manager_month_teams_norm[coach_norm] = {
            m: set(norm_name(x) for x in s) for m, s in per_month.items()
        }

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
                "areas": set(), "customers": Counter(),
            })
            meta["onRoster"] = meta["onRoster"] or on_roster
            meta["first"] = min(meta["first"], d)
            meta["last"] = max(meta["last"], d)
            if area:
                meta["areas"].add(area)
            if cust:
                meta["customers"][cust] += 1
            for bkey in ("ALL", mkey):
                eb = manager_emp_buckets[coach_norm][emp_norm][bkey]
                eb["visits"] += 1
                eb["days"].add(d)

        rows_processed += 1

    log(f"rows processed: {rows_processed} | skipped (no coach): {rows_skipped_no_coach} | "
        f"out of Feb1-Jun30 period: {rows_out_of_period}")

    print("\n[4/5] Building manager records...", flush=True)
    managers_out = []
    for coach_norm, buckets_by_key in manager_buckets.items():
        title = manager_title_votes[coach_norm].most_common(1)[0][0]
        hr = hr_by_norm.get(coach_norm, {})
        team = active_direct_reports.get(coach_norm, set())  # CURRENT roster -- display only, see below
        is_cov = title in COVERAGE_TITLES
        team_size = len(team)

        month_teams = manager_month_teams.get(coach_norm, {m: set() for m in MONTHS})
        # S1 cumulative roster = roster as of the last period month's
        # start (rosters only grow across the period under team_as_of(),
        # so this equals the union of all five monthly rosters).
        cumulative_team_size = len(month_teams[MONTHS[-1]])

        cumulative = bucket_to_metrics(buckets_by_key["ALL"], cumulative_team_size, is_cov)
        # Always emit all 5 months, even ones with zero visits -- a
        # manager who did no coaching in a month they had an active team
        # is a genuine 0% that month, not an absent data point, and the
        # UI's aggregate KPI needs every period's activeTeamSize present
        # to sum correctly (see bucket_to_metrics's comment). buckets_by_key
        # is a defaultdict, so buckets_by_key[m] safely returns an empty
        # bucket for a month with no rows instead of KeyError.
        monthly = {}
        for m in MONTHS:
            monthly[m] = bucket_to_metrics(buckets_by_key[m], len(month_teams[m]), is_cov)

        coached_employees = []
        for emp_norm, meta in manager_emp_meta[coach_norm].items():
            eb_all = manager_emp_buckets[coach_norm][emp_norm]["ALL"]
            emp_monthly = {}
            for m in MONTHS:
                if m in manager_emp_buckets[coach_norm][emp_norm]:
                    mb = manager_emp_buckets[coach_norm][emp_norm][m]
                    emp_monthly[m] = {"visits": mb["visits"], "coachingDays": len(mb["days"])}
            coached_employees.append({
                "name": meta["name"],
                "onRoster": meta["onRoster"],
                "visits": eb_all["visits"],
                "coachingDays": len(eb_all["days"]),
                "firstDate": meta["first"].isoformat(),
                "lastDate": meta["last"].isoformat(),
                "zones": len(meta["areas"]),
                "monthly": emp_monthly,
                # Customer popup only -- never surfaced in the main table.
                "customers": [{"name": cn, "visits": v} for cn, v in meta["customers"].most_common()],
            })
        coached_employees.sort(key=lambda x: -x["visits"])

        managers_out.append({
            "id": coach_norm,
            "name": hr.get("name") or (manager_emp_meta[coach_norm] and None) or coach_norm.title(),
            "code": hr.get("code"),
            "title": title,
            "line": hr.get("line"),
            "bu": hr.get("bu"),
            "activeTeamCount": team_size,
            "activeTeam": sorted(team),
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
