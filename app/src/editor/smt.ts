// Main Summary rows (SMT D4–D26) in the exact order and wording of the Sales Main Template,
// plus the per-row numbers (tons / hours, cost, sell, GM) and the one-line "peek" under a collapsed row.
import type { CategoryKey } from '../../../src/engine/rollup';
import type { Priced, PricedLine, QuoteDoc } from '../../../src/engine/manual';
import { stdCostKnown, changedPaths, type EditorLine } from './engineApi';

export type TabKind = 'structural' | 'plate' | 'std' | 'vendor' | 'cost' | 'paint' | 'shop' | 'site' | 'pmcad' | 'travel' | 'equipment';
export interface RowDef { key: CategoryKey; row: number; label: string; tab: TabKind; tabName: string; install?: boolean; measure: 'tons' | 'hours' | 'runs' | 'none' }

/** reference/smt_tabs/Main_Summary.txt A4:A26 */
export const ROWS: RowDef[] = [
  { key: 'stdParts', row: 4, label: 'Standard Parts & Products', tab: 'std', tabName: 'Standard Parts & Products', measure: 'none' },
  { key: 'vendor', row: 5, label: 'Hoist & Crane Vendor Items', tab: 'vendor', tabName: 'Hoist & Crane Vendor Items', measure: 'none' },
  { key: 'costBased', row: 6, label: 'Cost Based Special Items', tab: 'cost', tabName: 'Cost Based Items', measure: 'none' },
  { key: 'stairways', row: 7, label: 'Stairways', tab: 'cost', tabName: 'Stairways', measure: 'none' },
  { key: 'structural', row: 8, label: 'Structural', tab: 'structural', tabName: 'Structural', measure: 'tons' },
  { key: 'concrete', row: 9, label: 'Concrete', tab: 'cost', tabName: 'Concrete', measure: 'none' },
  { key: 'workPlatforms', row: 10, label: 'Work Platforms', tab: 'cost', tabName: 'Work Platforms', measure: 'none' },
  { key: 'plate', row: 11, label: 'Plate', tab: 'plate', tabName: 'Plate', measure: 'tons' },
  { key: 'vrc', row: 12, label: 'VRCs', tab: 'cost', tabName: 'VRC', measure: 'none' },
  { key: 'painting', row: 13, label: 'Painting Charges', tab: 'paint', tabName: 'Painting', measure: 'runs' },
  { key: 'pmMarketing', row: 14, label: 'Project Management & Marketing Fees', tab: 'pmcad', tabName: 'Main Summary F14 (PM)', measure: 'hours' },
  { key: 'cad', row: 15, label: 'AutoCad Design Charges', tab: 'pmcad', tabName: 'Main Summary F15 (CAD)', measure: 'hours' },
  { key: 'engineering', row: 16, label: 'Engineering Charges', tab: 'pmcad', tabName: 'Main Summary F16 (P.E.)', measure: 'hours' },
  { key: 'decals', row: 17, label: 'PWI Capacity Decals', tab: 'std', tabName: 'Standard Parts (decals)', measure: 'none' },
  { key: 'miscSteel', row: 18, label: 'Misc Steel Materials', tab: 'structural', tabName: 'Structural (misc)', measure: 'tons' },
  { key: 'ultraLitePcr', row: 19, label: 'Additional PCR Charge for Ultra Lite Crane', tab: 'std', tabName: 'Standard Parts', measure: 'none' },
  { key: 'stairStringerPcr', row: 20, label: 'Additional PCR Charge for Stair Stringers', tab: 'std', tabName: 'Standard Parts', measure: 'none' },
  { key: 'xBracing', row: 21, label: 'X-Bracing Package', tab: 'structural', tabName: 'Structural (x-bracing)', measure: 'tons' },
  { key: 'inboundFreight', row: 22, label: 'Inbound Freight Charges', tab: 'cost', tabName: 'Main Summary F19 (inbound freight)', measure: 'none' },
  { key: 'travel', row: 23, label: 'Travel Cost Charges', tab: 'travel', tabName: 'Travel Costs', install: true, measure: 'none' },
  { key: 'equipment', row: 24, label: 'On-Site Equipment Rentals', tab: 'equipment', tabName: 'Equipment', install: true, measure: 'none' },
  { key: 'shopLabor', row: 25, label: 'Total Shop Fab Labor Hours', tab: 'shop', tabName: 'Labor (Shop Labor)', measure: 'hours' },
  { key: 'onsiteLabor', row: 26, label: 'Total On-site Labor Hours', tab: 'site', tabName: 'Labor (On Site Labor)', install: true, measure: 'hours' },
];
export const rowOf = (k: CategoryKey) => ROWS.find(r => r.key === k)!;

export interface RowStats {
  def: RowDef; lines: PricedLine[]; cost: number; sell: number; gm: number; gmPct: number | null;
  costPending: boolean;                  // std parts: cost arrives with the engine update (gm_pct)
  lb: number; noWeight: number; hours: number; runs: number; edited: number; hand: number; costUnknown: boolean; estCost: boolean;
}
const isWeight = (l: PricedLine) => { const t = l.detail?.type; return t === 'steel' || t === 'plate' || t === 'box'; };
export const lbOf = (l: { detail?: any; qty: number }) => { const d: any = l.detail; return d && (d.type === 'steel' || d.type === 'plate' || d.type === 'box') ? d.lbEach * l.qty : 0; };

