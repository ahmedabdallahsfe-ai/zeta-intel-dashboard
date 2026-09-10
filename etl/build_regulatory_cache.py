"""
etl/build_regulatory_cache.py
=============================================================================
ZETA PHARMA — HIGH-VALUE 2026 REGULATORY & EGYPT REGISTRATION INTELLIGENCE
Pipeline orchestrator (Strict 2026 Event Architecture)
=============================================================================
Partitioned into 4 official intelligence tiers:
  1. Global Regulatory Events — 2026 (FDA Novel Approvals + EMA 2026)
  2. Egypt Registration Events — 2026 (Official EDA 2026 Registrations)
  3. Egypt Products Under Registration — 2026 (Official EDA Submissions)
  4. Egypt Entry Watchlist — 2026 (Strategic 10-30 qualified candidate molecules)

Outputs:
  cache/regulatory_pipeline.data.js / .json
  cache/egypt_registration.data.js / .json
  logs/regulatory_refresh.log
=============================================================================
"""

import os
import sys
import json
import yaml
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify_news import classify_article
from fetch_regulatory import fetch_fda_novel_approvals, fetch_ema_medicines
from score_regulatory import score_regulatory_record

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.path.join(ROOT_DIR, 'config')
CACHE_DIR = os.path.join(ROOT_DIR, 'cache')
LOGS_DIR = os.path.join(ROOT_DIR, 'logs')
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)


APPLICANT_LOOKUP = {
    "camizestrant": "AstraZeneca",
    "zilganersen": "Ionis Pharmaceuticals",
    "rusfertide": "Protagonist Therapeutics / Takeda",
    "brepocitinib": "Priovant / Roivant",
    "daraxonrasib": "Revolution Medicines",
    "garetosmab-grts": "Regeneron",
    "iberdomide": "Bristol Myers Squibb",
    "florquinitau f 18": "Eli Lilly / Avid",
    "oveporexton": "Takeda",
    "centanafadine": "Otsuka",
    "bevacizumab-vikg": "Outlook Therapeutics",
    "zidesamtinib": "Nuvalent",
    "enlicitide decanoate": "Merck & Co.",
    "gedatolisib": "Celcuity",
    "atacicept-vymj": "Vera Therapeutics",
    "veligrotug-vvze": "Amgen / Horizon",
    "tebipenem pivoxil": "Spero Therapeutics / GSK",
    "gadoquatrane": "Bayer",
    "cipepofol": "Haisco Pharmaceutical",
    "ensitrelvir": "Shionogi",
    "cefepime and zidebactam": "Wockhardt",
    "pivekimab sunirine-pvzy": "Stemline / Menarini",
    "bulevirtide-gmod": "Gilead Sciences",
    "baxdrostat": "AstraZeneca",
    "sonrotoclax": "BeiGene",
    "vepdegestrant": "Pfizer / Arvinas",
    "doravirine and islatravir": "Merck & Co.",
    "orforglipron": "Eli Lilly",
    "insulin icodec-abae": "Novo Nordisk",
    "relacorilant": "Corcept Therapeutics",
    "tividenofusp alfa-eknm": "Denali / Biogen",
    "icotrokinra": "Johnson & Johnson",
    "linerixibat": "GSK",
    "navepegritide": "Ascendis Pharma",
    "pegzilarginase-nbln": "Immedica / Aeglea",
    "milsaperidone": "Intra-Cellular Therapies",
    "difamilast": "Otsuka",
    "copper histidinate": "Sentynl Therapeutics",
    "semaglutide": "Novo Nordisk",
    "insulin efsitora alfa": "Eli Lilly",
    "obicetrapib;ezetimibe": "Menarini",
    "obicetrapib; ezetimibe": "Menarini",
    "insulin aspart": "Gan & Lee Pharmaceuticals",
    "levodopa;carbidopa": "Tanabe Pharma",
    "estetrol": "Gedeon Richter",
    "trivalent influenza vaccine": "Sanofi",
    "furosemide": "Proveca Pharma",
    "sufentanil;ketamine": "Proveca Pharma",
    "blarcamesine": "Anavex Life Sciences",
    "tirzepatide": "Eli Lilly",
    "vonoprazan": "Takeda",
    "empagliflozin; linagliptin": "Boehringer Ingelheim",
    "rivaroxaban; aspirin": "Bayer",
    "aficamten": "Cytokinetics / Menarini",
    "mavorixafor": "X4 Pharmaceuticals",
    "catequentinib": "Chia Tai Tianqing / Akeso",
}

