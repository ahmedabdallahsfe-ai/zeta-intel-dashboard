(function(g){(g.AskBuild=g.AskBuild||{})["ask-query.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — reusable query layer (AskQuery)
 * ============================================================================
 *
 * NOT a list of FAQs. One generic pipeline that every page and every domain
 * runs through:
 *
 *   QUESTION
 *     -> INTENT      what kind of answer is wanted (value / rank / compare /
 *                    breakdown / trend / drivers / why / evidence / executive)
 *     -> TIME        AskPeriod: month, YTD, MTD, Qn, S1/H1, MoM, YoY, range
 *     -> FILTERS     entities named in the question (BU, line, brand, DM, rep…)
 *     -> AUTHORISED  the provider only ever sees rows the signed-in user may
 *        DATA        see (scope is applied by the dashboard's own AUTH calls,
 *                    and the entity vocabulary is built through the same scope)
 *     -> DASHBOARD   the provider calls the dashboard's EXISTING semantic
 *        CALCULATION functions. AskQuery computes no business KPI itself.
 *     -> ANSWER      headline + table
 *     -> EVIDENCE    measure definition, formula, period, scope, basis,
 *                    caveats, assumptions, source
 *     -> DRILL-DOWN  follow-up questions the user can click
 *
 * PROVIDERS
 * ---------
 * A provider adapts ONE dashboard domain (Sales, Coverage, SFE, Coaching,
 * Sprint, Working Days, IQVIA, IMS Rx, To-Market) to this layer:
 *
 *   {
 *     id, label, tabs:[...],            // which pages it is the natural home of
 *     canUse(),                         // the domain's own AUTH.canView* gate
 *     requires:[cacheKey],              // CacheLoader keys that must be loaded
 *     measures:[{ id, label, unit, better, aliases:[...], def, formula,
 *                 grains:[dimKey...], kind?:"list" }],
 *     dims:{ dimKey:{ label } },
 *     hierarchy:{ dimKey: childDimKey },
 *     vocab():{ dimKey:[names] },       // scoped entity vocabulary
 *     availability(): { months:[YYYY-MM], selected?, name, snapshot? },
 *     scopeLabel(), sourceNote(),
 *     fetch(req): { ok, rows:[{name, v:{measureId:number}, aux?}], total?,
 *                   basis:[[k,v]], formula, caveats, asOf }   |  { ok:false, missing }
 *   }
 *
 * The provider is where "use the dashboard's own calculation" is enforced:
 * every number in `rows`/`total` must come from an existing function of the
 * dashboard. tests/ask parity suites recompute the same figures through the
 * dashboard's own cards and assert equality.
 *
 * WHAT IS NEVER DONE
 * ------------------
 *  - No invented, inferred or interpolated value. If the dashboard cannot
 *    answer, the answer says exactly what data is missing.
 *  - No silent default for BU / Line / period / measure. Every choice the
 *    layer makes on the user's behalf is listed under "Assumptions".
 *  - No unscoped access: an entity outside the user's scope is not in the
 *    vocabulary, so it cannot be named, ranked, totalled or shown.
 */
(function (global) {
  "use strict";

  function E() { return global.AskEngine; }
  function P() { return global.AskPeriod; }

  // =========================================================================
  // Registry
  // =========================================================================
  var _providers = [];
  function registerProvider(p) {
    _providers = _providers.filter(function (x) { return x.id !== p.id; });
    _providers.push(p);
    _measureIndex = null;
  }
  function providers() { return _providers.slice(); }
  function providerById(id) { return _providers.filter(function (p) { return p.id === id; })[0] || null; }
  function usable(p) { try { return p.canUse ? !!p.canUse() : true; } catch (e) { return false; } }

  var _measureIndex = null;
  /** All measures of every provider, with their provider attached. */
  function measureIndex() {
    if (_measureIndex) return _measureIndex;
    var out = [];
    _providers.forEach(function (p) {
      (p.measures || []).forEach(function (m) {
        var phrases = (m.aliases || []).map(function (a) { return E().normalise(a); }).filter(Boolean);
        out.push({ m: m, p: p, phrases: phrases });
      });
    });
    _measureIndex = out;
    return out;
  }
  function measureById(id) {
    var mi = measureIndex().filter(function (x) { return x.m.id === id; })[0];
    return mi ? mi.m : null;
  }
  function providerOfMeasure(id) {
    var mi = measureIndex().filter(function (x) { return x.m.id === id; })[0];
    return mi ? mi.p : null;
  }

  // =========================================================================
  // Dimension vocabulary (words that name a grouping)
  // =========================================================================
  var DIM_WORDS = {
    bu:        { label: "Business Unit", words: ["bu", "bus", "business unit", "business units", "cluster"] },
    line:      { label: "Line", words: ["line", "lines", "team", "teams"] },
    brand:     { label: "Brand", words: ["brand", "brands"] },
    item:      { label: "Product", words: ["product", "products", "sku", "skus", "item", "items", "presentation", "presentations"] },
    molecule:  { label: "Molecule", words: ["molecule", "molecules", "generic", "generics"] },
    dosage:    { label: "Dosage form", words: ["dosage form", "dosage forms", "dosage", "form", "forms"] },
    atc3:      { label: "ATC3 class", words: ["atc3", "atc 3", "atc3 class", "atc3 classes"] },
    atc4:      { label: "ATC4 class", words: ["atc", "atc4", "atc 4", "atc class", "atc classes"] },
    ta:        { label: "Therapeutic area", words: ["therapeutic area", "therapeutic areas", "ta", "tas"] },
    corp:      { label: "Corporation", words: ["corporation", "corporations", "company", "companies", "competitor", "competitors", "manufacturer", "manufacturers"] },
    market:    { label: "Market", words: ["market", "markets", "segment", "segments", "dm1", "dm 1"] },
    market2:   { label: "Market (DM2)", words: ["dm2", "dm 2", "sub market", "sub markets", "narrow market", "narrow markets"] },
    dm:        { label: "District Manager", words: ["dm", "dms", "dsm", "dsms", "district manager", "district managers", "district sales manager", "district sales managers", "supervisor", "supervisors", "ffs", "manager", "managers", "coach", "coaches"] },
    am:        { label: "Area Manager", words: ["asm", "asms", "area manager", "area managers", "area sales manager"] },
    nsm:       { label: "National Sales Manager", words: ["nsm", "nsms", "national sales manager", "national sales managers"] },
    rep:       { label: "Representative", words: ["rep", "reps", "representative", "representatives", "medical rep", "medical reps", "medical representative", "medical representatives", "msr", "msrs", "employee", "employees", "people", "person", "staff", "salesperson", "salespeople"] },
    territory: { label: "Territory", words: ["territory", "territories", "position", "positions", "brick", "bricks"] },
    specialty: { label: "Specialty", words: ["specialty", "specialties", "speciality", "specialities"] },
    klass:     { label: "Customer class", words: ["class", "classes"] },
    ctype:     { label: "Customer type", words: ["customer type", "customer types", "type", "types"] },
    month:     { label: "Month", words: ["month", "months", "monthly"] },
    tier:      { label: "Tier", words: ["tier", "tiers", "level", "levels", "role", "roles"] },
    bm:        { label: "Brand Manager", words: ["brand manager", "brand managers", "bm", "bms"] },
    profile:   { label: "Profile", words: ["profile", "profiles"] },
    physician: { label: "Physician", words: ["physician", "physicians", "doctor", "doctors", "hcp", "hcps", "prescriber", "prescribers"] },
    region:    { label: "Region", words: ["region", "regions", "governorate", "governorates", "geography", "geographies"] },
    kpi:       { label: "KPI", words: ["kpi", "kpis"] }
  };
  var DIM_PHRASE_INDEX = null;
  function dimPhraseIndex() {
    if (DIM_PHRASE_INDEX) return DIM_PHRASE_INDEX;
    var out = [];
    Object.keys(DIM_WORDS).forEach(function (k) {
      DIM_WORDS[k].words.forEach(function (w) { out.push({ key: k, phrase: E().normalise(w) }); });
    });
    out.sort(function (a, b) { return b.phrase.length - a.phrase.length; });
    DIM_PHRASE_INDEX = out;
    return out;
  }

  /** Dimension named after a group-by cue: "by brand", "per line", "each dm",
   *  "top 10 brands", "which line", "bottom territories", "across bus". */
  function groupByFromText(nq) {
    var idx = dimPhraseIndex();
    var cue = /\b(?:by|per|each|every|across|for each|split by|breakdown by|broken down by|grouped by|among|which|what)\s+(?:the\s+)?(?:\d+\s+)?/;
    var m = cue.exec(nq);
    if (m) {
      var rest = " " + nq.slice(m.index + m[0].length) + " ";
      for (var i = 0; i < idx.length; i++) {
        if (rest.indexOf(" " + idx[i].phrase + " ") === 0 || rest.indexOf(" " + idx[i].phrase + " ") === 1 - 1) return idx[i].key;
      }
    }
    // "top 10 brands", "bottom 5 territories", "highest performing dsms"
    var rk = /\b(?:top|bottom|best|worst|highest|lowest|biggest|largest|smallest|leading|weakest|strongest)(?:\s+performing)?\s+(?:\d+\s+)?/.exec(nq);
    if (rk) {
      var rest2 = " " + nq.slice(rk.index + rk[0].length) + " ";
      for (var j = 0; j < idx.length; j++) {
        if (rest2.indexOf(" " + idx[j].phrase + " ") === 0) return idx[j].key;
      }
    }
    // Bare plural noun anywhere: "brands behind target", "lines below target"
    var pl = ["bus", "lines", "brands", "products", "skus", "molecules", "territories", "reps", "dms", "dsms", "managers", "months", "corporations", "markets", "specialties", "tiers", "kpis"];
    for (var k = 0; k < pl.length; k++) {
      if ((" " + nq + " ").indexOf(" " + pl[k] + " ") >= 0) {
        for (var q = 0; q < idx.length; q++) if (idx[q].phrase === pl[k]) return idx[q].key;
      }
    }
    return null;
  }

  // =========================================================================
  // Intent
  // =========================================================================
  var OPS = [
    ["evidence",    /\b(evidence|underlying|supporting data|behind (this|that|the|these|those)|drill ?(down|into)|show (me )?(the )?(reps|customers|visits|rows|records|calculation|working|workings)|how (was|is|did) .{0,40}(calculated|computed|derived|scored?)|why did .{0,50}(score|get|receive|earn)|what (drove|made|explains) .{0,40}score|score breakdown|show the (evidence|calculation))\b/],
    ["focus",       /\b(what should (we|management|i|the team|leadership) (focus|do|prioriti[sz]e|fix|address|act)|where should (we|management|i) (focus|act|invest)|management focus|focus areas?|priorit(y|ies|ize|ise)|action plan|next steps|what needs attention|needs? attention)\b/],
    ["opportunity", /\b(opportunit(y|ies)|upside|headroom|where (can|could) we (grow|gain|win|improve))\b/],
    ["winlose",     /\b(winning|losing|winners?|losers?|lagging|what.s working|what is working|what.s not working|what is not working|strengths? and weakness(es)?|strong(est)? and weak(est)?|where are we (strong|weak|ahead|behind))\b/],
    ["drivers",     /\b(what (is )?(driving|drives|causing|contribut(es|ing)|explains)|drivers?|main contributors?|contribut(e|es|ion|or|ors)|what contributes|what makes up|composition|gap drivers?)\b/],
    ["change",      /\b(what changed|what has changed|what.s changed|changes? (since|vs|from)|movers?|biggest (change|movement|swing|mover)s?|what moved|moved the most)\b/],
    ["why",         /\b(why|root cause|reasons? for|diagnos(e|is|ing)|explain|underperform(s|ing|ance)?|what.s wrong|what is wrong)\b/],
    ["compare",     /\b(compare|comparison|versus|vs|against|difference between|better than|worse than|ahead of|behind)\b/],
    ["rank",        /\b(top|bottom|fastest|quickest|slowest|highest|lowest|best|worst|biggest|largest|smallest|leading|leader|laggards?|weakest|strongest|rank|ranking|ranked|standing|most|least|who (is|are|has|have|was|were)|which (\w+ )?(is|are|has|have|was|were)( the)?)\b/],
    ["breakdown",   /\b(breakdown|break down|broken down|split|by (bu|line|brand|product|sku|item|molecule|dosage|territory|rep|dm|dsm|manager|month|specialty|class|type|market|corporation|tier|kpi|atc)|per (bu|line|brand|product|rep|dm|month|territory)|each (bu|line|brand|product|rep|dm|territory)|across (bus|lines|brands|products)|distribution|composition)\b/],
    ["trend",       /\b(trend|over time|monthly|by month|history|trajectory|month by month)\b/],
    ["definition",  /^(what (does|do) .{1,70}\b(mean|measure|represent|include|exclude|count)\b|what(?:.s| is| are) (the |a |an )?(definition|meaning|formula|logic|rule|rules|methodology) |whats the (definition|meaning|formula) |define |definition of |meaning of |explain what |how (is|are|do you|does) .{0,50}\b(calculated|computed|defined|measured|derived|scored)\b)/]
  ];
  function intentOf(nq, hasEntity) {
    // "who is not coached" & friends are list measures: handled by measure kind.
    for (var i = 0; i < OPS.length; i++) {
      if (OPS[i][1].test(nq)) {
        if (OPS[i][0] === "definition" && hasEntity) continue;
        return OPS[i][0];
      }
    }
    return "value";
  }

  // =========================================================================
  // Names
  // =========================================================================
  function nameKey(s) {
    return String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  /** Unique-token key: Egyptian names repeat tokens and are re-spelled between
   *  source systems; this is the same rule analytics.js uses to join people. */
  function tokenKey(s) {
    var t = nameKey(s).split(" ").filter(Boolean), seen = {}, out = [];
    t.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out.sort().join(" ");
  }
  function sameName(a, b) {
    if (!a || !b) return false;
    return nameKey(a) === nameKey(b) || tokenKey(a) === tokenKey(b);
  }

  // =========================================================================
  // Vocabulary -> entity index (scoped)
  // =========================================================================
  var _vocabCache = {};
  function userKey() { return E()._currentUserKey(); }

  function mergedDims() {
    var byKey = {};
    _providers.forEach(function (p) {
      if (!usable(p) || !p.vocab) return;
      var v;
      try { v = p.vocab() || {}; } catch (e) { v = {}; }
      Object.keys(v).forEach(function (k) {
        var names = v[k] || [];
        if (!byKey[k]) byKey[k] = { seen: {}, list: [] };
        names.forEach(function (n) {
          if (n === null || n === undefined || n === "") return;
          var kk = nameKey(n);
          if (!kk || byKey[k].seen[kk]) return;
          byKey[k].seen[kk] = 1;
          byKey[k].list.push(String(n));
        });
      });
    });
    return Object.keys(byKey).map(function (k) {
      var meta = DIM_WORDS[k] || { label: k };
      return { key: k, label: meta.label, names: byKey[k].list.sort(), minAlias: (k === "bu" || k === "line") ? 3 : (k === "rep" || k === "dm" ? 4 : 4) };
    });
  }

  /** The pseudo-adapter AskEngine's entity resolver indexes. Keyed by user, so a
   *  sign-out / sign-in can never reuse the previous user's vocabulary. */
  function entityAdapter() {
    var key = "ask-query::" + userKey() + "::" + _providers.map(function (p) { return usable(p) ? p.id : "-"; }).join("");
    if (_vocabCache.key !== key) {
      _vocabCache = { key: key, adapter: { id: key, dims: mergedDims(), visibleDimValues: function () { return null; } } };
    }
    return _vocabCache.adapter;
  }
  function invalidate() { _vocabCache = {}; _measureIndex = null; if (E() && E().invalidateIndexes) E().invalidateIndexes(); }

  // =========================================================================
  // Measure detection
  // =========================================================================
  /** Measures named in the text, longest phrase first, in typed order. Only
   *  measures of providers the user may use. */
  function findMeasures(nq, tab) {
    var padded = " " + nq + " ", hits = [];
    measureIndex().forEach(function (x) {
      if (!usable(x.p)) return;
      // longest matching alias of this measure
      var best = null;
      for (var i = 0; i < x.phrases.length; i++) {
        var ph = x.phrases[i];
        var at = padded.indexOf(" " + ph + " ");
        if (at >= 0 && (!best || ph.length > best.len)) best = { m: x.m, p: x.p, phrase: ph, len: ph.length, pos: at, page: (x.p.tabs || []).indexOf(tab) >= 0 ? 1 : 0 };
      }
      if (best) hits.push(best);
    });
    // longest phrase first; on an exact tie the measure that belongs to the current page wins
    hits.sort(function (a, b) { return (b.len - a.len) || (b.page - a.page); });
    var kept = [];
    hits.forEach(function (h) {
      var dup = kept.filter(function (k) { return k.phrase.indexOf(h.phrase) >= 0 || h.phrase.indexOf(k.phrase) >= 0; })[0];
      if (dup) {
        // The same word names a measure in two providers (e.g. "coverage"): remember it so the answer discloses the choice.
        if (dup.phrase === h.phrase && dup.m.id !== h.m.id) (dup.alts = dup.alts || []).push(h);
        return;
      }
      kept.push(h);
    });
    kept.sort(function (a, b) { return a.pos - b.pos; });
    return kept;
  }

  // Words that pull a question toward one domain even when no measure alias hit.
  var DOMAIN_HINTS = [
    ["coaching", /\b(coach\w*|dv coverage|calls? per dv|double visits?|not coached|visits per coaching day)\b/],
    ["sprint",   /\b(sprint|points?|leaderboard|winners?|recognition)\b/],
    ["workdays", /\b(working days?|field days?|tot|time out of territory|calendar days)\b/],
    ["iqvia",    /\b(market share|iqvia|ims|mat|growth gap|evi|dm1|dm2|corporation|competitor)\b/],
    ["imsrx",    /\b(rx|prescriptions?|physician panel|scripts?)\b/],
    ["tomarket", /\b(pull[- ]?through|to[- ]market|in[- ]market|tms|stock days?|sell[- ]?in|sell[- ]?out)\b/],
    ["sfe",      /\b(vacan\w+|headcount|span of control|organogram|seats?|attrition|turnover)\b/],
    ["coverage", /\b(coverage|right freq\w*|frequency|call rate|visit achievement|not seen|customers per|shared customers|unique customers|target visits|actual visits)\b/],
    ["sales",    /\b(sales|revenue|egp|brand|sku)\b/]
  ];

  // =========================================================================
  // Plan
  // =========================================================================
  function isMeasureWord(w) {
    return measureIndex().some(function (x) {
      return x.phrases.some(function (ph) { return (" " + ph + " ").indexOf(" " + w + " ") >= 0; });
    });
  }
  function stripEntities(nq, entities) {
    var out = " " + nq + " ";
    entities.forEach(function (e) {
      var m = E().normalise(e.matched || e.name);
      // A single word that is also part of a measure phrase ("vacant" is both a placeholder
      // name in the organogram and the word in “vacant positions”) stays: it names the measure.
      if (m && m.indexOf(" ") < 0 && isMeasureWord(m)) return;
      if (m) out = out.split(" " + m + " ").join(" ");
    });
    return out.replace(/\s+/g, " ").trim();
  }

  function pageTab(adapter) { return (adapter && (adapter.tab || adapter.id)) || null; }

  function plan(adapter, q) {
    var timeInfo = P().parse(q);
    var stripped = P().stripTime(q);
    var ea = entityAdapter();
    var entities = E().findEntities(ea, stripped) || [];
    var nq = E().normalise(stripped);
    // A word that names a measure (“vacant”) is not an entity, even when a record happens to carry that word.
    entities = entities.filter(function (e) { var m = E().normalise(e.matched || e.name); return !(m && m.indexOf(" ") < 0 && isMeasureWord(m)); });
    var nqNoEnt = stripEntities(nq, entities);
    // "below / behind / on target" describes a status, it does not name the Target measure.
    nqNoEnt = nqNoEnt.replace(/\b(?:below|behind|under|above|over|off|on|short of|missing|missed|miss|hit|hitting|meet|meeting|met|beat|beating|ahead of)\s+(?:the\s+)?(?:targets?)\b/g, " status ").replace(/\s+/g, " ").trim();
    var intent = intentOf(nq, entities.length > 0);
    var _gb = groupByFromText(nqNoEnt);
    if (_gb && intent === "value" && /^(how many|number of|count of|how much)\b/.test(nq) && !/\b(by|per|each|every|across|split|breakdown)\b/.test(nq)) _gb = null;
    var pl = {
      q: q, nq: nq, tab: pageTab(adapter), adapter: adapter,
      time: timeInfo, entities: entities, intent: intent,
      n: E().requestedN(q, 10), bottom: E().wantsBottom(q) || /\b(slowest|decliners?|(shrinking|declining|falling|dropping) (the )?(fastest|most))\b/.test(nq),
      groupBy: _gb, measures: [], provider: null,
      assumptions: [], hints: [], clarify: null, filters: {}
    };

    // measures / provider
    var hits = findMeasures(nqNoEnt, pl.tab);
    pl.measures = hits;
    // A “list” measure (e.g. vacant positions) is its own answer shape: a stray group word (“positions”) must not turn it into a breakdown.
    if (hits.some(function (h) { return h.m.kind === "list"; })) { pl.groupBy = null; pl.intent = "value"; }
    var hinted = null;
    DOMAIN_HINTS.forEach(function (h) { if (!hinted && h[1].test(nq)) hinted = h[0]; });
    pl.hintedDomain = hinted;

    // filters from entities (first of each dim)
    entities.forEach(function (e) { if (!pl.filters[e.dim.key]) pl.filters[e.dim.key] = e.name; });
    pl.entitiesByDim = {};
    entities.forEach(function (e) { (pl.entitiesByDim[e.dim.key] = pl.entitiesByDim[e.dim.key] || []).push(e.name); });

    // "behind / below / under target" = achievement under 100%, worst first
    if (/\b(behind|below|under|short of|missing)\s+(the\s+)?target\b|\bunderperform\w*\b|\blagging\b/.test(nq) && !pl.bottom) {
      pl.belowTarget = true;
    }
    if (pl.belowTarget) pl.bottom = true;
    // numeric threshold: "coverage below 80%", "brands with sales over 5m", "at least 90"
    pl.threshold = thresholdFromText(q);
    // "which managers are overloaded" / "which brands lost rx": a list of the rows where the count / gap is above zero
    pl.whichList = /^(which|who|list|show( me)?( all)?|name)\b/.test(nq) && !/\b(top|bottom|highest|lowest|best|worst|most|least|biggest|smallest|largest|fastest|slowest)\b/.test(nq);
    // "who" cue with no explicit dimension
    pl.who = /\bwho\b/.test(nq);
    pl.where = /\b(where|which)\b/.test(nq);

    pl.unresolved = findUnresolved(stripped, entities);

    // ---- follow-up carry-over (always disclosed) ----------------------------
    var prev = _prev && _prev.user === userKey() && _prev.tab === pl.tab ? _prev : null;
    var words = nq.split(" ").filter(Boolean).length;
    var namesSomething = entities.length > 0 || timeInfo.specs.length > 0 || !!pl.groupBy;
    var followCue = /^(and|what about|how about|same|now|also|then|but|for|in|by|vs|versus|only|instead|at|per|excluding|without)\b/.test(nq) ||
      (words <= 3 && !/\b(top|bottom|highest|lowest|best|worst|rank|who|which|why|what|how|show|list|compare)\b/.test(nq));
    if (prev && !hits.length && namesSomething && followCue && words <= 8 && (!hinted || hinted === prev.provider.id || (prev.provider.domains || []).indexOf(hinted) >= 0)) {
      pl.inherit = prev;
      pl.measures = prev.chosen.map(function (m) { return { m: m, p: prev.provider, phrase: "(previous question)", len: 0, pos: 0 }; });
      pl.assumptions.push("Following on from your previous question (“" + prev.q + "”): kept " + prev.chosen.map(function (m) { return m.label; }).join(" + ") + ".");
      if (pl.intent === "value" && prev.intent !== "value" && prev.intent !== "evidence" && prev.intent !== "definition") { pl.intent = prev.intent; }
      if (!pl.groupBy && prev.groupBy && (pl.intent === "rank" || pl.intent === "breakdown" || pl.intent === "value")) pl.groupBy = prev.groupBy;
      if (entities.length === 0) {
        Object.keys(prev.filters || {}).forEach(function (k) { if (!pl.filters[k]) { pl.filters[k] = prev.filters[k]; } });
        var kept = Object.keys(prev.filters || {}).map(function (k) { return prev.filters[k]; });
        if (kept.length) pl.assumptions.push("Scope kept from your previous question: " + kept.join(" · ") + ".");
        pl.entitiesByDim = pl.entitiesByDim || {};
      }
      if (!timeInfo.specs.length && prev.time && prev.time.specs && prev.time.specs.length) pl.carryTime = prev.time;
    }
    return pl;
  }
  // -------------------------------------------------------------------------
  // Unresolved names: a name the user typed that is NOT in their scoped vocabulary must
  // never be silently replaced by "your whole scope". Out-of-scope entities are not in
  // the vocabulary by construction, so this is also the RBAC "you cannot see that" path
  // — it reveals nothing about the entity, only that it is not available to this user.
  // -------------------------------------------------------------------------
  var KNOWN_ACRONYMS = "mom yoy ytd mtd qtd kpi kpis bu bus dm dsm asm nsm rf egp ims iqvia atc mat msr msrs hcp dv tot sfe rx ach vs ffs id ok tam sam vp ceo bex sku skus cagr evi rgi gap pts pct usd eur zeta ai ta tas dm1 dm2 chc".split(" ");
  var SOFT_COMMON = "currently overall company business between during should would could about because compared current previous latest total number percentage amount across within without really please tell show give list which where whose these those there their other another every should perform performing performed doing looks looking".split(" ");
  var _knownWords = null, _knownKey = null;
  function knownWords() {
    var key = _providers.map(function (p) { return p.id + (p.measures || []).length; }).join("|");
    if (_knownWords && _knownKey === key) return _knownWords;
    var set = {};
    function add(s) { E().normalise(String(s)).split(" ").forEach(function (w) { if (w) set[w] = 1; }); }
    Object.keys(E().STOPWORDS || {}).forEach(add);
    KNOWN_ACRONYMS.forEach(add); SOFT_COMMON.forEach(add);
    Object.keys(DIM_WORDS).forEach(function (k) { DIM_WORDS[k].words.forEach(add); add(DIM_WORDS[k].label); });
    _providers.forEach(function (p) { (p.measures || []).forEach(function (m) { (m.aliases || []).forEach(add); add(m.label); }); });
    // words the intent detector itself listens for
    OPS.forEach(function (o) { (o[1].source.match(/[a-z]{3,}/g) || []).forEach(function (w) { set[w] = 1; }); });
    DOMAIN_HINTS.forEach(function (o) { (o[1].source.match(/[a-z]{3,}/g) || []).forEach(function (w) { set[w] = 1; }); });
    _knownWords = set; _knownKey = key;
    return set;
  }
  function globalNames() {
    var S = global.SEMANTIC, out = {};
    if (S && S.BU_LIST) S.BU_LIST.forEach(function (b) { out[nameKey(b)] = b; });
    if (S && S.CANONICAL_LINE_TO_BU) Object.keys(S.CANONICAL_LINE_TO_BU).forEach(function (l) { out[nameKey(l)] = l; });
    return out;
  }
  // ---- numeric threshold ("below 80%", "over 5m", "at least 90") ----------------------------------------------
  function thresholdFromText(q) {
    var t = String(q || "").toLowerCase().replace(/,/g, "");
    var m = /(?:\b(below|under|less than|lower than|fewer than|smaller than|at most|no more than|up to|above|over|more than|greater than|higher than|exceeding|exceeds|at least|no less than|not below)\b|(<=|>=|<|>))\s*(\d+(?:\.\d+)?)\s*(%|percent|k|thousand|m|mn|million|b|bn|billion|days?|pts|points)?(?![a-z])/.exec(t);
    if (!m) return null;
    var w = m[1] || m[2], v = parseFloat(m[3]), unit = m[4] || "";
    if (!m[4] && v >= 1990 && v <= 2100) return null;                 // a year, not a threshold
    var lower = /^(below|under|less than|lower than|fewer than|smaller than|at most|no more than|up to|<|<=)$/.test(w);
    var incl = /^(at most|no more than|up to|at least|no less than|not below|<=|>=)$/.test(w);
    var mult = /^(k|thousand)$/.test(unit) ? 1e3 : /^(m|mn|million)$/.test(unit) ? 1e6 : /^(b|bn|billion)$/.test(unit) ? 1e9 : 1;
    return { op: lower ? "lt" : "gt", inclusive: incl, raw: v, mult: mult, pct: /^(%|percent)$/.test(unit), word: w, text: m[0].trim() };
  }
  function thresholdValue(th, m) { return m.unit === "egp" || m.unit === "count" || m.unit === "units" || m.unit === "num1" ? th.raw * th.mult : th.raw; }
  function thresholdPass(th, m, v) {
    if (v === null || v === undefined || (typeof v === "number" && isNaN(v))) return false;
    var x = thresholdValue(th, m);
    return th.op === "lt" ? (th.inclusive ? v <= x : v < x) : (th.inclusive ? v >= x : v > x);
  }

  function findUnresolved(stripped, entities) {
    var known = knownWords(), gn = globalNames();
    var entKeys = {}, entWords = {};
    entities.forEach(function (e) {
      entKeys[nameKey(e.name)] = 1; entKeys[nameKey(e.matched || "")] = 1;
      E().normalise(e.name + " " + (e.matched || "")).split(" ").forEach(function (w) { if (w) entWords[w] = 1; });
    });
    var hard = [], soft = [];
    stripped.split(/\s+/).forEach(function (raw, i) {
      var t = raw.replace(/^[^\w؀-ۿ]+|[^\w؀-ۿ-]+$/g, "");
      if (t.length < 2) return;
      if (/^\d+$/.test(t)) return;
      var k = nameKey(t), lw = E().normalise(t);
      if (entKeys[k]) return;
      // A BU / line name that did NOT resolve inside this user's scope is out of scope for them (or misspelt): it is
      // refused even when the word is also an everyday token (CHC, Cluster). It is never dropped and replaced by the user's own scope.
      if (gn[k] && !entWords[lw]) { if (hard.indexOf(t) < 0) hard.push(t); return; }
      var words = lw.split(" ").filter(Boolean);
      if (words.length && words.every(function (w) { return entWords[w] || known[w]; })) return;
      var isGlobal = !!gn[k];
      var hyphenOrDigit = (/-/.test(t) && /[A-Za-z]/.test(t)) || (/\d/.test(t) && /[A-Za-z]/.test(t));
      var allCaps = t.length >= 2 && t.length <= 8 && t === t.toUpperCase() && /^[A-Z][A-Z0-9-]+$/.test(t);
      if (isGlobal || hyphenOrDigit || allCaps) { if (hard.indexOf(t) < 0) hard.push(t); return; }
      if (t.length >= 6 && /^[A-Za-z]+$/.test(t) && !known[lw]) { if (soft.indexOf(t) < 0) soft.push(t); }
    });
    return { hard: hard, soft: soft };
  }

  var _prev = null;
  function handles(adapter) { return tabProviders(pageTab(adapter)).length > 0; }

  // =========================================================================
  // Provider / measure selection (no silent defaults: every default is listed)
  // =========================================================================
  function tabProviders(tab) {
    return _providers.filter(function (p) { return usable(p) && (p.tabs || []).indexOf(tab) >= 0; });
  }
  function pageDefaultMeasure(adapter) {
    var id = adapter && adapter.defaultMeasure;
    if (!id) {
      var tp = tabProviders(pageTab(adapter)).filter(function (p) { return p.defaultMeasure; })[0];
      id = tp ? tp.defaultMeasure : null;
    }
    return id ? measureById(id) : null;
  }

  function chooseMeasures(pl) {
    var chosen = [], prov = null;
    var tab = pl.tab;
    if (pl.measures.length) {
      // Prefer a provider consistent with the domain hint, then with the page.
      var pool = pl.measures.slice();
      var byHint = pl.hintedDomain ? pool.filter(function (h) { return h.p.id === pl.hintedDomain || (h.p.domains || []).indexOf(pl.hintedDomain) >= 0; }) : [];
      var byPage = pool.filter(function (h) { return (h.p.tabs || []).indexOf(tab) >= 0; });
      var first = (byPage[0] || byHint[0] || pool[0]);
      prov = first.p;
      chosen = pool.filter(function (h) { return h.p.id === prov.id; }).map(function (h) { return h.m; });
      pool.forEach(function (h) {
        if (h.p.id !== prov.id || !h.alts || !h.alts.length) return;
        var others = h.alts.filter(function (a) { return a.p.id !== prov.id && !a.p.quietAlias; });
        if (others.length) pl.assumptions.push("“" + h.phrase + "” is defined more than once in the dashboard: “" + h.m.label + "” (" + prov.label + ") and " +
          others.map(function (a) { return "“" + a.m.label + "” (" + a.p.label + ")"; }).join(", ") +
          ". Using the first" + (h.page ? " because it is the one on this page" : "") + " — name the other one to switch.");
      });
      if (pool.some(function (h) { return h.p.id !== prov.id; })) {
        pl.crossDomain = pool.filter(function (h) { return h.p.id !== prov.id; }).map(function (h) { return h.m.label; });
      }
    } else {
      var dm = pageDefaultMeasure(pl.adapter);
      var pd = dm ? providerOfMeasure(dm.id) : null;
      if (pl.hintedDomain) {
        var hp = _providers.filter(function (p) { return usable(p) && (p.id === pl.hintedDomain || (p.domains || []).indexOf(pl.hintedDomain) >= 0); })[0];
        if (hp && hp.defaultMeasure) { pd = hp; dm = measureById(hp.defaultMeasure); }
      }
      var rankDefault = false;
      if (pd && (pl.intent === "rank" || pl.intent === "breakdown") && !pl.belowTarget && pd.rankMeasure && (!dm || pd.rankMeasure !== dm.id)) {
        dm = measureById(pd.rankMeasure) || dm; rankDefault = true;
      }
      if (dm && pd) {
        prov = pd; chosen = [dm];
        pl.assumptions.push(rankDefault
          ? "No measure named — ranking by “" + dm.label + "”. Name a measure (e.g. “by achievement”) to rank on something else."
          : "No measure named — using “" + dm.label + "”, the headline KPI of this page.");
      }
    }
    pl.provider = prov;
    pl.chosen = chosen;
    return chosen.length > 0;
  }

  // =========================================================================
  // Formatting
  // =========================================================================
  function fmtVal(v, unit) {
    var e = E();
    if (v === null || v === undefined || (typeof v === "number" && isNaN(v))) return "—";
    switch (unit) {
      case "egp":   return e.fmtNum(v) + " EGP";
      case "pct":   return e.fmtPct(v, 1);
      case "spct":  return e.fmtSignedPct(v);
      case "count": return Math.round(v).toLocaleString();
      case "days":  return v.toFixed(1) + " days";
      case "pts":   return v.toFixed(1) + " pts";
      case "ratio": return v.toFixed(2);
      case "units": return e.fmtNum(v);
      case "num1":  return v.toFixed(1);
      default:      return typeof v === "number" ? (Math.abs(v) >= 1000 ? e.fmtNum(v) : String(Math.round(v * 100) / 100)) : String(v);
    }
  }

  /** The threshold at which a measure counts as "on target" (the dashboard's own constant), or null. */
  function tv(m) { return m && m.targetValue !== undefined && m.targetValue !== null ? m.targetValue : (m && m.target100 ? 100 : null); }

  function cmpSort(measure, dir) {
    var better = measure.better === "low" ? -1 : 1; // +1 => high is better
    return function (a, b) {
      var av = a.v[measure.id], bv = b.v[measure.id];
      var an = (av === null || av === undefined || isNaN(av)), bn = (bv === null || bv === undefined || isNaN(bv));
      if (an && bn) return 0; if (an) return 1; if (bn) return -1;
      return dir === "asc" ? av - bv : bv - av;
    };
  }

  // =========================================================================
  // Result helpers
  // =========================================================================
  function fail(pl, message, hint, extra) {
    var r = { ok: false, question: pl && pl.q, message: message, hint: hint || null, missing: !!(extra && extra.missing) };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }

  function clarify(pl, message, options, template) {
    return { ok: false, clarify: true, question: pl.q, message: message,
             hint: options && options.length ? "Ask again naming one, for example: " + options.slice(0, 4).map(function (o) { return template ? template(o) : o; }).join(" · ") : null,
             options: options || [],
             drill: (options || []).slice(0, 8).map(function (o) { return { label: o, question: template ? template(o) : o }; }) };
  }

  function periodEvidence(res, label) {
    var out = [["Period", res.label + (res.partial ? " (partial)" : "")]];
    return out;
  }

  function scopeEvidence(p) {
    var s = p && p.scopeLabel ? p.scopeLabel() : null;
    return s || null;
  }

  function withCommon(pl, prov, r, periods, extraCaveats) {
    r.question = pl.q;
    r.evidence = r.evidence || [];
    r.caveats = (r.caveats || []).concat(extraCaveats || []);
    r.assumptions = (pl.assumptions || []).slice();
    (periods || []).forEach(function (pr) { if (pr && pr.assumption && r.assumptions.indexOf(pr.assumption) < 0) r.assumptions.push(pr.assumption); });
    (periods || []).forEach(function (pr) { if (pr && pr.note && !(isAnnual(prov) && pr.partial) && r.caveats.indexOf(pr.note) < 0) r.caveats.push(pr.note); });
    r.caveats = r.caveats.filter(function (c, i, a) { return a.indexOf(c) === i; });
    r.provider = prov.id;
    r.metric = r.metric || (r.measureIds && r.measureIds[0]) || undefined;
    if (prov.sourceNote) r.source = prov.sourceNote();
    return r;
  }

  // =========================================================================
  // Executor
  // =========================================================================
  function availabilityOf(p) {
    var a = {};
    try { a = p.availability ? p.availability() : {}; } catch (e) { a = {}; }
    a.name = a.name || p.label;
    return a;
  }

  function resolvePeriods(pl, prov) {
    var av = availabilityOf(prov);
    var ti = P().interpret(pl.q, av);
    if (!ti.typed && pl.carryTime && pl.carryTime.specs && pl.carryTime.specs[0]) {
      var c0 = P().resolve(pl.carryTime.specs[0], av);
      ti.primary = c0; ti.typed = true;
      if (pl.carryTime.cmp && pl.carryTime.cmp.type !== "vs") { ti.cmp = { type: pl.carryTime.cmp.type }; ti.secondary = P().comparePeriod(c0, pl.carryTime.cmp.type, av); }
      pl.assumptions.push("Period kept from your previous question: " + c0.label + ".");
    }
    var out = { avail: av, primary: ti.primary, secondary: ti.secondary, cmp: ti.cmp, trend: ti.trend, typed: ti.typed };
    if (av.snapshot) {
      // Snapshot datasets have no month axis: any typed period is refused honestly.
      if (ti.typed && !av.snapshotOk) {
        out.snapshotMismatch = true;
      }
    }
    return out;
  }

  function baseReq(pl, prov, measures, groupBy, period, dropDims) {
    var f = {};
    Object.keys(pl.filters || {}).forEach(function (k) { if (!dropDims || dropDims.indexOf(k) < 0) f[k] = pl.filters[k]; });
    return { measures: measures, groupBy: groupBy || null, filters: f, period: period, entities: pl.entitiesByDim, tab: pl.tab, n: pl.n, plan: pl };
  }

  function callFetch(prov, req) {
    try { return prov.fetch(req); }
    catch (e) {
      if (global.console) console.error("[AskQuery:" + prov.id + "] fetch failed", e);
      return { ok: false, missing: "The " + prov.label + " calculation raised an error (" + String(e && e.message || e).slice(0, 80) + ")." };
    }
  }

  function primaryMeasure(pl) { return pl.chosen[0]; }

  function childDimFor(prov, groupBy, filters) {
    var h = prov.hierarchy || {}, out;
    if (groupBy) return groupBy;
    // choose the coarsest level below what the user pinned
    if (filters.brand || filters.item) out = "item";
    else if (filters.line) out = h.line || "brand";
    else if (filters.bu) out = "line";
    else out = "bu";
    // a provider without that level (e.g. IMS Rx has no BU / line) uses its own ladder
    if (prov.dims && !prov.dims[out]) {
      var lad = (prov.ladder || []).filter(function (k) { return !filters[k] && prov.dims[k]; });
      out = lad[0] || Object.keys(prov.dims).filter(function (k) { return !filters[k]; })[0] || out;
    }
    return out;
  }

  function isAnnual(prov) { try { return !!(prov.availability() || {}).annual; } catch (e) { return false; } }
  function stepWord(prov) { return isAnnual(prov) ? "YoY" : "MoM"; }
  function isSnap(prov) { try { return !!(prov.availability() || {}).snapshot; } catch (e) { return false; } }

  function drillFor(pl, prov, rows, dimKey, m) {
    var chips = [];
    var h = prov.hierarchy || {};
    var child = dimKey ? h[dimKey] : null;
    var top = rows && rows[0];
    var label = m ? m.label.toLowerCase() : "";
    if (top && child && DIM_WORDS[child]) {
      chips.push({ label: "Break down " + top.name + " by " + DIM_WORDS[child].label.toLowerCase(),
                   question: (m ? m.aliases[0] : "") + " by " + DIM_WORDS[child].label.toLowerCase() + " in " + top.name });
    }
    if (top && m && !pl.time.cmp && !isSnap(prov)) chips.push({ label: top.name + " " + stepWord(prov), question: (m.aliases[0] || m.label) + " of " + top.name + " " + stepWord(prov) });
    if (rows && rows.length > 2 && m) chips.push({ label: "Bottom 5", question: "bottom 5 " + (dimKey ? DIM_WORDS[dimKey].words[1] || DIM_WORDS[dimKey].words[0] : "") + " by " + (m.aliases[0] || m.label) });
    return chips.slice(0, 4);
  }

  function tableFrom(rows, measures, prov, opts) {
    opts = opts || {};
    var cols = measures.map(function (m) { return m.label; });
    var out = rows.map(function (r, i) {
      return { rank: i + 1, name: r.name, cells: measures.map(function (m) { return fmtVal(r.v[m.id], m.unit); }), highlight: !!r.highlight };
    });
    return { columns: cols, rows: out };
  }

  // ---- op: value -----------------------------------------------------------
  function opValue(pl, prov, pr) {
    var m = primaryMeasure(pl);
    var req = baseReq(pl, prov, pl.chosen, null, pr.primary);
    var res = callFetch(prov, req);
    if (!res.ok) return fail(pl, res.missing || "No data.", res.hint, { missing: true });
    var total = res.total || (res.rows && res.rows.length === 1 ? res.rows[0].v : null);
    if (!total) return fail(pl, "The " + prov.label + " layer returned no figure for this scope.", null, { missing: true });
    var who = describeScope(pl, prov);
    var head = m.label + " — " + who + ": " + fmtVal(total[m.id], m.unit);
    var det = [];
    pl.chosen.slice(1).forEach(function (x) { det.push(x.label + " " + fmtVal(total[x.id], x.unit)); });
    (res.companions || []).forEach(function (c) { det.push(c.label + " " + c.value); });
    var r = {
      ok: true, headline: head, detail: (det.length ? det.join(" · ") + ". " : "") + pr.primary.label + ".",
      formula: res.formula || m.formula, evidence: [], measureIds: pl.chosen.map(function (x) { return x.id; }),
      value: total[m.id]
    };
    r.evidence.push(["Measure", m.label + " — " + m.def]);
    r.evidence.push(["Period", pr.primary.label + (pr.primary.partial ? " (partial)" : "")]);
    (res.basis || []).forEach(function (b) { r.evidence.push(b); });
    if (res.asOf) r.evidence.push(["Data as of", res.asOf]);
    r.drill = [];
    var childDim = childDimFor(prov, pl.groupBy, pl.filters);
    if (childDim && prov.dims && prov.dims[childDim] && (m.grains || []).indexOf(childDim) >= 0) {
      r.drill.push({ label: "Break down by " + DIM_WORDS[childDim].label.toLowerCase(), question: (m.aliases[0] || m.label) + " by " + DIM_WORDS[childDim].label.toLowerCase() + scopeSuffix(pl) });
    }
    if (!isSnap(prov)) {
      r.drill.push({ label: isAnnual(prov) ? "Year over year" : "Month over month", question: (m.aliases[0] || m.label) + scopeSuffix(pl) + " " + stepWord(prov) });
      r.drill.push({ label: "Trend", question: (m.aliases[0] || m.label) + scopeSuffix(pl) + (isAnnual(prov) ? " trend" : " trend by month") });
    }
    return withCommon(pl, prov, r, [pr.primary], res.caveats);
  }

  function scopeSuffix(pl) {
    var parts = [];
    ["bu", "line", "brand", "item", "dm", "rep", "corp", "market", "molecule"].forEach(function (k) { if (pl.filters[k]) parts.push(pl.filters[k]); });
    return parts.length ? " of " + parts[parts.length - 1] : "";
  }

  function describeScope(pl, prov) {
    var parts = [];
    ["bu", "line", "brand", "item", "molecule", "market", "corp", "dm", "rep", "manager"].forEach(function (k) { if (pl.filters[k]) parts.push(pl.filters[k]); });
    if (parts.length) return parts.join(" · ");
    var s = scopeEvidence(prov);
    return s ? s : "whole company";
  }

  // ---- op: rank / breakdown -------------------------------------------------
  function opRankOrBreakdown(pl, prov, pr, isRank) {
    var m = primaryMeasure(pl);
    var dim = pl.groupBy || defaultGroupDim(pl, prov, m);
    if (!pl.groupBy && dim) pl.assumptions.push("No level named — grouping by " + DIM_WORDS[dim].label.toLowerCase() + ".");
    if (!dim) return fail(pl, "I could not tell what to group by.", "Say what to rank or break down, e.g. “top 10 brands” or “sales by line”.");
    if ((m.grains || []).indexOf(dim) < 0) {
      return fail(pl, prov.label + " cannot give “" + m.label + "” by " + DIM_WORDS[dim].label.toLowerCase() + ".",
        "It can be grouped by: " + (m.grains || []).map(function (g) { return DIM_WORDS[g] ? DIM_WORDS[g].label.toLowerCase() : g; }).join(", ") + ".", { missing: true });
    }
    var req = baseReq(pl, prov, pl.chosen, dim, pr.primary);
    var res = callFetch(prov, req);
    if (!res.ok) return fail(pl, res.missing || "No data.", res.hint, { missing: true });
    var rows = (res.rows || []).slice();
    if (pl.belowTarget) {
      var am = pl.chosen.filter(function (x) { return tv(x) !== null; })[0] || (tv(m) !== null ? m : null);
      if (am) rows = rows.filter(function (r) { return r.v[am.id] !== null && r.v[am.id] !== undefined && (am.better === "low" ? r.v[am.id] > tv(am) : r.v[am.id] < tv(am)); });
    }
    // Numeric threshold from the question ("coverage below 80%") is a real filter, and it is stated in the answer.
    var thrNote = null, whichNote = null, preFilter = rows.length;
    if (pl.threshold && (m.unit === "pct" || m.unit === "spct" || m.unit === "egp" || m.unit === "count" || m.unit === "units" || m.unit === "days" || m.unit === "pts" || m.unit === "num1")) {
      rows = rows.filter(function (r) { return thresholdPass(pl.threshold, m, r.v ? r.v[m.id] : null); });
      thrNote = m.label + " " + (pl.threshold.op === "lt" ? "below" : "above") + (pl.threshold.inclusive ? " or equal to " : " ") + fmtVal(thresholdValue(pl.threshold, m), m.unit) + " — " + rows.length + " of " + preFilter + " " + DIM_WORDS[dim].label.toLowerCase() + "s";
    } else if (pl.whichList && (m.gap || m.unit === "count")) {
      rows = rows.filter(function (r) { return r.v && typeof r.v[m.id] === "number" && r.v[m.id] > 0; });
      whichNote = rows.length + " of " + preFilter + " " + DIM_WORDS[dim].label.toLowerCase() + "s with " + m.label + " above zero";
    }
    // A ranking never puts a row with NO value at the top: rows without a value for the ranked measure are left out and counted.
    var noValueCaveat = null;
    if (isRank) {
      var withVal = rows.filter(function (r) { return r.v && r.v[m.id] !== null && r.v[m.id] !== undefined && !(typeof r.v[m.id] === "number" && isNaN(r.v[m.id])); });
      if (withVal.length < rows.length) {
        noValueCaveat = (rows.length - withVal.length) + " of " + rows.length + " " + DIM_WORDS[dim].label.toLowerCase() + "s hold no recorded value for " + m.label + " and are left out of the ranking (no value is assumed for them).";
        rows = withVal;
        if (!rows.length) return fail(pl, "The dashboard holds no value for " + m.label + " by " + DIM_WORDS[dim].label.toLowerCase() + " in your scope.", ((res.caveats || []).slice(0, 3).join(" ") + " Nothing is estimated or filled in.").trim(), { missing: true });
      }
    }
    // direction
    var wantLow = pl.bottom;
    var better = m.better === "low" ? "low" : "high";
    var asc = (better === "high") ? wantLow : !wantLow;
    if (/\bhighest\b|\bbiggest\b|\blargest\b|\bmost\b|\btop\b|\bbest\b/.test(pl.nq) && m.better === "low" && !pl.bottom) asc = false; // literal "highest vacancy"
    if (/\blowest\b|\bsmallest\b|\bleast\b|\bbottom\b|\bworst\b/.test(pl.nq) && m.better === "low" && !/\bworst\b|\bbottom\b/.test(pl.nq)) asc = true;
    // A gap / shortfall / loss measure lists the LARGEST gap first unless the user asked for the smallest.
    if (m.gap) asc = /\b(lowest|smallest|least|best|fewest)\b/.test(pl.nq);
    if (thrNote && !/\b(top|bottom|highest|lowest|best|worst)\b/.test(pl.nq)) asc = pl.threshold.op === "lt";
    if (whichNote && !thrNote) asc = false;                       // a which-list leads with the largest
    rows.sort(cmpSort(m, asc ? "asc" : "desc"));
    var filterNote = thrNote || whichNote;
    var cap = filterNote ? Math.max(pl.n, 25) : (isRank ? pl.n : 60);
    var shown = rows.slice(0, cap);
    if (!shown.length) {
      var r0 = { ok: true, headline: filterNote ? "No " + DIM_WORDS[dim].label.toLowerCase() + "s: " + filterNote : "No " + DIM_WORDS[dim].label.toLowerCase() + " matches", detail: filterNote ? "Nothing in your scope meets that condition for " + pr.primary.label + "." : (pl.belowTarget ? "Nothing in scope is below target for " + pr.primary.label + "." : "No rows in scope."), formula: res.formula || m.formula, evidence: [["Period", pr.primary.label]], measureIds: [m.id] };
      return withCommon(pl, prov, r0, [pr.primary], res.caveats);
    }
    var top = shown[0];
    var dirWord = m.gap ? (asc ? "smallest" : "largest") : (asc ? "lowest" : "highest"); // the value's direction, not its quality
    var head = filterNote
      ? (filterNote.charAt(0).toUpperCase() + filterNote.slice(1) + " · " + (whichNote && !thrNote ? "largest" : dirWord) + ": " + top.name + " (" + fmtVal(top.v[m.id], m.unit) + ")")
      : isRank
      ? (dirWord.charAt(0).toUpperCase() + dirWord.slice(1) + " " + m.label + ": " + top.name + " (" + fmtVal(top.v[m.id], m.unit) + ")")
      : m.label + " by " + DIM_WORDS[dim].label.toLowerCase() + " — " + shown.length + " rows";
    var mm = pl.chosen.slice(); (res.extraMeasures || []).forEach(function (x) { if (mm.indexOf(x) < 0) mm.push(x); });
    var t = tableFrom(shown, mm, prov);
    var r = {
      ok: true, headline: head,
      detail: pr.primary.label + (res.total && res.total[m.id] !== undefined ? " · Total " + fmtVal(res.total[m.id], m.unit) : "") +
              (rows.length > shown.length ? " · showing " + shown.length + " of " + rows.length : "") + ".",
      rows: t.rows, columns: t.columns, nameHeader: DIM_WORDS[dim].label,
      formula: res.formula || m.formula, evidence: [], measureIds: mm.map(function (x) { return x.id; })
    };
    r.evidence.push(["Measure", m.label + " — " + m.def]);
    r.evidence.push(["Grouped by", DIM_WORDS[dim].label]);
    r.evidence.push(["Period", pr.primary.label + (pr.primary.partial ? " (partial)" : "")]);
    r.evidence.push(["Rows", String(preFilter) + " " + DIM_WORDS[dim].label.toLowerCase() + (preFilter === 1 ? "" : "s") + " in scope"]);
    if (filterNote) r.evidence.push(["Filter applied", filterNote]);
    (res.basis || []).forEach(function (b) { r.evidence.push(b); });
    if (res.asOf) r.evidence.push(["Data as of", res.asOf]);
    r.drill = drillFor(pl, prov, shown, dim, m);
    return withCommon(pl, prov, r, [pr.primary], noValueCaveat ? (res.caveats || []).concat([noValueCaveat]) : res.caveats);
  }

  function defaultGroupDim(pl, prov, m) {
    var g = m.grains || [];
    if (prov.defaultGroup) { var dg = null; try { dg = prov.defaultGroup(pl, m); } catch (e) { dg = null; } if (dg && g.indexOf(dg) >= 0) return dg; }
    var pref;
    if (pl.who) pref = ["rep", "dm", "am", "nsm"];
    else if (pl.filters.line) pref = ["brand", "dm", "rep"];
    else if (pl.filters.bu) pref = ["line", "brand", "dm"];
    else pref = ["bu", "line", "brand", "dm", "rep"];
    for (var i = 0; i < pref.length; i++) if (g.indexOf(pref[i]) >= 0 && prov.dims && prov.dims[pref[i]]) return pref[i];
    return g[0] || null;
  }

  // ---- op: compare -----------------------------------------------------------
  function opCompare(pl, prov, pr) {
    var m = primaryMeasure(pl);
    var pair = pr.cmp && pr.secondary; // period comparison
    var ents = pl.entities;
    // entity vs entity (same dimension)
    var sameDim = ents.length >= 2 && ents[0].dim.key === ents[1].dim.key;
    if (sameDim && !(pair && pr.cmp.type === "vs" && false)) {
      var dim = ents[0].dim.key;
      if ((m.grains || []).indexOf(dim) < 0) return fail(pl, prov.label + " cannot give “" + m.label + "” for a " + DIM_WORDS[dim].label.toLowerCase() + ".", null, { missing: true });
      // The entities being compared are the rows, so the filter of that dimension (and, for a
      // finer level, its parents) must not narrow the fetch to the first one only.
      var drop = [dim];
      if (dim === "line") drop.push("bu");
      if (dim === "brand") drop.push("item");
      var res = callFetch(prov, baseReq(pl, prov, pl.chosen, dim, pr.primary, drop));
      if (!res.ok) return fail(pl, res.missing || "No data.", null, { missing: true });
      var picks =ents.filter(function (e) { return e.dim.key === dim; }).slice(0, 4).map(function (e) {
        return (res.rows || []).filter(function (r) { return sameName(r.name, e.name); })[0] || { name: e.name, v: {} };
      });
      var mm = pl.chosen.slice(); (res.extraMeasures || []).forEach(function (x) { if (mm.indexOf(x) < 0) mm.push(x); });
      var t = tableFrom(picks, mm, prov);
      var a = picks[0], b = picks[1];
      var av = a.v[m.id], bv = b.v[m.id];
      var lead = (av === null || av === undefined || bv === null || bv === undefined) ? null : (((m.better === "low") ? av <= bv : av >= bv) ? a : b);
      var r = {
        ok: true, headline: a.name + "  vs  " + b.name + " — " + m.label,
        detail: lead ? (lead.name + " is ahead" + (m.unit === "pct" ? " by " + Math.abs(av - bv).toFixed(1) + " pts" : "") + ". ") + pr.primary.label + "." : pr.primary.label + ".",
        rows: t.rows, columns: t.columns, nameHeader: DIM_WORDS[dim].label,
        formula: res.formula || m.formula, evidence: [["Measure", m.label + " — " + m.def], ["Period", pr.primary.label]], measureIds: mm.map(function (x) { return x.id; })
      };
      (res.basis || []).forEach(function (bb) { r.evidence.push(bb); });
      r.drill = isSnap(prov) ? [] : [{ label: stepWord(prov) + " for " + a.name, question: (m.aliases[0] || m.label) + " of " + a.name + " " + stepWord(prov) }, { label: stepWord(prov) + " for " + b.name, question: (m.aliases[0] || m.label) + " of " + b.name + " " + stepWord(prov) }];
      return withCommon(pl, prov, r, [pr.primary], res.caveats);
    }
    // period vs period for a scope
    if (pair) return opPeriodCompare(pl, prov, pr);
    if (ents.length >= 2) return fail(pl, "Those two things are different kinds of entity (" + ents.slice(0, 2).map(function (e) { return DIM_WORDS[e.dim.key] ? DIM_WORDS[e.dim.key].label : e.dim.key; }).join(" and ") + "), so I cannot rank them side by side.", "Compare two of the same kind, e.g. two BUs, two lines or two brands.");
    return fail(pl, "Tell me what to compare — two entities (e.g. “DIAB vs GIT”) or two periods (e.g. “July vs June”).", null);
  }

  function opPeriodCompare(pl, prov, pr) {
    var m = primaryMeasure(pl);
    if (!pr.secondary.ok) {
      return fail(pl, pr.secondary.note || "The comparison period is not loaded.", "Loaded months: " + P().labelSet(pr.avail.months || []) + ".", { missing: true });
    }
    if (!pr.primary.ok) return fail(pl, pr.primary.note || "That period is not loaded.", null, { missing: true });
    var dim = pl.groupBy;
    var mm = pl.chosen;
    var r1 = callFetch(prov, baseReq(pl, prov, mm, dim, pr.primary));
    var r2 = callFetch(prov, baseReq(pl, prov, mm, dim, pr.secondary));
    if (!r1.ok) return fail(pl, r1.missing || "No data.", null, { missing: true });
    if (!r2.ok) return fail(pl, r2.missing || "No data for the comparison period.", null, { missing: true });
    var A = pr.primary, B = pr.secondary;
    function delta(av, bv, unit) {
      if (av === null || av === undefined || bv === null || bv === undefined) return null;
      if (unit === "pct" || unit === "pts") return av - bv;      // points
      return bv === 0 ? null : ((av - bv) / Math.abs(bv)) * 100;   // percent change
    }
    var rows = [];
    if (dim) {
      var names = {}; (r1.rows || []).forEach(function (x) { names[nameKey(x.name)] = x.name; });
      Object.keys(names).forEach(function (k) {
        var x = (r1.rows || []).filter(function (z) { return nameKey(z.name) === k; })[0];
        var y = (r2.rows || []).filter(function (z) { return nameKey(z.name) === k; })[0];
        var av = x ? x.v[m.id] : null, bv = y ? y.v[m.id] : null;
        rows.push({ name: names[k], v: (function () { var o = {}; o[m.id] = av; return o; })(), a: av, b: bv, d: delta(av, bv, m.unit) });
      });
      rows.sort(function (p, q) { return (Math.abs(q.d || 0)) - (Math.abs(p.d || 0)); });
      rows = rows.slice(0, pl.n);
    }
    var ta = r1.total ? r1.total[m.id] : (r1.rows && r1.rows[0] ? r1.rows[0].v[m.id] : null);
    var tb = r2.total ? r2.total[m.id] : (r2.rows && r2.rows[0] ? r2.rows[0].v[m.id] : null);
    var dd = delta(ta, tb, m.unit);
    var dWord = (m.unit === "pct" || m.unit === "pts") ? (dd === null ? "—" : (dd >= 0 ? "+" : "") + dd.toFixed(1) + " pts") : E().fmtSignedPct(dd);
    var typeWord = pr.cmp.type === "mom" ? "MoM" : pr.cmp.type === "yoy" ? "YoY" : "vs";
    var r = {
      ok: true,
      headline: m.label + (typeWord === "vs" ? "" : " " + typeWord) + " — " + describeScope(pl, prov) + ": " + fmtVal(ta, m.unit) + " (" + A.label + ") vs " + fmtVal(tb, m.unit) + " (" + B.label + ")  " + dWord,
      detail: A.label + "  vs  " + B.label + ".",
      formula: (r1.formula || m.formula) + (m.unit === "pct" ? "  ·  change in percentage points" : "  ·  change = (current − prior) ÷ |prior|"),
      evidence: [["Measure", m.label + " — " + m.def], ["Current period", A.label], ["Comparison period", B.label], ["Current value", fmtVal(ta, m.unit)], ["Comparison value", fmtVal(tb, m.unit)], ["Change", dWord]],
      measureIds: [m.id], value: ta, prior: tb, change: dd
    };
    if (rows.length) {
      r.columns = [A.label, B.label, "Change"]; r.nameHeader = DIM_WORDS[dim].label;
      r.rows = rows.map(function (x, i) {
        var dv = x.d === null ? "—" : ((m.unit === "pct" || m.unit === "pts") ? (x.d >= 0 ? "+" : "") + x.d.toFixed(1) + " pts" : E().fmtSignedPct(x.d));
        return { rank: i + 1, name: x.name, cells: [fmtVal(x.a, m.unit), fmtVal(x.b, m.unit), dv] };
      });
    }
    (r1.basis || []).forEach(function (b) { r.evidence.push(b); });
    var nextDim = dim || childDimFor(prov, null, pl.filters);
    var cmpTxt = typeWord === "vs" ? A.label + " vs " + B.label : typeWord;
    r.drill = (m.grains || []).indexOf(nextDim) >= 0 && DIM_WORDS[nextDim] ? [{ label: "Break the change down by " + DIM_WORDS[nextDim].label.toLowerCase(), question: (m.aliases[0] || m.label) + " by " + DIM_WORDS[nextDim].label.toLowerCase() + scopeSuffix(pl) + " " + cmpTxt }] : [];
    return withCommon(pl, prov, r, [A, B], (r1.caveats || []).concat(r2.caveats || []));
  }

  // ---- op: trend --------------------------------------------------------------
  function opTrend(pl, prov, pr) {
    var m = primaryMeasure(pl);
    var series = P().series(pr.avail, 12);
    if (!series.length) return fail(pl, "No months are loaded for " + prov.label + ".", null, { missing: true });
    var pts = [], last = null;
    for (var i = 0; i < series.length; i++) {
      var res = callFetch(prov, baseReq(pl, prov, [m], null, series[i]));
      if (!res.ok) { pts.push({ label: series[i].label, value: null }); continue; }
      var tot = res.total || (res.rows && res.rows[0] && res.rows[0].v);
      pts.push({ label: series[i].label, value: tot ? tot[m.id] : null });
      last = res;
    }
    var have = pts.filter(function (p) { return p.value !== null && p.value !== undefined; });
    if (have.length < 1) return fail(pl, "No " + m.label + " figures are available month by month for this scope.", null, { missing: true });
    var first = have[0], lastp = have[have.length - 1];
    var chg = (m.unit === "pct" || m.unit === "pts") ? lastp.value - first.value : (first.value ? ((lastp.value - first.value) / Math.abs(first.value)) * 100 : null);
    var chgTxt = (m.unit === "pct" || m.unit === "pts") ? (chg >= 0 ? "+" : "") + chg.toFixed(1) + " pts" : E().fmtSignedPct(chg);
    var r = {
      ok: true, headline: m.label + " trend — " + describeScope(pl, prov) + ": " + first.label + " " + fmtVal(first.value, m.unit) + " → " + lastp.label + " " + fmtVal(lastp.value, m.unit) + " (" + chgTxt + ")",
      detail: have.length + " of " + series.length + " loaded months have a figure.",
      rows: pts.map(function (p, i) { return { rank: i + 1, name: p.label, cells: [fmtVal(p.value, m.unit)] }; }),
      columns: [m.label], nameHeader: "Month",
      formula: (last && last.formula) || m.formula,
      evidence: [["Measure", m.label + " — " + m.def], ["Months", P().labelSet(series.map(function (s) { return s.keys[0]; }))], ["Change first→last", chgTxt]],
      measureIds: [m.id], series: pts
    };
    var cd = childDimFor(prov, null, pl.filters || {});
    r.drill = DIM_WORDS[cd] ? [{ label: (isAnnual(prov) ? "Latest period by " : "Latest month by ") + DIM_WORDS[cd].label.toLowerCase(), question: (m.aliases[0] || m.label) + " by " + DIM_WORDS[cd].words[0] + scopeSuffix(pl) }] : [];
    return withCommon(pl, prov, r, [], last && last.caveats);
  }

  // ---- op: drivers / change / winlose / opportunity / focus -------------------
  // These are COMPOSITIONS of the same fetch() over the level below the scope.
  function opDrivers(pl, prov, pr) {
    var m = primaryMeasure(pl);
    // gap-based measures: use the provider's gap measure when it has one.
    var gapM = prov.measures.filter(function (x) { return x.id === m.gapMeasure; })[0] || (m.gap ? m : null);
    if (!gapM) return fail(pl, "“" + m.label + "” has no target in " + prov.label + ", so there is no gap to decompose.", "Ask about a measure that has a target, e.g. sales achievement or DV coverage.", { missing: true });
    var dim = pl.groupBy || childDimFor(prov, null, pl.filters);
    if ((gapM.grains || []).indexOf(dim) < 0) dim = (gapM.grains || [])[0];
    var res = callFetch(prov, baseReq(pl, prov, [gapM].concat(m === gapM ? [] : [m]), dim, pr.primary));
    if (!res.ok) return fail(pl, res.missing || "No data.", null, { missing: true });
    var rows = (res.rows || []).filter(function (r) { return r.v[gapM.id] !== null && r.v[gapM.id] !== undefined; });
    var totalGap = rows.reduce(function (s, r) { return s + (r.v[gapM.id] > 0 ? r.v[gapM.id] : 0); }, 0);
    var netGap = rows.reduce(function (s, r) { return s + r.v[gapM.id]; }, 0);
    rows.sort(cmpSort(gapM, "desc"));
    var shown = rows.slice(0, pl.n);
    var tbl = shown.map(function (r, i) {
      var share = totalGap > 0 && r.v[gapM.id] > 0 ? (r.v[gapM.id] / totalGap) * 100 : null;
      return { rank: i + 1, name: r.name, cells: [fmtVal(r.v[gapM.id], gapM.unit), share === null ? "—" : share.toFixed(1) + "%", m !== gapM ? fmtVal(r.v[m.id], m.unit) : "—"] };
    });
    var lead = shown[0];
    var out = {
      ok: true,
      headline: lead && lead.v[gapM.id] > 0 ? "Largest contributor to the " + gapM.label.toLowerCase() + ": " + lead.name + " (" + fmtVal(lead.v[gapM.id], gapM.unit) + ")" : "No shortfall to explain in this scope",
      detail: "Net " + gapM.label.toLowerCase() + " " + fmtVal(netGap, gapM.unit) + " across " + rows.length + " " + DIM_WORDS[dim].label.toLowerCase() + "s · " + pr.primary.label + ".",
      rows: tbl, columns: [gapM.label, "Share of shortfall", m !== gapM ? m.label : "—"], nameHeader: DIM_WORDS[dim].label,
      formula: (res.formula || gapM.formula) + "  ·  share = own shortfall ÷ sum of all shortfalls",
      evidence: [["Measure", gapM.label + " — " + gapM.def], ["Decomposed by", DIM_WORDS[dim].label], ["Period", pr.primary.label]],
      measureIds: [gapM.id]
    };
    (res.basis || []).forEach(function (b) { out.evidence.push(b); });
    out.drill = drillFor(pl, prov, shown, dim, gapM);
    return withCommon(pl, prov, out, [pr.primary], res.caveats);
  }

  // ---- op: why ----------------------------------------------------------------
  // Status check (does the premise hold?) + gap decomposition one level down +
  // the same decomposition one more level inside the biggest contributor + what
  // moved versus the previous period. Every figure is a fetch() of the provider.
  function targetMeasureFor(prov, m) {
    if (tv(m) !== null) return m;
    return (prov.measures || []).filter(function (x) { return tv(x) !== null && x.gapMeasure === (m.gapMeasure || m.id); })[0] || null;
  }

  function opWhy(pl, prov, pr) {
    var m = primaryMeasure(pl);
    var gapM = prov.measures.filter(function (x) { return x.id === m.gapMeasure; })[0] || (m.gap ? m : null);
    if (!gapM) return opDrivers(pl, prov, pr);
    var achM = targetMeasureFor(prov, m);
    var dim1 = pl.groupBy || childDimFor(prov, null, pl.filters);
    if ((gapM.grains || []).indexOf(dim1) < 0) dim1 = (gapM.grains || [])[0];
    var out = opDrivers(pl, prov, pr);
    if (!out.ok) return out;

    // 0. does the premise hold?
    var t0 = callFetch(prov, baseReq(pl, prov, achM ? [achM, gapM] : [gapM], null, pr.primary));
    var tot = t0.ok ? (t0.total || (t0.rows && t0.rows[0] && t0.rows[0].v)) : null;
    var who = describeScope(pl, prov);
    var statusLine = null;
    if (tot && achM && tot[achM.id] !== null && tot[achM.id] !== undefined) {
      var a = tot[achM.id];
      if (a >= 100) statusLine = who + " is not below target: " + achM.label + " " + fmtVal(a, achM.unit) + " (" + pr.primary.label + "). ";
      else statusLine = who + " is below target: " + achM.label + " " + fmtVal(a, achM.unit) + ", " + gapM.label.toLowerCase() + " " + fmtVal(tot[gapM.id], gapM.unit) + " (" + pr.primary.label + "). ";
    }
    if (statusLine) out.headline = statusLine.trim() + "  ·  " + out.headline;

    // 1. deeper: inside the largest contributor
    var h = prov.hierarchy || {}, next = h[dim1];
    var lead = out.rows && out.rows[0];
    if (next && lead && (gapM.grains || []).indexOf(next) >= 0 && DIM_WORDS[next]) {
      var pl2 = { q: pl.q, nq: pl.nq, tab: pl.tab, filters: {}, entitiesByDim: pl.entitiesByDim, n: 3, plan: pl };
      Object.keys(pl.filters || {}).forEach(function (k) { pl2.filters[k] = pl.filters[k]; });
      pl2.filters[dim1] = lead.name.replace(/\s\([A-Z]+\)$/, "");
      var r2 = callFetch(prov, { measures: [gapM], groupBy: next, filters: pl2.filters, period: pr.primary, entities: pl.entitiesByDim, tab: pl.tab, n: 3, plan: pl });
      if (r2.ok) {
        var rr = (r2.rows || []).filter(function (x) { return x.v[gapM.id] > 0; }).sort(cmpSort(gapM, "desc")).slice(0, 3);
        if (rr.length) out.evidence.push(["Inside " + lead.name, rr.map(function (x) { return x.name + " " + fmtVal(x.v[gapM.id], gapM.unit); }).join(" · ") + " (largest " + DIM_WORDS[next].label.toLowerCase() + " shortfalls)"]);
      }
    }

    // 2. what changed since the previous period (only where one is loaded)
    var prevP = P().comparePeriod(pr.primary, "mom", pr.avail);
    if (prevP && prevP.ok && !pr.avail.snapshot && pr.primary.kind !== "ytd" && pr.primary.kind !== "all") {
      var r3 = callFetch(prov, baseReq(pl, prov, achM ? [achM] : [gapM], null, prevP));
      var t3 = r3.ok ? (r3.total || (r3.rows && r3.rows[0] && r3.rows[0].v)) : null;
      var mm = achM || gapM;
      if (t3 && tot && t3[mm.id] !== undefined && tot[mm.id] !== undefined) {
        out.evidence.push(["Versus " + prevP.label, mm.label + " " + fmtVal(tot[mm.id], mm.unit) + " now vs " + fmtVal(t3[mm.id], mm.unit) + " then"]);
      }
    } else if (pr.primary.kind === "ytd") {
      out.caveats = (out.caveats || []).concat(["This is the cumulative view. Ask “what changed July vs June” to see movement between months."]);
    }
    out.caveats = (out.caveats || []).concat(["The breakdown shows where the measured gap sits. It does not prove a cause — the dashboard holds no causal data."]);
    return out;
  }

  // ---- op: evidence -------------------------------------------------------------
  function opEvidence(pl, prov, pr) {
    var m = primaryMeasure(pl);
    var v = opValue(pl, prov, pr);
    if (!v.ok) return v;
    var dim = pl.groupBy || childDimFor(prov, null, pl.filters);
    if ((m.grains || []).indexOf(dim) < 0 || !DIM_WORDS[dim]) return v;
    var saved = pl.groupBy;
    pl.groupBy = dim;
    var b = opRankOrBreakdown(pl, prov, pr, false);
    pl.groupBy = saved;
    if (!b.ok || !b.rows) return v;
    b.headline = "Evidence — " + v.headline;
    b.detail = "Underlying " + DIM_WORDS[dim].label.toLowerCase() + " rows below · " + pr.primary.label + ".";
    var seen = {}; b.evidence.forEach(function (e) { seen[e[0]] = 1; });
    v.evidence.forEach(function (e) { if (!seen[e[0]]) b.evidence.push(e); });
    return b;
  }

  function opChange(pl, prov, pr) {
    // What changed = the group-level movers between the period and its previous period.
    var m = primaryMeasure(pl);
    var cmp = pr.secondary && pr.secondary.ok ? pr.secondary : P().comparePeriod(pr.primary, "mom", pr.avail);
    if (!cmp.ok) return fail(pl, cmp.note || "There is no earlier period loaded to compare with.", null, { missing: true });
    var fake = { cmp: { type: pr.cmp ? pr.cmp.type : "mom" }, secondary: cmp, primary: pr.primary, avail: pr.avail };
    if (!pl.groupBy) { pl.groupBy = childDimFor(prov, null, pl.filters); pl.assumptions.push("No level named — showing what changed by " + DIM_WORDS[pl.groupBy].label.toLowerCase() + "."); }
    return opPeriodCompare(pl, prov, fake);
  }

  // ---- delegation to a provider-specific op ------------------------------------
  function opProviderSpecific(pl, prov, pr, name) {
    if (!prov.ops || !prov.ops[name]) return null;
    var r = prov.ops[name](pl, pr, { fmtVal: fmtVal, DIM_WORDS: DIM_WORDS, sameName: sameName });
    if (!r) return null;
    if (r.ok) return withCommon(pl, prov, r, [pr.primary]);
    return r;
  }

  // ---- definition ----------------------------------------------------------------
  function opDefinition(pl, prov, pr) {
    var m = primaryMeasure(pl);
    var cur = opValue(pl, prov, pr);
    var r = {
      ok: true, headline: m.label + ": " + m.def,
      detail: cur.ok ? "Currently " + fmtVal(cur.value, m.unit) + " for " + describeScope(pl, prov) + " (" + pr.primary.label + ")." : "",
      formula: m.formula, evidence: [["Measure", m.label], ["Definition", m.def], ["Formula", m.formula || "—"]], measureIds: [m.id],
      drill: cur.drill || []
    };
    if (cur.ok) { cur.evidence.forEach(function (e) { if (e[0] !== "Measure") r.evidence.push(e); }); r.caveats = cur.caveats; r.assumptions = cur.assumptions; }
    return withCommon(pl, prov, r, [pr.primary]);
  }

  // =========================================================================
  // Answer
  // =========================================================================
  var _last = null;

  function answer(adapter, q) {
    var pl = plan(adapter, q);
    _last = pl;

    // The dashboard holds actuals, targets and plans. It holds no forecast, so a prediction is refused, never invented.
    if (/\b(predict\w*|forecast\w*|project(?:ion|ions|ed)|extrapolat\w*|will (?:we|it|sales|coverage|the)|next (?:month|quarter|year)s?)\b/i.test(q) && !/\b(target|plan|budget)\b.*\bnext\b/i.test(q)) {
      return fail(pl, "The dashboard holds actuals, targets and plans. It holds no forecast, so I cannot tell you what will happen next quarter or next month, and I will not estimate it.",
        "What I can give you from the same data: the current figure, the month-by-month trend, the gap to target, or the run-rate needed to hit target. Try “sales achievement trend by month” or “gap to target by line”.", { missing: true });
    }

    // 1. Which measure / provider?
    if (!chooseMeasures(pl)) {
      // Entity-only question ("Zeta", "DIAB") -> headline KPI of the page.
      var dm = pageDefaultMeasure(adapter);
      if (dm && pl.entities.length) { pl.chosen = [dm]; pl.provider = providerOfMeasure(dm.id); pl.assumptions.push("No measure named — using “" + dm.label + "”, the headline KPI of this page."); }
      else return null;
    }
    var prov = pl.provider;
    if (!prov || !usable(prov)) return fail(pl, "Your account does not have access to " + (prov ? prov.label : "that") + " data.", null, { denied: true });

    // 0. A name I cannot resolve inside YOUR scope is never replaced by your whole scope.
    var soleUnknown = pl.unresolved && pl.unresolved.soft.length && !pl.entities.length && !pl.measures.length && !pl.inherit;
    if (soleUnknown) pl.unresolved.hard = pl.unresolved.soft.slice(0, 3);
    var soleConcept = soleUnknown && !pl.entities.length && pl.unresolved.hard.every(function (t) { return t === t.toLowerCase() && /^[a-z]+$/.test(t); });
    if (soleConcept) {
      return fail(pl, "The dashboard has no figure called " + pl.unresolved.hard.map(function (t) { return "“" + t + "”"; }).join(", ") +
        ", so I cannot answer that, and I will not estimate or infer it.",
        "Ask for a measure the dashboard does hold on this page (" + (prov.label || "this page") + "), for example one of the example questions below, or tell me which existing measure you mean.", { missing: true, unresolved: pl.unresolved.hard });
    }
    if (pl.unresolved && pl.unresolved.hard.length) {
      return fail(pl, "I could not find " + pl.unresolved.hard.map(function (t) { return "“" + t + "”"; }).join(", ") +
        " in the data you have access to, so I have not answered for it.",
        "Check the spelling, or ask about something inside your own scope (" + (prov.scopeLabel ? prov.scopeLabel() : "your scope") + "). I never substitute your whole scope for a name I cannot find.", { denied: true, unresolved: pl.unresolved.hard });
    }
    if (pl.unresolved && pl.unresolved.soft.length && pl.unresolved.soft.length <= 3) {
      pl.assumptions.push("Not matched to anything in your data, so not used: " + pl.unresolved.soft.map(function (t) { return "“" + t + "”"; }).join(", ") + ".");
    }

    // 1b. A filter the provider has no dimension for must never be silently dropped.
    var bad = Object.keys(pl.filters).filter(function (k) { return !(prov.dims && prov.dims[k]); });
    if (bad.length) {
      var kk = bad[0];
      return fail(pl, prov.label + " has no “" + (DIM_WORDS[kk] ? DIM_WORDS[kk].label : kk) + "” dimension, so it cannot answer for “" + pl.filters[kk] + "”.",
        "It can be filtered or grouped by: " + Object.keys(prov.dims || {}).map(function (d) { return DIM_WORDS[d] ? DIM_WORDS[d].label.toLowerCase() : d; }).join(", ") + ".", { missing: true });
    }

    // 1c. The chosen definition cannot be split the way asked: fall back to the sibling
    //     definition that can — and say so, because the two definitions differ.
    var needDim = pl.groupBy || (pl.intent === "compare" && pl.entities.length >= 2 && pl.entities[0].dim.key === pl.entities[1].dim.key ? pl.entities[0].dim.key : null);
    var m0 = primaryMeasure(pl);
    if (needDim && (m0.grains || []).indexOf(needDim) < 0 && m0.alt) {
      var altM = measureById(m0.alt), altP = altM ? providerOfMeasure(altM.id) : null;
      if (altM && altP && usable(altP) && (altM.grains || []).indexOf(needDim) >= 0) {
        pl.assumptions.push("“" + m0.label + "” (" + prov.label + ") has no breakdown by " + (DIM_WORDS[needDim] ? DIM_WORDS[needDim].label.toLowerCase() : needDim) +
          ", so I used “" + altM.label + "” (" + altP.label + "). The two definitions differ — " + altM.def);
        pl.chosen = [altM]; pl.provider = altP; prov = altP;
      }
    }

    // 2. Scope rules that need the user (no silent BU/Line defaults).
    var sc = scopeCheck(pl, prov);
    if (sc) return sc;

    // 3. Time.
    var pr = resolvePeriods(pl, prov);
    if (pr.snapshotMismatch) {
      pl.assumptions.push(prov.label + " is a point-in-time snapshot" + (pr.avail.snapshotNote ? " (" + pr.avail.snapshotNote + ")" : "") + " — the period you typed cannot change the figure.");
    }
    if (!pr.primary.ok && pr.typed && !pr.avail.snapshot) {
      return fail(pl, pr.primary.note || "That period is not loaded.", "Loaded months: " + P().labelSet(pr.avail.months || []) + ".", { missing: true });
    }
    if (pr.avail.snapshot && !pr.primary.ok) pr.primary = { ok: true, keys: [], requested: [], missing: [], label: pr.avail.snapshotNote || "latest snapshot", kind: "snapshot", partial: false };

    // 4. Op.
    var op = pl.intent;
    var m = primaryMeasure(pl);
    var res;
    if (m.kind === "list") {
      res = opProviderSpecific(pl, prov, pr, "list") || fail(pl, prov.label + " cannot list this.");
      return finalize(pl, res);
    }
    // period comparison phrases beat generic intent
    if (pr.cmp && pr.cmp.type !== "vs" && (op === "value" || op === "rank" || op === "breakdown" || op === "trend")) op = "periodcompare";
    if (pr.cmp && pr.cmp.type === "vs") op = "compare";
    if (pr.trend && (op === "value" || op === "breakdown")) op = "trend";
    if (op === "compare" && pl.entities.length < 2 && !pr.cmp) op = "value";

    // Snapshot datasets carry no history: never fabricate a trend / period comparison.
    if (pr.avail.snapshot && (op === "periodcompare" || op === "trend" || op === "change" || pr.trend || (pr.cmp && pr.cmp.type !== "vs"))) {
      return fail(pl, prov.label + " is a single point-in-time snapshot" + (pr.avail.snapshotNote ? " (" + pr.avail.snapshotNote + ")" : "") + ", so there is no earlier period to compare with.",
        "Month-over-month, year-over-year and trend questions need a dated history of this dataset, which is not loaded.", { missing: true });
    }

    switch (op) {
      case "definition": res = opDefinition(pl, prov, pr); break;
      case "compare":    res = opCompare(pl, prov, pr); break;
      case "periodcompare": res = opPeriodCompare(pl, prov, pr); break;
      case "trend":      res = opTrend(pl, prov, pr); break;
      case "rank":       res = opRankOrBreakdown(pl, prov, pr, true); break;
      case "breakdown":  res = opRankOrBreakdown(pl, prov, pr, false); break;
      case "drivers":    res = opProviderSpecific(pl, prov, pr, "drivers") || opDrivers(pl, prov, pr); break;
      case "change":     res = opChange(pl, prov, pr); break;
      case "why":        res = opProviderSpecific(pl, prov, pr, "why") || opWhy(pl, prov, pr); break;
      case "evidence":   res = opProviderSpecific(pl, prov, pr, "evidence") || opEvidence(pl, prov, pr); break;
      case "winlose":    res = opProviderSpecific(pl, prov, pr, "winlose") || opWinLose(pl, prov, pr); break;
      case "opportunity": res = opProviderSpecific(pl, prov, pr, "opportunity") || opOpportunity(pl, prov, pr); break;
      case "focus":      res = opProviderSpecific(pl, prov, pr, "focus") || opFocus(pl, prov, pr); break;
      default:
        // A bare group cue ("sales by line") is a breakdown.
        if (pl.groupBy && (op === "value")) res = opRankOrBreakdown(pl, prov, pr, false);
        else res = opValue(pl, prov, pr);
    }
    return finalize(pl, res);
  }

  function remember(pl) {
    if (!pl.provider || !pl.chosen || !pl.chosen.length) return;
    _prev = { user: userKey(), tab: pl.tab, q: pl.q, chosen: pl.chosen, provider: pl.provider, intent: pl.intent, groupBy: pl.groupBy, filters: pl.filters, time: pl.time, n: pl.n };
  }

  function finalize(pl, res) {
    if (!res) return null;
    if (res.ok === false) return res;
    remember(pl);
    if (pl.crossDomain && pl.crossDomain.length) {
      res.caveats = (res.caveats || []).concat(["You also mentioned " + pl.crossDomain.join(", ") + " — that belongs to a different page's data, so it is not combined into this figure."]);
    }
    return res;
  }

  // ---- scope rules -------------------------------------------------------------
  function scopeCheck(pl, prov) {
    // A "why / performing / drivers" question about a whole company that has more
    // than one BU in scope needs the BU named — never picked for the user.
    var needsOne = (pl.intent === "why") && !pl.filters.bu && !pl.filters.line && !pl.filters.brand;
    if (needsOne && prov.singleScopeOptions) {
      var opts = prov.singleScopeOptions();
      if (opts.length === 1) { pl.filters[opts[0].dim] = opts[0].name; pl.assumptions.push("Scope: your only " + DIM_WORDS[opts[0].dim].label.toLowerCase() + " in this account is " + opts[0].name + "."); }
      else if (opts.length > 1) return clarify(pl, "Which business unit or line should I diagnose? I will not pick one for you.", opts.map(function (o) { return o.name; }), function (n) { return "why is " + n + " below target"; });
    }
    return null;
  }

  // ---- executive ops built from the SAME fetch --------------------------------
  function levelRows(pl, prov, pr, m, dim) {
    var res = callFetch(prov, baseReq(pl, prov, [m], dim, pr.primary));
    return res;
  }

  function ladder(pl, prov, m) {
    // Coarsest level that gives >=2 rows for this user; stated in the answer.
    var g = m.grains || [];
    var order = (prov.ladder || ["bu", "line", "brand", "dm", "rep"]).filter(function (d) { return g.indexOf(d) >= 0 && prov.dims && prov.dims[d]; });
    if (pl.filters.line) order = order.filter(function (d) { return d !== "bu" && d !== "line"; });
    else if (pl.filters.bu) order = order.filter(function (d) { return d !== "bu"; });
    return order;
  }

  function opWinLose(pl, prov, pr) {
    var m = primaryMeasure(pl);
    if (tv(m) === null && !m.better) return fail(pl, "“" + m.label + "” has no target or direction, so I cannot call anything a win or a loss.", "Ask about achievement, coverage or another measure with a target.", { missing: true });
    var order = ladder(pl, prov, m), dim = pl.groupBy || order[0];
    var res = null, rows = [];
    for (var i = 0; i < order.length; i++) {
      var d = pl.groupBy || order[i];
      res = levelRows(pl, prov, pr, m, d);
      if (!res.ok) return fail(pl, res.missing || "No data.", null, { missing: true });
      rows = (res.rows || []).filter(function (r) { return r.v[m.id] !== null && r.v[m.id] !== undefined; });
      dim = d; if (rows.length >= 2 || pl.groupBy) break;
    }
    if (!rows.length) return fail(pl, "There is nothing to compare in this scope.", null, { missing: true });
    var asc = m.better === "low";
    rows.sort(cmpSort(m, asc ? "asc" : "desc"));
    var thr = tv(m);
    var win = thr === null ? rows.slice(0, 3) : rows.filter(function (r) { return r.v[m.id] >= thr; }).slice(0, 5);
    var lose = thr === null ? rows.slice(-3).reverse() : rows.filter(function (r) { return r.v[m.id] < thr; }).reverse().slice(0, 5);
    var tbl = [];
    win.forEach(function (r, i) { tbl.push({ rank: i + 1, name: r.name, cells: ["WINNING", fmtVal(r.v[m.id], m.unit)] }); });
    lose.forEach(function (r, i) { tbl.push({ rank: win.length + i + 1, name: r.name, cells: ["LOSING", fmtVal(r.v[m.id], m.unit)] }); });
    var out = {
      ok: true,
      headline: "Winning: " + (win.length ? win.map(function (r) { return r.name; }).slice(0, 3).join(", ") : "none") + "  ·  Losing: " + (lose.length ? lose.map(function (r) { return r.name; }).slice(0, 3).join(", ") : "none"),
      detail: "By " + DIM_WORDS[dim].label.toLowerCase() + " on " + m.label + " · " + pr.primary.label + (thr !== null ? " · win = at or above the dashboard's target of " + fmtVal(thr, m.unit) + "." : " · no target is defined, so the top and bottom three are shown."),
      rows: tbl, columns: ["Status", m.label], nameHeader: DIM_WORDS[dim].label,
      formula: (res.formula || m.formula) + "  ·  win/lose split at the dashboard's target (" + (thr !== null ? fmtVal(thr, m.unit) : "none") + ")",
      evidence: [["Measure", m.label + " — " + m.def], ["Level used", DIM_WORDS[dim].label + " (coarsest level with ≥2 rows in your scope)"], ["Period", pr.primary.label]],
      measureIds: [m.id]
    };
    (res.basis || []).forEach(function (b) { out.evidence.push(b); });
    out.drill = drillFor(pl, prov, rows, dim, m);
    if (lose[0]) out.drill.unshift({ label: "Why is " + lose[0].name + " behind?", question: "what is driving the gap in " + lose[0].name });
    return withCommon(pl, prov, out, [pr.primary], res.caveats);
  }

  function opOpportunity(pl, prov, pr) {
    var m = primaryMeasure(pl);
    var gapM = prov.measures.filter(function (x) { return x.id === m.gapMeasure; })[0] || (m.gap ? m : null);
    if (!gapM) return fail(pl, "I can size an opportunity only where the dashboard holds a target: “" + m.label + "” has none here.", "Try sales, coverage or DV coverage.", { missing: true });
    var order = ladder(pl, prov, gapM), dim = pl.groupBy || order[order.length > 1 ? 1 : 0];
    if (!dim) return fail(pl, "Nothing to break down in this scope.", null, { missing: true });
    var res = levelRows(pl, prov, pr, gapM, dim);
    if (!res.ok) return fail(pl, res.missing || "No data.", null, { missing: true });
    var rows = (res.rows || []).filter(function (r) { return r.v[gapM.id] > 0; }).sort(cmpSort(gapM, "desc")).slice(0, pl.n);
    if (!rows.length) return { ok: true, headline: "No shortfall to close in this scope", detail: pr.primary.label + ".", formula: res.formula || gapM.formula, evidence: [["Period", pr.primary.label]], measureIds: [gapM.id], caveats: res.caveats, provider: prov.id, question: pl.q, assumptions: pl.assumptions };
    var total = rows.reduce(function (s, r) { return s + r.v[gapM.id]; }, 0);
    var out = {
      ok: true, headline: "Biggest opportunity: close the " + gapM.label.toLowerCase() + " in " + rows[0].name + " (" + fmtVal(rows[0].v[gapM.id], gapM.unit) + ")",
      detail: "Top " + rows.length + " " + DIM_WORDS[dim].label.toLowerCase() + "s hold " + fmtVal(total, gapM.unit) + " of shortfall to target · " + pr.primary.label + ".",
      rows: rows.map(function (r, i) { return { rank: i + 1, name: r.name, cells: [fmtVal(r.v[gapM.id], gapM.unit)] }; }), columns: [gapM.label], nameHeader: DIM_WORDS[dim].label,
      formula: (res.formula || gapM.formula) + "  ·  opportunity = the dashboard's own gap-to-target, largest first (nothing projected)",
      evidence: [["Measure", gapM.label + " — " + gapM.def], ["Level", DIM_WORDS[dim].label], ["Period", pr.primary.label]], measureIds: [gapM.id]
    };
    (res.basis || []).forEach(function (b) { out.evidence.push(b); });
    out.drill = drillFor(pl, prov, rows, dim, gapM);
    return withCommon(pl, prov, out, [pr.primary], (res.caveats || []).concat(["“Opportunity” here means the measured gap to the dashboard's own target. It is not a forecast."]));
  }

  function opFocus(pl, prov, pr) {
    // Composition: the largest gap contributors + the weakest achievers, from the same source.
    var m = primaryMeasure(pl);
    var gapM = prov.measures.filter(function (x) { return x.id === m.gapMeasure; })[0] || (m.gap ? m : null);
    if (!gapM) return fail(pl, "Management focus needs a target-based measure; “" + m.label + "” has none.", null, { missing: true });
    var order = ladder(pl, prov, gapM), dim = pl.groupBy || order[order.length > 1 ? 1 : 0];
    var res = levelRows(pl, prov, pr, gapM, dim);
    if (!res.ok) return fail(pl, res.missing || "No data.", null, { missing: true });
    var rows = (res.rows || []).filter(function (r) { return r.v[gapM.id] > 0; }).sort(cmpSort(gapM, "desc")).slice(0, 3);
    var total = (res.rows || []).reduce(function (s, r) { return s + (r.v[gapM.id] > 0 ? r.v[gapM.id] : 0); }, 0);
    if (!rows.length) return { ok: true, headline: "Nothing is below target in this scope — no corrective focus is indicated by " + gapM.label.toLowerCase(), detail: pr.primary.label + ".", formula: res.formula || gapM.formula, evidence: [["Period", pr.primary.label]], measureIds: [gapM.id], caveats: res.caveats, provider: prov.id, question: pl.q, assumptions: pl.assumptions };
    var out = {
      ok: true,
      headline: "Management focus: " + rows.map(function (r) { return r.name; }).join(" → "),
      detail: "These " + rows.length + " " + DIM_WORDS[dim].label.toLowerCase() + "s hold " + ((rows.reduce(function (s, r) { return s + r.v[gapM.id]; }, 0) / (total || 1)) * 100).toFixed(0) + "% of all shortfall to target (" + fmtVal(total, gapM.unit) + ") · " + pr.primary.label + ".",
      rows: rows.map(function (r, i) { return { rank: i + 1, name: r.name, cells: [fmtVal(r.v[gapM.id], gapM.unit), total > 0 ? (r.v[gapM.id] / total * 100).toFixed(1) + "%" : "—"] }; }),
      columns: [gapM.label, "Share of total shortfall"], nameHeader: DIM_WORDS[dim].label,
      formula: (res.formula || gapM.formula) + "  ·  priority = largest gap to the dashboard's own target",
      evidence: [["Rule", "Priority is ranked by the size of the gap to target — no weights, no forecast."], ["Level", DIM_WORDS[dim].label], ["Period", pr.primary.label]], measureIds: [gapM.id]
    };
    (res.basis || []).forEach(function (b) { out.evidence.push(b); });
    out.drill = rows.map(function (r) { return { label: "Why is " + r.name + " behind?", question: "what is driving the gap in " + r.name }; });
    return withCommon(pl, prov, out, [pr.primary], res.caveats);
  }

  // =========================================================================
  // Async: make sure lazy caches are loaded before answering
  // =========================================================================
  function requiredCaches(adapter, q) {
    var pl = plan(adapter, q);
    chooseMeasures(pl);
    var need = {};
    var provs = pl.provider ? [pl.provider] : tabProviders(pageTab(adapter));
    provs.forEach(function (p) { (p.requires || []).forEach(function (k) { need[k] = 1; }); });
    return Object.keys(need);
  }
  function ensureFor(adapter, q) {
    var pl = plan(adapter, q);
    chooseMeasures(pl);
    var need = {};
    var provs = pl.provider ? [pl.provider] : tabProviders(pageTab(adapter));
    provs.forEach(function (p) { (p.requires || []).forEach(function (k) { need[k] = 1; }); });
    var keys = Object.keys(need);
    var jobs = keys.length && global.CacheLoader ? keys.map(function (k) { return global.CacheLoader.ensure(k); }) : [];
    // Providers with month archives that load on demand (Sprint) get to fetch the months this question names.
    provs.forEach(function (p) { if (p.ensureAsync) { try { jobs.push(p.ensureAsync(pl)); } catch (e) { jobs.push(Promise.resolve(false)); } } });
    if (!jobs.length) return Promise.resolve(true);
    return Promise.all(jobs).then(function (r) {
      // Vocabularies were built before these caches existed: rebuild so names resolve.
      invalidate();
      return r.every(function (x) { return x !== false; });
    });
  }

  global.AskQuery = {
    registerProvider: registerProvider, providers: providers, providerById: providerById,
    measureById: measureById, measureIndex: measureIndex,
    plan: plan, answer: answer, ensureFor: ensureFor, requiredCaches: requiredCaches,
    invalidate: invalidate, lastPlan: function () { return _last; }, handles: handles,
    resetContext: function () { _prev = null; },
    fmtVal: fmtVal, sameName: sameName, nameKey: nameKey, tokenKey: tokenKey, DIM_WORDS: DIM_WORDS,
    groupByFromText: groupByFromText, intentOf: intentOf, findMeasures: findMeasures,
    _entityAdapter: entityAdapter
  };
})(typeof window !== "undefined" ? window : this);
