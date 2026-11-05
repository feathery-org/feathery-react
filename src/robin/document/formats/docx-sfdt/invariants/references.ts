/**
 * Style and list references: a named style a format entry the change set introduced or newly
 * references must exist in the document's styles, and a list it points at must exist in its
 * lists. The editor silently falls back to Normal for an unknown style.
 */
import type { DocumentView, Invariant } from '../../../pack';
import type { NfNode } from '../../../tree';
import { refusal } from './common';

const REF_KEYS = ['style', 'markStyle', 'listStyle'];
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function known(view: DocumentView) {
  const styles = new Set(
    (
      (view.nf.root.styles as Array<Record<string, unknown>> | undefined) ?? []
    ).map((s) => String(s.name))
  );
  const lists = new Set(
    (
      (view.nf.root.lists as Array<Record<string, unknown>> | undefined) ?? []
    ).map((l) => Number(l.listId))
  );
  return { styles, lists };
}

export const styleReferences: Invariant = {
  name: 'unknown-style',
  cards: ['paragraph'],
  check({ before, after, changed, created }) {
    const { styles, lists } = known(after);
    const bad: Array<{ id: string; styleName?: string; listId?: number }> = [];
    for (const id of [...changed, ...created]) {
      const n = after.get(id) as NfNode | undefined;
      if (!n) continue;
      const old = before.get(id);
      for (const key of REF_KEYS) {
        const ref = n[key];
        if (typeof ref !== 'string' || (old && old[key] === ref)) continue;
        const entry = after.nf.formats[ref] ?? {};
        if (typeof entry.styleName === 'string' && !styles.has(entry.styleName))
          bad.push({ id, styleName: entry.styleName });
        const list = isObject(entry.listFormat)
          ? entry.listFormat.listId
          : undefined;
        if (typeof list === 'number' && list >= 0 && !lists.has(list))
          bad.push({ id, listId: list });
      }
    }
    if (!bad.length) return [];
    return [
      refusal(
        'unknown-style',
        `the change references style(s) or list(s) the document does not have: ${bad
          .map(
            (b) =>
              `${b.id} ${
                b.styleName !== undefined
                  ? `style "${b.styleName}"`
                  : `list ${b.listId}`
              }`
          )
          .join('; ')}.`,
        bad,
        ['paragraph'],
        `Use a named style the document has: ${[...styles]
          .slice(0, 30)
          .join(', ')}.`
      )
    ];
  }
};
