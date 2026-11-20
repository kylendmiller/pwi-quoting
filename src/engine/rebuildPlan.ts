// planRebuild / applyPlan (round 3 S5). Every path into a rebuild (spec chips, assumption alternates, a Claude
// paste) goes through a plan the rep sees first:
//   1. same spec at today's price lists and settings  → priceUpdates (steel_cost, vendor lists, rates moved)
//   2. the new spec on top of that                      → specChanges (what the rep's change itself does)
// Edits on auto lines survive (yours wins); a builder value that moved under your edit is a conflict you resolve.
import { buildFromSpec, ensureRefs, inheritIds, assignItemIds, type QuoteSpec, type Conflict } from './buildSpec';
import { priceManual, deriveFamily, pvHours, EDITABLE_FIELDS, type QuoteDoc, type QuoteLine, type Settings, type EditableField,
  type Flag, type QuoteMoney, type Priced } from './manual';
import { sectionize, sectionOf, SECTION_DEFS, type SectionKey } from './sections';
import type { Catalog } from './kit';

export interface LineChange {
  ref: string; section: SectionKey; description: string;
  change: 'add' | 'update' | 'remove' | 'kept_deleted';
  fields?: { field: EditableField; from: unknown; to: unknown }[];
  sellBefore: number; sellAfter: number;
}
export interface SectionMoney { key: SectionKey; label: string; before: number; after: number; delta: number; priceOnly: number; spec: number }
export interface RebuildPlan {
  priceUpdates: LineChange[];
  specChanges: LineChange[];
  conflicts: Conflict[];
  money: { before: QuoteMoney; after: QuoteMoney; delta: QuoteMoney; priceOnlyDelta: number; specDelta: number;
           bySection: SectionMoney[]; gmPctBefore: number; gmPctAfter: number };
  flags: { raised: Flag[]; cleared: Flag[] };
  notes: string[]; blockers: string[];
  empty: boolean;
  next: QuoteDoc;
  builderDoc: QuoteDoc;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const same = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b;
/** What the server does before pricing (family + PV hours from the spec). */
const norm = (d: QuoteDoc): QuoteDoc => { const x = { ...d }; x.family = deriveFamily(x); x.freestandingShopHours = pvHours(x); return x; };
const price = (d: QuoteDoc, s: Settings) => priceManual(norm(d), s);

function diffLines(a: QuoteDoc, pa: Priced, b: QuoteDoc, pb: Priced): LineChange[] {
  const sellOf = (p: Priced) => new Map(p.lines.filter(l => l.ref).map(l => [l.ref!, l.sell]));
  const sa = sellOf(pa), sb = sellOf(pb);
  const A = new Map(a.lines.filter(l => l.auto && l.ref).map(l => [l.ref!, l]));
  const B = new Map(b.lines.filter(l => l.auto && l.ref).map(l => [l.ref!, l]));
  const out: LineChange[] = [];
  for (const [ref, nb] of B) {
    const na = A.get(ref);
    if (!na) { out.push({ ref, section: sectionOf(nb.category), description: nb.description, change: 'add', sellBefore: 0, sellAfter: sb.get(ref) ?? 0 }); continue; }
    const fields = EDITABLE_FIELDS.filter(f => !same((na as any)[f], (nb as any)[f])).map(f => ({ field: f, from: (na as any)[f], to: (nb as any)[f] }));
    if (fields.length) out.push({ ref, section: sectionOf(nb.category), description: nb.description, change: 'update', fields, sellBefore: sa.get(ref) ?? 0, sellAfter: sb.get(ref) ?? 0 });
  }
  for (const [ref, na] of A) if (!B.has(ref)) out.push({ ref, section: sectionOf(na.category), description: na.description, change: 'remove', sellBefore: sa.get(ref) ?? 0, sellAfter: 0 });
  return out;
}

const bySection = (d: QuoteDoc, p: Priced) => new Map(sectionize(d, p, { includeEmpty: true }).sections.map(s => [s.key, s.totals.sell]));
const flagKey = (f: Flag) => `${f.rule}|${JSON.stringify(f.detail)}`;

/** opts.restore: refs of removed lines to bring back. They leave doc.removed / doc.removedInfo and show as 'add' in
 *  specChanges (the rep's change), not as price updates. */
export function planRebuild(old0: QuoteDoc, newSpec0: QuoteSpec, cat: Catalog, settings: Settings & Record<string, unknown>, opts: { restore?: string[] } = {}): RebuildPlan {
  const old = ensureRefs(old0);
  const oldSpec = old.spec as QuoteSpec | undefined;
  // 1. same spec, today's prices (edits kept)
  const A = oldSpec ? buildFromSpec(oldSpec, cat, settings, old) : null;
  const aDoc0 = A?.doc ?? old;
  const back = new Set(opts.restore ?? []);
  const aDoc = back.size ? forget(aDoc0, back) : aDoc0;
  // 2. new spec on top
  const newSpec = assignItemIds(inheritIds(newSpec0, oldSpec ?? { items: [] }));
  const B = buildFromSpec(newSpec, cat, settings, aDoc);
  const raw = buildFromSpec(newSpec, cat, settings, { ...aDoc, lines: [], removed: [] }).doc;
  const removed = new Set((old.removed ?? []).filter(r => !back.has(r)));

  const pOld = price(old, settings), pA = price(aDoc, settings), pB = price(B.doc, settings);
  const priceUpdates = A ? diffLines(old, pOld, aDoc0, pA) : [];
  const specChanges = diffLines(aDoc, pA, B.doc, pB);
  for (const l of raw.lines) if (l.ref && removed.has(l.ref))
    specChanges.push({ ref: l.ref, section: sectionOf(l.category), description: l.description, change: 'kept_deleted', sellBefore: 0, sellAfter: 0 });

  // conflicts: builderWas from the rep's original edit, builderNow from the final build
  const conflicts = new Map<string, Conflict>();
  for (const c of A?.conflicts ?? []) conflicts.set(c.id, c);
  for (const c of B.conflicts) { const a = conflicts.get(c.id); conflicts.set(c.id, a ? { ...c, builderWas: a.builderWas } : c); }
  // an edit the price step reported but the spec step resolved (builder now agrees) is no longer a conflict
  for (const [id, c] of conflicts) if (c.kind === 'changed') {
    const l = B.doc.lines.find(x => x.ref === c.ref);
    if (!l || !(l.edited && c.field in l.edited)) conflicts.delete(id);
    else conflicts.set(id, { ...c, builderNow: (l.edited as any)[c.field] });
  }

  const sOld = bySection(old, pOld), sA = bySection(aDoc, pA), sB = bySection(B.doc, pB);
  const sections: SectionMoney[] = SECTION_DEFS.map(d => {
    const before = sOld.get(d.key) ?? 0, mid = sA.get(d.key) ?? 0, after = sB.get(d.key) ?? 0;
    return { key: d.key, label: d.label, before, after, delta: r2(after - before), priceOnly: r2(mid - before), spec: r2(after - mid) };
  }).filter(s => s.before || s.after);
  const delta = Object.fromEntries(Object.keys(pOld.quote).map(k => [k, r2((pB.quote as any)[k] - (pOld.quote as any)[k])])) as unknown as QuoteMoney;

  const fo = new Set(pOld.flags.map(flagKey)), fb = new Set(pB.flags.map(flagKey));
  const plan: RebuildPlan = {
    priceUpdates, specChanges, conflicts: [...conflicts.values()],
    money: { before: pOld.quote, after: pB.quote, delta, priceOnlyDelta: r2(pA.quote.total - pOld.quote.total), specDelta: r2(pB.quote.total - pA.quote.total),
      bySection: sections, gmPctBefore: pOld.totals.grossMarginPct, gmPctAfter: pB.totals.grossMarginPct },
    flags: { raised: pB.flags.filter(f => !fo.has(flagKey(f))), cleared: pOld.flags.filter(f => !fb.has(flagKey(f))) },
    notes: B.notes, blockers: B.blockers,
    empty: false,
    next: B.doc,
    builderDoc: B.doc,
  };
  plan.builderDoc = resolve(B.doc, plan.conflicts, () => 'builder');
  plan.empty = !priceUpdates.length && !specChanges.length && !plan.conflicts.length && delta.total === 0 && (old.wording ?? '') === (B.doc.wording ?? '');
  return plan;
}

/** The doc without these refs in removed / removedInfo (so a build brings their lines back). */
function forget(d: QuoteDoc, refs: Set<string>): QuoteDoc {
  const out: QuoteDoc = { ...d, removed: (d.removed ?? []).filter(r => !refs.has(r)) };
  if (d.removedInfo) out.removedInfo = d.removedInfo.filter(x => !refs.has(x.ref));
  return out;
}

function resolve(doc: QuoteDoc, conflicts: Conflict[], pick: (c: Conflict) => 'mine' | 'builder'): QuoteDoc {
  let lines: QuoteLine[] = doc.lines;
  for (const c of conflicts) {
    if (pick(c) !== 'builder') continue;
    if (c.kind === 'gone') { lines = lines.filter(l => !(l.ref === c.ref && !l.auto)); continue; }
    lines = lines.map(l => {
      if (l.ref !== c.ref || !l.auto || !l.edited || !(c.field in l.edited)) return l;
      const edited = { ...l.edited }; const v = edited[c.field as EditableField]; delete edited[c.field as EditableField];
      const out: any = { ...l, [c.field]: v };
      if (Object.keys(edited).length) out.edited = edited;
      else { delete out.edited; if (out.builtDetail) { out.detail = out.builtDetail; delete out.builtDetail; } }
      return out;
    });
  }
  return { ...doc, lines };
}

/** The doc to save. Every conflict defaults to 'mine' (your edit kept); pass 'builder' to take the builder's value. */
export function applyPlan(plan: RebuildPlan, choices: Record<string, 'mine' | 'builder'> = {}): QuoteDoc {
  return resolve(plan.next, plan.conflicts, c => choices[c.id] ?? 'mine');
}
