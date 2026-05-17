import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const OPENAI_URL = 'https://api.openai.com/v1/audio/speech';
const MODEL = 'tts-1';
const VALID_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'shimmer'] as const;
type Voice = (typeof VALID_VOICES)[number];
const DEFAULT_VOICE: Voice = 'fable';

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: 'OPENAI_API_KEY not set on server' }, { status: 500 });
  }

  let body: { text?: string; voice?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return Response.json({ error: 'text required' }, { status: 400 });
  }

  const requested =
    typeof body.voice === 'string' ? body.voice.toLowerCase().trim() : '';
  const voice: Voice = (VALID_VOICES as readonly string[]).includes(requested)
    ? (requested as Voice)
    : DEFAULT_VOICE;

  try {
    const upstream = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        voice,
        input: text,
        response_format: 'mp3',
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errBody = await upstream.text();
      return Response.json(
        { error: `openai ${upstream.status}: ${errBody.slice(0, 300)}` },
        { status: 502 },
      );
    }

    // Stream the upstream body straight through — no arrayBuffer() round trip.
    // Playback can start on the client as soon as the first MP3 frames arrive.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'no-store',
        // Hint to any reverse proxy (nginx, etc.) to not buffer this response.
        'x-accel-buffering': 'no',
      },
    });
  } catch (e: unknown) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
