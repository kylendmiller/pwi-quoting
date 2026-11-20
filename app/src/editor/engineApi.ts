// The ONE place the new quote editor talks to the engine (Track U ↔ Track S).
//
// Track S (branch round3-s) is adding pure engine helpers: deriveLine, planRebuild / applyPlan,
// parseNum, deltaDoc, stable refs, `edited` maps on auto lines, std-part cost from gm_pct, crewDays
// in the spec. Until those land on this branch, every function below is a client-side FALLBACK with
// the same name and shape. Swapping in S's real functions is a change to this file only:
//   1. replace the fallback body with `export { deriveLine } from '../../../src/engine/derive'` (etc.)
//   2. flip the matching S_READY flag to true (the UI uses it to hide "pending engine update" notes).
// Nothing here changes a price on an unedited quote: priceManual is still the only pricing path.
import { priceManual, type QuoteDoc, type QuoteLine, type Settings, type Priced, type Flag } from '../../../src/engine/manual';
import { sectionize as sectionizeC, type SectionTree } from '../../../src/engine/sections';
import { buildFromSpec, type QuoteSpec } from '../../../src/engine/buildSpec';
import type { Catalog } from '../../../src/engine/kit';
import type { CategoryKey } from '../../../src/engine/rollup';
import { ROW } from '../../../src/engine/rollup';

/** Which Track S functions are real (true) vs the fallbacks below (false). */
export const S_READY = { deriveLine: false, planRebuild: false, parseNum: false, deltaDoc: false, crewDays: false, stdCost: false, refs: false };

// ---------------------------------------------------------------- types the editor relies on
/** QuoteLine plus the round-3 editing fields (S4/S5). All optional so old docs load unchanged. */
export type EditorLine = QuoteLine & {
  ref?: string;                              // S4 stable ref (itemId:slot). Fallback: refOf() below
  edited?: Record<string, unknown>;          // S5 { fieldPath: builderValue } for fields the rep changed on an auto line
  source?: 'hand' | 'auto';                  // S3 hand lines are marked source:'hand'
};
export type EditorDoc = QuoteDoc & { lines: EditorLine[]; removed?: string[] };

export const linesOf = (d: QuoteDoc) => d.lines as EditorLine[];

// ---------------------------------------------------------------- sectionize (exists on round3-c)
export const sectionize = (doc: QuoteDoc, priced: Priced): SectionTree => sectionizeC(doc, priced, { includeEmpty: true });

// ---------------------------------------------------------------- pricing helpers
/** The doc exactly as Save will send it (freestanding PV hours filled in), so screen = saved price.
 *  TODO(S2): the server will derive PV hours from the spec; then this only mirrors it for display. */
export function effectiveDoc(doc: QuoteDoc): QuoteDoc {
  const shop = doc.lines.filter(l => l.kind === 'shop_labor').reduce((s, l) => s + (l.qty || 0), 0);
  return doc.family === 'freestanding' ? { ...doc, freestandingShopHours: shop } : { ...doc, freestandingShopHours: 0 };
}
export const price = (doc: QuoteDoc, s: Settings): Priced => priceManual(effectiveDoc(doc), s);

/** Std-part cost each. TODO(S7): S sets cost = sell × (1 − std_parts.gm_pct) in the engine; until then
 *  std parts carry no cost, so their GM is unknown (never shown as 100%). */
export function stdCostKnown(l: QuoteLine): boolean {
  return S_READY.stdCost || !(l.unitSell != null && l.unitCost == null && l.kind === 'material');
}

// ---------------------------------------------------------------- parseNum (safe arithmetic, no eval)
/** "=2*40+6", "20'6\"", "20' 6", "1,250", "(3+4)/2". Returns null when not a finite number ≥ −1e9..1e9.
 *  TODO(S): swap for S's parseNum when published (same contract). */
