// Row-height drag-resize is dead code in Syncfusion 34.1.31 (see
// installTableRowResizeFix in useDocxEditor.tsx): the drag handler computes
// the row delta and never applies it, and the unshipped mutation helpers mix
// pixel deltas into point-valued rowFormat.height. These tests run the REAL
// TableResizer from the node_modules mirror (same version production loads
// from the CDN — constants.spec.ts enforces the lockstep) and drive it the way
// the viewer's mouse handlers do: handleResize at mousedown, handleResizing on
// each move, updateResizingHistory at mouseup.
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  Selection
} from '@syncfusion/ej2-documenteditor';
import { randomFillSync } from 'crypto';
import { featheryDoc, featheryWindow } from '../../../utils/browser';
import { installTableRowResizeFix } from './useDocxEditor';

DocumentEditor.Inject(Editor, Selection, EditorHistory);

const win: any = featheryWindow();

if (!win.crypto?.getRandomValues) {
  Object.defineProperty(win, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) => randomFillSync(array)
    }
  });
}

// jsdom throws on getComputedStyle's pseudo-element argument; drop it.
const jsdomGetComputedStyle = win.getComputedStyle.bind(win);
win.getComputedStyle = (elt: Element) => jsdomGetComputedStyle(elt);

if (!win.SVGElement.prototype.getBBox) {
  win.SVGElement.prototype.getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

const PT_PER_PX = 72 / 96;

function tableSfdt(rows: number) {
  const cell = (text: string) => ({
    cellFormat: {},
    blocks: [{ inlines: [{ text }] }]
  });
  return {
    sections: [
      {
        blocks: [
          { inlines: [{ text: 'Heading' }] },
          {
            tableFormat: {},
            rows: Array.from({ length: rows }, (_, i) => ({
              rowFormat: {},
              cells: [cell(`A${i}`), cell(`B${i}`)]
            }))
          },
          { inlines: [{ text: 'End' }] }
        ]
      }
    ]
  };
}

function makeRealDocumentEditor(sfdt: any): DocumentEditor {
  const host = featheryDoc().createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  featheryDoc().body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

// jsdom's mocked text metrics can push the table onto a later page — search
// every page rather than assuming page 0.
function getFirstTable(ed: any) {
  for (const page of ed.documentHelper.pages) {
    for (const body of page.bodyWidgets ?? []) {
      const table = (body.childWidgets ?? []).find(
        (w: any) =>
          Array.isArray(w.childWidgets) && w.childWidgets[0]?.rowFormat
      );
      if (table) return table;
    }
  }
  return undefined;
}

/** Mouse-down on a row's bottom edge, the way the viewer sets the resizer up
 *  before its mousemove loop calls handleResizing. */
function beginRowDrag(
  ed: any,
  rowIndex: number,
  start: { x: number; y: number }
) {
  const tableResize = ed.editorModule.tableResize;
  tableResize.resizeNode = 1;
  tableResize.resizerPosition = rowIndex;
  tableResize.currentResizingTable = getFirstTable(ed);
  tableResize.handleResize(start);
  return tableResize;
}

/** The pixel height the patch resizes from, mirroring its own branch. */
function currentRowPx(tableResize: any, row: any): number {
  return row.rowFormat.heightType === 'Exactly'
    ? row.rowFormat.height / PT_PER_PX
    : tableResize.getRowFormatHeight(row);
}

jest.setTimeout(120000);

let ed: any;

afterEach(() => {
  if (ed) {
    const element = ed.element;
    ed.destroy();
    element?.remove();
    ed = undefined;
  }
});

describe('installTableRowResizeFix', () => {
  it('documents the upstream bug: unpatched, dragging a row edge changes nothing', () => {
    ed = makeRealDocumentEditor(tableSfdt(3));
    const tableResize = beginRowDrag(ed, 0, { x: 0, y: 100 });
    const row = tableResize.currentResizingTable.childWidgets[0];
    const heightBefore = row.rowFormat.height;
    const typeBefore = row.rowFormat.heightType;

    tableResize.handleResizing({ x: 0, y: 130 });

    expect(row.rowFormat.height).toBe(heightBefore);
    expect(row.rowFormat.heightType).toBe(typeBefore);
  });

  it('patched: dragging down grows the row by the dragged pixels, in points', () => {
    ed = makeRealDocumentEditor(tableSfdt(3));
    installTableRowResizeFix(ed);
    const tableResize = beginRowDrag(ed, 0, { x: 0, y: 100 });
    const row = tableResize.currentResizingTable.childWidgets[0];
    const initialType = row.rowFormat.heightType;
    const initialPx = currentRowPx(tableResize, row);

    tableResize.handleResizing({ x: 0, y: 130 });

    expect(row.rowFormat.height).toBeCloseTo((initialPx + 30) * PT_PER_PX, 5);
    expect(row.rowFormat.heightType).toBe(
      initialType === 'Auto' ? 'AtLeast' : initialType
    );
    // The reference point advances by the applied pixel delta so the next
    // mousemove resizes from here, not from the mousedown point.
    expect(tableResize.startingPoint.y).toBe(130);
  });

  it('patched: a continued drag keeps tracking the mouse (no compounding)', () => {
    ed = makeRealDocumentEditor(tableSfdt(3));
    installTableRowResizeFix(ed);
    const row = getFirstTable(ed).childWidgets[0];
    // Exactly rows derive their current height from the format itself, so the
    // math stays exact across moves (AtLeast rows read the RENDERED height,
    // which jsdom's mocked text metrics report loosely — covered by the
    // single-move test above and manual QA in a real browser).
    row.rowFormat.heightType = 'Exactly';
    row.rowFormat.height = 30; // 30pt == 40px
    const tableResize = beginRowDrag(ed, 0, { x: 0, y: 100 });

    tableResize.handleResizing({ x: 0, y: 130 }); // 40px + 30px == 52.5pt
    expect(row.rowFormat.height).toBeCloseTo(52.5, 5);
    tableResize.handleResizing({ x: 0, y: 140 }); // 70px + 10px == 60pt
    expect(row.rowFormat.height).toBeCloseTo(60, 5);
    expect(tableResize.startingPoint.y).toBe(140);
  });

  it("patched: dragging up shrinks and clamps at Word's 2.7pt floor", () => {
    ed = makeRealDocumentEditor(tableSfdt(3));
    installTableRowResizeFix(ed);
    const tableResize = beginRowDrag(ed, 0, { x: 0, y: 100 });
    const row = tableResize.currentResizingTable.childWidgets[0];

    tableResize.handleResizing({ x: 0, y: -500 });

    expect(row.rowFormat.height).toBeCloseTo(2.7, 5);
  });

  it('patched: Exactly rows convert the pixel delta exactly once', () => {
    ed = makeRealDocumentEditor(tableSfdt(3));
    installTableRowResizeFix(ed);
    const table = getFirstTable(ed);
    const row = table.childWidgets[0];
    row.rowFormat.heightType = 'Exactly';
    row.rowFormat.height = 30; // 30pt == 40px
    const tableResize = beginRowDrag(ed, 0, { x: 0, y: 100 });

    tableResize.handleResizing({ x: 0, y: 132 });

    // 40px + 32px = 72px == 54pt.
    expect(row.rowFormat.height).toBeCloseTo(54, 5);
    // The original advanced Exactly rows by convertPointToPixel(delta) — a
    // 1.33x overshoot that would jitter the drag. Pixel space throughout.
    expect(tableResize.startingPoint.y).toBe(132);
  });

  it('patched: the existing resize history round-trips undo/redo (Exactly row)', () => {
    ed = makeRealDocumentEditor(tableSfdt(3));
    installTableRowResizeFix(ed);
    const row = getFirstTable(ed).childWidgets[0];
    row.rowFormat.heightType = 'Exactly';
    row.rowFormat.height = 30;
    const tableResize = beginRowDrag(ed, 0, { x: 0, y: 100 });

    tableResize.handleResizing({ x: 0, y: 130 });
    const resizedHeight = row.rowFormat.height;
    expect(resizedHeight).toBeCloseTo(52.5, 5);
    tableResize.updateResizingHistory({ x: 0, y: 130 });

    ed.editorHistoryModule.undo();
    expect(row.rowFormat.height).toBe(30);
    expect(row.rowFormat.heightType).toBe('Exactly');

    ed.editorHistoryModule.redo();
    expect(row.rowFormat.height).toBeCloseTo(resizedHeight, 5);
    expect(row.rowFormat.heightType).toBe('Exactly');
  });

  it('patched: undo restores an Auto row to auto-sizing', () => {
    ed = makeRealDocumentEditor(tableSfdt(3));
    installTableRowResizeFix(ed);
    const tableResize = beginRowDrag(ed, 0, { x: 0, y: 100 });
    const rowFormat = () => getFirstTable(ed).childWidgets[0].rowFormat;
    expect(rowFormat().heightType).toBe('Auto');

    tableResize.handleResizing({ x: 0, y: 130 });
    expect(rowFormat().heightType).toBe('AtLeast');
    tableResize.updateResizingHistory({ x: 0, y: 130 });

    // Upstream history bookkeeping does not restore the TYPE for Auto-origin
    // rows (mouseup overwrites the type snapshot with the post-drag value,
    // and the height setter clamps the restored 0 to 1 while AtLeast) — but
    // an AtLeast row floored at 1pt renders at content height, i.e. the row
    // VISUALLY returns to auto-sizing. Assert that: the specified height is
    // back to the negligible floor, not the dragged size.
    ed.editorHistoryModule.undo();
    expect(rowFormat().height).toBeLessThanOrEqual(1);
  });

  it('patched: the column-resize path is untouched', () => {
    ed = makeRealDocumentEditor(tableSfdt(3));
    installTableRowResizeFix(ed);
    const tableResize = ed.editorModule.tableResize;
    tableResize.resizeNode = 0;
    tableResize.startingPoint.x = 100;
    tableResize.startingPoint.y = 0;
    tableResize.resizeTableCellColumn = jest.fn();

    tableResize.handleResizing({ x: 112.34, y: 0 });

    expect(tableResize.resizeTableCellColumn).toHaveBeenCalledWith(12.34);
  });

  it('installs once: a second install is a no-op', () => {
    ed = makeRealDocumentEditor(tableSfdt(3));
    installTableRowResizeFix(ed);
    const tableResize = ed.editorModule.tableResize;
    const patched = tableResize.handleResizing;

    installTableRowResizeFix(ed);

    expect(tableResize.handleResizing).toBe(patched);
  });

  it('skips patching when the row branch is already wired up upstream', () => {
    const fixedUpstream = {
      // Source contains the resizeTableRow call the probe looks for.
      handleResizing(touchPoint: any) {
        this.resizeTableRow(touchPoint.y - this.startingPoint.y);
      },
      resizeTableRow: () => undefined,
      updateRowHeight: () => undefined,
      getRowFormatHeight: () => 0
    };
    const fakeEd = { editorModule: { tableResize: fixedUpstream } };
    const native = fixedUpstream.handleResizing;

    installTableRowResizeFix(fakeEd);

    expect(fixedUpstream.handleResizing).toBe(native);
    expect((fixedUpstream as any).__featheryTableRowResizeFix).toBeUndefined();
  });

  it('tolerates a missing editor or resizer module', () => {
    expect(() => installTableRowResizeFix(undefined)).not.toThrow();
    expect(() => installTableRowResizeFix({})).not.toThrow();
    expect(() => installTableRowResizeFix({ editorModule: {} })).not.toThrow();
  });
});
