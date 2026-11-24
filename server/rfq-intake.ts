// Supabase Edge Function "rfq-intake": a website RFQ in Airtable → a draft quote in the quote app.
// Called by the Airtable automation "Draft quote from website RFQ" once the RFQ has a salesperson and its AI scores.
//   POST { rfq: "recXXXX", dryRun?: true, force?: true }  or  { poll: true } (pg_cron, every 15 min)   header x-intake-key = sync_state('rfq-intake').key
// Returns { status: 'drafted' | 'skipped' | 'error', link?, note, total? } — the Airtable script writes link/note back
// onto the RFQ and emails the salesperson. One quote per RFQ: a repeat call returns the same quote.
// Spec: configurator fields map directly (engine rfq.ts); anything else goes to Claude with the pwi-quote skill text
// when ANTHROPIC_API_KEY is set. Owner: the RFQ's salesperson when they have an app account, else the first admin.
// @ts-ignore deno import
import { createClient } from 'npm:@supabase/supabase-js@2';
import type * as Engine from './engine-entry';

declare const __ENGINE_URL__: string, __ENGINE_SHA__: string;
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };
let enginePromise: Promise<typeof Engine> | null = null;
const engine = () => enginePromise ??= (async () => {
  const code = await (await fetch(__ENGINE_URL__)).text();
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  const got = [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
  if (got !== __ENGINE_SHA__) { enginePromise = null; throw new Error('Pricing engine file does not match this server version. Redeploy.'); }
  new Function(code)();
  return (globalThis as any).PWIEngine;
})();

const ENGINE_VERSION = 'manual-1+cal1+r3s';
const APP = 'https://pwi-quotes.netlify.app';
const BASE = 'appi7MgUiiolgcHbB', RFQS = 'tblxsyDWugUp37ETX';
const F = {
  details: 'fldQF9M9IvNhUyJK2', number: 'fldJlBjRborP75zNC', salesman: 'fldSjUwCjIVUBrI0E', customer: 'fldkleYXwPPn38bFR',
  contact: 'fldHInGSLaBY46oCO', serious: 'fld0cgnVHk0C4TCRp', real: 'fld0jrYlYFLIiGGf9', brand: 'fldlq3SWw6Js7fhes',
  product: 'fldWB71mZALdekSfH', submission: 'fldIVumkwnXybT2JQ', custName: 'fldW7xoOoWgOiQEOV', attachments: 'fldigLz2yu105tZBZ',
  notes: 'fldc1R1cCsXCIcLtJ', salesEmail: 'fldAyoRBTm2dACXYI',
};
const MIN_SCORE = 50;
const MODEL = 'claude-sonnet-5-5';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const first = (v: any) => (Array.isArray(v) ? v[0] : v);
const idOf = (v: any) => { const x = first(v); return typeof x === 'string' ? x : x?.id; };
const text = (v: any) => { const x = first(v); return x == null ? '' : typeof x === 'object' ? (x.value ?? x.name ?? '') : String(x); };

const GO_LIVE = '2026-11-24T09:00:00Z';   // RFQs created before this are never auto-quoted
const POLL_MAX = 5;                          // per run (each can take a Claude call)

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: st } = await admin.from('sync_state').select('key').eq('name', 'rfq-intake').single();
  if (!st?.key || req.headers.get('x-intake-key') !== st.key) return json({ error: 'Bad key' }, 401);
  const body = await req.json().catch(() => ({}));
  try { if (body.poll) return json(await poll(admin)); } catch (e) { return json({ error: (e as Error).message }, 500); }
  const rfqId = String(body.rfq ?? '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(rfqId)) return json({ error: 'rfq must be an Airtable record id' }, 400);
  return json(await intake(admin, rfqId, !!body.dryRun, !!body.force));
});

/** Every 15 min (pg_cron): website RFQs created since go-live in the last 3 days that haven't been handled.
 *  Waits for the salesperson and the AI scores (up to 2 h), then drafts. Errors are retried on the next run. */
