// Supabase Edge Function "quote-api" (bundled with esbuild; deployed by Claude).
// Every write to quotes goes through here: it identifies the caller from their login token,
// prices the quote with the shared engine, writes flags, and enforces approvals and locks.
// @ts-ignore deno import
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { QuoteDoc, Settings } from '../src/engine/manual';
import type * as Engine from './engine-entry';

// The pricing engine is the exact file the app ships (/engine/engine-<hash>.js on the Netlify site).
// Supabase won't import modules by URL, so it is fetched on first use, checked against the SHA-256 pinned
// at build time (tools/bundle-api.mjs), and evaluated. A mismatch refuses to run.
declare const __ENGINE_URL__: string, __ENGINE_SHA__: string;
let enginePromise: Promise<typeof Engine> | null = null;
const engine = () => enginePromise ??= (async () => {
  const code = await (await fetch(__ENGINE_URL__)).text();
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  const got = [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
  if (got !== __ENGINE_SHA__) { enginePromise = null; throw new Error('Pricing engine file does not match this server version. Redeploy.'); }
  new Function(code)();
  return (globalThis as any).PWIEngine;
})();

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

const ENGINE_VERSION = 'manual-1+cal1+r3s';   // round 3 S: refs, stamps, std-part cost, policy flags
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });

