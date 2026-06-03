// Truck-tire load range → old-style ply rating equivalent.
// B = 4-ply, C = 6, D = 8, E = 10, F = 12, G = 14, H = 16.
// Display-only — the letter is what's stored.

const PLY_BY_LETTER: Record<string, number> = {
  B: 4, C: 6, D: 8, E: 10, F: 12, G: 14, H: 16,
};

export function plyForLoadRange(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const letter = raw.trim().toUpperCase().charAt(0);
  return PLY_BY_LETTER[letter] ?? null;
}

export function formatLoadRange(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const letter = raw.trim().toUpperCase();
  if (!letter) return null;
  const ply = plyForLoadRange(letter);
  return ply != null ? `${letter} (${ply}-ply)` : letter;
}
