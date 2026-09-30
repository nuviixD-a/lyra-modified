# Deploying to Cloudflare

## Repo layout for deploys

| branch / file | contents | use |
| --- | --- | --- |
| `main` | full source code | builds the site from source |
| `pages-deploy` | prebuilt static output (`dist/`) | deploy without building |
| `wrangler.jsonc` + `worker.js` | Cloudflare Workers config | `wrangler deploy` serves `dist/` with app routing |

## Option A — Workers build (what the dashboard does now)

With Workers Builds the pipeline is:

1. **Build command:** `npm run build` (runs `build-proxy`, `vite build`, `audit-build`)
2. **Deploy command:** `npx wrangler deploy`

`wrangler.jsonc` tells wrangler to upload `dist/` as static assets and run
`worker.js` for:

- `/health` — returns `oki`
- `/stream/anime` — serves `player.html`
- `/s` — serves `index.html`
- extensionless unknown paths — `index.html` fallback
- everything else — straight from static assets (hashed files are immutable)

No environment variables are required. The folio runtime ships prebuilt
(`vendor/folio/packages/*/dist/` and `public/b/fl/` are tracked), so the
Rust/wasm toolchain is **not** required: `scripts/build-folio.mjs` detects the
prebuilt artifacts and skips the Rust build when the toolchain is missing.

### Important limitations of a static deploy

This app is usually served by `server/prod.mjs` (Bun), which handles:

- `/api/*` — search suggestions, DNS service, anime identity/episode data
- `/stream/*` — HLS stream info and anime playback
- wisp proxying at the configured `LYRA_WISP_PATH`

On Cloudflare's static hosting those routes do not exist, so search, the anime
catalog, and playback will not work unless you also deploy the backend
(e.g. a Cloudflare Worker or a VPS running `bun server/prod.mjs`) and point
the frontend at it. The static shell (UI, games grid via direct links, settings)
does work.

## Option B — deploy the prebuilt `pages-deploy` branch (no build)

Cloudflare Pages → Connect to Git:

- **Production branch:** `pages-deploy`
- **Build command:** *(leave empty)*
- **Build output directory:** `/`

The branch already contains `_redirects` (SPA fallback) and `_headers`
(immutable caching for `/assets/*` and `/b/*`).

## Refreshing the prebuilt branch

```bash
bun install
bun run build   # optionally with LYRA_WISP_PATH=/<hex>/
```

Then commit the new `dist/` contents to `pages-deploy` and push.
