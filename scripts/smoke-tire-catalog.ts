// One-off smoke test for lib/tire-catalog.ts. Not wired into the app.
// Run: npx tsx scripts/smoke-tire-catalog.ts

import { matchBrand, matchModel } from '../lib/tire-catalog';

function fmt(label: string, r: Awaited<ReturnType<typeof matchBrand>>) {
  const alt = r.alternates.length
    ? `  alternates: ${r.alternates.map(a => `${a.name} (${a.score.toFixed(3)})`).join(', ')}`
    : '';
  console.log(`${label}\n  status: ${r.status.padEnd(7)} match: ${String(r.match)}  confidence: ${r.confidence.toFixed(3)}${alt ? '\n' + alt : ''}\n`);
}

async function run() {
  console.log('=== Section 1: prompted inputs against matchBrand as full strings ===');
  console.log('(In production, the AI parses these into brand+model fields first.)\n');
  for (const input of [
    'Michelin Pilot Sport 4S',
    'Michellin pilot sport four S',
    'PS4S',
    'Birdgestone Blizzak',
    'FakeBrand SuperTire',
  ]) {
    fmt(`input: "${input}"`, await matchBrand(input));
  }

  console.log('=== Section 2: realistic brand-only inputs (what production passes) ===\n');
  for (const input of [
    'Michelin',
    'Michellin',          // canonical alias
    'Mishelin',           // phonetic alias
    'Birdgestone',        // typo
    'PS4S',               // model alias, NOT a brand → expect none
    'FakeBrand',
    'BFG',                // shorthand alias
    'Yoko',               // shorthand alias
    'Conti',              // shorthand alias
  ]) {
    fmt(`input: "${input}"`, await matchBrand(input));
  }

  console.log('=== Section 3: matchModel scoped to brand ===\n');
  for (const [brand, model] of [
    ['Michelin', 'Pilot Sport 4S'],
    ['Michelin', 'pilot sport four S'],
    ['Michelin', 'PS4S'],
    ['Michelin', 'Pilot Sport Force'],   // alias
    ['Bridgestone', 'Blizzak WS90'],
    ['Bridgestone', 'Bliz Zach Ninety'], // garbled
    ['Bridgestone', 'Blizzak'],          // ambiguous: WS90 vs DM-V2
    ['BFGoodrich', 'KO2'],               // shorthand alias
    ['Pirelli', 'P Zero'],
    ['Falken', 'Wildpeak A T 3 W'],      // Whisper spacing
  ] as Array<[string, string]>) {
    fmt(`brand="${brand}" input="${model}"`, await matchModel(brand, model));
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
