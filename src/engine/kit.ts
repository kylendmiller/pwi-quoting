// Shared building blocks for every product builder (cranes, monorails, gantries, mezzanines, …).
// One Kit collects lines, notes, blockers and assumptions, and knows PWI's SMT rules for steel,
// plate, standard parts, vendor items, paint, shop labor, install crew/travel/lodging/equipment,
// freight and PM/CAD. Numbers come from rules/freestanding_rules.json (calibrated on sold jobs)
// and the live price lists (Catalog).
import type { QuoteLine } from './manual';
import type { CategoryKey } from './rollup';
import R from './rules/freestanding_rules.json';

export interface Catalog {
  stdSell(description: string): number | null;
  stdHours(description: string): number;                 // shop hours built into a standard part
  vendor(part: string): { list: number; description: string; vendor: string } | null;
  vendorParts(prefix: string): { part: string; list: number; description: string }[];
  discount(vendor: string): { pwi: number; customer: number };
  shape(name: string): { lbPerFt: number; pricePerLb: number; group?: string } | null;
  plate: { pricePerLb: number; markupPct: number; dropFactor: number };
  structuralMarkupPct: number;
  decalSell(name: string): number | null;
  equip(item: string): { daily: number; weekly: number; monthly: number } | null;
  rate?(item: string): number | null;                  // painting / travel rate items (live, editable)
  steelCost?: SteelCost | null;                         // dated steel $/lb by price group (settings.steel_cost); wins over shape/plate prices
  stdAll?(): { description: string; part: string | null; sell: number; hours: number; info: string | null; section: string | null }[];   // whole catalog (product configurators)
}
/** settings.steel_cost — one dated steel price per price group (reference/steel_price_groups.json groups + "Plate").
 *  Updated weekly from the steel brief (tools/steel-cost-from-brief.md). Missing groups fall back to the catalog. */
export interface SteelCost { effective: string; source: string; perLb: Record<string, number> }
/** Validates a steel_cost setting; returns null (and why) when it can't be used. */
export function readSteelCost(x: unknown): { sc: SteelCost | null; problem?: string } {
  if (x == null) return { sc: null };
  const o = x as any;
  if (typeof o !== 'object' || typeof o.perLb !== 'object' || o.perLb == null) return { sc: null, problem: 'steel_cost setting has no perLb table — using catalog steel prices' };
  if (typeof o.effective !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.effective)) return { sc: null, problem: 'steel_cost.effective must be YYYY-MM-DD — using catalog steel prices' };
  const perLb: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.perLb)) if (typeof v === 'number' && isFinite(v) && v > 0 && v < 20) perLb[k] = v;
  return { sc: { effective: o.effective, source: String(o.source ?? ''), perLb } };
}
/** Catalog with a steel_cost setting applied (Kit reads cat.steelCost). */
export const withSteelCost = (cat: Catalog, sc: SteelCost | null): Catalog => (sc ? { ...cat, steelCost: sc } : cat);
export interface Assumption { field: string; value: unknown; why: string; alt?: unknown; altLabel?: string }
export interface Factors { production: number; install: number }

export const pick = <T>(tbl: [number, T][], x: number): T => (tbl.find(([m]) => x <= m) ?? tbl[tbl.length - 1])[1];
export const depthIn = (shape: string) => Number(/^(?:W|ST|RT|TC|C|MC)\s*(\d+)/.exec(shape)?.[1] ?? 12);
export const STD_COLORS = /^(gray|grey|spark orange|two-tone|standard|white primer|primer)/i;
export const RULES = R;
let seq = 0; export const key = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

export const ftIn = (ft: number) => { const f = Math.floor(ft + 1e-9); const i = Math.round((ft - f) * 12); return i === 12 ? `${f + 1}'` : i ? `${f}' ${i}"` : `${f}'`; };
export const hgt = (ft: number, mode: 'floor' | 'ceil' = 'floor') => {
  const inches = mode === 'floor' ? Math.floor(ft * 12 + 1e-6) : Math.ceil(ft * 12 - 1e-6);
  const f = Math.floor(inches / 12), i = inches % 12;
  return i ? `${f}'-${i}"` : `${f}'`;
};
export const tons = (t: number) => (t === 0.5 ? '1/2' : t === 0.25 ? '1/4' : String(t));

