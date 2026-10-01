import { loadGoogleFonts } from '../../src/utils/fonts';

// Reads a theme from a Feathery backend through the public theme API
// (GET /api/theme/ and /api/theme/<id>/), which resolves its element styles
// the way the panel endpoint does before a form renders. Configure with STORYBOOK_*
// variables in .env.local -- see .env.example.

type Styles = Record<string, any>;

export interface BackendElement {
  /** Where the styles came from in the theme, e.g. "field:email" */
  source: string;
  styles: Styles;
  mobileStyles: Styles;
  /** Attributes of the element's first rich-text run, if it has text */
  textAttributes: Styles;
}

export interface BackendTheme {
  themeName: string;
  canvasColor?: string;
  /** The form root's styles, which every element inherits its font from */
  globalStyles: Styles;
  button?: BackendElement;
  heading?: BackendElement;
  body?: BackendElement;
  progressBar?: BackendElement;
  /** Styles for each servar type the theme defines, keyed by type */
  fields: Record<string, BackendElement>;
  /** Styles for each non-field element type (tab, table, image...) */
  elements: Record<string, BackendElement>;
}

export const backendConfig = {
  apiUrl:
    process.env.STORYBOOK_FEATHERY_API_URL || 'http://localhost:8006/api/',
  apiKey: process.env.STORYBOOK_FEATHERY_API_KEY || '',
  /** Theme id or name; blank picks the org's first theme */
  theme: process.env.STORYBOOK_FEATHERY_THEME || ''
};

interface ResolvedElement {
  level_2: string;
  level_1: string;
  styles: Styles;
  mobile_styles: Styles;
}

// Font keys a rich-text run carries (what getRichFontStyles reads)
const RUN_FONT_KEYS = [
  'font_size',
  'font_family',
  'font_color',
  'font_weight',
  'font_italic',
  'font_strike',
  'font_underline',
  'text_transform',
  'letter_spacing'
];

const isSet = (value: any) =>
  value !== undefined && value !== null && value !== '';

/**
 * Buttons and texts paint their label only from its rich-text run, not from
 * the element's font_* styles, so an element placed from a theme starts with
 * a run carrying the theme's font. Mobile values ride as mobile_* attributes.
 * The asset's own run attributes, if any, go on top.
 */
function runAttributes(
  styles: Styles,
  mobileStyles: Styles,
  own: Styles = {}
): Styles {
  const attrs: Styles = {};
  RUN_FONT_KEYS.forEach((key) => {
    if (isSet(styles[key])) attrs[key] = styles[key];
    if (isSet(mobileStyles[key]) && mobileStyles[key] !== styles[key])
      attrs[`mobile_${key}`] = mobileStyles[key];
  });
  return { ...attrs, ...own };
}

const TEXT_RUN_TYPES = ['button', 'text'];

const fontSizeOf = (asset: any) =>
  Number(
    asset.properties?.text_formatted?.[0]?.attributes?.font_size ??
      asset.resolved_styles?.font_size ??
      0
  );

