// Resolve a slide's theme fonts. Most PPTX runs carry NO explicit font — they
// inherit the theme's major (headings) / minor (body) font, or reference it via
// the "+mj-lt" / "+mn-lt" tokens. Defaulting such text to Arial is wrong; it
// should use the deck's theme font.

import { child, descendant, getAttr, root as xmlRoot } from '../opc/xml';
import type { Deck } from './types';

export interface ThemeFonts {
  major: string;
  minor: string;
}

const cache = new WeakMap<Deck['pkg'], Map<string, ThemeFonts>>();

function themePartFor(deck: Deck, slidePath: string): string {
  const pkg = deck.pkg;
  const layout = pkg.layoutFor(slidePath);
  const master = layout && pkg.masterFor(layout);
  return (
    (master && pkg.relTargetByType(master, 'theme')) || 'ppt/theme/theme1.xml'
  );
}

export function themeFonts(deck: Deck, slidePath: string): ThemeFonts {
  const pkg = deck.pkg;
  const part = themePartFor(deck, slidePath);
  let m = cache.get(pkg);
  if (!m) {
    m = new Map();
    cache.set(pkg, m);
  }
  const hit = m.get(part);
  if (hit) return hit;

  const fonts: ThemeFonts = { major: 'Helvetica', minor: 'Helvetica' };
  try {
    if (pkg.hasPart(part)) {
      const scheme = descendant(xmlRoot(pkg.tree(part)), 'a:fontScheme');
      const majLatin =
        scheme && child(child(scheme, 'a:majorFont')!, 'a:latin');
      const minLatin =
        scheme && child(child(scheme, 'a:minorFont')!, 'a:latin');
      if (majLatin) fonts.major = getAttr(majLatin, 'typeface') || fonts.major;
      if (minLatin) fonts.minor = getAttr(minLatin, 'typeface') || fonts.minor;
    }
  } catch {
    /* keep fallback */
  }
  m.set(part, fonts);
  return fonts;
}

/** Resolve a run's font: undefined or a "+mj/+mn" token -> the theme font; else the literal. */
export function resolveFont(
  font: string | undefined,
  fonts: ThemeFonts
): string {
  if (!font) return fonts.minor;
  if (font.startsWith('+mj')) return fonts.major;
  if (font.startsWith('+mn')) return fonts.minor;
  return font;
}
