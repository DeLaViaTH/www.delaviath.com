/**
 * Verifies client-side navigation keeps the background video alive.
 *
 * The whole point of the router is that the fixed <iframe> is never torn down,
 * so the clip keeps playing instead of restarting at 0:00 on every page change.
 *
 * Usage: node tools/cdp-router.mjs [baseUrl]
 */

const CDP = "http://127.0.0.1:9222";
const BASE = process.argv[2] ?? "http://127.0.0.1:8099";

const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let id = 0;
const pending = new Map();
const documentRequests = [];

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);

  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    return;
  }

  // Count top-level document navigations: a router swap must not create one.
  if (msg.method === "Network.requestWillBeSent" && msg.params.type === "Document") {
    documentRequests.push(msg.params.request.url);
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
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
});

let failures = 0;
const check = (name, passed, detail = "") => {
  if (!passed) failures++;
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

// --- load home and stamp the live iframe ----------------------------------
await send("Page.navigate", { url: `${BASE}/?_=${Date.now()}` });
await new Promise((resolve) => setTimeout(resolve, 6000));

const before = await evaluate(`(() => {
  const iframe = document.getElementById('site-bg-video');
  if (!iframe) return { missing: true };
  iframe.dataset.stamp = 'STAMP-' + Math.random().toString(36).slice(2, 8);
  window.__spaMarker = 'still-here';
  return {
    stamp: iframe.dataset.stamp,
    live: document.querySelector('.site-bg').classList.contains('site-bg--live'),
    url: location.pathname,
    title: document.title,
  };
})()`);

check("iframe present on first load", !before.missing, `stamp=${before.stamp}`);
check("video is live", before.live === true);

documentRequests.length = 0;

// --- navigate to /projects via a real link click --------------------------
const afterProjects = await evaluate(`(async () => {
  const link = document.querySelector('.nav-links a[data-path="/projects"]');
  if (!link) return { error: 'no projects link' };
  link.click();
  await new Promise((r) => setTimeout(r, 2500));
  const iframe = document.getElementById('site-bg-video');
  return {
    stamp: iframe?.dataset.stamp ?? null,
    sameElement: iframe?.dataset.stamp === '${before.stamp}',
    marker: window.__spaMarker ?? null,
    url: location.pathname,
    title: document.title,
    heading: document.querySelector('#main h1')?.textContent?.trim() ?? null,
    activeNav: document.querySelector('.nav-links a[aria-current="page"]')?.textContent?.trim() ?? null,
    iframeCount: document.querySelectorAll('.site-bg__video').length,
    filterReady: document.getElementById('project-filters')?.dataset.initialized ?? null,
  };
})()`);

check("URL changed without a reload", afterProjects.url === "/projects", `url=${afterProjects.url}`);
check("document was not reloaded", afterProjects.marker === "still-here", `marker=${afterProjects.marker}`);
check("no new Document request", documentRequests.length === 0, `${documentRequests.length} request(s)`);
check("background iframe survived", afterProjects.sameElement === true, `stamp=${afterProjects.stamp}`);
check("exactly one iframe after swap", afterProjects.iframeCount === 1, `count=${afterProjects.iframeCount}`);
check("content swapped", /projects/i.test(afterProjects.heading ?? ""), `h1=${afterProjects.heading}`);
check("title updated", /projects/i.test(afterProjects.title ?? ""), `title=${afterProjects.title}`);
check("nav highlight updated", afterProjects.activeNav === "Projects", `active=${afterProjects.activeNav}`);
check("projects filter initialised after swap", afterProjects.filterReady === "true", `flag=${afterProjects.filterReady}`);

// --- the filter must actually work after a client-side swap ---------------
const filterWorks = await evaluate(`(async () => {
  const buttons = Array.from(document.querySelectorAll('#project-filters button'));
  const iot = buttons.find((b) => b.dataset.filter === 'iot');
  iot?.click();
  await new Promise((r) => setTimeout(r, 300));
  const shown = Array.from(document.querySelectorAll('.project')).filter((c) => !c.hidden).length;
  const total = document.querySelectorAll('.project').length;
  buttons.find((b) => b.dataset.filter === 'all')?.click();
  return { shown, total };
})()`);

check("filter works after client-side nav", filterWorks.shown > 0 && filterWorks.shown < filterWorks.total, `${filterWorks.shown}/${filterWorks.total} shown`);

// --- navigate again, then go back -----------------------------------------
const backNav = await evaluate(`(async () => {
  document.querySelector('.nav-links a[data-path="/uses"]').click();
  await new Promise((r) => setTimeout(r, 2000));
  const atUses = location.pathname;
  const stampAtUses = document.getElementById('site-bg-video')?.dataset.stamp;

  history.back();
  await new Promise((r) => setTimeout(r, 2500));

  return {
    atUses,
    stampAtUses,
    backUrl: location.pathname,
    stampAfterBack: document.getElementById('site-bg-video')?.dataset.stamp,
    marker: window.__spaMarker ?? null,
    heading: document.querySelector('#main h1')?.textContent?.trim() ?? null,
  };
})()`);

check("second navigation works", backNav.atUses === "/uses", `url=${backNav.atUses}`);
check("iframe survives second navigation", backNav.stampAtUses === before.stamp);
check("back button returns to previous page", backNav.backUrl === "/projects", `url=${backNav.backUrl}`);
check("iframe survives back", backNav.stampAfterBack === before.stamp);
check("no reload on back", backNav.marker === "still-here");

// --- playback state is preserved -----------------------------------------
const playback = await evaluate(`(() => {
  const toggle = document.getElementById('site-bg-toggle');
  const layer = document.querySelector('.site-bg');
  return {
    pressed: toggle?.getAttribute('aria-pressed'),
    live: layer?.classList.contains('site-bg--live'),
  };
})()`);

check("still playing after 3 navigations", playback.pressed === "true", `aria-pressed=${playback.pressed}`);
check("still visible after 3 navigations", playback.live === true);

console.log(failures === 0 ? "\nAll router checks passed." : `\n${failures} failed.`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