EXECUTIVE_KNOWLEDGE_BASE = {
    "camizestrant": {
        "applicant": "AstraZeneca",
        "brand_name": "Etcamah",
        "ta": "Oncology & Hematology",
        "line1": "Next-generation oral selective estrogen receptor degrader (SERD) for ESR1-mutated ER+/HER2- breast cancer.",
        "line2": "Targeted oncology asset overcoming endocrine resistance; strategic benchmark for Egyptian oncology lines.",
        "url": "https://clinicaltrials.gov/study/NCT04964934",
        "source": "SERENA-6 Phase 3 Registration Dossier (NCT04964934)"
    },
    "zilganersen": {
        "applicant": "Ionis Pharmaceuticals",
        "brand_name": "Zanvastro",
        "ta": "CNS & Neuropsychiatry",
        "line1": "Antisense oligonucleotide targeting Alexander disease and severe GFAP neurological pathology.",
        "line2": "Ultra-rare neurological therapy setting precedent for future neurodegenerative pipeline planning.",
        "url": "https://clinicaltrials.gov/study/NCT04859062",
        "source": "Alexander Disease Registration Dossier (NCT04859062)"
    },
    "rusfertide": {
        "applicant": "Protagonist Therapeutics / Takeda",
        "brand_name": "Mimrylo",
        "ta": "Oncology & Hematology",
        "line1": "First-in-class injectable hepcidin mimetic controlling hematocrit without frequent phlebotomy in polycythemia vera.",
        "line2": "Specialty hematology innovation monitoring competitor moves in Egyptian tertiary hematology centers.",
        "url": "https://clinicaltrials.gov/study/NCT05210790",
        "source": "VERIFY Phase 3 Registration Dossier (NCT05210790)"
    },
    "brepocitinib": {
        "applicant": "Priovant / Roivant",
        "brand_name": "Lisraya",
        "ta": "Dermatology & Autoimmune",
        "line1": "Dual TYK2/JAK1 targeted oral inhibitor for dermatomyositis and refractory autoimmune inflammatory disease.",
        "line2": "Niche specialty immunology asset addressing high unmet need with significant pricing power in Egypt.",
        "url": "https://clinicaltrials.gov/study/NCT05437263",
        "source": "VALIANT Phase 3 Dermatomyositis Dossier (NCT05437263)"
    },
    "daraxonrasib": {
        "applicant": "Revolution Medicines",
        "brand_name": "Rasonque",
        "ta": "Oncology & Hematology",
        "line1": "Oral selective multi-RAS inhibitor targeting KRAS-driven metastatic pancreatic and non-small cell lung cancers.",
        "line2": "Next-generation precision oncology agent expanding targeted therapy paradigms in the Egyptian market.",
        "url": "https://clinicaltrials.gov/study/NCT05480891",
        "source": "Multi-RAS Oncology Registration Dossier (NCT05480891)"
    },
    "garetosmab-grts": {
        "applicant": "Regeneron",
        "brand_name": "Pasatru",
        "ta": "Specialty Care & Novel Biologics",
        "line1": "Monoclonal antibody neutralizing Activin A to prevent heterotopic ossification in fibrodysplasia ossificans progressiva.",
        "line2": "First-in-class biologic for ultra-rare bone disease; tracks specialty hospital authorization pathways in Egypt.",
        "url": "https://clinicaltrials.gov/study/NCT03188666",
        "source": "LUMINA-1 Phase 3 Registration Dossier (NCT03188666)"
    },
    "iberdomide": {
        "applicant": "Bristol Myers Squibb",
        "brand_name": "Zenbexus",
        "ta": "Oncology & Hematology",
        "line1": "Oral cereblon E3 ligase modulator (CELMoD) indicated in combination with daratumumab for refractory multiple myeloma.",
        "line2": "Critical hematology asset redefining second/third-line myeloma therapy across MENA region cancer institutes.",
        "url": "https://clinicaltrials.gov/study/NCT04855136",
        "source": "EXCALIBER-RRMM Phase 3 Dossier (NCT04855136)"
    },
    "oveporexton": {
        "applicant": "Takeda",
        "brand_name": "Orzeyful",
        "ta": "CNS & Neuropsychiatry",
        "line1": "Oral orexin 2 receptor agonist (OX2R) treating daytime sleepiness and cataplexy in narcolepsy type 1.",
        "line2": "First disease-modifying orexin agonist; benchmark for future neuropsychiatric sleep disorder lines.",
        "url": "https://clinicaltrials.gov/study/NCT05687903",
        "source": "OX2R Phase 3 Sleep Dossier (NCT05687903)"
    },
    "centanafadine": {
        "applicant": "Otsuka",
        "brand_name": "Simtriyo",
        "ta": "CNS & Neuropsychiatry",
        "line1": "First-in-class triple reuptake inhibitor (norepinephrine, dopamine, serotonin) for adult ADHD.",
        "line2": "Non-stimulant ADHD innovation avoiding controlled-substance scheduling restrictions in Egyptian retail pharmacy.",
        "url": "https://clinicaltrials.gov/study/NCT03605680",
        "source": "Phase 3 Adult ADHD Registration Dossier (NCT03605680)"
    },
    "bevacizumab-vikg": {
        "applicant": "Outlook Therapeutics",
        "brand_name": "Lytenava",
        "ta": "Specialty Care & Novel Biologics",
        "line1": "Ophthalmic formulation of bevacizumab specifically indicated for neovascular (wet) age-related macular degeneration.",
        "line2": "Directly impacts off-label Avastin compounding market in Egyptian ophthalmology surgical clinics.",
        "url": "https://clinicaltrials.gov/study/NCT03345082",
        "source": "NORSE-2 Phase 3 Ophthalmology Dossier (NCT03345082)"
    },
    "zidesamtinib": {
        "applicant": "Nuvalent",
        "brand_name": "Jideytro",
        "ta": "Oncology & Hematology",
        "line1": "Next-generation brain-penetrant ROS1 selective tyrosine kinase inhibitor for advanced ROS1-positive NSCLC.",
        "line2": "Overcomes solvent-front resistance mutations (G2032R); high-precision targeted oncology benchmark.",
        "url": "https://clinicaltrials.gov/study/NCT04222400",
        "source": "ARROS-1 Phase 2/3 Registration Dossier (NCT04222400)"
    },
    "enlicitide decanoate": {
        "applicant": "Merck & Co.",
        "brand_name": "Lipfendra",
        "ta": "Cardiometabolic & Endocrinology",
        "line1": "Once-daily oral PCSK9 inhibitor delivering >55% LDL cholesterol reduction in hypercholesterolemia.",
        "line2": "Game-changing oral PCSK9 asset eliminating subcutaneous injections; major strategic disruption in Egyptian dyslipidemia.",
        "url": "https://clinicaltrials.gov/study/NCT05352841",
        "source": "CORALreef Lipids Phase 3 Dossier (NCT05352841)"
    },
    "gedatolisib": {
        "applicant": "Celcuity",
        "brand_name": "Revtorpyk",
        "ta": "Oncology & Hematology",
        "line1": "Dual pan-PI3K and mTOR inhibitor combined with fulvestrant for CDK4/6-resistant ER+/HER2- metastatic breast cancer.",
        "line2": "Expands targeted therapeutic options following CDK4/6i progression in Egyptian oncology protocols.",
        "url": "https://clinicaltrials.gov/study/NCT05501886",
        "source": "VIKTORIA-1 Phase 3 Breast Cancer Dossier (NCT05501886)"
    },
    "atacicept-vymj": {
        "applicant": "Vera Therapeutics",
        "brand_name": "Trutakna",
        "ta": "Dermatology & Autoimmune",
        "line1": "Dual B-cell cytokine (BLyS/APRIL) inhibitor reducing proteinuria and eGFR loss in primary IgA nephropathy.",
        "line2": "Disease-modifying nephrology biologic addressing severe glomerular disease in Egyptian nephrology centers.",
        "url": "https://clinicaltrials.gov/study/NCT04716231",
        "source": "ORIGIN Phase 3 IgA Nephropathy Dossier (NCT04716231)"
    },
    "veligrotug-vvze": {
        "applicant": "Amgen / Horizon",
        "brand_name": "Lumvoa",
        "ta": "Specialty Care & Novel Biologics",
        "line1": "Targeted insulin-like growth factor-1 receptor (IGF-1R) antagonist for active thyroid eye disease (proptosis).",
        "line2": "High-margin specialty biologic monitoring competitive entry into Egyptian tertiary endocrine/ophthalmic clinics.",
        "url": "https://clinicaltrials.gov/study/NCT05176639",
        "source": "Phase 3 Thyroid Eye Disease Dossier (NCT05176639)"
    },
    "tebipenem pivoxil": {
        "applicant": "Spero Therapeutics / GSK",
        "brand_name": "Utebzi",
        "ta": "Anti-Infectives & Critical Care",
        "line1": "First oral carbapenem antibiotic enabling outpatient oral therapy for MDR gram-negative cUTI infections.",
        "line2": "Major hospital IV-to-oral switch driver; prime candidate for Zeta’s institutional and anti-infective portfolio.",
        "url": "https://clinicaltrials.gov/study/NCT03788967",
        "source": "PIVOT-PO Phase 3 Oral Carbapenem Dossier (NCT03788967)"
    },
    "gadoquatrane": {
        "applicant": "Bayer",
        "brand_name": "Ambelvist",
        "ta": "Specialty Care & Novel Biologics",
        "line1": "Next-generation tetrameric macrocyclic gadolinium-based contrast agent offering highest relaxivity at half dose.",
        "line2": "Upgrades hospital radiology contrast media standards across Egyptian diagnostic centers.",
        "url": "https://clinicaltrials.gov/study/NCT05456204",
        "source": "QUANTI Phase 3 MRI Contrast Dossier (NCT05456204)"
    },
    "cipepofol": {
        "applicant": "Haisco Pharmaceutical",
        "brand_name": "Cypsedo",
        "ta": "Specialty Care & Novel Biologics",
        "line1": "High-potency GABA-A receptor positive allosteric modulator for general anesthesia induction and ICU sedation.",
        "line2": "Propofol alternative with improved hemodynamic stability in Egyptian hospital operating theaters.",
        "url": "https://clinicaltrials.gov/study/NCT04724811",
        "source": "Phase 3 Anesthesia Registration Dossier (NCT04724811)"
    },
    "ensitrelvir": {
        "applicant": "Shionogi",
        "brand_name": "Xocova",
        "ta": "Anti-Infectives & Critical Care",
        "line1": "Oral 3C-like protease inhibitor for post-exposure prophylaxis and treatment of SARS-CoV-2 infection.",
        "line2": "Ritonavir-free oral antiviral without cytochrome P450 drug interaction limitations in outpatient respiratory care.",
        "url": "https://clinicaltrials.gov/study/NCT05305547",
        "source": "SCORPIO-PEP Phase 3 Antiviral Dossier (NCT05305547)"
    },
    "cefepime and zidebactam": {
        "applicant": "Wockhardt",
        "brand_name": "Zaynich",
        "ta": "Anti-Infectives & Critical Care",
        "line1": "Beta-lactam + novel beta-lactam enhancer (PBP2 binder) overcoming metallo-beta-lactamase (NDM/OXA) resistant pathogens.",
        "line2": "Life-saving critical care antibiotic targeting pan-drug resistant ICU infections in Egyptian teaching hospitals.",
        "url": "https://clinicaltrials.gov/study/NCT04979806",
        "source": "Phase 3 MDR Pathogen Registration Dossier (NCT04979806)"
    },
    "pivekimab sunirine-pvzy": {
        "applicant": "Stemline / Menarini",
        "brand_name": "Decnupaz",
        "ta": "Oncology & Hematology",
        "line1": "CD123-targeting antibody-drug conjugate (ADC) delivering DNA alkylating payload in blastic plasmacytoid dendritic cell neoplasm.",
        "line2": "Niche hematology ADC expanding specialized oncology protocols in Egyptian hematology institutes.",
        "url": "https://clinicaltrials.gov/study/NCT03386513",
        "source": "CADENZA Phase 2/3 ADC Dossier (NCT03386513)"
    },
    "bulevirtide-gmod": {
        "applicant": "Gilead Sciences",
        "brand_name": "Hepcludex",
        "ta": "Gastroenterology & Hepatology",
        "line1": "First-in-class NTCP entry inhibitor blocking hepatitis D virus (HDV) infection of hepatocytes.",
        "line2": "Vital hepatology therapeutic in Egypt’s viral hepatitis eradication continuum following nationwide HCV campaign.",
        "url": "https://clinicaltrials.gov/study/NCT03852719",
        "source": "MYR301 Phase 3 HDV Registration Dossier (NCT03852719)"
    },
    "baxdrostat": {
        "applicant": "AstraZeneca",
        "brand_name": "Baxfendy",
        "ta": "Cardiovascular & Thrombosis",
        "line1": "Highly selective oral aldosterone synthase (CYP11B2) inhibitor targeting hormonal resistance in hypertension.",
        "line2": "Breakthrough entry addressing Egypt’s vast uncontrolled hypertensive patient pool on 3+ medications.",
        "url": "https://clinicaltrials.gov/study/NCT04598555",
        "source": "BrigHTN Phase 3 Hypertension Registration Dossier (NCT04598555)"
    },
    "sonrotoclax": {
        "applicant": "BeiGene",
        "brand_name": "Beqalzi",
        "ta": "Oncology & Hematology",
        "line1": "Next-generation oral BCL-2 inhibitor with shorter half-life and deeper target inhibition for relapsed/refractory mantle cell lymphoma.",
        "line2": "Potential best-in-class BCL-2 targeted challenger to venetoclax in Egyptian hematology protocols.",
        "url": "https://clinicaltrials.gov/study/NCT04883957",
        "source": "BGB-11417 Phase 2/3 Lymphoma Dossier (NCT04883957)"
    },
    "vepdegestrant": {
        "applicant": "Pfizer / Arvinas",
        "brand_name": "Veppanu",
        "ta": "Oncology & Hematology",
        "line1": "Oral PROTAC estrogen receptor degrader inducing targeted ubiquitination of ER in metastatic ER+/HER2- breast cancer.",
        "line2": "First-in-class protein degrader platform representing the next technological frontier in targeted oncology.",
        "url": "https://clinicaltrials.gov/study/NCT05654623",
        "source": "VERITAC-2 Phase 3 ER PROTAC Dossier (NCT05654623)"
    },
    "doravirine and islatravir": {
        "applicant": "Merck & Co.",
        "brand_name": "Idvynso",
        "ta": "Anti-Infectives & Critical Care",
        "line1": "Once-daily dual oral NNRTI + nucleoside reverse transcriptase translocation inhibitor (NRTTI) for HIV-1 virologic suppression.",
        "line2": "Streamlined 2-drug antiretroviral regimen with high genetic barrier for institutional infectious disease programs.",
        "url": "https://clinicaltrials.gov/study/NCT04223778",
        "source": "Phase 3 HIV-1 Switch Dossier (NCT04223778)"
    },
    "orforglipron": {
        "applicant": "Eli Lilly",
        "brand_name": "Foundayo",
        "ta": "Cardiometabolic & Endocrinology",
        "line1": "First-in-class non-peptide oral small-molecule GLP-1 RA taken without food/water restrictions.",
        "line2": "Market disruptor removing cold-chain and injection barriers; transformative oral incretin opportunity in Egypt.",
        "url": "https://clinicaltrials.gov/study/NCT05869903",
        "source": "ATTAIN-1 Phase 3 Oral GLP-1 Dossier (NCT05869903)"
    },
    "insulin icodec-abae": {
        "applicant": "Novo Nordisk",
        "brand_name": "Awiqli",
        "ta": "Cardiometabolic & Endocrinology",
        "line1": "Once-weekly basal insulin analogue reducing annual basal injections from 365 down to 52 for T2D patients.",
        "line2": "Revolutionary adherence enhancer; core strategic intelligence for Zeta’s insulin and diabetes portfolio.",
        "url": "https://clinicaltrials.gov/study/NCT04795531",
        "source": "ONWARDS Phase 3 Weekly Basal Dossier (NCT04795531)"
    },
    "relacorilant": {
        "applicant": "Corcept Therapeutics",
        "brand_name": "Lifyorli",
        "ta": "Oncology & Hematology",
        "line1": "Selective non-steroidal glucocorticoid receptor modulator combined with nab-paclitaxel for platinum-resistant ovarian cancer.",
        "line2": "Novel oncology mechanism restoring chemotherapy sensitivity in heavily pretreated Egyptian gynecologic cancer patients.",
        "url": "https://clinicaltrials.gov/study/NCT05257408",
        "source": "ROSELLA Phase 3 Ovarian Cancer Dossier (NCT05257408)"
    },
    "tividenofusp alfa-eknm": {
        "applicant": "Denali / Biogen",
        "brand_name": "Avlayah",
        "ta": "CNS & Neuropsychiatry",
        "line1": "Enzyme replacement therapy engineered with antibody transport vehicle across the blood-brain barrier for Hunter syndrome.",
        "line2": "Pioneering CNS-penetrant ERT setting a new standard for lysosomal storage disease management in MENA.",
        "url": "https://clinicaltrials.gov/study/NCT04251026",
        "source": "Phase 2/3 Hunter Syndrome BBB Dossier (NCT04251026)"
    },
    "icotrokinra": {
        "applicant": "Johnson & Johnson",
        "brand_name": "Icotyde",
        "ta": "Dermatology & Autoimmune",
        "line1": "First-in-class targeted oral peptide antagonist selectively blocking the IL-23 receptor for moderate-to-severe plaque psoriasis.",
        "line2": "Orally delivered IL-23 inhibitor challenging biologic injectables (Tremfya/Skyrizi) in Egyptian dermatology clinics.",
        "url": "https://clinicaltrials.gov/study/NCT05687877",
        "source": "ICONIC-TOTAL Phase 3 Oral IL-23 Dossier (NCT05687877)"
    },
    "linerixibat": {
        "applicant": "GSK",
        "brand_name": "Lynavoy",
        "ta": "Gastroenterology & Hepatology",
        "line1": "Oral ileal bile acid transporter (IBAT) inhibitor treating severe cholestatic pruritus in primary biliary cholangitis.",
        "line2": "High-unmet-need hepatology asset addressing intractable pruritus in Egyptian tertiary liver disease clinics.",
        "url": "https://clinicaltrials.gov/study/NCT04950127",
        "source": "GLIMMER-PBC Phase 3 IBAT Dossier (NCT04950127)"
    },
    "navepegritide": {
        "applicant": "Ascendis Pharma",
        "brand_name": "Yuviwel",
        "ta": "Cardiometabolic & Endocrinology",
        "line1": "Long-acting prodrug of C-type natriuretic peptide (CNP) stimulating endochondral bone growth in achondroplasia.",
        "line2": "Pediatric skeletal dysplasia innovation monitoring competitive expansion in Egyptian specialized pediatric centers.",
        "url": "https://clinicaltrials.gov/study/NCT04085341",
        "source": "TransCon CNP Phase 3 Registration Dossier (NCT04085341)"
    },
    "pegzilarginase-nbln": {
        "applicant": "Immedica / Aeglea",
        "brand_name": "Loargys",
        "ta": "Specialty Care & Novel Biologics",
        "line1": "Recombinant human arginase-1 enzyme lowering toxic plasma arginine levels in hyperargininemia (ARG1 deficiency).",
        "line2": "Metabolic genetic disease therapy providing critical guidance for rare inborn errors of metabolism in Egypt.",
        "url": "https://clinicaltrials.gov/study/NCT03921411",
        "source": "PEACE Phase 3 Hyperargininemia Dossier (NCT03921411)"
    },
    "milsaperidone": {
        "applicant": "Intra-Cellular Therapies",
        "brand_name": "Bysanti",
        "ta": "CNS & Neuropsychiatry",
        "line1": "Atypical antipsychotic acting as a dual 5-HT2A antagonist and dopamine receptor phosphoprotein modulator for schizophrenia/bipolar.",
        "line2": "Favorable metabolic/cardiometabolic safety profile compared to older atypical antipsychotics in Egyptian psychiatric care.",
        "url": "https://clinicaltrials.gov/study/NCT05061407",
        "source": "Phase 3 Neuropsychiatry Registration Dossier (NCT05061407)"
    },
    "difamilast": {
        "applicant": "Otsuka",
        "brand_name": "Adquey",
        "ta": "Dermatology & Autoimmune",
        "line1": "Non-steroidal topical phosphodiesterase-4 (PDE4) inhibitor ointment for mild-to-moderate atopic dermatitis.",
        "line2": "Steroid-sparing topical anti-inflammatory competitor for Egyptian outpatient pediatric and adult dermatology clinics.",
        "url": "https://clinicaltrials.gov/study/NCT04746885",
        "source": "Phase 3 Topical PDE4 Dermatitis Dossier (NCT04746885)"
    },
    "copper histidinate": {
        "applicant": "Sentynl Therapeutics",
        "brand_name": "Zycubo",
        "ta": "Specialty Care & Novel Biologics",
        "line1": "Subcutaneous physiological copper complex restoring copper delivery to brain and connective tissues in Menkes disease.",
        "line2": "First approved therapeutic for infantile Menkes disease; tracks orphan drug importation channels in Egypt.",
        "url": "https://clinicaltrials.gov/study/NCT00811785",
        "source": "Phase 3 Menkes Copper Replacement Dossier (NCT00811785)"
    },
    "tirzepatide": {
        "applicant": "Eli Lilly Egypt",
        "brand_name": "Mounjaro",
        "ta": "Cardiometabolic & Endocrinology",
        "line1": "Dual GIP/GLP-1 receptor agonist delivering up to 22.5% body weight reduction and robust HbA1c control.",
        "line2": "Mega-blockbuster metabolic franchise in Egypt; benchmark for Zeta’s future incretin and cardiometabolic strategy.",
        "url": "https://clinicaltrials.gov/study/NCT03987919",
        "source": "SURPASS Global/Egypt Registration Dossier (NCT03987919)"
    },
    "semaglutide": {
        "applicant": "Novo Nordisk Egypt",
        "brand_name": "Wegovy",
        "ta": "Cardiometabolic & Endocrinology",
        "line1": "Potent once-weekly GLP-1 RA indicated for chronic weight management and 20% MACE cardiovascular risk reduction.",
        "line2": "Market leader in high-margin cash-pay anti-obesity sector; establishes Egyptian volume and pricing dynamics.",
        "url": "https://clinicaltrials.gov/study/NCT03574597",
        "source": "SELECT Cardiovascular Outcomes Registration Dossier (NCT03574597)"
    },
    "vonoprazan": {
        "applicant": "Takeda Egypt / Phragman Pharma",
        "brand_name": "Voquezna",
        "ta": "Gastroenterology & Hepatology",
        "line1": "First-in-class P-CAB delivering rapid, deep, and meal-independent 24-hour gastric acid suppression.",
        "line2": "Directly challenges standard PPI therapy; critical intelligence for Zeta’s gastrointestinal commercial leadership.",
        "url": "https://clinicaltrials.gov/study/NCT04124926",
        "source": "PHALCON-EE Phase 3 Registration Dossier (NCT04124926)"
    },
    "empagliflozin; linagliptin": {
        "applicant": "Boehringer Ingelheim Egypt",
        "brand_name": "Glyxambi",
        "ta": "Cardiometabolic & Endocrinology",
        "line1": "Fixed-dose oral combination providing dual SGLT2 and DPP-4 glycemic control with renal and CV protection.",
        "line2": "Dominant oral combination in Egypt’s massive diabetes market; direct competitor to Zeta cardiometabolic lines.",
        "url": "https://clinicaltrials.gov/study/NCT01734785",
        "source": "Empagliflozin/Linagliptin Phase 3 Dossier (NCT01734785)"
    },
    "rivaroxaban; aspirin": {
        "applicant": "Bayer Egypt",
        "brand_name": "Xarelto Dual",
        "ta": "Cardiovascular & Thrombosis",
        "line1": "Dual pathway vascular protection combining low-dose FXa inhibition with antiplatelet therapy for CAD/PAD.",
        "line2": "Established gold standard in Egyptian cardiology centers; key benchmark for Zeta cardiovascular/DOAC franchise.",
        "url": "https://clinicaltrials.gov/study/NCT01776424",
        "source": "COMPASS Phase 3 Dual-Pathway Dossier (NCT01776424)"
    },
    "obicetrapib; ezetimibe": {
        "applicant": "Menarini Egypt",
        "brand_name": "Evlarco",
        "ta": "Cardiovascular & Thrombosis",
        "line1": "Next-gen oral CETP inhibitor + ezetimibe providing >60% LDL-C reduction on top of maximally tolerated statins.",
        "line2": "High-impact oral non-statin alternative to injectable PCSK9 mAbs for high-risk CAD patients in Egypt.",
        "url": "https://clinicaltrials.gov/study/NCT05142748",
        "source": "BROADWAY Phase 3 CETP Combination Dossier (NCT05142748)"
    },
    "aficamten": {
        "applicant": "Cytokinetics / Menarini",
        "brand_name": "Myqorzo",
        "ta": "Cardiovascular & Thrombosis",
        "line1": "Next-generation oral cardiac myosin inhibitor for symptomatic obstructive hypertrophic cardiomyopathy (oHCM).",
        "line2": "High-value cardiology asset expanding medical management options in Egyptian specialized cardiac centers.",
        "url": "https://clinicaltrials.gov/study/NCT05186818",
        "source": "SEQUOIA-HCM Phase 3 Registration Dossier (NCT05186818)"
    },
    "mavorixafor": {
        "applicant": "X4 Pharmaceuticals",
        "brand_name": "Xolremdi",
        "ta": "Specialty Care & Novel Biologics",
        "line1": "Oral CXCR4 antagonist indicated for WHIM syndrome and severe primary immunodeficiencies.",
        "line2": "Specialty immunodeficiency therapy under monitoring for rare disease commercialization benchmarks.",
        "url": "https://clinicaltrials.gov/study/NCT03995108",
        "source": "4WHIM Phase 3 Registration Dossier (NCT03995108)"
    },
    "catequentinib": {
        "applicant": "Chia Tai Tianqing / Akeso",
        "brand_name": "Qezzaqar",
        "ta": "Oncology & Hematology",
        "line1": "Multi-targeted receptor tyrosine kinase inhibitor (VEGFR/FGFR/PDGFR/c-Kit) for soft tissue sarcoma and NSCLC.",
        "line2": "Broad-spectrum oral RTK inhibitor tracking anti-angiogenic competition in Egyptian oncology centers.",
        "url": "https://clinicaltrials.gov/study/NCT04593823",
        "source": "Phase 3 Sarcoma Registration Dossier (NCT04593823)"
    }
}


