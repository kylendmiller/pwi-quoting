// The new quote editor body: KPI strip · spec chips · Main Summary sheet (expanding into SMT tab grids) ·
// pricing breakdown. Holds every editing action; the parent owns loading, saving, undo history and the rail.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Priced, QuoteDoc, Settings, Flag } from '../../../src/engine/manual';
import type { CategoryKey } from '../../../src/engine/rollup';
import type { Catalog } from '../../../src/engine/kit';
import { linesOf, editLine, revertField, revertLine, deriveLine, withRefs, buildFresh, planRebuild, applyPlan, setCrewDaysFallback,
  S_READY, type EditorLine, type EditorDoc, type RebuildPlan } from './engineApi';
import { SummarySheet, type RefData } from './SummarySheet';
import { KpiStrip, kpis } from './KpiStrip';
import { SpecChips } from './SpecChips';
import { RebuildDialog } from './RebuildDialog';
import { FLAG_TEXT, flagRow } from './flags';
import { newLine } from '../model';

export interface NumbersProps {
  doc: QuoteDoc; priced: Priced; saved: { doc: QuoteDoc; priced: Priced } | null;
  setDoc: (d: QuoteDoc, label: string, tag?: string) => void;
  settings: Settings; locked: boolean; hideCost: boolean; refData: RefData;
  getCatalog: () => Promise<Catalog>;
  openFlags: Flag[]; approvedRules: string[]; isManager: boolean;
  askManager: (f: Flag) => void;
  vendorSearch?: (q: string) => Promise<any[]>;
  importBox?: (onBuilt: (fresh: QuoteDoc, label: string, notes: string[]) => void) => React.ReactNode;
}

const OPEN_KEY = 'pwi.editor.open';
const readOpen = (): Set<CategoryKey> => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]')); } catch { return new Set(); } };

