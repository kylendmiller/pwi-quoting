# Proposal A: from "rep says the job" to "draft quote with customer", with no copy/paste

## Today vs target
**Today (about 9 actions):** run the skill, answer questions, copy the JSON, open the app, (hard refresh), click New Quote, pick or type a customer, add a contact, find the paste box, paste, click Build, click Save.

**TODAY's build (4 actions):** say the job, answer one question round, tap **Open draft quote**, tap **Create draft**. You land in the Editor with the quote saved and priced, and the customer and contact attached.

**LATER (3 actions, no app hop until review):** say the job, answer one question round, tap the quote link Claude returns. Claude already knows the quote number and total, and any flags.

## Options judged

| | Rep steps | Build time | Security | Portal portability | Phone / voice |
|---|---|---|---|---|---|
| (a) MCP connector + Supabase OAuth | 3 | 2–4 days. OAuth/DCR setup is the long pole. | Good. Per-user token, draft-only tools, no keys on the client. | Best. The tools become the portal's API. | Best. Works in claude.ai mobile and voice once the admin adds the connector. |
| (b) "Describe the job" box in the app | 3–4 | 3–5 days. Needs chat UI, follow-up questions and streaming. | Anthropic key sits server-side, but it is a new spend and abuse surface. | Medium. A second conversation stack to maintain. | Weak. No voice unless we build it. Duplicates what Claude already does well. |
| (c) Deep link `#/build?s=…` | 4 | Under 1 day | Good. The rep's own session calls the server, and the confirm tap blocks drive-by links. | Good, if the engine call is server-side (below). | Good. A tap on a phone opens the app. Voice mode shows the link afterwards. |
| (d) c now, then a | 4 now, 3 later | Under 1 day, then 2–4 days | Good | Best | Good, then best |

**Pick: (d).** Ship **(c) TODAY**, built on a **server-side `build` action** that (a) reuses unchanged **LATER**. Reject (b): it rebuilds Claude inside our app, adds a key and spend, and saves no step over (a).

## Core change: the engine runs on the server (shared by c and a)

**New `src/engine/catalog.ts`.** Move `loadCatalog` out of `app/src/ImportSpec.tsx` and make it take a Supabase client:
`loadCatalog(db, settings): Promise<Catalog>`.
The server caches the result in module scope for 60 s, because it pulls about 5k `vendor_parts` rows.

**New `src/engine/buildSpec.ts`** (pure and portable):
`buildFromSpec(spec, catalog, settings, baseDoc) → { doc, header, notes }`.
It is today's `ImportSpec.run()` loop. Other fixes (paint, lodging, lift, overall height) land here, so every client gets them.

**`server/quote-api.ts` changes:**
- Extract the body of `case 'save'` into `persistRevision(admin, revisionId, doc, docVersion, header, uid)`.
- Add the actions below.

### `build` (creates a draft only, never sends or approves)
Request:
```json
{ "action": "build", "ref": "9f2c1e7a-…", "dry_run": true,
  "spec": { "pwi_quote": 2, "project": "FSTRGM5 Crane System", "location": "Milwaukee, WI", "brand": "PWI",
    "customer": { "name": "Acme Fab", "city": "Milwaukee", "state": "WI",
                  "contact": { "name": "Jim Ross", "email": "jim@acmefab.com", "phone": "414-555-0100" } },
    "items": [ { "type": "freestanding", "series": "GM", "capacityTons": 5, "...": "..." } ] },
  "customer_id": null, "contact_id": null, "create_customer": false, "quote_id": null }
```

Response to `dry_run: true` (writes nothing):
```json
{ "customer": { "status": "exact|fuzzy|new", "id": "uuid|null", "name": "Acme Fabrication Inc",
                "candidates": [ { "id": "uuid", "name": "Acme Fabrication Inc", "score": 0.71 } ] },
  "contact":  { "status": "exact|new", "id": "uuid|null", "name": "Jim Ross" },
  "preview":  { "total": 84210, "base": 61200, "installation": 18900, "flags": [], "notes": ["Item 1: assumed radio"] } }
```

