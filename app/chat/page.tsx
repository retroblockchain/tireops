'use client';
import { useEffect, useRef, useState } from 'react';

type UiMsg = { role: 'user' | 'assistant'; text: string };
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };
type ApiMsg = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

const ORANGE = '#E0500F';

export default function ChatPage() {
  const [uiMessages, setUiMessages] = useState<UiMsg[]>([]);
  const [apiMessages, setApiMessages] = useState<ApiMsg[]>([]);
  const [listening, setListening] = useState(false);
  const [sending, setSending] = useState(false);
  const [supportsSTT, setSupportsSTT] = useState(true);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');

  const recogRef = useRef<unknown>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const transcriptBufferRef = useRef<string>('');
  const interimBufferRef = useRef<string>('');
  const sentForSessionRef = useRef(false);
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});

  useEffect(() => {
    sendRef.current = send;
  });

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => unknown;
      webkitSpeechRecognition?: new () => unknown;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setSupportsSTT(false);
      return;
    }
    const r = new Ctor() as {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: (e: {
        resultIndex?: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
      }) => void;
      onend: () => void;
      onerror: (e: { error: string }) => void;
      start: () => void;
      stop: () => void;
    };
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = true;

    r.onresult = (e) => {
      if (sentForSessionRef.current) return;
      const start = e.resultIndex ?? 0;
      let newFinalText = '';
      let interimText = '';
      for (let i = start; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0]?.transcript ?? '';
        if (res.isFinal) newFinalText += t;
        else interimText += t;
      }
      if (newFinalText) {
        transcriptBufferRef.current = (transcriptBufferRef.current + ' ' + newFinalText)
          .replace(/\s+/g, ' ');
      }
      interimBufferRef.current = interimText;
      setLiveTranscript(
        (transcriptBufferRef.current + ' ' + interimBufferRef.current)
          .replace(/\s+/g, ' ')
          .trim(),
      );
    };

    r.onend = () => {
      setListening(false);
    };

    r.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setError(`mic: ${e.error}`);
      }
    };

    recogRef.current = r;
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [uiMessages, sending, liveTranscript]);

  const speak = (text: string) => {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  const stopSpeaking = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  const startListening = () => {
    const r = recogRef.current as
      | { start: () => void; continuous: boolean; interimResults: boolean }
      | null;
    if (!r) return;
    transcriptBufferRef.current = '';
    interimBufferRef.current = '';
    sentForSessionRef.current = false;
    setLiveTranscript('');
    setError(null);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
    try {
      r.continuous = true;
      r.interimResults = true;
      r.start();
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stopListening = () => {
    const r = recogRef.current as { stop: () => void } | null;
    if (sentForSessionRef.current) {
      if (r) {
        try {
          r.stop();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    sentForSessionRef.current = true;
    const text = (transcriptBufferRef.current + ' ' + interimBufferRef.current)
      .replace(/\s+/g, ' ')
      .trim();
    transcriptBufferRef.current = '';
    interimBufferRef.current = '';
    setLiveTranscript('');
    if (r) {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
    if (text) {
      void sendRef.current(text);
    }
  };

  const toggleMic = () => {
    if (listening) stopListening();
    else startListening();
  };

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
      speak(reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

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
      }}
    >
      <style>{`
        @keyframes tireops-pulse {
          0% { transform: scale(0.9); opacity: 0.7; }
          50% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0.9); opacity: 0.7; }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <a href="/" style={{ color: ORANGE, textDecoration: 'none', fontSize: 14 }}>&larr; Inventory</a>
        <h1 style={{ fontSize: 20, margin: 0 }}>Voice chat</h1>
        <span style={{ width: 60 }} />
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
        {listening && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px',
              background: '#fff0e6',
              border: `1px solid ${ORANGE}`,
              color: ORANGE,
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
                background: ORANGE,
                animation: 'tireops-pulse 1.1s ease-in-out infinite',
              }}
            />
            Listening — tap stop when finished
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
              background: '#fff',
              color: '#444',
              border: '1px solid #bbb',
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
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
          background: '#fafafa',
        }}
      >
        {uiMessages.length === 0 && (
          <p style={{ color: '#888', fontSize: 14, textAlign: 'center', marginTop: 24 }}>
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
                background: m.role === 'user' ? ORANGE : '#fff',
                color: m.role === 'user' ? '#fff' : '#222',
                border: m.role === 'user' ? 'none' : '1px solid #ddd',
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
        {listening && liveTranscript && (
          <div
            aria-live="polite"
            aria-atomic="true"
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                maxWidth: '80%',
                padding: '8px 12px',
                borderRadius: 14,
                background: '#fff',
                color: '#666',
                border: `2px dashed ${ORANGE}`,
                fontSize: 15,
                fontStyle: 'italic',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                lineHeight: 1.35,
              }}
            >
              {liveTranscript}
              <span style={{ color: ORANGE, marginLeft: 4 }}>▍</span>
            </div>
          </div>
        )}
        {sending && (
          <div style={{ color: '#888', fontSize: 13, fontStyle: 'italic' }}>thinking…</div>
        )}
        {error && (
          <div style={{ color: '#b00', fontSize: 13, marginTop: 8 }}>error: {error}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={toggleMic}
          disabled={!supportsSTT || sending}
          aria-label={listening ? 'stop listening' : 'start listening'}
          aria-pressed={listening}
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            border: 'none',
            background: listening ? '#b80' : ORANGE,
            color: '#fff',
            fontSize: 28,
            cursor: supportsSTT ? 'pointer' : 'not-allowed',
            opacity: supportsSTT ? 1 : 0.4,
            flexShrink: 0,
            boxShadow: listening ? '0 0 0 6px rgba(224,80,15,0.25)' : 'none',
          }}
        >
          {listening ? '■' : '🎤'}
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send(draft);
          }}
          placeholder={supportsSTT ? 'or type here…' : 'mic not supported — type here'}
          style={{
            flex: 1,
            minWidth: 0,
            width: '100%',
            padding: 12,
            fontSize: 16,
            borderRadius: 8,
            border: '1px solid #ccc',
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={() => void send(draft)}
          disabled={sending || !draft.trim()}
          style={{
            padding: '12px 14px',
            fontSize: 16,
            background: ORANGE,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            opacity: sending || !draft.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
      {!supportsSTT && (
        <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
          Voice input not supported in this browser. Try Chrome on Android or Safari on iOS.
        </p>
      )}
    </main>
  );
}
