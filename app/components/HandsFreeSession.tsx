'use client';
// Hands-free voice session UI — renders above the existing tap-to-record
// mic row in VoiceChat. The existing tap-to-record stays exactly as it is;
// this is an additional second mode, mutually exclusive with the first
// (parent disables one while the other is active).
//
// Phase B2: captures VAD speech segments and logs them. The
// onTranscribedText callback is wired through for Phase B3, where each
// captured segment will be Whisper-transcribed and trigger-word-checked
// before being sent to the chat agent.

import { useCallback, useEffect, useRef, useState } from 'react';
import { COLORS, RADII } from '../../lib/theme';
import type {
  AutoStopReason,
  HandsfreeSession,
  HandsfreeStatus,
} from '../../lib/handsfree-vad';

function renderStatusText(args: {
  status: HandsfreeStatus;
  error: string | null;
  segCount: number;
  lastSegMs: number | null;
  autoStopReason: AutoStopReason | null;
}) {
  const { status, error, segCount, lastSegMs, autoStopReason } = args;
  if (status === 'error') {
    return <span style={{ color: COLORS.red }}>{error || 'Hands-free error'}</span>;
  }
  if (status === 'loading') return 'Loading voice model…';
  if (status === 'stopping') return 'Stopping…';
  if (status === 'speaking') {
    return (
      <>
        <strong>Hands-free ON</strong> &nbsp;
        <span style={{ color: COLORS.textMuted }}>capturing your voice…</span>
      </>
    );
  }
  if (status === 'listening') {
    const segNote = segCount > 0
      ? ` · ${segCount} segment${segCount === 1 ? '' : 's'}${lastSegMs ? `, last ${lastSegMs}ms` : ''}`
      : '';
    return (
      <>
        <strong>Hands-free ON</strong> &nbsp;
        <span style={{ color: COLORS.textMuted }}>
          listening — say &ldquo;done&rdquo; after each tire{segNote}
        </span>
      </>
    );
  }
  // status === 'idle'
  if (autoStopReason === 'inactivity') return 'Hands-free stopped (idle 5 min)';
  if (autoStopReason === 'backgrounded') return 'Hands-free stopped (tab backgrounded)';
  return 'Hands-free off';
}

interface Props {
  /** True when something else (tap-to-record, sending, etc.) needs us out of the way. */
  disabled: boolean;
  /** Parent uses this to disable the tap-to-record button while we're live. */
  onActiveChange: (active: boolean) => void;
}

export default function HandsFreeSession({
  disabled,
  onActiveChange,
}: Props) {
  const [status, setStatus] = useState<HandsfreeStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [segCount, setSegCount] = useState(0);
  const [lastSegMs, setLastSegMs] = useState<number | null>(null);
  const [autoStopReason, setAutoStopReason] = useState<AutoStopReason | null>(null);
  const sessionRef = useRef<HandsfreeSession | null>(null);

  // Notify parent on status transitions in/out of "live" states.
  useEffect(() => {
    const live = status === 'listening' || status === 'speaking' || status === 'loading';
    onActiveChange(live);
  }, [status, onActiveChange]);

  const handleStart = useCallback(async () => {
    if (sessionRef.current) return;
    setError(null);
    setAutoStopReason(null);
    setSegCount(0);
    setLastSegMs(null);

    // Dynamic import so the VAD bundle (+ the ONNX WASM blobs) only loads
    // when the user actually starts a hands-free session.
    const { createHandsfreeSession } = await import('../../lib/handsfree-vad');
    const session = createHandsfreeSession({
      onStatusChange: setStatus,
      onSpeechStart: () => {
        // No-op for now — status change handles the UI flicker.
      },
      onSpeechEnd: (audio, durationMs) => {
        setSegCount((n) => n + 1);
        setLastSegMs(durationMs);
        // Phase B2: log only. Phase B3 will transcribe + check trigger words
        // + call onTranscribedText.
        console.log('[handsfree] speech segment captured', {
          durationMs,
          samples: audio.length,
        });
      },
      onMisfire: () => {
        // Too-short segment — Silero discards. Show nothing; this is normal.
      },
      onError: (msg) => {
        setError(msg);
      },
      onAutoStop: (reason) => {
        setAutoStopReason(reason);
      },
    });
    sessionRef.current = session;
    try {
      await session.start();
    } catch (e: unknown) {
      // start() catches its own errors and routes them to onError, but in
      // case anything escapes, guard here too.
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleStop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) {
      setStatus('idle');
      return;
    }
    await session.stop('user');
    sessionRef.current = null;
  }, []);

  // Stop cleanly if the component unmounts mid-session (e.g., user navigates
  // away). Without this we'd leak the mic + AudioContext.
  useEffect(() => {
    return () => {
      sessionRef.current?.stop('user').catch(() => {});
      sessionRef.current = null;
    };
  }, []);

  const live = status === 'listening' || status === 'speaking' || status === 'loading';
  const indicatorColor =
    status === 'speaking' ? '#3a9d6a' :
    status === 'listening' ? '#5a7a9a' :
    status === 'loading' ? '#d29f3a' :
    status === 'error' ? COLORS.red :
    COLORS.textSubtle;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        background: live ? COLORS.redSoftBg : COLORS.surface,
        border: `1px solid ${live ? COLORS.red : COLORS.border}`,
        borderRadius: RADII.control,
        fontSize: 13,
        marginBottom: 8,
        flexShrink: 0,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: indicatorColor,
          animation: status === 'speaking' ? 'pulse 800ms ease-in-out infinite' : undefined,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, minWidth: 0, color: COLORS.textBody }}>
        {renderStatusText({ status, error, segCount, lastSegMs, autoStopReason })}
      </span>
      {!live ? (
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={disabled}
          aria-label="Start hands-free session"
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 700,
            background: COLORS.red,
            color: '#fff',
            border: 'none',
            borderRadius: RADII.control,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          Start hands-free
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void handleStop()}
          aria-label="Stop hands-free session"
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 700,
            background: COLORS.surface,
            color: COLORS.textBody,
            border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.control,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          Stop
        </button>
      )}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.5; transform: scale(0.9); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>
    </div>
  );
}
