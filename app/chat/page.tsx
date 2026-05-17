'use client';
import { useEffect, useRef, useState } from 'react';

type UiMsg = { role: 'user' | 'assistant'; text: string };
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };
type ApiMsg = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

type SpeechRecogResultEvent = {
  resultIndex?: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: SpeechRecogResultEvent) => void;
  onend: () => void;
  onerror: (e: { error: string }) => void;
  start: () => void;
  stop: () => void;
};

const ORANGE = '#E0500F';

// Build the displayed/dispatched transcript from the three storage layers.
// finals is keyed by resultIndex (the dedup key) so iteration is index-sorted.
function combineTranscript(
  committed: string,
  finals: Map<number, string>,
  interim: string,
): string {
  const finalsText = Array.from(finals.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => t.trim())
    .filter(Boolean)
    .join(' ');
  return (committed + ' ' + finalsText + ' ' + interim)
    .replace(/\s+/g, ' ')
    .trim();
}

export default function ChatPage() {
  const [uiMessages, setUiMessages] = useState<UiMsg[]>([]);
  const [apiMessages, setApiMessages] = useState<ApiMsg[]>([]);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [supportsSTT, setSupportsSTT] = useState(true);
  const [listening, setListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});

  // ---- Speech-to-text storage (mobile-reliable) ----
  // recogRef: the single recognizer instance.
  // wantListeningRef: user toggle. True between startListening() and stopListening().
  //                   Drives whether onend auto-restarts.
  // sentRef: single-dispatch guard for the OVERALL listening window. Once flipped
  //          (in stopListening), onresult is a no-op and onend won't restart.
  // committedTextRef: text rolled up from completed SUB-sessions in the current window.
  // currentFinalsRef: finals from the CURRENT sub-session, keyed by resultIndex.
  //                   Map.set() is idempotent on the same key — duplicate fires from
  //                   mobile Chrome at the same index just overwrite, never append.
  // lastIndexRef: highest resultIndex captured in the current sub-session. Used as a
  //               second guard: we only accept a final if its index is greater.
  // currentInterimRef: current sub-session in-flight interim text, replaced wholesale.
  // restartTimerRef: pending setTimeout id for the onend auto-restart.
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListeningRef = useRef(false);
  const sentRef = useRef(false);
  const committedTextRef = useRef('');
  const currentFinalsRef = useRef<Map<number, string>>(new Map());
  const lastIndexRef = useRef(-1);
  const currentInterimRef = useRef('');
  const restartTimerRef = useRef<number | null>(null);

  // Keep sendRef pointed at the latest send() — handlers bound once at mount
  // would otherwise capture a stale uiMessages/apiMessages closure.
  useEffect(() => {
    sendRef.current = send;
  });

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setSupportsSTT(false);
      return;
    }
    const r = new Ctor();
    r.lang = 'en-US';
    // continuous=false is the mobile-Chrome-reliable mode. Android often ignores
    // continuous=true and ends after the first utterance anyway. We synthesize
    // continuous behavior via the onend auto-restart below.
    r.continuous = false;
    r.interimResults = true;

    // Fold the current sub-session's finals into committedTextRef and reset
    // sub-session storage. Called on every onend (before any restart).
    const rotateSubSession = () => {
      const subFinals = Array.from(currentFinalsRef.current.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, t]) => t.trim())
        .filter(Boolean)
        .join(' ');
      if (subFinals) {
        committedTextRef.current = (committedTextRef.current + ' ' + subFinals)
          .replace(/\s+/g, ' ')
          .trim();
      }
      currentFinalsRef.current = new Map();
      currentInterimRef.current = '';
      lastIndexRef.current = -1;
    };

    r.onresult = (e) => {
      // Hard gate: once the overall session has been committed, drop everything.
      if (sentRef.current) return;

      let interimAccum = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0]?.transcript ?? '';
        if (!t) continue;

        if (res.isFinal) {
          // Dedup guard: index must be strictly greater than the highest already
          // captured in this sub-session. Map.set() is also idempotent on the
          // same key, so a re-fire at index N (the mobile bug) is dropped here.
          if (i > lastIndexRef.current) {
            currentFinalsRef.current.set(i, t);
            lastIndexRef.current = i;
          }
        } else {
          // Interim: each event is the full current interim view, just collect it.
          interimAccum += t;
        }
      }
      currentInterimRef.current = interimAccum.trim();

      setLiveTranscript(
        combineTranscript(
          committedTextRef.current,
          currentFinalsRef.current,
          currentInterimRef.current,
        ),
      );
    };

    r.onend = () => {
      // Always roll the sub-session into committed first — whether or not we
      // restart, we don't want to lose what was already finalized.
      rotateSubSession();

      if (wantListeningRef.current && !sentRef.current) {
        // User still has the mic toggled on — synthesize continuous behavior
        // by restarting the recognizer. Slight delay lets the engine fully
        // release; one retry covers the occasional InvalidStateError race.
        if (restartTimerRef.current != null) {
          window.clearTimeout(restartTimerRef.current);
        }
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null;
          if (!wantListeningRef.current || sentRef.current) return;
          try {
            r.start();
          } catch {
            restartTimerRef.current = window.setTimeout(() => {
              restartTimerRef.current = null;
              if (!wantListeningRef.current || sentRef.current) return;
              try {
                r.start();
              } catch (err2) {
                setError(err2 instanceof Error ? err2.message : String(err2));
                wantListeningRef.current = false;
                setListening(false);
              }
            }, 250);
          }
        }, 60);
      } else {
        setListening(false);
      }
    };

    r.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setError(`mic: ${e.error}`);
      }
      // onend fires after onerror; the restart logic there handles continuation.
    };

    recogRef.current = r;
  }, []);

  const startListening = () => {
    const r = recogRef.current;
    if (!r) return;

    // Full reset of every STT buffer + the dedup tracker + the guards.
    committedTextRef.current = '';
    currentFinalsRef.current = new Map();
    currentInterimRef.current = '';
    lastIndexRef.current = -1;
    wantListeningRef.current = true;
    sentRef.current = false;
    if (restartTimerRef.current != null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    setLiveTranscript('');
    setError(null);

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }

    try {
      r.start();
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      wantListeningRef.current = false;
    }
  };

  const stopListening = () => {
    const r = recogRef.current;

    // Duplicate-tap defense: if we already committed this listening window,
    // just make sure the recognizer is told to stop and bail.
    if (sentRef.current) {
      wantListeningRef.current = false;
      try { r?.stop(); } catch { /* ignore */ }
      return;
    }

    // Flip both flags synchronously BEFORE anything async, so any concurrent
    // onresult / onend is shut out and the auto-restart won't fire.
    wantListeningRef.current = false;
    sentRef.current = true;

    if (restartTimerRef.current != null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    const text = combineTranscript(
      committedTextRef.current,
      currentFinalsRef.current,
      currentInterimRef.current,
    );

    committedTextRef.current = '';
    currentFinalsRef.current = new Map();
    currentInterimRef.current = '';
    lastIndexRef.current = -1;
    setLiveTranscript('');
    setListening(false);

    try { r?.stop(); } catch { /* already stopped */ }

    if (text) void sendRef.current(text);
  };

  const toggleMic = () => {
    if (listening) stopListening();
    else startListening();
  };

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
