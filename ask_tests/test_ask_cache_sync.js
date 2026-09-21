/**
 * P0 #6 — Ask engine build / cache synchronisation.
 *   1. every Ask file, its <script> tag and its AskBuild registration carry ONE build id
 *   2. AskEngine.syncStatus() proves it at runtime and DETECTS a stale or missing file
 *   3. the lazy data caches an Ask provider needs are requested through CacheLoader and awaited before answering
 *   4. every page accessor the providers rely on exists at runtime (a stale page script would break it silently)
 */
"use strict";
const fs = require("fs"), path = require("path");
const L = require("./lib_ask");
const { ROOT } = require("./harness");
const kit = L.makeKit("Ask build / cache synchronisation");

const html = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const tags = []; { const re = /<script[^>]*\ssrc="(js\/(ask-[\w-]+\.js))\?v=([\w.-]+)"/g; let m; while ((m = re.exec(html))) tags.push({ src: m[1], file: m[2], v: m[3] }); }
const files = fs.readdirSync(path.join(ROOT, "js")).filter(f => /^ask-[\w-]+\.js$/.test(f));

kit.section("1. one build id across files, tags and registrations");
kit.check(tags.length === files.length && files.every(f => tags.some(t => t.file === f)), "every js/ask-*.js file has exactly one <script> tag (" + files.length + " files, " + tags.length + " tags)",
  files.filter(f => !tags.some(t => t.file === f)).join(", "));
