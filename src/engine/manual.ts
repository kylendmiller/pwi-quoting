// Manual-mode pricing: the salesperson types lines (any product). The server prices them
// with current settings, rolls them up exactly like the SMT, computes margin and flags.
import { rollup, type CategoryKey, type RollupResult } from './rollup';
import { rateLine } from './lines';
import type { Role, Basis, LineDetail } from './lineDetail';
import type { SectionKey } from './sections';
export type { Role, Basis, LineDetail } from './lineDetail';

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
  // ---- editor data (round 3). Optional, never priced: see src/engine/lineDetail.ts and sections.ts
  role?: Role;                      // what the line is on the job (column, runway, girder, hoist, install, …)
  item?: number;                    // spec.items index it was built for; -1 = shared across the job (one trip)
  group?: string;                   // label for that item: "Item 1 (Bay A) — bridge", "Shared trip"
  basis?: Basis;                    // why: chart + row, calc + unity, rule, catalog pick, assumption field
  detail?: LineDetail;              // the numbers behind the price, typed per kind
  // ---- round 3 S: stable refs, provenance, edits (see docs/round3/S-API.md)
  ref?: string;                     // stable builder slot `${itemId}:${slot}` (same spec in → same refs out)
  source?: 'auto' | 'hand';         // stamped by the server: 'hand' = not matched to its own rebuild
  edited?: Partial<Record<EditableField, unknown>>;   // auto lines: field the rep changed → the BUILDER's value
  builtDetail?: LineDetail;         // auto lines whose detail the rep changed (deriveLine): the builder's detail
  gmPct?: number;                   // std parts: catalog gross margin (std_parts.gm_pct); cost = sell × (1 − gmPct). Never moves sell.
}

/** Fields a rep can change on a line (what `edited` tracks and a rebuild preserves). */
export type EditableField = 'qty' | 'unitCost' | 'markupPct' | 'unitSell' | 'description' | 'category' | 'kind';
export const EDITABLE_FIELDS: EditableField[] = ['qty', 'unitCost', 'markupPct', 'unitSell', 'description', 'category', 'kind'];

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
  removed?: string[];               // refs of auto lines the rep deleted: they stay deleted on rebuild
  steelCostDate?: string;           // steel_cost.effective the auto lines were built at
}

export interface Settings {
  shop_rate: number; onsite_rate: number; pm_rate: number; cad_rate: number; pe_rate: number;
  freestanding_pv_per_shop_hour: number; one_pct_adder: { on: boolean }; sales_tax_rate: number;
  labor_cost_shop?: number; labor_cost_site?: number;      // internal cost per hour for margin
  std_parts_default_gm_pct?: number;                       // std parts with no gm_pct in the catalog (default 0.30)
  min_gm_pct?: number;                                     // MIN_GM approval floor (default 0.25)
  max_discount_pct?: number;                               // BIG_DISCOUNT approval above this (default 0.10)
  banned_strings: string[];
}

export interface PricedLine extends QuoteLine { cost: number; sell: number; hours: number }
export type FlagRule = 'INSTALL_BELOW_SUGGESTED' | 'INSTALL_MANUAL_NO_SUGGESTION' | 'PV_BELOW_FLOOR' | 'CLASS_D' | 'FAMILY_PV_DROP';
/** A policy flag. `detail` is what an approval covers (hashed on the server), so it holds only rounded,
 *  order-independent numbers. `section` / `lineKeys` say where the editor shows it inline (not hashed). */
