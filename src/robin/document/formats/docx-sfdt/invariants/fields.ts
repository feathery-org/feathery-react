/**
 * Field triplets: in every story, field begins, separators and ends stay properly nested, as they
 * were before. A broken field corrupts the document on open.
 */
import type { DocumentView, Invariant } from '../../../pack';
import type { NfNode } from '../../../tree';
import { KIND } from '../adapter/keys';
import { refusal } from './common';

/** Ids of field marks that break nesting, story by story (a story is a top-level block list). */
function broken(view: DocumentView): string[] {
  const out: string[] = [];
  const stories = new Map<string, NfNode[]>();
  for (const n of view.nodes()) {
    if (n.kind !== KIND.field) continue;
    // the story is the section plus the list path that leads out of it
    let p = view.placement(n.id);
    let key = '';
    while (p?.parent) {
      if (p.parent.kind === KIND.section) key = `${p.parent.id}/${p.key}`;
      p = view.placement(p.parent.id);
    }
    stories.set(key, [...(stories.get(key) ?? []), n]);
  }
  for (const marks of stories.values()) {
    const open: Array<{ id: string; separated: boolean }> = [];
    for (const m of marks) {
      if (m.fieldType === 0) open.push({ id: m.id, separated: false });
      else if (m.fieldType === 2) {
        const top = open[open.length - 1];
        if (!top || top.separated) out.push(m.id);
        else top.separated = true;
      } else if (m.fieldType === 1) {
        if (!open.length) out.push(m.id);
        else open.pop();
      }
    }
    out.push(...open.map((o) => o.id));
  }
  return out;
}

export const fieldTriplets: Invariant = {
  name: 'field-broken',
  cards: ['field'],
  check({ before, after }) {
    const was = new Set(broken(before));
    const now = broken(after).filter((id) => !was.has(id));
    if (!now.length) return [];
    return [
      refusal(
        'field-broken',
        `field mark(s) ${now.join(
          ', '
        )} would be left without their begin, separator or end.`,
        now.map((id) => ({ id })),
        ['field'],
        'A field is a begin, an optional separator and an end in order; keep all of them together when moving, copying or deleting.'
      )
    ];
  }
};
