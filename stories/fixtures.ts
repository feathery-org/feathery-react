// Minimal element payloads, shaped like what the Feathery API sends for a step.
// Only the properties the rendered components read are filled in. Ids stay
// fixed so a restyle re-renders an element instead of remounting it.
import type { Styling } from './theme/storyHelpers';
import { FIELD_SPECS } from './fieldCatalog';

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
    metadata = {},
    maxLength,
    properties = {}
  }: {
    key: string;
    label?: string;
    placeholder?: string;
    required?: boolean;
    metadata?: Styles;
    maxLength?: number;
    properties?: Styles;
  },
  styling: Styling
) {
  return {
    id: `story-${key}`,
    type: 'field',
    styles: styling.styles,
    mobile_styles: styling.mobileStyles,
    properties: { placeholder, ...properties },
    servar: {
      id: `servar-${key}`,
      key,
      type,
      name: label,
      required,
      max_length: maxLength,
      metadata
    }
  };
}

/** A field of any servar type, filled in from its FIELD_SPECS entry */
export function specFieldElement(
  type: string,
  overrides: { key?: string; label?: string; required?: boolean },
  styling: Styling
) {
  const { label, placeholder, metadata, maxLength, properties } =
    FIELD_SPECS[type];
  return fieldElement(
    type,
    {
      key: `story_${type}`,
      label,
      placeholder,
      metadata,
      maxLength,
      properties,
      ...overrides
    },
    styling
  );
}

export function imageElement(styling: Styling, sourceImage?: string) {
  return {
    id: 'story-image',
    type: 'image',
    styles: styling.styles,
    mobile_styles: styling.mobileStyles,
    properties: { source_image: sourceImage, alt_text: 'Theme preview' }
  };
}

export function videoElement(styling: Styling, sourceUrl?: string) {
  return {
    id: 'story-video',
    type: 'video',
    styles: styling.styles,
    mobile_styles: styling.mobileStyles,
    properties: { source_url: sourceUrl }
  };
}

export const TAB_ENTRIES = ['Overview', 'Details', 'History'].map(
  (label) => ({
    id: `tab-${label.toLowerCase()}`,
    label,
    step_key: `step-${label.toLowerCase()}`
  })
);

export function tabsElement(
  styling: Styling,
  direction: 'horizontal' | 'vertical' = 'horizontal'
) {
  return {
    id: 'story-tabs',
    type: 'tab',
    styles: styling.styles,
    mobile_styles: styling.mobileStyles,
    properties: { entries: TAB_ENTRIES, direction }
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
