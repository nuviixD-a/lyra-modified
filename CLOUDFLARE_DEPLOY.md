# Deploying to Cloudflare Pages

## Two branches, two purposes

| branch | contents | use |
| --- | --- | --- |
| `main` | full source code | builds the site from source |
| `pages-deploy` | prebuilt static output (`dist/`) | deploy without building |

## Option A — deploy the prebuilt `pages-deploy` branch (simplest)

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
2. Select this repo and set:
   - **Production branch:** `pages-deploy`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
3. Deploy. No build step runs; the committed static bundle is served as-is.

The `pages-deploy` branch already contains `_redirects` (SPA fallback) and
`_headers` (immutable caching for `/assets/*` and `/b/*`).

## Option B — build from source on `main

Cloudflare Pages build settings:

- **Production branch:** `main`
- **Build command:** `bun install && bun run build`
- **Build output directory:** `dist`
- **Environment variables:**
  - `LYRA_WISP_PATH` = `/<64 hex chars>/` — must match the wisp prefix your
    proxy backend is configured with. Omit it only for a local-only build
    (defaults to `/w/`).
  - `NODE_ENV` = `production`

The folio runtime ships prebuilt (`vendor/folio/packages/*/dist/` and
`public/b/fl/` are tracked), so the Rust/wasm toolchain is **not** required:
`scripts/build-folio.mjs` detects the prebuilt artifacts and skips the Rust
build when the toolchain is missing.

### Important limitations of a static deploy

This app is usually served by `server/prod.mjs` (Bun), which handles:

- `/api/*` — search suggestions, DNS service, anime identity/episode data
- `/stream/*` — HLS stream info and anime playback
- wisp proxying at the configured `LYRA_WISP_PATH`

On static Pages hosting those routes do not exist, so search, the anime
catalog, and playback will not work unless you also deploy the backend
(e.g. a Cloudflare Worker or a VPS running `bun server/prod.mjs`) and point
the frontend at it. The static shell (UI, games grid via direct links, settings)
does work.

## Refreshing the prebuilt branch

```bash
bun install
bun run build   # optionally with LYRA_WISP_PATH=/<hex>/ 
git checkout pages-deploy   # or update it from dist/
```

Then commit the new `dist/` contents to `pages-deploy` and push.
