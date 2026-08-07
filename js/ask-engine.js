/**
 * ASK THE DATA — shared engine
 * ============================================================================
 *
 * One question box, mounted on every page, answering from whichever cube that
 * page sits on. This file holds everything that is the same everywhere: the
 * panel UI, the evidence renderer, entity resolution, the intent parser, and
 * — most importantly — the scope guard.
 *
 * Page-specific knowledge lives in an ADAPTER (see the contract below).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS DETERMINISTIC AND NOT A LANGUAGE MODEL
 * ---------------------------------------------------------------------------
 * The platform is a static GitHub Pages deployment with no backend. A
 * model-backed assistant would need an API key shipped inside client-side
 * JavaScript, readable by anyone with devtools.
 *
 * It is also the better answer for this job. Every figure is computed from the
 * same cube the charts read, so a number in an answer IS the number on the
 * page. It cannot invent a competitor, misremember a denominator, or produce a
 * confident figure from nothing. What it gives up is free-form phrasing; what
 * it buys is that every answer arrives with its formula, inputs, period,
 * denominator and caveats attached.
 *
 * ---------------------------------------------------------------------------
 * THE SCOPE GUARD — read this before adding an adapter
 * ---------------------------------------------------------------------------
 * Market Intelligence was the easy case: purchased IMS panel data with no Zeta
 * BU dimension, so there was nothing to restrict. Every other page carries
 * internal data that is scoped per user — 15 of 24 accounts are Line Managers
 * and 4 are BU Managers.
 *
 * Ahmed's rule (2026-08-07): "own scope only, nothing else". No company-wide
 * benchmark, no other BU named, ever.
 *
 * Enforcing that with a check inside each answer branch would be a mistake:
 * there are dozens of branches across adapters and one forgotten `if` leaks
 * another BU's numbers. So the guard is STRUCTURAL instead:
 *
 *   1. The adapter never touches its cube directly. It gets `ctx.scan(visit)`,
 *      which has the user's scope predicate baked in. There is no unscoped
 *      scan to call by accident.
 *
 *   2. The ENTITY VOCABULARY is built through that same scoped scan. A Line
 *      Manager's index simply does not contain another BU's brands, reps or
 *      managers — so those names cannot be resolved, cannot be ranked, and
 *      cannot appear in an answer. The user is not blocked from asking; the
 *      entity does not exist in their world.
 *
 *   3. `buildIndex` is keyed on the signed-in user, so switching accounts
 *      rebuilds the vocabulary rather than reusing the previous user's.
 *
 * That third point is the one that bites: an index cached across a sign-out
 * would hand the next user the previous user's vocabulary.
 *
 * ---------------------------------------------------------------------------
 * ADAPTER CONTRACT
 * ---------------------------------------------------------------------------
 *   {
 *     id:        "sales",                    // stable key, used for caching
 *     title:     "Ask the Data",
 *     subtitle:  "...",
 *     examples:  ["...", "..."],             // suggestion chips
 *     sourceNote: "TOTAL_SALES_2026.xlsx · built 2026-08-06",
 *
 *     // Dimensions the user may name. `names` is the full lookup array;
 *     // `values(ctx)` returns the Set of indices actually visible in scope.
 *     dims: [{ key, label, names, minAlias? }],
 *
 *     scopeLabel(),                          // human description of the scope
 *     visibleDimValues(dimKey),              // Set of in-scope lookup indices
 *     answer(q, parsed, ctx)                 // returns a result object
 *   }
 *
 * A result is:
 *   { ok, headline, detail?, formula?, evidence: [[label,value],...],
 *     caveats: [...], rows?: [...], compare?: [...] }
 *
 * Every branch MUST set `formula` and push its inputs into `evidence`. An
 * answer without its basis is the thing this feature exists to prevent.
 */
