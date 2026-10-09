/**
 * The format seam: formatting through the editor's own format API, in one undo group. Character
 * formatting on the selected span or paragraph mark; paragraph, table, row and cell properties on
 * the selection's paragraphFormat, tableFormat, rowFormat and cellFormat with the cursor in the
 * paragraph (or the first paragraph of the table, row or cell). The editor authors no revision for
 * formatting, so the change lands immediately (WP1 F11, decision D3).
 */
import type { Seam } from '../../../pack';
import type { DocxHost } from '../host';
import type { FormatOp } from '../reconcile';
import { inGroup, place } from './group';

const FORMAT_OF: Record<FormatOp['target'], string> = {
  character: 'characterFormat',
  paragraph: 'paragraphFormat',
  table: 'tableFormat',
  row: 'rowFormat',
  cell: 'cellFormat'
};

export const formatSeam: Seam = {
  apply(host, payload, ctx) {
    const { editor } = host as DocxHost;
    inGroup(
      editor,
      ctx.turnId,
      false,
      () => {
        const selection = editor.selection as Record<string, any>;
        for (const op of payload as FormatOp[]) {
          const target = op.target ?? 'character';
          if (target !== 'character')
            selection.select(`${op.hi};0`, `${op.hi};0`);
          else if (op.whole) {
            selection.select(`${op.hi};0`, `${op.hi};0`);
            selection.extendToParagraphEnd();
          } else place(editor, op.hi, op.a, op.b, op.expect, op.at ?? op.a);
          const format = selection[FORMAT_OF[target]];
          if (!format)
            throw new Error(`no ${FORMAT_OF[target]} on the selection`);
          for (const [k, v] of Object.entries(op.props)) format[k] = v;
        }
      },
      { title: ctx.title, intent: ctx.intent }
    );
  }
};
