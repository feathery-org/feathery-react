/**
 * Property values against the pack's schema (contract 6.3, architecture 5.1a), and format
 * references against the format table.
 *
 * `property-invalid`: an unknown name, a derived property, or a value the schema refuses; the
 * refusal names the kind's schema card (`schema(<kind>)`) and lists the valid names.
 * `format-entry-rejected`: a new format entry with a property the format schema does not define.
 * `unknown-format`: a written node referencing a format id that is neither in the document nor
 * introduced by the write.
 */
import type { RefusalProblem } from '../envelope';
import type { Pack, PropertySpec } from '../pack';
import { formatRefsIn } from '../ids';

import { problem } from './index';

const schemaCard = (kind: string) => `schema(${kind})`;
const FORMAT_CARD = 'schema(format)';

function checkProps(
  specs: readonly PropertySpec[] | null,
  props: Record<string, unknown>,
  where: string,
  card: string,
  invariant: string
): RefusalProblem[] {
  if (!specs)
    return [
      problem(
        invariant,
        `${where} has no properties to set; nothing was applied`,
        {
          read: [card]
        }
      )
    ];
  const byName = new Map(specs.map((s) => [s.name, s]));
  const writable = specs
    .filter((s) => s.class === 'property')
    .map((s) => s.name);
  const issues: Array<{ name: string; reason: string }> = [];
  for (const [name, value] of Object.entries(props)) {
    const spec = byName.get(name);
    if (!spec) issues.push({ name, reason: 'unknown property' });
    else if (spec.class === 'derived')
      issues.push({
        name,
        reason: 'derived: the engine computes it and never accepts it'
      });
    else if (value !== null) {
      const why = spec.validate(value);
      if (why)
        issues.push({
          name,
          reason: `${JSON.stringify(value)} ${why} (${spec.type})`
        });
    }
  }
  if (!issues.length) return [];
  return [
    problem(
      invariant,
      `Nothing was applied: ${issues
        .map((i) => `${i.name} on ${where}: ${i.reason}`)
        .join('; ')}.`,
      {
        detail: { issues, writable },
        read: [card],
        hint: `Writable properties here: ${writable.join(', ') || 'none'}.`
      }
    )
  ];
}

/** `set` props on a node of `kind`. */
export function propertyProblems(
  pack: Pack,
  kind: string,
  props: Record<string, unknown>,
  nodeId: string
): RefusalProblem[] {
  return checkProps(
    pack.properties.schema(kind),
    props,
    `${kind} ${nodeId}`,
    schemaCard(kind),
    'property-invalid'
  );
}

/** `set` props on a shared format entry. */
export function formatPropertyProblems(
  pack: Pack,
  props: Record<string, unknown>,
  formatId: string
): RefusalProblem[] {
  return checkProps(
    pack.properties.formatSchema,
    props,
    `format ${formatId}`,
    FORMAT_CARD,
    'property-invalid'
  );
}

/** New format entries a write introduces under temporary ids. */
export function newFormatProblems(
  pack: Pack,
  formats: Record<string, Record<string, unknown>>
): RefusalProblem[] {
  return Object.entries(formats).flatMap(([key, entry]) =>
    checkProps(
      pack.properties.formatSchema,
      entry,
      `new format ${key}`,
      FORMAT_CARD,
      'format-entry-rejected'
    )
  );
}

/** References in written nodes to formats the document and the write do not have. */
export function unknownFormatProblems(
  pack: Pack,
  written: unknown[],
  known: ReadonlySet<string>
): RefusalProblem[] {
  const unknown = new Set<string>();
  for (const node of written)
    for (const ref of formatRefsIn(node, pack.formatRefKeys))
      if (!known.has(ref)) unknown.add(ref);
  if (!unknown.size) return [];
  return [
    problem(
      'unknown-format',
      `Nothing was applied: the written nodes reference format(s) ${[
        ...unknown
      ].join(
        ', '
      )}, which the document does not have and the write does not introduce.`,
      {
        detail: [...unknown],
        hint: 'Reference a format id read from the document, or introduce the entry under a tmp: id in `formats`.'
      }
    )
  ];
}
