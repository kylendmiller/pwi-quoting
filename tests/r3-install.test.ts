// Round 3 S1: the install approval can't be bypassed by deleting, moving, reclassifying or reordering site labor.
import { describe, it, expect } from 'vitest';
import { buildFromSpec } from '../src/engine/buildSpec';
import { priceManual, flagDef, type QuoteDoc } from '../src/engine/manual';
import { testCatalog } from './catalog';
import { CAL_SETTINGS } from './calibration/harness';

const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const FSTR = { type: 'freestanding', capacityTons: 5, spanFt: 30, runwayOalFt: 80, overallHeightFt: 20, bridgeDrive: 'motorized', voltage: '460V/3', install: true, miles: 400 };
const built = () => buildFromSpec({ pwi_quote: 1, items: [FSTR] }, testCatalog, CAL_SETTINGS, base).doc as QuoteDoc;
const rules = (d: QuoteDoc) => priceManual(d, CAL_SETTINGS).flags.map(f => f.rule);
const installFlag = (d: QuoteDoc) => priceManual(d, CAL_SETTINGS).flags.find(f => f.rule === 'INSTALL_BELOW_SUGGESTED');

describe('S1 install approval', () => {
  it('an unedited installed build has no install flag', () => {
    expect(rules(built())).not.toContain('INSTALL_BELOW_SUGGESTED');
  });
  it('deleting every site-labor line flags (quoted 0)', () => {
    const d = built(); d.lines = d.lines.filter(l => l.kind !== 'site_labor');
    const f = installFlag(d)!;
    expect(f).toBeTruthy();
    expect(f.detail.quoted).toBe(0);
    expect(f.detail.suggested).toBeGreaterThan(0);
  });
  it('moving site labor to Cost-based (kind changed to material, as the editor does) flags', () => {
    const d = built(); d.lines = d.lines.map(l => l.kind === 'site_labor' ? { ...l, kind: 'material', category: 'costBased', unitCost: 0, markupPct: 0 } : l);
    expect(installFlag(d)).toBeTruthy();
  });
  it('site labor counted by kind wherever its category is', () => {
    const d = built(); d.lines = d.lines.map(l => l.kind === 'site_labor' ? { ...l, category: 'costBased' } : l);
    expect(installFlag(d)).toBeUndefined();
  });
  it('flag detail is rounded to 0.1 h and independent of line order', () => {
    const d = built(); d.lines = d.lines.map(l => l.kind === 'site_labor' ? { ...l, qty: l.qty * 0.77 + 0.03 } : l);
    const a = installFlag(d)!, b = installFlag({ ...d, lines: [...d.lines].reverse() })!;
    expect(a.detail).toEqual(b.detail);
    expect(String(a.detail.quoted)).toMatch(/^\d+(\.\d)?$/);
    expect(a.section).toBe('install');
    expect(a.lineKeys!.length).toBeGreaterThan(0);
    expect(flagDef('INSTALL_BELOW_SUGGESTED')!.explain(a.detail)).toMatch(/below the suggested/);
  });
  it('a hand-typed suggestion is never trusted: no spec → manual flag', () => {
    const d = { ...built(), spec: undefined, suggestedInstallHours: null };
    expect(rules(d)).toContain('INSTALL_MANUAL_NO_SUGGESTION');
  });
});
