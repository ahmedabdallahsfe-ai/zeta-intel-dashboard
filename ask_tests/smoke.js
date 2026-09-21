const { boot, signIn } = require("./harness");
const t0 = Date.now();
const { window: w, errors, loadErrors, files } = boot();
console.log("booted", files.length, "files in", Date.now() - t0, "ms");
console.log("loadErrors:", loadErrors);
console.log("errors:", errors.slice(0, 5));
["AUTH","SEMANTIC","SalesDashboard","CoverageDashboard","SFEDashboard","AskEngine","AskSales","AskCoverage","AskSFE","AskExecutive","CacheLoader","COACHING_CACHE","CacheStore","SprintDashboard","WorkingDaysDashboard","CoachingDashboard","IQVIA_CACHE","IMS_RX_CACHE","MARKET_INTEL_CACHE"].forEach(k => console.log(k, typeof w[k]));
console.log("users:", Object.keys((w.IQVIA_CACHE && w.IQVIA_CACHE.users) || w.AUTH_USERS || {}).length);
console.log(signIn(w, "Kamal Allam").role, JSON.stringify(w.AUTH.getScope()));
