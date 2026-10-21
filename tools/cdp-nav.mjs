/**
 * Checks the mobile navigation: opens it, confirms the links are reachable, and
 * closes it with Escape.
 *
 * Usage: node tools/cdp-nav.mjs [baseUrl]
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
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: `${BASE}/` });
await new Promise((resolve) => setTimeout(resolve, 2000));

const checks = [];
const record = (name, passed, detail) => {
  checks.push({ name, passed, detail });
};

const state = () =>
  evaluate(`(() => {
    const links = document.querySelector('.nav-links');
    const toggle = document.querySelector('.nav-toggle');
    return {
      open: links?.dataset.open,
      expanded: toggle?.getAttribute('aria-expanded'),
      display: links ? getComputedStyle(links).display : null,
      linkCount: links ? links.querySelectorAll('a').length : 0,
    };
  })()`);

const before = await state();
record("menu starts closed", before.open === "false" && before.display === "none", JSON.stringify(before));

await evaluate(`document.querySelector('.nav-toggle').click()`);
await new Promise((resolve) => setTimeout(resolve, 250));
const opened = await state();
record(
  "toggle opens menu",
  opened.open === "true" && opened.expanded === "true" && opened.display !== "none",
  JSON.stringify(opened),
);
record("menu exposes 4 links", opened.linkCount === 4, `linkCount=${opened.linkCount}`);

await evaluate(
  `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
);
await new Promise((resolve) => setTimeout(resolve, 250));
const closed = await state();
record("Escape closes menu", closed.open === "false" && closed.expanded === "false", JSON.stringify(closed));

// Desktop: links must be visible.
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${BASE}/` });
await new Promise((resolve) => setTimeout(resolve, 2000));
const desktop = await evaluate(`(() => {
  const links = document.querySelector('.nav-links');
  const toggle = document.querySelector('.nav-toggle');
  return {
    display: links ? getComputedStyle(links).display : null,
    toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
    active: document.querySelector('.nav-links a[aria-current="page"]')?.textContent.trim() ?? null,
  };
})()`);
record("desktop shows nav links", desktop.display === "flex", JSON.stringify(desktop));
record("desktop hides hamburger", desktop.toggleDisplay === "none", `toggleDisplay=${desktop.toggleDisplay}`);
record("desktop marks Home active", desktop.active === "Home", `active=${desktop.active}`);

let failures = 0;
for (const check of checks) {
  if (!check.passed) failures++;
  console.log(`${check.passed ? "PASS" : "FAIL"}  ${check.name}  ${check.detail}`);
}
console.log(failures === 0 ? "\nAll navigation checks passed." : `\n${failures} failed.`);

ws.close();
process.exit(failures === 0 ? 0 : 1);
