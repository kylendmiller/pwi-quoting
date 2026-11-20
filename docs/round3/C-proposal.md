# Round 3, Proposal C: the data the editor needs (engine side, built)

Builder C. Branch `round3-c` (local, not pushed). The other proposals cover the page (A) and the editing workflow (B). This one is about the **data**: what a reviewer needs to see on each line, where it comes from in the engine, and the section tree the editor renders. It is **built and tested**, not just proposed.

**Prices did not move.** Every output was fingerprinted before and after the change: wording, assumptions, notes, blockers, freight, and every priced line's kind, category, description, qty, unitCost, markupPct, unitSell, cost and sell, plus totals and the rollup. That covered the 20 calibration jobs and 8 extra installed and multi-item specs. The before and after files are byte-identical. `npm test` passes: 110 tests, including the calibration drift guard and 11 new section tests.

---

## 1. What the reviewer can't see today

Today a line is `description + qty + unitCost/markupPct or unitSell`. Everything else is either baked into the description string or gone:

| Line type | Shown today | Missing or buried | Now on the line |
|---|---|---|---|
| Structural (`Kit.steel`) | "Runways — W14 x 30 × 26'", qty, unit cost | role, lb/ft, lb each/total, price group, $/lb, steel_cost date vs catalog, paint units, **which chart and row** | `role`, `detail.steel`, `basis` |
| Plate (`Kit.plate`) | "… — 0.75" × 20" × 20"" | lb (0.2833 × drop factor), $/lb and its source, what it's for | `detail.plate`, role (base_plate / gusset / stiffener / connection_plate …) |
| Built-up / box (`Kit.box`) | "… — 55 plf × 17'" | the ×1.03 fab factor, lb, $/lb, why built-up, unity for box girders | `detail.box`, `basis` (calc + unity or rule) |
| Standard parts (`Kit.std`) | description, sell | the built-in shop hours that are counted but not priced | `detail.std.builtHrsEach` |
| Vendor (`Kit.vend`) | "Starke STK… — …", cost, markup % | list price, PWI discount, customer discount, sell each, why this hoist or end truck | `detail.vendor`, `basis` (catalog pick: capacity/lift/voltage, wheelbase rule) |
| Paint (`Kit.paint`) | runs × rate | piece units, pieces/run, rounding, custom min runs, color | `detail.paint`, `basis` |
| Shop labor (`Kit.shop`) | op name, hours | SMT base hours, production factor, which SMT Labor row (Crane B9:B21, Mezz B24:B35, Handling A18, Built Items A49 …) | `detail.labor` |
| On-site labor (`Kit.finish`) | op name, hours | base hours × install factor, touch-up rule | `detail.labor` (where = site) |
| Travel time | "Travel (drive, 3 men, 733 mi)" | crew-size rule, crew days, mph | `detail.travel` (travel_time), `basis` → `crewMen` / `travelMode` assumption |
| Hotels / per diem / flights / car / LTL | "Hotels — 3 rooms × 6 nights" | men, nights, trip days, rate, markup | `detail.travel` |
| Equipment | "Rental Boom Lift — 3 wk" | why this lift (work height), why this handler (pick × reach), day/week/month, rates | `detail.equipment`, `basis` |
| PM / CAD | hours | power-law driver $, k, exp, mult, share, rate, minimum | `detail.pmcad`, `basis` |
| Multi-item jobs | `item` was set at runtime but untyped; shared-trip lines had none | which item / system, a label for it | `item` (−1 = shared trip), `group` |

---

## 2. The fields (all optional on `QuoteLine`)

`src/engine/manual.ts`:

```ts
role?: Role;          // what the line is on the job
item?: number;        // spec.items index; -1 = shared across the job (one trip for several installed items)
group?: string;       // "Item 1 (Bay A) — freestanding", "Shared trip (2 installed items)"
basis?: Basis;        // why: chart + row, calc + unity, rule, catalog pick, assumption id
detail?: LineDetail;  // the numbers behind the price, typed per kind
```

