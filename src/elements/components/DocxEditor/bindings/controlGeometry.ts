// Where a content control's editable interior actually is, in caret coordinates.
//
// A content control is not a container the caret lives inside - it is a pair of
// zero-width boundary elements in a paragraph, and each one occupies a caret
// offset. For a control holding "12" the paragraph reads:
//
//   offset:  0        1    2    3        4
//            [start]  "1"  "2"  [end]
//
// Offsets 1..3 are inside the control. Offset 0 and offset 4 are NOT - they sit
// on the boundary markers, and `selection.currentContentControl` there reports
// whatever encloses the paragraph (a [[table=...]] marker, or nothing) rather
// than the field. Text typed at offset 4 becomes a sibling inline AFTER the
// control: it renders inside the cell, so it looks bound, but the engine never
// reads it and never writes it. Measured on 34.1.31, not assumed.
//
// That one-offset difference is the whole reason this module exists. Both callers
// need it:
//
//   - the editor adapter, to put the caret back INSIDE a control after a write
//     that changed the control's length. Restoring a saved absolute offset is
//     wrong: normalizing "0012" to "12" shrinks the interior out from under a
//     caret that never moved, leaving it on the boundary.
//   - the keystroke router, to pull a caret that is already on a boundary back
//     inside before the character lands outside the binding.
//
// Everything here is READ-ONLY. The obvious alternative, calling the editor's own
// `selectContentControlInternal`, computes the same numbers but does it by
// moving the selection - which fires selectionChange, can scroll the viewport,
// and would need undoing. These offsets come straight from the layout model
// instead and were cross-checked against that API for byte-equality.
//
// Every accessor is guarded and every failure returns null. A caret that cannot
// be located must degrade to today's behaviour, never break typing.

import { parseTag, BoundDefinition } from './core/tagDsl';
// Type-only, and written as `import type` so the emit carries no require() back
// to the adapter - the adapter imports this module's functions, and a runtime
// cycle between the two would be a real one.
import type { ContentControlLike, SyncfusionEditorLike } from './editorAdapter';

/** Syncfusion's ContentControl element box, as far as this module reads it. */
interface ContentControlElement extends ContentControlLike {
  /** 0 for the opening boundary, 1 for the closing one. */
  type?: number;
  /** The matching closing boundary. */
  reference?: ContentControlElement;
  line?: {
    paragraph?: unknown;
    getOffset?: (element: unknown, offset: number) => number;
  };
}

/** A control's interior, in the caret coordinates of one paragraph. */
export interface InnerRange {
  /** The hierarchical offset up to and including its final ';'. */
  prefix: string;
  /** First offset inside the control. */
  start: number;
  /** Last offset inside the control, i.e. after its final character. */
  end: number;
}

/** Split "0;2;1;1;0;3" into its paragraph prefix and its character offset. */
export function splitOffset(
  offset: unknown
): { prefix: string; index: number } | null {
  if (typeof offset !== 'string' || !offset) return null;
  const separator = offset.lastIndexOf(';');
  if (separator === -1) return null;
  const index = Number(offset.slice(separator + 1));
  if (!Number.isFinite(index)) return null;
  return { prefix: offset.slice(0, separator + 1), index };
}

/** The bound definition a control carries, or null if it is not a binding. */
export function boundDefinitionOf(
  control: ContentControlLike | null | undefined
): BoundDefinition | null {
  const tag = control?.contentControlProperties?.tag;
  if (typeof tag !== 'string' || !tag) return null;
  let def = null;
  try {
    def = parseTag(tag);
  } catch {
    return null; // A malformed tag is the engine's problem to report.
  }
  // Table markers wrap whole tables; they have no editable interior.
  return def && def.kind !== 'table' ? def : null;
}

/**
 * The interior of a control, read from the layout model without moving the
 * caret. Null when the control spans paragraphs or the model is not laid out -
 * both of which mean the caller should fall back rather than guess.
 */
