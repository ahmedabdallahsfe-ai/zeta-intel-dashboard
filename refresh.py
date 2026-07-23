"""
refresh.py
==========
ETL + Analytics entry point for the Coverage Dashboard.

Pipeline:
    Excel Workbook -> Validation -> Cleaning -> Transformation ->
    Aggregation Engine -> Cached JSON -> Dashboard

The dashboard (dashboard.html) NEVER touches the workbook. It only reads
files under cache/. This script is the single place that opens Excel, and
it reads the worksheet exactly once (see load_details_sheet).

Run via refresh.bat, or directly:  python refresh.py

-----------------------------------------------------------------------
BUSINESS LOGIC NOTES (read before changing any aggregation formula)
-----------------------------------------------------------------------
Two raw columns look like they should be simple 0-1 percentages but are
actually per-customer binary flags that must be AVERAGED (never summed)
to produce a percentage at any rollup level:

    Coverage %        = mean("Covered Doctors")   [0/1 per rep-customer row]
    Right Frequency %  = mean("Right Freq")         [0/1 per rep-customer row]

This was verified against the workbook's own pre-existing "Coverage" sheet
PivotTable: for a sample employee, mean(Covered Doctors) across all of
their rows reproduced the pivot's cached "Coverage" value to 10 decimal
places (0.9607843137...), and mean(Right Freq) reproduced its "Right
Frequency" value the same way. Summing either column instead produces
values that regularly exceed 100% and is NOT what the business means by
"coverage."

"Visit Coverage" and "Planning Coverage" are raw workload-tracking columns
with small per-customer fractional values; they don't reduce to a single
business-meaningful percentage the way Covered Doctors/Right Freq do, so
they are surfaced only as supplementary averages, not as headline KPIs.

"Average Frequency Achievement" is taken as mean("Actual Plan Coverage")
-- the closest column to "did the rep achieve their planned visit
frequency." No ground-truth pivot exists to verify this one; flagged here
so it's easy to revisit if the business defines it differently.

ROW-WEIGHTED ROLLUPS: at every aggregation grain above the individual
employee (Team, Manager, Area Manager, NSM, Business Unit, Specialty,
Class, or the global KPI cards), Coverage%/RightFreq% are computed by
grouping the RAW rows and taking mean(Covered Doctors)/mean(Right Freq)
directly -- NOT by averaging each employee's already-computed percentage.
This weights each rep by their actual customer count, which is the
statistically correct way to roll up a rate metric (a rep with 150
customers should influence the team rate more than a rep with 10).

The one exception is the per-EMPLOYEE grain itself (the roster and the
leaderboards): there, mean(Covered Doctors) grouped by Employee+Period
*is* the correct, finest-grained figure.
"""

from __future__ import annotations

import json
import logging
import sys
import time
import warnings
from dataclasses import dataclass, field
from datetime import datetime, date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# CONFIGURATION
# All ETL-level configuration lives here. Nothing below this block should
# contain a hardcoded workbook name, sheet name, or column name.
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent

WORKBOOK_NAME = "Final Total Coverage Feb to June.xlsx"
SHEET_NAME = "Details"

CACHE_DIR = SCRIPT_DIR / "cache"
LOG_DIR = SCRIPT_DIR / "logs"
LOG_FILE = LOG_DIR / "refresh.log"

DASHBOARD_JSON = CACHE_DIR / "dashboard.json"
DASHBOARD_JS = CACHE_DIR / "dashboard.data.js"
METADATA_JSON = CACHE_DIR / "metadata.json"
METADATA_JS = CACHE_DIR / "metadata.data.js"
RECORDS_JSON = CACHE_DIR / "records.json"
RECORDS_JS = CACHE_DIR / "records.data.js"

# The exact 32 columns expected in the Details sheet. Order does not matter;
# presence does. Keep this list in sync with the workbook -- if new columns
# are appended, add them here rather than relaxing validation silently.
REQUIRED_COLUMNS: list[str] = [
    "Period", "Team", "Business Unit", "National Sales Manager", "Area Manager",
    "Manager", "Employee Code", "Hiring Date", "Experience", "Employee",
    "Title", "Profile", "Type", "Customer Code", "Customer Name", "Specialty",
    "Clinic Group", "Class", "Area", "Address", "Frequency", "Plans Count",
    "Visits Count", "Planning Coverage", "Visit Coverage", "Actual Plan Coverage",
    "Last Visit Date", "Customer Count", "Covered Doctors", "Right Freq",
    "Active", "Resignation Date",
]

# Columns that must never be blank on a well-formed row.
NON_BLANK_COLUMNS = ["Employee", "Manager", "Team"]

# Numeric columns that feed KPI math -- coerced to numeric, non-numeric
# values become NaN and are logged as warnings, never silently zeroed.
NUMERIC_COLUMNS = [
    "Plans Count", "Visits Count", "Planning Coverage", "Visit Coverage",
    "Actual Plan Coverage", "Customer Count", "Covered Doctors", "Right Freq",
]

# Date columns. "Resignation Date" additionally uses the sentinel value
# "Current" (meaning "not resigned") which is handled separately, not as
# an invalid date.
DATE_COLUMNS = ["Hiring Date", "Last Visit Date"]
RESIGNATION_DATE_COLUMN = "Resignation Date"
RESIGNATION_CURRENT_SENTINEL = "Current"

# Canonical month ordering, used to sort Period chronologically regardless
# of casing quirks in the source data (e.g. "MAY" vs "May").
MONTH_ORDER = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
}

DROP_DUPLICATE_ROWS = False  # safety default: flag duplicates, never delete data silently

VACANT_PREFIX = "VACANT"  # how unfilled org-hierarchy slots are encoded in the workbook

TOP_BOTTOM_N = 10          # leaderboard size
MIN_CUSTOMERS_FOR_LEADERBOARD = 5  # exclude reps with too few customers to rank fairly
TOP_N_SPECIALTY_CLASS = 15  # cap on Specialty/Class breakdown rows sent to the dashboard


# ---------------------------------------------------------------------------
# LOGGING
# ---------------------------------------------------------------------------

