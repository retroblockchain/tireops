import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ActivitySource, insertActivityLog } from '../../../lib/activity';
import { parseSpreadsheet } from '../../../lib/parseSpreadsheet';

export const runtime = 'nodejs';

const PHOTO_BUCKET = 'tire-photos';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const UNASSIGNED_SHOP = 'Unassigned';

function buildSystemPrompt(currentShop: string): string {
  const knownShop = currentShop && currentShop !== UNASSIGNED_SHOP;
  const shopRule = knownShop
    ? `8. SHOP DEFAULT: The user is signed in at the "${currentShop}" location. When they ask you to add a tire, set the shop field to "${currentShop}" by default. Don't ask them about the shop unless they explicitly tell you a different one.`
    : `8. SHOP DEFAULT: The user's shop is not configured. Ask the user which shop the tire belongs to when adding tires.`;
  return `You are a voice assistant for a tire shop inventory app. Users speak to you about their tire stock.

The 'tires' table has these columns:
- id (uuid, auto), tire_number (bigint, auto — shown to users as "tire-N", e.g. "tire-25"), shop (text), brand (text), model (text), size (text, e.g. "225/65R17"),
  season (text: "summer" | "winter" | "all-season"), condition (text: "new" | "used"),
  tread_pct (number 0-100), quantity (number), price (number), notes (text), is_complete (bool, auto), created_at, updated_at.

Users often refer to a tire by its friendly id like "tire-25" or "tire 3". In search_tires, filter via tire_number (a number) or friendly_id (a string like "tire-25"). In update_tire / delete_tire, the id field accepts EITHER the uuid OR the friendly id "tire-N" — the server resolves it. When confirming actions back to the user, prefer the friendly id ("tire-25") over the uuid.

Rules:
1. NEVER invent tire data. Only report what tools return.
2. When the user asks about tires, call search_tires first and read the result back.
3. When adding a tire, call add_tire with whatever fields the user gave you. Save it even if fields are missing — the tool will return which fields are missing, and you should tell the user what's missing so they can fill it in later.
4. When updating a tire, you usually need to call search_tires first to find the id, unless the user gave it.
5. Keep replies short and natural — they will be spoken aloud. No markdown, no lists with bullets.
6. If a tool returns zero results, say so plainly. Do not guess.
7. DELETION REQUIRES EXPLICIT USER CONFIRMATION. To delete a tire:
   a. First call search_tires to locate the exact row and get its id.
   b. Then say which tire you will delete (brand, model, size, quantity, shop) and ask the user to confirm with a clear yes — for example "Delete this one? Say yes to confirm."
   c. ONLY after the user replies with a clear affirmative (yes, confirm, delete it, do it) may you call delete_tire.
   d. If the user is silent, unclear, hesitant, or says no, DO NOT call delete_tire. Ask again or abandon the deletion.
   e. Never call delete_tire in the same turn you first mention deletion — confirmation must come from the user in a separate turn.
${shopRule}
9. FILE ATTACHMENTS — ALWAYS CONFIRM BEFORE ADDING. When the user attaches a file (image, PDF, or spreadsheet), they are typically asking you to extract tire entries from it. You MUST:
   a. Read the file carefully and extract every tire entry you can identify (brand, model, size, season, condition, tread, quantity, price).
   b. Present a clear numbered list back to the user showing what you found. Keep it short and readable since the reply is spoken aloud.
   c. Ask the user to confirm before saving — e.g. "I found 12 tires. Should I add them all? Say yes to confirm."
   d. ONLY after the user replies with a clear affirmative in a SEPARATE turn may you call add_tire — once per row.
   e. NEVER call add_tire in the same turn you announce what you found from a file. This is critical for spreadsheets that may contain many rows.
   f. If the user uploaded an image of ONE specific tire (not a spreadsheet of many), and a system note in the message gave you a photo_url, include that photo_url in your add_tire call so the photo is saved against the new tire.
10. BUG REPORTS: If the user reports a problem with the app or asks you to log/file a bug (e.g. "report a bug: the photo upload failed", "log an issue", "this is broken — track it"), call the report_bug tool with a concise description that captures the issue. Confirm to the user that the bug was logged. Ask for clarification only if their description is too vague to be useful — short reports are fine.`;
}