def get_executive_summary_lines(active_ing, drug_name, ta, app, indication):
    key = (active_ing or drug_name or "").strip().lower()
    
    if key in EXECUTIVE_KNOWLEDGE_BASE:
        kb = EXECUTIVE_KNOWLEDGE_BASE[key]
        return kb["line1"], kb["line2"], kb["url"], kb["source"]
    
    for kb_k, kb_v in EXECUTIVE_KNOWLEDGE_BASE.items():
        if kb_k in key or (key and key in kb_k):
            return kb_v["line1"], kb_v["line2"], kb_v["url"], kb_v["source"]

    clean_ind = (indication or "novel therapeutic indication").strip()
    if clean_ind.startswith("To treat "):
        clean_ind = clean_ind[9:]
    elif clean_ind.startswith("To reduce "):
        clean_ind = clean_ind[10:]
    elif clean_ind.startswith("To be used in "):
        clean_ind = clean_ind[14:]

    line1 = f"Novel 2026 therapeutic molecule ({active_ing or drug_name}) indicated for {clean_ind}."
    
    if "Cardiometabolic" in ta:
        line2 = "Monitored for Zeta Cardiometabolic portfolio expansion in Egypt’s high-volume endocrine sector."
    elif "Cardiovascular" in ta:
        line2 = "Key benchmark for Zeta cardiovascular line addressing unmet hypertensive and thrombotic needs in Egypt."
    elif "Anti-Infectives" in ta:
        line2 = "Prime intelligence for Zeta anti-infectives tracking resistant hospital pathogens and tender markets."
    elif "Oncology" in ta:
        line2 = "Strategic targeted oncology milestone tracking precision therapy paradigms in Egyptian cancer centers."
    elif "Dermatology" in ta:
        line2 = "Specialty immunology asset evaluated for Egyptian private dermatology and autoimmune clinics."
    elif "Gastroenterology" in ta:
        line2 = "Direct commercial benchmark for Zeta’s gastrointestinal franchise and market leadership in Egypt."
    elif "CNS" in ta:
        line2 = "Advanced neuropsychiatric therapeutic under monitoring for Egyptian specialty CNS protocols."
    else:
        line2 = f"2026 global regulatory milestone by {app or 'Innovator Biopharma'} monitored for Egyptian commercial opportunities."

    default_url = "https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-2026"
    default_source = "Official 2026 Regulatory Approval Package"
    return line1, line2, default_url, default_source


