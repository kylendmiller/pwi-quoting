// One build path for every client (paste box, link, future Claude connector).
// Spec in → full quote doc out. Pure: the caller supplies the catalog and settings.
import { type Catalog, type Assumption } from './freestanding';
import { buildCrane, type BuildResult, type BuildOpts } from './crane';
import { buildGantry } from './gantry';
import { buildMonorail } from './monorail';
import { buildMezzanine } from './mezzanine';
import { buildWorkPlatform } from './workPlatform';
import { buildJib, buildFallProtection, buildVrc, buildCatalogItem } from './products';
import { Kit, readSteelCost, withSteelCost, type Factors } from './kit';

// Reps (and Claude) say "motorized" for every product; cranes call it bridgeDrive.
const drive = (s: any) => s.bridgeDrive || s.motorized == null ? s : { ...s, bridgeDrive: s.motorized ? 'motorized' : 'manual' };
type Builder = (spec: any, cat: Catalog, f: Factors, bo: BuildOpts) => BuildResult;
/** Every product the app can build. `fam` picks the production / install factor in settings. */
export const BUILDERS: Record<string, { fam: string; build: Builder; def: [number, number] }> = {
  // freestanding production 0.56 → 0.60 (wide calibration round 3, docs/round3/TUNING.md): shop $ built/sold median 0.85 on n=26 FSTR jobs;
  // 0.66 would centre shop $ but pushes the family's total gap up (vendor/plate run high on the same small jobs), 0.60 is the best value that lowers it.
  freestanding: { fam: 'freestanding', def: [0.6, 1.02], build: (s, c, f, b) => buildCrane({ ...drive(s), support: 'freestanding' }, c, f, b) },
  // bridge production stays 0.68: once built-part hours stopped being double-priced (11/20), builder shop $ ÷ sold = 0.89 / 0.81 / 0.84 / 1.43 on 28192 / 28426 / 29562 / 28772.
  bridge: { fam: 'bridge', def: [0.68, 1.0], build: (s, c, f, b) => buildCrane({ support: 'building_runway', ...drive(s) }, c, f, b) },
  gantry: { fam: 'gantry', def: [0.69, 1.09], build: buildGantry },
  monorail: { fam: 'monorail', def: [0.7, 1.02], build: buildMonorail },
  // mezzanine production 0.83 → 0.60 (tuned 11/20): builder shop $ ÷ sold = 0.55 on 28527 and 0.66 on 27893.
  mezzanine: { fam: 'mezzanine', def: [0.6, 1.11], build: buildMezzanine },
  work_platform: { fam: 'work_platform', def: [0.82, 0.95], build: buildWorkPlatform },
  jib: { fam: 'jib', def: [0.77, 1.25], build: buildJib },
  fall_protection: { fam: 'fall_protection', def: [0.7, 1.09], build: buildFallProtection },
  vrc: { fam: 'vrc', def: [0.73, 1.02], build: buildVrc },
  catalog: { fam: 'other', def: [0.76, 0.98], build: buildCatalogItem },
};
import type { QuoteDoc, QuoteLine, EditableField } from './manual';
import { sectionOf, type SectionKey } from './sections';

export interface QuoteSpec {
  pwi_quote: 1;
  project?: string;
  location?: string;
  customer?: { name?: string; city?: string; state?: string; contact?: { name?: string; email?: string; phone?: string } };
  items: ({ type: string; id?: string; tag?: string; wording?: string } & Record<string, any>)[];
}

