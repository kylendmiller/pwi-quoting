// Round 3 (C): structured line data (role / item / group / basis / detail) and the SMT-style section tree.
// The data is display-only — tests/calibration.test.ts guards that prices did not move.
import { describe, it, expect } from 'vitest';
import { buildFromSpec, BUILDERS } from '../src/engine/buildSpec';
import { priceManual, type QuoteDoc } from '../src/engine/manual';
import { sectionize } from '../src/engine/sections';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';

const S = { shop_rate: 140, onsite_rate: 113, pm_rate: 95, cad_rate: 120, pe_rate: 180, freestanding_pv_per_shop_hour: 38.6, one_pct_adder: { on: true }, sales_tax_rate: 0.07, banned_strings: [] as string[] };
const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const run = (items: any[], settings: any = S, extra: Partial<QuoteDoc> = {}) => {
  const b = buildFromSpec({ pwi_quote: 1, items }, testCatalog, settings, base);
  const doc = { ...b.doc, ...extra } as QuoteDoc;
  const p = priceManual(doc, S);
  return { doc, p, t: sectionize(doc, p) };
};
const FSTR = { type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 };
const BRIDGE = { type: 'bridge', support: 'building_runway', capacityTons: 3, spanFt: 40, runwayOalFt: 100, overallHeightFt: 22, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 250 };

