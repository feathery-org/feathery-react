// Default docx bridge that drives the in-form docx_editor field's live
// SyncFusion DocumentEditor. Contract A ops (getDocumentInventory /
// applyDocumentEdits) act on whatever editor `getEditor()` returns at call
// time - normally the instance the field registered in docxEditorRegistry.
//
// SyncFusion-free by import: this module never imports SyncFusion. It only
// calls methods on the opaque editor instance the field handed in
// (serialize/search/editorHistory/revisions/enableTrackChanges). It tolerates
// both full and optimized (abbreviated-key) SFDT so it survives version drift.

import { AssistantSelection, DocxBridge } from './assistantToolDispatch';

// Over 800 blocks, `full` is refused so the model uses outline+section instead
// (Contract A) and we never dump a huge doc into context.
export const FULL_INVENTORY_BLOCK_LIMIT = 800;

// Mirror of EnvelopeAssistant's SELECTION_TEXT_LIMIT (Contract E: <=500 chars).
export const SELECTION_TEXT_LIMIT = 500;

const err = (error: string, message: string) => ({ ok: false, error, message });

// Convert an inventory/flattenBlocks anchor into the SyncFusion hierarchical
// offset path used by editor.selection.select. flattenBlocks emits paragraphs
// as `s{si}:b{bi}` and table cells as `s{si}:b{bi}:r{ri}:c{ci}:b{cbi}`; strip
// the letter prefixes and join the numeric segments with ';' -> `0;0` /
// `0;1;0;0;0`. Tolerant of an already-`;`-formatted anchor.
export const anchorToOffsetPath = (anchor: string): string =>
  String(anchor ?? '')
    .split(':')
    .map((seg) => seg.replace(/[a-z]/gi, ''))
    .filter((seg) => seg !== '')
    .join(';');

// The start offset (SyncFusion hierarchical string, e.g. "2;2;2") of the i-th
// search result, used to decide which block a match lives in. Prefer the
// result's own `start` when it's a string; otherwise navigate to it and read
// the live selection start. Returns undefined when neither is available.
export const searchMatchStart = (
  editor: any,
  results: any,
  i: number
): string | undefined => {
  const item =
    results?.innerList?.[i] ??
    (typeof results?.get === 'function' ? results.get(i) : undefined);
  const s = item?.start;
  if (typeof s === 'string') return s;
  try {
    results.index = i;
  } catch {
    /* setting index unsupported */
  }
  const sel = editor?.selection?.startOffset;
  return typeof sel === 'string' ? sel : undefined;
};

// The first meaningful line of a (possibly multi-paragraph) `expect` string:
// split on paragraph/line marks, drop any leading tab-delimited page-number
// column (e.g. a ToC "About Us\t5"), and return the first non-empty piece.
// SyncFusion's findAll cannot match text spanning paragraph marks (\r), so a
// whole-block `expect` (which the model routinely copies from inventory) must
// be reduced to a single anchored line before it can serve as a CAS guard.
export const firstMeaningfulLine = (s: string): string => {
  for (const raw of String(s ?? '').split(/[\r\n]/)) {
    const line = raw.split('\t')[0].trim();
    if (line) return line;
  }
  return '';
};

// Strip the trailing offset from a SyncFusion hierarchical index to get the
// block anchor. "0;3;5" -> "0;3"; a table cell "0;2;0;1;0;4" -> "0;2;0;1;0".
// Mirrors feathery-frontend EnvelopeAssistant's anchorFromOffset.
export const anchorFromOffset = (offset: string): string => {
  const parts = String(offset ?? '').split(';');
  if (parts.length <= 1) return offset ?? '';
  parts.pop();
  return parts.join(';');
};

