import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

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
- id (uuid, auto), shop (text), brand (text), model (text), size (text, e.g. "225/65R17"),
  season (text: "summer" | "winter" | "all-season"), condition (text: "new" | "used"),
  tread_pct (number 0-100), quantity (number), price (number), notes (text), is_complete (bool, auto), created_at, updated_at.

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
${shopRule}`;
}

const TOOLS = [
  {
    name: 'search_tires',
    description:
      'Search the tires inventory. Use any combination of filters. Returns matching rows. Filters are case-insensitive partial matches for text fields.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text fragment to match against brand, model, size, season, shop, notes.' },
        brand: { type: 'string' },
        model: { type: 'string' },
        size: { type: 'string', description: 'e.g. "225/65R17"' },
        season: { type: 'string', description: '"summer", "winter", or "all-season"' },
        condition: { type: 'string', description: '"new" or "used"' },
        shop: { type: 'string' },
        limit: { type: 'number', description: 'Max rows (default 20)' },
      },
    },
  },
  {
    name: 'add_tire',
    description:
      'Insert a new tire row. ALL fields are optional — save whatever the user gave. The tool returns the inserted row plus a list of which recommended fields were missing, so you can tell the user what to fill in later.',
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
      },
    },
  },
  {
    name: 'update_tire',
    description: 'Update an existing tire by id. Provide only the fields to change.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The tire id (uuid).' },
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
        id: { type: 'string', description: 'The tire id (uuid) to delete. Obtain this from search_tires.' },
      },
      required: ['id'],
    },
  },
];

const RECOMMENDED_FIELDS = ['brand', 'model', 'size', 'season', 'condition', 'quantity', 'price'];

type ToolInput = Record<string, unknown>;

async function runSearchTires(input: ToolInput) {
  let q = supabase.from('tires').select('*');
  const eqLikeFields = ['brand', 'model', 'size', 'season', 'condition', 'shop'] as const;
  for (const f of eqLikeFields) {
    const v = input[f];
    if (typeof v === 'string' && v.trim()) q = q.ilike(f, `%${v.trim()}%`);
  }
  const limit = typeof input.limit === 'number' ? Math.min(Math.max(input.limit, 1), 100) : 20;
  q = q.order('created_at', { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return { error: error.message };

  let rows = data ?? [];
  const free = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
  if (free) {
    rows = rows.filter((r) => {
      const hay = [r.brand, r.model, r.size, r.season, r.shop, r.notes, r.condition]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(free);
    });
  }
  return { count: rows.length, rows };
}

async function runAddTire(input: ToolInput, currentShop: string) {
  const row: Record<string, unknown> = {};
  for (const f of ['shop', 'brand', 'model', 'size', 'season', 'condition', 'tread_pct', 'quantity', 'price', 'notes']) {
    if (input[f] !== undefined && input[f] !== null && input[f] !== '') row[f] = input[f];
  }
  // Safety net: if the AI didn't fill in shop (it should, per system prompt),
  // default to the signed-in user's shop so tires never land unassigned.
  if (!row.shop && currentShop && currentShop !== UNASSIGNED_SHOP) {
    row.shop = currentShop;
  }
  const missing = RECOMMENDED_FIELDS.filter((f) => row[f] === undefined);
  const { data, error } = await supabase.from('tires').insert(row).select().single();
  if (error) return { error: error.message, missing };
  return { inserted: data, missing };
}

async function runUpdateTire(input: ToolInput) {
  const id = input.id;
  if (typeof id !== 'string') return { error: 'id is required' };
  const patch: Record<string, unknown> = {};
  for (const f of ['shop', 'brand', 'model', 'size', 'season', 'condition', 'tread_pct', 'quantity', 'price', 'notes']) {
    if (input[f] !== undefined && input[f] !== null && input[f] !== '') patch[f] = input[f];
  }
  if (Object.keys(patch).length === 0) return { error: 'no fields to update' };
  const { data, error } = await supabase.from('tires').update(patch).eq('id', id).select().single();
  if (error) return { error: error.message };
  return { updated: data };
}

async function runDeleteTire(input: ToolInput) {
  const id = input.id;
  if (typeof id !== 'string') return { error: 'id is required' };
  const { data, error } = await supabase.from('tires').delete().eq('id', id).select().single();
  if (error) return { error: error.message };
  return { deleted: data };
}

async function runTool(name: string, input: ToolInput, currentShop: string) {
  try {
    if (name === 'search_tires') return await runSearchTires(input);
    if (name === 'add_tire') return await runAddTire(input, currentShop);
    if (name === 'update_tire') return await runUpdateTire(input);
    if (name === 'delete_tire') return await runDeleteTire(input);
    return { error: `unknown tool: ${name}` };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: ToolInput }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

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
  let body: { messages?: Message[]; currentShop?: string };
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
        const out = await runTool(tu.name, tu.input, currentShop);
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
      }
      messages.push({ role: 'user', content: toolResults });
    }
    return Response.json({ error: 'tool loop did not converge', messages }, { status: 500 });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
