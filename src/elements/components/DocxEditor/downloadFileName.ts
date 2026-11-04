import { getFilenameFromUrl } from '../../../utils/fileNames';

// The envelope's stored file name without its extension, as the backend names
// the envelope's PDF export; the editor appends .docx or .pdf.
export function envelopeDownloadName(fileUrl?: string | null): string {
  const name = fileUrl ? getFilenameFromUrl(fileUrl) : '';
  const dot = name.lastIndexOf('.');
  return (dot === -1 ? name : name.slice(0, dot)) || 'document';
}
