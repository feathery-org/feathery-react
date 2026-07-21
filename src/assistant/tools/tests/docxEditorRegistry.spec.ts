import {
  _clearDocxEditors,
  getDocxEditor,
  registerDocxEditor,
  unregisterDocxEditor
} from '../docxEditorRegistry';

afterEach(() => _clearDocxEditors());

describe('docxEditorRegistry', () => {
  it('registers and resolves an editor by form id', () => {
    const ed = { id: 'A' };
    registerDocxEditor('form1', ed);
    expect(getDocxEditor('form1')).toBe(ed);
  });

  it('ignores registration with no form id or no editor', () => {
    registerDocxEditor(undefined, { id: 'x' });
    registerDocxEditor('form1', null);
    expect(getDocxEditor('form1')).toBeUndefined();
  });

  it('falls back to the sole registered editor when the id does not match', () => {
    const ed = { id: 'only' };
    registerDocxEditor('form1', ed);
    expect(getDocxEditor()).toBe(ed);
    expect(getDocxEditor('other')).toBe(ed);
  });

  it('does not guess when multiple editors are registered', () => {
    registerDocxEditor('form1', { id: 'A' });
    registerDocxEditor('form2', { id: 'B' });
    expect(getDocxEditor('form1')).toEqual({ id: 'A' });
    expect(getDocxEditor('missing')).toBeUndefined();
  });

  it('unregisters, and only clears the entry if it still owns it', () => {
    const first = { id: 'first' };
    const second = { id: 'second' };
    registerDocxEditor('form1', first);
    // A remount replaced the entry; unregistering the stale instance is a no-op.
    registerDocxEditor('form1', second);
    unregisterDocxEditor('form1', first);
    expect(getDocxEditor('form1')).toBe(second);
    unregisterDocxEditor('form1', second);
    expect(getDocxEditor('form1')).toBeUndefined();
  });
});
