import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  baseNightParent,
  handovers,
  monthView,
  responsibleAt,
  validateConfig,
  type Override,
  type Parent,
  type RotaConfig,
} from '../src/rota/engine.ts';
import { addDays, daysBetween, formatLondon, londonOffsetMinutes, londonToInstant } from '../src/rota/time.ts';

// 2/2/3 anchored on Monday 5 Jan 2026 (placeholder, not real data).
//   Week 1: Mon A  Tue A  Wed B  Thu B  Fri A  Sat A  Sun A
//   Week 2: Mon B  Tue B  Wed A  Thu A  Fri B  Sat B  Sun B
const CYCLE_223: Parent[] = ['A', 'A', 'B', 'B', 'A', 'A', 'A', 'B', 'B', 'A', 'A', 'B', 'B', 'B'];
const ANCHOR = '2026-01-05';

function config(opts: Partial<RotaConfig> = {}): RotaConfig {
  const cfg: RotaConfig = {
    patterns: [{ id: 'p223', effectiveFrom: ANCHOR, anchor: ANCHOR, cycle: CYCLE_223 }],
    school: { schoolStart: '08:45', closures: [] },
    overrides: [],
    ...opts,
  };
  validateConfig(cfg);
  return cfg;
}

/** London wall-clock time to instant. */
const L = londonToInstant;
/** Instant to 'YYYY-MM-DD HH:MM' London, so failures are readable. */
const F = formatLondon;

function who(cfg: RotaConfig, date: string, time: string, audience: 'viewer' | 'editor' = 'viewer') {
  const r = responsibleAt(L(date, time), cfg, audience);
  return { parent: r.parent, since: F(r.since), until: F(r.until), next: r.next, source: r.segment.source, pending: !!r.segment.pending };
}

let seq = 0;
function override(o: Partial<Override> & Pick<Override, 'start' | 'end' | 'parent'>): Override {
  seq++;
  return { id: `o${seq}`, status: 'confirmed', note: 'test', createdBy: 'A', createdAt: seq, decidedAt: seq, ...o };
}

// ---------------------------------------------------------------------------

describe('London time helpers', () => {
  it('knows GMT and BST offsets either side of both 2026 clock changes', () => {
    assert.equal(londonOffsetMinutes(Date.UTC(2026, 2, 29, 0, 59)), 0);
    assert.equal(londonOffsetMinutes(Date.UTC(2026, 2, 29, 1, 0)), 60);
    assert.equal(londonOffsetMinutes(Date.UTC(2026, 9, 25, 0, 59)), 60);
    assert.equal(londonOffsetMinutes(Date.UTC(2026, 9, 25, 1, 0)), 0);
  });

  it('converts London wall time to UTC in winter and summer', () => {
    assert.equal(L('2026-01-15', '08:45'), Date.UTC(2026, 0, 15, 8, 45));
    assert.equal(L('2026-06-15', '08:45'), Date.UTC(2026, 5, 15, 7, 45));
  });

  it('moves a time in the spring gap forward (01:30 becomes 02:30 BST)', () => {
    assert.equal(L('2026-03-29', '01:30'), Date.UTC(2026, 2, 29, 1, 30));
    assert.equal(F(L('2026-03-29', '01:30')), '2026-03-29 02:30');
  });

  it('picks the first (BST) 01:30 in the repeated autumn hour', () => {
    assert.equal(L('2026-10-25', '01:30'), Date.UTC(2026, 9, 25, 0, 30));
  });

  it('does calendar arithmetic by date, not by 24-hour blocks', () => {
    assert.equal(addDays('2026-03-28', 2), '2026-03-30');
    assert.equal(addDays('2026-10-24', 2), '2026-10-26');
    assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  });
});