// The theme endpoint resolves styles the way the panel endpoint does for a
// form: `resolved_elements` are flattened global -> element type -> servar
// type (labels filled from the field font), and each asset's
// `resolved_styles` are layered over its element type's. Used as sent, so
// stories see exactly what a hosted form would.
function extractTheme(res: any): BackendTheme {
  const resolved: ResolvedElement[] | undefined = res.resolved_elements;
  if (!resolved) {
    throw new Error(
      'The theme endpoint returned no resolved_elements; update the backend'
    );
  }

  const toElement = (el: ResolvedElement): BackendElement => {
    const styles = el.styles ?? {};
    const mobileStyles = el.mobile_styles ?? {};
    return {
      source: el.level_1 ? `${el.level_2}:${el.level_1}` : el.level_2,
      styles,
      mobileStyles,
      textAttributes: TEXT_RUN_TYPES.includes(el.level_2)
        ? runAttributes(styles, mobileStyles)
        : {}
    };
  };

  const fields: Record<string, BackendElement> = {};
  const elements: Record<string, BackendElement> = {};
  resolved.forEach((el) => {
    if (el.level_2 === 'field') {
      if (el.level_1) fields[el.level_1] = toElement(el);
    } else if (!el.level_1) {
      elements[el.level_2] = toElement(el);
    }
  });

  const fromAsset = (level2: string, asset: any): BackendElement => {
    const styles = asset.resolved_styles ?? {};
    const mobileStyles = asset.resolved_mobile_styles ?? {};
    return {
      source: `${level2} asset "${asset.key}"`,
      styles,
      mobileStyles,
      textAttributes: runAttributes(
        styles,
        mobileStyles,
        asset.properties?.text_formatted?.[0]?.attributes
      )
    };
  };

  // Themes carry no heading level, so the text asset with the largest text
  // stands in for one. Body copy is the theme's base text styling.
  const body = elements.text;
  const heading = [...(res.text_assets ?? [])]
    .filter((asset) => fontSizeOf(asset) > Number(body?.styles.font_size ?? 0))
    .sort((a, b) => fontSizeOf(b) - fontSizeOf(a))[0];

  const background = res.step_background_color;
  return {
    themeName: res.name,
    canvasColor: background ? `#${background}` : undefined,
    globalStyles: res.global_styles ?? {},
    button: elements.button,
    heading: heading && fromAsset('text', heading),
    body,
    progressBar: elements.progress_bar,
    fields,
    elements
  };
}

// The panel endpoint lists a form's fonts for the SDK to load, but a theme
// doesn't, so load every single-family font_family it uses from Google.
// Stacks like the system font default are left to the browser.
function loadThemeFonts(theme: BackendTheme) {
  const weights: Record<string, Set<number>> = {};
  const add = (styles: Styles) => {
    const family = styles.font_family;
    if (!family || family.includes(',')) return;
    const name = family.replace(/^['"]|['"]$/g, '');
    (weights[name] ??= new Set()).add(Number(styles.font_weight) || 400);
  };
  add(theme.globalStyles);
  [
    theme.heading,
    ...Object.values(theme.elements),
    ...Object.values(theme.fields)
  ].forEach((el) => {
    if (!el) return;
    add(el.styles);
    add({ ...el.styles, ...el.textAttributes });
    add({ ...el.styles, ...el.mobileStyles });
  });
  loadGoogleFonts(
    Object.entries(weights).map(
      ([name, set]) => `${name}:${[...set].join(',')}`
    )
  );
}

async function getJson(path: string) {
  const { apiUrl, apiKey } = backendConfig;
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { Authorization: `Token ${apiKey}` }
  });
  const res = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(res)
      ? res[0]?.message
      : res.detail ?? res.message;
    throw new Error(
      `${response.status} from ${apiUrl}${path}${detail ? `: ${detail}` : ''}`
    );
  }
  return res;
}

async function findTheme(wanted: string) {
  const res = await getJson('theme/');
  const themes: any[] = Array.isArray(res) ? res : res.results ?? [];
  if (!themes.length) throw new Error('The API key’s org has no themes');
  if (!wanted) return themes[0];
  const theme = themes.find(({ id, name }) => id === wanted || name === wanted);
  if (!theme) {
    throw new Error(
      `No theme "${wanted}". Available: ${themes
        .map(({ name }) => name)
        .join(', ')}`
    );
  }
  return theme;
}

const cache: Record<string, Promise<BackendTheme>> = {};

export function fetchBackendTheme(
  themeKey = backendConfig.theme
): Promise<BackendTheme> {
  if (!backendConfig.apiKey) {
    return Promise.reject(
      new Error(
        'Set STORYBOOK_FEATHERY_API_KEY in .env.local (see .env.example), then restart Storybook.'
      )
    );
  }

  if (!cache[themeKey]) {
    cache[themeKey] = findTheme(themeKey)
      .then(({ id }) => getJson(`theme/${id}/`))
      .then((res) => {
        const theme = extractTheme(res);
        loadThemeFonts(theme);
        return theme;
      })
      .catch((error) => {
        // Let the next story load retry, e.g. once the backend is up
        delete cache[themeKey];
        throw error;
      });
  }
  return cache[themeKey];
}
