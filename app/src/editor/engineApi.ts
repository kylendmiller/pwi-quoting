// The ONE place the quote editor talks to the engine (Track U ↔ Track S).
//
// Everything here is Track S's real engine (src/engine/**, see docs/round3/S-API.md). The only things this file
// adds are the editor's cell-level view of S's edit model:
//   • S records rep edits on auto lines as `line.edited` (priced field → builder value) and, when a detail value
//     (shape, length, thickness, list, base hours …) moved, keeps the builder's detail in `line.builtDetail`.
//   • The grids address cells by path ('qty', 'markupPct', 'detail.shape', 'detail.lengthFt' …).
//   changedPaths() turns S's model into { cellPath: builderValue } for amber cells, and editCell / revertCell turn a
//   cell edit / per-cell revert back into deriveLine / editLine / revertField calls.
// Nothing here changes a price on an unedited quote: priceManual is the only pricing path, fed exactly like the server.
import { priceManual, deriveFamily, pvHours, flagDef, EDITABLE_FIELDS,
  type QuoteDoc, type QuoteLine, type Settings, type Priced, type PricedLine, type Flag, type EditableField, type QuoteMoney } from '../../../src/engine/manual';
import { sectionize as sectionizeS, type SectionTree } from '../../../src/engine/sections';
import { deriveLine, editLine, revertField, lineLb, type LineEdit, type DeriveCtx } from '../../../src/engine/deriveLine';
import { planRebuild, applyPlan, type RebuildPlan, type LineChange, type SectionMoney } from '../../../src/engine/rebuildPlan';
import { ensureRefs, type Conflict } from '../../../src/engine/buildSpec';
import { parseNum, parseFtIn, parseNumResult } from '../../../src/engine/parseNum';
import { deltaDoc } from '../../../src/engine/changeOrder';
import { readSteelCost } from '../../../src/engine/kit';

// ---------------------------------------------------------------- straight re-exports of Track S
export { deriveLine, editLine, revertField, lineLb, planRebuild, applyPlan, parseNum, parseFtIn, parseNumResult, deltaDoc, deriveFamily, pvHours, flagDef, ensureRefs };
export type { LineEdit, DeriveCtx, RebuildPlan, LineChange, SectionMoney, Conflict, QuoteMoney, EditableField };

/** Which Track S pieces are wired in. crewDays: the spec has no crew-days field yet (see setCrewDaysFallback). */
export const S_READY = { deriveLine: true, planRebuild: true, parseNum: true, deltaDoc: true, crewDays: false, stdCost: true, refs: true };

// ---------------------------------------------------------------- types the editor relies on
/** S's QuoteLine already carries ref / source / edited / builtDetail / gmPct. */
export type EditorLine = QuoteLine;
export type EditorDoc = QuoteDoc;
export type Choices = Record<string /* Conflict.id */, 'mine' | 'builder'>;
export const linesOf = (d: QuoteDoc) => d.lines as EditorLine[];

export const sectionize = (doc: QuoteDoc, priced: Priced): SectionTree => sectionizeS(doc, priced, { includeEmpty: true });

// ---------------------------------------------------------------- pricing exactly like the server
/** The doc as the server prices it: family from the spec (S2) and freestanding PV hours from pvHours (S2). */
export function effectiveDoc(doc: QuoteDoc): QuoteDoc {
  const d = { ...doc };
  d.family = deriveFamily(d);
  d.freestandingShopHours = pvHours(d);
  return d;
}
export const price = (doc: QuoteDoc, s: Settings): Priced => priceManual(effectiveDoc(doc), s);
/** The customer numbers (S9): each part rounded once, total = sum of the parts. Never sum rounded rows. */
export const quoteMoney = (p: Priced): QuoteMoney => p.quote;
/** Whether the pre-use row prints (priced.quote.preUse is 0 when hidden; the rollup keeps null). */
export const showsPreUse = (p: Priced) => p.rollup?.quote?.preUse != null;
/** S: priced.costBasis.*Assumed → label labor GM as "assumed labor cost". */
export const laborCostAssumed = (p: Priced): boolean => !!(p.costBasis?.shopAssumed || p.costBasis?.siteAssumed);
export const minGmPct = (s: any) => Number(s?.min_gm_pct ?? 0.25);
export const maxDiscountPct = (s: any) => Number(s?.max_discount_pct ?? 0.1);

