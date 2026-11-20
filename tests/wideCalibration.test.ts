// Wide calibration guard (round 3): the 91-job tuning set of sold PWI jobs (tests/calibration/wide_fixture.json) is
// rebuilt with today's engine and compared with its sold base @ today's prices. The test fails if any family's mean
// |gap| gets worse by more than 1 point than the committed baseline (tests/golden/wide_baseline.json).
// Re-baseline only on purpose, after a tuning change documented in docs/round3/TUNING.md:
//   WIDECAL_WRITE=1 npx vitest run tests/wideCalibration.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildFromSpec } from '../src/engine/buildSpec';
import { priceManual } from '../src/engine/manual';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';

const FIX = 'tests/calibration/wide_fixture.json', BASE = 'tests/golden/wide_baseline.json';
const TOL = 1;   // points of mean |gap| a family may worsen before the test fails
interface Job { job: string; family: string; items: any[]; soldBaseToday: number; passThrough: number }
const empty: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };

/** Gap % = (built base + sold pass-through) ÷ sold base @ today's prices − 1 (same as runner/wide.ts and the harness). */
export function wideGap(j: Job): number {
  const b = buildFromSpec({ pwi_quote: 1, items: j.items }, testCatalog, CAL_SETTINGS, empty);
  const shop = b.doc.lines.filter(l => l.kind === 'shop_labor' && l.family === 'freestanding').reduce((a, l) => a + l.qty, 0);
  const p = priceManual({ ...b.doc, freestandingShopHours: shop, pvPerHourOverride: null } as any, CAL_SETTINGS);
  return ((p.rollup.basePrice + j.passThrough) / j.soldBaseToday - 1) * 100;
}
const r1 = (x: number) => Math.round(x * 100) / 100;
function stats(g: number[]) {
  const a = g.map(Math.abs), s = [...g].sort((x, y) => x - y), n = g.length;
  return { n, meanAbsGap: r1(a.reduce((x, y) => x + y, 0) / n), meanGap: r1(g.reduce((x, y) => x + y, 0) / n), medianGap: r1(n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2),
    within5: r1(a.filter(x => x <= 5).length / n), within10: r1(a.filter(x => x <= 10).length / n) };
}

describe('wide calibration vs sold jobs (tuning set)', () => {
  const jobs: Job[] = JSON.parse(readFileSync(FIX, 'utf8')).jobs;
  const gaps = jobs.map(j => ({ job: j.job, family: j.family, gap: wideGap(j) }));
  const fams = [...new Set(gaps.map(g => g.family))].sort();
  const now = Object.fromEntries([...fams.map(f => [f, stats(gaps.filter(g => g.family === f).map(g => g.gap))]), ['all', stats(gaps.map(g => g.gap))]]);
  it('every job builds', () => expect(gaps.filter(g => !Number.isFinite(g.gap)).map(g => g.job)).toEqual([]));
  if (process.env.WIDECAL_WRITE || !existsSync(BASE)) {
    it('writes the baseline', () => {
      writeFileSync(BASE, JSON.stringify({ _about: `Per-family stats on ${FIX}; regenerate with WIDECAL_WRITE=1 only after a documented tuning change.`, families: now,
        jobs: Object.fromEntries(gaps.map(g => [g.job, r1(g.gap)])) }, null, 1) + '\n');
    });
  } else {
    const was = JSON.parse(readFileSync(BASE, 'utf8'));
    for (const f of Object.keys(was.families)) it(`${f}: mean |gap| no worse than baseline + ${TOL} pt`, () => {
      expect(now[f], `family ${f} missing`).toBeTruthy();
      expect(now[f].n).toBe(was.families[f].n);
      expect(now[f].meanAbsGap).toBeLessThanOrEqual(was.families[f].meanAbsGap + TOL);
    });
  }
});

import { shopTaper } from '../src/engine/kit';
describe('round 3 tuning rules', () => {
  it('crane shop size taper: 1 to $100k material, 0.80 from $200k, cranes only', () => {
    expect(shopTaper('freestanding', 80_000)).toBe(1);
    expect(shopTaper('bridge', 150_000)).toBe(0.9);
    expect(shopTaper('bridge', 500_000)).toBe(0.8);
    expect(shopTaper('gantry', 500_000)).toBe(1);
    expect(shopTaper('mezzanine', 500_000)).toBe(1);
  });
  it('mezzanine guardrail default is 90% of perimeter less openings; a stated guardrailFt wins', () => {
    const rail = (it: any) => buildFromSpec({ pwi_quote: 1, items: [{ type: 'mezzanine', lengthFt: 30, widthFt: 20, deckHeightFt: 10, ...it }] }, testCatalog, CAL_SETTINGS, empty)
      .doc.lines.find(l => /guardrail/.test(l.description))!.qty;
    expect(rail({})).toBe(90);
    expect(rail({ stairs: 1, stairPrice: 5000 })).toBe(86);
    expect(rail({ guardrailFt: 40 })).toBe(40);
  });
});
