// "Built from" spec chips (U6) and the one install control Men × Days (U7).
// Editing a chip never changes the quote directly: the parent rebuilds and shows the rebuild dialog first.
import { useState } from 'react';
import type { QuoteDoc } from '../../../src/engine/manual';
import { HOURS_PER_DAY, S_READY } from './engineApi';
import { crewOf } from './KpiStrip';

type F = { k: string; label: (v: any) => string; type: 'num' | 'text' | 'bool' | 'sel'; opts?: string[]; title: string; always?: boolean; installOnly?: boolean };
const FIELDS: F[] = [
  { k: 'capacityTons', label: v => `${v} t`, type: 'num', title: 'Capacity (tons)' },
  { k: 'spanFt', label: v => `${v}' span`, type: 'num', title: 'Span (ft)' },
  { k: 'runwayOalFt', label: v => `${v}' runway`, type: 'num', title: 'Runway overall length (ft)' },
  { k: 'overallHeightFt', label: v => `${v}' overall`, type: 'num', title: 'Overall height (ft)' },
  { k: 'hookHeightFt', label: v => `${v}' hook`, type: 'num', title: 'Height under hook (ft)' },
  { k: 'heightUnderBeamFt', label: v => `${v}' under beam`, type: 'num', title: 'Height under beam (ft)' },
  { k: 'lengthFt', label: v => `${v}' long`, type: 'num', title: 'Length (ft)' },
  { k: 'widthFt', label: v => `${v}' wide`, type: 'num', title: 'Width (ft)' },
  { k: 'deckHeightFt', label: v => `${v}' deck`, type: 'num', title: 'Deck height (ft)' },
  { k: 'liveLoadPsf', label: v => `${v} psf`, type: 'num', title: 'Live load (psf)' },
  { k: 'systems', label: v => `${v} system${v > 1 ? 's' : ''}`, type: 'num', title: 'Number of systems' },
  { k: 'qty', label: v => `qty ${v}`, type: 'num', title: 'Quantity' },
  { k: 'bridgeDrive', label: v => String(v), type: 'sel', opts: ['motorized', 'manual'], title: 'Bridge drive' },
  { k: 'voltage', label: v => String(v), type: 'text', title: 'Voltage' },
  { k: 'colors', label: v => (v && Object.keys(v).length ? `colors: ${Object.entries(v).map(([a, b]) => `${a} ${b}`).join(', ')}` : 'std colors'), type: 'text', title: 'Paint colors, e.g. "columns: safety yellow" (blank = standard gray + Spark Orange)' },
  { k: 'install', label: v => (v ? 'installed' : 'ship only'), type: 'bool', title: 'PWI installs', always: true },
  { k: 'miles', label: v => `${v ?? 0} mi`, type: 'num', title: 'Miles to the job site', installOnly: true, always: true },
  { k: 'travelMode', label: v => v ?? 'travel: auto', type: 'sel', opts: ['', 'drive', 'fly', 'local'], title: 'Travel mode (blank = builder decides)', installOnly: true, always: true },
];
const parseColors = (s: string) => Object.fromEntries(s.split(',').map(x => x.split(':').map(y => y.trim())).filter(x => x.length === 2 && x[0] && x[1]));
const colorsText = (v: any) => (v ? Object.entries(v).map(([a, b]) => `${a}: ${b}`).join(', ') : '');

