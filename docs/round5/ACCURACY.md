# Round 5 — accuracy push (2026-11-24)

Source: 91-job tuning set (tests/calibration/wide_fixture.json) for base price; 43 sold crane jobs with on-site hours
(private sold_facts.jsonl / specs.jsonl, outside the repo) for install. Engine e1b827dbef / 04dd25e181.

## Base price (no install, travel or freight)

| family | n | mean \|gap\| | median gap | within ±10% |
|---|---:|---:|---:|---:|
| bridge | 38 | 10.2 | −3.1 | 58% |
| freestanding | 26 | 12.6 | −0.5 | 46% |
| mezzanine | 14 | 13.1 | −2.9 | 50% |
| all | 91 | 12.4 | −3.6 | 49% |

Unchanged since round 3. The median is close (−3.6%); the spread is job-to-job scope the spec doesn't capture
(round 3 showed no constant reduces it out of sample). Hand-checked specs of the same jobs land within ~2–5% on
single-item jobs, so the engine reproduces the Sales Main Template when the inputs are right — the ±12% is mostly
the inputs (what was actually sold vs what the spec says), not the pricing.

One systematic category bias remains: **structural steel $ built ÷ sold ≈ 0.79** (freestanding, bridge, mezzanine).
The engine sizes members to the charts (unity ≤ 0.98); PWI historically sold heavier members. On freestanding the
PV adder hides it in the total. Matching history means quoting heavier steel than the charts need — a business /
engineering decision, not a calibration one.

## Install (not scored before this round)

On-site hours (task list + travel, as the SMT On Site Labor block carries them) built ÷ sold, factor 1.02:

| group | n | median |
|---|---:|---:|
| all crane jobs | 43 | 0.74 |
| freestanding | 12 | 0.80 |
| bridge on building runway | 11 | 1.03 |
| bridge only (existing runway) | 7 | 0.70 |
| crane columns | 6 | 0.70 |
| built work < 80 h | 18 | 0.68 |
| built work 80–150 h | 16 | 0.79 |
| built work > 150 h | 9 | 0.75 |

Per-job scatter is large (mean |log error| 0.41 ≈ ±40%).

Tried and **not applied**:
- Freestanding install factor 1.02 → 1.40 and bridge-only × 1.5: fixed the auto-spec medians (0.80 → 0.97, 0.70 → 0.88,
  leave-one-out error 0.34 → 0.20) but pushed the hand-checked golden jobs over sold (29354 199 → 251 h vs 176 sold;
  29331 405 → 533 vs 388; 28723 943 → 1,384 vs 934). The auto specs under-read scope on some jobs, so a multiplier fitted
  to them overshoots the well-specified big jobs.
- A fixed mobilization allowance fits better across sizes: crew × 10 h per job moves the median 0.74 → 0.91
  (error 0.41 → 0.31); crew × 15 h → 0.99 (0.29). It adds ~1–1.5 crew-days to every installed job (≈ $2–4k), big jobs barely
  move in %.

**Applied (Kyle, 2026-11-24): crew × 10 h mobilization / demobilization on every installed job** (`travel.mobilizationHrsPerMan`
in freestanding_rules.json). It is its own visible line, counts in the crew days (so hotel / per diem follow) and is part of
men × days when the rep sets installDays. After: crane median built/sold 0.92 (n=46), mean |log error| 0.34.
Golden jobs: 29354 229 h vs 176 sold, 29331 441 vs 388 (both over), 28723 378 h auto-spec vs 934 (scope under-read).
Example: 27893 mezzanine (2 men, 250 mi) $47,070 → $49,897.

Structural steel built ÷ sold ≈ 0.79: **not changed** — sent to engineering (chart sizes vs. sold-typical members).
