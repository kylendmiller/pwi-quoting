// One build path for every client (paste box, link, future Claude connector).
// Spec in → full quote doc out. Pure: the caller supplies the catalog and settings.
import { buildFreestanding, type Catalog, type Assumption } from './freestanding';
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

export function buildFromSpec(spec: QuoteSpec, cat: Catalog, settings: any, base: QuoteDoc): BuiltDoc {
  const pf = settings.production_factor ?? {}, inf = settings.install_factor ?? {};
  // Rebuilding replaces lines the builder made earlier; lines the rep added by hand stay.
  let lines = base.lines.filter(l => !(l as any).auto);
  const wording: string[] = [], notes: string[] = [], blockers: string[] = [], assumptions: BuiltDoc['assumptions'] = [];
  let install = 0, freight = 0, preUse = 0;
  spec.items.forEach((it, i) => {
    const label = spec.items.length > 1 ? `Item ${i + 1}${it.tag ? ` (${it.tag})` : ''}: ` : '';
    if (it.type !== 'freestanding') {
      notes.push(`${label}${it.type} isn't automatic yet — add its lines by hand.`);
      if (it.wording) wording.push(it.wording);
      return;
    }
    const r = buildFreestanding(it as any, cat, { production: pf.freestanding ?? 0.56, install: inf.freestanding ?? 1.02 });
    lines = lines.concat(r.lines.map(l => ({ ...l, auto: true }) as any));
    wording.push(r.wording);
    notes.push(...r.notes.map(n => label + n));
    blockers.push(...r.blockers.map(n => label + n));
    assumptions.push(...r.assumptions.map(a => ({ ...a, item: i })));
    install += r.suggestedInstallHours; freight += r.outboundFreight; preUse += r.preUse;
  });
  const doc: QuoteDoc = {
    ...base,
    family: spec.items[0].type === 'freestanding' ? 'freestanding' : base.family,
    lines,
    wording: wording.join('\n\n'),
    suggestedInstallHours: install || null,
    outboundFreight: Math.round(freight),
    preUse, showPreUse: preUse > 0,
    spec, assumptions, buildNotes: notes, blockers,
  } as QuoteDoc;
  return { doc, notes, blockers, assumptions };
}
