// A user may keep typing while assistant-authored tracked changes are pending.
// Their edits must stay PLAIN (untracked), and must not spawn or absorb into
// tracked-change cards.
//
// The failure this pins down: typing with track-changes OFF inside a pending
// revision makes SyncFusion split that revision, and stock insertRevision
// stamps the split-off half with the CURRENT global revisionSettings
// customData — outside an assistant batch that is the host's (usually none).
// The untagged split half then surfaced in the review rail as a brand-new
// author card: "the user's change showed up as a tracked change".
// installRevisionGroupIsolation now copies the source revision's tag onto any
// split product that lacks one.
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';
import { applyDocumentEdits, LiveEditor } from '../syncfusionDocumentOps';
import { listRevisionGroups } from '../../../../utils/documentEditorPrimitives';

DocumentEditor.Inject(Editor, EditorHistory, Search, Selection, SfdtExport);

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

function makeRealDocumentEditor(sfdt: any): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

function destroyRealDocumentEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const doc = () => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'The premium is 5,500 dollars.' }] },
        { inlines: [{ text: 'Renewal is due in March.' }] }
      ]
    }
  ]
});

const revisionTexts = (ed: DocumentEditor): string[] =>
  Array.from({ length: ed.revisions.length }, (_, index) =>
    ((ed.revisions.get(index) as any).getRange?.() ?? [])
      .map((el: any) => el.text ?? '')
      .join('')
  );

const paragraphText = (ed: DocumentEditor): string => {
  ed.selection.select('0;0;0', '0;0;80');
  const text = ed.selection.text;
  ed.selection.select('0;0;0', '0;0;0');
  return text;
};

// Robin replaces 5,500 -> 6,000 as one tagged, pending change set.
function applyRobinReplace(ed: DocumentEditor) {
  const result = applyDocumentEdits(ed as unknown as LiveEditor, {
    changeSetId: 'cs-1',
    edits: [
      {
        op: 'replace_text',
        anchor: '0;0',
        find: '5,500',
        replace: '6,000',
        group: 'update-premium'
      } as any
    ]
  });
  expect(result.results[0]).toMatchObject({ ok: true });
}

describe('user edits while assistant changes are pending', () => {
  it('typing INSIDE a pending revision stays plain and spawns no new card', () => {
    const ed = makeRealDocumentEditor(doc());
    try {
      ed.enableTrackChanges = false;
      applyRobinReplace(ed);

      // Caret inside the pending revision content (offset 17 sits within the
      // tracked span), then plain typing with tracking off.
      ed.selection.select('0;0;17', '0;0;17');
      (ed as any).editorModule.insertText('XY');

      // The user's text landed in the document...
      expect(paragraphText(ed)).toContain('XY');
      // ...but inside NO revision: no tracked span holds it.
      for (const text of revisionTexts(ed)) expect(text).not.toContain('XY');

      // And the rail still shows exactly the one tagged group — the split
      // this typing forced did not surface as a new untagged author card.
      const groups = listRevisionGroups(ed as any);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        changeSetId: 'cs-1',
        group: 'update-premium'
      });
      expect(groups[0].untagged).toBeFalsy();
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('rejecting the assistant group preserves the user text typed inside it', () => {
    const ed = makeRealDocumentEditor(doc());
    try {
      ed.enableTrackChanges = false;
      applyRobinReplace(ed);
      ed.selection.select('0;0;17', '0;0;17');
      (ed as any).editorModule.insertText('XY');

      // Reject everything the assistant authored (the whole tagged group,
      // including the split half the user's typing created).
      while (ed.revisions.length) (ed.revisions.get(0) as any).reject();

      const text = paragraphText(ed);
      // Robin's insertion is gone, the original figure is back...
      expect(text).not.toContain('6,000');
      expect(text).toContain('5,');
      expect(text).toContain('500');
      // ...and the user's own text survived the reject.
      expect(text).toContain('XY');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('typing in untouched text stays plain (control)', () => {
    const ed = makeRealDocumentEditor(doc());
    try {
      ed.enableTrackChanges = false;
      applyRobinReplace(ed);
      const before = revisionTexts(ed);

      ed.selection.select('0;1;0', '0;1;0');
      (ed as any).editorModule.insertText('Hello ');

      expect(revisionTexts(ed)).toEqual(before);
      expect(listRevisionGroups(ed as any)).toHaveLength(1);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});
