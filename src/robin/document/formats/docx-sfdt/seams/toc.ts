/**
 * The table of contents, rebuilt by the editor: after a change set (and after a card is resolved)
 * the editor's own update rebuilds the TOC field's entries from the headings and its layout's page
 * numbers, as its Update Field does. It runs untracked (the entries are derived, never a change to
 * review) and inside the change set's undo group (the reconcile transaction).
 *
 * Four things the editor's rebuild does that a person would not want, and how this step keeps them
 * from happening (measured on a real proposal's TOC, editor 34.1.31):
 *
 *   - Its settings from the field code turn a code without `\o` into `\o "1-3"`, which also lists
 *     Heading 1 to 3 and rewrites the code. Here a code without `\o` lists only its `\t` styles, as
 *     Word reads it (no heading levels: end level 0).
 *   - Each entry's text takes the character format of its heading's paragraph mark (a heading whose
 *     mark is in another font gives its entry that font). Here each entry keeps the format its text
 *     had before the rebuild; a new entry takes the first entry's.
 *   - Each entry's PAGEREF code is written with no space before the bookmark name
 *     (`PAGEREF_Toc...`), not the `PAGEREF <bookmark>` Word writes. Here the space is put back.
 *   - It reads a heading with its pending deletions in it (a tracked rename lists "OldNew") and lists
 *     a heading whose text is all pending deletion. Here an entry reads the heading as accepted, and
 *     a heading pending deletion has none; resolving the card rebuilds the contents again.
 *
 * With no paragraph in the styles the field lists, the editor's rebuild opens a "No Headings"
 * dialog; this step does not call it then, and the document keeps its contents as they are.
 */
import type { Seam } from '../../../pack';
import type { DocxHost, LiveEditor } from '../host';
import { historyOf } from '../host';
import { entryText } from '../toc';

type Obj = Record<string, any>;

export interface TocPayload {
  /**
   * `engine` when the commit replaced the document (the editor's history was cleared and the engine
   * keeps the way back): the rebuild's own undo entry is cleared with it.
   */
  history: 'editor' | 'engine';
}

const NEEDED = [
  'insertTableOfContents',
  'isHeadingStyle',
  'getTocSettings',
  'insertTocHyperlink',
  'insertTocPageNumber'
];

/** The body's TOC field in the live editor, or null. */
function liveTocField(editor: LiveEditor): Obj | null {
  const helper = editor.documentHelper as Obj | undefined;
  const fields = (helper?.fields ?? []) as Obj[];
  return (
    fields.find(
      (f) => helper?.layout?.isTocField?.(f) && !f.paragraph?.isInHeaderFooter
    ) ?? null
  );
}

/** Every element of the paragraphs from `first` to `last`, in order, through split paragraphs. */
function elementsBetween(editor: LiveEditor, first: Obj, last: Obj): Obj[] {
  const selection = editor.selection as Obj;
  const out: Obj[] = [];
  let paragraph: Obj | undefined = first;
  while (paragraph) {
    for (const split of paragraph.getSplitWidgets?.() ?? [paragraph])
      for (const line of split.childWidgets ?? [])
        for (const element of line.children ?? []) out.push(element);
    if (paragraph === last || last.getSplitWidgets?.().includes(paragraph))
      break;
    paragraph = selection.getNextParagraphBlock(
      paragraph.getSplitWidgets?.().pop() ?? paragraph
    );
  }
  return out;
}

/**
 * The character format of each entry's text before the rebuild, by the entry's text: the first run
 * of the result of each HYPERLINK inside the TOC field.
 */
function entryFormats(editor: LiveEditor, field: Obj): Map<string, Obj> {
  const out = new Map<string, Obj>();
  const elements = elementsBetween(
    editor,
    field.paragraph,
    field.fieldEnd?.paragraph ?? field.paragraph
  );
  const open: Array<{ code: string; result: boolean }> = [];
  let entry: { text: string; format: Obj | null } | null = null;
  for (const e of elements) {
    // a field mark is the one element with a field type (its result text has none)
    const field = typeof e.fieldType === 'number' ? e : null;
    if (field?.fieldType === 0) {
      open.push({ code: '', result: false });
      continue;
    }
    const top = open[open.length - 1];
    if (field?.fieldType === 2) {
      if (top) {
        top.result = true;
        if (/^\s*HYPERLINK\b/i.test(top.code))
          entry = { text: '', format: null };
      }
      continue;
    }
    if (field?.fieldType === 1) {
      const closed = open.pop();
      if (closed && /^\s*HYPERLINK\b/i.test(closed.code) && entry) {
        if (entry.format) out.set(entryText(entry.text), entry.format);
        entry = null;
      }
      continue;
    }
    if (typeof e.text !== 'string' || !top) continue;
    if (!top.result) top.code += e.text;
    else if (entry && /^\s*HYPERLINK\b/i.test(top.code) && e.text !== '\t') {
      entry.text += e.text;
      entry.format ??= e.characterFormat?.cloneFormat?.() ?? null;
    }
  }
  return out;
}

const deletedElement = (e: Obj) =>
  ((e.revisions ?? []) as Obj[]).some((r) => r.revisionType === 'Deletion');

/**
 * A heading's text as its entry shows it: what the reader sees once pending changes are accepted
 * (no text pending deletion), less field codes and breaks, tabs as spaces; as the editor reads it
 * otherwise.
 */
