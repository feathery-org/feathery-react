/**
 * The format seam: character formatting through the editor's own format API on the selected
 * span, in one undo group. The editor authors no revision for formatting, so the change lands
 * immediately (WP1 F11, decision D3).
 */
import type { Seam } from '../../../pack';
import type { DocxHost } from '../host';
import type { FormatOp } from '../reconcile';
import { inGroup, place } from './group';

export const formatSeam: Seam = {
  apply(host, payload, ctx) {
    const { editor } = host as DocxHost;
    inGroup(editor, ctx.turnId, false, () => {
      const selection = editor.selection as Record<string, any>;
      for (const op of payload as FormatOp[]) {
        if (op.whole) {
          selection.select(`${op.hi};0`, `${op.hi};0`);
          selection.extendToParagraphEnd();
        } else place(editor, op.hi, op.a, op.b, op.expect);
        const cf = selection.characterFormat;
        for (const [k, v] of Object.entries(op.props)) cf[k] = v;
      }
    });
  }
};
