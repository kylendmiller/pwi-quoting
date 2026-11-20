# Round 3, Builder B: the editing workflow after the auto-build

Angle: once the builder has made a quote, how fast and how safely can a rep tweak it?
Everything below is grounded in `app/src/Editor.tsx`, `app/src/model.ts`, `app/src/ImportSpec.tsx`,
`src/engine/buildSpec.ts`, `src/engine/manual.ts`, `src/engine/kit.ts` and `server/quote-api.ts`.

---

## 0. What the code does today, and where edits get lost

These are real behaviours of the current code, not guesses:

| # | Finding | Where |
|---|---|---|
| F1 | A rebuild keeps only lines with `auto` not set: `base.lines.filter(l => !l.auto)`. **If a rep edits an auto line (qty, cost, markup), it still has `auto: true`. The next rebuild throws the edit away without saying so.** | buildSpec.ts:68, Editor.tsx:72 `updLine` |
| F2 | **If a rep deletes an auto line, the next rebuild brings it back.** Nothing records the deletion. | buildSpec.ts:68–90 |
| F3 | Auto line keys come from the clock (`k${Date.now()}…`). The same spec built twice gives different keys, so nothing can match old lines to new ones. | kit.ts:47 |
| F4 | A rebuild overwrites `wording`, `outboundFreight`, `preUse` and `showPreUse`. Hand edits to any of them are lost. `dealerDiscount`, `taxOn`, `options` and `pvPerHourOverride` survive through `...base`. | buildSpec.ts:109–118 |
| F5 | There is no in-app way to change the spec (span, height, capacity, crew). Review mode says to "tell Claude … and open the new link". A rebuild means a round-trip through chat plus a paste into `ImportSpec`. `onApply` swaps the doc in with no preview and no diff. | Editor.tsx:123–139, 316 |
| F6 | Lines show in one flat table in build order, with no grouping, subtotals, search or weights. A crane build is 40–70 lines. | Editor.tsx:143–166 |
| F7 | Change tracking is one boolean, `dirty`. There is no undo and no list of what changed. A save writes `quote_events('saved', {total})` and nothing more. | Editor.tsx:32, quote-api.ts:101 |
| F8 | Delete is one click on `×`, with no confirm and no undo. | Editor.tsx:161 |
| F9 | **Approvals.** The Approve button is hidden while `dirty`. When a save changes a flag's numbers, the server deletes the approval silently. `revise` does not copy approvals, so R2 needs re-approval even if install did not change. | Editor.tsx:221, quote-api.ts:82–86, 130–138 |
| F10 | The Send button greys out with no reason given, other than lint banners lower in the panel. | Editor.tsx:231 |
| F11 | Options are capped at 3. The price is typed by hand, and there is no cost or margin, so an option's GM% is unknown. The SMT has the same limit (Main Summary A46:A48). | Editor.tsx:187–194 |
| F12 | The price panel is sticky. It shows Base, Install, Freight, Pre-use, Tax, Total, GM%, GM$, shop and install hours. There is no section breakdown and no "since last save" delta. | Editor.tsx:198–217, styles.css:31 |

Takeaway: the SMT never had this problem because it never rebuilt. A cell you typed stayed typed.
The app's value is the rebuild. So the editor's first job is to **make every hand change survive a rebuild, visibly**.

---

## 1. The top 15 edits: steps today vs the SMT vs this proposal

How to read the counts:
- Steps are clicks, field entries and context switches. Scrolling to find a line counts as one "find" step.
- "Today" starts on the quote page, which opens in review mode, so the edit link adds one step.
- Save counts as one step everywhere.
- **Lost?** means the edit is wiped by the next rebuild today.

