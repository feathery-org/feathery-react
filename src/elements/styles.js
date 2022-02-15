import { isNum } from '../utils/primitives';

const mobileIndices = {
  gridColumnStart: 'mobile_column_index',
  gridColumnEnd: 'mobile_column_index_end',
  gridRowStart: 'mobile_row_index',
  gridRowEnd: 'mobile_row_index_end'
};

export const mobileBreakpointKey = '@media (max-width: 478px)';

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

  // Return CSS for the step dimensions / layout
  getLayout() {
    const layout = {
      gridColumnStart: this.element.column_index + 1,
      gridRowStart: this.element.row_index + 1,
      gridColumnEnd: this.element.column_index_end + 2,
      gridRowEnd: this.element.row_index_end + 2
    };

    if (
      this.handleMobile &&
      Object.values(mobileIndices).some((index) => isNum(this.element[index]))
    ) {
      const mobileLayout = {};
      Object.entries(mobileIndices).forEach(([key, i]) => {
        let mVal = parseInt(this.element[i]);
        if (isNaN(mVal)) mobileLayout[key] = layout[key];
        else {
          if (['gridColumnEnd', 'gridRowEnd'].includes(key)) {
            mVal += 2;
          } else mVal++;
          mobileLayout[key] = mVal;
        }
      });
      layout[mobileBreakpointKey] = mobileLayout;
    }

    return layout;
  }

  addTargets(...targets) {
    targets.forEach((target) => {
      this.targets[target] = {};
      if (this.handleMobile) this.mobileTargets[target] = {};
    });
  }

  // Return CSS for a particular target HTML element
  getTarget(target, desktopOnly = false) {
    return {
      ...this.targets[target],
      ...(!desktopOnly && this.handleMobile
        ? { [mobileBreakpointKey]: this.mobileTargets[target] }
        : {})
    };
  }

  setStyle(target, key, val) {
    this.targets[target][key] = val;
  }

  // Translate a set of server-side properties into CSS for a particular
  // target
  apply(target, properties, get) {
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

  applyBorders(target, prefix = '', important = true) {
    // If color isn't defined on one of the sides, that means there's no border
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

  applyPadding(target, margin = false) {
    this.apply(
      target,
      ['padding_top', 'padding_right', 'padding_bottom', 'padding_left'],
      (a, b, c, d) => ({
        [margin ? 'margin' : 'padding']: `${a}px ${b}px ${c}px ${d}px`
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

  applyHeight(target, force = false) {
    this.apply(target, ['height', 'height_unit'], (a, b) => {
      const value = `${a}${b}`;
      const style = { height: value };
      if (force) {
        style.minHeight = value;
        style.maxHeight = value;
      }
      return style;
    });
  }

  applyWidth(target, force = false) {
    this.apply(target, ['width', 'width_unit'], (a, b) => {
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

    let name = `${p}font_size`;
    if (attrs[name]) styles.fontSize = `${attrs[name]}px`;
    name = `${p}font_family`;
    if (attrs[name]) styles.fontFamily = attrs[name].replace(/"/g, "'");
    name = `${p}font_color`;
    if (attrs[name]) styles.color = `#${attrs[name]}`;
    name = `${p}font_weight`;
    if (attrs[name]) styles.fontWeight = attrs[name];
    if (attrs[`${p}font_italic`]) styles.fontStyle = 'italic';

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

const bootstrapStyles = {
  padding: '0.375rem 0.75rem',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out',
  outline: 'none'
};

export default ApplyStyles;
export { bootstrapStyles };