async function hash(o: unknown) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(o)));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({});
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false }, db: { schema: 'quoting' } });
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return json({ error: 'Not signed in' }, 401);
  const uid = u.user.id;
  const { data: prof } = await admin.from('profiles').select('role, active').eq('user_id', uid).single();
  const role = prof?.active ? prof.role : 'none';
  if (!['sales', 'manager', 'admin'].includes(role)) return json({ error: 'Your account has no access yet. Ask an admin.' }, 403);

  const body = await req.json();
  const { priceManual, sendBlocked, deriveFamily, pvHours, validateDoc, deltaDoc, reviseStatus } = await engine();
  const settings = await loadSettings(admin);
  const ev = (quote_id: string, revision_id: string | null, event: string, data: unknown = {}) =>
    admin.from('quote_events').insert({ quote_id, revision_id, actor: uid, event, data });
  const isMgr = ['manager', 'admin'].includes(role);
  const ownQuote = async (quote_id: string) => {
    const { data: q } = await admin.from('quotes').select('salesperson_id').eq('id', quote_id).single();
    return !!q && (q.salesperson_id === uid || isMgr);
  };
  const notYours = () => json({ error: "This quote belongs to another salesperson. Ask them or a sales manager." }, 403);

  try {
    switch (body.action) {
      case 'price': {               // preview only, writes nothing
        const d = body.doc as QuoteDoc;
        const problems = validateDoc(d);
        if (problems.length) return json({ error: 'The quote has values the server can\'t price.', problems }, 400);
        d.family = deriveFamily(d); d.freestandingShopHours = pvHours(d);
        return json({ priced: priceManual(d, settings) });
      }
      case 'create': {
        const { customer_id, contact_id, project_name, job_location, brand } = body;
        const { data: q, error } = await admin.from('quotes').insert({ customer_id, contact_id, project_name, job_location, brand: brand ?? 'PWI', salesperson_id: uid, created_by: uid }).select().single();
        if (error) throw error;
        const { data: r, error: e2 } = await admin.from('quote_revisions').insert({ quote_id: q.id, rev: 0, doc: body.doc ?? {}, created_by: uid }).select().single();
        if (e2) throw e2;
        await ev(q.id, r.id, 'created');
        return json({ quote: q, revision: r });
      }
      case 'save': {
        const { revision_id, doc_version, header } = body;
        let doc = body.doc as QuoteDoc;
        const { data: r } = await admin.from('quote_revisions').select('*, quotes(*)').eq('id', revision_id).single();
        if (!r) return json({ error: 'Revision not found' }, 404);
        if (r.locked) return json({ error: 'This revision was sent and is locked. Start a new revision.' }, 409);
        if (r.doc_version !== doc_version) return json({ error: 'Someone else saved this quote. Reload to see their changes.' }, 409);
        if (!(r.quotes.salesperson_id === uid || isMgr)) return notYours();
        const problems = validateDoc(doc);                 // R11: no NaN / Infinity / negative qty / unknown category
        if (problems.length) return json({ error: 'The quote has values the server can\'t price.', problems }, 400);
        doc = await serverChecks(admin, doc as QuoteDoc, settings);
        // S2: family and production-value hours come from the spec and the lines, never from the browser.
        doc.family = deriveFamily(doc as QuoteDoc); doc.freestandingShopHours = pvHours(doc as QuoteDoc);
        const priced = priceManual(doc as QuoteDoc, settings);
        const t = priced.totals, ro = priced.quote;   // S9: one rounding rule — parts to the cent, total = sum of parts
        // S10: a CHANGE ORDER prints the delta vs the last confirmed revision
        if (r.doc_type === 'CHANGE ORDER') {
          const { data: conf } = await admin.from('quote_revisions').select('doc, rev').eq('quote_id', r.quote_id).eq('doc_type', 'CONFIRMATION').order('rev', { ascending: false }).limit(1).maybeSingle();
          (priced as any).changeOrder = conf ? { fromRev: conf.rev, ...deltaDoc(conf.doc as QuoteDoc, doc, settings) } : { error: 'No confirmed revision to compare against.' };
        }
        const { data: upd, error } = await admin.from('quote_revisions').update({
          doc, priced, flags: priced.flags, base_price: ro.base, installation: ro.installation, freight: ro.freight, pre_use: ro.preUse,
          sales_tax: ro.tax, total: ro.total, gross_margin_pct: t.grossMarginPct, shop_hours: t.shopHours, install_hours: t.installHours,
          cad_hours: t.cadHours, engine_version: ENGINE_VERSION, doc_version: r.doc_version + 1, updated_at: new Date().toISOString(),
        }).eq('id', revision_id).eq('doc_version', doc_version).select().single();
        if (error) throw error;
        if (!upd) return json({ error: 'Someone else saved this quote. Reload to see their changes.' }, 409);
        // keep only approvals whose covered numbers are unchanged (after the versioned update succeeded — R8)
        const { data: appr } = await admin.from('approvals').select('*').eq('revision_id', revision_id);
        for (const a of appr ?? []) {
          const f = priced.flags.find(x => x.rule === a.rule);
          if (!f || (await hash(f.detail)) !== a.covered_hash) await admin.from('approvals').delete().eq('id', a.id);
        }
        if (header) await admin.from('quotes').update({ ...pick(header, ['project_name', 'job_location', 'contact_id', 'brand']), updated_at: new Date().toISOString() }).eq('id', r.quote_id);
        await admin.from('quote_line_facts').delete().eq('revision_id', revision_id);
        if (priced.lines.length) await admin.from('quote_line_facts').insert(priced.lines.map(l => ({
          revision_id, line_key: l.key, family: l.family ?? (doc as QuoteDoc).family, category: l.category, description: l.description,
          qty: l.qty, cost: l.cost, sell: l.sell, hours: l.hours })));
        await admin.from('quotes').update({ status: priced.flags.length ? 'approval_needed' : 'draft' }).eq('id', r.quote_id).in('status', ['draft', 'approval_needed', 'approved']);
        await ev(r.quote_id, revision_id, 'saved', { total: ro.total });
        return json({ revision: upd, priced });
      }
      case 'approve': {
        if (!['manager', 'admin'].includes(role)) return json({ error: 'Only a sales manager can approve.' }, 403);
        const { revision_id, rule, note, doc_version } = body;
        const { data: r } = await admin.from('quote_revisions').select('*').eq('id', revision_id).single();
        if (!r) return json({ error: 'Revision not found' }, 404);
        // R8: the manager approves what was on their screen — refuse if the revision was saved since.
        if (typeof doc_version !== 'number') return json({ error: 'doc_version is required to approve.' }, 400);
        if (r.doc_version !== doc_version) return json({ error: 'The quote changed since you opened it. Reload and review again.' }, 409);
        const { data: oq } = await admin.from('quotes').select('salesperson_id').eq('id', r?.quote_id).single();
        if (oq?.salesperson_id === uid && role !== 'admin') return json({ error: "You can't approve your own quote." }, 403);
        const f = (r?.flags ?? []).find((x: { rule: string }) => x.rule === rule);
        if (!f) return json({ error: 'Nothing to approve for that rule.' }, 400);
        await admin.from('approvals').insert({ revision_id, rule, detail: f.detail, covered_hash: await hash(f.detail), requested_by: r.created_by, decision: 'approved', decided_by: uid, decided_at: new Date().toISOString(), note });
        await ev(r.quote_id, revision_id, 'approved', { rule, note });
        return json({ ok: true });
      }
      case 'send': {
        const { revision_id } = body;
        const { data: r } = await admin.from('quote_revisions').select('*').eq('id', revision_id).single();
        if (!r || r.locked) return json({ error: 'Already sent.' }, 409);
        if (!(await ownQuote(r.quote_id))) return notYours();
        const priced = priceManual(r.doc as QuoteDoc, settings);
        const { data: appr } = await admin.from('approvals').select('rule, covered_hash').eq('revision_id', revision_id).eq('decision', 'approved');
        const ok: string[] = [];
        for (const a of appr ?? []) { const f = priced.flags.find(x => x.rule === a.rule); if (f && (await hash(f.detail)) === a.covered_hash) ok.push(a.rule); }
        if (sendBlocked(priced, ok)) return json({ error: 'Not ready to send', lint: priced.lint, flags: priced.flags.filter(f => !ok.includes(f.rule)) }, 422);
        await admin.from('quote_revisions').update({ locked: true, sent_at: new Date().toISOString(), sent_by: uid }).eq('id', revision_id);
        await admin.from('quotes').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', r.quote_id);
        await ev(r.quote_id, revision_id, 'sent', { doc_type: r.doc_type, total: priced.quote.total });
        return json({ ok: true, priced });             // S9: render the customer PDF from this (server-priced) result
      }
      case 'revise': {             // copy a revision (the one on screen, else the latest) into a new editable one
        const { quote_id, doc_type, from_revision_id } = body;
        if (!(await ownQuote(quote_id))) return notYours();
        const { data: last } = await admin.from('quote_revisions').select('rev').eq('quote_id', quote_id).order('rev', { ascending: false }).limit(1).single();
        const { data: src } = from_revision_id
          ? await admin.from('quote_revisions').select('*').eq('id', from_revision_id).eq('quote_id', quote_id).single()
          : await admin.from('quote_revisions').select('*').eq('quote_id', quote_id).order('rev', { ascending: false }).limit(1).single();
        if (!src) return json({ error: 'Revision to copy not found.' }, 404);
        const { data: r, error } = await admin.from('quote_revisions').insert({ quote_id, rev: last.rev + 1, doc: src.doc, doc_type: doc_type ?? src.doc_type, created_by: uid }).select().single();
        if (error) throw error;
        // S10: a won job stays won (status follows the NEW revision's doc type and never downgrades 'won')
        const { data: q } = await admin.from('quotes').select('status').eq('id', quote_id).single();
        const status = reviseStatus(q?.status, r.doc_type);
        await admin.from('quotes').update({ current_revision: r.rev, status }).eq('id', quote_id);
        await ev(quote_id, r.id, 'revised', { rev: r.rev, doc_type: r.doc_type, from_rev: src.rev });
        return json({ revision: r });
      }
      case 'win': {                // job ID replaces the quote number; confirmation revision created
        const { quote_id, job_id } = body;
        if (!/^\d{5}$/.test(job_id ?? '')) return json({ error: 'Job ID must be 5 digits.' }, 400);
        if (!(await ownQuote(quote_id))) return notYours();
        const { error } = await admin.from('quotes').update({ job_id, status: 'won' }).eq('id', quote_id);
        if (error) return json({ error: error.message.includes('unique') ? 'That job ID is already used.' : error.message }, 400);
        await ev(quote_id, null, 'won', { job_id });
        return json({ ok: true });
      }
      case 'set_role': {
        if (role !== 'admin') return json({ error: 'Admins only.' }, 403);
        await admin.from('profiles').update(pick(body, ['role', 'full_name', 'title', 'active'])).eq('user_id', body.user_id);
        return json({ ok: true });
      }
      default: return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});

