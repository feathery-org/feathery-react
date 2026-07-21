// Default docx bridge that drives the in-form docx_editor field's live
// SyncFusion DocumentEditor. Contract A ops (getDocumentInventory /
// applyDocumentEdits) act on whatever editor `getEditor()` returns at call
// time - normally the instance the field registered in docxEditorRegistry.
//
// SyncFusion-free by import: this module never imports SyncFusion. It only
// calls methods on the opaque editor instance the field handed in
// (serialize/search/editorHistory/revisions/enableTrackChanges). It tolerates
// both full and optimized (abbreviated-key) SFDT so it survives version drift.

import { DocxBridge } from './assistantToolDispatch';

// Over 800 blocks, `full` is refused so the model uses outline+section instead
// (Contract A) and we never dump a huge doc into context.
export const FULL_INVENTORY_BLOCK_LIMIT = 800;

const err = (error: string, message: string) => ({ ok: false, error, message });

// --- tolerant SFDT accessors (full key first, optimized short key fallback) --
const pick = (obj: any, ...keys: string[]): any => {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
};
const getSections = (doc: any): any[] => pick(doc, 'sections', 'sec') ?? [];
const getBlocks = (sec: any): any[] => pick(sec, 'blocks', 'b') ?? [];
const getInlines = (block: any): any[] => pick(block, 'inlines', 'i') ?? [];
const getParaFormat = (block: any): any =>
  pick(block, 'paragraphFormat', 'pf') ?? {};
const getCharFormat = (obj: any): any =>
  pick(obj, 'characterFormat', 'cf') ?? {};
const inlineText = (inline: any): string => {
  const t = pick(inline, 'text', 'tlp');
  return typeof t === 'string' ? t : '';
};
const isTableBlock = (block: any): boolean =>
  pick(block, 'rows', 'rw', 'cells') !== undefined;

type InventoryEntry = {
  anchor: string;
  kind: string;
  text: string;
  format?: Record<string, any>;
};

const blockText = (block: any): string =>
  getInlines(block).map(inlineText).join('');

const blockFormat = (block: any): Record<string, any> => {
  const pf = getParaFormat(block);
  const firstInline = getInlines(block)[0];
  const cf = getCharFormat(firstInline ?? block);
  const listFormat = pick(pf, 'listFormat', 'lf') ?? {};
  return {
    styleName: pick(pf, 'styleName', 'sty'),
    alignment: pick(pf, 'textAlignment', 'ta'),
    bold: pick(cf, 'bold', 'b'),
    italic: pick(cf, 'italic', 'i'),
    underline: pick(cf, 'underline', 'u'),
    fontName: pick(cf, 'fontFamily', 'ff'),
    fontSize: pick(cf, 'fontSize', 'fs'),
    listLevel: pick(listFormat, 'listLevelNumber', 'lidx')
  };
};

// Heading level from a paragraph style name: "Heading 2" -> 2, "Title" -> 0.
const headingLevel = (styleName: unknown): number | null => {
  if (typeof styleName !== 'string') return null;
  const m = /^heading\s*(\d+)/i.exec(styleName.trim());
  if (m) return parseInt(m[1], 10);
  if (/^title$/i.test(styleName.trim())) return 0;
  return null;
};

type FlatBlock = { anchor: string; block: any; entry: InventoryEntry };

// Flatten SFDT sections->blocks into a single reading-order list with stable
// `s{sectionIdx}:b{blockIdx}` anchors shared by inventory reads and edits.
const flattenBlocks = (doc: any): FlatBlock[] => {
  const out: FlatBlock[] = [];
  getSections(doc).forEach((sec: any, si: number) => {
    getBlocks(sec).forEach((block: any, bi: number) => {
      const anchor = `s${si}:b${bi}`;
      out.push({
        anchor,
        block,
        entry: {
          anchor,
          kind: isTableBlock(block) ? 'table' : 'paragraph',
          text: blockText(block),
          format: blockFormat(block)
        }
      });
    });
  });
  return out;
};

const readDocument = (editor: any): any | null => {
  try {
    const raw = editor?.serialize?.();
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw);
    // Some builds wrap the document as { sfdt: "<json>" } or { sfdt: {...} }.
    if (parsed && parsed.sfdt !== undefined) {
      return typeof parsed.sfdt === 'string'
        ? JSON.parse(parsed.sfdt)
        : parsed.sfdt;
    }
    return parsed;
  } catch {
    return null;
  }
};

// Build the cheap heading outline: each heading paragraph starts a section that
// runs until the next heading; blockCount counts the blocks it spans.
const buildOutline = (flat: FlatBlock[]) => {
  const sections: Array<{
    anchor: string;
    heading: string;
    level: number;
    blockCount: number;
  }> = [];
  flat.forEach(({ anchor, entry }) => {
    const level = headingLevel(entry.format?.styleName);
    if (level !== null) {
      sections.push({ anchor, heading: entry.text, level, blockCount: 0 });
    }
    if (sections.length) sections[sections.length - 1].blockCount += 1;
  });
  return { sections };
};

