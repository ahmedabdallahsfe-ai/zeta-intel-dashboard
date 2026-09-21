const H=require("./harness.js");
const b=H.boot(); const w=b.window; H.signIn(w,"Mohamed Bakr");
w.MarketIntelligence._decodeCache(); const I=w.MarketIntelligence._internals();
console.log(Object.keys(I.CACHE), Object.keys(I.CACHE.lookups).map(k=>k+":"+I.CACHE.lookups[k].length).join(" "));
console.log(I.CACHE.lookups.years, JSON.stringify(I.CACHE.meta||{}).slice(0,600));
console.log("A fields", I.CACHE.annual.fields, I.CACHE.annual.stride, I.CACHE.annual.n);
console.log(I.CACHE.lookups.priceBands||I.CACHE.lookups.price);
I.resetFilters(); const K=I.buildKpis(); console.log(JSON.stringify(K).slice(0,1600));
const rk=I.rankedRows(I.F.F_CORP,"corps"); console.log(rk.total, rk.window, rk.rows.slice(0,3).map(r=>[r.name,r.value,r.growthPct,r.sharePct]));
