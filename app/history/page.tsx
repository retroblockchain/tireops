'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { COLORS, RADII, SHADOWS } from '../../lib/theme';
import { ActivityLogRow } from '../../lib/activity';
import { useCurrentShop } from '../../lib/useCurrentShop';

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function actionStyle(action: string): { color: string; label: string } {
  if (action === 'added') return { color: COLORS.red, label: 'Added' };
  if (action === 'deleted') return { color: COLORS.redDeep, label: 'Deleted' };
  if (action === 'edited') return { color: COLORS.textBody, label: 'Edited' };
  return { color: COLORS.textMuted, label: action };
}

export default function HistoryPage() {
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentShop = useCurrentShop();

  useEffect(() => {
    supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setRows((data as ActivityLogRow[]) || []);
        setLoading(false);
      });
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
        History
      </h1>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: '0 0 16px' }}>
        Recent inventory changes across all shops, newest first.
      </p>

      {loading && (
        <p style={{ color: COLORS.textMuted, fontSize: 14 }}>Loading…</p>
      )}
      {error && (
        <p style={{ color: COLORS.redDeep, fontSize: 13 }}>error: {error}</p>
      )}
      {!loading && rows.length === 0 && !error && (
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
          No activity yet. Add or edit a tire to see entries here.
        </div>
      )}

      {rows.map((r) => {
        const a = actionStyle(r.action);
        return (
          <article
            key={r.id}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: RADII.card,
              padding: 16,
              marginBottom: 12,
              boxShadow: SHADOWS.card,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  color: a.color,
                }}
              >
                {a.label}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: COLORS.textMuted,
                  whiteSpace: 'nowrap',
                }}
                title={new Date(r.created_at).toLocaleString()}
              >
                {formatRelative(r.created_at)}
              </span>
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: COLORS.ink,
                marginTop: 6,
                marginBottom: 10,
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                lineHeight: 1.35,
                letterSpacing: -0.1,
              }}
            >
              {r.tire_description || 'tire'}
            </div>
            <div
              style={{
                fontSize: 12,
                color: COLORS.textMuted,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: RADII.pill,
                  color: COLORS.red,
                  border: `1px solid ${COLORS.redDeep}`,
                  fontWeight: 600,
                  letterSpacing: 0.3,
                  whiteSpace: 'nowrap',
                  lineHeight: 1.4,
                }}
              >
                {r.shop || 'Unassigned'}
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: RADII.pill,
                  background: COLORS.surfaceSoft,
                  color: COLORS.textBody,
                  fontWeight: 600,
                  letterSpacing: 0.2,
                  whiteSpace: 'nowrap',
                  lineHeight: 1.4,
                }}
              >
                {r.source === 'voice'
                  ? '🎤 voice'
                  : r.source === 'file'
                    ? '📎 file'
                    : '📝 form'}
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  flex: '1 1 0',
                }}
                title={
                  r.employee_name
                    ? `${r.employee_name} (${r.user_email || 'unknown'})`
                    : r.user_email || ''
                }
              >
                {r.employee_name ? (
                  <>
                    <span style={{ color: COLORS.ink, fontWeight: 700 }}>
                      {r.employee_name}
                    </span>
                    <span style={{ opacity: 0.7 }}>
                      {' '}
                      ({r.user_email || 'unknown'})
                    </span>
                  </>
                ) : (
                  r.user_email || 'unknown'
                )}
              </span>
            </div>
          </article>
        );
      })}
    </main>
  );
}
