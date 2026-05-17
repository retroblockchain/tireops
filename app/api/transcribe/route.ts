import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: 'OPENAI_API_KEY not set on server' }, { status: 500 });
  }

  let incoming: FormData;
  try {
    incoming = await req.formData();
  } catch {
    return Response.json({ error: 'expected multipart/form-data' }, { status: 400 });
  }

  const file = incoming.get('file');
  if (!file || typeof file === 'string') {
    return Response.json({ error: 'file field missing' }, { status: 400 });
  }

  // Hand the audio off to OpenAI Whisper. We pass the filename through so
  // OpenAI sees a recognizable extension (.webm / .mp4 / .ogg) and routes it
  // to the right codec path.
  const filename = (file as File).name || 'audio.webm';
  const outForm = new FormData();
  outForm.append('file', file, filename);
  outForm.append('model', 'whisper-1');
  outForm.append('response_format', 'json');

  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: outForm,
    });
    if (!res.ok) {
      const body = await res.text();
      return Response.json(
        { error: `openai ${res.status}: ${body.slice(0, 300)}` },
        { status: 502 },
      );
    }
    const data = (await res.json()) as { text?: string };
    return Response.json({ text: data.text ?? '' });
  } catch (e: unknown) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
