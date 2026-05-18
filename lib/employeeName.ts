/**
 * Session-scoped employee tracking (no separate auth — the user just tells the
 * AI their name and we tag their actions with it for the session).
 *
 * Storage: sessionStorage (clears on tab close, not on sign-out). Per-shop
 * welcomed flag lets us greet exactly once per shop session.
 */

const NAME_KEY = 'tireops_employee_name';
const WELCOMED_SHOP_KEY = 'tireops_welcomed_shop';

export function getEmployeeName(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

export function setEmployeeName(name: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (name && name.trim()) sessionStorage.setItem(NAME_KEY, name.trim());
    else sessionStorage.removeItem(NAME_KEY);
  } catch {
    /* ignore */
  }
}

export function getWelcomedShop(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(WELCOMED_SHOP_KEY);
  } catch {
    return null;
  }
}

export function setWelcomedShop(shop: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (shop) sessionStorage.setItem(WELCOMED_SHOP_KEY, shop);
    else sessionStorage.removeItem(WELCOMED_SHOP_KEY);
  } catch {
    /* ignore */
  }
}
