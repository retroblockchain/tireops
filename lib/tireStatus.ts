export const TIRE_STATUSES = [
  'available',
  'reserved',
  'pending',
  'sold',
] as const;

export type TireStatus = (typeof TIRE_STATUSES)[number];

export const STALE_DAYS = 90;

export function isValidStatus(s: unknown): s is TireStatus {
  return typeof s === 'string' && (TIRE_STATUSES as readonly string[]).includes(s);
}

/** True when a tire has been in stock 90+ days AND is not already sold. */
export function isStale(
  createdAt: string | null | undefined,
  status: string | null | undefined,
): boolean {
  if (!createdAt) return false;
  if (status === 'sold') return false;
  const then = new Date(createdAt).getTime();
  if (Number.isNaN(then)) return false;
  const days = (Date.now() - then) / (24 * 60 * 60 * 1000);
  return days >= STALE_DAYS;
}

export function daysInStock(createdAt: string | null | undefined): number {
  if (!createdAt) return 0;
  const then = new Date(createdAt).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}

export type StatusStyle = {
  border: string;
  color: string;
  label: string;
};

/**
 * Semantic status colors picked to work on the dark theme — outlined pills,
 * brand-red reserved for primary actions, gentle accents for status.
 */
export function statusStyle(s: string | null | undefined): StatusStyle {
  switch (s) {
    case 'sold':
      return { border: '#7A0B1C', color: '#FF8B96', label: 'SOLD' };
    case 'reserved':
      return { border: '#8A6920', color: '#E8AC4E', label: 'RESERVED' };
    case 'pending':
      return { border: '#5A5A5A', color: '#B0B0B0', label: 'PENDING' };
    case 'available':
    default:
      return { border: '#2D5A2D', color: '#7BC57B', label: 'AVAILABLE' };
  }
}

export const STALE_STYLE = {
  border: '#7A4A1A',
  color: '#F2A53D',
};
