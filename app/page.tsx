'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { APP_VERSION } from '../lib/version';
import { COLORS } from '../lib/theme';
import { loadFirstPhotosByTire } from '../lib/photos';
import { useCurrentShop } from '../lib/useCurrentShop';
import { TireCard } from './components/TireCard';
import VoiceChat from './components/VoiceChat';

const RECENT_COUNT = 8;

export default function Home() {
  const [tires, setTires] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [photosByTire, setPhotosByTire] = useState<Map<string, string>>(
    new Map(),
  );
  const currentShop = useCurrentShop();

  useEffect(() => {
    supabase
      .from('tires')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setTires(data || []));
    loadFirstPhotosByTire().then(setPhotosByTire);
  }, []);

  const shown = tires.filter((t) => {
    const text = `${t.brand} ${t.model} ${t.size} ${t.season} ${t.shop}`.toLowerCase();
    return text.includes(q.toLowerCase());
  });
  const recent = tires.slice(0, RECENT_COUNT);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
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
          <span
            aria-label={`Signed in as ${currentShop}`}
            title={`Signed in as ${currentShop}`}
            style={{
              fontSize: 11,
              padding: '3px 9px',
              background: COLORS.redSoftBg,
              color: COLORS.red,
              border: `1px solid ${COLORS.red}`,
              borderRadius: 999,
              fontWeight: 700,
              letterSpacing: 0.3,
              whiteSpace: 'nowrap',
            }}
          >
            {currentShop}
          </span>
        </div>
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
            flexShrink: 0,
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
        Use voice chat to add or look up tires, or browse below.
      </p>

      <VoiceChat variant="embedded" />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <a
          href="/add"
          style={{
            flex: '1 1 160px',
            textAlign: 'center',
            padding: '12px 14px',
            background: COLORS.red,
            color: '#fff',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 15,
            boxSizing: 'border-box',
          }}
        >
          + Add tire
        </a>
        <a
          href="/history"
          style={{
            flex: '1 1 160px',
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
          📋 History
        </a>
      </div>

      {recent.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <h2
            style={{
              fontSize: 12,
              color: COLORS.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              margin: '0 0 8px',
              fontWeight: 700,
            }}
          >
            Recently added
          </h2>
          {recent.map((t) => (
            <TireCard
              key={`r-${t.id}`}
              tire={t}
              thumbUrl={photosByTire.get(t.id)}
            />
          ))}
        </section>
      )}

      <section>
        <h2
          style={{
            fontSize: 12,
            color: COLORS.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            margin: '0 0 8px',
            fontWeight: 700,
          }}
        >
          All tires
        </h2>
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
          <TireCard key={t.id} tire={t} thumbUrl={photosByTire.get(t.id)} />
        ))}
      </section>

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
