import type { ArgTypes, Loader, StoryContext } from '@storybook/react-webpack5';
import { resolveTheme, StoryTheme, THEME_TOKEN_KEYS } from './tokens';
import { PRESET_BASE_STYLES, textAttributes } from './toFeatheryStyles';
import {
  BackendElement,
  BackendTheme,
  fetchBackendTheme
} from '../backend/backendForm';

/**
 * Args every themed story accepts: one control per theme token, plus a raw
 * escape hatch for any Feathery style key the tokens don't cover.
 */
export type ThemedArgs = Partial<StoryTheme> & {
  /** Merged over the token-derived styles, keyed like element.styles */
  rawStyles?: Record<string, any>;
};

type Styles = Record<string, any>;

/** Toolbar value that styles stories from a real form instead of a preset */
export const BACKEND_THEME = 'backend';

const THEME = 'Theme tokens';

const tokenControl = (key: keyof StoryTheme) => {
  if (key.endsWith('Color')) return { type: 'color' as const };
  if (key === 'fontFamily') return { type: 'text' as const };
  return { type: 'number' as const };
};

/**
 * The form builder renders elements with editMode='editable'; a live form
 * leaves it unset. Shared by every story whose element accepts it.
 */
export type EditModeArgs = { editMode?: 'editable' };

export const editModeArgType = {
  editMode: {
    description:
      "How the element renders: unset for a live form, 'editable' for the form builder canvas",
    control: { type: 'inline-radio' as const },
    options: ['none', 'editable'],
    // The control can't hold undefined, so 'none' stands in for it
    mapping: { none: undefined, editable: 'editable' },
    table: { category: 'Element' }
  }
};

export const themeArgTypes: Partial<ArgTypes<ThemedArgs>> = {
  ...Object.fromEntries(
    THEME_TOKEN_KEYS.map((key) => [
      key,
      {
        control: tokenControl(key),
        description:
          'Unset follows the toolbar theme (a preset, or the backend form)',
        table: { category: THEME }
      }
    ])
  ),
  rawStyles: {
    control: 'object',
    description:
      'Raw Feathery style keys (e.g. `{ "shadow_blur_radius": 12 }`), applied last',
    table: { category: 'Raw Feathery styles' }
  }
};

export const isBackendTheme = (context: StoryContext) =>
  context.globals.theme === BACKEND_THEME;

/**
 * Fetches the backend form once per form key when the toolbar is on
 * "backend". Failures are handed to the canvas decorator to explain rather
 * than thrown, which would blank the story.
 */
export const backendThemeLoader: Loader = async (context) => {
  if (!isBackendTheme(context)) return {};
  try {
    return { backendTheme: await fetchBackendTheme() };
  } catch (error: any) {
    return { backendError: error?.message ?? String(error) };
  }
};

export const loadedBackendTheme = (
  context: StoryContext
): BackendTheme | undefined =>
  isBackendTheme(context) ? context.loaded?.backendTheme : undefined;

/** Only the token args a story's controls actually set */
const explicitTokens = (args: ThemedArgs): Partial<StoryTheme> =>
  Object.fromEntries(
    THEME_TOKEN_KEYS.filter(
      (key) => args[key] !== undefined && args[key] !== ''
    ).map((key) => [key, args[key]])
  );

/** The theme a story renders with: toolbar preset, then token args. */
export const themeFor = (args: ThemedArgs, context: StoryContext) =>
  resolveTheme(
    isBackendTheme(context) ? undefined : context.globals.theme,
    args
  );

/** What the canvas is painted with, which follows the backend form too */
export const canvasFor = (args: ThemedArgs, context: StoryContext) => {
  const backend = loadedBackendTheme(context);
  if (backend) return args.canvasColor ?? backend.canvasColor ?? '#FFFFFF';
  return themeFor(args, context).canvasColor;
};

interface StylingOptions {
  /** Base styles for PRESET_BASE_STYLES and the fallback preset */
  kind?: keyof typeof PRESET_BASE_STYLES;
  /** Which fetched element this story is modelled on */
  fromBackend: (theme: BackendTheme) => BackendElement | undefined;
  /** Maps tokens onto element styles, see toFeatheryStyles.ts */
  tokens: (theme: Partial<StoryTheme>) => Styles;
  /** For elements with rich text: how tokens map onto the text run */
  text?: {
    color?: (theme: Partial<StoryTheme>) => string | undefined;
    scale?: number;
    weight?: number;
  };
}

export interface Styling {
  styles: Styles;
  mobileStyles: Styles;
  textAttributes: Styles;
}

/**
 * Resolves an element's styles in layers:
 *   backend form element  OR  preset (toolbar)
 *   → token args (in backend mode, only the ones set)
 *   → rawStyles
 * A backend form without a matching element falls back to the default preset.
 */
export function styleElement(
  args: ThemedArgs,
  context: StoryContext,
  { kind, fromBackend, tokens, text }: StylingOptions
): Styling {
  const presetBase = kind ? PRESET_BASE_STYLES[kind] : {};
  const backend = loadedBackendTheme(context);
  const source = backend && fromBackend(backend);

  if (source) {
    const overrides = explicitTokens(args);
    return {
      styles: { ...source.styles, ...tokens(overrides), ...args.rawStyles },
      mobileStyles: source.mobileStyles,
      textAttributes: {
        ...source.textAttributes,
        // The run keeps its own weight; size and color follow set tokens
        ...textAttributes(overrides, {
          ...(text?.color && { color: text.color(overrides) }),
          scale: text?.scale
        })
      }
    };
  }

  const theme = themeFor(args, context);
  return {
    styles: { ...presetBase, ...tokens(theme), ...args.rawStyles },
    mobileStyles: {},
    textAttributes: textAttributes(theme, {
      ...(text?.color && { color: text.color(theme) }),
      scale: text?.scale,
      weight: text?.weight
    })
  };
}
