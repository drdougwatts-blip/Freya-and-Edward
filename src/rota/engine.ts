// Rota engine: works out which parent is responsible at any instant.
//
// Plain functions over plain data, with no database, network or clock access,
// so the same code runs in tests, in the server and in the browser.
//
// How responsibility is decided:
//   1. Each calendar date D has a "night parent", taken from the pattern in
//      force on D: cycle[(D - anchor) mod cycle.length].
//   2. The night parent for D takes over at the handover time on D:
//        - school day:     the school start time (they are the contact from
//                          school start and collect at the end of the day)
//        - non-school day: the pattern's nonSchoolHandover time (default 17:00)
//      and stays responsible until the handover time on D+1.
//   3. Confirmed overrides are laid on top, in the order they were confirmed,
//      so a later confirmation beats an earlier one where they overlap.
//   4. Editors also see pending overrides laid on top (flagged as pending).
//      Viewers never see pending or rejected overrides.

import {
  addDays,
  assertDate,
  assertTime,
  daysBetween,
  daysInMonth,
  isoWeekday,
  londonDate,
  londonTime,
  londonToInstant,
} from './time.ts';

export type Parent = 'A' | 'B';
export type Audience = 'viewer' | 'editor';
export type OverrideStatus = 'pending' | 'confirmed' | 'rejected';

export const DEFAULT_NON_SCHOOL_HANDOVER = '17:00';

export interface Pattern {
  id: string;
  /** First date (London) this pattern applies to. It runs until the next pattern's effectiveFrom. */
  effectiveFrom: string;
  /** The date whose night is cycle[0]. May be before or equal to effectiveFrom. */
  anchor: string;
  /** Night-by-night allocation, usually 14 entries. */
  cycle: Parent[];
  /** Handover time on days with no school, 'HH:MM'. Default 17:00. */
  nonSchoolHandover?: string;
}

export interface Closure {
  /** Inclusive London dates. */
  from: string;
  to: string;
  label?: string;
}

export interface SchoolCalendar {
  /** School start time, 'HH:MM'. Responsibility changes at this time on school days. */
  schoolStart: string;
  /** ISO weekdays the school is open (1 = Monday). Default Monday to Friday. */
  schoolWeekdays?: number[];
  /** Holidays, INSET days and bank holidays. */
  closures?: Closure[];
}

export interface Override {
  id: string;
  /** UTC instants. The override covers [start, end). */
  start: number;
  end: number;
  parent: Parent;
  status: OverrideStatus;
  note: string;
  createdBy: Parent;
  createdAt: number;
  /** When it was confirmed or rejected. */
  decidedAt?: number | null;
}

export interface RotaConfig {
  patterns: Pattern[];
  school: SchoolCalendar;
  overrides: Override[];
}

export type SegmentSource = 'base' | 'override' | 'none';

/** A stretch of time with a single parent and a single reason. */
export interface Segment {
  start: number;
  end: number;
  /** null only before the first pattern starts. */
  parent: Parent | null;
  source: SegmentSource;
  patternId?: string;
  overrideId?: string;
  pending?: boolean;
}

/** Consecutive segments with the same parent, merged. This is what "until when" is based on. */
export interface Span {
  start: number;
  end: number;
  parent: Parent | null;
  segments: Segment[];
}

export interface Handover {
  at: number;
  from: Parent | null;
  to: Parent | null;
}

export interface Responsibility {
  at: number;
  parent: Parent | null;
  /** When this parent's continuous responsibility began and ends. */
  since: number;
  until: number;
  /** Who takes over at `until`. */
  next: Parent | null;
  /** The segment in force at `at`, which says whether it is base pattern or an override. */
  segment: Segment;
}

export interface DaySummary {
  date: string;
  schoolDay: boolean;
  /** Parent responsible at 23:00 on this date, i.e. who has the children overnight. */
  nightParent: Parent | null;
  /** Handovers that happen during this date. */
  handovers: { time: string; at: number; from: Parent | null; to: Parent | null }[];
  /** True if any part of the date is covered by an override. */
  hasOverride: boolean;
  /** True if any part of the date is covered by a pending override (editor view only). */
  hasPending: boolean;
}

const DAY_MS = 86_400_000;

export function otherParent(p: Parent): Parent {
  return p === 'A' ? 'B' : 'A';
}

