import { useEffect, useState } from 'react';
import { supabase, money } from './supabase';
import { getPending } from './pendingSpec';
import { describe } from './model';

export function QuoteList() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    supabase.from('quotes').select('id, quote_number, job_id, project_name, status, updated_at, current_revision, customers(name), quote_revisions(rev, total, doc_type)')
      .order('updated_at', { ascending: false }).limit(300).then(({ data }) => setRows(data ?? []));
  }, []);
  const f = q.toLowerCase();
  const shown = rows.filter(r => !f || [r.quote_number, r.job_id, r.project_name, r.customers?.name].some(v => (v ?? '').toLowerCase().includes(f)));
  const pending = getPending();
  return (
    <>
      {pending ? <div className="card from-claude"><h3>Quote from Claude waiting</h3>
        <ul className="summary">{pending.items.map((it: any, i: number) => <li key={i}>{describe(it)}</li>)}</ul>
        <a className="btn" href="#/new">Create it →</a></div>
        : <p className="muted tip">Tip: copy the block or link Claude gives you and press Ctrl+V anywhere on this page.</p>}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Quotes</h2>
        <a className="btn" href="#/new">+ New quote</a>
      </div>
      <input placeholder="Search customer, project, quote # or job #" value={q} onChange={e => setQ(e.target.value)} />
      <div className="card" style={{ marginTop: 12, padding: 0 }}>
        <table className="qlist">
          <thead><tr><th>Number</th><th>Customer</th><th>Project</th><th>Status</th><th className="num">Total</th><th>Updated</th></tr></thead>
          <tbody>
            {shown.map(r => {
              const cur = (r.quote_revisions ?? []).find((x: any) => x.rev === r.current_revision);
              return (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => (location.hash = `/q/${r.id}`)}>
                  <td className="q-no"><b>{r.job_id ?? r.quote_number}</b> <span className="muted">R{r.current_revision}</span></td>
                  <td className="q-cust">{r.customers?.name}</td><td className="q-proj">{r.project_name}</td>
                  <td className="q-st"><span className={`pill ${r.status}`}>{r.status.replace('_', ' ')}</span></td>
                  <td className="num q-tot">{money(cur?.total)}</td>
                  <td className="muted q-date">{new Date(r.updated_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={6} className="muted">No quotes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
