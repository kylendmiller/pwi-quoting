# Round 3, Adversary 2: what will break or be unsafe in the quote editor redesign

Reviewer: Adversary 2. This was a read-only review. I ran tests in a separate worktree (`/tmp/r3c-adv2`, detached at `round3-c` 2e29303). `/tmp/r3c` was already taken by builder C's fingerprint files, so I didn't touch it.

**Baseline on `round3-c`:**
- `npm test`: 110 of 110 pass.
- `tsc --noEmit`: clean.
- I added three throwaway adversarial test files in the worktree (`adv2*.test.ts`). They were deleted with the worktree. The results are quoted below.

**Bottom line.**
- C's engine diff does not move prices. I confirmed this independently: priced totals are identical with `role/item/group/basis/detail` stripped.
- The danger is not in C's arithmetic. It is in three places:
  1. Approval rules that can already be bypassed today. A and B make the bypasses easier.
  2. B's slot refs, which can attach a rep's pins and deletions to the wrong item.
  3. "Evidence" fields (detail, basis, pin.base, autoValues) that the client writes and the server never checks. The editor shows them as if they were authoritative.

---

## 1. Evidence from running code

| # | Probe (worktree, `round3-c`) | Result |
|---|---|---|
| E1 | 3-item job (2 freestanding + mezzanine, 124 lines): JSON size of `doc` and `priced`, with and without C's fields | doc 33.3 KB → **68.3 KB**; priced 27.8 KB → **62.8 KB**. Both columns are stored on every save (quote-api.ts:88-89). That is about **+70 KB per save**, not the "≈20 KB per quote" in C §6.3. Totals are identical. |
| E2 | Build the same spec twice | Detail, basis and roles are byte-identical. **Keys differ** (kit.ts:50 `Date.now()`). |
| E3 | Rep changes the girder description to `W21 x 44` and changes runway markup from 26 to 0 | `members` still reports the girder as **W16 x 67** (sections.ts:124-137 reads `detail.shape`). `tree.review` is **empty**: neither the shape swap nor the markup cut is reported (sections.ts:110-122). |
| E4 | Move every on-site labor line to Cost-based (what Editor.tsx:153 does when the category changes) | installHours 122.8 → 0. Total −$7,193. **Flags: none.** Review: none. |
| E5 | Change "Main product" from Freestanding to Bridge (Editor.tsx:131, then :80) | Production Value of **$3,138 disappears**. Total $118,028 → $114,858. **No flag.** |
| E6 | Dealer discount 10% | `reconcile.basePrice` = $89,945 but the quote base is $82,041, and `diff` = 0. The reconcile is circular whenever a discount is set (sections.ts:201 uses `ro.quote.base`). |
| E7 | PDF total (sum of rounded rows, QuotePdf.tsx:85) vs the stored `total` | Differs by up to **$1.74** across 24 specs. |
| E8 | Legacy line with an unknown category | Dropped from the tree. The rollup ignores it too (rollup.ts:50), so `diff` = 0 even though the line has a sell. |
| E9 | Runway basis text | `"5 t column × bay ≤ 28'"`. The runway chip says "column" (crane.ts:84). The test at sections.test.ts:52 locks this wording in. |
| E10 | B-style refs (`item|category|stem|n`) under spec changes | Height 20→30 or capacity 5→10 removes or adds columns, hoist, anchors, lift and end truck refs (shown as conflicts, which is OK). **A steel_cost +5% change with the same spec changes 9 same-ref lines.** **Deleting item 1 of 2: crane B's girder takes ref `0|structural|bridge-girder|1`, which used to be crane A's** (W16x67 vs W18x86). |
| E11 | Install hours in the flag detail vs line order (80 specs) | **50 of 80** give a different hashed `quoted` value when lines are reordered (`108.19999999999999` vs `108.2`). |

---

## 2. Top 15 risks (ranked)