/** S6: priced lines no longer carry detail / basis / edits. Join them back from the doc (by key) for display. */
export function joinLines(doc: QuoteDoc, priced: Priced): PricedLine[] {
  const by = new Map(doc.lines.map(l => [l.key, l]));
  return priced.lines.map(p => { const l = by.get(p.key); return l ? { ...l, ...p, detail: l.detail, basis: l.basis, edited: l.edited, builtDetail: l.builtDetail } : p; });
}

/** Mirrors priceManual: a sell-only material line has a cost when it is a standard part (S7, cost = sell × (1 − gm)).
 *  Other sell-only lines (decals, paint runs, stairways …) keep no cost, so their GM is unknown. */
const SELL_ONLY_ROWS = ['stdParts', 'decals', 'painting', 'ultraLitePcr', 'stairStringerPcr', 'stairways', 'workPlatforms', 'vrc', 'concrete'];
export function stdCostKnown(l: QuoteLine): boolean {
  const sellPath = l.unitSell != null && l.unitCost == null && (l.kind === 'material' || l.kind === 'travel' || l.kind === 'equipment');
  if (!sellPath) return true;
  if (l.gmPct != null || l.detail?.type === 'std' || l.category === 'stdParts') return true;
  if (l.unitSell! < 0) return true;                 // a credit / discount line: GM effect is known (all of it)
  return !SELL_ONLY_ROWS.includes(l.category);     // e.g. a price adjustment in Cost Based has no cost: GM is known
}

// ---------------------------------------------------------------- cell paths ↔ S's edit model
export const getPath = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const same = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);

/** Detail values a rep types into a grid, per detail type (these show amber as `detail.<k>`). */
const INPUT_KEYS: Record<string, string[]> = {
  steel: ['shape', 'lengthFt', 'costPerLb'], plate: ['tIn', 'wIn', 'lIn', 'costPerLb'], box: ['plf', 'lengthFt', 'costPerLb'],
  vendor: ['list', 'pwiDiscPct', 'customerDiscPct'], labor: ['baseHrs', 'factor'],
  travel: ['men', 'nights', 'tripDays', 'rate'], equipment: ['weeks', 'crewDays', 'period'],
};
/** Priced fields deriveLine recomputes from those detail values. While a detail value is changed these marks are
 *  shown on the detail cell (the cause), not on the cost / description cells it moved. */
const DERIVED: Record<string, EditableField[]> = {
  steel: ['unitCost', 'description'], plate: ['unitCost', 'description'], box: ['unitCost', 'description'],
  vendor: ['unitCost', 'markupPct'], labor: ['qty'], travel: ['qty', 'description', 'unitCost'], equipment: ['unitCost', 'description'],
};
/** Grid cells whose value lives in the detail but is shown on a priced column. */
const CELL_TO_EDIT: Record<string, Partial<Record<string, keyof LineEdit>>> = {
  std: { unitSell: 'sellEach' }, sell: { unitSell: 'sellEach' }, paint: { unitSell: 'runRate' }, cost: { unitCost: 'costEach', markupPct: 'markupPct' },
};

function detailDiffs(l: QuoteLine): string[] {
  const d: any = l.detail, b: any = l.builtDetail;
  if (!d || !b || d.type !== b.type) return [];
  return (INPUT_KEYS[d.type] ?? []).filter(k => !same(d[k], b[k]));
}

/** Cells the rep changed on a line → the builder's value (amber cells, per-cell revert, "N changed" badges). */
export function changedPaths(l: QuoteLine): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const dd = detailDiffs(l);
  for (const k of dd) out[`detail.${k}`] = (l.builtDetail as any)[k];
  const hide = dd.length ? DERIVED[l.detail!.type] ?? [] : [];
  for (const [f, v] of Object.entries(l.edited ?? {})) if (!hide.includes(f as EditableField)) out[f] = v;
  return out;
}
export const isChanged = (l: QuoteLine, path: string) => path in changedPaths(l);

/** Drop builtDetail once the detail is back to it. */
function tidy(l: QuoteLine): QuoteLine {
  if (l.builtDetail && JSON.stringify(l.builtDetail) === JSON.stringify(l.detail)) { const { builtDetail: _b, ...rest } = l; return rest; }
  return l;
}

