# pwi-quoting

PWI Corp quoting system — pricing engine, wording, Claude skill and quote editor.
Design: "PWI Quoting System — Final Design v1" and "PWI Quoting Rulebook v1" (Claude docs).

## Phase 1 status
- `reference/` — price book seed pulled from Sales Main Template 11.3.26 (steel shapes + price groups, standard parts, Starke / Street Crane / CM / InMotion price lists, painting, equipment, travel, pre-use, decals, freight history, template rates). Re-run: `python3 tools/extract_reference.py <template.xlsx> reference`
- `fixtures/` — 50 real sold quotes (42 SMT, 8 AQT) as cell snapshots. Re-run: `python3 tools/extract_fixtures.py <quotes dir> fixtures`
- `src/engine/lines.ts` — row calculators (structural, plate, box plate, std parts, vendor, cost-based, labor/rate, travel, stairs, freight)
- `src/engine/rollup.ts` — Main Summary + Quote price block (1% adder, install ×1.01, tax, dealer discount)
- `tests/tier1.test.ts` — tier 1: engine reproduces the SMT on every row of every SMT fixture. `npm test`

Steel sizing: entered by the rep until Spenser's sizing tool is plugged in (sizing provider slot, phase 4).
