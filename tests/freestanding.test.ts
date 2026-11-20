import { describe, it, expect } from 'vitest';
import { buildFreestanding, type FreestandingSpec } from '../src/engine/freestanding';
import { buildFromSpec, parseSpec } from '../src/engine/buildSpec';
import { priceManual } from '../src/engine/manual';
import { testCatalog } from './catalog';

const S = { shop_rate: 140, onsite_rate: 113, pm_rate: 95, cad_rate: 120, pe_rate: 180, freestanding_pv_per_shop_hour: 38.6, one_pct_adder: { on: true }, sales_tax_rate: 0.07, banned_strings: [] as string[] };

function price(spec: FreestandingSpec) {
  const r = buildFreestanding(spec, testCatalog);
  const shop = r.lines.filter(l => l.kind === 'shop_labor').reduce((a, l) => a + l.qty, 0);
  const p = priceManual({ family: 'freestanding', lines: r.lines, outboundFreight: r.outboundFreight, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false,
    suggestedInstallHours: r.suggestedInstallHours, freestandingShopHours: shop, pvPerHourOverride: null, wording: r.wording, options: [] }, S);
  return { r, p };
}

// Sold SMT freestanding jobs, spec'd the way a rep would say them. Sold base / install from each fixture's Main Summary.
const SOLD: { job: string; base: number; install: number; spec: FreestandingSpec }[] = [
  { job: '29140', base: 82134, install: 0, spec: { series: 'M', runwayOalFt: 80, spanFt: 37, capacityTons: 2, hookHeightFt: 13.58, bridgeDrive: 'motorized', voltage: '208V/3', control: 'radio', collisionAvoidance: true, install: false, miles: 616 } },
  { job: '29213', base: 33202, install: 17809, spec: { series: 'GM', runwayOalFt: 20.67, spanFt: 7.29, capacityTons: 1, hookHeightFt: 8, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 660 } },
  { job: '29354', base: 154189, install: 33015, spec: { series: 'GM', runwayOalFt: 124, spanFt: 43.5, capacityTons: 10, hookHeightFt: 15, liftFt: 26, columnsPerSystem: 12, bridgeDrive: 'motorized', voltage: '460V/3', asceRail: true, install: true, miles: 733 } },
  { job: '29331', base: 443029, install: 80150, spec: { series: 'GM', runwayOalFt: 384, spanFt: 50, capacityTons: 10, hookHeightFt: 19.5, liftFt: 20, columnsPerSystem: 30, bridgesPerSystem: 2, bridgeDrive: 'motorized', voltage: '460V/3', collisionAvoidance: true, asceRail: true, install: true, miles: 1101 } },
];

describe('freestanding builder v2 vs sold jobs', () => {
  const rows = SOLD.map(c => { const { r, p } = price(c.spec); return { c, r, base: p.rollup.basePrice, install: p.rollup.installation }; });
  it('finds every part in the price lists', () => {
    for (const x of rows) expect(x.r.notes.filter(n => /not found|not in/.test(n)), x.c.job).toEqual([]);
  });
  it('base price within ±25% of every sold job, median within 12%', () => {
    const errs = rows.map(x => x.base / x.c.base - 1);
    console.table(rows.map(x => ({ job: x.c.job, built: Math.round(x.base), sold: x.c.base, err: ((x.base / x.c.base - 1) * 100).toFixed(1) + '%',
      install: Math.round(x.install), soldInstall: x.c.install })));
    for (const e of errs) expect(Math.abs(e)).toBeLessThan(0.25);
    const med = [...errs].map(Math.abs).sort((a, b) => a - b)[Math.floor(errs.length / 2)];
    expect(med).toBeLessThan(0.12);
  });
});

describe("Kyle's first real quote (FSTRGM5, 30' × 80', 20' tall, pink columns, Milwaukee)", () => {
  const spec = { series: 'GM', runwayOalFt: 80, spanFt: 30, capacityTons: 5, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', control: 'radio',
    colors: { columns: 'pink', bridge: 'Spark Orange' }, install: true, miles: 165 } as FreestandingSpec;
  const { r, p } = price(spec);
  it("reads 20' as overall height and keeps the system under 20'", () => {
    expect(Number(r.geometry.colLen)).toBeLessThan(20);
    expect(r.assumptions.find(a => a.field === 'heightBasis')?.value).toBe('overall');
  });
  it('adds custom paint, lodging, per diem and a lift', () => {
    const d = r.lines.map(l => l.description).join('\n');
    expect(d).toMatch(/Custom color paint/); expect(d).toMatch(/Hotels/); expect(d).toMatch(/Per diem/); expect(d).toMatch(/Scissor Lift|Boom Lift/);
    expect(r.wording).toMatch(/pink/);
    expect(r.wording).not.toMatch(/Paul/i);
    console.log('Kyle example total', Math.round(p.rollup.quote.total), 'geometry', r.geometry);
  });
});

describe('spec parsing + build', () => {
  it('reads a link, raw JSON, or JSON wrapped in chat text', () => {
    const j = { pwi_quote: 1, items: [{ type: 'freestanding', series: 'M', runwayOalFt: 40, spanFt: 20, capacityTons: 2, overallHeightFt: 16, bridgeDrive: 'manual', voltage: '460V/3', install: false }] };
    const b64 = Buffer.from(JSON.stringify(j)).toString('base64url');
    expect(parseSpec(`https://pwi-quotes.netlify.app/#/new?s=${b64}`).items.length).toBe(1);
    expect(parseSpec('Here you go:\n```json\n' + JSON.stringify(j) + '\n```').items.length).toBe(1);
  });
  it('rebuild replaces auto lines and keeps hand-added ones', () => {
    const j = { pwi_quote: 1, items: [{ type: 'freestanding', series: 'M', runwayOalFt: 40, spanFt: 20, capacityTons: 2, overallHeightFt: 16, bridgeDrive: 'manual', voltage: '460V/3', install: false }] };
    const base = { family: 'other', lines: [{ key: 'h', kind: 'material', category: 'costBased', description: 'hand line', qty: 1, unitSell: 5 }], outboundFreight: 0, preUse: 0, showPreUse: false,
      dealerDiscount: 0, taxOn: false, wording: '', options: [] } as any;
    const once = buildFromSpec(j as any, testCatalog, {}, base);
    const twice = buildFromSpec(j as any, testCatalog, {}, once.doc);
    expect(twice.doc.lines.length).toBe(once.doc.lines.length);
    expect(twice.doc.lines.some(l => l.description === 'hand line')).toBe(true);
  });
});
