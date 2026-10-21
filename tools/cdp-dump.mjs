/**
 * Dumps the live serialized DOM of the current page so stray markup is visible.
 *
 * Usage: node tools/cdp-dump.mjs <url> [outfile]
 */

import { writeFile } from "node:fs/promises";

const CDP = "http://127.0.0.1:9222";
const URL_ARG = process.argv[2] ?? "http://127.0.0.1:8099/";
const OUT = process.argv[3] ?? "_shots/dom-dump.html";

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
await send("Page.navigate", { url: URL_ARG });
await new Promise((resolve) => setTimeout(resolve, 2500));

const { result } = await send("Runtime.evaluate", {
  expression: "'<!DOCTYPE html>\\n' + document.documentElement.outerHTML",
  returnByValue: true,
});

const html = result.value;
await writeFile(OUT, html, "utf8");

console.log(`wrote ${OUT} (${html.length} chars)`);
console.log("\n--- first 400 chars ---");
console.log(html.slice(0, 400));

const lines = html.split("\n");
const suspicious = lines
  .map((line, index) => ({ line, number: index + 1 }))
  .filter(({ line }) => /\/\*|\*\//.test(line));
console.log(`\n--- lines containing /* or */ : ${suspicious.length} ---`);
suspicious.slice(0, 20).forEach(({ line, number }) => {
  console.log(`${number}: ${line.trim().slice(0, 160)}`);
});

ws.close();
process.exit(0);
