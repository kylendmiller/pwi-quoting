// Supabase Edge Function "airtable-push": customers (and their contacts) that reps create in the quote app go into
// Airtable, so Airtable stays the master list. Every 15 min (pg_cron). Before creating, it looks for the same name in
// Airtable (periods/commas ignored, like Airtable's own cleanup) and links to that record instead.
// Only customers created after PUSH_FROM are pushed (older app-only rows are tests). Auth: x-intake-key.
// @ts-ignore deno import
import { createClient } from 'npm:@supabase/supabase-js@2';
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

const BASE = 'appi7MgUiiolgcHbB', CUST = 'tblqqjvJlvzUqj6ad', CON = 'tblD4Ccp9VGGCxxKK';
const F = { custName: 'fldSt9rPluMXvOKoY', custSales: 'fld7QPNx1rLnDkD1b', conName: 'fldzXltoCnz1Qq1GR', conCompany: 'fldDiNWji51wHnDfm', conEmail: 'fldmYigAn3XUeDcCp', conPhone: 'fldMqhc7pqwzxyxSV' };
const PUSH_FROM = '2026-11-24T10:15:00Z';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const clean = (s: string) => s.replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: st } = await db.from('sync_state').select('key').eq('name', 'rfq-intake').single();
  if (!st?.key || req.headers.get('x-intake-key') !== st.key) return json({ error: 'Bad key' }, 401);
  const tok = Deno.env.get('AIRTABLE_TOKEN'); if (!tok) return json({ error: 'AIRTABLE_TOKEN not set' }, 500);
  const at = (path: string, init: RequestInit = {}) => fetch(`https://api.airtable.com/v0/${BASE}/${path}`, { ...init, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const out: any[] = [];

  const { data: custs } = await db.from('customers').select('id, name, created_by, salesperson_id')
    .is('airtable_id', null).gte('created_at', PUSH_FROM).is('push_error', null).limit(10);
  for (const c of custs ?? []) {
    try {
      const name = clean(c.name);
      // same name already in Airtable? link to it
      const f = encodeURIComponent(`LOWER(SUBSTITUTE(SUBSTITUTE({Name}, '.', ''), ',', '')) = '${name.toLowerCase().replace(/'/g, "\\'")}'`);
      const ex = await (await at(`${CUST}?filterByFormula=${f}&pageSize=1&returnFieldsByFieldId=true`)).json();
      let id: string | undefined = ex.records?.[0]?.id, how = 'linked to existing';
      if (!id) {
        const sp = c.salesperson_id ? (await db.from('salespeople').select('airtable_id').eq('id', c.salesperson_id).maybeSingle()).data
          : c.created_by ? (await db.from('salespeople').select('airtable_id').eq('user_id', c.created_by).maybeSingle()).data : null;
        const fields: Record<string, unknown> = { [F.custName]: name };
        if (sp?.airtable_id) fields[F.custSales] = [sp.airtable_id];
        const r = await at(CUST, { method: 'POST', body: JSON.stringify({ fields, typecast: true }) });
        const j = await r.json(); if (!r.ok) throw new Error(`Airtable ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
        id = j.id; how = 'created';
      }
      // if another quote-app row already holds this Airtable id (the sync got there first), fold this one into it
      const { data: twin } = await db.from('customers').select('id').eq('airtable_id', id).maybeSingle();
      if (twin) {
        for (const t of ['quotes', 'contacts', 'sites']) await db.from(t).update({ customer_id: twin.id }).eq('customer_id', c.id);
        await db.from('customers').delete().eq('id', c.id);
        out.push({ customer: c.name, airtable: id, how: `${how}; merged into the synced copy` });
        continue;
      }
      await db.from('customers').update({ airtable_id: id, source: 'airtable' }).eq('id', c.id);
      out.push({ customer: c.name, airtable: id, how });
    } catch (e) {
      await db.from('customers').update({ push_error: (e as Error).message.slice(0, 300) }).eq('id', c.id);
      out.push({ customer: c.name, error: (e as Error).message });
    }
  }

  // contacts added in the app under a customer that is in Airtable
  const { data: cons } = await db.from('contacts').select('id, name, email, phone, customers!inner(airtable_id)')
    .is('airtable_id', null).gte('created_at', PUSH_FROM).not('customers.airtable_id', 'is', null).is('push_error', null).limit(20);
  for (const k of cons ?? []) {
    try {
      const fields: Record<string, unknown> = { [F.conName]: k.name, [F.conCompany]: [(k as any).customers.airtable_id] };
      if (k.email) fields[F.conEmail] = k.email;
      if (k.phone) fields[F.conPhone] = k.phone;
      const r = await at(CON, { method: 'POST', body: JSON.stringify({ fields, typecast: true }) });
      const j = await r.json(); if (!r.ok) throw new Error(`Airtable ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
      await db.from('contacts').update({ airtable_id: j.id, source: 'airtable' }).eq('id', k.id);
      out.push({ contact: k.name, airtable: j.id });
    } catch (e) {
      await db.from('contacts').update({ push_error: (e as Error).message.slice(0, 300) }).eq('id', k.id);
      out.push({ contact: k.name, error: (e as Error).message });
    }
  }
  return json({ pushed: out });
});
