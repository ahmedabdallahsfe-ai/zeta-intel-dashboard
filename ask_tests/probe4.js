const { boot, signIn } = require("./harness");
const { window: w } = boot();
signIn(w, "Mohamed Bakr"); w.eval("CacheStore.init()");
w.eval("Analytics.init(CacheStore.getRecords(), CacheStore.getDashboard().dimensions)");
let t=Date.now();
const r = w.eval("Analytics.run(Analytics.defaultFilters())");
console.log(Date.now()-t,"ms");
for (const k of Object.keys(r)) { const v=r[k]; console.log(k, Array.isArray(v)? "array["+v.length+"] "+JSON.stringify(v[0]||null).slice(0,260) : (typeof v==="object"&&v? "obj "+Object.keys(v).slice(0,30).join(",") : v)); }
console.log(JSON.stringify(r.kpis));
const r2 = w.eval("Analytics.run(Object.assign(Analytics.defaultFilters(),{period:['July']}))");
console.log(JSON.stringify(r2.kpis).slice(0,600));
