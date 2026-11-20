// Round 3 integration: the editor's engine adapter (app/src/editor/engineApi.ts) end to end, no UI.
// build → edit girder shape / length → totals move exactly as priceManual says → rebuild (same spec) keeps the edit →
// delete a line → rebuild keeps it deleted → install lines removed raises install_below_suggested → target price.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFromSpec, type QuoteSpec } from '../src/engine/buildSpec';
import { priceManual, flagDef, type QuoteDoc, type QuoteLine } from '../src/engine/manual';
import {
  price, effectiveDoc, quoteMoney, editCell, revertCell, revertLine, changedPaths, isChanged, deriveCtx, removeLine, restoreLine,
  planRebuild, applyPlan, joinLines, stdCostKnown, targetAdjustment, ADJ_KEY, deriveFamily, pvHours,
} from '../app/src/editor/engineApi';
import { rowStats } from '../app/src/editor/smt';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';

const S = { ...CAL_SETTINGS } as any;
const shapesRaw = JSON.parse(readFileSync('reference/steel_shapes.json', 'utf8')) as any[];
const groupsRaw = JSON.parse(readFileSync('reference/steel_price_groups.json', 'utf8')) as Record<string, { price_per_lb: number }>;
// the same refData the app loads (steel_shapes / steel_price_groups tables)
const ctx = deriveCtx(shapesRaw.map(s => ({ shape: s.shape, lb_per_ft: s.lb_per_ft, price_group: s.group })),
  Object.fromEntries(Object.entries(groupsRaw).map(([k, v]) => [k, v.price_per_lb])), S);

const base: QuoteDoc = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [], suggestedInstallHours: null, freestandingShopHours: 0, pvPerHourOverride: null };
const SPEC: QuoteSpec = { pwi_quote: 1, project: 'Paint line cranes', items: [{ type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 }] };
const build = () => buildFromSpec(SPEC, testCatalog, S, base).doc;
const setLine = (d: QuoteDoc, l: QuoteLine): QuoteDoc => ({ ...d, lines: d.lines.map(x => (x.key === l.key ? l : x)) });
const girderOf = (d: QuoteDoc) => d.lines.find(l => l.role === 'girder' && l.detail?.type === 'steel')!;
const rebuildSame = (d: QuoteDoc) => applyPlan(planRebuild(d, d.spec as QuoteSpec, testCatalog, S));
const sellOf = (p: ReturnType<typeof price>, key: string) => p.lines.find(l => l.key === key)!.sell;

