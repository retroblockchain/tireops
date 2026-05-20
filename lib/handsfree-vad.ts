'use client';
// Hands-free voice session wrapper around @ricky0123/vad-web's MicVAD.
//
// Encapsulates: model loading, AudioContext lifecycle, the inactivity timer
// (auto-stop after 5 min of no speech), the visibilitychange listener
// (auto-stop after 30s backgrounded), and clean teardown. The caller gets
// a small callback-driven interface and never has to think about the lower
// layers.
//
// For Phase B2: emits onSpeechEnd with raw 16 kHz mono Float32 audio.
// Phase B3 will hand those segments to Whisper + the chat agent.

import type { MicVAD } from '@ricky0123/vad-web';

export type HandsfreeStatus =
  | 'idle'
  | 'loading'
  | 'listening'
  | 'speaking'
  | 'stopping'
  | 'error';

export type AutoStopReason = 'user' | 'inactivity' | 'backgrounded';

export interface HandsfreeCallbacks {
  onStatusChange: (s: HandsfreeStatus) => void;
  onSpeechStart: () => void;
  /** audio is 16 kHz mono Float32 PCM in the -1..1 range. */
  onSpeechEnd: (audio: Float32Array, durationMs: number) => void;
  onMisfire: () => void;
  onError: (msg: string) => void;
  onAutoStop: (reason: AutoStopReason) => void;
}

export interface HandsfreeSession {
  start: () => Promise<void>;
  stop: (reason?: AutoStopReason) => Promise<void>;
}

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const BACKGROUND_THRESHOLD_MS = 30 * 1000;

export function createHandsfreeSession(
  cb: HandsfreeCallbacks,
): HandsfreeSession {
  let vad: MicVAD | null = null;
  let active = false;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
  let visibilityHandler: (() => void) | null = null;

  function setStatus(s: HandsfreeStatus) {
    cb.onStatusChange(s);
  }

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      void stop('inactivity');
    }, INACTIVITY_TIMEOUT_MS);
  }

  function clearInactivityTimer() {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }

  function attachVisibilityListener() {
    if (typeof document === 'undefined') return;
    visibilityHandler = () => {
      if (document.hidden) {
        // Don't immediately stop — user might be alt-tabbing for 2 seconds.
        // Start a timer; if still hidden after the threshold, auto-stop.
        if (backgroundTimer) clearTimeout(backgroundTimer);
        backgroundTimer = setTimeout(() => {
          void stop('backgrounded');
        }, BACKGROUND_THRESHOLD_MS);
      } else {
        // Came back visible — cancel the pending auto-stop.
        if (backgroundTimer) {
          clearTimeout(backgroundTimer);
          backgroundTimer = null;
        }
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }

  function detachVisibilityListener() {
    if (visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityHandler);
    }
    visibilityHandler = null;
    if (backgroundTimer) {
      clearTimeout(backgroundTimer);
      backgroundTimer = null;
    }
  }

  async function start(): Promise<void> {
    if (active) return;
    setStatus('loading');
    try {
      // Lazy-import keeps the ~3 MB VAD bundle out of the main chat surface
      // for users who never enter hands-free mode.
      const { MicVAD } = await import('@ricky0123/vad-web');
      vad = await MicVAD.new({
        model: 'v5',
        baseAssetPath: '/',
        onnxWASMBasePath: '/ort-wasm/',
        onSpeechStart: () => {
          resetInactivityTimer();
          setStatus('speaking');
          cb.onSpeechStart();
        },
        onSpeechEnd: (audio: Float32Array) => {
          const durationMs = Math.round((audio.length / 16000) * 1000);
          setStatus('listening');
          cb.onSpeechEnd(audio, durationMs);
        },
        onVADMisfire: () => {
          setStatus('listening');
          cb.onMisfire();
        },
      });
      await vad.start();
      active = true;
      resetInactivityTimer();
      attachVisibilityListener();
      setStatus('listening');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[handsfree] start failed:', msg);
      cb.onError(msg);
      setStatus('error');
      await teardown();
    }
  }

  async function teardown(): Promise<void> {
    clearInactivityTimer();
    detachVisibilityListener();
    if (vad) {
      try {
        await vad.destroy();
      } catch (e) {
        console.warn('[handsfree] destroy threw:', e);
      }
      vad = null;
    }
    active = false;
  }

  async function stop(reason: AutoStopReason = 'user'): Promise<void> {
    if (!active && reason === 'user') {
      // Idempotent stop from UI — fine.
      setStatus('idle');
      return;
    }
    setStatus('stopping');
    await teardown();
    setStatus('idle');
    if (reason !== 'user') cb.onAutoStop(reason);
  }

  return { start, stop };
}