/** Accepts raw JSON, JSON with chat text / code fences around it, or a full app link (#/new?s=…). */
export function parseSpec(text: string): QuoteSpec {
  const t = text.trim();
  const m = /[?&]s=([A-Za-z0-9_\-+/=%]+)/.exec(t);
  let j: any;
  if (m) j = JSON.parse(decodeB64(decodeURIComponent(m[1])));
  else {
    const b = t.match(/\{[\s\S]*\}/);
    if (!b) throw new Error('No quote spec found — paste the whole block or link Claude gave you.');
    j = JSON.parse(b[0]);
  }
  if (!Array.isArray(j.items) || !j.items.length) throw new Error('The spec has no items.');
  return j;
}
export function decodeB64(s: string): string {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '==='.slice((b.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

// ───────── S4: stable line refs ─────────
// ref = `${itemId}:${slot}`. itemId is a permanent id stored on the spec item (assigned once, then saved with the spec);
// travel / lodging / equipment lines use itemId 'trip' whether one item or several share the trip. slot is the line's
// role plus a stable name (description stem, labor op, travel kind, equipment purpose), "#n" for the nth duplicate.
const TRIP_ROLES = new Set(['travel_time', 'lodging', 'per_diem', 'airfare', 'rental_car', 'tool_return', 'lift', 'telehandler', 'forklift', 'generator', 'equipment', 'rental_delivery']);
const slug = (t: string) => t.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'line';
function hash6(t: string) { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36).slice(0, 6); }
/** Gives every spec item a permanent `id` (kept when present). Deterministic from the item's content and position,
 *  so the server and the browser assign the same id to a legacy spec; once saved, the id never changes. */
export function assignItemIds<T extends { items: any[] }>(spec: T): T {
  const used = new Set(spec.items.map(it => it?.id).filter((x): x is string => typeof x === 'string' && !!x));
  let changed = false;
  const items = spec.items.map((it, i) => {
    if (typeof it?.id === 'string' && it.id) return it;
    let id = `${String(it?.type ?? 'item').replace(/[^a-z0-9_]/gi, '')}-${i}-${hash6(JSON.stringify(it ?? {}))}`, n = 2;
    while (used.has(id)) id = `${id.replace(/~\d+$/, '')}~${n++}`;
    used.add(id); changed = true;
    return { ...it, id };
  });
  return changed ? { ...spec, items } : spec;
}
/** The slot name of a line (without the duplicate counter). */
export function slotBase(l: { role?: string; description: string; detail?: any }): string {
  const role = l.role ?? 'other', d = l.detail;
  if (d?.type === 'vendor') return role;
  if (d?.type === 'equipment') return `equip-${d.purpose}${d.purpose === 'extra' ? '-' + slug(d.item) : ''}`;
  if (d?.type === 'travel') return `travel-${d.what}`;
  if (d?.type === 'paint') return `paint-${d.run}`;
  if (d?.type === 'labor') return `${role}/${slug(d.op)}`;
  return `${role}/${slug(l.description.split(' — ')[0])}`;
}
/** Slot with the duplicate counter: n = 1 → base, n = 2 → base#2 … */
export const slotOf = (l: { role?: string; description: string; detail?: any }, n = 1) => n > 1 ? `${slotBase(l)}#${n}` : slotBase(l);
const isTripLine = (l: { role?: string; item?: number }) => l.item === -1 || (!!l.role && TRIP_ROLES.has(l.role));
/** Stamps refs on lines in order, counting duplicates per item id. Lines that already have a ref keep it. */
function stampRefs<L extends { ref?: string; role?: string; description: string; detail?: any; item?: number }>(lines: L[], idOf: (l: L) => string | undefined): L[] {
  const seen = new Map<string, number>();
  for (const l of lines) if (l.ref) seen.set(l.ref, 1);
  return lines.map(l => {
    if (l.ref) return l;
    const id = isTripLine(l) ? 'trip' : idOf(l); if (!id) return l;
    const b = `${id}:${slotBase(l)}`; const n = (seen.get(b) ?? 0) + 1; seen.set(b, n);
    return { ...l, ref: n > 1 ? `${b}#${n}` : b };
  });
}
/** Legacy docs (saved before refs): give the auto lines refs from the spec's item ids, the way a build would. */
export function ensureRefs(doc: QuoteDoc): QuoteDoc {
  const sp = doc.spec as QuoteSpec | undefined;
  if (!sp || !Array.isArray(sp.items) || !doc.lines.some(l => l.auto && !l.ref)) return sp && Array.isArray(sp.items) ? { ...doc, spec: assignItemIds(sp) } : doc;
  const spec = assignItemIds(sp);
  const auto = stampRefs(doc.lines.filter(l => l.auto), l => (l.item != null && l.item >= 0 ? spec.items[l.item]?.id : undefined));
  let k = 0;
  return { ...doc, spec, lines: doc.lines.map(l => (l.auto ? auto[k++] : l)) };
}

/** A rep's edit that a rebuild couldn't apply silently (S5). */
export interface Conflict {
  id: string;                       // `${ref}|${field}`
  ref: string; description: string; section: SectionKey;
  kind: 'changed' | 'gone';         // changed: builder value moved under your edit; gone: builder no longer makes this line
  field: EditableField | '*';
  builderWas: unknown; builderNow: unknown; yours: unknown;
}
export interface BuiltDoc { doc: QuoteDoc; notes: string[]; blockers: string[]; assumptions: (Assumption & { item: number })[]; conflicts: Conflict[] }

/** Items pasted without ids inherit the id of the old item at the same index when the type matches. */
export function inheritIds<T extends { items: any[] }>(spec: T, old: unknown): T {
  const oi: any[] = Array.isArray((old as any)?.items) ? (old as any).items : [];
  if (!spec.items.some(it => !it?.id)) return spec;
  const used = new Set(spec.items.map(it => it?.id).filter(Boolean));
  return { ...spec, items: spec.items.map((it, i) => {
    const o = oi[i];
    return !it?.id && o?.id && o.type === it?.type && !used.has(o.id) ? { ...it, id: o.id } : it;
  }) };
}
const same = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b;

/** S5: carries the rep's edits from the old auto lines onto the fresh build (matched by ref), keeps deleted refs
 *  deleted, and reports conflicts. Edited lines the builder no longer makes are kept as hand lines. */
function carryEdits(fresh: QuoteLine[], old: QuoteLine[], removed: Set<string>): { lines: QuoteLine[]; conflicts: Conflict[] } {
  const conflicts: Conflict[] = [];
  const oldBy = new Map(old.filter(l => l.auto && l.ref).map(l => [l.ref!, l]));
  const freshRefs = new Set(fresh.map(l => l.ref));
  const lines: QuoteLine[] = [];
  for (const n0 of fresh) {
    if (n0.ref && removed.has(n0.ref)) continue;
    const o = n0.ref ? oldBy.get(n0.ref) : undefined;
    if (!o?.edited || !Object.keys(o.edited).length) { lines.push(o ? { ...n0, key: o.key } : n0); continue; }
    const n: any = { ...n0, key: o.key }; const edited: Record<string, unknown> = {};
    for (const [f, builderWas] of Object.entries(o.edited) as [EditableField, unknown][]) {
      const yours = (o as any)[f], builderNow = (n0 as any)[f];
      if (same(yours, builderNow)) continue;                   // the builder now agrees with you
      n[f] = yours; edited[f] = builderNow;
      if (!same(builderWas, builderNow)) conflicts.push({ id: `${o.ref}|${f}`, ref: o.ref!, description: n0.description, section: sectionOf(n0.category), kind: 'changed', field: f, builderWas, builderNow, yours });
    }
    if (Object.keys(edited).length) n.edited = edited; else delete n.edited;
    if (o.builtDetail && o.detail && n0.detail && o.detail.type === n0.detail.type && n.edited) { n.detail = o.detail; n.builtDetail = n0.detail; }
    lines.push(n);
  }
  for (const o of old) {
    if (!o.auto || !o.ref || freshRefs.has(o.ref) || removed.has(o.ref) || !o.edited || !Object.keys(o.edited).length) continue;
    const { edited: _e, builtDetail: _b, basis: _x, ...rest } = o;
    lines.push({ ...rest, auto: false, source: 'hand' });
    conflicts.push({ id: `${o.ref}|*`, ref: o.ref, description: o.description, section: sectionOf(o.category), kind: 'gone', field: '*', builderWas: o.edited, builderNow: null, yours: o.description });
  }
  return { lines, conflicts };
}

export function buildFromSpec(spec0: QuoteSpec, cat0: Catalog, settings: any, base0: QuoteDoc): BuiltDoc {
  const base = base0.lines.some(l => l.auto && !l.ref) ? ensureRefs(base0) : base0;
  const spec = assignItemIds(inheritIds(spec0, base.spec));
  // Steel cost comes from one dated setting (settings.steel_cost) when present; otherwise the catalog's group prices.
  const steel = readSteelCost(settings.steel_cost);
  const cat = steel.sc ? withSteelCost(cat0, steel.sc) : cat0;
  const pf = settings.production_factor ?? {}, inf = settings.install_factor ?? {};
  // Rebuilding replaces lines the builder made earlier; lines the rep added by hand stay. Auto lines the rep edited
  // keep the edited fields (carryEdits below); auto lines the rep deleted (doc.removed) stay deleted.
  const handLines = base.lines.filter(l => !(l as any).auto);
  let lines: QuoteLine[] = [];
  const wording: string[] = [], notes: string[] = [], blockers: string[] = [], assumptions: BuiltDoc['assumptions'] = [];
  if (steel.problem) notes.push(steel.problem);
  const sc = cat.steelCost;
  if (sc) assumptions.push({ item: -1, field: 'steelCost', value: sc.effective, why: `Steel $/lb from the ${sc.effective} steel cost setting${sc.source ? ` (${sc.source})` : ''}; groups it doesn't list use the price list` });
  let install = 0, freight = 0, preUse = 0;
  // Several installed items on one job share one trip: build each without travel, then price the trip once.
  const installed = spec.items.filter(it => BUILDERS[it.type] && it.install);
  const shared = installed.length > 1;
  const trip = { workHrs: 0, workTopFt: 0, heaviestPickLb: 0, generator: false, miles: 0, crewMen: undefined as number | undefined, travelMode: undefined as any };
  spec.items.forEach((it, i) => {
    const label = spec.items.length > 1 ? `Item ${i + 1}${it.tag ? ` (${it.tag})` : ''}: ` : '';
    const B = BUILDERS[it.type];
    if (!B) {
      notes.push(`${label}${it.type} isn't automatic yet — add its lines by hand.`);
      if (it.wording) wording.push(it.wording);
      return;
    }
    let r: BuildResult;
    const { id: _id, ...bare } = it as any;
    try { r = B.build(bare, cat, { production: pf[B.fam] ?? B.def[0], install: inf[B.fam] ?? B.def[1] }, { skipTravel: shared && !!it.install }); }
    catch (e: any) { blockers.push(`${label}${e.message ?? e}`); return; }
    const group = `${spec.items.length > 1 ? `Item ${i + 1}` : 'Item'}${it.tag ? ` (${it.tag})` : ''} — ${it.type.replace(/_/g, ' ')}`;
    const tag = (l: any) => ({ ...l, auto: true, source: 'auto', item: i, group });
    lines = lines.concat(stampRefs(r.lines.map(tag), () => it.id) as any);
    wording.push(it.wording ?? r.wording);
    notes.push(...r.notes.map(n => label + n));
    blockers.push(...r.blockers.map(n => label + n));
    assumptions.push(...r.assumptions.map(a => ({ ...a, item: i })));
    install += r.suggestedInstallHours; freight += r.outboundFreight; preUse += r.preUse;
    if (shared && it.install && r.job) {
      trip.workHrs += r.job.workHrs ?? 0; trip.workTopFt = Math.max(trip.workTopFt, r.job.workTopFt ?? 0);
      trip.heaviestPickLb = Math.max(trip.heaviestPickLb, r.job.heaviestPickLb ?? 0); trip.generator ||= !!r.job.generator;
      trip.miles = Math.max(trip.miles, it.miles ?? 0); trip.crewMen ??= it.crewMen; trip.travelMode ??= it.travelMode;
    }
  });
  if (shared && trip.workHrs > 0) {
    const K = new Kit(cat, 'other', { production: 1, install: 1 });
    K.travel(trip);
    lines = lines.concat(stampRefs(K.lines.map(l => ({ ...l, auto: true, source: 'auto' as const, item: -1, group: `Shared trip (${installed.length} installed items)` })), () => 'trip') as any);
    assumptions.push(...K.A.map(a => ({ ...a, item: -1 })));
    notes.push(`One shared trip for ${installed.length} installed items (${Math.round(trip.workHrs)} on-site hours).`);
  }
  const removed = new Set(Array.isArray(base.removed) ? base.removed : []);
  const carried = carryEdits(lines, base.lines, removed);
  const doc: QuoteDoc = {
    ...base,
    family: BUILDERS[spec.items[0].type]?.fam ?? base.family,
    lines: [...handLines, ...carried.lines],
    wording: wording.join('\n\n'),
    suggestedInstallHours: install || null,
    outboundFreight: Math.round(freight),
    preUse, showPreUse: preUse > 0,
    spec, assumptions, buildNotes: notes, blockers,
    ...(sc ? { steelCostDate: sc.effective } : {}),
  } as QuoteDoc;
  return { doc, notes, blockers, assumptions, conflicts: carried.conflicts };
}
