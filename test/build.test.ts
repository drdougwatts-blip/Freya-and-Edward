import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const out = root + 'dist-test/';

describe('Static site build', () => {
  it('builds with placeholder data and produces a working, locked-down site', async () => {
    execFileSync(process.execPath, ['scripts/build.ts', '--example'], {
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
      const r = engine.responsibleAt(time.londonToInstant('2026-10-24', '12:00'), cfg, 'viewer');
      assert.equal(r.parent, 'B');
      assert.equal(data.people.parents.A.name, 'Parent A');
      assert.doesNotMatch(readFileSync(out + 'js/app.js', 'utf8'), /\.ts'/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

});
