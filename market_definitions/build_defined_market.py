"""Defined-market workbooks for new Zeta products (2026-10-21).

Reads the dashboard caches read-only:
  cache/iqvia.json        (Market Intelligence: IQVIA monthly, LC value + standard units)
  cache/market_intel.json (Total Market Intelligence: IMS calendar years, value + units)
and writes market_definitions/<Product>_Defined_Market_<date>.xlsx with
Summary / IQVIA input / Total MI input / Mapping to apply / Notes.

Usage:  python market_definitions/build_defined_market.py [dovoza|dozova_bcomplex|all]
Each product is one entry in PRODUCTS below (search rule, sub-markets, defaults).
"""
import json,base64,gzip,zlib,re,collections,os,sys
from openpyxl import Workbook
from openpyxl.styles import Font,PatternFill,Alignment,Border,Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter as CL
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATE='2026-10-21'
INJ=re.compile(r'AMPOU|VIAL|INJECT|INFUS|SYRING|PARENT',re.I)
def parts(m): return [x.strip().upper() for x in re.split(r'\s*\|\s*|\s*\+\s*|\s*,\s*',m) if x.strip() and x.strip().upper()!='(NONE)']

# ---------------- product 1: Dovoza Thiomax Plus (ALA + benfotiamine) ----------------
ALIAS={'ALPHA-LIPOIC ACID':'THIOCTIC ACID','ALPHA LIPOIC ACID':'THIOCTIC ACID','PURE ALPHA LIPOIC ACID 600MG':'THIOCTIC ACID','ALPHA-LIPOIC ACID 600MG':'THIOCTIC ACID',
 'B6':'PYRIDOXINE','VITAMIN B6':'PYRIDOXINE','PYRIDOXAL 5-PHOSPHATE':'PYRIDOXINE','B12':'B12','CYANOCOBALAMIN':'B12','MECOBALAMIN':'B12','METHYLCOBALAMIN B12':'B12','METHYLCOBALAMIN':'B12','B1':'THIAMINE'}
def dov_acts(m): return {ALIAS.get(x,x) for x in parts(m)}
DOV={'THIOCTIC ACID','BENFOTIAMINE','PYRIDOXINE','B12','COLECALCIFEROL'}
DOV_SEGS=['Same 5 actives (Dovoza profile)','Other ALA + benfotiamine','ALA without benfotiamine','Benfotiamine without ALA']
DOV_PAT=re.compile(r'THIOCTIC|LIPOIC|BENFOTIAMIN',re.I)
def dov_seg(m,atc):
    if not DOV_PAT.search(m): return None
    a=dov_acts(m); A='THIOCTIC ACID' in a; Bf='BENFOTIAMINE' in a
    if A and Bf: return (DOV_SEGS[0] if a==DOV else DOV_SEGS[1]),'Y',a==DOV
    if A: return DOV_SEGS[2],'N',False
    return DOV_SEGS[3],'N',False

# ---------------- product 2: Dozova Liposomal B-Complex ----------------
BV={'B1':['THIAMINE','BENFOTIAMINE','B1'],'B2':['RIBOFLAVIN','FLAVIN MONONUCLEOTIDE','B2'],'B3':['NICOTINAMIDE','NICOTINIC ACID','NIACIN','B3'],'B5':['PANTOTHEN','PANTHENOL','B5'],
    'B6':['PYRIDOX','B6'],'B12':['COBALAMIN','B12'],'B7':['BIOTIN'],'B9':['FOLIC','FOLATE','METHYLFOLATE','LEVOMEFOLIC','FOLINIC']}
FREE=['CHOLINE','INOSITOL','AMINOBENZOIC']
def bx(m):
    bs=set(); other=[]
    for p in parts(m):
        if 'B-COMPLEX' in p or 'B COMPLEX' in p: bs.update(['B1','B2','B3','B5','B6','B12']); continue
        hit=[k for k,v in BV.items() if any(w in p for w in v)]
        if hit: bs.update(hit)
        elif not any(w in p for w in FREE): other.append(p)
    return bs,other
BX_SEGS=['Full B-complex, 6-8 B vitamins (Dozova profile)','B-complex, 5 B vitamins','Neurotropic B (B1 / B6 / B12, 2-4 B vitamins)','B-complex + other actives (5+ B, vitamin-B classes)']
def bx_seg(m,atc):
    bs,oth=bx(m); nb=len(bs); full=nb==8
    if not oth:
        if nb>=6: return BX_SEGS[0],'Y',full
        if nb==5: return BX_SEGS[1],'Y',full
        # 2026-10-21 (Ahmed: "Milga and Milga Advance why excluded" -> include): neurotropic B in the market by default;
        # 2 B vitamins count when they are B1 + B6 / B12 (e.g. MILGA ADVANCE = benfotiamine + thiamine + B12)
        if nb>=3 or (nb==2 and 'B1' in bs and ('B6' in bs or 'B12' in bs)): return BX_SEGS[2],'Y',False
        return None
    if nb>=5 and re.match(r'A11[DEX]',atc or ''): return BX_SEGS[3],'N',full
    return None

