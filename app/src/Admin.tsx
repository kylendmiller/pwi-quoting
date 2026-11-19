import { useEffect, useState } from 'react';
import { supabase, api } from './supabase';

// Admin: edit rates, factors and adders (every change is logged), and give people access.
export function Admin() {
  const [settings, setSettings] = useState<any[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [people, setPeople] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const load = () => {
    supabase.from('settings').select('*').order('key').then(({ data }) => setSettings(data ?? []));
    supabase.from('profiles').select('*').order('created_at').then(({ data }) => setPeople(data ?? []));
  };
  useEffect(load, []);
  const saveSetting = async (key: string) => {
    try {
      const value = JSON.parse(edits[key]);
      const { error } = await supabase.from('settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
      if (error) throw error; setMsg(`Saved ${key}`); setEdits(e => { const n = { ...e }; delete n[key]; return n; }); load();
    } catch (e: any) { setMsg(`${key}: ${e.message}`); }
  };
  const setRole = async (p: any, patch: any) => { try { await api('set_role', { user_id: p.user_id, ...patch }); load(); } catch (e: any) { setMsg(e.message); } };
  return (
    <>
      <h2>Settings</h2>
      <p className="muted">Rates, product factors and adders. Numbers are plain values; factor lists are shown as {'{ "product": factor }'}. Every change is recorded with who made it.</p>
      {msg && <p>{msg}</p>}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Setting</th><th>Value</th><th>What it is</th><th></th></tr></thead>
          <tbody>{settings.map(s => {
            const v = edits[s.key] ?? JSON.stringify(s.value, null, typeof s.value === 'object' ? 1 : 0);
            return <tr key={s.key}><td><b>{s.key}</b></td>
              <td style={{ width: '45%' }}>{typeof s.value === 'object' ? <textarea rows={Math.min(14, v.split('\n').length + 1)} value={v} onChange={e => setEdits({ ...edits, [s.key]: e.target.value })} /> : <input value={v} onChange={e => setEdits({ ...edits, [s.key]: e.target.value })} />}</td>
              <td className="muted">{s.description}<br />updated {new Date(s.updated_at).toLocaleDateString()}</td>
              <td>{edits[s.key] !== undefined && <button onClick={() => saveSetting(s.key)}>Save</button>}</td></tr>;
          })}</tbody>
        </table>
      </div>
      <h2>People</h2>
      <div className="card" style={{ padding: 0 }}>
        <table><thead><tr><th>Name</th><th>Title</th><th>Role</th><th>Active</th></tr></thead>
          <tbody>{people.map(p => <tr key={p.user_id}>
            <td><input defaultValue={p.full_name} onBlur={e => e.target.value !== p.full_name && setRole(p, { full_name: e.target.value })} /></td>
            <td><input defaultValue={p.title} onBlur={e => e.target.value !== p.title && setRole(p, { title: e.target.value })} /></td>
            <td><select value={p.role} onChange={e => setRole(p, { role: e.target.value })}>{['none', 'sales', 'manager', 'admin'].map(r => <option key={r}>{r}</option>)}</select></td>
            <td><input type="checkbox" checked={p.active} onChange={e => setRole(p, { active: e.target.checked })} style={{ width: 'auto' }} /></td></tr>)}</tbody></table>
      </div>
      <p className="muted">New people sign in with their email first; they appear here with role "none" until you set one.</p>
    </>
  );
}