const TOOLS = [
  {
    name: 'search_tires',
    description:
      'Search the tires inventory. Use any combination of filters. Returns matching rows including each tire\'s tire_number. Filters are case-insensitive partial matches for text fields. To find a specific tire by its friendly id (e.g. "tire-25"), pass either tire_number=25 or friendly_id="tire-25".',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text fragment to match against brand, model, size, season, shop, notes, or friendly id.' },
        brand: { type: 'string' },
        model: { type: 'string' },
        size: { type: 'string', description: 'e.g. "225/65R17"' },
        season: { type: 'string', description: '"summer", "winter", or "all-season"' },
        condition: { type: 'string', description: '"new" or "used"' },
        shop: { type: 'string' },
        tire_number: { type: 'number', description: 'Exact match on tire_number — e.g. 25 finds the tire shown to users as "tire-25".' },
        friendly_id: { type: 'string', description: 'Like "tire-25"; the numeric part is extracted and matched against tire_number.' },
        limit: { type: 'number', description: 'Max rows (default 20)' },
      },
    },
  },
  {
    name: 'add_tire',
    description:
      'Insert a new tire row. ALL fields are optional — save whatever the user gave. The tool returns the inserted row plus a list of which recommended fields were missing, so you can tell the user what to fill in later. If a system note in the message gave you a photo_url for an uploaded image of one specific tire, include photo_url here to attach the photo to the new tire.',
    input_schema: {
      type: 'object',
      properties: {
        shop: { type: 'string' },
        brand: { type: 'string' },
        model: { type: 'string' },
        size: { type: 'string' },
        season: { type: 'string' },
        condition: { type: 'string' },
        tread_pct: { type: 'number' },
        quantity: { type: 'number' },
        price: { type: 'number' },
        notes: { type: 'string' },
        photo_url: { type: 'string', description: 'If a photo was uploaded for this single tire (system note will tell you the URL), include it here. Skip for bulk-from-spreadsheet adds.' },
      },
    },
  },
  {
    name: 'update_tire',
    description: 'Update an existing tire. Provide only the fields to change. The id accepts EITHER the internal uuid OR a friendly id like "tire-25".',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The tire id — either the uuid or the friendly id like "tire-25".' },
        shop: { type: 'string' },
        brand: { type: 'string' },
        model: { type: 'string' },
        size: { type: 'string' },
        season: { type: 'string' },
        condition: { type: 'string' },
        tread_pct: { type: 'number' },
        quantity: { type: 'number' },
        price: { type: 'number' },
        notes: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_tire',
    description:
      'Delete a tire row by id. CRITICAL: Only call this AFTER the user has clearly confirmed deletion in the conversation. You must first identify the specific tire (typically via search_tires), describe it back to the user, and wait for an explicit yes in a separate turn before invoking this tool.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The tire id — either the uuid or the friendly id like "tire-25". Obtain it from search_tires.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'report_bug',
    description:
      'Log a bug report on behalf of the user. Call this when the user reports a problem with the app or explicitly asks you to log/file a bug. The description should summarize the user\'s complaint concisely.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'The bug summary in the user\'s own words (or close to it).' },
      },
      required: ['description'],
    },
  },
];

const RECOMMENDED_FIELDS = ['brand', 'model', 'size', 'season', 'condition', 'quantity', 'price'];

type ToolInput = Record<string, unknown>;

