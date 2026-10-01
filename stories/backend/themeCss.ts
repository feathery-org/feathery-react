import type { CSSProperties } from 'react';

// Maps the Feathery style keys a theme endpoint returns (element `styles`,
// `mobile_styles`, and rich-text run attributes) onto plain CSS, so a theme can
// style ordinary HTML. Values follow what the SDK's ResponsiveStyles emits for
// the same keys (src/elements/styles.ts), minus its per-component quirks.
//
// Every key the themes on record carry is accounted for: it lands in one of
// the CSS parts below, in `behavior` if the SDK reads it for something other
// than CSS, or in `unmapped` so a new backend key is visible rather than lost.

type Styles = Record<string, any>;

export interface ElementCss {
  /** The element's own box: size, spacing, fill, borders, shadow, font */
  root: CSSProperties;
  /**
   * The cell around the element: horizontal_align / vertical_align position
   * it, and padding_* spaces it (as margin, the way the SDK's grid does; the
   * SDK also counts that margin inside a px height, which this doesn't)
   */
  container: CSSProperties;
  /** hover_* keys, for :hover */
  hover: CSSProperties;
  /** selected_* keys: :focus on fields, pressed/active on buttons and tabs */
  selected: CSSProperties;
  /** disabled_* keys, for :disabled */
  disabled: CSSProperties;
  /** label_* keys: a field's label, filled from the field font by the theme */
  label: CSSProperties;
  /** placeholder_* keys, for ::placeholder */
  placeholder: CSSProperties;
  placeholderHover: CSSProperties;
  placeholderSelected: CSSProperties;
  /** image_* keys: a button's or option's icon */
  image: CSSProperties;
  /** button_* keys: each option of a button group */
  option: CSSProperties;
  /** uploader_padding_*: a button's or file upload's content box */
  uploader: CSSProperties;
  /** cta_padding_*: a file upload's "add" call to action */
  cta: CSSProperties;
  /** row_separation / gap: the list of options or tabs */
  group: CSSProperties;
  /** bar_color: a progress bar's (or audio recording's) fill */
  bar: CSSProperties;
  /** field_width / field_height on field assets: the input inside the field */
  input: CSSProperties;
  /** Keys that drive SDK behavior rather than CSS */
  behavior: Styles;
  /** Keys this mapping doesn't know */
  unmapped: string[];
}

// Keys the SDK reads to decide behavior or markup, not to paint
const BEHAVIOR_KEYS = [
  'show_spinner_on_submit',
  'mark_required_asterisk',
  'placeholder',
  'placeholder_transition',
  'max_length',
  'num_rows',
  'percent_text_layout',
  'content_responsive',
  'font_link',
  'bar_width'
];

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const CORNERS = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];

const isNum = (v: any) =>
  v !== '' && v !== null && v !== undefined && !isNaN(Number(v));

const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

/** Feathery colors are hex without '#', optionally with alpha; '' is unset */
export const toColor = (value: any): string | undefined => {
  if (!value) return undefined;
  if (value === 'transparent' || value === 'black' || value === 'white')
    return value;
  return `#${String(value).replace(/^#/, '')}`;
};

const px = (value: any) => (isNum(value) ? `${value}px` : undefined);

// A unit of 'fit' sizes to content; '' leaves the size unset
const size = (value: any, unit: any) => {
  if (unit === 'fit') return 'fit-content';
  if (!isNum(value)) return undefined;
  return `${value}${unit || 'px'}`;
};

// The backend has shipped 'flex_start' for 'flex-start' in some themes
const align = (value: any) =>
  typeof value === 'string' ? value.replace(/_/g, '-') : undefined;

