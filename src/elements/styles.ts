import { DEFAULT_MIN_SIZE } from '../Form/grid/StyledContainer/styles';
import { featheryWindow } from '../utils/browser';
import {
  isNum,
  objectFromEntries,
  startsEndsWithQuotes
} from '../utils/primitives';
import { getFontFallback, isGenericFamily } from '../utils/fonts';
import { isDirectionColumn } from '../utils/styles';
import { CSSProperties } from 'react';

export const DEFAULT_MOBILE_BREAKPOINT = 478;

export const getViewport = (breakpoint = DEFAULT_MOBILE_BREAKPOINT) => {
  return featheryWindow().innerWidth > breakpoint ? 'desktop' : 'mobile';
};

// A text area's placeholder has always sat slightly below its padding edge
// (top 0.6rem against 0.5rem of padding). Keep that gap when the placeholder
// starts following the padding, so existing text areas don't shift.
const TEXT_AREA_PLACEHOLDER_TOP_OFFSET = 1.6;

// resetStyles' input padding (0.375rem / 0.75rem at a 16px root) -- the
// effective value of a side the theme doesn't set.
const RESET_INPUT_PADDING_Y = 6;
const RESET_INPUT_PADDING_X = 12;

// A text area's own padding shorthand, applied after resetStyles.
const RESET_TEXT_AREA_PADDING_Y = 8;

// react-select's block padding on the container holding a multiselect's chips
// once they wrap. Its non-wrapped value is smaller, but a multiselect centers
// its chips, so a symmetric block padding does not move them either way.
const RESET_MULTISELECT_PADDING_Y = 8;

// A dropdown draws its chevron inside the inline end of the input, so that
// strip stays reserved however little inner padding the theme asks for.
export const DROPDOWN_CHEVRON_RESERVE = 30;
export const DROPDOWN_FIELDS = ['dropdown', 'gmap_state', 'gmap_country'];

// dropdown_multi lays its chips out with react-select rather than in an input,
// so its padding lands on the value container and its chevron strip is its own
// width. It takes the same keys as an input box everywhere else.
export const MULTISELECT_FIELD = 'dropdown_multi';
export const MULTISELECT_CHEVRON_RESERVE = 28;

// The gap the chevron kept from the border before inner padding existed, and
// what it falls back to when a theme sets none.
export const DEFAULT_CHEVRON_GAP = 10;

// The production seats of the icons on an input's inline end -- the zero the
// theme's right padding moves them from. The eye toggle steps aside when a
// tooltip trigger shares the edge. Shared with the components, whose own
// anchors stay live for the types the theme does not place.
export const EYE_ICON_INSET = (hasTooltip: boolean) => (hasTooltip ? 30 : 8);
export const TOOLTIP_TRIGGER_INSET = 10;

// The strip between a multiselect's chips and its chevron: the glyph plus the
// breathing room the chips always kept from it. The right padding places the
// chevron, and the chips stop this much further in, so a full row can never
// slide under the glyph. The defaults compose the same way -- 10 + 18 is the
// 28px inset an untouched multiselect always had.
export const MULTISELECT_CHEVRON_CLEARANCE =
  MULTISELECT_CHEVRON_RESERVE - DEFAULT_CHEVRON_GAP;

// The same strip for a single dropdown: its value stops at the reserved inline
// end, and the glyph sits this much further out. 30 - 20 is the 10px gap an
// untouched dropdown always kept from its border.
export const DROPDOWN_CHEVRON_CLEARANCE =
  DROPDOWN_CHEVRON_RESERVE - DEFAULT_CHEVRON_GAP;

const chevronClearance = (type: string) => {
  if (DROPDOWN_FIELDS.includes(type)) return DROPDOWN_CHEVRON_CLEARANCE;
  if (type === MULTISELECT_FIELD) return MULTISELECT_CHEVRON_CLEARANCE;
  return 0;
};

const takesInnerPadding = (type: string) =>
  INPUT_BOX_FIELDS.includes(type) || type === MULTISELECT_FIELD;

// Marks the element whose border box an input-box field's inner padding insets
// from -- the box that carries the border, corners and background, which the
// field's input then fills. A stable hook for tooling that has to find that box
// in the rendered DOM: the builder's padding band anchors its hatching here
// rather than inferring the box by walking a field's private nesting, which
// differs per type and includes react-select's internals for a multiselect.
export const INPUT_BOX_ATTR = 'data-feathery-input-box';

export const inputBoxAttrs = (type: string) =>
  takesInnerPadding(type) ? { [INPUT_BOX_ATTR]: '' } : {};

// The six keys an input box's inner spacing lives in. They exist in their own
// namespace with no default at any level of the theme cascade -- not global,
// not level_2 `field`, not level_1 -- which is what makes an absent key mean
// "nobody ever set this" rather than "inherited from somewhere". feathery-
// backend pins that invariant in apps/theme/tests/
// test_inner_spacing_has_no_default.py; the legacy geometry below is only
// reachable while it holds.
//
// uploader_padding_* is a different feature on a different sub-element (the
// file_upload dropzone, button_group buttons) and horizontal_align /
// vertical_align are pinned to center/center by level_2 `field` for every
// field, so neither could ever express "unset" here.
export const INNER_PADDING_TOP = 'inner_padding_top';
export const INNER_PADDING_RIGHT = 'inner_padding_right';
export const INNER_PADDING_BOTTOM = 'inner_padding_bottom';
export const INNER_PADDING_LEFT = 'inner_padding_left';
export const CONTENT_HORIZONTAL_ALIGN = 'content_horizontal_align';
export const CONTENT_VERTICAL_ALIGN = 'content_vertical_align';

export const INNER_PADDING_KEYS = [
  INNER_PADDING_TOP,
  INNER_PADDING_RIGHT,
  INNER_PADDING_BOTTOM,
  INNER_PADDING_LEFT
];

// RESET SEMANTICS -- read before adding a conditional style below.
//
// apply() can only merge: the mobile pass runs when any of its keys carries an
// override and merges whatever the callback returns onto the breakpoint block.
// Returning {} therefore cannot *undo* a desktop declaration, so a callback
// that emits a property for some values of a key has to emit that property's
// neutral value for the rest, or a mobile override can never take a field back
// to the default. Every neutral below is the value the field renders with when
// the property is not declared at all, so emitting it changes no pixels.
//
// The one case that emits nothing is every key a callback reads being absent:
// there is then no declaration to undo. The desktop pass has emitted nothing,
// and the mobile pass cannot even run -- apply() returns early unless some key
// carries an override, and an override the builder deleted resolves back to the
// desktop value rather than to undefined. So `isSet` gates the callbacks below
// on exactly the values handed to that invocation.
const isSet = (...values: any[]) => values.some((v) => v !== undefined);

// horizontal_align carries flex values; text needs the logical text-align
// equivalents so alignment follows the writing direction. 'start' is the
// neutral: input, select and textarea all compute text-align: start from the UA
// stylesheet, so declaring it is a no-op -- including on PhoneField's dir='ltr'
// input inside an RTL form, which computes start (not right) today. Note
// text-align: inherit is NOT neutral there: the UA declaration blocks
// inheritance, so inherit would pull the RTL wrapper's `right` in.
const ALIGN_TO_TEXT_ALIGN: Record<string, string> = {
  center: 'center',
  'flex-end': 'end'
};

const TEXT_ALIGN_NEUTRAL = 'start';

const textAlignFor = (align: any) =>
  ALIGN_TO_TEXT_ALIGN[align] ?? TEXT_ALIGN_NEUTRAL;

