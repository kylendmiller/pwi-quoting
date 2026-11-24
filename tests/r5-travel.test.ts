// Round 5 travel rules: drive time decides commute vs stay, 6-day weeks away with Sundays paid, fly past 8 h of driving, searched airfare × multiplier.
import { describe, it, expect } from 'vitest';
import { buildFromSpec, type QuoteSpec } from '../src/engine/buildSpec';
import { RULES } from '../src/engine/kit';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';
const FS = { type: 'freestanding', series: 'GM', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true };
const build = (s: Partial<QuoteSpec> & { items: any[] }) => buildFromSpec({ pwi_quote: 1, ...s } as QuoteSpec, testCatalog, CAL_SETTINGS, { lines: [], options: [] } as any).doc as any;
const td = (d: any, what: string) => d.lines.find((l: any) => l.detail?.what === what);
const mode = (d: any) => d.assumptions?.find((a: any) => a.field === 'travelMode')?.value ?? td(d, 'travel_time')?.detail?.mode;

describe('commute vs stay by drive time', () => {
  it('≤ 1.5 h drive commutes, no hotel', () => {
    const d = build({ items: [{ ...FS, miles: 80 }], trip: { driveMinutes: 85 } });
    expect(td(d, 'hotel')).toBeUndefined();
    expect(mode(d)).toBe('local');
  });
  it('> 1.5 h drive stays, even when the miles are under 100 (slow roads)', () => {
    const d = build({ items: [{ ...FS, miles: 90 }], trip: { driveMinutes: 100 } });
    expect(td(d, 'hotel')).toBeTruthy();
    expect(mode(d)).toBe('drive');
  });
  it('no drive time on the spec: miles ÷ mph decides (1.5 h ≈ 97 mi)', () => {
    expect(td(build({ items: [{ ...FS, miles: 95 }] }), 'hotel')).toBeUndefined();
    expect(td(build({ items: [{ ...FS, miles: 110 }] }), 'hotel')).toBeTruthy();
  });
});

describe('6-day weeks while away (Sunday off, paid)', () => {
  it('Sundays the job spans add hotel + per diem; Saturdays are work days', () => {
    const six = build({ items: [{ ...FS, miles: 400, installDays: 6 }] });
    const seven = build({ items: [{ ...FS, miles: 400, installDays: 7 }] });
    expect(td(six, 'per_diem').detail.tripDays).toBe(6 + 0 + 2);                                     // Mon–Sat, no Sunday
    expect(td(seven, 'per_diem').detail.tripDays).toBe(7 + 1 + 2);                                   // 1 Sunday + 2 travel days
    const two = build({ items: [{ ...FS, miles: 400, installDays: 13 }] });
    expect(td(two, 'per_diem').detail.tripDays).toBe(13 + 2 + 2);
  });
  it('local jobs never pay Sundays', () => {
    expect(td(build({ items: [{ ...FS, miles: 30, installDays: 8 }] }), 'per_diem')).toBeUndefined();
  });
});

describe('drive vs fly at 8 h of driving', () => {
  it('under 8 h drives, over 8 h flies', () => {
    expect(mode(build({ items: [{ ...FS, miles: 500 }] }))).toBe('drive');                           // 7.7 h
    expect(mode(build({ items: [{ ...FS, miles: 540 }] }))).toBe('fly');                             // 8.3 h
    expect(mode(build({ items: [{ ...FS, miles: 480 }], trip: { driveMinutes: 510 } }))).toBe('fly'); // site drive time wins
  });
});

describe('airfare', () => {
  it('uses the searched fare × multiplier per man, with route and dates on the line', () => {
    const d = build({ items: [{ ...FS, miles: 1200 }], trip: { airfarePerPerson: 412, airfareRoute: 'SBN → TUL', airfareDates: '2026-12-07 → 2026-12-11' } });
    const f = td(d, 'flight');
    expect(f.unitCost).toBeCloseTo(412 * RULES.travel.airfareMultiplier, 2);
    expect(f.description).toContain('SBN → TUL'); expect(f.description).toContain('× 2.2');
  });
  it('no fare searched: falls back to the flat rate and says so', () => {
    const d = build({ items: [{ ...FS, miles: 1200 }] });
    expect(td(d, 'flight').unitCost).toBe(RULES.travel.flightPerMan);
    expect(d.buildNotes.join(' ')).toMatch(/No airfare searched/);
  });
});
