// Target price tool (U10): "knock $3k off" or "hit $84,500". Applies as one visible "Price adjustment" line in
// Base (Cost Based row) — never the Dealer/GC discount, which skips vendor items and inbound freight.
import { useMemo, useState } from 'react';
import type { QuoteDoc, Settings } from '../../../src/engine/manual';
import { price, parseNum, minGmPct, quoteMoney, type EditorLine } from './engineApi';
import { rowStats, fmtMoney, fmtPct } from './smt';

export const ADJ_KEY = 'price-adjust';
const withAdj = (doc: QuoteDoc, amt: number): QuoteDoc => {
  const lines = doc.lines.filter(l => l.key !== ADJ_KEY);
  if (Math.abs(amt) < 0.005) return { ...doc, lines };
  const l: EditorLine = { key: ADJ_KEY, kind: 'material', category: 'costBased', family: doc.family, description: amt < 0 ? 'Price adjustment (discount)' : 'Price adjustment', qty: 1, unitSell: Math.round(amt * 100) / 100, role: 'other', source: 'hand' };
  return { ...doc, lines: [...lines, l] };
};

export function TargetPrice({ doc, settings, onApply, onClose }: { doc: QuoteDoc; settings: Settings; onApply: (d: QuoteDoc, label: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const base0 = useMemo(() => withAdj(doc, 0), [doc]);
  const now = useMemo(() => price(doc, settings), [doc, settings]);
  const p0 = useMemo(() => price(base0, settings), [base0, settings]);
  const slope = useMemo(() => (quoteMoney(price(withAdj(base0, -1000), settings)).total - quoteMoney(p0).total) / -1000, [base0, p0, settings]);
  const raw = text.trim();
  const n = parseNum(raw.replace(/^[−–]/, '-'), { allowNegative: true });
  const target = n == null ? null : /^[-−–]/.test(raw) ? quoteMoney(now).total + n : n;
  const amt = target == null || !slope ? null : Math.round(((target - quoteMoney(p0).total) / slope) * 100) / 100;
  const nextDoc = amt == null ? null : withAdj(base0, amt);
  const next = useMemo(() => (nextDoc ? price(nextDoc, settings) : null), [nextDoc, settings]);
  const floor = minGmPct(settings);
  const before = rowStats(doc, now).filter(r => r.sell), after = next && nextDoc ? rowStats(nextDoc, next) : null;
  const existing = doc.lines.find(l => l.key === ADJ_KEY);
  return (
    <div className="card qe-target">
      <div className="row" style={{ justifyContent: 'space-between' }}><h3>Target price</h3><button className="secondary sm" onClick={onClose}>Close</button></div>
      <label>New total, or "−3000" to knock off</label>
      <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={`now $${fmtMoney(quoteMoney(now).total)}`}
        onKeyDown={e => { if (e.key === 'Enter' && nextDoc) onApply(nextDoc, `Target price $${fmtMoney(target!)}`); }} />
      {existing && <p className="muted">Current adjustment line: ${fmtMoney(existing.unitSell, true)} (replaced, not stacked)</p>}
      {next && amt != null && <>
        <div className="price-row"><span>Total</span><span>${fmtMoney(quoteMoney(now).total)} → <b>${fmtMoney(quoteMoney(next).total)}</b></span></div>
        <div className="price-row"><span>Adjustment line (Base)</span><b>{amt < 0 ? '−' : ''}${fmtMoney(Math.abs(amt), true)}</b></div>
        <div className={`price-row ${next.totals.grossMarginPct < floor ? 'bad' : ''}`}><span>GM</span><span>{fmtPct(now.totals.grossMarginPct, 1)} → <b>{fmtPct(next.totals.grossMarginPct, 1)}</b></span></div>
        <table className="qe-mini"><thead><tr><th>Row</th><th className="num">GM now</th><th className="num">After</th></tr></thead>
          <tbody>{before.map(r => { const a = after?.find(x => x.def.key === r.def.key); return (
            <tr key={r.def.key} className={a && a.gmPct !== r.gmPct ? 'hl' : ''}><td>{r.def.label}</td><td className="num">{fmtPct(r.gmPct)}</td><td className="num">{fmtPct(a?.gmPct)}</td></tr>); })}</tbody></table>
        {next.totals.grossMarginPct < floor && <div className="banner flag">⚑ GM below the {fmtPct(floor)} floor — saving this needs a sales manager's approval.</div>}
        <p className="muted">Adds one "Price adjustment" line to Cost Based Special Items (the 1% and tax are worked in so the total lands on your number). The Dealer/GC discount is for dealers only.</p>
        <button onClick={() => onApply(nextDoc!, `Target price $${fmtMoney(target!)}`)}>Apply</button>
      </>}
      {raw && n == null && <p className="msg-error">Type a number like 84500 or −3000.</p>}
    </div>
  );
}
