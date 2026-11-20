# Round 3, Proposal A: the editor as the Sales Main Template, with every row showing its numbers

Angle: structure and data visibility. The editor should read like the SMT the President knows by heart.
Main Summary is the spine, and each row opens into its tab. The engineering basis sits next to the steel.

## 1. What we have today and what's missing

The current `Editor.tsx` is one flat table: Category · Description · Qty · Unit cost · Markup · Unit sell · Sell.
Every product detail is packed into the `description` string. The engine knows more than the line keeps.

| Data | Engine knows it in | Kept on the `QuoteLine` today? |
|---|---|---|
| Steel shape, length, lb/ft, $/lb, price group | `Kit.steel()` (kit.ts) | **No.** Only `"Runways — W12 x 26 × 25'"` plus a rolled-up `unitCost` |
| Plate t × w × l, lb each, drop factor | `Kit.plate()` | **No.** Only the description and `unitCost` |
| Box member plf × ft × 1.03 | `Kit.box()` | **No** |
| Tons per line / per category | can be computed | **No.** The rollup only gets dollars |
| Labor op, units, hrs/unit, base hours, production/install factor | `Kit.shop()` / `Kit.finish()` | **No.** `qty` is already base × factor, and `laborOp` is always `shop_other`/`site_other` |
| Vendor list, PWI disc %, customer disc % | `Kit.vend()` | **No.** It gets folded into `unitCost` + a back-solved `markupPct` |
| Std-part built shop hours | `cat.stdHours()` | **No.** It's summed into `Kit.builtHrs` and then lost |
| Paint piece-units, runs, color | `Kit.paint()` | Partly (runs in `qty`); the piece-units are lost |
| Equipment period (day/wk/mo) and rate | `Kit.travel()` | Only in the description text |
| Girder/runway/column picks + why | `A.push({field:'girder'…})` | Yes as free-text `assumptions`, but **not linked to the steel lines** |
| Geometry (overall, hook, colLen, bays, pieceFt…) | `BuildResult.geometry` from every builder | **No.** `buildSpec.ts` drops it (it never copies `r.geometry`) |
| Item a line belongs to | `buildSpec` tags `item: i` | Untyped (`(l as any).item`) |
| Which values a rep changed | — | **No.** `auto: true` only. A rebuild deletes every auto line, **hand edits included** |

The editor can't show "what beams were used" because the line doesn't carry the beam. The fix starts in the data model (§6). Then the UI is mostly layout.

## 2. Page layout

