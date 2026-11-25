// Airtable (Project Log base) → quote app sync.
// Every 15 minutes pg_cron calls this function. It pulls Employees, Customer Types, Customers, Contacts and
// Buildings records changed since the last good run (a full pull once a day, or when ?full=1) and upserts them
// by airtable_id. Airtable stays the master; the quote app only reads. Records the reps add in the quote app
// (source = 'app') are never touched.
// Auth: header x-sync-key must equal sync_state.key (only the service role can read it).
// Push mode (one-time seed): POST { push: { employees, customerTypes, customers, contacts, buildings } } with
// records shaped like Airtable's API ({ id, fields }) or the Airtable connector ({ id, cellValuesByFieldId }).
import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE = 'appi7MgUiiolgcHbB';
const T = { employees: 'tblJXUvXtsIbGoTOf', customerTypes: 'tblx7fjnf2DOV9nPq', customers: 'tblqqjvJlvzUqj6ad', contacts: 'tblD4Ccp9VGGCxxKK', buildings: 'tblO4iql7oEIomLUf' } as const;
const F = {
  emp: { name: 'fld3SIuor69TGBM3p', title: 'fld5G04CkFRVp5xdb', dept: 'fldvLvaRXFXit36IP', status: 'fldUz1XMbASDZWolG', email: 'fldT1Tikq3dX7Lglo' },
  ctype: { name: 'fldPInGBt4LsEB9Xo' },
  cust: { name: 'fldSt9rPluMXvOKoY', common: 'fldiZvBNmXvRIANBl', sales: 'fld7QPNx1rLnDkD1b', type: 'fldVhglsBUpzsJQCa', phone: 'fldjqOwQqn0su35Lv', web: 'fldJiyPtojTy0Mcnv', ap: 'fldWvC4D7kC4IHdHJ', dup: 'fldYzsyB46nV6qCk4' },
  con: { name: 'fldzXltoCnz1Qq1GR', company: 'fldDiNWji51wHnDfm', title: 'fldFxtic3q8bZ8I1v', email: 'fldmYigAn3XUeDcCp', phone: 'fldMqhc7pqwzxyxSV' },
  bld: { name: 'flde3EzBmRBLpQM3n', building: 'fld76DKCOp8eFgP21', company: 'fldgjPUYcQ6kY2L3z', contact: 'fldDNofrMMETNVzjg', a1: 'flduDV5VAZ7H7HfQm', a2: 'fldFQtxiE2LsmxYdA', city: 'fldkmoJrrgNAfZUIO', state: 'fldgHlDC5zsE4Dd0J', zip: 'fldJSMUdTV7Ed6rUQ', type: 'fldAbVopf5rwsBG8O', dist: 'fldtmObOivZE1vpnk', drive: 'fldELUg1SZAldfKo5', geo: 'fldXrzdGOf6ce1ldU' },
};
type Rec = { id: string; f: Record<string, any> };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

