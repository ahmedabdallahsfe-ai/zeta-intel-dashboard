import os
import sys
import json
import yaml
import hashlib
from datetime import datetime, timezone

from clean_news import clean_article, is_valid_url
from classify_news import classify_article
from score_news import score_article
from fetch_news import fetch_all_sources

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.path.join(ROOT_DIR, 'config')
CACHE_DIR = os.path.join(ROOT_DIR, 'cache')
LOGS_DIR = os.path.join(ROOT_DIR, 'logs')
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)


def load_yaml(filepath):
    if not os.path.exists(filepath):
        return {}
    with open(filepath, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f) or {}


def normalize_title_for_dedup(title):
    import re
    cleaned = re.sub(r'[^a-zA-Z0-9\s]', '', title.lower())
    return re.sub(r'\s+', ' ', cleaned).strip()


def log_line(log_path, text):
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(text + "\n")


def format_health_line(h):
    elapsed = h.get('elapsed_s')
    parts = [
        f"status={h.get('status')}",
        f"http={h.get('http_status')}",
        f"elapsed={elapsed if elapsed is not None else '-'}s" if elapsed is not None else "elapsed=-",
        f"articles={h.get('articles_returned')}",
        f"newest={h.get('newest_date')}",
        f"oldest={h.get('oldest_date')}",
    ]
    if h.get('error_type'):
        parts.append(f"error={h.get('error_type')}: {h.get('error_message')}")
    return f"[{h.get('timestamp')}] {h.get('name')} ({h.get('id')}) — " + " | ".join(parts)


