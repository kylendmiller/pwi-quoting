# Overnight checklist — quote app (branch `overnight/quote-builders`)

## Goal
**Price accuracy.** Every auto-built quote within **±3% of the sold base price** on PWI's sold jobs.

## Rules
- Work ONLY on this branch. Never push to `main`, never deploy (no Netlify, no Supabase, no SQL), no preview deploys.
- Stay inside the repo. Data: `reference/smt_tabs/*.txt` (Sales Main Template tab dumps), `reference/*.json`,
  `fixtures/*.json` (sold jobs — private pricing, never paste outside the repo), `tools/fixture_dump.py`.
- Sold jobs only (no lost quotes).
- Company name is only "PWI" or "PWI Corp".
- **Engineering wins.** Never size a member below its deflection/strength limit (L/600 runway/bridge, L/360 mezz,
  L/150 jib tip, column charts) to hit a price. Close the gap with labor hours, factors or markups, and log it.
- You MAY tune: labor hours per task, member sizing (within limits), markups and production/install factors.
  Put every tuned number in the rules JSON / settings with a comment naming the jobs that justified it.
  Don't fit one job: a change must improve the product's average gap across its jobs.
- After each item: `npm test && npm run typecheck && npm run build` must pass → tick the box → commit → push.
- Can't finish an item → `[BLOCKED: reason]`, move on. Hard stop at **6 hours**.
- Done = every box ticked or BLOCKED, all three commands green, summary filled in, draft PR open.

## Items
- [x] 1. Move `testCatalog` out of `tests/freestanding.test.ts` into `tests/catalog.ts` so importing it doesn't re-run those tests.
- [x] 2. **Steel cost from one dated setting.** Add a `steel_cost` setting: `{ effective: "YYYY-MM-DD", source: "weekly steel brief", perLb: { <price group>: $/lb, ... } }`
      (groups = those in `reference/steel_price_groups.json`; seed with current values). All builders (`Kit.steel`, `plate`, `box`) price steel cost from it,
      falling back to today's catalog values. Add `tools/steel-cost-from-brief.md` documenting the exact JSON shape so Kyle's weekly brief can update it later.
      Calibration (item 3) re-prices old jobs' steel at this setting so old and new jobs compare fairly.
- [x] 3. **Calibration harness.** For every fixture whose product matches a builder, rebuild a spec from the fixture's geometry, price it, and write
      `docs/calibration.md`: job, product, sold base, built base, % gap, biggest category differences, likely cause. Add a test that fails if any job's gap
      moves more than 2 points from the table (so later changes can't silently drift).
- [BLOCKED: ±3% not reachable inside the rules — mean abs gap 11.0% → 7.7% (5 jobs, mean +3.7%). What's left is AQT-chart steel heavier than the sold steel on 29354/28640 (can't size below the chart), 29331 spec'd all-10 t (sold half 5 t), and 29140 under (sold PM 60 h, 20' stock columns). See Summary.] 4. Tune **freestanding** to ±3% (all FSTR fixtures).
- [x] 5. Tune **bridge** (building runway / crane columns / bridge only). When no W shape meets L/600 within depth limits, add a plate box-girder line via `Kit.box` (check 28426, 29562, 28192). — Done: box girder via `Kit.box` (29562 → 187 plf vs 189 sold), L/600 W sizing past the chart, bridge factor 0.58, PM ×1.0, `railFt`/`runwayElectrificationFt`. Mean abs gap 16.7% → 8.5%; 28426 −1.1%, 28192 +7.1% (chart runway heavier than sold), 29562 −17% (sold 15 t hoists derated to 10 t).
- [x] 6. Tune **mezzanine**. — Gray steel = primer runs by default, mezz production factor 0.83 → 0.60. 28527 +6.2% → −2.9%. 27793 / 27893 are customer-engineered (AVM) frames kept as outliers; 27823 not modeled (bought-in joist package).
- [x] 7. Tune **gantry**. — Only one sold gantry job (28884, two gantries): −2.8% → −2.5%. Girder sizing now includes the girder's own weight at L/600 (was point load only). No factor changes (one job).
- [x] 8. Tune **monorail** — replace guessed geometry defaults (support spacing, frame type) with what the monorail fixtures show. — Done: ≤2 t supports at ≤25' (29061, 27952), goal-post when two parallel beams or >2 t, new `parallelBeams` (27952) and `components: false` (29061), single-post columns sized at 3× load (29061 sold ST12), PM/CAD ×1.3. 29061 +64% → −16%, 27952 −16% (sold steel heavier than spec'd: 40' beam sticks, 1/4" wall columns). 27660/28953 (Barnhart 16/40 t) not modeled.
- [BLOCKED: no sold jobs in repo — the only jibs (28728, and the one inside 27952) are bought-in HyperLite jibs carried as cost lines (website price), not PWI-fabricated jibs, so there's nothing to tune the jib builder against; 28728 stays in the calibration table as an outlier. Fall protection only appears inside the Barnhart custom monorail jobs (27660/28953) and as loose parts (28867).] 9. Tune **jib** and **fall protection** if any fixtures exist; otherwise BLOCKED: "no sold jobs in repo".
- [x] 10. **Work platform builder** (`type: "work_platform"`, family `work_platform`, factors .82 / .95) from `reference/smt_tabs/Work_Platforms.txt`, patterned on
      `mezzanine.ts` + `kit.ts`. Wire into `BUILDERS` (`buildSpec.ts`), `describe()` (`app/src/model.ts`), tests, and calibrate if fixtures exist.
      (Standalone stairs: NOT tonight.) — Done: `src/engine/workPlatform.ts` + `rules/work_platform_rules.json` (truss/hoist/tower selection, components at list −15%, specialty +25%, plate/structural through Kit, every option row, Labor rows 60-68 + accessory hours, $600 CAD/PM, $1,600 paint, $125 freight per set). No sold work-platform set in fixtures (28738 is a grating pit platform), so not calibrated; install hours are an estimate.
- [x] 11. Edge-case tests for every builder: min/max sizes, ship-only vs installed, missing field → blocker (never a crash), shared trip with 3+ items.
- [ ] 12. Update `skill/pwi-quote/SKILL.md` with `work_platform` fields.

## Morning deliverables
1. Draft PR "Overnight: quote builders" → main (do not merge).
2. **Price-gap table per job** (from `docs/calibration.md`, before vs after tuning) in the summary and PR description.
3. **Decisions for Kyle**: every rule change you wanted but weren't sure about, and every job you think is an outlier, with the reason.

## Summary (fill in at the end)
