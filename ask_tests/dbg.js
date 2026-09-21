const { boot, signIn } = require("./harness");
const { window: w } = boot();
signIn(w, process.argv[2]); w.eval("CacheStore.init()");
const q = process.argv[3];
w.AskQuery.answer(w.AskSFE.adapter, q); const p = w.AskQuery.lastPlan(); 
console.log(JSON.stringify(p, (k,v)=> (k==="plan"||k==="prov")?undefined:v).slice(0,1500));
console.log(Object.keys(p).join(","), JSON.stringify((p.measures||[]).map(m=>m.id)), p.groupBy, p.intent);
