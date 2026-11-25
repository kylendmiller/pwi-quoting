import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildFromSpec } from '../../src/engine/buildSpec';
import { priceManual } from '../../src/engine/manual';
import { testCatalog } from '../catalog';
import { CAL_SETTINGS } from '../calibration/harness';
const empty: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
const price = (items: any[]) => {
  const b = buildFromSpec({ pwi_quote: 1, items } as any, testCatalog, CAL_SETTINGS as any, empty);
  const shop = b.doc.lines.filter((l: any) => l.kind === 'shop_labor' && l.family === 'freestanding').reduce((a: number, l: any) => a + l.qty, 0);
  const p: any = priceManual({ ...b.doc, freestandingShopHours: shop, pvPerHourOverride: null } as any, CAL_SETTINGS as any);
  return { b, p };
};
it('dump', () => {
  const fix = JSON.parse(readFileSync('tests/calibration/wide_fixture.json', 'utf8')).jobs;
  const out: any[] = [];
  for (const j of fix) {
    const { b, p } = price(j.items);
    const cats: Record<string, number> = {};
    for (const l of p.lines) cats[l.category] = (cats[l.category] ?? 0) + (l.sell ?? 0);
    out.push({ job: j.job, family: j.family, gap: ((p.rollup.basePrice + j.passThrough) / j.soldBaseToday - 1) * 100, base: p.rollup.basePrice, sold: j.soldBaseToday, pass: j.passThrough, cats });
  }
  // install: specs with sold on-site hours, rebuilt installed at the sold miles
  const facts = new Map(readFileSync('/home/claude/data/sold_facts.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l)).map((r: any) => [r.key, r]));
  const specs = readFileSync('/home/claude/data/specs.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const inst: any[] = [];
  for (const s of specs) {
    const f: any = facts.get(s.key);
    if (!f || !(f.onsiteHours > 0) || !['high', 'medium'].includes(s.confidence) || !s.items?.length || s.items.length > 1 || s.outlier) continue;
    try {
      const items = s.items.map((it: any) => ({ ...it, install: true, miles: f.miles ?? it.miles ?? 100 }));
      const { b, p } = price(items);
      const site = p.lines.filter((l: any) => l.kind === 'site_labor');
      const travelH = site.filter((l: any) => /^Travel/.test(l.description)).reduce((a: number, l: any) => a + l.qty, 0);
      const workH = site.reduce((a: number, l: any) => a + l.qty, 0) - travelH;
      inst.push({ job: s.key, family: s.family, miles: f.miles, soldOnsite: f.onsiteHours, builtWork: workH, builtTravel: travelH, soldInstall$: f.install, builtInstall$: p.quote.installation, crew: f.crew, hotelNights: f.hotelNights, perDiemDays: f.perDiemDays, suggested: b.doc.suggestedInstallHours });
    } catch (e) { inst.push({ job: s.key, err: String(e) }); }
  }
  writeFileSync('/tmp/acc.json', JSON.stringify({ base: out, inst }));
});
