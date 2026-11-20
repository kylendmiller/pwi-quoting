// Standalone harness (#/harness): builds a quote from a sample spec with the reference price lists
// (the same data the engine tests use) and renders the real editor components. No login, no network,
// no Supabase writes. Only compiled into dev builds or builds made with VITE_HARNESS=1.
import { useMemo, useState } from 'react';
import parts from '../../../reference/standard_parts.json';
import shapes from '../../../reference/steel_shapes.json';
import groups from '../../../reference/steel_price_groups.json';
import decals from '../../../reference/decals.json';
import equipment from '../../../reference/equipment.json';
import vp from '../../../db/seed_vendor_parts.json';
import SC from '../../../src/engine/rules/steel_cost.default.json';
import type { Catalog } from '../../../src/engine/kit';
import { buildFromSpec, type QuoteSpec } from '../../../src/engine/buildSpec';
import type { QuoteDoc, Settings } from '../../../src/engine/manual';
import { NumbersView } from './NumbersView';
import { PriceRail } from './PriceRail';
import { useDocHistory, useEditorKeys } from './useDocHistory';
import { diffDocs } from './changes';
import { price } from './engineApi';
import './editor.css';

const allV = (vp as [string, string, string, number][]).map(([vendor, part, description, list]) => ({ vendor, part, description, list }));
const disc: Record<string, [number, number]> = { Starke: [50, 5], 'Street Crane': [20, 10], 'Columbus McKinnon': [35, 32], InMotion: [50, 5] };
const G = groups as Record<string, { price_per_lb: number }>;
const P = parts as any[];
export const harnessCatalog: Catalog = {
  stdSell: d => P.find(p => p.description === d)?.sell ?? null,
  stdHours: d => P.find(p => p.description === d)?.shop_hours_each ?? 0,
  stdGm: d => P.find(p => p.description === d)?.gm_pct ?? null,
  vendor: part => allV.find(p => p.part === part) ?? null,
  vendorParts: prefix => allV.filter(p => p.part.startsWith(prefix)),
  discount: v => ({ pwi: disc[v]?.[0] ?? 0, customer: disc[v]?.[1] ?? 0 }),
  shape: n => { const s = (shapes as any[]).find(x => x.shape === n); return s ? { lbPerFt: s.lb_per_ft, pricePerLb: G[s.group].price_per_lb, group: s.group } : null; },
  plate: { pricePerLb: 1.35, markupPct: 21, dropFactor: 1.1 }, structuralMarkupPct: 26,
  decalSell: n => (decals as any[]).find(d => d.item === n)?.price ?? null,
  stdAll: () => P.map(x => ({ description: x.description, part: x.part, sell: x.sell, hours: x.shop_hours_each ?? 0, info: x.vendor, section: x.section })),
  rate: item => ({ 'Standard Paint Full Booth Run': 1983.75, 'Custom Color Paint Full Booth Run': 2530, 'Primer Full Booth Run': 1587, 'Hotels (one room per person)': 170, 'Per diem costs': 75 } as any)[item] ?? null,
  equip: item => { const e = (equipment as any[]).find(x => x.item.trim() === item); return e ? { daily: e.daily, weekly: e.weekly ?? e.daily * 5, monthly: e.monthly ?? e.daily * 20 } : null; },
};
const SETTINGS = { shop_rate: 140, onsite_rate: 113, pm_rate: 95, cad_rate: 120, pe_rate: 180, freestanding_pv_per_shop_hour: 38.6, one_pct_adder: { on: true }, sales_tax_rate: 0.07, banned_strings: [], steel_cost: SC } as unknown as Settings;

