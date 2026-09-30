// Europe/London date and time helpers with no dependencies.
//
// Conventions used throughout the rota engine:
//   - A "date" is a London calendar date string, 'YYYY-MM-DD'.
//   - A "time" is a London wall-clock time string, 'HH:MM'.
//   - An "instant" is a UTC millisecond timestamp (number), as from Date.now().
// All storage and comparison uses instants. Dates and times are only for
// people-facing input and output, and are always Europe/London.

export const TIME_ZONE = 'Europe/London';

const MINUTE = 60_000;
const DAY = 86_400_000;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(instant: number): WallParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(new Date(instant))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as unknown as WallParts;
}

/** London's offset from UTC at the given instant, in minutes (0 in GMT, 60 in BST). */
export function londonOffsetMinutes(instant: number): number {
  const p = wallParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MINUTE);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function assertDate(date: string): void {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Invalid date '${date}', expected YYYY-MM-DD`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new RangeError(`Invalid date '${date}'`);
  }
}

export function assertTime(time: string): void {
  if (!TIME_RE.test(time)) throw new RangeError(`Invalid time '${time}', expected HH:MM`);
}

/**
 * Convert a London wall-clock date and time to a UTC instant.
 * - Autumn "fall back" (01:00-01:59 happens twice): the earlier, BST, one is used.
 * - Spring "spring forward" (01:00-01:59 does not exist): the time is moved
 *   forward by the gap, so 01:30 becomes 02:30 BST.
 */
export function londonToInstant(date: string, time: string): number {
  assertDate(date);
  assertTime(time);
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const offsets = new Set([londonOffsetMinutes(naive - DAY), londonOffsetMinutes(naive + DAY)]);
  const matches = [...offsets]
    .map((off) => naive - off * MINUTE)
    .filter((t) => {
      const p = wallParts(t);
      return p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi;
    })
    .sort((a, b) => a - b);
  if (matches.length > 0) return matches[0];
  // In the spring gap: interpret using the offset in force just before the gap.
  return naive - londonOffsetMinutes(naive - DAY) * MINUTE;
}

/** The London calendar date of an instant. */
export function londonDate(instant: number): string {
  const p = wallParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The London wall-clock time of an instant, 'HH:MM'. */
export function londonTime(instant: number): string {
  const p = wallParts(instant);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** 'YYYY-MM-DD HH:MM' in London time, for tests and logs. */
export function formatLondon(instant: number): string {
  return `${londonDate(instant)} ${londonTime(instant)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dateToUtcMidnight(date: string): number {
  assertDate(date);
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMidnightToDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Calendar arithmetic on date strings (unaffected by clock changes). */
export function addDays(date: string, days: number): string {
  return utcMidnightToDate(dateToUtcMidnight(date) + days * DAY);
}

/** Whole calendar days from a to b (positive if b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateToUtcMidnight(b) - dateToUtcMidnight(a)) / DAY);
}

/** ISO day of week: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const dow = new Date(dateToUtcMidnight(date)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Number of days in a month (month is 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
