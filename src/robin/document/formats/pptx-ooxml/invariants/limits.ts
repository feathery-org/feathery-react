import { NOT_XML } from '../../../../../elements/components/PptxEditor/core/opc/xml';
import type { RefusalProblem } from '../../../envelope';
import type { Invariant } from '../../../pack';
import { canonicalJson, type NfNode } from '../../../tree';
import { FRAME, planDeck } from '../reconcile';
import { schemaFor } from '../schema';

function refusal(id: string, why: string): RefusalProblem {
  return {
    invariant: 'limits',
    destroyed: `Nothing was applied: ${id} ${why}`,
    detail: { id },
    retry: 'modified_input',
    read: ['limits']
  };
}

// The positions and sizes a deck can hold, in EMU
const MIN_COORDINATE = -27273042329600;
const MAX_COORDINATE = 27273042316900;

const isFrame = (frame: unknown) => {
  const box = frame as Record<string, number> | undefined;
  return (
    !!box &&
    Object.keys(box).sort().join() === 'cx,cy,x,y' &&
    ['x', 'y', 'cx', 'cy'].every((key) => Number.isInteger(box[key])) &&
    [box.x, box.y].every(
      (at) => at >= MIN_COORDINATE && at <= MAX_COORDINATE
    ) &&
    [box.cx, box.cy].every((size) => size >= 1 && size <= MAX_COORDINATE)
  );
};

/** Formatting written outside what the deck allows, such as a size of 0 */
function invalidValues(old: NfNode | undefined, node: NfNode): string[] {
  const problems: string[] = [];
  for (const spec of schemaFor(node.kind) ?? []) {
    const value = node[spec.name];
    if (value === undefined || value === old?.[spec.name]) continue;
    const problem = spec.validate(value);
    if (problem) problems.push(problem);
  }
  return problems;
}

/** What the editor can build, as its planner says, and values a saved deck can hold */
export const limits: Invariant = {
  name: 'limits',
  cards: ['limits'],
  check({ before, after, changed, created, copies = {} }) {
    const problems = planDeck(before, after, copies).cannot.map(({ id, why }) =>
      refusal(id, why)
    );
    for (const id of [...changed, ...created]) {
      const node = after.get(id);
      if (!node) continue;
      const old = before.get(copies[id] ?? id);
      for (const problem of invalidValues(old, node))
        problems.push(refusal(id, problem));
      if (
        node.frame !== undefined &&
        canonicalJson(old?.frame) !== canonicalJson(node.frame) &&
        !isFrame(node.frame)
      )
        problems.push(refusal(id, `has a frame that is not ${FRAME}`));
      if (
        node.kind === 'run' &&
        (typeof node.text !== 'string' || /[\r\n]/.test(node.text))
      )
        problems.push(
          refusal(
            id,
            'has text that is not one line of text: a line break inside a paragraph is a break run'
          )
        );
      if (NOT_XML.test(String(node.text ?? '')))
        problems.push(
          refusal(
            id,
            'has a control character a deck cannot hold: a line break inside a paragraph is a break run'
          )
        );
      if (Array.isArray(node.paragraphs) && !node.paragraphs.length)
        problems.push(
          refusal(id, 'has no paragraph: a shape with text keeps at least one')
        );
    }
    return problems.slice(0, 8);
  }
};