| # | Edit | Today (Editor.tsx) | Lost? | SMT | Proposed |
|---|---|---|---|---|---|
| 1 | Change span / height / capacity, then rebuild | ~9, plus leaving the app: open chat, ask, copy, back, open edit, paste, Build, review blind, Save | wipes F1/F2/F4 | 1 cell for span, then 5–15 cells by hand (girder length, electrification ft, festoon…) | **4**: click the `30' span` chip, type 40, Enter, Apply on the diff, Save |
| 2 | Swap a beam size (W18x35 to W21x44) | 7: edit, find line, × delete, type shape, qty, length, "used for", +Steel, Save. Unit cost is not recalculated on the old line. | yes, and the old girder comes back next to the new one | 2: pick shape in Structural tab | **3**: find (group or `/` search), pick shape in line combobox (cost recalculates from lb/ft × length × group $/lb), Save. Line becomes pinned. |
| 3 | Add 10 shop hours | 5: edit, op dropdown (long list), type 10, +Labor, Save | no (hand line) | 1–2: Labor tab manual shop cell | **3**: click Shop labor total, type `+10`, Enter (makes a pinned "Manual shop adjustment" line), Save |
| 4 | Change paint color (columns to safety yellow) | ~9: delete standard run line, + Painting, description, unit sell (looked up by hand), find color in the 22-row wording, retype, Save | yes (line and wording) | 2–3: Painting tab and wording | **4**: item chip `colors`, pick color, Apply (diff shows the painting line and the wording sentence), Save |
| 5 | Change install crew 3 to 2 men (days, hotel, per diem, lift weeks follow) | ~10: edit qty on travel labor, hotel, per diem and equipment lines, working out each value by hand | yes | 3–4: Labor D3/I3 men, Travel qty | **4**: Install group header `3 men ▾` to 2, Apply diff (4 lines change), Save. You can also use the assumption alternate chip (`alt` already exists in kit.ts:197). |
| 6 | Change days on site / hotel nights only | ~5 per line: find hotel, qty, find per diem, qty, Save | yes | 2 | **3**: edit the `days` field in the Install header (pins crewDays, travel lines re-derive), Save |
| 7 | Add an option ("add 2nd hoist") | 4, plus pricing it off-line: + Option, description, price typed, Save | no | 3 typed cells, priced by hand | **4**: What-if, `hoistsPerBridge 2`, "Add as option" (price = computed delta, GM% known), Save |
| 8 | Dealer / GC discount | 3: edit, scroll below table, type %, Save | no | 1 (E29) | **2**: discount field in the totals rail, Save. You can also type a target total: "Hit $84,500" solves the discount. |
| 9 | Change hoist (CM Lodestar to Street) | ~8: find each vendor line, ×, search (3+ chars), click hit, repeat for trolley/pendant, edit wording, Save | yes, the old hoist returns | 2 + wording | **4**: `Swap…` on the hoist line, picker pre-filtered to the same capacity, pick, accept the wording-token update, Save |
| 10 | Delete a line | 2: ×, Save (no undo) | auto line returns | 1–2 | **2**: ×, Save. A toast offers Undo. An auto line becomes a *suppressed* ref and stays deleted on rebuild. |
| 11 | Add a custom cost line | 6: + Cost-based (lands at the bottom), description, qty, cost, markup, Save | no | 4 cells | **5**: inline `+` row at the bottom of the group, Tab through description, qty, cost (markup defaults from the category), Save |
| 12 | Change wording (one sentence) | 3 + find: scroll the 22-row textarea | yes, the whole wording is regenerated | 1 cell | **3**: click the item's wording block, edit, Save. The block is pinned and a rebuild shows a 3-way diff. |
| 13 | Raise markup on all structural steel (26 to 30%) | 2 per steel line × N lines (often 10–20) | yes | 1 (tab markup cell) | **2**: markup field on the Structural group header applies to every line in the group, Save |
| 14 | Lower install hours (needs approval) | 4: find site lines, edit qty, Save, then a flag appears in the side panel and the rep must message the manager outside the app | yes | 1, and no control at all | **4**: edit, see the inline flag at once, "Ask manager" (records a request with a note), Save |
| 15 | Override outbound freight $ | 3: edit, scroll, type, Save | yes (F4) | 1 | **2**: freight in the rail, Save. Auto-pinned, with a "builder says $X" ghost shown. |

