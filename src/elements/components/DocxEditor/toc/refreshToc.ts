/**
 * Refresh a Word table of contents (a TOC field) in the live editor: the editor's own update
 * rebuilds the field's entries from the headings and its layout's page numbers, as its Update Field
 * does, untracked and inside the caller's undo group. The review rail calls it after every Accept and
 * Reject (`withTocRefresh`), for every reviewer; Robin's commit calls it after every change set (its
 * `toc` seam). It never throws: it says what it did, and a rebuild that failed halfway is the
 * caller's to take back (its work is in the caller's undo group).
 *
 * What the editor's rebuild does that a person would not want, and how this step keeps it from
 * happening (measured on a real proposal's TOC and the flagship's, editor 34.1.31):
 *
 *   - It rebuilds the first field whose code merely contains "toc" (a hyperlink to a site with
 *     "toc" in its name, a REF to a `_Toc` bookmark), and the fields it rebuilt move to the end of
 *     its list. Here the field is the one whose code is a TOC, the editor's own pick is put back on
 *     it, and nothing is rebuilt when the editor would still pick another.
 *   - It rebuilds any TOC as a headings contents from the switches it models. A code with any
 *     other switch (a table of figures, `\c`; a bookmark range, `\b`) is not rebuilt.
 *   - A code without `\o` becomes `\o "1-3"`, which also lists Heading 1 to 3 and rewrites the code.
 *     Here a code without `\o` lists only its `\t` styles, as Word reads it (no heading levels).
 *   - A level it cannot build (`\t "Title,0"`, a level past 9, `;` as the separator) throws halfway,
 *     with the old contents deleted and its undo group open. Here such a code is not rebuilt, and a
 *     rebuild that throws anyway closes its undo groups and reports the failure.
 *   - Each entry's text takes the character format of its heading's paragraph mark (a heading whose
 *     mark is in a font the machine lacks shows its entry in a serif). Here each entry keeps the
 *     format its text had before the rebuild; a new entry takes the first entry's at its level.
 *   - Each entry's PAGEREF code is written with no space before the bookmark name
 *     (`PAGEREF_Toc...`), not the `PAGEREF <bookmark>` Word writes. Here the space is put back.
 *   - It reads a heading with its pending deletions in it (a tracked rename lists "OldNew") and lists
 *     a heading whose text is all pending deletion. Here an entry reads the heading as accepted, and
 *     a heading pending deletion has none; resolving the card rebuilds the contents again.
 *   - Inside a block content control (locked contents or not) it pastes the rebuilt contents outside
 *     the control and breaks it (measured), and with no heading it opens a "No Headings" dialog.
 *     Here neither is called: it reports that the contents was not refreshed, and why. Should the
 *     editor still not rebuild it, it says so too, never "refreshed".
 */
import {
  closeUndoGroups,
  historyOf,
  inUndoGroup,
  openUndoGroups
} from '../undoGroups';

type Obj = Record<string, any>;
type Editor = Obj;

