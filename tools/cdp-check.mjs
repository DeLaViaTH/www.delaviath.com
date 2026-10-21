/**
 * Minimal Chrome DevTools Protocol driver (no dependencies).
 *
 * Usage: node tools/cdp-check.mjs <url>
 *
 * Prints console messages, page errors, failed requests and a layout report for
 * overflow / stray-text problems, then exits.
 */

import { writeFile } from "node:fs/promises";

const URL_ARG = process.argv[2] ?? "http://127.0.0.1:8099/";
const CDP = "http://127.0.0.1:9222";

async function connect() {
  const targets = await (await fetch(`${CDP}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const listeners = [];

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    listeners.forEach((fn) => fn(msg));
  });

  const send = (method, params = {}) => {
    const messageId = ++id;
    ws.send(JSON.stringify({ id: messageId, method, params }));
    return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
  };

  return { ws, send, on: (fn) => listeners.push(fn) };
}

const { ws, send, on } = await connect();

const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];

on((msg) => {
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = msg.params.args
      .map((a) => a.value ?? a.description ?? a.type)
      .join(" ");
    consoleMessages.push(`[${msg.params.type}] ${text}`);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    pageErrors.push(d.exception?.description ?? d.text);
  }
  if (msg.method === "Network.loadingFailed") {
    failedRequests.push(`${msg.params.type} ${msg.params.errorText} (blocked=${msg.params.blockedReason ?? "-"})`);
  }
  if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) {
    failedRequests.push(`${msg.params.response.status} ${msg.params.response.url}`);
  }
});

await send("Runtime.enable");
await send("Network.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

await send("Page.navigate", { url: URL_ARG });
await new Promise((resolve) => setTimeout(resolve, 2500));

const expression = String.raw`(() => {
  const report = {};

  // 1. Anything rendered outside a container.
  report.bodyChildren = Array.from(document.body.children).map((el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    cls: el.className || undefined,
    text: (el.children.length === 0 ? el.textContent.trim().slice(0, 80) : undefined),
  }));

  // 2. Any bare text node directly in <body>.
  report.strayBodyText = Array.from(document.body.childNodes)
    .filter((n) => n.nodeType === 3 && n.textContent.trim())
    .map((n) => n.textContent.trim().slice(0, 120));

  // 3. Elements wider than the viewport.
  const vw = document.documentElement.clientWidth;
  report.viewportWidth = vw;
  report.overflowing = Array.from(document.querySelectorAll('body *'))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 1 || r.left < -1);
    })
    .slice(0, 12)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0, 40), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    });

  // 4. Section widths vs their parent container.
  report.containers = Array.from(document.querySelectorAll('main > *, .container, .hero__inner'))
    .slice(0, 10)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: (el.className || el.tagName).toString().slice(0, 40), left: Math.round(r.left), width: Math.round(r.width) };
    });

  // 5. Did the partials load?
  report.navLoaded = !!document.querySelector('.site-nav');
  report.footerLoaded = !!document.querySelector('.site-footer');
  report.activeNav = document.querySelector('.nav-links a[aria-current="page"]')?.textContent.trim() ?? null;

  return report;
})()`;

const { result } = await send("Runtime.evaluate", { expression, returnByValue: true });

console.log("URL: " + URL_ARG);
console.log("\n--- console ---");
console.log(consoleMessages.length ? consoleMessages.join("\n") : "(clean)");
console.log("\n--- page errors ---");
console.log(pageErrors.length ? pageErrors.join("\n") : "(none)");
console.log("\n--- failed requests ---");
console.log(failedRequests.length ? failedRequests.join("\n") : "(none)");
console.log("\n--- layout ---");
console.log(JSON.stringify(result.value, null, 2));

ws.close();
process.exit(0);
