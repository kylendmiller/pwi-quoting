# RFQ auto-quote — remaining setup (no Airtable creator needed)

The quote app drafts a quote for each new website RFQ every 15 minutes. Then it tells the salesperson in two ways:
1. It adds "Draft quote (auto, $X): link" to the RFQ's notes (rfqDetails) in Airtable.
2. It emails the assigned salesperson from a PWI Microsoft 365 mailbox.

Until these are set up, each step waits and retries on its own for 3 days.

## A. Airtable token (Kyle, 1 minute)
airtable.com/create/tokens → the token used for the quote app's sync → Scopes → add **data.records:write** → Save.
The token itself doesn't change, so there's nothing to update in Supabase.

## B. Microsoft 365 sending (Aaron / Phil)
1. Entra ID → App registrations: use the quote app's registration (or a new one, e.g. "PWI Quote App").
2. API permissions → Microsoft Graph → **Application** permission **Mail.Send** → Grant admin consent.
3. Recommended: limit it to one mailbox with an Exchange application access policy
   (New-ApplicationAccessPolicy -AccessRight RestrictAccess -AppId <client id> -PolicyScopeGroupId <group with the mailbox>).
4. Certificates & secrets → New client secret.
5. Mailbox to send from, e.g. quotes@pwiworks.com (a shared mailbox is fine).
6. Supabase → project cartygcdzbgajstpboxu (PWI Inventory System; the quote app moved here 11/25, schema quoting) → Edge Functions → Secrets, add:
   - MS_TENANT_ID — Directory (tenant) ID
   - MS_CLIENT_ID — Application (client) ID
   - MS_CLIENT_SECRET — the secret value
   - MAIL_FROM — the sending mailbox address

## C. Free-text RFQs (optional)
Add a Supabase secret named ANTHROPIC_API_KEY with a key from console.anthropic.com. Without it, only Crane Configurator RFQs are drafted.
