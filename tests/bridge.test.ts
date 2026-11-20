import { describe, it, expect } from 'vitest';
import { buildCrane, sizeGirder } from '../src/engine/crane';
import { ixOf } from '../src/engine/kit';
import { testCatalog } from './catalog';

describe('bridge girder past the AQT chart', () => {
  it('70\' × 10 t → plate box girder near the sold 189 plf (29562), no placeholder blocker', () => {
    const r = buildCrane({ support: 'bridge_only', spanFt: 70, capacityTons: 10, hoistsPerBridge: 2, bridgeDrive: 'motorized', voltage: '460V/3', install: false }, testCatalog);
    const box = r.lines.find(l => /box girder/i.test(l.description));
    expect(box?.category).toBe('plate');
    expect(String(r.geometry.girder)).toMatch(/^box (1[6-9]\d|20\d) plf$/);
    expect(r.blockers.join(' ')).not.toMatch(/placeholder/);
    expect(r.lines.some(l => /Box girder fab/.test(l.description))).toBe(true);
  });
  it('50\' × 10 t → a W shape that meets L/600 with a conservative Ix', () => {
    const g = sizeGirder(testCatalog, 50, 10, false);
    expect(g.shape).toMatch(/^W/);
    expect(ixOf(g.shape!)).toBeGreaterThanOrEqual(g.Ireq);
  });
  it('double girder halves the load per girder', () => {
    const one = sizeGirder(testCatalog, 75, 15, false), two = sizeGirder(testCatalog, 75, 15, true);
    expect(two.Ireq).toBeLessThan(one.Ireq);
  });
  it('railFt / runwayElectrificationFt override the runway OAL for completion packages', () => {
    const r = buildCrane({ support: 'bridge_only', spanFt: 40, capacityTons: 5, runwayOalFt: 225, railFt: 500, runwayElectrificationFt: 475, bridgeDrive: 'motorized', voltage: '460V/3', install: false }, testCatalog);
    expect(r.lines.find(l => /ASCE Crane Rail/.test(l.description))?.qty).toBe(500);
    expect(r.lines.find(l => /Runway Electrification Package/.test(l.description))?.qty).toBe(475);
  });
});
