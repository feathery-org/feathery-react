/**
 * Derived content: what the editor rebuilds after every change (a table of contents' entries and
 * page numbers) is never written. A change, removal or creation inside a TOC field's paragraphs is
 * refused; the model edits the headings, and the contents follows.
 */
import type { Invariant } from '../../../pack';
import { tocField } from '../toc';
import { refusal } from './common';

export const derivedContent: Invariant = {
  name: 'derived-content',
  cards: ['field'],
  check({ before, after, changed, removed, created }) {
    const was = tocField(before.nf);
    const now = tocField(after.nf);
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
