# crate-plugins

Installable plugins for [crate](https://github.com/MattLarritt/crate). Crate's admin portal
connects to this repo, reads `index.json`, and downloads a plugin's `dist/` into
`/data/plugins/<id>/` — no rebuild of crate itself.

## The deal

Crate's runtime image has no compiler and its client is one prebuilt bundle, so everything
here ships **pre-built**: `npm run build` writes each plugin's `dist/` (server.js, client.js,
style.css, manifest.json) and regenerates the catalog, and `dist/` is **committed** — what is
in git is exactly what gets installed. Build before you push.

The client half is built against crate's host surface (`window.crateHost`: the app's own React,
the request helpers, the player hook — see `shims/`), never bundling React itself: two React
instances break hooks. The server half bundles everything it needs and receives the rest at
runtime through `ctx` (db, session guard, userlib, events, IPv4-pinned http).

## A new plugin

    plugins/<id>/manifest.json     id, name, version, description, file names
    plugins/<id>/server/index.ts   default-exports a CratePlugin (types/contract.ts)
    plugins/<id>/client/index.tsx  default-exports a UiPlugin
    npm run check && npm run build
    commit (including dist/) and push

Install/update from crate: Admin → Plugins. A server half activates on restart (one click
there); a client half loads at next page load.
