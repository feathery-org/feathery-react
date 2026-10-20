export interface EditorEnvelope {
  id: string;
  file: string | null;
  editor_file?: string | null;
  document?: string;
  key?: string;
  type: string;
  signed: boolean;
  sent?: boolean;
  sent_via?: 'feathery' | 'docusign' | null;
}

export interface DocumentPacket {
  containerId?: string;
  documents?: (string | { kind: string; document_id?: string })[];
  envelopes?: EditorEnvelope[];
}

export interface DocumentTab {
  id: string;
  documentId?: string;
  label: string;
  envelope?: EditorEnvelope;
}

export function packetTabs(packet: DocumentPacket): DocumentTab[] {
  // Generated envelopes preserve order and include every repeatable instance.
  if (packet.envelopes?.length) {
    return packet.envelopes.map((envelope, index) => ({
      id: envelope.id,
      documentId: envelope.document,
      label: envelope.key || `Document ${index + 1}`,
      envelope
    }));
  }
  return (packet.documents ?? []).flatMap((ref, index) => {
    const documentId = typeof ref === 'string' ? ref : ref.document_id;
    return documentId
      ? [
          {
            id: `${documentId}:${index}`,
            documentId,
            label: `Document ${index + 1}`
          }
        ]
      : [];
  });
}

export const envelopeSourceUrl = (envelope?: EditorEnvelope | null) =>
  envelope?.editor_file ?? envelope?.file ?? undefined;
