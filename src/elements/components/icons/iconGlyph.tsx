import React, { createElement } from 'react';
import { objectFromEntries } from '../../../utils/primitives';

// Icons chosen in the dashboard are persisted as shape data, not as a reference
// to an icon package, so a form renders the glyph it was authored with forever —
// no dependency to keep in sync, and no icon silently disappearing when the
// upstream set renames or drops an export. It also keeps the whole icon set
// (~4.4MB) out of this bundle.
//
// The shape is the same `[tag, attrs]` pair list Tabler emits, on a 24x24
// viewBox:
//   { variant: 'outline', nodes: [['path', { d: 'M12 5l0 14' }]] }

export interface IconGlyphData {
  /** 'filled' paints with `currentColor`; 'outline' strokes with it. */
  variant?: 'outline' | 'filled';
  nodes: [string, Record<string, string | number>][];
}

const VIEWBOX = '0 0 24 24';
const OUTLINE_STROKE_WIDTH = 2;

// Glyph data arrives through form properties, which the public API and the AI
// builder can both write, so treat it as untrusted: render only geometry
// elements, and only plain SVG attributes. This is why the data is a shape list
// rather than markup — there is no HTML to inject, and an unexpected attribute
// value can at worst draw the wrong lines.
const SAFE_TAG = 'path';

// These are the only attributes emitted by the pinned Tabler node inventory.
// Keeping this an allowlist also excludes references, React event props, and
// arbitrary DOM attributes without relying on a deny list staying complete.
const SAFE_ATTRIBUTES = new Set(['d', 'fill', 'opacity', 'stroke']);
const URL_VALUE = /(?:url\s*\(|\b[a-z][a-z\d+.-]*:)/i;
const MARKUP_VALUE = /[<>]/;
const OPACITY_VALUE = /^(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+)$/;

const isSafePathData = (value: unknown) =>
  typeof value === 'string' &&
  value.trim() !== '' &&
  !URL_VALUE.test(value) &&
  !MARKUP_VALUE.test(value);

const isSafeOpacity = (value: unknown) => {
  if (typeof value === 'number') {
    return isFinite(value) && value >= 0 && value <= 1;
  }
  return typeof value === 'string' && OPACITY_VALUE.test(value);
};

const isSafeAttribute = (name: string, value: unknown) => {
  if (!SAFE_ATTRIBUTES.has(name)) return false;
  if (name === 'd') return isSafePathData(value);
  if (name === 'fill') return value === 'currentColor';
  if (name === 'stroke') return value === 'none';
  return isSafeOpacity(value);
};

function safeNodes(glyph?: IconGlyphData | null) {
  if (!Array.isArray(glyph?.nodes)) return [];
  return (glyph as IconGlyphData).nodes.flatMap((node) => {
    if (!Array.isArray(node)) return [];
    const [tag, attrs] = node;
    if (tag !== SAFE_TAG || !attrs || typeof attrs !== 'object') return [];
    const safeAttrs = objectFromEntries(
      Object.entries(attrs).filter(([name, value]) =>
        isSafeAttribute(name, value)
      )
    );
    if (!isSafePathData(safeAttrs.d)) return [];
    if ('opacity' in safeAttrs && Number(safeAttrs.opacity) === 0) return [];
    return [[tag, safeAttrs] as const];
  });
}

/** True when there is renderable glyph data. */
export function hasIconGlyph(glyph?: IconGlyphData | null): boolean {
  return safeNodes(glyph).length > 0;
}

interface IconGlyphProps {
  glyph?: IconGlyphData | null;
  /** Width/height of the glyph; defaults to 1em so it tracks font size. */
  size?: string | number;
  'aria-label'?: string;
  style?: React.CSSProperties;
}

/**
 * Renders persisted glyph data. Color comes from CSS `currentColor` (never
 * hardcoded), so the wrapper's resolved `color` styles the icon.
 */
export function IconGlyph({ glyph, size = '1em', ...rest }: IconGlyphProps) {
  const nodes = safeNodes(glyph);
  if (!nodes.length) return null;
  const filled = glyph?.variant === 'filled';
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox={VIEWBOX}
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? undefined : OUTLINE_STROKE_WIDTH}
      strokeLinecap='round'
      strokeLinejoin='round'
      {...rest}
    >
      {nodes.map(([tag, attrs], index) =>
        createElement(tag, { key: index, ...attrs })
      )}
    </svg>
  );
}
