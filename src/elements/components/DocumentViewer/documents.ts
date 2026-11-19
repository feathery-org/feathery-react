import type { SigningTag } from './SigningTags';

/** `items` with the entry at `from` moved to `to`; out-of-range is a no-op. */
export const moveItem = <T>(items: T[], from: number, to: number): T[] => {
  const inRange = (i: number) => i >= 0 && i < items.length;
  if (from === to || !inRange(from) || !inRange(to)) return items;
  const next = items.filter((_, i) => i !== from);
  next.splice(to, 0, items[from]);
  return next;
};

/** One entry of the review payload's `documents` array, as the backend's
 * build_envelope_viewer_payload emits it, or an attachment the filler added
 * (build_attachment_viewer_document). */
export interface ViewerDocument {
  type: 'form' | 'attachment';
  // Absent for an attachment the viewer can't render: it shows as a file card.
  pdf_url?: string;
  // The id finalize acts on.
  envelope_id?: string;
  // The filler's own signing token, present only when they sign this one.
  signer_id?: string | null;
  name?: string;
  // Attachments only. No size on one restored from an earlier review.
  file_url?: string;
  file_name?: string;
  size?: number | null;
  // Where DocuSign's recipients sign this document, when the toolbar signs
  // through DocuSign. Empty for attachments.
  signing_tags?: SigningTag[];
}

/** The URL a document's pages (or its single file card) are keyed by. */
export const documentUrl = (doc: ViewerDocument) =>
  doc.pdf_url ?? doc.file_url ?? '';

/** Pages a document occupies in the viewer: a file card counts as one. */
export const documentPageCount = (
  doc: ViewerDocument,
  pageCounts: Record<string, number>
) => (doc.pdf_url ? pageCounts[doc.pdf_url] ?? 0 : 1);

/** What the viewer calls a document: its own name, else the uploaded file's. */
export const documentName = (doc: ViewerDocument, fallback = 'Document') =>
  doc.name ?? doc.file_name ?? fallback;
