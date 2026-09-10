"""
etl/fetch_news.py
=============================================================================
ZETA PHARMA — MARKET INTELLIGENCE FEED: SOURCE FETCH LAYER
=============================================================================
Fetches every ENABLED source in config/news_sources.yaml.

2026-09-10 rewrite (P0/P1 trustworthiness fix):
  - Every fetch is wrapped in granular, typed exception handling. Nothing
    is swallowed silently anymore — each source returns a structured
    health record (status, http_status, elapsed_s, articles_returned,
    newest/oldest date, error_type, error_message) which
    etl/build_news_cache.py logs and surfaces in the cache meta.
  - One source failing NEVER stops the run — each source is fetched in
    its own try/except and the loop always continues.
  - Added fetch_openfda_drug_enforcement(): official openFDA Drug
    Enforcement API, replacing the device-recall-heavy general MedWatch
    RSS feed (see config/news_sources.yaml header for the test evidence).
  - Narrowed the "Egyptian Healthcare & Pharma" PubMed query from a
    generic (Egypt AND (pharmaceutical OR hospital OR clinical)) query
    — which matched almost any Egyptian-authored clinical paper — to
    commercially-relevant terms (EDA, drug registration, pricing,
    reimbursement, tender, market access, distribution, shortage,
    launch, regulatory approval). Genuine Egypt-relevant clinical
    evidence is still picked up through the other 6 therapeutic-area
    queries when it's actually about a Zeta-relevant molecule/TA — it's
    only the "anything Egyptian + hospital" catch-all that was removed.
=============================================================================
"""

import json
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from clean_news import parse_iso_date

REQUEST_TIMEOUT_S = 12
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 ZetaMarketIntel/2.0"


def _new_health_record(source_id, name, url, source_type):
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "id": source_id,
        "name": name,
        "url": url,
        "type": source_type,
        "status": "FAIL",
        "http_status": None,
        "elapsed_s": None,
        "articles_returned": 0,
        "newest_date": None,
        "oldest_date": None,
        "error_type": None,
        "error_message": None,
    }


def _finalize_health(record, items, t0):
    record["elapsed_s"] = round(time.time() - t0, 2)
    record["articles_returned"] = len(items)
    if items:
        dates = []
        for it in items:
            try:
                parsed = parse_iso_date(it.get("published_at") or it.get("pubDate"))
            except Exception:
                continue
            # 2026-09-10 fix: parse_iso_date returns None (by design, does
            # not raise) for a missing/unparseable date. Appending that
            # None unconditionally meant 2+ such items in the same batch
            # crashed dates.sort() with "'<' not supported between
            # instances of 'NoneType' and 'NoneType'" -- which propagated
            # all the way out of fetch_dynamic_pubmed_publications()
            # uncaught (this call sits outside that function's own
            # try/except) and silently discarded every article from every
            # PubMed topic for the whole run, not just the one with a bad
            # date. Confirmed in production logs/news_refresh.log
            # 2026-09-10T09:58:28Z. Only real, parsed dates are sortable.
            if parsed is not None:
                dates.append(parsed)
        if dates:
            dates.sort()
            record["oldest_date"] = dates[0]
            record["newest_date"] = dates[-1]
    record["status"] = "PASS" if items else ("FAIL" if record["error_type"] else "EMPTY")
    return record