Roll-up: the 15 edits take about **98 steps today** (row 13 counted at 10 steel lines; **11 of the 15 edits are lost** on the next rebuild),
about **39 in the SMT** (row 1 counted at 10 cells), and **49 in this proposal**, with **0 lost**. The proposal is not fewer clicks than the SMT on pure cell typing.
Where it wins, it wins big: one spec change re-derives steel, labor, travel, freight and wording, which in the SMT is 5–15 hand cells that are easy to miss.

---

## 2. Overrides that survive a rebuild

### 2.1 Three kinds of line, always visible

```
 AUTO     the builder made it; a rebuild may change it            (grey "A" badge)
 AUTO✎    the builder made it; you changed some fields (pinned)   (blue "A✎", tooltip lists the fields)
 HAND     you added it; a rebuild never touches it                (no badge)
 (gone)   an auto line you deleted; listed under "Removed by you" at the bottom of its group, with a Restore link
```

### 2.2 Data model (all optional fields, so old docs still load)

```ts
// src/engine/manual.ts
interface QuoteLine {
  ...existing;
  auto?: boolean;                 // existing
  ref?: string;                   // NEW stable builder slot, e.g. "0|structural|bridge-girder|1"
  item?: number;                  // existing in practice (buildSpec tag), now typed
  pin?: {                         // NEW only on auto lines the rep changed
    fields: (keyof QuoteLine)[];  // which fields are the rep's ('qty','unitCost','markupPct','description',…)
    base: Partial<QuoteLine>;     // what the builder had for those fields when the rep pinned them
    at: string; by: string; note?: string;
  };
}
interface QuoteDoc {
  ...existing;
  suppressed?: string[];          // NEW refs of auto lines the rep deleted
  docPins?: Partial<Record<'outboundFreight'|'preUse'|'showPreUse', { value: number|boolean; base: number|boolean }>>;
  wordingBlocks?: { ref: string; text: string; auto: boolean; pinBase?: string }[]; // one per spec item + hand blocks
  // `wording` stays as the joined text, so QuotePdf, lint and the server do not change
  scenarios?: Scenario[];         // section 6
}
```

**Stable refs (fixes F3).** `buildSpec.tag()` sets `ref = item|category|slot|n`:
- `slot` is an explicit name passed to `Kit.push(…, slot)`, such as `'bridge-girder'`, `'hotel'`, `'per-diem'`, `'lift'` or `'hoist'`.
- When no slot is passed, the default is a slug of the description stem before " — " with parentheticals stripped. So "Hotels — 3 rooms × 4 nights" becomes `hotels`.
- `n` counts duplicates.
- Same spec in, same refs out. This is unit-tested.

**Auto-pin on edit (fixes F1).** Every edit goes through one `edit()` reducer.
- If the target line is `auto`, the changed field is added to `pin.fields`.
- `pin.base[field]` takes the builder's value the first time the field is pinned.
- Clearing a pin ("↺ back to builder") restores `base` and drops the field.

**Suppress on delete (fixes F2).** Deleting an auto line pushes its `ref` to `doc.suppressed`.

### 2.3 Diff-before-rebuild algorithm (`src/engine/rebuildPlan.ts`, pure)

