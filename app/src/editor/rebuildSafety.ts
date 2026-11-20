// Rebuild safety default (round 3): when the rep's spec change moves geometry or capacity, a hand edit kept on a
// structural / plate member line was sized for the OLD geometry. For those conflicts the dialog defaults to the
// builder's value and warns; every other conflict keeps "keep yours".
import type { QuoteDoc } from '../../../src/engine/manual';
import type { Conflict } from '../../../src/engine/buildSpec';

const MEMBER_ROLES = new Set(['girder', 'runway', 'column', 'brace']);
const MEMBER_CATS = new Set(['structural', 'plate']);
/** Spec item fields that size members: span, runway, height, capacity, columns, bays (and mezzanine plan size). */
const GEOMETRY_FIELD = /span|runway|height|capacity|column|bay|^lengthFt$|^widthFt$/i;

const items = (spec: unknown): Record<string, unknown>[] => (Array.isArray((spec as any)?.items) ? (spec as any).items : []);
const same = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : JSON.stringify(a) === JSON.stringify(b));

/** Geometry / capacity fields that differ between the old and new spec (any item, matched by id then by index). */
export function geometryChanges(oldSpec: unknown, newSpec: unknown): string[] {
  const A = items(oldSpec), B = items(newSpec), out = new Set<string>();
  B.forEach((b, i) => {
    const a = (b?.id != null ? A.find(x => x?.id === b.id) : undefined) ?? A[i];
    if (!a) return;                                     // a new item adds its own lines, no kept edits to conflict with
    for (const k of new Set([...Object.keys(a), ...Object.keys(b ?? {})]))
      if (GEOMETRY_FIELD.test(k) && !same(a[k], (b as any)?.[k])) out.add(k);
  });
  return [...out];
}

export function isMemberLine(doc: QuoteDoc, ref: string): boolean {
  const l = doc.lines.find(x => x.ref === ref);
  if (!l) return false;
  return MEMBER_ROLES.has(String(l.role ?? '')) || MEMBER_CATS.has(String(l.category ?? ''));
}

/** Conflict ids that should default to "take builder's": changed member lines under a geometry/capacity spec change. */
export function builderDefaultIds(conflicts: Conflict[], doc: QuoteDoc, oldSpec: unknown, newSpec: unknown): Set<string> {
  if (!geometryChanges(oldSpec, newSpec).length) return new Set();
  return new Set(conflicts.filter(c => c.kind === 'changed' && isMemberLine(doc, c.ref)).map(c => c.id));
}

/** Member lines (any conflict kind) the warning should name. */
export function staleMemberRefs(conflicts: Conflict[], doc: QuoteDoc, oldSpec: unknown, newSpec: unknown): Set<string> {
  if (!geometryChanges(oldSpec, newSpec).length) return new Set();
  return new Set(conflicts.filter(c => isMemberLine(doc, c.ref)).map(c => c.ref));
}
