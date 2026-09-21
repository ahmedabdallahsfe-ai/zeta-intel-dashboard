const { boot, signIn } = require("./harness");
const { window: w, loadErrors, errors } = boot();
console.log("loadErrors", loadErrors, "errors", errors.slice(0,3));
signIn(w, process.argv[2] || "Mohamed Bakr"); w.eval("CacheStore.init()"); try{w.eval("Analytics.init(CacheStore.getRecords(), CacheStore.getDashboard().dimensions)")}catch(e){}
const qs = process.argv.slice(3);
for (let q of qs) {
  let tab = process.env.TAB || "sales"; const mm = /^(\w+)::(.*)$/.exec(q); if (mm) { tab = mm[1]; q = mm[2]; }
  const t = Date.now();
  let r; try { const ad = ({sales:w.AskSales,coverage:w.AskCoverage,sfe:w.AskSFE,executive:w.AskExecutive})[tab]; r = w.AskEngine.answer(ad ? ad.adapter : w.AskPages.adapter(tab), q); } catch (e) { console.log("THROW", q, e.stack); continue; }
  console.log("\n=== " + q + "  (" + (Date.now()-t) + "ms)");
  if (!r) { console.log("NULL"); continue; }
  console.log(r.ok, "|", r.headline || r.message);
  if (r.detail) console.log("detail:", r.detail);
  if (r.assumptions && r.assumptions.length) console.log("assume:", r.assumptions);
  if (r.rows) console.log((r.columns||[]).join(" | ")), r.rows.slice(0,6).forEach(x => console.log("  ", x.rank, x.name, x.cells.join(" | ")));
  if (r.caveats && r.caveats.length) console.log("caveats:", r.caveats);
  if (r.drill) console.log("drill:", r.drill.map(d=>d.question));
}
