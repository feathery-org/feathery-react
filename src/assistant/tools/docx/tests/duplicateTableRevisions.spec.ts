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
import { installDocumentTailInvariant } from '../../../../elements/components/DocxEditor/documentTailInvariant';
import { registerWrappingDocumentEditorContainer } from '../../../../utils/documentEditorPrimitives';

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
  installDocumentTailInvariant(editor as any);
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

const revisionsOf = (editor: DocumentEditor): any[] =>
  Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );

const revisionId = (revision: any): string =>
  String(revision.revisionID ?? revision.revisionId);

const tableCount = (editor: DocumentEditor): number => {
  const sfdt = JSON.parse(editor.serialize());
  const sections = sfdt.sections ?? sfdt.sec ?? [];
  return sections.reduce(
    (count: number, section: any) =>
      count +
      (section.blocks ?? section.b ?? []).filter(
        (block: any) => !!(block.rows ?? block.rw ?? block.r)
      ).length,
    0
  );
};

const documentContentOf = (editor: DocumentEditor): any => {
  const sfdt = JSON.parse(editor.serialize());
  delete sfdt.trackChanges;
  delete sfdt.tc;
  return sfdt;
};

const rejectAllRevisions = (editor: DocumentEditor): void => {
  const revisions = revisionsOf(editor);
  for (const revision of revisions.reverse()) revision.reject();
};

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
  let container: { enableTrackChanges: boolean };

  beforeEach(() => {
    editor = makeEditor(fixture());
    container = { enableTrackChanges: true };
    registerWrappingDocumentEditorContainer(editor, container);
    editor.enableTrackChanges = true;
    editor.currentUser = 'Robin';
  });

  afterEach(() => destroyEditor(editor));

  it('tracks the copy as one Robin group without copying source review cards', () => {
    const written = apply(
      editor,
      [{ op: 'set_cell_text', anchor: '0;1;1;1;0', text: 'Gamma' }],
      'turn-one'
    );
    expect(written.results[0].ok).toBe(true);
    const pending = revisionsOf(editor);
    const pendingIds = pending.map(revisionId);
    expect(pendingIds.length).toBeGreaterThan(0);

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
    const copyRevisionIds = revisionIdsIn(copy);
    expect(copyRevisionIds.length).toBeGreaterThan(0);
    expect(copyRevisionIds.some((id) => pendingIds.includes(id))).toBe(false);
    // The source keeps every card it had, so the user's review queue is intact.
    expect(revisionIdsIn(blocks[1]).length).toBeGreaterThan(0);
    const after = revisionsOf(editor);
    expect(after.map(revisionId)).toEqual(expect.arrayContaining(pendingIds));
    const duplicateRevisions = after.filter(
      (revision) => !pendingIds.includes(revisionId(revision))
    );
    expect(duplicateRevisions.length).toBeGreaterThan(0);
    expect(new Set(duplicateRevisions.map((revision) => revision.author))).toEqual(
      new Set(['Robin'])
    );
    expect(
      new Set(
        duplicateRevisions.map((revision) => {
          const tag = JSON.parse(revision.customData);
          return `${tag.changeSetId}:${tag.group}`;
        })
      )
    ).toEqual(new Set(['turn-two:turn-two']));

    // The copy reads what the user was looking at when they asked for it: the
    // pending replacement resolved, not both halves of it side by side.
    const duplicatedTexts = textsOf(editor);
    expect(duplicatedTexts.filter((text) => text === 'Gamma')).toHaveLength(2);
    expect(duplicatedTexts.filter((text) => text === 'AcmeGamma')).toHaveLength(
      0
    );

    // One grouped revision resolves the whole duplicate and leaves the source's
    // older review card and visible pending replacement untouched.
    duplicateRevisions[0].reject();
    expect(tableCount(editor)).toBe(1);
    expect(revisionsOf(editor).map(revisionId)).toEqual(pendingIds);
    const texts = textsOf(editor);
    expect(texts.filter((text) => text === 'Gamma')).toHaveLength(1);
  });

  it('accepts the whole tracked duplicate from one revision', () => {
    const duplicated = apply(
      editor,
      [{ op: 'duplicate_table', anchor: '0;1;0;0;0', rows: 'copy' }],
      'accept-copy'
    );
    expect(duplicated.results[0]).toMatchObject({ ok: true });
    const revisions = revisionsOf(editor);
    expect(revisions.length).toBeGreaterThan(0);
    expect(new Set(revisions.map((revision) => revision.author))).toEqual(
      new Set(['Robin'])
    );

    revisions[0].accept();
    expect(editor.revisions.length).toBe(0);
    expect(tableCount(editor)).toBe(2);
  });

  it('normalizes a terminal table and duplicates it as a tracked edit', () => {
    destroyEditor(editor);
    const sfdt = fixture();
    sfdt.sections[0].blocks.pop();
    editor = makeEditor(sfdt);
    container = { enableTrackChanges: true };
    registerWrappingDocumentEditorContainer(editor, container);

    const duplicated = apply(
      editor,
      [{ op: 'duplicate_table', anchor: '0;1;0;0;0', rows: 'copy' }],
      'tail-copy'
    );
    expect(duplicated.results[0]).toMatchObject({ ok: true });
    expect(tableCount(editor)).toBe(2);
    expect(editor.revisions.length).toBeGreaterThan(0);
    expect(
      new Set(revisionsOf(editor).map((revision) => revision.author))
    ).toEqual(new Set(['Robin']));
    expect(editor.enableTrackChanges).toBe(false);
    expect(container.enableTrackChanges).toBe(false);
  });

  it('appends a tracked paragraph after a document that loaded with a terminal table', () => {
    destroyEditor(editor);
    const sfdt = fixture();
    sfdt.sections[0].blocks.pop();
    editor = makeEditor(sfdt);
    container = { enableTrackChanges: true };
    registerWrappingDocumentEditorContainer(editor, container);

    const appended = apply(
      editor,
      [
        {
          op: 'insert_text',
          anchor: '0;2',
          position: 'after',
          text: 'Appended at the document end.'
        }
      ],
      'tail-append'
    );
    expect(appended.results[0]).toMatchObject({ ok: true });
    expect(textsOf(editor)).toContain('Appended at the document end.');
    expect(editor.revisions.length).toBeGreaterThan(0);
    expect(
      new Set(revisionsOf(editor).map((revision) => revision.author))
    ).toEqual(new Set(['Robin']));
    expect(editor.enableTrackChanges).toBe(false);
    expect(container.enableTrackChanges).toBe(false);
  });

  it('appends a tracked table after a document that loaded with a terminal table', () => {
    destroyEditor(editor);
    const sfdt = fixture();
    sfdt.sections[0].blocks.pop();
    editor = makeEditor(sfdt);
    container = { enableTrackChanges: true };
    registerWrappingDocumentEditorContainer(editor, container);

    const appended = apply(
      editor,
      [
        {
          op: 'insert_table',
          anchor: '0;2',
          position: 'after',
          rows: 2,
          columns: 2,
          initialCells: [
            ['Kind', 'Status'],
            ['Document end', 'Ready']
          ]
        }
      ],
      'tail-table-append'
    );
    expect(appended.results[0]).toMatchObject({ ok: true });
    expect(tableCount(editor)).toBe(2);
    expect(textsOf(editor)).toEqual(
      expect.arrayContaining(['Kind', 'Status', 'Document end', 'Ready'])
    );
    expect(editor.revisions.length).toBeGreaterThan(0);
    expect(
      new Set(revisionsOf(editor).map((revision) => revision.author))
    ).toEqual(new Set(['Robin']));
    expect(editor.enableTrackChanges).toBe(false);
    expect(container.enableTrackChanges).toBe(false);
  });

  it('forces tracking off on both owners after a fully refused batch', () => {
    expect(editor.enableTrackChanges).toBe(true);
    expect(container.enableTrackChanges).toBe(true);
    const before = documentContentOf(editor);
    const revisionCount = editor.revisions.length;

    const refused = apply(
      editor,
      [{ op: 'duplicate_table', anchor: '0;0', rows: 'copy' }],
      'fully-refused'
    );
    expect(refused.results[0]).toMatchObject({
      ok: false,
      error: 'duplicate_table_requires_table_anchor'
    });
    expect(documentContentOf(editor)).toEqual(before);
    expect(editor.revisions.length).toBe(revisionCount);
    expect(editor.enableTrackChanges).toBe(false);
    expect(container.enableTrackChanges).toBe(false);
  });

  it('preserves pending text and revisions, then leaves user typing untracked', () => {
    editor.currentUser = 'Guest user';
    editor.enableTrackChanges = true;
    editor.selection.select('0;0;17', '0;0;17');
    editor.editor.insertText(' pending');
    editor.enableTrackChanges = false;
    const pendingIds = revisionsOf(editor).map(revisionId);
    expect(pendingIds.length).toBeGreaterThan(0);
    expect(textsOf(editor)).toContain('Coverage Schedule pending');

    const duplicated = apply(
      editor,
      [{ op: 'duplicate_table', anchor: '0;1;0;0;0', rows: 'copy' }],
      'preserve-pending'
    );
    expect(duplicated.results[0]).toMatchObject({ ok: true });
    const afterDuplicate = revisionsOf(editor);
    expect(afterDuplicate.map(revisionId)).toEqual(
      expect.arrayContaining(pendingIds)
    );
    expect(textsOf(editor)).toContain('Coverage Schedule pending');
    expect(editor.enableTrackChanges).toBe(false);
    expect(container.enableTrackChanges).toBe(false);
    expect(
      afterDuplicate
        .filter((revision) => !pendingIds.includes(revisionId(revision)))
        .some((revision) => revision.author === 'Guest user')
    ).toBe(false);

    const revisionCount = editor.revisions.length;
    editor.selection.select('0;0;25', '0;0;25');
    editor.editor.insertText('!');
    expect(editor.revisions.length).toBe(revisionCount);
  });

  it.each([
    {
      name: 'prose replacement',
      edit: {
        op: 'replace_text',
        anchor: '0;0',
        find: 'Coverage',
        replace: 'Policy'
      } as EditOp,
      revisionTypes: ['Deletion', 'Insertion']
    },
    {
      name: 'cell write',
      edit: {
        op: 'set_cell_text',
        anchor: '0;1;1;0;0',
        text: 'Truck'
      } as EditOp,
      revisionTypes: ['Deletion', 'Insertion']
    },
    {
      name: 'row insertion',
      edit: { op: 'insert_row', anchor: '0;1;1;0;0' } as EditOp,
      revisionTypes: ['Insertion']
    },
    {
      name: 'row deletion',
      edit: { op: 'delete_row', anchor: '0;1;1;0;0' } as EditOp,
      revisionTypes: ['Deletion']
    },
    {
      name: 'table deletion',
      edit: { op: 'delete_table', anchor: '0;1;0;0;0' } as EditOp,
      revisionTypes: ['Deletion']
    }
  ])(
    'keeps $name tracked as Robin and rejectable while forcing both flags off',
    ({ edit, revisionTypes }) => {
      const beforeTexts = textsOf(editor);
      const beforeTableCount = tableCount(editor);
      const result = apply(editor, [edit], `unchanged-${edit.op}`);

      expect(result.results[0]).toMatchObject({ ok: true, op: edit.op });
      const revisions = revisionsOf(editor);
      expect(revisions.length).toBeGreaterThan(0);
      expect(new Set(revisions.map((revision) => revision.author))).toEqual(
        new Set(['Robin'])
      );
      expect(
        new Set(revisions.map((revision) => revision.revisionType))
      ).toEqual(new Set(revisionTypes));
      expect(editor.enableTrackChanges).toBe(false);
      expect(container.enableTrackChanges).toBe(false);

      rejectAllRevisions(editor);
      expect(textsOf(editor)).toEqual(beforeTexts);
      expect(tableCount(editor)).toBe(beforeTableCount);
    }
  );

  it('refuses an ungrounded formula without changing content and forces both flags off', () => {
    const before = documentContentOf(editor);
    const result = apply(
      editor,
      [
        {
          op: 'set_cell_formula',
          anchor: '0;1;1;1;0',
          formula: '2 + 2'
        }
      ],
      'formula-refusal'
    );

    expect(result.results[0]).toMatchObject({ ok: false, error: 'no_reference' });
    expect(editor.revisions.length).toBe(0);
    expect(documentContentOf(editor)).toEqual(before);
    expect(editor.enableTrackChanges).toBe(false);
    expect(container.enableTrackChanges).toBe(false);
  });

  it('refuses column insertion without changing content and forces both flags off', () => {
    const before = documentContentOf(editor);
    const result = apply(
      editor,
      [
        {
          op: 'insert_column',
          anchor: '0;1;0;0;0',
          count: 1
        } as unknown as EditOp
      ],
      'column-refusal'
    );

    expect(result.results[0]).toMatchObject({
      ok: false,
      error: 'unsupported_op',
      retry: 'never'
    });
    expect(editor.revisions.length).toBe(0);
    expect(documentContentOf(editor)).toEqual(before);
    expect(editor.enableTrackChanges).toBe(false);
    expect(container.enableTrackChanges).toBe(false);
  });
});
