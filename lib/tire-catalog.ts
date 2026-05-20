// Tire knowledge base: fuzzy-match brand and model names against a
// curated catalog so voice-transcription garbles like "Mishelin pilot
// sport force" resolve to "Michelin Pilot Sport 4S" before they hit
// the database. Catalog lives at lib/tire-catalog.json and grows at
// runtime when the chat agent confirms a new brand/model with the user.
//
// Matching uses Sørensen–Dice similarity on character trigrams — no
// dependency, ~15 lines of math. Each input is scored against the
// canonical name and every alias; the best score per entry wins.
//
// Persistence note: addBrand/addModel write to lib/tire-catalog.json
// via fs/promises. Vercel's runtime filesystem is read-only so writes
// no-op silently in production — the catalog grows on the developer's
// laptop and gets committed to git like any other change.

import { promises as fs } from 'fs';
import path from 'path';

const CATALOG_PATH = path.join(process.cwd(), 'lib', 'tire-catalog.json');

export type Season =
  | 'summer'
  | 'winter'
  | 'all-season'
  | 'all-weather'
  | 'all-terrain'
  | 'mud-terrain'
  | 'performance'
  | 'touring';

export interface CatalogModel {
  name: string;
  aliases?: string[];
  season?: Season | string;
  common_sizes?: string[];
}

export interface CatalogBrand {
  name: string;
  aliases?: string[];
  models: CatalogModel[];
}

export interface Catalog {
  version: string;
  generated_at: string;
  notes?: string;
  brands: CatalogBrand[];
}

export type MatchStatus = 'high' | 'medium' | 'none';

export interface MatchResult {
  status: MatchStatus;
  match: string | null;
  confidence: number;
  alternates: Array<{ name: string; score: number }>;
  original: string;
}

export type SizeMatchStatus = 'high' | 'needs_confirmation';

export interface SizeMatchResult {
  status: SizeMatchStatus;
  /** The size string to use as-is on insert. Same as the user gave on
   * 'high'; on 'needs_confirmation' the caller should not insert yet. */
  match: string;
  original: string;
  /** When status is 'needs_confirmation', the catalog size that differs
   * from `original` by exactly one digit — the likely intended size. */
  suggested?: string;
}

// Tier thresholds — see the plan for rationale.
// HIGH gate: top score must clear 0.85.
// FLOOR: anything below 0.6 is treated as no match at all.
// GAP: if top > 0.85 but a runner-up is within GAP of the top score,
// the result is ambiguous → medium. An exact (1.000) match against
// "Pilot Sport 4S" shouldn't be downgraded just because "Pilot Sport 5"
// is also similar; it should only be downgraded when something else is
// almost as similar.
const HIGH_THRESHOLD = 0.85;
const FLOOR_THRESHOLD = 0.6;
const AMBIGUITY_GAP = 0.15;

// --------- Similarity primitives ---------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function trigrams(s: string): Set<string> {
  // Pad so leading/trailing characters generate trigrams too — helps
  // short strings like "PS4S" score sensibly against longer ones.
  const padded = `  ${normalize(s)}  `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// Best score of input against any of a canonical+aliases bundle.
function bestScore(input: string, canonical: string, aliases?: string[]): number {
  let best = similarity(input, canonical);
  if (aliases) for (const a of aliases) {
    const s = similarity(input, a);
    if (s > best) best = s;
  }
  return best;
}

// --------- Catalog loading + caching ---------

let _catalog: Catalog | null = null;

export async function loadCatalog(): Promise<Catalog> {
  if (_catalog) return _catalog;
  const raw = await fs.readFile(CATALOG_PATH, 'utf-8');
  _catalog = JSON.parse(raw) as Catalog;
  return _catalog;
}

// Test-only: drop the cache so a fresh load picks up disk changes.
export function _resetCatalogCache(): void {
  _catalog = null;
}

// --------- Matching ---------

function tierFromScores(scored: Array<{ name: string; score: number }>): MatchResult {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (!top || top.score < FLOOR_THRESHOLD) {
    return { status: 'none', match: null, confidence: top?.score ?? 0, alternates: [], original: '' };
  }
  const aboveFloor = sorted.filter((s) => s.score >= FLOOR_THRESHOLD);
  const second = sorted[1];

  // High tier requires both clearing 0.85 AND being clearly ahead of the
  // runner-up. A 1.000 match with a 0.77 runner-up is unambiguous; two
  // candidates at 0.88 each is not.
  if (top.score > HIGH_THRESHOLD && (!second || top.score - second.score > AMBIGUITY_GAP)) {
    return { status: 'high', match: top.name, confidence: top.score, alternates: [], original: '' };
  }

  return {
    status: 'medium',
    match: top.name,
    confidence: top.score,
    alternates: aboveFloor.slice(0, 3),
    original: '',
  };
}

export async function matchBrand(input: string): Promise<MatchResult> {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return { status: 'none', match: null, confidence: 0, alternates: [], original: trimmed };
  }
  const catalog = await loadCatalog();
  const scored = catalog.brands.map((b) => ({
    name: b.name,
    score: bestScore(trimmed, b.name, b.aliases),
  }));
  return { ...tierFromScores(scored), original: trimmed };
}

