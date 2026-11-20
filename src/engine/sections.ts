// SMT-style section tree for the quote editor (round 3, builder C).
//   sectionize(doc, priced) → sections (Structural, Plate, Standard parts, Vendor, Cost based, Paint,
//   Shop labor, PM/CAD/P.E., On-site labor, Travel, Equipment) → subtotals (cost, sell, margin, hours, lb)
//   → lines (role, item, qty, $, lb, hours) → detail + basis (+ the assumption it hangs on).
// Pure and read-only: it never changes a price. Every dollar in priced.lines lands in exactly one
// section, and `reconcile` walks section sells back to the customer price so the UI can prove it.
import type { QuoteDoc, Priced, PricedLine, LineKind } from './manual';
import type { CategoryKey } from './rollup';
import type { Role, Basis, LineDetail } from './lineDetail';

export type SectionKey = 'structural' | 'plate' | 'stdParts' | 'products' | 'vendor' | 'costBased' | 'paint'
  | 'shopLabor' | 'pmCad' | 'install' | 'travel' | 'equipment';

export interface Subtotals {
  cost: number; sell: number; margin: number; marginPct: number;   // marginPct = margin ÷ sell (0 when no sell)
  hours: number;                                                   // labor / PM / CAD / P.E. hours
  lb: number;                                                      // steel + plate weight (detail-backed lines only)
  lines: number;
}

export interface SectionLine {
  key: string; description: string; kind: LineKind; category: CategoryKey;
  role?: Role; item?: number; group?: string; auto: boolean;
  qty: number; unit: 'ea' | 'h' | 'ft' | 'sqft' | 'run' | 'night' | 'day' | 'trip';
  unitCost?: number; markupPct?: number; unitSell?: number;
  cost: number; sell: number; margin: number; marginPct: number; hours: number;
  lb?: number;                                                    // lbEach × current qty
  detail?: LineDetail; basis?: Basis;
  assumption?: { field: string; value: unknown; why: string; alt?: unknown; altLabel?: string };
  edited?: string;                                                // why the line no longer matches its build detail
  synthetic?: true;                                               // not a doc line (production value)
}

/** One structural / plate member summed across lines: "Runways — W14 x 30 — 8 pcs — 208 ft — 6,240 lb". */
export interface MemberRow {
  role?: Role; size: string; item?: number; group?: string;
  pieces: number; lengthsFt: number[]; totalFt: number; lb: number; cost: number; sell: number;
  costPerLb?: number; priceGroup?: string; basis?: Basis; lineKeys: string[];
}

export interface ItemTotals { item: number | null; group: string; totals: Subtotals }

export interface Section {
  key: SectionKey; label: string;
  smtTab: string;                     // the SMT tab a reviewer would open for this
  summaryRows: number[];              // Main Summary D-rows the section's categories land in
  bucket: 'base' | 'installation';    // which quote price line it rolls into
  categories: CategoryKey[];
  totals: Subtotals;
  lines: SectionLine[];
  members?: MemberRow[];              // structural + plate only
  byItem?: ItemTotals[];              // multi-item jobs only
}

export interface SectionTree {
  sections: Section[];
  totals: Subtotals;                  // all sections
  items: ItemTotals[];                // per spec item (+ shared trip, + hand-added lines)
  reconcile: {
    baseSections: number; onePct: number; basePrice: number;
    installSections: number; installAdder: number; installation: number;
    outboundFreight: number; preUse: number | null; tax: number; dealerDiscount: number;
    total: number; diff: number;      // total − priced.rollup.quote.total (≈ 0; cents from per-line rounding)
  };
  review: { key: string; description: string; section: SectionKey; reason: string }[];   // basis flags + edits
}

