import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ActivitySource, insertActivityLog } from '../../../lib/activity';
import { parseSpreadsheet } from '../../../lib/parseSpreadsheet';
import { TIRE_LOCATIONS, canonicalizeLocation } from '../../../lib/locations';
import { assertWithinBudget, logUsage, type AnthropicUsage } from '../../../lib/anthropic';
import {
  matchBrand,
  matchModel,
  addBrandToCatalog,
  addModelToCatalog,
} from '../../../lib/tire-catalog';

export const runtime = 'nodejs';

const PHOTO_BUCKET = 'tire-photos';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const UNASSIGNED_SHOP = 'Unassigned';

/**
 * How many user-initiated turns to keep when sending the conversation to
 * Anthropic. Older turns are dropped from the API request (the client still
 * shows the full visible chat — this just caps the per-request payload).
 * 12 is generous for shop-floor flows while staying well under rate limits.
 */
const MAX_HISTORY_TURNS = 12;

function buildSystemPrompt(currentShop: string): string {
  const knownShop = currentShop && currentShop !== UNASSIGNED_SHOP;
  const shopRule = knownShop
    ? `8. SHOP DEFAULT: The user is signed in at the "${currentShop}" location. When they ask you to add a tire, set the shop field to "${currentShop}" by default. Don't ask them about the shop unless they explicitly tell you a different one.`
    : `8. SHOP DEFAULT: The user's shop is not configured. Ask the user which shop the tire belongs to when adding tires.`;
  return `You are the voice assistant for a busy tire shop's inventory app. Real shop staff talk to you between customer interactions — they ramble, give details out of order, pause mid-sentence, fragment their speech, and correct themselves. Be patient: piece together their intent from the whole turn, not just the latest fragment. Stay calm and efficient — they're working.

The 'tires' table has these columns:
- id (uuid, auto), tire_number (bigint, auto — shown to users as "tire-N", e.g. "tire-25"), shop (text), brand (text), model (text), size (text, e.g. "225/65R17"),
  season (text: "summer" | "winter" | "all-season"), condition (text: "new" | "used"),
  tread_pct (number 0-100), quantity (number), price (number), notes (text),
  location (text — where the tire is physically stored. Recognized presets are "${TIRE_LOCATIONS.join('", "')}". Any custom string is also valid — e.g. "Container A", "Bay 3"),
  status (text: "available" | "reserved" | "pending" | "sold" — defaults to "available". SOLD tires are removed from the main inventory list and live in a separate "Recently sold" view),
  is_complete (bool, auto), created_at, updated_at.

Users often refer to a tire by its friendly id like "tire-25" or "tire 3". In search_tires, filter via tire_number (a number) or friendly_id (a string like "tire-25"). In update_tire / delete_tire, the id field accepts EITHER the uuid OR the friendly id "tire-N" — the server resolves it. When confirming actions back to the user, prefer the friendly id ("tire-25") over the uuid.

INTERPRETING SHOP-FLOOR SPEECH:
- Tire sizes follow WIDTH/PROFILE-R-RIM. Said aloud: "two twenty-five sixty-five seventeen" → "225/65R17". "two thirty-five forty-five nineteen" → "235/45R19". "one ninety-five seventy fourteen" → "195/70R14". If only part of the size is given (e.g. only the width), ask for the missing piece — don't guess.
- Quantities: "a set of four" or "a set" → 4. "a pair" → 2. "a single" → 1. "a few" or "some" → ask how many exactly.
- Condition: "new" / "brand new" / "nearly new" → condition "new" with tread_pct around 95-100. "used" → condition "used". Always set both fields together when you have the info.
- Tread depth: when staff say "X thirty-seconds" they mean X/32nds tread remaining — treat 10/32 as full new tread, so "eight thirty-seconds" ≈ tread_pct 80, "five thirty-seconds" ≈ 50, "two thirty-seconds" ≈ 20 (legal minimum). When they say "percent" or "%", use the number directly. "Half tread" → 50. "Low tread" / "almost bald" → 20 or less.
- Brand names — be generous interpreting them (Whisper sometimes garbles proper nouns). "mishelin" / "mick-uh-lin" → Michelin. "bridgestown" → Bridgestone. "conti" → Continental. "perrelli" / "puh-relli" → Pirelli. "yoko" → Yokohama. "BFG" → BFGoodrich. Save the canonical brand spelling.
- Seasons: "snow tires" / "winter" → "winter". "summer" / "performance" → "summer". "all season" / "all-season" / "all weather" / "year-round" → "all-season".
- Storage location: "in the warehouse" / "out back in the warehouse" → location "Warehouse". "on the showroom floor" → "Showroom". "in the container" / "in the sea-can" → "Container". "out in the yard" → "Yard". For other phrasings ("in container A", "bay 3", "mezzanine"), save the location string the user said. The recognized presets are "${TIRE_LOCATIONS.join('", "')}" — match the user's wording to a preset when it's clearly the same place, otherwise save the custom phrase verbatim (capitalized normally).
- Money: "eighty bucks" / "eighty dollars" / "eighty" (in price context) → 80.
- Out-of-order details: staff routinely interleave fields ("four winter Bridgestones, two twenty-five sixty-five seventeen, eighty bucks each, eight thirty-seconds"). Collect everything before asking follow-ups.
- Self-corrections: if they back-track ("two twenty-five — wait, two thirty-five sixty-five seventeen"), use the corrected value, not the original.

ASKING FOR MISSING INFORMATION:
- Ask ONE focused question at a time. Not "what brand, model, and size?" — ask just the most critical missing piece first.
- Priority for what to ask first: size, then brand, then quantity, then condition. Save other fields without asking.
- Wait until the user seems done talking before asking. Don't interrupt fragments.
- If there are two plausible interpretations, say what you think they meant and ask if that's right — never silently guess.
- If you already have enough to save, save it and briefly mention anything non-critical that's still missing rather than blocking on questions.

Rules:
1. NEVER invent tire data. Only report what tools return. Interpretation of how the user said something (a size, a brand) is fine — making up data the user didn't give is not.
2. When the user asks about tires, call search_tires first and read the result back.
3. When adding a tire: collect everything the user said (including out-of-order fragments and corrections). If a critical identifying field is missing (size or brand) AND the user seems done giving info, ask ONE focused question for that field. Otherwise save with add_tire even when some fields are missing — the tool returns which recommended fields are missing; mention them briefly afterwards so the user can fill them in later. Don't ask multiple questions at once.
4. When updating a tire, you usually need to call search_tires first to find the id, unless the user already gave the friendly id.
5. Keep replies short and shop-floor friendly — staff are busy between customers. One or two sentences is typical. Spoken aloud, so no markdown, no bullet lists. Confirm actions briefly but clearly.
6. If a tool returns zero results, say so plainly — never invent tire details to fill the gap.
7. DELETION REQUIRES EXPLICIT USER CONFIRMATION. To delete a tire:
   a. First call search_tires to locate the exact row and get its id.
   b. Then say which tire you will delete (brand, model, size, quantity, shop) and ask the user to confirm with a clear yes — for example "Delete this one? Say yes to confirm."
   c. ONLY after the user replies with a clear affirmative (yes, confirm, delete it, do it) may you call delete_tire.
   d. If the user is silent, unclear, hesitant, or says no, DO NOT call delete_tire. Ask again or abandon the deletion.
   e. Never call delete_tire in the same turn you first mention deletion — confirmation must come from the user in a separate turn.
${shopRule}
9. FILE ATTACHMENTS — ALWAYS CONFIRM BEFORE ADDING. When the user attaches one or more files (images, PDFs, or spreadsheets), they are typically asking you to extract tire entries from them. You MUST:
   a. Read the files carefully and extract every tire entry you can identify (brand, model, size, season, condition, tread, quantity, price).
   b. Present a clear numbered list back to the user showing what you found. Keep it short and readable since the reply is spoken aloud.
   c. Ask the user to confirm before saving — e.g. "I found 12 tires. Should I add them all? Say yes to confirm."
   d. ONLY after the user replies with a clear affirmative in a SEPARATE turn may you call add_tire — once per row.
   e. NEVER call add_tire in the same turn you announce what you found from a file. This is critical for spreadsheets that may contain many rows.
   f. If the user uploaded one or more images of ONE specific tire (not a spreadsheet of many entries), the system notes give you each image's URL. When calling add_tire: use photo_url="<url>" if a single image was attached, or photo_urls=["<url1>","<url2>",...] if MULTIPLE images of the same tire were attached. All listed photos are saved against the new tire.
10. BUG REPORTS: If the user reports a problem with the app or asks you to log/file a bug (e.g. "report a bug: the photo upload failed", "log an issue", "this is broken — track it"), call the report_bug tool with a concise description that captures the issue. Confirm to the user that the bug was logged. Ask for clarification only if their description is too vague to be useful — short reports are fine.
12. STATUS CHANGES REQUIRE EXPLICIT USER CONFIRMATION. When the user asks you to change a tire's status (e.g. "mark tire-25 as sold", "reserve the Michelins for a customer", "set tire-3 to pending"):
   a. Find the tire first (via search_tires if you don't already know it from this conversation).
   b. Describe the change clearly: "I'll mark tire-25 (Michelin X-Ice 225/65R17) as SOLD. That will move it out of the main inventory list. Confirm?" Adapt the wording for reserved/pending/available — for SOLD, always mention it leaves the main list.
   c. ONLY after the user replies with a clear yes in a SEPARATE turn may you call update_tire with the status field.
   d. If the user is unclear or says no, do NOT change the status. Ask again or move on.
   e. SOLD is the most consequential status — be sure the user wants to retire that exact tire before confirming.
13. ATTACHING PHOTO(S) TO AN EXISTING TIRE. When one or more photos are uploaded AND the user asks to add them to a tire ALREADY in inventory (e.g. "add this photo to tire-25", "attach these to the Michelin we have", "these go with that one we just looked at"):
   a. Identify the specific tire — either by the friendly id the user said, or via search_tires if you need to look it up.
   b. Confirm with the user, naming the tire and saying how many photos: "Attach this photo to tire-25 (Michelin X-Ice 225/65R17)?" or "Attach these 3 photos to tire-25? Say yes to confirm."
   c. ONLY after the user replies with a clear yes in a SEPARATE turn may you call attach_photo_to_tire with the tire's id and EITHER photo_url="<url>" (single image) OR photo_urls=["<url1>","<url2>",...] (multiple images, taken from all the system notes in the message that delivered them).
   d. This ADDS photos to the tire's gallery — it does not replace existing photos. Tires can have many photos.
   e. Distinguish from rule 9.f: if the user wants to CREATE a new tire from the photo(s), use add_tire with photo_url / photo_urls instead. Ask if you're unsure.
   f. Don't paste URLs back to the user — they don't need to see them.
14. CHANGING LOCATION REQUIRES CONFIRMATION. When the user asks you to set or change a tire's location (e.g. "move tire-25 to the warehouse", "set the Michelins to Container A", "they're in the yard now"):
   a. Find the tire if needed (via search_tires).
   b. Confirm what you're about to do, naming the tire: "Set tire-25 (Michelin X-Ice 225/65R17) location to Warehouse? Say yes to confirm." Use the preset name if the user's phrase matches one ("${TIRE_LOCATIONS.join('", "')}"); otherwise use their exact wording.
   c. ONLY after a clear yes in a SEPARATE turn may you call update_tire with the location field.
   d. NEVER call update_tire to change location in the same turn you propose the change.
   e. When ADDING a new tire (rule 3), no separate confirmation is needed for location — just save it with the rest of the tire fields. This rule only governs CHANGING the location of an existing tire.
15. SEARCHING BY LOCATION. When the user asks "what's in the warehouse" / "show me yard tires" / "anything in container A", call search_tires with the \`location\` filter set to the user's location phrase. The filter is a partial case-insensitive match, so a preset name is fine even when staff used a custom variation.
16. TIRE BRAND/MODEL CATALOG MATCHING. The server keeps a curated catalog of common tire brands and their model lines, with aliases for phonetic misspeakings (e.g., "Mishelin" → Michelin), shortenings (e.g., "PS4S" → Pilot Sport 4S, "BFG" → BFGoodrich), and Whisper-induced garbles (e.g., "Pilot Sport Force" → Pilot Sport 4S). When you call add_tire with a brand and/or model, the server checks them against the catalog before inserting. The tool response tells you what happened:
   a. NORMAL INSERT (no status field): the brand/model matched the catalog cleanly. The tire is saved. WHEN THE CANONICAL SPELLING DIFFERS FROM WHAT THE USER SAID — even slightly — always call out the substitution explicitly in your reply so the user has a chance to catch a wrong correction. Example: user says "Mishelin Pilot Spore four S", you save as "Michelin Pilot Sport 4S", reply: "I saved that as Michelin Pilot Sport 4S — let me know if you meant something different." For exact matches where no substitution happened, just confirm normally without flagging.
   b. \`status: "needs_brand_confirmation"\` (or \`"needs_model_confirmation"\`): the matcher found close candidates but isn't sure. The response includes the user's original string and up to 3 candidates with similarity scores. Ask the user briefly which they meant — e.g., "Did you mean Bridgestone? Or Continental?" — and wait for the answer in a SEPARATE turn. Then retry add_tire with the chosen canonical name AND \`confirmed_brand: true\` (or \`confirmed_model: true\`). Don't include both fields if only one needed confirming.
   c. \`status: "unknown_brand"\` (or \`"unknown_model"\`): no candidate matched. Ask the user to spell or confirm the term (e.g., "I don't have that brand in my catalog — can you spell it for me?"). ONLY after they answer in a SEPARATE turn, call \`learn_tire_term({ kind: "brand"|"model", name: "...", brand: "..." for kind=model })\` to teach the catalog. Then retry add_tire with \`confirmed_brand: true\` and/or \`confirmed_model: true\`.
   The order is brand first (must resolve before the model can be looked up), then model. If both are unknown, learn the brand first, then learn the model under it. ALWAYS pass \`confirmed_brand: true\` and/or \`confirmed_model: true\` on the retry — without those flags, the matcher will run again and you'll loop on the same prompt. Don't pre-emptively call learn_tire_term for brands or models you suspect are missing — only after the matcher actually returns unknown_brand or unknown_model and the user confirms the spelling.`;
}