describe('Base pattern repetition', () => {
  it('follows the 14-night cycle for every night over two years', () => {
    const cfg = config();
    for (let k = 0; k < 730; k++) {
      const d = addDays(ANCHOR, k);
      assert.equal(baseNightParent(d, cfg), CYCLE_223[k % 14], `night of ${d}`);
      assert.equal(baseNightParent(d, cfg), baseNightParent(addDays(d, 14), cfg), `${d} vs +14`);
    }
  });

  it('gives the right overnight parent at 23:00 every day for 13 months, across both clock changes', () => {
    const cfg = config();
    for (let k = 0; k < 400; k++) {
      const d = addDays(ANCHOR, k);
      assert.equal(responsibleAt(L(d, '23:00'), cfg, 'viewer').parent, CYCLE_223[k % 14], d);
    }
  });

  it('spot checks a year on: Mon 21 Dec 2026 is 25 cycles after the anchor, so A', () => {
    assert.equal(daysBetween(ANCHOR, '2026-12-21'), 25 * 14);
    assert.equal(baseNightParent('2026-12-21', config()), 'A');
    assert.equal(baseNightParent('2026-12-23', config()), 'B');
  });

  it('works for dates before the anchor if the pattern starts earlier', () => {
    const cfg = config({ patterns: [{ id: 'p', effectiveFrom: '2025-12-01', anchor: ANCHOR, cycle: CYCLE_223 }] });
    assert.equal(baseNightParent('2026-01-04', cfg), 'B'); // cycle[13]
    assert.equal(baseNightParent('2026-01-01', cfg), 'A'); // cycle[10]
  });

  it('reports no parent before the first pattern starts', () => {
    const r = responsibleAt(L('2025-12-25', '12:00'), config(), 'viewer');
    assert.equal(r.parent, null);
    assert.equal(r.segment.source, 'none');
    assert.equal(F(r.until), '2026-01-05 08:45');
    assert.equal(r.next, 'A');
  });
});

describe('Handovers either side of a weekend (term time, June 2026, BST)', () => {
  // w/c 8 Jun 2026 is week 1, w/c 15 Jun is week 2.
  const cfg = config();

  it('hands over at school start on Friday, not at pick-up', () => {
    assert.equal(who(cfg, '2026-06-12', '08:44').parent, 'B');
    assert.equal(who(cfg, '2026-06-12', '08:45').parent, 'A');
  });

  it('Friday parent keeps the children all weekend until school start Monday', () => {
    const expected = { parent: 'A', since: '2026-06-12 08:45', until: '2026-06-15 08:45', next: 'B', source: 'base', pending: false };
    assert.deepEqual(who(cfg, '2026-06-12', '15:15'), expected); // school pick-up
    assert.deepEqual(who(cfg, '2026-06-13', '12:00'), expected);
    assert.deepEqual(who(cfg, '2026-06-14', '17:30'), expected); // Sunday evening
    assert.deepEqual(who(cfg, '2026-06-15', '07:30'), expected); // Monday school run
  });

  it('Monday school start switches to the other parent', () => {
    assert.deepEqual(who(cfg, '2026-06-15', '09:00'), {
      parent: 'B', since: '2026-06-15 08:45', until: '2026-06-17 08:45', next: 'A', source: 'base', pending: false,
    });
  });

  it('the following weekend belongs to the other parent', () => {
    assert.deepEqual(who(cfg, '2026-06-20', '12:00'), {
      parent: 'B', since: '2026-06-19 08:45', until: '2026-06-22 08:45', next: 'A', source: 'base', pending: false,
    });
  });

  it('lists every handover over the fortnight at school start', () => {
    const list = handovers(L('2026-06-08', '00:00'), L('2026-06-22', '23:59'), cfg, 'viewer')
      .map((h) => `${F(h.at)} ${h.from}->${h.to}`);
    assert.deepEqual(list, [
      '2026-06-08 08:45 B->A',
      '2026-06-10 08:45 A->B',
      '2026-06-12 08:45 B->A',
      '2026-06-15 08:45 A->B',
      '2026-06-17 08:45 B->A',
      '2026-06-19 08:45 A->B',
      '2026-06-22 08:45 B->A',
    ]);
  });

  it('bank holiday Monday moves the handover to 17:00', () => {
    // Fri 22 May (week 2) B; Mon 25 May (week 1, bank holiday) A.
    const bh = config({ school: { schoolStart: '08:45', closures: [{ from: '2026-05-25', to: '2026-05-25' }] } });
    assert.deepEqual(who(bh, '2026-05-25', '12:00'), {
      parent: 'B', since: '2026-05-22 08:45', until: '2026-05-25 17:00', next: 'A', source: 'base', pending: false,
    });
    assert.equal(who(bh, '2026-05-25', '17:00').parent, 'A');
  });

  it('INSET day Friday moves the handover to 17:00', () => {
    const inset = config({ school: { schoolStart: '08:45', closures: [{ from: '2026-06-12', to: '2026-06-12' }] } });
    assert.equal(who(inset, '2026-06-12', '10:00').parent, 'B');
    assert.equal(who(inset, '2026-06-12', '10:00').until, '2026-06-12 17:00');
    assert.equal(who(inset, '2026-06-12', '17:00').parent, 'A');
  });

  it('uses the pattern\'s own non-school handover time when set', () => {
    const c = config({
      patterns: [{ id: 'p', effectiveFrom: ANCHOR, anchor: ANCHOR, cycle: CYCLE_223, nonSchoolHandover: '18:30' }],
      school: { schoolStart: '08:45', closures: [{ from: '2026-05-25', to: '2026-05-25' }] },
    });
    assert.equal(who(c, '2026-05-25', '12:00').until, '2026-05-25 18:30');
  });
});

