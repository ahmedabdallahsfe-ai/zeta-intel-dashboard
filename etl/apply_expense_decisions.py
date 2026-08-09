"""
apply_expense_decisions.py — record signed-off mapping decisions
==============================================================================

Writes Ahmed's Phase A decisions into expense/mapping/expense_sku_map.csv as
reviewed rows. build_expense_foundation.py then preserves them on every later
run, so a regeneration can never quietly undo a human judgement.

WHY A SCRIPT AND NOT A HAND EDIT
------------------------------------------------------------------------------
Hand-editing the CSV would work once. This is reproducible, states who decided
what and when, and — most importantly — REFUSES to apply a decision whose row
no longer matches the source. If a SKU is renamed or its proposed match
changes, the approval must be re-confirmed rather than silently carried over
onto data the approver never saw.

Approving a mapping is a financial control. It has to be re-earned when the
thing it describes changes.

DECISIONS RECORDED (Ahmed, 2026-08-09)
------------------------------------------------------------------------------
APPROVED as MATCHED — whitespace normalisation only:
    COXORIZET 60 MG 20 TAB            -> COXORIZET 60MG 20 TAB
    EMPACOZA 25 MG 30 TAB             -> EMPACOZA 25MG 30 TAB
    NEXICURE PLUS 40/1100 MG 14 CAP   -> NEXICURE PLUS 40 /1100 MG 14 CAP

CONFIRMED UNMAPPED — explicitly NOT mapped to a similar-looking SKU:
    NEXICURE PLUS 40/1680 MG 14 SACHETS
        Not assumed to be NEXICURE PLUS 40 MG 14 SACHETS. The sales cube has
        no product carrying the 40/1680 combination strength.
    EPILOSAMIDE 5 MG/1 ML SYRUP
        Not mapped to EPILOSAMIDE 100 MG 30 TAB. Different dosage form.

Recording these as REVIEWED matters as much as the approvals: it stops the ETL
re-proposing them every run, and it distinguishes "a person looked and said no"
from "nobody has looked yet".
"""

import os
import csv
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP_CSV = os.path.join(ROOT_DIR, 'expense', 'mapping', 'expense_sku_map.csv')

REVIEWER = 'Ahmed'
PROPOSER = 'Claude (awaiting Ahmed ratification)'
REVIEW_DATE = '2026-08-09'

# -----------------------------------------------------------------------------
# RATIFIED BY AHMED, 2026-08-09
#
# Only SKUs named here move from PROPOSED to YES. Everything else stays a
# proposal no matter how well evidenced it is.
#
# NOTE ON THE THIRD APPROVAL -- RESOLVED 2026-08-09.
# Ahmed's first approval described the third MATCHED mapping as "the third
# clearly evidenced EMPACOZA TRIO mapping". There is no third EMPACOZA TRIO --
# the review found exactly two, and the third MATCHED item was
# ZETAKARDOVAL HCT 10/160/12.5 MG 30 TAB.
#
# It was held as PROPOSED rather than inferred, and Ahmed then confirmed
# ZETAKARDOVAL by name. Worth keeping the record: the hold cost one round trip
# and caught a product name that would otherwise have entered a financial
# mapping on an assumption.
# -----------------------------------------------------------------------------
RATIFIED_BY_AHMED = {
    # batch 1 -- approved 2026-08-09, unchanged
    'COXORIZET 60 MG 20 TAB',
    'EMPACOZA 25 MG 30 TAB',
    'NEXICURE PLUS 40/1100 MG 14 CAP',
    'NEXICURE PLUS 40/1680 MG 14 SACHETS',
    'EPILOSAMIDE 5 MG/1 ML SYRUP',
    # batch 2 -- ratified in Ahmed's 2026-08-09 decision message
    'EMPACOZA TRIO 25/5/1000 MG 30 TAB',
    'EMPACOZA TRIO 10/5/1000 MG 30 TAB',
    'NEXIROZOVA 5 MG 28 TAB',      # "Keep -> NOT_YET_SELLING"
    'ZETAZOLEX 0.25 MG 30 TAB',    # "Keep -> NOT_YET_SELLING"
    # confirmed by name in Ahmed's follow-up, 2026-08-09:
    'ZETAKARDOVAL HCT 10/160/12.5 MG 30 TAB',
    # held as PROPOSED at Ahmed's explicit instruction -- NOT authorised to map
    # until the product master confirms the strength:
    #   DOZOVA NAD 300 MG 30 CAP
    #   DOZOVA Q10 COENZYME 200 MG 30 CAP
}

