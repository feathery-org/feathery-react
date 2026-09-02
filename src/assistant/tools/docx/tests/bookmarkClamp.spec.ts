// The bookmark clamp law on the legacy editor route, the bound engine route
// and legacy split_table
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
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';
import {
  buildBandedProposalFixture,
  SPANNING_BOOKMARK
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

function open(sfdt: unknown): DocumentEditor {
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
  editor.open(JSON.stringify(sfdt));
  return editor;
}
function close(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const parsed = (editor: DocumentEditor) => JSON.parse(editor.serialize());

/** Which physical rows of the table at `blockIndex` hold `name`'s start and end */
function bookmarkRows(
  editor: DocumentEditor,
  blockIndex: number,
  name: string
): { start?: number; end?: number } {
  const wrapper = parsed(editor).sections[0].blocks[blockIndex];
  const table = wrapper.rows
    ? wrapper
    : wrapper.blocks.find((b: any) => b.rows);
  const span: { start?: number; end?: number } = {};
  table.rows.forEach((row: any, index: number) => {
    const text = JSON.stringify(row);
    if (text.includes(`"bookmarkType":0,"name":"${name}"`)) span.start = index;
    if (text.includes(`"bookmarkType":1,"name":"${name}"`)) span.end = index;
  });
  return span;
}

const okCodes = (result: any) =>
  result.results.map((entry: any) => (entry.ok ? 'ok' : entry.error));
const detailsOf = (result: any): string[] =>
  result.results.flatMap((entry: any) => entry.details ?? []);

/* ---- an unbound table, the legacy route ---- */

const para = (text: string, marks: unknown[] = []) => ({
  paragraphFormat: {},
  characterFormat: {},
  inlines: [
    ...marks.filter((m: any) => m.bookmarkType === 0),
    { characterFormat: {}, text },
    ...marks.filter((m: any) => m.bookmarkType === 1)
  ]
});
const cell = (text: string, marks: unknown[] = []) => ({
  blocks: [para(text, marks)],
  cellFormat: { columnSpan: 1, rowSpan: 1 }
});
const START = { bookmarkType: 0, name: 'terms' };
const END = { bookmarkType: 1, name: 'terms' };
const unboundDocument = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        para('Terms'),
        {
          rows: [
            { rowFormat: {}, cells: [cell('Clause'), cell('Text')] },
            { rowFormat: {}, cells: [cell('1'), cell('First')] },
            { rowFormat: {}, cells: [cell('2', [START]), cell('Second')] },
            { rowFormat: {}, cells: [cell('3'), cell('Third')] },
            { rowFormat: {}, cells: [cell('4'), cell('Fourth', [END])] },
            { rowFormat: {}, cells: [cell('5'), cell('Fifth')] }
          ]
        },
        para('After')
      ]
    }
  ]
});

