// Painting a continuation page repaints the repeat-header row from a throwaway
// table clone, and stock SyncFusion re-registers the clone's revisions each
// paint, repointing live revisions at detached clone widgets. A later
// registration walk then throws mid-paint and every page below stays blank,
// so painting must leave revision registration untouched
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
import {
  applyDocumentEdits,
  flattenSfdt,
  EditOp,
  LiveEditor
} from '../syncfusionDocumentOps';
import { registerWrappingDocumentEditorContainer } from '../../../../utils/documentEditorPrimitives';
import { configureTrackedChangeReview } from '../../../../elements/components/DocxEditor/useDocxEditor';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
  });
}
if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

function makeEditor(sfdt: any): DocumentEditor {
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
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

function destroyEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const cell = (text: string) => ({
  cellFormat: {},
  blocks: [{ inlines: [{ text }] }]
});

// Explicit row heights: jsdom's mocked text measurement yields near-zero
// natural heights, and the table must cross pages for headers to repeat
const fixture = () => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'Coverage Comparison' }] },
        {
          tableFormat: { allowAutoFit: true },
          rows: [
            {
              rowFormat: { isHeader: true, height: 30, heightType: 'Exactly' },
              cells: [cell('Carrier'), cell('Coverage')]
            },
            ...Array.from({ length: 70 }, (_, i) => ({
              rowFormat: { height: 30, heightType: 'Exactly' },
              cells: [cell(`Row ${i} carrier`), cell(`Row ${i} coverage`)]
            }))
          ]
        },
        { inlines: [{ text: 'Tail paragraph' }] }
      ]
    }
  ]
});

// Layout's fit heuristics never mark pages in jsdom (zero-height text), so
// stamp the flag the way PageLayoutViewer does for a split header table
const paintAllPages = (editor: DocumentEditor) => {
  const dh = (editor as any).documentHelper;
  for (const page of dh.pages ?? []) {
    const first = page.bodyWidgets?.[0]?.childWidgets?.[0];
    if (first?.header && page.index > 0)
      page.repeatHeaderRowTableWidget = true;
  }
  for (const page of dh.pages ?? []) {
    dh.render.renderWidgets(
      page,
      0,
      0,
      page.boundingRectangle?.width ?? 800,
      page.boundingRectangle?.height ?? 1000
    );
  }
};

const registeredOwnerNodes = (editor: DocumentEditor): Map<any, any> => {
  const changes: any[] = (editor as any).revisions.changes ?? [];
  return new Map(changes.map((revision) => [revision, revision.ownerNode]));
};

describe('repeat-header rows with pending revisions', () => {
  let editor: DocumentEditor;

  beforeEach(() => {
    editor = makeEditor(fixture());
    registerWrappingDocumentEditorContainer(editor, {
      enableTrackChanges: true
    });
    configureTrackedChangeReview(editor as any, true);
    editor.enableTrackChanges = true;
    editor.currentUser = 'Robin';
    const duplicated = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'duplicate_table', anchor: '0;1;0;0;0', rows: 'copy' } as EditOp
      ],
      changeSetId: 'turn-one'
    });
    expect(duplicated.results[0].ok).toBe(true);
  });

  afterEach(() => destroyEditor(editor));

  it('paints continuation pages without touching revision registration', () => {
    const renderer = (editor as any).documentHelper.render;
    const wrappedRenderHeader = renderer.renderHeader.bind(renderer);
    let headerPaints = 0;
    renderer.renderHeader = (page: any, widget: any, header: any) => {
      headerPaints += 1;
      return wrappedRenderHeader(page, widget, header);
    };

    const before = registeredOwnerNodes(editor);
    expect(before.size).toBeGreaterThan(0);

    expect(() => paintAllPages(editor)).not.toThrow();
    expect(headerPaints).toBeGreaterThan(0);

    const after = registeredOwnerNodes(editor);
    expect(after.size).toBe(before.size);
    for (const [revision, ownerNode] of before)
      expect(after.get(revision)).toBe(ownerNode);
  });

  it('keeps registering revisions for edits made after a paint', () => {
    paintAllPages(editor);

    const changesBefore = (editor as any).revisions.changes.length;
    const written = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'set_cell_text', anchor: '0;1;1;1;0', text: 'Acme Re' } as EditOp
      ],
      changeSetId: 'turn-two'
    });
    expect(written.results[0].ok).toBe(true);
    expect((editor as any).revisions.changes.length).toBeGreaterThan(
      changesBefore
    );
  });

  it('still resolves the duplicate cleanly after painting', () => {
    paintAllPages(editor);

    const revisions: any[] = Array.from(
      { length: (editor as any).revisions.length },
      (_, index) => (editor as any).revisions.get(index)
    );
    expect(() => {
      for (const revision of revisions.reverse()) revision.reject();
    }).not.toThrow();

    const tables = flattenSfdt(JSON.parse(editor.serialize())).filter(
      (block) => block.kind === 'table_cell' && block.anchor.startsWith('0;3')
    );
    expect(tables).toHaveLength(0);
  });
});
