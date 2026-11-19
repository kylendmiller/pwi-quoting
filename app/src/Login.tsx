import { useState } from 'react';
import { supabase } from './supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    setErr('');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    if (error) setErr(error.message); else setSent(true);
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
        {!sent ? (<>
          <label>Work email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@pwiworks.com" onKeyDown={e => e.key === 'Enter' && send()} />
          <p><button onClick={send} disabled={!email.includes('@')}>Email me a sign-in code</button></p>
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