# (ExpenseSKU, expected ProposedSalesProduct, new status, note)
# The expected proposal is part of the key: if the ETL now proposes something
# different, this approval no longer describes reality and must not apply.
DECISIONS = [
    ('COXORIZET 60 MG 20 TAB', 'COXORIZET 60MG 20 TAB', 'MATCHED',
     'Approved %s: whitespace only (60 MG vs 60MG). Same brand, strength, pack, form.' % REVIEW_DATE),
    ('EMPACOZA 25 MG 30 TAB', 'EMPACOZA 25MG 30 TAB', 'MATCHED',
     'Approved %s: whitespace only (25 MG vs 25MG). Same brand, strength, pack, form.' % REVIEW_DATE),
    ('NEXICURE PLUS 40/1100 MG 14 CAP', 'NEXICURE PLUS 40 /1100 MG 14 CAP', 'MATCHED',
     'Approved %s: whitespace only (40/1100 vs 40 /1100). Same brand, strength, pack, form.' % REVIEW_DATE),

    ('NEXICURE PLUS 40/1680 MG 14 SACHETS', '', 'UNMAPPED',
     'Confirmed UNMAPPED %s. NOT assumed equal to NEXICURE PLUS 40 MG 14 SACHETS - '
     'no sales product carries the 40/1680 combination strength.' % REVIEW_DATE),
    ('EPILOSAMIDE 5 MG/1 ML SYRUP', '', 'UNMAPPED',
     'Confirmed UNMAPPED %s. NOT mapped to EPILOSAMIDE 100 MG 30 TAB - '
     'different dosage form (syrup vs tablet).' % REVIEW_DATE),

    # -------------------------------------------------------------------------
    # BATCH 2 (2026-08-09): the seven ACTIVE / NOT_YET_SELLING SKUs.
    #
    # Classified by Claude from sales-cube evidence, at Ahmed's instruction, and
    # recorded for his ratification. Every one is listed with the evidence in
    # the Phase A report; nothing here was fuzzy-matched.
    #
    # The three MATCHED share one pattern: the expense sheet writes the unit
    # word "MG" after a multi-part strength, the sales cube omits it. In each
    # case exactly ONE sales product carries that strength AND that pack size,
    # so there is no second candidate to be wrong about.
    #
    # The two UNMAPPED share the opposite pattern: the expense sheet states a
    # strength the sales name does not carry at all. A single plausible
    # candidate exists, but "plausible" is not "demonstrable" -- the strength
    # cannot be verified from the data, so they are NOT mapped.
    # -------------------------------------------------------------------------
    ('EMPACOZA TRIO 25/5/1000 MG 30 TAB', '', 'MATCHED',
     'Classified %s: EMPACOZA TRIO 25/5/1000 30 TAB (196,395,664 EGP). Differs only '
     'by the unit word "MG". Unique product at strength 25/5/1000 in a 30 TAB pack.' % REVIEW_DATE,
     'EMPACOZA TRIO 25/5/1000 30 TAB'),
    ('EMPACOZA TRIO 10/5/1000 MG 30 TAB', '', 'MATCHED',
     'Classified %s: EMPACOZA TRIO 10/5/1000 30 TAB (72,344,292 EGP). Differs only '
     'by the unit word "MG". Unique product at strength 10/5/1000 in a 30 TAB pack.' % REVIEW_DATE,
     'EMPACOZA TRIO 10/5/1000 30 TAB'),
    ('ZETAKARDOVAL HCT 10/160/12.5 MG 30 TAB', '', 'MATCHED',
     'Classified %s: ZETAKARDOVAL HCT 10/160/12.5 30 TAB (701,994 EGP). Differs only '
     'by the unit word "MG". Only HCT presentation in the cube.' % REVIEW_DATE,
     'ZETAKARDOVAL HCT 10/160/12.5 30 TAB'),

    ('DOZOVA NAD 300 MG 30 CAP', '', 'UNMAPPED',
     'Classified %s: NOT mapped. Sales has DOZOVA NAD 30 CAP and DOZOVA NAD 60 CAP, '
     'neither carrying a strength. The 300 MG cannot be verified, so a match is '
     'plausible but not demonstrable. Needs product confirmation.' % REVIEW_DATE),
    ('DOZOVA Q10 COENZYME 200 MG 30 CAP', '', 'UNMAPPED',
     'Classified %s: NOT mapped. Sales has DOZOVA Q10 COENZYME 30 CAP with no '
     'strength stated. The 200 MG cannot be verified. Needs product confirmation.' % REVIEW_DATE),

    ('NEXIROZOVA 5 MG 28 TAB', '', 'NOT_YET_SELLING',
     'Classified %s: no sales record for this strength/pack. Sales has NEXIROZOVA '
     '5 MG 14 TAB, and 28 TAB packs at 10 MG and 20 MG - but no 5 MG 28 TAB. '
     'Measurement status only; cause not determinable from the data.' % REVIEW_DATE),
    ('ZETAZOLEX 0.25 MG 30 TAB', '', 'NOT_YET_SELLING',
     'Classified %s: no sales record for this strength. Sales has ZETAZOLEX at '
     '1 MG, 2 MG and 4 MG in 30 TAB packs - no 0.25 MG. Measurement status only; '
     'cause not determinable from the data.' % REVIEW_DATE),
]


