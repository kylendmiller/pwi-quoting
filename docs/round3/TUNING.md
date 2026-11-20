# Round 3 — wide calibration tuning

The engine was tuned against PWI's wide set of sold jobs. The tuning set has 91 jobs: high- or medium-confidence auto specs, single item, not an outlier, no engine blocker, no more than 50% bought-in scope, and |gap| ≤ 40% at the start. The set was frozen at the baseline so it could not change during tuning.

**Gap %** = (built base + sold pass-through) ÷ sold base at today's prices − 1. This is the same definition `tests/calibration/harness.ts` uses.

All the private source data stays outside the repo. The repo gets only the anonymized fixture `tests/calibration/wide_fixture.json` (job numbers, specs, sold base at today's prices, one pass-through $ per job) and the baseline `tests/golden/wide_baseline.json`.

## Result per family (tuning set, before → after)

| family | n | mean \|gap\| | median gap | within ±5% | within ±10% |
|---|---:|---|---|---|---|
| freestanding | 26 | 12.67 → **12.60** | −1.8 → −0.5 | 31% → 27% | 42% → **46%** |
| bridge | 38 | 10.26 → **10.24** | −3.1 → −3.1 | 32% → 32% | 58% → 58% |
| gantry | 5 | 8.69 → 8.69 | −5.8 → −5.8 | 20% → 20% | 60% → 60% |
| mezzanine | 14 | 13.17 → **13.13** | −1.5 → −2.9 | 21% → 21% | 43% → **50%** |
| monorail | 3 | 19.60 → 19.60 | +12.0 | 0% | 33% |
| jib | 2 | 27.20 → 27.20 | −8.5 | 0% | 0% |
| fall_protection | 3 | 23.83 → 23.83 | −24.6 | 0% | 0% |
| **all** | 91 | 12.44 → **12.40** | −3.6 → −3.6 | 26% → 25% | 47% → **49%** |

No family got worse on mean |gap|. On freestanding, one job dropped out of the ±5% band (31% → 27%), and two more jobs came into ±10%.

## What the data actually says (read this first)

**On total base price, every crane job's gap is dominated by job-to-job scope noise (about ±12%), not by a scalar bias.** The category biases in the report are real, but within the same jobs they offset each other. On freestanding, for example, the builder is short on shop labor (−$67k) and structural (−$166k) and long on vendor (+$51k) and plate (+$13k). Correcting one category fully moves those jobs' totals the wrong way.

Overfitting check. Each search below picks the best value on n−1 jobs and scores the held-out job. These numbers cover crane jobs (freestanding and bridge, 64 jobs); lower is better:

| what was searched | LOO held-out mean \|gap\| | base | in-sample best |
|---|---:|---:|---:|
| freestanding production factor alone | 11.29 | 11.24 | 11.22 |
| shop size taper alone | 11.31 | 11.24 | 11.21 |
| runway floor alone | 11.38 | 11.24 | 11.22 |
| PM+CAD small-job taper alone | 11.31 | 11.24 | 11.24 |
| all four knobs jointly | 11.77 | 11.24 | 11.16 |

In a 70/30 split repeated 200 times, the best joint setting picked on the 70% made the 30% worse on 93% of splits (by +0.8 pt on average).

**Conclusion: no constant can be selected by fitting total gaps. Every in-sample gain under 0.2 pt is noise.**

So the rule used was:

1. A change has to have direct category evidence that holds up out of sample.
2. It must not worsen its own family's mean |gap|, nor any other family's.
3. Engineering limits are never relaxed.

On the shop-labor category itself, the kept changes are a real out-of-sample improvement. Mean |log(shop $ built ÷ sold)| over 64 crane jobs is 0.229 at baseline. When the factor and taper are chosen on n−1 jobs, the held-out error is 0.196.

## Constants changed (kept)

| constant | file | from → to | evidence |
|---|---|---|---|
| freestanding production factor | `src/engine/buildSpec.ts` BUILDERS.freestanding.def[0] (also the defaults in `crane.ts` buildCrane and `freestanding.ts`) and `db/seed_core.sql` production_factor | 0.56 → **0.60** | n=26. Shop $ built ÷ sold median 0.85 → 0.91. A value of 0.66 would centre shop $ (1.00) but raises freestanding mean \|gap\| to 12.82. With the taper, the sweep 0.56/0.58/0.60/0.62/0.64 gives 12.66/12.62/**12.60**/12.64/12.73. |
| crane shop size taper (new) | `src/engine/rules/freestanding_rules.json` shopOps.sizeTaper, applied in `Kit.shop()` (`src/engine/kit.ts` shopTaper) | none → ×1 up to $100k material sell, straight line to **×0.80 at $200k**, flat after; freestanding + bridge only | n=12 jobs ≥ $150k sold. Bridge jobs with more than $100k of material had shop $ ratio median 1.19 (n=7); with the taper it is 1.00. Freestanding big-job ratio 0.92 → 0.93 (with the 0.60 factor). The basis text on each shop line shows the taper. |
| mezzanine default guardrail (new rule) | `src/engine/rules/mezzanine_rules.json` guardrailDefaultPctOfPerimeter, used in `src/engine/mezzanine.ts` | full perimeter → **90% of perimeter** less stair/gate openings; only when the spec gives no guardrailFt | n=13 sold mezzanines. Sold OSHA rail ft ÷ perimeter has a median of 0.60 (range 0.36–1.0). The sold rate ($39.93/ft) already matches the rule, so the 51% std-parts gap is quantity, not rate. A setting of 0.60 overshoots the family total (13.36) because the same jobs run structural 21% light. 0.90 centres the family mean gap (+1.1 → −0.2) and lifts ±10% from 43% to 50%. The assumption text tells the rep to set the real open sides. |

None of these change a member size.

## Tested and not kept

| proposal | result | why not kept |
|---|---|---|
| Freestanding production 0.66 (report §3.1) | freestanding 12.67 → 12.83 | Worsens its own family's total. Applied partly instead, as 0.60. |
| Runway floor at ≤ 3 t (sold-typical W12x26 @ 1 t, W14x30/34 @ 2 t, W14x43/48 @ 3 t). Implemented only where the floor's AISC Ix, Sx and Iy are all ≥ the chart shape's, so it was never lighter. | bridge 10.26 → 10.07, but freestanding 12.67 → 12.85 at 1 t only, and → 13.13 at all three capacities | The runway rows serve both families, and the floor makes freestanding worse. The shape evidence (22/30 jobs sold heavier, median 1.21× lb/ft) still stands. **Needs an engineering decision**, not a calibration one. The code was removed: there is no dead rule. |
| PM+CAD small-job taper (× 0.67 below $30k, blending to 1 at $40k; cadMin 12 → 10) | PM+CAD ratio on small jobs 1.50 → 1.30; freestanding 12.60 → 12.54, but bridge 10.24 → 10.30 | Worsens bridge. cadMin 10 on its own also worsens bridge (10.39). |
| Gantry production 0.69 → 0.61 (halfway) and 0.52 | gantry 8.69 → 10.25 (0.61) and → 11.89 (0.52) | Gantry shop runs +24% (aggregate), but vendor (−15%), plate and structural run under on the same 5 jobs, and the family total is already −4%. n=5. |
| Mezzanine std-part rates | Not changed | Sold guardrail ($39.93/ft), B-deck, Advantech and pins/shots rates match the rule file. The excess is the guardrail quantity (fixed above) plus auto-spec deck misreads (see below). |

## Live settings — SQL to run (not run; no Supabase this round)

Only the production factor is a DB setting. The shop taper and guardrail rule ship with the engine bundle and take effect on the next deploy.

```sql
-- check first: the live row overrides the engine default
select value->'freestanding' as freestanding from settings where key = 'production_factor';
-- then set it (touches only the freestanding key)
update settings set value = jsonb_set(value, '{freestanding}', '0.6'::jsonb) where key = 'production_factor';
```

## Sell changes, by job (deliberate; `tests/golden/sell_fingerprint.json` regenerated)

| job / spec | base before → after | quote total before → after | driver |
|---|---|---|---|
| 29140 | $76,285.89 → $77,327.06 (+1.36%) | $79,375.89 → $80,417.06 | freestanding factor |
| 29213 | $34,270.44 → $34,847.68 (+1.68%) | $51,666.04 → $52,243.27 | freestanding factor |
| 29354 | $166,683.15 → $166,977.52 (+0.18%) | $206,719.48 → $207,013.86 | factor +, taper − |
| 29331 | $468,093.40 → $458,768.13 (−1.99%) | $573,888.97 → $564,563.70 | taper |
| 29523 | $208,625.54 → $209,383.85 (+0.36%) | $249,059.25 → $249,817.55 | factor +, taper − |
| 28640 | $42,180.67 → $42,889.94 (+1.68%) | $53,927.29 → $54,636.55 | freestanding factor |
| 27678 | $59,043.53 → $59,837.23 (+1.34%) | same as base | freestanding factor |
| 28342 | $30,212.79 → $30,687.55 (+1.57%) | same as base | freestanding factor |
| 29562 | $153,482.66 → $152,747.38 (−0.48%) | $190,094.91 → $189,359.63 | taper |
| 28772 | $471,543.44 → $461,320.22 (−2.17%) | $544,763.57 → $534,540.35 | taper |
| 28723 | $1,871,256.66 → $1,801,560.60 (−3.72%) | $2,059,472.44 → $1,989,776.38 | taper |
| fstr-installed | $93,114.26 → $94,142.46 (+1.10%) | $118,027.85 → $119,056.05 | freestanding factor |
| multi-installed | $76,327.48 → $75,649.95 (−0.89%) | $117,371.61 → $116,226.14 | mezz guardrail −, freestanding + |

These were unchanged: 27793, 27893, 27952, 28192, 28426, 28527, 28728, 28884, 29061, bridge-installed, gantry-fly, monorail-local, wp-vrc-fp. The hand mezzanine cases give guardrailFt, and the taper only acts above $100k of material.

On the wide tuning set, 48 of 91 jobs moved:

- all 26 freestanding jobs
- all 14 mezzanine jobs
- 8 bridge jobs

The largest move was −2.7% (28688).

**Hand calibration (`docs/calibration.md`, regenerated):**

| product | mean \|gap\| before → after | change |
|---|---|---|
| freestanding | 5.4 → 5.5 | 29331 +2.1 → +0.1; 28640 +6.5 → +8.3 |
| bridge | 5.7 → 6.0 | 28772 +5.7 → +3.4; 28723 −4.3 → −7.9 |

28723 got worse because its shop labor came down to sold, which exposed a −$91k vendor scope gap. It is the same offsetting-category effect described above. No case moved more than 3.6 pt.

## Guards

- `tests/wideCalibration.test.ts` rebuilds the 91-job fixture and fails if any family's mean |gap| worsens by more than 1 pt against `tests/golden/wide_baseline.json`. It was checked to trip: setting freestanding production to 0.3 fails it. Re-baseline with `WIDECAL_WRITE=1 npx vitest run tests/wideCalibration.test.ts`, and only after a change documented here.
- It also unit-tests the taper and the guardrail default.
- The existing drift guard (`docs/calibration.md`, ±2 pt) and `tests/sellGuard.test.ts` were regenerated on purpose for the changes above.

## What's left

1. **Freestanding structural runs 21% light** (−$166k over 26 jobs), and it is concentrated in big jobs (−21% to −25% totals on 29262, 28602, 28509). Columns and runways are the source; see report §4. This is the largest remaining bias. It needs engineering, either the ≤ 3 t runway floor (tested above) or column picks, not a price knob.
2. **Bridge plate runs +29%** (median, n=18) and **bridge structural −18%** (aggregate). These need a per-part check (`freestanding_rules.json` basePlate and seat brackets).
3. **Auto-spec deck misreads on mezzanines.** 27581, 28606, 27652 and 29013 are read as tread plate, but the sold jobs carried B-deck (+ Advantech). Fixing `autospec.py` would remove most of the remaining mezzanine std-parts excess, and it would let a lower guardrail default be tested fairly.
4. **Gantry** (n=5), **monorail** (n=3), **jib** (n=2) and **fall protection** (n=3) have too few jobs to tune. In fall protection, PM+CAD runs 65% low on all 3 jobs, which is worth a look once there are more jobs.
5. **Unscored items.** Install, travel and freight are not in the base and were not scored. The wide report has the sold on-site hours if needed.
6. **Noise floor.** About ±12% per job on totals is scope the spec can't see. More spec fields (and fewer defaulted ones) will do more than any further constant tuning.
