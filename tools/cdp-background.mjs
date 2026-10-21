/**
 * Verifies the site-wide background video.
 *
 * Checks that it exists on every page, that the layer is position:fixed (so it
 * does not scroll away), that it actually stays put across a scroll, and that
 * the pause toggle is present and visible everywhere.
 *
 * Usage: node tools/cdp-background.mjs [baseUrl]
 */

const CDP = "http://127.0.0.1:9222";
const BASE = process.argv[2] ?? "http://127.0.0.1:8099";
const PAGES = ["/", "/projects", "/uses", "/404.html"];

const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let id = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  }
});

const send = (method, params = {}) => {
  const messageId = ++id;
  ws.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
};

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    // The scroll/toggle probes return promises.
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");

let failures = 0;
const check = (name, passed, detail = "") => {
  if (!passed) failures++;
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
});

// --- every page has the layer ---------------------------------------------
for (const path of PAGES) {
  await send("Page.navigate", { url: `${BASE}${path}?_=${Date.now()}` });
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const info = await evaluate(`(() => {
    const layer = document.querySelector('.site-bg');
    const iframe = document.getElementById('site-bg-video');
    const toggle = document.getElementById('site-bg-toggle');
    const count = document.querySelectorAll('.site-bg').length;
    if (!layer || !iframe || !toggle) return { missing: true, count };
    const cs = getComputedStyle(layer);
    const r = layer.getBoundingClientRect();
    // clientWidth excludes the scrollbar, which is the area a fixed layer is
    // expected to cover.
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return {
      count,
      position: cs.position,
      zIndex: cs.zIndex,
      rect: Math.round(r.width) + 'x' + Math.round(r.height),
      viewport: vw + 'x' + vh,
      covers: Math.round(r.width) >= vw && Math.round(r.height) >= vh,
      hasSrc: iframe.hasAttribute('src'),
      playing: toggle.getAttribute('aria-pressed'),
      toggleFixed: getComputedStyle(toggle).position,
      toggleVisible: toggle.getBoundingClientRect().width > 0,
    };
  })()`);

  check(`${path} has exactly one background layer`, info.count === 1 && !info.missing, `count=${info.count}`);
  check(`${path} layer is fixed`, info.position === "fixed", `position=${info.position}`);
  check(`${path} layer covers the viewport`, info.covers === true, `${info.rect} vs ${info.viewport}`);
  check(`${path} iframe has src`, info.hasSrc === true);
  check(`${path} toggle is fixed and visible`, info.toggleFixed === "fixed" && info.toggleVisible, info.toggleFixed);
}

// --- the layer must not move when the page scrolls ------------------------
await send("Page.navigate", { url: `${BASE}/?_=${Date.now()}` });
await new Promise((resolve) => setTimeout(resolve, 3000));

const scrolled = await evaluate(`(async () => {
  const layer = document.querySelector('.site-bg');
  const video = document.getElementById('site-bg-video');
  const docHeight = document.documentElement.scrollHeight;
  const before = layer.getBoundingClientRect().top;
  window.scrollTo(0, Math.min(600, docHeight - window.innerHeight));
  await new Promise((r) => setTimeout(r, 400));
  const after = layer.getBoundingClientRect().top;
  const pageScrolled = window.scrollY;

  // The video box is centred and may be exactly viewport-sized or larger, so
  // "visible" means it still covers the viewport rather than a negative top.
  const vr = video.getBoundingClientRect();
  const vh = document.documentElement.clientHeight;
  const vw = document.documentElement.clientWidth;
  const covers = vr.top <= 0 && vr.top + vr.height >= vh - 1 && vr.left <= 0 && vr.left + vr.width >= vw - 1;

  window.scrollTo(0, 0);
  return { before, after, pageScrolled, videoTop: Math.round(vr.top), videoHeight: Math.round(vr.height), covers };
})()`);

check("page actually scrolled", scrolled.pageScrolled > 0, `scrollY=${scrolled.pageScrolled}`);
check("background stays pinned while scrolling", scrolled.before === scrolled.after, `${scrolled.before} -> ${scrolled.after}`);
check("video still covers the viewport after scroll", scrolled.covers === true, `top=${scrolled.videoTop} h=${scrolled.videoHeight}`);

// --- toggle still works ---------------------------------------------------
const toggled = await evaluate(`(async () => {
  const toggle = document.getElementById('site-bg-toggle');
  const read = () => ({
    pressed: toggle.getAttribute('aria-pressed'),
    label: toggle.querySelector('.site-bg__toggle-label').textContent,
    live: document.querySelector('.site-bg').classList.contains('site-bg--live'),
  });
  const start = read();
  toggle.click();
  await new Promise((r) => setTimeout(r, 700));
  const paused = read();
  toggle.click();
  await new Promise((r) => setTimeout(r, 700));
  const resumed = read();
  return { start, paused, resumed };
})()`);

check("toggle starts playing", toggled.start.pressed === "true", toggled.start.label);
check("toggle pauses", toggled.paused.pressed === "false" && /play/i.test(toggled.paused.label), toggled.paused.label);
check("frame stays visible while paused", toggled.paused.live === true);
check("toggle resumes", toggled.resumed.pressed === "true", toggled.resumed.label);

console.log(failures === 0 ? "\nAll background checks passed." : `\n${failures} failed.`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
