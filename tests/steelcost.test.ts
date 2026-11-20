import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFromSpec } from '../src/engine/buildSpec';
import { readSteelCost } from '../src/engine/kit';
import { testCatalog } from './catalog';
import SC from '../src/engine/rules/steel_cost.default.json';

const base: any = { lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const spec: any = { pwi_quote: 1, items: [{ type: 'freestanding', series: 'GM', runwayOalFt: 60, spanFt: 30, capacityTons: 5, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: false }] };
const cost = (lines: any[], cat: string) => lines.filter(l => l.category === cat).reduce((a, l) => a + l.unitCost * l.qty, 0);

describe('steel_cost setting', () => {
  it('seed covers every price group plus Plate', () => {
    const groups = Object.keys(JSON.parse(readFileSync('reference/steel_price_groups.json', 'utf8')));
    for (const g of [...groups, 'Plate']) expect((SC.perLb as any)[g], g).toBeGreaterThan(0);
  });
  it('seeded setting reproduces catalog prices', () => {
    const a = buildFromSpec(spec, testCatalog, {}, base).doc.lines, b = buildFromSpec(spec, testCatalog, { steel_cost: SC }, base).doc.lines;
    expect(cost(b, 'structural')).toBeCloseTo(cost(a, 'structural'), 0);
    expect(cost(b, 'plate')).toBeCloseTo(cost(a, 'plate'), 0);
  });
  it('raising every group 10% raises steel + plate cost 10%', () => {
    const up = { ...SC, perLb: Object.fromEntries(Object.entries(SC.perLb).map(([k, v]) => [k, (v as number) * 1.1])) };
    const a = buildFromSpec(spec, testCatalog, {}, base), b = buildFromSpec(spec, testCatalog, { steel_cost: up }, base);
    expect(cost(b.doc.lines, 'structural') / cost(a.doc.lines, 'structural')).toBeCloseTo(1.1, 2);
    expect(cost(b.doc.lines, 'plate') / cost(a.doc.lines, 'plate')).toBeCloseTo(1.1, 2);
    expect(b.assumptions.some(x => x.field === 'steelCost' && x.value === SC.effective)).toBe(true);
  });
  it('missing groups fall back to the catalog; bad settings are ignored with a note', () => {
    const only = buildFromSpec(spec, testCatalog, { steel_cost: { effective: '2026-12-01', source: 'x', perLb: { Plate: 2 } } }, base).doc.lines;
    const a = buildFromSpec(spec, testCatalog, {}, base).doc.lines;
    expect(cost(only, 'structural')).toBeCloseTo(cost(a, 'structural'), 0);
    expect(cost(only, 'plate')).toBeGreaterThan(cost(a, 'plate'));
    expect(readSteelCost({ effective: 'last week', perLb: {} }).sc).toBeNull();
    const bad = buildFromSpec(spec, testCatalog, { steel_cost: { perLb: 5 } }, base);
    expect(bad.notes.join(' ')).toMatch(/steel_cost/);
  });
});
