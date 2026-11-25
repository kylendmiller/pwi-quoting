import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, api, money } from './supabase';
import { validateDoc, type QuoteDoc, type QuoteLine, type Settings } from '../../src/engine/manual';
import type { CategoryKey } from '../../src/engine/rollup';
import { CATEGORIES, FAMILIES, isHours, newLine, kindOf, describe } from './model';
import { downloadPdf } from './QuotePdf';
import type { Profile } from './main';
import library from './wording-library.txt?raw';
import { ImportSpec } from './ImportSpec';
import { loadCatalog } from './catalog';
import { NumbersView } from './editor/NumbersView';
import { PriceRail } from './editor/PriceRail';
import { useDocHistory, useEditorKeys, saveDraft, readDraft, clearDraft, type Draft } from './editor/useDocHistory';
import { diffDocs } from './editor/changes';
import { price, effectiveDoc } from './editor/engineApi';
import { FLAG_TEXT as flagText, FLAG_LABEL } from './editor/flags';
import './editor/editor.css';

const LIBRARY = library.split(/^=== /m).filter(Boolean).map(b => {
  const [head, ...rest] = b.split('\n'); return { title: rest.find(l => l.trim()) ?? head, text: rest.join('\n').trim() };
});
const FLAG_TEXT = (rule: string) => FLAG_LABEL(rule);   // classic-view banners
const CLASSIC_KEY = 'pwi.editor.classic';

/** Plain message for a quote-api error: 400 { error, problems } lists the problems; 409 says what to do. */
export function apiError(e: any, action: string): string {
  const b = e?.body ?? {}, status = e?.status;
  const list = (xs: unknown) => (Array.isArray(xs) && xs.length ? `: ${xs.slice(0, 5).join(' · ')}${xs.length > 5 ? ` · …${xs.length - 5} more` : ''}` : '');
  if (status === 400 && Array.isArray(b.problems)) return `${e.message}${list(b.problems)}`;
  if (status === 409) {
    if (action === 'save') return `${e.message} Your edits are kept in this browser: reload the page and choose "Restore".`;
    if (action === 'approve') return `${e.message} Nothing was approved.`;
    if (action === 'price') return `${e.message} Reload to price the current revision.`;
    return `${e.message} Reload the page.`;
  }
  if (status === 422 && Array.isArray(b.lint)) return `${e.message}${list(b.lint.filter((l: any) => l.level === 'error').map((l: any) => l.message))}`;
  return e?.message ?? String(e);
}

