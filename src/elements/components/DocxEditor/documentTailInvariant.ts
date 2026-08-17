type SfdtDecoder = (input: unknown) => any;

type SfdtLoadingEditor = {
  processSfdt?: (input: unknown, isAsync: boolean) => unknown;
  [key: string]: unknown;
};

const DOCUMENT_TAIL_INVARIANT_PATCH =
  '__featheryDocumentTailParagraphInvariant';

function endsInTable(block: any): boolean {
  if (!block || typeof block !== 'object') return false;
  if (
    Array.isArray(block.rows) ||
    Array.isArray(block.rw) ||
    Array.isArray(block.r)
  )
    return true;
  const nested = block.blocks ?? block.b;
  return Array.isArray(nested) && nested.length > 0
    ? endsInTable(nested[nested.length - 1])
    : false;
}

/**
 * Restore Word's required body caret after a terminal table.
 *
 * This runs while SFDT is being loaded, so the paragraph is baseline document
 * structure rather than an assistant or user edit. Both verbose and optimized
 * SFDT use the same rule; a decoder lets the load seam unwrap SyncFusion's
 * compressed `{ sfdt: ... }` response before applying it.
 */
export function ensureTrailingBodyParagraph(
  input: unknown,
  decode?: SfdtDecoder
): unknown {
  let document: any;
  try {
    document = decode
      ? decode(input)
      : typeof input === 'string'
      ? JSON.parse(input)
      : JSON.parse(JSON.stringify(input));
  } catch {
    // Let SyncFusion report malformed input through its normal load path.
    return input;
  }

  const sections = document?.sections ?? document?.sec;
  if (!Array.isArray(sections)) return input;
  let changed = false;
  for (const section of sections) {
    const blocks = section?.blocks ?? section?.b;
    if (!Array.isArray(blocks) || !endsInTable(blocks[blocks.length - 1]))
      continue;
    blocks.push(document.sections !== undefined ? { inlines: [] } : { i: [] });
    changed = true;
  }
  return changed ? JSON.stringify(document) : input;
}

/** Install the invariant at the one path every SFDT load passes through. */
export function installDocumentTailInvariant(
  editor: SfdtLoadingEditor,
  decode?: SfdtDecoder
): void {
  if (editor[DOCUMENT_TAIL_INVARIANT_PATCH]) return;
  const processSfdt = editor.processSfdt;
  if (typeof processSfdt !== 'function') return;
  editor.processSfdt = function (input: unknown, isAsync: boolean) {
    return processSfdt.call(
      this,
      ensureTrailingBodyParagraph(input, decode),
      isAsync
    );
  };
  editor[DOCUMENT_TAIL_INVARIANT_PATCH] = true;
}
