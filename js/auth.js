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

  /**
   * ROLE-BASED DATA SCOPE (2026-07-29)
   * -----------------------------------------------------------------
   * Zeta_Dashboard_User_Config.xlsx's "Allowed BU" / "Allowed Lines"
   * columns were always meant to restrict WHAT a signed-in user can
   * see, not just gate whether they can sign in at all (e.g. Kamal
   * Allam is a DIAB-only BU Manager -- he should never see CHC/
   * Cluster/GIT data, in any workspace). getValidSessionUser() already
   * exposes .bu/.lines from that sheet (null = unrestricted/Admin-like,
   * an array = the exact allowed set); these helpers are the one place
   * every workspace (Coverage, SFE, Sales, Executive -- IQVIA already
   * has its own, deliberately different, dm1s/market-based scope, see
   * iqvia.js's applyUserFilter()) turns that into a yes/no decision or
   * a filtered option list, instead of five separate re-implementations.
   *
   * Lines are the authoritative, finer-grained scope -- a user can be
   * restricted to a subset of their own BU's lines (e.g. Amr Khalifa's
   * Allowed Lines is "CHC" only, not "CHC,CHC_SALES", even though both
   * lines belong to his allowed CHC business unit). isLineAllowed()
   * normalizes through SEMANTIC.normalizeLine() first so raw-spelling
   * variants (NEUROSCIENCE/DERMA vs canonical CNS/Derma) still compare
   * correctly, exactly like every other line comparison on this
   * platform.
   */
  function getScope() {
    var u = getValidSessionUser();
    if (!u) return { unrestricted: false, bus: [], lines: [] };
    return {
      unrestricted: !u.bu && !u.lines,
      bus: u.bu || null,       // null = every BU allowed
      lines: u.lines || null   // null = every line allowed
    };
  }

  function isBuAllowed(bu) {
    var s = getScope();
    if (s.bus === null) return true;
    return s.bus.indexOf(bu) >= 0;
  }

  function isLineAllowed(rawLine) {
    var s = getScope();
    if (s.lines === null) return true;
    var canon = (global.SEMANTIC && global.SEMANTIC.normalizeLine) ? global.SEMANTIC.normalizeLine(rawLine) : rawLine;
    return s.lines.indexOf(canon) >= 0;
  }

  /** Filter an array of BU names down to the ones this user may see. */
  function filterAllowedBUs(buArray) {
    var s = getScope();
    if (s.bus === null) return buArray.slice();
    return buArray.filter(function (b) { return s.bus.indexOf(b) >= 0; });
  }

  /** Filter an array of (raw or canonical) line names down to the ones
   * this user may see. Returns the ORIGINAL strings, just filtered --
   * does not rewrite spellings. */
  function filterAllowedLines(lineArray) {
    var s = getScope();
    if (s.lines === null) return lineArray.slice();
    return lineArray.filter(function (l) { return isLineAllowed(l); });
  }

  global.AUTH = {
    getValidSessionUser: getValidSessionUser,
    login: login,
    logout: logout,
    getScope: getScope,
    isBuAllowed: isBuAllowed,
    isLineAllowed: isLineAllowed,
    filterAllowedBUs: filterAllowedBUs,
    filterAllowedLines: filterAllowedLines
  };
})(window);
