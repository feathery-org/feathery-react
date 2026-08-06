import {
  _clearDocxEditors,
  getActiveDocxEditorEnvelopeTarget,
  getActiveDocxEditorTarget,
  getDocxEditor,
  registerDocxEditor,
  subscribeDocxEditors,
  unregisterDocxEditor
} from '../docxEditorRegistry';

describe('docx editor registry ownership', () => {
  beforeEach(() => _clearDocxEditors());
  afterEach(() => _clearDocxEditors());

  it('keeps editor registrations isolated between forms', () => {
    const editorA = {};
    const editorB = {};

    registerDocxEditor('document-container', editorA, {
      formId: 'form-a',
      stepId: 'step-a',
      documentId: 'document-a',
      envelopeId: 'envelope-a'
    });
    registerDocxEditor('document-container', editorB, {
      formId: 'form-b',
      stepId: 'step-b',
      documentId: 'document-b',
      envelopeId: 'envelope-b'
    });

    expect(getDocxEditor('form-a')).toBe(editorA);
    expect(getActiveDocxEditorTarget('form-a')?.id).toBe('document-a');
    expect(getActiveDocxEditorEnvelopeTarget('form-a')?.id).toBe('envelope-a');
    expect(getDocxEditor('form-b')).toBe(editorB);
    expect(getActiveDocxEditorTarget('form-b')?.id).toBe('document-b');
    expect(getActiveDocxEditorEnvelopeTarget('form-b')?.id).toBe('envelope-b');

    unregisterDocxEditor('document-container', editorA, 'form-a');
    expect(getDocxEditor('form-a')).toBeUndefined();
    expect(getDocxEditor('form-b')).toBe(editorB);
  });

  it('notifies only the subscriber for the registering form', () => {
    const listenerA = jest.fn();
    const listenerB = jest.fn();
    subscribeDocxEditors(listenerA, 'form-a');
    subscribeDocxEditors(listenerB, 'form-b');
    const editorA = {};
    const editorB = {};

    registerDocxEditor('document-container-a', editorA, {
      formId: 'form-a'
    });
    expect(listenerA).toHaveBeenLastCalledWith(
      expect.objectContaining({ editor: editorA })
    );
    expect(listenerB).not.toHaveBeenCalled();

    registerDocxEditor('document-container-b', editorB, {
      formId: 'form-b'
    });
    expect(listenerB).toHaveBeenLastCalledWith(
      expect.objectContaining({ editor: editorB })
    );
    expect(listenerA).toHaveBeenCalledTimes(1);
  });

  it('preserves the handoff and retirement lifecycle within each form', () => {
    const firstEditor = {};
    const nextEditor = {};
    const revisitedEditor = {};

    registerDocxEditor('document-container-a', firstEditor, {
      formId: 'form-a',
      stepId: 'step-a'
    });
    registerDocxEditor('document-container-b', nextEditor, {
      formId: 'form-a',
      stepId: 'step-b'
    });

    expect(getDocxEditor('form-a')).toBe(nextEditor);
    expect(
      registerDocxEditor('document-container-a', firstEditor, {
        formId: 'form-a',
        stepId: 'step-a'
      })
    ).toBe(false);
    expect(getDocxEditor('form-a')).toBe(nextEditor);

    expect(
      registerDocxEditor('document-container-a', revisitedEditor, {
        formId: 'form-a',
        stepId: 'step-a'
      })
    ).toBe(true);
    expect(getDocxEditor('form-a')).toBe(revisitedEditor);
  });

  it('unregisters only when both the instance id and editor identity match', () => {
    const editor = {};

    registerDocxEditor('document-container-a', editor, {
      stepId: 'step-a',
      documentId: 'document-a'
    });

    unregisterDocxEditor('document-container-b', editor);
    expect(getDocxEditor()).toBe(editor);

    unregisterDocxEditor('document-container-a', {});
    expect(getDocxEditor()).toBe(editor);

    unregisterDocxEditor('document-container-a', editor);
    expect(getDocxEditor()).toBeUndefined();
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
        formId: 'form-a',
        stepId: 'step-a',
        documentId: 'document-z'
      })
    ).toBe(true);
    expect(
      registerDocxEditor('document-container-a', editorA, {
        formId: 'form-a',
        stepId: 'step-a',
        documentId: 'document-a',
        envelopeId: 'envelope-a'
      })
    ).toBe(true);

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(getDocxEditor('form-a')).toBe(editorA);
    expect(getActiveDocxEditorTarget('form-a')).toEqual({
      type: 'generated_document',
      id: 'document-a'
    });
    expect(getActiveDocxEditorEnvelopeTarget('form-a')).toEqual({
      type: 'envelope',
      id: 'envelope-a'
    });

    // The non-target editor remains registered as a candidate. If the selected
    // one leaves the step, the other becomes Robin's target without affecting
    // either editor's own manual editing lifecycle.
    unregisterDocxEditor('document-container-a', editorA, 'form-a');
    expect(getDocxEditor('form-a')).toBe(editorZ);
    expect(getActiveDocxEditorTarget('form-a')?.id).toBe('document-z');
    expect(getActiveDocxEditorEnvelopeTarget('form-a')).toBeUndefined();

    error.mockRestore();
    warn.mockRestore();
  });

  it('uses editor identity for an anonymous registration and rejects a missing editor', () => {
    const editor = {};
    const namedEditor = {};

    expect(registerDocxEditor(undefined, editor)).toBe(true);
    expect(
      registerDocxEditor('document-container-a', namedEditor, {
        formId: 'form-a'
      })
    ).toBe(true);
    expect(registerDocxEditor('document-container-a', null)).toBe(false);
    expect(getDocxEditor()).toBe(editor);
    expect(getDocxEditor('form-a')).toBe(namedEditor);

    unregisterDocxEditor(undefined, editor);
    expect(getDocxEditor()).toBeUndefined();
    expect(getDocxEditor('form-a')).toBe(namedEditor);
  });

  it('hands off across steps before the outgoing editor unmounts and ignores its late cleanup', () => {
    const outgoingEditor = {};
    const incomingEditor = {};

    registerDocxEditor('document-container-a', outgoingEditor, {
      stepId: 'step-a',
      documentId: 'document-a',
      envelopeId: 'envelope-a'
    });

    // React mounts the next step before it unmounts the previous step.
    registerDocxEditor('document-container-b', incomingEditor, {
      stepId: 'step-b',
      documentId: 'document-b',
      envelopeId: 'envelope-b'
    });
    expect(getDocxEditor()).toBe(incomingEditor);
    expect(getActiveDocxEditorTarget()?.id).toBe('document-b');
    expect(getActiveDocxEditorEnvelopeTarget()?.id).toBe('envelope-b');

    // The old effect cleanup runs after the handoff and must not erase it.
    unregisterDocxEditor('document-container-a', outgoingEditor);
    expect(getDocxEditor()).toBe(incomingEditor);
    expect(getActiveDocxEditorTarget()?.id).toBe('document-b');
    expect(getActiveDocxEditorEnvelopeTarget()?.id).toBe('envelope-b');

    unregisterDocxEditor('document-container-b', incomingEditor);
    expect(getDocxEditor()).toBeUndefined();
    expect(getActiveDocxEditorTarget()).toBeUndefined();
    expect(getActiveDocxEditorEnvelopeTarget()).toBeUndefined();
  });

  it('rejects_late_reregister_from_superseded_outgoing_editor', () => {
    const outgoingEditor = {};
    const incomingEditor = {};

    registerDocxEditor('document-container-a', outgoingEditor, {
      stepId: 'step-a',
      documentId: 'document-a'
    });
    registerDocxEditor('document-container-b', incomingEditor, {
      stepId: 'step-b',
      documentId: 'document-b'
    });

    expect(
      registerDocxEditor('document-container-a', outgoingEditor, {
        stepId: 'step-a',
        documentId: 'document-a'
      })
    ).toBe(false);
    expect(getDocxEditor()).toBe(incomingEditor);

    unregisterDocxEditor('document-container-a', outgoingEditor);
    expect(getDocxEditor()).toBe(incomingEditor);
  });

  it('allows_new_editor_instance_when_navigating_back_to_prior_step', () => {
    const firstEditorA = {};
    const editorB = {};
    const revisitedEditorA = {};

    registerDocxEditor('document-container-a', firstEditorA, {
      stepId: 'step-a'
    });
    registerDocxEditor('document-container-b', editorB, {
      stepId: 'step-b'
    });

    expect(
      registerDocxEditor('document-container-a', revisitedEditorA, {
        stepId: 'step-a'
      })
    ).toBe(true);
    expect(getDocxEditor()).toBe(revisitedEditorA);
  });

  it('resets superseded editor identity between registry lifecycles', () => {
    const outgoingEditor = {};

    registerDocxEditor('document-container-a', outgoingEditor, {
      stepId: 'step-a'
    });
    registerDocxEditor(
      'document-container-b',
      {},
      {
        stepId: 'step-b'
      }
    );
    expect(registerDocxEditor('document-container-a', outgoingEditor)).toBe(
      false
    );

    _clearDocxEditors();

    expect(registerDocxEditor('document-container-a', outgoingEditor)).toBe(
      true
    );
  });
});
