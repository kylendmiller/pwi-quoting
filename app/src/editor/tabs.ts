// Column definitions for each SMT tab grid (U1 detail, U11 laptop column set).
// Default columns are what the President reads on that SMT tab; `extra` columns sit behind "Columns ▾".
import type { PricedLine } from '../../../src/engine/manual';
import type { EditorLine } from './engineApi';
import { stdCostKnown } from './engineApi';
import { lbOf, fmtMoney, fmtNum, fmtPct, type TabKind } from './smt';

export interface Col {
  id: string; label: string; title?: string; w: number; align?: 'l' | 'r';
  extra?: boolean;                 // hidden until picked
  costOnly?: boolean;              // hidden when "hide cost" is on (screen-share)
  get: (l: EditorLine, p: PricedLine) => unknown;
  show?: (v: any, l: EditorLine, p: PricedLine) => string;
  /** Editable field path on this line, or null when read-only for this line. */
  path?: (l: EditorLine) => string | null;
  input?: 'num' | 'text' | 'shape';
}

const d = (l: EditorLine): any => l.detail ?? {};
const stemOf = (s: string) => s.split(' — ')[0];
const hrsKind = (l: EditorLine) => !['material', 'travel', 'equipment'].includes(l.kind);
const gmPct = (_: unknown, l: EditorLine, p: PricedLine) => (!p.sell || !stdCostKnown(l) ? '—' : fmtPct((p.sell - p.cost) / p.sell));
const money = (v: any) => fmtMoney(v);
const money2 = (v: any) => (v == null ? '—' : fmtMoney(v, true));

const C = {
  usedFor: (label = 'Used for', w = 190): Col => ({ id: 'used', label, w, align: 'l', get: l => stemOf(l.description), path: l => (l.auto ? null : 'description'), input: 'text' }),
  desc: (w = 260): Col => ({ id: 'desc', label: 'Description', w, align: 'l', get: l => l.description, path: () => 'description', input: 'text' }),
  qty: (label = 'Qty'): Col => ({ id: 'qty', label, w: 52, get: l => l.qty, show: v => fmtNum(v, 2), path: () => 'qty', input: 'num' }),
  costEa: (extra = false): Col => ({ id: 'costEa', label: 'Cost ea', w: 82, extra, costOnly: true, get: l => l.unitCost, show: money2, path: l => (l.unitCost != null ? 'unitCost' : null), input: 'num' }),
  mk: (): Col => ({ id: 'mk', label: 'Mk %', w: 52, get: l => (l.unitCost != null ? l.markupPct ?? 0 : null), show: v => (v == null ? '' : fmtNum(v, 2)), path: l => (l.unitCost != null ? 'markupPct' : null), input: 'num' }),
  cost: (extra = true): Col => ({ id: 'cost', label: 'Cost', w: 82, extra, costOnly: true, get: (_, p) => p.cost, show: (v, l) => (stdCostKnown(l) ? money(v) : '—') }),
  sell: (): Col => ({ id: 'sell', label: 'Sell', w: 88, get: (_, p) => p.sell, show: money }),
  gm: (): Col => ({ id: 'gm', label: 'GM %', w: 52, costOnly: true, get: () => 0, show: gmPct }),
  item: (): Col => ({ id: 'item', label: 'Item', w: 120, extra: true, align: 'l', get: l => l.group ?? (l.auto ? '' : 'Added by you') }),
  tons: (): Col => ({ id: 'tons', label: 'Tons', w: 56, get: l => (l.detail ? lbOf(l) / 2000 : null), show: v => (v == null ? 'no wt' : fmtNum(v, 2)) }),
};

