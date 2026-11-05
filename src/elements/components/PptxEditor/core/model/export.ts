// Export is thin: edits already mutated the raw XML trees in place and marked the
// touched slide parts dirty, so we just re-serialize those and rezip.

import type { Deck } from './types';

export function exportDeckBytes(deck: Deck): Uint8Array {
  return deck.pkg.toBytes();
}

export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function exportDeckBlob(deck: Deck): Blob {
  return new Blob([exportDeckBytes(deck) as BlobPart], { type: PPTX_MIME });
}
