// Right rail: customer price, approvals, Save / Send / PDF, undo and the unsaved-changes list.
import { useState } from 'react';
import type { Priced, Flag, Lint, QuoteDoc, Settings } from '../../../src/engine/manual';
import { fmtMoney } from './smt';
import { FLAG_TEXT, FLAG_LABEL } from './flags';
import type { Change } from './changes';
import { TargetPrice } from './TargetPrice';
import { quoteMoney, showsPreUse } from './engineApi';

export interface RailProps {
  priced: Priced; doc: QuoteDoc; settings: Settings; locked: boolean; dirty: boolean; busy: boolean; hideCost: boolean; setHideCost: (b: boolean) => void;
  openFlags: Flag[]; approvedRules: string[]; isManager: boolean; lint: Lint[]; msg: { t: 'ok' | 'err'; m: string } | null;
  changes: Change[]; voids: string[];
  undo: { can: boolean; label?: string; run: () => void }; redo: { can: boolean; label?: string; run: () => void };
  onSave: () => void; onSend: () => void; onPdf: () => void; onApprove: (rule: string) => void;
  onRevise?: () => void; onWin?: () => void; rev: number | string;
  onTarget: (d: QuoteDoc, label: string) => void;
}

export function PriceRail(r: RailProps) {
  const [showChanges, setShowChanges] = useState(false);
  const [target, setTarget] = useState(false);
  const q = quoteMoney(r.priced);
  const errors = r.lint.filter(l => l.level === 'error');
  const reasons = [
    ...(r.dirty ? ['Save your changes first'] : []),
    ...r.openFlags.map(f => `${FLAG_TEXT(f)} — needs approval`),
    ...errors.map(l => l.message),
  ];
  return (
    <div className="panel qe-rail">
      <div className="card">
        <div className="price-row"><span>Base price</span><b>${fmtMoney(q.base)}</b></div>
        <div className="price-row"><span>Installation</span><span>${fmtMoney(q.installation)}</span></div>
        <div className="price-row"><span>Outbound freight</span><span>${fmtMoney(q.freight)}</span></div>
        {showsPreUse(r.priced) && <div className="price-row"><span>Pre-use inspections</span><span>${fmtMoney(q.preUse)}</span></div>}
        <div className="price-row"><span>Sales tax</span><span>${fmtMoney(q.tax)}</span></div>
        <div className="price-row total"><span>TOTAL</span><span>${fmtMoney(q.total)}</span></div>
        <label className="inline" style={{ marginTop: 6 }}><input type="checkbox" checked={r.hideCost} onChange={e => r.setHideCost(e.target.checked)} /> hide cost &amp; margin (screen-share)</label>
        {!r.locked && <div className="qe-undo">
          <button className="secondary sm" disabled={!r.undo.can} title={r.undo.label ? `Undo: ${r.undo.label} (Ctrl+Z)` : 'Undo (Ctrl+Z)'} onClick={r.undo.run}>↶ Undo</button>
          <button className="secondary sm" disabled={!r.redo.can} title={r.redo.label ? `Redo: ${r.redo.label} (Ctrl+Y)` : 'Redo (Ctrl+Y)'} onClick={r.redo.run}>↷ Redo</button>
          <button className="secondary sm" onClick={() => setTarget(!target)}>Target price…</button>
        </div>}
      </div>
      {target && !r.locked && <TargetPrice doc={r.doc} settings={r.settings} onClose={() => setTarget(false)} onApply={(d, l) => { r.onTarget(d, l); setTarget(false); }} />}
      <div className="card">
        {r.dirty && <div className="qe-unsaved"><button className="link" onClick={() => setShowChanges(!showChanges)}>{r.changes.length || 'Some'} unsaved change{r.changes.length === 1 ? '' : 's'} {showChanges ? '▾' : '▸'}</button>
          {showChanges && <ul>{r.changes.slice(0, 40).map((c, i) => <li key={i}>{c.text}</li>)}{r.changes.length > 40 && <li>…{r.changes.length - 40} more</li>}</ul>}</div>}
        {r.voids.map(v => <div key={v} className="banner block">Saving now voids the manager's approval: {v}</div>)}
        {r.openFlags.map(f => <div key={f.rule} className="banner flag">⚑ {FLAG_TEXT(f)}
          {r.isManager && !r.locked && !r.dirty && <div><button className="sm" onClick={() => r.onApprove(f.rule)}>Approve</button></div>}
          {r.isManager && !r.locked && r.dirty && <div className="muted">Save first, then approve the saved numbers.</div>}</div>)}
        {r.approvedRules.map(x => <div key={x} className="banner ok">✓ {FLAG_LABEL(x)} — approved</div>)}
        {errors.map((l, i) => <div key={i} className="banner block">{l.message}</div>)}
        {r.lint.filter(l => l.level === 'warning').slice(0, 6).map((l, i) => <div key={i} className="msg-warn muted">⚠ {l.message}</div>)}
        {r.msg && <p className={r.msg.t === 'err' ? 'msg-error' : ''}>{r.msg.m}</p>}
        <div className="grid">
          {!r.locked && <button onClick={r.onSave} disabled={r.busy || !r.dirty} title="Ctrl+S">{r.dirty ? 'Save' : 'Saved'}</button>}
          {!r.locked && <button onClick={r.onSend} disabled={r.busy || reasons.length > 0}>Send: lock R{r.rev} + download PDF</button>}
          {!r.locked && reasons.length > 0 && <ul className="qe-reasons">{reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          <button className="secondary" onClick={r.onPdf}>{r.locked ? 'Download PDF' : 'Preview PDF (DRAFT)'}</button>
          {r.locked && r.onRevise && <button className="secondary" onClick={r.onRevise}>Start new revision</button>}
          {r.locked && r.onWin && <button className="secondary" onClick={r.onWin}>Mark won → Confirmation</button>}
        </div>
      </div>
    </div>
  );
}
