"""
build_manifest_from_map.py -- writes cache/build_manifest.data.js from config/refresh_map.json.
==============================================================================
Created 2026-10-02 for UPDATE_DASHBOARD.bat (Phase 2).

etl/build_manifest.py carries its own hard-coded dataset list, which had gone
stale (it still named TOTAL_SALES_2026.xlsx / june.xlsx for Sales and knew
nothing about Q3_SALES, CHC_BU_YTD, Database Shortcut, List Intell, ...).

This script does NOT modify build_manifest.py (refresh.bat still runs that one
unchanged). It imports it, swaps in a dataset list derived from the refresh
map -- the single source of truth -- and calls its build() so the output file
and format stay exactly the same.
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import build_manifest  # noqa: E402  (unchanged original)


def datasets_from_map():
    with open(os.path.join(ROOT, 'config', 'refresh_map.json'), encoding='utf-8') as fh:
        cfg = json.load(fh)
    pages = cfg.get('pages', {})
    out = []
    for st in cfg['steps']:
        if st['id'] == 'manifest':
            continue
        caches = [o[len('cache/'):] for o in st.get('outputs', []) if o.startswith('cache/') and o.endswith('.data.js')]
        if not caches:
            continue
        sources = []
        for pat in st.get('sources', []):
            hits = sorted(glob.glob(os.path.join(ROOT, pat))) if any(c in pat for c in '*?[') else [os.path.join(ROOT, pat)]
            sources += [os.path.relpath(h, ROOT) for h in hits if not os.path.basename(h).startswith('~$')]
        out.append({
            'key': st['id'],
            'label': st['label'],
            'builder': ' ; '.join(' '.join(c) for c in st['commands']),
            'caches': caches,
            'sources': sources,
            'powers': [pages.get(p, p) for p in st.get('pages', [])],
        })
    return out


if __name__ == '__main__':
    build_manifest.DATASETS = datasets_from_map()
    sys.exit(build_manifest.build())
