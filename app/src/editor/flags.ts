// Approval flags in plain words, and which Main Summary row each one belongs next to (U9).
// Text comes from S's flagDef(rule).explain(detail); this table is the fallback for rules S doesn't list.
import type { CategoryKey } from '../../../src/engine/rollup';
import { flagText, flagDef } from './engineApi';

const TEXT: Record<string, (d: any) => string> = {
  INSTALL_BELOW_SUGGESTED: d => `Install hours ${num(d?.quoted)} are below the suggested ${num(d?.suggested)}`,
  INSTALL_MANUAL_NO_SUGGESTION: () => 'Install was entered by hand with no suggested amount',
  PV_BELOW_FLOOR: d => `Freestanding Production Value lowered to $${num(d?.used)}/shop h (floor $${num(d?.floor)})`,
  FAMILY_PV_DROP: () => 'Main product change dropped the freestanding Production Value',
  CLASS_D: () => 'Class D crane',
  MIN_GM: d => `Gross margin ${pct(d?.gmPct ?? d?.gm)} is below the ${pct(d?.min ?? d?.floor)} floor`,
  ZERO_MARKUP: d => `No markup on ${d?.description ? `"${d.description}"` : 'a material line'}`,
  BIG_DISCOUNT: d => `Discount ${pct(d?.discount ?? d?.pct)} is above ${pct(d?.max ?? 0.1)}`,
};
const num = (x: unknown) => (typeof x === 'number' ? String(Math.round(x * 10) / 10) : '—');
const pct = (x: unknown) => (typeof x === 'number' ? `${(x <= 1 ? x * 100 : x).toFixed(1)}%` : '—');

export const FLAG_TEXT = (f: { rule: string; detail?: any }) => {
  const s = f.detail ? flagText(f) : null;     // no detail (e.g. an approval row) → short table text
  if (s) return s.replace(/\s*—\s*needs a sales manager\.?$/, '').replace(/\.$/, '');
  return (TEXT[f.rule] ?? (() => f.rule.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())))(f.detail);
};

/** Short name of a rule (approval rows, void warnings): S's FlagDef.label. */
export const FLAG_LABEL = (rule: string) => flagDef(rule as any)?.label ?? FLAG_TEXT({ rule });

/** S flags carry `section` (sections.ts SectionKey); map it to the Main Summary row to show the flag under. */
const SECTION_ROW: Record<string, CategoryKey> = { structural: 'structural', plate: 'plate', stdParts: 'stdParts', products: 'stairways', vendor: 'vendor',
  costBased: 'costBased', paint: 'painting', shopLabor: 'shopLabor', pmCad: 'pmMarketing', install: 'onsiteLabor', travel: 'travel', equipment: 'equipment' };
export function flagRow(f: { rule: string; section?: string; lineKeys?: string[] } | string, lines?: { key: string; category: CategoryKey }[]): CategoryKey | null {
  const rule = typeof f === 'string' ? f : f.rule, sec = typeof f === 'string' ? undefined : f.section;
  if (sec) return SECTION_ROW[sec] ?? null;
  // Line-level flags (ZERO_MARKUP, BIG_DISCOUNT from a credit line): next to the row of the line that caused them.
  const k = typeof f === 'string' ? undefined : f.lineKeys?.[0];
  const hit = k && lines?.find(l => l.key === k);
  if (hit) return hit.category;
  if (rule.startsWith('INSTALL')) return 'onsiteLabor';
  if (rule.startsWith('PV') || rule === 'FAMILY_PV_DROP') return 'costBased';
  return null;   // whole quote: shown in the bar above the sheet
}
