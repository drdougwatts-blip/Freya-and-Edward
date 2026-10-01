// Builds the static site into dist/. No dependencies: Node 22.18+ only.
//
//   node scripts/build.ts
//
// Stops with an error, and so leaves the live site untouched, if rota.json
// has a mistake in it.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { loadRota } from '../src/rota/load.ts';

const root = new URL('..', import.meta.url).pathname;
const out = root + (process.env.OUT_DIR ?? 'dist') + '/';

let rota: unknown;
try {
  rota = JSON.parse(readFileSync(root + 'rota.json', 'utf8'));
} catch (e) {
  throw new Error(`Could not read rota.json: ${(e as Error).message}`);
}
loadRota(rota as never);

rmSync(out, { recursive: true, force: true });
mkdirSync(out + 'js', { recursive: true });

// TypeScript to browser JavaScript: strip the types and point imports at the .js files.
const sources = ['src/rota/time.ts', 'src/rota/engine.ts', 'src/rota/load.ts', 'src/app/app.ts'];
for (const src of sources) {
  const js = stripTypeScriptTypes(readFileSync(root + src, 'utf8'), { mode: 'strip' }).replace(
    /from '(?:\.\.\/rota\/|\.\/)([\w-]+)\.ts'/g,
    "from './$1.js'",
  );
  const name = src.split('/').pop()!.replace(/\.ts$/, '.js');
  writeFileSync(out + 'js/' + name, js);
}

writeFileSync(out + 'js/data.js', `export const rota = ${JSON.stringify(rota)};\n`);

for (const f of ['index.html', 'styles.css', '_headers', 'robots.txt']) copyFileSync(root + 'src/app/' + f, out + f);

console.log(`Built ${out}`);
