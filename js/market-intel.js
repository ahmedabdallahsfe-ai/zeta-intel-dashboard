/**
 * js/market-intel.js
 * =====================================================================
 * TOTAL MARKET INTELLIGENCE  --  executive workspace over the full
 * Egyptian pharmaceutical market (IMS, 2022-2026).
 *
 * Audience: CEO, Commercial Director, Marketing Director, BU Managers,
 * SFE Managers. Every view is built to answer a commercial question, not
 * to display a chart -- the layout follows the order an executive
 * actually reads a market in: how big and which way is it moving, who is
 * winning, where is the growth coming from, and what should we do.
 *
 * DATA -- cache/market_intel.data.js, built by
 * etl/build_market_intel_cache.py. Two cubes, because the source
 * workbook holds the same market in two shapes and neither alone is
 * sufficient (see that script's header for the full rationale):
 *
 *   annual   2022-2026, every dimension (TA / ATC4 / Corporation /
 *            Molecule / Product / Brand / Form / Launch Year / Price
 *            band). The analytical backbone -- all ranking, share,
 *            growth, portfolio and price work runs off this.
 *   monthly  2021-2025, month + Sector + TA / ATC4 / Corporation /
 *            Molecule. Powers the time-series only.
 *
 * TWO LIMITS THE UI STATES RATHER THAN HIDES:
 *   1. Month-level data stops at 2025-12. The source carries no month
 *      dimension for 2026, so a month filter cannot narrow 2026.
 *   2. The monthly cube has no Product/Brand/Form/Launch/Price columns,
 *      so those five filters cannot narrow the monthly trend charts.
 *      Both are disclosed inline where they bite.
 *
 * 2026 IS A PARTIAL YEAR (Jan-Apr). Year-on-year comparisons against it
 * are flagged, never silently annualised -- a 4-month year shown beside
 * 12-month years is the single easiest way to mislead a board.
 * =====================================================================
 */

