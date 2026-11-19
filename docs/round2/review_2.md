# Review 2: cut complexity, ship the felt win today

**Verdict:** B matters most, because wrong numbers are what Kyle fixed by hand. A and C each build a second app around the link. Kyle needs one tap from chat, correct numbers, and a screen to check.

## Conflicts resolved into one design

| Topic | Decision |
|---|---|
| Link route (A `#/build`, C `#/import`) | **`#/new?s=`**. NewQuote.tsx already is the "confirm customer, create" card, so prefill it from the spec. A paste anywhere on the quote list feeds the same path. |
| Spec storage (`quotes.source_spec` vs `doc.spec`) | **`doc.spec` plus `doc.assumptions`.** It is versioned per revision, saved by the existing `save`, and needs no migration. |
| Server vs client build | **Client, today.** The server already re-prices every save, so a doctored link can't set prices. Move the loop into pure `src/engine/buildSpec.ts` so the connector can reuse it. A's server move is a large job with no felt gain today. |
| Customer match (pg_trgm, dry_run, 409) | **The existing substring list in NewQuote**, prefilled from `spec.customer.name`. The rep taps the match or "New". |
| Idempotency (`ref` vs `spec_id`) | **None today.** `location.replace` strips the spec after create. A double tap makes a second draft, which is cheap to delete. |
| Height fields | **C's `overallHeightFt` / `hookHeightFt`**, not B's basis flag. Claude can't mix them up. |
| Assumption shape | **`{field,label,value,source:'said'\|'inferred'\|'default',why}`.** Add `choices`/`impact` later. |
| Customer block | **Flat** (C). |

Fact: `netlify.toml` **already** sets no-cache on index.html. The stale app came from an **open tab that never reloaded**, so only a version check is needed.

## Gold-plating to cut

- **C:** cut autosave, the "+ Add" search rewrite, the bottom tab bar, Editor regrouping and Cost view, the ⋯ menu, the eye icon, and `navigator.share`/mailto. Also cut re-quote by `spec_id` with "keep my edits" merge, the riskiest item anywhere.
- **B:** cut the `product_rules` table. Ship the rules as JSON in `src/engine/rules/`; rates already sit in editable `rate_items`/settings. Cut `nearestSold()`: B's own test lost to the chart, 13% vs 9%. Cut impact diffs.
- **A:** cut the server build, migration 004, `match_customer`, dry-run, the `persistRevision` refactor, and hashchange polling.

## Links

- **Size:** C's example spec is 581 bytes, which is **775 base64url characters**. Three items with wording come to about 2.6k. That fits easily: the fragment never reaches Netlify.
- **Can Claude make the link?** With a code tool, `make_link.py` makes it reliably. **Without one, Claude must not try:** hand-typing 775 base64 characters will eventually drop one and corrupt the link. Output the JSON and say "paste it anywhere in the app". The parser accepts base64url or raw JSON.
- **Pasting** takes three actions (copy, switch, paste); the link takes one tap. Keep both on one code path.
- **Short server-side IDs** need Claude to call our server. That means either an unauthenticated drop endpoint, which is an abuse surface, or per-user auth, which **is** the connector. So short IDs wait for the connector.

## Plan for TODAY

1. **Version check** (S). Have `vite.config.ts` emit `version.json`. Add `app/src/useAppVersion.ts`: on focus and every 5 minutes, reload when nothing is unsaved, otherwise show a banner. Wire it in `main.tsx`. Set 16px inputs in `styles.css`.
2. **Port B's engine2** (L, the biggest correctness win).
   - Port `B/engine2/freestanding2.ts` into `src/engine/freestanding.ts`: overall height, custom paint, lodging and per diem, lift and handler, freight, shop/site hours, single girder default, Starke ≥5 t, built-up columns, PM/CAD.
   - Add `src/engine/rules/*.json`. Return `assumptions[]`.
3. **Tests** (S). Add the 5 SMT jobs to `tests/freestanding.test.ts` with ±15% / ±25% bands. Fix the 29213 spec. Make `npm test` actually run `tests/`.
4. **`src/engine/buildSpec.ts`** (S). Extract it from `ImportSpec.run()` and have it write `doc.spec` and `doc.assumptions`. `parseSpec` accepts base64url or raw JSON.
5. **One import path** (M).
   - `main.tsx`: match with `startsWith('/new')`, and stash `?s=` in sessionStorage before `<Login/>`.
   - New `app/src/pendingSpec.ts`, plus a paste listener in `QuoteList.tsx`.
   - `NewQuote.tsx`: prefill from the spec. Create runs `create`, then build, then `save`, then `location.replace('#/q/'+id)`.
6. **Review screen** (M). New `app/src/Review.tsx` at `#/q/:id`; the Editor moves to `/q/:id/edit`. Show a summary line, a **read-only** assumptions list, flags with "Ask manager", total and margin, PDF, the existing Send, and Edit lines.
7. **Skill** (S). `SKILL.md` v2: C's appendix minus re-quote-by-id, with links to `#/new?s=`. Add `scripts/make_link.py`. With no code tool, give the JSON and say paste.
8. **Phone smoke test with Kyle's sentence** (S). Expect W14x53 columns at about 18.5' (not 25'), about +$3.1k for pink, hotel and per diem, a scissor lift, and Review after one Create tap.

The flow becomes: **say the job, tap the link, tap Create, check Review, Send.** No hard refresh and no hand fixes.

## Must wait for the connector

- A server-side build, short IDs or no link at all, and Claude replying with the quote number, total and flags.
- `find_customer`, `get_quote`, and re-quote by talking with idempotent refs.
- Tappable chips with impact, nearest-sold sizing (once the 97-job table is loaded), bridge/gantry modules, and an Admin-edited rules table.
- C's polish list: autosave, the grouped Editor, "+ Add" search and the tab bar. Revisit it after a week of reps using Review.
