// Round 3 S9: one rounding rule — the customer price block is rounded once; total = sum of the rounded parts.
import { describe, it, expect } from 'vitest';
import { buildFromSpec } from '../src/engine/buildSpec';
import { priceManual, type QuoteDoc } from '../src/engine/manual';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';
import { CASES } from './calibration/cases';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: true, wording: '', options: [] };
const c = (x: number) => Math.round(x * 100);
describe('S9 rounding', () => {
  it('every part is whole cents, total is exactly their sum, and within a cent of the unrounded rollup', () => {
    for (const k of CASES) for (const disc of [0, 0.07]) {
      const d = { ...buildFromSpec({ pwi_quote: 1, items: k.items }, testCatalog, CAL_SETTINGS, base).doc, dealerDiscount: disc, preUse: 123.456, showPreUse: true } as QuoteDoc;
      const p = priceManual(d, CAL_SETTINGS), q = p.quote;
      for (const v of Object.values(q)) expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
      expect(c(q.total)).toBe(c(q.base) + c(q.installation) + c(q.freight) + c(q.preUse) + c(q.tax));
      expect(Math.abs(q.total - p.rollup.quote.total)).toBeLessThanOrEqual(0.03);
      expect(q.base).toBe(Math.round(p.rollup.quote.base * 100) / 100);
    }
  });
});
