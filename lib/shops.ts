export const UNASSIGNED_SHOP = 'Unassigned';

// One row per shop login. Add a new login here when a new shop is onboarded.
const EMAIL_TO_SHOP: Record<string, string> = {
  'buyselltiresmission@gmail.com': 'Mission',
  'buyselltiresaldergrove@gmail.com': 'Aldergrove',
  'buyselltireslethbridge@gmail.com': 'Lethbridge',
};

/**
 * Aggressive normalization: NFKC, lowercase, strip all whitespace AND every
 * invisible/zero-width character (including non-breaking space, BOM, LTR/RTL
 * marks). Defends against trailing whitespace in Supabase Auth, paste artifacts,
 * and stray invisible chars sneaking into the email field.
 */
function normalizeEmail(email: string): string {
  return email
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s ​-‏‪-‮⁠﻿]/g, '');
}

export function getShopForEmail(email: string | null | undefined): string {
  if (!email) return UNASSIGNED_SHOP;
  const normalized = normalizeEmail(email);

  // 1. Exact match.
  if (EMAIL_TO_SHOP[normalized]) return EMAIL_TO_SHOP[normalized];

  // 2. Fallback: substring match against the shop-name suffix embedded in
  //    each mapped email (the part between "buyselltires" and "@"). So a
  //    near-miss like "buyselltirelethbridge@..." (missing 's') or any
  //    other small prefix typo still resolves to Lethbridge as long as
  //    the shop name itself is present.
  for (const [key, shop] of Object.entries(EMAIL_TO_SHOP)) {
    const m = key.match(/buyselltires([a-z]+)@/);
    if (m && normalized.includes(m[1])) return shop;
  }

  return UNASSIGNED_SHOP;
}