/** One grid cell edit. Detail cells go through deriveLine (shape / length / thickness → lb → cost → sell);
 *  plain fields through deriveLine too when the line has a detail (labor hours, std sell), else editLine. */
export function editCell(l: QuoteLine, path: string, value: unknown, ctx: DeriveCtx = {}): QuoteLine {
  if (path.startsWith('detail.')) return tidy(deriveLine(l, { [path.slice(7)]: value } as LineEdit, ctx));
  const t = l.detail?.type;
  const mapped = t ? CELL_TO_EDIT[t]?.[path] : undefined;
  if (mapped) return tidy(deriveLine(l, { [mapped]: value } as LineEdit, ctx));
  if (path === 'qty' && t) return tidy(deriveLine(l, { qty: value as number }, ctx));
  if ((EDITABLE_FIELDS as string[]).includes(path)) return editLine(l, { [path]: value } as any);
  return { ...l, [path]: value };
}

/** Per-cell revert back to the builder's value. */
export function revertCell(l: QuoteLine, path: string, ctx: DeriveCtx = {}): QuoteLine {
  if (path.startsWith('detail.')) {
    const k = path.slice(7), b: any = l.builtDetail;
    if (!b) return l;
    const rest = detailDiffs(l).filter(x => x !== k);
    if (!rest.length) return restoreDetail(l);
    const d: any = { ...l.detail, [k]: b[k] };
    if (k === 'shape') { d.lbPerFt = b.lbPerFt; d.priceGroup = b.priceGroup; if (!rest.includes('costPerLb')) { d.costPerLb = b.costPerLb; d.costSource = b.costSource; } }
    return tidy(deriveLine({ ...l, detail: d }, { [k]: b[k] } as LineEdit, ctx));
  }
  if (!l.edited || !(path in l.edited)) return l;
  let out = revertField(l, path as EditableField);
  if (path === 'qty' && out.detail?.type === 'labor') out = { ...out, detail: { ...out.detail, hours: out.qty } };
  return tidy(out);
}
/** All of the line's detail back to the builder's, with the priced fields it derived. */
function restoreDetail(l: QuoteLine): QuoteLine {
  if (!l.builtDetail) return l;
  let out: QuoteLine = { ...l, detail: l.builtDetail };
  delete out.builtDetail;
  for (const f of DERIVED[l.builtDetail.type] ?? []) if (out.edited && f in out.edited) out = revertField(out, f);
  return out;
}
/** Every change on the line back to the builder's values. */
export function revertLine(l: QuoteLine): QuoteLine {
  let out = restoreDetail(l);
  for (const f of Object.keys(out.edited ?? {}) as EditableField[]) out = revertField(out, f);
  return out;
}

/** deriveLine lookups from the app's shape table + the dated steel_cost setting (same $/lb the builder uses). */
export function deriveCtx(shapes: { shape: string; lb_per_ft: number; price_group: string }[], groups: Record<string, number>, settings: any): DeriveCtx {
  const sc = readSteelCost(settings?.steel_cost).sc;
  return {
    shape: name => { const s = shapes.find(x => x.shape === name); return s ? { lbPerFt: Number(s.lb_per_ft), pricePerLb: Number(groups[s.price_group] ?? 0), group: s.price_group } : null; },
    steelCost: sc,
  };
}

// ---------------------------------------------------------------- deleting auto lines (S5 doc.removed)
/** Removes a line. An auto line's ref goes to doc.removed so a rebuild keeps it deleted. */
export function removeLine(doc: QuoteDoc, key: string): { doc: QuoteDoc; ref?: string; line?: QuoteLine } {
  const d = doc.lines.some(l => l.key === key && l.auto && !l.ref) ? ensureRefs(doc) : doc;
  const l = d.lines.find(x => x.key === key);
  if (!l) return { doc };
  const removed = l.auto && l.ref ? [...new Set([...(d.removed ?? []), l.ref])] : d.removed;
  return { doc: { ...d, lines: d.lines.filter(x => x.key !== key), ...(removed ? { removed } : {}) }, ref: l.auto ? l.ref : undefined, line: l };
}
/** Puts a removed auto line back (and drops its ref from doc.removed). */
export function restoreLine(doc: QuoteDoc, line: QuoteLine): QuoteDoc {
  return { ...doc, lines: [...doc.lines, line], removed: (doc.removed ?? []).filter(r => r !== line.ref) };
}

