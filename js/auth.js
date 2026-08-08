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
    try { sessionStorage.removeItem(ACTIVE_SCENARIO_KEY); } catch (e) {}
    location.reload();
  }

  /**
   * TARGET SCENARIO ENTITLEMENT (2026-08-04)
   * -----------------------------------------------------------------
   * Confirmed by Ahmed (TARGET_SCENARIO_DEPENDENCY_ANALYSIS.md §10):
   * executives/managers default to Official Target and may switch to
   * Working Target to compare; Line Managers are locked to Working
   * Target and must never see Official. Any role not explicitly listed
   * here -- including any future role added to
   * Zeta_Dashboard_User_Config.xlsx's Users sheet before this table is
   * updated for it -- falls back to the safest behavior: Official
   * Target, no toggle. This table never silently grants Working-Target
   * visibility to a role it doesn't recognize.
   *
   * IMPORTANT: this module only holds the user's CURRENT UI SELECTION
   * (what they clicked in the scenario selector). It is never read
   * directly by any target-aggregation function -- js/sales.js and
   * js/executive.js read getActiveScenario() ONCE at the top of a
   * render/card-build pass and pass the result down as an explicit
   * `scenario` parameter through the whole call chain, per Ahmed's
   * explicit requirement that scenario resolution stay deterministic
   * and free of ambient/global reads inside the semantic layer itself
   * (so the existing per-argument memoization cache in js/sales.js
   * stays correct -- see that file's heavyFns wrapper).
   */
  var SCENARIO_ROLE_CONFIG = {
    "CEO":                  { canToggleScenario: true,  defaultScenario: "official" },
    "VP":                   { canToggleScenario: true,  defaultScenario: "official" },
    "Commercial Director":  { canToggleScenario: true,  defaultScenario: "official" },
    "BEX":                  { canToggleScenario: true,  defaultScenario: "official" },
    "SFE Manager":          { canToggleScenario: true,  defaultScenario: "official" },
    "Admin":                { canToggleScenario: true,  defaultScenario: "official" },
    "BU Manager":           { canToggleScenario: true,  defaultScenario: "official" },
    "Line Manager":         { canToggleScenario: false, defaultScenario: "working" },
    // Not explicitly covered by Ahmed's 2026-08-04 decision list (which
    // named CEO/VP/Commercial Director/BEX/SFE Manager/Admin/BU
    // Manager/Line Manager) but IS a real, currently-active role in the
    // live user roster -- given the safest fallback (Official, no
    // toggle, identical to pre-feature behavior) rather than left
    // undefined. Flag to Ahmed for explicit confirmation.
    "Marketing Consultant": { canToggleScenario: false, defaultScenario: "official" }
  };
  var SCENARIO_ROLE_FALLBACK = { canToggleScenario: false, defaultScenario: "official" };

  // -------------------------------------------------------------------
  // ALL-BUSINESS-UNITS VIEW (2026-08-04, Ahmed)
  // -------------------------------------------------------------------
  // The Executive Command Center's BU filter gains an "All Business
  // Units" option showing whole-company performance. Ahmed scoped its
  // visibility explicitly: "visible for ceo, vp, bex, admin and sfe
  // manager only". Every other role -- including BU Manager and Line
  // Manager, who legitimately use this page -- continues to see only the
  // individual BUs they are entitled to.
  //
  // Gated on TWO conditions, not one: the role must be listed here AND
  // the user must be unrestricted in scope. A BU- or line-restricted
  // account could otherwise use a permitted role to see company-wide
  // totals that include BUs their own scope excludes, which would defeat
  // the platform's access model.
  var ALL_BU_ROLES = ["CEO", "VP", "BEX", "Admin", "SFE Manager"];

  // -------------------------------------------------------------------
  // TOTAL MARKET INTELLIGENCE ACCESS (2026-08-06, Ahmed)
  // -------------------------------------------------------------------
  // "make it exclusive to ceo admin vp sfe bex" -- the same five roles as
  // ALL_BU_ROLES, deliberately declared as its OWN constant rather than
  // aliased to it. The two happen to coincide today but answer different
  // questions: one is "may you see company-wide BU totals", the other is
  // "may you see the entire competitor market including every rival's
  // sales". Sharing a constant would silently couple them, so a future
  // change to one would move the other without anyone noticing.
  //
  // Unlike the All-BU view, this is NOT additionally gated on scope. A
  // BU-restricted SFE Manager still sees the whole market here, because
  // the page contains no Zeta-internal BU/line data -- it is purchased
  // IMS panel data about the market as a whole. Restricting it by BU
  // would be meaningless: there is no BU dimension in it to restrict.
  var MARKET_INTEL_ROLES = ["CEO", "VP", "BEX", "Admin", "SFE Manager"];

  function canViewMarketIntel() {
    var u = getValidSessionUser();
    if (!u) return false;
    return MARKET_INTEL_ROLES.indexOf(u.role) >= 0;
  }

  function canViewAllBUs() {
    var u = getValidSessionUser();
    if (!u) return false;
    if (ALL_BU_ROLES.indexOf(u.role) < 0) return false;
    var scope = getScope();
    if (!scope) return false;
    // Any BU or Line restriction disqualifies, regardless of role.
    if (scope.bus !== null && scope.bus !== undefined) return false;
    if (scope.lines !== null && scope.lines !== undefined) return false;
    return true;
  }
  var ACTIVE_SCENARIO_KEY = "zeta_active_scenario";

  function getScenarioConfig() {
    var u = getValidSessionUser();
    if (!u) return SCENARIO_ROLE_FALLBACK;
    return SCENARIO_ROLE_CONFIG.hasOwnProperty(u.role) ? SCENARIO_ROLE_CONFIG[u.role] : SCENARIO_ROLE_FALLBACK;
  }

  /** Whether the signed-in user is allowed to see a scenario selector
   * control at all. Roles without this render no selector -- not a
   * disabled one -- so a locked role's UI never implies a choice exists. */
  function canToggleScenario() {
    return getScenarioConfig().canToggleScenario;
  }

  /**
   * Current scenario for the signed-in user: their own locked default
   * unless they're toggle-capable AND have made an explicit in-session
   * choice. Uses sessionStorage (not localStorage) deliberately --
   * scenario is a working-session lens on the data, not a saved account
   * preference, so it resets on a fresh sign-in or a new tab rather than
   * silently persisting across logins.
   */
  function getActiveScenario() {
    var cfg = getScenarioConfig();
    if (!cfg.canToggleScenario) return cfg.defaultScenario;
    try {
      var stored = sessionStorage.getItem(ACTIVE_SCENARIO_KEY);
      if (stored && global.SEMANTIC && global.SEMANTIC.isValidScenario(stored)) return stored;
    } catch (e) {}
    return cfg.defaultScenario;
  }

  /** Set the active scenario for this browser session. Re-checks
   * canToggleScenario() itself (not just trusting the UI not to call it)
   * so a locked role can never end up with a Working-Target session
   * value even via a stray call. Returns false (no-op) if disallowed or
   * the scenario key isn't a real one from SEMANTIC.TARGET_SCENARIOS. */
  function setActiveScenario(scenario) {
    var cfg = getScenarioConfig();
    if (!cfg.canToggleScenario) return false;
    if (!global.SEMANTIC || !global.SEMANTIC.isValidScenario(scenario)) return false;
    try { sessionStorage.setItem(ACTIVE_SCENARIO_KEY, scenario); } catch (e) {}
    return true;
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
    filterAllowedLines: filterAllowedLines,
    canToggleScenario: canToggleScenario,
    canViewAllBUs: canViewAllBUs,
    ALL_BU_ROLES: ALL_BU_ROLES,
    canViewMarketIntel: canViewMarketIntel,
    MARKET_INTEL_ROLES: MARKET_INTEL_ROLES,
    getActiveScenario: getActiveScenario,
    setActiveScenario: setActiveScenario
  };
})(window);
