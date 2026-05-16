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
  const recogRef = useRef<unknown>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void;
      onerror: (e: { error: string }) => void;
      start: () => void;
      stop: () => void;
    };
    r.lang = 'en-US';
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      transcript = transcript.trim();
      if (transcript) void send(transcript);
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      setError(`mic: ${e.error}`);
    };
    recogRef.current = r;
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [uiMessages, sending]);

  const speak = (text: string) => {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    window.speechSynthesis.speak(u);
  };

  const toggleMic = () => {
    const r = recogRef.current as { start: () => void; stop: () => void } | null;
    if (!r) return;
    setError(null);
    if (listening) {
      r.stop();
      setListening(false);
    } else {
      try {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
        r.start();
        setListening(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
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
        maxWidth: 600,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <a href="/" style={{ color: ORANGE, textDecoration: 'none', fontSize: 14 }}>&larr; Inventory</a>
        <h1 style={{ fontSize: 20, margin: 0 }}>Voice chat</h1>
        <span style={{ width: 60 }} />
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
                lineHeight: 1.35,
              }}
            >
              {m.text || (m.role === 'assistant' ? '…' : '')}
            </div>
          </div>
        ))}
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
            padding: 12,
            fontSize: 16,
            borderRadius: 8,
            border: '1px solid #ccc',
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
