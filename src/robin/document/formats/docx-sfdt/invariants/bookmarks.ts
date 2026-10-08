/**
 * Bookmark pairs (WP1 F7, F8; WP2 failure class 7): every bookmark that was a start and end pair
 * stays one, and no name gains a second start. The editor silently drops an orphaned end on
 * accept, and a duplicated name loses its start.
 */
import type { DocumentView, Invariant } from '../../../pack';
import { KIND } from '../adapter/keys';
import { refusal } from './common';

function pairs(
  view: DocumentView
): Map<string, { starts: string[]; ends: string[] }> {
  const out = new Map<string, { starts: string[]; ends: string[] }>();
  for (const n of view.nodes()) {
    if (n.kind !== KIND.bookmark || typeof n.name !== 'string') continue;
    const entry = out.get(n.name) ?? { starts: [], ends: [] };
    (n.bookmarkType === 0 ? entry.starts : entry.ends).push(n.id);
    out.set(n.name, entry);
  }
  return out;
}

export const bookmarkPairs: Invariant = {
  name: 'bookmark-pair-broken',
  cards: ['bookmark'],
  check({ before, after }) {
    const was = pairs(before);
    const now = pairs(after);
    const broken: Array<{ name: string; starts: string[]; ends: string[] }> =
      [];
    for (const [name, e] of now) {
      const old = was.get(name);
      const intact = (x?: { starts: string[]; ends: string[] }) =>
        !!x && x.starts.length === 1 && x.ends.length === 1;
      if (!intact(e) && (intact(old) || !old)) broken.push({ name, ...e });
    }
    if (!broken.length) return [];
    return [
      refusal(
        'bookmark-pair-broken',
        `bookmark(s) would be left unpaired or duplicated: ${broken
          .map(
            (b) =>
              `${b.name} (${b.starts.length} start(s) ${b.starts.join(', ')}; ${
                b.ends.length
              } end(s) ${b.ends.join(', ')})`
          )
          .join('; ')}.`,
        broken,
        ['bookmark'],
        'Keep each bookmark start with its end: move, copy or delete both together, and give a copied bookmark a new name or leave it out of the copy.'
      )
    ];
  }
};
