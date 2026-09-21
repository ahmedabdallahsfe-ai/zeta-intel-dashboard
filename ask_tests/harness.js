/**
 * ASK THE DATA — offline test harness
 * ============================================================================
 * Boots the REAL dashboard (dashboard.html markup + every <script> in the same
 * order, real cache/*.data.js files) inside jsdom, with no network and no
 * LLM. Nothing is mocked except the browser-only bits (Chart.js, print,
 * localStorage) — every calculation the tests observe is the dashboard's own.
 *
 * Script order is READ FROM dashboard.html, so this harness cannot drift from
 * the page. Lazy caches (CacheLoader) are evaluated eagerly here so tests are
 * deterministic; test_ask_cache_sync.js separately proves the Ask engine
 * requests them through CacheLoader before answering.
 *
 * Sessions are created directly in localStorage for any real roster account
 * (no passwords are read, stored or needed): AUTH.getValidSessionUser() only
 * checks {email, expires} against the roster.
 */
"use strict";
const fs = require("fs");
const path = require("path");
// jsdom loads thousands of tiny files; on a slow network/virtual mount that takes
// ~70s per process. If a local copy exists (see ask_tests/README.md) use it.
function requireFast(m) {
  try { return require(path.join(process.env.HOME || "", "nmcopy", "node_modules", m)); }
  catch (e) { return require(m); }
}
const { JSDOM } = requireFast("jsdom");
const { webcrypto } = require("crypto");

const ROOT = path.resolve(__dirname, "..");

function listScripts(html) {
  const out = [];
  const re = /<script[^>]*\ssrc="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1].replace(/\?.*$/, ""));
  return out;
}

// Caches that CacheLoader normally injects on demand.
const LAZY = ["cache/customer_analytics.data.js", "cache/market_intel.data.js",
              "cache/coaching.data.js", "cache/ims_rx.data.js"];

function boot(opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const dom = new JSDOM(body, { runScripts: "dangerously", pretendToBeVisual: true,
    url: "file://" + ROOT + "/dashboard.html" });
  const w = dom.window;
  Object.defineProperty(w, "crypto", { value: webcrypto, configurable: true, writable: true });
  w.print = () => {};
  w.requestIdleCallback = (fn) => setTimeout(fn, 0);
  const store = {};
  Object.defineProperty(w, "localStorage", { configurable: true, get() { return {
    getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, clear: () => Object.keys(store).forEach(k => delete store[k]) }; } });
  const errors = [];
  w.addEventListener("error", e => errors.push(String(e.message || e)));
  w.console.warn = () => {}; // silence module chatter; errors still collected
  w.console.log = () => {};

  let files = listScripts(html).filter(f => !/^https?:/.test(f));
  if (opts.eagerLazy !== false) {
    const at = files.indexOf("js/app.js");
    files = files.slice(0, at).concat(LAZY, files.slice(at));
  }
  if (opts.skipApp !== false) files = files.filter(f => f !== "js/app.js");
  // Chart.js is browser-only; a stub is enough for calculation tests.
  files = files.filter(f => f !== "assets/chart.umd.min.js" && f !== "js/perf-probe.js");
  w.Chart = function () { this.update = () => {}; this.destroy = () => {}; };
  w.Chart.register = () => {}; w.Chart.defaults = { font: {}, plugins: {} };

  const loadErrors = [];
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) { loadErrors.push("missing " + f); continue; }
    try {
      const el = w.document.createElement("script");
      // A/B aid: AB_BASELINE=<suffix> loads "<file>.bak_<suffix>" (if present) instead of the current file,
      // e.g. AB_BASELINE=20260921_pre_askapi proves a later edit did not move a dashboard number.
      const abp = process.env.AB_BASELINE ? p + ".bak_" + process.env.AB_BASELINE : null;
      el.textContent = fs.readFileSync(abp && fs.existsSync(abp) ? abp : p, "utf8");
      w.document.body.appendChild(el);
    } catch (e) { loadErrors.push(f + ": " + (e.message || e)); }
  }
  // app.js is not booted here, but the To-Market access rule lives in it as a plain top-level function.
  // Extract that function's REAL source (brace-matched) so the provider is gated by the dashboard's own rule, not a stub.
  if (opts.skipApp !== false) {
    try {
      const src = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
      const at = src.indexOf("function tomarketAllowedBU()");
      if (at >= 0) {
        let i = src.indexOf("{", at), depth = 0, j = i;
        for (; j < src.length; j++) { if (src[j] === "{") depth++; else if (src[j] === "}") { depth--; if (!depth) break; } }
        w.eval(src.slice(at, j + 1) + "; window.tomarketAllowedBU = tomarketAllowedBU;");
      }
    } catch (e) { loadErrors.push("tomarketAllowedBU: " + (e.message || e)); }
  }
  return { window: w, errors, loadErrors, files };
}

/** Sign in as a real roster account (by name fragment or e-mail). */
function signIn(w, who) {
  const users = w.IQVIA_CACHE && w.IQVIA_CACHE.users || w.AUTH_USERS || {};
  let email = null;
  Object.keys(users).forEach(e => {
    const u = users[e];
    if (e === who || (u.name || "").toLowerCase().indexOf(String(who).toLowerCase()) >= 0) email = email || e;
  });
  if (!email) throw new Error("No roster account matches: " + who);
  const u = users[email];
  w.localStorage.setItem("zeta_session", JSON.stringify({ email, name: u.name, role: u.role,
    expires: Date.now() + 8 * 3600 * 1000 }));
  try { w.sessionStorage.removeItem("zeta_active_scenario"); } catch (e) {}
  return u;
}

// Tiny assertion kit with a per-file summary; exit code = failures > 0.
function makeKit(title) {
  const k = { pass: 0, fail: 0, rows: [], title };
  k.check = (cond, msg, extra) => { (cond ? k.pass++ : k.fail++); k.rows.push({ ok: !!cond, msg, extra });
    console.log((cond ? "  PASS " : "  FAIL ") + msg + (!cond && extra ? "  -> " + extra : "")); };
  k.section = s => console.log("\n== " + s);
  k.done = () => { console.log("\n" + title + ": " + k.pass + " passed, " + k.fail + " failed");
    process.exitCode = k.fail ? 1 : 0; return k; };
  return k;
}
module.exports = { boot, signIn, makeKit, ROOT };
