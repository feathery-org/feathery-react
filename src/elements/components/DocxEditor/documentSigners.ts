import { signsViaDocusign } from '../../../utils/document';

export function documentSigners(
  action: Record<string, any> | undefined,
  documentId: string | undefined,
  fieldValues: Record<string, any>
) {
  const signerKey = signsViaDocusign(action ?? {})
    ? ''
    : action?.envelope_signer_field_key;
  const fillerEmail = signerKey ? fieldValues[signerKey]?.toString() ?? '' : '';
  // Per-role signers were held back at generation for the same reason, so
  // they go up now, scoped to the document actually on screen. Without
  // any, the shared signer field covers every role instead.
  const roleSigners = (action?.envelope_signers ?? [])
    .filter((entry: any) => entry.document_id === documentId)
    .map((entry: any) => {
      const email =
        (entry.email ?? fieldValues[entry.field_key])?.toString() ?? '';
      return {
        document_id: entry.document_id,
        ...(entry.role_id ? { role_id: entry.role_id } : {}),
        ...(entry.repeat_index !== undefined
          ? { repeat_index: entry.repeat_index }
          : {}),
        email,
        ...(entry.signer_id?.trim()
          ? { signer_id: entry.signer_id.trim() }
          : {}),
        ...(entry.name ? { name: entry.name } : {}),
        ...(entry.phone ? { phone: entry.phone.toString() } : {}),
        // Flagged entries are the ones this filler opens and signs
        // inline.
        filler:
          entry.filler ??
          (!!fillerEmail && email.toLowerCase() === fillerEmail.toLowerCase())
      };
    });
  return (
    roleSigners.length || !documentId
      ? roleSigners
      : // role_id left off rather than nulled - the backend rejects an
        // explicit null, and omitting it covers every role.
        [
          {
            document_id: documentId,
            email: fillerEmail,
            filler: true
          }
        ]
  ).filter((entry: any) => entry.email);
}
