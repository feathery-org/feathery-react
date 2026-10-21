/**
 * Structural identity: a content control holds what its place requires (inlines inside a
 * paragraph, blocks among blocks), so the native document never receives a control the editor
 * would drop on open.
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
      .filter((n) => n && n.kind === KIND.control)
      .filter((n) => {
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
          )} hold the wrong content for their place: a control inside a paragraph holds inlines, a control among blocks holds blocks.`,
        bad.map((n) => ({ id: n?.id })),
        ['control']
      )
    ];
  }
};
