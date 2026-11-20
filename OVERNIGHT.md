# Overnight checklist — quote app (branch `overnight/quote-builders`)

Rules
- Work ONLY on this branch. Never push to `main`, never deploy (no Netlify, no Supabase, no SQL).
- Stay inside the repo: no web lookups needed. Data: `reference/smt_tabs/*.txt` (Sales Main Template tab dumps),
  `reference/*.json`, `fixtures/*.json` (sold jobs — private pricing, never paste outside the repo), `tools/fixture_dump.py`.
- Company name is only "PWI" or "PWI Corp". The old long-form name must never appear anywhere.
- After each item: `npm test && npm run typecheck && npm run build` must pass, then tick the box, commit, push the branch.
- If an item can't be done, mark it `[BLOCKED: reason]` and move on. Don't stop early.
- Done = every box ticked or BLOCKED, all three commands green, and a short summary at the bottom of this file.

Items
- [ ] 1. Move `testCatalog` out of `tests/freestanding.test.ts` into `tests/catalog.ts` so importing it doesn't re-run the freestanding tests in every file.
- [ ] 2. Calibration report: for every fixture whose products match a builder (freestanding, bridge, gantry, monorail, mezzanine, jib, fall_protection, vrc), build a spec from the fixture's geometry, price it, and write `docs/calibration.md` (job, product, sold base, built base, % diff, likely cause). Add a test that fails if any job drifts more than 10 points from the numbers in that file.
- [ ] 3. Work platform builder (`type: "work_platform"`, family `work_platform`, factors .82 / .95) from `reference/smt_tabs/Work_Platforms.txt`, following the patterns in `src/engine/mezzanine.ts` and `kit.ts`. Wire into `BUILDERS` in `buildSpec.ts`, `describe()` in `app/src/model.ts`, and tests.
- [ ] 4. Standalone stairs builder (`type: "stairs"`, family `stairs`, factors .65 / 1.22) from `reference/smt_tabs/Stairways.txt`. If the tab has no usable price, require `stairPrice` and raise a blocker without it (same as mezzanine).
- [ ] 5. Monorail: use the monorail fixtures to replace guessed geometry defaults (support spacing, frame type) with what PWI actually sold. Re-run calibration.
- [ ] 6. Bridge crane: when no W shape meets L/600 within depth limits, add a box-girder line (plate-built via `Kit.box`) instead of only a note. Re-check jobs 28426 and 29562.
- [ ] 7. Edge-case tests for every builder: minimum/maximum sizes, ship-only vs installed, missing required field → blocker (never a crash), shared-trip with 3+ items.
- [ ] 8. Code-split the PDF renderer (`@react-pdf`) with a dynamic import so the main bundle drops under 500 kB. Make sure the PDF golden test still passes.
- [ ] 9. Update `skill/pwi-quote/SKILL.md` with the new `work_platform` and `stairs` fields.

Summary (fill in at the end)
