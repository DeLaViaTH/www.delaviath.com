/**
 * A/B compares frame timing with the old (blurred, oversized) video layer versus
 * the current one, by injecting the old CSS at runtime.
 *
 * Usage: node tools/cdp-fps-ab.mjs [baseUrl] [seconds]
 */

const CDP = "http://127.0.0.1:9222";
const BASE = process.argv[2] ?? "http://127.0.0.1:8099";
const SECONDS = Number(process.argv[3] ?? 3);

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

const measure = (seconds) => evaluate(`(async () => {
  const frames = [];
  let last = performance.now();
  const end = last + ${seconds} * 1000;
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
  return {
    fps: +(deltas.length / (total / 1000)).toFixed(1),
    avgFrameMs: +(total / deltas.length).toFixed(2),
    longFrames: deltas.filter((d) => d > 33).length,
    frames: deltas.length,
  };
})()`);

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

console.log("current build:");
const now = await measure(SECONDS);
console.log(" ", JSON.stringify(now));

// Re-create the previous implementation: 120% oversized box plus a Gaussian
// blur, and the gradient animating on top of it.
await evaluate(`(() => {
  const style = document.createElement('style');
  style.id = 'ab-old-style';
  style.textContent = \`
    .site-bg__video { width: 120% !important; height: 120% !important; filter: saturate(118%) contrast(106%) blur(3px) !important; }
    .site-bg--live .site-bg__wash, .site-bg--live .site-bg__wash::after { animation: site-bg-drift 34s ease-in-out infinite alternate !important; }
  \`;
  document.head.appendChild(style);
})()`);
await new Promise((resolve) => setTimeout(resolve, 1500));

console.log("\nold build (blur + 120% + animated gradient):");
const old = await measure(SECONDS);
console.log(" ", JSON.stringify(old));

await evaluate(`document.getElementById('ab-old-style')?.remove()`);

const gain = old.avgFrameMs > 0 ? ((old.avgFrameMs - now.avgFrameMs) / old.avgFrameMs) * 100 : 0;
console.log(`\navg frame time: ${old.avgFrameMs} ms -> ${now.avgFrameMs} ms  (${gain >= 0 ? "-" : "+"}${Math.abs(gain).toFixed(1)}%)`);
console.log(`long frames:    ${old.longFrames} -> ${now.longFrames}`);

ws.close();
process.exit(0);
