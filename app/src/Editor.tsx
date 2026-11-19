import { useEffect, useMemo, useState } from 'react';
import { supabase, api, money } from './supabase';
import { priceManual, type QuoteDoc, type QuoteLine, type Settings } from '../../src/engine/manual';
import type { CategoryKey } from '../../src/engine/rollup';
import { CATEGORIES, FAMILIES, isHours, newLine, kindOf } from './model';
import { downloadPdf } from './QuotePdf';
import type { Profile } from './main';
import library from './wording-library.txt?raw';

const LIBRARY = library.split(/^=== /m).filter(Boolean).map(b => {
  const [head, ...rest] = b.split('\n'); return { title: rest.find(l => l.trim()) ?? head, text: rest.join('\n').trim() };
});
const FLAG_TEXT: Record<string, string> = {
  INSTALL_BELOW_SUGGESTED: 'Install hours are below the suggested amount',
  INSTALL_MANUAL_NO_SUGGESTION: 'Install was entered by hand with no suggested amount',
  PV_BELOW_FLOOR: 'Freestanding Production Value was lowered',
  CLASS_D: 'Class D crane',
};

export function Editor({ quoteId, me }: { quoteId: string; me: Profile }) {
  const [quote, setQuote] = useState<any>(null);
  const [revs, setRevs] = useState<any[]>([]);
  const [rev, setRev] = useState<any>(null);
  const [doc, setDoc] = useState<QuoteDoc | null>(null);
  const [header, setHeader] = useState<any>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ref, setRef] = useState<any>({ ops: [], parts: [], shapes: [], groups: {}, discounts: {} });
  const [approvals, setApprovals] = useState<any[]>([]);
  const [hideInternal, setHideInternal] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vendorQ, setVendorQ] = useState('');
  const [vendorHits, setVendorHits] = useState<any[]>([]);

  const load = async (revId?: string) => {
    const { data: q } = await supabase.from('quotes').select('*, customers(*), contacts(*)').eq('id', quoteId).single();
    const { data: rs } = await supabase.from('quote_revisions').select('*').eq('quote_id', quoteId).order('rev');
    setQuote(q); setRevs(rs ?? []);
    const cur = (rs ?? []).find(r => r.id === revId) ?? (rs ?? []).at(-1);
    setRev(cur); setDoc(cur?.doc?.lines ? cur.doc : { ...(cur?.doc ?? {}), lines: [], wording: '', options: [] });
    setHeader({ project_name: q?.project_name, job_location: q?.job_location });
    const { data: ap } = await supabase.from('approvals').select('*').eq('revision_id', cur?.id);
    setApprovals(ap ?? []); setDirty(false);
  };
  useEffect(() => {
    load();
    (async () => {
      const [s, ops, parts, shapes, groups, disc] = await Promise.all([
        supabase.from('settings').select('key,value'), supabase.from('labor_ops').select('*').eq('active', true).order('side'),
        supabase.from('std_parts').select('*').eq('active', true).order('section'), supabase.from('steel_shapes').select('*').order('shape'),
        supabase.from('steel_price_groups').select('*'), supabase.from('vendor_discounts').select('*')]);
      const so: any = {}; for (const r of s.data ?? []) so[r.key] = r.value; setSettings(so);
      setRef({ ops: ops.data ?? [], parts: parts.data ?? [], shapes: shapes.data ?? [],
        groups: Object.fromEntries((groups.data ?? []).map((g: any) => [g.code, Number(g.price_per_lb)])),
        discounts: Object.fromEntries((disc.data ?? []).map((d: any) => [d.vendor, d])) });
    })();
  }, [quoteId]);
  useEffect(() => {
    if (vendorQ.length < 3) { setVendorHits([]); return; }
    const t = setTimeout(() => supabase.from('vendor_parts').select('*').or(`part.ilike.%${vendorQ}%,description.ilike.%${vendorQ}%`).limit(12).then(({ data }) => setVendorHits(data ?? [])), 250);
    return () => clearTimeout(t);
  }, [vendorQ]);

  const priced = useMemo(() => (doc && settings ? priceManual(doc, settings) : null), [doc, settings]);
  if (!quote || !doc || !settings) return <p>Loading…</p>;

  const locked = rev?.locked;
  const upd = (patch: Partial<QuoteDoc>) => { setDoc({ ...doc, ...patch }); setDirty(true); };
  const updLine = (key: string, patch: Partial<QuoteLine>) => upd({ lines: doc.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) });
  const addLine = (l: QuoteLine) => upd({ lines: [...doc.lines, l] });
  const fam = doc.family;
  const shopHours = doc.lines.filter(l => l.kind === 'shop_labor').reduce((s, l) => s + (l.qty || 0), 0);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const d = fam === 'freestanding' ? { ...doc, freestandingShopHours: shopHours } : { ...doc, freestandingShopHours: 0 };
      const res = await api('save', { revision_id: rev.id, doc: d, doc_version: rev.doc_version, header });
      setRev(res.revision); setDoc(res.revision.doc); setDirty(false); setMsg({ t: 'ok', m: 'Saved' });
      const { data: ap } = await supabase.from('approvals').select('*').eq('revision_id', rev.id); setApprovals(ap ?? []);
    } catch (e: any) { setMsg({ t: 'err', m: e.message }); } finally { setBusy(false); }
  };
  const act = async (action: string, payload: any, ok: string) => {
    setBusy(true); setMsg(null);
    try { const r = await api(action, payload); setMsg({ t: 'ok', m: ok }); await load(r?.revision?.id); return r; }
    catch (e: any) { setMsg({ t: 'err', m: e.message + (e.body?.lint ? ': ' + e.body.lint.filter((l: any) => l.level === 'error').map((l: any) => l.message).join(' ') : '') }); }
    finally { setBusy(false); }
  };
  const approvedRules = approvals.filter(a => a.decision === 'approved').map(a => a.rule);
  const openFlags = (priced?.flags ?? []).filter(f => !approvedRules.includes(f.rule));
  const lintErrors = (priced?.lint ?? []).filter(l => l.level === 'error');
  const number = quote.job_id ?? quote.quote_number;

  // ---- quick-add helpers ----
  const addSteel = (shape: string, qty: number, lengthFt: number, use: string) => {
    const s = ref.shapes.find((x: any) => x.shape === shape); if (!s) return;
    const unitCost = Number(s.lb_per_ft) * lengthFt * (ref.groups[s.price_group] ?? 0);
    addLine(newLine('structural', fam, { description: `${use ? use + ' — ' : ''}${shape} × ${lengthFt}'`, qty, unitCost: Math.round(unitCost * 100) / 100, markupPct: (settings as any).structural_markup_pct ?? 26 }));
  };
  const addVendor = (p: any) => {
    const d = ref.discounts[p.vendor] ?? { pwi_discount_pct: 0, customer_discount_pct: 0 };
    const cost = Number(p.list) * (1 - d.pwi_discount_pct / 100); const sell = Number(p.list) * (1 - d.customer_discount_pct / 100);
    addLine(newLine('vendor', fam, { description: `${p.vendor} ${p.part} — ${p.description}`, qty: 1, unitCost: Math.round(cost * 100) / 100, markupPct: Math.round(((sell / cost) - 1) * 10000) / 100 }));
    setVendorQ('');
  };

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{number} · {quote.customers?.name} · {header.project_name}</h2>
        <div className="row">
          <select value={rev.id} onChange={e => load(e.target.value)}>{revs.map(r => <option key={r.id} value={r.id}>R{r.rev} {r.doc_type}{r.locked ? ' (sent)' : ''}</option>)}</select>
          <span className={`pill ${quote.status}`}>{quote.status.replace('_', ' ')}</span>
        </div>
      </div>
      {locked && <div className="banner ok">This revision was sent {new Date(rev.sent_at).toLocaleString()} and is locked. Start a new revision to make changes.</div>}

      <div className="editor">
        <div>
          <div className="card grid g4">
            <div><label>Project</label><input disabled={locked} value={header.project_name ?? ''} onChange={e => { setHeader({ ...header, project_name: e.target.value }); setDirty(true); }} /></div>
            <div><label>Job location</label><input disabled={locked} value={header.job_location ?? ''} onChange={e => { setHeader({ ...header, job_location: e.target.value }); setDirty(true); }} /></div>
            <div><label>Main product</label><select disabled={locked} value={fam} onChange={e => upd({ family: e.target.value })}>{FAMILIES.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></div>
            <div><label>Document</label><input disabled value={rev.doc_type} /></div>
          </div>

          <div className="card">
            <h3>Line items</h3>
            <table>
              <thead><tr><th>Category</th><th>Description</th><th className="num">Qty / hrs</th><th className="num">Unit cost</th><th className="num">Markup %</th><th className="num">Unit sell</th><th className="num">Sell</th><th></th></tr></thead>
              <tbody>
                {doc.lines.map(l => {
                  const pl = priced?.lines.find(x => x.key === l.key);
                  const hrs = isHours(l.kind);
                  return (
                    <tr key={l.key}>
                      <td style={{ width: 150 }}><select disabled={locked} value={l.category} onChange={e => updLine(l.key, { category: e.target.value as CategoryKey, kind: kindOf(e.target.value as CategoryKey) })}>{CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></td>
                      <td><input disabled={locked} value={l.description} onChange={e => updLine(l.key, { description: e.target.value })} />
                        {l.laborOp === 'site_difficulty' && <input disabled={locked} placeholder="Reason (required)" value={l.reason ?? ''} onChange={e => updLine(l.key, { reason: e.target.value })} style={{ marginTop: 4 }} />}</td>
                      <td style={{ width: 80 }}><input disabled={locked} className="num" type="number" value={l.qty} onChange={e => updLine(l.key, { qty: Number(e.target.value) })} /></td>
                      <td style={{ width: 100 }}>{!hrs && <input disabled={locked} className="num" type="number" value={l.unitCost ?? ''} onChange={e => updLine(l.key, { unitCost: e.target.value === '' ? undefined : Number(e.target.value) })} />}</td>
                      <td style={{ width: 80 }}>{!hrs && <input disabled={locked} className="num" type="number" value={l.markupPct ?? ''} onChange={e => updLine(l.key, { markupPct: e.target.value === '' ? undefined : Number(e.target.value) })} />}</td>
                      <td style={{ width: 100 }}>{!hrs && l.unitCost == null && <input disabled={locked} className="num" type="number" value={l.unitSell ?? ''} onChange={e => updLine(l.key, { unitSell: e.target.value === '' ? undefined : Number(e.target.value) })} />}{hrs && <span className="muted">rate</span>}</td>
                      <td className="num">{money(pl?.sell)}</td>
                      <td>{!locked && <button className="secondary" onClick={() => upd({ lines: doc.lines.filter(x => x.key !== l.key) })}>×</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!locked && <QuickAdd fam={fam} refData={ref} onAdd={addLine} onSteel={addSteel} vendorQ={vendorQ} setVendorQ={setVendorQ} vendorHits={vendorHits} onVendor={addVendor} />}
          </div>

          <div className="card grid g4">
            <div><label>Outbound freight $</label><input disabled={locked} type="number" value={doc.outboundFreight} onChange={e => upd({ outboundFreight: Number(e.target.value) })} /></div>
            <div><label>Pre-use inspection / load test $</label><input disabled={locked} type="number" value={doc.preUse} onChange={e => upd({ preUse: Number(e.target.value) })} />
              <label><input type="checkbox" disabled={locked} checked={doc.showPreUse} onChange={e => upd({ showPreUse: e.target.checked })} style={{ width: 'auto' }} /> show on quote</label></div>
            <div><label>Dealer / GC discount %</label><input disabled={locked} type="number" value={Math.round(doc.dealerDiscount * 1000) / 10} onChange={e => upd({ dealerDiscount: Number(e.target.value) / 100 })} /></div>
            <div><label>Sales tax</label><select disabled={locked} value={doc.taxOn ? 'y' : 'n'} onChange={e => upd({ taxOn: e.target.value === 'y' })}><option value="n">Exempt / not charged</option><option value="y">Charge {Math.round(settings.sales_tax_rate * 1000) / 10}%</option></select></div>
            {fam === 'freestanding' && <div><label>Production Value $/shop hr (default {settings.freestanding_pv_per_shop_hour})</label><input disabled={locked} type="number" placeholder={String(settings.freestanding_pv_per_shop_hour)} value={doc.pvPerHourOverride ?? ''} onChange={e => upd({ pvPerHourOverride: e.target.value === '' ? null : Number(e.target.value) })} /></div>}
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}><h3>Quote wording</h3>
              {!locked && <select value="" onChange={e => { const b = LIBRARY[Number(e.target.value)]; if (b) upd({ wording: (doc.wording ? doc.wording + '\n\n' : '') + b.text }); }} style={{ width: 300 }}>
                <option value="">Insert from wording library…</option>{LIBRARY.map((b, i) => <option key={i} value={i}>{b.title.slice(0, 60)}</option>)}</select>}</div>
            <textarea disabled={locked} rows={22} value={doc.wording} onChange={e => upd({ wording: e.target.value })} />
            <p className="muted">Fix every "xx", "(x)", "?" and "OR" before sending — the system blocks them.</p>
          </div>

          <div className="card">
            <h3>Options (shown below the total)</h3>
            {doc.options.map((o, i) => (
              <div className="row" key={i}><input disabled={locked} value={o.description} onChange={e => upd({ options: doc.options.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })} style={{ flex: 3 }} />
                <input disabled={locked} type="number" value={o.price} onChange={e => upd({ options: doc.options.map((x, j) => j === i ? { ...x, price: Number(e.target.value) } : x) })} style={{ flex: 1 }} />
                {!locked && <button className="secondary" onClick={() => upd({ options: doc.options.filter((_, j) => j !== i) })}>×</button>}</div>))}
            {!locked && doc.options.length < 3 && <button className="secondary" onClick={() => upd({ options: [...doc.options, { description: '', price: 0 }] })}>+ Option</button>}
          </div>
        </div>

        <div className="panel">
          <div className="card">
            <h3>Price</h3>
            {priced && <>
              <div className="price-row"><span>Base price</span><b>{money(priced.rollup.quote.base)}</b></div>
              <div className="price-row"><span>Installation</span><span>{money(priced.rollup.quote.installation)}</span></div>
              <div className="price-row"><span>Outbound freight</span><span>{money(priced.rollup.quote.freight)}</span></div>
              {priced.rollup.quote.preUse != null && <div className="price-row"><span>Pre-use inspections</span><span>{money(priced.rollup.quote.preUse)}</span></div>}
              <div className="price-row"><span>Sales tax</span><span>{money(priced.rollup.quote.tax)}</span></div>
              <div className="price-row total"><span>TOTAL</span><span>{money(priced.rollup.quote.total)}</span></div>
              <label style={{ marginTop: 8 }}><input type="checkbox" checked={hideInternal} onChange={e => setHideInternal(e.target.checked)} style={{ width: 'auto' }} /> hide internals (screen-sharing)</label>
              {!hideInternal && <div className="internal">
                <div className="price-row"><span>Gross margin</span><b>{(priced.totals.grossMarginPct * 100).toFixed(1)}%</b></div>
                <div className="price-row"><span>GM $</span><span>{money(priced.totals.grossMargin)}</span></div>
                <div className="price-row"><span>Shop hours</span><span>{priced.totals.shopHours}</span></div>
                <div className="price-row"><span>Install hours</span><span>{priced.totals.installHours}</span></div>
                {fam === 'freestanding' && <div className="price-row"><span>Production Value</span><span>{money(priced.totals.productionValue)}</span></div>}
              </div>}
            </>}
          </div>

          <div className="card">
            {openFlags.map(f => <div key={f.rule} className="banner flag">⚑ {FLAG_TEXT[f.rule]} — needs sales manager approval.
              {(me.role === 'manager' || me.role === 'admin') && !locked && !dirty && <div><button onClick={() => act('approve', { revision_id: rev.id, rule: f.rule }, 'Approved')}>Approve</button></div>}</div>)}
            {approvedRules.map(r => <div key={r} className="banner ok">✓ {FLAG_TEXT[r]} — approved</div>)}
            {lintErrors.map((l, i) => <div key={i} className="banner block">{l.message}</div>)}
            {(priced?.lint ?? []).filter(l => l.level === 'warning').map((l, i) => <div key={i} className="msg-warn muted">⚠ {l.message}</div>)}
            {msg && <p className={msg.t === 'err' ? 'msg-error' : ''}>{msg.m}</p>}
            <div className="grid">
              {!locked && <button onClick={save} disabled={busy || !dirty}>{dirty ? 'Save' : 'Saved'}</button>}
              {!locked && <button onClick={() => act('send', { revision_id: rev.id }, 'Sent — revision locked')} disabled={busy || dirty || openFlags.length > 0 || lintErrors.length > 0}>Mark as sent (locks R{rev.rev})</button>}
              <button className="secondary" onClick={() => downloadPdf({ quote, rev, doc, priced: priced!, me, number })} disabled={!priced}>Download PDF</button>
              {locked && <button className="secondary" onClick={() => act('revise', { quote_id: quote.id }, 'New revision started')}>Start new revision</button>}
              {locked && !quote.job_id && <button className="secondary" onClick={async () => {
                const job = prompt('Job ID (5 digits) for this won job:'); if (!job) return;
                if (await act('win', { quote_id: quote.id, job_id: job.trim() }, 'Marked won')) await act('revise', { quote_id: quote.id, doc_type: 'CONFIRMATION' }, 'Confirmation started');
              }}>Mark won → Confirmation</button>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function QuickAdd({ fam, refData, onAdd, onSteel, vendorQ, setVendorQ, vendorHits, onVendor }: any) {
  const [shape, setShape] = useState(''); const [sq, setSq] = useState(1); const [len, setLen] = useState(20); const [use, setUse] = useState('Runways');
  const [op, setOp] = useState(''); const [units, setUnits] = useState(1);
  const [part, setPart] = useState('');
  const o = refData.ops.find((x: any) => x.code === op);
  return (
    <div className="grid" style={{ marginTop: 12 }}>
      <div className="row">
        <b style={{ width: 90 }}>Add line</b>
        {CATEGORIES.map(c => c.key).filter(k => ['costBased', 'stairways', 'painting', 'travel', 'equipment', 'pmMarketing', 'cad', 'engineering', 'inboundFreight'].includes(k)).map(k =>
          <button key={k} className="secondary" onClick={() => onAdd(newLine(k as CategoryKey, fam, { description: CATEGORIES.find(c => c.key === k)!.label }))}>+ {CATEGORIES.find(c => c.key === k)!.label}</button>)}
      </div>
      <div className="row">
        <b style={{ width: 90 }}>Steel</b>
        <input list="shapes" placeholder="Shape e.g. W12 x 26" value={shape} onChange={e => setShape(e.target.value)} style={{ width: 170 }} />
        <datalist id="shapes">{refData.shapes.map((s: any) => <option key={s.shape} value={s.shape} />)}</datalist>
        <input type="number" value={sq} onChange={e => setSq(Number(e.target.value))} style={{ width: 60 }} title="Qty" />
        <input type="number" value={len} onChange={e => setLen(Number(e.target.value))} style={{ width: 70 }} title="Length ft" /> ft
        <input value={use} onChange={e => setUse(e.target.value)} style={{ width: 130 }} placeholder="Used for" />
        <button className="secondary" onClick={() => onSteel(shape, sq, len, use)} disabled={!refData.shapes.some((s: any) => s.shape === shape)}>+ Steel</button>
      </div>
      <div className="row">
        <b style={{ width: 90 }}>Labor</b>
        <select value={op} onChange={e => setOp(e.target.value)} style={{ width: 300 }}><option value="">Labor operation…</option>
          {refData.ops.map((x: any) => <option key={x.code} value={x.code}>{x.side === 'shop' ? 'Shop' : 'Site'}: {x.name}{x.hours_per_unit ? ` (${x.hours_per_unit} h/${x.unit})` : ''}</option>)}</select>
        <input type="number" value={units} onChange={e => setUnits(Number(e.target.value))} style={{ width: 70 }} title="Units (or hours)" /> <span className="muted">{o ? (o.hours_per_unit ? o.unit + 's' : 'hours') : ''}</span>
        <button className="secondary" disabled={!o} onClick={() => onAdd(newLine(o.side === 'shop' ? 'shopLabor' : 'onsiteLabor', fam, {
          description: o.hours_per_unit ? `${o.name} — ${units} ${o.unit}` : o.name, qty: o.hours_per_unit ? Math.round(units * o.hours_per_unit * 100) / 100 : units, laborOp: o.code }))}>+ Labor</button>
      </div>
      <div className="row">
        <b style={{ width: 90 }}>Std part</b>
        <select value={part} onChange={e => setPart(e.target.value)} style={{ width: 420 }}><option value="">Standard part…</option>
          {refData.parts.map((p: any) => <option key={p.id} value={p.id}>{p.section}: {p.description} — ${p.sell}</option>)}</select>
        <button className="secondary" disabled={!part} onClick={() => { const p = refData.parts.find((x: any) => x.id === part); onAdd(newLine('stdParts', fam, { description: p.description, qty: 1, unitSell: Number(p.sell) })); }}>+ Part</button>
      </div>
      <div className="row">
        <b style={{ width: 90 }}>Vendor</b>
        <input placeholder="Search Starke / Street / CM / InMotion part or description" value={vendorQ} onChange={e => setVendorQ(e.target.value)} style={{ width: 420 }} />
      </div>
      {vendorHits.map((p: any) => <div key={p.vendor + p.part} className="muted" style={{ cursor: 'pointer', marginLeft: 98 }} onClick={() => onVendor(p)}>+ {p.vendor} {p.part} — {p.description} (list ${p.list})</div>)}
    </div>
  );
}
