/**
 * Checks that a client-side page swap lands the correct layout, not just the
 * correct text: the incoming <main> carries its own attributes (notably
 * class="container"), and losing them renders the page full-bleed.
 *
 * Usage: node tools/cdp-layout.mjs [baseUrl]
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
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
});

let failures = 0;
const check = (name, passed, detail = "") => {
  if (!passed) failures++;
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

const measureMain = `(() => {
  const main = document.getElementById('main');
  const r = main.getBoundingClientRect();
  const bar = document.getElementById('project-filters');
  const barCs = bar ? getComputedStyle(bar) : null;
  const firstButton = bar?.querySelector('button');
  const btnCs = firstButton ? getComputedStyle(firstButton) : null;
  return {
    cls: main.className,
    width: Math.round(r.width),
    left: Math.round(r.left),
    viewport: document.documentElement.clientWidth,
    heading: document.querySelector('#main h1')?.textContent?.trim() ?? null,
    filterDisplay: barCs?.display ?? null,
    filterListStyle: barCs?.listStyleType ?? null,
    filterDirection: barCs?.flexDirection ?? null,
    buttonRadius: btnCs?.borderRadius ?? null,
    buttonBackground: btnCs?.backgroundColor ?? null,
  };
})()`;

// Direct load for the baseline.
await send("Page.navigate", { url: `${BASE}/projects?_=${Date.now()}` });
await new Promise((resolve) => setTimeout(resolve, 2500));
const direct = await evaluate(measureMain);

// Now reach the same page by client-side navigation from home.
await send("Page.navigate", { url: `${BASE}/?_=${Date.now()}` });
await new Promise((resolve) => setTimeout(resolve, 3500));
const swapped = await evaluate(`(async () => {
  document.querySelector('.nav-links a[data-path="/projects"]').click();
  await new Promise((r) => setTimeout(r, 2000));
  return ${measureMain};
})()`);

check("direct load has container class", direct.cls.includes("container"), `class="${direct.cls}"`);
check("swapped load keeps container class", swapped.cls.includes("container"), `class="${swapped.cls}"`);
check("swapped main width matches direct load", swapped.width === direct.width, `${swapped.width} vs ${direct.width}`);
check("swapped main is centred like direct load", swapped.left === direct.left, `${swapped.left} vs ${direct.left}`);
check("content is the right page", /projects/i.test(swapped.heading ?? ""), `h1=${swapped.heading}`);

// Regression: the projects filter used to lose its stylesheet when reached
// through the router, rendering as a bulleted vertical list of default buttons.
check(
  "filter bar is a flex row, not a bulleted list",
  swapped.filterDisplay === "flex" && swapped.filterListStyle === "none" && swapped.filterDirection === "row",
  `display=${swapped.filterDisplay} list=${swapped.filterListStyle} dir=${swapped.filterDirection}`,
);
check(
  "filter buttons are styled, not browser defaults",
  swapped.buttonRadius === direct.buttonRadius && swapped.buttonBackground === direct.buttonBackground,
  `${swapped.buttonRadius} / ${swapped.buttonBackground} vs ${direct.buttonRadius} / ${direct.buttonBackground}`,
);
check(
  "filter styles identical to a direct load",
  swapped.filterDisplay === direct.filterDisplay &&
    swapped.filterListStyle === direct.filterListStyle &&
    swapped.buttonRadius === direct.buttonRadius,
  `${swapped.filterDisplay}/${swapped.filterListStyle}/${swapped.buttonRadius} vs ${direct.filterDisplay}/${direct.filterListStyle}/${direct.buttonRadius}`,
);

console.log(failures === 0 ? "\nAll layout checks passed." : `\n${failures} failed.`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