**R1. CRITICAL. The install approval is bypassed by deleting, moving or reclassifying install labor.**
- Evidence: manual.ts:115-118 only flags when `installHours > 0 || some site_labor`. With zero site_labor lines there is no flag at all (E4).
- Editor.tsx:153 changes `kind` along with category, so one dropdown turns install hours into a material line.
- Catalog items take `spec.installHours` straight from the rep (products.ts, buildCatalogItem), so the rep sets the suggestion.
- A's "Move to…" and B's `/install 88` make this one gesture.
- **Fix:**
  - Flag whenever `suggestedInstallHours > 0 && installHours < suggested`, even when no site lines exist.
  - Treat any line in onsiteLabor/travel/equipment whose kind is not the expected one as a flag (`INSTALL_RECLASSIFIED`).
  - Forbid changing a line's `kind` across the install/base buckets without a reason and an approval.
- **Test:** delete all site lines, or move them to costBased, on an installed spec. Expect `INSTALL_BELOW_SUGGESTED`.

**R2. CRITICAL (B, A). The spec comes from the client, so pins plus a spec edit lower the server's "trusted" suggestion.**
- serverChecks (quote-api.ts:174-186) rebuilds from `doc.spec`, but the browser writes `doc.spec`.
- B makes spec edits one click (chips) and makes pinned lines and wording survive them. So a rep can:
  1. pin the lines and wording,
  2. shrink capacity, height or runway on a chip,
  3. watch the suggestion drop and the flag clear,
  4. keep the original price lines.
- B §7.7 claims "the browser is never trusted". That is not true for the spec.
- **Fix:**
  - On save, the server rebuilds and compares the saved auto lines (by ref) to its own build. Lines that are neither matching nor pinned are a `SPEC_LINES_MISMATCH` blocker.
  - Any pin on a structural, vendor or install line, or on the wording, while the spec changed since the last approval, raises `SPEC_CHANGED_WITH_PINS`, which needs a manager.
  - Add `spec hash` to the INSTALL flag detail, so an approval does not survive a spec edit.
- **Test:** pin all lines, edit `capacityTons` down, save. Expect a flag.

**R3. HIGH (B). Slot refs follow item index, so pins and suppressions land on the wrong item.**
- `ref = item|…` (B §2.2). Deleting or reordering items renumbers them (E10). A pin or `suppressed` entry made on crane A is then applied to crane B.
- With two identical cranes the base values match, so the pin is kept **silently** (B §2.3 step 3: "keep yours, silently").
- A deleted festoon on item 0 suppresses the next item's festoon.
- The shared trip moves between `-1` and `i` when the count of installed items crosses 1 (buildSpec.ts:75-76, 106).
- **Fix:**
  - Give each spec item a persistent `uid` (assigned at create, kept in `spec.items[i].uid`) and key refs by uid, not index.
  - Give the trip refs `trip|…` for both the 1-item and the shared case.
  - Show a conflict for any pin whose item uid no longer exists.
- **Test:** delete item 0 of two identical items. Expect zero pins and zero suppressions carried, and an explicit conflict.

**R4. HIGH (all). Detail, basis, pin.base and autoValues come from the client, and the editor shows them as fact.**
- The server stores `doc` verbatim (quote-api.ts:88) and checks none of these fields.
- A hand line can claim `auto: true`, `basis.chart: 'PWI bridge chart'` or a fake `pin.base` ("builder had 9 h"). The editor's chips, unity bars and "builder says" ghosts would then show false engineering and false baselines to the President.
- **Fix:**
  - The server already rebuilds in serverChecks. Use that build to overwrite `detail`/`basis`/`pin.base`/`autoValues` on auto lines by ref, and strip them from lines with no matching ref.
  - Alternatively, store them server-side only.
  - Never render "CONFIRMED" or "chart" for a line the server didn't stamp.
- **Test:** post a hand line with a forged basis. Expect it stripped or marked "unverified".