(function (global) {
  "use strict";

  // =========================================================================
  // Text normalisation and entity resolution
  // =========================================================================

  function normalise(s) {
    return String(s || "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  /** Whole-word containment. A plain indexOf matches "eva" inside "prevacid"
   *  and would silently answer about an entity the user never named. */
  function hasPhrase(hay, needle) {
    if (!needle) return false;
    return (" " + hay + " ").indexOf(" " + needle + " ") >= 0;
  }

  // =========================================================================
  // Levenshtein Similarity & Synonyms
  // =========================================================================

  function levenshteinSimilarity(s1, s2) {
    var longer = s1.length < s2.length ? s2 : s1;
    var shorter = s1.length < s2.length ? s1 : s2;
    var longerLength = longer.length;
    if (longerLength === 0) return 1.0;
    return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
  }

  function editDistance(s1, s2) {
    var costs = [];
    for (var i = 0; i <= s1.length; i++) {
      var lastValue = i;
      for (var j = 0; j <= s2.length; j++) {
        if (i === 0) costs[j] = j;
        else {
          if (j > 0) {
            var newValue = costs[j - 1];
            if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
              newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
            }
            costs[j - 1] = lastValue;
            lastValue = newValue;
          }
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  }

  var SYNONYMS = {
    cardio: "cardiovascular",
    diab: "diabetes",
    gynae: "gynecology",
    phys: "physicians",
    ped: "pediatrics",
    derm: "dermatology",
    gastro: "git",
    ortho: "orthopedics",
    neuro: "cns",
    rep: "medical representative",
    reps: "medical representative",
    manager: "district manager",
    managers: "district manager",
    vacancy: "vacant",
    vacancies: "vacant",
    attrition: "turnover",
    sku: "product",
    item: "product",
    ppis: "a02b2 proton pump inhibitors",
    statins: "c10a1 hmg coa red plain",
    arbs: "c09c0 angiotensin-ii antagonists plain",
    ace: "c09a0 ace inhibitors plain"
  };

  function resolveSynonyms(q) {
    var words = q.split(" ");
    for (var i = 0; i < words.length; i++) {
      var w = words[i].toLowerCase().trim();
      if (SYNONYMS[w]) {
        words[i] = SYNONYMS[w];
      }
    }
    return words.join(" ");
  }

  /**
   * Corporate-form and unit boilerplate nobody types.
   * "AMOUN PHARM.CO.*" -> "amoun", "HIKMA PLC*" -> "hikma".
   */
  var GENERIC_TOKENS = {
    pharm: 1, pharma: 1, pharmaceutical: 1, pharmaceuticals: 1, pharmacare: 1,
    co: 1, company: 1, corp: 1, corporation: 1, inc: 1, ltd: 1, llc: 1,
    plc: 1, sae: 1, sa: 1, ag: 1, nv: 1, bv: 1, gmbh: 1, spa: 1, srl: 1,
    group: 1, holding: 1, holdings: 1, healthcare: 1, health: 1,
    lab: 1, labs: 1, laboratory: 1, laboratories: 1,
    industries: 1, industry: 1, international: 1, intl: 1, global: 1,
    egypt: 1, egyptian: 1, for: 1, and: 1, the: 1, of: 1
  };

  /**
   * Question vocabulary that must never be read as an entity name.
   *
   * This list exists because of a real failure. There is a corporation in the
   * IMS panel called SHARE PHARMACEUTICALS. Its alias is "share", so the very
   * first question anyone would type — "What is Zeta's share?" — resolved to
   * that company, computed its value (zero), and answered "SHARE
   * PHARMACEUTICALS holds 0.00% share". Fluent, sourced, evidenced, and about
   * entirely the wrong company.
   *
   * Rule: a candidate whose ENTIRE matched text is question vocabulary is
   * never an entity. The full name still resolves — nobody types that by
   * accident.
   */
  var STOPWORDS = {
    share: 1, shares: 1, growth: 1, grow: 1, grew: 1, growing: 1,
    price: 1, prices: 1, pricing: 1, value: 1, values: 1, cost: 1,
    sales: 1, sale: 1, selling: 1, sell: 1, sold: 1, unit: 1, units: 1,
    target: 1, targets: 1, achievement: 1, achieved: 1, actual: 1, actuals: 1,
    coverage: 1, covered: 1, frequency: 1, freq: 1, visit: 1, visits: 1,
    reach: 1, call: 1, calls: 1, rate: 1, customer: 1, customers: 1,
    market: 1, markets: 1, top: 1, best: 1, biggest: 1, largest: 1,
    leading: 1, leader: 1, leaders: 1, highest: 1, lowest: 1, worst: 1,
    main: 1, bottom: 1, rank: 1, ranking: 1, position: 1, standing: 1,
    compare: 1, versus: 1, vs: 1, against: 1, trend: 1, trends: 1,
    total: 1, average: 1, mean: 1, class: 1, classes: 1, cagr: 1,
    product: 1, products: 1, brand: 1, brands: 1, molecule: 1, molecules: 1,
    line: 1, lines: 1, team: 1, teams: 1, region: 1, regions: 1,
    rep: 1, reps: 1, manager: 1, managers: 1, doctor: 1, doctors: 1,
    corporation: 1, corporations: 1, competitor: 1, competitors: 1,
    area: 1, areas: 1, therapeutic: 1, percent: 1, percentage: 1,
    year: 1, years: 1, month: 1, months: 1, quarter: 1, ytd: 1,
    data: 1, report: 1, performance: 1, business: 1, dashboard: 1,
    what: 1, which: 1, who: 1, where: 1, when: 1, how: 1, why: 1,
    much: 1, many: 1, show: 1, tell: 1, give: 1, about: 1, doing: 1,
    our: 1, ours: 1, we: 1, us: 1, my: 1, me: 1, is: 1, are: 1, was: 1,
    does: 1, did: 1, do: 1, in: 1, on: 1, of: 1, by: 1, to: 1, at: 1,
    increase: 1, decrease: 1, up: 1, down: 1, over: 1, from: 1, per: 1
  };

  function allStopwords(form) {
    var t = form.split(" ");
    for (var i = 0; i < t.length; i++) {
      if (!STOPWORDS[t[i]] && !GENERIC_TOKENS[t[i]]) return false;
    }
    return true;
  }

  function isCodeToken(t) { return /^[a-z]\d{2}[a-z0-9]{0,2}$/.test(t); }

  /**
   * Strings that should resolve to this entity: the full normalised name, and
   * a shortened alias with any leading classification code and the trailing
   * corporate-form tokens removed. Longest first, so the more specific match
   * wins when both appear.
   */
  function aliasesOf(normName) {
    var out = [normName];
    var toks = normName.split(" ");
    if (toks.length > 1 && isCodeToken(toks[0])) {
      toks = toks.slice(1);
      out.push(toks.join(" "));
    }
    var end = toks.length;
    while (end > 1 && GENERIC_TOKENS[toks[end - 1]]) end--;
    if (end < toks.length) {
      var short = toks.slice(0, end).join(" ");
      if (out.indexOf(short) < 0) out.push(short);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Entity index
  // -------------------------------------------------------------------------
  // Normalising and alias-splitting tens of thousands of lookup names costs
  // ~90ms and depends only on the cube and the user's scope — never on the
  // page's own filters. Built once per (adapter, user) and reused.
  //
  // CACHE KEY INCLUDES THE USER. An index cached across a sign-out would hand
  // the next account the previous account's vocabulary, which is exactly the
  // leak the scope guard exists to prevent.
  var _indexCache = {};

  function currentUserKey() {
    try {
      if (global.AUTH && global.AUTH.getValidSessionUser) {
        var u = global.AUTH.getValidSessionUser();
        if (u) return (u.email || u.username || u.name || "?") + "|" + u.role;
      }
    } catch (e) {}
    return "anon";
  }

  function invalidateIndexes() { _indexCache = {}; }

  /**
   * Build the searchable vocabulary for an adapter, restricted to what this
   * user may see. `adapter.visibleDimValues(key)` returns null for "all" or a
   * Set of permitted lookup indices.
   */
  function buildIndex(adapter) {
    var key = adapter.id + "::" + currentUserKey();
    if (_indexCache[key]) return _indexCache[key];

    var idx = [];
    (adapter.dims || []).forEach(function (dim) {
      var names = dim.names;
      if (!names || !names.length) return;
      var visible = adapter.visibleDimValues ? adapter.visibleDimValues(dim.key) : null;
      // Aliases are shorter than full names and collide with ordinary words
      // more readily, so large dimensions hold them to a longer minimum.
      var minAlias = dim.minAlias || (names.length > 2000 ? 5 : 4);
      for (var i = 0; i < names.length; i++) {
        if (visible && !visible.has(i)) continue;      // <-- the scope guard
        var raw = names[i];
        if (raw === null || raw === undefined) continue;
        raw = String(raw);
        if (!raw || raw === "(Unknown)" || raw === "-") continue;
        var n = normalise(raw);
        if (n.length < 3) continue;
        var forms = [];
        aliasesOf(n).forEach(function (form, f) {
          if (f > 0 && form.length < minAlias) return;
          if (allStopwords(form)) return;
          forms.push(form);
          var resolvedForm = resolveSynonyms(form);
          if (resolvedForm !== form && forms.indexOf(resolvedForm) < 0) {
            forms.push(resolvedForm);
          }
        });
        if (forms.length) idx.push({ dim: dim, idx: i, name: raw, forms: forms });
      }
    });
    _indexCache[key] = idx;
    return idx;
  }

  // -------------------------------------------------------------------------
  // FUZZY MATCHING — deliberately hard to trigger
  // -------------------------------------------------------------------------
  // Fuzzy matching exists to forgive typos ("semaglutid", "pharcoo"). It is a
  // genuinely useful fallback and it runs only when exact matching found
  // nothing at all, so it can never override a real hit.
  //
  // But it is also the easiest way to reintroduce the exact failure this whole
  // feature exists to prevent. At a 0.80 similarity threshold with a 4-char
  // minimum, one edit on a five-letter word is a match — and against a
  // 34,000-name vocabulary something is ALWAYS within one edit. Observed live:
  //
  //     "what is the weather in cairo"  ->  cairo ≈ chiro   (0.80)
  //         answered about COLECALCIFEROL + D-CHIRO-INOSITOL + ...
  //     "how do i reset my password"    ->  reset ≈ RESEPT  (0.83)
  //         answered about a product called RESEPT
  //
  // Fluent, sourced, evidenced, and about entirely the wrong thing. Worse than
  // refusing, because the reader has no signal that anything went wrong.
  //
  // So the bar is now three tests, all of which must pass:
  //   - the typed word is at least MIN_FUZZY_LEN characters (short words carry
  //     too little information to correct safely),
  //   - similarity is at least MIN_FUZZY_SIM,
  //   - AND the absolute edit distance is at most MAX_FUZZY_EDITS, so long
  //     names cannot accumulate a passing ratio out of many small differences.
  //
  // Anything that does get through is DISCLOSED — see `isFuzzy` handling in
  // answer(). A guessed interpretation the reader is not told about is not an
  // answer, it is a trap.
  var MIN_FUZZY_LEN = 6;
  var MIN_FUZZY_SIM = 0.85;
  var MAX_FUZZY_EDITS = 2;

  function findFuzzyEntities(adapter, q) {
    var nq = normalise(q);
    var words = nq.split(" ").filter(function (w) {
      return w.length >= MIN_FUZZY_LEN && !STOPWORDS[w] && !GENERIC_TOKENS[w];
    });
    if (!words.length) return [];

    var hits = [];
    var index = buildIndex(adapter);

    words.forEach(function (word) {
      var bestScore = 0, bestMatch = null, bestForm = null;
      index.forEach(function (e) {
        e.forms.forEach(function (form) {
          // Compare against whole-word tokens only. Matching a short token
          // buried inside a long multi-word name is how "cairo" reached
          // D-CHIRO-INOSITOL.
          var candidates = form.indexOf(" ") >= 0 ? form.split(" ") : [form];
          candidates.forEach(function (ft) {
            if (ft.length < MIN_FUZZY_LEN) return;
            if (Math.abs(ft.length - word.length) > MAX_FUZZY_EDITS) return;
            if (editDistance(word, ft) > MAX_FUZZY_EDITS) return;
            var s = levenshteinSimilarity(word, ft);
            if (s >= MIN_FUZZY_SIM && s > bestScore) {
              bestScore = s; bestMatch = e; bestForm = ft;
            }
          });
        });
      });
      if (bestMatch) {
        hits.push({
          dim: bestMatch.dim,
          idx: bestMatch.idx,
          name: bestMatch.name,
          len: word.length,
          matched: word,
          pos: nq.indexOf(word),
          isFuzzy: true,
          fuzzyFrom: word,
          fuzzyTo: bestForm,
          similarity: bestScore
        });
      }
    });

    return hits;
  }

  /**
   * Resolve entity mentions in a question.
   * Longest match wins; presentation order follows the order they were typed.
   */
  function findEntities(adapter, q, rank) {
    var resolvedQ = resolveSynonyms(normalise(q));
    var nq = normalise(resolvedQ);
    if (!nq) return [];
    var padded = " " + nq + " ";
    var hits = [];
    buildIndex(adapter).forEach(function (e) {
      for (var f = 0; f < e.forms.length; f++) {
        var form = e.forms[f];
        if (padded.indexOf(" " + form + " ") < 0) continue;
        hits.push({ dim: e.dim, idx: e.idx, name: e.name,
                    len: form.length, matched: form, pos: nq.indexOf(form) });
        return;
      }
    });

    if (!hits.length) {
      hits = findFuzzyEntities(adapter, q);
    }

    if (!hits.length) return [];

    // Optional commercial tiebreak: when two entities match text of the same
    // length, prefer the larger one. Adapters supply `rank(dimKey, idx)`.
    hits.sort(function (a, b) {
      if (b.len !== a.len) return b.len - a.len;
      if (!rank) return 0;
      return (rank(b.dim.key, b.idx) || 0) - (rank(a.dim.key, a.idx) || 0);
    });

    // Drop matches contained inside a longer match already kept, so one
    // mention yields one entity.
    var kept = [];
    hits.forEach(function (h) {
      if (!kept.some(function (k) { return hasPhrase(k.matched, h.matched); })) kept.push(h);
    });
    return kept.slice(0, 3).sort(function (a, b) { return a.pos - b.pos; });
  }

  // =========================================================================
  // Intent
  // =========================================================================
  var INTENTS = [
    { id: "why",         test: /\b(why|root ?cause|reason|drop|underperform|diagnos(e|is|ing)?|explain(s|ed|ing)?)\b/i },
    { id: "share",       test: /\b(share|percentage|percent)\b|%\s*of/i },
    { id: "achievement", test: /\b(achiev|attain|vs ?target|against target|target)\b/i },
    { id: "coverage",    test: /\b(coverage|covered|reach)\b/i },
    { id: "frequency",   test: /\b(frequency|freq|right ?freq|call ?rate|visits?)\b/i },
    { id: "growth",      test: /\b(grow|grew|growth|growing|cagr|trend|declin|increase|decrease)\b/i },
    { id: "compare",     test: /\b(compare|versus|vs\.?|against)\b/i },
    { id: "rank",        test: /\b(rank|ranking|position|standing|place)\b/i },
    { id: "top",         test: /\b(top|biggest|largest|leading|leader|best|highest|main|bottom|worst|lowest)\b/i },
    { id: "price",       test: /\b(price|pricing|expensive|cheap|per unit)\b/i },
    { id: "size",        test: /.*/ }
  ];

  function intentOf(q) {
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].test.test(q)) return INTENTS[i].id;
    }
    return "size";
  }

  /** "top 15 ..." -> 15, capped. */
  function requestedN(q, dflt) {
    var m = String(q).match(/\btop\s+(\d{1,3})\b/i) || String(q).match(/\b(\d{1,3})\s+(?:top|best|biggest)\b/i);
    if (!m) return dflt;
    return Math.max(1, Math.min(parseInt(m[1], 10), 50));
  }

  /** Whether the question asks for the worst rather than the best. */
  function wantsBottom(q) { return /\b(bottom|worst|lowest|weakest|poorest)\b/i.test(q); }

  // =========================================================================
  // Formatting
  // =========================================================================
  function fmtNum(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return Math.round(v).toLocaleString();
  }
  function fmtPct(v, d) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return v.toFixed(d === undefined ? 1 : d) + "%";
  }
  function fmtSignedPct(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
  }
  function pctGrowth(cur, prev) {
    if (prev === null || prev === undefined || prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // =========================================================================
  // Rendering
  // =========================================================================
  var _state = {};      // per-adapter last question, so it survives re-render

  function questionFor(id) { return _state[id] || ""; }
  function setQuestion(id, q) { _state[id] = q || ""; }
  function clearAll() { _state = {}; }

  function headHtml(adapter) {
    return '<div class="mi-ask-head">' +
      '<span class="mi-ask-icon" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" ' +
          'stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="11" cy="11" r="7"></circle>' +
          '<line x1="16.5" y1="16.5" x2="21" y2="21"></line>' +
        "</svg></span>" +
      '<div class="mi-ask-head-txt">' +
        '<h2 class="mi-ask-title">' + esc(adapter.title || "Ask the Data") + "</h2>" +
        '<p class="mi-ask-sub">' + esc(adapter.subtitle || "") + "</p>" +
      "</div>" +
    "</div>";
  }

  /**
   * The scope ribbon.
   *
   * Shown whenever the user is restricted. It is not decoration — a BU Manager
   * reading "Top 10 brands" needs to know without asking that the ranking
   * covers their lines only, or they will read it as a company ranking and act
   * on it. Unrestricted users get no ribbon; there is nothing to disclose.
   */
  function scopeRibbonHtml(adapter) {
    var label = adapter.scopeLabel ? adapter.scopeLabel() : null;
    if (!label) return "";
    return '<div class="mi-ask-scope">' +
      '<span class="mi-ask-scope-k">Answering within</span>' +
      '<span class="mi-ask-scope-v">' + esc(label) + "</span>" +
    "</div>";
  }

  function render(adapter) {
    var q = questionFor(adapter.id);
    var res = null;
    if (q) {
      try {
        res = answer(adapter, q);
      } catch (e) {
        if (global.console) console.error("[Ask:" + adapter.id + "]", e);
        res = { ok: false, question: q,
                message: "Something went wrong computing that answer.",
                hint: "Try one of the example questions below." };
      }
    }
    return '<section class="mi-ask-hero' + (q ? " is-answered" : "") +
             '" id="ask-' + esc(adapter.id) + '" data-ask-panel="' + esc(adapter.id) + '">' +
      headHtml(adapter) +
      scopeRibbonHtml(adapter) +
      '<div class="mi-ask-bar" style="position:relative;">' +
        '<input type="text" class="mi-ask-input" autocomplete="off" ' +
          'placeholder="' + esc(adapter.placeholder || "Ask a question about this data…") + '" ' +
          'value="' + esc(q) + '" />' +
        '<div class="mi-ask-autocomplete hidden" style="position:absolute; top:100%; left:0; right:0; background:white; border:1px solid #cbd5e1; border-radius:6px; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); z-index:9999; max-height:240px; overflow-y:auto; margin-top:4px;"></div>' +
        '<button type="button" class="mi-btn mi-btn-primary mi-ask-go">Ask</button>' +
        (q ? '<button type="button" class="mi-btn mi-btn-ghost mi-ask-clear">Clear</button>' : "") +
      "</div>" +
      '<div class="mi-ask-ex">' +
        '<span class="mi-ask-ex-label">Try</span>' +
        (adapter.examples || []).map(function (e) {
          return '<button type="button" class="mi-ask-chip" data-ask="' + esc(e) + '">' + esc(e) + "</button>";
        }).join("") +
      "</div>" +
      '<div class="mi-ask-out">' + resultHtml(adapter, res) + "</div>" +
    "</section>";
  }

  function resultHtml(adapter, r) {
    if (!r) return "";
    if (!r.ok) {
      return '<div class="mi-ask-card mi-ask-fail">' +
        '<div class="mi-ask-q">' + esc(r.question) + "</div>" +
        '<div class="mi-ask-headline">I cannot answer that from this data</div>' +
        '<div class="mi-ask-detail">' + esc(r.message) + "</div>" +
        (r.hint ? '<div class="mi-ask-hint">' + esc(r.hint) + "</div>" : "") +
      "</div>";
    }
    var h = '<div class="mi-ask-card">' +
      '<div class="mi-ask-q">' + esc(r.question) + "</div>" +
      '<div class="mi-ask-headline">' + esc(r.headline) + "</div>" +
      (r.detail ? '<div class="mi-ask-detail">' + esc(r.detail) + "</div>" : "");

    if (r.rows && r.rows.length) {
      var cols = r.columns || ["Value"];
      h += '<div class="mi-ask-tablewrap"><table class="mi-table mi-ask-table"><thead><tr>' +
        '<th class="mi-th-rank">#</th><th>' + esc(r.nameHeader || "Name") + "</th>" +
        cols.map(function (c) { return '<th class="mi-num">' + esc(c) + "</th>"; }).join("") +
        "</tr></thead><tbody>";
      r.rows.forEach(function (x) {
        var hi = !!x.highlight;
        h += "<tr" + (hi ? ' class="mi-row-zeta"' : "") + '>' +
          '<td class="mi-th-rank">' + x.rank + "</td>" +
          "<td>" + esc(x.name) + (hi ? ' <span class="mi-zeta-tag">US</span>' : "") + "</td>" +
          (x.cells || []).map(function (c, i) {
            return '<td class="mi-num' + (i === 0 ? " mi-strong" : "") + '">' + esc(c) + "</td>";
          }).join("") +
        "</tr>";
      });
      h += "</tbody></table></div>";
    }

    if (r.compare && r.compare.length) {
      h += '<div class="mi-ask-tablewrap"><table class="mi-table mi-ask-table"><thead><tr><th></th>' +
        r.compare.map(function (c) { return "<th>" + esc(c.name) + "</th>"; }).join("") +
        "</tr></thead><tbody>";
      (r.compareRows || []).forEach(function (row) {
        h += '<tr><td class="mi-strong">' + esc(row[0]) + "</td>" +
          r.compare.map(function (c) {
            return '<td class="mi-num">' + esc(row[1](c)) + "</td>";
          }).join("") + "</tr>";
      });
      h += "</tbody></table></div>";
    }

    // THE EVIDENCE. Always shown, never collapsed — a figure without its basis
    // is exactly what this feature exists to avoid producing.
    if (r.formula) h += '<div class="mi-ask-formula"><code>' + esc(r.formula) + "</code></div>";
    if (r.caveats && r.caveats.length) {
      h += '<div class="mi-ask-caveat">' +
        r.caveats.map(function (c) { return "⚠ " + esc(c); }).join("<br>") + "</div>";
    }
    if (adapter.sourceNote) {
      h += '<div class="mi-ask-src">Source: ' + esc(adapter.sourceNote()) + "</div>";
    }
    return h + "</div>";
  }

  /**
   * Run a question through an adapter.
   *
   * Scope evidence is appended here, centrally, rather than left to each
   * adapter branch to remember. Every answer a restricted user sees states the
   * scope it was computed in.
   */
  function answer(adapter, q) {
    if (!q || !q.trim()) return null;
    var parsed = {
      q: q,
      intent: intentOf(q),
      entities: findEntities(adapter, q, adapter.rankHint),
      n: requestedN(q, 10),
      bottom: wantsBottom(q)
    };
    var res = adapter.answer(q, parsed, {
      fmtNum: fmtNum, fmtPct: fmtPct, fmtSignedPct: fmtSignedPct,
      pctGrowth: pctGrowth, normalise: normalise
    });
    if (!res) {
      return {
        ok: false, question: q,
        message: "I could not match anything in that question to this page's data.",
        hint: adapter.notFoundHint || "Try one of the examples below."
      };
    }
    res.question = q;
    if (res.ok) {
      res.evidence = res.evidence || [];
      var scope = adapter.scopeLabel ? adapter.scopeLabel() : null;
      res.evidence.push(["Scope", scope
        ? scope + " — your access. Figures exclude everything outside it."
        : "Unrestricted — the full company."]);
      res.caveats = res.caveats || [];
      if (scope) {
        res.caveats.push("This answer covers " + scope + " only. It is not a " +
          "company-wide figure, and rankings are within your scope.");
      }
      if (parsed.entities && parsed.entities.some(function (e) { return e.isFuzzy; })) {
        var fuzzyNames = parsed.entities.filter(function (e) { return e.isFuzzy; }).map(function (e) {
          return "“" + e.matched + "” interpreted as “" + e.name + "”";
        }).join(", ");
        res.caveats.push("Fuzzy matching: " + fuzzyNames + ".");
      }
    }
    return res;
  }

  // =========================================================================
  // Mounting
  // =========================================================================
  /**
   * Wire a rendered panel. Called after the host page writes the HTML.
   *
   * Re-renders only when the Clear button needs to appear or disappear —
   * re-rendering on every keystroke would steal focus mid-question.
   */
  function autocompleteText(currentVal, matchedWord, completeName) {
    var idx = currentVal.toLowerCase().lastIndexOf(matchedWord.toLowerCase());
    if (idx >= 0) {
      return currentVal.substring(0, idx) + completeName + currentVal.substring(idx + matchedWord.length);
    }
    return completeName;
  }

  function wire(root, adapter, onRerender) {
    var panel = root.querySelector('[data-ask-panel="' + adapter.id + '"]');
    if (!panel) return;
    var input = panel.querySelector(".mi-ask-input");
    var out = panel.querySelector(".mi-ask-out");
    var autocompleteDiv = panel.querySelector(".mi-ask-autocomplete");
    var debounceTimeout = null;

    function run(v) {
      var q = (v !== undefined ? v : (input ? input.value : "")).trim();
      var had = !!questionFor(adapter.id);
      setQuestion(adapter.id, q);
      if (input) input.value = q;
      if (out) {
        var res = null;
        if (q) {
          try { res = answer(adapter, q); }
          catch (e) {
            if (global.console) console.error("[Ask:" + adapter.id + "]", e);
            res = { ok: false, question: q,
                    message: "Something went wrong computing that answer.",
                    hint: "Try one of the example questions below." };
          }
        }
        out.innerHTML = resultHtml(adapter, res);
      }
      if (!!q !== had && typeof onRerender === "function") onRerender();
    }

    var go = panel.querySelector(".mi-ask-go");
    if (go) go.addEventListener("click", function () { run(); });
    if (input) input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (autocompleteDiv) autocompleteDiv.classList.add("hidden");
        run();
      }
    });
    var clear = panel.querySelector(".mi-ask-clear");
    if (clear) clear.addEventListener("click", function () {
      setQuestion(adapter.id, "");
      if (typeof onRerender === "function") onRerender();
    });
    panel.querySelectorAll("[data-ask]").forEach(function (b) {
      b.addEventListener("click", function () { run(b.getAttribute("data-ask")); });
    });

    if (input && autocompleteDiv) {
      input.addEventListener("input", function () {
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(function () {
          var val = input.value;
          if (val.trim().length < 2) {
            autocompleteDiv.classList.add("hidden");
            return;
          }
          var words = val.split(" ");
          var lastWord = words[words.length - 1].toLowerCase().trim();
          if (lastWord.length < 2 || STOPWORDS[lastWord] || GENERIC_TOKENS[lastWord]) {
            autocompleteDiv.classList.add("hidden");
            return;
          }

          var matches = [];
          var index = buildIndex(adapter);
          for (var i = 0; i < index.length; i++) {
            var e = index[i];
            var matchFound = false;
            for (var f = 0; f < e.forms.length; f++) {
              if (e.forms[f].indexOf(lastWord) >= 0) {
                matchFound = true;
                break;
              }
            }
            if (matchFound) {
              matches.push(e);
              if (matches.length >= 5) break;
            }
          }

          if (matches.length === 0) {
            autocompleteDiv.classList.add("hidden");
            return;
          }

          var html = "";
          matches.forEach(function (m) {
            html += '<div class="mi-autocomplete-item" data-matched="' + esc(lastWord) + '" data-name="' + esc(m.name) + '" style="padding: 10px 14px; cursor: pointer; font-size: 0.85rem; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; color: #1e293b; background: white;" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'white\'">' +
              '<span>' + esc(m.name) + '</span>' +
              '<span style="font-size: 0.75rem; color: #64748b; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">' + esc(m.dim.label) + '</span>' +
            '</div>';
          });
          autocompleteDiv.innerHTML = html;
          autocompleteDiv.classList.remove("hidden");

          autocompleteDiv.querySelectorAll(".mi-autocomplete-item").forEach(function (item) {
            item.addEventListener("click", function (evt) {
              evt.stopPropagation();
              var matched = item.getAttribute("data-matched");
              var name = item.getAttribute("data-name");
              input.value = autocompleteText(input.value, matched, name);
              autocompleteDiv.classList.add("hidden");
              input.focus();
            });
          });
        }, 150);
      });

      document.addEventListener("click", function () {
        autocompleteDiv.classList.add("hidden");
      });
      input.addEventListener("click", function (evt) {
        evt.stopPropagation();
      });
    }
  }

  global.AskEngine = {
    render: render,
    wire: wire,
    answer: answer,
    resultHtml: resultHtml,
    buildIndex: buildIndex,
    findEntities: findEntities,
    resolveSynonyms: resolveSynonyms,
    intentOf: intentOf,
    requestedN: requestedN,
    wantsBottom: wantsBottom,
    normalise: normalise,
    hasPhrase: hasPhrase,
    aliasesOf: aliasesOf,
    allStopwords: allStopwords,
    fmtNum: fmtNum,
    fmtPct: fmtPct,
    fmtSignedPct: fmtSignedPct,
    pctGrowth: pctGrowth,
    esc: esc,
    setQuestion: setQuestion,
    getQuestion: questionFor,
    clearAll: clearAll,
    invalidateIndexes: invalidateIndexes,
    _currentUserKey: currentUserKey,
    STOPWORDS: STOPWORDS,
    GENERIC_TOKENS: GENERIC_TOKENS
  };
})(typeof window !== "undefined" ? window : this);
