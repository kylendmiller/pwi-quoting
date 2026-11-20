// deriveLine (round 3 S8): recompute a line's priced fields from its editable detail. Pure; used by the editor
// (shape / length / thickness / men × nights edits) and by the server when it checks an edited auto line.
//   steel: shape, length, qty → lb → cost @ $/lb → sell @ markup     plate: t × w × l × 0.2833 × drop
//   box: plf × ft × 1.03                                              vendor: list, PWI and customer discounts
//   labor: base hours × factor (or hours)                             travel: men × nights / days, rate
//   equipment: days / weeks / months × rate                           paint: runs × run rate
// deriveLine(line) with no edit leaves an auto line's priced fields exactly as the builder made them.
// On an auto line every priced field that changes is recorded in `edited` (field → the builder's value).
import type { QuoteLine, EditableField, LineDetail } from './manual';
import { EDITABLE_FIELDS } from './manual';
import { RULES } from './kit';

export interface LineEdit {
  qty?: number; description?: string; markupPct?: number; unitCost?: number; unitSell?: number;
  shape?: string; lengthFt?: number;
  tIn?: number; wIn?: number; lIn?: number;
  plf?: number;
  costPerLb?: number;
  sellEach?: number;
  costEach?: number;
  list?: number; pwiDiscPct?: number; customerDiscPct?: number;
  baseHrs?: number; factor?: number; hours?: number;
  men?: number; nights?: number; tripDays?: number; rate?: number;
  weeks?: number; crewDays?: number; period?: 'day' | 'week' | 'month';
  runs?: number; runRate?: number;
}
export interface DeriveCtx {
  shape?(name: string): { lbPerFt: number; pricePerLb: number; group?: string } | null;
  steelCost?: { perLb: Record<string, number> } | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;
const stem = (desc: string) => desc.split(' — ')[0];
const has = (e: LineEdit, ...k: (keyof LineEdit)[]) => k.some(x => e[x] !== undefined);
const num = (v: unknown, what: string) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what} must be a number.`);
  return v;
};
const paintUnits = (len: number) => Math.max(1, Math.ceil(len / RULES.paint.maxLenFt - 1e-9));
const same = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;

/** Records builder values for changed fields on auto lines; drops marks whose field is back at the builder value. */
function mark(before: QuoteLine, after: QuoteLine): QuoteLine {
  if (!before.auto) return after;
  const edited: Partial<Record<EditableField, unknown>> = { ...(before.edited ?? {}) };
  for (const f of EDITABLE_FIELDS) {
    const was = (before as any)[f], now = (after as any)[f];
    if (!same(was, now) && !(f in edited)) edited[f] = was;
    if (f in edited && same(edited[f], now)) delete edited[f];
  }
  const out: QuoteLine = { ...after };
  if (Object.keys(edited).length) out.edited = edited; else delete out.edited;
  if (!out.edited && out.builtDetail) { out.detail = out.builtDetail; delete out.builtDetail; }
  return out;
}

export function deriveLine(line: QuoteLine, edit: LineEdit = {}, ctx: DeriveCtx = {}): QuoteLine {
  const d0 = line.detail;
  let l: QuoteLine = { ...line };
  let d: LineDetail | undefined = d0 ? { ...d0 } as LineDetail : undefined;
  if (d) switch (d.type) {
    case 'steel': {
      if (edit.shape !== undefined && edit.shape !== d.shape) {
        const sh = ctx.shape?.(edit.shape);
        if (!sh) throw new Error(`Unknown shape ${edit.shape}`);
        const perLb = (sh.group ? ctx.steelCost?.perLb[sh.group] : undefined) ?? sh.pricePerLb;
        d = { ...d, shape: edit.shape, lbPerFt: sh.lbPerFt, priceGroup: sh.group, costPerLb: perLb, costSource: sh.group && ctx.steelCost?.perLb[sh.group] != null ? 'steel_cost' : 'catalog' };
      }
      if (edit.lengthFt !== undefined) d.lengthFt = num(edit.lengthFt, 'Length');
      if (edit.costPerLb !== undefined) d.costPerLb = num(edit.costPerLb, '$/lb');
      d.lbEach = d.lbPerFt * d.lengthFt;
      if (d.paintUnitsEach > 0) d.paintUnitsEach = paintUnits(d.lengthFt);
      l.unitCost = r2(d.lbEach * d.costPerLb);
      if (has(edit, 'shape', 'lengthFt')) l.description = `${stem(l.description)} — ${d.shape} × ${d.lengthFt}'`;
      break;
    }
    case 'plate': {
      if (edit.tIn !== undefined) d.tIn = num(edit.tIn, 'Thickness');
      if (edit.wIn !== undefined) d.wIn = num(edit.wIn, 'Width');
      if (edit.lIn !== undefined) d.lIn = num(edit.lIn, 'Length');
      if (edit.costPerLb !== undefined) d.costPerLb = num(edit.costPerLb, '$/lb');
      d.lbEach = d.tIn * d.wIn * d.lIn * d.lbPerIn3 * d.dropFactor;
      l.unitCost = r2(d.lbEach * d.costPerLb);
      if (has(edit, 'tIn', 'wIn', 'lIn')) l.description = `${stem(l.description)} — ${d.tIn}" × ${d.wIn}" × ${d.lIn}"`;
      break;
    }
    case 'box': {
      if (edit.plf !== undefined) d.plf = num(edit.plf, 'plf');
      if (edit.lengthFt !== undefined) d.lengthFt = num(edit.lengthFt, 'Length');
      if (edit.costPerLb !== undefined) d.costPerLb = num(edit.costPerLb, '$/lb');
      d.lbEach = d.plf * d.lengthFt * d.fabFactor;
      if (d.paintUnitsEach > 0) d.paintUnitsEach = paintUnits(d.lengthFt);
      l.unitCost = r2(d.lbEach * d.costPerLb);
      if (has(edit, 'plf', 'lengthFt')) l.description = `${stem(l.description)} — ${d.plf} plf × ${d.lengthFt}'`;
      break;
    }
    case 'std':
      if (edit.sellEach !== undefined) d.sellEach = num(edit.sellEach, 'Sell');
      l.unitSell = d.sellEach;
      break;
    case 'sell':
      if (edit.sellEach !== undefined) d.sellEach = num(edit.sellEach, 'Sell');
      l.unitSell = r2(d.sellEach);
      break;
    case 'vendor': {
      if (edit.list !== undefined) d.list = num(edit.list, 'List');
      if (edit.pwiDiscPct !== undefined) d.pwiDiscPct = num(edit.pwiDiscPct, 'PWI discount');
      if (edit.customerDiscPct !== undefined) d.customerDiscPct = num(edit.customerDiscPct, 'Customer discount');
      d.costEach = d.list * (1 - d.pwiDiscPct / 100); d.sellEach = d.list * (1 - d.customerDiscPct / 100);
      l.unitCost = r2(d.costEach);
      l.markupPct = d.costEach ? Math.round((d.sellEach / d.costEach - 1) * 10000) / 100 : 0;
      break;
    }
    case 'cost':
      if (edit.costEach !== undefined) d.costEach = num(edit.costEach, 'Cost');
      if (edit.markupPct !== undefined) d.markupPct = num(edit.markupPct, 'Markup');
      l.unitCost = r2(d.costEach); l.markupPct = d.markupPct;
      break;
    case 'labor':
      if (edit.baseHrs !== undefined) d.baseHrs = num(edit.baseHrs, 'Base hours');
      if (edit.factor !== undefined) d.factor = num(edit.factor, 'Factor');
      if (has(edit, 'baseHrs', 'factor')) { d.hours = r1(d.baseHrs * d.factor); l.qty = d.hours; }
      if (edit.hours !== undefined) { d.hours = num(edit.hours, 'Hours'); l.qty = d.hours; }
      break;
    case 'pmcad':
      if (edit.hours !== undefined) { d.hours = num(edit.hours, 'Hours'); l.qty = d.hours; }
      break;
    case 'paint':
      if (edit.runs !== undefined) l.qty = num(edit.runs, 'Runs');
      if (edit.runRate !== undefined) { d.runRate = num(edit.runRate, 'Run rate'); l.unitSell = d.runRate; }
      break;
    case 'travel': {
      const men0 = d.men;
      if (edit.men !== undefined) d.men = num(edit.men, 'Men');
      if (edit.nights !== undefined) { d.nights = num(edit.nights, 'Nights'); d.tripDays = d.nights + 1; }
      if (edit.tripDays !== undefined) { d.tripDays = num(edit.tripDays, 'Days'); d.nights = Math.max(0, d.tripDays - 1); }
      if (edit.rate !== undefined) { d.rate = num(edit.rate, 'Rate'); l.unitCost = d.rate; }
      if (edit.markupPct !== undefined) d.markupPct = num(edit.markupPct, 'Markup');
      if (has(edit, 'men', 'nights', 'tripDays')) {
        const nights = d.nights ?? 0, days = d.tripDays ?? nights + 1;
        if (d.what === 'hotel') { l.qty = d.men * nights; l.description = `Hotels — ${d.men} rooms × ${nights} nights`; }
        else if (d.what === 'per_diem') { l.qty = d.men * days; l.description = `Per diem — ${d.men} men × ${days} days`; }
        else if (d.what === 'flight') l.qty = d.men;
        else if (d.what === 'travel_time' && men0 > 0) { l.qty = Math.round(l.qty * d.men / men0); l.description = `Travel (${d.mode}, ${d.men} men, ${d.miles} mi)`; }
      }
      break;
    }
    case 'equipment': {
      if (edit.weeks !== undefined) d.weeks = num(edit.weeks, 'Weeks');
      if (edit.crewDays !== undefined) d.crewDays = num(edit.crewDays, 'Days');
      if (edit.period !== undefined) d.period = edit.period;
      if (has(edit, 'weeks', 'crewDays', 'period') && d.rates) {
        const unit = d.period === 'day' ? d.rates.daily * d.crewDays : d.period === 'week' ? d.rates.weekly * d.weeks : d.rates.monthly * d.weeks / 4;
        l.unitCost = r2(unit);
        l.description = `${d.item} — ${d.period === 'day' ? `${d.crewDays} day` : `${d.weeks} wk`}`;
      }
      break;
    }
    default: break;
  }
  if (d) l.detail = d;
  // plain field edits last (they win over what the detail derived)
  if (edit.qty !== undefined) l.qty = num(edit.qty, 'Qty');
  if (edit.description !== undefined) l.description = String(edit.description);
  if (edit.markupPct !== undefined && d?.type !== 'cost') l.markupPct = num(edit.markupPct, 'Markup');
  if (edit.unitCost !== undefined) l.unitCost = num(edit.unitCost, 'Unit cost');
  if (edit.unitSell !== undefined) l.unitSell = num(edit.unitSell, 'Unit sell');
  if (l.detail?.type === 'labor' && edit.qty !== undefined) l.detail = { ...l.detail, hours: l.qty };
  if (line.auto && d0 && JSON.stringify(d0) !== JSON.stringify(l.detail) && !line.builtDetail) l.builtDetail = d0;
  return mark(line, l);
}

/** A plain field edit (no detail math) with the same `edited` bookkeeping as deriveLine. */
export function editLine(line: QuoteLine, patch: Partial<Pick<QuoteLine, EditableField>>): QuoteLine {
  return mark(line, { ...line, ...patch });
}

/** Puts one field back to the builder's value and drops its mark (all marks gone → the built detail is restored). */
export function revertField(line: QuoteLine, field: EditableField): QuoteLine {
  if (!line.edited || !(field in line.edited)) return line;
  const edited = { ...line.edited }; const v = edited[field]; delete edited[field];
  const out: any = { ...line, [field]: v };
  if (Object.keys(edited).length) out.edited = edited;
  else { delete out.edited; if (out.builtDetail) { out.detail = out.builtDetail; delete out.builtDetail; } }
  return out;
}

/** Steel / plate / built-up weight of the line at its current qty. */
export function lineLb(line: QuoteLine): number | undefined {
  const d = line.detail;
  return d && (d.type === 'steel' || d.type === 'plate' || d.type === 'box') ? d.lbEach * line.qty : undefined;
}
