import React, { Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { supabase } from './supabase';
import { Login } from './Login';
import { QuoteList } from './QuoteList';
import { NewQuote } from './NewQuote';
import { Editor } from './Editor';
import { Approvals } from './Approvals';
import { Admin } from './Admin';
import { captureFromUrl, capturePending } from './pendingSpec';
import { useAppVersion } from './useAppVersion';

captureFromUrl();

export type Profile = { user_id: string; full_name: string; title: string; role: 'none' | 'sales' | 'manager' | 'admin' };

function useHash() {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => { const f = () => setH(location.hash.slice(1) || '/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}

function App() {
  const [session, setSession] = useState<any>(undefined);
  const [me, setMe] = useState<Profile | null>(null);
  const route = useHash();
  const newVersion = useAppVersion();
  useEffect(() => {          // paste a Claude block or link anywhere (outside a text box) → new quote from it
    const f = (e: ClipboardEvent) => {
      const t = e.clipboardData?.getData('text') ?? '';
      const el = document.activeElement as HTMLElement | null;
      if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      if (!/pwi_quote|#\/new\?s=/.test(t)) return;
      try { capturePending(t); e.preventDefault(); location.hash = '/new'; dispatchEvent(new HashChangeEvent('hashchange')); } catch (err: any) { alert(err.message); }
    };
    addEventListener('paste', f); return () => removeEventListener('paste', f);
  }, []);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) { setMe(null); return; }
    supabase.from('profiles').select('*').eq('user_id', session.user.id).single().then(({ data }) => setMe(data as Profile));
  }, [session]);

  if (session === undefined) return null;
  if (!session) return <Login />;
  if (me && me.role === 'none') return <main><div className="card"><h2>Almost there</h2><p>You're signed in as {session.user.email}, but an admin still needs to give your account access.</p><button className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button></div></main>;
  if (!me) return null;

  const isMgr = me.role === 'manager' || me.role === 'admin';
  const nav = (to: string, label: string) => <a href={`#${to}`} className={route === to || (to !== '/' && route.startsWith(to)) ? 'active' : ''}>{label}</a>;
  let page: React.ReactNode;
  if (route.startsWith('/q/')) { const [id, sub] = route.slice(3).split('/'); page = <Editor key={id + sub} quoteId={id} me={me} mode={sub === 'edit' ? 'edit' : 'review'} />; }
  else if (route.startsWith('/new')) page = <NewQuote />;
  else if (route === '/approvals') page = <Approvals />;
  else if (route === '/admin' && me.role === 'admin') page = <Admin />;
  else page = <QuoteList />;
  return (
    <>
      <header className="top">
        <img src="pwi-logo.png" alt="PWI" />
        <nav>{nav('/', 'QUOTES')}{nav('/new', 'NEW QUOTE')}{isMgr && nav('/approvals', 'APPROVALS')}{me.role === 'admin' && nav('/admin', 'SETTINGS')}{location.pathname.startsWith('/quotes') && <a href="/" title="Back to the inventory app">INVENTORY</a>}</nav>
        <span className="me">{me.full_name || session.user.email} · {me.role} · <a style={{ color: '#fff' }} href="#/" onClick={() => supabase.auth.signOut()}>sign out</a></span>
      </header>
      {newVersion && <div className="update-bar">A new version of the quote app is ready. <button onClick={() => location.reload()}>Reload</button></div>}
      <main>{page}<div className="footer-tag">CONQUER YOUR SPACE</div></main>
    </>
  );
}

// #/harness — editor test page built from the reference price lists (dev builds, or VITE_HARNESS=1 builds only).
const Harness = import.meta.env.DEV || import.meta.env.VITE_HARNESS === '1' ? React.lazy(() => import('./editor/Harness')) : null;
const isHarness = () => !!Harness && location.hash.startsWith('#/harness');
createRoot(document.getElementById('root')!).render(isHarness() && Harness ? <Suspense fallback={null}><Harness /></Suspense> : <App />);
