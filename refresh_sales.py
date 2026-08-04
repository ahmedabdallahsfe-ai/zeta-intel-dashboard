"""
ZETA Sales Performance — Unified Cache Compiler Script
======================================================
Reads Zeta Sales transactions from TOTAL_SALES_2026.xlsx using calamine,
aggregates actual sales vs target values (filtering TargetIndex=1),
builds a compressed offline-friendly cache, and generates lookups.

Usage:  python refresh_sales.py

-----------------------------------------------------------------------
HIERARCHY NAMING (fixed 2026-07-26 — see project memory for full audit)
-----------------------------------------------------------------------
Enterprise taxonomy, top to bottom, matches Coverage/Organogram dashboards:
    Emp6Name -> CM      (Commercial Manager, company-wide, single person —
                          captured for completeness but deliberately never
                          exposed as a filter: one value, no analytical
                          slicing power)
    Emp5Name -> BUHEAD   (Business Unit Head)
    Emp4Name -> NSM      (National Sales Manager)
    Emp3Name -> RM       (Regional Manager — organogram.json's own field
                          calls this level "asm"; same people, this
                          project's chosen display name is "RM")
    Emp2Name -> DM       (District Manager)
    Emp1Name -> REP      (Medical Representative)

Names were cross-checked against cache/organogram.json (the authoritative
org file) before this mapping was finalized: DM 103/109 matched, RM/ASM
8/9 matched, NSM 15/16 matched, BUHEAD 4/4 matched (mod a "_BU" suffix
decoration in this feed). The previous version of this script had every
level shifted down by one AND dropped Emp6/CM entirely (hardcoded to
'(none)') — the variable names below, and the lookup keys they produce in
cache/sales.json, must stay aligned with this table or the Sales tab's
filters will silently mean something other than what they say.
"""

import os, sys, gzip, base64, json, re, time, pickle, collections
from datetime import datetime

# Path setup
ROOT_DIR      = os.path.dirname(os.path.abspath(__file__))
SOURCE_XLSX   = os.path.join(ROOT_DIR, 'TOTAL_SALES_2026.xlsx')
OUTPUT_JSON   = os.path.join(ROOT_DIR, 'cache', 'sales.json')
OUTPUT_JS     = os.path.join(ROOT_DIR, 'cache', 'sales.data.js')

SHEET_NAME    = 'Tota_SALES_2026'

# June 2026 update (2026-07-28): TOTAL_SALES_2026.xlsx itself only goes
# through May -- June arrived as a separate export with a different sheet
# name and 2 fewer trailing columns (ItemClientCode, Emp1Code, neither of
# which is referenced anywhere in this script's `expected_cols` below, so
# they're safe to omit). Rather than hand-merging a new giant .xlsx (slow
# to write, easy to get subtly wrong), this script reads both sources and
# concatenates their rows in memory -- column lookup below is by NAME via
# header.index(), and every June row shares the same column order/position
# for every field this script actually touches, so no per-row remapping is
# needed. Re-run whenever a new month's export needs adding: point
# JUNE_XLSX at the new file (or fold it into TOTAL_SALES_2026.xlsx directly
# once that becomes the established monthly habit).
JUNE_XLSX       = os.path.join(ROOT_DIR, 'ZETA SALES_2026', 'june.xlsx')
JUNE_SHEET_NAME = 'SalesPerDistributor'

# June position-level targets (2026-07-29): june.xlsx only carries 432
# TargetIndex=1 rows for the whole month (vs. thousands in a normal
# month) -- June's targets are effectively missing from it. This separate
# export fills that gap: 2,411 rows, ALL TargetIndex=1, position-level
# grain (no CustomerID/Distributor/Region/Chain/Quantity/Value -- targets
# aren't tied to a specific sale). Its header is a genuinely different,
# smaller shape than the main/June actuals files (27 columns vs 51), so
# columns this script normally expects but that don't exist here (Region,
# Distributor, Chain, TransactionType, Quantity, Value, IsBulk, IsOffer,
# HiringDate, Transfer/Bulk/Ceiling quantities) must resolve to safe
# defaults instead of a wrong positional guess -- see the `gv()` helper
# and the column-resolution comment below.
JUNE_TGT_XLSX   = os.path.join(ROOT_DIR, 'ZETA SALES_2026', 'June TGT 2026.xlsx')
JUNE_TGT_SHEET  = 'SalesPositionTargets'

# ---------------------------------------------------------------------------
# JUNE TARGET DE-DUPLICATION (2026-08-04)
# ---------------------------------------------------------------------------
# Ahmed re-exported both June files on 2026-08-04: june.xlsx now carries
# ZERO target rows (all 193,782 of its rows have a blank TargetIndex --
# pure actuals), and June TGT 2026.xlsx now carries a complete, balanced
# target set (2,843 TargetIndex=1 + 2,843 TargetIndex=0, covering all 16
# lines including CHC/CHC_SALES, which previously had none).
#
# The problem this constant fixes: the main workbook ALSO contributes June
# target rows, so June's Working Target was landing in the cache at
# exactly 2x the June TGT file's figure (measured: DIAB-I June Working
# read 48,960,000 against the file's true 24,480,000; whole-month Working
# read EGP 611.88M against the file's 305.94M -- precisely double, while
# Official was not doubled). Ahmed's ruling: "JUNE TARGET FILE IS THE
# RIGHT ONE ... DIAB-I June Working IS THE RIGHT 1".
#
# So June TGT 2026.xlsx is the SOLE authority for June targets: any
# June-dated TARGET row arriving from the main workbook is dropped.
# Deliberately scoped to target rows only -- June ACTUALS from the main
# workbook (if any) are untouched, since actuals were never double-counted
# and june.xlsx is their own separate, already-correct source.
JUNE_TARGET_AUTHORITY_MONTH = '2026-06'
JUNE_TARGET_AUTHORITY_LABEL = 'june_tgt'

# ---------------------------------------------------------------------------
# WORKING-ONLY LINES (2026-08-04)
# ---------------------------------------------------------------------------
# Per Ahmed's explicit, confirmed instruction: CHC and CHC_SALES have no
# Official Target -- so their target rows are reported as Working.
#
# RULE: keep TargetIndex=1 rows ONLY (relabelled to Working); DROP their
# TargetIndex=0 rows. This is not the same as a plain relabel, and the
# difference matters -- see below.
#
# WHY A PLAIN RELABEL IS WRONG HERE. A first implementation simply flipped
# the scenario flag on every CHC target row. A collision detector added
# alongside it fired immediately on the next real run:
#
#   *** WARNING: CHC 2026-01 carries BOTH TargetIndex 0 and 1 ...  (and
#   the same for 2026-02 .. 2026-05)
#
# The main workbook carries CHC's Jan-May target TWICE -- once under each
# index, at identical values (EGP 105,737,194 each; confirmed by comparing
# two cache builds, one of which happened to tag those rows Official and
# the other Working, both reporting the same figure). Relabelling both
# collapses them onto one groupby key and SUMS them, doubling CHC's
# Jan-May target to ~211M and BU CHC's total to ~237M.
#
# WHY KEEP INDEX 1 RATHER THAN 0. Ahmed's instruction was literally
# "CONSIDER TARGET INDEX 1 AND CONSIDER IT AS INDEX 0" -- index 1 is the
# figure that means something for these lines, it just must not be
# reported under the Official label. It is also the only index June TGT
# 2026.xlsx carries for CHC/CHC_SALES (270 and 162 rows, zero index-0
# rows), so keeping index 1 is the one choice consistent across BOTH
# sources. Keeping index 0 instead would silently zero out June.
#
# Resulting figures: CHC = 105,737,194 (Jan-May) + 25,719,858 (June) =
# EGP 131.46M; CHC_SALES = 79,302,895 + 19,289,894 = EGP 98.59M.
#
# _wol_seen tracks the per-line/month index mix; check_working_only_lines()
# warns after each source if any month supplied ONLY index-0 rows, since
# that month's target would be dropped to zero by this rule.
WORKING_ONLY_KEEP_INDEX = 1
#
# This is NOT the old CHC_SINGLE_SCENARIO_LINES exception, which has been
# removed: that one hardcoded a FALLBACK RULE in the presentation layer
# and had gone stale the moment the June file gained real CHC Working
# data. This is a source-data classification rule, applied once at ingest,
# where it belongs. Fallback itself is now data-driven -- the ETL records
# which scenarios each line actually has (see SCENARIO COVERAGE below) and
# js/semantic-model.js resolves from that, so a line becoming Working-only
# (or regaining Official) needs no code change anywhere.
WORKING_ONLY_LINES = {'CHC', 'CHC_SALES'}

