// ============================================================
// DESTRUCTIVE — deletes every row from the `tires` table plus
// any dependent rows in `tire_photos` that would orphan. Run
// only when you genuinely want the inventory cleared.
//
// Rollback tag (pre-wipe snapshot in git): pre-brand-and-wipe
//   git diff pre-brand-and-wipe..HEAD
// To revert app state to before this work: git reset --hard pre-brand-and-wipe
// (Data is NOT in git — restore from the JSON backup this script writes.)
//
// Usage:
//   npx tsx scripts/wipe-inventory.ts              # prints counts only, no writes
//   npx tsx scripts/wipe-inventory.ts --confirm    # actually deletes
//
// Before deleting, this script dumps every row in `tires` and
// `tire_photos` to backups/inventory-<ISO-timestamp>.json so the
// wipe is recoverable. Restore manually via SQL or a re-import
// script if needed.
// ============================================================

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

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

const confirmed = process.argv.includes('--confirm');

function isoStampForFilename(): string {
  // Date.now-equivalent is unavailable in some restricted runtimes; use plain Date here
  // since this script is invoked directly by a human, not inside a workflow.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function countTires(): Promise<number> {
  const { count, error } = await sb
    .from('tires')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`count failed: ${error.message}`);
  return count ?? 0;
}

async function dumpBackup(): Promise<string> {
  const stamp = isoStampForFilename();
  if (!existsSync('backups')) mkdirSync('backups', { recursive: true });
  const path = `backups/inventory-${stamp}.json`;

  const { data: tires, error: tiresErr } = await sb.from('tires').select('*');
  if (tiresErr) throw new Error(`tires dump failed: ${tiresErr.message}`);

  const { data: photos, error: photosErr } = await sb
    .from('tire_photos')
    .select('*');
  if (photosErr) {
    console.warn(`  WARN: tire_photos dump failed: ${photosErr.message}`);
  }

  const payload = {
    dumped_at: new Date().toISOString(),
    tires_count: tires?.length ?? 0,
    photos_count: photos?.length ?? 0,
    tires: tires ?? [],
    tire_photos: photos ?? [],
  };
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return path;
}

async function deleteDependents(): Promise<number> {
  // tire_photos references tires.id — must clear it first or the
  // delete on `tires` will fail on the foreign-key constraint.
  // RLS may block; if so, the error surfaces and the run aborts.
  const { error, count } = await sb
    .from('tire_photos')
    .delete({ count: 'exact' })
    .not('id', 'is', null);
  if (error) throw new Error(`tire_photos wipe failed: ${error.message}`);
  return count ?? 0;
}

async function deleteAllTires(): Promise<number> {
  const { error, count } = await sb
    .from('tires')
    .delete({ count: 'exact' })
    .not('id', 'is', null);
  if (error) throw new Error(`tires wipe failed: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const before = await countTires();
  console.log(`Inventory rows before: ${before}`);

  if (!confirmed) {
    console.log('\nDry run — no changes. Pass --confirm to actually wipe.');
    return;
  }

  console.log('\nDumping backup before delete...');
  const backupPath = await dumpBackup();
  console.log(`  Backup written: ${backupPath}`);

  console.log('\nDeleting dependent tire_photos rows first...');
  const photosDeleted = await deleteDependents();
  console.log(`  tire_photos deleted: ${photosDeleted}`);

  console.log('\nDeleting all tires rows...');
  const tiresDeleted = await deleteAllTires();
  console.log(`  tires deleted: ${tiresDeleted}`);

  const after = await countTires();
  console.log(`\nInventory rows after: ${after}`);
  console.log(
    after === 0
      ? '  ✓ wipe complete'
      : `  ⚠ ${after} rows remain — check RLS or fk constraints`,
  );
}

main().catch((err) => {
  console.error('wipe failed:', err);
  process.exit(1);
});
