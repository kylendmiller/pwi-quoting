// Shared building blocks for every product builder (cranes, monorails, gantries, mezzanines, …).
// One Kit collects lines, notes, blockers and assumptions, and knows PWI's SMT rules for steel,
// plate, standard parts, vendor items, paint, shop labor, install crew/travel/lodging/equipment,
// freight and PM/CAD. Numbers come from rules/freestanding_rules.json (calibrated on sold jobs)
// and the live price lists (Catalog).
import { tableFare } from './airfare';
import { INSTALL_DAYS_OP, type QuoteLine } from './manual';
import { roleOf, vendorRole, smtLaborBlock, type Role, type Basis, type LineDetail, type CostSource } from './lineDetail';
import type { CategoryKey } from './rollup';
import R from './rules/freestanding_rules.json';

export interface Catalog {
  stdSell(description: string): number | null;
  stdHours(description: string): number;                 // shop hours built into a standard part
  stdGm?(description: string): number | null;            // std_parts.gm_pct (fraction) — sets the part's cost (S7)
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
/** Editor data a builder can attach to a line (role / why). Kit fills `detail` itself. */
export interface LineMeta { role?: Role; basis?: Basis }
export interface Factors { production: number; install: number }

/** Shop-hour size taper: 1 up to fromMatSell, straight line down to minMult at toMatSell, flat after (rules shopOps.sizeTaper). */
export function shopTaper(fam: string, matSell: number, T: any = (R.shopOps as any).sizeTaper): number {
  if (!T || !T.families.includes(fam) || matSell <= T.fromMatSell) return 1;
  return Math.round((1 - (1 - T.minMult) * Math.min(1, (matSell - T.fromMatSell) / (T.toMatSell - T.fromMatSell))) * 1000) / 1000;
}
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
  installDays?: number;              // spec.installDays: crew days on site set by the rep (travel follows; site labor via installDaysLine)
  trip?: TripOpts;                   // spec.trip: job-level travel facts (drive time, searched airfare)
}
/** Job-level travel facts from the spec (spec.trip). */
export interface TripOpts {
  driveMinutes?: number;             // one-way drive time PWI → site (Airtable building driveTimeSeconds / 60)
  airfarePerPerson?: number;         // searched round-trip economy fare, ~2 weeks out, Mon→Fri
  airfareRoute?: string;             // e.g. 'SBN → TUL'
  airfareDates?: string;             // e.g. '2026-12-07 → 2026-12-11'
  airfareSearchedOn?: string;        // date the fare was looked up
  state?: string;                    // job state (from the spec) — picks the nearest airport in the SBN fare table
  lat?: number; lng?: number;        // job location when known (better than the state's center)
}
export interface JobTravel { workHrs: number; miles: number; workTopFt: number; heaviestPickLb: number; generator?: boolean; crewMen?: number; travelMode?: 'drive' | 'fly' | 'local'; extraEquipment?: string[];
  /** Crew days on site set on the spec (installDays). Nights, per diem, hotel, commute and rental periods use exactly these days.
   *  Unset → days come from the hours (crewDaysFor), as always. */
  installDays?: number;
  trip?: TripOpts }

/** Crew hours per day on site (rules crew.hoursPerDay) — travel and installDays use the same number. */
export const HOURS_PER_DAY: number = R.crew.hoursPerDay;
/** Crew size the builder picks for a given amount of on-site work (when the spec has no crewMen). */
export const crewMenFor = (workHrs: number): number => pick(R.crew.menIfHoursAbove as [number, number][], workHrs);
/** Crew days the builder derives from on-site hours and crew size. */
export const crewDaysFor = (workHrs: number, men: number): number => Math.max(1, Math.ceil(workHrs / (men * R.crew.hoursPerDay) - R.crew.dayRoundSlack));
export { INSTALL_DAYS_OP };
/** The visible +/− site-labor line for spec.installDays: the builder's task lines stay as built, this line makes the
 *  on-site total men × days × HOURS_PER_DAY. null when the tasks already add up to that. */
export function installDaysLine(taskHrs: number, men: number, days: number, fam: string): QuoteLine | null {
  // At or above the builder's own day count, days only ADD whole crew-days to the builder's hours, so typing the
  // suggested days never lands under the suggestion (crewDaysFor allows a little slack when it rounds days).
  const builtDays = crewDaysFor(taskHrs, men);
  const target = days >= builtDays ? taskHrs + (days - builtDays) * men * HOURS_PER_DAY : men * days * HOURS_PER_DAY;
  const delta = Math.round((target - taskHrs) * 10) / 10;
  if (Math.abs(delta) < 0.05) return null;
  const t1 = Math.round(taskHrs * 10) / 10;
  return { key: key(), family: fam, kind: 'site_labor', category: 'onsiteLabor', laborOp: INSTALL_DAYS_OP, role: 'install', qty: delta,
    description: `Install days adjustment (${men} men × ${days} days; builder ${builtDays} days → ${Math.round(target * 10) / 10} h on site)`,
    basis: { source: 'spec', text: `installDays ${days} on the spec: ${men} men × ${days} days × ${HOURS_PER_DAY} h/day = ${target} h on site; the builder's install tasks total ${t1} h → ${delta > 0 ? '+' : ''}${delta} h`, assumption: 'installDays' },
    detail: { type: 'labor', where: 'site', op: 'Install days adjustment', smtRow: 'Labor G9:G44 On Site Labor', baseHrs: delta, factor: 1, factorName: 'install', hours: delta } };
}

