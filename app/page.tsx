'use client';
import { Fragment, useEffect, useState } from 'react';
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

// Styles for the Stock table — small uppercase column headers, mid-weight
// shop names, tabular-nums numbers so digits column-align across rows.
const tableHeaderCellStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: COLORS.textMuted,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  textAlign: 'right',
};
const tableShopCellStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: COLORS.textBody,
  textAlign: 'left',
};
const tableNumberCellStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: COLORS.ink,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};
const tableTotalLabelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: COLORS.textBody,
  textAlign: 'left',
  borderTop: `1px solid ${COLORS.border}`,
  paddingTop: 10,
};
const tableTotalNumberStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: COLORS.red,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  borderTop: `1px solid ${COLORS.border}`,
  paddingTop: 10,
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

  // Per-shop metrics for the Stock table: count of available listings +
  // sum of physical-tire quantity. Both columns use status='available'
  // (strict) so the two numbers come from the same source-of-truth row
  // set. If reserved/pending statuses ever appear, they'd be excluded
  // from both columns identically — keeps the math honest.
  const NAMED_LC = new Set(SHOP_NAMES.map((s) => s.toLowerCase()));
  const availableTires = tires.filter((t) => t.status === 'available');
  const shopMetrics = SHOP_NAMES.map((shop) => {
    const rows = availableTires.filter(
      (t) => (t.shop || '').trim().toLowerCase() === shop.toLowerCase(),
    );
    return {
      shop,
      listings: rows.length,
      tires: rows.reduce((sum, t) => sum + (Number(t.quantity) || 0), 0),
    };
  });
  // Catch-all: any available tires whose shop is outside the named three
  // (legacy values, "TEST" leftovers, typos, null shop). Renders as an
  // "Other" row in the table ONLY when non-zero, so the totals always
  // equal the sum of visible rows. Today this should be empty.
  const otherRows = availableTires.filter(
    (t) => !NAMED_LC.has((t.shop || '').trim().toLowerCase()),
  );
  const otherMetric = {
    shop: 'Other',
    listings: otherRows.length,
    tires: otherRows.reduce((sum, t) => sum + (Number(t.quantity) || 0), 0),
  };
  const allMetrics =
    otherMetric.listings > 0 ? [...shopMetrics, otherMetric] : shopMetrics;
  const totalListings = allMetrics.reduce((s, m) => s + m.listings, 0);
  const totalTires = allMetrics.reduce((s, m) => s + m.tires, 0);

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

      {/* ----- Stock: per-shop listings + physical tires + total row ----- */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={sectionHeaderStyle}>Stock</h2>
        <div
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.card,
            boxShadow: SHADOWS.card,
            padding: '14px 16px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              columnGap: 20,
              rowGap: 10,
              alignItems: 'baseline',
            }}
          >
            {/* Header row — blank shop-name cell + two column labels */}
            <span />
            <span style={tableHeaderCellStyle}>Listings</span>
            <span style={tableHeaderCellStyle}>Tires</span>
            {/* Shop rows — Mission / Aldergrove / Lethbridge + Other if non-zero */}
            {allMetrics.map((m) => (
              <Fragment key={m.shop}>
                <span style={tableShopCellStyle}>{m.shop}</span>
                <span style={tableNumberCellStyle}>{m.listings}</span>
                <span style={tableNumberCellStyle}>{m.tires}</span>
              </Fragment>
            ))}
            {/* Total row — borderTop on each of the three cells forms a continuous divider */}
            <span style={tableTotalLabelStyle}>Total</span>
            <span style={tableTotalNumberStyle}>{totalListings}</span>
            <span style={tableTotalNumberStyle}>{totalTires}</span>
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
