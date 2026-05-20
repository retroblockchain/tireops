// Posts a single VAD speech segment to /api/transcribe and returns the
// Whisper text. The segment comes in as 16 kHz mono Float32 (the format
// @ricky0123/vad-web emits); we wrap it as a WAV blob via the library's
// own encodeWAV helper before upload.
//
// Throws on network or HTTP error. Returns "" if Whisper found no speech
// in the segment (silence-only segment slipped past VAD).

import { utils } from '@ricky0123/vad-web';

export interface TranscribeResult {
  text: string;
  /** Approximate audio duration in seconds, useful for cost / metrics. */
  durationSec: number;
}

export async function transcribeSegment(
  audio: Float32Array,
): Promise<TranscribeResult> {
  const durationSec = audio.length / 16000;
  // encodeWAV defaults: 16-bit PCM, 16 kHz, mono — matches VAD output.
  const wavBuffer = utils.encodeWAV(audio);
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  const form = new FormData();
  form.append('file', blob, 'segment.wav');

  const res = await fetch('/api/transcribe', { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`transcribe failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { text?: string; error?: string };
  if (data.error) throw new Error(`transcribe error: ${data.error}`);
  return { text: (data.text ?? '').trim(), durationSec };
}