export function rowStats(doc: QuoteDoc, priced: Priced): RowStats[] {
  return ROWS.map(def => {
    const lines = priced.lines.filter(l => l.category === def.key);
    let cost = lines.reduce((a, l) => a + l.cost, 0), sell = lines.reduce((a, l) => a + l.sell, 0);
    if (def.key === 'costBased' && priced.totals.productionValue) sell += priced.totals.productionValue;
    const costUnknown = lines.some(l => !stdCostKnown(l));
    const estCost = lines.some(l => l.kind !== 'material' && l.kind !== 'travel' && l.kind !== 'equipment');
    const gm = sell - cost;
    const docLines = doc.lines as EditorLine[];
    return {
      def, lines, cost, sell, gm, gmPct: costUnknown || !sell ? null : gm / sell,
      costPending: costUnknown && ['stdParts', 'ultraLitePcr', 'stairStringerPcr'].includes(def.key),
      lb: lines.reduce((a, l) => a + lbOf(l), 0),
      noWeight: def.measure === 'tons' ? lines.filter(l => !isWeight(l)).length : 0,
      hours: lines.reduce((a, l) => a + l.hours, 0),
      runs: def.key === 'painting' ? lines.reduce((a, l) => a + l.qty, 0) : 0,
      edited: docLines.filter(l => l.category === def.key).reduce((a, l) => a + Object.keys(changedPaths(l)).length, 0),
      hand: docLines.filter(l => l.category === def.key && !l.auto).length,
      costUnknown, estCost,
    };
  });
}

// ---------------------------------------------------------------- peek lines (U2)
const ROLE_LABEL: Record<string, string> = { girder: 'girder', runway: 'runway', column: 'col', brace: 'brace', beam: 'beam', header: 'header', crossmember: 'xmbr', mast: 'mast', boom: 'boom', arm: 'arm', bracket: 'bracket', truss: 'truss', track: 'track', base_plate: 'base pl', cap_plate: 'cap pl', gusset: 'gusset', stiffener: 'stiff', connection_plate: 'conn pl', end_truck_weldment: 'end truck wldmt', tower: 'tower', platform: 'platform' };
const ROLE_ORDER = ['girder', 'runway', 'column', 'beam', 'header', 'crossmember', 'mast', 'boom', 'brace'];
const ft = (x: number) => `${Math.round(x * 10) / 10}'`;
export const compactShape = (s: string) => s.replace(/\s*x\s*/gi, 'x').replace(/\s+/g, '');

export function peek(st: RowStats): string[] {
  const L = st.lines;
  switch (st.def.tab) {
    case 'structural': case 'plate': {
      const g = new Map<string, { role: string; size: string; qty: number; lens: Set<string>; lb: number }>();
      for (const l of L) {
        const d: any = l.detail; if (!d) continue;
        const size = d.type === 'steel' ? compactShape(d.shape) : d.type === 'box' ? `${d.plf} plf built-up` : d.type === 'plate' ? `PL ${d.tIn}"×${d.wIn}"` : '';
        const len = d.type === 'plate' ? `${d.lIn}"` : ft(d.lengthFt);
        const role = ROLE_LABEL[l.role ?? ''] ?? (l.description.split(' — ')[0] || '').toLowerCase();
        const k = `${role}|${size}`; const e = g.get(k) ?? { role, size, qty: 0, lens: new Set(), lb: 0 };
        e.qty += l.qty; e.lens.add(len); e.lb += lbOf(l); g.set(k, e);
      }
      const rank = (r: string) => { const i = ROLE_ORDER.findIndex(x => ROLE_LABEL[x] === r); return i < 0 ? 99 : i; };
      return [...g.values()].sort((a, b) => rank(a.role) - rank(b.role) || b.lb - a.lb)
        .map(e => `${e.size} ${e.role} ×${e.qty}${e.lens.size === 1 ? ` @ ${[...e.lens][0]}` : ''}`);
    }
    case 'vendor': return L.map(l => { const d: any = l.detail; return `${d?.part ?? l.description.split(' — ')[0]}${l.qty !== 1 ? ` ×${l.qty}` : ''}`; });
    case 'shop': case 'site':
      return [...L].sort((a, b) => b.hours - a.hours).map(l => `${(l.detail as any)?.op ?? l.description.split(' — ')[0]} ${Math.round(l.hours * 10) / 10} h`);
    case 'paint': return L.map(l => `${l.qty} ${(l.detail as any)?.run ?? ''} run${l.qty === 1 ? '' : 's'}${(l.detail as any)?.colorLabel ? ` (${(l.detail as any).colorLabel})` : ''}`.replace(/\s+/g, ' '));
    case 'travel': {
      const t: any = L.map(l => l.detail).find((d: any) => d?.type === 'travel');
      const hotel: any = L.map(l => l.detail).find((d: any) => d?.what === 'hotel');
      if (!t) return L.map(l => l.description.split(' — ')[0]);
      return [`${t.men} men × ${t.crewDays} days`, hotel ? `${hotel.nights} nights` : t.mode === 'local' ? 'local, no lodging' : '', `${t.miles} mi ${t.mode}`].filter(Boolean);
    }
    case 'equipment': return L.map(l => l.description.replace(/^Rental\s+/i, ''));
    default: return L.map(l => l.description.split(' — ')[0]);
  }
}
/** Rows that show a peek line under them when collapsed (ADV1 #9: only these; the rest on hover). */
export const PEEK_ROWS: CategoryKey[] = ['structural', 'plate', 'vendor', 'shopLabor', 'onsiteLabor', 'painting', 'travel'];

// ---------------------------------------------------------------- formatting
export const fmtMoney = (n: number | null | undefined, cents = false) =>
  n == null || !isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
export const fmtPct = (x: number | null | undefined, d = 0) => (x == null || !isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const fmtNum = (x: number | null | undefined, d = 1) => (x == null || !isFinite(x) ? '—' : x.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d }));
export const tons = (lb: number) => lb / 2000;
