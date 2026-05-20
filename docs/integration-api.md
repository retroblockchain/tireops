# Integration API

This is the surface tireops exposes for other apps (currently: the BuySellTires CRM at `C:\Users\chedd\crm-app`) to query inventory via the chat agent. It's a thin auth-gated wrapper around the existing `/api/chat` endpoint.

If you're an LLM or developer working on a different app that wants to ask tireops about stock, **this is the contract.**

---

## TL;DR

- **Endpoint:** `POST /api/integration/inventory`
- **Auth:** `X-Inventory-Token: <CRM_INTEGRATION_TOKEN>` (shared secret)
- **Body:** `{ "query": "natural-language question", "shop": "optional shop name" }`
- **Response:** `application/x-ndjson` stream with `delta` / `end` / `error` events (same format as `/api/chat`)

---

## Setup (one-time)

1. Generate a long random string. This is your `CRM_INTEGRATION_TOKEN`. Example:
   ```
   openssl rand -hex 32
   # → 9f3c4a8b2e1d5f7c8e4a6b3c9d2e1f5a8b4c6d7e9f1a3b5c7d9e0f2a4b6c8e0f
   ```
2. Set it in tireops's environment as `CRM_INTEGRATION_TOKEN`:
   - Local dev: add to `.env.local`
   - Vercel: add via project settings → Environment Variables
3. Give the same value to the calling app. On the CRM side, this lives as `TIREOPS_API_TOKEN`.
4. Tell the calling app the URL of the endpoint:
   - Local: `http://localhost:3001/api/integration/inventory` (or whatever port tireops dev runs on)
   - Prod: `https://<your-tireops-url>/api/integration/inventory`

To rotate: replace `CRM_INTEGRATION_TOKEN` on both sides, redeploy.

---

## Request

```http
POST /api/integration/inventory HTTP/1.1
Content-Type: application/json
X-Inventory-Token: <CRM_INTEGRATION_TOKEN>

{
  "query": "do we have any 225/65R17 winter tires?",
  "shop": "Mission"
}
```

### Body fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `query` | string | yes | The question to ask the chat agent. Natural language. The agent will route this through its tool layer (search_tires, etc.) and return a natural-language answer. |
| `shop` | string | no | A shop name to scope the query (e.g. `"Mission"`, `"Lethbridge"`). Empty/omitted = the agent considers all shops. Currently the agent uses `shop` to bias its answers but doesn't strictly filter — its system prompt mentions the shop context. |

### Auth

The `X-Inventory-Token` header must match `process.env.CRM_INTEGRATION_TOKEN` exactly. Missing token, wrong value, or server-side missing env all return `401 Unauthorized` (or `500` for server misconfig). The token is constant per environment; rotating means redeploying both sides with the new value.

There's no per-caller identification — the token is a shared secret. If multiple external apps need to call this endpoint, each should get its own token (rename the env var, add a second handler, or extend this one to validate against a list).

---

## Response

### Success: streaming NDJSON

```
HTTP/1.1 200 OK
Content-Type: application/x-ndjson

{"type":"delta","text":"Yes, "}
{"type":"delta","text":"we have "}
{"type":"delta","text":"4 sets of 225/65R17 winter tires "}
{"type":"delta","text":"at Mission, $200 each."}
{"type":"end","messages":[ ... full assistant message history ... ]}
```

One JSON object per line, separated by `\n`. Three event types:

| `type` | Fields | When |
|---|---|---|
| `delta` | `text: string` | One chunk of the assistant's text answer. Accumulate these in order to build the final reply. |
| `end` | `messages: array` | Final event. Contains the full message history (the original user message, the assistant's reply, any tool_use + tool_result rounds). You can ignore this if you only need the text answer. |
| `error` | `error: string` | Something broke server-side. Treat as a hard failure. |

### Failures

| Status | Body | Cause |
|---|---|---|
| `200` | `{"type":"error","error":"..."}` in the stream | Anthropic API error, tool execution failure, etc. The response opened a stream then surfaced the failure. |
| `400` | `{"error":"..."}` JSON | Malformed body — missing `query`, invalid JSON |
| `401` | `{"error":"Unauthorized"}` JSON | Missing or wrong `X-Inventory-Token` |
| `500` | `{"error":"Server misconfigured: ..."}` JSON | `CRM_INTEGRATION_TOKEN` env var is missing |

---

## Consumer pattern (in any language)

```javascript
// Pseudocode — actual implementation in the CRM is at lib/external-agent.js
const res = await fetch('https://tireops.example.com/api/integration/inventory', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-inventory-token': process.env.TIREOPS_API_TOKEN,
  },
  body: JSON.stringify({ query: 'do we have 225/65R17 winter?', shop: 'Mission' }),
})

const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
let answer = ''

while (true) {
  const { value, done } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split('\n')
  buffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    const evt = JSON.parse(line)
    if (evt.type === 'delta') answer += evt.text
    if (evt.type === 'error') throw new Error(evt.error)
  }
}
console.log(answer)
```

---

## What it does internally

The integration endpoint is a thin wrapper around `/api/chat`. The pipeline:

1. Validate the `X-Inventory-Token` header.
2. Parse `query` + `shop` from the body.
3. Construct a `messages` array with one user turn (`{ role: 'user', content: query }`).
4. Pass to the existing chat handler with `currentShop = shop` and `currentUserEmail = 'crm-integration@buyselltires.local'`.
5. The chat handler does its normal thing — system prompt, tool use (search_tires etc.), streaming NDJSON response.
6. That response streams straight back to the caller.

The chat agent has the full toolset available, but `ask_inventory`-style questions typically resolve through `search_tires` and don't need writes. The agent will refuse destructive actions through the integration channel the same way it does in the UI (separate-turn confirmation flow), and even if a stray write tool were invoked, it'd hit the same Supabase RLS as a normal call.

---

## Limits and gotchas

- **No CORS headers.** Browser clients on other origins would be blocked. The CRM calls this from its server side, so this isn't a problem in practice.
- **No multi-turn within a single integration call.** Each request is a single user turn. If the CRM needs follow-up questions, it sends a separate request.
- **History is dropped.** The chat handler caps at 12 user turns; since integration calls always send exactly one turn, this never applies.
- **Cost.** Each call is roughly one Anthropic API request. ~$0.020 per query when the prompt cache is cold, ~$0.003 per query when it's warm (5-minute TTL). Tireops applies a daily AI-spend cap (default $5, override via `DAILY_AI_BUDGET_USD`, see `lib/anthropic.ts`); integration traffic shares this budget with the in-app voice chat. Once the day's spend exceeds the cap, all chat calls — voice UI and integration alike — return HTTP 429 until UTC midnight. If integration volume grows enough to crowd out the shop floor, split the budgets (separate `INTEGRATION_AI_BUDGET_USD` env var) before raising the shared cap.

---

## Future evolution

When this contract changes (new auth, new fields, version bump), update this doc first. Versioning options if needed:
- A `version` field in the request body
- Or a URL path bump like `/api/integration/v2/inventory`
- Or `Accept-Version` header

Don't break the existing `/api/integration/inventory` URL without coordinating with the CRM side.