def main():
    if not os.path.exists(MAP_CSV):
        print('ERROR: %s not found. Run build_expense_foundation.py first.' % MAP_CSV)
        return 1

    with open(MAP_CSV, 'r', encoding='utf-8-sig', newline='') as fh:
        reader = csv.DictReader(fh)
        header = reader.fieldnames
        rows = list(reader)

    applied, skipped, missing = [], [], []

    for decision in DECISIONS:
        # A 5th element sets ProposedSalesProduct explicitly. Needed where the
        # ETL proposed nothing but a human identified the counterpart, so the
        # mapping records WHICH sales product the budget joins to -- a MATCHED
        # status with no product named would be an unusable approval.
        sku, expected_proposal, new_status, note = decision[:4]
        set_product = decision[4] if len(decision) > 4 else None

        hits = [r for r in rows if r['ExpenseSKU'] == sku]
        if not hits:
            missing.append((sku, 'no row with this ExpenseSKU'))
            continue
        for r in hits:
            actual = (r.get('ProposedSalesProduct') or '').strip()
            # Idempotence: once this script has written set_product into the
            # row, a re-run sees its own value rather than the ETL's original
            # proposal. That is not the row changing underneath the approval,
            # so accept it. Any OTHER value still trips the guard.
            ok = (actual == expected_proposal) or (set_product and actual == set_product)
            if not ok:
                skipped.append((sku, 'proposal changed: expected "%s", found "%s"'
                                % (expected_proposal, actual)))
                continue
            if set_product:
                r['ProposedSalesProduct'] = set_product
            r['MappingStatus'] = new_status
            r['MappingReason'] = note
            # Attribution is not cosmetic. A row carries Ahmed's name only if
            # he named that SKU. Everything else carries mine and stays a
            # proposal. Marking my own classification as his approval would
            # fabricate a financial control.
            ratified = sku in RATIFIED_BY_AHMED
            r['Reviewed'] = 'YES' if ratified else 'PROPOSED'
            r['ReviewedBy'] = REVIEWER if ratified else PROPOSER
            r['ReviewNote'] = note
            applied.append((sku, new_status, float(r.get('BudgetTotal') or 0),
                            'RATIFIED' if ratified else 'proposed'))

    with open(MAP_CSV, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=header)
        w.writeheader()
        for r in rows:
            w.writerow(r)

    print('DECISIONS APPLIED  (%s)' % REVIEW_DATE)
    print('=' * 72)
    for sku, st, bud, who in applied:
        print('  %-38s -> %-16s %12s EGP  %s'
              % (sku[:38], st, '{:,.0f}'.format(bud), who))
    print('  %d row(s) recorded as reviewed' % len(applied))
    if skipped:
        print('\n  NOT APPLIED - the row no longer matches the approval:')
        for sku, why in skipped:
            print('    %s\n       %s' % (sku, why))
    if missing:
        print('\n  NOT FOUND in the mapping table:')
        for sku, why in missing:
            print('    %s  (%s)' % (sku, why))
    print('=' * 72)
    print('Re-run build_expense_foundation.py to refresh the coverage figures.')
    return 0 if not (skipped or missing) else 1


if __name__ == '__main__':
    sys.exit(main())
