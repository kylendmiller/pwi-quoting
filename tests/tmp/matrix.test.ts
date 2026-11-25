import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildFromSpec } from '../../src/engine/buildSpec';
import { testCatalog } from '../catalog';
import { CAL_SETTINGS } from '../calibration/harness';
const empty: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
it('m', () => {
  const cases: any[] = [];
  for (const [series, cap, span, h] of [['UL',1,20,16],['M',2,30,18],['M',3,30,20],['GM',5,30,20],['GM',5,40,22],['GM',10,40,24],['GM',10,50,26]] as any)
    cases.push({ name: `Freestanding ${series} ${cap} t, ${span}' span × 80' runway, ${h}' overall`, it: { type: 'freestanding', series, capacityTons: cap, spanFt: span, runwayOalFt: 80, overallHeightFt: h, bridgeDrive: series==='UL'?'manual':'motorized', voltage: '460V/3', install: false, miles: 100 } });
  cases.push({ name: `Gantry 3 t, 25' span, 16' under beam`, it: { type: 'gantry', capacityTons: 3, spanFt: 25, heightUnderBeamFt: 16, floorTrackFt: 0, voltage: '460V/3', install: false, miles: 100 } });
  cases.push({ name: `Monorail 2 t, 60' long, freestanding, 16' overall`, it: { type: 'monorail', capacityTons: 2, lengthFt: 60, support: 'freestanding', overallHeightFt: 16, voltage: '460V/3', install: false, miles: 100 } });
  cases.push({ name: `Jib 1 t, 16' reach, floor mount, 16' overall`, it: { type: 'jib', capacityTons: 1, spanFt: 16, overallHeightFt: 16, mount: 'floor', install: false, miles: 100 } });
  const out = cases.map(c => {
    try { const b = buildFromSpec({ pwi_quote: 1, items: [c.it] } as any, testCatalog, CAL_SETTINGS as any, empty);
      const st = b.doc.lines.filter((l: any) => l.category === 'structural' || /plate|Built-up/i.test(l.description) && l.category==='plate').map((l: any) => l.description);
      return { name: c.name, steel: st };
    } catch (e: any) { return { name: c.name, err: e.message }; } });
  writeFileSync('/tmp/matrix.json', JSON.stringify(out, null, 1));
});
