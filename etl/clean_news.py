import re

def strip_html(raw_html):
    if not raw_html:
        return ""
    clean_text = re.sub(r'<script.*?</script>', '', raw_html, flags=re.DOTALL | re.IGNORECASE)
    clean_text = re.sub(r'<style.*?</style>', '', clean_text, flags=re.DOTALL | re.IGNORECASE)
    clean_text = re.sub(r'<[^>]+>', ' ', clean_text)
    import html
    clean_text = html.unescape(clean_text)
    clean_text = re.sub(r'\s+', ' ', clean_text).strip()
    return clean_text

def parse_iso_date(raw_date_str):
    """Returns an ISO 8601 UTC timestamp string, or None if the input is
    missing or unparseable.

    2026-09-10 FIX: this used to fall back to datetime.now(timezone.utc)
    whenever the date was missing or failed every known format — silently
    stamping an article with a broken/absent date as if it were published
    "right now", which would have made it look maximally fresh and
    eligible for Breaking/Critical/High-Impact. Now it returns None, and
    callers (etl/build_news_cache.py) must treat None as "unknown date" —
    per config/pipeline_settings.yaml, an unknown date is archive-only,
    never live, never eligible for the ticker."""
    from datetime import datetime, timezone
    import email.utils
    if not raw_date_str:
        return None
    raw_date_str = str(raw_date_str).strip()
    try:
        dt = email.utils.parsedate_to_datetime(raw_date_str)
        if dt:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        pass
    formats = [
        "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d %b %Y %H:%M:%S %z",
        "%d %B %Y", "%B %d, %Y",
        # 2026-09-10: NCBI PubMed's esummary "pubdate" field (used by
        # etl/fetch_news.py's PubMed Dynamic Queries source) comes as
        # "2026 Aug 15" or, when PubMed itself only has month/year
        # precision, "2026 Aug" -- neither matched any format above, so
        # every PubMed article's date silently came back None. That was
        # more than a lost date: see _finalize_health() in fetch_news.py,
        # which crashed sorting a dates list containing 2+ Nones,
        # silently losing the ENTIRE PubMed Dynamic Queries source for
        # the whole run whenever any topic returned multiple articles.
        "%Y %b %d", "%Y %b",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(raw_date_str, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except Exception:
            continue
    return None

def is_valid_url(url):
    return isinstance(url, str) and (url.startswith("http://") or url.startswith("https://")) and len(url) > 11

def clean_summary(text, max_len=320):
    text = strip_html(text)
    if len(text) <= max_len:
        return text
    truncated = text[:max_len]
    last_period = truncated.rfind('. ')
    if last_period > 120:
        return truncated[:last_period + 1]
    last_space = truncated.rfind(' ')
    if last_space > 120:
        return truncated[:last_space] + '...'
    return truncated + '...'

def clean_article(raw_item):
    title = strip_html(raw_item.get('title', '')).strip()
    summary = clean_summary(raw_item.get('summary') or raw_item.get('description') or title)
    pub_date = parse_iso_date(raw_item.get('published_at') or raw_item.get('pubDate'))
    url = str(raw_item.get('url') or raw_item.get('link') or '').strip()
    source = str(raw_item.get('source') or 'Market Intelligence').strip()
    return {
        'title': title,
        'summary': summary,
        'published_at': pub_date,  # may be None — see parse_iso_date docstring
        'url': url,
        'has_valid_url': is_valid_url(url),
        'source': source,
        'source_id': raw_item.get('source_id', ''),
        'raw_category': raw_item.get('category', ''),
        'country': raw_item.get('country', 'Global')
    }
