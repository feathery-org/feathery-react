import {
  containerToolbarOutcomes,
  editorContainerId,
  isDocusignSignAction
} from '../document';

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
    ).toEqual({
      terminalAction: 'sign',
      offersDraft: false,
      offersDownload: false,
      savesToField: true
    });
  });

  it('offers draft beside sign for a DocuSign action', () => {
    expect(
      containerToolbarOutcomes({
        sign_method: 'docusign',
        editor_toolbar_actions: ['sign', 'draft']
      })
    ).toEqual({
      terminalAction: 'sign',
      offersDraft: true,
      offersDownload: false,
      savesToField: false
    });
  });

  it('makes draft the terminal action when sign is not offered', () => {
    expect(
      containerToolbarOutcomes({
        sign_method: 'docusign',
        editor_toolbar_actions: ['draft']
      })
    ).toEqual({
      terminalAction: 'draft',
      offersDraft: false,
      offersDownload: false,
      savesToField: false
    });
  });

  it('drops draft without DocuSign, the only backend with a draft state', () => {
    expect(
      containerToolbarOutcomes({
        sign_method: 'feathery',
        editor_toolbar_actions: ['draft']
      })
    ).toEqual({
      terminalAction: undefined,
      offersDraft: false,
      offersDownload: false,
      savesToField: false
    });
  });

  it('offers download beside a terminal sign when both are configured', () => {
    expect(
      containerToolbarOutcomes({ editor_toolbar_actions: ['sign', 'download'] })
    ).toEqual({
      terminalAction: 'sign',
      offersDraft: false,
      offersDownload: true,
      savesToField: false
    });
  });

  it('offers no terminal action when nothing is configured', () => {
    expect(containerToolbarOutcomes({})).toEqual({
      terminalAction: undefined,
      offersDraft: false,
      offersDownload: false,
      savesToField: false
    });
  });
});

describe('isDocusignSignAction', () => {
  it('returns true when the action is configured for docusign sign', () => {
    expect(isDocusignSignAction({ sign_method: 'docusign' })).toBe(true);
  });

  it('returns false when sign_method is feathery (regression)', () => {
    expect(isDocusignSignAction({ sign_method: 'feathery' })).toBe(false);
  });

  it('returns false when sign_method is absent (regression)', () => {
    expect(isDocusignSignAction({})).toBe(false);
  });

  it('returns false for an unrecognized sign_method value', () => {
    expect(isDocusignSignAction({ sign_method: 'something-else' })).toBe(false);
  });

  it('returns true when envelope_action is explicitly sign', () => {
    expect(
      isDocusignSignAction({ sign_method: 'docusign', envelope_action: 'sign' })
    ).toBe(true);
  });

  it.each(['fill', 'download', 'save'])(
    'returns false for a stale docusign sign_method on a %s action',
    (envelopeAction) => {
      expect(
        isDocusignSignAction({
          sign_method: 'docusign',
          envelope_action: envelopeAction
        })
      ).toBe(false);
    }
  );

  describe('editor flow (envelope_action is open_in_editor)', () => {
    const editorAction = {
      sign_method: 'docusign',
      envelope_action: 'open_in_editor'
    };

    // Without the acting action this answered false, so the caller sent the
    // envelope through DocuSign and then *also* opened Feathery's hosted eSign
    // page — navigating the page away outright when action.redirect was set.
    it('returns true for a Sign press in the editor', () => {
      expect(isDocusignSignAction(editorAction, 'sign')).toBe(true);
    });

    it.each(['download', 'save', 'fill'])(
      'returns false for a %s press in the editor',
      (actingAction) => {
        expect(isDocusignSignAction(editorAction, actingAction)).toBe(false);
      }
    );

    it('returns false for an editor sign press routed through feathery', () => {
      expect(
        isDocusignSignAction(
          { sign_method: 'feathery', envelope_action: 'open_in_editor' },
          'sign'
        )
      ).toBe(false);
    });

    it('falls back to envelope_action with no acting action', () => {
      // The direct (non-editor) path calls it with one argument.
      expect(isDocusignSignAction(editorAction)).toBe(false);
      expect(isDocusignSignAction({ sign_method: 'docusign' })).toBe(true);
    });
  });
});
