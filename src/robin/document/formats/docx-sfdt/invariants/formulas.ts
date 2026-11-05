/**
 * Orphaned dependents (WP2 failure class 1): a change set that leaves a formula reading a value it
 * removes is refused, naming every dependent with its expression, so the model can rewrite or
 * unbind them in the same write. The product's own `analyzeBindingOrphans` decides; nothing here
 * re-implements reference resolution.
 */
import { analyzeBindingOrphans } from '../../../../../elements/components/DocxEditor/bindings/core/tableDeleteImpact';
import {
  collectRefs,
  parseExpression
} from '../../../../../elements/components/DocxEditor/bindings/core/formula';
import type { Invariant } from '../../../pack';
import { bindingState } from '../features/binding';
import { refusal } from './common';

export const orphanedDependents: Invariant = {
  name: 'orphaned-dependents',
  cards: ['binding', 'formula'],
  check({ before, after }) {
    const b = bindingState(before.nf);
    const a = bindingState(after.nf);
    const orphans = analyzeBindingOrphans(b.native, a.native);
    if (!orphans.length) return [];
    const readable = new Set(a.result.index.occurrences.map((o) => o.name));
    const detail = orphans.map((orphan) => {
      const occurrences = a.result.index.occurrences.filter(
        (o) => o.def.kind === 'formula' && o.name === orphan.name
      );
      const expr =
        occurrences[0]?.def.kind === 'formula'
          ? occurrences[0].def.expression
          : '';
      let refs: string[] = [];
      try {
        refs = collectRefs(parseExpression(expr));
      } catch {
        refs = [];
      }
      return {
        name: orphan.name,
        ids: occurrences.map((o) => a.nodeAt(o.path)?.id).filter(Boolean),
        expr,
        reads: refs.filter(
          (r) => !readable.has(r) && !readable.has(r.split('.')[0])
        )
      };
    });
    return [
      refusal(
        'orphaned-dependents',
        `${
          detail.length
        } formula(s) would be left reading values this change removes: ${detail
          .map(
            (d) =>
              `${d.name} (${d.ids.join(', ')}) = ${d.expr}${
                d.reads.length ? `, which reads ${d.reads.join(', ')}` : ''
              }`
          )
          .join('; ')}.`,
        detail,
        ['binding', 'formula'],
        "Either leave what they read in place, or in the same write rewrite each listed formula's `expr` so it no longer reads the removed values, or unbind it (`binding: null` on that control) so its current text stays as plain text. Only unbind when the request means the value should stop being live."
      )
    ];
  }
};
