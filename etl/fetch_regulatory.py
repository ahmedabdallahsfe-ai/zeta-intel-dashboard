"""
etl/fetch_regulatory.py
=============================================================================
ZETA PHARMA — GLOBAL & EGYPT NEW DRUG REGISTRATION INTELLIGENCE
Source fetch layer (spec sections A, I)
=============================================================================
Two Level-1 (official regulatory authority) sources, verified reachable
and structured before this was written (see the QA report / commit
message for the verification detail):

  fetch_fda_novel_approvals() — scrapes the FDA's own "Novel Drug
  Approvals for <year>" page. This is FDA's own curated list of
  genuinely novel drugs (NMEs/new biologics), not the full
  ANDA/NDA/BLA history — deliberately chosen over api.fda.gov's
  drug/drugsfda.json endpoint, which is dominated by generic-drug
  supplemental filings and has no "is this a novel approval" flag.

  fetch_ema_medicines() — fetches EMA's official bulk JSON medicines
  dataset (42 fields/record, updated twice daily). Regulatory stage is
  derived from which DATE FIELDS are populated on each record (rolling
  review start / evaluation start / opinion adopted / authorisation /
  refusal / withdrawal), not from a guessed enum of `medicine_status`
  string values — EMA's own status vocabulary is undocumented here in
  full, and inferring from raw evidence dates is both more robust and
  more defensible under the "every status needs evidence" rule (spec
  section J) than pattern-matching a string we can't fully enumerate.

Every fetcher returns (items, health_record) and NEVER raises — a single
source failing must never stop the run, exactly as etl/fetch_news.py.
EDA is NOT fetched here at all (see config/regulatory_pipeline_settings.yaml
and cache/egypt_registration.data.js headers for why).
=============================================================================
"""

import json
import re
import socket
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

REQUEST_TIMEOUT_S = 20
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 ZetaRegulatoryIntel/1.0"


def _new_health_record(source_id, name, url):
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "id": source_id,
        "name": name,
        "url": url,
        "status": "FAIL",
        "http_status": None,
        "elapsed_s": None,
        "records_returned": 0,
        "error_type": None,
        "error_message": None,
    }


def _finalize(record, items, t0):
    record["elapsed_s"] = round(time.time() - t0, 2)
    record["records_returned"] = len(items)
    record["status"] = "PASS" if items else ("FAIL" if record["error_type"] else "EMPTY")
    return record


def _http_get(url, accept="text/html"):
    """Shared GET with the same granular exception handling used
    throughout this project's ETL — returns (raw_bytes_or_None,
    http_status_or_None, error_type_or_None, error_message_or_None)."""
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA, "Accept": accept})
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            return resp.read(), getattr(resp, "status", 200), None, None
    except urllib.error.HTTPError as e:
        return None, e.code, "HTTPError", f"{e.code} {e.reason}"
    except socket.timeout:
        return None, None, "Timeout", f"No response within {REQUEST_TIMEOUT_S}s"
    except urllib.error.URLError as e:
        return None, None, "URLError", str(e.reason)
    except Exception as e:
        return None, None, type(e).__name__, str(e)


def _normalize_date(d_str):
    """Parses varied regulatory date formats (DD/MM/YYYY, M/D/YYYY, YYYY-MM-DD)
    into standard ISO date (YYYY-MM-DD) and integer year. Never guesses."""
    if not d_str:
        return None, None
    d_str = str(d_str).strip()
    # Match DD/MM/YYYY or M/D/YYYY
    m = re.search(r'\b(\d{1,2})/(\d{1,2})/(\d{4})\b', d_str)
    if m:
        p1, p2, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if p1 > 12:  # DD/MM/YYYY
            day, month = p1, p2
        elif p2 > 12:  # MM/DD/YYYY
            month, day = p1, p2
        else:
            if ':' in d_str:  # EMA timestamp format (DD/MM/YYYY HH:MM:SS)
                day, month = p1, p2
            else:  # FDA table format (M/D/YYYY)
                month, day = p1, p2
        try:
            return f"{year:04d}-{month:02d}-{day:02d}", year
        except Exception:
            return None, None
    m = re.search(r'\b(\d{4})-(\d{1,2})-(\d{1,2})\b', d_str)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return f"{year:04d}-{month:02d}-{day:02d}", year
        except Exception:
            return None, None
    return None, None


# ---------------------------------------------------------------------
# FDA Novel Drug Approvals
# ---------------------------------------------------------------------

