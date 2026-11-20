// Calibration harness: rebuild every sold job in CASES, price it with today's settings, compare
// the base price (Main Summary D31) with the sold base. Sold steel and plate are re-priced at the
// steel_cost seed so jobs sold at older steel prices compare fairly with today's builds.
import { readFileSync } from 'node:fs';
import { loadFixtures, num, raw, rows, formula, type Fixture } from '../fixtures';
import { buildFromSpec } from '../../src/engine/buildSpec';
import { priceManual } from '../../src/engine/manual';
import { ROW, type CategoryKey } from '../../src/engine/rollup';
import { testCatalog } from '../catalog';
import SC from '../../src/engine/rules/steel_cost.default.json';
import { CASES, type CalCase } from './cases';

export const CAL_SETTINGS = { shop_rate: 140, onsite_rate: 113, pm_rate: 95, cad_rate: 120, pe_rate: 180, freestanding_pv_per_shop_hour: 38.6, one_pct_adder: { on: true }, sales_tax_rate: 0.07, banned_strings: [] as string[], steel_cost: SC };
const shapes: { shape: string; group: string }[] = JSON.parse(readFileSync('reference/steel_shapes.json', 'utf8'));
const groupOf = (s: string) => shapes.find(x => x.shape === s)?.group;
const perLb = SC.perLb as Record<string, number>;

export const CAT_LABEL: Partial<Record<CategoryKey, string>> = {
  stdParts: 'std parts', vendor: 'vendor', costBased: 'cost based', stairways: 'stairs', structural: 'structural', plate: 'plate', painting: 'paint',
  pmMarketing: 'PM', cad: 'CAD', engineering: 'P.E.', decals: 'decals', miscSteel: 'misc steel', xBracing: 'x-bracing', inboundFreight: 'inbound frt', shopLabor: 'shop labor',
};
const BASE_CATS = (Object.keys(ROW) as CategoryKey[]).filter(k => ROW[k] <= 22 || ROW[k] === 25);

/** $ change in the sold base if its structural + plate steel were bought at the steel_cost seed (incl. markup and the 1%). */
export function steelReprice(f: Fixture): number {
  let d = 0;
  const S = 'Structural', mS = num(f, S, 'I4');
  for (const r of rows(f, S)) {
    if (r < 8 || !num(f, S, `B${r}`) || typeof raw(f, S, `C${r}`) !== 'string') continue;
    const g = groupOf(String(raw(f, S, `C${r}`))), old = num(f, S, `F${r}`), tons = num(f, S, `G${r}`);
    if (!g || !old || !tons || perLb[g] == null) continue;
    d += tons * 2000 * (perLb[g] - old) * (1 + mS / 100);
  }
  const P = 'Plate';
  for (const r of rows(f, P)) {
    if (r < 6 || !num(f, P, `B${r}`) || !num(f, P, `J${r}`)) continue;
    const old = num(f, P, `F${r}`), tons = num(f, P, `H${r}`);
    if (!old || !tons || old > 5) continue;
    const mref = /\$J\$(\d+)/.exec(formula(f, P, `J${r}`) ?? '')?.[1] ?? '4';
    d += tons * 2000 * (perLb.Plate - old) * (1 + num(f, P, `J${mref}`) / 100);
  }
  return d * 1.01;
}

export interface CalRow {
  job: string; product: string; outlier?: string; note?: string;
  sold: number; soldAdj: number; built: number; gapPct: number;
  diffs: { cat: CategoryKey; sold: number; built: number }[];
  blockers: string[];
}

export function soldBase(f: Fixture): number {
  return f.aqt ? num(f, 'Main Summary', 'K7') : num(f, 'Main Summary', 'D31');
}

