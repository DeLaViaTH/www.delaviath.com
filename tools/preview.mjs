/**
 * Local preview server that mimics Cloudflare Pages routing so the rebuilt site
 * can be checked the way it will behave in production:
 *
 *  - /projects  -> projects.html          (clean URLs)
 *  - unknown    -> 404.html  with status 404   (no soft 404s)
 *  - /index.html -> 301 /                  (matches _redirects)
 *
 * Usage: node tools/preview.mjs [port]
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const PORT = Number(process.argv[2] ?? 8099);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".md": "text/markdown; charset=utf-8",
};

/** Redirects, exactly as listed in _redirects. */
const REDIRECTS = new Map([
  ["/index.html", "/"],
  ["/projects.html", "/projects"],
  ["/uses.html", "/uses"],
  // The BMI calculator was removed; its old URLs point at the projects page.
  ["/bmi", "/projects"],
  ["/bmi.html", "/projects"],
]);

function isInsideRoot(path) {
  const resolved = normalize(path);
  return resolved === ROOT || resolved.startsWith(ROOT + sep);
}

async function exists(path) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function resolve(urlPath) {
  if (REDIRECTS.has(urlPath)) return { redirect: REDIRECTS.get(urlPath) };

  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const asFile = join(ROOT, clean);
  if (!isInsideRoot(asFile)) return { status: 403 };

  // Exact file hit.
  if (await exists(asFile)) return { file: asFile };

  // Clean URL: /projects -> /projects.html
  if (await exists(`${asFile}.html`)) return { file: `${asFile}.html` };

  // Directory index.
  const index = join(asFile, "index.html");
  if (await exists(index)) return { file: index };

  return { notFound: true };
}

const server = createServer(async (req, res) => {
  const urlPath = req.url ?? "/";
  const result = await resolve(urlPath);

  if (result.redirect) {
    res.writeHead(301, { Location: result.redirect });
    return res.end();
  }

  if (result.status) {
    res.writeHead(result.status, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  const target = result.notFound ? join(ROOT, "404.html") : result.file;
  const body = await readFile(target);

  res.writeHead(result.notFound ? 404 : 200, {
    "Content-Type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "no-store",
    // The headers Cloudflare Pages will send via _headers.
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  res.end(body);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`preview: http://127.0.0.1:${PORT}  (root: ${ROOT})`);
});