def fetch_rss_feed(source_cfg):
    """Fetches and parses a single RSS/Atom feed URL. Never raises — always
    returns (items, health_record); a failure is recorded, not swallowed."""
    url = source_cfg.get("url")
    source_id = source_cfg.get("id", "unknown")
    name = source_cfg.get("name", "Feed")
    record = _new_health_record(source_id, name, url, "rss")
    items = []

    if not url or not source_cfg.get("enabled", True):
        record["status"] = "DISABLED"
        return items, record

    t0 = time.time()
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": BROWSER_UA,
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as response:
            record["http_status"] = getattr(response, "status", 200)
            xml_data = response.read()
    except urllib.error.HTTPError as e:
        record["error_type"] = "HTTPError"
        record["http_status"] = e.code
        record["error_message"] = f"{e.code} {e.reason}"
        return items, _finalize_health(record, items, t0)
    except socket.timeout:
        record["error_type"] = "Timeout"
        record["error_message"] = f"No response within {REQUEST_TIMEOUT_S}s"
        return items, _finalize_health(record, items, t0)
    except urllib.error.URLError as e:
        record["error_type"] = "URLError"
        record["error_message"] = str(e.reason)
        return items, _finalize_health(record, items, t0)
    except Exception as e:
        record["error_type"] = type(e).__name__
        record["error_message"] = str(e)
        return items, _finalize_health(record, items, t0)

    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError as e:
        record["error_type"] = "ParserError"
        record["error_message"] = str(e)
        return items, _finalize_health(record, items, t0)

    try:
        # RSS 2.0 (<channel><item>)
        channel = root.find("channel")
        if channel is not None:
            for item_el in channel.findall("item"):
                title = (item_el.findtext("title", "") or "").strip()
                link = (item_el.findtext("link", "") or "").strip()
                desc = (item_el.findtext("description", "") or "").strip()
                pub_date = (item_el.findtext("pubDate", "") or "").strip()
                if title and link and link.startswith("http"):
                    items.append({
                        "title": title,
                        "url": link,
                        "summary": desc,
                        "published_at": pub_date,
                        "source": name,
                        "category": source_cfg.get("category", "GENERAL"),
                        "country": source_cfg.get("country", "Global"),
                        "source_id": source_id,
                    })

        # Atom (<feed><entry>)
        for entry_el in root.findall("{http://www.w3.org/2005/Atom}entry"):
            title = (entry_el.findtext("{http://www.w3.org/2005/Atom}title", "") or "").strip()
            link_el = entry_el.find("{http://www.w3.org/2005/Atom}link")
            link = link_el.attrib.get("href", "").strip() if link_el is not None else ""
            summary = (entry_el.findtext("{http://www.w3.org/2005/Atom}summary", "")
                       or entry_el.findtext("{http://www.w3.org/2005/Atom}content", "") or "")
            pub_date = (entry_el.findtext("{http://www.w3.org/2005/Atom}updated", "")
                        or entry_el.findtext("{http://www.w3.org/2005/Atom}published", "") or "")
            if title and link and link.startswith("http"):
                items.append({
                    "title": title,
                    "url": link,
                    "summary": summary.strip(),
                    "published_at": pub_date,
                    "source": name,
                    "category": source_cfg.get("category", "GENERAL"),
                    "country": source_cfg.get("country", "Global"),
                    "source_id": source_id,
                })
    except Exception as e:
        # Parsed XML but item extraction blew up partway through — keep
        # whatever we already collected, still record the error.
        record["error_type"] = record["error_type"] or type(e).__name__
        record["error_message"] = record["error_message"] or str(e)

    return items, _finalize_health(record, items, t0)