// Only these two need the content box spanned to place their text; start-
// aligned text is placed by anchoring the inline start alone.
const spansContentBox = (align: any) => !!ALIGN_TO_TEXT_ALIGN[align];

// resetStyles' padding, as authored -- rem, so a form on a page with a non-16px
// root keeps the scale it renders with today whenever a side goes unset. This is
// why the legacy geometry stays in the renderer instead of being written into
// every theme as px: 6 and 12 are only what 0.375rem and 0.75rem happen to
// resolve to at the default root.
const resetBlockPaddingCss = (type: string) =>
  type === 'text_area' ? '0.5rem' : '0.375rem';

export const RESET_INLINE_PADDING_CSS = '0.75rem';

const blockPaddingCss = (type: string, value: any) =>
  isNum(value) ? `${Number(value)}px` : resetBlockPaddingCss(type);

// A shrunken floating label never renders larger than this, whatever the
// field's font size.
const SHRINK_LABEL_MAX_FONT_SIZE = 10;

// The room a pinned floating label needs behind the value when the theme sets
// no top padding of its own -- computed per render, in the height's own unit, so
// a box whose height changes keeps a reserve that matches it.
const shrinkLabelReserve = (
  type: string,
  height: any,
  heightUnit: any,
  fontSize: any
) =>
  type === 'text_area'
    ? `${Math.min(fontSize, SHRINK_LABEL_MAX_FONT_SIZE) * 2.5}px`
    : `${height / 3}${heightUnit}`;

// The neutral for a companion that rides the value line with a transform.
// 'none' rather than a zero translation: any transform other than none creates
// a stacking context and a containing block for positioned descendants, so
// translateY(0px) would change how these elements contain and stack even though
// it moves nothing.
const NO_TRANSLATE = 'none';

// An unset line height renders as CSS 'normal', which has no fixed pixel
// value; 1.2 x font-size is the canonical approximation, and both stored
// values are px. A browser's real 'normal' differs by a pixel at most, which
// only nudges the synthesized offsets, never a box's size.
const inputLineHeight = (lineHeight: any, fontSize: any) =>
  isNum(lineHeight)
    ? Number(lineHeight)
    : isNum(fontSize)
    ? Number(fontSize) * 1.2
    : 0;

const paddingSide = (value: any, fallback: number) =>
  isNum(value) ? Number(value) : fallback;

// The block padding a field rendered with before it became themeable -- the
// effective value of a side left unset, for the arithmetic that needs a number
// rather than a CSS length.
const legacyPaddingY = (type: string) => {
  if (type === 'text_area') return RESET_TEXT_AREA_PADDING_Y;
  if (type === MULTISELECT_FIELD) return RESET_MULTISELECT_PADDING_Y;
  return RESET_INPUT_PADDING_Y;
};

// What a multiselect's value container already insets its chips by: react-
// select's own 8px inline start, the 10px that composes to the chips' 28px
// chevron strip, and the block padding it uses once the chips wrap.
const MULTISELECT_LEGACY_PADDING = {
  top: RESET_MULTISELECT_PADDING_Y,
  right: DEFAULT_CHEVRON_GAP,
  bottom: RESET_MULTISELECT_PADDING_Y,
  left: 8
};

// A shrink_top label is a fixed overlay pinned to the box top: it takes no room
// in the content box, so the value renders behind the theme's raw padding and
// nothing about the label enters the geometry below. An unset inner_padding_top
// falls back to the reserve production drew, computed below, and a padding low
// enough to run the value under the label's ink is allowed by design.
const offsetFromCenter = (d: number) =>
  d ? `calc(50% ${d > 0 ? '+' : '-'} ${Math.abs(d)}px)` : '50%';

// How much taller the box has to get to hold a raised inner padding. Zero
// while the theme sets no block padding, and zero for a padding at or below
// what the field already rendered with: reducing it never needs more room.
const raisedPaddingY = (type: string, padTop: any, padBottom: any) => {
  const legacy = legacyPaddingY(type);
  return (
    Math.max(0, paddingSide(padTop, legacy) - legacy) +
    Math.max(0, paddingSide(padBottom, legacy) - legacy)
  );
};

type VerticalPlacement = {
  align: string;
  top: number;
  bottom: number;
  line: number;
  height: number;
};

// A single-line input centers its text in its content box and ignores any
// alignment on its parent, so top/bottom alignment has to be synthesized by
// padding one side out. Returns null whenever the field should keep the
// centered default. A shrink_top label is a fixed overlay the value ignores, so
// the value aligns behind the raw padding whether one floats or not.
const inputBoxVertical = (
  type: string,
  align: any,
  height: any,
  heightUnit: any,
  padTop: any,
  padBottom: any,
  lineHeight: any,
  fontSize: any
): VerticalPlacement | null => {
  // A text area's text already starts at its top padding.
  if (type === 'text_area') return null;
  if (align !== 'flex-start' && align !== 'flex-end') return null;
  // Synthesizing the offset needs a resolved pixel height. Percentage padding
  // resolves against width, so there is no CSS-only equivalent.
  if (heightUnit !== 'px' || !isNum(height)) return null;
  const line = inputLineHeight(lineHeight, fontSize);
  if (!line) return null;

  const legacy = legacyPaddingY(type);
  const top = paddingSide(padTop, legacy);
  const bottom = paddingSide(padBottom, legacy);
  return {
    align,
    top,
    bottom,
    line,
    // The box grows to fit a raised padding, so align against that same floor
    // or the text lands outside the box it was aligned to. Computed off the
    // same raise applyInputBoxMinHeight clamps on, so the two agree.
    height: raisedPaddingY(type, padTop, padBottom)
      ? Math.max(Number(height), top + bottom + line)
      : Number(height)
  };
};

// Whether a different content_vertical_align, on its own, could have placed
// this box's value -- inputBoxVertical's preconditions with the alignment left
// out. Where it holds, the centred branch emits the block padding as its reset
// so a mobile override can undo a synthesized offset; where it does not, an
// alignment the box cannot resolve says nothing at all.
const canSynthesizeVertical = (
  type: string,
  height: any,
  heightUnit: any,
  lineHeight: any,
  fontSize: any
) => {
  if (type === 'text_area') return false;
  if (heightUnit !== 'px' || !isNum(height)) return false;
  return !!inputLineHeight(lineHeight, fontSize);
};

// Where the value sits vertically, as a length against the box. The chevron
// rides this so it stays with the content instead of floating at the box's
// midline. Null means the box's own centre, which is the CSS default.
const valueLineY = (
  type: string,
  align: any,
  height: any,
  heightUnit: any,
  padTop: any,
  padBottom: any,
  lineHeight: any,
  fontSize: any
): string | null => {
  const line = inputLineHeight(lineHeight, fontSize);
  if (!line) return null;
  const legacy = legacyPaddingY(type);
  const top = paddingSide(padTop, legacy);
  const bottom = paddingSide(padBottom, legacy);

  if (type === MULTISELECT_FIELD) {
    // Its chips are placed by flexbox, so the line follows the alignment
    // directly at any height.
    if (align === 'flex-start') return `${top + line / 2}px`;
    if (align === 'flex-end') return `calc(100% - ${bottom + line / 2}px)`;
    // Centred means the middle of the padded area, not of the box -- the two
    // are the same distance apart as the paddings are uneven.
  }

  const placement = inputBoxVertical(
    type,
    align,
    height,
    heightUnit,
    padTop,
    padBottom,
    lineHeight,
    fontSize
  );
  if (placement)
    return placement.align === 'flex-start'
      ? `${placement.top + placement.line / 2}px`
      : `${placement.height - placement.bottom - placement.line / 2}px`;

  // Centred between the paddings, the same shift the placeholder takes.
  const delta = (top - bottom) / 2;
  return delta
    ? `calc(50% ${delta > 0 ? '+' : '-'} ${Math.abs(delta)}px)`
    : null;
};

