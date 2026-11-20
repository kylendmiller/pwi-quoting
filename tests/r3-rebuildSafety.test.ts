// Round 3: a kept edit on a member line defaults to the builder's value when the spec change moved geometry/capacity.
import { describe, it, expect } from 'vitest';
import { buildFromSpec } from '../src/engine/buildSpec';
import type { QuoteDoc } from '../src/engine/manual';
import { editLine } from '../src/engine/deriveLine';
import { planRebuild, applyPlan } from '../src/engine/rebuildPlan';
import { builderDefaultIds, geometryChanges, staleMemberRefs } from '../app/src/editor/rebuildSafety';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const FSTR = { type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 };
const build = () => buildFromSpec({ pwi_quote: 1, items: [FSTR] }, testCatalog, CAL_SETTINGS, base).doc as QuoteDoc;
const withItem = (d: QuoteDoc, patch: any) => ({ ...(d.spec as any), items: (d.spec as any).items.map((it: any, i: number) => (i === 0 ? { ...it, ...patch } : it)) });

describe('rebuild safety default', () => {
  it('geometryChanges sees span / runway / height / capacity / columns, not voltage or miles', () => {
    const d = build();
    expect(geometryChanges(d.spec, withItem(d, { spanFt: 40 }))).toEqual(['spanFt']);
    expect(geometryChanges(d.spec, withItem(d, { capacityTons: 10, runwayOalFt: 100 })).sort()).toEqual(['capacityTons', 'runwayOalFt']);
    expect(geometryChanges(d.spec, withItem(d, { columnsPerSystem: 8 }))).toEqual(['columnsPerSystem']);
    expect(geometryChanges(d.spec, withItem(d, { miles: 900, voltage: '230V/3' }))).toEqual([]);
  });
  it('a girder edit under a span change defaults to the builder; a shop-labor edit keeps yours', () => {
    const d = build();
    const gi = d.lines.findIndex(l => l.role === 'girder' && l.detail?.type === 'steel');
    const si = d.lines.findIndex(l => l.kind === 'shop_labor');
    d.lines[gi] = editLine(d.lines[gi], { unitCost: 1 });
    d.lines[si] = editLine(d.lines[si], { qty: d.lines[si].qty + 5 });
    const spec = withItem(d, { spanFt: 50 });
    const plan = planRebuild(d, spec as any, testCatalog, CAL_SETTINGS as any);
    const girderC = plan.conflicts.find(c => c.ref === d.lines[gi].ref);
    expect(girderC).toBeTruthy();
    const ids = builderDefaultIds(plan.conflicts, plan.next, d.spec, plan.next.spec);
    expect(ids.has(girderC!.id)).toBe(true);
    for (const c of plan.conflicts.filter(c => c.ref === d.lines[si].ref)) expect(ids.has(c.id)).toBe(false);
    expect(staleMemberRefs(plan.conflicts, plan.next, d.spec, plan.next.spec).has(girderC!.ref)).toBe(true);
    // applying with those defaults drops the stale girder edit
    const next = applyPlan(plan, Object.fromEntries([...ids].map(id => [id, 'builder' as const])));
    expect(next.lines.find(l => l.ref === girderC!.ref)!.edited?.unitCost).toBeUndefined();
  });
  it('no geometry change → no builder defaults (keep yours)', () => {
    const d = build();
    const gi = d.lines.findIndex(l => l.role === 'girder' && l.detail?.type === 'steel');
    d.lines[gi] = editLine(d.lines[gi], { unitCost: 1 });
    const spec = withItem(d, { miles: 999 });
    const plan = planRebuild(d, spec as any, testCatalog, CAL_SETTINGS as any);
    expect(builderDefaultIds(plan.conflicts, plan.next, d.spec, plan.next.spec).size).toBe(0);
  });
});
