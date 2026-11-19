import type { QuoteDoc, QuoteLine, LineKind } from '../../src/engine/manual';
import type { CategoryKey } from '../../src/engine/rollup';

export const FAMILIES = [
  { key: 'freestanding', label: 'Freestanding crane (FSTR)' },
  { key: 'bridge', label: 'Bridge crane (top running / underhung)' },
  { key: 'gantry', label: 'Gantry crane' },
  { key: 'monorail', label: 'Monorail' },
  { key: 'jib', label: 'Jib crane' },
  { key: 'mezzanine', label: 'Mezzanine' },
  { key: 'stairs', label: 'Stairs (manual)' },
  { key: 'vrc', label: 'VRC' },
  { key: 'fall_protection', label: 'Fall protection' },
  { key: 'rv_rotator', label: 'RV / rotators' },
  { key: 'work_platform', label: 'Work platforms' },
  { key: 'other', label: 'Other / custom' },
];

export const CATEGORIES: { key: CategoryKey; label: string; kind: LineKind }[] = [
  { key: 'structural', label: 'Structural steel', kind: 'material' },
  { key: 'plate', label: 'Plate', kind: 'material' },
  { key: 'stdParts', label: 'Standard parts', kind: 'material' },
  { key: 'vendor', label: 'Hoist & crane vendor items', kind: 'material' },
  { key: 'costBased', label: 'Cost-based items', kind: 'material' },
  { key: 'stairways', label: 'Stairways', kind: 'material' },
  { key: 'painting', label: 'Painting / coatings', kind: 'material' },
  { key: 'decals', label: 'Decals', kind: 'material' },
  { key: 'concrete', label: 'Concrete', kind: 'material' },
  { key: 'vrc', label: 'VRC', kind: 'material' },
  { key: 'inboundFreight', label: 'Inbound freight', kind: 'material' },
  { key: 'shopLabor', label: 'Shop labor (hours)', kind: 'shop_labor' },
  { key: 'onsiteLabor', label: 'On-site install (hours)', kind: 'site_labor' },
  { key: 'travel', label: 'Travel', kind: 'travel' },
  { key: 'equipment', label: 'On-site equipment', kind: 'equipment' },
  { key: 'pmMarketing', label: 'Project management (hours)', kind: 'pm' },
  { key: 'cad', label: 'AutoCAD design (hours)', kind: 'cad' },
  { key: 'engineering', label: 'P.E. calcs (hours)', kind: 'engineering' },
];
export const kindOf = (c: CategoryKey) => CATEGORIES.find(x => x.key === c)?.kind ?? 'material';
export const isHours = (k: LineKind) => !['material', 'travel', 'equipment'].includes(k);

export function emptyDoc(family: string): QuoteDoc {
  return { family, lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false,
    suggestedInstallHours: null, freestandingShopHours: 0, pvPerHourOverride: null, wording: '', options: [] };
}
export const newLine = (category: CategoryKey, family: string, over: Partial<QuoteLine> = {}): QuoteLine =>
  ({ key: Math.random().toString(36).slice(2, 10), kind: kindOf(category), category, family, description: '', qty: 1, ...over });

/** One-line plain-English description of a spec item. */
export function describe(it: any): string {
  if (it.type !== 'freestanding') return `${it.tag ?? it.type} — lines added by hand`;
  const h = it.overallHeightFt != null ? `${it.overallHeightFt}' overall` : `${it.hookHeightFt}' under hook`;
  return `${it.systems > 1 ? it.systems + ' × ' : ''}FSTR${it.series}${it.capacityTons} — ${it.capacityTons} ton, ${it.spanFt}' span × ${it.runwayOalFt}' runway, ${h}, ` +
    `${it.bridgeDrive} bridge, ${it.control ?? (it.bridgeDrive === 'motorized' ? 'radio' : 'pendant')}, ${it.voltage}` +
    (it.colors && Object.keys(it.colors).length ? `, colors: ${Object.entries(it.colors).map(([k, v]) => `${k} ${v}`).join(', ')}` : '') +
    (it.install ? `, installed (${it.miles} mi)` : ', ship only');
}
