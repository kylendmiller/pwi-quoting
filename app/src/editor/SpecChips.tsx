// "Built from" spec chips (U6) and the one install control Men × Days (U7).
// Editing a chip never changes the quote directly: the parent rebuilds and shows the rebuild dialog first.
import { useState } from 'react';
import type { QuoteDoc } from '../../../src/engine/manual';
import { HOURS_PER_DAY, installCrew } from './engineApi';

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

export function SpecChips({ doc, locked, onSpec, onCrew, busy }: {
  doc: QuoteDoc; locked: boolean; busy: boolean;
  onSpec: (spec: any, label: string) => void;
  /** spec.crewMen / spec.installDays (days null = back to the builder's days). The parent shows the rebuild preview. */
  onCrew: (crew: { men?: number; days?: number | null }, label: string) => void;
}) {
  const spec: any = doc.spec;
  const [edit, setEdit] = useState<{ i: number; k: string; text: string } | null>(null);
  if (!spec?.items?.length) return null;
  const crew = installCrew(doc);
  const installed = spec.items.some((it: any) => it.install);
  const siteH = doc.lines.filter(l => l.kind === 'site_labor' && l.laborOp !== 'site_travel').reduce((a, l) => a + l.qty, 0);

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
      {installed && <InstallControl men={crew.men} days={crew.days} builtDays={crew.builtDays} set={crew.set} siteHours={siteH} suggested={doc.suggestedInstallHours ?? null} locked={locked || busy}
        onMen={m => onCrew({ men: m }, `Crew: ${crew.men ?? '?'} → ${m} men`)}
        onDays={d => onCrew({ days: d }, d == null ? `Days on site: ${crew.days} → builder's ${crew.builtDays ?? ''}` : `Days on site: ${crew.days ?? '?'} → ${d}`)} />}
    </div>
  );
}

/** U7: Men × Days × 10 h — one control. Both numbers are spec fields (crewMen, installDays): a change goes through the
 *  rebuild preview, then on-site hours, travel, lodging, per diem and equipment all follow. */
export function InstallControl({ men, days, builtDays, set, siteHours, suggested, locked, onMen, onDays }: {
  men: number | null; days: number | null; builtDays: number | null; set: boolean; siteHours: number; suggested: number | null; locked: boolean;
  onMen: (n: number) => void; onDays: (n: number | null) => void;
}) {
  const [m, setM] = useState<string | null>(null), [d, setD] = useState<string | null>(null);
  const num = (s: string | null, fb: number | null) => (s == null || s.trim() === '' ? fb : Number(s));
  const editing = m != null || d != null;
  const hrs = (num(m, men) ?? 0) * (num(d, days) ?? 0) * HOURS_PER_DAY;
  const commitM = () => { if (m != null && m.trim() !== '' && Number(m) !== men) onMen(Number(m)); setM(null); };
  const commitD = () => { if (d != null && d.trim() !== '' && Number(d) !== days) onDays(Number(d)); setD(null); };
  const below = set && builtDays != null && days != null && days < builtDays;
  return (
    <div className="qe-install" title={`Install crew: men × days × ${HOURS_PER_DAY} h on site. Changing either rebuilds on-site hours, travel, lodging, per diem and equipment (you see the rebuild first).`}>
      <span className="qe-spec-name">Install crew</span>
      <input aria-label="Crew men" disabled={locked} value={m ?? men ?? ''} size={2} onChange={e => setM(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commitM(); if (e.key === 'Escape') setM(null); }} onBlur={commitM} />
      <span>men ×</span>
      <input aria-label="Days on site" className={set ? 'set' : ''} disabled={locked} value={d ?? days ?? ''} size={2} onChange={e => setD(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commitD(); if (e.key === 'Escape') setD(null); }} onBlur={commitD} />
      <span>days × {HOURS_PER_DAY} h = <b>{editing || set ? Math.round(hrs) : Math.round(siteHours * 10) / 10} h</b> on site{days ? <small className="muted"> · {days < 3 ? `${days} day` : `${Math.ceil(days / 5)} wk`} rental</small> : null}</span>
      {set
        ? <small className={below ? 'bad' : 'muted'}>{builtDays != null ? <>builder: {builtDays} days{suggested != null ? ` (${Math.round(suggested * 10) / 10} h suggested incl. travel)` : ''}{below ? ' · fewer days needs approval' : ''}</> : 'days set by you'}
            {!locked && <> · <button className="link" onClick={() => onDays(null)}>use builder days</button></>}</small>
        : <small className="muted">builder's days{suggested != null ? ` · ${Math.round(suggested * 10) / 10} h suggested incl. travel` : ''}</small>}
    </div>
  );
}