def build_cache():
    run_started = datetime.now(timezone.utc)
    log_path = None

    print("=====================================================================")
    print("ZETA PHARMA EXTERNAL MARKET INTELLIGENCE ETL PIPELINE")
    print("2026-09-10 — P0/P1 trustworthiness fixes active")
    print("=====================================================================")

    configs = {
        'therapeutic_areas': load_yaml(os.path.join(CONFIG_DIR, 'therapeutic_areas.yaml')),
        'molecules': load_yaml(os.path.join(CONFIG_DIR, 'molecules.yaml')),
        'competitors': load_yaml(os.path.join(CONFIG_DIR, 'competitors.yaml')),
        'intelligence_types': load_yaml(os.path.join(CONFIG_DIR, 'intelligence_types.yaml')),
        'geography': load_yaml(os.path.join(CONFIG_DIR, 'geography.yaml')),
        'scoring_rules': load_yaml(os.path.join(CONFIG_DIR, 'scoring_rules.yaml')),
        'news_sources': load_yaml(os.path.join(CONFIG_DIR, 'news_sources.yaml')),
        'news_keywords': load_yaml(os.path.join(CONFIG_DIR, 'news_keywords.yaml')),
        'pipeline_settings': load_yaml(os.path.join(CONFIG_DIR, 'pipeline_settings.yaml')),
    }

    pipeline_cfg = configs['pipeline_settings']
    recency_cfg = pipeline_cfg.get('recency', {})
    live_max_age_days = recency_cfg.get('live_feed_max_age_days', 180)
    treat_missing_as_archive = recency_cfg.get('treat_missing_date_as_archive', True)

    cap_cfg = pipeline_cfg.get('source_caps', {})
    default_cap = cap_cfg.get('default_max_per_run', 20)
    cap_overrides = cap_cfg.get('overrides', {})

    safety_cfg = pipeline_cfg.get('safety_relevance', {})
    exclude_untargeted_safety = safety_cfg.get('exclude_if_no_taxonomy_match', True)

    ticker_cfg = pipeline_cfg.get('ticker_eligibility', {})
    ticker_min_relevance = ticker_cfg.get('min_relevance', 70)
    ticker_require_live = ticker_cfg.get('require_live_window', True)
    ticker_require_url = ticker_cfg.get('require_valid_url', True)
    ticker_exclude_noise = ticker_cfg.get('exclude_low_signal_academic', True)

    log_filename = pipeline_cfg.get('logging', {}).get('log_file', 'logs/news_refresh.log')
    log_path = os.path.join(ROOT_DIR, log_filename)

    # --- Source configuration summary (incl. disabled sources, for honesty) ---
    all_source_cfgs = configs['news_sources'].get('sources', [])
    source_id_to_weight = {s.get('id'): s.get('default_weight', 1.0) for s in all_source_cfgs}
    sources_total = len(all_source_cfgs)
    sources_enabled = sum(1 for s in all_source_cfgs if s.get('enabled', True))
    disabled_sources = [s for s in all_source_cfgs if not s.get('enabled', True)]

    log_line(log_path, "")
    log_line(log_path, f"===== RUN START {run_started.isoformat()} =====")
    if disabled_sources:
        for s in disabled_sources:
            log_line(log_path, f"[{run_started.isoformat()}] {s.get('name')} ({s.get('id')}) — DISABLED (not fetched) | reason={s.get('status_note','(no reason recorded)')}")

    print("Fetching intelligence feeds and PubMed publications...")
    raw_articles, health_records = fetch_all_sources(configs['news_sources'])
    print(f"Total raw items collected: {len(raw_articles)}")

    print("\nSOURCE HEALTH")
    print("-" * 70)
    for h in health_records:
        log_line(log_path, format_health_line(h))
        marker = "PASS" if h['status'] == "PASS" else h['status']
        print(f"  {marker:8s} {h.get('name','?'):45s} {h.get('articles_returned',0):4d} articles"
              + (f"  [{h.get('error_type')}: {h.get('error_message')}]" if h.get('error_type') else ""))

    sources_attempted = len(health_records)
    sources_healthy = sum(1 for h in health_records if h['status'] == 'PASS')
    sources_failed = [h for h in health_records if h['status'] == 'FAIL']
    sources_empty = [h for h in health_records if h['status'] == 'EMPTY']

    # --- Clean + dedupe (title fingerprint AND url fingerprint) ---
    seen_title_fp = set()
    seen_url_fp = set()
    cleaned_articles = []
    removed_duplicates = 0
    removed_no_title = 0

    for item in raw_articles:
        cleaned = clean_article(item)
        if not cleaned['title'] or len(cleaned['title']) < 8:
            removed_no_title += 1
            continue

        norm_title = normalize_title_for_dedup(cleaned['title'])
        title_fp = hashlib.sha256(norm_title.encode('utf-8')).hexdigest()[:16]
        url_fp = hashlib.sha256(cleaned['url'].encode('utf-8')).hexdigest()[:16] if cleaned['url'] else None

        if title_fp in seen_title_fp or (url_fp and url_fp in seen_url_fp):
            removed_duplicates += 1
            continue
        seen_title_fp.add(title_fp)
        if url_fp:
            seen_url_fp.add(url_fp)

        cleaned['_title_fp'] = title_fp
        cleaned_articles.append(cleaned)

    # --- Classify + score every surviving article ---
    now_utc = datetime.now(timezone.utc)
    processed_live = []
    processed_archive = []
    removed_by_recency = 0
    removed_untargeted_safety = 0

    for cleaned in cleaned_articles:
        classification = classify_article(cleaned, configs)

        # 2026-09-10 fix (config/pipeline_settings.yaml: safety_relevance):
        # a SAFETY-category article (currently: openFDA drug recalls) with
        # no matched Zeta molecule, company, or brand is commercially
        # irrelevant noise for this dashboard -- e.g. a recall of generic
        # Levothyroxine or Zicam nasal spray -- and is dropped entirely
        # (not live, not archived) rather than counted as "market
        # intelligence." Every other category still passes through
        # unfiltered, unchanged from before. See the config comment for
        # the production incident that surfaced this.
        if (
            exclude_untargeted_safety
            and cleaned.get('raw_category') == 'SAFETY'
            and not classification['molecules']
            and not classification['companies']
            and not classification['brands']
        ):
            removed_untargeted_safety += 1
            continue

        pub_date_str = cleaned['published_at']
        age_days = None
        if pub_date_str:
            try:
                pub_dt = datetime.fromisoformat(pub_date_str)
                age_days = (now_utc - pub_dt).days
            except Exception:
                age_days = None

        source_weight = source_id_to_weight.get(cleaned.get('source_id'), 1.0)
        scoring = score_article(cleaned, classification, configs, age_days=age_days, source_weight=source_weight)

        is_live = (age_days is not None) and (age_days <= live_max_age_days)
        if pub_date_str is None and treat_missing_as_archive:
            is_live = False

        # Academic-noise check: a PubMed item that matched no molecule,
        # company or brand and fell back to "General Strategic
        # Intelligence" is generic academic content, not commercial
        # intelligence — even if a stray keyword (e.g. "Egypt" in an
        # author affiliation) matched a geography.
        is_academic_noise = (
            '(PubMed)' in cleaned['source']
            and not classification['molecules']
            and not classification['companies']
            and not classification['brands']
            and classification['primary_therapeutic_area'] == 'General Strategic Intelligence'
        )

        eligible_for_ticker = (
            (not ticker_require_live or is_live)
            and scoring['relevance'] >= ticker_min_relevance
            and (not ticker_require_url or cleaned['has_valid_url'])
            and (not ticker_exclude_noise or not is_academic_noise)
        )
        breaking = eligible_for_ticker and scoring['impact'] in ('CRITICAL', 'HIGH')

        article_id = f"zeta_intel_{(pub_date_str or '00000000')[:10].replace('-', '')}_{cleaned['_title_fp'][:8]}"

        article_record = {
            'id': article_id,
            'title': cleaned['title'],
            'source': cleaned['source'],
            'source_id': cleaned.get('source_id', ''),
            'published_at': pub_date_str,
            'age_days': age_days,
            'url': cleaned['url'],
            'summary': cleaned['summary'],
            'primary_therapeutic_area': classification['primary_therapeutic_area'],
            'secondary_therapeutic_areas': classification['secondary_therapeutic_areas'],
            'business_units': classification['business_units'],
            'molecules': classification['molecules'],
            'mechanisms': classification['mechanisms'],
            'companies': classification['companies'],
            'brands': classification['brands'],
            'geography': classification['geography'],
            'intelligence_types': classification['intelligence_types'],
            'tags': classification['tags'],
            'importance': scoring['importance'],
            'relevance': scoring['relevance'],
            'impact': scoring['impact'],
            'breaking': breaking,
            'is_live': is_live,
            'is_academic_noise': is_academic_noise,
            'why_it_matters': scoring['why_it_matters'],
        }

        if is_live:
            processed_live.append(article_record)
        else:
            removed_by_recency += 1
            processed_archive.append(article_record)

    # --- Per-source cap on the LIVE pool only (archive keeps everything) ---
    # Prioritizes relevance + recency + source quality (all folded into
    # `relevance` by score_article) — NOT raw volume. This is the fix for
    # PharmaBoardroom supplying ~70% of the feed by volume alone.
    by_source = {}
    for a in processed_live:
        by_source.setdefault(a['source_id'] or a['source'], []).append(a)

    capped_live = []
    removed_by_source_cap = 0
    for source_key, arts in by_source.items():
        cap = cap_overrides.get(source_key, default_cap)
        arts.sort(key=lambda x: (x['relevance'], x['published_at'] or ''), reverse=True)
        kept = arts[:cap]
        removed_by_source_cap += max(0, len(arts) - cap)
        capped_live.extend(kept)

    capped_live.sort(key=lambda x: (x['relevance'], x['published_at'] or ''), reverse=True)
    final_live = capped_live[:200]

    processed_archive.sort(key=lambda x: (x['published_at'] or ''), reverse=True)
    final_archive = processed_archive[:500]

    # --- Distribution metadata (computed from the FINAL live list only) ---
    bu_counts = {'DIAB': 0, 'GIT': 0, 'Cluster': 0, 'CHC': 0, 'Corporate': 0}
    impact_counts = {'CRITICAL': 0, 'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}
    geo_counts = {'Egypt': 0, 'MENA': 0, 'Global': 0}
    ta_counts = {}
    type_counts = {}

    for a in final_live:
        ta = a['primary_therapeutic_area']
        ta_counts[ta] = ta_counts.get(ta, 0) + 1
        for bu in a['business_units']:
            if bu in bu_counts:
                bu_counts[bu] += 1
        impact_counts[a['impact']] = impact_counts.get(a['impact'], 0) + 1
        geo_counts[a['geography']] = geo_counts.get(a['geography'], 0) + 1
        for itype in a['intelligence_types']:
            type_counts[itype] = type_counts.get(itype, 0) + 1

    competitor_intel_count = sum(1 for a in final_live if a['companies'])
    obesity_incretin_count = sum(
        1 for a in final_live
        if a['primary_therapeutic_area'] == 'Obesity & Incretin Therapies'
        or 'Obesity & Incretin Therapies' in a['secondary_therapeutic_areas']
    )
    breaking_count = sum(1 for a in final_live if a['breaking'])
    dates_present = [a['published_at'] for a in final_live if a['published_at']]

    sync_label = now_utc.strftime("%Y-%m-%d %H:%M UTC")

    source_health_summary = []
    for h in health_records:
        source_health_summary.append({
            'id': h.get('id'),
            'name': h.get('name'),
            'status': h.get('status'),
            'articlesReturned': h.get('articles_returned'),
            'newestDate': h.get('newest_date'),
            'oldestDate': h.get('oldest_date'),
            'errorType': h.get('error_type'),
        })
    for s in disabled_sources:
        source_health_summary.append({
            'id': s.get('id'),
            'name': s.get('name'),
            'status': 'DISABLED',
            'articlesReturned': 0,
            'newestDate': None,
            'oldestDate': None,
            'errorType': s.get('status_note'),
        })

    payload = {
        'meta': {
            'generatedAt': now_utc.isoformat(),
            'syncLabel': sync_label,
            'totalArticles': len(final_live),
            'criticalCount': impact_counts.get('CRITICAL', 0),
            'highImpactCount': impact_counts.get('HIGH', 0),
            'breakingCount': breaking_count,
            'buDistribution': bu_counts,
            'impactDistribution': impact_counts,
            'geoDistribution': geo_counts,
            'taDistribution': ta_counts,
            'typeDistribution': type_counts,
            'competitorIntelCount': competitor_intel_count,
            'obesityIncretinCount': obesity_incretin_count,
            'liveFeedMaxAgeDays': live_max_age_days,
            'dateRangeOldest': min(dates_present) if dates_present else None,
            'dateRangeNewest': max(dates_present) if dates_present else None,
            'sourcesTotal': sources_total,
            'sourcesEnabled': sources_enabled,
            'sourcesHealthy': sources_healthy,
            'sourceHealth': source_health_summary,
            'removedByRecency': removed_by_recency,
            'removedByDuplicate': removed_duplicates,
            'removedBySourceCap': removed_by_source_cap,
            'removedUntargetedSafety': removed_untargeted_safety,
            'archiveCount': len(final_archive),
        },
        'articles': final_live
    }

    archive_payload = {
        'meta': {
            'generatedAt': now_utc.isoformat(),
            'syncLabel': sync_label,
            'note': 'Articles older than liveFeedMaxAgeDays, or with an unparseable publication date. Not shown in the live feed by default; preserved here rather than deleted.',
            'totalArticles': len(final_archive),
        },
        'articles': final_archive
    }

    js_output_path = os.path.join(CACHE_DIR, 'news_latest.data.js')
    with open(js_output_path, 'w', encoding='utf-8') as f:
        f.write(f"window.ZETA_NEWS_FEED = {json.dumps(payload, ensure_ascii=False, indent=2)};\n")

    json_output_path = os.path.join(CACHE_DIR, 'news_latest.json')
    with open(json_output_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    archive_js_path = os.path.join(CACHE_DIR, 'news_archive.data.js')
    with open(archive_js_path, 'w', encoding='utf-8') as f:
        f.write(f"window.ZETA_NEWS_ARCHIVE = {json.dumps(archive_payload, ensure_ascii=False, indent=2)};\n")

    archive_json_path = os.path.join(CACHE_DIR, 'news_archive.json')
    with open(archive_json_path, 'w', encoding='utf-8') as f:
        json.dump(archive_payload, f, ensure_ascii=False, indent=2)

    run_finished = datetime.now(timezone.utc)
    log_line(log_path, f"[{run_finished.isoformat()}] SUMMARY — raw={len(raw_articles)} cleaned={len(cleaned_articles)} "
                        f"dup_removed={removed_duplicates} recency_removed={removed_by_recency} "
                        f"source_cap_removed={removed_by_source_cap} untargeted_safety_removed={removed_untargeted_safety} "
                        f"live_final={len(final_live)} "
                        f"archive_final={len(final_archive)} breaking={breaking_count} "
                        f"sources_healthy={sources_healthy}/{sources_attempted} (enabled={sources_enabled}/{sources_total})")
    log_line(log_path, f"===== RUN END {run_finished.isoformat()} =====")

    print("\n" + "=" * 70)
    print(f"Generated {js_output_path} ({os.path.getsize(js_output_path):,} bytes).")
    print(f"Generated {archive_js_path} ({os.path.getsize(archive_js_path):,} bytes).")
    print(f"\nSources healthy: {sources_healthy}/{sources_attempted} attempted ({sources_enabled}/{sources_total} enabled, {len(disabled_sources)} disabled)")
    if sources_failed:
        print("Sources FAILED this run:")
        for h in sources_failed:
            print(f"   - {h['name']}: {h.get('error_type')} — {h.get('error_message')}")
    if sources_empty:
        print("Sources returned ZERO articles (not an error, but flagged):")
        for h in sources_empty:
            print(f"   - {h['name']}")
    print(f"\nRaw items collected:        {len(raw_articles)}")
    print(f"Removed (no/short title):   {removed_no_title}")
    print(f"Removed (duplicates):       {removed_duplicates}")
    print(f"Removed (recency filter):   {removed_by_recency}  (older than {live_max_age_days}d or unparseable date -> archive)")
    print(f"Removed (per-source cap):   {removed_by_source_cap}")
    print(f"Removed (untargeted SAFETY, no Zeta molecule/company/brand match): {removed_untargeted_safety}")
    print(f"Final LIVE articles:        {len(final_live)}")
    print(f"Final ARCHIVE articles:     {len(final_archive)}")
    print(f"   - Critical Alerts:       {payload['meta']['criticalCount']}")
    print(f"   - High-Impact Signals:   {payload['meta']['highImpactCount']}")
    print(f"   - Breaking (ticker-eligible): {breaking_count}")
    print(f"   - Egypt Intelligence:    {payload['meta']['geoDistribution'].get('Egypt', 0)}")
    print(f"   - Competitor Intel:      {competitor_intel_count}")
    print(f"   - Obesity & Incretin:    {obesity_incretin_count}")
    print(f"   - Live date range:       {payload['meta']['dateRangeOldest']}  ->  {payload['meta']['dateRangeNewest']}")
    print(f"   - BU Distribution:       {payload['meta']['buDistribution']}")
    print("ETL complete successfully. (One or more sources failing above did NOT stop this run.)")


if __name__ == '__main__':
    build_cache()