There are three tabs across the top. Numbers is the default. Wording and Options move out of the long scroll.

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 29140 · Acme Mfg · Paint line cranes       R2 QUOTE ▾   draft      [Numbers] [Wording] [Review]   Save ⌘S │
│ Items: (All) [1 FSTRGM5 30'×80'] [2 Mezz 20'×40'] [Job: travel]           □ show empty rows  □ hide cost │
├──────────────────────────────────────────────────────────────────────────────────────┬────────────────────┤
│ MAIN SUMMARY                     Tons/Hrs      Cost        Sell      GM $   GM %  ⚑  │ PRICE (unchanged)  │
│ ▸ Standard Parts & Products        14.5 h    9,812.00   9,812.00     —      —     2✎ │ Base     212,410   │
│ ▸ Hoist & Crane Vendor Items          —     18,440.50  34,120.00  15,679   46%       │ Install   41,870   │
│     Starke SMW0522-30-460 ×1 · STT-170-100-98 ×2 · SCP-0346 ×1                      │ Freight    6,240   │
│ ▸ Cost Based Special Items            —        —        4,850.00 (PV)               │ Tax            0   │
│ ▾ Structural                       11.82 t  31,915.20  40,213.15   8,298  21%  ⚠1   │ TOTAL    260,520   │
│     W14x48 cols ×10 @18' · W18x50 rwy ×8 @20' · W21x62 girder ×1 @32'                │ ─ internal ─       │
│   (detail grid, §3.1)                                                                │ GM 31.4%  $81,7xx  │
│ ▸ Plate                             1.06 t   2,862.00   3,577.50     715  20%        │ Shop h 412.6       │
│ ▸ Painting Charges                 6 runs       —      11,902.50                     │ Install h 286.0    │
│ ▸ PM & Marketing                     38 h       —       3,610.00                     │ Tons 12.88         │
│ ▸ AutoCad Design                     22 h       —       2,090.00                     │ PV 4,850           │
│ ▸ Engineering (P.E.)                  —                                              │ ─ flags ─          │
│ ▸ PWI Capacity Decals               2 sets      —         310.00                     │ ⚑ Install < sugg.  │
│ ▸ Travel Cost Charges           [install]    5,120.00   5,632.00     512   9%        │ ✖ Rwy past chart   │
│ ▸ On-Site Equipment Rentals     [install]    6,980.00   8,027.00   1,047  13%        │ [Send] [PDF]       │
│ ▸ Total Shop Fab Labor            412.6 h  24,343.00  41,260.00  16,917  41%   3✎    │                    │
│ ▸ Total On-site Labor  [install]  250.0 h  14,972.50  28,250.00  13,277  47%         │                    │
│ ───────────────────────────────────────────────────────────────────────────────────  │                    │
│   Total Project Tons / Price       12.88 t                       hidden 1%: 1,688.40 │                    │
│   Base Price 212,410 · Installation (×1.01) 41,870 · Outbound freight 6,240 [edit]   │                    │
│   Pre-use 0 [□ show] · Sales tax [exempt ▾] · Dealer/GC disc [ 0 %] → Dealer base —  │                    │
│   Total Project Price 260,520                                                        │                    │
└──────────────────────────────────────────────────────────────────────────────────────┴────────────────────┘
```

Rules:
- **Row order and labels are the SMT Main Summary rows D4–D26 exactly**, using `ROW` in rollup.ts. They appear in the order he already reads them. `[install]` marks rows 23, 24 and 26, which go to Installation rather than Base.
- **Collapsed rows show a one-line "peek"** under the label. That way "what beams were used" needs zero clicks:
  - Structural and Plate: shape (or t×w) × qty @ length, grouped by role.
  - Vendor: part numbers.
  - Labor: the top 3 ops by hours.
  - Paint: runs and colors.
  - Travel: men × nights.
  - Equipment: items and period.

  Each peek is capped at one line, with "+n more" if it runs over.
- **Rows with zero lines are hidden.** "show empty rows" restores the full SMT list so a rep can add into Concrete, VRC and so on.
- Badges on each row:
  - `n✎`: count of rep-edited cells in that section.
  - `⚠n`: build notes or warnings tied to lines in the section.
  - `✖`: a blocker in the section.
- **Item chips** filter every section and total to one spec item. The `Job` chip covers shared travel (`item = -1`). With one item, the chips and the Item column are hidden.
- "hide cost" (today's `hideInternal`) drops the Cost, GM $ and GM % columns everywhere. It's for screen-sharing.

### Collapsed vs expanded by default
| Situation | Default |
|---|---|
| Opening a quote | All sections collapsed. The peek lines are visible. |
| A section contains a blocker (✖) | Expanded, with the blocking line highlighted |
| Just ran Rebuild / Import spec | Structural expanded (engineering basis open). Everything else collapsed. |
| Locked (sent) revision | All collapsed, read-only. "Expand all" still works. |
| Rep toggles a section | Remembered per user in `localStorage['pwi.editor.open']` (array of CategoryKey) |

## 3. Section detail grids (columns are SMT tab columns)

Every grid has the same right-hand trio: **Cost · Sell · GM %**. They're hidden when "hide cost" is on.
**Bold columns are editable.** The rest are computed.
A cell the rep changed on an auto line gets an amber left edge. Hovering shows `Auto: 25' → You: 28'  [Revert]`.

### 3.1 Structural (SMT Structural tab: Used for · QTY · Material · Length ft · #/ft · $/lb · Tons · Cost · Total Price)

```
▾ Structural                                   markup [26]% (tab default)    [Revert section]
  ┌ ENGINEERING BASIS · Item 1 FSTRGM5 ───────────────────────────────────────────────────────┐
  │ Span 30' · Runway OAL 80' · Overall 20'-0" · Hook 16'-6" · Col len 18' · 4 bays @ 20.0'    │
  │ Runway pieces 4/line @ 20' · Lift 20' · Rail no · Foundation slab · Steel $ 2026-11-16     │
  │ Member   Pick       Source            Basis row               Check            Why        │
  │ Columns  W14 x 48   AQT chart         20' OAH × 5 t           chart (unchecked) ⓘ          │
  │ Runway   W18 x 50   AQT chart         bay ≤20' × 5 t          chart (unchecked) ⓘ          │
  │ Girder   W21 x 62   PWI bridge chart  5 t × span ≤32'         CONFIRMED         ⓘ          │
  │ Bracing  ST3x3x¼    rule              tube cols, ≥3 t         —                 ⓘ          │
  └────────────────────────────────────────────────────────────────────────────────────────────┘
  Used for            Qty  Shape      Len ft  lb/ft   $/lb   Tons   Cost       Mk%  Sell       GM%
  Columns       [1]   10   W14 x 48   18      48.0   0.62   4.32   5,356.80   26   6,749.57   21
  Runways       [1]    8   W18 x 50   20      50.0   0.64   4.00   5,120.00   26   6,451.20   21
  Bridge girder [1]    1   W21 x 62   32✎     62.0   0.66   0.99   1,309.44   26   1,649.89   21
  Bracing       [1]    6   ST 3x3x¼   20      ...
  + add: [shape…] qty [ ] len [ ] used for [ ]                                    Σ 11.82 t  40,213.15