(function (global) {
  "use strict";

  // ---------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------
  var CACHE = null;
  var A = null;          // annual cube views
  var _charts = [];

  function decodeCache() {
    if (CACHE) return true;
    var raw = global.MARKET_INTEL_CACHE;
    if (!raw || !raw.b64Data) return false;
    try {
      var t0 = performance.now();
      var bin = atob(raw.b64Data);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      CACHE = JSON.parse(pako.ungzip(bytes, { to: "string" }));
      A = CACHE.annual;
      A.n = A.units.length;
      console.log("[MarketIntel] cache decoded in " +
        (performance.now() - t0).toFixed(0) + "ms — " +
        A.n.toLocaleString() + " annual cells");
      return true;
    } catch (e) {
      console.error("[MarketIntel] cache decode failed", e);
      return false;
    }
  }

  // Annual field offsets (must match the ETL's `fields` array).
  var F_YEAR = 0, F_TA = 1, F_ATC = 2, F_CORP = 3, F_MOL = 4,
      F_PROD = 5, F_BRAND = 6, F_FORM = 7, F_LAUNCH = 8, F_PRICE = 9;

  // ---------------------------------------------------------------------
  // Filter state
  // ---------------------------------------------------------------------
  // Every filter is a Set of lookup INDICES, or null meaning "all". Index
  // sets keep the hot filter loop to O(1) membership tests over ~62k
  // annual / ~573k monthly cells, which is what makes re-filtering feel
  // instant rather than requiring a spinner.
  // Period (Month) and Sector are gone (2026-08-06). They existed only in
  // the monthly cube, which has been removed -- they could never narrow an
  // annual figure, so a live-looking control that changed nothing was
  // worse than no control at all.
  var Fx = {
    year: null, ta: null, atc4: null, molecule: null,
    corp: null, product: null, launchYear: null,
    priceBand: null, topN: 10,
  };

  function resetFilters() {
    Fx = {
      year: null, ta: null, atc4: null, molecule: null,
      corp: null, product: null, launchYear: null,
      priceBand: null, topN: 10,
    };
    // Default to full years only -- see PARTIAL-YEAR HANDLING below.
    if (CACHE) Fx.year = fullYearIndices();
  }

  function activeFilterCount() {
    var n = 0;
    ["year", "ta", "atc4", "molecule", "corp", "product",
     "launchYear", "priceBand"].forEach(function (k) {
      if (Fx[k] && Fx[k].size) n++;
    });
    return n;
  }

  // Launch-year buckets: 4,000+ distinct years would be an unusable
  // dropdown, and nobody filters on a single launch year -- they think in
  // eras ("everything launched since 2020").
  var LAUNCH_BUCKETS = [
    { label: "2020 and newer", test: function (y) { return y >= 2020; } },
    { label: "2010 - 2019", test: function (y) { return y >= 2010 && y < 2020; } },
    { label: "2000 - 2009", test: function (y) { return y >= 2000 && y < 2010; } },
    { label: "1990 - 1999", test: function (y) { return y >= 1990 && y < 2000; } },
    { label: "Before 1990", test: function (y) { return y > 0 && y < 1990; } },
    { label: "Unknown", test: function (y) { return !y; } },
  ];

  function launchBucketOf(y) {
    for (var i = 0; i < LAUNCH_BUCKETS.length; i++) {
      if (LAUNCH_BUCKETS[i].test(y)) return i;
    }
    return LAUNCH_BUCKETS.length - 1;
  }

  // ---------------------------------------------------------------------
  // Query engine
  // ---------------------------------------------------------------------
  /**
   * Walk the annual cube once, calling `visit(rowIdx, units, value)` for
   * every cell passing the active filters.
   *
   * `except` skips one filter -- used when building a filter's own option
   * list, so choosing "Oncology" doesn't erase every other Therapeutic
   * Area from the TA dropdown (the standard faceted-search behaviour;
   * without it the filter bar becomes a one-way trap).
   */
  function scanAnnual(visit, except) {
    var r = A.rows, u = A.units, v = A.value, s = A.stride, n = A.n;
    var fY = except === "year" ? null : Fx.year;
    var fT = except === "ta" ? null : Fx.ta;
    var fA = except === "atc4" ? null : Fx.atc4;
    var fC = except === "corp" ? null : Fx.corp;
    var fM = except === "molecule" ? null : Fx.molecule;
    var fP = except === "product" ? null : Fx.product;
    var fL = except === "launchYear" ? null : Fx.launchYear;
    var fB = except === "priceBand" ? null : Fx.priceBand;
    for (var i = 0, o = 0; i < n; i++, o += s) {
      if (fY && !fY.has(r[o + F_YEAR])) continue;
      if (fT && !fT.has(r[o + F_TA])) continue;
      if (fA && !fA.has(r[o + F_ATC])) continue;
      if (fC && !fC.has(r[o + F_CORP])) continue;
      if (fM && !fM.has(r[o + F_MOL])) continue;
      if (fP && !fP.has(r[o + F_PROD])) continue;
      if (fL && !fL.has(launchBucketOf(r[o + F_LAUNCH]))) continue;
      if (fB && !fB.has(r[o + F_PRICE])) continue;
      visit(o, u[i], v[i], i);
    }
  }

  /** Aggregate the annual cube by one dimension -> [{idx,name,value,units,cells}] */
  function aggregateBy(field, lookupKey, yearFilter) {
    var acc = new Map();
    scanAnnual(function (o, u, v) {
      if (yearFilter && !yearFilter.has(A.rows[o + F_YEAR])) return;
      var k = A.rows[o + field];
      var e = acc.get(k);
      if (e) { e.value += v; e.units += u; e.cells++; }
      else acc.set(k, { idx: k, value: v, units: u, cells: 1 });
    });
    var names = CACHE.lookups[lookupKey];
    var out = [];
    acc.forEach(function (e) { e.name = names[e.idx]; out.push(e); });
    out.sort(function (a, b) { return b.value - a.value; });
    return out;
  }

  /** Distinct count of a dimension under the active filters. */
  function distinctCount(field) {
    var s = new Set();
    scanAnnual(function (o) { s.add(A.rows[o + field]); });
    return s.size;
  }

  /** Totals for a specific set of years (null = all filtered years). */
  function totalsForYears(yearIdxSet) {
    var value = 0, units = 0;
    scanAnnual(function (o, u, v) {
      if (yearIdxSet && !yearIdxSet.has(A.rows[o + F_YEAR])) return;
      value += v; units += u;
    });
    return { value: value, units: units };
  }

  /** Years in play, ascending, respecting the year filter. */
  function activeYears() {
    var ys = CACHE.lookups.years.map(function (y, i) { return { y: y, i: i }; });
    if (Fx.year) ys = ys.filter(function (o) { return Fx.year.has(o.i); });
    ys.sort(function (a, b) { return a.y - b.y; });
    return ys;
  }

  /** Latest year in scope and the one before it -- the comparison spine
   *  for every KPI card. */
  function comparisonYears() {
    var ys = activeYears();
    if (!ys.length) return { cur: null, prev: null };
    var cur = ys[ys.length - 1];
    var prev = ys.length > 1 ? ys[ys.length - 2] : null;
    return { cur: cur, prev: prev };
  }

  // -------------------------------------------------------------------
  // PARTIAL-YEAR HANDLING
  // -------------------------------------------------------------------
  // 2026 holds January-April only. Placed beside four full years it
  // reads as a catastrophic collapse (-64.9% "growth", every corporation
  // apparently losing two thirds of its business) when nothing of the
  // sort happened -- it is simply a third of a year.
  //
  // So the DEFAULT year scope is full years only. 2026 stays selectable,
  // and selecting it raises a banner explaining that its comparison is
  // not like-for-like. Silently annualising it would be worse: a x3
  // extrapolation of a partial year is a forecast wearing the costume of
  // an actual.
  var PARTIAL_YEAR = 2026;
  var PARTIAL_MONTHS = 4;

  function isPartialYear(y) { return y === PARTIAL_YEAR; }

  function fullYearIndices() {
    var out = new Set();
    CACHE.lookups.years.forEach(function (y, i) {
      if (!isPartialYear(y)) out.add(i);
    });
    return out;
  }

  /** True when the current scope includes the partial year. */
  function scopeIncludesPartial() {
    var ys = activeYears();
    return ys.some(function (o) { return isPartialYear(o.y); });
  }

  // ---------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------
  function fmtLC(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (v / 1e3).toFixed(0) + "K";
    return Math.round(v).toLocaleString();
  }
  function fmtUnits(v) {
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
  function fmtPrice(v) {
    if (!v || isNaN(v)) return "—";
    return v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1);
  }
  function growth(cur, prev) {
    if (prev === null || prev === undefined || prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------------
  // ZETA IDENTITY
  // ---------------------------------------------------------------------
  // Every table, chart and list marks Zeta so a reader never has to hunt
  // for our own row in a 1,400-competitor market.
  //
  // MATCHED EXACTLY, NOT BY SUBSTRING. The corporation lookup contains
  // three names matching /zeta/: "ZETA PHARM*" (us), "ERBOZETA*" (an
  // unrelated Italian company) and "ZETA BIO PHARMA*" (a separate entity
  // with effectively no recorded value). A naive /zeta/i test would fold
  // all three into "our" share and overstate it. If the IMS panel ever
  // renames us, add the new spelling here -- the page will show no
  // highlight rather than silently highlighting the wrong company.
  var ZETA_NAMES = ["ZETA PHARM*"];
  var _zetaIdx = null;

  function zetaCorpIdx() {
    if (_zetaIdx !== null) return _zetaIdx;
    _zetaIdx = -1;
    if (CACHE && CACHE.lookups && CACHE.lookups.corps) {
      for (var i = 0; i < ZETA_NAMES.length && _zetaIdx < 0; i++) {
        _zetaIdx = CACHE.lookups.corps.indexOf(ZETA_NAMES[i]);
      }
    }
    return _zetaIdx;
  }
  function isZetaCorp(idx) { return idx === zetaCorpIdx() && idx >= 0; }

  // Light blue (2026-08-06, Ahmed's choice). Deliberately BRIGHTER and
  // lighter than the platform's navy primary (#0F4C81) so the two never
  // read as the same accent — Zeta must stand apart from ordinary chart
  // series, not blend into the house colour.
  var ZETA_COLOR = "#0EA5E9";

  // Corporate palette -- pulled from the design system so this workspace
  // reads as part of the platform, not a bolt-on.
  // General series palette. #3D7EA6 was replaced with #8C6D46: it sat close
  // enough to Zeta's light blue (#0EA5E9) that a competitor series could be
  // mistaken for us in a crowded chart. The Zeta accent must be unique.
  var PALETTE = ["#0F4C81", "#2E8B94", "#E8A33D", "#B4495A", "#6C6FA8",
                 "#4A9D5F", "#C4713A", "#7A8FA6", "#9B5DA8", "#8C6D46"];

  // ---------------------------------------------------------------------
  // Sparkline -- inline SVG, no library. Used on every KPI card.
  // ---------------------------------------------------------------------
  function sparkline(values, color) {
    if (!values || values.length < 2) return "";
    var w = 96, h = 26, pad = 2;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = (max - min) || 1;
    var step = (w - pad * 2) / (values.length - 1);
    var pts = values.map(function (v, i) {
      var x = pad + i * step;
      var y = h - pad - ((v - min) / span) * (h - pad * 2);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    var last = values[values.length - 1], first = values[0];
    var c = color || (last >= first ? "#15803d" : "#b91c1c");
    var lastPt = pts[pts.length - 1].split(",");
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h +
      '" style="display:block;overflow:visible;">' +
      '<polyline fill="none" stroke="' + c + '" stroke-width="1.6" ' +
      'stroke-linejoin="round" stroke-linecap="round" points="' + pts.join(" ") + '"/>' +
      '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="2.2" fill="' + c + '"/>' +
      '</svg>';
  }

  // ---------------------------------------------------------------------
  // KPI cards
  // ---------------------------------------------------------------------
  /**
   * Value/units trend across every year in scope -- the sparkline series
   * and the source of each card's previous-period comparison.
   */
  function yearSeries() {
    var ys = activeYears();
    var byYear = new Map();
    ys.forEach(function (o) { byYear.set(o.i, { value: 0, units: 0 }); });
    scanAnnual(function (o, u, v) {
      var e = byYear.get(A.rows[o + F_YEAR]);
      if (e) { e.value += v; e.units += u; }
    });
    return ys.map(function (o) {
      var e = byYear.get(o.i) || { value: 0, units: 0 };
      return { year: o.y, idx: o.i, value: e.value, units: e.units };
    });
  }

  function buildKpis() {
    var series = yearSeries();
    var cur = series.length ? series[series.length - 1] : null;
    var prev = series.length > 1 ? series[series.length - 2] : null;
    var curSet = cur ? new Set([cur.idx]) : null;
    var prevSet = prev ? new Set([prev.idx]) : null;

    var valSpark = series.map(function (s) { return s.value; });
    var unitSpark = series.map(function (s) { return s.units; });

    // Dimension counts are computed against the CURRENT year only --
    // "how many corporations compete here" means now, not the union of
    // everyone who ever appeared across five years.
    function countIn(field, yearSet) {
      var s = new Set();
      scanAnnual(function (o) {
        if (yearSet && !yearSet.has(A.rows[o + F_YEAR])) return;
        s.add(A.rows[o + field]);
      });
      return s.size;
    }

    function countCard(id, name, field, hint) {
      var c = countIn(field, curSet);
      var p = prevSet ? countIn(field, prevSet) : null;
      return {
        id: id, name: name, value: c.toLocaleString(),
        prev: p === null ? null : p.toLocaleString(),
        growthPct: p ? growth(c, p) : null,
        spark: null, hint: hint,
      };
    }

    // Leader cards: biggest / fastest-growing entity in each dimension.
    //
    // GROWTH IS MEASURED AS CAGR (2026-08-06, Ahmed's instruction), across
    // every FULL year in scope -- not a single year-on-year step. Two
    // reasons this is the better statistic here:
    //   - A one-year jump is easily a restock, a tender, or a launch
    //     phasing artefact. CAGR over 2022→2025 describes a trajectory.
    //   - It is comparable across entities with different starting years
    //     in scope, because it is normalised per annum.
    // Partial years are excluded from the CAGR window entirely: a 4-month
    // endpoint would understate every compound rate by roughly two thirds.
    function cagrLeader(id, name, field, lookupKey) {
      var fullYears = activeYears().filter(function (o) { return !isPartialYear(o.y); });
      if (fullYears.length < 2) {
        return { id: id, name: name, value: "—", prev: null, growthPct: null,
                 small: true, hint: "Needs at least two full years in scope" };
      }
      var firstY = fullYears[0], lastY = fullYears[fullYears.length - 1];
      var span = lastY.y - firstY.y;
      var startAgg = new Map(), endAgg = new Map();
      scanAnnual(function (o, u, v) {
        var y = A.rows[o + F_YEAR], k = A.rows[o + field];
        if (y === firstY.i) startAgg.set(k, (startAgg.get(k) || 0) + v);
        else if (y === lastY.i) endAgg.set(k, (endAgg.get(k) || 0) + v);
      });
      // Materiality on BOTH endpoints. Without a floor on the START value
      // an entity going from near-zero posts an astronomic CAGR that is
      // arithmetically true and commercially meaningless (an earlier build
      // headlined WEGOVY at +442,361%). New launches belong in the
      // absolute-contribution views, not a compound-rate ranking.
      var endTotal = 0;
      endAgg.forEach(function (v) { endTotal += v; });
      var floor = endTotal * 0.001;
      var startFloor = floor * 0.25;
      var best = null;
      endAgg.forEach(function (v, k) {
        var p = startAgg.get(k) || 0;
        if (p < startFloor || v < floor) return;
        var c = (Math.pow(v / p, 1 / span) - 1) * 100;
        if (!best || c > best.metric) best = { k: k, metric: c, value: v, start: p };
      });
      if (!best) {
        return { id: id, name: name, value: "—", prev: null, growthPct: null,
                 small: true, hint: "No entity clears the materiality floor" };
      }
      return {
        id: id, name: name, value: CACHE.lookups[lookupKey][best.k], small: true,
        prev: fmtLC(best.start) + " in " + firstY.y,
        growthPct: best.metric,
        growthLabel: "CAGR",
        hint: fmtLC(best.value) + " in " + lastY.y + " · " + span + "-year CAGR",
      };
    }

    function leaderCard(id, name, field, lookupKey) {
      var curAgg = new Map();
      scanAnnual(function (o, u, v) {
        var y = A.rows[o + F_YEAR];
        if (curSet && !curSet.has(y)) return;
        var k = A.rows[o + field];
        curAgg.set(k, (curAgg.get(k) || 0) + v);
      });
      var best = null;
      curAgg.forEach(function (v, k) {
        if (!best || v > best.value) best = { k: k, value: v };
      });
      if (!best) return { id: id, name: name, value: "—", prev: null, growthPct: null, small: true, hint: "No data in scope" };
      var share = cur && cur.value > 0 ? (best.value / cur.value) * 100 : null;
      return {
        id: id, name: name, value: CACHE.lookups[lookupKey][best.k], small: true,
        prev: null, growthPct: null,
        hint: fmtLC(best.value) + " LC · " + fmtPct(share) + " of market",
      };
    }

    var avgPriceCur = weightedAvgPrice(curSet);
    var avgPricePrev = prevSet ? weightedAvgPrice(prevSet) : null;

    var cards = [
      {
        id: "mktValue", name: "Total Market Value",
        value: fmtLC(cur ? cur.value : 0), unit: "LC",
        prev: prev ? fmtLC(prev.value) : null,
        growthPct: prev ? growth(cur.value, prev.value) : null,
        spark: valSpark, primary: true,
      },
      {
        id: "mktUnits", name: "Total Market Units",
        value: fmtUnits(cur ? cur.units : 0), unit: "units",
        prev: prev ? fmtUnits(prev.units) : null,
        growthPct: prev ? growth(cur.units, prev.units) : null,
        spark: unitSpark, primary: true,
      },
      {
        id: "avgPrice", name: "Average Price / Unit",
        value: avgPriceCur === null ? "—" : fmtPrice(avgPriceCur), unit: "LC",
        prev: avgPricePrev === null ? null : fmtPrice(avgPricePrev),
        growthPct: avgPricePrev ? growth(avgPriceCur, avgPricePrev) : null,
        spark: series.map(function (s) {
          return s.units > 0 ? s.value / s.units : 0;
        }),
        hint: "Market value ÷ units — a mix-and-price blend, not a list price",
      },
      countCard("nCorps", "Corporations", F_CORP, "Competing in scope this year"),
      countCard("nBrands", "Brands", F_BRAND, null),
      countCard("nMolecules", "Molecules", F_MOL, null),
      countCard("nTAs", "Therapeutic Areas", F_TA, null),
      countCard("nAtc", "ATC4 Classes", F_ATC, null),
      cagrLeader("topGrowCorp", "Fastest-Growing Corporation", F_CORP, "corps"),
      cagrLeader("topGrowBrand", "Fastest-Growing Brand", F_BRAND, "brands"),
      leaderCard("bigTA", "Largest Therapeutic Area", F_TA, "tas"),
      leaderCard("bigMol", "Largest Molecule", F_MOL, "molecules"),
      leaderCard("bigProd", "Largest Product", F_PROD, "products"),
    ];
    return { cards: cards, cur: cur, prev: prev, series: series };
  }

  /** Value ÷ units. The honest "average price" for a segment: a simple
   *  mean of pack list prices would weight a rarely-sold specialty pack
   *  the same as a mass-market one. */
  function weightedAvgPrice(yearSet) {
    var v = 0, u = 0;
    scanAnnual(function (o, uu, vv) {
      if (yearSet && !yearSet.has(A.rows[o + F_YEAR])) return;
      v += vv; u += uu;
    });
    return u > 0 ? v / u : null;
  }

  function renderKpiCard(k) {
    var arrow = "", cls = "mi-flat";
    if (k.growthPct !== null && k.growthPct !== undefined && !isNaN(k.growthPct)) {
      if (k.growthPct > 0.05) { arrow = "▲"; cls = "mi-up"; }
      else if (k.growthPct < -0.05) { arrow = "▼"; cls = "mi-down"; }
      else { arrow = "▬"; cls = "mi-flat"; }
    }
    return '' +
      '<div class="mi-kpi' + (k.primary ? " mi-kpi-primary" : "") + '">' +
        '<div class="mi-kpi-name">' + esc(k.name) + '</div>' +
        '<div class="mi-kpi-value' + (k.small ? " mi-kpi-value-sm" : "") + '" title="' + esc(k.value) + '">' +
          esc(k.value) + (k.unit ? '<span class="mi-kpi-unit">' + esc(k.unit) + '</span>' : "") +
        '</div>' +
        '<div class="mi-kpi-foot">' +
          '<div class="mi-kpi-delta ' + cls + '">' +
            (arrow ? '<span class="mi-arrow">' + arrow + "</span>" : "") +
            (k.growthPct === null || k.growthPct === undefined || isNaN(k.growthPct)
              ? '<span class="mi-muted">no prior period</span>'
              : "<span>" + fmtSignedPct(k.growthPct) +
                (k.growthLabel ? ' <span class="mi-muted">' + esc(k.growthLabel) + "</span>" : "") +
                "</span>") +
            (k.prev ? '<span class="mi-muted"> vs ' + esc(k.prev) + "</span>" : "") +
          "</div>" +
          (k.spark ? '<div class="mi-spark">' + sparkline(k.spark) + "</div>" : "") +
        "</div>" +
        (k.hint ? '<div class="mi-kpi-hint">' + esc(k.hint) + "</div>" : "") +
      "</div>";
  }

  // ---------------------------------------------------------------------
  // Ranked table -- the workhorse behind every "Top N" section
  // ---------------------------------------------------------------------
  /**
   * Build ranked rows for a dimension with current/prior value, growth,
   * share and secondary counts. `countFields` adds distinct-count columns
   * (e.g. molecules and products inside each Therapeutic Area).
   */
  function rankedRows(field, lookupKey, opts) {
    opts = opts || {};
    var cmp = comparisonYears();
    var curSet = cmp.cur ? new Set([cmp.cur.i]) : null;
    var prevSet = cmp.prev ? new Set([cmp.prev.i]) : null;
    var acc = new Map();
    var counts = opts.countFields || [];

    scanAnnual(function (o, u, v) {
      var y = A.rows[o + F_YEAR];
      var k = A.rows[o + field];
      var e = acc.get(k);
      if (!e) {
        e = { idx: k, cur: 0, prev: 0, units: 0, prevUnits: 0, sets: {} };
        counts.forEach(function (c) { e.sets[c.key] = new Set(); });
        acc.set(k, e);
      }
      if (curSet && curSet.has(y)) {
        e.cur += v; e.units += u;
        counts.forEach(function (c) { e.sets[c.key].add(A.rows[o + c.field]); });
      } else if (prevSet && prevSet.has(y)) {
        e.prev += v; e.prevUnits += u;
      }
    });

    var total = 0;
    acc.forEach(function (e) { total += e.cur; });
    var names = CACHE.lookups[lookupKey];
    var rows = [];
    acc.forEach(function (e) {
      if (e.cur <= 0 && e.prev <= 0) return;
      var row = {
        idx: e.idx, name: names[e.idx],
        value: e.cur, prevValue: e.prev, units: e.units,
        growthPct: growth(e.cur, e.prev),
        sharePct: total > 0 ? (e.cur / total) * 100 : null,
        avgPrice: e.units > 0 ? e.cur / e.units : null,
        contribPts: total > 0 && e.prev > 0 ? ((e.cur - e.prev) / total) * 100 : null,
      };
      counts.forEach(function (c) { row[c.key] = e.sets[c.key].size; });
      rows.push(row);
    });
    rows.sort(function (a, b) {
      var key = opts.sortBy || "value";
      var av = a[key], bv = b[key];
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
    return { rows: rows, total: total, cur: cmp.cur, prev: cmp.prev };
  }

  function topSlice(rows) {
    return Fx.topN === 0 ? rows : rows.slice(0, Fx.topN);
  }

  function rankedTableHtml(res, opts) {
    opts = opts || {};
    var rows = topSlice(res.rows);
    if (!rows.length) return '<div class="mi-empty">No data matches the current filters.</div>';

    // ZETA IS ALWAYS SHOWN. Zeta ranks #25 of 1,135 in the total market,
    // so with a Top-10 view it would appear in none of these tables --
    // the one row an executive most wants to find would be the only one
    // missing. When Zeta falls outside the visible slice it is appended
    // with its TRUE rank, visually separated so it is never mistaken for
    // 11th place. "You are not in the top 10, and here is where you are"
    // is far more useful than silence.
    var zetaAppended = null;
    if (opts.isCorp) {
      var zi = zetaCorpIdx();
      if (zi >= 0) {
        var inSlice = rows.some(function (r) { return r.idx === zi; });
        if (!inSlice) {
          for (var i = 0; i < res.rows.length; i++) {
            if (res.rows[i].idx === zi) {
              zetaAppended = { row: res.rows[i], rank: i + 1 };
              break;
            }
          }
        }
      }
    }
    var extra = opts.countFields || [];
    var maxV = rows[0] ? rows[0].value : 0;
    var h = '<table class="mi-table"><thead><tr>' +
      '<th class="mi-th-rank">#</th>' +
      "<th>" + esc(opts.label || "Name") + "</th>" +
      '<th class="mi-num">LC Value</th>' +
      '<th class="mi-num">Units</th>' +
      '<th class="mi-num">Share</th>' +
      '<th class="mi-num">Growth</th>';
    extra.forEach(function (c) { h += '<th class="mi-num">' + esc(c.label) + "</th>"; });
    if (opts.drill) h += '<th class="mi-th-drill"></th>';
    h += "</tr></thead><tbody>";
    rows.forEach(function (r, i) {
      var gcls = r.growthPct === null ? "mi-flat" : r.growthPct >= 0 ? "mi-up" : "mi-down";
      var bar = maxV > 0 ? (r.value / maxV) * 100 : 0;
      // Zeta's own row is marked wherever a corporation is being listed.
      var zeta = opts.isCorp && isZetaCorp(r.idx);
      var cls = (opts.drill ? "mi-row-drill" : "") + (zeta ? " mi-row-zeta" : "");
      h += "<tr" + (cls.trim() ? ' class="' + cls.trim() + '"' : "") +
           (opts.drill ? ' data-drill="' + esc(opts.drill) + '" data-idx="' + r.idx + '"' : "") + ">" +
        '<td class="mi-th-rank">' + (i + 1) + "</td>" +
        '<td class="mi-cell-name"><span class="mi-bar' + (zeta ? " mi-bar-zeta" : "") +
          '" style="width:' + bar.toFixed(1) + '%"></span>' +
          '<span class="mi-name-txt" title="' + esc(r.name) + '">' + esc(r.name) +
          (zeta ? '<span class="mi-zeta-tag">US</span>' : "") + "</span></td>" +
        '<td class="mi-num mi-strong">' + fmtLC(r.value) + "</td>" +
        '<td class="mi-num">' + fmtUnits(r.units) + "</td>" +
        '<td class="mi-num">' + fmtPct(r.sharePct) + "</td>" +
        '<td class="mi-num ' + gcls + '">' + fmtSignedPct(r.growthPct) + "</td>";
      extra.forEach(function (c) { h += '<td class="mi-num">' + (r[c.key] || 0).toLocaleString() + "</td>"; });
      if (opts.drill) h += '<td class="mi-th-drill">›</td>';
      h += "</tr>";
    });
    if (zetaAppended) {
      var zr = zetaAppended.row;
      var zg = zr.growthPct === null ? "mi-flat" : zr.growthPct >= 0 ? "mi-up" : "mi-down";
      var zbar = maxV > 0 ? (zr.value / maxV) * 100 : 0;
      h += '<tr class="mi-row-zeta mi-row-zeta-appended' + (opts.drill ? " mi-row-drill" : "") + '"' +
        (opts.drill ? ' data-drill="' + esc(opts.drill) + '" data-idx="' + zr.idx + '"' : "") + ">" +
        '<td class="mi-th-rank">' + zetaAppended.rank + "</td>" +
        '<td class="mi-cell-name"><span class="mi-bar mi-bar-zeta" style="width:' +
          zbar.toFixed(1) + '%"></span><span class="mi-name-txt">' + esc(zr.name) +
          '<span class="mi-zeta-tag">US</span></span></td>' +
        '<td class="mi-num mi-strong">' + fmtLC(zr.value) + "</td>" +
        '<td class="mi-num">' + fmtUnits(zr.units) + "</td>" +
        '<td class="mi-num">' + fmtPct(zr.sharePct) + "</td>" +
        '<td class="mi-num ' + zg + '">' + fmtSignedPct(zr.growthPct) + "</td>";
      (opts.countFields || []).forEach(function (c) {
        h += '<td class="mi-num">' + (zr[c.key] || 0).toLocaleString() + "</td>";
      });
      if (opts.drill) h += '<td class="mi-th-drill">›</td>';
      h += "</tr>";
    }
    h += "</tbody></table>";
    return h;
  }

  // ---------------------------------------------------------------------
  // Charts
  // ---------------------------------------------------------------------
  function destroyCharts() {
    _charts.forEach(function (c) { try { c.destroy(); } catch (e) {} });
    _charts = [];
  }

  function mountChart(id, config) {
    var el = document.getElementById(id);
    if (!el || typeof Chart === "undefined") return;
    try { _charts.push(new Chart(el.getContext("2d"), config)); }
    catch (e) { console.error("[MarketIntel] chart " + id + " failed", e); }
  }

  var CHART_BASE = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: true, position: "bottom",
        labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } } },
      tooltip: {
        backgroundColor: "rgba(15,23,42,0.94)", padding: 10, cornerRadius: 6,
        titleFont: { size: 12 }, bodyFont: { size: 12 },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      y: { grid: { color: "rgba(148,163,184,0.18)" }, ticks: { font: { size: 10 } } },
    },
  };

  /**
   * Annual value/units series under the active filters — the trend basis
   * for this workspace (2026-08-06, Ahmed: "make trend not monthly").
   *
   * Partial years are marked so the charts can render them distinctly
   * rather than letting a 4-month bar sit unlabelled beside 12-month ones.
   */
  function trendSeries() {
    var s = yearSeries();
    return {
      labels: s.map(function (x) {
        return String(x.year) + (isPartialYear(x.year) ? " (Jan–Apr)" : "");
      }),
      years: s.map(function (x) { return x.year; }),
      partial: s.map(function (x) { return isPartialYear(x.year); }),
      value: s.map(function (x) { return x.value; }),
      units: s.map(function (x) { return x.units; }),
    };
  }

  // ---------------------------------------------------------------------
  // Insights engine
  // ---------------------------------------------------------------------
  /**
   * Generates executive insights from whatever is currently in scope.
   * Each answers: what happened, where, why, business impact, action.
   *
   * Deliberately conservative -- an insight only fires when it clears a
   * materiality threshold, because a dashboard that manufactures five
   * "insights" from noise trains executives to ignore all of them.
   */
  function buildInsights() {
    var out = [];
    var cmp = comparisonYears();
    if (!cmp.cur || !cmp.prev) {
      return [{
        tone: "neutral", title: "Single period in scope",
        body: "Select at least two calendar years to generate growth insights.",
      }];
    }
    var curY = cmp.cur.y, prevY = cmp.prev.y;
    var partial = curY === PARTIAL_YEAR;
    var totals = yearSeries();
    var cur = totals[totals.length - 1], prev = totals[totals.length - 2];
    var mktG = growth(cur.value, prev.value);

    // 0. Zeta first. An executive reading this page wants our own
    // position before the market commentary, not after it.
    var zi = zetaCorpIdx();
    if (zi >= 0) {
      var corpsAll = rankedRows(F_CORP, "corps");
      var mePos = -1;
      for (var ci = 0; ci < corpsAll.rows.length; ci++) {
        if (corpsAll.rows[ci].idx === zi) { mePos = ci; break; }
      }
      if (mePos >= 0) {
        var me = corpsAll.rows[mePos];
        var gap = (me.growthPct !== null && mktG !== null) ? me.growthPct - mktG : null;
        var beating = gap !== null && gap >= 0;
        out.push({
          tone: gap === null ? "neutral" : beating ? "positive" : "warning",
          title: "Zeta Pharma ranks #" + (mePos + 1) + " of " +
                 corpsAll.rows.length.toLocaleString() + " with " + fmtPct(me.sharePct, 2) + " share",
          what: "Zeta recorded " + fmtLC(me.value) + " LC in " + curY +
                (me.prevValue > 0 ? ", up from " + fmtLC(me.prevValue) + " in " + prevY : "") + ".",
          where: scopeLabel(),
          why: gap === null ? "No prior-year basis to compare against the market."
            : beating
              ? "Growing " + fmtSignedPct(me.growthPct) + " against a market at " +
                fmtSignedPct(mktG) + " — " + fmtSignedPct(gap) + " points ahead."
              : "Growing " + fmtSignedPct(me.growthPct) + " while the market grew " +
                fmtSignedPct(mktG) + " — " + Math.abs(gap).toFixed(1) + " points behind.",
          impact: gap === null ? "Share position is static in this scope."
            : beating
              ? "Share is being gained. Every point of market share here is worth roughly " +
                fmtLC(cur.value / 100) + " LC."
              : "Share is eroding despite value growth — the market is expanding faster than we are. " +
                "A point of share is worth roughly " + fmtLC(cur.value / 100) + " LC.",
          action: beating
            ? "Identify which therapeutic areas are driving the outperformance and whether the same play transfers elsewhere."
            : "Find where competitors are taking the growth we are not — the Growth Analysis bridge below names them.",
        });
      }
    }

    // 1. Headline market movement
    if (mktG !== null) {
      out.push({
        tone: mktG >= 0 ? "positive" : "negative",
        title: "Market " + (mktG >= 0 ? "grew" : "declined") + " " +
               fmtSignedPct(mktG) + " in " + curY,
        what: "Total market value moved from " + fmtLC(prev.value) + " to " +
              fmtLC(cur.value) + " LC.",
        where: scopeLabel(),
        why: priceVolumeAttribution(cur, prev),
        impact: "Every share position below is measured against this base. A " +
                fmtLC(Math.abs(cur.value - prev.value)) + " LC swing resets " +
                "what a point of share is worth.",
        action: mktG >= 0
          ? "Confirm our own growth is at least matching the market — anything less is share erosion in a rising market."
          : "Protect price and mix before chasing volume in a contracting market.",
        caveat: partial ? curY + " covers January–April only; it is NOT comparable to a full " + prevY + "." : null,
      });
    }

    // 2. Fastest-growing corporation of material size
    var corps = rankedRows(F_CORP, "corps");
    var matFloor = cur.value * 0.005;
    var movers = corps.rows.filter(function (r) {
      return r.prevValue > 0 && r.value >= matFloor && r.growthPct !== null;
    });
    var gainers = movers.slice().sort(function (a, b) { return b.growthPct - a.growthPct; });
    if (gainers.length) {
      var g = gainers[0];
      out.push({
        tone: "positive",
        title: g.name + " is the fastest-growing corporation at " + fmtSignedPct(g.growthPct),
        what: g.name + " grew from " + fmtLC(g.prevValue) + " to " + fmtLC(g.value) + " LC.",
        where: "Holds " + fmtPct(g.sharePct) + " of the market in scope.",
        why: topDriverFor(F_CORP, g.idx),
        impact: "Added " + fmtLC(g.value - g.prevValue) + " LC — " +
                fmtPct(g.contribPts) + " of total market value.",
        action: "Review where this competitor overlaps our portfolio and whether the gain is price, volume or new launches.",
      });
    }
    // 3. Steepest material decline
    var losers = movers.slice().sort(function (a, b) { return a.growthPct - b.growthPct; });
    if (losers.length && losers[0].growthPct < 0) {
      var l = losers[0];
      out.push({
        tone: "negative",
        title: l.name + " lost " + fmtSignedPct(l.growthPct) + " of its value",
        what: l.name + " fell from " + fmtLC(l.prevValue) + " to " + fmtLC(l.value) + " LC.",
        where: "Still holds " + fmtPct(l.sharePct) + " share.",
        why: topDriverFor(F_CORP, l.idx),
        impact: fmtLC(Math.abs(l.value - l.prevValue)) + " LC has left this competitor — " +
                "share that is now in play.",
        action: "Identify which of their molecules lost ground and whether we compete in them.",
      });
    }

    // 4. Concentration
    var tas = rankedRows(F_TA, "tas");
    if (tas.rows.length) {
      var t = tas.rows[0];
      out.push({
        tone: "neutral",
        title: t.name + " is the largest therapeutic area at " + fmtPct(t.sharePct) + " of the market",
        what: fmtLC(t.value) + " LC across " + (t.molecules || 0) + " molecules.",
        where: scopeLabel(),
        why: t.growthPct === null ? "No prior-year comparison in scope."
          : "It is " + (t.growthPct >= 0 ? "growing" : "declining") + " at " + fmtSignedPct(t.growthPct) + ".",
        impact: "Concentration here means portfolio decisions in this area move the whole business.",
        action: "Check our share of this area specifically — under-indexing in the largest TA is the most expensive gap to carry.",
      });
    }

    // 5. Dominance -- a corporation owning a TA
    var dom = findDominance();
    if (dom) {
      out.push({
        tone: "warning",
        title: dom.corp + " controls " + fmtPct(dom.share) + " of " + dom.ta,
        what: "Single-corporation share above 35% in a therapeutic area.",
        where: dom.ta + " — " + fmtLC(dom.value) + " LC of " + fmtLC(dom.taTotal) + " LC.",
        why: "Concentrated share usually reflects a molecule franchise or an unchallenged originator position.",
        impact: "Entry here needs a differentiated proposition; incremental effort against an entrenched leader rarely converts.",
        action: "Assess whether the leader's position rests on one molecule — franchise concentration is the vulnerability.",
      });
    }
    return out;
  }

  function scopeLabel() {
    var parts = [];
    if (Fx.ta && Fx.ta.size) parts.push(setNames(Fx.ta, "tas", 2) + " (TA)");
    if (Fx.corp && Fx.corp.size) parts.push(setNames(Fx.corp, "corps", 2));
    if (Fx.molecule && Fx.molecule.size) parts.push(setNames(Fx.molecule, "molecules", 2));
    if (Fx.sector && Fx.sector.size) parts.push(setNames(Fx.sector, "sectors", 2));
    return parts.length ? parts.join(" · ") : "Total market, all segments";
  }
  function setNames(set, key, max) {
    var names = CACHE.lookups[key], out = [];
    set.forEach(function (i) { if (out.length < max) out.push(names[i]); });
    var extra = set.size - out.length;
    return out.join(", ") + (extra > 0 ? " +" + extra + " more" : "");
  }

  /** Price vs volume attribution for a market movement -- the first
   *  question any commercial director asks about a growth number. */
  function priceVolumeAttribution(cur, prev) {
    if (!prev || prev.units <= 0 || prev.value <= 0) return "No prior-period basis for attribution.";
    var unitG = growth(cur.units, prev.units);
    var valG = growth(cur.value, prev.value);
    if (unitG === null || valG === null) return "";
    var priceEffect = valG - unitG;
    if (Math.abs(unitG) < 1 && Math.abs(priceEffect) > 3) {
      return "Almost entirely price/mix: units moved " + fmtSignedPct(unitG) +
             " while value moved " + fmtSignedPct(valG) + ".";
    }
    if (Math.abs(priceEffect) < 3) {
      return "Volume-led: units " + fmtSignedPct(unitG) + " against value " + fmtSignedPct(valG) + ".";
    }
    return "Units " + fmtSignedPct(unitG) + " and price/mix roughly " +
           fmtSignedPct(priceEffect) + " — both contributing.";
  }

  /** Largest molecule inside a filtered entity, used as the "why". */
  function topDriverFor(field, idx) {
    var cmp = comparisonYears();
    if (!cmp.cur) return "";
    var acc = new Map(), prevAcc = new Map();
    scanAnnual(function (o, u, v) {
      if (A.rows[o + field] !== idx) return;
      var y = A.rows[o + F_YEAR], m = A.rows[o + F_MOL];
      if (y === cmp.cur.i) acc.set(m, (acc.get(m) || 0) + v);
      else if (cmp.prev && y === cmp.prev.i) prevAcc.set(m, (prevAcc.get(m) || 0) + v);
    });
    var best = null;
    acc.forEach(function (v, k) {
      var p = prevAcc.get(k) || 0;
      var d = v - p;
      if (!best || Math.abs(d) > Math.abs(best.delta)) best = { k: k, delta: d, v: v };
    });
    if (!best) return "";
    var nm = CACHE.lookups.molecules[best.k];
    return "Largest single driver: " + nm + " (" +
      (best.delta >= 0 ? "+" : "") + fmtLC(best.delta) + " LC).";
  }

  /** Any corporation holding >35% of a therapeutic area. */
  function findDominance() {
    var cmp = comparisonYears();
    if (!cmp.cur) return null;
    var byTA = new Map();
    scanAnnual(function (o, u, v) {
      if (A.rows[o + F_YEAR] !== cmp.cur.i) return;
      var ta = A.rows[o + F_TA], c = A.rows[o + F_CORP];
      var e = byTA.get(ta);
      if (!e) { e = { total: 0, corps: new Map() }; byTA.set(ta, e); }
      e.total += v;
      e.corps.set(c, (e.corps.get(c) || 0) + v);
    });
    var best = null;
    byTA.forEach(function (e, ta) {
      if (e.total <= 0) return;
      e.corps.forEach(function (v, c) {
        var share = (v / e.total) * 100;
        if (share >= 35 && (!best || share > best.share)) {
          best = { ta: CACHE.lookups.tas[ta], corp: CACHE.lookups.corps[c],
                   share: share, value: v, taTotal: e.total };
        }
      });
    });
    return best;
  }

  function insightHtml(ins) {
    if (ins.body) {
      return '<div class="mi-insight mi-ins-neutral"><div class="mi-ins-title">' +
        esc(ins.title) + '</div><div class="mi-ins-body">' + esc(ins.body) + "</div></div>";
    }
    var rows = [
      ["What happened", ins.what],
      ["Where", ins.where],
      ["Why", ins.why],
      ["Business impact", ins.impact],
      ["Suggested action", ins.action],
    ].filter(function (r) { return r[1]; });
    return '<div class="mi-insight mi-ins-' + esc(ins.tone) + '">' +
      '<div class="mi-ins-title">' + esc(ins.title) + "</div>" +
      (ins.caveat ? '<div class="mi-ins-caveat">⚠ ' + esc(ins.caveat) + "</div>" : "") +
      '<dl class="mi-ins-dl">' +
      rows.map(function (r) {
        return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>";
      }).join("") +
      "</dl></div>";
  }

  // ---------------------------------------------------------------------
  // Filter bar
  // ---------------------------------------------------------------------
  /**
   * Option list for one filter, counted under every OTHER active filter
   * (faceted search). Options that would return nothing are dropped, so
   * the bar can never be driven into an empty state by a legal click.
   */
  function optionsFor(spec) {
    var acc = new Map();
    if (spec.key === "launchYear") {
      scanAnnual(function (o, u, v) {
        var b = launchBucketOf(A.rows[o + F_LAUNCH]);
        acc.set(b, (acc.get(b) || 0) + v);
      }, "launchYear");
    } else {
      scanAnnual(function (o, u, v) {
        var k = A.rows[o + spec.field];
        acc.set(k, (acc.get(k) || 0) + v);
      }, spec.key);
    }
    var names = spec.key === "launchYear"
      ? LAUNCH_BUCKETS.map(function (b) { return b.label; })
      : CACHE.lookups[spec.lookup];
    var out = [];
    acc.forEach(function (v, k) {
      if (names[k] === undefined) return;
      out.push({ idx: k, label: String(names[k]), value: v });
    });
    // Value-ordered for the big dimensions (1,458 corporations sorted
    // alphabetically is unusable -- the ones that matter must be on top);
    // natural order for the small, inherently-ordered ones.
    if (spec.sort === "label") {
      out.sort(function (a, b) { return a.label < b.label ? -1 : 1; });
    } else if (spec.sort === "index") {
      out.sort(function (a, b) { return a.idx - b.idx; });
    } else {
      out.sort(function (a, b) { return b.value - a.value; });
    }
    return out;
  }

  var FILTER_SPECS = [
    { key: "year", label: "Calendar Year", lookup: "years", field: F_YEAR, sort: "label" },
    { key: "ta", label: "Therapeutic Area", lookup: "tas", field: F_TA },
    { key: "atc4", label: "ATC4", lookup: "atc4s", field: F_ATC },
    { key: "molecule", label: "Molecule", lookup: "molecules", field: F_MOL },
    { key: "corp", label: "Corporation", lookup: "corps", field: F_CORP },
    { key: "product", label: "Product", lookup: "products", field: F_PROD },
    { key: "launchYear", label: "Launch Year", lookup: null, field: F_LAUNCH, sort: "index" },
    { key: "priceBand", label: "Price Range", lookup: "priceBands", field: F_PRICE, sort: "index" },
  ];

  function renderFilterBar() {
    var h = '<div class="mi-filterbar">';
    FILTER_SPECS.forEach(function (spec) {
      var opts = optionsFor(spec);
      var sel = Fx[spec.key];
      var n = sel ? sel.size : 0;
      var summary = n === 0 ? "All"
        : n === 1 ? (function () {
            var only = null; sel.forEach(function (i) { only = i; });
            var names = spec.key === "launchYear"
              ? LAUNCH_BUCKETS.map(function (b) { return b.label; })
              : CACHE.lookups[spec.lookup];
            return String(names[only]);
          })()
        : n + " selected";
      h += '<div class="mi-f" data-f="' + spec.key + '">' +
        '<label class="mi-f-label">' + esc(spec.label) +
          (n ? '<span class="mi-f-count">' + n + "</span>" : "") + "</label>" +
        '<button type="button" class="mi-f-btn" data-open="' + spec.key + '" title="' + esc(summary) + '">' +
          '<span class="mi-f-sum">' + esc(summary) + "</span><span class=\"mi-f-caret\">▾</span>" +
        "</button>" +
        '<div class="mi-f-menu" data-menu="' + spec.key + '" hidden>' +
          '<input type="text" class="mi-f-search" placeholder="Search ' + esc(spec.label) + '…" />' +
          '<div class="mi-f-actions">' +
            '<button type="button" data-all="' + spec.key + '">Select all</button>' +
            '<button type="button" data-none="' + spec.key + '">Clear</button>' +
          "</div>" +
          '<div class="mi-f-list">' +
            opts.map(function (o) {
              var on = sel && sel.has(o.idx);
              return '<label class="mi-f-opt' + (on ? " on" : "") + '">' +
                '<input type="checkbox" data-k="' + spec.key + '" value="' + o.idx + '"' +
                  (on ? " checked" : "") + " />" +
                '<span class="mi-f-opt-lbl">' + esc(o.label) + "</span>" +
                '<span class="mi-f-opt-val">' + fmtLC(o.value) + "</span></label>";
            }).join("") +
          "</div>" +
        "</div>" +
        "</div>";
    });
    // Top-N is a display control, not a data filter -- separated visually.
    h += '<div class="mi-f mi-f-topn"><label class="mi-f-label">Top N</label>' +
      '<select class="mi-topn" id="mi-topn">' +
      [5, 10, 20, 0].map(function (n) {
        return '<option value="' + n + '"' + (Fx.topN === n ? " selected" : "") + ">" +
          (n === 0 ? "All" : "Top " + n) + "</option>";
      }).join("") + "</select></div>";
    h += '<button type="button" class="mi-reset" id="mi-reset">Reset filters' +
      (activeFilterCount() ? " (" + activeFilterCount() + ")" : "") + "</button>";
    h += "</div>";
    return h;
  }

  function wireFilterBar(root) {
    root.querySelectorAll("[data-open]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var k = btn.getAttribute("data-open");
        var menu = root.querySelector('[data-menu="' + k + '"]');
        var wasOpen = menu && !menu.hidden;
        root.querySelectorAll(".mi-f-menu").forEach(function (m) { m.hidden = true; });
        if (menu && !wasOpen) {
          menu.hidden = false;
          var s = menu.querySelector(".mi-f-search");
          if (s) s.focus();
        }
      });
    });
    root.querySelectorAll(".mi-f-menu").forEach(function (m) {
      m.addEventListener("click", function (e) { e.stopPropagation(); });
    });
    document.addEventListener("click", closeAllMenus);

    root.querySelectorAll(".mi-f-search").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var q = inp.value.trim().toLowerCase();
        inp.closest(".mi-f-menu").querySelectorAll(".mi-f-opt").forEach(function (o) {
          var t = o.querySelector(".mi-f-opt-lbl").textContent.toLowerCase();
          o.style.display = !q || t.indexOf(q) >= 0 ? "" : "none";
        });
      });
    });

    root.querySelectorAll('.mi-f-opt input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener("change", function () {
        var k = cb.getAttribute("data-k");
        var idx = parseInt(cb.value, 10);
        if (!Fx[k]) Fx[k] = new Set();
        if (cb.checked) Fx[k].add(idx); else Fx[k].delete(idx);
        if (Fx[k].size === 0) Fx[k] = null;
        rerender();
      });
    });
    root.querySelectorAll("[data-all]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-all");
        var menu = root.querySelector('[data-menu="' + k + '"]');
        var set = new Set();
        menu.querySelectorAll('.mi-f-opt').forEach(function (o) {
          if (o.style.display === "none") return;
          set.add(parseInt(o.querySelector("input").value, 10));
        });
        Fx[k] = set.size ? set : null;
        rerender();
      });
    });
    root.querySelectorAll("[data-none]").forEach(function (b) {
      b.addEventListener("click", function () {
        Fx[b.getAttribute("data-none")] = null;
        rerender();
      });
    });
    var topn = root.querySelector("#mi-topn");
    if (topn) topn.addEventListener("change", function () {
      Fx.topN = parseInt(topn.value, 10); rerender();
    });
    var reset = root.querySelector("#mi-reset");
    if (reset) reset.addEventListener("click", function () { resetFilters(); rerender(); });
  }

  function closeAllMenus() {
    if (!_container) return;
    _container.querySelectorAll(".mi-f-menu").forEach(function (m) { m.hidden = true; });
  }

  // ---------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------
  function section(id, title, subtitle, bodyHtml, tools) {
    return '<section class="mi-section" id="' + id + '">' +
      '<div class="mi-sec-head"><div>' +
        '<h2 class="mi-sec-title">' + esc(title) + "</h2>" +
        (subtitle ? '<p class="mi-sec-sub">' + esc(subtitle) + "</p>" : "") +
      "</div>" + (tools || "") + "</div>" +
      '<div class="mi-sec-body">' + bodyHtml + "</div></section>";
  }

  function chartBox(id, height) {
    return '<div class="mi-chart" style="height:' + (height || 280) + 'px">' +
      '<canvas id="' + id + '"></canvas></div>';
  }

  function partialBanner() {
    if (!scopeIncludesPartial()) return "";
    return '<div class="mi-banner mi-banner-warn">' +
      "<strong>" + PARTIAL_YEAR + " covers January–April only.</strong> " +
      "It is included in the scope you selected, so growth rates against a full " +
      "12-month year are not like-for-like. The figures are not annualised — " +
      "extrapolating a partial year would be a forecast, not an actual." +
      "</div>";
  }

  // ---- Zeta position panel --------------------------------------------
  /**
   * Zeta's own standing, pulled out of the 1,400-row market table and put
   * where an executive reads first. Answers the four questions actually
   * asked in a review: how big are we, where do we rank, are we growing
   * faster than the market, and where is our portfolio concentrated.
   */
  function renderZetaPanel() {
    var zi = zetaCorpIdx();
    if (zi < 0) return "";
    var res = rankedRows(F_CORP, "corps");
    var meIdx = -1;
    for (var i = 0; i < res.rows.length; i++) {
      if (res.rows[i].idx === zi) { meIdx = i; break; }
    }
    if (meIdx < 0) {
      return section("mi-zeta", "Zeta Pharma Position",
        "Our standing within the current scope.",
        '<div class="mi-empty">Zeta Pharma has no recorded value in this filter scope.</div>');
    }
    var me = res.rows[meIdx];
    var cmp = comparisonYears();

    // Market growth on the same basis, so "are we outpacing the market"
    // is answered rather than left for the reader to compute.
    var series = yearSeries();
    var mktCur = series.length ? series[series.length - 1].value : 0;
    var mktPrev = series.length > 1 ? series[series.length - 2].value : 0;
    var mktG = growth(mktCur, mktPrev);
    var outpace = (me.growthPct !== null && mktG !== null) ? me.growthPct - mktG : null;

    // CAGR over the full years in scope -- the trajectory, not one step.
    var fullYears = activeYears().filter(function (o) { return !isPartialYear(o.y); });
    var cagr = null, cagrSpan = 0;
    if (fullYears.length >= 2) {
      var f = fullYears[0], l = fullYears[fullYears.length - 1];
      cagrSpan = l.y - f.y;
      var sV = 0, eV = 0;
      scanAnnual(function (o, u, v) {
        if (A.rows[o + F_CORP] !== zi) return;
        var y = A.rows[o + F_YEAR];
        if (y === f.i) sV += v; else if (y === l.i) eV += v;
      });
      if (sV > 0 && cagrSpan > 0) cagr = (Math.pow(eV / sV, 1 / cagrSpan) - 1) * 100;
    }

    var stats =
      zetaStat("LC Value", fmtLC(me.value), (cmp.cur ? cmp.cur.y : "") + " · " + fmtUnits(me.units) + " units") +
      zetaStat("Market Share", fmtPct(me.sharePct, 2), "of " + fmtLC(res.total) + " LC in scope") +
      zetaStat("Rank", "#" + (meIdx + 1), "of " + res.rows.length.toLocaleString() + " corporations") +
      zetaStat("Growth", fmtSignedPct(me.growthPct),
               cmp.prev ? "vs " + cmp.prev.y : "no prior year",
               me.growthPct === null ? "" : me.growthPct >= 0 ? "mi-up" : "mi-down") +
      zetaStat("CAGR", cagr === null ? "—" : fmtSignedPct(cagr),
               cagrSpan ? cagrSpan + "-year compound" : "needs 2 full years",
               cagr === null ? "" : cagr >= 0 ? "mi-up" : "mi-down") +
      zetaStat("vs Market", outpace === null ? "—" : fmtSignedPct(outpace) + " pts",
               mktG === null ? "" : "market grew " + fmtSignedPct(mktG),
               outpace === null ? "" : outpace >= 0 ? "mi-up" : "mi-down");

    // Where our value sits, and where we hold the most share -- two
    // different questions, and the gap between them is the opportunity.
    var byTA = zetaBreakdown(zi, F_TA, "tas");
    var body = '<div class="mi-zeta-stats">' + stats + "</div>" +
      '<div class="mi-grid-2" style="margin-top:14px">' +
        '<div>' + zetaBreakdownHtml(byTA, "Where our value sits", "value") + "</div>" +
        '<div>' + zetaBreakdownHtml(byTA.slice().sort(function (a, b) {
          return (b.sharePct || 0) - (a.sharePct || 0);
        }), "Where we hold most share", "share") + "</div>" +
      "</div>" +
      (outpace !== null
        ? '<div class="mi-note">' + (outpace >= 0
            ? "Zeta is outgrowing the market by " + fmtSignedPct(outpace) +
              " points — share is being gained."
            : "Zeta is growing " + fmtSignedPct(Math.abs(outpace)).replace("+", "") +
              " points slower than the market — share is eroding even though value is " +
              (me.growthPct >= 0 ? "up" : "down") + ".") + "</div>"
        : "");

    return section("mi-zeta", "Zeta Pharma Position",
      "Our standing within the current scope — " + scopeLabel() + ".", body);
  }

  function zetaStat(label, value, sub, cls) {
    return '<div class="mi-zeta-stat"><div class="mi-zeta-l">' + esc(label) + "</div>" +
      '<div class="mi-zeta-v ' + (cls || "") + '">' + esc(value) + "</div>" +
      '<div class="mi-zeta-s">' + esc(sub || "") + "</div></div>";
  }

  /** Zeta's value per dimension, alongside its share of that dimension. */
  function zetaBreakdown(zi, field, lookup) {
    var cmp = comparisonYears();
    var mine = new Map(), all = new Map();
    scanAnnual(function (o, u, v) {
      if (cmp.cur && A.rows[o + F_YEAR] !== cmp.cur.i) return;
      var d = A.rows[o + field];
      all.set(d, (all.get(d) || 0) + v);
      if (A.rows[o + F_CORP] === zi) mine.set(d, (mine.get(d) || 0) + v);
    });
    var out = [];
    mine.forEach(function (v, d) {
      var tot = all.get(d) || 0;
      out.push({ name: CACHE.lookups[lookup][d], value: v,
                 sharePct: tot > 0 ? (v / tot) * 100 : null, segTotal: tot });
    });
    out.sort(function (a, b) { return b.value - a.value; });
    return out;
  }

  function zetaBreakdownHtml(rows, title, mode) {
    rows = rows.slice(0, 8);
    if (!rows.length) return "";
    var max = mode === "share"
      ? Math.max.apply(null, rows.map(function (r) { return r.sharePct || 0; })) || 1
      : rows[0].value || 1;
    var h = '<div class="mi-mini"><div class="mi-mini-title">' + esc(title) + "</div>";
    rows.forEach(function (r) {
      var w = mode === "share" ? ((r.sharePct || 0) / max) * 100 : (r.value / max) * 100;
      h += '<div class="mi-mini-row" title="' + esc(r.name) + '">' +
        '<span class="mi-mini-name">' + esc(r.name) + "</span>" +
        '<span class="mi-mini-bar"><span style="width:' + w.toFixed(1) +
          '%;background:' + ZETA_COLOR + '"></span></span>' +
        '<span class="mi-mini-val">' + fmtLC(r.value) + "</span>" +
        '<span class="mi-mini-pct">' + fmtPct(r.sharePct) + "</span></div>";
    });
    return h + "</div>";
  }

  // ---- market overview -------------------------------------------------
  function renderOverview() {
    var body = '<div class="mi-grid-2">' +
      chartBox("mi-c-yearval") + chartBox("mi-c-yearunits") +
      "</div>" +
      '<div class="mi-grid-2">' +
      chartBox("mi-c-dual") + chartBox("mi-c-cagr") +
      "</div>" + trendBasisNote();
    return section("mi-overview", "Market Overview",
      "Size, direction and the price-versus-volume split behind it.", body);
  }

  function trendBasisNote() {
    return '<div class="mi-note"><strong>Trend basis:</strong> Calendar Year. ' +
      "Values are actual reported annual totals — not annualised, smoothed or " +
      "interpolated. " + PARTIAL_YEAR + " is shown as reported (January–April) " +
      "and is hatched in the charts; it is excluded from every CAGR calculation, " +
      "because a four-month endpoint would understate a compound rate by roughly " +
      "two thirds.</div>";
  }

  function drawOverview() {
    var ms = trendSeries();
    var lbl = ms.labels;
    // Partial years get a muted fill so a 4-month bar is never mistaken
    // for a completed one at a glance.
    var barColors = ms.partial.map(function (p) {
      return p ? "rgba(15,76,129,0.35)" : PALETTE[0];
    });
    var unitColors = ms.partial.map(function (p) {
      return p ? "rgba(46,139,148,0.35)" : PALETTE[1];
    });
    mountChart("mi-c-yearval", {
      type: "bar",
      data: { labels: lbl, datasets: [{
        label: "Market Value (LC)", data: ms.value,
        backgroundColor: barColors, borderRadius: 4, maxBarThickness: 64,
      }] },
      options: Object.assign({}, CHART_BASE, {
        plugins: Object.assign({}, CHART_BASE.plugins, {
          legend: { display: false },
          title: { display: true, text: "Market Value by Year", font: { size: 12, weight: "600" } },
          tooltip: Object.assign({}, CHART_BASE.plugins.tooltip, {
            callbacks: { label: function (c) { return " " + fmtLC(c.parsed.y) + " LC"; } } },
          ),
        }),
        scales: Object.assign({}, CHART_BASE.scales, {
          y: { grid: CHART_BASE.scales.y.grid,
               ticks: { font: { size: 10 }, callback: function (v) { return fmtLC(v); } } },
        }),
      }),
    });
    mountChart("mi-c-yearunits", {
      type: "bar",
      data: { labels: lbl, datasets: [{
        label: "Market Units", data: ms.units,
        backgroundColor: unitColors, borderRadius: 4, maxBarThickness: 64,
      }] },
      options: Object.assign({}, CHART_BASE, {
        plugins: Object.assign({}, CHART_BASE.plugins, {
          legend: { display: false },
          title: { display: true, text: "Market Units by Year", font: { size: 12, weight: "600" } },
          tooltip: Object.assign({}, CHART_BASE.plugins.tooltip, {
            callbacks: { label: function (c) { return " " + fmtUnits(c.parsed.y) + " units"; } } }),
        }),
        scales: Object.assign({}, CHART_BASE.scales, {
          y: { grid: CHART_BASE.scales.y.grid,
               ticks: { font: { size: 10 }, callback: function (v) { return fmtUnits(v); } } },
        }),
      }),
    });
    // Dual axis: the single most diagnostic market chart -- when value and
    // units diverge, growth is price/mix rather than demand.
    mountChart("mi-c-dual", {
      type: "line",
      data: { labels: lbl, datasets: [
        { label: "Value (LC)", data: ms.value, borderColor: PALETTE[0],
          yAxisID: "y", tension: 0.25, pointRadius: 3, borderWidth: 2 },
        { label: "Units", data: ms.units, borderColor: PALETTE[3],
          yAxisID: "y1", tension: 0.25, pointRadius: 3, borderWidth: 2, borderDash: [4, 3] },
      ] },
      options: Object.assign({}, CHART_BASE, {
        plugins: Object.assign({}, CHART_BASE.plugins, {
          title: { display: true, text: "Value vs Units — divergence signals price/mix",
                   font: { size: 12, weight: "600" } },
        }),
        scales: {
          x: CHART_BASE.scales.x,
          y: { position: "left", grid: { color: "rgba(148,163,184,0.18)" },
               ticks: { font: { size: 10 }, callback: function (v) { return fmtLC(v); } } },
          y1: { position: "right", grid: { display: false },
                ticks: { font: { size: 10 }, callback: function (v) { return fmtUnits(v); } } },
        },
      }),
    });
    // CAGR across the full years in scope.
    var ys = yearSeries().filter(function (s) { return !isPartialYear(s.year); });
    var cagrLabels = [], cagrData = [];
    if (ys.length >= 2) {
      var base = ys[0];
      for (var i = 1; i < ys.length; i++) {
        var yrs = ys[i].year - base.year;
        var c = base.value > 0 && yrs > 0
          ? (Math.pow(ys[i].value / base.value, 1 / yrs) - 1) * 100 : 0;
        cagrLabels.push(base.year + "→" + ys[i].year);
        cagrData.push(c);
      }
    }
    mountChart("mi-c-cagr", {
      type: "bar",
      data: { labels: cagrLabels, datasets: [{
        label: "CAGR %", data: cagrData,
        backgroundColor: cagrData.map(function (v) { return v >= 0 ? PALETTE[5] : PALETTE[3]; }),
        borderRadius: 4, maxBarThickness: 46,
      }] },
      options: Object.assign({}, CHART_BASE, {
        plugins: Object.assign({}, CHART_BASE.plugins, {
          legend: { display: false },
          title: { display: true, text: "Compound annual growth (full years only)",
                   font: { size: 12, weight: "600" } },
          tooltip: Object.assign({}, CHART_BASE.plugins.tooltip, {
            callbacks: { label: function (c) { return " " + c.parsed.y.toFixed(1) + "% CAGR"; } } }),
        }),
        scales: Object.assign({}, CHART_BASE.scales, {
          y: { grid: CHART_BASE.scales.y.grid,
               ticks: { font: { size: 10 }, callback: function (v) { return v + "%"; } } },
        }),
      }),
    });
  }

  // ---- market share ----------------------------------------------------
  var SHARE_DIMS = [
    { key: "corp", label: "Corporation", field: F_CORP, lookup: "corps" },
    { key: "ta", label: "Therapeutic Area", field: F_TA, lookup: "tas" },
    { key: "atc4", label: "ATC4", field: F_ATC, lookup: "atc4s" },
    { key: "molecule", label: "Molecule", field: F_MOL, lookup: "molecules" },
    { key: "product", label: "Product", field: F_PROD, lookup: "products" },
  ];
  var _shareDim = "corp";

  function renderShare() {
    var tools = '<div class="mi-seg">' + SHARE_DIMS.map(function (d) {
      return '<button type="button" class="mi-seg-btn' + (_shareDim === d.key ? " on" : "") +
        '" data-share="' + d.key + '">' + esc(d.label) + "</button>";
    }).join("") + "</div>";
    var d = SHARE_DIMS.filter(function (x) { return x.key === _shareDim; })[0];
    var res = rankedRows(d.field, d.lookup);
    var body = '<div class="mi-grid-share">' +
      chartBox("mi-c-share", 320) +
      '<div class="mi-share-table">' + rankedTableHtml(res, { label: d.label, isCorp: d.key === "corp" }) + "</div>" +
      "</div>" + shareMethodNote(d.label, res);
    return section("mi-share", "Market Share",
      "Share of value within the current scope.", body, tools);
  }

  /**
   * Explicit share methodology (2026-08-06, Ahmed: "explain share you got
   * based on what"). A share number is only interpretable if the reader
   * knows its denominator, and the denominator here MOVES with the filter
   * bar -- that is the point of the workspace, but it must be stated or a
   * user will quote "10.4%" without knowing it was 10.4% of Cardiovascular
   * rather than 10.4% of the market.
   */
  function shareMethodNote(dimLabel, res) {
    var cmp = comparisonYears();
    var yr = cmp.cur ? cmp.cur.y : "—";
    var scope = scopeLabel();
    var isFiltered = activeFilterCount() > 1;   // year filter is always set
    return '<div class="mi-method">' +
      '<div class="mi-method-h">How this share is calculated</div>' +
      "<div><code>share % = this " + esc(dimLabel.toLowerCase()) +
        "'s LC Value ÷ LC Value of ALL " + esc(dimLabel.toLowerCase()) +
        "s in the current scope × 100</code></div>" +
      "<ul>" +
        "<li><strong>Measure:</strong> LC Value (local currency sales value at " +
          "retail level, as reported by IMS). Not units, not volume — a " +
          "high-price product carries more share than a high-volume one.</li>" +
        "<li><strong>Period:</strong> " + esc(String(yr)) + " only — the latest year in scope. " +
          "Share is a point-in-time position, so it is never summed across years.</li>" +
        "<li><strong>Denominator:</strong> " +
          (isFiltered
            ? "the <em>filtered</em> market — " + esc(scope) +
              " — totalling " + fmtLC(res.total) + " LC. Shares sum to 100% of " +
              "that filtered slice, NOT of the total Egyptian market."
            : "the total market in scope, " + fmtLC(res.total) + " LC. " +
              "Shares sum to 100%.") +
        "</li>" +
        "<li><strong>Universe:</strong> every corporation in the IMS panel, " +
          "not just Zeta and its named competitors — so these are true market " +
          "shares rather than share-of-a-selected-peer-set.</li>" +
      "</ul></div>";
  }

  function drawShare() {
    var d = SHARE_DIMS.filter(function (x) { return x.key === _shareDim; })[0];
    var res = rankedRows(d.field, d.lookup);
    var rows = topSlice(res.rows);
    var other = res.rows.slice(rows.length).reduce(function (a, r) { return a + r.value; }, 0);
    var labels = rows.map(function (r) { return r.name; });
    var data = rows.map(function (r) { return r.value; });
    var isCorpDim = d.key === "corp";
    var zetaFlags = rows.map(function (r) { return isCorpDim && isZetaCorp(r.idx); });
    if (other > 0) { labels.push("All others"); data.push(other); zetaFlags.push(false); }
    mountChart("mi-c-share", {
      type: "doughnut",
      data: { labels: labels, datasets: [{
        data: data,
        backgroundColor: labels.map(function (l, i) {
          if (zetaFlags[i]) return ZETA_COLOR;
          return l === "All others" ? "#CBD5E1" : PALETTE[i % PALETTE.length];
        }),
        // Zeta's slice gets a heavier ring so it reads instantly even when
        // its share is small enough to be a sliver.
        borderWidth: labels.map(function (l, i) { return zetaFlags[i] ? 3 : 1; }),
        borderColor: labels.map(function (l, i) { return zetaFlags[i] ? "#7f2d3c" : "#fff"; }),
        offset: labels.map(function (l, i) { return zetaFlags[i] ? 14 : 0; }),
      }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "58%",
        plugins: {
          legend: { position: "right",
            labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 10 } } },
          tooltip: { backgroundColor: "rgba(15,23,42,0.94)", padding: 10, cornerRadius: 6,
            callbacks: { label: function (c) {
              var tot = c.dataset.data.reduce(function (a, b) { return a + b; }, 0);
              return " " + fmtLC(c.parsed) + " LC · " + ((c.parsed / tot) * 100).toFixed(1) + "%";
            } } },
        },
      },
    });
  }

  // ---- top performers --------------------------------------------------
  var TOP_DIMS = [
    { key: "corp", label: "Corporations", field: F_CORP, lookup: "corps", drill: "corp" },
    { key: "brand", label: "Brands", field: F_BRAND, lookup: "brands" },
    { key: "molecule", label: "Molecules", field: F_MOL, lookup: "molecules", drill: "molecule" },
    { key: "ta", label: "Therapeutic Areas", field: F_TA, lookup: "tas", drill: "ta" },
    { key: "atc4", label: "ATC4", field: F_ATC, lookup: "atc4s", drill: "atc4" },
  ];
  var _topDim = "corp", _topSort = "value";

  function renderTop() {
    var tools = '<div class="mi-seg">' + TOP_DIMS.map(function (d) {
      return '<button type="button" class="mi-seg-btn' + (_topDim === d.key ? " on" : "") +
        '" data-top="' + d.key + '">' + esc(d.label) + "</button>";
    }).join("") + "</div>" +
    '<div class="mi-seg mi-seg-sort">' +
      [["value", "LC Value"], ["units", "Units"], ["growthPct", "Growth %"]].map(function (s) {
        return '<button type="button" class="mi-seg-btn' + (_topSort === s[0] ? " on" : "") +
          '" data-topsort="' + s[0] + '">' + esc(s[1]) + "</button>";
      }).join("") + "</div>";
    var d = TOP_DIMS.filter(function (x) { return x.key === _topDim; })[0];
    var res = rankedRows(d.field, d.lookup, { sortBy: _topSort });
    var body = rankedTableHtml(res, { label: d.label.replace(/s$/, ""), drill: d.drill, isCorp: d.key === "corp" }) +
      '<div class="mi-note"><strong>Share</strong> = entity LC Value ÷ total LC Value ' +
        "of all " + esc(d.label.toLowerCase()) + " in the current scope, for the latest " +
        "year selected. <strong>Growth</strong> = year-on-year change in LC Value versus " +
        "the previous year in scope." +
        (_topSort === "growthPct"
          ? " Sorted by growth — entities with no prior-year value rank last, because a " +
            "percentage from a zero base is undefined rather than infinite."
          : "") +
      "</div>";
    return section("mi-top", "Top Performers",
      "Ranked within the current scope. Click a row to drill through.", body, tools);
  }

  // ---- dimension analysis (TA / molecule / corporation / product) ------
  function renderDimensionSections() {
    var taRes = rankedRows(F_TA, "tas", { countFields: [
      { key: "molecules", field: F_MOL, label: "Molecules" },
      { key: "products", field: F_PROD, label: "Products" },
      { key: "corps", field: F_CORP, label: "Competitors" },
    ] });
    var molRes = rankedRows(F_MOL, "molecules", { countFields: [
      { key: "corps", field: F_CORP, label: "Competitors" },
      { key: "brands", field: F_BRAND, label: "Brands" },
    ] });
    var corpRes = rankedRows(F_CORP, "corps", { countFields: [
      { key: "products", field: F_PROD, label: "Products" },
      { key: "molecules", field: F_MOL, label: "Molecules" },
      // Spelled out rather than abbreviated to "TAs"/"Corps" -- an
      // executive should not have to decode a column header.
      { key: "tas", field: F_TA, label: "Therapeutic Areas" },
      { key: "atc4s", field: F_ATC, label: "ATC4 Classes" },
    ] });
    var prodRes = rankedRows(F_PROD, "products", { countFields: [] });

    return section("mi-ta", "Therapeutic Area Analysis",
        "Ranking, share, growth and portfolio breadth. Click through to ATC4 → Molecule → Product.",
        rankedTableHtml(taRes, { label: "Therapeutic Area", drill: "ta", countFields: [
          { key: "molecules", label: "Molecules" },
          { key: "products", label: "Products" },
          { key: "corps", label: "Competitors" }] }) + taGlossary()) +
      section("mi-mol", "Molecule Analysis",
        "Where the science concentrates — and how many players compete on each.",
        rankedTableHtml(molRes, { label: "Molecule", drill: "molecule", countFields: [
          { key: "corps", label: "Competitors" },
          { key: "brands", label: "Brands" }] }) + priceColumnNote()) +
      section("mi-corp", "Corporation Analysis",
        "How large each competitor is, how fast it is moving, and how widely its portfolio is spread.",
        rankedTableHtml(corpRes, { label: "Corporation", drill: "corp", isCorp: true, countFields: [
          { key: "products", label: "Products" },
          { key: "molecules", label: "Molecules" },
          { key: "tas", label: "Therapeutic Areas" },
          { key: "atc4s", label: "ATC4 Classes" }] }) + corpGlossary(corpRes)) +
      section("mi-prod", "Product Analysis",
        "Individual products by value, share, growth and average price.",
        productTableHtml(prodRes));
  }

  /**
   * Column glossary + a computed read of what the table is saying.
   *
   * The four count columns are the reason this section exists: value and
   * growth say how a competitor is doing, but only breadth explains HOW
   * they are doing it. Two companies at the same revenue with 1 vs 20
   * therapeutic areas are running opposite strategies and demand opposite
   * responses. The benchmark line makes that legible without the reader
   * computing averages by eye.
   */
  function corpGlossary(res) {
    var rows = res.rows.filter(function (r) { return r.value > 0; });
    if (!rows.length) return "";
    var top = rows.slice(0, 50);
    var avg = function (k) {
      return top.reduce(function (a, r) { return a + (r[k] || 0); }, 0) / top.length;
    };
    var avgTA = avg("tas"), avgProd = avg("products");
    var avgVPP = top.reduce(function (a, r) {
      return a + (r.products > 0 ? r.value / r.products : 0);
    }, 0) / top.length;

    // Zeta's own read against that benchmark.
    var zi = zetaCorpIdx(), me = null;
    for (var i = 0; i < rows.length; i++) { if (rows[i].idx === zi) { me = rows[i]; break; } }
    var zetaLine = "";
    if (me) {
      var myVPP = me.products > 0 ? me.value / me.products : 0;
      zetaLine = '<div class="mi-gloss-zeta"><strong>Zeta Pharma reads:</strong> ' +
        me.tas + " therapeutic areas vs a top-50 average of " + avgTA.toFixed(1) + ", " +
        me.products + " products vs " + Math.round(avgProd) + ", and " +
        fmtLC(myVPP) + " of value per product vs " + fmtLC(avgVPP) + ". " +
        (myVPP < avgVPP * 0.75
          ? "Our portfolio is <em>broader than it is deep</em> — more products carrying less value each. " +
            "The lever is concentration: fewer, bigger products rather than more of them."
          : myVPP > avgVPP * 1.25
            ? "Our products carry <em>above-average value each</em> — a concentrated portfolio. " +
              "The lever is breadth: adding areas without diluting focus."
            : "Our portfolio depth sits close to the peer benchmark.") +
        "</div>";
    }

    return '<div class="mi-method">' +
      '<div class="mi-method-h">What the columns mean</div>' +
      "<ul>" +
        "<li><strong>LC Value</strong> — total sales value in local currency, at retail level. " +
          "This is the size of the competitor in the scope you have filtered to.</li>" +
        "<li><strong>Units</strong> — packs sold. Compare against LC Value to see whether a " +
          "competitor plays at high price or high volume.</li>" +
        "<li><strong>Share</strong> — their LC Value ÷ the LC Value of every corporation in " +
          "the current scope.</li>" +
        "<li><strong>Growth</strong> — year-on-year change in LC Value versus the previous " +
          "year in scope.</li>" +
        "<li><strong>Products</strong> — distinct products (SKU-level items) they sell.</li>" +
        "<li><strong>Molecules</strong> — distinct active ingredients behind those products. " +
          "Far fewer molecules than products means many brands built on the same chemistry.</li>" +
        "<li><strong>Therapeutic Areas</strong> — how many of the market's " +
          (CACHE.lookups.tas.length) + " disease/treatment fields they compete in " +
          "(Cardiovascular, Oncology, Anti-Infectives…). <em>This is the breadth measure</em>: " +
          "1 = a specialist, 20 = a full-line house.</li>" +
        "<li><strong>ATC4 Classes</strong> — the finer WHO drug-classification level beneath " +
          "therapeutic area (" + (CACHE.lookups.atc4s.length) + " exist in this market). " +
          "A company can cover many ATC4 classes inside few therapeutic areas — that is depth, not breadth.</li>" +
      "</ul>" +
      '<div class="mi-gloss-bench"><strong>Peer benchmark (top 50 by value):</strong> ' +
        avgTA.toFixed(1) + " therapeutic areas · " + Math.round(avgProd) + " products · " +
        fmtLC(avgVPP) + " of value per product. Read any row against these to see whether a " +
        "competitor is <em>focused</em> (few areas, high value per product) or " +
        "<em>spread</em> (many areas, low value per product).</div>" +
      zetaLine +
      "</div>";
  }

  function taGlossary() {
    return '<div class="mi-method">' +
      '<div class="mi-method-h">What is a Therapeutic Area?</div>' +
      "<div>A <strong>Therapeutic Area (TA)</strong> is the disease or treatment field a medicine " +
      "belongs to — Cardiovascular, Oncology, Anti-Infectives, Respiratory, Consumer Health and so on. " +
      "It is the broadest way the pharmaceutical market is divided, and it is how commercial teams are " +
      "usually organised. This market has <strong>" + CACHE.lookups.tas.length + " therapeutic areas</strong>.</div>" +
      "<ul>" +
        "<li>The hierarchy runs <strong>Therapeutic Area → ATC4 class → Molecule → Product</strong>, " +
          "widest to narrowest. Click any row to drill down it.</li>" +
        "<li><strong>ATC4</strong> is the WHO's Anatomical Therapeutic Chemical classification at its " +
          "4th level — a precise drug class such as \"A10B0 ORAL ANTIDIABETICS\". There are " +
          CACHE.lookups.atc4s.length + " in this market, so roughly " +
          Math.round(CACHE.lookups.atc4s.length / Math.max(1, CACHE.lookups.tas.length)) +
          " per therapeutic area.</li>" +
        "<li><strong>Competitors</strong> counts how many corporations sell into that area — " +
          "a direct read of how contested it is.</li>" +
      "</ul></div>";
  }

  function priceColumnNote() {
    return '<div class="mi-note">Average price is market value ÷ units for the segment — ' +
      "a realised blend of pack mix and discounting, not a list price.</div>";
  }

  /** Product table carries price and launch metadata the generic table
   *  doesn't, so it gets its own renderer rather than more optional
   *  columns bolted onto the shared one. */
  function productTableHtml(res) {
    var rows = topSlice(res.rows);
    if (!rows.length) return '<div class="mi-empty">No products match the current filters.</div>';
    var meta = productMeta(rows.map(function (r) { return r.idx; }));
    var h = '<table class="mi-table"><thead><tr>' +
      '<th class="mi-th-rank">#</th><th>Product</th>' +
      '<th class="mi-num">LC Value</th><th class="mi-num">Units</th>' +
      '<th class="mi-num">Share</th><th class="mi-num">Growth</th>' +
      '<th class="mi-num">Avg Price</th><th>Molecule</th>' +
      "<th>Therapeutic Area</th><th class=\"mi-num\">Launch</th>" +
      '<th class="mi-th-drill"></th></tr></thead><tbody>';
    var maxV = rows[0].value;
    rows.forEach(function (r, i) {
      var m = meta[r.idx] || {};
      var g = r.growthPct === null ? "mi-flat" : r.growthPct >= 0 ? "mi-up" : "mi-down";
      h += '<tr class="mi-row-drill" data-drill="product" data-idx="' + r.idx + '">' +
        '<td class="mi-th-rank">' + (i + 1) + "</td>" +
        '<td class="mi-cell-name"><span class="mi-bar" style="width:' +
          ((r.value / maxV) * 100).toFixed(1) + '%"></span>' +
          '<span class="mi-name-txt" title="' + esc(r.name) + '">' + esc(r.name) + "</span></td>" +
        '<td class="mi-num mi-strong">' + fmtLC(r.value) + "</td>" +
        '<td class="mi-num">' + fmtUnits(r.units) + "</td>" +
        '<td class="mi-num">' + fmtPct(r.sharePct) + "</td>" +
        '<td class="mi-num ' + g + '">' + fmtSignedPct(r.growthPct) + "</td>" +
        '<td class="mi-num">' + fmtPrice(r.avgPrice) + "</td>" +
        "<td>" + esc(m.molecule || "—") + "</td>" +
        "<td>" + esc(m.ta || "—") + "</td>" +
        '<td class="mi-num">' + (m.launch || "—") + "</td>" +
        '<td class="mi-th-drill">›</td></tr>';
    });
    return h + "</tbody></table>";
  }

  /** Molecule / TA / launch year for a set of product indices. */
  function productMeta(idxList) {
    var want = new Set(idxList), out = {};
    scanAnnual(function (o) {
      var p = A.rows[o + F_PROD];
      if (!want.has(p) || out[p]) return;
      out[p] = {
        molecule: CACHE.lookups.molecules[A.rows[o + F_MOL]],
        ta: CACHE.lookups.tas[A.rows[o + F_TA]],
        launch: A.rows[o + F_LAUNCH] || null,
      };
    });
    return out;
  }

  // ---- price analysis --------------------------------------------------
  function renderPrice() {
    // The Price-vs-Units and Price-vs-LC-Value scatters were removed
    // (2026-08-06, Ahmed). At 400 plotted products on log/log axes they
    // were dense enough to be decorative rather than decision-useful --
    // the same price story is carried more directly by the two bar
    // charts and by the Avg Price column in Product Analysis.
    var body = '<div class="mi-grid-2">' +
      chartBox("mi-c-price-ta", 300) + chartBox("mi-c-price-corp", 300) +
      "</div>" + priceColumnNote();
    return section("mi-price", "Price Analysis",
      "Realised price by segment — market value divided by units.", body);
  }

  function drawPrice() {
    function avgPriceBy(field, lookup, n) {
      var res = rankedRows(field, lookup);
      return res.rows.filter(function (r) { return r.avgPrice; }).slice(0, n || 12);
    }
    function barCfg(rows, title, color) {
      return {
        type: "bar",
        data: { labels: rows.map(function (r) { return r.name; }), datasets: [{
          label: "Avg price (LC/unit)", data: rows.map(function (r) { return r.avgPrice; }),
          backgroundColor: color, borderRadius: 3, maxBarThickness: 22,
        }] },
        options: Object.assign({}, CHART_BASE, {
          indexAxis: "y",
          plugins: Object.assign({}, CHART_BASE.plugins, {
            legend: { display: false },
            title: { display: true, text: title, font: { size: 12, weight: "600" } },
            tooltip: Object.assign({}, CHART_BASE.plugins.tooltip, {
              callbacks: { label: function (c) { return " " + fmtPrice(c.parsed.x) + " LC/unit"; } } }),
          }),
          scales: {
            x: { grid: { color: "rgba(148,163,184,0.18)" }, ticks: { font: { size: 10 } } },
            y: { grid: { display: false }, ticks: { font: { size: 9 }, autoSkip: false } },
          },
        }),
      };
    }
    mountChart("mi-c-price-ta", barCfg(avgPriceBy(F_TA, "tas"), "Average price by Therapeutic Area", PALETTE[0]));
    mountChart("mi-c-price-corp", barCfg(avgPriceBy(F_CORP, "corps"), "Average price by Corporation (top by value)", PALETTE[1]));

  }

  // ---- portfolio -------------------------------------------------------
  function renderPortfolio() {
    var body = heatmapHtml(F_TA, "tas", "Therapeutic Area") +
      heatmapHtml(F_ATC, "atc4s", "ATC4") +
      treemapHtml() +
      '<div class="mi-note">Zeta is always included in the visuals above, even when it ' +
        "falls outside the Top N — its row and node are marked in light blue.</div>";
    return section("mi-portfolio", "Portfolio Analysis",
      "Where each corporation actually competes, and how concentrated its portfolio is.", body);
  }

  /**
   * Top-N corporations for the portfolio visuals, with Zeta guaranteed
   * present. Zeta ranks ~#39 of 1,223, so a plain Top-10 slice would
   * exclude us from our own portfolio analysis — the one row the reader
   * came for. Appended (not promoted) so the ranking stays truthful.
   */
  function corpSliceWithZeta(limit) {
    var all = rankedRows(F_CORP, "corps").rows;
    var slice = (limit ? all.slice(0, limit) : topSlice(all)).slice();
    var zi = zetaCorpIdx();
    if (zi < 0) return slice;
    var present = slice.some(function (r) { return r.idx === zi; });
    if (present) return slice;
    for (var i = 0; i < all.length; i++) {
      if (all[i].idx === zi) { slice.push(all[i]); break; }
    }
    return slice;
  }

  /** Corporation × dimension heatmap. Rendered as a CSS grid rather than
   *  a chart library: it stays crisp at any zoom, exports cleanly to PDF,
   *  and needs no extra dependency. */
  function heatmapHtml(field, lookup, label) {
    var cmp = comparisonYears();
    if (!cmp.cur) return "";
    var corps = corpSliceWithZeta().map(function (r) { return r.idx; });
    var dims = rankedRows(field, lookup).rows.slice(0, 12).map(function (r) { return r.idx; });
    if (!corps.length || !dims.length) return "";
    var corpSet = new Set(corps), dimSet = new Set(dims);
    var cell = new Map(), rowTot = new Map();
    scanAnnual(function (o, u, v) {
      if (A.rows[o + F_YEAR] !== cmp.cur.i) return;
      var c = A.rows[o + F_CORP], d = A.rows[o + field];
      if (!corpSet.has(c) || !dimSet.has(d)) return;
      cell.set(c + "|" + d, (cell.get(c + "|" + d) || 0) + v);
      rowTot.set(c, (rowTot.get(c) || 0) + v);
    });
    var max = 0;
    cell.forEach(function (v) { if (v > max) max = v; });
    var corpNames = CACHE.lookups.corps, dimNames = CACHE.lookups[lookup];
    var h = '<div class="mi-heat-wrap"><div class="mi-heat-title">Corporation × ' +
      esc(label) + " — value concentration (" + cmp.cur.y + ")</div>" +
      '<div class="mi-heat" style="grid-template-columns:180px repeat(' + dims.length + ',1fr)">' +
      '<div class="mi-heat-corner"></div>';
    dims.forEach(function (d) {
      h += '<div class="mi-heat-colh" title="' + esc(dimNames[d]) + '">' +
        esc(String(dimNames[d]).slice(0, 18)) + "</div>";
    });
    corps.forEach(function (c) {
      var zeta = isZetaCorp(c);
      h += '<div class="mi-heat-rowh' + (zeta ? " mi-heat-zeta" : "") + '" title="' +
        esc(corpNames[c]) + '">' + esc(corpNames[c]) +
        (zeta ? '<span class="mi-zeta-tag">US</span>' : "") + "</div>";
      dims.forEach(function (d) {
        var v = cell.get(c + "|" + d) || 0;
        // Gamma-lifted so mid-range values stay visible; a linear ramp
        // collapses everything below the leader into near-white.
        var intensity = max > 0 ? Math.pow(v / max, 0.45) : 0;
        var pctOfCorp = rowTot.get(c) ? (v / rowTot.get(c)) * 100 : 0;
        // Zeta's own row is tinted in the Zeta blue rather than the house
        // navy, so our footprint reads as ours at a glance.
        var rgb = zeta ? "14,165,233" : "15,76,129";
        h += '<div class="mi-heat-cell" style="background:rgba(' + rgb + "," +
          (0.06 + intensity * 0.88).toFixed(3) + ')" title="' +
          esc(corpNames[c] + " · " + dimNames[d] + "\n" + fmtLC(v) + " LC · " +
              pctOfCorp.toFixed(1) + "% of this corporation") + '">' +
          (v > 0 && intensity > 0.32
            ? '<span style="color:#fff">' + fmtLC(v) + "</span>"
            : v > 0 ? "<span>" + fmtLC(v) + "</span>" : "") +
          "</div>";
      });
    });
    return h + "</div></div>";
  }

  /** Treemap: Corporation → Therapeutic Area, as proportional blocks.
   *  Hand-rendered — a full treemap library is a heavy dependency for a
   *  single visual. */
  function treemapHtml() {
    var corps = corpSliceWithZeta(12);
    if (!corps.length) return "";
    var total = corps.reduce(function (a, r) { return a + r.value; }, 0);
    if (total <= 0) return "";
    var cmp = comparisonYears();
    var byCorpTA = new Map();
    var corpSet = new Set(corps.map(function (r) { return r.idx; }));
    scanAnnual(function (o, u, v) {
      if (cmp.cur && A.rows[o + F_YEAR] !== cmp.cur.i) return;
      var c = A.rows[o + F_CORP];
      if (!corpSet.has(c)) return;
      var t = A.rows[o + F_TA];
      if (!byCorpTA.has(c)) byCorpTA.set(c, new Map());
      var m = byCorpTA.get(c);
      m.set(t, (m.get(t) || 0) + v);
    });
    var h = '<div class="mi-heat-wrap"><div class="mi-heat-title">' +
      "Portfolio composition — Corporation → Therapeutic Area</div>" +
      '<div class="mi-tree">';
    corps.forEach(function (r) {
      var pct = (r.value / total) * 100;
      var zeta = isZetaCorp(r.idx);
      var inner = byCorpTA.get(r.idx) || new Map();
      var parts = [];
      inner.forEach(function (v, t) { parts.push({ t: t, v: v }); });
      parts.sort(function (a, b) { return b.v - a.v; });
      var innerTotal = parts.reduce(function (a, p) { return a + p.v; }, 0) || 1;
      // Zeta gets a floor width so a 0.8%-share node is still readable
      // rather than collapsing to a sliver beside 4%-share competitors.
      var flexBasis = zeta ? Math.max(pct, 8) : pct;
      h += '<div class="mi-tree-node' + (zeta ? " mi-tree-zeta" : "") +
        '" style="flex:' + flexBasis.toFixed(3) + ' 1 0" title="' +
        esc(r.name + " · " + fmtLC(r.value) + " LC · " + pct.toFixed(1) + "% of shown corps") + '">' +
        '<div class="mi-tree-label">' + esc(r.name) +
          (zeta ? '<span class="mi-zeta-tag">US</span>' : "") +
          "<span>" + fmtLC(r.value) + "</span></div>" +
        '<div class="mi-tree-inner">' +
          parts.slice(0, 6).map(function (p, j) {
            var w = (p.v / innerTotal) * 100;
            return '<span class="mi-tree-seg" style="width:' + w.toFixed(2) + "%;background:" +
              (zeta ? ZETA_COLOR : PALETTE[j % PALETTE.length]) + '" title="' +
              esc(CACHE.lookups.tas[p.t] + " · " + fmtLC(p.v) + " LC · " + w.toFixed(1) + "%") +
              '"></span>';
          }).join("") +
        "</div></div>";
    });
    return h + "</div></div>";
  }

  // ---- growth ----------------------------------------------------------
  /**
   * Zeta's own contribution to the market's movement, stated before the
   * competitor bridge. The waterfall shows who moved the market; this
   * answers the prior question — did WE move with it, and by how much.
   *
   * "Share of market growth" is the number that matters here: growing
   * +99% sounds decisive until you see it accounted for a fraction of a
   * point of the market's total gain. Both readings are shown so neither
   * flatters nor understates.
   */
  function zetaGrowthStrip() {
    var zi = zetaCorpIdx();
    if (zi < 0) return "";
    var res = rankedRows(F_CORP, "corps");
    var me = null;
    for (var i = 0; i < res.rows.length; i++) {
      if (res.rows[i].idx === zi) { me = res.rows[i]; break; }
    }
    if (!me || me.growthPct === null) return "";
    var cmp = comparisonYears();
    var marketCur = 0, marketPrev = 0;
    res.rows.forEach(function (r) { marketCur += r.value; marketPrev += r.prevValue; });
    var marketDelta = marketCur - marketPrev;
    var myDelta = me.value - me.prevValue;
    var mktG = growth(marketCur, marketPrev);
    var shareOfGrowth = marketDelta !== 0 ? (myDelta / marketDelta) * 100 : null;
    var gap = (mktG !== null) ? me.growthPct - mktG : null;
    var beating = gap !== null && gap >= 0;

    return '<div class="mi-zgrow">' +
      '<div class="mi-zgrow-head">Zeta Pharma in this movement' +
        '<span class="mi-zeta-tag">US</span></div>' +
      '<div class="mi-zgrow-stats">' +
        zgrowStat("Value added", (myDelta >= 0 ? "+" : "−") + fmtLC(Math.abs(myDelta)),
                  cmp.prev ? cmp.prev.y + " → " + cmp.cur.y : "") +
        zgrowStat("Our growth", fmtSignedPct(me.growthPct),
                  mktG === null ? "" : "market " + fmtSignedPct(mktG)) +
        zgrowStat("vs Market", gap === null ? "—" : fmtSignedPct(gap) + " pts",
                  beating ? "outpacing" : "trailing") +
        zgrowStat("Share of market growth",
                  shareOfGrowth === null ? "—" : fmtPct(shareOfGrowth, 2),
                  "of the " + fmtLC(Math.abs(marketDelta)) + " LC the market moved") +
      "</div>" +
      '<div class="mi-zgrow-note">' +
        (beating
          ? "Zeta grew faster than the market, so share moved our way — but we captured " +
            (shareOfGrowth === null ? "—" : fmtPct(shareOfGrowth, 2)) +
            " of the total growth on offer. The bridge below names who took the rest."
          : "Zeta grew slower than the market. Value is " +
            (myDelta >= 0 ? "up" : "down") + " but share is eroding — the competitors " +
            "gaining that share are named in the bridge below.") +
      "</div></div>";
  }

  function zgrowStat(label, value, sub) {
    return '<div class="mi-zgrow-stat"><div class="mi-zgrow-l">' + esc(label) + "</div>" +
      '<div class="mi-zgrow-v">' + esc(value) + "</div>" +
      '<div class="mi-zgrow-s">' + esc(sub || "") + "</div></div>";
  }

  function renderGrowth() {
    var body = zetaGrowthStrip() + chartBox("mi-c-waterfall", 320) +
      '<div class="mi-grid-2">' +
        '<div>' + growthListHtml(F_CORP, "corps", "Corporation", true) + "</div>" +
        '<div>' + growthListHtml(F_CORP, "corps", "Corporation", false) + "</div>" +
      "</div>" +
      '<div class="mi-grid-2">' +
        '<div>' + growthListHtml(F_TA, "tas", "Therapeutic Area", true) + "</div>" +
        '<div>' + growthListHtml(F_MOL, "molecules", "Molecule", true) + "</div>" +
      "</div>";
    return section("mi-growth", "Growth Analysis",
      "Where value was created and destroyed between the two most recent periods in scope.", body);
  }

  function growthListHtml(field, lookup, label, gaining) {
    var res = rankedRows(field, lookup);
    var floor = res.total * 0.002;
    var rows = res.rows.filter(function (r) {
      return r.growthPct !== null && (r.value >= floor || r.prevValue >= floor);
    });
    rows.sort(function (a, b) {
      return gaining ? (b.value - b.prevValue) - (a.value - a.prevValue)
                     : (a.value - a.prevValue) - (b.value - b.prevValue);
    });
    rows = rows.slice(0, Fx.topN === 0 ? 10 : Math.min(Fx.topN, 10));
    // Zeta is appended to the corporation lists when it falls outside the
    // top movers -- at rank ~39 it otherwise never appears in its own
    // growth analysis.
    if (field === F_CORP) {
      var zi2 = zetaCorpIdx();
      if (zi2 >= 0 && !rows.some(function (r) { return r.idx === zi2; })) {
        for (var zj = 0; zj < res.rows.length; zj++) {
          if (res.rows[zj].idx === zi2 && res.rows[zj].growthPct !== null) {
            rows = rows.concat([res.rows[zj]]);
            break;
          }
        }
      }
    }
    if (!rows.length) return "";
    var title = (gaining ? "Top growing " : "Top declining ") + label.toLowerCase() + "s";
    var h = '<div class="mi-mini"><div class="mi-mini-title">' + esc(title) + "</div>";
    var maxAbs = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.value - r.prevValue); })) || 1;
    var isCorpDim = (field === F_CORP);
    rows.forEach(function (r) {
      var d = r.value - r.prevValue;
      var w = (Math.abs(d) / maxAbs) * 100;
      var zeta = isCorpDim && isZetaCorp(r.idx);
      h += '<div class="mi-mini-row' + (zeta ? " mi-mini-zeta" : "") + '" title="' + esc(r.name) + '">' +
        '<span class="mi-mini-name">' + esc(r.name) +
          (zeta ? '<span class="mi-zeta-tag">US</span>' : "") + "</span>" +
        '<span class="mi-mini-bar"><span style="width:' + w.toFixed(1) + "%;background:" +
          (d >= 0 ? "#15803d" : "#b91c1c") + '"></span></span>' +
        '<span class="mi-mini-val ' + (d >= 0 ? "mi-up" : "mi-down") + '">' +
          (d >= 0 ? "+" : "−") + fmtLC(Math.abs(d)) + "</span>" +
        '<span class="mi-mini-pct ' + (d >= 0 ? "mi-up" : "mi-down") + '">' +
          fmtSignedPct(r.growthPct) + "</span></div>";
    });
    return h + "</div>";
  }

  function drawGrowth() {
    // Waterfall: prior total → top contributors → all others → current
    // total. Answers "where did the change actually come from", which a
    // pair of bar charts never does.
    var res = rankedRows(F_CORP, "corps");
    var cmp = comparisonYears();
    if (!cmp.cur || !cmp.prev) return;
    var prevTotal = 0, curTotal = 0;
    res.rows.forEach(function (r) { prevTotal += r.prevValue; curTotal += r.value; });
    var movers = res.rows.filter(function (r) { return r.prevValue > 0 || r.value > 0; })
      .map(function (r) { return { name: r.name, d: r.value - r.prevValue, idx: r.idx }; })
      .sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    // Zeta is always shown in the bridge even when it isn't a top mover --
    // an executive bridge that omits our own contribution is not useful.
    var zi = zetaCorpIdx();
    if (zi >= 0) {
      var mePos = -1;
      for (var mi = 0; mi < movers.length; mi++) { if (movers[mi].idx === zi) { mePos = mi; break; } }
      if (mePos > 0) { var meMover = movers.splice(mePos, 1)[0]; movers.unshift(meMover); }
    }
    var showN = Fx.topN === 0 ? 8 : Math.min(Fx.topN, 8);
    var top = movers.slice(0, showN);
    var rest = movers.slice(showN).reduce(function (a, m) { return a + m.d; }, 0);

    var labels = [String(cmp.prev.y)], bars = [[0, prevTotal]], colors = ["#94A3B8"];
    var run = prevTotal;
    var zetaName = zetaCorpIdx() >= 0 ? CACHE.lookups.corps[zetaCorpIdx()] : null;
    top.forEach(function (m) {
      labels.push(m.name);
      bars.push([run, run + m.d]);
      colors.push(m.name === zetaName ? ZETA_COLOR : (m.d >= 0 ? "#15803d" : "#b91c1c"));
      run += m.d;
    });
    if (Math.abs(rest) > 0) {
      labels.push("All others");
      bars.push([run, run + rest]);
      colors.push(rest >= 0 ? "#4A9D5F" : "#C4713A");
      run += rest;
    }
    labels.push(String(cmp.cur.y));
    bars.push([0, curTotal]);
    colors.push("#0F4C81");

    mountChart("mi-c-waterfall", {
      type: "bar",
      data: { labels: labels, datasets: [{
        data: bars, backgroundColor: colors, borderRadius: 3, maxBarThickness: 44,
      }] },
      options: Object.assign({}, CHART_BASE, {
        plugins: Object.assign({}, CHART_BASE.plugins, {
          legend: { display: false },
          title: { display: true,
            text: "Value bridge " + cmp.prev.y + " → " + cmp.cur.y + " (by corporation)",
            font: { size: 12, weight: "600" } },
          tooltip: Object.assign({}, CHART_BASE.plugins.tooltip, {
            callbacks: { label: function (c) {
              var v = c.raw, d = v[1] - v[0];
              return c.dataIndex === 0 || c.dataIndex === labels.length - 1
                ? " Total " + fmtLC(v[1]) + " LC"
                : " " + (d >= 0 ? "+" : "−") + fmtLC(Math.abs(d)) + " LC";
            } } }),
        }),
        scales: Object.assign({}, CHART_BASE.scales, {
          x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 30 } },
          y: { grid: CHART_BASE.scales.y.grid,
               ticks: { font: { size: 10 }, callback: function (v) { return fmtLC(v); } } },
        }),
      }),
    });
  }

  // ---- insights --------------------------------------------------------
  function renderInsights() {
    var ins = buildInsights();
    return section("mi-insights", "Executive Insights",
      "Generated from the current filter scope — what happened, why, and what to do about it.",
      '<div class="mi-ins-grid">' + ins.map(insightHtml).join("") + "</div>");
  }

  // ---------------------------------------------------------------------
  // Drill-through
  // ---------------------------------------------------------------------
  var DRILL_PATH = {
    ta: { field: F_TA, lookup: "tas", label: "Therapeutic Area",
          next: { field: F_ATC, lookup: "atc4s", label: "ATC4", key: "atc4" } },
    atc4: { field: F_ATC, lookup: "atc4s", label: "ATC4",
            next: { field: F_MOL, lookup: "molecules", label: "Molecule", key: "molecule" } },
    molecule: { field: F_MOL, lookup: "molecules", label: "Molecule",
                next: { field: F_PROD, lookup: "products", label: "Product", key: "product" } },
    corp: { field: F_CORP, lookup: "corps", label: "Corporation",
            next: { field: F_PROD, lookup: "products", label: "Product", key: "product" } },
    product: { field: F_PROD, lookup: "products", label: "Product", next: null },
  };

  function openDrill(kind, idx) {
    var spec = DRILL_PATH[kind];
    if (!spec || typeof global.DS === "undefined" || !global.DS.openModal) return;
    var name = CACHE.lookups[spec.lookup][idx];

    // Scope the drill by temporarily applying the clicked entity as a
    // filter, so every figure inside the modal respects the bar above it.
    var saved = Fx[kind === "ta" ? "ta" : kind === "atc4" ? "atc4"
      : kind === "molecule" ? "molecule" : kind === "corp" ? "corp" : "product"];
    var fkey = kind === "ta" ? "ta" : kind === "atc4" ? "atc4"
      : kind === "molecule" ? "molecule" : kind === "corp" ? "corp" : "product";
    Fx[fkey] = new Set([idx]);

    var cmp = comparisonYears();
    var tot = totalsForYears(cmp.cur ? new Set([cmp.cur.i]) : null);
    var prevTot = cmp.prev ? totalsForYears(new Set([cmp.prev.i])) : null;
    var g = prevTot ? growth(tot.value, prevTot.value) : null;

    var head = '<div class="mi-drill-kpis">' +
      drillStat("LC Value", fmtLC(tot.value), cmp.cur ? cmp.cur.y : "") +
      drillStat("Units", fmtUnits(tot.units), cmp.cur ? cmp.cur.y : "") +
      drillStat("Growth", fmtSignedPct(g), prevTot ? "vs " + cmp.prev.y : "no prior year") +
      drillStat("Avg price", fmtPrice(tot.units > 0 ? tot.value / tot.units : null), "LC/unit") +
      "</div>";

    var body = head;
    if (spec.next) {
      var res = rankedRows(spec.next.field, spec.next.lookup);
      body += '<h4 class="mi-drill-h">' + esc(spec.next.label) + " breakdown</h4>" +
        rankedTableHtml(res, { label: spec.next.label });
    }
    // Annual trend for the drilled entity. Now available at EVERY level
    // including product -- the old monthly cube had no product dimension,
    // so product drills used to show nothing here.
    var canTrend = true;
    body += '<h4 class="mi-drill-h">Trend by year</h4>' +
      '<div class="mi-chart" style="height:220px"><canvas id="mi-drill-trend"></canvas></div>';

    var trendData = trendSeries();
    Fx[fkey] = saved;   // restore before the modal renders anything else

    global.DS.openModal({
      title: spec.label + " — " + name,
      bodyHtml: body,
      width: "980px",
    });
    if (canTrend && trendData) {
      setTimeout(function () {
        mountChart("mi-drill-trend", {
          type: "bar",
          data: { labels: trendData.labels, datasets: [{
            label: "LC Value", data: trendData.value,
            backgroundColor: trendData.partial.map(function (p) {
              return p ? "rgba(15,76,129,0.35)" : PALETTE[0];
            }),
            borderRadius: 4, maxBarThickness: 56,
          }] },
          options: Object.assign({}, CHART_BASE, {
            plugins: Object.assign({}, CHART_BASE.plugins, { legend: { display: false } }),
            scales: Object.assign({}, CHART_BASE.scales, {
              y: { grid: CHART_BASE.scales.y.grid,
                   ticks: { font: { size: 10 }, callback: function (v) { return fmtLC(v); } } },
            }),
          }),
        });
      }, 30);
    }
  }

  function drillStat(label, value, sub) {
    return '<div class="mi-drill-stat"><div class="mi-drill-l">' + esc(label) + "</div>" +
      '<div class="mi-drill-v">' + esc(value) + "</div>" +
      '<div class="mi-drill-s">' + esc(sub) + "</div></div>";
  }

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------
  function exportCsv() {
    var d = TOP_DIMS.filter(function (x) { return x.key === _topDim; })[0];
    var res = rankedRows(d.field, d.lookup, { sortBy: _topSort });
    var lines = ["Rank,Name,LC Value,Units,Share %,Growth %"];
    topSlice(res.rows).forEach(function (r, i) {
      lines.push([i + 1, '"' + String(r.name).replace(/"/g, '""') + '"',
        Math.round(r.value), Math.round(r.units),
        r.sharePct === null ? "" : r.sharePct.toFixed(2),
        r.growthPct === null ? "" : r.growthPct.toFixed(2)].join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "market-intelligence-" + d.key + "-" + Date.now() + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  var _container = null;

  function rerender() {
    if (!_container) return;
    closeAllMenus();
    render(_container);
  }

  function render(container) {
    _container = container;
    destroyCharts();

    var k = buildKpis();
    var cmp = comparisonYears();
    var periodLabel = cmp.cur
      ? (cmp.prev ? cmp.cur.y + " vs " + cmp.prev.y : String(cmp.cur.y))
      : "no period in scope";

    container.innerHTML =
      '<div class="mi-root">' +
        '<div class="mi-head">' +
          "<div>" +
            '<h1 class="mi-title">Total Market Intelligence</h1>' +
            '<p class="mi-sub">Egyptian pharmaceutical market · IMS ' +
              esc(CACHE.meta.annualYears[0] + "–" + CACHE.meta.annualYears[CACHE.meta.annualYears.length - 1]) +
              " · comparing " + esc(periodLabel) + " · " + esc(scopeLabel()) + "</p>" +
          "</div>" +
          '<div class="mi-head-tools">' +
            '<button type="button" class="mi-btn" id="mi-export">Export current view</button>' +
          "</div>" +
        "</div>" +
        renderFilterBar() +
        partialBanner() +
        '<div class="mi-kpis">' + k.cards.map(renderKpiCard).join("") + "</div>" +
        renderZetaPanel() +
        renderOverview() +
        renderShare() +
        renderTop() +
        renderDimensionSections() +
        renderPrice() +
        renderPortfolio() +
        renderGrowth() +
        renderInsights() +
        '<div class="mi-foot">Source: ' + esc(CACHE.meta.source) +
          " · grain: " + esc(CACHE.meta.grain || "Calendar Year") +
          " · cache built " + esc(CACHE.meta.generatedAt) +
          " · " + CACHE.meta.annualCells.toLocaleString() + " aggregated cells</div>" +
      "</div>";

    wireFilterBar(container);

    container.querySelectorAll("[data-share]").forEach(function (b) {
      b.addEventListener("click", function () { _shareDim = b.getAttribute("data-share"); rerender(); });
    });
    container.querySelectorAll("[data-top]").forEach(function (b) {
      b.addEventListener("click", function () { _topDim = b.getAttribute("data-top"); rerender(); });
    });
    container.querySelectorAll("[data-topsort]").forEach(function (b) {
      b.addEventListener("click", function () { _topSort = b.getAttribute("data-topsort"); rerender(); });
    });
    container.querySelectorAll(".mi-row-drill").forEach(function (tr) {
      tr.addEventListener("click", function () {
        openDrill(tr.getAttribute("data-drill"), parseInt(tr.getAttribute("data-idx"), 10));
      });
    });
    var ex = container.querySelector("#mi-export");
    if (ex) ex.addEventListener("click", exportCsv);

    // Charts after the DOM exists.
    setTimeout(function () {
      drawOverview(); drawShare(); drawPrice(); drawGrowth();
    }, 20);
  }

  function init(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    document.body.classList.add("market-intel-mode");
    if (!decodeCache()) {
      container.innerHTML = '<div class="mi-root"><div class="mi-empty-page">' +
        "<h2>Market Intelligence cache not found</h2>" +
        "<p>Run <code>python etl/build_market_intel_cache.py</code> to generate " +
        "<code>cache/market_intel.data.js</code> from " +
        "<code>IMS 2022 to April 2026.xlsx</code>, then reload.</p></div></div>";
      return;
    }
    if (Fx.year === null) resetFilters();   // seed the full-year default
    render(container);
  }

  function destroy() {
    document.body.classList.remove("market-intel-mode");
    destroyCharts();
    document.removeEventListener("click", closeAllMenus);
    _container = null;
  }

  global.MarketIntelligence = {
    init: init,
    destroy: destroy,
    render: render,
    _decodeCache: decodeCache,
    _internals: function () {
      return {
        CACHE: CACHE, A: A, Fx: Fx,
        scanAnnual: scanAnnual,
        aggregateBy: aggregateBy, rankedRows: rankedRows,
        buildKpis: buildKpis, buildInsights: buildInsights,
        yearSeries: yearSeries, trendSeries: trendSeries,
        comparisonYears: comparisonYears, totalsForYears: totalsForYears,
        distinctCount: distinctCount, weightedAvgPrice: weightedAvgPrice,
        findDominance: findDominance, launchBucketOf: launchBucketOf,
        LAUNCH_BUCKETS: LAUNCH_BUCKETS,
        fmtLC: fmtLC, fmtUnits: fmtUnits, fmtPct: fmtPct,
        F: { F_YEAR: F_YEAR, F_TA: F_TA, F_ATC: F_ATC, F_CORP: F_CORP,
             F_MOL: F_MOL, F_PROD: F_PROD, F_BRAND: F_BRAND, F_FORM: F_FORM,
             F_LAUNCH: F_LAUNCH, F_PRICE: F_PRICE },
        setFilter: function (k, v) { Fx[k] = v; },
        resetFilters: resetFilters,
      };
    },
  };
})(window);