/** Parse "tire-25" (or any string containing digits) into the integer 25. */
function extractTireNumber(s: string): number | null {
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Accept either a uuid or a friendly id like "tire-25" and return the uuid.
 * Returns null when a friendly id was given but no matching tire exists.
 */
async function resolveTireId(rawId: string): Promise<string | null> {
  const trimmed = rawId.trim();
  if (/^tire[-_\s]*\d+$/i.test(trimmed)) {
    const num = extractTireNumber(trimmed);
    if (num == null) return null;
    const { data } = await supabase
      .from('tires')
      .select('id')
      .eq('tire_number', num)
      .maybeSingle();
    return data?.id ?? null;
  }
  // Otherwise assume it's already a uuid (or a malformed string — let the
  // downstream query error naturally).
  return trimmed;
}

async function runSearchTires(input: ToolInput) {
  let q = supabase.from('tires').select('*');
  const eqLikeFields = ['brand', 'model', 'size', 'season', 'condition', 'shop'] as const;
  for (const f of eqLikeFields) {
    const v = input[f];
    if (typeof v === 'string' && v.trim()) q = q.ilike(f, `%${v.trim()}%`);
  }

  // tire_number / friendly_id filter (exact match)
  let tireNum: number | null = null;
  if (typeof input.tire_number === 'number' && Number.isFinite(input.tire_number)) {
    tireNum = Math.floor(input.tire_number);
  } else if (typeof input.friendly_id === 'string') {
    tireNum = extractTireNumber(input.friendly_id);
  }
  if (tireNum != null) {
    q = q.eq('tire_number', tireNum);
  }

  const limit = typeof input.limit === 'number' ? Math.min(Math.max(input.limit, 1), 100) : 20;
  q = q.order('created_at', { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return { error: error.message };

  let rows = data ?? [];
  const free = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
  if (free) {
    rows = rows.filter((r) => {
      const friendly = r.tire_number != null ? `tire-${r.tire_number}` : '';
      const hay = [friendly, r.brand, r.model, r.size, r.season, r.shop, r.notes, r.condition]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(free);
    });
  }
  return { count: rows.length, rows };
}

async function runAddTire(
  input: ToolInput,
  currentShop: string,
  userEmail: string | null,
  source: ActivitySource,
) {
  const row: Record<string, unknown> = {};
  for (const f of ['shop', 'brand', 'model', 'size', 'season', 'condition', 'tread_pct', 'quantity', 'price', 'notes']) {
    if (input[f] !== undefined && input[f] !== null && input[f] !== '') row[f] = input[f];
  }
  if (!row.shop && currentShop && currentShop !== UNASSIGNED_SHOP) {
    row.shop = currentShop;
  }
  const photoUrl = typeof input.photo_url === 'string' && input.photo_url.trim()
    ? input.photo_url.trim()
    : null;

  const missing = RECOMMENDED_FIELDS.filter((f) => row[f] === undefined);
  const { data, error } = await supabase.from('tires').insert(row).select().single();
  if (error) return { error: error.message, missing };

  // Attach the uploaded photo to the new tire if the AI passed one.
  if (photoUrl && data?.id) {
    try {
      await supabase.from('tire_photos').insert({ tire_id: data.id, url: photoUrl });
    } catch (e) {
      console.error('tire_photos insert failed', e);
    }
  }

  await insertActivityLog({ action: 'added', tire: data, source, userEmail });
  return { inserted: data, missing, photo_attached: !!photoUrl };
}

async function runUpdateTire(
  input: ToolInput,
  userEmail: string | null,
  source: ActivitySource,
) {
  const rawId = input.id;
  if (typeof rawId !== 'string') return { error: 'id is required' };
  const id = await resolveTireId(rawId);
  if (!id) return { error: `tire not found: "${rawId}"` };
  const patch: Record<string, unknown> = {};
  for (const f of ['shop', 'brand', 'model', 'size', 'season', 'condition', 'tread_pct', 'quantity', 'price', 'notes']) {
    if (input[f] !== undefined && input[f] !== null && input[f] !== '') patch[f] = input[f];
  }
  if (Object.keys(patch).length === 0) return { error: 'no fields to update' };
  const { data, error } = await supabase.from('tires').update(patch).eq('id', id).select().single();
  if (error) return { error: error.message };
  await insertActivityLog({ action: 'edited', tire: data, source, userEmail });
  return { updated: data };
}

async function runDeleteTire(
  input: ToolInput,
  userEmail: string | null,
  source: ActivitySource,
) {
  const rawId = input.id;
  if (typeof rawId !== 'string') return { error: 'id is required' };
  const id = await resolveTireId(rawId);
  if (!id) return { error: `tire not found: "${rawId}"` };
  const { data, error } = await supabase.from('tires').delete().eq('id', id).select().single();
  if (error) return { error: error.message };
  await insertActivityLog({ action: 'deleted', tire: data, source, userEmail });
  return { deleted: data };
}

async function runReportBug(
  input: ToolInput,
  currentShop: string,
  userEmail: string | null,
) {
  const description =
    typeof input.description === 'string' ? input.description.trim() : '';
  if (!description) return { error: 'description is required' };
  const shop =
    currentShop && currentShop !== UNASSIGNED_SHOP ? currentShop : null;
  const { data, error } = await supabase
    .from('bug_reports')
    .insert({
      description,
      reported_by: userEmail,
      shop,
      source: 'ai',
    })
    .select()
    .single();
  if (error) return { error: error.message };
  return { reported: data };
}

async function runTool(
  name: string,
  input: ToolInput,
  currentShop: string,
  userEmail: string | null,
  source: ActivitySource,
) {
  try {
    if (name === 'search_tires') return await runSearchTires(input);
    if (name === 'add_tire') return await runAddTire(input, currentShop, userEmail, source);
    if (name === 'update_tire') return await runUpdateTire(input, userEmail, source);
    if (name === 'delete_tire') return await runDeleteTire(input, userEmail, source);
    if (name === 'report_bug') return await runReportBug(input, currentShop, userEmail);
    return { error: `unknown tool: ${name}` };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: ToolInput }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

type AttachmentInput = {
  name: string;
  type: string;
  base64: string;
  /**
   * When the client has already uploaded the image to Supabase Storage (the
   * normal path — done via the authenticated client), it passes the public
   * URL here. The server then skips its own upload attempt (which would fail
   * under typical anon-blocked storage RLS) and uses this URL directly.
   */
  photoUrl?: string;
};

const IMAGE_MIME_ALLOW = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Process a single attachment into Anthropic content blocks. Images get
 * uploaded to the tire-photos bucket (so the AI can pass photo_url back
 * via add_tire) and emitted as both an image block + a system-note text
 * block. PDFs become document blocks. Spreadsheets are parsed to CSV text.
 */
async function buildAttachmentBlocks(att: AttachmentInput): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  const ext = att.name.toLowerCase().split('.').pop() || '';
  const mime = (att.type || '').toLowerCase();

  // ---- Image ----
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
    const mediaType = IMAGE_MIME_ALLOW.has(mime)
      ? mime
      : ext === 'png' ? 'image/png'
      : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp'
      : 'image/jpeg';

    // Prefer the URL the client already uploaded via its authenticated
    // supabase session. Fall back to a server-side upload attempt only when
    // the client didn't supply one (e.g. older client). Server upload uses
    // the anon-keyed client and may fail under strict storage RLS.
    let photoUrl: string | null =
      typeof att.photoUrl === 'string' && att.photoUrl.trim()
        ? att.photoUrl.trim()
        : null;

    if (!photoUrl) {
      try {
        const buf = Buffer.from(att.base64, 'base64');
        const path = `pending/${Date.now()}-${randomToken()}.${ext || 'jpg'}`;
        const { error: upErr } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, buf, { contentType: mediaType, upsert: false });
        if (!upErr) {
          const { data: pub } = supabase.storage
            .from(PHOTO_BUCKET)
            .getPublicUrl(path);
          photoUrl = pub.publicUrl;
        } else {
          console.error('server-side photo upload failed', upErr);
        }
      } catch (e) {
        console.error('attachment upload to storage failed', e);
      }
    }

    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: att.base64 },
    });
    if (photoUrl) {
      blocks.push({
        type: 'text',
        text: `[System note: This image was uploaded and stored at "${photoUrl}". If you add a tire FROM this image (single-tire flow, not a bulk spreadsheet), pass photo_url="${photoUrl}" to add_tire so the photo is saved as that tire's attached photo.]`,
      });
    } else {
      // No URL available at all — let Claude know so it doesn't refuse to
      // add the tire while waiting for one.
      blocks.push({
        type: 'text',
        text: `[System note: An image was attached but no storage URL is available. You may still extract tire details and add the tire — just omit photo_url from add_tire. Do not refuse to add because of the missing URL.]`,
      });
    }
    return blocks;
  }

  // ---- PDF ----
  if (mime === 'application/pdf' || ext === 'pdf') {
    blocks.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: att.base64 },
    });
    return blocks;
  }

  // ---- Spreadsheet (.csv, .tsv, .xlsx, .xls) ----
  if (['csv', 'tsv', 'xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
    const buf = Buffer.from(att.base64, 'base64');
    const text = parseSpreadsheet(buf, att.name);
    if (text) {
      blocks.push({
        type: 'text',
        text: `[Attached spreadsheet "${att.name}" — parsed as CSV]\n\n${text}`,
      });
    } else {
      blocks.push({
        type: 'text',
        text: `[Attached file "${att.name}" — could not parse as spreadsheet]`,
      });
    }
    return blocks;
  }

  // ---- Unknown type — pass through as a text note ----
  blocks.push({
    type: 'text',
    text: `[Attached file "${att.name}" of type "${mime}" — unsupported, no content extracted]`,
  });
  return blocks;
}

