// Edge cases for every builder: smallest and largest sizes the builder accepts, ship-only vs installed,
// a missing required field (must come back as a blocker, never a thrown error), and 3+ installed items
// sharing one trip.
import { describe, it, expect } from 'vitest';
import { buildFromSpec, BUILDERS } from '../src/engine/buildSpec';
import { priceManual } from '../src/engine/manual';
import { describe as describeItem } from '../app/src/model';
import { testCatalog } from './catalog';

const S = { shop_rate: 140, onsite_rate: 113, pm_rate: 95, cad_rate: 120, pe_rate: 180, freestanding_pv_per_shop_hour: 38.6, one_pct_adder: { on: true }, sales_tax_rate: 0.07, banned_strings: [] as string[] };
const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const run = (items: any[]) => {
  const b = buildFromSpec({ pwi_quote: 1, items }, testCatalog, {}, base);
  const p = priceManual(b.doc as any, S);
  return { ...b, p, base: p.rollup.basePrice, install: p.rollup.installation };
};

// [builder, smallest spec, largest spec, required field to drop]
const SIZES: [string, any, any, string][] = [
  ['freestanding', { capacityTons: 0.25, spanFt: 5, runwayOalFt: 8, overallHeightFt: 8, bridgeDrive: 'manual', voltage: '460V/3' },
    { capacityTons: 10, spanFt: 60, runwayOalFt: 600, overallHeightFt: 45, bridgeDrive: 'motorized', voltage: '460V/3', systems: 2, bridgesPerSystem: 2 }, 'spanFt'],
  ['bridge', { support: 'bridge_only', capacityTons: 0.25, spanFt: 5, bridgeDrive: 'manual', voltage: '460V/3' },
    { support: 'crane_columns', capacityTons: 20, spanFt: 80, runwayOalFt: 600, overallHeightFt: 45, motorized: true, voltage: '460V/3' }, 'capacityTons'],
  ['gantry', { capacityTons: 0.25, spanFt: 6, heightUnderBeamFt: 6, motorized: false }, { capacityTons: 10, spanFt: 65, heightUnderBeamFt: 30, hoists: 3, qty: 3 }, 'spanFt'],
  ['monorail', { capacityTons: 0.125, lengthFt: 6, overallHeightFt: 7 }, { capacityTons: 10, lengthFt: 600, overallHeightFt: 40, systems: 3, hoists: 6 }, 'lengthFt'],
  ['mezzanine', { lengthFt: 6, widthFt: 6, deckHeightFt: 4, stairs: 0 }, { lengthFt: 400, widthFt: 300, deckHeightFt: 30, liveLoadPsf: 250, stairs: 2, stairPrice: 9000 }, 'deckHeightFt'],
  ['work_platform', { lengthFt: 20, widthFt: 2 }, { lengthFt: 90, widthFt: 10, sets: 3, tallestUnitFt: 20, crosswalks: { standard: 2, expandable: 2, expandedLengthFt: 12 }, camGateFrontFt: 30, camGateRearFt: 20, endExtensions: 4, fingerRackFt: 50, ladder: true }, 'lengthFt'],
  ['jib', { capacityTons: 0.125, spanFt: 4, overallHeightFt: 6 }, { capacityTons: 5, spanFt: 30, overallHeightFt: 30, qty: 4 }, 'capacityTons'],
  ['fall_protection', { lengthFt: 10 }, { lengthFt: 400, systems: 3, supportSpacingFt: 30, people: 2 }, 'lengthFt'],
  ['vrc', { model: 'PWSD0606' }, { model: 'PWSD0606', qty: 3, hdColumns: true }, 'model'],
  ['catalog', { item: 'GS1000O-1012', unitPrice: 100 }, { item: 'GS1000O-1012', unitPrice: 6140, qty: 500 }, 'item'],
];