const TOOLS = [
  {
    name: 'search_tires',
    description:
      'Search the tires inventory. Use any combination of filters. Returns matching rows including each tire\'s tire_number. Filters are case-insensitive partial matches for text fields. To find a specific tire by its friendly id (e.g. "tire-25"), pass either tire_number=25 or friendly_id="tire-25".',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text fragment to match against brand, model, size, season, shop, location, notes, or friendly id.' },
        brand: { type: 'string' },
        model: { type: 'string' },
        size: { type: 'string', description: 'e.g. "225/65R17"' },
        season: { type: 'string', description: '"summer", "winter", or "all-season"' },
        condition: { type: 'string', description: '"new" or "used"' },
        shop: { type: 'string' },
        location: { type: 'string', description: 'Physical storage location — recognized presets are "Showroom", "Warehouse", "Container", "Yard", but any custom string also works. Partial case-insensitive match.' },
        tire_number: { type: 'number', description: 'Exact match on tire_number — e.g. 25 finds the tire shown to users as "tire-25".' },
        friendly_id: { type: 'string', description: 'Like "tire-25"; the numeric part is extracted and matched against tire_number.' },
        limit: { type: 'number', description: 'Max rows (default 20)' },
      },
    },
  },
  {
    name: 'add_tire',
    description:
      'Insert a new tire row. ALL fields are optional — save whatever the user gave. The tool returns the inserted row plus a list of which recommended fields were missing, so you can tell the user what to fill in later. If system notes in the user message gave you photo URLs for one or more uploaded images of this specific tire, include them via photo_url (single image) or photo_urls (multiple) so they\'re attached to the new tire.',
    input_schema: {
      type: 'object',
      properties: {
        shop: { type: 'string' },
        location: { type: 'string', description: 'Physical storage location. Use one of the recognized presets ("Showroom", "Warehouse", "Container", "Yard") when the user\'s phrase matches; otherwise save their custom phrase verbatim.' },
        brand: { type: 'string' },
        model: { type: 'string' },
        size: { type: 'string' },
        season: { type: 'string' },
        condition: { type: 'string' },
        tread_pct: { type: 'number' },
        quantity: { type: 'number' },
        price: { type: 'number' },
        notes: { type: 'string' },
        photo_url: { type: 'string', description: 'Single photo URL when exactly one image was uploaded for this tire. The URL comes from a system note in the user message. Skip for bulk-from-spreadsheet adds.' },
        photo_urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Multiple photo URLs when several images were uploaded for the SAME new tire. Include EVERY URL from the system notes in this message. All listed photos are attached to the new tire.',
        },
        confirmed_brand: {
          type: 'boolean',
          description: 'Set to true when retrying add_tire after the user has confirmed the brand spelling (either accepted a medium-confidence candidate or spelled out an unknown brand which was then learned via learn_tire_term). Bypasses the catalog matcher for brand.',
        },
        confirmed_model: {
          type: 'boolean',
          description: 'Same as confirmed_brand but for the model name.',
        },
      },
    },
  },
  {
    name: 'update_tire',
    description: 'Update an existing tire. Provide only the fields to change. The id accepts EITHER the internal uuid OR a friendly id like "tire-25". For status changes, only call this AFTER the user has explicitly confirmed (see rule 12). For location changes, only call this AFTER the user has explicitly confirmed (see rule 14).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The tire id — either the uuid or the friendly id like "tire-25".' },
        shop: { type: 'string' },
        location: { type: 'string', description: 'Physical storage location — recognized presets are "Showroom", "Warehouse", "Container", "Yard", but any custom string also works. Pass an empty string to clear the location.' },
        brand: { type: 'string' },
        model: { type: 'string' },
        size: { type: 'string' },
        season: { type: 'string' },
        condition: { type: 'string' },
        tread_pct: { type: 'number' },
        quantity: { type: 'number' },
        price: { type: 'number' },
        notes: { type: 'string' },
        status: { type: 'string', description: 'Tire status: "available", "reserved", "pending", or "sold". Marking SOLD removes the tire from the main inventory list.' },
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
    name: 'attach_photo_to_tire',
    description:
      'Attach one or more previously-uploaded photos to an EXISTING tire. Use this when the user uploads photos and asks to add them to a tire already in inventory (e.g. "add this photo to tire-25", "attach these to the Michelin"). The photo URLs come from the system notes in the user message that delivered the uploads. ALWAYS confirm with the user which tire before calling this tool. The photos are added to the tire\'s gallery — they do not replace existing photos. Provide EITHER photo_url (single image) OR photo_urls (multiple images, all in one call) — at least one is required.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The tire id — either the uuid or the friendly id like "tire-25".' },
        photo_url: { type: 'string', description: 'Single photo URL from a system note (must be from the tire-photos storage bucket). Use this OR photo_urls.' },
        photo_urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Multiple photo URLs (from the system notes in this message) to attach in one call. All listed photos are added to the tire. Use this OR photo_url.',
        },
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
  {
    name: 'learn_tire_term',
    description:
      'Teach the catalog a new brand or model that the user has just confirmed by spelling it. Use ONLY after the user has clearly spelled or confirmed the term in the conversation. After learning, retry add_tire with confirmed_brand and/or confirmed_model set to true. Idempotent: calling with an already-known name is a no-op.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: '"brand" or "model"' },
        name: { type: 'string', description: 'The exact canonical spelling the user just confirmed.' },
        brand: { type: 'string', description: 'When kind="model", the brand the model belongs to. Required for kind="model".' },
      },
      required: ['kind', 'name'],
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
  const eqLikeFields = [
    'brand',
    'model',
    'size',
    'season',
    'condition',
    'shop',
    'location',
  ] as const;
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
      const hay = [
        friendly,
        r.brand,
        r.model,
        r.size,
        r.season,
        r.shop,
        r.location,
        r.notes,
        r.condition,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(free);
    });
  }
  return { count: rows.length, rows };
}

