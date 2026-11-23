/**
 * Derived content: what the editor rebuilds after every change (a table of contents' entries and
 * page numbers) is never written. A change, removal or creation strictly inside a TOC field (between
 * its begin and end marks) is refused; the model edits the headings, and the contents follows. A
 * title before the field or text after it in the same paragraph is the document's to edit, and the
 * whole field may go.
 */
import type { Invariant } from '../../../pack';
import { viewToc } from '../toc';
import { refusal } from './common';

export const derivedContent: Invariant = {
  name: 'derived-content',
  cards: ['field'],
  check({ before, after, changed, removed, created }) {
    const was = viewToc(before);
    const now = viewToc(after);
    // the whole field removed: the document no longer has a contents, which is the model's to do
    if (was && !now && [...was.ids].every((id) => !after.get(id))) return [];
    const hit = [
      ...[...changed, ...removed].filter((id) => was?.ids.has(id)),
      ...[...created].filter((id) => now?.ids.has(id))
    ];
    if (!hit.length) return [];
    return [
      refusal(
        'derived-content',
        `the change writes inside the table of contents (${hit
          .slice(0, 6)
          .join(', ')}${
          hit.length > 6 ? ` and ${hit.length - 6} more` : ''
        }), whose entries and page numbers the editor derives from the headings.`,
        hit.map((id) => ({ id })),
        ['field'],
        'the table of contents is refreshed from the headings after your change; edit the headings'
      )
    ];
  }
};
