// CRM ↔ tireops integration endpoint.
//
// A dedicated, auth-gated wrapper around the existing /api/chat handler.
// Accepts a simpler body shape (a single `query` string + optional `shop`),
// constructs the messages array the chat handler expects, and delegates
// to it. The response is the same NDJSON stream /api/chat produces, so
// the caller (the CRM's lib/external-agent.js) consumes it the same way.
//
// Why a separate endpoint rather than adding auth to /api/chat?
//   - Keeps the existing voice UI route untouched (no risk to live shop UI).
//   - Auth boundary is explicit and dedicated.
//   - The integration contract evolves independently from the live UI.
//
// Contract: see docs/integration-api.md
//
// Required env: CRM_INTEGRATION_TOKEN — shared secret the CRM must send
// in the X-Inventory-Token header. Generate any random string; set the
// same value on both sides.

import { NextRequest } from 'next/server';
import { POST as chatPOST } from '../../chat/route';

export const runtime = 'nodejs';

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  // ---- Auth ----
  const expected = process.env.CRM_INTEGRATION_TOKEN;
  if (!expected) {
    return jsonError(
      'Server misconfigured: CRM_INTEGRATION_TOKEN is not set.',
      500,
    );
  }
  const provided = req.headers.get('x-inventory-token');
  if (!provided || provided !== expected) {
    return jsonError('Unauthorized', 401);
  }

  // ---- Body ----
  let body: { query?: unknown; shop?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  const queryRaw = typeof body.query === 'string' ? body.query.trim() : '';
  const shopRaw = typeof body.shop === 'string' ? body.shop.trim() : '';
  if (!queryRaw) {
    return jsonError('`query` is required and must be a non-empty string', 400);
  }

  // ---- Construct the request /api/chat expects ----
  const chatBody = {
    messages: [{ role: 'user', content: queryRaw }],
    currentShop: shopRaw || undefined,
    currentUserEmail: 'crm-integration@buyselltires.local',
  };
  const chatReq = new Request(req.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
  }) as unknown as NextRequest;

  // ---- Delegate ----
  // The chat handler returns a streaming NDJSON Response which we pass
  // straight back to the caller. The CRM's external-agent helper
  // aggregates the `delta` text events into a final string.
  return chatPOST(chatReq);
}