They are all optional. Old saved quotes and hand-typed lines load unchanged, and `priceManual` never reads these fields.

### 2.1 `Role` (src/engine/lineDetail.ts)

- **Members:** `column | runway | girder | beam | header | crossmember | brace | mast | boom | arm | bracket | truss | tower | platform | end_truck_weldment | track`
- **Plate parts:** `base_plate | cap_plate | gusset | stiffener | connection_plate`
- **Bought and standard items:** `hoist | end_truck | control_panel | radio | collision_avoidance | electrification | end_stop | anchor | bolt | rail | deck | guardrail | gate | stair | decal | casters | vrc | fall_protection | hardware | option`
- **Services:** `paint | shop_labor | install | travel_time | lodging | per_diem | airfare | rental_car | tool_return | lift | telehandler | forklift | generator | equipment | rental_delivery | pm | cad | pe | freight_in | other`

Builders set the role explicitly for the members that matter (crane column/runway/girder/brace, monorail beam/column, gantry girder/legs, mezzanine column/header/crossmember, jib mast/boom, every vendor line by Starke part prefix, every labor/travel/equipment line). For everything else, `roleOf(description)` infers it, with plate parts matched before the member they hang on. Across all 20 calibration jobs, the only lines that still come out `other` are the free-form "(sold cost line)" catalog items.

### 2.2 `Basis`

```ts
interface Basis {
  source: 'chart' | 'calc' | 'rule' | 'catalog' | 'spec' | 'fixed';
  text: string;                 // one plain-English line for the editor
  chart?: string;               // 'PWI bridge chart (motor)', 'AQT runway_by_bay', 'Gantry tab column chart', 'mezzanine_rules columnByLoadLb'
  row?: string;                 // the cell actually read: "5 t column × bay ≤ 25' (asked 5 t, 20.0')"
  unity?: number;               // governing demand/capacity for calc-sized members
  checks?: { name: string; unity: number }[];   // e.g. deflection L/360 0.81, bending 24 ksi 0.44
  assumption?: string;          // Assumption.field this line hangs on (girder, buildingBayFt, crewMen, foundation …)
  flag?: string;                // reviewer attention: past chart, unity > 0.98, AQT fallback, engineering to confirm
}
```

Where each one comes from:

| Builder | Member | Basis |
|---|---|---|
| crane | column | AQT `column_by_overall_height` + cell, or the built-up rule (plf by capacity) flagged "engineering to confirm" |
| crane | runway | AQT `runway_by_bay` + cell, pieces/line; flag when past the chart (placeholder) |
| crane | girder | PWI bridge chart + cell. If that misses, AQT chart (flag "AQT fallback"). Otherwise `calc` with unity from `sizeGirder` (W or plate box) |
| crane | brace, base plate, anchors | rule text: tube columns ≥ N, plate by capacity, anchors per column × columns |
| crane | hoist / end truck | catalog: smallest stocked ≥ capacity (class D ×), lift ≥, voltage, trolley. End truck from the wheelbase formula |
| gantry | girder | `calc` with `beamUnity()` (same Ix, loads and limits as `sizeBeam`) |
| gantry | legs | Gantry tab chart row; unity = force ÷ chart capacity; flag if past the chart |
| mezzanine | header / crossmember | `calc` with deflection + bending unity |
| mezzanine | column | `columnByLoadLb` row; unity = column load ÷ row limit |
| monorail | beam, column | AQT chart cell |
| jib | boom | `calc`, tip deflection L/150 unity |
| jib | mast | rule |
| work platform | rows | `fixed` (Work Platforms tab, per set, scaled to length) |
| VRC | VRC line, install | `fixed` (80% / 20% of the VRC tab price) |
| every builder | labor / travel / equipment / paint / PM-CAD | `rule`, with the formula written out |