# Collision tracker for the relabel above: {(line, month): {index: count}}.
# Populated in the row loop, checked once at the end of aggregation. A
# working-only line that shows BOTH TargetIndex 0 and 1 in the same month
# means the relabel is now summing two rows into one -- see the SAFETY
# CONDITION note above.
_wol_seen = collections.defaultdict(collections.Counter)


def check_working_only_lines():
    """Warn if any working-only line/month supplied ONLY TargetIndex=0
    rows. Those get dropped by the keep-index-1 rule, leaving that
    line/month with no target at all -- silently, and only visible as a
    suspiciously low achievement denominator weeks later. Called after
    each source finishes; per-invocation, which is enough because each
    source file is streamed within a single call."""
    orphaned = sorted(
        f'{ln} {mo}' for (ln, mo), c in _wol_seen.items()
        if c.get(WORKING_ONLY_KEEP_INDEX, 0) == 0 and sum(c.values()) > 0
    )
    if orphaned:
        log(f'  *** WARNING: no TargetIndex={WORKING_ONLY_KEEP_INDEX} rows for '
            f'{", ".join(orphaned)} -- these have TargetIndex=0 rows only, which the '
            f'working-only rule drops, leaving them with ZERO target. Check the source '
            f'file before trusting these lines\' achievement. See WORKING_ONLY_LINES. ***')
    else:
        kept = sum(c.get(WORKING_ONLY_KEEP_INDEX, 0) for c in _wol_seen.values())
        dropped = sum(sum(c.values()) for c in _wol_seen.values()) - kept
        if kept or dropped:
            log(f'  Working-only lines: kept {kept:,} TargetIndex={WORKING_ONLY_KEEP_INDEX} '
                f'target rows, dropped {dropped:,} duplicate TargetIndex=0 rows.')

# Checkpoint (2026-07-28, revised): processing ~1.19M rows across two xlsx
# files comfortably exceeds the sandbox's 45s hard command timeout in one
# shot -- not just the sheet-fetch (~30-40s with real variance), but the
# per-row aggregation itself (~5s/200k rows), making a single-call complete
# pass structurally impossible. Materializing the full row list first (an
# earlier attempt) made this WORSE, not better, since bulk-loading a
# ~1M-row sheet into a Python list is itself slow. The fix is a single
# resumable checkpoint of the AGGREGATION STATE (not raw rows): each
# invocation re-fetches whichever source isn't yet complete, skips the rows
# a prior invocation already processed, aggregates until a wall-clock
# deadline is hit, then checkpoints. Re-running the script resumes exactly
# where it left off, main file first, then June. Cleared after a fully
# successful run so the next refresh does a genuine fresh parse.
CHECKPOINT_AGG_PKL  = os.path.join(ROOT_DIR, 'cache', '.sales_agg_checkpoint.pkl')

def _clear_checkpoint(path, t0):
    """Delete path, falling back to rename -- this mount has occasionally
    refused unlink() on files (seen with git's index.lock and the customer
    analytics checkpoint) while still allowing rename()."""
    if not os.path.exists(path):
        return
    try:
        os.remove(path)
    except OSError:
        try:
            os.rename(path, path + '.consumed_' + str(int(time.time())))
        except OSError as e:
            print(f'  [{time.time()-t0:.1f}s] WARNING: could not clear checkpoint {path} ({e}) -- '
                  f'delete it by hand before the next refresh.', file=sys.stderr, flush=True)

def parse_month(val):
    if not val:
        return '2026-Unknown'
    s = str(val).strip()
    if s.startswith('2026-'):
        return s[:7]
    # Check for decimal representation like 202601.0
    m = re.match(r'^20260(\d)\.0$', s)
    if m:
        return f'2026-0{m.group(1)}'
    m_full = re.match(r'^2026(\d{2})', s)
    if m_full:
        return f'2026-{m_full.group(1)}'
    # Try datetime parse
    s_date = s.split(' ')[0].split('T')[0]
    for fmt in ('%Y-%m-%d', '%Y-%m'):
        try: return datetime.strptime(s_date, fmt).strftime('%Y-%m')
        except: pass
    return '2026-Unknown'

def parse_hiring_date(val):
    if not val:
        return ""
    s = str(val).strip()
    if re.match(r'^\d+(\.0)?$', s):
        try:
            days = int(float(s))
            import datetime as dt
            base = dt.datetime(1899, 12, 30)
            return (base + dt.timedelta(days=days)).strftime('%Y-%m-%d')
        except: pass
    s_date = s.split(' ')[0].split('T')[0]
    for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%m/%d/%Y'):
        try: return datetime.strptime(s_date, fmt).strftime('%Y-%m-%d')
        except: pass
    return s

def build_lookup(lst):
    cats = sorted(set(lst))
    cat_map = {v: i for i, v in enumerate(cats)}
    return cat_map, cats

def log(msg): print(f'  {msg}', flush=True)

# ── 1+2. Load & Aggregate Sales Data (chunked, resumable via SQLite) ────────
# Restructured 2026-07-28. First attempt materialized the full row list
# in memory (to_python() / list(iter_rows())) before aggregating -- too
# slow on its own for this sandbox's 45s test-tool cap, though NOT a real
# constraint when this script runs normally via refresh.bat (no timeout
# there). Second attempt kept an in-memory `aggregated` dict across
# invocations and pickle-checkpointed the WHOLE thing after every call --
# that dump grows with total accumulated state, and got killed mid-write
# once state reached tens of MB, corrupting progress (caught by switching
# to an atomic temp-file-then-rename write, but still wasted whole calls
# with zero forward progress as the dump kept growing).
#
# Fix: persist aggregation state in a small SQLite database instead of a
# single in-memory dict. Each invocation only needs to flush THIS CALL's
# batch of upserts (bounded size, not proportional to total rows processed
# so far) -- so checkpoint cost stays flat across the whole run instead of
# growing. Re-running the script re-fetches the sheet (unavoidable --
# calamine has no partial/random-access read), skips rows a prior
# invocation already committed, and resumes upserting from there. Once
# both sources are fully consumed, a single query reconstructs the same
# in-memory dict/set shapes the rest of this script already expects, so
# the lookup/encoding/write stage below is unchanged.
print('\n[1-2/5] Loading + aggregating Sales workbook (chunked/resumable, SQLite-backed)...', flush=True)
t0 = time.time()
try:
    from python_calamine import CalamineWorkbook
