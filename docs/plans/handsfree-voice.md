# Plan: Hands-free voice input (Phase B)

**Status:** Proposed, awaiting review
**Date:** 2026-05-20
**Backup tag:** `pre-handsfree-2026-05-20` (already pushed to origin)
**Prerequisite:** Sprint `c01e01e` (tire-catalog fuzzy matcher) — must keep working in both modes
**iOS Safari:** Explicitly deferred to a future Phase B2 sprint when an iPhone is available

## The problem this solves

The current voice flow is **tap-to-record-then-tap-again-to-stop**. That's fine for one or two tires. For inputting a batch (10, 20, 50 tires onto the floor or out of a container) it breaks down — every entry requires the user to put down whatever they're holding, walk to the phone, tap the mic, talk, tap again. The bench-phone scenario the owner is about to live in needs the phone to sit untouched while the user adds tire after tire by voice alone.

## What "hands-free" means here

- One tap to **start a session**, one tap to **stop**.
- Within the session: just talk. When you're done with one tire, say a **trigger word** ("done" / "next" / "submit"). That chunk gets transcribed, sent to the chat agent (which goes through the existing tire-catalog flow), and the mic stays live for the next tire.
- Say "cancel" or "scratch that" mid-chunk to discard the in-progress chunk and start over without leaving the session.
- Robust in noisy shop conditions (compressors, fans, conversation) and outdoors.

## What this is NOT

- **Not** wake-word / always-listening ("Hey TireOps"). Tap-to-start preserves privacy and battery, and it's an explicit user decision to "open the mic now."
- **Not** a replacement for tap-to-record. Tap-to-record stays as the fallback for single-entry use, accessibility, and any scenario where hands-free has trouble. Two coexisting modes.
- **Not** silence-based chunk submission. Silence detection fails in noisy shops — a running compressor is loud enough that "silence" almost never happens. Trigger word is more reliable.
- **Not** iOS Safari verified this sprint. Architecture chosen to be iOS-compatible in principle; verification deferred until an iPhone is available.

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Browser (Android Chrome / desktop)                            │
│                                                                │
│  AudioContext (created on user-tap gesture)                    │
│        │                                                       │
│        ▼                                                       │
│  getUserMedia({ audio: true })                                 │
│        │                                                       │
│        ▼                                                       │
│  @ricky0123/vad-web  ──┐                                       │
│  (Silero VAD, WASM)    │  speech-start / speech-end events     │
│        │               │                                       │
│        ▼               ▼                                       │
│  MediaRecorder      handler:                                   │
│  (one segment per   on speech-end →                            │
│   speech-end)       1. encode segment to webm/opus             │
│                     2. POST to /api/transcribe                 │
│                     3. parse returned text                     │
│                     4. check for cancel  → discard accumulator │
│                     5. check for trigger → submit accumulator  │
│                                            to /api/chat        │
│                     6. else → append to accumulator transcript │
│                                & wait for next speech-start    │
└────────────────────────────────────────────────────────────────┘
```

Each **VAD-detected speech segment** gets its own short MediaRecorder lifecycle, gets transcribed once, and contributes its text to a running accumulator. Trigger/cancel decisions are made on each segment's text. This avoids retranscribing the same audio multiple times and keeps Whisper costs proportional to actual speech time.

## VAD library: `@ricky0123/vad-web`

**Why this one:**

- **MIT license, free.** No commercial API or subscription.
- **WebAssembly Silero VAD.** Silero is a small (~1 MB) neural VAD trained for general-purpose voice detection — works on diverse voices, accents, noise conditions.
- **Browser-targeted.** Specifically packaged for `vad-web`; built-in audio worklet, frame-buffer management, and Promise-based API.
- **Active maintenance.** I'll verify last publish date during B1.1 before committing the dep.
- **iOS-compatible in principle.** WebAssembly + AudioWorklet are supported in iOS Safari 14.5+. Will verify in a separate sprint with an actual iPhone.

**Alternatives considered:**

- **`onnxruntime-web` + a self-hosted Silero ONNX model.** Lower level, more control, more code. Useful if `@ricky0123/vad-web` is unmaintained or unsuitable, but unnecessary for the common case.
- **Web Speech API's continuous recognition** — **rejected per the prompt.** iOS Safari support is poor, behavior varies by browser, and we'd build something we'd have to throw away.
- **Hand-rolled energy-threshold VAD.** Fails in noisy shops — the whole point of using Silero.

## Session lifecycle

```
[idle] ──tap "Start session"──▶ [requesting permission]
                                       │
                                       ▼
                                [initializing AudioContext + VAD]
                                       │
                                       ▼
   ┌──────────────────────────▶  [listening (idle)]
   │                                   │
   │                                   │ VAD: speech-start
   │                                   ▼
   │                            [capturing (active)]
   │                                   │
   │                                   │ VAD: speech-end
   │                                   ▼
   │                            [transcribing segment]
   │                                   │
   │                ┌──────────────────┼────────────────────┐
   │                │                  │                    │
   │     trigger detected      cancel detected      neither
   │                │                  │                    │
   │                ▼                  ▼                    │
   │     [submit chunk to agent]  [discard, flash UI]       │
   │                │                  │                    │
   │                ▼                  ▼                    │
   │     [chat response shown]    return to listening       │
   │                │                  │                    │
   └────────────────┴──────────────────┘                    │
                                                            │
                                                       (append to
                                                        accumulator,
                                                        wait for
                                                        next speech)
                                                            │
                                                            ▼
                                                     [listening (idle)]