describe('every builder at its size limits', () => {
  it('covers every builder in BUILDERS', () => expect(SIZES.map(s => s[0]).sort()).toEqual(Object.keys(BUILDERS).sort()));
  for (const [type, lo, hi] of SIZES) {
    for (const [label, spec] of [['smallest', lo], ['largest', hi]] as const) it(`${type} — ${label}`, () => {
      const r = run([{ type, ...spec, install: false }]);
      expect(r.blockers.filter(b => /outside|Missing|Unknown|crash|undefined|NaN/.test(b)), JSON.stringify(r.blockers)).toEqual([]);
      expect(r.doc.lines.length).toBeGreaterThan(0);
      expect(Number.isFinite(r.base) && r.base > 0).toBe(true);
      expect(r.doc.lines.every(l => Number.isFinite(l.qty) && l.qty >= 0 && Number.isFinite(l.unitCost ?? l.unitSell ?? 0))).toBe(true);
      expect(describeItem({ type, ...spec, install: false })).not.toMatch(/undefined|NaN/);
    });
  }
  it('one past the limit is a blocker, not a crash', () => {
    for (const [type, , hi, field] of SIZES) {
      if (typeof hi[field] !== 'number') continue;
      const r = run([{ type, ...hi, [field]: hi[field] * 10, install: false }]);
      expect(r.blockers.length, type).toBeGreaterThan(0);
    }
  });
});

describe('ship only vs installed', () => {
  for (const [type, lo] of SIZES) {
    if (type === 'catalog') continue;
    it(type, () => {
      const ship = run([{ type, ...lo, install: false }]), inst = run([{ type, ...lo, install: true, miles: 300 }]);
      expect(ship.install).toBe(0);
      expect(ship.doc.lines.some(l => l.kind === 'site_labor')).toBe(false);
      expect(inst.install).toBeGreaterThan(0);
      expect(inst.doc.lines.some(l => l.kind === 'site_labor')).toBe(true);
      expect(inst.doc.wording).toMatch(/Install/i);
      expect(ship.doc.wording).toMatch(/Ship only|by others|Ship/i);
    });
  }
  it('installed without miles is a blocker', () => {
    for (const [type, lo] of SIZES) {
      if (type === 'catalog' || type === 'vrc') continue;
      expect(run([{ type, ...lo, install: true }]).blockers.join(' '), type).toMatch(/miles/);
    }
  });
});

describe('missing or bad fields come back as blockers, never thrown errors', () => {
  for (const [type, lo, , field] of SIZES) it(`${type} without ${field}`, () => {
    const spec = { type, ...lo, install: false }; delete (spec as any)[field];
    let r: ReturnType<typeof run> | undefined;
    expect(() => { r = run([spec]); }).not.toThrow();
    expect(r!.blockers.length).toBeGreaterThan(0);
    expect(r!.blockers.join(' ')).not.toMatch(/Cannot read|undefined|is not a function/);
  });
  it('wrong types and junk values', () => {
    for (const [type, lo] of SIZES) for (const bad of [{ capacityTons: 'two' }, { spanFt: -5 }, { lengthFt: NaN }, { qty: 0 }]) {
      const key = Object.keys(bad)[0];
      if (!(key in lo) && key !== 'qty') continue;
      expect(() => run([{ type, ...lo, ...bad, install: false }]), `${type} ${key}`).not.toThrow();
    }
  });
  it('an empty spec item builds nothing and says why', () => {
    const r = run([{ type: 'freestanding' }]);
    expect(r.blockers.length).toBe(1);
  });
});

describe('shared trip with 3+ installed items', () => {
  const items = [
    { type: 'freestanding', capacityTons: 2, spanFt: 30, runwayOalFt: 60, overallHeightFt: 18, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 450 },
    { type: 'jib', capacityTons: 1, spanFt: 16, overallHeightFt: 16, install: true, miles: 450 },
    { type: 'mezzanine', lengthFt: 30, widthFt: 20, deckHeightFt: 12, install: true, miles: 450 },
    { type: 'work_platform', lengthFt: 51, install: true, miles: 450 },
  ];
  const all = run(items);
  it('prices travel, lodging and equipment once', () => {
    expect(all.notes.some(n => /One shared trip for 4 installed items/.test(n))).toBe(true);
    expect(all.doc.lines.filter(l => /^Travel \(/.test(l.description)).length).toBe(1);
    expect(all.doc.lines.filter(l => /^Hotels/.test(l.description)).length).toBe(1);
    expect(all.doc.lines.filter(l => /Rental delivery/.test(l.description)).length).toBe(1);
  });
  it('is cheaper to install than four separate quotes, with the same materials', () => {
    const sep = items.map(i => run([i]));
    expect(all.install).toBeLessThan(sep.reduce((a, r) => a + r.install, 0));
    expect(Math.abs(all.base - sep.reduce((a, r) => a + r.base, 0))).toBeLessThan(1);
  });
  it('a ship-only item on the same job is left out of the trip', () => {
    const r = run([...items.slice(0, 3), { ...items[3], install: false }]);
    expect(r.notes.some(n => /One shared trip for 3 installed items/.test(n))).toBe(true);
  });
});
