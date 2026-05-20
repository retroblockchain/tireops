// Unit tests for matchSize from lib/tire-catalog.ts.
// Run: npx tsx scripts/smoke-tire-catalog-size.ts

import { matchSize } from '../lib/tire-catalog';

interface Case {
  brand: string;
  model: string;
  size: string;
  expectedStatus: 'high' | 'needs_confirmation';
  expectedSuggested?: string;
  note: string;
}

const CASES: Case[] = [
  // Exact match in common_sizes → high, no fuss
  {
    brand: 'Michelin', model: 'Pilot Sport 4S', size: '245/40R18',
    expectedStatus: 'high',
    note: 'exact match in catalog',
  },
  // Whisper-style digit garble in the rim → flag with the real size
  {
    brand: 'Michelin', model: 'Pilot Sport 4S', size: '245/40R88',
    expectedStatus: 'needs_confirmation', expectedSuggested: '245/40R18',
    note: 'rim digit typo — 88 should be 18',
  },
  // Width digit typo
  {
    brand: 'Michelin', model: 'Pilot Sport 4S', size: '345/40R18',
    expectedStatus: 'needs_confirmation', expectedSuggested: '245/40R18',
    note: 'width digit typo — 345 should be 245',
  },
  // Genuinely unusual size with no near-match → pass through silently
  {
    brand: 'Michelin', model: 'Pilot Sport 4S', size: '215/65R15',
    expectedStatus: 'high',
    note: 'unusual size, no digit-typo near match — pass through',
  },
  // Unknown brand → can\'t validate, pass through
  {
    brand: 'FakeBrand', model: 'SuperTire', size: '245/40R18',
    expectedStatus: 'high',
    note: 'unknown brand — no catalog to check against',
  },
  // Unknown model → pass through
  {
    brand: 'Michelin', model: 'NotInCatalog', size: '245/40R18',
    expectedStatus: 'high',
    note: 'unknown model under known brand',
  },
  // Case-insensitive exact match using lowercased "r"
  {
    brand: 'Michelin', model: 'Pilot Sport 4S', size: '245/40r18',
    expectedStatus: 'high',
    note: 'lowercase r — should normalize and match exactly',
  },
  // Whitespace tolerance
  {
    brand: 'Michelin', model: 'Pilot Sport 4S', size: '245/40 R18',
    expectedStatus: 'high',
    note: 'space before R — should normalize away and match',
  },
  // Letter difference (not a digit) → NOT flagged
  {
    brand: 'Bridgestone', model: 'Blizzak WS90', size: '225/65R17',
    expectedStatus: 'high',
    note: 'exact match for a Blizzak common size',
  },
  // Length-different size → NOT flagged (different tire family)
  {
    brand: 'Toyo', model: 'Open Country M/T', size: '265/75R16',
    expectedStatus: 'high',
    note: 'LT265/75R16 exists in catalog but plain 265/75R16 differs in length — pass through',
  },
  // Empty size → high (no validation needed)
  {
    brand: 'Michelin', model: 'Pilot Sport 4S', size: '',
    expectedStatus: 'high',
    note: 'empty size — no validation',
  },
];

let pass = 0;
let fail = 0;

(async () => {
  for (const c of CASES) {
    const r = await matchSize(c.brand, c.model, c.size);
    const statusOk = r.status === c.expectedStatus;
    const suggestedOk = c.expectedSuggested === undefined
      ? true
      : r.suggested === c.expectedSuggested;
    const ok = statusOk && suggestedOk;
    if (ok) {
      pass++;
      const detail = r.suggested ? `  (suggested: ${r.suggested})` : '';
      console.log(`  PASS  ${c.brand} ${c.model} ${JSON.stringify(c.size)}  ->  ${r.status}${detail}`);
    } else {
      fail++;
      console.log(`  FAIL  ${c.brand} ${c.model} ${JSON.stringify(c.size)}`);
      console.log(`        expected status=${c.expectedStatus} suggested=${c.expectedSuggested}`);
      console.log(`        got      status=${r.status} suggested=${r.suggested}`);
      console.log(`        note: ${c.note}`);
    }
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
})();
