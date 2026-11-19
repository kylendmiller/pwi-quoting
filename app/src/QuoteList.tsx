import { useEffect, useState } from 'react';
import { supabase, money } from './supabase';

export function QuoteList() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    supabase.from('quotes').select('id, quote_number, job_id, project_name, status, updated_at, current_revision, customers(name), quote_revisions(rev, total, doc_type)')
      .order('updated_at', { ascending: false }).limit(300).then(({ data }) => setRows(data ?? []));
  }, []);
  const f = q.toLowerCase();
  const shown = rows.filter(r => !f || [r.quote_number, r.job_id, r.project_name, r.customers?.name].some(v => (v ?? '').toLowerCase().includes(f)));
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Quotes</h2>
        <a className="btn" href="#/new">+ New quote</a>
      </div>
      <input placeholder="Search customer, project, quote # or job #" value={q} onChange={e => setQ(e.target.value)} />
      <div className="card" style={{ marginTop: 12, padding: 0 }}>
        <table>
          <thead><tr><th>Number</th><th>Customer</th><th>Project</th><th>Status</th><th className="num">Total</th><th>Updated</th></tr></thead>
          <tbody>
            {shown.map(r => {
              const cur = (r.quote_revisions ?? []).find((x: any) => x.rev === r.current_revision);
              return (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => (location.hash = `/q/${r.id}`)}>
                  <td><b>{r.job_id ?? r.quote_number}</b> <span className="muted">R{r.current_revision}</span></td>
                  <td>{r.customers?.name}</td><td>{r.project_name}</td>
                  <td><span className={`pill ${r.status}`}>{r.status.replace('_', ' ')}</span></td>
                  <td className="num">{money(cur?.total)}</td>
                  <td className="muted">{new Date(r.updated_at).toLocaleDateString()}</td>
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
