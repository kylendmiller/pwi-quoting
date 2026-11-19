# Proposal B: an auto-built quote the rep doesn't have to fix

**Angle:** a correct freestanding build, with every guess visible and one tap to change. Scratch code: `/home/claude/build2/B/` (repo untouched).

## 1. Calibration: 7 sold freestanding jobs rebuilt from their specs

Fixtures: 29140, 29213, 29354, 29523, 29331 (384' freestanding, not tagged FSTR), 28640 (the only filled-in AQT; the other 7 are blank templates) and 28970 (50 t, out of range, not in the medians). 28937 is one cost-based line and can't be broken down. Harness: `run2.ts` + `compare2.py`.

**Median error by category (v1 → v2).** "Steel" is structural + plate.

| | v1 median / abs | v2 median / abs |
|---|---|---|
| Steel $ | +1% / 18% | +6% / 9% |
| Std parts | −2% / 9% | +4% / 5% |
| Vendor | −10% / 10% | −3% / 7% |
| Paint | **+42% / 42%** | −7% / 7% |
| Shop hrs (SMT method) | **−14% / 14%** (low on all 6) | +4% / 7% |
| Site hrs excl. travel | +28% / 28% | +8% / 20% |
| Travel $ / equipment $ | **missing (−100%)** | +7% / 17%, +22% / 28%* |
| PM / CAD $ | −67% / −54% | −15% / +4% |
| Freight | −13% / 23% | −11% / 25% |
| Base price | −12% / 12% | +7% / 8% |

\*Rental quantities match 29354 exactly. The dollar gap is today's rates ($3,720/wk for a 15K telehandler vs $2,650 then).

**Install package (labor + travel + equipment) vs sold:** v1 was −24% to −30% on every installed job. v2 lands at −13%, +10% and +5% on 29213, 29354 and 29331.

Not reachable from the spec alone:
- **29523:** door interlock and ~50' bays with W27x194 runways; base is −43% on v1 and v2. The skill should ask "skipped columns or door interlock?" and route the answer to cost-based or steel overrides.
- **28640:** AQT priced at $0.83/lb steel, so its dollars don't compare.

## 2. Systematic biases and the corrected rules (all in `rules/freestanding_rules.json`)

1. **Shop hours run 11–24% low.** v1 omits the built hours on standard parts (`shop_hours_each`: plug & play 7/15 h, end stop kits 4 h, pairing 3 h): 18 h on 29140, 57 h on 29523. Other SMT Labor-tab fixes: PCR runways 2 h ≤20' / 3 h >20' (seed `labor_ops` still says 1/2); column fab 2.5 h tube / 6 h moment / 0.5 h/ft built-up; web stiffeners 1 h/beam at ≥5 t; manual bridge 14 h, not 28; handling = 1.5% of material sell ÷ $85, min 5 h (the SMT's own formula).
2. **Double girder at ≥5 t is wrong.** Sold 10 t jobs are single girder (29354, 29331). Default single; double is a toggle worth +$22k on 29354.
3. **Site hours.** ASCE rail is 16 h per 100 ft of OAL (v1 doubled it). Bridges: 8 h under 8,000 lb, 12 h above (v1: 12/24). Collision avoidance: 5 h/bridge, not 12.5. Runway pieces: one per bay (two bays up to 40'), not OAL/40.
4. **Paint.** The template's rule: 16 pieces per run, each piece counted as ceil(length/30), rounded up to 0.5 run. v1 went by tons: 4× too high on heavy jobs.
5. **Hoists ≥5 t** must be Starke SMW wire rope (STW if double girder). v1 found no hoist at 10 t. Panels go by capacity: 0246, 0346, 0446, 1046. End trucks: SCT ≤3 t, STT-170 at 5 t, STT-250 at 10 t; wheelbase ≥ span/7.5, minimum 48".
6. **PM and CAD were flat** (20 h/16 h). Use 5.2 h and 4.5 h per $10k of base.
7. **Columns ≥10 t are built-up plate** (55–85 plf, on foundations, with 3/4" epoxy anchors + grout). In v1 that plate was missing and plate dollars ran −72% to −81%.

## 3. Steel sizing until Spenser's tool arrives

The latest AQT (fixture 29629) has three sizing charts: column by overall height × capacity, runway by bay × capacity, girder by span × capacity. They're exported to `rules/aqt_sizing_charts.json`. They pick the sold shape, or one size off, on 29140, 29213 and 28640, and the exact runway on 29354. Structural error drops to 6%.

**Lookup order** (`nearestSold()` in `engine2/freestanding2.ts`):
1. Spenser's sizing tool, when it arrives (`source: 'engineered'`).
2. The nearest sold job, if it's close enough. Distance = 3×|log₂ capacity ratio| + Δspan/15 + Δbay/10 + Δhook/10, and it must be ≤1.5. Only shapes are taken from it, never prices.
3. The AQT chart.

The source is always returned as an assumption ("sizes from job 29331, engineering to confirm"). With 6 seed rows, leave-one-out matched 2 jobs and didn't beat the chart (steel abs error 13% vs 9%). Keep the chart as default until the lookup holds the 97 freestanding 2025+ jobs from the laptop extract.

## 4. Items v1 left out (now built)

- **Height.** Add `heightFt` + `heightBasis: 'overall' | 'hook'`; "tall" means overall. Hook = overall − headroom (3' at ≤2 t, 4' at ≤5 t); column = overall − runway depth − rail − top plate (within 5% on 29213, 29354, 29331). Kyle's FSTRGM5 "20' tall" example gets W14x53 × 18.5' columns; v1 gave W14x61 × 25'. Reading 20' as hook height adds **+$11,632**.
- **Custom color.** A custom booth run is $2,530 and must be at least one full run (template rule). Pink columns adds +$3,098 on the example.
- **Lodging and per diem.** Crew: 2 men up to 120 h on site, 3 above. Days on site = ceil(h ÷ (men × 10) − 0.25), plus a travel day each way beyond 250 mi. Hotel $170 × men × (days − 1), per diem $75 × men × days, +10%. Over 800 mi: flights, rental car and LTL tool return.
  - Rates are already in `rate_items` (`reference/travel.json` doesn't exist).
  - Exact match on 29213 (8 nights / 10 per diem) and 29354 (15 / 18).
- **Equipment.** Scissor lift if column top ≤24', else boom lift; one per 2 men. Handler from heaviest pick × 1.3: forklift, 6K, 10K or 15K telehandler; above 15K, flag "crane service". Generator when there's ASCE rail. Weekly from 3 days, monthly from 4 weeks; +15% and $400 delivery.
- **Freight.** Median $/mile from `freight_history` by truck type and mileage band, +20%. Hotshot up to 5 t / 40' pieces, flatbed above; one load per 24 t; oversize for pieces over 53'. 29213 and 29331 land within 0–1%.

## 5. Assumptions contract

The builder returns `assumptions: {field, value, why, alt, altLabel, impact}[]`. `impact` = rebuild with `alt` and diff the total (~5 ms each); null if the alternative can't be built. The UI shows chips like "20' = overall height · tap: hook height (+$11,632)". A tap edits the spec and rebuilds. Assumptions are saved with the quote, so the approver sees every guess.

## 6. Shape for the next products

- **Data** in a versioned `product_rules` table, one JSON per family: sizing charts, part families, labor ops, paint, crew, travel, equipment, freight, sold-systems rows.
- **Code (~300 lines, shared):** the generic steps (steel → plate → std → vendor → paint → shop → site → travel → equipment → freight → PM/CAD), the assumption/impact runner, and a thin geometry function per family (bridge: no columns; gantry: legs; jib: mast/boom; monorail: drops/ft).
- Kyle edits numbers in Admin; formulas stay in reviewed code. Pure TS + JSON, so it ports to the portal unchanged.

## 7. Build plan

**TODAY**
1. Port `engine2` into `src/engine/freestanding.ts` and seed `rules/*.json` into a `product_rules` table: every §2 fix, plus `heightBasis`, `colors`, travel, equipment and freight.
2. Return `assumptions[]` and show them read-only in the Editor.
3. Make the 5 SMT jobs tests, with bands of ±15% (steel/vendor/shop) and ±25% (install). Fix the 29213 test spec (it says manual/pendant/230V; the sold job is motorized/radio/460V). Make `npm test` find `tests/`: the Vite root is `app/`, so they only run with `--root .`.

**LATER:** one-tap chips; load the 97-job sold-systems table; Spenser's tool as `source: 'engineered'`; bridge/gantry geometry modules; the skill asks the 3 questions that matter most (height basis, colors, specials such as an interlock or skipped columns).

## Risks

n = 5 SMT jobs + 1 AQT. Sold prices predate today's steel (tube $1.10 → $1.55/lb), so part of v2's +7% base is price drift. Built-up column plf (55–85) needs engineering sign-off. Today's rental rates exceed the ones these jobs were quoted at.
