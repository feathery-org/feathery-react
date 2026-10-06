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
    const { family, weight } = splitFontWeight(name);
    if (!family || SYSTEM_FONTS.has(family.toLowerCase())) return;
    let set = out.get(family);
    if (!set) {
      set = new Set();
      out.set(family, set);
    }
    set.add(bold ? Math.max(weight, 700) : weight);
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
