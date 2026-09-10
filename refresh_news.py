"""
refresh_news.py
=============================================================================
ZETA EXTERNAL MARKET INTELLIGENCE REFRESH SCRIPT
Executes the market intelligence ETL to update cache/news_latest.data.js.
Can be executed manually or as part of refresh.bat.
=============================================================================
"""

import sys
import os

# Add etl directory to path
current_dir = os.path.dirname(os.path.abspath(__file__))
etl_dir = os.path.join(current_dir, 'etl')
if etl_dir not in sys.path:
    sys.path.insert(0, etl_dir)

from build_news_cache import build_cache

if __name__ == '__main__':
    build_cache()
