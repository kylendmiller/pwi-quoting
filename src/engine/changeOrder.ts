// Change orders (round 3 S10). A CHANGE ORDER revision prints only what changed against the last confirmed
// revision: added, removed and changed lines with their sell deltas, and the price block of the difference.
// deltaDoc() builds a printable QuoteDoc whose lines ARE the deltas (one sell-priced line per change, in the same
// category, so the 1%, the 1.01 install adder, tax and dealer discount roll up exactly as on the full quote).
import { priceManual, quoteMoney, type QuoteDoc, type QuoteLine, type Settings, type LineKind, type QuoteMoney } from './manual';
import type { CategoryKey } from './rollup';

export interface DeltaLine {
  ref: string; description: string; category: CategoryKey; kind: LineKind;
  change: 'add' | 'remove' | 'change';
  qtyBefore: number; qtyAfter: number; sellBefore: number; sellAfter: number; delta: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const idOf = (l: QuoteLine) => l.ref ?? `key:${l.key}`;
const unit = (k: LineKind) => (k === 'material' || k === 'travel' || k === 'equipment' ? '' : ' h');

export function deltaDoc(confirmed: QuoteDoc, current: QuoteDoc, s: Settings):
  { doc: QuoteDoc; lines: DeltaLine[]; before: QuoteMoney; after: QuoteMoney; delta: QuoteMoney } {
  const pb = priceManual(confirmed, s), pa = priceManual(current, s);
  const B = new Map(confirmed.lines.map((l, i) => [idOf(l), { l, p: pb.lines[i] }]));
  const A = new Map(current.lines.map((l, i) => [idOf(l), { l, p: pa.lines[i] }]));
  const lines: DeltaLine[] = [];
  for (const [id, a] of A) {
    const b = B.get(id);
    const sb = b?.p.sell ?? 0, sa = a.p.sell, qb = b?.l.qty ?? 0, qa = a.l.qty;
    if (b && Math.abs(sa - sb) < 0.005 && qa === qb && a.l.description === b.l.description) continue;
    lines.push({ ref: id, description: a.l.description, category: a.l.category, kind: a.l.kind, change: b ? 'change' : 'add', qtyBefore: qb, qtyAfter: qa, sellBefore: sb, sellAfter: sa, delta: r2(sa - sb) });
  }
  for (const [id, b] of B) if (!A.has(id))
    lines.push({ ref: id, description: b.l.description, category: b.l.category, kind: b.l.kind, change: 'remove', qtyBefore: b.l.qty, qtyAfter: 0, sellBefore: b.p.sell, sellAfter: 0, delta: r2(-b.p.sell) });

  const label = (d: DeltaLine) => d.change === 'add' ? `ADD: ${d.description}` : d.change === 'remove' ? `DELETE: ${d.description}`
    : `CHANGE: ${d.description}${d.qtyBefore !== d.qtyAfter ? ` (${d.qtyBefore}${unit(d.kind)} → ${d.qtyAfter}${unit(d.kind)})` : ''}`;
  const docLines: QuoteLine[] = lines.filter(d => d.delta !== 0).map((d, i) => ({
    key: `co${i}`, kind: 'material', category: d.category, description: label(d), qty: 1, unitSell: d.delta,
  }));
  const pvDelta = r2(pa.totals.productionValue - pb.totals.productionValue);
  if (pvDelta) docLines.push({ key: 'co-pv', kind: 'material', category: 'costBased', description: 'CHANGE: Production value', qty: 1, unitSell: pvDelta });

  const before = pb.quote, after = pa.quote;
  const delta = quoteMoney({
    base: pa.rollup.quote.base - pb.rollup.quote.base, installation: pa.rollup.quote.installation - pb.rollup.quote.installation,
    freight: pa.rollup.quote.freight - pb.rollup.quote.freight, preUse: (pa.rollup.quote.preUse ?? 0) - (pb.rollup.quote.preUse ?? 0),
    tax: pa.rollup.quote.tax - pb.rollup.quote.tax, total: 0,
  });
  const doc: QuoteDoc = {
    family: current.family, lines: docLines,
    outboundFreight: r2(current.outboundFreight - confirmed.outboundFreight),
    preUse: r2((current.showPreUse ? current.preUse : 0) - (confirmed.showPreUse ? confirmed.preUse : 0)), showPreUse: !!(current.showPreUse || confirmed.showPreUse),
    dealerDiscount: current.dealerDiscount, taxOn: current.taxOn,
    suggestedInstallHours: null, freestandingShopHours: 0, pvPerHourOverride: null,
    wording: ['CHANGE ORDER — changes to the confirmed scope:', ...lines.map(d => `${label(d)}: ${d.delta < 0 ? '−' : '+'}$${Math.abs(d.delta).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)].join('\n'),
    options: [],
  };
  return { doc, lines, before, after, delta };
}

/** Quote status after `revise` (S10): a won job stays won; a confirmation or change order revision means won. */
export function reviseStatus(current: string | null | undefined, newDocType: string | null | undefined): 'won' | 'draft' {
  return current === 'won' || newDocType === 'CONFIRMATION' || newDocType === 'CHANGE ORDER' ? 'won' : 'draft';
}