async function callAnthropic(messages: Message[], system: string) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anthropic ${res.status}: ${body}`);
  }
  return res.json() as Promise<{
    content: ContentBlock[];
    stop_reason: string;
  }>;
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not set on server' }, { status: 500 });
  }
  let body: {
    messages?: Message[];
    currentShop?: string;
    currentUserEmail?: string;
    hasFileInSession?: boolean;
    attachment?: AttachmentInput;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const messages: Message[] = Array.isArray(body.messages) ? body.messages : [];
  const currentShop =
    typeof body.currentShop === 'string' && body.currentShop.trim()
      ? body.currentShop.trim()
      : UNASSIGNED_SHOP;
  const userEmail =
    typeof body.currentUserEmail === 'string' && body.currentUserEmail.trim()
      ? body.currentUserEmail.trim()
      : null;

  // If the client sent a fresh attachment, fold its content blocks into the
  // last user message before we hand the conversation to Anthropic.
  if (body.attachment && body.attachment.base64 && messages.length > 0) {
    const lastIdx = messages.length - 1;
    const last = messages[lastIdx];
    if (last && last.role === 'user') {
      const fileBlocks = await buildAttachmentBlocks(body.attachment);
      const existingBlocks: ContentBlock[] = typeof last.content === 'string'
        ? (last.content ? [{ type: 'text', text: last.content }] : [])
        : last.content;
      last.content = [...existingBlocks, ...fileBlocks];
    }
  }

  // Source for activity_log: 'file' if this conversation has ever seen
  // an attachment (per client's session flag), else 'voice'.
  const source: ActivitySource = body.hasFileInSession ? 'file' : 'voice';
  const system = buildSystemPrompt(currentShop);

  try {
    for (let step = 0; step < 6; step++) {
      const result = await callAnthropic(messages, system);
      const assistantBlocks = result.content;
      messages.push({ role: 'assistant', content: assistantBlocks });

      const toolUses = assistantBlocks.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      if (toolUses.length === 0) {
        const text = assistantBlocks
          .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return Response.json({ reply: text, messages });
      }

      const toolResults: ContentBlock[] = [];
      for (const tu of toolUses) {
        const out = await runTool(tu.name, tu.input, currentShop, userEmail, source);
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
      }
      messages.push({ role: 'user', content: toolResults });
    }
    return Response.json({ error: 'tool loop did not converge', messages }, { status: 500 });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
