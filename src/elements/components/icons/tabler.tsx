import React, { useEffect, useState } from 'react';

// Tabler icons persisted as export names (e.g. "IconHeart") by the dashboard.
// The icon module is huge (~5,900 glyphs) so it is only pulled in via a lazy
// dynamic import the first time a form actually renders an icon.

const ICON_EXPORT_PREFIX = 'Icon';

let tablerModule: Record<string, any> | null = null;
let tablerPromise: Promise<Record<string, any>> | null = null;

export function isTablerIconName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > ICON_EXPORT_PREFIX.length &&
    name.startsWith(ICON_EXPORT_PREFIX)
  );
}

export function loadTablerIcons(): Promise<Record<string, any>> {
  if (!tablerPromise) {
    tablerPromise = import('@tabler/icons-react')
      .then((mod) => {
        tablerModule = mod as Record<string, any>;
        return tablerModule;
      })
      .catch((err) => {
        // Allow a later retry rather than caching a rejected promise forever.
        tablerPromise = null;
        throw err;
      });
  }
  return tablerPromise;
}

interface TablerGlyphProps {
  /** Tabler export name, e.g. "IconHeart". */
  name: string;
  /** Width/height of the glyph; defaults to 1em so it tracks font size. */
  size?: string | number;
  'aria-label'?: string;
  style?: React.CSSProperties;
}

/**
 * Renders a Tabler glyph by persisted name. Color is driven by CSS
 * `currentColor` (never hardcoded), so the wrapper's resolved `color` styles
 * the icon. Renders nothing until the icon module has loaded or if the name
 * doesn't resolve to a glyph.
 */
export function TablerGlyph({ name, size = '1em', ...rest }: TablerGlyphProps) {
  const [, setLoaded] = useState(() => tablerModule !== null);

  useEffect(() => {
    if (tablerModule || !isTablerIconName(name)) return;
    let mounted = true;
    loadTablerIcons()
      .then(() => mounted && setLoaded(true))
      .catch(() => {}); // No glyph beats a crashed form
    return () => {
      mounted = false;
    };
  }, [name]);

  if (!isTablerIconName(name)) return null;
  const Component = tablerModule?.[name];
  if (!Component) return null;
  return <Component size={size} stroke={2} {...rest} />;
}