/** Whitespace as an entry shows it: tabs and breaks as spaces, runs of spaces as one. */
export const entryText = (s: string): string =>
  s
    .replace(/[\t\f\v\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The switches of a contents field code, each with its argument (`\o "1-3"`, `\h`). */
function switchesOf(code: string): Array<{ name: string; arg: string }> {
  const out: Array<{ name: string; arg: string }> = [];
  const re = /\\([a-zA-Z*])\s*(?:"([^"]*)"|([^\s\\]+))?/g;
  for (let m = re.exec(code); m; m = re.exec(code))
    out.push({ name: m[1].toLowerCase(), arg: m[2] ?? m[3] ?? '' });
  return out;
}

/**
 * The switches the editor's rebuild cannot reproduce, as they are written in the code. The editor
 * models `\o "a-b"`, `\t`, `\h`, `\z`, `\u`, `\n` with no range and `\p " "`, and drops a
 * `\* MERGEFORMAT`; anything else (a table of figures, `\c`; a bookmark range, `\b`; kept tabs,
 * `\w`...) would be rebuilt as a different contents.
 */
export function unsupportedSwitches(code: string): string[] {
  return switchesOf(code)
    .filter(({ name, arg }) => {
      switch (name) {
        case 'o':
          return !/^\d+-\d+$/.test(arg);
        case 't':
          return false;
        case 'h':
        case 'z':
        case 'u':
        case 'n':
          return arg !== '';
        case 'p':
          return arg !== ' ' && arg !== '';
        case '*':
          return arg.toUpperCase() !== 'MERGEFORMAT';
        default:
          return true;
      }
    })
    .map(({ name, arg }) => `\\${name}${arg ? ` ${arg}` : ''}`);
}

const NEEDED = [
  'insertTableOfContents',
  'isHeadingStyle',
  'isOutlineLevelStyle',
  'getTocSettings',
  'insertTocHyperlink',
  'insertTocPageNumber'
];

const fieldName = (code: string) =>
  code.trim().split(/\s+/)[0]?.toUpperCase() ?? '';

/** Hierarchical offsets compared in document order (`"1;4;0"` before `"1;12;0"`). */
function before(a: string, b: string): boolean {
  const x = a.split(';').map(Number);
  const y = b.split(';').map(Number);
  for (let k = 0; k < Math.max(x.length, y.length); k += 1)
    if ((x[k] ?? -1) !== (y[k] ?? -1)) return (x[k] ?? -1) < (y[k] ?? -1);
  return false;
}

/**
 * A field's code as it reads once pending changes are accepted: the text between its begin and its
 * separator less what is pending deletion (a tracked edit of the code reads as the new code; the
 * editor's own `getFieldCode` reads both).
 */
function codeOf(editor: Editor, field: Obj): string {
  const elements = (field.paragraph?.getSplitWidgets?.() ?? [field.paragraph])
    .flatMap((split: Obj) => split?.childWidgets ?? [])
    .flatMap((line: Obj) => line?.children ?? []) as Obj[];
  const from = elements.indexOf(field);
  const to = elements.indexOf(field.fieldSeparator);
  if (from < 0 || to < from)
    return String((editor.selection as Obj).getFieldCode(field));
  return elements
    .slice(from + 1, to)
    .filter(
      (e) =>
        typeof e.fieldType !== 'number' &&
        typeof e.text === 'string' &&
        !deletedElement(e)
    )
    .map((e) => e.text)
    .join('');
}

/** The body's first field whose code is a TOC (not one that only mentions "toc"), or null. */
function liveTocField(editor: Editor): Obj | null {
  const helper = editor.documentHelper as Obj | undefined;
  const selection = editor.selection as Obj;
  let found: { field: Obj; at: string } | null = null;
  for (const f of (helper?.fields ?? []) as Obj[]) {
    if (f.fieldType !== 0 || f.paragraph?.isInHeaderFooter) continue;
    if (fieldName(codeOf(editor, f)) !== 'TOC') continue;
    const at = String(selection.getHierarchicalIndex(f.paragraph, '0'));
    if (!found || before(at, found.at)) found = { field: f, at };
  }
  return found?.field ?? null;
}

/**
 * Whether text sits before the field's begin in its paragraph or after its end in the last one: the
 * editor's rebuild keeps such text in a paragraph of its own, drops its paragraph style and adds an
 * empty paragraph after the contents on every rebuild (measured).
 */
function sharesParagraph(field: Obj): boolean {
  const text = (e: Obj) =>
    typeof e.text === 'string' &&
    e.text !== '' &&
    typeof e.fieldType !== 'number';
  const elements = (paragraph: Obj): Obj[] =>
    (paragraph?.getSplitWidgets?.() ?? [paragraph]).flatMap((split: Obj) =>
      (split?.childWidgets ?? []).flatMap((line: Obj) => line.children ?? [])
    );
  const head = elements(field.paragraph);
  const tail = elements(field.fieldEnd?.paragraph);
  return (
    head.slice(0, head.indexOf(field)).some(text) ||
    (tail.includes(field.fieldEnd) &&
      tail.slice(tail.indexOf(field.fieldEnd) + 1).some(text))
  );
}

/** Whether the field sits inside a block content control (the editor's registry of them). */
function inBlockControl(editor: Editor, field: Obj): boolean {
  const helper = editor.documentHelper as Obj;
  const selection = editor.selection as Obj;
  const at = (p: Obj) => String(selection.getHierarchicalIndex(p, '0'));
  const here = at(field.paragraph);
  return ((helper.contentControlCollection ?? []) as Obj[]).some(
    (cc) =>
      cc.type === 0 &&
      cc.contentControlWidgetType === 'Block' &&
      cc.paragraph &&
      cc.reference?.paragraph &&
      !before(here, at(cc.paragraph)) &&
      !before(at(cc.reference.paragraph), here)
  );
}

/** The field the editor's rebuild would take, as it picks it (with the caret in the body). */
function editorsPick(editor: Editor): Obj | null {
  const helper = editor.documentHelper as Obj;
  return (
    ((helper.fields ?? []) as Obj[]).find(
      (f) => helper.layout?.isTocField?.(f) && !f.paragraph?.isInHeaderFooter
    ) ?? null
  );
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

interface LiveEntry {
  text: string;
  /** The `TOC n` level of its paragraph's style. */
  level: number;
  format: Obj | null;
}

/**
 * The entries inside the field, in order: each paragraph's visible text between the field's begin
 * and end (less field codes and page numbers), its level, and its text's first character format.
 */
function liveEntries(editor: Editor, field: Obj): LiveEntry[] {
  const selection = editor.selection as Obj;
  const out: LiveEntry[] = [];
  const last = field.fieldEnd?.paragraph ?? field.paragraph;
  const open: Array<{ code: string; result: boolean }> = [];
  let started = false;
  let paragraph: Obj | undefined = field.paragraph;
  while (paragraph) {
    const style = String(paragraph.paragraphFormat?.baseStyle?.name ?? '');
    const entry: LiveEntry = {
      text: '',
      level: Number(/(\d+)$/.exec(style)?.[1] ?? 1),
      format: null
    };
    for (const split of paragraph.getSplitWidgets?.() ?? [paragraph])
      for (const line of split.childWidgets ?? [])
        for (const e of line.children ?? []) {
          if (!started) {
            if (e !== field) continue;
            started = true;
          }
          if (typeof e.fieldType === 'number') {
            if (e.fieldType === 0) open.push({ code: '', result: false });
            else if (e.fieldType === 2 && open.length)
              open[open.length - 1].result = true;
            else if (e.fieldType === 1) open.pop();
            continue;
          }
          const top = open[open.length - 1];
          if (typeof e.text !== 'string' || !top) continue;
          if (!top.result) top.code += e.text;
          else if (
            !open.some((f) => fieldName(f.code) === 'PAGEREF') &&
            e.text !== '\t'
          ) {
            entry.text += e.text;
            entry.format ??= e.characterFormat?.cloneFormat?.() ?? null;
          }
        }
    if (entryText(entry.text))
      out.push({ ...entry, text: entryText(entry.text) });
    if (paragraph === last || !open.length) break;
    paragraph = selection.getNextParagraphBlock(
      paragraph.getSplitWidgets?.().pop() ?? paragraph
    );
  }
  return out;
}

/** The styles the rebuild lists, as the editor builds them from its settings. */
function listedStyles(settings: Obj): Set<string> {
  const styles = new Set<string>(Object.keys(settings.levelSettings ?? {}));
  for (let k = settings.startLevel ?? 1; k <= (settings.endLevel ?? 3); k += 1)
    styles.add(`Heading ${k}`);
  return styles;
}

/** Whether any body paragraph is in a style the field lists, with text: the rebuild has entries. */
function hasHeadings(editor: Editor, settings: Obj): boolean {
  const helper = editor.documentHelper as Obj;
  const selection = editor.selection as Obj;
  const styles = listedStyles(settings);
  // with \u, an outline level counts only when the contents lists it (`Level1`..), as the editor's
  // isOutlineLevelStyle reads it: an ordinary paragraph's level is `BodyText`
  const levels = new Set<string>();
  if (settings.includeOutlineLevels)
    for (
      let k = settings.startLevel ?? 1;
      k <= (settings.endLevel ?? 3);
      k += 1
    )
      levels.add(`Level${k}`);
  let w = helper.pages?.[0]?.bodyWidgets?.[0]?.childWidgets?.[0];
  while (w) {
    if (
      styles.has(w.paragraphFormat?.baseStyle?.name) ||
      levels.has(w.paragraphFormat?.outlineLevel)
    )
      if (headingText(w).trim()) return true;
    w = selection.getNextParagraphBlock(w.getSplitWidgets?.().pop() ?? w);
  }
  return false;
}

/** The levels the settings ask for are ones the editor builds (`TOC 1` to `TOC 9`). */
function buildable(settings: Obj): boolean {
  const level = (n: unknown) =>
    Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 9;
  return (
    Object.values(settings.levelSettings ?? {}).every(level) &&
    (settings.endLevel === 0 ||
      settings.endLevel === undefined ||
      (level(settings.startLevel ?? 1) && level(settings.endLevel)))
  );
}

/** How many of `of` are not matched one for one in `against`. */
function unmatched(of: string[], against: string[]): number {
  const left = new Map<string, number>();
  for (const t of against) left.set(t, (left.get(t) ?? 0) + 1);
  let out = 0;
  for (const t of of) {
    const n = left.get(t) ?? 0;
    if (n) left.set(t, n - 1);
    else out += 1;
  }
  return out;
}

/** What a refresh did: rebuilt the contents, left it as it is (and why), or failed (and why). */
export type TocRefresh =
  | { status: 'refreshed'; entries: number; added: number; removed: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

const skipped = (reason: string): TocRefresh => ({ status: 'skipped', reason });

/** Rebuild the live document's table of contents, and say what was done. */
export function refreshTableOfContents(
  editor: Editor,
  options: { clearHistory?: boolean } = {}
): TocRefresh {
  const module = editor.editorModule as Obj;
  const selection = editor.selection as Obj;
  const missing = [
    ...NEEDED.filter((name) => typeof module?.[name] !== 'function'),
    ...(typeof selection?.getFieldCode === 'function' ? [] : ['getFieldCode'])
  ];
  if (missing.length) {
    // an editor without the methods this step drives (a version that renamed them): the change
    // still lands, and the contents is left as it is, said so
    // eslint-disable-next-line no-console
    console.warn('table of contents not refreshed: missing', missing);
    return skipped("the editor's rebuild is unavailable");
  }
  const field = liveTocField(editor);
  if (!field) return skipped('the editor holds no contents field');
  // in a block content control the editor's rebuild pastes the contents outside the control and
  // breaks it (measured, contents locked or not): such a contents is left as it is
  if (inBlockControl(editor, field))
    return skipped(
      "it sits in a content control, which the editor's rebuild would break"
    );
  if (sharesParagraph(field))
    return skipped(
      "text shares a paragraph with it, and the editor's rebuild would move that text and its paragraph's style"
    );
  const code = codeOf(editor, field);
  const unsupported = unsupportedSwitches(code);
  if (unsupported.length)
    return skipped(
      `its code uses ${unsupported.join(
        ', '
      )}, which the editor's rebuild would drop`
    );
  const settings = module.getTocSettings(code, field) as Obj;
  // a code without \o lists only its \t styles, as Word reads it: no heading levels, and no \o
  // written into the rebuilt code
  if (!/\\o\b/i.test(code) && settings.levelSettings) {
    settings.startLevel = 1;
    settings.endLevel = 0;
  }
  if (!buildable(settings))
    return skipped(
      `its code (${code.trim()}) asks for a level the editor cannot build`
    );
  if (!hasHeadings(editor, settings))
    return skipped('no paragraph in the styles it lists has text');
  // the editor's own pick of the field to rebuild must be this one: when another field's code
  // mentions "toc" ahead of it in the editor's list, this one is put first
  const fields = (editor.documentHelper as Obj).fields as Obj[];
  const pick = editorsPick(editor);
  const was0 = fields.indexOf(field);
  if (pick !== field && pick) {
    fields.splice(was0, 1);
    fields.splice(fields.indexOf(pick), 0, field);
  }
  // the editor's list as it was, when the field it holds was not rebuilt (a rebuilt field leaves
  // the list: the editor removes a deleted field's begin and appends the new one's)
  const putBack = () => {
    const now = fields.indexOf(field);
    if (pick === field || !pick || now < 0) return;
    fields.splice(now, 1);
    fields.splice(Math.min(was0, fields.length), 0, field);
  };
  if (editorsPick(editor) !== field) {
    putBack();
    return skipped('the editor would rebuild another field in its place');
  }
  const prior = {
    track: editor.enableTrackChanges,
    start: selection.startOffset as string | undefined,
    end: selection.endOffset as string | undefined,
    end0: String(
      selection.getHierarchicalIndex(
        field.fieldEnd?.paragraph ?? field.paragraph,
        '0'
      )
    ),
    viewer: editor.documentHelper?.viewerContainer as HTMLElement | undefined
  };
  const scroll = prior.viewer && {
    top: prior.viewer.scrollTop,
    left: prior.viewer.scrollLeft
  };
  // the rebuild works from the caret: put it at the field
  const at = selection.getHierarchicalIndex(field.paragraph, '0');
  editor.enableTrackChanges = false;
  if (editor.enableTrackChanges) {
    // the document only takes tracked changes: the rebuild would be a tracked change in the
    // person's name, so it is not done
    editor.enableTrackChanges = prior.track;
    restoreCaret(editor, prior, null);
    putBack();
    return skipped('the document only takes tracked changes');
  }
  const was = liveEntries(editor, field);
  const formats = new Map(was.map((e) => [e.text, e.format]));
  const firstAt = new Map<number, Obj | null>();
  for (const e of [...was].reverse()) firstAt.set(e.level, e.format);
  const hyperlink = module.insertTocHyperlink;
  const pageNumber = module.insertTocPageNumber;
  const headingStyle = module.isHeadingStyle;
  const outlineLevelStyle = module.isOutlineLevelStyle;
  // a heading whose text is all pending deletion is gone once the change is accepted: no entry
  module.isHeadingStyle = function listed(paragraph: Obj) {
    return (
      headingStyle.call(module, paragraph) && !!headingText(paragraph).trim()
    );
  };
  module.isOutlineLevelStyle = function listedLevel(paragraph: Obj) {
    return (
      outlineLevelStyle.call(module, paragraph) &&
      !!headingText(paragraph).trim()
    );
  };
  // an entry's text span: the heading as accepted (not its pending deletions beside its
  // insertions), in the format the entry had before (a new one: the first entry's at its level)
  const settle = (span: Obj | undefined, widget: Obj, text: string) => {
    if (!span || typeof span.text !== 'string') return;
    const shown = headingText(widget);
    if (shown.trim()) span.text = shown;
    const level = Number(
      (module.tocStyles ?? {})[widget.paragraphFormat?.baseStyle?.name] ?? 1
    );
    const format =
      formats.get(entryText(shown || text)) ??
      firstAt.get(level) ??
      was[0]?.format;
    if (format && span.characterFormat) {
      span.characterFormat.clearFormat();
      span.characterFormat.copyFormat(format);
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
  const depth = openUndoGroups(editor);
  let rebuilt: Obj | null = null;
  let failure: unknown = null;
  try {
    selection.select(at, at);
    module.insertTableOfContents(settings);
    rebuilt = liveTocField(editor);
  } catch (error) {
    failure = error;
  } finally {
    module.insertTocHyperlink = hyperlink;
    module.insertTocPageNumber = pageNumber;
    module.isHeadingStyle = headingStyle;
    module.isOutlineLevelStyle = outlineLevelStyle;
    // a rebuild that threw leaves its undo group open and the editor thinking it is still
    // rebuilding: close it into the change's group and let the editor go on
    closeUndoGroups(editor, depth);
    module.isInsertingTOC = false;
    putBack();
    editor.enableTrackChanges = prior.track;
    restoreCaret(editor, prior, rebuilt);
    if (prior.viewer && scroll) {
      prior.viewer.scrollTop = scroll.top;
      prior.viewer.scrollLeft = scroll.left;
    }
  }
  if (failure) {
    // what the rebuild did before it threw is in the caller's undo group: the caller takes it back
    const reason = failure instanceof Error ? failure.message : String(failure);
    // eslint-disable-next-line no-console
    console.warn('table of contents not refreshed: the rebuild failed', reason);
    return { status: 'failed', reason };
  }
  if (!rebuilt || rebuilt === field)
    return skipped('the editor did not rebuild it (its contents are locked)');
  if (options.clearHistory) historyOf(editor)?.clearHistory?.();
  const now = liveEntries(editor, rebuilt).map((e) => e.text);
  const then = was.map((e) => e.text);
  return {
    status: 'refreshed',
    entries: now.length,
    added: unmatched(now, then),
    removed: unmatched(then, now)
  };
}

/**
 * The person's caret where it was: a caret after the contents in the same story moves by as many
 * paragraphs as the rebuild added or removed.
 */
function restoreCaret(
  editor: Editor,
  prior: { start?: string; end?: string; end0: string },
  rebuilt: Obj | null
): void {
  const selection = editor.selection as Obj;
  if (!prior.start || !prior.end) return;
  let shift = 0;
  if (rebuilt) {
    const end1 = String(
      selection.getHierarchicalIndex(
        rebuilt.fieldEnd?.paragraph ?? rebuilt.paragraph,
        '0'
      )
    );
    const [s0, b0] = prior.end0.split(';').map(Number);
    const [s1, b1] = end1.split(';').map(Number);
    if (s0 === s1) shift = b1 - b0;
  }
  const moved = (offset: string) => {
    const parts = offset.split(';');
    const [s0, b0] = prior.end0.split(';').map(Number);
    if (shift && Number(parts[0]) === s0 && Number(parts[1]) > b0)
      parts[1] = String(Number(parts[1]) + shift);
    return parts.join(';');
  };
  try {
    selection.select(moved(prior.start), moved(prior.end));
  } catch {
    // the caret's place went with the rebuilt entries: it stays where the rebuild left it
  }
}

/**
 * The editor's own accept or reject (`resolve`) with the contents refreshed after it, in one undo
 * group, for every reviewer. A refresh that fails is logged and skipped: the group, with whatever the
 * failed rebuild left half done, is undone and the resolution run again on its own (when undo gives
 * back the document as it was; else the group is redone and kept).
 */
export function withTocRefresh<T>(editor: Editor, resolve: () => T): T {
  const helper = editor.documentHelper as Obj | undefined;
  const has = ((helper?.fields ?? []) as Obj[]).some(
    (f) => f.fieldType === 0 && fieldName(codeOf(editor, f)) === 'TOC'
  );
  if (!has) return resolve();
  const before = editor.serialize?.();
  let out: T | undefined;
  let outcome: TocRefresh | null = null;
  inUndoGroup(editor, () => {
    out = resolve();
    outcome = refreshTableOfContents(editor);
  });
  if ((outcome as TocRefresh | null)?.status === 'failed') {
    const history = historyOf(editor);
    history?.undo?.();
    if (editor.serialize?.() === before) out = resolve();
    else history?.redo?.();
  }
  return out as T;
}
