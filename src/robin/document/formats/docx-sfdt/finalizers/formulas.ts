/**
 * Formula recompute: after the changes, the product's binding engine (`applyRules`) computes every
 * formula, and each formula control whose text differs takes the computed text: its first run
 * keeps its id and look, any other run goes, as the editor's own write does.
 */
import type { Finalizer } from '../../../pack';
import type { NfNode } from '../../../tree';
import { KIND } from '../adapter/keys';
import { computeBindingState } from '../features/binding';

function setControlText(control: NfNode, text: string): string[] {
  const host = Array.isArray(control.inlines)
    ? control
    : ((control.blocks as NfNode[] | undefined) ?? []).find(
        (b) => b.kind === KIND.paragraph
      );
  if (!host) return [];
  const inlines = (host.inlines as NfNode[] | undefined) ?? [];
  const first = inlines.find((i) => i.kind === KIND.run);
  if (
    first &&
    first.text === text &&
    inlines.filter((i) => i.kind === KIND.run).length === 1
  )
    return [];
  const run: NfNode = first
    ? { ...first, text }
    : ({ kind: KIND.run, text } as unknown as NfNode);
  host.inlines = [run];
  return [
    control.id,
    ...(host !== control ? [host.id] : []),
    ...(first ? [first.id] : [])
  ];
}

export const formulasFinalizer: Finalizer = {
  name: 'formulas',
  run(after) {
    const state = computeBindingState(after);
    const ids = new Set<string>();
    let recomputed = 0;
    for (const write of state.result.writes) {
      if (write.kind !== 'formula') continue;
      for (const occurrence of state.result.index.occurrences.filter(
        (o) => o.tag === write.tag
      )) {
        const control = state.nodeAt(occurrence.path);
        if (!control || control.kind !== KIND.control) continue;
        const changed = setControlText(control, write.text);
        if (changed.length) recomputed += 1;
        changed.forEach((id) => ids.add(id));
      }
    }
    const list = [...ids];
    return {
      ids: list,
      facts: recomputed
        ? [
            {
              kind: 'finalizer',
              name: 'formulas',
              ids: list,
              summary: `${recomputed} formula value(s) recomputed`
            }
          ]
        : []
    };
  }
};
