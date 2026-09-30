import { loadGoogleFonts, setFontFallbacks } from '../../src/utils/fonts';

// Reads a real form from a Feathery backend (the same panel endpoint the SDK
// renders from) and pulls fully resolved element styles out of it. Configure
// with STORYBOOK_* variables in .env.local -- see .env.example.

type Styles = Record<string, any>;

export interface BackendElement {
  /** Element id in the source form, for tracing where styles came from */
  id: string;
  stepKey: string;
  styles: Styles;
  mobileStyles: Styles;
  /** Attributes of the element's first rich-text run, if it has text */
  textAttributes: Styles;
}

export interface BackendTheme {
  formName: string;
  canvasColor?: string;
  mobileBreakpoint?: number;
  button?: BackendElement;
  heading?: BackendElement;
  body?: BackendElement;
  progressBar?: BackendElement;
  /** First field of each servar type, keyed by type */
  fields: Record<string, BackendElement>;
}

export const backendConfig = {
  apiUrl:
    process.env.STORYBOOK_FEATHERY_API_URL || 'http://localhost:8006/api/',
  sdkKey: process.env.STORYBOOK_FEATHERY_SDK_KEY || '',
  formKey: process.env.STORYBOOK_FEATHERY_FORM_KEY || ''
};

const toElement = (element: any, stepKey: string): BackendElement => ({
  id: element.id,
  stepKey,
  styles: element.styles ?? {},
  mobileStyles: element.mobile_styles ?? {},
  textAttributes: element.properties?.text_formatted?.[0]?.attributes ?? {}
});

const fontSizeOf = (element: any) =>
  Number(
    element.properties?.text_formatted?.[0]?.attributes?.font_size ??
      element.styles?.font_size ??
      0
  );

function extractTheme(res: any): BackendTheme {
  const steps: any[] = res.data ?? [];
  const all = (kind: string) =>
    steps.flatMap((step) =>
      (step[kind] ?? []).map((element: any) => ({ element, step }))
    );

  // A text-only primary action is the most representative button: icon
  // buttons (back arrows and the like) carry styles specific to their image.
  const buttons = all('buttons');
  const button =
    buttons.find(
      ({ element }) => element.properties.submit && !element.properties.image
    ) ??
    buttons.find(({ element }) => !element.properties.image) ??
    buttons[0];

  // The largest text on the form stands in for a heading, and the most common
  // smaller size for body copy. Question-per-step forms often have as many
  // headings as body lines, so the most common size alone can be the heading.
  const texts = all('texts').filter(({ element }) =>
    element.properties?.text?.trim()
  );
  const heading = [...texts].sort(
    (a, b) => fontSizeOf(b.element) - fontSizeOf(a.element)
  )[0];
  const headingSize = heading ? fontSizeOf(heading.element) : 0;
  const mostCommonSize = (candidates: typeof texts) => {
    const counts: Record<number, number> = {};
    candidates.forEach(({ element }) => {
      const size = fontSizeOf(element);
      counts[size] = (counts[size] ?? 0) + 1;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? Number(top[0]) : undefined;
  };
  const smaller = texts.filter(
    ({ element }) => fontSizeOf(element) < headingSize
  );
  const bodySize = mostCommonSize(smaller.length ? smaller : texts);
  const body = texts.find(({ element }) => fontSizeOf(element) === bodySize);

  const fields: Record<string, BackendElement> = {};
  all('servar_fields').forEach(({ element, step }) => {
    const type = element.servar?.type;
    if (type && !fields[type]) fields[type] = toElement(element, step.key);
  });

  const progressBar = all('progress_bars')[0];

  // The first step's root container carries the page background
  const root = steps[0]?.subgrids?.find((grid: any) => !grid.position?.length);
  const background = root?.styles?.background_color;

  return {
    formName: res.form_name ?? backendConfig.formKey,
    canvasColor: background ? `#${background}` : undefined,
    mobileBreakpoint: res.mobile_breakpoint,
    button: button && toElement(button.element, button.step.key),
    heading: heading && toElement(heading.element, heading.step.key),
    body: body && toElement(body.element, body.step.key),
    progressBar:
      progressBar && toElement(progressBar.element, progressBar.step.key),
    fields
  };
}

// Mirrors the SDK's _loadFormPackages so text renders in the form's fonts
function loadFormFonts(res: any) {
  loadGoogleFonts(res.fonts ?? []);
  setFontFallbacks(res.font_fallbacks ?? {});
  Object.entries(res.uploaded_fonts ?? {}).forEach(([family, variants]) => {
    (variants as any[]).forEach(({ source, style, weight }) =>
      new FontFace(family, `url(${source})`, { style, weight: `${weight}` })
        .load()
        .then((font) => document.fonts.add(font))
        .catch((e) => console.warn(`Font load issue: ${e}`))
    );
  });
}

const cache: Record<string, Promise<BackendTheme>> = {};

export function fetchBackendTheme(
  formKey = backendConfig.formKey
): Promise<BackendTheme> {
  const { apiUrl, sdkKey } = backendConfig;
  if (!sdkKey || !formKey) {
    return Promise.reject(
      new Error(
        'Set STORYBOOK_FEATHERY_SDK_KEY and STORYBOOK_FEATHERY_FORM_KEY in .env.local (see .env.example), then restart Storybook.'
      )
    );
  }

  if (!cache[formKey]) {
    const params = new URLSearchParams({ form_key: formKey });
    cache[formKey] = fetch(`${apiUrl}panel/v20/?${params}`, {
      headers: { Authorization: `Token ${sdkKey}` }
    })
      .then(async (response) => {
        const res = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = Array.isArray(res)
            ? res[0]?.message
            : res.detail ?? res.message;
          throw new Error(
            `${response.status} from ${apiUrl}panel/v20/ for form "${formKey}"${
              detail ? `: ${detail}` : ''
            }`
          );
        }
        if (!res.data) throw new Error(`Form "${formKey}" is disabled`);
        loadFormFonts(res);
        return extractTheme(res);
      })
      .catch((error) => {
        // Let the next story load retry, e.g. once the backend is up
        delete cache[formKey];
        throw error;
      });
  }
  return cache[formKey];
}
