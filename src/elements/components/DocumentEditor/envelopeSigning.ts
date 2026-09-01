import type FeatheryClient from '../../../utils/featheryClient';
import { featheryWindow, openTab } from '../../../utils/browser';
import { fieldValues } from '../../../utils/init';
import internalState from '../../../utils/internalState';
import {
  getSignUrl,
  isDocusignSignAction,
  signsViaDocusign
} from '../../../utils/document';
import type { Envelope } from './DocxEnvelopeEditor';

// Signs (or DocuSign-drafts) one editor-bound envelope. Shared by the docx
// and pdf envelope editors — the flow is the renderer's terminal action, not
// anything docx-specific.
export async function runEnvelopeSigningAction({
  envelope,
  action,
  client,
  formId,
  activeDocumentId,
  draft,
  onFinalized
}: {
  envelope: Envelope;
  action?: Record<string, any>;
  client: FeatheryClient;
  formId?: string;
  activeDocumentId?: string;
  draft: boolean;
  // Fired once the envelope is finalized for signing, so the caller can flip
  // its editor read-only.
  onFinalized?: () => void;
}) {
  const viaDocusign = signsViaDocusign(action ?? {});
  // The field names whoever signs inline. Nobody does on DocuSign - it
  // mails every recipient itself, from the role mappings - so routing to
  // that field would reach someone never listed as a signer.
  const signerKey = viaDocusign ? '' : action?.envelope_signer_field_key;
  const fillerEmail = signerKey ? fieldValues[signerKey]?.toString() ?? '' : '';
  let finalized: Record<string, any> | undefined;
  // Both backends need signer rows the envelope doesn't have yet — generation
  // held them back so the draft stayed editable (and skipped the docx→PDF
  // conversion signing needs). Finalize builds the rows now and, for a docx,
  // converts the file. One-way: this draft stops being editable. Throws so
  // nothing is sent unfinalized. It's also what hands back the signer to
  // open as.
  if (!envelope.signed) {
    // Per-role signers were held back at generation for the same reason, so
    // they go up now, scoped to the document actually on screen. Without
    // any, the shared signer field covers every role instead.
    const roleSigners = (action?.envelope_signers ?? [])
      .filter((entry: any) => entry.document_id === activeDocumentId)
      .map((entry: any) => {
        const email = fieldValues[entry.field_key]?.toString() ?? '';
        return {
          document_id: entry.document_id,
          role_id: entry.role_id,
          email,
          // Flagged entries are the ones this filler opens and signs
          // inline.
          filler:
            !!fillerEmail && email.toLowerCase() === fillerEmail.toLowerCase()
        };
      });
    const signers = (
      roleSigners.length || !activeDocumentId
        ? roleSigners
        : // role_id left off rather than nulled - the backend rejects an
          // explicit null, and omitting it covers every role.
          [
            {
              document_id: activeDocumentId,
              email: fillerEmail,
              filler: true
            }
          ]
    ).filter((entry: any) => entry.email);
    finalized = await client.finalizeEnvelope(
      envelope.id,
      signers,
      action?.sign_method
    );
    onFinalized?.();
  }

  // Nothing here navigates away, so the outcome is only visible if it's
  // announced.
  const announce = internalState[formId ?? '']?.showEnvelopeOutcome;

  if (isDocusignSignAction(action ?? {}, 'sign')) {
    // DocuSign has no Feathery sign page: the backend send (or draft) is
    // itself the completion signal.
    const result = await client.finalizeEnvelopeReview(action ?? {}, {
      envelopes: [{ envelopeId: envelope.id }],
      envelopeAction: 'sign',
      draft
    });
    if (!result) throw Error('Failed to send the document to DocuSign');
    if (result.status === 'error') throw Error(result.message);
    announce?.(
      draft ? 'Saved as Draft' : 'Sent for Signature',
      action?.documents
    );
    return;
  }

  // A signer id comes back only when the filler signs first. Without one
  // the envelope is someone else's to sign, so there's nothing to open.
  if (!finalized?.signer_id) {
    if (finalized?.invited) announce?.('Sent for Signature', action?.documents);
    return;
  }
  const url = getSignUrl(finalized.signer_id, action?.redirect);
  if (action?.redirect) featheryWindow().location.href = url;
  else openTab(url);
}
