import re

def score_article(article, classification, configs, age_days=None, source_weight=1.0):
    """Content-based relevance/impact scoring.

    2026-09-10 changes (P0/P1 fix):
      - impact thresholds are now read from config/scoring_rules.yaml
        (impact_thresholds) instead of being hard-coded, so they're
        actually configurable as the rest of the pipeline claims.
      - recency is now a real input to the score (age_days), not a flat
        +5 regardless of whether the article is 3 days or 12 years old.
      - source_weight (config/news_sources.yaml default_weight) now
        actually affects the score — it was defined in config but never
        read anywhere.
      - `breaking` is NO LONGER decided here. Content relevance alone must
        never be able to make an old/low-quality article "breaking" — that
        decision now lives in etl/build_news_cache.py's ticker-eligibility
        gate, which also checks recency, URL validity, and academic-noise
        exclusion (config/pipeline_settings.yaml: ticker_eligibility).
    """
    scoring_cfg = configs.get('scoring_rules', {})
    weights = scoring_cfg.get('scoring_weights', {
        'egypt_relevance': 30,
        'zeta_bu_relevance': 20,
        'zeta_therapeutic_relevance': 20,
        'competitor_relevance': 15,
        'molecule_relevance': 10,
        'recency_bonus': 5
    })

    geography = classification.get('geography', 'Global')
    bus = classification.get('business_units', [])
    primary_ta = classification.get('primary_therapeutic_area', '')
    molecules = classification.get('molecules', [])
    companies = classification.get('companies', [])
    title = article.get('title', '').lower()
    summary = article.get('summary', '').lower()
    full_text = f"{title} {summary}"

    score = 0.0

    # 1. Egypt & Regional Relevance
    if geography == 'Egypt':
        score += weights.get('egypt_relevance', 30)
    elif geography == 'MENA':
        score += weights.get('egypt_relevance', 30) * 0.6
    else:
        score += 10.0

    # 2. Zeta BU Relevance
    if any(b in bus for b in ['DIAB', 'GIT', 'Cluster', 'CHC']):
        score += weights.get('zeta_bu_relevance', 20)
    else:
        score += 8.0

    # 3. Zeta Therapeutic Relevance
    tier_1_tas = [
        "Obesity & Incretin Therapies", "Diabetes & Metabolic Disease",
        "Cardio-Renal-Metabolic", "Gastroenterology",
        "Regulatory & Egypt Healthcare", "Competitor & Market Moves"
    ]
    if primary_ta in tier_1_tas:
        score += weights.get('zeta_therapeutic_relevance', 20)
    elif primary_ta in ["Neuroscience & Pain", "Dermatology", "CHC / Consumer Health"]:
        score += weights.get('zeta_therapeutic_relevance', 20) * 0.8
    else:
        score += weights.get('zeta_therapeutic_relevance', 20) * 0.6

    # 4. Competitor Relevance
    if companies:
        score += weights.get('competitor_relevance', 15)

    # 5. Molecule Relevance
    if molecules:
        score += weights.get('molecule_relevance', 10)

    # 6. Recency (now actually recency-aware, was a flat +5 regardless of age)
    recency_weight = weights.get('recency_bonus', 5)
    if age_days is None:
        # Unknown/unparseable date — conservative, not "fresh". Matches
        # pipeline_settings.yaml's treat_missing_date_as_archive intent.
        score += recency_weight * 0.2
    elif age_days <= 3:
        score += recency_weight * 1.0
    elif age_days <= 14:
        score += recency_weight * 0.7
    elif age_days <= 60:
        score += recency_weight * 0.4
    elif age_days <= 180:
        score += recency_weight * 0.15
    else:
        score += 0.0

    # 7. Source quality (config/news_sources.yaml default_weight, e.g. EDA
    # 1.5 > FiercePharma 1.2 > PharmaBoardroom 1.0 > PubMed 0.8). Additive,
    # not multiplicative, so a low-weight source can't be zeroed out and a
    # high-weight source can't dominate purely on provenance.
    score += (source_weight - 1.0) * 10.0

    # Urgency Triggers Boost
    for trigger in scoring_cfg.get('urgency_triggers', []):
        pat = trigger.get('pattern', '')
        if pat and re.search(r'\b(?:' + pat + r')\b', full_text, re.IGNORECASE):
            cond_geo = trigger.get('condition_geo')
            if not cond_geo or cond_geo == geography:
                score += trigger.get('score_boost', 20)
                break

    relevance = int(min(100.0, max(20.0, score)))

    # Map to Impact Level — thresholds read from config, not hard-coded.
    thresholds = scoring_cfg.get('impact_thresholds', {})
    critical_min = thresholds.get('CRITICAL', {}).get('min_score', 90)
    high_min = thresholds.get('HIGH', {}).get('min_score', 75)
    medium_min = thresholds.get('MEDIUM', {}).get('min_score', 50)

    if relevance >= critical_min:
        impact, importance = "CRITICAL", 5
    elif relevance >= high_min:
        impact, importance = "HIGH", 4
    elif relevance >= medium_min:
        impact, importance = "MEDIUM", 3
    else:
        impact, importance = "LOW", 2

    intel_types = classification.get('intelligence_types', [])
    why_it_matters = generate_why_it_matters(primary_ta, intel_types, bus, molecules, companies, geography)

    return {
        'relevance': relevance,
        'impact': impact,
        'importance': importance,
        'why_it_matters': why_it_matters
    }

