import type { StoryTheme } from './tokens';

// Every mapping below takes a partial theme and only emits the style keys whose
// tokens are set. With a full preset that is every key; layered over styles
// fetched from the backend, it is only the tokens a story's controls changed.
type Tokens = Partial<StoryTheme>;
type Styles = Record<string, any>;

// Feathery stores colors as hex without the leading '#', optionally with an
// alpha byte. The renderer prefixes '#' itself.
export const hex = (color: string) => color.replace(/^#/, '').toUpperCase();

// Some field code checks the alpha byte of background_color, so field
// backgrounds carry an explicit opaque one.
const opaque = (color: string) => {
  const h = hex(color);
  return h.length === 6 ? `${h}FF` : h;
};

const when = <T>(value: T | undefined, map: (value: T) => Styles): Styles =>
  value === undefined ? {} : map(value);

const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];

// Color and width are separate tokens, so each is emitted on its own. A
// fetched border keeps its pattern; a preset has none, so it gets 'solid'.
export function borders(
  color: string | undefined,
  width: number | undefined,
  prefix = ''
): Styles {
  const styles: Styles = {};
  SIDES.forEach((side) => {
    if (color !== undefined) {
      styles[`${prefix}border_${side}_color`] = hex(color);
      styles[`${prefix}border_${side}_pattern`] = 'solid';
    }
    if (width !== undefined) styles[`${prefix}border_${side}_width`] = width;
  });
  return styles;
}

export function corners(radius: number | undefined): Styles {
  return when(radius, (r) =>
    Object.fromEntries(CORNERS.map((corner) => [`corner_${corner}_radius`, r]))
  );
}

/**
 * Rich-text attributes for a text_formatted op. Button and text elements take
 * their font from here rather than from `styles`. `weight` is only emitted
 * when given, so a fetched element keeps its own.
 */
export function textAttributes(
  theme: Tokens,
  options: { color?: string; scale?: number; weight?: number } = {}
): Styles {
  const { scale = 1, weight } = options;
  // Passing color, even as undefined, opts out of the textColor default: a
  // button's label follows onPrimaryColor and nothing else.
  const color = 'color' in options ? options.color : theme.textColor;
  return {
    ...when(color, (c) => ({ font_color: hex(c) })),
    ...when(theme.fontSize, (size) => ({
      font_size: Math.round(size * scale)
    })),
    ...when(theme.fontFamily, (family) => ({ font_family: family })),
    ...when(weight, (w) => ({ font_weight: w }))
  };
}

export function buttonStyles(theme: Tokens): Styles {
  return {
    ...when(theme.primaryColor, (c) => ({ background_color: hex(c) })),
    ...when(theme.controlHeight, (h) => ({ height: h, height_unit: 'px' })),
    ...borders(theme.primaryColor, theme.borderWidth),
    ...corners(theme.borderRadius)
  };
}

// A preset renders without any backend defaults beneath it, so it has to
// supply the keys the renderer reads unguarded.
export const PRESET_BASE_STYLES: Record<string, Styles> = {
  button: { flex_direction: 'row', text_align: 'center' },
  text: { horizontal_align: 'flex-start' },
  progress_bar: { percent_text_layout: 'top' },
  button_group: {
    flex_direction: 'column',
    text_align: 'center',
    vertical_align: 'center',
    horizontal_align: 'flex-start',
    gap: 8,
    button_width: 120,
    button_width_unit: 'px',
    content_responsive: false,
    image_width: 32,
    image_width_unit: 'px'
  },
  file_upload: {
    height: 120,
    height_unit: 'px',
    flex_direction: 'column',
    image_width: 36,
    image_width_unit: 'px',
    image_margin_bottom: 8
  },
  signature: { height: 140, height_unit: 'px' },
  audio_recording: {
    height: 44,
    height_unit: 'px',
    flex_direction: 'row',
    image_width: 20,
    image_width_unit: 'px',
    image_margin_right: 8
  }
};

function fieldFont(theme: Tokens): Styles {
  return {
    ...when(theme.textColor, (c) => ({
      font_color: hex(c),
      label_font_color: hex(c)
    })),
    ...when(theme.fontSize, (size) => ({
      font_size: size,
      label_font_size: Math.round(size * 0.9)
    })),
    ...when(theme.fontFamily, (family) => ({
      font_family: family,
      label_font_family: family
    }))
  };
}

export function textFieldStyles(theme: Tokens): Styles {
  return {
    ...fieldFont(theme),
    ...when(theme.placeholderColor, (c) => ({ placeholder_color: hex(c) })),
    ...when(theme.surfaceColor, (c) => ({ background_color: opaque(c) })),
    ...when(theme.controlHeight, (h) => ({ height: h, height_unit: 'px' })),
    ...borders(theme.borderColor, theme.borderWidth),
    ...borders(theme.primaryColor, theme.borderWidth, 'hover_'),
    ...borders(
      theme.primaryColor,
      theme.borderWidth === undefined
        ? undefined
        : Math.max(theme.borderWidth, 2),
      'selected_'
    ),
    ...corners(theme.borderRadius)
  };
}

