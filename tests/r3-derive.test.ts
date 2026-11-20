// Round 3 S8: deriveLine recomputes a line from its editable detail.
import { describe, it, expect } from 'vitest';
import { buildFromSpec } from '../src/engine/buildSpec';
import { priceManual, type QuoteDoc, type QuoteLine } from '../src/engine/manual';
import { deriveLine, editLine, revertField, lineLb } from '../src/engine/deriveLine';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';
import { CASES } from './calibration/cases';
import SC from '../src/engine/rules/steel_cost.default.json';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const build = (items: any[]) => buildFromSpec({ pwi_quote: 1, items }, testCatalog, CAL_SETTINGS, base).doc as QuoteDoc;
const FSTR = { type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 };
const ctx = { shape: testCatalog.shape, steelCost: SC as any };
const P = ['qty', 'unitCost', 'markupPct', 'unitSell', 'description'] as const;

describe('S8 deriveLine', () => {
  it('is idempotent on every auto line of every calibration job (no edit → same priced fields, no marks)', () => {
    for (const c of CASES) for (const l of build(c.items).lines) {
      const d = deriveLine(l, {}, ctx);
      for (const f of P) expect((d as any)[f], `${c.job} ${l.description} ${f}`).toEqual((l as any)[f]);
      expect(d.edited).toBeUndefined();
    }
  });
  it('steel: new shape and length → lb, cost, description; sell follows at the same markup', () => {
    const doc = build([FSTR]);
    const g = doc.lines.find(l => l.role === 'girder' && l.detail?.type === 'steel')!;
    const n = deriveLine(g, { shape: 'W21 x 44', lengthFt: 42 }, ctx);
    const sh = testCatalog.shape('W21 x 44')!;
    expect(n.detail).toMatchObject({ type: 'steel', shape: 'W21 x 44', lengthFt: 42, lbPerFt: sh.lbPerFt, lbEach: sh.lbPerFt * 42 });
    expect(n.unitCost).toBe(Math.round(sh.lbPerFt * 42 * (n.detail as any).costPerLb * 100) / 100);
    expect(n.description).toMatch(/W21 x 44 × 42'$/);
    expect(n.edited).toMatchObject({ unitCost: g.unitCost, description: g.description });
    expect(n.builtDetail).toEqual(g.detail);
    expect(lineLb(n)).toBeCloseTo(sh.lbPerFt * 42 * n.qty, 6);
    const p = priceManual({ ...doc, lines: [n] }, CAL_SETTINGS);
    expect(p.lines[0].sell).toBeCloseTo(n.unitCost! * n.qty * (1 + n.markupPct! / 100), 2);
    expect(() => deriveLine(g, { shape: 'W99 x 1' }, ctx)).toThrow(/Unknown shape/);
  });
  it('changing back to the builder value clears the marks and restores the built detail', () => {
    const g = build([FSTR]).lines.find(l => l.role === 'girder' && l.detail?.type === 'steel')!;
    const d = g.detail as any;
    const back = deriveLine(deriveLine(g, { lengthFt: d.lengthFt + 2 }, ctx), { lengthFt: d.lengthFt }, ctx);
    expect(back.edited).toBeUndefined();
    expect(back.builtDetail).toBeUndefined();
    expect(back.unitCost).toBe(g.unitCost);
  });
  it('plate t × w × l', () => {
    const pl = build([FSTR]).lines.find(l => l.detail?.type === 'plate')!;
    const n = deriveLine(pl, { tIn: 1 });
    const d = n.detail as any;
    expect(d.lbEach).toBeCloseTo(1 * d.wIn * d.lIn * 0.2833 * d.dropFactor, 9);
    expect(n.description).toMatch(/— 1" × /);
  });
  it('vendor list and discounts → cost and markup', () => {
    const v = build([FSTR]).lines.find(l => l.detail?.type === 'vendor')!;
    const n = deriveLine(v, { list: 1000, pwiDiscPct: 50, customerDiscPct: 5 });
    expect(n.unitCost).toBe(500);
    expect(n.markupPct).toBe(90);
  });
  it('labor: base hours × factor, or hours directly; travel: men × nights', () => {
    const doc = build([FSTR]);
    const sh = doc.lines.find(l => l.detail?.type === 'labor')!;
    expect(deriveLine(sh, { baseHrs: 10, factor: 0.5 }).qty).toBe(5);
    expect(deriveLine(sh, { hours: 7 }).qty).toBe(7);
    const hotel = doc.lines.find(l => l.detail?.type === 'travel' && (l.detail as any).what === 'hotel')!;
    const h = deriveLine(hotel, { men: 2, nights: 3 });
    expect(h.qty).toBe(6);
    expect(h.description).toBe('Hotels — 2 rooms × 3 nights');
  });
  it('hand lines are never marked edited; editLine / revertField', () => {
    const hand: QuoteLine = { key: 'h', kind: 'material', category: 'costBased', description: 'x', qty: 1, unitCost: 10, markupPct: 20 };
    expect(editLine(hand, { qty: 3 }).edited).toBeUndefined();
    const g = build([FSTR]).lines.find(l => l.role === 'girder')!;
    const e = editLine(g, { markupPct: 30 });
    expect(e.edited).toEqual({ markupPct: g.markupPct });
    expect(revertField(e, 'markupPct')).toMatchObject({ markupPct: g.markupPct });
    expect(revertField(e, 'markupPct').edited).toBeUndefined();
  });
  it('rejects non-finite input', () => {
    const g = build([FSTR]).lines.find(l => l.detail?.type === 'steel')!;
    expect(() => deriveLine(g, { lengthFt: NaN })).toThrow();
    expect(() => deriveLine(g, { qty: Infinity })).toThrow();
  });
});
