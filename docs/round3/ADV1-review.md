# Round 3, Adversary 1: the President's review of A, B and C

I'm reviewing as PWI's President. I quoted in the Sales Main Template (SMT) for years and I know the Main Summary by heart.
I don't care how it's built. I care whether I can see what beams we used, summed up and then broken out like the tabs, and tweak and check it faster than in Excel.

Sources I checked:
- the three proposals
- `app/src/Editor.tsx`
- `src/engine/manual.ts`, `kit.ts`, `crane.ts`, `rollup.ts` (working copy, which is on `round3-c`)
- `git show round3-c:src/engine/sections.ts`
- `reference/smt_tabs/*.txt` (Main_Summary, Labor, Structural, Standard_Parts_and_Products, Equipment, Travel_Costs, Painting, Pre-use_Load_Test)

---

## 1. Things the SMT gave me that none of the three proposals has yet

| SMT (cell) | What I used it for | A | B | C |
|---|---|---|---|---|
| Main Summary A63–E89 "Margin Calculator": GM per product line | GM by category | Shown, but wrong for std parts (see #1) | No | `marginPct`, but wrong for std parts |
| Std Parts col M "Gross Percentage" per part; `std_parts.gm_pct` exists in the DB | Real cost on std parts | **Mockup shows cost = sell** | — | **cost 0, so 100% GM** |
| Main Summary S5–T22 "Income Categories" (Cranes / Mezzanines / Installation / Work Platforms / Fall Protection / Inspections / Freight…) + "Check" | Revenue split for the project and accounting | Missing | Missing | Missing |
| Main Summary F7–F12 lead times (engineering, approval, production, PO weeks) | The lead-time line on the quote | Missing | Missing | Missing |
| Labor D3–D5 / I3–I5: men, days (= h ÷ (men × 10.5)), weeks, for **shop and site** | Install days, crew, shop calendar | Site only, read-only | Site men/days | Data only |
| Labor H2: on-site rate 113 + wage adders (J2–J4 +30/+15/+30, J6) | Prevailing-wage / special jobs | Missing (rate shown read-only) | Missing | Missing |
| Structural J11: "Incoming beams from SDI, use these sizes for guaranteed availability" | Pick a stocked beam | Missing | Missing | Price group only |
| Main Summary S19: Quoted Customer Support Hours (pre-use) | Service scheduling | Missing | Missing | Missing |
| Main Summary S37–S41: freight guide (LTL < 8K, HS, FB, OSL > 25K) | Sanity check on freight | Partial (freight basis string) | Ghost value | — |
| Things I worked out in my head from B/D: **shop h per ton, sell $/lb, $ per ton, PV per shop hour** | The 5-second smell test before sending | Missing | Missing | Missing (lb only) |
| "Save As" from an old job (SMT Rule #1) | How every hand quote started | Missing | Missing | Missing |

---

## 2. Five real tasks: SMT vs proposed

Step counting:
- One step is one cell, click or keystroke-commit.
- "Silent misses" are things that should have changed but don't.

### T1. "Customer wants it 10 ft taller"

**SMT, 4–6 cells, by memory.** Column length, bracing length, and maybe the column size from the chart (looked up by hand), boom lift size and the wording height. It's easy to miss the lift.

**A, about 5 cells plus wording, or a round trip through Claude.** A has no in-app spec edit. Editing column Len re-prices that line, but:
- the AQT column re-pick by overall height does not happen
- the lift work height is not re-evaluated
- the wording still says the old height

That's **3 silent misses**. It's worse than the SMT, because the screen *looks* engineered.

**B, 4 steps, 0 misses.** Click the `[20' overall]` chip, type 30, check the diff (column re-pick, lift, wording), Apply, Save. **B wins clearly.**

**C** has no UI. Its basis would show the stale chart row after a line edit.

### T2. "Swap the girder to the beam engineering wants"

**SMT, 1 cell.** Structural Girder #1 Material.

**A and B, 3 steps.** Expand Structural, change the Shape cell, Enter. **The swap is line-local.** In crane.ts:264, `bridgeLb = girderLb + …` drives:
- the heaviest pick, which sets the handler/lift size
- freight tons
- paint units

None of those re-derive. Trolley flange fit is not checked either. There's also no "who / why" captured. A shows `rep override` but no reason, and B has no reason either.

**Neither is better than the SMT on outcome.** The girder isn't a spec field (`pwiGirder()` reads only cap/span), so B's chips can't do it either.

### T3. "Check the steel tonnage and shop hours before sending"

**SMT, 0 clicks.** B8/B11 tons, B25 hours. Hours per ton is done in my head.

**A, 0 clicks.** The summary Tons/Hrs column and rail are good. But:
- no h/ton, $/lb or $/ton
- the "Shop h 412.6" in the rail vs "PWI built std parts (14.5) sched only" vs "SMT shop hours (scheduling) 412.6" contradict each other: is 14.5 in the 412.6 or not? 412.6 × $100 = $41,260, so it's priced.

**B, 0 clicks.** Shows **lb, not tons**, and no h/ton.

**C.** `Subtotals.lb` counts only lines that carry detail, so tonnage is **silently low**. That covers hand-added beams (today's `addSteel` writes no detail), old quotes and parsed-failure lines (B says "dropped, not guessed").

### T4. "Add 2 days of install and a lift"

**SMT, about 5 cells.** +63 site h (2 × 3 men × 10.5), and days/weeks recompute. Then hotel and per diem qty, and Equipment weekly qty.

**A, about 8 steps.** The Travel-header `crewDays` dropdown re-runs travel. Then a separate labor add row for 63 h, then the equipment add row. The Labor header still shows days *derived from hours* (read-only), so there are **two different "days" on screen**.

**B, about 6 steps.** Install header `days` pins crewDays (travel re-derives), `install +63` in the command bar, then `+` the lift.

**The gap is the same in A and B.** "Days" isn't one control that moves hours, travel and equipment together. In kit.ts:240, crewDays is *computed from* site hours, so pinning days without hours is inconsistent.

### T5. "Knock $3k off to win it"

**SMT, 2–5 tries.** Drop the Structural markup (I4) or a tab markup, and watch the total and the margin calculator.

**A.** No tool. You change section markups one at a time and watch the rail, or misuse Dealer/GC %.

**B.** "Hit $84,500" **solves the Dealer/GC discount**. Per rollup.ts:46–66, that discount:
- skips vendor (D5) and inbound freight (D22)
- drops the 1% (an SMT quirk)
- prints a Dealer/GC base on the quote

So a direct customer gets a "dealer discount". **Wrong tool.**

**Neither shows GM after the cut by category, or asks for approval below a margin floor.**

**Scorecard.** B wins T1. Everyone ties or loses to the SMT on T2 and T5. A wins T3 on layout but has the wrong data in places. Nobody wins T4.

---

## 3. Top 15 issues, ranked by severity

**1. CRITICAL: GM on Standard Parts is fake, so overall GM% is inflated.**
- `Kit.std` writes `unitSell` only (kit.ts:132–138), so `priceManual` gives std parts **cost 0 → 100% GM**.
- A's mockup shows cost = sell (GM "—"). C's "margin heat" would paint std parts as the best margin on the job.
- The SMT used a per-part Gross % (Std Parts M/N, rolled up at N217 into Margin Calculator B64), and `std_parts.gm_pct` is already in the DB.
- Labor, PM and CAD cost are also assumed (shop 59%, site 53%, PM/CAD 59% of sell; manual.ts:76–85).

*Fix:*
- Put `costEach = sell × (1 − gm_pct)` in `detail.std`. Use it for **cost only** in `priceManual`; sell stays the same, so tier1 doesn't move.
- Label GM on labor/PM/CAD rows "(std labor cost)" so nobody mistakes an assumption for a real margin.

**2. CRITICAL: I can't tweak the beam row the way I tweak a cell.**
- C (the only one built) makes `detail` evidence-only. If I change Length or Shape, nothing re-prices; I'd have to type a unit cost.
- In the SMT I type a length and the cost moves.

*Fix:* Ship C's fields plus **A's `deriveLine`** for steel, plate, box, vendor and labor (units × h/unit × factor). Keep C's `edited` check only for edits made directly to a price.

**3. CRITICAL: Member swaps don't propagate.** The girder/column/runway change is line-local, so lift size, freight, paint units, trolley fit and wording go stale (T2).

*Fix:*
- Make member picks spec fields (`items[i].members.girder = {shape, by, why}`) and expose them as B chips ("Girder [W21x62 ▾]").
- Route the change through B's rebuild diff.
- The basis reads "Engineering override — Mike, 11/20: deflection".

**4. HIGH: Install "Men × Days" isn't one control (T4).** A ends up with two different "days". B pins days without moving hours.

*Fix:*
- Put an Install header `Men [3] × Days [7] × 10.5 h = 220 h` on screen. Editing Days or Men moves site hours (as an "Install adjustment" line) and re-derives travel and equipment in one diff.
- Show weeks.
- Add the same Shop header from Labor D3–D5 (shop men, days, weeks).

**5. HIGH: The smell-test numbers are missing.**

*Fix:* Add one KPI strip under the total (rail or summary footer):
- `Tons · Shop h · Shop h/ton · Sell $/lb (steel+plate) · Base $/ton · PV/shop h ((base − material cost) ÷ shop h) · Install h · Men × Days · GM%`
- Hours-per-ton outliers vs the median for the product family get a ⚑.

**6. HIGH: There's no right way to "knock $3k off" (T5).** A has nothing; B misuses Dealer/GC.

*Fix:* A "Target price" box that offers two methods:
- (a) lower markups pro-rata on cost+markup sections
- (b) one "Price adjustment" line in Base

Show GM before → after by Main Summary row. Raise a GM-floor approval flag (new `gm_floor` setting). Keep Dealer/GC % for dealers only, and say on screen what it skips (vendor, inbound freight, the 1%).

**7. HIGH: Tonnage is silently low.** Hand-added steel (`QuickAdd.addSteel`), old quotes (C has no backfill), and B's unparsed lines carry no lb.

*Fix:*
- Every add path goes through `Kit.steel/plate/box` so detail is always written. Adopt A's `backfillDetail` for old quotes.
- The tons cell says `12.88 t + 3 lines without weight [show]`. Never show a confident wrong number.

**8. HIGH: B and C break the Main Summary order and labels.**
- C puts Structural first, Vendor after "Products", and PM/CAD after Shop labor. It merges Decals/PCR adders into Std parts, Inbound freight into Cost-based, and Stairs/WP/VRC/Concrete into "Products".
- B's rail collapses everything to 6 buckets in lb.
- My eyes go to D8 Structural, not to "Structural steel".

*Fix:*
- Use A's rule: rows D4–D26 in order with exact SMT labels ("Hoist & Crane Vendor Items", "Painting Charges", "Total Shop Fab Labor").
- C's `SECTION_DEFS` should become per-row; merging is a display option, not the default.
- B's rail reuses the same rows (non-zero only).

**9. HIGH: Too dense on a laptop, and summaries are duplicated.**
- A has a peek line under every row (about 30 lines before anything is expanded), plus a 13–14-column Structural grid, a basis box and the right rail.
- B shows the section summary twice (rail and main pane).

*Fix:*
- Use one summary (main pane). The rail holds only Total, KPIs, flags, Save and Send.
- Show peek lines only on Structural, Plate, Vendor and Labor; the rest on hover.
- Default Structural columns: `Used for · Qty · Shape · Len · Tons · $/lb · Mk% · Sell · GM%`. Cost, lb/ft and Item go behind a "more columns" toggle.
- Target: no horizontal scroll at 1366 px.

**10. MED-HIGH: There are no change orders after a confirmation.**
- A revision after CONFIRMATION is just "R3" with a full price.
- B's `diffDocs` / Compare R1↔R2 is the right engine, but nothing turns it into a change order.

*Fix:* A `CHANGE ORDER` doc type, priced as a delta against the confirmed revision (lines added/removed/changed, installation delta, GM of the change), with its own approval and PDF.

**11. MEDIUM: The Main Summary side blocks are missing** (see the table in §1): income categories with Check, lead times, customer-support hours, and on-site wage adders. A's §7 parity table claims full coverage but skips them.

*Fix:* Add to the rollup block:
- the Income Categories split (it feeds project conversion in Business Central)
- a lead-time block
- wage-adder checkboxes on the Install header

**12. MEDIUM: Options are buried or incomplete.**
- A moves Options to the Wording tab, away from the numbers.
- Hand options have no cost, so no GM.
- B's computed options are good, but its pricing basis (base + install, no freight) still needs a decision.

*Fix:*
- Show options under the rollup on the Numbers view with price, cost and GM.
- Hand options require a cost.
- Use B's "Add as option" for modelled changes, and decide the basis: **match the SMT, priced the way the base is priced, freight separate.**

**13. MEDIUM: Hand quotes start from zero.**
- The SMT's Rule #1 was "Save As" from a similar old job. No proposal can copy from a previous quote or job.
- AQT-template jobs (8 fixtures, their own price block) aren't addressed.

*Fix:*
- "Start from quote #…": pick sections, and steel and vendor lines re-price at today's `steel_cost` and discounts, with a diff.
- AQT quotes import as hand lines tagged `source: AQT`.

**14. MEDIUM: Three versions of the same plumbing.** A has `slot/overrides/autoValues/suppressedSlots` + `doc.basis[]`. B has `ref/pin/suppressed` + `docPins`. C has `role/basis/detail` (built). And `/` means "jump to" in A and "command line" in B.

*Fix:*
- One model: C's line fields, B's `ref` + `pin` + `suppressed` (ref built from C's `item|role|n`), and B's rebuild planner.
- Drop A's `doc.basis[]`; C's `members` already computes it.
- `/` = find/jump in v1; the command language comes later.

**15. MEDIUM: Developer words, and mockups that don't tie.**
- Words I don't use: pin, ref, suppressed, conflict, scenario, AUTO✎/HAND, synthetic, reconcile, peek, slot.
- A's mockup rows sum to about $151.7k × 1.01, not the $212,410 Base shown.
- A's install rows (28,250 + 5,632 + 8,027) × 1.01 = 42,328, not the 41,870 shown.

*Fix:*
- Use plain labels: "Changed by you", "Added by you", "Removed by you (restore)", "Builder now says X — keep yours / take builder's".
- Every mockup and screen must pass C's `reconcile.diff ≈ 0` check. A number that doesn't tie is the fastest way to lose my trust.

Smaller items:
- Sales tax is one global rate; branch jobs (e.g. Lancaster, PA) need a state and exemption choice.
- Show the SDI incoming/stock beam list as a ✓ next to the shape in the Structural grid.
- Show a freight-mode hint (LTL/HS/FB/OSL by $) next to outbound freight.
- C found that box girders are sized to unity 1.00 and `sizeBeam` accepts up to 1.0. That breaks the 0.98 rule. Fix it in the sizing, re-calibrate deliberately, and show ✖ until then.

---

## 4. Verdicts

### A: SMT-tab layout. **Keep the layout and change the data underneath.**
**Keep:**
- Main Summary spine with exact rows and labels
- Tons/Hrs column
- the beam peek on Structural and Plate
- the Engineering Basis box, with chart row and check
- per-tab grids with SMT columns
- tab-default markup in the section header
- `=` arithmetic in cells
- `deriveLine`
- `backfillDetail`
- revert per cell, line and section

**Cut:**
- its own data model (use C's)
- `slot/overrides` (use B's)
- Options on the Wording tab
- peek lines on every row

**Change:**
- make the mockup tie
- std parts cost
- KPI strip
- an editable Men × Days header
- the laptop column set
- one shop-hours number (decide whether built hours are in it or out)

### B: workflow. **Keep the safety net, defer the toys.**
**Keep (ship first):**
- stable refs, pin on edit, suppress on delete
- the rebuild diff dialog (the best idea in round 3)
- spec chips (add height basis and **member picks**)
- undo with local draft autosave
- change log, History, R1↔R2 compare
- inline approvals, "Ask manager", approvals carried forward
- Send lists its reasons
- locked → "Start R2 with this change"

**Defer:**
- the What-if 3-column panel and alternates
- the `/` command language

**Cut:**
- "hit $" via Dealer/GC
- the 6-bucket rail in lb

**Change:**
- the rail shows tons and the Main Summary rows
- plain-English badges
- turn compare into change orders

### C: engine detail. **Keep all of it as the data layer; it's the only one built and it proves the dollars tie.**
**Keep:**
- `role/basis/detail`
- `members` (the "what beams were used" cut list)
- `reconcile`, used as a test gate for every screen
- the `review` list as the pre-send checklist
- unity flags
- shared-trip `item: -1`

**Change:**
- section order and labels per Main Summary row, no merging by default
- add `deriveLine` so detail is editable
- add std parts `costEach`
- add tons and h/ton to `Subtotals`
- surface lb-less lines
- fix the 1.00 unity sizing

**Note:** it lives on the local branch `round3-c`, which is the current working-tree checkout, not `main`.

**Build order I'd sign off on:**
1. C's data + std cost + `deriveLine`
2. B steps 1–5 (nothing gets lost)
3. A's summary and grids with the KPI strip and Men × Days
4. B's rebuild dialog + spec chips including member picks
5. Target price and change orders
6. What-if

---

## 5. Top 10 (one line each)
1. Std parts GM is fake (cost 0 → 100% GM); use `std_parts.gm_pct` for cost, and label assumed labor cost.
2. C's detail is read-only; add A's `deriveLine` so typing a length or shape re-prices like the SMT.
3. A girder or column swap is line-local; make member picks spec fields so lift, freight, paint and wording follow.
4. Install Men × Days isn't one control; editing days must move site hours, travel and equipment together.
5. No h/ton, $/lb, $/ton or PV/shop-h; add a KPI strip next to the total.
6. "Knock $3k off" has no right tool; add a target-price tool with GM by row and a floor approval, and keep Dealer/GC for dealers.
7. Tonnage is silently low for hand and old lines; route all adds through Kit and show "+n lines without weight".
8. B and C break the Main Summary order and labels; use rows D4–D26 with exact SMT names everywhere.
9. Too dense on a laptop and the summary is duplicated; one summary, peeks on 4 rows, 9 default columns, no scroll at 1366 px.
10. No change orders after a confirmation; price revisions after CONFIRMATION as a delta document with approval.