```
- Clicking a member in the basis box highlights its lines (`basisRole` match), and the reverse works too.
- **Check column**:
  - It shows `ratio` when the engine computed one (for example, sized girder: Ireq/I = 0.91 → `0.91 L/600`).
  - Above 0.98 shows ✖ (the PWI max unity rule).
  - `chart (unchecked)` means it was picked from a chart with no calc. It's shown neutral, not hidden.
  - `placeholder` (past the chart) shows red, alongside the existing blocker.
- Changing **Shape**:
  - It looks up lb/ft and $/lb (steel_cost group, or catalog).
  - If the line has a `basisRole`, the basis row updates to `Source: rep override` and shows the old pick struck through. Engineering can see the rep swapped the beam.
- **$/lb** is editable as a per-line price override (e.g. "SDI quote 0.58"). An override shows the source tooltip `rep override (was steel_cost 0.62)`.

### 3.2 Plate (SMT Plate tab: QTY · Thickness · Width · Length in · $/lb · lb/PC · Tons · Cost · Total)
Columns: Used for · **Qty** · **Thk in** · **W in** · **L in** · Drop (1.10 or 1.03, read-only) · lb/pc · Tons · **$/lb** · Cost · **Mk%** · Sell · GM%.
Box / built-up rows (`Kit.box`) are a sub-group "Built-up members" with these columns: Used for · **Qty** · **plf** · **Len ft** · ×1.03 · lb/pc · Tons · $/lb · Cost · Mk% · Sell.
The basis box links built-up columns and box girders exactly as in 3.1.

### 3.3 Standard Parts & Products (SMT: Description · QTY · Vendor · Part # · Price updated · Sell · Total · Hours)
Columns: Section (Hardware / Electrification / End trucks… from `std_parts.section`) · Description · Part # · **Qty** · **Sell ea** · Total · Built hrs ea · Built hrs.
Built hours are shown so the "PWI Built Items" labor row (SMT Labor row 49) is visible. They're scheduling-only, not priced (kit.ts note 11/20).
The add row is a type-ahead over `std_parts` (description or part #).

### 3.4 Hoist & Crane Vendor Items (SMT: Part # · Description · QTY · List each · PWI disc % · Cost each · Ext cost · Cust disc % · Sell)
Columns: Vendor · **Part #** · Description · **Qty** · List ea · **PWI disc %** · Cost ea · Ext cost · **Cust disc %** · Sell · GM%.
Discounts default from `vendor_discounts`. Editing one is a per-line override. Markup is never shown here, because the SMT never used it.
The add row is the existing vendor search, moved inline.

### 3.5 Cost Based Special Items (SMT: Description · QTY · Cost each · Total cost · Markup % · Sell)
Columns: Description · **Qty** · **Cost ea** · Total cost · **Mk%** · Sell · GM%.
The Freestanding **Production Value** shows as a pinned, read-only row: `PV: 412.6 shop h × $[11.76] = 4,850 (100% margin)`. The rate cell is the existing `pvPerHourOverride`. Lowering it raises the PV_BELOW_FLOOR flag inline.

### 3.6 Painting (SMT Painting: Description · QTY · Sell · Total)
Columns: Run type · Color · Piece-units · Runs (**editable**) · **$/run** · Total.
The header line reads `Piece-units 84 (16 per run) → 6 runs`. Changing the runs is an override against that auto count.

### 3.7 Labor: Shop and On-site (SMT Labor tab, "Shop Labor" and "On Site Labor" blocks)
```
▾ Total Shop Fab Labor     rate $100/h · production factor 1.08 (freestanding)        412.6 h  41,260
  Operation                       Units  Unit       h/unit   Base h   ×Factor   Hours    $        
  Cut list                          1    system      4.0      4.0     1.08      4.3      430   
  Column fab (tube)                10    column      3.0     30.0     1.08     32.4    3,240   
  PCR runways (8)                   8    beam        2.5     20.0     1.08     21.6    2,160   
  Bridge fab + after-paint (single) 1    bridge     48.0     48.0     1.08     60.0✎   6,000  ← override: hours
  Handling / shipping               —    % of mat    —       38.0     1.08     41.0    4,100   
  PWI built std parts (sched only)  —     —          —       14.5      —      (14.5)     —    
  + add: [labor op…] units [ ]                                   SMT shop hours (scheduling) 412.6
