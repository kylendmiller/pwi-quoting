// The Main Summary sheet (U1, U2, U9): SMT rows D4–D26 in order, each opening in place into its tab grid,
// then the pricing breakdown A27–A36 (all editable cells of that block live here).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Priced, QuoteDoc, Settings, Flag } from '../../../src/engine/manual';
import type { CategoryKey } from '../../../src/engine/rollup';
import { linesOf, stdCostKnown, type EditorLine } from './engineApi';
import { ROWS, PEEK_ROWS, rowStats, peek, fmtMoney, fmtNum, fmtPct, type RowStats } from './smt';
import { colsFor } from './tabs';
import { Grid } from './Grid';
import { BasisBox } from './BasisBox';
import { FLAG_TEXT, flagRow } from './flags';

export interface RefData { shapes: { shape: string; lb_per_ft: number; price_group: string }[]; groups: Record<string, number>; discounts: Record<string, any> }
export interface SheetActions {
  edit: (key: string, path: string, value: unknown) => void;
  revert: (key: string, path: string) => void;
  revertRow: (cat: CategoryKey) => void;
  remove: (key: string) => void;
  add: (cat: CategoryKey, kind?: 'steel' | 'plate') => void;
  rowMarkup: (cat: CategoryKey, pct: number) => void;
  patchDoc: (p: Partial<QuoteDoc>, label: string) => void;
  askManager: (f: Flag) => void;
  vendorSearch?: (q: string) => Promise<any[]>;
  addVendor?: (p: any) => void;
  restoreRemoved: (ref: string) => void;
}
interface Props {
  doc: QuoteDoc; priced: Priced; settings: Settings; locked: boolean; hideCost: boolean;
  openFlags: Flag[]; refData: RefData; act: SheetActions; isManager: boolean;
  open: Set<CategoryKey>; setOpen: (s: Set<CategoryKey>) => void; removedCache: Map<string, EditorLine>;
}

