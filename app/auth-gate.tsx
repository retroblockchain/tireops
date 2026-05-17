'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const login = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
  };

  if (!ready) return <main style={{ padding: 16 }}>Loading...</main>;

  if (!authed) {
    return (
      <main style={{ padding: 16, fontFamily: 'sans-serif', maxWidth: 360, margin: '40px auto' }}>
        <h1 style={{ fontSize: 22 }}>BuySell Tires Inventory — Sign in</h1>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
          style={{ width: '100%', padding: 12, fontSize: 16, borderRadius: 8, border: '1px solid #ccc', marginBottom: 8 }} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password"
          style={{ width: '100%', padding: 12, fontSize: 16, borderRadius: 8, border: '1px solid #ccc', marginBottom: 8 }} />
        <button onClick={login} style={{ padding: 12, fontSize: 16, width: '100%',
          background: '#E0500F', color: '#fff', border: 'none', borderRadius: 8 }}>Sign in</button>
        {err && <p style={{ color: 'red', fontSize: 14 }}>{err}</p>}
      </main>
    );
  }

  return <>{children}</>;
}