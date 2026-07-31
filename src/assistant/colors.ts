export const DEFAULT_CHAT_COLOR = '#6b7280';

export const GRAY_50 = '#f9fafb';
export const GRAY_100 = '#f3f4f6';
export const GRAY_200 = '#e5e7eb';
export const GRAY_400 = '#9ca3af';
export const GRAY_500 = '#6b7280';
export const GRAY_800 = '#1f2937';
export const RED_500 = '#ef4444';

// Generate lighter/darker variants from hex color
export const adjustColor = (hex: string, percent: number): string => {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(
    255,
    Math.max(0, (num >> 16) + Math.round(2.55 * percent))
  );
  const g = Math.min(
    255,
    Math.max(0, ((num >> 8) & 0x00ff) + Math.round(2.55 * percent))
  );
  const b = Math.min(
    255,
    Math.max(0, (num & 0x0000ff) + Math.round(2.55 * percent))
  );
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};

export const blendToWhite = (hex: string, percent: number): string => {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const blend = percent / 100;
  const newR = Math.round(r + (255 - r) * blend);
  const newG = Math.round(g + (255 - g) * blend);
  const newB = Math.round(b + (255 - b) * blend);
  return `#${((newR << 16) | (newG << 8) | newB)
    .toString(16)
    .padStart(6, '0')}`;
};

const parseHex = (hex: string): [number, number, number] => {
  const num = parseInt(hex.replace('#', ''), 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
};

const toHex = (r: number, g: number, b: number): string =>
  `#${((Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b))
    .toString(16)
    .padStart(6, '0')}`;

// Mix two colors, percent = how much of `other` to apply
const mixColors = (hex: string, other: string, percent: number): string => {
  const [r1, g1, b1] = parseHex(hex);
  const [r2, g2, b2] = parseHex(other);
  const blend = percent / 100;
  return toHex(
    r1 + (r2 - r1) * blend,
    g1 + (g2 - g1) * blend,
    b1 + (b2 - b1) * blend
  );
};

// Perceived (relative) luminance per WCAG
const luminance = (hex: string): number => {
  const channels = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

// Buttons using the disabled color hold white content, so cap how bright it
// can get — otherwise already-light primaries wash out completely.
const MAX_DISABLED_LUMINANCE = 0.5;

const getDisabledColor = (primary: string): string => {
  // Gray it out, then lighten a bit so it reads as inactive
  const disabled = blendToWhite(mixColors(primary, GRAY_400, 40), 25);
  if (luminance(disabled) <= MAX_DISABLED_LUMINANCE) return disabled;

  // Too bright for white content: darken until it clears the ceiling
  let low = 0;
  let high = 100;
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    if (luminance(mixColors(disabled, '#000000', mid)) > MAX_DISABLED_LUMINANCE)
      low = mid;
    else high = mid;
  }
  return mixColors(disabled, '#000000', high);
};

export interface ChatColors {
  primary: string;
  hover: string;
  disabled: string;
  light: string;
}

// Compute all color variants from primary
export const getChatColors = (primary: string): ChatColors => ({
  primary, // Main color: buttons, header
  hover: adjustColor(primary, -15), // Darker hover state
  disabled: getDisabledColor(primary), // Muted, contrast-safe disabled state
  light: blendToWhite(primary, 90) // Light: assistant bubbles
});
