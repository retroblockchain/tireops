'use client';
// Minimal VAD smoke test — Phase B1 verification.
// Goal: confirm @ricky0123/vad-web initializes, detects voice, fires
// speech-start/end events in real time. Not a polished UI — instrumentation
// to prove the library works on Chrome + Android Chrome before we build the
// real hands-free flow in B2.

import { useEffect, useRef, useState } from 'react';
import { COLORS, RADII } from '../../lib/theme';

type Status = 'idle' | 'loading' | 'listening' | 'speaking' | 'stopped' | 'error';

interface Segment {
  index: number;
  durationMs: number;
  sampleCount: number;
  at: string;
}

export default function TestVadPage() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [misfires, setMisfires] = useState(0);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const vadRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const segIndex = useRef(0);

  async function start() {
    setStatus('loading');
    setError(null);
    try {
      // Dynamic import keeps the VAD bundle out of the main chat surface;
      // only this page (and later the hands-free session component) pulls it in.
      const { MicVAD } = await import('@ricky0123/vad-web');
      const vad = await MicVAD.new({
        model: 'v5',
        baseAssetPath: '/',                  // serves vad.worklet.bundle.min.js + silero_vad_v5.onnx
        onnxWASMBasePath: '/ort-wasm/',      // serves ort-wasm-simd-threaded(.jsep).wasm
        onSpeechStart: () => {
          setStatus('speaking');
        },
        onSpeechEnd: (audio: Float32Array) => {
          // Silero outputs at 16 kHz, so sampleCount / 16000 = seconds.
          const durationMs = Math.round((audio.length / 16000) * 1000);
          segIndex.current += 1;
          const seg: Segment = {
            index: segIndex.current,
            durationMs,
            sampleCount: audio.length,
            at: new Date().toLocaleTimeString(),
          };
          console.log('[VAD] speech-end:', seg);
          setSegments((prev) => [seg, ...prev].slice(0, 20));
          setStatus('listening');
        },
        onVADMisfire: () => {
          console.log('[VAD] misfire (segment too short)');
          setMisfires((n) => n + 1);
          setStatus('listening');
        },
        onFrameProcessed: () => {
          setFramesProcessed((n) => n + 1);
        },
      });
      vadRef.current = vad;
      await vad.start();
      setStatus('listening');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[VAD] init failed:', msg);
      setError(msg);
      setStatus('error');
    }
  }

  async function stop() {
    try {
      await vadRef.current?.destroy();
    } catch (e) {
      console.error('[VAD] destroy failed:', e);
    }
    vadRef.current = null;
    setStatus('stopped');
  }

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      vadRef.current?.destroy().catch(() => {});
    };
  }, []);

  const statusColor =
    status === 'speaking' ? '#3a9d6a' :
    status === 'listening' ? '#5a7a9a' :
    status === 'error' ? COLORS.red :
    status === 'loading' ? '#d29f3a' :
    COLORS.textMuted;

  return (
    <main style={{ padding: 24, maxWidth: 700, margin: '0 auto', color: COLORS.textBody, background: COLORS.bg, minHeight: '100dvh', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: COLORS.ink, marginBottom: 4 }}>VAD smoke test</h1>
      <p style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 20 }}>
        Phase B1 verification — proves @ricky0123/vad-web detects voice in real time.
        Open the browser console to see speech-end events as raw log lines.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {status === 'idle' || status === 'stopped' || status === 'error' ? (
          <button
            onClick={start}
            style={{ padding: '10px 20px', background: COLORS.red, color: '#fff', border: 'none', borderRadius: RADII.control, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}
          >
            Start VAD
          </button>
        ) : (
          <button
            onClick={stop}
            style={{ padding: '10px 20px', background: COLORS.surface, color: COLORS.textBody, border: `1px solid ${COLORS.border}`, borderRadius: RADII.control, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}
          >
            Stop VAD
          </button>
        )}
      </div>

      <div style={{ padding: 16, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADII.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: statusColor, transition: 'background 200ms' }} />
          <strong style={{ fontSize: 14 }}>{status}</strong>
        </div>
        <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.6 }}>
          frames processed: {framesProcessed.toLocaleString()}<br />
          speech segments: {segments.length} (capped at 20 visible)<br />
          misfires (too-short segments): {misfires}
        </div>
        {error && (
          <pre style={{ marginTop: 10, padding: 8, background: COLORS.redSoftBg, color: COLORS.red, fontSize: 12, borderRadius: 6, whiteSpace: 'pre-wrap' }}>{error}</pre>
        )}
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 700, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Recent speech segments</h2>
      {segments.length === 0 ? (
        <p style={{ fontSize: 13, color: COLORS.textMuted, fontStyle: 'italic' }}>None yet. Say something after clicking Start VAD.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
          {segments.map((s) => (
            <li key={s.index} style={{ padding: '6px 0', borderBottom: `1px solid ${COLORS.border}` }}>
              <strong>#{s.index}</strong> &nbsp; {s.durationMs} ms &nbsp; ({s.sampleCount.toLocaleString()} samples @ 16 kHz) &nbsp; <span style={{ color: COLORS.textMuted }}>{s.at}</span>
            </li>
          ))}
        </ul>
      )}

      <p style={{ fontSize: 12, color: COLORS.textSubtle, marginTop: 24 }}>
        This page is dev-only. It'll be deleted (or hidden) at sprint wrap.
      </p>
    </main>
  );
}