export function parseNum(input: string): number | null {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (s.length > 64) return null;
  if (s.startsWith('=')) s = s.slice(1);
  s = s.replace(/[$,\s]/g, (m) => (m === ' ' ? ' ' : ''));
  // feet-inches: 20'6", 20'-6", 20' 6, 6"
  const fi = /^(-?\d+(?:\.\d+)?)\s*'\s*-?\s*(?:(\d+(?:\.\d+)?)\s*"?)?$/.exec(s);
  if (fi) return round6(Number(fi[1]) + (fi[2] ? Number(fi[2]) / 12 : 0));
  const inch = /^(\d+(?:\.\d+)?)\s*"$/.exec(s);
  if (inch) return round6(Number(inch[1]) / 12);
  s = s.replace(/\s+/g, '');
  if (!/^[0-9.+\-*/()%]+$/.test(s)) return null;
  // recursive-descent: expr = term (('+'|'-') term)*, term = factor (('*'|'/') factor)*, factor = ('-')? (num | '(' expr ')') ('%')?
  let i = 0;
  const peek = () => s[i];
  const num = (): number => {
    const m = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(s.slice(i)) ?? /^\d+\.?/.exec(s.slice(i));
    if (!m) throw 0; i += m[0].length; return Number(m[0]);
  };
  const factor = (): number => {
    let neg = false; while (peek() === '-' || peek() === '+') { if (peek() === '-') neg = !neg; i++; }
    let v: number;
    if (peek() === '(') { i++; v = expr(); if (peek() !== ')') throw 0; i++; } else v = num();
    if (peek() === '%') { i++; v = v / 100; }
    return neg ? -v : v;
  };
  const term = (): number => { let v = factor(); while (peek() === '*' || peek() === '/') { const op = s[i++]; const r = factor(); v = op === '*' ? v * r : v / r; } return v; };
  const expr = (): number => { let v = term(); while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  try {
    const v = expr();
    if (i !== s.length || !isFinite(v) || Math.abs(v) > 1e9) return null;
    return round6(v);
  } catch { return null; }
}
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

// ---------------------------------------------------------------- deriveLine (S8)
const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;
/** Recompute qty / unitCost / markup / unitSell from a line's editable detail, with the same rounding Kit uses.
 *  TODO(S8): replace with `deriveLine` from src/engine (S publishes it in S-API.md). */
export function deriveLine<T extends QuoteLine>(l: T): T {
  const d: any = l.detail; if (!d) return l;
  const ov = (l as EditorLine).edited ?? {};
  switch (d.type) {
    case 'steel': {
      const lbEach = d.lbPerFt * d.lengthFt;
      const out = { ...l, detail: { ...d, lbEach }, unitCost: r2(lbEach * d.costPerLb) };
      return { ...out, description: retitle(l.description, `${d.shape} × ${fmtFt(d.lengthFt)}`) };
    }
    case 'plate': {
      const lbEach = d.tIn * d.wIn * d.lIn * (d.lbPerIn3 ?? 0.2833) * d.dropFactor;
      return { ...l, detail: { ...d, lbEach }, unitCost: r2(lbEach * d.costPerLb), description: retitle(l.description, `${d.tIn}" × ${d.wIn}" × ${d.lIn}"`) };
    }
    case 'box': {
      const lbEach = d.plf * d.lengthFt * (d.fabFactor ?? 1.03);
      return { ...l, detail: { ...d, lbEach }, unitCost: r2(lbEach * d.costPerLb), description: retitle(l.description, `${d.plf} plf × ${fmtFt(d.lengthFt)}`) };
    }
    case 'vendor': {
      const cost = d.list * (1 - d.pwiDiscPct / 100), sell = d.list * (1 - d.customerDiscPct / 100);
      return { ...l, detail: { ...d, costEach: cost, sellEach: sell }, unitCost: r2(cost), markupPct: cost ? Math.round((sell / cost - 1) * 10000) / 100 : 0 };
    }
    case 'std': return { ...l, unitSell: d.sellEach };
    case 'labor': {
      const hours = r1(d.baseHrs * d.factor);
      return 'qty' in ov ? { ...l, detail: { ...d, hours } } : { ...l, qty: hours, detail: { ...d, hours } };
    }
    default: return l;
  }
}
const fmtFt = (ft: number) => `${Math.round(ft * 100) / 100}'`;
/** "Runways — W12 x 26 × 25'" → keeps the "Runways — " stem and replaces the size part. */
function retitle(desc: string, size: string) {
  const i = desc.indexOf(' — ');
  return i >= 0 ? `${desc.slice(0, i)} — ${size}` : desc;
}

// ---------------------------------------------------------------- edits on auto lines (S5 `edited`)
export const getPath = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
export function setPath<T>(o: T, path: string, v: unknown): T {
  const [h, ...rest] = path.split('.');
  if (!rest.length) return { ...(o as any), [h]: v };
  return { ...(o as any), [h]: setPath((o as any)?.[h] ?? {}, rest.join('.'), v) };
}
const same = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);

