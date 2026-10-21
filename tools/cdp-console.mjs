/**
 * Visits every page on a running site and reports console errors, uncaught
 * exceptions and failed network requests.
 *
 * Usage: node tools/cdp-console.mjs [baseUrl]
 */

const CDP = "http://127.0.0.1:9222";
const BASE = (process.argv[2] ?? "http://127.0.0.1:8099").replace(/\/$/, "");
const PATHS = ["/", "/projects", "/uses", "/no-such-page"];

const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let id = 0;
const pending = new Map();
let events = [];

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method) events.push(msg);
});

function send(method, params = {}) {
  const msgId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });

let failures = 0;

for (const path of PATHS) {
  events = [];
  await send("Page.navigate", { url: `${BASE}${path}?cb=${Date.now()}` });
  await sleep(2600);

  const errors = [];
  const failedRequests = [];

  for (const e of events) {
    if (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") {
      errors.push(e.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
    }
    if (e.method === "Runtime.exceptionThrown") {
      errors.push("EXCEPTION: " + (e.params.exceptionDetails?.text ?? "?"));
    }
    if (e.method === "Log.entryAdded" && e.params.entry.level === "error") {
      const text = e.params.entry.text ?? "";
      // 404s for the deliberately missing page are expected, not a defect.
      if (path === "/no-such-page" && /404|Failed to load resource/i.test(text)) continue;
      errors.push(text);
    }
    if (e.method === "Network.loadingFailed" && !e.params.canceled) {
      failedRequests.push(`${e.params.type} ${e.params.errorText}`);
    }
  }

  // Confirm the shared chrome actually mounted, which is the real proof that
  // the partial fetches succeeded (a failed fetch degrades silently).
  const probe = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      nav: !!document.querySelector('.site-nav a'),
      footer: !!document.querySelector('footer'),
      bg: !!document.querySelector('#background iframe, .background iframe, iframe')
    })`,
    returnByValue: true,
  });
  const chrome = JSON.parse(probe.result.value);

  const ok = errors.length === 0 && failedRequests.length === 0 && chrome.nav && chrome.footer && chrome.bg;
  if (!ok) failures += 1;

  console.log(
    `${ok ? "PASS" : "FAIL"}  ${path.padEnd(16)} nav=${chrome.nav} footer=${chrome.footer} bg=${chrome.bg} ` +
      `errors=${errors.length} failed=${failedRequests.length}`
  );
  for (const e of errors.slice(0, 4)) console.log(`        console: ${e}`);
  for (const f of failedRequests.slice(0, 4)) console.log(`        request: ${f}`);
}

console.log(
  failures === 0 ? "\nAll console checks passed." : `\n${failures} page(s) had problems.`
);
process.exit(failures === 0 ? 0 : 1);