// Contract E selection context read from the live editor: current anchor +
// <=500 chars + isCollapsed, or null when there's no usable selection. Mirrors
// EnvelopeAssistant's readSelection so in-form selection behaves identically.
export const readDocxSelection = (editor: any): AssistantSelection | null => {
  const sel = editor?.selection;
  if (!sel || typeof sel.startOffset !== 'string') return null;
  const anchor = anchorFromOffset(sel.startOffset);
  if (!anchor) return null;
  const text = typeof sel.text === 'string' ? sel.text : '';
  const isCollapsed =
    sel.isEmpty != null ? !!sel.isEmpty : sel.startOffset === sel.endOffset;
  return { anchor, text: text.slice(0, SELECTION_TEXT_LIMIT), isCollapsed };
};

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

// Field marker kind for an inline: 0 = field begin, 2 = field separator,
// 1 = field end (SyncFusion fieldType; optimized short key 'ft'). Fields wrap a
// ToC entry / HYPERLINK / PAGEREF as: begin, <field code>, separator,
// <field result = visible text>, end.
const fieldTypeOf = (inline: any): number | undefined => {
  const v = pick(inline, 'fieldType', 'ft');
  return typeof v === 'number' ? v : undefined;
};
// Optimized-SFDT row key is 'r' (SyncFusion keywords.js: rowsProperty=['rows','r']).
// The live editor ALWAYS serializes optimized SFDT, so probing only 'rw' walked
// every table as one empty paragraph - tables invisible to inventory/search/edit.
// 'rw' kept as a defensive probe.
const getRows = (block: any): any[] | undefined => {
  const rows = pick(block, 'rows', 'r', 'rw');
  return Array.isArray(rows) ? rows : undefined;
};

type InventoryEntry = {
  anchor: string;
  kind: string;
  text: string;
  format?: Record<string, any>;
};

