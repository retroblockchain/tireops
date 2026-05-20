# 0001 — How the CRM authenticates with tireops

**Status:** Accepted
**Date:** 2026-05-19

## Context

tireops needs to accept inventory queries from its sibling app, the BuySellTires CRM. The CRM's AskBox assistant will gain an `ask_inventory(question)` tool that POSTs into tireops and returns a natural-language reply. The two apps are owned by the same person but live in separate codebases, separate Vercel projects, and (most importantly) separate Supabase projects.

Three auth approaches were considered in the project brief (§15):

a) **Shared secret header** — `X-Inventory-Token`, a long random string set on both sides as an env var.
b) **Service-account JWT** — issue a JWT from a shared Supabase project that both apps trust.
c) **Cross-account Supabase service role** — give the CRM tireops's Supabase service role key.

## Decision

**Option (a): shared secret header.** The integration endpoint at `app/api/integration/inventory/route.ts` validates the `X-Inventory-Token` header against `process.env.CRM_INTEGRATION_TOKEN`. Missing or mismatched → 401. Server env var missing → 500.

## Why this and not the others

For a two-app, single-owner, no-collaborators-yet setup:

- **(b) is over-engineered.** JWTs make sense when you have multiple callers, time-bound credentials, or per-user claims. Here there's one caller (the CRM) and one credential rotation pattern (env var on both sides). The JWT path adds Supabase-shared-project setup, key management, and verification code with zero benefit at this scale.
- **(c) is dangerous.** The Supabase service role bypasses all RLS. Giving the CRM tireops's service key would mean every CRM bug is one query away from a write to the tires table. Catastrophic for a system where staff edits are conversational and trust the data.
- **(a) fits the threat model.** The only thing being authenticated is "is this request from my own other app." A long random string on both sides answers that with a single header check. Rotating is replacing the env var on both sides and redeploying — fast and idiot-proof.

## Consequences

**Good:**
- One env var per side. Trivial to set up, trivial to rotate.
- No shared infrastructure — the two Supabase projects stay independent.
- The integration endpoint is a thin wrapper around `/api/chat`, so all the destructive-action confirmation patterns, RLS, and (now) the daily budget cap apply to integration traffic identically. The CRM can't escape the agent's safety rails by entering through this door.
- Clear failure modes: 401 means "wrong or missing token," 500 means "server didn't even know what the token should be." Easy to diagnose from logs.

**Bad / accepted:**
- The token is a static long-lived secret. If it leaks (e.g., shows up in a stack trace or a console log), there's no quick way to know — rotation is manual.
- No per-caller identification. If a third app ever needs to call this endpoint, it'd either share the same token (bad) or require a second env var and a second handler (small change but a change). For now, single caller, single token — clean.
- Anyone who can read tireops's env can call the integration endpoint. That's the same blast radius as anyone reading the Anthropic key — i.e., already considered.

## How to rotate

1. Generate a new random string (`openssl rand -hex 32`).
2. Set `CRM_INTEGRATION_TOKEN` to the new value in tireops's env (local `.env.local` for dev, Vercel project settings for prod).
3. Set the matching `TIREOPS_API_TOKEN` to the same value in the CRM's env.
4. Redeploy both apps. There's no in-flight request to drain — these are stateless HTTP calls.

## Revisit when

- The integration goes public-facing (third-party apps calling in) — JWT or per-app tokens become necessary.
- More than two callers exist — same.
- A real audit logs requirement appears — per-call attribution becomes useful, which a JWT's claims provide naturally.
- Tireops or the CRM go multi-tenant — the token would need to scope per tenant.

Until then, a shared secret is exactly the right amount of complexity.
