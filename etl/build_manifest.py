"""
build_manifest.py — records what was built, from what, and when.
==============================================================================

Writes cache/build_manifest.data.js, which the in-app Control Panel reads to
answer one question an executive should never have to guess at: "is what I am
looking at current?"

WHY THIS SCRIPT EXISTS
------------------------------------------------------------------------------
The dashboard is a static site. The browser cannot stat a file on disk, so it
has no way to know that TOTAL_SALES_2026.xlsx was updated at 02:52 while the
sales cache was built at 00:57 — the exact situation observed on 2026-08-07,
where the shipped cache was OLDER than its own source workbook and nothing on
screen said so.

Only the ETL machine can see both sides. So it records them here, at build
time, and the Control Panel reads the record.

WHAT IT DELIBERATELY DOES NOT DO
------------------------------------------------------------------------------
It does not judge whether the DATA is right. It reports mechanical facts —
timestamps, sizes, row counts, which step ran — and leaves interpretation to
the panel. A manifest that editorialises is a manifest that goes stale in a
different way from the thing it describes.

RUN LAST. It stats the caches, so anything that runs after it will not be
reflected until the next refresh.
"""

import os
import sys
import json
import gzip
import base64
import re
from datetime import datetime, timezone

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JS = os.path.join(ROOT_DIR, 'cache', 'build_manifest.data.js')

SCHEMA_VERSION = 1


# -----------------------------------------------------------------------------
# The map of what comes from where.
#
# Sources are listed in the order the ETL reads them. A missing source is
# reported rather than skipped: "the workbook isn't there" is exactly the kind
# of thing that should show up on a health panel, not fail silently.
# -----------------------------------------------------------------------------
DATASETS = [
    {
        'key': 'coverage',
        'label': 'Coverage & SFE',
        'builder': 'refresh.py',
        'caches': ['dashboard.data.js', 'records.data.js', 'metadata.data.js',
                   'organogram.data.js', 'teamkpis.data.js'],
        'sources': ['Final Total Coverage Feb to June.xlsx'],
        'powers': ['Coverage', 'SFE', 'Executive (coverage KPIs)'],
    },
    {
        'key': 'sales',
        'label': 'Sales',
        'builder': 'refresh_sales.py',
        'caches': ['sales.data.js'],
        'sources': ['TOTAL_SALES_2026.xlsx',
                    os.path.join('ZETA SALES_2026', 'june.xlsx'),
                    os.path.join('ZETA SALES_2026', 'June TGT 2026.xlsx')],
        'powers': ['Sales', 'Executive (sales KPIs)', 'Ask the Data'],
    },
    {
        'key': 'iqvia',
        'label': 'IQVIA Market Share',
        'builder': 'refresh_iqvia.py',
        'caches': ['iqvia.data.js'],
        'sources': [os.path.join('iqvia_source', 'IQVIA_SOURCE.xlsx'),
                    os.path.join('iqvia_source', 'TARGET_MARKET_SHARE.xlsx')],
        'powers': ['IQVIA Market Share', 'Executive (market share KPI)', 'Sign-in roster'],
    },
    {
        'key': 'customer_analytics',
        'label': 'Customer Analytics',
        'builder': 'etl/build_customer_analytics_cache.py',
        'caches': ['customer_analytics.data.js'],
        'sources': ['TOTAL_SALES_2026.xlsx',
                    os.path.join('ZETA SALES_2026', 'june.xlsx')],
        'powers': ['Customer Channel Mix drill', 'Customer Health'],
    },
    {
        'key': 'market_intel',
        'label': 'Total Market Intelligence',
        'builder': 'etl/build_market_intel_cache.py',
        'caches': ['market_intel.data.js'],
        'sources': ['IMS 2022 to April 2026.xlsx'],
        'powers': ['Total Market Intelligence'],
    },
    {
        'key': 'tms_ims',
        'label': 'To-Market vs In-Market',
        'builder': 'TO MARKET_IN MARKET/refresh_dashboard.py',
        'caches': ['tms_ims.data.js'],
        'sources': [os.path.join('TO MARKET_IN MARKET', 'TMS VS IMS.xlsx')],
        'powers': ['To-Market vs In-Market'],
    },
]


