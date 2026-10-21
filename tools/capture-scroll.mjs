/**
 * Captures the same page at several scroll positions, proving the fixed
 * background video is visible everywhere and not just in the hero.
 *
 * Usage: node tools/capture-scroll.mjs [baseUrl] [outDir] [width] [height]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CDP = "http://127.0.0.1:9222";
const BASE = process.argv[2] ?? "http://127.0.0.1:8099";
const OUT_DIR = process.argv[3] ?? "_shots";
const WIDTH = Number(process.argv[4] ?? 1280);
const HEIGHT = Number(process.argv[5] ?? 800);

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
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: WIDTH < 600,
});
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
});
await send("Emulation.setScrollbarsHidden", { hidden: true });

const shoot = async (path) => {
  // No clip: a clip rectangle is interpreted in document coordinates, which
  // returns blank space for anything below the current viewport. Capturing the
  // viewport itself is what we actually want to review.
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await writeFile(path, Buffer.from(shot.data, "base64"));
  console.log(`  ${path}`);
};

for (const [slug, url] of [
  ["home", "/"],
  ["projects", "/projects"],
  ["uses", "/uses"],
]) {
  await send("Page.navigate", { url: `${BASE}${url}?_=${Date.now()}` });
  await new Promise((resolve) => setTimeout(resolve, 7000));

  const live = await evaluate(
    `document.querySelector('.site-bg').classList.contains('site-bg--live')`,
  );
  console.log(`${slug}: video live = ${live}`);

  const height = await evaluate("document.documentElement.scrollHeight");
  const stops = [0, Math.round((height - HEIGHT) / 2), Math.max(0, height - HEIGHT)];

  for (const [index, y] of stops.entries()) {
    await evaluate(`window.scrollTo(0, ${y})`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    await shoot(join(OUT_DIR, `${slug}-scroll-${index}.png`));
  }
}

ws.close();
process.exit(0);
