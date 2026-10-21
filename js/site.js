/**
 * DeLaViaTH — shared site script.
 *
 * Replaces the old js/navbar.js approach, which injected the whole navbar with
 * `innerHTML` from an inline <script> *before* Bootstrap had loaded, used
 * hard-coded `../index.html` links (which only worked thanks to Cloudflare's
 * SPA fallback) and marked every page as "active".
 *
 * This version:
 *  - fetches the partials so navigation lives in exactly one file
 *  - marks the current page with aria-current="page"
 *  - handles the mobile menu with proper aria state and Escape-to-close
 *  - degrades gracefully if fetch fails (e.g. opened via file://)
 */

const PARTIALS = [
  "/_partials/background.html",
  "/_partials/navbar.html",
  "/_partials/footer.html",
];

/** Normalises "/projects.html", "/projects", "/projects/" and "" to one key. */
function currentPath() {
  let path = window.location.pathname.replace(/index\.html$/, "");
  path = path.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/** Resolves a partial URL that also works when served from a subdirectory. */
function partialUrl(url) {
  if (window.location.protocol === "file:") {
    return new URL("." + url, window.location.href).href;
  }
  return url;
}

async function loadPartial(target, url) {
  const response = await fetch(partialUrl(url), { credentials: "same-origin" });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  target.innerHTML = await response.text();
}

/** Marks the link for the current URL. Safe to call on every page change. */
function updateActiveLinks(root) {
  const path = currentPath();

  root.querySelectorAll(".nav-links a[data-path]").forEach((link) => {
    const target = link.dataset.path;
    const isActive = target === "/" ? path === "/" : path === target || path.startsWith(target + "/");
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function initNavState(root) {
  updateActiveLinks(root);

  // The router swaps <main> without reloading, so this runs once per document.
  if (root.dataset.navBound === "true") return;
  root.dataset.navBound = "true";

  // Mobile menu.
  const toggle = root.querySelector(".nav-toggle");
  const links = root.querySelector(".nav-links");
  if (!toggle || !links) return;

  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    links.dataset.open = String(open);
  };

  setOpen(false);

  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  links.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (toggle.getAttribute("aria-expanded") !== "true") return;
    if (root.contains(event.target)) return;
    setOpen(false);
  });

  // Drop a solid border on the nav once the page has scrolled.
  const nav = document.getElementById("site-nav");
  if (nav) {
    const onScroll = () => {
      nav.dataset.scrolled = String(window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }
}

function initYear(root) {
  const year = new Date().getFullYear();
  root.querySelectorAll("[data-year]").forEach((node) => {
    node.textContent = String(year);
  });
}

function initVideo() {
  // Hook for any future decorative media: mark it data-decorative and it will be
  // dropped for visitors who asked for reduced motion or are on a metered
  // connection. The site-wide background video is deliberately NOT marked,
  // because it autoplays by design and carries its own pause control
  // (js/background-video.js).
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = navigator.connection?.saveData === true;
  if (!reduceMotion && !saveData) return;

  document.querySelectorAll("[data-decorative]").forEach((node) => {
    node.remove();
  });
}

async function init() {
  initVideo();

  const backgroundTarget = document.getElementById("background-container");
  const navbarTarget = document.getElementById("navbar-container");
  const footerTarget = document.getElementById("footer-container");

  // Background first: it is a fixed layer, and loading it early avoids the page
  // flashing flat-colour before the video arrives. The partial arrives after
  // js/background-video.js has already run, so announce it explicitly.
  try {
    if (backgroundTarget) {
      await loadPartial(backgroundTarget, PARTIALS[0]);
      document.dispatchEvent(new CustomEvent("site:background-ready"));
    }
  } catch (error) {
    console.error("[site] could not load background:", error);
  }

  // Then the nav, so the page never renders without primary navigation.
  try {
    if (navbarTarget) {
      await loadPartial(navbarTarget, PARTIALS[1]);
      initNavState(navbarTarget);
    }
  } catch (error) {
    console.error("[site] could not load navbar:", error);
  }

  try {
    if (footerTarget) {
      await loadPartial(footerTarget, PARTIALS[2]);
      initYear(footerTarget);
    }
  } catch (error) {
    console.error("[site] could not load footer:", error);
  }

  // Client-side navigation replaces <main> but not the nav, so the active link
  // has to be recomputed and the mobile menu closed after each swap.
  document.addEventListener("site:page-loaded", () => {
    if (!navbarTarget) return;
    updateActiveLinks(navbarTarget);
    navbarTarget.querySelector(".nav-links")?.setAttribute("data-open", "false");
    navbarTarget.querySelector(".nav-toggle")?.setAttribute("aria-expanded", "false");
    document.getElementById("site-nav")?.scrollIntoView({ block: "nearest" });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
