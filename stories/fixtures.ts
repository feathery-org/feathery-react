// Minimal element payloads, shaped like what the Feathery API sends for a step.
// Only the properties the rendered components read are filled in. Ids stay
// fixed so a restyle re-renders an element instead of remounting it.
import type { Styling } from './theme/storyHelpers';

type Styles = Record<string, any>;

const textProperties = (text: string, attributes: Styles) => ({
  text,
  text_formatted: [{ insert: text, attributes }]
});

export function buttonElement(text: string, styling: Styling) {
  return {
    id: 'story-button',
    type: 'button',
    styles: styling.styles,
    mobile_styles: styling.mobileStyles,
    properties: {
      ...textProperties(text, styling.textAttributes),
      // A button with no actions renders disabled
      actions: [{ type: 'next' }]
    }
  };
}

export function textElement(text: string, styling: Styling, id = 'story-text') {
  return {
    id,
    type: 'text',
    styles: styling.styles,
    mobile_styles: styling.mobileStyles,
    properties: textProperties(text, styling.textAttributes)
  };
}

export function fieldElement(
  type: string,
  {
    key,
    label,
    placeholder = '',
    required = false,
    metadata = {}
  }: {
    key: string;
    label?: string;
    placeholder?: string;
    required?: boolean;
    metadata?: Styles;
  },
  styling: Styling
) {
  return {
    id: `story-${key}`,
    type: 'field',
    styles: styling.styles,
    mobile_styles: styling.mobileStyles,
    properties: { placeholder },
    servar: {
      key,
      type,
      name: label,
      required,
      metadata
    }
  };
}

export function progressBarElement(progress: number, styling: Styling) {
  return {
    id: 'story-progress',
    type: 'progress_bar',
    styles: styling.styles,
    mobile_styles: styling.mobileStyles,
    properties: { progress }
  };
}
