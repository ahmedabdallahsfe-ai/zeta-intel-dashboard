"""Brand Manager "Regions Covered" -- auto-derived (Ahmed 2026-11-13:
"for brand manager search about regions they covered").

Replaces the never-filled manual template column with the regions a Brand
Manager actually worked in, from real field data:

  1. cache/coaching.json -- every joint visit where the Brand Manager is a
     listed coach (Coach Employee 1-4, see coaching_all_coach_slots_rule):
     coachedEmployees[].monthly[YYYY-MM].visits > 0 = the BM was in the
     field with that employee that month.
  2. Employee -> Sales Zone, in this order:
       a. the employee's territory position (e.g. "DIAB-IV CAIRO WEST")
          looked up in cache/sales.json (rep position -> Region, majority
          by sales value) -- the company's own zone per territory;
       b. same territory without the line prefix ("CAIRO WEST"), majority
          across every line booking that territory;
       c. the employee's Governrate in Database Shortcut.xlsx -> zone,
          learned from employees already mapped by (a)/(b) (covers coached
          DMs / generic titles like "Medical Representative").
  3. Regions Covered = number of DISTINCT zones in the period.

Zones are the Sales cache's own Region values (Alex / Cairo / Delta /
Upper Egypt Zone today). Unmapped employees are reported, never guessed.
"""
import collections
import json
import os
import re

ZONE_IGNORE = {'(none)', 'Unknown', '', None}

# 2026-11-14 (Ahmed: "they are 5 regions cairo giza upper egypt delta and
# alex"). Region per position comes from the organogram-based position
# master (IQVIA TERRIOTRY/Position_Brick_Mapping_148.xlsx, sheet
# Position_Master, column "Region(s)"), which has GUIZA separate from CAIRO.
# CANAL is not one of the 5 -> counted as Delta. A position listed in two
# regions ("CAIRO, GUIZA") counts its FIRST region.
REGIONS = ['Alex', 'Cairo', 'Giza', 'Delta', 'Upper Egypt']
REGION_MAP = {'ALEXANDRIA': 'Alex', 'ALEX': 'Alex', 'CAIRO': 'Cairo', 'GUIZA': 'Giza', 'GIZA': 'Giza',
              'DELTA': 'Delta', 'CANAL': 'Delta', 'UPPER EGYPT': 'Upper Egypt'}
SALES_ZONE_MAP = {'Alex Zone': 'Alex', 'Delta Zone': 'Delta', 'Upper Egypt Zone': 'Upper Egypt'}  # Cairo Zone = Cairo+Giza: ambiguous
POSITION_MASTER = os.path.join('IQVIA TERRIOTRY', 'Position_Brick_Mapping_148.xlsx')
_LINE_PREFIX = re.compile(r'^(DIAB|GIT|CVM|ORTHO|PED|PEDIA|NEUROSCIENCE|CNS|DERMA|CHC|GYN|URO|RESP|CLUSTER)( (I|II|III|IV|V|VI|S))?( |$)')


def _norm(x):
    return re.sub(r'[^A-Z0-9]+', ' ', str(x or '').upper()).strip()


def _suffix(pos):
    p = _norm(pos)
    m = _LINE_PREFIX.match(p)
    return p[m.end():].strip() if m else p


def points_for_count(curve, count):
    """Regions Covered is a whole-number KPI. The Brand Managers curve is a
    step table (1->4, 2->8 ... 5->20); exact lookup, NOT interp() -- interp()
    returns 0 for x <= the first point, which would score 1 region as 0."""
    if count is None:
        return None
    if count <= 0 or not curve:
        return 0.0
    table = {int(round(x)): y for x, y in curve}
    top = max(table)
    return float(table.get(min(int(count), top), 0.0))


