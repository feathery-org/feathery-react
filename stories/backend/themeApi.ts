// The public theme API (GET /api/theme/ and /api/theme/<id>/), configured
// with STORYBOOK_* variables in .env.local -- see .env.example. Kept free of
// src/ imports so the manager's toolbar can list themes with it too.

export const backendConfig = {
  apiUrl:
    process.env.STORYBOOK_FEATHERY_API_URL || 'http://localhost:8006/api/',
  apiKey: process.env.STORYBOOK_FEATHERY_API_KEY || '',
  /** Theme id or name; blank picks the org's first theme */
  theme: process.env.STORYBOOK_FEATHERY_THEME || ''
};

/** Toolbar value for the theme .env.local names (or the org's first) */
export const BACKEND_THEME = 'backend';
/**
 * Toolbar values for a specific theme are this prefix plus its id. Not a
 * colon: Storybook drops globals from the URL unless they match
 * /^[a-zA-Z0-9 _-]*$/.
 */
export const BACKEND_THEME_PREFIX = 'backend_';

export const toolbarValueFor = (themeId: string) =>
  `${BACKEND_THEME_PREFIX}${themeId}`;

/**
 * The theme id or name a toolbar value asks for, '' for the .env.local
 * theme, or undefined when it's a preset.
 */
export function backendThemeKey(value: string | undefined) {
  if (value === BACKEND_THEME) return backendConfig.theme;
  if (value?.startsWith(BACKEND_THEME_PREFIX))
    return value.slice(BACKEND_THEME_PREFIX.length);
  return undefined;
}

export const MISSING_API_KEY =
  'Set STORYBOOK_FEATHERY_API_KEY in .env.local (see .env.example), then restart Storybook.';

export async function getJson(path: string) {
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

export interface ThemeSummary {
  id: string;
  name: string;
}

/** Every theme in the API key's org, in the order the API sends them */
export async function listThemes(): Promise<ThemeSummary[]> {
  if (!backendConfig.apiKey) throw new Error(MISSING_API_KEY);
  const res = await getJson('theme/');
  const themes: any[] = Array.isArray(res) ? res : res.results ?? [];
  return themes.map(({ id, name }) => ({ id: String(id), name }));
}