describe('Clock changes', () => {
  const cfg = config();

  it('spring forward: weekend 27 to 30 Mar 2026 is 71 real hours and handovers stay at 08:45 local', () => {
    // w/c 23 Mar is week 2: Fri B; Mon 30 Mar is week 1: A.
    const r = responsibleAt(L('2026-03-28', '12:00'), cfg, 'viewer');
    assert.equal(r.parent, 'B');
    assert.equal(r.since, Date.UTC(2026, 2, 27, 8, 45)); // 08:45 GMT
    assert.equal(r.until, Date.UTC(2026, 2, 30, 7, 45)); // 08:45 BST
    assert.equal((r.until - r.since) / 3_600_000, 71);
    assert.equal(F(r.until), '2026-03-30 08:45');
  });

  it('spring forward: works during the missing hour', () => {
    assert.equal(responsibleAt(Date.UTC(2026, 2, 29, 0, 59), cfg, 'viewer').parent, 'B'); // 00:59 GMT
    assert.equal(responsibleAt(Date.UTC(2026, 2, 29, 1, 0), cfg, 'viewer').parent, 'B'); // 02:00 BST
  });

  it('fall back: weekend 23 to 26 Oct 2026 is 73 real hours and handovers stay at 08:45 local', () => {
    // w/c 19 Oct is week 2: Fri B; Mon 26 Oct is week 1: A.
    const r = responsibleAt(L('2026-10-24', '12:00'), cfg, 'viewer');
    assert.equal(r.parent, 'B');
    assert.equal(r.since, Date.UTC(2026, 9, 23, 7, 45)); // 08:45 BST
    assert.equal(r.until, Date.UTC(2026, 9, 26, 8, 45)); // 08:45 GMT
    assert.equal((r.until - r.since) / 3_600_000, 73);
  });

  it('fall back: both copies of the repeated 01:30 give the same parent', () => {
    assert.equal(responsibleAt(Date.UTC(2026, 9, 25, 0, 30), cfg, 'viewer').parent, 'B');
    assert.equal(responsibleAt(Date.UTC(2026, 9, 25, 1, 30), cfg, 'viewer').parent, 'B');
  });

  it('a 17:00 handover on the clock-change Sunday itself lands at 17:00 local', () => {
    // Week-on/week-off changing on Sundays, anchored on the spring change day.
    const weekly = config({
      patterns: [{ id: 'w', effectiveFrom: '2026-01-01', anchor: '2026-03-29', cycle: [...'AAAAAAABBBBBBB'] as Parent[] }],
    });
    const spring = handovers(L('2026-03-29', '00:00'), L('2026-03-30', '00:00'), weekly, 'viewer');
    assert.deepEqual(spring.map((h) => [h.at, h.from, h.to]), [[Date.UTC(2026, 2, 29, 16, 0), 'B', 'A']]);
    const autumn = handovers(L('2026-10-25', '00:00'), L('2026-10-26', '00:00'), weekly, 'viewer');
    assert.deepEqual(autumn.map((h) => [h.at, h.from, h.to]), [[Date.UTC(2026, 9, 25, 17, 0), 'B', 'A']]);
  });

  it('handles the 2027 changes as well (28 Mar and 31 Oct)', () => {
    for (const d of ['2027-03-26', '2027-03-29', '2027-10-29', '2027-11-01']) {
      const h = handovers(L(d, '00:00'), L(d, '23:59'), cfg, 'viewer');
      assert.equal(h.length, 1, d);
      assert.equal(F(h[0].at), `${d} 08:45`);
    }
  });
});

