import { build } from 'esbuild';
import { cp, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Build every plugin into the artifacts crate installs.
 *
 * Each plugins/<id>/ becomes a dist/ of at most four files, and dist/ is COMMITTED — crate's
 * runtime image has no compiler, so what sits in git is exactly what gets downloaded and run.
 * Build before you push, or you ship the previous version with the new manifest.
 *
 *   server.js   the server half, bundled for node. Everything the plugin needs is either
 *               inlined here or handed over at runtime through ctx — the file imports nothing
 *               but node builtins, because it will be dynamically imported from /data/plugins
 *               where no node_modules exists.
 *   client.js   the client half, bundled for the browser as ESM. React and the crate helpers
 *               are NOT in the bundle: the alias map below points them at shims/, which read
 *               window.crateHost — the single-React rule that dynamic React plugins live or
 *               die by (see shims/react.js).
 *   style.css   copied verbatim; crate injects it as a <link>.
 *   manifest.json  copied verbatim; names the files above.
 *
 * The root index.json is regenerated from the manifests — it is the catalog crate's admin
 * page reads, and generating it is what keeps it honest.
 */

const ALIAS = {
  react: './shims/react.js',
  'react/jsx-runtime': './shims/jsx-runtime.js',
  'crate/api': './shims/crate-api.js',
  'crate/player': './shims/crate-player.js',
  'crate/plugins': './shims/crate-plugins.js',
  'crate/icons': './shims/crate-icons.js',
  'crate/logo': './shims/crate-logo.js',
};

const exists = (p) => stat(p).then(() => true, () => false);

const catalog = [];
for (const id of (await readdir('plugins')).sort()) {
  const root = join('plugins', id);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf-8'));
  if (manifest.id !== id) throw new Error(`${root}: manifest id "${manifest.id}" != directory name`);

  if (await exists(join(root, 'server/index.ts'))) {
    await build({
      entryPoints: [join(root, 'server/index.ts')],
      outfile: join(root, 'dist/server.js'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
    });
  }

  if (await exists(join(root, 'client/index.tsx'))) {
    await build({
      entryPoints: [join(root, 'client/index.tsx')],
      outfile: join(root, 'dist/client.js'),
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      jsx: 'automatic',
      alias: ALIAS,
    });
  }

  if (await exists(join(root, 'client/style.css'))) {
    await cp(join(root, 'client/style.css'), join(root, 'dist/style.css'));
  }
  await cp(join(root, 'manifest.json'), join(root, 'dist/manifest.json'));

  catalog.push({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    dir: `plugins/${id}/dist`,
  });
  console.log(`built ${id}@${manifest.version}`);
}

await writeFile('index.json', JSON.stringify({ plugins: catalog }, null, 2) + '\n');
console.log(`catalog: ${catalog.length} plugin(s)`);
