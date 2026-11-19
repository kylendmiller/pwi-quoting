# Round 2 brief: make PWI quoting faster, smoother, more accurate

## Who and what
Kyle Miller is President of PWI Corp, a crane, mezzanine and structural steel manufacturer in Nappanee, IN. He is not a coder.

He wants a salesperson to say the job ("FSTRGM5, 30' span, 80' long, 20' tall, radio, pink columns, install in Milwaukee") and get a complete, correct, ready-to-send quote with almost no clicking. He loved v1 and wants it better, cleaner, faster and more streamlined.

The company is only ever called PWI or PWI Corp.

## What exists today (v1, live)

Repo: /home/claude/pwi-quoting (read-only for you unless told otherwise).

- `src/engine/`: a pure TypeScript pricing engine.
  - `manual.ts`: priceManual, flags, lint.
  - `rollup.ts`: reproduces the Sales Main Template rollup exactly.
  - `lines.ts`
  - `freestanding.ts`: the auto-builder. It turns a spec into QuoteLines plus wording. Steel uses default sizes by capacity.
- `tests/`:
  - tier1 reproduces 42 sold SMT quotes exactly.
  - `freestanding.test.ts` rebuilds sold job 29140 within 7%.
- `server/quote-api.ts`: a Supabase edge function with these actions:
  - price, create, save, approve, send, revise, win, set_role
  - Save uses optimistic versioning. Approvals are hash-bound. Sent revisions are locked.
- `db/`: the Postgres schema, RLS and seeds. Reference data comes from the Sales Main Template: std_parts, vendor_parts, steel_shapes, rate_items, labor_ops, and settings including production/install factors.
- `app/`: React + Vite on Netlify (pwi-quotes.netlify.app). Main files:
  - `Editor.tsx`: line-item editor with quick-add.
  - `ImportSpec.tsx`: the "Paste from Claude" box.
  - `QuotePdf.tsx`: react-pdf.
  - Also Approvals and Admin.
- `skill/pwi-quote/SKILL.md`: the Claude skill. It asks for the missing fields, then outputs a JSON spec that the rep pastes into the app.
- `fixtures/*.json`: 50 sold quotes, each with all SMT cells and wording. Use these as calibration data.
- `reference/*.json`: price lists.
- `/home/claude/build/`: round-1 design proposals and reviews, plus `findings_pass1.md` (the deep analysis of sold quotes, with the quote wording rules).

## Today's flow and its pain, observed in Kyle's first real use
1. The rep runs the skill in a Claude chat and answers 4 multiple-choice questions.
2. The rep copies a JSON block, opens the app, clicks New Quote, picks a customer, and finds the paste box. The browser had cached the old app, so the box was missing until a hard refresh. The rep pastes, clicks Build, then clicks Save.

What the build got wrong or missed, each fixed by hand afterwards:
- Custom paint color (pink columns): the builder ignores it.
- Lodging and per diem for a week-long out-of-town install.
- Lift / equipment rental.
- "20' tall" means overall height. The builder sizes columns from hook height, so the system ends up taller than 20'.
- Steel sizes are capacity defaults, not engineered or taken from similar sold jobs.

Other gaps:
- Only freestanding is automated. Bridge, gantry, monorail, jib, mezzanine and stairs are not.
- No customer or contact capture from the conversation.
- Install suggestion is very rough.
- Wording is a single hard-coded template.

Fixed constraints:
- Kyle's numbers stay editable settings.
- Install below the suggested amount needs manager approval.
- Sent quotes are locked.
- Salespeople never get the service key.
- Supabase + Netlify are temporary. Everything moves into a rebuilt company portal later, so keep the engine portable.

Tools on hand:
- Supabase: edge functions, Postgres, and an OAuth server, so a remote MCP connector for claude.ai with per-user OAuth is possible.
- Netlify.
- Claude skills.
- An Anthropic API key could be added as an edge-function secret if justified.

## Your output
Write your proposal or review to /home/claude/build2/<your file>. Keep it concrete:
- what changes
- why it's faster or more correct
- exact files and functions
- data needed
- risks
- an ordered build plan with what ships TODAY vs later

Under 1,200 words. Prefer cutting steps over adding features.