// ---------------------------------------------------------------------------
// Validation

export function validateConfig(cfg: RotaConfig): void {
  if (cfg.patterns.length === 0) throw new Error('At least one pattern is required');
  const seen = new Set<string>();
  for (const p of cfg.patterns) {
    assertDate(p.effectiveFrom);
    assertDate(p.anchor);
    if (p.nonSchoolHandover !== undefined) assertTime(p.nonSchoolHandover);
    if (p.cycle.length === 0) throw new Error(`Pattern ${p.id} has an empty cycle`);
    for (const n of p.cycle) {
      if (n !== 'A' && n !== 'B') throw new Error(`Pattern ${p.id} has an invalid entry '${n}'`);
    }
    if (seen.has(p.effectiveFrom)) throw new Error(`Two patterns start on ${p.effectiveFrom}`);
    seen.add(p.effectiveFrom);
  }
  assertTime(cfg.school.schoolStart);
  for (const c of cfg.school.closures ?? []) {
    assertDate(c.from);
    assertDate(c.to);
    if (c.to < c.from) throw new Error(`Closure ${c.from} to ${c.to} ends before it starts`);
  }
  for (const o of cfg.overrides) {
    if (!(o.end > o.start)) throw new Error(`Override ${o.id} must end after it starts`);
    if (o.parent !== 'A' && o.parent !== 'B') throw new Error(`Override ${o.id} has an invalid parent`);
  }
}

// ---------------------------------------------------------------------------
// Base pattern

function sortedPatterns(cfg: RotaConfig): Pattern[] {
  return [...cfg.patterns].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
}

/** The pattern in force on a date, or null if the date is before the first pattern. */
export function patternFor(date: string, cfg: RotaConfig): Pattern | null {
  let found: Pattern | null = null;
  for (const p of sortedPatterns(cfg)) {
    if (p.effectiveFrom <= date) found = p;
    else break;
  }
  return found;
}

export function isSchoolDay(date: string, school: SchoolCalendar): boolean {
  const weekdays = school.schoolWeekdays ?? [1, 2, 3, 4, 5];
  if (!weekdays.includes(isoWeekday(date))) return false;
  for (const c of school.closures ?? []) {
    if (date >= c.from && date <= c.to) return false;
  }
  return true;
}

/** The base-pattern parent for the night of a date (ignores overrides). */
export function baseNightParent(date: string, cfg: RotaConfig): Parent | null {
  const p = patternFor(date, cfg);
  if (!p) return null;
  const n = p.cycle.length;
  const idx = ((daysBetween(p.anchor, date) % n) + n) % n;
  return p.cycle[idx];
}

/** The instant on a date when the night parent for that date takes over. */
export function handoverInstant(date: string, cfg: RotaConfig): number {
  if (isSchoolDay(date, cfg.school)) return londonToInstant(date, cfg.school.schoolStart);
  const p = patternFor(date, cfg);
  return londonToInstant(date, p?.nonSchoolHandover ?? DEFAULT_NON_SCHOOL_HANDOVER);
}