def setup_logging() -> logging.Logger:
    """Configure a logger that writes to logs/refresh.log (overwritten each
    run) and echoes to stdout so refresh.bat can surface progress live."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("refresh")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    file_handler = logging.FileHandler(LOG_FILE, mode="w", encoding="utf-8")
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    return logger


# ---------------------------------------------------------------------------
# RESULT CONTAINERS
# ---------------------------------------------------------------------------

@dataclass
class ValidationResult:
    """Collects everything the data-quality pass finds. Errors mean the
    pipeline cannot safely continue; warnings mean it can, but the issue
    is surfaced to the user in the log and the dashboard's Data Health
    indicator."""
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)

    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0


# ---------------------------------------------------------------------------
# STEP 1: LOCATE & LOAD (single read, no repeated worksheet scans)
# ---------------------------------------------------------------------------

def find_workbook(logger: logging.Logger) -> Path:
    """Resolve the workbook path relative to this script's folder, per the
    project requirement that the workbook lives beside the dashboard."""
    candidate = SCRIPT_DIR / WORKBOOK_NAME
    if not candidate.exists():
        logger.error("Workbook not found: %s", candidate)
        raise FileNotFoundError(
            f"Expected '{WORKBOOK_NAME}' next to refresh.py at {SCRIPT_DIR}. "
            "Place the workbook in this folder and run refresh.bat again."
        )
    logger.info("Workbook located: %s", candidate)
    return candidate


def load_details_sheet(workbook_path: Path, logger: logging.Logger) -> pd.DataFrame:
    """Read the Details sheet exactly once, using python-calamine (a
    Rust-backed reader) rather than openpyxl's pure-Python parser.

    This is the single most important performance decision in the
    pipeline: openpyxl takes minutes on a 340k-row sheet; calamine reads
    the same sheet in single-digit seconds, which is what keeps refresh
    times acceptable as the workbook grows toward 1,000,000+ rows. No
    other step re-reads the worksheet -- everything downstream operates
    on the in-memory DataFrame built here.
    """
    from python_calamine import CalamineWorkbook

    t0 = time.time()
    workbook = CalamineWorkbook.from_path(str(workbook_path))
    if SHEET_NAME not in workbook.sheet_names:
        raise ValueError(f"Sheet '{SHEET_NAME}' not found. Available sheets: {workbook.sheet_names}")

    rows = workbook.get_sheet_by_name(SHEET_NAME).to_python()
    if not rows:
        raise ValueError(f"Sheet '{SHEET_NAME}' is empty.")

    header, data_rows = rows[0], rows[1:]
    df = pd.DataFrame(data_rows, columns=header)

    elapsed = time.time() - t0
    logger.info("Read '%s' sheet: %d rows x %d columns in %.2fs (engine=calamine)",
                SHEET_NAME, len(df), len(df.columns), elapsed)
    return df


# ---------------------------------------------------------------------------
# STEP 2: VALIDATION
# ---------------------------------------------------------------------------

def validate_data(df: pd.DataFrame, logger: logging.Logger) -> ValidationResult:
    """Run every data-quality check the project spec requires. Never
    mutates df -- validation is read-only by design so the report reflects
    the workbook exactly as delivered."""
    result = ValidationResult()

    # --- missing columns -------------------------------------------------
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        result.errors.append(f"Missing required columns: {missing}")
        logger.error("Missing required columns: %s", missing)
        # Cannot safely validate further without the expected shape.
        return result

    # --- duplicate rows ----------------------------------------------------
    dup_count = int(df.duplicated(keep="first").sum())
    result.stats["duplicate_rows"] = dup_count
    if dup_count:
        msg = f"{dup_count} fully duplicate row(s) detected (not removed; DROP_DUPLICATE_ROWS={DROP_DUPLICATE_ROWS})"
        result.warnings.append(msg)
        logger.warning(msg)

    # --- blank required fields --------------------------------------------
    for col in NON_BLANK_COLUMNS:
        blank_count = int(df[col].isna().sum() + (df[col].astype(str).str.strip() == "").sum())
        result.stats[f"blank_{col.lower()}"] = blank_count
        if blank_count:
            msg = f"{blank_count} row(s) with blank '{col}'"
            result.warnings.append(msg)
            logger.warning(msg)

    # --- invalid Period ------------------------------------------------
    period_values = df["Period"].astype(str).str.strip().str.lower()
    invalid_periods = df.loc[~period_values.isin(MONTH_ORDER.keys()) & period_values.ne("nan"), "Period"]
    invalid_period_count = int(len(invalid_periods))
    result.stats["invalid_periods"] = invalid_period_count
    if invalid_period_count:
        distinct = sorted(set(invalid_periods.astype(str)))
        msg = f"{invalid_period_count} row(s) with unrecognized Period value(s): {distinct}"
        result.warnings.append(msg)
        logger.warning(msg)

    # --- invalid dates -------------------------------------------------
    for col in DATE_COLUMNS:
        parsed = pd.to_datetime(df[col], errors="coerce")
        originally_blank = df[col].isna() | (df[col].astype(str).str.strip() == "")
        invalid_count = int((parsed.isna() & ~originally_blank).sum())
        result.stats[f"invalid_dates_{col.lower().replace(' ', '_')}"] = invalid_count
        if invalid_count:
            msg = f"{invalid_count} row(s) with unparseable '{col}' value(s)"
            result.warnings.append(msg)
            logger.warning(msg)

    # Resignation Date: valid states are blank, "Current", or a real date.
    resign_raw = df[RESIGNATION_DATE_COLUMN]
    resign_str = resign_raw.astype(str).str.strip()
    is_current = resign_str.str.lower() == RESIGNATION_CURRENT_SENTINEL.lower()
    is_blank = resign_raw.isna() | (resign_str == "")
    with warnings.catch_warnings():
        # dayfirst=True is already forcing correct dd/mm/yyyy parsing; this
        # just silences pandas' cosmetic "could not infer a single format"
        # notice that fires whenever per-row values aren't all identically
        # formatted -- not a sign of bad data.
        warnings.simplefilter("ignore", UserWarning)
        parsed_resign = pd.to_datetime(resign_raw, errors="coerce", dayfirst=True)
    invalid_resign = int((parsed_resign.isna() & ~is_current & ~is_blank).sum())
    result.stats["invalid_resignation_dates"] = invalid_resign
    if invalid_resign:
        msg = f"{invalid_resign} row(s) with unrecognized '{RESIGNATION_DATE_COLUMN}' value (expected a date, blank, or '{RESIGNATION_CURRENT_SENTINEL}')"
        result.warnings.append(msg)
        logger.warning(msg)

    # --- missing coverage / right frequency --------------------------------
    for col in ("Visit Coverage", "Right Freq"):
        col_str = df[col].astype(str).str.strip()
        missing_count = int((df[col].isna() | (col_str == "")).sum())
        result.stats[f"missing_{col.lower().replace(' ', '_')}"] = missing_count
        if missing_count:
            msg = f"{missing_count} row(s) missing '{col}'"
            result.warnings.append(msg)
            logger.warning(msg)

    # --- inconsistent employee identity ------------------------------------
    # An Employee Code should map to exactly one Employee name within a
    # given period. When it doesn't (a mid-period name correction/typo),
    # any code identifies the true employee -- but it's worth surfacing so
    # the source data can be cleaned up, and so this isn't silently
    # mistaken for two different people.
    name_variance = df.groupby(["Employee Code", "Period"])["Employee"].nunique()
    inconsistent_identity = int((name_variance > 1).sum())
    result.stats["inconsistent_employee_identity"] = inconsistent_identity
    if inconsistent_identity:
        msg = f"{inconsistent_identity} Employee Code+Period combination(s) have more than one Employee name spelling"
        result.warnings.append(msg)
        logger.warning(msg)

    result.stats["total_rows"] = int(len(df))
    result.stats["total_columns"] = int(len(df.columns))
    return result


# ---------------------------------------------------------------------------
# STEP 3: CLEANING
# ---------------------------------------------------------------------------

def clean_data(df: pd.DataFrame, logger: logging.Logger) -> pd.DataFrame:
    """Standardize types and formatting. Cleaning never drops rows; it only
    normalizes representation so downstream aggregation can trust dtypes."""
    df = df.copy()

    # Trim whitespace on every text column.
    text_cols = df.select_dtypes(include="object").columns
    for col in text_cols:
        df[col] = df[col].apply(lambda v: v.strip() if isinstance(v, str) else v)

    # Normalize Period casing to Title Case ("MAY" -> "May") for consistent
    # display, while a separate PeriodOrder column (added in transform)
    # preserves correct chronological sorting.
    df["Period"] = df["Period"].astype(str).str.strip().str.title()

    # Coerce numeric metric columns; invalid entries become NaN (already
    # counted during validation) rather than silently becoming 0.
    for col in NUMERIC_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Parse date columns.
    for col in DATE_COLUMNS:
        df[col] = pd.to_datetime(df[col], errors="coerce")

    # Resignation Date: keep the "Current" sentinel distinguishable from a
    # real date by parsing into a real datetime column plus a boolean flag.
    resign_raw = df[RESIGNATION_DATE_COLUMN].astype(str).str.strip()
    df["IsCurrentEmployment"] = resign_raw.str.lower() == RESIGNATION_CURRENT_SENTINEL.lower()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)  # see validate_data's identical parse for rationale
        df[RESIGNATION_DATE_COLUMN] = pd.to_datetime(
            resign_raw.where(~df["IsCurrentEmployment"], None), errors="coerce", dayfirst=True
        )

    # Standardize Active status casing ("active"/"ACTIVE " -> "Active").
    df["Active"] = df["Active"].astype(str).str.strip().str.title()

    # Employee Code arrives as a float (e.g. 1661.0) from the Excel reader;
    # normalize to a clean string identifier used consistently everywhere
    # (roster keys, dictionary-encoded records, JSON output).
    df["Employee Code"] = df["Employee Code"].apply(
        lambda v: str(int(v)) if isinstance(v, (int, float)) and not pd.isna(v) else str(v)
    )

    logger.info("Cleaning complete: normalized text, numeric, and date columns")
    return df


# ---------------------------------------------------------------------------
# STEP 4: TRANSFORMATION
# ---------------------------------------------------------------------------

def transform_data(df: pd.DataFrame, logger: logging.Logger) -> pd.DataFrame:
    """Derive analysis-ready columns used repeatedly by the aggregation
    engine, so that logic is computed once here instead of being
    recomputed inside every chart/table (per the performance spec)."""
    df = df.copy()

    df["PeriodOrder"] = df["Period"].str.lower().map(MONTH_ORDER)

    df["IsActive"] = df["Active"].eq("Active")
    df["IsResigned"] = df["Active"].eq("Resigned")

    # Vacant org-hierarchy slots are encoded as "VACANT ..." text in the
    # Manager/Area Manager/NSM columns in the source workbook.
    for col in ("Manager", "Area Manager", "National Sales Manager"):
        df[f"{col}_IsVacant"] = df[col].astype(str).str.upper().str.startswith(VACANT_PREFIX)

    logger.info("Transformation complete: added PeriodOrder, IsActive/IsResigned, vacancy flags")
    return df


# ---------------------------------------------------------------------------
# STEP 5: AGGREGATION ENGINE
# ---------------------------------------------------------------------------

def get_latest_period(df: pd.DataFrame) -> tuple[str, int]:
    """Resolve the latest period present in the data, robust to new months
    being appended later regardless of text casing."""
    present = df.dropna(subset=["PeriodOrder"])
    latest_order = int(present["PeriodOrder"].max())
    latest_period = present.loc[present["PeriodOrder"] == latest_order, "Period"].iloc[0]
    return latest_period, latest_order


def build_roster(df: pd.DataFrame, logger: logging.Logger) -> pd.DataFrame:
    """Collapse the rep-customer detail rows into one row per
    (Employee Code, Period) -- the grain every employee-level metric
    (headcount, span of control, attrition, leaderboards) must be computed
    from. Counting raw Details rows for these would count customers, not
    employees."""
    t0 = time.time()
    roster = df.groupby(["Employee Code", "Period"], as_index=False).agg(
        PeriodOrder=("PeriodOrder", "first"),
        Employee=("Employee", "first"),
        Title=("Title", "first"),
        Profile=("Profile", "first"),
        Team=("Team", "first"),
        BusinessUnit=("Business Unit", "first"),
        NationalSalesManager=("National Sales Manager", "first"),
        AreaManager=("Area Manager", "first"),
        Manager=("Manager", "first"),
        Experience=("Experience", "first"),
        Active=("Active", "first"),
        IsActive=("IsActive", "first"),
        IsResigned=("IsResigned", "first"),
        HiringDate=("Hiring Date", "first"),
        ResignationDate=("Resignation Date", "first"),
        CustomerCount=("Customer Code", "count"),
        CoveragePct=("Covered Doctors", "mean"),
        RightFreqPct=("Right Freq", "mean"),
        TotalVisits=("Visits Count", "sum"),
        TotalPlans=("Plans Count", "sum"),
        AvgFrequencyAchievement=("Actual Plan Coverage", "mean"),
    )
    logger.info("Roster built: %d employee-period rows from %d detail rows in %.2fs",
                len(roster), len(df), time.time() - t0)
    return roster


def count_vacant_slots(df: pd.DataFrame, period: str) -> dict[str, int]:
    """Distinct VACANT-prefixed Manager/Area Manager/NSM values for a given
    period -- each distinct vacant label represents one unfilled slot, not
    one row (a vacant slot still has many customer rows under it)."""
    period_df = df[df["Period"] == period]
    vacant_manager = period_df.loc[period_df["Manager_IsVacant"], "Manager"].nunique()
    vacant_area_manager = period_df.loc[period_df["Area Manager_IsVacant"], "Area Manager"].nunique()
    vacant_nsm = period_df.loc[period_df["National Sales Manager_IsVacant"], "National Sales Manager"].nunique()
    return {
        "manager": int(vacant_manager),
        "areaManager": int(vacant_area_manager),
        "nsm": int(vacant_nsm),
        "total": int(vacant_manager + vacant_area_manager + vacant_nsm),
    }


def coverage_rollup(df: pd.DataFrame, group_col: str, period: str) -> pd.DataFrame:
    """Row-weighted Coverage%/Right Freq% rollup for any grouping column,
    restricted to active reps in the given period. Row-weighted means each
    rep contributes one row per customer, so a rep with more customers
    naturally carries proportionally more weight in the group's rate --
    the statistically correct way to roll up a rate metric."""
    scoped = df[(df["Period"] == period) & (df["IsActive"])]
    grouped = scoped.groupby(group_col).agg(
        CoveragePct=("Covered Doctors", "mean"),
        RightFreqPct=("Right Freq", "mean"),
        CustomerRows=("Customer Code", "count"),
    ).reset_index()
    return grouped


def safe_round(value: Any, ndigits: int = 4) -> float | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    return round(float(value), ndigits)


def build_kpis(df: pd.DataFrame, roster: pd.DataFrame, latest_period: str, logger: logging.Logger) -> dict:
    """The 12 global KPIs, all computed for the latest period, all derived
    live from the cleaned/transformed data -- never hardcoded."""
    latest_roster = roster[roster["Period"] == latest_period]
    latest_active_roster = latest_roster[latest_roster["IsActive"]]
    latest_active_rows = df[(df["Period"] == latest_period) & (df["IsActive"])]

    headcount = int(len(latest_active_roster))
    resigned = int(latest_roster["IsResigned"].sum())
    vacancy = count_vacant_slots(df, latest_period)

    coverage_pct = latest_active_rows["Covered Doctors"].mean() if len(latest_active_rows) else 0.0
    right_freq_pct = latest_active_rows["Right Freq"].mean() if len(latest_active_rows) else 0.0

    customers_per_rep = (headcount and len(latest_active_rows) / headcount) or 0.0
    avg_visits = (headcount and latest_active_roster["TotalVisits"].sum() / headcount) or 0.0
    avg_freq_achievement = latest_active_roster["AvgFrequencyAchievement"].mean() if headcount else 0.0

    span_by_manager = latest_active_roster.groupby("Manager")["Employee Code"].nunique()
    span_of_control = float(span_by_manager.mean()) if len(span_by_manager) else 0.0

    attrition_rate = (resigned / (headcount + resigned)) if (headcount + resigned) else 0.0

    # Visit KPIs: Frequency = commercially mandated target visits (matches analytics.js freqSum)
    total_target_visits = int(latest_active_rows["Frequency"].fillna(0).sum())
    total_actual_visits = int(latest_active_rows["Visits Count"].fillna(0).sum())
    visit_achievement_pct = safe_round(total_actual_visits / total_target_visits) if total_target_visits else None
    not_seen_count = int((latest_active_rows["Covered Doctors"] == 0).sum())
    row_count = len(latest_active_rows)
    not_seen_pct = safe_round(not_seen_count / row_count) if row_count else None
    total_unique_customers = int(latest_active_rows["Customer Name"].nunique())

    kpis = {
        "activeReps": headcount,
        "resignedReps": resigned,
        "headcount": headcount,
        "vacancyCount": vacancy["total"],
        "coveragePct": safe_round(coverage_pct),
        "rightFreqPct": safe_round(right_freq_pct),
        "customersPerRep": safe_round(customers_per_rep, 2),
        "spanOfControl": safe_round(span_of_control, 2),
        "attritionRate": safe_round(attrition_rate),
        "avgVisits": safe_round(avg_visits, 2),
        "avgFrequencyAchievement": safe_round(avg_freq_achievement),
        "latestMonth": latest_period,
        # Visit / not-seen KPIs (added for GitHub view-only parity)
        "totalTargetVisits": total_target_visits,
        "totalActualVisits": total_actual_visits,
        "visitAchievementPct": visit_achievement_pct,
        "notSeenCount": not_seen_count,
        "notSeenPct": not_seen_pct,
        "totalUniqueCustomers": total_unique_customers,
        "totalSharedCustomers": row_count,
    }
    logger.info("KPIs computed for latest period '%s': %s", latest_period, kpis)
    return kpis


def build_trend(df: pd.DataFrame, roster: pd.DataFrame, logger: logging.Logger) -> dict:
    """Monthly trend series (Coverage%, Right Freq%, Headcount, Active,
    Resigned) across every period found in the workbook, in chronological
    order regardless of text casing."""
    periods = (
        roster.dropna(subset=["PeriodOrder"])[["Period", "PeriodOrder"]]
        .drop_duplicates()
        .sort_values("PeriodOrder")
    )

    rows = []
    for _, prow in periods.iterrows():
        period = prow["Period"]
        active_rows = df[(df["Period"] == period) & (df["IsActive"])]
        period_roster = roster[roster["Period"] == period]
        active_roster = period_roster[period_roster["IsActive"]]
        active_headcount = int(len(active_roster))
        row_count = len(active_rows)
        freq_sum = int(active_rows["Frequency"].fillna(0).sum())
        visits_sum = int(active_rows["Visits Count"].fillna(0).sum())
        covered_sum = int(active_rows["Covered Doctors"].fillna(0).sum())
        rows.append({
            "period": period,
            "coveragePct": safe_round(active_rows["Covered Doctors"].mean()) if row_count else None,
            "rightFreqPct": safe_round(active_rows["Right Freq"].mean()) if row_count else None,
            "headcount": active_headcount,
            "activeReps": active_headcount,
            "resignedReps": int(period_roster["IsResigned"].sum()),
            "vacancyCount": count_vacant_slots(df, period)["total"],
            "customersPerRep": round(row_count / active_headcount, 2) if active_headcount else None,
            # Visit / not-seen fields (mirrors analytics.js trend.series shape)
            "totalTargetVisits": freq_sum,
            "totalActualVisits": visits_sum,
            "visitAchievementPct": safe_round(visits_sum / freq_sum) if freq_sum else None,
            "notSeenCount": row_count - covered_sum,
            "notSeenPct": safe_round((row_count - covered_sum) / row_count) if row_count else None,
            "totalUniqueCustomers": int(active_rows["Customer Name"].nunique()),
            "totalSharedCustomers": row_count,
        })

    logger.info("Trend built across %d periods", len(rows))
    return {
        "periods": [r["period"] for r in rows],
        "series": rows,
    }


def build_team_comparison(df: pd.DataFrame, roster: pd.DataFrame, latest_period: str, logger: logging.Logger) -> list[dict]:
    """Team-level comparison for the latest period: headcount, coverage,
    right frequency, customers/rep, resignations."""
    rollup = coverage_rollup(df, "Team", latest_period).set_index("Team")
    latest_roster = roster[roster["Period"] == latest_period]
    active_roster = latest_roster[latest_roster["IsActive"]]

    headcount_by_team = active_roster.groupby("Team")["Employee Code"].nunique()
    resigned_by_team = latest_roster[latest_roster["IsResigned"]].groupby("Team")["Employee Code"].nunique()

    teams = sorted(set(headcount_by_team.index) | set(rollup.index))
    result = []
    for team in teams:
        hc = int(headcount_by_team.get(team, 0))
        resigned = int(resigned_by_team.get(team, 0))
        row = rollup.loc[team] if team in rollup.index else None
        result.append({
            "team": team,
            "headcount": hc,
            "resignedCount": resigned,
            "attritionRate": safe_round(resigned / (hc + resigned)) if (hc + resigned) else 0.0,
            "coveragePct": safe_round(row["CoveragePct"]) if row is not None else None,
            "rightFreqPct": safe_round(row["RightFreqPct"]) if row is not None else None,
            "customersPerRep": safe_round(row["CustomerRows"] / hc, 2) if row is not None and hc else None,
        })
    # Secondary sort key (team name) makes ties deterministic -- otherwise
    # teams tied at the same coverage% could reorder between this
    # server-computed cache and analytics.js's client-side recompute.
    result.sort(key=lambda r: (r["coveragePct"] is None, -(r["coveragePct"] or 0), r["team"]))
    logger.info("Team comparison built: %d teams", len(result))
    return result


def build_hierarchy_ranking(df: pd.DataFrame, roster: pd.DataFrame, group_col: str,
                             roster_group_col: str, latest_period: str, extra_cols: list[str] | None = None) -> list[dict]:
    """Generic ranking builder for Manager / Area Manager levels: span of
    control (distinct headcount), row-weighted coverage/right-freq, and a
    vacant/filled status flag."""
    rollup = coverage_rollup(df, group_col, latest_period).set_index(group_col)
    latest_roster = roster[roster["Period"] == latest_period]
    active_roster = latest_roster[latest_roster["IsActive"]]
    span = active_roster.groupby(roster_group_col)["Employee Code"].nunique()

    keys = sorted(set(rollup.index) | set(span.index))
    result = []
    for key in keys:
        row = rollup.loc[key] if key in rollup.index else None
        entry = {
            "name": key,
            "status": "Vacant" if str(key).upper().startswith(VACANT_PREFIX) else "Filled",
            "span": int(span.get(key, 0)),
            "coveragePct": safe_round(row["CoveragePct"]) if row is not None else None,
            "rightFreqPct": safe_round(row["RightFreqPct"]) if row is not None else None,
        }
        result.append(entry)

    # Secondary sort key (name) for deterministic tie order -- see the
    # matching note on build_team_comparison().
    result.sort(key=lambda r: (r["coveragePct"] is None, -(r["coveragePct"] or 0), r["name"]))
    return result


def build_specialty_class_coverage(df: pd.DataFrame, group_col: str, latest_period: str, logger: logging.Logger) -> list[dict]:
    """Coverage %/Right Freq % broken down by a customer attribute
    (Specialty or Class). This must come from the raw rows -- Specialty and
    Class vary per customer, not per employee, so the roster (employee
    grain) cannot answer this."""
    rollup = coverage_rollup(df, group_col, latest_period)
    rollup = rollup.rename(columns={group_col: "name"})
    rollup = rollup.sort_values("CustomerRows", ascending=False).head(TOP_N_SPECIALTY_CLASS)
    result = [
        {
            "name": r["name"],
            "customerCount": int(r["CustomerRows"]),
            "coveragePct": safe_round(r["CoveragePct"]),
            "rightFreqPct": safe_round(r["RightFreqPct"]),
        }
        for _, r in rollup.iterrows()
    ]
    logger.info("%s coverage built: %d rows", group_col, len(result))
    return result


def build_leaderboards(roster: pd.DataFrame, latest_period: str, logger: logging.Logger) -> dict:
    """Top/Bottom employees by Coverage % in the latest period, excluding
    reps with too few customers to rank meaningfully."""
    latest_active = roster[(roster["Period"] == latest_period) & (roster["IsActive"])]
    qualified = latest_active[latest_active["CustomerCount"] >= MIN_CUSTOMERS_FOR_LEADERBOARD]

    def to_rows(sub: pd.DataFrame) -> list[dict]:
        return [
            {
                "employee": r["Employee"],
                "profile": r["Profile"],
                "team": r["Team"],
                "manager": r["Manager"],
                "customerCount": int(r["CustomerCount"]),
                "coveragePct": safe_round(r["CoveragePct"]),
                "rightFreqPct": safe_round(r["RightFreqPct"]),
            }
            for _, r in sub.iterrows()
        ]

    top_sorted = qualified.sort_values(["CoveragePct", "Employee"], ascending=[False, True])
    bottom_sorted = qualified.sort_values(["CoveragePct", "Employee"], ascending=[True, True])

    logger.info("Leaderboards built: %d qualified reps (>= %d customers)", len(qualified), MIN_CUSTOMERS_FOR_LEADERBOARD)
    return {"top": to_rows(top_sorted), "bottom": to_rows(bottom_sorted)}


def build_attrition_panel(roster: pd.DataFrame, logger: logging.Logger) -> dict:
    """Attrition rate by period and by team, for the Attrition Panel."""
    by_period = []
    periods = roster.dropna(subset=["PeriodOrder"])[["Period", "PeriodOrder"]].drop_duplicates().sort_values("PeriodOrder")
    for _, prow in periods.iterrows():
        period = prow["Period"]
        period_roster = roster[roster["Period"] == period]
        active = int(period_roster["IsActive"].sum())
        resigned = int(period_roster["IsResigned"].sum())
        by_period.append({
            "period": period,
            "activeReps": active,
            "resignedReps": resigned,
            "attritionRate": safe_round(resigned / (active + resigned)) if (active + resigned) else 0.0,
        })

    latest_period = periods["Period"].iloc[-1]
    latest_roster = roster[roster["Period"] == latest_period]
    by_team = []
    for team, sub in latest_roster.groupby("Team"):
        active = int(sub["IsActive"].sum())
        resigned = int(sub["IsResigned"].sum())
        by_team.append({
            "team": team,
            "activeReps": active,
            "resignedReps": resigned,
            "attritionRate": safe_round(resigned / (active + resigned)) if (active + resigned) else 0.0,
        })
    by_team.sort(key=lambda r: (-(r["attritionRate"] or 0), r["team"]))

    logger.info("Attrition panel built: %d periods, %d teams", len(by_period), len(by_team))
    return {"byPeriod": by_period, "byTeam": by_team}


def build_vacancy_panel(df: pd.DataFrame, latest_period: str, logger: logging.Logger) -> dict:
    """Vacancy detail for the Vacancy Panel: overall counts plus the
    specific vacant slots (which team, which level)."""
    period_df = df[df["Period"] == latest_period]
    overall = count_vacant_slots(df, latest_period)

    details = []
    for level_col, label in (("Manager", "Manager"), ("Area Manager", "Area Manager"), ("National Sales Manager", "NSM")):
        vacant_col = f"{level_col}_IsVacant"
        vacant_rows = period_df.loc[period_df[vacant_col], [level_col, "Team"]].drop_duplicates()
        for _, r in vacant_rows.iterrows():
            details.append({"level": label, "team": r["Team"], "slot": r[level_col]})

    by_team = {}
    for d in details:
        by_team.setdefault(d["team"], 0)
        by_team[d["team"]] += 1
    by_team_list = [{"team": team, "vacancyCount": count} for team, count in sorted(by_team.items(), key=lambda kv: -kv[1])]

    logger.info("Vacancy panel built: %d total vacant slots", overall["total"])
    return {"total": overall["total"], "byLevel": overall, "byTeam": by_team_list, "details": details}


def build_dimensions(df: pd.DataFrame, roster: pd.DataFrame) -> dict:
    """Distinct values for every filterable field -- powers the filter
    dropdowns (Phase 3) and doubles as the dictionary-encoding lookup
    tables for the compact row-level records cache.

    Employee identity is keyed by Employee Code, not Employee name: the
    same code occasionally has more than one name spelling within a
    period (see the "inconsistent_employee_identity" validation check),
    and grouping by name would silently split one real employee into two
    -- or, worse, silently merge two different employees who happen to
    share a name. `employeeCodes` is the canonical identity used for
    encoding; `employeeNames` is the parallel, same-order display label
    (each employee's first-seen name) used only for showing/filtering by
    a human-readable name in the UI.
    """
    periods_sorted = (
        roster.dropna(subset=["PeriodOrder"])[["Period", "PeriodOrder"]]
        .drop_duplicates().sort_values("PeriodOrder")["Period"].tolist()
    )

    code_to_name = df.groupby("Employee Code")["Employee"].first()
    employee_codes = sorted(code_to_name.index.tolist())
    employee_names = [code_to_name[c] for c in employee_codes]

    return {
        "periods": periods_sorted,
        "teams": sorted(df["Team"].dropna().astype(str).unique().tolist()),
        "businessUnits": sorted(df["Business Unit"].dropna().astype(str).unique().tolist()),
        "nsms": sorted(df["National Sales Manager"].dropna().astype(str).unique().tolist()),
        "areaManagers": sorted(df["Area Manager"].dropna().astype(str).unique().tolist()),
        "managers": sorted(df["Manager"].dropna().astype(str).unique().tolist()),
        "employeeCodes": employee_codes,
        "employeeNames": employee_names,
        "customerNames": sorted(df["Customer Name"].dropna().astype(str).unique().tolist()),
        "profiles": sorted(df["Profile"].dropna().astype(str).unique().tolist()),
        "titles": sorted(df["Title"].dropna().astype(str).unique().tolist()),
        "specialties": sorted(df["Specialty"].dropna().astype(str).unique().tolist()),
        "classes": sorted(df["Class"].dropna().astype(str).unique().tolist()),
        "statuses": sorted(df["Active"].dropna().astype(str).unique().tolist()),
        "experiences": sorted(df["Experience"].dropna().astype(str).unique().tolist()),
        "types": sorted(df["Type"].dropna().astype(str).unique().tolist()),
        "lastVisitDates": sorted(df["Last Visit Date String"].unique().tolist()),
        "areas": sorted(df["Area"].dropna().astype(str).unique().tolist()),
    }


# Field -> (source column, dimension key) for the dictionary-encoded
# records cache. Order here defines the row-array column order shipped
# to the browser; keep it in sync with js/analytics.js RECORD_FIELDS.
# employeeIdx is encoded against "employeeCodes" (the true identity key),
# not the "employeeNames" display dimension -- see build_dimensions().
RECORD_DIMENSION_FIELDS = [
    ("periodIdx", "Period", "periods"),
    ("teamIdx", "Team", "teams"),
    ("businessUnitIdx", "Business Unit", "businessUnits"),
    ("nsmIdx", "National Sales Manager", "nsms"),
    ("areaManagerIdx", "Area Manager", "areaManagers"),
    ("managerIdx", "Manager", "managers"),
    ("employeeIdx", "Employee Code", "employeeCodes"),
    ("specialtyIdx", "Specialty", "specialties"),
    ("classIdx", "Class", "classes"),
    ("statusIdx", "Active", "statuses"),
    ("experienceIdx", "Experience", "experiences"),
    ("typeIdx",       "Type",       "types"),
]


def build_records(df: pd.DataFrame, dimensions: dict, logger: logging.Logger) -> dict:
    """Dictionary-encoded row-level records: every categorical column is
    replaced by its integer index into `dimensions`, cutting JSON size
    dramatically (Team/Manager/Specialty names repeat across tens of
    thousands of rows). This is what analytics.js re-aggregates in the
    browser (via Maps/groupBy, single pass) whenever a filter changes --
    the whole reason it exists is so filtering never requires touching
    the workbook or re-running refresh.py.
    """
    t0 = time.time()
    columns = []
    field_names = []
    for field_name, source_col, dim_key in RECORD_DIMENSION_FIELDS:
        lookup = {v: i for i, v in enumerate(dimensions[dim_key])}
        columns.append(df[source_col].astype(str).map(lookup).fillna(-1).astype(int).to_numpy())
        field_names.append(field_name)

    columns.append(df["Covered Doctors"].fillna(0).astype(int).to_numpy())
    field_names.append("coveredDoctor")
    columns.append(df["Right Freq"].fillna(0).astype(int).to_numpy())
    field_names.append("rightFreq")
    columns.append(df["Visits Count"].fillna(0).astype(int).to_numpy())
    field_names.append("visits")
    columns.append(df["IsActive"].astype(int).to_numpy())
    field_names.append("isActive")
    # Needed so the browser can recompute "Average Frequency Achievement"
    # per the same mean(Actual Plan Coverage) definition build_kpis() uses --
    # stored x1000 as an integer (not a float) to keep the JSON compact;
    # analytics.js divides back down by 1000 when reading this field.
    columns.append((df["Actual Plan Coverage"].fillna(0) * 1000).round().astype(int).to_numpy())
    field_names.append("actualPlanCoverageX1000")
    # Plans Count = planned visits per rep-customer row (what the rep scheduled).
    # Kept for potential future use; not the headline "Target Visits" KPI.
    columns.append(df["Plans Count"].fillna(0).astype(int).to_numpy())
    field_names.append("plansCount")
    # Title (job title / rep grade) — categorical dimension encoded as index
    # into dimensions["titles"]. Field 18. Added for cross-filter support so
    # users can slice every metric by rep grade (e.g. "Senior Medical Rep").
    title_lookup = {v: i for i, v in enumerate(dimensions["titles"])}
    columns.append(df["Title"].astype(str).map(title_lookup).fillna(-1).astype(int).to_numpy())
    field_names.append("titleIdx")
    # Customer Name — dictionary-encoded for the "Not Seen" modal drill-down.
    cname_lookup = {v: i for i, v in enumerate(dimensions["customerNames"])}
    columns.append(df["Customer Name"].astype(str).map(cname_lookup).fillna(-1).astype(int).to_numpy())
    field_names.append("customerNameIdx")
    # Profile = employee's territory assignment (e.g. "CHC NEW CAIRO").
    # Encoded as index into dimensions["profiles"]. Field 19 → titleIdx is 18, so this is 19+1=20.
    profile_lookup = {v: i for i, v in enumerate(dimensions["profiles"])}
    columns.append(df["Profile"].astype(str).map(profile_lookup).fillna(-1).astype(int).to_numpy())
    field_names.append("profileIdx")
    # Frequency = commercially mandated target visits per customer per period.
    # Summed across rows gives Total Target Visits (the commercial standard).
    # This is distinct from Plans Count (which is what the rep actually scheduled).
    columns.append(df["Frequency"].fillna(0).astype(int).to_numpy())
    field_names.append("frequency")
    # Last Visit Date
    lv_lookup = {v: i for i, v in enumerate(dimensions["lastVisitDates"])}
    columns.append(df["Last Visit Date String"].map(lv_lookup).fillna(-1).astype(int).to_numpy())
    field_names.append("lastVisitDateIdx")
    # Area
    area_lookup = {v: i for i, v in enumerate(dimensions["areas"])}
    columns.append(df["Area"].astype(str).map(area_lookup).fillna(-1).astype(int).to_numpy())
    field_names.append("areaIdx")

    rows = np.column_stack(columns).tolist()
    logger.info("Records cache built: %d rows x %d fields in %.2fs", len(rows), len(field_names), time.time() - t0)
    return {"fields": field_names, "rows": rows}


def build_data_quality_summary(validation: ValidationResult) -> dict:
    return {
        "errors": validation.errors,
        "warnings": validation.warnings,
        "stats": validation.stats,
    }


def build_type_distribution(df: pd.DataFrame, latest_period: str) -> list[dict]:
    """Customer Type Distribution for the latest period (mirrors analytics.js typeDistribution)."""
    active_rows = df[(df["Period"] == latest_period) & (df["IsActive"])]
    if active_rows.empty:
        return []
    counts = active_rows.groupby("Type", dropna=True).size().reset_index(name="count")
    result = [{"name": row["Type"], "count": int(row["count"])} for _, row in counts.iterrows()]
    result.sort(key=lambda r: -r["count"])
    return result


def build_rf_insights(df: pd.DataFrame, latest_period: str,
                      spec_cov: list[dict], class_cov: list[dict],
                      roster: pd.DataFrame, logger: logging.Logger) -> dict:
    """RF Narrative Intelligence (mirrors analytics.js rfInsights block).
    Uses pre-computed specialtyCoverage / classCoverage for rfBySpecialty / rfByClass
    and recomputes per-employee RF for top5/bottom5 and at-risk counts."""
    MIN_CUSTOMERS = 10
    MIN_LEADERBOARD = 20

    # rfByClass / rfBySpecialty: filter min 10 customers, sort desc by rightFreqPct
    rf_by_class = [
        c for c in class_cov
        if c.get("customerCount", 0) >= MIN_CUSTOMERS and c.get("rightFreqPct") is not None
    ]
    rf_by_class.sort(key=lambda c: -(c["rightFreqPct"] or 0))

    rf_by_specialty = [
        s for s in spec_cov
        if s.get("customerCount", 0) >= MIN_CUSTOMERS and s.get("rightFreqPct") is not None
    ]
    rf_by_specialty.sort(key=lambda s: -(s["rightFreqPct"] or 0))

    # rfByExperience: group active latest-period rows by experience (Experience)
    active_rows = df[(df["Period"] == latest_period) & (df["IsActive"])]
    latest_roster = roster[roster["Period"] == latest_period]
    active_roster = latest_roster[latest_roster["IsActive"]]

    exp_groups = active_rows.groupby("Experience", dropna=True).agg(
        rightFreqSum=("Right Freq", "sum"),
        rowCount=("Right Freq", "count"),
    ).reset_index()
    emp_per_exp = active_roster.groupby("Experience")["Employee Code"].nunique().reset_index(name="empCount")
    exp_groups = exp_groups.merge(emp_per_exp, on="Experience", how="left")

    rf_by_experience = []
    for _, row in exp_groups.iterrows():
        rf_pct = safe_round(row["rightFreqSum"] / row["rowCount"]) if row["rowCount"] else None
        rf_by_experience.append({
            "experience": row["Experience"],
            "rfPct": rf_pct,
            "empCount": int(row.get("empCount", 0) or 0),
            "rowCount": int(row["rowCount"]),
        })

    # rfTop5 / rfBottom5: per-employee RF% for latest period, ≥5 customers
    emp_rf = active_rows.groupby("Employee", dropna=True).agg(
        rightFreqSum=("Right Freq", "sum"),
        customerCount=("Right Freq", "count"),
        team=("Team", "first"),
    ).reset_index()
    emp_rf = emp_rf[emp_rf["customerCount"] >= MIN_LEADERBOARD].copy()
    emp_rf["rfPct"] = emp_rf.apply(
        lambda r: safe_round(r["rightFreqSum"] / r["customerCount"]) if r["customerCount"] else None, axis=1
    )
    emp_rf = emp_rf[emp_rf["rfPct"].notna()].sort_values("rfPct", ascending=False)

    def to_rf_row(r):
        return {
            "name": r["Employee"],
            "team": r["team"],
            "rfPct": r["rfPct"],
            "customerCount": int(r["customerCount"]),
        }

    rf_top10 = [to_rf_row(r) for _, r in emp_rf.head(10).iterrows()]
    rf_bottom10 = [to_rf_row(r) for _, r in emp_rf.tail(10).sort_values("rfPct").iterrows()]

    # At-risk customers: row-level zero right frequency divided into 3 tiers
    at_risk_rows = active_rows[active_rows["Right Freq"] == 0]
    tier1_list = []
    tier2_list = []
    tier3_list = []

    for _, row in at_risk_rows.iterrows():
        freq = int(row.get("Frequency", 0) or 0)
        visits = int(row.get("Visits Count", 0) or 0)
        missed = freq - visits
        doc_info = {
            "customerName": str(row.get("Customer Name", "")),
            "specialty": str(row.get("Specialty", "")),
            "klass": str(row.get("Class", "")),
            "type": str(row.get("Type", "")),
            "employee": str(row.get("Employee", "")),
            "team": str(row.get("Team", "")),
            "manager": str(row.get("Manager", "")),
            "frequency": freq,
            "visits": visits,
            "missedCalls": missed,
            "lastVisitDate": str(row.get("Last Visit Date String", "Never")),
            "area": str(row.get("Area", "")),
        }
        if missed == 1:
            tier1_list.append(doc_info)
        elif missed == 2:
            tier2_list.append(doc_info)
        elif missed >= 3:
            tier3_list.append(doc_info)

    at_risk_tiers = {
        "tier1": {"count": len(tier1_list), "list": tier1_list},
        "tier2": {"count": len(tier2_list), "list": tier2_list},
        "tier3": {"count": len(tier3_list), "list": tier3_list},
    }

    at_risk_count = len(tier1_list) + len(tier2_list) + len(tier3_list)
    total_customers = len(active_rows)
    overall_rf_pct = safe_round(active_rows["Right Freq"].mean()) if len(active_rows) else None

    logger.info("RF insights built: atRiskCount=%d, totalCustomers=%d", at_risk_count, total_customers)
    return {
        "overallRfPct": overall_rf_pct,
        "rfByClass": rf_by_class,
        "rfBySpecialty": rf_by_specialty,
        "rfByExperience": rf_by_experience,
        "rfTop10": rf_top10,
        "rfBottom10": rf_bottom10,
        "atRiskCount": at_risk_count,
        "totalCustomers": total_customers,
        "atRiskTiers": at_risk_tiers,
    }


def build_quarterly_kol_coverage(df: pd.DataFrame, roster: pd.DataFrame, logger: logging.Logger) -> list[dict]:
    """Per-employee quarterly KOL coverage (mirrors analytics.js getKolCoverage()).
    Q1 = Feb + Mar, Q2 = Apr + May + Jun. Period filter intentionally ignored."""
    Q1_MONTHS = {"february", "feb", "march", "mar"}
    Q2_MONTHS = {"april", "apr", "may", "june", "jun"}

    def quarter_of(period: str) -> str | None:
        p = period.lower()
        if any(m in p for m in Q1_MONTHS):
            return "q1"
        if any(m in p for m in Q2_MONTHS):
            return "q2"
        return None

    df2 = df[df["IsActive"]].copy()
    df2["Quarter"] = df2["Period"].map(quarter_of)
    df2 = df2[df2["Quarter"].notna()]

    if df2.empty:
        return []

    # For each employee+quarter: unique customers and whether each was covered
    result_rows = []
    for emp, emp_group in df2.groupby("Employee", dropna=True):
        team = emp_group["Team"].iloc[0]
        profile = emp_group["Profile"].iloc[0] if "Profile" in emp_group.columns else ""
        title = emp_group["Title"].iloc[0] if "Title" in emp_group.columns else ""

        def quarter_stats(qdf):
            if qdf.empty:
                return {"total": 0, "covered": 0, "coveragePct": None, "notSeen": 0, "notSeenList": []}
            # A customer is covered if covered in ANY row for that quarter
            cust_covered = qdf.groupby("Customer Name")["Covered Doctors"].max()
            total = int(len(cust_covered))
            covered = int((cust_covered > 0).sum())
            not_seen_custs = cust_covered[cust_covered == 0].index.tolist()
            # Build notSeenList with metadata from first occurrence
            not_seen_list = []
            for cname in sorted(not_seen_custs):
                crows = qdf[qdf["Customer Name"] == cname].iloc[0]
                not_seen_list.append({
                    "customerName": cname,
                    "specialty": crows.get("Specialty", ""),
                    "klass": crows.get("Class", ""),
                    "type": crows.get("Type", ""),
                    "frequency": int(crows.get("Frequency", 0) or 0),
                })
            return {
                "total": total,
                "covered": covered,
                "coveragePct": safe_round(covered / total) if total else None,
                "notSeen": total - covered,
                "notSeenList": not_seen_list,
            }

        q1 = quarter_stats(emp_group[emp_group["Quarter"] == "q1"])
        q2 = quarter_stats(emp_group[emp_group["Quarter"] == "q2"])

        if q1["total"] + q2["total"] == 0:
            continue

        all_custs = set(emp_group["Customer Name"].dropna())
        kol_count = len(all_custs)

        result_rows.append({
            "name": emp,
            "profile": profile,
            "team": team,
            "title": title,
            "kolCount": kol_count,
            "q1Total": q1["total"], "q1Covered": q1["covered"],
            "q1CoveragePct": q1["coveragePct"], "q1NotSeen": q1["notSeen"],
            "q1NotSeenList": q1["notSeenList"],
            "q2Total": q2["total"], "q2Covered": q2["covered"],
            "q2CoveragePct": q2["coveragePct"], "q2NotSeen": q2["notSeen"],
            "q2NotSeenList": q2["notSeenList"],
        })

    result_rows.sort(key=lambda r: r["name"])
    logger.info("Quarterly KOL coverage built: %d employees", len(result_rows))
    return result_rows


def build_kpi_deltas(kpis: dict, trend: dict) -> dict | None:
    """Period-over-period KPI delta indicators (mirrors analytics.js buildKpiDeltas).
    Computes delta between latest period and the one before it in trend.series."""
    series = trend.get("series", [])
    if len(series) < 2:
        return None

    current = series[-1]
    prev = series[-2]

    def diff(curr_val, prev_val, rounder=None):
        if curr_val is None or prev_val is None:
            return None
        d = curr_val - prev_val
        return round(d, 4) if rounder is None else rounder(d)

    return {
        "previousPeriod": prev["period"],
        "activeReps":          {"previous": prev.get("activeReps"),          "delta": diff(kpis.get("activeReps"),          prev.get("activeReps"))},
        "resignedReps":        {"previous": prev.get("resignedReps"),        "delta": diff(kpis.get("resignedReps"),        prev.get("resignedReps"))},
        "coveragePct":         {"previous": prev.get("coveragePct"),         "delta": diff(kpis.get("coveragePct"),         prev.get("coveragePct"))},
        "rightFreqPct":        {"previous": prev.get("rightFreqPct"),        "delta": diff(kpis.get("rightFreqPct"),        prev.get("rightFreqPct"))},
        "customersPerRep":     {"previous": prev.get("customersPerRep"),     "delta": diff(kpis.get("customersPerRep"),     prev.get("customersPerRep"))},
        "vacancyCount":        {"previous": prev.get("vacancyCount"),        "delta": diff(kpis.get("vacancyCount"),        prev.get("vacancyCount"))},
        "totalTargetVisits":   {"previous": prev.get("totalTargetVisits"),   "delta": diff(kpis.get("totalTargetVisits"),   prev.get("totalTargetVisits"))},
        "totalActualVisits":   {"previous": prev.get("totalActualVisits"),   "delta": diff(kpis.get("totalActualVisits"),   prev.get("totalActualVisits"))},
        "visitAchievementPct": {"previous": prev.get("visitAchievementPct"), "delta": diff(kpis.get("visitAchievementPct"), prev.get("visitAchievementPct"))},
        "notSeenCount":        {"previous": prev.get("notSeenCount"),        "delta": diff(kpis.get("notSeenCount"),        prev.get("notSeenCount"))},
        "notSeenPct":          {"previous": prev.get("notSeenPct"),          "delta": diff(kpis.get("notSeenPct"),          prev.get("notSeenPct"))},
        "totalUniqueCustomers":{"previous": prev.get("totalUniqueCustomers"),"delta": diff(kpis.get("totalUniqueCustomers"), prev.get("totalUniqueCustomers"))},
        "totalSharedCustomers":{"previous": prev.get("totalSharedCustomers"),"delta": diff(kpis.get("totalSharedCustomers"), prev.get("totalSharedCustomers"))},
    }


def run_aggregation_engine(df: pd.DataFrame, validation: ValidationResult, logger: logging.Logger) -> tuple[dict, dict, str]:
    """Orchestrates every aggregation object the dashboard needs and
    returns (dashboard_cache, records_cache, latest_period)."""
    df = df.copy()
    df["Last Visit Date String"] = df["Last Visit Date"].dt.strftime("%B").fillna("Never")
    roster = build_roster(df, logger)
    latest_period, _ = get_latest_period(roster)
    logger.info("Latest period resolved: %s", latest_period)

    kpis       = build_kpis(df, roster, latest_period, logger)
    trend      = build_trend(df, roster, logger)
    spec_cov   = build_specialty_class_coverage(df, "Specialty", latest_period, logger)
    class_cov  = build_specialty_class_coverage(df, "Class", latest_period, logger)

    dashboard_cache = {
        "kpis": kpis,
        "kpiDeltas": build_kpi_deltas(kpis, trend),
        "trend": trend,
        "teamComparison": build_team_comparison(df, roster, latest_period, logger),
        "managerRanking": build_hierarchy_ranking(df, roster, "Manager", "Manager", latest_period),
        "areaManagerRanking": build_hierarchy_ranking(df, roster, "Area Manager", "AreaManager", latest_period),
        "specialtyCoverage": spec_cov,
        "classCoverage": class_cov,
        "typeDistribution": build_type_distribution(df, latest_period),
        "rfInsights": build_rf_insights(df, latest_period, spec_cov, class_cov, roster, logger),
        "quarterlyCustomerCoverage": build_quarterly_kol_coverage(df, roster, logger),
        "leaderboards": build_leaderboards(roster, latest_period, logger),
        "attrition": build_attrition_panel(roster, logger),
        "vacancies": build_vacancy_panel(df, latest_period, logger),
        "dataQuality": build_data_quality_summary(validation),
        "dimensions": build_dimensions(df, roster),
        "latestPeriod": latest_period,
    }

    records_cache = build_records(df, dashboard_cache["dimensions"], logger)
    return dashboard_cache, records_cache, latest_period


# ---------------------------------------------------------------------------
# STEP 6: CACHE OUTPUT
# ---------------------------------------------------------------------------

def _json_default(value: Any) -> Any:
    """json.dumps() hook for pandas/numpy/datetime types."""
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.strftime("%Y-%m-%d") if not pd.isna(value) else None
    if pd.isna(value):
        return None
    if hasattr(value, "item"):  # numpy scalar
        return value.item()
    return str(value)


def write_cache_pair(data: dict, json_path: Path, js_path: Path, js_var_name: str, logger: logging.Logger) -> None:
    """Write both a plain .json file (for tooling/portability) and a
    .data.js wrapper (window.<var> = {...};) that dashboard.html loads via
    a <script> tag. The .data.js form is what the dashboard actually reads:
    file:// pages cannot fetch() local JSON due to Chrome's CORS policy on
    the file protocol, but a <script src="..."> tag has no such
    restriction, which is what makes double-click-to-open work reliably."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, default=_json_default, ensure_ascii=False)

    json_path.write_text(payload, encoding="utf-8")
    js_path.write_text(f"window.{js_var_name} = {payload};\n", encoding="utf-8")
    logger.info("Wrote %s (%.1f KB) and %s", json_path.name, json_path.stat().st_size / 1024, js_path.name)


def run_organogram_aggregation(organogram_path: Path, df_coverage: pd.DataFrame, logger: logging.Logger) -> dict:
    t0 = time.time()
    logger.info("Parsing organogram workbook...")
    df_org = pd.read_excel(organogram_path, sheet_name="Details")
    df_org = df_org.loc[:, ~df_org.columns.str.contains('^Unnamed')]

    # Standardize columns
    df_org["Line"] = df_org["Line"].astype(str).str.strip().str.upper()
    df_org["Medical Rep"] = df_org["Medical Rep"].astype(str).str.strip()
    df_org["Position"] = df_org["Position"].astype(str).str.strip()

    # Position-level vacancy mapping
    df_pos = df_org.drop_duplicates(subset=["Position"])
    
    # 1. Vacancy by Line
    line_stats = []
    for line, g in df_pos.groupby("Line"):
        total = len(g)
        vac = g["Medical Rep"].astype(str).str.contains("VACANT", case=False, na=True).sum()
        active = total - vac
        vac_pct = (vac / total * 100) if total > 0 else 0
        line_stats.append({
            "line": line,
            "total": int(total),
            "active": int(active),
            "vacant": int(vac),
            "vacancyRate": round(vac_pct, 1)
        })
    line_stats = sorted(line_stats, key=lambda x: x["vacancyRate"], reverse=True)

    # 2. Vacancy by Manager
    manager_vacancy = []
    for dm, g in df_pos.groupby("District Manager"):
        if pd.isna(dm) or dm == "" or "VACANT" in str(dm).upper():
            continue
        total = len(g)
        vac = g["Medical Rep"].astype(str).str.contains("VACANT", case=False, na=True).sum()
        active = total - vac
        vac_pct = (vac / total * 100) if total > 0 else 0
        manager_vacancy.append({
            "manager": dm,
            "line": g["Line"].iloc[0] if len(g) > 0 else "",
            "total": int(total),
            "active": int(active),
            "vacant": int(vac),
            "vacancyRate": round(vac_pct, 1)
        })
    manager_vacancy = sorted(manager_vacancy, key=lambda x: x["vacancyRate"], reverse=True)[:15] # Top 15 managers with highest vacancy

    # 3. Vacant Positions list (Recruitment Priorities)
    vacant_positions_list = []
    df_vacant_rows = df_pos[df_pos["Medical Rep"].astype(str).str.contains("VACANT", case=False, na=True)]
    for _, r in df_vacant_rows.iterrows():
        vacant_positions_list.append({
            "position": str(r["Position"]),
            "line": str(r["Line"]),
            "bum": str(r["BUM"]) if not pd.isna(r["BUM"]) else "",
            "nsm": str(r["NSM"]) if not pd.isna(r["NSM"]) else "",
            "asm": str(r["ASM"]) if not pd.isna(r["ASM"]) else "",
            "dm": str(r["District Manager"]) if not pd.isna(r["District Manager"]) else "",
            "area": str(r["Area"]) if not pd.isna(r["Area"]) else "",
            "district": str(r["District"]) if not pd.isna(r["District"]) else ""
        })

    # 4. Span of Control
    # DMs reporting to ASMs
    dm_positions = df_pos.drop_duplicates(subset=["District Manager"])
    # filter out vacant DMs
    dm_positions = dm_positions[~dm_positions["District Manager"].astype(str).str.upper().str.startswith("VACANT")]
    asm_groups = dm_positions.groupby("ASM")
    asm_span = asm_groups["District Manager"].nunique()
    asm_span_list = []
    for asm, count in asm_span.items():
        if pd.isna(asm) or asm == "" or "VACANT" in str(asm).upper():
            continue
        line = dm_positions[dm_positions["ASM"] == asm]["Line"].iloc[0] if asm in dm_positions["ASM"].values else ""
        asm_span_list.append({
            "managerName": asm,
            "line": line,
            "spanCount": int(count),
            "overloaded": count > 4
        })
    asm_span_list = sorted(asm_span_list, key=lambda x: x["spanCount"], reverse=True)

    # Reps reporting to DMs
    # filter out vacant reps
    active_rep_positions = df_pos[~df_pos["Medical Rep"].astype(str).str.upper().str.startswith("VACANT")]
    dm_groups = active_rep_positions.groupby("District Manager")
    dm_span = dm_groups["Medical Rep"].nunique()
    dm_span_list = []
    for dm, count in dm_span.items():
        if pd.isna(dm) or dm == "" or "VACANT" in str(dm).upper():
            continue
        line = active_rep_positions[active_rep_positions["District Manager"] == dm]["Line"].iloc[0] if dm in active_rep_positions["District Manager"].values else ""
        dm_span_list.append({
            "managerName": dm,
            "line": line,
            "spanCount": int(count),
            "overloaded": count > 8
        })
    dm_span_list = sorted(dm_span_list, key=lambda x: x["spanCount"], reverse=True)

    # 5. Brick Workload Distribution
    active_assignments = df_org[~df_org["Medical Rep"].astype(str).str.contains("VACANT", case=False, na=True)]
    rep_brick_counts = active_assignments.groupby("Medical Rep")["702 Bricks"].nunique()
    rep_details = []
    for rep, g in active_assignments.groupby("Medical Rep"):
        brick_count = g["702 Bricks"].nunique()
        first_row = g.iloc[0]
        rep_details.append({
            "rep": rep,
            "line": str(first_row["Line"]),
            "dm": str(first_row["District Manager"]) if not pd.isna(first_row["District Manager"]) else "",
            "asm": str(first_row["ASM"]) if not pd.isna(first_row["ASM"]) else "",
            "bricks": int(brick_count)
        })
    
    rep_details_sorted = sorted(rep_details, key=lambda x: x["bricks"], reverse=True)
    overloaded_reps_list = [r for r in rep_details_sorted if r["bricks"] > 30]

    # Bricks stats
    avg_bricks = float(rep_brick_counts.mean()) if len(rep_brick_counts) > 0 else 0.0
    brick_buckets = {
        "light": int((rep_brick_counts < 5).sum()),
        "balanced": int(((rep_brick_counts >= 5) & (rep_brick_counts <= 15)).sum()),
        "dense": int(((rep_brick_counts > 15) & (rep_brick_counts <= 30)).sum()),
        "overloaded": int((rep_brick_counts > 30).sum())
    }

    # 6. Hiring Date Normalization & Probation calculations on df_coverage (main workbook)
    # Rebuild a light roster from df_coverage
    df_cov_copy = df_coverage.copy()
    df_cov_copy["Period"] = df_cov_copy["Period"].astype(str).str.strip().str.title()
    df_cov_copy["PeriodOrder"] = df_cov_copy["Period"].str.lower().map(MONTH_ORDER)
    df_cov_copy["Employee Code"] = df_cov_copy["Employee Code"].apply(
        lambda v: str(int(v)) if isinstance(v, (int, float)) and not pd.isna(v) else str(v)
    )
    df_cov_copy["Hiring Date"] = pd.to_datetime(df_cov_copy["Hiring Date"], errors="coerce")
    df_cov_copy["Resignation Date"] = pd.to_datetime(df_cov_copy["Resignation Date"], errors="coerce")
    df_cov_copy["IsActive"] = df_cov_copy["Active"].astype(str).str.strip().str.title() == "Active"
    df_cov_copy["IsResigned"] = df_cov_copy["Active"].astype(str).str.strip().str.title() == "Resigned"

    roster = df_cov_copy.groupby(["Employee Code", "Period"], as_index=False).agg(
        PeriodOrder=("PeriodOrder", "first"),
        Employee=("Employee", "first"),
        Team=("Team", "first"),
        Active=("Active", "first"),
        IsActive=("IsActive", "first"),
        IsResigned=("IsResigned", "first"),
        HiringDate=("Hiring Date", "first"),
        ResignationDate=("Resignation Date", "first")
    ).sort_values("PeriodOrder")

    periods = roster["Period"].unique()
    periods_sorted = sorted(periods, key=lambda p: MONTH_ORDER.get(p.lower(), 99))

    probation_turnover_series = []
    non_probation_turnover_series = []

    def normalize_hiring_date(d):
        if pd.isna(d):
            return pd.NaT
        year = d.year
        month = d.month
        day = d.day
        if day <= 15:
            return pd.Timestamp(year=year, month=month, day=1)
        else:
            if month == 12:
                return pd.Timestamp(year=year+1, month=1, day=1)
            else:
                return pd.Timestamp(year=year, month=month+1, day=1)

    def period_to_timestamp(period_str):
        p_lower = str(period_str).lower().strip()
        for m_name, m_num in MONTH_ORDER.items():
            if m_name in p_lower:
                return pd.Timestamp(year=2026, month=m_num, day=1)
        return pd.Timestamp("2026-06-01")

    for p in periods_sorted:
        p_rost = roster[roster["Period"] == p].copy()
        p_date = period_to_timestamp(p)
        
        # Classify
        norm_hir = p_rost["HiringDate"].apply(normalize_hiring_date)
        probation_end = norm_hir + pd.DateOffset(months=3)
        p_rost["IsProbation"] = p_date < probation_end
        
        # Counts
        active_prob = int(p_rost[p_rost["IsActive"] & p_rost["IsProbation"]]["Employee Code"].count())
        active_non_prob = int(p_rost[p_rost["IsActive"] & ~p_rost["IsProbation"]]["Employee Code"].count())
        
        resigned_prob = int(p_rost[p_rost["IsResigned"] & p_rost["IsProbation"]]["Employee Code"].count())
        resigned_non_prob = int(p_rost[p_rost["IsResigned"] & ~p_rost["IsProbation"]]["Employee Code"].count())
        
        prob_rate = float(resigned_prob / (active_prob + resigned_prob)) if (active_prob + resigned_prob) > 0 else 0.0
        non_prob_rate = float(resigned_non_prob / (active_non_prob + resigned_non_prob)) if (active_non_prob + resigned_non_prob) > 0 else 0.0
        
        probation_turnover_series.append({
            "period": p,
            "active": active_prob,
            "resigned": resigned_prob,
            "rate": round(prob_rate * 100, 1)
        })
        non_probation_turnover_series.append({
            "period": p,
            "active": active_non_prob,
            "resigned": resigned_non_prob,
            "rate": round(non_prob_rate * 100, 1)
        })

    # June metrics (latest period)
    june_roster = roster[roster["Period"] == "June"].copy()
    june_date = period_to_timestamp("June")
    
    # Classify June
    june_norm_hir = june_roster["HiringDate"].apply(normalize_hiring_date)
    june_prob_end = june_norm_hir + pd.DateOffset(months=3)
    june_roster["IsProbation"] = june_date < june_prob_end
    
    current_probation_count = int(june_roster[june_roster["IsActive"] & june_roster["IsProbation"]]["Employee Code"].count())
    current_non_probation_count = int(june_roster[june_roster["IsActive"] & ~june_roster["IsProbation"]]["Employee Code"].count())
    
    # Ramp-up: Hired in last 6 months
    ramp_up_cutoff = june_date - pd.DateOffset(months=6)
    june_roster["IsRampUp"] = june_roster["HiringDate"] >= ramp_up_cutoff
    current_ramp_up_count = int(june_roster[june_roster["IsActive"] & june_roster["IsRampUp"]]["Employee Code"].count())
    total_active_june = current_probation_count + current_non_probation_count
    current_ramp_up_rate = float(current_ramp_up_count / total_active_june * 100) if total_active_june > 0 else 0.0

    # Average tenure in months for active June reps
    active_june_reps = june_roster[june_roster["IsActive"] & june_roster["HiringDate"].notna()]
    tenure_days = (june_date - active_june_reps["HiringDate"]).dt.days
    tenure_months = tenure_days / 30.4375
    avg_rep_tenure_months = float(tenure_months.mean()) if len(tenure_months) > 0 else 0.0

    # Training needs alerts by team/line
    training_alerts = []
    for team, g in june_roster[june_roster["IsActive"]].groupby("Team"):
        tot_active = len(g)
        prob_count = g["IsProbation"].sum()
        prob_pct = (prob_count / tot_active * 100) if tot_active > 0 else 0.0
        
        if prob_pct > 15: # Alert if >15% of team is in probation
            training_alerts.append({
                "team": team,
                "activeReps": int(tot_active),
                "probationReps": int(prob_count),
                "probationRate": round(prob_pct, 1),
                "alertLevel": "High" if prob_pct > 30 else "Medium"
            })
    training_alerts = sorted(training_alerts, key=lambda x: x["probationRate"], reverse=True)

    elapsed = time.time() - t0
    logger.info("SFE & Organogram aggregation complete in %.2fs", elapsed)

    return {
        "vacancyByLine": line_stats,
        "vacancyByManager": manager_vacancy,
        "vacantPositions": vacant_positions_list,
        "spanOfControl": {
            "dmSpan": dm_span_list,
            "asmSpan": asm_span_list,
            "averageDmSpan": round(float(dm_span.mean()), 1) if len(dm_span) > 0 else 0.0,
            "averageAsmSpan": round(float(asm_span.mean()), 1) if len(asm_span) > 0 else 0.0,
        },
        "brickWorkload": {
            "averageBricksPerRep": round(avg_bricks, 1),
            "buckets": brick_buckets,
            "overloadedReps": overloaded_reps_list
        },
        "tenureStability": {
            "probationTurnover": probation_turnover_series,
            "nonProbationTurnover": non_probation_turnover_series,
            "currentRampUpRate": round(current_ramp_up_rate, 1),
            "averageRepTenureMonths": round(avg_rep_tenure_months, 1),
            "lifecycleCounts": {
                "probation": current_probation_count,
                "nonProbation": current_non_probation_count
            },
            "trainingAlerts": training_alerts
        }
    }


def build_metadata(workbook_path: Path, df: pd.DataFrame, validation: ValidationResult,
                    latest_period: str, start_time: datetime, duration_seconds: float) -> dict:
    """Top-section metadata: last refresh, workbook name, latest period,
    data-health indicator."""
    if validation.errors:
        health = "error"
    elif len(validation.warnings) > 10:
        health = "warning"
    elif validation.warnings:
        health = "caution"
    else:
        health = "healthy"

    return {
        "workbookName": workbook_path.name,
        "sheetName": SHEET_NAME,
        "lastRefresh": start_time.strftime("%Y-%m-%d %H:%M:%S"),
        "refreshDurationSeconds": round(duration_seconds, 2),
        "latestPeriod": latest_period,
        "totalRows": int(len(df)),
        "totalColumns": int(len(df.columns)),
        "dataHealth": health,
        "errorCount": len(validation.errors),
        "warningCount": len(validation.warnings),
        "stats": validation.stats,
    }


# ---------------------------------------------------------------------------
# MAIN ORCHESTRATION
# ---------------------------------------------------------------------------

def main() -> int:
    start_time = datetime.now()
    t0 = time.time()
    logger = setup_logging()
    logger.info("=" * 70)
    logger.info("Coverage Dashboard refresh started")
    logger.info("=" * 70)

    try:
        workbook_path = find_workbook(logger)
        df_raw = load_details_sheet(workbook_path, logger)

        logger.info("--- Validation ---")
        validation = validate_data(df_raw, logger)
        if not validation.is_valid:
            for err in validation.errors:
                logger.error(err)
            logger.error("Validation failed -- aborting refresh. See errors above.")
            return 1

        logger.info("--- Cleaning ---")
        df_clean = clean_data(df_raw, logger)

        logger.info("--- Transformation ---")
        df_transformed = transform_data(df_clean, logger)

        logger.info("--- Aggregation Engine ---")
        dashboard_cache, records_cache, latest_period = run_aggregation_engine(df_transformed, validation, logger)

        logger.info("--- Cache generation ---")
        write_cache_pair(dashboard_cache, DASHBOARD_JSON, DASHBOARD_JS, "DASHBOARD_CACHE", logger)
        write_cache_pair(records_cache, RECORDS_JSON, RECORDS_JS, "DASHBOARD_RECORDS", logger)

        organogram_path = SCRIPT_DIR / "Zeta's Total Organogram 2026.xlsx"
        if organogram_path.exists():
            logger.info("--- Organogram Aggregation ---")
            organogram_cache = run_organogram_aggregation(organogram_path, df_transformed, logger)
            ORGANOGRAM_JSON = CACHE_DIR / "organogram.json"
            ORGANOGRAM_JS = CACHE_DIR / "organogram.data.js"
            write_cache_pair(organogram_cache, ORGANOGRAM_JSON, ORGANOGRAM_JS, "DASHBOARD_ORGANOGRAM", logger)
        else:
            logger.warning("Organogram file not found at %s -- SFE dashboard data will be empty.", organogram_path)

        duration = time.time() - t0
        metadata = build_metadata(workbook_path, df_transformed, validation, latest_period, start_time, duration)
        write_cache_pair(metadata, METADATA_JSON, METADATA_JS, "DASHBOARD_METADATA", logger)

        logger.info("=" * 70)
        logger.info(
            "Refresh complete in %.2fs | rows read=%d | rows processed=%d | errors=%d | warnings=%d",
            duration, len(df_raw), len(df_transformed), len(validation.errors), len(validation.warnings),
        )
        logger.info("=" * 70)
        return 0

    except Exception:
        logger.exception("Refresh failed with an unhandled exception")
        return 1


if __name__ == "__main__":
    sys.exit(main())
