/**
 * GOLDEN SNAPSHOT — proves the Ask upgrade did not change any dashboard
 * calculation.
 *
 *   node ask_tests/golden.js --write [--role=N] [--group=g]   capture (once, BEFORE any edit)
 *   node ask_tests/golden.js          [--role=N] [--group=g]   compare against the capture
 *
 * Calls every semantic-layer function the Ask adapters depend on, for three
 * roles, hashes each result and compares with the stored hash. Any drift in
 * a dashboard number, for any role, fails the run.
 *
 * Sales calls scan a 629k-row cube (~2s each in jsdom), so work is split into
 * groups that can be run as separate short processes:
 *   groups: sales.official  sales.working  sales.shortage  cov  sfe  iqvia
 */
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { boot, signIn, makeKit } = require("./harness");
const FILE = path.join(__dirname, "golden_semantic.json");
const arg = n => { const a = process.argv.find(x => x.startsWith("--" + n + "=")); return a ? a.split("=")[1] : null; };
const WRITE = process.argv.includes("--write");
const ROLES = ["Mohamed Bakr", "Kamal Allam", "Nader Ahmed Khaled"]; // CEO, BU Manager (DIAB), Line Manager (GIT-II)
const ALL_GROUPS = ["sales.official", "sales.working", "sales.shortage", "cov", "sfe", "iqvia"];

function sha(o) {
  return crypto.createHash("sha256").update(JSON.stringify(o, (k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v))).digest("hex").slice(0, 16);
}

function jobs(w, group) {
  const S = w.SalesDashboard, C = w.CoverageDashboard, F = w.SFEDashboard, I = w.IQVIADashboard, M = w.SEMANTIC;
  const bus = M.BU_LIST.slice(), J = {};
  if (group.startsWith("sales.")) {
    const sc = group.split(".")[1];
    J["sales.bizSummary." + sc] = () => S.getBusinessSummary(sc);
    bus.forEach(bu => {
      J[`sales.brand.${sc}.${bu}`] = () => S.getBrandAchievement(bu, null, false, sc);
      J[`sales.brand.${sc}.${bu}.2026-03`] = () => S.getBrandAchievement(bu, null, false, sc, "2026-03");
      J[`sales.lines.${sc}.${bu}`] = () => S.getLineSalesSummary(bu, null, false, sc);
      J[`sales.ach.${sc}.${bu}`] = () => S.getSalesAchievementSummary(bu, null, false, sc);
      J[`sales.dm.${sc}.${bu}`] = () => S.getDmSalesSummary(bu, null, null, sc);
      J[`sales.item.${sc}.${bu}`] = () => S.getItemAchievement(bu, null, null, sc);
    });
    if (sc === "official") J["sales.months"] = () => S.getAvailableMonths();
  } else if (group === "cov") {
    J["cov.biz"] = () => C.getBusinessSummary();
    J["cov.filtered"] = () => C.getFilteredCoverageSummary();
    J["cov.corp"] = () => C.getCorporateCoverageTotals();
    J["cov.workload"] = () => C.getExecutionWorkloadSummary();
    bus.forEach(bu => {
      J["cov.line." + bu] = () => C.getFilteredCoverageForLine(bu, null);
      J["cov.type." + bu] = () => C.getFilteredCoverageByType(bu, null);
      J["cov.breakdown." + bu] = () => C.getLineAndTerritoryBreakdown(bu);
    });
  } else if (group === "sfe") {
    J["sfe.biz"] = () => F.getBusinessSummary();
    bus.forEach(bu => { J["sfe.hc." + bu] = () => F.getFilteredHeadcountForLine(bu, null); });
  } else if (group === "iqvia") {
    J["iqvia.biz"] = () => I.getBusinessSummary();
  }
  return J;
}

const roleIdx = arg("role"), groupArg = arg("group");
const roles = roleIdx === null ? ROLES : [ROLES[+roleIdx]];
const groups = groupArg ? groupArg.split(",") : ALL_GROUPS;
const gold = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { snap: {} };
const kit = makeKit("GOLDEN dashboard-calculation snapshot");

for (const who of roles) {
  const { window: w } = boot();
  signIn(w, who);
  let n = 0, bad = [];
  gold.snap[who] = gold.snap[who] || {};
  for (const g of groups) {
    const J = jobs(w, g);
    for (const k of Object.keys(J)) {
      let h; try { h = sha(J[k]()); } catch (e) { h = "ERR:" + String(e.message).slice(0, 50); }
      n++;
      if (WRITE) gold.snap[who][k] = h;
      else if (gold.snap[who][k] !== h) bad.push(k);
    }
  }
  if (!WRITE) kit.check(bad.length === 0, `${who}: ${n} semantic calls unchanged [${groups.join(",")}]`, bad.slice(0, 5).join(", "));
  else console.log("captured", who, n, "calls [" + groups.join(",") + "]");
}
if (WRITE) { gold.written = new Date().toISOString(); fs.writeFileSync(FILE, JSON.stringify(gold, null, 1)); }
else kit.done();
