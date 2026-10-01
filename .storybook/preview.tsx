import React from 'react';
import type { Decorator, Preview } from '@storybook/react-webpack5';
import { themePresets } from '../stories/theme/tokens';
import {
  BACKEND_THEME,
  backendThemeLoader,
  canvasFor,
  globalStylesFor,
  isBackendTheme
} from '../stories/theme/storyHelpers';
import { FormFrame } from '../stories/FormFrame';
import type { BackendTheme } from '../stories/backend/backendForm';

const bannerStyle: React.CSSProperties = {
  font: '12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif',
  padding: '6px 10px',
  borderRadius: 6,
  marginBottom: 24,
  maxWidth: 640
};

// Says where backend styles came from, or why they couldn't be fetched.
function BackendBanner({
  theme,
  error
}: {
  theme?: BackendTheme;
  error?: string;
}) {
  if (error) {
    return (
      <div style={{ ...bannerStyle, background: '#FEE2E2', color: '#7F1D1D' }}>
        <strong>Backend theme unavailable.</strong> {error} Showing the default
        preset.
      </div>
    );
  }
  if (!theme) return null;
  const found = [
    theme.button && 'button',
    theme.heading && 'heading',
    theme.body && 'body text',
    theme.progressBar && 'progress bar',
    `${Object.keys(theme.fields).length} field types`
  ].filter(Boolean);
  return (
    <div style={{ ...bannerStyle, background: '#E0F2FE', color: '#0C4A6E' }}>
      Styles from theme <strong>{theme.themeName}</strong>. Found:{' '}
      {found.join(', ')}. Anything else falls back to the default preset.
    </div>
  );
}

// Paints the canvas in the active theme so dark presets are legible. Reads the
// same theme + args the story does, so a canvasColor override applies too.
// The theme's global styles go on a form root around the story, as a hosted
// form applies them, rather than on the canvas where elements can't see them.
const withThemeCanvas: Decorator = (Story, context) => {
  const backend = isBackendTheme(context);
  return (
    <div
      style={{
        background: canvasFor(context),
        padding: 32,
        minHeight: '100vh',
        boxSizing: 'border-box'
      }}
    >
      {backend && (
        <BackendBanner
          theme={context.loaded?.backendTheme}
          error={context.loaded?.backendError}
        />
      )}
      <FormFrame globalStyles={globalStylesFor(context)}>
        <Story />
      </FormFrame>
    </div>
  );
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme the stories are styled with',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          ...Object.keys(themePresets),
          { value: BACKEND_THEME, title: 'backend (from .env.local theme)' }
        ],
        dynamicTitle: true
      }
    }
  },
  initialGlobals: { theme: 'default' },
  loaders: [backendThemeLoader],
  decorators: [withThemeCanvas],
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true, sort: 'requiredFirst' }
  }
};

export default preview;
