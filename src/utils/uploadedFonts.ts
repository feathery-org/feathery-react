/**
 * Render-time identity for uploaded org fonts.
 *
 * Uploaded fonts share persisted font_family values (bare family names) with
 * the catalog, so registering an upload's FontFace under its raw name shadows
 * same-named catalog fonts for every CSS stack that names them. Uploads are
 * instead registered under a prefixed family, and style values are rewritten
 * to match inside transformFontFamilies. Persisted values never change, so
 * older SDK builds keep rendering them.
 *
 * The same convention lives in the dashboard
 * (feathery-frontend src/utils/uploadedFontIdentity.ts) and is enforced at
 * upload time by the backend (apps/integration/serializers.py). Keep the
 * three in sync.
 *
 * Vendor-neutral by design: this name is visible in DevTools computed styles
 * on customer forms, so it says what it is without naming us. The doubled dash
 * keeps it clear of anything an org would plausibly name a real font.
 */
import { featheryDoc } from './browser';

export const UPLOADED_FONT_FAMILY_PREFIX = 'Uploaded--';

// CSS family matching is ASCII case-insensitive, so lookups must be too.
const normalizeFamily = (name: string) => name.trim().toLowerCase();

// lowercase name -> canonical uploaded name, populated per loaded form
const registry = new Map<string, string>();

/**
 * A name that can't be safely quoted into CSS is never aliased: it registers
 * and renders under its raw name, exactly as before this scheme.
 */
export const isAliasableUploadName = (name: string) =>
  // eslint-disable-next-line no-control-regex
  !/["\\\u0000-\u001f]/.test(name);

/** The family an uploaded FontFace is registered under (unquoted). */
export const uploadedFontRenderFamily = (name: string) =>
  `${UPLOADED_FONT_FAMILY_PREFIX}${name}`;

export function registerUploadedFonts(names: string[]) {
  names.forEach((name) => {
    if (isAliasableUploadName(name)) registry.set(normalizeFamily(name), name);
  });
}

export function resetUploadedFonts() {
  registry.clear();
}

const stripQuotes = (segment: string) => {
  const trimmed = segment.trim();
  const first = trimmed[0];
  return (first === '"' || first === "'") &&
    trimmed.length > 1 &&
    trimmed.endsWith(first)
    ? trimmed.slice(1, -1).trim()
    : trimmed;
};

/**
 * Registers an org's uploaded faces under their aliased families and fills the
 * registry transformFontFamilies reads, so style values naming an upload
 * resolve to the face actually registered.
 *
 * `s3Url` is passed in rather than imported: featheryClient owns the
 * region-aware value, and importing it here would close an import cycle.
 */
export function loadUploadedFonts(
  uploadedFonts: Record<string, any[]>,
  s3Url: string
) {
  registerUploadedFonts(Object.keys(uploadedFonts));
  Object.entries(uploadedFonts).forEach(([family, fontStyles]) => {
    const renderFamily = isAliasableUploadName(family)
      ? uploadedFontRenderFamily(family)
      : family;
    fontStyles.forEach(({ source, style, weight }: any) => {
      const loadFont = (url: string) =>
        new FontFace(renderFamily, `url(${url})`, { style, weight })
          .load()
          .then((font) => featheryDoc().fonts.add(font));
      loadFont(source).catch(() => {
        // Cloudfront might run into CORS issues so fall back to
        // S3 directly if needed
        const fallback = new URL(source);
        fallback.hostname = s3Url;
        loadFont(fallback.toString()).catch((e) =>
          console.warn(`Font load issue: ${e}`)
        );
      });
    });
  });
}

/**
 * Rewrites a whole font_family value to its quoted render family, or returns
 * null if it doesn't name an uploaded font. Whole-value match only: picking
 * an upload always persists its bare name, while catalog stacks
 * ("Arial, sans-serif") merely *mention* families — rewriting their segments
 * would hand every stack naming "Arial" to the upload, which is exactly the
 * shadowing this scheme exists to prevent. Emits single quotes to match
 * transformFontFamilies' normalization.
 */
export function rewriteWholeUploadedFamily(value: string): string | null {
  if (!value || registry.size === 0) return null;
  const canonical = registry.get(normalizeFamily(stripQuotes(value)));
  return canonical === undefined
    ? null
    : `'${uploadedFontRenderFamily(canonical)}'`;
}
