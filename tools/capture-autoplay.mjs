/**
 * Screenshots the hero after the autoplaying video has had time to start.
 *
 * Usage: node tools/capture-autoplay.mjs <outfile> [width] [height]
 */

import { writeFile } from "node:fs/promises";

const CDP = "http://127.0.0.1:9222";
const OUT = process.argv[2] ?? "_shots/hero-autoplay.png";
const WIDTH = Number(process.argv[3] ?? 1280);
const HEIGHT = Number(process.argv[4] ?? 720);
const BASE = "http://127.0.0.1:8099";

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

await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: WIDTH < 600,
});
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
});
await send("Emulation.setScrollbarsHidden", { hidden: true });

await send("Page.navigate", { url: `${BASE}/?_=${Date.now()}` });
await new Promise((resolve) => setTimeout(resolve, 9000));

const { result } = await send("Runtime.evaluate", {
  expression: `(() => {
    const iframe = document.getElementById('hero-video');
    const toggle = document.getElementById('hero-toggle');
    return {
      live: document.querySelector('.hero').classList.contains('hero--video-live'),
      opacity: getComputedStyle(iframe).opacity,
      toggle: toggle ? { label: toggle.querySelector('.hero__toggle-label')?.textContent, pressed: toggle.getAttribute('aria-pressed') } : null,
    };
  })()`,
  returnByValue: true,
});
console.log(JSON.stringify(result.value));

const shot = await send("Page.captureScreenshot", {
  format: "png",
  clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
});
await writeFile(OUT, Buffer.from(shot.data, "base64"));
console.log(`${OUT}  ${WIDTH}x${HEIGHT}`);

ws.close();
process.exit(0);