Auto-stop triggers (return to idle):
- User taps "Stop session"
- 5 min with no speech-start event
- Tab backgrounded for >30 sec (via visibilitychange)
```

## Trigger word detection

**Trigger words (submit the chunk):** `done`, `next`, `submit`

**Cancel words (discard the chunk):** `cancel`, `scratch that`

**Matching logic** (applied to each segment's transcribed text):

```ts
function detectCommand(segmentText: string): 'cancel' | 'trigger' | null {
  const t = segmentText.toLowerCase().trim();
  // Check cancel FIRST — fail safe if user says both
  if (/\b(cancel|scratch that)\b\.?\s*$/.test(t)) return 'cancel';
  if (/\b(done|next|submit)\b\.?\s*$/.test(t)) return 'trigger';
  return null;
}
```

Anchoring to end-of-segment (`\s*$`) reduces false positives. "I'm done with the warehouse..." mid-sentence wouldn't fire, only "...$200 each. Done." would.

**Strip the trigger word from the submitted text** before sending to the chat agent. Keeps the assistant from seeing "Add a Michelin... done" and getting confused.

## Visual state

Reusing the existing chat UI surface. The hands-free indicator is a single new component that sits next to (or replaces) the existing mic button while a session is active:

| State | Visual | Status text |
|---|---|---|
| idle | gray mic icon, "Start hands-free session" button | "Hands-free off" |
| requesting permission | spinner | "Requesting mic..." |
| listening (idle) | green pulsing dot, slow | "Listening — say 'done' when finished with a tire" |
| capturing (speech active) | green pulsing dot, faster + brighter | "Listening..." |
| transcribing | spinner | "Transcribing..." |
| submitting | spinner | "Adding tire..." |
| cancelled | brief red strikethrough animation | "Cancelled — keep going" |
| stopped | back to idle | "Hands-free off" |

A running transcript shows underneath: each submitted chunk appears as a chat bubble, same as the tap-to-record flow. The chat agent's reply streams in as normal.

## Coexistence with tap-to-record

Both buttons render side-by-side. Only one mode runs at a time. Starting hands-free disables tap-to-record (and vice versa). Stopping either returns the other to its normal state.

The existing tap-to-record path is **untouched code**. All new code lives in:
- New file `app/components/HandsFreeSession.tsx` (the session UI + audio plumbing)
- New file `lib/handsfree-vad.ts` (VAD wrapper, audio buffer mgmt, command detection)
- Minimal hook into `app/components/VoiceChat.tsx` to render the new button and route submitted text through the existing chat handler

## Tire-catalog flow (from c01e01e) still works

Both modes submit text to the same `/api/chat`. The chat agent does its catalog matching, returns `needs_brand_confirmation` / `unknown_brand` / etc., and asks the user a follow-up question. In hands-free mode, the user's verbal answer becomes the next chunk and feeds back into the same flow naturally. No catalog code changes.

## Whisper integration

Reuse `/api/transcribe` exactly as it stands. Each speech segment becomes a multipart upload (audio blob + filename). The route returns `{ text }`. No server changes required this sprint.

**Cost estimate:** Whisper is $0.006/min. A 5-second speech segment = ~$0.0005. A 20-tire batch with 5 segments per tire = 100 transcribe calls = ~$0.05. Negligible compared to the existing Anthropic spend.

## Auto-stop behavior

Three triggers, each cleanly returning to idle without leaving anything dangling (mic released, AudioContext closed, VAD destroyed):

1. **Explicit stop** — user taps "Stop session"
2. **Long inactivity** — `setTimeout(stop, 5 * 60 * 1000)` reset on each VAD speech-start
3. **Tab backgrounded** — `visibilitychange` listener; if `document.hidden` for >30s (via secondary timer set in the listener), end session

Cleanly closing matters on mobile — leaving the mic open in the background drains battery and is poor citizenship.

## Testing strategy

**This sprint:**

| Surface | Verification |
|---|---|
| Desktop Chrome | I run the smoke tests locally on the dev server |
| Desktop Edge | Spot-check after Chrome passes |
| Android Chrome (bench phone) | Owner runs end-to-end via Vercel deploy URL or `npx serve --https` tunnel |
| Noise resilience | Owner runs with compressor/fan, reports transcription accuracy + trigger reliability |

**Deferred to future sprint:**

| Surface | Why deferred |
|---|---|
| iOS Safari (iPhone) | No iPhone currently available for testing. Architecture is iOS-compatible (WASM, AudioWorklet, MediaRecorder) but verification requires real device. |

**Why no iOS in this sprint:** The owner doesn't have an iPhone to test on. We **could** ship something untested and hope, but voice features have nasty subtle browser differences (Safari is famously strict about AudioContext lifecycle and MediaRecorder MIME support). Better to verify on devices we can actually touch, then have a separate sprint when the iPhone is available where we can iterate quickly on real failures.

The plan choices that protect iOS-readiness even without testing:

1. **WASM VAD instead of Web Speech API** — Web Speech is the biggest cross-browser disaster zone; avoiding it removes the largest iOS risk.
2. **No Safari-specific code paths anywhere** — if anything weird shows up later, it gets handled in the future sprint.
3. **MediaRecorder MIME selection already handles fallback** — the existing `pickMimeType()` function in `VoiceChat.tsx` tries opus → webm → mp4 → ogg in order. The same helper will be reused for segment encoding.

## Risks and how the plan addresses them

| Risk | Mitigation |
|---|---|
| VAD library doesn't work on Android Chrome | Gate G1 catches this. If it fails, fall back to onnxruntime-web direct integration or hand-rolled VAD. |
| False trigger word detection ("I'm done with the warehouse" → fires) | Anchor to end-of-segment in the regex. False positives caught in B4.1 desktop tests. |
| Whisper struggles with shop noise even with VAD pre-segmentation | If accuracy in B4.4 is poor, document as a known limitation; tap-to-record is the fallback. Possible future work: noise suppression preprocessing. |
| AudioContext suspended when tab backgrounded | Detect via `visibilitychange` and explicitly stop session. Don't try to fight the browser. |
| Bundle size of VAD library + WASM | Lazy-load the VAD library only when the user enters hands-free mode. The main chat bundle stays the same size for users who only tap-to-record. |
| User permanently denies mic permission | Existing tap-to-record already handles this. Hands-free shows the same error path. |
| Wake event accidentally re-triggered (e.g., assistant TTS reply is heard by mic) | TTS is muted during hands-free session OR the VAD output is suppressed while the agent is speaking. Lean toward "suppress VAD while TTS is playing" — simpler. |

## File layout

| File | New / Modified | Purpose |
|---|---|---|
| `package.json` | modified | Add `@ricky0123/vad-web` dependency |
| `lib/handsfree-vad.ts` | new | Wrapper around `@ricky0123/vad-web`. Exports `createSession({ onSegment, onError })` returning `{ start, stop }`. Owns the AudioContext + MediaRecorder lifecycle. |
| `lib/handsfree-commands.ts` | new | Tiny pure functions: `detectCommand(text)`, `stripTrigger(text)`. Unit-testable without DOM. |
| `app/components/HandsFreeSession.tsx` | new | The button + status UI. Renders inside VoiceChat. |
| `app/components/VoiceChat.tsx` | modified | Render the new `HandsFreeSession` next to the existing mic button. Route its submitted text into the existing chat-send function. |
| `app/test-vad/page.tsx` | new (then deleted at B5 or kept as a dev tool) | Minimal VAD verification page for B1 |
| `docs/content-log.md` | modified | WIP entry at B3, rich entry at B5 |
| `PROJECT_BRIEF.md` | modified | New section on hands-free, known-issues note about iOS deferral |

## Rollback plan

```bash
git reset --hard pre-handsfree-2026-05-20
```

Tag is pushed to origin. Rollback restores the codebase to the post-`c01e01e` state. The tire-catalog feature stays intact; no database changes happen in this sprint, so no DB rollback needed.

If only part of the work needs to be undone (e.g., the VAD lib is fine but the UI integration broke something), the per-phase commits give finer-grained reverts. But the tag is the nuclear option.

## Estimated effort

| Phase | Estimate |
|---|---|
| B1 — install + verify VAD on desktop | 30 min |
| B2 — session mode + capture | 1–2 hr |
| B3 — trigger word + Whisper integration | 1 hr |
| B4 — testing (owner does Android + noise) | 30 min dev + owner's time for shop tests |
| B5 — wrap-up | 20 min |
| **Total** | **~3–4 hr of dev work**, gated turn-by-turn |

## Open questions to confirm before B1

(none that block — these are nice-to-knows)

- Trigger word vocabulary: are "done", "next", "submit" the right set? Want to add "save it" or any others?
- Cancel vocabulary: are "cancel" and "scratch that" enough?
- Should the assistant's TTS reply auto-play in hands-free mode, or stay silent so the user can hear themselves speak the next tire? My default: TTS off during hands-free (suppress mic while it'd be playing anyway).
- Visual location: hands-free button beside the existing mic, or replacing it when active? My default: beside, with the existing mic disabled when hands-free is on (so the modes are visually obvious).
