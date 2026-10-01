(function(g){(g.AskBuild=g.AskBuild||{})["ask-pages.js"]="20260921_askq2";})(typeof window!=="undefined"?window:this);
/**
 * ASK THE DATA — page adapters for pages that have no legacy Ask adapter
 * ============================================================================
 * The four original pages (Executive, Sales, Coverage, SFE) keep their own
 * adapters (ask-executive.js, ask-sales.js, ask-coverage.js, ask-sfe.js). Every
 * other page is answered ONLY by the AskQuery layer, so its adapter is just the
 * panel's presentation (title, examples, placeholder). No calculation lives here.
 *
 * askAdapterForTab() in app.js falls back to AskPages.adapter(tab); it returns
 * null when the user has no usable provider for that page, so the panel is not
 * shown where it could not answer.
 */
(function (global) {
  "use strict";

  var PAGES = {
    workingdays: {
      subtitle: "Ask about Field Working Days, TOT and target working days by tier, BU, line or manager. Answers respect your access role.",
      placeholder: "e.g. Which DMs are below 70% of target field days?",
      examples: ["What is the average field working days % for DM / DSM?", "Which DMs have the lowest field working days in August?", "Field working days by line", "Field working days MoM", "Show the reps behind the biggest TOT"]
    },
    sprint: {
      subtitle: "Ask about Zeta Sprint 2026 scores, KPI points and rankings by BU, line, DM or rep. Answers respect your access role.",
      placeholder: "e.g. Who are the top 10 in Zeta Sprint?",
      examples: ["Top 10 in Zeta Sprint", "Sprint points by line", "Why did the lowest-scoring DM get that score?", "Which KPI loses the most points?", "Sprint score MoM"]
    },
    coaching: {
      subtitle: "Ask about coaching days, double visits and who has not been coached. Answers respect your access role.",
      placeholder: "e.g. Who has not been coached this month?",
      examples: ["Coaching days by DM", "Which reps have not been coached?", "Double-visit coverage by line", "Lowest coaching days per DM in August", "Coaching days MoM"]
    },
    iqvia: {
      subtitle: "Ask about IQVIA market size, Zeta share, growth and competitors. Answers respect your access role.",
      placeholder: "e.g. What is Zeta's market share in DIAB?",
      examples: ["Zeta market share by market", "Top 10 corporations by sales", "Market growth vs Zeta growth", "Which molecules are growing fastest?", "Market share YoY"]
    },
    marketintel: {
      subtitle: "Ask about total-market sales, growth, share and competitors from Market Intelligence. Answers respect your access role.",
      placeholder: "e.g. Which markets are growing fastest?",
      examples: ["Top 10 markets by sales", "Zeta share by market", "Which corporations gained share?", "Market growth by ATC class", "Market sales YoY"]
    },
    imsrx: {
      subtitle: "Ask about IMS prescription volumes, physician panel and brand Rx share. Answers respect your access role.",
      placeholder: "e.g. Rx by brand",
      examples: ["Rx by brand", "Top 10 physicians by Rx", "Rx share by specialty", "Which brands lost Rx?", "Rx MoM"]
    },
    tomarket: {
      subtitle: "Ask about To-Market vs In-Market: sell-in, sell-out, stock days and pull-through. Answers respect your access role.",
      placeholder: "e.g. To-market vs in-market by brand",
      examples: ["To-market vs in-market by brand", "Which brands have the biggest stock build?", "Stock days by line", "Sell-out vs sell-in gap", "In-market MoM"]
    }
  };

  function adapter(tab) {
    var p = PAGES[tab];
    if (!p || !global.AskQuery) return null;
    var a = {
      id: tab, tab: tab, title: "Ask the Data", subtitle: p.subtitle, placeholder: p.placeholder,
      examples: p.examples, notFoundHint: "Name a line, BU, manager or measure you have access to.",
      dims: [], visibleDimValues: function () { return null; }
    };
    return global.AskQuery.handles(a) ? a : null;
  }

  global.AskPages = { adapter: adapter, tabs: Object.keys(PAGES) };
})(typeof window !== "undefined" ? window : this);
