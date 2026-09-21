const { boot, signIn } = require("./harness");
const { window: w } = boot();
signIn(w, "Mohamed Bakr"); w.eval("CacheStore.init()");
const c = w.WORKING_DAYS_CACHE; console.log(Object.keys(c));
const d = w.eval("(function(){var b=WORKING_DAYS_CACHE.b64Data;var s=atob(b);var u=new Uint8Array(s.length);for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return JSON.parse(pako.ungzip(u,{to:'string'}));})()");
console.log(JSON.stringify(d.meta).slice(0,800)); console.log(d.monthOrder, JSON.stringify(d.multiplier));
const t=d.employees.DM_DSM; const m=Object.keys(t); console.log(m, m.map(k=>t[k].length));
console.log(JSON.stringify(t[m[m.length-1]][0]));
console.log(JSON.stringify(d.employees.ASM[m[m.length-1]][0]));
