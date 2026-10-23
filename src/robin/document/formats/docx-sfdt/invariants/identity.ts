/**
 * Structural identity: a content control holds what its place requires (inlines inside a
 * paragraph, blocks among blocks) and a paragraph holds inlines, so the native document never
 * receives a block the editor would drop on open.
 */
import type { Invariant } from '../../../pack';
import { KIND } from '../adapter/keys';
import { refusal } from './common';

export const controlShape: Invariant = {
  name: 'control',
  cards: ['control'],
  check({ after, created, changed }) {
    const bad = [...created, ...changed]
      .map((id) => after.get(id))
      .filter(
        (n) => n && (n.kind === KIND.control || n.kind === KIND.paragraph)
      )
      .filter((n) => {
        if (n?.kind === KIND.paragraph) return !Array.isArray(n.inlines);
        const key = after.placement(n?.id as string)?.key ?? '';
        const inInlines = key === 'inlines' || key.endsWith('/inlines');
        return inInlines
          ? !Array.isArray(n?.inlines)
          : !Array.isArray(n?.blocks);
      });
    if (!bad.length) return [];
    return [
      refusal(
        'control',
        `control(s) ${bad
          .map((n) => n?.id)
          .join(
            ', '
          )} hold the wrong content for their place: a control inside a paragraph holds inlines, a control among blocks holds blocks, a paragraph holds inlines, empty when it has none.`,
        bad.map((n) => ({ id: n?.id })),
        ['control']
      )
    ];
  }
};