▾ Total On-site Labor      rate $113/h · install factor 1.00 · crew 3 men · 7 days       250.0 h  28,250
  Unload, set up, layout ... | Install columns (10) ... | Travel (drive, 3 men, 240 mi) 18 h ...
  Suggested install 286.0 h → quoted 250.0 h  ⚑ below suggested (needs approval)
```
- Edit **Units** or **h/unit** and Hours recomputes as `units × h/unit × factor`.
- Or type straight into **Hours**. That's an override, shown amber, and Base h is left as it was.
- `site_difficulty` keeps its required Reason cell, now a column that only shows on that op.
- Crew, days and weeks are shown in the header like SMT Labor D3/D4/D5 and I3/I4/I5. They're read-only. Crew size can be changed in Travel (§3.8).

### 3.8 Travel, Equipment (SMT Travel_Costs, Equipment)
- **Travel** columns: Item (rate item) · Basis (`3 men × 6 nights`) · **Qty** · **Cost ea** · Last updated · **Mk%** · Sell.
  - The header shows mode (drive / fly / local), crew men and crew days. Each one is a dropdown that re-runs `Kit.travel` for this job only. These are the existing assumptions (`crewMen`, `travelMode`, `crewDays`) made editable in place.
- **Equipment** columns: Item · Why (`work top 18.5'`, `heaviest pick 3,900 lb`) · **Qty** · **Period** (day / wk / mo) · **# periods** · Rate/period · Cost · **Mk%** · Sell. This matches SMT Daily / Weekly / Monthly → PWI cost → Total charge.