describe('line data from the builders', () => {
  it('every auto line from every builder has a role and a typed detail', () => {
    const specs: any[] = [FSTR, BRIDGE, { type: 'gantry', capacityTons: 3, spanFt: 20, heightUnderBeamFt: 14 }, { type: 'monorail', capacityTons: 2, lengthFt: 60, overallHeightFt: 16 },
      { type: 'mezzanine', lengthFt: 40, widthFt: 30, deckHeightFt: 12, stairs: 1, stamped: true }, { type: 'work_platform', lengthFt: 40, widthFt: 4 },
      { type: 'jib', capacityTons: 2, spanFt: 16, overallHeightFt: 18 }, { type: 'fall_protection', lengthFt: 120 }, { type: 'vrc', model: 'PWSD0606' },
      { type: 'catalog', item: 'GS1000O-1012', unitPrice: 100, installHours: 6 }];
    expect(new Set(specs.map(s => s.type))).toEqual(new Set(Object.keys(BUILDERS)));
    for (const sp of specs) {
      const { doc } = run([{ install: true, miles: 300, ...sp }]);
      for (const l of doc.lines) {
        expect(l.role, `${sp.type}: ${l.description}`).toBeTruthy();
        expect(l.detail, `${sp.type}: ${l.description}`).toBeTruthy();
        expect(l.item).toBe(0);
        expect(l.group).toMatch(new RegExp(sp.type.replace('_', ' ')));
      }
    }
  });

  it('steel lines carry shape, lb/ft, length, $/lb and price source that reproduce the unit cost', () => {
    const { doc } = run([FSTR], { ...CAL_SETTINGS });
    const steel = doc.lines.filter(l => l.detail?.type === 'steel');
    expect(steel.length).toBeGreaterThan(0);
    for (const l of steel) {
      const d = l.detail as Extract<NonNullable<typeof l.detail>, { type: 'steel' }>;
      expect(l.unitCost).toBeCloseTo(Math.round(d.lbPerFt * d.lengthFt * d.costPerLb * 100) / 100, 2);
      expect(l.description).toContain(d.shape);
      expect(d.costSource).toBe('steel_cost');                // CAL_SETTINGS carries a steel_cost setting
      expect(d.steelCostDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(steel.map(l => l.role)).toEqual(expect.arrayContaining(['column', 'runway', 'girder']));
  });

  it('chart-picked members say which chart and row; calc-sized members carry unity', () => {
    const { doc } = run([BRIDGE]);
    const runway = doc.lines.find(l => l.role === 'runway' && l.detail?.type === 'steel')!;
    expect(runway.basis).toMatchObject({ source: 'chart', chart: 'AQT runway_by_bay', assumption: 'buildingBayFt' });
    expect(runway.basis!.row).toMatch(/t column × bay ≤/);
    const girder = doc.lines.find(l => l.role === 'girder')!;
    expect(girder.basis?.chart).toMatch(/PWI bridge chart|AQT girder/);

    const mz = run([{ type: 'mezzanine', lengthFt: 40, widthFt: 30, deckHeightFt: 12 }]).doc;
    for (const r of ['header', 'crossmember'] as const) {
      const b = mz.lines.find(l => l.role === r)!.basis!;
      expect(b.source).toBe('calc');
      expect(b.unity).toBeGreaterThan(0); expect(b.unity).toBeLessThanOrEqual(1);
      expect(b.checks!.map(c => c.name).join()).toMatch(/deflection L\/360.*bending/);
    }
    const box = run([{ type: 'bridge', support: 'bridge_only', spanFt: 70, capacityTons: 10, bridgeDrive: 'motorized', voltage: '460V/3', install: false }]).doc.lines.find(l => /box girder/i.test(l.description))!;
    expect(box.detail?.type).toBe('box'); expect(box.basis?.unity).toBeGreaterThan(0.5); expect(box.basis?.flag).toMatch(/engineering/);
  });

  it('labor lines say the op, base hours, factor and SMT Labor row', () => {
    const { doc } = run([FSTR]);
    const shop = doc.lines.filter(l => l.kind === 'shop_labor');
    for (const l of shop) {
      const d = l.detail as any;
      expect(d.type).toBe('labor'); expect(d.factorName).toBe('production');
      expect(l.qty).toBeCloseTo(Math.round(d.baseHrs * d.factor * 10) / 10, 5);
    }
    expect(shop.find(l => l.description === 'Handling / shipping')!.detail).toMatchObject({ smtRow: 'Labor A18 Suggested Handling Hours' });
    const hotel = doc.lines.find(l => l.role === 'lodging')!.detail as any;
    expect(hotel).toMatchObject({ type: 'travel', what: 'hotel', mode: 'drive', miles: 400 });
    expect(hotel.men * hotel.nights).toBe(doc.lines.find(l => l.role === 'lodging')!.qty);
    const vend = doc.lines.find(l => l.role === 'hoist')!.detail as any;
    expect(vend).toMatchObject({ type: 'vendor', vendor: 'Starke', pwiDiscPct: 50, customerDiscPct: 5 });
  });
});

describe('sectionize', () => {
  it('puts every priced line in exactly one SMT section and reconciles to the quote total', () => {
    const { p, t } = run([FSTR], CAL_SETTINGS, { freestandingShopHours: 120 });
    const keys = t.sections.flatMap(s => s.lines.map(l => l.key));
    expect(keys.filter(k => k !== 'production-value').sort()).toEqual(p.lines.map(l => l.key).sort());
    expect(new Set(keys).size).toBe(keys.length);
    expect(t.sections.map(s => s.key)).toEqual(['structural', 'plate', 'stdParts', 'vendor', 'costBased', 'paint', 'shopLabor', 'pmCad', 'install', 'travel', 'equipment']);
    const sum = t.sections.reduce((a, s) => a + s.totals.sell, 0);
    expect(sum).toBeCloseTo(p.lines.reduce((a, l) => a + l.sell, 0) + p.totals.productionValue, 1);
    expect(Math.abs(t.reconcile.diff)).toBeLessThan(0.05);
    expect(t.reconcile.basePrice).toBeCloseTo(p.rollup.basePrice, 1);
    expect(t.reconcile.installation).toBeCloseTo(p.rollup.installation, 1);
    expect(t.sections.find(s => s.key === 'costBased')!.lines.some(l => l.synthetic)).toBe(true);
    expect(t.sections.find(s => s.key === 'travel')!.bucket).toBe('installation');
  });

  it('subtotals: cost, sell, margin, hours and lb roll up from the lines', () => {
    const { p, t } = run([FSTR]);
    const st = t.sections.find(s => s.key === 'structural')!;
    expect(st.totals.lb).toBe(Math.round(st.lines.reduce((a, l) => a + (l.lb ?? 0), 0)));
    expect(st.totals.lb).toBeGreaterThan(1000);
    expect(st.totals.margin).toBeCloseTo(st.totals.sell - st.totals.cost, 1);
    expect(t.sections.find(s => s.key === 'shopLabor')!.totals.hours).toBeCloseTo(p.totals.shopHours, 1);
    expect(t.totals.lb).toBe(Math.round(t.sections.reduce((a, s) => a + s.lines.reduce((b, l) => b + (l.lb ?? 0), 0), 0)));
  });

  it('structural members: "what beams were used" by role and shape', () => {
    const { t } = run([FSTR]);
    const m = t.sections.find(s => s.key === 'structural')!.members!;
    const runway = m.find(x => x.role === 'runway')!;
    expect(runway.size).toMatch(/^W\d+ x \d+/);
    expect(runway.pieces).toBeGreaterThan(0);
    expect(runway.totalFt).toBeCloseTo(runway.pieces * runway.lengthsFt[0], 1);
    expect(runway.basis?.chart).toBe('AQT runway_by_bay');
    expect(m.map(x => x.role)).toEqual(expect.arrayContaining(['column', 'runway', 'girder']));
    expect(t.sections.find(s => s.key === 'plate')!.members!.some(x => x.role === 'base_plate')).toBe(true);
  });

  it('resolves the assumption a line hangs on', () => {
    const { t } = run([BRIDGE]);
    const g = t.sections.find(s => s.key === 'structural')!.lines.find(l => l.role === 'girder')!;
    expect(g.assumption?.field).toBe('girder');
    expect(String(g.assumption?.value)).toContain(g.detail!.type === 'steel' ? (g.detail as any).shape : '');
  });

  it('multi-item job: lines grouped by item, shared trip is item −1', () => {
    const { t } = run([{ ...FSTR, tag: 'Bay A' }, { type: 'jib', capacityTons: 1, spanFt: 12, overallHeightFt: 14, install: true, miles: 400 }]);
    expect(t.items.map(i => i.group)).toEqual(['Shared trip (2 installed items)', 'Item 1 (Bay A) — freestanding', 'Item 2 — jib']);
    expect(t.items[0].item).toBe(-1);
    const travel = t.sections.find(s => s.key === 'travel')!;
    expect(travel.lines.every(l => l.item === -1)).toBe(true);
    const st = t.sections.find(s => s.key === 'structural')!;
    expect(st.byItem!.map(b => b.item)).toEqual([0, 1]);
    expect(st.byItem!.reduce((a, b) => a + b.totals.sell, 0)).toBeCloseTo(st.totals.sell, 1);
    expect(t.items.reduce((a, i) => a + i.totals.sell, 0)).toBeCloseTo(t.totals.sell, 1);
  });

  it('flags hand edits and keeps hand-typed lines (no detail) in their section', () => {
    const { doc } = run([FSTR]);
    const lines = doc.lines.map(l => l.description === 'Cut list' ? { ...l, qty: l.qty + 5 } : l);
    lines.push({ key: 'hand1', kind: 'material', category: 'structural', description: 'Extra angle by hand', qty: 2, unitCost: 50, markupPct: 26 });
    const d2 = { ...doc, lines } as QuoteDoc, p2 = priceManual(d2, S), t2 = sectionize(d2, p2);
    expect(t2.review.find(r => r.description === 'Cut list')?.reason).toMatch(/Hours edited/);
    const hand = t2.sections.find(s => s.key === 'structural')!.lines.find(l => l.key === 'hand1')!;
    expect(hand.auto).toBe(false); expect(hand.detail).toBeUndefined(); expect(hand.sell).toBeCloseTo(126, 2);
    expect(t2.items.some(i => i.group === 'Added by hand')).toBe(true);
  });

  it('works on a manual quote with no builder data at all', () => {
    const doc = { ...base, lines: [{ key: 'a', kind: 'shop_labor', category: 'shopLabor', description: 'Fab', qty: 10 }, { key: 'b', kind: 'material', category: 'vendor', description: 'Hoist', qty: 1, unitCost: 1000, markupPct: 30 }] } as QuoteDoc;
    const p = priceManual(doc, S), t = sectionize(doc, p);
    expect(t.sections.map(s => s.key)).toEqual(['vendor', 'shopLabor']);
    expect(t.totals.hours).toBe(10);
    expect(Math.abs(t.reconcile.diff)).toBeLessThan(0.05);
    expect(sectionize(doc, p, { includeEmpty: true }).sections).toHaveLength(12);
  });
});