Response to a real build (`200`):
```json
{ "quote": { "id": "uuid", "quote_number": "Q-26-0142" }, "revision": { "id": "uuid", "doc_version": 1 },
  "url": "https://pwi-quotes.netlify.app/#/q/<id>", "total": 84210, "flags": [], "notes": [], "reused": false }
```

`409 { "error": "customer_ambiguous", "candidates": [...] }` comes back when the match is fuzzy and the request has neither `customer_id` nor `create_customer: true`.

**How the server runs a build:**
1. Resolve the customer and contact.
2. `create` the quote and rev 0.
3. Run `buildFromSpec`.
4. Run `persistRevision`, which prices the quote, writes flags and sets status. INSTALL_BELOW_SUGGESTED behaves as it does today.
5. Write the `created` event, with `source: "link" | "mcp" | "paste"`.

If `quote_id` is set, the build appends to that quote's unlocked latest revision. This replaces the in-browser engine in `ImportSpec`.

**Idempotency:** `ref` is unique. A second tap on the same link returns the existing quote with `reused: true`.

### Migration `db/migrations/004_build.sql`
- Enable the `pg_trgm` extension and add `create index customers_name_trgm on customers using gin (lower(name) gin_trgm_ops)`.
- Add three columns to `quotes`: `source_ref text unique`, `source_spec jsonb` and `source text`.
- Add the function `match_customer(q text) returns table(id uuid, name text, score real)`:
  - `security invoker`, so RLS still applies.
  - Returns the top 5 by `similarity(lower(name), lower(q))`, with a floor of 0.3.
  - Match rule: `exact` means lower(name) is equal, or score ≥ 0.9. `fuzzy` means score 0.45–0.9. `new` means anything lower.
- Contact rule: match on email within the customer, then on lower(name). Otherwise insert a new contact.

## Capturing the customer and contact from the conversation
In `skill/pwi-quote/SKILL.md`:
- Bump the spec to `pwi_quote: 2` and add the `customer` block shown above. `brand` is optional and defaults to PWI. `StairZone` is used when the job is stairs.
- Make **customer name** a required field, asked in the same single question round. Contact name, email and phone are optional and are only taken from what the rep already said or attached, such as an email signature or a drawing title block.
- The job location city doubles as the customer city when the rep says "for Acme in Milwaukee".
- Claude never invents a customer.

## TODAY: the deep link

**Skill output.** The skill still shows the JSON block, which keeps the paste-box fallback. It then adds one line:
`**[Open draft quote →](https://pwi-quotes.netlify.app/#/build?s=<payload>)**`

**Building `<payload>`:** add the bundled script `skill/pwi-quote/scripts/link.py`. It validates the spec against required fields, adds `ref` (uuid4), compacts the JSON and makes it base64url, then prints the URL. If the chat has no code tool, the skill writes compact JSON (no spaces), percent-encoded. The app parser accepts base64url, URI-encoded or raw JSON.

**App changes:**
- `main.tsx`:
  - Route `route.startsWith('/build')` to the new `FromLink`.
  - Change `route === '/new'` to `startsWith('/new')`.
  - Before rendering `<Login/>`, copy `?s=` into `sessionStorage['pending_spec']`, so a rep who has to sign in first still lands back on the build.
- New `app/src/FromLink.tsx`:
  1. Decode the spec and call `build` with `dry_run`.
  2. Show one card with these fields:
     - Customer: "Matched: Acme Fabrication Inc". If the match is fuzzy, show radio buttons for the candidates plus "New: Acme Fab".
     - Contact
     - Project and location
     - Total preview
     - Notes and flags
  3. **One tap on Create draft** sends `build` with the chosen `customer_id` or `create_customer`. Then navigate with `location.replace('#/q/'+id)`, which strips the spec from history.
- `ImportSpec.tsx` becomes a thin call to `api('build', { spec, quote_id, ref })` and the client-side engine is dropped. The paste box stays as a fallback.