async function poll(admin: any) {
  const tok = Deno.env.get('AIRTABLE_TOKEN'); if (!tok) throw new Error('AIRTABLE_TOKEN secret is not set');
  const since = new Date(Math.max(Date.parse(GO_LIVE), Date.now() - 3 * 86400_000)).toISOString();
  const formula = `AND(IS_AFTER(CREATED_TIME(), '${since}'), {autoRFQ_SubmissionId} != '')`;
  const url = `https://api.airtable.com/v0/${BASE}/${RFQS}?returnFieldsByFieldId=true&pageSize=100&filterByFormula=${encodeURIComponent(formula)}` +
    [F.salesman, F.serious, F.real].map(x => `&fields[]=${x}`).join('');
  const r = await fetch(url, { headers: { authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Airtable ${r.status} ${(await r.text()).slice(0, 200)}`);
  const recs: any[] = (await r.json()).records ?? [];
  const { data: done } = await admin.from('rfq_intake').select('rfq_airtable_id, status').in('rfq_airtable_id', recs.map(x => x.id).concat(['-']));
  const handled = new Set((done ?? []).filter((d: any) => d.status !== 'error').map((d: any) => d.rfq_airtable_id));
  const out: any[] = [];
  for (const rec of recs) {
    if (out.length >= POLL_MAX) break;
    if (handled.has(rec.id)) continue;
    const ready = rec.fields?.[F.salesman] && rec.fields?.[F.serious];
    if (!ready && Date.now() - Date.parse(rec.createdTime) < 2 * 3600_000) continue;   // let Make + Airtable AI finish
    out.push({ rfq: rec.id, ...(await intake(admin, rec.id, false, false)) });
  }
  const { data: pending } = await admin.from('rfq_intake').select('rfq_airtable_id').eq('status', 'drafted')
    .or('emailed_at.is.null,noted_at.is.null').gte('created_at', new Date(Date.now() - 3 * 86400_000).toISOString()).limit(10);
  for (const x of pending ?? []) await notify(admin, x.rfq_airtable_id).catch(() => null);
  await admin.from('sync_state').update({ last_run_at: new Date().toISOString(), last_ok_at: new Date().toISOString(), counts: { seen: recs.length, processed: out.length } }).eq('name', 'rfq-intake');
  return { seen: recs.length, processed: out };
}

async function intake(admin: any, rfqId: string, dryRun: boolean, force: boolean): Promise<Record<string, unknown>> {
  const log = (row: Record<string, unknown>) => dryRun ? null : admin.from('rfq_intake').upsert({ rfq_airtable_id: rfqId, updated_at: new Date().toISOString(), ...row });
  const { data: prior } = await admin.from('rfq_intake').select('*').eq('rfq_airtable_id', rfqId).maybeSingle();
  if (prior && prior.status !== 'error' && !force) return { status: prior.status, link: prior.quote_id ? `${APP}/#/q/${prior.quote_id}` : undefined, note: prior.reason ?? '', total: prior.total, repeat: true };
  try {
    const E = await engine();
    // ---- the RFQ
    const tok = Deno.env.get('AIRTABLE_TOKEN'); if (!tok) throw new Error('AIRTABLE_TOKEN secret is not set');
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${RFQS}/${rfqId}?returnFieldsByFieldId=true`, { headers: { authorization: `Bearer ${tok}` } });
    if (!r.ok) throw new Error(`Airtable ${r.status}`);
    const f = (await r.json()).fields ?? {};
    const number = text(f[F.number]) || rfqId, md = text(f[F.details]);
    const skip = async (why: string) => { await log({ rfq_number: number, status: 'skipped', reason: why }); return { status: 'skipped', note: why }; };

    if (!text(f[F.submission]) || !md) return skip('Not a website RFQ (no form details).');
    const serious = E.pct(text(f[F.serious])), real = E.pct(text(f[F.real]));
    if ((serious ?? 100) < MIN_SCORE || (real ?? 100) < MIN_SCORE) return skip(`Skipped — AI scored it ${serious ?? '?'}% serious / ${real ?? '?'}% real.`);
    const brand = text(f[F.brand]), product = text(f[F.product]);
    if (/stair/i.test(brand) || /stair/i.test(product)) return skip('Stairs — quoted in StairZone, not auto-built.');

    const p = E.parseRfqDetails(md);
    // ---- miles: a known building of this customer at the same ZIP/street, else the state's center
    const custAir = idOf(f[F.customer]);
    const { data: cust0 } = custAir ? await admin.from('customers').select('*').eq('airtable_id', custAir).maybeSingle() : { data: null };
    let miles: number | undefined, driveMinutes: number | undefined, milesWhy = '';
    if (cust0?.id && (p.zip || p.address)) {
      const { data: sites } = await admin.from('sites').select('address1, zip, miles_from_pwi, drive_seconds').eq('customer_id', cust0.id);
      const street = (p.address ?? '').split(',')[0].toLowerCase().slice(0, 12);
      const s = (sites ?? []).find((x: any) => x.miles_from_pwi && ((p.zip && x.zip?.startsWith(p.zip)) || (street && x.address1?.toLowerCase().startsWith(street))));
      if (s) { miles = Math.round(Number(s.miles_from_pwi)); driveMinutes = s.drive_seconds ? Math.round(s.drive_seconds / 60) : undefined; milesWhy = 'from the customer\'s building in Airtable'; }
    }
    if (miles == null) { miles = E.milesFromState(p.state); if (miles != null) milesWhy = `estimated from ${p.state} (state center) — check`; }

    // ---- spec: Claude when there's a key, the configurator mapper as the fallback
    let spec: any, assumed: string[] = [], source = '', why = '';
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (key) {
      try {
        const c = await askClaude(key, E.SKILL_MD, md, { miles, driveMinutes, milesWhy, product, attachments: (f[F.attachments] ?? []).map((a: any) => a.filename) });
        if (c.quotable && c.spec) { spec = c.spec; assumed = c.assumed ?? []; source = 'claude'; } else why = c.reason ?? 'Claude: not enough to quote.';
      } catch (e) { why = `Claude failed: ${(e as Error).message}`; }
    }
    if (!spec) {
      const c = E.configuratorSpec(p, miles);
      if (c.spec) { spec = c.spec; assumed = c.assumed; source = 'configurator'; }
      else return skip(why || c.skip || 'Not enough detail to auto-quote.');
    }
    spec = E.parseSpec(JSON.stringify({ ...spec, pwi_quote: 1 }));
    for (const it of spec.items) { if (it.miles == null && miles != null) it.miles = miles; }
    if (driveMinutes && !spec.trip?.driveMinutes) spec.trip = { ...(spec.trip ?? {}), driveMinutes };
    if (milesWhy && (spec.items[0]?.miles ?? miles) === miles) assumed.push(`Miles ${miles} ${milesWhy}`);   // Claude moved the miles → its own note says why
    spec.project ??= `${number} ${product || 'Website RFQ'}`;
    spec.location ??= p.address;

    // ---- build + price
    const settings = await loadSettings(admin);
    const cat = await E.loadCatalog(admin, settings);
    const built = E.buildFromSpec(spec, cat, settings, E.emptyDoc('freestanding'));
    let doc: any = { ...built.doc, rfq: { number, airtableId: rfqId, note: p.note.slice(0, 1500), assumed, source } };
    const problems = E.validateDoc(doc); if (problems.length) throw new Error(problems.join('; '));
    doc = await serverChecks(E, admin, doc, settings);
    doc.family = E.deriveFamily(doc); doc.freestandingShopHours = E.pvHours(doc);
    const priced = E.priceManual(doc, settings), ro = priced.quote, t = priced.totals;
    const note = [`Built from ${number} (${source})`, ...assumed].join(' · ');
    if (dryRun) return { status: 'drafted', dryRun: true, spec, assumed, total: ro.total, lines: priced.lines.length, flags: priced.flags.map((x: any) => x.rule), note };

    // ---- owner, customer, contact
    const salesAir = idOf(f[F.salesman]);
    const { data: sp } = salesAir ? await admin.from('salespeople').select('user_id, full_name').eq('airtable_id', salesAir).maybeSingle() : { data: null };
    let owner = sp?.user_id;
    if (!owner) { const { data: a } = await admin.from('profiles').select('user_id').eq('role', 'admin').eq('active', true).order('created_at').limit(1).single(); owner = a.user_id; }
    let cust = cust0;
    if (!cust) {
      const name = text(f[F.custName]) || p.customer || 'Website customer';
      const { data, error } = await admin.from('customers').insert({ name, server_folder: name, city: p.city, state: p.state, zip: p.zip, airtable_id: custAir ?? null, source: custAir ? 'airtable' : 'app' }).select().single();
      if (error) throw error; cust = data;
    }
    const conAir = idOf(f[F.contact]);
    let contactId: string | null = null;
    if (conAir) { const { data } = await admin.from('contacts').select('id').eq('airtable_id', conAir).maybeSingle(); contactId = data?.id ?? null; }
    if (!contactId && p.contact) {
      const { data } = await admin.from('contacts').insert({ customer_id: cust.id, name: p.contact, email: p.email, phone: p.phone, airtable_id: conAir ?? null, source: conAir ? 'airtable' : 'app' }).select('id').single();
      contactId = data?.id ?? null;
    }

    // ---- quote + revision 0, priced
    const { data: q, error: e1 } = await admin.from('quotes').insert({ customer_id: cust.id, contact_id: contactId, project_name: spec.project, job_location: spec.location ?? '', brand: 'PWI', salesperson_id: owner, created_by: owner, rfq_number: number }).select().single();
    if (e1) throw e1;
    const { data: rev, error: e2 } = await admin.from('quote_revisions').insert({ quote_id: q.id, rev: 0, created_by: owner, doc, priced, flags: priced.flags,
      base_price: ro.base, installation: ro.installation, freight: ro.freight, pre_use: ro.preUse, sales_tax: ro.tax, total: ro.total,
      gross_margin_pct: t.grossMarginPct, shop_hours: t.shopHours, install_hours: t.installHours, cad_hours: t.cadHours, engine_version: ENGINE_VERSION }).select('id').single();
    if (e2) throw e2;
    if (priced.lines.length) await admin.from('quote_line_facts').insert(priced.lines.map((l: any) => ({ revision_id: rev.id, line_key: l.key, family: l.family ?? doc.family, category: l.category, description: l.description, qty: l.qty, cost: l.cost, sell: l.sell, hours: l.hours })));
    await admin.from('quotes').update({ status: priced.flags.length ? 'approval_needed' : 'draft' }).eq('id', q.id);
    await admin.from('quote_events').insert({ quote_id: q.id, revision_id: rev.id, actor: owner, event: 'created', data: { from: 'rfq', rfq: number, source, owner_has_account: !!sp?.user_id } });
    const fullNote = sp?.user_id ? note : `${note} · Quote sits under Kyle until ${sp?.full_name ?? 'the salesperson'} has a quote-app login`;
    await log({ rfq_number: number, status: 'drafted', reason: fullNote, quote_id: q.id, spec, source, total: ro.total });
    const sent = await notify(admin, rfqId).catch((e: Error) => ({ error: e.message }));
    return { status: 'drafted', link: `${APP}/#/q/${q.id}`, note: fullNote, total: ro.total, sent };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await log({ status: 'error', reason: msg });
    return { status: 'error', note: `Auto-quote failed: ${msg}` };
  }
}

/** Tell the salesperson: append the link to the RFQ's notes in Airtable, and email them (Microsoft 365).
 *  Each half runs once (noted_at / emailed_at) and is retried by the poll until it works — e.g. before the
 *  Microsoft secrets exist or while the Airtable token lacks write access. */
async function notify(admin: any, rfqId: string) {
  const { data: row } = await admin.from('rfq_intake').select('*').eq('rfq_airtable_id', rfqId).single();
  if (!row?.quote_id || (row.noted_at && row.emailed_at)) return { skipped: true };
  const tok = Deno.env.get('AIRTABLE_TOKEN')!;
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${RFQS}/${rfqId}?returnFieldsByFieldId=true`, { headers: { authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`Airtable ${r.status}`);
  const f = (await r.json()).fields ?? {};
  const link = `${APP}/#/q/${row.quote_id}`, total = row.total ? `$${Math.round(Number(row.total)).toLocaleString('en-US')}` : '';
  const res: Record<string, unknown> = {};
  if (!row.noted_at) {
    const cur = text(f[F.notes]);
    const add = `Draft quote (auto, ${total}): ${link}`;
    if (cur.includes(link)) res.noted = 'already';
    else {
      const w = await fetch(`https://api.airtable.com/v0/${BASE}/${RFQS}/${rfqId}`, { method: 'PATCH', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fields: { [F.notes]: cur ? `${cur.trimEnd()}\n\n${add}\n` : `${add}\n` } }) });
      res.noted = w.ok ? 'ok' : `Airtable ${w.status}`;
    }
    if (res.noted === 'ok' || res.noted === 'already') await admin.from('rfq_intake').update({ noted_at: new Date().toISOString() }).eq('rfq_airtable_id', rfqId);
  }
  if (!row.emailed_at) {
    const lk = first(f[F.salesEmail]);
    const to = (typeof lk === 'string' ? lk : lk?.valuesByLinkedRecordId ? Object.values(lk.valuesByLinkedRecordId).flat()[0] : '') as string;
    const ms = { tenant: Deno.env.get('MS_TENANT_ID'), id: Deno.env.get('MS_CLIENT_ID'), secret: Deno.env.get('MS_CLIENT_SECRET'), from: Deno.env.get('MAIL_FROM') };
    if (!to) res.emailed = 'no salesperson email';
    else if (!ms.tenant || !ms.id || !ms.secret || !ms.from) res.emailed = 'Microsoft 365 not set up yet';
    else {
      const number = text(f[F.number]), cust = text(f[F.custName]);
      const tk = await fetch(`https://login.microsoftonline.com/${ms.tenant}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: ms.id, client_secret: ms.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) });
      if (!tk.ok) res.emailed = `Microsoft sign-in ${tk.status}`;
      else {
        const esc = (x: string) => x.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]);
        const checks = String(row.reason ?? '').split(' · ').slice(1).map(x => `<li>${esc(x)}</li>`).join('');
        const html = `<div style="font-family:Poppins,Arial,sans-serif;color:#000;max-width:560px">
<div style="border-bottom:3px solid #FF6800;padding-bottom:6px;font-weight:700;letter-spacing:.5px">PWI — DRAFT QUOTE READY</div>
<p>A draft quote was built automatically from website RFQ <b>${esc(number)}</b> for <b>${esc(cust)}</b>.</p>
${total ? `<p>Draft total: <b>${total}</b></p>` : ''}
<p><a href="${link}" style="background:#FF6800;color:#fff;padding:10px 18px;text-decoration:none;font-weight:700;border-radius:4px;display:inline-block">Open and edit the quote</a></p>
${checks ? `<p style="margin-bottom:4px"><b>Assumed — check these:</b></p><ul style="margin-top:0">${checks}</ul>` : ''}
<p style="color:#81858B">It's a starting point: change anything, then save and send from the quote app.</p>
<p style="color:#FF6800;font-weight:700;font-size:12px">CONQUER YOUR SPACE</p></div>`;
        const m = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ms.from)}/sendMail`, { method: 'POST',
          headers: { authorization: `Bearer ${(await tk.json()).access_token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ message: { subject: `Draft quote ready — ${number} ${cust}`, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true }) });
        res.emailed = m.ok ? `sent to ${to}` : `Microsoft ${m.status} ${(await m.text()).slice(0, 150)}`;
        if (m.ok) await admin.from('rfq_intake').update({ emailed_at: new Date().toISOString(), emailed_to: to }).eq('rfq_airtable_id', rfqId);
      }
    }
  }
  return res;
}

async function askClaude(key: string, skill: string, md: string, ctx: Record<string, unknown>) {
  const system = `${skill}\n\n---\n\nYOU ARE RUNNING UNATTENDED on a website RFQ (no rep to ask). Rules for this mode:
- Never ask questions. Default anything missing the way the skill says and list every default in "assumed" (short phrases a rep can check).
- Installed or ship only — decide from what the customer actually wrote, NOT from the form's "Project Timeline" line (every website RFQ says "delivery/installation" there; ignore it).
  Ship only (install: false) when they ask for delivery, shipping, freight or FOB with no mention of installing, or say they install / have their own crew.
  Installed (install: true) when they mention install, erect, set up on site, turnkey, or ask us to put it in.
  Neither → installed, and say "Install not mentioned — assumed installed, confirm" in assumed.
  Always put the install decision and the words it rests on first in "assumed", e.g. "Ship only — RFQ lists 'Shipping and Freight (FOB Destination)', no install".
- Miles: use the provided miles unless the address clearly says otherwise.
- Do not search flights. Do not invent a customer.
- Quotable = a crane, monorail, gantry, jib, mezzanine, work platform, VRC, fall protection or price-list item with enough size to build. Rough sizes are fine ("roughly 80 x 30 x 18") — use them.
- Not quotable: spam, sales pitches, stairs/ladders, decking, "call me" with no product or size, repairs/service, or anything outside the auto-builder's ranges. Say why in one short sentence.
- Answer ONLY by calling the submit_rfq tool: quotable true with the pwi_quote spec and every default in "assumed", or quotable false with a one-sentence reason.`;
  const user = `Website RFQ:\n\n${md}\n\nContext: ${JSON.stringify(ctx)}`;
  // forced tool call: the reply is always valid JSON (inch marks, notes etc. can't break it)
  const tool = { name: 'submit_rfq', description: 'Submit the result for this website RFQ.', input_schema: { type: 'object', properties: {
    quotable: { type: 'boolean' }, spec: { type: 'object', description: 'pwi_quote spec (pwi_quote: 1, project, location, customer, items[])' },
    assumed: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } }, required: ['quotable'] } };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 50000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system, tools: [tool], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content: user }] }) });
    if (!r.ok) throw new Error(`API ${r.status} ${(await r.text()).slice(0, 200)}`);
    const content = (await r.json()).content ?? [];
    const out = content.find((c: any) => c.type === 'tool_use')?.input;   // this model can't be forced to the tool; it's asked to, and text JSON is the fallback
    if (out) return out;
    const m = content.map((c: any) => c.text ?? '').join('').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no answer from Claude');
    return JSON.parse(m[0]);
  } finally { clearTimeout(t); }
}

async function loadSettings(admin: any) {
  const { data } = await admin.from('settings').select('key, value');
  const s: Record<string, unknown> = {}; for (const row of data ?? []) s[row.key] = row.value; return s as any;
}

async function serverChecks(E: typeof Engine, admin: any, doc: any, settings: any) {
  doc.suggestedInstallHours = null; doc.blockers = [];
  if (!doc.spec) return E.stampFromBuild(doc, null);
  doc = E.ensureRefs(doc);
  try {
    const cat = await E.loadCatalog(admin, settings);
    const b = E.buildFromSpec(doc.spec, cat, settings, { ...doc, lines: [], removed: [] });
    doc.suggestedInstallHours = b.doc.suggestedInstallHours ?? null; doc.blockers = b.blockers;
    return E.stampFromBuild(doc, b.doc, { shape: cat.shape, steelCost: E.readSteelCost(settings.steel_cost).sc });
  } catch (e) { doc.blockers = [`Auto-build check failed: ${(e as Error).message}`]; return E.stampFromBuild(doc, null); }
}
