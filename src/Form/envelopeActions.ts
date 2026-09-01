import { downloadAllFileUrls, featheryWindow, openTab } from '../utils/browser';
import { replaceTextVariables } from '../elements/components/TextNodes';
import {
  editorContainerId,
  getSignUrl,
  isDocusignSignAction
} from '../utils/document';

// Fired after a Generate Documents action targeting a document-editor
// container, so an already mounted editor reloads the freshly generated
// envelope. The pending-drafts map covers an editor on a different step,
// which consumes the stored draft on mount instead.
export const EDITOR_REFRESH_EVENT = 'feathery-docx-editor-refresh';
export const PENDING_EDITOR_DRAFTS_KEY = '__featheryDocxEditorDrafts';

export interface ReviewFinalizeParams {
  envelopes: { envelopeId: string; signerId?: string }[];
  envelopeAction: 'sign' | 'fill' | 'download' | 'save';
  // DocuSign sign only: save the envelope as a draft instead of sending it.
  draft: boolean;
}

// The client surface this module needs; structurally typed so tests don't have
// to build a full FeatheryClient.
export interface EnvelopeOutcomeClient {
  submitCustom: (values: Record<string, any>) => Promise<any> | any;
  finalizeEnvelopeReview: (
    action: Record<string, any>,
    params: ReviewFinalizeParams
  ) => Promise<any>;
}

export interface EnvelopeOutcomeDeps {
  client: EnvelopeOutcomeClient;
  updateFieldValues: (values: Record<string, any>) => void;
  // Already bound to the caller's toast id, so the action flow and the
  // logic-rule flow report through their own toasts.
  showOutcome: (label: string, documents?: string[]) => void;
  // A step-flow sign redirect registers a completion event and navigates the
  // page. A logic-rule invocation has no step to complete, so it omits this
  // and the sign page opens in a new tab instead (the redirect URL param is
  // still encoded into the sign link either way).
  navigateToSignUrl?: (url: string) => Promise<void> | void;
}

// Runs the outcome of a Generate Documents response: the sign
// redirect/DocuSign completion, download, or save-to-field handling.
//
// `actingAction` is the outcome to apply — the configured envelope_action on
// the direct path, or the toolbar button the filler pressed in the editor
// (where envelope_action is 'open_in_editor' and carries no outcome of its
// own). Self-guards on a container editor, which hands the envelope to a
// document-editor container instead of running the action.
export async function runEnvelopeOutcome(
  action: Record<string, any>,
  data: any,
  deps: EnvelopeOutcomeDeps,
  actingAction?: string,
  draft = false
) {
  if (editorContainerId(action)) return;
  const { client, updateFieldValues, showOutcome, navigateToSignUrl } = deps;
  const envAction = actingAction ?? action.envelope_action;
  if (!envAction || envAction === 'sign') {
    if (isDocusignSignAction(action, envAction)) {
      // DocuSign sign has no Feathery sign URL to redirect to — the
      // `{docusign_envelope_id, status}` response (already validated for
      // errors by the caller) is itself the completion signal, so just
      // continue the flow.
      //
      // Create Draft finalizes as a sign too, so the label comes off the
      // request — a draft is saved in the sender's DocuSign account, not
      // delivered to anyone. Not off the response: the poll endpoint
      // overwrites its status with "complete", so DocuSign's own "created"
      // never reaches here.
      showOutcome(
        draft ? 'Saved as Draft' : 'Sent for Signature',
        action.documents
      );
      return;
    }
    // One entry comes back per signable envelope, carrying an id only when
    // the filler signs it first. One signer link covers the rest of the batch
    // they can sign.
    const responseSigners = data.signers ?? [];
    const matchedSigner = responseSigners.find((s: any) => s.signer_id);
    if (!matchedSigner) {
      // Nothing in the batch for the filler to sign themselves.
      if (responseSigners.some((s: any) => s.invited))
        showOutcome('Sent for Signature', action.documents);
      return;
    }
    const url = getSignUrl(matchedSigner.signer_id, action.redirect);
    if (action.redirect && navigateToSignUrl) await navigateToSignUrl(url);
    else openTab(url);
  } else if (envAction === 'download' && data.files) {
    await downloadAllFileUrls(
      data.files,
      replaceTextVariables(action.envelope_zip_name)
    );
  } else if (envAction === 'save' && data.files) {
    let files = data.files;
    if (files.length === 1) files = files[0];
    const newValues = { [action.save_document_field_key]: files };
    updateFieldValues(newValues);
    client.submitCustom(newValues);
  }
}

// The review editor's finalize handler: persists the reviewed envelopes with
// the outcome the filler picked, then runs the same outcome handling the
// direct path runs immediately off the generate response.
export function buildReviewFinalize({
  action,
  deps,
  onFinalized
}: {
  action: Record<string, any>;
  deps: EnvelopeOutcomeDeps;
  // What finalize returned ({files: [...]}), for callers that need the real
  // outcome — the generate payload only holds {documents, expires_at}.
  onFinalized?: (result: any) => void;
}) {
  return async ({ envelopes, envelopeAction, draft }: ReviewFinalizeParams) => {
    const result = await deps.client.finalizeEnvelopeReview(action, {
      envelopes,
      envelopeAction,
      draft
    });
    // A missing result is a failure, not a success: _fetch resolves undefined
    // on a network blip / 403 / 409, and `result?.status` would let that fall
    // through to the sign redirect (or throw a raw TypeError in the save
    // branch) as if finalize had succeeded.
    if (!result)
      return {
        status: 'error',
        message: 'Failed to finalize documents. Please try again.'
      };
    if (result.status === 'error') return result;
    await runEnvelopeOutcome(action, result, deps, envelopeAction, draft);
    onFinalized?.(result);
    return result;
  };
}

// Hands a freshly generated envelope batch to the document-editor container
// the action targets: stores it for a not-yet-mounted editor and notifies any
// mounted one.
export function dispatchEditorRefresh(
  containerId: string,
  action: Record<string, any>,
  data: any
) {
  const refreshDetail = {
    containerId,
    documents: action.documents ?? [],
    envelopes: data.envelopes ?? []
  };
  const win = featheryWindow() as any;
  win[PENDING_EDITOR_DRAFTS_KEY] = {
    ...(win[PENDING_EDITOR_DRAFTS_KEY] ?? {}),
    [containerId]: refreshDetail
  };
  win.dispatchEvent(
    new CustomEvent(EDITOR_REFRESH_EVENT, { detail: refreshDetail })
  );
  return refreshDetail;
}
