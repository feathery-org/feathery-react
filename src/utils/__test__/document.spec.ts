import { containerToolbarOutcomes, editorContainerId } from '../document';

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

describe('containerToolbarOutcomes', () => {
  // A container reads the same `editor_toolbar_actions` key the overlay does;
  // `envelope_action` is always 'open_in_editor' and carries no outcome.
  it('prefers sign over download for the single terminal button', () => {
    expect(
      containerToolbarOutcomes({
        envelope_action: 'open_in_editor',
        editor_toolbar_actions: ['download', 'sign']
      }).terminalAction
    ).toBe('sign');
  });

  it('uses download when no signing action is offered', () => {
    expect(
      containerToolbarOutcomes({ editor_toolbar_actions: ['download'] })
        .terminalAction
    ).toBe('download');
  });

  it('reports save separately from the terminal action', () => {
    expect(
      containerToolbarOutcomes({ editor_toolbar_actions: ['save', 'sign'] })
    ).toEqual({ terminalAction: 'sign', savesToField: true });
  });

  it('ignores draft, which only DocuSign supports', () => {
    expect(
      containerToolbarOutcomes({ editor_toolbar_actions: ['draft'] })
    ).toEqual({ terminalAction: undefined, savesToField: false });
  });

  it('offers no terminal action when nothing is configured', () => {
    expect(containerToolbarOutcomes({})).toEqual({
      terminalAction: undefined,
      savesToField: false
    });
  });
});
