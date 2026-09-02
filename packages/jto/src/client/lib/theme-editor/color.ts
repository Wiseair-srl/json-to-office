/**
 * Hex ↔ HSV, for the picker only.
 *
 * The theme stores 6-digit hex and nothing else, so HSV exists purely as the
 * shape a saturation square and a hue rail can be dragged in. Round trips are
 * lossy at the edges (every grey is hue 0 after a trip through hex), which is
 * why the picker keeps its own HSV while it is open rather than re-deriving
 * it from the value on every drag.
 */

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb | null {
  const match = hex.match(/^#?([0-9A-Fa-f]{6})$/);
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const span = max - min;
  let h = 0;
  if (span !== 0) {
    if (max === red) h = ((green - blue) / span) % 6;
    else if (max === green) h = (blue - red) / span + 2;
    else h = (red - green) / span + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : span / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}

/** Black or white, whichever reads on `hex`. For text drawn over a swatch. */
export function readableInk(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#000000';
  // Perceived brightness (ITU-R BT.601), the cheap version that is right
  // often enough for a 20px chip.
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness > 140 ? '#000000' : '#FFFFFF';
}
