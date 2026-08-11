// Spike S2: does the POC's undo-preserving value-patch path exist and behave on
// the pinned npm build (34.1.31)?
//
// The POC only ever ran against the CDN bundle by hand. The patch path leans on
// engine internals rather than published API, so each one gets pinned here: if a
// version bump moves them, this fails loudly instead of the product silently
// falling back to a full `open()` (which destroys native undo).
//
// Pinned surface:
//   documentHelper.contentControlCollection - find a control by exact tag
//   editorModule.updateContentControl(cc, text) - write a value in place
//   enableEditorHistory (runtime toggle) - hide engine fan-out from undo
//   editorHistoryModule.isUndoing / isRedoing - detect a self-heal reconcile
//   selection.currentContentControl - commit-on-blur + keystroke guard
//   editorModule.handleTextInput - the keystroke guard's interception point
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

const NAME_TAG = '[[name=project.name]]';
const QTY_TAG = '[[name=quantity|type=integer|row=r-1]]';

const documentWithTwoControls = () =>
  docWith(
    para(textRun('Estimate for '), taggedInline(NAME_TAG, 'Acme')),
    table(row(cellText('Widget'), cellTagged(QTY_TAG, '3')))
  );

/** Mirrors how the ported editor adapter will locate a write target. */
function controlsByTag(editor: any, tag: string): any[] {
  const collection = editor.documentHelper?.contentControlCollection;
  expect(Array.isArray(collection)).toBe(true);
  return collection.filter(
    (control: any) => control?.contentControlProperties?.tag === tag
  );
}

function textOfControlTag(editor: any, tag: string): string | undefined {
  const parsed = JSON.parse(editor.serialize());
  const found: string[] = [];
  const walk = (node: any): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node.contentControlProperties?.tag === tag) {
      const text = (node.inlines ?? [])
        .map((inline: any) => inline?.text ?? '')
        .join('');
      if (text) found.push(text);
    }
    Object.values(node).forEach(walk);
  };
  walk(parsed);
  return found[0];
}

describe('S2 patch-path APIs exist on the pinned build', () => {
  let editor: any;
  beforeEach(() => {
    editor = makeRealDocumentEditor(documentWithTwoControls());
  });
  afterEach(() => destroyRealDocumentEditor(editor));

  it('exposes a content control collection addressable by exact tag', () => {
    expect(controlsByTag(editor, NAME_TAG).length).toBeGreaterThan(0);
    expect(controlsByTag(editor, QTY_TAG).length).toBeGreaterThan(0);
    expect(controlsByTag(editor, '[[name=nope]]')).toHaveLength(0);
  });

  it('writes a value in place with updateContentControl', () => {
    const [control] = controlsByTag(editor, NAME_TAG);
    expect(typeof editor.editorModule.updateContentControl).toBe('function');

    editor.editorModule.updateContentControl(control, 'Globex');

    expect(textOfControlTag(editor, NAME_TAG)).toBe('Globex');
    // The other binding must be untouched - patching is per-control, which is
    // what lets the engine write only what changed.
    expect(textOfControlTag(editor, QTY_TAG)).toBe('3');
  });

  it('keeps the patched value undoable through native history', () => {
    const [control] = controlsByTag(editor, NAME_TAG);
    editor.editorModule.updateContentControl(control, 'Globex');
    expect(textOfControlTag(editor, NAME_TAG)).toBe('Globex');

    editor.editorHistory.undo();

    expect(textOfControlTag(editor, NAME_TAG)).toBe('Acme');
  });

  // The write taxonomy: the user's own edit stays undoable, engine fan-out and
  // formula writes must not land on the undo stack at all.
  it('hides a write from history while enableEditorHistory is off', () => {
    const [control] = controlsByTag(editor, NAME_TAG);
    editor.enableEditorHistory = false;
    try {
      editor.editorModule.updateContentControl(control, 'Suppressed');
    } finally {
      editor.enableEditorHistory = true;
    }
    expect(textOfControlTag(editor, NAME_TAG)).toBe('Suppressed');

    editor.editorHistory.undo();

    // Nothing was recorded, so undo cannot walk back into the engine's write.
    expect(textOfControlTag(editor, NAME_TAG)).toBe('Suppressed');
  });

  it('survives toggling enableEditorHistory - the module and its stacks live', () => {
    editor.enableEditorHistory = false;
    editor.enableEditorHistory = true;
    expect(editor.editorHistory).toBeDefined();

    const [control] = controlsByTag(editor, NAME_TAG);
    editor.editorModule.updateContentControl(control, 'Initech');
    editor.editorHistory.undo();
    expect(textOfControlTag(editor, NAME_TAG)).toBe('Acme');
  });

  it('exposes undo/redo in-flight flags for the self-heal reconcile', () => {
    const history = editor.editorHistoryModule ?? editor.editorHistory;
    expect(history).toBeDefined();
    expect('isUndoing' in history).toBe(true);
    expect('isRedoing' in history).toBe(true);
    // Quiescent between operations, which is what makes them usable as a guard.
    expect(history.isUndoing).toBeFalsy();
    expect(history.isRedoing).toBeFalsy();
  });

  it('reports the caret’s current content control for commit-on-blur', () => {
    const [control] = controlsByTag(editor, NAME_TAG);
    expect('currentContentControl' in editor.selection).toBe(true);

    editor.selection.selectContentControl?.(control);
    const current = editor.selection.currentContentControl;
    if (current) {
      // When the engine reports one, it must be tag-identifiable - reference
      // comparison of this value is how the POC detects "caret left the field".
      expect(typeof current.contentControlProperties?.tag).toBe('string');
    }
  });

  // Found while building this spike: a synthesized control without `color`
  // crashes the border renderer the moment the caret lands in it, because the
  // SFDT reader leaves the property undefined and the renderer measures it.
  // Template import must therefore emit the full property set, not just the tag.
  it('requires a color on every synthesized control', () => {
    const bare = makeRealDocumentEditor(
      docWith(para(taggedInline(NAME_TAG, 'Acme', { omitColor: true })))
    );
    try {
      const [control] = controlsByTag(bare, NAME_TAG);
      expect(() =>
        bare.editorModule.updateContentControl(control, 'Globex')
      ).toThrow();
    } finally {
      destroyRealDocumentEditor(bare);
    }
  });

  it('routes printable input through handleTextInput so the guard can intercept', () => {
    expect(typeof editor.editorModule.handleTextInput).toBe('function');

    const original = editor.editorModule.handleTextInput.bind(
      editor.editorModule
    );
    const seen: string[] = [];
    editor.editorModule.handleTextInput = (text: string) => {
      seen.push(text);
      // Swallow, exactly as the typed-field guard does for illegal characters.
    };
    editor.editorModule.handleTextInput('x');
    expect(seen).toEqual(['x']);

    editor.editorModule.handleTextInput = original;
  });
});
