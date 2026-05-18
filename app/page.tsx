'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { APP_VERSION } from '../lib/version';
import { COLORS, RADII, SHADOWS } from '../lib/theme';
import { loadFirstPhotosByTire } from '../lib/photos';
import { useCurrentShop } from '../lib/useCurrentShop';
import { isStale, STALE_STYLE } from '../lib/tireStatus';
import { TireCard } from './components/TireCard';
import VoiceChat from './components/VoiceChat';

const RECENT_COUNT = 8;

export default function Home() {
  const [tires, setTires] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [photosByTire, setPhotosByTire] = useState<Map<string, string>>(
    new Map(),
  );
  const [staleOnly, setStaleOnly] = useState(false);
  const currentShop = useCurrentShop();

  useEffect(() => {
    supabase
      .from('tires')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setTires(data || []));
    loadFirstPhotosByTire().then(setPhotosByTire);
  }, []);

  // Sold tires live on their own page — keep them out of the main views.
  const liveTires = tires.filter((t) => t.status !== 'sold');
  const staleCount = liveTires.filter((t) => isStale(t.created_at, t.status))
    .length;
  const shown = liveTires
    .filter((t) => {
      const friendly = t.tire_number != null ? `tire-${t.tire_number}` : '';
      const text =
        `${friendly} ${t.brand} ${t.model} ${t.size} ${t.season} ${t.shop}`.toLowerCase();
      return text.includes(q.toLowerCase());
    })
    .filter((t) => (staleOnly ? isStale(t.created_at, t.status) : true));
  const recent = liveTires.slice(0, RECENT_COUNT);

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
              padding: '4px 10px',
              background: COLORS.redSoftBg,
              color: COLORS.red,
              border: `1px solid ${COLORS.red}`,
              borderRadius: RADII.pill,
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
            padding: '6px 12px',
            background: COLORS.surface,
            color: COLORS.textMuted,
            border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.control,
            cursor: 'pointer',
            flexShrink: 0,
            fontWeight: 500,
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

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <a
          href="/add"
          style={{
            flex: '1 1 0',
            minWidth: 110,
            textAlign: 'center',
            padding: '13px 16px',
            background: COLORS.red,
            color: '#fff',
            borderRadius: RADII.control,
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: -0.1,
            boxSizing: 'border-box',
            boxShadow: SHADOWS.card,
          }}
        >
          + Add tire
        </a>
        <a
          href="/history"
          style={{
            flex: '1 1 0',
            minWidth: 110,
            textAlign: 'center',
            padding: '13px 16px',
            background: COLORS.surface,
            color: COLORS.red,
            border: `1.5px solid ${COLORS.red}`,
            borderRadius: RADII.control,
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: -0.1,
            boxSizing: 'border-box',
          }}
        >
          📋 History
        </a>
        <a
          href="/sold"
          aria-label="Recently sold"
          title="Recently sold"
          style={{
            flex: '0 0 auto',
            width: 56,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '6px 4px 8px',
            background: COLORS.surface,
            color: COLORS.textBody,
            border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.control,
            textDecoration: 'none',
            boxSizing: 'border-box',
            lineHeight: 1,
            boxShadow: SHADOWS.card,
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>🚚</span>
          <span
            style={{
              fontSize: 10,
              marginTop: 5,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: COLORS.textMuted,
            }}
          >
            Sold
          </span>
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
            padding: '12px 14px',
            fontSize: 16,
            borderRadius: RADII.control,
            border: `1px solid ${COLORS.borderStrong}`,
            marginBottom: 12,
            boxSizing: 'border-box',
            background: COLORS.surface,
            color: COLORS.ink,
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            margin: '0 0 10px',
            flexWrap: 'wrap',
          }}
        >
          <p style={{ color: COLORS.textMuted, fontSize: 13, margin: 0 }}>
            {shown.length} {shown.length === 1 ? 'tire' : 'tires'}
            {staleOnly && ` (aging 90+ days)`}
          </p>
          {staleCount > 0 && (
            <button
              type="button"
              onClick={() => setStaleOnly((v) => !v)}
              aria-pressed={staleOnly}
              style={{
                fontSize: 12,
                padding: '5px 12px',
                background: staleOnly ? STALE_STYLE.color : 'transparent',
                color: staleOnly ? '#1a1a1a' : STALE_STYLE.color,
                border: `1px solid ${STALE_STYLE.border}`,
                borderRadius: RADII.pill,
                cursor: 'pointer',
                fontWeight: 700,
                letterSpacing: 0.2,
                whiteSpace: 'nowrap',
              }}
            >
              {staleOnly
                ? `Showing aging (${staleCount}) — clear`
                : `⚠ ${staleCount} aging — view`}
            </button>
          )}
        </div>
        {shown.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: COLORS.textMuted,
              fontSize: 14,
              border: `1px dashed ${COLORS.border}`,
              borderRadius: RADII.card,
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

      <div
        style={{
          textAlign: 'center',
          marginTop: 24,
          marginBottom: 4,
        }}
      >
        <a
          href="/bugs"
          style={{
            fontSize: 12,
            color: COLORS.textMuted,
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          🐛 Report a bug
        </a>
      </div>
      <p
        style={{
          fontSize: 11,
          color: COLORS.textSubtle,
          textAlign: 'center',
          marginTop: 4,
          marginBottom: 8,
        }}
      >
        {APP_VERSION}
      </p>
    </main>
  );
}
