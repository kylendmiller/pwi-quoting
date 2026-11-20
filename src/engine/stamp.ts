// Server-stamped evidence (round 3 S3). The browser writes doc.lines, so detail / basis / role / group and the
// "builder had …" values in `edited` can't be trusted as sent. On save the server rebuilds from the saved spec and
// calls stampFromBuild(): auto lines matched by ref get the server's own basis / role / group / detail and an
// `edited` map holding the server builder's values; lines it can't match are marked source 'hand' and lose basis.
import type { QuoteDoc, QuoteLine, EditableField, LineDetail } from './manual';
import { EDITABLE_FIELDS } from './manual';
import { ensureRefs } from './buildSpec';
import { deriveLine, type DeriveCtx, type LineEdit } from './deriveLine';

const same = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b;
// Fields that price-list drift can't change for the same spec: a difference here is always the rep's edit.
const NOT_DRIFT: EditableField[] = ['qty', 'description', 'category', 'kind'];
// Detail fields a rep may change through deriveLine (geometry / crew), never prices.
const GEOMETRY: (keyof LineEdit)[] = ['shape', 'lengthFt', 'tIn', 'wIn', 'lIn', 'plf', 'baseHrs', 'factor', 'hours', 'men', 'nights', 'tripDays', 'weeks', 'crewDays', 'period'];

function strip(l: QuoteLine): QuoteLine {
  const { basis: _b, edited: _e, builtDetail: _d, ...rest } = l;
  return { ...rest, source: 'hand' };
}

/** Re-derives the rep's detail edit from the BUILDER's detail with server prices; keeps it only if it reproduces the line. */
function verifyDetail(l: QuoteLine, built: LineDetail, ctx: DeriveCtx): LineDetail | null {
  const cd = l.detail as any;
  if (!cd || cd.type !== built.type) return null;
  const edit: LineEdit = {};
  for (const k of GEOMETRY) if (cd[k] !== undefined && !same(cd[k], (built as any)[k])) (edit as any)[k] = cd[k];
  if (!Object.keys(edit).length) return null;
  try {
    const d = deriveLine({ ...l, detail: built, auto: false, edited: undefined, builtDetail: undefined }, edit, ctx);
    const ok = same(d.qty, l.qty) && same(d.unitCost ?? null, l.unitCost ?? null) && same(d.unitSell ?? null, l.unitSell ?? null);
    return ok ? d.detail! : null;
  } catch { return null; }
}

export function stampFromBuild(doc0: QuoteDoc, built: QuoteDoc | null, ctx: DeriveCtx = {}): QuoteDoc {
  const doc = ensureRefs(doc0);
  const byRef = new Map<string, QuoteLine>();
  for (const b of built?.lines ?? []) if (b.ref && b.auto) byRef.set(b.ref, b);
  const lines = doc.lines.map(l => {
    const b = l.auto && l.ref ? byRef.get(l.ref) : undefined;
    if (!b) return strip(l);
    const claimed = l.edited ?? {};
    const edited: Partial<Record<EditableField, unknown>> = {};
    for (const f of EDITABLE_FIELDS) {
      const mine = (l as any)[f], theirs = (b as any)[f];
      if (!same(mine, theirs) && (f in claimed || NOT_DRIFT.includes(f))) edited[f] = theirs;
    }
    const { basis: _cb, builtDetail: _cd, edited: _ce, ...rest } = l;
    const out: QuoteLine = { ...rest, role: b.role, item: b.item, group: b.group, source: 'auto' };
    if (b.basis) out.basis = b.basis;
    if (b.detail) {
      const clientSame = JSON.stringify(l.detail) === JSON.stringify(b.detail);
      const derived = clientSame ? null : verifyDetail(l, b.detail, ctx);
      if (derived) { out.detail = derived; out.builtDetail = b.detail; } else out.detail = b.detail;
    } else delete out.detail;
    if (Object.keys(edited).length) out.edited = edited;
    return out;
  });
  const removed = Array.isArray(doc.removed) ? [...new Set(doc.removed.filter(r => typeof r === 'string'))] : undefined;
  return { ...doc, lines, ...(removed ? { removed } : {}) };
}
