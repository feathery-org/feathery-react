import {
  _clearDocxEditors,
  getActiveDocxEditorTarget,
  getDocxEditor,
  registerDocxEditor,
  unregisterDocxEditor
} from '../docxEditorRegistry';

describe('docx editor registry ownership', () => {
  beforeEach(() => _clearDocxEditors());
  afterEach(() => _clearDocxEditors());

  it('unregisters only when both the instance id and editor identity match', () => {
    const editor = {};

    registerDocxEditor('document-container-a', editor, {
      stepId: 'step-a',
      documentId: 'document-a'
    });

    unregisterDocxEditor('document-container-b', editor);
    expect(getDocxEditor('document-container-a')).toBe(editor);

    unregisterDocxEditor('document-container-a', {});
    expect(getDocxEditor('document-container-a')).toBe(editor);

    unregisterDocxEditor('document-container-a', editor);
    expect(getDocxEditor('document-container-a')).toBeUndefined();
  });

  it('silently selects the lexically first container when one step has two editors', () => {
    const editorZ = {};
    const editorA = {};
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Register in the opposite order to the deterministic winner. Mount order
    // must not decide which document Robin reads.
    expect(
      registerDocxEditor('document-container-z', editorZ, {
        stepId: 'step-a',
        documentId: 'document-z'
      })
    ).toBe(true);
    expect(
      registerDocxEditor('document-container-a', editorA, {
        stepId: 'step-a',
        documentId: 'document-a'
      })
    ).toBe(true);

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(getDocxEditor()).toBe(editorA);
    expect(getActiveDocxEditorTarget()).toEqual({
      type: 'generated_document',
      id: 'document-a'
    });

    // The non-target editor remains registered as a candidate. If the selected
    // one leaves the step, the other becomes Robin's target without affecting
    // either editor's own manual editing lifecycle.
    unregisterDocxEditor('document-container-a', editorA);
    expect(getDocxEditor()).toBe(editorZ);
    expect(getActiveDocxEditorTarget()?.id).toBe('document-z');

    error.mockRestore();
    warn.mockRestore();
  });

  it('uses editor identity for an anonymous registration and rejects a missing editor', () => {
    const editor = {};

    expect(registerDocxEditor(undefined, editor)).toBe(true);
    expect(registerDocxEditor('document-container-a', null)).toBe(false);
    expect(getDocxEditor()).toBe(editor);

    unregisterDocxEditor(undefined, editor);
    expect(getDocxEditor()).toBeUndefined();
  });

  it('hands off across steps before the outgoing editor unmounts and ignores its late cleanup', () => {
    const outgoingEditor = {};
    const incomingEditor = {};

    registerDocxEditor('document-container-a', outgoingEditor, {
      stepId: 'step-a',
      documentId: 'document-a'
    });

    // React mounts the next step before it unmounts the previous step.
    registerDocxEditor('document-container-b', incomingEditor, {
      stepId: 'step-b',
      documentId: 'document-b'
    });
    expect(getDocxEditor()).toBe(incomingEditor);
    expect(getActiveDocxEditorTarget()?.id).toBe('document-b');

    // The old effect cleanup runs after the handoff and must not erase it.
    unregisterDocxEditor('document-container-a', outgoingEditor);
    expect(getDocxEditor()).toBe(incomingEditor);
    expect(getActiveDocxEditorTarget()?.id).toBe('document-b');

    unregisterDocxEditor('document-container-b', incomingEditor);
    expect(getDocxEditor()).toBeUndefined();
    expect(getActiveDocxEditorTarget()).toBeUndefined();
  });
});
