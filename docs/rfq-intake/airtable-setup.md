# RFQ auto-quote — Airtable setup (needs a base creator)

The quote app already drafts a quote for every new website RFQ (it checks Airtable every 15 minutes).
This automation puts the quote link on the RFQ and emails the salesperson. About 10 minutes in the
Project Log base, by someone with **Creator** access (Kyle's connection only has Editor).

## 1. Add two fields to the RFQs table
| Name | Type |
|---|---|
| Draft Quote | URL |
| Draft Quote Note | Long text |

## 2. New automation: "Draft quote from website RFQ"

**Trigger: When a record matches conditions**, table **RFQs**, all of:
- Salesman — is not empty
- autoRFQ_SubmissionId — is not empty
- Confidence Score  - Seriousness — is not empty
- Draft Quote — is empty
- Draft Quote Note — is empty
- Created On — is on or after — exact date 11/24/2026

**Action 1: Run a script.** Input variable `recordId` = Airtable record ID (from the trigger). Paste:

```js
const { recordId } = input.config();
const KEY = '__INTAKE_KEY__';
const res = await fetch('https://kiuwtbizrantrcyybkfw.supabase.co/functions/v1/rfq-intake', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-intake-key': KEY },
  body: JSON.stringify({ rfq: recordId }),
});
const r = await res.json();
const table = base.getTable('RFQs');
await table.updateRecordAsync(recordId, {
  'Draft Quote': r.link ?? null,
  'Draft Quote Note': r.note ?? (r.error ? `Auto-quote failed: ${r.error}` : ''),
});
output.set('status', r.status ?? 'error');
output.set('link', r.link ?? '');
output.set('note', r.note ?? '');
output.set('total', r.total ? '$' + Math.round(r.total).toLocaleString() : '');
```

**Action 2: Conditional group** — only if script output `status` is `drafted`:

**Send email**
- To: *Primary Email (from Salesman)* (from the trigger record)
- Subject: `Draft quote ready — {RFQ Number} {customerString}`
- Message:
  ```
  A draft quote was built from website RFQ {RFQ Number} for {customerString}.

  Draft total: {total}
  Open and edit: {link}

  Assumed — check these: {note}

  It's a starting point: change anything, then save and send from the quote app.
  ```

Turn it on. RFQs created before 11/24/2026 are never touched.

## What gets skipped (the note says why)
Spam / not serious (AI score under 50%), stairs (StairZone), decking, AERO work cells, and RFQs without a
product and size. Free-text RFQs ("2 × 15 t, 80 × 30 × 18") need the Claude API key on the quote app's
server (Supabase secret `ANTHROPIC_API_KEY`); until it's added only Crane Configurator RFQs are drafted.
