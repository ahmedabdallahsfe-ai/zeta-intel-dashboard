/**
 * config.js
 * =========
 * Single source of truth for every configurable value used by the
 * dashboard front end. No other .js file should contain a hardcoded
 * color, label, file path, or default filter -- if a value needs to
 * change, it changes here.
 *
 * Loaded first (before cache data and before app.js) via a plain
 * <script> tag, so it simply defines a global CONFIG object. No bundler,
 * no build step -- this project runs by double-clicking dashboard.html
 * (via refresh.bat) with zero install beyond Python for the ETL side.
 */

const CONFIG = {

  // ---------------------------------------------------------------------
  // Workbook / cache identity (must mirror refresh.py's CONFIG block)
  // ---------------------------------------------------------------------
  workbook: {
    fileName: "Final Total Coverage Feb to June.xlsx",
    sheetName: "Details",
  },

  // Cache files are loaded as <script> tags (not fetch()) so the
  // dashboard works from a plain double-clicked file:// page with no
  // local server and no CORS errors. Each script defines a window global;
  // the names below must match what refresh.py writes in write_cache_pair().
  cache: {
    dashboardVar: "DASHBOARD_CACHE",   // window.DASHBOARD_CACHE  <- cache/dashboard.data.js
    metadataVar: "DASHBOARD_METADATA", // window.DASHBOARD_METADATA <- cache/metadata.data.js
    recordsVar: "DASHBOARD_RECORDS",   // window.DASHBOARD_RECORDS <- cache/records.data.js (dictionary-encoded row-level data for client-side filter re-aggregation)
  },

  // ---------------------------------------------------------------------
  // Theme -- Power BI / Tableau-style executive look
  // ---------------------------------------------------------------------
  theme: {
    colors: {
      primary: "#2563EB",       // corporate blue (headers, primary actions)
      primaryDark: "#1D4ED8",
      primaryLight: "#DBEAFE",
      secondary: "#0F2942",     // navy (nav / titles)
      success: "#0A8A5F",
      warning: "#D97706",
      danger: "#DC2626",
      neutral: "#64748B",
      background: "#F4F6F9",
      surface: "#FFFFFF",
      border: "#E2E8F0",
      textPrimary: "#0F172A",
      textSecondary: "#64748B",
    },
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif",
  },

  // Palette used for chart series, in order. Repeats if a chart needs
  // more categories than colors (e.g. 16 teams).
  chartColors: [
    "#2563EB", "#0A8A5F", "#D97706", "#DC2626", "#7C3AED",
    "#0891B2", "#DB2777", "#65A30D", "#EA580C", "#4F46E5",
  ],

  // ---------------------------------------------------------------------
  // KPI card definitions (Section 2 of the dashboard). `key` matches the
  // field the Phase 2 aggregation engine writes into cache/dashboard.json
  // under `kpis`. `polarity` tells the KPI-card delta indicator whether
  // an increase vs the prior period is good, bad, or not a judgment this
  // dashboard should make:
  //   "up-good" -- more is better (Coverage %, Right Freq %, headcount growth)
  //   "up-bad"  -- more is worse (resignations, vacant slots)
  //   "neutral" -- direction shown, but not color-coded as good/bad
  //                (Customers/Rep rising could mean growth OR overload --
  //                that's a judgment call for the business, not this tool)
  // ---------------------------------------------------------------------
  kpiCards: [
    // Workforce
    { id: "activeReps", label: "Active Employee", key: "activeReps", format: "number", icon: "users", polarity: "up-good" },
    { id: "resignedReps", label: "Resigned Employee", key: "resignedReps", format: "number", icon: "userMinus", polarity: "up-bad" },
    { id: "vacancyCount", label: "Vacancy Count", key: "vacancyCount", format: "number", icon: "alertTriangle", polarity: "up-bad" },
    // Coverage quality
    { id: "coveragePct", label: "Coverage %", key: "coveragePct", format: "percent1", icon: "target", polarity: "up-good" },
    { id: "rightFreqPct", label: "Right Frequency %", key: "rightFreqPct", format: "percent1", icon: "repeat", polarity: "up-good" },
    { id: "customersPerRep", label: "Customers / Emp", key: "customersPerRep", format: "decimal1", icon: "briefcase", polarity: "neutral" },
    { id: "totalUniqueCustomers", label: "Total Customers (Unique)", key: "totalUniqueCustomers", format: "number", icon: "users", polarity: "neutral" },
    { id: "totalSharedCustomers", label: "Total Customers (Shared)", key: "totalSharedCustomers", format: "number", icon: "users", polarity: "neutral" },
    // Visit productivity
    { id: "totalTargetVisits", label: "Target Visits", key: "totalTargetVisits", format: "number", icon: "calendar", polarity: "neutral" },
    { id: "totalActualVisits", label: "Actual Visits", key: "totalActualVisits", format: "number", icon: "checkSquare", polarity: "up-good" },
    { id: "visitAchievementPct", label: "Visit Achievement %", key: "visitAchievementPct", format: "percent1", icon: "trendingUp", polarity: "up-good" },
    // Coverage gap
    { id: "notSeenCount", label: "Not Seen Customers", key: "notSeenCount", format: "number", icon: "eyeOff", polarity: "up-bad" },
    { id: "notSeenPct", label: "Not Seen %", key: "notSeenPct", format: "percent1", icon: "eyeOff", polarity: "up-bad" },
  ],

  // ---------------------------------------------------------------------
  // Global filters (Section: Filters). `field` matches the transformed
  // column name produced by refresh.py.
  // ---------------------------------------------------------------------
  filters: {
    fields: [
      { id: "period", label: "Period", field: "Period" },
      { id: "team", label: "Team", field: "Team" },
      { id: "businessUnit", label: "Business Unit", field: "Business Unit" },
      { id: "nsm", label: "National Sales Manager", field: "National Sales Manager" },
      { id: "areaManager", label: "Area Manager", field: "Area Manager" },
      { id: "manager", label: "Manager", field: "Manager" },
      { id: "employee", label: "Employee", field: "Employee" },
      { id: "specialty", label: "Specialty", field: "Specialty" },
      { id: "class", label: "Class", field: "Class" },
      { id: "status", label: "Status", field: "Active" },
      { id: "experience", label: "Experience", field: "Experience" },
      { id: "type", label: "Type", field: "Type" },
      { id: "title", label: "Title", field: "Title" },
    ],
    // Applied on first load; "latest" is resolved at runtime against
    // metadata.latestPeriod.
    // v3 shape: all fields including period are arrays.
    // [] = "Latest" for period, "All" for everything else.
    defaults: {
      period: [],
      team: [],
      businessUnit: [],
      nsm: [],
      areaManager: [],
      manager: [],
      employee: [],
      specialty: [],
      class: [],
      status: [],
      experience: [],
      type: [],
      title: [],
    },
  },

  // ---------------------------------------------------------------------
  // Tables
  // ---------------------------------------------------------------------
  tables: {
    rowsPerPage: 15,
    rowsPerPageOptions: [10, 15, 25, 50, 100],
  },

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------
  export: {
    pdfFileName: "Zeta-Commercial-Excellence-Dashboard.pdf",
    excelFileNamePrefix: "Coverage-Table-Export",
    pngFileNamePrefix: "Coverage-Chart",
  },

  // ---------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------
  formats: {
    numberLocale: "en-US",
  },

  // ---------------------------------------------------------------------
  // Debug / performance instrumentation. Off by default -- flip to true
  // (or run `CONFIG.__setDebug(true)` isn't available since CONFIG is
  // frozen; edit this value directly) to log Analytics.run() timing to
  // the console on every filter change. Kept as a single flag here
  // rather than scattered console.log calls so it's trivial to find and
  // strip for a "quiet" build.
  // ---------------------------------------------------------------------
  debug: false,
};

// Freeze so accidental runtime mutation (e.g. a bug in one module) can't
// silently change configuration read by every other module.
Object.freeze(CONFIG);
Object.freeze(CONFIG.theme.colors);
Object.freeze(CONFIG.chartColors);
Object.freeze(CONFIG.kpiCards);
Object.freeze(CONFIG.filters.fields);
Object.freeze(CONFIG.filters.defaults);
