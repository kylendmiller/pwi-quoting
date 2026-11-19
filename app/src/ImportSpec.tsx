import { useState } from 'react';
import { supabase } from './supabase';
import { buildFreestanding, type Catalog, type FreestandingSpec } from '../../src/engine/freestanding';
import type { QuoteDoc } from '../../src/engine/manual';

// Spec format produced by the pwi-quote Claude skill:
// { "pwi_quote": 1, "project": "...", "location": "...", "items": [ { "type": "freestanding", ...FreestandingSpec } ] }
const PREFIXES = ['STK', 'SCT', 'STT', 'SCP', 'S802', 'SCA'];

async function loadCatalog(settings: any): Promise<Catalog> {
  const [parts, vp, disc, shapes, groups, rates] = await Promise.all([
    supabase.from('std_parts').select('description,sell').eq('active', true),
    supabase.from('vendor_parts').select('*').or(PREFIXES.map(p => `part.like.${p}*`).join(',')).limit(5000),
    supabase.from('vendor_discounts').select('*'),
    supabase.from('steel_shapes').select('*'),
    supabase.from('steel_price_groups').select('*'),
    supabase.from('rate_items').select('kind,item,price').eq('active', true)]);
  const V = vp.data ?? [];
  const G = Object.fromEntries((groups.data ?? []).map((g: any) => [g.code, Number(g.price_per_lb)]));
  const D = Object.fromEntries((disc.data ?? []).map((d: any) => [d.vendor, d]));
  const R = rates.data ?? [];
  return {
    stdSell: d => { const p = (parts.data ?? []).find((x: any) => x.description === d); return p ? Number(p.sell) : null; },
    vendor: part => { const p = V.find((x: any) => x.part === part); return p ? { list: Number(p.list), description: p.description, vendor: p.vendor } : null; },
    vendorParts: prefix => V.filter((x: any) => x.part.startsWith(prefix)).map((x: any) => ({ part: x.part, list: Number(x.list), description: x.description })),
    discount: v => ({ pwi: Number(D[v]?.pwi_discount_pct ?? 0), customer: Number(D[v]?.customer_discount_pct ?? 0) }),
    shape: n => { const s = (shapes.data ?? []).find((x: any) => x.shape === n); return s ? { lbPerFt: Number(s.lb_per_ft), pricePerLb: G[s.price_group] ?? 0 } : null; },
    plate: { pricePerLb: Number(settings.plate_price_per_lb ?? 1.35), markupPct: Number(settings.plate_markup_pct ?? 21), dropFactor: Number(settings.plate_drop_factor ?? 1.1) },
    structuralMarkupPct: Number(settings.structural_markup_pct ?? 26),
    paintRunSell: Number(R.find((r: any) => /Standard Paint Full Booth/i.test(r.item))?.price ?? 1983.75),
    decalSell: n => { const r = R.find((x: any) => x.item === n); return r ? Number(r.price) : null; },
  };
}

export function parseSpec(text: string): any {
  const m = text.match(/\{[\s\S]*\}/);           // tolerate ```json fences and chat text around it
  if (!m) throw new Error('No quote spec found — paste the whole block Claude gave you.');
  const j = JSON.parse(m[0]);
  if (!Array.isArray(j.items) || !j.items.length) throw new Error('Spec has no items.');
  return j;
}

export function ImportSpec({ doc, settings, onApply }: { doc: QuoteDoc; settings: any; onApply: (d: QuoteDoc, header: any, notes: string[]) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true); setErr('');
    try {
      const spec = parseSpec(text);
      const cat = await loadCatalog(settings);
      const pf = settings.production_factor ?? {}, inf = settings.install_factor ?? {};
      let lines = [...doc.lines], wording: string[] = doc.wording?.trim() ? [doc.wording.trim()] : [];
      let install = doc.suggestedInstallHours ?? 0, freight = doc.outboundFreight, preUse = doc.preUse, showPreUse = doc.showPreUse;
      const notes: string[] = [];
      for (const [i, it] of spec.items.entries()) {
        if (it.type !== 'freestanding') { notes.push(`Item ${i + 1} (${it.type}): auto-build not ready yet — add lines by hand.`); if (it.wording) wording.push(it.wording); continue; }
        const r = buildFreestanding(it as FreestandingSpec, cat, { production: pf.freestanding ?? 0.56, install: inf.freestanding ?? 1.02 });
        lines = lines.concat(r.lines); wording.push(r.wording); notes.push(...r.notes.map(n => `Item ${i + 1}: ${n}`));
        install += r.suggestedInstallHours; freight += r.doc.outboundFreight ?? 0; preUse += r.doc.preUse ?? 0; showPreUse ||= !!r.doc.showPreUse;
      }
      onApply({ ...doc, family: spec.items[0].type === 'freestanding' ? 'freestanding' : doc.family, lines, wording: wording.join('\n\n'),
        suggestedInstallHours: install || null, outboundFreight: Math.round(freight), preUse, showPreUse },
        { project_name: spec.project, job_location: spec.location }, notes);
      setText('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <h3>Paste from Claude</h3>
      <p className="muted">Describe the job to Claude with the PWI Quote skill, then paste its quote block here. Every line and the wording fill in.</p>
      <textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder='{"pwi_quote":1, "items":[...]}' style={{ width: '100%' }} />
      {err && <div className="banner err">{err}</div>}
      <button className="primary" disabled={busy || !text.trim()} onClick={run}>{busy ? 'Building…' : 'Build quote'}</button>
    </div>
  );
}
