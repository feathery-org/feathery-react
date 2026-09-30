import type { BackendTheme } from '../backend/backendForm';
import {
  buttonStyles,
  checkboxStyles,
  progressBarStyles,
  textFieldStyles
} from './toFeatheryStyles';

// How each story's element is styled: which element of a backend form it is
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
// when the backend form lacks the exact type.
const TEXT_INPUT_TYPES = [
  'text_field',
  'email',
  'integer_field',
  'url',
  'ssn',
  'phone_number'
];

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

export const progressBarStyling = {
  kind: 'progress_bar' as const,
  fromBackend: (theme: BackendTheme) => theme.progressBar,
  tokens: progressBarStyles
};
