/**
 * T4: every revision the engine authors is attributed to the assistant, and no
 * revision it did not author changes hands.
 *
 * Authorship is not cosmetic here - it is the key the whole write-integrity
 * story turns on. `groupNewRevisions` decides which cards belong to a change
 * set by author; the foreign-pending-revision guard decides what it may
 * overwrite by author; the conservation gate decides what to roll back by
 * author. If a write lands under the wrong name, all three quietly reason about
 * the wrong set - and nothing fails loudly.
 *
 * Two properties, and the second is the one with teeth:
 *   MINE     every revision that did not exist before the change set is the
 *            assistant's.
 *   THEIRS   every revision that DID exist still has the author it had. This is
 *            the one that catches SyncFusion re-authoring somebody else's
 *            pending change under the current user - the exact behaviour the
 *            range guard exists to prevent - so it fails if that guard is ever
 *            removed or bypassed.
 */
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

DocumentEditor.Inject(Editor, Selection, SfdtExport, EditorHistory, ImageResizer, Search);

if (!window.crypto?.getRandomValues)
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (a: Uint8Array) => require('crypto').randomFillSync(a)
    }
  });
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

// Mirrors ASSISTANT_DOCUMENT_AUTHOR, which is module-private. Asserted against
// the live document rather than imported, so this test states the contract the
// REST of the system depends on rather than echoing the constant back.
const ASSISTANT = 'Robin';
const OTHER_AUTHOR = 'Ayesha';

const para = (text: string) => ({
  paragraphFormat: {},
  characterFormat: {},
  inlines: text ? [{ characterFormat: {}, text }] : []
});

const cell = (text: string) => ({
  blocks: [para(text)],
  cellFormat: { columnSpan: 1, rowSpan: 1 }
});

const doc = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        para('Alpha beta gamma delta.'),
        para('Second paragraph for moves and breaks.'),
        {
          rows: [
            { rowFormat: {}, cells: [cell('Item'), cell('Amount')] },
            { rowFormat: {}, cells: [cell('Website'), cell('7800')] }
          ]
        },
        para('Trailing paragraph.')
      ]
    }
  ]
});

let editor: DocumentEditor;

const open = () => {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableSfdtExport: true,
    enableEditorHistory: true,
    enableSearch: true,
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(doc()));
  return editor as unknown as LiveEditor;
};

const teardown = () => {
  if (!editor) return;
  const element = editor.element;
  editor.destroy();
  element?.remove();
};

const revisionList = (): Array<{ id: string; author: string }> => {
  const revisions = (editor as any).revisions;
  const out: Array<{ id: string; author: string }> = [];
  for (let i = 0; i < (revisions?.length ?? 0); i++) {
    const revision = revisions[i] ?? revisions.get?.(i);
    if (revision)
      out.push({ id: String(revision.revisionID), author: String(revision.author) });
  }
  return out;
};

const apply = (live: LiveEditor, edits: any[], id: string) =>
  applyDocumentEdits(live, { changeSetId: id, edits }) as any;

// One op per write-shape the engine supports on this document: an in-place text
// replacement, a deletion, a cell write, and an additive insertion. If a future
// op introduces a new write primitive, it belongs here.
const OPS: Array<{ name: string; edit: any }> = [
  { name: 'replace_text', edit: { op: 'replace_text', anchor: '0;0', find: 'beta', replace: 'BETA', group: 'g' } },
  { name: 'delete_text', edit: { op: 'delete_text', anchor: '0;0', find: 'gamma ', group: 'g' } },
  { name: 'set_cell_text', edit: { op: 'set_cell_text', anchor: '0;2;1;1;0', text: '9900', group: 'g' } },
  { name: 'insert_text', edit: { op: 'insert_text', anchor: '0;1', position: 'end', text: ' Added.', group: 'g' } }
];

describe('revision authorship', () => {
  afterEach(teardown);

  describe('MINE: every revision the engine creates is the assistant\'s', () => {
    it.each(OPS.map((o) => [o.name, o.edit] as const))(
      '%s attributes its revisions to the assistant',
      (name, edit) => {
        const live = open();
        const before = new Set(revisionList().map((r) => r.id));
        const result = apply(live, [edit], `authorship-${name}`);
        // NO ESCAPE HATCH. This used to accept a refusal and return early,
        // which meant an engine where EVERY op refused would pass the whole
        // suite green - the test would have been measuring nothing. These four
        // ops are chosen to succeed on this document; if one starts refusing,
        // that is a regression and this must go red.
        expect(result.results[0].ok).toBe(true);
        const created = revisionList().filter((r) => !before.has(r.id));
        expect(created.length).toBeGreaterThan(0);
        for (const revision of created) expect(revision.author).toBe(ASSISTANT);
      }
    );
  });

  describe('THEIRS: a foreign revision never changes hands', () => {
    it('another author\'s pending change keeps its author across a change set', () => {
      const live = open();
      editor.currentUser = OTHER_AUTHOR;
      editor.enableTrackChanges = true;
      editor.selection.select('0;1;0', '0;1;0');
      editor.editor.insertText('THEIRS ');
      editor.enableTrackChanges = false;

      const foreignBefore = revisionList().filter((r) => r.author === OTHER_AUTHOR);
      expect(foreignBefore.length).toBeGreaterThan(0);

      // Aimed at the FOREIGN REVISION'S OWN TEXT, not merely its block.
      // Aiming elsewhere - even in the same paragraph - now passes on its own,
      // because the narrowing correctly permits it; so that version of this
      // test would stay green with the guard deleted. Overlapping their run is
      // the only aim where the ONLY reason their revision survives is that the
      // guard refused.
      const result = apply(
        live,
        [{ op: 'replace_text', anchor: '0;1', find: 'THEIRS', replace: 'OURS', group: 'g' }],
        'authorship-foreign-untouched'
      );
      // Refusing is the CORRECT outcome here - the point is what happens to
      // their revision, not whether our write lands.
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('pending_revision_in_range');

      const after = revisionList();
      for (const original of foreignBefore) {
        const still = after.find((r) => r.id === original.id);
        // Present, and still theirs. Either half failing means a later
        // accept/reject would no longer do what its author intended.
        expect(still).toBeDefined();
        expect(still?.author).toBe(OTHER_AUTHOR);
      }
    });
  });
});
