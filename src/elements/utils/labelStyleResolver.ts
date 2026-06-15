// Authoritative resolution of a field label's effective typography.
//
// At render time (see elements/fields/index.tsx) unset `label_*` font properties
// emit no CSS (applyFontStyles with skipUnset=true) so the <label> inherits the
// field's font_* from its `'fc'` container via the CSS cascade, and an unset
// `label_text_align` is forced to LABEL_TEXT_ALIGN_DEFAULT. The renderer relies on
// CSS inheritance rather than calling this resolver for fonts, so this function
// must encode the *same* semantic. Any UI that needs the concrete value a label
// will display (e.g. a style panel) should call this instead of re-deriving the
// fallback, keeping the panel and the render path in sync.

export const LABEL_INHERITED_FONT_KEYS = [
  'font_family',
  'font_weight',
  'font_size',
  'font_color',
  'font_italic',
  'line_height',
  'letter_spacing',
  'text_transform'
] as const;

export const LABEL_TEXT_ALIGN_DEFAULT = 'left';

// The label's default gap (marginBottom) is applied inline on the <label> in
// elements/fields/index.tsx — checkbox fields get no gap, everything else 10px.
export const LABEL_GAP_DEFAULT = 10;
export const LABEL_GAP_DEFAULT_CHECKBOX = 0;

export function getLabelGapDefault(fieldType?: string): number {
  return fieldType === 'checkbox'
    ? LABEL_GAP_DEFAULT_CHECKBOX
    : LABEL_GAP_DEFAULT;
}

/**
 * Given a field's resolved style (containing both the field's `font_*` keys and
 * any explicitly-set `label_*` keys), return the concrete `label_*` values a UI
 * should display. Font props fall back to the field's value when the label key is
 * unset; text-align and gap fall back to the renderer's forced defaults.
 *
 * `opts.fieldType` is needed only to resolve the gap default (checkbox has none).
 */
export function resolveLabelStyle(
  style: Record<string, any> = {},
  opts: { fieldType?: string } = {}
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of LABEL_INHERITED_FONT_KEYS) {
    out[`label_${key}`] = style[`label_${key}`] ?? style[key];
  }
  out.label_text_align = style.label_text_align ?? LABEL_TEXT_ALIGN_DEFAULT;
  out.label_gap = style.label_gap ?? getLabelGapDefault(opts.fieldType);
  return out;
}
