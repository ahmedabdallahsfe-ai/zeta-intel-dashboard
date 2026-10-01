# Step 1: collect every real person name + Arabic customer/place string from the
# production caches and Database Shortcut.xlsx, and fix one stable fake for each.
# Output goes to the VM scratch dir given as argv[1] (NEVER inside the project).
import sys, os, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake as F
out = sys.argv[1]
PERSON_KEYS = set('''name employee manager rep dm nsm asm bum rm areaManager managerName buhead coach directManager
from to activeTeam employeeNames managers nsms areaManagers businessUnits reps dms rms buheads cms unmatchedCoaches unmatchedReps
coachName repName dmName nsmName amName employeeName emp'''.split())
MAP_VAL_KEYS = {'teamToBu', 'teamToNsm', 'teamToAm'}
MAP_KEY_KEYS = {'buToTeams', 'nsmToTeams', 'amToTeams', 'managerToTeam', 'customers', 'byManager', 'byRep', 'byEmployee'}
names, arabic = set(), set()
def addname(s):
    if isinstance(s, str):
        b = F.SUFFIX.match(s.strip()).group(1)
        n = F._norm(b)
        if len(n.split()) >= 3 and not re.search(r'\d', b) and not n.startswith('VACANT'):
            names.add(n)
def rec(o, key=''):
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(k, str) and F.ARABIC.search(k): arabic.add(k)
            if key in MAP_KEY_KEYS or k in MAP_KEY_KEYS and isinstance(v, dict):
                pass
            if key in MAP_KEY_KEYS: addname(k)
            if key in MAP_VAL_KEYS: addname(v)
            rec(v, k)
    elif isinstance(o, list):
        for x in o:
            if key in PERSON_KEYS: addname(x)
            rec(x, key)
    elif isinstance(o, str):
        if F.ARABIC.search(o): arabic.add(o)
        if key in PERSON_KEYS: addname(o)
for c in sys.argv[2:]:
    t, obj, span = F.load_cache(c)
    n0, a0 = len(names), len(arabic)
    rec(obj)
    if c == 'iqvia':
        pass
    print(c, '+names', len(names) - n0, '+arabic', len(arabic) - a0, flush=True)
    del obj
# HR master
import openpyxl
wb = openpyxl.load_workbook(os.path.join(F.ROOT, 'Database Shortcut.xlsx'), read_only=True, data_only=True)
ws = wb.worksheets[0]
rows = ws.iter_rows(values_only=True); hdr = [str(x) for x in next(rows)]
for r in rows:
    for j in range(len(r)):
        if isinstance(r[j], str) and len(r[j].split()) >= 3 and not F.ARABIC.search(r[j]) and j < 40:
            if j in (1,) or 'Manager' in hdr[j]: addname(r[j])
print('HR names ->', len(names))
# stable fakes, assigned in sorted order (deterministic)
person_map = {}
for n in sorted(names):
    F._person.pop(n, None)
    person_map[n] = F.fake_person(n.title())
cust_map = {}
for i, s in enumerate(sorted(arabic)):
    cust_map[s] = 'Customer %05d' % (i + 1)
json.dump({'names': sorted(names), 'person_map': person_map, 'cust_map': cust_map}, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
print('saved', len(names), 'names,', len(cust_map), 'arabic strings ->', out)
