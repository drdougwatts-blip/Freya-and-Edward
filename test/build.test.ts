import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import * as srcEngine from '../src/rota/engine.ts';
import * as srcLoad from '../src/rota/load.ts';

const root = new URL('..', import.meta.url).pathname;
const out = root + 'dist-test/';

describe('Static site build', () => {
  it('builds and produces a working, locked-down site', async () => {
    execFileSync(process.execPath, ['scripts/build.ts'], {
      cwd: root,
      env: { ...process.env, OUT_DIR: 'dist-test', NODE_NO_WARNINGS: '1' },
    });
    try {
      const headers = readFileSync(out + '_headers', 'utf8');
      assert.match(headers, /X-Robots-Tag: noindex/);
      assert.match(headers, /Content-Security-Policy: default-src 'none'; script-src 'self'/);
      assert.match(readFileSync(out + 'robots.txt', 'utf8'), /Disallow: \//);
      assert.match(readFileSync(out + 'index.html', 'utf8'), /<meta name="robots" content="noindex/);

      // The built browser code must load and give the same answers as the source.
      const engine = await import(out + 'js/engine.js');
      const load = await import(out + 'js/load.js');
      const time = await import(out + 'js/time.js');
      const data = await import(out + 'js/data.js');
      const cfg = load.loadRota(data.rota);
      const srcCfg = srcLoad.loadRota(data.rota);
      for (const [d, t] of [['2026-10-24', '12:00'], ['2027-03-28', '01:30'], ['2027-07-01', '08:45']]) {
        const built = engine.responsibleAt(time.londonToInstant(d, t), cfg, 'viewer');
        const src = srcEngine.responsibleAt(time.londonToInstant(d, t), srcCfg, 'viewer');
        assert.deepEqual([built.parent, built.until], [src.parent, src.until], `${d} ${t}`);
      }
      assert.doesNotMatch(readFileSync(out + 'js/app.js', 'utf8'), /\.ts'/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

});
