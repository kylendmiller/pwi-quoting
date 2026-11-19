import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFreestanding, type Catalog } from '../src/engine/freestanding';
import { priceManual } from '../src/engine/manual';

const ref = (f: string) => JSON.parse(readFileSync(`reference/${f}`, 'utf8'));
const parts = ref('standard_parts.json'); const shapes = ref('steel_shapes.json'); const groups = ref('steel_price_groups.json');
const vlist = ref('vendor_price_lists.json'); const decals = ref('decals.json');
const allV = Object.entries(vlist).flatMap(([vendor, d]: any) => d.parts.map((p: any) => ({ ...p, vendor })));
export const testCatalog: Catalog = {
  stdSell: d => parts.find((p: any) => p.description === d)?.sell ?? null,
  vendor: part => allV.find((p: any) => p.part === part) ?? null,
  vendorParts: prefix => allV.filter((p: any) => p.part.startsWith(prefix)),
  discount: v => ({ pwi: vlist[v].default_pwi_discount_pct, customer: vlist[v].default_customer_discount_pct }),
  shape: n => { const s = shapes.find((x: any) => x.shape === n); return s ? { lbPerFt: s.lb_per_ft, pricePerLb: groups[s.group].price_per_lb } : null; },
  plate: { pricePerLb: 1.35, markupPct: 21, dropFactor: 1.1 }, structuralMarkupPct: 26, paintRunSell: 1983.75,
  decalSell: n => decals.find((d: any) => d.item === n)?.price ?? null,
};
const S = { shop_rate: 140, onsite_rate: 113, pm_rate: 95, cad_rate: 120, pe_rate: 180, freestanding_pv_per_shop_hour: 38.6, one_pct_adder: { on: true }, sales_tax_rate: 0.07, banned_strings: ["Paul's Welding"] };

describe('freestanding builder', () => {
  // Compare with sold job 29140: FSTRM2, 80' OAL, 37' span, 2 t, 13'7" hook, 208V, motorized, radio, collision avoidance — sold $85,594 ship-only
  const spec = { series: 'M' as const, systems: 1, runwayOalFt: 80, spanFt: 37, capacityTons: 2, hookHeightFt: 13.6, bridgeDrive: 'motorized' as const, trolley: 'motorized' as const,
    voltage: '208V/3' as const, control: 'radio' as const, collisionAvoidance: true, install: false, miles: 0 };
  const r = buildFreestanding(spec, testCatalog);
  it('handles a small manual FSTRGM1 like sold job 29213 (installed, 230V)', () => {
    const b = buildFreestanding({ series: 'GM', systems: 1, runwayOalFt: 20.67, spanFt: 7.25, capacityTons: 1, hookHeightFt: 10, bridgeDrive: 'manual', trolley: 'manual',
      voltage: '230V/3', control: 'pendant', install: true, miles: 40 }, testCatalog);
    console.log('29213 notes', b.notes, 'install', b.suggestedInstallHours);
    expect(b.notes.filter(n => /not found/.test(n))).toEqual([]);
    expect(b.suggestedInstallHours).toBeGreaterThan(30);
  });
  it('builds every line with no missing catalog items', () => {
    expect(r.notes.filter(n => /not found/.test(n))).toEqual([]);
    expect(r.lines.length).toBeGreaterThan(20);
  });
  it('lands in the range of the real sold quote', () => {
    const lines = r.lines;
    const shopHours = lines.filter(l => l.kind === 'shop_labor').reduce((a, l) => a + l.qty, 0);
    const p = priceManual({ family: 'freestanding', lines, outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, suggestedInstallHours: null,
      freestandingShopHours: shopHours, pvPerHourOverride: null, wording: r.wording, options: [] }, S);
    console.log('29140 rebuild: base', Math.round(p.rollup.basePrice), 'vs sold base 82,134; SMT shop hrs', r.smtShopHours, '→', shopHours, '; lint', p.lint.map(l => l.message));
    expect(p.rollup.basePrice).toBeGreaterThan(82134 * 0.75);
    expect(p.rollup.basePrice).toBeLessThan(82134 * 1.25);
    expect(p.lint.filter(l => l.level === 'error')).toEqual([]);
  });
});
