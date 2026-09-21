/** Shared helpers for the Ask the Data test suites (no assertions of their own). */
"use strict";
const { boot, signIn, makeKit } = require("./harness");

/** Boot the real dashboard and sign in as a roster account, ready for Ask calls. */
function open(who) {
  const b = boot(); const w = b.window;
  signIn(w, who); w.eval("CacheStore.init()");
  try { w.eval("Analytics.init(CacheStore.getRecords(), CacheStore.getDashboard().dimensions)"); } catch (e) {}
  w.__loadErrors = b.loadErrors; w.__errors = b.errors;
  return w;
}
function adapterFor(w, tab) {
  const m = { sales: w.AskSales, coverage: w.AskCoverage, sfe: w.AskSFE, executive: w.AskExecutive }[tab];
  return m ? m.adapter : w.AskPages.adapter(tab);
}
/** One question through the SAME entry point the panel uses. Conversation memory is cleared first. */
function ask(w, tab, q) {
  try { w.AskEngine.AskContext.clear(); } catch (e) {}
  try { w.AskQuery.resetContext(); } catch (e) {}
  const ad = adapterFor(w, tab);
  if (!ad) return { ok: false, question: q, message: "(no Ask adapter for this tab and account)", noAdapter: true };
  return w.AskEngine.answer(ad, q);
}
/** Every string the user could read in a result (rows, cells, evidence, drill chips, caveats, assumptions ...). */
function flat(r) {
  const out = [];
  (function walk(x, depth) {
    if (x === null || x === undefined || typeof x === "function" || depth > 6) return;
    if (typeof x === "string") out.push(x);
    else if (typeof x === "number") out.push(String(x));
    else if (Array.isArray(x)) x.forEach(y => walk(y, depth + 1));
    else if (typeof x === "object") Object.keys(x).forEach(k => walk(x[k], depth + 1));
  })(r, 0);
  return out.join(" \n ");
}
/** The rendered card, exactly as the panel builds it. */
function html(w, tab, r) { return w.AskEngine.resultHtml(adapterFor(w, tab), r); }
function has(text, name) {
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?<![\\w-])" + esc + "(?![\\w-])", "i").test(text);
}
/** Text of a result WITHOUT the echoed question (a refusal may legitimately repeat what the user typed). */
function body(r) { const c = Object.assign({}, r); delete c.question; return flat(c); }
module.exports = { open, ask, flat, html, has, body, adapterFor, makeKit, boot, signIn };