interface Def { key: SectionKey; label: string; smtTab: string; categories: CategoryKey[] }
export const SECTION_DEFS: Def[] = [
  { key: 'structural', label: 'Structural steel', smtTab: 'Structural', categories: ['structural', 'miscSteel', 'xBracing'] },
  { key: 'plate', label: 'Plate & built-up', smtTab: 'Plate', categories: ['plate'] },
  { key: 'stdParts', label: 'Standard parts', smtTab: 'Standard Parts and Products', categories: ['stdParts', 'decals', 'ultraLitePcr', 'stairStringerPcr'] },
  { key: 'products', label: 'Products (stairs, work platforms, VRC, concrete)', smtTab: 'Stairways / Work Platforms / VRC / Concrete', categories: ['stairways', 'workPlatforms', 'vrc', 'concrete'] },
  { key: 'vendor', label: 'Vendor items', smtTab: 'Hoist and Crane Vendor Items', categories: ['vendor'] },
  { key: 'costBased', label: 'Cost-based items', smtTab: 'Cost Based Items', categories: ['costBased', 'inboundFreight'] },
  { key: 'paint', label: 'Paint', smtTab: 'Painting', categories: ['painting'] },
  { key: 'shopLabor', label: 'Shop labor', smtTab: 'Labor (shop)', categories: ['shopLabor'] },
  { key: 'pmCad', label: 'PM / CAD / P.E.', smtTab: 'Main Summary', categories: ['pmMarketing', 'cad', 'engineering'] },
  { key: 'install', label: 'On-site labor', smtTab: 'Labor (on site)', categories: ['onsiteLabor'] },
  { key: 'travel', label: 'Travel & lodging', smtTab: 'Travel Costs', categories: ['travel'] },
  { key: 'equipment', label: 'Rental equipment', smtTab: 'Equipment', categories: ['equipment'] },
];
const ROWS: Record<CategoryKey, number> = {
  stdParts: 4, vendor: 5, costBased: 6, stairways: 7, structural: 8, concrete: 9, workPlatforms: 10, plate: 11, vrc: 12, painting: 13,
  pmMarketing: 14, cad: 15, engineering: 16, decals: 17, miscSteel: 18, ultraLitePcr: 19, stairStringerPcr: 20, xBracing: 21, inboundFreight: 22,
  travel: 23, equipment: 24, shopLabor: 25, onsiteLabor: 26,
};
const INSTALL_CATS: CategoryKey[] = ['travel', 'equipment', 'onsiteLabor'];
const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;
const sectionOf = (c: CategoryKey): SectionKey => SECTION_DEFS.find(d => d.categories.includes(c))!.key;

function sub(ls: { cost: number; sell: number; hours: number; lb?: number }[]): Subtotals {
  const cost = ls.reduce((a, l) => a + l.cost, 0), sell = ls.reduce((a, l) => a + l.sell, 0);
  return { cost: r2(cost), sell: r2(sell), margin: r2(sell - cost), marginPct: sell ? Math.round((sell - cost) / sell * 10000) / 10000 : 0,
    hours: r1(ls.reduce((a, l) => a + l.hours, 0)), lb: Math.round(ls.reduce((a, l) => a + (l.lb ?? 0), 0)), lines: ls.length };
}

function unitOf(l: PricedLine): SectionLine['unit'] {
  if (l.kind !== 'material' && l.kind !== 'travel' && l.kind !== 'equipment') return 'h';
  if (l.category === 'painting') return 'run';
  const d = l.detail;
  if (d?.type === 'travel') return d.what === 'hotel' ? 'night' : d.what === 'per_diem' ? 'day' : 'trip';
  if (/per (linear )?f(oo)?t\b|per foot/i.test(l.description)) return 'ft';
  if (/per sq ?ft/i.test(l.description)) return 'sqft';
  return 'ea';
}

