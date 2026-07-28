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
});