export type Flag = { rule: FlagRule; detail: Record<string, unknown>; section?: SectionKey; lineKeys?: string[] };
export interface FlagDef {
  id: string;                       // lower-case id used by the UI
  rule: FlagRule;                   // value stored in Flag.rule / approvals.rule
  label: string;
  section?: SectionKey;             // where the editor shows it; undefined = whole quote
  explain(detail: Record<string, unknown>): string;
}
const h1 = (x: unknown) => `${Number(x ?? 0).toFixed(1)} h`;
/** Policy rules that need a sales manager's approval before the quote can be sent. */
export const flags: FlagDef[] = [
  { id: 'install_below_suggested', rule: 'INSTALL_BELOW_SUGGESTED', label: 'Install below suggested', section: 'install',
    explain: d => `Install ${h1(d.quoted)} is below the suggested ${h1(d.suggested)} (rebuilt from the spec) — needs a sales manager.` },
  { id: 'install_manual_no_suggestion', rule: 'INSTALL_MANUAL_NO_SUGGESTION', label: 'Install hours typed by hand', section: 'install',
    explain: d => `Install ${h1(d.quoted)} has no auto-built suggestion to check against — needs a sales manager.` },
  { id: 'pv_below_floor', rule: 'PV_BELOW_FLOOR', label: 'Production value below floor', section: 'costBased',
    explain: d => `Production value $${d.used}/shop h is below the $${d.floor} floor.` },
  { id: 'family_pv_drop', rule: 'FAMILY_PV_DROP', label: 'Production value dropped', section: 'costBased',
    explain: d => `Production value counts ${h1(d.used)} of the ${h1(d.expected)} freestanding shop hours (family ${d.family}) — needs a sales manager.` },
  { id: 'class_d', rule: 'CLASS_D', label: 'Class D duty', explain: () => 'Wording calls for Class D duty — needs a sales manager.' },
];
export const flagDef = (rule: FlagRule) => flags.find(f => f.rule === rule);

// Product family → builder factor family, without importing the builders (keeps manual.ts light).
const FAM: Record<string, string> = { freestanding: 'freestanding', bridge: 'bridge', gantry: 'gantry', monorail: 'monorail', mezzanine: 'mezzanine',
  work_platform: 'work_platform', jib: 'jib', fall_protection: 'fall_protection', vrc: 'vrc', catalog: 'other' };
const specItems = (doc: QuoteDoc): any[] => { const it = (doc.spec as any)?.items; return Array.isArray(it) ? it : []; };
/** S2: the quote's family. With a saved spec it comes from the first item's builder (the client's dropdown is ignored);
 *  without one it is the doc's own family. */
export function deriveFamily(doc: QuoteDoc): string {
  const t = specItems(doc)[0]?.type;
  return (t && FAM[t]) || doc.family;
}
/** S2: freestanding production-value shop hours, the way the app has always counted them (every shop-labor hour on a
 *  freestanding-family quote), with the family taken from the spec. The server sets doc.freestandingShopHours to this. */
export function pvHours(doc: QuoteDoc): number {
  if (deriveFamily(doc) !== 'freestanding') return 0;
  return doc.lines.filter(l => l.kind === 'shop_labor').reduce((a, l) => a + (Number.isFinite(l.qty) ? l.qty : 0), 0);
}
/** Shop hours that should earn production value: pvHours() plus, with no spec, shop lines built for a freestanding item. */
function pvExpected(doc: QuoteDoc): number {
  const byLines = doc.lines.filter(l => l.kind === 'shop_labor' && l.family === 'freestanding').reduce((a, l) => a + (Number.isFinite(l.qty) ? l.qty : 0), 0);
  return Math.max(pvHours(doc), byLines);
}
export type Lint = { level: 'error' | 'warning'; message: string };

