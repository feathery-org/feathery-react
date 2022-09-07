import { isNum, objectFromEntries } from '../utils/primitives';
import { isDirectionColumn } from '../utils/styles';

export const mobileBreakpointValue = 478;

export const mobileBreakpointKey = `@media (max-width: ${mobileBreakpointValue}px)`;

/**
 * Handles the translation of server-side properties into responsive CSS
 * attributes
 */
class ApplyStyles {
  element: any;
  handleMobile: boolean;
  mobileStyles: any;
  mobileTargets: any;
  styles: any;
  targets: any;

  constructor(element: any, targets: string[], handleMobile = true) {
    this.element = element;
    this.styles = element.styles;
    this.targets = objectFromEntries(targets.map((t: string) => [t, {}]));
    this.handleMobile = handleMobile;
    if (handleMobile) {
      this.mobileStyles = element.mobile_styles;
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
  getTarget(targetId: string, desktopOnly = false) {
    const target = { ...this.targets[targetId] };
    if (!desktopOnly && this.handleMobile) {
      target[mobileBreakpointKey] = this.mobileTargets[targetId];
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

  applyFlexAndTextAlignments(target: string, prefix = '') {
    this.applyFlexDirection(target, prefix);
    this.applyTextAlign(target, prefix);
  }

  applyFlexDirection(target: string, prefix = '') {
    this.apply(target, `${prefix}flex_direction`, (a: any) => ({
      flexDirection: a
    }));
  }

  // Text align needs to be applied on the opposite axis from the flex
  // direction, which specifies the icon position relative to the text, so that
  // text align behaves as expected when the flex direction is vertical (a
  // column)
  applyTextAlign(target: string, prefix = '') {
    this.apply(target, `${prefix}text_align`, (a: any) => ({
      [isDirectionColumn(this.styles[`${prefix}flex_direction`])
        ? 'alignItems'
        : 'justifyContent']: a
    }));
  }

  applyBorders(target: string, prefix = '', important = true) {
    // If color isn't defined on one of the sides, that means there's no border
    if (!this.styles) return;
    if (!this.styles[`${prefix}border_top_color`]) return;
    const i = prefix && important ? '!important' : '';
    this.apply(
      target,
      [
        `${prefix}border_top_color`,
        `${prefix}border_right_color`,
        `${prefix}border_bottom_color`,
        `${prefix}border_left_color`
      ],
      // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
      (a, b, c, d) => ({
        borderColor: `#${a} #${b} #${c} #${d} ${i}`
      })
    );
    this.apply(
      target,
      [
        `${prefix}border_top_width`,
        `${prefix}border_right_width`,
        `${prefix}border_bottom_width`,
        `${prefix}border_left_width`
      ],
      // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
      (a, b, c, d) => ({
        borderWidth: `${a}px ${b}px ${c}px ${d}px ${i}`
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
  }

  applySelectorStyles(target: string, prefix: string, important = false) {
    this.applyBorders(target, prefix);
    if (this.styles[`${prefix}background_color`]) {
      this.applyColor(
        target,
        `${prefix}background_color`,
        'backgroundColor',
        important
      );
    }
    if (this.styles[`${prefix}font_color`]) {
      this.applyColor(target, `${prefix}font_color`, 'color', important);
    }
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
        borderRadius: `${a}px ${b}px ${c}px ${d}px`
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
        boxShadow: `${a}px ${b}px ${c}px #${d}`
      })
    );
  }

  applyHeight(target: string, prefix = '', force = false) {
    this.apply(
      target,
      [`${prefix}height`, `${prefix}height_unit`],
      (a: any, b: any) => {
        const value = `${a}${b}`;
        const style = { height: value };
        if (force) {
          (style as any).minHeight = value;
          (style as any).maxHeight = value;
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

  applyVisibility(target: string) {
    this.apply(target, 'visibility', (a: any) => ({
      visibility: a
    }));
  }

  applyColor(target: string, jsonProp: any, cssProp: any, important = false) {
    this.apply(target, jsonProp, (color: any) => {
      color = `${color === 'transparent' ? color : `#${color}`}`;
      if (important) color = `${color} !important`;
      return { [cssProp]: color };
    });
  }

  applyFontStyles(target: string, placeholder = false) {
    this.apply(target, 'font_weight', (a: any) => ({
      fontWeight: a
    }));
    this.apply(target, 'font_family', (a: any) => ({
      fontFamily: a
    }));
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
        color: `#${a}`
      })
    );

    this.apply(target, ['font_strike', 'font_underline'], (a: any, b: any) => {
      const lines = [];
      if (a) lines.push('line-through');
      if (b) lines.push('underline');
      if (lines.length > 0) return { textDecoration: lines.join(' ') };
    });
  }

  getRichFontStyles(attrs: any) {
    const fontStyles = this._getRichFontScreenStyles(attrs);
    if (this.handleMobile) {
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      fontStyles[mobileBreakpointKey] = this._getRichFontScreenStyles(
        attrs,
        'mobile_'
      );
    }
    if (!('letterSpacing' in fontStyles))
      (fontStyles as any).letterSpacing = 'normal';
    if (!('textTransform' in fontStyles))
      (fontStyles as any).textTransform = 'none';

    return fontStyles;
  }

  _getRichFontScreenStyles(attrs: any, p = '') {
    const styles = {};

    let attr = attrs[`${p}font_size`];
    if (attr) (styles as any).fontSize = `${attr}px`;
    attr = attrs[`${p}font_family`];
    if (attr) (styles as any).fontFamily = attr.replace(/"/g, "'");
    attr = attrs[`${p}font_color`];
    if (attr) (styles as any).color = `#${attr}`;
    attr = attrs[`${p}font_weight`];
    if (attr) (styles as any).fontWeight = attr;
    if (attrs[`${p}font_italic`]) (styles as any).fontStyle = 'italic';
    attr = attrs[`${p}text_transform`];
    if (attr) (styles as any).textTransform = attr;
    attr = attrs[`${p}letter_spacing`];
    if (isNum(attr)) (styles as any).letterSpacing = `${attr}px`;

    const lines = [];
    if (attrs[`${p}font_strike`]) lines.push('line-through');
    if (attrs[`${p}font_underline`]) lines.push('underline');
    if (lines.length > 0) (styles as any).textDecoration = lines.join(' ');

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
      if (styles.selected_placeholder_color) {
        this.apply(
          'placeholderActive',
          'selected_placeholder_color',
          (a: any) => ({
            color: `#${a}`
          })
        );
      }
      // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
      this.apply('field', ['height', 'height_unit'], (a, b) => ({
        paddingTop: `${a / 3}${b}`
      }));
    } else {
      this.setStyle('placeholderFocus', 'display', 'none');
    }
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

      if (!imageUrl) {
        return {};
      }

      const formattedStyles = {
        backgroundImage: `url(${imageUrl})`,
        backgroundRepeat: imageRepeat,
        backgroundPositionX: imageLayout,
        backgroundPositionY: imageVerticalLayout
      };

      switch (imageDisplay) {
        case 'fill':
        case 'fit':
          Object.assign(formattedStyles, {
            backgroundSize: imageSize
          });
          break;
        case 'tile':
          Object.assign(formattedStyles, {
            backgroundSize: `${imageSize}%`
          });
          break;
        case 'set_scale':
          Object.assign(formattedStyles, {
            backgroundSize: `${imageSizeX}px ${imageSizeY}px`
          });
          break;
      }

      return formattedStyles;
    });
  }
}

const noTextSelectStyles = {
  webkitTouchCallout: 'none' /* iOS Safari */,
  webkitUserSelect: 'none' /* Safari */,
  mozUserSelect: 'none' /* Old versions of Firefox */,
  msUserSelect: 'none' /* Internet Explorer / Edge */,
  userSelect: 'none' /* Chrome, Firefox, etc. */
};

const bootstrapStyles = {
  padding: '0.375rem 0.75rem',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out',
  outline: 'none'
};

const imgMaxSizeStyles = {
  // Setting min-height to 0 prevents vertical image overflow
  minHeight: 0,
  objectFit: 'contain',
  maxWidth: '80%',
  maxHeight: '100%'
};

const ERROR_COLOR = '#F42525';

export default ApplyStyles;
export { bootstrapStyles, imgMaxSizeStyles, noTextSelectStyles, ERROR_COLOR };
