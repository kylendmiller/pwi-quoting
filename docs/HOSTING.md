# Where the quote app runs (since 2026-11-25)

- **Database:** Supabase project `cartygcdzbgajstpboxu` ("PWI Inventory System"), schema **`quoting`** (exposed in Data API settings).
  The old project `kiuwtbizrantrcyybkfw` is retired: its cron jobs are paused and its data was copied over 1:1 (row counts matched).
  Logins are the inventory project's (same accounts; old user ids were re-linked by email; qa-bot's rows went to Kyle).
- **Client:** `app/src/supabase.ts` uses the inventory project URL + publishable key and `db: { schema: 'quoting' }`.
- **Server functions** (deployed to the inventory project): quote-api, rfq-intake, airtable-sync, airtable-push — all create the
  admin client with `db: { schema: 'quoting' }`. Bundle with `npm run bundle:api` (builds all four into `dist/`).
- **Crons** (inventory project): `quoting-rfq-intake-poll`, `quoting-airtable-sync`, `quoting-airtable-push`, keys read from `quoting.sync_state`.
- **Secrets** (inventory project): `AIRTABLE_TOKEN`, `ANTHROPIC_API_KEY`, `MAIL_FROM`; email uses the inventory app's existing
  `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` (Graph app limited to the "PWI Inventory Senders" group). Never overwrite those.
- **Web:** Netlify site pwi-quotes (pwi-quotes.netlify.app) and, the main address, **pwiinventory.netlify.app/quotes/** (the inventory
  site proxies `/quotes/*` here). Assets use relative paths (`base: './'`) so both work. The inventory sidebar has it under "Additional apps".
- The pricing engine file is still served from pwi-quotes.netlify.app/engine/… (the server functions pin its SHA).
