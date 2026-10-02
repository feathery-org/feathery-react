/** @jsxImportSource react */
// The manager is bundled apart from the stories, without emotion's css prop,
// so it uses React's JSX runtime rather than tsconfig's @emotion/react.
import React, { useEffect, useState } from 'react';
import { addons, types, useGlobals } from 'storybook/manager-api';
import { Select } from 'storybook/internal/components';
import { PaintBrushIcon } from '@storybook/icons';
import { themePresets } from '../stories/theme/tokens';
import {
  BACKEND_THEME,
  backendConfig,
  listThemes,
  ThemeSummary,
  toolbarValueFor
} from '../stories/backend/themeApi';

const ADDON_ID = 'feathery/theme';

// The theme picker. A native globalTypes toolbar needs its items up front,
// but the backend's themes are only known once fetched, so this lists the
// presets, the .env.local theme, then every theme in the API key's org.
function ThemePicker() {
  const [globals, updateGlobals] = useGlobals();
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listThemes()
      .then(setThemes)
      .catch((e) => setError(e?.message ?? String(e)));
  }, []);

  const envTheme =
    themes.find(({ id }) => id === backendConfig.theme)?.name ??
    backendConfig.theme;
  const options = [
    ...Object.keys(themePresets).map((name) => ({
      value: name,
      title: name,
      description: 'Preset'
    })),
    {
      value: BACKEND_THEME,
      title: 'backend',
      description: envTheme
        ? `.env.local theme: ${envTheme}`
        : '.env.local theme: the org’s first'
    },
    ...themes.map(({ id, name }) => ({
      value: toolbarValueFor(id),
      title: name,
      description: 'Backend theme'
    }))
  ];

  return (
    <Select
      // Select only reads defaultOptions on mount, so remount it when the
      // theme changes elsewhere (the URL, a story's globals) or the list loads
      key={`${globals.theme}|${themes.length}`}
      ariaLabel="Theme"
      tooltip={error ? `Couldn’t list backend themes. ${error}` : 'Theme'}
      icon={<PaintBrushIcon />}
      options={options}
      defaultOptions={[globals.theme ?? 'default']}
      onSelect={(theme) => updateGlobals({ theme })}
    >
      Theme
    </Select>
  );
}

addons.register(ADDON_ID, () => {
  addons.add(`${ADDON_ID}/tool`, {
    type: types.TOOL,
    title: 'Theme',
    render: () => <ThemePicker />
  });
});
