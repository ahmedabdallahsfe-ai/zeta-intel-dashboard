"""
build_iqvia_item_packs.py -- IQVIA pack size per item (2026-10-20, Ahmed: "add packs beside SU and value").

Reads only Item / Pack Size / Standard Units Sales from iqvia_source/IQVIA_SOURCE.xlsx (sheet 'Egypt Combined Data',
the same file and sheet refresh_iqvia.py reads) and writes cache/iqvia_item_packs.json:
    {"source_mtime": ..., "packs": {"<IQVIA item>": <pack size = SU per pack>, ...}}
Pack size per item = the pack size that carries most SU for that item (an item is one pack, so normally only one).
Used by etl/market_forecast_packs.py: packs = SU / pack size. Read-only on the source.
"""
import json, os, sys, time
from collections import defaultdict
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'iqvia_source', 'IQVIA_SOURCE.xlsx')
OUT = os.path.join(ROOT, 'cache', 'iqvia_item_packs.json')
SHEET = 'Egypt Combined Data'

def main():
    import openpyxl
    t0 = time.time()
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    ws = wb[SHEET]
    it = ws.iter_rows(values_only=True)
    hdr = [str(h).strip() if h is not None else '' for h in next(it)]
    iI, iP, iS = hdr.index('Item'), hdr.index('Pack Size'), hdr.index('Standard Units Sales')
    acc = defaultdict(lambda: defaultdict(float)); n = 0
    for row in it:
        n += 1
        item = row[iI]
        if item is None: continue
        try: ps = float(row[iP] or 0)
        except Exception: ps = 0
        try: su = float(row[iS] or 0)
        except Exception: su = 0
        if ps > 0: acc[str(item).strip()][ps] += max(su, 0) + 1e-9
        if n % 200000 == 0: print(f'  {n:,} rows {time.time() - t0:.0f}s', flush=True)
    packs = {k: max(v, key=lambda p: v[p]) for k, v in acc.items()}
    packs = {k: (int(v) if float(v).is_integer() else v) for k, v in packs.items()}
    json.dump({'source_mtime': os.path.getmtime(SRC), 'rows': n, 'packs': packs}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'item packs: {len(packs):,} items from {n:,} rows -> {os.path.relpath(OUT, ROOT)} ({time.time() - t0:.0f}s)')

if __name__ == '__main__':
    main(); sys.exit(0)
