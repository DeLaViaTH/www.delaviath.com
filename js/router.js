/**
 * Client-side navigation.
 *
 * Why this exists: the site is statically generated, so every link used to be a
 * full document load. That tore down the fixed background video's <iframe> and
 * restarted the clip from 0:00 on every page change. Swapping only <main> keeps
 * the document — and therefore the iframe, its buffer and its play position —
 * alive, so the video plays continuously as you browse.
 *
 * What it does:
 *   - intercepts same-origin link clicks (never modifier-clicks, new tabs or
 *     external links)
 *   - fetches the target HTML, swaps <main>, and syncs <title> plus the
 *     description / canonical / Open Graph tags
 *   - updates the URL with pushState and restores scroll on back/forward
 *   - announces the new page to assistive tech and moves focus to the heading
 *   - prefetches on hover so the swap usually happens instantly
 *
 * Without JavaScript every link is a normal link, so nothing breaks.
 */

const PAGE_EVENT = "site:page-loaded";
const CACHE_LIMIT = 8;

/** href -> html, bounded so a long session cannot grow without limit. */
const cache = new Map();

function isSameOrigin(url) {
  return url.origin === window.location.origin;
}

function shouldIntercept(link, event) {
  if (!link) return false;
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

  // Explicit opt-outs and things the browser must handle itself.
  if (link.dataset.noRouter !== undefined) return false;
  if (link.target && link.target !== "_self") return false;
  if (link.hasAttribute("download")) return false;

  const href = link.getAttribute("href");
  if (!href || href.startsWith("#")) return false;
  if (/^(mailto|tel|javascript):/i.test(href)) return false;

  const url = new URL(link.href, window.location.href);
  if (!isSameOrigin(url)) return false;

  // Same page (ignoring hash) — let the browser scroll instead.
  if (url.pathname === window.location.pathname && url.search === window.location.search) return false;

  return true;
}

async function fetchPage(path) {
  const key = path;

  if (cache.has(key)) {
    const cached = cache.get(key);
    // Refresh recency.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const response = await fetch(key, {
    headers: { Accept: "text/html" },
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);

  const html = await response.text();
  cache.set(key, html);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return html;
}

/** Reads the tags that must change per page out of a parsed document. */
function extractMeta(doc) {
  const pick = (selector, attr = "content") => doc.querySelector(selector)?.getAttribute(attr) ?? null;

  return {
    title: doc.querySelector("title")?.textContent?.trim() ?? "",
    description: pick('meta[name="description"]'),
    canonical: pick('link[rel="canonical"]', "href"),
    ogTitle: pick('meta[property="og:title"]'),
    ogDescription: pick('meta[property="og:description"]'),
    ogUrl: pick('meta[property="og:url"]'),
    bodyClass: doc.body?.className ?? "",
  };
}

function applyMeta(meta) {
  if (meta.title) document.title = meta.title;

  const setMeta = (selector, value) => {
    if (value === null) return;
    const el = document.head.querySelector(selector);
    if (el) el.setAttribute("content", value);
  };

  setMeta('meta[name="description"]', meta.description);
  setMeta('meta[property="og:title"]', meta.ogTitle);
  setMeta('meta[property="og:description"]', meta.ogDescription);
  setMeta('meta[property="og:url"]', meta.ogUrl);

  if (meta.canonical) {
    const link = document.head.querySelector('link[rel="canonical"]');
    if (link) link.setAttribute("href", meta.canonical);
  }

  if (meta.bodyClass !== null) document.body.className = meta.bodyClass;
}

function announce() {
  const heading = document.querySelector("#main h1");
  if (!heading) return;

  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}

async function render(path, { push = true, restoreScroll = 0 } = {}) {
  const currentMain = document.getElementById("main");
  if (!currentMain) {
    window.location.href = path;
    return;
  }

  currentMain.setAttribute("aria-busy", "true");
  document.documentElement.dataset.navigating = "true";

  try {
    const html = await fetchPage(path);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const incoming = doc.getElementById("main");
    if (!incoming) throw new Error("target page has no #main");

    // Replace the element, not just its children: each page's <main> carries its
    // own attributes (notably class="container" on the inner pages). Swapping
    // only the children left the old attribute set in place and the new page
    // rendered full-bleed.
    const nextMain = document.adoptNode(incoming);
    nextMain.removeAttribute("aria-busy");
    currentMain.replaceWith(nextMain);

    applyMeta(extractMeta(doc));

    if (push) {
      history.pushState({ path, scrollY: 0 }, "", path);
    }

    window.scrollTo({ top: restoreScroll, behavior: "instant" });

    // Let the nav highlight + page-specific widgets re-initialise.
    document.dispatchEvent(new CustomEvent(PAGE_EVENT, { detail: { path } }));

    announce();
  } catch (error) {
    // Any failure: fall back to a real navigation rather than a dead click.
    console.error("[router] falling back to a full load:", error);
    window.location.href = path;
  } finally {
    delete document.documentElement.dataset.navigating;
  }
}

function prefetch(link) {
  const url = new URL(link.href, window.location.href);
  if (!isSameOrigin(url)) return;
  if (cache.has(url.pathname)) return;

  // Fire and forget; ignore failures.
  fetchPage(url.pathname).catch(() => {});
}

function init() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a");
    if (!shouldIntercept(link, event)) return;

    event.preventDefault();
    render(new URL(link.href, window.location.href).pathname);
  });

  // Prefetch on intent, not on load: hovering or touching a link is a strong
  // signal that the visitor is about to go there.
  const intent = (event) => {
    const link = event.target.closest?.("a");
    if (!link) return;
    if (!shouldIntercept(link, { defaultPrevented: false, button: 0 })) return;
    prefetch(link);
  };

  document.addEventListener("mouseover", intent, { passive: true });
  document.addEventListener("touchstart", intent, { passive: true });
  document.addEventListener("focusin", intent);

  window.addEventListener("popstate", (event) => {
    const path = event.state?.path ?? window.location.pathname;
    render(path, { push: false, restoreScroll: event.state?.scrollY ?? 0 });
  });

  // Remember the scroll offset so back/forward returns to the right spot.
  window.addEventListener("scroll", () => {
    if (history.state) history.state.scrollY = window.scrollY;
  }, { passive: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