/** Why a line no longer matches the numbers it was built from (rep edited qty / price by hand). */
function editedWhy(l: PricedLine): string | undefined {
  const d = l.detail; if (!d) return undefined;
  const off = (a: number | undefined, b: number) => a == null || Math.abs(a - b) > 0.011;
  switch (d.type) {
    case 'steel': case 'plate': case 'box':
      return off(l.unitCost, r2(d.lbEach * d.costPerLb)) ? `Unit cost edited (built at ${d.lbEach.toFixed(1)} lb × $${d.costPerLb}/lb = $${r2(d.lbEach * d.costPerLb)})` : undefined;
    case 'vendor': return off(l.unitCost, r2(d.costEach)) ? `Cost edited (built at list $${d.list} less ${d.pwiDiscPct}% = $${r2(d.costEach)})` : undefined;
    case 'std': return off(l.unitSell, d.sellEach) ? `Sell edited (catalog $${d.sellEach})` : undefined;
    case 'labor': return off(l.qty, d.hours) ? `Hours edited (built ${d.hours} h = ${r1(d.baseHrs)} × ${d.factor})` : undefined;
    case 'pmcad': return off(l.qty, d.hours) ? `Hours edited (built ${d.hours} h)` : undefined;
    default: return undefined;
  }
}

function sizeOf(d: LineDetail): string {
  return d.type === 'steel' ? d.shape : d.type === 'box' ? `${d.plf} plf built-up` : d.type === 'plate' ? `${d.tIn}" × ${d.wIn}" × ${d.lIn}"` : '';
}

function members(lines: SectionLine[]): MemberRow[] {
  const by = new Map<string, MemberRow>();
  for (const l of lines) {
    const d = l.detail; if (!d || (d.type !== 'steel' && d.type !== 'box' && d.type !== 'plate')) continue;
    const size = sizeOf(d), k = `${l.item ?? ''}|${l.role ?? ''}|${size}`;
    const m = by.get(k) ?? { role: l.role, size, item: l.item, group: l.group, pieces: 0, lengthsFt: [], totalFt: 0, lb: 0, cost: 0, sell: 0,
      costPerLb: d.costPerLb, priceGroup: d.type === 'steel' ? d.priceGroup : 'Plate', basis: l.basis, lineKeys: [] };
    const lenFt = d.type === 'plate' ? d.lIn / 12 : d.lengthFt;
    m.pieces += l.qty; if (!m.lengthsFt.includes(lenFt)) m.lengthsFt.push(lenFt);
    m.totalFt = r1(m.totalFt + lenFt * l.qty); m.lb = Math.round(m.lb + (l.lb ?? 0)); m.cost = r2(m.cost + l.cost); m.sell = r2(m.sell + l.sell); m.lineKeys.push(l.key);
    by.set(k, m);
  }
  return [...by.values()].sort((a, b) => b.lb - a.lb);
}

function byItem(lines: SectionLine[]): ItemTotals[] {
  const g = new Map<string, { item: number | null; group: string; ls: SectionLine[] }>();
  for (const l of lines) {
    const item = l.synthetic ? null : l.item ?? null;
    const k = item == null ? (l.synthetic ? 'job' : 'hand') : String(item);
    const label = l.group ?? (l.synthetic ? 'Job' : 'Added by hand');
    const e = g.get(k) ?? { item, group: label, ls: [] }; e.ls.push(l); g.set(k, e);
  }
  return [...g.values()].sort((a, b) => (a.item ?? 1e9) - (b.item ?? 1e9)).map(e => ({ item: e.item, group: e.group, totals: sub(e.ls) }));
}

