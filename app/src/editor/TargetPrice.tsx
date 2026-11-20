// Target price tool (U10): "knock $3k off" or "hit $84,500". Applies as one visible "Price adjustment" line in
// Base (Cost Based row) — never the Dealer/GC discount, which skips vendor items and inbound freight.
// Per S-API a discount is a material line with a negative unitSell (a credit); the engine raises BIG_DISCOUNT
// (credits ÷ gross over settings.max_discount_pct) and MIN_GM (below settings.min_gm_pct) from it.
import { useMemo, useState } from 'react';
import type { QuoteDoc, Settings } from '../../../src/engine/manual';
import { price, parseNum, minGmPct, quoteMoney, flagDiff, targetAdjustment, ADJ_KEY } from './engineApi';
import { FLAG_TEXT } from './flags';
import { rowStats, fmtMoney, fmtPct } from './smt';

export { ADJ_KEY } from './engineApi';

export function TargetPrice({ doc, settings, onApply, onClose }: { doc: QuoteDoc; settings: Settings; onApply: (d: QuoteDoc, label: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const now = useMemo(() => price(doc, settings), [doc, settings]);
  const raw = text.trim();
  const n = parseNum(raw.replace(/^[−–]/, '-').replace(/\$/g, ''), { allowNegative: true });
  const target = n == null ? null : /^[-−–]/.test(raw) ? quoteMoney(now).total + n : n;
  const t = useMemo(() => (target == null ? null : targetAdjustment(doc, settings, target)), [doc, settings, target]);
  const amt = t?.amount ?? null, nextDoc = t?.doc ?? null, next = t?.priced ?? null;
  const floor = minGmPct(settings);
  const before = rowStats(doc, now).filter(r => r.sell), after = next && nextDoc ? rowStats(nextDoc, next) : null;
  const existing = doc.lines.find(l => l.key === ADJ_KEY);
  const policy = next ? next.flags.filter(f => f.rule === 'MIN_GM' || f.rule === 'BIG_DISCOUNT') : [];
  const isNew = (f: { rule: string }) => !!next && flagDiff(now, next).raised.some(x => x.rule === f.rule);
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
        {policy.map(f => <div key={f.rule} className="banner flag">⚑ {FLAG_TEXT(f)} — {isNew(f) ? 'applying this needs' : 'still needs'} a sales manager's approval.</div>)}
        <p className="muted">Adds one "Price adjustment" line to Cost Based Special Items (the 1% and tax are worked in so the total lands on your number). The Dealer/GC discount is for dealers only.</p>
        <button onClick={() => onApply(nextDoc!, `Target price $${fmtMoney(target!)}`)}>Apply</button>
      </>}
      {raw && n == null && <p className="msg-error">Type a number like 84500 or −3000.</p>}
    </div>
  );
}
