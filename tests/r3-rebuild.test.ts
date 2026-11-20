// Round 3 S5: a rebuild preserves the rep's edits; planRebuild separates price-list drift from the spec change.
import { describe, it, expect } from 'vitest';
import { buildFromSpec } from '../src/engine/buildSpec';
import { priceManual, type QuoteDoc } from '../src/engine/manual';
import { editLine } from '../src/engine/deriveLine';
import { planRebuild, applyPlan } from '../src/engine/rebuildPlan';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';
import SC from '../src/engine/rules/steel_cost.default.json';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const FSTR = { type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 };
const build = (items: any[] = [FSTR], s: any = CAL_SETTINGS) => buildFromSpec({ pwi_quote: 1, items }, testCatalog, s, base).doc as QuoteDoc;
const rebuild = (d: QuoteDoc, spec: any = d.spec, s: any = CAL_SETTINGS) => buildFromSpec(spec, testCatalog, s, d);
const withSpan = (d: QuoteDoc, spanFt: number) => ({ ...(d.spec as any), items: (d.spec as any).items.map((it: any, i: number) => i === 0 ? { ...it, spanFt } : it) });
const bumped = { ...CAL_SETTINGS, steel_cost: { ...SC, perLb: Object.fromEntries(Object.entries(SC.perLb).map(([k, v]) => [k, (v as number) * 1.05])) } };

describe('S5 rebuild keeps edits', () => {
  it('unedited doc rebuilt with the same spec is identical (keys kept)', () => {
    const d = build(), r = rebuild(d);
    expect(r.doc.lines).toEqual(d.lines);
    expect(r.conflicts).toEqual([]);
  });
  it('an edited auto line keeps its edit through a rebuild with the same spec', () => {
    const d = build();
    const i = d.lines.findIndex(l => l.kind === 'shop_labor');
    d.lines[i] = editLine(d.lines[i], { qty: d.lines[i].qty + 7 });
    const r = rebuild(d);
    const l = r.doc.lines.find(x => x.ref === d.lines[i].ref)!;
    expect(l.qty).toBe(d.lines[i].qty);
    expect(l.edited).toEqual(d.lines[i].edited);
    expect(r.conflicts).toEqual([]);
  });
  it('a deleted auto line stays deleted (doc.removed)', () => {
    const d = build();
    const gone = d.lines.find(l => l.role === 'electrification' || l.role === 'end_stop')!;
    const d2 = { ...d, lines: d.lines.filter(l => l !== gone), removed: [gone.ref!] };
    const r = rebuild(d2);
    expect(r.doc.lines.some(l => l.ref === gone.ref)).toBe(false);
    expect(r.doc.removed).toEqual([gone.ref]);
  });
  it('a builder value that moved under an edit is a conflict; yours is kept', () => {
    const d = build();
    const i = d.lines.findIndex(l => l.role === 'runway' && l.detail?.type === 'steel');
    d.lines[i] = editLine(d.lines[i], { unitCost: 1 });
    const r = rebuild(d, d.spec, bumped);
    const c = r.conflicts.find(x => x.ref === d.lines[i].ref)!;
    expect(c).toMatchObject({ kind: 'changed', field: 'unitCost', yours: 1, builderWas: d.lines[i].edited!.unitCost });
    expect(c.builderNow).not.toBe(c.builderWas);
    expect(r.doc.lines.find(x => x.ref === c.ref)!.unitCost).toBe(1);
  });
  it('an edited line the builder no longer makes is kept as a hand line with a "gone" conflict', () => {
    const d = build([FSTR, { type: 'jib', capacityTons: 1, spanFt: 12, overallHeightFt: 14 }]);
    const sp = d.spec as any;
    const i = d.lines.findIndex(l => l.ref!.startsWith(sp.items[1].id + ':') && l.kind === 'shop_labor');
    d.lines[i] = editLine(d.lines[i], { qty: 99 });
    const r = rebuild(d, { ...sp, items: [sp.items[0]] });
    const c = r.conflicts.find(x => x.kind === 'gone')!;
    expect(c.ref).toBe(d.lines[i].ref);
    const kept = r.doc.lines.find(l => l.ref === c.ref)!;
    expect(kept).toMatchObject({ auto: false, source: 'hand', qty: 99 });
  });
});

