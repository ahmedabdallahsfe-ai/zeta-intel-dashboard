"""
TMS vs IMS Dashboard — Data Refresh Script
Reads 'TMS VS IMS.xlsx', extracts data, rebuilds index.html,
and optionally pushes to both GitHub repos.

Usage:
    python refresh_dashboard.py              # refresh data only
    python refresh_dashboard.py --push       # refresh + push to GitHub
"""

import openpyxl
import json
import os
import sys
import base64
import urllib.request
import urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EXCEL_FILE = os.path.join(SCRIPT_DIR, 'TMS VS IMS.xlsx')
HTML_FILE = os.path.join(SCRIPT_DIR, 'index.html')
# Optional distributor opening stock (2026-09-25, Ahmed): units on hand at the
# distributor at the START of the first month in 'Raw Data'. Read only if the
# file exists; blank quantities are ignored. Feeds only the main dashboard
# cache (cache/tms_ims.data.js -> OPENING), never index.html's data block.
OPENING_FILE = os.path.join(SCRIPT_DIR, 'Opening Stock.xlsx')
OPENING_JS = "[]"
TOKEN_FILE = os.path.join(SCRIPT_DIR, '.github_token')

# GitHub repos: owner/repo format
GITHUB_OWNER = 'ahmedabdallahsfe-ai'
REPOS = [
    ('private', 'tms-ims-dashboard'),
    ('public',  'tms-ims-dashboard-demo'),
]


