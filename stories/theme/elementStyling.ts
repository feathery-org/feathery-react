import type { BackendTheme } from '../backend/backendForm';
import {
  buttonGroupStyles,
  buttonStyles,
  checkboxStyles,
  choiceGroupStyles,
  colorPickerStyles,
  imageStyles,
  PRESET_BASE_STYLES,
  panelFieldStyles,
  progressBarStyles,
  ratingStyles,
  sliderStyles,
  tabsStyles,
  textFieldStyles
} from './toFeatheryStyles';

// How each story's element is styled: which element of the backend theme it is
// modelled on, and how theme tokens map onto it. Shared by the single-element
// stories and the showcase so the two can't drift apart.

export const buttonStyling = {
  kind: 'button' as const,
  fromBackend: (theme: BackendTheme) => theme.button,
  tokens: buttonStyles,
  text: { color: (t: any) => t.onPrimaryColor, weight: 600 }
};

export const TEXT_VARIANTS = {
  heading: { scale: 2, weight: 700 },
  subheading: { scale: 1.3, weight: 600 },
  body: { scale: 1, weight: 400 },
  caption: { scale: 0.8, weight: 400 }
};

export const textStyling = (variant: keyof typeof TEXT_VARIANTS) => ({
  kind: 'text' as const,
  fromBackend: (theme: BackendTheme) =>
    variant === 'heading' || variant === 'subheading'
      ? theme.heading
      : theme.body,
  tokens: () => ({}),
  text: TEXT_VARIANTS[variant]
});

// These all render through TextField, so any of them can stand in for another
// when the backend theme lacks the exact type.
const TEXT_INPUT_TYPES = [
  'text_field',
  'email',
  'integer_field',
  'url',
  'ssn',
  'phone_number'
];

// Not TextField, but drawn as the same bordered input box, so they borrow a
// text input's styles when the backend theme lacks their own
const INPUT_BOX_TYPES = [
  'text_area',
  'password',
  'dropdown',
  'dropdown_multi',
  'gmap_line_1',
  'gmap_city',
  'gmap_state',
  'gmap_country',
  'gmap_zip',
  'date_selector',
  'pin_input',
  'payment_method'
];

const PANEL_TYPES = [
  'signature',
  'file_upload',
  'audio_recording',
  'qr_scanner',
  'custom'
];

const FIELD_TOKENS: Record<string, typeof textFieldStyles> = {
  checkbox: checkboxStyles,
  select: choiceGroupStyles,
  multiselect: choiceGroupStyles,
  matrix: choiceGroupStyles,
  button_group: buttonGroupStyles,
  slider: sliderStyles,
  rating: ratingStyles,
  hex_color: colorPickerStyles,
  ...Object.fromEntries(PANEL_TYPES.map((type) => [type, panelFieldStyles]))
};

/** Any servar type: the backend theme's styles for it, or preset tokens */
export const fieldStyling = (type: string) => {
  const textInput = TEXT_INPUT_TYPES.includes(type);
  const inputBox = textInput || INPUT_BOX_TYPES.includes(type);
  return {
    kind: type in PRESET_BASE_STYLES ? type : undefined,
    fromBackend: (theme: BackendTheme) =>
      theme.fields[type] ??
      (inputBox
        ? TEXT_INPUT_TYPES.map((t) => theme.fields[t]).find(Boolean)
        : undefined),
    tokens: (theme: Parameters<typeof textFieldStyles>[0]) => ({
      ...(FIELD_TOKENS[type] ?? textFieldStyles)(theme),
      // A text area is several lines tall
      ...(type === 'text_area' && { height: 120, height_unit: 'px' })
    })
  };
};

export const textFieldStyling = (type: string) => ({
  fromBackend: (theme: BackendTheme) =>
    theme.fields[type] ??
    TEXT_INPUT_TYPES.map((t) => theme.fields[t]).find(Boolean),
  tokens: textFieldStyles
});

// Radio and checkbox groups size their inputs from the font, while a single
// checkbox takes explicit dimensions, so only a real checkbox will do.
export const checkboxStyling = {
  fromBackend: (theme: BackendTheme) => theme.fields.checkbox,
  tokens: checkboxStyles
};

export const imageStyling = {
  fromBackend: (theme: BackendTheme) => theme.elements.image,
  tokens: imageStyles
};

export const videoStyling = {
  fromBackend: (theme: BackendTheme) => theme.elements.video,
  tokens: () => ({ height: 220, height_unit: 'px' })
};

export const tabsStyling = {
  fromBackend: (theme: BackendTheme) => theme.elements.tab,
  tokens: tabsStyles
};

export const progressBarStyling = {
  kind: 'progress_bar' as const,
  fromBackend: (theme: BackendTheme) => theme.progressBar,
  tokens: progressBarStyles
};