/** Change one field on a line. Auto lines remember the builder's value (edited[path]); typing the builder's value
 *  back clears the mark. Detail edits re-derive cost/sell/hours. */
export function editLine(l: EditorLine, path: string, value: unknown): EditorLine {
  const before = getPath(l, path);
  let next: EditorLine = setPath(l, path, value);
  if (l.auto) {
    const ed = { ...(l.edited ?? {}) };
    if (!(path in ed)) ed[path] = before;
    if (same(ed[path], value)) delete ed[path];
    next = { ...next, edited: ed };
    if (!Object.keys(ed).length) delete (next as any).edited;
  }
  return path.startsWith('detail.') || path === 'qty' ? deriveLine(next) : next;
}
export function revertField(l: EditorLine, path: string): EditorLine {
  if (!l.edited || !(path in l.edited)) return l;
  const ed = { ...l.edited }; const v = ed[path]; delete ed[path];
  const next: EditorLine = { ...setPath(l, path, v), ...(Object.keys(ed).length ? { edited: ed } : {}) };
  if (!Object.keys(ed).length) delete (next as any).edited;
  return path.startsWith('detail.') ? deriveLine(next) : next;
}
export function revertLine(l: EditorLine): EditorLine {
  let out = l; for (const p of Object.keys(l.edited ?? {})) out = revertField(out, p); return out;
}