def extract_data():
    """Read Excel and return JS data block string."""
    print(f"[1/3] Reading {os.path.basename(EXCEL_FILE)}...")
    wb = openpyxl.load_workbook(EXCEL_FILE, read_only=True, data_only=True)
    ws = wb['Raw Data']
    rows = list(ws.iter_rows(values_only=True))
    data = [r for r in rows[1:] if r[0] is not None]
    print(f"      Found {len(data)} data rows")

    # Chronological month ordering
    month_order = {'Jan':1,'Feb':2,'Mar':3,'Apr':4,'May':5,'Jun':6,
                   'Jul':7,'Aug':8,'Sep':9,'Oct':10,'Nov':11,'Dec':12}
    month_year_pairs = sorted(set((r[2], month_order[r[0]], r[0]) for r in data))
    MONTHS = [f"{m} {y}" for y, mn, m in month_year_pairs]
    month_map = {(y, m): i for i, (y, mn, m) in enumerate(month_year_pairs)}

    # Normalize BU names
    bu_norm = {
        'CHC':'CHC','CLUSTER':'Cluster','Cluster':'Cluster',
        'DIAB':'Diabetes','Diabetes':'Diabetes','GIT':'GIT',
        'Non-Promoted':'Non-Promoted'
    }

    # Normalize Line names
    raw_lines = set(str(r[5]).strip() for r in data)
    canonical_lines = {
        'CHC':'CHC','NEUROSCIENCE':'Neuroscience','CVM I':'CVM I','CVM II':'CVM II',
        'DERMA':'Derma','DIAB I':'Diabetes I','DIAB II':'Diabetes II',
        'DIAB III':'Diabetes III','DIAB IV':'Diabetes IV',
        'DIABETES I':'Diabetes I','DIABETES II':'Diabetes II',
        'DIABETES III':'Diabetes III','DIABETES IV':'Diabetes IV',
        'GIT I':'GIT I','GIT II':'GIT II','GIT III':'GIT III',
        'PEDIA':'Pedia','NON PROMOTED':'Non-Promoted',
        'ORTHO I':'Ortho I','ORTHO II':'Ortho II',
        'CNS I':'CNS I','CNS II':'CNS II','GYNA':'Gyna'
    }
    line_norm = {}
    for l in raw_lines:
        key = l.upper().replace('-',' ').replace('  ',' ').strip()
        line_norm[l] = canonical_lines.get(key, l)

    # Normalize Brand names (merge case variants)
    raw_brands = set(str(r[6]).strip() for r in data)
    seen_upper = {}
    brand_canonical = {}
    for b in sorted(raw_brands):
        key = b.upper()
        if key not in seen_upper:
            seen_upper[key] = b
        brand_canonical[b] = seen_upper[key]

    # Build indexed arrays
    bus, lines, brands, sts, prods = [], [], [], [], []
    def idx(lst, v):
        if v not in lst: lst.append(v)
        return lst.index(v)

    out = []
    for r in data:
        m, yr = r[0], r[2]
        bu = bu_norm.get(str(r[4]).strip(), str(r[4]).strip())
        ln = line_norm.get(str(r[5]).strip(), str(r[5]).strip())
        br = brand_canonical.get(str(r[6]).strip(), str(r[6]).strip())
        code = str(r[7]).strip()
        prod = str(r[8]).strip()
        st = str(r[9]).strip()
        typ = r[11]
        qty = r[12] or 0
        pp = r[10] or 0
        val = r[13] if r[13] else (qty * pp)  # fallback: compute from QTY × P.P if formula not cached
        mi = month_map[(yr, m)]
        out.append([mi, idx(bus,bu), idx(lines,ln), idx(brands,br),
                    idx(prods, f"{code}|{prod}"), idx(sts,st),
                    1 if typ=='IMS' else 0,
                    round(qty), round(val)])

    # ---- optional opening stock -> OPENING rows [bu, line, salesType, product(-1 = whole BU/line), qty]
    global OPENING_JS
    opening = []
    if os.path.exists(OPENING_FILE):
        try:
            owb = openpyxl.load_workbook(OPENING_FILE, read_only=True, data_only=True)
            orows = list(owb.worksheets[0].iter_rows(values_only=True))
            hdr = [str(h).strip() if h is not None else '' for h in orows[0]]
            col = {h: i for i, h in enumerate(hdr)}
            missing = [h for h in ['Business Unit', 'Line', 'Code', 'Sales Type', 'Opening Qty'] if h not in col]
            if missing:
                print(f"      [WARN] Opening Stock.xlsx: missing column(s) {missing} -- ignored")
            else:
                code_to_prod = {}
                for i, pk in enumerate(prods):
                    code_to_prod.setdefault(pk.split('|')[0], i)
                skipped = 0
                for orow in orows[1:]:
                    if not orow: continue
                    q = orow[col['Opening Qty']]
                    est = 0
                    # Blank Opening Qty -> use 'Minimum implied (units)' as an
                    # ESTIMATE (2026-09-25, Ahmed: show CHC days like the other
                    # BUs now). Flagged est=1 so the dashboard labels it; any
                    # real figure typed into Opening Qty replaces it.
                    if (q is None or str(q).strip() == '') and 'Minimum implied (units)' in col:
                        q = orow[col['Minimum implied (units)']]; est = 1
                    if q is None or str(q).strip() == '': continue
                    try: q = float(q)
                    except Exception: skipped += 1; continue
                    obu_raw = str(orow[col['Business Unit']] or '').strip()
                    obu = bu_norm.get(obu_raw, obu_raw)
                    oln_raw = str(orow[col['Line']] or '').strip()
                    oln = line_norm.get(oln_raw, canonical_lines.get(oln_raw.upper().replace('-', ' ').replace('  ', ' ').strip(), oln_raw))
                    ost = str(orow[col['Sales Type']] or 'Private').strip()
                    ocode = str(orow[col['Code']] or '').strip()
                    if obu not in bus or oln not in lines or ost not in sts or (ocode and ocode not in code_to_prod):
                        skipped += 1; continue
                    opening.append([bus.index(obu), lines.index(oln), sts.index(ost),
                                    code_to_prod[ocode] if ocode else -1, round(q), est])
                print(f"      Opening stock: {len(opening)} row(s), {sum(o[4] for o in opening):,} units ({sum(1 for o in opening if o[5])} estimated from 'Minimum implied')" + (f" ({skipped} skipped -- check BU/Line/Code/Sales Type)" if skipped else ""))
        except Exception as exc:
            print(f"      [WARN] Opening Stock.xlsx could not be read ({exc}) -- ignored")
    OPENING_JS = json.dumps(opening)

    datajs = (
        f"const MONTHS={json.dumps(MONTHS)};\n"
        f"const BUS={json.dumps(bus)};\n"
        f"const LINES={json.dumps(lines)};\n"
        f"const BRANDS={json.dumps(brands)};\n"
        f"const STYPES={json.dumps(sts)};\n"
        f"const PRODUCTS={json.dumps(prods)};\n"
        f"const ROWS={json.dumps(out)};\n"
    )

    print(f"      Months: {MONTHS}")
    print(f"      BUs: {bus}")
    print(f"      Brands: {len(brands)} | Products: {len(prods)} | Rows: {len(out)}")
    return datajs


