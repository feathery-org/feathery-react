/**
 * Formula recompute and field fan-out: after the changes, the product's binding engine
 * (`applyRules`, given the values before the change so it can tell what was edited) computes every
 * formula, carries an edited field's value to its other occurrences, and re-renders field values in
 * their type's display; each control whose text differs takes the engine's text: its first run
 * keeps its id and look, any other run goes, as the editor's own write does.
 */
import type { Finalizer } from '../../../pack';
import type { NfNode } from '../../../tree';
import { KIND } from '../adapter/keys';
import { bindingState, computeBindingState } from '../features/binding';
import { arr } from '../util';

function setControlText(control: NfNode, text: string): string[] {
  const host = Array.isArray(control.inlines)
    ? control
    : arr<NfNode>(control.blocks).find((b) => b.kind === KIND.paragraph);
  if (!host) return [];
  const inlines = arr<NfNode>(host.inlines);
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
  run(after, { before }) {
    const state = computeBindingState(
      after,
      // the document before is a settled view: its state is cached
      bindingState(before.nf).result.values
    );
    const ids = new Set<string>();
    let recomputed = 0;
    for (const write of state.result.writes) {
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
              summary: `${recomputed} bound value(s) recomputed or carried to their other occurrences`
            }
          ]
        : []
    };
  }
};