describe('editor flow through engineApi', () => {
  const d0 = build();
  const p0 = price(d0, S);
  const g0 = girderOf(d0);

  it('live preview prices exactly like the server (family + PV hours from the spec)', () => {
    const fed = effectiveDoc(d0);
    expect(fed.family).toBe(deriveFamily(d0));
    expect(fed.freestandingShopHours).toBe(pvHours(d0));
    expect(p0.quote).toEqual(priceManual(fed, S).quote);
    expect(p0.flags.map(f => f.rule)).not.toContain('FAMILY_PV_DROP');
    // a stale client family is ignored, as on the server
    expect(price({ ...d0, family: 'other', freestandingShopHours: 0 }, S).quote).toEqual(p0.quote);
    // S9: total = sum of the rounded parts
    const q = quoteMoney(p0);
    expect(q.total).toBeCloseTo(q.base + q.installation + q.freight + q.preUse + q.tax, 6);
    // S7: standard parts carry cost now (not "pending")
    const std = joinLines(d0, p0).filter(l => l.category === 'stdParts');
    expect(std.length).toBeGreaterThan(0);
    expect(std.every(l => stdCostKnown(l) && l.cost > 0 && l.cost < l.sell)).toBe(true);
    const row = rowStats(d0, p0).find(r => r.def.key === 'stdParts')!;
    expect(row.costUnknown).toBe(false);
    expect(row.gmPct).not.toBeNull();
    // S6: priced lines carry no detail, rowStats joins it back (structural tons > 0)
    expect(p0.lines.every(l => l.detail === undefined)).toBe(true);
    expect(rowStats(d0, p0).find(r => r.def.key === 'structural')!.lb).toBeGreaterThan(0);
  });

  // ---- edit girder shape + length
  const heavier = 'W24 x 131';
  const g1 = editCell(editCell(g0, 'detail.shape', heavier, ctx), 'detail.lengthFt', (g0.detail as any).lengthFt + 4, ctx);
  const d1 = setLine(d0, g1);
  const p1 = price(d1, S);

  it('shape / length edits go through deriveLine and show on the detail cells', () => {
    const d: any = g1.detail;
    expect(d.shape).toBe(heavier);
    expect(d.lbEach).toBeCloseTo(d.lbPerFt * d.lengthFt, 6);
    expect(g1.unitCost).toBeCloseTo(Math.round(d.lbEach * d.costPerLb * 100) / 100, 2);
    expect(g1.description).toContain(heavier);
    expect(g1.builtDetail).toEqual(g0.detail);
    // S's model: priced fields the edit moved are in `edited` with the builder's values …
    expect(g1.edited?.unitCost).toBe(g0.unitCost);
    // … the editor shows the change on the cells the rep typed in, with the builder's value for revert
    const cp = changedPaths(g1);
    expect(cp['detail.shape']).toBe((g0.detail as any).shape);
    expect(cp['detail.lengthFt']).toBe((g0.detail as any).lengthFt);
    expect('unitCost' in cp).toBe(false);
    expect(isChanged(g1, 'qty')).toBe(false);
  });

  it('totals change consistently with priceManual', () => {
    const direct = priceManual(effectiveDoc(d1), S);
    expect(p1.quote).toEqual(direct.quote);
    expect(p1.quote.total).toBeGreaterThan(p0.quote.total);
    // the girder's own sell moved by cost delta × (1 + markup)
    const dSell = sellOf(p1, g0.key) - sellOf(p0, g0.key);
    expect(dSell).toBeCloseTo((g1.unitCost! - g0.unitCost!) * g0.qty * (1 + (g0.markupPct ?? 0) / 100), 1);
    // and the structural row and the base price moved by that (+ the hidden 1%)
    const row = (p: typeof p0, d: QuoteDoc) => rowStats(d, p).find(r => r.def.key === 'structural')!.sell;
    expect(row(p1, d1) - row(p0, d0)).toBeCloseTo(dSell, 1);
    const onePct = S.one_pct_adder.on ? 1.01 : 1;
    expect(p1.quote.base - p0.quote.base).toBeCloseTo(dSell * onePct, 0);
  });

  it('per-cell revert puts each value back; reverting both restores the built line', () => {
    const r1 = revertCell(g1, 'detail.shape', ctx);
    expect((r1.detail as any).shape).toBe((g0.detail as any).shape);
    expect(isChanged(r1, 'detail.lengthFt')).toBe(true);
    const r2 = revertCell(r1, 'detail.lengthFt', ctx);
    expect(r2.detail).toEqual(g0.detail);
    expect(r2.edited).toBeUndefined();
    expect(r2.builtDetail).toBeUndefined();
    expect(r2.unitCost).toBe(g0.unitCost);
    expect(r2.description).toBe(g0.description);
    expect(revertLine(g1)).toEqual(g0);
  });

  // ---- rebuild with the same spec
  const d2 = rebuildSame(d1);

  it('rebuild with the same spec keeps the edit', () => {
    const plan = planRebuild(d1, d1.spec as QuoteSpec, testCatalog, S);
    expect(plan.conflicts).toEqual([]);
    expect(plan.specChanges).toEqual([]);
    expect(plan.money.delta.total).toBe(0);
    const g2 = girderOf(d2);
    expect(g2.key).toBe(g1.key);
    expect((g2.detail as any).shape).toBe(heavier);
    expect(g2.unitCost).toBe(g1.unitCost);
    expect(changedPaths(g2)).toEqual(changedPaths(g1));
    expect(price(d2, S).quote).toEqual(p1.quote);
  });

  // ---- delete an auto line
  const victim = d2.lines.find(l => l.auto && l.category === 'stdParts')!;
  const del = removeLine(d2, victim.key);
  const d3 = del.doc;

  it('deleting an auto line records its ref in doc.removed; a rebuild keeps it deleted', () => {
    expect(del.ref).toBe(victim.ref);
    expect(d3.removed).toEqual([victim.ref]);
    expect(d3.lines.some(l => l.key === victim.key)).toBe(false);
    const plan = planRebuild(d3, d3.spec as QuoteSpec, testCatalog, S);
    expect(plan.specChanges.filter(c => c.change !== 'kept_deleted')).toEqual([]);
    expect(plan.specChanges.find(c => c.change === 'kept_deleted')?.ref).toBe(victim.ref);
    const d4 = applyPlan(plan);
    expect(d4.lines.some(l => l.ref === victim.ref)).toBe(false);
    expect(d4.removed).toEqual([victim.ref]);
    expect((girderOf(d4).detail as any).shape).toBe(heavier);           // the girder edit is still there too
    expect(price(d4, S).quote.total).toBeLessThan(p1.quote.total);
    // restore brings it back and clears doc.removed
    const back = restoreLine(d3, del.line!);
    expect(back.removed).toEqual([]);
    expect(price(back, S).quote).toEqual(price(d2, S).quote);
  });

  it('removing the install lines raises install_below_suggested', () => {
    expect(p0.flags.some(f => f.rule === 'INSTALL_BELOW_SUGGESTED')).toBe(false);
    let d = d3;
    for (const l of d3.lines.filter(x => x.kind === 'site_labor')) d = removeLine(d, l.key).doc;
    const p = price(d, S);
    const f = p.flags.find(x => x.rule === 'INSTALL_BELOW_SUGGESTED');
    expect(f).toBeTruthy();
    expect(flagDef(f!.rule)?.id).toBe('install_below_suggested');
    expect(f!.section).toBe('install');
    expect(f!.detail.quoted).toBe(0);
    // and a rebuild with the same spec keeps them deleted (still flagged)
    const r = rebuildSame(d);
    expect(r.lines.some(l => l.kind === 'site_labor')).toBe(false);
    expect(price(r, S).flags.some(x => x.rule === 'INSTALL_BELOW_SUGGESTED')).toBe(true);
  });

  it('target price adds a negative-unitSell material line and lands on the total; big cuts raise MIN_GM / BIG_DISCOUNT', () => {
    const now = p1.quote.total;
    const t = targetAdjustment(d1, S, now - 3000)!;
    const adj = t.doc.lines.find(l => l.key === ADJ_KEY)!;
    expect(adj.kind).toBe('material');
    expect(adj.unitSell!).toBeLessThan(0);
    expect(adj.unitCost).toBeUndefined();
    expect(Math.abs(t.priced.quote.total - (now - 3000))).toBeLessThanOrEqual(0.01);
    expect(t.priced.quote).toEqual(price(t.doc, S).quote);
    // replaces, never stacks
    const t2 = targetAdjustment(t.doc, S, now - 1000)!;
    expect(t2.doc.lines.filter(l => l.key === ADJ_KEY)).toHaveLength(1);
    expect(Math.abs(t2.priced.quote.total - (now - 1000))).toBeLessThanOrEqual(0.01);
    // a deep cut: over the 10% discount limit and under the GM floor
    const deep = targetAdjustment(d1, S, now * 0.7)!;
    const rules = deep.priced.flags.map(f => f.rule);
    expect(rules).toContain('BIG_DISCOUNT');
    expect(rules).toContain('MIN_GM');
    expect(deep.priced.flags.find(f => f.rule === 'BIG_DISCOUNT')!.lineKeys).toEqual([ADJ_KEY]);
  });

  it('labor, vendor and std-part cells map onto deriveLine and revert per cell', () => {
    const lab = d0.lines.find(l => l.auto && l.detail?.type === 'labor' && l.kind === 'shop_labor')!;
    const b = editCell(lab, 'detail.baseHrs', (lab.detail as any).baseHrs + 10, ctx);
    expect(b.qty).toBeCloseTo(Math.round(((lab.detail as any).baseHrs + 10) * (lab.detail as any).factor * 10) / 10, 6);
    expect(Object.keys(changedPaths(b))).toEqual(['detail.baseHrs']);
    expect(revertCell(b, 'detail.baseHrs', ctx)).toEqual(lab);
    const q = editCell(lab, 'qty', lab.qty + 5, ctx);
    expect(Object.keys(changedPaths(q))).toEqual(['qty']);
    expect((q.detail as any).hours).toBe(lab.qty + 5);
    expect(revertCell(q, 'qty', ctx)).toEqual(lab);
    const ven = d0.lines.find(l => l.auto && l.detail?.type === 'vendor')!;
    const v1 = editCell(ven, 'detail.pwiDiscPct', 60, ctx);
    expect(v1.unitCost).toBeCloseTo((ven.detail as any).list * 0.4, 2);
    expect(Object.keys(changedPaths(v1))).toEqual(['detail.pwiDiscPct']);
    expect(revertLine(v1)).toEqual(ven);
    const std = d0.lines.find(l => l.auto && l.detail?.type === 'std')!;
    const s1 = editCell(std, 'unitSell', std.unitSell! + 100, ctx);
    expect((s1.detail as any).sellEach).toBe(std.unitSell! + 100);
    expect(changedPaths(s1)).toEqual({ unitSell: std.unitSell });
    expect(revertCell(s1, 'unitSell', ctx)).toEqual(std);
    // a hand line never gets marks
    const hand = { ...lab, auto: false, source: 'hand' as const, key: 'h1' };
    expect(changedPaths(editCell(hand, 'detail.baseHrs', 99, ctx))).toEqual({});
  });
});