def stat_file(path):
    """Mechanical facts about a file, or a clear absence."""
    full = path if os.path.isabs(path) else os.path.join(ROOT_DIR, path)
    if not os.path.exists(full):
        return {'name': os.path.basename(path), 'path': path, 'exists': False}
    st = os.stat(full)
    return {
        'name': os.path.basename(path),
        'path': path,
        'exists': True,
        'bytes': st.st_size,
        'modifiedAt': datetime.fromtimestamp(st.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
        'modifiedEpoch': int(st.st_mtime),
    }


def cache_built_at(filename):
    """
    The build timestamp a cache records about ITSELF.

    Read from the payload rather than the file's mtime, because the two can
    disagree: a file copied or re-committed gets a new mtime while the data
    inside is unchanged. The self-reported value is the honest one.

    Returns (built_at_string_or_None, extra_facts_dict).
    """
    full = os.path.join(ROOT_DIR, 'cache', filename)
    if not os.path.exists(full):
        return None, {}
    try:
        with open(full, 'r', encoding='utf-8') as fh:
            text = fh.read()
        m = re.search(r'b64Data"?\s*:\s*"([^"]+)"', text)
        if not m:
            return None, {}
        payload = json.loads(gzip.decompress(base64.b64decode(m.group(1))))
    except Exception as exc:                      # noqa: BLE001 - report, never raise
        return None, {'decodeError': str(exc)[:200]}

    extra = {}
    built = None

    meta = payload.get('meta') if isinstance(payload, dict) else None
    if isinstance(meta, dict):
        built = meta.get('generatedAt')
        for k in ('schemaVersion', 'sourceRows', 'aggregatedRows', 'annualCells'):
            if k in meta:
                extra[k] = meta[k]
        if isinstance(meta.get('annualYears'), list):
            extra['periods'] = [str(y) for y in meta['annualYears']]

    if built is None and isinstance(payload, dict):
        built = payload.get('generatedAt')
        if payload.get('sourceRows') is not None:
            extra['sourceRows'] = payload['sourceRows']

    # Period coverage, however this particular cache happens to express it.
    if isinstance(payload, dict):
        lookups = payload.get('lookups')
        if isinstance(lookups, dict) and isinstance(lookups.get('months'), list):
            extra['periods'] = list(lookups['months'])
        dims = payload.get('dimensions')
        if isinstance(dims, dict) and isinstance(dims.get('periods'), list):
            extra['periods'] = list(dims['periods'])
        clusters = payload.get('clusters')
        if isinstance(clusters, dict):
            for _name, val in clusters.items():
                if isinstance(val, dict) and isinstance(val.get('months'), list):
                    extra['periods'] = list(val['months'])
                    break
        if isinstance(payload.get('rows'), list):
            extra.setdefault('rows', len(payload['rows']))
        dq = payload.get('dataQuality')
        if isinstance(dq, dict):
            extra['dataQuality'] = {
                'errors': len(dq.get('errors') or []),
                'warnings': len(dq.get('warnings') or []),
            }

    if built and isinstance(built, str):
        built = built.replace('T', ' ')[:19]
    return built, extra


def build():
    datasets = []
    for spec in DATASETS:
        caches = [stat_file(os.path.join('cache', c)) for c in spec['caches']]
        sources = [stat_file(s) for s in spec['sources']]

        built_at = None
        facts = {}
        for c in spec['caches']:
            b, extra = cache_built_at(c)
            if b and (built_at is None or b < built_at):
                built_at = b            # oldest of the group is the honest one
            for k, v in extra.items():
                facts.setdefault(k, v)

        # Not every ETL stamps a build time into its payload — Coverage,
        # IQVIA and TMS/IMS currently do not. Falling back to the cache
        # file's mtime is weaker evidence (a copy or a re-commit moves it
        # without the data changing), so the manifest records WHICH kind of
        # timestamp this is and the panel says so rather than presenting
        # the two as equivalent.
        built_source = 'self-reported'
        if not built_at:
            newest = None
            for c in caches:
                if c.get('exists') and (newest is None or c['modifiedAt'] > newest):
                    newest = c['modifiedAt']
            if newest:
                built_at = newest
                built_source = 'file-mtime'
            else:
                built_source = 'none'

        datasets.append({
            'key': spec['key'],
            'label': spec['label'],
            'builder': spec['builder'],
            'powers': spec['powers'],
            'builtAt': built_at,
            'builtAtSource': built_source,
            'caches': caches,
            'sources': sources,
            'facts': facts,
        })

    manifest = {
        'schemaVersion': SCHEMA_VERSION,
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'generatedAtUtc': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
        'machine': os.environ.get('COMPUTERNAME') or os.environ.get('HOSTNAME') or '',
        'datasets': datasets,
    }

    payload = json.dumps(manifest, separators=(',', ':'), ensure_ascii=False)
    gz = gzip.compress(payload.encode('utf-8'), compresslevel=9)
    b64 = base64.b64encode(gz).decode('ascii')

    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    with open(OUT_JS, 'w', encoding='utf-8') as fh:
        fh.write('window.BUILD_MANIFEST = { b64Data: "' + b64 + '" };\n')

    stale = []
    for d in datasets:
        if not d['builtAt']:
            continue
        for s in d['sources']:
            if s.get('exists') and s['modifiedAt'] > d['builtAt']:
                stale.append(d['label'] + ' <- ' + s['name'])

    print('[manifest] {0} datasets, {1} bytes'.format(len(datasets), len(b64)))
    if stale:
        print('[manifest] SOURCE NEWER THAN CACHE:')
        for s in stale:
            print('             ' + s)
    else:
        print('[manifest] every cache is at or ahead of its sources')
    return 0


if __name__ == '__main__':
    sys.exit(build())
