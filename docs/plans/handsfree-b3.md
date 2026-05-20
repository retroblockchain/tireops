# Plan: Hands-free B3 — Whisper integration + trigger word submission

**Status:** Proposed, awaiting review
**Date:** 2026-05-21
**Backup tag:** `pre-handsfree-b3-2026-05-21` (pushed to origin)
**Builds on:** B1 (VAD library), B2 (session UI + capture loop), the `.mjs` fix commit. Tire-catalog flow from `c01e01e` must continue to work in hands-free mode.

## What this finishes

B2 captures voice segments and logs them. B3 makes them *do something* — pipe each segment through Whisper, detect a trigger word, and submit the accumulated chunk to the existing `/api/chat` so the tire actually gets added. The user can finally say "Add a Michelin Pilot Sport 4S, 245/40R18, set of 4, 200 each, warehouse, **done**" and watch a row land in inventory without touching the phone.

## Architecture

```
                         ┌─────────────────────────────────────┐
                         │  HandsFreeSession.tsx (orchestrator) │
                         │  ─────────────────────────────────── │
                         │  • holds accumulator state           │
                         │  • drives status UI                  │
                         │  • passes final text to parent       │
                         └──────────────┬──────────────────────┘
                                        │
                                        │ onSpeechEnd(audio)
                                        │
            ┌──────────────────────────┼─────────────────────────────┐
            │                          │                             │
            ▼                          ▼                             ▼
   lib/handsfree-vad.ts      lib/handsfree-transcribe.ts    lib/handsfree-commands.ts
   ─────────────────────     ──────────────────────────────  ──────────────────────────
   VAD lifecycle (B2,        WAV-encode the Float32         pure: detectCommand(text),
   unchanged). Emits         segment, POST it to            stripTrigger(text). Regex on
   each speech segment       /api/transcribe, return        the transcribed string. No
   as 16 kHz Float32.        the transcript text.            network, no state.
```

`lib/handsfree-vad.ts` is **unchanged** from B2 — it already emits clean speech segments. B3 only adds two thin new layers (transcription + command detection) and wires the orchestrator in `HandsFreeSession.tsx`.

## Trigger word detection — post-Whisper, anchored to segment end

**Trigger vocabulary** (submit the chunk): `done`, `next`, `submit`
**Cancel vocabulary** (discard the chunk): `cancel`, `scratch that`

**Matching:**

```ts
function detectCommand(text: string): 'cancel' | 'trigger' | null {
  const t = text.toLowerCase().trim();
  // Cancel can appear ANYWHERE in the segment — "scratch that, I meant
  // Michelin" should cancel even though words follow.
  if (/\b(cancel|scratch that)\b/.test(t)) return 'cancel';
  // Trigger must be at the END of the segment so mid-sentence "I'm done
  // with that one" doesn't accidentally submit.
  if (/\b(done|next|submit)\.?\s*$/.test(t)) return 'trigger';
  return null;
}
```

Cancel-anywhere / trigger-only-at-end is the right asymmetry: cancel is safety-critical (we'd rather have an extra false-positive cancel than a wrong tire saved), trigger is action-critical (we'd rather miss one false-negative submit than fire on a mid-sentence "done").

**Strip the trigger word before submitting** so the assistant sees "Add a Michelin Pilot Sport 4S, 245/40R18, set of 4, 200 each, warehouse" — not "...done." Less noise for the catalog matcher in `c01e01e`.

## Why post-Whisper trigger detection (not pre-Whisper keyword spotting)

| | Post-Whisper | Pre-Whisper keyword spotter |
|---|---|---|
| Accuracy on noisy speech | Whisper is state-of-the-art for English noise/accents | Smaller models are brittle in shop conditions |
| Accent robustness | Whisper trained on diverse English | Keyword spotters often fail on non-US-English accents |
| Code complexity | Regex on a string. ~5 lines. | Run a second ML model in the browser, manage its WASM, tune thresholds |
| Cost per chunk | ~$0.001 (Whisper on 5-15 sec audio) | Free locally but ~10 MB more WASM to ship |
| Latency | ~500-1500 ms per chunk (Whisper round-trip) | <100 ms (local) |
| Catalog handling | Same as text input — the agent's tire-catalog flow from c01e01e works as-is | Would need separate text submission anyway |