describe('Overrides', () => {
  // Thu 11 Jun 2026 (week 1) base is B from Wed 10 08:45 to Fri 12 08:45.
  const swap = () => override({ start: L('2026-06-11', '08:45'), end: L('2026-06-12', '08:45'), parent: 'A' });

  it('a confirmed override beats the base pattern', () => {
    const cfg = config({ overrides: [swap()] });
    assert.deepEqual(who(cfg, '2026-06-11', '20:00'), {
      parent: 'A', since: '2026-06-11 08:45', until: '2026-06-15 08:45', next: 'B', source: 'override', pending: false,
    });
    assert.equal(who(cfg, '2026-06-10', '20:00').until, '2026-06-11 08:45');
  });

  it('a pending override is hidden from viewers but shown to editors, flagged', () => {
    const cfg = config({ overrides: [{ ...swap(), status: 'pending', decidedAt: null }] });
    assert.equal(who(cfg, '2026-06-11', '20:00', 'viewer').parent, 'B');
    assert.equal(who(cfg, '2026-06-11', '20:00', 'viewer').source, 'base');
    const ed = who(cfg, '2026-06-11', '20:00', 'editor');
    assert.equal(ed.parent, 'A');
    assert.equal(ed.pending, true);
  });

  it('a rejected override is ignored by everyone', () => {
    const cfg = config({ overrides: [{ ...swap(), status: 'rejected' }] });
    assert.equal(who(cfg, '2026-06-11', '20:00', 'viewer').parent, 'B');
    assert.equal(who(cfg, '2026-06-11', '20:00', 'editor').parent, 'B');
  });

  it('where confirmed overrides overlap, the later confirmation wins, whatever order they are stored in', () => {
    const early = override({ start: L('2026-06-10', '12:00'), end: L('2026-06-12', '12:00'), parent: 'A', decidedAt: 100 });
    const late = override({ start: L('2026-06-11', '12:00'), end: L('2026-06-11', '18:00'), parent: 'B', decidedAt: 200 });
    for (const overrides of [[early, late], [late, early]]) {
      const cfg = config({ overrides });
      assert.equal(who(cfg, '2026-06-11', '10:00').parent, 'A');
      assert.equal(who(cfg, '2026-06-11', '13:00').parent, 'B');
      assert.equal(who(cfg, '2026-06-11', '19:00').parent, 'A');
    }
  });

  it('a pending override sits on top of confirmed ones in the editor view only', () => {
    const confirmed = override({ start: L('2026-06-11', '08:45'), end: L('2026-06-12', '08:45'), parent: 'A', decidedAt: 100 });
    const pending = override({ start: L('2026-06-11', '12:00'), end: L('2026-06-11', '18:00'), parent: 'B', status: 'pending', createdAt: 50, decidedAt: null });
    const cfg = config({ overrides: [pending, confirmed] });
    assert.equal(who(cfg, '2026-06-11', '13:00', 'viewer').parent, 'A');
    assert.equal(who(cfg, '2026-06-11', '13:00', 'editor').parent, 'B');
  });

  it('an override matching the base parent does not create a false handover', () => {
    const cfg = config({ overrides: [override({ start: L('2026-06-13', '09:00'), end: L('2026-06-13', '18:00'), parent: 'A' })] });
    const r = who(cfg, '2026-06-13', '12:00');
    assert.equal(r.since, '2026-06-12 08:45');
    assert.equal(r.until, '2026-06-15 08:45');
  });
});

