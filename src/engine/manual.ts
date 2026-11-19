// Manual-mode pricing: the salesperson types lines (any product). The server prices them
// with current settings, rolls them up exactly like the SMT, computes margin and flags.
import { rollup, type CategoryKey, type RollupResult } from './rollup';
import { rateLine } from './lines';

export type LineKind = 'material' | 'shop_labor' | 'site_labor' | 'travel' | 'equipment' | 'pm' | 'cad' | 'engineering';

export interface QuoteLine {
  key: string;
  kind: LineKind;
  category: CategoryKey;            // which Main Summary bucket the sell price lands in
  family?: string;                  // product family for factors (freestanding, bridge, mezzanine, ...)
  description: string;
  qty: number;                      // pieces, or hours for labor kinds
  unitCost?: number;                // material: cost each
  markupPct?: number;               // material: markup on cost
  unitSell?: number;                // material: catalog sell each (used when no cost/markup)
  laborOp?: string;                 // labor_ops code
  reason?: string;                  // required for site_difficulty / overrides
  auto?: boolean;                   // made by an auto-builder (replaced on rebuild)
}

export interface QuoteDoc {
  family: string;                   // main product family of the quote
  lines: QuoteLine[];
  outboundFreight: number;
  preUse: number;
  showPreUse: boolean;
  dealerDiscount: number;           // fraction
  taxOn: boolean;
  suggestedInstallHours?: number | null;   // from product rules; null in manual mode
  freestandingShopHours?: number;   // quoted shop hours on freestanding items (for the PV adder)
  pvPerHourOverride?: number | null;
  wording: string;
  options: { description: string; price: number }[];
  spec?: unknown;                   // the spec the auto-builder ran from (re-build / re-quote)
  assumptions?: { field: string; value: unknown; why: string; alt?: unknown; altLabel?: string; item?: number }[];
  buildNotes?: string[];
  blockers?: string[];              // set by the server's rebuild: must be resolved before sending
}

export interface Settings {
  shop_rate: number; onsite_rate: number; pm_rate: number; cad_rate: number; pe_rate: number;
  freestanding_pv_per_shop_hour: number; one_pct_adder: { on: boolean }; sales_tax_rate: number;
  labor_cost_shop?: number; labor_cost_site?: number;      // internal cost per hour for margin
  banned_strings: string[];
}

export interface PricedLine extends QuoteLine { cost: number; sell: number; hours: number }
export type Flag = { rule: 'INSTALL_BELOW_SUGGESTED' | 'INSTALL_MANUAL_NO_SUGGESTION' | 'PV_BELOW_FLOOR' | 'CLASS_D'; detail: Record<string, unknown> };
export type Lint = { level: 'error' | 'warning'; message: string };

