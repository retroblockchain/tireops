'use client';
import { useEffect, useRef, useState } from 'react';
import { COLORS, RADII, SHADOWS } from '../../lib/theme';
import { useAuthInfo } from '../../lib/useCurrentShop';
import { uploadPendingPhoto } from '../../lib/photos';

type UiMsg = {
  role: 'user' | 'assistant';
  text: string;
  attachmentName?: string;
};
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };
type ApiMsg = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

const VOICES = ['shimmer', 'nova', 'onyx', 'echo', 'ash', 'coral'] as const;
type Voice = (typeof VOICES)[number];
const DEFAULT_VOICE: Voice = 'shimmer';
const VOICE_DESCRIPTIONS: Record<Voice, string> = {
  shimmer: 'Shimmer — soft & gentle',
  nova: 'Nova — bright & energetic',
  onyx: 'Onyx — deep & authoritative',
  echo: 'Echo — clear & articulate',
  ash: 'Ash — warm & friendly',
  coral: 'Coral — cheerful & warm',
};

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

const ATTACH_ACCEPT =
  'image/*,application/pdf,.pdf,.csv,.tsv,.xlsx,.xls,.xlsm';

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Heuristic: does the AI's reply ask the user for a yes/no confirmation?
 * Conservative on purpose — false negatives (no panel shown when it should)
 * are fine; false positives (panel shown for plain info questions) are
 * annoying. Matches the phrasings the system prompt instructs the AI to
 * use across delete, status, and file-import flows.
 */
function isConfirmationRequest(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/\bsay yes\b/.test(lower)) return true;
  if (/\bto confirm\b/.test(lower)) return true;
  if (/\bconfirm\?/.test(lower)) return true;
  if (/\b(yes\s+or\s+no|yes\/no)\b/.test(lower)) return true;
  if (/\bare you sure\b/.test(lower)) return true;
  const endsWithQuestion = /\?\s*$/.test(text.trim());
  if (endsWithQuestion) {
    if (/\b(should i|shall i|want me to|do you want)\b/.test(lower)) return true;
  }
  return false;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:<mime>;base64," prefix
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Persisted chat state — survives navigating to /add, /edit, etc. and back
 * within the same tab. Tab close still clears it (sessionStorage scope).
 * Attached image bytes are NOT in apiMessages (they're sent inline only),
 * so storage stays tiny — just prose and tool plumbing.
 */
const CHAT_STORAGE_KEY = 'bs-voicechat-v1';

type StoredChat = {
  uiMessages: UiMsg[];
  apiMessages: ApiMsg[];
  hasFileInSession: boolean;
  selectedVoice: Voice;
  collapsed: boolean;
};

function loadStoredChat(): StoredChat | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as StoredChat;
  } catch {
    return null;
  }
}

function saveStoredChat(state: StoredChat) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or serialize error — chat just won't persist this turn.
  }
}

type VoiceChatProps = {
  variant?: 'page' | 'embedded';
  initialCollapsed?: boolean;
};

