# Round 3 build plan — quote editor (consolidated from A, B, C, ADV1, ADV2)

Base: branch `round3-c` (C's engine line detail + sectionize). Two implementation tracks with disjoint files.
Hard rules: prices for an unedited auto-built quote must not change (calibration drift test stays green);
no deploys; no pushes to main; company name is only "PWI".

## Track S — engine + server safety (files: src/engine/**, server/**, tests/**; NOT app/src)
S1. Install approval can't be bypassed. Quoted install hours = sum of hours on lines whose *kind* is site labor
    regardless of category, AND any spec install with zero site hours counts as 0. Flag `install_below_suggested`
    whenever quoted < server-suggested (server rebuilds from the saved spec; never trust client suggestion).
    Round the flag detail to 0.1 h and sort-independent so line order can't void an approval.
S2. Production Value / family: server derives family from spec (BUILDERS fam) when a spec exists; a family
    change that lowers PV raises a flag. No silent PV drop.
S3. Server fills line `detail`/`basis` from its own rebuild for auto lines (match by stable ref); client-sent
    detail on auto lines is ignored/overwritten. Hand lines keep client detail but are marked `source:'hand'`.
S4. Stable line refs: `ref = itemId + ':' + slot` where itemId is a permanent id stored on each spec item
    (assign `id` when missing) and slot is an explicit name passed by the builder (role + index), NOT a clock key.
S5. Rebuild preserves edits: auto lines carry `edited: {field: builderValue}` when the rep changes them;
    `buildFromSpec` re-applies edits onto the matching ref, keeps `removed` refs removed, and returns
    `conflicts` where the builder value changed under an edit. Pure `planRebuild(old, new)` returns
    adds/updates/removes/conflicts + $ delta by section, separating price-list-only changes from spec changes.
S6. C fixes: don't store detail twice (priced lines reference doc lines by key; strip detail from `priced`);
    runway basis text says runway not column (fix test); beam list reads the CURRENT line (shape from detail
    updated by deriveLine; if description edited away from detail, show "edited" and the description);
    review list includes markup/category/kind edits; section walk reconciles dealer discount honestly.
S7. Std parts cost: use std_parts.gm_pct to set cost (cost = sell*(1-gm)) so GM isn't 100%; catalog
    loader exposes gm; label assumed labor cost. (This changes GM display only, not sell — verify sell unchanged.)
S8. `deriveLine(line)`: recompute qty/cost/sell/hours from editable detail (steel: shape,len,qty → lb → cost @ $/lb
    → sell @ markup; plate: t,w,l,qty; labor: base hours × factor; vendor: list, discounts). Pure, used by UI and server.
S9. One rounding rule: totals rounded once at the rollup; PDF must use the server's priced result.
S10. Revise on a won/confirmed quote keeps status won (quote-api revise). Change orders: doc_type CHANGE ORDER
     prints the delta vs the last confirmed revision (engine helper `deltaDoc`).
S11. Policy flags (manager approval): margin below `settings.min_gm_pct` (default 0.25), markup 0 on a material
     line, discount > 10%.
S12. Tests for every item above. `npm test`, `npm run typecheck`, `npm run build` green.

## Track U — editor UI (files: app/src/** only; consume S's APIs by their names above; stub if not merged yet)
U1. Main view = SMT Main Summary rows in the exact SMT order and labels, columns: Tons/Hrs, Cost, Sell, GM $, GM %.
    One summary only. Each row expands in place to its tab grid (Structural, Plate, Labor, Standard Parts,
    Hoist & Crane Vendor Items, Cost Based Items, Painting, Travel Costs, On-Site Equipment, PM/CAD, Decals, Freight).
U2. Peek line under collapsed rows: Structural → "W24x131 girder ×1 @ 46' · W18x76 runway ×4 @ 31' · ST8x8x1/4 col ×8 @ 17'";
    Labor → top 3 ops with hours; Vendor → part numbers; Paint → runs; Travel → men × days, nights, miles, lift.
U3. Engineering Basis box at the top of Structural: geometry + each pick (girder/runway/column) with source chart,
    row, ratio (flag > 0.98), why; "CONFIRMED – PWI CHART" / "CALCULATED" / "REVIEW" tags.
U4. KPI strip always visible: Total, Base, GM %, tons, $/lb steel, shop hrs, hrs/ton, PV/shop hr, install hrs vs
    suggested, crew men × days. Change since last save shown as deltas.
U5. Inline editing in grids: Enter/F2 edits, Tab/arrows move, Esc cancels; numeric cells accept simple arithmetic
    via a safe parser (no eval: + - * / parentheses, ft-in like 20'6"). Edited cells amber with per-cell revert.
    Steel/plate edits go through deriveLine (change shape or length → lb, cost, sell update).
U6. Spec chips at top (capacity, span, runway, height, colors, install, miles…) — editing one shows the rebuild
    diff dialog (planRebuild) before applying: adds/updates/removes/conflicts, $ by section, approvals affected.
U7. Install as one control: men × days ↔ site hours (+ travel/equipment move together) — via spec fields crewMen/days.
U8. Undo/redo (Ctrl+Z / Ctrl+Y), draft autosave to localStorage (try/catch), "unsaved changes" list.
U9. Inline approvals: flags shown next to the line/section that caused them, "Ask manager" button, warning before a
    save voids an approval; sent revision → banner + one-click "Start revision".
U10. Target price tool ("knock $3k off"): shows GM by row and resulting GM %, applies as a visible discount line
     (not the dealer discount), raises the margin-floor approval if below min.
U11. Laptop-first: no horizontal scroll at 1366px, 9 default columns, more via column picker. PWI styling
     (Poppins, Spark Orange #FF6800 accents, Onyx text, Charcoal secondary, Silver borders).
U12. Keep existing routes, data loading/saving, PDF preview/send buttons working.
