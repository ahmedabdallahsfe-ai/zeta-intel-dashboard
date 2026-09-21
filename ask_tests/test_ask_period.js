/** AskPeriod unit tests — pure text/availability logic, no dashboard boot. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { makeKit } = require("./harness");
const ctx = { window: {} }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "ask-period.js"), "utf8"), ctx);
const P = ctx.AskPeriod;
const kit = makeKit("AskPeriod");

const SALES = { name: "Sales", months: ["2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07"] };
const COV = { name: "Coverage", months: ["2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08"] };
const IQV = { name: "IQVIA", months: ["2025-01","2025-02","2025-03","2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04"] };

function keys(q, avail) { const r = P.interpret(q, avail); return r.primary.keys.join(","); }
function eq(q, avail, want, msg) { const got = keys(q, avail); kit.check(got === want, (msg || q) + "  [" + avail.name + "]", "got " + got + " want " + want); }

kit.section("months");
eq("sales in July", SALES, "2026-07");
eq("sales in Jul 2026", SALES, "2026-07");
eq("sales for 2026-03", SALES, "2026-03");
eq("coverage 07/2026", COV, "2026-07");
eq("DIAB sales in June", SALES, "2026-06");
eq("sales in Aug", SALES, "", "August not loaded in Sales -> no keys");
eq("coverage in August", COV, "2026-08");
eq("what did we sell in may", SALES, "2026-05", "lower-case 'may' after 'in'");
eq("may I see sales", SALES, "2026-07", "the verb 'may' is not a month");
eq("sales Jan, Feb and Mar", SALES, "2026-01,2026-02,2026-03", "explicit month set");
eq("Zeta share in Mar 2025", IQV, "2025-03");

kit.section("relative / latest / YTD / MTD");
eq("sales", SALES, "2026-07", "no period -> latest");
eq("sales this month", SALES, "2026-07");
eq("sales last month", SALES, "2026-06", "last month = before latest loaded");
eq("coverage last month", COV, "2026-07");
eq("sales YTD", SALES, "2026-01,2026-02,2026-03,2026-04,2026-05,2026-06,2026-07");
eq("coverage year to date", COV, "2026-02,2026-03,2026-04,2026-05,2026-06,2026-07,2026-08");
eq("sales MTD", SALES, "2026-07");
eq("sales for the last 3 months", SALES, "2026-05,2026-06,2026-07");
eq("sales past three months", SALES, "2026-05,2026-06,2026-07");

kit.section("quarters / halves");
eq("sales Q1", SALES, "2026-01,2026-02,2026-03");
eq("sales Q2 2026", SALES, "2026-04,2026-05,2026-06");
eq("sales Q3", SALES, "2026-07", "Q3 is partial: only Jul loaded");
eq("coverage third quarter", COV, "2026-07,2026-08");
eq("sales S1", SALES, "2026-01,2026-02,2026-03,2026-04,2026-05,2026-06");
eq("sales H1 2026", SALES, "2026-01,2026-02,2026-03,2026-04,2026-05,2026-06");
eq("sales second half", SALES, "2026-07", "H2 partial");
eq("sales last quarter", SALES, "2026-04,2026-05,2026-06", "relative to latest month Jul -> Q2");
eq("Zeta share Q4 2025", IQV, "2025-10,2025-11,2025-12");

kit.section("ranges");
eq("sales from Feb to May", SALES, "2026-02,2026-03,2026-04,2026-05");
eq("sales between March and June", SALES, "2026-03,2026-04,2026-05,2026-06");
eq("sales Feb-Jun", SALES, "2026-02,2026-03,2026-04,2026-05,2026-06");
eq("sales from January through April 2026", SALES, "2026-01,2026-02,2026-03,2026-04");
eq("coverage between Jun and Aug", COV, "2026-06,2026-07,2026-08");

kit.section("selected period");
{
  const r = P.interpret("coverage in the current selected period", { name: "Coverage", months: COV.months, selected: ["2026-06", "2026-07"] });
  kit.check(r.primary.keys.join() === "2026-06,2026-07", "selected period comes from the page's own filter");
  const r2 = P.interpret("coverage in the current selected period", COV);
  kit.check(r2.primary.keys.join() === "2026-08" && /no period selector/.test(r2.primary.assumption), "selected period without a page selector -> latest, stated as an assumption");
}

kit.section("comparisons");
{
  let r = P.interpret("sales MoM", SALES);
  kit.check(r.primary.keys.join() === "2026-07" && r.cmp.type === "mom" && r.secondary.keys.join() === "2026-06", "MoM: latest vs previous month");
  r = P.interpret("sales in May vs last month", SALES);
  kit.check(r.cmp && r.cmp.type === "mom", "'vs last month' is a MoM comparison keyword", JSON.stringify(r.cmp));
  r = P.interpret("July vs June sales", SALES);
  kit.check(r.cmp.type === "vs" && r.primary.keys.join() === "2026-07" && r.secondary.keys.join() === "2026-06", "explicit pair 'July vs June'");
  r = P.interpret("Q2 vs Q1", SALES);
  kit.check(r.cmp.type === "vs" && r.primary.keys.length === 3 && r.secondary.keys.length === 3 && r.primary.keys[0] === "2026-04" && r.secondary.keys[0] === "2026-01", "'Q2 vs Q1'");
  r = P.interpret("sales YoY", SALES);
  kit.check(r.cmp.type === "yoy" && !r.secondary.ok && /needs .*2025/.test(r.secondary.note), "YoY on data with no prior year -> states what is missing", r.secondary.note);
  r = P.interpret("Zeta share YoY", IQV);
  kit.check(r.cmp.type === "yoy" && r.primary.keys.join() === "2026-04" && r.secondary.keys.join() === "2025-04", "YoY on multi-year data: Apr-26 vs Apr-25");
  r = P.interpret("sales vs same period last year", SALES);
  kit.check(r.cmp.type === "yoy", "'vs same period last year' is YoY");
  r = P.interpret("sales trend by month", SALES);
  kit.check(r.trend === true, "trend keyword");
  r = P.interpret("compare DIAB vs GIT", SALES);
  kit.check(r.cmp === null && !r.typed, "entity comparison is not a period comparison");
  r = P.interpret("MoM for Q2", SALES);
  kit.check(r.primary.keys.length === 3 && r.secondary.keys.join() === "2026-01,2026-02,2026-03", "MoM on a 3-month window compares with the previous 3 months");
}

kit.section("availability honesty");
{
  let r = P.resolve(P.parse("sales in August").specs[0], SALES);
  kit.check(!r.ok && r.missing.join() === "2026-08" && /holds Jan–Jul 2026/.test(r.note), "missing month reported with what IS loaded", r.note);
  r = P.resolve(P.parse("sales Q3").specs[0], SALES);
  kit.check(r.ok && r.partial && /only Jul 2026/.test(r.note), "partial quarter flagged", r.note);
  r = P.resolve(P.parse("coverage in January").specs[0], COV);
  kit.check(!r.ok, "Coverage has no January");
  r = P.resolve(null, SALES);
  kit.check(r.ok && /latest loaded month/.test(r.assumption), "no period typed -> assumption stated");
  r = P.resolve(P.parse("sales in July").specs[0], SALES);
  kit.check(r.assumption && /read as 2026/.test(r.assumption), "year defaulted -> stated");
  r = P.resolve(P.parse("sales in Jul 2026").specs[0], SALES);
  kit.check(!r.assumption, "explicit year -> no assumption");
}

kit.section("stripTime");
kit.check(P.stripTime("DIAB sales in July 2026 vs June") === "DIAB sales in vs", "time words removed", P.stripTime("DIAB sales in July 2026 vs June"));
kit.check(/Zeta/.test(P.stripTime("Zeta share Q3")), "entity kept");
kit.done();
