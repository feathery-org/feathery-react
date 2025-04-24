import { DEFAULT_MIN_SIZE } from '../Form/grid/StyledContainer/styles';
import { featheryWindow } from '../utils/browser';
import {
  isNum,
  objectFromEntries,
  startsEndsWithQuotes
} from '../utils/primitives';
import { isDirectionColumn } from '../utils/styles';
import { CSSProperties } from 'react';

export const mobileBreakpointValue = 478;

export const mobileBreakpointKey = `@media (max-width: ${mobileBreakpointValue}px)`;

export const getViewport = () => {
  return featheryWindow().innerWidth > mobileBreakpointValue
    ? 'desktop'
    : 'mobile';
};

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

  constructor(element: any, targets: string[], handleMobile = false) {
    this.element = element;
    this.styles = element.styles;
    this.targets = objectFromEntries(targets.map((t: string) => [t, {}]));
    this.handleMobile = handleMobile;
    if (handleMobile) {
      this.mobileStyles = element.mobile_styles ?? {};
      this.mobileTargets = objectFromEntries(
        targets.map((t: string) => [t, {}])
      );
    }
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
      target[mobileBreakpointKey] = this.mobileTargets[targetId];
    }

    // Merge the mobile styles onto the base styles
    if (includeMobile) {
      const mobileStyles = target[mobileBreakpointKey];

      delete target[mobileBreakpointKey];

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
        targetStyles[mobileBreakpointKey] = {
          // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
          ...targetStyles[mobileBreakpointKey],
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
    // If color isn't defined on one of the sides, that means there's no border
    if (!this.styles) return false;
    if (!this.styles[`${prefix}border_top_color`]) return false;

    const i = prefix && important ? '!important' : '';
    this.apply(
      target,
      borderColorProps.map((prop) => `${prefix}${prop}`),
      // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
      (a, b, c, d) => ({
        borderColor: `#${a} #${b} #${c} #${d} ${i}`
      })
    );
    this.apply(
      target,
      [
        `${prefix}border_top_pattern`,
        `${prefix}border_right_pattern`,
        `${prefix}border_bottom_pattern`,
        `${prefix}border_left_pattern`
      ],
      // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
      (a, b, c, d) => ({
        borderStyle: `${a} ${b} ${c} ${d} ${i}`
      })
    );
    this.apply(
      target,
      borderWidthProps.map((prop) => `${prefix}${prop}`),
      // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
      (a, b, c, d) => ({
        borderWidth: `${a}px ${b}px ${c}px ${d}px ${i}`
      })
    );

    return true;
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
    ignoreSelectorFontColor = false
  ) {
    this.apply(target, 'font_weight', (a: any) => ({
      fontWeight: a
    }));
    this.applyFontFamily(target);
    this.apply(target, 'font_size', (a: any) => ({
      fontSize: `${a}px`
    }));
    this.apply(target, 'line_height', (a: any) => ({
      lineHeight: isNum(a) ? `${a}px` : 'normal'
    }));
    this.apply(target, 'letter_spacing', (a: any) => ({
      letterSpacing: isNum(a) ? `${a}px` : 'normal'
    }));
    this.apply(target, 'text_transform', (a: any) => ({
      textTransform: a || 'none'
    }));
    this.apply(
      target,
      placeholder ? 'placeholder_italic' : 'font_italic',
      (a: any) => ({
        fontStyle: a ? 'italic' : 'normal'
      })
    );
    this.apply(
      target,
      placeholder ? 'placeholder_color' : 'font_color',
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
      this.apply(target, 'hover_font_color', (color: any) => ({
        '&:hover': color ? { color: `#${color}` } : {}
      }));
      this.apply(target, 'selected_font_color', (color: any) => ({
        '&:focus': color ? { color: `#${color}` } : {}
      }));
    }

    this.apply(target, ['font_strike', 'font_underline'], (a: any, b: any) => {
      const lines = [];
      if (a) lines.push('line-through');
      if (b) lines.push('underline');
      if (lines.length > 0) return { textDecoration: lines.join(' ') };
    });
  }

  applySpanSelectorStyles(target: string, prefix = '') {
    this.apply(target, `${prefix}font_color`, (a: string) => {
      if (!a) return {};
      return {
        span: { color: `#${a}`, transition: '0.2s ease all' }
      };
    });
  }

  transformFontFamilies(families: string) {
    families = families.replace(/"/g, "'");
    families = families
      .split(',')
      .map((family) => {
        family = family.trim();
        if (family.indexOf(' ') >= 0 && !startsEndsWithQuotes(family)) {
          // Font families with spaces must be quoted
          return `'${families}'`;
        }
        return family;
      })
      .join(', ');
    return families;
  }

  applyFontFamily(target: string) {
    this.apply(target, 'font_family', (a: string) => {
      if (!a) return {};
      return { fontFamily: this.transformFontFamilies(a) };
    });
  }

  getRichFontStyles(attrs: any) {
    const fontStyles = this._getRichFontScreenStyles(attrs);
    if (this.handleMobile) {
      fontStyles[mobileBreakpointKey] = this._getRichFontScreenStyles(
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
    if (attr) styles.fontFamily = this.transformFontFamilies(attr);
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
    if (styles.placeholder_transition === 'shrink_top') {
      this.apply('placeholderFocus', 'font_size', (a: any) => {
        const minFontSize = Math.min(a, 10);
        return {
          top: 0,
          marginTop: `${minFontSize / 2}px`,
          fontSize: `${minFontSize}px`
        };
      });
      this.apply(
        'field',
        ['height', 'height_unit', 'font_size'],
        (a: number, b: string, c: number) => {
          const minFontSize = Math.min(c, 10);
          return {
            paddingTop:
              type === 'text_area' ? `${minFontSize * 2.5}px` : `${a / 3}${b}`
          };
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

export const bootstrapStyles: CSSProperties = {
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

export function mergeMobileStyles(style1: any, style2: any) {
  const newMobile = {};
  Object.assign(newMobile, style1[mobileBreakpointKey]);
  Object.assign(newMobile, style2[mobileBreakpointKey]);
  return { [mobileBreakpointKey]: newMobile };
}
