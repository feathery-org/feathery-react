/**
 * The Syncfusion boundary. Every content-control call the token system makes
 * lives here, so the rest of the code never touches the editor directly and a
 * version bump has one place to break.
 *
 * Everything below was measured against ej2-documenteditor v34 with a real
 * editor instance, not read off the typings — see the runtime-probe appendix
 * of docs/superpowers/specs/2026-08-03-docx-linked-tokens-design.md.
 */

import { instanceKey, TokenSpec, valueKey } from './plan';

/** Prefix that marks a content control as ours, so we never touch the rest. */
export const TAG_PREFIX = 'ftk:';

const INPUT_COLOR = '#2563EB';
const COMPUTED_COLOR = '#9CA3AF';

/**
 * Syncfusion's ContentControlInfo.
 *
 * WARNING: `canEdit` and `canDelete` are LOCK flags whose names say the
 * opposite of what they do. Measured: `canEdit: true` means the contents
 * CANNOT be edited (a real keystroke into such a control is blocked), and
 * `canDelete: true` means the control CANNOT be deleted. The typings' doc
 * comments describe the inverse.
 */
export type ContentControlInfo = {
  title: string;
  tag: string;
  value: string;
  canEdit: boolean;
  canDelete: boolean;
  items?: string[];
};

/** Bookmark name that addresses a token's value. See `selectValue`. */
export const bookmarkFor = (id: string): string => `ftk_${id}`;

/** The slice of the editor this module needs. Keeps tests free of Syncfusion. */
export type EditorLike = {
  exportContentControlData: () => ContentControlInfo[];
  getBookmarks: () => string[];
  selection: {
    getContentControlInfo?: () => ContentControlInfo | undefined;
    selectBookmark: (name: string, excludeBookmarkStartEnd?: boolean) => void;
    select?: (start: string, end: string) => void;
    startOffset?: string;
    endOffset?: string;
  };
  editor: {
    insertText: (text: string) => void;
    insertContentControl?: (info: ContentControlInfo) => unknown;
    insertBookmark?: (name: string) => void;
  };
  editorHistory?: {
    beginUndoAction: () => void;
    endUndoAction: () => void;
  };
};

/**
 * Run `write`, leaving the caret and the scroll position where they were.
 *
 * Selecting a bookmark scrolls it into view, so writing several tokens drags
 * the page around and dumps the user somewhere they did not ask to be.
 * Propagation must be invisible except for the numbers that changed.
 */
const withViewportPreserved = <T>(editor: EditorLike, write: () => T): T => {
  const container = (editor as any)?.documentHelper?.viewerContainer;
  const scroll = container
    ? { top: container.scrollTop, left: container.scrollLeft }
    : null;
  const caret =
    editor.selection?.startOffset && editor.selection?.endOffset
      ? { start: editor.selection.startOffset, end: editor.selection.endOffset }
      : null;

  try {
    return write();
  } finally {
    if (caret) editor.selection.select?.(caret.start, caret.end);
    if (container && scroll) {
      container.scrollTop = scroll.top;
      container.scrollLeft = scroll.left;
    }
  }
};

const isOurs = (info: ContentControlInfo): boolean =>
  typeof info.tag === 'string' && info.tag.startsWith(TAG_PREFIX);

export const encodeTag = (spec: TokenSpec): string =>
  `${TAG_PREFIX}${JSON.stringify(spec)}`;

export const decodeTag = (tag: string): TokenSpec | null => {
  if (!tag?.startsWith(TAG_PREFIX)) return null;
  try {
    const spec = JSON.parse(tag.slice(TAG_PREFIX.length));
    return typeof spec?.id === 'string' ? (spec as TokenSpec) : null;
  } catch {
    return null;
  }
};

/**
 * Every token in the document, in document order. Ignores foreign controls.
 *
 * Returns nothing when the editor does not expose the content-control API —
 * an older SyncFusion, or an instance still initialising. Tokens are a feature
 * of the document, never a requirement of the editor: failing to read them
 * must not take the editor down with it.
 */
export const readTokens = (
  editor: EditorLike
): Array<{ spec: TokenSpec; value: string }> =>
  typeof editor?.exportContentControlData !== 'function'
    ? []
    : editor
        .exportContentControlData()
        .filter(isOurs)
        .map((info) => ({ spec: decodeTag(info.tag), value: info.value }))
        .filter(
          (entry): entry is { spec: TokenSpec; value: string } =>
            entry.spec !== null
        );

/** The token the caret sits in, or null when the caret is in ordinary prose. */
export const tokenAtCaret = (editor: EditorLike): TokenSpec | null => {
  const info = editor?.selection?.getContentControlInfo?.();
  if (!info?.tag) return null;
  return decodeTag(info.tag);
};