except ImportError:
    print('ERROR: python_calamine not found. Run: pip install python-calamine')
    sys.exit(1)
import sqlite3

# Generous wall-clock cutoff -- unlike the pickle design, checkpoint cost
# here is bounded per-call (only this call's new rows get flushed), so we
# don't need to shrink the budget as total progress grows. Still leaves a
# safety margin under the sandbox's 45s hard cap for the final flush/commit.
HARD_DEADLINE = t0 + 300

# In the OS temp dir, not the project's cache/ folder (2026-07-28): this is
# a transient checkpoint, never shipped or committed, and WAL-mode SQLite
# needs shared-memory mmap that some network/FUSE-mounted drives refuse
# ("disk I/O error" was observed pointing this at cache/ on this project's
# mount). tempfile.gettempdir() resolves correctly on both this sandbox and
# the user's real Windows machine, so refresh.bat works unchanged.
import tempfile
DB_PATH = os.path.join(tempfile.gettempdir(), 'zeta_sales_agg_checkpoint.db')
# Declared up here (not next to its first use further down) so the
# rules-version guard, which runs before that point, can clear it too.
RECON_PKL_PATH = os.path.join(tempfile.gettempdir(), 'zeta_sales_recon_checkpoint.pkl')
SEP = '\x1f'  # unit separator -- joins composite dict keys for SQLite storage

expected_cols = {
    'Date': 0, 'Line': 1, 'Brand': 2, 'Item': 3, 'Brick': 8, 'Region': 10,
    'CustomerID': 13, 'Distributor': 21, 'Position': 22, 'EmployeeCode': 23,
    # Emp1..Emp6 = Rep -> DM -> RM -> NSM -> BUHead -> CM (see module docstring)
    'Emp1Name': 24, 'Emp2Name': 25, 'Emp3Name': 26, 'Emp4Name': 27, 'Emp5Name': 28, 'Emp6Name': 29,
    'TransactionType': 30, 'Quantity': 31, 'Value': 32, 'IsMirror': 41, 'TargetQuantity': 47, 'TargetValue': 48, 'TargetIndex': 49,
    'Chain': 12, 'MainType': 6, 'SubType': 7,
    'IsBulk': 37, 'IsTender': 38, 'IsOffer': 39, 'IsUPA': 40, 'HiringDate': 44,
    'TransferQuantity': 35, 'TotalBulkQuantity': 36, 'NationalCeilingQuantity': 33, 'RegionCeilingQuantity': 34
}

def norm_line(l):
    s = str(l).strip()
    return s or '(none)'

def gv(r, idx, default=None):
    """Safe row-value getter (2026-07-29, added for June TGT support):
    returns default if idx is None (column doesn't exist in THIS source's
    header at all) or out of range for this row -- instead of blindly
    indexing, which either crashes or, worse, silently reads the wrong
    column when two sources have different header shapes."""
    if idx is None or idx >= len(r):
        return default
    return r[idx]

