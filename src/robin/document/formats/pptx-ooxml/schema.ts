import { NOT_XML } from '../../../../elements/components/PptxEditor/core/opc/xml';
import type { DocumentView, EffectiveProperty, PropertySpec } from '../../pack';
import type { NfNode } from '../../tree';

const spec = (
  name: string,
  type: string,
  valid: (value: unknown) => boolean
): PropertySpec => ({
  name,
  class: 'property',
  type,
  validate: (value) => (valid(value) ? null : `${name} must be ${type}`)
});

const isBoolean = (value: unknown) => typeof value === 'boolean';

const RUN: readonly PropertySpec[] = [
  spec('bold', 'boolean', isBoolean),
  spec('italic', 'boolean', isBoolean),
  spec('underline', 'boolean', isBoolean),
  spec('strike', 'boolean', isBoolean),
  spec(
    'size',
    'a size in points between 1 and 4000, in hundredths at most',
    (value) =>
      typeof value === 'number' &&
      value >= 1 &&
      value <= 4000 &&
      Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
  ),
  spec(
    'color',
    'a colour #RRGGBB in capitals',
    (value) => typeof value === 'string' && /^#[0-9A-F]{6}$/.test(value)
  ),
  spec(
    'font',
    'a font name',
    (value) =>
      typeof value === 'string' &&
      value.trim().length > 0 &&
      !NOT_XML.test(value)
  )
];

const PARAGRAPH: readonly PropertySpec[] = [
  spec('align', 'one of l, ctr, r, just, justLow, dist, thaiDist', (value) =>
    ['l', 'ctr', 'r', 'just', 'justLow', 'dist', 'thaiDist'].includes(
      value as string
    )
  ),
  spec(
    'level',
    'a list level from 0 to 8',
    (value) =>
      Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 8
  )
];

export function schemaFor(kind: string): readonly PropertySpec[] | null {
  if (kind === 'run' || kind === 'field') return RUN;
  if (kind === 'paragraph') return [...PARAGRAPH, ...RUN];
  return null;
}

/** Own formatting, then what the paragraph takes from the layout, else the editor's default */
export function effective(
  node: NfNode,
  view: DocumentView
): Record<string, EffectiveProperty> {
  const specs = schemaFor(node.kind) ?? [];
  const paragraph =
    node.kind === 'paragraph' ? node : view.placement(node.id)?.parent;
  const inherited =
    (paragraph?.inherited as Record<string, unknown> | undefined) ?? {};
  const out: Record<string, EffectiveProperty> = {};
  for (const { name } of specs) {
    if (node[name] !== undefined)
      out[name] = { value: node[name], source: 'override' };
    else if (inherited[name] !== undefined)
      out[name] = { value: inherited[name], source: 'container' };
    else out[name] = { value: null, source: 'default' };
  }
  return out;
}

const isRunProperty = (name: string) =>
  RUN.some((property) => property.name === name);

/** A run property set on a paragraph reaches every run in it, as formatting a whole line does */
export function setOverride(node: NfNode, name: string, value: unknown): void {
  if (!schemaFor(node.kind)?.some((property) => property.name === name))
    throw new Error(`A ${node.kind} has no property ${name}`);
  if (node.kind === 'paragraph' && isRunProperty(name)) {
    for (const run of node.runs as NfNode[])
      if (run.kind === 'run') setOverride(run, name, value);
    return;
  }
  if (value === null) delete node[name];
  else node[name] = value;
}

const textLength = (run: NfNode) => String(run.text ?? '').length;

/** Formatting set on part of a paragraph: its runs split where the span starts and ends */
export function setOnSpan(
  node: NfNode,
  span: { start: number; end: number },
  _text: string,
  props: Record<string, unknown>
): string | null {
  if (node.kind !== 'paragraph')
    return 'a span is set on a paragraph: copy the id and span from a find hit on it';
  const other = Object.keys(props).filter((name) => !isRunProperty(name));
  if (other.length)
    return `only run properties apply to a span (not ${other.join(
      ', '
    )}); set those on the paragraph`;
  const out: NfNode[] = [];
  let at = 0;
  for (const run of node.runs as NfNode[]) {
    const start = at;
    const end = at + textLength(run);
    at = end;
    const from = Math.max(span.start, start) - start;
    const to = Math.min(span.end, end) - start;
    if (run.kind !== 'run' || to <= from) {
      out.push(run);
      continue;
    }
    const text = String(run.text);
    const piece = (value: string) =>
      ({ ...run, id: undefined, text: value } as unknown as NfNode);
    if (from > 0) out.push({ ...run, text: text.slice(0, from) });
    const covered =
      from > 0
        ? piece(text.slice(from, to))
        : { ...run, text: text.slice(from, to) };
    for (const [name, value] of Object.entries(props))
      setOverride(covered, name, value);
    out.push(covered);
    if (to < text.length) out.push(piece(text.slice(to)));
  }
  node.runs = out;
  return null;
}