```
planRebuild(doc, newSpec, cat, settings) -> RebuildPlan
 1. fresh = buildFromSpec(newSpec, cat, settings, {...doc, lines: []}).doc   // builder-only output
 2. O = doc.lines where auto, by ref;  N = fresh.lines by ref
 3. for ref in O ∪ N:
      only N:  ref ∈ suppressed ? KEEP_DELETED : ADD
      only O:  O.pin ? CONFLICT('builder no longer makes this; you edited it' → keep as HAND | drop)
                     : REMOVE
      both:    for each field f in {qty, unitCost, markupPct, unitSell, description, category}:
                 if f ∈ O.pin.fields:
                    N[f] == O.pin.base[f] ? keep yours, silently
                                          : CONFLICT(f, builderWas=O.pin.base[f], builderNow=N[f], yours=O[f])
                 else if N[f] != O[f]: UPDATE f
 4. HAND lines: untouched. Heuristic warning when an ADD looks like a duplicate of a HAND line
    (same category plus the same shape/part token in the description), e.g. the rep's hand W21x44 next to a returning auto girder.
 5. Doc fields: freight/preUse use docPins the same way (pinned + builder moved → CONFLICT);
    wordingBlocks: unpinned block → replace; pinned block → keep, and if the builder text changed,
    CONFLICT with a line-level 3-way diff (pinBase vs new builder vs yours).
 6. before = priceManual(doc), after = priceManual(applyPlan(plan, defaults))
    plan.money = per-section delta (same sections as the rail), total delta, GM-pt delta
    plan.flags = flags that appear or clear (e.g. suggested install rose above your pinned install hours)
    plan.approvalsVoided = approvals whose hash(detail) would change (hash() moved to src/engine, same SHA-256 as the server)
applyPlan(plan, choices) -> QuoteDoc     // choices resolve each CONFLICT; default = keep yours
```

Every path into a rebuild goes through this:
- the spec chips (section 3)
- an assumption alternate chip
- a Claude paste (ImportSpec)
- what-if "make this the quote"

There is no way to rebuild without seeing the plan, unless the plan is empty.

### 2.4 Rebuild dialog