def open_db():
    conn = sqlite3.connect(DB_PATH)
    # MEMORY journal (not WAL/DELETE): this is a scratch checkpoint we can
    # afford to lose on a hard crash (worst case: re-run and resume from
    # the last successful flush), so we trade durability for avoiding any
    # journal side-files and their locking requirements entirely.
    conn.execute('PRAGMA journal_mode=MEMORY')
    conn.execute('PRAGMA synchronous=OFF')
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS progress (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS aggregated (
            gkey TEXT PRIMARY KEY,
            month TEXT, line TEXT, brand TEXT, product TEXT, rep TEXT, dm TEXT, rm TEXT, nsm TEXT,
            buhead TEXT, cm TEXT, region TEXT, brick TEXT, distributor TEXT, chain TEXT,
            main_type TEXT, sub_type TEXT, tx_type TEXT, mask INTEGER,
            qty REAL DEFAULT 0, val REAL DEFAULT 0, tgt_qty REAL DEFAULT 0, tgt_val REAL DEFAULT 0,
            transfer_qty REAL DEFAULT 0, bulk_qty REAL DEFAULT 0, nat_ceiling REAL DEFAULT 0, reg_ceiling REAL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS agg_customers (gkey TEXT, cust_id TEXT, PRIMARY KEY(gkey, cust_id));
        CREATE TABLE IF NOT EXISTS customer_roster (rkey TEXT, month TEXT, val REAL DEFAULT 0, PRIMARY KEY(rkey, month));
        CREATE TABLE IF NOT EXISTS lookups (category TEXT, value TEXT, PRIMARY KEY(category, value));
        CREATE TABLE IF NOT EXISTS rep_props (rep TEXT PRIMARY KEY, hiring_date TEXT, position TEXT);
    ''')
    conn.commit()
    return conn

def get_progress(conn):
    """Generic (2026-07-29, was hardcoded to main/june before June TGT was
    added as a third source): returns every key in the progress table,
    with *_rows_done coerced to int and *_complete coerced to bool. Callers
    use .get(key, default) for keys that may not exist yet on an older
    checkpoint DB."""
    p = dict(conn.execute('SELECT key, value FROM progress').fetchall())
    out = {}
    for k, v in p.items():
        if k == RULES_VERSION_KEY:
            continue  # not a progress counter -- see ensure_rules_version()
        out[k] = (v == '1') if k.endswith('_complete') else int(v)
    return out


# ---------------------------------------------------------------------------
# CHECKPOINT RULES-VERSION GUARD (2026-08-04)
# ---------------------------------------------------------------------------
# The resumable checkpoint stores AGGREGATED rows, with each row's `mask`
# (scenario bit, tender/bulk/mirror flags) and its inclusion/exclusion
# already decided by whatever version of the classification rules was
# running when that row was processed. Re-running after a rules change
# therefore does NOT re-derive old rows -- it resumes on top of them,
# silently producing a cache that is part old-rules, part new-rules.
#
# This bit us for real on 2026-08-04: a run picked up the new June target
# de-duplication (DIAB-I June landed at the correct 21,828,000/24,480,000)
# while the CHC working-only rule never reached the Jan-May rows, which
# had been aggregated into the checkpoint under earlier code. The output
# looked plausible and was internally inconsistent -- the worst kind of
# wrong for an executive dashboard.
#
# Bump ETL_RULES_VERSION whenever a change alters how any row is
# classified, masked, included or excluded (NOT for logging, comments, or
# output-formatting changes). On mismatch the checkpoint is discarded and
# the run starts clean, which costs one full re-read but guarantees every
# row in the cache was produced by exactly one version of the rules.
ETL_RULES_VERSION = '2026-08-04.a'  # June TGT authority + CHC/CHC_SALES working-only + scenario bit 5
RULES_VERSION_KEY = 'etl_rules_version'


def ensure_rules_version(conn):
    """Wipe the checkpoint if it was built under different rules. Returns
    a fresh connection (the old one is closed if the DB was recreated)."""
    row = conn.execute('SELECT value FROM progress WHERE key=?', (RULES_VERSION_KEY,)).fetchone()
    found = row[0] if row else None
    if found == ETL_RULES_VERSION:
        return conn
    has_rows = conn.execute('SELECT 1 FROM aggregated LIMIT 1').fetchone() is not None
    if has_rows or found is not None:
        log(f'  Checkpoint was built under rules "{found or "unknown"}" but this script is '
            f'"{ETL_RULES_VERSION}" -- discarding it and starting clean so the cache '
            f'cannot mix rule versions.')
        conn.close()
        for p in (DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', RECON_PKL_PATH):
            _clear_checkpoint(p, t0)
        conn = open_db()
    conn.execute('INSERT INTO progress(key, value) VALUES (?,?) '
                 'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                 (RULES_VERSION_KEY, ETL_RULES_VERSION))
    conn.commit()
    return conn

def set_progress(conn, **kv):
    for k, v in kv.items():
        v = ('1' if v else '0') if isinstance(v, bool) else str(v)
        conn.execute('INSERT INTO progress(key, value) VALUES (?,?) '
                     'ON CONFLICT(key) DO UPDATE SET value=excluded.value', (k, v))
    conn.commit()

def process_source(conn, xlsx_path, sheet_name, rows_done_key, complete_key, prog, source_label):
    """Fetch xlsx_path's sheet, skip prog[rows_done_key] rows already
    committed by a previous invocation, then upsert new rows into the
    SQLite tables in bounded batches until HARD_DEADLINE is hit or the
    sheet runs out of rows. Returns (fully_consumed, rows_done).

    source_label (2026-08-04) is the SOURCES entry's label ('main',
    'june', 'june_tgt') -- needed by the June target de-duplication rule
    in the row loop, which must know which file a given target row came
    from. Passing it explicitly rather than inferring from xlsx_path
    keeps the rule readable and keeps SOURCES the single place where a
    source's identity is defined."""
    wb = CalamineWorkbook.from_path(xlsx_path)
    ws = wb.get_sheet_by_name(sheet_name)
    log(f'  Sheet fetched: {xlsx_path} ({time.time()-t0:.1f}s)')

    rows_iter = ws.iter_rows()
    header = [str(c).strip() if c else '' for c in next(rows_iter)]
    # None (2026-07-29), not expected_cols' hardcoded position, for a name
    # missing from THIS header -- the position fallback was dead code for
    # the main/June actuals files (their headers always contain every
    # expected name) but actively wrong for June TGT's smaller header,
    # where e.g. expected_cols['Region']=10 would silently pick up that
    # file's BrickCode column instead of leaving Region blank. Every
    # field access below goes through gv(), which treats None as missing.
    col = {n: header.index(n) if n in header else None for n in expected_cols}

    already_done = prog.get(rows_done_key, 0)
    if already_done:
        for _ in range(already_done):
            next(rows_iter, None)
        log(f'  Skipped {already_done:,} already-committed rows ({time.time()-t0:.1f}s)')

    rows_done = already_done
    processed_this_call = 0

    # Bounded per-flush batches -- cleared after every commit, so their
    # size never grows with total progress, only with the flush interval.
    agg_batch = {}
    cust_batch = set()
    roster_batch = {}
    lookup_batch = set()
    rep_batch = {}

    def flush():
        cur = conn.cursor()
        if agg_batch:
            cur.executemany('''
                INSERT INTO aggregated (gkey, month, line, brand, product, rep, dm, rm, nsm, buhead, cm,
                    region, brick, distributor, chain, main_type, sub_type, tx_type, mask,
                    qty, val, tgt_qty, tgt_val, transfer_qty, bulk_qty, nat_ceiling, reg_ceiling)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(gkey) DO UPDATE SET
                    qty=qty+excluded.qty, val=val+excluded.val, tgt_qty=tgt_qty+excluded.tgt_qty,
                    tgt_val=tgt_val+excluded.tgt_val, transfer_qty=transfer_qty+excluded.transfer_qty,
                    bulk_qty=bulk_qty+excluded.bulk_qty, nat_ceiling=nat_ceiling+excluded.nat_ceiling,
                    reg_ceiling=reg_ceiling+excluded.reg_ceiling
            ''', [(g, *dims, *vals) for g, (dims, vals) in agg_batch.items()])
        if cust_batch:
            cur.executemany('INSERT OR IGNORE INTO agg_customers (gkey, cust_id) VALUES (?,?)', list(cust_batch))
        if roster_batch:
            cur.executemany('''
                INSERT INTO customer_roster (rkey, month, val) VALUES (?,?,?)
                ON CONFLICT(rkey, month) DO UPDATE SET val=val+excluded.val
            ''', [(rk, mo, v) for (rk, mo), v in roster_batch.items()])
        if lookup_batch:
            cur.executemany('INSERT OR IGNORE INTO lookups (category, value) VALUES (?,?)', list(lookup_batch))
        if rep_batch:
            cur.executemany('INSERT OR IGNORE INTO rep_props (rep, hiring_date, position) VALUES (?,?,?)',
                             [(r, hd, p) for r, (hd, p) in rep_batch.items()])
        set_progress(conn, **{rows_done_key: rows_done})
        conn.commit()
        agg_batch.clear(); cust_batch.clear(); roster_batch.clear(); lookup_batch.clear(); rep_batch.clear()

    hit_deadline = False
    for r in rows_iter:
        processed_this_call += 1
        rows_done += 1

        if r and not all(c is None for c in r):
            # Check target row based on TargetIndex in (0, 1). 2026-08-04
            # (Target Scenario feature): TargetIndex=1 is Official Target,
            # TargetIndex=0 is Working Target -- CONFIRMED by Ahmed
            # 2026-08-04 ("I NEED TO CONFIRM TO YOU THAT TARGET INDEX 1 IS
            # OFFICIAL TARGET AND 0 IS WORKING TARGET"), so this mapping is
            # no longer provisional and "Working Target" is the settled
            # business label, not a placeholder. Both are kept -- this
            # script previously discarded every TargetIndex=0 row
            # (skip_row=True unconditionally for t_idx != 1); the semantic
            # layer (js/semantic-model.js SEMANTIC.resolveScenario() +
            # js/sales.js) decides which scenario to aggregate on demand,
            # per line, resolving fallback from the per-line scenario
            # coverage this script now emits into cache.meta. Any
            # TargetIndex value other than 0 or 1 is still excluded,
            # unchanged from before.
            tgt_idx_val = gv(r, col['TargetIndex'])
            is_mirror = False
            is_official_scenario = True  # only meaningful when is_mirror is True
            skip_row = False
            if tgt_idx_val not in (None, ''):
                try:
                    t_idx = int(round(float(tgt_idx_val)))
                    if t_idx == 1:
                        is_mirror = True
                        is_official_scenario = True
                    elif t_idx == 0:
                        is_mirror = True
                        is_official_scenario = False
                    else:
                        skip_row = True  # target rows with other target indexes excluded
                except:
                    skip_row = True  # unparseable target index excluded

            if not skip_row:
                month = parse_month(gv(r, col['Date']))
                line = norm_line(gv(r, col['Line']))

                # --- June target de-duplication (2026-08-04) -------------
                # June TGT 2026.xlsx is the sole authority for June
                # targets; drop any June-dated TARGET row arriving from
                # another source. Without this, June Working Target lands
                # at exactly 2x its true value. Actual (non-mirror) rows
                # are never affected. See JUNE_TARGET_AUTHORITY_* above.
                if (is_mirror
                        and month == JUNE_TARGET_AUTHORITY_MONTH
                        and source_label != JUNE_TARGET_AUTHORITY_LABEL):
                    skip_row = True

                # --- Working-only lines (2026-08-04) --------------------
                # CHC/CHC_SALES: keep TargetIndex=1 only, relabelled to
                # Working. Their TargetIndex=0 rows are duplicates of the
                # same target and are dropped. See WORKING_ONLY_LINES.
                if is_mirror and line in WORKING_ONLY_LINES:
                    _wol_seen[(line, month)][t_idx] += 1
                    if t_idx == WORKING_ONLY_KEEP_INDEX:
                        is_official_scenario = False
                    else:
                        skip_row = True

            if not skip_row:
                brand = str(gv(r, col['Brand'], '')).strip() or '(none)'
                product = str(gv(r, col['Item'], '')).strip() or '(none)'

                rep = str(gv(r, col['Emp1Name'], '')).strip() or '(none)'
                dm = str(gv(r, col['Emp2Name'], '')).strip() or '(none)'
                rm = str(gv(r, col['Emp3Name'], '')).strip() or '(none)'      # Regional Manager
                nsm = str(gv(r, col['Emp4Name'], '')).strip() or '(none)'    # National Sales Manager
                buhead = str(gv(r, col['Emp5Name'], '')).strip() or '(none)' # Business Unit Head
                _emp6 = gv(r, col['Emp6Name'])
                cm = str(_emp6).strip() if _emp6 not in (None, '') else '(none)'  # Commercial Manager (captured, never filterable)

                # Region/Distributor/Chain/TransactionType: absent from June
                # TGT's smaller header (targets aren't tied to a specific
                # sale/customer) -- default to '(none)', same as any other
                # source's genuinely blank cell.
                region = str(gv(r, col['Region'], '')).strip() or '(none)'
                brick = str(gv(r, col['Brick'], '')).strip() or '(none)'
                distributor = str(gv(r, col['Distributor'], '')).strip() or '(none)'
                chain = str(gv(r, col['Chain'], '')).strip() or '(none)'
                main_type = str(gv(r, col['MainType'], '')).strip() or '(none)'
                sub_type = str(gv(r, col['SubType'], '')).strip() or '(none)'
                tx_type = str(gv(r, col['TransactionType'], '')).strip() or '(none)'

                # Static Rep Properties -- INSERT OR IGNORE at flush time
                # gives the same "first value wins" semantics as the
                # original dict-based `if rep not in map` check.
                hdate_val = gv(r, col['HiringDate'])
                pos_val = gv(r, col['Position'])
                if rep != '(none)' and rep not in rep_batch:
                    hd = parse_hiring_date(hdate_val) if hdate_val not in (None, '') else None
                    p = str(pos_val).strip() if pos_val not in (None, '') else None
                    if hd or p:
                        rep_batch[rep] = (hd, p)

                _cust_val = gv(r, col['CustomerID'])
                cust_id = str(_cust_val).strip() if _cust_val is not None else ''

                # Quantities and values
                qty, val, tgt_qty, tgt_val = 0.0, 0.0, 0.0, 0.0
                transfer_qty, bulk_qty, nat_ceiling, reg_ceiling = 0.0, 0.0, 0.0, 0.0

                if not is_mirror:
                    try:
                        _v = gv(r, col['Quantity'])
                        if _v not in (None, ''): qty = float(_v)
                    except: pass
                    try:
                        _v = gv(r, col['Value'])
                        if _v not in (None, ''): val = float(_v)
                    except: pass
                else:
                    try:
                        _v = gv(r, col['TargetQuantity'])
                        if _v not in (None, ''): tgt_qty = float(_v)
                    except: pass
                    try:
                        _v = gv(r, col['TargetValue'])
                        if _v not in (None, ''): tgt_val = float(_v)
                    except: pass

                # Extended metrics -- all absent from June TGT's header;
                # gv() returns None for them, the try/except leaves 0.0.
                try:
                    _v = gv(r, col['TransferQuantity'])
                    if _v not in (None, ''): transfer_qty = float(_v)
                except: pass
                try:
                    _v = gv(r, col['TotalBulkQuantity'])
                    if _v not in (None, ''): bulk_qty = float(_v)
                except: pass
                try:
                    _v = gv(r, col['NationalCeilingQuantity'])
                    if _v not in (None, ''): nat_ceiling = float(_v)
                except: pass
                try:
                    _v = gv(r, col['RegionCeilingQuantity'])
                    if _v not in (None, ''): reg_ceiling = float(_v)
                except: pass

                # Flag bitmask (Bit 0: IsBulk, Bit 1: IsTender, Bit 2: IsOffer,
                # Bit 3: IsUPA, Bit 4: IsMirror, Bit 5: IsOfficialScenario --
                # 2026-08-04, Target Scenario feature). Bit 5 is ONLY
                # meaningful when Bit 4 (IsMirror) is set: 1 = this row's
                # TargetIndex was 1 (Official Target), 0 = TargetIndex was 0
                # (Working Target). For non-mirror (actual transaction) rows
                # Bit 5 is always 0 and never inspected downstream. Reusing
                # the existing mask field (rather than adding a new column)
                # keeps row width unchanged, and because mask is already
                # part of the groupby key below, Official and Working
                # target rows for the same month/line/brand/... naturally
                # land in two SEPARATE aggregated rows with no extra
                # grouping logic required.
                is_bulk = gv(r, col['IsBulk']) in (True, 1, 'True', '1')
                is_tender = gv(r, col['IsTender']) in (True, 1, 'True', '1')
                is_offer = gv(r, col['IsOffer']) in (True, 1, 'True', '1')
                is_upa = gv(r, col['IsUPA']) in (True, 1, 'True', '1')

                mask = 0
                if is_bulk: mask |= 1
                if is_tender: mask |= 2
                if is_offer: mask |= 4
                if is_upa: mask |= 8
                if is_mirror: mask |= 16
                if is_mirror and is_official_scenario: mask |= 32

                # Collect for lookup categories
                for cat, v in (('months', month), ('lines', line), ('brands', brand), ('products', product),
                               ('reps', rep), ('dms', dm), ('rms', rm), ('nsms', nsm), ('buheads', buhead),
                               ('cms', cm), ('regions', region), ('bricks', brick), ('distributors', distributor),
                               ('chains', chain), ('main_types', main_type), ('sub_types', sub_type), ('tx_types', tx_type)):
                    lookup_batch.add((cat, v))

                # Group aggregation
                dims = (month, line, brand, product, rep, dm, rm, nsm, buhead, cm, region, brick, distributor, chain, main_type, sub_type, tx_type, mask)
                gkey = SEP.join(str(d) for d in dims)
                if gkey not in agg_batch:
                    agg_batch[gkey] = (dims, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
                vals = agg_batch[gkey][1]
                vals[0] += qty; vals[1] += val; vals[2] += tgt_qty; vals[3] += tgt_val
                vals[4] += transfer_qty; vals[5] += bulk_qty; vals[6] += nat_ceiling; vals[7] += reg_ceiling

                if cust_id and val > 0:
                    cust_batch.add((gkey, cust_id))

                    # Customer roster logic
                    rkey = SEP.join((cust_id, rep, brick, region, line))
                    roster_batch[(rkey, month)] = roster_batch.get((rkey, month), 0.0) + val

        if processed_this_call % 20000 == 0:
            flush()
            if time.time() >= HARD_DEADLINE:
                log(f'  Budget reached after {rows_done:,} rows this source ({time.time()-t0:.1f}s)')
                hit_deadline = True
                break

    flush()

    if hit_deadline:
        return False, rows_done

    set_progress(conn, **{complete_key: True})
    log(f'  Source fully consumed: {rows_done:,} rows total ({time.time()-t0:.1f}s)')
    return True, rows_done


conn = open_db()
# Discard any checkpoint built under different classification rules before
# reading progress from it -- otherwise this run would resume on top of
# rows another rules version produced. See ensure_rules_version().
conn = ensure_rules_version(conn)
prog = get_progress(conn)

# SOURCES (2026-07-29, generalized from a hardcoded main/June pair when
# June TGT was added as a third): each entry is (label, xlsx_path,
# sheet_name, rows_done_key, complete_key). Processed strictly in order --
# every source before it in the list must be complete before the next one
# starts, so any file that doesn't exist (e.g. Ahmed hasn't dropped a
# given month's TGT export yet) just gets auto-marked complete with 0 rows
# and the pipeline moves on.
SOURCES = [
    ('main', SOURCE_XLSX, SHEET_NAME, 'main_rows_done', 'main_complete'),
    ('june', JUNE_XLSX, JUNE_SHEET_NAME, 'june_rows_done', 'june_complete'),
    ('june_tgt', JUNE_TGT_XLSX, JUNE_TGT_SHEET, 'junetgt_rows_done', 'junetgt_complete'),
]

log('Progress: ' + ', '.join(
    f'{label} {prog.get(rk, 0):,} rows done (complete={prog.get(ck, False)})'
    for label, _, _, rk, ck in SOURCES))

# Track whether THIS call did any fetch+aggregate work, so a call that
# finishes the last source never also tries to cram reconstruction +
# lookups + gzip + write into the same invocation (that combination is
# what got a write killed mid-file once already, 2026-07-28 -- corrupting
# cache/sales.json in place since it was overwritten non-atomically). Only
# a call that starts with EVERY source already complete (i.e. does zero
# fetch work) is allowed to proceed straight to the output stage below.
did_process_this_call = False

for label, xlsx_path, sheet_name, rows_done_key, complete_key in SOURCES:
    if prog.get(complete_key, False):
        continue
    if not os.path.exists(xlsx_path):
        log(f'No {label} update file found at {xlsx_path} -- skipping')
        set_progress(conn, **{complete_key: True})
        prog = get_progress(conn)
        continue
    process_source(conn, xlsx_path, sheet_name, rows_done_key, complete_key, prog, label)
    did_process_this_call = True
    break  # one source's worth of work per call, same as before

prog = get_progress(conn)
all_complete = all(prog.get(ck, False) for _, _, _, _, ck in SOURCES)
if not all_complete or did_process_this_call:
    conn.close()
    if all_complete:
        print(f'\n[READY] All sources fully aggregated -- re-run this script once more '
              f'to build the output cache (kept as a separate call on purpose, see comment above).')
    else:
        status = ', '.join(
            f'{label}: {prog.get(rk, 0):,} rows{" [DONE]" if prog.get(ck, False) else ""}'
            for label, _, _, rk, ck in SOURCES)
        print(f'\n[PARTIAL] Not finished yet -- re-run this script to continue ({status}).')
    sys.exit(0)

# RECON_PKL (2026-07-28): reconstructing ~2.5M rows' worth of SQLite query
# results into Python dicts/sets, THEN building lookups, THEN encoding
# ~613k rows, THEN gzip-compressing a ~60MB+ JSON string all in one call
# was measured exceeding the sandbox's 45s cap even with zero xlsx-fetch
# cost (both sources already complete, so this call skips straight to
# reconstruction). Splitting reconstruction into its own checkpoint --
# written ONCE from the final, complete dataset, so unlike the earlier
# growing-pickle-per-row-chunk design it never grows across multiple
# calls -- lets the encode+write stage run as a clean, separate call.
RECON_PKL = RECON_PKL_PATH  # defined near DB_PATH so the rules-version guard can clear it

if os.path.exists(RECON_PKL):
    conn.close()
    log(f'Loading reconstruction checkpoint, skipping SQLite rebuild ({time.time()-t0:.1f}s)')
    with open(RECON_PKL, 'rb') as f:
        recon = pickle.load(f)
    aggregated = recon['aggregated']; customer_roster = recon['customer_roster']
    months_set = recon['months_set']; lines_set = recon['lines_set']
    brands_set = recon['brands_set']; products_set = recon['products_set']
    reps_set = recon['reps_set']; dms_set = recon['dms_set']
    rms_set = recon['rms_set']; nsms_set = recon['nsms_set']
    buheads_set = recon['buheads_set']; cms_set = recon['cms_set']
    regions_set = recon['regions_set']; bricks_set = recon['bricks_set']
    distributors_set = recon['distributors_set']; chains_set = recon['chains_set']
    main_types_set = recon['main_types_set']; sub_types_set = recon['sub_types_set']
    tx_types_set = recon['tx_types_set']; rep_hiring_map = recon['rep_hiring_map']
    rep_position_map = recon['rep_position_map']; total_source_rows = recon['total_source_rows']
    log(f'Loaded: {len(aggregated):,} unique groups, {len(customer_roster):,} active customer-rep links '
        f'({time.time()-t0:.1f}s)')
else:
    # Both sources fully committed -- pull everything back into the same
    # in-memory shapes the rest of this script (lookups/encoding/write)
    # already expects. Single bulk queries, not one-per-group, to avoid an
    # N+1 blowup.
    log(f'Both sources fully aggregated ({time.time()-t0:.1f}s) -- reconstructing in-memory structures...')

    aggregated = {}
    _gkey_to_key = {}
    for row in conn.execute('''SELECT gkey, month, line, brand, product, rep, dm, rm, nsm, buhead, cm,
                                       region, brick, distributor, chain, main_type, sub_type, tx_type, mask,
                                       qty, val, tgt_qty, tgt_val, transfer_qty, bulk_qty, nat_ceiling, reg_ceiling
                                FROM aggregated'''):
        gkey = row[0]
        key = tuple(row[1:18]) + (row[18],)  # 17 str dims + mask int
        aggregated[key] = [row[19], row[20], row[21], row[22], row[23], row[24], row[25], row[26], set()]
        _gkey_to_key[gkey] = key

    for gkey, cust_id in conn.execute('SELECT gkey, cust_id FROM agg_customers'):
        k = _gkey_to_key.get(gkey)
        if k is not None:
            aggregated[k][8].add(cust_id)

    customer_roster = {}
    for rkey, month, val in conn.execute('SELECT rkey, month, val FROM customer_roster'):
        cust_id, rep, brick, region, line = rkey.split(SEP)
        cust_key = (cust_id, rep, brick, region, line)
        customer_roster.setdefault(cust_key, {})[month] = val

    lookup_sets = {cat: set() for cat in
        ('months', 'lines', 'brands', 'products', 'reps', 'dms', 'rms', 'nsms', 'buheads',
         'cms', 'regions', 'bricks', 'distributors', 'chains', 'main_types', 'sub_types', 'tx_types')}
    for cat, value in conn.execute('SELECT category, value FROM lookups'):
        if cat in lookup_sets:
            lookup_sets[cat].add(value)

    months_set = lookup_sets['months']; lines_set = lookup_sets['lines']
    brands_set = lookup_sets['brands']; products_set = lookup_sets['products']
    reps_set = lookup_sets['reps']; dms_set = lookup_sets['dms']
    rms_set = lookup_sets['rms']; nsms_set = lookup_sets['nsms']
    buheads_set = lookup_sets['buheads']; cms_set = lookup_sets['cms']
    regions_set = lookup_sets['regions']; bricks_set = lookup_sets['bricks']
    distributors_set = lookup_sets['distributors']; chains_set = lookup_sets['chains']
    main_types_set = lookup_sets['main_types']; sub_types_set = lookup_sets['sub_types']
    tx_types_set = lookup_sets['tx_types']

    rep_hiring_map = {}
    rep_position_map = {}
    for rep, hiring_date, position in conn.execute('SELECT rep, hiring_date, position FROM rep_props'):
        if hiring_date: rep_hiring_map[rep] = hiring_date
        if position: rep_position_map[rep] = position

    total_source_rows = sum(prog.get(rk, 0) for _, _, _, rk, _ in SOURCES)
    log(f'Reconstructed: {len(aggregated):,} unique groups, {len(customer_roster):,} active customer-rep links '
        f'({time.time()-t0:.1f}s)')

    conn.close()

    _recon_tmp = RECON_PKL + '.tmp'
    with open(_recon_tmp, 'wb') as f:
        pickle.dump({
            'aggregated': aggregated, 'customer_roster': customer_roster,
            'months_set': months_set, 'lines_set': lines_set, 'brands_set': brands_set,
            'products_set': products_set, 'reps_set': reps_set, 'dms_set': dms_set,
            'rms_set': rms_set, 'nsms_set': nsms_set, 'buheads_set': buheads_set,
            'cms_set': cms_set, 'regions_set': regions_set, 'bricks_set': bricks_set,
            'distributors_set': distributors_set, 'chains_set': chains_set,
            'main_types_set': main_types_set, 'sub_types_set': sub_types_set,
            'tx_types_set': tx_types_set, 'rep_hiring_map': rep_hiring_map,
            'rep_position_map': rep_position_map, 'total_source_rows': total_source_rows,
        }, f, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(_recon_tmp, RECON_PKL)
    log(f'Reconstruction checkpoint saved ({time.time()-t0:.1f}s)')
    print(f'\n[READY] Reconstruction complete -- re-run this script once more '
          f'to encode and write the output cache.')
    sys.exit(0)

# NOTE: neither the SQLite DB nor RECON_PKL is cleared here. Both are only
# cleared after cache/sales.json + sales.data.js are successfully written
# below -- if this call gets killed partway through encoding/writing, the
# next invocation must still be able to skip straight back to this point
# instead of redoing the SQLite reconstruction (or, worse, the entire
# aggregation) from scratch.

# ── 3. Build Category Lookups ───────────────────────────────────────────────
print('\n[3/5] Building lookup mapping tables...', flush=True)

month_map, months_list = build_lookup(list(months_set))
line_map, lines_list = build_lookup(list(lines_set))
brand_map, brands_list = build_lookup(list(brands_set))
prod_map, prods_list = build_lookup(list(products_set))
rep_map, reps_list = build_lookup(list(reps_set))
dm_map, dms_list = build_lookup(list(dms_set))
rm_map, rms_list = build_lookup(list(rms_set))
nsm_map, nsms_list = build_lookup(list(nsms_set))
bu_map, buheads_list = build_lookup(list(buheads_set))
cm_map, cms_list = build_lookup(list(cms_set))
reg_map, regions_list = build_lookup(list(regions_set))
brick_map, bricks_list = build_lookup(list(bricks_set))
dist_map, distributors_list = build_lookup(list(distributors_set))
chain_map, chains_list = build_lookup(list(chains_set))
main_type_map, main_types_list = build_lookup(list(main_types_set))
sub_type_map, sub_types_list = build_lookup(list(sub_types_set))
tx_type_map, tx_types_list = build_lookup(list(tx_types_set))

# Align static representative properties with reps list
rep_hiring_dates = [rep_hiring_map.get(name, "") for name in reps_list]
rep_positions = [rep_position_map.get(name, "Medical Representative") for name in reps_list]

# NOTE: keys below are the enterprise taxonomy (BUHead -> NSM -> RM -> DM -> Rep),
# validated against cache/organogram.json. 'cms' (Emp6/Commercial Manager) is
# captured for completeness/future extensibility but is intentionally never
# rendered as a filter dropdown in js/sales.js — single company-wide value,
# no analytical slicing power.
lookups = {
    'months': months_list, 'lines': lines_list, 'brands': brands_list, 'products': prods_list,
    'reps': reps_list, 'dms': dms_list, 'rms': rms_list, 'nsms': nsms_list,
    'buheads': buheads_list, 'cms': cms_list, 'regions': regions_list, 'bricks': bricks_list, 'distributors': distributors_list,
    'chains': chains_list, 'main_types': main_types_list, 'sub_types': sub_types_list, 'transaction_types': tx_types_list,
    'rep_hiring_dates': rep_hiring_dates, 'rep_positions': rep_positions
}

# ── 4. Encode and Compress Aggregated Rows ───────────────────────────────────
print('\n[4/5] Encoding data rows with lookup indices...', flush=True)
encoded_rows = []
for k, v in aggregated.items():
    month_i = month_map[k[0]]
    line_i = line_map[k[1]]
    brand_i = brand_map[k[2]]
    prod_i = prod_map[k[3]]
    
    rep_i = rep_map[k[4]]
    dm_i = dm_map[k[5]]
    rm_i = rm_map[k[6]]
    nsm_i = nsm_map[k[7]]
    bu_i = bu_map[k[8]]
    cm_i = cm_map[k[9]]

    reg_i = reg_map[k[10]]
    brick_i = brick_map[k[11]]
    dist_i = dist_map[k[12]]
    chain_i = chain_map[k[13]]
    mtype_i = main_type_map[k[14]]
    stype_i = sub_type_map[k[15]]
    txtype_i = tx_type_map[k[16]]
    mask = k[17]

    # Row layout (index: field) — 0:month 1:line 2:brand 3:prod 4:rep 5:dm
    # 6:rm 7:nsm 8:buhead 9:cm 10:region 11:brick 12:distributor 13:chain
    # 14:main_type 15:sub_type 16:tx_type 17:flags_mask, then measures.
    encoded_rows.append([
        month_i, line_i, brand_i, prod_i, rep_i, dm_i, rm_i, nsm_i, bu_i, cm_i, reg_i, brick_i, dist_i,
        chain_i, mtype_i, stype_i, txtype_i, mask,
        round(v[0], 2), round(v[1], 2), round(v[2], 2), round(v[3], 2),
        round(v[4], 2), round(v[5], 2), round(v[6], 2), round(v[7], 2),
        len(v[8])
    ])

# Encode customer roster
encoded_customers = []
for k, v in customer_roster.items():
    cust_id = k[0]
    rep_i = rep_map[k[1]]
    brick_i = brick_map[k[2]]
    reg_i = reg_map[k[3]]
    line_i = line_map[k[4]]
    
    mask = 0
    ytd_sales = 0.0
    for m_str, val in v.items():
        ytd_sales += val
        m_idx = month_map[m_str]
        mask |= (1 << m_idx)
        
    encoded_customers.append([
        cust_id, rep_i, brick_i, reg_i, line_i, mask, round(ytd_sales, 2)
    ])

# ── 4b. Per-line Target Scenario coverage ───────────────────────────────────
# (2026-08-04) Which scenarios does each line ACTUALLY have target data
# for? Emitted into cache.meta so js/semantic-model.js's resolveScenario()
# can decide fallback from data instead of a hardcoded line list.
#
# This replaces the old CHC_SINGLE_SCENARIO_LINES constant, which was
# hardcoded from a one-off audit and went stale the moment the June TGT
# export gained real CHC Working data -- at which point it was actively
# suppressing figures that existed. Anything derived from the data should
# be measured from the data, not frozen into a name list that no one
# remembers to revisit.
#
# Coverage is keyed on NON-ZERO target value, not mere row presence: a
# line whose target rows are all zeros has no usable target for that
# scenario, and treating it as "covered" would surface a 0 target and a
# meaningless infinite achievement. Tender rows are excluded to match the
# Non-Tender convention every Achievement-family KPI already uses.
print('\n[4b/5] Measuring per-line target scenario coverage...', flush=True)
_MIRROR_BIT, _TENDER_BIT, _OFFICIAL_BIT = 16, 2, 32
scenario_coverage = {}
for _row in encoded_rows:
    _mask = _row[17]
    if not (_mask & _MIRROR_BIT):      # target/mirror rows only
        continue
    if _mask & _TENDER_BIT:            # Non-Tender convention
        continue
    if not _row[21] and not _row[20]:  # no target value AND no target qty
        continue
    _line = lines_list[_row[1]]
    _entry = scenario_coverage.setdefault(_line, {'official': False, 'working': False})
    _entry['official' if (_mask & _OFFICIAL_BIT) else 'working'] = True

_cov_official = sorted(l for l, c in scenario_coverage.items() if c['official'] and not c['working'])
_cov_working  = sorted(l for l, c in scenario_coverage.items() if c['working'] and not c['official'])
_cov_both     = sorted(l for l, c in scenario_coverage.items() if c['working'] and c['official'])
log(f'  Scenario coverage: {len(_cov_both)} line(s) with BOTH, '
    f'{len(_cov_official)} Official-only {_cov_official or ""}, '
    f'{len(_cov_working)} Working-only {_cov_working or ""}')

# ── 5. Output Caches ────────────────────────────────────────────────────────
print('\n[5/5] Gzipping and writing caches...', flush=True)

# schemaVersion bumps whenever the row layout or lookup-key naming changes.
# js/sales.js checks this before rendering so an old cache (pre hierarchy-fix)
# can never be read with the corrected front-end and silently show wrong
# names -- it shows a "cache needs refresh" placeholder instead. Bump this
# any time encoded_rows' column order/meaning or the lookups dict keys change.
SCHEMA_VERSION = 3  # v3 (2026-08-04) = Target Scenario feature: mask bit 5 now
# carries Official(1)/Working(0) scenario for mirror/target rows (see the
# mask-bitfield comment above), and meta.scenarioCoverage reports which
# scenarios each line actually has data for. NOTE (2026-08-04, later same
# day): js/sales.js does NOT hard-gate on v3 -- it degrades gracefully on
# an older cache (treating every mirror row as valid for whichever
# scenario is requested, i.e. exactly pre-feature behavior) rather than
# blocking the whole Sales tab, which an earlier hard gate did and which
# was a worse regression than the misread it prevented. Its
# REQUIRED_SCHEMA_VERSION stays at 2 -- the real structural gate.
# v2 = corrected hierarchy naming (BUHead->NSM->RM->DM->Rep) + CM (Emp6) captured.

cache_obj = {
    'meta': {
        'schemaVersion': SCHEMA_VERSION,
        'hierarchy': ['buhead', 'nsm', 'rm', 'dm', 'rep'],
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'sourceRows': total_source_rows,
        'aggregatedRows': len(aggregated),
        # Per-line Target Scenario coverage (2026-08-04): see section 4b.
        # {lineName: {'official': bool, 'working': bool}} -- read by
        # js/semantic-model.js resolveScenario() to resolve fallback from
        # measured data rather than a hardcoded line list.
        'scenarioCoverage': scenario_coverage,
    },
    'lookups': lookups,
    'rows': encoded_rows,
    'customers': encoded_customers
}

# Serialize once, write both outputs atomically (2026-07-28): a prior run
# got killed mid-write of a raw open(...,'w')+json.dump(), leaving a
# truncated, unparseable cache/sales.json in place of the last known-good
# file -- there is no in-between state here that's safe to leave live.
# Temp-file-then-os.replace() means a kill mid-write only strands a .tmp
# file; the real cache/sales.json is only ever swapped in complete. Also
# serializes cache_obj to a string once instead of twice (json.dump then a
# separate json.dumps for compression) -- pure waste on a ~16MB+ object.
json_str = json.dumps(cache_obj, separators=(',', ':'))

_json_tmp = OUTPUT_JSON + '.tmp'
with open(_json_tmp, 'w', encoding='utf-8') as f:
    f.write(json_str)
os.replace(_json_tmp, OUTPUT_JSON)
log(f'Wrote sales.json: {os.path.getsize(OUTPUT_JSON)//1024} KB')

# Level 6 (zlib's own default), not 9 (2026-07-28): on a ~60MB+ JSON
# payload, level 9's marginal size savings over level 6 aren't worth the
# extra compute time, which was a real contributor to this stage blowing
# past the sandbox's 45s test cap.
compressed = gzip.compress(json_str.encode('utf-8'), compresslevel=6)
b64_data = base64.b64encode(compressed).decode('ascii')
js_content = f'window.SALES_CACHE = {{ b64Data: "{b64_data}" }};'

_js_tmp = OUTPUT_JS + '.tmp'
with open(_js_tmp, 'w', encoding='utf-8') as f:
    f.write(js_content)
os.replace(_js_tmp, OUTPUT_JS)
log(f'Wrote sales.data.js: {os.path.getsize(OUTPUT_JS)//1024} KB')

# Now that both outputs are safely on disk, the SQLite checkpoint has
# served its purpose -- clear it so the next refresh starts a genuine
# fresh aggregation instead of silently resuming stale progress.
_clear_checkpoint(DB_PATH, t0)
_clear_checkpoint(DB_PATH + '-wal', t0)
_clear_checkpoint(DB_PATH + '-shm', t0)
_clear_checkpoint(RECON_PKL, t0)

# The SQLite checkpoint DB was already cleared right after a successful
# aggregation pass above. This clears any stray .pkl left behind by an
# earlier design of this script (pre-2026-07-28), in case one is still
# sitting on disk from a prior failed run.
_clear_checkpoint(CHECKPOINT_AGG_PKL, t0)

print(f'\nSales Aggregation Complete! Cache size: {os.path.getsize(OUTPUT_JS)//1024} KB\n')
