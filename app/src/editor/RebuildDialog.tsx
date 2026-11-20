// Rebuild diff dialog (U6): what a spec change does before it is applied.
import { useState } from 'react';
import type { RebuildPlan, Choices } from './engineApi';
import { rowOf, fmtMoney, fmtNum } from './smt';
import { FLAG_TEXT } from './flags';

const v = (x: unknown) => (typeof x === 'number' ? fmtNum(x, 2) : String(x ?? '—'));
const FIELD: Record<string, string> = { qty: 'qty', unitCost: 'cost ea', markupPct: 'markup', unitSell: 'sell ea', description: 'description', category: 'section' };

export function RebuildDialog({ title, plan, approvedRules, onCancel, onApply }: {
  title: string; plan: RebuildPlan; approvedRules: string[]; onCancel: () => void; onApply: (c: Choices) => void;
}) {
  const [choices, setChoices] = useState<Choices>({});
  const [more, setMore] = useState(false);
  const b = plan.before, a = plan.after;
  const dT = a.rollup.quote.total - b.rollup.quote.total;
  const dGm = a.totals.grossMarginPct - b.totals.grossMarginPct;
  const nChanges = plan.adds.length + plan.removes.length + plan.updates.length + plan.conflicts.length;
  const voided = approvedRules.filter(r => plan.flagsNew.some(f => f.rule === r));
  const upd = more ? plan.updates : plan.updates.slice(0, 8);
  return (
    <div className="qe-modal" onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="qe-dialog" role="dialog" aria-label="Rebuild">
        <h3>Rebuild: {title}</h3>
        <div className="qe-dlg-total">
          <span>Total <b>${fmtMoney(b.rollup.quote.total)}</b> → <b>${fmtMoney(a.rollup.quote.total)}</b> <span className={dT >= 0 ? 'up' : 'dn'}>({dT >= 0 ? '+' : '−'}${fmtMoney(Math.abs(dT))})</span></span>
          <span>GM {(b.totals.grossMarginPct * 100).toFixed(1)}% → {(a.totals.grossMarginPct * 100).toFixed(1)}% <span className={dGm >= 0 ? 'up' : 'dn'}>({dGm >= 0 ? '+' : ''}{(dGm * 100).toFixed(1)} pt)</span></span>
          <span>Shop {fmtNum(b.totals.shopHours)} → {fmtNum(a.totals.shopHours)} h · Install {fmtNum(b.totals.installHours)} → {fmtNum(a.totals.installHours)} h</span>
        </div>
        {plan.money.length > 0 && <table className="qe-dlg-money"><thead><tr><th>Main Summary row</th><th className="num">Now</th><th className="num">After</th><th className="num">Change</th></tr></thead>
          <tbody>{plan.money.map(m => <tr key={m.row}><td>{rowOf(m.row).label}</td><td className="num">{fmtMoney(m.before)}</td><td className="num">{fmtMoney(m.after)}</td>
            <td className={`num ${m.after >= m.before ? 'up' : 'dn'}`}>{m.after >= m.before ? '+' : '−'}{fmtMoney(Math.abs(m.after - m.before))}</td></tr>)}</tbody></table>}
        <div className="qe-dlg-lists">
          {upd.map(u => <div key={u.ref}>~ {u.description.split(' — ')[0]}: {u.changes.filter(c => c.field !== 'description').map(c => `${FIELD[c.field] ?? c.field} ${v(c.from)} → ${v(c.to)}`).join(', ') || 'renamed'}</div>)}
          {plan.updates.length > 8 && !more && <button className="link" onClick={() => setMore(true)}>+{plan.updates.length - 8} more changed lines</button>}
          {plan.adds.map(l => <div key={'a' + l.key} className="up">+ {l.description}</div>)}
          {plan.removes.map(l => <div key={'r' + l.key} className="dn">− {l.description}{l.edited ? ' (you had changed it — kept as your own line)' : ''}</div>)}
          {plan.docChanges.map(t => <div key={t}>~ {t}</div>)}
          {nChanges === 0 && plan.docChanges.length === 0 && <div className="muted">No line changes.</div>}
        </div>
        {plan.conflicts.length > 0 && <div className="qe-dlg-conf">
          <b>The builder now says something different on {plan.conflicts.length} value{plan.conflicts.length > 1 ? 's' : ''} you changed:</b>
          {plan.conflicts.map(c => { const id = `${c.ref}::${c.field}`; return (
            <div key={id} className="row">
              <span style={{ flex: 1 }}>{c.description.split(' — ')[0]} · {FIELD[c.field] ?? c.field.replace('detail.', '')}: builder had {v(c.builderWas)}, now says {v(c.builderNow)}</span>
              <label><input type="radio" checked={choices[id] !== 'builder'} onChange={() => setChoices({ ...choices, [id]: 'yours' })} /> keep yours ({v(c.yours)})</label>
              <label><input type="radio" checked={choices[id] === 'builder'} onChange={() => setChoices({ ...choices, [id]: 'builder' })} /> take builder's</label>
            </div>); })}
        </div>}
        {plan.keptEdits.length > 0 && <div className="ok-text">✓ Kept as you set: {plan.keptEdits.map(k => k.description.split(' — ')[0]).join(' · ')}</div>}
        {plan.stayDeleted.length > 0 && <div className="ok-text">✓ Stays removed: {plan.stayDeleted.join(' · ')}</div>}
        {plan.handKept > 0 && <div className="ok-text">✓ {plan.handKept} line{plan.handKept > 1 ? 's' : ''} you added stay as they are</div>}
        {plan.flagsNew.map(f => <div key={f.rule} className="banner flag">⚑ New: {FLAG_TEXT(f)} — needs a sales manager</div>)}
        {plan.flagsCleared.map(f => <div key={f.rule} className="muted">✓ Clears: {FLAG_TEXT(f)}</div>)}
        {voided.length > 0 && <div className="banner block">Applying changes numbers a manager already approved ({voided.join(', ')}); the approval will be voided on save.</div>}
        {plan.fallback && <p className="muted">Preview mode: lines are matched by item order and description until the engine update (stable line ids) lands; steel and price-list changes since this quote was built are included in the totals above.</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button autoFocus onClick={() => onApply(choices)}>Apply {nChanges + plan.docChanges.length} change{nChanges + plan.docChanges.length === 1 ? '' : 's'}</button>
        </div>
      </div>
    </div>
  );
}
