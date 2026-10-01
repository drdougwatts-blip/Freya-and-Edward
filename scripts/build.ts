// Builds the static site into dist/. No dependencies: Node 22.18+ only.
//
//   node scripts/build.ts             uses the ROTA_PEOPLE setting, or people.local.json
//   node scripts/build.ts --example   uses people.example.json (placeholders)
//
// Stops with an error, and so leaves the live site untouched, if rota.json or
// the people data has a mistake in it.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { loadRota, validatePeople } from '../src/rota/load.ts';

const root = new URL('..', import.meta.url).pathname;
const out = root + (process.env.OUT_DIR ?? 'dist') + '/';

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read ${path}: ${(e as Error).message}`);
  }
}

const rota = readJson(root + 'rota.json');
loadRota(rota as never);

let people: unknown;
if (process.argv.includes('--example')) {
  people = readJson(root + 'people.example.json');
} else if (process.env.ROTA_PEOPLE) {
  try {
    people = JSON.parse(process.env.ROTA_PEOPLE);
  } catch (e) {
    throw new Error(`The ROTA_PEOPLE setting is not valid JSON: ${(e as Error).message}`);
  }
} else if (existsSync(root + 'people.local.json')) {
  people = readJson(root + 'people.local.json');
} else {
  throw new Error('No people data. Set ROTA_PEOPLE, create people.local.json, or use --example.');
}
validatePeople(people);

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

writeFileSync(
  out + 'js/data.js',
  `export const rota = ${JSON.stringify(rota)};\nexport const people = ${JSON.stringify(people)};\n`,
);

for (const f of ['index.html', 'styles.css', '_headers', 'robots.txt']) copyFileSync(root + 'src/app/' + f, out + f);

console.log(`Built ${out}`);
