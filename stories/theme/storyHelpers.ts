import type { Loader, StoryContext } from '@storybook/react-webpack5';
import { resolveTheme, StoryTheme } from './tokens';
import { PRESET_BASE_STYLES, textAttributes } from './toFeatheryStyles';
import {
  BackendElement,
  BackendTheme,
  fetchBackendTheme
} from '../backend/backendForm';
import { backendThemeKey } from '../backend/themeApi';

type Styles = Record<string, any>;

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

export const isBackendTheme = (context: StoryContext) =>
  backendThemeKey(context.globals.theme) !== undefined;

/**
 * Fetches the toolbar's backend theme, once per theme, when it's on one
 * rather than a preset. Failures are handed to the canvas decorator to explain rather
 * than thrown, which would blank the story.
 */
export const backendThemeLoader: Loader = async (context) => {
  const themeKey = backendThemeKey(context.globals.theme);
  if (themeKey === undefined) return {};
  try {
    return { backendTheme: await fetchBackendTheme(themeKey) };
  } catch (error: any) {
    return { backendError: error?.message ?? String(error) };
  }
};

export const loadedBackendTheme = (
  context: StoryContext
): BackendTheme | undefined =>
  isBackendTheme(context) ? context.loaded?.backendTheme : undefined;

/** The toolbar preset's tokens; unused while the toolbar is on a backend theme */
export const themeFor = (context: StoryContext) =>
  resolveTheme(isBackendTheme(context) ? undefined : context.globals.theme);

/** What the canvas is painted with, which follows the backend theme too */
export const canvasFor = (context: StoryContext) => {
  const backend = loadedBackendTheme(context);
  if (backend) return backend.canvasColor ?? '#FFFFFF';
  return themeFor(context).canvasColor;
};

/**
 * What the form root is styled with, which every element inherits from
 * unless its own targets say otherwise: the backend's global_styles, or the
 * preset's font.
 */
export const globalStylesFor = (context: StoryContext) =>
  loadedBackendTheme(context)?.globalStyles ??
  textAttributes(themeFor(context));

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
 * An element's styles: the backend theme's resolved element, used as sent, or
 * the toolbar preset's tokens. A backend theme without a matching element
 * falls back to the default preset.
 */
export function styleElement(
  context: StoryContext,
  { kind, fromBackend, tokens, text }: StylingOptions
): Styling {
  const backend = loadedBackendTheme(context);
  const source = backend && fromBackend(backend);
  // Copies, since stories set behavioural keys like mark_required_asterisk
  // and the fetched theme is cached across stories
  if (source) {
    return {
      styles: { ...source.styles },
      mobileStyles: { ...source.mobileStyles },
      textAttributes: { ...source.textAttributes }
    };
  }

  const theme = themeFor(context);
  return {
    styles: { ...(kind ? PRESET_BASE_STYLES[kind] : {}), ...tokens(theme) },
    mobileStyles: {},
    textAttributes: textAttributes(theme, {
      ...(text?.color && { color: text.color(theme) }),
      scale: text?.scale,
      weight: text?.weight
    })
  };
}
