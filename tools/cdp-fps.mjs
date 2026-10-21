/**
 * Measures rendering smoothness while the background video plays.
 *
 * requestAnimationFrame cadence is a good proxy for jank: when the compositor is
 * starved (expensive filters, oversized layers, too many animated layers) the
 * callbacks arrive late or bunch up. Also reports the iframe's box size, since
 * rasterising more pixels than the viewport is the usual culprit.
 *
 * Usage: node tools/cdp-fps.mjs [baseUrl] [seconds]
 */

const CDP = "http://127.0.0.1:9222";
const BASE = process.argv[2] ?? "http://127.0.0.1:8099";
const SECONDS = Number(process.argv[3] ?? 4);

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
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
});

await send("Page.navigate", { url: `${BASE}/?_=${Date.now()}` });
await new Promise((resolve) => setTimeout(resolve, 7000));

const geometry = await evaluate(`(() => {
  const iframe = document.getElementById('site-bg-video');
  const r = iframe.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const cs = getComputedStyle(iframe);
  return {
    iframeBox: Math.round(r.width) + 'x' + Math.round(r.height),
    viewport: vw + 'x' + vh,
    pixelRatio: ((r.width * r.height) / (vw * vh)).toFixed(2),
    filter: cs.filter,
    opacity: cs.opacity,
    animatedLayers: document.getAnimations().length,
    live: document.querySelector('.site-bg').classList.contains('site-bg--live'),
  };
})()`);

const fps = await evaluate(`(async () => {
  const frames = [];
  let last = performance.now();
  const end = last + ${SECONDS * 1000};

  await new Promise((resolve) => {
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });

  const deltas = frames.slice(1);
  const total = deltas.reduce((a, b) => a + b, 0);
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;

  return {
    frames: deltas.length,
    fps: +(deltas.length / (total / 1000)).toFixed(1),
    avgFrameMs: +(total / deltas.length).toFixed(2),
    p95FrameMs: +at(0.95).toFixed(2),
    worstFrameMs: +Math.max(...deltas).toFixed(2),
    longFrames: deltas.filter((d) => d > 33).length,
  };
})()`);

console.log("geometry:");
console.log(JSON.stringify(geometry, null, 2));
console.log("\nframe timing over " + SECONDS + "s:");
console.log(JSON.stringify(fps, null, 2));

// Rough verdict: at 60 Hz a healthy page averages ~16.7 ms with few long frames.
const healthy = fps.avgFrameMs < 20 && fps.longFrames < fps.frames * 0.1;
console.log(`\n${healthy ? "SMOOTH" : "JANKY"}: avg ${fps.avgFrameMs} ms, ${fps.longFrames} long frames`);

ws.close();
process.exit(healthy ? 0 : 1);