def rebuild_html(datajs):
    """Replace data block in index.html with new data."""
    print(f"[2/3] Rebuilding {os.path.basename(HTML_FILE)}...")
    END_MARK = ']];\n'

    with open(HTML_FILE, 'r', encoding='utf-8') as f:
        s = f.read()

    a = s.index('const MONTHS=')
    rows_start = s.index('const ROWS=[[', a)
    b = s.index(END_MARK, rows_start) + len(END_MARK)

    new_s = s[:a] + datajs + s[b:]

    with open(HTML_FILE, 'w', encoding='utf-8') as f:
        f.write(new_s)

    # Rebuild Main Dashboard Cache
    main_cache_dir = os.path.join(SCRIPT_DIR, '..', 'cache')
    if os.path.exists(main_cache_dir):
        lines = datajs.strip().split('\n')
        wrapped_lines = []
        for line in lines:
            if line.startswith('const '):
                wrapped_lines.append(line.replace('const ', 'var ', 1))
            else:
                wrapped_lines.append(line)
        wrapped_code = (
            "(function(global) {\n"
            "  \"use strict\";\n"
            "  " + "\n  ".join(wrapped_lines) + "\n"
            "  var OPENING=" + OPENING_JS + ";\n"
            "  global.TMS_IMS_CACHE = { MONTHS, BUS, LINES, BRANDS, STYPES, PRODUCTS, ROWS, OPENING };\n"
            "})(window);\n"
        )
        cache_path = os.path.join(main_cache_dir, 'tms_ims.data.js')
        with open(cache_path, 'w', encoding='utf-8') as f:
            f.write(wrapped_code)
        print(f"      Rebuilt main dashboard cache: {os.path.basename(cache_path)}")

    print(f"      Updated! Old: {b-a:,} bytes -> New: {len(datajs):,} bytes")
    print(f"      File size: {len(new_s):,} bytes")


def get_token():
    """Read GitHub token from .github_token file."""
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'r') as f:
            return f.read().strip()
    # Prompt user
    print("\n      GitHub Personal Access Token not found.")
    print("      Create one at: https://github.com/settings/tokens")
    print("      Scopes needed: 'repo' (Full control of private repositories)")
    token = input("      Paste your token here: ").strip()
    if token:
        with open(TOKEN_FILE, 'w') as f:
            f.write(token)
        print("      Token saved to .github_token (keep this file private!)")
    return token


def github_api(method, url, token, data=None):
    """Make a GitHub API request."""
    headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'TMS-IMS-Dashboard-Refresh',
    }
    if data:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(data).encode('utf-8')
    else:
        body = None

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        raise Exception(f"GitHub API {e.code}: {error_body}")


def push_to_github():
    """Push index.html to both GitHub repos via GitHub API."""
    print("[3/3] Pushing to GitHub...")

    token = get_token()
    if not token:
        print("      ERROR: No token provided. Skipping push.")
        return

    # Read file content and base64 encode
    with open(HTML_FILE, 'rb') as f:
        content_b64 = base64.b64encode(f.read()).decode('ascii')

    for label, repo_name in REPOS:
        api_url = f"https://api.github.com/repos/{GITHUB_OWNER}/{repo_name}/contents/index.html"

        try:
            # Get current file SHA (needed for update)
            existing = github_api('GET', api_url, token)
            sha = existing['sha']

            # Update file
            github_api('PUT', api_url, token, {
                'message': 'Dashboard data refresh',
                'content': content_b64,
                'sha': sha,
            })
            print(f"      {label.upper()} repo: pushed!")

        except Exception as e:
            if '404' in str(e):
                # File doesn't exist yet, create it
                try:
                    github_api('PUT', api_url, token, {
                        'message': 'Dashboard data refresh',
                        'content': content_b64,
                    })
                    print(f"      {label.upper()} repo: created & pushed!")
                except Exception as e2:
                    print(f"      {label.upper()} repo: FAILED - {e2}")
            else:
                print(f"      {label.upper()} repo: FAILED - {e}")


def main():
    do_push = '--push' in sys.argv

    datajs = extract_data()
    rebuild_html(datajs)

    if do_push:
        push_to_github()
    else:
        print("[3/3] Skipping GitHub push (use --push to enable)")

    print("\nDone!")


if __name__ == '__main__':
    main()