**Security:** the link carries only job inputs, in the URL fragment (never in Netlify logs). Nothing happens without the rep's session and the confirm tap. The server re-prices everything, so an edited link cannot set prices. No new keys.

## TODAY: cache-busting and auto-update

1. In `netlify.toml`:
   - Set `Cache-Control: no-cache` on `/index.html` and `/*` (the HTML).
   - Set `/assets/*` to `public, max-age=31536000, immutable`. Vite already hashes the asset file names.
2. In `vite.config.ts`:
   - Add `define: { __BUILD__: JSON.stringify(Date.now().toString(36)) }`.
   - Add a small plugin that writes `dist/app/version.json` as `{"build":"…"}`.
3. Add `app/src/useUpdate.ts`:
   - On window focus, on `hashchange` and every 5 minutes, fetch `/version.json?t=now` with `cache:'no-store'`.
   - If the build differs: reload immediately when the Editor has no unsaved changes, otherwise show the banner "New version ready, Reload".
   - Unknown routes also trigger a one-time reload. A stale app that hits `#/build` self-heals.
4. There is no service worker, and none should be added.

## LATER: remote MCP connector `pwi-mcp`

**Server:** a Supabase edge function `server/pwi-mcp.ts` that speaks MCP over Streamable HTTP (`POST /functions/v1/pwi-mcp`). It uses Supabase Auth's OAuth 2.1 server with dynamic client registration, so each rep authorizes once as themselves. The function verifies the bearer token with `admin.auth.getUser`, checks the role exactly as `quote-api` does, then calls the **same** `build` internals.

**Tools.** All are drafts only. None of them send, approve or change settings.
- `find_customer({ query }) → { candidates:[{id,name,city,state,score}], contacts? }`
- `preview_quote({ spec }) → { total, base, installation, flags, notes }` lets Claude say "about $84k, install flagged" before anything is created.
- `build_quote({ spec, customer_id?, create_customer?, ref }) → { quote_number, url, total, flags, notes }`
- `get_quote({ quote_number }) → { status, total, flags, url }` covers "what did I quote Acme?" and revision follow-ups.

**Skill.** When the `pwi-mcp` tools are present, the skill calls them and replies with the quote link and number. If not, it falls back to the deep link.

**Setup.** The admin adds the connector once for the org, and each rep signs in once. After that it works in claude.ai on phone and in voice mode with no app hop until review.

**Portal move:** the portal hosts the same tools behind its own OAuth; the skill is unchanged.

## Risks
- **Hand-encoding.** Claude encodes long URLs badly without a code tool. Mitigations: the bundled script, a tolerant parser, the paste fallback, and spec version validation that gives a clear error.
- **Customer duplicates.** Fuzzy matching and the confirm tap limit them. A `customers.server_folder` mismatch stays a manual check.
- **Supabase OAuth server maturity.** It is the reason MCP is LATER and not TODAY. If DCR blocks claude.ai, fall back to a static OAuth client registered in the connector settings.

## Build order
**TODAY**
1. Add `netlify.toml` headers, `version.json` and `useUpdate.ts`, and deploy first.
2. Write `catalog.ts` and `buildSpec.ts` by moving code out of ImportSpec. Run the existing tests plus a parity test: server build equals the old client build for 5 fixtures.
3. Apply migration 004 and add `match_customer`.
4. Add `persistRevision` and the `build` action in `quote-api.ts`.
5. Add `FromLink.tsx`, the `main.tsx` routes and the pending-spec stash. Thin out `ImportSpec`.
6. Update SKILL.md to spec v2 with the customer block, link output and `scripts/link.py`.
7. Phone smoke test: say the job, tap link, tap Create draft, Editor opens.

**LATER (next week)**
8. Turn on Supabase OAuth and DCR, build `pwi-mcp.ts` with its 4 tools, and add the connector in claude.ai.
9. Update the skill to prefer MCP, then retire the deep link once every rep has connected.
