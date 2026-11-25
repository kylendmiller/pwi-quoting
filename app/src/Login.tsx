import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  // one-time admin sign-in link: #/login?th=<token hash>
  useEffect(() => {
    const th = new URLSearchParams(location.hash.split('?')[1] ?? '').get('th');
    if (!th) return;
    supabase.auth.verifyOtp({ token_hash: th, type: 'magiclink' }).then(({ error }) => {
      if (error) setErr('That sign-in link is expired or already used. ' + error.message); else location.hash = '/';
    });
  }, []);
  const send = async () => {
    setErr('');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
    if (error) setErr(error.message); else setSent(true);
  };
  const signInPw = async () => {
    setErr(''); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
  };
  const verify = async () => {
    setErr('');
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    if (error) setErr(error.message);
  };
  return (
    <main style={{ maxWidth: 420, marginTop: 80 }}>
      <div className="card">
        <img src="/pwi-logo.png" alt="PWI" style={{ height: 60 }} />
        <h2>PWI QUOTES</h2>
        {!useCode ? (<>
          <label>Work email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@pwiworks.com" autoComplete="username" />
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={e => e.key === 'Enter' && signInPw()} />
          <p className="row"><button onClick={signInPw} disabled={busy || !email.includes('@') || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <button className="secondary" onClick={() => setUseCode(true)}>Email me a code instead</button></p>
        </>) : !sent ? (<>
          <label>Work email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@pwiworks.com" onKeyDown={e => e.key === 'Enter' && send()} />
          <p className="row"><button onClick={send} disabled={!email.includes('@')}>Email me a sign-in code</button><button className="secondary" onClick={() => setUseCode(false)}>Use password</button></p>
        </>) : (<>
          <p className="muted">We emailed a code to {email}.</p>
          <label>Code</label>
          <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoFocus onKeyDown={e => e.key === 'Enter' && verify()} />
          <p className="row"><button onClick={verify} disabled={code.trim().length < 6}>Sign in</button><button className="secondary" onClick={() => setSent(false)}>Back</button></p>
        </>)}
        {err && <p className="msg-error">{err}</p>}
      </div>
    </main>
  );
}