class BmRegionResolver:
    def __init__(self, root_dir, db_rows=None):
        self.root = root_dir
        self._load_sales_zones()
        self._load_position_master()
        self._load_coaching()
        self._load_governorates(db_rows)

    # -- sources ------------------------------------------------------
    def _load_sales_zones(self):
        with open(os.path.join(self.root, 'cache', 'sales.json'), encoding='utf-8') as f:
            s = json.load(f)
        lk = s['lookups']
        pos, regs = lk['rep_positions'], lk['regions']
        by_pos = collections.defaultdict(collections.Counter)
        for r in s['rows']:
            reg = regs[r[10]]
            if reg in ZONE_IGNORE:
                continue
            by_pos[_norm(pos[r[4]])][reg] += abs(r[19] or 0) + 0.001
        by_suf = collections.defaultdict(collections.Counter)
        for p, c in by_pos.items():
            for z, v in c.items():
                by_suf[_suffix(p)][z] += v
        self.pos_zone = {p: c.most_common(1)[0][0] for p, c in by_pos.items()}
        self.suf_zone = {p: c.most_common(1)[0][0] for p, c in by_suf.items()}
        self.zones = list(REGIONS)
        del s

    def _load_position_master(self):
        import openpyxl
        self.pm_region, self.pm_suffix = {}, {}
        path = os.path.join(self.root, POSITION_MASTER)
        if not os.path.exists(path):
            return
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb['Position_Master']
        it = ws.iter_rows(values_only=True)
        h = list(next(it))
        pi, ri = h.index('Position'), h.index('Region(s)')
        suf = collections.defaultdict(collections.Counter)
        for r in it:
            if not r or not r[pi] or not r[ri]:
                continue
            first = str(r[ri]).split(',')[0].strip().upper()
            reg = REGION_MAP.get(first)
            if not reg:
                continue
            self.pm_region[_norm(r[pi])] = reg
            suf[_suffix(r[pi])][reg] += 1
        wb.close()
        self.pm_suffix = {k: c.most_common(1)[0][0] for k, c in suf.items()}

    def _load_coaching(self):
        with open(os.path.join(self.root, 'cache', 'coaching.json'), encoding='utf-8') as f:
            c = json.load(f)
        self.coach_by_code = {}
        for m in c.get('managers', []):
            if m.get('code') is None:
                continue
            self.coach_by_code[str(int(m['code']))] = m

    def _load_governorates(self, db_rows):
        """db_rows: iterable of (name, governorate). Read from Database
        Shortcut.xlsx when not supplied."""
        if db_rows is None:
            import openpyxl
            wb = openpyxl.load_workbook(os.path.join(self.root, 'Database Shortcut.xlsx'), read_only=True, data_only=True)
            ws = wb.worksheets[0]
            it = ws.iter_rows(values_only=True)
            h = list(next(it))
            ni = h.index('Employee Name (English)')
            gi = h.index('Governrate')
            db_rows = [(r[ni], r[gi]) for r in it if r and r[ni]]
            wb.close()
        self.name_gov = {}
        for n, g in db_rows:
            if g and str(g).strip() not in ('0', ''):
                self.name_gov[_norm(n)] = str(g).strip()
        # learn governorate -> zone from employees whose position maps.
        votes = collections.defaultdict(collections.Counter)
        for m in self.coach_by_code.values():
            for e in m.get('coachedEmployees', []):
                z = self._zone_by_position(e.get('position'))
                g = self.name_gov.get(_norm(e.get('name')))
                if z and g:
                    votes[g][z] += 1
        self.gov_zone = {g: c.most_common(1)[0][0] for g, c in votes.items()}

    # -- mapping ------------------------------------------------------
    def _zone_by_position(self, position):
        if not position:
            return None
        p = _norm(position)
        z = self.pm_region.get(p) or self.pm_suffix.get(_suffix(p))
        if z:
            return z
        sz = SALES_ZONE_MAP.get(self.pos_zone.get(p) or self.suf_zone.get(_suffix(p)))
        return sz

    def zone_for(self, name, position):
        z = self._zone_by_position(position)
        if z:
            return z, 'territory'
        g = self.name_gov.get(_norm(name))
        if g and self.gov_zone.get(g):
            return self.gov_zone[g], 'governorate'
        return None, None

    def regions(self, bm_code, months):
        """Distinct zones a Brand Manager covered across `months`
        (list of 'YYYY-MM'). Returns dict(count, zones, detail, rows, byMonth,
        unmapped, visits) or None when the BM has no coaching record.
        rows = one evidence line per coached employee (2026-11-14, Ahmed:
        "pop up evidence about brand manager regions covered")."""
        m = self.coach_by_code.get(str(bm_code))
        if m is None:
            return None
        months = sorted(set(months))
        zones = collections.defaultdict(lambda: dict(visits=0, employees=set()))
        by_month = {mo: set() for mo in months}
        rows, unmapped, visits = [], [], 0
        for e in m.get('coachedEmployees', []):
            per = {mo: (e.get('monthly') or {}).get(mo, {}).get('visits', 0) for mo in months}
            days = sum((e.get('monthly') or {}).get(mo, {}).get('coachingDays', 0) for mo in months)
            v = sum(per.values())
            if v <= 0:
                continue
            visits += v
            log = [x for x in (e.get('visitLog') or []) if str(x.get('date', ''))[:7] in per]
            dates = sorted(str(x['date'])[:10] for x in log if x.get('date'))
            z, how = self.zone_for(e.get('name'), e.get('position'))
            row = dict(name=e.get('name'), position=e.get('position'), line=e.get('line'),
                       zone=z, mappedBy=how, visits=v, coachingDays=days,
                       months={mo: n for mo, n in per.items() if n},
                       firstDate=dates[0] if dates else None, lastDate=dates[-1] if dates else None,
                       visitDates=sorted(set(dates)), customers=len({x.get('customer') for x in log if x.get('customer')}),
                       governorate=self.name_gov.get(_norm(e.get('name'))))
            rows.append(row)
            if not z:
                unmapped.append(dict(name=e.get('name'), position=e.get('position'), visits=v))
                continue
            zones[z]['visits'] += v
            zones[z]['employees'].add(f"{e.get('name')} ({e.get('position')})")
            for mo, n in per.items():
                if n:
                    by_month[mo].add(z)
        rows.sort(key=lambda r: (r['zone'] or 'zz', -r['visits'], r['name'] or ''))
        detail = [dict(zone=z, visits=d['visits'], employees=sorted(d['employees'])) for z, d in sorted(zones.items())]
        return dict(count=len(zones), zones=sorted(zones), detail=detail, rows=rows,
                    byMonth={mo: sorted(z) for mo, z in by_month.items()},
                    unmapped=unmapped, visits=visits)

    def detail_payload(self, reg):
        """The regionDetail object stored on the KPI (shared by ETL + rollup)."""
        reg = reg or {}
        return dict(zones=reg.get('zones', []), detail=reg.get('detail', []), rows=reg.get('rows', []),
                    byMonth=reg.get('byMonth', {}), unmapped=reg.get('unmapped', []),
                    visits=reg.get('visits', 0), zoneUniverse=self.zones)