// Quotes families with spaces and appends the fallback, as the SDK's
// transformFontFamilies does (it also infers a generic family per font)
export function fontStack(families: string, fallback = '') {
  const stack = families
    .replace(/"/g, "'")
    .split(',')
    .map((family) => family.trim())
    .filter(Boolean)
    .map((family) =>
      family.includes(' ') && !/^'.*'$/.test(family) ? `'${family}'` : family
    );
  if (fallback && !stack.includes(fallback)) stack.push(fallback);
  return stack.join(', ');
}

/** Drops undefined values so spreads don't clobber set ones */
const clean = (css: Styles): CSSProperties =>
  Object.fromEntries(
    Object.entries(css).filter(([, v]) => v !== undefined && v !== '')
  );

/**
 * Converts one element's resolved styles. Pass the merged mobile styles
 * (`{ ...styles, ...mobileStyles }`) for the mobile variant, or use
 * `elementCss` which does both.
 */
export function toCss(styles: Styles = {}): ElementCss {
  const used = new Set<string>();
  const has = (key: string) => key in styles;
  const get = (key: string) => {
    used.add(key);
    return styles[key];
  };
  const any = (...keys: string[]) => keys.some(has);

  // background_color, with gradient_color running into it top to bottom
  const fill = (prefix = ''): Styles => {
    const bg = get(`${prefix}background_color`);
    const gradient = prefix ? undefined : get('gradient_color');
    if (gradient && bg)
      return {
        background: `linear-gradient(${toColor(bg)}, ${toColor(gradient)})`
      };
    return { backgroundColor: toColor(bg) };
  };

  // Per side color + pattern + width. A side with no color and width 0 is
  // explicitly borderless; any other incomplete side is left unset. Older
  // assets carry a single border_color / border_width for every side.
  const borders = (prefix = ''): Styles => {
    const css: Styles = {};
    const allColor = get(`${prefix}border_color`);
    const allWidth = prefix ? undefined : get('border_width');
    SIDES.forEach((side) => {
      const key = (part: string) => `${prefix}border_${side}_${part}`;
      const color = get(key('color')) ?? allColor;
      const pattern = get(key('pattern')) || (allColor ? 'solid' : undefined);
      const width = get(key('width')) ?? allWidth;
      const name = `border${cap(side)}`;
      if (!color && isNum(width) && Number(width) === 0) {
        if (!prefix) css[`${name}Width`] = '0px';
        return;
      }
      if (!color || !pattern || !isNum(width)) return;
      css[`${name}Color`] = toColor(color);
      css[`${name}Style`] = pattern;
      css[`${name}Width`] = `${width}px`;
    });
    return css;
  };

  // font_* keys, or label_font_* with the 'label_' prefix
  const font = (prefix = ''): Styles => {
    const k = (key: string) => `${prefix}${key}`;
    const family = get(k('font_family'));
    const fallback = get(k('font_fallback'));
    const lines = [
      get(k('font_strike')) && 'line-through',
      get(k('font_underline')) && 'underline'
    ].filter(Boolean);
    const italic = get(k('font_italic'));
    return {
      color: toColor(get(k('font_color'))),
      fontFamily: family ? fontStack(family, fallback) : undefined,
      fontSize: px(get(k('font_size'))),
      fontWeight: get(k('font_weight')),
      fontStyle:
        italic === undefined ? undefined : italic ? 'italic' : 'normal',
      lineHeight: px(get(k('line_height'))),
      letterSpacing: px(get(k('letter_spacing'))),
      textTransform: get(k('text_transform')) || undefined,
      textDecoration: lines.length ? lines.join(' ') : undefined
    };
  };

  // prefix + property + side keys, e.g. image_margin_top, as one shorthand
  const box = (
    prefix: string,
    property: 'padding' | 'margin',
    css: 'padding' | 'margin' = property
  ) => {
    const keys = SIDES.map((side) => `${prefix}${property}_${side}`);
    if (!any(...keys)) return {};
    return {
      [css]: keys.map((key) => `${Number(get(key)) || 0}px`).join(' ')
    };
  };

  const corners = (): Styles => {
    const keys = CORNERS.map((corner) => `corner_${corner}_radius`);
    // Older assets carry one border_radius; per-corner radii win over it
    const legacy = get('border_radius');
    if (any(...keys))
      return {
        borderRadius: keys.map((key) => `${Number(get(key)) || 0}px`).join(' ')
      };
    return { borderRadius: px(legacy) };
  };

  // An all-zero shadow is the default "none", so it isn't emitted
  const shadow = (): Styles => {
    const [x, y, blur, color] = [
      'shadow_x_offset',
      'shadow_y_offset',
      'shadow_blur_radius',
      'shadow_color'
    ].map(get);
    if (!Number(x) && !Number(y) && !Number(blur)) return {};
    return {
      boxShadow: `${x || 0}px ${y || 0}px ${blur || 0}px ${
        toColor(color) ?? '#000000'
      }`
    };
  };

  // The SDK brightens or darkens an icon to paint it black or white
  const imageTint = (prefix: string): Styles => {
    const color = get(`${prefix}image_color`);
    if (!color) return {};
    return { filter: `brightness(${color === 'black' ? 0 : 100}%)` };
  };

  const flexDirection = get('flex_direction');
  const columnSizing = get('column_sizing');
  const visibility = get('visibility');
  const legacyButtonColor = get('button_color');
  const gap = get('gap');
  const rootFill = fill();
  const column = String(flexDirection).startsWith('column');

  const css: ElementCss = {
    root: clean({
      width: size(get('width'), get('width_unit')),
      height: size(get('height'), get('height_unit')),
      boxSizing: 'border-box',
      ...rootFill,
      backgroundColor: rootFill.backgroundColor ?? toColor(legacyButtonColor),
      ...borders(),
      ...corners(),
      ...shadow(),
      ...font(),
      textAlign: get('text_align'),
      ...(flexDirection && {
        display: 'flex',
        flexDirection,
        // Content (a label beside its icon) aligns across the flex direction:
        // text_align along a row, vertical_align down it
        [column ? 'alignItems' : 'justifyContent']: styles.text_align,
        [column ? 'justifyContent' : 'alignItems']: align(styles.vertical_align)
      }),
      objectFit: get('object_fit'),
      objectPosition: get('object_position'),
      ...(columnSizing && {
        tableLayout: columnSizing === 'equal' ? 'fixed' : 'auto'
      })
    }),
    container: clean({
      ...(any('horizontal_align', 'vertical_align', 'layout') && {
        display: 'flex'
      }),
      ...box('', 'padding', 'margin'),
      visibility: visibility || undefined,
      justifyContent: align(get('horizontal_align') ?? get('layout')),
      alignItems: align(get('vertical_align') ?? get('vertical_layout'))
    }),
    hover: clean({
      ...fill('hover_'),
      ...borders('hover_'),
      color: toColor(get('hover_font_color'))
    }),
    selected: clean({
      ...fill('selected_'),
      ...borders('selected_'),
      color: toColor(get('selected_font_color'))
    }),
    disabled: clean({
      ...fill('disabled_'),
      ...borders('disabled_'),
      color: toColor(get('disabled_font_color'))
    }),
    label: clean(font('label_')),
    placeholder: clean({
      color: toColor(get('placeholder_color')),
      ...(has('placeholder_italic') && {
        fontStyle: get('placeholder_italic') ? 'italic' : 'normal'
      })
    }),
    placeholderHover: clean({
      color: toColor(get('hover_placeholder_color'))
    }),
    placeholderSelected: clean({
      color: toColor(get('selected_placeholder_color'))
    }),
    image: clean({
      width: size(get('image_width'), get('image_width_unit')),
      ...box('image_', 'margin')
    }),
    option: clean({
      width: size(get('button_width'), get('button_width_unit')),
      height: size(get('button_height'), get('button_height_unit')),
      ...box('button_', 'margin')
    }),
    uploader: clean(box('uploader_', 'padding')),
    cta: clean(box('cta_', 'padding')),
    group: clean({
      rowGap: px(get('row_separation')),
      // A gap of 0 is the default, which leaves the browser's own
      gap: Number(gap) ? px(gap) : undefined
    }),
    bar: clean({ backgroundColor: toColor(get('bar_color')) }),
    input: clean({
      width: size(get('field_width'), get('field_width_unit')),
      height: size(get('field_height'), get('field_height_unit'))
    }),
    behavior: {},
    unmapped: []
  };

  // Tints are per state; hang them on the state's icon
  const hoverTint = imageTint('hover_');
  const selectedTint = imageTint('selected_');
  const disabledTint = imageTint('disabled_');
  if (hoverTint.filter)
    (css.hover as Styles)['--image-filter'] = hoverTint.filter;
  if (selectedTint.filter)
    (css.selected as Styles)['--image-filter'] = selectedTint.filter;
  if (disabledTint.filter)
    (css.disabled as Styles)['--image-filter'] = disabledTint.filter;
  get('image_height_unit'); // images size by width; height follows the ratio

  BEHAVIOR_KEYS.forEach((key) => {
    if (has(key)) css.behavior[key] = get(key);
  });
  css.unmapped = Object.keys(styles).filter((key) => !used.has(key));
  return css;
}

/**
 * Rich-text run attributes (properties.text_formatted[].attributes). Text and
 * button labels take their font from here over `styles`. Older runs use bare
 * names (color, size, family...), which the backend still returns.
 */
export function textRunCss(attrs: Styles = {}, mobile = false): CSSProperties {
  const p = mobile ? 'mobile_' : '';
  const pick = (key: string, legacy?: string) =>
    attrs[`${p}${key}`] ?? (mobile || !legacy ? undefined : attrs[legacy]);
  const lines = [
    pick('font_strike', 'strike') && 'line-through',
    pick('font_underline', 'underline') && 'underline'
  ].filter(Boolean);
  const family = pick('font_family', 'family');
  return clean({
    color: toColor(pick('font_color', 'color')),
    fontSize: px(pick('font_size', 'size')),
    fontFamily: family ? fontStack(family) : undefined,
    fontWeight: pick('font_weight', 'weight'),
    fontStyle: pick('font_italic', 'italic') ? 'italic' : undefined,
    textTransform: pick('text_transform'),
    letterSpacing: px(pick('letter_spacing')),
    textDecoration: lines.length ? lines.join(' ') : undefined
  });
}

/** Only the properties of `mobile` that differ from `desktop` */
function diff(desktop: CSSProperties, mobile: CSSProperties): CSSProperties {
  return Object.fromEntries(
    Object.entries(mobile).filter(
      ([key, value]) => (desktop as Styles)[key] !== value
    )
  );
}

type CssPart = Exclude<keyof ElementCss, 'behavior' | 'unmapped'>;

const CSS_PARTS: CssPart[] = [
  'root',
  'container',
  'hover',
  'selected',
  'disabled',
  'label',
  'placeholder',
  'placeholderHover',
  'placeholderSelected',
  'image',
  'option',
  'uploader',
  'cta',
  'group',
  'bar',
  'input'
];

/**
 * Desktop CSS plus the mobile overrides, which are the desktop styles with
 * mobile_styles layered on, reduced to what actually changes.
 */
export function elementCss(styles: Styles = {}, mobileStyles: Styles = {}) {
  const desktop = toCss(styles);
  const merged = toCss({ ...styles, ...mobileStyles });
  const mobile = Object.fromEntries(
    CSS_PARTS.map((part) => [part, diff(desktop[part], merged[part])]).filter(
      ([, css]) => Object.keys(css).length
    )
  ) as Partial<Record<CssPart, CSSProperties>>;
  return { desktop, mobile };
}

const kebab = (key: string) =>
  key.startsWith('--')
    ? key
    : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `{ fontSize: '14px' }` -> `font-size: 14px;` for a style attribute */
export function cssText(css: CSSProperties) {
  return Object.entries(css)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${kebab(key)}: ${value};`)
    .join(' ');
}

// Where each part lands in a stylesheet, relative to the element's class
const SELECTORS: Record<CssPart, (c: string) => string> = {
  root: (c) => `.${c}`,
  container: (c) => `.${c}-container`,
  hover: (c) => `.${c}:hover:not(:disabled)`,
  selected: (c) =>
    `.${c}:focus, .${c}:checked, .${c}:focus-within, .${c}:active, .${c}[aria-selected="true"], .${c}[aria-pressed="true"]`,
  disabled: (c) => `.${c}:disabled, .${c}[aria-disabled="true"]`,
  label: (c) => `.${c}-label`,
  placeholder: (c) => `.${c}::placeholder, .${c} ::placeholder`,
  placeholderHover: (c) => `.${c}:hover::placeholder`,
  placeholderSelected: (c) => `.${c}:focus::placeholder`,
  image: (c) => `.${c} img, .${c}-image`,
  option: (c) => `.${c}-option`,
  uploader: (c) => `.${c}-uploader`,
  cta: (c) => `.${c}-cta`,
  group: (c) => `.${c}-group`,
  bar: (c) => `.${c}-bar`,
  input: (c) => `.${c}-input`
};

function rules(
  className: string,
  parts: Partial<Record<CssPart, CSSProperties>>
) {
  return CSS_PARTS.filter(
    (part) => parts[part] && Object.keys(parts[part]!).length
  )
    .map((part) => `${SELECTORS[part](className)} { ${cssText(parts[part]!)} }`)
    .join('\n');
}

/**
 * A stylesheet for one element under `className`: `.c` for the element,
 * `.c-label`, `.c-bar` and so on for its parts, pseudo-classes for its states,
 * and a max-width media query for mobile. Icon tints are applied through the
 * `--image-filter` custom property set by the state rules.
 */
export function toStylesheet(
  className: string,
  styles: Styles = {},
  mobileStyles: Styles = {},
  breakpoint = 478
) {
  const { desktop, mobile } = elementCss(styles, mobileStyles);
  const tint = `.${className} img { filter: var(--image-filter, none); }`;
  const mobileRules = rules(className, mobile);
  return [
    rules(className, desktop),
    tint,
    mobileRules && `@media (max-width: ${breakpoint}px) {\n${mobileRules}\n}`
  ]
    .filter(Boolean)
    .join('\n');
}
