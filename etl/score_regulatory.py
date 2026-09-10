"""
etl/score_regulatory.py
=============================================================================
ZETA PHARMA — GLOBAL & EGYPT NEW DRUG REGISTRATION INTELLIGENCE
Registration Readiness Score (spec section E)
=============================================================================
Every point added is tied to one piece of ACTUAL evidence already present
on the record (a stage the fetcher derived from a real date field, or an
Egypt record with real evidence — never inferred). Overlapping milestones
are deduplicated: a record can only be in ONE terminal/near-terminal
regulatory stage at a time (that's how etl/fetch_regulatory.py derives
`stage` in the first place — strongest evidence wins, so there's no
"submitted AND accepted AND under review" double-count to guard against
here; the dedup guarantee comes from upstream, and this module just
converts the single resolved stage into points, explicitly, per record).

The score is capped at 100 and is always returned with a `components`
list naming exactly which line items fired and why — nothing here is a
black box.
=============================================================================
"""

STAGE_TO_COMPONENT = {
    "REGULATORY_SUBMITTED": ("regulatory_submission", "Regulatory submission evidence on file"),
    "REGULATORY_ACCEPTED": ("regulatory_acceptance", "Regulatory acceptance evidence on file"),
    "PRIORITY_REVIEW": ("priority_review", "Priority review designation evidenced"),
    "UNDER_REGULATORY_REVIEW": ("ema_under_evaluation", "Under active regulatory evaluation (evidenced)"),
    "POSITIVE_REGULATORY_OPINION": ("chmp_positive_opinion", "Positive regulatory opinion adopted (evidenced)"),
    "APPROVED": (None, None),  # already approved -- readiness scoring doesn't apply, see below
    "REJECTED": (None, None),
    "WITHDRAWN": (None, None),
}


def score_regulatory_record(record, weights, egypt_status=None, egypt_evidence=None):
    """Returns (readiness_score:int, bucket_label:str, components:list[dict]).

    `record` must carry `stage` (see etl/fetch_regulatory.py). Terminal
    stages (APPROVED/REJECTED/WITHDRAWN) return a fixed, clearly-labeled
    score rather than a "readiness" number, since readiness-to-register
    is meaningless once a product already has a final outcome.
    """
    stage = record.get("stage")
    components = []

    if stage in ("APPROVED", "REJECTED", "WITHDRAWN"):
        return None, f"{stage.replace('_', ' ')} (terminal — readiness score not applicable)", components

    total = 0
    comp_key, comp_label = STAGE_TO_COMPONENT.get(stage, (None, None))
    if comp_key:
        pts = weights.get(comp_key, 0)
        total += pts
        components.append({"key": comp_key, "points": pts, "reason": comp_label})

    # PDUFA / action date: only if the record actually carries one —
    # neither of the two Phase-1 sources currently supplies this field,
    # so this fires only once a source that does is wired (kept here so
    # the scoring contract is already correct for that future source).
    if record.get("pdufa_or_action_date"):
        pts = weights.get("pdufa_or_action_date", 0)
        total += pts
        components.append({"key": "pdufa_or_action_date", "points": pts, "reason": f"Action date on file: {record['pdufa_or_action_date']}"})

    if record.get("positive_phase_3_evidence"):
        pts = weights.get("positive_phase_3", 0)
        total += pts
        components.append({"key": "positive_phase_3", "points": pts, "reason": "Positive Phase III result evidenced"})

    if record.get("announced_submission_evidence"):
        pts = weights.get("announced_submission", 0)
        total += pts
        components.append({"key": "announced_submission", "points": pts, "reason": "Company-announced regulatory submission plan evidenced"})

    if egypt_status == "UNDER_REGISTRATION" and egypt_evidence:
        pts = weights.get("eda_under_registration_evidence", 0)
        total += pts
        components.append({"key": "eda_under_registration_evidence", "points": pts, "reason": f"EDA under-registration evidence: {egypt_evidence}"})

    total = max(0, min(100, total))
    bucket_label = _bucket_for_score(total, weights.get("_buckets", DEFAULT_BUCKETS))
    return total, bucket_label, components


DEFAULT_BUCKETS = [
    {"min": 90, "max": 100, "label": "IMMINENT"},
    {"min": 75, "max": 89, "label": "HIGH PROBABILITY"},
    {"min": 50, "max": 74, "label": "ADVANCED PIPELINE"},
    {"min": 25, "max": 49, "label": "EARLY/MID PIPELINE"},
    {"min": 0, "max": 24, "label": "EARLY DEVELOPMENT"},
]


def _bucket_for_score(score, buckets):
    for b in buckets:
        if b["min"] <= score <= b["max"]:
            return b["label"]
    return "EARLY DEVELOPMENT"
