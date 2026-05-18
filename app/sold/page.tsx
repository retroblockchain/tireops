'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { COLORS, RADII } from '../../lib/theme';
import { useCurrentShop } from '../../lib/useCurrentShop';
import { loadFirstPhotosByTire } from '../../lib/photos';
import { TireCard } from '../components/TireCard';

export default function SoldPage() {
  const [tires, setTires] = useState<any[]>([]);
  const [photosByTire, setPhotosByTire] = useState<Map<string, string>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentShop = useCurrentShop();

  useEffect(() => {
    // Newest sale first — use updated_at as a proxy for "marked sold at"
    // since marking-as-sold is typically the last write on the row.
    supabase
      .from('tires')
      .select('*')
      .eq('status', 'sold')
      .order('updated_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setTires((data as any[]) || []);
        setLoading(false);
      });
    loadFirstPhotosByTire().then(setPhotosByTire);
  }, []);

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
          marginBottom: 12,
        }}
      >
        <a
          href="/"
          style={{
            color: COLORS.red,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 700,
            padding: '6px 8px',
            borderRadius: 6,
          }}
        >
          ← Inventory
        </a>
        <span
          aria-label={`Signed in as ${currentShop}`}
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
      </header>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: COLORS.ink,
          margin: '0 0 4px',
          letterSpacing: -0.2,
        }}
      >
        Recently sold
      </h1>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: '0 0 16px' }}>
        Tires marked sold across all shops, newest first.
      </p>

      {loading && (
        <p style={{ color: COLORS.textMuted, fontSize: 14 }}>Loading…</p>
      )}
      {error && (
        <p style={{ color: COLORS.redDeep, fontSize: 13 }}>error: {error}</p>
      )}
      {!loading && tires.length === 0 && !error && (
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
          No tires have been marked sold yet.
        </div>
      )}
      {tires.map((t) => (
        <TireCard key={t.id} tire={t} thumbUrl={photosByTire.get(t.id)} />
      ))}
    </main>
  );
}
