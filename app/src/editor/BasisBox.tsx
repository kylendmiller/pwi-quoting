// Engineering Basis box at the top of Structural (U3): the geometry, and each member pick with the chart / calc
// it came from, the chart row, the unity check (PWI max 0.98) and a plain tag.
import type { QuoteDoc } from '../../../src/engine/manual';
import { changedPaths, isChanged, type EditorLine } from './engineApi';
import { compactShape, fmtNum } from './smt';

const MEMBER_ROLES = ['girder', 'runway', 'column', 'beam', 'header', 'crossmember', 'mast', 'boom', 'arm', 'brace', 'track', 'truss', 'tower'];
const ROLE_NAME: Record<string, string> = { girder: 'Girder', runway: 'Runway', column: 'Columns', beam: 'Beam', header: 'Headers', crossmember: 'Crossmembers', mast: 'Mast', boom: 'Boom', arm: 'Arm', brace: 'Bracing', track: 'Track', truss: 'Truss', tower: 'Tower' };

export type Tag = { text: string; cls: 'ok' | 'calc' | 'review' | 'chart' | 'rule' | 'override' | 'hand' };
export function tagFor(l: EditorLine): Tag {
  const b = l.basis;
  if (isChanged(l, 'detail.shape')) return { text: 'REP OVERRIDE', cls: 'override' };
  if (!l.auto) return { text: 'ADDED BY HAND', cls: 'hand' };
  if (!b) return { text: 'NO BASIS', cls: 'review' };
  if (b.flag || (b.unity != null && b.unity > 0.98)) return { text: 'REVIEW', cls: 'review' };
  if (b.source === 'chart' && /PWI/i.test(b.chart ?? '')) return { text: 'CONFIRMED – PWI CHART', cls: 'ok' };
  if (b.source === 'calc') return { text: 'CALCULATED', cls: 'calc' };
  if (b.source === 'chart') return { text: 'CHART', cls: 'chart' };
  return { text: (b.source ?? 'rule').toUpperCase(), cls: 'rule' };
}

function geometry(it: any): [string, string][] {
  if (!it) return [];
  const g: [string, string][] = [];
  const add = (k: string, v: unknown, u = '') => { if (v != null && v !== '') g.push([k, `${v}${u}`]); };
  add('Capacity', it.capacityTons, ' t'); add('Span', it.spanFt, "'"); add('Runway OAL', it.runwayOalFt, "'");
  add('Overall', it.overallHeightFt, "'"); add('Hook', it.hookHeightFt, "'"); add('Under beam', it.heightUnderBeamFt, "'");
  add('Length', it.lengthFt, "'"); add('Width', it.widthFt, "'"); add('Deck', it.deckHeightFt, "'"); add('Live load', it.liveLoadPsf, ' psf');
  add('Bay', it.buildingBayFt, "'"); add('Columns', it.columnsPerSystem);
  return g;
}

export function BasisBox({ doc, lines, onPick, active }: { doc: QuoteDoc; lines: EditorLine[]; onPick: (keys: string[]) => void; active: Set<string> }) {
  const items: any[] = (doc.spec as any)?.items ?? [];
  const members = lines.filter(l => (l.category === 'structural' || l.category === 'plate' || l.category === 'miscSteel') && MEMBER_ROLES.includes(l.role ?? '') && (l.detail?.type === 'steel' || l.detail?.type === 'box'));
  if (!members.length) return null;
  const byItem = new Map<string, EditorLine[]>();
  for (const l of members) { const k = String(l.item ?? 'hand'); byItem.set(k, [...(byItem.get(k) ?? []), l]); }
  return (
    <div className="qe-basis">
      {[...byItem.entries()].map(([k, ls]) => {
        const it = k === 'hand' ? null : items[Number(k)];
        const groups = new Map<string, EditorLine[]>();
        for (const l of ls) { const d: any = l.detail; const g = `${l.role}|${d.type === 'steel' ? d.shape : d.plf}`; groups.set(g, [...(groups.get(g) ?? []), l]); }
        const rows = [...groups.values()].sort((a, b) => MEMBER_ROLES.indexOf(a[0].role!) - MEMBER_ROLES.indexOf(b[0].role!));
        return (
          <div key={k} className="qe-basis-item">
            <div className="qe-basis-head">
              <b>Engineering basis</b> <span className="muted">{ls[0].group ?? 'Added by hand'}</span>
              <span className="qe-geo">{geometry(it).map(([a, b]) => <span key={a}><i>{a}</i> {b}</span>)}</span>
            </div>
            <table>
              <thead><tr><th>Member</th><th>Pick</th><th>Source</th><th>Chart row / check</th><th className="num">Unity</th><th>Why</th><th>Status</th></tr></thead>
              <tbody>{rows.map(g => {
                const l = g[0], d: any = l.detail, b = l.basis;
                const qty = g.reduce((a, x) => a + x.qty, 0);
                const lens = [...new Set(g.map(x => (x.detail as any).lengthFt))];
                const pick = d.type === 'steel' ? compactShape(d.shape) : `${d.plf} plf built-up`;
                const tag = tagFor(l);
                const was = changedPaths(l)['detail.shape'] as string | undefined;
                const keys = g.map(x => x.key);
                const on = keys.some(x => active.has(x));
                const unity = b?.unity;
                return (
                  <tr key={l.key} className={on ? 'hl' : ''} onClick={() => onPick(on ? [] : keys)} title="Click to highlight these lines below">
                    <td><b>{ROLE_NAME[l.role!] ?? l.role}</b></td>
                    <td className="nowrap">{was && <s className="muted">{compactShape(was)}</s>} <b>{pick}</b> ×{qty}{lens.length === 1 ? ` @ ${fmtNum(lens[0], 2)}'` : ''}</td>
                    <td className="nowrap">{l.auto ? b?.chart ?? (b?.source === 'calc' ? 'Calculation' : b?.source ?? '—') : 'Rep'}</td>
                    <td>{l.auto ? (b?.row ?? (b?.checks?.map(c => `${c.name} ${c.unity.toFixed(2)}`).join(' · ') || '—')) : '—'}</td>
                    <td className={`num ${unity != null && unity > 0.98 ? 'bad' : ''}`}>{unity != null && l.auto ? unity.toFixed(2) : <span className="muted">{b?.source === 'chart' && l.auto ? 'chart' : '—'}</span>}</td>
                    <td className="why">{l.auto ? (b?.flag ? <span className="bad">{b.flag}. </span> : null) : null}{l.auto ? b?.text : 'Changed or added by the rep — not checked by the builder'}</td>
                    <td><span className={`qe-tag ${tag.cls}`}>{tag.text}</span></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
