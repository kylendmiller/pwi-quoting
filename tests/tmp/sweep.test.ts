import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildFromSpec } from '../../src/engine/buildSpec';
import { priceManual } from '../../src/engine/manual';
import { RULES } from '../../src/engine/kit';
import { testCatalog } from '../catalog';
import { CAL_SETTINGS } from '../calibration/harness';
const empty: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
it('sweep', () => {
  const facts = new Map(readFileSync('/home/claude/data/sold_facts.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l)).map((r: any) => [r.key, r]));
  const specs = readFileSync('/home/claude/data/specs.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l))
    .filter((s: any) => { const f: any = facts.get(s.key); return f && f.onsiteHours >= 8 && ['high', 'medium'].includes(s.confidence) && s.items?.length === 1 && !s.outlier; });
  const res: any = {};
  for (const fsF of [1.35, 1.4, 1.45, 1.5]) for (const bo of [1.5, 1.6, 1.7, 1.8]) {
    (RULES as any).bridgeOnlyInstallMult = bo;
    const S: any = { ...CAL_SETTINGS, install_factor: { freestanding: fsF } };
    const rows: any[] = [];
    for (const s of specs) {
      const f: any = facts.get(s.key);
      const items = s.items.map((it: any) => ({ ...it, install: true, miles: f.miles ?? 100 }));
      const b = buildFromSpec({ pwi_quote: 1, items } as any, testCatalog, S, empty);
      const p: any = priceManual({ ...b.doc } as any, S);
      const h = p.lines.filter((l: any) => l.kind === 'site_labor').reduce((a: number, l: any) => a + l.qty, 0);
      const it0 = s.items[0];
      rows.push({ job: s.key, grp: it0.type === 'bridge' ? 'bridge:' + (it0.support ?? 'building_runway') : it0.type, built: h, sold: f.onsiteHours });
    }
    res[`${fsF}|${bo}`] = rows;
  }
  writeFileSync('/tmp/sweep.json', JSON.stringify(res));
});
