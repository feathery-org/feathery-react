import { isNum } from '../utils/primitives';
import { isDirectionColumn } from '../utils/styles';

export const mobileBreakpointValue = 478;

export const mobileBreakpointKey = `@media (max-width: ${mobileBreakpointValue}px)`;

/**
 * Handles the translation of server-side properties into responsive CSS
 * attributes
 */
class ApplyStyles {
  constructor(element, targets, handleMobile) {
    this.element = element;
    this.styles = element.styles;
    this.targets = Object.fromEntries(targets.map((t) => [t, {}]));
    this.handleMobile = handleMobile;
    if (handleMobile) {
      this.mobileStyles = element.mobile_styles;
      this.mobileTargets = Object.fromEntries(targets.map((t) => [t, {}]));
    }
  }

  addTargets(...targets) {
    targets.forEach((target) => {
      this.targets[target] = {};
      if (this.handleMobile) this.mobileTargets[target] = {};
    });
  }

  // Return CSS for a particular target HTML element
  getTarget(targetId, desktopOnly = false) {
    const target = { ...this.targets[targetId] };
    if (!desktopOnly && this.handleMobile) {
      target[mobileBreakpointKey] = this.mobileTargets[targetId];
    }
    return target;
  }

  getTargets(...targets) {
    let targetStyles = {};
    targets.forEach((targetId) => {
      if (!targetId) return;
      targetStyles = { ...targetStyles, ...this.targets[targetId] };
      if (this.handleMobile)
        targetStyles[mobileBreakpointKey] = {
          ...targetStyles[mobileBreakpointKey],
          ...this.mobileTargets[targetId]
        };
    });
    return targetStyles;
  }

  setStyle(target, key, val) {
    this.targets[target][key] = val;
  }

  // Translate a set of server-side properties into CSS for a particular
  // target
  apply(target, properties, get) {
    if (!this.styles) return;
    // if not array, assume user passed in 1 element
    if (!Array.isArray(properties)) properties = [properties];
    const styles = properties.map((p) => this.styles[p]);
    this.targets[target] = { ...this.targets[target], ...get(...styles) };

    if (this.handleMobile) {
      let mobileStyles = properties.map((p) => this.mobileStyles[p]);
      // If no mobile overrides, don't set breakpoint style
      if (mobileStyles.every((s) => s === undefined)) return;
      // Fall back to default style if a mobile style doesn't exist
      mobileStyles = properties.map((p) => {
        const ms = this.mobileStyles[p];
        return ms !== undefined ? ms : this.styles[p];
      });
      this.mobileTargets[target] = {
        ...this.mobileTargets[target],
        ...get(...mobileStyles)
      };
    }
  }

  applyFlexAndTextAlignments(target, prefix = '') {
    this.applyFlexDirection(target, prefix);
    this.applyTextAlign(target, prefix);
  }

  applyFlexDirection(target, prefix = '') {
    this.apply(target, `${prefix}flex_direction`, (a) => ({
      flexDirection: a
    }));
  }

  // Text align needs to be applied on the opposite axis from the flex
  // direction, which specifies the icon position relative to the text, so that
  // text align behaves as expected when the flex direction is vertical (a
  // column)
  applyTextAlign(target, prefix = '') {
    this.apply(target, `${prefix}text_align`, (a) => ({
      [isDirectionColumn(this.styles[`${prefix}flex_direction`])
        ? 'alignItems'
        : 'justifyContent']: a
    }));
  }

