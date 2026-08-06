import { initInfo, initState } from './init';

function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Everyone who can sign has a signer row, so an envelope is always opened as
// that one signer rather than left for the server to guess.
export function getSignUrl(token: string, redirect?: boolean | string) {
  const regionPart =
    initState.region && initState.region !== 'us' ? `${initState.region}.` : '';

  let query = '';
  if (redirect) {
    if (typeof redirect === 'string') {
      if (!isValidUrl(redirect)) {
        console.error(
          `Invalid redirect URL: "${redirect}". Must be a full URL with http:// or https://`
        );
      } else {
        query = `?redirect=${encodeURIComponent(redirect)}`;
      }
    } else {
      // If redirect is true (boolean), redirect back to form
      const url = new URL(location.href);
      if (!url.searchParams.has('_id')) {
        url.searchParams.append('_id', initInfo().userId ?? '');
      }
      query = `?redirect=${encodeURIComponent(url.toString())}`;
    }
  }

  return `https://${regionPart}document.feathery.io/to/${token}${query}`;
}

/** The Document Editor container this action targets, or '' when it doesn't
 * target one. `editor_mode` is the single source of truth for how the editor is
 * presented: '' (none), 'overlay', or a container id. */
export function editorContainerId(action: Record<string, any>): string {
  const mode = action?.editor_mode;
  return mode && mode !== 'overlay' ? mode : '';
}

/** What a Document Editor container's toolbar offers, read from the same
 * `editor_toolbar_actions` key the overlay uses — `envelope_action` is always
 * 'open_in_editor' for a container and carries no outcome of its own.
 *
 * One terminal button, so the most conclusive outcome wins (Sign > Create Draft
 * > Download) and `offersDraft` puts the other signing outcome in a menu beside
 * it. 'draft' needs DocuSign; nothing else has a draft state.
 */
export function containerToolbarOutcomes(action: Record<string, any>): {
  terminalAction: 'sign' | 'download' | 'draft' | undefined;
  offersDraft: boolean;
  savesToField: boolean;
} {
  const actions: string[] = action?.editor_toolbar_actions ?? [];
  const draft = actions.includes('draft') && action?.sign_method === 'docusign';
  const sign = actions.includes('sign');
  return {
    terminalAction: sign
      ? 'sign'
      : draft
      ? 'draft'
      : actions.includes('download')
      ? 'download'
      : undefined,
    // Only meaningful beside Sign; on its own, draft *is* the terminal action.
    offersDraft: draft && sign,
    savesToField: actions.includes('save')
  };
}

// Generate Documents `sign` actions default to Feathery's own hosted eSign
// flow (`getSignUrl` above). When the action is configured for DocuSign
// instead, the backend's `{docusign_envelope_id, status}` response *is* the
// completion signal — there is no Feathery sign URL to redirect to, so
// callers must skip that redirect entirely and just continue the flow.
// The action has to actually resolve to signing, because `sign_method` is only
// meaningful for the sign action and the designer leaves a previously chosen
// `sign_method` on the action when the envelope action is switched away from
// sign. Matching the backend (which ignores sign_method unless the action
// resolves to sign) keeps a stale value from rerouting fill/download/save
// through the docusign path, where merge_docs would be silently dropped.
//
// `actingAction` is what resolves it. In the editor flow `action.envelope_action`
// is 'open_in_editor' and carries no outcome of its own — the outcome is the
// toolbar button the filler pressed, which arrives here as `actingAction`.
// Reading only `action.envelope_action` answered "not DocuSign" for every editor
// Sign / Save-as-Draft press, so the caller sent the envelope through DocuSign
// and then *also* opened Feathery's hosted eSign page (navigating the page away
// outright when `action.redirect` was set).
export function isDocusignSignAction(
  action: Record<string, any>,
  actingAction?: string
): boolean {
  const envelopeAction = actingAction ?? action?.envelope_action;
  return (
    action?.sign_method === 'docusign' &&
    (!envelopeAction || envelopeAction === 'sign')
  );
}