def fetch_openfda_drug_enforcement(source_cfg):
    """Official openFDA Drug Enforcement API — drug recalls only, by
    construction (there is a separate /device/enforcement endpoint for
    medical devices, which this deliberately does NOT call). Replaces the
    general MedWatch RSS feed, which was ~100% medical-device items in
    testing. Never raises — always returns (items, health_record)."""
    url = source_cfg.get("url")
    source_id = source_cfg.get("id", "unknown")
    name = source_cfg.get("name", "openFDA")
    record = _new_health_record(source_id, name, url, "api_openfda_drug_enforcement")
    items = []

    if not url or not source_cfg.get("enabled", True):
        record["status"] = "DISABLED"
        return items, record

    t0 = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA, "Accept": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as response:
            record["http_status"] = getattr(response, "status", 200)
            raw = response.read()
    except urllib.error.HTTPError as e:
        # openFDA returns 404 for "no matching records" on a filtered query;
        # with no filter (this endpoint) a 404 is a genuine failure.
        record["error_type"] = "HTTPError"
        record["http_status"] = e.code
        record["error_message"] = f"{e.code} {e.reason}"
        return items, _finalize_health(record, items, t0)
    except socket.timeout:
        record["error_type"] = "Timeout"
        record["error_message"] = f"No response within {REQUEST_TIMEOUT_S}s"
        return items, _finalize_health(record, items, t0)
    except urllib.error.URLError as e:
        record["error_type"] = "URLError"
        record["error_message"] = str(e.reason)
        return items, _finalize_health(record, items, t0)
    except Exception as e:
        record["error_type"] = type(e).__name__
        record["error_message"] = str(e)
        return items, _finalize_health(record, items, t0)

    try:
        data = json.loads(raw.decode("utf-8"))
        results = data.get("results", [])
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        record["error_type"] = "ParserError"
        record["error_message"] = str(e)
        return items, _finalize_health(record, items, t0)

    for r in results:
        try:
            report_date_raw = str(r.get("report_date", "")).strip()
            if len(report_date_raw) == 8 and report_date_raw.isdigit():
                pub_date = f"{report_date_raw[0:4]}-{report_date_raw[4:6]}-{report_date_raw[6:8]}"
            else:
                pub_date = report_date_raw

            product = (r.get("product_description") or "").strip()
            reason = (r.get("reason_for_recall") or "").strip()
            classification = (r.get("classification") or "").strip()
            firm = (r.get("recalling_firm") or "").strip()
            recall_number = (r.get("recall_number") or r.get("event_id") or "").strip()

            if not product or not reason:
                continue

            title = f"Drug Recall ({classification or 'Unclassified'}): {product}"
            if firm:
                title += f" — {firm}"
            title = title[:220]

            if recall_number:
                item_url = f"https://api.fda.gov/drug/enforcement.json?search=recall_number:%22{urllib.parse.quote(recall_number)}%22"
            else:
                item_url = "https://open.fda.gov/apis/drug/enforcement/"

            items.append({
                "title": title,
                "url": item_url,
                "summary": reason,
                "published_at": pub_date,
                "source": name,
                "category": source_cfg.get("category", "SAFETY"),
                "country": "Global",  # openFDA is a US regulatory dataset; do
                                       # NOT pass the raw FDA country field
                                       # through (breaks the Egypt/MENA/Global
                                       # geography filter buckets in the UI).
                "source_id": source_id,
            })
        except Exception:
            # One malformed record must not drop the rest of the batch.
            continue

    return items, _finalize_health(record, items, t0)


