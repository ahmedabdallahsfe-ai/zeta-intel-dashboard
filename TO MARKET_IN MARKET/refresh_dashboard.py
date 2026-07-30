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