export class Kit {
  lines: QuoteLine[] = []; notes: string[] = []; blockers: string[] = []; A: Assumption[] = [];
  lbs = 0; units = 0; heaviestLb = 0; longest = 0; builtHrs = 0; site = 0; smtShopHours = 0; freight = 0; workHrs = 0;
  constructor(public cat: Catalog, public fam: string, public f: Factors) {}

  /** Steel $/lb for a price group: dated steel_cost setting first, then the catalog value. */
  steelPerLb(group: string | undefined, fallback: number) { const v = group ? this.cat.steelCost?.perLb[group] : undefined; return v ?? fallback; }
  platePerLb() { return this.cat.steelCost?.perLb.Plate ?? this.cat.plate.pricePerLb; }
  /** Default basis per role, set where the builder makes the pick (K.why('girder', …)); explicit meta wins. */
  basisByRole: Partial<Record<Role, Basis>> = {};
  why(role: Role, b: Basis) { this.basisByRole[role] = b; }
  private push(l: Omit<QuoteLine, 'key' | 'family'>, meta: LineMeta & { detail?: LineDetail } = {}) {
    const role = meta.role ?? roleOf(l.description, l.category);
    const basis = meta.basis ?? this.basisByRole[role];
    this.lines.push({ key: key(), family: this.fam, ...l, role, ...(basis ? { basis } : {}), ...(meta.detail ? { detail: meta.detail } : {}) } as QuoteLine);
  }
  private src(group: string | undefined): { costSource: CostSource; steelCostDate?: string } {
    return group && this.cat.steelCost?.perLb[group] != null ? { costSource: 'steel_cost', steelCostDate: this.cat.steelCost.effective } : { costSource: 'catalog' };
  }
  private plateSrc(): { costSource: CostSource; steelCostDate?: string } {
    return this.cat.steelCost?.perLb.Plate != null ? { costSource: 'steel_cost', steelCostDate: this.cat.steelCost.effective } : { costSource: 'catalog' };
  }
  unitsFor(qty: number, len: number) { return qty * Math.max(1, Math.ceil(len / R.paint.maxLenFt - 1e-9)); }