The latency cost is real but acceptable — every chunk goes through Whisper anyway (otherwise we can't get the tire content to the agent), so the trigger detection is **free** on top. We're not adding a Whisper call; we're parsing one we already had to make.

## Accumulator semantics — multi-segment dictation

A single tire dictation might span multiple VAD segments if the user pauses to read off the sidewall or think. Example:

> "Add a Michelin Pilot Sport 4S" [pause — VAD ends segment 1]
> "245/40R18, set of four" [pause — VAD ends segment 2]
> "200 each, in the warehouse, done" [VAD ends segment 3]

If we treated each VAD segment as an independent chunk and discarded any without a trigger, we'd lose brand/model/size and submit only "200 each, in the warehouse" — broken.

**The accumulator** is a running transcript that grows segment-by-segment and resets on trigger/cancel:

```
on speech-end(audio):
  text = await transcribe(audio)
  if detectCommand(text) === 'cancel':
    accumulator = ""        # visual feedback: brief red flash
  elif detectCommand(text) === 'trigger':
    full = accumulator + " " + stripTrigger(text)
    await sendToChat(full.trim())
    accumulator = ""        # cleared for next tire
  else:
    accumulator += " " + text
    # (no submit yet — wait for next segment)
```

The accumulator naturally clears on success or cancel. If the user dictates partially and walks away, the 5-min inactivity timer from B2 stops the whole session and the accumulator dies with it. No stale-state edge case to handle separately.

## Cancel flow

**Trigger:** "cancel" or "scratch that" anywhere in the just-transcribed segment.

**Behavior:**
1. Clear the accumulator (toss everything dictated so far for this tire).
2. UI: brief red flash on the transcript pane, then it goes empty.
3. Mic stays live — user is presumed to retry immediately ("scratch that — Michelin Pilot Sport 4S, 245/40R18, set of four, 200 each, done").
4. No HTTP call to /api/chat. The cancel is purely local.

**Cancel priority over trigger:** if a segment contains BOTH (e.g., "done, scratch that"), cancel wins. Fail-safe — discard rather than save.

## Chat integration

Once the accumulated transcript has a trigger and is stripped:

1. **HandsFreeSession** calls `onTranscribedText(text)` (a new prop, added back after I removed it as unused in B2).
2. **VoiceChat** receives the text and calls its existing `send(text)` function — same function the tap-to-record path uses after Whisper, same function the typed-input path uses.
3. The chat agent runs through its existing tire-catalog flow from `c01e01e`. If the AI returns `needs_brand_confirmation` / `unknown_brand`, the AI's natural-language follow-up streams into the chat history as usual.
4. The user's verbal answer to that follow-up becomes the **next** hands-free chunk — Whisper transcribes "yes, Bridgestone" or "Blizzak WS90", trigger word "done" or no trigger but still get submitted, and the catalog confirmation completes.

**This means the existing two-turn catalog confirmation flow works in hands-free without any changes to the chat route.** The verbal "yes" or "WS90" answer is just another chunk through the same pipeline.

One nuance: in hands-free, when answering a brand-confirmation prompt, the user might say "yes Bridgestone done" — the "done" is the trigger, leaving "yes Bridgestone" as the submitted text. That's exactly what the agent expects.

## UI updates

The B2 status row stays as-is. New additions:

**Transcribing state** — between speech-end and Whisper response (~500-1500 ms):
- Status changes to "Transcribing…" with a spinner where the indicator dot was
- Brief, but visible enough to confirm something's happening

**Accumulator display** — when the accumulator has content but no trigger yet:
- Small text strip below the status row: `"…Add a Michelin Pilot Sport 4S, 245/40R18"`
- Truncate to last ~80 chars if longer, prefix with ellipsis
- Disappears on submit (cleared) or after status returns to "Listening" with empty accumulator

**Submission state** — between trigger detection and chat response:
- Status changes to "Adding tire…" with a spinner
- After chat agent responds, status returns to "Listening" for the next tire

**Cancel feedback:**
- Accumulator strip animates: red flash + strikethrough for ~600 ms, then disappears
- Status briefly reads "Canceled — keep going"

**Segment counter** — repurposed for B3:
- Was "3 segments, last 1240ms" in B2 (raw VAD count)
- Becomes "Tires submitted: N" — meaningful metric for the user
- Resets at session start

## Failure modes

| Failure | Detection | Response |
|---|---|---|
| `/api/transcribe` returns 500 | `res.ok === false` | Log, set status to "Transcribe error", brief red flash on indicator, clear accumulator, return to listening. The user can re-dictate the tire. |
| Network timeout (`fetch` rejects) | `try/catch` around fetch | Same as above. |
| Whisper returns empty string | `text.trim() === ''` | Treat as "no speech detected" — silently discard segment, no accumulator change. No UI noise. |
| Chunk too short for Whisper | VAD already discards via `onVADMisfire` in B2 | No change — handled upstream. |
| `/api/chat` returns 429 (budget) | Same handling as tap-to-record path | The existing chat error display covers it. We do NOT auto-stop hands-free on a single 429 — user might want to retry tomorrow. |
| `/api/chat` returns 500 | Same as tap-to-record | Same display, hands-free session continues. |
| User says trigger word with empty accumulator (e.g., just walks up and says "done") | `full.trim() === ''` after stripping | Silently skip — don't submit empty text. Status reads "Listening" again. |
| User says cancel word with empty accumulator | Same | Silently no-op. No visual flash for empty cancel. |
| Trigger word in same segment that started the accumulator (e.g., "Michelin Pilot Sport 4S done") | Normal — accumulator was empty, current segment is "Michelin Pilot Sport 4S done", strip trigger → submit "Michelin Pilot Sport 4S" | Works correctly — single-utterance dictation is a special case of the general flow. |

## File changes

| File | Change |
|---|---|
| `lib/handsfree-vad.ts` | **No change.** B2's VAD wrapper already emits segments cleanly. |
| `lib/handsfree-transcribe.ts` | **New.** One exported function: `transcribeSegment(audio: Float32Array): Promise<string>`. Uses `@ricky0123/vad-web`'s `utils.encodeWAV` to make a WAV blob, POSTs it to `/api/transcribe`, returns the text. ~30 lines. |
| `lib/handsfree-commands.ts` | **New.** Two pure functions: `detectCommand(text)` and `stripTrigger(text)`. ~25 lines. Unit-testable without DOM. |
| `app/components/HandsFreeSession.tsx` | **Modified.** Add accumulator state, transcribing/submitting status states, accumulator UI strip, transcription + command detection in the speech-end handler. Re-add the `onTranscribedText` prop that was removed in B2. |
| `app/components/VoiceChat.tsx` | **One small edit.** Pass an `onTranscribedText` prop that wraps the existing `send()` function. No other changes. |
| `/api/transcribe` route | **No change.** Already accepts multipart audio uploads and returns `{ text }`. |
| `/api/chat` route | **No change.** Reused as-is — same flow tap-to-record uses. Tire-catalog flow from `c01e01e` works without modification. |

Net new code: ~200 lines split across two new lib files + the orchestration logic in HandsFreeSession. The two lib files are small and pure (one network helper, one regex helper); the complexity lives in the component where it belongs.

## Testing strategy

**Local desktop (Chrome) — B3.4.1:**
- Single-segment dictation: "Michelin Pilot Sport 4S 245/40R18 set of 4 200 each done" → expect tire inserted as canonical, no catalog confirmation.
- Multi-segment dictation: "Michelin Pilot Sport 4S" [pause 2s] "245/40R18 set of four done" → expect accumulator stitches the two, tire inserted.
- Medium-confidence brand: "Birdgestone Blizzak WS90 done" → catalog matcher kicks medium → AI asks "Did you mean Bridgestone?" → user says "yes done" → tire inserted. Verifies the verbal-confirmation flow.
- Cancel mid-utterance: "Michelin Pilot Sport 4S" [pause] "scratch that, Michelin CrossClimate 2 215/55R17 done" → first chunk gets accumulated, "scratch that" clears, second chunk submits CrossClimate. Verify only the second tire lands.
- Empty trigger: just say "done" with no prior accumulator → silently skipped, no chat submission.
- Whisper error simulation: if practical, temporarily break the endpoint and confirm graceful failure. Otherwise rely on the failure-mode table.

**Android bench phone — B3.4.3:** 5 tire additions hands-free, phone on the bench, no hand-holding. Various brands including at least one likely-medium-confidence one.

**Shop noise — B3.4.4:** turn on a fan or run water; do 3-5 entries; report transcription accuracy and trigger-word reliability.

## Risks

| Risk | Mitigation |
|---|---|
| Whisper transcribes "done" as something else ("dome", "down", "don't") | Have a small set of common Whisper-style misreads in the trigger regex if it becomes an issue. Not adding pre-emptively — wait for actual failures in B3.4. |
| Whisper inserts "thank you" or "you" at start/end (known idiosyncrasy on quiet inputs) | The trigger regex anchors to `\b(done|next|submit)\.?\s*$` — extra trailing punctuation OK; trailing "thank you" would prevent match (i.e., wouldn't submit), which is a false negative. Acceptable for now. |
| Multi-tire batch: user says "Michelin done… Bridgestone done… Continental done" — first "done" submits while second batch is still being captured | The architecture handles this naturally — each "done" triggers a submit and clears the accumulator. The second tire is its own accumulator from the start. No special case. |
| Network is slow on Android cellular → Whisper round-trip takes 5+ seconds → user dictates next tire while previous one is still transcribing | Two concurrent in-flight transcribes is fine (they're independent HTTP requests). The bigger concern is order — if request 2 returns before request 1, the chat history could get scrambled. **Mitigation:** serialize transcribe + chat-send per session via an internal queue. If queue depth > 3, drop newer segments and log a warning (user is dictating faster than we can process). |
| The agent's reply auto-plays via TTS and the mic re-captures it | Suppress TTS while a hands-free session is active (per the B-plan question 3 we agreed on). |

## Rollback plan

```bash
git reset --hard pre-handsfree-b3-2026-05-21
```

Tag is pushed to origin. Restores the codebase to the post-`4e187e9` state (B2 working, no B3). No DB changes in this sprint.

## Cost estimate

- Whisper at $0.006/min. Average segment ~7 sec → ~$0.0007/segment.
- Per tire entry: average 2-3 segments + 1 catalog confirmation segment = 4 segments = ~$0.003 in Whisper.
- A 20-tire batch: ~$0.06 in Whisper.
- Plus the Anthropic chat cost (~$0.02-0.05 per turn, varies with catalog hits) — same as today.
- Total per tire ≈ $0.03-0.06, dominated by Anthropic not Whisper.

Comfortably within the $5/day budget cap from the cost-guardrails sprint.

## Estimated effort

| Phase | Estimate |
|---|---|
| B3.2 — Whisper wired into capture loop (2 new lib files + speech-end handler change) | 30-45 min |
| B3.3 — orchestrator UI + accumulator state + chat-send wiring | 45-60 min |
| B3.4.1 — desktop testing (me + owner) | 20 min |
| B3.4.3-4 — Android + noise testing (owner) | owner's time |
| B3.5 — wrap-up | 15 min |
| **Total** | **~2-3 hr of dev work**, gated turn-by-turn |

## Open questions (defaults stated)

- **Suppress TTS during hands-free?** Default: **yes**, agreed at the original B plan question 3. The chat reply will appear in the visual chat history; mic won't be picking up the assistant's voice.
- **Auto-stop on Whisper budget exhaustion (429)?** Default: **no**, keep listening. The user will see the error in the chat history and can decide to stop.
- **Show the accumulator transcript on screen?** Default: **yes**, small text strip below the status row. Clearing on submit/cancel is the visual feedback.
- **Order-of-operations guarantee under concurrent transcribes?** Default: **serialize per session via an internal queue.** Two simultaneous transcribes can race; serializing keeps the chat history coherent.