// ---- round 4: removed lines survive a save / reload and can be restored; install crew goes through the spec
import { removedList, forgetRemoved, withInstallCrew, installCrew, INSTALL_DAYS_OP } from '../app/src/editor/engineApi';
import { validateDoc } from '../src/engine/manual';
import { stampFromBuild } from '../src/engine/stamp';

describe('round 4: restore deleted lines after reload', () => {
  const d0 = build();
  const p0 = price(d0, S);
  const victim = d0.lines.find(l => l.auto && l.category === 'stdParts')!;
  const sell = p0.lines.find(l => l.key === victim.key)!.sell;
  const del = removeLine(d0, victim.key, sell);
  // the save shape: what the browser sends and the server stores (JSON), then what the editor loads back
  const saved = stampFromBuild(JSON.parse(JSON.stringify(del.doc)), d0);
  const reloaded: QuoteDoc = JSON.parse(JSON.stringify(saved));

  it('delete writes removedInfo (ref, description, row, sell) next to doc.removed', () => {
    expect(del.doc.removed).toEqual([victim.ref]);
    expect(del.doc.removedInfo).toEqual([{ ref: victim.ref, description: victim.description, category: 'stdParts', sell: Math.round(sell * 100) / 100 }]);
    expect(validateDoc(del.doc)).toEqual([]);                 // the server accepts the new field
    expect(validateDoc({ ...del.doc, removedInfo: [{ ref: 5 }] as any })[0]).toMatch(/removedInfo/);
  });

  it('after a save → reload roundtrip the line is listed with its description and row (no session cache)', () => {
    expect(reloaded.removedInfo).toEqual(del.doc.removedInfo);
    const list = removedList(reloaded);
    expect(list).toEqual([{ ref: victim.ref, description: victim.description, category: 'stdParts', sell: Math.round(sell * 100) / 100, known: true }]);
  });

  it('restore = drop the ref + rebuild preview: the builder line comes back as an add and the price returns', () => {
    const plan = planRebuild(reloaded, reloaded.spec as QuoteSpec, testCatalog, S, { restore: [victim.ref!] });
    const add = plan.specChanges.find(c => c.ref === victim.ref)!;
    expect(add.change).toBe('add');
    expect(plan.priceUpdates.some(c => c.ref === victim.ref)).toBe(false);
    expect(plan.specChanges.some(c => c.change === 'kept_deleted')).toBe(false);
    const back = applyPlan(plan);
    expect(back.removed).toEqual([]);
    expect(back.removedInfo).toEqual([]);
    expect(back.lines.find(l => l.ref === victim.ref)?.description).toBe(victim.description);
    expect(price(back, S).quote).toEqual(p0.quote);
    // and it stays back on the next rebuild
    expect(rebuildSame(back).lines.some(l => l.ref === victim.ref)).toBe(true);
    // and through another save roundtrip
    const again = stampFromBuild(JSON.parse(JSON.stringify(back)), d0);
    expect(again.removed).toEqual([]);
    expect(again.removedInfo).toEqual([]);
  });

  it('old docs without removedInfo list the ref as "line removed" and still restore', () => {
    const { removedInfo: _x, ...old } = reloaded;
    const list = removedList(old as QuoteDoc);
    expect(list).toEqual([{ ref: victim.ref, description: 'line removed', category: null, sell: null, known: false }]);
    expect(validateDoc(old as QuoteDoc)).toEqual([]);
    const back = applyPlan(planRebuild(old as QuoteDoc, old.spec as QuoteSpec, testCatalog, S, { restore: [victim.ref!] }));
    expect(back.lines.some(l => l.ref === victim.ref)).toBe(true);
    expect(price(back, S).quote).toEqual(p0.quote);
    // forgetRemoved alone (no spec rebuild) only clears the lists
    expect(forgetRemoved(old as QuoteDoc, victim.ref!).removed).toEqual([]);
  });

  it('the server stamp keeps removedInfo only for refs still removed', () => {
    const stale = stampFromBuild({ ...del.doc, removed: [], removedInfo: del.doc.removedInfo }, d0);
    expect(stale.removedInfo).toEqual([]);
  });
});

