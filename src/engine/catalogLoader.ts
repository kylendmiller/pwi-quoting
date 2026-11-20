import type { Catalog } from './freestanding';
import { readSteelCost } from './kit';

const PREFIXES = ['STK', 'SCT', 'STT', 'SCU', 'SCP', 'S802', 'SCA', 'SMW', 'STW', 'SHT', 'SMT', 'SPT', 'S400', 'S300', 'S2B', 'SET'];
let cached: { at: number; cat: Catalog } | null = null;

/** Price lists for the auto-builder, read from the live database (cached 5 min). `db` is any supabase-js client. */
export async function loadCatalog(db: any, settings: any): Promise<Catalog> {
  if (cached && Date.now() - cached.at < 300_000) return cached.cat;
  const [parts, vp, disc, shapes, groups, rates] = await Promise.all([
    db.from('std_parts').select('section,description,vendor,part,sell,shop_hours_each').eq('active', true),
    db.from('vendor_parts').select('*').or(PREFIXES.map(p => `part.like.${p}*`).join(',')).limit(5000),
    db.from('vendor_discounts').select('*'),
    db.from('steel_shapes').select('*'),
    db.from('steel_price_groups').select('*'),
    db.from('rate_items').select('kind,item,price,price_weekly,price_monthly').eq('active', true)]);
  for (const r of [parts, vp, disc, shapes, groups, rates]) if (r.error) throw new Error('Could not load price lists: ' + r.error.message);
  const P = parts.data!, V = vp.data!, R = rates.data!;
  const G = Object.fromEntries(groups.data!.map((g: any) => [g.code, Number(g.price_per_lb)]));
  const D = Object.fromEntries(disc.data!.map((d: any) => [d.vendor, d]));
  const cat: Catalog = {
    stdSell: d => { const p = P.find((x: any) => x.description === d); return p ? Number(p.sell) : null; },
    stdHours: d => Number(P.find((x: any) => x.description === d)?.shop_hours_each ?? 0),
    vendor: part => { const p = V.find((x: any) => x.part === part); return p ? { list: Number(p.list), description: p.description, vendor: p.vendor } : null; },
    vendorParts: prefix => V.filter((x: any) => x.part.startsWith(prefix)).map((x: any) => ({ part: x.part, list: Number(x.list), description: x.description })),
    discount: v => ({ pwi: Number(D[v]?.pwi_discount_pct ?? 0), customer: Number(D[v]?.customer_discount_pct ?? 0) }),
    shape: n => { const s = shapes.data!.find((x: any) => x.shape === n); return s ? { lbPerFt: Number(s.lb_per_ft), pricePerLb: G[s.price_group] ?? 0, group: s.price_group } : null; },
    plate: { pricePerLb: Number(settings.plate_price_per_lb ?? 1.35), markupPct: Number(settings.plate_markup_pct ?? 21), dropFactor: Number(settings.plate_drop_factor ?? 1.1) },
    structuralMarkupPct: Number(settings.structural_markup_pct ?? 26),
    steelCost: readSteelCost(settings.steel_cost).sc,
    decalSell: n => { const r = R.find((x: any) => x.item === n); return r ? Number(r.price) : null; },
    stdAll: () => P.map((x: any) => ({ description: x.description, part: x.part, sell: Number(x.sell), hours: Number(x.shop_hours_each ?? 0), info: x.vendor, section: x.section })),
    rate: item => { const r = R.find((x: any) => x.kind !== 'equipment' && x.item.trim() === item); return r ? Number(r.price) : null; },
    equip: item => {
      const r = R.find((x: any) => x.kind === 'equipment' && x.item.trim() === item); if (!r) return null;
      const d = Number(r.price); return { daily: d, weekly: Number(r.price_weekly ?? d * 5), monthly: Number(r.price_monthly ?? d * 20) };
    },
  };
  cached = { at: Date.now(), cat };
  return cat;
}