export function SummarySheet({ doc, priced, settings, locked, hideCost, openFlags, refData, act, open, setOpen, removedCache }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [hl, setHl] = useState<Set<string>>(new Set());
  const stats = useMemo(() => rowStats(doc, priced), [doc, priced]);
  const shapes = useMemo(() => refData.shapes.map(s => s.shape), [refData]);
  const rowsRef = useRef<(HTMLDivElement | null)[]>([]);
  const visible = stats.filter(s => showAll || s.lines.length || (s.def.key === 'costBased' && priced.totals.productionValue));
  const flagsFor = (k: CategoryKey) => openFlags.filter(f => flagRow(f.rule) === k);
  const toggle = (k: CategoryKey, on?: boolean) => { const n = new Set(open); (on ?? !n.has(k)) ? n.add(k) : n.delete(k); setOpen(n); };
  const ro = priced.rollup;
  const totalLb = stats.reduce((a, s) => a + s.lb, 0);
  const sumSell = stats.reduce((a, s) => a + s.sell, 0);
  const sumCost = stats.reduce((a, s) => a + s.cost, 0);
  const anyUnknown = stats.some(s => s.costUnknown);
  const onePctOn = settings.one_pct_adder?.on;

  const rowKey = (e: React.KeyboardEvent, i: number, k: CategoryKey) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); rowsRef.current[i + 1]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); rowsRef.current[i - 1]?.focus(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); toggle(k, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); toggle(k, false); }
  };

  return (
    <div className={`qe-sheet ${hideCost ? 'hc' : ''}`}>
      <div className="qe-sheet-head">
        <span className="qe-c-label">Main Summary</span>
        <span className="num">Tons / Hrs</span>
        {!hideCost && <span className="num">Cost</span>}
        <span className="num">Sell</span>
        {!hideCost && <span className="num">GM $</span>}
        {!hideCost && <span className="num">GM %</span>}
      </div>
      {visible.map((s, i) => {
        const k = s.def.key, isOpen = open.has(k), fl = flagsFor(k);
        const pk = PEEK_ROWS.includes(k) ? peek(s) : [];
        return (
          <div key={k} className={`qe-row ${isOpen ? 'open' : ''} ${s.def.install ? 'inst' : ''}`}>
            <div className="qe-row-main" tabIndex={0} ref={el => { rowsRef.current[i] = el; }} onClick={() => toggle(k)} onKeyDown={e => rowKey(e, i, k)}
              title={!PEEK_ROWS.includes(k) && s.lines.length ? peek(s).join(' · ') : undefined} aria-expanded={isOpen}>
              <span className="qe-c-label">
                <span className="caret">{s.lines.length || k === 'costBased' ? (isOpen ? '▾' : '▸') : '·'}</span>
                <span className="lbl">{s.def.label}</span>
                {s.def.install && <span className="qe-badge inst" title="Goes to Installation Charges (× 1.01), not Base">install</span>}
                {s.edited > 0 && <span className="qe-badge ed" title="Values you changed on built lines">{s.edited} changed</span>}
                {s.hand > 0 && <span className="qe-badge hand" title="Lines you added">{s.hand} added</span>}
                {fl.length > 0 && <span className="qe-badge flag" title={fl.map(FLAG_TEXT).join('\n')}>⚑ approval</span>}
                {s.lines.some(l => l.basis?.flag) && <span className="qe-badge flag" title={s.lines.filter(l => l.basis?.flag).map(l => l.basis!.flag).join('\n')}>review</span>}
              </span>
              <span className="num">{measure(s)}</span>
              {!hideCost && <span className="num">{s.lines.length ? (s.costUnknown ? <i title="Standard-part cost pending the engine update (std_parts gm_pct)">pending</i> : fmtMoney(s.cost)) : ''}</span>}
              <span className="num b">{s.sell || s.lines.length ? fmtMoney(s.sell) : ''}</span>
              {!hideCost && <span className="num">{s.gmPct == null ? '' : fmtMoney(s.gm)}</span>}
              {!hideCost && <span className={`num ${s.gmPct != null && s.gmPct < 0.15 ? 'bad' : ''}`} title={s.estCost ? 'Labor cost is the SMT standard labor cost, not payroll' : undefined}>{s.gmPct == null ? (s.costUnknown && s.sell ? '—' : '') : fmtPct(s.gmPct)}{s.estCost && s.gmPct != null ? <sup>std</sup> : null}</span>}
            </div>
            {!isOpen && pk.length > 0 && <div className="qe-peek" onClick={() => toggle(k, true)}>{pk.join(' · ')}</div>}
            {fl.map(f => <FlagLine key={f.rule} f={f} onAsk={() => act.askManager(f)} locked={locked} />)}
            {isOpen && <RowDetail s={s} doc={doc} priced={priced} locked={locked} hideCost={hideCost} act={act} shapes={shapes} hl={hl} setHl={setHl} settings={settings} removedCache={removedCache} />}
          </div>
        );
      })}
      <div className="qe-sheet-tools">
        <label><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> show all {ROWS.length} rows</label>
        <button className="link" onClick={() => setOpen(new Set(visible.map(s => s.def.key)))}>expand all</button>
        <button className="link" onClick={() => setOpen(new Set())}>collapse all</button>
        <span className="muted">↑↓ rows · → open · ← close · in a grid: Enter edits, Tab moves, Esc cancels, =2*40 or 20'6" work</span>
      </div>

      {/* Pricing breakdown — Main Summary A27:A36 */}
      <div className="qe-rollup">
        <div className="qe-rl"><span>Total Project Tons / Price</span><span className="num">{fmtNum(totalLb / 2000, 2)} t</span>{!hideCost && <span className="num">{anyUnknown ? '' : fmtMoney(sumCost)}</span>}<span className="num b">{fmtMoney(sumSell)}</span></div>
        {onePctOn && <div className="qe-rl sub"><span>Hidden 1% (rows 4–22, 25)</span><span /><span className="num">{fmtMoney(ro.onePct)}</span></div>}
        <div className="qe-rl"><span><b>Base Price</b>{doc.dealerDiscount > 0 && <small className="muted"> (dealer/GC base; SMT drops the 1%)</small>}</span><span /><span className="num b">{fmtMoney(ro.quote.base)}</span></div>
        <div className="qe-rl"><span>Installation Charges <small className="muted">(travel + equipment + on-site × 1.01)</small></span><span /><span className="num">{fmtMoney(ro.quote.installation)}</span></div>
        <div className="qe-rl"><span>Outbound Freight Charges</span><span />
          <span className="num"><NumIn disabled={locked} value={doc.outboundFreight} onCommit={v => act.patchDoc({ outboundFreight: v }, 'Outbound freight')} /></span></div>
        <div className="qe-rl"><span>Pre-Use Inspections and Load Tests <label className="inline"><input type="checkbox" disabled={locked} checked={doc.showPreUse} onChange={e => act.patchDoc({ showPreUse: e.target.checked }, 'Show pre-use')} /> show on quote</label></span><span />
          <span className="num"><NumIn disabled={locked} value={doc.preUse} onCommit={v => act.patchDoc({ preUse: v }, 'Pre-use')} /></span></div>
        <div className="qe-rl"><span>Sales Tax <select disabled={locked} value={doc.taxOn ? 'y' : 'n'} onChange={e => act.patchDoc({ taxOn: e.target.value === 'y' }, 'Sales tax')}>
          <option value="n">exempt / not charged</option><option value="y">charge {(settings.sales_tax_rate * 100).toFixed(1)}%</option></select></span><span /><span className="num">{fmtMoney(ro.quote.tax)}</span></div>
        <div className="qe-rl"><span>Dealer / GC discount <small className="muted">(dealers only — skips vendor items, inbound freight and the 1%)</small></span><span />
          <span className="num"><NumIn disabled={locked} value={Math.round(doc.dealerDiscount * 1000) / 10} suffix="%" onCommit={v => act.patchDoc({ dealerDiscount: v / 100 }, 'Dealer/GC discount')} /></span></div>
        <div className="qe-rl total"><span>Total Project Price</span><span /><span className="num">${fmtMoney(ro.quote.total)}</span></div>
      </div>
    </div>
  );
}

