'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { APP_VERSION } from '../lib/version';
import { COLORS, RADII, SHADOWS } from '../lib/theme';
import { loadFirstPhotosByTire } from '../lib/photos';
import { useCurrentShop } from '../lib/useCurrentShop';
import { TireCard } from './components/TireCard';
import VoiceChat from './components/VoiceChat';
import AiSpendBar from './components/AiSpendBar';

// Dashboard tuning: keep the surfaces around the chat short so the chat
// itself is unmistakably the primary action when the app opens.
const RECENT_ADDED = 3;
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
  const [tires, setTires] = useState<any[]>([]);
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

  // Live = not sold. Sold tires don't surface anywhere on the dashboard —
  // they live on /sold (reached via the "Sold" nav button).
  const liveTires = tires.filter((t) => t.status !== 'sold');

  const recentAdded = liveTires.slice(0, RECENT_ADDED);

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

      {/*
        Top menu bar — sits directly under the header and visually distinct
        from it (a "tray" with its own surface background, subtle border, and
        soft drop-shadow). Four equal-width buttons via flex:1 + min-width:0,
        nowrap + ellipsis as safety on the narrowest Androids. Add tire keeps
        the red accent as the primary action; the rest are quiet text-only
        items that read as menu entries inside the tray.
      */}
      <nav
        aria-label="Main"
        style={{
          display: 'flex',
          gap: 4,
          alignItems: 'stretch',
          width: '100%',
          padding: 4,
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADII.control,
          boxShadow: SHADOWS.card,
          marginBottom: 16,
          boxSizing: 'border-box',
        }}
      >
        <a
          href="/add"
          style={{
            flex: '1 1 0',
            minWidth: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 6px',
            background: COLORS.red,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 0.1,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxSizing: 'border-box',
          }}
        >
          + Add tire
        </a>
        <a
          href="/inventory"
          style={{
            flex: '1 1 0',
            minWidth: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 6px',
            background: 'transparent',
            color: COLORS.textBody,
            border: 'none',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 12,
            letterSpacing: 0.1,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxSizing: 'border-box',
          }}
        >
          All tires
        </a>
        <a
          href="/history"
          style={{
            flex: '1 1 0',
            minWidth: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 6px',
            background: 'transparent',
            color: COLORS.textBody,
            border: 'none',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 12,
            letterSpacing: 0.1,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxSizing: 'border-box',
          }}
        >
          History
        </a>
        <a
          href="/sold"
          style={{
            flex: '1 1 0',
            minWidth: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 6px',
            background: 'transparent',
            color: COLORS.textBody,
            border: 'none',
            borderRadius: 8,
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: 12,
            letterSpacing: 0.1,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxSizing: 'border-box',
          }}
        >
          Sold
        </a>
      </nav>

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

      {/* ----- AI spend: budget cap awareness ----- */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={sectionHeaderStyle}>AI spend</h2>
        <AiSpendBar />
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