PRODUCTS={
 'dovoza':dict(name='Dovoza Thiomax Plus',file='Dovoza_Thiomax_Plus_Defined_Market_%s.xlsx'%DATE,seg=dov_seg,segs=DOV_SEGS,by_form=False,oral_only=False,
   form_txt='Film-coated tablet',main='alpha lipoic acid + benfotiamine',exact_label='Same 5 actives as Dovoza',
   comp=[('Alpha lipoic acid (thioctic acid)','600 mg'),('Benfotiamine','150 mg'),('Pyridoxine HCl (= vitamin B6 25 mg)','30.388 mg'),('Cholecalciferol (vitamin D3)','1000 IU'),('Methylcobalamin (vitamin B12)','1000 mcg')],
   setup=[('Defined market (DM1) name','ALA_BENFOTIAMINE_MKT'),('Sub-market 1 (DM2) — same 5 actives','ALA_BENFO_B6_B12_D3'),('Sub-market 2 (DM2) — other ALA + benfotiamine','ALA_BENFO_OTHER'),('Line','CHC'),('BU','CHC')],dm2_of_seg=[1,2,2,2],line_ix=3,off_segs=[2,3],
   rec=['1. Defined market (DM1) = all alpha lipoic acid + benfotiamine combinations: the products doctors and pharmacists treat as substitutes for Dovoza Thiomax Plus, led by THIOTACID COMPOUND (EVA).',
        '2. Sub-market 1 = the same 5 actives (ALA + benfotiamine + B6 + B12 + D3): the direct head-to-head competitors (CORVIBEAK, AXOMYELIN ULTRA, CENTRONERVE, PREDABURE, BLINGA-D). Sub-market 2 = the other ALA + benfotiamine combinations.',
        '3. Size the market and set the launch target on Total Market Intelligence (it includes CORVIBEAK and CENTRONERVE, which IQVIA monthly does not capture); track the monthly trend and share on Market Intelligence (IQVIA).',
        '4. Plain ALA (THIOTACID, ALPHAVIM, DOZOVA A-L A ...) and benfotiamine without ALA (MILGA ...) are out by default: set them to Y on the input sheets to test a wider definition.'],
   rules=[('Search','Every product whose molecule list contains thioctic / alpha lipoic acid or benfotiamine. Spelling variants (alpha-lipoic acid, B6, B12, methylcobalamin, pyridoxal 5-phosphate) count as the same active.'),
          ('Same 5 actives','Alpha lipoic acid + benfotiamine + vitamin B6 (any form) + vitamin B12 (any form) + vitamin D3, and nothing else.'),
          ('Defaults','Include = Y for every ALA + benfotiamine product; N for ALA alone and benfotiamine alone.')]),
 'dozova_bcomplex':dict(name='Dozova Liposomal B-Complex',file='Dozova_Liposomal_B-Complex_Defined_Market_%s.xlsx'%DATE,seg=bx_seg,segs=BX_SEGS,by_form=True,oral_only=True,
   form_txt='Hard gelatin capsule',main='a full B-complex (B1, B2, B3, B5, B6, B12, biotin, folate) + choline + inositol, liposomal',exact_label='All 8 B vitamins',
   comp=[('Liposomal nicotinamide (vitamin B3)','150 mg'),('Thiamine HCl (vitamin B1)','100 mg'),('D-calcium pantothenate (vitamin B5)','110 mg'),('Liposomal myo-inositol','50 mg'),('Liposomal choline citrate (choline)','50 mg'),
         ('Liposomal pyridoxine HCl (vitamin B6)','10 mg'),('Riboflavin (vitamin B2)','10 mg'),('Liposomal methylcobalamin (vitamin B12)','500 mcg'),('Liposomal D-biotin','500 mcg'),('L-5-methyltetrahydrofolate calcium (folate)','400 mcg DFE')],
   setup=[('Defined market (DM1) name','B_VITAMINS_ORAL_MKT'),('Sub-market 1 (DM2) — full B-complex (6-8 B)','B_COMPLEX_FULL'),('Sub-market 2 (DM2) — B-complex 5 B','B_COMPLEX_5B'),('Sub-market 3 (DM2) — neurotropic B (B1/B6/B12)','NEUROTROPIC_B'),('Line','CHC'),('BU','CHC')],dm2_of_seg=[1,2,3,2],line_ix=4,off_segs=[3],
   rec=['1. Defined market (DM1) = oral products made only of B vitamins: B-complex (5+ of B1, B2, B3, B5, B6, B12, biotin, folate; choline / inositol allowed) plus neurotropic B (B1 / B6 / B12: MILGA, MILGA ADVANCE, NEUROVIT ...), because Dozova carries high-dose B1 (100 mg) and B12 (500 mcg) and competes with both on the shelf and with doctors.',
        '2. Sub-market 1 = full B-complex (6-8 B vitamins, incl. "vitamin B complex" products such as LIPOSOM-B): the direct competitors of an 8-B liposomal formula. Sub-market 2 = 5-B products (LIMITLESS B COMPLEX, NEUROTON tablets ...). Sub-market 3 = neurotropic B (MILGA, MILGA ADVANCE, NEUROVIT ...): the big, neuropathy-led segment.',
        '3. Injectables (BECOZYME, NEUROTON and NEUROVIT ampoules ...) and B-complex products with other actives (OMNEVORA, LIVABION ...) are out by default. Set them to Y to test a wider definition; set sub-market 3 to N for a pure B-complex market.',
        '4. Size the market on Total Market Intelligence %s and track it monthly on Market Intelligence (IQVIA). Bold rows have all 8 B vitamins, like Dozova.'%'2025'],
   rules=[('Search','Products made of 3 or more B vitamins and nothing else (choline, inositol and PABA allowed), plus products with 5 or more B vitamins and other actives when they sit in the vitamin-B ATC4 classes A11D / A11E / A11X (to leave out multivitamins and iron combinations). "Vitamin B complex" counts as B1+B2+B3+B5+B6+B12.'),
          ('B vitamins','B1 thiamine / benfotiamine; B2 riboflavin; B3 nicotinamide / nicotinic acid; B5 pantothenate / panthenol; B6 pyridoxine / pyridoxal phosphate; B12 any cobalamin; B7 biotin; B9 folic acid / methylfolate.'),
          ('Forms','One row per product and dosage form. Injectable forms (ampoule, vial ...) are N by default: Dozova is an oral capsule.'),
          ('Neurotropic B','B-only products with 3-4 B vitamins, or 2 B vitamins when they are B1 + B6 / B12 (benfotiamine and thiamine both count as B1, so MILGA ADVANCE = B1 + B12).'),
          ('Defaults','Include = Y for oral B-only products (full B-complex, 5-B and neurotropic B); N for B-complex with other actives and for injectables.')]),
}