`calcBasis()` adds `flag` automatically when unity > 0.98, which is PWI's max-unity rule in CLAUDE.md.

### 2.3 `LineDetail`: per-each numbers, typed per kind

```ts
type LineDetail =
 | { type: 'steel'; shape; lengthFt; lbPerFt; lbEach; priceGroup?; costPerLb; costSource: 'steel_cost'|'catalog'; steelCostDate?; paintUnitsEach }
 | { type: 'plate'; tIn; wIn; lIn; lbPerIn3: 0.2833; dropFactor; lbEach; costPerLb; costSource; steelCostDate? }
 | { type: 'box'; plf; lengthFt; fabFactor: 1.03; lbEach; costPerLb; costSource; steelCostDate?; paintUnitsEach }
 | { type: 'std'; sellEach; builtHrsEach }
 | { type: 'vendor'; vendor; part; partDescription; list; pwiDiscPct; customerDiscPct; costEach; sellEach }
 | { type: 'cost'; costEach; markupPct }
 | { type: 'sell'; sellEach }
 | { type: 'paint'; run: 'standard'|'custom'|'primer'|'flat'; pieceUnits; piecesPerRun; runRate; minRuns?; colorLabel? }
 | { type: 'labor'; where: 'shop'|'site'; op; smtRow?; baseHrs; factor; factorName: 'production'|'install'; hours; scheduleOnly? }
 | { type: 'travel'; what: 'travel_time'|'hotel'|'per_diem'|'flight'|'rental_car'|'tool_return'; mode; men; crewDays; tripDays?; nights?; miles; rate?; markupPct?; driveMph? }
 | { type: 'equipment'; item; purpose: 'lift'|'handler'|'generator'|'extra'|'delivery'; period: 'day'|'week'|'month'; crewDays; weeks; rates?; markupPct; why? }
 | { type: 'pmcad'; what: 'pm'|'cad'; method: 'power_law'|'fixed'; driverDollars?; k?; exp?; mult?; share?; rate?; min?; hours }
 | { type: 'pe'; hours };
```

**Design rule: detail stores per-each values only.** Totals (lb, hours, $) are always computed from the line's current `qty`, so when a rep changes 6 runways to 8, the lb and tons stay right. When a rep edits a priced field (unit cost, sell, or labor hours) so that it no longer matches its detail, `sectionize` reports it in `line.edited` and `tree.review`, with the built value next to it: "Hours edited (built 12.3 h = 22 × 0.56)". So the editor shows both what the builder said and what the rep changed, without a second data model.

---

## 3. The section tree: `sectionize(doc, priced)` in `src/engine/sections.ts`

```ts
type SectionKey = 'structural' | 'plate' | 'stdParts' | 'products' | 'vendor' | 'costBased' | 'paint'
                | 'shopLabor' | 'pmCad' | 'install' | 'travel' | 'equipment';

interface Subtotals { cost; sell; margin; marginPct; hours; lb; lines }

interface Section {
  key: SectionKey; label: string;
  smtTab: string;                 // 'Structural', 'Plate', 'Hoist and Crane Vendor Items', 'Labor (shop)', …
  summaryRows: number[];          // Main Summary D-rows, e.g. structural → [8, 18, 21]
  bucket: 'base' | 'installation';
  categories: CategoryKey[];
  totals: Subtotals;
  lines: SectionLine[];
  members?: MemberRow[];          // structural + plate: "what beams were used"
  byItem?: ItemTotals[];          // multi-item jobs
}

interface SectionLine {
  key; description; kind; category; role?; item?; group?; auto;
  qty; unit: 'ea'|'h'|'ft'|'sqft'|'run'|'night'|'day'|'trip';
  unitCost?; markupPct?; unitSell?; cost; sell; margin; marginPct; hours; lb?;
  detail?; basis?;
  assumption?: { field; value; why; alt?; altLabel? };   // resolved from doc.assumptions by basis.assumption + item
  edited?: string; synthetic?: true;                    // synthetic = freestanding production value (not a doc line)
}

interface MemberRow {   // one per item + role + size
  role?; size: 'W14 x 30' | '55 plf built-up' | '0.75" × 20" × 20"';
  item?; group?; pieces; lengthsFt: number[]; totalFt; lb; cost; sell; costPerLb?; priceGroup?; basis?; lineKeys: string[];
}

interface SectionTree {
  sections: Section[];            // SMT order; empty ones dropped unless { includeEmpty: true }
  totals: Subtotals;
  items: ItemTotals[];            // per spec item, "Shared trip", "Added by hand", "Job" (production value)
  reconcile: { baseSections; onePct; basePrice; installSections; installAdder; installation;
               outboundFreight; preUse; tax; dealerDiscount; total; diff };   // diff ≈ 0 proves every $ is in a section
  review: { key; description; section; reason }[];                           // basis flags + hand edits, one list
}
```