/**
 * Collect every distinct photo URL passed via the singular `photo_url` field,
 * the plural `photo_urls` field, or both. Order is preserved (first occurrence
 * wins); duplicates and non-strings are dropped. Used by add_tire and
 * attach_photo_to_tire to support multi-photo uploads in a single tool call.
 */
function collectPhotoUrls(input: ToolInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  if (Array.isArray(input.photo_urls)) {
    for (const u of input.photo_urls) push(u);
  }
  push(input.photo_url);
  return out;
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
  // Location: canonicalize so "warehouse" → "Warehouse"; non-preset phrases
  // are stored verbatim. An empty/whitespace value leaves the column NULL.
  if (typeof input.location === 'string') {
    const canon = canonicalizeLocation(input.location);
    if (canon) row.location = canon;
  }
  const photoUrls = collectPhotoUrls(input);

  // Catalog gate: resolve brand and model against the fuzzy-match catalog
  // before inserting. High-confidence matches substitute silently; medium
  // and unknown statuses kick the conversation back to the user so the
  // assistant can confirm or teach the term. The retry path bypasses the
  // matcher via confirmed_brand / confirmed_model.
  if (typeof input.brand === 'string' && input.brand.trim() && !input.confirmed_brand) {
    const r = await matchBrand(input.brand);
    if (r.status === 'high') {
      row.brand = r.match;
    } else if (r.status === 'medium') {
      return {
        status: 'needs_brand_confirmation',
        original: r.original,
        candidates: r.alternates,
      };
    } else {
      return { status: 'unknown_brand', original: r.original };
    }
  }
  if (typeof input.model === 'string' && input.model.trim() && row.brand && !input.confirmed_model) {
    const r = await matchModel(row.brand as string, input.model);
    if (r.status === 'high') {
      row.model = r.match;
    } else if (r.status === 'medium') {
      return {
        status: 'needs_model_confirmation',
        brand: row.brand,
        original: r.original,
        candidates: r.alternates,
      };
    } else {
      return { status: 'unknown_model', brand: row.brand, original: r.original };
    }
  }

  const missing = RECOMMENDED_FIELDS.filter((f) => row[f] === undefined);
  const { data, error } = await supabase.from('tires').insert(row).select().single();
  if (error) return { error: error.message, missing };

  // Attach all uploaded photos to the new tire (preserves the order the AI
  // listed them in, which mirrors the order the user attached them).
  let photosAttached = 0;
  if (photoUrls.length > 0 && data?.id) {
    for (const url of photoUrls) {
      try {
        const { error: photoErr } = await supabase
          .from('tire_photos')
          .insert({ tire_id: data.id, url });
        if (!photoErr) photosAttached++;
        else console.error('tire_photos insert failed', photoErr);
      } catch (e) {
        console.error('tire_photos insert threw', e);
      }
    }
  }

  await insertActivityLog({ action: 'added', tire: data, source, userEmail });
  return { inserted: data, missing, photos_attached: photosAttached };
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
  for (const f of ['shop', 'brand', 'model', 'size', 'season', 'condition', 'tread_pct', 'quantity', 'price', 'notes', 'status']) {
    if (input[f] !== undefined && input[f] !== null && input[f] !== '') patch[f] = input[f];
  }
  // Location supports clearing — explicit "" from the AI means "remove the
  // location"; we send NULL. Non-empty values are canonicalized to preset
  // capitalization when applicable.
  if (typeof input.location === 'string') {
    const canon = canonicalizeLocation(input.location);
    patch.location = canon ? canon : null;
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

/**
 * Attach a previously-uploaded photo to an EXISTING tire. The client has
 * already pushed the image into the tire-photos bucket and gave us its
 * public URL via the system-note text block on the user message; this tool
 * just creates the tire_photos row that links the two together.
 */
async function runAttachPhotoToTire(
  input: ToolInput,
  userEmail: string | null,
  source: ActivitySource,
) {
  const rawId = input.id;
  if (typeof rawId !== 'string') return { error: 'id is required' };
  const id = await resolveTireId(rawId);
  if (!id) return { error: `tire not found: "${rawId}"` };

  const photoUrls = collectPhotoUrls(input);
  if (photoUrls.length === 0) {
    return { error: 'photo_url or photo_urls is required' };
  }
  // Light validation: each URL must look like a Supabase Storage URL pointing
  // at the tire-photos bucket. Catches model hallucinations like "tire-25.jpg".
  for (const url of photoUrls) {
    if (!url.startsWith('http') || !url.includes('/tire-photos/')) {
      return {
        error: `invalid photo URL "${url}" — must be a public URL from the tire-photos storage bucket (provided in a system note)`,
      };
    }
  }

  // Fetch the tire so we can return it (and use it for the activity log).
  const { data: tire, error: fetchError } = await supabase
    .from('tires')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError || !tire) {
    return { error: `tire not found after resolve: "${rawId}"` };
  }

  const attached: Array<Record<string, unknown>> = [];
  const failed: string[] = [];
  for (const url of photoUrls) {
    const { data: photo, error: insertError } = await supabase
      .from('tire_photos')
      .insert({ tire_id: id, url })
      .select()
      .single();
    if (insertError) {
      failed.push(url);
      console.error('tire_photos insert failed', insertError);
    } else if (photo) {
      attached.push(photo as Record<string, unknown>);
    }
  }

  if (attached.length === 0) {
    return { error: 'no photos were attached', failed };
  }

  // Treat photo attachment as an edit for activity logging purposes — same
  // shape as other tire updates. One log entry covers the whole batch.
  await insertActivityLog({
    action: 'edited',
    tire,
    source,
    userEmail,
  });

  return { attached, photos_attached: attached.length, tire, failed };
}

async function runLearnTireTerm(input: ToolInput) {
  const kind = typeof input.kind === 'string' ? input.kind.toLowerCase() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { error: 'name is required' };
  if (kind === 'brand') {
    const r = await addBrandToCatalog(name);
    return { learned: 'brand', canonical: r.canonical, already_existed: !r.added };
  }
  if (kind === 'model') {
    const brand = typeof input.brand === 'string' ? input.brand.trim() : '';
    if (!brand) return { error: 'brand is required when kind="model"' };
    const r = await addModelToCatalog(brand, name);
    if (r.brandCanonical === null) {
      return {
        error: `cannot learn model "${name}" — brand "${brand}" is not in the catalog. Call learn_tire_term({ kind: "brand", name: "${brand}" }) first.`,
      };
    }
    return {
      learned: 'model',
      canonical: r.canonical,
      brand: r.brandCanonical,
      already_existed: !r.added,
    };
  }
  return { error: 'kind must be "brand" or "model"' };
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
    if (name === 'attach_photo_to_tire') return await runAttachPhotoToTire(input, userEmail, source);
    if (name === 'report_bug') return await runReportBug(input, currentShop, userEmail);
    if (name === 'learn_tire_term') return await runLearnTireTerm(input);
    return { error: `unknown tool: ${name}` };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: ToolInput }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | {
      type: 'image';
      source:
        | { type: 'base64'; media_type: string; data: string }
        | { type: 'url'; url: string };
    }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

type AttachmentInput = {
  name: string;
  type: string;
  /**
   * Base64 is OPTIONAL. For images the client now uploads to Supabase
   * Storage first and sends only `photoUrl` — skipping base64 keeps the
   * request body well under Vercel's serverless size limit (~4.5 MB).
   * PDFs/spreadsheets still come through as base64 since they're small.
   */
  base64?: string;
  /**
   * When the client has already uploaded the image to Supabase Storage,
   * it passes the public URL here. The route then uses Anthropic's url-
   * source image block — no base64 in the body at all.
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
    // session. If only base64 was sent (older client / unusual flow), try a
    // server-side upload as a fallback — and even if that fails we can still
    // use the base64 image source directly.
    let photoUrl: string | null =
      typeof att.photoUrl === 'string' && att.photoUrl.trim()
        ? att.photoUrl.trim()
        : null;

    if (!photoUrl && att.base64) {
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

    if (photoUrl) {
      // Preferred path: Anthropic fetches the image directly from the URL.
      // The request body stays tiny — no base64 in the body at all.
      blocks.push({
        type: 'image',
        source: { type: 'url', url: photoUrl },
      });
      blocks.push({
        type: 'text',
        text: `[System note: An image was uploaded and stored at "${photoUrl}". When the user wants to use uploaded photos:
 - ADDING A NEW TIRE: call add_tire with photo_url="${photoUrl}" if this is the only image attached, OR with photo_urls=["${photoUrl}", ...] including every URL from the system notes in this message if multiple images of the same tire were attached.
 - ATTACHING TO AN EXISTING TIRE (e.g. "add this to tire-25", "these are for the Michelin"): call attach_photo_to_tire with the tire's id and either photo_url="${photoUrl}" (single image) or photo_urls=["${photoUrl}", ...] (multiple).
If this message contains several "image was uploaded" notes, that means several images were attached at once — gather ALL their URLs into photo_urls in a SINGLE tool call rather than calling the tool repeatedly. Always confirm the specific tire with the user before either action. Do not repeat URLs back to the user — they're just internal context.]`,
      });
    } else if (att.base64) {
      // Fallback when there's no URL — older clients or unusual flows.
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: att.base64 },
      });
      blocks.push({
        type: 'text',
        text: `[System note: An image was attached but no storage URL is available. You may still extract tire details and add the tire — just omit photo_url from add_tire. Do not refuse to add because of the missing URL.]`,
      });
    } else {
      // Neither URL nor base64 — nothing actionable.
      blocks.push({
        type: 'text',
        text: `[Image attached but could not be processed.]`,
      });
    }
    return blocks;
  }

  // ---- PDF ----
  if (mime === 'application/pdf' || ext === 'pdf') {
    if (!att.base64) {
      blocks.push({
        type: 'text',
        text: `[Attached PDF "${att.name}" — no content available.]`,
      });
      return blocks;
    }
    blocks.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: att.base64 },
    });
    return blocks;
  }

  // ---- Spreadsheet (.csv, .tsv, .xlsx, .xls) ----
  if (['csv', 'tsv', 'xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
    if (!att.base64) {
      blocks.push({
        type: 'text',
        text: `[Attached file "${att.name}" — no content available.]`,
      });
      return blocks;
    }
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

/**
 * Identify indices of "real" user-initiated turns inside a conversation:
 * user messages whose content is plain text or a content-block array that
 * doesn't carry a tool_result. (tool_result-only user messages are part of
 * an in-flight tool loop, not a new turn.) Used to find safe truncation
 * boundaries — slicing the conversation at a user-turn index never strands
 * an orphan tool_result at position 0.
 */
function userTurnIndexes(messages: Message[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') {
      out.push(i);
      continue;
    }
    if (Array.isArray(m.content)) {
      const hasToolResult = m.content.some((b) => b.type === 'tool_result');
      if (!hasToolResult) out.push(i);
    }
  }
  return out;
}

/**
 * Drop bulky inline file content (image bytes/URLs and PDF base64) from a
 * message's content blocks. The accompanying system-note text block (added
 * by buildAttachmentBlocks) is left intact so the AI still knows the upload
 * happened and what its URL is — only the binary data goes away. Used to
 * keep older turns small when an attachment is now ancient history.
 */
function stripBulkContent(content: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  let droppedDoc = false;
  for (const block of content) {
    if (block.type === 'image') {
      // The neighbouring text block (added alongside the image) already
      // records the photo's URL. Just drop the image source.
      continue;
    }
    if (block.type === 'document') {
      droppedDoc = true;
      continue;
    }
    out.push(block);
  }
  if (droppedDoc) {
    out.push({
      type: 'text',
      text: '[Earlier PDF attachment in this turn — already processed; bytes omitted from history.]',
    });
  }
  return out;
}

/**
 * Build the slimmed message list we actually send to Anthropic per request:
 *  1. Cap history at the last `maxTurns` user-initiated turns. Older context
 *     is dropped entirely — the visible chat on the client is unaffected.
 *  2. Strip image/document binary data from every message EXCEPT the most
 *     recent user turn (the freshly-arrived one with this turn's attachments
 *     still actionable). Past attachments stay referenced by their system-
 *     note text — Anthropic doesn't need the bytes again.
 *
 * Called once per Anthropic request inside the tool loop, so each iteration
 * sends a fresh slim copy without mutating the master `messages` array.
 */
function buildRequestMessages(
  messages: Message[],
  maxTurns: number,
): Message[] {
  const turnIdxs = userTurnIndexes(messages);
  const startIdx =
    turnIdxs.length <= maxTurns
      ? 0
      : turnIdxs[turnIdxs.length - maxTurns];
  const sliced = messages.slice(startIdx);

  // Within the sliced view, find the latest user-initiated turn — its
  // attachments are still actionable this round trip and must NOT be
  // stripped.
  let latestUserTurnIdx = -1;
  for (let i = sliced.length - 1; i >= 0; i--) {
    const m = sliced[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') {
      latestUserTurnIdx = i;
      break;
    }
    if (
      Array.isArray(m.content) &&
      !m.content.some((b) => b.type === 'tool_result')
    ) {
      latestUserTurnIdx = i;
      break;
    }
  }

  return sliced.map((m, i) => {
    if (i === latestUserTurnIdx) return m;
    if (typeof m.content === 'string') return m;
    return { ...m, content: stripBulkContent(m.content) };
  });
}

/**
 * Streaming Anthropic call. Returns the raw Response so the caller can pipe
 * SSE events. Caching + max_tokens settings unchanged from the non-streaming
 * version — both still apply to streamed responses.
 */
async function callAnthropicStream(
  messages: Message[],
  system: string,
): Promise<Response> {
  return fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: [
        {
          type: 'text',
          text: system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: TOOLS,
      messages,
      stream: true,
    }),
  });
}