export function createDocxEditorBridge(getEditor: () => any): DocxBridge {
  const getDocumentInventory = async (input: any) => {
    const editor = getEditor();
    if (!editor) return err('no_editor', 'No document editor is mounted.');
    const doc = readDocument(editor);
    if (!doc) return err('read_failed', 'Could not read the document.');

    const flat = flattenBlocks(doc);
    const scope = input?.scope ?? 'outline';

    if (scope === 'outline') return buildOutline(flat);

    if (scope === 'section') {
      const sectionAnchor = input?.sectionAnchor;
      if (!sectionAnchor) {
        return err(
          'missing_anchor',
          'sectionAnchor is required for scope=section.'
        );
      }
      const start = flat.findIndex((f) => f.anchor === sectionAnchor);
      if (start < 0) {
        return err(
          'stale_anchor',
          `Section anchor '${sectionAnchor}' not found.`
        );
      }
      // Run until the next heading at the same or higher level.
      const startLevel = headingLevel(flat[start].entry.format?.styleName) ?? 0;
      const inventory: InventoryEntry[] = [flat[start].entry];
      for (let i = start + 1; i < flat.length; i++) {
        const lvl = headingLevel(flat[i].entry.format?.styleName);
        if (lvl !== null && lvl <= startLevel) break;
        inventory.push(flat[i].entry);
      }
      return { inventory };
    }

    // full
    if (flat.length > FULL_INVENTORY_BLOCK_LIMIT) {
      return err(
        'too_large',
        `Document has ${flat.length} blocks (limit ${FULL_INVENTORY_BLOCK_LIMIT}). ` +
          'Use scope=outline then scope=section instead.'
      );
    }
    const maxEntries = Number.isInteger(input?.maxEntries)
      ? (input.maxEntries as number)
      : undefined;
    const entries = flat.map((f) => f.entry);
    return { inventory: maxEntries ? entries.slice(0, maxEntries) : entries };
  };

  // --- edit op handlers (each returns void or throws; caller records result) -
  const runOp = (editor: any, op: any): void => {
    const name = op?.op;
    switch (name) {
      case 'set_track_changes': {
        const enable = op.enable ?? op.value ?? true;
        editor.enableTrackChanges = !!enable;
        return;
      }
      case 'accept_all_revisions': {
        editor.revisions?.acceptAll?.();
        return;
      }
      case 'undo': {
        editor.editorHistory?.undo?.();
        return;
      }
      case 'redo': {
        editor.editorHistory?.redo?.();
        return;
      }
      case 'replace_text': {
        const query = op.find ?? op.search ?? op.old ?? op.text;
        const replacement = op.replace ?? op.newText ?? op.value ?? '';
        if (typeof query !== 'string' || !query) {
          throw new Error('replace_text requires a non-empty find/text.');
        }
        // Compare-and-swap guard: if `expect` is set, the expected text must
        // still be present, else the anchor is stale and we do not write.
        if (typeof op.expect === 'string' && op.expect) {
          editor.search?.findAll?.(op.expect);
          if (!(editor.search?.searchResults?.length > 0)) {
            const e: any = new Error(`Expected text not found: ${op.expect}`);
            e.code = 'stale_anchor';
            throw e;
          }
        }
        editor.search?.findAll?.(query);
        if (!(editor.search?.searchResults?.length > 0)) {
          const e: any = new Error(`Text not found: ${query}`);
          e.code = 'not_found';
          throw e;
        }
        editor.search.searchResults.replaceAll(replacement);
        return;
      }
      default: {
        const e: any = new Error(`Unsupported op: ${name}`);
        e.code = 'unsupported_op';
        throw e;
      }
    }
  };

  const applyDocumentEdits = async (input: any) => {
    const editor = getEditor();
    if (!editor) return err('no_editor', 'No document editor is mounted.');
    const edits = Array.isArray(input?.edits) ? input.edits : [];

    // Run the batch as tracked changes so the user can accept/reject, then
    // restore the editor's prior track-changes setting (Contract A).
    const priorTracking = !!editor.enableTrackChanges;
    try {
      editor.enableTrackChanges = true;
    } catch {
      /* older editor without the toggle - proceed untracked */
    }

    const results = edits.map((op: any) => {
      const base = { anchor: op?.anchor, op: op?.op };
      try {
        runOp(editor, op);
        return { ...base, ok: true };
      } catch (e: any) {
        return { ...base, ok: false, error: e?.code ?? e?.message ?? 'error' };
      }
    });

    try {
      editor.enableTrackChanges = priorTracking;
    } catch {
      /* ignore */
    }

    return { results, warnings: [] };
  };

  return { getDocumentInventory, applyDocumentEdits };
}