/**
 * Select a token's value, ready to be replaced.
 *
 * Content controls expose no public "range of this control", so each token
 * also carries a bookmark of the same id purely as an address. Selecting by
 * bookmark is exact — searching for the rendered text would pick the wrong
 * token the moment two of them read `$0.00`.
 *
 * `excludeBookmarkStartEnd` keeps the markers out of the selection, so the
 * replacement lands strictly between them and they survive the write. That is
 * the effect the prototype needed zero-width sentinels to achieve.
 */
const selectValue = (editor: EditorLike, instance: string): boolean => {
  if (typeof editor?.getBookmarks !== 'function') return false;
  if (typeof editor?.selection?.selectBookmark !== 'function') return false;

  const bookmark = bookmarkFor(instance);
  if (!editor.getBookmarks().includes(bookmark)) return false;
  editor.selection.selectBookmark(bookmark, true);
  return true;
};

/**
 * Select a token's value — the text only, not the control around it.
 *
 * Exported so a double-click can replace SyncFusion's default, which selects
 * the whole content control. That control is locked against deletion, so the
 * selection cannot be typed over and the gesture appears to do nothing.
 */
export const selectTokenValue = (
  editor: EditorLike,
  spec: TokenSpec
): boolean => selectValue(editor, instanceKey(spec));

/**
 * Write new rendered values into their controls.
 *
 * `resetContentControlData` is NOT a write API — measured, it resets a control
 * to its placeholder text and discards the value. The working write is
 * select-the-text-then-insert, which preserves the tag and the control.
 *
 * Programmatic writes bypass the content lock, so computed tokens stay
 * read-only to the user while remaining writable here — no unlock dance.
 *
 * The whole batch is one undo step: a single edit that moves four dependents
 * must revert as one, or Ctrl+Z leaves the document inconsistent with itself.
 */
export const writeValues = (
  editor: EditorLike,
  updates: Array<{ id: string; text: string }>,
  options: { skipId?: string } = {}
): { written: string[]; missed: string[] } => {
  // A token may appear many times; every appearance shows the same value, so
  // one update fans out to each control that carries it.
  const appearances = new Map<
    string,
    Array<{ instance: string; text: string }>
  >();
  for (const { spec, value } of readTokens(editor)) {
    const key = valueKey(spec);
    const list = appearances.get(key) ?? [];
    list.push({ instance: instanceKey(spec), text: value });
    appearances.set(key, list);
  }

  const written: string[] = [];
  const missed: string[] = [];

  // Compare before writing — an unchanged appearance costs nothing, and the
  // token being typed in is skipped so the caret is never yanked mid-word.
  const pending: Array<{ id: string; instance: string; text: string }> = [];
  for (const { id, text } of updates) {
    if (id === options.skipId) continue;
    const found = appearances.get(id);
    if (!found) {
      missed.push(id);
      continue;
    }
    for (const appearance of found) {
      if (appearance.text !== text) {
        pending.push({ id, instance: appearance.instance, text });
      }
    }
  }
  if (pending.length === 0) return { written, missed };

  if (typeof editor?.editor?.insertText !== 'function') {
    return { written, missed: pending.map(({ id }) => id) };
  }

  withViewportPreserved(editor, () => {
    editor.editorHistory?.beginUndoAction();
    try {
      for (const { id, instance, text } of pending) {
        if (!selectValue(editor, instance)) {
          missed.push(id);
          continue;
        }
        editor.editor.insertText(text);
        if (!written.includes(id)) written.push(id);
      }
    } finally {
      editor.editorHistory?.endUndoAction();
    }
  });

  return { written, missed };
};

/**
 * Insert a token at the caret, as one undo step.
 *
 * Two markers go in: the content control carries the spec and the locks, and
 * a bookmark of the same id carries the address `writeValues` selects by.
 *
 * `canEdit`/`canDelete` are locks: a computed token is locked against editing,
 * and every token is locked against deletion.
 */
export const insertToken = (
  editor: EditorLike,
  spec: TokenSpec,
  renderedValue: string,
  label = spec.id
): boolean => {
  if (!editor.editor.insertContentControl) return false;

  const isComputed = Boolean(spec.formula);
  editor.editorHistory?.beginUndoAction();
  try {
    editor.editor.insertContentControl({
      title: label,
      tag: encodeTag(spec),
      value: renderedValue,
      canEdit: isComputed,
      canDelete: true
    });
    editor.editor.insertBookmark?.(bookmarkFor(instanceKey(spec)));
  } finally {
    editor.editorHistory?.endUndoAction();
  }
  return true;
};

/** The chrome colour for a token, derived from its kind rather than stored. */
export const colorFor = (spec: TokenSpec): string =>
  spec.formula ? COMPUTED_COLOR : INPUT_COLOR;
