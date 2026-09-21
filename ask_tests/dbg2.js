const { boot, signIn } = require("./harness");
const { window: w } = boot();
signIn(w, process.argv[2]); w.eval("CacheStore.init()");
const mi = w.AskQuery.measureIndex().filter(x=>x.p.id==="sfe"||x.m.id==="vacant_positions");
mi.forEach(x=>console.log(x.p.id, x.m.id, x.phrases.slice(0,3)));
console.log(w.AskQuery.findMeasures("which positions are vacant","sfe").map(h=>h.m.id+":"+h.phrase));
