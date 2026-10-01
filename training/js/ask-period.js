(function(g){(g.AskBuild=g.AskBuild||{})["ask-period.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — time-aware query layer (AskPeriod)
 * ============================================================================
 *
 * ONE place that understands time. Every adapter/provider uses it, so
 * "July", "Q3", "YTD" and "MoM" mean exactly the same thing on every page.
 *
 *   text  ──parse()──▶  PeriodSpec  ──resolve(spec, avail)──▶  Resolved
 *
 * parse()   is PURE TEXT -> spec. It knows nothing about any dataset.
 * resolve() maps a spec onto the months a particular dataset actually holds
 *           (`avail.months`, e.g. Sales has Jan–Jul, Coverage has Feb–Aug) and
 *           reports honestly what is partial or missing. It never invents a
 *           month: a period the data does not hold comes back in `missing`.
 *
 * Supported (all combinable with a comparison):
 *   month ........ "July", "Jul 2026", "2026-07", "07/2026", "last month",
 *                  "this month", "previous month", "latest month"
 *   YTD / MTD .... "YTD", "year to date", "MTD", "month to date"
 *   quarter ...... "Q1".."Q4", "Q3 2026", "third quarter", "last quarter"
 *   half ......... "H1", "S1", "S2", "first half", "second half"
 *   range ........ "Feb to May", "between March and June", "Feb–Jun",
 *                  "from January through April"
 *   rolling ...... "last 3 months", "past 6 months"
 *   selected ..... "current selected period" (the page's own period filter)
 *   comparison ... MoM ("vs last month"), YoY ("vs last year"), explicit
 *                  pairs ("July vs June", "Q2 vs Q1"), trend ("by month")
 *
 * Semantics worth knowing (they are printed on every answer as assumptions):
 *   - The data is MONTHLY, so MTD = the latest loaded month (a partial month
 *     as of the last refresh) and "this month" = the latest loaded month.
 *   - "last month" / "previous month" = the month BEFORE the latest loaded
 *     month of the dataset being asked. Relative words are relative to the
 *     data, not to the calendar, because the data lags the calendar.
 *   - "YTD" = every loaded month of the year up to the latest loaded month.
 *   - Two-digit or missing years default to the dataset's latest year.
 */
(function (global) {
  "use strict";

  var MON = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
              may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
              sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
              dec: 12, december: 12 };
  var MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
                  "September", "October", "November", "December"];

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  function key(y, m) { return y + "-" + (m < 10 ? "0" : "") + m; }
  function parseKey(k) { var p = String(k).split("-"); return { y: +p[0], m: +p[1] }; }
  function idx(k) { var p = parseKey(k); return p.y * 12 + (p.m - 1); }
  function fromIdx(i) { return key(Math.floor(i / 12), (i % 12) + 1); }
  function shift(k, n) { return fromIdx(idx(k) + n); }
  function label(k) { var p = parseKey(k); return MON_SHORT[p.m - 1] + " " + p.y; }
  function sortKeys(a) { return a.slice().sort(function (x, y) { return idx(x) - idx(y); }); }

  function labelSet(keys) {
    keys = sortKeys(keys);
    if (!keys.length) return "no months";
    if (keys.length === 1) return label(keys[0]);
    var contiguous = true;
    for (var i = 1; i < keys.length; i++) if (idx(keys[i]) - idx(keys[i - 1]) !== 1) { contiguous = false; break; }
    var a = parseKey(keys[0]), b = parseKey(keys[keys.length - 1]);
    if (contiguous) {
      return a.y === b.y ? MON_SHORT[a.m - 1] + "–" + MON_SHORT[b.m - 1] + " " + b.y
                         : label(keys[0]) + " – " + label(keys[keys.length - 1]);
    }
    return keys.map(label).join(", ");
  }

  // ---------------------------------------------------------------------
  // parse: text -> PeriodSpec(s)
  // ---------------------------------------------------------------------
  var MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  // A month token, optionally followed by a year ("Jul 2026", "Jul-26", "Jul '26").
  var MONTH_TOKEN = new RegExp("\\b" + MONTH_RE + "\\b(?:(?:[\\s,]+(20\\d\\d))|(?:\\s*['’\\-\\/]\\s*(\\d\\d)\\b))?", "gi");
  var MAY_CONTEXT = /(?:\b(?:in|for|of|during|since|until|till|from|to|through|thru|between|and|vs\.?|versus|by|after|before|month of|than)\s+|[-–—,]\s*)$/i;

  function normalizeQuestion(q) {
    return String(q || "").replace(/[–—]/g, "-").replace(/\s+/g, " ");
  }

  /** Find every month token (with position), applying the "may" guard. */
  function monthTokens(q) {
    var out = [], m;
    MONTH_TOKEN.lastIndex = 0;
    while ((m = MONTH_TOKEN.exec(q))) {
      var name = m[1].toLowerCase();
      var yr = m[2] ? +m[2] : (m[3] ? 2000 + (+m[3]) : null);
      if (name === "may") {
        var before = q.slice(0, m.index);
        var isCap = m[1].charAt(0) === "M" && m.index > 0;
        if (!(yr || MAY_CONTEXT.test(before) || (isCap && /\b(20\d\d|ytd|sales|coverage)\b/i.test(q)) || m.index + m[0].length >= q.replace(/[?.!\s]+$/, "").length && m.index > 0 && !/\b(i|we|you|they|it|he|she)\s*$/i.test(before))) continue;
      }
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], m: MON[name], y: yr });
    }
    return out;
  }

  function spanText(q, s, e) { return q.slice(s, e); }

  /**
   * Parse a question into { specs:[PeriodSpec...], cmp, trend, consumed:[[s,e]...] }.
   * `specs` are in the order typed. A spec is one of:
   *   {type:"months", months:[{y,m}]}            explicit month(s)
   *   {type:"range",  from:{y,m}, to:{y,m}}
   *   {type:"quarter", q, y}   {type:"half", h, y}
   *   {type:"ytd", y} {type:"mtd"} {type:"latest"} {type:"rel", n}   n = -1 for "last month"
   *   {type:"rolling", n}      {type:"all"}   {type:"selected"}   {type:"year", y}
   */
  function parse(question) {
    var q = normalizeQuestion(question);
    var lower = q.toLowerCase();
    var used = [];        // [start,end] ranges already claimed
    var specs = [];
    var cmp = null;       // {type:"mom"|"yoy"}
    var trend = false;
    function claim(s, e) { used.push([s, e]); }
    function claimed(s, e) { return used.some(function (u) { return s < u[1] && e > u[0]; }); }
    function add(spec, s, e) { spec.pos = s; spec.text = q.slice(s, e); specs.push(spec); claim(s, e); }

    // ---- comparison keywords (claimed first so "last month" inside them is not read as a period)
    var re, m;
    re = /\b(?:mom|m\/m|month[- ]on[- ]month|month[- ]over[- ]month)\b|\b(?:vs\.?|versus|compared (?:to|with)|against|from)\s+(?:the\s+)?(?:last|previous|prior)\s+month\b/gi;
    while ((m = re.exec(lower))) { cmp = { type: "mom", text: m[0] }; claim(m.index, m.index + m[0].length); }
    re = /\b(?:yoy|y\/y|year[- ]on[- ]year|year[- ]over[- ]year)\b|\b(?:vs\.?|versus|compared (?:to|with)|against|from)\s+(?:the\s+)?(?:same\s+(?:period|month|quarter)\s+)?(?:last|previous|prior)\s+year\b/gi;
    while ((m = re.exec(lower))) { cmp = { type: "yoy", text: m[0] }; claim(m.index, m.index + m[0].length); }
    re = /\b(?:trend|trends|over time|month[- ]by[- ]month|by month|monthly|each month|per month|month[- ]wise|history)\b/gi;
    while ((m = re.exec(lower))) { trend = true; claim(m.index, m.index + m[0].length); }

    // ---- ISO / numeric months
    re = /\b(20\d\d)[-\/](0?[1-9]|1[0-2])\b/g;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "months", months: [{ y: +m[1], m: +m[2] }] }, m.index, m.index + m[0].length);
    re = /\b(0?[1-9]|1[0-2])[\/-](20\d\d)\b/g;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "months", months: [{ y: +m[2], m: +m[1] }] }, m.index, m.index + m[0].length);

    // ---- quarters / halves / ytd / mtd / rolling / relative words
    re = /\b(?:q([1-4])|(first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter)(?:\s*[-,]?\s*(20\d\d))?\b/gi;
    while ((m = re.exec(q))) {
      if (claimed(m.index, m.index + m[0].length)) continue;
      var qn = m[1] ? +m[1] : { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 }[m[2].toLowerCase()];
      add({ type: "quarter", q: qn, y: m[3] ? +m[3] : null }, m.index, m.index + m[0].length);
    }
    re = /\b(?:([hs])([12])|(first|second|1st|2nd)\s+half)(?:\s*[-,]?\s*(20\d\d))?\b/gi;
    while ((m = re.exec(q))) {
      if (claimed(m.index, m.index + m[0].length)) continue;
      var hn = m[2] ? +m[2] : ({ first: 1, "1st": 1, second: 2, "2nd": 2 })[m[3].toLowerCase()];
      add({ type: "half", h: hn, y: m[4] ? +m[4] : null }, m.index, m.index + m[0].length);
    }
    re = /\b(?:(?:last|previous|prior|this|current)\s+quarter)\b/gi;
    while ((m = re.exec(q))) {
      if (claimed(m.index, m.index + m[0].length)) continue;
      add({ type: "relquarter", n: /this|current/i.test(m[0]) ? 0 : -1 }, m.index, m.index + m[0].length);
    }
    re = /\b(ytd|year[- ]to[- ]date|so far this year|since (?:the )?(?:start|beginning) of (?:the )?year)\b(?:\s+(20\d\d))?/gi;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "ytd", y: m[2] ? +m[2] : null }, m.index, m.index + m[0].length);
    re = /\b(mtd|month[- ]to[- ]date)\b/gi;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "mtd" }, m.index, m.index + m[0].length);
    re = /\b(?:last|past|previous|prior)\s+(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+months\b/gi;
    while ((m = re.exec(q))) {
      if (claimed(m.index, m.index + m[0].length)) continue;
      var words = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
      var nn = isNaN(+m[1]) ? words[m[1].toLowerCase()] : +m[1];
      add({ type: "rolling", n: nn }, m.index, m.index + m[0].length);
    }
    re = /\b(?:current selected period|selected period|current period|the period (?:i|we) (?:selected|chose)|period in the filter)\b/gi;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "selected" }, m.index, m.index + m[0].length);
    re = /\b(last|previous|prior)\s+month\b/gi;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "rel", n: -1 }, m.index, m.index + m[0].length);
    re = /\b(?:this|current|latest|most recent)\s+month\b|\bthe latest\b|\blatest period\b/gi;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "latest" }, m.index, m.index + m[0].length);
    re = /\ball[- ]time\b|\bto date\b|\bever\b|\boverall period\b/gi;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "all" }, m.index, m.index + m[0].length);
    re = /\b(?:this|current)\s+year\b/gi;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "ytd", y: null }, m.index, m.index + m[0].length);
    re = /\b(?:last|previous|prior)\s+year\b/gi;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "year", y: "prev" }, m.index, m.index + m[0].length);

    // ---- month names (+ ranges "Feb to May", "between Mar and Jun", pairs "July vs June")
    var toks = monthTokens(q).filter(function (t) { return !claimed(t.start, t.end); });
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], nx = toks[i + 1];
      if (nx) {
        var between = q.slice(t.end, nx.start).toLowerCase();
        var pre = q.slice(Math.max(0, t.start - 9), t.start).toLowerCase();
        var isRange = /^\s*(?:to|-|through|thru|until|till)\s*$/.test(between) ||
                      (/between\s*$/.test(pre) && /^\s*and\s*$/.test(between)) ||
                      (/from\s*$/.test(pre) && /^\s*(?:to|-|through|thru|until|till)\s*$/.test(between));
        if (isRange) {
          var y1 = t.y, y2 = nx.y;
          if (!y1 && y2 && nx.m < t.m) y1 = y2 - 1;
          add({ type: "range", from: { y: y1 || null, m: t.m }, to: { y: y2 || null, m: nx.m } }, t.start, nx.end);
          i++; continue;
        }
        var isList = /^\s*(?:,|and|&)\s*$/.test(between) && !/\b(vs|versus|compare|compared)\b/.test(pre + between);
        if (isList) {
          // "Jan, Feb and Mar" -> one explicit set
          var set = [{ y: t.y || null, m: t.m }], end = t.end, j = i;
          while (toks[j + 1] && /^\s*(?:,|and|&)\s*$/.test(q.slice(toks[j].end, toks[j + 1].start))) { j++; set.push({ y: toks[j].y || null, m: toks[j].m }); end = toks[j].end; }
          add({ type: "months", months: set }, t.start, end);
          i = j; continue;
        }
      }
      add({ type: "months", months: [{ y: t.y || null, m: t.m }] }, t.start, t.end);
    }

    // ---- bare year ("in 2026", "for 2025")
    re = /\b(?:in|for|during|of)\s+(20\d\d)\b/gi;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "year", y: +m[1] }, m.index, m.index + m[0].length);
    // A bare year anywhere ("rx 2024", "2025 vs 2024", "sales 2026") is still a period the user typed; never fall back
    // silently to the latest period. (Codes such as 2024-05 or 20245 are excluded by the boundary classes.)
    re = /(^|[^\w./-])(20\d\d)(?![\w/-]|\.\d)/g;
    while ((m = re.exec(q))) {
      var ys = m.index + m[1].length;
      if (!claimed(ys, ys + 4)) add({ type: "year", y: +m[2] }, ys, ys + 4);
    }

    // MAT = moving annual total = the 12 loaded months ending at the latest one ("MAT Dec 2025" is a month token, claimed above).
    re = /\b(mat|moving annual total|rolling 12 months?)\b(?!\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)/gi;
    while ((m = re.exec(q))) if (!claimed(m.index, m.index + m[0].length)) add({ type: "rolling", n: 12, mat: true }, m.index, m.index + m[0].length);

    specs.sort(function (a, b) { return a.pos - b.pos; });
    return { specs: specs, cmp: cmp, trend: trend, consumed: used, text: q };
  }

  /** The question with every recognised time expression blanked out — so that
   *  "July" or "Q3" can never be mistaken for an entity name. */
  function stripTime(question) {
    var p = parse(question), q = p.text, out = "", last = 0;
    var r = p.consumed.slice().sort(function (a, b) { return a[0] - b[0]; });
    r.forEach(function (x) { if (x[0] >= last) { out += q.slice(last, x[0]) + " "; last = x[1]; } });
    return (out + q.slice(last)).replace(/\s+/g, " ").trim();
  }

  // ---------------------------------------------------------------------
  // resolve: spec + availability -> concrete months
  // ---------------------------------------------------------------------
  /**
   * @param spec   a PeriodSpec from parse(), or null (= nothing typed)
   * @param avail  { months:["2026-01",...], selected?:[...], defaultYear? , name? }
   * @returns { ok, keys:[...present], requested:[...], missing:[...], label, kind,
   *            partial, explicit, assumption, note }
   */
  function resolve(spec, avail) {
    avail = avail || {};
    var have = sortKeys(avail.months || []);
    var haveSet = {}; have.forEach(function (k) { haveSet[k] = 1; });
    var latest = have.length ? have[have.length - 1] : null;
    var defY = avail.defaultYear || (latest ? parseKey(latest).y : new Date().getFullYear());
    var name = avail.name ? avail.name + " " : "";
    var res = { ok: false, keys: [], requested: [], missing: [], label: "", kind: spec ? spec.type : "latest",
                partial: false, explicit: !!spec, assumption: null, note: null };

    function finish(requested, kind, lbl, assumption) {
      requested = sortKeys(requested.filter(function (k, i, a) { return a.indexOf(k) === i; }));
      res.requested = requested;
      res.keys = requested.filter(function (k) { return haveSet[k]; });
      res.missing = requested.filter(function (k) { return !haveSet[k]; });
      res.kind = kind;
      res.partial = res.keys.length > 0 && res.missing.length > 0;
      res.ok = res.keys.length > 0;
      res.label = lbl || labelSet(res.ok ? res.keys : requested);
      if (assumption) res.assumption = assumption;
      if (res.partial) res.note = res.label + " — only " + labelSet(res.keys) + " is loaded in the " + name + "data (" + labelSet(res.missing) + " not available).";
      if (!res.ok && requested.length) res.note = "The " + name + "data holds " + (have.length ? labelSet(have) : "no months") + "; " + labelSet(requested) + " is not loaded.";
      return res;
    }

    if (!have.length) { res.note = "No months are loaded for this dataset."; return res; }
    if (!spec && avail.defaultPeriod === "ytd") {
      // The dashboard's own default view is year-to-date: an unqualified question must match the cards.
      var yy = resolve({ type: "ytd" }, avail);
      yy.explicit = false;
      yy.assumption = "No period given — using " + yy.label + ", the same view the dashboard cards default to.";
      return yy;
    }
    if (!spec && avail.defaultPeriod && /^\d{4}-\d{2}$/.test(avail.defaultPeriod) && haveSet[avail.defaultPeriod]) {
      var dk = avail.defaultPeriod;
      return finish([dk], "latest", label(dk) + " (default period)", "No period given — using " + label(dk) + ", the default period of this page.");
    }
    if (!spec && avail.defaultPeriod === "mat") {
      var mm = resolve({ type: "rolling", n: 12, mat: true }, avail);
      mm.explicit = false; mm.assumption = "No period given — using " + mm.label + ", the moving annual total the IQVIA page and the Executive BU share default to.";
      return mm;
    }
    if (!spec) {
      return finish([latest], "latest", label(latest) + " (latest loaded month)", "No period given — using the latest loaded month, " + label(latest) + ".");
    }

    switch (spec.type) {
      case "latest":
        return finish([latest], "latest", label(latest) + " (latest loaded month)", "“" + spec.text + "” read as the latest loaded month, " + label(latest) + ".");
      case "mtd":
        return finish([latest], "mtd", label(latest) + " (month to date)",
          "Data is monthly: month-to-date = the latest loaded month, " + label(latest) + ", as of the last refresh.");
      case "rel": {
        var prev = shift(latest, spec.n);
        return finish([prev], "month", label(prev), "“" + spec.text + "” = the month before the latest loaded month (" + label(latest) + "): " + label(prev) + ".");
      }
      case "months": {
        var reqs = spec.months.map(function (mm) { return key(mm.y || defY, mm.m); });
        var defaulted = spec.months.some(function (mm) { return !mm.y; });
        return finish(reqs, "month", null, defaulted ? "Year not stated — read as " + defY + "." : null);
      }
      case "range": {
        var y1 = spec.from.y || defY, y2 = spec.to.y || (spec.to.m < spec.from.m ? y1 + 1 : y1);
        var a = key(y1, spec.from.m), b = key(y2, spec.to.m);
        if (idx(b) < idx(a)) { var tmp = a; a = b; b = tmp; }
        var list = []; for (var i = idx(a); i <= idx(b); i++) list.push(fromIdx(i));
        return finish(list, "range", null, (spec.from.y && spec.to.y) ? null : "Year not stated — read as " + defY + ".");
      }
      case "quarter": {
        var qy = spec.y || defY, qm = [];
        for (var k = 0; k < 3; k++) qm.push(key(qy, (spec.q - 1) * 3 + 1 + k));
        return finish(qm, "quarter", "Q" + spec.q + " " + qy + " (" + labelSet(qm) + ")", spec.y ? null : "Year not stated — read as " + defY + ".");
      }
      case "relquarter": {
        var lp = parseKey(latest), cq = Math.floor((lp.m - 1) / 3) + 1, ty = lp.y, tq = cq + spec.n;
        if (tq < 1) { tq += 4; ty -= 1; }
        var rq = []; for (var r = 0; r < 3; r++) rq.push(key(ty, (tq - 1) * 3 + 1 + r));
        return finish(rq, "quarter", "Q" + tq + " " + ty + " (" + labelSet(rq) + ")", "“" + spec.text + "” is relative to the latest loaded month (" + label(latest) + ").");
      }
      case "half": {
        var hy = spec.y || defY, hm = [];
        for (var h = 0; h < 6; h++) hm.push(key(hy, (spec.h - 1) * 6 + 1 + h));
        return finish(hm, "half", (spec.h === 1 ? "H1/S1 " : "H2/S2 ") + hy + " (" + labelSet(hm) + ")", spec.y ? null : "Year not stated — read as " + defY + ".");
      }
      case "year": {
        var yy = spec.y === "prev" ? defY - 1 : spec.y;
        var ym = []; for (var q2 = 1; q2 <= 12; q2++) ym.push(key(yy, q2));
        return finish(ym, "year", String(yy), spec.y === "prev" ? "“last year” = " + yy + " (relative to the data's latest year, " + defY + ")." : null);
      }
      case "ytd": {
        var yr = spec.y || parseKey(latest).y;
        var upto = latest && parseKey(latest).y === yr ? latest : key(yr, 12);
        var yl = []; for (var mth = 1; mth <= parseKey(upto).m; mth++) yl.push(key(yr, mth));
        var f = finish(yl, "ytd", null, null);
        if (f.ok) {
          f.label = "YTD (" + labelSet(f.keys) + ")";
          if (f.missing.length) {
            // The dataset simply starts later in the year: its YTD IS the loaded months.
            f.partial = false;
            f.note = "The " + name + "data starts in " + label(f.keys[0]) + ", so YTD here means " + labelSet(f.keys) + " — the same span the dashboard cards use.";
          }
        }
        return f;
      }
      case "rolling": {
        var take = have.slice(-spec.n);
        var rr = finish(take, "rolling", (spec.mat ? "MAT" : "Last " + take.length + " loaded months") + " (" + labelSet(take) + ")", null);
        if (take.length < spec.n) rr.assumption = "Asked for " + spec.n + " months; only " + take.length + " are loaded.";
        return rr;
      }
      case "all":
        return finish(have, "all", "All loaded months (" + labelSet(have) + ")", null);
      case "selected": {
        var sel = (avail.selected && avail.selected.length) ? avail.selected : null;
        if (!sel) return finish([latest], "selected", label(latest) + " (latest loaded month)",
          "This page has no period selector I can read — using the latest loaded month, " + label(latest) + ".");
        return finish(sel, "selected", "Selected period (" + labelSet(sel) + ")", null);
      }
    }
    return res;
  }

  /** The comparison partner for MoM / YoY, as a Resolved. */
  function comparePeriod(resolved, type, avail) {
    var base = resolved.ok ? resolved.keys : resolved.requested;
    if (!base.length) return { ok: false, keys: [], requested: [], missing: [], label: "", kind: type };
    var haveSet = {}; (avail.months || []).forEach(function (k) { haveSet[k] = 1; });
    var n = base.length, shiftBy = type === "yoy" ? -12 : -n;
    var req = base.map(function (k) { return shift(k, shiftBy); });
    var keys = req.filter(function (k) { return haveSet[k]; });
    var lbl = (type === "yoy" ? "same period last year " : "previous " + (n === 1 ? "month " : n + " months ")) + "(" + labelSet(req) + ")";
    var out = { ok: keys.length > 0, keys: keys, requested: req, missing: req.filter(function (k) { return !haveSet[k]; }),
                label: lbl, kind: type, partial: keys.length > 0 && keys.length < req.length, explicit: true, assumption: null, note: null };
    if (!out.ok) out.note = (type === "yoy" ? "Year-over-year needs " : "Month-over-month needs ") + labelSet(req) +
      ", but the " + (avail.name ? avail.name + " " : "") + "data holds " + labelSet(avail.months || []) + ".";
    return out;
  }

  /** Every loaded month, one Resolved per month, for trend questions. */
  function series(avail, limit) {
    var have = sortKeys(avail.months || []);
    if (limit) have = have.slice(-limit);
    return have.map(function (k) {
      return { ok: true, keys: [k], requested: [k], missing: [], label: label(k), kind: "month", partial: false, explicit: true };
    });
  }

  /** Convenience: parse + resolve the primary period and any comparison in one go. */
  function interpret(question, avail) {
    var p = parse(question);
    var primary = p.specs[0] || null, second = p.specs[1] || null;
    var out = { parsed: p, primary: resolve(primary, avail), secondary: null, cmp: null, trend: p.trend, typed: !!primary };
    var lower = String(question || "").toLowerCase();
    var explicitPair = second && /\b(vs\.?|versus|compared (?:to|with)|against|than|relative to)\b/.test(lower);
    if (explicitPair) { out.secondary = resolve(second, avail); out.cmp = { type: "vs" }; }
    else if (p.cmp) { out.cmp = { type: p.cmp.type }; out.secondary = comparePeriod(out.primary, p.cmp.type, avail); }
    else if (second) { // two periods with no comparison word: treat as a set of months
      var union = resolve({ type: "months", months: [] }, avail); union = null; void union;
    }
    return out;
  }

  global.AskPeriod = {
    parse: parse, stripTime: stripTime, resolve: resolve, comparePeriod: comparePeriod,
    series: series, interpret: interpret,
    key: key, parseKey: parseKey, shift: shift, label: label, labelSet: labelSet, sortKeys: sortKeys,
    MON_SHORT: MON_SHORT, MON_LONG: MON_LONG
  };
})(typeof window !== "undefined" ? window : this);
