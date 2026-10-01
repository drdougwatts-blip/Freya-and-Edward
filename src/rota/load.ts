// Turns the human-edited rota.json into what the engine needs, with clear
// error messages for typos.

import { validateConfig, type Closure, type Override, type Parent, type RotaConfig } from './engine.ts';
import { londonToInstant } from './time.ts';

/** The shape of rota.json. Dates are 'YYYY-MM-DD', times 'HH:MM', London time. */
export interface RotaFile {
  /** The name shown on the page for each parent. */
  names: Record<Parent, string>;
  schoolStart: string;
  schoolWeekdays?: number[];
  patterns: {
    id: string;
    from: string;
    anchor: string;
    /** One letter per night starting at the anchor date, e.g. "AABBAAA BBAABBB". Spaces are ignored. */
    nights: string;
    nonSchoolHandover?: string;
  }[];
  closures?: Closure[];
  /** Later entries win where two overlap. */
  overrides?: { from: string; to: string; parent: Parent; note?: string }[];
}

function localDateTime(value: string, where: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(String(value).trim());
  if (!m) throw new Error(`${where}: '${value}' should look like 2026-10-22 15:30`);
  return londonToInstant(m[1], m[2]);
}

export function loadRota(file: RotaFile): RotaConfig {
  if (!file || !Array.isArray(file.patterns)) throw new Error('rota.json: "patterns" is missing');
  for (const k of ['A', 'B'] as const) {
    if (typeof file.names?.[k] !== 'string' || file.names[k].trim() === '') {
      throw new Error(`rota.json: "names" needs a name for ${k}`);
    }
  }
  const patterns = file.patterns.map((p, i) => {
    const nights = String(p.nights ?? '').replace(/[\s-]/g, '').toUpperCase();
    if (!/^[AB]+$/.test(nights)) throw new Error(`rota.json pattern ${i + 1}: "nights" must contain only A and B`);
    return {
      id: p.id ?? `pattern-${i + 1}`,
      effectiveFrom: p.from,
      anchor: p.anchor,
      cycle: nights.split('') as Parent[],
      ...(p.nonSchoolHandover ? { nonSchoolHandover: p.nonSchoolHandover } : {}),
    };
  });
  const overrides: Override[] = (file.overrides ?? []).map((o, i) => {
    const where = `rota.json override ${i + 1}`;
    if (o.parent !== 'A' && o.parent !== 'B') throw new Error(`${where}: "parent" must be "A" or "B"`);
    return {
      id: `override-${i + 1}`,
      start: localDateTime(o.from, where),
      end: localDateTime(o.to, where),
      parent: o.parent,
      status: 'confirmed',
      note: o.note ?? '',
      createdBy: o.parent,
      createdAt: i,
      decidedAt: i,
    };
  });
  const cfg: RotaConfig = {
    patterns,
    school: {
      schoolStart: file.schoolStart,
      ...(file.schoolWeekdays ? { schoolWeekdays: file.schoolWeekdays } : {}),
      closures: file.closures ?? [],
    },
    overrides,
  };
  try {
    validateConfig(cfg);
  } catch (e) {
    throw new Error(`rota.json: ${(e as Error).message}`);
  }
  return cfg;
}
