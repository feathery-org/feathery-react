import React, { createElement } from 'react';

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
const SAFE_TAGS = new Set([
  'path',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'rect'
]);

// Plain attribute names only: letters and dashes. That rejects `xlink:href` and
// friends (no external references), and the deny list covers React props that
// would mean something dangerous or throw.
const ATTRIBUTE_NAME = /^[a-zA-Z][a-zA-Z-]*$/;
const DENIED_ATTRIBUTES = new Set([
  'dangerouslySetInnerHTML',
  'href',
  'key',
  'ref',
  'style'
]);

const isSafeAttribute = (name: string, value: unknown) =>
  ATTRIBUTE_NAME.test(name) &&
  !DENIED_ATTRIBUTES.has(name) &&
  !name.toLowerCase().startsWith('on') &&
  (typeof value === 'string' || typeof value === 'number');

function safeNodes(glyph?: IconGlyphData | null) {
  if (!Array.isArray(glyph?.nodes)) return [];
  return (glyph as IconGlyphData).nodes.flatMap((node) => {
    if (!Array.isArray(node)) return [];
    const [tag, attrs] = node;
    if (!SAFE_TAGS.has(tag) || !attrs || typeof attrs !== 'object') return [];
    const safeAttrs = Object.fromEntries(
      Object.entries(attrs).filter(([name, value]) =>
        isSafeAttribute(name, value)
      )
    );
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
