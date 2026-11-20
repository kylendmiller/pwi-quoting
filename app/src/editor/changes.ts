// Plain-English list of what changed since the last save (U8 "unsaved changes").
import type { QuoteDoc } from '../../../src/engine/manual';
import { rowOf } from './smt';

export interface Change { text: string; key?: string }
const n = (x: unknown) => (typeof x === 'number' ? String(Math.round(x * 100) / 100) : String(x ?? '—'));
const FIELDS: [string, string][] = [['qty', 'qty'], ['unitCost', 'cost ea'], ['markupPct', 'markup %'], ['unitSell', 'sell ea'], ['description', 'description']];

export function diffDocs(a: QuoteDoc | null | undefined, b: QuoteDoc): Change[] {
  if (!a) return [];
  const out: Change[] = [];
  const A = new Map(a.lines.map(l => [l.key, l])), B = new Map(b.lines.map(l => [l.key, l]));
  for (const l of b.lines) {
    const o = A.get(l.key);
    const where = rowOf(l.category)?.label ?? l.category;
    if (!o) { out.push({ key: l.key, text: `Added "${short(l.description)}" (${where})` }); continue; }
    const ch: string[] = [];
    for (const [f, label] of FIELDS) if ((o as any)[f] !== (l as any)[f] && !(f === 'description' && (l as any).detail)) ch.push(`${label} ${n((o as any)[f])} → ${n((l as any)[f])}`);
    const od: any = o.detail ?? {}, nd: any = l.detail ?? {};
    for (const k of ['shape', 'lengthFt', 'tIn', 'wIn', 'lIn', 'plf', 'costPerLb', 'list', 'pwiDiscPct', 'customerDiscPct', 'baseHrs'])
      if (od[k] !== nd[k] && (od[k] != null || nd[k] != null)) ch.push(`${k === 'lengthFt' ? 'length' : k === 'costPerLb' ? '$/lb' : k === 'baseHrs' ? 'base h' : k} ${n(od[k])} → ${n(nd[k])}`);
    if (o.category !== l.category) ch.push(`moved to ${where}`);
    if (ch.length) out.push({ key: l.key, text: `${short(o.description)}: ${ch.join(', ')}` });
  }
  for (const o of a.lines) if (!B.has(o.key)) out.push({ text: `Removed "${short(o.description)}"` });
  const docF: [keyof QuoteDoc, string][] = [['outboundFreight', 'Outbound freight'], ['preUse', 'Pre-use'], ['dealerDiscount', 'Dealer/GC discount'], ['taxOn', 'Sales tax'], ['pvPerHourOverride', 'PV $/shop h'], ['family', 'Main product'], ['showPreUse', 'Show pre-use']];
  for (const [f, label] of docF) if (a[f] !== b[f]) out.push({ text: `${label}: ${n(a[f])} → ${n(b[f])}` });
  if (a.wording !== b.wording) out.push({ text: 'Quote wording edited' });
  if (JSON.stringify(a.options) !== JSON.stringify(b.options)) out.push({ text: 'Options edited' });
  if (JSON.stringify(a.spec) !== JSON.stringify(b.spec)) out.push({ text: 'Job spec changed (rebuilt)' });
  return out;
}
const short = (s: string) => (s.length > 48 ? s.slice(0, 46) + '…' : s);
