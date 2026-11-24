-- Applied 2026-11-24 via Supabase MCP (airtable_sync_schema + customers_name_unique_app_only). Kept here for the record.
-- salespeople, sites, sync_state tables; customers/contacts airtable_id + fields; quotes.site_id;
-- customers name uniqueness only for app-entered customers (Airtable is master and can repeat names).
-- Cron: select cron.schedule('airtable-sync-15min','*/15 * * * *', <net.http_post to functions/v1/airtable-sync with x-sync-key from sync_state>);

-- 2026-11-24: rfq_intake (+ noted_at / emailed_at / emailed_to), quotes.rfq_number, search_customers(q) (fuzzy, trigram),
-- customers/contacts.push_error, customers.created_by default auth.uid(). Cron: rfq-intake-poll (*/15), airtable-push (5,20,35,50).
