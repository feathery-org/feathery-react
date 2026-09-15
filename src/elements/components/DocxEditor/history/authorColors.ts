// Stable per-actor colours (Google-Docs style): the same person is the same
// colour in every version and session. Drives the History panel's avatar dots
// and the highlight renderer's washes. The first human editor is orange,
// Robin is Feathery red, and later human editors use stable palette colours.

export const CURRENT_USER_COLOR = '#f97316'; // orange — first human editor
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

interface VersionWithActor {
  seq: number;
  authors: Array<{ kind: string }>;
  actor_label?: string;
  actor_name?: string;
}

/** The oldest surviving human editor in this document's version history. */
export function firstUserActorKey(versions: VersionWithActor[]): string {
  const ordered = [...versions].sort((a, b) => a.seq - b.seq);
  for (const version of ordered) {
    if (!version.authors?.some((author) => author.kind === 'user')) continue;
    const key = version.actor_label || version.actor_name;
    if (key) return key;
  }
  return '';
}

/** The colour for one author's dot / wash. Robin is always red; the first
 *  human editor is orange, and later identified editors use a deterministic
 *  palette colour. An unresolved browser-local 'you' is orange. */
export function colorForAuthor(
  author: AuthorLike,
  firstUserKey?: string
): string {
  if (author.kind === 'assistant') return ASSISTANT_COLOR;
  const identity = author.key || author.label || '';
  if (author.kind === 'user' && (identity === 'you' || identity === '')) {
    return CURRENT_USER_COLOR;
  }
  if (author.label === 'You') return CURRENT_USER_COLOR;
  if (
    author.kind === 'user' &&
    firstUserKey &&
    identity.toLowerCase() === firstUserKey.toLowerCase()
  )
    return CURRENT_USER_COLOR;
  return AUTHOR_PALETTE[fnv1a(identity) % AUTHOR_PALETTE.length];
}

// A version's synthetic revisions carry a browser-local key ('you' | 'robin');
// formatting changes prefix it with 'fmt:'. A saved actor key resolves "you"
// to the same stable identity the History avatar uses.
const FMT_PREFIX = 'fmt:';
export function colorForRevisionAuthor(
  author: string,
  versionActorKey?: string,
  firstUserKey?: string
): string {
  let key = author || '';
  if (key.startsWith(FMT_PREFIX)) key = key.slice(FMT_PREFIX.length);
  // Robin is the assistant no matter how the author was spelled: the diff uses
  // the key 'robin', but a live tracked change carries the document author
  // string 'Robin' (ASSISTANT_DOCUMENT_AUTHOR). Match case-insensitively so the
  // assistant's edits always get the brand red, never a palette colour.
  const kind = key.toLowerCase() === 'robin' ? 'assistant' : 'user';
  if (kind === 'user' && key.toLowerCase() === 'you' && versionActorKey) {
    key = versionActorKey;
  }
  return colorForAuthor({ kind, key, label: key }, firstUserKey);
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
