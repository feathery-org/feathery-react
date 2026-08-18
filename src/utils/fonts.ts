import { featheryDoc, runningInClient } from './browser';

const loadedGoogleFonts = new Set<string>();

const WEIGHT_KEYWORDS: Record<string, number> = { normal: 400, bold: 700 };

const isItalic = (style: string) => /italic|oblique/i.test(style);

/**
 * True if a declared FontFace weight covers the requested weight. Declared
 * weights can be a keyword ('normal', 'bold'), a number ('400'), or a
 * variable-font range ('100 900').
 */
function weightCovers(declared: string, requested: number): boolean {
  const nums = declared
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => WEIGHT_KEYWORDS[w] ?? parseFloat(w))
    .filter((n) => !isNaN(n));
  if (!nums.length) return false;
  return nums.length === 1
    ? nums[0] === requested
    : requested >= nums[0] && requested <= nums[1];
}

/**
 * True if the host page has already declared the font family at the given
 * weight and style, via a CSS @font-face rule or the FontFace API — both
 * surface in document.fonts. Oblique counts as italic. Faces whose download
 * already failed don't count, and environments without document.fonts report
 * false so fonts load unconditionally there.
 */
export function isFontDeclaredByHost(
  family: string,
  weight = '400',
  style = 'normal'
): boolean {
  const fonts = featheryDoc().fonts;
  if (!fonts) return false;
  const targetFamily = family.trim().toLowerCase();
  const targetWeight =
    WEIGHT_KEYWORDS[weight.trim().toLowerCase()] ?? parseFloat(weight);
  if (isNaN(targetWeight)) return false;
  const targetItalic = isItalic(style);
  return Array.from(fonts).some(
    (font: FontFace) =>
      // A face whose download failed stays in document.fonts but will never
      // render — don't let it suppress loading our own copy
      font.status !== 'error' &&
      // CSS-declared families can come back quoted, e.g. "Inter". FontFace
      // descriptors default to 'normal' when unset.
      font.family.replace(/^['"]|['"]$/g, '').toLowerCase() === targetFamily &&
      weightCovers(font.weight ?? 'normal', targetWeight) &&
      isItalic(font.style ?? 'normal') === targetItalic
  );
}

/**
 * Parses a Google FVD variant ('400', '700italic', 'italic', 'regular')
 * into weight + style.
 */
function parseVariant(variant: string): { weight: string; style: string } {
  const v = variant.trim().toLowerCase();
  const digits = v.match(/\d+/);
  return {
    weight: digits ? digits[0] : '400',
    style: v.includes('italic') ? 'italic' : 'normal'
  };
}

/**
 * Loads Google fonts via a stylesheet link rather than webfontloader, which
 * has no way to pass `display` through to the CSS API. Without it Google's
 * response omits font-display, so the browser falls back to the default block
 * period and text renders invisible on a cold cache until the font arrives.
 *
 * Variants the host page already declared in document.fonts are not
 * re-requested. Only variants actually fetched from Google are cached — a
 * variant previously skipped as host-covered is rechecked on the next call,
 * so a declaration removed by an SPA route or theme change gets picked up on
 * the next form load.
 *
 * @param families webfontloader-style specs, e.g. 'Inter:400,400italic,700'
 */
export function loadGoogleFonts(families: string[]) {
  if (!runningInClient()) return;

  const toLoad: { name: string; variants: string[] }[] = [];
  families.forEach((spec) => {
    if (!spec) return;
    const [name, variantList] = spec.split(':');
    // A bare family name loads regular 400 from Google
    const variants = (variantList || '400').split(',').filter((variant) => {
      if (loadedGoogleFonts.has(`${name}:${variant}`)) return false;
      const { weight, style } = parseVariant(variant);
      return !isFontDeclaredByHost(name, weight, style);
    });
    if (!variants.length) return;
    variants.forEach((variant) => loadedGoogleFonts.add(`${name}:${variant}`));
    toLoad.push({ name, variants });
  });
  if (!toLoad.length) return;

  const link = featheryDoc().createElement('link');
  link.rel = 'stylesheet';
  // Google's v1 CSS API: families joined by '|', spaces as '+'
  link.href = `https://fonts.googleapis.com/css?family=${toLoad
    .map(
      ({ name, variants }) => `${name.replace(/ /g, '+')}:${variants.join(',')}`
    )
    .join('%7C')}&display=swap`;
  // On a failed stylesheet request, unmark the variants so a later call (e.g.
  // another form load or signature remount) retries instead of skipping them
  // for the rest of the page session
  link.onerror = () => {
    toLoad.forEach(({ name, variants }) =>
      variants.forEach((variant) =>
        loadedGoogleFonts.delete(`${name}:${variant}`)
      )
    );
    link.remove();
  };
  featheryDoc().head.appendChild(link);
}
