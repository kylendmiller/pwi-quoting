import { describe, it, expect } from 'vitest';
import { buildFromSpec, BUILDERS } from '../src/engine/buildSpec';
import { priceManual } from '../src/engine/manual';
import { testCatalog } from './catalog';
const S = { shop_rate: 140, onsite_rate: 113, pm_rate: 95, cad_rate: 120, pe_rate: 180, freestanding_pv_per_shop_hour: 38.6, one_pct_adder: { on: true }, sales_tax_rate: 0.07, banned_strings: [] as string[] };
const base: any = { lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, suggestedInstallHours: null, freestandingShopHours: 0, pvPerHourOverride: null, wording: '', options: [] };
const run = (items: any[]) => {
  const b = buildFromSpec({ pwi_quote: 1, items }, testCatalog, {}, base);
  const p = priceManual(b.doc as any, S);
  return { ...b, total: Math.round(p.rollup.quote.total), p };
};
const cases: [string, any, number, number][] = [
  ['bridge 5t building runway 60x40', { type: 'bridge', capacityTons: 5, spanFt: 40, runwayOalFt: 60, overallHeightFt: 22, buildingBayFt: 20, motorized: true, voltage: '460/3', control: 'radio', install: true, miles: 150 }, 40000, 200000],
  ['gantry 3t 30ft', { type: 'gantry', capacityTons: 3, spanFt: 30, heightUnderBeamFt: 14, install: true, miles: 100 }, 25000, 160000],
  ['monorail 2t 40ft', { type: 'monorail', capacityTons: 2, lengthFt: 40, support: 'freestanding', overallHeightFt: 16, install: true, miles: 80 }, 15000, 120000],
  ['mezzanine 30x40', { type: 'mezzanine', lengthFt: 40, widthFt: 30, deckHeightFt: 12, stairs: 1, stairPrice: 6500, install: true, miles: 60 }, 40000, 200000],
  ['jib 1t 16ft floor', { type: 'jib', capacityTons: 1, spanFt: 16, overallHeightFt: 16, install: true, miles: 60 }, 6000, 60000],
  ['fall protection 60ft', { type: 'fall_protection', lengthFt: 60, install: true, miles: 60 }, 5000, 80000],
  ['work platform set 51ft', { type: 'work_platform', lengthFt: 51, widthFt: 2.5, crosswalks: { pivot: 2 }, install: true, miles: 60 }, 40000, 160000],
  ['VRC PWSD0606', { type: 'vrc', model: 'PWSD0606', install: true, miles: 60 }, 60000, 110000],
  ['catalog AERO', { type: 'catalog', item: 'GS1000O-1012', description: 'AERO GS1000O-1012 work cell', unitPrice: 6140, qty: 2 }, 1000, 40000],
];
describe('every product line builds', () => {
  for (const [name, item, lo, hi] of cases) it(name, () => {
    const r = run([item]);
    console.log(name, r.total, r.blockers, r.notes.slice(0, 3));
    expect(r.doc.lines.length).toBeGreaterThan(0);
    expect(r.total).toBeGreaterThan(lo); expect(r.total).toBeLessThan(hi);
    expect(r.doc.wording).toMatch(/^# /);
    expect(r.doc.family).toBe(BUILDERS[item.type].fam);
  });
  it('unknown catalog item becomes a blocker, not a crash', () => {
    const r = run([{ type: 'catalog', item: 'zzz nothing like this' }]);
    expect(r.blockers.length).toBe(1);
  });
  it('bad input becomes a blocker', () => {
    const r = run([{ type: 'jib', capacityTons: 50, spanFt: 16, install: false }]);
    expect(r.blockers.join(' ')).toMatch(/capacity/i);
  });
  it('two installed items share one trip (cheaper than two separate quotes)', () => {
    const a = { type: 'jib', capacityTons: 1, spanFt: 16, overallHeightFt: 16, install: true, miles: 600 };
    const b = { type: 'monorail', capacityTons: 2, lengthFt: 40, support: 'freestanding', overallHeightFt: 16, install: true, miles: 600 };
    const both = run([a, b]), sep = run([a]).total + run([b]).total;
    console.log('shared', both.total, 'separate', sep, both.notes.filter(n => n.includes('shared')));
    expect(both.total).toBeLessThan(sep);
    expect(both.notes.some(n => n.includes('shared trip'))).toBe(true);
  });
});
