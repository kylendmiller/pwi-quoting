import { useEffect, useState } from 'react';
import { supabase, money } from './supabase';
import { getPending, usePendingFromWaiting, markWaiting } from './pendingSpec';
import { describe } from './model';

export function QuoteList() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [waiting, setWaiting] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [uid, setUid] = useState('');
  const loadWaiting = () => supabase.from('waiting_quotes').select('id, spec, summary, created_at, created_by')
    .is('built_quote_id', null).is('dismissed_at', null).order('created_at', { ascending: false }).limit(50)
    .then(({ data }) => setWaiting(data ?? []));
  useEffect(() => {
    loadWaiting();
    supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? ''));
    supabase.from('profiles').select('user_id, full_name').then(({ data }) => setNames(Object.fromEntries((data ?? []).map((p: any) => [p.user_id, p.full_name]))));
    const t = setTimeout(loadWaiting, 2500);          // a link just opened is saved a moment after sign-in
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    supabase.from('quotes').select('id, quote_number, job_id, project_name, status, updated_at, current_revision, customers(name), quote_revisions(rev, total, doc_type)')
      .order('updated_at', { ascending: false }).limit(300).then(({ data }) => setRows(data ?? []));
  }, []);
  const f = q.toLowerCase();
  const shown = rows.filter(r => !f || [r.quote_number, r.job_id, r.project_name, r.customers?.name].some(v => (v ?? '').toLowerCase().includes(f)));
  const pending = getPending();
  return (
    <>
      {waiting.length > 0 && <div className="card from-claude waiting">
        <h3>Waiting to be built ({waiting.length})</h3>
        {waiting.map(w => (
          <div key={w.id} className="wq">
            <div className="wq-txt">
              <b>{w.spec?.customer?.name || w.spec?.project || 'Job from Claude'}</b>
              <ul className="summary">{(w.spec?.items ?? []).map((it: any, i: number) => <li key={i}>{describe(it)}</li>)}</ul>
              <span className="muted">{w.created_by !== uid && names[w.created_by] ? `${names[w.created_by]} · ` : ''}{new Date(w.created_at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </div>
            <div className="wq-act">
              <a className="btn" href="#/new" onClick={() => usePendingFromWaiting(w.spec, w.id)}>Build it →</a>
              <button className="secondary" onClick={async () => { if (!confirm('Remove this job from the waiting list?')) return; await markWaiting(w.id, { dismissed: true }); loadWaiting(); }}>Remove</button>
            </div>
          </div>))}
      </div>}
      {pending && !waiting.length ? <div className="card from-claude"><h3>Quote from Claude waiting</h3>
        <ul className="summary">{pending.items.map((it: any, i: number) => <li key={i}>{describe(it)}</li>)}</ul>
        <a className="btn" href="#/new">Create it →</a></div>
        : !waiting.length && <p className="muted tip">Tip: copy the block or link Claude gives you and press Ctrl+V anywhere on this page.</p>}
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
