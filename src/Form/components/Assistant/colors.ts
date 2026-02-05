export const DEFAULT_CHAT_COLOR = '#6b7280';

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
  disabled: adjustColor(primary, 30), // Lighter disabled state
  light: blendToWhite(primary, 90) // Light: assistant bubbles
});