export default function VoiceChat({
  variant = 'page',
  initialCollapsed = false,
}: VoiceChatProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const { shop: currentShop, email: currentUserEmail } = useAuthInfo();

  // `attachedFiles` is an array so the user can attach several photos (and
  // optionally a PDF/spreadsheet) in one chat message. Each entry gets its
  // own thumbnail preview and individual remove button below.
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [hasFileInSession, setHasFileInSession] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  // Tracks whether we've finished the sessionStorage rehydrate pass. The
  // welcome message and the persist effect both gate on this so we don't
  // wipe stored chat or double-greet on a quick nav round-trip.
  const [hydrated, setHydrated] = useState(false);
  // Two-step "New chat" affordance. First tap arms the button (changes label
  // to "Tap again"); a second tap within 3 s actually clears. After 3 s of
  // inaction it disarms on its own. Avoids accidental wipes without a modal.
  const [clearArmed, setClearArmed] = useState(false);
  const clearArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    sendRef.current = send;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (
      typeof MediaRecorder === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setSupportsRecording(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) {
          try { t.stop(); } catch { /* ignore */ }
        }
      }
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
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
      if (clearArmTimerRef.current) {
        clearTimeout(clearArmTimerRef.current);
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

      signal.addEventListener('abort', () => { stopSpeaking(); resolve(); }, { once: true });

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
      // Aborted or network failure.
    }
  };

  // -------- Chat persistence (sessionStorage) --------
  // Restore on mount so a quick trip to /add or /edit/[id] and back doesn't
  // lose the active conversation. Persist on every settled change.
  useEffect(() => {
    const stored = loadStoredChat();
    if (stored) {
      if (Array.isArray(stored.uiMessages)) setUiMessages(stored.uiMessages);
      if (Array.isArray(stored.apiMessages)) setApiMessages(stored.apiMessages);
      if (typeof stored.hasFileInSession === 'boolean') {
        setHasFileInSession(stored.hasFileInSession);
      }
      if (
        stored.selectedVoice &&
        (VOICES as readonly string[]).includes(stored.selectedVoice)
      ) {
        setSelectedVoice(stored.selectedVoice);
      }
      if (typeof stored.collapsed === 'boolean') setCollapsed(stored.collapsed);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Skip writes mid-stream — apiMessages is briefly inconsistent (trailing
    // user msg with no response) until /api/chat replies with finalMessages.
    if (sending) return;
    saveStoredChat({
      uiMessages,
      apiMessages,
      hasFileInSession,
      selectedVoice,
      collapsed,
    });
  }, [
    hydrated,
    sending,
    uiMessages,
    apiMessages,
    hasFileInSession,
    selectedVoice,
    collapsed,
  ]);

  // -------- "New chat" / clear --------
  // Two-step click. First call arms the button for 3 s; second call within
  // that window actually clears state + storage. Never auto-fires — only
  // the user can wipe their conversation. After clearing, the empty chat
  // shows the placeholder hint (no welcome greeting).
  const clearChat = () => {
    if (clearArmed) {
      stopSpeaking();
      setUiMessages([]);
      setApiMessages([]);
      setHasFileInSession(false);
      setAttachedFiles([]);
      setDraft('');
      setError(null);
      try {
        sessionStorage.removeItem(CHAT_STORAGE_KEY);
      } catch {
        /* storage unavailable — persist effect will rewrite anyway */
      }
      setClearArmed(false);
      if (clearArmTimerRef.current) {
        clearTimeout(clearArmTimerRef.current);
        clearArmTimerRef.current = null;
      }
      return;
    }
    // First tap — arm and start the 3 s revert timer.
    setClearArmed(true);
    if (clearArmTimerRef.current) clearTimeout(clearArmTimerRef.current);
    clearArmTimerRef.current = setTimeout(() => {
      setClearArmed(false);
      clearArmTimerRef.current = null;
    }, 3000);
  };

  const clearDisabled =
    sending || recording || transcribing || uiMessages.length === 0;

  // -------- STT (MediaRecorder + Whisper) --------
  const startRecording = async () => {
    if (recording || transcribing) return;
    setError(null);
    stopSpeaking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      audioChunksRef.current = [];
      const mimeType = pickMimeType();
      const recorderOpts: MediaRecorderOptions = { audioBitsPerSecond: 32000 };
      if (mimeType) recorderOpts.mimeType = mimeType;
      const recorder = new MediaRecorder(stream, recorderOpts);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const tracks = streamRef.current?.getTracks() ?? [];
        for (const t of tracks) {
          try { t.stop(); } catch { /* ignore */ }
        }
        streamRef.current = null;

        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        const blob = new Blob(chunks, {
          type: recorder.mimeType || 'audio/webm',
        });
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
    // Use 'auto' (instant) instead of 'smooth' — text streams in many small
    // updates per second, and a smooth scroll gets interrupted before it
    // reaches the bottom each time. Instant keeps the latest word visible.
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'auto',
    });
  }, [uiMessages, sending, transcribing]);

  // Rebuild preview object URLs whenever the attached list changes; revoke
  // the previous batch so we don't leak blob URLs. Non-image files don't get
  // an object URL — the grid below renders a name-only tile for them.
  useEffect(() => {
    const urls = attachedFiles.map((f) =>
      f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
    );
    setFilePreviews(urls);
    return () => {
      for (const u of urls) {
        if (u) {
          try { URL.revokeObjectURL(u); } catch { /* ignore */ }
        }
      }
    };
  }, [attachedFiles]);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    // Reset the input so the user can re-pick the same file later if they
    // removed it from the pending list.
    e.target.value = '';
    if (picked.length === 0) return;

    // Per-file size check — flag any oversized ones, accept the rest.
    const accepted: File[] = [];
    const tooBig: string[] = [];
    for (const f of picked) {
      if (f.size > MAX_ATTACHMENT_BYTES) tooBig.push(f.name);
      else accepted.push(f);
    }
    if (accepted.length > 0) {
      setAttachedFiles((prev) => [...prev, ...accepted]);
    }
    if (tooBig.length > 0) {
      const limit = Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024);
      setError(
        `Skipped ${tooBig.length} file${tooBig.length === 1 ? '' : 's'} over ${limit} MB: ${tooBig.join(', ')}`,
      );
    } else {
      setError(null);
    }
  };

  const removeAttachedFile = (i: number) => {
    setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i));
  };

  const clearAttachedFiles = () => setAttachedFiles([]);

  const send = async (text: string) => {
    const files = attachedFiles;
    if ((!text.trim() && files.length === 0) || sending) return;

    setSending(true);
    setError(null);
    setDraft('');

    // If the user attached files but typed nothing, send a default prompt
    // that nudges Claude into "read and propose" mode (no auto-add).
    const effectiveText =
      text.trim() ||
      (files.length > 0
        ? files.length === 1
          ? 'Read this attached file and list every tire entry you find. Do NOT add anything yet — wait for my confirmation.'
          : `Read these ${files.length} attached files and list every tire entry you find across them. Do NOT add anything yet — wait for my confirmation.`
        : '');

    type Attachment = {
      name: string;
      type: string;
      base64?: string;
      photoUrl?: string;
    };
    let attachments: Attachment[] = [];
    if (files.length > 0) {
      try {
        // Upload images to Supabase Storage in parallel (URL only goes over
        // the wire to /api/chat — never base64 — so we stay well under
        // Vercel's 4.5 MB body limit even for several phone-camera photos).
        // PDFs/spreadsheets still go as base64 since they're small.
        attachments = await Promise.all(
          files.map(async (file): Promise<Attachment> => {
            if (file.type.startsWith('image/')) {
              const url = await uploadPendingPhoto(file);
              if (!url) {
                throw new Error(`Photo upload failed for "${file.name}"`);
              }
              return { name: file.name, type: file.type, photoUrl: url };
            } else {
              const base64 = await fileToBase64(file);
              return { name: file.name, type: file.type, base64 };
            }
          }),
        );
      } catch (e) {
        setError(
          e instanceof Error
            ? `${e.message} — please try again, or remove that file.`
            : 'Failed to upload an attached file.',
        );
        setSending(false);
        return;
      }
    }

    const attachmentLabel =
      files.length === 0
        ? undefined
        : files.length === 1
          ? files[0].name
          : `${files.length} files (${files
              .slice(0, 2)
              .map((f) => f.name)
              .join(', ')}${files.length > 2 ? '…' : ''})`;

    const nextUi = [
      ...uiMessages,
      {
        role: 'user' as const,
        text: effectiveText,
        attachmentName: attachmentLabel,
      },
    ];
    const nextApi = [
      ...apiMessages,
      { role: 'user' as const, content: effectiveText },
    ];
    setUiMessages(nextUi);
    setApiMessages(nextApi);
    if (files.length > 0) {
      setAttachedFiles([]);
      setHasFileInSession(true);
    }

    // Optimistically place an empty assistant bubble next to the user's
    // message. The bubble renders animated typing dots until the first
    // text delta arrives, then streams in word by word.
    setUiMessages([...nextUi, { role: 'assistant' as const, text: '' }]);

    let accumulatedText = '';
    let finalMessages: ApiMsg[] | null = null;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: nextApi,
          currentShop,
          currentUserEmail,
          hasFileInSession: hasFileInSession || files.length > 0,
          // Always send the array. The server also accepts the legacy
          // singular `attachment` field for older clients.
          attachments: attachments.length > 0 ? attachments : undefined,
        }),
      });
      if (!res.ok || !res.body) {
        // Try to read the body so we can surface a useful error. A 413 from
        // Vercel comes back as plain text ("Request Entity Too Large"), not
        // JSON — avoid feeding it to JSON.parse.
        let detail = '';
        try {
          detail = (await res.text()).slice(0, 200);
        } catch {
          /* ignore */
        }
        if (res.status === 413 || /too large|entity too large/i.test(detail)) {
          throw new Error(
            'Upload too large — the server rejected the request. Please try a smaller file.',
          );
        }
        throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: { type?: string; text?: string; messages?: ApiMsg[]; error?: string };
          try {
            event = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (event.type === 'delta' && typeof event.text === 'string') {
            accumulatedText += event.text;
            // Mutate the trailing assistant bubble's text in place — React
            // re-renders only that bubble's text node.
            const snapshot = accumulatedText;
            setUiMessages((prev) => {
              const copy = [...prev];
              const lastIdx = copy.length - 1;
              const last = copy[lastIdx];
              if (last && last.role === 'assistant') {
                copy[lastIdx] = { ...last, text: snapshot };
              }
              return copy;
            });
          } else if (event.type === 'end' && Array.isArray(event.messages)) {
            finalMessages = event.messages;
          } else if (event.type === 'error') {
            throw new Error(event.error || 'stream error');
          }
        }
      }

      if (finalMessages) {
        setApiMessages(finalMessages);
      }

      // Fire TTS the instant streaming ends. (Streaming the audio itself
      // is already incremental via MSE inside speak().)
      if (accumulatedText.trim()) {
        void speak(accumulatedText.trim());
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // "Unexpected token 'R', \"Request En\"..." is what surfaces when a
      // proxy (or the Supabase client's internal parser) tried to parse a
      // non-JSON response — almost always "Request Entity Too Large".
      // Translate to something the user can act on.
      const looksLikeJsonError =
        /unexpected token|not valid json|json\.parse/i.test(raw);
      const looksLikeTooLarge = /too large|entity too large|payload too large/i.test(raw);
      const friendly =
        looksLikeJsonError || looksLikeTooLarge
          ? 'Photo upload failed — the image may be too large. Try a smaller photo or take a new one.'
          : raw;
      setError(friendly);
      // Remove the empty assistant placeholder if the stream never produced
      // any text (so the chat doesn't show a perpetually-typing bubble).
      setUiMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant' && !last.text) {
          copy.pop();
        }
        return copy;
      });
    } finally {
      setSending(false);
    }
  };

  const micDisabled = !supportsRecording || transcribing || sending;
  const micBg = recording ? COLORS.redDeep : COLORS.red;
  const micGlow = recording ? '0 0 0 6px rgba(200,16,46,0.25)' : 'none';

  const innerContent = (
    <>
      <style>{`
        @keyframes bs-pulse {
          0% { transform: scale(0.9); opacity: 0.7; }
          50% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0.9); opacity: 0.7; }
        }
        @keyframes bs-typing {
          0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
      `}</style>

      {variant === 'page' && (
        <p
          style={{
            color: COLORS.textMuted,
            fontSize: 12,
            margin: '0 0 10px',
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          Tap the mic, speak naturally, then tap stop. The AI will confirm
          before saving any changes.
        </p>
      )}

      {/*
        Row 1 of the panel: voice picker on the left, "New chat" reset on
        the right. The clear button is intentionally small and quiet —
        it's there if you need it, never the visual focus.
      */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
          flexWrap: 'wrap',
        }}
      >
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          color: COLORS.textMuted,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        Voice
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <select
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value as Voice)}
            aria-label="AI voice"
            style={{
              appearance: 'none',
              WebkitAppearance: 'none',
              MozAppearance: 'none',
              padding: '5px 26px 5px 12px',
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'none',
              letterSpacing: 0,
              background: COLORS.redSoftBg,
              color: COLORS.red,
              border: `1px solid ${COLORS.red}`,
              borderRadius: RADII.pill,
              cursor: 'pointer',
              lineHeight: 1.2,
              fontFamily: 'inherit',
            }}
          >
            {VOICES.map((v) => (
              <option key={v} value={v}>
                {VOICE_DESCRIPTIONS[v]}
              </option>
            ))}
          </select>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: 9,
              top: '50%',
              transform: 'translateY(-55%)',
              pointerEvents: 'none',
              fontSize: 10,
              color: COLORS.red,
              lineHeight: 1,
            }}
          >
            ▾
          </span>
        </span>
      </label>
        <button
          type="button"
          onClick={clearChat}
          disabled={clearDisabled}
          aria-label={
            clearArmed ? 'Tap again to clear the chat' : 'Start a new chat'
          }
          title={
            clearArmed
              ? 'Tap again within 3 seconds to clear'
              : 'New chat — clears the current conversation'
          }
          style={{
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            background: clearArmed ? COLORS.redSoftBg : 'transparent',
            color: clearArmed ? COLORS.red : COLORS.textMuted,
            border: `1px solid ${clearArmed ? COLORS.red : COLORS.border}`,
            borderRadius: RADII.pill,
            cursor: clearDisabled ? 'not-allowed' : 'pointer',
            opacity: clearDisabled ? 0.4 : 1,
            fontFamily: 'inherit',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}
        >
          {clearArmed ? 'Tap again' : '↻ New chat'}
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          marginBottom: recording || transcribing ? 6 : 0,
          flexShrink: 0,
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
              padding: '5px 12px',
              background: COLORS.redSoftBg,
              border: `1px solid ${COLORS.red}`,
              color: COLORS.red,
              borderRadius: RADII.pill,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 0.1,
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
              padding: '5px 12px',
              background: COLORS.surface,
              border: `1px solid ${COLORS.borderStrong}`,
              color: COLORS.textBody,
              borderRadius: RADII.pill,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0.1,
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
      </div>

      <div
        ref={scrollRef}
        style={{
          // flex:1 lets the scroll absorb spare panel height. minHeight:60
          // is small enough that when the attachment strip / recording pill
          // / speaking pill all appear at once, the chat shrinks instead of
          // pushing the mic and Send controls off the bottom of the screen.
          flex: 1,
          minHeight: 60,
          overflowY: 'auto',
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADII.card,
          padding: 14,
          marginBottom: 12,
          background: variant === 'page' ? COLORS.surface : COLORS.bg,
        }}
      >
        {uiMessages.length === 0 && (
          <div
            style={{
              color: COLORS.textMuted,
              fontSize: 14,
              textAlign: 'center',
              padding: '20px 12px',
              lineHeight: 1.5,
            }}
          >
            <p style={{ margin: 0, color: COLORS.textBody, fontWeight: 600 }}>
              Ask me anything about your inventory.
            </p>
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 13,
                color: COLORS.textMuted,
              }}
            >
              Add tires, search, update stock, mark as sold…
            </p>
          </div>
        )}
        {uiMessages.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 10,
            }}
          >
            <div
              style={{
                maxWidth: '82%',
                padding: '9px 13px',
                borderRadius: 16,
                background: m.role === 'user' ? COLORS.red : COLORS.surface,
                color: m.role === 'user' ? '#fff' : COLORS.ink,
                border:
                  m.role === 'user' ? 'none' : `1px solid ${COLORS.border}`,
                fontSize: 15,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                lineHeight: 1.4,
                boxShadow: m.role === 'assistant' ? SHADOWS.card : 'none',
              }}
            >
              {m.attachmentName && (
                <div
                  style={{
                    fontSize: 12,
                    opacity: 0.85,
                    marginBottom: m.text ? 4 : 0,
                    fontWeight: 600,
                  }}
                >
                  📎 {m.attachmentName}
                </div>
              )}
              {m.text ? (
                m.text
              ) : m.role === 'assistant' ? (
                <span
                  aria-label="Thinking"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 0',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: COLORS.textMuted,
                      animation: 'bs-typing 1.2s 0s infinite ease-in-out',
                    }}
                  />
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: COLORS.textMuted,
                      animation: 'bs-typing 1.2s 0.18s infinite ease-in-out',
                    }}
                  />
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: COLORS.textMuted,
                      animation: 'bs-typing 1.2s 0.36s infinite ease-in-out',
                    }}
                  />
                </span>
              ) : (
                ''
              )}
            </div>
          </div>
        ))}
        {(() => {
          const last = uiMessages[uiMessages.length - 1];
          if (!last || last.role !== 'assistant') return null;
          if (sending) return null;
          if (!isConfirmationRequest(last.text)) return null;
          return (
            <div
              style={{
                margin: '14px auto 4px',
                padding: 14,
                background: COLORS.surfaceSoft,
                border: `1px solid ${COLORS.border}`,
                borderRadius: RADII.card,
                boxShadow: SHADOWS.card,
              }}
              role="group"
              aria-label="Confirmation"
            >
              <p
                style={{
                  fontSize: 13,
                  color: COLORS.textBody,
                  margin: '0 0 12px',
                  textAlign: 'center',
                  fontWeight: 600,
                  letterSpacing: 0.1,
                }}
              >
                Do you want to confirm?
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void send('yes')}
                  disabled={sending}
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    padding: '12px 16px',
                    background: '#2E7D32',
                    color: '#fff',
                    border: 'none',
                    borderRadius: RADII.control,
                    fontSize: 15,
                    fontWeight: 700,
                    letterSpacing: -0.1,
                    cursor: sending ? 'not-allowed' : 'pointer',
                    opacity: sending ? 0.5 : 1,
                    boxShadow: SHADOWS.card,
                  }}
                >
                  ✓ Confirm
                </button>
                <button
                  type="button"
                  onClick={() => void send('no')}
                  disabled={sending}
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    padding: '12px 16px',
                    background: COLORS.surface,
                    color: COLORS.textBody,
                    border: `1px solid ${COLORS.borderStrong}`,
                    borderRadius: RADII.control,
                    fontSize: 15,
                    fontWeight: 700,
                    letterSpacing: -0.1,
                    cursor: sending ? 'not-allowed' : 'pointer',
                    opacity: sending ? 0.5 : 1,
                  }}
                >
                  ✕ Cancel
                </button>
              </div>
            </div>
          );
        })()}
        {/* The empty-assistant-bubble typing dots above replace the old
            inline "thinking…" indicator — same signal, more contextual. */}
        {error && (
          <div
            style={{ color: COLORS.redDeep, fontSize: 13, marginTop: 8 }}
          >
            error: {error}
          </div>
        )}
      </div>

      {speaking && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBottom: 8,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={stopSpeaking}
            aria-label="Stop voice playback"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              background: COLORS.surface,
              color: COLORS.textBody,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: RADII.pill,
              cursor: 'pointer',
              letterSpacing: 0.1,
            }}
          >
            🔇 Stop voice
          </button>
        </div>
      )}

      {attachedFiles.length > 0 && (
        <div
          // Compact, single-row attachment strip. The container has a fixed
          // height and the inner strip scrolls horizontally for many files —
          // so the mic + Send below NEVER get pushed off-screen, no matter
          // how many photos are attached.
          style={{
            flexShrink: 0,
            marginBottom: 8,
            padding: 6,
            background: COLORS.surfaceSoft,
            border: `1px solid ${COLORS.border}`,
            borderRadius: RADII.control,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              overflowX: 'auto',
              overflowY: 'hidden',
              // Touch-momentum on iOS; harmless elsewhere.
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {attachedFiles.map((file, i) => {
              const preview = filePreviews[i];
              const isImage = file.type.startsWith('image/');
              return (
                <div
                  key={`${file.name}-${i}`}
                  style={{
                    position: 'relative',
                    flexShrink: 0,
                    width: 56,
                    height: 56,
                    borderRadius: RADII.control,
                    overflow: 'hidden',
                    background: COLORS.surface,
                    border: `1px solid ${COLORS.border}`,
                    boxShadow: SHADOWS.card,
                  }}
                  title={file.name}
                >
                  {isImage && preview ? (
                    <img
                      src={preview}
                      alt=""
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 3,
                        color: COLORS.textBody,
                        textAlign: 'center',
                        fontSize: 9,
                        fontWeight: 600,
                        lineHeight: 1.15,
                        wordBreak: 'break-word',
                      }}
                    >
                      <span style={{ fontSize: 18, lineHeight: 1 }}>📎</span>
                      <span
                        style={{
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {file.name}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(i)}
                    aria-label={`Remove ${file.name}`}
                    disabled={sending}
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      border: 'none',
                      background: 'rgba(0,0,0,0.78)',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: sending ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      lineHeight: 1,
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {attachedFiles.length > 1 && (
              <button
                type="button"
                onClick={clearAttachedFiles}
                disabled={sending}
                aria-label="Remove all attachments"
                title="Remove all"
                style={{
                  flexShrink: 0,
                  width: 56,
                  height: 56,
                  borderRadius: RADII.control,
                  border: `1px dashed ${COLORS.border}`,
                  background: 'transparent',
                  color: COLORS.textMuted,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  cursor: sending ? 'not-allowed' : 'pointer',
                  lineHeight: 1.1,
                }}
              >
                Clear
                <br />
                all
              </button>
            )}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACH_ACCEPT}
        multiple
        onChange={onPickFile}
        style={{ display: 'none' }}
      />

      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          // Pad the mic row so the big circular button has breathing room
          // from the chat scroll above and from anything below the panel.
          paddingTop: 4,
          // flexShrink:0 keeps the mic + Send row anchored at the bottom
          // even when the chat scroll, attachment strip, and pills are all
          // competing for vertical space.
          flexShrink: 0,
        }}
      >
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
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          aria-label="Attach a file"
          title="Attach a photo, PDF, or spreadsheet"
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: COLORS.surface,
            color: COLORS.textBody,
            border: `1px solid ${COLORS.borderStrong}`,
            fontSize: 20,
            cursor: sending ? 'not-allowed' : 'pointer',
            opacity: sending ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          📎
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send(draft);
          }}
          placeholder={
            supportsRecording ? 'or type here…' : 'mic not supported — type here'
          }
          style={{
            flex: 1,
            minWidth: 0,
            width: '100%',
            padding: '12px 14px',
            fontSize: 16,
            borderRadius: RADII.control,
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
            padding: '12px 16px',
            fontSize: 15,
            background: COLORS.red,
            color: '#fff',
            border: 'none',
            borderRadius: RADII.control,
            cursor: sending || !draft.trim() ? 'not-allowed' : 'pointer',
            fontWeight: 700,
            letterSpacing: -0.1,
            opacity: sending || !draft.trim() ? 0.5 : 1,
            boxShadow: SHADOWS.card,
          }}
        >
          Send
        </button>
      </div>
      {!supportsRecording && (
        <p
          style={{
            fontSize: 12,
            color: COLORS.textMuted,
            marginTop: 8,
            flexShrink: 0,
          }}
        >
          Voice input not supported in this browser. Type your message instead.
        </p>
      )}
    </>
  );

  if (variant === 'embedded') {
    return (
      <section
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: RADII.card,
          marginBottom: 24,
          overflow: 'hidden',
          boxShadow: SHADOWS.card,
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls="voicechat-body"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            background: 'transparent',
            border: 'none',
            color: COLORS.ink,
            cursor: 'pointer',
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: -0.1,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: COLORS.red }}>🎤</span> Voice chat
            {collapsed && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: COLORS.textMuted,
                }}
              >
                — tap to expand
              </span>
            )}
          </span>
          <span
            aria-hidden="true"
            style={{ color: COLORS.textMuted, fontSize: 18, lineHeight: 1 }}
          >
            {collapsed ? '▾' : '▴'}
          </span>
        </button>
        {!collapsed && (
          <div
            id="voicechat-body"
            style={{
              // Roomier bottom padding gives the mic clear separation from
              // anything below the panel — prevents stray taps from hitting
              // the next action when the user reaches for the mic.
              padding: '0 14px 20px',
              display: 'flex',
              flexDirection: 'column',
              // Bumped ~1.5× from the original 360. The chat is the primary
              // surface on the dashboard now, so the message scroll should
              // feel like the page's main element. All the extra height
              // flows into the chat scroll (which has flex:1, minHeight:60);
              // the mic + Send row is flex-shrink:0 so it always stays put.
              height: 480,
              borderTop: `1px solid ${COLORS.border}`,
              paddingTop: 12,
              background: COLORS.surface,
            }}
          >
            {innerContent}
          </div>
        )}
      </section>
    );
  }

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
        <h1
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: COLORS.ink,
            margin: 0,
          }}
        >
          Voice chat
        </h1>
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
      {innerContent}
    </main>
  );
}