export function runCase(c: CalCase, fx: Fixture): CalRow {
  const base: any = { family: 'other', lines: [], outboundFreight: 0, preUse: 0, showPreUse: false, dealerDiscount: 0, taxOn: false, wording: '', options: [] };
  const b = buildFromSpec({ pwi_quote: 1, items: c.items }, testCatalog, CAL_SETTINGS, base);
  const shop = b.doc.lines.filter(l => l.kind === 'shop_labor' && (l as any).family === 'freestanding').reduce((a, l) => a + l.qty, 0);
  const p = priceManual({ ...b.doc, freestandingShopHours: shop, pvPerHourOverride: null } as any, CAL_SETTINGS);
  const builtCat: Partial<Record<CategoryKey, number>> = {};
  for (const l of p.lines) builtCat[l.category] = (builtCat[l.category] ?? 0) + l.sell;
  const sold = soldBase(fx), soldAdj = sold + (fx.aqt ? 0 : steelReprice(fx));
  const built = p.rollup.basePrice;
  const diffs = fx.aqt ? [] : BASE_CATS.map(cat => ({ cat, sold: num(fx, 'Main Summary', `D${ROW[cat]}`), built: builtCat[cat] ?? 0 }))
    .filter(d => Math.abs(d.built - d.sold) > 1).sort((a, b) => Math.abs(b.built - b.sold) - Math.abs(a.built - a.sold));
  return { job: c.job, product: c.product, outlier: c.outlier, note: c.note, sold, soldAdj, built, gapPct: (built / soldAdj - 1) * 100, diffs, blockers: b.blockers };
}

export function runAll(): CalRow[] {
  const fx = new Map(loadFixtures().map(f => [f.job, f]));
  return CASES.map(c => { const f = fx.get(c.job); if (!f) throw new Error(`fixture ${c.job} missing`); return runCase(c, f); });
}

const money = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;
export function cause(r: CalRow): string {
  const top = r.diffs.slice(0, 3).map(d => `${CAT_LABEL[d.cat] ?? d.cat} ${d.built > d.sold ? '+' : '−'}${money(Math.abs(d.built - d.sold))}`);
  return top.join(', ');
}
export function likely(r: CalRow): string {
  if (Math.abs(r.gapPct) <= 3) return 'within ±3%';
  const d = r.diffs[0]; if (!d) return '';
  const lab = CAT_LABEL[d.cat] ?? d.cat, up = d.built > d.sold;
  const why: Partial<Record<CategoryKey, [string, string]>> = {
    shopLabor: ['builder shop hours above the sold quote', 'builder shop hours below the sold quote'],
    structural: ['heavier / more steel than sold', 'lighter / less steel than sold'],
    plate: ['more plate (built-up columns / box members) than sold', 'less plate than sold (sold had built-up or box members)'],
    vendor: ['vendor parts the sold job did not carry', 'sold job carried vendor parts the spec does not ask for'],
    costBased: ['', 'sold job carried cost-based items the builder cannot know'],
    stdParts: ['more standard parts than sold', 'sold job carried standard parts the builder does not add'],
    cad: ['CAD hours above sold', 'CAD hours below sold'], pmMarketing: ['PM hours above sold', 'PM hours below sold'],
  };
  return why[d.cat]?.[up ? 0 : 1] || `${lab} ${up ? 'high' : 'low'}`;
}

export function table(rowsIn: CalRow[], before?: Record<string, number>): string {
  const head = `| Job | Product | Sold base | Sold base @ today's steel | Built base | Gap % |${before ? ' Before % |' : ''} Biggest category differences (built − sold) | Likely cause |\n|---|---|---:|---:|---:|---:|${before ? '---:|' : ''}---|---|`;
  const body = rowsIn.map(r => `| ${r.job} | ${r.product}${r.outlier ? ' (outlier)' : ''} | ${money(r.sold)} | ${money(r.soldAdj)} | ${money(r.built)} | ${r.gapPct >= 0 ? '+' : ''}${r.gapPct.toFixed(1)} |${before ? ` ${before[r.job] == null ? '—' : (before[r.job] >= 0 ? '+' : '') + before[r.job].toFixed(1)} |` : ''} ${cause(r)} | ${likely(r)} |`);
  return [head, ...body].join('\n');
}

/** Reads the Gap % column back out of docs/calibration.md. */
export function readTable(md: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of md.split('\n')) {
    const m = /^\| (\d{5}) \| [^|]+\| [^|]+\| [^|]+\| [^|]+\| ([+-]?\d+(?:\.\d+)?) \|/.exec(line);
    if (m && out[m[1]] == null) out[m[1]] = Number(m[2]);
  }
  return out;
}
