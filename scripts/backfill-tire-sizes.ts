// Backfill width, aspect_ratio, diameter, and size_raw on all tires rows.
//
// Usage:
//   npx tsx scripts/backfill-tire-sizes.ts --dry-run   # read-only, logs intended writes
//   npx tsx scripts/backfill-tire-sizes.ts              # actually writes to the DB
//
// Prerequisites: run scripts/add-tire-size-columns.sql first.

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { normalizeTireSize } from '../lib/tire-size';

// Load env without dotenv dependency
const envContent = readFileSync('.env.local', 'utf8');
const envVars: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) envVars[match[1].trim()] = match[2].trim();
}

const sb = createClient(
  envVars.NEXT_PUBLIC_SUPABASE_URL,
  envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (dryRun) {
    console.log('=== DRY RUN — no writes will be made ===\n');
  }

  const { data: rows, error } = await sb
    .from('tires')
    .select('id, tire_number, size')
    .order('tire_number', { ascending: true });

  if (error) {
    console.error('Failed to fetch tires:', error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log('No rows in tires table.');
    return;
  }

  let succeeded = 0;
  let failed = 0;
  const failures: { id: string; tireNumber: number | null; sizeRaw: string }[] = [];

  for (const row of rows) {
    const sizeRaw = row.size || '';
    const parsed = normalizeTireSize(sizeRaw);

    if (!parsed) {
      failed++;
      failures.push({
        id: row.id,
        tireNumber: row.tire_number,
        sizeRaw,
      });
      console.log(
        `  SKIP  tire-${row.tire_number ?? '?'} (${row.id}): could not parse "${sizeRaw}"`,
      );
      continue;
    }

    const patch = {
      size_raw: sizeRaw || null,
      width: parsed.width,
      aspect_ratio: parsed.aspectRatio,
      diameter: parsed.diameter,
    };

    if (dryRun) {
      console.log(
        `  WOULD UPDATE  tire-${row.tire_number ?? '?'}: "${sizeRaw}" → ` +
          `width=${patch.width} aspect_ratio=${patch.aspect_ratio} diameter=${patch.diameter}`,
      );
    } else {
      const { error: updateErr } = await sb
        .from('tires')
        .update(patch)
        .eq('id', row.id);

      if (updateErr) {
        failed++;
        failures.push({
          id: row.id,
          tireNumber: row.tire_number,
          sizeRaw,
        });
        console.log(
          `  ERROR  tire-${row.tire_number ?? '?'} (${row.id}): ${updateErr.message}`,
        );
        continue;
      }

      console.log(
        `  OK  tire-${row.tire_number ?? '?'}: "${sizeRaw}" → ` +
          `width=${patch.width} aspect_ratio=${patch.aspect_ratio} diameter=${patch.diameter}`,
      );
    }

    succeeded++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total rows:  ${rows.length}`);
  console.log(`Succeeded:   ${succeeded}`);
  console.log(`Failed:      ${failed}`);
  if (failures.length > 0) {
    console.log(`\nFailed rows:`);
    for (const f of failures) {
      console.log(`  tire-${f.tireNumber ?? '?'} (${f.id}): "${f.sizeRaw}"`);
    }
  }
  if (dryRun) {
    console.log(`\n(Dry run — no changes written to DB)`);
  }
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
