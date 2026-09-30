# Writing a plugin

[← crate-plugins](../README.md)

A plugin is a folder under `plugins/` with a manifest and up to two halves: a **server half**
that runs inside crate's server, and a **client half** that runs inside crate's web app. Either
can be absent — [YouTube](plugins/youtube.md) is server-only.

```
plugins/<id>/
  manifest.json
  server/index.ts      default-exports a CratePlugin
  client/index.tsx     default-exports a UiPlugin
  client/style.css     optional; injected as a <link>
  test/*.test.ts       optional; npm test runs them
```

The contract both halves are written against is [`types/contract.ts`](../types/contract.ts). It
mirrors crate's own interfaces (`src/lib/plugin.ts` and `web/src/plugins/types.ts` in
[crate](https://github.com/MattLarritt/cratemusic)): an installed plugin is compiled here and run
there, with no compiler at the boundary, so that file *is* the boundary.

## The manifest

```json
{
  "id": "chords",
  "name": "Chords & notes",
  "version": "1.4.0",
  "description": "What it does, in a sentence or two — shown on crate's plugin page.",
  "server": "server.js",
  "client": "client.js",
  "css": "style.css"
}
```

- `id` must match the folder name: lowercase letters, digits and hyphens, starting with a letter
  or digit, at most 40 characters. It names the install directory, the
  plugin's settings, and its data directory — changing it later orphans all three.
- `version` is what crate compares to offer **Update to v…**. Bump it on every change you want
  people to receive.
- `server`, `client`, `css` name the built files in `dist/`; leave out the ones a plugin doesn't
  have.

## The server half

`server/index.ts` default-exports a `CratePlugin`:

```ts
import type { CratePlugin } from '../../../types/contract.js';

const plugin: CratePlugin = {
  id: 'example',

  // Create or migrate your tables. Runs at every start, so make it idempotent.
  migrate(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS example_notes (user_id INTEGER, body TEXT)`);
  },

  // Your HTTP routes, on crate's own server.
  routes(app, ctx) {
    app.get('/api/example', async (req, reply) => {
      const c = ctx.need(req, reply); // replies 401 itself when nobody is signed in
      if (!c) return;
      return { hello: c.name };
    });
  },

  // Settings the admin can change on the plugin's page (rendered by crate).
  settings: [
    { key: 'greeting', label: 'Greeting', type: 'string', default: 'hello' },
  ],
};

export default plugin;
```

What the server half is handed, as `ctx`:

| | |
|---|---|
| `db` | crate's SQLite database (better-sqlite3). Prefix your tables with your plugin id. |
| `need(req, reply)` | The session guard. Returns the caller (`id`, `user`, `name`, `isAdmin`) or replies 401 and returns null. `id` is null for the API-key caller, which is not a user. |
| `userlib` | Track lookups and playlist creation, as crate does them. |
| `characteristics` | Read-only song characteristics and the similarity maths over them. |
| `events` | crate's notification events — `request.created`, `request.fulfilled`, `library.scanned`, `library.external` and more. |
| `http` | IPv4-pinned `getText` / `getJson` / `getBytes`. Use these rather than `fetch`: a host that publishes an IPv6 address the network can't route stalls a plain fetch. |
| `library.ingest` | Put a file into the library for someone — crate's dedupe, move, index and ownership. `retag: true` writes the identity into the file's tags first. |
| `ai` | Specific AI tasks on crate's own OpenAI key, with crate's prompts and checks — currently `identifySong(evidence)`. Never a free-form call. Check `ctx.ai?.available()`: absent on older crates, false with no key. |
| `dataDir` | A writable directory of your own, under `/data/plugin-data/<id>/`. |
| `settings.get(key)` | Your declared settings' current values. |
| `log` | crate's logger. |

**Rules of the road.** Routes live under `/api/...` and must not collide with crate's own — a
collision fails crate's start. Scope anything personal by `c.id`. A route should answer as
though the feature is off when the plugin is switched off; crate already refuses a disabled
plugin's routes for you.

A server half can also be an **external source** — a place songs come from that isn't the
library. That has its own page: [Writing an external source](external-sources.md).

## The client half

`client/index.tsx` default-exports a `UiPlugin`, which fills one or more of crate's slots:

```tsx
import type { UiPlugin } from '../../../types/contract';

const ui: UiPlugin = {
  id: 'example',
  // A button on the play bar that opens a full-height panel for the playing song.
  playbar: { title: 'Example', icon: ExampleIcon, Panel: ExamplePanel },
  // A pane in the user's profile.
  profile: { label: 'Example', hint: 'what it shows', Pane: ExamplePane },
  // Always mounted while somebody is signed in, rendering nothing — a plugin's running half.
  Service: ExampleService,
};

export default ui;
```

**Never bundle React.** crate's web app exposes its own React and helpers on
`window.crateHost`, and the build maps these imports onto them (see [`shims/`](../shims)):

| Import | What you get |
|---|---|
| `react`, `react/jsx-runtime` | crate's own React — two copies of React break hooks |
| `crate/api` | `get`, `post`, `put`, `del` — the same request helpers crate uses, sign-in handling included |
| `crate/player` | `usePlayer()` — the queue, the current song, play/pause/next, enqueue |
| `crate/plugins` | `requestPanel(id)` — open your panel for whatever plays next |
| `crate/icons` | `Svg` — the icon wrapper, so your icon matches the rest of the play bar |
| `crate/logo` | crate's wordmark |

The declarations are in [`types/crate-modules.d.ts`](../types/crate-modules.d.ts). Style with
your own class names in `client/style.css`, prefixed so they can't collide with crate's.

## Building and publishing

```bash
npm install
npm run check      # typecheck every plugin against the contract
npm test           # plugin tests, if any
npm run build      # writes plugins/*/dist/ and regenerates index.json
```

Then commit **including `dist/` and `index.json`**, and push. crate's runtime image has no
compiler, so what is committed is exactly what gets installed — push without building and you
ship the previous build under the new manifest.

The build bundles the server half for Node with everything it needs inlined (it is imported from
`/data/plugins`, where no `node_modules` exists), and the client half as browser ESM with the
aliases above.

## Testing inside crate

Point a crate at your fork (**Admin → Plugins**, see [Installing](installing.md)), install, and
restart. For a faster loop on a test instance, copy `plugins/<id>/dist/` straight into that
crate's `/data/plugins/<id>/` and restart it.