```
┌ Rebuild: span 30' → 40' ─────────────────────────────────────────────────────┐
│ Total  $86,420 → $93,180  (+$6,760)      GM 31.4% → 30.9%  (−0.5 pt)          │
│                                                                              │
│ Structural steel   +$3,910   ~ Bridge girder  W18x35×32' → W21x44×42'        │
│                              ~ Runway beams   qty 4 → 4, no change           │
│ Std parts          +$  610   ~ Electrification pkg  30 ft → 40 ft            │
│ Shop labor         +$1,300   ~ Bridge fab  +6.8 h                            │
│ Install            +$  940   ~ On-site erect +4.0 h   ~ Lift 1 wk (same)     │
│ Wording            changed   "Bridge Crane Span: 30'-0"" → "40'-0""          │
│                                                                              │
│ ⚠ 1 conflict      Shop labor › Handling: you pinned 12 h (builder had 9 h,   │
│                    builder now says 11 h)     (•) keep 12 h   ( ) use 11 h   │
│ ✓ Kept as you set  Paint: safety-yellow columns · Freight $2,400 (pinned)    │
│ ✓ Stays deleted    Festoon kit (you removed it 11/18)                        │
│ ⚑ New approval     Install 88 h is now below suggested 96 h → needs manager  │
│                                                                              │
│                           [ Cancel ]   [ Apply 9 changes ]                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Apply goes onto the undo stack as one step, so one Ctrl+Z reverses the whole rebuild.

---

## 3. Spec chips: change the job without leaving the editor (fixes F5)

The spec is already saved in `doc.spec`, and `describe()` already renders it. Make the parts of that sentence clickable:

```
┌ Built from ──────────────────────────────────────────────────────────────────┐
│ Item 1  FSTR · [5 ton] · [30' span] × [80' runway] · [20' overall ▾] ·       │
│         [motorized] · [radio] · [460V/3] · colors [columns: pink ▾] ·        │
│         installed [Milwaukee 92 mi] · crew [3 men ▾] · [drive ▾]             │
│ Assumed  crew 3 men (→ try 2) · travel drive (→ try fly) · paint custom (→ std) │
│ [+ item]                                     [ Paste from Claude instead ]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Each chip is an inline input or select for that field.
- Changing a chip calls `planRebuild` with `spec` patched at `items[i].field`.
- If the plan has only non-conflicting changes, they apply right away with an "Applied: +$6,760 · Undo" toast. If it has conflicts, flags or voided approvals, the dialog opens.
- The `→ try` chips come from `assumptions[].alt` / `altLabel`, which the builder already emits (kit.ts:147, 197, 200).
- ImportSpec stays for Claude pastes, but routes through the same dialog.

---

## 4. Live totals, margin and "since last save" (extends F12)

The right rail stays sticky and always shows everything below. Each section row is clickable and expands that group in the main pane, scrolled into view. The buckets are the SMT Main Summary rows.

```
┌ R2 · DRAFT · 5 unsaved changes ───┐
│ TOTAL           $93,180  ▲ 6,760  │
│ GM              30.9%    ▼ 0.5pt  │  amber below settings.gm_target (new setting)
│ GM $            $28,790           │
│───────────────────────────────────│
│ ▸ Steel & plate  12.4k lb $24,180 │
│ ▸ Parts & vendor          $19,040 │
│ ▸ Paint & decals           $3,350 │
│ ▸ Shop labor    186 h     $18,600 │
│ ▸ Install       96/96 h   $16,210 │  site labor + travel + equipment, ×1.01 as rollup.ts
│ ▸ PM · CAD · PE  38 h      $4,560 │
│   Freight (pinned)         $2,400 │  ghost: builder $2,180
│   Discount  [ 0 ]%   or hit $[    ]│
│   Tax       [exempt ▾]            │
│───────────────────────────────────│
│ ⚑ Install below suggested  [Ask]  │
│ ✖ Wording has "xx" (Item 2) [Go]  │
│ [Save ⌘S] [Preview PDF] [Send…]   │
└───────────────────────────────────┘
```

- **Since last save.** `diffDocs(savedDoc, doc)` returns `Change[]`. Each one has a plain sentence, a section and a $ delta. The header "5 unsaved changes" opens the list. Each row has a jump-to link and its own revert (↺).
- **Weights.** Lb is computed from description shape × length using `steel_shapes.lb_per_ft`, which is already loaded in `ref.shapes`. If a line can't be parsed, its weight is dropped, not guessed.
- **Main pane.** It uses the same sections, collapsed to one row each and showing totals. Click to expand. The group header carries the group markup, the `+` row, and its badges.

```
▾ Structural steel   9 lines · 12,410 lb · cost $18,060 · markup [26]% · sell $22,757
   A   Bridge girder        [W21x44 ▾] × 42'   qty 1   $1,912   26%   $2,409
   A✎  Runway beams         [W16x31 ▾] × 40'   qty 4*  ...                ↺   (* = pinned)
   H   Extra knee brace      W6x15 × 6'        qty 4   ...                ×
   + add line…
   Removed by you: Festoon kit (Restore)
▸ Shop labor          186 h · $18,600            [+ hours]
```

---

## 5. Undo / redo and the change log (fixes F7, F8)

**Client: `app/src/useHistory.ts`**
- Stack of immutable `{doc, header}` snapshots, capped at 200.
- Typing in one field coalesces within 800 ms.
- A rebuild, apply or group-markup change counts as one step.
- Ctrl/⌘+Z and Shift+Ctrl/⌘+Z, plus toolbar arrows.
- Every delete toast carries Undo.
- Drafts are autosaved to `localStorage` under `draft:{revision_id}:{doc_version}`. On load, if a newer draft exists: "You have unsaved edits from 3:41 PM — Restore / Discard". A refresh no longer loses work.

**Server: change log**
- `save` accepts `changes: Change[]` from `diffDocs`.
- It writes `quote_events('saved', {total, changes})`. The server re-runs `diffDocs` against the stored doc and does not trust the client list. `quote_events` already exists (001_core.sql:136).
- **History tab** per quote: a timeline of events (created, saved with sentences, rebuilt, approval requested/approved/voided, sent, revised, won).
- "Compare R1 ↔ R2" runs `diffDocs` on the two revisions. This answers "what did we change after the customer pushed back?"

---

## 6. What-if scenarios, options and alternates (fixes F11)

```ts
interface Scenario { id: string; label: string;
  specPatch?: Record<string, unknown>;            // e.g. {"items.0.hoistsPerBridge": 2}
  lineOps?: EditOp[];                             // same reducer ops as normal editing
  as: 'scratch' | 'option' | 'alternate';
  priced?: { total: number; base: number; installation: number; gmPct: number }; // cache, recomputed
}
```

- The **What-if** button opens a panel showing the current quote next to up to 2 scenarios, live-priced with `priceManual(applyPlan(…))`. Nothing is saved until the rep chooses an action.
- Actions:
  - **Make this the quote**: goes through the rebuild dialog.
  - **Add as option**: the price is the difference between the scenario and the base (pre-tax base + installation), rounded to $10. The description is generated ("Add (1) 2nd 5 ton hoist and trolley") and editable. The option is stored with its `scenario` id, so it **re-prices when the base changes**. If the stored price drifts from a fresh computation it shows a "stale, update $X → $Y" badge.
  - **Add as alternate**: a full alternate price block on the PDF ("Alternate 1: 40' span … $93,180").
- **The 3-option cap.** It mirrors SMT A46:A48. Keep it for the PDF, but allow more scratch scenarios.
- **Hand-typed options stay** for anything not modelled. They show "GM unknown" in the rail, so the margin gap is visible.

```
┌ What-if ───────────────┬──────────────┬──────────────┬──────────────┐
│                        │ Current      │ A: 2 hoists  │ B: 40' span  │
│ Total                  │ $86,420      │ $97,950      │ $93,180      │
│ Δ vs current           │ —            │ +$11,530     │ +$6,760      │
│ GM                     │ 31.4%        │ 30.2%        │ 30.9%        │
│ Install hrs            │ 96           │ 100          │ 100          │
│                        │              │[As option][Make quote][As alternate]│
└────────────────────────┴──────────────┴──────────────┴──────────────┘
```

---

## 7. Approvals and locks shown inline, not as surprises (fixes F9, F10)

1. **Flag at the point of the edit.** Approvals are computed live from `priceManual`, which happens today too, but they now also show on the Install group header and in the rail as soon as the edit happens:
   `⚑ 88 h is 8 h below suggested 96 h — needs a sales manager. [Ask manager]`
2. **Request is a real state.** A new server action `request_approval` inserts `approvals` with `decision='requested'` and a note. `requested_by` already exists. Managers see it in Approvals.tsx with the change sentences that caused it, taken from `diffDocs` since the last approved state. Once a flag has an approval, the Approve button no longer requires `!dirty`; it approves the saved numbers and says so.
3. **Void warning before save.** `plan.approvalsVoided` and the live diff use the shared `hash()`. The rail says "Saving voids the sales manager's approval of 96 install h" *before* Save, not after.
4. **Approvals carry forward.** In `revise`, copy approvals whose flag `detail` hash is unchanged into the new revision. R2 with the same install hours needs no new approval.
5. **Send shows its reasons.** The Send button lists every blocker in plain words with a [Go] jump: open flags, lint errors, unsaved changes. No disabled button without a reason.
6. **Locked revisions.** Inputs stay read-only. The first attempt to edit anything shows the bar `R1 was sent 11/18 and is locked. [Start R2 with this change]`. One click calls `revise`, then replays the attempted edit on R2. Today it takes the banner, a scroll to the button, a reload, and then re-finding the field.
7. **Spec edits that lower the suggestion are visible.** If a spec chip change lowers `suggestedInstallHours` (for example a smaller capacity), the change log line is tagged `affects install suggestion`. The approver sees it in the request. The server still recomputes the suggestion from the spec (`serverChecks`), so the browser is never trusted.

---

## 8. Keyboard speed (the SMT feel)

- `/` opens a command line with a deterministic parser and no AI. Examples:
  - `span 40`, `cap 7.5`, `crew 2`, `days 6`
  - `shop +10`, `install 88`
  - `disc 5`, `hit 84500`
  - `paint columns yellow`, `hoist street`
  - `find girder`
- Each command maps to a spec chip or an `edit()` op and shows its $ delta before Enter.
- Arrow keys move between cells inside an expanded group. Enter edits, Tab moves to the next field, Esc cancels.
- ⌘S saves. ⌘Z / ⇧⌘Z undo and redo. ⌘K finds.

---

## 9. Implementation plan (ordered; each step ships alone and keeps tests green)

| # | Step | Files | Test |
|---|---|---|---|
| 1 | Stable refs: `Kit.push(…, slot?)`, `buildSpec.tag()` adds `ref`, explicit slots for girder, runway, columns, hoist, trolley, paint, hotel, per diem, flights, lift, handler, delivery, travel labor | `src/engine/kit.ts`, `src/engine/buildSpec.ts`, `src/engine/refs.ts` (new) | `tests/refs.test.ts`: build each fixture spec twice and the refs are identical; refs are unique per doc |
| 2 | Types: `ref`, `pin`, `suppressed`, `docPins`, `wordingBlocks`, `scenarios`. `migrateDoc()` gives refs to old auto lines by rebuilding the stored spec and matching on (item, category, description stem). Auto lines that differ from the fresh build become pinned on those fields, so nothing already edited is lost on the first new rebuild. | `src/engine/manual.ts`, `src/engine/migrate.ts` (new) | `tests/migrate.test.ts` |
| 3 | Pure rebuild planner and applier | `src/engine/rebuildPlan.ts` (new) | `tests/rebuildPlan.test.ts`: pinned qty survives; builder change on a pinned field leads to CONFLICT; suppressed stays gone; removed pinned line leads to CONFLICT; empty plan for the same spec; money delta equals priceManual difference |
| 4 | `diffDocs` + human sentences; move `hash()` into the engine | `src/engine/diff.ts`, `src/engine/hash.ts` (new); `server/quote-api.ts` imports the shared hash | `tests/diff.test.ts` |
| 5 | Edit reducer with auto-pin/suppress, plus the history hook and local drafts | `app/src/editOps.ts`, `app/src/useHistory.ts` (new); `Editor.tsx` swaps `upd`/`updLine` for `dispatch(op)` | reducer unit tests |
| 6 | Grouped sections and line rows (badges, ↺, group markup, inline add, shape combobox, Swap picker) | `app/src/SectionGroups.tsx`, `app/src/LineRow.tsx`, `app/src/SwapPicker.tsx` (new) | manual QA script in `docs/round3/` |
| 7 | Totals rail with sections, weights, deltas, blockers and target total | `app/src/TotalsRail.tsx` (new); `gm_target` setting seed in a new `db/migrations/004_editor.sql` (not applied by this team) | snapshot test of section sums equal to `rollup.quote` |
| 8 | Spec chips, assumption alternates, Rebuild dialog; ImportSpec routed through the plan | `app/src/SpecChips.tsx`, `app/src/RebuildDialog.tsx` (new), `app/src/ImportSpec.tsx` | — |
| 9 | Server: `save` stores `changes`; `request_approval`; `revise` carries matching approvals; Send returns reasons in plain words | `server/quote-api.ts`, `app/src/Approvals.tsx`, `004_editor.sql` (`decision` allows `requested`) | `tests/edge.test.ts` additions |
| 10 | History tab and revision compare | `app/src/History.tsx` (new) | — |
| 11 | What-if scenarios, computed options with stale badge, alternates on PDF | `app/src/WhatIf.tsx` (new), `app/src/QuotePdf.tsx` | priced-option test: option = scenario minus base |
| 12 | Command line `/` and keyboard grid | `app/src/CommandBar.tsx`, `app/src/commands.ts` (new parser) | parser tests |

Order rationale:
- Steps 1–5 are the safety net. With only those shipped, today's editor stops losing work.
- Steps 6–8 are the speed the President asked for.
- Steps 9–12 polish approvals, history, what-if and keyboard use.

## 10. Risks and open questions

- **Ref drift.** If a builder rename changes a slot, a pin becomes a "builder no longer makes this" conflict. That is safe, because it is shown, not silent. Explicit slots on the important lines limit this.
- **Weights from description parsing are fragile.** Better: have `Kit.steel/plate/box` write `lb` onto the line (one field). This is recommended in step 1.
- **Option pricing basis** (pre-tax base + installation, excluding freight) needs the President's sign-off against how the SMT options were priced.
- **Group markup on mixed lines.** It applies only to lines with `unitCost` (cost + markup), not catalog `unitSell` lines. The header says so.