export function sectionize(doc: QuoteDoc, priced: Priced, opts: { includeEmpty?: boolean } = {}): SectionTree {
  const asm = doc.assumptions ?? [];
  const findA = (field: string | undefined, item: number | undefined) => field == null ? undefined
    : asm.find(a => a.field === field && (a.item === item || item == null)) ?? asm.find(a => a.field === field && a.item === -1);

  const sl: SectionLine[] = priced.lines.map(l => {
    const d = l.detail, lb = d && (d.type === 'steel' || d.type === 'plate' || d.type === 'box') ? d.lbEach * l.qty : undefined;
    const a = findA(l.basis?.assumption, l.item);
    const out: SectionLine = {
      key: l.key, description: l.description, kind: l.kind, category: l.category, role: l.role, item: l.item, group: l.group, auto: !!l.auto,
      qty: l.qty, unit: unitOf(l), unitCost: l.unitCost, markupPct: l.markupPct, unitSell: l.unitSell,
      cost: l.cost, sell: l.sell, margin: r2(l.sell - l.cost), marginPct: l.sell ? Math.round((l.sell - l.cost) / l.sell * 10000) / 10000 : 0, hours: l.hours,
      ...(lb != null ? { lb: Math.round(lb * 10) / 10 } : {}), ...(d ? { detail: d } : {}), ...(l.basis ? { basis: l.basis } : {}),
      ...(a ? { assumption: { field: a.field, value: a.value, why: a.why, ...(a.alt !== undefined ? { alt: a.alt, altLabel: a.altLabel } : {}) } } : {}),
    };
    const e = editedWhy(l); if (e) out.edited = e;
    return out;
  });
  // Freestanding production value is priced into Cost Based (Main Summary D6) but is not a doc line.
  if (priced.totals.productionValue) sl.push({ key: 'production-value', description: `Freestanding production value (${doc.freestandingShopHours ?? 0} shop h × $${doc.pvPerHourOverride ?? r2(priced.totals.productionValue / (doc.freestandingShopHours || 1))}/h)`,
    kind: 'material', category: 'costBased', auto: true, qty: 1, unit: 'ea', cost: 0, sell: priced.totals.productionValue, margin: priced.totals.productionValue, marginPct: 1, hours: 0, synthetic: true });

  const multi = new Set(sl.filter(l => !l.synthetic).map(l => l.item ?? 'hand')).size > 1;
  const sections: Section[] = SECTION_DEFS.map(def => {
    const ls = sl.filter(l => def.categories.includes(l.category));
    const s: Section = { key: def.key, label: def.label, smtTab: def.smtTab, summaryRows: def.categories.map(c => ROWS[c]).sort((a, b) => a - b),
      bucket: def.categories.every(c => INSTALL_CATS.includes(c)) ? 'installation' : 'base', categories: def.categories, totals: sub(ls), lines: ls };
    if (def.key === 'structural' || def.key === 'plate') s.members = members(ls);
    if (multi && ls.length) s.byItem = byItem(ls);
    return s;
  }).filter(s => opts.includeEmpty || s.lines.length);

  const ro = priced.rollup;
  const baseSections = r2(sections.filter(s => s.bucket === 'base').reduce((a, s) => a + s.totals.sell, 0));
  const installSections = r2(sections.filter(s => s.bucket === 'installation').reduce((a, s) => a + s.totals.sell, 0));
  const disc = doc.dealerDiscount ?? 0;
  const total = r2(ro.quote.base + ro.quote.installation + ro.quote.freight + (ro.quote.preUse ?? 0) + ro.quote.tax);
  const review = sl.flatMap(l => [
    ...(l.basis?.flag ? [{ key: l.key, description: l.description, section: sectionOf(l.category), reason: l.basis.flag }] : []),
    ...(l.edited ? [{ key: l.key, description: l.description, section: sectionOf(l.category), reason: l.edited }] : []),
  ]);
  return {
    sections, totals: sub(sl), items: byItem(sl),
    reconcile: {
      baseSections, onePct: r2(ro.onePct), basePrice: r2(baseSections + ro.onePct),
      installSections, installAdder: r2(installSections * 0.01), installation: r2(installSections * 1.01),
      outboundFreight: ro.quote.freight, preUse: ro.quote.preUse, tax: r2(ro.quote.tax), dealerDiscount: disc,
      total, diff: r2((disc > 0 ? ro.quote.base : baseSections + ro.onePct) + installSections * 1.01 + ro.quote.freight + (ro.quote.preUse ?? 0) + ro.quote.tax - ro.quote.total),
    },
    review,
  };
}
