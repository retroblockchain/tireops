'use client';
import { COLORS } from '../../lib/theme';
import {
  STALE_STYLE,
  daysInStock,
  isStale,
  statusStyle,
} from '../../lib/tireStatus';

type Tire = {
  id: string;
  tire_number?: number | string | null;
  shop?: string | null;
  size?: string | null;
  brand?: string | null;
  model?: string | null;
  season?: string | null;
  condition?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  status?: string | null;
  created_at?: string | null;
};

type Props = {
  tire: Tire;
  thumbUrl?: string | null;
};

export function TireCard({ tire: t, thumbUrl }: Props) {
  return (
    <a
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
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 12 }}>
        {thumbUrl && (
          <img
            src={thumbUrl}
            alt=""
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
            style={{
              width: 64,
              height: 64,
              borderRadius: 8,
              objectFit: 'cover',
              background: COLORS.surfaceSoft,
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontSize: 11,
                padding: '2px 9px',
                borderRadius: 99,
                background: 'transparent',
                color: COLORS.red,
                border: `1px solid ${COLORS.redDeep}`,
                fontWeight: 700,
                letterSpacing: 0.3,
                lineHeight: 1.4,
              }}
            >
              {t.shop || 'Unassigned'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {t.tire_number != null && t.tire_number !== '' && (
                <span
                  style={{
                    fontSize: 11,
                    color: COLORS.textMuted,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    fontWeight: 600,
                    letterSpacing: 0.2,
                  }}
                >
                  tire-{t.tire_number}
                </span>
              )}
              <span
                aria-hidden="true"
                style={{
                  color: COLORS.textSubtle,
                  fontSize: 22,
                  lineHeight: 1,
                }}
              >
                ›
              </span>
            </div>
          </div>
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
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 10,
              alignItems: 'center',
            }}
          >
            {t.status && t.status !== 'available' && (() => {
              const s = statusStyle(t.status);
              return (
                <span
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 99,
                    background: 'transparent',
                    color: s.color,
                    border: `1px solid ${s.border}`,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                  }}
                >
                  {s.label}
                </span>
              );
            })()}
            {isStale(t.created_at, t.status) && (
              <span
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 99,
                  background: 'transparent',
                  color: STALE_STYLE.color,
                  border: `1px solid ${STALE_STYLE.border}`,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                }}
                title={`In stock ${daysInStock(t.created_at)} days`}
              >
                ⚠ {daysInStock(t.created_at)}d
              </span>
            )}
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
                  background:
                    t.condition === 'new' ? COLORS.ink : 'transparent',
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
                  {t.quantity != null && t.quantity !== '' ? t.quantity : '—'}
                </span>
              </span>
              <span
                style={{ fontSize: 16, fontWeight: 700, color: COLORS.red }}
              >
                {t.price != null && t.price !== '' ? `$${t.price}` : '—'}
              </span>
            </span>
          </div>
        </div>
      </div>
    </a>
  );
}