describe('bookmark clamp on the legacy editor route', () => {
  it('delete_row on the row holding the end clamps the end onto the row above', () => {
    const editor = open(unboundDocument());
    try {
      expect(bookmarkRows(editor, 1, 'terms')).toEqual({ start: 2, end: 4 });
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-editor',
        edits: [
          {
            op: 'delete_row',
            anchor: '0;1;4;0;0',
            rows: [4],
            group: 'g'
          } as any
        ]
      }) as any;
      expect(okCodes(result)).toEqual(['ok']);
      expect(detailsOf(result)).toContain(
        'bookmark "terms" clamped to rows 2-3'
      );
      editor.revisions.acceptAll();
      expect(bookmarkRows(editor, 1, 'terms')).toEqual({ start: 2, end: 3 });
    } finally {
      close(editor);
    }
  });

  it('delete_row on the row holding the start clamps the start onto the row below', () => {
    const editor = open(unboundDocument());
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-editor-start',
        edits: [
          {
            op: 'delete_row',
            anchor: '0;1;2;0;0',
            rows: [2, 3],
            group: 'g'
          } as any
        ]
      }) as any;
      expect(okCodes(result)).toEqual(['ok']);
      expect(detailsOf(result)).toContain(
        'bookmark "terms" clamped to rows 4-4'
      );
      editor.revisions.acceptAll();
      expect(bookmarkRows(editor, 1, 'terms')).toEqual({ start: 2, end: 2 });
    } finally {
      close(editor);
    }
  });

  it('a removal wholly inside or wholly outside the bookmark clamps nothing', () => {
    const editor = open(unboundDocument());
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-none',
        edits: [
          {
            op: 'delete_row',
            anchor: '0;1;3;0;0',
            rows: [3],
            group: 'g'
          } as any
        ]
      }) as any;
      expect(okCodes(result)).toEqual(['ok']);
      expect(detailsOf(result).some((d) => /clamped/.test(d))).toBe(false);
      editor.revisions.acceptAll();
      expect(bookmarkRows(editor, 1, 'terms')).toEqual({ start: 2, end: 3 });
    } finally {
      close(editor);
    }
  });

  it('a refused split_table leaves the bookmark where it was', () => {
    const tailTable = unboundDocument();
    tailTable.sections[0].blocks.pop();
    const editor = open(tailTable);
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-refused-split',
        edits: [
          {
            op: 'split_table',
            anchor: '0;1;0;0;0',
            splitAtRow: 4,
            targetAnchor: '0;0',
            position: 'before',
            group: 'g'
          } as any
        ]
      }) as any;
      expect(okCodes(result)).toEqual(['document_tail_table_last_row']);
      expect(bookmarkRows(editor, 1, 'terms')).toEqual({ start: 2, end: 4 });
    } finally {
      close(editor);
    }
  });

  it('split_table clamps instead of refusing when the cut tears the bookmark', () => {
    const editor = open(unboundDocument());
    try {
      const result = applyDocumentEdits(editor as unknown as LiveEditor, {
        changeSetId: 'clamp-split',
        edits: [
          {
            op: 'split_table',
            anchor: '0;1;0;0;0',
            splitAtRow: 4,
            targetAnchor: '0;2',
            position: 'after',
            group: 'g'
          } as any
        ]
      }) as any;
      expect(okCodes(result)).toEqual(['ok']);
      expect(detailsOf(result)).toContain(
        'bookmark "terms" clamped to rows 2-3'
      );
      editor.revisions.acceptAll();
      expect(bookmarkRows(editor, 1, 'terms')).toEqual({ start: 2, end: 3 });
    } finally {
      close(editor);
    }
  });
});

/* ---- the bound engine route ---- */

describe('bookmark clamp on the bound engine route', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;
  let block: number;

  beforeEach(() => {
    editor = open(buildBandedProposalFixture());
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
    attached.controller.flush({ mode: 'self-heal' });
    block = parsed(editor).sections[0].blocks.findIndex(
      (b: any) => b.contentControlProperties?.tag === '[[table=schedule]]'
    );
  });

  afterEach(() => {
    attached.dispose();
    close(editor);
  });

  it('fixture control: the bookmark spans the first three items', () => {
    expect(bookmarkRows(editor, block, SPANNING_BOOKMARK)).toEqual({
      start: 2,
      end: 4
    });
  });

  it('deleting the item that holds the end clamps it, and the receipt names the rows', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'clamp-bound',
      edits: [
        {
          op: 'delete_row',
          anchor: `0;${block};4;0;0`,
          rows: [4],
          group: 'g'
        } as any
      ]
    }) as any;
    expect(okCodes(result)).toEqual(['ok']);
    expect(detailsOf(result)).toContain(
      `bookmark "${SPANNING_BOOKMARK}" clamped to rows 2-3`
    );
    editor.revisions.acceptAll();
    expect(bookmarkRows(editor, block, SPANNING_BOOKMARK)).toEqual({
      start: 2,
      end: 3
    });
  });

  it('a change set refused at preflight leaves the bookmark where it was', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'clamp-bound-refused',
      edits: [
        {
          op: 'delete_row',
          anchor: `0;${block};4;0;0`,
          rows: [4],
          group: 'g'
        } as any,
        {
          op: 'replace_text',
          anchor: '0;0',
          find: 'not in this document',
          replace: 'anything',
          group: 'g'
        } as any
      ]
    }) as any;
    expect(result.changeSet.status).not.toBe('applied');
    expect(bookmarkRows(editor, block, SPANNING_BOOKMARK)).toEqual({
      start: 2,
      end: 4
    });
  });
});
