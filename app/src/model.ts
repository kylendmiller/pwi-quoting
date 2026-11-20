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
  const q = (n?: number) => (n && n > 1 ? `(${n}) ` : '');
  const site = it.install ? `, installed (${it.miles ?? 0} mi)` : ', ship only';
  const h = it.overallHeightFt != null ? `${it.overallHeightFt}' overall` : it.hookHeightFt != null ? `${it.hookHeightFt}' under hook` : '';
  const paint = it.colors && Object.keys(it.colors).length ? `, colors: ${Object.entries(it.colors).map(([k, v]) => `${k} ${v}`).join(', ')}` : '';
  const drive = it.bridgeDrive ?? (it.motorized === false ? 'manual' : it.motorized ? 'motorized' : '');
  switch (it.type) {
    case 'freestanding':
      return `${it.systems > 1 ? it.systems + ' × ' : ''}FSTR${it.series ?? ''}${it.capacityTons} — ${it.capacityTons} ton, ${it.spanFt}' span × ${it.runwayOalFt}' runway, ${h}, ` +
        `${drive} bridge, ${it.control ?? (drive === 'motorized' ? 'radio' : 'pendant')}, ${it.voltage ?? '460V/3'}${paint}${site}`;
    case 'bridge': {
      const sup = ({ building_runway: 'on building runway', crane_columns: 'on new crane columns', bridge_only: 'bridge only (existing runway)', freestanding: 'freestanding' } as any)[it.support ?? 'building_runway'];
      return `${q(it.systems)}${it.hanging === 'underhung' ? 'Underhung' : 'Top running'} bridge crane — ${it.capacityTons} ton, ${it.spanFt}' span${it.runwayOalFt ? ` × ${it.runwayOalFt}' runway` : ''}${h ? `, ${h}` : ''}, ${sup}, ${drive || 'motorized'}${paint}${site}`;
    }
    case 'gantry': return `${q(it.qty)}Gantry crane — ${it.capacityTons} ton, ${it.spanFt}' span, ${it.heightUnderBeamFt ?? it.hookHeightFt}' ${it.heightUnderBeamFt ? 'under beam' : 'hook'}, ${it.motorized === false ? 'manual' : 'motorized'}${paint}${site}`;
    case 'monorail': return `${q(it.systems)}Monorail — ${it.capacityTons} ton, ${it.lengthFt}' long, ${it.support ?? 'freestanding'}${h ? `, ${h}` : ''}${site}`;
    case 'mezzanine': return `${q(it.qty)}Mezzanine — ${it.lengthFt}' × ${it.widthFt}' at ${it.deckHeightFt}' deck, ${it.liveLoadPsf ?? 125} psf, ${it.deck ?? 'B-deck + AdvanTech'}${it.stairs ? `, ${it.stairs} stair` : ''}${it.gates?.length ? `, ${it.gates.reduce((n: number, g: any) => n + (g.qty ?? 1), 0)} gate(s)` : ''}${site}`;
    case 'work_platform': return `${q(it.sets)}Work platform set — (2) ${it.lengthFt}' × ${it.widthFt ?? 4}' platforms, (4) towers + hoists${it.crosswalks ? `, ${Object.entries(it.crosswalks).filter(([k, v]) => k !== 'expandedLengthFt' && k !== 'wideUnits' && v).map(([k, v]) => `${v} ${k} crosswalk${Number(v) > 1 ? 's' : ''}`).join(', ')}` : ''}${site}`;
    case 'jib': return `${q(it.qty)}Jib crane — ${it.capacityTons} ton, ${it.spanFt}' reach, ${it.mount ?? 'floor'} mount${h ? `, ${h}` : ''}${it.hoist === false ? ', no hoist' : ''}${site}`;
    case 'fall_protection': return `${q(it.systems)}AnchorPoint fall protection — ${it.lengthFt}' track, supports every ${it.supportSpacingFt ?? 20}', ${it.people ?? 2} person${site}`;
    case 'vrc': return `${q(it.qty)}Apex VRC ${it.model}${it.noPit ? ', no pit' : ''}${it.hdColumns ? ', HD columns' : ''}${site}`;
    case 'catalog': return `${q(it.qty)}${it.description ?? it.item}${it.unitPrice != null ? ` @ $${it.unitPrice}` : ''}${site}`;
    default: return `${it.tag ?? it.type} — lines added by hand`;
  }
}