function headingText(paragraph: Obj): string {
  let out = '';
  let inCode = 0;
  for (const split of paragraph.getSplitWidgets?.() ?? [paragraph])
    for (const line of split.childWidgets ?? [])
      for (const e of line.children ?? []) {
        if (typeof e.fieldType === 'number') {
          if (e.fieldType === 0) inCode += 1;
          else if (e.fieldType === 2 && inCode) inCode -= 1;
          continue;
        }
        if (inCode || e.isPageBreak || e.isColumnBreak || deletedElement(e))
          continue;
        if (typeof e.text === 'string') out += e.text.replace(/\t/g, ' ');
      }
  return out;
}

/** Whether any body paragraph is in a style the field lists, with text: the rebuild has entries. */
function hasHeadings(editor: LiveEditor, settings: Obj): boolean {
  const helper = editor.documentHelper as Obj;
  const selection = editor.selection as Obj;
  const styles = new Set<string>(Object.keys(settings.levelSettings ?? {}));
  for (let k = settings.startLevel ?? 1; k <= (settings.endLevel ?? 3); k += 1)
    styles.add(`Heading ${k}`);
  let w = helper.pages?.[0]?.bodyWidgets?.[0]?.childWidgets?.[0];
  while (w) {
    if (
      styles.has(w.paragraphFormat?.baseStyle?.name) ||
      (settings.includeOutlineLevels && w.paragraphFormat?.outlineLevel)
    )
      if (headingText(w).trim()) return true;
    w = selection.getNextParagraphBlock(w.getSplitWidgets?.().pop() ?? w);
  }
  return false;
}

/** Rebuild the live document's table of contents; false when it has none or nothing to list. */
export function refreshToc(editor: LiveEditor, clearHistory: boolean): boolean {
  const field = liveTocField(editor);
  if (!field) return false;
  const module = editor.editorModule as Obj;
  const selection = editor.selection as Obj;
  const missing = NEEDED.filter((name) => typeof module?.[name] !== 'function');
  if (missing.length || typeof selection?.getFieldCode !== 'function')
    throw new Error(
      `the editor cannot rebuild the table of contents (missing ${[
        ...missing,
        ...(typeof selection?.getFieldCode === 'function'
          ? []
          : ['getFieldCode'])
      ].join(', ')})`
    );
  const code = String(selection.getFieldCode(field));
  const settings = module.getTocSettings(code, field) as Obj;
  // a code without \o lists only its \t styles, as Word reads it: no heading levels, and no \o
  // written into the rebuilt code
  if (!/\\o\b/i.test(code) && settings.levelSettings) {
    settings.startLevel = 1;
    settings.endLevel = 0;
  }
  if (!hasHeadings(editor, settings)) return false;
  const formats = entryFormats(editor, field);
  const first = formats.values().next().value as Obj | undefined;
  const hyperlink = module.insertTocHyperlink;
  const pageNumber = module.insertTocPageNumber;
  const headingStyle = module.isHeadingStyle;
  // a heading whose text is all pending deletion is gone once the change is accepted: no entry
  module.isHeadingStyle = function listed(paragraph: Obj) {
    return (
      headingStyle.call(module, paragraph) && !!headingText(paragraph).trim()
    );
  };
  // an entry's text span: the heading as accepted (not its pending deletions beside its
  // insertions), in the format the entry had before
  const settle = (span: Obj | undefined, widget: Obj, text: string) => {
    if (!span || typeof span.text !== 'string') return;
    const shown = headingText(widget);
    if (shown.trim()) span.text = shown;
    const was = formats.get(entryText(shown || text)) ?? first;
    if (was && span.characterFormat) {
      span.characterFormat.clearFormat();
      span.characterFormat.copyFormat(was);
    }
  };
  module.insertTocHyperlink = function keepFormat(
    line: Obj,
    bookmark: string,
    text: string,
    widget: Obj
  ) {
    const begin = hyperlink.call(module, line, bookmark, text, widget);
    settle(line.children[line.children.length - 1], widget, text);
    return begin;
  };
  module.insertTocPageNumber = function spacedCode(
    bookmark: string,
    line: Obj,
    rightAlign: boolean,
    widget: Obj
  ) {
    const begin = pageNumber.call(module, bookmark, line, rightAlign, widget);
    const at = line.children.indexOf(begin);
    const codeText = line.children[at + 1];
    if (codeText && typeof codeText.text === 'string')
      codeText.text = ` PAGEREF ${bookmark} \\h `;
    // with no hyperlinks the entry's text is a plain span before the tab and the page number
    if (!settings.includeHyperlink) {
      let k = at - 1;
      while (k >= 0 && line.children[k]?.text === '\t') k -= 1;
      const span = line.children[k];
      if (span && typeof span.fieldType !== 'number')
        settle(span, widget, String(span.text ?? ''));
    }
    return begin;
  };
  const prior = {
    track: editor.enableTrackChanges,
    start: selection.startOffset as string | undefined,
    end: selection.endOffset as string | undefined
  };
  try {
    editor.enableTrackChanges = false;
    // the rebuild does nothing with the caret in a plain content control: put it at the field
    const at = selection.getHierarchicalIndex(field.paragraph, '0');
    selection.select(at, at);
    module.insertTableOfContents(settings);
  } finally {
    module.insertTocHyperlink = hyperlink;
    module.insertTocPageNumber = pageNumber;
    module.isHeadingStyle = headingStyle;
    editor.enableTrackChanges = prior.track;
    if (prior.start && prior.end)
      try {
        selection.select(prior.start, prior.end);
      } catch {
        // the caret's place moved with the rebuilt entries: it stays where the rebuild left it
      }
  }
  if (clearHistory) historyOf(editor)?.clearHistory?.();
  return true;
}

export const tocSeam: Seam = {
  apply(host, payload) {
    const { editor } = host as DocxHost;
    refreshToc(editor, (payload as TocPayload).history === 'engine');
  }
};
