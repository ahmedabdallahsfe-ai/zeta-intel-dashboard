/**
 * Runs the question bank (questions.js) as one signed-in account and stores every result under out/.
 *   node ask_tests/run_bank.js --role=0|1|2 [--part=i/n]
 * Roles: 0 CEO (Mohamed Bakr) · 1 BU Manager DIAB (Kamal Allam) · 2 Line Manager GIT-II (Nader Ahmed Khaled)
 * Split into parts only because a single process may be time-boxed; results merge by role.
 */
"use strict";
const fs = require("fs"), path = require("path");
const L = require("./lib_ask");
const { QUESTIONS } = require("./questions");
const ROLES = [["CEO", "Mohamed Bakr"], ["BU Manager", "Kamal Allam"], ["Line Manager", "Nader Ahmed Khaled"]];
const arg = n => { const a = process.argv.find(x => x.startsWith("--" + n + "=")); return a ? a.split("=")[1] : null; };
const ri = +(arg("role") || 0), part = (arg("part") || "1/1").split("/").map(Number);
const [tag, who] = ROLES[ri];
const w = L.open(who);
const vs = w.AskSales._vocab(), vc = w.AskCoverage._vocab();
const fill = { BU: vs.bus[0], LINE: vs.lines[0], BRAND: vs.brands[0], DM: (vc.dms || [])[0] };
const strip = h => String(h || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const slice = QUESTIONS.filter((_, i) => i % part[1] === part[0] - 1);
const out = [];
for (const it of slice) {
  const q = it.q.replace(/\{(\w+)\}/g, (_, k) => fill[k] || ("{" + k + "}"));
  const t0 = Date.now(); let r, err = null;
  try { r = L.ask(w, it.tab, q); } catch (e) { err = String(e && e.stack || e).slice(0, 400); r = { ok: false, message: "THROW " + err }; }
  let htmlText = "";
  try { htmlText = strip(L.html(w, it.tab, r)); } catch (e) { err = err || "render: " + e.message; }
  const ev = (r.evidence || []).map(e => [e[0], e[1]]);
  const per = ev.filter(e => /^period$/i.test(e[0]))[0];
  out.push({ id: it.id, domain: it.domain, tab: it.tab, q, template: it.q, ms: Date.now() - t0, err,
    ok: !!r.ok, clarify: !!r.clarify, missing: !!r.missing, denied: !!r.denied, noAdapter: !!r.noAdapter,
    headline: r.headline || (r.answer && r.answer.headline) || null, detail: r.detail || null, message: r.message || null, hint: r.hint || null,
    period: per ? per[1] : null, assumptions: r.assumptions || [], caveats: r.caveats || [], formula: r.formula || null,
    rows: (r.rows || []).slice(0, 5).map(x => [x.name].concat(x.cells || [])), evidence: ev, drill: (r.drill || []).map(d => d.question || d.label),
    text: L.body(r), htmlText });
  process.stderr.write(`${tag} ${it.id} ${r.ok ? "ok " : "-- "} ${Date.now() - t0}ms\n`);
}
fs.writeFileSync(path.join(__dirname, "out", `bank_${ri}_${part[0]}of${part[1]}.json`), JSON.stringify({ role: tag, who, fill, results: out }, null, 1));
console.log("wrote", out.length, "results for", tag, "part", part.join("/"));
