// Approval flags in plain words, and which Main Summary row each one belongs next to (U9).
import type { CategoryKey } from '../../../src/engine/rollup';

const TEXT: Record<string, (d: any) => string> = {
  INSTALL_BELOW_SUGGESTED: d => `Install hours ${num(d?.quoted)} are below the suggested ${num(d?.suggested)}`,
  INSTALL_MANUAL_NO_SUGGESTION: () => 'Install was entered by hand with no suggested amount',
  INSTALL_RECLASSIFIED: () => 'Install labor was moved out of the install rows',
  PV_BELOW_FLOOR: d => `Freestanding Production Value lowered to $${num(d?.used)}/shop h (floor $${num(d?.floor)})`,
  PV_DROPPED: () => 'Freestanding Production Value dropped',
  CLASS_D: () => 'Class D crane',
  GM_BELOW_FLOOR: d => `Gross margin ${pct(d?.gmPct ?? d?.gm)} is below the ${pct(d?.floor ?? d?.min)} floor`,
  MARGIN_BELOW_FLOOR: d => `Gross margin ${pct(d?.gmPct ?? d?.gm)} is below the ${pct(d?.floor ?? d?.min)} floor`,
  MARKUP_ZERO: d => `No markup on ${d?.description ? `"${d.description}"` : 'a material line'}`,
  DISCOUNT_ABOVE_MAX: d => `Discount ${pct(d?.discount ?? d?.pct)} is above 10%`,
  DISCOUNT_ABOVE_X: d => `Discount ${pct(d?.discount ?? d?.pct)} is above 10%`,
};
const num = (x: unknown) => (typeof x === 'number' ? String(Math.round(x * 10) / 10) : '—');
const pct = (x: unknown) => (typeof x === 'number' ? `${(x * (x <= 1 ? 100 : 1)).toFixed(1)}%` : '—');

export const FLAG_TEXT = (f: { rule: string; detail?: any }) =>
  (TEXT[f.rule] ?? (() => f.rule.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())))(f.detail);

export function flagRow(rule: string): CategoryKey | null {
  if (rule.startsWith('INSTALL')) return 'onsiteLabor';
  if (rule.startsWith('PV')) return 'costBased';
  return null;   // shown in the top bar
}