export function innerRangeOf(
  editor: SyncfusionEditorLike,
  control: ContentControlLike | null | undefined
): InnerRange | null {
  try {
    const element = control as ContentControlElement | null | undefined;
    const closing = element?.reference;
    const openingLine = element?.line;
    const closingLine = closing?.line;
    if (!element || !closing || !openingLine || !closingLine) return null;
    if (typeof openingLine.getOffset !== 'function') return null;
    if (typeof closingLine.getOffset !== 'function') return null;
    // A control split across paragraphs has no single caret coordinate space.
    if (openingLine.paragraph !== closingLine.paragraph) return null;

    // The same arithmetic selectContentControlInternal uses: one past the
    // opening boundary, and up to (not past) the closing one.
    const start = openingLine.getOffset(element, 1);
    const end = closingLine.getOffset(closing, 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
      return null;

    const toHierarchy = editor.selection?.getHierarchicalIndex;
    if (typeof toHierarchy !== 'function') return null;
    const startPath = toHierarchy.call(
      editor.selection,
      openingLine.paragraph,
      String(start)
    );
    const split = splitOffset(startPath);
    if (!split) return null;
    return { prefix: split.prefix, start, end };
  } catch {
    return null;
  }
}

/** Every bound control sharing a paragraph with the caret. */
function boundControlsAtCaret(
  editor: SyncfusionEditorLike
): ContentControlLike[] {
  const collection = editor.documentHelper?.contentControlCollection;
  if (!Array.isArray(collection)) return [];
  const paragraph = (editor.selection as any)?.start?.paragraph;
  if (!paragraph) return [];
  return collection.filter((control) => {
    const element = control as ContentControlElement;
    // Opening boundaries only: each control appears once as start, once as end.
    if (element.type !== 0) return false;
    if (element.line?.paragraph !== paragraph) return false;
    return !!boundDefinitionOf(control);
  });
}

/**
 * Find a control by tag whose interior lies in a known paragraph. Tags repeat -
 * one field can have many occurrences - so the paragraph prefix is what makes
 * the answer unambiguous.
 */
export function findControlByTagAndPrefix(
  editor: SyncfusionEditorLike,
  tag: string,
  prefix: string
): { control: ContentControlLike; range: InnerRange } | null {
  const collection = editor.documentHelper?.contentControlCollection;
  if (!Array.isArray(collection)) return null;
  for (const control of collection) {
    if ((control as ContentControlElement).type !== 0) continue;
    if (String(control.contentControlProperties?.tag ?? '') !== tag) continue;
    const range = innerRangeOf(editor, control);
    if (range && range.prefix === prefix) return { control, range };
  }
  return null;
}

/** A caret position remembered relative to the control that held it. */
export interface CaretAnchor {
  tag: string;
  prefix: string;
  /** Offsets from the control's interior start, so a resize cannot strand it. */
  relative: number;
}

/**
 * Remember the caret as an offset within its bound control, if it is in one.
 * Null when the caret is not inside a binding, in which case the caller should
 * fall back to restoring the absolute offset.
 */
export function anchorCaret(editor: SyncfusionEditorLike): CaretAnchor | null {
  try {
    const caret = splitOffset(editor.selection?.startOffset);
    if (!caret) return null;
    const control = editor.selection?.currentContentControl;
    const tag = control?.contentControlProperties?.tag;
    if (!boundDefinitionOf(control) || typeof tag !== 'string') return null;
    const range = innerRangeOf(editor, control);
    if (!range || range.prefix !== caret.prefix) return null;
    // Only trust a caret genuinely inside the interior.
    if (caret.index < range.start || caret.index > range.end) return null;
    return { tag, prefix: range.prefix, relative: caret.index - range.start };
  } catch {
    return null;
  }
}

/**
 * The offset an anchored caret should return to, clamped into the control's
 * interior as it stands NOW. Null when the control can no longer be located.
 */
export function resolveAnchor(
  editor: SyncfusionEditorLike,
  anchor: CaretAnchor
): string | null {
  const found = findControlByTagAndPrefix(editor, anchor.tag, anchor.prefix);
  if (!found) return null;
  const { start, end } = found.range;
  const target = Math.min(Math.max(start + anchor.relative, start), end);
  return `${found.range.prefix}${target}`;
}

/**
 * When the caret sits on a bound control's boundary - one offset outside its
 * interior - the offset just inside it. Null when the caret is already inside a
 * binding, or nowhere near one.
 *
 * This is the position typing must happen at. Text inserted on the boundary
 * lands outside the control, where it is invisible to the engine but not to the
 * reader.
 */
export function snapOffsetForCaret(
  editor: SyncfusionEditorLike
): string | null {
  try {
    // Already inside a binding: nothing to do.
    if (boundDefinitionOf(editor.selection?.currentContentControl)) return null;
    const caret = splitOffset(editor.selection?.startOffset);
    if (!caret) return null;
    // Only a collapsed caret. A range spanning a boundary is a deliberate
    // selection and must not be quietly moved.
    if (editor.selection?.endOffset !== editor.selection?.startOffset)
      return null;

    for (const control of boundControlsAtCaret(editor)) {
      const range = innerRangeOf(editor, control);
      if (!range || range.prefix !== caret.prefix) continue;
      // Just after the closing boundary -> the last offset inside.
      if (caret.index === range.end + 1) return `${range.prefix}${range.end}`;
      // On the opening boundary -> the first offset inside.
      if (caret.index === range.start - 1)
        return `${range.prefix}${range.start}`;
    }
    return null;
  } catch {
    return null;
  }
}
