// Rebuild diff dialog (U6): what a spec change does before it is applied — S's planRebuild, shown in two parts:
// price-list / settings drift on the SAME spec (steel_cost, vendor lists, rates) and what the spec change itself does.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Priced, QuoteDoc } from '../../../src/engine/manual';
import { applyPlan, flagDiff, type RebuildPlan, type Choices, type LineChange, type Conflict } from './engineApi';
import { fmtMoney, fmtNum } from './smt';
import { FLAG_TEXT } from './flags';

const v = (x: unknown) => (typeof x === 'number' ? fmtNum(x, 2) : String(x ?? '—'));
const FIELD: Record<string, string> = { qty: 'qty', unitCost: 'cost ea', markupPct: 'markup %', unitSell: 'sell ea', description: 'description', category: 'section', kind: 'kind', '*': 'line' };
const size = (d: unknown) => { const s = String(d ?? ''); const i = s.indexOf(' — '); return i >= 0 ? s.slice(i + 3) : s; };
const signed = (x: number) => `${x >= 0 ? '+' : '−'}$${fmtMoney(Math.abs(x))}`;
const short = (d: string) => d.split(' — ')[0];
const clip = (t: string, n = 44) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

function fieldText(c: LineChange) {
  const f = (c.fields ?? []);
  const desc = f.find(x => x.field === 'description');
  const rest = f.filter(x => x.field !== 'description').map(x => `${FIELD[x.field] ?? x.field} ${v(x.from)} → ${v(x.to)}`);
  if (desc && desc.from !== desc.to) rest.unshift(short(String(desc.from)) !== short(String(desc.to)) ? `${clip(short(String(desc.from)))} → ${clip(short(String(desc.to)))}` : `${clip(size(desc.from))} → ${clip(size(desc.to))}`);
  return rest.join(', ') || 'renamed';
}
function ChangeList({ list, max = 8 }: { list: LineChange[]; max?: number }) {
  const [more, setMore] = useState(false);
  const shown = more ? list : list.slice(0, max);
  return <>
    {shown.map(c => <div key={c.change + c.ref} className={c.change === 'add' ? 'up' : c.change === 'remove' ? 'dn' : ''}>
      {c.change === 'add' ? `+ ${c.description}` : c.change === 'remove' ? `− ${c.description}` : `~ ${short(c.description)}: ${fieldText(c)}`}
      {Math.abs(c.sellAfter - c.sellBefore) >= 0.5 && <span className="muted"> ({signed(c.sellAfter - c.sellBefore)})</span>}
    </div>)}
    {list.length > max && !more && <button className="link" onClick={() => setMore(true)}>+{list.length - max} more</button>}
  </>;
}

const fv = (c: Conflict, x: unknown) => (c.field === 'description' ? clip(size(x)) : v(x));
function conflictText(g: Conflict[]) {
  const name = short(g[0].description);
  if (g[0].kind === 'gone') return <>{name}: the builder no longer makes this line</>;
  const d = g.find(c => c.field === 'description'), others = g.filter(c => c !== d);
  const parts = [...(d ? [`builder had ${fv(d, d.builderWas)}, now says ${fv(d, d.builderNow)}`] : []),
    ...others.map(c => `${FIELD[c.field] ?? c.field} ${v(c.builderWas)} → ${v(c.builderNow)}`)];
  return <>{name}: {parts.join(' · ')}</>;
}
const yoursText = (g: Conflict[]) => { const d = g.find(c => c.field === 'description'); return d ? fv(d, d.yours) : g.map(c => v(c.yours)).join(', '); };

