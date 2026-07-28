import {
  _clearDocxEditors,
  getDocxEditor,
  registerDocxEditor,
  unregisterDocxEditor
} from '../docxEditorRegistry';

describe('docx editor registry ownership', () => {
  beforeEach(() => _clearDocxEditors());
  afterEach(() => _clearDocxEditors());

  it('unregisters only when both the instance id and editor identity match', () => {
    const editor = {};

    registerDocxEditor('document-container-a', editor);

    unregisterDocxEditor('document-container-b', editor);
    expect(getDocxEditor('document-container-a')).toBe(editor);

    unregisterDocxEditor('document-container-a', {});
    expect(getDocxEditor('document-container-a')).toBe(editor);

    unregisterDocxEditor('document-container-a', editor);
    expect(getDocxEditor('document-container-a')).toBeUndefined();
  });

  it('rejects a second editor with a clear diagnostic instead of absorbing it', () => {
    const firstEditor = {};
    const secondEditor = {};
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(registerDocxEditor('document-container-a', firstEditor)).toBe(true);
    expect(registerDocxEditor('document-container-b', secondEditor)).toBe(
      false
    );

    expect(error).toHaveBeenCalledWith(
      'Feathery: only one document editor is supported per form. ' +
        'Ignored "document-container-b" because ' +
        '"document-container-a" is already registered.'
    );
    expect(getDocxEditor()).toBe(firstEditor);

    unregisterDocxEditor('document-container-b', secondEditor);
    expect(getDocxEditor()).toBe(firstEditor);

    error.mockRestore();
  });
});