/** Range check used by every builder's normalize(). Throws a plain-English error. */
export function check(k: string, v: unknown, lo: number, hi: number, need = false) {
  if (v == null) { if (need) throw new Error(`Missing ${k}.`); return; }
  if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) throw new Error(`${k} = ${v} is outside what the auto-builder handles (${lo}–${hi}). Quote this one by hand.`);
}
export function keep<T extends object>(x: any, keys: readonly string[]): T {
  return Object.fromEntries(keys.filter(k => x[k] !== undefined).map(k => [k, x[k]])) as T;
}
export const volt = (v: unknown) => { const s = String(v ?? '460').replace(/\s/g, ''); return s.startsWith('208') ? '208V/3' : s.startsWith('230') || s.startsWith('240') ? '230V/3' : s.startsWith('115') || s.startsWith('120') ? '115V/1' : '460V/3'; };

export interface SiteWork { desc: string; hours: number }
export interface FinishOpts {
  install: boolean; miles: number; site: SiteWork[];
  workTopFt: number;                 // highest point the crew works at (lift choice)
  heaviestPickLb: number;
  generator?: boolean; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local';
  extraEquipment?: string[];
  skipTravel?: boolean;              // multi-product job: travel/lodging/equipment added once for the whole job
}
export interface JobTravel { workHrs: number; miles: number; workTopFt: number; heaviestPickLb: number; generator?: boolean; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local'; extraEquipment?: string[] }

export class Kit {
  lines: QuoteLine[] = []; notes: string[] = []; blockers: string[] = []; A: Assumption[] = [];
  lbs = 0; units = 0; heaviestLb = 0; longest = 0; builtHrs = 0; site = 0; smtShopHours = 0; freight = 0; workHrs = 0;
  constructor(public cat: Catalog, public fam: string, public f: Factors) {}

  /** Steel $/lb for a price group: dated steel_cost setting first, then the catalog value. */
  steelPerLb(group: string | undefined, fallback: number) { const v = group ? this.cat.steelCost?.perLb[group] : undefined; return v ?? fallback; }
  platePerLb() { return this.cat.steelCost?.perLb.Plate ?? this.cat.plate.pricePerLb; }
  private push(l: Omit<QuoteLine, 'key' | 'family'>) { this.lines.push({ key: key(), family: this.fam, ...l } as QuoteLine); }
  unitsFor(qty: number, len: number) { return qty * Math.max(1, Math.ceil(len / R.paint.maxLenFt - 1e-9)); }