const SPECS: Record<string, QuoteSpec> = {
  fstr: { pwi_quote: 1, project: 'Paint line cranes', location: 'Elkhart, IN', items: [{ type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 }] },
  bridge: { pwi_quote: 1, project: 'Bay 3 bridge crane', items: [{ type: 'bridge', support: 'building_runway', capacityTons: 10, spanFt: 46, runwayOalFt: 120, overallHeightFt: 24, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 250 }] },
  multi: { pwi_quote: 1, project: 'Plant expansion', items: [
    { type: 'freestanding', tag: 'Bay A', capacityTons: 3, spanFt: 25, runwayOalFt: 60, overallHeightFt: 18, bridgeDrive: 'motorized', install: true, miles: 150, colors: { columns: 'safety yellow' } },
    { type: 'mezzanine', tag: 'Office', lengthFt: 40, widthFt: 30, deckHeightFt: 12, stairs: 1, install: true, miles: 150 }] },
};
const base: QuoteDoc = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [], suggestedInstallHours: null, freestandingShopHours: 0, pvPerHourOverride: null };
const refData = {
  shapes: (shapes as any[]).map(s => ({ shape: s.shape, lb_per_ft: s.lb_per_ft, price_group: s.group })),
  groups: Object.fromEntries(Object.entries(G).map(([k, v]) => [k, v.price_per_lb])),
  discounts: Object.fromEntries(Object.entries(disc).map(([v, [p, c]]) => [v, { pwi_discount_pct: p, customer_discount_pct: c }])),
};

export default function Harness() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const which = q.get('spec') ?? 'fstr';
  const built = useMemo(() => buildFromSpec(SPECS[which] ?? SPECS.fstr, harnessCatalog, SETTINGS, base).doc, [which]);
  const H = useDocHistory(built);
  const [saved, setSaved] = useState<QuoteDoc>(built);
  const [hide, setHide] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const doc = H.doc ?? built;
  const priced = useMemo(() => price(doc, SETTINGS), [doc]);
  const savedP = useMemo(() => price(saved, SETTINGS), [saved]);
  const dirty = doc !== saved;
  const save = () => { setSaved(doc); setMsg({ t: 'ok', m: 'Saved (harness — nothing leaves this page)' }); };
  useEditorKeys({ undo: H.undo, redo: H.redo, save });
  const open = q.get('open');
  if (open && !sessionStorage.getItem('h-open')) { try { localStorage.setItem('pwi.editor.open', JSON.stringify(open.split(','))); sessionStorage.setItem('h-open', '1'); } catch { /* ignore */ } }
  return (
    <>
    <header className="top"><img src="/pwi-logo.png" alt="PWI" /><nav><a href="#/harness">QUOTES</a><a href="#/harness">NEW QUOTE</a></nav><span className="me">Harness (no login, no network)</span></header>
    <main>
      <div className="qe-page">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>29140 · Harness Mfg · {SPECS[which]?.project}</h2>
          <span className="row muted">sample: {Object.keys(SPECS).map(k => <a key={k} href={`#/harness?spec=${k}`} onClick={() => setTimeout(() => location.reload())}>{k}</a>)}</span>
        </div>
        <div className="editor qe-editor">
          <div className="qe-main">
            <NumbersView doc={doc} priced={priced} saved={{ doc: saved, priced: savedP }} setDoc={(d, l, t) => H.set(d, l, t)} settings={SETTINGS} locked={false} hideCost={hide}
              refData={refData} getCatalog={async () => harnessCatalog} openFlags={priced.flags} approvedRules={[]} isManager={false}
              askManager={f => setMsg({ t: 'ok', m: `Would ask manager about ${f.rule}` })} />
          </div>
          <PriceRail priced={priced} doc={doc} settings={SETTINGS} locked={false} dirty={dirty} busy={false} hideCost={hide} setHideCost={setHide}
            openFlags={priced.flags} approvedRules={[]} isManager={false} lint={priced.lint} msg={msg} changes={diffDocs(saved, doc)} voids={[]}
            undo={{ can: H.canUndo, label: H.undoLabel, run: H.undo }} redo={{ can: H.canRedo, label: H.redoLabel, run: H.redo }}
            onSave={save} onSend={() => setMsg({ t: 'ok', m: 'Send is disabled in the harness' })} onPdf={() => setMsg({ t: 'ok', m: 'PDF is disabled in the harness' })} onApprove={() => {}}
            rev={1} onTarget={(d, l) => H.set(d, l)} />
        </div>
      </div>
    </main>
    </>
  );
}
