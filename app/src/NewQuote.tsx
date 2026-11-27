import { useEffect, useState } from 'react';
import { supabase, api } from './supabase';
import { FAMILIES, emptyDoc, describe } from './model';
import { getPending, clearPending, pendingWaitingId, markWaiting } from './pendingSpec';
import { loadCatalog } from './catalog';
import { buildFromSpec } from '../../src/engine/buildSpec';

export function NewQuote() {
  const [spec, setSpec] = useState(getPending);
  const [search, setSearch] = useState(spec?.customer?.name ?? '');
  const [customer, setCustomer] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactId, setContactId] = useState('');
  const [newContact, setNewContact] = useState({ name: spec?.customer?.contact?.name ?? '', email: spec?.customer?.contact?.email ?? '', phone: spec?.customer?.contact?.phone ?? '' });
  const [project, setProject] = useState(spec?.project ?? '');
  const [location, setLoc] = useState(spec?.location ?? [spec?.customer?.city, spec?.customer?.state].filter(Boolean).join(', '));
  const [family, setFamily] = useState('freestanding');
  const [brand, setBrand] = useState('PWI');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const [confirmNew, setConfirmNew] = useState(false);

  // Search all ~8,700 customers on the server (fuzzy: "grand design" finds "Grand Design RV"); never load the whole list.
  useEffect(() => {
    setConfirmNew(false);
    const q = search.trim();
    if (customer || q.length < 2) { setMatches([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('search_customers', { q });
      setMatches(data ?? []);
      // a spec from Claude with an exact name match picks that customer straight away
      const exact = (data ?? []).filter((c: any) => c.name.toLowerCase() === q.toLowerCase());
      if (spec && exact.length === 1) setCustomer(exact[0]);
    }, 250);
    return () => clearTimeout(t);
  }, [search, customer]);
  useEffect(() => {
    if (!customer?.id) { setContacts([]); return; }
    supabase.from('contacts').select('*').eq('customer_id', customer.id).then(({ data }) => setContacts(data ?? []));
  }, [customer]);

  const create = async () => {
    setErr(''); setBusy(true);
    try {
      let cust = customer;
      if (!cust?.id) {
        const { data, error } = await supabase.from('customers').insert({ name: search.trim(), server_folder: search.trim() }).select().single();
        if (error) throw new Error(error.message.includes('duplicate') ? 'That customer already exists — pick it from the list.' : error.message);
        cust = data;
      }
      let cid = contactId || null;
      if (!cid && newContact.name.trim()) {
        const { data, error } = await supabase.from('contacts').insert({ customer_id: cust.id, ...newContact }).select().single();
        if (error) throw error; cid = data.id;
      }
      let doc = emptyDoc(spec ? 'freestanding' : family);
      if (spec) {
        const { data: rows } = await supabase.from('settings').select('key,value');
        const settings: any = Object.fromEntries((rows ?? []).map((r: any) => [r.key, r.value]));
        doc = buildFromSpec(spec, await loadCatalog(settings), settings, doc).doc;
      }
      const res = await api('create', { customer_id: cust.id, contact_id: cid, project_name: project.trim(), job_location: location.trim(), brand, doc });
      if (spec) { await api('save', { revision_id: res.revision.id, doc, doc_version: res.revision.doc_version }); await markWaiting(pendingWaitingId(), { built_quote_id: res.quote.id }).catch(() => null); clearPending(); }
      window.location.hash = `/q/${res.quote.id}`;
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <h2>New quote</h2>
      {spec && <div className="card from-claude">
        <h3>From Claude</h3>
        <ul className="summary">{spec.items.map((it: any, i: number) => <li key={i}>{describe(it)}</li>)}</ul>
        <p className="muted">Pick or confirm the customer below, then Create — every line, the install and the wording build automatically.</p>
        <button className="secondary" onClick={() => { const w = pendingWaitingId(); clearPending(); setSpec(null); markWaiting(w, { dismissed: true }).catch(() => null); }}>Discard</button> <a className="btn secondary" href="#/" onClick={() => { if (pendingWaitingId()) clearPending(); }}>Build later</a>
      </div>}
      <div className="card grid">
        <div>
          <label>Customer</label>
          <input value={customer?.name ?? search} onChange={e => { setCustomer(null); setSearch(e.target.value); }} placeholder="Start typing a customer name" />
          {!customer && matches.map(c => <div key={c.id} style={{ cursor: 'pointer', padding: 4 }} onClick={() => setCustomer(c)}>
            {c.name}{c.common_name && c.common_name !== c.name ? <span className="muted"> ({c.common_name})</span> : null}
            <span className="muted"> {[c.city, c.state].filter(Boolean).join(', ')}{c.airtable_id ? '' : ' · added in quote app'}</span></div>)}
          {!customer && search.trim().length > 1 && !matches.some(m => m.name.toLowerCase() === search.trim().toLowerCase()) && <label className="inline muted" style={{ display: 'block', marginTop: 6 }}>
            <input type="checkbox" checked={confirmNew} onChange={e => setConfirmNew(e.target.checked)} /> {matches.length ? `None of the ${matches.length} above — ` : 'No match found — '}create new customer "{search.trim()}"</label>}
          {customer && <button className="link" onClick={() => { setCustomer(null); }}>change customer</button>}
        </div>
        <div className="grid g3">
          <div><label>Contact</label>
            <select value={contactId} onChange={e => setContactId(e.target.value)}>
              <option value="">— new contact —</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          {!contactId && <><div><label>Contact name</label><input value={newContact.name} onChange={e => setNewContact({ ...newContact, name: e.target.value })} /></div>
            <div><label>Contact email</label><input value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} /></div></>}
        </div>
        <div className="grid g2">
          <div><label>Project</label><input value={project} onChange={e => setProject(e.target.value)} placeholder="e.g. FSTRM2 Crane System" /></div>
          <div><label>Job location</label><input value={location} onChange={e => setLoc(e.target.value)} placeholder="Street, City, ST ZIP" /></div>
        </div>
        <div className="grid g2">
          {!spec && <div><label>Main product</label><select value={family} onChange={e => setFamily(e.target.value)}>{FAMILIES.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></div>}
          <div><label>Brand</label><select value={brand} onChange={e => setBrand(e.target.value)}><option>PWI</option><option>StairZone</option><option>HoistZone</option></select></div>
        </div>
        <div><button onClick={create} disabled={busy || !(customer || (confirmNew && search.trim())) || !project.trim()}>{busy ? 'Building…' : spec ? 'Create & build quote' : 'Create quote'}</button> {err && <span className="msg-error">{err}</span>}</div>
      </div>
    </>
  );
}