// ---------------------------------------------------------------- policy flags (S11)
export const flagText = (f: { rule: string; detail?: Record<string, unknown> }) => {
  const d = flagDef(f.rule as any);
  return d ? d.explain(f.detail ?? {}) : null;
};

// ---------------------------------------------------------------- target price (U10)
/** The one "Price adjustment" line. A discount is a material line with a NEGATIVE unitSell (a credit, per S-API):
 *  it sits in Cost Based (Base, carries the 1% like the SMT row), and the engine raises BIG_DISCOUNT / MIN_GM from it. */
export const ADJ_KEY = 'price-adjust';
export function withAdjustment(doc: QuoteDoc, amt: number): QuoteDoc {
  const lines = doc.lines.filter(l => l.key !== ADJ_KEY);
  if (Math.abs(amt) < 0.005) return { ...doc, lines };
  const l: QuoteLine = { key: ADJ_KEY, kind: 'material', category: 'costBased', family: doc.family, description: amt < 0 ? 'Price adjustment (discount)' : 'Price adjustment',
    qty: 1, unitSell: Math.round(amt * 100) / 100, role: 'other', source: 'hand' };
  return { ...doc, lines: [...lines, l] };
}
/** The adjustment that makes priced.quote.total land on `target` (the 1% and tax worked in). Replaces, never stacks. */
export function targetAdjustment(doc: QuoteDoc, s: Settings, target: number): { amount: number; doc: QuoteDoc; priced: Priced } | null {
  const base0 = withAdjustment(doc, 0), t0 = price(base0, s).quote.total;
  const slope = (price(withAdjustment(base0, -1000), s).quote.total - t0) / -1000;
  if (!slope || !Number.isFinite(target)) return null;
  let amount = Math.round(((target - t0) / slope) * 100) / 100;
  let d = withAdjustment(base0, amount), p = price(d, s);
  // one cent-nudge so rounding of the parts doesn't leave the total a cent off
  const off = Math.round((p.quote.total - target) * 100) / 100;
  if (off !== 0 && Math.abs(off) <= 0.05) { const a2 = Math.round((amount - off / slope) * 100) / 100; const d2 = withAdjustment(base0, a2), p2 = price(d2, s);
    if (Math.abs(p2.quote.total - target) < Math.abs(off)) { amount = a2; d = d2; p = p2; } }
  return { amount, doc: d, priced: p };
}

// ---------------------------------------------------------------- crew days (U7)
export const HOURS_PER_DAY = 10;   // rules/freestanding_rules.json crew.hoursPerDay
/** The spec has no crew-days field (Track S added crewMen only; deriveLine edits travel / equipment per line).
 *  So a days change adds one hand "Install adjustment" line making site hours = men × days × 10 h;
 *  travel and equipment do NOT follow yet (the UI says so). A crew-men change is a spec edit (rebuild dialog). */
export function setCrewDaysFallback(doc: QuoteDoc, men: number, days: number, family: string): QuoteDoc {
  const KEY = 'install-adjust-days';
  const others = linesOf(doc).filter(l => l.key !== KEY);
  const site = others.filter(l => l.kind === 'site_labor').reduce((a, l) => a + l.qty, 0);
  const delta = Math.round((men * days * HOURS_PER_DAY - site) * 10) / 10;
  const lines = delta === 0 ? others : [...others, { key: KEY, kind: 'site_labor', category: 'onsiteLabor', family, description: `Install adjustment (crew ${men} men × ${days} days)`, qty: delta, laborOp: 'site_other', role: 'install', source: 'hand' } as EditorLine];
  return { ...doc, lines };
}

/** Flags raised / cleared between two priced results (rule + detail). */
export function flagDiff(before: Priced, after: Priced): { raised: Flag[]; cleared: Flag[] } {
  const k = (f: Flag) => `${f.rule}|${JSON.stringify(f.detail)}`;
  const a = new Set(before.flags.map(k)), b = new Set(after.flags.map(k));
  return { raised: after.flags.filter(f => !a.has(k(f))), cleared: before.flags.filter(f => !b.has(k(f))) };
}