How sections map to categories, in SMT order:

| Section | Categories | Main Summary rows | Bucket |
|---|---|---|---|
| Structural steel | structural, miscSteel, xBracing | D8, D18, D21 | base |
| Plate & built-up | plate | D11 | base |
| Standard parts | stdParts, decals, ultraLitePcr, stairStringerPcr | D4, D17, D19, D20 | base |
| Products | stairways, workPlatforms, vrc, concrete | D7, D9, D10, D12 | base |
| Vendor items | vendor | D5 | base |
| Cost-based items | costBased, inboundFreight (+ production value) | D6, D22 | base |
| Paint | painting | D13 | base |
| Shop labor | shopLabor | D25 | base |
| PM / CAD / P.E. | pmMarketing, cad, engineering | D14–D16 | base |
| On-site labor | onsiteLabor | D26 | installation |
| Travel & lodging | travel | D23 | installation |
| Rental equipment | equipment | D24 | installation |

Every dollar is accounted for. The section sells, plus the 1%, plus the 1.01 install adder, plus freight, pre-use and tax, equal `rollup.quote.total`. The tests hold this within 5 cents (per-line cents rounding). Freestanding production value has no doc line but is priced into D6, so it appears as a synthetic Cost-based line and the totals tie.

---

## 4. What the UI can now show (no new engine calls)

1. **Collapsed tree (the President's view).** One row per SMT section: sell, cost, margin %, hours, tons. For example: "Structural steel — 6.4 t — $18,940 sell — 21% GM". A `reconcile` footer walks down to the quote total.
2. **"What beams were used."** Each structural section's `members` reads like a cut list (numbers below are illustrative):
   - Columns — ST 10×10×7ga — 8 pcs × 15.5' — 3,410 lb — AQT column chart (5 t, ≤ 16')
   - Runways — W14×30 — 6 pcs × 28' — 5,040 lb — AQT runway chart (5 t, bay ≤ 25')
   - Bridge girder — W24×131 × 46' — PWI bridge chart (10 t, span ≤ 45') ✓ confirmed chart

   Plate members do the same, by thickness × size.
3. **Expand a line → detail drawer, typed per kind:**
   - **Steel:** lb/ft × ft = lb each, × qty, $/lb (steel_cost 2026-11-16 vs catalog), markup → sell.
   - **Vendor:** list → −50% PWI = cost → −5% customer = sell.
   - **Labor:** "PCR runways: 18 h × production 0.56 = 10.1 h — SMT Labor B9:B21 Crane Labor".
   - **Travel:** 3 men × 6 nights × $X.
   - **Equipment:** "Boom lift: work height 24.5' ≤ 45'; 3 wk × $X/wk".
