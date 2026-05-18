'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { APP_VERSION } from '../lib/version';
import { COLORS, RADII, SHADOWS } from '../lib/theme';
import { loadFirstPhotosByTire } from '../lib/photos';
import { useCurrentShop } from '../lib/useCurrentShop';
import { TireCard } from './components/TireCard';
import VoiceChat from './components/VoiceChat';

// Dashboard tuning: keep the surfaces around the chat short so the chat
// itself is unmistakably the primary action when the app opens.
const RECENT_ADDED = 3;
const RECENT_SOLD_LIMIT = 5;
const SHOP_NAMES = ['Mission', 'Aldergrove', 'Lethbridge'] as const;

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 12,
  color: COLORS.textMuted,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  margin: '0 0 8px',
  fontWeight: 700,
};

export default function Home() {
  const router = useRouter();
  const [tires, setTires] = useState<any[]>([]);
  const [photosByTire, setPhotosByTire] = useState<Map<string, string>>(
    new Map(),
  );
  const [searchDraft, setSearchDraft] = useState('');
  const currentShop = useCurrentShop();

  useEffect(() => {
    supabase
      .from('tires')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setTires(data || []));
    loadFirstPhotosByTire().then(setPhotosByTire);
  }, []);

  // Live = not sold. Sold goes through its own sort (by mark-sold time,
  // approximated by updated_at) for the "Recently sold" glance below.
  const liveTires = tires.filter((t) => t.status !== 'sold');
  const soldTires = tires
    .filter((t) => t.status === 'sold')
    .sort((a, b) => {
      const tb = new Date(b.updated_at || b.created_at || 0).getTime();
      const ta = new Date(a.updated_at || a.created_at || 0).getTime();
      return tb - ta;
    });

  const recentAdded = liveTires.slice(0, RECENT_ADDED);
  const recentSold = soldTires.slice(0, RECENT_SOLD_LIMIT);

  // Per-shop in-stock count, fixed to the three named shops. Tires saved
  // under other shop names (legacy, "TEST", Unassigned) aren't counted in
  // the per-shop tiles, but they DO contribute to the grand total since
  // they're still in stock somewhere.
  const shopCounts = SHOP_NAMES.map((shop) => ({
    shop,
    count: liveTires.filter(
      (t) => (t.shop || '').trim().toLowerCase() === shop.toLowerCase(),
    ).length,
  }));
  const totalInStock = liveTires.length;

  const goToInventory = (q?: string) => {
    const trimmed = (q ?? '').trim();
    if (trimmed) {
      router.push(`/inventory?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push('/inventory');
    }
  };

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
      {/* ----- Header: compact, makes room for the chat below ----- */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
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

      {/* ----- AI chat: the obvious primary thing when the app opens ----- */}
      <VoiceChat variant="embedded" />

      {/* ----- 3 most recent additions: compact, just enough to glance ----- */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={sectionHeaderStyle}>Recently added</h2>
        {recentAdded.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '20px 16px',
              color: COLORS.textMuted,
              fontSize: 13,
              border: `1px dashed ${COLORS.border}`,
              borderRadius: RADII.card,
              background: COLORS.surface,
            }}
          >
            No tires yet. Try voice or tap + Add tire.
          </div>
        ) : (
          recentAdded.map((t) => (
            <TireCard
              key={`r-${t.id}`}
              tire={t}
              thumbUrl={photosByTire.get(t.id)}
            />
          ))
        )}
      </section>

      {/* ----- Stock pulse: per-shop in-stock counts + grand total ----- */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={sectionHeaderStyle}>Stock</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))',
            gap: 8,
          }}
        >
          {shopCounts.map(({ shop, count }) => (
            <div
              key={shop}
              style={{
                padding: '10px 6px',
                background: COLORS.surface,
                border: `1px solid ${COLORS.border}`,
                borderRadius: RADII.card,
                textAlign: 'center',
                boxShadow: SHADOWS.card,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: COLORS.ink,
                  letterSpacing: -0.4,
                  lineHeight: 1,
                }}
              >
                {count}
              </div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: COLORS.textMuted,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  marginTop: 6,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {shop}
              </div>
            </div>
          ))}
          {/* Grand total — visually accented so it reads as the headline number. */}
          <div
            style={{
              padding: '10px 6px',
              background: COLORS.redSoftBg,
              border: `1px solid ${COLORS.red}`,
              borderRadius: RADII.card,
              textAlign: 'center',
              boxShadow: SHADOWS.card,
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: COLORS.red,
                letterSpacing: -0.4,
                lineHeight: 1,
              }}
            >
              {totalInStock}
            </div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: COLORS.red,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                marginTop: 6,
                whiteSpace: 'nowrap',
              }}
            >
              Total
            </div>
          </div>
        </div>
      </section>

      {/* ----- Recently sold: minimal one-line-per-tire glance ----- */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={sectionHeaderStyle}>Recently sold</h2>
        {recentSold.length === 0 ? (
          <p
            style={{
              color: COLORS.textSubtle,
              fontSize: 12,
              margin: 0,
              fontStyle: 'italic',
            }}
          >
            Nothing sold yet.
          </p>
        ) : (
          <div
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.control,
              overflow: 'hidden',
            }}
          >
            {recentSold.map((t, i) => {
              const brandLine =
                [t.brand, t.model].filter(Boolean).join(' ') || '—';
              return (
                <a
                  key={`s-${t.id}`}
                  href={`/edit/${t.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    textDecoration: 'none',
                    color: COLORS.textMuted,
                    fontSize: 12,
                    borderBottom:
                      i < recentSold.length - 1
                        ? `1px solid ${COLORS.border}`
                        : 'none',
                  }}
                >
                  <span
                    style={{
                      color: COLORS.textBody,
                      fontWeight: 700,
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      flexShrink: 0,
                    }}
                  >
                    tire-{t.tire_number ?? '?'}
                  </span>
                  <span style={{ color: COLORS.textSubtle, flexShrink: 0 }}>
                    ·
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={brandLine}
                  >
                    {brandLine}
                  </span>
                  {t.size && (
                    <span
                      style={{
                        color: COLORS.textMuted,
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                        flexShrink: 0,
                      }}
                    >
                      {t.size}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        )}
      </section>

      {/* ----- Search: lands on /inventory mid-search ----- */}
      <section style={{ marginBottom: 18 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            goToInventory(searchDraft);
          }}
        >
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search the full inventory…"
            aria-label="Search the full inventory"
            style={{
              width: '100%',
              padding: '12px 14px',
              fontSize: 16,
              borderRadius: RADII.control,
              border: `1px solid ${COLORS.borderStrong}`,
              boxSizing: 'border-box',
              background: COLORS.surface,
              color: COLORS.ink,
              marginBottom: 10,
            }}
          />
        </form>
        {/*
          Secondary nav — compact pills. Add tire keeps the red accent because
          it's the most consequential action; the rest sit quietly.
        */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <a
            href="/add"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '7px 14px',
              background: COLORS.red,
              color: '#fff',
              border: 'none',
              borderRadius: RADII.pill,
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: 0.1,
              lineHeight: 1.3,
            }}
          >
            + Add tire
          </a>
          <a
            href="/inventory"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '7px 14px',
              background: 'transparent',
              color: COLORS.textBody,
              border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.pill,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 13,
              letterSpacing: 0.1,
              lineHeight: 1.3,
            }}
          >
            📦 All tires
          </a>
          <a
            href="/history"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '7px 14px',
              background: 'transparent',
              color: COLORS.textBody,
              border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.pill,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 13,
              letterSpacing: 0.1,
              lineHeight: 1.3,
            }}
          >
            📋 History
          </a>
          <a
            href="/sold"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '7px 14px',
              background: 'transparent',
              color: COLORS.textBody,
              border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.pill,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 13,
              letterSpacing: 0.1,
              lineHeight: 1.3,
            }}
          >
            🚚 Sold
          </a>
        </div>
      </section>

      {/* ----- Footer ----- */}
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
