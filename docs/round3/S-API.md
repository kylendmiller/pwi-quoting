# Round 3 Track S: engine and server API for the editor (UI agent: code against this)

Branch `round3-s`. Everything here is pure TypeScript in `src/engine/**` (no React, no network) unless it says "server".
All new fields are optional, so old saved docs load unchanged. Prices for an unedited auto-built quote do not change.

## TypeScript signatures

```ts
// ───────── src/engine/manual.ts ─────────
export type EditableField = 'qty' | 'unitCost' | 'markupPct' | 'unitSell' | 'description' | 'category' | 'kind';
export const EDITABLE_FIELDS: EditableField[];

interface QuoteLine {               // existing fields kept; new optional fields:
  ref?: string;                     // stable builder slot `${itemId}:${slot}` (S4), e.g. "freestanding-0-k3x9:girder/bridge-girder"
  source?: 'auto' | 'hand';         // server-stamped (S3). 'hand' lines keep client detail.
  edited?: Partial<Record<EditableField, unknown>>;  // auto lines only: field -> BUILDER value (server re-stamps it)
  gmPct?: number;                   // std parts: catalog GM; cost = sell × (1 − gmPct) (S7)
  gmAssumed?: boolean;              // gmPct came from settings.std_parts_default_gm_pct (catalog had none)
}
interface QuoteDoc {                // new optional fields:
  removed?: string[];               // refs of auto lines the rep deleted (stay deleted on rebuild, S5)
  steelCostDate?: string;           // steel_cost.effective the auto lines were built at
}
interface Settings {                // new optional settings (defaults in brackets)
  min_gm_pct?: number;              // [0.25] MIN_GM flag floor
  max_discount_pct?: number;        // [0.10] BIG_DISCOUNT flag above this
  std_parts_default_gm_pct?: number;// [0.30] used when std_parts.gm_pct is null
}

export type FlagRule = 'INSTALL_BELOW_SUGGESTED' | 'INSTALL_MANUAL_NO_SUGGESTION' | 'PV_BELOW_FLOOR' | 'CLASS_D'
  | 'FAMILY_PV_DROP' | 'MIN_GM' | 'ZERO_MARKUP' | 'BIG_DISCOUNT';
export type Flag = { rule: FlagRule; detail: Record<string, unknown>; lineKeys?: string[]; section?: SectionKey };
export interface FlagDef {
  id: 'install_below_suggested' | 'install_manual_no_suggestion' | 'pv_below_floor' | 'class_d'
    | 'family_pv_drop' | 'min_gm' | 'zero_markup' | 'big_discount';
  rule: FlagRule;                   // the value stored in approvals.rule / Flag.rule
  label: string;                    // short UI label
  section?: SectionKey;             // where to show it inline (install, costBased, …); undefined = whole quote
  explain(detail: Record<string, unknown>): string;   // one plain sentence for the inline badge
}
export const flags: FlagDef[];      // the policy rule list (needs a manager to approve)
export const flagDef: (rule: FlagRule) => FlagDef | undefined;

interface Priced {                  // existing fields kept; new:
  quote: QuoteMoney;                // S9: THE customer numbers. Each part rounded to cents once; total = sum of parts.
  costBasis: { shopLaborPerHr: number; siteLaborPerHr: number; shopAssumed: boolean; siteAssumed: boolean;
               stdPartsGmLines: number; stdPartsGmAssumed: number };   // label "assumed labor cost" when *Assumed
}
// priced.lines[] no longer carries detail / basis / edited (S6): read those from doc.lines by key (sectionize does).
export interface QuoteMoney { base: number; installation: number; freight: number; preUse: number; tax: number; total: number }

export function priceManual(doc: QuoteDoc, s: Settings): Priced;            // unchanged signature
export function validateDoc(doc: QuoteDoc): string[];   // [] = ok. Non-finite / negative qty, non-finite cost/sell/markup,
                                                        // markup < −100, unknown kind/category. Server rejects save (400) if not [].
export function deriveFamily(doc: QuoteDoc): string;    // spec.items[0] builder fam when a spec exists, else doc.family (S2)
export function pvHours(doc: QuoteDoc): number;         // freestanding PV shop hours the server will use (S2)

// ───────── src/engine/parseNum.ts ─────────   (S8/U5; no eval, no Function)
export function parseNum(text: string, opts?: { allowNegative?: boolean }): number | null;
//  "12", "=2*(3+4)", "1,250.5", "20'6\"" → 20.5 (feet), "6\"" → 0.5, "20' 6 1/2\"", "1/2" → 0.5, "-3" (needs allowNegative).
//  Returns null for anything else: letters, "1e400", "2*", division by 0, > 64 chars, non-finite.
export function parseNumResult(text: string, opts?): { ok: true; value: number } | { ok: false; error: string };
export function parseFtIn(text: string): number | null;  // just the ft-in grammar

// ───────── src/engine/deriveLine.ts ─────────   (S8)
export interface LineEdit {         // any subset; fields that don't apply to the line's detail type are ignored
  qty?: number; description?: string; markupPct?: number; unitCost?: number; unitSell?: number;
  shape?: string; lengthFt?: number;                       // steel
  tIn?: number; wIn?: number; lIn?: number;                // plate
  plf?: number;                                            // box / built-up
  costPerLb?: number;                                      // steel / plate / box
  sellEach?: number;                                       // std / sell
  costEach?: number;                                       // cost
  list?: number; pwiDiscPct?: number; customerDiscPct?: number;   // vendor
  baseHrs?: number; factor?: number; hours?: number;       // labor (hours sets qty directly), pmcad (hours)
  men?: number; nights?: number; tripDays?: number; rate?: number; // travel
  weeks?: number; crewDays?: number; period?: 'day' | 'week' | 'month';   // equipment
  runs?: number; runRate?: number;                         // paint
}
export interface DeriveCtx {        // optional lookups (pass the loaded catalog); needed only for a shape change
  shape?(name: string): { lbPerFt: number; pricePerLb: number; group?: string } | null;
  steelCost?: { perLb: Record<string, number> } | null;
}
export function deriveLine(line: QuoteLine, edit?: LineEdit, ctx?: DeriveCtx): QuoteLine;
//  Pure. Updates detail, then recomputes qty / unitCost / markupPct / unitSell / description from it.
//  deriveLine(line) with no edit returns the same priced fields (idempotent on every auto line).
//  On an auto line every priced field that changes is recorded in line.edited (field -> builder value, first time only).
//  Shape not found in ctx → throws Error('Unknown shape W99x1').
export function editLine(line: QuoteLine, patch: Partial<Pick<QuoteLine, EditableField>>): QuoteLine; // plain field edit + edited marks
export function revertField(line: QuoteLine, field: EditableField): QuoteLine;  // back to builder value, drops the mark
export function lineLb(line: QuoteLine): number | undefined;                    // lbEach × qty for steel/plate/box

// ───────── src/engine/buildSpec.ts ─────────   (S4, S5)
export function assignItemIds(spec: QuoteSpec): QuoteSpec;  // gives every item a permanent `id` (kept if present)
export function slotOf(line: QuoteLine, n?: number): string; // "role/stem" (+ "#n" for the nth duplicate)
export function ensureRefs(doc: QuoteDoc): QuoteDoc;         // legacy docs: give auto lines refs from spec ids + slotOf
export interface Conflict {
  id: string;                       // `${ref}|${field}`
  ref: string; description: string; section: SectionKey;
  kind: 'changed' | 'gone';         // changed = builder moved under your edit; gone = builder no longer makes this line
  field: EditableField | '*';
  builderWas: unknown; builderNow: unknown; yours: unknown;
}
export interface BuiltDoc { doc: QuoteDoc; notes: string[]; blockers: string[]; assumptions: …; conflicts: Conflict[] }
export function buildFromSpec(spec, cat, settings, base: QuoteDoc): BuiltDoc;
//  Keeps hand lines; keeps refs in base.removed removed; re-applies base auto lines' `edited` fields onto the
//  same ref (yours wins, edited[f] re-stamped to the NEW builder value); conflicts listed. 'gone' edited lines are
//  kept as hand lines (source 'hand', auto false). Unedited docs: identical output to before (refs added only).

// ───────── src/engine/rebuildPlan.ts ─────────   (S5)
export interface LineChange {
  ref: string; section: SectionKey; description: string;
  change: 'add' | 'update' | 'remove' | 'kept_deleted';
  fields?: { field: EditableField; from: unknown; to: unknown }[];
  sellBefore: number; sellAfter: number;
}
export interface SectionMoney { key: SectionKey; label: string; before: number; after: number; delta: number; priceOnly: number; spec: number }
export interface RebuildPlan {
  priceUpdates: LineChange[];       // same spec, today's price lists / settings (steel_cost etc.)
  specChanges: LineChange[];        // what the spec change itself does (after price updates)
  conflicts: Conflict[];
  money: { before: QuoteMoney; after: QuoteMoney; delta: QuoteMoney; priceOnlyDelta: number; specDelta: number;
           bySection: SectionMoney[]; gmPctBefore: number; gmPctAfter: number };
  flags: { raised: Flag[]; cleared: Flag[] };
  notes: string[]; blockers: string[];
  empty: boolean;                   // no line, money or wording change
  next: QuoteDoc;                   // the doc if applied with every conflict = 'mine'
  builderDoc: QuoteDoc;             // the doc if applied with every conflict = 'builder'
}
export function planRebuild(old: QuoteDoc, newSpec: QuoteSpec, cat: Catalog, settings: Settings & Record<string, unknown>): RebuildPlan;
//  newSpec items with no id inherit the old item's id at the same index when the type matches (Claude paste).
export function applyPlan(plan: RebuildPlan, choices?: Record<string /*Conflict.id*/, 'mine' | 'builder'>): QuoteDoc;

// ───────── src/engine/sections.ts ─────────   (existing; S6 changes)
export function sectionize(doc: QuoteDoc, priced: Priced, opts?: { includeEmpty?: boolean }): SectionTree;
//  detail/basis now come from doc.lines (by key). SectionLine gains: ref?, source?, editedFields?: EditableField[].
//  MemberRow gains: edited?: true (description no longer matches detail → size shows the description).
//  review includes every edited field (markup, category, kind, description, qty, cost, sell) and unknown categories.
//  reconcile gains: dealerDiscountAmount (≤ 0, includes the dropped 1%), and diff is computed from section lines,
//  not from the rollup's base, so it is no longer circular.
export function sectionOf(c: CategoryKey): SectionKey;  // unknown category → 'costBased'

// ───────── src/engine/changeOrder.ts ─────────   (S10)
export interface DeltaLine { ref: string; description: string; category: CategoryKey; kind: LineKind;
  change: 'add' | 'remove' | 'change'; qtyBefore: number; qtyAfter: number; sellBefore: number; sellAfter: number; delta: number }
export function deltaDoc(confirmed: QuoteDoc, current: QuoteDoc, s: Settings):
  { doc: QuoteDoc; lines: DeltaLine[]; before: QuoteMoney; after: QuoteMoney; delta: QuoteMoney };
//  doc = a printable QuoteDoc whose lines are the deltas (credits are negative unitSell material lines; labor as hour deltas).
//  priceManual(doc).quote.total === delta.total (to the cent).
```

