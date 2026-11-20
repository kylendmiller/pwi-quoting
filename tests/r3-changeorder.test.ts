// Round 3 S10: change orders print the delta vs the confirmed revision; a won job stays won on revise.
import { describe, it, expect } from 'vitest';
import { buildFromSpec } from '../src/engine/buildSpec';
import { priceManual, pvHours, type QuoteDoc } from '../src/engine/manual';
import { editLine } from '../src/engine/deriveLine';
import { deltaDoc, reviseStatus } from '../src/engine/changeOrder';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: true, wording: '', options: [] };
const FSTR = { type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 };
const build = (items: any[] = [FSTR]) => { const d = buildFromSpec({ pwi_quote: 1, items }, testCatalog, CAL_SETTINGS, base).doc as QuoteDoc; return { ...d, freestandingShopHours: pvHours(d) }; };

describe('S10 change orders', () => {
  it('no change → empty delta, total 0', () => {
    const d = build(), r = deltaDoc(d, d, CAL_SETTINGS);
    expect(r.lines).toEqual([]);
    expect(r.delta.total).toBe(0);
  });
  for (const disc of [0, 0.08]) it(`add, remove and change lines (dealer discount ${disc}): the delta doc prices to the delta`, () => {
    const conf = { ...build(), dealerDiscount: disc };
    let cur: QuoteDoc = { ...conf, lines: [...conf.lines] };
    const g = cur.lines.findIndex(l => l.role === 'girder');
    cur.lines[g] = editLine(cur.lines[g], { qty: cur.lines[g].qty + 1 });
    const sh = cur.lines.findIndex(l => l.kind === 'shop_labor');
    cur.lines[sh] = editLine(cur.lines[sh], { qty: cur.lines[sh].qty + 10 });
    const gone = cur.lines.find(l => l.role === 'end_stop' || l.role === 'electrification')!;
    cur.lines = cur.lines.filter(l => l !== gone);
    cur.lines.push({ key: 'new', kind: 'material', category: 'costBased', description: 'Extra guard', qty: 2, unitCost: 300, markupPct: 25 });
    cur = { ...cur, freestandingShopHours: pvHours(cur), outboundFreight: conf.outboundFreight + 200 };
    const r = deltaDoc(conf, cur, CAL_SETTINGS);
    expect(r.lines.map(l => l.change).sort()).toEqual(['add', 'change', 'change', 'remove']);
    expect(r.delta.total).toBeCloseTo(r.after.total - r.before.total, 1);
    const p = priceManual(r.doc, CAL_SETTINGS);
    expect(Math.abs(p.quote.total - r.delta.total)).toBeLessThanOrEqual(0.02);
    expect(r.doc.wording).toMatch(/^CHANGE ORDER/);
    expect(r.doc.wording).toMatch(/DELETE: /);
    expect(r.doc.wording).toMatch(/ADD: Extra guard/);
  });
  it('a won job stays won on revise', () => {
    expect(reviseStatus('won', 'QUOTATION')).toBe('won');
    expect(reviseStatus('won', undefined)).toBe('won');
    expect(reviseStatus('sent', 'CONFIRMATION')).toBe('won');
    expect(reviseStatus('sent', 'QUOTATION')).toBe('draft');
    expect(reviseStatus('sent', 'CHANGE ORDER')).toBe('won');
  });
});
