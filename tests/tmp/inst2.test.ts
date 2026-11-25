import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildFromSpec } from '../../src/engine/buildSpec';
import { priceManual } from '../../src/engine/manual';
import { testCatalog } from '../catalog';
import { CAL_SETTINGS } from '../calibration/harness';
const empty: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
it('dump', () => {
  const facts = new Map(readFileSync('/home/claude/data/sold_facts.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l)).map((r: any) => [r.key, r]));
  const specs = readFileSync('/home/claude/data/specs.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l))
    .filter((s: any) => { const f: any = facts.get(s.key); return f && f.onsiteHours >= 8 && ['high', 'medium'].includes(s.confidence) && s.items?.length >= 1; });
  const rows: any[] = [];
  for (const s of specs) {
    const f: any = facts.get(s.key);
    try {
      const items = s.items.map((it: any) => ({ ...it, install: true, miles: f.miles ?? 100 }));
      const b = buildFromSpec({ pwi_quote: 1, items } as any, testCatalog, CAL_SETTINGS as any, empty);
      const site = b.doc.lines.filter((l: any) => l.kind === 'site_labor');
      const trav = site.filter((l: any) => /^Travel/.test(l.description)).reduce((a: number, l: any) => a + l.qty, 0);
      const work = site.reduce((a: number, l: any) => a + l.qty, 0) - trav;
      const tt: any = b.doc.lines.find((l: any) => (l.detail as any)?.what === 'travel_time')?.detail;
      const it0 = s.items[0];
      rows.push({ job: s.key, multi: s.items.length > 1, outlier: !!s.outlier, grp: it0.type === 'bridge' ? 'bridge:' + (it0.support ?? 'building_runway') : it0.type, work, trav, men: tt?.men, days: tt?.crewDays, sold: f.onsiteHours, soldCrew: f.crew, miles: f.miles });
    } catch (e) {}
  }
  writeFileSync('/tmp/inst2.json', JSON.stringify(rows));
});
