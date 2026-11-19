import { useEffect, useState } from 'react';
import { supabase, money } from './supabase';

export function Approvals() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from('quotes').select('id, quote_number, job_id, project_name, customers(name), current_revision, quote_revisions(rev, total, flags, gross_margin_pct)')
      .eq('status', 'approval_needed').order('updated_at', { ascending: false }).then(({ data }) => setRows(data ?? []));
  }, []);
  return (
    <>
      <h2>Waiting for approval</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Quote</th><th>Customer</th><th>Project</th><th>Why</th><th className="num">Total</th><th className="num">GM</th></tr></thead>
          <tbody>
            {rows.map(r => { const cur = r.quote_revisions.find((x: any) => x.rev === r.current_revision) ?? {};
              return <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => (location.hash = `/q/${r.id}`)}>
                <td><b>{r.job_id ?? r.quote_number}</b></td><td>{r.customers?.name}</td><td>{r.project_name}</td>
                <td>{(cur.flags ?? []).map((f: any) => f.rule.replaceAll('_', ' ').toLowerCase()).join(', ')}</td>
                <td className="num">{money(cur.total)}</td><td className="num">{cur.gross_margin_pct != null ? (cur.gross_margin_pct * 100).toFixed(1) + '%' : ''}</td></tr>; })}
            {!rows.length && <tr><td colSpan={6} className="muted">Nothing waiting.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
