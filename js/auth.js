/**
 * ZETA ENTERPRISE PLATFORM — auth.js
 * =====================================================================
 * PLATFORM ASSET. Exposes window.AUTH.
 *
 * Single app-wide authentication gate (2026-07-29). Previously only the
 * Market Intelligence (IQVIA) workspace required sign-in -- Coverage,
 * Zeta Organogram (SFE), Sales Performance, and the Executive Command
 * Center were all reachable with no login at all. This module lifts
 * that gate to the app shell itself (dashboard.html's boot sequence in
 * app.js) so every workspace requires authentication, and the Market
 * Intelligence workspace no longer needs -- or shows -- its own
 * separate login form (see the IQVIA_APP_STRUCTURE edit in js/iqvia.js
 * that removes the old <div id="iqvia-zeta-login"> login card).
 *
 * This was already the flagged direction, not a new idea: iqvia.js's
 * getBusinessSummary() has carried a comment since the Executive
 * Command Center build calling single-workspace auth "Authentication
 * hardening (Phase 7) is a separate, future concern" -- this file is
 * that phase.
 *
 * SOURCE OF TRUTH FOR CREDENTIALS: Zeta_Dashboard_User_Config.xlsx's
 * "Users" sheet, processed by refresh_iqvia.py into salted SHA256
 * password hashes embedded in cache/iqvia.data.js's IQVIA_CACHE.users.
 * Session: no backend, so there is no signed/opaque token -- this is a
 * client-side gate backed by localStorage's 'zeta_session' key
 * ({email, name, role, expires}, 8h TTL), the exact mechanism the
 * IQVIA workspace already used pre-2026-07-29 for its own
 * getBusinessSummary() auth check. getValidSessionUser()'s rule is
 * UNCHANGED here -- only relocated so every module (not just IQVIA)
 * can reach it without depending on iqvia.js.
 *
 * HONEST LIMITATION (flag to any reviewer, not hidden): every
 * cache/*.data.js file is a static <script> embedded directly in
 * dashboard.html and downloads to the browser in full before this
 * gate ever runs (offline-first architecture, no backend -- see
 * project instructions). This login screen is a real, useful access
 * control for normal internal use, but it is NOT a substitute for
 * server-side authorization: a technically sophisticated user with
 * browser devtools can still read the underlying cached data before,
 * or without, signing in. If this platform is ever exposed to an
 * untrusted audience (today it is an internal GitHub Pages deployment,
 * not public-facing in the adversarial sense), that gap needs a real
 * backend, not a client-side gate.
 * =====================================================================
 */
(function (global) {
  "use strict";

  var SALT = "ZETA2026INTEL";
  var SESSION_KEY = "zeta_session";
  var SESSION_TTL_MS = 8 * 3600 * 1000;

  function users() {
    return (global.IQVIA_CACHE && global.IQVIA_CACHE.users) || {};
  }

  async function sha256(str) {
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  /**
   * Pure session check -- no DOM access, no side effects. The single
   * authentication rule for the whole platform: a valid, unexpired
   * zeta_session pointing at a known user. Every workspace (Coverage,
   * SFE, Sales, Executive, IQVIA) that needs to know "is someone
   * signed in, and who" calls this, never localStorage directly.
   */
  function getValidSessionUser() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && s.expires > Date.now()) {
        var u = users()[s.email];
        if (u) return u;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Attempt sign-in. Never throws -- always resolves to
   * { ok:true, user } or { ok:false, error }.
   */
  async function login(email, pwd) {
    email = String(email || "").trim().toLowerCase();
    pwd = String(pwd || "");
    if (!email || !pwd) return { ok: false, error: "Please enter email and password." };
    try {
      var hash = await sha256(email + ":" + pwd + ":" + SALT);
      var user = users()[email];
      if (!user || user.hash !== hash) return { ok: false, error: "Invalid email or password." };
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        email: email,
        name: user.name,
        role: user.role,
        expires: Date.now() + SESSION_TTL_MS
      }));
      return { ok: true, user: user };
    } catch (e) {
      return { ok: false, error: "Login error. Try again." };
    }
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    location.reload();
  }

  global.AUTH = {
    getValidSessionUser: getValidSessionUser,
    login: login,
    logout: logout
  };
})(window);