def _parse_fda_novel_approvals_table(html_text):
    """Extracts novel drug approval rows from FDA's annual table."""
    items = []
    row_pattern = re.compile(r'<tr\b[^>]*>(.*?)</tr>', re.DOTALL | re.IGNORECASE)
    cell_pattern = re.compile(r'<td\b[^>]*>(.*?)</td>', re.DOTALL | re.IGNORECASE)
    link_pattern = re.compile(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL | re.IGNORECASE)
    tag_strip = re.compile(r'<[^>]+>')

    for row_html in row_pattern.findall(html_text):
        cells = cell_pattern.findall(row_html)
        if len(cells) < 3:
            continue
        
        # Check if first cell has a link or plain text drug name
        drug_name = ""
        href = ""
        link_match = link_pattern.search(cells[0])
        if link_match:
            href = link_match.group(1)
            drug_name = tag_strip.sub('', link_match.group(2)).strip()
        else:
            # Check cell 1 (in some layouts cell 0 is row number)
            if len(cells) >= 4:
                link_match2 = link_pattern.search(cells[1])
                if link_match2:
                    href = link_match2.group(1)
                    drug_name = tag_strip.sub('', link_match2.group(2)).strip()
            if not drug_name and len(cells) >= 2:
                drug_name = tag_strip.sub('', cells[1] if len(cells) >= 4 else cells[0]).strip()

        if not drug_name or len(drug_name) < 2 or drug_name.isdigit():
            continue

        active_ingredient = ""
        approval_date_iso = None
        event_year = None
        use_text = ""

        # Find cells for active ingredient, date, and indication
        plain_cells = [tag_strip.sub('', c).strip() for c in cells]
        
        # Determine active ingredient (usually next non-empty string after drug_name)
        for idx, text in enumerate(plain_cells):
            iso, yr = _normalize_date(text)
            if iso and approval_date_iso is None:
                approval_date_iso = iso
                event_year = yr
                # active ingredient is usually preceding cell
                if idx > 0 and not active_ingredient:
                    cand = plain_cells[idx - 1]
                    if cand != drug_name and not cand.isdigit():
                        active_ingredient = cand
                # indication is usually subsequent cell
                if idx + 1 < len(plain_cells) and not use_text:
                    use_text = plain_cells[idx + 1]

        if not approval_date_iso or event_year != 2026:
            continue  # Strict 2026 filter

        detail_url = href if href.startswith("http") else (f"https://www.fda.gov{href}" if href else "https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-2026")
        
        items.append({
            "drug_name": drug_name,
            "active_ingredient": active_ingredient,
            "approval_date": approval_date_iso,
            "event_year": event_year,
            "stage_date": approval_date_iso,
            "stage": "APPROVED",
            "indication_text": use_text,
            "source_name": "FDA Novel Drug Approvals",
            "source_url": detail_url,
            "evidence_level": 1,
        })
    return items


def fetch_fda_novel_approvals(source_cfg, years=[2026]):
    """Fetches FDA's Novel Drug Approvals page for 2026. Returns (items, health_record)."""
    name = source_cfg.get("name", "FDA Novel Drug Approvals")
    url_template = source_cfg.get("url_template", "https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-{year}")
    record = _new_health_record("fda_novel_approvals", name, url_template.format(year=2026))
    items = []

    if not source_cfg.get("enabled", True):
        record["status"] = "DISABLED"
        return items, record

    t0 = time.time()
    errors = []
    # Strict 2026 focus
    for year in [2026]:
        url = url_template.format(year=year)
        raw, http_status, err_type, err_msg = _http_get(url)
        record["http_status"] = http_status
        if raw is None:
            errors.append(f"{year}: {err_type} — {err_msg}")
            continue
        try:
            html_text = raw.decode("utf-8", errors="replace")
            year_items = _parse_fda_novel_approvals_table(html_text)
            items.extend(year_items)
        except Exception as e:
            errors.append(f"{year}: ParseError — {e}")

    if not items and errors:
        record["error_type"] = "FetchError"
        record["error_message"] = "; ".join(errors)
    return items, _finalize(record, items, t0)


# ---------------------------------------------------------------------
# EMA Medicines Dataset
# ---------------------------------------------------------------------

