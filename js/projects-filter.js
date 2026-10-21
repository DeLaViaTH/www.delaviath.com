/**
 * Projects page category filter.
 *
 * All cards are present in the HTML, so the page is fully usable (and
 * crawlable) without JavaScript — this only hides and shows them.
 *
 * Lives in its own file rather than inline in projects.html because the router
 * swaps <main> without reloading the document, and scripts inserted via
 * innerHTML never execute. Re-initialisation is driven by `site:page-loaded`.
 */

function initProjectsFilter() {
  const bar = document.getElementById("project-filters");
  const grid = document.getElementById("project-grid");
  const empty = document.getElementById("no-results");

  if (!bar || !grid) return;
  // The router may call this again for the same DOM; do not stack listeners.
  if (bar.dataset.initialized === "true") return;
  bar.dataset.initialized = "true";

  const cards = Array.from(grid.querySelectorAll(".project"));

  bar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;

    const filter = button.dataset.filter;

    bar.querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b === button));
    });

    let visible = 0;
    cards.forEach((card) => {
      const tags = (card.dataset.tags || "").split(/\s+/);
      const show = filter === "all" || tags.includes(filter);
      card.hidden = !show;
      if (show) visible += 1;
    });

    if (empty) empty.hidden = visible !== 0;
  });
}

document.addEventListener("site:page-loaded", initProjectsFilter);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initProjectsFilter, { once: true });
} else {
  initProjectsFilter();
}
