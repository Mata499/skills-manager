import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildClient({ outdir = resolve(root, 'lib'), write = true } = {}) {
  return build({
    absWorkingDir: root, entryPoints: ['src/client/index.mjs'], outfile: resolve(outdir, 'client.js'),
    bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', external: ['react'], write,
    banner: { js: 'window.__ModuleLoader__.load({id:"dsh-project-skills-manager",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
    footer: { js: 'return module.exports;}});' },
  });
}
export async function buildAll() {
  await build({ absWorkingDir: root, entryPoints: ['src/index.mjs'], outfile: 'lib/index.js', bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22' });
  await buildClient();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildAll();
