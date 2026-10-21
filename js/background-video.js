/**
 * Site-wide background video.
 *
 * The video is a fixed layer behind every page (see _partials/background.html),
 * so it stays visible at any scroll position. This module handles the parts the
 * raw YouTube embed cannot do alone:
 *
 *   1. holds back the fade-in until the player reports it is actually playing,
 *      so a blocked embed falls back to the CSS gradient instead of a black box
 *   2. drives the pause/play toggle through the player's postMessage API
 *   3. keeps the button's icon, label and aria-pressed state in sync
 *
 * Timing note: the background markup arrives from a partial that js/site.js
 * fetches asynchronously, which usually resolves AFTER this deferred script has
 * run. Binding on DOMContentLoaded alone would therefore find nothing and the
 * toggle would be dead. site.js dispatches `site:background-ready` once the
 * partial is in the DOM; we bind then, and also try immediately in case the
 * markup was already inline.
 */

/** Origins allowed to post player state back to us. */
const YT_ORIGINS = new Set([
  "https://www.youtube-nocookie.com",
  "https://www.youtube.com",
]);

/** Player states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
const PLAYING_STATES = new Set([1, 3]);

const STORAGE_KEY = "delaviath:bg-video";

function initBackgroundVideo() {
  const layer = document.querySelector(".site-bg");
  if (!layer || layer.dataset.bound === "true") return;

  const iframe = document.getElementById("site-bg-video");
  const toggle = document.getElementById("site-bg-toggle");
  if (!iframe || !toggle) return;

  layer.dataset.bound = "true";

  let isPlaying = true;
  let playerReady = false;

  const post = (payload) => {
    iframe.contentWindow?.postMessage(JSON.stringify(payload), "*");
  };

  const command = (func) => post({ event: "command", func, args: "" });

  const setLive = (live) => layer.classList.toggle("site-bg--live", live);

  const setPlaying = (playing) => {
    isPlaying = playing;
    toggle.setAttribute("aria-pressed", String(playing));

    const text = playing ? "Pause background" : "Play background";
    const label = toggle.querySelector(".site-bg__toggle-label");
    if (label) label.textContent = text;

    // The button is icon-only on screen, so the title doubles as the hover hint.
    toggle.title = text;

    // Stay visible either way; while paused the frame holds its last image.
    setLive(true);
  };

  // --- player state -------------------------------------------------------
  window.addEventListener("message", (event) => {
    if (!YT_ORIGINS.has(event.origin)) return;

    let data;
    try {
      data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;

    const state = data?.info?.playerState ?? data?.infoDelivery?.playerState;
    if (typeof state !== "number") return;

    playerReady = true;
    if (PLAYING_STATES.has(state)) setPlaying(true);
    else if (state === 2 || state === 0) setPlaying(false);
  });

  // --- toggle -------------------------------------------------------------
  toggle.addEventListener("click", () => {
    if (isPlaying) command("pauseVideo");
    else command("playVideo");

    setPlaying(!isPlaying);

    try {
      sessionStorage.setItem(STORAGE_KEY, isPlaying ? "on" : "off");
    } catch {
      /* private mode */
    }
  });

  // --- startup ------------------------------------------------------------
  const subscribe = () => {
    post({ event: "listening", id: "delaviath-bg", channel: "widget" });
    post({ event: "command", func: "setLoop", args: [1] });
    post({ event: "command", func: "mute" });
  };

  iframe.addEventListener("load", () => {
    subscribe();
    setTimeout(subscribe, 1200);
    setTimeout(subscribe, 3000);
  });

  // If the player never reports state (older browser, blocked messages), show
  // the frame anyway once it has had a fair chance to start.
  setTimeout(() => {
    if (!playerReady) setLive(true);
  }, 6000);

  // Restore a paused preference from earlier in the visit, otherwise show it.
  let pausedBefore = false;
  try {
    pausedBefore = sessionStorage.getItem(STORAGE_KEY) === "off";
  } catch {
    /* ignore */
  }

  if (pausedBefore) {
    command("pauseVideo");
    setPlaying(false);
  } else {
    setPlaying(true);
  }
}

document.addEventListener("site:background-ready", initBackgroundVideo);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBackgroundVideo, { once: true });
} else {
  initBackgroundVideo();
}