const COLS: Record<TabKind, Col[]> = {
  structural: [
    C.usedFor(), C.qty(),
    { id: 'shape', label: 'Shape', w: 104, align: 'l', get: l => d(l).shape ?? (l.detail ? '' : '—'), path: l => (d(l).type === 'steel' ? 'detail.shape' : null), input: 'shape' },
    { id: 'len', label: 'Len ft', w: 60, get: l => d(l).lengthFt, show: v => (v == null ? '—' : fmtNum(v, 2)), path: l => (d(l).type === 'steel' ? 'detail.lengthFt' : null), input: 'num' },
    C.tons(),
    { id: 'perlb', label: '$/lb', w: 56, costOnly: true, get: l => d(l).costPerLb, show: v => (v == null ? '—' : Number(v).toFixed(3)), path: l => (d(l).type === 'steel' ? 'detail.costPerLb' : null), input: 'num' },
    C.mk(), C.sell(), C.gm(),
    { id: 'lbft', label: 'lb/ft', w: 56, extra: true, get: l => d(l).lbPerFt, show: v => fmtNum(v, 1) },
    C.costEa(true), C.cost(), C.item(),
  ],
  plate: [
    C.usedFor(), C.qty(),
    { id: 'thk', label: 'Thk / plf', title: 'Plate thickness (in) or built-up weight (lb/ft)', w: 64, get: l => (d(l).type === 'box' ? d(l).plf : d(l).tIn), show: (v, l) => (v == null ? '—' : d(l).type === 'box' ? `${fmtNum(v, 1)} plf` : `${v}"`),
      path: l => (d(l).type === 'box' ? 'detail.plf' : d(l).type === 'plate' ? 'detail.tIn' : null), input: 'num' },
    { id: 'w', label: 'W in', w: 52, get: l => d(l).wIn, show: v => (v == null ? '' : fmtNum(v, 2)), path: l => (d(l).type === 'plate' ? 'detail.wIn' : null), input: 'num' },
    { id: 'l', label: 'Length', w: 64, get: l => (d(l).type === 'plate' ? d(l).lIn : d(l).lengthFt), show: (v, l) => (v == null ? '—' : d(l).type === 'plate' ? `${fmtNum(v, 2)}"` : `${fmtNum(v, 2)}'`),
      path: l => (d(l).type === 'plate' ? 'detail.lIn' : d(l).type === 'box' ? 'detail.lengthFt' : null), input: 'num' },
    C.tons(), C.mk(), C.sell(), C.gm(),
    { id: 'perlb', label: '$/lb', w: 56, extra: true, costOnly: true, get: l => d(l).costPerLb, show: v => (v == null ? '—' : Number(v).toFixed(3)), path: l => (d(l).costPerLb != null ? 'detail.costPerLb' : null), input: 'num' },
    { id: 'lbpc', label: 'lb/pc', w: 60, extra: true, get: l => d(l).lbEach, show: v => fmtNum(v, 1) },
    C.costEa(true), C.cost(), C.item(),
  ],
  std: [
    C.desc(300), C.qty(),
    { id: 'sellEa', label: 'Sell ea', w: 82, get: l => l.unitSell ?? null, show: money2, path: l => (l.unitCost == null ? 'unitSell' : null), input: 'num' },
    C.sell(),
    { id: 'bh', label: 'Built h', title: 'PWI-built shop hours inside these parts (scheduling only, not priced again)', w: 60, get: l => (d(l).builtHrsEach != null ? d(l).builtHrsEach * l.qty : null), show: v => (v == null ? '' : fmtNum(v, 1)) },
    { id: 'cost', label: 'Cost', w: 82, costOnly: true, get: (_, p) => p.cost, show: (v, l) => (stdCostKnown(l) ? money(v) : 'pending') },
    C.gm(),
    C.costEa(true), C.mk(), C.item(),
  ],
  vendor: [
    { id: 'part', label: 'Part #', w: 132, align: 'l', get: l => d(l).part ?? stemOf(l.description) },
    { id: 'pdesc', label: 'Description', w: 220, align: 'l', get: l => d(l).partDescription ?? l.description.split(' — ')[1] ?? l.description },
    C.qty(),
    { id: 'list', label: 'List ea', w: 82, get: l => d(l).list, show: money2, path: l => (d(l).type === 'vendor' ? 'detail.list' : null), input: 'num' },
    { id: 'pwi', label: 'PWI disc', w: 60, costOnly: true, get: l => d(l).pwiDiscPct, show: v => (v == null ? '' : `${fmtNum(v, 2)}%`), path: l => (d(l).type === 'vendor' ? 'detail.pwiDiscPct' : null), input: 'num' },
    { id: 'cust', label: 'Cust disc', w: 62, get: l => d(l).customerDiscPct, show: v => (v == null ? '' : `${fmtNum(v, 2)}%`), path: l => (d(l).type === 'vendor' ? 'detail.customerDiscPct' : null), input: 'num' },
    C.sell(), C.gm(),
    C.costEa(true), C.cost(), { ...C.mk(), extra: true }, C.item(),
  ],
  cost: [
    C.desc(300), C.qty(), C.costEa(), C.mk(),
    { id: 'sellEa', label: 'Sell ea', w: 82, get: l => (l.unitCost == null ? l.unitSell ?? null : null), show: v => (v == null ? '' : fmtMoney(v, true)), path: l => (l.unitCost == null ? 'unitSell' : null), input: 'num' },
    C.sell(), C.gm(), C.cost(), C.item(),
  ],
  paint: [
    { id: 'run', label: 'Run', w: 270, align: 'l', get: l => l.description },
    { id: 'pu', label: 'Piece-units', title: 'Pieces ≤ 20 ft count once; longer count per 20 ft. 16 per booth run.', w: 76, get: l => d(l).pieceUnits || null, show: v => (v == null ? '' : fmtNum(v, 0)) },
    C.qty('Runs'),
    { id: 'rate', label: '$/run', w: 82, get: l => l.unitSell, show: money2, path: l => (l.unitCost == null ? 'unitSell' : null), input: 'num' },
    C.sell(), C.item(),
  ],
  shop: [
    { id: 'op', label: 'Operation', w: 250, align: 'l', get: l => d(l).op ?? l.description, path: l => (l.auto ? null : 'description'), input: 'text' },
    { id: 'base', label: 'Base h', title: 'SMT Labor-tab hours before the production factor', w: 62, get: l => d(l).baseHrs, show: v => (v == null ? '' : fmtNum(v, 1)), path: l => (d(l).type === 'labor' ? 'detail.baseHrs' : null), input: 'num' },
    { id: 'fac', label: '× Factor', w: 60, get: l => d(l).factor, show: v => (v == null ? '' : fmtNum(v, 2)) },
    C.qty('Hours'),
    C.sell(),
    { id: 'cost', label: 'Cost (std)', title: 'Assumed labor cost per hour (SMT margin calculator), not payroll', w: 78, costOnly: true, get: (_, p) => p.cost, show: money },
    C.gm(),
    { id: 'row', label: 'SMT row', w: 170, extra: true, align: 'l', get: l => d(l).smtRow ?? '' },
    C.item(),
  ],
  site: [], pmcad: [], travel: [], equipment: [],
};
COLS.site = COLS.shop.map(c => (c.id === 'base' ? { ...c, title: 'Install hours before the install factor' } : c));
COLS.pmcad = [
  { id: 'what', label: 'Item', w: 240, align: 'l', get: l => l.description, path: l => (l.auto ? null : 'description'), input: 'text' },
  C.qty('Hours'), C.sell(),
  { id: 'cost', label: 'Cost (std)', w: 78, costOnly: true, get: (_, p) => p.cost, show: money }, C.gm(),
  { id: 'how', label: 'How the hours were set', w: 260, align: 'l', get: l => l.basis?.text ?? '' },
];
COLS.travel = [
  { id: 'what', label: 'Item', w: 230, align: 'l', get: l => stemOf(l.description), path: l => (l.auto ? null : 'description'), input: 'text' },
  { id: 'basis', label: 'Basis', w: 170, align: 'l', get: l => { const t = d(l); return t.type === 'travel' ? (t.what === 'hotel' ? `${t.men} rooms × ${t.nights} nights` : t.what === 'per_diem' ? `${t.men} men × ${t.tripDays} days` : `${t.men} men · ${t.miles} mi ${t.mode}`) : l.description.split(' — ')[1] ?? ''; } },
  C.qty(), C.costEa(), C.mk(), C.sell(), C.gm(),
  { id: 'hrs', label: 'Hours', w: 56, extra: true, get: (_, p) => p.hours || null, show: v => (v ? fmtNum(v, 1) : '') }, C.item(),
];
COLS.equipment = [
  { id: 'what', label: 'Item', w: 200, align: 'l', get: l => stemOf(l.description), path: l => (l.auto ? null : 'description'), input: 'text' },
  { id: 'why', label: 'Why', w: 190, align: 'l', get: l => d(l).why ?? '' },
  { id: 'period', label: 'Period', w: 64, align: 'l', get: l => { const e = d(l); return e.type === 'equipment' ? (e.period === 'day' ? `${e.crewDays} day` : `${e.weeks} wk`) : ''; } },
  C.qty(), C.costEa(), C.mk(), C.sell(), C.gm(), C.item(),
];

export const colsFor = (tab: TabKind) => COLS[tab];
export const isHoursLine = hrsKind;
