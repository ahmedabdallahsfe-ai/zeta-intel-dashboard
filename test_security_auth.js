/**
 * ZETA ENTERPRISE PLATFORM — test_security_auth.js
 * =====================================================================
 * Integration and functional tests for role-based security scoping.
 * Loads the dashboard environment, runs authentication flows with real
 * generated hashes, and asserts line/BU permission boundaries.
 * =====================================================================
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { webcrypto } = require('crypto');

const ROOT = __dirname;
const htmlShell = `<!DOCTYPE html><html><head></head><body>
  <div id="loading-overlay" class="loading-overlay" style="display:none;"></div>
  <div id="app-login-gate" class="app-login-gate">
    <input type="email" id="app-login-email" />
    <input type="password" id="app-login-pwd" />
    <button id="app-login-btn"></button>
    <div id="app-login-error"></div>
  </div>
  <div class="filter-bar-wrap">
    <div id="filter-bar" class="filter-bar"></div>
    <div id="filter-chips" class="filter-chips hidden"></div>
  </div>
  <main id="app-root" class="container"></main>
</body></html>`;

const dom = new JSDOM(htmlShell, { runScripts: 'dangerously', url: 'file://' + ROOT + '/dashboard.html' });
const { window } = dom;

// Polyfill web crypto subtle for JSDOM
Object.defineProperty(window, 'crypto', {
  value: webcrypto,
  configurable: true,
  writable: true
});

// Stub Chart.js and print
window.Chart = function () {
  this.update = () => {};
  this.destroy = () => {};
};
window.print = () => {};

// Mock local storage
const __store = {};
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  get() {
    return {
      getItem: (k) => (k in __store ? __store[k] : null),
      setItem: (k, v) => { __store[k] = String(v); },
      removeItem: (k) => { delete __store[k]; },
      clear: () => { Object.keys(__store).forEach(k => delete __store[k]); }
    };
  },
});

// Load test credentials
let credentials = {};
try {
  credentials = JSON.parse(fs.readFileSync(path.join(ROOT, 'test_credentials.json'), 'utf8'));
} catch (e) {
  console.error("FAIL: Could not load test_credentials.json");
  process.exit(1);
}

const filesInOrder = [
  'assets/xlsx.core.min.js',
  'assets/pako.min.js',
  'cache/metadata.data.js',
  'cache/iqvia.data.js', // sets window.IQVIA_CACHE.users
  'js/auth.js',          // sets window.AUTH
  'js/config.js',
  'js/utils.js',
  'js/cache.js',
  'js/loader.js',
  'js/analytics.js',
  'js/ui.js',
  'js/charts.js',
  'js/tables.js',
  'js/filters.js',
  'js/exporter.js',
  'js/app.js'
];

// Load and evaluate files
try {
  for (const f of filesInOrder) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const scriptEl = window.document.createElement('script');
    scriptEl.textContent = code;
    window.document.body.appendChild(scriptEl);
  }
} catch (e) {
  console.error("FAIL: Script evaluation error:", e.stack || e.message);
  process.exit(1);
}

async function runTests() {
  console.log("=== RUNNING SECURITY FUNCTIONAL TESTS ===");
  let failures = 0;

  function assert(condition, message) {
    if (condition) {
      console.log("  PASS: " + message);
    } else {
      console.log("  FAIL: " + message);
      failures++;
    }
  }

  // 1. Rejection of invalid passwords
  window.localStorage.clear();
  const badLogin = await window.AUTH.login(credentials.admin.email, 'WrongPassword@123');
  assert(badLogin.ok === false, "Invalid password rejection");

  // 2. Administrator login (Ahmed Abdallah)
  window.localStorage.clear();
  const adminLogin = await window.AUTH.login(credentials.admin.email, credentials.admin.password);
  assert(adminLogin.ok === true, "Administrator login");
  if (adminLogin.ok) {
    const scope = window.AUTH.getScope();
    assert(scope.unrestricted === true, "Admin account is unrestricted (Allowed BU/Line = ALL)");
  }

  // 3. Line Manager login (CHC, e.g. Ahmed Barakat)
  window.localStorage.clear();
  const chcLogin = await window.AUTH.login(credentials.chc.email, credentials.chc.password);
  assert(chcLogin.ok === true, "CHC Line Manager login");
  if (chcLogin.ok) {
    const scope = window.AUTH.getScope();
    assert(scope.unrestricted === false, "Line Manager is restricted");
    assert(window.AUTH.isBuAllowed('CHC') === true, "CHC manager can view CHC");
    assert(window.AUTH.isLineAllowed('CHC') === true, "CHC manager can view CHC line");
    assert(window.AUTH.isBuAllowed('GIT') === false, "CHC manager CANNOT view GIT BU");
    assert(window.AUTH.isLineAllowed('GIT-I') === false, "CHC manager CANNOT view GIT lines");
  }

  // 4. Line Manager login (GIT, e.g. Nader Khaled)
  window.localStorage.clear();
  const gitLogin = await window.AUTH.login(credentials.git.email, credentials.git.password);
  assert(gitLogin.ok === true, "GIT Line Manager login");
  if (gitLogin.ok) {
    const scope = window.AUTH.getScope();
    assert(window.AUTH.isBuAllowed('GIT') === true, "GIT manager can view GIT");
    assert(window.AUTH.isLineAllowed('GIT-II') === true, "GIT manager can view GIT II line");
    assert(window.AUTH.isBuAllowed('DIAB') === false, "GIT manager CANNOT view Diabetes BU");
    assert(window.AUTH.isLineAllowed('DIAB-IV') === false, "GIT manager CANNOT view Diabetes lines");
  }

  // 5. Line Manager login (Cluster/CVM-I, e.g. Mohamed Elkerdawy)
  window.localStorage.clear();
  const clusterLogin = await window.AUTH.login(credentials.cluster.email, credentials.cluster.password);
  assert(clusterLogin.ok === true, "Cluster/CVM-I Line Manager login");
  if (clusterLogin.ok) {
    const scope = window.AUTH.getScope();
    assert(window.AUTH.isBuAllowed('Cluster') === true, "Cluster manager can view Cluster");
    assert(window.AUTH.isLineAllowed('CVM-I') === true, "Cluster manager can view CVM-I line");
    assert(window.AUTH.isBuAllowed('CHC') === false, "Cluster manager CANNOT view CHC BU");
  }

  // Summary
  console.log("=========================================");
  if (failures > 0) {
    console.log(`RESULT: FAILED with ${failures} assertion errors.`);
    process.exit(1);
  } else {
    console.log("RESULT: ALL SECURITY CHECKS PASSED.");
    process.exit(0);
  }
}

// Run the suite
runTests().catch(err => {
  console.error("Unhandled test execution error:", err);
  process.exit(1);
});
