'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { COLORS, RADII } from '../../lib/theme';
import { loadFirstPhotosByTire } from '../../lib/photos';
import { useCurrentShop } from '../../lib/useCurrentShop';
import { isStale, STALE_STYLE } from '../../lib/tireStatus';
import { TIRE_LOCATIONS } from '../../lib/locations';
import { TireCard } from '../components/TireCard';

const ANY_LOCATION = '__any__';

/**
 * Full searchable inventory. Lives off the dashboard so the home page can
 * stay focused on the chat. Supports free-text search across brand / size /
 * season / shop / location / friendly id, plus a location dropdown and an
 * aging (90+ days in stock) toggle. Sold tires don't appear here — they
 * live on /sold.
 */
export default function InventoryPage() {
  const [tires, setTires] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [photosByTire, setPhotosByTire] = useState<Map<string, string>>(
    new Map(),
  );
  const [staleOnly, setStaleOnly] = useState(false);
  const [locationFilter, setLocationFilter] = useState<string>(ANY_LOCATION);
  const currentShop = useCurrentShop();

  useEffect(() => {
    // Hydrate the search box from ?q= so navigating in from the dashboard
    // search lands mid-search instead of clearing the user's query.
    if (typeof window !== 'undefined') {
      try {
        const initial = new URLSearchParams(window.location.search).get('q');
        if (initial) setQ(initial);
      } catch {
        /* ignore */
      }
    }
    supabase
      .from('tires')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setTires(data || []));
    loadFirstPhotosByTire().then(setPhotosByTire);
  }, []);

  const liveTires = tires.filter((t) => t.status !== 'sold');
  const staleCount = liveTires.filter((t) => isStale(t.created_at, t.status))
    .length;
  // Preset locations + any custom locations actually saved on a tire, so the
  // dropdown stays useful when staff have typed in "Container A", etc.
  const locationOptions = (() => {
    const set = new Set<string>(TIRE_LOCATIONS);
    for (const t of liveTires) {
      if (t.location && typeof t.location === 'string' && t.location.trim()) {
        set.add(t.location.trim());
      }
    }
    return Array.from(set);
  })();
  const shown = liveTires
    .filter((t) => {
      const friendly = t.tire_number != null ? `tire-${t.tire_number}` : '';
      const text = `${friendly} ${t.brand} ${t.model} ${t.size} ${t.season} ${t.shop} ${t.location || ''}`.toLowerCase();
      return text.includes(q.toLowerCase());
    })
    .filter((t) => (staleOnly ? isStale(t.created_at, t.status) : true))
    .filter((t) =>
      locationFilter === ANY_LOCATION
        ? true
        : (t.location || '') === locationFilter,
    );

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
          ← Home
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
        Inventory
      </h1>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: '0 0 16px' }}>
        Search, filter, and tap any tire to edit.
      </p>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search brand, size, season, location..."
        style={{
          width: '100%',
          padding: '12px 14px',
          fontSize: 16,
          borderRadius: RADII.control,
          border: `1px solid ${COLORS.borderStrong}`,
          marginBottom: 10,
          boxSizing: 'border-box',
          background: COLORS.surface,
          color: COLORS.ink,
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <label
          htmlFor="location-filter"
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: COLORS.textMuted,
          }}
        >
          📍 Location
        </label>
        <select
          id="location-filter"
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          style={{
            flex: '1 1 0',
            minWidth: 140,
            padding: '8px 12px',
            fontSize: 14,
            fontWeight: 600,
            borderRadius: RADII.control,
            border: `1px solid ${COLORS.borderStrong}`,
            background: COLORS.surface,
            color: COLORS.ink,
            fontFamily: 'inherit',
          }}
        >
          <option value={ANY_LOCATION}>Any location</option>
          <option value="">— no location set —</option>
          {locationOptions.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
        {locationFilter !== ANY_LOCATION && (
          <button
            type="button"
            onClick={() => setLocationFilter(ANY_LOCATION)}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: 'transparent',
              color: COLORS.textMuted,
              border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.pill,
              cursor: 'pointer',
              letterSpacing: 0.2,
            }}
          >
            Clear
          </button>
        )}
      </div>
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
            ? 'No tires yet. Add one from the home screen.'
            : 'No matches. Try a different search.'}
        </div>
      )}
      {shown.map((t) => (
        <TireCard key={t.id} tire={t} thumbUrl={photosByTire.get(t.id)} />
      ))}
    </main>
  );
}
