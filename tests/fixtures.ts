import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Cell = [string | null, number | string | boolean];
export interface Fixture { job: string; file: string; aqt: boolean; sheets: Record<string, Record<string, Cell>>; wording: string[] }

const DIR = join(__dirname, '..', 'fixtures');
export function loadFixtures(): Fixture[] {
  return readdirSync(DIR).filter(f => /^\d{5}\.json$/.test(f)).map(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Fixture);
}
export const smtFixtures = () => loadFixtures().filter(f => !f.aqt);

export const num = (f: Fixture, sheet: string, ref: string): number => {
  const v = f.sheets[sheet]?.[ref]?.[1];
  return typeof v === 'number' ? v : 0;
};
export const raw = (f: Fixture, sheet: string, ref: string) => f.sheets[sheet]?.[ref]?.[1];
export const formula = (f: Fixture, sheet: string, ref: string) => f.sheets[sheet]?.[ref]?.[0] ?? null;
export const hasFormula = (f: Fixture, sheet: string, ref: string) => formula(f, sheet, ref) !== null;

/** Row numbers present on a sheet. */
export function rows(f: Fixture, sheet: string): number[] {
  const s = new Set<number>();
  for (const ref of Object.keys(f.sheets[sheet] ?? {})) s.add(Number(ref.replace(/^[A-Z]+/, '')));
  return [...s].sort((a, b) => a - b);
}

/** Relative error check that tolerates Excel float noise. */
export const close = (a: number, b: number, abs = 0.005) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * 1e-9);