export async function matchModel(brand: string, input: string): Promise<MatchResult> {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return { status: 'none', match: null, confidence: 0, alternates: [], original: trimmed };
  }
  const catalog = await loadCatalog();
  const target = catalog.brands.find(
    (b) => normalize(b.name) === normalize(brand),
  );
  if (!target) {
    return { status: 'none', match: null, confidence: 0, alternates: [], original: trimmed };
  }
  const scored = target.models.map((m) => ({
    name: m.name,
    score: bestScore(trimmed, m.name, m.aliases),
  }));
  return { ...tierFromScores(scored), original: trimmed };
}

// --------- Size validation ---------

function normalizeSize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

// True iff a and b have the same length AND differ at exactly one position
// AND that one position is a digit on both sides. So "245/40r18" vs
// "245/40r88" matches (one digit typo); "245/40r18" vs "245/40z18" doesn't
// (letter swap, not a digit); "lt265/70r17" vs "265/70r17" doesn't (length
// mismatch — different tire family).
function isDigitTypo(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diffs = 0;
  let diffIdx = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      diffs++;
      if (diffs > 1) return false;
      diffIdx = i;
    }
  }
  if (diffs !== 1) return false;
  return /\d/.test(a[diffIdx]) && /\d/.test(b[diffIdx]);
}

// Validate a user-given size against the catalog's known common_sizes for
// the resolved brand+model. Conservative: only flag when there's a clear
// digit-typo near-miss in the catalog. If the model has no recorded sizes,
// or no size is close, pass the user's size through silently — the catalog
// isn't comprehensive and we don't want false-positive friction.
export async function matchSize(
  brand: string,
  model: string,
  inputSize: string,
): Promise<SizeMatchResult> {
  const trimmed = (inputSize || '').trim();
  if (!trimmed) return { status: 'high', match: trimmed, original: trimmed };

  const catalog = await loadCatalog();
  const brandEntry = catalog.brands.find(
    (b) => normalize(b.name) === normalize(brand),
  );
  if (!brandEntry) return { status: 'high', match: trimmed, original: trimmed };
  const modelEntry = brandEntry.models.find(
    (m) => normalize(m.name) === normalize(model),
  );
  if (!modelEntry) return { status: 'high', match: trimmed, original: trimmed };
  const sizes = modelEntry.common_sizes;
  if (!sizes || sizes.length === 0) {
    return { status: 'high', match: trimmed, original: trimmed };
  }

  const n = normalizeSize(trimmed);
  // Exact match (case + whitespace insensitive) → accept silently, using
  // the catalog's canonical form (preserves R / ZR capitalization, etc.).
  for (const s of sizes) {
    if (normalizeSize(s) === n) {
      return { status: 'high', match: s, original: trimmed };
    }
  }
  // No exact match — look for a single-digit-typo near match.
  for (const s of sizes) {
    if (isDigitTypo(normalizeSize(s), n)) {
      return {
        status: 'needs_confirmation',
        match: trimmed,
        original: trimmed,
        suggested: s,
      };
    }
  }
  // No exact match, no near match — accept as-is. Catalog may be incomplete.
  return { status: 'high', match: trimmed, original: trimmed };
}

// --------- Persistence ---------

// Find brand index by case-insensitive canonical match.
function findBrandIndex(catalog: Catalog, name: string): number {
  const n = normalize(name);
  return catalog.brands.findIndex((b) => normalize(b.name) === n);
}

async function writeCatalog(catalog: Catalog): Promise<void> {
  try {
    await fs.writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
  } catch (err) {
    // Read-only filesystem (Vercel) or other write failure — log and
    // swallow. In-memory cache still has the addition for this request.
    console.warn('tire-catalog: disk write skipped:', (err as Error)?.message);
  }
}

export async function addBrandToCatalog(
  name: string,
  alias?: string,
): Promise<{ added: boolean; canonical: string }> {
  const catalog = await loadCatalog();
  const trimmed = name.trim();
  if (!trimmed) return { added: false, canonical: '' };

  const existing = findBrandIndex(catalog, trimmed);
  if (existing >= 0) {
    const brand = catalog.brands[existing];
    // Maybe add a new alias to an existing brand.
    if (alias && alias.trim()) {
      brand.aliases = brand.aliases ?? [];
      if (!brand.aliases.some((a) => normalize(a) === normalize(alias))) {
        brand.aliases.push(alias.trim());
        await writeCatalog(catalog);
      }
    }
    return { added: false, canonical: brand.name };
  }

  catalog.brands.push({
    name: trimmed,
    aliases: alias && alias.trim() ? [alias.trim()] : [],
    models: [],
  });
  await writeCatalog(catalog);
  return { added: true, canonical: trimmed };
}

export async function addModelToCatalog(
  brand: string,
  model: string,
  season?: string,
  sizes?: string[],
): Promise<{ added: boolean; canonical: string; brandCanonical: string | null }> {
  const catalog = await loadCatalog();
  const trimmedModel = model.trim();
  if (!trimmedModel) return { added: false, canonical: '', brandCanonical: null };

  const brandIdx = findBrandIndex(catalog, brand);
  if (brandIdx < 0) {
    return { added: false, canonical: trimmedModel, brandCanonical: null };
  }
  const target = catalog.brands[brandIdx];
  const existing = target.models.find(
    (m) => normalize(m.name) === normalize(trimmedModel),
  );
  if (existing) {
    return { added: false, canonical: existing.name, brandCanonical: target.name };
  }
  target.models.push({
    name: trimmedModel,
    aliases: [],
    season: season as Season | undefined,
    common_sizes: sizes && sizes.length ? sizes : undefined,
  });
  await writeCatalog(catalog);
  return { added: true, canonical: trimmedModel, brandCanonical: target.name };
}