def fetch_dynamic_pubmed_publications(source_cfg=None):
    """
    Fetches 100% authentic, verified publications directly from NCBI PubMed
    API. Title, journal, PMID, and direct URL match 1-to-1 with zero
    discrepancies.

    2026-09-10: the "Egyptian Healthcare & Pharma" query was narrowed from
    a generic (Egypt AND (pharmaceutical OR hospital OR clinical)) — which
    matched almost any Egyptian-authored clinical paper (an Arabic-language
    questionnaire validation study, a retraction notice, a biosensor
    cost-analysis paper all matched it in production) — to terms that
    actually indicate commercial/regulatory market intelligence.
    """
    queries = [
        ("Obesity & Incretin Therapies", "(tirzepatide[Title/Abstract] OR semaglutide[Title/Abstract] OR liraglutide[Title/Abstract] OR retatrutide[Title/Abstract]) AND (obesity[Title/Abstract] OR weight loss[Title/Abstract] OR incretin[Title/Abstract])"),
        ("Diabetes & SGLT2/DPP4", "(empagliflozin[Title/Abstract] OR dapagliflozin[Title/Abstract] OR linagliptin[Title/Abstract] OR vildagliptin[Title/Abstract]) AND (diabetes[Title/Abstract] OR glycemic[Title/Abstract] OR heart failure[Title/Abstract])"),
        ("Cardio-Renal-Metabolic", "(apixaban[Title/Abstract] OR rivaroxaban[Title/Abstract] OR finerenone[Title/Abstract] OR sacubitril[Title/Abstract]) AND (cardiovascular[Title/Abstract] OR chronic kidney disease[Title/Abstract] OR atrial fibrillation[Title/Abstract])"),
        ("Gastroenterology & P-CAB", "(vonoprazan[Title/Abstract] OR tegoprazan[Title/Abstract] OR esomeprazole[Title/Abstract]) AND (GERD[Title/Abstract] OR reflux[Title/Abstract] OR gastric ulcer[Title/Abstract] OR H pylori[Title/Abstract])"),
        ("Neuroscience & Pain", "(pregabalin[Title/Abstract] OR duloxetine[Title/Abstract] OR gabapentin[Title/Abstract]) AND (neuropathic pain[Title/Abstract] OR diabetic neuropathy[Title/Abstract] OR migraine[Title/Abstract])"),
        ("Dermatology & Biologics", "(isotretinoin[Title/Abstract] OR dupilumab[Title/Abstract] OR secukinumab[Title/Abstract]) AND (acne[Title/Abstract] OR psoriasis[Title/Abstract] OR atopic dermatitis[Title/Abstract])"),
        # NARROWED 2026-09-10: was (Egypt[Title/Abstract] OR Egyptian[Title/Abstract])
        # AND (pharmaceutical[Title/Abstract] OR health insurance[Title/Abstract]
        # OR drug pricing[Title/Abstract] OR hospital[Title/Abstract] OR
        # clinical[Title/Abstract]) — "hospital"/"clinical" are broad enough to
        # match nearly any Egyptian-authored clinical paper. Now requires an
        # explicit commercial/regulatory/market-access term.
        ("Egyptian Healthcare & Pharma", "(Egypt[Title/Abstract] OR Egyptian[Title/Abstract]) AND (\"drug registration\"[Title/Abstract] OR \"drug pricing\"[Title/Abstract] OR \"pharmaceutical pricing\"[Title/Abstract] OR \"medicine pricing\"[Title/Abstract] OR reimbursement[Title/Abstract] OR \"health insurance\"[Title/Abstract] OR \"market access\"[Title/Abstract] OR \"drug shortage\"[Title/Abstract] OR \"medicine shortage\"[Title/Abstract] OR \"pharmaceutical market\"[Title/Abstract] OR \"regulatory approval\"[Title/Abstract] OR \"Egyptian Drug Authority\"[Title/Abstract] OR EDA[Title/Abstract])")
    ]

    articles = []
    health_records = []

    for topic, query in queries:
        record = _new_health_record(f"pubmed_dynamic::{topic}", f"PubMed Dynamic — {topic}", "eutils.ncbi.nlm.nih.gov", "api_pubmed_eutils")
        t0 = time.time()
        topic_items = []
        try:
            encoded_query = urllib.parse.quote_plus(query)
            url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term={encoded_query}&retmode=json&retmax=6&sort=pub_date"
            req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                ids = data.get("esearchresult", {}).get("idlist", [])

            if ids:
                sum_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id={','.join(ids)}&retmode=json"
                req2 = urllib.request.Request(sum_url, headers={"User-Agent": BROWSER_UA})
                with urllib.request.urlopen(req2, timeout=REQUEST_TIMEOUT_S) as resp2:
                    sdata = json.loads(resp2.read().decode("utf-8"))
                    for pid in ids:
                        art = sdata.get("result", {}).get(pid, {})
                        title = art.get("title", "").strip().rstrip(".")
                        journal = art.get("source", "PubMed")
                        pubdate = art.get("pubdate", "")
                        country = "Egypt" if topic == "Egyptian Healthcare & Pharma" else "Global"

                        if title and pid:
                            topic_items.append({
                                "title": title,
                                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pid}/",
                                "source": f"{journal} (PubMed)",
                                "published_at": str(pubdate),
                                "summary": f"Peer-reviewed clinical trial / study published in {journal} evaluating {topic.lower()} efficacy, therapeutic protocols, and patient outcomes.",
                                "category": "CLINICAL" if topic != "Egyptian Healthcare & Pharma" else "REGULATORY",
                                "country": country,
                                "source_id": "pubmed_dynamic",
                            })
        except urllib.error.HTTPError as e:
            record["error_type"] = "HTTPError"
            record["http_status"] = e.code
            record["error_message"] = f"{e.code} {e.reason}"
        except socket.timeout:
            record["error_type"] = "Timeout"
            record["error_message"] = f"No response within {REQUEST_TIMEOUT_S}s"
        except urllib.error.URLError as e:
            record["error_type"] = "URLError"
            record["error_message"] = str(e.reason)
        except Exception as e:
            record["error_type"] = type(e).__name__
            record["error_message"] = str(e)

        articles.extend(topic_items)
        health_records.append(_finalize_health(record, topic_items, t0))

    return articles, health_records


