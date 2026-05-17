export const UNASSIGNED_SHOP = 'Unassigned';

// One row per shop login. Add a new login here when a new shop is onboarded.
const EMAIL_TO_SHOP: Record<string, string> = {
  'buyselltiresmission@gmail.com': 'Mission',
  'buyselltiresautogrove@gmail.com': 'Autogrove',
  'buyselltireslethbridge@gmail.com': 'Lethbridge',
};

export function getShopForEmail(email: string | null | undefined): string {
  if (!email) return UNASSIGNED_SHOP;
  return EMAIL_TO_SHOP[email.toLowerCase().trim()] || UNASSIGNED_SHOP;
}
