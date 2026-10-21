#!/usr/bin/env node
/**
 * Builds dist/ — the complete set of files Cloudflare Pages is allowed to serve.
 *
 * Why this exists
 * ---------------
 * With an empty "Build output directory", Pages publishes the whole repository,
 * so `tools/*.mjs`, `README.md`, `.gitignore` and `.gitattributes` all become
 * public URLs on the live domain. The site is plain static files, so there is
 * nothing to compile — the only job of a build here is to decide what is public.
 *
 * Both deploy paths run this script, so they cannot drift apart:
 *
 *   Git integration : Build command `node tools/build.mjs`, output directory `dist`
 *   Direct upload   : node tools/build.mjs && wrangler pages deploy dist ...
 *
 * Usage
 * -----
 *   node tools/build.mjs           write dist/
 *   node tools/build.mjs --check   exit 1 if dist/ is missing or out of date
 */

import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const checkOnly = process.argv.includes('--check');

/** Files served from the root of the site. */
const FILES = [
  'index.html',
  'projects.html',
  'uses.html',
  '404.html',
  '_headers',
  '_redirects',
  'robots.txt',
  'sitemap.xml',
  'LICENSE',
];

/** Directories copied recursively. `_partials` is fetched at runtime. */
const DIRS = ['assets', 'css', 'js', 'images', '_partials'];

/**
 * Repository paths that must never reach dist/. Nothing here is filtered
 * automatically — this list exists so the post-build audit fails loudly if a
 * future change starts copying something it should not.
 */
const NEVER = ['tools', '_shots', '.vscode', 'dist', '.git', 'site-memory'];

function assert(condition, message) {
  if (!condition) {
    console.error(`build: ${message}`);
    process.exit(1);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** All file paths under `dir`, relative to `dir`, as POSIX strings. */
async function walk(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

/** The file list this build is expected to produce. */
async function expectedFiles() {
  const files = [...FILES];
  for (const dir of DIRS) {
    for (const rel of await walk(join(root, dir))) files.push(`${dir}/${rel}`);
  }
  return files.sort();
}

async function build() {
  for (const entry of [...FILES, ...DIRS]) {
    assert(await exists(join(root, entry)), `missing input "${entry}" in the repository root`);
  }

  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  for (const file of FILES) await cp(join(root, file), join(dist, file));
  for (const dir of DIRS) {
    await cp(join(root, dir), join(dist, dir), { recursive: true });
  }

  const produced = await walk(dist);
  let bytes = 0;
  for (const rel of produced) bytes += (await stat(join(dist, rel))).size;

  for (const rel of produced) {
    for (const banned of NEVER) {
      assert(
        rel !== banned && !rel.startsWith(`${banned}/`),
        `"${rel}" should never be published — check FILES/DIRS in tools/build.mjs`,
      );
    }
  }

  const missing = (await expectedFiles()).filter((rel) => !produced.includes(rel));
  assert(missing.length === 0, `copy incomplete, missing: ${missing.join(', ')}`);
  assert(produced.length > 0, 'dist is empty');

  return { produced, bytes };
}

async function check() {
  assert(await exists(dist), 'dist/ does not exist — run `node tools/build.mjs` first');

  const expected = await expectedFiles();
  const actual = await walk(dist);

  const problems = [];
  for (const rel of expected) {
    const source = join(root, ...rel.split('/'));
    const built = join(dist, ...rel.split('/'));
    if (!actual.includes(rel)) problems.push(`missing   ${rel}`);
    else if ((await digest(source)) !== (await digest(built))) problems.push(`stale     ${rel}`);
  }
  for (const rel of actual) {
    if (!expected.includes(rel)) problems.push(`unexpected ${rel}`);
  }

  if (problems.length > 0) {
    console.error('build: dist/ is out of date with the repository');
    for (const problem of problems.slice(0, 20)) console.error(`  ${problem}`);
    if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`);
    process.exit(1);
  }

  console.log(`dist/ is up to date (${actual.length} files)`);
}

function summarise({ produced, bytes }) {
  const dirs = new Map();
  for (const rel of produced) {
    const top = rel.includes('/') ? rel.split('/')[0] : '(root files)';
    dirs.set(top, (dirs.get(top) ?? 0) + 1);
  }
  console.log(`dist/ ${produced.length} files, ${(bytes / 1024).toFixed(1)} KB`);
  for (const [name, count] of [...dirs].sort()) {
    console.log(`  ${name.padEnd(14)} ${count} file${count === 1 ? '' : 's'}`);
  }
  for (const file of produced.filter((rel) => rel.split(sep).length === 1)) {
    console.log(`  ${file}`);
  }
}

if (checkOnly) {
  await check();
} else {
  summarise(await build());
  console.log(`\nnext: npx wrangler pages deploy dist --project-name www-delaviath-com --branch main`);
}
