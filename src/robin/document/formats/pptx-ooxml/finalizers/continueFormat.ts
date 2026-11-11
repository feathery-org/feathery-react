import type { Finalizer } from '../../../pack';
import { walk, type NfNode } from '../../../tree';
import {
  PARAGRAPH_FORMAT,
  RUN_FORMAT,
  TEXT_BOX_RUN_FORMAT,
  UNSOURCED_RUN_FORMAT,
  paragraphAt,
  runAt,
  textSources
} from '../textSources';
import { pptxTree } from '../tree';

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
    walk(after.root, pptxTree, ({ node }) => {
      if (!Array.isArray(node.paragraphs) || node.kind === 'cell') return;
      const old = before.get(origin(node.id));
      if (!old) {
        // A new text box starts as one run of the editor's own text
        for (const paragraph of node.paragraphs as NfNode[])
          for (const run of paragraph.runs as NfNode[])
            if (
              run.kind === 'run' &&
              fillAbsent(run, TEXT_BOX_RUN_FORMAT, RUN_FORMAT)
            )
              ids.push(run.id);
        return;
      }
      if (!Array.isArray(old.paragraphs)) return;
      const known = new Set(
        (old.paragraphs as NfNode[]).flatMap((paragraph) => [
          paragraph.id,
          ...(paragraph.runs as NfNode[]).map((run) => run.id)
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
        (paragraph.runs as NfNode[]).forEach((run, r) => {
          if (known.has(origin(run.id)) || run.kind !== 'run') return;
          const at = sources.runs[p][r];
          const from = at ? runAt(old, at) : UNSOURCED_RUN_FORMAT;
          if (fillAbsent(run, from, RUN_FORMAT)) ids.push(run.id);
        });
      });
    });
    return { ids };
  }
};
