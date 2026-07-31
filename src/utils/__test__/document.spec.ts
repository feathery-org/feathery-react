import { editorContainerId } from '../document';

describe('editorContainerId', () => {
  // `editor_mode` is the single source of truth for how the editor is
  // presented: '' (none), 'overlay', or a Document Editor container id.
  it('returns the container id when the editor targets one', () => {
    expect(editorContainerId({ editor_mode: 'container-abc' })).toBe(
      'container-abc'
    );
  });

  it('returns empty for the overlay editor', () => {
    expect(editorContainerId({ editor_mode: 'overlay' })).toBe('');
  });

  it('returns empty when no editor is configured', () => {
    expect(editorContainerId({ editor_mode: '' })).toBe('');
    expect(editorContainerId({})).toBe('');
  });
});
