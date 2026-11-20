import { describe, it, expect } from 'vitest';
import { buildMonorail } from '../src/engine/monorail';
import { testCatalog } from './catalog';

const base = { lengthFt: 121, capacityTons: 1, support: 'freestanding' as const, overallHeightFt: 20, voltage: '460V/3', install: false };
describe('monorail defaults from sold jobs', () => {
  it('≤2 t supports at ≤25\' (27952: 121\' → 6 frames)', () => {
    const r = buildMonorail({ ...base, parallelBeams: 2, frameWidthFt: 30, hoists: 2 }, testCatalog);
    expect(r.geometry.supportsPer).toBe(6);
    expect(r.geometry.cols).toBe(12);
  });
  it('two parallel beams share goal-post frames (beams doubled, columns not)', () => {
    const one = buildMonorail({ ...base, frame: 'goal_post', frameWidthFt: 30, hoists: 2 }, testCatalog);
    const two = buildMonorail({ ...base, parallelBeams: 2, frameWidthFt: 30, hoists: 2 }, testCatalog);
    const beamPcs = (r: any) => r.lines.filter((l: any) => /Monorail beam/.test(l.description)).reduce((a: number, l: any) => a + l.qty, 0);
    expect(beamPcs(two)).toBe(2 * beamPcs(one));
    expect(two.geometry.cols).toBe(one.geometry.cols);
  });
  it('components: false drops hoists (29061 No Components)', () => {
    const r = buildMonorail({ ...base, lengthFt: 45, capacityTons: 1.5, hoists: 3, components: false }, testCatalog);
    expect(r.lines.some(l => l.category === 'vendor')).toBe(false);
    expect(r.wording).toMatch(/supplied by the customer/);
  });
  it('single post default for 1 beam ≤2 t', () => {
    const r = buildMonorail({ ...base, lengthFt: 45 }, testCatalog);
    expect(r.lines.some(l => /Cantilever arms/.test(l.description))).toBe(true);
  });
});
