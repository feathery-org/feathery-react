/**
 * Binding consistency: the change set introduces no error the product's binding engine reports
 * (a duplicated table or column, a conflicting definition, a dependency cycle, a malformed
 * expression or tag, a formula that cannot evaluate, a row binding outside its table), and a bound
 * table's control holds exactly one table (WP2 failure class 3: a second table put inside an
 * existing bound table's control loses its identity).
 */
import type { Invariant } from '../../../pack';
import type { NfNode } from '../../../tree';
import { KIND } from '../adapter/keys';
import { bindingState } from '../features/binding';
import { refusal } from './common';

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export const bindingConsistency: Invariant = {
  name: 'binding',
  cards: ['binding'],
  check({ before, after }) {
    const problems = [];
    const keyed = (nf: typeof before.nf) => {
      const state = bindingState(nf);
      return new Map(
        state.result.diagnostics
          .filter((d) => d.severity === 'error')
          .map((d) => [
            `${d.code}:${state.nodeAt(d.path)?.id ?? JSON.stringify(d.path)}`,
            {
              code: d.code,
              message: d.message,
              id: state.nodeAt(d.path)?.id ?? null
            }
          ])
      );
    };
    const was = keyed(before.nf);
    const now = keyed(after.nf);
    // a formula that fails only because what it read was removed is orphaned-dependents' to report
    const fresh = [...now]
      .filter(([k, d]) => !was.has(k) && d.code !== 'evaluation-failed')
      .map(([, d]) => d);
    if (fresh.length)
      problems.push(
        refusal(
          'binding',
          `the change would break bindings: ${fresh
            .map((d) => `${d.code}${d.id ? ` at ${d.id}` : ''}: ${d.message}`)
            .join('; ')}.`,
          fresh,
          ['binding'],
          'Give each new binding a name unique in its scope, a new bound table its own table id, and an expression that reads names the document has.'
        )
      );
    const crowded = after
      .nodes()
      .filter(
        (n) =>
          n.kind === KIND.control &&
          isObject(n.binding) &&
          n.binding.table !== undefined
      )
      .filter(
        (n) =>
          ((n.blocks as NfNode[] | undefined) ?? []).filter(
            (b) => b.kind === KIND.table
          ).length > 1
      );
    if (crowded.length)
      problems.push(
        refusal(
          'binding',
          `bound table control(s) ${crowded
            .map((n) => n.id)
            .join(
              ', '
            )} would hold more than one table; the extra table would take the first table's identity.`,
          crowded.map((n) => ({
            id: n.id,
            table: (n.binding as Record<string, unknown>).table
          })),
          ['binding', 'table'],
          'Place a new bound table in its own block-level control with its own `table` id, beside the existing one, not inside it.'
        )
      );
    return problems;
  }
};
