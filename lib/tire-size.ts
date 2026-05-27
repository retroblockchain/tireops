export type NormalizedTireSize = {
  width: number;
  aspectRatio: number;
  diameter: number;
};

const FLOTATION_RE = /^\d{2,3}x/i;
const TIRE_RE =
  /^(?:P|LT|ST)?(\d{3})\s*[/\-\s]?\s*(\d{2})\s*[/\-\s]?\s*(?:Z?R)?\s*(\d{2})/i;

export function normalizeTireSize(input: string): NormalizedTireSize | null {
  const s = input.trim().toUpperCase();
  if (!s) return null;

  if (FLOTATION_RE.test(s)) {
    console.warn(`normalizeTireSize: flotation size not supported: "${input}"`);
    return null;
  }

  const m = s.match(TIRE_RE);
  if (!m) return null;

  const width = parseInt(m[1], 10);
  const aspectRatio = parseInt(m[2], 10);
  const diameter = parseInt(m[3], 10);

  if (width < 100 || width > 400) return null;
  if (aspectRatio < 25 || aspectRatio > 90) return null;
  if (diameter < 10 || diameter > 28) return null;

  return { width, aspectRatio, diameter };
}

export function formatTireSize(size: NormalizedTireSize): string {
  return `${size.width}/${size.aspectRatio}R${size.diameter}`;
}

export type TireSizeFields = {
  size_raw: string | null;
  width: number | null;
  aspect_ratio: number | null;
  diameter: number | null;
  warning: string | null;
};

export function prepareTireSizeFields(rawInput: string | null | undefined): TireSizeFields {
  const raw = (rawInput ?? '').trim() || null;
  if (!raw) {
    return { size_raw: null, width: null, aspect_ratio: null, diameter: null, warning: null };
  }
  const parsed = normalizeTireSize(raw);
  if (parsed) {
    return {
      size_raw: raw,
      width: parsed.width,
      aspect_ratio: parsed.aspectRatio,
      diameter: parsed.diameter,
      warning: null,
    };
  }
  return {
    size_raw: raw,
    width: null,
    aspect_ratio: null,
    diameter: null,
    warning: "Couldn't parse tire size — saved as-is, you may want to edit",
  };
}
