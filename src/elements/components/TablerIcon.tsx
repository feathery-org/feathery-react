import React, { useEffect, useState } from 'react';

// Renders a Tabler icon by its export name (e.g. "IconHeart"), the value the
// builder persists on `image_element.properties.icon_source` and on inline
// rich-text icon embeds (`{ insert: { icon } }`).
//
// The full Tabler set is ~5,900 glyphs. To keep it out of the main bundle we
// pull it in with a dynamic import — the same code-splitting pattern this repo
// already uses for form fields (see src/elements/fields/index.tsx) — so the set
// is fetched as a single cached chunk only on forms that actually use an icon.

type IconComponent = React.ComponentType<any>;

let iconModulePromise: Promise<Record<string, IconComponent>> | null = null;
let loadedIcons: Record<string, IconComponent> = {};
let iconModuleLoaded = false;

function isRenderableIcon(value: unknown): value is IconComponent {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object') return false;

  const component = value as { render?: unknown };
  return typeof component.render === 'function';
}

function loadTablerIcons(): Promise<Record<string, IconComponent>> {
  if (!iconModulePromise) {
    iconModulePromise = import(
      /* webpackChunkName: "tabler-icons" */ '@tabler/icons-react'
    )
      .then((mod) => {
        loadedIcons = Object.entries(mod).reduce((icons, [name, value]) => {
          if (name.startsWith('Icon') && isRenderableIcon(value)) {
            icons[name] = value;
          }
          return icons;
        }, {} as Record<string, IconComponent>);
        iconModuleLoaded = true;
        return loadedIcons;
      })
      .catch((err) => {
        // Allow a later retry rather than caching a rejected promise.
        iconModulePromise = null;
        iconModuleLoaded = false;
        throw err;
      });
  }
  return iconModulePromise;
}

interface TablerIconProps {
  name: unknown;
  size?: number | string;
  stroke?: number;
  className?: string;
  [key: string]: any;
}

function TablerIcon({ name, ...props }: TablerIconProps) {
  const [, forceUpdate] = useState(0);
  const iconName = typeof name === 'string' && name.length > 0 ? name : null;
  const Icon = iconName ? loadedIcons[iconName] : undefined;

  useEffect(() => {
    if (!iconName || loadedIcons[iconName] || iconModuleLoaded) return;

    let active = true;
    loadTablerIcons()
      .then(() => {
        if (active) forceUpdate((value) => value + 1);
      })
      .catch(() => {
        /* icon stays unrendered if the chunk fails to load */
      });
    return () => {
      active = false;
    };
  }, [forceUpdate, iconName]);

  if (!Icon) return null;
  // color defaults to currentColor in Tabler, so the glyph inherits the CSS
  // `color` of its container — that is how it follows theme/text color.
  return <Icon aria-hidden {...props} />;
}

export default TablerIcon;
