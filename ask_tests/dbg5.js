const { boot, signIn } = require("./harness");
const { window: w } = boot();
signIn(w, "Mohamed Bakr"); w.eval("CacheStore.init()");
const a = w.SprintDashboard.askApi(); const d = a.data(a.liveMonth);
console.log(a.liveMonth, a.liveKey, JSON.stringify(a.months()));
function strip(o){ const c=Object.assign({},o); ["teamMembers","coachingDetail","workingDaysDetail","leaveDetail"].forEach(k=>{ if(c[k]) c[k]="<"+(Array.isArray(c[k])?c[k].length+" items":"obj:"+Object.keys(c[k]).join("|"))+">"}); return c;}
["asm","nsm","brandManager"].forEach(k=>{ console.log(k, JSON.stringify(strip(d[k].ranked[0])).slice(0,900)); console.log(k,"excluded", d[k].excluded.length, JSON.stringify(d[k].excluded[0]||{}).slice(0,300));});
console.log("msr excluded", d.medicalRepSalesRep.excluded.length, JSON.stringify(d.medicalRepSalesRep.excluded[0]));
console.log("dm excluded", d.dmDsm.excluded.length, JSON.stringify(d.dmDsm.excluded[0]).slice(0,300));
const sr = d.medicalRepSalesRep.ranked.find(r=>r.role==="Sales Rep (CHC)"); console.log(JSON.stringify(sr).slice(0,700));
const roles={}; d.medicalRepSalesRep.ranked.forEach(x=>roles[x.role]=(roles[x.role]||0)+1); console.log(roles);
console.log(JSON.stringify(d.dmDsm.ranked[0].kpis.map(k=>[k.key,k.weight])), JSON.stringify(d.asm.ranked[0].kpis.map(k=>[k.key,k.weight])), JSON.stringify(d.nsm.ranked[0].kpis.map(k=>[k.key,k.weight])), JSON.stringify((d.brandManager.ranked[0].kpis||[]).map(k=>[k.key,k.weight])));
console.log(a.band(90), a.band(50), a.band(10));