export function SpecChips({ doc, locked, onSpec, onCrewDays, busy }: {
  doc: QuoteDoc; locked: boolean; busy: boolean;
  onSpec: (spec: any, label: string) => void;
  onCrewDays: (men: number, days: number) => void;
}) {
  const spec: any = doc.spec;
  const [edit, setEdit] = useState<{ i: number; k: string; text: string } | null>(null);
  if (!spec?.items?.length) return null;
  const crew = crewOf(doc);
  const installed = spec.items.some((it: any) => it.install);
  const siteH = doc.lines.filter(l => l.kind === 'site_labor').reduce((a, l) => a + l.qty, 0);

  const apply = (i: number, f: F, raw: string | boolean) => {
    setEdit(null);
    let v: any = raw;
    if (f.type === 'num') { v = Number(raw); if (!isFinite(v) || raw === '') return; }
    if (f.k === 'colors') v = parseColors(String(raw));
    if (f.type === 'sel' && raw === '') v = undefined;
    const cur = spec.items[i][f.k];
    if (JSON.stringify(cur) === JSON.stringify(v)) return;
    const items = spec.items.map((it: any, j: number) => (j === i ? { ...it, [f.k]: v } : it));
    onSpec({ ...spec, items }, `${f.title}: ${f.label(cur)} → ${f.label(v)}`);
  };
  const setMen = (men: number) => {
    if (!(men >= 1 && men <= 12)) return;
    onSpec({ ...spec, items: spec.items.map((it: any) => (it.install ? { ...it, crewMen: men } : it)) }, `Crew: ${crew.men ?? '?'} → ${men} men`);
  };

  return (
    <div className="qe-spec">
      {spec.items.map((it: any, i: number) => (
        <div key={i} className="qe-spec-item">
          <span className="qe-spec-name">{spec.items.length > 1 ? `Item ${i + 1}` : 'Built from'}{it.tag ? ` (${it.tag})` : ''} · <b>{String(it.type).replace(/_/g, ' ')}</b></span>
          {FIELDS.filter(f => (f.always || it[f.k] !== undefined) && (!f.installOnly || it.install)).map(f => {
            const on = edit?.i === i && edit.k === f.k;
            if (on && f.type !== 'bool') return (
              <span key={f.k} className="qe-chip editing" title={f.title}>
                {f.type === 'sel'
                  ? <select autoFocus value={edit!.text} onChange={e => apply(i, f, e.target.value)} onBlur={() => setEdit(null)}>{f.opts!.map(o => <option key={o} value={o}>{o || 'auto'}</option>)}</select>
                  : <input autoFocus value={edit!.text} size={Math.max(4, edit!.text.length + 1)} onChange={e => setEdit({ ...edit!, text: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') apply(i, f, edit!.text); if (e.key === 'Escape') setEdit(null); }} onBlur={() => setEdit(null)} />}
              </span>);
            return <button key={f.k} className="qe-chip" title={`${f.title} — click to change (shows what the rebuild changes first)`} disabled={locked || busy}
              onClick={() => f.type === 'bool' ? apply(i, f, !it[f.k]) : setEdit({ i, k: f.k, text: f.k === 'colors' ? colorsText(it.colors) : String(it[f.k] ?? '') })}>{f.label(it[f.k])}</button>;
          })}
        </div>
      ))}
      {installed && <InstallControl men={crew.men} days={crew.days} siteHours={siteH} locked={locked || busy} onMen={setMen} onDays={d => onCrewDays(crew.men ?? 2, d)} />}
    </div>
  );
}

/** U7: Men × Days × 10 h — one control. */
export function InstallControl({ men, days, siteHours, locked, onMen, onDays }: { men: number | null; days: number | null; siteHours: number; locked: boolean; onMen: (n: number) => void; onDays: (n: number) => void }) {
  const [m, setM] = useState<string | null>(null), [d, setD] = useState<string | null>(null);
  const num = (s: string | null, fb: number | null) => (s == null ? fb : Number(s));
  const hrs = (num(m, men) ?? 0) * (num(d, days) ?? 0) * HOURS_PER_DAY;
  return (
    <div className="qe-install" title="Install crew. Changing men rebuilds travel, lodging and equipment; changing days sets on-site hours.">
      <span className="qe-spec-name">Install crew</span>
      <input disabled={locked} value={m ?? men ?? ''} size={2} onChange={e => setM(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { onMen(Number(m)); setM(null); } if (e.key === 'Escape') setM(null); }} onBlur={() => { if (m != null && Number(m) !== men) onMen(Number(m)); setM(null); }} />
      <span>men ×</span>
      <input disabled={locked} value={d ?? days ?? ''} size={2} onChange={e => setD(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { onDays(Number(d)); setD(null); } if (e.key === 'Escape') setD(null); }} onBlur={() => { if (d != null && Number(d) !== days) onDays(Number(d)); setD(null); }} />
      <span>days{m != null || d != null ? <> × {HOURS_PER_DAY} h = <b>{Math.round(hrs)} h</b> on site</> : <> · <b>{Math.round(siteHours * 10) / 10} h</b> on site</>}{days ? <small className="muted"> · {Math.ceil(days / 5)} wk</small> : null}</span>
      {!S_READY.crewDays && <small className="muted" title="Track S engine update pending: until then a days change adds an 'Install adjustment' hours line and travel/equipment stay as built.">days → hours only*</small>}
    </div>
  );
}