describe('Multi-night holiday override spanning a weekend (and the October clock change)', () => {
  // October half term 2026 closed Mon 26 to Fri 30 Oct.
  // Base: Wed 21 A, Thu 22 A, Fri 23 B, Sat 24 B, Sun 25 B, Mon 26 A, Tue 27 A, Wed 28 B.
  // B takes the children away from Thu 22 Oct school pick-up (15:30) until Tue 27 Oct 17:00.
  const school = { schoolStart: '08:45', closures: [{ from: '2026-10-26', to: '2026-10-30', label: 'Half term' }] };
  const holiday = (status: Override['status']) =>
    override({
      start: L('2026-10-22', '15:30'),
      end: L('2026-10-27', '17:00'),
      parent: 'B',
      status,
      createdBy: 'B',
      decidedAt: status === 'pending' ? null : 999,
      note: 'Half-term holiday with B',
    });

  it('without the override, handovers are Fri 08:45, Mon 17:00 and Wed 17:00', () => {
    const cfg = config({ school });
    const list = handovers(L('2026-10-22', '00:00'), L('2026-10-29', '00:00'), cfg, 'viewer').map((h) => `${F(h.at)} ${h.from}->${h.to}`);
    assert.deepEqual(list, ['2026-10-23 08:45 A->B', '2026-10-26 17:00 B->A', '2026-10-28 17:00 A->B']);
  });

  it('once confirmed, B is responsible for the whole holiday, including base-pattern A nights', () => {
    const cfg = config({ school, overrides: [holiday('confirmed')] });
    const during = { parent: 'B', since: '2026-10-22 15:30', until: '2026-10-27 17:00', next: 'A', source: 'override', pending: false };
    assert.deepEqual(who(cfg, '2026-10-22', '20:00'), during); // Thu, base A
    assert.deepEqual(who(cfg, '2026-10-24', '12:00'), during); // Sat
    assert.deepEqual(who(cfg, '2026-10-25', '01:30'), during); // Sun, repeated hour
    assert.deepEqual(who(cfg, '2026-10-26', '20:00'), during); // Mon, base A
  });

  it('before and after the holiday the base pattern resumes', () => {
    const cfg = config({ school, overrides: [holiday('confirmed')] });
    assert.deepEqual(who(cfg, '2026-10-22', '12:00'), {
      parent: 'A', since: '2026-10-21 08:45', until: '2026-10-22 15:30', next: 'B', source: 'base', pending: false,
    });
    assert.deepEqual(who(cfg, '2026-10-27', '17:00'), {
      parent: 'A', since: '2026-10-27 17:00', until: '2026-10-28 17:00', next: 'B', source: 'base', pending: false,
    });
  });

  it('lists the handovers with the override in place', () => {
    const cfg = config({ school, overrides: [holiday('confirmed')] });
    const list = handovers(L('2026-10-22', '00:00'), L('2026-10-29', '00:00'), cfg, 'viewer').map((h) => `${F(h.at)} ${h.from}->${h.to}`);
    assert.deepEqual(list, ['2026-10-22 15:30 A->B', '2026-10-27 17:00 B->A', '2026-10-28 17:00 A->B']);
  });

  it('while pending, viewers still see the base pattern and editors see the holiday flagged', () => {
    const cfg = config({ school, overrides: [holiday('pending')] });
    assert.equal(who(cfg, '2026-10-26', '20:00', 'viewer').parent, 'A');
    assert.deepEqual(who(cfg, '2026-10-26', '20:00', 'editor'), {
      parent: 'B', since: '2026-10-22 15:30', until: '2026-10-27 17:00', next: 'A', source: 'override', pending: true,
    });
  });

  it('month view marks the holiday days and their overnight parent', () => {
    const cfg = config({ school, overrides: [holiday('confirmed')] });
    const oct = monthView(2026, 10, cfg, 'viewer');
    assert.equal(oct.length, 31);
    const byDate = Object.fromEntries(oct.map((d) => [d.date, d]));
    for (const d of ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']) {
      assert.equal(byDate[d].nightParent, 'B', d);
      assert.equal(byDate[d].hasOverride, true, d);
    }
    assert.equal(byDate['2026-10-27'].nightParent, 'A');
    assert.deepEqual(byDate['2026-10-22'].handovers.map((h) => [h.time, h.to]), [['15:30', 'B']]);
    assert.deepEqual(byDate['2026-10-23'].handovers, []);
    assert.equal(byDate['2026-10-26'].schoolDay, false);
    assert.equal(byDate['2026-10-21'].hasOverride, false);
  });
});

