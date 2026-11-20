// One build path for every client (paste box, link, future Claude connector).
// Spec in → full quote doc out. Pure: the caller supplies the catalog and settings.
import { type Catalog, type Assumption } from './freestanding';
import { buildCrane, type BuildResult, type BuildOpts } from './crane';
import { buildGantry } from './gantry';
import { buildMonorail } from './monorail';
import { buildMezzanine } from './mezzanine';
import { buildJib, buildFallProtection, buildVrc, buildCatalogItem } from './products';
import { Kit, readSteelCost, withSteelCost, type Factors } from './kit';

// Reps (and Claude) say "motorized" for every product; cranes call it bridgeDrive.
const drive = (s: any) => s.bridgeDrive || s.motorized == null ? s : { ...s, bridgeDrive: s.motorized ? 'motorized' : 'manual' };
type Builder = (spec: any, cat: Catalog, f: Factors, bo: BuildOpts) => BuildResult;
/** Every product the app can build. `fam` picks the production / install factor in settings. */
export const BUILDERS: Record<string, { fam: string; build: Builder; def: [number, number] }> = {
  freestanding: { fam: 'freestanding', def: [0.56, 1.02], build: (s, c, f, b) => buildCrane({ ...drive(s), support: 'freestanding' }, c, f, b) },
  bridge: { fam: 'bridge', def: [0.68, 1.0], build: (s, c, f, b) => buildCrane({ support: 'building_runway', ...drive(s) }, c, f, b) },
  gantry: { fam: 'gantry', def: [0.69, 1.09], build: buildGantry },
  monorail: { fam: 'monorail', def: [0.7, 1.02], build: buildMonorail },
  mezzanine: { fam: 'mezzanine', def: [0.83, 1.11], build: buildMezzanine },
  jib: { fam: 'jib', def: [0.77, 1.25], build: buildJib },
  fall_protection: { fam: 'fall_protection', def: [0.7, 1.09], build: buildFallProtection },
  vrc: { fam: 'vrc', def: [0.73, 1.02], build: buildVrc },
  catalog: { fam: 'other', def: [0.76, 0.98], build: buildCatalogItem },
};
import type { QuoteDoc } from './manual';

export interface QuoteSpec {
  pwi_quote: 1;
  project?: string;
  location?: string;
  customer?: { name?: string; city?: string; state?: string; contact?: { name?: string; email?: string; phone?: string } };
  items: ({ type: string; tag?: string; wording?: string } & Record<string, any>)[];
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

export interface BuiltDoc { doc: QuoteDoc; notes: string[]; blockers: string[]; assumptions: (Assumption & { item: number })[] }

export function buildFromSpec(spec: QuoteSpec, cat0: Catalog, settings: any, base: QuoteDoc): BuiltDoc {
  // Steel cost comes from one dated setting (settings.steel_cost) when present; otherwise the catalog's group prices.
  const steel = readSteelCost(settings.steel_cost);
  const cat = steel.sc ? withSteelCost(cat0, steel.sc) : cat0;
  const pf = settings.production_factor ?? {}, inf = settings.install_factor ?? {};
  // Rebuilding replaces lines the builder made earlier; lines the rep added by hand stay.
  let lines = base.lines.filter(l => !(l as any).auto);
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
    try { r = B.build(it, cat, { production: pf[B.fam] ?? B.def[0], install: inf[B.fam] ?? B.def[1] }, { skipTravel: shared && !!it.install }); }
    catch (e: any) { blockers.push(`${label}${e.message ?? e}`); return; }
    const tag = (l: any) => ({ ...l, auto: true, item: i });
    lines = lines.concat(r.lines.map(tag) as any);
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
    lines = lines.concat(K.lines.map(l => ({ ...l, auto: true })) as any);
    assumptions.push(...K.A.map(a => ({ ...a, item: -1 })));
    notes.push(`One shared trip for ${installed.length} installed items (${Math.round(trip.workHrs)} on-site hours).`);
  }
  const doc: QuoteDoc = {
    ...base,
    family: BUILDERS[spec.items[0].type]?.fam ?? base.family,
    lines,
    wording: wording.join('\n\n'),
    suggestedInstallHours: install || null,
    outboundFreight: Math.round(freight),
    preUse, showPreUse: preUse > 0,
    spec, assumptions, buildNotes: notes, blockers,
  } as QuoteDoc;
  return { doc, notes, blockers, assumptions };
}
