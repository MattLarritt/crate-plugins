# Installing plugins

[← crate-plugins](../README.md)

Everything happens in crate's admin page: **Admin → Plugins**. You need to be an admin.

## 1. Point crate at this repository

In the source box, enter the repository as `owner/name`:

```
MattLarritt/crate-plugins
```

and save. crate reads `index.json` from the repository and lists what it offers under
**Available**.

This repository is public, so no token is needed. A **private** repository — a fork of your own,
say — needs a GitHub personal access token with read access to its contents. crate stores it on
the server and never shows it again; leave the token field empty when saving the repository
name and the stored token is kept.

## 2. Install

Press **Install** next to a plugin. crate downloads its `dist/` into `/data/plugins/<id>/`.

- A plugin with a **client half** (anything you see in the web app) loads on the next page load.
- A plugin with a **server half** (routes, storage, an external source) activates when crate
  restarts. The page says *waiting for restart* and offers **Restart crate**; it restarts in
  place and reloads the page when crate answers again.

## 3. Switch on and off

Every installed plugin has **Switch off / Switch on**. Switching off hides the plugin's UI and
refuses its routes at once — no restart — and the rest of crate treats the feature as simply not
there. Switching back on brings it straight back. Nothing is deleted either way.

## Updating

When the repository has a newer version, the row shows **Update to v*x.y.z***. Press it; a
server half needs a restart, as when installing.

## Uninstalling

**Uninstall** removes the plugin's files. Its **data is kept** — the tables it created and
anything under `/data/plugin-data/<id>/` — so reinstalling picks up where it left off. Delete
that data yourself if you really want it gone.

## Where things live

```
/data/plugins/<id>/        the installed files (server.js, client.js, style.css, manifest.json)
/data/plugin-data/<id>/    what a plugin keeps for itself — tools, caches, downloads
crate.db                   any tables a plugin creates, alongside crate's own
```

Back up `/data` and you have backed up your plugins and everything they hold.

## Using your own fork

Fork this repository, change what you like, run `npm run build`, commit **including `dist/`**,
push, and point crate at your fork. See [Writing a plugin](writing-a-plugin.md).

## Troubleshooting

- **A plugin says installed but nothing appears.** A server half needs **Restart crate**; a
  client half needs a page reload.
- **The repository lists nothing.** Check the name is `owner/name` with no URL, and that a
  private repository has a token with read access to contents.
- **A plugin misbehaves after a crate upgrade.** Plugins are built against crate's plugin
  contract (`types/contract.ts`); if crate changed it, update the plugin to the version built
  for your crate.
