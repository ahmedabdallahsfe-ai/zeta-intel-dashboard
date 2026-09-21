const H=require("./harness.js");
const b=H.boot(); const w=b.window; H.signIn(w,"Mohamed Bakr");
const c=JSON.parse(w.pako.ungzip(Uint8Array.from(Buffer.from(w.IMS_RX_CACHE.b64Data,"base64")),{to:"string"}));
console.log(Object.keys(c), Object.keys(c.meta), c.meta.schemaVersion);
Object.keys(c.lookups).forEach(k=>console.log(k, Array.isArray(c.lookups[k])?c.lookups[k].length:typeof c.lookups[k], JSON.stringify(c.lookups[k]).slice(0,120)));
console.log(c.fact.fields, c.fact.stride, c.fact.rx.length);
console.log(JSON.stringify(c.meta).slice(0,900));
console.log(w.AUTH.canViewImsRx());