// ---------------------------------------------------------------- stable refs (S4)
const stem = (d: string) => d.split(' — ')[0].replace(/\(.*?\)/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
/** Stable ref per auto line. TODO(S4): S stores `ref = itemId:slot` on every built line; the fallback
 *  (item index | role | description stem | n) breaks when items are reordered — the rebuild dialog says so. */
export function withRefs(lines: EditorLine[]): (EditorLine & { _ref: string })[] {
  const seen = new Map<string, number>();
  return lines.map(l => {
    if (l.ref) return { ...l, _ref: l.ref };
    const b = `${l.item ?? 'x'}|${l.role ?? l.category}|${stem(l.description)}`;
    const n = (seen.get(b) ?? 0) + 1; seen.set(b, n);
    return { ...l, _ref: `${b}|${n}` };
  });
}
export const refOf = (doc: QuoteDoc, key: string) => withRefs(linesOf(doc)).find(l => l.key === key)?._ref;

// ---------------------------------------------------------------- planRebuild / applyPlan (S5)
export interface FieldChange { field: string; from: unknown; to: unknown }
export interface Conflict { ref: string; key: string; description: string; field: string; yours: unknown; builderWas: unknown; builderNow: unknown }
export interface RebuildPlan {
  adds: EditorLine[];
  removes: EditorLine[];                                        // old auto lines the builder no longer makes
  updates: { ref: string; description: string; changes: FieldChange[] }[];
  conflicts: Conflict[];
  keptEdits: { ref: string; description: string; fields: string[] }[];
  stayDeleted: string[];
  handKept: number;
  docChanges: string[];                                          // wording / freight / pre-use …
  money: { row: CategoryKey; before: number; after: number }[];
  before: Priced; after: Priced;
  flagsNew: Flag[]; flagsCleared: Flag[];
  fallback: boolean;                                             // true until S's planRebuild is wired in
}
export type Choices = Record<string, 'yours' | 'builder'>;        // per conflict `${ref}::${field}`

const PRICED_FIELDS = ['qty', 'unitCost', 'markupPct', 'unitSell', 'description', 'category'] as const;
const DETAIL_FIELDS = ['detail.shape', 'detail.lengthFt', 'detail.plf', 'detail.tIn', 'detail.wIn', 'detail.lIn', 'detail.part'] as const;

/** Build `spec` fresh (builder lines only) — the input to planRebuild. */
export function buildFresh(doc: QuoteDoc, spec: QuoteSpec, cat: Catalog, settings: any) {
  return buildFromSpec(spec, cat, settings, { ...doc, lines: [] });
}

/** What a rebuild would change. Pure. TODO(S5): swap for S's planRebuild (which also separates
 *  price-list-only drift from spec changes and keys refs by permanent item id). */
export function planRebuild(old: EditorDoc, fresh: QuoteDoc, settings: Settings): RebuildPlan {
  const O = withRefs(linesOf(old).filter(l => l.auto)), N = withRefs(linesOf(fresh));
  const removed = new Set(old.removed ?? []);
  const oBy = new Map(O.map(l => [l._ref, l])), nBy = new Map(N.map(l => [l._ref, l]));
  const plan: RebuildPlan = { adds: [], removes: [], updates: [], conflicts: [], keptEdits: [], stayDeleted: [], handKept: linesOf(old).filter(l => !l.auto).length,
    docChanges: [], money: [], before: null as any, after: null as any, flagsNew: [], flagsCleared: [], fallback: !S_READY.planRebuild };
  for (const n of N) {
    const o = oBy.get(n._ref);
    if (!o) { if (removed.has(n._ref)) plan.stayDeleted.push(n.description); else plan.adds.push(n); continue; }
    const kept = Object.keys(o.edited ?? {});
    for (const p of kept) {
      const now = getPath(n, p);
      if (!same(o.edited![p], now)) plan.conflicts.push({ ref: n._ref, key: o.key, description: o.description, field: p, yours: getPath(o, p), builderWas: o.edited![p], builderNow: now });
    }
    if (kept.length) plan.keptEdits.push({ ref: n._ref, description: o.description, fields: kept });
  }
  for (const o of O) if (!nBy.has(o._ref)) plan.removes.push(o);
  if ((old.wording ?? '') !== (fresh.wording ?? '')) plan.docChanges.push('Quote wording is regenerated');
  if (old.outboundFreight !== fresh.outboundFreight) plan.docChanges.push(`Outbound freight $${Math.round(old.outboundFreight).toLocaleString()} → $${Math.round(fresh.outboundFreight).toLocaleString()}`);
  if ((old.preUse ?? 0) !== (fresh.preUse ?? 0)) plan.docChanges.push(`Pre-use inspections $${old.preUse} → $${fresh.preUse}`);
  if ((old.suggestedInstallHours ?? 0) !== (fresh.suggestedInstallHours ?? 0)) plan.docChanges.push(`Suggested install ${r1(old.suggestedInstallHours ?? 0)} h → ${r1(fresh.suggestedInstallHours ?? 0)} h`);
  const after = applyPlan(old, fresh, plan, {});
  // What actually changes on each matched line once your edits are re-applied (so the list matches the totals).
  const aBy = new Map(linesOf(after).map(l => [l.key, l]));
  for (const o of O) {
    const a = aBy.get(o.key); if (!a) continue;
    const changes: FieldChange[] = [];
    for (const f of [...PRICED_FIELDS, ...DETAIL_FIELDS]) {
      if (f === 'description') continue;
      const x = getPath(o, f), y = getPath(a, f);
      if ((x != null || y != null) && !same(x, y)) changes.push({ field: f, from: x, to: y });
    }
    if (changes.length) plan.updates.push({ ref: o._ref, description: a.description, changes });
  }
  plan.before = price(old, settings); plan.after = price(after, settings);
  plan.money = moneyByRow(plan.before, plan.after);
  const fk = (f: Flag) => f.rule + JSON.stringify(f.detail);
  plan.flagsNew = plan.after.flags.filter(f => !plan.before.flags.some(b => fk(b) === fk(f)));
  plan.flagsCleared = plan.before.flags.filter(f => !plan.after.flags.some(b => b.rule === f.rule));
  return plan;
}

/** Apply a plan: builder lines with the rep's edits re-applied (default keep yours), removed refs stay removed,
 *  hand lines kept, auto lines the builder dropped are kept as hand lines if the rep had edited them. */
export function applyPlan(old: EditorDoc, fresh: QuoteDoc, plan: RebuildPlan, choices: Choices): EditorDoc {
  const removed = new Set(old.removed ?? []);
  const O = new Map(withRefs(linesOf(old).filter(l => l.auto)).map(l => [l._ref, l]));
  const out: EditorLine[] = [];
  for (const n of withRefs(linesOf(fresh))) {
    if (removed.has(n._ref)) continue;
    const { _ref, ...line } = n;
    const o = O.get(_ref);
    let l: EditorLine = { ...line, ref: line.ref ?? (S_READY.refs ? line.ref : undefined) };
    if (o?.edited) {
      const ed: Record<string, unknown> = {};
      for (const [p, builderWas] of Object.entries(o.edited)) {
        if (choices[`${_ref}::${p}`] === 'builder') continue;
        l = setPath(l, p, getPath(o, p));
        ed[p] = getPath(n, p) ?? builderWas;
      }
      if (Object.keys(ed).length) { l = { ...l, edited: ed }; if (Object.keys(ed).some(p => p.startsWith('detail.'))) l = deriveLine(l); }
      l = { ...l, key: o.key };
    } else if (o) l = { ...l, key: o.key };
    out.push(l);
  }
  for (const r of plan.removes) if (r.edited) { const { _ref, ...h } = r as any; out.push({ ...h, auto: false, source: 'hand', edited: undefined, description: `${h.description} (kept — builder no longer makes it)` }); }
  out.push(...linesOf(old).filter(l => !l.auto));
  return { ...old, ...fresh, dealerDiscount: old.dealerDiscount, taxOn: old.taxOn, options: old.options, pvPerHourOverride: old.pvPerHourOverride, lines: out, removed: old.removed } as EditorDoc;
}

export function moneyByRow(a: Priced, b: Priced) {
  const sum = (p: Priced) => { const m: Partial<Record<CategoryKey, number>> = {}; for (const l of p.lines) m[l.category] = (m[l.category] ?? 0) + l.sell; if (p.totals.productionValue) m.costBased = (m.costBased ?? 0) + p.totals.productionValue; return m; };
  const A = sum(a), B = sum(b);
  return (Object.keys(ROW) as CategoryKey[]).map(row => ({ row, before: r2(A[row] ?? 0), after: r2(B[row] ?? 0) })).filter(x => Math.abs(x.after - x.before) >= 0.5);
}

// ---------------------------------------------------------------- crew days (U7 / S spec crewDays)
export const HOURS_PER_DAY = 10;   // rules/freestanding_rules.json crew.hoursPerDay
/** Set crew days on the job. TODO(S): when the spec accepts `crewDays`, U7 becomes a spec edit that moves
 *  site hours, travel and equipment together through planRebuild. Fallback: one hand "Install adjustment"
 *  line makes site hours = men × days × 10 h; travel and equipment do NOT follow yet (the UI says so). */
export function setCrewDaysFallback(doc: EditorDoc, men: number, days: number, family: string): EditorDoc {
  const KEY = 'install-adjust-days';
  const others = linesOf(doc).filter(l => l.key !== KEY);
  const site = others.filter(l => l.kind === 'site_labor').reduce((a, l) => a + l.qty, 0);
  const delta = r1(men * days * HOURS_PER_DAY - site);
  const lines = delta === 0 ? others : [...others, { key: KEY, kind: 'site_labor', category: 'onsiteLabor', family, description: `Install adjustment (crew ${men} men × ${days} days)`, qty: delta, laborOp: 'site_other', role: 'install', source: 'hand' } as EditorLine];
  return { ...doc, lines };
}

// ---------------------------------------------------------------- deltaDoc (S10, change orders)
/** TODO(S10): S's deltaDoc prints a CHANGE ORDER as the delta vs the last confirmed revision. Not available yet. */
export function deltaDoc(_confirmed: QuoteDoc, _current: QuoteDoc): QuoteDoc | null { return null; }

// ---------------------------------------------------------------- policy (S11)
export const minGmPct = (s: any) => Number(s?.min_gm_pct ?? 0.25);