export function Editor({ quoteId, me, mode = 'edit' }: { quoteId: string; me: Profile; mode?: 'review' | 'edit' }) {
  const [quote, setQuote] = useState<any>(null);
  const [revs, setRevs] = useState<any[]>([]);
  const [rev, setRev] = useState<any>(null);
  const H = useDocHistory();
  const doc = H.doc;
  const [saved, setSaved] = useState<QuoteDoc | null>(null);           // the doc as last loaded / saved (for deltas and "unsaved changes")
  const [header, setHeader] = useState<any>({});
  const [headerDirty, setHeaderDirty] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ref, setRef] = useState<any>({ ops: [], parts: [], shapes: [], groups: {}, discounts: {} });
  const [approvals, setApprovals] = useState<any[]>([]);
  const [hideInternal, setHideInternal] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; m: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [vendorQ, setVendorQ] = useState('');
  const [vendorHits, setVendorHits] = useState<any[]>([]);
  const [buildNotes, setBuildNotes] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [classic, setClassicS] = useState(() => { try { return localStorage.getItem(CLASSIC_KEY) === '1'; } catch { return false; } });
  const setClassic = (b: boolean) => { setClassicS(b); try { localStorage.setItem(CLASSIC_KEY, b ? '1' : '0'); } catch { /* ignore */ } };
  const dirty = (!!doc && !!saved && doc !== saved) || headerDirty;

  const load = async (revId?: string) => {
    const { data: q } = await supabase.from('quotes').select('*, customers(*), contacts(*)').eq('id', quoteId).single();
    const { data: rs } = await supabase.from('quote_revisions').select('*').eq('quote_id', quoteId).order('rev');
    setQuote(q); setRevs(rs ?? []);
    const cur = (rs ?? []).find(r => r.id === revId) ?? (rs ?? []).at(-1);
    const d: QuoteDoc = cur?.doc?.lines ? cur.doc : { ...(cur?.doc ?? {}), lines: [], wording: '', options: [] };
    setRev(cur); H.reset(d); setSaved(d); setHeaderDirty(false);
    setHeader({ project_name: q?.project_name, job_location: q?.job_location });
    const dr = cur && !cur.locked ? readDraft(cur.id) : null;
    setDraft(dr && dr.docVersion === cur.doc_version && JSON.stringify(dr.doc) !== JSON.stringify(d) ? dr : null);
    const { data: ap } = await supabase.from('approvals').select('*').eq('revision_id', cur?.id);
    setApprovals(ap ?? []);
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
    const t = setTimeout(() => vendorSearch(vendorQ).then(setVendorHits), 250);
    return () => clearTimeout(t);
  }, [vendorQ]);
  // Local draft: every unsaved change is kept in this browser until it is saved or discarded (U8).
  useEffect(() => { if (rev?.id && doc && dirty && !rev.locked) saveDraft(rev.id, { docVersion: rev.doc_version, at: new Date().toISOString(), doc, header }); }, [doc, header, dirty]);

  const priced = useMemo(() => (doc && settings ? price(doc, settings) : null), [doc, settings]);
  const savedPriced = useMemo(() => (saved && settings ? price(saved, settings) : null), [saved, settings]);
  const locked = rev?.locked;
  const save = useCallback(async () => {
    if (!doc || !rev || !settings || rev.locked || !dirty || busy) return;
    const voidList = voidsOf();
    if (voidList.length && !confirm(`Saving changes numbers a manager approved:\n\n${voidList.join('\n')}\n\nThe approval will be voided. Save anyway?`)) return;
    // Same input checks the server runs (validateDoc) — say what's wrong before the round trip.
    const problems = validateDoc(doc);
    if (problems.length) { setMsg({ t: 'err', m: `Can't save yet: ${problems.slice(0, 5).join(' · ')}${problems.length > 5 ? ` · …${problems.length - 5} more` : ''}` }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await api('save', { revision_id: rev.id, doc: effectiveDoc(doc), doc_version: rev.doc_version, header });
      // The server stamps detail / basis / source / edited on auto lines and derives family + PV hours: use ITS doc.
      setRev(res.revision); H.reset(res.revision.doc); setSaved(res.revision.doc); setHeaderDirty(false); clearDraft(rev.id); setDraft(null); setMsg({ t: 'ok', m: 'Saved' });
      const { data: ap } = await supabase.from('approvals').select('*').eq('revision_id', rev.id); setApprovals(ap ?? []);
    } catch (e: any) { setMsg({ t: 'err', m: apiError(e, 'save') }); } finally { setBusy(false); }
  }, [doc, rev, dirty, busy, header, settings, approvals]);
  useEditorKeys({ undo: H.undo, redo: H.redo, save: mode === 'edit' && !locked ? save : undefined });

  if (!quote || !doc || !settings) return <p>Loading…</p>;

  const upd = (patch: Partial<QuoteDoc>, label = 'edit', tag?: string) => H.set({ ...doc, ...patch }, label, tag);
  const updLine = (key: string, patch: Partial<QuoteLine>) => upd({ lines: doc.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) }, 'edit line', `line:${key}:${Object.keys(patch).join()}`);
  const addLine = (l: QuoteLine) => upd({ lines: [...doc.lines, l] }, 'add line');
  const setHead = (h: any) => { setHeader(h); setHeaderDirty(true); };
  const fam = doc.family;

  const act = async (action: string, payload: any, ok: string) => {
    setBusy(true); setMsg(null);
    try { const r = await api(action, payload); setMsg({ t: 'ok', m: ok }); await load(r?.revision?.id); return r; }
    catch (e: any) { setMsg({ t: 'err', m: apiError(e, action) }); }
    finally { setBusy(false); }
  };
  const approvedRules = approvals.filter(a => a.decision === 'approved').map(a => a.rule);
  const openFlags = (priced?.flags ?? []).filter(f => !approvedRules.includes(f.rule));
  const lintErrors = (priced?.lint ?? []).filter(l => l.level === 'error');
  const number = quote.job_id ?? quote.quote_number;
  const isMgr = me.role === 'manager' || me.role === 'admin';
  // An approved flag whose numbers changed since the last save → saving voids that approval (U9).
  function voidsOf(): string[] {
    if (!priced || !savedPriced) return [];
    return approvedRules.filter(r => {
      const now = priced.flags.find(f => f.rule === r), was = savedPriced.flags.find(f => f.rule === r);
      return now && was && JSON.stringify(now.detail) !== JSON.stringify(was.detail);
    }).map(r => FLAG_TEXT(r));
  }
  const send = async () => {
    const ok = await act('send', { revision_id: rev.id }, `Sent — R${rev.rev} locked`);
    // S9: the send response carries the server-priced result; the PDF renders from it (falls back to the screen's).
    if (ok) downloadPdf({ quote, rev: { ...rev, locked: true, sent_at: new Date().toISOString() }, doc: (ok as any)?.revision?.doc ?? doc, priced: (ok as any)?.priced ?? (ok as any)?.revision?.priced ?? priced!, me, number });
  };
  const revise = () => act('revise', { quote_id: quote.id, from_revision_id: rev.id }, 'New revision started');
  const win = async () => {
    const job = prompt('Job ID (5 digits) for this won job:'); if (!job) return;
    if (await act('win', { quote_id: quote.id, job_id: job.trim() }, 'Marked won')) await act('revise', { quote_id: quote.id, doc_type: 'CONFIRMATION' }, 'Confirmation started');
  };
  const askManager = async (f: { rule: string; detail?: any }) => {
    const note = `${number} R${rev.rev}: ${flagText(f)}. Please review and approve in the quote app: ${location.origin}${location.pathname}#/q/${quoteId}/edit`;
    try { await api('request_approval', { revision_id: rev.id, rule: f.rule, note }); setMsg({ t: 'ok', m: 'Approval requested from your sales manager.' }); }
    catch {
      try { await navigator.clipboard.writeText(note); setMsg({ t: 'ok', m: 'Request copied — paste it to your sales manager (Teams or email). Save first so they approve the saved numbers.' }); }
      catch { prompt('Send this to your sales manager:', note); }
    }
  };
  const vendorSearch = async (q: string) => (await supabase.from('vendor_parts').select('*').or(`part.ilike.%${q}%,description.ilike.%${q}%`).limit(12)).data ?? [];

  // ---- quick-add helpers (classic view) ----
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
  // A pasted Claude spec goes through the same rebuild dialog as a spec chip (nothing applies unseen).
  const importBox = (onSpec: (spec: any, label: string) => void) => <ImportSpec doc={doc} settings={settings} onApply={(d, h) => {
    setHead({ ...header, project_name: header.project_name || h.project_name, job_location: header.job_location || h.job_location });
    onSpec(d.spec, 'pasted spec from Claude');
  }} />;
  const rail = priced && <PriceRail priced={priced} doc={doc} settings={settings} locked={!!locked} dirty={dirty} busy={busy} hideCost={hideInternal} setHideCost={setHideInternal}
    openFlags={openFlags} approvedRules={approvedRules} isManager={isMgr} lint={priced.lint} msg={msg} changes={diffDocs(saved, doc)} voids={voidsOf()}
    undo={{ can: H.canUndo, label: H.undoLabel, run: H.undo }} redo={{ can: H.canRedo, label: H.redoLabel, run: H.redo }}
    onSave={save} onSend={send} onPdf={() => downloadPdf({ quote, rev, doc, priced: priced!, me, number })} onApprove={rule => act('approve', { revision_id: rev.id, rule, doc_version: rev.doc_version }, 'Approved')}
    onRevise={revise} onWin={!quote.job_id ? win : undefined} rev={rev.rev} onTarget={(d, l) => H.set(d, l)} />;
  const newView = mode === 'edit' && !classic;

  return (
    <div className={newView ? 'qe-page' : ''}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{number} · {quote.customers?.name} · {header.project_name}</h2>
        <div className="row">
          {mode === 'edit' && <label className="inline muted" title="The old one-table editor, kept for safety"><input type="checkbox" checked={classic} onChange={e => setClassic(e.target.checked)} /> classic view</label>}
          <select value={rev.id} onChange={e => { if (!dirty || confirm('You have unsaved changes on this revision. Switch anyway? (They stay saved in this browser as a draft.)')) load(e.target.value); }}>{revs.map(r => <option key={r.id} value={r.id}>R{r.rev} {r.doc_type}{r.locked ? ' (sent)' : ''}</option>)}</select>
          <span className={`pill ${quote.status}`}>{quote.status.replace('_', ' ')}</span>
        </div>
      </div>
      {locked && <div className="banner ok qe-locked">R{rev.rev} was sent {new Date(rev.sent_at).toLocaleString()} and is locked. <button className="sm" disabled={busy} onClick={revise}>Start revision R{Math.max(...revs.map(r => r.rev)) + 1}</button></div>}
      {draft && <div className="banner flag">You have unsaved edits from {new Date(draft.at).toLocaleString()} in this browser.
        <button className="sm" onClick={() => { H.set(draft.doc, 'Restore draft'); if (draft.header) setHead(draft.header); setDraft(null); }}>Restore</button>
        <button className="secondary sm" onClick={() => { clearDraft(rev.id); setDraft(null); }}>Discard</button></div>}

      <div className={`editor ${newView ? 'qe-editor' : ''}`}>
        <div className="qe-main">
          {mode === 'review' ? <><Review quote={quote} doc={doc} header={header} priced={priced} quoteId={quoteId} locked={locked} />{!locked && <ImportSpec doc={doc} settings={settings} onApply={(d, h, notes) => {
            H.set(d, 'Build from spec'); setBuildNotes(notes);
            setHead({ ...header, project_name: header.project_name || h.project_name, job_location: header.job_location || h.job_location });
            setMsg({ t: 'ok', m: `Built ${d.lines.length} lines — review, then Save.` });
          }} />}</> : <>
          <div className={`card grid g4 ${newView ? 'qe-head' : ''}`}>
            <div><label>Project</label><input disabled={locked} value={header.project_name ?? ''} onChange={e => setHead({ ...header, project_name: e.target.value })} /></div>
            <div><label>Job location</label><input disabled={locked} value={header.job_location ?? ''} onChange={e => setHead({ ...header, job_location: e.target.value })} /></div>
            <div><label>Main product</label><select disabled={locked} value={fam} onChange={e => upd({ family: e.target.value }, 'Main product')}>{FAMILIES.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></div>
            <div><label>Document</label><input disabled value={rev.doc_type} /></div>
          </div>

          {newView && priced && <NumbersView doc={doc} priced={priced} saved={saved && savedPriced ? { doc: saved, priced: savedPriced } : null}
            setDoc={(d, l, t) => H.set(d, l, t)} settings={settings} locked={!!locked} hideCost={hideInternal} refData={ref}
            getCatalog={() => loadCatalog(settings)} openFlags={openFlags} approvedRules={approvedRules} isManager={isMgr}
            askManager={askManager} vendorSearch={vendorSearch} importBox={importBox} />}

          {(doc as any).rfq && <div className="card from-claude">
            <h3>Built from website {(doc as any).rfq.number}</h3>
            {(doc as any).rfq.note && <p><b>Customer wrote:</b> {(doc as any).rfq.note}</p>}
            {(doc as any).rfq.assumed?.length > 0 && <><b>Assumed — check these:</b><ul>{(doc as any).rfq.assumed.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></>}
          </div>}
          {!newView && <>
          {!locked && <ImportSpec doc={doc} settings={settings} onApply={(d, h, notes) => {
            H.set(d, 'Build from spec'); setBuildNotes(notes);
            setHead({ ...header, project_name: header.project_name || h.project_name, job_location: header.job_location || h.job_location });
            setMsg({ t: 'ok', m: `Built ${d.lines.length} lines — review, then Save.` });
          }} />}
          {buildNotes.length > 0 && <div className="card"><h3>Check these</h3><ul>{buildNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            <button onClick={() => setBuildNotes([])}>Done</button></div>}

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
                      <td>{!locked && <button className="secondary" onClick={() => upd({ lines: doc.lines.filter(x => x.key !== l.key) }, 'remove line')}>×</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!locked && <QuickAdd fam={fam} refData={ref} onAdd={addLine} onSteel={addSteel} vendorQ={vendorQ} setVendorQ={setVendorQ} vendorHits={vendorHits} onVendor={addVendor} />}
          </div>

          <div className="card grid g4">
            <div><label>Outbound freight $</label><input disabled={locked} type="number" value={doc.outboundFreight} onChange={e => upd({ outboundFreight: Number(e.target.value) }, 'freight', 'freight')} /></div>
            <div><label>Pre-use inspection / load test $</label><input disabled={locked} type="number" value={doc.preUse} onChange={e => upd({ preUse: Number(e.target.value) }, 'pre-use', 'preuse')} />
              <label><input type="checkbox" disabled={locked} checked={doc.showPreUse} onChange={e => upd({ showPreUse: e.target.checked })} style={{ width: 'auto' }} /> show on quote</label></div>
            <div><label>Dealer / GC discount %</label><input disabled={locked} type="number" value={Math.round(doc.dealerDiscount * 1000) / 10} onChange={e => upd({ dealerDiscount: Number(e.target.value) / 100 }, 'discount', 'disc')} /></div>
            <div><label>Sales tax</label><select disabled={locked} value={doc.taxOn ? 'y' : 'n'} onChange={e => upd({ taxOn: e.target.value === 'y' })}><option value="n">Exempt / not charged</option><option value="y">Charge {Math.round(settings.sales_tax_rate * 1000) / 10}%</option></select></div>
            {fam === 'freestanding' && <div><label>Production Value $/shop hr (default {settings.freestanding_pv_per_shop_hour})</label><input disabled={locked} type="number" placeholder={String(settings.freestanding_pv_per_shop_hour)} value={doc.pvPerHourOverride ?? ''} onChange={e => upd({ pvPerHourOverride: e.target.value === '' ? null : Number(e.target.value) }, 'PV', 'pv')} /></div>}
          </div>
          </>}

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}><h3>Quote wording</h3>
              {!locked && <select value="" onChange={e => { const b = LIBRARY[Number(e.target.value)]; if (b) upd({ wording: (doc.wording ? doc.wording + '\n\n' : '') + b.text }, 'Insert wording'); }} style={{ width: 300 }}>
                <option value="">Insert from wording library…</option>{LIBRARY.map((b, i) => <option key={i} value={i}>{b.title.slice(0, 60)}</option>)}</select>}</div>
            <textarea disabled={locked} rows={22} value={doc.wording} onChange={e => upd({ wording: e.target.value }, 'Wording', 'wording')} />
            <p className="muted">Layout codes: <b>#</b> title · <b>##</b> heading · <b>-</b> bullet · <b>--</b> sub-bullet · <b>&gt;</b> paragraph · "Label:<i>Tab</i>Value" for spec rows · [image:fstr]. Use "Preview PDF" to check. Fix every "xx", "(x)", "?" and "OR" before sending — the system blocks them.</p>
          </div>

          <div className="card">
            <h3>Options (shown below the total)</h3>
            {doc.options.map((o, i) => (
              <div className="row" key={i}><input disabled={locked} value={o.description} onChange={e => upd({ options: doc.options.map((x, j) => j === i ? { ...x, description: e.target.value } : x) }, 'Option', `opt${i}d`)} style={{ flex: 3 }} />
                <input disabled={locked} type="number" value={o.price} onChange={e => upd({ options: doc.options.map((x, j) => j === i ? { ...x, price: Number(e.target.value) } : x) }, 'Option price', `opt${i}p`)} style={{ flex: 1 }} />
                {!locked && <button className="secondary" onClick={() => upd({ options: doc.options.filter((_, j) => j !== i) }, 'Remove option')}>×</button>}</div>))}
            {!locked && doc.options.length < 3 && <button className="secondary" onClick={() => upd({ options: [...doc.options, { description: '', price: 0 }] }, 'Add option')}>+ Option</button>}
          </div>
          </>}
        </div>

        {rail}
      </div>
    </div>
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

// Plain-English review of a built quote: what it is, what was assumed, what to check.
function Review({ quote, doc, header, priced, quoteId, locked }: any) {
  const items: any[] = (doc.spec as any)?.items ?? [];
  const blockers: string[] = doc.blockers ?? [];
  const notes: string[] = (doc.buildNotes ?? []).filter((n: string) => !blockers.includes(n));
  const lines = doc.lines.length;
  return <>
    <div className="card">
      <h3>Summary</h3>
      <p style={{ fontSize: 16, margin: '4px 0 8px' }}>
        {quote.customers?.name} · {header.project_name}{header.job_location ? ` · ${header.job_location}` : ''}
      </p>
      {items.length > 0 ? <ul className="summary">{items.map((it, i) => <li key={i}>{describe(it)}</li>)}</ul>
        : <p className="muted">Built by hand — {lines} line{lines === 1 ? '' : 's'}.</p>}
      <div className="row">
        <a className="btn secondary" href={`#/q/${quoteId}/edit`}>{locked ? 'View lines & wording' : 'Edit lines & wording'}</a>
        <span className="muted">{lines} line items · {priced?.totals.shopHours ?? 0} shop hrs · {priced?.totals.installHours ?? 0} install hrs</span>
      </div>
    </div>
    {(blockers.length > 0 || notes.length > 0) && <div className="card">
      <h3>Check these</h3>
      {blockers.map((b, i) => <div key={'b' + i} className="banner block">{b}</div>)}
      {notes.map((n, i) => <div key={'n' + i} className="msg-warn">⚠ {n}</div>)}
    </div>}
    {(doc.assumptions ?? []).length > 0 && <div className="card">
      <h3>What Claude and the builder assumed</h3>
      <p className="muted">To change one, tell Claude ("make it hook height", "3-man crew") and open the new link — or edit the lines.</p>
      <table className="assume"><tbody>{doc.assumptions.map((a: any, i: number) => <tr key={i}><td><b>{label(a.field)}</b></td><td>{a.why}</td></tr>)}</tbody></table>
    </div>}
    <div className="card"><h3>Customer wording</h3><pre className="wording">{doc.wording || '—'}</pre></div>
  </>;
}
const LABELS: Record<string, string> = { heightBasis: 'Height', columnsPerSystem: 'Columns', doubleGirder: 'Girder', asceRail: 'Rail', steelSource: 'Steel sizes', foundation: 'Foundation',
  liftFt: 'Lift', hoistFamily: 'Hoist', colors: 'Paint', crewMen: 'Crew', travelMode: 'Travel', crewDays: 'Days on site', equipment: 'Equipment', freight: 'Freight',
  members: 'Members', layout: 'Layout', vrcPrice: 'VRC price', girder: 'Girder', legs: 'Legs', beam: 'Beam', grid: 'Column grid', deck: 'Deck', columns: 'Columns', series: 'Series', support: 'Support' };
const label = (f: string) => LABELS[f] ?? f;
