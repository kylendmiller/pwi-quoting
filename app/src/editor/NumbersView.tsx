// The new quote editor body: KPI strip · spec chips · Main Summary sheet (expanding into SMT tab grids) ·
// pricing breakdown. Holds every editing action; the parent owns loading, saving, undo history and the rail.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Priced, QuoteDoc, Settings, Flag } from '../../../src/engine/manual';
import type { CategoryKey } from '../../../src/engine/rollup';
import type { Catalog } from '../../../src/engine/kit';
import { linesOf, changedPaths, editCell, revertCell, revertLine, deriveLine, deriveCtx, removeLine, forgetRemoved, removedList, planRebuild, applyPlan, withInstallCrew,
  price, type EditorLine, type RebuildPlan } from './engineApi';
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
  importBox?: (onSpec: (spec: any, label: string) => void) => React.ReactNode;
}

const OPEN_KEY = 'pwi.editor.open';
const readOpen = (): Set<CategoryKey> => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]')); } catch { return new Set(); } };

export function NumbersView(p: NumbersProps) {
  const { doc, priced, settings, locked, refData } = p;
  const [open, setOpenS] = useState<Set<CategoryKey>>(readOpen);
  const setOpen = (s: Set<CategoryKey>) => { setOpenS(s); try { localStorage.setItem(OPEN_KEY, JSON.stringify([...s])); } catch { /* ignore */ } };
  const [pending, setPending] = useState<{ plan: RebuildPlan; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const removedCache = useRef(new Map<string, EditorLine>()).current;
  const k = useMemo(() => kpis(doc, priced), [doc, priced]);
  const ks = useMemo(() => (p.saved ? kpis(p.saved.doc, p.saved.priced) : null), [p.saved]);

  const L = linesOf(doc);
  const setLines = (lines: EditorLine[], label: string) => p.setDoc({ ...doc, lines }, label);
  const ctx = useMemo(() => deriveCtx(refData.shapes, refData.groups, settings), [refData, settings]);
  const describeField = (path: string) => path.replace('detail.', '').replace('lengthFt', 'length').replace('costPerLb', '$/lb').replace('markupPct', 'markup');

  const act = {
    edit: (key: string, path: string, value: unknown) => {
      const l = L.find(x => x.key === key); if (!l) return;
      let n: EditorLine;
      try { n = editCell(l, path, value, ctx); } catch (e: any) { setErr(e.message ?? String(e)); return; }
      setErr('');
      setLines(L.map(x => (x.key === key ? n : x)), `${l.description.split(' — ')[0]}: ${describeField(path)}`);
    },
    revert: (key: string, path: string) => {
      const l = L.find(x => x.key === key); if (!l) return;
      setLines(L.map(x => (x.key === key ? revertCell(l, path, ctx) : x)), `Revert ${describeField(path)}`);
    },
    revertRow: (cat: CategoryKey) => setLines(L.map(x => (x.category === cat && Object.keys(changedPaths(x)).length ? revertLine(x) : x)), 'Undo my changes in row'),
    remove: (key: string) => {
      const r = removeLine(doc, key, priced.lines.find(l => l.key === key)?.sell); if (!r.line) return;
      if (r.ref) removedCache.set(r.ref, r.line);
      p.setDoc(r.doc, `Remove ${r.line.description.split(' — ')[0]}`);
    },
    /** Restore = drop the ref from doc.removed and let the builder put its line back through the rebuild preview
     *  (works after a reload: the line itself isn't stored, the spec rebuilds it). */
    restoreRemoved: async (ref: string) => {
      const e = removedList(doc, removedCache).find(x => x.ref === ref); if (!e) return;
      const name = e.known ? e.description.split(' — ')[0] : ref;
      const d = forgetRemoved(doc, ref);
      if (!doc.spec) { p.setDoc(d, `Restore ${name}`); return; }
      setBusy(true); setErr('');
      try {
        const plan = planRebuild(doc, doc.spec as any, await p.getCatalog(), settings as any, { restore: [ref] });
        if (!plan.specChanges.some(c => c.ref === ref && c.change === 'add')) {
          p.setDoc(d, `Forget removed ${name}`);
          setErr(`The builder no longer makes "${name}" for this spec, so there is nothing to bring back. It was taken off the removed list.`);
        } else setPending({ plan, label: `Restore ${name}` });
      } catch (x: any) { setErr(x.message ?? String(x)); } finally { setBusy(false); }
    },
    add: (cat: CategoryKey, kind?: 'steel' | 'plate') => {
      const s: any = settings;
      let l: EditorLine = { ...newLine(cat, doc.family), source: 'hand' };
      if (kind === 'steel') {
        const shape = refData.shapes.find(x => x.shape === 'W12 x 26')?.shape ?? refData.shapes[0]?.shape;
        const sh = shape ? ctx.shape!(shape) : null;
        const sp = sh ? { lbPerFt: sh.lbPerFt, priceGroup: sh.group, costPerLb: (sh.group ? ctx.steelCost?.perLb[sh.group] : undefined) ?? sh.pricePerLb, costSource: sh.group && ctx.steelCost?.perLb[sh.group] != null ? 'steel_cost' : 'catalog' } : null;
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
    rowMarkup: (cat: CategoryKey, pct: number) => setLines(L.map(x => (x.category === cat && x.unitCost != null ? editCell(x, 'markupPct', pct, ctx) : x)), `Markup ${pct}% on row`),
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
      setPending({ plan: planRebuild(doc, spec, await p.getCatalog(), settings as any), label });
    } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  };
  const fromImport = (spec: any, label: string) => startRebuild(spec, label);
  /** U7: one install control. Men → spec.crewMen, days → spec.installDays (null = the builder's days again); both go
   *  through the rebuild preview, so site hours, travel, lodging, per diem and equipment move together. */
  const onCrew = (crew: { men?: number; days?: number | null }, label: string) => {
    if (crew.days != null && !(Number.isInteger(crew.days) && crew.days >= 1 && crew.days <= 365)) { setErr('Days on site must be a whole number from 1 to 365.'); return; }
    if (crew.men != null && !(Number.isInteger(crew.men) && crew.men >= 1 && crew.men <= 12)) { setErr('Crew must be a whole number of men.'); return; }
    startRebuild(withInstallCrew(doc, crew), label);
  };

  const topFlags = p.openFlags.filter(f => flagRow(f, doc.lines) == null);
  useEffect(() => { if (!p.saved) setNotes([]); }, [p.saved]);
  return (
    <div className="qe-root">
      <div className="qe-sticky"><KpiStrip k={k} saved={ks} hideCost={p.hideCost} /></div>
      <SpecChips doc={doc} locked={locked} busy={busy} onSpec={startRebuild} onCrew={onCrew} />
      {err && <div className="banner block">{err}</div>}
      {topFlags.map(f => <div key={f.rule} className="qe-flagline top">⚑ {FLAG_TEXT(f)} — needs a sales manager.{!locked && <button className="secondary sm" onClick={() => p.askManager(f)}>Ask manager</button>}</div>)}
      {notes.length > 0 && <div className="card qe-notes"><b>Check these (from the rebuild)</b><ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul><button className="secondary sm" onClick={() => setNotes([])}>Done</button></div>}
      <SummarySheet doc={doc} priced={priced} settings={settings} locked={locked} hideCost={p.hideCost} openFlags={p.openFlags} refData={refData} act={act}
        isManager={p.isManager} open={open} setOpen={setOpen} removedCache={removedCache} />
      {!locked && p.importBox?.(fromImport)}
      {pending && <RebuildDialog title={pending.label} plan={pending.plan} oldSpec={doc.spec} approvedRules={p.approvedRules} onCancel={() => setPending(null)}
        current={priced} priceOf={d => price(d, settings)}
        onApply={choices => {
          const next = applyPlan(pending.plan, choices);
          p.setDoc(next, `Rebuild: ${pending.label}`);
          setNotes([...pending.plan.blockers, ...pending.plan.notes]); setOpen(new Set([...open, 'structural'])); setPending(null);
        }} />}
    </div>
  );
}
