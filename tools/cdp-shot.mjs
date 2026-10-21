/**
 * Capture a full-page screenshot at an exact viewport size via the DevTools
 * Protocol. `chrome --headless --window-size` includes browser chrome in the
 * window box, which makes the captured image narrower than the real viewport
 * and produces misleading "clipped" screenshots; this does not.
 *
 * Usage: node tools/cdp-shot.mjs <url> <width> <outfile> [height]
 */

import { writeFile } from "node:fs/promises";

const CDP = "http://127.0.0.1:9222";
const URL_ARG = process.argv[2] ?? "http://127.0.0.1:8099/";
const WIDTH = Number(process.argv[3] ?? 1280);
const OUT = process.argv[4] ?? "_shots/shot.png";
const HEIGHT = Number(process.argv[5] ?? 900);

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

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: WIDTH < 600,
});
await send("Emulation.setScrollbarsHidden", { hidden: true });
await send("Page.navigate", { url: URL_ARG });
await new Promise((resolve) => setTimeout(resolve, 2500));

// Full-page height.
const { result } = await send("Runtime.evaluate", {
  expression: "Math.min(document.documentElement.scrollHeight, 6000)",
  returnByValue: true,
});
const fullHeight = result.value;

const shot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: WIDTH, height: fullHeight, scale: 1 },
});

await writeFile(OUT, Buffer.from(shot.data, "base64"));
console.log(`${OUT}  ${WIDTH}x${fullHeight}`);

ws.close();
process.exit(0);