export function NumbersView(p: NumbersProps) {
  const { doc, priced, settings, locked, refData } = p;
  const [open, setOpenS] = useState<Set<CategoryKey>>(readOpen);
  const setOpen = (s: Set<CategoryKey>) => { setOpenS(s); try { localStorage.setItem(OPEN_KEY, JSON.stringify([...s])); } catch { /* ignore */ } };
  const [pending, setPending] = useState<{ plan: RebuildPlan; fresh: QuoteDoc; label: string; notes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const removedCache = useRef(new Map<string, EditorLine>()).current;
  const k = useMemo(() => kpis(doc, priced), [doc, priced]);
  const ks = useMemo(() => (p.saved ? kpis(p.saved.doc, p.saved.priced) : null), [p.saved]);

  const L = linesOf(doc);
  const setLines = (lines: EditorLine[], label: string) => p.setDoc({ ...doc, lines }, label);
  const shapeProps = (shape: string) => {
    const s = refData.shapes.find(x => x.shape === shape); if (!s) return null;
    const sc: any = (settings as any).steel_cost;
    const perLb = sc?.perLb?.[s.price_group] ?? refData.groups[s.price_group] ?? 0;
    return { lbPerFt: Number(s.lb_per_ft), priceGroup: s.price_group, costPerLb: perLb, costSource: sc?.perLb?.[s.price_group] != null ? 'steel_cost' : 'catalog' };
  };
  const withShape = (l: EditorLine): EditorLine => {
    const d: any = l.detail; if (d?.type !== 'steel') return l;
    const sp = shapeProps(d.shape); if (!sp) return l;
    const keepPrice = l.edited && 'detail.costPerLb' in l.edited;
    return deriveLine({ ...l, detail: { ...d, lbPerFt: sp.lbPerFt, priceGroup: sp.priceGroup, ...(keepPrice ? {} : { costPerLb: sp.costPerLb, costSource: sp.costSource }) } });
  };
  const describeField = (path: string) => path.replace('detail.', '').replace('lengthFt', 'length').replace('costPerLb', '$/lb').replace('markupPct', 'markup');

  const act = {
    edit: (key: string, path: string, value: unknown) => {
      const l = L.find(x => x.key === key); if (!l) return;
      let n = editLine(l, path, value);
      if (path === 'detail.shape') n = withShape(n);
      setLines(L.map(x => (x.key === key ? n : x)), `${l.description.split(' — ')[0]}: ${describeField(path)}`);
    },
    revert: (key: string, path: string) => {
      const l = L.find(x => x.key === key); if (!l) return;
      let n = revertField(l, path); if (path === 'detail.shape') n = withShape(n);
      setLines(L.map(x => (x.key === key ? n : x)), `Revert ${describeField(path)}`);
    },
    revertRow: (cat: CategoryKey) => setLines(L.map(x => (x.category === cat && x.edited ? withShape(revertLine(x)) : x)), 'Undo my changes in row'),
    remove: (key: string) => {
      const l = L.find(x => x.key === key); if (!l) return;
      let removed = (doc as EditorDoc).removed ?? [];
      if (l.auto) { const ref = withRefs(L).find(x => x.key === key)!._ref; removedCache.set(ref, l); removed = [...removed, ref]; }
      p.setDoc({ ...doc, lines: L.filter(x => x.key !== key), removed } as EditorDoc, `Remove ${l.description.split(' — ')[0]}`);
    },
    restoreRemoved: (ref: string) => {
      const l = removedCache.get(ref); if (!l) return;
      p.setDoc({ ...doc, lines: [...L, l], removed: ((doc as EditorDoc).removed ?? []).filter(r => r !== ref) } as EditorDoc, `Restore ${l.description.split(' — ')[0]}`);
    },
    add: (cat: CategoryKey, kind?: 'steel' | 'plate') => {
      const s: any = settings;
      let l: EditorLine = { ...newLine(cat, doc.family), source: 'hand' };
      if (kind === 'steel') {
        const shape = refData.shapes.find(x => x.shape === 'W12 x 26')?.shape ?? refData.shapes[0]?.shape;
        const sp = shape ? shapeProps(shape) : null;
        l = { ...l, description: `New beam — ${shape} × 20'`, qty: 1, markupPct: Number(s.structural_markup_pct ?? 26), unitCost: 0,
          ...(sp ? { detail: { type: 'steel', shape, lengthFt: 20, lbPerFt: sp.lbPerFt, lbEach: 0, priceGroup: sp.priceGroup, costPerLb: sp.costPerLb, costSource: sp.costSource as any, paintUnitsEach: 1 } } : {}) };
        l = deriveLine(l);
      } else if (kind === 'plate') {
        const perLb = Number(s.steel_cost?.perLb?.Plate ?? s.plate_price_per_lb ?? 1.35);
        l = deriveLine({ ...l, description: `New plate — 0.5" × 12" × 12"`, qty: 1, markupPct: Number(s.plate_markup_pct ?? 21), unitCost: 0,
          detail: { type: 'plate', tIn: 0.5, wIn: 12, lIn: 12, lbPerIn3: 0.2833, dropFactor: Number(s.plate_drop_factor ?? 1.1), lbEach: 0, costPerLb: perLb, costSource: 'catalog' } });
      } else if (l.kind === 'material' || l.kind === 'travel' || l.kind === 'equipment') {
        l = cat === 'stdParts' || cat === 'decals' || cat === 'painting' ? { ...l, description: 'New line', unitSell: 0 } : { ...l, description: 'New line', unitCost: 0, markupPct: cat === 'travel' || cat === 'equipment' ? 15 : 30 };
      } else l = { ...l, description: l.kind === 'shop_labor' ? 'Manual shop hours' : l.kind === 'site_labor' ? 'Manual on-site hours' : 'Manual hours', qty: 0, laborOp: l.kind === 'shop_labor' ? 'shop_other' : l.kind === 'site_labor' ? 'site_other' : undefined };
      setLines([...L, l], `Add line to ${cat}`);
      setOpen(new Set([...open, cat]));
    },
    rowMarkup: (cat: CategoryKey, pct: number) => setLines(L.map(x => (x.category === cat && x.unitCost != null ? editLine(x, 'markupPct', pct) : x)), `Markup ${pct}% on row`),
    patchDoc: (patch: Partial<QuoteDoc>, label: string) => p.setDoc({ ...doc, ...patch }, label),
    askManager: p.askManager,
    vendorSearch: p.vendorSearch,
    addVendor: (v: any) => {
      const d = refData.discounts[v.vendor] ?? { pwi_discount_pct: 0, customer_discount_pct: 0 };
      const l = deriveLine({ ...newLine('vendor', doc.family), source: 'hand', description: `${v.vendor} ${v.part} — ${v.description}`, qty: 1,
        detail: { type: 'vendor', vendor: v.vendor, part: v.part, partDescription: v.description, list: Number(v.list), pwiDiscPct: Number(d.pwi_discount_pct), customerDiscPct: Number(d.customer_discount_pct), costEach: 0, sellEach: 0 } } as EditorLine);
      setLines([...L, l], `Add ${v.part}`);
    },
  };

  const startRebuild = async (spec: any, label: string) => {
    setBusy(true); setErr('');
    try {
      const b = buildFresh(doc, spec, await p.getCatalog(), settings);
      setPending({ plan: planRebuild(doc as EditorDoc, b.doc, settings), fresh: b.doc, label, notes: [...b.blockers, ...b.notes] });
    } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  };
  const fromImport = (fresh: QuoteDoc, label: string, n: string[]) => {
    const f = { ...fresh, lines: fresh.lines.filter(l => l.auto) };
    setPending({ plan: planRebuild(doc as EditorDoc, f, settings), fresh: f, label, notes: n });
  };
  const onCrewDays = (men: number, days: number) => {
    if (!(days >= 1 && days <= 365)) return;
    if (S_READY.crewDays) startRebuild({ ...(doc.spec as any), items: (doc.spec as any).items.map((it: any) => (it.install ? { ...it, crewDays: days } : it)) }, `Crew days → ${days}`);
    else p.setDoc(setCrewDaysFallback(doc as EditorDoc, men, days, doc.family), `Crew ${men} men × ${days} days`);
  };

  const topFlags = p.openFlags.filter(f => flagRow(f.rule) == null);
  useEffect(() => { if (!p.saved) setNotes([]); }, [p.saved]);
  return (
    <div className="qe-root">
      <div className="qe-sticky"><KpiStrip k={k} saved={ks} hideCost={p.hideCost} /></div>
      <SpecChips doc={doc} locked={locked} busy={busy} onSpec={startRebuild} onCrewDays={onCrewDays} />
      {err && <div className="banner block">{err}</div>}
      {topFlags.map(f => <div key={f.rule} className="qe-flagline top">⚑ {FLAG_TEXT(f)} — needs a sales manager.{!locked && <button className="secondary sm" onClick={() => p.askManager(f)}>Ask manager</button>}</div>)}
      {notes.length > 0 && <div className="card qe-notes"><b>Check these (from the rebuild)</b><ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul><button className="secondary sm" onClick={() => setNotes([])}>Done</button></div>}
      <SummarySheet doc={doc} priced={priced} settings={settings} locked={locked} hideCost={p.hideCost} openFlags={p.openFlags} refData={refData} act={act}
        isManager={p.isManager} open={open} setOpen={setOpen} removedCache={removedCache} />
      {!locked && p.importBox?.(fromImport)}
      {pending && <RebuildDialog title={pending.label} plan={pending.plan} approvedRules={p.approvedRules} onCancel={() => setPending(null)}
        onApply={choices => {
          const next = applyPlan(doc as EditorDoc, pending.fresh, pending.plan, choices);
          p.setDoc(next, `Rebuild: ${pending.label}`);
          setNotes(pending.notes); setOpen(new Set([...open, 'structural'])); setPending(null);
        }} />}
    </div>
  );
}