function measure(s: RowStats) {
  if (!s.lines.length) return '';
  if (s.def.measure === 'tons') return <>{fmtNum(s.lb / 2000, 2)} t{s.noWeight ? <small className="bad" title="Lines with no shape/weight"> +{s.noWeight}?</small> : null}</>;
  if (s.def.measure === 'hours') return `${fmtNum(s.hours, 1)} h`;
  if (s.def.measure === 'runs') return `${fmtNum(s.runs, 0)} run${s.runs === 1 ? '' : 's'}`;
  return '';
}

function FlagLine({ f, onAsk, locked }: { f: Flag; onAsk: () => void; locked: boolean }) {
  return <div className="qe-flagline">⚑ {FLAG_TEXT(f)} — needs a sales manager.{!locked && <button className="secondary sm" onClick={onAsk}>Ask manager</button>}</div>;
}

export function NumIn({ value, onCommit, disabled, suffix, width = 90 }: { value: number; onCommit: (v: number) => void; disabled?: boolean; suffix?: string; width?: number }) {
  const [t, setT] = useState<string | null>(null);
  const done = () => { if (t != null) { const n = Number(t.replace(/[$,\s%]/g, '')); if (isFinite(n) && n !== value) onCommit(n); } setT(null); };
  return <span className="qe-numin"><input disabled={disabled} style={{ width }} value={t ?? (value ?? 0)} onChange={e => setT(e.target.value)} onBlur={done}
    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setT(null); }} />{suffix}</span>;
}

const MARKUP_ROWS: CategoryKey[] = ['structural', 'plate', 'miscSteel', 'xBracing', 'costBased', 'travel', 'equipment'];