## Server (`server/quote-api.ts`) contract changes

- `save`: rejects 400 `{ error, problems: string[] }` when `validateDoc` fails. The server derives `family` and `freestandingShopHours` itself (client values ignored), rebuilds from the saved spec, stamps `detail` / `basis` / `role` / `group` / `source` / `edited` builder values on auto lines by `ref`, marks unmatched lines `source: 'hand'`. Returns `{ revision, priced }`; **use `revision.doc` (stamped) and `priced.quote` from the response**. Approvals are deleted only after a successful versioned update.
- `approve`: body now needs `doc_version`; 409 if the stored revision moved on.
- `send`: response includes `priced` (server-priced): render the PDF from it.
- `revise`: body `{ quote_id, from_revision_id?, doc_type? }`. A won quote stays `won`. CHANGE ORDER revisions get `priced.changeOrder` (the `deltaDoc` result vs the last CONFIRMATION revision) on save.
- New approval rules need `db/migrations/004_round3_flags.sql` (written, NOT applied).

## Notes for the UI

- Show `priced.quote.total` everywhere (rail, PDF). Never sum rounded rows.
- Numeric cells: `parseNum` only. Store the number, never the text.
- Steel/plate cell edits: `deriveLine(line, { shape | lengthFt | qty | tIn … }, catalog)`.
- Spec chips / ImportSpec: `planRebuild(doc, newSpec, catalog, settings)` → dialog → `applyPlan(plan, choices)`.
- Deleting an auto line: push its `ref` to `doc.removed` (restore = remove it from the list).
- Inline approvals: `priced.flags[i].section` / `.lineKeys` + `flagDef(rule).explain(detail)`.
