import { useEffect, useState } from 'react';
import { supabase, api } from './supabase';
import { FAMILIES, emptyDoc, describe } from './model';
import { getPending, clearPending } from './pendingSpec';
import { loadCatalog } from './catalog';
import { buildFromSpec } from '../../src/engine/buildSpec';

export function NewQuote() {
  const [spec, setSpec] = useState(getPending);
  const [customers, setCustomers] = useState<any[]>([]);
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

  useEffect(() => { supabase.from('customers').select('*').order('name').then(({ data }) => setCustomers(data ?? [])); }, []);
  useEffect(() => {
    if (!customer?.id) { setContacts([]); return; }
    supabase.from('contacts').select('*').eq('customer_id', customer.id).then(({ data }) => setContacts(data ?? []));
  }, [customer]);

  const matches = search.length > 1 ? customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8) : [];
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
      if (spec) { await api('save', { revision_id: res.revision.id, doc, doc_version: res.revision.doc_version }); clearPending(); }
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
        <button className="secondary" onClick={() => { clearPending(); setSpec(null); }}>Discard</button>
      </div>}
      <div className="card grid">
        <div>
          <label>Customer</label>
          <input value={customer?.name ?? search} onChange={e => { setCustomer(null); setSearch(e.target.value); }} placeholder="Start typing a customer name" />
          {!customer && matches.map(c => <div key={c.id} className="muted" style={{ cursor: 'pointer', padding: 4 }} onClick={() => setCustomer(c)}>{c.name}</div>)}
          {!customer && search.length > 1 && !matches.some(m => m.name.toLowerCase() === search.toLowerCase()) && <div className="muted">New customer "{search}" will be created.</div>}
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
        <div><button onClick={create} disabled={busy || !(customer || search.trim()) || !project.trim()}>{busy ? 'Building…' : spec ? 'Create & build quote' : 'Create quote'}</button> {err && <span className="msg-error">{err}</span>}</div>
      </div>
    </>
  );
}
