'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { APP_VERSION } from '../lib/version';
import { COLORS } from '../lib/theme';

export default function Home() {
  const [tires, setTires] = useState<any[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    supabase.from('tires').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setTires(data || []));
  }, []);

  const shown = tires.filter((t) => {
    const text = `${t.brand} ${t.model} ${t.size} ${t.season} ${t.shop}`.toLowerCase();
    return text.includes(q.toLowerCase());
  });

  return (
    <main
      style={{
        padding: 16,
        fontFamily: 'sans-serif',
        maxWidth: 600,
        margin: '0 auto',
        color: COLORS.textBody,
        background: COLORS.bg,
        minHeight: '100dvh',
        boxSizing: 'border-box',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <h1
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: COLORS.ink,
            margin: 0,
            letterSpacing: -0.2,
          }}
        >
          BuySell Tires
        </h1>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{
            fontSize: 13,
            padding: '6px 10px',
            background: COLORS.surface,
            color: COLORS.textMuted,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </header>
      <p
        style={{
          color: COLORS.textMuted,
          fontSize: 13,
          margin: '0 0 14px',
        }}
      >
        Inventory — tap a tire to edit, or add a new one below.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <a
          href="/add"
          style={{
            flex: '1 1 140px',
            textAlign: 'center',
            padding: '12px 14px',
            background: COLORS.red,
            color: '#fff',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          + Add tire
        </a>
        <a
          href="/chat"
          style={{
            flex: '1 1 140px',
            textAlign: 'center',
            padding: '12px 14px',
            background: COLORS.surface,
            color: COLORS.red,
            border: `2px solid ${COLORS.red}`,
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 15,
            boxSizing: 'border-box',
          }}
        >
          🎤 Voice chat
        </a>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search brand, size, season..."
        style={{
          width: '100%',
          padding: 12,
          fontSize: 16,
          borderRadius: 8,
          border: `1px solid ${COLORS.borderStrong}`,
          marginBottom: 12,
          boxSizing: 'border-box',
          background: COLORS.surface,
          color: COLORS.ink,
        }}
      />
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: '0 0 10px' }}>
        {shown.length} {shown.length === 1 ? 'tire' : 'tires'}
      </p>

      {shown.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '32px 16px',
            color: COLORS.textMuted,
            fontSize: 14,
            border: `1px dashed ${COLORS.border}`,
            borderRadius: 10,
            background: COLORS.surface,
          }}
        >
          {tires.length === 0
            ? 'No tires yet. Tap + Add tire to get started.'
            : 'No matches. Try a different search.'}
        </div>
      )}

      {shown.map((t) => (
        <a
          key={t.id}
          href={`/edit/${t.id}`}
          style={{
            display: 'block',
            textDecoration: 'none',
            color: 'inherit',
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: 14,
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: COLORS.ink,
                  lineHeight: 1.2,
                }}
              >
                {t.size || (
                  <span style={{ color: COLORS.textSubtle, fontWeight: 500 }}>
                    (no size)
                  </span>
                )}
              </div>
              <div style={{ fontSize: 14, color: COLORS.textMuted, marginTop: 3 }}>
                {[t.brand, t.model].filter(Boolean).join(' ') || (
                  <span style={{ fontStyle: 'italic' }}>unnamed</span>
                )}
              </div>
            </div>
            <span
              aria-hidden="true"
              style={{
                color: COLORS.textSubtle,
                fontSize: 22,
                lineHeight: 1,
                paddingTop: 2,
              }}
            >
              ›
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 10,
              alignItems: 'center',
            }}
          >
            {t.season && (
              <span
                style={{
                  fontSize: 12,
                  padding: '3px 8px',
                  borderRadius: 99,
                  background: COLORS.surfaceSoft,
                  color: COLORS.textBody,
                }}
              >
                {t.season}
              </span>
            )}
            {t.condition && (
              <span
                style={{
                  fontSize: 12,
                  padding: '3px 8px',
                  borderRadius: 99,
                  fontWeight: t.condition === 'new' ? 700 : 500,
                  background: t.condition === 'new' ? COLORS.ink : 'transparent',
                  color: t.condition === 'new' ? COLORS.bg : COLORS.textBody,
                  border:
                    t.condition === 'new'
                      ? 'none'
                      : `1px solid ${COLORS.borderStrong}`,
                }}
              >
                {t.condition}
              </span>
            )}
            <span
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                gap: 12,
                alignItems: 'baseline',
              }}
            >
              <span style={{ fontSize: 13, color: COLORS.textMuted }}>
                qty{' '}
                <span style={{ color: COLORS.ink, fontWeight: 700 }}>
                  {t.quantity ?? '—'}
                </span>
              </span>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: COLORS.red,
                }}
              >
                {t.price != null && t.price !== '' ? `$${t.price}` : '—'}
              </span>
            </span>
          </div>
        </a>
      ))}

      <p
        style={{
          fontSize: 11,
          color: COLORS.textSubtle,
          textAlign: 'center',
          marginTop: 24,
          marginBottom: 8,
        }}
      >
        {APP_VERSION}
      </p>
    </main>
  );
}
