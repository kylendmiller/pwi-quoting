// Round 3 S4: stable line refs keyed by a permanent spec item id (never by index or clock).
import { describe, it, expect } from 'vitest';
import { buildFromSpec, assignItemIds, ensureRefs } from '../src/engine/buildSpec';
import type { QuoteDoc } from '../src/engine/manual';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';
import { CASES } from './calibration/cases';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const build = (items: any[]) => buildFromSpec({ pwi_quote: 1, items }, testCatalog, CAL_SETTINGS, base).doc as QuoteDoc;
const A = { type: 'freestanding', tag: 'A', capacityTons: 2, spanFt: 20, runwayOalFt: 40, overallHeightFt: 16, bridgeDrive: 'manual', install: true, miles: 300 };
const B = { ...A, tag: 'B', capacityTons: 5, spanFt: 30 };

describe('S4 stable refs', () => {
  it('same spec in → same refs out; every auto line has a unique ref (all calibration jobs)', () => {
    for (const c of CASES) {
      const a = build(c.items), b = build(c.items);
      expect(a.lines.map(l => l.ref)).toEqual(b.lines.map(l => l.ref));
      const refs = a.lines.map(l => l.ref!);
      expect(refs.every(Boolean), c.job).toBe(true);
      expect(new Set(refs).size, c.job).toBe(refs.length);
      expect(a.lines.every(l => l.source === 'auto')).toBe(true);
      expect(refs.some(r => /k[0-9a-z]{6,}/.test(r.split(':')[1] ?? ''))).toBe(false);   // no clock keys
    }
  });
  it('spec items get a permanent id that is saved with the spec and kept', () => {
    const d = build([A, B]);
    const ids = (d.spec as any).items.map((i: any) => i.id);
    expect(ids.every((x: any) => typeof x === 'string')).toBe(true);
    expect(new Set(ids).size).toBe(2);
    const again = buildFromSpec(d.spec as any, testCatalog, CAL_SETTINGS, base).doc;
    expect((again.spec as any).items.map((i: any) => i.id)).toEqual(ids);
    expect(assignItemIds(d.spec as any)).toBe(d.spec);
  });
  it('deleting item 1 of 2 does not move item 2 refs onto item 1', () => {
    const d = build([A, B]);
    const sp = d.spec as any;
    const onlyB = buildFromSpec({ ...sp, items: [sp.items[1]] }, testCatalog, CAL_SETTINGS, base).doc;
    const girderOf = (doc: QuoteDoc, id: string) => doc.lines.find(l => l.role === 'girder' && l.ref!.startsWith(id + ':'));
    expect(girderOf(onlyB, sp.items[1].id)!.ref).toBe(girderOf(d, sp.items[1].id)!.ref);
    expect(onlyB.lines.some(l => l.ref!.startsWith(sp.items[0].id + ':'))).toBe(false);
  });
  it('trip lines use "trip" refs for one installed item and for a shared trip', () => {
    const one = build([A]), two = build([A, B]);
    const trip = (d: QuoteDoc) => d.lines.filter(l => l.ref!.startsWith('trip:')).map(l => l.ref).sort();
    expect(trip(one).length).toBeGreaterThan(0);
    expect(trip(two)).toEqual(expect.arrayContaining(trip(one).filter(r => !/equip-handler|delivery/.test(r!))));
  });
  it('ensureRefs gives a legacy doc (no refs, no ids) the refs a build would', () => {
    const d = build([A, B]);
    const legacy: QuoteDoc = { ...d, spec: { ...(d.spec as any), items: (d.spec as any).items.map(({ id, ...x }: any) => x) },
      lines: d.lines.map(({ ref, source, ...l }) => l) };
    expect(ensureRefs(legacy).lines.map(l => l.ref)).toEqual(d.lines.map(l => l.ref));
  });
});
