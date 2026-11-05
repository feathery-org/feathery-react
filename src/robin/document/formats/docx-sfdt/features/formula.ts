/**
 * The formula feature: a binding with `expr` is a formula the document computes. The model reads
 * its expression and value and never types a number into it; the `formulas` finalizer recomputes
 * every formula after a change. Expressions are parsed by the product's own parser.
 */
import {
  collectRefs,
  parseExpression
} from '../../../../../elements/components/DocxEditor/bindings/core/formula';
import type { FeatureMark } from '../../../pack';
import type { NfNode } from '../../../tree';

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The names a formula expression reads, or null when it does not parse. */
export function formulaReads(expr: unknown): string[] | null {
  if (typeof expr !== 'string') return null;
  try {
    return collectRefs(parseExpression(expr));
  } catch {
    return null;
  }
}

export function bindingMarks(node: NfNode): FeatureMark[] {
  const b = node.binding;
  if (!isObject(b)) return [];
  if (b.table !== undefined)
    return [{ name: 'binding', value: `table:${String(b.table)}` }];
  const marks: FeatureMark[] = [
    { name: 'binding', value: String(b.name ?? '') }
  ];
  if (b.expr !== undefined)
    marks.push({ name: 'formula', value: String(b.name ?? '') });
  return marks;
}