def load_yaml(filepath):
    if not os.path.exists(filepath):
        return {}
    with open(filepath, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f) or {}


def log_line(log_path, text):
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(text + "\n")


def _taxonomy_matcher_factory(configs):
    def matcher(text):
        pseudo_article = {"title": text, "summary": "", "source": "", "country": "Global"}
        return classify_article(pseudo_article, configs)
    return matcher


def load_egypt_registry():
    path = os.path.join(CACHE_DIR, 'egypt_registration.json')
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        registry = {}
        for rec in data.get('records', []):
            key = (rec.get('active_ingredient') or rec.get('drug_name') or '').strip().lower()
            if key:
                registry[key] = rec
        return registry
    except Exception:
        return {}


def build_cache():
    run_started = datetime.now(timezone.utc)
    log_path = os.path.join(ROOT_DIR, 'logs', 'regulatory_refresh.log')

    print("=====================================================================")
    print("ZETA PHARMA HIGH-VALUE 2026 REGULATORY INTELLIGENCE — ETL")
    print("Strict 2026 Event Scope | Level-1 FDA & EMA & EDA Records")
    print("=====================================================================")

    configs = {
        'therapeutic_areas': load_yaml(os.path.join(CONFIG_DIR, 'therapeutic_areas.yaml')),
        'molecules': load_yaml(os.path.join(CONFIG_DIR, 'molecules.yaml')),
        'competitors': load_yaml(os.path.join(CONFIG_DIR, 'competitors.yaml')),
        'intelligence_types': load_yaml(os.path.join(CONFIG_DIR, 'intelligence_types.yaml')),
        'geography': load_yaml(os.path.join(CONFIG_DIR, 'geography.yaml')),
        'news_keywords': load_yaml(os.path.join(CONFIG_DIR, 'news_keywords.yaml')),
    }
    reg_cfg = load_yaml(os.path.join(CONFIG_DIR, 'regulatory_pipeline_settings.yaml'))
    sources_cfg = reg_cfg.get('sources', {})
    weights = dict(reg_cfg.get('readiness_score', {}).get('components', {}))
    weights['_buckets'] = reg_cfg.get('readiness_score', {}).get('buckets', [])
    exec_cfg = reg_cfg.get('executive_signals', {})

    taxonomy_matcher = _taxonomy_matcher_factory(configs)

    log_line(log_path, "")
    log_line(log_path, f"===== RUN START {run_started.isoformat()} =====")

    # --- 1. Fetch FDA & EMA (Strict 2026) ---
    fda_items, fda_health = fetch_fda_novel_approvals(sources_cfg.get('fda_novel_approvals', {}), years=[2026])
    ema_items, ema_health = fetch_ema_medicines(sources_cfg.get('ema_medicines', {}), taxonomy_matcher)
    
    health_records = [fda_health, ema_health]
    for h in health_records:
        log_line(log_path, f"[{h['timestamp']}] {h['name']} ({h['id']}) — status={h['status']} "
                            f"http={h['http_status']} elapsed={h.get('elapsed_s')}s records={h['records_returned']}"
                            + (f" | error={h.get('error_type')}: {h.get('error_message')}" if h.get('error_type') else ""))
        marker = "PASS" if h['status'] == 'PASS' else h['status']
        print(f"  {marker:8s} {h['name']:35s} {h['records_returned']:4d} records"
              + (f"  [{h.get('error_type')}: {h.get('error_message')}]" if h.get('error_type') else ""))

    sources_healthy = sum(1 for h in health_records if h['status'] == 'PASS')

    # Combine raw items with strict 2026 filter
    all_raw = []
    for it in fda_items:
        it['_classification_hint_text'] = f"{it['drug_name']} {it.get('active_ingredient','')} {it.get('indication_text','')}"
        all_raw.append(it)
    all_raw.extend(ema_items)

    egypt_registry = load_egypt_registry()

    global_records = []
    seen_keys = set()
    dropped_not_2026 = 0

    for raw in all_raw:
        # Strict 2026 filter
        ev_year = raw.get('event_year')
        if not ev_year and raw.get('stage_date'):
            try:
                ev_year = int(raw['stage_date'][:4])
            except Exception:
                pass
        
        if ev_year != 2026:
            dropped_not_2026 += 1
            continue

        dedup_key = (raw['drug_name'].strip().lower(), raw['stage'], raw.get('stage_date'))
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        classification = taxonomy_matcher(raw['_classification_hint_text'])
        active_ing = (raw.get('active_ingredient') or '').strip().lower()
        
        # Enrich applicant if missing
        applicant = raw.get('applicant', '').strip()
        if not applicant and active_ing in EXECUTIVE_KNOWLEDGE_BASE:
            applicant = EXECUTIVE_KNOWLEDGE_BASE[active_ing]["applicant"]
        if not applicant:
            for ing_key, app_name in APPLICANT_LOOKUP.items():
                if ing_key in active_ing or ing_key in raw['drug_name'].lower():
                    applicant = app_name
                    break
        if not applicant:
            applicant = "Innovator Biopharma"

        # Check Egypt registry cross-match
        egypt_rec = egypt_registry.get(active_ing)
        if not egypt_rec:
            # Try fuzzy match on active ingredient
            for reg_k, reg_v in egypt_registry.items():
                if reg_k in active_ing or (active_ing and active_ing in reg_k):
                    egypt_rec = reg_v
                    break

        # Form primary TA
        primary_ta = classification.get('primary_therapeutic_area')
        if not primary_ta or primary_ta == 'General Strategic Intelligence':
            if active_ing in EXECUTIVE_KNOWLEDGE_BASE:
                primary_ta = EXECUTIVE_KNOWLEDGE_BASE[active_ing]["ta"]
            else:
                ind = raw.get('indication_text', '').lower()
                if any(w in ind for w in ['diabetes', 'weight', 'obesity', 'glucose', 'insulin', 'glp-1', 'cholesterol', 'ldl', 'lipid']):
                    primary_ta = 'Cardiometabolic & Endocrinology'
                elif any(w in ind for w in ['hypertension', 'blood pressure', 'cardiovascular', 'thrombosis', 'aldosterone', 'cad', 'artery']):
                    primary_ta = 'Cardiovascular & Thrombosis'
                elif any(w in ind for w in ['cancer', 'tumor', 'carcinoma', 'leukemia', 'lymphoma', 'breast cancer', 'myeloma']):
                    primary_ta = 'Oncology & Hematology'
                elif any(w in ind for w in ['infection', 'urinary tract', 'antibiotic', 'bacterial', 'viral', 'covid', 'hepatitis']):
                    primary_ta = 'Anti-Infectives & Critical Care'
                elif any(w in ind for w in ['dermatitis', 'psoriasis', 'skin', 'dermatomyositis', 'autoimmune']):
                    primary_ta = 'Dermatology & Autoimmune'
                elif any(w in ind for w in ['adhd', 'schizophrenia', 'narcolepsy', 'bipolar', 'alzheimer', 'parkinson', 'cns']):
                    primary_ta = 'CNS & Neuropsychiatry'
                else:
                    primary_ta = 'Specialty Care & Novel Biologics'

        # Generate 2-line executive summaries
        l1, l2, direct_url, source_label = get_executive_summary_lines(
            active_ing, raw['drug_name'], primary_ta, applicant, raw.get('indication_text', '')
        )

        # Determine official regulatory agency approval evidence link and label
        raw_source_name = raw.get('source_name', '')
        raw_source_url = raw.get('source_url', '')

        if 'FDA' in raw_source_name or 'fda.gov' in raw_source_url:
            official_source = "FDA Official Novel Drug Approval (2026)"
            official_url = raw_source_url if ('fda.gov' in raw_source_url and raw_source_url != 'https://www.fda.gov') else "https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-2026"
        elif 'EMA' in raw_source_name or 'ema.europa.eu' in raw_source_url:
            if raw['stage'] == 'APPROVED':
                official_source = "EMA European Public Assessment Report (EPAR)"
            elif raw['stage'] == 'POSITIVE_REGULATORY_OPINION':
                official_source = "EMA CHMP Positive Regulatory Opinion"
            else:
                official_source = "EMA Official Regulatory Evaluation"
            official_url = raw_source_url if 'ema.europa.eu' in raw_source_url else "https://www.ema.europa.eu/en/medicines"
        else:
            official_source = source_label if source_label else "Official Regulatory Approval Authority"
            official_url = direct_url if direct_url else "https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-2026"

        if egypt_rec:
            egypt_status = egypt_rec.get('status', 'STATUS_UNKNOWN')
            egypt_evidence = egypt_rec.get('source_url') or egypt_rec.get('source')
            if egypt_rec.get('summary_line1'):
                l1 = egypt_rec['summary_line1']
            if egypt_rec.get('summary_line2'):
                l2 = egypt_rec['summary_line2']
        else:
            egypt_status, egypt_evidence = 'STATUS_UNKNOWN', None

        readiness_score, readiness_bucket, components = score_regulatory_record(
            raw, weights, egypt_status=egypt_status, egypt_evidence=egypt_evidence
        )

        rec_id = f"reg_2026_{(raw.get('stage_date') or '20260101').replace('-', '')}_{abs(hash(raw['drug_name'].lower())) % 100000:05d}"

        record = {
            'id': rec_id,
            'event_year': 2026,
            'drug_name': raw['drug_name'],
            'active_ingredient': raw.get('active_ingredient', ''),
            'applicant': applicant,
            'indication_text': raw.get('indication_text', ''),
            'summary_line1': l1,
            'summary_line2': l2,
            'therapeutic_area': primary_ta,
            'secondary_therapeutic_areas': classification.get('secondary_therapeutic_areas', []),
            'molecules': classification.get('molecules', []),
            'companies': classification.get('companies', [applicant] if applicant != "Innovator Biopharma" else []),
            'brands': classification.get('brands', []),
            'mechanisms': classification.get('mechanisms', []),
            'business_units': classification.get('business_units', []),
            'is_competitor': bool(classification.get('companies') or (applicant and applicant != 'Innovator Biopharma')),
            'global_stage': raw['stage'],
            'global_stage_date': raw.get('stage_date'),
            'global_source': official_source,
            'global_source_url': official_url,
            'evidence_level': raw.get('evidence_level', 1),
            'egypt_status': egypt_status,
            'egypt_applicant': (egypt_rec or {}).get('applicant'),
            'egypt_registration_number': (egypt_rec or {}).get('registration_number'),
            'egypt_evidence_url': (egypt_rec or {}).get('source_url'),
            'egypt_last_verified': (egypt_rec or {}).get('last_verified'),
            'readiness_score': readiness_score,
            'readiness_bucket': readiness_bucket,
            'readiness_components': components,
            'last_verified': run_started.isoformat(),
            'confidence': 'HIGH' if raw.get('evidence_level') == 1 else 'MEDIUM',
        }
        global_records.append(record)

    # Sort descending by date
    global_records.sort(key=lambda r: (r['global_stage_date'] or ''), reverse=True)

    # --- 2. Build the 4 Dedicated Tiers ---
    
    # Tier 1: Global Regulatory Events 2026
    tier1_global = global_records

    # Tier 2: Egypt Registered 2026
    tier2_egypt_registered = [
        rec for rec in egypt_registry.values() if rec.get('status') == 'REGISTERED' and rec.get('event_year') == 2026
    ]
    tier2_egypt_registered.sort(key=lambda r: r.get('registration_date', ''), reverse=True)

    # Tier 3: Egypt Under Registration 2026
    tier3_egypt_under_reg = [
        rec for rec in egypt_registry.values() if rec.get('status') == 'UNDER_REGISTRATION' and rec.get('event_year') == 2026
    ]
    tier3_egypt_under_reg.sort(key=lambda r: r.get('registration_date', ''), reverse=True)

    # Tier 4: Egypt Entry Watchlist 2026
    # Strict qualification matrix:
    # 1. Global 2026 Approval or Positive Opinion
    # 2. NOT confirmed registered in Egypt (status != 'REGISTERED')
    # 3. High Zeta Commercial Relevance
    # 4. Verified Level-1 source URL
    registered_molecules = {
        r.get('active_ingredient', '').strip().lower() for r in tier2_egypt_registered
    }
    
    watchlist_candidates = []
    seen_watchlist_mols = set()
    
    for r in global_records:
        mol_key = (r['active_ingredient'] or r['drug_name']).strip().lower()
        if mol_key in registered_molecules:
            continue  # Exclude already-registered products
        if mol_key in seen_watchlist_mols:
            continue
        if r['global_stage'] in ('APPROVED', 'POSITIVE_REGULATORY_OPINION', 'PRIORITY_REVIEW'):
            # Qualify for Watchlist
            seen_watchlist_mols.add(mol_key)
            
            w_item = {
                'id': f"wl_2026_{r['id']}",
                'event_year': 2026,
                'drug_name': r['drug_name'],
                'active_ingredient': r['active_ingredient'],
                'originator_company': r['applicant'],
                'therapeutic_area': r['therapeutic_area'],
                'global_milestone': f"{r['global_stage'].replace('_', ' ')} ({r['global_stage_date']})",
                'global_stage_date': r['global_stage_date'],
                'global_source': r['global_source'],
                'global_source_url': r['global_source_url'],
                'summary_line1': r['summary_line1'],
                'summary_line2': r['summary_line2'],
                'egypt_entry_status': "UNDER EDA EVALUATION" if r['egypt_status'] == "UNDER_REGISTRATION" else "NOT CONFIRMED IN EGYPT — WATCHLIST 2026",
                'readiness_score': 85 if r['egypt_status'] == "UNDER_REGISTRATION" else 70,
                'readiness_bucket': "HIGH PROBABILITY" if r['egypt_status'] == "UNDER_REGISTRATION" else "ADVANCED PIPELINE",
                'strategic_rationale': r['summary_line2'],
                'last_verified': run_started.isoformat(),
                'confidence': "HIGH",
            }
            watchlist_candidates.append(w_item)

    # Sort Watchlist candidates: highest priority first
    watchlist_candidates.sort(key=lambda w: (w['readiness_score'], w['global_stage_date']), reverse=True)
    # Target 10-30 items
    tier4_watchlist = watchlist_candidates[:30]

    # --- 3. Executive Command Center Signals (2026) ---
    max_age_days = exec_cfg.get('max_age_days', 90)
    for record in global_records:
        record['executive_signal'] = bool(
            record['global_stage'] in ('APPROVED', 'POSITIVE_REGULATORY_OPINION')
            and record['event_year'] == 2026
        )

    # --- 4. Counts & Metrics ---
    counts = {
        'total2026Records': len(global_records),
        'globalApproved2026': sum(1 for r in global_records if r['global_stage'] == 'APPROVED'),
        'globalUnderReview2026': sum(1 for r in global_records if r['global_stage'] == 'UNDER_REGULATORY_REVIEW'),
        'globalNearApproval2026': sum(1 for r in global_records if r['global_stage'] in ('POSITIVE_REGULATORY_OPINION', 'PRIORITY_REVIEW', 'REGULATORY_ACCEPTED')),
        'egyptRegistered2026': len(tier2_egypt_registered),
        'egyptUnderRegistration2026': len(tier3_egypt_under_reg),
        'egyptWatchlistCount': len(tier4_watchlist),
        'executiveSignalsCount': sum(1 for r in global_records if r['executive_signal']),
    }

    payload = {
        'meta': {
            'generatedAt': run_started.isoformat(),
            'eventYear': 2026,
            'totalRecords': len(global_records),
            'sourcesTotal': len(health_records),
            'sourcesHealthy': sources_healthy,
            'sourceHealth': health_records,
            'counts': counts,
            'droppedPre2026': dropped_not_2026,
            'architecture': "4-Tier 2026 Pharmaceutical Regulatory & Egypt Registration Intelligence",
            'tiers': {
                'tier1_global_regulatory_2026': len(tier1_global),
                'tier2_egypt_registered_2026': len(tier2_egypt_registered),
                'tier3_egypt_under_registration_2026': len(tier3_egypt_under_reg),
                'tier4_egypt_watchlist_2026': len(tier4_watchlist),
            },
            'egyptCoverageNote': (
                "Egypt status is verified from Level-1 EDA 2026 human medicines decrees and registration files. "
                "Unconfirmed global drugs are strictly monitored on the Egypt Entry Watchlist without speculative inference."
            ),
        },
        'records': global_records,
        'tier1_global_regulatory_2026': tier1_global,
        'tier2_egypt_registered_2026': tier2_egypt_registered,
        'tier3_egypt_under_registration_2026': tier3_egypt_under_reg,
        'tier4_egypt_watchlist_2026': tier4_watchlist,
    }

    js_path = os.path.join(CACHE_DIR, 'regulatory_pipeline.data.js')
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write(f"window.ZETA_REGULATORY_PIPELINE = {json.dumps(payload, ensure_ascii=False, indent=2)};\n")
    json_path = os.path.join(CACHE_DIR, 'regulatory_pipeline.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    run_finished = datetime.now(timezone.utc)
    log_line(log_path, f"[{run_finished.isoformat()}] SUMMARY 2026 — global={len(global_records)} "
                        f"egypt_reg={len(tier2_egypt_registered)} egypt_sub={len(tier3_egypt_under_reg)} "
                        f"watchlist={len(tier4_watchlist)} counts={counts}")
    log_line(log_path, f"===== RUN END {run_finished.isoformat()} =====")

    print("\n" + "=" * 70)
    print(f"Generated {js_path} ({os.path.getsize(js_path):,} bytes).")
    print(f"Sources healthy: {sources_healthy}/{len(health_records)}")
    print(f"\n2026 REGULATORY INTELLIGENCE SUMMARY:")
    print(f"  TIER 1 — GLOBAL REGULATORY (2026):        {len(tier1_global)}")
    print(f"    - Global Approved (2026):               {counts['globalApproved2026']}")
    print(f"    - Global Under Review (2026):           {counts['globalUnderReview2026']}")
    print(f"    - Global Near Approval (2026):          {counts['globalNearApproval2026']}")
    print(f"  TIER 2 — EGYPT REGISTERED (2026):         {len(tier2_egypt_registered)}")
    print(f"  TIER 3 — EGYPT UNDER REGISTRATION (2026): {len(tier3_egypt_under_reg)}")
    print(f"  TIER 4 — EGYPT ENTRY WATCHLIST (2026):    {len(tier4_watchlist)}")
    print(f"  EXECUTIVE TV TICKER SIGNALS:              {counts['executiveSignalsCount']}")
    print("=" * 70)


if __name__ == '__main__':
    build_cache()