// ---- value helpers: accept both API ("recX", "Option") and connector ({id,name}) shapes
const txt = (v: any): string | null => {
  if (v == null) return null;
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === 'object') v = v.name ?? v.text ?? null;
  const s = String(v ?? '').trim();
  return s ? s : null;
};
const ids = (v: any): string[] => (Array.isArray(v) ? v : v ? [v] : []).map((x: any) => (typeof x === 'string' ? x : x?.id)).filter(Boolean);
const names = (v: any): string[] => (Array.isArray(v) ? v : []).map((x: any) => (typeof x === 'object' ? x?.name : null)).filter(Boolean);
const miles = (v: any) => { const n = parseFloat(String(txt(v) ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const norm = (r: any): Rec => ({ id: r.id, f: r.fields ?? r.cellValuesByFieldId ?? {} });

async function pull(table: string, since: string | null, fields: string[]): Promise<Rec[]> {
  const tok = Deno.env.get('AIRTABLE_TOKEN');
  if (!tok) throw new Error('AIRTABLE_TOKEN secret is not set');
  const out: Rec[] = []; let offset: string | undefined;
  do {
    const u = new URL(`https://api.airtable.com/v0/${BASE}/${table}`);
    u.searchParams.set('returnFieldsByFieldId', 'true'); u.searchParams.set('pageSize', '100');
    for (const f of fields) u.searchParams.append('fields[]', f);   // only what we map — the full rows are huge
    if (since) u.searchParams.set('filterByFormula', `IS_AFTER(LAST_MODIFIED_TIME(), '${since}')`);
    if (offset) u.searchParams.set('offset', offset);
    let res = await fetch(u, { headers: { authorization: `Bearer ${tok}` } });
    if (res.status === 429) { await new Promise(r => setTimeout(r, 30000)); res = await fetch(u, { headers: { authorization: `Bearer ${tok}` } }); }
    if (!res.ok) throw new Error(`Airtable ${table} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json(); out.push(...j.records.map(norm)); offset = j.offset;
    await new Promise(r => setTimeout(r, 220));   // stay under 5 requests/second
  } while (offset);
  return out;
}

async function upsert(db: any, table: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict: 'airtable_id' });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
async function idMap(db: any, table: string, atIds: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>(); const u = [...new Set(atIds)];
  for (let i = 0; i < u.length; i += 300) {
    const { data, error } = await db.from(table).select('id, airtable_id').in('airtable_id', u.slice(i, i + 300));
    if (error) throw new Error(`${table} lookup: ${error.message}`);
    for (const r of data) m.set(r.airtable_id, r.id);
  }
  return m;
}

async function apply(db: any, d: { employees: Rec[]; customerTypes: Rec[]; customers: Rec[]; contacts: Rec[]; buildings: Rec[] }) {
  const now = new Date().toISOString();
  // salespeople = employees (all; inactive kept for history)
  await upsert(db, 'salespeople', d.employees.filter(r => txt(r.f[F.emp.name])).map(r => ({
    airtable_id: r.id, full_name: txt(r.f[F.emp.name]), email: txt(r.f[F.emp.email]), title: txt(r.f[F.emp.title]),
    department: txt(r.f[F.emp.dept]), active: (txt(r.f[F.emp.status]) ?? 'Active') !== 'Inactive', updated_at: now })));
  // customer types: id → name (connector shape already carries names)
  let typeName = new Map(d.customerTypes.map(r => [r.id, txt(r.f[F.ctype.name])]));
  if (d.customers.length && !typeName.size && d.customers.some(r => ids(r.f[F.cust.type]).length && !names(r.f[F.cust.type]).length)) {
    typeName = new Map((await pull(T.customerTypes, null, Object.values(F.ctype))).map(r => [r.id, txt(r.f[F.ctype.name])]));
  }
  const sp = await idMap(db, 'salespeople', d.customers.flatMap(r => ids(r.f[F.cust.sales])));
  // adopt customers that were typed into the quote app before the sync, by exact name
  const { data: appCust } = d.customers.length ? await db.from('customers').select('id, name').is('airtable_id', null) : { data: [] };
  const appByName = new Map((appCust ?? []).map((c: any) => [c.name.trim().toLowerCase(), c.id]));
  const custRows = d.customers.filter(r => txt(r.f[F.cust.name])).map(r => {
    const name = txt(r.f[F.cust.name])!;
    const ct = names(r.f[F.cust.type]).length ? names(r.f[F.cust.type]) : ids(r.f[F.cust.type]).map(i => typeName.get(i)).filter(Boolean);
    return { airtable_id: r.id, name, common_name: txt(r.f[F.cust.common]), phone: txt(r.f[F.cust.phone]), website: txt(r.f[F.cust.web]),
      ap_email: txt(r.f[F.cust.ap]), customer_type: ct.join(', ') || null, salesperson_id: sp.get(ids(r.f[F.cust.sales])[0]) ?? null,
      duplicate_of_airtable_id: ids(r.f[F.cust.dup])[0] ?? null, source: 'airtable', updated_at: now, _adopt: appByName.get(name.toLowerCase()) };
  });
  for (const c of custRows.filter(c => c._adopt)) await db.from('customers').update({ airtable_id: c.airtable_id }).eq('id', c._adopt).is('airtable_id', null);
  await upsert(db, 'customers', custRows.map(({ _adopt, ...c }) => c));
  // contacts
  const cust = await idMap(db, 'customers', [...d.contacts.flatMap(r => ids(r.f[F.con.company])), ...d.buildings.flatMap(r => ids(r.f[F.bld.company]))]);
  // contacts must belong to a customer in the quote app; the few with no company in Airtable are skipped
  await upsert(db, 'contacts', d.contacts.filter(r => (txt(r.f[F.con.name]) || txt(r.f[F.con.email])) && cust.has(ids(r.f[F.con.company])[0])).map(r => ({
    airtable_id: r.id, customer_id: cust.get(ids(r.f[F.con.company])[0]) ?? null, name: txt(r.f[F.con.name]) ?? txt(r.f[F.con.email]),
    title: txt(r.f[F.con.title]), email: txt(r.f[F.con.email]), phone: txt(r.f[F.con.phone]), source: 'airtable', updated_at: now })));
  // buildings → sites
  const con = await idMap(db, 'contacts', d.buildings.flatMap(r => ids(r.f[F.bld.contact])));
  await upsert(db, 'sites', d.buildings.filter(r => txt(r.f[F.bld.name]) || txt(r.f[F.bld.building])).map(r => {
    const [lat, lng] = String(txt(r.f[F.bld.geo]) ?? '').split(',').map(Number);
    return { airtable_id: r.id, customer_id: cust.get(ids(r.f[F.bld.company])[0]) ?? null, contact_id: con.get(ids(r.f[F.bld.contact])[0]) ?? null,
      name: txt(r.f[F.bld.name]) ?? txt(r.f[F.bld.building]), building: txt(r.f[F.bld.building]), location_type: txt(r.f[F.bld.type]),
      address1: txt(r.f[F.bld.a1]), address2: txt(r.f[F.bld.a2]), city: txt(r.f[F.bld.city]), state: txt(r.f[F.bld.state]), zip: txt(r.f[F.bld.zip]),
      lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null,
      miles_from_pwi: miles(r.f[F.bld.dist]), drive_seconds: Number(r.f[F.bld.drive]) || null, source: 'airtable', updated_at: now };
  }));
  return { salespeople: d.employees.length, customers: d.customers.length, contacts: d.contacts.length, sites: d.buildings.length };
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false }, db: { schema: 'quoting' } });
  const { data: st } = await db.from('sync_state').select('*').eq('name', 'airtable').single();
  if (!st?.key || req.headers.get('x-sync-key') !== st.key) return json({ error: 'forbidden' }, 403);
  const started = new Date();
  await db.from('sync_state').update({ last_run_at: started.toISOString() }).eq('name', 'airtable');
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    let counts;
    if (body.push) {
      const p = body.push, n = (a: any[]) => (a ?? []).map(norm);
      counts = await apply(db, { employees: n(p.employees), customerTypes: n(p.customerTypes), customers: n(p.customers), contacts: n(p.contacts), buildings: n(p.buildings) });
    } else {
      const full = new URL(req.url).searchParams.get('full') === '1' || body.full || !st.last_full_at || Date.now() - Date.parse(st.last_full_at) > 24 * 3600e3;
      const since = full || !st.last_ok_at ? null : new Date(Date.parse(st.last_ok_at) - 10 * 60e3).toISOString();
      // one table at a time keeps memory low: each pass upserts and lets go of its records
      const empty = { employees: [] as Rec[], customerTypes: [] as Rec[], customers: [] as Rec[], contacts: [] as Rec[], buildings: [] as Rec[] };
      const c1 = await apply(db, { ...empty, employees: await pull(T.employees, since, Object.values(F.emp)) });
      const c2 = await apply(db, { ...empty, customers: await pull(T.customers, since, Object.values(F.cust)) });
      const c3 = await apply(db, { ...empty, contacts: await pull(T.contacts, since, Object.values(F.con)) });
      const c4 = await apply(db, { ...empty, buildings: await pull(T.buildings, since, Object.values(F.bld)) });
      counts = { salespeople: c1.salespeople, customers: c2.customers, contacts: c3.contacts, sites: c4.sites, mode: full ? 'full' : 'changes' };
      if (full) await db.from('sync_state').update({ last_full_at: started.toISOString() }).eq('name', 'airtable');
    }
    await db.from('sync_state').update({ last_ok_at: started.toISOString(), last_error: null, counts }).eq('name', 'airtable');
    return json({ ok: true, counts });
  } catch (e) {
    await db.from('sync_state').update({ last_error: String((e as Error).message ?? e).slice(0, 500) }).eq('name', 'airtable');
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
