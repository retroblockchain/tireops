'use client';
import { useEffect, useState } from 'react';
import { COLORS, RADII } from '../../lib/theme';

type Status = { spent: number; budget: number } | null;

export default function AiSpendBar() {
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai-spend')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setStatus(data);
      })
      .catch(() => {
        // Endpoint missing or transient error — bar stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;
  const { spent, budget } = status;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;

  // Tier the bar color by how close we are to the cap. Green is calm, yellow
  // is "keep an eye on it", red is "we're about to hit the wall."
  const barColor =
    pct >= 90 ? COLORS.red : pct >= 50 ? '#d29f3a' : '#3a9d6a';

  return (
    <div
      style={{
        padding: '10px 12px',
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: RADII.card,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.textBody }}>
          AI today
        </span>
        <span style={{ fontSize: 12, color: COLORS.textMuted }}>
          ${spent.toFixed(4)} / ${budget.toFixed(2)}
        </span>
      </div>
      <div
        aria-hidden
        style={{
          height: 4,
          background: COLORS.border,
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: barColor,
            transition: 'width 200ms ease',
          }}
        />
      </div>
    </div>
  );
}
