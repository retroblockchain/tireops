// Unit test for lib/handsfree-commands.ts trigger/cancel detection.
// Not wired into the app. Run: npx tsx scripts/smoke-handsfree-commands.ts

import { detectCommand, stripTrigger } from '../lib/handsfree-commands';

interface Case {
  input: string;
  expectedCmd: 'trigger' | 'cancel' | null;
  expectedStripped?: string;
}

const CASES: Case[] = [
  // Single-utterance dictation with trigger at the end → trigger, strip "done"
  { input: 'Michelin Pilot Sport 4S 245/40R18 set of four 200 each done', expectedCmd: 'trigger', expectedStripped: 'Michelin Pilot Sport 4S 245/40R18 set of four 200 each' },
  { input: 'Add a Bridgestone Blizzak submit', expectedCmd: 'trigger', expectedStripped: 'Add a Bridgestone Blizzak' },
  { input: 'Add a Continental ExtremeContact next', expectedCmd: 'trigger', expectedStripped: 'Add a Continental ExtremeContact' },

  // Trigger with trailing punctuation
  { input: 'Michelin Pilot Sport 4S, done.', expectedCmd: 'trigger', expectedStripped: 'Michelin Pilot Sport 4S' },

  // Cancel anywhere — beats trigger if both present
  { input: 'scratch that, I meant Michelin', expectedCmd: 'cancel' },
  { input: 'cancel', expectedCmd: 'cancel' },
  { input: 'scratch that done', expectedCmd: 'cancel' }, // cancel wins over trigger

  // No trigger / mid-sentence "done" — not a command
  { input: 'I am done with that one for now', expectedCmd: null },
  { input: '', expectedCmd: null },
  { input: 'Add a Michelin Pilot Sport 4S', expectedCmd: null }, // mid-dictation, no trigger yet

  // Whisper-style trailing artifacts that shouldn't matter
  { input: 'Hello hello hello next', expectedCmd: 'trigger', expectedStripped: 'Hello hello hello' },
];

let pass = 0;
let fail = 0;

for (const c of CASES) {
  const cmd = detectCommand(c.input);
  const cmdOk = cmd === c.expectedCmd;
  let strippedOk = true;
  if (c.expectedCmd === 'trigger' && c.expectedStripped !== undefined) {
    strippedOk = stripTrigger(c.input) === c.expectedStripped;
  }
  const ok = cmdOk && strippedOk;
  if (ok) {
    pass++;
    console.log(`  PASS  ${JSON.stringify(c.input).slice(0, 70)}  ->  ${cmd}`);
  } else {
    fail++;
    console.log(`  FAIL  ${JSON.stringify(c.input).slice(0, 70)}`);
    console.log(`        expected cmd=${c.expectedCmd}  got cmd=${cmd}`);
    if (!strippedOk) {
      console.log(`        expected strip="${c.expectedStripped}"  got strip="${stripTrigger(c.input)}"`);
    }
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
