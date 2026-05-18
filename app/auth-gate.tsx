'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { COLORS, RADII, SHADOWS } from '../lib/theme';

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
    setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
  };

  if (!ready) {
    return (
      <main
        style={{
          padding: 16,
          fontFamily: 'sans-serif',
          color: COLORS.textMuted,
        }}
      >
        Loading...
      </main>
    );
  }

  if (!authed) {
    return (
      <main
        style={{
          padding: 16,
          fontFamily: 'sans-serif',
          maxWidth: 380,
          margin: '40px auto',
          color: COLORS.textBody,
          boxSizing: 'border-box',
        }}
      >
        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: COLORS.ink,
            margin: 0,
            letterSpacing: -0.2,
          }}
        >
          BuySell Tires
        </h1>
        <p style={{ color: COLORS.textMuted, fontSize: 14, margin: '4px 0 24px' }}>
          Sign in to access the inventory.
        </p>

        <label
          htmlFor="email"
          style={{
            display: 'block',
            fontSize: 13,
            color: COLORS.textBody,
            fontWeight: 600,
            marginBottom: 6,
            letterSpacing: 0.1,
          }}
        >
          Email
        </label>
        <input
          id="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
          style={{
            width: '100%',
            padding: '12px 14px',
            fontSize: 16,
            borderRadius: RADII.control,
            border: `1px solid ${COLORS.borderStrong}`,
            marginBottom: 14,
            boxSizing: 'border-box',
            background: COLORS.surface,
            color: COLORS.ink,
          }}
        />

        <label
          htmlFor="password"
          style={{
            display: 'block',
            fontSize: 13,
            color: COLORS.textBody,
            fontWeight: 600,
            marginBottom: 6,
            letterSpacing: 0.1,
          }}
        >
          Password
        </label>
        <input
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          type="password"
          autoComplete="current-password"
          style={{
            width: '100%',
            padding: '12px 14px',
            fontSize: 16,
            borderRadius: RADII.control,
            border: `1px solid ${COLORS.borderStrong}`,
            marginBottom: 18,
            boxSizing: 'border-box',
            background: COLORS.surface,
            color: COLORS.ink,
          }}
        />

        <button
          onClick={login}
          style={{
            padding: '14px 16px',
            fontSize: 16,
            width: '100%',
            background: COLORS.red,
            color: '#fff',
            border: 'none',
            borderRadius: RADII.control,
            fontWeight: 700,
            letterSpacing: -0.1,
            cursor: 'pointer',
            boxShadow: SHADOWS.card,
          }}
        >
          Sign in
        </button>
        {err && (
          <p style={{ color: COLORS.redDeep, fontSize: 14, marginTop: 12 }}>{err}</p>
        )}
      </main>
    );
  }

  return <>{children}</>;
}