def _derive_ema_stage(rec):
    """Derives a pipeline stage from which evidence DATE fields are
    populated on an EMA record, in strongest-evidence-first order. Never
    guesses from `medicine_status`/`opinion_status` strings alone —
    every stage returned here is backed by an explicit date field on the
    same record, satisfying spec section J (status + status_date +
    evidence, always together)."""
    g = lambda k: (rec.get(k) or "").strip() or None

    if g("marketing_authorisation_date"):
        return "APPROVED", g("marketing_authorisation_date")
    if g("refusal_of_marketing_authorisation_date"):
        return "REJECTED", g("refusal_of_marketing_authorisation_date")
    if g("withdrawal_of_application_date") or g("withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date"):
        return "WITHDRAWN", g("withdrawal_of_application_date") or g("withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date")
    if g("opinion_adopted_date"):
        opinion_status = (g("opinion_status") or "").lower()
        if "positive" in opinion_status:
            return "POSITIVE_REGULATORY_OPINION", g("opinion_adopted_date")
        return "UNDER_REGULATORY_REVIEW", g("opinion_adopted_date")
    if g("start_of_evaluation_date"):
        return "UNDER_REGULATORY_REVIEW", g("start_of_evaluation_date")
    if g("start_of_rolling_review_date"):
        return "REGULATORY_SUBMITTED", g("start_of_rolling_review_date")
    return None, None


def fetch_ema_medicines(source_cfg, taxonomy_matcher):
    """Fetches EMA's bulk medicines JSON and keeps only records that
    cross-reference the existing Zeta taxonomy (spec section F) — a
    generic EU-authorised medicine with no molecule/TA/competitor match
    is not commercial intelligence for Zeta and is dropped here, the
    same "not simply news collection" principle as
    etl/build_news_cache.py's is_academic_noise filter.

    `taxonomy_matcher(text)` -> classification dict (see
    etl/classify_news.classify_article via the thin adapter in
    etl/build_regulatory_cache.py). Never raises."""
    name = source_cfg.get("name", "EMA Medicines Dataset")
    url = source_cfg.get("url", "")
    record = _new_health_record("ema_medicines", name, url)
    items = []

    if not source_cfg.get("enabled", True):
        record["status"] = "DISABLED"
        return items, record

    t0 = time.time()
    raw, http_status, err_type, err_msg = _http_get(url, accept="application/json")
    record["http_status"] = http_status
    if raw is None:
        record["error_type"] = err_type
        record["error_message"] = err_msg
        return items, _finalize(record, items, t0)

    try:
        data = json.loads(raw.decode("utf-8", errors="replace"))
    except Exception as e:
        record["error_type"] = "ParseError"
        record["error_message"] = f"JSON decode failed: {e}"
        return items, _finalize(record, items, t0)

    rows = data if isinstance(data, list) else data.get("results") or data.get("data") or []
    unmatched_stage_count = 0
    for rec in rows:
        try:
            name_of_medicine = (rec.get("name_of_medicine") or "").strip()
            if not name_of_medicine:
                continue
            inn = (rec.get("international_non_proprietary_name_common_name") or "").strip()
            active_substance = (rec.get("active_substance") or "").strip()
            indication = (rec.get("therapeutic_indication") or "").strip()

            match_text = f"{name_of_medicine} {inn} {active_substance} {indication}"
            classification = taxonomy_matcher(match_text)
            has_zeta_relevance = bool(
                classification.get("molecules") or classification.get("companies")
                or classification.get("brands")
                or classification.get("primary_therapeutic_area") not in (None, "General Strategic Intelligence")
            )
            if not has_zeta_relevance:
                continue

            stage, raw_stage_date = _derive_ema_stage(rec)
            if stage is None or not raw_stage_date:
                unmatched_stage_count += 1
                continue  # no evidence date at all -> no defensible stage, skip

            iso_date, event_year = _normalize_date(raw_stage_date)
            if not iso_date or event_year != 2026:
                continue  # Strict 2026 filter

            items.append({
                "drug_name": name_of_medicine,
                "active_ingredient": inn or active_substance,
                "applicant": (rec.get("marketing_authorisation_developer_applicant_holder") or "").strip(),
                "indication_text": indication,
                "stage": stage,
                "stage_date": iso_date,
                "event_year": event_year,
                "opinion_status": (rec.get("opinion_status") or "").strip() or None,
                "orphan_medicine": rec.get("orphan_medicine"),
                "accelerated_assessment": rec.get("accelerated_assessment"),
                "source_name": "EMA Medicines Dataset",
                "source_url": (rec.get("medicine_url") or url),
                "evidence_level": 1,
                "_classification_hint_text": match_text,
            })
        except Exception:
            continue  # one malformed record must never take down the run

    if unmatched_stage_count:
        record["error_message"] = f"{unmatched_stage_count} Zeta-relevant record(s) had no dated evidence field and were skipped (not an error, informational)."
    return items, _finalize(record, items, t0)
