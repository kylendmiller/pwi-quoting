// Round 3 S2: production value / family comes from the spec; a family switch that lowers PV raises a flag.
import { describe, it, expect } from 'vitest';
import { buildFromSpec } from '../src/engine/buildSpec';
import { priceManual, deriveFamily, pvHours, type QuoteDoc } from '../src/engine/manual';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';
import { legacyPv } from './r3-helpers';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const FSTR = { type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 };
const build = (items: any[]) => buildFromSpec({ pwi_quote: 1, items }, testCatalog, CAL_SETTINGS, base).doc as QuoteDoc;
/** What the server does on save. */
const serverSide = (d: QuoteDoc): QuoteDoc => { const x = { ...d }; x.family = deriveFamily(x); x.freestandingShopHours = pvHours(x); return x; };

describe('S2 production value and family', () => {
  it('server PV hours equal what the app always sent for unedited builds', () => {
    for (const items of [[FSTR], [{ type: 'bridge', capacityTons: 3, spanFt: 40, runwayOalFt: 100, overallHeightFt: 22, bridgeDrive: 'motorized' }],
      [FSTR, { type: 'mezzanine', lengthFt: 40, widthFt: 30, deckHeightFt: 12 }], [{ type: 'mezzanine', lengthFt: 40, widthFt: 30, deckHeightFt: 12 }, FSTR]]) {
      const d = build(items);
      expect(d.blockers).toEqual([]);
      expect(pvHours(d)).toBe(legacyPv(d));
      expect(deriveFamily(d)).toBe(d.family);
    }
  });
  it('switching the family dropdown away from freestanding does not drop PV on the server', () => {
    const d = { ...build([FSTR]), family: 'bridge' };
    const s = serverSide(d);
    expect(s.family).toBe('freestanding');
    const p = priceManual(s, CAL_SETTINGS);
    expect(p.totals.productionValue).toBeGreaterThan(0);
    expect(p.flags.map(f => f.rule)).not.toContain('FAMILY_PV_DROP');
  });
  it('a PV drop in the browser (family switched, PV hours zeroed) is flagged, not silent', () => {
    const d = { ...build([FSTR]), family: 'bridge', freestandingShopHours: 0 };
    const f = priceManual(d, CAL_SETTINGS).flags.find(x => x.rule === 'FAMILY_PV_DROP')!;
    expect(f).toBeTruthy();
    expect(f.detail.used).toBe(0);
    expect(f.detail.expected).toBeGreaterThan(0);
  });
  it('no spec: freestanding-built shop lines on a non-freestanding quote flag', () => {
    const d = { ...build([FSTR]), spec: undefined, family: 'other', freestandingShopHours: 0 };
    expect(priceManual(d, CAL_SETTINGS).flags.map(f => f.rule)).toContain('FAMILY_PV_DROP');
  });
  it('a correctly saved freestanding quote has no PV flag', () => {
    expect(priceManual(serverSide(build([FSTR])), CAL_SETTINGS).flags.map(f => f.rule)).not.toContain('FAMILY_PV_DROP');
  });
});
