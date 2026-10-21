/**
 * Screenshots the projects page reached through the router, which is how the
 * filter bar lost its styles and rendered as a bulleted list.
 *
 * Usage: node tools/capture-router-nav.mjs [baseUrl] [outDir] [width]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CDP = "http://127.0.0.1:9222";
const BASE = process.argv[2] ?? "http://127.0.0.1:8099";
const OUT_DIR = process.argv[3] ?? "_shots";
const WIDTH = Number(process.argv[4] ?? 1280);

await mkdir(OUT_DIR, { recursive: true });

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
  const { result } = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.value;
};

await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: 900,
  deviceScaleFactor: 1,
  mobile: WIDTH < 600,
});
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
});
await send("Emulation.setScrollbarsHidden", { hidden: true });

// Land on home first, exactly like a visitor.
await send("Page.navigate", { url: `${BASE}/?_=${Date.now()}` });
await new Promise((resolve) => setTimeout(resolve, 4000));

// Then navigate with the router.
await evaluate(`document.querySelector('.nav-links a[data-path="/projects"]').click()`);
await new Promise((resolve) => setTimeout(resolve, 2500));

const shot = await send("Page.captureScreenshot", { format: "png" });
const out = join(OUT_DIR, `router-projects-${WIDTH}.png`);
await writeFile(out, Buffer.from(shot.data, "base64"));

const state = await evaluate(`(() => {
  const bar = document.getElementById('project-filters');
  const cs = bar ? getComputedStyle(bar) : null;
  return {
    url: location.pathname,
    filterDisplay: cs?.display,
    filterListStyle: cs?.listStyleType,
    stylesheets: Array.from(document.styleSheets).map((s) => s.href).filter(Boolean).map((h) => h.replace(location.origin, '')),
  };
})()`);

console.log(JSON.stringify(state, null, 2));
console.log(out);

ws.close();
process.exit(0);