export interface Priced {
  lines: PricedLine[];
  rollup: RollupResult;
  totals: { cost: number; sell: number; grossMargin: number; grossMarginPct: number; shopHours: number; installHours: number; cadHours: number; productionValue: number };
  flags: Flag[];
  lint: Lint[];
  /** How cost (and so GM) was worked out — the editor labels assumed numbers. */
  costBasis: { shopLaborPerHr: number; siteLaborPerHr: number; shopAssumed: boolean; siteAssumed: boolean; stdPartsGmLines: number; stdPartsGmAssumed: number };
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;

export function priceManual(doc: QuoteDoc, s: Settings): Priced {
  const rateFor: Record<LineKind, number> = {
    material: 0, shop_labor: s.shop_rate, site_labor: s.onsite_rate, travel: 0, equipment: 0,
    pm: s.pm_rate, cad: s.cad_rate, engineering: s.pe_rate,
  };
  const shopCost = s.labor_cost_shop ?? s.shop_rate * 0.59;   // SMT margin calc assumes 41% GM on shop labor
  const siteCost = s.labor_cost_site ?? s.onsite_rate * 0.53; // and 47% on on-site labor
  const defGm = s.std_parts_default_gm_pct ?? 0.3;
  let gmLines = 0, gmAssumed = 0;
  const lines: PricedLine[] = doc.lines.map(l => {
    if (l.kind === 'material' || l.kind === 'travel' || l.kind === 'equipment') {
      const sellPath = l.unitSell != null && l.unitCost == null;
      let cost = (l.unitCost ?? 0) * l.qty;
      const sell = sellPath ? l.unitSell! * l.qty : cost * (1 + (l.markupPct ?? 0) / 100);
      // S7: a standard part sold at catalog sell costs sell × (1 − GM) — not $0 (which showed 100% GM). Sell is untouched.
      if (sellPath && (l.gmPct != null || l.detail?.type === 'std' || l.category === 'stdParts')) {
        const gm = l.gmPct != null && Number.isFinite(l.gmPct) ? l.gmPct : defGm;
        cost = sell * (1 - gm); gmLines++; if (l.gmPct == null) gmAssumed++;
      }
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
  // S1: install hours are the hours on site-labor lines whatever their category; rounded once (0.1 h) after an
  // order-independent sum so reordering lines can't change an approval's hash. Deleting, moving or reclassifying
  // every site line still flags when the spec suggests install hours.
  const siteLines = lines.filter(l => l.kind === 'site_labor');
  const quotedInstall = r1(siteLines.map(l => l.hours).sort((a, b) => a - b).reduce((a, h) => a + h, 0));
  const sugg = doc.suggestedInstallHours;
  if (sugg != null && sugg > 0) {
    if (quotedInstall < r1(sugg)) flags.push({ rule: 'INSTALL_BELOW_SUGGESTED', detail: { quoted: quotedInstall, suggested: r1(sugg) }, section: 'install', lineKeys: siteLines.map(l => l.key) });
  } else if (sugg == null && siteLines.length) flags.push({ rule: 'INSTALL_MANUAL_NO_SUGGESTION', detail: { quoted: quotedInstall }, section: 'install', lineKeys: siteLines.map(l => l.key) });
  if (doc.pvPerHourOverride != null && doc.pvPerHourOverride < s.freestanding_pv_per_shop_hour && (doc.freestandingShopHours ?? 0) > 0)
    flags.push({ rule: 'PV_BELOW_FLOOR', detail: { used: doc.pvPerHourOverride, floor: s.freestanding_pv_per_shop_hour }, section: 'costBased' });
  // S2: no silent production-value drop (family dropdown switched away from freestanding, or PV hours under-reported).
  const pvExp = r1(pvExpected(doc)), pvUsed = r1(doc.freestandingShopHours ?? 0);
  if (pvExp > 0 && pvUsed < pvExp) flags.push({ rule: 'FAMILY_PV_DROP', detail: { expected: pvExp, used: pvUsed, family: doc.family }, section: 'costBased' });
  if (/class\s*d\b/i.test(doc.wording)) flags.push({ rule: 'CLASS_D', detail: {} });

  return {
    // S6: priced lines reference doc lines by key; detail / basis / edits live only in the doc (no double storage).
    lines: lines.map(({ detail: _d, basis: _b, edited: _e, builtDetail: _bd, ...l }) => ({ ...l, cost: r2(l.cost), sell: r2(l.sell) })),
    rollup: ro,
    totals: { cost: r2(cost), sell: r2(sell), grossMargin: r2(sell - cost), grossMarginPct: sell ? (sell - cost) / sell : 0, shopHours, installHours, cadHours, productionValue: r2(productionValue) },
    flags,
    lint: lintWording(doc, s),
    costBasis: { shopLaborPerHr: shopCost, siteLaborPerHr: siteCost, shopAssumed: s.labor_cost_shop == null, siteAssumed: s.labor_cost_site == null, stdPartsGmLines: gmLines, stdPartsGmAssumed: gmAssumed },
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
