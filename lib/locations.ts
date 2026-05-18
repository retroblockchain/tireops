/**
 * Physical storage locations for tires — the presets shown in the
 * Add / Edit picker and the inventory filter. The DB column
 * `tires.location` is just `text NULL`, so staff can save any custom
 * string via the "Custom..." option; this list only drives the UI
 * shortcuts. Edit it freely — existing tires keep whatever was saved.
 */
export const TIRE_LOCATIONS = [
  'Showroom',
  'Warehouse',
  'Container',
  'Yard',
] as const;

export type TireLocationPreset = (typeof TIRE_LOCATIONS)[number];

/** True iff `value` exactly matches one of the named presets. */
export function isPresetLocation(
  value: string | null | undefined,
): value is TireLocationPreset {
  if (!value) return false;
  return (TIRE_LOCATIONS as readonly string[]).includes(value);
}

/**
 * Normalize a user-entered location to a preset name when it's clearly the
 * same thing (case-insensitive). Returns the canonical preset name, or the
 * trimmed original string if no preset matches. Used by both UI inputs and
 * the AI tool runner so "warehouse" / "WAREHOUSE" all save as "Warehouse".
 */
export function canonicalizeLocation(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  for (const preset of TIRE_LOCATIONS) {
    if (preset.toLowerCase() === lower) return preset;
  }
  return trimmed;
}