export function checkboxStyles(theme: Tokens): Styles {
  return {
    ...fieldFont(theme),
    // A single checkbox's label sits inline, so match the field's font
    ...when(theme.fontSize, (size) => {
      const box = Math.round(size * 1.2);
      return {
        label_font_size: size,
        height: box,
        height_unit: 'px',
        width: box,
        width_unit: 'px'
      };
    }),
    ...when(theme.surfaceColor, (c) => ({ background_color: opaque(c) })),
    // selected_font_color paints the checkmark
    ...when(theme.onPrimaryColor, (c) => ({ selected_font_color: hex(c) })),
    ...when(theme.primaryColor, (c) => ({
      selected_background_color: hex(c)
    })),
    ...borders(theme.borderColor, theme.borderWidth),
    ...borders(theme.primaryColor, theme.borderWidth, 'hover_'),
    ...borders(theme.primaryColor, theme.borderWidth, 'selected_'),
    ...corners(
      theme.borderRadius === undefined
        ? undefined
        : Math.min(theme.borderRadius, 6)
    )
  };
}

export function progressBarStyles(theme: Tokens): Styles {
  return {
    ...when(theme.primaryColor, (c) => ({ bar_color: hex(c) })),
    ...when(theme.textColor, (c) => ({ font_color: hex(c) })),
    ...when(theme.fontSize, (size) => ({
      font_size: Math.round(size * 0.85)
    })),
    ...when(theme.fontFamily, (family) => ({ font_family: family })),
    ...corners(theme.borderRadius)
  };
}

// Radio and checkbox groups size their inputs from the font, so they take the
// checkbox's colors without its explicit box size
export function choiceGroupStyles(theme: Tokens): Styles {
  const { height, width, height_unit, width_unit, ...styles } =
    checkboxStyles(theme);
  return styles;
}

// Fields drawn as a bordered panel rather than an input: signature pad, file
// upload, audio recorder, QR scanner, custom component
export function panelFieldStyles(theme: Tokens): Styles {
  return {
    ...fieldFont(theme),
    ...when(theme.surfaceColor, (c) => ({ background_color: opaque(c) })),
    ...borders(theme.borderColor, theme.borderWidth),
    ...borders(theme.primaryColor, theme.borderWidth, 'hover_'),
    ...borders(theme.primaryColor, theme.borderWidth, 'selected_'),
    ...corners(theme.borderRadius)
  };
}

export function buttonGroupStyles(theme: Tokens): Styles {
  return {
    ...fieldFont(theme),
    ...when(theme.surfaceColor, (c) => ({ background_color: opaque(c) })),
    ...when(theme.controlHeight, (h) => ({
      button_height: h,
      button_height_unit: 'px'
    })),
    ...when(theme.primaryColor, (c) => ({
      selected_background_color: hex(c)
    })),
    ...when(theme.onPrimaryColor, (c) => ({ selected_font_color: hex(c) })),
    ...when(theme.primaryColor, (c) => ({ hover_font_color: hex(c) })),
    ...borders(theme.borderColor, theme.borderWidth),
    ...borders(theme.primaryColor, theme.borderWidth, 'hover_'),
    ...borders(theme.primaryColor, theme.borderWidth, 'selected_'),
    ...corners(theme.borderRadius)
  };
}

export function sliderStyles(theme: Tokens): Styles {
  return {
    ...fieldFont(theme),
    // background_color paints both the handle and the filled track
    ...when(theme.primaryColor, (c) => ({ background_color: hex(c) })),
    ...when(theme.controlHeight, (h) => {
      const handle = Math.round(h / 2);
      return {
        height: handle,
        height_unit: 'px',
        ...corners(handle)
      };
    })
  };
}

export function ratingStyles(theme: Tokens): Styles {
  return {
    ...fieldFont(theme),
    // Unselected icons take the border color, selected ones the primary
    ...when(theme.borderColor, (c) => ({ background_color: hex(c) })),
    ...when(theme.primaryColor, (c) => ({
      selected_background_color: hex(c),
      hover_background_color: hex(c)
    }))
  };
}

export function colorPickerStyles(theme: Tokens): Styles {
  return {
    ...fieldFont(theme),
    ...when(theme.controlHeight, (h) => ({ height: h, height_unit: 'px' })),
    ...borders(theme.borderColor, theme.borderWidth),
    ...corners(theme.borderRadius)
  };
}

export function tabsStyles(theme: Tokens): Styles {
  return {
    ...when(theme.textColor, (c) => ({ font_color: hex(c) })),
    ...when(theme.fontSize, (size) => ({ font_size: size })),
    ...when(theme.fontFamily, (family) => ({ font_family: family })),
    ...when(theme.surfaceColor, (c) => ({ background_color: hex(c) })),
    ...when(theme.primaryColor, (c) => ({
      selected_background_color: hex(c),
      hover_font_color: hex(c)
    })),
    ...when(theme.onPrimaryColor, (c) => ({ selected_font_color: hex(c) })),
    ...when(theme.controlHeight, (h) => ({ height: h, height_unit: 'px' })),
    ...borders(theme.borderColor, theme.borderWidth),
    ...borders(theme.primaryColor, theme.borderWidth, 'selected_'),
    ...corners(theme.borderRadius)
  };
}

export function imageStyles(theme: Tokens): Styles {
  return corners(theme.borderRadius);
}
