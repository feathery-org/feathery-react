import { featheryDoc } from '../../../../../utils/browser';
import { themeFonts } from '../model/theme';
import { resolveListProps } from '../model/resolve';
import type { Deck } from '../model/types';

// A trailing weight word is a style, not part of the family name: Google serves
// one family with a weight axis (e.g. "DM Sans Medium" = DM Sans @ 500).
const WEIGHT_WORDS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900
};

// System/fallback faces we never ask Google Fonts for.
const SYSTEM_FONTS = new Set(
  [
    'helvetica',
    'arial',
    'times new roman',
    'times',
    'courier',
    'courier new',
    'georgia',
    'verdana',
    'tahoma',
    'calibri',
    'cambria',
    'segoe ui',
    'sans-serif',
    'serif',
    'monospace'
  ].map((f) => f.toLowerCase())
);

// Google-hosted metric clones for Microsoft fonts browsers usually lack
// (Office keeps them inside its app bundles, so decks fall back to Helvetica,
// whose smaller ascent sits lines visibly higher than PowerPoint). Stacked
// after the real name, so an installed original still wins.
const FONT_SUBSTITUTES: Record<string, string> = {
  calibri: 'Carlito',
  cambria: 'Caladea'
};

export const substituteFamily = (family: string): string | undefined =>
  FONT_SUBSTITUTES[family.trim().toLowerCase()];

/** CSS family list for a resolved PowerPoint face: the face itself, its metric
 * clone when one exists, then the generic fallbacks. */
export function cssFamilyList(family: string): string {
  const sub = substituteFamily(family);
  return `'${family}',${sub ? `'${sub}',` : ''}Helvetica,Arial,sans-serif`;
}

// Per (family|weight) ratio, as a fraction of the em, of the web font's ascent
// that sits ABOVE the cap height beyond a small typographic gap. PowerPoint
// positions the first line by its typographic ascent (~cap height + a little),
// but a web font's line box reserves more space above the caps, so top-anchored
// text renders lower than PowerPoint. Trimming this ratio off the first line's
// top margin lifts it to match. Measured once per font via Canvas; 0 when
// Canvas has no real metrics (jsdom) so SSR/tests are unaffected.
const topLeadingCache = new Map<string, number>();

export function excessTopLeadingRatio(family: string, weight: number): number {
  const key = `${family}|${weight}`;
  const cached = topLeadingCache.get(key);
  if (cached !== undefined) return cached;
  let ratio = 0;
  try {
    const ctx = featheryDoc().createElement('canvas').getContext('2d');
    if (ctx) {
      const EM = 100;
      // Measure through the same stack the text renders with, so a metric
      // clone (Carlito for Calibri) is what gets measured once it loads.
      ctx.font = `${weight} ${EM}px ${cssFamilyList(family)}`;
      const metrics = ctx.measureText('Hg');
      const ascent = metrics.fontBoundingBoxAscent;
      const descent = metrics.fontBoundingBoxDescent;
      const cap = ctx.measureText('H').actualBoundingBoxAscent;
      // GAP is PowerPoint's small space above the caps (~0.1em); keep it so text
      // doesn't hug the very top. Trim only what the web font adds beyond that.
      const GAP = 0.1 * EM;
      // Unitless line-height 1 centers the font's (ascent+descent) content box
      // in a 1em line box, so a tall-metric font (Arial, Carlito) already draws
      // its first baseline higher by the negative half-leading; fold that in or
      // the trim over-lifts and pushes text past the box top.
      const halfLeading = (EM - (ascent + descent)) / 2;
      if (ascent && cap)
        ratio = Math.max(0, (ascent - cap - GAP + halfLeading) / EM);
    }
  } catch {
    /* no canvas (jsdom) -> no trim */
  }
  topLeadingCache.set(key, ratio);
  return ratio;
}

export function splitFontWeight(name: string): {
  family: string;
  weight: number;
} {
  const trimmed = (name || '').trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    const weight = WEIGHT_WORDS[parts[parts.length - 1].toLowerCase()];
    const family = parts.slice(0, -1).join(' ');
    if (weight && family) return { family, weight };
  }
  return { family: trimmed, weight: 400 };
}

// family (lowercased) -> set of weights the deck uses.
function collectFamilyWeights(deck: Deck): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  // bold runs ask CSS for weight 700, so load that real face too (otherwise the
  // browser fakes bold from the 400 weight, which looks lighter than PowerPoint).
  const add = (name: string | undefined, bold = false) => {
    if (!name || name.startsWith('+')) return;
    const split = splitFontWeight(name);
    let family = split.family;
    let weight = bold ? Math.max(split.weight, 700) : split.weight;
    if (!family) return;
    const sub = substituteFamily(family);
    if (sub) {
      // Load the metric clone in the Microsoft face's place. The clones only
      // ship 400/700, so snap to the nearest real face.
      family = sub;
      weight = weight >= 600 ? 700 : 400;
    } else if (SYSTEM_FONTS.has(family.toLowerCase())) return;
    let set = out.get(family);
    if (!set) {
      set = new Set();
      out.set(family, set);
    }
    set.add(weight);
  };
  for (const slide of deck.slides) {
    const tf = themeFonts(deck, slide.path);
    add(tf.major);
    add(tf.minor);
    for (const shape of slide.shapes) {
      // A placeholder's font often lives only in the layout/master style, not on
      // the runs, so collect the inherited default too (cheap no-op otherwise).
      if (shape.text?.paragraphs?.length) {
        const def = resolveListProps(deck, slide, shape, 0).defRPr;
        add(def?.font, def?.bold);
      }
      for (const p of shape.text?.paragraphs ?? []) {
        for (const r of p.runs ?? []) add(r.font, r.bold);
      }
    }
  }
  return out;
}

function googleFontHref(
  family: string,
  weights: number[],
  italic: boolean
): string {
  const sorted = [...new Set(weights)].sort((a, b) => a - b);
  const fam = family.trim().replace(/\s+/g, '+');
  // Italic is requested on its own link: a font with no italic axis fails only
  // that request (its normal weights still load, italic falls back to synthesis),
  // while fonts that do have one (Newsreader, DM Sans) get their true italics.
  const axis = italic
    ? `ital,wght@${sorted.map((w) => `1,${w}`).join(';')}`
    : `wght@${sorted.join(';')}`;
  return `https://fonts.googleapis.com/css2?family=${fam}:${axis}&display=swap`;
}

const injected = new Set<string>();

// Inject Google Fonts <link>s (normal + italic) per family the deck uses. A
// family that isn't on Google Fonts simply fails its stylesheet load and falls
// back to the system stack, so this never blocks rendering.
export function ensureDeckFontsLoaded(deck: Deck): void {
  let doc: Document;
  try {
    doc = featheryDoc();
  } catch {
    return;
  }
  if (!doc?.head) return;
  for (const [family, weights] of collectFamilyWeights(deck)) {
    if (injected.has(family)) continue;
    injected.add(family);
    if (doc.querySelector(`link[data-pptx-font="${family}"]`)) continue;
    for (const italic of [false, true]) {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = googleFontHref(family, [...weights], italic);
      link.dataset.pptxFont = family;
      doc.head.appendChild(link);
    }
  }
}
