/**
 * tables.js
 * =========
 * A single reusable, generic table component used for every table on the
 * dashboard (Team Comparison, Manager Ranking, Area Manager Ranking,
 * Leaderboards, Attrition/Vacancy detail). Handles sorting, search,
 * sticky header (CSS-driven), and pagination. Per-table UI state (sort
 * column/direction, search term, current page) is remembered across
 * re-renders within the session, keyed by table id, so re-filtering the
 * dashboard doesn't reset what the user was looking at.
 */

const Tables = (() => {
  const stateByTableId = new Map();

  function getState(id, columns) {
    if (!stateByTableId.has(id)) {
      stateByTableId.set(id, {
        sortKey: columns.find((c) => c.defaultSort)?.key || columns[0]?.key || null,
        sortDir: columns.find((c) => c.defaultSort)?.defaultSort === "asc" ? "asc" : "desc",
        search: "",
        page: 1,
      });
    }
    return stateByTableId.get(id);
  }

  function applySearch(rows, columns, term) {
    if (!term) return rows;
    const needle = term.toLowerCase();
    const searchableKeys = columns.filter((c) => c.searchable !== false).map((c) => c.key);
    return rows.filter((row) =>
      searchableKeys.some((key) => String(row[key] ?? "").toLowerCase().includes(needle))
    );
  }

  function applySort(rows, key, dir) {
    if (!key) return rows;
    const sorted = [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    });
    return dir === "desc" ? sorted.reverse() : sorted;
  }

  /**
   * Render a table into containerEl.
   * config: {
   *   id, columns: [{key,label,format,sortable,searchable,align}],
   *   rows, pageSize, emptyMessage, exportFileName
   * }
   */
  function render(containerEl, config) {
    const { id, columns, rows } = config;
    const pageSize = config.pageSize || CONFIG.tables.rowsPerPage;
    const state = getState(id, columns);

    if (UI.isEmpty(rows)) {
      containerEl.innerHTML = UI.emptyState(config.emptyMessage);
      return;
    }

    const searched = applySearch(rows, columns, state.search);
    const sorted = applySort(searched, state.sortKey, state.sortDir);
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    state.page = Math.min(state.page, totalPages);
    const pageRows = sorted.slice((state.page - 1) * pageSize, state.page * pageSize);

    containerEl.innerHTML = `
      <div class="table-toolbar">
        <input type="search" class="table-search" placeholder="Search..." value="${UI.escapeHtml(state.search)}" aria-label="Search ${UI.escapeHtml(config.id)}" />
        <button type="button" class="table-export-btn" title="Export current filtered table to Excel">Export to Excel</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          ${columns.some((c) => c.width) ? `<colgroup>${columns.map((c) => `<col style="width:${c.width || "auto"}">`).join("")}</colgroup>` : ""}
          <thead>
            <tr>
              ${columns.map((c) => `
                <th data-key="${c.key}" class="${c.sortable === false ? "" : "sortable"} ${state.sortKey === c.key ? "sorted-" + state.sortDir : ""}" style="text-align:${c.align || "left"}">
                  ${UI.escapeHtml(c.label)}
                  ${c.sortable === false ? "" : '<span class="sort-arrow"></span>'}
                </th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${pageRows.map((row) => `
              <tr>
                ${columns.map((c) => {
                  const raw = c.render ? c.render(row) : UI.escapeHtml(Utils.formatByType(row[c.key], c.format));
                  const tipVal = c.titleKey ? row[c.titleKey] : (!c.render ? row[c.key] : null);
                  const tip = tipVal != null ? UI.escapeHtml(String(tipVal)) : "";
                  return `<td style="text-align:${c.align || "left"}"${tip ? ` title="${tip}"` : ""}>${raw}</td>`;
                }).join("")}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="table-pagination">
        <span class="pagination-info">${sorted.length} row${sorted.length === 1 ? "" : "s"} &middot; page ${state.page} of ${totalPages}</span>
        <div class="pagination-controls">
          <button type="button" class="page-prev" ${state.page <= 1 ? "disabled" : ""}>&larr; Prev</button>
          <button type="button" class="page-next" ${state.page >= totalPages ? "disabled" : ""}>Next &rarr;</button>
        </div>
      </div>`;

    wireEvents(containerEl, config, state);
  }

  function wireEvents(containerEl, config, state) {
    const searchInput = containerEl.querySelector(".table-search");
    if (searchInput) {
      searchInput.addEventListener("input", Utils.debounce((e) => {
        state.search = e.target.value;
        state.page = 1;
        render(containerEl, config);
        // preserve focus/caret across the re-render triggered by typing
        const newInput = containerEl.querySelector(".table-search");
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(newInput.value.length, newInput.value.length);
        }
      }, 200));
    }

    containerEl.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = "desc";
        }
        render(containerEl, config);
      });
    });

    const prevBtn = containerEl.querySelector(".page-prev");
    const nextBtn = containerEl.querySelector(".page-next");
    if (prevBtn) prevBtn.addEventListener("click", () => { state.page -= 1; render(containerEl, config); });
    if (nextBtn) nextBtn.addEventListener("click", () => { state.page += 1; render(containerEl, config); });

    const exportBtn = containerEl.querySelector(".table-export-btn");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        if (typeof Exporter !== "undefined") {
          const searched = applySearch(config.rows, config.columns, state.search);
          const sorted = applySort(searched, state.sortKey, state.sortDir);
          // exportFileName (set by app.js) already encodes the active
          // GLOBAL filters. A table's own in-table search box narrows
          // the row set further but independently of those filters --
          // without also encoding it here, searching "CVM" then
          // exporting, and exporting again after clearing the search,
          // would both produce the exact same filename despite holding
          // different row sets, silently overwriting one export with
          // the other.
          const searchSuffix = state.search ? `_search-${Exporter.sanitize(state.search)}` : "";
          Exporter.tableToExcel(config.columns, sorted, `${config.exportFileName || config.id}${searchSuffix}`);
        }
      });
    }
  }

  return { render };
})();