function RowDetail({ s, doc, priced, locked, hideCost, act, shapes, hl, setHl, settings, removedCache }: {
  s: RowStats; doc: QuoteDoc; priced: Priced; locked: boolean; hideCost: boolean; act: SheetActions; shapes: string[]; hl: Set<string>; setHl: (s: Set<string>) => void; settings: Settings; removedCache: Map<string, EditorLine>;
}) {
  const k = s.def.key;
  const all = colsFor(s.def.tab).filter(c => !(hideCost && c.costOnly));
  const storeKey = `pwi.editor.cols.${s.def.tab}`;
  const [extra, setExtra] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(storeKey) ?? '[]'); } catch { return []; } });
  const [pick, setPick] = useState(false);
  const [mk, setMk] = useState('');
  const docLines = linesOf(doc);
  const noDetail = s.lines.some(l => !l.detail && l.unitCost != null);
  const cols = all.filter(c => !c.extra || extra.includes(c.id) || (c.id === 'costEa' && noDetail && !hideCost));
  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(extra)); } catch { /* ignore */ } }, [extra]);
  const rows = s.lines.map(p => ({ line: docLines.find(l => l.key === p.key)!, priced: p })).filter(r => r.line);
  const edited = rows.filter(r => r.line.edited).length;
  const removed = ((doc as any).removed ?? []) as string[];
  const removedHere = removed.filter(r => removedCache.get(r)?.category === k);
  const pv = k === 'costBased' && (doc.family === 'freestanding' || priced.totals.productionValue > 0);
  const extras = all.filter(c => c.extra);
  return (
    <div className="qe-detail">
      <div className="qe-detail-bar">
        <span className="muted">SMT tab: <b>{s.def.tabName}</b></span>
        {MARKUP_ROWS.includes(k) && !locked && rows.some(r => r.line.unitCost != null) &&
          <span className="qe-mk">Markup for all lines <input value={mk} placeholder={String(rows.find(r => r.line.unitCost != null)?.line.markupPct ?? '')} onChange={e => setMk(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && mk !== '' && isFinite(Number(mk))) { act.rowMarkup(k, Number(mk)); setMk(''); } }} />% ↵</span>}
        <span className="grow" />
        {extras.length > 0 && <span className="qe-colpick"><button className="link" onClick={() => setPick(!pick)}>Columns ▾</button>
          {pick && <span className="qe-colmenu">{extras.map(c => <label key={c.id}><input type="checkbox" checked={extra.includes(c.id)} onChange={e => setExtra(e.target.checked ? [...extra, c.id] : extra.filter(x => x !== c.id))} /> {c.label}</label>)}</span>}</span>}
        {edited > 0 && !locked && <button className="link" onClick={() => act.revertRow(k)}>Undo my changes in this row ({edited})</button>}
        {!locked && (s.def.tab === 'structural'
          ? <button className="link" onClick={() => act.add(k, 'steel')}>+ Add beam</button>
          : s.def.tab === 'plate' ? <button className="link" onClick={() => act.add(k, 'plate')}>+ Add plate</button>
          : <button className="link" onClick={() => act.add(k)}>+ Add line</button>)}
      </div>
      {s.def.key === 'structural' && <BasisBox doc={doc} lines={docLines} active={hl} onPick={keys => setHl(new Set(keys))} />}
      {s.def.tab === 'vendor' && !locked && act.vendorSearch && <VendorAdd search={act.vendorSearch} onPick={p => act.addVendor?.(p)} />}
      {pv && <div className="qe-pv">Freestanding Production Value: {fmtNum(effectiveShop(doc), 1)} shop h × $
        <NumIn disabled={locked} width={64} value={doc.pvPerHourOverride ?? settings.freestanding_pv_per_shop_hour} onCommit={v => act.patchDoc({ pvPerHourOverride: v === settings.freestanding_pv_per_shop_hour ? null : v }, 'PV $/shop h')} />
        /h = <b>${fmtMoney(priced.totals.productionValue)}</b> <span className="muted">(100% margin, in Base)</span></div>}
      {rows.length > 0 && <Grid rows={rows} cols={cols} locked={locked} onEdit={act.edit} onRevert={act.revert} onDelete={act.remove} highlight={hl} shapes={s.def.tab === 'structural' ? shapes : undefined}
        rowNote={l => [l.auto ? l.basis?.flag : undefined, !l.detail && s.def.measure === 'tons' ? 'No shape/weight on this line, so tons are low' : undefined].filter(Boolean).join(' · ') || undefined} />}
      {k === 'onsiteLabor' && doc.suggestedInstallHours != null && <div className="qe-sugg">Suggested install {fmtNum(doc.suggestedInstallHours, 1)} h → quoted {fmtNum(priced.totals.installHours, 1)} h
        {priced.totals.installHours + 0.05 < doc.suggestedInstallHours && <b className="bad"> · below suggested (needs approval)</b>}</div>}
      {removedHere.length > 0 && <div className="qe-removed">Removed by you: {removedHere.map(r => <span key={r}>{removedCache.get(r)!.description.split(' — ')[0]} {!locked && <button className="link" onClick={() => act.restoreRemoved(r)}>restore</button>}</span>)}</div>}
      <div className="qe-detail-foot">
        <span>{rows.length} line{rows.length === 1 ? '' : 's'}</span>
        {s.def.measure === 'tons' && <span>{fmtNum(s.lb, 0)} lb · {fmtNum(s.lb / 2000, 2)} t</span>}
        {s.def.measure === 'hours' && <span>{fmtNum(s.hours, 1)} h</span>}
        {!hideCost && <span>cost {s.costUnknown ? 'pending' : fmtMoney(s.cost)}</span>}
        <b>sell {fmtMoney(s.sell)}</b>
      </div>
    </div>
  );
}
const effectiveShop = (doc: QuoteDoc) => doc.lines.filter(l => l.kind === 'shop_labor').reduce((a, l) => a + l.qty, 0);

function VendorAdd({ search, onPick }: { search: (q: string) => Promise<any[]>; onPick: (p: any) => void }) {
  const [q, setQ] = useState(''); const [hits, setHits] = useState<any[]>([]);
  useEffect(() => { if (q.length < 3) { setHits([]); return; } const t = setTimeout(() => search(q).then(setHits).catch(() => setHits([])), 250); return () => clearTimeout(t); }, [q]);
  return <div className="qe-vadd"><input placeholder="Add vendor part: search Starke / Street / CM / InMotion part # or description" value={q} onChange={e => setQ(e.target.value)} />
    {hits.map(p => <div key={p.vendor + p.part} className="hit" onClick={() => { onPick(p); setQ(''); }}>+ {p.vendor} {p.part} — {p.description} (list ${p.list})</div>)}</div>;
}