export interface Priced {
  lines: PricedLine[];
  rollup: RollupResult;
  totals: { cost: number; sell: number; grossMargin: number; grossMarginPct: number; shopHours: number; installHours: number; cadHours: number; productionValue: number };
  flags: Flag[];
  lint: Lint[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function priceManual(doc: QuoteDoc, s: Settings): Priced {
  const rateFor: Record<LineKind, number> = {
    material: 0, shop_labor: s.shop_rate, site_labor: s.onsite_rate, travel: 0, equipment: 0,
    pm: s.pm_rate, cad: s.cad_rate, engineering: s.pe_rate,
  };
  const shopCost = s.labor_cost_shop ?? s.shop_rate * 0.59;   // SMT margin calc assumes 41% GM on shop labor
  const siteCost = s.labor_cost_site ?? s.onsite_rate * 0.53; // and 47% on on-site labor
  const lines: PricedLine[] = doc.lines.map(l => {
    if (l.kind === 'material' || l.kind === 'travel' || l.kind === 'equipment') {
      const cost = (l.unitCost ?? 0) * l.qty;
      const sell = l.unitSell != null && l.unitCost == null ? l.unitSell * l.qty : cost * (1 + (l.markupPct ?? 0) / 100);
      return { ...l, cost, sell, hours: 0 };
    }
    const sell = rateLine(l.qty, rateFor[l.kind]);
    const cost = l.kind === 'site_labor' ? l.qty * siteCost : l.kind === 'shop_labor' ? l.qty * shopCost : sell * 0.59;
    return { ...l, cost, sell, hours: l.qty };
  });

  // Freestanding Production Value: internal line, 100% margin, rolls into base price
  const pvRate = doc.pvPerHourOverride ?? s.freestanding_pv_per_shop_hour;
  const productionValue = (doc.freestandingShopHours ?? 0) * pvRate;

  const categories: Partial<Record<CategoryKey, number>> = {};
  for (const l of lines) categories[l.category] = (categories[l.category] ?? 0) + l.sell;
  if (productionValue) categories.costBased = (categories.costBased ?? 0) + productionValue;

  const ro = rollup({
    categories,
    onePct: { mode: 'switchable', off: !s.one_pct_adder.on },
    dealerDiscount: doc.dealerDiscount,
    outboundFreight: doc.outboundFreight,
    preUse: doc.preUse,
    showPreUse: doc.showPreUse,
    tax: { on: doc.taxOn, rate: s.sales_tax_rate, base: 'materials' },
  });

  const sum = (f: (l: PricedLine) => number, k?: LineKind[]) => lines.filter(l => !k || k.includes(l.kind)).reduce((a, l) => a + f(l), 0);
  const cost = sum(l => l.cost);
  const sell = ro.quote.base + ro.quote.installation;
  const shopHours = sum(l => l.hours, ['shop_labor']);
  const installHours = sum(l => l.hours, ['site_labor']);
  const cadHours = sum(l => l.hours, ['cad']);

  const flags: Flag[] = [];
  if (installHours > 0 || lines.some(l => l.kind === 'site_labor')) {
    if (doc.suggestedInstallHours == null) flags.push({ rule: 'INSTALL_MANUAL_NO_SUGGESTION', detail: { quoted: installHours } });
    else if (installHours < doc.suggestedInstallHours) flags.push({ rule: 'INSTALL_BELOW_SUGGESTED', detail: { quoted: installHours, suggested: doc.suggestedInstallHours } });
  }
  if (doc.pvPerHourOverride != null && doc.pvPerHourOverride < s.freestanding_pv_per_shop_hour && (doc.freestandingShopHours ?? 0) > 0)
    flags.push({ rule: 'PV_BELOW_FLOOR', detail: { used: doc.pvPerHourOverride, floor: s.freestanding_pv_per_shop_hour } });
  if (/class\s*d\b/i.test(doc.wording)) flags.push({ rule: 'CLASS_D', detail: {} });

  return {
    lines: lines.map(l => ({ ...l, cost: r2(l.cost), sell: r2(l.sell) })),
    rollup: ro,
    totals: { cost: r2(cost), sell: r2(sell), grossMargin: r2(sell - cost), grossMarginPct: sell ? (sell - cost) / sell : 0, shopHours, installHours, cadHours, productionValue: r2(productionValue) },
    flags,
    lint: lintWording(doc, s),
  };
}

/** Wording checks. Errors block sending (never saving). */
export function lintWording(doc: QuoteDoc, s: Settings): Lint[] {
  const out: Lint[] = [];
  const w = doc.wording;
  if (!w.trim()) out.push({ level: 'error', message: 'Quote wording is empty.' });
  if (/\bxx\b|\(x\)|\?\s*Ton/i.test(w)) out.push({ level: 'error', message: 'Wording still has placeholders (xx, (x) or ? Ton).' });
  if (/\bOR\b/.test(w)) out.push({ level: 'error', message: 'Wording still has an "OR" choice — pick one.' });
  const letters = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '');
  const wl = letters(w);
  if (s.banned_strings.some(b => letters(b).length > 3 && wl.includes(letters(b)))) out.push({ level: 'error', message: 'Wording contains a banned company name. Use PWI or PWI Corp.' });
  const tl = /(\d+)\s*psf\s*T\.?L\.?\s*\/\s*(\d+)\s*psf\s*L\.?L/i.exec(w);
  if (tl && Number(tl[1]) < Number(tl[2])) out.push({ level: 'error', message: `Mezzanine capacity: T.L. (${tl[1]}) is less than L.L. (${tl[2]}).` });
  for (const l of doc.lines) {
    if (l.laborOp === 'site_difficulty' && !l.reason?.trim()) out.push({ level: 'error', message: 'Site Difficulty Allowance needs a reason.' });
    if (l.kind === 'material' && l.unitCost != null && !l.markupPct) out.push({ level: 'warning', message: `"${l.description}" has no markup.` });
  }
  for (const b of doc.blockers ?? []) out.push({ level: 'error', message: b });
  return out;
}

export const sendBlocked = (p: Priced, approvedRules: string[]) =>
  p.lint.some(l => l.level === 'error') || p.flags.some(f => !approvedRules.includes(f.rule));