def extract(segf,by_form):
    d=json.load(open(os.path.join(ROOT,'cache','iqvia.json'))); L=d['lookups']; raw=base64.b64decode(d['b64Data'])
    try: s=gzip.decompress(raw)
    except Exception: s=zlib.decompress(raw)
    f=json.loads(s); mol=L['molecules']; P=L['periods']; NP=len(P)
    lp=P[-1]; ly=int(lp[:4]); lm=int(lp[5:7])
    def bucket(idx,p):
        y=int(p[:4]); m=int(p[5:7]); b=[]
        if idx>=NP-12: b.append('mat')
        elif idx>=NP-24: b.append('pmat')
        if y==ly and m<=lm: b.append('ytd')
        if y==ly-1 and m<=lm: b.append('pytd')
        if y==ly-1: b.append('fy1')
        if y==ly-2: b.append('fy2')
        return b
    BK=[bucket(i,p) for i,p in enumerate(P)]; cache={}
    def ok(mi,ai):
        k=(mi,ai)
        if k not in cache: cache[k]=segf(mol[mi],L['atc4s'][ai]) is not None
        return cache[k]
    R={}
    for i in range(0,len(f),14):
        if not ok(f[i+10],f[i+3]): continue
        dose=L['doses'][f[i+11]] if by_form else ''
        k=(f[i+10],f[i+1],f[i],dose); r=R.get(k)
        if r is None: r=R[k]={'mol':mol[f[i+10]],'prod':L['prods'][f[i+1]],'corp':L['corps'][f[i]],'atc':collections.Counter(),'dose':set(),'dm1':collections.Counter(),'line':collections.Counter(),'bu':collections.Counter(),'v':collections.defaultdict(float),'u':collections.defaultdict(float)}
        r['atc'][L['atc4s'][f[i+3]]]+=f[i+6]; r['dose'].add(L['doses'][f[i+11]]); r['dm1'][L['dm1s'][f[i+4]]]+=1; r['line'][L['lines'][f[i+8]]]+=1; r['bu'][L['bus'][f[i+9]]]+=1
        for b in BK[f[i+2]]: r['v'][b]+=f[i+6]; r['u'][b]+=f[i+7]
    iq=[{'mol':r['mol'],'prod':r['prod'],'corp':r['corp'],'atc':' / '.join(sorted(r['atc'])),'atc1':r['atc'].most_common(1)[0][0],'dose':' / '.join(sorted(r['dose'])),'dm1':r['dm1'].most_common(1)[0][0],'line':r['line'].most_common(1)[0][0],'bu':r['bu'].most_common(1)[0][0],'v':r['v'],'u':r['u']} for r in R.values()]
    d2=json.load(open(os.path.join(ROOT,'cache','market_intel.json'))); L2=d2['lookups']; a=d2['annual']; RR=a['rows']; U=a['units']; V=a['value']
    mol2=L2['molecules']; cache2={}
    def nm(m): return ' + '.join(sorted(set(x.strip().upper() for x in re.split(r'[+,]',m) if x.strip())))
    T={}
    for n in range(len(V)):
        r=RR[n*10:(n+1)*10]; k2=(r[4],r[2])
        if k2 not in cache2: cache2[k2]=segf(mol2[r[4]],L2['atc4s'][r[2]]) is not None
        if not cache2[k2]: continue
        br=L2['brands'][r[6]]; corp=L2['corps'][r[3]]; mm=nm(mol2[r[4]]); y=str(L2['years'][r[0]]); form=L2['forms'][r[7]] if by_form else ''
        k=(br,corp,mm,form); t=T.get(k)
        if t is None: t=T[k]={'brand':br,'corp':corp,'mol':mm,'atc':collections.Counter(),'ta':set(),'packs':set(),'form':set(),'v':collections.defaultdict(float),'u':collections.defaultdict(float),'launch':r[8]}
        t['atc'][L2['atc4s'][r[2]]]+=V[n]+1e-9; t['ta'].add(L2['tas'][r[1]]); t['packs'].add(L2['products'][r[5]]); t['form'].add(L2['forms'][r[7]])
        t['v'][y]+=V[n]; t['u'][y]+=U[n]
    tm=[{'brand':t['brand'],'corp':t['corp'],'mol':t['mol'],'atc':' / '.join(sorted(t['atc'])),'atc1':t['atc'].most_common(1)[0][0],'ta':' / '.join(sorted(t['ta'])),'form':' / '.join(sorted(t['form'])),'packs':' | '.join(sorted(t['packs'])),'launch':t['launch'],'v':t['v'],'u':t['u']} for t in T.values()]
    return {'period':lp,'iq':iq,'tm':tm,'years':L2['years']}

