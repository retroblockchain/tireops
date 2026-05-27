// Unit tests for normalizeTireSize and formatTireSize from lib/tire-size.ts.
// Run: npx tsx scripts/smoke-tire-size.ts

import { normalizeTireSize, formatTireSize } from '../lib/tire-size';

interface Case {
  input: string;
  expected: { width: number; aspectRatio: number; diameter: number } | null;
  note: string;
}

const CASES: Case[] = [
  // --- Standard format ---
  { input: '235/65R17', expected: { width: 235, aspectRatio: 65, diameter: 17 }, note: 'standard format' },
  { input: '235/65r17', expected: { width: 235, aspectRatio: 65, diameter: 17 }, note: 'lowercase r' },
  { input: '235/65/17', expected: { width: 235, aspectRatio: 65, diameter: 17 }, note: 'slash instead of R' },

  // --- Separator variants ---
  { input: '235-65-17', expected: { width: 235, aspectRatio: 65, diameter: 17 }, note: 'dash separators' },
  { input: '235 65 17', expected: { width: 235, aspectRatio: 65, diameter: 17 }, note: 'space separators' },
  { input: '235/65 R17', expected: { width: 235, aspectRatio: 65, diameter: 17 }, note: 'space before R' },

  // --- Prefixes ---
  { input: 'P235/65R17', expected: { width: 235, aspectRatio: 65, diameter: 17 }, note: 'P prefix' },
  { input: 'LT265/70R17', expected: { width: 265, aspectRatio: 70, diameter: 17 }, note: 'LT prefix' },
  { input: 'ST225/75R15', expected: { width: 225, aspectRatio: 75, diameter: 15 }, note: 'ST prefix' },

  // --- Letter variants ---
  { input: '235/65ZR17', expected: { width: 235, aspectRatio: 65, diameter: 17 }, note: 'ZR speed rating' },
  { input: '235/65R17XL', expected: { width: 235, aspectRatio: 65, diameter: 17 }, note: 'XL suffix' },

  // --- Whitespace / case ---
  { input: '  235/65R17  ', expected: { width: 235, aspectRatio: 65, diameter: 17 }, note: 'leading/trailing whitespace' },
  { input: '235/65r17', expected: { width: 235, aspectRatio: 65, diameter: 17 }, note: 'all lowercase' },

  // --- Real values from our audit ---
  { input: '195/65R15', expected: { width: 195, aspectRatio: 65, diameter: 15 }, note: 'most common in DB (12 rows)' },
  { input: '275/35ZR15', expected: { width: 275, aspectRatio: 35, diameter: 15 }, note: 'real ZR value from DB' },
  { input: 'P215/60R16', expected: { width: 215, aspectRatio: 60, diameter: 16 }, note: 'real P-prefix from DB' },
  { input: '225/55R17', expected: { width: 225, aspectRatio: 55, diameter: 17 }, note: 'newest tire in DB' },
  { input: '265/75R18', expected: { width: 265, aspectRatio: 75, diameter: 18 }, note: 'largest diameter in DB' },

  // --- Invalid inputs ---
  { input: '', expected: null, note: 'empty string' },
  { input: 'abc', expected: null, note: 'non-numeric garbage' },
  { input: '999/999/999', expected: null, note: 'out-of-range values' },
  { input: '33x12.50R15', expected: null, note: 'flotation size (unsupported)' },
  { input: '50/30R10', expected: null, note: 'width too small (50 < 100)' },
  { input: '235/20R17', expected: null, note: 'aspect ratio too small (20 < 25)' },
  { input: '235/95R17', expected: null, note: 'aspect ratio too large (95 > 90)' },
  { input: '235/65R30', expected: null, note: 'diameter too large (30 > 28)' },
];

let passed = 0;
let failed = 0;

for (const c of CASES) {
  const result = normalizeTireSize(c.input);
  const resultStr = result ? JSON.stringify(result) : 'null';
  const expectedStr = c.expected ? JSON.stringify(c.expected) : 'null';

  if (resultStr === expectedStr) {
    passed++;
    process.stdout.write(`  PASS  ${c.note}: "${c.input}" → ${resultStr}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL  ${c.note}: "${c.input}"\n`);
    process.stdout.write(`        expected: ${expectedStr}\n`);
    process.stdout.write(`        got:      ${resultStr}\n`);
  }
}

// formatTireSize round-trip test
const formatted = formatTireSize({ width: 235, aspectRatio: 65, diameter: 17 });
if (formatted === '235/65R17') {
  passed++;
  process.stdout.write(`  PASS  formatTireSize: {235,65,17} → "${formatted}"\n`);
} else {
  failed++;
  process.stdout.write(`  FAIL  formatTireSize: expected "235/65R17", got "${formatted}"\n`);
}

process.stdout.write(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