4. **Why chips.** `basis.source` gives a badge: chart, calc, rule, catalog, spec, fixed. Calc members show unity bars (`checks`). Clicking a chip opens the linked **assumption** with its `alt` button, which the existing assumptions UI already supports.
5. **Review list.** `tree.review` gathers every flag in one place: past chart, AQT fallback, unity > 0.98, "engineering to confirm", and every hand edit with its built value. This is a natural pre-send checklist.
6. **Multi-item jobs.** A toggle switches between "by section" and "by item" (`tree.items` and each `section.byItem`). The shared trip shows as its own group, so it is clear that travel was priced once.
7. **Margin heat.** Section and line `marginPct` let the UI shade low-margin sections, such as labor at the cost basis vs. materials.

---

## 5. Fit with A and B

- **A §6.1** (`detail` with a `tab` discriminant, `basisRole`, `MemberPick`) covers nearly the same ground. This branch implements it as `detail.type`, `role` and `basis`, plus `sectionize().members`. If A's names are preferred, the rename is mechanical. Two differences:
  - **No `deriveLine` that recomputes price from detail.** Detail is evidence, not a second price path. That keeps the tier1 and calibration identity trivially true, and `sectionize` reports drift instead of fixing it. If A's editable detail cells are wanted, `deriveLine` can be added later on top of these fields.
  - **Basis lives on the line**, with the assumption linked by field, not a separate `doc.basis[]`. Both can coexist: `members` is effectively A's `MemberPick[]` computed from the lines.
- **B's `ref` slot** fits directly: `${item}|${role}|${n}` is deterministic from these fields. Its `pin.base` can reuse `detail` for the builder value.

---

## 6. Findings while wiring the data

1. **The plate box girder is sized to unity 1.00 by construction.** `sizeGirder` iterates I to exactly the governing need, so on sold jobs 29562 and 28723 the box girder sits at unity 1.0. That breaks PWI's 0.98 max-unity rule. The line now carries a flag, and prices are unchanged. Fix: size to `need / 0.98`. That will move those two calibration jobs, so it is a deliberate re-calibrate.
2. **`sizeBeam` accepts unity up to 1.0, not 0.98.** The gantry girder on 28884 comes out at 0.972, which is close. Any pick over 0.98 is now flagged on the line. The real fix belongs in `sizeBeam` (`I ≥ Ireq / 0.98`) together with a calibration run.
3. **Payload grows.** Across the 20 calibration jobs, lines JSON goes from 168 KB to 403 KB, about 20 KB per quote, mostly `basis.text`. That's fine for jsonb. If revisions get heavy, drop `basis.text` on save and regenerate it on rebuild.
4. **Stale detail after edits is expected, not a bug.** `sectionize` compares the priced fields to the detail and reports it. Old quotes and hand lines simply have no detail. A's description-regex backfill would add detail for pre-round-3 quotes.

---

## 7. Files on `round3-c`

- `src/engine/lineDetail.ts` (new): `Role`, `Basis`, `LineDetail`, `roleOf`, `vendorRole`, `smtLaborBlock`
- `src/engine/sections.ts` (new): `sectionize`, `SECTION_DEFS`, tree types
- `src/engine/manual.ts`: optional `role / item / group / basis / detail` on `QuoteLine`
- `src/engine/kit.ts`: every line method fills `detail` and `role`. Optional `meta` (role/basis) argument. `K.why(role, basis)` default per role. `beamUnity()`, `calcBasis()`
- `crane.ts`, `gantry.ts`, `mezzanine.ts`, `monorail.ts`, `products.ts` (jib/VRC/catalog), `workPlatform.ts`: explicit roles and bases for the members. `sizeGirder` also returns `check` (unity), an additive field
- `buildSpec.ts`: `group` label per item; shared-trip lines get `item: -1`
- `tests/sections.test.ts` (new): 11 tests covering role and detail on every builder's lines, steel detail reproducing unit cost, chart/calc basis with unity, labor/travel/vendor detail, one-section-per-line and the reconcile to the quote total, subtotals, members, assumption resolution, multi-item grouping, edit detection, and manual quotes with no builder data
