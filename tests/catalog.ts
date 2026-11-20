// Test catalog built from reference/ price lists. Shared by every test file; importing it runs no tests.
import { readFileSync } from 'node:fs';
import type { Catalog } from '../src/engine/kit';

const ref = (f: string) => JSON.parse(readFileSync(`reference/${f}`, 'utf8'));
const parts = ref('standard_parts.json'), shapes = ref('steel_shapes.json'), groups = ref('steel_price_groups.json');
const decals = ref('decals.json'), equipment = ref('equipment.json');
const vp: [string, string, string, number][] = JSON.parse(readFileSync('db/seed_vendor_parts.json', 'utf8'));
const allV = vp.map(([vendor, part, description, list]) => ({ vendor, part, description, list }));
const disc: Record<string, [number, number]> = { Starke: [50, 5], 'Street Crane': [20, 10], 'Columbus McKinnon': [35, 32], InMotion: [50, 5] };
export const testCatalog: Catalog = {
  stdSell: d => parts.find((p: any) => p.description === d)?.sell ?? null,
  stdHours: d => parts.find((p: any) => p.description === d)?.shop_hours_each ?? 0,
  vendor: part => allV.find(p => p.part === part) ?? null,
  vendorParts: prefix => allV.filter(p => p.part.startsWith(prefix)),
  discount: v => ({ pwi: disc[v]?.[0] ?? 0, customer: disc[v]?.[1] ?? 0 }),
  shape: n => { const s = shapes.find((x: any) => x.shape === n); return s ? { lbPerFt: s.lb_per_ft, pricePerLb: groups[s.group].price_per_lb, group: s.group } : null; },
  plate: { pricePerLb: 1.35, markupPct: 21, dropFactor: 1.1 }, structuralMarkupPct: 26,
  decalSell: n => decals.find((d: any) => d.item === n)?.price ?? null,
  stdAll: () => parts.map((x: any) => ({ description: x.description, part: x.part, sell: x.sell, hours: x.shop_hours_each ?? 0, info: x.vendor, section: x.section })),
  rate: item => ({ 'Standard Paint Full Booth Run': 1983.75, 'Custom Color Paint Full Booth Run': 2530, 'Primer Full Booth Run': 1587, 'Hotels (one room per person)': 170, 'Per diem costs': 75 } as any)[item] ?? null,
  equip: item => { const e = equipment.find((x: any) => x.item.trim() === item); return e ? { daily: e.daily, weekly: e.weekly ?? e.daily * 5, monthly: e.monthly ?? e.daily * 20 } : null; },
};
