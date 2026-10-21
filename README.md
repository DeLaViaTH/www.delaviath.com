# DeLaViaTH — personal site

Source for <https://www.delaviath.com>. Plain HTML, CSS and a little JavaScript —
no framework, no bundler, no build step.

## Stack

| Piece | What it is |
| --- | --- |
| Markup | Hand-written HTML5, one file per page |
| Styling | Custom design system in `css/base.css` (~4 KB gzipped) |
| Scripting | ES modules-free vanilla JS in `js/` |
| Hosting | Cloudflare Pages (static) + Cloudflare Workers for the status page |
| Monitoring | [status-page.delaviath.com](https://status-page.delaviath.com/) |

Bootstrap was removed in the current rebuild: it was pinned to `5.3.0-alpha1`,
pulled 220 KB from `cdn.jsdelivr.net` before the page could render, and the site
used only a handful of its classes.

## Background video

Every page has one background video: `Golden Hour` by BlueSkyWhaler, embedded
from YouTube and autoplaying muted in a loop. It is a **fixed** layer, so it
stays visible at any scroll position instead of scrolling away with the hero.

Markup lives in `_partials/background.html` and is injected into
`<div id="background-container">` on every page by `js/site.js`.

| Layer | What it is |
| --- | --- |
| `.site-bg__wash` | Animated golden-hour gradient. Pure CSS, zero payload. Still visible behind the video and while the player buffers. |
| `.site-bg__video` | The YouTube embed (`youtube-nocookie.com`, `autoplay=1&mute=1&loop=1`), `position: fixed`, blurred 3px so the clip's burned-in captions never read as page content. |
| `.site-bg::after` | Contrast veil, painted above the video so body copy stays legible. |
| `.site-bg__toggle` | Pause/play circle, fixed bottom-right, on every page. |

Notes:

- `src` sits on the iframe in the HTML, so playback does not depend on JS.
- The frame stays at `opacity: 0` until the player reports it is actually
  playing (`.site-bg--live`). A blocked embed therefore falls back to the
  gradient instead of a black rectangle.
- The toggle drives `pauseVideo` / `playVideo` through the player's postMessage
  API, which is why the embed URL carries `enablejsapi=1`.
- The toggle is deliberately **not** hidden under `prefers-reduced-motion`, and
  it is icon-only so it never sits on top of paragraph text. An earlier version
  used a labelled pill and hid it for reduced motion, which left visitors with
  no way to stop a moving background at all.
- Change the video by editing the `src` video ID in the partial.

The CSP in `_headers` allows `youtube-nocookie.com` and `youtube.com` for
`frame-src` and `connect-src`; a different host will need adding or the iframe
stays blank.

## Navigation and playback continuity

Links are handled client-side by `js/router.js`: it fetches the target page,
swaps `<main>`, updates `<title>` / description / canonical / Open Graph, and
pushes the URL. The document itself is never reloaded.

That is what keeps the background video running. A normal page load destroys the
fixed `<iframe>` and restarts the clip at 0:00; swapping only `<main>` leaves the
iframe, its buffer and its play position untouched. Verified by
`tools/cdp-router.mjs`, which stamps the iframe and asserts the same element is
still there after several navigations.

Router details:

- Modifier clicks, `target="_blank"`, `download`, `mailto:`/`tel:` and external
  links are left to the browser.
- Prefetches on hover/focus so the swap usually feels instant.
- `back`/`forward` restore both the page and the scroll offset.
- Focus moves to the new `<h1>` so keyboard and screen-reader users are not left
  at the top of an unchanged document silently.
- Any fetch error falls back to `location.href`, so a broken connection never
  produces a dead click.
- With JavaScript disabled every link is a normal link.

Page-specific scripts (currently `projects-filter.js`) are loaded on **every**
page and re-initialise on the `site:page-loaded` event; scripts inserted through
`innerHTML` do not execute, so inline page scripts are not an option.

There is also only **one stylesheet**, `css/base.css`, linked by every page.
Splitting it per page (`home.css`, `pages.css`) looked tidier but broke under the
router: a page reached client-side never loads the stylesheet declared in its own
`<head>`, so the projects filter rendered as a bulleted vertical list of default
buttons. Page-scoped class names make a single file free, and `tools/cdp-layout.mjs`
now asserts that styles match between a direct load and a routed one.

## Performance notes

The background layer is deliberately cheap. Measured on the same machine with
`tools/cdp-fps-ab.mjs`:

| Build | Average frame | Long frames | FPS |
| --- | --- | --- | --- |
| Blurred, 120% oversized, animated gradient | 41.1 ms | 73 | 24 |
| Current | 16.7 ms | 0 | 60 |

What changed:

- **No `filter: blur()`** on the video. A Gaussian blur over a full-viewport
  iframe is recomputed for every video frame and was by far the biggest cost.
  The burned-in captions are suppressed by the contrast veil instead.
- **No oversizing.** The box is an exact 16:9 `cover`, so the compositor stops
  rasterising ~40% more pixels than the screen has.
- **The gradient stops animating once the video is live** (`site-bg--live`). Two
  animated full-viewport layers under a playing video is invisible and expensive.
- `contain: layout paint` and `transform: translateZ(0)` keep the fixed layer on
  its own compositing layer.
- The embed requests `vq=hd1080`, so the player picks a sharper rendition instead
  of a soft, compression-heavy one.

## Layout

```
.
├── index.html            # home
├── projects.html         # project list with client-side filters
├── uses.html             # hardware / software setup
├── 404.html              # custom not-found page
├── css/
│   └── base.css          # one stylesheet: tokens, layout, components, all pages
├── js/
│   ├── site.js           # injects partials, nav state, mobile menu
│   ├── router.js         # client-side navigation (keeps video alive)
│   ├── background-video.js  # autoplay state + pause/play toggle
│   └── projects-filter.js   # project category filter
├── _partials/
│   ├── background.html   # fixed video layer + toggle, on every page
│   ├── navbar.html       # single source of truth for navigation
│   └── footer.html
├── images/               # profile photo (webp + png fallback)
├── assets/               # favicons, og image, app icons
├── tools/                # local preview server + headless-browser checks
├── _headers              # Cloudflare Pages response headers (CSP, cache)
├── _redirects            # Cloudflare Pages redirects (.html → clean URLs)
├── robots.txt
└── sitemap.xml
```

## Local development

Because `js/site.js` fetches the partials over HTTP, opening the files with
`file://` will not render the navigation. Use the bundled preview server, which
also mimics Cloudflare Pages routing (clean URLs, real 404s, the `_redirects`
rules):

```powershell
# from this directory
node tools/preview.mjs          # http://localhost:8099
node tools/preview.mjs 3000     # or pick a port
```

`python -m http.server` also works for reading the pages, but it will not resolve
`/projects` (serves 404 instead of `projects.html`) and has no clean-URL handling.

## Copy tone

This is a learning site, and the copy is written to match. Keep it that way when
editing:

- Say what stage something is actually at ("reads the sensor, the rest is still
  being worked out") instead of implying a finished system.
- Name the source when following a tutorial or using a template. "Built from an
  open-source template" is more credible than silence.
- Distinguish comfortable / learning / used-once. The Uses page does this
  explicitly, and it should stay explicit.
- No invented metrics, no "senior" framing, no jargon used to sound impressive.
- Saying "I don't have production experience yet" is fine and reads better than
  vagueness.

Professional here means specific and clear, not senior.

### Browser checks

These drive headless Chrome over the DevTools Protocol and need Chrome running
with `--remote-debugging-port=9222`:

| Script | Asserts |
| --- | --- |
| `cdp-background.mjs` | The background layer exists on every page, is `position: fixed`, covers the viewport, stays pinned across a scroll, and its toggle pauses/resumes |
| `cdp-nav.mjs` | Mobile menu open/close, Escape, active-link marking |
| `cdp-overflow.mjs` | No horizontal overflow at a given viewport width |
| `cdp-check.mjs` | Console errors, page exceptions, failed requests |
| `cdp-shot.mjs` / `cdp-shot-media.mjs` | Exactly-sized screenshots |
| `capture-scroll.mjs` | Each page at top / middle / bottom, to review the background |
| `capture-autoplay.mjs` | The home hero once playback has started |

## Deploying

Cloudflare Pages builds straight from the `main` branch of
[DeLaViaTH/www.delaviath.com](https://github.com/DeLaViaTH/www.delaviath.com).

- **Project:** `www-delaviath-com`
- **Build command:** `node tools/build.mjs`
- **Build output directory:** `dist`
- **Environment variable:** `NODE_VERSION=22`

`tools/build.mjs` copies only what should be public into `dist/`; everything
else in the repository (`tools/`, `README.md`, `.gitignore`) stays off the site.
Leaving the output directory empty is what makes Pages publish the whole
repository — `tools/cdp-router.mjs`, `README.md` and `.gitignore` all answered
`200` that way.

`_headers` and `_redirects` are picked up automatically. Old `/bmi` and
`/bmi.html` links redirect to `/projects` — the calculator was removed.

### Deploying by direct upload

The Git integration depends on Cloudflare receiving GitHub webhooks. When that
path is unavailable — GitHub incidents, an expired authorisation, or a project
whose production deployment is stale — push to Git and upload the site directly
instead:

```sh
git push origin main                       # keep the repository truthful
node tools/build.mjs                       # stage dist/ — public files only
npx wrangler pages deploy dist --project-name www-delaviath-com --branch main
```

`node tools/build.mjs --check` exits non-zero when `dist/` is stale, so it is
safe to gate a deploy on it.

Deploy to a preview branch first (`--branch preview-test`) when you want the
real edge to check a change before it reaches the production domain; the alias
URL (`https://preview-test.www-delaviath-com.pages.dev`) is safe to test against.

Two things that only show up on the real edge, not locally:

- `/_partials/*.html` answers **308** and redirects to the extensionless path.
  `fetch()` follows it, so the shared chrome still loads, but that is why the
  partials are fetched at runtime rather than assumed to be static.
- Cloudflare injects its Web Analytics beacon into Pages responses, so
  `static.cloudflareinsights.com` has to stay in `script-src` and
  `cloudflareinsights.com` in `connect-src`, or every page logs a CSP violation.

## Conventions

- Every page declares a canonical URL, an Open Graph image and a description.
- Clean URLs only (`/projects`, not `/projects.html`); `_redirects` enforces it.
- Third-party requests are limited to Google Fonts, the hero's YouTube embed and
  Cloudflare's own analytics beacon.
- `prefers-reduced-motion` stops the decorative gradient, but never hides the
  video's pause control.
- Shared chrome lives in `_partials/` and is fetched once per document by
  `js/site.js`; per-page stylesheet or script tags break client-side navigation.

## Licence

GPL-3.0 — see [LICENSE](LICENSE).
