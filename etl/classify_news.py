import re

def classify_article(article, configs):
    therapeutic_cfg = configs.get('therapeutic_areas', {})
    molecules_cfg = configs.get('molecules', {}).get('molecules', [])
    competitors_cfg = configs.get('competitors', {}).get('competitors', [])
    intelligence_types_cfg = configs.get('intelligence_types', {}).get('types', [])
    geography_cfg = configs.get('geography', {}).get('geographies', [])
    keywords_cfg = configs.get('news_keywords', {})

    title_text = article.get('title', '').lower()
    summary_text = article.get('summary', '').lower()
    source_text = article.get('source', '').lower()
    full_text = f"{title_text} {summary_text} {source_text}"

    # 1. Match Molecules & Mechanisms
    mol_by_name = {m.get('name'): m for m in molecules_cfg}
    matched_molecules = []
    matched_mechanisms = set()
    matched_brands = set()
    for mol in molecules_cfg:
        mol_name = mol.get('name', '')
        mol_matched = False
        if re.search(r'\b' + re.escape(mol_name.lower()) + r'\b', full_text):
            mol_matched = True
            
        for brd in mol.get('brand_originators', []) + mol.get('zeta_brands', []):
            if re.search(r'\b' + re.escape(brd.lower()) + r'\b', full_text):
                mol_matched = True
                matched_brands.add(brd)
                
        if mol_matched:
            matched_molecules.append(mol_name)
            if mol.get('mechanism'):
                matched_mechanisms.add(mol.get('mechanism'))

    # 2. Match Therapeutic Areas
    ta_scores = {}
    ta_name_map = {}
    
    for tier_key, tier_data in therapeutic_cfg.get('tiers', {}).items():
        for area in tier_data.get('areas', []):
            area_id = area.get('id')
            area_name = area.get('name')
            ta_name_map[area_id] = area_name
            score = 0
            
            for kw in area.get('keywords', []):
                count = len(re.findall(r'\b' + re.escape(kw.lower()) + r'\b', full_text))
                score += count * 2
                
            for mol in area.get('molecules', []):
                if mol in matched_molecules or re.search(r'\b' + re.escape(mol.lower()) + r'\b', full_text):
                    score += 5
                    if mol not in matched_molecules:
                        matched_molecules.append(mol)
                        
            for mech in area.get('mechanisms', []):
                if re.search(r'\b' + re.escape(mech.lower()) + r'\b', full_text):
                    score += 4
                    matched_mechanisms.add(mech)
                    
            if score > 0:
                ta_scores[area_id] = score

    primary_ta = "General Strategic Intelligence"
    secondary_tas = []
    
    if ta_scores:
        sorted_tas = sorted(ta_scores.items(), key=lambda x: x[1], reverse=True)
        primary_ta = ta_name_map.get(sorted_tas[0][0], sorted_tas[0][0])
        for ta_id, _ in sorted_tas[1:]:
            ta_name = ta_name_map.get(ta_id, ta_id)
            if ta_name not in secondary_tas and ta_name != primary_ta:
                secondary_tas.append(ta_name)
                
    if "diabetic neuropathy" in full_text or ("neuropathy" in full_text and "diabetes" in full_text):
        primary_ta = "Neuroscience & Pain"
        if "Diabetes & Metabolic Disease" not in secondary_tas:
            secondary_tas.append("Diabetes & Metabolic Disease")
            
    if any(m in matched_molecules for m in ["Semaglutide", "Tirzepatide", "Liraglutide", "Retatrutide"]):
        if any(w in full_text for w in ["obesity", "weight loss", "weight management", "wegovy", "zepbound"]):
            primary_ta = "Obesity & Incretin Therapies"
        if any(w in full_text for w in ["heart failure", "cvot", "cardiovascular", "ckd", "kidney"]):
            if "Cardio-Renal-Metabolic" not in secondary_tas and primary_ta != "Cardio-Renal-Metabolic":
                secondary_tas.append("Cardio-Renal-Metabolic")

    # 3. Match Business Units
    bu_matches = set()
    bus_cfg = keywords_cfg.get('business_units', {})
    for bu_key, bu_data in bus_cfg.items():
        for kw in bu_data.get('keywords', []):
            if re.search(r'\b' + re.escape(kw.lower()) + r'\b', full_text):
                bu_matches.add(bu_key)
                break
        for mol in bu_data.get('molecules', []):
            if mol in matched_molecules or re.search(r'\b' + re.escape(mol.lower()) + r'\b', full_text):
                bu_matches.add(bu_key)
                break

    if primary_ta in ["Obesity & Incretin Therapies", "Diabetes & Metabolic Disease"]:
        bu_matches.add("DIAB")
    elif primary_ta == "Gastroenterology":
        bu_matches.add("GIT")
    elif primary_ta == "Cardio-Renal-Metabolic":
        bu_matches.add("Cluster")
    elif primary_ta in ["Neuroscience & Pain", "Dermatology"]:
        bu_matches.add("GIT")
    elif primary_ta == "CHC / Consumer Health":
        bu_matches.add("CHC")
    elif primary_ta in ["Women's Health", "Pediatrics"]:
        bu_matches.add("Cluster")
    elif primary_ta == "Regulatory & Egypt Healthcare":
        bu_matches.update(["DIAB", "GIT", "Cluster", "CHC"])

    business_units = sorted(list(bu_matches)) if bu_matches else ["Corporate"]

    # 4. Match Competitors
    matched_companies = []
    for comp in competitors_cfg:
        for kw in comp.get('keywords', []):
            if re.search(r'\b' + re.escape(kw.lower()) + r'\b', full_text):
                matched_companies.append(comp.get('name'))
                break

    # 5. Match Intelligence Types
    matched_intel_types = []
    for itype in intelligence_types_cfg:
        type_id = itype.get('id')
        for kw in itype.get('keywords', []):
            if re.search(r'\b' + re.escape(kw.lower()) + r'\b', full_text):
                matched_intel_types.append(type_id)
                break
    if not matched_intel_types:
        matched_intel_types = ["Clinical Result" if "pubmed" in source_text else "Market Access"]

    # 6. Resolve Geography
    geography = article.get('country', 'Global')
    for geo in geography_cfg:
        for kw in geo.get('keywords', []):
            if re.search(r'\b' + re.escape(kw.lower()) + r'\b', full_text):
                geography = geo.get('id')
                break
        if geography == "Egypt":
            break

    # 7. Construct Discovery Tags
    tags = set()
    tags.add(geography)
    tags.add(primary_ta)
    for itype in matched_intel_types:
        tags.add(itype)
    for mol in matched_molecules[:4]:
        tags.add(mol)
    for comp in matched_companies[:3]:
        tags.add(comp)

    # 8. Opportunity Type (2026-09-13, additive)
    #
    # Derived entirely from config/molecules.yaml's `is_zeta_portfolio`
    # flag, which was defined in that config but never actually read
    # anywhere in the pipeline until now. Classifies what an article means
    # commercially for Zeta's OWN portfolio -- distinct from (and computed
    # after) the therapeutic-area/molecule/company matching above, which it
    # reuses rather than recomputes. Does not change relevance/impact
    # scoring in etl/score_news.py, and does not change primary_ta,
    # molecules, business_units, or any other field above.
    #
    # Rules (confirmed with Ahmed 2026-09-13, from a worked example against
    # the live 56-article feed before this was built):
    #   - Portfolio Defense: the article names a molecule Zeta itself sells.
    #   - Whitespace Opportunity: primary_ta == "Obesity & Incretin
    #     Therapies" -- the one TA where every molecule in molecules.yaml is
    #     is_zeta_portfolio: false, i.e. Zeta has zero branded product
    #     there today. This fires even when the article names no specific
    #     molecule (e.g. a class-level "GLP-1 receptor agonists in obesity"
    #     study) -- deliberately broader than a molecule-name match, since
    #     the whole point is to surface market development signal in a
    #     space Zeta doesn't compete in yet.
    #   - Competitive Encroachment: a non-Zeta molecule is matched whose
    #     primary_ta is one Zeta DOES already have a branded product in
    #     (Diabetes & Metabolic, Cardio-Renal-Metabolic, Gastroenterology,
    #     Neuroscience & Pain today) -- sub-labeled:
    #       - "Direct Class Threat" if the rival molecule's mechanism
    #         matches a mechanism Zeta already sells in that same TA
    #         (e.g. rival SGLT2 Dapagliflozin vs. Zeta's own SGLT2
    #         Empagliflozin).
    #       - "Adjacent Mechanism" otherwise (e.g. Finerenone/MRA vs.
    #         Zeta's Factor-Xa/statin presence in Cardio-Renal-Metabolic --
    #         same disease territory, different drug class).
    #   - Anything else (no molecule matched and not the Obesity/Incretin
    #     TA -- e.g. Pediatrics, Dermatology, general FDA/regulatory news)
    #     gets no opportunity_type at all (None): this taxonomy is
    #     deliberately scoped to molecule-driven portfolio strategy, not a
    #     catch-all for every article.
    zeta_portfolio_tas = set(
        m.get('primary_ta') for m in molecules_cfg if m.get('is_zeta_portfolio')
    )
    zeta_molecules_matched = [
        m for m in set(matched_molecules)
        if mol_by_name.get(m, {}).get('is_zeta_portfolio')
    ]

    opportunity_type = None
    opportunity_sublabel = None

    if zeta_molecules_matched:
        opportunity_type = "Portfolio Defense"

    elif primary_ta == "Obesity & Incretin Therapies":
        opportunity_type = "Whitespace Opportunity"

    else:
        rival_tas = set(
            mol_by_name.get(m, {}).get('primary_ta') for m in matched_molecules
            if m in mol_by_name
        )
        rival_tas.discard(None)
        if rival_tas & zeta_portfolio_tas:
            opportunity_type = "Competitive Encroachment"

    if opportunity_type == "Competitive Encroachment":
        rival_mechanisms = set(
            mol_by_name.get(m, {}).get('mechanism') for m in matched_molecules
            if m in mol_by_name and not mol_by_name.get(m, {}).get('is_zeta_portfolio')
        )
        rival_mechanisms.discard(None)
        zeta_mechanisms_in_ta = set(
            m.get('mechanism') for m in molecules_cfg
            if m.get('is_zeta_portfolio') and m.get('primary_ta') in rival_tas
        )
        opportunity_sublabel = "Direct Class Threat" if (rival_mechanisms & zeta_mechanisms_in_ta) else "Adjacent Mechanism"

    elif opportunity_type == "Whitespace Opportunity":
        source_id = (article.get('source_id') or '').lower()
        is_supply_recall_signal = (
            'Supply / Shortage' in matched_intel_types
            or source_id == 'fda_drug_enforcement'
            or 'recall' in title_text
        )
        if is_supply_recall_signal:
            opportunity_sublabel = "Supply / Recall Signal"

    return {
        'primary_therapeutic_area': primary_ta,
        'secondary_therapeutic_areas': secondary_tas,
        'business_units': business_units,
        'molecules': sorted(list(set(matched_molecules))),
        'mechanisms': sorted(list(matched_mechanisms)),
        'companies': sorted(list(set(matched_companies))),
        'brands': sorted(list(matched_brands)),
        'geography': geography,
        'intelligence_types': matched_intel_types,
        'tags': sorted(list(tags)),
        'opportunity_type': opportunity_type,
        'opportunity_sublabel': opportunity_sublabel
    }