export function RebuildDialog({ title, plan, current, approvedRules, priceOf, onCancel, onApply }: {
  title: string; plan: RebuildPlan; current: Priced; approvedRules: string[]; priceOf: (d: QuoteDoc) => Priced; onCancel: () => void; onApply: (c: Choices) => void;
}) {
  const [choices, setChoices] = useState<Choices>({});
  const box = useRef<HTMLDivElement>(null);
  // Focus the dialog itself, not Apply: the Enter that opened it must not also apply it.
  useEffect(() => { box.current?.focus(); }, []);
  const after = useMemo(() => priceOf(applyPlan(plan, choices)), [plan, choices]);
  const b = plan.money.before, a = after.quote;
  const dT = a.total - b.total;
  const dGm = after.totals.grossMarginPct - plan.money.gmPctBefore;
  const fl = flagDiff(current, after);
  const voided = approvedRules.filter(r => fl.raised.some(f => f.rule === r) || fl.cleared.some(f => f.rule === r));
  const spec = plan.specChanges.filter(c => c.change !== 'kept_deleted'), kept = plan.specChanges.filter(c => c.change === 'kept_deleted');
  const priceCol = plan.money.bySection.some(s => Math.abs(s.priceOnly) >= 0.5);
  // One choice per line: a shape / length edit conflicts on cost AND description together; taking half makes no sense.
  const groups = [...plan.conflicts.reduce((m, c) => m.set(c.ref, [...(m.get(c.ref) ?? []), c]), new Map<string, Conflict[]>()).values()];
  const nChanges = plan.priceUpdates.length + spec.length + groups.length;
  return (
    <div className="qe-modal" onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <div className="qe-dialog" role="dialog" aria-label="Rebuild" tabIndex={-1} ref={box}>
        <h3>Rebuild: {title}</h3>
        <div className="qe-dlg-total">
          <span>Total <b>${fmtMoney(b.total)}</b> → <b>${fmtMoney(a.total)}</b> <span className={dT >= 0 ? 'up' : 'dn'}>({signed(dT)})</span></span>
          <span>GM {(plan.money.gmPctBefore * 100).toFixed(1)}% → {(after.totals.grossMarginPct * 100).toFixed(1)}% <span className={Math.round(dGm * 1000) >= 0 ? 'up' : 'dn'}>({Math.round(dGm * 1000) > 0 ? '+' : Math.round(dGm * 1000) < 0 ? '−' : '±'}{Math.abs(dGm * 100).toFixed(1)} pt)</span></span>
          <span>Shop {fmtNum(current.totals.shopHours)} → {fmtNum(after.totals.shopHours)} h · Install {fmtNum(current.totals.installHours)} → {fmtNum(after.totals.installHours)} h</span>
        </div>
        {Math.abs(plan.money.priceOnlyDelta) >= 0.5 && <div className="muted">Of the change: price lists / settings since this quote was built {signed(plan.money.priceOnlyDelta)} · your change {signed(plan.money.specDelta)}</div>}
        {plan.money.bySection.some(s => Math.abs(s.delta) >= 0.5) && <table className="qe-dlg-money"><thead><tr><th>Section</th><th className="num">Now</th>{priceCol && <th className="num">Price lists</th>}<th className="num">Your change</th><th className="num">After</th></tr></thead>
          <tbody>{plan.money.bySection.filter(s => Math.abs(s.delta) >= 0.5).map(s => <tr key={s.key}><td>{s.label}</td><td className="num">{fmtMoney(s.before)}</td>
            {priceCol && <td className={`num ${s.priceOnly >= 0 ? 'up' : 'dn'}`}>{Math.abs(s.priceOnly) >= 0.5 ? signed(s.priceOnly) : ''}</td>}
            <td className={`num ${s.spec >= 0 ? 'up' : 'dn'}`}>{Math.abs(s.spec) >= 0.5 ? signed(s.spec) : ''}</td><td className="num">{fmtMoney(s.after)}</td></tr>)}</tbody></table>}
        {plan.priceUpdates.length > 0 && <div className="qe-dlg-lists"><b>Price lists / settings changed since this quote was built (same spec):</b><ChangeList list={plan.priceUpdates} max={4} /></div>}
        <div className="qe-dlg-lists">
          {plan.priceUpdates.length > 0 && spec.length > 0 && <b>What your change does:</b>}
          <ChangeList list={spec} />
          {plan.empty && <div className="muted">Nothing changes.</div>}
          {!plan.empty && !spec.length && !plan.priceUpdates.length && <div className="muted">No line changes.</div>}
        </div>
        {groups.length > 0 && <div className="qe-dlg-conf">
          <b>The builder now says something different on {groups.length} line{groups.length > 1 ? 's' : ''} you changed:</b>
          {groups.map(g => { const builder = g.every(c => choices[c.id] === 'builder'); const set = (x: 'mine' | 'builder') => setChoices({ ...choices, ...Object.fromEntries(g.map(c => [c.id, x])) }); return (
            <div key={g[0].ref} className="row">
              <span style={{ flex: 1 }}>{conflictText(g)}</span>
              <label><input type="radio" checked={!builder} onChange={() => set('mine')} /> {g[0].kind === 'gone' ? 'keep it as your own line' : `keep yours (${yoursText(g)})`}</label>
              <label><input type="radio" checked={builder} onChange={() => set('builder')} /> {g[0].kind === 'gone' ? 'drop it' : "take builder's"}</label>
            </div>); })}
        </div>}
        {kept.length > 0 && <div className="ok-text">✓ Stays removed: {kept.map(c => short(c.description)).join(' · ')}</div>}
        {plan.blockers.map(t => <div key={t} className="banner block">{t}</div>)}
        {fl.raised.map(f => <div key={'r' + f.rule} className="banner flag">⚑ New: {FLAG_TEXT(f)} — needs a sales manager</div>)}
        {fl.cleared.filter(f => !fl.raised.some(r => r.rule === f.rule)).map(f => <div key={'c' + f.rule} className="muted">✓ Clears: {FLAG_TEXT(f)}</div>)}
        {voided.length > 0 && <div className="banner block">Applying changes numbers a manager already approved ({voided.join(', ')}); the approval will be voided on save.</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button onClick={() => onApply(choices)}>{nChanges ? `Apply ${nChanges} change${nChanges === 1 ? '' : 's'}` : 'Apply'}</button>
        </div>
      </div>
    </div>
  );
}