### 3.9 PM & Marketing · AutoCad · Engineering (Main Summary F14–H17 block)
Columns: Item · **Hours** · Rate · Total.
The header shows how the auto value was derived: `PM+CAD = k·($mat+shop k)^exp = $5,700 → PM 38 h / CAD 22 h (min 8/6)`. That way an override is an informed one.

### 3.10 Rollup block (Main Summary rows 27–36 + Options)
It's always visible under the last row, as in the layout above.
- The 1% adder shows its dollars and the "Turn off 1%" setting (read-only for reps; admin setting).
- Installation shows "×1.01".
- The Dealer/GC column (E31/E35) shows only when the discount is above 0.
- Freight shows its basis (`2 × FB, 12.9 t, 240 mi @ $3.10/mi +15%`). Editing it is an override, and Revert restores `Kit.freight`.
- Options (B46…) stay on the Wording tab, as today.

## 4. How edits work (one model for every section)

| Action | Behavior |
|---|---|
| Edit a cell | Commits on Enter, Tab or blur. Number cells accept `=` arithmetic (`=2*40+6`), as in Excel. The engine re-prices live (`priceManual` in `useMemo`, as today). |
| Edit an auto line | Writes the value. Adds the field name to `line.overrides` and keeps the builder's value in `line.autoValues`. The cell turns amber. |
| Revert | Per cell: hover → Revert, or `Ctrl+Backspace`. Per line: row menu → "Revert line". Per section: header button. Each one restores from `autoValues` and drops the field from `overrides`. |
| Add line | Every section's last row is an add row with type-ahead (shape, plate t×w×l, std part, vendor part, labor op, rate item). Enter adds the line and leaves the cursor in a fresh add row. Hand lines have `auto` absent, and no amber, because they're all the rep's. |
| Delete | `Del` on a selected row, or ×. Deleting an **auto** line records its `slot` in `doc.suppressedSlots`. The section header then shows "1 auto line removed · restore", so a Rebuild doesn't resurrect it silently. |
| Rebuild / re-import spec | Builder output is matched to existing lines by `slot`. For matched lines, overrides are re-applied on top of the new auto values. If the new auto value differs from the old `autoValues`, a ⚠ shows: `auto changed 25'→28' since your override`. Suppressed slots stay out. Hand lines are kept (as today). Unmatched overridden lines become hand lines with a note. This **fixes the current data loss** where rebuild drops every edited auto line. |
| Move line to another category | Row menu → "Move to…" (replaces today's per-row category dropdown, which took a column for something done rarely). |
| Undo | `Ctrl+Z` / `Ctrl+Shift+Z`. This is a doc history stack of the last 50 `upd()` patches. |

## 5. Keyboard flow (spreadsheet muscle memory)
| Keys | Does |
|---|---|
| `↑ ↓` on summary | Move between Main Summary rows |
| `→` or `Enter` / `←` | Expand / collapse that row |
| `Shift+E` / `Shift+C` | Expand all / collapse all |
| In a grid: arrows, `Tab`/`Shift+Tab` | Cell to cell; Tab skips read-only cells |
| `Enter` / `F2` | Edit the cell (F2 = keep text, as in Excel); typing a digit starts replacing |
| `Esc` | Cancel the edit, then leave the grid back to the summary row |
| `Ctrl+Enter` | Jump to the section's add row |
| `Ctrl+Backspace` | Revert the cell to auto |
| `Del` | Delete the selected line (with undo) |
| `/` | Jump-to box: type "girder", "W18", "handling" or a part # to land on the matching line and open its section |
| `Ctrl+S` | Save. `Alt+1/2/3` switches the Numbers / Wording / Review tab |

## 6. Required data-model and engine changes

### 6.1 `QuoteLine` (src/engine/manual.ts): additive, all optional (old docs still load)
```ts
slot?: string;              // stable builder id: `${item}.${role}[.${n}]`, e.g. "0.runway", "0.shop.pcrRunway", "-1.travel.hotel"
item?: number;              // spec item index (-1 = job-level shared travel). Already set by buildSpec; type it.
basisRole?: string;         // 'columns'|'runway'|'girder'|'bracing'|'headers'|'crossmembers'|'legs'|… links to MemberPick.role
detail?: LineDetail;        // the SMT tab columns, below
autoValues?: Partial<QuoteLine & { detail: LineDetail }>;  // builder's values for fields the rep overrode
overrides?: string[];       // overridden field paths: 'qty', 'detail.lengthFt', 'detail.hours', 'markupPct'…
auto?: boolean;             // unchanged meaning
type LineDetail =
 | { tab: 'structural'; shape: string; lengthFt: number; lbPerFt: number; pricePerLb: number; priceGroup?: string; priceSource: string }
 | { tab: 'plate'; thkIn: number; widthIn: number; lengthIn: number; dropFactor: number; pricePerLb: number }
 | { tab: 'box'; plf: number; lengthFt: number; dropFactor: number; pricePerLb: number }
 | { tab: 'std'; part?: string; section?: string; sellEach: number; builtHrsEach: number }
 | { tab: 'vendor'; vendor: string; part: string; listEach: number; pwiDiscPct: number; custDiscPct: number }
 | { tab: 'paint'; pieceUnits: number; piecesPerRun: number; runPrice: number; color: string }
 | { tab: 'labor'; op: string; units?: number; unit?: string; hrsPerUnit?: number; baseHours: number; factor: number; factorName: 'production'|'install'|'none' }
 | { tab: 'travel'; rateItem: string; basis: string }
 | { tab: 'equipment'; item: string; period: 'day'|'week'|'month'; periods: number; ratePerPeriod: number; why?: string }
 | { tab: 'pmcad'; derivation: string; minApplied: boolean };
```
**Pricing stays exactly as it is.** `priceManual` keeps reading `qty / unitCost / unitSell / markupPct`, so the tier1 tests (42 sold SMT quotes to the cent) don't move.
A new pure function `deriveLine(line): QuoteLine` in `src/engine/derive.ts` recomputes the priced fields from `detail`, using the existing `lines.ts` formulas:
- structural: `unitCost = round2(lbPerFt × lengthFt × pricePerLb)`
- plate: `plateLine`
- box: `plateBoxLine`
- vendor: `unitCost = list × (1 − pwi%)`, `markupPct = (sell/cost − 1)×100`, matching `Kit.vend`
- labor: `qty = round1(units × hrsPerUnit × factor)` unless `'qty'` is in overrides

The editor calls `deriveLine` on every detail edit. The Kit calls it on push, so there's one formula path. Unit test: `deriveLine(kitLine) deepEquals kitLine` for every line in the fixtures.

### 6.2 Where each field gets populated (kit.ts and builders)
| Method | Populate |
|---|---|
| `Kit.steel(desc, shape, qty, len, opts)` | `detail.structural` (lbPerFt, pricePerLb, `priceGroup`, `priceSource` = `steel_cost <date>` or `catalog`). Add `opts.role`, which sets `basisRole` + `slot` |
| `Kit.plate` / `Kit.box` | `detail.plate` / `detail.box` (+ role for box columns and girders) |
| `Kit.std` | `detail.std` with `cat.stdHours()` as `builtHrsEach`. `Catalog.stdAll` already has `part` and `section` |
| `Kit.vend` | `detail.vendor` (list, both discounts from `cat.discount`) |
| `Kit.paint` | `detail.paint` (this.units / customUnits, piecesPerRun, run price) |
| `Kit.shop(ops)` | Change the tuple to `{desc, op, units?, unit?, perUnit?, hours}`. Store `baseHours`, `factor = this.f.production`, a real `laborOp` code (`col_tube`, `pcr_gt20`, `bridge_single`, `handling`… matching `labor_ops.code`). The crane.ts / gantry.ts / mezzanine.ts / monorail.ts / workPlatform.ts / products.ts call sites pass units (cols, runBeams, bridges) instead of pre-multiplied hours |
| `Kit.finish` site ops | Same as shop, with `factor = this.f.install`. `SiteWork` gets optional `units/perUnit/op` |
| `Kit.travel` | `detail.travel` (`basis` string already built in the description). Equipment: `detail.equipment` from the `eq()` closure (useWeekly/weeks/daily) + `why` (work height / heaviest pick) |
| `Kit.pmCad` | `detail.pmcad.derivation` from `rest`, `dollars` and the mins |
| All push sites | `slot = ${item}.${role or method}.${n}`, deterministic. `Kit` gets `itemIndex` from `buildSpec` |

### 6.3 Engineering basis on the doc
```ts
QuoteDoc.basis?: ItemBasis[];
interface ItemBasis { item: number; label: string; geometry: Record<string, number|string>; members: MemberPick[]; tons: number; smtShopHours: number }
interface MemberPick { role: string; pick: string; qty: number; lengthFt: number;
  source: 'PWI bridge chart'|'AQT chart'|'Gantry chart'|'Mezz chart'|'sized'|'box'|'rule'|'placeholder'|'rep override';
  chartRow?: string;          // e.g. "5 t × span ≤ 32'" (the row chartPick/pwiGirder matched)
  check?: { ratio: number; criterion: string };   // e.g. {0.91,'L/600 deflection'}; ratio > 0.98 → ✖
  why: string; lineSlots: string[] }
```
- `buildSpec.ts` copies `r.geometry`, `r.tons` and `r.smtShopHours`, which it drops today. Builders return `members: MemberPick[]` next to the existing `assumptions`.
- crane.ts: `chartPick` and `pwiGirder` return `{shape, row}` (the matched `row[keyName]` and capacity column) so `chartRow` is real.
- `sizeGirder` already has `Ireq`. It should return `ratio = Ireq / ixOf(shape)` and, for box, the bending ratio.
- Gantry and mezzanine do the same for their girder/legs and col/hdr/cm.
- Engine-computed ratios use the conservative `ixOf()`. Label them "est." until steel_shapes gets a real Ix column.

### 6.4 Also on `QuoteDoc`
- `suppressedSlots?: string[]`.
- `freightBasis?: string`. It's already built in `Kit.finish` as an assumption; it gets copied into the doc.
- `freightAuto?: number`, for revert.

`Priced` gets a `sections: Record<CategoryKey, {cost, sell, hours, tons, lines: number, edited: number}>` from `priceManual`. It's computed from priced lines and is display-only. The `rollup()` input doesn't change.

### 6.5 Old saved quotes
On load, `backfillDetail(line)` regex-parses the current description formats:
- `— (W.. x ..) × (n)'` → structural, with lb/ft from `steel_shapes`.
- `— t" × w" × l"` → plate.
- `— n plf × n'` → box.
- `Vendor PART — ` → vendor, using today's discounts.

Parsed details are marked `priceSource: 'parsed'` and never change `unitCost`. Lines it can't parse show in their section with blank detail cells (shape "—"), so nothing gets hidden.

## 7. Parity: SMT tab → new editor section
| SMT tab (reference/smt_tabs) | SMT columns | New section / columns | Gap closed by |
|---|---|---|---|
| Main_Summary A4–A26, B, D, C (1%) | label · tons/hrs · dollars · hidden 1% | Summary rows in the same order · Tons/Hrs · Cost · Sell · GM · peek | `priced.sections`, `ROW` order |
| Main_Summary A27–A36, E29–E35 | tons total, base, install, freight, pre-use, tax, total, dealer col | Rollup block §3.10 (1% and ×1.01 shown) | existing `rollup()` |
| Main_Summary F14–H17 | PM / Eng / P.E. hours × rate | §3.9 PM · CAD · Engineering | `detail.pmcad` |
| Main_Summary F19–H26 | inbound freight calculator | Inbound Freight row, cost-based grid | — (lines exist) |
| Structural | used for · QTY · material · length · #/ft · $/lb · tons · cost · price · markup I4 | §3.1 + Engineering basis box | `detail.structural`, `basis`, `basisRole` |
| Plate | QTY · thk · width · length · $/lb · lb/pc · tons · cost · price · markup J4 | §3.2 (plate + built-up sub-group) | `detail.plate` / `detail.box` |
| Standard_Parts_and_Products | desc · QTY · vendor · part # · updated · sell · total · hours | §3.3 incl. built hrs | `detail.std` |
| Hoist_and_Crane_Vendor_Items | part · desc · QTY · list · PWI disc · cost · ext · cust disc · sell | §3.4, same columns | `detail.vendor` |
| Cost_Based_Items | desc · QTY · cost ea · total · markup · sell | §3.5 + PV pinned row | — |
| Painting | desc · QTY (runs) · sell · total; 16 pcs/run note | §3.6 with piece-units → runs | `detail.paint` |
| Labor (Shop block, ops guide rows 93+) | op · units · hrs · rate · $; men/days/weeks | §3.7 shop: op · units · h/unit · base · factor · hours · $ | `detail.labor`, real `laborOp` |
| Labor (On-site block, F/G/H/I) | op · hrs · rate · $; men · days · weeks; wage adders H2 | §3.7 on-site + crew header + suggested-vs-quoted | `detail.labor` (install factor) |
| Travel_Costs | item · QTY · updated · cost · price · markup E4 | §3.8 travel + mode/crew dropdowns | `detail.travel` |
| Equipment | item · daily/weekly/monthly · PWI cost · total · charge · markup N2 | §3.8 equipment with period | `detail.equipment` |
| Pre-use_Load_Test | inspections $ | Rollup block pre-use + show toggle | — |
| Stairways, Concrete, VRC, Work_Platforms | own tabs → D7, D9, D12, D10 | Same summary rows. Generic grid (desc · qty · cost · mk · sell) until those builders add a `detail` | later `detail` kinds |
| Gantry (tab) | gantry calc → structural/plate/labor | Engineering basis box (Gantry chart) + normal grids | `basis` from gantry.ts |
| Quote_Wording, Quote | wording, customer price block | Wording tab (unchanged) · PDF | — |
| Information_Page, List | reference / lookups | Admin price lists (unchanged); lookups feed add-row type-ahead | — |

## 8. Implementation plan (files)
1. `src/engine/manual.ts`: types §6.1, plus `sections` in `priceManual`. Then `src/engine/derive.ts` (`deriveLine`, `backfillDetail`), with tests.
2. `src/engine/kit.ts`: populate `detail`/`slot`/`basisRole` and change the `shop`/`finish` op objects. Then update the builder call sites. The tier1 and calibration tests must stay green with identical totals.
3. `src/engine/buildSpec.ts`: keep geometry, tons and members → `doc.basis`. Add slot-matching rebuild with overrides and suppressedSlots.
4. crane / gantry / mezzanine: `members` with `chartRow` and `check`.
5. `app/src/editor/`:
   - `SummarySheet.tsx`: rows, peeks, badges, rollup block.
   - `Grid.tsx`: generic keyboard grid with column defs `{key, label, editable, path, fmt}`.
   - `sections.ts`: one column-def array per §3 section, which is the whole per-tab spec in data.
   - `BasisBox.tsx`.
   - `useDocHistory.ts`: undo.
   - `Editor.tsx` keeps loading, saving, flags and the price panel, and mounts SummarySheet in place of the flat table and QuickAdd.
6. No server or DB change is needed: `doc` is jsonb and the new fields ride along. The `save` action re-prices with the same `priceManual`.

## 9. Risks
- **Slot stability.** If builders renumber slots, overrides get orphaned. Keep slot = role plus per-role counter (never a global index), and test that rebuilding the same spec yields the same slots.
- **Unit-cost rounding.** `deriveLine` must round exactly where Kit does today (cents on unitCost). Otherwise the SMT reproduction drifts by cents.
- **"chart (unchecked)" may alarm reps.** That's intended: it's true, and it tells the President the pick is a chart pick and not a calc.
