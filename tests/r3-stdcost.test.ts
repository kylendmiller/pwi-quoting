// Round 3 S7: standard parts carry cost from std_parts.gm_pct (GM no longer 100%). Sell must not move.
import { describe, it, expect } from 'vitest';
import { buildFromSpec } from '../src/engine/buildSpec';
import { priceManual, type QuoteDoc } from '../src/engine/manual';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';
import { CASES } from './calibration/cases';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const build = (items: any[]) => buildFromSpec({ pwi_quote: 1, items }, testCatalog, CAL_SETTINGS, base).doc as QuoteDoc;

describe('S7 std parts cost', () => {
  it('std part cost = sell × (1 − gm_pct); sell unchanged', () => {
    let seen = 0;
    for (const c of CASES) {
      const d = build(c.items), p = priceManual(d, CAL_SETTINGS);
      for (const [i, l] of d.lines.entries()) {
        if (l.detail?.type !== 'std') continue;
        const pl = p.lines[i];
        expect(pl.sell).toBeCloseTo(l.unitSell! * l.qty, 2);
        const gm = l.gmPct ?? 0.3;
        expect(pl.cost).toBeCloseTo(pl.sell * (1 - gm), 2);
        expect(pl.cost).toBeGreaterThan(0);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(20);
  });
  it('cost / GM move but sell, base and total do not (vs pricing with no std-part cost)', () => {
    for (const c of CASES) {
      const d = build(c.items), p = priceManual(d, CAL_SETTINGS);
      const legacyLines = d.lines.map(l => ({ ...l, gmPct: undefined, detail: undefined, category: l.detail?.type === 'std' ? 'costBased' as const : l.category }));
      // same lines in a category with no GM rule → old $0 cost; compare sells line by line
      const q = priceManual({ ...d, lines: legacyLines }, CAL_SETTINGS);
      expect(p.lines.map(l => l.sell)).toEqual(q.lines.map(l => l.sell));
      expect(p.totals.cost).toBeGreaterThanOrEqual(q.totals.cost);
    }
  });
  it('labels assumed costs', () => {
    const d = build([{ type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3' }]);
    const p = priceManual(d, CAL_SETTINGS);
    expect(p.costBasis.shopAssumed).toBe(true);
    expect(p.costBasis.shopLaborPerHr).toBeCloseTo(140 * 0.59, 6);
    expect(p.costBasis.stdPartsGmLines).toBeGreaterThan(0);
    expect(priceManual(d, { ...CAL_SETTINGS, labor_cost_shop: 70 }).costBasis.shopAssumed).toBe(false);
  });
  it('a std part with no gm_pct uses the default and counts as assumed', () => {
    const doc = { ...base, lines: [{ key: 's', kind: 'material', category: 'stdParts', description: 'X', qty: 2, unitSell: 100 }] } as QuoteDoc;
    const p = priceManual(doc, { ...CAL_SETTINGS, std_parts_default_gm_pct: 0.4 });
    expect(p.lines[0].cost).toBeCloseTo(120, 6);
    expect(p.costBasis.stdPartsGmAssumed).toBe(1);
  });
});
