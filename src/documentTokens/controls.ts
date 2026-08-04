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
    /** The selected text, used to prove a range was actually selected. */
    text?: string;
    isEmpty?: boolean;
  };
  editor: {
    insertText: (text: string) => void;
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
 * The content control carrying a token, found by its tag.
 *
 * `contentControlCollection` and `selectContentControlInternal` are private
 * Syncfusion surface, accepted deliberately: the control is the only durable
 * address a token has. Measured — **deleting a value destroys its bookmark**
 * (the first backspace over a selected value takes the bookmark with it) while
 * the control survives and still reports its contents. Addressing by bookmark
 * therefore fails permanently for any token the reader has cleared, which is
 * exactly the "formatting never comes back" symptom.
 */
const controlFor = (editor: EditorLike, instance: string): object | null => {
  const collection = (editor as any)?.documentHelper?.contentControlCollection;
  if (!Array.isArray(collection)) return null;
  return (
    collection.find((control: any) => {
      const spec = decodeTag(control?.contentControlProperties?.tag ?? '');
      return spec !== null && instanceKey(spec) === instance;
    }) ?? null
  );
};

/**
 * Whether a control is showing Syncfusion's own placeholder text rather than a
 * value — "Click here or tap to insert text", localised.
 *
 * A token's text must always be a field value or the empty rendering of its
 * format, so a placeholder is never allowed to stand. The flag lives on the
 * live element, so this reads the collection rather than the exported data.
 */
export const showsPlaceholder = (
  editor: EditorLike,
  instance: string
): boolean =>
  Boolean(
    (controlFor(editor, instance) as any)?.contentControlProperties
      ?.hasPlaceHolderText
  );

/**
 * Put the selection over a token's value, excluding the markers around it.
 *
 * The control comes first because it outlives the value. The bookmark is kept
 * as a fallback for the case where this private API is gone after a version
 * bump — it addresses an untouched token perfectly well, and
 * `excludeBookmarkStartEnd` keeps its markers out of the replacement.
 */
const selectInner = (editor: EditorLike, instance: string): boolean => {
  const control = controlFor(editor, instance);
  const selectControl = (editor as any)?.selection
    ?.selectContentControlInternal;
  if (control && typeof selectControl === 'function') {
    selectControl.call(editor.selection, control);
    return true;
  }

  if (typeof editor?.getBookmarks !== 'function') return false;
  if (typeof editor?.selection?.selectBookmark !== 'function') return false;
  const bookmark = bookmarkFor(instance);
  if (!editor.getBookmarks().includes(bookmark)) return false;
  editor.selection.selectBookmark(bookmark, true);
  return true;
};

/**
 * Select a token's value, ready to be replaced.
 *
 * Selecting by address is exact — searching for the rendered text would pick
 * the wrong token the moment two of them read `$0.00`.
 */
const selectValue = (
  editor: EditorLike,
  instance: string,
  currentText: string
): boolean => {
  if (!selectInner(editor, instance)) return false;

  // A write REPLACES a selected range. If the selection came back collapsed,
  // inserting would append instead — which silently compounds a value on
  // every pass (`100` becoming `100,100100`). Refuse rather than corrupt: a
  // token that fails to update is visible, a mangled number is not. An empty
  // selection is correct when the value itself is empty; there is nothing to
  // replace, so the insert lands inside the control as measured.
  const selected = editor.selection.text;
  if (selected === undefined) return true; // host cannot report; trust it
  if (selected === '') return currentText === '';
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
): boolean => {
  const current = readTokens(editor).find(
    (entry) => instanceKey(entry.spec) === instanceKey(spec)
  );
  return selectValue(editor, instanceKey(spec), current?.value ?? '');
};

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
  const pending: Array<{
    id: string;
    instance: string;
    text: string;
    was: string;
  }> = [];
  for (const { id, text } of updates) {
    if (id === options.skipId) continue;
    const found = appearances.get(id);
    if (!found) {
      missed.push(id);
      continue;
    }
    for (const appearance of found) {
      if (appearance.text !== text) {
        pending.push({
          id,
          instance: appearance.instance,
          text,
          was: appearance.text
        });
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
      for (const { id, instance, text, was } of pending) {
        if (!selectValue(editor, instance, was)) {
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
