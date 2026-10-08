/**
 * One change set as one tracked, grouped edit (WP1; the product's own shape): track changes on,
 * the author pinned, the revisions tagged with the change set's group tag so the rail shows one
 * card, and the whole set inside one `initComplexHistory('Grouping')` undo step. Everything is
 * restored afterwards, the user's track-changes setting included.
 */
import type { LiveEditor } from '../host';
import { historyOf } from '../host';
import { groupTag } from '../adapter/revisions';
import { AUTHOR } from '../reconcile';

export function inGroup<T>(
  editor: LiveEditor,
  turnId: string,
  tracked: boolean,
  work: () => T
): T {
  const settings = editor.documentEditorSettings?.revisionSettings;
  const prior = {
    track: editor.enableTrackChanges,
    user: editor.currentUser,
    custom: settings?.customData
  };
  editor.enableTrackChanges = tracked;
  editor.currentUser = AUTHOR;
  if (settings) settings.customData = groupTag(turnId);
  let complex = false;
  const module = editor.editorModule as Record<string, any> | undefined;
  if (
    !historyOf(editor)?.currentHistoryInfo &&
    typeof module?.initComplexHistory === 'function'
  ) {
    module.initComplexHistory('Grouping');
    complex = true;
  }
  try {
    return work();
  } finally {
    try {
      if (complex) historyOf(editor)?.updateComplexHistory?.();
    } finally {
      editor.enableTrackChanges = prior.track;
      editor.currentUser = prior.user;
      if (settings) settings.customData = prior.custom ?? null;
    }
  }
}

/**
 * Select [a, b) of the paragraph at `hi` and check it reads `expect`. The editor counts
 * content-control boundaries in offsets, so a few small shifts are tried; the selection is
 * verified, never assumed.
 */
export function place(
  editor: LiveEditor,
  hi: string,
  a: number,
  b: number,
  expect: string
): void {
  const selection = editor.selection as Record<string, any>;
  for (const d of [0, 1, -1, 2, 3, 4, 5, 6]) {
    try {
      selection.select(`${hi};${a + d}`, `${hi};${b + d}`);
    } catch {
      continue;
    }
    if (String(selection.text ?? '') === expect) return;
  }
  throw new Error(
    `placement: ${hi} [${a}, ${b}) does not read ${JSON.stringify(
      expect.slice(0, 60)
    )} (reads ${JSON.stringify(String(selection.text ?? '').slice(0, 60))})`
  );
}
