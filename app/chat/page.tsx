'use client';
import { useEffect, useRef, useState } from 'react';
import { COLORS } from '../../lib/theme';

type UiMsg = { role: 'user' | 'assistant'; text: string };
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };
type ApiMsg = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
type Voice = (typeof VOICES)[number];
const DEFAULT_VOICE: Voice = 'fable';

// Pick a MIME type that the browser can record AND that Whisper accepts.
// Android Chrome → webm/opus. iOS Safari → mp4. Whisper handles both.
function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function fileExtFor(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export default function ChatPage() {
  const [uiMessages, setUiMessages] = useState<UiMsg[]>([]);
  const [apiMessages, setApiMessages] = useState<ApiMsg[]>([]);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [supportsRecording, setSupportsRecording] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<Voice>(DEFAULT_VOICE);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});

  // Recording (STT input)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // TTS playback
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    sendRef.current = send;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setSupportsRecording(false);
    }
  }, []);

  // Cleanup on unmount — stop any in-flight stream/recorder/audio.
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) {
          try { t.stop(); } catch { /* ignore */ }
        }
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
      if (speakAbortRef.current) {
        try { speakAbortRef.current.abort(); } catch { /* ignore */ }
      }
      if (ttsAudioRef.current) {
        try { ttsAudioRef.current.pause(); } catch { /* ignore */ }
      }
      if (ttsUrlRef.current) {
        try { URL.revokeObjectURL(ttsUrlRef.current); } catch { /* ignore */ }
      }
    };
  }, []);

  // -------- TTS (OpenAI, streaming for low latency) --------
  const stopSpeaking = () => {
    if (speakAbortRef.current) {
      try { speakAbortRef.current.abort(); } catch { /* ignore */ }
      speakAbortRef.current = null;
    }
    if (ttsAudioRef.current) {
      const a = ttsAudioRef.current;
      // Detach handlers so onerror/onended after pause don't re-trigger us.
      a.onplay = null;
      a.onended = null;
      a.onerror = null;
      try { a.pause(); } catch { /* ignore */ }
      ttsAudioRef.current = null;
    }
    if (ttsUrlRef.current) {
      try { URL.revokeObjectURL(ttsUrlRef.current); } catch { /* ignore */ }
      ttsUrlRef.current = null;
    }
    setSpeaking(false);
  };

  // Stream OpenAI's MP3 directly into a MediaSource so playback starts on the
  // first audio frames, not after the whole file arrives.
  const playStreamingMSE = (res: Response, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (!res.body) return resolve();

      const mediaSource = new MediaSource();
      const url = URL.createObjectURL(mediaSource);
      ttsUrlRef.current = url;

      const audio = new Audio();
      ttsAudioRef.current = audio;
      audio.onplay = () => setSpeaking(true);
      audio.onended = () => { stopSpeaking(); resolve(); };
      audio.onerror = () => { stopSpeaking(); resolve(); };
      audio.src = url;

      const onAbort = () => { stopSpeaking(); resolve(); };
      signal.addEventListener('abort', onAbort, { once: true });

      mediaSource.addEventListener('sourceopen', async () => {
        let sb: SourceBuffer;
        try {
          sb = mediaSource.addSourceBuffer('audio/mpeg');
        } catch {
          stopSpeaking();
          return resolve();
        }

        const queue: Uint8Array[] = [];
        let streamDone = false;
        let appending = false;
        let started = false;

        const tryAppend = () => {
          if (signal.aborted || appending || sb.updating) return;
          if (queue.length > 0) {
            appending = true;
            try {
              // Copy into a fresh plain ArrayBuffer. The Uint8Array we get from
              // ReadableStream is typed Uint8Array<ArrayBufferLike>, which TS
              // 5.7+ won't accept as appendBuffer's BufferSource parameter.
              const chunk = queue.shift()!;
              const ab = new ArrayBuffer(chunk.byteLength);
              new Uint8Array(ab).set(chunk);
              sb.appendBuffer(ab);
            } catch {
              appending = false;
            }
          } else if (streamDone && mediaSource.readyState === 'open') {
            try { mediaSource.endOfStream(); } catch { /* ignore */ }
          }
        };

        sb.addEventListener('updateend', () => {
          appending = false;
          // Kick off playback as soon as the first chunk is buffered.
          if (!started) {
            started = true;
            audio.play().catch(() => { stopSpeaking(); resolve(); });
          }
          tryAppend();
        });

        try {
          const reader = res.body!.getReader();
          while (!signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value?.byteLength) {
              queue.push(value);
              tryAppend();
            }
          }
          streamDone = true;
          tryAppend();
        } catch {
          // Aborted or errored — onerror/onAbort will clean up.
        }
      });
    });

  // Fallback path for browsers without MSE support: wait for the full Blob.
  const playBuffered = async (res: Response) => {
    const blob = await res.blob();
    if (blob.size === 0) return;
    const url = URL.createObjectURL(blob);
    ttsUrlRef.current = url;
    const audio = new Audio(url);
    ttsAudioRef.current = audio;
    audio.onplay = () => setSpeaking(true);
    audio.onended = () => stopSpeaking();
    audio.onerror = () => stopSpeaking();
    try {
      await audio.play();
    } catch {
      stopSpeaking();
    }
  };

  const speak = async (text: string) => {
    if (!text) return;
    stopSpeaking();
    const controller = new AbortController();
    speakAbortRef.current = controller;
    try {
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, voice: selectedVoice }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return;
      const canStream =
        typeof window !== 'undefined' &&
        'MediaSource' in window &&
        typeof MediaSource.isTypeSupported === 'function' &&
        MediaSource.isTypeSupported('audio/mpeg');
      if (canStream) {
        await playStreamingMSE(res, controller.signal);
      } else {
        await playBuffered(res);
      }
    } catch {
      // Aborted (user tapped Stop voice) or network failure — silent fail.
    }
  };

  // -------- STT (MediaRecorder + Whisper) --------
  const startRecording = async () => {
    if (recording || transcribing) return;
    setError(null);
    stopSpeaking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];
      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Release the mic immediately so the OS indicator clears.
        const tracks = streamRef.current?.getTracks() ?? [];
        for (const t of tracks) {
          try { t.stop(); } catch { /* ignore */ }
        }
        streamRef.current = null;

        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size === 0) {
          setTranscribing(false);
          setError('No audio captured. Try again.');
          return;
        }
        void transcribeAndSend(blob);
      };

      recorder.start();
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'mic access denied');
      setRecording(false);
    }
  };

  const stopRecording = () => {
    if (!recording) return;
    // Flip flags synchronously so the UI swaps to "Transcribing…" immediately;
    // MediaRecorder.onstop fires async and triggers the upload.
    setRecording(false);
    setTranscribing(true);
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      setTranscribing(false);
    }
  };

  const transcribeAndSend = async (blob: Blob) => {
    try {
      const ext = fileExtFor(blob.type);
      const fd = new FormData();
      fd.append('file', blob, `audio.${ext}`);
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      setTranscribing(false);
      if (!res.ok) {
        setError(data.error || `transcribe ${res.status}`);
        return;
      }
      const text = (data.text || '').trim();
      if (!text) {
        setError('No speech detected. Try again.');
        return;
      }
      await sendRef.current(text);
    } catch (e) {
      setTranscribing(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleMic = () => {
    if (recording) stopRecording();
    else if (!transcribing && !sending) void startRecording();
  };

  // -------- Chat --------
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [uiMessages, sending, transcribing]);

  const send = async (text: string) => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    setDraft('');
    const nextUi = [...uiMessages, { role: 'user' as const, text }];
    const nextApi = [...apiMessages, { role: 'user' as const, content: text }];
    setUiMessages(nextUi);
    setApiMessages(nextApi);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: nextApi }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const reply: string = data.reply || '';
      setApiMessages(data.messages as ApiMsg[]);
      setUiMessages([...nextUi, { role: 'assistant' as const, text: reply }]);
      void speak(reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const micDisabled = !supportsRecording || transcribing || sending;
  const micBg = recording ? COLORS.redDeep : COLORS.red;
  const micGlow = recording ? '0 0 0 6px rgba(200,16,46,0.25)' : 'none';

  return (
    <main
      style={{
        padding: 16,
        fontFamily: 'sans-serif',
        width: '100%',
        maxWidth: 600,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        color: COLORS.textBody,
        background: COLORS.bg,
      }}
    >
      <style>{`
        @keyframes bs-pulse {
          0% { transform: scale(0.9); opacity: 0.7; }
          50% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0.9); opacity: 0.7; }
        }
      `}</style>

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 4,
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
        <h1 style={{ fontSize: 20, fontWeight: 800, color: COLORS.ink, margin: 0 }}>
          Voice chat
        </h1>
        <span style={{ width: 60 }} />
      </header>
      <p
        style={{
          color: COLORS.textMuted,
          fontSize: 12,
          margin: '0 0 10px',
          textAlign: 'center',
        }}
      >
        Tap the mic, speak naturally, then tap stop. The AI will confirm before saving any changes.
      </p>

      <div
        role="group"
        aria-label="AI voice"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: COLORS.textMuted,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginRight: 4,
          }}
        >
          Voice
        </span>
        {VOICES.map((v) => {
          const active = v === selectedVoice;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setSelectedVoice(v)}
              aria-pressed={active}
              style={{
                padding: '5px 11px',
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                background: active ? COLORS.redSoftBg : 'transparent',
                color: active ? COLORS.red : COLORS.textBody,
                border: `1px solid ${active ? COLORS.red : COLORS.borderStrong}`,
                borderRadius: 999,
                cursor: 'pointer',
                lineHeight: 1.2,
              }}
            >
              {v}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          minHeight: 32,
          marginBottom: 6,
        }}
      >
        {recording && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px',
              background: COLORS.redSoftBg,
              border: `1px solid ${COLORS.red}`,
              color: COLORS.red,
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: COLORS.red,
                animation: 'bs-pulse 1.1s ease-in-out infinite',
              }}
            />
            Recording — tap stop when finished
          </div>
        )}
        {transcribing && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px',
              background: COLORS.surface,
              border: `1px solid ${COLORS.borderStrong}`,
              color: COLORS.textBody,
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: COLORS.textMuted,
                animation: 'bs-pulse 1.1s ease-in-out infinite',
              }}
            />
            Transcribing your message…
          </div>
        )}
        {speaking && (
          <button
            type="button"
            onClick={stopSpeaking}
            aria-label="Stop voice playback"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              fontSize: 13,
              fontWeight: 600,
              background: COLORS.surface,
              color: COLORS.textBody,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 999,
              cursor: 'pointer',
            }}
          >
            🔇 Stop voice
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          border: `1px solid ${COLORS.border}`,
          borderRadius: 10,
          padding: 12,
          marginBottom: 12,
          background: COLORS.surface,
        }}
      >
        {uiMessages.length === 0 && (
          <p
            style={{
              color: COLORS.textMuted,
              fontSize: 14,
              textAlign: 'center',
              marginTop: 24,
            }}
          >
            Tap the mic and ask about your tires — e.g. &ldquo;how many winter tires do we have?&rdquo;
          </p>
        )}
        {uiMessages.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                maxWidth: '80%',
                padding: '8px 12px',
                borderRadius: 14,
                background: m.role === 'user' ? COLORS.red : COLORS.surface,
                color: m.role === 'user' ? '#fff' : COLORS.ink,
                border: m.role === 'user' ? 'none' : `1px solid ${COLORS.border}`,
                fontSize: 15,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                lineHeight: 1.35,
              }}
            >
              {m.text || (m.role === 'assistant' ? '…' : '')}
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ color: COLORS.textMuted, fontSize: 13, fontStyle: 'italic' }}>
            thinking…
          </div>
        )}
        {error && (
          <div style={{ color: COLORS.redDeep, fontSize: 13, marginTop: 8 }}>
            error: {error}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={toggleMic}
          disabled={micDisabled}
          aria-label={recording ? 'stop recording' : 'start recording'}
          aria-pressed={recording}
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            border: 'none',
            background: micBg,
            color: '#fff',
            fontSize: 28,
            cursor: micDisabled ? 'not-allowed' : 'pointer',
            opacity: micDisabled ? 0.5 : 1,
            flexShrink: 0,
            boxShadow: micGlow,
          }}
        >
          {recording ? '■' : '🎤'}
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send(draft);
          }}
          placeholder={supportsRecording ? 'or type here…' : 'mic not supported — type here'}
          style={{
            flex: 1,
            minWidth: 0,
            width: '100%',
            padding: 12,
            fontSize: 16,
            borderRadius: 8,
            border: `1px solid ${COLORS.borderStrong}`,
            background: COLORS.surface,
            color: COLORS.ink,
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={() => void send(draft)}
          disabled={sending || !draft.trim()}
          style={{
            padding: '12px 14px',
            fontSize: 16,
            background: COLORS.red,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: sending || !draft.trim() ? 'not-allowed' : 'pointer',
            fontWeight: 700,
            opacity: sending || !draft.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
      {!supportsRecording && (
        <p style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 8 }}>
          Voice input not supported in this browser. Type your message instead.
        </p>
      )}
    </main>
  );
}