// The value's midline as a pixel offset from the box centre -- the numeric
// twin of valueLineY, for companions that ride the line with a transform.
const inputValueDelta = (
  type: string,
  align: any,
  height: any,
  heightUnit: any,
  padTop: any,
  padBottom: any,
  lineHeight: any,
  fontSize: any
): number | null => {
  const line = inputLineHeight(lineHeight, fontSize);
  if (!line) return null;
  const placement = inputBoxVertical(
    type,
    align,
    height,
    heightUnit,
    padTop,
    padBottom,
    lineHeight,
    fontSize
  );
  if (placement)
    return placement.align === 'flex-start'
      ? placement.top + placement.line / 2 - placement.height / 2
      : placement.height / 2 - placement.bottom - placement.line / 2;
  const delta =
    (paddingSide(padTop, legacyPaddingY(type)) -
      paddingSide(padBottom, legacyPaddingY(type))) /
    2;
  return delta || null;
};

const VERTICAL_PLACEMENT_KEYS = [
  CONTENT_VERTICAL_ALIGN,
  'height',
  'height_unit',
  INNER_PADDING_TOP,
  INNER_PADDING_BOTTOM,
  'line_height',
  'font_size'
];

// The subset of the above the theme has to have set for anything to be placed.
// height, line_height and font_size are resolution inputs every field carries,
// so they cannot stand in for intent.
const verticalPlacementAsked = (align: any, padTop: any, padBottom: any) =>
  isSet(align, padTop, padBottom);

// Field types rendered as a single input box, whose inner padding comes from
// inner_padding_*. file_upload and button_group are not here: they spend
// uploader_padding_* on a different sub-element, which is a separate feature
// that keeps its own keys. Mirrored by the type list in the backend's style
// serializers (apps/robin/serializers/styles.py, pinned in
// apps/robin/tests/test_style_serializers.py) and by feathery-frontend
// (utils/boxSpacingHelper.tsx); nothing here can read those copies, so this one
// is pinned literally in innerPadding.spec.ts.
export const INPUT_BOX_FIELDS = [
  'text_field',
  'text_area',
  'integer_field',
  'email',
  'password',
  'ssn',
  'url',
  'phone_number',
  'date_selector',
  'dropdown',
  'gmap_line_1',
  'gmap_line_2',
  'gmap_city',
  'gmap_state',
  'gmap_country',
  'gmap_zip'
];

export const borderWidthProps = [
  'border_top_width',
  'border_right_width',
  'border_bottom_width',
  'border_left_width'
];

export const borderColorProps = [
  'border_top_color',
  'border_right_color',
  'border_bottom_color',
  'border_left_color'
];

/**
 * Handles the translation of server-side properties into responsive CSS
 * attributes
 */
export default class ResponsiveStyles {
  element: any;
  handleMobile: boolean;
  mobileStyles: any;
  mobileTargets: any;
  styles: any;
  targets: any;
  mobileBreakpoint: number;
  mobileBreakpointKey: string;

  constructor(
    element: any,
    targets: string[],
    handleMobile = false,
    mobileBreakpoint = DEFAULT_MOBILE_BREAKPOINT
  ) {
    this.element = element;
    this.styles = element.styles;
    this.targets = objectFromEntries(targets.map((t: string) => [t, {}]));
    this.handleMobile = handleMobile;
    this.mobileBreakpoint = mobileBreakpoint;
    this.mobileBreakpointKey = `@media (max-width: ${mobileBreakpoint}px)`;

    if (handleMobile) {
      this.mobileStyles = element.mobile_styles ?? {};
      this.mobileTargets = objectFromEntries(
        targets.map((t: string) => [t, {}])
      );
    }
  }

  getMobileBreakpoint() {
    return this.mobileBreakpoint;
  }

  setMobileBreakpoint(breakpoint: number) {
    this.mobileBreakpoint = breakpoint;
    this.mobileBreakpointKey = `@media (max-width: ${breakpoint}px)`;
  }

  addTargets(...targets: string[]) {
    targets.forEach((target) => {
      this.targets[target] = {};
      if (this.handleMobile) this.mobileTargets[target] = {};
    });
  }

  // Return CSS for a particular target HTML element
  getTarget(targetId: string, desktopOnly = false, includeMobile = false) {
    const target = this.targets[targetId];
    if (!target) return {};

    if (!desktopOnly && this.handleMobile) {
      target[this.mobileBreakpointKey] = this.mobileTargets[targetId];
    }

    // Merge the mobile styles onto the base styles
    if (includeMobile) {
      const mobileStyles = target[this.mobileBreakpointKey];
      delete target[this.mobileBreakpointKey];
      return {
        ...target,
        ...mobileStyles
      };
    }

    return target;
  }

  getTargets(...targets: string[]) {
    let targetStyles = {};
    targets.forEach((targetId) => {
      if (!targetId) return;
      targetStyles = { ...targetStyles, ...this.targets[targetId] };
      if (this.handleMobile)
        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        targetStyles[this.mobileBreakpointKey] = {
          // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
          ...targetStyles[this.mobileBreakpointKey],
          ...this.mobileTargets[targetId]
        };
    });
    return targetStyles;
  }

  setStyle(target: string, key: string, val: any) {
    this.targets[target][key] = val;
  }

  // Translate a set of server-side properties into CSS for a particular
  // target
  apply(target: string, properties: any, get: any) {
    if (!this.styles) return;
    // if not array, assume user passed in 1 element
    if (!Array.isArray(properties)) properties = [properties];
    const styles = properties.map((p: any) => this.styles[p]);
    this.targets[target] = { ...this.targets[target], ...get(...styles) };

    if (this.handleMobile) {
      let mobileStyles = properties.map((p: any) => this.mobileStyles[p]);
      // If no mobile overrides, don't set breakpoint style
      if (mobileStyles.every((s: any) => s === undefined)) return;
      // Fall back to default style if a mobile style doesn't exist
      mobileStyles = properties.map((p: any) => {
        const ms = this.mobileStyles[p];
        return ms !== undefined ? ms : this.styles[p];
      });
      this.mobileTargets[target] = {
        ...this.mobileTargets[target],
        ...get(...mobileStyles)
      };
    }
  }

  applyFlexDirection(target: string, prefix = '') {
    this.apply(target, `${prefix}flex_direction`, (a: any) => ({
      flexDirection: a
    }));
  }

  // Content align needs to be applied on the opposite axis from the flex
  // direction, which specifies the icon position relative to the text, so that
  // text align behaves as expected when the flex direction is vertical (a
  // column)
  applyContentAlign(target: string, prefix = '') {
    this.apply(
      target,
      [`${prefix}text_align`, `${prefix}flex_direction`],
      (a: any, b: any) => ({
        [isDirectionColumn(b) ? 'alignItems' : 'justifyContent']: a
      })
    );
  }

  applyTextAlign(target: string, prefix = '') {
    this.apply(target, `${prefix}text_align`, (a: any) => ({
      textAlign: a
    }));
  }