describe('round 4: install crew control (men × days) through spec + planRebuild', () => {
  const d0 = build();
  const c0 = installCrew(d0);
  it('reads the builder crew', () => {
    expect(c0.set).toBe(false);
    expect(c0.men).toBeGreaterThan(0);
    expect(c0.days).toBe(c0.builtDays);
  });
  it('days → spec.installDays → rebuild preview; hours, travel and equipment follow; fewer days raises the approval', () => {
    const more = withInstallCrew(d0, { days: c0.days! + 2 });
    expect(more.items[0].installDays).toBe(c0.days! + 2);
    const plan = planRebuild(d0, more, testCatalog, S);
    expect(plan.specChanges.some(c => c.change === 'add' && c.ref?.endsWith('install-days-adjustment'))).toBe(true);
    const d1 = applyPlan(plan);
    const c1 = installCrew(d1);
    expect(c1).toEqual({ men: c0.men, days: c0.days! + 2, builtDays: c0.days, set: true });
    const site = d1.lines.filter(l => l.kind === 'site_labor' && l.laborOp !== 'site_travel').reduce((a, l) => a + l.qty, 0);
    const site0 = d0.lines.filter(l => l.kind === 'site_labor' && l.laborOp !== 'site_travel').reduce((a, l) => a + l.qty, 0);
    expect(Math.round(site * 10) / 10).toBe(Math.round((site0 + c0.men! * 2 * 10) * 10) / 10);   // +2 whole crew-days on top of the builder's hours
    expect(price(d1, S).flags.some(f => f.rule === 'INSTALL_BELOW_SUGGESTED')).toBe(false);
    // fewer days
    const fewer = applyPlan(planRebuild(d1, withInstallCrew(d1, { days: c0.days! - 1 }), testCatalog, S));
    expect(fewer.lines.find(l => l.laborOp === INSTALL_DAYS_OP)!.qty).toBeLessThan(0);
    expect(price(fewer, S).flags.some(f => f.rule === 'INSTALL_BELOW_SUGGESTED')).toBe(true);
    // back to the builder's days: no adjustment, builder price
    const back = applyPlan(planRebuild(fewer, withInstallCrew(fewer, { days: null }), testCatalog, S));
    expect(back.lines.some(l => l.laborOp === INSTALL_DAYS_OP)).toBe(false);
    expect((back.spec as any).items[0].installDays).toBeUndefined();
    expect(price(back, S).quote).toEqual(price(d0, S).quote);
  });
  it('several installed items: days split by install hours, whole days adding up', () => {
    const multi: QuoteSpec = { pwi_quote: 1, items: [{ ...SPEC.items[0], miles: 150 }, { type: 'mezzanine', lengthFt: 40, widthFt: 30, deckHeightFt: 12, stairs: 1, install: true, miles: 150 }] };
    const dm = buildFromSpec(multi, testCatalog, S, base).doc;
    const sp = withInstallCrew(dm, { days: 9 });
    const ds = sp.items.map((it: any) => it.installDays);
    expect(ds.every((x: number) => Number.isInteger(x) && x >= 1)).toBe(true);
    expect(ds[0] + ds[1]).toBe(9);
    const d1 = applyPlan(planRebuild(dm, sp, testCatalog, S));
    expect(installCrew(d1).days).toBe(9);
  });
});
