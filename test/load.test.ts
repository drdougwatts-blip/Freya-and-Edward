import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { responsibleAt } from '../src/rota/engine.ts';
import { loadRota, type RotaFile } from '../src/rota/load.ts';
import { formatLondon, londonToInstant } from '../src/rota/time.ts';

const base: RotaFile = {
  names: { A: 'Parent A', B: 'Parent B' },
  schoolStart: '08:45',
  patterns: [{ id: 'p', from: '2026-01-05', anchor: '2026-01-05', nights: 'AABBAAA BBAABBB' }],
};

describe('rota.json loading', () => {
  it('the committed rota.json is valid', () => {
    loadRota(JSON.parse(readFileSync(new URL('../rota.json', import.meta.url), 'utf8')));
  });

  it('the committed rota.json hands over to A at 08:45 on Wed 30 Sep 2026, then B from Fri 2 Oct', () => {
    const cfg = loadRota(JSON.parse(readFileSync(new URL('../rota.json', import.meta.url), 'utf8')));
    const r = responsibleAt(londonToInstant('2026-09-30', '08:45'), cfg, 'viewer');
    assert.equal(r.parent, 'A');
    assert.equal(formatLondon(r.since), '2026-09-30 08:45');
    assert.equal(formatLondon(r.until), '2026-10-02 08:45');
    assert.equal(r.next, 'B');
    assert.equal(responsibleAt(londonToInstant('2026-09-30', '08:44'), cfg, 'viewer').parent, 'B');
  });

  it('reads nights with spaces and hyphens', () => {
    const cfg = loadRota({ ...base, patterns: [{ ...base.patterns[0], nights: 'aa-bb-aaa bb-aa-bbb' }] });
    assert.deepEqual(cfg.patterns[0].cycle.join(''), 'AABBAAABBAABBB');
  });

  it('reads override times as London time and later entries win', () => {
    const cfg = loadRota({
      ...base,
      overrides: [
        { from: '2026-06-11 08:45', to: '2026-06-12 08:45', parent: 'A', note: 'first' },
        { from: '2026-06-11 12:00', to: '2026-06-11 18:00', parent: 'B', note: 'second' },
      ],
    });
    assert.equal(formatLondon(cfg.overrides[0].start), '2026-06-11 08:45');
    assert.equal(responsibleAt(londonToInstant('2026-06-11', '10:00'), cfg, 'viewer').parent, 'A');
    assert.equal(responsibleAt(londonToInstant('2026-06-11', '13:00'), cfg, 'viewer').parent, 'B');
  });

  it('gives a clear message for common mistakes', () => {
    assert.throws(() => loadRota({ ...base, patterns: [{ ...base.patterns[0], nights: 'AABX' }] }), /only A and B/);
    assert.throws(() => loadRota({ ...base, overrides: [{ from: '22/10/2026 15:30', to: '2026-10-27 17:00', parent: 'B' }] }), /override 1.*2026-10-22 15:30/);
    assert.throws(() => loadRota({ ...base, overrides: [{ from: '2026-10-22 15:30', to: '2026-10-27 17:00', parent: 'C' as 'A' }] }), /"A" or "B"/);
    assert.throws(() => loadRota({ ...base, overrides: [{ from: '2026-10-27 17:00', to: '2026-10-22 15:30', parent: 'A' }] }), /end after it starts/);
    assert.throws(() => loadRota({ ...base, closures: [{ from: '2026-10-30', to: '2026-10-26' }] }), /ends before it starts/);
    assert.throws(() => loadRota({ ...base, schoolStart: '8.45' }), /Invalid time/);
  });

  it('needs a name for each parent', () => {
    assert.throws(() => loadRota({ ...base, names: { A: 'Doug', B: '' } }), /name for B/);
  });
});
