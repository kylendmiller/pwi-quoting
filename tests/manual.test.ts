import { sendChecklist } from '../src/engine/checklist';
import { describe, it, expect } from 'vitest';
import { priceManual, sendBlocked, type QuoteDoc, type Settings } from '../src/engine/manual';

const S: Settings = { shop_rate: 140, onsite_rate: 113, pm_rate: 95, cad_rate: 120, pe_rate: 180, freestanding_pv_per_shop_hour: 38.6,
  one_pct_adder: { on: true }, sales_tax_rate: 0.07, banned_strings: ["Paul's Welding"] };
const base: QuoteDoc = { family: 'freestanding', outboundFreight: 960, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false,
  suggestedInstallHours: 100, freestandingShopHours: 65.5, pvPerHourOverride: null, options: [],
  wording: '(1) FSTRM2 CRANE SYSTEM\nRunway OAL: 60\'', lines: [
    { key: 'a', kind: 'material', category: 'structural', description: 'Runway W12x26', qty: 2, unitCost: 1000, markupPct: 26 },
    { key: 'b', kind: 'shop_labor', category: 'shopLabor', description: 'Fab', qty: 65.5, laborOp: 'shop_other' },
    { key: 'c', kind: 'site_labor', category: 'onsiteLabor', description: 'Install', qty: 100, laborOp: 'site_other' },
  ] };

describe('manual-mode pricing', () => {
  it('prices lines, PV adder and the price block', () => {
    const p = priceManual(base, S);
    expect(p.lines[0].sell).toBe(2520);
    expect(p.totals.productionValue).toBe(2528.3);           // 65.5 × 38.60
    // base = (2520 + 9170 shop + 2528.30 PV) × 1.01
    expect(p.rollup.basePrice).toBeCloseTo((2520 + 65.5 * 140 + 2528.3) * 1.01, 6);
    expect(p.rollup.installation).toBeCloseTo(100 * 113 * 1.01, 6);
    expect(p.flags).toEqual([]);
  });
  it('flags install below suggested and blocks send until approved', () => {
    const d0 = { ...base, lines: base.lines.map(l => l.key === 'c' ? { ...l, qty: 80 } : l) };
    const p = priceManual({ ...d0, checklist: Object.fromEntries(sendChecklist(d0 as any).map(i => [i.key, { at: 'now' }])) } as any, S);
    expect(p.flags.map(f => f.rule)).toEqual(['INSTALL_BELOW_SUGGESTED']);
    expect(sendBlocked(p, [])).toBe(true);
    expect(sendBlocked(p, ['INSTALL_BELOW_SUGGESTED'])).toBe(false);
  });
  it('lint blocks placeholders, OR choices, banned text and bad mezz capacity', () => {
    const p = priceManual({ ...base, wording: "xx' x ? Ton runway OR bolted\nPaul's Welding\n35 psf T.L. / 125 psf L.L." }, S);
    expect(p.lint.filter(l => l.level === 'error' && !/checklist/.test(l.message)).length).toBe(4);
  });
  it('requires a reason on Site Difficulty Allowance', () => {
    const p = priceManual({ ...base, lines: [...base.lines, { key: 'd', kind: 'site_labor', category: 'onsiteLabor', description: 'Site difficulty', qty: 20, laborOp: 'site_difficulty' }] }, S);
    expect(p.lint.some(l => l.message.includes('reason'))).toBe(true);
  });
  it('the "before you send" checklist blocks sending until every item is ticked', () => {
    const items = sendChecklist(base as any);
    expect(items.map(i => i.key)).toEqual(expect.arrayContaining(['onsite', 'install', 'freight']));
    expect(priceManual(base, S).lint.some(l => /checklist/.test(l.message))).toBe(true);
    const ticked = { ...base, checklist: Object.fromEntries(items.map(i => [i.key, { at: 'now' }])) } as any;
    expect(priceManual(ticked, S).lint.some(l => /checklist/.test(l.message))).toBe(false);
  });
});
