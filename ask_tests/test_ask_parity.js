/**
 * P0 #3 / #4 — PARITY: an Ask answer must equal the dashboard's own number, computed here by calling the
 * dashboard's own functions directly (never through the Ask providers).
 *
 *   node ask_tests/test_ask_parity.js --role=0|1|2 [--only=coverage,sales,sfe,scenario,domains]
 *
 * Covers: Coverage %, Right Frequency %, Sales Achievement %, Shortage-target scenario, Sick-leave exclusion,
 * plus SFE, Field Working Days, Coaching, Sprint, IQVIA, IMS Rx, Market Intelligence, To-Market.
 * Tolerance: 0.05 percentage points (the precision an answer is shown to), or 0.5 units for counts.
 */
"use strict";
const L = require("./lib_ask");
const ROLES = [["CEO", "Mohamed Bakr"], ["BU Manager", "Kamal Allam"], ["Line Manager", "Nader Ahmed Khaled"]];
const arg = n => { const a = process.argv.find(x => x.startsWith("--" + n + "=")); return a ? a.split("=")[1] : null; };
const ri = +(arg("role") || 0), only = (arg("only") || "coverage,sales,sfe,scenario,domains").split(",");
const [tag, who] = ROLES[ri];
const kit = L.makeKit("Ask ↔ dashboard parity — " + tag + " (" + who + ")");
const w = L.open(who);
const num = s => { const m = String(s).replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
const near = (a, b, tol) => typeof a === "number" && typeof b === "number" && !isNaN(a) && !isNaN(b) && Math.abs(a - b) <= (tol === undefined ? 0.05 : tol);
const fmt = x => (typeof x === "number" ? (Math.round(x * 1e4) / 1e4) : String(x));
function eq(label, askVal, dashVal, tol) { kit.check(near(askVal, dashVal, tol), label + "  [Ask " + fmt(askVal) + " · dashboard " + fmt(dashVal) + "]"); }
const rowMap = r => { const m = {}; (r.rows || []).forEach(x => { m[x.name] = num((x.cells || [])[0]); }); return m; };
const S = w.SalesDashboard, SEM = w.SEMANTIC, AUTH = w.AUTH;
const scn = () => AUTH.getActiveScenario();
const allowedBUs = () => AUTH.filterAllowedBUs(SEM.BU_LIST.slice());
const evOf = (r, k) => ((r.evidence || []).filter(e => e[0] === k)[0] || [])[1];

// ----------------------------------------------------------------------------------------------
if (only.includes("coverage") && AUTH.canViewCoverage()) {
  kit.section("Coverage tab: Coverage % · Right Frequency % · sick-leave rule");
  const A = w.eval("Analytics"), CS = w.eval("CacheStore"), d = CS.getDashboard().dimensions;
  const scoped = AUTH.getScope().lines !== null;
  const teams = (d.teams || []).filter(t => !scoped || AUTH.isLineAllowed(t));
  const run = (extra) => { const f = Object.assign(A.defaultFilters(), extra || {}); if (scoped && !(extra && extra.team)) f.team = teams; return A.run(f).kpis; };
  let k = run(); let r = L.ask(w, "coverage", "what is the coverage %");
  eq("Coverage % (tab default, all loaded months pooled)", r.value, k.coveragePct * 100);
  r = L.ask(w, "coverage", "right frequency"); eq("Right Frequency % (tab default)", r.value, k.rightFreqPct * 100);
  k = run({ period: ["March"] }); r = L.ask(w, "coverage", "coverage in March 2026"); eq("Coverage % — March 2026 only", r.value, k.coveragePct * 100);
  r = L.ask(w, "coverage", "right frequency in March 2026"); eq("Right Frequency % — March 2026 only", r.value, k.rightFreqPct * 100);
  k = run({ period: ["July"] }); r = L.ask(w, "coverage", "coverage in July 2026"); eq("Coverage % — July 2026 only", r.value, k.coveragePct * 100);

  // Sick-leave rule, recomputed from the raw rows (isActive = 1, isExempt = 0 → evaluated population).
  const recs = CS.getRecords(); const rows = recs.rows || recs;
  const teamOK = new Set(teams.map(t => d.teams.indexOf(t)));
  let cA = 0, nA = 0, cE = 0, nE = 0, rfE = 0, exempt = 0;
  rows.forEach(x => { if (!x[15]) return; if (scoped && !teamOK.has(x[1])) return; cA += x[12]; nA++; if (x[24]) { exempt++; return; } cE += x[12]; rfE += x[13]; nE++; });
  r = L.ask(w, "coverage", "what is the coverage %");
  eq("Sick-leave rule: Ask = evaluated population (active, non-flagged rep-periods) recomputed from raw rows", r.value, 100 * cE / nE, 0.01);
  if (exempt > 0) kit.check(Math.abs(100 * cE / nE - 100 * cA / nA) > 1e-6 || exempt === 0, "Sick-leave rule matters here: " + exempt + " flagged rep-period rows exist; including them would give " + fmt(100 * cA / nA) + "% not " + fmt(100 * cE / nE) + "%");
  kit.check(exempt === 0 || Math.abs(r.value - 100 * cA / nA) > 0.01, "Ask does NOT use the unfiltered (flagged-included) figure " + fmt(100 * cA / nA));
  kit.check((r.caveats || []).some(c => /Sick-leave rule/.test(c)), "the answer states the sick-leave rule in its caveats");
  r = L.ask(w, "coverage", "right frequency"); eq("Sick-leave rule applies to Right Frequency % too", r.value, 100 * rfE / nE, 0.01);

  // by line / by DM rows equal a fresh Analytics.run with that team / manager filter
  r = L.ask(w, "coverage", "coverage by line"); const bl = rowMap(r);
  const names = Object.keys(bl).slice(0, 4); let okAll = names.length > 0;
  names.forEach(n => { const tm = teams.filter(t => SEM.normalizeLine(t) === n); const kk = run({ team: tm }); eq("Coverage % by line — " + n, bl[n], kk.coveragePct * 100); });
  r = L.ask(w, "coverage", "top 3 district managers by coverage"); const bd = rowMap(r);
  Object.keys(bd).slice(0, 3).forEach(n => { const kk = run({ manager: [n] }); eq("Coverage % of DM — " + n, bd[n], kk.coveragePct * 100); });

  // Operational coverage (the Executive / "Operational & Execution" definition) is its own definition. The Executive card's
  // headline is the LATEST month (coveragePctLatest) with the pooled YTD figure as its comparison, so Ask must match both.
  const CD = w.CoverageDashboard;
  allowedBUs().slice(0, 3).forEach(bu => {
    const line = AUTH.getScope().lines !== null ? AUTH.getScope().lines[0] : null;
    const dash = CD.getFilteredCoverageForLine(bu, line);
    if (!dash || !dash.ok) return;
    const nm = line || bu;
    let q = L.ask(w, "coverage", "operational coverage % of " + nm);
    if (q.ok && typeof q.value === "number") eq("Operational coverage % — " + nm + " default = the Executive card headline (latest month)", q.value, dash.coveragePctLatest);
    else kit.check(false, "Operational coverage question answered for " + nm, q.message || q.headline);
    q = L.ask(w, "coverage", "operational coverage % of " + nm + " YTD");
    if (q.ok && typeof q.value === "number") eq("Operational coverage % — " + nm + " YTD = the card's pooled comparison figure", q.value, dash.coveragePct);
    else kit.check(false, "Operational coverage YTD question answered for " + nm, q.message || q.headline);
  });
}

// ----------------------------------------------------------------------------------------------
if (only.includes("sales")) {
  kit.section("Sales Achievement % · value · target (scenario = " + scn() + ")");
  const sc = scn(); let A = 0, T = 0;
  allowedBUs().forEach(bu => {
    const s = S.getSalesAchievementSummary(bu, null, false, sc);
    if (!s || !s.ok) return;
    A += s.actualYTD; T += s.targetYTD;
    let r = L.ask(w, "sales", "sales achievement of " + bu); eq("Sales Achievement % — " + bu + " YTD", r.value, s.achievementPct);
    r = L.ask(w, "sales", "sales value of " + bu); eq("Sales value — " + bu + " YTD (EGP)", r.value, s.actualYTD, 1);
    r = L.ask(w, "sales", "sales target of " + bu); eq("Sales target — " + bu + " YTD (EGP)", r.value, s.targetYTD, 1);
    const ln = S.getLineSalesSummary(bu, null, false, sc);
    if (ln && ln.ok && ln.lines.length) {
      const rl = L.ask(w, "sales", "sales achievement by line in " + bu); const m = rowMap(rl);
      ln.lines.slice(0, 5).forEach(x => { if (m[x.name] !== undefined) eq("Sales Achievement % by line — " + x.name, m[x.name], x.achievementPct); else kit.check(false, "line " + x.name + " present in the Ask by-line answer for " + bu); });
    }
    const m3 = S.getSalesAchievementSummary(bu, null, false, sc, "2026-03");
    if (m3 && m3.ok && m3.achievementPct !== undefined && m3.achievementPct !== s.achievementPct) { r = L.ask(w, "sales", "sales achievement of " + bu + " in March 2026"); eq("Sales Achievement % — " + bu + " March 2026 (single month)", r.value, m3.achievementPct); }
  });
  const r = L.ask(w, "sales", "what is the sales achievement");
  eq("Sales Achievement % — whole scope (Σ actual ÷ Σ target across your BUs)", r.value, 100 * A / T);
  const br = L.ask(w, "sales", "sales achievement"); kit.check(/Target|Official|Working|Shortage/i.test(String(evOf(br, "Target basis"))), "the answer names its target basis: " + evOf(br, "Target basis"));
}

// ----------------------------------------------------------------------------------------------
if (only.includes("scenario")) {
  kit.section("Target scenarios (Official / Working / Shortage) — the answer follows the dashboard's own active scenario");
  const canShort = AUTH.canViewTargetShortage();
  const bus = allowedBUs();
  const check = (sc) => {
    AUTH.setActiveScenario(sc); try { w.AskQuery.invalidate(); } catch (e) {} try { w.AskSales.invalidate(); } catch (e) {}
    const active = scn();
    bus.forEach(bu => {
      const s = S.getSalesAchievementSummary(bu, null, false, active);
      if (!s || !s.ok) return;
      const r = L.ask(w, "sales", "sales achievement of " + bu);
      eq("[" + sc + " → active " + active + "] Sales Achievement % — " + bu, r.value, s.achievementPct);
      kit.check(new RegExp(active, "i").test(String(evOf(r, "Target basis"))), "[" + active + "] " + bu + ": the answer's Target basis says “" + evOf(r, "Target basis") + "”");
    });
    return active;
  };
  const dflt = scn(); const rowsBefore = {};
  bus.forEach(bu => { const s = S.getSalesAchievementSummary(bu, null, false, "official"), h = S.getSalesAchievementSummary(bu, null, false, "shortage"); if (s && h && s.ok && h.ok) rowsBefore[bu] = [s.achievementPct, h.achievementPct]; });
  if (canShort) {
    const active = check("shortage");
    kit.check(active === "shortage", "this account may switch to the Shortage target (AUTH.canViewTargetShortage) and the scenario took effect", active);
    const differing = Object.keys(rowsBefore).filter(b => Math.abs(rowsBefore[b][0] - rowsBefore[b][1]) > 0.01);
    kit.check(differing.length > 0 || bus.length === 1, "Shortage really differs from Official for at least one BU in scope (" + (differing.join(", ") || "none") + ") — so the test is not vacuous");
    differing.slice(0, 1).forEach(bu => {
      AUTH.setActiveScenario("shortage"); const a = L.ask(w, "sales", "sales achievement of " + bu);
      AUTH.setActiveScenario("official"); try { w.AskQuery.invalidate(); w.AskSales.invalidate(); } catch (e) {} const b = L.ask(w, "sales", "sales achievement of " + bu);
      kit.check(Math.abs(a.value - b.value) > 0.01, bu + ": Shortage answer (" + fmt(a.value) + ") differs from Official answer (" + fmt(b.value) + ")");
    });
    check("official");
  } else {
    AUTH.setActiveScenario("shortage");
    kit.check(scn() !== "shortage", "this account may NOT use the Shortage target: the dashboard refuses to activate it (active stays " + scn() + ") and so does Ask");
  }
  AUTH.setActiveScenario(dflt); try { w.AskQuery.invalidate(); w.AskSales.invalidate(); } catch (e) {}
  if (AUTH.canViewTargetShortage()) { /* covered above */ } else {
    const r = L.ask(w, "sales", "sales achievement of " + bus[0]); kit.check(r.ok, "default-scenario answer still works after the scenario probe"); 
  }
}

// ----------------------------------------------------------------------------------------------
if (only.includes("sfe") && AUTH.canViewSfe()) {
  kit.section("SFE / organogram");
  const F = w.SFEDashboard;
  const lines = SEM.BU_LIST.length ? Object.keys(SEM.CANONICAL_LINE_TO_BU).filter(l => AUTH.isLineAllowed(l)) : [];
  lines.slice(0, 5).forEach(line => {
    const s = F.getFilteredHeadcountForLine(SEM.CANONICAL_LINE_TO_BU[line], line);
    if (!s || !s.ok) return;
    const r = L.ask(w, "sfe", "vacancy rate of " + line); eq("Vacancy rate — " + line, r.value, s.vacancyRatePct);
    const h = L.ask(w, "sfe", "active headcount of " + line); if (h.ok && typeof h.value === "number") eq("Active headcount — " + line, h.value, s.headcountActive, 0.5);
  });
}

// ----------------------------------------------------------------------------------------------
if (only.includes("domains")) {
  kit.section("Field Working Days · Coaching · Sprint · IQVIA · IMS Rx · Market Intelligence · To-Market");
  if (AUTH.canViewWorkingDays()) {
    const a = w.WorkingDaysDashboard.askApi();
    if (a) {
      const mk = a.availableMonths[a.availableMonths.length - 1];
      const dash = a.computeAgg(a.rows("DM_DSM", mk)).avgFieldPct;
      const r = L.ask(w, "workingdays", "average field working days");
      eq("Avg Field Working Days % (DM/DSM, latest month " + mk + ") = page computeAgg over the page's scoped rows", r.value, dash * 100);
      kit.check(/DM/.test(String(evOf(r, "Tier"))) && (r.assumptions || []).some(x => /No tier named/.test(x)), "the default tier is disclosed as an assumption");
    } else kit.check(false, "Working Days accessor available");
  }
  if (AUTH.canViewCoaching()) {
    const a = w.CoachingDashboard.askApi();
    if (a) {
      const own = a.managers.filter(m => a.isOwnTier(m)); const g = a.aggregateOwnTier(own, "ALL");
      const r = L.ask(w, "coaching", "what is the DV coverage % YTD");
      if (r.ok && typeof r.value === "number") eq("Coaching DV Coverage % (YTD) = page aggregateOwnTier(own tier, ALL).coveragePct", r.value, g.coveragePct);
      else kit.check(false, "Coaching DV coverage answered", r.message || r.headline);
    } else kit.check(false, "Coaching accessor available");
  }
  if (AUTH.canViewSprint()) {
    const a = w.SprintDashboard.askApi();
    if (a) {
      const r = L.ask(w, "sprint", "top 3 district managers by sprint points"); const m = rowMap(r);
      const data = a.data(a.liveMonth); let checked = 0;
      Object.keys(m).forEach(n => { let found = null; (function walk(x, dep) { if (found || !x || dep > 5) return; if (Array.isArray(x)) x.forEach(y => walk(y, dep + 1)); else if (typeof x === "object") { if (x.name === n && typeof x.totalPts === "number") { found = x; return; } Object.keys(x).forEach(k => walk(x[k], dep + 1)); } })(data, 0);
        if (found) { eq("Sprint points — " + n + " = page-stored totalPts", m[n], found.totalPts, 0.06); checked++; } });
      kit.check(checked > 0, "at least one ranked Sprint row was matched to the page's stored totalPts (" + checked + ")");
    } else kit.check(false, "Sprint accessor available");
  }
  if (AUTH.canViewIqvia()) {
    const bs = w.IQVIADashboard.getBusinessSummary(); const r = L.ask(w, "iqvia", "zeta market share by business unit"); const m = rowMap(r);
    Object.keys(m).forEach(bu => { if (bs.bu && bs.bu[bu]) eq("IQVIA Zeta market share (MAT) — " + bu + " = Executive BU card", m[bu], bs.bu[bu].marketShareMATPct); });
    kit.check(Object.keys(m).length > 0, "IQVIA BU share rows returned (" + Object.keys(m).join(", ") + ")");
  }
  if (AUTH.canViewImsRx()) {
    const a = w.ImsRxDashboard.askApi(); const k = a.kpis(); const r = L.ask(w, "imsrx", "total prescriptions");
    eq("IMS Rx total (default period) = page KPI total2025", r.value, k.total2025, 1);
    const y = L.ask(w, "imsrx", "rx growth vs last year"); if (y.ok && typeof y.value === "number") eq("IMS Rx YoY % = page KPI yoy", y.value, k.yoy * 100, 0.06);
  }
  if (AUTH.canViewMarketIntel()) {
    const MI = w.MarketIntelligence; MI._decodeCache(); const X = MI._internals(); X.resetFilters(); const K = X.buildKpis();
    const card = id => K.cards.filter(c => c.id === id)[0];
    const r = L.ask(w, "marketintel", "what is the total market size"); eq("Market intelligence total value = KPI card", r.value, card("mktValue").spark[card("mktValue").spark.length - 1], 1);
    const g = L.ask(w, "marketintel", "market CAGR"); if (g.ok) eq("Market CAGR % = KPI card growthPct", g.value, card("mktValue").growthPct, 0.06);
  }
  if (typeof w.tomarketAllowedBU === "function" && w.tomarketAllowedBU() !== false && w.ExecutiveDashboard.askTmsIms) {
    const a = w.ExecutiveDashboard.askTmsIms();
    if (a && a.ok) {
      const bu = a.canAll() ? "All" : a.allowedBUs()[0]; const m = a.metrics(bu, null);
      const r = L.ask(w, "tomarket", "what is the pull-through rate" + (bu === "All" ? "" : " of " + bu));
      eq("To-Market pull-through % (" + bu + ") = getTmsImsMetrics", r.value, m.pullThroughRate !== undefined ? m.pullThroughRate : m.pullThrough, 0.06);
      const s = L.ask(w, "tomarket", "distributor stock days" + (bu === "All" ? "" : " of " + bu)); eq("To-Market stock days (" + bu + ") = getTmsImsMetrics", s.value, m.stockDays, 0.06);
    }
  }
}
kit.done();
