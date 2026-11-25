import type { Finalizer } from '../../../pack';
import { walk, type NfNode } from '../../../tree';
import {
  PARAGRAPH_FORMAT,
  RUN_FORMAT,
  TEXT_BOX_RUN_FORMAT,
  paragraphAt,
  runAt,
  textSources
} from '../textSources';
import { lookOf, tableLayout } from '../tableLayout';
import { leafRuns, pptxTree } from '../tree';

function fillAbsent(
  node: NfNode,
  from: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  let changed = false;
  for (const key of keys)
    if (node[key] === undefined && from[key] !== undefined) {
      node[key] = from[key];
      changed = true;
    }
  return changed;
}

/** New text takes the formatting of the text it continues, as the editor gives it */
export const continueFormatFinalizer: Finalizer = {
  name: 'continue-format',
  run(after, { before, copies = {} }) {
    const ids: string[] = [];
    const origin = (id: string) => copies[id] ?? id;

    // Text written into what was read continues the text around it, a new cell the cell it copies
    function continueText(node: NfNode, old: NfNode): void {
      if (!Array.isArray(old.paragraphs)) return;
      const known = new Set(
        (old.paragraphs as NfNode[]).flatMap((paragraph) => [
          paragraph.id,
          ...(paragraph.runs as NfNode[]).map((run) => run.id),
          ...leafRuns(paragraph).map((run) => run.id)
        ])
      );
      const sources = textSources(old, node, origin);
      (node.paragraphs as NfNode[]).forEach((paragraph, p) => {
        const source = sources.paragraphs[p];
        if (
          !known.has(origin(paragraph.id)) &&
          source !== undefined &&
          fillAbsent(paragraph, paragraphAt(old, source), PARAGRAPH_FORMAT)
        )
          ids.push(paragraph.id);
        leafRuns(paragraph).forEach((run, r) => {
          // A run with no text keeps no formatting
          if (
            known.has(origin(run.id)) ||
            run.kind !== 'run' ||
            run.text === ''
          )
            return;
          const at = sources.runs[p][r];
          if (at && fillAbsent(run, runAt(old, at), RUN_FORMAT))
            ids.push(run.id);
        });
      });
    }

    walk(after.root, pptxTree, ({ node }) => {
      if (node.kind === 'table') {
        const old = before.get(origin(node.id));
        const layout =
          old && tableLayout(old, node, origin, (id) => !!before.get(id));
        if (!old || typeof layout !== 'object') return false;
        (node.rows as NfNode[]).forEach((row, i) =>
          (row.cells as NfNode[]).forEach((cell, j) =>
            continueText(cell, lookOf(old, layout, i, j))
          )
        );
        return false;
      }
      if (!Array.isArray(node.paragraphs)) return;
      const old = before.get(origin(node.id));
      if (!old) {
        // A new text box starts as one run of the editor's own text
        for (const paragraph of node.paragraphs as NfNode[])
          for (const run of leafRuns(paragraph))
            if (
              run.kind === 'run' &&
              fillAbsent(run, TEXT_BOX_RUN_FORMAT, RUN_FORMAT)
            )
              ids.push(run.id);
        return;
      }
      continueText(node, old);
    });
    return { ids };
  }
};