describe('Changing to a new pattern later', () => {
  // Switch to 2-2-5-5 from Mon 4 Jan 2027 with an 18:00 non-school handover.
  //   Week 1: Mon A Tue A Wed B Thu B Fri A Sat A Sun A
  //   Week 2: Mon A Tue A Wed B Thu B Fri B Sat B Sun B
  const CYCLE_2255: Parent[] = [...'AABBAAAAABBBBB'] as Parent[];
  const original = config();
  const changed = config({
    patterns: [
      ...original.patterns,
      { id: 'p2255', effectiveFrom: '2027-01-04', anchor: '2027-01-04', cycle: CYCLE_2255, nonSchoolHandover: '18:00' },
    ],
  });

  it('leaves every night before the change exactly as it was', () => {
    for (let d = ANCHOR; d < '2027-01-04'; d = addDays(d, 1)) {
      assert.equal(baseNightParent(d, changed), baseNightParent(d, original), d);
      const t = L(d, '12:00');
      assert.equal(responsibleAt(t, changed, 'viewer').parent, responsibleAt(t, original, 'viewer').parent, d);
    }
  });

  it('follows the new cycle from the change date for a year', () => {
    for (let k = 0; k < 400; k++) {
      const d = addDays('2027-01-04', k);
      assert.equal(baseNightParent(d, changed), CYCLE_2255[k % 14], d);
    }
  });

  it('uses the new pattern\'s non-school handover time', () => {
    // Sun 3 Jan 2027 night is old pattern (A), Mon 4 Jan is new pattern (A). Sat 9 Jan (A), Mon 11 A... check a
    // non-school handover: add a closure on Wed 6 Jan 2027 where night Wed is B.
    const c = config({ patterns: changed.patterns, school: { schoolStart: '08:45', closures: [{ from: '2027-01-06', to: '2027-01-06' }] } });
    assert.equal(who(c, '2027-01-06', '12:00').until, '2027-01-06 18:00');
  });

  it('overrides made before the change still apply', () => {
    const o = override({ start: L('2027-01-05', '08:45'), end: L('2027-01-06', '08:45'), parent: 'B' });
    const c = config({ patterns: changed.patterns, overrides: [o] });
    assert.equal(who(c, '2027-01-05', '20:00').parent, 'B');
  });
});

describe('Validation', () => {
  it('rejects bad patterns, times and overrides', () => {
    assert.throws(() => config({ patterns: [] }));
    assert.throws(() => config({ patterns: [{ id: 'x', effectiveFrom: '2026-02-30', anchor: ANCHOR, cycle: CYCLE_223 }] }));
    assert.throws(() => config({ patterns: [{ id: 'x', effectiveFrom: ANCHOR, anchor: ANCHOR, cycle: ['A', 'C' as Parent] }] }));
    assert.throws(() => config({ school: { schoolStart: '8:45' } }));
    assert.throws(() => config({ overrides: [override({ start: 10, end: 10, parent: 'A' })] }));
  });
});
