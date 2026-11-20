// Round 3 S3: the server stamps line evidence from its own rebuild; client-sent detail/basis on auto lines is ignored.
import { describe, it, expect } from 'vitest';
import { buildFromSpec } from '../src/engine/buildSpec';
import type { QuoteDoc } from '../src/engine/manual';
import { stampFromBuild } from '../src/engine/stamp';
import { deriveLine, editLine } from '../src/engine/deriveLine';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';
import SC from '../src/engine/rules/steel_cost.default.json';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const FSTR = { type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 };
const build = () => buildFromSpec({ pwi_quote: 1, items: [FSTR] }, testCatalog, CAL_SETTINGS, base).doc as QuoteDoc;
/** What the server does: rebuild the saved spec with no lines, stamp. */
const server = (d: QuoteDoc) => stampFromBuild(d, buildFromSpec(d.spec as any, testCatalog, CAL_SETTINGS, { ...d, lines: [] }).doc, { shape: testCatalog.shape, steelCost: SC as any });

describe('S3 server-stamped evidence', () => {
  it('an unedited build stamps to itself (no edits, all auto)', () => {
    const d = build(), s = server(d);
    expect(s.lines).toEqual(d.lines.map(l => ({ ...l, source: 'auto' })));
  });
  it('forged basis / detail / builder values on auto lines are overwritten', () => {
    const d = build();
    const g = d.lines.findIndex(l => l.role === 'girder');
    d.lines[g] = { ...d.lines[g], basis: { source: 'chart', chart: 'PWI bridge chart', text: 'CONFIRMED' }, detail: { type: 'sell', sellEach: 1 }, edited: { qty: 99 } };
    const s = server(d), b = build();
    expect(s.lines[g].basis).toEqual(b.lines[g].basis);
    expect(s.lines[g].detail).toEqual(b.lines[g].detail);
    expect(s.lines[g].edited).toBeUndefined();                     // qty is the builder's: the claim is dropped
  });
  it('hand lines and auto lines the server did not build are marked hand and lose basis', () => {
    const d = build();
    d.lines.push({ key: 'h1', kind: 'material', category: 'structural', description: 'Fake girder', qty: 1, unitCost: 1, markupPct: 26, auto: true, ref: 'nope:girder/x', basis: { source: 'chart', text: 'PWI chart' } });
    d.lines.push({ key: 'h2', kind: 'material', category: 'costBased', description: 'Hand', qty: 1, unitCost: 5, markupPct: 20, detail: { type: 'cost', costEach: 5, markupPct: 20 } });
    const s = server(d);
    const h1 = s.lines.find(l => l.key === 'h1')!, h2 = s.lines.find(l => l.key === 'h2')!;
    expect(h1.source).toBe('hand'); expect(h1.basis).toBeUndefined();
    expect(h2.source).toBe('hand'); expect(h2.detail).toEqual({ type: 'cost', costEach: 5, markupPct: 20 });
  });
  it('edited fields carry the SERVER builder value, and unclaimed qty/description edits are marked', () => {
    const d = build();
    const i = d.lines.findIndex(l => l.role === 'girder');
    const orig = d.lines[i];
    d.lines[i] = { ...editLine(orig, { markupPct: 40 }), edited: { markupPct: 1 } };   // lies about the builder value
    const j = d.lines.findIndex(l => l.kind === 'shop_labor');
    d.lines[j] = { ...d.lines[j], qty: d.lines[j].qty + 5 };                           // edit not claimed
    const s = server(d);
    expect(s.lines[i].edited).toEqual({ markupPct: orig.markupPct });
    expect(s.lines[j].edited).toEqual({ qty: build().lines[j].qty });
  });
  it('a consistent deriveLine shape change keeps the derived detail; an inconsistent one gets the builder detail', () => {
    const d = build();
    const i = d.lines.findIndex(l => l.role === 'girder' && l.detail?.type === 'steel');
    d.lines[i] = deriveLine(d.lines[i], { shape: 'W21 x 44' }, { shape: testCatalog.shape, steelCost: SC as any });
    let s = server(d);
    expect((s.lines[i].detail as any).shape).toBe('W21 x 44');
    expect((s.lines[i].builtDetail as any).shape).toBe((build().lines[i].detail as any).shape);
    d.lines[i] = { ...d.lines[i], unitCost: 1 };                                        // detail no longer explains the price
    s = server(d);
    expect(s.lines[i].detail).toEqual(build().lines[i].detail);
  });
  it('no spec: every line is hand', () => {
    const d = { ...build(), spec: undefined };
    expect(stampFromBuild(d, null).lines.every(l => l.source === 'hand' && !l.basis)).toBe(true);
  });
});