  applyBorders({ target = '', prefix = '', important = true }) {
    if (!this.styles) return false;

    let borderApplied = false;
    const importantSuffix = prefix && important ? ' !important' : '';

    ['top', 'right', 'bottom', 'left'].forEach((side) => {
      const sideName = `${side[0].toUpperCase()}${side.slice(1)}`;
      this.apply(
        target,
        [
          `${prefix}border_${side}_color`,
          `${prefix}border_${side}_pattern`,
          `${prefix}border_${side}_width`
        ],
        (color: any, pattern: any, width: any) => {
          if (!color && !pattern && isNum(width) && parseFloat(width) === 0) {
            borderApplied = true;
            return {
              [`border${sideName}Width`]: `0px${importantSuffix}`
            };
          }
          if (!color || !pattern || !isNum(width)) return {};

          borderApplied = true;
          const formattedColor =
            color === 'transparent' || color.startsWith('#')
              ? color
              : `#${color}`;

          return {
            [`border${sideName}Color`]: `${formattedColor}${importantSuffix}`,
            [`border${sideName}Style`]: `${pattern}${importantSuffix}`,
            [`border${sideName}Width`]: `${width}px${importantSuffix}`
          };
        }
      );
    });

    return borderApplied;
  }

  applySelectorStyles(
    target: string,
    { prefix = '', important = false, addBorder = true, background = false }
  ) {
    const backgroundApplied = this.styles[`${prefix}background_color`];
    if (backgroundApplied) {
      this.applyColor(
        target,
        `${prefix}background_color`,
        background ? 'background' : 'backgroundColor',
        important
      );
    }
    const borderApplied = addBorder && this.applyBorders({ target, prefix });

    if (borderApplied || backgroundApplied)
      this.apply(target, '', () => ({ transition: '0.2s ease all' }));
  }

  applyPadding(target: string, prefix = '', margin = false) {
    this.apply(
      target,
      [
        `${prefix}padding_top`,
        `${prefix}padding_right`,
        `${prefix}padding_bottom`,
        `${prefix}padding_left`
      ],
      // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
      (a, b, c, d) => ({
        [margin ? 'margin' : 'padding']: `${a}px ${b}px ${c}px ${d}px`
      })
    );
  }

  applyMargin(target: string, prefix = '') {
    this.apply(
      target,
      [
        `${prefix}margin_top`,
        `${prefix}margin_right`,
        `${prefix}margin_bottom`,
        `${prefix}margin_left`
      ],
      // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
      (a, b, c, d) => ({
        margin: `${a}px ${b}px ${c}px ${d}px`
      })
    );
  }

  applyCorners(target: string) {
    this.apply(
      target,
      [
        'corner_top_left_radius',
        'corner_top_right_radius',
        'corner_bottom_right_radius',
        'corner_bottom_left_radius'
      ],
      // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
      (a, b, c, d) => ({
        borderRadius: `${a ?? 0}px ${b ?? 0}px ${c ?? 0}px ${d ?? 0}px`
      })
    );
  }

  applyBoxShadow(target: string) {
    this.apply(
      target,
      [
        'shadow_x_offset',
        'shadow_y_offset',
        'shadow_blur_radius',
        'shadow_color'
      ],
      // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
      (a, b, c, d) => ({
        boxShadow: `${a ?? 0}px ${b ?? 0}px ${c ?? 0}px #${d ?? '000000'}`
      })
    );
  }

  applyHeight(target: string, prefix = '', force = false) {
    this.apply(
      target,
      [`${prefix}height`, `${prefix}height_unit`],
      (a: any, b: any) => {
        const style: any = {};

        if (b === '%') {
          style.minHeight = `${DEFAULT_MIN_SIZE}px`;
          style.height = '100%';
        } else {
          const value = `${a}${b}`;

          style.height = value;

          if (force) {
            (style as any).minHeight = value;
            (style as any).maxHeight = value;
          }
        }

        return style;
      }
    );
  }

  applyWidth(target: string, prefix = '', force = false) {
    this.apply(
      target,
      [`${prefix}width`, `${prefix}width_unit`],
      (a: any, b: any) => {
        const value = `${a}${b}`;
        const style = { width: value };
        if (force) {
          (style as any).minWidth = value;
          (style as any).maxWidth = value;
        }
        return style;
      }
    );
  }

  applyColor(target: string, jsonProp: any, cssProp: any, important = false) {
    this.apply(target, jsonProp, (color: any) => {
      if (!color) return {};
      color = `${color === 'transparent' ? color : `#${color}`}`;
      if (important) color = `${color} !important`;
      return { [cssProp]: color };
    });
  }

  applyFontStyles(
    target: string,
    placeholder = false,
    ignoreSelectorFontColor = false,
    prefix = '',
    skipUnset = false
  ) {
    // With skipUnset, properties without a value emit no CSS at all (instead
    // of defaults like lineHeight: 'normal') so the target inherits them from
    // its parent. Used for labels, which inherit the field's font unless a
    // label_* property is explicitly set.
    const apply = (target: string, properties: any, get: any) =>
      this.apply(
        target,
        properties,
        skipUnset
          ? (...vals: any[]) =>
              vals.every((v) => v === undefined) ? {} : get(...vals)
          : get
      );
    apply(target, `${prefix}font_weight`, (a: any) => ({
      fontWeight: a
    }));
    this.applyFontFamily(target, prefix);
    apply(target, `${prefix}font_size`, (a: any) => ({
      fontSize: `${a}px`
    }));
    apply(target, `${prefix}line_height`, (a: any) => ({
      lineHeight: isNum(a) ? `${a}px` : 'normal'
    }));
    apply(target, `${prefix}letter_spacing`, (a: any) => ({
      letterSpacing: isNum(a) ? `${a}px` : 'normal'
    }));
    apply(target, `${prefix}text_transform`, (a: any) => ({
      textTransform: a || 'none'
    }));
    apply(
      target,
      placeholder ? `${prefix}placeholder_italic` : `${prefix}font_italic`,
      (a: any) => ({
        fontStyle: a ? 'italic' : 'normal'
      })
    );
    apply(
      target,
      placeholder ? `${prefix}placeholder_color` : `${prefix}font_color`,
      (a: any) => ({
        color: `#${a}`,
        '&:disabled': {
          color: `#${a}`,
          WebkitTextFillColor: `#${a}`,
          opacity: 1
        },
        '&:readOnly': {
          color: `#${a}`,
          WebkitTextFillColor: `#${a}`,
          opacity: 1
        }
      })
    );
    if (!placeholder && !ignoreSelectorFontColor) {
      apply(target, `${prefix}hover_font_color`, (color: any) => ({
        '&:hover': color ? { color: `#${color}` } : {}
      }));
      apply(target, `${prefix}selected_font_color`, (color: any) => ({
        '&:focus': color ? { color: `#${color}` } : {}
      }));
    }

    apply(
      target,
      [`${prefix}font_strike`, `${prefix}font_underline`],
      (a: any, b: any) => {
        const lines = [];
        if (a) lines.push('line-through');
        if (b) lines.push('underline');
        if (lines.length > 0) return { textDecoration: lines.join(' ') };
      }
    );
  }

  applySpanSelectorStyles(target: string, prefix = '') {
    this.apply(target, `${prefix}font_color`, (a: string) => {
      if (!a) return {};
      return {
        span: { color: `#${a}`, transition: '0.2s ease all' }
      };
    });
  }

