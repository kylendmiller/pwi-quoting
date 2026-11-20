// Round 3 S6: C fixes — no double-stored detail, honest members / review list, honest dealer-discount walk.
import { describe, it, expect } from 'vitest';
import { buildFromSpec } from '../src/engine/buildSpec';
import { priceManual, type QuoteDoc } from '../src/engine/manual';
import { sectionize } from '../src/engine/sections';
import { deriveLine, editLine } from '../src/engine/deriveLine';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';
import SC from '../src/engine/rules/steel_cost.default.json';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const FSTR = { type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 };
const build = (items: any[] = [FSTR]) => buildFromSpec({ pwi_quote: 1, items }, testCatalog, CAL_SETTINGS, base).doc as QuoteDoc;
const tree = (d: QuoteDoc) => sectionize(d, priceManual(d, CAL_SETTINGS));

describe('S6 section tree fixes', () => {
  it('priced lines do not carry detail / basis (stored once, in the doc)', () => {
    const d = build(), p = priceManual(d, CAL_SETTINGS);
    expect(p.lines.some(l => l.detail || l.basis)).toBe(false);
    expect(tree(d).sections.find(s => s.key === 'structural')!.lines.every(l => l.detail)).toBe(true);
    const json = JSON.stringify(p).length, docJson = JSON.stringify(d).length;
    expect(json).toBeLessThan(docJson);
  });
  it('members read the current line: a deriveLine shape swap shows the new beam and weight', () => {
    const d = build();
    const i = d.lines.findIndex(l => l.role === 'girder' && l.detail?.type === 'steel');
    d.lines[i] = deriveLine(d.lines[i], { shape: 'W21 x 44' }, { shape: testCatalog.shape, steelCost: SC as any });
    const m = tree(d).sections.find(s => s.key === 'structural')!.members!.find(x => x.role === 'girder')!;
    expect(m.size).toBe('W21 x 44');
    expect(m.edited).toBeUndefined();
  });
  it('a description retyped away from the detail shows "edited" and the description, not the old beam', () => {
    const d = build();
    const i = d.lines.findIndex(l => l.role === 'girder' && l.detail?.type === 'steel');
    const old = (d.lines[i].detail as any).shape;
    d.lines[i] = editLine(d.lines[i], { description: 'Bridge girder — W21 x 44 × 30\'' });
    const t = tree(d);
    const m = t.sections.find(s => s.key === 'structural')!.members!.find(x => x.role === 'girder')!;
    expect(m.edited).toBe(true);
    expect(m.size).toBe('W21 x 44 × 30\'');
    expect(m.size).not.toContain(old);
    expect(t.review.some(r => r.key === d.lines[i].key && /Description edited/.test(r.reason))).toBe(true);
  });
  it('review lists markup, category and kind edits (ADV2 E3 / E4)', () => {
    const d = build();
    const g = d.lines.findIndex(l => l.role === 'runway');
    d.lines[g] = editLine(d.lines[g], { markupPct: 0 });
    d.lines = d.lines.map(l => l.kind === 'site_labor' ? editLine(l, { kind: 'material', category: 'costBased' }) : l);
    const t = tree(d);
    expect(t.review.find(r => r.key === d.lines[g].key)!.reason).toMatch(/Markup edited \(builder 26%, now 0%\)/);
    const moved = t.review.filter(r => /Category edited/.test(r.reason) && /Kind edited/.test(r.reason));
    expect(moved.length).toBe(d.lines.filter(l => l.edited?.kind).length);
    expect(moved.length).toBeGreaterThan(0);
  });
  it('dealer discount: the walk is computed from the section lines and ties out (no circular diff)', () => {
    const d = { ...build(), dealerDiscount: 0.1 }, p = priceManual(d, CAL_SETTINGS), t = sectionize(d, p);
    expect(Math.abs(t.reconcile.diff)).toBeLessThan(0.05);
    expect(t.reconcile.dealerDiscountAmount).toBeLessThan(0);
    expect(t.reconcile.basePrice + t.reconcile.dealerDiscountAmount).toBeCloseTo(p.rollup.quote.base, 1);
  });
  it('unknown category: kept in Cost-based, listed in review, and the walk shows the gap', () => {
    const d = build();
    d.lines.push({ key: 'odd', kind: 'material', category: 'mystery' as any, description: 'Odd', qty: 1, unitSell: 500 });
    const t = tree(d);
    expect(t.sections.find(s => s.key === 'costBased')!.lines.some(l => l.key === 'odd')).toBe(true);
    expect(t.review.some(r => r.key === 'odd' && /Unknown category/.test(r.reason))).toBe(true);
    expect(t.reconcile.diff).toBeCloseTo(500, 0);
  });
  it('runway basis row says runway, not column', () => {
    const r = build().lines.find(l => l.role === 'runway' && l.detail?.type === 'steel')!;
    expect(r.basis!.row).toMatch(/t runway × bay/);
  });
});