  applyBorders(target, prefix = '', important = true) {
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
      (a, b, c, d) => ({ borderColor: `#${a} #${b} #${c} #${d} ${i}` })
    );
    this.apply(
      target,
      [
        `${prefix}border_top_width`,
        `${prefix}border_right_width`,
        `${prefix}border_bottom_width`,
        `${prefix}border_left_width`
      ],
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
      (a, b, c, d) => ({ borderStyle: `${a} ${b} ${c} ${d} ${i}` })
    );
  }

  applySelectorStyles(target, prefix) {
    this.applyBorders(target, prefix);
    if (this.styles[`${prefix}background_color`]) {
      this.applyColor(
        target,
        `${prefix}background_color`,
        'backgroundColor',
        true
      );
    }
    if (this.styles[`${prefix}font_color`]) {
      this.applyColor(target, `${prefix}font_color`, 'color', true);
    }
  }

  applyPadding(target, prefix = '', margin = false) {
    this.apply(
      target,
      [
        `${prefix}padding_top`,
        `${prefix}padding_right`,
        `${prefix}padding_bottom`,
        `${prefix}padding_left`
      ],
      (a, b, c, d) => ({
        [margin ? 'margin' : 'padding']: `${a}px ${b}px ${c}px ${d}px`
      })
    );
  }

  applyMargin(target, prefix = '') {
    this.apply(
      target,
      [
        `${prefix}margin_top`,
        `${prefix}margin_right`,
        `${prefix}margin_bottom`,
        `${prefix}margin_left`
      ],
      (a, b, c, d) => ({
        margin: `${a}px ${b}px ${c}px ${d}px`
      })
    );
  }

  applyCorners(target) {
    this.apply(
      target,
      [
        'corner_top_left_radius',
        'corner_top_right_radius',
        'corner_bottom_right_radius',
        'corner_bottom_left_radius'
      ],
      (a, b, c, d) => ({
        borderRadius: `${a}px ${b}px ${c}px ${d}px`
      })
    );
  }

  applyBoxShadow(target) {
    this.apply(
      target,
      [
        'shadow_x_offset',
        'shadow_y_offset',
        'shadow_blur_radius',
        'shadow_color'
      ],
      (a, b, c, d) => ({
        boxShadow: `${a}px ${b}px ${c}px #${d}`
      })
    );
  }

  applyHeight(target, prefix = '', force = false) {
    this.apply(target, [`${prefix}height`, `${prefix}height_unit`], (a, b) => {
      const value = `${a}${b}`;
      const style = { height: value };
      if (force) {
        style.minHeight = value;
        style.maxHeight = value;
      }
      return style;
    });
  }

  applyWidth(target, prefix = '', force = false) {
    this.apply(target, [`${prefix}width`, `${prefix}width_unit`], (a, b) => {
      const value = `${a}${b}`;
      const style = { width: value };
      if (force) {
        style.minWidth = value;
        style.maxWidth = value;
      }
      return style;
    });
  }

  applyVisibility(target) {
    this.apply(target, 'visibility', (a) => ({
      visibility: a
    }));
  }

  applyColor(target, jsonProp, cssProp, important = false) {
    this.apply(target, jsonProp, (color) => {
      color = `${color === 'transparent' ? color : `#${color}`}`;
      if (important) color = `${color} !important`;
      return { [cssProp]: color };
    });
  }

  applyFontStyles(target, placeholder = false) {
    this.apply(target, 'font_weight', (a) => ({ fontWeight: a }));
    this.apply(target, 'font_family', (a) => ({ fontFamily: a }));
    this.apply(target, 'font_size', (a) => ({ fontSize: `${a}px` }));
    this.apply(target, 'line_height', (a) => ({
      lineHeight: isNum(a) ? `${a}px` : 'normal'
    }));
    this.apply(target, 'letter_spacing', (a) => ({
      letterSpacing: isNum(a) ? `${a}px` : 'normal'
    }));
    this.apply(target, 'text_transform', (a) => ({
      textTransform: a || 'none'
    }));
    this.apply(
      target,
      placeholder ? 'placeholder_italic' : 'font_italic',
      (a) => ({ fontStyle: a ? 'italic' : 'normal' })
    );
    this.apply(
      target,
      placeholder ? 'placeholder_color' : 'font_color',
      (a) => ({ color: `#${a}` })
    );

    this.apply(target, ['font_strike', 'font_underline'], (a, b) => {
      const lines = [];
      if (a) lines.push('line-through');
      if (b) lines.push('underline');
      if (lines.length > 0) return { textDecoration: lines.join(' ') };
    });
  }

  getRichFontStyles(attrs) {
    const fontStyles = this._getRichFontScreenStyles(attrs);
    if (this.handleMobile) {
      fontStyles[mobileBreakpointKey] = this._getRichFontScreenStyles(
        attrs,
        'mobile_'
      );
    }
    return fontStyles;
  }

  _getRichFontScreenStyles(attrs, p = '') {
    const styles = {};

    let attr = attrs[`${p}font_size`];
    if (attr) styles.fontSize = `${attr}px`;
    attr = attrs[`${p}font_family`];
    if (attr) styles.fontFamily = attr.replace(/"/g, "'");
    attr = attrs[`${p}font_color`];
    if (attr) styles.color = `#${attr}`;
    attr = attrs[`${p}font_weight`];
    if (attr) styles.fontWeight = attr;
    if (attrs[`${p}font_italic`]) styles.fontStyle = 'italic';
    attr = attrs[`${p}text_transform`];
    styles.textTransform = attr || 'none';
    attr = attrs[`${p}letter_spacing`];
    styles.letterSpacing = isNum(attr) ? `${attr}px` : 'normal';

    const lines = [];
    if (attrs[`${p}font_strike`]) lines.push('line-through');
    if (attrs[`${p}font_underline`]) lines.push('underline');
    if (lines.length > 0) styles.textDecoration = lines.join(' ');

    return styles;
  }

  applyPlaceholderStyles(type, styles) {
    this.addTargets('placeholder', 'placeholderActive', 'placeholderFocus');
    this.applyFontStyles('placeholder', true);
    this.apply('placeholder', 'font_size', (a) => ({
      lineHeight: `${a}px`
    }));
    if (type !== 'text_area') {
      this.apply('placeholder', 'font_size', (a) => ({
        marginTop: `-${a / 2}px`
      }));
    }
    if (styles.placeholder_transition === 'shrink_top') {
      this.apply('placeholderFocus', 'font_size', (a) => {
        const minFontSize = Math.min(a, 10);
        return {
          top: 0,
          marginTop: `${minFontSize / 2}px`,
          fontSize: `${minFontSize}px`
        };
      });
      if (styles.selected_placeholder_color) {
        this.apply('placeholderActive', 'selected_placeholder_color', (a) => ({
          color: `#${a}`
        }));
      }
      this.apply('field', ['height', 'height_unit'], (a, b) => ({
        paddingTop: `${a / 3}${b}`
      }));
    } else {
      this.setStyle('placeholderFocus', 'display', 'none');
    }
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

export default ApplyStyles;
export { bootstrapStyles, imgMaxSizeStyles, noTextSelectStyles };
