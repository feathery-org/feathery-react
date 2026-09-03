// Stable per-actor colours (Google-Docs style): the same person is the same
// colour in every version and session. Drives the History panel's avatar dots
// now, and the highlight renderer's washes later. The current viewer is always
// orange and Robin always the Feathery red; everyone else gets a deterministic
// colour from a palette that excludes those two so they never collide.

export const CURRENT_USER_COLOR = '#f97316'; // orange — always the viewer
export const ASSISTANT_COLOR = '#e2626e'; // Feathery red — always Robin

// Eight distinct hues, none orange or red.
export const AUTHOR_PALETTE = [
  '#2563eb',
  '#7c3aed',
  '#0d9488',
  '#ca8a04',
  '#db2777',
  '#4f46e5',
  '#059669',
  '#9333ea'
];

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface AuthorLike {
  kind: string;
  /** Stable identity ('you' for the current viewer); may be absent in list
   *  payloads, where the label carries the identity. */
  key?: string;
  label?: string;
}

/** The colour for one author's dot / wash. Robin is always red; the current
 *  viewer (key 'you', or an unlabelled user) is always orange; anyone else is a
 *  deterministic palette colour keyed by their label/key. */
export function colorForAuthor(author: AuthorLike): string {
  if (author.kind === 'assistant') return ASSISTANT_COLOR;
  const identity = author.key || author.label || '';
  if (author.kind === 'user' && (identity === 'you' || identity === '')) {
    return CURRENT_USER_COLOR;
  }
  if (author.label === 'You') return CURRENT_USER_COLOR;
  return AUTHOR_PALETTE[fnv1a(identity) % AUTHOR_PALETTE.length];
}

/** Two initials for an avatar; Robin renders an icon instead, so this is for
 *  humans. */
export function initialsForAuthor(author: AuthorLike): string {
  const label = (author.label || '').trim();
  if (!label || label === 'You') return 'Y';
  const parts = label.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]);
  return (letters.join('') || label[0]).toUpperCase();
}
