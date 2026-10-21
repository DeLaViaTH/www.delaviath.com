/**
 * Report horizontal overflow at a given viewport width.
 *
 * Usage: node tools/cdp-overflow.mjs <url> <width> [height]
 */

const CDP = "http://127.0.0.1:9222";
const URL_ARG = process.argv[2] ?? "http://127.0.0.1:8099/";
const WIDTH = Number(process.argv[3] ?? 390);
const HEIGHT = Number(process.argv[4] ?? 844);

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
  deviceScaleFactor: 2,
  mobile: true,
});
await send("Page.navigate", { url: URL_ARG });
await new Promise((resolve) => setTimeout(resolve, 2500));

const expression = String.raw`(() => {
  const vw = document.documentElement.clientWidth;
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 1.5 || r.left < -1.5) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.toString() || '').slice(0, 46),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
      });
    }
  }
  // De-duplicate by class, keeping the widest instance.
  const seen = new Map();
  for (const o of offenders) {
    const key = o.tag + '.' + o.cls;
    if (!seen.has(key) || seen.get(key).width < o.width) seen.set(key, o);
  }

  const toggle = document.querySelector('.nav-toggle');
  return {
    viewportWidth: vw,
    documentScrollWidth: document.documentElement.scrollWidth,
    overflowingElements: Array.from(seen.values()).slice(0, 15),
    navToggle: toggle ? { display: getComputedStyle(toggle).display, visible: toggle.getBoundingClientRect().width > 0 } : 'missing',
  };
})()`;

const { result, exceptionDetails } = await send("Runtime.evaluate", {
  expression,
  returnByValue: true,
});
if (exceptionDetails) console.error(exceptionDetails.exception?.description ?? exceptionDetails.text);
console.log(`URL: ${URL_ARG}  @ ${WIDTH}px`);
console.log(JSON.stringify(result.value, null, 2));

ws.close();
process.exit(0);
