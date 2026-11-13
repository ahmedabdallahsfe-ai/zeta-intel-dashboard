"""Zeta Sprint sales aggregation -- ONE implementation shared by
etl/build_sprint_cache.py (monthly ranking) and
etl/build_sprint_period_rollup.py (Q3 achievement), so both read the Sales
cache with identical rules (moved here unchanged 2026-11-13, Ahmed chose
"A": Q3 sales % from the current sales file).

Rules (unchanged from build_sprint_cache.py):
  * Tender rows (flags_mask & 2) are excluded entirely.
  * Target scenario per line: CHC / CHC_SALES pinned to Working (2026-09-25);
    otherwise the first scenario the Sales cache has coverage for, in order
    shortage -> official -> working; 'official' when no coverage info.
  * A target row (mask & 16) counts only if it belongs to that scenario
    (mask & 64 shortage, mask & 32 official, neither = working).
  * Reps keyed by norm_name() of the Sales-cache rep name; lines by index.
"""
from collections import Counter, defaultdict

MONTH, LINE, REP, MASK, VAL, TGT_VAL = 0, 1, 4, 17, 19, 21
SCENARIO_PRIORITY = ('shortage', 'official', 'working')
SPRINT_PINNED_WORKING_LINES = {'CHC', 'CHC_SALES'}


def resolve_target_scenario(raw, scenario_coverage, normalize_line):
    canon = normalize_line(raw)
    if canon in SPRINT_PINNED_WORKING_LINES or raw in SPRINT_PINNED_WORKING_LINES:
        return 'working'
    cov = scenario_coverage.get(canon) or scenario_coverage.get(raw)
    if not cov:
        return 'official'
    for scenario in SCENARIO_PRIORITY:
        if cov.get(scenario):
            return scenario
    return 'official'


def include_target_row(mask, scenario, schema_version):
    if (mask & 16) == 0:
        return True
    if schema_version < 3:
        return True
    is_shortage = (mask & 64) > 0
    is_official = (mask & 32) > 0
    if scenario == 'shortage':
        return is_shortage
    if scenario == 'official':
        return is_official and not is_shortage
    return (not is_official) and not is_shortage  # 'working'


def aggregate(sales_cache, month_strs, normalize_line, norm_name):
    """Per-month rep and line val/target totals for the given 'YYYY-MM'
    months. Returns dict(rep={month:{key:{val,tgtVal}}}, line={month:{lineIdx:
    {val,tgtVal}}}, rep_lines_seen, rep_display_name, target_scenario_by_line)."""
    lines_lk = sales_cache['lookups']['lines']
    reps_lk = sales_cache['lookups']['reps']
    months_lk = sales_cache['lookups']['months']
    scen_cov = sales_cache['meta'].get('scenarioCoverage', {})
    schema_version = sales_cache['meta'].get('schemaVersion', 0)
    target_scenario_by_line = [resolve_target_scenario(l, scen_cov, normalize_line) for l in lines_lk]
    wanted = set(month_strs)
    rep = {m: defaultdict(lambda: dict(val=0, tgtVal=0)) for m in month_strs}
    line = {m: defaultdict(lambda: dict(val=0, tgtVal=0)) for m in month_strs}
    rep_lines_seen = defaultdict(Counter)
    rep_display_name = {}
    for r in sales_cache['rows']:
        if (r[MASK] & 2) > 0:
            continue
        month_str = months_lk[r[MONTH]] if r[MONTH] is not None and r[MONTH] < len(months_lk) else None
        if month_str not in wanted:
            continue
        want_tgt = include_target_row(r[MASK], target_scenario_by_line[r[LINE]], schema_version)
        la = line[month_str][r[LINE]]
        la['val'] += r[VAL] or 0
        if want_tgt:
            la['tgtVal'] += r[TGT_VAL] or 0
        rep_name = reps_lk[r[REP]] if r[REP] is not None and r[REP] < len(reps_lk) else None
        if not rep_name:
            continue
        key = norm_name(rep_name)
        a = rep[month_str][key]
        a['val'] += r[VAL] or 0
        if want_tgt:
            a['tgtVal'] += r[TGT_VAL] or 0
        rep_lines_seen[key][lines_lk[r[LINE]]] += 1
        rep_display_name.setdefault(key, rep_name)
    return dict(rep=rep, line=line, rep_lines_seen=rep_lines_seen, rep_display_name=rep_display_name,
                target_scenario_by_line=target_scenario_by_line)
