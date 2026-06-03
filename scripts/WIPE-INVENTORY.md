# Wipe Inventory — How To

**DESTRUCTIVE.** Deletes every row from `tires` and `tire_photos`. Run only when you genuinely want the inventory cleared.

## Safety net

- **Rollback tag (code):** `pre-brand-and-wipe` — `git reset --hard pre-brand-and-wipe` to revert app code.
- **Data backup:** the script writes `backups/inventory-<ISO-timestamp>.json` BEFORE deleting, with every row from both tables. Restore by hand-writing an import or running a one-off SQL `INSERT` from the JSON.

## Dry run

```
npx tsx scripts/wipe-inventory.ts
```

Prints the row count. Makes no changes.

## Actual wipe (requires explicit flag)

```
npx tsx scripts/wipe-inventory.ts --confirm
```

Order of operations inside the script:

1. Print row count
2. Dump `tires` + `tire_photos` to `backups/inventory-<ts>.json`
3. Delete all `tire_photos` rows (to satisfy the FK on `tires.id`)
4. Delete all `tires` rows
5. Print final row count (expect 0)

If RLS blocks the delete, the run aborts with a Supabase error. Fix RLS in the dashboard and re-run.

## After running

- The dashboard will show empty state ("No tires yet").
- The JSON backup stays on disk indefinitely — `backups/` is gitignored.
- The script does NOT touch `ai_usage_log`, `activity_log`, `bug_reports`, or auth users.
