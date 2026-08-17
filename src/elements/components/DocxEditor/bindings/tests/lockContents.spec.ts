// Spike S3: what protects a bound control, and what destroys one?
//
// The POC left one question open ("does lockContents block deletion via
// row/selection deletes, or only typing?") and answered it with defence in
// depth: reconcile overwrites tampered formula cells regardless. This spike
// settles the question and turns up a sharper one the plan had backwards.
//
// Findings, all asserted below:
//   1. `updateContentControl` writes a control's contents and keeps the control.
//      It ignores lockContents, which is exactly what makes tamper-revert work.
//   2. `selectContentControl` + `insertText` DESTROYS the control - tag and all -
//      whether or not it is locked. So the assistant engine's write primitive
//      (select a range, replaceSelectedText) must never be aimed at a bound
//      control: it would silently delete the binding, not just its value.
//   3. Deletion is not gated by lockContents. `deleteRow` takes row-scoped
//      bindings with it (the POC's intent) and select-all + delete wipes every
//      binding, so reconcile has to tolerate a document whose tags are gone.
//
// Not covered here: the real keystroke path. Printable characters reach
// `handleTextInput` from a focused hidden editable div, which jsdom does not
// drive - calling it directly is inert even on an unlocked control, so it proves
// nothing either way. Whether lockContents stops a *user* typing needs a browser
// check; the engine-level revert above is what the product actually relies on.
import {
  cellTagged,
  cellText,
  destroyRealDocumentEditor,
  docWith,
  makeRealDocumentEditor,
  para,
  row,
  table,
  taggedInline,
  textRun
} from './realEditorHarness';

const LOCKED_TAG = '[[name=line_total|expr=mul(quantity,unit_cost)|row=r-1]]';
const ROW1_TAG = '[[name=quantity|type=integer|row=r-1]]';
const ROW2_TAG = '[[name=quantity|type=integer|row=r-2]]';

/** block 0 = prose with a locked formula, block 1 = header + two bound rows. */
const boundDocument = () =>
  docWith(
    para(
      textRun('Total: '),
      taggedInline(LOCKED_TAG, '$30.00', { lockContents: true })
    ),
    table(
      row(cellText('Item'), cellText('Qty')),
      row(cellText('Widget'), cellTagged(ROW1_TAG, '3')),
      row(cellText('Gadget'), cellTagged(ROW2_TAG, '5'))
    )
  );

const simpleDocument = (locked: boolean) =>
  docWith(
    para(
      textRun('X: '),
      taggedInline(LOCKED_TAG, 'VALUE', { lockContents: locked })
    )
  );

function controlsByTag(editor: any, tag: string): any[] {
  return (editor.documentHelper?.contentControlCollection ?? []).filter(
    (control: any) => control?.contentControlProperties?.tag === tag
  );
}

interface BoundOccurrence {
  tag: string;
  lockContents: boolean;
  text: string;
}

function occurrences(editor: any): BoundOccurrence[] {
  const found: BoundOccurrence[] = [];
  const walk = (node: any): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const properties = node.contentControlProperties;
    if (properties?.tag) {
      found.push({
        tag: properties.tag,
        lockContents: !!properties.lockContents,
        text: (node.inlines ?? [])
          .map((inline: any) => inline?.text ?? '')
          .join('')
      });
    }
    Object.values(node).forEach(walk);
  };
  walk(JSON.parse(editor.serialize()));
  return found;
}

const tagsOf = (editor: any) => occurrences(editor).map((entry) => entry.tag);
const textOf = (editor: any, tag: string) =>
  occurrences(editor).find((entry) => entry.tag === tag)?.text;

describe('S3 updateContentControl is the safe write primitive', () => {
  it.each([
    ['a locked control', true],
    ['an unlocked control', false]
  ])('writes %s in place and keeps the binding', (_label, locked) => {
    const editor = makeRealDocumentEditor(simpleDocument(locked as boolean));
    try {
      const [control] = controlsByTag(editor, LOCKED_TAG);

      editor.editorModule.updateContentControl(control, 'REPLACED');

      // lockContents gates the user, never the reconciler - this is the whole
      // mechanism behind "tampered formula reverts to the computed value".
      expect(textOf(editor, LOCKED_TAG)).toBe('REPLACED');
      expect(tagsOf(editor)).toContain(LOCKED_TAG);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });
});

describe('S3 selection + insertText destroys a bound control', () => {
  it.each([
    ['a locked control', true],
    ['an unlocked control', false]
  ])('removes %s outright, tag included', (_label, locked) => {
    const editor = makeRealDocumentEditor(simpleDocument(locked as boolean));
    try {
      const [control] = controlsByTag(editor, LOCKED_TAG);
      expect(tagsOf(editor)).toContain(LOCKED_TAG);

      editor.selection.selectContentControl(control);
      editor.editor.insertText('Z');

      // The binding is gone, not merely overwritten. Any port that reuses the
      // assistant's select-then-replace primitive for bound cells deletes the
      // author's binding on the first write.
      expect(tagsOf(editor)).not.toContain(LOCKED_TAG);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });
});

describe('S3 deletion is not gated by lockContents', () => {
  it('takes row-scoped bindings with the row and leaves the others', () => {
    const editor = makeRealDocumentEditor(boundDocument());
    try {
      expect(tagsOf(editor)).toEqual(
        expect.arrayContaining([LOCKED_TAG, ROW1_TAG, ROW2_TAG])
      );

      // Caret into the second bound row (table is block 1, row index 2).
      editor.selection.select('0;1;2;1;0;0', '0;1;2;1;0;0');
      editor.editorModule.deleteRow();

      const remaining = tagsOf(editor);
      expect(remaining).not.toContain(ROW2_TAG);
      // Row-scoped bindings die with their row by design; everything else
      // survives, so a row delete is a normal structural edit, not corruption.
      expect(remaining).toContain(ROW1_TAG);
      expect(remaining).toContain(LOCKED_TAG);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('lets select-all + delete wipe every binding, locked ones included', () => {
    const editor = makeRealDocumentEditor(boundDocument());
    try {
      editor.selection.selectAll();
      editor.editorModule.delete();

      // Reconcile must treat "no bindings at all" as a legal document state
      // rather than an error, because one keystroke can produce it.
      expect(tagsOf(editor)).toEqual([]);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });
});