// Visible text of a block. Field-aware: the text BETWEEN a field begin and its
// separator is the field CODE (e.g. `HYPERLINK \l "_Toc.."`, `PAGEREF _Toc.. \h`)
// and must NOT appear in the inventory - only the field RESULT (the rendered
// text after the separator) is visible. Without this, a ToC entry's flattened
// text is polluted with field code, which corrupts the inventory and makes the
// `expect` CAS guard/first-line probe unmatchable (the ToC edit failed
// stale_anchor). Non-field blocks concatenate all runs as before.
const blockText = (block: any): string => {
  let out = '';
  let inFieldCode = false; // between field begin and separator
  for (const inline of getInlines(block)) {
    const ft = fieldTypeOf(inline);
    if (ft === 0) {
      inFieldCode = true; // field begin -> field code follows
      continue;
    }
    if (ft === 2 || ft === 1) {
      inFieldCode = false; // separator -> result follows; end -> field over
      continue;
    }
    if (inFieldCode) continue; // drop field-code runs
    out += inlineText(inline);
  }
  return out;
};

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
// anchors shared by inventory reads and edits. Paragraphs get `s{si}:b{bi}`;
// a table descends into rows->cells->cell-blocks, emitting each cell paragraph
// as an addressable `table_cell` entry (`s{si}:b{bi}:r{ri}:c{ci}:b{cbi}`) so
// table content is visible to inventory/search and editable via replace_text.
const flattenBlocks = (doc: any): FlatBlock[] => {
  const out: FlatBlock[] = [];
  getSections(doc).forEach((sec: any, si: number) => {
    getBlocks(sec).forEach((block: any, bi: number) => {
      const rows = getRows(block);
      if (rows) {
        rows.forEach((row: any, ri: number) => {
          const cells: any[] = pick(row, 'cells', 'c') ?? [];
          cells.forEach((cell: any, ci: number) => {
            getBlocks(cell).forEach((cb: any, cbi: number) => {
              const anchor = `s${si}:b${bi}:r${ri}:c${ci}:b${cbi}`;
              out.push({
                anchor,
                block: cb,
                entry: {
                  anchor,
                  kind: 'table_cell',
                  text: blockText(cb),
                  format: blockFormat(cb)
                }
              });
            });
          });
        });
        return;
      }
      const anchor = `s${si}:b${bi}`;
      out.push({
        anchor,
        block,
        entry: {
          anchor,
          kind: 'paragraph',
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

export type DocIndexBlock = {
  anchor: string;
  kind: string;
  text: string;
  format?: Record<string, any>;
};

// Build the block inventory to POST to /assistant/document-index (Contract C):
// every addressable block (paragraphs + table cells) that carries text. Empty
// blocks are skipped - they embed nothing and only bloat the index.
export const buildDocxIndexBlocks = (editor: any): DocIndexBlock[] => {
  const doc = readDocument(editor);
  if (!doc) return [];
  return flattenBlocks(doc)
    .map((f) => f.entry)
    .filter((e) => (e.text ?? '').trim().length > 0)
    .map((e) => {
      const block: DocIndexBlock = {
        anchor: e.anchor,
        kind: e.kind,
        text: e.text
      };
      if (e.format) block.format = e.format;
      return block;
    });
};

// --- atomic revision grouping (content-loss guard) -------------------------
//
// Under track changes a replace is authored as TWO revisions: a Deletion of the
// old run + an Insertion of the new run. Resolving them together is safe, but
// resolving them individually per card in a contradictory order (reject the
// insertion AND accept the deletion) deletes BOTH and the paragraph's content
// is lost. Fix (ported from feathery-frontend fc02e5934): bind the revisions of
// one logical edit into a group so the first per-card accept/reject cascades to
// the whole group - the only two internally-consistent outcomes, neither of
// which can empty the block.

// Read the editor's current revisions as a plain array (order preserved).
const snapshotRevisions = (editor: any): any[] => {
  const col = editor?.revisions;
  if (!col) return [];
  if (Array.isArray(col.changes)) return col.changes.slice();
  if (typeof col.length === 'number' && typeof col.get === 'function') {
    const out: any[] = [];
    for (let i = 0; i < col.length; i++) {
      const rev = col.get(i);
      if (rev) out.push(rev);
    }
    return out;
  }
  return [];
};

// Bind a set of revisions authored by ONE logical edit so per-card accept/reject
// is all-or-nothing. The first accept/reject on any member resolves the whole
// group; later clicks on resolved members are no-ops. Native handlers are
// wrapped in try/catch so a stale-range throw on a later member cannot undo the
// first member's result.
const groupRevisionsAtomic = (group: any[]): void => {
  if (group.length < 2) return;
  const natives = group.map((rev) => ({
    accept: typeof rev.accept === 'function' ? rev.accept.bind(rev) : undefined,
    reject: typeof rev.reject === 'function' ? rev.reject.bind(rev) : undefined
  }));
  const state = { resolved: false };
  const resolveAll = (isAccept: boolean) => {
    if (state.resolved) return;
    state.resolved = true;
    for (const n of natives) {
      const fn = isAccept ? n.accept : n.reject;
      if (!fn) continue;
      try {
        fn();
      } catch {
        // A later member's range may be stale once the first resolved; the
        // group's outcome is already consistent, so swallow and move on.
      }
    }
  };
  for (const rev of group) {
    rev.accept = () => resolveAll(true);
    rev.reject = () => resolveAll(false);
  }
};

// Diff the revisions created by a single op (against a pre-op snapshot) and bind
// them atomically. A no-op when the op added fewer than two revisions.
const groupNewRevisions = (editor: any, before: any[]): void => {
  const after = snapshotRevisions(editor);
  if (after.length <= before.length) return;
  const beforeSet = new Set(before);
  const created = after.filter((rev) => !beforeSet.has(rev));
  groupRevisionsAtomic(created);
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
        // Compare-and-swap guard: if `expect` is set, the anchored content must
        // still be present, else the anchor is stale and we do not write. The
        // model routinely copies a whole (multi-paragraph) inventory block into
        // `expect`; that can't be matched verbatim (it spans \r), so probe with
        // the first meaningful line of `expect`. For field blocks (ToC/HYPERLINK)
        // that first line can be unmatchable, so we also accept the `find`
        // target still being present - only when NEITHER is found is the anchor
        // truly stale.
        if (typeof op.expect === 'string' && op.expect) {
          const probes = [firstMeaningfulLine(op.expect), query].filter(
            Boolean
          );
          const present = probes.some((p) => {
            editor.search?.findAll?.(p);
            return editor.search?.searchResults?.length > 0;
          });
          if (!present) {
            const e: any = new Error(`Expected text not found: ${probes[0]}`);
            e.code = 'stale_anchor';
            throw e;
          }
        }

        // Anchored replace: scope the rewrite to the single block named by
        // op.anchor so a targeted phrase rename does NOT become a global
        // replace-all - and do it via SyncFusion's search engine, NOT a
        // manually-computed selection range.
        //
        // Root cause of the earlier "Our Purposeon" truncation: a range built
        // as [path;0 .. path;{flattenedTextLength}] undershoots whenever the
        // block carries zero-width inline markers (a ToC-target heading has
        // BookmarkStart/BookmarkEnd around the text: [bkt,bkt,text,bkt,bkt]),
        // because those markers occupy SyncFusion offset positions but add no
        // characters to the flattened text - so the delete stopped short and
        // left a fragment. search.findAll sizes each match correctly regardless
        // of markers; we just restrict which matches get replaced to this block.
        if (typeof op.anchor === 'string' && op.anchor) {
          // Normalize the incoming anchor so ANY source resolves: the flatten
          // form `s{n}:b{n}` (inventory / search-anchored / table cells) and
          // the raw SyncFusion offset form `sec;block` (selection context, from
          // readDocxSelection/anchorFromOffset for deictic "change this" edits)
          // both canonicalize to the same offset path.
          const path = anchorToOffsetPath(op.anchor);
          const doc = readDocument(editor);
          const target = doc
            ? flattenBlocks(doc).find(
                (f) =>
                  f.anchor === op.anchor ||
                  anchorToOffsetPath(f.anchor) === path
              )
            : undefined;
          if (!target) {
            const e: any = new Error(`Anchor not found: ${op.anchor}`);
            e.code = 'stale_anchor';
            throw e;
          }
          if ((target.entry.text ?? '').indexOf(query) < 0) {
            const e: any = new Error(
              `Text not found at anchor ${op.anchor}: ${query}`
            );
            e.code = 'not_found';
            throw e;
          }

          editor.search?.findAll?.(query);
          const results = editor.search?.searchResults;
          const total = results?.length ?? 0;
          const inBlock: number[] = [];
          for (let i = 0; i < total; i++) {
            const start = searchMatchStart(editor, results, i);
            if (typeof start === 'string' && start.indexOf(`${path};`) === 0) {
              inBlock.push(i);
            }
          }
          if (inBlock.length === 0) {
            const e: any = new Error(
              `Text not found at anchor ${op.anchor}: ${query}`
            );
            e.code = 'not_found';
            throw e;
          }
          if (typeof results.replace !== 'function') {
            // Never silently succeed: without a per-match replace we cannot
            // scope the edit, so surface an error rather than corrupt/no-op.
            const e: any = new Error('Editor search replace is unavailable.');
            e.code = 'replace_unavailable';
            throw e;
          }
          // Replace last -> first so replacing one match cannot shift the
          // offsets of earlier (not-yet-replaced) matches.
          for (let k = inBlock.length - 1; k >= 0; k--) {
            results.index = inBlock[k];
            results.replace(replacement);
          }
          return;
        }

        // Unanchored replace: global replace-all across the document. Bulk asks
        // ("change every premium") depend on this whole-document behavior.
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
      const revsBefore = snapshotRevisions(editor);
      try {
        runOp(editor, op);
        // Bind this op's delete+insert revisions so per-card accept/reject is
        // all-or-nothing and cannot split one logical edit into content loss.
        groupNewRevisions(editor, revsBefore);
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
