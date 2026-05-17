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
