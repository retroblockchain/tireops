// Pure command-detection helpers for hands-free voice. No network, no
// state, no DOM — just regex on the transcribed text. Easy to reason
// about and unit-testable.

const TRIGGER_RE = /\b(done|next|submit)\b\.?\s*$/i;
const CANCEL_RE = /\b(cancel|scratch that)\b/i;

export type Command = 'cancel' | 'trigger' | null;

export function detectCommand(text: string): Command {
  const t = (text || '').toLowerCase();
  // Cancel can appear anywhere — fail-safe priority over trigger.
  if (CANCEL_RE.test(t)) return 'cancel';
  // Trigger must be at end of segment so mid-sentence "I'm done with that"
  // doesn't accidentally submit.
  if (TRIGGER_RE.test(t)) return 'trigger';
  return null;
}

export function stripTrigger(text: string): string {
  return (text || '').replace(TRIGGER_RE, '').replace(/[\s,.;]+$/, '').trim();
}
