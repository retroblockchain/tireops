'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { COLORS, RADII } from '../../lib/theme';
import { loadFirstPhotosByTire } from '../../lib/photos';
import { useCurrentShop } from '../../lib/useCurrentShop';
import { isStale, STALE_STYLE } from '../../lib/tireStatus';
import { TireCard } from '../components/TireCard';

/**
 * Sort options offered in the "Sort by" dropdown. Defined in one place so
 * the <select> options and the comparator factory can't drift apart.
 */
const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest' },
  { key: 'brand', label: 'Brand (A-Z)' },
  { key: 'quantity', label: 'Quantity (high to low)' },
  { key: 'price', label: 'Price (high to low)' },
  { key: 'location', label: 'Location' },
  { key: 'tire_id', label: 'Tire ID' },
  { key: 'status', label: 'Status' },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]['key'];

/**
 * Build a comparator for the given sort key. Blank / unknown values sort
 * to the END for every key — keeps a long tail of unfilled fields from
 * elbowing useful rows down the list. Sort is applied AFTER all existing
 * filters, so it always operates on the user's visible subset.
 *
 * Array.prototype.sort is stable in modern JS, so ties preserve the
 * original (newest-first) fetch order — which is what you'd want anyway.
 */
function getSortComparator(sortBy: SortKey): (a: any, b: any) => number {
  const text = (v: unknown): string =>
    typeof v === 'string' ? v.trim().toLowerCase() : '';
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const numDesc = (a: unknown, b: unknown) => {
    const na = num(a);
    const nb = num(b);
    if (na == null && nb == null) return 0;
    if (na == null) return 1;
    if (nb == null) return -1;
    return nb - na;
  };
  const textAsc = (a: unknown, b: unknown) => {
    const ta = text(a);
    const tb = text(b);
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return ta.localeCompare(tb);
  };

  switch (sortBy) {
    case 'brand':
      return (a, b) => textAsc(a.brand, b.brand);
    case 'quantity':
      return (a, b) => numDesc(a.quantity, b.quantity);
    case 'price':
      return (a, b) => numDesc(a.price, b.price);
    case 'location':
      return (a, b) => textAsc(a.location, b.location);
    case 'tire_id':
      // Ascending — natural order tire-1, tire-2, … so staff scan top-down.
      return (a, b) => {
        const na = num(a.tire_number);
        const nb = num(b.tire_number);
        if (na == null && nb == null) return 0;
        if (na == null) return 1;
        if (nb == null) return -1;
        return na - nb;
      };
    case 'status': {
      // Workflow order, not alphabetical: in-stock first, then reserved /
      // pending. Anything else (legacy, unknown) sinks to the bottom.
      const order = ['available', 'reserved', 'pending'];
      return (a, b) => {
        const ia = order.indexOf((a.status || 'available').toLowerCase());
        const ib = order.indexOf((b.status || 'available').toLowerCase());
        const ra = ia === -1 ? order.length : ia;
        const rb = ib === -1 ? order.length : ib;
        return ra - rb;
      };
    }
    case 'newest':
    default:
      return (a, b) => {
        const tb = new Date(b.created_at || 0).getTime();
        const ta = new Date(a.created_at || 0).getTime();
        return tb - ta;
      };
  }
}

/**
 * Full searchable inventory. Lives off the dashboard so the home page can
 * stay focused on the chat. Supports free-text search across brand / size /
 * season / shop / location / friendly id, a sort-by selector, and an aging
 * (90+ days in stock) toggle. Sold tires don't appear here — they live on
 * /sold.
 */
export default function InventoryPage() {
  const [tires, setTires] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [photosByTire, setPhotosByTire] = useState<Map<string, string>>(
    new Map(),
  );
  const [staleOnly, setStaleOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('newest');
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
  // Search and the aging toggle run first; the sort applies LAST so it
  // always orders the visible subset the user is actually looking at.
  // Location is still part of the free-text haystack below — staff can
  // type "warehouse" / "container A" / etc. to narrow by location.
  const shown = liveTires
    .filter((t) => {
      const friendly = t.tire_number != null ? `tire-${t.tire_number}` : '';
      const text = `${friendly} ${t.brand} ${t.model} ${t.size} ${t.season} ${t.shop} ${t.location || ''}`.toLowerCase();
      return text.includes(q.toLowerCase());
    })
    .filter((t) => (staleOnly ? isStale(t.created_at, t.status) : true))
    .sort(getSortComparator(sortBy));

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
      {/*
        Sort row. Compact, wraps to a second line on narrow phones, never
        crowds the layout. Sort runs AFTER the search and stale-only filters
        so it always orders the user's visible subset.
      */}
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
          htmlFor="sort-select"
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            color: COLORS.textMuted,
          }}
        >
          ↕ Sort by
        </label>
        <select
          id="sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
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
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        {sortBy !== 'newest' && (
          <button
            type="button"
            onClick={() => setSortBy('newest')}
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
            Reset
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