**R5. HIGH. Production Value ($/shop-h, 100% margin) disappears with no flag.**
- The client computes `freestandingShopHours` (Editor.tsx:80) and zeroes it when the "Main product" dropdown isn't Freestanding (Editor.tsx:131). That cost $3,138 on a 5 t crane (E5).
- PV_BELOW_FLOOR only checks the rate override (manual.ts:119).
- **Fix:** the server computes PV hours from shop lines whose `family`/`item` type is freestanding (C's `item` + spec type makes this possible) and ignores the client's value. Flag any drop against the build.
- **Test:** switch the family dropdown, then save. Expect PV unchanged or a flag.

**R6. HIGH. Rebuild still deletes edited auto lines (C does not fix F1/F2/F4).**
- buildSpec.ts:68 is unchanged on `round3-c`.
- C's `edited` badge makes this worse for trust: it tells the rep the edit is "tracked", then the next ImportSpec silently drops it.
- **Fix:** ship B steps 1-3 (refs, pins, planRebuild) **before** any UI that invites editing auto lines, or block ImportSpec when `tree.review` contains edits.
- **Test:** edit an auto line's qty, rebuild with the same spec, and expect the edit kept.

**R7. HIGH (B). Rebuild mixes price-list drift into spec changes.**
- The same spec with steel_cost +5% changes 9 steel lines (E10). Any chip (even a paint color) re-prices every unpinned steel, hoist or rate line to today's lists, and turns every pinned one into a conflict.
- The dialog shows one "+$3,910 structural" that the rep will read as the span change.
- B's own test "empty plan for the same spec" fails as soon as the Monday steel_cost changes.
- **Fix:**
  - planRebuild runs twice: (old spec, new prices) then (new spec, new prices).
  - It shows "Price-list updates" separately from "Your change", with a choice to keep old prices.
  - Store `steelCostDate`/catalog version on the doc.
- **Test:** same spec plus a bumped steel_cost. Expect the plan to have only a price-update section.

**R8. HIGH. Approvals bind to unrounded floats, other changes void them silently, and managers approve what they didn't see.**
- `quoted` is a float sum that depends on line order (E11: 50 of 80). Any reordering voids the approval. This includes B's applyPlan, A's section regrouping, and server-side sorts.
- `suggested` is recomputed from the live catalog and settings on every save (quote-api.ts:79), so an admin rule change voids approvals with no user edit.
- CLASS_D's detail is `{}` (manual.ts:121), so its approval survives any change, and with B §7.4 it carries into every later revision.
- `approve` takes no `doc_version` (quote-api.ts:103-111): the manager approves whatever is stored at that moment, not what was on screen. B §7.2 drops the `!dirty` guard on top of this.
- Approvals are deleted *before* the version-guarded update (quote-api.ts:83-92), so a losing concurrent save still deletes approvals.
- **Fix:**
  - Round the detail values (0.1 h).
  - Add `doc_version` + `covered_hash` to `approve`, and reject on mismatch.
  - CLASS_D detail gets a capacity/spec hash.
  - Move approval deletion after a successful update.
  - B §7.4 carries an approval forward only when the spec hash also matches.
- **Test:** reverse the line order, then save. Expect the approval kept.

**R9. HIGH. The PDF total can disagree with the app and the DB.**
- The PDF sums rounded rows (QuotePdf.tsx:85): up to $1.74 off (E7).
- Send builds the PDF from the **client's** `doc`/`priced` in memory (Editor.tsx:230), not from the server's stored `priced`. If settings change mid-session (rates, tax, 1% switch), the customer PDF and the DB total differ.
- C's `reconcile` uses unrounded cents.
- **Fix:**
  - Pick one rounding rule (round the rows, and total = sum of rounded rows) in `rollup.quote`, and store it.
  - The PDF renders from the `priced` returned by the server's `send` response.
  - Send rejects if the client's displayed total ≠ the server total.
- **Test:** change shop_rate after load, send, and compare the PDF total with `quote_revisions.total`.

**R10. MEDIUM-HIGH (C). The members list and review list understate edits ("what beams were used" can be wrong).**
- `members` keys on `detail.shape`, so a shape swapped in the description shows the old beam and old lb (E3).
- `editedWhy` ignores markup, description, category or kind changes, travel/equipment/paint/cost/sell lines, and steel qty.
- C §4.5 offers `review` as a "pre-send checklist", but it showed nothing in E3 or E4.
- Lines moved to another section keep their `detail`. In E4, 8 labor-detail lines sat in Cost-based with no review entry.
- **Fix:**
  - Drop or mark `detail` stale when description, category or kind change (`detail.stale = true`), and exclude stale detail from `members`/`lb`.
  - `editedWhy` compares every priced field and the description to a server-stamped build snapshot.
  - The review list includes markup changes.
- **Test:** the E3 and E4 cases must each produce review entries.

**R11. MEDIUM (A). `=` formulas and editable derived fields.**
- If `=` is evaluated with `eval`/`new Function`, or if formula text is stored and re-evaluated for other users, that is stored script injection. The server already runs `new Function` on the engine (quote-api.ts:19), so the pattern is in the codebase.
- `type=number` inputs reject `=`. Switching to text inputs loses the decimal keypad on iPad and phone, and F2 / Ctrl+Backspace don't exist on mobile.
- NaN or Infinity from a formula serializes to `null`. `unitCost: null` flips priceManual onto the `unitSell` path (manual.ts:81), giving NaN or 0 prices.
- A's `deriveLine` on Kit push changes the price path. That needs C's fingerprint guard (A §9 admits cents drift).
- **Fix:**
  - Use a whitelist arithmetic parser (`0-9 . + - * / ( )`, length ≤ 64). Store only the number.
  - The server rejects non-finite or negative qty, cost or markup.
  - Fingerprint-test deriveLine on all 20 calibration jobs plus tier1.
- **Test:** `=1e400`, `=alert(1)`, `=2*`. Each must be rejected client- and server-side.

**R12. MEDIUM. Edits are lost on conflicts, revision switches and undo.**
- A 409 says "Reload" and the reload discards local work (quote-api.ts:77, Editor.tsx:38-46).
- The revision `<select>` calls `load()` with no dirty prompt (Editor.tsx:115).
- A's undo has no persistence. B's localStorage draft is keyed by `doc_version` and offers no merge.
- An undo stack that crosses a save, followed by a save, can re-trigger approvals.
- **Fix:**
  - Keep the draft in localStorage on 409, show a field-level diff against the server doc, and re-apply.
  - Add a dirty prompt on revision switch and navigation.
  - Undo clears at save, or is labeled "undo past save".
- **Test:** concurrent save from two tabs. Expect the second tab's edits still recoverable.

**R13. MEDIUM. Revise, won and change-order handling.**
- `revise` sets `status: doc_type === 'CONFIRMATION' ? 'won' : 'draft'` using the **body** doc_type (quote-api.ts:136). "Start new revision" on a locked confirmation (Editor.tsx:233 sends no doc_type) flips a **won job back to draft**.
- `revise` copies the highest rev, not the one on screen. B §7.6 "Start R2 with this change" from R1 while R2 exists replays the edit onto R2's content as a new R3.
- `CHANGE ORDER` exists (001_core.sql:60, QuotePdf) but has no flow. A CO made by revise prints the full job total as "Total Package Price", not a delta.
- **Fix:**
  - Status comes from the new revision's doc_type and never downgrades `won`.
  - `revise` takes `from_revision_id`.
  - Block CO editing until a delta basis (vs the confirmation) is designed and signed off.
- **Test:** win → confirmation → send → revise. Expect status `won`.

**R14. MEDIUM (C). Payload growth and deploy coupling.**
- +70 KB per save (E1), with `basis.text` duplicated in `doc` and `priced` (manual.ts:82/86 spread `...l`). Every save returns it and every revision keeps it.
- The engine file changes, but `ENGINE_VERSION` stays `'manual-1+cal1'` (quote-api.ts:25).
- bundle-api.mjs deletes old engine files and the SPA redirect serves `index.html` with 200 for a missing engine. Between the Netlify deploy and the Supabase deploy, cold edge instances fail every save ("Redeploy").
- **Fix:**
  - Strip `basis`/`detail`/`group` from `priced.lines` before storing.
  - Keep the previous engine file for one release.
  - Bump ENGINE_VERSION.
  - Deploy only when Kyle says so (CLAUDE.md).
- **Test:** size assertion (< 40 KB per item stored).

**R15. LOW-MEDIUM (C). Small correctness issues in the shown basis.**
- The runway row says "column" (E9; crane.ts:84).
- `sectionOf(...)!` (sections.ts:91) throws for an unknown category with a flag or edit.
- Unknown categories vanish from the tree and the total (E8).
- The dealer-discount reconcile is circular (E6), so the section walk can't add up to the PDF base.
- Plate box girder unity is 1.00 by construction (C §6.1; it breaks the 0.98 rule on 29562/28723). C correctly flags it.
- **Fix:**
  - Correct the cell label.
  - Add a "Dealer/GC discount −$X" and "1% dropped" row to `reconcile`, and assert `baseSections + onePct − discountEffect = quote.base`.
  - Reject unknown categories on save.
  - Schedule the `need/0.98` re-calibrate.

Not ranked, but the President should decide: **there is no approval for margin, markup or discount at all.**
- Today a rep can set markup to 0 or discount 30% unflagged.
- B's group markup and "Hit $84,500" and A's per-line $/lb override make this one keystroke.
- Recommend a `GM_BELOW_FLOOR` / `DISCOUNT_ABOVE_X` flag before shipping these.

---

## 3. Verdict: what must be true before shipping

**C's engine branch can merge** (display-only, prices proven unchanged) **if** it first does all of these:
1. Strips C fields from the stored `priced`.
2. Fixes the runway label.
3. Makes `members`/`review` honest about description, category and markup edits (R10).
4. Gets a coordinated, Kyle-approved deploy (R14).

**No editing UI from A or B ships until all of these are true:**
1. **Approval integrity (R1, R2, R5, R8).** The server derives install-hour flags, PV hours and suggestions itself, and a spec change with pins can't clear a flag. The flag detail is rounded, and `approve` is bound to `doc_version`. Add tests for every bypass in E4 and E5 plus the pin-and-shrink-spec case.
2. **Server-stamped evidence (R4).** detail, basis and builder baselines shown to managers come from the server's rebuild, never from the client.
3. **Edits survive (R3, R6, R7, R12).** Refs are keyed by a persistent item uid. Rebuild preserves edits and separates price-list drift from spec changes. A 409 or reload never loses typed work.
4. **One number everywhere (R9).** App rail, DB `total`, section reconcile and PDF agree to the cent under one rounding rule, and the PDF renders from the server's priced result.
5. **No eval (R11).** Formulas go through a whitelist parser, and the server rejects non-finite numbers.
6. **Won stays won (R13).** Revise uses an explicit source revision, and change orders stay blocked until delta pricing is specified.

Recommended order: C (with the fixes above) → server hardening (items 1, 2, 4, 6) → B steps 1-5 with uid refs → A/B UI.

---

## Top 10 (one line each)
1. R1 CRITICAL: deleting, moving or reclassifying site labor clears INSTALL_BELOW_SUGGESTED (manual.ts:115, Editor.tsx:153). Flag on suggestion > quoted regardless of lines.
2. R2 CRITICAL: spec is client-supplied; B's pins plus a spec-chip shrink lower the server's suggestion. Server compares the rebuild vs saved lines and flags spec changes with pins.
3. R3 HIGH: B refs keyed by item index move pins and suppressions onto the wrong item after an item delete or reorder (E10). Use a persistent item uid.
4. R4 HIGH: detail, basis, pin.base and autoValues are client-written and unchecked but shown as engineering fact. Server stamps them from its own rebuild.
5. R5 HIGH: switching the family dropdown zeroes Production Value ($3,138) with no flag (Editor.tsx:80/131). Server computes PV hours.
6. R6 HIGH: rebuild still drops edited auto lines (buildSpec.ts:68). C's "edited" badge implies safety that isn't there. Ship refs and pins first.
7. R7 HIGH: B's rebuild mixes steel_cost and price-list drift into a spec change (9 lines at +5%). Show price updates separately.
8. R8 HIGH: approval hash uses an order-dependent float (50 of 80 specs), CLASS_D `{}` never voids, approve has no doc_version, and approvals are deleted before the guarded update.
9. R9 HIGH: the PDF total is a sum of rounded rows from client-side priced, up to $1.74 off the stored total (QuotePdf.tsx:85, Editor.tsx:230). Render from the server's priced result with one rounding rule.
10. R10 MEDIUM-HIGH: C's members list shows the old beam after a shape swap, and the review list misses markup, category and kind edits (sections.ts:110-137).
