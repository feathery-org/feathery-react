// Duplicating a table must not clone the review cards inside it.
//
// A foreign author's pending edit is refused outright - rejecting a relocation
// that folded it in would revert their work silently. The assistant's OWN pending
// edits are different: they accumulate across turns until the user reviews them,
// so refusing on them would make "duplicate this table" fail for a whole session
// after any unaccepted cell write. Cloning them verbatim is worse still, because
// `revisionIds` name entries in the document's own revisions array: one card would
// then span both tables, and rejecting it would reach into the copy the user just
// asked for.
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

const para = (text: string) => ({ inlines: text ? [{ text }] : [] });

const cell = (text: string) => ({
  cellFormat: {},
  blocks: [{ inlines: [{ text }] }]
});

const fixture = () => ({
  sections: [
    {
      blocks: [
        para('Coverage Schedule'),
        {
          tableFormat: { allowAutoFit: true },
          rows: [
            {
              rowFormat: { isHeader: true },
              cells: [cell('Line'), cell('Carrier')]
            },
            { rowFormat: {}, cells: [cell('Auto'), cell('Acme')] },
            { rowFormat: {}, cells: [cell('Property'), cell('Beta')] }
          ]
        },
        para('Confirm by Friday.')
      ]
    }
  ]
});

const apply = (editor: DocumentEditor, edits: EditOp[], changeSetId: string) =>
  applyDocumentEdits(editor as unknown as LiveEditor, { edits, changeSetId });

const textsOf = (editor: DocumentEditor): string[] =>
  flattenSfdt(JSON.parse(editor.serialize())).map((block) => block.text);

/** Every revisionId referenced anywhere under `node`. */
const revisionIdsIn = (node: any, out: string[] = []): string[] => {
  if (Array.isArray(node)) {
    node.forEach((entry) => revisionIdsIn(entry, out));
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const ids = node.revisionIds ?? node.rids;
  if (Array.isArray(ids)) out.push(...ids.map(String));
  for (const value of Object.values(node)) revisionIdsIn(value, out);
  return out;
};

describe('duplicate_table over an unreviewed assistant edit', () => {
  let editor: DocumentEditor;

  beforeEach(() => {
    editor = makeEditor(fixture());
    editor.enableTrackChanges = true;
    editor.currentUser = 'Robin';
  });

  afterEach(() => destroyEditor(editor));

  it('copies the table without copying its pending review cards', () => {
    const written = apply(
      editor,
      [{ op: 'set_cell_text', anchor: '0;1;1;1;0', text: 'Gamma' }],
      'turn-one'
    );
    expect(written.results[0].ok).toBe(true);
    const pending = editor.revisions.length;
    expect(pending).toBeGreaterThan(0);

    const duplicated = apply(
      editor,
      [{ op: 'duplicate_table', anchor: '0;1;0;0;0', rows: 'copy' }],
      'turn-two'
    );
    expect(duplicated.results[0]).toMatchObject({
      ok: true,
      op: 'duplicate_table'
    });

    const sfdt = JSON.parse(editor.serialize());
    // The live editor serializes OPTIMIZED SFDT: `sec`/`b`/`rw`.
    const blocks =
      (sfdt.sections ?? sfdt.sec)[0].blocks ?? (sfdt.sec ?? [])[0].b;
    // An empty paragraph separates the two tables; Word renders adjacent tables
    // as one block.
    const separator = blocks[2];
    expect(separator.rows ?? separator.rw ?? separator.r).toBeUndefined();
    const copy = blocks[3];
    expect(copy.rows ?? copy.rw ?? copy.r).toHaveLength(3);
    // The copy is new content that no existing card describes.
    expect(revisionIdsIn(copy)).toEqual([]);
    // The source keeps every card it had, so the user's review queue is intact.
    expect(revisionIdsIn(blocks[1]).length).toBeGreaterThan(0);
    expect(editor.revisions.length).toBe(pending);

    // The copy reads what the user was looking at when they asked for it: the
    // pending replacement resolved, not both halves of it side by side.
    const duplicatedTexts = textsOf(editor);
    expect(duplicatedTexts.filter((text) => text === 'Gamma')).toHaveLength(2);
    expect(duplicatedTexts.filter((text) => text === 'AcmeGamma')).toHaveLength(
      0
    );

    // Rejecting the source's pending write restores the SOURCE and leaves the
    // copy exactly as it was handed over.
    for (const revision of Array.from(
      { length: editor.revisions.length },
      (_, index) => editor.revisions.get(index)
    ))
      revision.reject();
    const texts = textsOf(editor);
    expect(texts.filter((text) => text === 'Acme')).toHaveLength(1);
    expect(texts.filter((text) => text === 'Gamma')).toHaveLength(1);
  });
});