  /** Structural shape line (Structural tab): qty × shape × length, steel price, structural markup. Returns lb per piece. */
  steel(desc: string, shape: string, qty: number, len: number, opts: { paint?: boolean } & LineMeta = {}) {
    if (qty <= 0) return 0;
    const sh = this.cat.shape(shape); if (!sh) { this.notes.push(`Shape ${shape} not in steel list.`); return 0; }
    const perLb = this.steelPerLb(sh.group, sh.pricePerLb);
    this.push({ kind: 'material', category: 'structural', description: `${desc} — ${shape} × ${len}'`, qty, unitCost: Math.round(sh.lbPerFt * len * perLb * 100) / 100, markupPct: this.cat.structuralMarkupPct },
      { role: opts.role, basis: opts.basis, detail: { type: 'steel', shape, lengthFt: len, lbPerFt: sh.lbPerFt, lbEach: sh.lbPerFt * len, priceGroup: sh.group, costPerLb: perLb, ...this.src(sh.group), paintUnitsEach: opts.paint !== false ? this.unitsFor(1, len) : 0 } });
    if (opts.paint !== false) this.units += this.unitsFor(qty, len);
    this.heaviestLb = Math.max(this.heaviestLb, sh.lbPerFt * len); this.longest = Math.max(this.longest, len);
    this.lbs += sh.lbPerFt * len * qty; return sh.lbPerFt * len;
  }
  /** Plasma plate line (Plate tab): t × w × l in inches, 0.2833 lb/in³ × drop factor. */
  plate(desc: string, qty: number, t: number, w: number, l: number, meta: LineMeta = {}) {
    if (qty <= 0) return;
    const lb = t * w * l * 0.2833 * this.cat.plate.dropFactor; this.lbs += lb * qty;
    this.push({ kind: 'material', category: 'plate', description: `${desc} — ${t}" × ${w}" × ${l}"`, qty, unitCost: Math.round(lb * this.platePerLb() * 100) / 100, markupPct: this.cat.plate.markupPct },
      { ...meta, detail: { type: 'plate', tIn: t, wIn: w, lIn: l, lbPerIn3: 0.2833, dropFactor: this.cat.plate.dropFactor, lbEach: lb, costPerLb: this.platePerLb(), ...this.plateSrc() } });
  }
  /** Built-up / box member priced by plf (Plate tab box rows: plf × ft × 1.03). */
  box(desc: string, qty: number, plf: number, len: number, meta: LineMeta = {}) {
    if (qty <= 0) return 0;
    const lb = plf * len * 1.03; this.lbs += lb * qty; this.units += this.unitsFor(qty, len); this.heaviestLb = Math.max(this.heaviestLb, lb); this.longest = Math.max(this.longest, len);
    this.push({ kind: 'material', category: 'plate', description: `${desc} — ${plf} plf × ${len}'`, qty, unitCost: Math.round(lb * this.platePerLb() * 100) / 100, markupPct: this.cat.plate.markupPct },
      { ...meta, detail: { type: 'box', plf, lengthFt: len, fabFactor: 1.03, lbEach: lb, costPerLb: this.platePerLb(), ...this.plateSrc(), paintUnitsEach: this.unitsFor(1, len) } });
    return lb;
  }
  /** Standard Parts & Products line at catalog sell price (+ its built shop hours). */
  std(description: string, qty: number, category: CategoryKey = 'stdParts', meta: LineMeta = {}) {
    if (qty <= 0) return;
    const sell = this.cat.stdSell(description);
    if (sell == null) { this.notes.push(`Standard part not found: ${description}`); return; }
    const hrs = this.cat.stdHours(description);
    const gm = this.cat.stdGm?.(description);
    const okGm = gm != null && Number.isFinite(gm) && gm >= 0 && gm < 1 ? gm : undefined;
    this.push({ kind: 'material', category, description, qty, unitSell: sell, ...(okGm != null ? { gmPct: okGm } : {}) }, { ...meta, detail: { type: 'std', sellEach: sell, builtHrsEach: hrs } });
    this.builtHrs += qty * hrs;
  }
  /** Hoist & Crane Vendor Items line: list × (1 − PWI disc) cost, sold at list × (1 − customer disc). */
  vend(part: string, qty: number, meta: LineMeta = {}) {
    if (qty <= 0) return;
    const p = this.cat.vendor(part); if (!p) { this.notes.push(`Vendor part not found: ${part}`); return; }
    const d = this.cat.discount(p.vendor), cost = p.list * (1 - d.pwi / 100), sell = p.list * (1 - d.customer / 100);
    this.push({ kind: 'material', category: 'vendor', description: `${p.vendor} ${part} — ${p.description}`, qty, unitCost: Math.round(cost * 100) / 100, markupPct: Math.round((sell / cost - 1) * 10000) / 100 },
      { role: meta.role ?? vendorRole(part, p.description), basis: meta.basis, detail: { type: 'vendor', vendor: p.vendor, part, partDescription: p.description, list: p.list, pwiDiscPct: d.pwi, customerDiscPct: d.customer, costEach: cost, sellEach: sell } });
  }
  /** Cost-based item (Cost Based Items tab). */
  cost(description: string, qty: number, unitCost: number, markupPct: number, category: CategoryKey = 'costBased', meta: LineMeta = {}) {
    if (qty <= 0) return;
    this.push({ kind: 'material', category, description, qty, unitCost: Math.round(unitCost * 100) / 100, markupPct }, { ...meta, detail: { type: 'cost', costEach: unitCost, markupPct } });
  }
  /** A line priced at a fixed sell each (catalog products, VRC models, …). */
  sell(description: string, qty: number, unitSell: number, category: CategoryKey, meta: LineMeta = {}) {
    if (qty <= 0) return;
    this.push({ kind: 'material', category, description, qty, unitSell: Math.round(unitSell * 100) / 100 }, { ...meta, detail: { type: category === 'painting' ? 'paint' : 'sell', ...(category === 'painting' ? { run: 'flat', pieceUnits: 0, piecesPerRun: 0, runRate: unitSell } : { sellEach: unitSell }) } as LineDetail });
  }
  /** Paint booth runs: 16 piece-units per run; custom colors priced as custom runs (min 1). */
  paint(customUnits: number, customLabel: string | null, opts: { primerOnly?: boolean } = {}) {
    const P = { ...R.paint, standardRun: this.cat.rate?.('Standard Paint Full Booth Run') ?? R.paint.standardRun, customRun: this.cat.rate?.('Custom Color Paint Full Booth Run') ?? R.paint.customRun,
      primerRun: this.cat.rate?.('Primer Full Booth Run') ?? 1587 };
    const runsFor = (u: number) => Math.max(1, Math.ceil(u / P.piecesPerRun / P.roundTo) * P.roundTo);
    if (this.units <= 0) return;
    const pd = (run: 'standard' | 'custom' | 'primer', pieceUnits: number, runRate: number, colorLabel?: string): LineMeta & { detail: LineDetail } => ({
      role: 'paint',
      basis: { source: 'rule', text: `${pieceUnits} piece-units (pieces ≤ ${R.paint.maxLenFt}' count once, longer count per ${R.paint.maxLenFt}') ÷ ${P.piecesPerRun} per booth run${run === 'custom' ? `, min ${P.customMinRuns} run${P.customMinRuns > 1 ? 's' : ''}` : `, rounded up to ${P.roundTo}`} @ $${runRate}/run`, ...(run === 'custom' ? { assumption: 'colors' } : {}) },
      detail: { type: 'paint', run, pieceUnits, piecesPerRun: P.piecesPerRun, runRate, ...(run === 'custom' ? { minRuns: P.customMinRuns, colorLabel } : {}) } });
    if (customUnits > 0 && customLabel) {
      const cRuns = Math.max(P.customMinRuns, Math.ceil(customUnits / P.piecesPerRun));
      this.push({ kind: 'material', category: 'painting', description: `Custom color paint full booth run (${customLabel})`, qty: cRuns, unitSell: P.customRun }, pd('custom', customUnits, P.customRun, customLabel));
      const rest = Math.max(0, this.units - customUnits);
      if (rest > 0) this.push({ kind: 'material', category: 'painting', description: 'Standard paint full booth run (gray + Spark Orange)', qty: runsFor(rest), unitSell: P.standardRun }, pd('standard', rest, P.standardRun));
      this.A.push({ field: 'colors', value: customLabel, why: `Custom color = $${P.customRun}/run, min ${P.customMinRuns} full run; ${customUnits} piece-units custom`, alt: {}, altLabel: 'Standard gray / Spark Orange' });
    } else if (opts.primerOnly) this.push({ kind: 'material', category: 'painting', description: 'Primer full booth run', qty: runsFor(this.units), unitSell: P.primerRun }, pd('primer', this.units, P.primerRun));
    else this.push({ kind: 'material', category: 'painting', description: 'Standard paint full booth run (gray + Spark Orange)', qty: runsFor(this.units), unitSell: P.standardRun }, pd('standard', this.units, P.standardRun));
  }
  decal(name: string, qty: number) { const ds = this.cat.decalSell(name); if (ds && qty > 0) this.push({ kind: 'material', category: 'decals', description: name, qty, unitSell: ds }, { role: 'decal', detail: { type: 'sell', sellEach: ds } }); }
  matSell() {
    return this.lines.filter(l => l.kind === 'material').reduce((a, l) => a + (l.unitSell != null && l.unitCost == null ? l.unitSell * l.qty : (l.unitCost ?? 0) * l.qty * (1 + (l.markupPct ?? 0) / 100)), 0);
  }
  /** Shop labor: SMT-method hours × production factor, plus the handling rule. Built-part hours are tracked, not priced. */
  shop(ops: [string, number][], opts: { handling?: boolean; builtParts?: boolean } = {}) {
    const O = R.shopOps;
    const list = [...ops];
    // SMT Labor row 49 "PWI Built Items" only counts these hours (no $ column) — the standard-part sell price already
    // carries the labor. Pricing them again double-counted (fixed 11/20). They stay in smtShopHours for scheduling.
    const nOps = list.length;
    if (opts.builtParts === true) list.push(['PWI built standard parts', this.builtHrs]);
    else this.smtShopHours += this.builtHrs;
    const ms = this.matSell();
    if (opts.handling !== false) list.push(['Handling / shipping', Math.max(O.handling.min, Math.round(O.handling.pctOfMaterialSell * ms / O.handling.perHour))]);
    const blk = smtLaborBlock(this.fam);
    // Size taper (wide calibration, round 3): big crane jobs carry fewer shop hours per op than the SMT method gives.
    const taper = shopTaper(this.fam, ms), pf = Math.round(this.f.production * taper * 1000) / 1000;
    const tTxt = taper < 1 ? ` × size taper ${taper.toFixed(3)} (material sell $${Math.round(ms).toLocaleString('en-US')})` : '';
    list.forEach(([d, h], i) => {
      this.smtShopHours += h;
      const kind = i < nOps ? 'op' : d === 'Handling / shipping' ? 'handling' : 'built';
      const hours = Math.round(h * pf * 10) / 10;
      const basis: Basis = kind === 'handling'
        ? { source: 'rule', text: `max(${O.handling.min} h, ${O.handling.pctOfMaterialSell * 100}% of material sell $${Math.round(ms).toLocaleString('en-US')} ÷ $${O.handling.perHour}/h) × production ${this.f.production}${tTxt}` }
        : kind === 'built' ? { source: 'rule', text: `Built-in hours of the PWI-built standard parts on this item × production ${this.f.production}${tTxt}` }
        : { source: 'rule', text: `SMT labor op ${Math.round(h * 10) / 10} h × ${this.fam} production factor ${this.f.production}${tTxt}` };
      if (h > 0) this.push({ kind: 'shop_labor', category: 'shopLabor', description: d, qty: hours, laborOp: 'shop_other' },
        { role: 'shop_labor', basis, detail: { type: 'labor', where: 'shop', op: d, smtRow: kind === 'handling' ? blk.handlingRow : kind === 'built' ? 'Labor A49 PWI Built Items' : blk.block, baseHrs: h, factor: pf, factorName: 'production', hours } });
    });
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
      for (const x of sl) {
        const hrs = Math.round(x.hours * this.f.install * 10) / 10; this.site += hrs;
        const touch = x.desc === 'Paint touch-up + cleanup';
        this.push({ kind: 'site_labor', category: 'onsiteLabor', description: x.desc, qty: hrs, laborOp: 'site_other' },
          { role: 'install', basis: { source: 'rule', text: touch ? `${S2.touchupCleanup.base} h + ${S2.touchupCleanup.pctOfSubtotal * 100}% of ${Math.round(sub * 10) / 10} install hours × install factor ${this.f.install}` : `Site op ${Math.round(x.hours * 10) / 10} h × ${this.fam} install factor ${this.f.install}` },
            detail: { type: 'labor', where: 'site', op: x.desc, smtRow: 'Labor G9:G44 On Site Labor', baseHrs: x.hours, factor: this.f.install, factorName: 'install', hours: hrs } });
      }
      this.workHrs = workHrs;
      if (!o.skipTravel) this.travel({ workHrs, miles, workTopFt: o.workTopFt, heaviestPickLb: o.heaviestPickLb, generator: o.generator, crewMen: o.crewMen, travelMode: o.travelMode, extraEquipment: o.extraEquipment, ...(o.installDays ? { installDays: o.installDays } : {}), ...(o.trip ? { trip: o.trip } : {}) });
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
      const men = o.crewMen ?? crewMenFor(workHrs);
      if (!o.crewMen) this.A.push({ field: 'crewMen', value: men, why: `${Math.round(workHrs)} on-site hours → ${men}-man crew`, alt: men === 2 ? 3 : 2 });
      // installDays (spec): the rep's crew days drive the whole trip; the builder's own days stay the install suggestion.
      const builtDays = crewDaysFor(workHrs, men), setDays = o.installDays && o.installDays > 0 ? o.installDays : undefined;
      const crewDays = setDays ?? builtDays;
      const bd = setDays != null ? { builtCrewDays: builtDays } : {};   // detail: the builder's days, only when overridden
      // daily commute when the one-way drive is ≤ 1.5 h (site drive time when known, else miles ÷ mph); fly past flyAboveDriveHrs
      const driveHrs = o.trip?.driveMinutes != null ? o.trip.driveMinutes / 60 : miles / T.driveMph;
      const dh = `${driveHrs.toFixed(1)} h drive${o.trip?.driveMinutes != null ? '' : ` (${miles} mi ÷ ${T.driveMph} mph)`}`;
      const mode = o.travelMode ?? (driveHrs <= T.localMaxDriveHrs ? 'local' : driveHrs > T.flyAboveDriveHrs ? 'fly' : 'drive');
      if (!o.travelMode) this.A.push({ field: 'travelMode', value: mode, why: mode === 'local' ? `${dh} ≤ ${T.localMaxDriveHrs} h — daily commute, no lodging` : mode === 'fly' ? `${dh} > ${T.flyAboveDriveHrs} h — crew flies, rental car, job box ships, tools ship LTL back` : `${dh} > ${T.localMaxDriveHrs} h — crew drives and stays (hotel + per diem)`, alt: mode === 'fly' ? 'drive' : mode === 'drive' ? 'fly' : 'drive' });
      const hrsFor = (d: number) => mode === 'local' ? men * 2 * d * miles / T.driveMph : mode === 'fly' ? men * 2 * T.flyDoorToDoorHrsEachWay : men * 2 * miles / T.driveMph;
      const travelHrs = hrsFor(crewDays);
      const tbasis: Basis = setDays != null
        ? { source: 'spec', text: `${men} men × ${crewDays} crew days set on the spec (installDays; builder suggests ${builtDays} for ${Math.round(workHrs)} on-site h at ${R.crew.hoursPerDay} h/day), ${mode} ${miles} mi`, assumption: 'installDays' }
        : { source: 'rule', text: `${Math.round(workHrs)} on-site h → ${men} men × ${crewDays} crew days (${R.crew.hoursPerDay} h/day), ${mode} ${miles} mi`, assumption: o.crewMen ? undefined : 'crewMen' };
      // the install suggestion (this.site) is always the builder's own: travel hours at the builder's days
      this.site += setDays != null ? (hrsFor(builtDays) > 0 ? Math.round(hrsFor(builtDays)) : 0) : 0;
      if (travelHrs > 0) {
        const th = Math.round(travelHrs); if (setDays == null) this.site += th;
        this.push({ kind: 'site_labor', category: 'onsiteLabor', description: `Travel (${mode}, ${men} men, ${miles} mi)`, qty: th, laborOp: 'site_travel' },
          { role: 'travel_time', basis: { source: 'rule', text: mode === 'local' ? `${men} men × 2 × ${crewDays} days × ${miles} mi ÷ ${T.driveMph} mph (daily commute)` : mode === 'fly' ? `${men} men × 2 × ${T.flyDoorToDoorHrsEachWay} h door to door` : `${men} men × 2 × ${miles} mi ÷ ${T.driveMph} mph`, assumption: o.travelMode ? undefined : 'travelMode' },
            detail: { type: 'travel', what: 'travel_time', mode, men, crewDays, miles, driveMph: T.driveMph, ...bd } });
      }
      if (mode !== 'local') {
        // away crews work Mon–Sat; Sunday is off but they stay (hotel + per diem for each Sunday the job spans)
        const weekendDays = T.stayWeekendsWhenAway ? Math.floor(Math.max(0, crewDays - 1) / T.workDaysPerWeekAway) : 0;
        const days = crewDays + weekendDays + (miles > T.sameDayDriveMiles ? 2 : 0);
        const tl = (d: string, qty: number, c: number, what: 'hotel' | 'per_diem' | 'flight' | 'rental_car' | 'tool_return', role: Role) => this.push({ kind: 'travel', category: 'travel', description: d, qty, unitCost: c, markupPct: T.markupPct },
          { role, basis: { ...tbasis, assumption: 'crewDays' }, detail: { type: 'travel', what, mode, men, crewDays, tripDays: days, nights: days - 1, miles, rate: c, markupPct: T.markupPct, ...bd } });
        tl(`Hotels — ${men} rooms × ${days - 1} nights`, men * (days - 1), T.hotel, 'hotel', 'lodging');
        tl(`Per diem — ${men} men × ${days} days`, men * days, T.perDiem, 'per_diem', 'per_diem');
        // fare: live search (spec) → SBN fare table (nearest airport) → flat fallback
        const fare = o.trip?.airfarePerPerson, tf = !fare && mode === 'fly' ? tableFare(o.trip ?? {}) : undefined;
        const base = fare ?? tf?.fare, fareCost = base ? Math.round(base * T.airfareMultiplier * 100) / 100 : T.flightPerMan;
        if (mode === 'fly' && tf) this.notes.push(`Airfare from the SBN fare table: SBN → ${tf.code} (${tf.city}) $${tf.fare} round trip (survey ${tf.pulledOn}) × ${T.airfareMultiplier}. Search a live fare ~2 weeks out to confirm.`);
        if (mode === 'fly' && !fare && !tf) this.notes.push(`No airfare searched and no job state — flights priced at the $${T.flightPerMan}/man fallback. Search a round trip from South Bend (SBN) ~2 weeks out and add it to the spec (trip.airfarePerPerson).`);
        const fdesc = fare ? `Flights ${o.trip?.airfareRoute ?? ''} (round trip per man: searched $${fare}${o.trip?.airfareDates ? `, ${o.trip.airfareDates}` : ''} × ${T.airfareMultiplier})`.replace('Flights  (', 'Flights (')
          : tf ? `Flights SBN → ${tf.code} (round trip per man: fare table $${tf.fare} × ${T.airfareMultiplier})` : 'Flights (round trip per man)';
        if (mode === 'fly') { tl(fdesc, men, fareCost, 'flight', 'airfare'); tl('Rental car (weekly)', Math.ceil(days / 7), T.rentalCarWeekly, 'rental_car', 'rental_car'); tl('LTL tool return to PWI', 1, T.toolReturnLtl, 'tool_return', 'tool_return'); }
        this.A.push({ field: 'crewDays', value: crewDays, why: setDays != null
          ? `${crewDays} days on site set on the spec (installDays; builder suggests ${builtDays})${weekendDays ? ` + ${weekendDays} Sunday${weekendDays > 1 ? 's' : ''} off (paid)` : ''} + ${days - crewDays - weekendDays} travel days; lodging $${T.hotel}/night, per diem $${T.perDiem} (+${T.markupPct}%)`
          : `${Math.round(workHrs)} h ÷ (${men} men × ${R.crew.hoursPerDay} h) → ${crewDays} days on site${weekendDays ? ` + ${weekendDays} Sunday${weekendDays > 1 ? 's' : ''} off (paid)` : ''} + ${days - crewDays - weekendDays} travel days; lodging $${T.hotel}/night, per diem $${T.perDiem} (+${T.markupPct}%)` });
      }
      const E = R.equipment, weeks = Math.ceil(crewDays / (mode === 'local' ? 5 : T.workDaysPerWeekAway));
      const eq = (item: string, qty: number, purpose: 'lift' | 'handler' | 'generator' | 'extra', why: string) => {
        const it = this.cat.equip(item); if (!it) { this.notes.push(`Equipment ${item} not in list`); return; }
        const useWeekly = crewDays >= E.weekly.fromDays; const unit = useWeekly ? (weeks >= E.monthly.fromWeeks ? it.monthly * weeks / 4 : it.weekly * weeks) : it.daily * crewDays;
        const period = !useWeekly ? 'day' : weeks >= E.monthly.fromWeeks ? 'month' : 'week';
        this.push({ kind: 'equipment', category: 'equipment', description: `${item} — ${useWeekly ? `${weeks} wk` : `${crewDays} day`}`, qty, unitCost: Math.round(unit * 100) / 100, markupPct: E.markupPct },
          { role: purpose === 'lift' ? 'lift' : purpose === 'generator' ? 'generator' : purpose === 'handler' ? (/fork/i.test(item) ? 'forklift' : 'telehandler') : 'equipment',
            basis: { source: 'rule', text: `${why}; ${period === 'day' ? `${crewDays} days × $${it.daily}/day` : period === 'week' ? `${weeks} wk × $${it.weekly}/wk` : `${weeks} wk × $${it.monthly}/month ÷ 4`}`, assumption: 'equipment' },
            detail: { type: 'equipment', item, purpose, period, crewDays, ...bd, weeks, rates: { daily: it.daily, weekly: it.weekly, monthly: it.monthly }, markupPct: E.markupPct, why } });
      };
      const liftItem = E.lift.find(l => o.workTopFt <= l.maxColumnTopFt)!.item;
      const liftMax = E.lift.find(l => o.workTopFt <= l.maxColumnTopFt)!.maxColumnTopFt;
      eq(liftItem, (E.liftsByMen as any)[String(men)] ?? 1, 'lift', `Work height ${o.workTopFt.toFixed(1)}' ≤ ${liftMax}'; ${(E.liftsByMen as any)[String(men)] ?? 1} per ${men}-man crew`);
      const pick1 = o.heaviestPickLb * E.handler.reachFactor;
      const handler = (E.handler.classes as [number, string][]).find(([m]) => pick1 <= m)?.[1];
      const hWhy = `Heaviest pick ${Math.round(o.heaviestPickLb)} lb × reach ${E.handler.reachFactor} = ${Math.round(pick1)} lb`;
      if (handler) eq(handler, 1, 'handler', hWhy); else { eq('Rental 15K Telehandler', 1, 'handler', `${hWhy} — past the largest class`); this.blockers.push(`Heaviest pick ≈ ${Math.round(o.heaviestPickLb)} lb — ${E.handler.aboveMaxFlag}.`); }
      if (o.generator) eq('Wacker Neuson Large Generator', 1, 'generator', 'Rail welding / no building power');
      for (const x of o.extraEquipment ?? []) eq(x, 1, 'extra', 'Requested on the spec');
      const nDel = 1 + (handler && handler !== 'Rental Fork Lift' ? 1 : 0);
      this.push({ kind: 'equipment', category: 'equipment', description: 'Rental delivery / pickup', qty: nDel, unitCost: E.deliveryFee, markupPct: 0 },
        { role: 'rental_delivery', basis: { source: 'rule', text: `${nDel} delivery/pickup @ $${E.deliveryFee} (lift${nDel > 1 ? ' + handler' : ''})` },
          detail: { type: 'equipment', item: 'Rental delivery / pickup', purpose: 'delivery', period: 'day', crewDays, ...bd, weeks, markupPct: 0 } });
      this.A.push({ field: 'equipment', value: `${liftItem}, ${handler ?? '15K telehandler + crane?'}${o.generator ? ', generator' : ''} × ${weeks} wk`, why: `Work height ≈ ${o.workTopFt.toFixed(1)}', heaviest pick ≈ ${Math.round(o.heaviestPickLb)} lb, ${crewDays} crew days` });
      }
  /** PM + CAD hours scale with job size: $ = k·(materials + shop $, in $k)^exp (fitted on sold crane jobs). */
  pmCad(mult = 1, mins?: { pm?: number; cad?: number }) {
    const P = R.pmCad as any;
    const rest = this.matSell() + this.smtShopHours * this.f.production * P.shopRate;
    const dollars = P.k * Math.pow(Math.max(rest, 1000) / 1000, P.exp) * mult;
    const pm = Math.max(mins?.pm ?? P.pmMin, Math.round(dollars * P.pmShare / P.pmRate));
    const cad = Math.max(mins?.cad ?? P.cadMin, Math.round(dollars * (1 - P.pmShare) / P.cadRate));
    const txt = (w: string) => `$${P.k} × ((materials + shop $) $${Math.round(rest).toLocaleString('en-US')} ÷ 1000)^${P.exp}${mult !== 1 ? ` × ${mult}` : ''} = $${Math.round(dollars).toLocaleString('en-US')} → ${w}`;
    this.push({ kind: 'pm', category: 'pmMarketing', description: 'Project management', qty: pm },
      { role: 'pm', basis: { source: 'rule', text: txt(`${P.pmShare * 100}% ÷ $${P.pmRate}/h (min ${mins?.pm ?? P.pmMin} h)`) },
        detail: { type: 'pmcad', what: 'pm', method: 'power_law', driverDollars: rest, k: P.k, exp: P.exp, mult, share: P.pmShare, rate: P.pmRate, min: mins?.pm ?? P.pmMin, hours: pm } });
    this.push({ kind: 'cad', category: 'cad', description: 'AutoCAD design / approval drawings', qty: cad },
      { role: 'cad', basis: { source: 'rule', text: txt(`${Math.round((1 - P.pmShare) * 100)}% ÷ $${P.cadRate}/h (min ${mins?.cad ?? P.cadMin} h)`) },
        detail: { type: 'pmcad', what: 'cad', method: 'power_law', driverDollars: rest, k: P.k, exp: P.exp, mult, share: 1 - P.pmShare, rate: P.cadRate, min: mins?.cad ?? P.cadMin, hours: cad } });
  }
  /** Fixed PM / CAD hours (products priced per unit on their SMT tab, e.g. work platform sets). */
  pmCadFixed(pmHrs: number, cadHrs: number) {
    const fx = (what: 'pm' | 'cad', h: number): LineMeta & { detail: LineDetail } => ({ role: what, basis: { source: 'fixed', text: `Fixed ${what === 'pm' ? 'PM' : 'CAD'} hours per unit from the ${this.fam} SMT tab` }, detail: { type: 'pmcad', what, method: 'fixed', hours: Math.round(h * 10) / 10 } });
    if (pmHrs > 0) this.push({ kind: 'pm', category: 'pmMarketing', description: 'Project management', qty: Math.round(pmHrs * 10) / 10 }, fx('pm', pmHrs));
    if (cadHrs > 0) this.push({ kind: 'cad', category: 'cad', description: 'AutoCAD design / approval drawings', qty: Math.round(cadHrs * 10) / 10 }, fx('cad', cadHrs));
  }
  /** Engineering (P.E. stamp) hours. */
  pe(hours: number, basis?: Basis) { if (hours > 0) this.push({ kind: 'engineering', category: 'engineering', description: 'P.E. calculations / stamped drawings', qty: hours }, { role: 'pe', basis, detail: { type: 'pe', hours } }); }
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
/** Unity of a W shape under sizeBeam()'s own checks (same Ix estimate, loads and limits) — for the editor's basis.
 *  Read-only: never changes a pick. deflection = I required / I, bending = M/S ÷ allowable. */
export function beamUnity(shape: string, opts: { spanFt: number; wPlf?: number; pointLb?: number; liveFrac?: number; deflLimit: number; allowKsi?: number }): { unity: number; checks: { name: string; unity: number }[] } | null {
  const m = /^W(\d+) x (\d+(?:\.\d+)?)$/.exec(shape); if (!m) return null;
  const d = Number(m[1]), wt = Number(m[2]), I = IX_COEF * wt * d * d, S = 2 * I / d;
  const L = opts.spanFt * 12, E = 29e6, w = (opts.wPlf ?? 0) / 12, P = opts.pointLb ?? 0, live = opts.liveFrac ?? 1;
  const Ireq = (w ? 5 * w * live * L ** 4 / (384 * E * (L / opts.deflLimit)) : 0) + (P ? P * live * L ** 3 / (48 * E * (L / opts.deflLimit)) : 0);
  const M = w * L * L / 8 + P * L / 4, allow = (opts.allowKsi ?? 24) * 1000;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const checks = [{ name: `deflection L/${opts.deflLimit}`, unity: r(Ireq / I) }, { name: `bending ${opts.allowKsi ?? 24} ksi`, unity: r(M / S / allow) }];
  return { unity: Math.max(...checks.map(c => c.unity)), checks };
}
/** Basis for a calc-sized member: carries unity and flags anything over PWI's 0.98 limit. */
export function calcBasis(text: string, u: { unity: number; checks: { name: string; unity: number }[] } | null | undefined, assumption?: string): Basis {
  return { source: 'calc', text, ...(u ? { unity: u.unity, checks: u.checks } : {}), ...(assumption ? { assumption } : {}),
    ...(u && u.unity > 0.98 ? { flag: `Unity ${u.unity.toFixed(2)} is over PWI's 0.98 limit — size up or have engineering confirm` } : {}) };
}
export const W_SHAPES = ['W6 x 15', 'W6 x 20', 'W6 x 25', 'W8 x 18', 'W8 x 21', 'W8 x 24', 'W8 x 31', 'W8 x 35', 'W10 x 19', 'W10 x 22', 'W10 x 26', 'W10 x 30', 'W10 x 33', 'W10 x 39', 'W10 x 45',
  'W12 x 19', 'W12 x 22', 'W12 x 26', 'W12 x 30', 'W12 x 35', 'W12 x 40', 'W12 x 45', 'W12 x 50', 'W12 x 53', 'W14 x 22', 'W14 x 26', 'W14 x 30', 'W14 x 34', 'W14 x 38', 'W14 x 43', 'W14 x 48',
  'W14 x 53', 'W14 x 61', 'W16 x 26', 'W16 x 31', 'W16 x 36', 'W16 x 40', 'W16 x 45', 'W16 x 50', 'W16 x 57', 'W16 x 67', 'W18 x 35', 'W18 x 40', 'W18 x 46', 'W18 x 50', 'W18 x 55', 'W18 x 60',
  'W18 x 65', 'W18 x 71', 'W18 x 76', 'W18 x 86', 'W21 x 44', 'W21 x 50', 'W21 x 57', 'W21 x 62', 'W21 x 68', 'W21 x 73', 'W21 x 83', 'W21 x 93', 'W21 x 101', 'W24 x 55', 'W24 x 62', 'W24 x 68',
  'W24 x 76', 'W24 x 84', 'W24 x 94', 'W24 x 104', 'W24 x 117', 'W24 x 131', 'W27 x 84', 'W27 x 94', 'W27 x 102', 'W27 x 114', 'W27 x 146', 'W30 x 90', 'W30 x 99', 'W30 x 108', 'W30 x 116',
  'W33 x 118', 'W33 x 130', 'W33 x 141', 'W33 x 169', 'W36 x 135', 'W36 x 150'];