type StepResult = { content: ContentBlock[]; usage: AnthropicUsage | null };

/**
 * Parse an Anthropic SSE stream into final `ContentBlock[]`, invoking
 * `onTextDelta` for every visible text fragment as it arrives. Tool-use
 * blocks are accumulated server-side (their input_json deltas are stitched
 * together and parsed when the block closes); they're NOT streamed to the
 * client — the client only sees text.
 */
async function parseAnthropicStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (text: string) => void,
): Promise<StepResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  type Block = {
    kind: 'text' | 'tool_use';
    text?: string;
    toolUseId?: string;
    toolUseName?: string;
    toolUseInputJson?: string;
  };
  const blocks: Block[] = [];
  let usage: AnthropicUsage | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (!data || data === '[DONE]') continue;
      let event: {
        type?: string;
        index?: number;
        content_block?: { type: string; id?: string; name?: string };
        delta?: {
          type?: string;
          text?: string;
          partial_json?: string;
        };
        error?: { message?: string };
        message?: { usage?: AnthropicUsage };
        usage?: AnthropicUsage;
      };
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }

      if (event.type === 'content_block_start' && typeof event.index === 'number') {
        const block = event.content_block;
        if (block?.type === 'text') {
          blocks[event.index] = { kind: 'text', text: '' };
        } else if (block?.type === 'tool_use') {
          blocks[event.index] = {
            kind: 'tool_use',
            toolUseId: block.id,
            toolUseName: block.name,
            toolUseInputJson: '',
          };
        }
      } else if (event.type === 'content_block_delta' && typeof event.index === 'number') {
        const block = blocks[event.index];
        if (!block) continue;
        if (event.delta?.type === 'text_delta' && block.kind === 'text') {
          const t = event.delta.text || '';
          block.text = (block.text || '') + t;
          if (t) onTextDelta(t);
        } else if (
          event.delta?.type === 'input_json_delta' &&
          block.kind === 'tool_use'
        ) {
          block.toolUseInputJson =
            (block.toolUseInputJson || '') + (event.delta.partial_json || '');
        }
      } else if (event.type === 'error') {
        throw new Error(event.error?.message || 'anthropic stream error');
      } else if (event.type === 'message_start' && event.message?.usage) {
        // Initial usage block: input_tokens + cache_read/creation token totals.
        usage = { ...event.message.usage };
      } else if (event.type === 'message_delta' && event.usage) {
        // Final tally: output_tokens (and sometimes revised input_tokens).
        usage = { ...(usage || {}), ...event.usage };
      }
      // content_block_stop / message_stop need no action.
    }
  }

  const content: ContentBlock[] = [];
  for (const block of blocks) {
    if (!block) continue;
    if (block.kind === 'text') {
      content.push({ type: 'text', text: block.text || '' });
    } else if (block.kind === 'tool_use') {
      let input: ToolInput = {};
      try {
        input = JSON.parse(block.toolUseInputJson || '{}');
      } catch {
        // Malformed partial JSON — leave input empty, tool will likely error.
      }
      content.push({
        type: 'tool_use',
        id: block.toolUseId || '',
        name: block.toolUseName || '',
        input,
      });
    }
  }

  return { content, usage };
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not set on server' }, { status: 500 });
  }
  // Pre-flight budget check: if today's spend is already over cap, bail out
  // with 429 before doing anything expensive.
  try {
    await assertWithinBudget();
  } catch (e: unknown) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 429 },
    );
  }
  let body: {
    messages?: Message[];
    currentShop?: string;
    currentUserEmail?: string;
    hasFileInSession?: boolean;
    /** Legacy single-attachment field. Still accepted for backward compat. */
    attachment?: AttachmentInput;
    /**
     * Preferred multi-attachment field — the user can attach several photos
     * (and/or a PDF/spreadsheet) in one chat message. Each entry becomes its
     * own content block on the last user message.
     */
    attachments?: AttachmentInput[];
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

  // If the client sent fresh attachments, fold their content blocks into the
  // last user message before we hand the conversation to Anthropic. Accepts
  // both the plural `attachments` array (new clients, multi-upload) and the
  // legacy singular `attachment` field. Each attachment needs either base64
  // (PDFs / spreadsheets) or photoUrl (images) to be usable.
  const attachmentList: AttachmentInput[] = [];
  if (Array.isArray(body.attachments)) {
    for (const a of body.attachments) {
      if (a && (a.base64 || a.photoUrl)) attachmentList.push(a);
    }
  }
  if (body.attachment && (body.attachment.base64 || body.attachment.photoUrl)) {
    attachmentList.push(body.attachment);
  }
  if (attachmentList.length > 0 && messages.length > 0) {
    const lastIdx = messages.length - 1;
    const last = messages[lastIdx];
    if (last && last.role === 'user') {
      const allFileBlocks: ContentBlock[] = [];
      for (const att of attachmentList) {
        const blocks = await buildAttachmentBlocks(att);
        allFileBlocks.push(...blocks);
      }
      const existingBlocks: ContentBlock[] = typeof last.content === 'string'
        ? (last.content ? [{ type: 'text', text: last.content }] : [])
        : last.content;
      last.content = [...existingBlocks, ...allFileBlocks];
    }
  }

  // Source for activity_log: 'file' if this conversation has ever seen
  // an attachment (per client's session flag), else 'voice'.
  const source: ActivitySource = body.hasFileInSession ? 'file' : 'voice';
  const system = buildSystemPrompt(currentShop);

  // Stream NDJSON to the client. Each line is one event:
  //   { "type": "delta", "text": "..." }   text fragment from Claude
  //   { "type": "end",   "messages": [...] }  conversation history at completion
  //   { "type": "error", "error": "..." }  fatal stream error
  // The client reads chunks, fills the placeholder assistant bubble live, then
  // (after the 'end' event) overwrites apiMessages and triggers TTS.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      try {
        for (let step = 0; step < 6; step++) {
          // Send a slim copy: capped at MAX_HISTORY_TURNS user turns, with
          // older binary attachments stripped. The master `messages` array
          // keeps the full conversation so we still return it intact via
          // the 'end' event for the client to persist.
          const requestMessages = buildRequestMessages(
            messages,
            MAX_HISTORY_TURNS,
          );
          const anthropicRes = await callAnthropicStream(requestMessages, system);
          if (!anthropicRes.ok || !anthropicRes.body) {
            const body = await anthropicRes.text().catch(() => '');
            throw new Error(
              `anthropic ${anthropicRes.status}: ${body.slice(0, 300)}`,
            );
          }

          const result = await parseAnthropicStream(
            anthropicRes.body,
            (delta) => enqueue({ type: 'delta', text: delta }),
          );

          // Fire-and-forget per-step usage log. logUsage swallows errors so a
          // logging failure can't break the stream. Each tool-loop iteration
          // is its own Anthropic call → its own row.
          void logUsage({ model: MODEL, feature: 'chat', usage: result.usage });

          messages.push({ role: 'assistant', content: result.content });

          const toolUses = result.content.filter(
            (b): b is Extract<ContentBlock, { type: 'tool_use' }> =>
              b.type === 'tool_use',
          );

          if (toolUses.length === 0) {
            // Final assistant turn — close out the stream with the full
            // conversation so the client can persist it for next turn.
            enqueue({ type: 'end', messages });
            controller.close();
            return;
          }

          const toolResults: ContentBlock[] = [];
          for (const tu of toolUses) {
            const out = await runTool(
              tu.name,
              tu.input,
              currentShop,
              userEmail,
              source,
            );
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(out),
            });
          }
          messages.push({ role: 'user', content: toolResults });
        }

        enqueue({ type: 'error', error: 'tool loop did not converge' });
        controller.close();
      } catch (e: unknown) {
        enqueue({
          type: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
      // Disable reverse-proxy buffering so deltas reach the browser the
      // instant they're enqueued.
      'x-accel-buffering': 'no',
    },
  });
}