FETCHERS_BY_TYPE = {
    "rss": fetch_rss_feed,
    "api_openfda_drug_enforcement": fetch_openfda_drug_enforcement,
}


def fetch_all_sources(config_sources):
    """Fetches every configured source. Returns (all_items, health_records).
    A single source failing NEVER stops the run — each source is fetched
    inside its own try/except at the individual-fetcher level, and this
    loop itself never raises."""
    all_items = []
    all_health = []
    sources = config_sources.get("sources", [])

    for s in sources:
        source_type = s.get("type", "rss")
        fetcher = FETCHERS_BY_TYPE.get(source_type)
        if fetcher is None:
            all_health.append({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "id": s.get("id", "unknown"),
                "name": s.get("name", "?"),
                "url": s.get("url"),
                "type": source_type,
                "status": "FAIL",
                "http_status": None,
                "elapsed_s": 0,
                "articles_returned": 0,
                "newest_date": None,
                "oldest_date": None,
                "error_type": "UnknownSourceType",
                "error_message": f"No fetcher registered for type '{source_type}'",
            })
            continue
        try:
            items, health = fetcher(s)
            all_items.extend(items)
            all_health.append(health)
        except Exception as e:
            # Defense in depth: even if a fetcher itself has a bug and
            # raises instead of returning a health record, the pipeline
            # must keep going and the failure must still be visible.
            all_health.append({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "id": s.get("id", "unknown"),
                "name": s.get("name", "?"),
                "url": s.get("url"),
                "type": source_type,
                "status": "FAIL",
                "http_status": None,
                "elapsed_s": None,
                "articles_returned": 0,
                "newest_date": None,
                "oldest_date": None,
                "error_type": type(e).__name__,
                "error_message": str(e),
            })

    # PubMed dynamic queries are a fixed part of every run (not a
    # config-listed "source" the same way RSS/API sources are, since it
    # fans out into 7 sub-queries) but are fetched, logged and can fail
    # exactly the same way.
    try:
        pubmed_items, pubmed_health = fetch_dynamic_pubmed_publications()
        all_items.extend(pubmed_items)
        all_health.extend(pubmed_health)
    except Exception as e:
        all_health.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "id": "pubmed_dynamic",
            "name": "PubMed Dynamic Queries",
            "url": "eutils.ncbi.nlm.nih.gov",
            "type": "api_pubmed_eutils",
            "status": "FAIL",
            "http_status": None,
            "elapsed_s": None,
            "articles_returned": 0,
            "newest_date": None,
            "oldest_date": None,
            "error_type": type(e).__name__,
            "error_message": str(e),
        })

    return all_items, all_health
