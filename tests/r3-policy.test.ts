// Round 3 S11: manager approval for margin below floor, zero markup on material, discount over 10%; input validation.
import { describe, it, expect } from 'vitest';
import { buildFromSpec } from '../src/engine/buildSpec';
import { priceManual, validateDoc, flags, flagDef, pvHours, type QuoteDoc } from '../src/engine/manual';
import { editLine } from '../src/engine/deriveLine';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';
import { CASES } from './calibration/cases';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const FSTR = { type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 };
const build = (items: any[] = [FSTR]) => { const d = buildFromSpec({ pwi_quote: 1, items }, testCatalog, CAL_SETTINGS, base).doc as QuoteDoc; return { ...d, freestandingShopHours: pvHours(d) }; };
const rules = (d: QuoteDoc, s: any = CAL_SETTINGS) => priceManual(d, s).flags.map(f => f.rule);

describe('S11 policy flags', () => {
  it('the rule list has the required ids', () => {
    expect(flags.map(f => f.id)).toEqual(expect.arrayContaining(['install_below_suggested', 'family_pv_drop', 'min_gm', 'zero_markup', 'big_discount']));
    for (const f of flags) expect(flagDef(f.rule)).toBe(f);
  });
  it('no policy flag on any unedited calibration build', () => {
    for (const c of CASES) expect(rules(build(c.items)).filter(r => ['MIN_GM', 'ZERO_MARKUP', 'BIG_DISCOUNT'].includes(r)), c.job).toEqual([]);
  });
  it('margin below settings.min_gm_pct (default 25%)', () => {
    const d = build();
    expect(rules(d, { ...CAL_SETTINGS, min_gm_pct: 0.99 })).toContain('MIN_GM');
    const cut = { ...d, lines: d.lines.map(l => l.kind === 'material' && l.unitCost != null ? editLine(l, { markupPct: 1 }) : l) };
    const f = priceManual(cut, { ...CAL_SETTINGS, min_gm_pct: 0.3 }).flags.find(x => x.rule === 'MIN_GM')!;
    expect(f.detail.floor).toBe(0.3);
    expect(String(f.detail.gmPct)).toMatch(/^0\.\d{1,3}$/);
    expect(flagDef('MIN_GM')!.explain(f.detail)).toMatch(/below the 30\.0% floor/);
  });
  it('markup 0 on a material line the rep set (auto or hand)', () => {
    const d = build();
    const i = d.lines.findIndex(l => l.role === 'runway');
    const e = { ...d, lines: d.lines.map((l, j) => j === i ? editLine(l, { markupPct: 0 }) : l) };
    const f = priceManual(e, CAL_SETTINGS).flags.find(x => x.rule === 'ZERO_MARKUP')!;
    expect(f.lineKeys).toEqual([d.lines[i].key]);
    const hand = { ...d, lines: [...d.lines, { key: 'h', kind: 'material' as const, category: 'costBased' as const, description: 'Hand', qty: 1, unitCost: 100, markupPct: 0 }] };
    expect(rules(hand)).toContain('ZERO_MARKUP');
    // reorder-independent detail
    expect(priceManual({ ...e, lines: [...e.lines].reverse() }, CAL_SETTINGS).flags.find(x => x.rule === 'ZERO_MARKUP')!.detail).toEqual(f.detail);
  });
  it('discount over 10% (dealer % or credit lines)', () => {
    const d = build();
    expect(rules({ ...d, dealerDiscount: 0.1 })).not.toContain('BIG_DISCOUNT');
    expect(rules({ ...d, dealerDiscount: 0.12 })).toContain('BIG_DISCOUNT');
    const total = priceManual(d, CAL_SETTINGS).lines.reduce((a, l) => a + l.sell, 0);
    const credit = { ...d, lines: [...d.lines, { key: 'disc', kind: 'material' as const, category: 'costBased' as const, description: 'Discount', qty: 1, unitSell: -0.15 * total }] };
    const f = priceManual(credit, CAL_SETTINGS).flags.find(x => x.rule === 'BIG_DISCOUNT')!;
    expect(f.lineKeys).toEqual(['disc']);
    expect(f.detail.pct).toBeCloseTo(0.15, 3);
  });
});

describe('validateDoc (R11)', () => {
  it('accepts every built doc', () => { for (const c of CASES) expect(validateDoc(build(c.items)), c.job).toEqual([]); });
  it('rejects NaN, Infinity, negative qty, unknown kind/category, duplicate keys', () => {
    const d = build();
    const bad = (patch: any, i = 0) => validateDoc({ ...d, lines: d.lines.map((l, j) => j === i ? { ...l, ...patch } : l) });
    expect(bad({ qty: NaN })).not.toEqual([]);
    expect(bad({ qty: -1 })).not.toEqual([]);
    expect(bad({ unitCost: Infinity })).not.toEqual([]);
    expect(bad({ unitCost: null, unitSell: 'x' })).not.toEqual([]);
    expect(bad({ category: 'mystery' })).not.toEqual([]);
    expect(bad({ kind: 'magic' })).not.toEqual([]);
    expect(bad({ markupPct: -150 })).not.toEqual([]);
    expect(bad({ key: d.lines[1].key })).not.toEqual([]);
    expect(validateDoc({ ...d, dealerDiscount: 1.5 })).not.toEqual([]);
    expect(validateDoc(JSON.parse(JSON.stringify({ ...d, lines: [{ ...d.lines[0], qty: 1e400 }] })))).not.toEqual([]);
  });
  it('allows negative unit sell (credit lines)', () => {
    const d = build();
    expect(validateDoc({ ...d, lines: [...d.lines, { key: 'c', kind: 'material', category: 'costBased', description: 'Credit', qty: 1, unitSell: -500 }] })).toEqual([]);
  });
});
