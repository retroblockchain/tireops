export const COLORS = {
  // BuySell brand
  red: '#C8102E',
  redHover: '#A00D24',
  redDeep: '#B53344',       // destructive — readable on dark surfaces
  redSoftBg: '#2A0F14',     // dark wine tint for listening pill background

  // Dark theme neutrals
  black: '#000000',
  ink: '#FAFAFA',           // headings, primary text
  textBody: '#D4D4D4',      // body
  textMuted: '#9A9A9A',     // secondary
  textSubtle: '#6B6B6B',    // very subtle (version label, hints)

  border: '#2A2724',        // subtle dividers
  borderStrong: '#3D3A36',  // input borders, more visible

  surface: '#1F1D1A',       // cards, inputs
  surfaceSoft: '#2A2724',   // tag backgrounds
  bg: '#15130F',            // page background
} as const;

/**
 * Subtle "lift" for cards on the dark theme. A 1px highlight on the top
 * edge suggests a soft light source; the soft drop shadow underneath
 * provides depth without making the page feel busy. Use sparingly on
 * primary content cards (tire cards, log entries, form panels).
 */
export const SHADOWS = {
  card: '0 1px 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
  raised: '0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
} as const;

/**
 * Standard radii so everything feels like it's from the same toolkit.
 * Cards 12, inputs/buttons 10, pills 999, tight pills 999 (full-rounded).
 */
export const RADII = {
  card: 12,
  control: 10,   // buttons, inputs
  pill: 999,
} as const;