  /** Structural shape line (Structural tab): qty × shape × length, steel price, structural markup. Returns lb per piece. */
  steel(desc: string, shape: string, qty: number, len: number, opts: { paint?: boolean } = {}) {
    if (qty <= 0) return 0;
    const sh = this.cat.shape(shape); if (!sh) { this.notes.push(`Shape ${shape} not in steel list.`); return 0; }
    this.push({ kind: 'material', category: 'structural', description: `${desc} — ${shape} × ${len}'`, qty, unitCost: Math.round(sh.lbPerFt * len * this.steelPerLb(sh.group, sh.pricePerLb) * 100) / 100, markupPct: this.cat.structuralMarkupPct });
    if (opts.paint !== false) this.units += this.unitsFor(qty, len);
    this.heaviestLb = Math.max(this.heaviestLb, sh.lbPerFt * len); this.longest = Math.max(this.longest, len);
    this.lbs += sh.lbPerFt * len * qty; return sh.lbPerFt * len;
  }
  /** Plasma plate line (Plate tab): t × w × l in inches, 0.2833 lb/in³ × drop factor. */
  plate(desc: string, qty: number, t: number, w: number, l: number) {
    if (qty <= 0) return;
    const lb = t * w * l * 0.2833 * this.cat.plate.dropFactor; this.lbs += lb * qty;
    this.push({ kind: 'material', category: 'plate', description: `${desc} — ${t}" × ${w}" × ${l}"`, qty, unitCost: Math.round(lb * this.platePerLb() * 100) / 100, markupPct: this.cat.plate.markupPct });
  }
  /** Built-up / box member priced by plf (Plate tab box rows: plf × ft × 1.03). */
  box(desc: string, qty: number, plf: number, len: number) {
    if (qty <= 0) return 0;
    const lb = plf * len * 1.03; this.lbs += lb * qty; this.units += this.unitsFor(qty, len); this.heaviestLb = Math.max(this.heaviestLb, lb); this.longest = Math.max(this.longest, len);
    this.push({ kind: 'material', category: 'plate', description: `${desc} — ${plf} plf × ${len}'`, qty, unitCost: Math.round(lb * this.platePerLb() * 100) / 100, markupPct: this.cat.plate.markupPct });
    return lb;
  }
  /** Standard Parts & Products line at catalog sell price (+ its built shop hours). */
  std(description: string, qty: number, category: CategoryKey = 'stdParts') {
    if (qty <= 0) return;
    const sell = this.cat.stdSell(description);
    if (sell == null) { this.notes.push(`Standard part not found: ${description}`); return; }
    this.push({ kind: 'material', category, description, qty, unitSell: sell });
    this.builtHrs += qty * this.cat.stdHours(description);
  }
  /** Hoist & Crane Vendor Items line: list × (1 − PWI disc) cost, sold at list × (1 − customer disc). */
  vend(part: string, qty: number) {
    if (qty <= 0) return;
    const p = this.cat.vendor(part); if (!p) { this.notes.push(`Vendor part not found: ${part}`); return; }
    const d = this.cat.discount(p.vendor), cost = p.list * (1 - d.pwi / 100), sell = p.list * (1 - d.customer / 100);
    this.push({ kind: 'material', category: 'vendor', description: `${p.vendor} ${part} — ${p.description}`, qty, unitCost: Math.round(cost * 100) / 100, markupPct: Math.round((sell / cost - 1) * 10000) / 100 });
  }
  /** Cost-based item (Cost Based Items tab). */
  cost(description: string, qty: number, unitCost: number, markupPct: number, category: CategoryKey = 'costBased') {
    if (qty <= 0) return;
    this.push({ kind: 'material', category, description, qty, unitCost: Math.round(unitCost * 100) / 100, markupPct });
  }
  /** A line priced at a fixed sell each (catalog products, VRC models, …). */
  sell(description: string, qty: number, unitSell: number, category: CategoryKey) {
    if (qty <= 0) return;
    this.push({ kind: 'material', category, description, qty, unitSell: Math.round(unitSell * 100) / 100 });
  }
  /** Paint booth runs: 16 piece-units per run; custom colors priced as custom runs (min 1). */
  paint(customUnits: number, customLabel: string | null, opts: { primerOnly?: boolean } = {}) {
    const P = { ...R.paint, standardRun: this.cat.rate?.('Standard Paint Full Booth Run') ?? R.paint.standardRun, customRun: this.cat.rate?.('Custom Color Paint Full Booth Run') ?? R.paint.customRun,
      primerRun: this.cat.rate?.('Primer Full Booth Run') ?? 1587 };
    const runsFor = (u: number) => Math.max(1, Math.ceil(u / P.piecesPerRun / P.roundTo) * P.roundTo);
    if (this.units <= 0) return;
    if (customUnits > 0 && customLabel) {
      const cRuns = Math.max(P.customMinRuns, Math.ceil(customUnits / P.piecesPerRun));
      this.push({ kind: 'material', category: 'painting', description: `Custom color paint full booth run (${customLabel})`, qty: cRuns, unitSell: P.customRun });
      const rest = Math.max(0, this.units - customUnits);
      if (rest > 0) this.push({ kind: 'material', category: 'painting', description: 'Standard paint full booth run (gray + Spark Orange)', qty: runsFor(rest), unitSell: P.standardRun });
      this.A.push({ field: 'colors', value: customLabel, why: `Custom color = $${P.customRun}/run, min ${P.customMinRuns} full run; ${customUnits} piece-units custom`, alt: {}, altLabel: 'Standard gray / Spark Orange' });
    } else if (opts.primerOnly) this.push({ kind: 'material', category: 'painting', description: 'Primer full booth run', qty: runsFor(this.units), unitSell: P.primerRun });
    else this.push({ kind: 'material', category: 'painting', description: 'Standard paint full booth run (gray + Spark Orange)', qty: runsFor(this.units), unitSell: P.standardRun });
  }
  decal(name: string, qty: number) { const ds = this.cat.decalSell(name); if (ds && qty > 0) this.push({ kind: 'material', category: 'decals', description: name, qty, unitSell: ds }); }
  matSell() {
    return this.lines.filter(l => l.kind === 'material').reduce((a, l) => a + (l.unitSell != null && l.unitCost == null ? l.unitSell * l.qty : (l.unitCost ?? 0) * l.qty * (1 + (l.markupPct ?? 0) / 100)), 0);
  }
  /** Shop labor: SMT-method hours × production factor, plus the handling rule. Built-part hours are tracked, not priced. */
  shop(ops: [string, number][], opts: { handling?: boolean; builtParts?: boolean } = {}) {
    const O = R.shopOps;
    const list = [...ops];
    // SMT Labor row 49 "PWI Built Items" only counts these hours (no $ column) — the standard-part sell price already
    // carries the labor. Pricing them again double-counted (fixed 11/20). They stay in smtShopHours for scheduling.
    if (opts.builtParts === true) list.push(['PWI built standard parts', this.builtHrs]);
    else this.smtShopHours += this.builtHrs;
    if (opts.handling !== false) list.push(['Handling / shipping', Math.max(O.handling.min, Math.round(O.handling.pctOfMaterialSell * this.matSell() / O.handling.perHour))]);
    for (const [d, h] of list) {
      this.smtShopHours += h;
      if (h > 0) this.push({ kind: 'shop_labor', category: 'shopLabor', description: d, qty: Math.round(h * this.f.production * 10) / 10, laborOp: 'shop_other' });
    }
  }
  /** On-site install, crew size, travel, lodging, per diem, equipment, then freight. */
  finish(o: FinishOpts) {
    const T = { ...R.travel, hotel: this.cat.rate?.('Hotels (one room per person)') ?? R.travel.hotel, perDiem: this.cat.rate?.('Per diem costs') ?? R.travel.perDiem }, S2 = R.siteOps;
    const miles = o.miles ?? 0;
    if (o.install) {
      const sl = o.site.filter(x => x.hours > 0).map(x => ({ ...x }));
      const sub = sl.reduce((a, x) => a + x.hours, 0);
      sl.push({ desc: 'Paint touch-up + cleanup', hours: S2.touchupCleanup.base + S2.touchupCleanup.pctOfSubtotal * sub });
      const workHrs = sl.reduce((a, x) => a + x.hours, 0) * this.f.install;
      for (const x of sl) { const hrs = Math.round(x.hours * this.f.install * 10) / 10; this.site += hrs; this.push({ kind: 'site_labor', category: 'onsiteLabor', description: x.desc, qty: hrs, laborOp: 'site_other' }); }
      this.workHrs = workHrs;
      if (!o.skipTravel) this.travel({ workHrs, miles, workTopFt: o.workTopFt, heaviestPickLb: o.heaviestPickLb, generator: o.generator, crewMen: o.crewMen, travelMode: o.travelMode, extraEquipment: o.extraEquipment });
    }
    // freight (freight history rates by load type and distance)
    const tns = this.lbs / 2000, F = R.freight;
    const bucket = miles <= 500 ? '0-500' : miles <= 1000 ? '500-1000' : miles <= 1500 ? '1000-1500' : '1500+';
    const type = (F.typeRule as any[]).find(t => tns <= t.maxTons && this.longest <= t.maxPieceFt)?.type ?? 'FB';
    const loads = type === 'FB' ? Math.max(1, Math.ceil(tns / F.tonsPerLoad)) : 1;
    const oversize = this.longest > F.oversizeIfPieceOverFt ? 1 : 0;
    const rate = (t: string) => (F.ratePerMile as any)[t][bucket];
    this.freight = miles > 0 ? Math.ceil(((loads - oversize) * rate(type) + oversize * rate('OSL')) * miles * (1 + F.markup) / 10) * 10 : 0;
    if (miles > 0) this.A.push({ field: 'freight', value: `${loads} × ${type}${oversize ? ' (1 oversize)' : ''}`, why: `${tns.toFixed(1)} t, longest piece ${this.longest}', ${miles} mi @ $${rate(type)}/mi (freight history) +${F.markup * 100}%` });
  }
  /** Crew size, travel time, lodging, per diem and rental equipment for a given amount of on-site work. */
  travel(o: JobTravel) {
    const T = { ...R.travel, hotel: this.cat.rate?.('Hotels (one room per person)') ?? R.travel.hotel, perDiem: this.cat.rate?.('Per diem costs') ?? R.travel.perDiem };
    const miles = o.miles ?? 0, workHrs = o.workHrs;
      const men = o.crewMen ?? pick(R.crew.menIfHoursAbove as [number, number][], workHrs);
      if (!o.crewMen) this.A.push({ field: 'crewMen', value: men, why: `${Math.round(workHrs)} on-site hours → ${men}-man crew`, alt: men === 2 ? 3 : 2 });
      const crewDays = Math.max(1, Math.ceil(workHrs / (men * R.crew.hoursPerDay) - R.crew.dayRoundSlack));
      const mode = o.travelMode ?? (miles <= T.localMiles ? 'local' : miles > T.flyAboveMiles ? 'fly' : 'drive');
      if (!o.travelMode) this.A.push({ field: 'travelMode', value: mode, why: mode === 'local' ? `${miles} mi — daily commute, no lodging` : mode === 'fly' ? `${miles} mi > ${T.flyAboveMiles} — crew flies, rental car, tools ship LTL` : `${miles} mi — crew drives`, alt: mode === 'fly' ? 'drive' : mode === 'drive' ? 'fly' : 'drive' });
      const travelHrs = mode === 'local' ? men * 2 * crewDays * miles / T.driveMph : mode === 'fly' ? men * 2 * T.flyDoorToDoorHrsEachWay : men * 2 * miles / T.driveMph;
      if (travelHrs > 0) { const th = Math.round(travelHrs); this.site += th; this.push({ kind: 'site_labor', category: 'onsiteLabor', description: `Travel (${mode}, ${men} men, ${miles} mi)`, qty: th, laborOp: 'site_travel' }); }
      if (mode !== 'local') {
        const days = crewDays + (miles > T.sameDayDriveMiles ? 2 : 0);
        const tl = (d: string, qty: number, c: number) => this.push({ kind: 'travel', category: 'travel', description: d, qty, unitCost: c, markupPct: T.markupPct });
        tl(`Hotels — ${men} rooms × ${days - 1} nights`, men * (days - 1), T.hotel);
        tl(`Per diem — ${men} men × ${days} days`, men * days, T.perDiem);
        if (mode === 'fly') { tl('Flights (round trip per man)', men, T.flightPerMan); tl('Rental car (weekly)', Math.ceil(days / 7), T.rentalCarWeekly); tl('LTL tool return to PWI', 1, T.toolReturnLtl); }
        this.A.push({ field: 'crewDays', value: crewDays, why: `${Math.round(workHrs)} h ÷ (${men} men × ${R.crew.hoursPerDay} h) → ${crewDays} days on site + ${days - crewDays} travel days; lodging $${T.hotel}/night, per diem $${T.perDiem} (+${T.markupPct}%)` });
      }
      const E = R.equipment, weeks = Math.ceil(crewDays / 5);
      const eq = (item: string, qty: number) => {
        const it = this.cat.equip(item); if (!it) { this.notes.push(`Equipment ${item} not in list`); return; }
        const useWeekly = crewDays >= E.weekly.fromDays; const unit = useWeekly ? (weeks >= E.monthly.fromWeeks ? it.monthly * weeks / 4 : it.weekly * weeks) : it.daily * crewDays;
        this.push({ kind: 'equipment', category: 'equipment', description: `${item} — ${useWeekly ? `${weeks} wk` : `${crewDays} day`}`, qty, unitCost: Math.round(unit * 100) / 100, markupPct: E.markupPct });
      };
      const liftItem = E.lift.find(l => o.workTopFt <= l.maxColumnTopFt)!.item;
      eq(liftItem, (E.liftsByMen as any)[String(men)] ?? 1);
      const pick1 = o.heaviestPickLb * E.handler.reachFactor;
      const handler = (E.handler.classes as [number, string][]).find(([m]) => pick1 <= m)?.[1];
      if (handler) eq(handler, 1); else { eq('Rental 15K Telehandler', 1); this.blockers.push(`Heaviest pick ≈ ${Math.round(o.heaviestPickLb)} lb — ${E.handler.aboveMaxFlag}.`); }
      if (o.generator) eq('Wacker Neuson Large Generator', 1);
      for (const x of o.extraEquipment ?? []) eq(x, 1);
      this.push({ kind: 'equipment', category: 'equipment', description: 'Rental delivery / pickup', qty: 1 + (handler && handler !== 'Rental Fork Lift' ? 1 : 0), unitCost: E.deliveryFee, markupPct: 0 });
      this.A.push({ field: 'equipment', value: `${liftItem}, ${handler ?? '15K telehandler + crane?'}${o.generator ? ', generator' : ''} × ${weeks} wk`, why: `Work height ≈ ${o.workTopFt.toFixed(1)}', heaviest pick ≈ ${Math.round(o.heaviestPickLb)} lb, ${crewDays} crew days` });
      }
  /** PM + CAD hours scale with job size: $ = k·(materials + shop $, in $k)^exp (fitted on sold crane jobs). */
  pmCad(mult = 1, mins?: { pm?: number; cad?: number }) {
    const P = R.pmCad as any;
    const rest = this.matSell() + this.smtShopHours * this.f.production * P.shopRate;
    const dollars = P.k * Math.pow(Math.max(rest, 1000) / 1000, P.exp) * mult;
    const pm = Math.max(mins?.pm ?? P.pmMin, Math.round(dollars * P.pmShare / P.pmRate));
    const cad = Math.max(mins?.cad ?? P.cadMin, Math.round(dollars * (1 - P.pmShare) / P.cadRate));
    this.push({ kind: 'pm', category: 'pmMarketing', description: 'Project management', qty: pm });
    this.push({ kind: 'cad', category: 'cad', description: 'AutoCAD design / approval drawings', qty: cad });
  }
  /** Fixed PM / CAD hours (products priced per unit on their SMT tab, e.g. work platform sets). */
  pmCadFixed(pmHrs: number, cadHrs: number) {
    if (pmHrs > 0) this.push({ kind: 'pm', category: 'pmMarketing', description: 'Project management', qty: Math.round(pmHrs * 10) / 10 });
    if (cadHrs > 0) this.push({ kind: 'cad', category: 'cad', description: 'AutoCAD design / approval drawings', qty: Math.round(cadHrs * 10) / 10 });
  }
  /** Engineering (P.E. stamp) hours. */
  pe(hours: number) { if (hours > 0) this.push({ kind: 'engineering', category: 'engineering', description: 'P.E. calculations / stamped drawings', qty: hours }); }
  done() { for (const n of this.notes) if (/not found|not in/.test(n)) this.blockers.push(n); }
}

/** Conservative Ix estimate for a W shape from nominal depth and weight: 0.04·w·d² is below the AISC Ix of the W shapes
 *  checked in W_SHAPES, incl. the light-for-depth worst cases W24x55, W30x90, W36x135 (the old 0.05 over-stated W24x55
 *  by 17% and W30x90 by 12% — unconservative). Replace with a real Ix column when steel_shapes gets one. */
export const IX_COEF = 0.04;
export const ixOf = (shape: string) => { const m = /^W(\d+) x (\d+(?:\.\d+)?)$/.exec(shape); return m ? IX_COEF * Number(m[2]) * Number(m[1]) ** 2 : 0; };
/** W-shape sizing by deflection + bending when a chart doesn't cover the case.
 *  Ix from ixOf() (conservative); Sx ≈ 2·Ix/d. Picks the lightest W from the steel list. */
export function sizeBeam(cat: Catalog, opts: { spanFt: number; wPlf?: number; pointLb?: number; liveFrac?: number; deflLimit: number; maxDepthIn?: number; minDepthIn?: number; allowKsi?: number }) {
  const L = opts.spanFt * 12, E = 29e6, w = (opts.wPlf ?? 0) / 12, P = opts.pointLb ?? 0;
  const live = opts.liveFrac ?? 1;
  const Ireq = Math.max(
    w ? 5 * w * live * L ** 4 / (384 * E * (L / opts.deflLimit)) : 0,
    0) + (P ? P * live * L ** 3 / (48 * E * (L / opts.deflLimit)) : 0);
  const M = (w * L * L / 8 + P * L / 4);               // lb-in
  const allow = (opts.allowKsi ?? 24) * 1000;
  let best: { shape: string; w: number } | null = null;
  for (const name of W_SHAPES) {
    const m = /^W(\d+) x (\d+(?:\.\d+)?)$/.exec(name); if (!m) continue;
    const d = Number(m[1]), wt = Number(m[2]);
    if (opts.maxDepthIn && d > opts.maxDepthIn) continue;
    if (opts.minDepthIn && d < opts.minDepthIn) continue;
    if (!cat.shape(name)) continue;
    const I = IX_COEF * wt * d * d, S = 2 * I / d;
    if (I >= Ireq && M / S <= allow && (!best || wt < best.w)) best = { shape: name, w: wt };
  }
  return best?.shape ?? null;
}
export const W_SHAPES = ['W6 x 15', 'W6 x 20', 'W6 x 25', 'W8 x 18', 'W8 x 21', 'W8 x 24', 'W8 x 31', 'W8 x 35', 'W10 x 19', 'W10 x 22', 'W10 x 26', 'W10 x 30', 'W10 x 33', 'W10 x 39', 'W10 x 45',
  'W12 x 19', 'W12 x 22', 'W12 x 26', 'W12 x 30', 'W12 x 35', 'W12 x 40', 'W12 x 45', 'W12 x 50', 'W12 x 53', 'W14 x 22', 'W14 x 26', 'W14 x 30', 'W14 x 34', 'W14 x 38', 'W14 x 43', 'W14 x 48',
  'W14 x 53', 'W14 x 61', 'W16 x 26', 'W16 x 31', 'W16 x 36', 'W16 x 40', 'W16 x 45', 'W16 x 50', 'W16 x 57', 'W16 x 67', 'W18 x 35', 'W18 x 40', 'W18 x 46', 'W18 x 50', 'W18 x 55', 'W18 x 60',
  'W18 x 65', 'W18 x 71', 'W18 x 76', 'W18 x 86', 'W21 x 44', 'W21 x 50', 'W21 x 57', 'W21 x 62', 'W21 x 68', 'W21 x 73', 'W21 x 83', 'W21 x 93', 'W21 x 101', 'W24 x 55', 'W24 x 62', 'W24 x 68',
  'W24 x 76', 'W24 x 84', 'W24 x 94', 'W24 x 104', 'W24 x 117', 'W24 x 131', 'W27 x 84', 'W27 x 94', 'W27 x 102', 'W27 x 114', 'W27 x 146', 'W30 x 90', 'W30 x 99', 'W30 x 108', 'W30 x 116',
  'W33 x 118', 'W33 x 130', 'W33 x 141', 'W33 x 169', 'W36 x 135', 'W36 x 150'];
