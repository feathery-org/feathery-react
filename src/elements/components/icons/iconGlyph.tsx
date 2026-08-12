import React, { createElement } from 'react';
import { objectFromEntries } from '../../../utils/primitives';

// Render persisted Tabler geometry without a runtime icon dependency.

export interface IconGlyphData {
  variant?: 'outline' | 'filled';
  nodes: [string, Record<string, string | number>][];
}

const VIEWBOX = '0 0 24 24';
const OUTLINE_STROKE_WIDTH = 2;

// Form properties are untrusted, so SVG tags and attributes are allowlisted.
const SAFE_TAG = 'path';

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

export function hasIconGlyph(glyph?: IconGlyphData | null): boolean {
  return safeNodes(glyph).length > 0;
}

interface IconGlyphProps {
  glyph?: IconGlyphData | null;
  size?: string | number;
  'aria-label'?: string;
  role?: React.AriaRole;
  style?: React.CSSProperties;
}

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