function pick(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
}

async function loadSettings(admin: any): Promise<Settings> {
  const { data } = await admin.from('settings').select('key, value');
  const s: Record<string, unknown> = {};
  for (const row of data ?? []) s[row.key] = row.value;
  return s as unknown as Settings;
}

/** The install suggestion, send-blockers and line evidence are never trusted from the browser:
 *  rebuild from the saved spec with live prices. No spec → no suggestion (manual install needs approval).
 *  S3: auto lines matched by ref get the server's own detail / basis / role / group and `edited` builder values;
 *  everything else is marked source 'hand' (stampFromBuild). Returns the stamped doc. */
async function serverChecks(admin: any, doc: QuoteDoc, settings: Settings): Promise<QuoteDoc> {
  const { loadCatalog, buildFromSpec, stampFromBuild, ensureRefs, readSteelCost } = await engine();
  doc.suggestedInstallHours = null; doc.blockers = [];
  if (!doc.spec) return stampFromBuild(doc, null);
  doc = ensureRefs(doc);
  try {
    const cat = await loadCatalog(admin, settings);
    const b = buildFromSpec(doc.spec as any, cat, settings, { ...doc, lines: [], removed: [] });
    doc.suggestedInstallHours = b.doc.suggestedInstallHours ?? null;
    doc.blockers = b.blockers;
    const sc = readSteelCost((settings as any).steel_cost).sc;
    return stampFromBuild(doc, b.doc, { shape: cat.shape, steelCost: sc });
  } catch (e) {
    doc.blockers = [`Auto-build check failed: ${(e as Error).message}`];
    return stampFromBuild(doc, null);
  }
}
