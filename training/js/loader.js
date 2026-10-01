/**
 * loader.js
 * =========
 * Controls the full-screen loading overlay used both while the dashboard
 * boots (reading cache, building the UI) and -- in spirit -- while a
 * refresh is processing (refresh.py prints its own progress to the
 * console/log since it runs before Chrome ever opens; this overlay
 * covers the in-browser equivalent: reading cache, building
 * aggregations client-side, rendering).
 *
 * Pure DOM/timer logic, no data knowledge -- keeps it reusable from any
 * future entry point.
 */

const Loader = (() => {
  let overlayEl = null;
  let textEl = null;

  function init() {
    overlayEl = document.getElementById("loading-overlay");
    textEl = document.getElementById("loading-text");
  }

  /** Update the message shown under the spinner. */
  function setMessage(message) {
    if (textEl) textEl.textContent = message;
  }

  function show(message) {
    if (message) setMessage(message);
    if (overlayEl) overlayEl.classList.remove("hidden");
  }

  function hide() {
    if (overlayEl) overlayEl.classList.add("hidden");
  }

  return { init, setMessage, show, hide };
})();
