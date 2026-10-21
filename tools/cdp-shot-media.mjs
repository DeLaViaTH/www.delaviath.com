/**
 * Screenshot with an explicit prefers-reduced-motion setting, cache disabled.
 *
 * The plain screenshot helper inherits whatever media emulation the browser
 * session was left in, which silently hides the hero play prompt when a previous
 * test set "reduce". This pins the setting so captures are reproducible.
 *
 * Usage: node tools/cdp-shot-media.mjs <url> <width> <outfile> <motion> [height]
 *        motion = no-preference | reduce
 */

import { writeFile } from "node:fs/promises";

const CDP = "http://127.0.0.1:9222";
const URL_ARG = process.argv[2] ?? "http://127.0.0.1:8099/";
const WIDTH = Number(process.argv[3] ?? 1280);
const OUT = process.argv[4] ?? "_shots/media.png";
const MOTION = process.argv[5] ?? "no-preference";
const HEIGHT = Number(process.argv[6] ?? 900);

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
  const { result } = await send("Runtime.evaluate", { expression, returnByValue: true });
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
  features: [{ name: "prefers-reduced-motion", value: MOTION }],
});
await send("Emulation.setScrollbarsHidden", { hidden: true });

await send("Page.navigate", { url: `${URL_ARG}?_=${Date.now()}` });
await new Promise((resolve) => setTimeout(resolve, 800));
await evaluate("sessionStorage.clear()");
await send("Page.reload", { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 3000));

const info = await evaluate(`(() => {
  const poster = document.getElementById('hero-poster');
  const play = document.querySelector('.hero__play');
  const pr = poster ? poster.getBoundingClientRect() : null;
  const br = play ? play.getBoundingClientRect() : null;
  return {
    posterDisplay: poster ? getComputedStyle(poster).display : null,
    posterSize: pr ? Math.round(pr.width) + 'x' + Math.round(pr.height) : null,
    playButton: br ? { w: Math.round(br.width), h: Math.round(br.height) } : null,
  };
})()`);
console.log(`motion=${MOTION}`, JSON.stringify(info));

const height = await evaluate("Math.min(document.documentElement.scrollHeight, 6000)");
const shot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: WIDTH, height, scale: 1 },
});
await writeFile(OUT, Buffer.from(shot.data, "base64"));
console.log(`${OUT}  ${WIDTH}x${height}`);

ws.close();
process.exit(0);
