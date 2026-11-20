// Approval flags in plain words, and which Main Summary row each one belongs next to (U9).
// TODO(S11): when S's engine lands, FLAG_TEXT should call flagDef(rule)?.explain(detail) and fall back to this table.
import type { CategoryKey } from '../../../src/engine/rollup';

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

export const FLAG_TEXT = (f: { rule: string; detail?: any }) =>
  (TEXT[f.rule] ?? (() => f.rule.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())))(f.detail);

/** S flags carry `section` (sections.ts SectionKey); map it to the Main Summary row to show the flag under. */
const SECTION_ROW: Record<string, CategoryKey> = { structural: 'structural', plate: 'plate', stdParts: 'stdParts', products: 'stairways', vendor: 'vendor',
  costBased: 'costBased', paint: 'painting', shopLabor: 'shopLabor', pmCad: 'pmMarketing', install: 'onsiteLabor', travel: 'travel', equipment: 'equipment' };
export function flagRow(f: { rule: string; section?: string } | string): CategoryKey | null {
  const rule = typeof f === 'string' ? f : f.rule, sec = typeof f === 'string' ? undefined : f.section;
  if (sec) return SECTION_ROW[sec] ?? null;
  if (rule.startsWith('INSTALL')) return 'onsiteLabor';
  if (rule.startsWith('PV') || rule === 'FAMILY_PV_DROP') return 'costBased';
  return null;   // whole quote: shown in the bar above the sheet
}
