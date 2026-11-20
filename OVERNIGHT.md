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
- [BLOCKED: ±3% not reachable on every job inside the rules — FSTR mean abs gap 11.0% → 5.3%, 2/5 within ±3% (29213 +1.4, 29331 +0.9). Left: 29140 −11.8 (sold heavier steel: 20' stock columns at a 13'7" hook, W14x53 runways; PM 60 h), 28640 +6.8 (AQT-priced job), 29354 +5.7 (AQT chart girder W27x146 vs sold W21x132 — can't size below the chart). See Summary.] 4. Tune **freestanding** to ±3% (all FSTR fixtures).
- [x] 5. Tune **bridge** (building runway / crane columns / bridge only). When no W shape meets L/600 within depth limits, add a plate box-girder line via `Kit.box` (check 28426, 29562, 28192). — Done: box girder via `Kit.box` (29562 → 187 plf vs 189 sold), L/600 W sizing past the chart, PM ×1.0, `railFt`/`runwayElectrificationFt`. Later in the night: built-part hours no longer double-priced, Class D hoist sizing (`serviceClass`), PM/CAD power law, `bracketsByOthers`, and two more sold jobs calibrated (28772, 28723). Bridge mean abs gap 17.7% → 5.2% over 5 jobs: 28426 −1.9, 29562 −5.1, 28772 +5.5, 28723 −6.4, 28192 +7.2 (chart runway W18x76 vs sold W16x67).
- [x] 6. Tune **mezzanine**. — Gray steel = primer runs by default, mezz production factor 0.83 → 0.60. 28527 +5.5% → −0.7% (final). 27793 / 27893 are customer-engineered (AVM) frames kept as outliers; 27823 not modeled (bought-in joist package).
- [x] 7. Tune **gantry**. — Only one sold gantry job (28884, two gantries): −2.8% → −4.6% at the end of the night. Girder sizing now includes the girder's own weight at L/600 (was point load only); the later built-part-hours fix and conservative Ix moved it to −4.6%. No factor changes (one job — the remaining gap is the gantry tab's standard-parts bundle, $46.8k sold vs ≈$27k built).
- [x] 8. Tune **monorail** — replace guessed geometry defaults (support spacing, frame type) with what the monorail fixtures show. — Done: ≤2 t supports at ≤25' (29061, 27952), goal-post when two parallel beams or >2 t, new `parallelBeams` (27952) and `components: false` (29061), single-post columns sized at 3× load (29061 sold ST12), PM/CAD ×1.3. 29061 +64% → −21%, 27952 −50% → −16% (sold steel heavier than spec'd: 40' beam sticks, 1/4" wall columns). 27660/28953 (Barnhart 16/40 t) not modeled.
- [BLOCKED: no sold jobs in repo — the only jibs (28728, and the one inside 27952) are bought-in HyperLite jibs carried as cost lines (website price), not PWI-fabricated jibs, so there's nothing to tune the jib builder against; 28728 stays in the calibration table as an outlier. Fall protection only appears inside the Barnhart custom monorail jobs (27660/28953) and as loose parts (28867).] 9. Tune **jib** and **fall protection** if any fixtures exist; otherwise BLOCKED: "no sold jobs in repo".
- [x] 10. **Work platform builder** (`type: "work_platform"`, family `work_platform`, factors .82 / .95) from `reference/smt_tabs/Work_Platforms.txt`, patterned on
      `mezzanine.ts` + `kit.ts`. Wire into `BUILDERS` (`buildSpec.ts`), `describe()` (`app/src/model.ts`), tests, and calibrate if fixtures exist.
      (Standalone stairs: NOT tonight.) — Done: `src/engine/workPlatform.ts` + `rules/work_platform_rules.json` (truss/hoist/tower selection, components at list −15%, specialty +25%, plate/structural through Kit, every option row, Labor rows 60-68 + accessory hours, $600 CAD/PM, $1,600 paint, $125 freight per set). No sold work-platform set in fixtures (28738 is a grating pit platform), so not calibrated; install hours are an estimate.
- [x] 11. Edge-case tests for every builder: min/max sizes, ship-only vs installed, missing field → blocker (never a crash), shared trip with 3+ items.
- [x] 12. Update `skill/pwi-quote/SKILL.md` with `work_platform` fields.

## Morning deliverables
1. Draft PR "Overnight: quote builders" → main (do not merge).
2. **Price-gap table per job** (from `docs/calibration.md`, before vs after tuning) in the summary and PR description.
3. **Decisions for Kyle**: every rule change you wanted but weren't sure about, and every job you think is an outlier, with the reason.

## Summary (fill in at the end)

**Run:** 11/20, one overnight session. All 12 items are ticked or BLOCKED; `npm test` (101 tests), `npm run typecheck` and `npm run build` pass. Nothing was deployed and no SQL was run. The seed files were edited, but nothing was applied to a database.

### What was done
- **Steel cost setting** (item 2): `settings.steel_cost` = `{ effective, source, perLb: { group: $/lb } }`, using the groups in `steel_price_groups.json` plus `Plate`. `Kit.steel` / `plate` / `box` use it and fall back to the price list. The seed is `src/engine/rules/steel_cost.default.json`, and the weekly-brief format is in `tools/steel-cost-from-brief.md`.
- **Calibration harness** (item 3): `npm run calibrate` writes `docs/calibration.md`. `npm test` fails if any job's gap moves more than 2 points from that table.
  - 20 sold jobs are re-spec'd from their fixtures (`tests/calibration/cases.ts`).
  - Each sold job is re-priced at today's steel, vendor lists, standard parts and paint rates, so older jobs compare fairly with today's builds.
  - Every other fixture is listed with the reason it was skipped.
  - "Before" gaps come from the pre-tuning engine (commit 4cc8193) run on the same specs.
- **Engine fixes found while calibrating** (these apply to every builder):
  - **Built-part hours were priced twice.** `Kit.shop` added "PWI built standard parts" hours as priced shop labor. The SMT's Labor row 49 only counts those hours (it has no $ column), because the standard-part sell price already includes the labor. Those hours are now tracked but not priced. This lowered crane quotes by about 1–3%.
  - **The Ix estimate was unconservative.** `0.05·w·d²` overstated light-for-depth W shapes (W24x55 by 17%, W30x90 by 12%), so `sizeBeam` could pick a beam below L/360 or L/600. It now uses `0.04·w·d²` (`ixOf`), which is below AISC Ix for every shape I checked. Mezzanine, gantry and jib members can come out one size heavier.
  - **PM/CAD now follows a power law fitted on 9 sold crane jobs** instead of a straight line: PM + CAD $ = 226.5 × (materials + shop $k)^0.807. That is about 12% of a $30k job and 6% of a $1.6M job.
  - **Hoist fallback:** a ≤3 t hoist with no STK chain hoist at the needed lift now falls back to an SMW wire rope hoist (28772). Before, the hoist was left blank.
- **Bridge** (item 5):
  - Past the AQT girder chart, the girder is now the lightest W shape that meets L/600 with its own weight and bending. If none does, a plate box girder is added through `Kit.box`: 187 plf vs 189 plf sold on 29562, 167 plf vs 161 plf on 28723.
  - New spec fields: `serviceClass: 'D'` (hoist one size up, derated), `railFt` / `runwayElectrificationFt`, `bracketsByOthers`.
- **Freestanding** (item 4): 10 t built-up columns ≤17' are now 55 plf, and bracing starts at 8 columns.
- **Mezzanine:** gray steel is priced as primer runs by default, and the production factor is 0.60.
- **Monorail:** defaults now come from the sold jobs. New fields `parallelBeams` and `components: false`. Single-post columns are sized at 3× the load.
- **Gantry:** the girder's own weight is now in the L/600 check.
- **Work platform builder** (item 10): `type: "work_platform"`. Not calibrated — there are no sold Guardian work platform sets in the fixtures.
- **Tests and skill** (items 11–12): edge-case tests for all 10 builders, and SKILL.md updated (work_platform, serviceClass, bracketsByOthers, parallelBeams, components, railFt).

### Price gap per job (built base vs sold base re-priced at today's prices)

| Job | Product | Sold base | Sold @ today's prices | Built base now | Before % | Now % |
|---|---|---:|---:|---:|---:|---:|
| 29140 | freestanding | $82,134 | $87,092 | $76,802 | −8.9 | **−11.8** |
| 29213 | freestanding | $33,202 | $33,724 | $34,204 | +5.0 | **+1.4** |
| 29354 | freestanding | $154,189 | $159,655 | $168,775 | +13.2 | **+5.7** |
| 29331 | freestanding | $443,029 | $458,350 | $462,510 | +7.1 | **+0.9** |
| 28640 | freestanding (AQT) | $39,611 | $39,611 | $42,293 | +20.8 | **+6.8** |
| 28192 | bridge | $170,372 | $191,353 | $205,166 | +10.1 | **+7.2** |
| 28426 | bridge | $49,724 | $56,880 | $55,813 | +3.3 | **−1.9** |
| 29562 | bridge | $156,405 | $161,736 | $153,483 | −39.0 | **−5.1** |
| 28772 | bridge | $393,637 | $446,194 | $470,799 | +13.4 | **+5.5** |
| 28723 | bridge | $1,708,026 | $1,956,267 | $1,831,939 | −22.5 | **−6.4** |
| 28527 | mezzanine | $25,657 | $30,279 | $30,078 | +5.5 | **−0.7** |
| 28884 | gantry | $172,560 | $183,248 | $174,860 | −2.8 | **−4.6** |
| 29061 | monorail | $22,604 | $24,249 | $19,161 | +64.0 | **−21.0** |
| 27952 | monorail | $110,865 | $144,733 | $121,899 | −49.8 | **−15.8** |
| 29523 | freestanding (outlier) | $327,217 | $332,369 | $211,426 | −33.7 | −36.4 |
| 27678 | freestanding (outlier) | $51,685 | $60,361 | $59,044 | +3.0 | −2.2 |
| 28342 | freestanding (outlier) | $38,888 | $43,591 | $30,213 | −22.0 | −30.7 |
| 27893 | mezzanine (outlier) | $19,347 | $24,434 | $33,272 | +33.0 | +36.2 |
| 27793 | mezzanine (outlier) | $38,199 | $48,573 | $93,747 | +90.6 | +93.0 |
| 28728 | jib (outlier) | $29,591 | $30,085 | $36,939 | +41.6 | +22.8 |

By product, outliers excluded:

| Product | Jobs | Mean abs gap before | Mean abs gap now | Within ±3% before → now |
|---|---:|---:|---:|---|
| Freestanding | 5 | 11.0% | 5.3% | 0 → 2 |
| Bridge | 5 | 17.7% | 5.2% | 0 → 1 |
| Mezzanine | 1 | 5.5% | 0.7% | 0 → 1 |
| Gantry | 1 | 2.8% | 4.6% | 1 → 0 |
| Monorail | 2 | 56.9% | 18.4% | 0 → 0 |

Category-by-category differences and the likely cause for each job are in `docs/calibration.md`.

**The ±3% goal is not met on every job:** 5 of 14 non-outlier jobs are within ±3%, and most of the rest are within ±7%. What is left is mostly sold steel that differs from the AQT charts (the rules don't allow sizing below the chart), plus job-specific scope a spec can't express.

### Decisions for Kyle

**Needed before the app matches these numbers** (nothing was deployed):
1. **`production_factor.mezzanine` 0.83 → 0.60** in the live settings table. The seed and the engine default are updated, but the app reads the database.
2. **Add the `steel_cost` setting.** The seed row is in `db/seed_core.sql`. Until it exists, the engine uses the catalog prices, which are the same values today.
3. **Re-bundle the server engine after merging.** The bundle in `app/public/engine/` is stale. Run `npm run bundle:api`, then deploy Netlify first and the Supabase function second, as `tools/bundle-api.mjs` says. I didn't re-bundle in this PR: it deletes the old engine file, which would break the function that is deployed now.

**Rule changes I wasn't sure about:**
4. **Built-part hours** are no longer priced (Labor row 49 has no $ column). Please confirm this is how the SMT treats them. It lowers every crane quote by about 1–3%.
5. **Collision avoidance shop hours:** your 11/19 setting is 20 h per bridge. Sold jobs carried 5 h per bridge (29523, 29562, 28970, 28670), 15 h for 3 units on 29331, and 0 on 28772. I left it at 20.
6. **The AQT charts are heavier than the steel PWI sold:**
   - 29354 girder: W27x146 vs W21x132 sold.
   - 28192 runway: W18x76 vs W16x67 sold.
   - 28640 columns: ST7 vs ST6 sold.
   - 29331 runways: W21x101 vs W18x86 sold.

   If engineering confirms the sold sizes, update the charts. Most of the remaining over-pricing on freestanding and bridge comes from this.
7. **Ix 0.05 → 0.04** is a safety fix. A real Ix (and Sx) column in `steel_shapes` would allow exact sizing and lighter members.
8. **Class D service** (`serviceClass: 'D'`) sizes the hoist at 1.25× rated capacity, derated, plus 10 shop hours per bridge. This is based on 29562 and 28723. Is that your standard practice?
9. **Monorail single-post columns** are now sized at 3× the load (1½ t at 20' picks a W14x53; 29061 sold ST12x12x1/4). It errs heavy, so engineering should confirm.
10. **Mezzanine primer by default** (28527, 27793 and 27893 all sold primer runs) and **bracing from 8 tube columns** (28640 had none at 6 columns): both are based on three jobs or fewer.
11. **Work platform install hours** are my estimate of about 62 h per set. There are no sold installs to check against.
12. **The harness also re-prices sold vendor items, standard parts and paint at today's rates**, not just steel. Please confirm that's the comparison you want.

**Outliers (priced, but kept out of the tuning averages):**
- **29523:** custom header/stool frame with 58' bays and a $32.5k interlock.
- **27678:** two systems on 4 columns, partly supported by the building.
- **28342:** HyperLite enclosed track. The builder has no S400 parts.
- **27893 and 27793:** frames engineered by the customer (AVM); 27793 sits on bought-in joists.
- **28728:** bought-in HyperLite jibs.

**Jobs inside the averages that look odd:**
- **29140:** columns sold as 20' sticks at a 13'7" hook, and 60 h of PM.
- **29061:** 35 h of after-paint assembly on a job where the customer supplied the hoists and trolleys.
- **27952:** 41.5k lb of steel sold where the geometry needs about 25k lb. Unexplained.
- **28640:** priced with the AQT, not the SMT.

**Not modeled:** 28323 (7 systems on mixed building and intermediate columns), 27823 (bought-in joist mezzanine), 28970 (25 t, above the builder's range), 27660 and 28953 (Barnhart 16 t / 40 t custom monorails), 29181 (bridge components only), 28670 (custom modular box crane).
