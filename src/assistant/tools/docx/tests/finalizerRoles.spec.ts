// The finalizer bands item rows only, aggregate rows keep their fill, and a
// reject through the engine seam restores every fill byte for byte
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';
import { applyDocumentEdits, LiveEditor } from '../syncfusionDocumentOps';
import {
  listRevisionGroups,
  resolveLiveRevisionGroupsAsOneUndo
} from '../../../../utils/documentEditorPrimitives';
import {
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';
import {
  AGGREGATE_FILL,
  BAND_FILLS,
  buildBandedProposalFixture,
  HEADER_FILL,
  SCHEDULE_ITEMS,
  TOTAL_FILL
} from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/bandedProposalFixture';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);
if (!window.crypto?.getRandomValues)
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (a: Uint8Array) => require('crypto').randomFillSync(a)
    }
  });
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

const HEADER_ROWS = 2;
const [WHITE, GREY] = BAND_FILLS;

function makeEditor(): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableImageResizer: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true,
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(buildBandedProposalFixture()));
  return editor;
}

const parsed = (editor: DocumentEditor) => JSON.parse(editor.serialize());

/** Top-level block index of the wrapper carrying `tableId` */
function tableBlockIndex(editor: DocumentEditor, tableId: string): number {
  return parsed(editor).sections[0].blocks.findIndex(
    (block: any) =>
      block?.contentControlProperties?.tag === `[[table=${tableId}]]`
  );
}

/** First-cell fill of every row of the table wrapped at `blockIndex` */
function fillsOf(editor: DocumentEditor, blockIndex: number): string[] {
  const wrapper = parsed(editor).sections[0].blocks[blockIndex];
  const table = wrapper.rows
    ? wrapper
    : wrapper.blocks.find((b: any) => b.rows);
  return table.rows.map(
    (row: any) => row.cells[0].cellFormat?.shading?.backgroundColor ?? null
  );
}

const copyIdOf = (editor: DocumentEditor): string => {
  const wrapper = parsed(editor).sections[0].blocks.find((block: any) =>
    /^\[\[table=schedule.+\]\]$/.test(
      block?.contentControlProperties?.tag ?? ''
    )
  );
  return wrapper.contentControlProperties.tag.slice(8, -2);
};

/** Move the items at these indices, counted among items, into a copy */
function splitSchedule(editor: DocumentEditor, itemIndices: number[]) {
  const block = tableBlockIndex(editor, 'schedule');
  const rows = itemIndices.map((index) => HEADER_ROWS + index);
  return applyDocumentEdits(editor as unknown as LiveEditor, {
    changeSetId: 'finalizer-roles',
    edits: [
      {
        op: 'duplicate_table',
        anchor: `0;${block};0;0;0`,
        rows: 'copy',
        keepRows: rows,
        group: 'g'
      } as any,
      {
        op: 'delete_row',
        anchor: `0;${block};${rows[0]};0;0`,
        rows,
        group: 'g'
      } as any
    ]
  }) as any;
}

describe('the finalizer bands item rows only', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  beforeEach(() => {
    editor = makeEditor();
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
    attached.controller.flush({ mode: 'self-heal' });
  });

  afterEach(() => {
    attached.dispose();
    const element = editor.element;
    editor.destroy();
    element?.remove();
  });

  it('fixture control: the schedule is banded across mixed roles', () => {
    expect(fillsOf(editor, tableBlockIndex(editor, 'schedule'))).toEqual([
      HEADER_FILL,
      HEADER_FILL,
      ...SCHEDULE_ITEMS.map((_, index) => BAND_FILLS[index % 2]),
      AGGREGATE_FILL,
      AGGREGATE_FILL,
      TOTAL_FILL
    ]);
  });

  it('after a composed split both halves alternate from white and keep their aggregate fills', () => {
    const result = splitSchedule(editor, [3, 4, 5]);
    expect(
      result.results.map((entry: any) => (entry.ok ? 'ok' : entry.error))
    ).toEqual(['ok', 'ok']);
    // Every data cell carries a key, so nothing is declined
    expect(
      (result.warnings ?? []).some((w: string) => /left unbanded/.test(w))
    ).toBe(false);

    editor.revisions.acceptAll();

    const expected = [
      HEADER_FILL,
      HEADER_FILL,
      WHITE,
      GREY,
      WHITE,
      AGGREGATE_FILL,
      AGGREGATE_FILL,
      TOTAL_FILL
    ];
    expect(fillsOf(editor, tableBlockIndex(editor, 'schedule'))).toEqual(
      expected
    );
    // The copy's items were grey, white, grey at the source
    expect(fillsOf(editor, tableBlockIndex(editor, copyIdOf(editor)))).toEqual(
      expected
    );
  });

  it('rejecting through the engine seam restores every fill byte for byte', () => {
    const before = editor.serialize();
    const result = splitSchedule(editor, [3, 4, 5]);
    expect(result.results.every((entry: any) => entry.ok)).toBe(true);
    // Negative control: the copy really was restriped before the reject
    const copyFills = fillsOf(
      editor,
      tableBlockIndex(editor, copyIdOf(editor))
    );
    expect(copyFills.slice(HEADER_ROWS, HEADER_ROWS + 3)).toEqual([
      WHITE,
      GREY,
      WHITE
    ]);

    const groups = listRevisionGroups(editor as any);
    expect(groups.length).toBeGreaterThan(0);
    resolveLiveRevisionGroupsAsOneUndo(editor as any, groups, false);

    expect(editor.revisions.length).toBe(0);
    expect(editor.serialize()).toBe(before);
  });
});