  transformFontFamilies(families: string, fallback = '') {
    const parsed = families
      .replace(/"/g, "'")
      .split(',')
      .map((family) => family.trim())
      .filter(Boolean);
    if (!parsed.length) return families;

    const stack = parsed.map((family) =>
      // Font families with spaces must be quoted
      family.indexOf(' ') >= 0 && !startsEndsWithQuotes(family)
        ? `'${family}'`
        : family
    );
    // Without a generic family the browser renders its own default while the
    // font downloads, so a serif font flashes as whatever the page inherits
    const generic = fallback || getFontFallback(parsed[0]);
    if (generic && !isGenericFamily(parsed[parsed.length - 1]))
      stack.push(generic);
    return stack.join(', ');
  }

  applyFontFamily(target: string, prefix = '') {
    this.apply(
      target,
      [`${prefix}font_family`, `${prefix}font_fallback`],
      (family: string, fallback: string) => {
        if (!family) return {};
        return { fontFamily: this.transformFontFamilies(family, fallback) };
      }
    );
  }

  getRichFontStyles(attrs: any) {
    const fontStyles = this._getRichFontScreenStyles(attrs);
    if (this.handleMobile) {
      fontStyles[this.mobileBreakpointKey] = this._getRichFontScreenStyles(
        attrs,
        true
      );
    }
    if (!('letterSpacing' in fontStyles))
      (fontStyles as any).letterSpacing = 'normal';
    if (!('textTransform' in fontStyles))
      (fontStyles as any).textTransform = 'none';

    return fontStyles;
  }

  _getRichFontScreenStyles(attrs: any, isMobile = false) {
    const styles: Record<string, any> = {};

    const p = isMobile ? 'mobile_' : '';
    let attr = attrs[`${p}font_size`];
    if (attr) styles.fontSize = `${attr}px`;
    attr = attrs[`${p}font_family`];
    // Rich text runs carry their own family but inherit the element's fallback
    if (attr)
      styles.fontFamily = this.transformFontFamilies(
        attr,
        (isMobile ? this.mobileStyles?.font_fallback : '') ||
          this.styles?.font_fallback
      );
    attr = attrs[`${p}font_color`];
    if (attr) styles.color = `#${attr}`;
    attr = attrs[`${p}font_weight`];
    if (attr) styles.fontWeight = attr;
    if (attrs[`${p}font_italic`]) styles.fontStyle = 'italic';
    attr = attrs[`${p}text_transform`];
    if (attr) styles.textTransform = attr;
    attr = attrs[`${p}letter_spacing`];
    if (isNum(attr)) styles.letterSpacing = `${attr}px`;

    const lines = [];
    if (attrs[`${p}font_strike`]) lines.push('line-through');
    if (attrs[`${p}font_underline`]) lines.push('underline');
    if (lines.length > 0) styles.textDecoration = lines.join(' ');
    else if (!isMobile) styles.textDecoration = 'none';

    return styles;
  }

  // Content alignment for the text inside an input box. Horizontal rides on
  // text-align; vertical has to be synthesized -- see inputBoxVertical.
  applyInputBoxAlignment(type: string) {
    // Unset leaves text-align undeclared, which is how every input box renders
    // today: the UA stylesheet computes `start` for input, select and textarea.
    this.apply('field', CONTENT_HORIZONTAL_ALIGN, (a: any) =>
      isSet(a) ? { textAlign: textAlignFor(a) } : {}
    );

    this.apply(
      'field',
      VERTICAL_PLACEMENT_KEYS,
      (
        align: any,
        height: any,
        heightUnit: any,
        padTop: any,
        padBottom: any,
        lineHeight: any,
        fontSize: any
      ) => {
        // Nothing set: the field keeps resetStyles' own block padding, exactly
        // as authored.
        if (!verticalPlacementAsked(align, padTop, padBottom)) return {};

        const placement = inputBoxVertical(
          type,
          align,
          height,
          heightUnit,
          padTop,
          padBottom,
          lineHeight,
          fontSize
        );
        // Centred, or a top/bottom alignment this box cannot resolve an offset
        // for. The padding the theme asked for stands on its own, and both
        // sides are emitted so a mobile override can undo a synthesized one --
        // but an unresolvable alignment with no padding behind it has nothing
        // to say, and saying resetStyles' own value back would only add noise.
        if (!placement) {
          if (
            !isSet(padTop, padBottom) &&
            !canSynthesizeVertical(
              type,
              height,
              heightUnit,
              lineHeight,
              fontSize
            )
          )
            return {};
          return {
            paddingTop: blockPaddingCss(type, padTop),
            paddingBottom: blockPaddingCss(type, padBottom)
          };
        }

        const { top, bottom, line, height: box } = placement;
        // A box shorter than one line of text leaves nothing to pad out, and a
        // negative padding is not a value CSS will take. The side that is not
        // padded out is emitted raw, so switching alignment across a breakpoint
        // replaces both sides rather than leaving one behind.
        return placement.align === 'flex-start'
          ? {
              paddingTop: blockPaddingCss(type, padTop),
              paddingBottom: `${Math.max(0, box - top - line)}px`
            }
          : {
              paddingTop: `${Math.max(0, box - bottom - line)}px`,
              paddingBottom: blockPaddingCss(type, padBottom)
            };
      }
    );
  }

  // dropdown_multi's element becomes a column -- so the box below the label
  // can claim the leftover height rather than a percentage of the whole
  // element, with flex-start keeping the label the shrink-to-fit box it is in
  // normal flow, and flexShrink: 0 letting wrapped chips overflow a capped
  // element rather than be compressed across its bottom border -- but only
  // once the theme moves the padding or alignment. Untouched forms keep
  // master's plain block layout, its label-overflow behavior deliberately
  // included: restructuring them would shift chips that asked for nothing.
  applyMultiselectLayout() {
    const gateKeys = [...INNER_PADDING_KEYS, CONTENT_VERTICAL_ALIGN];
    // One direction only. The restructure is keyed on the theme having spoken at
    // all, and a mobile pass cannot see fewer keys than the desktop one -- an
    // override the builder deleted resolves back to the desktop value, not to
    // undefined -- so an element restructured on desktop stays restructured
    // across the breakpoint, and there is no return path to emit neutrals for.
    this.apply('fc', gateKeys, (t: any, r: any, b: any, l: any, align: any) =>
      isSet(t, r, b, l, align)
        ? {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start'
          }
        : {}
    );
    this.apply(
      'sub-fc',
      gateKeys,
      (t: any, r: any, b: any, l: any, align: any) =>
        isSet(t, r, b, l, align) ? { flexShrink: 0 } : {}
    );
    // The box can grow in height as more options are selected, so its height
    // is a floor rather than fixed.
    this.apply(
      'sub-fc',
      ['height', 'height_unit', ...gateKeys],
      (h: any, unit: any, t: any, r: any, b: any, l: any, align: any) => {
        if (unit !== '%') return { minHeight: `${h}${unit}` };
        const minHeight = `${DEFAULT_MIN_SIZE}px`;
        // In the column, the box fills what the label leaves rather than the
        // whole element. A percentage would measure the box from the
        // element's top, so a label made it that much too tall and dropped
        // everything centred in it -- chips, placeholder, chevron -- by half
        // of the label.
        return isSet(t, r, b, l, align)
          ? { minHeight, flexGrow: 1, height: 'auto' }
          : { minHeight, height: '100%', flexGrow: 0 };
      }
    );
  }

  // dropdown_multi's chips are laid out by react-select's value container, so
  // its inner padding and alignment go there rather than on the input the
  // other types use. Being a flex container, it takes both alignment values
  // directly -- no offset has to be synthesized, and it holds at any height.
  applyMultiselectInnerStyles() {
    // react-select lets the value container hug its content and centers it on
    // the control, so there is no box for a block padding to inset from and no
    // free space for the chips to align within vertically. Filling the control
    // gives it both -- but it also moves the chips to the top of that box, so
    // it is spent only once the theme asks for a placement react-select's own
    // layout cannot express. At the values every existing multiselect resolves
    // to, its own layout still holds and the chips stay where they were.
    this.apply(
      'valueContainer',
      [...INNER_PADDING_KEYS, CONTENT_VERTICAL_ALIGN],
      (t: any, r: any, b: any, l: any, align: any) =>
        // Unset emits nothing, leaving react-select's own layout in place.
        isSet(t, r, b, l, align) ? { alignSelf: 'stretch' } : {}
    );

    this.apply(
      'valueContainer',
      INNER_PADDING_KEYS,
      (t: any, r: any, b: any, l: any) => {
        const padding: any = {};
        if (isNum(t)) padding.paddingTop = `${t}px`;
        if (isNum(b)) padding.paddingBottom = `${b}px`;
        if (isNum(l)) padding.paddingInlineStart = `${l}px`;
        // The right padding places the chevron, and the chips stop a chevron
        // strip further in so a full row can never slide under the glyph. One
        // value moves both together -- a Math.max floor here pinned the chevron
        // in place for every padding below it. Unset, selectStyles' own
        // paddingInlineEnd stands: the same 28px, straight from react-select.
        if (isSet(r))
          padding.paddingInlineEnd = `${
            paddingSide(r, DEFAULT_CHEVRON_GAP) + MULTISELECT_CHEVRON_CLEARANCE
          }px`;
        return padding;
      }
    );

    this.apply('valueContainer', CONTENT_HORIZONTAL_ALIGN, (a: any) =>
      isSet(a)
        ? {
            // 'flex-start' is how a flex container distributes with no
            // declaration (initial 'normal' behaves as flex-start), and 'start'
            // is the text-align the UA already computes.
            justifyContent: spansContentBox(a) ? a : 'flex-start',
            textAlign: textAlignFor(a)
          }
        : {}
    );

    // alignItems places chips within a row, alignContent the rows themselves
    // once they wrap. 'center' for the centred case: while the container still
    // hugs its content there is no free space for either to distribute, so it
    // is inert, and once a moved padding stretches the container it is what
    // centring the chips means. Unset defers to selectStyles, which sets both
    // from whether the chips wrap.
    this.apply('valueContainer', CONTENT_VERTICAL_ALIGN, (a: any) => {
      if (!isSet(a)) return {};
      const placed = a === 'flex-start' || a === 'flex-end' ? a : 'center';
      return { alignItems: placed, alignContent: placed };
    });
  }

  // A dropdown's chevron is painted on the box, so without this it floats at
  // the box's midline while the value sits wherever the padding put it. Only
  // the vertical half is emitted here: which inline edge it hangs off depends
  // on the form's direction, which the field component knows.
  applyDropdownChevronPlacement(type: string) {
    // The right padding is the border-to-glyph gap for both types, so the
    // glyph's inline offset is that value directly -- plus the strip a
    // tooltip trigger occupies. A custom property rather than a resolved
    // number so a mobile padding override moves the chevron under the same
    // media query, which a value computed from the desktop target could not.
    // Unset leaves the property undeclared and the components' own inline
    // anchors -- the production 10px gap -- in place.
    this.apply('field', INNER_PADDING_RIGHT, (r: any) =>
      isSet(r)
        ? {
            '--fe-chevron-x': `${
              paddingSide(r, DEFAULT_CHEVRON_GAP) +
              (this.element?.properties?.tooltipText ? 20 : 0)
            }px`
          }
        : {}
    );

    this.apply(
      'field',
      VERTICAL_PLACEMENT_KEYS,
      (
        align: any,
        height: any,
        heightUnit: any,
        padTop: any,
        padBottom: any,
        lineHeight: any,
        fontSize: any
      ) => {
        if (!verticalPlacementAsked(align, padTop, padBottom)) return {};
        const y = valueLineY(
          type,
          align,
          height,
          heightUnit,
          padTop,
          padBottom,
          lineHeight,
          fontSize
        );
        // 'center' is the neutral -- what both components declare inline before
        // spreading this target -- so a mobile override can bring the glyph
        // back to the box midline.
        return { backgroundPositionY: y ?? 'center' };
      }
    );
  }

  // The eye toggle and tooltip icon sit on the input's inline end: they
  // follow the right padding in and out -- their production seats are the
  // zero -- and ride the value's line once it leaves the box centre. The
  // components' own anchors stay in place until a value here overrides them.
  applyInlineIconPlacement(type: string) {
    this.addTargets('endIcon', 'tooltipTrigger');

    // A dropdown's right padding is its border-to-chevron gap, so its legacy
    // zero differs from a plain input's.
    const legacyEnd = DROPDOWN_FIELDS.includes(type)
      ? DEFAULT_CHEVRON_GAP
      : RESET_INPUT_PADDING_X;
    const eyeBase = EYE_ICON_INSET(!!this.element?.properties?.tooltipText);
    this.apply('endIcon', INNER_PADDING_RIGHT, (r: any) =>
      isSet(r)
        ? {
            insetInlineEnd: `${Math.max(
              0,
              eyeBase + paddingSide(r, legacyEnd) - legacyEnd
            )}px`
          }
        : {}
    );
    this.apply('tooltipTrigger', INNER_PADDING_RIGHT, (r: any) =>
      isSet(r)
        ? {
            insetInlineEnd: `${Math.max(
              0,
              TOOLTIP_TRIGGER_INSET + paddingSide(r, legacyEnd) - legacyEnd
            )}px`
          }
        : {}
    );

    ['endIcon', 'tooltipTrigger'].forEach((target) => {
      this.apply(
        target,
        VERTICAL_PLACEMENT_KEYS,
        (
          align: any,
          height: any,
          heightUnit: any,
          t: any,
          b: any,
          lineHeight: any,
          fontSize: any
        ) => {
          if (!verticalPlacementAsked(align, t, b)) return {};
          const delta = inputValueDelta(
            type,
            align,
            height,
            heightUnit,
            t,
            b,
            lineHeight,
            fontSize
          );
          // A zero translation is the neutral, so a mobile override can
          // bring the icon back to the box midline.
          return { transform: delta ? `translateY(${delta}px)` : NO_TRANSLATE };
        }
      );
    });
  }

  // A phone's flag is a flex sibling of its input, centred on the box. The
  // left padding is the border-to-flag gap -- the number keeps the fixed 12px
  // gap it has always had from the flag, so one value moves both together --
  // and once the value's line leaves the box centre, the flag rides with it.
  applyPhoneFlagPlacement() {
    // Unset means the flag keeps sitting flush on the border, which is where it
    // has always sat -- no margin declared at all.
    this.apply('fieldToggle', INNER_PADDING_LEFT, (l: any) =>
      isSet(l) ? { marginInlineStart: `${isNum(l) ? Number(l) : 0}px` } : {}
    );
    this.apply(
      'fieldToggle',
      VERTICAL_PLACEMENT_KEYS,
      (
        align: any,
        height: any,
        heightUnit: any,
        t: any,
        b: any,
        lineHeight: any,
        fontSize: any
      ) => {
        const delta = inputValueDelta(
          'phone_number',
          align,
          height,
          heightUnit,
          t,
          b,
          lineHeight,
          fontSize
        );
        // Neutral zero translation, so a mobile override can re-centre the flag.
        return { transform: delta ? `translateY(${delta}px)` : NO_TRANSLATE };
      }
    );
  }

  // The input box never shrinks below what its own inner padding plus a line
  // of text needs, so padding can't push the text out of the box.
  applyInputBoxMinHeight(type: string) {
    this.apply(
      'sub-fc',
      // The floor itself does not depend on vertical_align, but the key stays
      // in the list: a multiselect's floor is applyMultiselectLayout's, whose
      // own apply is gated on it, so dropping it here would let a mobile
      // alignment override reach that floor and not this one.
      VERTICAL_PLACEMENT_KEYS,
      (
        align: any,
        height: any,
        heightUnit: any,
        t: any,
        b: any,
        lineHeight: any,
        fontSize: any
      ) => {
        if (!verticalPlacementAsked(align, t, b)) return {};
        const line = inputLineHeight(lineHeight, fontSize);
        if (!line) return {};

        const legacy = legacyPaddingY(type);
        const top = paddingSide(t, legacy);
        const bottom = paddingSide(b, legacy);

        // A floating label is a fixed overlay taking no room in the content
        // box, so it never adds to this floor. Only a padding raised above what
        // the field already rendered with needs more room -- a lowered one fits
        // in the box it already has.
        if (!raisedPaddingY(type, t, b)) {
          // A multiselect's floor is applyMultiselectLayout's, whose apply
          // covers these same keys and so reaches the breakpoint on its own.
          // Emitting anything here would clobber it.
          if (type === MULTISELECT_FIELD) return {};
          // Otherwise hand the clamp back, so a mobile override that lowers a
          // raised padding lets the box shrink again: 'auto' is the initial
          // value, and a percentage-height box keeps applyHeight's own floor.
          return {
            minHeight: heightUnit === '%' ? `${DEFAULT_MIN_SIZE}px` : 'auto'
          };
        }

        // A multiselect spends its whole height on a floor so the box can grow
        // with the chips, which makes that height the content area rather than
        // the box. Padding adds to it instead of eating into it -- otherwise
        // the first (height - line) of padding only moves the chips down.
        if (type === MULTISELECT_FIELD && heightUnit !== '%' && isNum(height))
          return {
            minHeight: `${top + bottom + Math.max(Number(height), line)}px`
          };

        let min = top + bottom + line;
        // applyHeight gives a percentage-height box a floor of its own; keep
        // the larger rather than replacing it.
        if (heightUnit === '%') min = Math.max(min, DEFAULT_MIN_SIZE);
        return { minHeight: `${min}px` };
      }
    );
  }

  applyPlaceholderStyles(type: any, styles: any) {
    this.addTargets('placeholder', 'placeholderActive', 'placeholderFocus');
    this.applyFontStyles('placeholder', true);
    this.apply('placeholder', 'font_size', (a: any) => ({
      lineHeight: `${a}px`
    }));
    if (type !== 'text_area') {
      this.apply('placeholder', 'font_size', (a: any) => ({
        marginTop: `-${a / 2}px`
      }));
    }
    // The placeholder is positioned over the content rather than laid out
    // inside it, so it has to track the padding itself or it detaches from the
    // text it stands in for.
    if (takesInnerPadding(type)) {
      this.apply(
        'placeholder',
        [INNER_PADDING_LEFT, INNER_PADDING_RIGHT, CONTENT_HORIZONTAL_ALIGN],
        (l: any, r: any, align: any) => {
          // Unset leaves the component's own inline anchors alone -- the
          // production 12px, or 0.75rem as the components author it.
          if (!isSet(l, r, align)) return {};
          const placed: any = {};
          // A phone's left padding places its flag, not its text: the number
          // and its placeholder keep the fixed 12px gap they have always had
          // from the flag.
          let start = l;
          if (type === 'phone_number') start = RESET_INPUT_PADDING_X;
          // A multiselect's placeholder has always sat at 0.75rem = 12px --
          // 4px inside react-select's own 8px inline start for the chips -- so
          // it keeps that offset as the padding moves the chips.
          else if (type === MULTISELECT_FIELD)
            start = paddingSide(l, MULTISELECT_LEGACY_PADDING.left) + 4;
          if (isNum(start)) placed.insetInlineStart = `${start}px`;

          // Anchoring the inline start only holds while the text starts there.
          // Centered and end-aligned text needs the span to span the content
          // box and align its own text the same way.
          placed.textAlign = textAlignFor(align);
          if (spansContentBox(align)) {
            placed.insetInlineStart = `${paddingSide(
              start,
              RESET_INPUT_PADDING_X
            )}px`;
            // A placeholder stands in for the content, so it stops where the
            // content does: a chevron strip past the padding on the types
            // that paint a glyph there, the padding itself everywhere else.
            placed.insetInlineEnd =
              chevronClearance(type) > 0
                ? `${
                    paddingSide(r, DEFAULT_CHEVRON_GAP) + chevronClearance(type)
                  }px`
                : `${paddingSide(r, RESET_INPUT_PADDING_X)}px`;
          } else {
            // 'auto' is the neutral: an unspanned placeholder is anchored by
            // its inline start alone, exactly as when the property is absent.
            placed.insetInlineEnd = 'auto';
          }
          return placed;
        }
      );
      if (type === MULTISELECT_FIELD) {
        // Its value container aligns the chips with flexbox, so the placeholder
        // only has to meet them -- no pixel height needed, unlike an input.
        this.apply(
          'placeholder',
          [
            CONTENT_VERTICAL_ALIGN,
            INNER_PADDING_TOP,
            INNER_PADDING_BOTTOM,
            'line_height',
            'font_size'
          ],
          (align: any, t: any, b: any, lineHeight: any, fontSize: any) => {
            if (!verticalPlacementAsked(align, t, b)) return {};
            // Same placement the chevron takes, so the two can't disagree.
            const y = valueLineY(
              MULTISELECT_FIELD,
              align,
              null,
              null,
              t,
              b,
              lineHeight,
              fontSize
            );
            // '50%' is the neutral Placeholder declares inline for an input.
            return { top: y ?? '50%' };
          }
        );
      } else if (type === 'text_area') {
        this.apply('placeholder', INNER_PADDING_TOP, (a: any) =>
          // Raw, whether a label floats above or none does: the resting label
          // stands in for the text, which starts at the padding. Unset leaves
          // the '0.6rem' the component declares inline -- the same 9.6px the
          // 8px reset padding composes to, and rem so it holds at any root.
          isSet(a)
            ? {
                top: isNum(a)
                  ? `${Number(a) + TEXT_AREA_PLACEHOLDER_TOP_OFFSET}px`
                  : '0.6rem'
              }
            : {}
        );
      } else {
        // A single-line input centers its text in the content box, so an
        // asymmetric vertical padding shifts that midline off the box's 50%
        // anchor by half the top/bottom difference, and a synthesized
        // top/bottom alignment moves it onto the aligned text's line. One apply
        // resolves both cases: two would fight over `top`, since the neutral
        // each needs for its own inactive case is the other's answer.
        this.apply(
          'placeholder',
          VERTICAL_PLACEMENT_KEYS,
          (
            align: any,
            height: any,
            heightUnit: any,
            t: any,
            b: any,
            lineHeight: any,
            fontSize: any
          ) => {
            if (!verticalPlacementAsked(align, t, b)) return {};
            // Computed from the same values as the input's own placement, so
            // the two can never disagree: where the input cannot be aligned,
            // this falls through and both stay centered.
            const placement = inputBoxVertical(
              type,
              align,
              height,
              heightUnit,
              t,
              b,
              lineHeight,
              fontSize
            );
            if (placement) {
              const { top, bottom, line, height: box } = placement;
              return {
                top:
                  placement.align === 'flex-start'
                    ? `${top + line / 2}px`
                    : `${box - bottom - line / 2}px`
              };
            }

            // '50%' is the neutral Placeholder declares inline for an input,
            // so a mobile override can re-centre the label.
            if (!isNum(t) && !isNum(b)) return { top: '50%' };
            const delta =
              (paddingSide(t, RESET_INPUT_PADDING_Y) -
                paddingSide(b, RESET_INPUT_PADDING_Y)) /
              2;
            return { top: offsetFromCenter(delta) };
          }
        );
      }
    }
    if (styles.placeholder_transition === 'shrink_top') {
      // The shrunken label is an overlay pinned to the box top, at fixed
      // offsets the padding never moves -- production geometry.
      this.apply('placeholderFocus', 'font_size', (fontSize: any) => {
        const minFontSize = Math.min(fontSize, 10);
        const pinned: any = {
          // Half a shrunken font down, in the resting label's own line box.
          top: 0,
          marginTop: `${minFontSize / 2}px`,
          fontSize: `${minFontSize}px`
        };
        // Fixed on the inline axis too: the resting label tracks the padding
        // with the value it stands in for, but the shrunken label keeps its
        // production seat whatever the theme sets. That seat is the 0.75rem
        // Placeholder anchors it at inline, and it has to be re-declared in
        // the same unit -- `12px` is only the same seat at a 16px root, so on
        // a page with any other root size it would move every shrunken label
        // on the form. Emitted unconditionally because it is exactly that
        // anchor: a mobile pass can then return the label to it (apply()
        // cannot undo a declaration, only overwrite it).
        if (takesInnerPadding(type))
          pinned.insetInlineStart = RESET_INLINE_PADDING_CSS;
        return pinned;
      });
      // A pinned label is a fixed overlay taking no room in the content box, so
      // the value needs a reserve behind it. Unset, that reserve is computed
      // here exactly as production computed it -- height/3 in the height's own
      // unit, or 2.5x the shrunken label's font size for a text area -- which
      // is why it keeps tracking a height the builder changes instead of being
      // frozen into the theme as a px number. Set, the theme's own padding is
      // what the value renders behind, including a value low enough to run it
      // under the label's ink.
      this.apply(
        'field',
        [
          'height',
          'height_unit',
          'font_size',
          INNER_PADDING_TOP,
          CONTENT_VERTICAL_ALIGN,
          'line_height'
        ],
        (
          height: any,
          heightUnit: any,
          fontSize: any,
          t: any,
          align: any,
          lineHeight: any
        ) => {
          const reserve = shrinkLabelReserve(
            type,
            height,
            heightUnit,
            fontSize
          );
          if (!takesInnerPadding(type)) return { paddingTop: reserve };
          // An alignment the box can resolve has already placed the value, and
          // the label takes no room in the content box, so the reserve would
          // only fight it. Left to applyInputBoxAlignment.
          if (
            !isSet(t) &&
            isSet(align) &&
            canSynthesizeVertical(
              type,
              height,
              heightUnit,
              lineHeight,
              fontSize
            )
          )
            return {};
          if (!isSet(t)) return { paddingTop: reserve };
          // A multiselect's own padding lands on the value container react-
          // select lays the chips out in, so this target is only ever the room
          // the pinned label needs: keep whichever is larger rather than
          // letting a container padding shrink the label's reserve.
          if (type === MULTISELECT_FIELD)
            return { paddingTop: `max(${Number(t)}px, ${reserve})` };
          // Every other input box renders the value behind its own padding, so
          // the stored value stands exactly as set.
          return { paddingTop: blockPaddingCss(type, t) };
        }
      );
      if (styles.selected_placeholder_color) {
        this.apply(
          'placeholderActive',
          'selected_placeholder_color',
          (a: any) => ({
            color: `#${a}`
          })
        );
      }
    } else {
      this.setStyle('placeholderFocus', 'display', 'none');
    }
  }

  applyBackgroundColorGradient(target: string) {
    this.apply(
      target,
      ['background_color', 'gradient_color'],
      (b: any, g: any) => {
        if (!b) b = 'FFFFFF00';
        if (g) return { background: `linear-gradient(#${b}, #${g})` };
        else return { backgroundColor: `#${b}` };
      }
    );
  }

  applyBackgroundImageStyles(target: string) {
    const targetStyles = [
      'background_image_url',
      'background_image_display',
      'background_image_layout',
      'background_image_vertical_layout',
      'background_image_size',
      'background_image_size_x',
      'background_image_size_y',
      'background_image_repeat'
    ];

    this.apply(target, targetStyles, (...styles: any[]) => {
      const [
        imageUrl,
        imageDisplay,
        imageLayout,
        imageVerticalLayout,
        imageSize,
        imageSizeX,
        imageSizeY,
        imageRepeat
      ] = styles;

      const formattedStyles: Record<string, string> = {
        backgroundRepeat: imageRepeat,
        backgroundPositionX: imageLayout,
        backgroundPositionY: imageVerticalLayout
      };
      if (imageUrl) formattedStyles.backgroundImage = `url(${imageUrl})`;

      switch (imageDisplay) {
        case 'fill':
        case 'fit':
          formattedStyles.backgroundSize = imageSize;
          break;
        case 'tile':
          formattedStyles.backgroundSize = `${imageSize}%`;
          break;
        case 'set_scale':
          formattedStyles.backgroundSize = `${imageSizeX}px ${imageSizeY}px`;
          break;
      }

      return formattedStyles;
    });
  }
}

export const noTextSelectStyles: CSSProperties = {
  WebkitTouchCallout: 'none' /* iOS Safari */,
  WebkitUserSelect: 'none' /* Safari */,
  MozUserSelect: 'none' /* Old versions of Firefox */,
  msUserSelect: 'none' /* Internet Explorer / Edge */,
  userSelect: 'none' /* Chrome, Firefox, etc. */
};

/**
 * Neutralizes user-agent <button> styling so a button can stand in for a div
 * without changing how it renders. Spread this *before* the designer's own
 * styles so those still win.
 */
export const unstyledButton: CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  background: 'none',
  border: 'none',
  borderRadius: 0,
  // Buttons are border-box in the UA stylesheet but a plain div is content-box.
  // Components that want border-box already declare it themselves.
  boxSizing: 'content-box',
  padding: 0,
  margin: 0,
  color: 'inherit',
  font: 'inherit',
  letterSpacing: 'inherit',
  textAlign: 'inherit',
  textTransform: 'none',
  minWidth: 0,
  width: 'auto',
  height: 'auto'
};

export const resetStyles: CSSProperties = {
  padding: '0.375rem 0.75rem',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out',
  outline: 'none'
};

export const imgMaxSizeStyles: CSSProperties = {
  // Setting min-height to 0 prevents vertical image overflow
  minHeight: 0,
  objectFit: 'contain',
  maxWidth: '80%',
  maxHeight: '100%'
};

export const ERROR_COLOR = '#F42525';

export function mergeMobileStyles(
  style1: any,
  style2: any,
  breakpoint = DEFAULT_MOBILE_BREAKPOINT
) {
  const mobileBreakpointKey = `@media (max-width: ${breakpoint}px)`;
  const newMobile = {};
  Object.assign(newMobile, style1[mobileBreakpointKey]);
  Object.assign(newMobile, style2[mobileBreakpointKey]);
  return { [mobileBreakpointKey]: newMobile };
}