const ids = Array.from(new Set(tags.map(t => t.v)));
kit.check(ids.length === 1, "all Ask <script> tags carry the same ?v= id", ids.join(" / "));
const bad = [];
files.forEach(f => {
  const src = fs.readFileSync(path.join(ROOT, "js", f), "utf8");
  const m = /\(g\.AskBuild=g\.AskBuild\|\|\{\}\)\["([^"]+)"\]="([^"]+)"/.exec(src.slice(0, 400));
  if (!m || m[1] !== f || m[2] !== ids[0]) bad.push(f + (m ? " (" + m[1] + "@" + m[2] + ")" : " (no AskBuild line)"));
});
kit.check(bad.length === 0, "every Ask file registers its own name + the same build id in its first statement", bad.join("; "));
const order = tags.map(t => t.file), pos = f => order.indexOf(f);
kit.check(pos("ask-engine.js") < pos("ask-period.js") && pos("ask-period.js") < pos("ask-query.js") && order.filter(f => /^ask-prov-/.test(f)).every(f => pos("ask-query.js") < pos(f) && pos(f) < pos("ask-pages.js")) &&
  ["ask-coverage.js", "ask-sales.js", "ask-sfe.js", "ask-executive.js"].every(f => pos("ask-pages.js") < pos(f)), "load order: engine → period → query → providers → pages → legacy adapters");
const appPos = html.search(/<script[^>]*src="js\/app\.js/), lastAsk = html.search(/<script[^>]*src="js\/ask-executive\.js/);
kit.check(lastAsk > 0 && lastAsk < appPos, "all Ask files load before app.js (which mounts the panels)");
["iqvia.js", "ims-rx.js", "coaching.js", "sprint.js", "working-days.js", "executive.js"].forEach(f => {
  const t = new RegExp('js/' + f.replace(".", "\\.") + '\\?v=([\\w.-]+)').exec(html);
  kit.check(!!t && /2026092\d_/.test(t[1]), "page script " + f + " was re-versioned after its read-only Ask accessor was added", t ? t[1] : "no tag");
});

kit.section("2. runtime detection (stale file / missing file / healthy)");
const w = L.open("Mohamed Bakr");
const B = w.AskBuild || {};
kit.check(Object.keys(B).length === files.length, "AskBuild holds all " + files.length + " running Ask files", Object.keys(B).length + " registered");
const tagMap = {}; tags.forEach(t => { tagMap[t.file] = t.v; });
let st = w.AskEngine.syncStatus(tagMap);
kit.check(st.ok && st.build === ids[0] && st.problems.length === 0, "healthy page: syncStatus ok, build " + ids[0], JSON.stringify(st.problems));
const stale = Object.assign({}, tagMap, { "ask-query.js": "20260101_old" });
st = w.AskEngine.syncStatus(stale);
kit.check(!st.ok && st.problems.some(p => /ask-query\.js/.test(p) && /stale|asks for/.test(p)), "a stale ask-query.js (page asks for a different build) is reported", JSON.stringify(st.problems));
const saved = B["ask-period.js"]; delete B["ask-period.js"];
st = w.AskEngine.syncStatus(tagMap);
kit.check(!st.ok && st.problems.some(p => /ask-period\.js/.test(p)), "a missing / blocked ask-period.js is reported", JSON.stringify(st.problems));
B["ask-period.js"] = saved;
B["ask-sfe.js"] = "20250101_old";
st = w.AskEngine.syncStatus({});
kit.check(!st.ok && st.problems.some(p => /different builds/.test(p)), "files running from two different builds are reported even with no tags to compare", JSON.stringify(st.problems));
B["ask-sfe.js"] = ids[0];
const card = w.AskEngine.render(L.adapterFor(w, "sales"));
kit.check(!/mi-ask-sync-warn/.test(card), "no warning banner is drawn when the build is healthy");
B["ask-sfe.js"] = "20250101_old"; const card2 = w.AskEngine.render(L.adapterFor(w, "sales")); B["ask-sfe.js"] = ids[0];
kit.check(/mi-ask-sync-warn/.test(card2) && /Ctrl\+F5/.test(card2), "the panel shows a reload warning when the build is out of sync");

kit.section("3. lazy data caches are requested and awaited before answering");
const need = {}; w.AskQuery.providers().forEach(p => (p.requires || []).forEach(k => { (need[k] = need[k] || []).push(p.id); }));
const CL = w.CacheLoader._caches;
kit.check(Object.keys(need).every(k => CL[k]), "every cache an Ask provider requires is a CacheLoader key (" + Object.keys(need).join(", ") + ")", Object.keys(need).filter(k => !CL[k]).join(","));
(async () => {
  const b = require("./harness").boot({ eagerLazy: false }); const w2 = b.window; require("./harness").signIn(w2, "Mohamed Bakr");
  w2.eval("CacheStore.init()"); try { w2.eval("Analytics.init(CacheStore.getRecords(), CacheStore.getDashboard().dimensions)"); } catch (e) {}
  const asked = [];
  const real = w2.CacheLoader.ensure;
  w2.CacheLoader.ensure = function (k) {            // a faithful stand-in for the network: evaluates the real cache file, then resolves
    asked.push(k);
    const spec = w2.CacheLoader._caches[k];
    if (!w2[spec.globalVar]) { const el = w2.document.createElement("script"); el.textContent = fs.readFileSync(path.join(ROOT, spec.file), "utf8"); w2.document.body.appendChild(el); }
    return Promise.resolve(true);
  };
  const cases = [["coaching", "coaching", "coaching_cov", "ims_rx"], ["imsrx", "imsrx", null, "ims_rx"], ["marketintel", "marketintel", null, "market_intel"]];
  const co = { coaching: ["coaching", "what is the coaching coverage"], imsrx: ["imsrx", "total prescriptions"], marketintel: ["marketintel", "what is the total market size"] };
  for (const key of Object.keys(co)) {
    const [tab, q] = co[key]; const want = { coaching: "coaching", imsrx: "ims_rx", marketintel: "market_intel" }[key];
    const before = w2[w2.CacheLoader._caches[want].globalVar];
    kit.check(!before, "before the question, the " + want + " cache is NOT loaded (page not opened)");
    asked.length = 0;
    const ad = L.adapterFor(w2, tab);
    const r = await w2.AskEngine.answerAsync(ad, q);
    kit.check(asked.indexOf(want) >= 0, "answerAsync for the " + tab + " tab asks CacheLoader for “" + want + "”", "asked: " + asked.join(","));
    kit.check(r && r.ok, "…and then answers from it (" + tab + ": " + q + ")", r && (r.message || r.headline));
  }
  w2.CacheLoader.ensure = real;

  kit.section("4. page accessors the providers depend on exist at runtime");
  const acc = [["IQVIADashboard", "askApi"], ["ImsRxDashboard", "askApi"], ["CoachingDashboard", "askApi"], ["SprintDashboard", "askApi"], ["WorkingDaysDashboard", "askApi"], ["ExecutiveDashboard", "askTmsIms"], ["MarketIntelligence", "_internals"]];
  acc.forEach(([o, f]) => kit.check(w[o] && typeof w[o][f] === "function", o + "." + f + "() is present", typeof (w[o] || {})[f]));
  kit.check((w.__loadErrors || []).length === 0, "no script failed to load in the harness boot", (w.__loadErrors || []).join("; "));
  kit.done();
})();
