import { describe, it, expect } from 'vitest';
import { buildWorkPlatform } from '../src/engine/workPlatform';
import { buildFromSpec, BUILDERS } from '../src/engine/buildSpec';
import { describe as describeItem } from '../app/src/model';
import { testCatalog } from './catalog';

describe('work platform builder (Work Platforms tab)', () => {
  it('triangular truss + 2 t hoists for a 51\' platform; box truss over 57\'', () => {
    const a = buildWorkPlatform({ lengthFt: 51, install: false }, testCatalog);
    expect(a.geometry.truss).toBe('triangular'); expect(a.geometry.hoist).toBe('2 Ton');
    const b = buildWorkPlatform({ lengthFt: 60, install: false }, testCatalog);
    expect(b.geometry.truss).toBe('box');
    expect(buildWorkPlatform({ lengthFt: 38, install: false }, testCatalog).geometry.hoist).toBe('1 Ton');
    expect(buildWorkPlatform({ lengthFt: 70, install: false }, testCatalog).geometry.hoist).toBe('3 Ton');
  });
  it('4 hoists + 4 secondary brakes per set, CAD/PM per set', () => {
    const r = buildWorkPlatform({ sets: 2, lengthFt: 51, install: false }, testCatalog);
    expect(r.lines.find(l => /STK2026/.test(l.description))?.qty).toBe(8);
    expect(r.lines.find(l => /S3KLAS/.test(l.description))?.qty).toBe(8);
    expect(r.lines.find(l => l.kind === 'cad')?.qty).toBe(10);
    expect(r.blockers).toEqual([]);
  });
  it('tall units → 30\' towers; wider than 4\' adds the width adder', () => {
    const r = buildWorkPlatform({ lengthFt: 51, widthFt: 6, tallestUnitFt: 15, install: false }, testCatalog);
    expect(r.geometry.tower).toBe(30);
    expect(r.lines.some(l => /Width adder/.test(l.description))).toBe(true);
  });
  it('wired into BUILDERS (family work_platform, factors .82 / .95) and describe()', () => {
    expect(BUILDERS.work_platform.fam).toBe('work_platform');
    expect(BUILDERS.work_platform.def).toEqual([0.82, 0.95]);
    const it0 = { type: 'work_platform', lengthFt: 51, crosswalks: { pivot: 2 }, install: true, miles: 40 };
    expect(describeItem(it0)).toMatch(/Work platform set/);
    const b = buildFromSpec({ pwi_quote: 1, items: [it0] }, testCatalog, {}, { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] } as any);
    expect(b.doc.family).toBe('work_platform');
    expect(b.doc.wording).toMatch(/GUARDIAN WORK PLATFORM SET/);
  });
  it('out-of-range length is a blocker, not a crash', () => {
    const b = buildFromSpec({ pwi_quote: 1, items: [{ type: 'work_platform', lengthFt: 200, install: false }] }, testCatalog, {}, { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] } as any);
    expect(b.blockers.join(' ')).toMatch(/lengthFt/);
  });
});
