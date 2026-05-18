'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../../lib/theme';
import { useAuthInfo } from '../../lib/useCurrentShop';
import { UNASSIGNED_SHOP } from '../../lib/shops';

type BugReport = {
  id: string;
  description: string;
  reported_by: string | null;
  shop: string | null;
  source: 'manual' | 'ai';
  created_at: string;
};

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

export default function BugsPage() {
  const [bugs, setBugs] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState(false);
  const { shop: currentShop, email: currentUserEmail } = useAuthInfo();

  useEffect(() => {
    supabase
      .from('bug_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setBugs((data as BugReport[]) || []);
        setLoading(false);
      });
  }, []);

  const submit = async () => {
    const description = draft.trim();
    if (!description || submitting) return;
    setSubmitting(true);
    setError(null);
    setSubmitOk(false);
    const shop =
      currentShop && currentShop !== UNASSIGNED_SHOP ? currentShop : null;
    const { data, error: insertErr } = await supabase
      .from('bug_reports')
      .insert({
        description,
        reported_by: currentUserEmail,
        shop,
        source: 'manual',
      })
      .select()
      .single();
    if (insertErr) {
      setError(insertErr.message);
    } else if (data) {
      setBugs((prev) => [data as BugReport, ...prev]);
      setDraft('');
      setSubmitOk(true);
    }
    setSubmitting(false);
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
            padding: '3px 9px',
            background: COLORS.redSoftBg,
            color: COLORS.red,
            border: `1px solid ${COLORS.red}`,
            borderRadius: 999,
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
        Bug reports
      </h1>
      <p style={{ color: COLORS.textMuted, fontSize: 13, margin: '0 0 16px' }}>
        Describe what went wrong and we&apos;ll take a look.
      </p>

      <section
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 10,
          padding: 14,
          marginBottom: 20,
        }}
      >
        <label
          htmlFor="bug-desc"
          style={{
            display: 'block',
            fontSize: 13,
            color: COLORS.textBody,
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          Report a new bug
        </label>
        <textarea
          id="bug-desc"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. The voice mic stops listening too early when I pause to think."
          rows={3}
          style={{
            width: '100%',
            padding: 12,
            fontSize: 15,
            borderRadius: 8,
            border: `1px solid ${COLORS.borderStrong}`,
            background: COLORS.bg,
            color: COLORS.ink,
            boxSizing: 'border-box',
            resize: 'vertical',
            fontFamily: 'inherit',
            lineHeight: 1.4,
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 10,
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 11, color: COLORS.textMuted }}>
            Submitting as {currentUserEmail || 'unknown'}
          </span>
          <button
            onClick={submit}
            disabled={submitting || !draft.trim()}
            style={{
              padding: '10px 18px',
              fontSize: 14,
              background: COLORS.red,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              cursor: submitting || !draft.trim() ? 'not-allowed' : 'pointer',
              opacity: submitting || !draft.trim() ? 0.5 : 1,
            }}
          >
            {submitting ? 'Sending…' : 'Submit'}
          </button>
        </div>
        {error && (
          <p style={{ color: COLORS.redDeep, fontSize: 13, marginTop: 8 }}>
            error: {error}
          </p>
        )}
        {submitOk && (
          <p style={{ color: COLORS.red, fontSize: 13, marginTop: 8 }}>
            ✓ Bug report submitted. Thanks!
          </p>
        )}
      </section>

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
        Recent reports
      </h2>

      {loading && (
        <p style={{ color: COLORS.textMuted, fontSize: 14 }}>Loading…</p>
      )}
      {!loading && bugs.length === 0 && !error && (
        <div
          style={{
            textAlign: 'center',
            padding: '32px 16px',
            color: COLORS.textMuted,
            fontSize: 14,
            border: `1px dashed ${COLORS.border}`,
            borderRadius: 10,
            background: COLORS.surface,
          }}
        >
          No bug reports yet.
        </div>
      )}
      {bugs.map((b) => (
        <article
          key={b.id}
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: 14,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 15,
              color: COLORS.ink,
              marginBottom: 8,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
              lineHeight: 1.4,
            }}
          >
            {b.description}
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
                padding: '2px 8px',
                borderRadius: 99,
                color: COLORS.red,
                border: `1px solid ${COLORS.redDeep}`,
                fontWeight: 600,
                letterSpacing: 0.3,
                whiteSpace: 'nowrap',
              }}
            >
              {b.shop || 'Unassigned'}
            </span>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 99,
                background: COLORS.surfaceSoft,
                color: COLORS.textBody,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {b.source === 'ai' ? '🤖 AI' : '📝 manual'}
            </span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                flex: '1 1 0',
              }}
              title={b.reported_by || ''}
            >
              {b.reported_by || 'unknown'}
            </span>
            <span
              style={{ whiteSpace: 'nowrap' }}
              title={new Date(b.created_at).toLocaleString()}
            >
              {formatRelative(b.created_at)}
            </span>
          </div>
        </article>
      ))}
    </main>
  );
}
