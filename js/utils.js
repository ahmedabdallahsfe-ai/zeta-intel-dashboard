/**
 * utils.js
 * ========
 * Small, pure, dependency-free helper functions shared across modules.
 * Nothing in here touches the DOM or the cache directly -- keeps this
 * file trivially unit-testable and reusable from any other module.
 */

const Utils = {
  /** Format a number with thousands separators. */
  formatNumber(value, locale = CONFIG.formats.numberLocale) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
    return Number(value).toLocaleString(locale);
  },

  /** Format a 0-1 fraction as a percentage with 1 decimal place. */
  formatPercent1(value, locale = CONFIG.formats.numberLocale) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
    return `${(Number(value) * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  },

  /** Format a number with 1 decimal place (no percent sign). */
  formatDecimal1(value, locale = CONFIG.formats.numberLocale) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
    return Number(value).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  },

  /** Format a plain text value; "-" for null/undefined/empty, matching
   * the finance-sheet convention of never rendering a blank cell. */
  formatText(value) {
    if (value === null || value === undefined || value === "") return "-";
    return String(value);
  },

  /** Dispatch to the right formatter based on a CONFIG-declared format key.
   * Table columns for text fields (team, employee, manager, status, name)
   * intentionally omit `format` -- default MUST be text, not numeric, or
   * every non-numeric column renders literally as "NaN" (Number("CVM-I")
   * is NaN, and formatNumber's own NaN guard only catches the value NaN
   * itself, not a string that happens to coerce to NaN). */
  formatByType(value, formatKey) {
    switch (formatKey) {
      case "percent1": return Utils.formatPercent1(value);
      case "decimal1": return Utils.formatDecimal1(value);
      case "number": return Utils.formatNumber(value);
      case "text": default: return Utils.formatText(value);
    }
  },

  /** Format a period-over-period delta for a KPI card, e.g. "+2.3pts",
   * "-14", "+0.4". Percent-type deltas are already raw fractions (e.g.
   * 0.023), so they're scaled to points (pts = percentage points, not a
   * second "%" relative change) and suffixed "pts" to avoid the reader
   * misreading "+2.3%" as a relative change. Returns null (not "-") for
   * no-prior-period, so callers can distinguish "no data" from "zero
   * change" -- renderKpiCards() decides how to display each case. */
  formatDelta(value, formatKey) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
    const num = Number(value);
    switch (formatKey) {
      case "percent1": {
        const pts = num * 100;
        const rounded = Math.abs(pts) < 0.05 ? 0 : pts;
        const s = rounded === 0 ? "±0.0" : `${rounded > 0 ? "+" : ""}${rounded.toLocaleString(CONFIG.formats.numberLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
        return `${s}pts`;
      }
      case "decimal1": {
        const rounded = Math.abs(num) < 0.05 ? 0 : num;
        return rounded === 0 ? "±0.0" : `${rounded > 0 ? "+" : ""}${rounded.toLocaleString(CONFIG.formats.numberLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
      }
      case "number":
      default: {
        const rounded = Math.round(num);
        return rounded === 0 ? "±0" : `${rounded > 0 ? "+" : ""}${rounded.toLocaleString(CONFIG.formats.numberLocale)}`;
      }
    }
  },

  /** Safe getter: returns fallback instead of throwing on undefined paths. */
  get(obj, path, fallback = null) {
    return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj) ?? fallback;
  },

  /** Debounce a function (used by search inputs in Phase 3). */
  debounce(fn, waitMs = 200) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), waitMs);
    };
  },
};
