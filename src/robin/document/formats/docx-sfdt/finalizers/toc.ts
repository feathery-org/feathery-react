/**
 * The table of contents, reported: the editor rebuilds a TOC field after every change set (the
 * `toc` seam), and this pass says what the rebuild lists, by the headings the virtual document holds
 * after the change: how many entries, how many came and went. Pages are the editor's layout's and
 * are never predicted here. It changes nothing.
 */
import type { Finalizer } from '../../../pack';
import { tocField, tocSources } from '../toc';

/** How many of `of` are not matched one for one in `against`. */
function unmatched(of: string[], against: string[]): number {
  const left = new Map<string, number>();
  for (const t of against) left.set(t, (left.get(t) ?? 0) + 1);
  let out = 0;
  for (const t of of) {
    const n = left.get(t) ?? 0;
    if (n) left.set(t, n - 1);
    else out += 1;
  }
  return out;
}

export const tocFinalizer: Finalizer = {
  name: 'toc',
  run(after) {
    const toc = tocField(after);
    if (!toc) return { ids: [] };
    const ids = toc.paragraphs.map((p) => p.id);
    const listed = tocSources(after, toc).map((s) => s.text);
    if (!listed.length)
      return {
        ids: [],
        facts: [
          {
            kind: 'finalizer',
            name: 'toc',
            ids,
            summary: `table of contents not refreshed: no paragraph in the styles it lists (${[
              ...toc.styles
            ].join(', ')}) has text, so it stays as it is`
          }
        ]
      };
    return {
      ids,
      facts: [
        {
          kind: 'finalizer',
          name: 'toc',
          ids,
          summary: `table of contents refreshed: ${
            listed.length
          } entries, ${unmatched(listed, toc.entries)} added, ${unmatched(
            toc.entries,
            listed
          )} removed`
        }
      ]
    };
  }
};