function baseSegments(from: number, to: number, cfg: RotaConfig): Segment[] {
  const out: Segment[] = [];
  let date = addDays(londonDate(from), -1);
  let start = handoverInstant(date, cfg);
  for (;;) {
    const nextDate = addDays(date, 1);
    const end = handoverInstant(nextDate, cfg);
    if (start >= to) break;
    if (end > from) {
      const p = patternFor(date, cfg);
      out.push({
        start: Math.max(start, from),
        end: Math.min(end, to),
        parent: p ? baseNightParent(date, cfg) : null,
        source: p ? 'base' : 'none',
        ...(p ? { patternId: p.id } : {}),
      });
    }
    date = nextDate;
    start = end;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Overrides

/** Overrides in the order they apply (later in the list wins). */
export function applicableOverrides(overrides: Override[], audience: Audience): Override[] {
  const confirmed = overrides
    .filter((o) => o.status === 'confirmed')
    .sort((a, b) => (a.decidedAt ?? a.createdAt) - (b.decidedAt ?? b.createdAt));
  if (audience === 'viewer') return confirmed;
  const pending = overrides
    .filter((o) => o.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);
  return [...confirmed, ...pending];
}

function overlay(segs: Segment[], o: Override, from: number, to: number): Segment[] {
  const s = Math.max(o.start, from);
  const e = Math.min(o.end, to);
  if (s >= e) return segs;
  const out: Segment[] = [];
  for (const seg of segs) {
    if (seg.end <= s || seg.start >= e) {
      out.push(seg);
      continue;
    }
    if (seg.start < s) out.push({ ...seg, end: s });
    if (seg.end > e) out.push({ ...seg, start: e });
  }
  out.push({
    start: s,
    end: e,
    parent: o.parent,
    source: 'override',
    overrideId: o.id,
    ...(o.status === 'pending' ? { pending: true } : {}),
  });
  return out.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Public queries

/** Every segment in [from, to), base pattern with overrides laid on top. */
export function segments(from: number, to: number, cfg: RotaConfig, audience: Audience): Segment[] {
  let segs = baseSegments(from, to, cfg);
  for (const o of applicableOverrides(cfg.overrides, audience)) segs = overlay(segs, o, from, to);
  return segs;
}

/** Segments in [from, to) merged into continuous spans per parent. */
export function spans(from: number, to: number, cfg: RotaConfig, audience: Audience): Span[] {
  const out: Span[] = [];
  for (const seg of segments(from, to, cfg, audience)) {
    const last = out[out.length - 1];
    if (last && last.parent === seg.parent && last.end === seg.start) {
      last.end = seg.end;
      last.segments.push(seg);
    } else {
      out.push({ start: seg.start, end: seg.end, parent: seg.parent, segments: [seg] });
    }
  }
  return out;
}

/** Every change of responsible parent in [from, to). */
export function handovers(from: number, to: number, cfg: RotaConfig, audience: Audience): Handover[] {
  const sp = spans(from, to, cfg, audience);
  const out: Handover[] = [];
  for (let i = 1; i < sp.length; i++) out.push({ at: sp[i].start, from: sp[i - 1].parent, to: sp[i].parent });
  return out;
}

const MAX_LOOK_MS = 3 * 366 * DAY_MS;

/** Who is responsible at an instant, since when, until when, and who is next. */
export function responsibleAt(at: number, cfg: RotaConfig, audience: Audience): Responsibility {
  let back = 16 * DAY_MS;
  let fwd = 32 * DAY_MS;
  for (;;) {
    const from = at - back;
    const to = at + fwd;
    const sp = spans(from, to, cfg, audience);
    const i = sp.findIndex((s) => s.start <= at && at < s.end);
    const cur = sp[i];
    const truncatedBack = i === 0 && cur.parent !== null && back < MAX_LOOK_MS;
    const truncatedFwd = i === sp.length - 1 && fwd < MAX_LOOK_MS;
    if (!truncatedBack && !truncatedFwd) {
      const next = sp[i + 1];
      return {
        at,
        parent: cur.parent,
        since: cur.start,
        until: cur.end,
        next: next ? next.parent : null,
        segment: cur.segments.find((s) => s.start <= at && at < s.end)!,
      };
    }
    if (truncatedBack) back *= 2;
    if (truncatedFwd) fwd *= 2;
  }
}

/** One entry per date in a month, for the calendar view. month is 1-12. */
export function monthView(year: number, month: number, cfg: RotaConfig, audience: Audience): DaySummary[] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const n = daysInMonth(year, month);
  const from = londonToInstant(first, '00:00');
  const to = londonToInstant(addDays(first, n), '00:00');
  const segs = segments(from, to, cfg, audience);
  const hos = handovers(from, to, cfg, audience);
  const days: DaySummary[] = [];
  for (let k = 0; k < n; k++) {
    const date = addDays(first, k);
    const dayStart = londonToInstant(date, '00:00');
    const dayEnd = londonToInstant(addDays(date, 1), '00:00');
    const night = londonToInstant(date, '23:00');
    const within = segs.filter((s) => s.start < dayEnd && s.end > dayStart);
    days.push({
      date,
      schoolDay: isSchoolDay(date, cfg.school),
      nightParent: segs.find((s) => s.start <= night && night < s.end)?.parent ?? null,
      handovers: hos
        .filter((h) => h.at >= dayStart && h.at < dayEnd)
        .map((h) => ({ time: londonTime(h.at), at: h.at, from: h.from, to: h.to })),
      hasOverride: within.some((s) => s.source === 'override'),
      hasPending: within.some((s) => s.pending === true),
    });
  }
  return days;
}
