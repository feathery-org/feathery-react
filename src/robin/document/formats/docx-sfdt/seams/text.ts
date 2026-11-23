/**
 * The text seam: text-shaped deltas inside existing paragraphs as tracked `insertText` and
 * `delete` (WP1 P1/P2, WP4), last paragraph first so earlier offsets stay valid.
 */
import type { Seam } from '../../../pack';
import type { DocxHost } from '../host';
import type { TextOp } from '../reconcile';
import { inGroup, place } from './group';

export const textSeam: Seam = {
  apply(host, payload, ctx) {
    const { editor } = host as DocxHost;
    const ops = payload as TextOp[];
    inGroup(
      editor,
      ctx.turnId,
      true,
      () => {
        const module = editor.editorModule as Record<string, any>;
        const selection = editor.selection as Record<string, any>;
        for (const op of [...ops].reverse()) {
          if (op.oldMid.length) {
            place(editor, op.hi, op.a, op.b, op.oldMid, op.at ?? op.a);
            if (op.newMid.length) module.insertText(op.newMid);
            else module.delete();
          } else {
            const at = op.at ?? op.a;
            selection.select(`${op.hi};${at}`, `${op.hi};${at}`);
            module.insertText(op.newMid);
          }
        }
      },
      { title: ctx.title, intent: ctx.intent }
    );
  }
};