def generate_why_it_matters(primary_ta, intel_types, bus, molecules, companies, geography):
    comp_str = f" from {companies[0]}" if companies else ""
    mol_str = f" involving {molecules[0]}" if molecules else ""
    bu_str = "/".join(bus)

    if "Pricing" in intel_types:
        if geography == "Egypt":
            return f"Direct impact on gross margins and pricing compliance for {bu_str} commercial portfolio in Egypt."
        return f"Pricing and reimbursement signal{mol_str}; monitor institutional tenders and hospital listings."

    elif "Supply / Shortage" in intel_types:
        if geography == "Egypt":
            return f"Immediate commercial opportunity for {bu_str} sales force to capture displaced pharmacy demand."
        return "Supply chain alert — assess safety stock buffer and raw material sourcing continuity."

    elif "Competitor Move" in intel_types or "New Launch" in intel_types:
        if companies:
            return f"Active competitive move{comp_str}{mol_str}; alert {bu_str} SFE field force and key account managers."
        return f"New market entrant in {primary_ta}; assess differentiation and share-of-voice impact."

    elif "Regulatory" in intel_types:
        if geography == "Egypt":
            return f"EDA regulatory milestone impacting speed-to-market and compliance for {bu_str} in Egypt."
        return f"Regulatory development in {primary_ta}; monitor international guideline harmonization."

    elif "Safety" in intel_types:
        return f"Drug safety/recall signal{mol_str}{comp_str}; assess exposure for comparable products in the {bu_str} portfolio."

    elif primary_ta == "Obesity & Incretin Therapies":
        return "High-growth incretin market signal; critical benchmark for Zeta metabolic pipeline and oral formulations."

    elif primary_ta == "Cardio-Renal-Metabolic":
        return f"Cardio-renal clinical evidence supporting combined organ-protection messaging for {bu_str} sales teams."

    elif primary_ta == "Diabetes & Metabolic Disease":
        return f"Antidiabetic therapy update{mol_str}; evaluate positioning versus standard of care."

    elif primary_ta == "Gastroenterology":
        return f"Acid suppression and GI outcome update; impacts Nexicure and Vonseca market share strategies."

    elif primary_ta == "Neuroscience & Pain":
        return f"Neuropathic pain insight relevant to peripheral neuropathy management and prescription volume."

    elif primary_ta == "CHC / Consumer Health":
        return "Consumer health & OTC retail development; track pharmacy-chain distribution and promotion."

    return f"External strategic intelligence relevant to {bu_str} commercial planning and territory execution."
