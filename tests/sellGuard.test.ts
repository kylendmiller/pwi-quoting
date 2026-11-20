// Round 3 S: sell-price fingerprint. Every calibration job plus a set of installed / multi-item specs is built,
// given the freestanding production-value hours the way the app has always done it, and priced. Every line's
// priced fields and the customer price block must match tests/golden/sell_fingerprint.json to the cent.
// Cost / GM may move (S7 std-part cost), sell may not. Regenerate only on purpose: SELLGUARD_WRITE=1 npx vitest run tests/sellGuard.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildFromSpec } from '../src/engine/buildSpec';
import { priceManual, type QuoteDoc } from '../src/engine/manual';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';
import { CASES } from './calibration/cases';
import { legacyPv } from './r3-helpers';

const FILE = 'tests/golden/sell_fingerprint.json';
const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const EXTRA: [string, any[]][] = [
  ['fstr-installed', [{ type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 }]],
  ['bridge-installed', [{ type: 'bridge', support: 'building_runway', capacityTons: 3, spanFt: 40, runwayOalFt: 100, overallHeightFt: 22, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 250 }]],
  ['multi-installed', [{ type: 'freestanding', capacityTons: 2, spanFt: 20, runwayOalFt: 40, overallHeightFt: 16, install: true, miles: 300 },
    { type: 'mezzanine', lengthFt: 40, widthFt: 30, deckHeightFt: 12, stairs: 1, install: true, miles: 300 }, { type: 'jib', capacityTons: 1, spanFt: 12, overallHeightFt: 14, install: true, miles: 300 }]],
  ['gantry-fly', [{ type: 'gantry', capacityTons: 3, spanFt: 20, heightUnderBeamFt: 14, install: true, miles: 1600 }]],
  ['monorail-local', [{ type: 'monorail', capacityTons: 2, lengthFt: 60, overallHeightFt: 16, install: true, miles: 20 }]],
  ['wp-vrc-fp', [{ type: 'work_platform', lengthFt: 40, widthFt: 4 }, { type: 'vrc', model: 'PWSD0606', install: true, miles: 100 }, { type: 'fall_protection', lengthFt: 120 }]],
];
const ALL: [string, any[]][] = [...CASES.map(c => [c.job, c.items] as [string, any[]]), ...EXTRA];

const c2 = (x: number) => Math.round(x * 100) / 100;

function fingerprint(items: any[]) {
  const b = buildFromSpec({ pwi_quote: 1, items }, testCatalog, CAL_SETTINGS, base);
  const doc = { ...b.doc, freestandingShopHours: legacyPv(b.doc) } as QuoteDoc;
  const p = priceManual(doc, CAL_SETTINGS);
  const q = p.rollup.quote;
  return {
    lines: p.lines.map(l => [l.kind, l.category, l.description, l.qty, l.unitCost ?? null, l.markupPct ?? null, l.unitSell ?? null, c2(l.sell)]),
    quote: [c2(q.base), c2(q.installation), c2(q.freight), c2(q.preUse ?? 0), c2(q.tax), c2(q.total)],
    sell: p.totals.sell, pv: p.totals.productionValue, installHours: Math.round(p.totals.installHours * 10) / 10, suggested: doc.suggestedInstallHours ?? null,
  };
}

describe('sell prices of unedited auto-built quotes do not move', () => {
  const now = Object.fromEntries(ALL.map(([k, items]) => [k, fingerprint(items)]));
  if (process.env.SELLGUARD_WRITE || !existsSync(FILE)) {
    it('writes the fingerprint', () => { writeFileSync(FILE, JSON.stringify(now, null, 0).replace(/\],"/g, '],\n"') + '\n'); });
  } else {
    const was = JSON.parse(readFileSync(FILE, 'utf8'));
    for (const [k] of ALL) it(k, () => expect(now[k]).toEqual(was[k]));
  }
});
