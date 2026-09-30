// A small set of design tokens that stand in for a Feathery theme. The real
// theme cascade lives in feathery-backend and arrives already resolved onto
// each element's `styles`; toFeatheryStyles.ts does that resolution here so a
// story can restyle every element from a handful of values.
export interface StoryTheme {
  /** Button fill, checkbox fill, progress bar, focused field border */
  primaryColor: string;
  /** Text drawn on top of primaryColor */
  onPrimaryColor: string;
  textColor: string;
  placeholderColor: string;
  /** Field background */
  surfaceColor: string;
  /** Story canvas background */
  canvasColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  fontFamily: string;
  fontSize: number;
  /** Height of buttons and single-line fields, in px */
  controlHeight: number;
}

export type ThemePresetName = 'default';

export const themePresets: Record<ThemePresetName, StoryTheme> = {
  default: {
    primaryColor: '#4F46E5',
    onPrimaryColor: '#FFFFFF',
    textColor: '#1F2937',
    placeholderColor: '#9CA3AF',
    surfaceColor: '#FFFFFF',
    canvasColor: '#FFFFFF',
    borderColor: '#D1D5DB',
    borderWidth: 1,
    borderRadius: 6,
    fontFamily: 'Helvetica Neue, Arial',
    fontSize: 15,
    controlHeight: 44
  }
};

export const THEME_TOKEN_KEYS = Object.keys(
  themePresets.default
) as (keyof StoryTheme)[];

/**
 * Layers a story's token args over a preset. Args left unset (undefined) fall
 * through to the preset; an unknown or missing name means the default preset.
 */
export function resolveTheme(
  presetName: string | undefined,
  overrides: Partial<StoryTheme> = {}
): StoryTheme {
  const preset =
    themePresets[presetName as ThemePresetName] ?? themePresets.default;
  const resolved = { ...preset };
  THEME_TOKEN_KEYS.forEach((key) => {
    const value = overrides[key];
    if (value !== undefined && value !== '') (resolved as any)[key] = value;
  });
  return resolved;
}