NAVY='0F4C81'; INF='FFF2CC'; INFont='1D4ED8'
fill=lambda c:PatternFill('solid',fgColor=c); thin=Side(style='thin',color='CBD5E1'); B=Border(top=thin,bottom=thin,left=thin,right=thin)
N='#,##0'; G='+0.0%;[Red]-0.0%;0.0%'; P2='0.0%'
def hdr(ws,row,heads,widths=None,color=NAVY):
    for i,h in enumerate(heads,1):
        c=ws.cell(row,i,h); c.font=Font(bold=True,color='FFFFFF',size=10); c.fill=fill(color); c.alignment=Alignment(wrap_text=True,vertical='center',horizontal='center'); c.border=B
    ws.row_dimensions[row].height=42
    if widths:
        for i,w in enumerate(widths,1): ws.column_dimensions[CL(i)].width=w
def inp(c,fmt=None):
    o=Side(style='thin',color='B45309'); c.fill=fill(INF); c.font=Font(bold=True,color=INFont); c.border=Border(top=o,bottom=o,left=o,right=o)
    if fmt: c.number_format=fmt

def build(key):
    C=PRODUCTS[key]; SEGS=C['segs']; segf=C['seg']; name=C['name']
    D=extract(segf,C['by_form']); per=D['period']; py=int(per[:4])
    def classify(m,atc,form):
        sg,inc,ex=segf(m,atc)
        if C['oral_only'] and form and INJ.search(form): inc='N'
        return sg,inc,ex
    wb=Workbook(); S=wb.active; S.title='Summary'
    # ---------- IQVIA input ----------
    I=wb.create_sheet('IQVIA input')
    ih=['Include in market (Y/N) — INPUT','Sub-market — INPUT','Product','Corporation','Molecules (IQVIA)','No. of actives',C['exact_label'],'ATC4','Dosage form','Current IQVIA DM1','Current Line','Current BU',
        'MAT %s value (EGP)'%per,'Prior MAT value (EGP)','Value growth','Share of defined market (value)','MAT SU','Prior MAT SU','SU growth','YTD %d value (EGP)'%py,'YTD %d value (EGP)'%(py-1),'FY %d value (EGP)'%(py-1),'FY %d value (EGP)'%(py-2)]
    hdr(I,4,ih,[12,34,26,26,60,8,10,26,20,22,12,12,15,15,10,11,13,13,10,14,14,14,14])
    I['A1']='%s — candidate products from Market Intelligence (IQVIA monthly, MAT to %s)'%(name,per); I['A1'].font=Font(bold=True,size=14,color=NAVY)
    I['A2']='Type Y / N in column A to keep or drop a product and pick its sub-market in column B (yellow cells). The Summary and "Mapping to apply" follow.'; I['A2'].font=Font(size=9,color='64748B')
    rows=[]
    for r in D['iq']:
        sg,inc,ex=classify(r['mol'],r['atc1'],r['dose'] if C['by_form'] else '')
        if (r['v'].get('mat',0) or 0)<=0 and (r['v'].get('pmat',0) or 0)<=0: continue
        rows.append((inc,sg,r,ex))
    rows.sort(key=lambda x:(x[0]!='Y',SEGS.index(x[1]),-(x[2]['v'].get('mat',0) or 0)))
    r0=5; rn=r0+len(rows)-1
    for k,(inc,sg,r,ex) in enumerate(rows):
        i=r0+k; v=r['v']; u=r['u']
        vals=[inc,sg,r['prod'],r['corp'],r['mol'].replace(' | ',' + '),len(parts(r['mol'])),'Yes' if ex else '',r['atc'],r['dose'],r['dm1'],r['line'],r['bu'],
              v.get('mat',0),v.get('pmat',0),None,None,u.get('mat',0),u.get('pmat',0),None,v.get('ytd',0),v.get('pytd',0),v.get('fy1',0),v.get('fy2',0)]
        for j,x in enumerate(vals,1):
            c=I.cell(i,j,x); c.border=B; c.font=Font(size=10)
        I.cell(i,15).value='=IFERROR(M%d/N%d-1,"new")'%(i,i); I.cell(i,19).value='=IFERROR(Q%d/R%d-1,"new")'%(i,i)
        I.cell(i,16).value='=IF(A%d="Y",IFERROR(M%d/SUMIFS($M$%d:$M$%d,$A$%d:$A$%d,"Y"),""),"")'%(i,i,r0,rn,r0,rn)
        inp(I.cell(i,1)); inp(I.cell(i,2))
        for j in (13,14,17,18,20,21,22,23): I.cell(i,j).number_format=N
        for j in (15,19): I.cell(i,j).number_format=G
        I.cell(i,16).number_format=P2
        if ex:
            for j in (3,5,7): I.cell(i,j).font=Font(size=10,bold=True,color='7C2D12')
    dvY=DataValidation(type='list',formula1='"Y,N"',allow_blank=False); dvS=DataValidation(type='list',formula1='"%s"'%','.join(SEGS),allow_blank=False)
    I.add_data_validation(dvY); I.add_data_validation(dvS); dvY.add('A%d:A%d'%(r0,rn)); dvS.add('B%d:B%d'%(r0,rn))
    I.freeze_panes='D5'; I.auto_filter.ref='A4:%s%d'%(CL(len(ih)),rn)
    IQ=(r0,rn)
    # ---------- Total MI input ----------
    T=wb.create_sheet('Total MI input')
    yrs=[str(y) for y in D['years']]; full=yrs[:-1]; part=yrs[-1]; nf=len(full)
    th=['Include in market (Y/N) — INPUT','Sub-market — INPUT','Brand','Corporation','Molecules (IMS)',C['exact_label'],'ATC4','Therapy area','Packs','Launch year']+['Value %s (EGP)'%y for y in full]+['Growth %s vs %s'%(full[-1],full[-2]),'Share of defined market %s'%full[-1],'Units %s'%full[-1],'Units %s'%full[-2],'Value %s Jan-Apr (check)'%part,'Form']
    hdr(T,4,th,[12,34,26,24,60,10,26,18,40,9]+[14]*nf+[11,11,12,12,14,16])
    T['A1']='%s — candidate brands from Total Market Intelligence (IMS 2022 to April 2026, calendar years)'%name; T['A1'].font=Font(bold=True,size=14,color=NAVY)
    T['A2']='Type Y / N in column A and pick the sub-market in column B (yellow cells). %s is Jan-Apr only and some %s values look inconsistent, so the market is sized on %s.'%(part,part,full[-1]); T['A2'].font=Font(size=9,color='64748B')
    tr=[]
    for r in D['tm']:
        sg,inc,ex=classify(r['mol'],r['atc1'],r['form'] if C['by_form'] else '')
        if sum((r['v'].get(y,0) or 0) for y in yrs)<=0: continue
        tr.append((inc,sg,r,ex))
    tr.sort(key=lambda x:(x[0]!='Y',SEGS.index(x[1]),-(x[2]['v'].get(full[-1],0) or 0)))
    t0=5; tn=t0+len(tr)-1; cV=11; cG=cV+nf; cSh=cG+1; cU=cSh+1; cU2=cU+1; cP=cU2+1
    VA=CL(cV+nf-1); VB=CL(cV+nf-2)
    for k,(inc,sg,r,ex) in enumerate(tr):
        i=t0+k; v=r['v']; u=r['u']
        vals=[inc,sg,r['brand'],r['corp'],r['mol'],'Yes' if ex else '',r['atc'],r['ta'],r['packs'],r['launch']]+[v.get(y,0) for y in full]+[None,None,u.get(full[-1],0),u.get(full[-2],0),v.get(part,0),r['form']]
        for j,x in enumerate(vals,1):
            c=T.cell(i,j,x); c.border=B; c.font=Font(size=10)
        T.cell(i,cG).value='=IFERROR(%s%d/%s%d-1,"new")'%(VA,i,VB,i); T.cell(i,cG).number_format=G
        T.cell(i,cSh).value='=IF(A%d="Y",IFERROR(%s%d/SUMIFS($%s$%d:$%s$%d,$A$%d:$A$%d,"Y"),""),"")'%(i,VA,i,VA,t0,VA,tn,t0,tn); T.cell(i,cSh).number_format=P2
        for j in list(range(cV,cV+nf))+[cU,cU2,cP]: T.cell(i,j).number_format=N
        inp(T.cell(i,1)); inp(T.cell(i,2))
        if ex:
            for j in (3,5,6): T.cell(i,j).font=Font(size=10,bold=True,color='7C2D12')
    dvY2=DataValidation(type='list',formula1='"Y,N"'); dvS2=DataValidation(type='list',formula1='"%s"'%','.join(SEGS))
    T.add_data_validation(dvY2); T.add_data_validation(dvS2); dvY2.add('A%d:A%d'%(t0,tn)); dvS2.add('B%d:B%d'%(t0,tn))
    T.freeze_panes='D5'; T.auto_filter.ref='A4:%s%d'%(CL(len(th)),tn)
    # ---------- Summary ----------
    for i,w in enumerate([50,18,40,16,16,16,12,12,10],1): S.column_dimensions[CL(i)].width=w
    S['A1']='%s — defined market analysis'%name; S['A1'].font=Font(bold=True,size=18,color='FFFFFF')
    for c in 'ABCDEFGHI': S[c+'1'].fill=fill(NAVY)
    S.row_dimensions[1].height=30
    S['A2']='%s. Main actives: %s. Sources: Market Intelligence (IQVIA monthly, MAT to %s) and Total Market Intelligence (IMS calendar years). Every market number below is a formula on the Y/N and sub-market choices of the two input sheets.'%(C['form_txt'],C['main'],per)
    S['A2'].alignment=Alignment(wrap_text=True,vertical='top'); S.merge_cells('A2:I2'); S.row_dimensions[2].height=44; S['A2'].font=Font(size=9,color='64748B')
    r=4
    S.cell(r,1,'Composition (each %s)'%C['form_txt'].lower()).font=Font(bold=True,color=NAVY,size=12); r+=1
    for a,b in C['comp']:
        S.cell(r,1,a).border=B; S.cell(r,2,b).border=B; r+=1
    r+=1
    S.cell(r,1,'Defined market set-up — INPUT (used on "Mapping to apply")').font=Font(bold=True,color=NAVY,size=12); r+=1
    SET=[]
    for lab,val in C['setup']:
        S.cell(r,1,lab).border=B; c=S.cell(r,2,val); inp(c); S.merge_cells(start_row=r,start_column=2,end_row=r,end_column=3); SET.append('Summary!$B$%d'%r); r+=1
    S.cell(r,1,'Line / BU are a proposal (the DOZOVA brands are CHC today): change them if the product is promoted by another line.').font=Font(size=9,italic=True,color='64748B'); r+=2
    LBL=[('Defined market (all kept products)',None,True)]+[('  '+s+(' (if kept)' if k in C['off_segs'] else ''),s,False) for k,s in enumerate(SEGS)]
    def block(title,heads,mk):
        nonlocal r
        S.cell(r,1,title).font=Font(bold=True,color=NAVY,size=12); r+=1
        for j,h in enumerate(heads,1):
            c=S.cell(r,j,h or None); c.font=Font(bold=True,color='FFFFFF',size=9); c.fill=fill('3B5B8C'); c.alignment=Alignment(wrap_text=True,horizontal='center',vertical='center'); c.border=B
        S.row_dimensions[r].height=30; r+=1; top=r
        for lab,sg,bold in LBL:
            S.cell(r,1,lab).border=B
            for j,(f,fmt) in enumerate(mk(sg,r,top),2):
                c=S.cell(r,j,f); c.number_format=fmt; c.border=B
                if bold: c.font=Font(bold=True)
            if bold: S.cell(r,1).font=Font(bold=True)
            r+=1
        r+=1
    def mkf(sheet,a,b):
        def rg(col): return "'%s'!$%s$%d:$%s$%d"%(sheet,col,a,col,b)
        def sm(col,sg): return 'SUMIFS(%s,%s,"Y",%s,"%s")'%(rg(col),rg('A'),rg('B'),sg) if sg else 'SUMIFS(%s,%s,"Y")'%(rg(col),rg('A'))
        def ct(sg): return 'COUNTIFS(%s,"Y",%s,"%s")'%(rg('A'),rg('B'),sg) if sg else 'COUNTIFS(%s,"Y")'%rg('A')
        return sm,ct
    sm,ct=mkf('IQVIA input',*IQ)
    # 2026-10-21 (Ahmed: "full B-complex is 0, fill it"): a sub-market with no product in IQVIA monthly shows
    # "not in IQVIA" instead of 0, and a note under the block gives its size from Total Market Intelligence.
    def na(f,sg): return 'IF(COUNTIF(\'IQVIA input\'!$B$%d:$B$%d,"%s")=0,"not in IQVIA",%s)'%(IQ[0],IQ[1],sg,f) if sg else f
    block('Market size — Market Intelligence (IQVIA monthly), MAT to %s vs prior MAT'%per,['','MAT value (EGP)','Prior MAT value (EGP)','Value growth','MAT SU','Prior MAT SU','SU growth','Share of market (value)','Rows'],
          lambda sg,i,top:[('='+na(sm('M',sg),sg),N),('='+na(sm('N',sg),sg),N),('=IFERROR(B%d/C%d-1,"")'%(i,i),G),('='+na(sm('Q',sg),sg),N),('='+na(sm('R',sg),sg),N),('=IFERROR(E%d/F%d-1,"")'%(i,i),G),('=IFERROR(B%d/B$%d,"")'%(i,top),P2),('='+ct(sg),'0')])
    gap=[k for k,sg in enumerate(SEGS) if k not in C['off_segs'] and not any(x[1]==sg for x in rows)]
    if gap:
        r-=1
        for k in gap:
            sg=SEGS[k]; g=sorted([x for x in tr if x[0]=='Y' and x[1]==sg],key=lambda x:-(x[2]['v'].get(full[-1],0) or 0))
            v1=sum(x[2]['v'].get(full[-1],0) or 0 for x in g)
            txt='Note: "%s" — no product of this sub-market is captured by IQVIA monthly (IQVIA_SOURCE). Its size comes from Total Market Intelligence: %s EGP in %s, %d brands (%s). Use the Total MI block below for this sub-market.'%(sg,'{:,.0f}'.format(v1),full[-1],len(g),', '.join(x[2]['brand'] for x in g[:6])+(' ...' if len(g)>6 else ''))
            c=S.cell(r,1,txt); c.font=Font(size=9,italic=True,color='B45309'); c.alignment=Alignment(wrap_text=True,vertical='top'); S.merge_cells(start_row=r,start_column=1,end_row=r,end_column=9); S.row_dimensions[r].height=30; r+=1
        r+=1
    sm2,ct2=mkf('Total MI input',t0,tn)
    block('Market size — Total Market Intelligence (IMS), calendar %s vs %s'%(full[-1],full[-2]),['','Value %s (EGP)'%full[-1],'Value %s (EGP)'%full[-2],'Value growth','Units %s'%full[-1],'Units %s'%full[-2],'Units growth','Share of market (value)','Rows'],
          lambda sg,i,top:[('='+sm2(VA,sg),N),('='+sm2(VB,sg),N),('=IFERROR(B%d/C%d-1,"")'%(i,i),G),('='+sm2(CL(cU),sg),N),('='+sm2(CL(cU2),sg),N),('=IFERROR(E%d/F%d-1,"")'%(i,i),G),('=IFERROR(B%d/B$%d,"")'%(i,top),P2),('='+ct2(sg),'0')])
    # 2026-10-21 (Ahmed): every brand of the kept sub-markets, grouped under its sub-market, with its molecules
    S.cell(r,1,'Brands of the recommended market by sub-market — Total Market Intelligence %s (default definition; bold = %s)'%(full[-1],C['exact_label'].lower())).font=Font(bold=True,color=NAVY,size=12); r+=1
    for j,h in enumerate(['Sub-market / brand','Corporation','Molecules','Value %s (EGP)'%full[-1],'Growth vs %s'%full[-2],'Share of market','Share of sub-market'],1):
        c=S.cell(r,j,h); c.font=Font(bold=True,color='FFFFFF',size=9); c.fill=fill('3B5B8C'); c.border=B; c.alignment=Alignment(wrap_text=True,horizontal='center',vertical='center')
    S.row_dimensions[r].height=30; r+=1
    kept=[x for x in tr if x[0]=='Y']; tot=sum(x[2]['v'].get(full[-1],0) or 0 for x in kept)
    for sg in SEGS:
        grp=sorted([x for x in kept if x[1]==sg],key=lambda x:-(x[2]['v'].get(full[-1],0) or 0))
        if not grp: continue
        g1=sum(x[2]['v'].get(full[-1],0) or 0 for x in grp); g0=sum(x[2]['v'].get(full[-2],0) or 0 for x in grp)
        for j,x in enumerate([sg+' — %d brands'%len(grp),None,None,g1,(g1/g0-1) if g0 else 'new',g1/tot if tot else None,1],1):
            c=S.cell(r,j,x); c.font=Font(bold=True,color=NAVY); c.fill=fill('E8F0F7'); c.border=B
            if j==4: c.number_format=N
            if j==5 and g0: c.number_format=G
            if j in (6,7): c.number_format=P2
        r+=1
        for inc,sg2,t,ex in grp:
            v=t['v']; y1=v.get(full[-1],0) or 0; y0=v.get(full[-2],0) or 0
            for j,x in enumerate(['   '+t['brand']+((' ('+t['form']+')') if C['by_form'] and t['form'] else ''),t['corp'],t['mol'],y1,(y1/y0-1) if y0 else 'new',y1/tot if tot else None,y1/g1 if g1 else None],1):
                c=S.cell(r,j,x); c.border=B; c.font=Font(size=10,bold=ex,color='7C2D12' if ex else '000000')
                if j==3: c.alignment=Alignment(wrap_text=True,vertical='top')
                if j==4: c.number_format=N
                if j==5 and y0: c.number_format=G
                if j in (6,7): c.number_format='0.00%'
            r+=1
    r+=1
    S.cell(r,1,'Recommendation').font=Font(bold=True,color=NAVY,size=12); r+=1
    for t in C['rec']:
        c=S.cell(r,1,t); c.alignment=Alignment(wrap_text=True,vertical='top'); S.merge_cells(start_row=r,start_column=1,end_row=r,end_column=9); S.row_dimensions[r].height=32; r+=1
    S.sheet_view.showGridLines=False
    # ---------- Mapping to apply ----------
    M=wb.create_sheet('Mapping to apply')
    hdr(M,4,['Apply','Product (IQVIA)','Corporation','Molecules','Dosage form','DM1','DM2','Line','BU'],[8,26,26,60,18,26,26,10,10])
    M['A1']='Mapping to apply in the dashboard (IQVIA product -> defined market)'; M['A1'].font=Font(bold=True,size=14,color=NAVY)
    M['A2']='Built from "IQVIA input" (Y/N + sub-market) and the set-up on the Summary. Rows with Apply = Y become product rules in iqvia_source/config/product_market_overrides.json; the raw IQVIA_SOURCE.xlsx is not edited.'; M['A2'].font=Font(size=9,color='64748B')
    for k in range(IQ[1]-IQ[0]+1):
        i=5+k; s=IQ[0]+k
        M.cell(i,1,"='IQVIA input'!A%d"%s); M.cell(i,2,"='IQVIA input'!C%d"%s); M.cell(i,3,"='IQVIA input'!D%d"%s); M.cell(i,4,"='IQVIA input'!E%d"%s); M.cell(i,5,"='IQVIA input'!I%d"%s)
        M.cell(i,6,'=IF(A%d="Y",%s,"")'%(i,SET[0]))
        f2=SET[C['dm2_of_seg'][-1]]
        for sk in range(len(SEGS)-2,-1,-1): f2='IF(\'IQVIA input\'!B%d="%s",%s,%s)'%(s,SEGS[sk],SET[C['dm2_of_seg'][sk]],f2)
        M.cell(i,7,'=IF(A%d="Y",%s,"")'%(i,f2))
        M.cell(i,8,'=IF(A%d="Y",%s,"")'%(i,SET[C['line_ix']])); M.cell(i,9,'=IF(A%d="Y",%s,"")'%(i,SET[C['line_ix']+1]))
        for j in range(1,10): M.cell(i,j).border=B
    M.auto_filter.ref='A4:I%d'%(4+IQ[1]-IQ[0]+1); M.freeze_panes='C5'
    # ---------- Notes ----------
    Nn=wb.create_sheet('Notes'); Nn.column_dimensions['A'].width=26; Nn.column_dimensions['B'].width=120
    notes=[('Sources','Market Intelligence = cache/iqvia.json (IQVIA_SOURCE.xlsx, monthly LC value + standard units). Total Market Intelligence = cache/market_intel.json ("IMS 2022 to April 2026.xlsx", calendar years, value + units). Both read-only.')]+C['rules']+[
      ('Inputs','Change columns A / B on the input sheets and the yellow set-up cells on the Summary; the Summary and "Mapping to apply" follow.'),
      ('Caveats','Total MI %s = Jan-Apr only and some %s values look inconsistent with %s, so %s is used for sizing. Some brands exist in only one of the two sources.'%(part,part,full[-1],full[-1])),
      ('Prepared','%s — built by market_definitions/build_defined_market.py (%s) from the dashboard caches.'%(DATE,key))]
    for k,(a,b) in enumerate(notes,start=1):
        Nn.cell(k,1,a).font=Font(bold=True); c=Nn.cell(k,2,b); c.alignment=Alignment(wrap_text=True,vertical='top')
    wb.calculation.fullCalcOnLoad=True
    out=os.path.join(ROOT,'market_definitions',C['file']); wb.save(out)
    print(out,'| IQVIA rows',len(rows),'kept',sum(1 for x in rows if x[0]=='Y'),'| TotalMI rows',len(tr),'kept',sum(1 for x in tr if x[0]=='Y'),'| exact:',sorted({t[2]['brand'] for t in tr if t[3]}))

if __name__=='__main__':
    w=sys.argv[1] if len(sys.argv)>1 else 'all'
    for k in (PRODUCTS if w=='all' else [w]): build(k)
