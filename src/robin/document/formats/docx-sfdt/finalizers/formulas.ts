/**
 * Formula recompute and field fan-out: after the changes, the product's binding engine
 * (`applyRules`, given the values before the change so it can tell what was edited) computes every
 * formula, carries an edited field's value to its other occurrences, and re-renders field values in
 * their type's display; each control whose text differs takes the engine's text: its first run
 * keeps its id and look, any other run goes, as the editor's own write does.
 */
import type { FactDetail } from '../../../envelope';
import type { Finalizer } from '../../../pack';
import type { NfNode } from '../../../tree';
import { KIND } from '../adapter/keys';
import { bindingState, computeBindingState } from '../features/binding';
import { revisionsIn } from '../adapter/revisions';
import { arr } from '../util';

/**
 * Write a bound control's text as the editor's own write does: its first run keeps its id and look
 * and takes the text, the other runs go, and every other inline (a bookmark end, a field) stays
 * where it was. Returns the ids changed, empty when the control already reads `text`.
 */
export function setControlText(control: NfNode, text: string): string[] {
  const host = Array.isArray(control.inlines)
    ? control
    : arr<NfNode>(control.blocks).find((b) => b.kind === KIND.paragraph);
  if (!host) return [];
  const inlines = arr<NfNode>(host.inlines);
  // a run pending deletion is another card's: it stays where it is and is not the control's text
  const deleted = (i: NfNode) =>
    revisionsIn(i.pending).some((r) => r.kind === 'Deletion');
  const runs = inlines.filter((i) => i.kind === KIND.run && !deleted(i));
  const first = runs[0];
  if (first && first.text === text && runs.length === 1) return [];
  const run: NfNode = first
    ? { ...first, text }
    : ({ kind: KIND.run, text } as unknown as NfNode);
  const out: NfNode[] = [];
  let placed = false;
  for (const inline of inlines) {
    if (inline.kind !== KIND.run || deleted(inline)) out.push(inline);
    else if (!placed) {
      out.push(run);
      placed = true;
    }
  }
  if (!placed) out.push(run);
  host.inlines = out;
  return [
    control.id,
    ...(host !== control ? [host.id] : []),
    ...(first ? [first.id] : [])
  ];
}

/** The text a bound control reads now: its runs that are not pending deletion, in order. */
function controlText(control: NfNode): string {
  const host = Array.isArray(control.inlines)
    ? control
    : arr<NfNode>(control.blocks).find((b) => b.kind === KIND.paragraph);
  return arr<NfNode>(host?.inlines)
    .filter(
      (i) =>
        i.kind === KIND.run &&
        !revisionsIn(i.pending).some((r) => r.kind === 'Deletion')
    )
    .map((i) => String(i.text ?? ''))
    .join('');
}

/** At most this many values are named in the summary; the detail lists them all. */
const NAMED_IN_SUMMARY = 6;

export const formulasFinalizer: Finalizer = {
  name: 'formulas',
  run(after, { before }) {
    const state = computeBindingState(
      after,
      // the document before is a settled view: its state is cached
      bindingState(before.nf).result.values
    );
    const ids = new Set<string>();
    // every control whose text this pass wrote: the value it derived, by node, before and after
    const detail: FactDetail[] = [];
    for (const write of state.result.writes) {
      for (const occurrence of state.result.index.occurrences.filter(
        (o) => o.tag === write.tag
      )) {
        const control = state.nodeAt(occurrence.path);
        if (!control || control.kind !== KIND.control) continue;
        const changed = setControlText(control, write.text);
        if (!changed.length) continue;
        changed.forEach((id) => ids.add(id));
        const name = (control.binding as { name?: unknown } | undefined)?.name;
        // before is what the control read before the write (review finding 5); a control the
        // write created read nothing before
        const was = before.get(control.id);
        detail.push({
          id: control.id,
          ...(typeof name === 'string' ? { name } : {}),
          ...(was ? { before: controlText(was) } : {}),
          after: controlText(control)
        });
      }
    }
    // a formula the write itself created (a copied row's line total) is the engine's value too, even
    // where the copy already read it
    for (const occurrence of state.result.index.occurrences) {
      const control = state.nodeAt(occurrence.path);
      if (!control || control.kind !== KIND.control || before.get(control.id))
        continue;
      const binding = control.binding as
        | { name?: unknown; expr?: unknown }
        | undefined;
      if (typeof binding?.expr !== 'string') continue;
      if (detail.some((d) => d.id === control.id)) continue;
      // in the fact's ids too, with no before (review finding 7)
      ids.add(control.id);
      detail.push({
        id: control.id,
        ...(typeof binding.name === 'string' ? { name: binding.name } : {}),
        after: controlText(control)
      });
    }
    const list = [...ids];
    const named = detail
      .slice(0, NAMED_IN_SUMMARY)
      .map(
        (d) =>
          `${d.name ?? 'value'} ${d.id}: ${JSON.stringify(
            d.before
          )} to ${JSON.stringify(d.after)}`
      );
    const more =
      detail.length > NAMED_IN_SUMMARY
        ? `; and ${detail.length - NAMED_IN_SUMMARY} more in detail`
        : '';
    return {
      ids: list,
      facts: detail.length
        ? [
            {
              kind: 'finalizer',
              name: 'formulas',
              ids: list,
              summary: `${
                detail.length
              } bound value(s) recomputed, carried or re-rendered: ${named.join(
                '; '
              )}${more}`,
              detail
            }
          ]
        : []
    };
  }
};