describe('S5 planRebuild / applyPlan', () => {
  it('same spec, same prices → empty plan', () => {
    const d = build();
    const p = planRebuild(d, d.spec as any, testCatalog, CAL_SETTINGS);
    expect(p.empty).toBe(true);
    expect(p.money.delta.total).toBe(0);
  });
  it('same spec with steel_cost +5% → only price updates, no spec changes', () => {
    const d = build();
    const p = planRebuild(d, d.spec as any, testCatalog, bumped);
    expect(p.priceUpdates.length).toBeGreaterThan(0);
    expect(p.specChanges).toEqual([]);
    expect(p.money.specDelta).toBe(0);
    expect(p.money.priceOnlyDelta).toBeGreaterThan(0);
  });
  it('a span change is a spec change; money by section ties to the totals', () => {
    const d = build();
    const p = planRebuild(d, withSpan(d, 40), testCatalog, CAL_SETTINGS);
    expect(p.priceUpdates).toEqual([]);
    expect(p.specChanges.some(c => c.section === 'structural' && c.change === 'update')).toBe(true);
    expect(p.money.delta.total).toBeGreaterThan(0);
    const after = priceManual({ ...p.next, freestandingShopHours: p.next.lines.filter(l => l.kind === 'shop_labor').reduce((a, l) => a + l.qty, 0) }, CAL_SETTINGS);
    expect(after.quote.total).toBe(p.money.after.total);
    const secDelta = p.money.bySection.reduce((a, s) => a + s.delta, 0);
    const sell = (pp: any) => pp.totals.sell;
    expect(secDelta).toBeCloseTo(p.money.bySection.reduce((a, s) => a + s.after - s.before, 0), 2);
    expect(sell(after)).toBeGreaterThan(0);
  });
  it('conflicts resolve: default mine, or builder', () => {
    const d = build();
    const i = d.lines.findIndex(l => l.role === 'girder' && l.detail?.type === 'steel');
    d.lines[i] = editLine(d.lines[i], { unitCost: 10 });
    const p = planRebuild(d, withSpan(d, 40), testCatalog, CAL_SETTINGS);
    const c = p.conflicts.find(x => x.ref === d.lines[i].ref && x.field === 'unitCost')!;
    expect(c).toBeTruthy();
    expect(applyPlan(p).lines.find(l => l.ref === c.ref)!.unitCost).toBe(10);
    const b = applyPlan(p, { [c.id]: 'builder' }).lines.find(l => l.ref === c.ref)!;
    expect(b.unitCost).toBe(c.builderNow);
    expect(b.edited).toBeUndefined();
    expect(p.builderDoc.lines.find(l => l.ref === c.ref)!.unitCost).toBe(c.builderNow);
  });
  it('a pasted spec without ids inherits ids by position, so edits still land on the same line', () => {
    const d = build();
    const i = d.lines.findIndex(l => l.kind === 'shop_labor');
    d.lines[i] = editLine(d.lines[i], { qty: 1 });
    const pasted = { pwi_quote: 1, items: [{ ...FSTR, spanFt: 32 }] } as any;
    const p = planRebuild(d, pasted, testCatalog, CAL_SETTINGS);
    expect(p.next.lines.find(l => l.ref === d.lines[i].ref)!.qty).toBe(1);
  });
  it('a removed line shows as kept_deleted; install flag raised when the suggestion rises over a pinned install', () => {
    const d = build();
    const gone = d.lines.find(l => l.role === 'end_stop' || l.role === 'electrification')!;
    const site = d.lines.filter(l => l.kind === 'site_labor');
    // rep pins every site-labor line 0.5 h under the builder; a longer runway raises the suggestion → new flag numbers
    const d2: QuoteDoc = { ...d, removed: [gone.ref!], lines: d.lines.filter(l => l !== gone).map(l => l.kind === 'site_labor' ? editLine(l, { qty: l.qty - 0.5 }) : l) };
    const p = planRebuild(d2, { ...(d2.spec as any), items: [{ ...(d2.spec as any).items[0], runwayOalFt: 160 }] }, testCatalog, CAL_SETTINGS);
    expect(p.specChanges.some(c => c.change === 'kept_deleted' && c.ref === gone.ref)).toBe(true);
    expect(site.length).toBeGreaterThan(0);
    const raised = p.flags.raised.find(f => f.rule === 'INSTALL_BELOW_SUGGESTED')!;
    expect(raised).toBeTruthy();
    expect(raised.detail.suggested).toBeGreaterThan(priceManual(d2, CAL_SETTINGS).flags.find(f => f.rule === 'INSTALL_BELOW_SUGGESTED')!.detail.suggested as number);
    expect(p.next.lines.filter(l => l.kind === 'site_labor').every(l => l.edited?.qty != null)).toBe(true);
  });
});
